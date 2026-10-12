// The byte offset of the caret after edits (V-05): always the offset a full encode gives, and a key press at the caret
// costs the size of the change and of the caret's move, not the length of the text before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { encodeSourceText } from '../../../../packages/core/src/buffer/source-text.ts';
import { ByteCursor } from './frame-bytes.ts';

const exact = (state, pos, bom) => encodeSourceText(state.sliceDoc(0, pos)).length + bom;

/** A small deterministic generator. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const PIECES = ['a', 'é', '€', '😀', '\n', '\udc9f', '​', 'xyz', '\t'];

for (const [name, bom, sep] of [['LF', 0, '\n'], ['CRLF', 0, '\r\n'], ['a BOM', 3, '\n']]) {
  test(`${name}: after any run of edits and moves the offset is the one a full encode gives`, () => {
    const random = rng(7 + bom);
    let state = EditorState.create({ doc: 'start é\n😀 line two\n\udc9f end', extensions: [EditorState.lineSeparator.of(sep)] });
    const cursor = new ByteCursor(bom);
    for (let i = 0; i < 400; i++) {
      const len = state.doc.length;
      const at = Math.floor(random() * (len + 1));
      const to = Math.min(len, at + Math.floor(random() * 4));
      // A change never splits a surrogate pair.
      const safe = (p) => (p > 0 && p < len && /[\udc00-\udfff]/.test(state.sliceDoc(p, p + 1)) && /[\ud800-\udbff]/.test(state.sliceDoc(p - 1, p)) ? p - 1 : p);
      const from = safe(at);
      const end = safe(to);
      const insert = PIECES[Math.floor(random() * PIECES.length)];
      if (random() < 0.8) {
        const q = Math.floor(random() * (state.doc.length + 1));
        assert.equal(cursor.offsetAt(state, safe(q)), exact(state, safe(q), bom), `a move to ${q}`);
      }
      const tr = state.update({ changes: { from, to: end, insert: random() < 0.3 ? '' : insert } });
      cursor.map(tr.changes, state);
      state = tr.state;
      const p = safe(Math.floor(random() * (state.doc.length + 1)));
      assert.equal(cursor.offsetAt(state, p), exact(state, p, bom), `after change ${i}, at ${p}`);
    }
  });
}

test('typing at the end of a large text costs the key press, not the text before it', () => {
  const big = 'x'.repeat(1_000_000);
  let state = EditorState.create({ doc: big });
  const cursor = new ByteCursor(0);
  assert.equal(cursor.offsetAt(state, state.doc.length), 1_000_000);
  const first = cursor.encoded;
  for (let i = 0; i < 200; i++) {
    const tr = state.update({ changes: { from: state.doc.length, insert: i % 2 ? 'é' : 'a' } });
    cursor.map(tr.changes, state);
    state = tr.state;
    cursor.offsetAt(state, state.doc.length);
  }
  assert.equal(cursor.offsetAt(state, state.doc.length), 1_000_000 + 100 * 2 + 100);
  assert.ok(cursor.encoded - first < 2000, `200 key presses encoded ${cursor.encoded - first} code units (the first question ${first})`);
});

test('typing in the middle, before the answer, moves it by the change and does not recount', () => {
  let state = EditorState.create({ doc: 'y'.repeat(500_000) });
  const cursor = new ByteCursor(0);
  cursor.offsetAt(state, 400_000);
  const first = cursor.encoded;
  for (let i = 0; i < 100; i++) {
    const tr = state.update({ changes: { from: 1000, insert: '€' } });
    cursor.map(tr.changes, state);
    state = tr.state;
    assert.equal(cursor.offsetAt(state, 400_000 + i + 1), 400_000 + i + 1 + 2 * (i + 1));
  }
  assert.ok(cursor.encoded - first < 1000);
});

test('a change that spans the last answer drops it, and the count starts again from the top', () => {
  let state = EditorState.create({ doc: 'abcdefghij' });
  const cursor = new ByteCursor(3);
  cursor.offsetAt(state, 5);
  const tr = state.update({ changes: { from: 2, to: 8, insert: '€€' } });
  cursor.map(tr.changes, state);
  state = tr.state;
  assert.equal(cursor.offsetAt(state, 4), exact(state, 4, 3));
});
