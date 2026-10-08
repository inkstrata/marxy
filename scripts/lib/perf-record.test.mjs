// results/perf.json is updated by two test processes at once under `pnpm test` (G-01.1).
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readRecord, updateRecord } from './perf-record.mjs';

const helper = fileURLToPath(new URL('./perf-record.mjs', import.meta.url));

test('a missing, empty, truncated or non-object file reads as an empty record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-perf-'));
  const path = join(dir, 'perf.json');
  assert.deepEqual(readRecord(path), {});
  for (const text of ['', '{"a": 1, "b"', '[1]', 'null', '7']) {
    writeFileSync(path, text);
    assert.deepEqual(readRecord(path), {}, JSON.stringify(text));
  }
  writeFileSync(path, '{"a":1}');
  assert.deepEqual(updateRecord(path, () => ({ b: 2 })), { a: 1, b: 2 });
});

test('update keeps the keys it does not set and leaves no temp or lock file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-perf-'));
  const path = join(dir, 'results', 'perf.json');
  updateRecord(path, () => ({ env_class: 'reference', a: 1 }));
  updateRecord(path, (existing) => ({ env_class: existing.env_class ?? 'ci', b: 2 }));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { env_class: 'reference', a: 1, b: 2 });
  assert.deepEqual(readdirSync(join(dir, 'results')), ['perf.json']);
});

// Two processes, each updating its own key 150 times while a third loop reads the file the way
// palette.test.mjs used to (a bare JSON.parse). Without the atomic write the reader throws on a
// truncated file; without the merge under a lock a key goes missing or stops at an old value.
test('concurrent writers never expose a partial file and lose no update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-perf-'));
  const path = join(dir, 'perf.json');
  mkdirSync(dir, { recursive: true });
  const rounds = 150;
  const child = (key) => new Promise((resolve, reject) => {
    const code = `import { updateRecord } from ${JSON.stringify(helper)};
      for (let i = 1; i <= ${rounds}; i++) updateRecord(${JSON.stringify(path)}, () => ({ ${key}: i, pad${key}: 'x'.repeat(4000) }));`;
    const proc = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'inherit', 'inherit'] });
    proc.on('error', reject);
    proc.on('exit', (status) => (status === 0 ? resolve() : reject(new Error(`writer ${key} exited ${status}`))));
  });
  let done = false;
  let reads = 0;
  const failures = [];
  const reader = (async () => {
    while (!done) {
      try {
        JSON.parse(readFileSync(path, 'utf8'));
        reads++;
      } catch (error) {
        if (error.code !== 'ENOENT') failures.push(error.message);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  await Promise.all([child('a'), child('b')]);
  done = true;
  await reader;
  assert.deepEqual(failures, [], 'a reader saw a partial file');
  assert.ok(reads > 0, 'the reader never got a read in');
  const final = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(final.a, rounds);
  assert.equal(final.b, rounds);
  assert.deepEqual(readdirSync(dir), ['perf.json']);
});
