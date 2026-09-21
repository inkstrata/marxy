// Position and selection mapping across Rendered ↔ Source (§08, §09).

import { type Buffer, byteToUtf16, utf16ToByte } from '@marxy/core';
import { EditorView } from '@codemirror/view';

/** UTF-16 offset in the CM doc for a reading-position byte offset. */
export function renderedByteToCmPos(buffer: Buffer, byteOffset: number): number {
  return byteToUtf16(buffer, byteOffset);
}

/** Byte offset of the first visible line's start in Source → Rendered restore. */
export function sourceVisibleByteOffset(buffer: Buffer, view: EditorView): number {
  const line = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return utf16ToByte(buffer, line.from);
}

/** Scroll CodeMirror so `byteOffset` sits at `readingLinePx` from the viewport top. */
export function scrollSourceToByte(
  buffer: Buffer,
  view: EditorView,
  byteOffset: number,
  readingLinePx: number,
): void {
  const pos = renderedByteToCmPos(buffer, byteOffset);
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: readingLinePx }),
  });
}

/** Map a rendered node/section selection to a CM selection range (bytes → UTF-16). */
export function selectionToCmRange(
  buffer: Buffer,
  range: { start: number; end: number },
): { anchor: number; head: number } {
  return {
    anchor: byteToUtf16(buffer, range.start),
    head: byteToUtf16(buffer, range.end),
  };
}

/** Map CM selection anchors to byte offsets. */
export function cmSelectionToBytes(
  buffer: Buffer,
  anchor: number,
  head: number,
): { start: number; end: number } {
  const a = utf16ToByte(buffer, anchor);
  const h = utf16ToByte(buffer, head);
  return a <= h ? { start: a, end: h } : { start: h, end: a };
}

/** Best-effort rendered selection from a byte cursor when no node map is available. */
export function byteToRenderedSelection(_buffer: Buffer, _byte: number): { kind: 'none' } {
  return { kind: 'none' };
}
