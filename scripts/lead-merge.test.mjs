// scripts/lead-merge.mjs decides whether the lead may merge a pull request on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockers, verdictFor, markerLine } from './lead-merge.mjs';

const HEAD = '1234567890abcdef1234567890abcdef12345678';
const OWNER = 'inkstrata';
const by = (login, body) => ({ author: { login }, body });
const run = (name, status, conclusion, extra = {}) => ({ __typename: 'CheckRun', name, status, conclusion, workflowName: 'ci', ...extra });

function ready(over = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    headRefOid: HEAD,
    statusCheckRollup: [
      run('ci', 'COMPLETED', 'SUCCESS'),
      run('browser-lite', 'COMPLETED', 'SUCCESS'),
      run('rust', 'COMPLETED', 'SKIPPED'),
    ],
    comments: [by(OWNER, `review notes\n\n${markerLine('merge', HEAD)}\n`)],
    ...over,
  };
}
const why = (over, owner = OWNER) => blockers(ready(over), owner);

test('a PR with green checks and the owner\'s merge verdict for its head is ready', () => {
  assert.deepEqual(why({}), []);
});

test('a merge marker from anyone but the repository owner counts for nothing', () => {
  const comments = [by('someone-else', markerLine('merge', HEAD)), { author: null, body: markerLine('merge', HEAD) }];
  assert.ok(why({ comments }).some(w => /no merge verdict from inkstrata/.test(w)));
});

test('the owner is compared without case', () => {
  assert.equal(verdictFor([by('InkStrata', markerLine('merge', HEAD))], HEAD, OWNER), 'merge');
});

test('a verdict for an earlier head does not count: a push after review needs a new one', () => {
  assert.ok(why({ comments: [by(OWNER, markerLine('merge', 'abcdef1'))] }).some(w => /no merge verdict/.test(w)));
});

test('a short sha in the marker binds to the head it prefixes', () => {
  assert.equal(verdictFor([by(OWNER, markerLine('merge', HEAD.slice(0, 8)))], HEAD, OWNER), 'merge');
});

test('a later hold wins over an earlier merge', () => {
  const comments = [by(OWNER, markerLine('merge', HEAD)), by(OWNER, markerLine('hold', HEAD))];
  assert.ok(why({ comments }).some(w => /holds this PR/.test(w)));
});

test('a hold survives a push: it holds whatever head comes after it', () => {
  const comments = [by(OWNER, markerLine('hold', 'abcdef1'))];
  assert.ok(why({ comments }).some(w => /holds this PR/.test(w)));
});

test('a merge verdict after a hold releases it for the head it names', () => {
  const comments = [by(OWNER, markerLine('hold', 'abcdef1')), by(OWNER, markerLine('merge', HEAD))];
  assert.deepEqual(why({ comments }), []);
});

test('prose that says "verdict: merge" and a marker quoted in a fence are not verdicts', () => {
  assert.equal(verdictFor([by(OWNER, '**Lead review: verdict: merge** once CI is green')], HEAD, OWNER), null);
  assert.equal(verdictFor([by(OWNER, `Use:\n\`\`\`\n${markerLine('merge', HEAD)}\n\`\`\`\n`)], HEAD, OWNER), null);
});

test('a running check blocks, as a CheckRun or a commit status', () => {
  const statusCheckRollup = [
    run('ci', 'IN_PROGRESS', ''),
    run('browser-lite', 'QUEUED', ''),
    { __typename: 'StatusContext', context: 'deploy', state: 'PENDING' },
  ];
  assert.ok(why({ statusCheckRollup }).some(w => /checks still running: ci, browser-lite, deploy/.test(w)));
});

test('a failed, cancelled, timed-out or errored check blocks', () => {
  const statusCheckRollup = [
    run('ci', 'COMPLETED', 'FAILURE'),
    run('browser-lite', 'COMPLETED', 'CANCELLED'),
    run('fast', 'COMPLETED', 'TIMED_OUT'),
    { __typename: 'StatusContext', context: 'deploy', state: 'ERROR' },
  ];
  assert.ok(why({ statusCheckRollup }).some(w => /not green: ci FAILURE, browser-lite CANCELLED, fast TIMED_OUT, deploy ERROR/.test(w)));
});

test('the required ci must be a SUCCESS, not skipped, and must be the ci workflow\'s check run', () => {
  assert.ok(why({ statusCheckRollup: [run('ci', 'COMPLETED', 'SKIPPED')] }).some(w => /`ci` is SKIPPED, not SUCCESS/.test(w)));
  const impostors = [
    { __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' },
    run('ci', 'COMPLETED', 'SUCCESS', { workflowName: 'other' }),
  ];
  assert.ok(why({ statusCheckRollup: impostors }).some(w => /`ci` has not reported/.test(w)));
});

test('no checks at all (just pushed) blocks', () => {
  assert.ok(why({ statusCheckRollup: [] }).some(w => /`ci` has not reported/.test(w)));
});

test('a stacked base, a conflict, a draft, requested changes and a required review each block', () => {
  assert.ok(why({ baseRefName: 'fix/f-04-x' }).some(w => /base is fix\/f-04-x/.test(w)));
  assert.ok(why({ mergeable: 'CONFLICTING' }).some(w => /mergeable is CONFLICTING/.test(w)));
  assert.ok(why({ isDraft: true }).some(w => /draft/.test(w)));
  assert.ok(why({ reviewDecision: 'CHANGES_REQUESTED' }).some(w => /requested changes/.test(w)));
  assert.ok(why({ reviewDecision: 'REVIEW_REQUIRED' }).some(w => /waits for the author/.test(w)));
});

test('a closed or merged PR blocks', () => {
  assert.ok(why({ state: 'MERGED' }).some(w => /state is MERGED/.test(w)));
});

// The stacked-PR fallback, driven with a stubbed gh.
import { mergeAsync } from './lead-merge.mjs';

function stub(replies) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return JSON.stringify(r);
    },
  };
}
const noWait = () => {};

test('a stacked merge that completes at once (200, merged) is reported merged, not failed', () => {
  const s = stub([{ status: 'merged' }]);
  assert.equal(mergeAsync('o/r', 7, HEAD, { run: s.run, wait: noWait }), 'merged');
  assert.ok(s.calls[0].includes('merge_method=squash') && s.calls[0].includes(`sha=${HEAD}`));
});

test('a pending stacked merge is polled until it merges', () => {
  const s = stub([{ status: 'pending', details: { uuid: 'u1' } }, { status: 'pending' }, { status: 'merged' }]);
  assert.equal(mergeAsync('o/r', 7, HEAD, { run: s.run, wait: noWait }), 'merged');
  assert.ok(s.calls[2].some(a => a.endsWith('/merge-async/u1')));
});

test('a transient poll error is retried; persistent errors end in a plain "check the PR"', () => {
  const ok = stub([{ status: 'pending', details: { uuid: 'u' } }, new Error('502'), { status: 'merged' }]);
  assert.equal(mergeAsync('o/r', 7, HEAD, { run: ok.run, wait: noWait }), 'merged');
  const bad = stub([{ status: 'pending', details: { uuid: 'u' } }, ...Array(5).fill(new Error('502'))]);
  assert.match(mergeAsync('o/r', 7, HEAD, { run: bad.run, wait: noWait }), /unknown after poll errors.*check the PR/);
});

test('enqueued and failed are not merged; a refused request says so', () => {
  assert.equal(mergeAsync('o/r', 7, HEAD, { run: stub([{ status: 'enqueued' }]).run, wait: noWait }), 'queued, not merged');
  const s = stub([{ status: 'pending', details: { uuid: 'u' } }, { status: 'failed' }]);
  assert.equal(mergeAsync('o/r', 7, HEAD, { run: s.run, wait: noWait }), 'failed');
  assert.match(mergeAsync('o/r', 7, HEAD, { run: stub([new Error('403 head moved')]).run, wait: noWait }), /^refused: 403 head moved/);
});
