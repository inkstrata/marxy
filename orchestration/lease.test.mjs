// Leases, detached spawns and the cycle lock (MARXY-208).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { leaseHeld, acquireLock, releaseLock, readLease, pidAlive, ageMinutes } from './lease.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'marxy-lease-'));

test('a lease is held while its pid lives and runs the command it was taken for', () => {
  const lease = { pid: 42, host: hostname(), match: '--worker MARXY-1' };
  assert.equal(leaseHeld(lease, { alive: () => true, command: () => 'node dispatch.mjs --worker MARXY-1' }), true);
  assert.equal(leaseHeld(lease, { alive: () => false, command: () => '' }), false);
  // A recycled pid: alive, but some other program.
  assert.equal(leaseHeld(lease, { alive: () => true, command: () => '/usr/bin/vim notes.md' }), false);
});

test('no lease, or one taken on another machine, is unknown rather than dead', () => {
  assert.equal(leaseHeld(undefined), null);
  assert.equal(leaseHeld({ pid: 42, host: 'elsewhere' }, { alive: () => false }), null);
});

test('a lease never expires by the clock: after a long sleep a live worker still holds it', () => {
  const lease = { pid: 42, host: hostname(), started: '2020-01-01T00:00:00.000Z', match: 'x' };
  assert.equal(leaseHeld(lease, { alive: () => true, command: () => 'x' }), true);
});

test('pidAlive: this process yes, an impossible pid no', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
});

test('acquireLock: one holder; a second is refused; a dead holder is taken over', () => {
  const path = join(tmp(), 'cycle.lock');
  const a = acquireLock(path, { match: 'x', held: () => true });
  assert.equal(a.ok, true);
  const b = acquireLock(path, { match: 'x', held: () => true });
  assert.equal(b.ok, false);
  assert.equal(b.holder.pid, process.pid);
  writeFileSync(path, JSON.stringify({ pid: 999999, host: hostname(), started: 'then' }));
  const c = acquireLock(path, { match: 'x', held: () => false });
  assert.equal(c.ok, true);
  assert.equal(c.tookOver.pid, 999999);
  releaseLock(path);
  assert.equal(existsSync(path), false);
});

test('releaseLock leaves another process\'s lock alone', () => {
  const path = join(tmp(), 'cycle.lock');
  writeFileSync(path, JSON.stringify({ pid: 999999 }));
  releaseLock(path);
  assert.equal(readLease(path).pid, 999999);
});

test('a corrupt lock file is taken over, never obeyed', () => {
  const path = join(tmp(), 'cycle.lock');
  writeFileSync(path, '{not json');
  assert.equal(acquireLock(path, { match: 'x' }).ok, true);
});

test('spawnDetached: the child outlives the process that started it and writes to its log', () => {
  const dir = tmp();
  const log = join(dir, 'child.log');
  const lease = pathToFileURL(join(import.meta.dirname, 'lease.mjs')).href;
  // A parent that starts a detached child and exits at once, the way a killed shell would leave it.
  const parent = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { spawnDetached } from ${JSON.stringify(lease)};
    const pid = spawnDetached(process.execPath, ['-e', 'setTimeout(() => console.log("survived"), 300)'], { log: ${JSON.stringify(log)} });
    console.log(pid);`], { encoding: 'utf8' });
  const pid = Number(parent.stdout.trim());
  assert.ok(pid > 0, parent.stderr);
  assert.equal(pidAlive(pid), true, 'child alive after its parent exited');
  const until = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < until) spawnSync('sleep', ['0.1']);
  assert.match(readFileSync(log, 'utf8'), /survived/);
});

test('ageMinutes of an unreadable stamp is infinite, never zero', () => {
  assert.equal(ageMinutes('nonsense'), Infinity);
  assert.equal(Math.round(ageMinutes('2026-09-24T00:00:00.000Z', Date.parse('2026-09-24T01:00:00.000Z'))), 60);
});

test('killOrphans signals the dead leader\'s process group, and never a live leader\'s', async () => {
  const { killOrphans } = await import('./lease.mjs');
  const sent = [];
  const kill = (pid, sig) => sent.push([pid, sig]);
  assert.equal(killOrphans({ pid: 77 }, { alive: () => false, kill }), true);
  assert.deepEqual(sent, [[-77, 'SIGTERM']]);
  assert.equal(killOrphans({ pid: 78 }, { alive: () => true, kill }), false);
  assert.equal(killOrphans(undefined, { kill }), false);
  assert.equal(killOrphans({ pid: 79 }, { alive: () => false, kill: () => { throw new Error('ESRCH'); } }), false);
});
