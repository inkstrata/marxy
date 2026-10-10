// The pure mean behind --marxy-avg-char (H-06).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MEASURE_SAMPLE, averageAdvance, averageAdvanceOfRun } from './average-advance.ts';

test('the mean is the sum of advances over the number of code points', () => {
  assert.equal(averageAdvance('abcd', () => 0.5), 0.5);
  assert.equal(averageAdvance('ab', (c) => (c === 'a' ? 0.4 : 0.6)), 0.5);
});

test('an astral character counts once, not as two UTF-16 units', () => {
  assert.equal(averageAdvance('a\u{1F600}', () => 1), 1);
  assert.equal(averageAdvanceOfRun(20, 10, 'a\u{1F600}'), 1);
});

test('an empty text is 0, not NaN', () => {
  assert.equal(averageAdvance('', () => 1), 0);
  assert.equal(averageAdvanceOfRun(0, 10, ''), 0);
});

test('a run measured at two sizes gives the same em value', () => {
  assert.ok(Math.abs(averageAdvanceOfRun(463, 10, 'x'.repeat(100)) - averageAdvanceOfRun(926, 20, 'x'.repeat(100))) < 1e-12);
});

test('the sample is English prose: long enough, spaces and lowercase dominate, no controls', () => {
  assert.ok(MEASURE_SAMPLE.length > 700);
  const spaces = [...MEASURE_SAMPLE].filter((c) => c === ' ').length / MEASURE_SAMPLE.length;
  assert.ok(spaces > 0.12 && spaces < 0.2, String(spaces));
  assert.ok(!/[\u0000-\u001f]/.test(MEASURE_SAMPLE));
});
