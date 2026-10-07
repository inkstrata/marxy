// Byte ↔ UTF-16 position mapping (§08 mode switch).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { utf16ToByte } from '../../../../packages/core/src/buffer/index.ts';
import { leaveSourceMode } from './buffer-commit.ts';
import { renderedByteToCmPos } from './mode-switch.ts';

// The two helpers live inline: harness-entry.ts touches `window` on load, so a Node test cannot import it.
function byteOffsetRoundTrip(buffer, byteOffset) {
  return utf16ToByte(buffer, renderedByteToCmPos(buffer, byteOffset));
}

function modeRoundTripWithoutEdits({ buffer, byteOffset, docText }) {
  const left = leaveSourceMode(buffer, docText);
  if (left.changed) throw new Error('mode round-trip expected unchanged buffer');
  return { buffer: left.buffer, byteOffset };
}

const root = new URL('../../../../', import.meta.url);

test('byteToUtf16 ∘ utf16ToByte is identity on corpus offsets', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/07-cjk.md', root));
  const buffer = createBuffer('/tmp/07-cjk.md', new Uint8Array(bytes));
  for (const byte of [0, 1, 40, 120, buffer.bytes.length - 1]) {
    assert.equal(byteOffsetRoundTrip(buffer, byte), byte, `byte ${byte}`);
  }
});

test('mode round-trip without edits preserves byteOffset', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/01-long-technical.md', root));
  const buffer = createBuffer('/tmp/01-long-technical.md', new Uint8Array(bytes));
  const byteOffset = 512;
  const doc = buffer.bom ? buffer.text.slice(1) : buffer.text;
  const out = modeRoundTripWithoutEdits({ buffer, byteOffset, docText: doc });
  assert.equal(out.byteOffset, byteOffset);
  assert.equal(out.buffer, buffer);
});

test('renderedByteToCmPos matches doc length for ASCII fixture', () => {
  const buffer = createBuffer('/tmp/x.rs', new TextEncoder().encode('fn main() {}\n'));
  assert.equal(renderedByteToCmPos(buffer, 3), 3);
});
