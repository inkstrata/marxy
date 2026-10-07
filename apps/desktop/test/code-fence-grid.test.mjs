// A code fence the app splits into one span per source line (`span.marxy-line`, highlight.ts) keeps
// every block after it on the grid (B-02.1). The line spans arrive after the grid pass has run, and a
// wrapped diff line hangs past its marker, so the fence can change height after it was padded; the
// fence is in the real app here (B-01's gate entry), not a copy of it. Playwright WebKit only.
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
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const desktop = fileURLToPath(new URL('..', import.meta.url));
const corpus = fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url));
const fences = readFileSync(join(corpus, '28-artifact-fences.md'), 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-code-fence-grid-'));
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
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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

/**
 * Renders through the app and, the moment the render resolves, returns the aesthetics gate's grid check (scripts/gate-aesthetics.mjs `checkGrid`, the same
 * remainder test) with what the fences look like.
 */
async function render(opts) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    // Measured the moment the render resolves, as the aesthetics gate measures it.
    return await page.evaluate(async ({ source, opts }) => {
      await window.marxyGate.render(source, opts);
      const article = document.getElementById('doc');
      const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
      const origin = article.getBoundingClientRect().top;
      const off = [];
      for (const el of article.querySelectorAll('[data-marxy-s]')) {
        const display = getComputedStyle(el).display;
        if (!['block', 'table', 'list-item', 'flow-root'].includes(display)) continue;
        const top = el.getBoundingClientRect().top - origin;
        const r = ((top % unit) + unit) % unit;
        if (r > 0.5 && r < unit - 0.5) off.push(`<${el.tagName.toLowerCase()}> top ${top.toFixed(2)} (unit ${unit})`);
      }
      const pres = [...article.querySelectorAll(':scope > pre')];
      return {
        unit,
        off,
        lineSpans: article.querySelectorAll('pre span.marxy-line').length,
        preHeights: pres.map((p) => p.getBoundingClientRect().height),
        unsplit: [...article.querySelectorAll('pre > code')].filter((c) => c.dataset.marxyDone === undefined).length,
      };
    }, { source: fences, opts });
  } finally {
    await page.close();
  }
}

for (const size of [16, 20]) {
  for (const variant of ['dark', 'light']) {
    test(`28-artifact-fences at 960 ${variant} ${size}: every block starts on the grid with line-split fences`, async () => {
      const r = await render({ variant, width: 960, size });
      assert.ok(r.lineSpans > 0, 'the fences were split into line spans, as the reader sees them');
      assert.equal(r.unsplit, 0, 'every fence was split before the render resolved');
      assert.deepEqual(r.off, [], `blocks off the grid: ${r.off.join(', ')}`);
      for (const h of r.preHeights) {
        const rem = ((h % r.unit) + r.unit) % r.unit;
        assert.ok(rem <= 0.5 || r.unit - rem <= 0.5, `a fence is ${h} px, not a whole number of ${r.unit} px units`);
      }
    });
  }
}
