// The split's arithmetic (07 §5, Appendix A).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_RATIO, clampRatio, fitsTwoColumns, minColumnWidth, minSplitWidth } from './geometry.ts';

const defaults = { avgChar: 0.463, bodyPx: 20, gutterPx: 24 };

test('minColumnWidth and minSplitWidth at body 20 px match the research', () => {
  assert.ok(Math.abs(minColumnWidth(defaults) - 464.7) < 0.05);
  assert.ok(Math.abs(minSplitWidth(defaults) - 929.4) < 0.05);
});

test('minSplitWidth at body 28 px exceeds 1,262', () => {
  const w = minSplitWidth({ ...defaults, bodyPx: 28 });
  assert.ok(w > 1262 && w < 1263, String(w));
});

test('fitsTwoColumns compares in whole pixels', () => {
  assert.equal(fitsTwoColumns(929, defaults), true);
  assert.equal(fitsTwoColumns(928, defaults), false);
  assert.equal(fitsTwoColumns(1318, defaults), true);
  assert.equal(fitsTwoColumns(1200, { ...defaults, bodyPx: 28 }), false);
});

test('clampRatio keeps both columns at the floor', () => {
  const min = minColumnWidth(defaults);
  assert.ok(clampRatio(0.05, 1470, defaults) >= min / 1470);
  assert.ok(clampRatio(0.95, 1470, defaults) <= 1 - min / 1470);
  assert.equal(clampRatio(0.5, 1470, defaults), 0.5);
});

test('clampRatio falls back to the default for NaN or an impossible width', () => {
  assert.equal(clampRatio(NaN, 1470, defaults), DEFAULT_RATIO);
  assert.equal(clampRatio(0.3, 800, defaults), DEFAULT_RATIO);
  assert.equal(clampRatio(0.3, 0, defaults), DEFAULT_RATIO);
  assert.equal(clampRatio(0.3, NaN, defaults), DEFAULT_RATIO);
});

test('clampRatio never leaves (0, 1)', () => {
  for (const ratio of [-5, 0, 1, 7, Infinity, -Infinity]) {
    const r = clampRatio(ratio, 1470, defaults);
    assert.ok(r > 0 && r < 1, String(ratio));
  }
});
