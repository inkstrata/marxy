// Position and selection mapping across Rendered ↔ Source.

import { type Buffer, byteToUtf16, utf16ToByte } from '@marxy/core';
import { EditorView } from '@codemirror/view';
import { type CmStateLike, cmPosToUtf16, utf16ToCmPos } from './cm-position.ts';

/** The CodeMirror position for a reading-position byte offset. */
export function renderedByteToCmPos(buffer: Buffer, state: CmStateLike, byteOffset: number): number {
  return utf16ToCmPos(buffer, state, byteToUtf16(buffer, byteOffset));
}

/**
 * The reader's place in Source: the start of the line on the reading line, `readingLinePx` below the
 * top of the window, and how far down that line the reading line falls. In the frame CodeMirror's own
 * scroller moves (frame.css fixes the mount under the head); elsewhere the window may. The line is found
 * from the document's top in window coordinates, which follows either. `scrollSourceToByte` puts the
 * byte back there.
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

/**
 * Scroll CodeMirror so `byteOffset` sits at `readingLinePx` from the viewport top. The reading line is a place in the
 * window; the editor's scroller may start below the window's top (the Source frame's bars sit above it), and
 * CodeMirror measures its margin from the scroller's own top, so the scroller's offset comes off the margin.
 */
export function scrollSourceToByte(
  buffer: Buffer,
  view: EditorView,
  byteOffset: number,
  readingLinePx: number,
): void {
  const pos = renderedByteToCmPos(buffer, view.state, byteOffset);
  // Only when the editor's own scroller is what scrolls: one that has nothing to scroll leaves it to an ancestor (a page
  // that does not give the mount a height), and CodeMirror then measures the margin from that ancestor's top.
  const scroller = view.scrollDOM;
  const scrollerTop = scroller.scrollHeight > scroller.clientHeight + 1 ? Math.max(0, scroller.getBoundingClientRect().top) : 0;
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: Math.max(0, readingLinePx - scrollerTop) }),
  });
}
