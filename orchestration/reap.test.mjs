// Verdicts and board moves for in_progress stories whose worker may be gone (MARXY-208).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, reapTransition, survey, staleMinutesOf, VERDICT } from './reap.mjs';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const rec = (over = {}) => ({ status: 'in_progress', attempts: 1, started: '2026-09-23T16:30:00.000Z', ...over });
const facts = (over = {}) => ({ held: null, ahead: 0, dirty: false, logBytes: 0, lastActivityMs: null, ...over });
const opts = { nowMs: NOW, staleMinutes: 90 };

test('a held lease is live, however long ago it started (a machine that slept)', () => {
  const r = classify(rec({ lease: { pid: 7 } }), facts({ held: true }), opts);
  assert.equal(r.verdict, VERDICT.LIVE);
});

test('the 2026-09-23 case: worker gone, no commits, clean worktree, no output — a ghost', () => {
  const r = classify(rec({ lease: { pid: 7 } }), facts({ held: false }), opts);
  assert.equal(r.verdict, VERDICT.GHOST);
});

test('a ghost is judged at once, not after a timeout: a killed worker is dead now', () => {
  const r = classify(rec({ started: new Date(NOW - 60_000).toISOString(), lease: { pid: 7 } }), facts({ held: false }), opts);
  assert.equal(r.verdict, VERDICT.GHOST);
});

test('worker gone but commits, changes or output left behind — dead, the ordinary return', () => {
  for (const f of [{ ahead: 2 }, { dirty: true }, { logBytes: 10 }]) {
    const r = classify(rec({ lease: { pid: 7 } }), facts({ held: false, ...f }), opts);
    assert.equal(r.verdict, VERDICT.DEAD, JSON.stringify(f));
  }
});

test('no lease (an in-app subagent, or a row from before leases): live until staleMinutes of quiet', () => {
  const recent = new Date(NOW - 10 * 60_000).toISOString();
  assert.equal(classify(rec({ started: recent }), facts(), opts).verdict, VERDICT.LIVE);
  assert.equal(classify(rec(), facts({ lastActivityMs: NOW - 5 * 60_000 }), opts).verdict, VERDICT.LIVE);
  assert.equal(classify(rec(), facts(), opts).verdict, VERDICT.GHOST);
});

test('no lease, quiet, but work in the worktree: quiet — named for a person, never reaped', () => {
  const r = classify(rec(), facts({ dirty: true, lastActivityMs: NOW - 200 * 60_000 }), opts);
  assert.equal(r.verdict, VERDICT.QUIET);
  const moved = rec();
  assert.equal(reapTransition(moved, r.verdict), null);
  assert.equal(moved.status, 'in_progress');
});

test('only in_progress stories get a verdict', () => {
  assert.equal(classify({ status: 'in_review' }, facts({ held: false }), opts), null);
});

test('a ghost is refunded its attempt and returned to todo, lease cleared', () => {
  const r = rec({ lease: { pid: 7 } });
  assert.equal(reapTransition(r, VERDICT.GHOST, { now: 'T' }), 'todo');
  assert.equal(r.attempts, 0);
  assert.equal(r.reaps, 1);
  assert.equal(r.lease, undefined);
  assert.equal(r.reapedAt, 'T');
});

test('a second ghost in a row parks the story blocked, with the reason', () => {
  const r = rec({ reaps: 1 });
  assert.equal(reapTransition(r, VERDICT.GHOST, { now: 'T' }), 'blocked');
  assert.match(r.parkedReason, /dispatch died 2 times/);
  assert.equal(r.blockedAt, 'T');
});

test('a dead story is the ordinary return: the attempt counts, the second escalates', () => {
  const first = rec({ attempts: 1 });
  assert.equal(reapTransition(first, VERDICT.DEAD), 'todo');
  assert.equal(first.attempts, 1);
  const second = rec({ attempts: 2 });
  assert.equal(reapTransition(second, VERDICT.DEAD, { now: 'T' }), 'escalate');
  assert.equal(second.blockedAt, 'T');
});

test('survey gives every in_progress story a verdict and ignores the rest', () => {
  const board = { stories: { 'MARXY-1': rec({ lease: { pid: 7 } }), 'MARXY-2': { status: 'done' }, 'MARXY-3': rec() } };
  const rows = survey({ board, m: { attemptMinutes: 45 }, nowMs: NOW, facts: key => facts({ held: key === 'MARXY-1' ? true : null }) });
  assert.deepEqual(rows.map(r => [r.key, r.verdict]), [['MARXY-1', 'live'], ['MARXY-3', 'ghost']]);
});

test('staleMinutes defaults to twice the attempt cap and can be set in models.json', () => {
  assert.equal(staleMinutesOf({ attemptMinutes: 45 }), 90);
  assert.equal(staleMinutesOf({ attemptMinutes: 45, staleMinutes: 20 }), 20);
});
