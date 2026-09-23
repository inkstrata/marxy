// One read of GitHub per cycle (MARXY-191).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, prime, snapshotFrom } from './github.mjs';
import { readPullRequest, realReadCount } from './review-order.mjs';

test('the snapshot is two gh calls, whatever the number of PRs', () => {
  const calls = [];
  const open = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, headRefName: `b${i}`, state: 'OPEN', files: [] }));
  const s = loadSnapshot({ gh: args => { calls.push(args.join(' ')); return JSON.stringify(args.includes('open') ? open : []); } });
  assert.equal(calls.length, 2);
  assert.equal(s.byNumber.size, 12);
});

test('a branch reads OPEN over MERGED over CLOSED, and unknown as null', () => {
  const s = snapshotFrom([{ number: 3, headRefName: 'b', state: 'OPEN' }], [
    { number: 1, headRefName: 'b', state: 'CLOSED' }, { number: 2, headRefName: 'm', state: 'MERGED' }, { number: 4, headRefName: 'm', state: 'CLOSED' },
  ]);
  assert.equal(s.branchState('b'), 'OPEN');
  assert.equal(s.branchState('m'), 'MERGED');
  assert.equal(s.branchState('nope'), null);
});

test('a primed snapshot answers the review order without a network read', () => {
  prime(snapshotFrom([{ number: 7, headRefName: 'b', state: 'OPEN', mergeStateStatus: 'BEHIND', mergeable: 'MERGEABLE', createdAt: 'T', files: [{ path: 'a' }] }]));
  const before = realReadCount();
  assert.deepEqual(readPullRequest(7), { files: ['a'], mergeStateStatus: 'BEHIND', mergeable: 'MERGEABLE', createdAt: 'T' });
  assert.equal(realReadCount(), before);
  prime(null);
});

test('the ops lane ranks after every numbered phase, consistently', async () => {
  const { computeOrder } = await import('./review-order.mjs');
  const d = { phases: { 1: ['A'], 3: ['B'], ops: ['O', 'P'] }, deps: {} };
  const stories = Object.fromEntries(['O', 'B', 'P', 'A'].map((k, i) => [k, { status: 'in_review', pr: i + 1 }]));
  const readPr = () => ({ files: [], mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', createdAt: null });
  const { order } = computeOrder({ s: { stories }, d, readPr });
  assert.deepEqual(order.map(r => r.key), ['A', 'B', 'O', 'P']);
});
