// One way a document reaches the page: startApp + the memory shell + the mounted palette in
// Playwright WebKit. Opening through `handle.open`, through the palette UI, many times in a row, onto a
// byte offset and onto a read error all go through the same path, and each is checked here.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from './support/shared-vite.mjs';
import { contentHash } from '@marxy/core';
import { fileURLToPath } from 'node:url';
import { idle, openBrowser } from './support/kit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-open-path-'));
let server;
let base;

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';

const A = `# Alpha\n\n${para('Alpha').repeat(3)}\n`;
const C = `# Charlie\n\n${para('Charlie').repeat(3)}\n`;
const B = [
  '# Bravo',
  '',
  para('The opening').repeat(4),
  '',
  '![x](https://example.com/a.png)',
  '',
  '## First section',
  '',
  para('First').repeat(4),
  '',
  '## Second section',
  '',
  ...Array.from({ length: 40 }, (_, i) => `${para(`Filler ${i} with differing wordiness`).repeat(1 + (i % 4))}\n`),
  '',
  '## Third section',
  '',
  ...Array.from({ length: 12 }, (_, i) => `${para(`Paragraph ${i}`).repeat(3)}\n`),
  '',
].join('\n');

const D = [
  'fn one() {}',
  '',
  ...Array.from({ length: 60 }, (_, i) => `// filler line ${i}, padding the file so a byte offset well past 0 is a real scroll target`),
  '',
  'fn marker_target() {}',
  '',
].join('\n');

const bytes = (text) => Buffer.from(text, 'utf8');
const files = {
  '/r/A.md': bytes(A).toString('base64'),
  '/r/B.md': bytes(B).toString('base64'),
  '/r/C.md': bytes(C).toString('base64'),
  '/r/D.rs': bytes(D).toString('base64'),
};
const markerOffset = bytes(D).indexOf('fn marker_target');
const hashB = contentHash(bytes(B));
const thirdHeading = bytes(B).indexOf('## Third section');
const thirdHeadingEnd = thirdHeading + Buffer.byteLength('## Third section');
const firstHeading = bytes(B).indexOf('## First section');

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
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files }) => {
      const { handle } = await window.marxyPaletteBoot.start(files, ['/r/A.md'], [
        { path: '/r/B.md', root: '/r', title: 'Bravo', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' },
      ]);
      window.__h = handle;
    }, { files });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

async function sourceShowsB(page, mod) {
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
  return page.evaluate(() => ({
    hash: window.__h.sourceHarness()?.bufferHash,
    text: document.querySelector('#marxy-source .cm-content')?.textContent ?? '',
  }));
}

test('handle.open replaces the buffer: Source mode shows B', () =>
  withApp(async (page, mod) => {
    await page.evaluate(() => window.__h.open('/r/B.md'));
    const seen = await sourceShowsB(page, mod);
    assert.equal(seen.hash, hashB);
    assert.ok(seen.text.startsWith('# Bravo'), `Source starts with ${JSON.stringify(seen.text.slice(0, 20))}`);
  }));

test('the palette opens through the same path: buffer, title and the blocked-content notice', () =>
  withApp(async (page, mod) => {
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'bravo');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__h.currentPath() === '/r/B.md');
    await page.evaluate(() => window.__h.open('/r/B.md')); // queued behind the palette's open
    const notice = await page.evaluate(() =>
      [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].map((el) => el.textContent ?? '').join(' '));
    assert.match(notice, /example\.com/);
    assert.match(await page.title(), /B\.md/);
    const seen = await sourceShowsB(page, mod);
    assert.equal(seen.hash, hashB);
    assert.ok(seen.text.startsWith('# Bravo'));
  }));

test('opening A, B, C, A leaves one typesetter and one resize observer', () =>
  withApp(async (page) => {
    const counts = await page.evaluate(async () => {
      for (const path of ['/r/A.md', '/r/B.md', '/r/C.md', '/r/A.md']) await window.__h.open(path);
      return window.__h.debugCounts();
    });
    assert.deepEqual(counts, { typesetters: 1, resizeObservers: 1 });
  }));

test('a read error naming markup is shown as text', () =>
  withApp(async (page) => {
    const seen = await page.evaluate(async () => {
      await window.__h.open('/r/<b>x</b>.md');
      // The failed open is the floor's card in the pane, in place of the article.
      const card = document.querySelector('[data-marxy-failed] .marxy-fcard');
      return {
        text: card?.textContent ?? '',
        bold: document.querySelector('[data-marxy-failed] b, #doc b') !== null,
        path: window.__h.currentPath(),
        counts: window.__h.debugCounts(),
      };
    });
    assert.ok(seen.text.includes('/r/<b>x</b>.md'), seen.text);
    assert.equal(seen.bold, false);
    assert.equal(seen.path, '/r/<b>x</b>.md', 'a failed open names the file it tried, not the last document');
    assert.deepEqual(seen.counts, { typesetters: 0, resizeObservers: 0 });
  }));

test('open with `at` inside B\'s third heading lands on that heading after typesetting', () =>
  withApp(async (page) => {
    await page.evaluate((at) => window.__h.open('/r/B.md', { at }), thirdHeading + 4);
    // Background typesetting and its coalesced grid passes run after open returns.
    await idle(page);
    const at = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    // A narrower column re-breaks every paragraph above the heading; the anchor holds it.
    await page.setViewportSize({ width: 620, height: 760 });
    await idle(page);
    const afterResize = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    assert.ok(afterResize >= thirdHeading && afterResize < thirdHeadingEnd, `after resize: reading offset ${afterResize}`);
    assert.ok(at >= thirdHeading && at < thirdHeadingEnd, `reading offset ${at}, heading ${thirdHeading}-${thirdHeadingEnd}`);
    // The same document again, onto a different offset: moved, not read again.
    const reads = await page.evaluate(async (at) => {
      const before = window.__h.shell.calls.filter((c) => c.method === 'readFile').length;
      await window.__h.open('/r/B.md', { at });
      return window.__h.shell.calls.filter((c) => c.method === 'readFile').length - before;
    }, firstHeading);
    assert.equal(reads, 0);
    assert.equal(await page.evaluate(() => window.__h.sourceHarness().byteOffset), firstHeading);
  }));

test('open with `at` on a code file lands on that line in Read, and Source opens on it, not at byte 0', () =>
  withApp(async (page, mod) => {
    await page.evaluate((at) => window.__h.open('/r/D.rs', { at }), markerOffset);
    await page.waitForSelector('#doc pre code');
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    // Source places itself once its editor has laid out: wait for the place, then say it is the line asked for.
    await page.waitForFunction((at) => window.__h.sourceHarness()?.byteOffset === at, markerOffset, { timeout: 60_000, polling: 'raf' }).catch(() => {});
    assert.equal(await page.evaluate(() => window.__h.sourceHarness()?.byteOffset), markerOffset);
  }));
