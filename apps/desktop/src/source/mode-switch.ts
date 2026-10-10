// Position and selection mapping across Rendered ↔ Source (§08, §09).

import { type Buffer, byteToUtf16, utf16ToByte } from '@marxy/core';
import { EditorView } from '@codemirror/view';
import { type CmStateLike, cmPosToUtf16, utf16ToCmPos } from './cm-position.ts';

/** The CodeMirror position for a reading-position byte offset. */
export function renderedByteToCmPos(buffer: Buffer, state: CmStateLike, byteOffset: number): number {
  return utf16ToCmPos(buffer, state, byteToUtf16(buffer, byteOffset));
}

/**
 * The reader's place in Source: the start of the line on the reading line, `readingLinePx` below the
 * top of the window, and how far down that line the reading line falls. In the app the window scrolls,
 * not CodeMirror's scroller (whose `scrollTop` stays 0), so the line is found from the document's
 * top in window coordinates, which follows either. `scrollSourceToByte` puts the byte back there.
 */
export function sourceReadingPosition(
  buffer: Buffer,
  view: EditorView,
  readingLinePx: number,
): { readonly byteOffset: number; readonly fraction: number } {
  const height = readingLinePx - view.documentTop;
  const line = view.lineBlockAtHeight(height);
  const fraction = line.height > 0 ? Math.min(1, Math.max(0, (height - line.top) / line.height)) : 0;
  return { byteOffset: utf16ToByte(buffer, cmPosToUtf16(buffer, view.state, line.from)), fraction };
}

/** Byte offset of the start of the first line in the window (the Source harness's round trip). */
export function sourceVisibleByteOffset(buffer: Buffer, view: EditorView): number {
  return sourceReadingPosition(buffer, view, 0).byteOffset;
}

/** Scroll CodeMirror so `byteOffset` sits at `readingLinePx` from the viewport top. */
export function scrollSourceToByte(
  buffer: Buffer,
  view: EditorView,
  byteOffset: number,
  readingLinePx: number,
): void {
  const pos = renderedByteToCmPos(buffer, view.state, byteOffset);
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: readingLinePx }),
  });
}

/** Map a rendered node/section selection to a CM selection range (bytes → UTF-16). */
export function selectionToCmRange(
  buffer: Buffer,
  state: CmStateLike,
  range: { start: number; end: number },
): { anchor: number; head: number } {
  return {
    anchor: renderedByteToCmPos(buffer, state, range.start),
    head: renderedByteToCmPos(buffer, state, range.end),
  };
}

/** Map CM selection anchors to byte offsets. */
export function cmSelectionToBytes(
  buffer: Buffer,
  state: CmStateLike,
  anchor: number,
  head: number,
): { start: number; end: number } {
  const a = utf16ToByte(buffer, cmPosToUtf16(buffer, state, anchor));
  const h = utf16ToByte(buffer, cmPosToUtf16(buffer, state, head));
  return a <= h ? { start: a, end: h } : { start: h, end: a };
}

/** Best-effort rendered selection from a byte cursor when no node map is available. */
export function byteToRenderedSelection(_buffer: Buffer, _byte: number): { kind: 'none' } {
  return { kind: 'none' };
}
