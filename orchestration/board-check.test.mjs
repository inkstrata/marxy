// One fixture per boardDrift finding kind, plus the clean fixture and the standalone CLI
// (MARXY-117). No fixture here calls git, gh or Jira — boardDrift is pure by contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardDrift, gatherBoardCheckInput, boardTotals, KIND, BLOCKS_DISPATCH } from './board-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function clean(over = {}) {
  return {
    branch: 'main',
    behind: 0,
    dirtyTracked: [],
    openPrs: [{ number: 1, title: 'feat: x (MARXY-1)', headRefName: 'feat/MARXY-1' }],
    csvKeys: ['MARXY-1'],
    outOfPlanKeys: [],
    inReview: [{ key: 'MARXY-2', pr: 9, prState: 'OPEN' }],
    ...over,
  };
}

test('a clean board (on main, not behind, no tracked edits, every PR keyed) returns no findings', () => {
  assert.deepEqual(boardDrift(clean()), []);
});

test('boardDrift() with no input at all is clean, not a throw', () => {
  assert.deepEqual(boardDrift(), []);
  assert.deepEqual(boardDrift({}), []);
});

test('behind: 14 names one behind finding naming 14', () => {
  const findings = boardDrift(clean({ behind: 14 }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.BEHIND);
  assert.match(findings[0].detail, /\b14\b/);
  assert.match(findings[0].detail, /behind origin\/main/);
});

test('a checkout not on main is an off-main finding naming the branch', () => {
  const findings = boardDrift(clean({ branch: 'chore/MARXY-9-slug' }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.OFF_MAIN);
  assert.match(findings[0].detail, /chore\/MARXY-9-slug/);
});

test('a tracked file modified under docs/plan or orchestration is a dirty-board finding naming the file', () => {
  const findings = boardDrift(clean({ dirtyTracked: ['docs/plan/jira-issues.csv'] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.DIRTY_BOARD);
  assert.match(findings[0].detail, /docs\/plan\/jira-issues\.csv/);
});

test('multiple dirty tracked files each get their own dirty-board finding', () => {
  const findings = boardDrift(
    clean({ dirtyTracked: ['docs/plan/jira-issues.csv', 'orchestration/deps.json'] }),
  );
  assert.deepEqual(
    findings.map(f => f.kind),
    [KIND.DIRTY_BOARD, KIND.DIRTY_BOARD],
  );
  assert.match(findings[0].detail, /jira-issues\.csv/);
  assert.match(findings[1].detail, /deps\.json/);
});

test('an open PR titled (MARXY-999), with no CSV row and not an out-of-plan task, is unboarded-pr', () => {
  const findings = boardDrift(
    clean({
      openPrs: [{ number: 42, title: 'chore(orchestration): drive-by fix (MARXY-999)', headRefName: 'chore/MARXY-999-drive-by' }],
      csvKeys: ['MARXY-1'],
      outOfPlanKeys: [],
    }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.UNBOARDED_PR);
  assert.match(findings[0].detail, /MARXY-999/);
  assert.match(findings[0].detail, /#42/);
});

test('the same PR for an out-of-plan key is no finding', () => {
  const findings = boardDrift(
    clean({
      openPrs: [{ number: 42, title: 'chore(orchestration): drive-by fix (MARXY-999)', headRefName: 'chore/MARXY-999-drive-by' }],
      csvKeys: ['MARXY-1'],
      outOfPlanKeys: ['MARXY-999'],
    }),
  );
  assert.deepEqual(findings, []);
});

test('a PR whose key has a CSV row is no finding', () => {
  const findings = boardDrift(
    clean({
      openPrs: [{ number: 3, title: 'feat: y (MARXY-1)' }],
      csvKeys: ['MARXY-1'],
    }),
  );
  assert.deepEqual(findings, []);
});

test('a PR with no MARXY key in title or branch is never a finding (dependabot, etc.)', () => {
  const findings = boardDrift(
    clean({ openPrs: [{ number: 7, title: 'bump lockfile', headRefName: 'dependabot/npm/x' }] }),
  );
  assert.deepEqual(findings, []);
});

test('an in_review story whose PR merged is a stale-review finding', () => {
  const findings = boardDrift(clean({ inReview: [{ key: 'MARXY-2', pr: 9, prState: 'MERGED' }] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.STALE_REVIEW);
  assert.match(findings[0].detail, /MARXY-2/);
  assert.match(findings[0].detail, /#9/);
  assert.match(findings[0].detail, /MERGED/);
});

test('an in_review story whose PR closed (not merged) is also a stale-review finding', () => {
  const findings = boardDrift(clean({ inReview: [{ key: 'MARXY-2', pr: 9, prState: 'CLOSED' }] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.STALE_REVIEW);
  assert.match(findings[0].detail, /CLOSED/);
});

test('an in_review story whose PR is still OPEN is no finding', () => {
  assert.deepEqual(boardDrift(clean({ inReview: [{ key: 'MARXY-2', pr: 9, prState: 'OPEN' }] })), []);
});

test('every kind actually appears when its own condition is deliberately broken, not a check that cannot fail', () => {
  const broken = clean({
    branch: 'wip',
    behind: 3,
    dirtyTracked: ['orchestration/state.json'],
    openPrs: [{ number: 1, title: 'x (MARXY-1)' }, { number: 2, title: 'y (MARXY-999)' }],
    csvKeys: ['MARXY-1'],
    outOfPlanKeys: [],
    inReview: [{ key: 'MARXY-2', pr: 9, prState: 'MERGED' }],
    stateStories: { 'MARXY-NEW-stray': { status: 'todo' }, 'MARXY-3': { status: 'blocked' } },
  });
  const kinds = boardDrift(broken).map(f => f.kind).sort();
  assert.deepEqual(kinds, [
    KIND.BEHIND, KIND.DIRTY_BOARD, KIND.OFF_MAIN, KIND.STALE_REVIEW, KIND.UNBOARDED_PR,
    KIND.ORPHAN_STATE, KIND.UNEXPLAINED_BLOCK,
  ].sort());
});

test('BLOCKS_DISPATCH names exactly behind, off-main and dirty-board — never the two that are only informational', () => {
  assert.deepEqual(new Set(BLOCKS_DISPATCH), new Set([KIND.BEHIND, KIND.OFF_MAIN, KIND.DIRTY_BOARD]));
  assert.ok(!BLOCKS_DISPATCH.includes(KIND.UNBOARDED_PR));
  assert.ok(!BLOCKS_DISPATCH.includes(KIND.STALE_REVIEW));
  assert.ok(!BLOCKS_DISPATCH.includes(KIND.ORPHAN_STATE));
  assert.ok(!BLOCKS_DISPATCH.includes(KIND.UNEXPLAINED_BLOCK));
});

test('gatherBoardCheckInput reads the real checkout: shape matches what boardDrift expects', () => {
  const input = gatherBoardCheckInput();
  assert.equal(typeof input.branch, 'string');
  assert.equal(typeof input.behind, 'number');
  assert.ok(Array.isArray(input.dirtyTracked));
  assert.ok(Array.isArray(input.openPrs));
  assert.ok(Array.isArray(input.csvKeys));
  assert.ok(input.csvKeys.includes('MARXY-117'));
  assert.deepEqual(input.outOfPlanKeys, []);
  assert.ok(Array.isArray(input.inReview));
  // Must not throw when fed straight back in.
  assert.doesNotThrow(() => boardDrift(input));
});

test('node orchestration/board-check.mjs runs standalone: exit 0 and "clean" with no findings, exit 1 naming each finding otherwise', () => {
  const r = spawnSync(process.execPath, [join(root, 'orchestration/board-check.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  if (r.status === 0) {
    assert.deepEqual(lines, ['board-check: clean']);
  } else {
    assert.equal(r.status, 1);
    assert.ok(lines.length > 0);
    for (const line of lines) assert.match(line, /^(behind|off-main|dirty-board|unboarded-pr|stale-review|orphan-state|unexplained-block):/);
  }
});

test('cycle.mjs prints every board finding every cycle and holds step 6 (dispatch, headless or named) before naming or starting anything', () => {
  const src = readFileSync(join(here, 'cycle.mjs'), 'utf8');
  // The decision comes from board-check.mjs, not a second reimplementation cycle.mjs could drift from.
  assert.match(
    src,
    /import\s*\{[^}]*\bboardDrift\b[^}]*\bgatherBoardCheckInput\b[^}]*\bBLOCKS_DISPATCH\b[^}]*\}\s*from\s*['"]\.\/board-check\.mjs['"]/,
  );
  assert.doesNotMatch(src, /function\s+boardDrift\s*\(/);
  // Every finding prints, every cycle, before land/review/dispatch even run.
  assert.match(src, /const boardFindings = boardDrift\(gatherBoardCheckInput\(\)\);/);
  assert.match(src, /for \(const f of boardFindings\) say\(`board: \$\{f\.kind\} — \$\{f\.detail\}`\);/);
  assert.match(src, /const boardHold = boardFindings\.some\(f => BLOCKS_DISPATCH\.includes\(f\.kind\)\);/);
  // The board-hold branch is checked, and dispatches nothing, before the headless and the
  // named-only branches get a chance to run.
  const boardBranch = src.indexOf('if (ready.ready.length && boardHold)');
  const plannerBranch = src.indexOf('else if (ready.ready.length && planDue)');
  const headlessBranch = src.indexOf('say(`dispatching ${keys} headlessly`)');
  const namedBranch = src.indexOf('dispatch ${ready.ready.length} story(ies) into');
  assert.ok(boardBranch > -1, 'no board-hold branch in the dispatch step');
  assert.ok(
    boardBranch < plannerBranch && plannerBranch < headlessBranch && headlessBranch < namedBranch,
    'board-hold must be checked before planner-due, headless dispatch and named-only dispatch',
  );
});

test('the planner and orchestrator prompts say board changes go in a worktree off origin/main and a PR, never the orchestrator checkout', () => {
  const rule = /worktree.*origin\/main|origin\/main.*worktree/is;
  for (const path of ['prompts/planner.md', 'prompts/orchestrator.md', join('..', '.cursor', 'agents', 'planner.md')]) {
    const text = readFileSync(join(here, path), 'utf8');
    assert.match(text, rule, `${path} does not say board changes go through a worktree off origin/main`);
    assert.match(text, /\bPR\b/, `${path} does not say board changes go through a PR`);
    assert.match(text, /never/i, `${path} does not say never to edit the orchestrator checkout directly`);
    assert.match(text, /MARXY-117/, `${path} does not cite MARXY-117`);
  }
});

// MARXY-173: MARXY-NEW-tokens-test-live-values sat in state.json with no CSV row and no Jira issue.
// jira.mjs sync had renamed the row to MARXY-145; state.json is untracked, so the entry never followed.
test('a state.json key that is not a Jira key is an orphan-state finding, with the rename hint when sync recorded one', () => {
  const findings = boardDrift(clean({
    stateStories: {
      'MARXY-1': { status: 'todo' },
      'MARXY-145': { status: 'done' },
      'MARXY-NEW-tokens-test-live-values': { status: 'todo', branch: 'feat/MARXY-NEW-tokens-test-live-values-x', worktree: '../marxy-wt/MARXY-NEW-tokens-test-live-values' },
    },
    renames: { 'MARXY-NEW-tokens-test-live-values': 'MARXY-145' },
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.ORPHAN_STATE);
  assert.match(findings[0].detail, /MARXY-NEW-tokens-test-live-values/);
  assert.match(findings[0].detail, /renamed it to MARXY-145/);
  assert.match(findings[0].detail, /branch feat\/MARXY-NEW-tokens-test-live-values-x and worktree/);
});

test('an orphan with no rename on record says it was a placeholder, or that it is not a Jira key', () => {
  const input = key => clean({ stateStories: { [key]: { status: 'todo' } } });
  assert.match(boardDrift(input('MARXY-NEW-x'))[0].detail, /placeholder key/);
  assert.match(boardDrift(input('marxy-9'))[0].detail, /not a Jira key/);
});

test('an out-of-plan task has a real key and no CSV row, and is not an orphan', () => {
  // MARXY-112, 123, 161 and others are done tasks like this on the live board.
  assert.deepEqual(boardDrift(clean({ csvKeys: ['MARXY-1'], stateStories: { 'MARXY-161': { status: 'done', branch: 'fix/MARXY-161-x' } } })), []);
});

test('a blocked story with no parkedReason is named; one with a reason, and other statuses, are not', () => {
  const findings = boardDrift(clean({
    stateStories: {
      'MARXY-115': { status: 'blocked' },
      'MARXY-78': { status: 'blocked', parkedReason: 'paths MARXY-138 needs' },
      'MARXY-5': { status: 'todo' },
      'MARXY-6': { status: 'escalate' },
    },
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, KIND.UNEXPLAINED_BLOCK);
  assert.match(findings[0].detail, /MARXY-115/);
  assert.match(findings[0].detail, /state\.mjs block MARXY-115/);
});

test('boardTotals counts Jira-shaped keys, out-of-plan ones included, and lists the rest apart', () => {
  const { byStatus, orphans } = boardTotals({
    'MARXY-1': { status: 'todo' },
    'MARXY-161': { status: 'done' },
    'MARXY-NEW-x': { status: 'todo' },
  });
  assert.deepEqual(byStatus, { todo: ['MARXY-1'], done: ['MARXY-161'] });
  assert.deepEqual(orphans, ['MARXY-NEW-x']);
});

test('gatherBoardCheckInput hands boardDrift the local state, and a real checkout has no orphans', () => {
  const input = gatherBoardCheckInput();
  assert.equal(typeof input.stateStories, 'object');
  assert.deepEqual(boardDrift(input).filter(f => f.kind === KIND.ORPHAN_STATE), []);
});
