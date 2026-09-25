// Plan and remove stale story worktrees when their PR merged, closed, or detached idle.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, readJson, stories, pathsOf } from './lib.mjs';

export const DETACHED_AGE_HOURS = 24;

/** First `MARXY-\\d+` in a branch name, if any. */
export function keyOfBranch(branch) {
  if (!branch) return null;
  const m = String(branch).match(/MARXY-\d+/);
  return m ? m[0] : null;
}

/** Commits on HEAD not on origin/main in this worktree; 0 when the ref is missing. */
function commitsAhead(wtPath, gitAtRoot) {
  const out = gitAtRoot(['-C', wtPath, 'rev-list', '--count', 'origin/main..HEAD']);
  if (typeof out !== 'string' || !out.trim()) return 0;
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

/** `parseWorktreeList` rows plus `ahead` and the dirty bit `gatherWorktreeEntries` already computes. */
export function readLiveEntries(opts = {}) {
  return gatherWorktreeEntries(opts).map(row => {
    const gitAtRoot = opts.git ?? (a => defaultSh('git', a, { cwd: opts.root ?? ROOT }));
    return { ...row, ahead: commitsAhead(row.path, gitAtRoot) };
  });
}

/** Main CSV row for `key`, else the same key from the worktree's own `docs/plan/jira-issues.csv`. */
export function defaultRowsOf(mainStories = stories()) {
  const onMain = Object.fromEntries(mainStories.map(st => [st.Key, st]));
  return (key, worktreePath) => {
    if (onMain[key]) return onMain[key];
    const csvPath = resolve(worktreePath, 'docs/plan/jira-issues.csv');
    if (!existsSync(csvPath)) return null;
    return stories(readFileSync(csvPath, 'utf8')).find(st => st.Key === key) ?? null;
  };
}

/**
 * Paths held by live worktrees that have not opened a finished PR yet. `rowsOf(key, worktreePath)`
 * supplies the board row; `isDone` is usually `state.json` done status only.
 */
export function liveClaims(entries, { orchestratorPath = ROOT, rowsOf: rowsOfKey = () => null, isDone = () => false } = {}) {
  const orch = resolve(orchestratorPath);
  const out = [];
  for (const entry of entries) {
    if (resolve(entry.path) === orch) continue;
    const key = keyOfBranch(entry.branch);
    if (!key || isDone(key)) continue;
    const dirty = Boolean(entry.dirty);
    const ahead = Number(entry.ahead) || 0;
    if (!dirty && ahead <= 0) continue;
    const row = rowsOfKey(key, entry.path);
    if (!row) {
      out.push({ key, path: entry.path, reason: 'no row' });
      continue;
    }
    out.push({ key, paths: pathsOf(row), path: entry.path, ahead, dirty });
  }
  return out;
}

/** Cycle log line for one claim (`worktree holds paths: …`). */
export function formatClaimLine(claim) {
  if (claim.reason === 'no row') {
    return `worktree holds paths: ${claim.key} (${claim.path}, no row, no PR)`;
  }
  const cleanliness = claim.dirty ? 'dirty' : 'clean';
  const aheadLabel = claim.ahead === 1 ? '1 commit ahead' : `${claim.ahead} commits ahead`;
  return `worktree holds paths: ${claim.key} (${claim.path}, ${aheadLabel}, ${cleanliness}, no PR)`;
}

export function sayWorktreeClaims(claims, { say = line => console.log(line) } = {}) {
  for (const claim of claims) say(formatClaimLine(claim));
}

/** argv for `git worktree remove` — never `--force`. */
export function removeArgs(path) {
  return ['worktree', 'remove', path];
}

/** Branches of stories an implementor is working on right now, from the board mirror. Reads
 * state.json without creating it: lib.state() seeds a missing file, and a prune must not write. */
export function inProgressBranches(s = existsSync(here('state.json')) ? readJson(here('state.json')) : {}) {
  return Object.values(s.stories ?? {}).filter(r => r.status === 'in_progress' && r.branch).map(r => r.branch);
}

/**
 * @param {Array<{ path: string, branch: string | null, detached: boolean, dirty: boolean, prState: string | null, ageHours: number }>} entries
 * @param {{ orchestratorPath?: string, activeBranches?: string[] }} [opts]
 */
export function prunePlan(entries, { orchestratorPath = ROOT, activeBranches = [] } = {}) {
  const remove = [];
  const keep = [];
  const orch = resolve(orchestratorPath);
  const active = new Set(activeBranches);

  for (const entry of entries) {
    const at = resolve(entry.path);
    if (at === orch) {
      keep.push({ ...entry, reason: 'orchestrator checkout' });
      continue;
    }
    if (entry.dirty) {
      keep.push({ ...entry, reason: 'uncommitted work' });
      continue;
    }
    // A second attempt reuses the branch, and the first attempt's PR may already be closed. A
    // fresh worktree is clean, so "closed" alone would remove it from under the implementor.
    if (entry.branch && active.has(entry.branch)) {
      keep.push({ ...entry, reason: 'story in progress' });
      continue;
    }
    if (entry.prState === 'OPEN') {
      keep.push({ ...entry, reason: 'PR open' });
      continue;
    }
    if (entry.prState === 'MERGED') {
      remove.push({ ...entry, reason: 'PR merged' });
      continue;
    }
    if (entry.prState === 'CLOSED') {
      remove.push({ ...entry, reason: 'PR closed' });
      continue;
    }
    if (entry.detached) {
      if (entry.ageHours > DETACHED_AGE_HOURS) {
        remove.push({ ...entry, reason: 'detached scratch older than 24 h' });
      } else {
        keep.push({ ...entry, reason: 'detached scratch under 24 h' });
      }
      continue;
    }
    keep.push({ ...entry, reason: 'no finished PR' });
  }
  return { remove, keep };
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktreeList(porcelain) {
  const rows = [];
  let cur = null;
  for (const line of String(porcelain ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) rows.push(cur);
      cur = { path: line.slice('worktree '.length), branch: null, detached: false };
    } else if (!cur) continue;
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
  }
  if (cur) rows.push(cur);
  return rows;
}

function defaultSh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
  } catch (e) {
    return { error: (e.stdout ?? '') + (e.stderr ?? e.message) };
  }
}

/** `gh pr list` defaults to open PRs only, so without --state a merged branch looks PR-less. */
export function prListArgs(branch) {
  return ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '100', '--json', 'state'];
}

/**
 * One state for a branch that may have had several PRs. A live PR outranks a landed one, and a
 * landed one outranks an abandoned one, so a closed first attempt never hides the open second.
 */
export function pickPrState(raw) {
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const states = new Set(rows.map(r => r?.state));
  return ['OPEN', 'MERGED', 'CLOSED'].find(s => states.has(s)) ?? null;
}

function prStateForBranch(branch, gh) {
  if (!branch) return null;
  const raw = gh(prListArgs(branch));
  return typeof raw === 'string' && raw ? pickPrState(raw) : null;
}

function worktreeAgeHours(wtPath, gitAtRoot) {
  const index = gitAtRoot(['-C', wtPath, 'rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (typeof index !== 'string' || !index || !existsSync(index)) return 0;
  try {
    const mtimeMs = statSync(index).mtimeMs;
    return (Date.now() - mtimeMs) / 3_600_000;
  } catch {
    return 0;
  }
}

/** Build prunePlan inputs from live git/gh state. Injectable for tests. */
export function gatherWorktreeEntries({
  root = ROOT,
  git = a => defaultSh('git', a, { cwd: root }),
  gh = a => defaultSh('gh', a, { cwd: root }),
  // The cycle's snapshot answers every branch in one call (MARXY-191); without it, one call each.
  branchState = null,
} = {}) {
  const list = git(['worktree', 'list', '--porcelain']);
  if (typeof list !== 'string') return [];
  return parseWorktreeList(list).map(row => {
    const dirtyOut = git(['--no-optional-locks', '-C', row.path, 'status', '--porcelain']);
    const dirty = typeof dirtyOut !== 'string' || dirtyOut.length > 0;
    const branch = row.detached ? null : row.branch;
    return {
      path: row.path,
      branch,
      detached: row.detached,
      dirty,
      prState: branch ? (branchState ? branchState(branch) : prStateForBranch(branch, gh)) : null,
      ageHours: worktreeAgeHours(row.path, git),
    };
  });
}

export function removeWorktreeAt(path, { root = ROOT, git = a => defaultSh('git', a, { cwd: root }), say = () => {} } = {}) {
  const r = git(removeArgs(path));
  if (typeof r !== 'string') {
    say(`worktree: remove failed for ${path} — ${String(r.error ?? r).trim().split('\n')[0]}`);
    return false;
  }
  return true;
}

/** Print the plan; remove worktrees unless dryRun. Returns the plan. */
export function runWorktreePrune({
  dryRun = false,
  root = ROOT,
  say = line => console.log(line),
  git,
  gh,
  gather,
  branchState,
  activeBranches = inProgressBranches(),
} = {}) {
  const entries = gather ? gather() : gatherWorktreeEntries({ root, git, gh, branchState });
  const plan = prunePlan(entries, { orchestratorPath: root, activeBranches });
  const gitAtRoot = git ?? (a => defaultSh('git', a, { cwd: root }));
  for (const entry of plan.remove) {
    say(`worktree remove ${entry.path} — ${entry.reason}`);
    if (!dryRun) removeWorktreeAt(entry.path, { root, git: gitAtRoot, say });
  }
  for (const entry of plan.keep) {
    say(`worktree keep ${entry.path} — ${entry.reason}`);
  }
  return plan;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  runWorktreePrune({ dryRun });
}
