// Gates for MARXY-254: byte expectations, nightly wiring, and ci-contract coverage.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './lib/repo.mjs';
import {
  SMOKE_CORPUS_FILE,
  expectedBytesAfterFirstToggle,
  paletteRuntimeStyleOk,
  smokeBuiltRequired,
  taskifiedCopyBytes,
  waitForFileBytes,
} from './smoke-built-app.mjs';

const corpusBytes = () => readFileSync(join(ROOT, 'fixtures/corpus', SMOKE_CORPUS_FILE));

test('smokeBuiltRequired follows MARXY_SMOKE_BUILT_REQUIRED', () => {
  assert.equal(smokeBuiltRequired({ MARXY_SMOKE_BUILT_REQUIRED: '1' }), true);
  assert.equal(smokeBuiltRequired({}), false);
});

test('taskifiedCopyBytes keeps BOM and CRLF and adds one task marker', () => {
  const source = corpusBytes();
  assert.equal(source[0], 0xef);
  assert.ok(source.includes(0x0d) && source.includes(0x0a));
  const copy = taskifiedCopyBytes(source);
  assert.ok(copy.length > source.length);
  assert.equal(copy[0], 0xef);
  const text = new TextDecoder().decode(copy);
  assert.match(text, /- \[ \] a\r\n/);
  assert.match(text, /- b\r\n/);
});

test('expectedBytesAfterFirstToggle flips only the task marker bytes', () => {
  const copy = taskifiedCopyBytes(corpusBytes());
  const expected = expectedBytesAfterFirstToggle(copy);
  assert.equal(copy.length, expected.length);
  const diffs = [];
  for (let i = 0; i < copy.length; i++) if (copy[i] !== expected[i]) diffs.push(i);
  assert.ok(diffs.length > 0 && diffs.length <= 3, `expected a short marker diff, got ${diffs.length} bytes`);
  assert.match(new TextDecoder().decode(expected), /\[x\]/);
});

test('paletteRuntimeStyleOk accepts an applied 8px radius and rejects the default', () => {
  assert.equal(paletteRuntimeStyleOk('8px'), true);
  assert.equal(paletteRuntimeStyleOk('0px'), false);
});

test('MARXY-254: nightly.yml builds release and runs the built-app smoke on Linux', () => {
  const nightly = readFileSync(join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
  assert.match(nightly, /built-app-smoke:/);
  assert.match(nightly, /timeout-minutes:/);
  assert.match(nightly, /cargo build --release --features tauri\/custom-protocol --locked/);
  assert.match(nightly, /webkit2gtk-driver/);
  assert.match(nightly, /smoke-built-app\.mjs/);
  assert.match(nightly, /MARXY_SMOKE_BUILT_REQUIRED=1/);
  assert.doesNotMatch(nightly, /pull_request:/, 'nightly stays off the pull-request path');
});

test('MARXY-254: docs/ci-contract.md lists the built-app smoke as monitoring', () => {
  const doc = readFileSync(join(ROOT, 'docs/ci-contract.md'), 'utf8');
  assert.match(doc, /smoke-built-app\.mjs/);
  assert.match(doc, /monitoring/i);
});

test('waitForFileBytes waits for a same-length save instead of returning on the opening bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-wait-'));
  try {
    const path = join(dir, 'a.md');
    const opening = new TextEncoder().encode('- [ ] a\r\n');
    const expected = new TextEncoder().encode('- [x] a\r\n');
    writeFileSync(path, opening);
    setTimeout(() => writeFileSync(path, expected), 150);
    const got = await waitForFileBytes(path, expected, { opening, intervalMs: 20 });
    assert.deepEqual([...got], [...expected]);

    // A different write is returned (for the caller to report), not waited out.
    const wrong = new TextEncoder().encode('- [y] a\r\n');
    writeFileSync(path, opening);
    setTimeout(() => writeFileSync(path, wrong), 50);
    assert.deepEqual([...(await waitForFileBytes(path, expected, { opening, intervalMs: 20 }))], [...wrong]);

    // Never saved: times out.
    writeFileSync(path, opening);
    await assert.rejects(waitForFileBytes(path, expected, { opening, ms: 100, intervalMs: 20 }), /timed out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the smoke lets tauri-driver own WebKitWebDriver and pins a tauri-driver that maps W3C capabilities', () => {
  const nightly = readFileSync(join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
  assert.match(nightly, /cargo install tauri-driver --version 2\./);
  const smoke = readFileSync(join(ROOT, 'scripts/smoke-built-app.mjs'), 'utf8');
  assert.doesNotMatch(smoke, /spawnLogged\('WebKitWebDriver'/);
});
