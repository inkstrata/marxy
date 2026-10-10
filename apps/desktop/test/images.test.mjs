// Local images, asset scope, notices and layout shift (MARXY-138).
// The Rust half (`image_size`, `allow_asset_scope`) is #[test]s in src-tauri/src/commands/fs.rs, run by
// `cargo test`; it used to compile a crate here, which needed a C linker in the browser container (G-04).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';
import { renderDocumentSafeHtml } from '../../../packages/core/src/render/pipeline.ts';
import { resolveImageSrc } from '../../../packages/core/src/render/images.ts';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-images-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
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

// F-14: in a repository the image root is the repository root (ADR-0027 §5), not the document's folder.
const NESTED_SOURCE = [
  '# Nested',
  '',
  'Text first, so the page has something to read.',
  '',
  '![logo](/assets/logo.png)',
  '',
  'Between.',
  '',
  '![diagram](../diagram.png)',
  '',
  'More.',
  '',
  '![escape](../../etc/x.png)',
  '',
].join('\n');
const nestedFiles = (withGit) => ({
  '/repo/docs/readme.md': Buffer.from(NESTED_SOURCE).toString('base64'),
  '/repo/assets/logo.png': b64(join(corpusDir, 'image.png')),
  '/repo/diagram.png': b64(join(corpusDir, 'image.png')),
  ...(withGit ? { '/repo/.git/HEAD': Buffer.from('ref: refs/heads/main\n').toString('base64') } : {}),
});

async function nestedImages(files) {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const handle = await boot(page, files, ['/repo/docs/readme.md']);
    const sizes = handle.shell.calls.filter((c) => c.method === 'imageSize').map((c) => c.args[0]);
    const scopes = handle.shell.calls.filter((c) => c.method === 'allowAssetScope').map((c) => c.args[0]);
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll('#doc img')].map((el) => ({ alt: el.getAttribute('alt'), src: el.getAttribute('src') })),
    );
    return { sizes, scopes, srcs };
  } finally {
    await browser.close();
  }
}

test('F-14: /x.png in a nested document loads from the repository root', async () => {
  const { sizes, srcs } = await nestedImages(nestedFiles(true));
  assert.ok(sizes.includes('/repo/assets/logo.png'), `sized: ${sizes}`);
  assert.ok(srcs.find((i) => i.alt === 'logo')?.src, 'the logo has a src');
});

test('F-14: ../x.png in a nested document loads from inside the repository', async () => {
  const { sizes, srcs } = await nestedImages(nestedFiles(true));
  assert.ok(sizes.includes('/repo/diagram.png'), `sized: ${sizes}`);
  assert.ok(srcs.find((i) => i.alt === 'diagram')?.src, 'the diagram has a src');
});

test('F-14: ../../etc/x.png still leaves the repository and is refused', async () => {
  const { sizes, srcs } = await nestedImages(nestedFiles(true));
  assert.equal(sizes.some((p) => p.includes('etc')), false);
  assert.equal(srcs.find((i) => i.alt === 'escape')?.src, null);
});

test('F-14: the asset scope is the repository root, once', async () => {
  const { scopes } = await nestedImages(nestedFiles(true));
  assert.deepEqual(scopes, ['/repo']);
});

test('F-14: a document in no repository keeps its own folder as the image root', async () => {
  const { sizes, scopes, srcs } = await nestedImages(nestedFiles(false));
  assert.deepEqual(scopes, ['/repo/docs']);
  assert.ok(sizes.every((p) => p.startsWith('/repo/docs/')), `sized: ${sizes}`);
  assert.ok(srcs.every((i) => i.src === null), 'nothing outside the folder loads');
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

// F-17: a document with no text characters (only images) is still a document that opens.
const imageOnly = (n) => Array.from({ length: n }, (_, i) => `![pic${i}](a.png)`).join('\n\n') + '\n';
const imageOnlyFiles = (n) => ({
  '/docs/only.md': Buffer.from(imageOnly(n)).toString('base64'),
  '/docs/a.png': b64(join(corpusDir, 'image.png')),
});

// `start` is raced against a bound so that a hang reads as a failure naming the cause, not a timeout.
async function bootBounded(page, files, argv, boundMs = 15000) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page.evaluate(async ({ files, argv, boundMs }) => {
    const bound = new Promise((resolve) => setTimeout(() => resolve('hung'), boundMs));
    const started = window.marxyApp.start(files, argv).then((h) => { window.__f17 = h; return 'started'; });
    const outcome = await Promise.race([started, bound]);
    if (outcome !== 'started') return { outcome };
    const exit = await Promise.race([window.__f17.ready.then(() => 'ready'), bound]);
    const calls = window.__f17.shell.calls.map((c) => c.method);
    return { outcome: exit, watches: calls.filter((m) => m === 'watch').length, assetUrls: calls.filter((m) => m === 'assetUrl').length };
  }, { files, argv, boundMs });
}

test('F-17: a document of one image and no text loads the image', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const r = await bootBounded(page, imageOnlyFiles(1), ['/docs/only.md']);
    assert.equal(r.outcome, 'ready', JSON.stringify(r));
    await page.waitForFunction(() => {
      const el = document.querySelector('#doc img');
      return el && el.getAttribute('src') && el.getAttribute('src') !== 'a.png';
    }, undefined, { timeout: 10000 });
    const src = await page.evaluate(() => document.querySelector('#doc img').getAttribute('src'));
    assert.notEqual(src, 'a.png');
  } finally {
    await browser.close();
  }
});

test('F-17: a document of two image blocks and no text starts and registers its watch', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const r = await bootBounded(page, imageOnlyFiles(2), ['/docs/only.md']);
    assert.equal(r.outcome, 'ready', JSON.stringify(r));
    assert.equal(r.watches, 1, JSON.stringify(r));
  } finally {
    await browser.close();
  }
});

test('F-17: an empty document still reports no text and is not watched', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const r = await bootBounded(page, { '/docs/empty.md': '' }, ['/docs/empty.md']);
    const marks = await page.evaluate(() => window.__f17?.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]) ?? []);
    assert.equal(r.outcome, 'ready', JSON.stringify(r));
    assert.ok(marks.includes('no_text'), `marks: ${marks}`);
    assert.equal(marks.includes('first_text'), false);
    assert.equal(r.watches, 0, JSON.stringify(r));
  } finally {
    await browser.close();
  }
});

// F-17.1: "empty" is decided by the source, not by the rendered selector.
const TEXTLESS = {
  'a lone ---': '---\n',
  'a lone ***': '***\n',
  'an HTML comment alone': '<!-- nothing to read -->\n',
  'a lone <div>': '<div>\n',
};
for (const [name, source] of Object.entries(TEXTLESS)) {
  test(`F-17.1: ${name} opens and registers its watch`, async () => {
    const browser = await webkit.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
      const r = await bootBounded(page, { '/docs/t.md': Buffer.from(source).toString('base64') }, ['/docs/t.md']);
      assert.equal(r.outcome, 'ready', JSON.stringify(r));
      assert.equal(r.watches, 1, JSON.stringify(r));
    } finally {
      await browser.close();
    }
  });
}

test('F-17.1: front matter alone reaches first_text and registers its watch', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const source = '---\ntitle: Only metadata\n---\n';
    const r = await bootBounded(page, { '/docs/fm.md': Buffer.from(source).toString('base64') }, ['/docs/fm.md']);
    const marks = await page.evaluate(() => window.__f17?.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]) ?? []);
    assert.equal(r.outcome, 'ready', JSON.stringify(r));
    assert.ok(marks.includes('first_text'), `marks: ${marks}`);
    assert.equal(marks.includes('no_text'), false, `marks: ${marks}`);
    assert.equal(r.watches, 1, JSON.stringify(r));
  } finally {
    await browser.close();
  }
});

test('F-17.1: a file of only white space is empty: no_text and no watch', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const r = await bootBounded(page, { '/docs/ws.md': Buffer.from(' \n\n\t\n').toString('base64') }, ['/docs/ws.md']);
    const marks = await page.evaluate(() => window.__f17?.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]) ?? []);
    assert.ok(marks.includes('no_text'), `marks: ${marks}`);
    assert.equal(r.watches, 0, JSON.stringify(r));
  } finally {
    await browser.close();
  }
});
