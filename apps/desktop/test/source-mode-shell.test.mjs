// Source mode mounted from the real app shell: defaults, Mod+E, startup deferral (MARXY-169).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { contentHash } from '../../../packages/core/src/buffer/buffer.ts';
import { forbiddenStaticImportsFromEntry } from '../src/startup/static-import-graph.test.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src');
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Lazy Vite build + static server so static checks finish before this runs (palette perf budget). */
let harnessPromise;
let closeHarness = () => {};
async function harnessBase() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-shell-'));
      await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
      const server = createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
        if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      closeHarness = () => server.close();
      return `http://127.0.0.1:${server.address().port}/`;
    })();
  }
  return harnessPromise;
}
after(() => closeHarness());

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function boot(page, files, argv) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
}

nodeTest('app.ts does not statically import @codemirror (startup deferral)', () => {
  const app = readFileSync(join(desktopSrc, 'app.ts'), 'utf8');
  assert.doesNotMatch(app, /@codemirror/);
});

nodeTest('main.ts static import walk still excludes CodeMirror after app wiring', () => {
  const hits = forbiddenStaticImportsFromEntry(desktopSrc).filter((h) => /@codemirror/.test(h.spec));
  assert.equal(hits.length, 0, hits.map((h) => `${h.from} → ${h.spec}`).join('; '));
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

test('an edit in Source re-renders Rendered from the new buffer (MARXY-198)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const mdPath = '/doc/edit.md';
    const source = '# Before\n\nFirst paragraph.\n\nSecond paragraph.\n';
    await boot(page, { [mdPath]: Buffer.from(source).toString('base64') }, [mdPath]);
    await page.keyboard.press(`${modKey}+e`);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    await page.click('#marxy-source .cm-line >> nth=0');
    await page.keyboard.press('End');
    await page.keyboard.type(' and After');
    await page.keyboard.press(`${modKey}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    const seen = await page.evaluate(() => {
      const h1 = document.querySelector('#doc h1');
      const doc = window.__marxyHandle.state.document;
      return {
        heading: h1?.textContent,
        end: Number(h1?.getAttribute('data-marxy-e')),
        astEnd: doc.ast.children[0].src.end,
        blocksFromNewPage: doc.blocks.every((block) => block.el.isConnected),
      };
    });
    assert.equal(seen.heading, 'Before and After');
    assert.equal(seen.end, '# Before and After'.length, 'provenance is from the new bytes');
    assert.equal(seen.astEnd, '# Before and After'.length);
    assert.equal(seen.blocksFromNewPage, true);
  } finally {
    await browser.close();
  }
});

test('opening a second document tears down the first one\'s editor and typesetter (MARXY-198)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const first = '/doc/first.rs';
    const second = '/doc/second.md';
    await boot(page, {
      [first]: b64(join(corpusDir, '04-source.rs')),
      [second]: b64(join(corpusDir, '01-long-technical.md')),
    }, [first]);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    await page.evaluate((path) => window.__marxyHandle.open(path), second);
    const seen = await page.evaluate(() => ({
      editors: document.querySelectorAll('#marxy-source .cm-editor').length,
      mode: document.body.dataset.marxyMode,
      current: window.__marxyHandle.currentPath(),
      hash: window.__marxyHandle.sourceHarness().bufferHash,
    }));
    assert.equal(seen.editors, 0, 'the first document\'s editor is gone');
    assert.equal(seen.mode, 'rendered');
    assert.equal(seen.current, second);
    assert.equal(seen.hash, contentHash(readFileSync(join(corpusDir, '01-long-technical.md'))));
    await page.keyboard.press(`${modKey}+e`);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    const text = await page.evaluate(() => document.querySelector('#marxy-source .cm-content').textContent);
    assert.ok(text.includes('#'), 'Source shows the second document, not the first');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#marxy-source .cm-editor').length), 1);
  } finally {
    await browser.close();
  }
});
