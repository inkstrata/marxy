// Source mode mounted from the real app shell: defaults, Mod+E, startup deferral (MARXY-169).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { contentHash } from '../../../packages/core/src/buffer/buffer.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-shell-'));
let server;
let base;

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

before(async () => {
  if (skip) return;
  await build({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
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
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
}

function startupBundleText() {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const queue = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ''));
  const walked = new Set();
  const chunks = [];
  while (queue.length) {
    const src = queue.pop();
    if (walked.has(src)) continue;
    walked.add(src);
    const file = join(outDir, src);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    chunks.push(text);
    for (const m of text.matchAll(/from\s*["'](\.?\.?\/[^"']+)["']/g)) {
      queue.push(new URL(m[1], `file:///${src}`).pathname.replace(/^\//, ''));
    }
  }
  return chunks.join('\n');
}

nodeTest('app.ts does not statically import @codemirror (startup deferral)', () => {
  const app = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'app.ts'), 'utf8');
  assert.doesNotMatch(app, /@codemirror/);
});

nodeTest('production index startup graph excludes CodeMirror until Mod+E', () => {
  if (skip) return;
  const bundle = startupBundleText();
  assert.doesNotMatch(bundle, /@codemirror/);
  assert.doesNotMatch(bundle, /lang-rust/);
});

test('04-source.rs opens in Source: #marxy-source visible, #doc hidden', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const rsPath = '/corpus/04-source.rs';
    await boot(page, { [rsPath]: b64(join(corpusDir, '04-source.rs')) }, [rsPath]);
    const vis = await page.evaluate(() => ({
      docHidden: document.getElementById('doc').hidden,
      sourceHidden: document.getElementById('marxy-source').hidden,
      mode: document.body.dataset.marxyMode,
      hasEditor: Boolean(document.querySelector('#marxy-source .cm-editor')),
    }));
    assert.equal(vis.docHidden, true);
    assert.equal(vis.sourceHidden, false);
    assert.equal(vis.mode, 'source');
    assert.equal(vis.hasEditor, true);
  } finally {
    await browser.close();
  }
});

test('01-long-technical.md opens in Rendered: #doc visible, #marxy-source hidden', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const mdPath = '/corpus/01-long-technical.md';
    await boot(page, { [mdPath]: b64(join(corpusDir, '01-long-technical.md')) }, [mdPath]);
    const vis = await page.evaluate(() => ({
      docHidden: document.getElementById('doc').hidden,
      sourceHidden: document.getElementById('marxy-source').hidden,
      mode: document.body.dataset.marxyMode,
    }));
    assert.equal(vis.docHidden, false);
    assert.equal(vis.sourceHidden, true);
    assert.equal(vis.mode, 'rendered');
  } finally {
    await browser.close();
  }
});

test('Mod+E twice without edits keeps buffer hash and reading byte offset', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const mdPath = '/doc/01-long-technical.md';
    const bytes = readFileSync(join(corpusDir, '01-long-technical.md'));
    const expectedHash = contentHash(bytes);
    await boot(page, { [mdPath]: bytes.toString('base64') }, [mdPath]);
    await page.evaluate(() => window.scrollTo(0, 2400));
    await page.waitForFunction(() => window.scrollY > 1000);
    const before = await page.evaluate(() => window.__marxyHandle.sourceHarness());
    assert.equal(before.bufferHash, expectedHash);
    await page.keyboard.press(`${modKey}+e`);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    await page.keyboard.press(`${modKey}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    await page.waitForFunction(
      () => window.__marxyHandle.sourceHarness().byteOffset > 500,
      undefined,
      { timeout: 5000 },
    );
    const after = await page.evaluate(() => window.__marxyHandle.sourceHarness());
    assert.equal(after.bufferHash, expectedHash);
    assert.equal(after.byteOffset, before.byteOffset);
  } finally {
    await browser.close();
  }
});
