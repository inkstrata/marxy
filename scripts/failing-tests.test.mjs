// precheck names the failing test, not the tail of its assertion (a bare `diff: 'simple'`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failingTests } from './lib/failing-tests.mjs';

test('a real failing node:test run is reduced to the test name and its message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flake-'));
  const file = join(dir, 'fake.test.mjs');
  writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert';\n" +
    "test('splice is identity', () => { assert.strictEqual('a', 'b'); });\ntest('fine', () => {});\n");
  const r = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.notEqual(r.status, 0);
  const named = failingTests(r.stdout + r.stderr);
  assert.equal(named.length, 1);
  assert.match(named[0], /^splice is identity: .*Expected values to be strictly equal/);
  assert.ok(!named[0].includes('diff:'));
});

test('a passing run names nothing, and a long list is capped', () => {
  assert.deepEqual(failingTests('✔ a (1ms)\nℹ pass 1\n'), []);
  const many = '✖ failing tests:\n' + Array.from({ length: 30 }, (_, i) => `✖ t${i} (1ms)\n  boom\n`).join('');
  const out = failingTests(many);
  assert.equal(out.length, 13);
  assert.match(out[12], /and 18 more/);
});

test('TAP output (not ok lines) is understood too', () => {
  assert.deepEqual(failingTests('ok 1 - a\nnot ok 2 - the b test\n  ---\n'), ['the b test']);
});
