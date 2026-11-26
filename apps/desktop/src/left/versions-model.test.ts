// The Versions panel's words: when, why, how large, and the totals; none of them says how a copy differs.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { copiesWords, inAllWords, sizeWords, skippedWords, whenWords, whyWords } from './versions-model.ts';

test('export all: the copies it could not read are named, the first three', () => {
  assert.equal(skippedWords(['a.md (Today, 14:02)']), 'a copy could not be read and is left out: a.md (Today, 14:02)');
  assert.equal(skippedWords(['a', 'b', 'c', 'd', 'e']), '5 copies could not be read and are left out: a, b, c and 2 more');
});

test('when: today by its time, another day by its date, another year with the year', () => {
  const now = new Date(2026, 10, 11, 16, 0).getTime();
  assert.equal(whenWords(new Date(2026, 10, 11, 14, 2).getTime(), now), 'Today, 14:02');
  assert.equal(whenWords(new Date(2026, 9, 15, 8, 27).getTime(), now), '15 Oct, 08:27');
  assert.equal(whenWords(new Date(2025, 9, 8, 9, 14).getTime(), now), '8 Oct 2025, 09:14');
});

test('why, size and totals in words', () => {
  assert.equal(whyWords('before save'), 'before your save');
  assert.equal(whyWords('before reload'), 'before a replacement from outside');
  assert.equal(sizeWords(312), '312 bytes');
  assert.equal(sizeWords(4200), '4.1 KB');
  assert.equal(copiesWords(1), '1 copy');
  const v = { id: 1, slot: 1, time: 0, size: 1, hash: '', reason: 'before save' as const };
  assert.equal(inAllWords([{ versions: [v, v] }, { versions: [v] }], 217_088), '3 copies of 2 files · 212 KB');
});
