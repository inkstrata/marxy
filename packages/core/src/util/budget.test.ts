import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budget, figure } from './budget.ts';

test('a budget counts work up to its limit and refuses what would pass it', () => {
  const b = budget(10);
  assert.equal(b.take(4), true);
  assert.equal(b.take(6), true);
  assert.equal(b.hit, false);
  assert.equal(b.take(), false);
  assert.equal(b.take(3), false);
  assert.deepEqual([b.used, b.refused, b.hit], [10, 4, true]);
});

test('levels taken on the way in are given back on the way out', () => {
  const depth = budget(2);
  assert.equal(depth.take(), true);
  assert.equal(depth.take(), true);
  assert.equal(depth.take(), false);
  depth.give();
  assert.equal(depth.take(), true);
  assert.deepEqual([depth.used, depth.refused], [2, 1]);
});

test('a zero budget refuses everything, and figures read as the readers write them', () => {
  const none = budget(0);
  assert.equal(none.take(), false);
  assert.equal(none.hit, true);
  assert.equal(figure(1234567), '1,234,567');
});
