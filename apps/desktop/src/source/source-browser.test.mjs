// CodeMirror Source mode in WebKit: scroll budget, round-trip, undo (MARXY-37).

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
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

test('9 MB Source scroll: max frame time is recorded', async () => {
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
    // Recorded, not a CI failure (ADR-0032). What does fail is a measurement that did not happen.
    assert.ok(Number.isFinite(stats.max) && stats.max > 0, `9 MB Source scroll max frame was not measured (${stats.max})`);
    console.log(`9 MB Source scroll max frame ${stats.max.toFixed(1)} ms; frames over 100 ms: ${stats.over100} (recorded, ADR-0032)`);
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
    // Inside line 40: deep enough that Source must scroll to put it on the reading line (S-07-0003).
    const lineStarts = [0];
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) lineStarts.push(i + 1);
    const at = lineStarts[40] + 5;
    const result = await page.evaluate(
      async ({ bytesB64, at }) => window.marxySourceHarness.roundTrip(bytesB64, '/19-source-file.md', at),
      { bytesB64, at },
    );
    assert.equal(result.changed, false);
    assert.equal(result.hashSame, true);
    assert.equal(result.byteOffset, lineStarts[40], 'the line on the reading line is the line holding the byte');
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

test('bytes that are not UTF-8: shown as marked bytes, copied as U+FFFD, pasted back and moved as themselves (F-34.1)', async () => {
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const enc = new TextEncoder();
  const line1 = [...enc.encode('caf'), 0xe9, ...enc.encode(' and '), 0xe2, 0x82, 0x0a];
  const line2 = [...enc.encode('second '), 0xff, 0x0a];
  const bytes = Uint8Array.from([...line1, ...line2]);
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.strayBytes === 'function');
    const result = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.strayBytes(bytesB64, '/latin.md'),
      { bytesB64: b64(bytes) },
    );
    assert.deepEqual(
      result.markers.map((m) => m.text),
      ['E9', 'E2', '82', 'FF'],
      'each stray byte is marked with its value',
    );
    assert.equal(result.markers[0].label, 'Byte E9, not UTF-8');
    assert.equal(result.pageHasLone, false, 'no lone surrogate in the page');
    assert.equal(result.pageHasLoneAfter, false, 'nor after a paste and a move');
    assert.equal(result.copiedHasLone, false, 'nor on the clipboard');
    assert.equal(result.copied, 'caf\uFFFD and \uFFFD\uFFFD\nsecond \uFFFD\n');
    // The copy pasted back is the bytes themselves; the foreign lone surrogate is EF BF BD; the first line moved
    // below the second keeps its bytes.
    const expected = [...line2, ...line1, ...line1, ...line2, ...enc.encode('X'), 0xef, 0xbf, 0xbd, ...enc.encode('Y')];
    assert.equal(result.hex, hex(expected));
  } finally {
    await browser.close();
  }
});

/** Runs `name` in the Source harness on `bytes`. */
async function harness(name, bytes, path = '/stray.md') {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction((n) => typeof window.marxySourceHarness?.[n] === 'function', name);
    return await page.evaluate(async ({ name, bytesB64, path }) => window.marxySourceHarness[name](bytesB64, path), { name, bytesB64: b64(bytes), path });
  } finally {
    await browser.close();
  }
}
const hexBytes = (s) => s.split(' ').map((h) => Number.parseInt(h, 16));
const asHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// The first review of F-34.1 (#584), its returns 1 and 2: the restore reads the pasteboard item the paste carries, so
// a drag cannot overwrite it and another program's U+FFFD cannot be taken for it.
test('a copied stray line pastes back exactly after a drag that went nowhere; another program\'s U+FFFD stays U+FFFD (F-34.1)', async () => {
  const input = '23 20 54 0a 0a 66 69 72 73 74 0a 0a 6d 69 64 20 ff 20 78 0a 0a 70 6c 61 69 6e 20 6c 69 6e 65 0a 0a 65 6e 64 20 e9 0a';
  const result = await harness('strayClipboard', Uint8Array.from(hexBytes(input)));
  assert.equal(result.afterDrag, `${input} 6d 69 64 20 ff 20 78`, 'the copy, after a cancelled drag');
  assert.equal(result.copiedOne, '"\\udcff"', 'the copy of the one byte carried it');
  assert.equal(result.otherApp, `${input} ef bf bd`, 'another program\'s U+FFFD');
  assert.equal(result.types, 'text/plain,application/x-marxy-source-text', 'one pasteboard item, two types');
  assert.equal(result.mismatch, `${input} 6d 69 64 20 ef bf bd 20 78 21`, 'readable text that disagrees with the type is read as it is');
});

test('the find panel, opened on a selection with a stray byte, and its announcement hold no lone surrogate (F-34.1)', async () => {
  const input = '23 20 54 0a 0a 6d 69 64 20 69 64 20 ff 20 78 0a';
  const result = await harness('strayFind', Uint8Array.from(hexBytes(input)));
  assert.equal(result.opened, false, 'the panel as it opens');
  assert.equal(result.afterFind, false, 'after find next');
  assert.equal(result.query, 'd � ', 'the query is the selection read with U+FFFD');
  assert.ok(!/[\uD800-\uDFFF]/u.test(result.announced), JSON.stringify(result.announced));
});

test('a save after two stray bytes are made neighbours keeps the caret and the undo history (F-34.1)', async () => {
  const input = '23 20 54 0a 0a 68 65 6c 6c 6f 0a 0a 78 c3 0a a9 79 0a 0a 74 61 69 6c 0a';
  const result = await harness('strayJoin', Uint8Array.from(hexBytes(input)));
  assert.equal(result.saved, '23 20 54 0a 0a 68 65 6c 6c 6f 0a 0a 78 c3 a9 79 51 0a 0a 74 61 69 6c 0a');
  assert.equal(result.caretText, 'yQ', 'the caret stays after the Q');
  assert.equal(result.afterUndo, '# T\n\nhello\n\nxéy\n\ntail\n', 'Mod+Z takes the Q back, and nothing else');
  void asHex;
});
