// `pnpm work clean --stale`: archives what is worth keeping, then removes old worktrees, leftover folders and
// branches whose work is safe elsewhere. Selection rules are in stale.mjs; this is the git and file work.
// It fails closed: a command that fails never reads as "clean" or "empty", it keeps the thing and says why.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { archiveName, archiveTag, keepable, normPath, staleBranches, staleFolders, staleTrees } from './stale.mjs';
import { git, parseWorktrees } from './workspace.mjs';

const attempt = f => { try { return f(); } catch { return null; } };
const lines = text => (text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const first = e => String(e.stderr || e.message).trim().split('\n')[0];
const DAY = 864e5;

/** Where archives go: the automation's state folder (MARXY_STATE_DIR in tests). */
const archiveRoot = () => join(process.env.MARXY_STATE_DIR || join(homedir(), '.local', 'state', 'fleet', 'marxy'), 'archive', 'worktrees');

// tar runs inside the archive folder with a bare file name: GNU tar reads "C:" in a path as a remote host.
const tar = (dir, args, input) => spawnSync('tar', args, { cwd: dir, input, encoding: 'utf8', maxBuffer: 1 << 28 });
/** Files (not folders) a tar lists, or null when it cannot be read: the number to hold against what was meant to go in. */
function tarCount(dir, name) {
  const r = tar(dir, ['-tf', name]);
  return r.status === 0 ? lines(r.stdout).filter(l => !l.endsWith('/')).length : null;
}

/** Walks `dir` without following links, calling `visit(path, name, isDir)`; a visit that returns true stops it. null on any read error. */
function walk(dir, skip, visit) {
  const stack = [dir];
  try {
    while (stack.length) {
      const d = stack.pop();
      for (const name of readdirSync(d)) {
        if (skip.includes(name)) continue;
        const p = join(d, name);
        const isDir = lstatSync(p).isDirectory();
        if (visit(p, name, isDir)) return true;
        if (isDir) stack.push(p);
      }
    }
  } catch { return null; }
  return false;
}
const containsGit = dir => walk(dir, ['node_modules', 'target'], (p, name) => name === '.git') !== false;
/** Newest file or folder time in a worktree (builds and .git left out); stops as soon as one is newer than `since`. NaN if unreadable. */
function newestTouch(dir, since) {
  let newest = attempt(() => lstatSync(dir).mtimeMs) ?? NaN;
  if (newest > since) return newest;
  const ok = walk(dir, ['node_modules', 'target', 'dist', '.git'], p => { newest = Math.max(newest, lstatSync(p).mtimeMs); return newest > since; });
  return ok === null ? NaN : newest;
}
const strayFiles = dir => { const out = []; return walk(dir, ['node_modules', 'target'], (p, n, isDir) => { if (!isDir) out.push(p); }) === null ? null : out.length; };

function treeFacts(main, head, remoteTags) {
  try {
    const remotes = lines(git(main, 'branch', '-r', '--contains', head));
    const tags = lines(git(main, 'tag', '--points-at', head)).filter(t => t.startsWith('archive/'));
    return {
      onOrigin: remotes.some(l => !l.includes('->')),
      // An archive tag keeps a commit only once origin has it too.
      tagged: !!remoteTags && tags.some(t => remoteTags.has(t)),
      commitMs: Number(git(main, 'log', '-1', '--format=%ct', head)) * 1000,
    };
  } catch (e) { return { error: first(e), commitMs: NaN }; }
}

/** Saves a worktree's uncommitted, untracked and ignored files; throws when any step fails or the tar lacks a file. */
function saveChanges(path, dir) {
  if (!existsSync(path)) return;
  const status = git(path, 'status', '--porcelain');
  const patch = git(path, 'diff', 'HEAD', '--binary');
  const others = git(path, 'ls-files', '--others', '--exclude-standard', '-z');
  const ignored = git(path, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z');
  const files = keepable([...others.split('\0'), ...ignored.split('\0')].filter(Boolean));
  if (!status.trim() && !files.length) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'changes.patch'), patch);
  if (!files.length) return;
  const made = tar(dir, ['-cf', 'untracked.tar', '-C', path, '--null', '-T', '-'], files.join('\0') + '\0');
  if (made.status !== 0 || tarCount(dir, 'untracked.tar') !== files.length) throw new Error('the archive of untracked and ignored files is incomplete');
}

/** Removes a registered worktree the way git does; never falls back to deleting its folder. Throws with git's reason. */
function removeWorktree(main, path) {
  const r = spawnSync('git', ['-C', main, 'worktree', 'remove', '--force', path], { encoding: 'utf8' });
  if (r.status === 0) return;
  // A worktree whose folder is already gone is only a record: prune it, and check it went.
  if (!existsSync(path)) {
    git(main, 'worktree', 'prune');
    if (!parseWorktrees(git(main, 'worktree', 'list', '--porcelain')).some(t => normPath(t.path) === normPath(path))) return;
  }
  throw new Error(first({ stderr: r.stderr, message: 'git worktree remove failed' }));
}

/** Runs the stale pass; returns { removed, archived, lines }. Without `apply` it only lists. */
export function runStale(ctx, { apply = false, now = Date.now(), date = new Date(now).toISOString().slice(0, 10) } = {}) {
  const { ws, root } = ctx;
  const main = ws.main;
  const out = [];
  const tally = { removed: 0, archived: 0 };
  const verb = apply ? 'removed ' : 'would go';
  const say = (what, name, extra = '') => out.push(`${what} ${name.padEnd(30)} ${extra}`.trimEnd());
  // Without a fresh view of origin nothing can be called safe, so nothing is removed.
  const fetched = attempt(() => git(main, 'fetch', '--prune', 'origin')) !== null;
  if (!fetched) {
    say('kept    ', '(everything)', 'git fetch --prune failed');
    if (apply) return { ...tally, lines: out };
  }
  const remoteTags = attempt(() => new Set(lines(git(main, 'ls-remote', '--tags', 'origin')).map(l => l.split(/\s+/)[1]?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')).filter(Boolean)));

  const protectedPaths = [main, join(ws.worktrees, 'nightly'), root].map(p => normPath(p));
  const records = ws.trees.map(t => {
    const r = { ...t, name: basename(t.path), isMain: normPath(t.path) === normPath(main), protectedPath: protectedPaths.includes(normPath(t.path)), ...treeFacts(main, t.head, remoteTags) };
    // Walking a tree costs, so only one whose last commit is already old is looked at.
    if (Number.isFinite(r.commitMs) && now - r.commitMs > 30 * DAY && !r.isMain && !r.protectedPath) r.touchedMs = existsSync(t.path) ? newestTouch(t.path, now - 30 * DAY) : 0;
    return r;
  });
  for (const r of records) if (r.error) say('kept    ', r.name, `git could not say: ${r.error}`);
  for (const t of staleTrees(records, now)) {
    const dir = join(archiveRoot(), archiveName(t.name, date));
    const tag = archiveTag(t);
    if (!apply) { say('would go', t.name, `${t.branch ?? '(detached)'} ${t.safe ? 'tip is on origin or tagged' : `tip is kept as ${tag}`}`); continue; }
    try {
      if (!t.safe) {
        const made = attempt(() => git(main, 'tag', '-a', tag, '-m', `archived with the stale worktree ${t.name}`, t.head)) !== null || attempt(() => git(main, 'rev-parse', `${tag}^{commit}`))?.trim() === t.head;
        if (!made) throw new Error(`could not tag ${tag}`);
        git(main, 'push', 'origin', tag);
        tally.archived++;
      }
      saveChanges(t.path, dir);
      if (existsSync(dir)) tally.archived++;
    } catch (e) { say('kept    ', t.name, first(e)); continue; }
    try { removeWorktree(main, t.path); tally.removed++; say(verb, t.name, t.branch ?? ''); } catch (e) { say('kept    ', t.name, `git would not remove it: ${first(e)}`); }
  }

  // Folders git forgot: old pipelines' checkouts. Their files are kept as a tar, minus what a build can remake.
  const entries = existsSync(ws.worktrees) ? readdirSync(ws.worktrees, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    const path = join(ws.worktrees, e.name);
    return { name: e.name, path, touchedMs: newestTouch(path, now - 14 * DAY), hasGit: containsGit(path) };
  }) : [];
  for (const f of staleFolders(entries, ws.trees.map(t => t.path), now)) {
    if (!apply) { say('would go', f.name, 'folder git does not know, untouched for 14 days'); continue; }
    const dir = join(archiveRoot(), archiveName(f.name, date));
    const meant = strayFiles(f.path);
    mkdirSync(dir, { recursive: true });
    const made = tar(dir, ['--exclude=node_modules', '--exclude=target', '-cf', `${f.name}.tar`, '-C', ws.worktrees, f.name]);
    if (meant === null || made.status !== 0 || tarCount(dir, `${f.name}.tar`) !== meant) { say('kept    ', f.name, 'its archive is not complete'); continue; }
    tally.archived++;
    try { rmSync(f.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); tally.removed++; say(verb, f.name, 'folder'); } catch (e) { say('FAILED  ', f.name, first(e)); }
  }

  // Branches nothing checks out whose commits are on origin/main or under an archive tag.
  try {
    const held = parseWorktrees(git(main, 'worktree', 'list', '--porcelain')).map(t => t.branch).filter(Boolean);
    const inMain = new Set(lines(git(main, 'branch', '--merged', 'origin/main', '--format=%(refname:short)')));
    const tagged = new Set(lines(git(main, 'for-each-ref', 'refs/tags/archive', '--format=%(refname:short) %(objectname) %(*objectname)'))
      .flatMap(l => { const [name, ...shas] = l.split(' '); return remoteTags?.has(name) ? shas : []; }));
    const branches = lines(git(main, 'for-each-ref', 'refs/heads', '--format=%(refname:short) %(objectname)')).map(l => {
      const [name, sha] = l.split(' ');
      return { name, inMain: inMain.has(name), tagged: tagged.has(sha) };
    });
    for (const b of staleBranches(branches, held)) {
      if (apply && attempt(() => git(main, 'branch', '-D', b)) === null) { say('FAILED  ', '(branch only)', b); continue; }
      if (apply) tally.removed++;
      say(verb, '(branch only)', b);
    }
  } catch (e) { say('kept    ', '(branches)', `git could not say: ${first(e)}`); }
  return { ...tally, lines: out };
}
