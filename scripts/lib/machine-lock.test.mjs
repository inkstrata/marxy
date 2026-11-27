import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lockPath, takeLock, takeSlot } from './machine-lock.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'marxy-lock-test-'));

test('a second taker fails clearly while the first holds the lock, and succeeds after release', async () => {
  const d = dir();
  try {
    const release = await takeLock('t', { dir: d });
    await assert.rejects(takeLock('t', { dir: d }), /t is already running \(pid \d+/);
    release();
    assert.equal(existsSync(lockPath('t', d)), false);
    (await takeLock('t', { dir: d }))();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a waiting taker gets the lock when the holder releases', async () => {
  const d = dir();
  try {
    const release = await takeLock('w', { dir: d });
    setTimeout(release, 150);
    const second = await takeLock('w', { dir: d, waitMs: 5000, pollMs: 50 });
    second();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a lock whose process is gone, or that is unreadable, is taken over', async () => {
  const d = dir();
  try {
    writeFileSync(lockPath('s', d), JSON.stringify({ pid: 2 ** 22 + 12345, since: new Date().toISOString() }));
    (await takeLock('s', { dir: d }))();
    writeFileSync(lockPath('s', d), 'not json');
    (await takeLock('s', { dir: d }))();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

const owner = (d, k, pid) => writeFileSync(lockPath(`v-${k}`, d), JSON.stringify({ pid, since: new Date().toISOString(), label: `fake ${pid}` }));

test('slots: the places are taken in turn, the next taker waits and gets the first one released', async () => {
  const d = dir();
  try {
    const a = await takeSlot('v', 2, { dir: d });
    const b = await takeSlot('v', 2, { dir: d });
    assert.deepEqual([a.slot, b.slot], [1, 2]);
    await assert.rejects(takeSlot('v', 2, { dir: d }), /all 2 v places are taken: pid \d+/);
    const waiting = takeSlot('v', 2, { dir: d, waitMs: 5000, pollMs: 20 });
    setTimeout(b.release, 100);
    const c = await waiting;
    assert.equal(c.slot, 2);
    assert.equal(existsSync(lockPath('v-1', d)), true);
    a.release();
    assert.equal(existsSync(lockPath('v-1', d)), false);
    c.release();
    assert.equal(existsSync(lockPath('v-2', d)), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('slots: a place whose owner process is gone is reclaimed, a live foreign owner is not', async () => {
  const d = dir();
  try {
    owner(d, 1, process.ppid);
    owner(d, 2, 2 ** 22 + 12345);
    const got = await takeSlot('v', 2, { dir: d });
    assert.equal(got.slot, 2);
    got.release();
    owner(d, 2, process.ppid);
    await assert.rejects(takeSlot('v', 2, { dir: d }), /places are taken/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('slots: the waiting taker says what it waits for, once', async () => {
  const d = dir();
  try {
    const a = await takeSlot('v', 1, { dir: d });
    const lines = [];
    setTimeout(a.release, 120);
    (await takeSlot('v', 1, { dir: d, waitMs: 5000, pollMs: 20, log: m => lines.push(m) })).release();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /all 1 v places are taken: pid \d+.* since .*; waiting/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('an interrupt exits with 130 and the place it held is gone', () => {
  const d = dir();
  try {
    const mod = new URL('./machine-lock.mjs', import.meta.url).href;
    // Windows cannot deliver a real SIGINT to a child, so the child emits the event to its own handlers.
    const code = `import { exitOnSignals, takeSlot } from ${JSON.stringify(mod)};
      await takeSlot('v', 1, { dir: ${JSON.stringify(d)} });
      exitOnSignals();
      process.emit('SIGINT');
      setTimeout(() => process.exit(0), 5000);`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(r.status, 130, r.stderr);
    assert.equal(existsSync(lockPath('v-1', d)), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
