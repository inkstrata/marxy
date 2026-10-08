// The read-merge-write of `results/perf.json`, which the core parse test and the desktop palette test
// both update and which `pnpm test` runs side by side (G-01, G-01.1). A record, never a gate
// (ADR-0032), so the contract is small: a reader never sees a half-written file (every write is a
// temp file renamed into place) and a half-written or missing file reads as empty. The two writers
// set different keys; a rare lost update between them is acceptable for a local record.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The object in `path`, or `{}` when the file is missing, empty, half-written or not an object. */
export function readRecord(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * Merge `update(existing)` over the record in `path` and replace the file atomically.
 * @param {string} path
 * @param {(existing: Record<string, unknown>) => Record<string, unknown>} update
 * @returns {Record<string, unknown>} the record written
 */
export function updateRecord(path, update) {
  mkdirSync(dirname(path), { recursive: true });
  const existing = readRecord(path);
  const record = { ...existing, ...update(existing) };
  const temp = join(dirname(path), `.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return record;
}
