// When the Jira mirror pushes (ADR-0034, step 7): on change, on failure, and at least hourly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushDue, FORCE_PUSH_MS } from './mirror.mjs';

const AT = '2026-09-26T12:00:00.000Z';
const at = Date.parse(AT);

test('with no record of a successful push, push', () => {
  assert.equal(pushDue({ seq: 5, last: null, nowMs: at }), true);
  assert.equal(pushDue({ seq: 5, last: { seq: 'x', at: AT }, nowMs: at }), true);
  assert.equal(pushDue({ seq: 5, last: { seq: 5, at: 'garbage' }, nowMs: at }), true);
});

test('an unchanged board is quiet until the hour is up', () => {
  const last = { seq: 5, at: AT };
  assert.equal(pushDue({ seq: 5, last, nowMs: at + 1000 }), false);
  assert.equal(pushDue({ seq: 5, last, nowMs: at + FORCE_PUSH_MS - 1 }), false);
  assert.equal(pushDue({ seq: 5, last, nowMs: at + FORCE_PUSH_MS }), true);
});

test('a board that moved is pushed at once', () => {
  assert.equal(pushDue({ seq: 6, last: { seq: 5, at: AT }, nowMs: at + 1000 }), true);
});

test('a record from the future (a clock that went back) does not silence the mirror', () => {
  assert.equal(pushDue({ seq: 5, last: { seq: 5, at: AT }, nowMs: at - 3_600_000 }), true);
});
