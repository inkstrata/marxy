// The fleet's runtime store: one directory beside the git objects, shared by every worktree of this
// clone, never tracked and never able to make a checkout dirty (ADR-0034).
//
//   <git common dir>/marxy-fleet/
//     events.jsonl        append-only; every decision and every fact the fleet acted on. The board
//                         is a fold over it (machine.mjs), so nothing else is a source of truth.
//     runs/<run>/         one directory per worker run: run.json (what was asked), out.log (the
//                         agent's output, which is also its heartbeat), exit.json (how it ended)
//     results/            the hand-offs: KEY.json (implementor), KEY.approved (reviewer, signed),
//                         KEY.notes.md (why it was returned). One location, whichever worktree wrote it.
//     wip/                patches of worktrees the fleet snapshotted before reusing them
//     cycle.lock, loop.lease, loop.log, status.md, report.json
//
// Every worktree of the clone resolves the same directory through `git rev-parse --git-common-dir`,
// so `pnpm done` in a story worktree, a reviewer in the orchestrator checkout and the loop in its own
// runner worktree all read and write one place. `MARXY_FLEET_DIR` points it elsewhere for tests.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** The checkout this code runs from. Only for locating git; never the source of plan or state. */
export const CODE_ROOT = new URL('../', import.meta.url).pathname;

let common = null;
/** `.git` of the main checkout, absolute, whichever worktree asks. */
export function gitCommonDir() {
  if (process.env.MARXY_GIT_COMMON_DIR) return process.env.MARXY_GIT_COMMON_DIR;
  common ??= execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: CODE_ROOT, encoding: 'utf8' }).trim();
  return common;
}

const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.some(a => a === '--test' || a.startsWith('--test='));
let testDir = null;

/**
 * The fleet directory, created on first use. Under `node --test` with no MARXY_FLEET_DIR it is a
 * fresh temporary directory per process: a test must never read or migrate the real fleet.
 */
export function fleetDir() {
  let dir = process.env.MARXY_FLEET_DIR;
  if (!dir && underTest()) dir = testDir ??= mkdtempSync(join(tmpdir(), 'marxy-fleet-test-'));
  dir ??= join(gitCommonDir(), 'marxy-fleet');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The main checkout: the directory that owns `.git`. Story worktrees sit beside it. */
export function repoHome() {
  return process.env.MARXY_REPO_HOME ?? dirname(gitCommonDir());
}

/** Where story worktrees live: `<repo home>/../marxy-wt/KEY`, the convention every script uses. */
export const worktreeBase = () => process.env.MARXY_WORKTREES ?? resolve(repoHome(), '..', 'marxy-wt');
export const worktreeFor = key => join(worktreeBase(), key);

export const fleetPath = (...parts) => {
  const p = join(fleetDir(), ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

export const eventsPath = () => fleetPath('events.jsonl');
export const resultPath = key => fleetPath('results', `${key}.json`);
export const approvalPath = key => fleetPath('results', `${key}.approved`);
export const notesPath = key => fleetPath('results', `${key}.notes.md`);
export const runDir = run => fleetPath('runs', run, '.');
export const runFile = (run, name) => fleetPath('runs', run, name);
export const cycleLockPath = () => fleetPath('cycle.lock');
export const loopLeasePath = () => fleetPath('loop.lease');

/** Who is writing an event: the script and its pid, unless the caller says. */
export function actor(argv = process.argv) {
  return `${basename(argv[1] ?? 'node')}:${process.pid}`;
}

/**
 * Append one event. A single `write` with O_APPEND, so writers never interleave within a line and no
 * lock is needed: the fold (machine.mjs) decides what an event means, and a transition whose guard no
 * longer holds is rejected there, never half-applied here.
 */
export function append(event, { now = new Date(), path = eventsPath() } = {}) {
  const problem = eventProblem(event);
  if (problem) throw new Error(`refusing to append a malformed event (${problem}): ${JSON.stringify(event).slice(0, 200)}`);
  const e = { at: now.toISOString(), by: actor(), ...event };
  appendFileSync(path, JSON.stringify(e) + '\n');
  return e;
}

const KEY_RE = /^MARXY-(\d+|NEW-[a-z0-9-]+)$/;
const STATUSES = new Set(['todo', 'in_progress', 'in_review', 'blocked', 'escalate', 'done']);

/**
 * Why an event cannot be appended, or null. The log is the fleet's only record, so a malformed line
 * is refused at the door rather than skipped by every reader afterwards.
 */
export function eventProblem(e) {
  if (!e || typeof e !== 'object') return 'not an object';
  switch (e.type) {
    case 'story':
      if (!KEY_RE.test(e.key ?? '')) return `story event with key ${JSON.stringify(e.key)}`;
      if (e.to && !STATUSES.has(e.to)) return `unknown status ${e.to}`;
      for (const f of [].concat(e.from ?? [])) if (!STATUSES.has(f)) return `unknown from-status ${f}`;
      if (e.set && typeof e.set !== 'object') return 'set is not an object';
      if (e.unset && !Array.isArray(e.unset)) return 'unset is not a list';
      if (e.inc && Object.values(e.inc).some(n => !Number.isFinite(n))) return 'inc holds a non-number';
      return null;
    case 'run': return typeof e.run === 'string' && e.run && e.set && typeof e.set === 'object' ? null : 'run event needs a run id and a set';
    case 'board': return e.set || e.inc ? null : 'board event needs set or inc';
    case 'imported': return e.board?.stories && typeof e.board.stories === 'object' ? null : 'imported event needs board.stories';
    default: return `unknown event type ${JSON.stringify(e.type)}`;
  }
}

/** Every event in order. A torn or hand-mangled line is skipped and counted, never fatal. */
export function readEvents(path = eventsPath()) {
  if (!existsSync(path)) return { events: [], skipped: 0 };
  const events = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { skipped++; }
  }
  return { events, skipped };
}

export const readJsonOr = (path, fallback = null) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

/** Written aside and renamed into place: a reader sees the old file or the new one. */
export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Run ids in the store, oldest first by name (they embed a timestamp). */
export function listRuns() {
  const dir = join(fleetDir(), 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

/** A run id: sortable, and naming what it is at a glance. `MARXY-12.implement.20260926T101500Z`. */
export function newRunId(key, role, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${key ?? 'fleet'}.${role}.${stamp}`;
}
