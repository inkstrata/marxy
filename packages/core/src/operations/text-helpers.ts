// Two small helpers every operation that emits newlines or reads a fence needs, once (E-01).
// Pure: no DOM, no Node built-ins. Not exported from the package index; operations import it directly.
import type { Source } from '../contracts/ast.ts';

/**
 * The line ending of `text`: `'\r\n'` if its first line ending is CRLF, else `'\n'` (also when `text` has
 * no line ending at all). An operation that emits a line break uses this, never a literal `'\n'`, because
 * `splice` converts nothing. A lone-CR file reads as `'\n'` here: the helper answers for CRLF versus LF,
 * the two endings an operation can be handed inside one block.
 */
export function eolOf(text: string): '\r\n' | '\n' {
  const lf = text.indexOf('\n');
  return lf > 0 && text.charCodeAt(lf - 1) === 0x0d ? '\r\n' : '\n';
}

export interface TextIndex {
  /** UTF-16 index of the character that starts `byte` bytes into the text; `RangeError` inside a character or out of range. */
  toIndex(byte: number): number;
  /** UTF-8 byte offset of UTF-16 `index`; `RangeError` if it is out of range or splits a surrogate pair. */
  toByte(index: number): number;
}

/** UTF-8 byte offset to UTF-16 index and back, from a single scan of `text`. */
export function textIndex(text: string): TextIndex {
  const byteAt = new Int32Array(text.length + 1).fill(-1);
  const indexAt: number[] = [0];
  let bytes = 0;
  let i = 0;
  byteAt[0] = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const units = cp > 0xffff ? 2 : 1;
    const width = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    for (let k = 1; k < width; k++) indexAt.push(-1);
    i += units;
    bytes += width;
    indexAt.push(i);
    byteAt[i] = bytes;
  }
  return {
    toIndex(byte: number): number {
      const at = Number.isInteger(byte) && byte >= 0 && byte < indexAt.length ? indexAt[byte]! : -1;
      if (at < 0) throw new RangeError(`byte offset ${byte} is not on a character boundary or is past the end`);
      return at;
    },
    toByte(index: number): number {
      const at = Number.isInteger(index) && index >= 0 && index <= text.length ? byteAt[index]! : -1;
      if (at < 0) throw new RangeError(`string index ${index} is out of range or splits a surrogate pair`);
      return at;
    },
  };
}

/**
 * The text of the absolute byte range `abs`, which must lie inside `input.range`. `input.text` holds the
 * bytes of `input.range`, so this is how an operation reads a `codeBlock.content`, which is a byte range
 * and not a string range.
 */
export function sliceByBytes(input: { readonly range: Source; readonly text: string }, abs: Source): string {
  if (abs.start < input.range.start || abs.end > input.range.end || abs.start > abs.end) {
    throw new RangeError(`bytes ${abs.start}..${abs.end} lie outside ${input.range.start}..${input.range.end}`);
  }
  const index = textIndex(input.text);
  return input.text.slice(index.toIndex(abs.start - input.range.start), index.toIndex(abs.end - input.range.start));
}

/** Apply non-overlapping UTF-16 edits to `text`, back to front so earlier offsets stay valid. */
export function replaceSpans(text: string, edits: readonly { start: number; end: number; text: string }[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.start < 0 || e.end < e.start || e.end > text.length) throw new RangeError(`edit ${e.start}..${e.end} is out of range`);
    if (i > 0 && e.start < sorted[i - 1]!.end) throw new RangeError(`edits overlap at ${e.start}`);
  }
  let out = text;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]!;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
