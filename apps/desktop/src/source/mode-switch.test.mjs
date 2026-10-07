// Byte ↔ UTF-16 position mapping (§08 mode switch).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { utf16ToByte } from '../../../../packages/core/src/buffer/index.ts';
import { leaveSourceMode } from './buffer-commit.ts';
import { renderedByteToCmPos, sourceReadingPosition } from './mode-switch.ts';

function byteOffsetRoundTrip(buffer, byteOffset) {
  return utf16ToByte(buffer, renderedByteToCmPos(buffer, byteOffset));
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
function fakeView(text, lineHeight, documentTop) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    documentTop,
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
  const place = sourceReadingPosition(buffer, fakeView(text, 20, -1000), 320);
  const line66 = lines.slice(0, 66).reduce((n, l) => n + new TextEncoder().encode(l).length + 1, 0);
  assert.equal(place.byteOffset, line66);
  assert.equal(place.fraction, 0);
  // Ten pixels further: the same line, half way down it.
  assert.deepEqual(sourceReadingPosition(buffer, fakeView(text, 20, -1010), 320), { byteOffset: line66, fraction: 0.5 });
});

test('renderedByteToCmPos matches doc length for ASCII fixture', () => {
  const buffer = createBuffer('/tmp/x.rs', new TextEncoder().encode('fn main() {}\n'));
  assert.equal(renderedByteToCmPos(buffer, 3), 3);
});
