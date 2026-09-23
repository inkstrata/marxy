// The review queue judges a PR against the row its branch brings, when it edits only its own (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processReviewQueue } from './cycle.mjs';

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
