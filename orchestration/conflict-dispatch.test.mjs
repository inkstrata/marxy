// A returned conflict stays in progress and gets one resolution attempt (MARXY-217).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_CONFLICT_TRIES, chooseConflict, noteConflictTry, planConflictDispatch,
} from './conflict-dispatch.mjs';

const root = join(import.meta.dirname, '..');
const open = (number, status) => new Map([[number, { number, mergeStateStatus: status, mergeable: status === 'DIRTY' ? 'CONFLICTING' : 'MERGEABLE' }]]);

test('names the oldest conflicting in_progress pull request and skips a held lease', () => {
  const stories = {
    'MARXY-43': { status: 'in_progress', attempts: 1, pr: 199 },
    'MARXY-197': { status: 'in_progress', attempts: 2, pr: 198 },
    'MARXY-194': { status: 'in_review', attempts: 1, pr: 202 },
  };
  const pulls = new Map([
    [199, { number: 199, mergeStateStatus: 'DIRTY' }],
    [198, { number: 198, mergeable: 'CONFLICTING' }],
    [202, { number: 202, mergeStateStatus: 'DIRTY' }],
  ]);
  const picked = chooseConflict({ stories, openByNumber: pulls });
  assert.equal(picked.key, 'MARXY-197');
  assert.equal(picked.pr, 198);
  const held = chooseConflict({ stories, openByNumber: pulls, held: key => key === 'MARXY-197' });
  assert.equal(held.key, 'MARXY-43');
});

test('a clean or behind PR is not a conflict try, and three tries stop further starts', () => {
  const stories = { 'MARXY-43': { status: 'in_progress', attempts: 1, pr: 199, conflictTries: MAX_CONFLICT_TRIES } };
  const stopped = chooseConflict({ stories, openByNumber: open(199, 'DIRTY') });
  assert.equal(stopped.key, null);
  assert.deepEqual(stopped.exhausted, ['MARXY-43']);
  assert.match(stopped.why, /MARXY-43/);
  assert.equal(chooseConflict({ stories: { 'MARXY-43': { status: 'in_progress', attempts: 1, pr: 199 } }, openByNumber: open(199, 'BEHIND') }).key, null);
  assert.equal(chooseConflict({ stories: { 'MARXY-43': { status: 'in_progress', attempts: 1, pr: 199 } }, openByNumber: open(199, 'CLEAN') }).key, null);
});

test('a conflict try does not increment attempts, and dry-run or a missing CLI does not spawn', () => {
  const rec = { status: 'in_progress', attempts: 2 };
  noteConflictTry(rec);
  assert.equal(rec.attempts, 2);
  assert.equal(rec.conflictTries, 1);
  const stories = { 'MARXY-43': { status: 'in_progress', attempts: 2, pr: 199 } };
  const openPrs = [{ number: 199, mergeStateStatus: 'DIRTY' }];
  assert.equal(planConflictDispatch({ stories, openPrs, hasCli: true, dry: false }).spawn, true);
  assert.equal(planConflictDispatch({ stories, openPrs, hasCli: true, dry: true }).spawn, false);
  assert.equal(planConflictDispatch({ stories, openPrs, hasCli: false, dry: false }).spawn, false);
  assert.equal(planConflictDispatch({ stories, openPrs, hasCli: false, dry: false }).key, 'MARXY-43');
});

test('cycle.mjs starts the conflict resolver from planConflictDispatch', () => {
  const src = readFileSync(join(root, 'orchestration/cycle.mjs'), 'utf8');
  assert.match(src, /planConflictDispatch/);
  assert.match(src, /conflict-dispatch\.mjs/);
  const dispatcher = readFileSync(join(root, 'orchestration/conflict-dispatch.mjs'), 'utf8');
  assert.match(dispatcher, /noteConflictTry/);
  assert.doesNotMatch(dispatcher, /attempts \+= 1|rec\.attempts \+=/);
});
