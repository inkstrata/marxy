// Palette jump-to-source lands on the selected element byte (MARXY-239).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = join(repoRoot, 'apps', 'desktop');
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-jump-source-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  await build({
    configFile: false,
    root: appRoot,
    logLevel: 'silent',
    build: {
      lib: {
        entry: resolve(appRoot, 'src/selection/harness-entry.ts'),
        formats: ['iife'],
        name: 'MarxySelectionHarness',
        fileName: 'selection-harness',
      },
      outDir: join(outDir, 'sel'),
      emptyOutDir: true,
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

test('jump-to-source opens Source at data-marxy-s of the selected block', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const mdPath = '/doc/sample.md';
    const md = '# Title\n\nParagraph with **bold** text.\n';
    await page.goto(`${base}app.html`);
    await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
    await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
    await page.evaluate(async ({ mdPath, md }) => {
      const handle = await window.marxyApp.start({ [mdPath]: btoa(md) }, [mdPath]);
      await handle.ready;
      window.__marxyHandle = handle;
    }, { mdPath, md });
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    await page.click('#doc p');
    await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
    const targetByte = await page.evaluate(() => Number(document.querySelector('#doc p')?.getAttribute('data-marxy-s')));
    assert.ok(targetByte > 0);
    await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content'));
    const at = await page.evaluate((byte) => {
      const text = document.querySelector('.cm-content')?.textContent ?? '';
      const slice = text.slice(byte, byte + 20);
      return { mode: document.body.dataset.marxyMode, slice, hasParagraph: text.includes('Paragraph') };
    }, targetByte);
    assert.equal(at.mode, 'source');
    assert.ok(at.hasParagraph);
    assert.match(at.slice, /ragraph|Title/i);
  } finally {
    await browser.close();
  }
});
