// Fixture-board runner for review-order.mjs, so `node --test orchestration/test` covers MARXY-80.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('review-order --selftest is green and prints a case count of at least 12', () => {
  const r = spawnSync(process.execPath, ['orchestration/review-order.mjs', '--selftest'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /review-order selftest ok: (\d+) named cases/);
  const n = Number(/review-order selftest ok: (\d+) named cases/.exec(r.stdout)[1]);
  assert.ok(n >= 12, `case count ${n} is below 12`);
});
