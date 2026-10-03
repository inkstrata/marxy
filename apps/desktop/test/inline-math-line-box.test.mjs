// B-02.2: inline KaTeX must not change the line box. Rendered through the real app (gate.html), so
// KaTeX is loaded; a list item or paragraph holding `\Delta T` stays a whole number of line boxes
// and the block after it lands on the grid unit. Playwright WebKit only.
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
const notebook = readFileSync(join(corpus, '30-notebook-export.md'), 'utf8');
const image = readFileSync(join(corpus, 'image.png'));
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
    const path = pathname === '/image.png' ? join(corpus, 'image.png') : join(outDir, pathname.endsWith('/') ? `${pathname}gate.html` : pathname);
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


async function measure(source, opts) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    return await page.evaluate(async ({ source, opts }) => {
      await window.marxyGate.render(source, opts);
      const doc = document.getElementById('doc');
      const t0 = performance.now();
      while (!doc.querySelector('.katex') && performance.now() - t0 < 10000) await new Promise((r) => requestAnimationFrame(r));
      await document.fonts.ready;
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
      const lb = parseFloat(getComputedStyle(doc).getPropertyValue('--marxy-line-box'))
        || parseFloat(getComputedStyle(doc.querySelector('p')).lineHeight);
      const top0 = doc.getBoundingClientRect().top + scrollY;
      const rows = [...doc.querySelectorAll('li, p')].filter((el) => el.querySelector('.katex')).map((el) => {
        const r = el.getBoundingClientRect();
        const next = el.nextElementSibling ?? el.parentElement.nextElementSibling;
        return { tag: el.tagName, h: r.height, nextTop: next ? next.getBoundingClientRect().top + scrollY - top0 : null, top: r.top + scrollY - top0 };
      });
      return { lb, rows, katex: doc.querySelectorAll('.katex').length };
    }, { source, opts });
  } finally {
    await page.close();
  }
}

const near = (a, b) => Math.abs(a - b) < 0.01;
const list = 'Intro line.\n\n- the noise in $\\Delta T$ has a standard deviation near $0.33$, so a reading cannot show drift;\n- second item.\n\nAfter.\n';
const para = 'We expect $\\Delta T \\approx \\alpha n + \\varepsilon$ over $n$ weeks, and a sd near $0.33$.\n\nAfter.\n';

for (const size of [16, 20, 24]) {
  for (const [name, src] of [['list item', list], ['paragraph', para]]) {
    test(`inline math in a ${name} keeps whole line boxes at size ${size}`, async () => {
      const r = await measure(src, { variant: 'dark', width: 960, size });
      assert.ok(r.katex > 0, 'KaTeX rendered');
      assert.ok(r.rows.length > 0);
      for (const row of r.rows) {
        const lines = row.h / r.lb;
        assert.ok(near(lines, Math.round(lines)), `${row.tag} is ${row.h}px, line box ${r.lb}px`);
      }
    });
  }
}

for (const variant of ['dark', 'light']) {
  test(`30-notebook-export at 960 ${variant}: every block holding inline math is whole line boxes`, async () => {
    const r = await measure(notebook, { variant, width: 960, size: 16 });
    assert.ok(r.katex > 0);
    for (const row of r.rows) {
      const lines = row.h / r.lb;
      assert.ok(near(lines, Math.round(lines)), `${row.tag} at ${row.top} is ${row.h}px, line box ${r.lb}px`);
      if (row.nextTop !== null) {
        const u = (row.nextTop) / (r.lb / 2);
        assert.ok(near(u, Math.round(u)), `next block top ${row.nextTop} is off the grid unit ${r.lb / 2}`);
      }
    }
  });
}
