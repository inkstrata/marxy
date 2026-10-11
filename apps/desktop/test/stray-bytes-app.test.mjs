// Bytes that are not UTF-8 in the running app (F-34.1, commitment 3 and 4): Source marks each one, two edits around
// them write exactly those bytes back, and no lone surrogate (the editor's code unit for such a byte) reaches the page
// outside the editor's own text or the clipboard through Copy as. Palette harness (memory shell), WebKit.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-stray-bytes-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
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

/** The file, as Latin-1 so each character is one byte: E9, FF and a cut-off E2 82 are not UTF-8. */
const FILE = '# Caf\xE9\n\nfirst line\n\nmiddle \xFF here\n\nlast \xE2\x82 line\n';
const PATH = '/doc/stray.md';

async function open(page) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files: { [PATH]: Buffer.from(FILE, 'latin1').toString('base64') }, argv: [PATH] });
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
}
const mod = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const latin = (page) => page.evaluate(() => String.fromCharCode(...window.__boot.handle.openDocument().buffer.bytes));
/** Whether any lone surrogate is in the page's text, or in any attribute value. */
const pageHasLone = (page) =>
  page.evaluate(() => {
    const lone = /[\uD800-\uDFFF]/u;
    if (lone.test(document.documentElement.textContent ?? '')) return 'text';
    for (const el of document.querySelectorAll('*')) for (const a of el.attributes) if (lone.test(a.value)) return `${el.tagName} ${a.name}`;
    return false;
  });

test('Source marks each stray byte, two edits around them keep every one, and no lone surrogate reaches the page', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await open(page);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    assert.equal(await pageHasLone(page), false, 'Rendered');
    assert.ok((await page.locator('#doc').textContent()).includes('\uFFFD'), 'Rendered shows U+FFFD for a stray byte');

    await page.click('#doc p');
    await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
    await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    const markers = await page.locator('#marxy-source .marxy-stray-byte').allTextContents();
    assert.deepEqual(markers, ['E9', 'FF', 'E2', '82']);
    assert.equal(await pageHasLone(page), false, 'Source');

    // Two edits, one either side of every stray byte: the start of "first line" and the end of the file's last line.
    await page.locator('#marxy-source .cm-line').nth(2).click();
    await page.keyboard.press('Home');
    await page.keyboard.type('A ');
    await page.locator('#marxy-source .cm-line').nth(6).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Z');
    await page.keyboard.press(`${await mod(page)}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
    assert.equal(await latin(page), '# Caf\xE9\n\nA first line\n\nmiddle \xFF here\n\nlast \xE2\x82 line Z\n');
    assert.equal(await pageHasLone(page), false, 'Rendered after the fold');
  } finally {
    await browser.close();
  }
});

// The shell writes UTF-8, which has no lone surrogate (an encoder writes EF BF BD for one), so the check is on what a
// target makes of the text first: the JSON string target would spell one out as \udce9.
test('Copy as from Source writes U+FFFD for a stray byte, never a lone surrogate or its escape', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await open(page);
    await page.click('#doc p');
    await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
    await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    await page.locator('#marxy-source .cm-content').click();
    await page.mouse.move(400, 300);
    await page.keyboard.press(`${await mod(page)}+Shift+KeyC`);
    await page.waitForSelector('.marxy-verb-menu');
    for (const id of ['markdown', 'json-string', 'rich']) {
      if (!(await page.locator('.marxy-verb-menu').count())) {
        await page.keyboard.press(`${await mod(page)}+Shift+KeyC`);
        await page.waitForSelector('.marxy-verb-menu');
      }
      await page.locator(`.marxy-verb-menu [data-row-key="copy-as.${id}"]`).click();
      await page.waitForSelector('.marxy-verb-menu', { state: 'detached' });
    }
    const written = await page.evaluate(() => {
      const dec = new TextDecoder();
      return window.__boot.handle.shell.calls
        .filter((c) => c.method === 'clipboardWriteItem' || c.method === 'clipboardWrite')
        .flatMap((c) => (c.method === 'clipboardWriteItem' ? c.args[0].map((r) => dec.decode(r.bytes)) : [String(c.args[0])]));
    });
    assert.ok(written.length >= 3, `three copies were written (${written.length})`);
    for (const text of written) {
      assert.ok(!/[\uD800-\uDFFF]/u.test(text), `no lone surrogate on the clipboard: ${JSON.stringify(text.slice(0, 80))}`);
      assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(text), `no surrogate escape on the clipboard: ${JSON.stringify(text.slice(0, 80))}`);
    }
    assert.ok(written[0].includes('Caf\uFFFD'), 'Markdown carries U+FFFD for the byte');
    assert.ok(written[1].includes('Caf\uFFFD'), 'so does the JSON string');
  } finally {
    await browser.close();
  }
});
