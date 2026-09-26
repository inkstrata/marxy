// observeWorktrees against a real repository: what git says is what the cycle sees (ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observeWorktrees } from './observe.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' });

/** A repo whose origin/main is one commit, with a worktree per branch given. */
function repo(branches) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marxy-observe-')));
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(root, 'init', '-q', '-b', 'main', 'home');
  const home = join(root, 'home');
  git(home, 'remote', 'add', 'origin', join(root, 'origin.git'));
  writeFileSync(join(home, 'a.txt'), 'a\n');
  git(home, 'add', '.');
  git(home, 'commit', '-q', '-m', 'init');
  git(home, 'push', '-q', 'origin', 'main');
  git(home, 'fetch', '-q', 'origin');
  const paths = {};
  for (const b of branches) {
    paths[b] = join(root, b.split('/')[1]);
    git(home, 'worktree', 'add', '-q', '-b', b, paths[b], 'origin/main');
  }
  return { home, paths, list: () => git(home, 'worktree', 'list', '--porcelain') };
}

const observed = (r, key) => observeWorktrees({ home: r.home, list: r.list }).find(w => w.key === key);

test('a clean worktree level with main is neither dirty nor ahead', () => {
  const r = repo(['feat/MARXY-901-clean']);
  const w = observed(r, 'MARXY-901');
  assert.deepEqual([w.dirty, w.ahead], [false, 0]);
  assert.equal(w.path, r.paths['feat/MARXY-901-clean']);
  assert.equal(w.branch, 'feat/MARXY-901-clean');
});

test('an edited or untracked file makes it dirty, and its mtime is the last activity', () => {
  const r = repo(['feat/MARXY-902-dirty', 'feat/MARXY-903-untracked']);
  writeFileSync(join(r.paths['feat/MARXY-902-dirty'], 'a.txt'), 'edited\n');
  writeFileSync(join(r.paths['feat/MARXY-903-untracked'], 'new.txt'), 'new\n');
  const before = Date.now() - 60_000;
  for (const key of ['MARXY-902', 'MARXY-903']) {
    const w = observed(r, key);
    assert.equal(w.dirty, true, key);
    assert.ok(w.lastActivityMs > before && w.lastActivityMs <= Date.now() + 1000, key);
  }
});

test('commits ahead of origin/main are counted, and the last commit counts as activity', () => {
  const r = repo(['feat/MARXY-904-ahead']);
  const wt = r.paths['feat/MARXY-904-ahead'];
  writeFileSync(join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'one');
  writeFileSync(join(wt, 'c.txt'), 'c\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'two');
  const w = observed(r, 'MARXY-904');
  assert.deepEqual([w.dirty, w.ahead], [false, 2]);
  assert.ok(Number.isFinite(w.lastActivityMs));
});

test('worktrees that are not story branches, and the home checkout, are not reported', () => {
  const r = repo(['chore/no-key-here', 'feat/MARXY-905-story']);
  assert.deepEqual(observeWorktrees({ home: r.home, list: r.list }).map(w => w.key), ['MARXY-905']);
});

test('a worktree whose directory is gone is skipped, not reported clean', () => {
  const r = repo(['feat/MARXY-906-gone']);
  execFileSync('rm', ['-rf', r.paths['feat/MARXY-906-gone']]);
  assert.equal(observed(r, 'MARXY-906'), undefined);
});

test('an unreadable worktree counts as dirty', () => {
  const r = repo(['feat/MARXY-907-broken']);
  const w = observeWorktrees({
    home: r.home, list: r.list,
    gitIn: (wt, args) => (args[0] === 'status' ? null : execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8' }).trim()),
  }).find(x => x.key === 'MARXY-907');
  assert.equal(w.dirty, true);
});
