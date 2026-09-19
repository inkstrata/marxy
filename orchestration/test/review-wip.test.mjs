// Named cases for review WIP, one-update-per-cycle, DIRTY return, approve holds and hold-reason
// retention (MARXY-81).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectReady } from '../ready.mjs';
import { HOLD_REASON_STRINGS, processReviewQueue, waitingTurn } from '../cycle.mjs';
import { SIGN_HOLDS, approvalHoldReason, selftest as approveSelftest } from '../approve.mjs';
import { BRANCHLESS_CHECKS, buildReview } from '../review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const BEFORE = JSON.parse(readFileSync(join(here, 'hold-reasons-before.json'), 'utf8'));

function story(key, paths) {
  return {
    Key: key,
    Summary: key,
    Paths: paths,
    Acceptance: 'observable',
    Labels: 'phase-0',
  };
}

function fixtureState(all, over = {}) {
  const stories = {};
  for (const st of all) stories[st.Key] = { status: 'todo', attempts: 0 };
  for (const [k, v] of Object.entries(over)) stories[k] = { ...stories[k], ...v };
  return { stories };
}

function readyFrom(all, stateOver = {}, reviewCap = 4) {
  return selectReady({
    all,
    s: fixtureState(all, stateOver),
    d: { phases: {}, deps: {} },
    cap: Infinity,
    reviewCap,
  });
}

test('models.json reviewLanes is 4, lanes stays null, and _note says what the cap is', () => {
  const models = JSON.parse(readFileSync(join(root, 'orchestration/models.json'), 'utf8'));
  assert.equal(models.reviewLanes, 4);
  assert.equal(models.lanes, null);
  assert.match(models._note, /reviewLanes/);
  assert.match(models._note, /lanes.*stays null|stays null/);
  assert.match(models._note, /In Review/i);
});

test('ready.mjs dispatches nothing while in_review count >= reviewLanes and prints blockedByReviewWip', () => {
  const all = [
    story('MARXY-A', 'a.ts'),
    story('MARXY-B', 'b.ts'),
    story('MARXY-C', 'c.ts'),
    story('MARXY-D', 'd.ts'),
    story('MARXY-E', 'e.ts'),
  ];
  const reviewing = {
    'MARXY-A': { status: 'in_review' },
    'MARXY-B': { status: 'in_review' },
    'MARXY-C': { status: 'in_review' },
    'MARXY-D': { status: 'in_review' },
  };
  const report = readyFrom(all, reviewing, 4);
  assert.deepEqual(report.ready, []);
  assert.deepEqual(report.blockedByReviewWip, { count: 4, cap: 4 });
});

test('a returned story does not count against reviewLanes: in_review → in_progress frees one and re-entry consumes one', () => {
  const all = [
    story('MARXY-A', 'a.ts'),
    story('MARXY-B', 'b.ts'),
    story('MARXY-C', 'c.ts'),
    story('MARXY-D', 'd.ts'),
    story('MARXY-E', 'e.ts'),
  ];
  const four = {
    'MARXY-A': { status: 'in_review' },
    'MARXY-B': { status: 'in_review' },
    'MARXY-C': { status: 'in_review' },
    'MARXY-D': { status: 'in_review' },
  };
  const full = readyFrom(all, four, 4);
  assert.equal(full.ready.length, 0);
  assert.equal(full.blockedByReviewWip.count, 4);

  const freed = readyFrom(all, { ...four, 'MARXY-A': { status: 'in_progress' } }, 4);
  assert.equal(freed.blockedByReviewWip.count, 3);
  assert.equal(freed.blockedByReviewWip.cap, 4);
  assert.deepEqual(freed.ready.map(r => r.key), ['MARXY-E']);
  assert.equal(freed.inProgress.includes('MARXY-A'), true);

  const back = readyFrom(all, four, 4);
  assert.equal(back.blockedByReviewWip.count, 4);
  assert.equal(back.ready.length, 0);
});

test('cycle.mjs updates exactly one BEHIND PR — the first order entry that is BEHIND — and prints waiting for the others', () => {
  const board = {
    'MARXY-A': { status: 'in_review', pr: 1 },
    'MARXY-B': { status: 'in_review', pr: 2 },
    'MARXY-C': { status: 'in_review', pr: 3 },
  };
  const pulls = {
    1: { state: 'OPEN', mergeStateStatus: 'BEHIND' },
    2: { state: 'OPEN', mergeStateStatus: 'BEHIND' },
    3: { state: 'OPEN', mergeStateStatus: 'BEHIND' },
  };
  const called = [];
  const { held, updates } = processReviewQueue({
    board,
    viewPr: n => pulls[n],
    updateBranch: n => { called.push(n); return 'ok'; },
    order: {
      order: [
        { key: 'MARXY-A', pr: 1, behind: true },
        { key: 'MARXY-B', pr: 2, behind: true },
        { key: 'MARXY-C', pr: 3, behind: true },
      ],
      excluded: [],
    },
  });
  assert.deepEqual(called, [1]);
  assert.deepEqual(updates, [1]);
  assert.equal(called.length, 1);
  assert.ok(held.some(l => l.includes(waitingTurn(2))));
  assert.ok(held.some(l => l.includes(waitingTurn(3))));
  assert.ok(held.some(l => /MARXY-A.*was behind main — updated; CI is re-running/.test(l)));
  assert.ok(held.every(l => !l.includes(waitingTurn(1))));
});

test('cycle.mjs returns a DIRTY PR to in_progress without increasing attempts and names the conflicting files', () => {
  const rec = { status: 'in_review', pr: 9, attempts: 2 };
  const board = { 'MARXY-Z': { ...rec } };
  let note = '';
  const { held } = processReviewQueue({
    board,
    viewPr: () => ({
      state: 'OPEN',
      mergeStateStatus: 'DIRTY',
      files: [{ path: 'packages/core/src/parse.ts' }, { path: 'CHANGELOG.md' }],
    }),
    updateBranch: () => { throw new Error('must not update a DIRTY PR'); },
    order: { order: [], excluded: [{ key: 'MARXY-Z', why: 'DIRTY' }] },
    returnDirty: (key, current) => {
      current.status = 'in_progress';
      board[key] = current;
    },
    writeResultNote: (_key, text) => { note = text; },
  });
  assert.equal(board['MARXY-Z'].status, 'in_progress');
  assert.equal(board['MARXY-Z'].attempts, 2);
  assert.match(note, /packages\/core\/src\/parse\.ts/);
  assert.match(note, /CHANGELOG\.md/);
  assert.equal(held.length, 0);
});

test('approve.mjs --selftest has a separately named case for BEHIND, DIRTY and not-first', () => {
  const r = spawnSync(process.execPath, ['orchestration/approve.mjs', '--selftest'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /selftest ok: BEHIND holds without writing a signature/);
  assert.match(r.stdout, /selftest ok: DIRTY holds without writing a signature/);
  assert.match(r.stdout, /selftest ok: not the first entry of the review order holds without writing a signature/);
  assert.equal(approveSelftest(), 0);
  assert.equal(approvalHoldReason({ key: 'MARXY-A', mergeStateStatus: 'BEHIND', orderKeys: ['MARXY-A'] }), SIGN_HOLDS.BEHIND);
  assert.equal(approvalHoldReason({ key: 'MARXY-A', mergeStateStatus: 'DIRTY', orderKeys: ['MARXY-A'] }), SIGN_HOLDS.DIRTY);
  assert.equal(approvalHoldReason({ key: 'MARXY-B', mergeStateStatus: 'CLEAN', orderKeys: ['MARXY-A', 'MARXY-B'] }), SIGN_HOLDS.NOT_FIRST);
});

test('no env-var escape hatch besides the existing MARXY_MERGE_UNREVIEWED', () => {
  const listed = execFileSync('grep', ['-RIn', '-E', 'process\\.env\\.[A-Z0-9_]+|MARXY_[A-Z0-9_]+', 'orchestration'], {
    cwd: root,
    encoding: 'utf8',
  });
  const escape = [...listed.matchAll(/process\.env\.(MARXY_[A-Z0-9_]+)/g)].map(m => m[1]);
  const unique = [...new Set(escape)];
  const allowed = new Set(['MARXY_COMPUTE', 'MARXY_MERGE_UNREVIEWED', 'MARXY_JIRA_ENV']);
  for (const name of unique) {
    assert.ok(allowed.has(name), `unexpected env var ${name}`);
  }
  assert.ok(unique.includes('MARXY_MERGE_UNREVIEWED'));
  const approveSrc = readFileSync(join(root, 'orchestration/approve.mjs'), 'utf8');
  assert.doesNotMatch(approveSrc, /process\.env/);
});

test('review.mjs exits non-zero when state.json records no branch, naming the four boundary checks', () => {
  const got = buildReview('MARXY-99', {
    stories: [{
      Key: 'MARXY-99',
      Summary: 'Review without a branch',
      Paths: 'orchestration/lib.mjs',
      Acceptance: 'packet fails without a branch',
      Labels: 'phase-0',
    }],
    state: { stories: { 'MARXY-99': { status: 'in_review', attempts: 1 } } },
    result: null,
  });
  assert.equal(got.ok, false);
  assert.equal(got.exit, 1);
  assert.match(got.text, /cannot determine the branch for MARXY-99/);
  assert.match(got.text, /state\.json has no branch/);
  assert.deepEqual(BRANCHLESS_CHECKS, [
    'files outside paths',
    'contract files touched',
    'fixtures/fonts touched',
    'files this branch deletes',
  ]);
  for (const name of BRANCHLESS_CHECKS) assert.match(got.text, new RegExp(name));
  assert.doesNotMatch(got.text, /files outside paths: none/);
  assert.doesNotMatch(got.text, /contract files touched: none/);
  assert.doesNotMatch(got.text, /fixtures\/fonts touched: none/);
  assert.doesNotMatch(got.text, /files this branch deletes: none/);
});

test('no hold reason is lost: cycle.mjs hold-reason strings are a superset of the before-list fixture', () => {
  const src = readFileSync(join(root, 'orchestration/cycle.mjs'), 'utf8');
  for (const phrase of BEFORE) {
    assert.ok(HOLD_REASON_STRINGS.includes(phrase), `exported list dropped "${phrase}"`);
    assert.ok(src.includes(phrase), `cycle.mjs source no longer prints "${phrase}"`);
  }
  assert.ok(HOLD_REASON_STRINGS.includes('behind main; waiting its turn in the review order (position '));
});

test('README documents reviewLanes, one update per cycle and the approve-time checks; CHANGELOG has a line', () => {
  const readme = readFileSync(join(root, 'orchestration/README.md'), 'utf8');
  assert.match(readme, /reviewLanes/);
  assert.match(readme, /one .* per cycle|at most one/i);
  assert.match(readme, /BEHIND/);
  assert.match(readme, /DIRTY/);
  assert.match(readme, /first entry|head of the order/i);
  const unreleased = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('## Unreleased')[1]?.split('\n## ')[0] || '';
  assert.match(unreleased, /MARXY-81/);
});
