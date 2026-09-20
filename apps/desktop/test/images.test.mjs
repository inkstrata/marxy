// Local images, asset scope, notices and layout shift (MARXY-138).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';
import { renderDocumentSafeHtml } from '../../../packages/core/src/render/pipeline.ts';
import { resolveImageSrc } from '../../../packages/core/src/render/images.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-images-'));
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
    return handle;
  }, { files, argv });
}

nodeTest('Rust image_size and allow_asset_scope (cargo test fs)', () => {
  const run = spawnSync('cargo', ['test', '-p', 'marxy', 'commands::fs'], {
    cwd: join(repoRoot, 'apps', 'desktop', 'src-tauri'),
    encoding: 'utf8',
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, 'cargo test commands::fs failed');
});

test('post-pass 3: allowAssetScope once per image root for two images under one root', async () => {
  const docPath = '/corpus/09-gfm-everything.md';
  const files = {
    [docPath]: b64(join(corpusDir, '09-gfm-everything.md')),
    '/corpus/image.png': b64(join(corpusDir, 'image.png')),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const handle = await boot(page, files, [docPath]);
    const scopes = handle.shell.calls.filter((c) => c.method === 'allowAssetScope');
    assert.equal(scopes.length, 1);
  } finally {
    await browser.close();
  }
});

test('post-pass 3: a refused path keeps alt text, drops src, and never calls assetUrl', async () => {
  const source = '![outside](../secret.png)\n';
  const files = { '/docs/readme.md': Buffer.from(source).toString('base64') };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const handle = await boot(page, files, ['/docs/readme.md']);
    const assetCalls = handle.shell.calls.filter((c) => c.method === 'assetUrl');
    assert.equal(assetCalls.length, 0);
    const img = await page.evaluate(() => {
      const el = document.querySelector('#doc img');
      return el ? { alt: el.getAttribute('alt'), src: el.getAttribute('src') } : null;
    });
    assert.equal(img?.alt, 'outside');
    assert.equal(img?.src, null);
  } finally {
    await browser.close();
  }
});

test('post-pass 3: width and height are set before src', async () => {
  const docPath = '/corpus/09-gfm-everything.md';
  const files = {
    [docPath]: b64(join(corpusDir, '09-gfm-everything.md')),
    '/corpus/image.png': b64(join(corpusDir, 'image.png')),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const order = await page.evaluate(() => {
      const img = document.querySelector('#doc img[alt="Image alt"]');
      if (!img || !img.getAttribute('src')) return null;
      return img.getAttribute('data-marxy-width-before-src') === '1';
    });
    assert.equal(order, true);
  } finally {
    await browser.close();
  }
});

test('09-gfm-everything.md: summed layout shift is 0 until decode and naturalWidth > 0', async () => {
  const docPath = '/corpus/09-gfm-everything.md';
  const files = {
    [docPath]: b64(join(corpusDir, '09-gfm-everything.md')),
    '/corpus/image.png': b64(join(corpusDir, 'image.png')),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const result = await page.evaluate(async ({ files, argv }) => {
      const shifts = [];
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) shifts.push(entry.value);
        }
      });
      obs.observe({ type: 'layout-shift', buffered: true });
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      const img = document.querySelector('#doc img[alt="Image alt"]');
      if (!img || !img.getAttribute('src')) return { error: 'no img' };
      await img.decode();
      obs.disconnect();
      const cls = shifts.reduce((a, b) => a + b, 0);
      return { cls, naturalWidth: img.naturalWidth };
    }, { files, argv: [docPath] });
    assert.ok(!result.error, result.error);
    assert.equal(result.cls, 0);
    assert.ok(result.naturalWidth > 0);
  } finally {
    await browser.close();
  }
});

test('10-hostile.md: exactly one notice naming example.invalid once; no host in the article', async () => {
  const docPath = '/corpus/10-hostile.md';
  const files = { [docPath]: b64(join(corpusDir, '10-hostile.md')) };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const out = await page.evaluate(() => {
      const region = document.getElementById('marxy-notices');
      const lines = region ? [...region.querySelectorAll('.marxy-notice-text')].map((el) => el.textContent ?? '') : [];
      const article = document.getElementById('doc')?.textContent ?? '';
      return { lines, article };
    });
    assert.equal(out.lines.length, 1);
    const matches = [...out.lines[0].matchAll(/example\.invalid/g)];
    assert.equal(matches.length, 1);
    assert.doesNotMatch(out.article, /example\.invalid/);
  } finally {
    await browser.close();
  }
});

test('01-long-technical.md: notices region empty with zero height; first line matches without the region', async () => {
  const docPath = '/doc/01-long-technical.md';
  const files = { [docPath]: b64(join(corpusDir, '01-long-technical.md')) };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const withRegion = await page.evaluate(() => {
      const region = document.getElementById('marxy-notices');
      const first = document.querySelector('#doc p[data-marxy-s]');
      const rect = first?.getBoundingClientRect();
      return {
        noticeHeight: region?.getBoundingClientRect().height ?? -1,
        noticeChildren: region?.childElementCount ?? -1,
        firstTop: rect?.top ?? -1,
      };
    });
    assert.equal(withRegion.noticeChildren, 0);
    assert.ok(withRegion.noticeHeight <= 0.5);
    const withoutRegion = await page.evaluate(() => {
      document.getElementById('marxy-notices')?.remove();
      const first = document.querySelector('#doc p[data-marxy-s]');
      return first?.getBoundingClientRect().top ?? -1;
    });
    assert.ok(Math.abs(withRegion.firstTop - withoutRegion) < 0.5);
  } finally {
    await browser.close();
  }
});

nodeTest('notices modules contain no innerHTML', () => {
  const dir = join(repoRoot, 'apps', 'desktop', 'src', 'notices');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(text, /\binnerHTML\b/, `${file} must not use innerHTML`);
  }
});

nodeTest('assetUrl arguments over the corpus are never http or https URLs', () => {
  const root = '/repo/fixtures/corpus';
  for (const file of readdirSync(corpusDir).filter((f) => f.endsWith('.md'))) {
    const source = readFileSync(join(corpusDir, file), 'utf8');
    const ast = parseMarkdown(source, { file });
    const { html } = renderDocumentSafeHtml(ast);
    const docDir = `${root}/${file.replace(/\/[^/]+$/, '').replace(/^[^/]+$/, '')}` || root;
    const documentDir = `${root}`;
    const imageRoot = root;
    for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const src = m[1];
      const resolved = resolveImageSrc(src, { documentDir: `${root}`, imageRoot });
      if (resolved.kind !== 'local') continue;
      assert.doesNotMatch(resolved.path, /^https?:/i, `${file}: ${resolved.path}`);
    }
  }
});
