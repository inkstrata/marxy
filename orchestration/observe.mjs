// What the reconciler can see, gathered once per cycle and handed to pure decisions (ADR-0034).
// Nothing here changes anything. Every call has a time limit (proc.mjs).
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, read, stillRunning } from './proc.mjs';
import { repoHome, runFile, readJsonOr, CODE_ROOT } from './store.mjs';
import { parseWorktreeList, keyOfBranch } from './worktrees.mjs';
import { pathsOf } from './lib.mjs';
import { rowOnBranch } from './plan.mjs';

const mtime = p => { try { return statSync(p).mtimeMs; } catch { return null; } };

/**
 * Every story worktree: its key, whether it holds uncommitted work or commits ahead of main, and the
 * last time anything happened in it (index, changed files, last commit). `list` and `gitIn` are
 * injectable for tests.
 */
export function observeWorktrees({
  home = repoHome(),
  list = () => read('git', ['-C', home, 'worktree', 'list', '--porcelain']) ?? '',
  gitIn = (wt, args) => read('git', ['--no-optional-locks', '-C', wt, ...args]),
} = {}) {
  const out = [];
  for (const row of parseWorktreeList(list())) {
    const key = keyOfBranch(row.branch);
    if (!key || row.prunable || !existsSync(row.path)) continue;
    const times = [];
    const index = gitIn(row.path, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    if (index) times.push(mtime(index));
    const status = gitIn(row.path, ['status', '--porcelain']);
    const dirtyFiles = (status ?? '').split('\n').filter(Boolean).map(l => l.slice(3).split(' -> ').pop());
    for (const f of dirtyFiles.slice(0, 200)) times.push(mtime(resolve(row.path, f)));
    const ahead = Number(gitIn(row.path, ['rev-list', '--count', 'origin/main..HEAD'])) || 0;
    if (ahead > 0) times.push((Number(gitIn(row.path, ['log', '-1', '--format=%ct'])) || 0) * 1000 || null);
    const known = times.filter(Number.isFinite);
    out.push({
      key, path: row.path, branch: row.branch,
      // An unreadable worktree counts as dirty: never treat what cannot be seen as empty.
      dirty: status === null || dirtyFiles.length > 0,
      ahead,
      lastActivityMs: known.length ? Math.max(...known) : null,
    });
  }
  return out;
}

/**
 * Paths reserved by something other than a board status: a claim that names its own paths (an
 * out-of-plan key whose row is only on its branch), and a worktree someone is working in right now.
 * A worktree idle past activeWorktreeMinutes holds nothing — it is listed under "Needs you" instead.
 */
export function pathHolds({ board, plan, worktrees = [], t, nowMs = Date.now(), rowOf = (key, branch) => rowOnBranch(branch, key) }) {
  const holds = [];
  for (const [key, rec] of Object.entries(board.stories)) {
    if (rec.claim?.paths?.length && Date.parse(rec.claim.until) > nowMs) holds.push({ key, paths: rec.claim.paths, why: `claimed by ${rec.claim.by}` });
  }
  const orchestrator = resolve(repoHome());
  for (const w of worktrees) {
    if (resolve(w.path) === orchestrator || resolve(w.path) === resolve(CODE_ROOT)) continue;
    const status = board.stories[w.key]?.status;
    if (status === 'in_progress' || status === 'in_review' || status === 'done') continue;
    if (!w.dirty && !(w.ahead > 0)) continue;
    const idleMin = w.lastActivityMs == null ? Infinity : (nowMs - w.lastActivityMs) / 60_000;
    if (idleMin > t.activeWorktreeMinutes) continue;
    const row = plan.byKey.get(w.key) ?? rowOf(w.key, w.branch);
    if (!row) continue;
    holds.push({ key: w.key, paths: pathsOf(row), path: w.path, why: `worktree active ${Math.round(idleMin)} min ago` });
  }
  return holds;
}

/**
 * What each unfinished run is doing: its exit record if the worker wrote one, whether its process is
 * still that process, and how much output it has produced (the heartbeat).
 */
export function observeRuns(board, { alive = stillRunning } = {}) {
  const out = {};
  for (const [id, run] of Object.entries(board.runs)) {
    if (run.ended) continue;
    const exit = readJsonOr(runFile(id, 'exit.json'));
    const log = runFile(id, 'out.log');
    out[id] = {
      exit,
      alive: exit ? false : alive({ pid: run.pid, match: run.match }),
      logBytes: existsSync(log) ? statSync(log).size : 0,
      logMtimeMs: mtime(log),
    };
  }
  return out;
}

/** Whether origin/main moved, and the checkout the code runs from, for the report only. */
export function fetchOrigin({ cwd = CODE_ROOT } = {}) {
  const r = git(['fetch', '-q', '--prune', 'origin'], { cwd });
  return r.ok ? null : `git fetch failed: ${(r.err || '').split('\n')[0]}`;
}
