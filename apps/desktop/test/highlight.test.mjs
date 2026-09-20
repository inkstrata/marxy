// Code highlighting post-pass and theme mapping (MARXY-164).
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-highlight-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png' };
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

async function waitForHighlight(page) {
  await page.waitForFunction(() => document.querySelector('code[data-marxy-done="highlight"] .marxy-tok-keyword, code[data-marxy-done="highlight"] .marxy-tok-string'), { timeout: 15_000 });
}

test('highlight.ts builds trusted DOM only (no innerHTML on code)', () => {
  const src = readFileSync(new URL('../src/render/highlight.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /replaceChildren/);
});

test('03-ai-plan.md fences gain per-scope coloured spans after idle highlight', async () => {
  const docPath = '/corpus/03-ai-plan.md';
  const files = { [docPath]: b64(join(corpusDir, '03-ai-plan.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await waitForHighlight(page);
    const sample = await page.evaluate(() => {
      const code = document.querySelector('code.language-json');
      if (!code) return null;
      const span = code.querySelector('.marxy-tok-string, .marxy-tok-keyword, .marxy-tok-punctuation');
      if (!span) return null;
      const color = getComputedStyle(span).color;
      const base = getComputedStyle(code).color;
      return { className: span.className, colored: color !== base && color !== 'rgba(0, 0, 0, 0)' && color !== '' };
    });
    assert.ok(sample, 'expected a highlighted json fence in 03-ai-plan.md');
    assert.ok(sample.colored, `span ${sample.className} should resolve to a theme token colour`);
  } finally {
    await browser.close();
  }
});

test('unknown language leaves the DOM untouched', async () => {
  const docPath = '/fortran.md';
  const files = { [docPath]: Buffer.from('```fortran\nPROGRAM test\nEND\n```', 'utf8').toString('base64') };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    await page.waitForFunction(() => {
      const code = document.querySelector('code.language-fortran');
      return code?.textContent?.includes('PROGRAM');
    });
    await page.evaluate(() => new Promise((resolve) => {
      const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 0));
      idle(resolve);
    }));
    const state = await page.evaluate(() => {
      const code = document.querySelector('code.language-fortran');
      return {
        spans: document.querySelectorAll('.marxy-tok-keyword, .marxy-tok-string').length,
        done: code?.dataset.marxyDone ?? null,
        text: code?.textContent ?? '',
      };
    });
    assert.equal(state.spans, 0);
    assert.notEqual(state.done, 'highlight');
    assert.match(state.text, /PROGRAM test/);
  } finally {
    await browser.close();
  }
});

test('highlighted pre blocks do not scroll horizontally at 68ch', async () => {
  const docPath = '/corpus/03-ai-plan.md';
  const files = { [docPath]: b64(join(corpusDir, '03-ai-plan.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await waitForHighlight(page);
    const bad = await page.evaluate(() => {
      const article = document.getElementById('doc');
      if (article) article.style.maxWidth = '68ch';
      return [...document.querySelectorAll('pre')].filter((pre) => pre.scrollWidth > pre.clientWidth + 1).length;
    });
    assert.equal(bad, 0, 'expected no horizontal scrollbar on highlighted pre blocks');
  } finally {
    await browser.close();
  }
});
