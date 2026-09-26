// The app harness (MARXY-95): startApp against createMemoryShell in Playwright WebKit, and the
// memory shell's own cases. Chromium is not used.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { createMemoryShell } from '../src/shell/memory.ts';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips the browser cases and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const fixture = readFileSync(join(repoRoot, 'fixtures', 'corpus', '02-readme-real-world.md'));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-app-harness-'));
let server;
let base;

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

nodeTest('readFile of a missing path rejects with code not-found', async () => {
  const shell = createMemoryShell({});
  await assert.rejects(
    () => shell.readFile('/no/such.md'),
    (err) => err && typeof err === 'object' && err.code === 'not-found',
  );
});

test('pnpm build produces dist/app.html and the production index excludes the memory shell', () => {
  if (skip) return;
  assert.ok(existsSync(join(outDir, 'app.html')), 'the app harness entry was not written');
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const queue = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ''));
  assert.ok(queue.length > 0, 'index.html has no script');
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
  const bundle = chunks.join('\n');
  assert.doesNotMatch(bundle, /createMemoryShell/);
  assert.doesNotMatch(bundle, /marxyApp/);
});

test('window.marxyApp.start boots the real app and records one readFile', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const result = await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      const heading = document.querySelector('#doc h1, #doc h2, #doc h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      const reads = handle.shell.calls.filter((c) => c.method === 'readFile');
      return { heading, reads: reads.map((c) => c.args[0]) };
    }, { files: { '/docs/README.md': fixture.toString('base64') }, argv: ['/docs/README.md'] });
    assert.equal(result.heading, 'widgetlib');
    assert.deepEqual(result.reads, [
      '/docs/README.md',
      '/data/positions.json',
      '/data/history.json',
      '/config',
    ]);
  } finally {
    await browser.close();
  }
});
