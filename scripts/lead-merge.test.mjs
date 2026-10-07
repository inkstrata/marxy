// scripts/lead-merge.mjs decides whether the lead may merge a pull request on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockers, verdictFor, markerLine } from './lead-merge.mjs';

const HEAD = '1234567890abcdef1234567890abcdef12345678';

function ready(over = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    headRefOid: HEAD,
    statusCheckRollup: [
      { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'browser-lite', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'rust', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ],
    comments: [{ body: `review notes\n\n${markerLine('merge', HEAD)}\n` }],
    ...over,
  };
}

test('a PR with green checks and a merge verdict for its head is ready', () => {
  assert.deepEqual(blockers(ready()), []);
});

test('a verdict for an earlier head does not count: a push after review needs a new one', () => {
  const why = blockers(ready({ comments: [{ body: markerLine('merge', 'abcdef1') }] }));
  assert.ok(why.some(w => /no lead verdict names the head/.test(w)));
});

test('a short sha in the marker binds to the head it prefixes', () => {
  assert.equal(verdictFor([{ body: markerLine('merge', HEAD.slice(0, 8)) }], HEAD), 'merge');
});

test('a later hold for the same head wins over an earlier merge', () => {
  const comments = [{ body: markerLine('merge', HEAD) }, { body: markerLine('hold', HEAD) }];
  assert.ok(blockers(ready({ comments })).some(w => /verdict for this head is hold/.test(w)));
});

test('prose that merely says "verdict: merge" is not a marker', () => {
  assert.equal(verdictFor([{ body: '**Lead review: verdict: merge** once CI is green' }], HEAD), null);
});

test('a running check blocks', () => {
  const statusCheckRollup = [
    { name: 'ci', status: 'IN_PROGRESS', conclusion: '' },
    { name: 'browser-lite', status: 'QUEUED', conclusion: '' },
  ];
  assert.ok(blockers(ready({ statusCheckRollup })).some(w => /checks still running: ci, browser-lite/.test(w)));
});

test('a failed or cancelled check blocks', () => {
  const statusCheckRollup = [
    { name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'browser-lite', status: 'COMPLETED', conclusion: 'CANCELLED' },
  ];
  const why = blockers(ready({ statusCheckRollup }));
  assert.ok(why.some(w => /not green: ci FAILURE, browser-lite CANCELLED/.test(w)));
});

test('a missing ci check blocks even when every other check is green', () => {
  const statusCheckRollup = [{ name: 'fast', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  assert.ok(blockers(ready({ statusCheckRollup })).some(w => /`ci` has not reported/.test(w)));
});

test('a stacked PR, a conflict, a draft and requested changes each block', () => {
  assert.ok(blockers(ready({ baseRefName: 'fix/f-04-x' })).some(w => /base is fix\/f-04-x/.test(w)));
  assert.ok(blockers(ready({ mergeable: 'CONFLICTING' })).some(w => /mergeable is CONFLICTING/.test(w)));
  assert.ok(blockers(ready({ isDraft: true })).some(w => /draft/.test(w)));
  assert.ok(blockers(ready({ reviewDecision: 'CHANGES_REQUESTED' })).some(w => /requested changes/.test(w)));
});

test('a closed or merged PR blocks', () => {
  assert.ok(blockers(ready({ state: 'MERGED' })).some(w => /state is MERGED/.test(w)));
});
