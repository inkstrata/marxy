// Locks held by a lease: the cycle lock and the loop lease (MARXY-208). Runs no longer hold leases
// here; a run's owner is recorded in the event log and its liveness checked by proc.mjs (ADR-0034).
// A lease is { pid, host, started, match }. It is held while that pid is alive and its command line
// still contains `match`, which is what tells a live worker from a recycled pid. `host` is recorded
// for people, not compared: the store is this clone's own, and a Mac's hostname
// can change across a sleep, which would make every live worker look foreign. It
// never expires by the clock: a laptop that sleeps for eight hours wakes with its workers alive and
// its leases still held, and a worker whose launching shell was killed is not alive, whatever the
// time says.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdirSync, linkSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The full command line of `pid` (-ww: never truncated to a terminal width), or null if ps fails. */
export function commandOf(pid) {
  try {
    return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * true while the lease's process is alive and still the one it was taken for; false once it is
 * gone; null for no lease. A live pid whose command cannot be read (ps unavailable, as in some
 * sandboxes) counts as held: when in doubt, never reap.
 */
export function leaseHeld(lease, { alive = pidAlive, command = commandOf } = {}) {
  if (!lease?.pid) return null;
  if (!alive(lease.pid)) return false;
  const cmd = command(lease.pid);
  if (cmd === null) return true;
  return !lease.match || cmd.includes(lease.match);
}

export const newLease = (pid, match, now = new Date()) => ({ pid, host: hostname(), started: now.toISOString(), match });

export function readLease(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Create `path` holding `lease`, or fail if it exists. Written aside and hard-linked into place, so
 * the file appears whole or not at all — a reader never sees an empty lock and calls it stale.
 */
function createExclusive(path, lease) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease) + '\n');
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
}

const sameLease = (a, b) => a?.pid === b?.pid && a?.started === b?.started;

/**
 * An exclusive lock file holding a lease. A lock whose holder is gone is taken over, so a cycle
 * killed mid-run never wedges the next one. The takeover itself runs under a second lock
 * (`PATH.takeover`), and re-reads the holder under it, so two processes that both saw the dead
 * holder cannot both end up holding the lock. Returns { ok, lease, tookOver? } or { ok: false, holder }.
 */
export function acquireLock(path, { match, held = leaseHeld, now = new Date() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const mine = newLease(process.pid, match, now);
  if (createExclusive(path, mine)) return { ok: true, lease: mine };
  const holder = readLease(path);
  if (!isStale(path, holder, held)) return { ok: false, holder };
  const guard = `${path}.takeover`;
  if (!createExclusive(guard, mine)) {
    // Another process is mid-takeover; if it died there, clear its guard for the next attempt.
    const g = readLease(guard);
    if (g && held(g) === false) rmSync(guard, { force: true });
    return { ok: false, holder: readLease(path) ?? holder };
  }
  try {
    const again = readLease(path);
    if (!sameLease(again, holder) || !isStale(path, again, held)) return { ok: false, holder: again };
    rmSync(path, { force: true });
    return createExclusive(path, mine) ? { ok: true, lease: mine, tookOver: holder } : { ok: false, holder: readLease(path) };
  } finally {
    rmSync(guard, { force: true });
  }
}

/** A lock is stale when its holder is gone, or when it is unreadable and not freshly written. */
function isStale(path, holder, held) {
  if (holder) return held(holder) === false;
  try {
    return Date.now() - statSync(path).mtimeMs > 10_000;
  } catch {
    return true;
  }
}

/** Release a lock this process holds; someone else's lock is left alone. */
export function releaseLock(path, pid = process.pid) {
  if (readLease(path)?.pid === pid) rmSync(path, { force: true });
}

export const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 60_000) : Infinity;
};

/**
 * Whether the loop's cycles are healthy, from the loop and cycle leases, the age of the last report,
 * and the loop's record of its last cycle (`loop.last.json`: `{ started, ended, rc }`). Returns null
 * when there is nothing to say, or `{ level: 'warn' | 'fail', msg }`.
 *
 * A stale report alone does not mean a hung cycle: a Mac that slept stops the loop with it, and it
 * carries on at wake (2026-09-27: restarted as "hung" after 513 minutes asleep). Hung is a cycle that
 * holds its lock too long; failing is cycles that end badly; anything else stale is the loop idle.
 */
export function cycleHealth({ loopHeld, cycle = {}, reportAgeMin = null, last = null, stuckMin = 30, nowMs = Date.now() }) {
  if (loopHeld !== true) return null;
  const n = v => Math.round(v);
  const running = cycle.held === true ? ageMinutes(cycle.lease?.started, nowMs) : null;
  if (running != null && running > stuckMin) {
    return { level: 'fail', msg: `a cycle (pid ${cycle.lease?.pid}) has run ${n(running)} min — it is hung; the loop stops it at CYCLE_TIMEOUT, or restart the loop` };
  }
  if (reportAgeMin == null || reportAgeMin <= stuckMin || running != null) return null;
  const endedAgo = last?.ended ? ageMinutes(last.ended, nowMs) : null;
  const age = `no cycle report for ${n(reportAgeMin)} min`;
  if (endedAgo == null) return { level: 'warn', msg: `${age}, and the loop has not recorded a cycle` };
  if (endedAgo > stuckMin) return { level: 'warn', msg: `${age}: the loop is alive but no cycle has run for ${n(endedAgo)} min (the machine slept?); it runs one at wake` };
  if (last.rc !== 0) return { level: 'fail', msg: `${age}: cycles are failing — the last one ${last.rc === 124 ? 'timed out' : `exited ${last.rc}`} ${n(endedAgo)} min ago` };
  return { level: 'fail', msg: `${age}: cycles finish but write no report` };
}
