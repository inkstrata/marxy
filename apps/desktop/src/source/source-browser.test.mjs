// CodeMirror Source mode in WebKit: scroll budget, round-trip, undo (MARXY-37).

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: { harness: join(desktopRoot, 'src/source/harness-shell.html') },
      },
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = pathname.replace(/^\//, '') || 'src/source/harness-shell.html';
    const path = join(outDir, rel);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end('missing');
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/javascript');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});

after(() => {
  server?.close();
  rmSync(outDir, { recursive: true, force: true });
});

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

test('9 MB Source scroll: no frame longer than 100 ms (envelope tier)', async () => {
  const line = `${'x'.repeat(180)}\n`;
  const target = 9 * 1024 * 1024;
  let body = '';
  while (Buffer.byteLength(body, 'utf8') < target) body += line;
  const bytesB64 = b64(Buffer.from(body, 'utf8'));
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.scrollPerf === 'function');
    const stats = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.scrollPerf(bytesB64, '/big.txt', 80),
      { bytesB64 },
    );
    assert.ok(stats.lines > 1000, 'expected a large document');
    assert.equal(stats.over100, 0, `max frame ${stats.max} ms; frames over 100ms: ${stats.over100}`);
    assert.ok(stats.max <= 100, `max frame ${stats.max} ms`);
  } finally {
    await browser.close();
  }
});

test('mode switch twice without editing keeps bytes and byteOffset', async () => {
  const bytes = readFileSync(join(repoRoot, 'fixtures/corpus/19-source-file.md'));
  const bytesB64 = b64(bytes);
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.roundTrip === 'function');
    const result = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.roundTrip(bytesB64, '/19-source-file.md', 128),
      { bytesB64 },
    );
    assert.equal(result.hashSame, true);
    assert.equal(result.byteOffset, 128);
  } finally {
    await browser.close();
  }
});

test('multi-cursor edit undo restores prior doc length', async () => {
  const bytes = new TextEncoder().encode('hello world\n');
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.multiCursorUndo === 'function');
    const result = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.multiCursorUndo(bytesB64, '/x.txt'),
      { bytesB64: b64(bytes) },
    );
    assert.ok(result.afterEdit > result.before, 'expected edits to grow the doc');
    assert.equal(result.afterUndo, result.before, 'undo should restore the original length');
  } finally {
    await browser.close();
  }
});
