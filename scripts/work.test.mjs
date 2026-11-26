// `pnpm work`: its arguments, what it reads from git's worktree list, what it would clear, and one piece of work taken
// from start to cleared in a throwaway repository with a workspace of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchState, parseWorktrees } from './lib/workspace.mjs';
import { cleanPlan, COMMANDS, describeTrees, parseArgs } from './work.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'work.mjs');

test('arguments: the command, its name and its options', () => {
  assert.equal(parseArgs([]).command, 'status');
  const s = parseArgs(['start', 'big-tables', '--from', 'agent/integration', '--no-install']);
  assert.deepEqual([s.command, s.name, s.from, s.install], ['start', 'big-tables', 'agent/integration', false]);
  assert.deepEqual(parseArgs(['clean', '--apply', '--keep=exe,agent/other']).keep, ['exe', 'agent/other']);
  assert.deepEqual(parseArgs(['installer', '--', '-Ref', 'main', '-NoInstall']).rest, ['-Ref', 'main', '-NoInstall']);
  assert.equal(parseArgs(['todo', '--check', '--base', 'main']).base, 'main');
  // pnpm 11 drops the `--`, so the script's own options arrive bare.
  const bare = parseArgs(['installer', '-Ref', 'x', '-NoInstall']);
  assert.equal(bare.command, 'installer');
  assert.deepEqual(bare.rest, ['-Ref', 'x', '-NoInstall']);
  assert.deepEqual(parseArgs(['installer', '--no-install', '--base', 'x']).rest, ['--no-install', '--base', 'x']);
  assert.deepEqual(parseArgs(['installer']).rest, []);
});

test('arguments: a bad command, name or option says what is wrong', () => {
  assert.throws(() => parseArgs(['merge']), /unknown command merge/);
  assert.throws(() => parseArgs(['start']), /start needs a name/);
  assert.throws(() => parseArgs(['start', 'Big Tables']), /lower-case letters, digits and hyphens/);
  assert.throws(() => parseArgs(['start', 'a', 'b']), /unexpected argument b/);
  assert.throws(() => parseArgs(['list', '--base']), /--base needs a value/);
  assert.throws(() => parseArgs(['--force']), /unknown argument --force/);
});

test('package.json runs it as pnpm work', () => {
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.work, 'node scripts/work.mjs');
});

const PORCELAIN = `worktree C:/ws/app
HEAD aaaa
branch refs/heads/main

worktree C:/ws/worktrees/done
HEAD bbbb
branch refs/heads/agent/done

worktree C:/ws/worktrees/new
HEAD aaaa
branch refs/heads/agent/new

worktree C:/ws/worktrees/going
HEAD cccc
branch refs/heads/agent/going

worktree C:/ws/worktrees/exe
HEAD dddd
detached

worktree C:/ws/worktrees/lost
HEAD bbbb
branch refs/heads/agent/lost
prunable gitdir file points to non-existent location

worktree C:/ws/worktrees/other
HEAD bbbb
branch refs/heads/topic
`;
const facts = {
  base: 'main',
  baseSha: 'aaaa',
  heads: new Map([['main', 'aaaa'], ['agent/done', 'bbbb'], ['agent/new', 'aaaa'], ['agent/going', 'cccc'], ['agent/lost', 'bbbb'], ['topic', 'bbbb'], ['agent/bare', 'bbbb'], ['agent/bare-open', 'eeee']]),
  merged: new Set(['main', 'agent/done', 'agent/new', 'agent/lost', 'topic', 'agent/bare']),
};

test('git\'s worktree list reads as records, the main checkout first', () => {
  const trees = parseWorktrees(PORCELAIN);
  assert.equal(trees.length, 7);
  assert.deepEqual(trees[0], { path: 'C:/ws/app', head: 'aaaa', branch: 'main', detached: false, prunable: false });
  assert.equal(trees[4].branch, null);
  assert.equal(trees[4].detached, true);
  assert.equal(trees[5].prunable, true);
});

test('a branch on the base\'s own commit is not counted as merged work', () => {
  assert.equal(branchState('agent/new', 'aaaa', facts), 'at-base');
  assert.equal(branchState('agent/done', 'bbbb', facts), 'merged');
  assert.equal(branchState('agent/going', 'cccc', facts), 'open');
  assert.equal(branchState('main', 'aaaa', facts), 'base');
});

test('each worktree is given its state', () => {
  const states = Object.fromEntries(describeTrees(parseWorktrees(PORCELAIN), facts).map(t => [t.name, t.state]));
  assert.deepEqual(states, { app: 'main', done: 'merged', new: 'at-base', going: 'open', exe: 'detached', lost: 'gone', other: 'merged' });
});

test('clean takes merged work under the prefix and nothing else', () => {
  const trees = describeTrees(parseWorktrees(PORCELAIN), facts);
  const plan = cleanPlan(trees, facts);
  assert.deepEqual(plan.trees.map(t => t.name), ['done'], 'not the new one, the open one, the detached one, the missing one or another prefix');
  assert.deepEqual(plan.branches, ['agent/bare'], 'a merged branch with no worktree; never one a worktree holds');
  assert.deepEqual(cleanPlan(trees, facts, ['done', 'agent/bare']), { trees: [], branches: [] });
  assert.deepEqual(cleanPlan(trees, facts, ['bare']).branches, []);
});

test('a branch nothing was committed on is unstarted, and clean leaves it', () => {
  const never = b => b === 'agent/done' || b === 'agent/bare';
  const trees = describeTrees(parseWorktrees(PORCELAIN), facts, never);
  assert.equal(trees.find(t => t.name === 'done').state, 'unstarted');
  assert.equal(trees.find(t => t.name === 'going').state, 'open', 'only a merged branch is asked about');
  assert.deepEqual(cleanPlan(trees, facts, [], never), { trees: [], branches: [] });
});

test('every command is in the usage text', () => {
  const help = spawnSync(process.execPath, [WORK, '--help'], { encoding: 'utf8' }).stdout;
  for (const c of COMMANDS) assert.match(help, new RegExp(`^  ${c}\\b`, 'm'), c);
});

/** A repository in a folder of its own: <dir>/app, with one commit on main; its worktrees go in <dir>/app-wt. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-work-test-'));
  const app = join(dir, 'app');
  mkdirSync(app);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'config', 'user.email', 'test@example.invalid');
  git(app, 'config', 'user.name', 'test');
  // A developer's global signing (an SSH key behind a passphrase) must not decide whether this passes.
  git(app, 'config', 'commit.gpgsign', 'false');
  git(app, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(app, 'a.txt'), 'one\n');
  git(app, 'add', '-A');
  git(app, 'commit', '-q', '-m', 'base');
  const work = (...args) => spawnSync(process.execPath, [WORK, '--root', app, ...args], { encoding: 'utf8', env: { ...process.env, MARXY_WORKTREES: '' } });
  return { dir, app, git, work };
}

test('a piece of work from start to cleared, in a workspace of its own', () => {
  const { dir, app, git, work } = fixture();
  try {
    const init = work('init');
    assert.equal(init.status, 0, init.stderr);
    for (const p of ['app-wt', 'app/builds', 'app/work', 'app/work/todo.md']) assert.ok(existsSync(join(dir, p)), p);
    writeFileSync(join(app, 'work', 'todo.md'), '## Next\n\n| # | What | Branch |\n| --- | --- | --- |\n| A1 | add b | `piece` |\n| A2 | later | |\n');
    assert.match(work('init').stdout, /exists .*todo\.md/, 'a second init leaves the tracker as it is');

    const started = work('start', 'piece', '--no-install');
    assert.equal(started.status, 0, started.stderr);
    // A second piece, started now and never committed on: the base is about to move past where it was cut.
    assert.equal(work('start', 'waiting', '--no-install').status, 0);
    const tree = join(dir, 'app-wt', 'piece');
    assert.equal(git(tree, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'agent/piece');
    assert.equal(work('start', 'piece', '--no-install').status, 2, 'the same name twice is refused');

    assert.match(work('clean').stdout, /0 worktrees and 0 bare branches/, 'a branch with no commits of its own is new, not merged');
    assert.match(work('todo').stdout, /A1 .*piece: at-base/);

    writeFileSync(join(tree, 'b.txt'), 'two\n');
    git(tree, 'add', '-A');
    git(tree, 'commit', '-q', '-m', 'add b');
    assert.match(work('status').stdout, /agent\/piece\s+1 ahead\s+app-wt.piece\s+clean/);
    assert.match(work('todo', '--check').stdout, /1 in flight, 1 waiting, 0 landed/);

    git(app, 'merge', '-q', '--no-ff', '-m', 'merge piece', 'agent/piece');
    const check = work('todo', '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout, /A1 \(line 5\): piece is in main; remove the row/);

    assert.match(work('list').stdout, /app-wt.waiting\s+agent\/waiting\s+\w+\s+unstarted/);
    assert.match(work('status').stdout, /unstarted\s+waiting: cut from an earlier main/);

    writeFileSync(join(tree, 'scratch.txt'), 'not committed\n');
    const kept = work('clean', '--apply');
    assert.match(kept.stdout, /kept .*agent\/piece: 1 uncommitted: scratch\.txt/);
    assert.ok(existsSync(tree), 'a worktree with uncommitted files is never removed');

    rmSync(join(tree, 'scratch.txt'));
    assert.match(work('clean').stdout, /would go app-wt.piece\s+agent\/piece[\s\S]*nothing was removed/);
    assert.ok(existsSync(tree), 'without --apply nothing is removed');
    const cleaned = work('clean', '--apply');
    assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
    assert.ok(!existsSync(tree));
    assert.equal(git(app, 'branch', '--list', 'agent/piece').trim(), '');
    assert.doesNotMatch(cleaned.stdout, /waiting/, 'work that has not begun is not work that is done');
    assert.ok(existsSync(join(dir, 'app-wt', 'waiting')));
    assert.notEqual(git(app, 'branch', '--list', 'agent/waiting').trim(), '');
    assert.equal(readFileSync(join(app, 'b.txt'), 'utf8'), 'two\n');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
