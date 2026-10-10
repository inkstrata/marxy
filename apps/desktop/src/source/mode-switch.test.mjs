// Byte ↔ UTF-16 position mapping (§08 mode switch).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { utf16ToByte } from '../../../../packages/core/src/buffer/index.ts';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from './buffer-commit.ts';
import { EditorState } from '@codemirror/state';
import { cmPosToUtf16, utf16ToCmPos } from './cm-position.ts';
import { renderedByteToCmPos, sourceReadingPosition } from './mode-switch.ts';

/** The editor state the app builds for `buffer`: its doc and line separator. */
function stateFor(buffer) {
  // The one separator rule the editor itself uses (F-25), not a copy of it.
  return EditorState.create({ doc: cmDocText(buffer), extensions: [EditorState.lineSeparator.of(lineSeparatorFor(buffer))] });
}

function byteOffsetRoundTrip(buffer, byteOffset) {
  return utf16ToByte(buffer, cmPosToUtf16(buffer, stateFor(buffer), renderedByteToCmPos(buffer, stateFor(buffer), byteOffset)));
}

const root = new URL('../../../../', import.meta.url);

test('byteToUtf16 ∘ utf16ToByte is identity on corpus offsets', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/07-cjk.md', root));
  const buffer = createBuffer('/tmp/07-cjk.md', new Uint8Array(bytes));
  for (const byte of [0, 1, 40, 120, buffer.bytes.length - 1]) {
    assert.equal(byteOffsetRoundTrip(buffer, byte), byte, `byte ${byte}`);
  }
});

test('leaving Source without an edit keeps the same buffer', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/01-long-technical.md', root));
  const buffer = createBuffer('/tmp/01-long-technical.md', new Uint8Array(bytes));
  const doc = buffer.bom ? buffer.text.slice(1) : buffer.text;
  const left = leaveSourceMode(buffer, doc);
  assert.equal(left.changed, false);
  assert.equal(left.buffer, buffer);
});

/** A view of `text` laid out in `lineHeight` px lines, its document top at `documentTop` in the window. */
function fakeView(text, lineHeight, documentTop, state) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    documentTop,
    state,
    lineBlockAtHeight(height) {
      const n = Math.max(0, Math.min(starts.length - 1, Math.floor(height / lineHeight)));
      return { from: starts[n], top: n * lineHeight, height: lineHeight };
    },
  };
}

test('the Source place is the line on the reading line, from where the window has scrolled (S-07-0003)', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/01-long-technical.md', root));
  const buffer = createBuffer('/tmp/01-long-technical.md', new Uint8Array(bytes));
  const text = buffer.bom ? buffer.text.slice(1) : buffer.text;
  const lines = text.split('\n');
  // Scrolled 1000 px: 320 px down the window is 1320 px into the document, line 66 at 20 px a line.
  const place = sourceReadingPosition(buffer, fakeView(text, 20, -1000, stateFor(buffer)), 320);
  const line66 = lines.slice(0, 66).reduce((n, l) => n + new TextEncoder().encode(l).length + 1, 0);
  assert.equal(place.byteOffset, line66);
  assert.equal(place.fraction, 0);
  // Ten pixels further: the same line, half way down it.
  assert.deepEqual(sourceReadingPosition(buffer, fakeView(text, 20, -1010, stateFor(buffer)), 320), { byteOffset: line66, fraction: 0.5 });
});

test('renderedByteToCmPos matches doc length for ASCII fixture', () => {
  const buffer = createBuffer('/tmp/x.rs', new TextEncoder().encode('fn main() {}\n'));
  assert.equal(renderedByteToCmPos(buffer, stateFor(buffer), 3), 3);
});

const enc = (text) => new TextEncoder().encode(text);

test('a CRLF file: a CodeMirror position is one short of the buffer offset per line break above it (F-23)', () => {
  const buffer = createBuffer('/tmp/x.ts', enc('ab\r\ncd\r\nef\r\n'));
  const state = stateFor(buffer);
  assert.equal(state.lineBreak, '\r\n');
  // 'e' is at buffer offset 8 and CodeMirror position 6.
  assert.equal(cmPosToUtf16(buffer, state, 6), 8);
  assert.equal(utf16ToCmPos(buffer, state, 8), 6);
  assert.equal(renderedByteToCmPos(buffer, state, 8), 6);
  for (let pos = 0; pos <= state.doc.length; pos++) {
    assert.equal(utf16ToCmPos(buffer, state, cmPosToUtf16(buffer, state, pos)), pos, `pos ${pos}`);
  }
  // Between the \r and the \n of a break is no position: it lands before the break.
  assert.equal(utf16ToCmPos(buffer, state, 3), 2);
});

test('a BOM: the editor doc leaves it out, the buffer counts it (F-23)', () => {
  const buffer = createBuffer('/tmp/x.ts', new Uint8Array([0xef, 0xbb, 0xbf, ...enc('ab\ncd\n')]));
  const state = stateFor(buffer);
  assert.equal(buffer.bom, true);
  assert.equal(cmPosToUtf16(buffer, state, 0), 1);
  assert.equal(utf16ToCmPos(buffer, state, 1), 0);
  assert.equal(utf16ToCmPos(buffer, state, 0), 0);
  assert.equal(utf16ToByte(buffer, cmPosToUtf16(buffer, state, 3)), 3 + 3);
  assert.equal(renderedByteToCmPos(buffer, state, 3 + 3), 3);
});

test('a CRLF file with a BOM: both offsets apply (F-23)', () => {
  const buffer = createBuffer('/tmp/x.ts', new Uint8Array([0xef, 0xbb, 0xbf, ...enc('ab\r\ncd\r\n')]));
  const state = stateFor(buffer);
  // 'c' is CodeMirror position 3, buffer offset 1 (BOM) + 4 ('ab\r\n') = 5.
  assert.equal(cmPosToUtf16(buffer, state, 3), 5);
  assert.equal(utf16ToCmPos(buffer, state, 5), 3);
});

test('an LF file is unchanged by the conversion (F-23)', () => {
  const buffer = createBuffer('/tmp/x.ts', enc('ab\ncd\né\n'));
  const state = stateFor(buffer);
  for (let pos = 0; pos <= state.doc.length; pos++) {
    assert.equal(cmPosToUtf16(buffer, state, pos), pos);
    assert.equal(utf16ToCmPos(buffer, state, pos), pos);
  }
});

test('a CR-only file: the shared separator rule splits on CR, and positions map as for CRLF (F-25)', () => {
  const buffer = createBuffer('/tmp/x.ts', enc('ab\rcd\ref\r'));
  assert.equal(lineSeparatorFor(buffer), '\r');
  const state = stateFor(buffer);
  assert.equal(state.lineBreak, '\r');
  assert.equal(state.doc.lines, 4);
  // CR is one character: positions equal buffer offsets.
  for (let pos = 0; pos <= state.doc.length; pos++) assert.equal(cmPosToUtf16(buffer, state, pos), pos);
  assert.equal(lineSeparatorFor(createBuffer('/tmp/x.ts', enc('a\r\nb\n'))), '\n', 'mixed keeps LF');
  assert.equal(lineSeparatorFor(createBuffer('/tmp/x.ts', enc('a\r\nb\r\n'))), '\r\n');
});
