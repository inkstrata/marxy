// Computed review order for In Review pull requests. Phase, then disturbance descending, then
// age oldest first (ADR-0025). GitHub is read only through readPullRequest so --selftest can
// replace it.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deps, state } from './lib.mjs';
import { primed } from './github.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Files every PR touches; counting them would make disturbance uniform and useless. */
export const SHARED_PATHS = ['CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml'];
const RESULT_JSON = /^orchestration\/results\/[^/]+\.json$/;

export function countsForDisturbance(file) {
  return !SHARED_PATHS.includes(file) && !RESULT_JSON.test(file);
}

let realGithubReads = 0;
export function realReadCount() {
  return realGithubReads;
}

/** The only function that talks to the network. Selftest replaces it. */
export function readPullRequest(pr) {
  // The cycle's one snapshot already holds every open PR (MARXY-191); only a PR it lacks costs a call.
  const cached = primed()?.byNumber.get(Number(pr));
  if (cached) {
    return {
      files: (cached.files ?? []).map(f => f.path),
      mergeStateStatus: cached.mergeStateStatus,
      mergeable: cached.mergeable,
      createdAt: cached.createdAt,
    };
  }
  realGithubReads += 1;
  const data = JSON.parse(
    execFileSync('gh', ['pr', 'view', String(pr), '--json', 'files,mergeStateStatus,mergeable,createdAt'], {
      encoding: 'utf8',
    }),
  );
  return {
    files: (data.files ?? []).map(f => f.path),
    mergeStateStatus: data.mergeStateStatus,
    mergeable: data.mergeable,
    createdAt: data.createdAt,
  };
}

export class PhaseError extends Error {
  constructor(key, phases) {
    const listed = [...phases].sort((a, b) => a - b).join(', ');
    super(`${key} is in ${phases.length === 0 ? 'no phase' : `phases ${listed}`}`);
    this.name = 'PhaseError';
    this.key = key;
    this.phases = phases;
  }
}

export function phaseIndex(d) {
  const map = new Map();
  for (const [phase, keys] of Object.entries(d.phases || {})) {
    for (const key of keys || []) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(Number(phase));
    }
  }
  return map;
}

function isConflicted(pr) {
  return pr.mergeStateStatus === 'DIRTY' || pr.mergeable === 'CONFLICTING';
}

function intersect(a, b) {
  const set = new Set(a);
  return b.some(f => set.has(f));
}

/** `readPr` is the injectable GitHub read; pass readPullRequest in live use. */
export function computeOrder({ s = state(), d = deps(), readPr, now = Date.now() } = {}) {
  if (typeof readPr !== 'function') {
    throw new Error('computeOrder requires readPr; pass readPullRequest in live use');
  }
  const index = phaseIndex(d);
  for (const [key, phases] of index) {
    if (phases.length > 1) throw new PhaseError(key, phases);
  }

  const excluded = [];
  const candidates = [];
  for (const [key, rec] of Object.entries(s.stories || {})) {
    if (rec.status !== 'in_review') continue;
    if (rec.pr == null || rec.pr === '') {
      excluded.push({ key, why: 'no pull request number' });
      continue;
    }
    // An adopted PR whose row is still only on its own branch carries the phase it was adopted with
    // (MARXY-190); every key on main must still be in exactly one phase.
    const phases = index.get(key) ?? (rec.phase != null ? [Number(rec.phase)] : []);
    if (phases.length !== 1) throw new PhaseError(key, phases);
    let prData;
    try {
      prData = readPr(rec.pr);
    } catch (e) {
      excluded.push({ key, pr: rec.pr, why: `could not read pull request: ${e.message}` });
      continue;
    }
    candidates.push({
      key,
      pr: rec.pr,
      phase: phases[0],
      files: (prData.files ?? []).filter(countsForDisturbance),
      conflicted: isConflicted(prData),
      behind: prData.mergeStateStatus === 'BEHIND',
      dirty: prData.mergeStateStatus === 'DIRTY',
      ageHours: prData.createdAt == null ? 0 : (now - Date.parse(prData.createdAt)) / 36e5,
    });
  }

  for (const c of candidates) {
    c.disturbs = candidates.filter(o => o !== c && intersect(c.files, o.files)).length;
  }

  const order = [];
  for (const c of candidates) {
    const row = {
      key: c.key,
      pr: c.pr,
      phase: c.phase,
      disturbs: c.disturbs,
      ageHours: c.ageHours,
      behind: c.behind,
      dirty: c.dirty,
    };
    if (c.conflicted) {
      const why = c.dirty
        ? 'conflicts with main (mergeStateStatus DIRTY)'
        : 'conflicts with main (mergeable CONFLICTING)';
      excluded.push({ key: c.key, pr: c.pr, why });
    } else order.push(row);
  }

  // The ops lane (`phase` NaN) is beside the numbered phases, and product is reviewed first
  // (MARXY-107), so it ranks after them. NaN used to make this comparator inconsistent (MARXY-191).
  const rank = p => (Number.isFinite(p) ? p : Number.POSITIVE_INFINITY);
  order.sort((a, b) => {
    if (rank(a.phase) !== rank(b.phase)) return rank(a.phase) - rank(b.phase);
    if (a.disturbs !== b.disturbs) return b.disturbs - a.disturbs;
    if (a.ageHours !== b.ageHours) return b.ageHours - a.ageHours;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return { order, excluded };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.argv.includes('--selftest')) {
    const r = spawnSync(process.execPath, [resolve(here, 'test/review-order.test.mjs'), '--run-selftest'], {
      stdio: 'inherit',
    });
    process.exit(r.status ?? 1);
  } else {
    try {
      console.log(JSON.stringify(computeOrder({ readPr: readPullRequest }), null, 2));
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
}
