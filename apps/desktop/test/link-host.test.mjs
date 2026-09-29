// Link host labels: destination on focus only, chrome at rest (MARXY-236).
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
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-link-host-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function boot(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
  }, { files, argv });
}

test('link destination label appears on focus only', async () => {
  const docPath = '/corpus/29-hidden-characters.md';
  const files = { [docPath]: b64(join(corpusDir, '29-hidden-characters.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await page.waitForSelector('a .marxy-link-dest', { state: 'attached' });
    const atRest = await page.evaluate(() => {
      const dest = document.querySelector('a .marxy-link-dest');
      if (!dest) return null;
      return getComputedStyle(dest).display;
    });
    assert.equal(atRest, 'none');
    await page.focus('a[href*="b.com"]');
    const focused = await page.evaluate(() => {
      const dest = document.querySelector('a[href*="b.com"] .marxy-link-dest');
      return dest ? getComputedStyle(dest).display : null;
    });
    assert.notEqual(focused, 'none');
  } finally {
    await browser.close();
  }
});

test('gate aesthetics chrome-at-rest: destination labels are not visible without focus', async () => {
  const docPath = '/corpus/29-hidden-characters.md';
  const files = { [docPath]: b64(join(corpusDir, '29-hidden-characters.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await page.waitForSelector('#doc');
    const chrome = await page.evaluate(() => {
      const dests = [...document.querySelectorAll('.marxy-link-dest')];
      const visible = dests.filter((el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      return { total: dests.length, visible: visible.length };
    });
    assert.ok(chrome.total > 0);
    assert.equal(chrome.visible, 0);
  } finally {
    await browser.close();
  }
});
