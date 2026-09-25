// The review queue judges a PR against the row its branch brings, when it edits only its own (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processReviewQueue, holdsReadyDispatch, mergeLandingVerb, recordMergeLanding, shouldSpawnHeadlessPlanner } from './cycle.mjs';
import { transition } from './state.mjs';

const HEAD_OID = 'a'.repeat(40);
const green = { state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRefName: 'chore/MARXY-9-x', headRefOid: HEAD_OID, statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }], latestReviews: [] };
const row = paths => ({ Key: 'MARXY-9', Paths: paths, Acceptance: '1. x' });

function run(boundary, files, extra = {}) {
  const merged = [], said = [];
  const out = processReviewQueue({
    board: { 'MARXY-9': { status: 'in_review', pr: 9, branch: 'chore/MARXY-9-x' } },
    viewPr: () => green,
    boundaryOf: () => boundary,
    diffFiles: () => files,
    readResult: () => ({ status: 'done' }),
    verifyApproval: () => ({ ok: true }),
    codeOwners: () => '',
    mergeNow: n => { merged.push(n); return 'merged'; },
    say: l => said.push(l),
    ...extra,
  });
  return { ...out, merged, said };
}

test('an out-of-plan PR that brings its own row merges on that row, board files included', () => {
  const r = run(
    { story: row('orchestration/x.mjs'), ownOnly: true, others: [], added: true, widened: ['orchestration/x.mjs'] },
    ['orchestration/x.mjs', 'docs/plan/jira-issues.csv', 'orchestration/deps.json', 'CHANGELOG.md'],
  );
  assert.deepEqual(r.merged, [9], r.held.join('\n'));
});

test('a story that widens its own Paths merges on the widened row, and the widening is said aloud', () => {
  const r = run(
    { story: row('a, b'), ownOnly: true, others: [], added: false, widened: ['b'] },
    ['a/1', 'b/2', 'docs/plan/jira-issues.csv', 'CHANGELOG.md'],
  );
  assert.deepEqual(r.merged, [9]);
  assert.ok(r.said.some(l => /widens its own Paths: b/.test(l)));
});

test("a PR that edits another story's row is held, naming whose", () => {
  const r = run(
    { story: row('a'), ownOnly: false, others: ['MARXY-2'], added: false, widened: [] },
    ['a/1', 'docs/plan/jira-issues.csv', 'CHANGELOG.md'],
  );
  assert.deepEqual(r.merged, []);
  assert.ok(r.held.some(l => /outside the story's paths: docs\/plan\/jira-issues\.csv \(edits MARXY-2\)/.test(l)), r.held.join('\n'));
});

test('a PR with no row anywhere is held with the command that fixes it', () => {
  const r = run({ story: null, ownOnly: true, others: [], added: false, widened: [] }, ['a/1']);
  assert.deepEqual(r.merged, []);
  assert.ok(r.held.some(l => /no board row on main or on its branch.*out-of-plan\.mjs row MARXY-9/.test(l)));
});

test('the result file is looked up with the board record, so a worktree fallback can find it', () => {
  const seen = [];
  run({ story: row('a'), ownOnly: true, others: [], added: false, widened: [] }, ['a/1', 'CHANGELOG.md'], {
    readResult: (key, rec) => { seen.push([key, rec.branch]); return { status: 'done' }; },
  });
  assert.deepEqual(seen, [['MARXY-9', 'chore/MARXY-9-x']]);
});

test('finish is called with the merged diff files, so cycle.mjs can tell a plan-delta landing apart from an ordinary one (MARXY-200)', () => {
  const finished = [];
  const files = ['docs/plan/jira-issues.csv', 'orchestration/deps.json', 'CHANGELOG.md', 'docs/plan/deltas/2026-09-23.md'];
  run({ story: row('docs/plan/deltas, docs/plan/jira-issues.csv, orchestration/deps.json'), ownOnly: true, others: [], added: false, widened: [] }, files, {
    finish: (key, rec, note, seenFiles) => finished.push([key, seenFiles]),
  });
  assert.deepEqual(finished, [['MARXY-9', files]]);
});

test('landing a plan delta through recordMergeLanding stamps lastPlan with no manual planned step (MARXY-200 AC1)', () => {
  const s = { merges: 4, stories: { 'MARXY-9': { status: 'in_review', attempts: 1 } } };
  const st = s.stories['MARXY-9'];
  const files = ['docs/plan/deltas/2026-09-23.md', 'CHANGELOG.md'];
  assert.equal(mergeLandingVerb(files), 'plan-landed');
  const stateCalls = [];
  recordMergeLanding('MARXY-9', files, a => {
    stateCalls.push(a);
    transition(a[1], s, st, { now: () => '2026-09-23T12:00:00.000Z' });
  });
  assert.equal(stateCalls.length, 1);
  assert.equal(stateCalls[0][1], 'plan-landed');
  assert.equal(stateCalls[0][2], 'MARXY-9');
  assert.equal(s.lastPlan, '2026-09-23T12:00:00.000Z');
  assert.equal(s.mergesAtLastPlan, 5);
  assert.equal(st.planLanded, true);
});

test('cadence-only planner due does not hold dispatch; never-planned and escalation still do (MARXY-200 AC3)', () => {
  assert.equal(holdsReadyDispatch({ boardHold: false, planDue: false }), false);
  assert.equal(holdsReadyDispatch({ boardHold: false, planDue: true }), true);
  assert.equal(holdsReadyDispatch({ boardHold: true, planDue: false }), true);
});

test('cycle.mjs starts the headless reviewer after naming unreviewed pull requests and before the planner (MARXY-215)', () => {
  const text = readFileSync(new URL('./cycle.mjs', import.meta.url), 'utf8');
  const reviewAt = text.indexOf('if (needsReview.length)');
  const spawnAt = text.indexOf("here('review-dispatch.mjs')");
  const planAt = text.indexOf("here('planner-trigger.mjs')");
  assert.ok(reviewAt > 0 && spawnAt > reviewAt && planAt > spawnAt);
  assert.match(text, /planHeadlessReview/);
});

test('headless planner spawn follows the same gate as dispatch: due, CLI present, not dry-run (MARXY-200 AC4)', () => {
  assert.equal(shouldSpawnHeadlessPlanner({ planDueAny: true, hasCli: true, dry: false }), true);
  assert.equal(shouldSpawnHeadlessPlanner({ planDueAny: true, hasCli: false, dry: false }), false);
  assert.equal(shouldSpawnHeadlessPlanner({ planDueAny: true, hasCli: true, dry: true }), false);
  assert.equal(shouldSpawnHeadlessPlanner({ planDueAny: false, hasCli: true, dry: false }), false);
});

test('finish also gets the file list when the PR was already MERGED on read, before boundary/diff run', () => {
  const finished = [];
  const files = ['a/1', 'docs/plan/deltas/2026-09-23.md'];
  processReviewQueue({
    board: { 'MARXY-9': { status: 'in_review', pr: 9, branch: 'chore/MARXY-9-x' } },
    viewPr: () => ({ ...green, state: 'MERGED', files: files.map(path => ({ path })) }),
    finish: (key, rec, note, seenFiles) => finished.push([key, seenFiles]),
  });
  assert.deepEqual(finished, [['MARXY-9', files]]);
});
