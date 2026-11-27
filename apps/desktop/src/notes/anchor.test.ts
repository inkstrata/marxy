import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { followLines, linesOf, putNote, reanchor, type Note } from './anchor.ts';
import { pieceOf, piecesAsMarkdown, replyPieces } from '../tray/markdown.ts';

const note = (l0: number, l1: number, key: string, text = 'n'): Note => ({ l0, l1, key, text });

test('linesOf: every ending, no line for the final one', () => {
  assert.deepEqual(linesOf('a\r\nb\nc\rd\n'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(linesOf('a'), ['a']);
});

test('reanchor: a note stays on its line, follows it when lines are added or removed above, nearest first', () => {
  const lines = ['# T', '', 'para', '', 'end'];
  assert.deepEqual(reanchor([note(2, 3, 'para')], lines), [note(2, 3, 'para')]);
  const moved = reanchor([note(2, 4, 'para')], ['new', '', '# T', '', 'para', 'x', '', 'end']);
  assert.deepEqual([moved[0]!.l0, moved[0]!.l1], [4, 6]);
  const near = reanchor([note(5, 6, 'same')], ['same', '', '', '', '', '', 'same']);
  assert.equal(near[0]!.l0, 6, 'the nearer of two equal lines');
  const gone = reanchor([note(9, 10, 'nowhere')], ['a', 'b']);
  assert.deepEqual([gone[0]!.l0, gone[0]!.l1], [1, 2], 'a line that is gone: kept, clamped to the file');
});

test('reanchor: a note that cannot move is the same note, so nothing is written for it', () => {
  const notes = [note(9, 10, 'nowhere')];
  const once = reanchor(notes, ['a', 'b']);
  assert.equal(reanchor(once, ['a', 'b', 'c'])[0], once[0]);
});

test('followLines: a note follows edits by the lines added or removed, and takes its line’s new text when it is edited', () => {
  const before = ['# T', '', 'para', 'more', '', 'end'];
  const notes = [note(2, 4, 'para'), note(5, 6, 'end')];
  assert.equal(followLines(notes, before, before), notes, 'nothing moved: the same list');
  assert.equal(followLines(notes, before, ['# Title', '', 'para', 'more', '', 'end']), notes, 'an edit above: the same list');
  const edited = followLines(notes, before, ['# T', '', 'para, changed', 'more', '', 'end']);
  assert.deepEqual(edited[0], note(2, 4, 'para, changed'), 'the noted line edited: kept on it, key refreshed');
  assert.equal(edited[1], notes[1]);
  const added = followLines(notes, before, ['# T', 'new', 'para', '', 'para', 'more', '', 'end']);
  assert.deepEqual(added.map((n) => [n.l0, n.l1, n.key]), [[4, 6, 'para'], [7, 8, 'end']], 'lines added above, one a copy of the noted line: moved by two');
  const removed = followLines(notes, before, ['para', 'more', '', 'end']);
  assert.deepEqual(removed.map((n) => [n.l0, n.l1]), [[0, 2], [3, 4]], 'lines removed above');
  const inside = followLines([note(1, 4, 'b')], ['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'x', 'y', 'c', 'd', 'e']);
  assert.deepEqual([inside[0]!.l0, inside[0]!.l1], [1, 6], 'lines added inside a part: its end follows');
  const gone = followLines([note(2, 3, 'c')], ['a', 'b', 'c', 'd'], ['a', 'b', 'd']);
  assert.deepEqual(gone[0], note(1, 2, 'b'), 'its line removed: on the nearest line left, with that line’s text');
  const split = followLines([note(1, 2, 'one two')], ['a', 'one two', 'z'], ['a', 'one', 'two', 'z']);
  assert.deepEqual(split[0], note(1, 3, 'one'), 'its line split: from the first half, over both');
  const fresh = followLines([note(0, 1, 'b')], null, ['a', 'b']);
  assert.equal(fresh[0]!.l0, 1, 'no earlier text: found by its key');
});

test('putNote: one note per line, in order; an empty note is taken off', () => {
  let notes = putNote([], note(4, 5, 'b', 'second'));
  notes = putNote(notes, note(1, 2, 'a', 'first'));
  assert.deepEqual(notes.map((n) => n.text), ['first', 'second']);
  notes = putNote(notes, note(4, 5, 'b', 'changed'));
  assert.deepEqual(notes.map((n) => n.text), ['first', 'changed']);
  assert.deepEqual(putNote(notes, note(1, 2, 'a', '  ')).map((n) => n.text), ['changed']);
});

test('a reply quotes the opening of each part with path:lines, then the note', () => {
  const text = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
  const pieces = replyPieces('/r/a.md', text, [note(0, 1, 'one', 'Check this'), note(1, 7, 'two', 'Too long')]);
  assert.equal(pieces[1]!.text, 'two\nthree\nfour\nfive\n[… 2 more lines]');
  assert.equal(
    piecesAsMarkdown(pieces),
    '> one\n\n— `/r/a.md:1`\n\nCheck this\n\n> two\n> three\n> four\n> five\n> [… 2 more lines]\n\n— `/r/a.md:2-7`\n\nToo long\n',
  );
});

test('a reply sets a note by address under its address, not as line 1, and quotes the lines of a lines-only address', () => {
  const text = 'one\ntwo\nthree\n';
  const cell: Note = { l0: 0, l1: 0, key: '', text: 'Odd total', address: '#Summary!F5' };
  const span: Note = { l0: 0, l1: 0, key: '', text: 'These two', address: ':2–3' };
  const pieces = replyPieces('/r/a.xlsx', text, [cell, span]);
  assert.equal(piecesAsMarkdown(pieces), '— `/r/a.xlsx#Summary!F5`\n\nOdd total\n\n> two\n> three\n\n— `/r/a.xlsx:2-3`\n\nThese two\n');
});

test('a tray piece is the exact bytes of the part and its lines', () => {
  const bytes = new TextEncoder().encode('# A\r\n\r\npara\r\nmore\r\n');
  const p = pieceOf('/r/a.md', bytes, 7, 17);
  assert.deepEqual(p, { path: '/r/a.md', first: 3, last: 4, text: 'para\r\nmore', note: '' });
});
