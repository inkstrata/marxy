// One case per board verb that stamps blockedAt, so a ruling the planner has already read
// does not make it due again (MARXY-120).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from '../state.mjs';

const STAMP = '2026-09-19T12:00:00.000Z';
const now = () => STAMP;

test('block stamps blockedAt with an ISO timestamp', () => {
  const st = { status: 'in_progress', attempts: 1 };
  const ok = transition('block', { merges: 0 }, st, { now });
  assert.equal(ok, true);
  assert.equal(st.status, 'blocked');
  assert.equal(st.blockedAt, STAMP);
});

test('escalate stamps blockedAt with an ISO timestamp', () => {
  const st = { status: 'in_progress', attempts: 2 };
  transition('escalate', { merges: 0 }, st, { now });
  assert.equal(st.status, 'escalate');
  assert.equal(st.blockedAt, STAMP);
});

test('return stamps blockedAt when it lands on escalate (attempts >= 2)', () => {
  const st = { status: 'in_progress', attempts: 2 };
  transition('return', { merges: 0 }, st, { now });
  assert.equal(st.status, 'escalate');
  assert.equal(st.blockedAt, STAMP);
});

test('return to todo (attempts < 2) does not stamp blockedAt', () => {
  const st = { status: 'in_progress', attempts: 1 };
  transition('return', { merges: 0 }, st, { now });
  assert.equal(st.status, 'todo');
  assert.equal(st.blockedAt, undefined);
});

test('start and done do not stamp blockedAt', () => {
  const s = { merges: 0 };
  const st = { status: 'todo', attempts: 0 };
  transition('start', s, st, { now });
  assert.equal(st.blockedAt, undefined);
  transition('done', s, st, { now });
  assert.equal(st.status, 'done');
  assert.equal(st.finished, STAMP);
  assert.equal(s.merges, 1);
  assert.equal(st.blockedAt, undefined);
});

test('an unknown verb returns false instead of throwing or exiting', () => {
  const st = { status: 'todo', attempts: 0 };
  assert.equal(transition('bogus', { merges: 0 }, st, { now }), false);
  assert.equal(st.status, 'todo');
});
