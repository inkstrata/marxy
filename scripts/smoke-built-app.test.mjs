// Gates for MARXY-254: byte expectations, nightly wiring, and ci-contract coverage.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './lib/repo.mjs';
import {
  SMOKE_CORPUS_FILE,
  expectedBytesAfterFirstToggle,
  paletteRuntimeStyleOk,
  smokeBuiltRequired,
  taskifiedCopyBytes,
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
