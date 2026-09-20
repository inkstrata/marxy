// Hang fractions, in Node: quotes take the whole advance, protrusion takes its thousandths, and
// a letter with no left code must not move, so a test can fail the story without a browser.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hangFraction } from './hang.ts';

test('an opening quote hangs its whole advance', () => {
  assert.equal(hangFraction('\u201c'), 1);
  assert.equal(hangFraction('"'), 1);
  assert.equal(hangFraction('\u2018'), 1);
});

test('a latinProtrusion letter hangs by its left thousandths', () => {
  assert.equal(hangFraction('T'), 0.05);
  assert.equal(hangFraction('O'), 0.05);
});

test('a letter with no left protrusion does not hang', () => {
  assert.equal(hangFraction('B'), 0);
  assert.equal(hangFraction('e'), 0);
});
