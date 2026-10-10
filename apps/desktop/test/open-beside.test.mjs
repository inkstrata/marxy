// Open beside (D-07): `Mod+\` opens the palette in beside mode, whose empty list is the recent documents
// not on screen; `Enter` opens the first in the other pane (made when there is one), `Mod+Enter` opens any
// row beside; a window narrower than two columns at the typography floor makes no second pane and says so.
// Booted on the shipped skeleton (palette dialog included) over the memory shell, with the real palette.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { PANE_CHORDS, paneChordFor } from '../src/pane/keys.ts';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
const plain = (name, fn) => nodeTest(name, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(12)}\n\n## Later\n\n${para('Later').repeat(12)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
  '/r/note-1.md': `# Note one\n\n${para('One').repeat(2)}\n`,
  '/r/note-2.md': `# Note two\n\n${para('Two').repeat(2)}\n`,
  '/r/note-3.md': `# Note three\n\n${para('Three').repeat(2)}\n`,
  '/r/note-4.md': `# Note four\n\n${para('Four').repeat(2)}\n`,
};
const entries = Object.keys(files).map((path) => ({
  path,
  root: '/r',
  title: files[path].match(/^# (.*)$/m)[1],
  headings: [],
  mtimeMs: 1,
  size: files[path].length,
  kind: 'markdown',
}));
const FIT = 'Marxy needs a window at least 929 px wide to show two documents side by side.';

async function withPage(width, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Boots the real app and palette on the shipped skeleton; opens `open` in turn in the focused pane. */
async function boot(page, { open }) {
  const base = await harnessBase();
  const { style, body } = shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ encoded, entries, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open[0]] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
      for (const path of open.slice(1)) await handle.open(path);
    },
    { encoded, entries, open },
  );
}

const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const focusedSlot = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.slot);
const dialogOpen = (page) => page.evaluate(() => document.getElementById('marxy-palette').open);
const rows = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((row) => row.querySelector('.marxy-palette-title')?.textContent ?? row.textContent));
const paletteNotice = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('#marxy-palette .marxy-palette-notice');
    return el.hidden ? null : el.textContent;
  });
const notices = (page, slot) =>
  page.evaluate(
    (id) =>
      [...(document.getElementById(id)?.querySelectorAll('.marxy-notice') ?? [])].map((line) => ({
        text: line.querySelector('.marxy-notice-text')?.textContent,
        buttons: [...line.querySelectorAll('button')].map((b) => b.textContent),
      })),
    slot === 0 ? 'marxy-notices' : 'marxy-notices-2',
  );
const focus = (page, slot) =>
  page.evaluate((s) => {
    const panes = window.__marxyHandle.panes();
    panes.focus(panes.panes[s]);
  }, slot);
const beside = (page) => page.keyboard.press('ControlOrMeta+Backslash');
/** The first pane's page, store and place, to see that it was left alone. */
const place = (page) =>
  page.evaluate(() => {
    const left = window.__marxyHandle.panes().panes[0];
    window.__left ??= { first: left.article.firstElementChild, store: left.view.store() };
    const { byteOffset } = left.view.position();
    return {
      byteOffset,
      samePage: left.article.firstElementChild === window.__left.first && left.article.firstElementChild.isConnected,
      sameStore: left.view.store() === window.__left.store,
    };
  });

test('1,470 px, one document, two more in the MRU: Mod+\\ then Enter splits with the most recent other document', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/B.md', '/r/C.md', '/r/A.md'] });
    const before = await place(page);
    await beside(page);
    assert.equal(await dialogOpen(page), true);
    assert.deepEqual(await rows(page), ['Charlie', 'Bravo'], 'Recent without the document on screen');
    assert.equal(await paletteNotice(page), 'Open beside');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1]?.path() === '/r/C.md');
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/C.md']);
    assert.equal(await dialogOpen(page), false);
    assert.equal(await focusedSlot(page), 1, 'focus follows the document into its pane');
    assert.deepEqual(await place(page), before, "the first pane's document and place are untouched");
  });
});

test('Mod+\\ with two panes and Enter replaces the other pane, not the focused one, and lists neither', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/B.md', '/r/C.md', '/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/C.md'));
    await focus(page, 0);
    const before = await place(page);
    await beside(page);
    assert.deepEqual(await rows(page), ['Bravo'], 'neither pane\'s document is offered');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/B.md');
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 2, 'no third pane');
    assert.deepEqual(await place(page), before);
  });
});

test('Mod+Enter on the third row of a typed result opens that file beside; plain Enter still opens here', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/A.md'] });
    await page.keyboard.press('ControlOrMeta+KeyP');
    await page.fill('#marxy-palette .marxy-palette-query', 'note');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length >= 4);
    const titles = await rows(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ControlOrMeta+Enter');
    const third = `/r/note-${['one', 'two', 'three', 'four'].indexOf(titles[2].split(' ')[1].toLowerCase()) + 1}.md`;
    await page.waitForFunction((p) => window.__marxyHandle.panes().panes[1]?.path() === p, third);
    assert.deepEqual(await paths(page), ['/r/A.md', third]);
    // Plain Mod+P and Enter open here, as before.
    await focus(page, 0);
    await page.keyboard.press('ControlOrMeta+KeyP');
    await page.fill('#marxy-palette .marxy-palette-query', 'Bravo');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await paths(page), ['/r/B.md', third]);
  });
});

test('900 px: Mod+\\ shows the fit notice naming 929 px and opens no palette and no second pane; 929 px splits', async () => {
  await withPage(900, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/B.md', '/r/A.md'] });
    await beside(page);
    await page.waitForTimeout(200);
    assert.equal(await dialogOpen(page), false);
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.deepEqual((await notices(page, 0)).map((n) => n.text), [FIT]);
    // The set itself refuses too, whoever asks (a link followed beside, D-09).
    await page.evaluate(() => window.__marxyHandle.open('/r/B.md', { target: 'other' }));
    assert.deepEqual(await paths(page), ['/r/A.md'], 'AppHandle.open beside makes no second pane either');
    // 928 is still too narrow; 929 holds two columns.
    await page.setViewportSize({ width: 928, height: 900 });
    await beside(page);
    await page.waitForTimeout(200);
    assert.equal(await dialogOpen(page), false);
    await page.setViewportSize({ width: 929, height: 900 });
    await beside(page);
    assert.equal(await dialogOpen(page), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
  });
});

test('a row opened beside from a palette that is already up, in a window too narrow: it stays up with the reason, and Enter opens here', async () => {
  await withPage(900, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/B.md', '/r/A.md'] });
    await page.keyboard.press('ControlOrMeta+KeyP');
    await page.fill('#marxy-palette .marxy-palette-query', 'Bravo');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);
    assert.equal(await dialogOpen(page), true, 'the palette stays up');
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.ok((await paletteNotice(page)).startsWith(FIT), 'the notice says what the fit notice says');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await paths(page), ['/r/B.md'], 'opened here, no second pane');
  });
});

test('open beside a dirty document in the other pane asks in that pane and replaces nothing until answered', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/C.md', '/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await page.evaluate(() => {
      const article = window.__marxyHandle.panes().panes[1].article;
      article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
    await focus(page, 0);
    await beside(page);
    assert.deepEqual(await rows(page), ['Charlie'], 'the dirty document on screen is not offered');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'nothing replaced yet');
    assert.deepEqual(await notices(page, 1), [
      { text: 'B.md has changes that are not saved.', buttons: ['Save and open', 'Open without saving', 'Dismiss'] },
    ]);
    assert.deepEqual(await notices(page, 0), [], 'the left pane is not asked');
    assert.equal(await focusedSlot(page), 0, 'focus has not moved to a pane that is still waiting');
    await page.locator('#marxy-notices-2 .marxy-notice button', { hasText: 'Dismiss' }).click();
    await page.waitForTimeout(200);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'Dismiss keeps the document');
  });
});

test('Alt+Arrow without Mod is history, not a pane chord: with the right pane focused, focus stays on it', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await focus(page, 1);
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(200);
    assert.equal(await focusedSlot(page), 1);
    // And with Mod, they are the chords.
    await page.keyboard.press('ControlOrMeta+Alt+ArrowLeft');
    assert.equal(await focusedSlot(page), 0);
  });
});

test('Esc in the palette gives focus back to the pane it was summoned from', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/note-1.md', '/r/B.md', '/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await focus(page, 0);
    await beside(page);
    await focus(page, 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
    assert.equal(await focusedSlot(page), 0);
  });
});

plain('paneChordFor needs Mod (and only Mod) for every chord (D-06 review, M10)', () => {
  const press = (init) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, code: '', ...init });
  for (const mac of [true, false]) {
    const mod = mac ? { metaKey: true } : { ctrlKey: true };
    const other = mac ? { ctrlKey: true } : { metaKey: true };
    for (const chord of PANE_CHORDS) {
      const keys = { code: chord.code, shiftKey: chord.shift ?? false, altKey: chord.alt ?? false };
      assert.equal(paneChordFor(press({ ...keys, ...mod }), mac), chord, `${chord.command} with Mod`);
      assert.equal(paneChordFor(press(keys), mac), null, `${chord.command} without Mod`);
      assert.equal(paneChordFor(press({ ...keys, ...other }), mac), null, `${chord.command} with the other platform's Mod`);
    }
  }
  assert.equal(paneChordFor(press({ code: 'ArrowLeft', altKey: true }), true), null);
  assert.equal(paneChordFor(press({ code: 'ArrowRight', altKey: true }), false), null);
});

test('splitting reads the first pane\'s place live: a script scroll, or a resize, right before the split loses nothing', async () => {
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/A.md'] });
    // A script scroll and the split in the same task: no scroll event has been heard yet.
    const scripted = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      const view = panes.panes[0].view;
      const heading = document.querySelector('#doc h2');
      window.scrollTo(0, heading.getBoundingClientRect().top + window.scrollY - 200);
      const live = view.position().byteOffset;
      await panes.openIn('other', '/r/B.md');
      await new Promise((r) => setTimeout(r, 300));
      return { live, after: view.position().byteOffset };
    });
    assert.ok(scripted.live > 0);
    assert.equal(scripted.after, scripted.live);
  });
  await withPage(1470, async (page) => {
    await boot(page, { open: ['/r/A.md'] });
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForTimeout(300);
    // A resize moves the reading line (0.4 of the height) without a scroll event.
    await page.setViewportSize({ width: 1470, height: 500 });
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position().byteOffset);
    const after = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      await panes.openIn('other', '/r/B.md');
      await new Promise((r) => setTimeout(r, 300));
      return panes.panes[0].view.position().byteOffset;
    });
    assert.ok(live > 0);
    assert.equal(after, live);
  });
});
