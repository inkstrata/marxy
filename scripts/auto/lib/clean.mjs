// The weekly cleanup: old worktrees and branches (through `work.mjs clean --stale`), then the automation's own
// old logs and temporary folders. Everything worth keeping is archived first; the result goes to the state branch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { presence } from './presence.mjs';
import * as state from './state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAY = 864e5;
export const LOG_DAYS = 30;
export const ROW_DAYS = 90;
export const TMP_DAYS = 14;
export const CLEAN_EVERY_DAYS = 7;

const osName = (platform = process.platform) => ({ win32: 'windows', darwin: 'macos' })[platform] ?? platform;

/** Lines of a .jsonl file without the rows older than the cutoff; a line with no readable `at` is kept. */
export function pruneRows(text, cutoffMs) {
  const keep = text.split('\n').filter((line) => {
    if (!line.trim()) return false;
    try { const at = Date.parse(JSON.parse(line).at); return !(Number.isFinite(at) && at < cutoffMs); } catch { return true; }
  });
  return keep.length ? `${keep.join('\n')}\n` : '';
}

/** Names in `names` (with their modification time from `mtime`) older than `days`. */
export const oldNames = (names, mtime, days, now = Date.now()) => names.filter((n) => now - mtime(n) > days * DAY);

/** True when no cleanup is recorded or the newest is over a week old. */
export function cleanDue(prev, now = Date.now()) {
  const at = Date.parse(prev?.at ?? '');
  return !Number.isFinite(at) || now - at > CLEAN_EVERY_DAYS * DAY;
}

function removeOld(dir, days, now) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const old = oldNames(names, (n) => { try { return fs.statSync(path.join(dir, n)).mtimeMs; } catch { return now; } }, days, now);
  for (const n of old) fs.rmSync(path.join(dir, n), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  return old.length;
}

function pruneJsonl(dir, now) {
  let rows = 0;
  for (const d of [dir, path.join(dir, 'logs')]) {
    let names = [];
    try { names = fs.readdirSync(d).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      const file = path.join(d, n);
      const before = fs.readFileSync(file, 'utf8');
      const after = pruneRows(before, now - ROW_DAYS * DAY);
      if (after !== before) { rows += before.split('\n').filter(Boolean).length - after.split('\n').filter(Boolean).length; fs.writeFileSync(`${file}.tmp`, after); fs.renameSync(`${file}.tmp`, file); }
    }
  }
  return rows;
}

/** The last two numbers `work.mjs clean --stale --apply` prints, plus the landed worktrees and branches it cleared. */
export function parseWork(text) {
  const landed = /(\d+) worktrees and (\d+) bare branches removed/.exec(text);
  const stale = /stale: removed=(\d+) archived=(\d+)/.exec(text);
  return { removed: (landed ? Number(landed[1]) + Number(landed[2]) : 0) + Number(stale?.[1] ?? 0), archived: Number(stale?.[2] ?? 0) };
}

/** Runs the cleanup unless the owner is at the machine; returns the published row, or null when it stood down. */
export function cleanNow({ root = ROOT, now = Date.now(), log = console.log } = {}) {
  const p = presence();
  if (p.busy) { log(`clean: skipped, owner is using this machine: ${p.why.join('; ')}`); return null; }
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here */ }
  const w = spawnSync(process.execPath, ['scripts/work.mjs', 'clean', '--apply', '--stale'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const done = parseWork(w.stdout ?? '');
  const dir = state.stateDir();
  const logs = removeOld(path.join(dir, 'logs'), LOG_DAYS, now);
  const rows = pruneJsonl(dir, now);
  const tmp = removeOld(path.join(os.tmpdir(), 'marxy-verify'), TMP_DAYS, now);
  const row = {
    at: new Date(now).toISOString(), ...done,
    notes: `${w.status === 0 ? 'work clean ok' : `work clean exit ${w.status}`}; ${logs} old logs, ${rows} old rows, ${tmp} temporary folders`,
  };
  state.publish({ [`clean/${osName()}.json`]: `${JSON.stringify(row, null, 2)}\n` }, `${osName()} cleanup`);
  log(`clean: removed ${row.removed}, archived ${row.archived}; ${row.notes}`);
  return row;
}
