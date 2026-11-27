// A lock file in the OS temp folder, shared by every checkout on the machine: for work that owns a machine-wide
// resource (check:tauri's debugging port 9333). The holder's pid is stored so a crashed run's lock is taken over.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// MARXY_LOCK_DIR moves every lock to another folder, for a run that must not meet the machine's real holders.
export const lockPath = (name, dir = process.env.MARXY_LOCK_DIR || tmpdir()) => join(dir, `marxy-${name}.lock`);

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function readHolder(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Takes the lock `name`, waiting up to `waitMs` for a live holder to finish. Returns a `release` function (also run when
 * the process exits). Throws an Error naming the holder when the wait runs out.
 * A lock whose pid is gone, or that is older than `staleMs` (a reused pid), is taken over.
 */
export async function takeLock(name, { waitMs = 0, pollMs = 2000, staleMs = 3 * 3600_000, dir, log = () => {}, label = '' } = {}) {
  const path = lockPath(name, dir);
  const started = Date.now();
  let announced = false;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: process.cwd(), label }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    const holder = readHolder(path);
    const age = holder?.since ? Date.now() - Date.parse(holder.since) : Infinity;
    if (!holder || !pidAlive(holder.pid) || age > staleMs) {
      try {
        unlinkSync(path);
      } catch {}
      continue;
    }
    const waited = Date.now() - started;
    if (waited >= waitMs) {
      const err = new Error(
        `${name} is already running (pid ${holder.pid}, since ${holder.since}${holder.label ? `, ${holder.label}` : ''}); waited ${Math.round(waited / 1000)} s. ` +
          `Wait for it, or remove ${path} if that process is gone`,
      );
      err.code = 'HELD';
      err.holder = holder;
      throw err;
    }
    if (!announced) log(`${name} is held by pid ${holder.pid} since ${holder.since}; waiting up to ${Math.round(waitMs / 1000)} s`);
    announced = true;
    await sleep(Math.min(pollMs, waitMs - waited));
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readHolder(path)?.pid === process.pid) {
      try {
        unlinkSync(path);
      } catch {}
    }
  };
  process.on('exit', release);
  return release;
}

/**
 * Takes one of `slots` places named `name` (lock files `marxy-<name>-1.lock` and on), for work a machine can run a few
 * at a time. Waits up to `waitMs` for a place to free; a place whose owner is gone is taken over like any lock.
 * Returns { release, slot }. Throws an Error naming the holders when the wait runs out.
 */
export async function takeSlot(name, slots, { waitMs = 0, pollMs = 2000, log = () => {}, ...opts } = {}) {
  if (!Number.isInteger(slots) || slots < 1) throw new Error('slots must be a whole number of at least 1');
  const started = Date.now();
  let announced = false;
  for (;;) {
    const holders = [];
    for (let k = 1; k <= slots; k++) {
      try {
        return { release: await takeLock(`${name}-${k}`, { ...opts, waitMs: 0 }), slot: k };
      } catch (e) {
        if (e?.code !== 'HELD') throw e;
        holders.push(e.holder);
      }
    }
    const waited = Date.now() - started;
    const who = holders.map(h => `pid ${h.pid}${h.label ? ` (${h.label})` : ''} since ${h.since}`).join('; ');
    if (waited >= waitMs) throw new Error(`all ${slots} ${name} places are taken: ${who}; waited ${Math.round(waited / 1000)} s`);
    if (!announced) log(`all ${slots} ${name} places are taken: ${who}; waiting`);
    announced = true;
    await sleep(Math.min(pollMs, waitMs - waited));
  }
}

/** An interrupt or termination exits the process (code 130) so the 'exit' hook of every lock taken runs and removes it. */
export function exitOnSignals(signals = ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  for (const s of signals) process.once(s, () => process.exit(130));
}
