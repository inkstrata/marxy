import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveTag, normPath, staleBranches, staleFolders, staleTrees, toArchive } from './stale.mjs';
import { runStale } from './stale-run.mjs';
import { workspace } from './workspace.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const ago = d => NOW - d * 864e5;
const tree = (over = {}) => ({ path: '/w/a', branch: 'agent/a', commitMs: ago(40), touchedMs: ago(40), onOrigin: false, tagged: false, isMain: false, protectedPath: false, ...over });

test('only worktrees whose newest commit and newest file are over 30 days old are picked', () => {
  const picked = staleTrees([
    tree(), tree({ path: '/w/new', commitMs: ago(29) }), tree({ path: '/w/edge', commitMs: ago(30) }),
    tree({ path: '/w/edited', touchedMs: ago(2) }), tree({ path: '/w/unread', touchedMs: NaN }), tree({ path: '/w/unwalked', touchedMs: undefined }),
  ], NOW);
  assert.deepEqual(picked.map(t => t.path), ['/w/a']);
});

test('the main checkout, protected worktrees and ones git could not read are never picked', () => {
  assert.deepEqual(staleTrees([tree({ isMain: true }), tree({ protectedPath: true }), tree({ commitMs: NaN }), tree({ error: 'git failed' })], NOW), []);
});

test('a tip on origin or under an archive tag is safe, any other is tagged first', () => {
  const [a, b, c] = staleTrees([tree({ onOrigin: true }), tree({ tagged: true }), tree()], NOW);
  assert.deepEqual([a.safe, b.safe, c.safe], [true, true, false]);
  assert.equal(archiveTag(c), 'archive/branch/agent/a');
  assert.equal(archiveTag({ branch: null, name: 'old-folder' }), 'archive/branch/old-folder');
});

test('paths compare the same whatever the slashes, and fold case on Windows only', () => {
  assert.equal(normPath('D:/Dev/marxy-wt/x', 'win32'), normPath('D:\\DEV\\marxy-wt\\x', 'win32'));
  assert.notEqual(normPath('/a/B', 'linux'), normPath('/a/b', 'linux'));
});

test('unregistered folders untouched for 14 days are picked; nightly, registered, git-holding ones are not', () => {
  const e = (name, d, over = {}) => ({ name, path: `D:\\Dev\\marxy-wt\\${name}`, touchedMs: ago(d), hasGit: false, ...over });
  const win = process.platform === 'win32';
  const out = staleFolders([e('old', 20), e('recent', 3), e('nightly', 90), e('tree', 90), e('repo', 90, { hasGit: true }), e('unread', NaN)], ['D:/Dev/marxy-wt/TREE'], NOW);
  // On other systems a drive path is relative and resolves differently, so only the Windows run can see the slash match.
  assert.deepEqual(out.map(x => x.name), win ? ['old'] : ['old', 'tree']);
});

test('only ignored files under a build folder are left out of the archive', () => {
  const ignored = ['.env', 'node_modules/x/y.js', 'a/target/b', 'web/dist/c.js', '.venv/bin/p', '.pnpm-store/v3/f'];
  const untracked = ['src/a.ts', 'docs/dist/notes.md', 'node_modules/mine.md', 'crates/target/plan.txt'];
  assert.deepEqual(toArchive(untracked, ignored), ['src/a.ts', 'docs/dist/notes.md', 'node_modules/mine.md', 'crates/target/plan.txt', '.env']);
});

/**
 * A repository with an origin and one month-old-looking worktree holding an untracked, not ignored `docs/dist/notes.md`,
 * an untracked `newfile.md`, an ignored `.env` and an ignored build output; runs the stale pass with `apply` over it.
 */
function staleRun(t, tar) {
  // `.native` expands a Windows short name (a hosted runner's temp folder is under RUNNER~1); git reports the long one.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'marxy-stale-test-')));
  const before = process.env.MARXY_STATE_DIR;
  process.env.MARXY_STATE_DIR = join(dir, 'state');
  t.after(() => {
    if (before === undefined) delete process.env.MARXY_STATE_DIR; else process.env.MARXY_STATE_DIR = before;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  const main = join(dir, 'app');
  sh(dir, 'clone', '-q', 'origin.git', 'app');
  writeFileSync(join(main, '.gitignore'), '.env\nweb/dist/\n');
  writeFileSync(join(main, 'a.txt'), 'a\n');
  sh(main, 'add', '-A');
  sh(main, 'commit', '-q', '-m', 'base');
  sh(main, 'push', '-q', 'origin', 'HEAD:main');
  const trees = join(dir, 'app-wt');
  const tree = join(trees, 'a');
  sh(main, 'worktree', 'add', '-q', '-b', 'agent/a', tree);
  mkdirSync(join(tree, 'docs', 'dist'), { recursive: true });
  writeFileSync(join(tree, 'docs', 'dist', 'notes.md'), 'the only copy\n');
  writeFileSync(join(tree, 'newfile.md'), 'kept\n');
  writeFileSync(join(tree, '.env'), 'LOCAL=1\n');
  mkdirSync(join(tree, 'web', 'dist'), { recursive: true });
  writeFileSync(join(tree, 'web', 'dist', 'bundle.js'), 'built\n');
  const ws = workspace(main, { MARXY_WORKTREES: trees });
  const r = runStale({ ws, root: main, tar }, { apply: true, now: Date.now() + 60 * 864e5, date: '2027-01-01' });
  return { r, tree, archive: join(dir, 'state', 'archive', 'worktrees', 'a-2027-01-01') };
}
const tarList = archive => execFileSync('tar', ['-tf', 'untracked.tar'], { cwd: archive, encoding: 'utf8' }).split(/\r?\n/).filter(l => l && !l.endsWith('/')).sort();

test('the stale pass archives an untracked file under a folder named dist before it removes the worktree', t => {
  const { r, tree, archive } = staleRun(t);
  assert.ok(!existsSync(tree), r.lines.join('\n'));
  assert.deepEqual(tarList(archive), ['.env', 'docs/dist/notes.md', 'newfile.md']);
});

test('an archive that is missing a file keeps the worktree', t => {
  // A tar that quietly leaves out the first file it is given, and still exits 0: only the count check can notice.
  const shortTar = (dir, args, input) => {
    const files = input.split('\0').filter(Boolean);
    return spawnSync('tar', args, { cwd: dir, input: files.slice(1).join('\0') + '\0', encoding: 'utf8' });
  };
  const { r, tree, archive } = staleRun(t, shortTar);
  assert.ok(existsSync(join(tree, 'docs', 'dist', 'notes.md')), r.lines.join('\n'));
  assert.ok(r.lines.some(l => /^kept\s+a\s+the archive of untracked and ignored files is incomplete/.test(l)), r.lines.join('\n'));
  assert.equal(tarList(archive).length, 2);
});

test('local branches with no worktree and safe tips go; the base and held ones stay', () => {
  const b = (name, over = {}) => ({ name, inMain: false, tagged: false, ...over });
  const out = staleBranches([b('main', { inMain: true }), b('agent/done', { inMain: true }), b('agent/tagged', { tagged: true }), b('agent/open'), b('agent/held', { inMain: true })], ['agent/held']);
  assert.deepEqual(out, ['agent/done', 'agent/tagged']);
});
