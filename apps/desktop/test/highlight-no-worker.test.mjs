// A page whose highlight worker cannot start shows code as plain lines and says so once: the page carries no grammars of
// its own, so nothing is coloured there.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from './support/shared-vite.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-no-worker-'));
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

const DOC = '/two-fences.md';
const TEXT = ['# Two fences', '', '```ts', 'const a = "x";', 'const b = 2;', '```', '', '```python', 'def f():', '    return "y"', '```', ''].join('\n');
const WARNING = /code is shown without colour: the highlight worker could not start/;

/** Ways a worker fails: the constructor refuses, or the worker is made and then reports an error. */
const FAILURES = {
  'the constructor throws': () => {
    window.Worker = class {
      constructor() { throw new Error('module workers are not allowed here'); }
    };
  },
  'the worker reports an error': () => {
    window.Worker = class {
      constructor() { setTimeout(() => this.onerror?.({ message: 'blocked' }), 0); }
      postMessage() {}
      terminate() {}
    };
  },
};

for (const [name, fail] of Object.entries(FAILURES)) {
  test(`${name}: both fences are plain lines, nothing is coloured, and the failure is logged once`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      const warnings = [];
      page.on('console', (m) => { if (m.type() === 'warning' && WARNING.test(m.text())) warnings.push(m.text()); });
      await page.addInitScript(fail);
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      await page.evaluate(async ({ files, argv }) => {
        const handle = await window.marxyApp.start(files, argv);
        await handle.ready;
      }, { files: { [DOC]: Buffer.from(TEXT, 'utf8').toString('base64') }, argv: [DOC] });
      // Both fences are split into their lines, which is where the colour would have come in.
      await page.waitForFunction(() => document.querySelectorAll('code.language-ts[data-marxy-done], code.language-python[data-marxy-done]').length === 2, null, { timeout: 15_000 });
      // The failure is reported by the next frame at the latest; a frame at a time until it is, with a bound.
      for (let i = 0; i < 600 && warnings.length === 0; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      const state = await page.evaluate(async () => {
        // Past the frames in which a job's answer or the worker's error would arrive.
        for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
        const lines = (lang) => [...document.querySelectorAll(`code.language-${lang} .marxy-line`)].map((l) => l.textContent);
        return {
          ts: lines('ts'),
          python: lines('python'),
          coloured: document.querySelectorAll('[class*="marxy-tok-"]').length,
          done: [...document.querySelectorAll('code[data-marxy-done]')].map((c) => c.dataset.marxyDone),
        };
      });
      assert.deepEqual(state.ts, ['const a = "x";', 'const b = 2;']);
      assert.deepEqual(state.python, ['def f():', '    return "y"']);
      assert.equal(state.coloured, 0, 'no span carries a token role');
      assert.ok(state.done.every((d) => d === 'lines'), `plain lines, never marked as highlighted: ${state.done}`);
      assert.equal(warnings.length, 1, `logged once: ${warnings}`);
    } finally {
      await browser.close();
    }
  });
}
