// Jump to source is the same Source as Mod+E (F-03): what the reader types after the jump is saved by
// Mod-S, counts as unsaved for the close guard, survives a round trip through Rendered and is undoable.
// Before F-03 the jump toggled the DOM on its own, the app stayed in Rendered, and the text was lost.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-jump-edits-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
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
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const PATH = '/doc/j.md';
const TEXT = '# Title\n\nParagraph one.\n\nParagraph two.\n';
const TYPED = ' TYPED';
/** The original with exactly the one edit: TYPED at the end of the paragraph the jump landed on. */
const EDITED = TEXT.replace('Paragraph one.', `Paragraph one.${TYPED}`);

async function boot() {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ path, b64 }) => {
    window.__b = await window.marxyPaletteBoot.start({ [path]: b64 }, [path], []);
  }, { path: PATH, b64: Buffer.from(TEXT).toString('base64') });
  await page.waitForFunction(() => document.querySelector('#doc p'));
  await page.waitForFunction(() => typeof window.marxyHarnessSave === 'function');
  return page;
}

const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const bufferText = (page) =>
  page.evaluate(() => new TextDecoder().decode(window.__b.handle.openDocument().buffer.bytes));
const sourceText = (page) => page.evaluate(() => document.querySelector('#marxy-source .cm-content')?.innerText ?? '');
const writes = (page) =>
  page.evaluate((p) =>
    window.__b.handle.shell.calls
      .filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p)
      .map((c) => new TextDecoder().decode(new Uint8Array(c.args[1]))), PATH);
const calls = (page, method) =>
  page.evaluate((m) => window.__b.handle.shell.calls.filter((c) => c.method === m).length, method);

/** Click the first paragraph, run Jump to source, put the caret at the end of its line and type. */
async function jumpAndType(page) {
  await page.click('#doc p >> nth=0');
  await page.evaluate(() => window.marxyRunCommand('view.jump-to-source'));
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-content'));
  await page.click('#marxy-source .cm-line:has-text("Paragraph one.")');
  await page.keyboard.press('End');
  await page.keyboard.type(TYPED);
}

test('after Jump to source the app reports Source mode', async () => {
  const page = await boot();
  await page.click('#doc p >> nth=0');
  await page.evaluate(() => window.marxyRunCommand('view.jump-to-source'));
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
  assert.equal(await page.evaluate(() => window.__b.handle.sourceHarness().mode), 'source');
  await page.close();
});

test('Jump to source, type, Mod-S writes the original plus exactly the typed text', async () => {
  const page = await boot();
  await jumpAndType(page);
  await page.keyboard.press(`${await modOf(page)}+s`);
  await page.waitForFunction((p) => window.__b.handle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === p), PATH, { timeout: 3000 })
    .catch(() => {});
  const written = await writes(page);
  assert.equal(written.length, 1, 'Mod-S wrote the document once');
  assert.equal(written[0], EDITED);
  await page.close();
});

test('Jump to source, type: the close guard sees unsaved text', async () => {
  const page = await boot();
  await jumpAndType(page);
  await page.evaluate(() => window.__b.handle.shell.emitCloseRequested());
  assert.equal(await calls(page, 'confirmClose'), 0, 'the close waited for the reader');
  const buttons = await page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].map((b) => b.textContent));
  assert.deepEqual(buttons, ['Save and close', 'Close without saving', 'Dismiss']);
  await page.close();
});

test('Jump to source, type, Mod+E twice keeps the text; Mod+Z undoes it', async () => {
  const page = await boot();
  const mod = await modOf(page);
  await jumpAndType(page);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  assert.equal(await bufferText(page), EDITED, 'leaving Source folded the typed text into the document');
  const title = await page.evaluate(() => window.__b.handle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0]);
  assert.equal(title, 'j.md — marxy •', 'the title shows the unsaved dot');
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
  assert.equal(await bufferText(page), EDITED);
  assert.ok((await sourceText(page)).includes(`Paragraph one.${TYPED}`), 'Source still shows the typed text');
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction((t) => new TextDecoder().decode(window.__b.handle.openDocument().buffer.bytes) === t, TEXT, { timeout: 3000 })
    .catch(() => {});
  assert.equal(await bufferText(page), TEXT, 'Mod+Z took the typed text back out');
  await page.close();
});

test('F-05: a click in one document is not the jump target after another document opens', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ a, b }) => {
    window.__b = await window.marxyPaletteBoot.start({ '/doc/a.md': a, '/doc/b.md': b }, ['/doc/a.md'], []);
  }, { a: Buffer.from(TEXT).toString('base64'), b: Buffer.from('# Other\n').toString('base64') });
  await page.waitForFunction(() => document.querySelector('#doc p'));
  await page.waitForFunction(() => typeof window.marxyRunCommand === 'function');
  await page.click('#doc p >> nth=0');
  await page.evaluate(() => window.__b.handle.open('/doc/b.md'));
  await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent === 'Other');
  await page.evaluate(() => window.marxyRunCommand('view.jump-to-source'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.evaluate(() => document.body.dataset.marxyMode), 'rendered', 'no jump: nothing was clicked in this document');
  await page.close();
});
