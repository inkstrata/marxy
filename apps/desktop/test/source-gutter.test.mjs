// Source gutter: line numbers, copy fidelity, folding, special chars, ligatures (MARXY-239).
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

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = join(repoRoot, 'apps', 'desktop');
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-gutter-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
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

function b64(file) {
  return readFileSync(file).toString('base64');
}

async function boot(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor') || document.body.dataset.marxyMode === 'source');
}

test('a non-markdown file opens in Source with line numbers and copy omits them', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const rsPath = '/corpus/04-source.rs';
    await boot(page, { [rsPath]: b64(join(corpusDir, '04-source.rs')) }, [rsPath]);
    const beforeToggle = await page.evaluate(() => ({
      hasLineNumbers: Boolean(document.querySelector('.cm-lineNumbers')),
      gutterCells: document.querySelectorAll('.cm-gutterElement').length,
      ligatures: getComputedStyle(document.querySelector('.cm-content')).fontVariantLigatures,
      hasFolding: Boolean(document.querySelector('.cm-foldGutter')),
      hasSpecial: document.querySelector('.cm-specialChar') !== null || document.querySelector('.cm-content')?.innerHTML.includes('cm-special'),
    }));
    assert.ok(beforeToggle.hasLineNumbers || beforeToggle.gutterCells > 0, 'expected a line-number gutter');
    assert.equal(beforeToggle.ligatures, 'none');
    assert.equal(beforeToggle.hasFolding, true);
    await page.click('.cm-content');
    await page.keyboard.press('Meta+A');
    const copied = await page.evaluate(async () => {
      const text = document.querySelector('.cm-content').textContent ?? '';
      await navigator.clipboard.writeText(text.slice(0, 80));
      return text;
    });
    assert.ok(!/^\s*\d+\s/m.test(copied), 'pasted text must not start lines with gutter numbers');
    const afterToggle = await page.evaluate(async () => {
      await window.marxyRunCommand?.('view.toggle-line-numbers');
      await new Promise((r) => setTimeout(r, 200));
      return Boolean(document.querySelector('.cm-lineNumbers'));
    });
    assert.equal(afterToggle, false);
  } finally {
    await browser.close();
  }
});

test('codeFolding placeholder, highlightSpecialChars, and ligatures none in the editor', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const path = '/src/tab.rs';
    const body = 'fn main() {\n\tprintln!("hi\u0007");\n}\n';
    await boot(page, { [path]: Buffer.from(body).toString('base64') }, [path]);
    const seen = await page.evaluate(() => ({
      ligatures: getComputedStyle(document.querySelector('.cm-content')).fontVariantLigatures,
      foldGutter: Boolean(document.querySelector('.cm-foldGutter')),
      specialChar: Boolean(document.querySelector('.cm-specialChar')),
    }));
    assert.equal(seen.ligatures, 'none');
    assert.equal(seen.foldGutter, true);
    assert.equal(seen.specialChar, true);
  } finally {
    await browser.close();
  }
});
