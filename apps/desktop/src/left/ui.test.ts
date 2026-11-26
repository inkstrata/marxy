// The panels' marked words: ranges of the text as written, whatever lowering does to its length.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markRanges } from './ui.ts';

const marked = (text: string, words: string[]): string[] => markRanges(text, words).map(([a, b]) => text.slice(a, b));

test('a word is marked where it is in the text, any case', () => {
  assert.deepEqual(marked('Max and max_wait', ['max']), ['Max', 'max']);
  assert.deepEqual(marked('max_wait_ms', ['max', 'max_wait']), ['max_wait'], 'the longer at one place');
  assert.deepEqual(marked('nothing here', []), []);
});

test('İ, which lowers to two units, does not shift the marks after it', () => {
  assert.deepEqual(marked('İstanbul and Rome', ['rome']), ['Rome']);
  assert.deepEqual(marked('İİ max', ['max']), ['max']);
  assert.deepEqual(marked('a \u{1D538} Max', ['max']), ['Max'], 'a surrogate pair kept whole');
});
