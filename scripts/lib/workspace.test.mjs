// Where work happens: worktrees in <main>-wt (or MARXY_WORKTREES), the tracker in the asking tree's own work/, and which
// branches have landed, by ancestry or by a deleted upstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchFacts, workspace } from './workspace.mjs';

test('the main checkout and its worktrees folder are the same from any tree; the tracker is the tree\'s own', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'marxy-workspace-test-')));
  try {
    const app = join(dir, 'app');
    mkdirSync(app);
    const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(app, 'init', '-q', '-b', 'main');
    git(app, 'config', 'user.email', 'test@example.invalid');
    git(app, 'config', 'user.name', 'test');
    git(app, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(app, 'a.txt'), 'one\n');
    git(app, 'add', '-A');
    git(app, 'commit', '-q', '-m', 'base');
    const tree = join(dir, 'app-wt', 'piece');
    git(app, 'worktree', 'add', '-q', '-b', 'agent/piece', tree, 'main');

    for (const root of [app, tree]) {
      const ws = workspace(root, {});
      assert.equal(ws.dir.toLowerCase(), dir.toLowerCase());
      assert.equal(ws.checkout, 'app');
      assert.equal(ws.worktrees.toLowerCase(), join(dir, 'app-wt').toLowerCase());
      assert.equal(ws.builds.toLowerCase(), join(app, 'builds').toLowerCase());
      assert.equal(ws.todo.toLowerCase(), join(root, 'work', 'todo.md').toLowerCase());
      assert.equal(ws.trees.length, 2);
    }
    const elsewhere = join(dir, 'elsewhere');
    assert.equal(workspace(tree, { MARXY_WORKTREES: elsewhere }).worktrees, elsewhere);

    const facts = branchFacts(tree);
    assert.equal(facts.heads.get('agent/piece'), facts.baseSha);
    assert.ok(facts.merged.has('agent/piece'));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a branch whose upstream was deleted after a squash merge counts as landed', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'marxy-workspace-gone-')));
  try {
    const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = join(dir, 'origin.git');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    const app = join(dir, 'app');
    git(dir, 'clone', '-q', origin, app);
    git(app, 'config', 'user.email', 'test@example.invalid');
    git(app, 'config', 'user.name', 'test');
    git(app, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(app, 'a.txt'), 'one\n');
    git(app, 'add', '-A');
    git(app, 'commit', '-q', '-m', 'base');
    git(app, 'push', '-q', 'origin', 'main');
    git(app, 'switch', '-q', '-c', 'agent/squashed');
    writeFileSync(join(app, 'b.txt'), 'two\n');
    git(app, 'add', '-A');
    git(app, 'commit', '-q', '-m', 'add b');
    git(app, 'push', '-q', '-u', 'origin', 'agent/squashed');
    git(app, 'switch', '-q', 'main');
    assert.ok(!branchFacts(app).merged.has('agent/squashed'), 'open while its upstream is there');
    // GitHub squashes it into main and deletes the branch.
    git(app, 'merge', '-q', '--squash', 'agent/squashed');
    git(app, 'commit', '-q', '-m', 'add b (squashed)');
    git(app, 'push', '-q', 'origin', 'main', ':agent/squashed');
    git(app, 'fetch', '-q', '--prune');
    assert.ok(branchFacts(app).merged.has('agent/squashed'));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
