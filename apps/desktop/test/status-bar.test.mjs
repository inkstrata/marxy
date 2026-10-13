// The status bar (W-11), in the real app over the memory shell, in WebKit. What the reader sees: the bar is drawn when the window
// unfolds and gone when it folds; its facts follow the focused pane's document (kind, one measure, where you are, the bytes'
// encoding and endings, the theme and the text size); an item is a button only where a tab or the palette is behind it; Source's
// caret and typing reach it without a recount of a large file per key; slow work shows in it instead of as a pill; it announces
// nothing; and the reading column does not move when it appears. The rules are status-bar.test.ts.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (i) => `Paragraph ${i} runs long enough to be a paragraph of the reading column and no more than that.`;
const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => para(from + i)).join('\n\n');
const PLAN = ['# Plan', '', 'Intro words.', '', filler(30), '', '## Method', '', 'How it is done.', '', filler(40, 100), '', '## Results', '', 'What came of it.', '', filler(60, 200), ''].join('\n');
const NO_HEAD = ['Some text before any heading, with several words in it.', '', filler(40), '', '# Later', '', filler(40, 100), ''].join('\n');
// 56,000 words: past the size the bar counts at once.
const BIG = Array.from({ length: 4000 }, (_, i) => `Line ${i} has ten words in it so the count is easy to know.`).join('\n\n');
const files = {
  '/r/Plan.md': PLAN,
  '/r/NoHead.md': NO_HEAD,
  '/r/Big.md': BIG,
  '/r/Small.md': '# Small\n\nThree little words.\n',
  '/r/src/main.rs': 'fn main() {\n    println!("hi");\n}\n',
  '/r/crlf.txt': 'one\r\ntwo\r\nthree\r\n',
  '/r/mixed.txt': 'one\r\ntwo\nthree\n',
};

async function withPage(width, fn, { open = ['/r/Plan.md'], unfold = true, before } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files, open });
    if (before) await page.evaluate(before);
    if (unfold) {
      await page.evaluate(() => window.__marxyHandle.workspace().unfold());
      await page.waitForSelector('[data-marxy-status-item="encoding"]');
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Runs in the page before it unfolds: the real palette, mounted as main.ts does, with `open` recording what it was asked for. */
const mountPalette = async () => {
  const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
  const { palette } = await import('/src/commands/app-handle.ts');
  mountPaletteFromHandle(window.__marxyHandle, { initialPath: null });
  window.__asked = [];
  const p = palette();
  const open = p.open.bind(p);
  p.open = (query, opts) => { window.__asked.push(query); open(query, opts); };
};

/** What the bar shows: id to { text, tag }. */
const barOf = (page) =>
  page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('[data-marxy-status-item]')].map((n) => [n.dataset.marxyStatusItem, { text: n.textContent, tag: n.tagName.toLowerCase() }])),
  );
const textOf = async (page, id) => (await barOf(page))[id]?.text ?? null;
const frames = (page, n = 2) => page.evaluate((count) => new Promise((resolve) => { let left = count; const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
const column = (page) => page.evaluate(() => { const r = document.getElementById('doc').getBoundingClientRect(); return { x: r.x, width: r.width }; });
const toSource = async (page) => {
  await page.evaluate(() => window.__marxyHandle.toggleMode());
  await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('#marxy-source .cm-content'));
};
/** Runs `fn(view, doc)` in the page against the focused pane's editor. */
const withEditor = (page, fn, arg) =>
  page.evaluate(
    async ({ fn, arg }) => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(window.__marxyHandle.panes().focused.parts.source).view;
      return new Function('view', 'arg', `return (${fn})(view, arg)`)(view, arg);
    },
    { fn: fn.toString(), arg },
  );

test('folded there is no bar; unfolding draws it with the file\'s facts and the window\'s, and folding takes it away', async () => {
  await withPage(1280, async (page) => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-status-bar, [data-marxy-status-item], [data-marxy-workspace-region="status-bar"]').length), 0, 'folded');
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.waitForSelector('.marxy-status-bar [data-marxy-status-item="encoding"]');
    const bar = await barOf(page);
    const kind = await page.evaluate(() => window.__marxyHandle.panes().focused.kind());
    assert.equal(bar.kind.text, kind.charAt(0).toUpperCase() + kind.slice(1), 'the kind, as the pane decided it');
    assert.match(bar.measure.text, /^\d[\d,]* words$/, 'prose is measured in words');
    assert.equal(bar.encoding.text, 'UTF-8 · LF');
    assert.equal(bar.theme.text, 'Night');
    assert.equal(bar.size.text, '20 px');
    assert.ok(await page.evaluate(() => { const r = document.querySelector('[data-marxy-workspace-region="status-bar"]'); return !r.hidden && r.getBoundingClientRect().height === 26; }), 'the 26 px band is drawn');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-status-bar > *')].map((n) => n.className === 'marxy-status-grow' ? '|' : n.dataset.marxyStatusItem)), ['kind', 'measure', 'where', 'encoding', '|', 'theme', 'size'], 'file facts left, window facts right');
    assert.equal(bar.where.text, 'Plan', 'in Read the section under the reading line: the first heading, at the top');
    await page.evaluate(() => window.__marxyHandle.workspace().fold());
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-status-bar, [data-marxy-status-item], [data-marxy-workspace-region="status-bar"]').length), 0, 'folded again: the element is gone');
  }, { unfold: false });
});

test('the words are the document\'s: a heading line and its text count, and the theme and size follow a change at once', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/Small.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="measure"]')?.textContent === '4 words');
    // The theme (a variant half and a bundled one) and the size are read as they are changed, not on a timer.
    await page.evaluate(() => document.documentElement.setAttribute('data-marxy-variant', 'light'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="theme"]')?.textContent === 'Paper');
    await page.evaluate(async () => {
      const { applyBundledTheme } = await import('/src/theme/user-theme.ts');
      await applyBundledTheme('warm');
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="theme"]')?.textContent === 'Sepia');
    await page.evaluate(async () => {
      const { applyReaderConfig } = await import('/src/theme/reader-config.ts');
      applyReaderConfig(document.documentElement, { variant: 'light', size: 24 });
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="size"]')?.textContent === '24 px');
  });
});

test('switching documents and panes changes every item: a Rust file is code, in lines; a CRLF file says CRLF; a mixed one Mixed', async () => {
  await withPage(1440, async (page) => {
    const plan = await barOf(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/src/main.rs'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="kind"]')?.textContent === 'Code · Rust');
    const rust = await barOf(page);
    assert.equal(rust.measure.text, '3 lines');
    assert.notEqual(rust.measure.text, plan.measure.text);
    await page.evaluate(() => window.__marxyHandle.open('/r/crlf.txt'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="encoding"]')?.textContent === 'UTF-8 · CRLF');
    await page.evaluate(() => window.__marxyHandle.open('/r/mixed.txt'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="encoding"]')?.textContent === 'UTF-8 · Mixed');
    // Two panes: the bar follows the one with focus.
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.open('/r/Plan.md');
      await h.panes().openIn('other', '/r/src/main.rs');
      h.panes().focus(h.panes().panes[1]);
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="kind"]')?.textContent === 'Code · Rust');
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="kind"]')?.textContent !== 'Code · Rust');
    assert.equal(await textOf(page, 'measure'), plan.measure.text, 'the left pane\'s document again');
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[1]); });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="measure"]')?.textContent === '3 lines');
  });
});

test('where you are in Read is the heading under the reading line, and nothing above the first heading', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/NoHead.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="encoding"]'));
    await frames(page, 3);
    assert.equal((await barOf(page)).where, undefined, 'above the first heading there is no section to name');
    await page.evaluate((at) => window.__marxyHandle.open('/r/NoHead.md', { at }), NO_HEAD.indexOf('# Later') + 20);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Later');
    // Plan: scrolling moves the section; opening at "Results" lands there.
    await page.evaluate(() => window.__marxyHandle.open('/r/Plan.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Plan');
    await page.evaluate((at) => window.__marxyHandle.open('/r/Plan.md', { at }), PLAN.indexOf('## Results') + 30);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Results');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Plan');
  });
});

test('where you are in Source is Ln, Col at the caret, and follows a click-free move and typing', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/Small.md'));
    await toSource(page);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Ln 1, Col 1');
    await withEditor(page, (view) => view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 4 } }));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Ln 3, Col 5');
    await withEditor(page, (view) => view.dispatch({ changes: { from: view.state.selection.main.head, insert: 'xyz' }, selection: { anchor: view.state.selection.main.head + 3 } }));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Ln 3, Col 8');
    assert.equal(await textOf(page, 'measure'), '4 words', 'the editor\'s text: a word that grew by three letters is still one word');
    await withEditor(page, (view) => view.dispatch({ changes: { from: view.state.doc.length, insert: 'more words\n' } }));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="measure"]')?.textContent === '6 words');
  });
});

test('a large prose file is not recounted per key: the count is made again once typing stops, and is right then', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/Big.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="measure"]')?.textContent === '56,000 words');
    await toSource(page);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]'));
    // Thirty keys, one frame apart, each a new word.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(window.__marxyHandle.panes().focused.parts.source).view;
      for (let i = 0; i < 30; i++) {
        view.dispatch({ changes: { from: 0, insert: 'w ' } });
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    assert.equal(await textOf(page, 'measure'), '56,000 words', 'while keys are still arriving the last count stands');
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="measure"]')?.textContent === '56,030 words', undefined, { timeout: 5000 });
    // The caret still moves per key meanwhile.
    assert.equal(await textOf(page, 'where'), 'Ln 1, Col 1');
  });
});

test('an item is a button only where something is behind it: where you are opens Outline once it is registered, the theme opens the palette on >Theme', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/Plan.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]'));
    const bar = await barOf(page);
    assert.equal(bar.where.tag, 'span', 'no Outline tab is registered: the section is plain text');
    for (const id of ['kind', 'measure', 'encoding', 'size']) assert.equal(bar[id].tag, 'span', `${id} has no tab behind it`);
    assert.equal(bar.theme.tag, 'button');
    // Clicking the plain text does nothing: the inspector stays undocked.
    await page.click('[data-marxy-status-item="where"]');
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().arrangement.inspector), false);
    // A stub Outline tab turns it into a button; clicking docks the inspector on that tab.
    await page.evaluate(async () => {
      const { registerInspectorTab } = await import('/src/workspace/inspector.ts');
      window.__off = registerInspectorTab({ id: 'outline', title: 'Outline', mount: (el) => { el.textContent = 'outline panel'; return () => {}; } });
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.tagName === 'BUTTON');
    await page.click('[data-marxy-status-item="where"]');
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().arrangement.inspector), true, 'docked');
    await page.waitForFunction(() => document.querySelector('[data-marxy-inspector-tab-active]')?.getAttribute('data-marxy-inspector-tab') === 'outline');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-inspector-panel').textContent), 'outline panel');
    // The theme button asks the palette for the theme commands.
    await page.click('[data-marxy-status-item="theme"]');
    assert.deepEqual(await page.evaluate(() => window.__asked), ['>Theme']);
    await page.waitForSelector('#marxy-palette[open]');
    assert.match(await page.evaluate(() => document.querySelector('#marxy-palette input').value), /^>\s*Theme/);
    await page.keyboard.press('Escape');
    // Withdrawn, it is text again.
    await page.evaluate(() => window.__off());
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.tagName === 'SPAN');
  }, { before: mountPalette });
});

test('a button works from the keyboard, and a click does not take focus from the editor', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(async () => {
      const { registerInspectorTab } = await import('/src/workspace/inspector.ts');
      registerInspectorTab({ id: 'outline', title: 'Outline', mount: (el) => { el.textContent = 'outline panel'; return () => {}; } });
    });
    await page.evaluate(() => window.__marxyHandle.open('/r/Small.md'));
    await toSource(page);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.tagName === 'BUTTON');
    await page.evaluate(() => document.querySelector('#marxy-source .cm-content').focus());
    await page.click('[data-marxy-status-item="where"]');
    await page.waitForFunction(() => document.querySelector('[data-marxy-inspector-tab-active]')?.getAttribute('data-marxy-inspector-tab') === 'outline');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true, 'the caret stays where the reader had it');
    await page.focus('[data-marxy-status-item="theme"]');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.__asked), ['>Theme']);
    await page.waitForSelector('#marxy-palette[open]');
  }, { before: mountPalette });
});

test('slow work shows in the bar and not as a pill, and ends in the one notice; folded, the bar is not there to show it', async () => {
  const before = () => {
    const h = window.__marxyHandle;
    let busy = false;
    const callbacks = new Set();
    h.index.indexing = () => busy;
    h.index.onStatusChange = (cb) => { callbacks.add(cb); return () => callbacks.delete(cb); };
    window.__walk = (value) => { busy = value; for (const cb of [...callbacks]) cb(); };
  };
  const pills = (page) => page.evaluate(() => document.querySelectorAll('.marxy-notice').length);
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__walk(true));
    assert.equal((await barOf(page)).progress, undefined, 'a walk that is quick is not shown');
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="progress"]')?.textContent === 'Indexing…');
    assert.equal(await pills(page), 0, 'no pill while it runs');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-status-bar [aria-live], .marxy-status-bar [role="status"]')].length), 0);
    await page.evaluate(() => window.__walk(false));
    await page.waitForFunction(() => !document.querySelector('[data-marxy-status-item="progress"]'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-notice').length === 1);
    assert.match(await page.evaluate(() => document.querySelector('.marxy-notice').textContent), /Indexed [\d,]+ documents?\. Your files are unchanged\./);
    // A walk that ends before it was shown says nothing at all.
    await page.evaluate(() => document.querySelector('.marxy-notice').remove());
    await page.evaluate(() => { window.__walk(true); window.__walk(false); });
    await page.waitForTimeout(900);
    assert.equal(await pills(page), 0);
    assert.equal((await barOf(page)).progress, undefined);
  }, { before });
  await withPage(1280, async (page) => {
    // Folded: no bar, so nothing is shown and nothing said, as before this story.
    await page.evaluate(() => window.__walk(true));
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-status-item]').length), 0);
    await page.evaluate(() => window.__walk(false));
    await frames(page, 3);
    assert.equal(await pills(page), 0);
  }, { before, unfold: false });
});

test('the bar announces nothing: no live region, and typing in Source changes no live region\'s text', async () => {
  await withPage(1280, async (page) => {
    const live = await page.evaluate(() => {
      const region = document.querySelector('[data-marxy-workspace-region="status-bar"]');
      return {
        inside: region.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], [aria-atomic]').length,
        outside: region.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') !== null,
        role: region.querySelector('.marxy-status-bar').getAttribute('role'),
      };
    });
    assert.deepEqual(live, { inside: 0, outside: false, role: 'group' });
    await page.evaluate(() => window.__marxyHandle.open('/r/Small.md'));
    await toSource(page);
    await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]'));
    // Every live region the page has (the notices): its text is what it was after a run of keys.
    const snapshot = () => page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map((n) => n.textContent).join('|'));
    const before = await snapshot();
    await withEditor(page, (view) => { for (let i = 0; i < 20; i++) view.dispatch({ changes: { from: 0, insert: 'k' } }); });
    await frames(page, 3);
    assert.equal(await snapshot(), before);
  });
});

test('the reading column does not move when the bar appears or goes: not a pixel in x, width, or the text under the reading line', async () => {
  for (const width of [1280, 1700]) {
    await withPage(width, async (page) => {
      await page.evaluate((at) => window.__marxyHandle.open('/r/Plan.md', { at }), PLAN.indexOf('## Method') + 40);
      await page.waitForFunction(() => window.scrollY > 300);
      await page.waitForFunction(() => document.querySelector('[data-marxy-status-item="where"]')?.textContent === 'Method');
      const probe = () => page.evaluate(() => {
        const col = document.getElementById('doc').getBoundingClientRect();
        const line = [...document.querySelectorAll('#doc p')].find((p) => p.getBoundingClientRect().top >= 0);
        return { x: col.x, width: col.width, scrollY: window.scrollY, line: line.textContent.slice(0, 20), top: line.getBoundingClientRect().top };
      });
      const withBar = await probe();
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('status-bar', false));
      await frames(page);
      const without = await probe();
      assert.deepEqual(without, withBar, `at ${width}: the bar going moved nothing`);
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('status-bar', true));
      await frames(page);
      assert.deepEqual(await probe(), withBar, `at ${width}: the bar coming back moved nothing`);
      // And the column is where it is folded.
      await page.evaluate(() => window.__marxyHandle.workspace().fold());
      const folded = await column(page);
      assert.deepEqual({ x: withBar.x, width: withBar.width }, folded, `at ${width}: the same column folded and unfolded with the bar`);
    });
  }
});
