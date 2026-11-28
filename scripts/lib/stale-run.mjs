// `pnpm work clean --stale`: archives what is worth keeping, then removes old worktrees, leftover folders and
// branches whose work is safe elsewhere. Selection rules are in stale.mjs; this is the git and file work.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { archiveName, archiveTag, staleBranches, staleFolders, staleTrees } from './stale.mjs';
import { git, parseWorktrees } from './workspace.mjs';

const attempt = f => { try { return f(); } catch { return null; } };
const lines = text => (text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** Where archives go: the automation's state folder (MARXY_STATE_DIR in tests). */
const archiveRoot = () => join(process.env.MARXY_STATE_DIR || join(homedir(), '.local', 'state', 'fleet', 'marxy'), 'archive', 'worktrees');

// tar runs inside the archive folder with a bare file name: GNU tar reads "C:" in a path as a remote host.
const tar = (dir, args, input) => spawnSync('tar', args, { cwd: dir, input, encoding: 'utf8', maxBuffer: 1 << 28 });
/** True when the tar file lists at least one entry: an archive nobody can read is not a reason to delete. */
const tarHasFiles = (dir, name) => {
  const r = tar(dir, ['-tf', name]);
  return r.status === 0 && lines(r.stdout).length > 0;
};

function treeFacts(main, head) {
  const remotes = lines(attempt(() => git(main, 'branch', '-r', '--contains', head)));
  const tags = lines(attempt(() => git(main, 'tag', '--points-at', head)));
  return {
    onOrigin: remotes.some(l => !l.includes('->')),
    tagged: tags.some(t => t.startsWith('archive/')),
    commitMs: Number(attempt(() => git(main, 'log', '-1', '--format=%ct', head))) * 1000,
  };
}

/** Saves a dirty worktree's changes; false when something that should be kept could not be. */
function saveChanges(path, dir) {
  if (!existsSync(path) || !lines(attempt(() => git(path, 'status', '--porcelain'))).length) return true;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'changes.patch'), attempt(() => git(path, 'diff', 'HEAD', '--binary')) ?? '');
  const untracked = attempt(() => git(path, 'ls-files', '--others', '--exclude-standard', '-z')) ?? '';
  if (!untracked) return true;
  return tar(dir, ['-cf', 'untracked.tar', '-C', path, '--null', '-T', '-'], untracked).status === 0 && tarHasFiles(dir, 'untracked.tar');
}

function removeWorktree(main, path) {
  if (spawnSync('git', ['-C', main, 'worktree', 'remove', '--force', path], { encoding: 'utf8' }).status === 0) return;
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  git(main, 'worktree', 'prune');
}

/** Newest modification among a folder and its top-level entries (a folder's own time ignores edits inside it). */
const touchedMs = dir => Math.max(statSync(dir).mtimeMs, ...(attempt(() => readdirSync(dir).map(n => statSync(join(dir, n)).mtimeMs)) ?? []));

/** Runs the stale pass; returns { removed, archived, lines }. Without `apply` it only lists. */
export function runStale(ctx, { apply = false, now = Date.now(), date = new Date(now).toISOString().slice(0, 10) } = {}) {
  const { ws, root } = ctx;
  const main = ws.main;
  const out = [];
  const tally = { removed: 0, archived: 0 };
  const verb = apply ? 'removed ' : 'would go';
  const say = (what, name, extra = '') => out.push(`${what} ${name.padEnd(30)} ${extra}`.trimEnd());
  attempt(() => git(main, 'fetch', '--prune', 'origin'));

  const protectedPaths = [main, join(ws.worktrees, 'nightly'), root];
  const records = ws.trees.map(t => ({ ...t, name: basename(t.path), isMain: same(t.path, main), protectedPath: protectedPaths.some(p => same(p, t.path)), ...treeFacts(main, t.head) }));
  for (const t of staleTrees(records, now)) {
    const dir = join(archiveRoot(), archiveName(t.name, date));
    const tag = archiveTag(t);
    if (!apply) { say('would go', t.name, `${t.branch ?? '(detached)'} ${t.safe ? 'tip is on origin or tagged' : `tip is kept as ${tag}`}`); continue; }
    if (!t.safe) {
      const made = attempt(() => git(main, 'tag', '-a', tag, '-m', `archived with the stale worktree ${t.name}`, t.head)) !== null || attempt(() => git(main, 'rev-parse', `${tag}^{commit}`))?.trim() === t.head;
      if (!made || attempt(() => git(main, 'push', 'origin', tag)) === null) { say('kept    ', t.name, `could not tag and push ${tag}`); continue; }
      tally.archived++;
    }
    if (!saveChanges(t.path, dir)) { say('kept    ', t.name, `could not archive its changes in ${dir}`); continue; }
    if (existsSync(dir)) tally.archived++;
    try { removeWorktree(main, t.path); tally.removed++; say(verb, t.name, t.branch ?? ''); } catch (e) { say('FAILED  ', t.name, String(e.message).split('\n')[0]); }
  }

  // Folders git forgot: old pipelines' checkouts. Their files are kept as a tar, minus what a build can remake.
  const entries = existsSync(ws.worktrees) ? readdirSync(ws.worktrees, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => ({ name: e.name, path: join(ws.worktrees, e.name), touchedMs: attempt(() => touchedMs(join(ws.worktrees, e.name))) ?? now })) : [];
  for (const f of staleFolders(entries, ws.trees.map(t => t.path), now)) {
    if (!apply) { say('would go', f.name, 'folder git does not know, untouched for 14 days'); continue; }
    const dir = join(archiveRoot(), archiveName(f.name, date));
    mkdirSync(dir, { recursive: true });
    if (tar(dir, ['--exclude=node_modules', '--exclude=target', '-cf', `${f.name}.tar`, '-C', ws.worktrees, f.name]).status !== 0 || !tarHasFiles(dir, `${f.name}.tar`)) { say('kept    ', f.name, 'could not tar it'); continue; }
    tally.archived++;
    try { rmSync(f.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); tally.removed++; say(verb, f.name, 'folder'); } catch (e) { say('FAILED  ', f.name, String(e.message).split('\n')[0]); }
  }

  // Branches nothing checks out whose commits are on origin/main or under an archive tag.
  const held = parseWorktrees(git(main, 'worktree', 'list', '--porcelain')).map(t => t.branch).filter(Boolean);
  const inMain = new Set(lines(attempt(() => git(main, 'branch', '--merged', 'origin/main', '--format=%(refname:short)'))));
  const tagged = new Set(lines(attempt(() => git(main, 'for-each-ref', 'refs/tags/archive', '--format=%(objectname) %(*objectname)'))).flatMap(l => l.split(' ')));
  const branches = lines(git(main, 'for-each-ref', 'refs/heads', '--format=%(refname:short) %(objectname)')).map(l => {
    const [name, sha] = l.split(' ');
    return { name, inMain: inMain.has(name), tagged: tagged.has(sha) };
  });
  for (const b of staleBranches(branches, held)) {
    if (apply && attempt(() => git(main, 'branch', '-D', b)) === null) { say('FAILED  ', '(branch only)', b); continue; }
    if (apply) tally.removed++;
    say(verb, '(branch only)', b);
  }
  return { ...tally, lines: out };
}
