// MARXY-28 acceptance: KaTeX deferred until math, display blocks on the grid, inline baseline (Playwright + bundle).
// @ts-nocheck
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = join(new URL('../../../../', import.meta.url).pathname);
const readmeFixture = readFileSync(join(repoRoot, 'fixtures/corpus/02-readme-real-world.md'));
const mathFixture = readFileSync(join(repoRoot, 'fixtures/corpus/06-math.md'));

function buildDesktop(outDir: string): void {
  execFileSync(
    'pnpm',
    ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'silent'],
    { cwd: join(repoRoot, 'apps/desktop'), stdio: 'pipe' },
  );
}

async function withBuiltApp(run) {
  const outDir = mkdtempSync(join(tmpdir(), 'marxy-math-ac-'));
  buildDesktop(outDir);
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    return await run({ base, outDir });
  } finally {
    server.close();
  }
}

test('MARXY-28: the entry chunk does not statically import katex', async () => {
  await withBuiltApp(({ outDir }) => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const entrySrc = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ''))[0];
    const entry = readFileSync(join(outDir, entrySrc), 'utf8');
    assert.doesNotMatch(entry, /from\s*["']katex["']/);
  });
});

test('MARXY-28: a document without math never requests katex', async () => {
  await withBuiltApp(async ({ base }) => {
    const browser = await launchWebkit();
    try {
      const requests = [];
      const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
      page.on('request', (req) => requests.push(req.url()));
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
      }, { files: { '/docs/README.md': readmeFixture.toString('base64') }, argv: ['/docs/README.md'] });
      assert.ok(!requests.some((u) => /katex/i.test(u)));
    } finally {
      await browser.close();
    }
  });
});

test('MARXY-28: display math blocks occupy whole line boxes after KaTeX', async () => {
  await withBuiltApp(async ({ base }) => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const result = await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
        await document.fonts.ready;
        const article = document.getElementById('doc');
        const lineBox = parseFloat(getComputedStyle(article).lineHeight);
        const unit = lineBox / 2;
        const onGrid = (h) => {
          const r = ((h % unit) + unit) % unit;
          return r <= 0.5 || unit - r <= 0.5;
        };
        const blocks = [...article.querySelectorAll('pre.marxy-math-block')];
        return {
          count: blocks.length,
          rendered: blocks.every((el) => el.querySelector('.katex') !== null),
          onGrid: blocks.map((el) => onGrid(el.getBoundingClientRect().height)),
        };
      }, { files: { '/docs/06-math.md': mathFixture.toString('base64') }, argv: ['/docs/06-math.md'] });
      assert.ok(result.count >= 2);
      assert.ok(result.rendered);
      assert.ok(result.onGrid.every(Boolean));
    } finally {
      await browser.close();
    }
  });
});

test('MARXY-28: inline math baseline within 1 px of surrounding text', async () => {
  await withBuiltApp(async ({ base }) => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const delta = await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
        await document.fonts.ready;
        const p = document.querySelector('#doc p[data-marxy-s="23"]');
        const katex = p?.querySelector('code.marxy-math .katex');
        if (!p || !katex) return null;
        const textNode = [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('Inline'));
        if (!textNode) return null;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, textNode.length);
        return Math.abs(range.getBoundingClientRect().bottom - katex.getBoundingClientRect().bottom);
      }, { files: { '/docs/06-math.md': mathFixture.toString('base64') }, argv: ['/docs/06-math.md'] });
      assert.ok(delta !== null);
      assert.ok(delta <= 1, `baseline delta ${delta}px`);
    } finally {
      await browser.close();
    }
  });
});
