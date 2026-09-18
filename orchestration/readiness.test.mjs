// readiness.mjs: who a PR waits on, and the order PRs land in (MARXY-92).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TIERS, tierOf, mergeOrder, codeOwnerPatterns, ownedBy } from './readiness.mjs';

const row = (over = {}) => ({ reasons: [], action: 'merge', mergeStateStatus: 'CLEAN', ownedFiles: [], ...over });

test('a PR that clears the bar and touches no code-owner path merges now', () => {
  assert.equal(tierOf(row()), 'merge now');
});

test('mergeability GitHub has not computed yet is a wait, not a merge', () => {
  assert.equal(tierOf(row({ action: 'auto-merge', reasons: ['pending: GitHub is still working out whether it merges; re-run'] })), 'waiting on CI');
});

test('pending CI alone waits on CI', () => {
  assert.equal(tierOf(row({ action: 'auto-merge', reasons: ['pending: gates (ubuntu-latest)'] })), 'waiting on CI');
});

test('a code-owner path is never merge now, however green', () => {
  assert.equal(tierOf(row({ ownedFiles: ['.github/workflows/ci.yml'], reasons: ['code owner: 1 file(s) under CODEOWNERS'] })), 'Ian');
});

test('each hold reason names the actor who clears it', () => {
  assert.equal(tierOf(row({ reasons: ['not reviewed (no results/KEY.approved)'] })), 'reviewer');
  assert.equal(tierOf(row({ reasons: ['the approval is unsigned; run node orchestration/approve.mjs KEY'] })), 'reviewer');
  assert.equal(tierOf(row({ reasons: ['conflicts with main'] })), 'implementor');
  assert.equal(tierOf(row({ reasons: ['red: gates (ubuntu-latest)'] })), 'implementor');
  assert.equal(tierOf(row({ reasons: ["files outside the story's paths: x"] })), 'planner');
});

test('red on a branch that main has moved past is refreshed before it is anyone\'s fault', () => {
  assert.equal(tierOf(row({ mergeStateStatus: 'BEHIND', reasons: ['red: gates (ubuntu-latest)'] })), 'update branch');
  // A conflict cannot be refreshed away, so it stays the implementor's.
  assert.equal(tierOf(row({ mergeStateStatus: 'BEHIND', reasons: ['conflicts with main'] })), 'implementor');
});

const pr = (number, over) => ({ number, key: `MARXY-${number}`, tier: 'merge now', phase: 0, files: [], ageHours: 1, ...over });
const order = rows => mergeOrder(rows).map(r => r.number);

test('the tier decides first', () => {
  assert.deepEqual(order([pr(1, { tier: 'reviewer' }), pr(2, { tier: 'Ian' }), pr(3, { tier: 'merge now' })]), [3, 2, 1]);
  assert.equal(TIERS[0], 'merge now');
});

test('then phase, then disturbance, then age, then key', () => {
  assert.deepEqual(order([pr(1, { phase: 1 }), pr(2, { phase: 0 })]), [2, 1]);
  // #3 shares a file with #4 and #5; it lands first because it unblocks the most.
  assert.deepEqual(order([pr(4, { files: ['a'] }), pr(5, { files: ['b'] }), pr(3, { files: ['a', 'b'] })]).at(0), 3);
  assert.deepEqual(order([pr(6, { ageHours: 1 }), pr(7, { ageHours: 9 })]), [7, 6]);
  assert.deepEqual(order([pr(9), pr(8)]), [8, 9]);
});

test('files every PR touches are not a shared dependency', () => {
  const rows = mergeOrder([pr(1, { files: ['CHANGELOG.md', 'x'] }), pr(2, { files: ['CHANGELOG.md', 'orchestration/results/MARXY-2.json'] })]);
  assert.deepEqual(rows.map(r => r.disturbs), [0, 0]);
  assert.deepEqual(rows.map(r => r.after), [[], []]);
});

test('a later PR that shares a file names the earlier one it waits for', () => {
  const rows = mergeOrder([pr(2, { files: ['x'], ageHours: 1 }), pr(1, { files: ['x'], ageHours: 5 })]);
  assert.deepEqual(rows.map(r => [r.number, r.after]), [[1, []], [2, [1]]]);
});

test('CODEOWNERS patterns match directories by prefix and files exactly', () => {
  const p = codeOwnerPatterns('# comment\n/packages/theme/   @x\n/apps/desktop/src-tauri/tauri.conf.json @x\n');
  assert.ok(ownedBy(p, 'packages/theme/src/tokens.css'));
  assert.ok(ownedBy(p, 'apps/desktop/src-tauri/tauri.conf.json'));
  assert.ok(!ownedBy(p, 'packages/themes/x'));
  assert.ok(!ownedBy(p, 'apps/desktop/src-tauri/tauri.conf.json.bak'));
});
