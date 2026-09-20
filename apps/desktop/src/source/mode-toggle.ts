// Mode toggle without edits: unchanged bytes and reading position (§08, §09).

import { type Buffer, utf16ToByte } from '@marxy/core';
import { leaveSourceMode, cmDocText } from './buffer-commit.ts';
import { renderedByteToCmPos, sourceVisibleByteOffset } from './mode-switch.ts';
import type { EditorView } from '@codemirror/view';

export interface ModeRoundTripInput {
  readonly buffer: Buffer;
  readonly byteOffset: number;
  readonly docText: string;
  readonly view?: EditorView;
}

/** Rendered → Source → Rendered with no edits keeps bytes and the byte offset. */
export function modeRoundTripWithoutEdits(input: ModeRoundTripInput): {
  readonly buffer: Buffer;
  readonly byteOffset: number;
} {
  const left = leaveSourceMode(input.buffer, input.docText);
  if (left.changed) {
    throw new Error('mode round-trip expected unchanged buffer');
  }
  let byteOffset = input.byteOffset;
  if (input.view) {
    byteOffset = sourceVisibleByteOffset(input.buffer, input.view);
  }
  return { buffer: left.buffer, byteOffset };
}

/** UTF-16 round-trip identity at a byte offset (position mapping unit test). */
export function byteOffsetRoundTrip(buffer: Buffer, byteOffset: number): number {
  const cu = renderedByteToCmPos(buffer, byteOffset);
  return utf16ToByte(buffer, cu);
}

/** Doc text CM would show when entering Source. */
export function enteringSourceDoc(buffer: Buffer): string {
  return cmDocText(buffer);
}
