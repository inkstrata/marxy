// A document nested too deep to draw is shown as its source, with a notice, not as a blank page (F-54).
// The hunt's 508-quote tower and a 12,000-level list open through the app's own path (startApp + the memory
// shell + the mounted palette in Playwright WebKit), and a shallow tower beside them stays markup.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-deep-nesting-'));
let server;
let base;

const bytes = (text) => Buffer.from(text, 'utf8');
const tower = `${'> '.repeat(508)}word\n`;
const listTower = `${'- '.repeat(12000)}word\n`;
const shallow = `${'> '.repeat(5)}word\n`;
const files = {
  '/r/A.md': bytes('# Alpha\n\nA short opening document.\n').toString('base64'),
  '/r/tower.md': bytes(tower).toString('base64'),
  '/r/list.md': bytes(listTower).toString('base64'),
  '/r/shallow.md': bytes(shallow).toString('base64'),
};

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
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
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

/** Boots A with the palette mounted and B in the palette's index; the handle is `window.__h`. */
async function withApp(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files }) => {
      const { handle } = await window.marxyPaletteBoot.start(files, ['/r/A.md'], []);
      window.__h = handle;
    }, { files });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}


/** What the reader sees after opening `path`: the page's text, its shape, and the notices. */
async function seenAfterOpening(page, path) {
  return page.evaluate(async (path) => {
    await window.__h.open(path);
    const doc = document.getElementById('doc');
    const box = doc.querySelector('pre')?.getBoundingClientRect();
    return {
      text: doc.textContent ?? '',
      pre: doc.querySelectorAll('pre').length,
      quotes: doc.querySelectorAll('blockquote').length,
      boxHeight: box?.height ?? 0,
      boxLeft: box?.left ?? 0,
      notices: [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].map((el) => el.textContent ?? ''),
    };
  }, path);
}

test('the hunt\'s 508-quote tower shows its text in a <pre> and says why', () =>
  withApp(async (page) => {
    const seen = await seenAfterOpening(page, '/r/tower.md');
    assert.equal(seen.quotes, 0, 'no quote is drawn');
    assert.equal(seen.pre, 1);
    assert.ok(seen.text.includes('word'), `the text is on the page: ${JSON.stringify(seen.text.slice(0, 40))}`);
    assert.ok(seen.boxHeight > 0, 'the source has a box');
    assert.ok(seen.boxLeft < 960, 'and it starts on the page');
    // The notice says what happened, what is unchanged, and what to do (rulings-x21 Q10).
    assert.ok(seen.notices.some((t) => /nested too deeply.*The file is unchanged.*edit in Source/.test(t)), JSON.stringify(seen.notices));
  }));

test('a 12,000-level list opens to its source and the notice, quickly', () =>
  withApp(async (page) => {
    const started = Date.now();
    const seen = await seenAfterOpening(page, '/r/list.md');
    assert.ok(seen.text.includes('word'));
    assert.equal(seen.pre, 1);
    assert.ok(seen.notices.some((t) => /nested too deeply/.test(t)), JSON.stringify(seen.notices));
    assert.ok(Date.now() - started < 8000, `opened in ${Date.now() - started} ms`);
  }));

test('a shallow tower is still drawn as quotes, with no such notice', () =>
  withApp(async (page) => {
    const seen = await seenAfterOpening(page, '/r/shallow.md');
    assert.equal(seen.quotes, 5);
    assert.equal(seen.pre, 0);
    assert.deepEqual(seen.notices.filter((t) => /nested too deeply/.test(t)), []);
  }));
