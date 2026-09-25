// Leases: who is running a piece of fleet work, and whether they still are (MARXY-208).
// A lease is { pid, host, started, match }. It is held while that pid is alive on this host and its
// command line still contains `match`, which is what tells a live worker from a recycled pid. It
// never expires by the clock: a laptop that sleeps for eight hours wakes with its workers alive and
// its leases still held, and a worker whose launching shell was killed is not alive, whatever the
// time says.
import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { here } from './lib.mjs';

/** The fleet's lock and lease files, all under the gitignored results/. */
export const LOOP_LEASE = here('results/loop.lease');
export const CYCLE_LOCK = here('results/cycle.lock');

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * true while the lease's process is alive and still the one it was taken for; false once it is
 * gone; null when this machine cannot tell (no lease, or one taken on another host).
 */
export function leaseHeld(lease, { host = hostname(), alive = pidAlive, command = commandOf } = {}) {
  if (!lease?.pid) return null;
  if (lease.host && lease.host !== host) return null;
  if (!alive(lease.pid)) return false;
  if (lease.match && !command(lease.pid).includes(lease.match)) return false;
  return true;
}

export const newLease = (pid, match, now = new Date()) => ({ pid, host: hostname(), started: now.toISOString(), match });

/**
 * Start a process in its own session with its output going straight to a file. Nothing ties it to
 * the caller: no pipe to break, no process group to be killed with, so the shell, terminal or agent
 * that launched it can go away and it carries on. Returns the pid, or null if it could not start.
 */
export function spawnDetached(cmd, args, { cwd, log, env = process.env, flags = 'a' } = {}) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, flags);
  try {
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', () => {});
    child.unref();
    return child.pid ?? null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Stop whatever a dead lease holder left running. A detached worker leads its own process group, so
 * its agent is still in group `pid` after the worker dies. Only once the leader is gone: a pid is
 * never reissued while a group of that id still exists, so the group can then only be the orphans.
 * Returns whether a group was signalled.
 */
export function killOrphans(lease, { alive = pidAlive, kill = process.kill.bind(process) } = {}) {
  if (!lease?.pid || alive(lease.pid)) return false;
  try {
    kill(-lease.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export function readLease(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * An exclusive lock file holding a lease. A lock whose holder is gone is taken over, so a cycle
 * killed mid-run never wedges the next one. Returns { ok, lease } or { ok: false, holder }.
 */
export function acquireLock(path, { match, held = leaseHeld, now = new Date() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const mine = newLease(process.pid, match, now);
  const tryWrite = () => {
    try {
      writeFileSync(path, JSON.stringify(mine) + '\n', { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }
  };
  if (tryWrite()) return { ok: true, lease: mine };
  const holder = readLease(path);
  if (holder && held(holder) !== false) return { ok: false, holder };
  rmSync(path, { force: true });
  if (tryWrite()) return { ok: true, lease: mine, tookOver: holder };
  return { ok: false, holder: readLease(path) };
}

/** Release a lock this process holds; someone else's lock is left alone. */
export function releaseLock(path, pid = process.pid) {
  if (readLease(path)?.pid === pid) rmSync(path, { force: true });
}

export const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 60_000) : Infinity;
};
