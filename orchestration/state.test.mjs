// Board verbs that record why a story is parked (MARXY-173).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from './state.mjs';

const at = () => '2026-09-20T00:00:00.000Z';
const argv = (...rest) => ['node', 'state.mjs', 'block', 'MARXY-1', ...rest];

test('block records the words after the key as parkedReason and stamps blockedAt', () => {
  const st = { status: 'todo', attempts: 1 };
  assert.ok(transition('block', { merges: 0 }, st, { argv: argv('waiting', 'on', 'a', 'ruling'), now: at }));
  assert.equal(st.status, 'blocked');
  assert.equal(st.parkedReason, 'waiting on a ruling');
  assert.equal(st.blockedAt, at());
});

test('block with no reason blocks but records none, so board-check can name it', () => {
  const st = { status: 'todo', attempts: 1 };
  transition('block', { merges: 0 }, st, { argv: argv(), now: at });
  assert.equal(st.status, 'blocked');
  assert.equal('parkedReason' in st, false);
});

test('a story that starts, is returned or lands is no longer parked', () => {
  for (const cmd of ['start', 'return', 'done']) {
    const st = { status: 'blocked', attempts: 0, parkedReason: 'old reason' };
    transition(cmd, { merges: 0 }, st, { argv: argv(), now: at });
    assert.equal('parkedReason' in st, false, cmd);
  }
});
