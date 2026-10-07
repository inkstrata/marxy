// B-02.6: a display math block must end a whole number of grid units tall, and the same on every render.
// WebKit kept a stale height for `pre.marxy-math-block` (inline <code> around a block-level
// .katex-display); only a fresh layout, forced here by a screenshot, shows the real one.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);

const desktop = fileURLToPath(new URL('..', import.meta.url));
const corpus = fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url));
const math = readFileSync(join(corpus, '06-math.md'), 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-gate-entry-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({
    root: desktop,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { gate: join(desktop, 'gate.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}gate.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const readBlocks = (page) => page.evaluate(() => {
  const doc = document.getElementById('doc');
  const lb = parseFloat(getComputedStyle(doc).getPropertyValue('--marxy-line-box'))
    || parseFloat(getComputedStyle(doc.querySelector('p')).lineHeight);
  return { lb, hs: [...doc.querySelectorAll('pre.marxy-math-block')].map((b) => b.getBoundingClientRect().height) };
});

async function renderOnce(variant) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    await page.evaluate(async ({ source, opts }) => {
      await window.marxyGate.render(source, opts);
    }, { source: math, opts: { variant, width: 960, size: 20 } });
    // The gate scrolls to the last screen before it photographs; the block is re-gridded on the way.
    await page.evaluate(async () => {
      scrollTo(0, document.documentElement.scrollHeight);
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    // A screenshot forces a fresh layout, which is what a reader's next full relayout does.
    await page.screenshot();
    return await readBlocks(page);
  } finally {
    await page.close();
  }
}

const near = (a, b) => Math.abs(a - b) < 0.01;

for (const variant of ['dark', 'light']) {
  test(`06-math at 960/20 ${variant}: display blocks are whole grid units after a fresh layout, on every render`, async () => {
    // Four pages at once, as the gate runs them: contention is what lets the stale read show.
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(...await Promise.all([1, 2, 3, 4].map(() => renderOnce(variant))));
    for (const [i, r] of runs.entries()) {
      assert.ok(r.hs.length >= 2, 'both display blocks rendered');
      for (const h of r.hs) {
        const u = h / (r.lb / 2);
        assert.ok(near(u, Math.round(u)), `render ${i}: block is ${h}px, grid unit ${r.lb / 2}px`);
      }
      assert.deepEqual(r.hs, runs[0].hs, `render ${i} differs from render 0`);
    }
  });
}
