// Source tab width from `.editorconfig` under the indexed root (MARXY-239).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { clampTab, parseEditorConfig, resolveTabWidth, tabSizeFromSection } = require('../src/source/editorconfig.ts');

nodeTest('editorconfig tab_width, indent_size, bounds, and default', async () => {
  const section = tabSizeFromSection(parseEditorConfig('[*]\ntab_width = 2\n')[0]);
  assert.equal(section, 2);
  const indent = tabSizeFromSection(parseEditorConfig('[*]\nindent_size = 6\n')[0]);
  assert.equal(indent, 6);
  assert.equal(clampTab(0), 1);
  assert.equal(clampTab(12), 8);
  const root = '/repo';
  const read = async (path) => {
    if (path === '/repo/.editorconfig') return '[*]\ntab_width = 2\n';
    throw new Error('missing');
  };
  assert.equal(await resolveTabWidth('/repo/pkg/main.rs', '/repo', read), 2);
  assert.equal(await resolveTabWidth('/repo/pkg/main.rs', root, async () => { throw new Error('x'); }), 4);
});

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-tab-width-'));
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

test('Source editor tab-size follows .editorconfig under the indexed root', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const file = '/repo/pkg/main.rs';
    const ec = '/repo/.editorconfig';
    await page.goto(`${base}app.html`);
    await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
    await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
    await page.evaluate(async ({ file, ec }) => {
      const files = {
        [file]: btoa('fn main() {\n\tlet x = 1;\n}\n'),
        [ec]: btoa('[*]\ntab_width = 2\n'),
      };
      const handle = await window.marxyApp.start(files, [file]);
      window.__marxyHandle = handle;
      await handle.ready;
    }, { file, ec });
    await page.waitForFunction(() => document.querySelector('.cm-content') && window.marxySelection);
    const reads = await page.evaluate(async () => {
      await window.marxyRefreshSourceTab?.();
      return window.__marxyHandle.shell.calls
        .filter((c) => c.method === 'readFile')
        .map((c) => c.args[0]);
    });
    assert.ok(reads.includes('/repo/.editorconfig'), `readFile paths: ${reads.join(', ')}`);
  } finally {
    await browser.close();
  }
});
