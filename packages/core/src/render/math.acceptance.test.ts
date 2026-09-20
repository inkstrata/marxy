// MARXY-28 acceptance: KaTeX deferred until math, bundled fonts, display grid, inline baseline + screenshot.
// @ts-nocheck
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';

const webkitMissing =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;
const browserTest = (name, fn) => nodeTest(name, { skip: webkitMissing }, fn);

const repoRoot = join(new URL('../../../../', import.meta.url).pathname);
const readmeFixture = readFileSync(join(repoRoot, 'fixtures/corpus/02-readme-real-world.md'));
const mathFixture = readFileSync(join(repoRoot, 'fixtures/corpus/06-math.md'));
const inlineBaselinePath = join(new URL('.', import.meta.url).pathname, 'math-inline-baseline.png');

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function buildDesktop(outDir) {
  execFileSync(
    'pnpm',
    ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'silent'],
    { cwd: join(repoRoot, 'apps/desktop'), stdio: 'pipe' },
  );
}

async function withBuiltApp(run) {
  const outDir = mkdtempSync(join(tmpdir(), 'marxy-math-ac-'));
  buildDesktop(outDir);
  const types = {
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end();
    }
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

/** Same threshold as gate-aesthetics §10 (MARXY-30 will centralise pixelmatch). */
async function pixelDiffPct(page, expected, actual) {
  return page.evaluate(async ({ a, b }) => {
    const decode = async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const left = await decode(a);
    const right = await decode(b);
    if (left.width !== right.width || left.height !== right.height) {
      return { pct: 100, reason: `size ${left.width}×${left.height} vs ${right.width}×${right.height}` };
    }
    let differ = 0;
    const n = left.data.length / 4;
    for (let i = 0; i < left.data.length; i += 4) {
      const dr = left.data[i] - right.data[i];
      const dg = left.data[i + 1] - right.data[i + 1];
      const db = left.data[i + 2] - right.data[i + 2];
      const da = left.data[i + 3] - right.data[i + 3];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510;
      if (dist > 0.1) differ++;
    }
    return { pct: (differ / n) * 100 };
  }, { a: [...expected], b: [...actual] });
}

nodeTest('MARXY-28: production build bundles KaTeX fonts with hashed URLs', async () => {
  await withBuiltApp(({ outDir }) => {
    const files = listFiles(outDir);
    const katexFonts = files.filter((f) => /KaTeX_.*\.(woff2|woff|ttf)$/.test(f));
    assert.ok(katexFonts.length > 0, 'expected at least one KaTeX font asset in the Vite output');
    const jsChunks = files.filter((f) => f.endsWith('.js'));
    const combined = jsChunks.map((f) => readFileSync(f, 'utf8')).join('\n');
    assert.match(
      combined,
      /new URL\("KaTeX_[^"]+\.(woff2|woff)/,
      'font glob must resolve to Vite-emitted KaTeX font modules, not an empty map',
    );
  });
});

nodeTest('MARXY-28: the entry chunk does not statically import katex', async () => {
  await withBuiltApp(({ outDir }) => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const entrySrc = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ''))[0];
    const entry = readFileSync(join(outDir, entrySrc), 'utf8');
    assert.doesNotMatch(entry, /from\s*["']katex["']/);
  });
});

browserTest('MARXY-28: a document without math never requests katex', async () => {
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

browserTest('MARXY-28: display math blocks occupy whole line boxes after KaTeX', async () => {
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

browserTest('MARXY-28: injected KaTeX CSS rewrites font URLs to bundled assets', async () => {
  await withBuiltApp(async ({ base }) => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const css = await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
        await document.fonts.ready;
        return document.getElementById('marxy-katex')?.textContent ?? '';
      }, { files: { '/docs/06-math.md': mathFixture.toString('base64') }, argv: ['/docs/06-math.md'] });
      assert.ok(css.length > 0, 'KaTeX stylesheet was not injected');
      assert.doesNotMatch(css, /url\(fonts\/KaTeX_[^)]+\)/, 'injected CSS must not keep bare fonts/KaTeX_* paths');
      assert.match(css, /url\([^)]*KaTeX_[^)]+\.(woff2|woff)/, 'injected CSS must reference bundled KaTeX font assets');
    } finally {
      await browser.close();
    }
  });
});

browserTest('MARXY-28: inline math baseline within 1 px of surrounding text', async () => {
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

browserTest('MARXY-28: inline math paragraph matches screenshot baseline', async () => {
  await withBuiltApp(async ({ base }) => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
        await document.fonts.ready;
      }, { files: { '/docs/06-math.md': mathFixture.toString('base64') }, argv: ['/docs/06-math.md'] });
      const paragraph = page.locator('#doc p[data-marxy-s="23"]');
      await paragraph.waitFor({ state: 'visible' });
      const png = await paragraph.screenshot({ type: 'png' });
      if (process.env.MARXY_UPDATE_MATH_INLINE_SHOT === '1') {
        writeFileSync(inlineBaselinePath, png);
        return;
      }
      assert.ok(existsSync(inlineBaselinePath), `missing ${inlineBaselinePath}; run with MARXY_UPDATE_MATH_INLINE_SHOT=1`);
      const expected = readFileSync(inlineBaselinePath);
      const diff = await pixelDiffPct(page, expected, png);
      assert.ok(
        diff.pct <= 0.1,
        `inline math screenshot diff ${diff.pct.toFixed(3)}% pixels differ${diff.reason ? ` (${diff.reason})` : ''}`,
      );
    } finally {
      await browser.close();
    }
  });
});
