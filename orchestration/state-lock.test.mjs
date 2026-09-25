// The board lock (MARXY-210): every read-modify-write of state.json goes through updateState, and two
// processes writing at once lose nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { updateState } from './lib.mjs';

const LIB = pathToFileURL(join(import.meta.dirname, 'lib.mjs')).href;

function board(dir, stories = {}) {
  const path = join(dir, 'state.json');
  writeFileSync(path, JSON.stringify({ merges: 0, stories }) + '\n');
  return { path, lock: join(dir, 'state.lock') };
}

/** A process that bumps its own counter and the shared one `n` times, pausing inside each update. */
function writer({ path, lock }, name, n) {
  const src = `
    import { updateState } from ${JSON.stringify(LIB)};
    const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let i = 0; i < ${n}; i++) {
      updateState(s => {
        const shared = s.merges;
        const mine = s.stories[${JSON.stringify(name)}]?.attempts ?? 0;
        pause(1); // widen the window between read and write, where an unlocked writer loses updates
        s.merges = shared + 1;
        s.stories[${JSON.stringify(name)}] = { status: 'todo', attempts: mine + 1 };
      }, { path: ${JSON.stringify(path)}, lock: ${JSON.stringify(lock)} });
    }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  return new Promise(res => child.on('exit', code => res({ code, err })));
}

test('two concurrent writers lose no update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-state-lock-'));
  const b = board(dir);
  const n = 60;
  const [a, c] = await Promise.all([writer(b, 'A', n), writer(b, 'B', n)]);
  assert.equal(a.code, 0, a.err);
  assert.equal(c.code, 0, c.err);
  const s = JSON.parse(readFileSync(b.path, 'utf8'));
  assert.equal(s.stories.A.attempts, n);
  assert.equal(s.stories.B.attempts, n);
  assert.equal(s.merges, 2 * n);
  assert.equal(existsSync(b.lock), false, 'the lock is released');
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('a lock left by a dead process is taken over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-state-lock-'));
  const b = board(dir, { K: { status: 'todo', attempts: 0 } });
  writeFileSync(b.lock, JSON.stringify({ pid: 2 ** 22 + 7, started: '2026-01-01T00:00:00Z' }) + '\n');
  updateState(s => { s.stories.K.status = 'in_progress'; }, b);
  assert.equal(JSON.parse(readFileSync(b.path, 'utf8')).stories.K.status, 'in_progress');
  assert.equal(existsSync(b.lock), false);
});

test('a live holder is waited for, then named when the wait runs out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-state-lock-'));
  const b = board(dir);
  writeFileSync(b.lock, JSON.stringify({ pid: process.ppid, started: new Date().toISOString() }) + '\n');
  assert.throws(() => updateState(() => {}, { ...b, timeoutMs: 100 }), new RegExp(`locked by pid ${process.ppid}`));
});

test('a nested update in the same process reuses the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-state-lock-'));
  const b = board(dir);
  const out = updateState(() => updateState(s => { s.merges = 5; return 'inner'; }, { ...b, timeoutMs: 100 }), b);
  assert.equal(out, 'inner');
  assert.equal(JSON.parse(readFileSync(b.path, 'utf8')).merges, 5);
});

test('an update that changes nothing does not rewrite the board', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-state-lock-'));
  const b = board(dir, { K: { status: 'todo', attempts: 0 } });
  const before = statSync(b.path).mtimeMs;
  const text = readFileSync(b.path, 'utf8');
  assert.equal(updateState(s => s.stories.K.status, b), 'todo');
  assert.equal(readFileSync(b.path, 'utf8'), text);
  assert.equal(statSync(b.path).mtimeMs, before);
});

test('no orchestration script writes state.json except through updateState', () => {
  const offenders = readdirSync(import.meta.dirname)
    .filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'lib.mjs')
    .filter(f => /\bsaveState\b|\bwrite\w*\([^)]*state\.json/.test(readFileSync(join(import.meta.dirname, f), 'utf8')));
  assert.deepEqual(offenders, []);
});
