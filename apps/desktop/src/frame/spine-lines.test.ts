import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lineRanges, lineStarts, runStarts } from './spine-lines.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('line starts count LF, and a lone CR only when asked', () => {
  assert.deepEqual(lineStarts(enc('ab\ncd\r\nef')), [0, 3, 7]);
  assert.deepEqual(lineStarts(enc('ab\rcd\r\nef')), [0, 7]);
  assert.deepEqual(lineStarts(enc('ab\rcd\r\nef'), true), [0, 3, 7]);
  assert.deepEqual(lineStarts(enc('é\nx')), [0, 3], 'bytes, not characters');
});

test('one edit mark per stretch of lines', () => {
  assert.deepEqual(runStarts([7, 3, 4, 5, 9, 10]), [3, 7, 9]);
  assert.deepEqual(runStarts([]), []);
});

test('lines become the spans they start; a line past the end is left out', () => {
  const starts = lineStarts(enc('a\nbb\nc'));
  assert.deepEqual(lineRanges([1, 2, 5], starts), [{ start: 2, end: 5 }, { start: 5, end: 5 }]);
});
