// The cycle adopts open pull requests the board does not know are in review (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptions, adoptionEvent, keyOfPr, prConflicts, settlements } from './adopt.mjs';
import { fold } from './machine.mjs';

/** The board after adopting `a` onto `stories`, through the same fold the cycle uses. */
const adopted = (stories, a) => {
  const events = Object.entries(stories).length
    ? [{ type: 'imported', at: '2026-09-26T00:00:00.000Z', board: { stories: structuredClone(stories) } }]
    : [];
  return fold([...events, { ...adoptionEvent(a, 'T'), at: '2026-09-26T01:00:00.000Z' }]).stories;
};

const pr = (number, key, extra = {}) => ({ number, title: `chore(x): thing (${key})`, headRefName: `chore/${key}-thing`, ...extra });

test('the key comes from the title first, then the branch', () => {
  assert.equal(keyOfPr({ title: 'fix: a (MARXY-7)', headRefName: 'fix/MARXY-8-a' }), 'MARXY-7');
  assert.equal(keyOfPr({ title: 'no key', headRefName: 'fix/MARXY-8-a' }), 'MARXY-8');
  assert.equal(keyOfPr({ title: 'no key', headRefName: 'wip/train' }), null);
});

test('an out-of-plan PR with no state entry is adopted, off main, in the phase its branch names', () => {
  const { adopt } = adoptions({ openPrs: [pr(184, 'MARXY-189')], phaseOf: () => null });
  assert.deepEqual(adopt, [{ key: 'MARXY-189', pr: 184, branch: 'chore/MARXY-189-thing', from: null, phase: 'ops', onMain: false }]);
  const rec = adopted({}, adopt[0])['MARXY-189'];
  assert.equal(rec.status, 'in_review');
  assert.equal(rec.attempts, 0);
  assert.deepEqual([rec.pr, rec.branch, rec.adopted, rec.outOfPlan, rec.phase], [184, 'chore/MARXY-189-thing', 'T', true, 'ops']);
});

test('a planned story still In Progress is moved to review with its PR, attempts unchanged', () => {
  const stories = { 'MARXY-42': { status: 'in_progress', attempts: 1, worktree: '../marxy-wt/MARXY-42', claim: { by: 'a person', until: '2099-01-01T00:00:00Z' } } };
  const { adopt } = adoptions({ openPrs: [pr(183, 'MARXY-42')], stories, mainKeys: new Set(['MARXY-42']) });
  const rec = adopted(stories, adopt[0])['MARXY-42'];
  assert.equal(rec.status, 'in_review');
  assert.equal(rec.attempts, 1);
  assert.equal(rec.outOfPlan, undefined);
  assert.equal(rec.claim, undefined, 'the claim ends when its PR is adopted');
});

test('drafts, done/blocked/escalated stories and second PRs are skipped with a reason', () => {
  const stories = {
    'MARXY-1': { status: 'done' },
    'MARXY-2': { status: 'blocked' },
    'MARXY-3': { status: 'in_review', pr: 10 },
  };
  const { adopt, skipped } = adoptions({
    openPrs: [pr(20, 'MARXY-1'), pr(21, 'MARXY-2'), pr(22, 'MARXY-3'), pr(23, 'MARXY-4', { isDraft: true }), pr(24, 'MARXY-5'), pr(25, 'MARXY-5')],
    stories,
  });
  assert.deepEqual(adopt.map(a => a.pr), [24]);
  assert.deepEqual(skipped.map(x => [x.pr, x.why.split(' ').slice(-3).join(' ')]), [
    [20, 'a person decides'], [21, 'a person decides'], [22, '#10 in review'], [23, 'draft'], [25, '#24 in review'],
  ]);
});

test('a story an implementor run owns is left to that run, whatever its PR looks like', () => {
  const stories = { 'MARXY-43': { status: 'in_progress', attempts: 1, run: 'MARXY-43.implement.T' } };
  const { adopt, skipped } = adoptions({ openPrs: [pr(199, 'MARXY-43')], stories, mainKeys: new Set(['MARXY-43']) });
  assert.deepEqual(adopt, []);
  assert.match(skipped[0].why, /implementor run owns it/);
  assert.equal(prConflicts({ mergeStateStatus: 'DIRTY' }), true);
  assert.equal(prConflicts({ mergeStateStatus: 'CLEAN' }), false);
});

test('a returned PR is not adopted back until something new is pushed to it (MARXY-217)', () => {
  const stories = { 'MARXY-43': { status: 'todo', attempts: 1, pr: 199, returned: { at: 'T', head: 'a'.repeat(40), why: 'red: ci' } } };
  const same = adoptions({ openPrs: [pr(199, 'MARXY-43', { headRefOid: 'a'.repeat(40) })], stories, mainKeys: new Set(['MARXY-43']) });
  assert.deepEqual(same.adopt, []);
  const pushed = adoptions({ openPrs: [pr(199, 'MARXY-43', { headRefOid: 'b'.repeat(40) })], stories, mainKeys: new Set(['MARXY-43']) });
  assert.equal(pushed.adopt.length, 1);
  const rec = adopted(stories, pushed.adopt[0])['MARXY-43'];
  assert.equal(rec.status, 'in_review');
  assert.equal(rec.returned, undefined);
});

test('a conflicting PR is adopted like any other: the review pipeline resolves it without leaving review', () => {
  const firstSight = adoptions({
    openPrs: [pr(199, 'MARXY-43', { mergeStateStatus: 'DIRTY' })],
    stories: { 'MARXY-43': { status: 'todo', attempts: 1 } },
    mainKeys: new Set(['MARXY-43']),
  });
  assert.equal(firstSight.adopt.length, 1);
});

test('an entry already In Review on this PR is left alone', () => {
  const { adopt, skipped } = adoptions({ openPrs: [pr(10, 'MARXY-3')], stories: { 'MARXY-3': { status: 'in_review', pr: 10 } } });
  assert.deepEqual([adopt, skipped], [[], []]);
});

test('a no-dispatch row whose PR merged is settled Done, however it merged; nothing else is', () => {
  const rows = [
    { Key: 'MARXY-190', Labels: 'ops,out-of-plan,no-dispatch' },
    { Key: 'MARXY-192', Labels: 'ops,out-of-plan,no-dispatch' },
    { Key: 'MARXY-184', Labels: 'phase-3,desktop,out-of-plan' },
    { Key: 'MARXY-7', Labels: 'ops,no-dispatch' },
  ];
  const recentPrs = [
    { number: 1, headRefName: 'chore/MARXY-190-x', state: 'MERGED' },
    { number: 2, headRefName: 'feat/MARXY-192-x', state: 'OPEN' },
    { number: 3, headRefName: 'feat/MARXY-184-x', state: 'MERGED' },
    { number: 4, headRefName: 'chore/MARXY-7-x', state: 'MERGED' },
  ];
  assert.deepEqual(settlements({ rows, stories: { 'MARXY-7': { status: 'done' } }, recentPrs }), ['MARXY-190']);
});
