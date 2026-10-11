// The Source editor's text for a buffer, which holds every byte of the file (F-34.1, ADR-0069).
//
// `Buffer.text` is the reading decode: a byte that is not UTF-8 is U+FFFD (WHATWG), so every stray byte reads the
// same and text equality is not byte equality. The Source text is the same decode except there: each byte of an
// invalid sequence is the lone low surrogate U+DC00 + byte (U+DC80 to U+DCFF, PEP 383's "surrogateescape"), which
// valid UTF-8 can never produce. Encoding maps it back to its byte, so the text names the bytes exactly: an edit,
// a move or a copy of a stray byte inside the editor keeps its value, and a U+FFFD the file holds or the reader
// types stays EF BF BD. Only the Source editor holds this text: what leaves it (the clipboard, Copy as) goes
// through `readableText`, which shows each stray as U+FFFD, the way Rendered and the index read the file.

import type { Source } from '../contracts/ast.ts';
import type { ByteOffsets } from '../parse/byte-offsets.ts';
import { byteToUtf16, type Buffer } from './buffer.ts';

const encoder = new TextEncoder();

/** The code unit standing for stray byte `b` (0x80 to 0xFF) in the Source text is `STRAY_BASE + b`. */
export const STRAY_BASE = 0xdc00;

/** One lone surrogate of the escape range; a valid pair (an astral character) never matches (`u`). */
const STRAY = /[\uDC80-\uDCFF]/u;
const STRAYS = /[\uDC80-\uDCFF]/gu;
/** Any lone surrogate, high or low; a valid pair never matches. */
const LONE = /[\uD800-\uDFFF]/u;
const LONES = /[\uD800-\uDFFF]/gu;

/** The Source decode of a buffer: its text and where each code unit's bytes begin. */
export interface SourceText {
  /** The whole file, BOM included (as U+FEFF), with each stray byte as U+DC80 to U+DCFF. */
  readonly text: string;
  /** Byte offset of the code unit at an offset of `text`; defined for 0..length inclusive. */
  readonly offsets: ByteOffsets;
  /** True when `text` has as many code units as `buffer.text`, at the same bytes: offsets agree unit for unit. */
  readonly sameUnits: boolean;
}

const cache = new WeakMap<Buffer, SourceText>();

/** The Source text of `buffer` (cached per buffer). Valid UTF-8 is `buffer.text` itself, at no cost but one scan. */
export function sourceTextOf(buffer: Buffer): SourceText {
  let source = cache.get(buffer);
  if (!source) {
    source = decodeSource(buffer);
    cache.set(buffer, source);
  }
  return source;
}

/** The byte `code` stands for, when it is a stray byte's code unit; otherwise -1. */
export function strayByteOf(code: number): number {
  return code >= STRAY_BASE + 0x80 && code <= STRAY_BASE + 0xff ? code - STRAY_BASE : -1;
}

/** True when `text` holds a stray byte's code unit (a lone U+DC80 to U+DCFF). */
export function holdsStrayBytes(text: string): boolean {
  return STRAY.test(text);
}

/**
 * The bytes `text` (a Source text, or part of one) stands for: each stray byte's code unit is that byte, everything
 * else UTF-8 as `TextEncoder` writes it (so any other lone surrogate, which the editor never makes, is EF BF BD).
 */
export function encodeSourceText(text: string): Uint8Array {
  if (!STRAY.test(text)) return encoder.encode(text);
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  let from = 0;
  STRAYS.lastIndex = 0;
  for (let m = STRAYS.exec(text); m !== null; m = STRAYS.exec(text)) {
    if (m.index > from) n += encoder.encodeInto(text.slice(from, m.index), out.subarray(n)).written;
    out[n++] = text.charCodeAt(m.index) - STRAY_BASE;
    from = m.index + 1;
  }
  if (from < text.length) n += encoder.encodeInto(text.slice(from), out.subarray(n)).written;
  return out.slice(0, n);
}

/**
 * `text` as it may leave the Source editor (the clipboard, Copy as, a drag): every lone surrogate, a stray byte's
 * among them, becomes U+FFFD, as the reading decode shows it. Text with none is returned as it is.
 */
export function readableText(text: string): string {
  return LONE.test(text) ? text.replace(LONES, '\uFFFD') : text;
}

/** The offset in `buffer.text` of Source text offset `unit` (the same unless a stray sequence is several bytes). */
export function sourceToTextOffset(buffer: Buffer, unit: number): number {
  const source = sourceTextOf(buffer);
  if (source.sameUnits) return unit;
  // `buffer.text`'s unit holding the byte: one U+FFFD stands for all of a stray sequence's bytes.
  return byteToUtf16(buffer, source.offsets.at(unit));
}

/** The Source text offset of `buffer.text` offset `cu`. */
export function textToSourceOffset(buffer: Buffer, cu: number): number {
  const source = sourceTextOf(buffer);
  if (source.sameUnits) return cu;
  const runs = runsCache.get(source)!;
  const clamped = cu < 0 ? 0 : cu > buffer.text.length ? buffer.text.length : cu;
  // The runs of several bytes at or before `cu` each add their length less one.
  const k = lastAtOrBefore(runs.textAt, clamped);
  return clamped + (k < 0 ? 0 : runs.extraThrough[k]! - (runs.textAt[k] === clamped ? runs.bytes[k]! - 1 : 0));
}

/**
 * The offset in the Source text of `buffer` at which byte `byte` begins, or -1 when it is inside a character (so no
 * code unit begins there). Where several units share one byte offset (the low half of a surrogate pair sits at the
 * pair's end), the last: the offset after the pair, never between its halves.
 */
export function byteToSourceOffset(buffer: Buffer, byte: number): number {
  const { text, offsets } = sourceTextOf(buffer);
  const target = byte < 0 ? 0 : byte > offsets.byteLength ? offsets.byteLength : byte;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets.at(mid) <= target) lo = mid;
    else hi = mid - 1;
  }
  return offsets.at(lo) === target ? lo : -1;
}

/**
 * The Source text of the bytes in `range` (a block, a line): the part of `sourceTextOf(buffer).text` they decode to, in
 * which each stray byte is its own code unit. Throws, as `textOf` does, when an end of the range is inside a character.
 */
export function sourceTextOfRange(buffer: Buffer, range: Source): string {
  const from = byteToSourceOffset(buffer, range.start);
  const to = byteToSourceOffset(buffer, range.end);
  if (from < 0 || to < 0) throw new RangeError(`byte offset ${from < 0 ? range.start : range.end} is a UTF-8 continuation byte`);
  return sourceTextOf(buffer).text.slice(from, to);
}

/**
 * The stray sequences of more than one byte, in order: where each is in `buffer.text` (one unit), in the Source
 * text (one unit per byte), its first byte and its length, and the units the Source text has gained up to and
 * including it. Enough to map either way by binary search, without a table the size of the file.
 */
interface Runs {
  readonly textAt: Uint32Array;
  readonly sourceAt: Uint32Array;
  readonly byteAt: Uint32Array;
  readonly bytes: Uint32Array;
  readonly extraThrough: Uint32Array;
}

const runsCache = new WeakMap<SourceText, Runs>();

/** The last index `k` with `xs[k] <= x`, or -1. */
function lastAtOrBefore(xs: Uint32Array, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** True when bytes [from, to) are EF BF BD: a U+FFFD the file holds, not a stray byte's replacement. */
const isReplacementChar = (bytes: Uint8Array, from: number, to: number): boolean =>
  to - from === 3 && bytes[from] === 0xef && bytes[from + 1] === 0xbf && bytes[from + 2] === 0xbd;

/**
 * Built from `buffer.text` and its offsets: a stray sequence is one U+FFFD there that does not span EF BF BD, and
 * becomes one code unit per byte. Valid UTF-8 has no such U+FFFD, so it costs one `indexOf`.
 */
function decodeSource(buffer: Buffer): SourceText {
  const { text, offsets, bytes } = buffer;
  // Units of `buffer.text` that stand for stray bytes; those that stand for more than one byte.
  const strays: number[] = [];
  const multi: number[] = [];
  for (let at = text.indexOf('\uFFFD'); at >= 0; at = text.indexOf('\uFFFD', at + 1)) {
    const from = offsets.at(at);
    const to = offsets.at(at + 1);
    if (isReplacementChar(bytes, from, to)) continue;
    strays.push(at);
    if (to - from !== 1) multi.push(at);
  }
  if (strays.length === 0) return { text, offsets, sameUnits: true };
  const parts: string[] = [];
  let copied = 0;
  for (const at of strays) {
    parts.push(text.slice(copied, at));
    const from = offsets.at(at);
    const to = offsets.at(at + 1);
    parts.push(to - from === 1 ? String.fromCharCode(STRAY_BASE + bytes[from]!) : String.fromCharCode(...Array.from(bytes.subarray(from, to), (b) => STRAY_BASE + b)));
    copied = at + 1;
  }
  parts.push(text.slice(copied));
  const out = parts.join('');
  if (multi.length === 0) return { text: out, offsets, sameUnits: true };
  // A stray sequence of several bytes is several units here and one in `buffer.text`.
  const n = multi.length;
  const runs: Runs = {
    textAt: new Uint32Array(n),
    sourceAt: new Uint32Array(n),
    byteAt: new Uint32Array(n),
    bytes: new Uint32Array(n),
    extraThrough: new Uint32Array(n),
  };
  let extra = 0;
  for (let k = 0; k < n; k++) {
    const at = multi[k]!;
    const from = offsets.at(at);
    const length = offsets.at(at + 1) - from;
    runs.textAt[k] = at;
    runs.sourceAt[k] = at + extra;
    runs.byteAt[k] = from;
    runs.bytes[k] = length;
    extra += length - 1;
    runs.extraThrough[k] = extra;
  }
  const length = out.length;
  const source: SourceText = {
    text: out,
    offsets: {
      at: (offset: number) => {
        const unit = offset < 0 ? 0 : offset > length ? length : offset;
        const k = lastAtOrBefore(runs.sourceAt, unit);
        if (k < 0) return offsets.at(unit);
        const into = unit - runs.sourceAt[k]!;
        if (into < runs.bytes[k]!) return runs.byteAt[k]! + into;
        return offsets.at(unit - runs.extraThrough[k]!);
      },
      byteLength: offsets.byteLength,
    },
    sameUnits: false,
  };
  runsCache.set(source, runs);
  return source;
}
