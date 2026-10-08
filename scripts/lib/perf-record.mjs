// The read-merge-write of `results/perf.json`, which the core parse test and the desktop palette test
// both update and which `pnpm test` runs side by side (G-01, G-01.1). A record, never a gate
// (ADR-0032), so the contract is only: never throw because the other writer was mid-write, and
// do not drop the other writer's key. A lock directory serialises the read-merge-rename; the rename
// makes every write whole, so a reader that ignores the lock still never sees half a file.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCK_WAIT_MS = 5000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The object in `path`, or `{}` when the file is missing, empty, half-written or not an object. */
export function readRecord(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function lock(dir) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(dir);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
      // A lock older than the wait is from a writer that died; give up waiting and write unlocked
      // (still atomic) rather than hold a measurement hostage.
      if (Date.now() > deadline) return false;
      sleep(5);
    }
  }
}

/**
 * Merge `update(existing)` over the record in `path` and replace the file atomically. `update`
 * returns the keys to set; it sees what is on disk at the moment the lock is held.
 * @param {string} path
 * @param {(existing: Record<string, unknown>) => Record<string, unknown>} update
 * @returns {Record<string, unknown>} the record written
 */
export function updateRecord(path, update) {
  mkdirSync(dirname(path), { recursive: true });
  const lockDir = `${path}.lock`;
  const held = lock(lockDir);
  try {
    const existing = readRecord(path);
    const record = { ...existing, ...update(existing) };
    const temp = join(dirname(path), `.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(temp, path);
    return record;
  } finally {
    if (held) rmSync(lockDir, { recursive: true, force: true });
  }
}
