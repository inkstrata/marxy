// The cycle adopts open pull requests the board does not know are in review (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptions, applyAdoption, keyOfPr } from './adopt.mjs';

const pr = (number, key, extra = {}) => ({ number, title: `chore(x): thing (${key})`, headRefName: `chore/${key}-thing`, ...extra });

test('the key comes from the title first, then the branch', () => {
  assert.equal(keyOfPr({ title: 'fix: a (MARXY-7)', headRefName: 'fix/MARXY-8-a' }), 'MARXY-7');
  assert.equal(keyOfPr({ title: 'no key', headRefName: 'fix/MARXY-8-a' }), 'MARXY-8');
  assert.equal(keyOfPr({ title: 'no key', headRefName: 'wip/train' }), null);
});

test('an out-of-plan PR with no state entry is adopted, off main, in the phase its branch names', () => {
  const { adopt } = adoptions({ openPrs: [pr(184, 'MARXY-189')], phaseOf: () => null });
  assert.deepEqual(adopt, [{ key: 'MARXY-189', pr: 184, branch: 'chore/MARXY-189-thing', from: null, phase: 'ops', onMain: false }]);
  const s = { stories: {} };
  applyAdoption(s, adopt[0], 'T');
  assert.deepEqual(s.stories['MARXY-189'], { status: 'in_review', attempts: 0, pr: 184, branch: 'chore/MARXY-189-thing', adopted: 'T', outOfPlan: true, phase: 'ops' });
});

test('a planned story still In Progress is moved to review with its PR, attempts unchanged', () => {
  const stories = { 'MARXY-42': { status: 'in_progress', attempts: 1, worktree: '../marxy-wt/MARXY-42' } };
  const { adopt } = adoptions({ openPrs: [pr(183, 'MARXY-42')], stories, mainKeys: new Set(['MARXY-42']) });
  const s = { stories };
  applyAdoption(s, adopt[0], 'T');
  assert.equal(s.stories['MARXY-42'].status, 'in_review');
  assert.equal(s.stories['MARXY-42'].attempts, 1);
  assert.equal(s.stories['MARXY-42'].outOfPlan, undefined);
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

test('an entry already In Review on this PR is left alone', () => {
  const { adopt, skipped } = adoptions({ openPrs: [pr(10, 'MARXY-3')], stories: { 'MARXY-3': { status: 'in_review', pr: 10 } } });
  assert.deepEqual([adopt, skipped], [[], []]);
});
