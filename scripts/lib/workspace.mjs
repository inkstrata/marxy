// Where work happens around a checkout. Worktrees (one per branch being worked on) sit in a sibling folder named after
// the main checkout with `-wt` (`~/Dev/marxy` -> `~/Dev/marxy-wt/<name>`). Tracking and run records are committed in the
// tree's own `work/` folder (see work/README.md), so they travel with the branch and reach every machine through git.
// Kept installers go in the main checkout's `builds/`, which git ignores.
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

/** Branches made for a piece of work carry this prefix; the tools touch no other branch. */
export const BRANCH_PREFIX = 'agent/';

/** git in `cwd`; throws with git's own message on a non-zero exit. */
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** `git worktree list --porcelain` as records, the main checkout first. `branch` is the short name, or null when detached. */
export function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), head: '', branch: null, detached: false, prunable: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return out;
}

/**
 * The paths around the tree at `root`. `main` is the main checkout (git names it first, so every worktree agrees);
 * `worktrees` is `<main>-wt` unless MARXY_WORKTREES names another folder; `work` and `todo` are the records committed in
 * the tree at `root`, so a branch reads and edits its own copy of the tracker.
 */
export function workspace(root, env = process.env) {
  const trees = parseWorktrees(git(root, 'worktree', 'list', '--porcelain'));
  const main = resolve(trees[0].path);
  const work = join(resolve(root), 'work');
  const worktrees = env.MARXY_WORKTREES ? resolve(env.MARXY_WORKTREES) : `${main}-wt`;
  return { dir: dirname(main), main, checkout: basename(main), trees, worktrees, builds: join(main, 'builds'), work, todo: join(work, 'todo.md') };
}

/**
 * Where a branch stands against `base`: 'base' (it is the base), 'at-base' (same commit: new, or fast-forwarded into),
 * 'merged' (every commit is in the base), or 'open' (it has commits the base lacks).
 */
export function branchState(name, sha, { base, baseSha, merged }) {
  if (name === base) return 'base';
  if (sha === baseSha) return 'at-base';
  return merged.has(name) ? 'merged' : 'open';
}

/**
 * True when nothing has been committed on the branch since it was made: its reflog is the creation entry alone.
 * Such a branch is an ancestor of the base as soon as the base moves on, yet it is work about to begin, not work done.
 * A branch whose reflog has expired reads as started.
 */
export function unstarted(root, name) {
  try {
    const entries = git(root, 'reflog', 'show', '--format=%gs', name).split(/\r?\n/).filter(Boolean);
    return entries.length > 0 && entries.every(e => e.startsWith('branch: Created from'));
  } catch {
    return false;
  }
}

/**
 * Every local branch with its commit, the base's commit, and the set of branches that have landed: those whose commits
 * are all in the base, and those whose upstream is gone. A pull request merged on GitHub by squash leaves the branch's
 * own commits outside the base, but GitHub deletes the remote branch, so after `git fetch --prune` its upstream is gone.
 */
export function branchFacts(root, base = 'main') {
  const baseSha = git(root, 'rev-parse', `${base}^{commit}`).trim();
  const heads = new Map();
  const merged = new Set(git(root, 'branch', '--merged', base, '--format=%(refname:short)').split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  for (const line of git(root, 'for-each-ref', '--format=%(refname:short) %(objectname) %(upstream:track)', 'refs/heads').split(/\r?\n/)) {
    const [name, sha, track] = line.split(' ');
    if (!name || !sha) continue;
    heads.set(name, sha);
    if (track === '[gone]') merged.add(name);
  }
  return { base, baseSha, heads, merged };
}
