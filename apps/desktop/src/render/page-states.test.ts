// The words and measures of the page's states: why a file could not be opened, where a wide
// table is cut and what its note line says, what a large open says while it works, and which blocks do not take
// the chrome's language. Pure: no DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failedWhy } from '../viewers/failed-why.ts';
import { notLatin } from './direction.ts';
import { cutAt, isFigure, moreSides, moreWords } from './wide-tables.ts';
import { readingWords } from './working.ts';

const err = (message: string, code?: string): Error => Object.assign(new Error(message), code ? { code } : {});

test('a failed open says why in plain words, from the code first and the message after', () => {
  assert.equal(failedWhy('/r/a.md', err('not found: /r/a.md', 'not-found')), 'Nothing is at this path now. It may have been moved, renamed or deleted, or its drive is not there.');
  assert.equal(failedWhy('/r/a.md', 'C:\\r\\a.md: The system cannot find the file specified. (os error 2)'), 'Nothing is at this path now. It may have been moved, renamed or deleted, or its drive is not there.');
  assert.equal(failedWhy('/r/a.md', err('/r/a.md: Access is denied. (os error 5)')), 'The system did not let Marxy read it.');
  assert.equal(failedWhy('/r/a.md', err('/r/a.md: permission denied', 'permission')), 'The system did not let Marxy read it.');
  assert.equal(failedWhy('/r/a.md', err('/r/a.md: too large to open (300 MB; the most Marxy opens is 256 MB)', 'refused')), 'At 300 MB it is larger than Marxy opens as text (256 MB).');
  assert.equal(failedWhy('/r/a.md', err('/r/a.md: not a regular file (a folder, pipe or device cannot be opened)', 'refused')), 'It is not a file: a folder, a pipe or a device cannot be opened.');
  assert.equal(failedWhy('/r/a.md', err('/r/a.md: the disk is on fire')), 'The system said: the disk is on fire');
  assert.ok(!failedWhy('/r/a.md', err('Error: odd')).includes('Error:'), 'no raw "Error:"');
});

test('a wide table is cut at the end of the last column that fits, never through one', () => {
  const ends = [100, 180, 260, 340, 420];
  assert.equal(cutAt(ends, 300), 260);
  assert.equal(cutAt(ends, 260), 260);
  assert.equal(cutAt(ends, 259.6), 260, 'half a pixel of rounding is not a cut');
  assert.equal(cutAt(ends, 80), 80, 'a first column wider than the room scrolls in the room');
});

test('a column of words crossing the edge shows to the room when enough of it does; figures never are cut', () => {
  const ends = [100, 180, 260, 340, 420];
  assert.equal(cutAt(ends, 330, []), 330, 'words: 70 px of the fourth column shows, so the box runs to the room');
  assert.equal(cutAt(ends, 300, []), 260, 'only 40 px would show: the column waits past the edge');
  assert.equal(cutAt(ends, 330, [false, false, false, true, false]), 260, 'a column of figures is never cut through');
  assert.equal(cutAt(ends, 500, [true, true, true, true, true]), 420, 'all fits');
  assert.equal(cutAt(ends, 80, []), 80, 'a first column wider than the room scrolls in the room');
});

test('the note line counts the columns past the edge, else those before it', () => {
  const ends = [100, 180, 260, 340, 420];
  assert.equal(moreWords(ends, 0, 260), '2 more columns →');
  assert.equal(moreWords(ends, 0, 340), '1 more column →');
  assert.equal(moreWords(ends, 160, 260), '← 2 columns before');
  assert.equal(moreWords(ends, 0, 420), '');
  assert.equal(moreSides(0, 160), 'end');
  assert.equal(moreSides(80, 160), 'both');
  assert.equal(moreSides(160, 160), 'start');
  assert.equal(moreSides(0, 0), null);
});

test('a large open says its size as the app says sizes', () => {
  assert.equal(readingWords(2_145_779), 'Reading 2.0 MB…');
  assert.equal(readingWords(3_258_708), 'Reading 3.1 MB…');
});

test('a block mostly in another script than Latin does not take the chrome language', () => {
  assert.equal(notLatin('مرحبا بالعالم'), true);
  assert.equal(notLatin('東京の潮汐表'), true);
  assert.equal(notLatin('Привет, мир'), true);
  assert.equal(notLatin('An English line with 2026 in it'), false);
  assert.equal(notLatin('Le café, déjà vu'), false);
  assert.equal(notLatin('مع رقم 2026 وكلمة English في الوسط'), true);
  assert.equal(notLatin('12 34 56'), false);
});

test('a cell reads as a figure when it is a number, a date, a time or a size; words and mixed text are not', () => {
  for (const cell of ['42', '-3.5', '1,200', '12%', '$4.99', '+7', '80 ms', '12.4 MB', '3 KB', '2026-10-14', '2026-10-14T03:00:00Z', '09:30', '1 234'])
    assert.equal(isFigure(cell), true, cell);
  for (const cell of ['', 'the walk skipped a folder', 'v2 beta', 'a1', '12 apples and pears', '~/notes', 'n/a', '1.2 fix it now'])
    assert.equal(isFigure(cell), false, cell);
});
