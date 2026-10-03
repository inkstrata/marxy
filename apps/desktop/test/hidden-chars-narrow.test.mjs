// A hidden-character line inside a 320 px window (B-02.3): fixtures/corpus/29-hidden-characters.md,
// rendered through the real app's gate entry at 320 px (the aesthetics gate's 320 px and 400 % zoom
// reflow modes, WCAG 1.4.10: 400 % of a 1280 px window is 320 CSS px), has no horizontal scroll and
// no line the typesetter set runs past the article. Playwright WebKit only.
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
const hidden = readFileSync(join(corpus, '29-hidden-characters.md'), 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-hidden-narrow-'));
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

/**
 * One fresh page at the gate's reflow viewport. After the render resolves, waits until the deferred
 * post-passes (highlight, invisible-character markers) have run, as a reader's page would have.
 */
async function renderNarrow(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    await page.evaluate(async ({ source, width }) => {
      await window.marxyGate.render(source, { variant: 'dark', width, size: 20 });
    }, { source: hidden, width });
    await page.waitForFunction(() => window.marxyGate.calls().some((c) => c.method === 'mark' && c.args[0] === 'highlight_ms'));
    // Let any relayout the markers asked for finish and paint.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return await page.evaluate(() => {
      const root = document.documentElement;
      const article = document.getElementById('doc');
      const box = article.getBoundingClientRect();
      const lb = [...article.querySelectorAll('span.marxy-lb')].map((s) => s.getBoundingClientRect().right);
      const markers = article.querySelectorAll('p .marxy-invisible').length;
      const set = article.querySelectorAll('p.marxy-set').length;
      const lines = [];
      for (const p of article.querySelectorAll('p.marxy-set')) {
        const range = document.createRange();
        range.selectNodeContents(p);
        for (const r of range.getClientRects()) if (r.width > 0) lines.push(r.right);
      }
      return {
        scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        clientWidth: root.clientWidth,
        articleRight: box.right,
        lbRight: lb.length ? Math.max(...lb) : 0,
        textRight: lines.length ? Math.max(...lines) : 0,
        markers,
        set,
      };
    });
  } finally {
    await page.close();
  }
}

for (const mode of ['320px', '400% zoom']) {
  test(`29-hidden-characters at ${mode} dark has no horizontal scroll and no set line past the article`, async () => {
    const r = await renderNarrow(320);
    console.log(`# 29-hidden-characters ${mode}: ${JSON.stringify(r)}`);
    assert.ok(r.markers > 0, 'the paragraphs carry invisible-character markers');
    assert.ok(r.set > 0, 'the typesetter set some paragraphs');
    assert.ok(r.scrollWidth <= 320, `horizontal scroll ${r.scrollWidth}px > 320px viewport`);
    assert.ok(r.lbRight <= r.articleRight + 0.5, `a line break ends at ${r.lbRight}px, past the article's ${r.articleRight}px`);
    assert.ok(r.textRight <= r.articleRight + 0.5, `a set line ends at ${r.textRight}px, past the article's ${r.articleRight}px`);
  });
}
