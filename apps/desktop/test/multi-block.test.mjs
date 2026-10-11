// A run of sibling blocks in Rendered (E-05): Shift+click and Alt+Shift+Down extend a block selection, the run is one
// contiguous byte range with no node, "Dedupe lines" is offered for it (and not for one block), one undo step takes it back,
// and a re-render resolves the run or clears it.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-multi-block-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function bootText(page, docPath, text) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__testOrigBytes = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(argv[0]));
  }, { files: { [docPath]: Buffer.from(text, 'utf8').toString('base64') }, argv: [docPath] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
}

const sel = (page) => page.evaluate(() => {
  const s = window.marxySelection.getSelectionState().selection;
  return { kind: s.kind, range: s.range ?? null, node: s.node?.type ?? null, hasNode: 'node' in s, painted: document.querySelectorAll('#doc .marxy-selected').length };
});
const bytesNow = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyOpsBoot.handle.openDocument().buffer.bytes));
const paragraph = (page, n) => page.locator('#doc > p').nth(n);

async function actionTitles(page, query) {
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+KeyP`);
  await page.locator('#marxy-palette .marxy-palette-query').fill(query);
  await page.waitForTimeout(150);
  return page.locator('#marxy-palette .marxy-palette-row .marxy-palette-title').allTextContents();
}

const FIVE = 'first\n\nsecond\n\nthird\n\nfourth\n\nfifth\n';

test('Shift+click on the third paragraph after the selected one paints four blocks as one run', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/five.md', FIVE);
    await paragraph(page, 0).click();
    assert.equal((await sel(page)).kind, 'node');
    await paragraph(page, 3).click({ modifiers: ['Shift'] });
    const s = await sel(page);
    assert.equal(s.kind, 'blocks');
    assert.equal(s.painted, 4);
    assert.equal(s.hasNode, false, 'a run carries no node');
    const want = { start: FIVE.indexOf('first'), end: FIVE.indexOf('fourth') + 'fourth'.length };
    assert.equal(s.range.start, want.start);
    assert.equal(s.range.end, want.end, 'first.start to last.end, byte for byte');
    assert.equal(await page.evaluate(() => window.getSelection().isCollapsed), true, 'no native text selection rides along');
    // Shift+click inside the run changes nothing; past it grows it; on the first block the run is unchanged.
    await paragraph(page, 2).click({ modifiers: ['Shift'] });
    assert.equal((await sel(page)).painted, 4);
    await paragraph(page, 4).click({ modifiers: ['Shift'] });
    assert.equal((await sel(page)).painted, 5);
    await page.keyboard.press('Escape');
    const none = await sel(page);
    assert.equal(none.kind, 'none');
    assert.equal(none.painted, 0);
  } finally {
    await browser.close();
  }
});

test('Shift+click with nothing selected does not start a run', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/five.md', FIVE);
    await paragraph(page, 3).click({ modifiers: ['Shift'] });
    assert.notEqual((await sel(page)).kind, 'blocks');
  } finally {
    await browser.close();
  }
});

test('Alt+Shift+Down grows the run by one sibling; Alt+Down and Alt+Up collapse it to its last and first block; Alt+Shift+Up still selects the parent', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/five.md', FIVE);
    await paragraph(page, 1).click();
    await page.keyboard.press('Alt+Shift+ArrowDown');
    let s = await sel(page);
    assert.equal(s.kind, 'blocks');
    assert.equal(s.painted, 2);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    assert.equal((await sel(page)).painted, 3);
    assert.equal((await sel(page)).range.end, FIVE.indexOf('fourth') + 'fourth'.length);
    await page.keyboard.press('Alt+ArrowDown');
    s = await sel(page);
    assert.equal(s.kind, 'node');
    assert.equal(s.painted, 1);
    assert.equal(await page.evaluate(() => document.querySelector('#doc .marxy-selected').textContent), 'fourth');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal(await page.evaluate(() => document.querySelector('#doc .marxy-selected').textContent), 'fourth');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    assert.equal((await sel(page)).painted, 2, 'at the last block there is nothing to add');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    assert.equal((await sel(page)).kind, 'blocks', 'select-parent does nothing to a run');
  } finally {
    await browser.close();
  }
});

test('Shift+click on a list item extends to the enclosing list, not across the container', async () => {
  const text = 'intro\n\n- one\n- two\n- three\n\noutro\n';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/list.md', text);
    await paragraph(page, 0).click();
    await page.locator('#doc li').nth(1).click({ modifiers: ['Shift'], position: { x: 40, y: 5 } });
    const s = await sel(page);
    assert.equal(s.kind, 'blocks');
    assert.equal(s.painted, 2, 'the paragraph and the whole list');
    assert.equal(s.range.end, text.indexOf('- three') + '- three'.length);
    assert.equal(await page.locator('#doc li.marxy-selected').count(), 0);
    // From inside the list, a click on the top-level paragraph is outside the container: ignored.
    await page.keyboard.press('Escape');
    await page.locator('#doc li').nth(0).click({ position: { x: 40, y: 5 } });
    assert.equal((await sel(page)).node, 'listItem');
    await page.locator('#doc > p').nth(1).click({ modifiers: ['Shift'] });
    const after = await sel(page);
    assert.equal(after.kind, 'node');
    assert.equal(after.node, 'listItem');
  } finally {
    await browser.close();
  }
});

const DUPES = 'alpha\nbeta\nalpha\n\ngamma\nbeta\n\n- one\n- two\n- one\n\n```\nx\nx\n```\n';

async function selectFirstThree(page) {
  await paragraph(page, 0).click();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  assert.equal((await sel(page)).kind, 'blocks');
}

for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`Dedupe lines over a run of two paragraphs and a list removes exactly the repeats, in one undo step (${label})`, async () => {
    const source = DUPES.replace(/\n/g, eol);
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await bootText(page, '/dupes.md', source);
      await selectFirstThree(page);
      const titles = await actionTitles(page, '> dedupe');
      assert.ok(titles.includes('Dedupe lines'), titles.join(' | '));
      await page.locator('#marxy-palette .marxy-palette-row', { hasText: 'Dedupe lines' }).click();
      await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
      const expected = ['alpha', 'beta', '', 'gamma', '', '- one', '- two', '', '```', 'x', 'x', '```', ''].join(eol);
      assert.equal(await bytesNow(page), expected, 'the repeats are gone, the fence untouched, every ending as it was');
      // Whatever the page now paints is a run that exists, or nothing.
      const s = await sel(page);
      if (s.kind === 'none') assert.equal(s.painted, 0);
      else assert.equal(s.painted, await page.evaluate(() => [...document.querySelectorAll('#doc .marxy-selected')].filter((e) => e.isConnected).length));
      await page.evaluate(() => window.marxyHarnessUndo());
      assert.equal(await bytesNow(page), source, 'one undo restores every byte');
      assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false);
    } finally {
      await browser.close();
    }
  });
}

test('Dedupe lines is offered for a run and not for a single block, and not for a run that includes a fence', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/dupes.md', DUPES);
    await paragraph(page, 0).click();
    assert.ok(!(await actionTitles(page, '> dedupe')).includes('Dedupe lines'), 'one block');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await selectFirstThree(page);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    const s = await sel(page);
    assert.equal(s.painted, 4, 'the run now reaches the fence');
    assert.ok(!(await actionTitles(page, '> dedupe')).includes('Dedupe lines'), 'a run with a fence');
  } finally {
    await browser.close();
  }
});

test('a re-render with the same bytes keeps the run painted; a document that no longer holds it clears it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootText(page, '/five.md', FIVE);
    await paragraph(page, 0).click();
    await paragraph(page, 2).click({ modifiers: ['Shift'] });
    assert.equal((await sel(page)).painted, 3);
    await page.evaluate(() => window.marxySelection.rerenderWithSameHtml());
    const s = await sel(page);
    assert.equal(s.kind, 'blocks');
    assert.equal(s.painted, 3, 'the fresh elements carry the mark');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#doc .marxy-selected')].every((e) => e.isConnected)), true);
    // Another writer changes the first paragraph: the run's first end is gone from the page.
    await page.evaluate(async () => {
      const shell = window.__marxyOpsBoot.handle.shell;
      const next = new TextEncoder().encode('changed first\n\nsecond\n\nthird\n\nfourth\n\nfifth\n');
      await shell.writeFileAtomic('/five.md', next);
      shell.emit([{ kind: 'modified', path: '/five.md' }]);
    });
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('changed first'));
    const gone = await sel(page);
    assert.equal(gone.painted, gone.kind === 'blocks' ? 3 : 0, 'a run on the new page, or nothing: never a stale mark');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#doc .marxy-selected')].every((e) => e.isConnected)), true);
  } finally {
    await browser.close();
  }
});
