// Invisible-character markers in WebKit: bidi isolation and contrast (MARXY-236).
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-invisibles-'));
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

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test('bidi override inside a highlighted span stays in logical order in WebKit', async () => {
  const docPath = '/corpus/29-hidden-characters.md';
  const files = { [docPath]: b64(join(corpusDir, '29-hidden-characters.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await page.waitForSelector('pre .marxy-line .marxy-invisible-bidi, pre [class^="marxy-tok-"] .marxy-invisible-bidi', {
      state: 'attached',
      timeout: 60_000,
    });
    const xs = await page.evaluate(() => {
      const bidi = document.querySelector('pre .marxy-invisible-bidi');
      const line = bidi?.closest('.marxy-line') ?? bidi?.closest('code');
      if (!line) return null;
      const targets = ['ab', 'gnp', 'exe'];
      return targets.map((word) => {
        const tw = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = tw.nextNode())) {
          if (node.parentElement?.closest('.marxy-invisible-glyph')) continue;
          const i = node.textContent?.indexOf(word);
          if (i !== undefined && i >= 0) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + word.length);
            return range.getBoundingClientRect().x;
          }
        }
        return 0;
      });
    });
    assert.ok(xs && xs.length === 3);
    assert.ok(xs[0] < xs[1], `ab before gnp: ${xs}`);
    assert.ok(xs[1] < xs[2], `gnp before exe: ${xs}`);
  } finally {
    await browser.close();
  }
});

test('copying a marked paragraph yields source bytes and omits glyph labels', async () => {
  const docPath = '/corpus/29-hidden-characters.md';
  const files = { [docPath]: b64(join(corpusDir, '29-hidden-characters.md')) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [docPath]);
    await page.waitForSelector('p .marxy-invisible-bidi', { state: 'attached', timeout: 60_000 });
    const copied = await page.evaluate(() => {
      const para = document.querySelector('p .marxy-invisible-bidi')?.closest('p');
      if (!para) return '';
      const skip = new Set(['marxy-invisible-glyph', 'marxy-link-dest', 'marxy-link-host-label']);
      const parts = [];
      const walk = (node) => {
        if (node instanceof Element) {
          for (const cls of node.classList) if (skip.has(cls)) return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent ?? '');
          return;
        }
        for (const child of node.childNodes) walk(child);
      };
      walk(para);
      return parts.join('');
    });
    assert.ok(copied.includes('\u202e'));
    assert.ok(copied.includes('invoice'));
    assert.ok(!copied.includes('202E'));
  } finally {
    await browser.close();
  }
});

test('invisible marker contrast is at least 4.5:1 on code and page grounds', async () => {
  const docPath = '/corpus/29-hidden-characters.md';
  const files = { [docPath]: b64(join(corpusDir, '29-hidden-characters.md')) };
  const browser = await launchWebkit();
  try {
    for (const variant of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await boot(page, files, [docPath, `--variant=${variant}`]);
      await page.waitForFunction(() => document.querySelector('.marxy-invisible-glyph'));
      const ratios = await page.evaluate(() => {
        const glyphs = [...document.querySelectorAll('.marxy-invisible-glyph')];
        const parse = (s) => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
          return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
        };
        const lum = (rgb) => {
          const [r, g, b] = rgb.map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const cr = (fg, bg) => {
          const L1 = lum(fg);
          const L2 = lum(bg);
          const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
          return (hi + 0.05) / (lo + 0.05);
        };
        return glyphs.map((el) => {
          const fg = parse(getComputedStyle(el).color);
          const bg = parse(getComputedStyle(el).backgroundColor);
          return fg && bg ? cr(fg, bg) : 0;
        });
      });
      assert.ok(ratios.length > 0, variant);
      for (const r of ratios) assert.ok(r >= 4.5, `${variant}: contrast ${r}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
