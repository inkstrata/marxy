// F-24: a file whose only line endings are CR shows its lines in Source, and no byte moves.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-cr-source-'));
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

const CR = 'alpha one\rbravo two\rcharlie three\rdelta four\r';
const MIXED = 'alpha one\r\nbravo two\rcharlie three\ndelta four\r\n';

async function open(page, text, path) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files: { [path]: Buffer.from(text, 'latin1').toString('base64') }, argv: [path] });
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
}
const bytesOf = (page) => page.evaluate(() => Buffer_(window.__boot.handle.openDocument().buffer.bytes));
async function toSource(page) {
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  await page.click('#doc p');
  await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
  await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
}
async function leave(page) {
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+e`);
}
async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    await fn(await browser.newPage({ viewport: { width: 960, height: 900 } }));
  } finally {
    await browser.close();
  }
}
const latin = (page) =>
  page.evaluate(() => String.fromCharCode(...window.__boot.handle.openDocument().buffer.bytes));

test('a CR-only file shows one Source line per CR and a typed-then-erased edit leaves every byte', () =>
  withPage(async (page) => {
    await open(page, CR, '/doc/mac.md');
    await toSource(page);
    assert.equal(await page.locator('#marxy-source .cm-line').count(), 5, 'four lines and the empty one after the last CR');
    await page.locator('#marxy-source .cm-line').nth(1).click();
    await page.keyboard.type('Z');
    await page.keyboard.press('Backspace');
    await leave(page);
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
    assert.equal(await latin(page), CR);
  }));

test('an edit in a CR-only file changes only the typed byte', () =>
  withPage(async (page) => {
    await open(page, CR, '/doc/mac.md');
    await toSource(page);
    await page.locator('#marxy-source .cm-line').nth(2).click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Z');
    await leave(page);
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
    const want = 'alpha one\rbravo two\rZcharlie three\rdelta four\r';
    assert.equal(await latin(page), want);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+s`);
    await page.waitForFunction(() => window.__boot.handle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === '/doc/mac.md'));
    const written = await page.evaluate(() => String.fromCharCode(...window.__boot.handle.shell.calls.find((c) => c.method === 'writeFileAtomic' && c.args[0] === '/doc/mac.md').args[1]));
    assert.equal(written, want);
  }));

test('Jump to source on a CR-only Markdown file brings the clicked late paragraph into view', () =>
  withPage(async (page) => {
    const md = Array.from({ length: 80 }, (_, i) => `paragraph number ${i}`).join('\r\r') + '\r';
    await open(page, md, '/doc/mac.md');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    const target = page.locator('#doc p', { hasText: 'paragraph number 70' });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
    await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    const line = page.locator('#marxy-source .cm-line', { hasText: /^paragraph number 70$/ });
    await line.first().waitFor({ state: 'attached', timeout: 5000 });
    const inView = await line.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    assert.ok(inView, 'the clicked paragraph is a visible Source line');
  }));

test('a mixed-ending file keeps its bytes: CRLF lines split, a lone CR stays a mark inside its line', () =>
  withPage(async (page) => {
    await open(page, MIXED, '/doc/mixed.md');
    await toSource(page);
    await page.locator('#marxy-source .cm-line').nth(0).click();
    await page.keyboard.type('Z');
    await page.keyboard.press('Backspace');
    await leave(page);
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
    assert.equal(await latin(page), MIXED);
  }));
