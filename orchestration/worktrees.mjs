// Plan and remove stale story worktrees when their PR merged, closed, or detached idle.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

export const DETACHED_AGE_HOURS = 24;

/** argv for `git worktree remove` — never `--force`. */
export function removeArgs(path) {
  return ['worktree', 'remove', path];
}

/**
 * @param {Array<{ path: string, branch: string | null, detached: boolean, dirty: boolean, prState: string | null, ageHours: number }>} entries
 * @param {{ orchestratorPath?: string }} [opts]
 */
export function prunePlan(entries, { orchestratorPath = ROOT } = {}) {
  const remove = [];
  const keep = [];
  const orch = resolve(orchestratorPath);

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

function prStateForBranch(branch, gh) {
  if (!branch) return null;
  const raw = gh(['pr', 'list', '--head', branch, '--json', 'state', '-q', '.[0].state']);
  return typeof raw === 'string' && raw ? raw : null;
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
      prState: branch ? prStateForBranch(branch, gh) : null,
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
} = {}) {
  const entries = gather ? gather() : gatherWorktreeEntries({ root, git, gh });
  const plan = prunePlan(entries, { orchestratorPath: root });
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
