// prunePlan, removeArgs, and worktree removal argv (MARXY-118).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prunePlan, removeArgs, runWorktreePrune, removeWorktreeAt,
  prListArgs, pickPrState, gatherWorktreeEntries, inProgressBranches,
  keyOfBranch, liveClaims, formatClaimLine, prClaimLabel,
  parseWorktreeList,
} from './worktrees.mjs';

const orch = '/repo/marxy';

function entry(over = {}) {
  return {
    path: '/repo/marxy-wt/MARXY-1',
    branch: 'feat/MARXY-1-slug',
    detached: false,
    dirty: false,
    prState: null,
    ageHours: 0,
    ...over,
  };
}

test('clean merged PR → remove with PR merged', () => {
  const { remove, keep } = prunePlan([entry({ prState: 'MERGED' })], { orchestratorPath: orch });
  assert.equal(remove.length, 1);
  assert.equal(remove[0].reason, 'PR merged');
  assert.equal(keep.length, 0);
});

test('clean closed PR → remove with PR closed', () => {
  const { remove } = prunePlan([entry({ prState: 'CLOSED' })], { orchestratorPath: orch });
  assert.equal(remove.length, 1);
  assert.equal(remove[0].reason, 'PR closed');
});

test('open PR → keep', () => {
  const { remove, keep } = prunePlan([entry({ prState: 'OPEN' })], { orchestratorPath: orch });
  assert.equal(remove.length, 0);
  assert.equal(keep.length, 1);
  assert.equal(keep[0].reason, 'PR open');
});

test('dirty worktree stays regardless of PR state', () => {
  const { remove, keep } = prunePlan([entry({ dirty: true, prState: 'MERGED' })], { orchestratorPath: orch });
  assert.equal(remove.length, 0);
  assert.equal(keep.length, 1);
  assert.match(keep[0].reason, /uncommitted work/);
});

test('detached, clean, 30 h → remove', () => {
  const { remove } = prunePlan(
    [entry({ path: '/scratch', branch: null, detached: true, ageHours: 30 })],
    { orchestratorPath: orch },
  );
  assert.equal(remove.length, 1);
});

test('detached, clean, 2 h → keep', () => {
  const { keep, remove } = prunePlan(
    [entry({ path: '/scratch', branch: null, detached: true, ageHours: 2 })],
    { orchestratorPath: orch },
  );
  assert.equal(remove.length, 0);
  assert.equal(keep.length, 1);
});

test('orchestrator checkout → keep', () => {
  const { keep, remove } = prunePlan([entry({ path: orch })], { orchestratorPath: orch });
  assert.equal(remove.length, 0);
  assert.equal(keep.length, 1);
  assert.match(keep[0].reason, /orchestrator checkout/);
});

test('removeArgs never passes --force', () => {
  const args = removeArgs('../marxy-wt/MARXY-9');
  assert.deepEqual(args, ['worktree', 'remove', '../marxy-wt/MARXY-9']);
  assert.equal(args.includes('--force'), false);
});

test('removeWorktreeAt reports failure and does not retry with --force', () => {
  const calls = [];
  const git = args => {
    calls.push(args);
    return { error: 'fatal: working tree contains modifications' };
  };
  const lines = [];
  const ok = removeWorktreeAt('/wt/MARXY-1', { git, say: l => lines.push(l) });
  assert.equal(ok, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['worktree', 'remove', '/wt/MARXY-1']);
  assert.equal(calls[0].includes('--force'), false);
  assert.match(lines[0], /remove failed/);
});

test('runWorktreePrune prints each removal, and each kept stray only when asked', () => {
  const lines = [];
  const gitCalls = [];
  runWorktreePrune({
    dryRun: false,
    verbose: true,
    root: orch,
    say: l => lines.push(l),
    gather: () => [
      entry({ path: '/repo/marxy-wt/MARXY-9', prState: 'MERGED' }),
      entry({ path: '/repo/marxy-wt/MARXY-10', prState: 'OPEN' }),
    ],
    git: args => {
      gitCalls.push(args);
      return '';
    },
  });
  assert.match(lines.join('\n'), /worktree remove .*MARXY-9.*PR merged/);
  assert.match(lines.join('\n'), /worktree keep .*MARXY-10.*PR open/);
  assert.equal(gitCalls.length, 2);
  assert.deepEqual(gitCalls[0], ['worktree', 'prune']);
  assert.deepEqual(gitCalls[1], ['worktree', 'remove', '/repo/marxy-wt/MARXY-9']);
});

test('runWorktreePrune dry-run prints the plan and removes nothing', () => {
  const lines = [];
  const gitCalls = [];
  runWorktreePrune({
    dryRun: true,
    verbose: true,
    root: orch,
    say: l => lines.push(l),
    gather: () => [entry({ prState: 'MERGED' }), entry({ path: '/repo/marxy-wt/MARXY-2', prState: 'OPEN' })],
    git: args => {
      gitCalls.push(args);
      return '';
    },
  });
  assert.match(lines.join('\n'), /worktree remove/);
  assert.match(lines.join('\n'), /worktree keep/);
  assert.equal(gitCalls.length, 0);
});

test('CLI --dry-run exits zero and removes nothing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const r = spawnSync(process.execPath, [join(here, 'worktrees.mjs'), '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
});

// MARXY-171: `gh pr list --head B` lists open PRs only. The arms above were tested with prState
// injected, so nothing noticed that production never produced MERGED or CLOSED.
test('the gh query asks for every PR state, not just open ones', () => {
  const args = prListArgs('feat/MARXY-8-x');
  assert.deepEqual(args.slice(0, 4), ['pr', 'list', '--head', 'feat/MARXY-8-x']);
  assert.equal(args[args.indexOf('--state') + 1], 'all');
});

test('pickPrState prefers OPEN, then MERGED, then CLOSED', () => {
  const rows = (...s) => JSON.stringify(s.map(state => ({ state })));
  assert.equal(pickPrState(rows('CLOSED', 'OPEN')), 'OPEN');
  assert.equal(pickPrState(rows('CLOSED', 'MERGED')), 'MERGED');
  assert.equal(pickPrState(rows('CLOSED')), 'CLOSED');
  assert.equal(pickPrState('[]'), null);
  assert.equal(pickPrState(''), null);
  assert.equal(pickPrState('not json'), null);
});

test('gatherWorktreeEntries reads a merged branch as MERGED through the real query shape', () => {
  // A fake gh that behaves like gh: it answers only for the states the argv asks for.
  const prs = { 'feat/MARXY-8-x': [{ state: 'MERGED' }], 'feat/MARXY-9-y': [{ state: 'OPEN' }] };
  const gh = argv => {
    const branch = argv[argv.indexOf('--head') + 1];
    const wanted = argv.includes('--state') ? argv[argv.indexOf('--state') + 1] : 'open';
    const rows = (prs[branch] ?? []).filter(r => wanted === 'all' || r.state.toLowerCase() === wanted);
    return JSON.stringify(rows);
  };
  const porcelain = [
    'worktree /repo/marxy', 'HEAD 0', 'branch refs/heads/main', '',
    'worktree /repo/marxy-wt/MARXY-8', 'HEAD 1', 'branch refs/heads/feat/MARXY-8-x', '',
    'worktree /repo/marxy-wt/MARXY-9', 'HEAD 2', 'branch refs/heads/feat/MARXY-9-y', '',
  ].join('\n');
  const git = argv => {
    if (argv[0] === 'worktree') return porcelain;
    if (argv.includes('--is-inside-work-tree')) return 'true';
    return '';
  };
  const entries = gatherWorktreeEntries({ root: '/repo/marxy', git, gh });
  const byPath = Object.fromEntries(entries.map(e => [e.path, e.prState]));
  assert.equal(byPath['/repo/marxy-wt/MARXY-8'], 'MERGED');
  assert.equal(byPath['/repo/marxy-wt/MARXY-9'], 'OPEN');
  const { remove } = prunePlan(entries, { orchestratorPath: '/repo/marxy' });
  assert.deepEqual(remove.map(e => e.path), ['/repo/marxy-wt/MARXY-8']);
});

test('a story in progress keeps its worktree even when an earlier attempt\'s PR is closed', () => {
  const { remove, keep } = prunePlan(
    [entry({ prState: 'CLOSED' })],
    { orchestratorPath: orch, activeBranches: ['feat/MARXY-1-slug'] },
  );
  assert.equal(remove.length, 0);
  assert.equal(keep[0].reason, 'story in progress');
});

test('keyOfBranch returns the first MARXY key in the branch name', () => {
  assert.equal(keyOfBranch('feat/MARXY-198-slug'), 'MARXY-198');
  assert.equal(keyOfBranch('main'), null);
  assert.equal(keyOfBranch(null), null);
});

test('parseWorktreeList reads prunable from porcelain', () => {
  const rows = parseWorktreeList(
    'worktree /tmp/x\nHEAD abc\nbranch refs/heads/feat/MARXY-1-a\nprunable gitdir file points to non-existent location\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prunable, 'gitdir file points to non-existent location');
});

test('prunePlan removes prunable rows before dirty would keep them', () => {
  const { remove } = prunePlan(
    [entry({ prunable: 'gitdir file points to non-existent location', dirty: true })],
    { orchestratorPath: orch },
  );
  assert.equal(remove.length, 1);
  assert.match(remove[0].reason, /prunable/);
});

test('gatherWorktreeEntries: git failure is not dirty', () => {
  const rows = gatherWorktreeEntries({
    git: args => {
      if (args.includes('worktree') && args.includes('list')) {
        return 'worktree /broken\nbranch refs/heads/feat/MARXY-9-x\n';
      }
      if (args.includes('--is-inside-work-tree')) return { error: 'fatal: not a git repository' };
      return '';
    },
    gh: () => '[]',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usable, false);
  assert.equal(rows[0].dirty, false);
});

test('inProgressBranches lists in_progress and in_review stories that have a branch', () => {
  assert.deepEqual(
    inProgressBranches({ stories: {
      a: { status: 'in_progress', branch: 'b/a' },
      b: { status: 'in_review', branch: 'b/b' },
      c: { status: 'in_progress' },
      d: { status: 'done', branch: 'b/d' },
    } }),
    ['b/a', 'b/b'],
  );
});

test('the fleet runner worktree is never pruned, however old and detached', () => {
  const { remove, keep } = prunePlan(
    [entry({ path: '/repo/marxy/.git/marxy-fleet/runner', branch: null, detached: true, ageHours: 300 })],
    { orchestratorPath: orch, fleetPath: '/repo/marxy/.git/marxy-fleet' },
  );
  assert.equal(remove.length, 0);
  assert.equal(keep[0].reason, 'the fleet runner');
});

const orchPath = '/repo/marxy';
const wt198 = '/repo/marxy-wt/MARXY-198';
function liveEntry(over = {}) {
  return {
    path: wt198,
    branch: 'feat/MARXY-198-x',
    detached: false,
    dirty: true,
    ahead: 2,
    usable: true,
    prState: null,
    ageHours: 0,
    ...over,
  };
}
function rowsOf(mainRows = {}) {
  return (key, wtPath) => mainRows[key] ?? null;
}

test('liveClaims: ahead and todo key with a main row holds that row paths', () => {
  const paths = ['apps/desktop/src/app.ts', 'packages/core/src/parse'];
  const claims = liveClaims([liveEntry()], {
    orchestratorPath: orchPath,
    rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: paths.join(', ') } }),
    isDone: () => false,
    statusOf: () => 'todo',
  });
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].paths, paths);
});

test('liveClaims: done key claims nothing', () => {
  const claims = liveClaims([liveEntry()], {
    orchestratorPath: orchPath,
    rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: 'a' } }),
    isDone: k => k === 'MARXY-198',
  });
  assert.deepEqual(claims, []);
});

test('liveClaims: blocked or escalate returns no claim for a dirty ahead worktree', () => {
  for (const status of ['blocked', 'escalate']) {
    const claims = liveClaims([liveEntry()], {
      orchestratorPath: orchPath,
      rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: 'a' } }),
      isDone: () => false,
      statusOf: () => status,
    });
    assert.deepEqual(claims, [], status);
  }
});

test('liveClaims: in_progress and undefined status still claim when dirty and ahead', () => {
  for (const status of ['in_progress', undefined]) {
    const claims = liveClaims([liveEntry()], {
      orchestratorPath: orchPath,
      rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: 'a, b' } }),
      isDone: () => false,
      statusOf: () => status,
    });
    assert.equal(claims.length, 1, String(status));
    assert.deepEqual(claims[0].paths, ['a', 'b']);
  }
});

test('liveClaims: clean and not ahead claims nothing', () => {
  const claims = liveClaims([liveEntry({ ahead: 0, dirty: false })], {
    orchestratorPath: orchPath,
    rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: 'a' } }),
    isDone: () => false,
  });
  assert.deepEqual(claims, []);
});

test('liveClaims: dirty with no ahead still claims', () => {
  const claims = liveClaims([liveEntry({ ahead: 0, dirty: true })], {
    orchestratorPath: orchPath,
    rowsOf: rowsOf({ 'MARXY-198': { Key: 'MARXY-198', Paths: 'a' } }),
    isDone: () => false,
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].dirty, true);
});

test('liveClaims: orchestrator checkout claims nothing even when dirty', () => {
  const claims = liveClaims([liveEntry({ path: orchPath, branch: 'main', dirty: true })], {
    orchestratorPath: orchPath,
    rowsOf: rowsOf({}),
    isDone: () => false,
  });
  assert.deepEqual(claims, []);
});

test('liveClaims: key with no row anywhere reports no row and holds no paths', () => {
  const claims = liveClaims([liveEntry()], {
    orchestratorPath: orchPath,
    rowsOf: () => null,
    isDone: () => false,
  });
  assert.deepEqual(claims, [{ key: 'MARXY-198', path: wt198, reason: 'no row', prState: null }]);
});

test('formatClaimLine matches the cycle wording', () => {
  assert.equal(
    formatClaimLine({ key: 'MARXY-198', path: '../marxy-wt/MARXY-198', ahead: 2, dirty: false, prState: null }),
    'worktree holds paths: MARXY-198 (../marxy-wt/MARXY-198, 2 commits ahead, clean, no PR)',
  );
  assert.equal(prClaimLabel('OPEN'), 'PR open');
});
