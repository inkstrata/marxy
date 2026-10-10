// CodeMirror positions against a buffer's UTF-16 offsets (F-23).
//
// A CodeMirror position counts every line break as one unit, and the editor's document leaves the BOM
// out; a buffer offset counts the BOM and both characters of a `\r\n`. Anywhere one meets the other it
// goes through this pair, so a CRLF file or one with a BOM does not drift a position per line above it.

import type { Buffer } from '@marxy/core';

/** The part of an `EditorState` the conversion reads, so a test can stand one in. */
export interface CmStateLike {
  readonly doc: {
    readonly length: number;
    readonly lines: number;
    lineAt(pos: number): { readonly number: number; readonly from: number; readonly to: number };
    line(n: number): { readonly from: number; readonly to: number };
  };
  /** The state's line separator (`state.lineBreak`): `\r\n` for a pure-CRLF file, else `\n`. */
  readonly lineBreak: string;
}

const bomLength = (buffer: Buffer): number => (buffer.bom ? 1 : 0);

/** The buffer's UTF-16 offset of a CodeMirror position. */
export function cmPosToUtf16(buffer: Buffer, state: CmStateLike, pos: number): number {
  const p = Math.max(0, Math.min(pos, state.doc.length));
  const extra = state.lineBreak.length - 1;
  const lines = extra > 0 ? (state.doc.lineAt(p).number - 1) * extra : 0;
  return p + lines + bomLength(buffer);
}

/** The CodeMirror position of a buffer UTF-16 offset (an offset inside a `\r\n` lands before it). */
export function utf16ToCmPos(buffer: Buffer, state: CmStateLike, offset: number): number {
  const off = Math.max(0, offset - bomLength(buffer));
  const extra = state.lineBreak.length - 1;
  if (extra <= 0) return Math.min(off, state.doc.length);
  // The last line whose start, counted in buffer offsets, is at or before `off`.
  let lo = 1;
  let hi = state.doc.lines;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (state.doc.line(mid).from + (mid - 1) * extra <= off) lo = mid;
    else hi = mid - 1;
  }
  const line = state.doc.line(lo);
  return Math.min(off - (lo - 1) * extra, line.to);
}
