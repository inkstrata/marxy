// Formatting commands, inserts, show whitespace and the column guide in Source (V-08), in the running app over the
// memory shell, WebKit. Commitment 3: a formatting command changes only the bytes it is asked to, as one undo step;
// show whitespace and the guide are a view and change no byte, no copy and no buffer.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const LONG = `${'x'.repeat(120)}\n`;
const files = {
  '/r/note.md': 'alpha beta gamma\n\nsecond paragraph\n',
  '/r/crlf.md': 'alpha beta\r\ngamma\r\n',
  '/r/main.rs': 'fn main() {\n\tlet x = 1;   \n}\n',
  '/r/long.rs': `fn long() {\n${LONG}}\n`,
  '/r/.git/HEAD': 'ref: refs/heads/main\n',
};

async function withApp(open, fn, extra = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, ...extra }, open: [open], guard: true });
    // A Markdown file opens in Read; this is about Source.
    if ((await page.evaluate(() => document.body.dataset.marxyMode)) !== 'source') {
      await page.evaluate(() => window.__marxyHandle.toggleMode());
    }
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    await fn(page, (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
  } finally {
    await browser.close();
  }
}

/** Runs a palette command by id, as the palette does: only if its `when` allows. */
const run = (page, id) =>
  page.evaluate(async (id) => {
    const { commands } = await import('/src/commands/index.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    const cmd = commands().find((c) => c.id === id);
    if (cmd && cmd.when(ctx)) await cmd.run(ctx);
  }, id);

/** Selects `from`..`to` of the editor's text and focuses it. */
const select = (page, from, to = from) =>
  page.evaluate(async ({ from, to }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const { view } = activeSourceEditor();
    view.focus();
    view.dispatch({ selection: { anchor: from, head: to } });
  }, { from, to });

const docText = (page) =>
  page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText());

/** The titles the palette's own list offers for the open file, among those starting with any of `prefixes`. */
const offered = (page, test) =>
  page.evaluate(async (pattern) => {
    const { commands } = await import('/src/commands/index.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    return commands().filter((c) => c.when(ctx) && new RegExp(pattern).test(c.id)).map((c) => c.title);
  }, test);

test('Mod+B in a Markdown file wraps the selection, one Mod+Z restores it, Mod+B twice returns the bytes', async () => {
  await withApp('/r/note.md', async (page, mod) => {
    await select(page, 6, 10);
    await page.keyboard.press(`${mod}+KeyB`);
    assert.equal(await docText(page), 'alpha **beta** gamma\n\nsecond paragraph\n');
    await page.keyboard.press(`${mod}+KeyZ`);
    assert.equal(await docText(page), 'alpha beta gamma\n\nsecond paragraph\n', 'one undo step restores it');
    await select(page, 6, 10);
    await page.keyboard.press(`${mod}+KeyB`);
    await page.keyboard.press(`${mod}+KeyB`);
    assert.equal(await docText(page), 'alpha beta gamma\n\nsecond paragraph\n', 'twice gives back the bytes');
    // The word at the caret.
    await select(page, 13);
    await page.keyboard.press(`${mod}+KeyI`);
    assert.equal(await docText(page), 'alpha beta *gamma*\n\nsecond paragraph\n');
  });
});

test('Ctrl+` wraps in inline code on a Mac', async () => {
  await withApp('/r/note.md', async (page, mod) => {
    if (mod !== 'Meta') return; // a literal Ctrl chord is a Mac's; elsewhere the command is in the palette
    await select(page, 6, 10);
    await page.keyboard.press('Control+Backquote');
    assert.equal(await docText(page), 'alpha `beta` gamma\n\nsecond paragraph\n');
  });
});

test('in a .rs file Mod+B does nothing, and no formatting command is offered; in Markdown they are', async () => {
  await withApp('/r/main.rs', async (page, mod) => {
    const before = await docText(page);
    await select(page, 3, 7);
    await page.keyboard.press(`${mod}+KeyB`);
    await page.keyboard.press(`${mod}+KeyI`);
    assert.equal(await docText(page), before);
    assert.deepEqual(await offered(page, '^source\\.(format|insert)-'), []);
  });
  await withApp('/r/note.md', async (page) => {
    assert.deepEqual(await offered(page, '^source\\.(format|insert)-'), [
      'Bold', 'Italic', 'Inline code', 'Strikethrough', 'Link',
      'Insert table', 'Insert code block', 'Insert horizontal rule', 'Insert details block', 'Insert footnote',
    ]);
  });
});

test('a CRLF file: an insert and a wrap are written in CRLF, each one undo step', async () => {
  await withApp('/r/crlf.md', async (page, mod) => {
    const bytesOf = () => page.evaluate(() => {
      const snap = window.__marxyHandle.document().snapshot();
      return [...snap.buffer.bytes];
    });
    const original = await bytesOf();
    await select(page, 0, 5);
    await page.keyboard.press(`${mod}+KeyB`);
    // The caret to the end of the text: an insert is a block of its own there.
    await page.evaluate(async () => {
      const { view } = (await import('/src/source/editor.ts')).activeSourceEditor();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await run(page, 'source.insert-table');
    // Leaving Source folds the editor's text into the buffer; the folded bytes are what a save writes.
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    const out = await bytesOf();
    const text = new TextDecoder().decode(Uint8Array.from(out));
    assert.match(text, /^\*\*alpha\*\* beta\r\ngamma\r\n/);
    assert.ok(text.includes('| Column | Column |'));
    assert.doesNotMatch(text, /(?<!\r)\n/, 'no bare LF anywhere');
    assert.notDeepEqual(out, original);
  });
});

test('show whitespace: a tab and trailing spaces are marked, the text and a copy are unchanged, off restores', async () => {
  await withApp('/r/main.rs', async (page) => {
    const before = await docText(page);
    assert.equal(await page.locator('#marxy-source .cm-highlightTab').count(), 0, 'off by default');
    await run(page, 'view.toggle-show-whitespace');
    await page.waitForSelector('#marxy-source .cm-highlightTab');
    const look = await page.evaluate(() => ({
      tab: getComputedStyle(document.querySelector('#marxy-source .cm-highlightTab')).backgroundImage,
      trailing: getComputedStyle(document.querySelector('#marxy-source .cm-trailingSpace')).backgroundColor,
      trailingText: document.querySelector('#marxy-source .cm-trailingSpace').textContent,
    }));
    assert.notEqual(look.tab, 'none');
    assert.notEqual(look.trailing, 'rgba(0, 0, 0, 0)');
    assert.equal(look.trailingText, '   ');
    assert.equal(await docText(page), before, 'the buffer is unchanged');
    // Copy the second line: the pasteboard holds the tab (0x09), not a mark.
    const copied = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const { view } = activeSourceEditor();
      const line = view.state.doc.line(2);
      view.focus();
      view.dispatch({ selection: { anchor: line.from, head: line.to } });
      const data = new DataTransfer();
      view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData('text/plain');
    });
    assert.equal(copied, '\tlet x = 1;   ');
    assert.equal([...copied][0].charCodeAt(0), 0x09);
    await run(page, 'view.toggle-show-whitespace');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-source .cm-highlightTab').length === 0);
    assert.equal(await docText(page), before);
  });
});

/** The guide's x within the page, from the content's left edge and its resolved `left`. */
const guide = (page) =>
  page.evaluate(() => {
    const content = document.querySelector('#marxy-source .cm-content');
    const after = getComputedStyle(content, '::after');
    if (after.content === 'none' || after.content === 'normal') return null;
    // The ruler's own probe where there is a ruler; a Markdown file has none, so a span in the content's face measures `ch`.
    let cw = document.querySelector('#marxy-source .marxy-source-ruler-probe')?.getBoundingClientRect().width;
    if (!cw) {
      const span = document.createElement('span');
      const look = getComputedStyle(content);
      span.style.cssText = `position:absolute;visibility:hidden;width:100ch;font-family:${look.fontFamily};font-size:${look.fontSize};font-weight:${look.fontWeight};font-variation-settings:${look.fontVariationSettings};`;
      document.body.append(span);
      cw = span.getBoundingClientRect().width / 100;
      span.remove();
    }
    return {
      x: content.getBoundingClientRect().left + parseFloat(after.left),
      width: parseFloat(after.width),
      cw,
      contentLeft: content.getBoundingClientRect().left,
      pointer: after.pointerEvents,
    };
  });

/** The centre of the ruler's tick for column `n`. */
const tickCentre = (page, n) =>
  page.evaluate((n) => {
    const tick = [...document.querySelectorAll('#marxy-source .marxy-source-ruler-tick')].find((t) => t.style.getPropertyValue('--marxy-col') === String(n));
    if (!tick) return null;
    const r = tick.getBoundingClientRect();
    return r.left + r.width / 2;
  }, n);

test('the column guide sits at column 80 in a code file, on the ruler grid, and is absent in Markdown by default', async () => {
  await withApp('/r/long.rs', async (page) => {
    const g = await guide(page);
    assert.ok(g, 'a code file has the guide');
    assert.equal(g.width, 1);
    assert.equal(g.pointer, 'none');
    assert.ok(Math.abs(g.x - g.contentLeft - 80 * g.cw) < 1.2, `the guide is 80 characters from the text's start (${g.x - g.contentLeft} vs ${80 * g.cw})`);
    // The ruler's tick 80 is centred on character 80, a half character left of the guide at that character's right edge.
    const tick = await tickCentre(page, 80);
    assert.ok(tick !== null, 'the ruler draws column 80');
    assert.ok(Math.abs(g.x - g.cw / 2 - tick) < 1, `tick 80 at ${tick}, guide at ${g.x}`);
    // The line of 120 characters runs past it: the guide takes no space.
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-source .cm-line:nth-child(2)').textContent.length), 120);
  });
  await withApp('/r/note.md', async (page) => {
    assert.equal(await guide(page), null, 'Markdown has none unless chosen');
  });
});

test('the column guide toggles, follows .editorconfig max_line_length, and changes no byte', async () => {
  await withApp('/r/long.rs', async (page) => {
    const before = await docText(page);
    await run(page, 'view.toggle-column-guide');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#marxy-source .cm-content'), '::after').content === 'none');
    assert.equal(await guide(page), null);
    await run(page, 'view.toggle-column-guide');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#marxy-source .cm-content'), '::after').content !== 'none');
    assert.equal(await docText(page), before);
  });
  await withApp('/r/long.rs', async (page) => {
    await page.waitForFunction(async () => {
      const content = document.querySelector('#marxy-source .cm-content');
      const probe = document.querySelector('#marxy-source .marxy-source-ruler-probe');
      return Math.abs(parseFloat(getComputedStyle(content, '::after').left) - 100 * probe.getBoundingClientRect().width) < 1.5;
    });
  }, { '/r/.editorconfig': '[*]\nmax_line_length = 100\n' });
});

test('in Markdown the guide, once chosen, sits at 80 too', async () => {
  await withApp('/r/note.md', async (page) => {
    await run(page, 'view.toggle-column-guide');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#marxy-source .cm-content'), '::after').content !== 'none');
    const g = await guide(page);
    assert.ok(Math.abs(g.x - g.contentLeft - 80 * g.cw) < 1.2, JSON.stringify(g));
  });
});
