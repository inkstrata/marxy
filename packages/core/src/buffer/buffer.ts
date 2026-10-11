// The document as bytes, and the only way those bytes change (ADR-0003, ADR-0004).
// Splice concatenates; nothing here re-serialises or normalises the file.

import type { Source } from '../contracts/ast.ts';
import { decodeWithOffsets, type ByteOffsets } from '../parse/byte-offsets.ts';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

const utf16Cache = new WeakMap<object, Uint32Array>();

/** A document's bytes and the tables derived from them. One buffer is one file (ADR-0003). */
export interface Buffer {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly bom: boolean;
  readonly eol: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';
  readonly version: number;
  readonly offsets: ByteOffsets;
}

/** Decode `bytes` as-is: no BOM strip, no line-ending conversion, no trailing newline. */
export function createBuffer(path: string, bytes: Uint8Array): Buffer {
  return makeBuffer(path, new Uint8Array(bytes), 0);
}

/** A view of `buffer.bytes` over `range`, not a copy. */
export function bytesOf(buffer: Buffer, range: Source): Uint8Array {
  return buffer.bytes.subarray(range.start, range.end);
}

/**
 * Decode the bytes in `range`. Throws if `start` or `end` is a UTF-8 continuation byte,
 * so a caller cannot cut a code point in half and write the fragments back.
 */
export function textOf(buffer: Buffer, range: Source): string {
  assertUtf8Boundary(buffer.bytes, range.start);
  assertUtf8Boundary(buffer.bytes, range.end);
  return decoder.decode(buffer.bytes.subarray(range.start, range.end));
}

/**
 * Replace `[range.start, range.end)` by concatenating. Pure: a new buffer, `version + 1`.
 * The only function that produces new document bytes.
 */
export function splice(
  buffer: Buffer,
  range: Source,
  replacement: string | Uint8Array,
): Buffer {
  validateSpliceRange(buffer.bytes, range);
  const encoded = typeof replacement === 'string' ? encoder.encode(replacement) : replacement;
  const { bytes } = buffer;
  const next = new Uint8Array(range.start + encoded.length + (bytes.length - range.end));
  next.set(bytes.subarray(0, range.start), 0);
  next.set(encoded, range.start);
  next.set(bytes.subarray(range.end), range.start + encoded.length);
  return makeBuffer(buffer.path, next, buffer.version + 1);
}

/**
 * Encode `text` using `like`'s line endings and BOM. Used when Source mode folds back
 * into the buffer — the file's convention, not the editor's, wins.
 */
export function fromText(path: string, text: string, like: Buffer): Buffer {
  const fold = foldText(like, text);
  if (fold === null) return makeBuffer(path, new Uint8Array(like.bytes), 0);
  const { range, replacement } = fold;
  const { bytes } = like;
  const next = new Uint8Array(range.start + replacement.length + (bytes.length - range.end));
  next.set(bytes.subarray(0, range.start), 0);
  next.set(replacement, range.start);
  next.set(bytes.subarray(range.end), range.start + replacement.length);
  return makeBuffer(path, next, 0);
}

/**
 * The one splice that turns `like` into the editor's `text` (which carries no BOM): the bytes from the first
 * change to the last, and every run of the file between two changes keeps its own bytes, copied and not decoded
 * and re-encoded. Everything before the first change and after the last keeps its bytes as it was too. So a
 * mixed-ending file keeps each line's ending and a byte that is not UTF-8 is not rewritten as U+FFFD, however
 * many changes the reader made and wherever they sit (F-34); an edit in Source touches only what the reader
 * changed. Inside a change, line endings follow the file (CRLF for a CRLF file). `null` when nothing differs.
 *
 * The range is one span, so the API and its callers are unchanged; its replacement is the changed runs'
 * encodings with the file's own bytes between them. However much differs, a U+FFFD that is still in the
 * editor's text is matched to one in the file, in order, and written as that one's original bytes (see
 * `anchorChanges`); no path writes EF BF BD for a byte the reader did not change.
 */
export function foldText(like: Buffer, text: string): { range: Source; replacement: Uint8Array } | null {
  const skip = like.bom ? 1 : 0;
  const old = like.text;
  const oldLength = old.length - skip;
  const limit = Math.min(oldLength, text.length);
  let prefix = 0;
  while (prefix < limit && old.charCodeAt(skip + prefix) === text.charCodeAt(prefix)) prefix++;
  if (prefix === oldLength && prefix === text.length) return null;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    old.charCodeAt(old.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Never cut a surrogate pair or a CRLF: the edit widens to take the whole of either.
  // The old text's pairs count too: an LF input against a CRLF buffer must not stop between the two.
  const cutsAt = (a: number, b: number): boolean => cuts(old, a) || cuts(text, b);
  while (prefix > 0 && cutsAt(skip + prefix, prefix)) prefix--;
  while (suffix > 0 && cutsAt(old.length - suffix, text.length - suffix)) suffix--;
  const oldFrom = skip + prefix;
  const oldTo = old.length - suffix;
  const newFrom = prefix;
  const newTo = text.length - suffix;
  // Every run of the middle that is the same on both sides re-encodes to the bytes it came from, except a
  // run holding a byte that is not UTF-8 (decoded as U+FFFD, written as EF BF BD). Only then is it worth
  // finding which runs are unchanged; with none, the middle is one change.
  let changes: Change[] | null = null;
  if (holdsStrayByte(like, oldFrom, oldTo)) {
    changes = widenChanges(alignChanges(old, oldFrom, oldTo, text, newFrom, newTo), old, text, oldFrom, newFrom);
  }
  if (changes === null || changes.length === 0) changes = [{ a0: oldFrom, a1: oldTo, b0: newFrom, b1: newTo }];
  const parts: Uint8Array[] = [];
  let length = 0;
  const push = (part: Uint8Array): void => {
    parts.push(part);
    length += part.length;
  };
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    if (i > 0) push(like.bytes.subarray(like.offsets.at(changes[i - 1]!.a1), like.offsets.at(change.a0)));
    const middle = text.slice(change.b0, change.b1);
    push(encoder.encode(like.eol === 'crlf' ? middle.replace(/\r\n|\n/g, '\r\n') : middle));
  }
  let replacement = parts[0]!;
  if (parts.length > 1) {
    replacement = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      replacement.set(part, at);
      at += part.length;
    }
  }
  return {
    range: { file: like.path, start: like.offsets.at(changes[0]!.a0), end: like.offsets.at(changes[changes.length - 1]!.a1) },
    replacement,
  };
}

/** One changed run: `old[a0, a1)` is `text[b0, b1)` now (UTF-16 offsets into `like.text` and the editor's text). */
interface Change {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** True when `at` sits between the two halves of a surrogate pair or of a CRLF in `s`. */
const cuts = (s: string, at: number): boolean =>
  at > 0 &&
  at < s.length &&
  ((isHigh(s.charCodeAt(at - 1)) && isLow(s.charCodeAt(at))) || (s.charCodeAt(at - 1) === 0x0d && s.charCodeAt(at) === 0x0a));

/** True when `like.text[from, to)` holds a U+FFFD that stands for bytes other than EF BF BD (a byte that is not UTF-8). */
function holdsStrayByte(like: Buffer, from: number, to: number): boolean {
  const { text, bytes, offsets } = like;
  let at = text.indexOf('\ufffd', from);
  while (at !== -1 && at < to) {
    const start = offsets.at(at);
    if (offsets.at(at + 1) - start !== 3 || bytes[start] !== 0xef || bytes[start + 1] !== 0xbf || bytes[start + 2] !== 0xbd) {
      return true;
    }
    at = text.indexOf('\ufffd', at + 1);
  }
  return false;
}

/** The most code units two texts may differ by before the character-level comparison gives up (memory ~ budget^2). */
const CHAR_BUDGET = 1500;
/** The same for the line-level comparison, and for the character-level one inside each changed block of lines. */
const LINE_BUDGET = 3000;
/** Characters of context either side of a U+FFFD that tell it from another when the texts are too different to compare. */
const ANCHOR_CONTEXT = 5;

/**
 * The runs of `old[a, a2)` that are not in `text[b, b2)`, as a minimal edit script: a character-level
 * comparison, then (if the texts differ in too many places for that) a comparison of lines and a character-level
 * one inside each changed block. A block too different for either is cut at its U+FFFDs (`anchorChanges`), so
 * there is no span that is re-encoded whole.
 */
function alignChanges(old: string, a: number, a2: number, text: string, b: number, b2: number): Change[] {
  const fine = diffSequences(codeUnits(old, a, a2), codeUnits(text, b, b2), CHAR_BUDGET);
  if (fine !== null) return fine.map((c) => ({ a0: c.a0 + a, a1: c.a1 + a, b0: c.b0 + b, b1: c.b1 + b }));
  const oldLines = lineStarts(old, a, a2);
  const newLines = lineStarts(text, b, b2);
  const ids = new Map<string, number>();
  const idsOf = (s: string, starts: number[], end: number): number[] =>
    starts.map((start, i) => {
      const line = s.slice(start, i + 1 < starts.length ? starts[i + 1]! : end);
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = ids.size));
      return id;
    });
  const lines = diffSequences(idsOf(old, oldLines, a2), idsOf(text, newLines, b2), LINE_BUDGET);
  if (lines === null) return anchorChanges(old, a, a2, text, b, b2);
  const out: Change[] = [];
  const at = (starts: number[], line: number, end: number): number => (line < starts.length ? starts[line]! : end);
  for (const block of lines) {
    const x0 = at(oldLines, block.a0, a2);
    const x1 = at(oldLines, block.a1, a2);
    const y0 = at(newLines, block.b0, b2);
    const y1 = at(newLines, block.b1, b2);
    const inner = diffSequences(codeUnits(old, x0, x1), codeUnits(text, y0, y1), LINE_BUDGET);
    if (inner === null) out.push(...anchorChanges(old, x0, x1, text, y0, y1));
    else for (const c of inner) out.push({ a0: c.a0 + x0, a1: c.a1 + x0, b0: c.b0 + y0, b1: c.b1 + y0 });
  }
  return out;
}

/**
 * For two stretches too different to compare: every U+FFFD of the editor's text is matched to one of the file's,
 * in order, and the runs between matched pairs are the changes. So a byte that is not UTF-8 and still in the
 * text keeps its bytes, however much was rewritten around it, and the only text that is re-encoded is a run
 * with no U+FFFD in it (the file's own side of every run has none: each one is a pair, or was deleted).
 * Which U+FFFDs pair is decided by their surroundings first (a shortest edit script over each one's few
 * characters either side), then, among those left between two pairs, by order. More in the text than in the
 * file means the reader wrote the extra ones, and they are encoded as U+FFFD is.
 */
function anchorChanges(old: string, a: number, a2: number, text: string, b: number, b2: number): Change[] {
  const marks = (s: string, from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = s.indexOf('\ufffd', from); i !== -1 && i < to; i = s.indexOf('\ufffd', i + 1)) out.push(i);
    return out;
  };
  const oldMarks = marks(old, a, a2);
  const newMarks = marks(text, b, b2);
  const ids = new Map<string, number>();
  const keyed = (s: string, at: number[], from: number, to: number): number[] =>
    at.map((i) => {
      const key = `${s.slice(Math.max(from, i - ANCHOR_CONTEXT), i)}\ufffd${s.slice(i + 1, Math.min(to, i + 1 + ANCHOR_CONTEXT))}`;
      let id = ids.get(key);
      if (id === undefined) ids.set(key, (id = ids.size));
      return id;
    });
  const pairs: Array<[number, number]> = [];
  const pairInOrder = (o0: number, o1: number, n0: number, n1: number): void => {
    for (let k = 0; k < Math.min(o1 - o0, n1 - n0); k++) pairs.push([oldMarks[o0 + k]!, newMarks[n0 + k]!]);
  };
  const surroundings = diffSequences(keyed(old, oldMarks, a, a2), keyed(text, newMarks, b, b2), LINE_BUDGET);
  if (surroundings === null) {
    pairInOrder(0, oldMarks.length, 0, newMarks.length);
  } else {
    // Whatever the script leaves out is matched; the runs it changes are paired in order.
    let o = 0;
    let n = 0;
    for (const c of [...surroundings, { a0: oldMarks.length, a1: oldMarks.length, b0: newMarks.length, b1: newMarks.length }]) {
      for (; o < c.a0; o++, n++) pairs.push([oldMarks[o]!, newMarks[n]!]);
      pairInOrder(c.a0, c.a1, c.b0, c.b1);
      o = c.a1;
      n = c.b1;
    }
  }
  const out: Change[] = [];
  let x = a;
  let y = b;
  for (const [i, j] of [...pairs, [a2, b2] as [number, number]]) {
    if (i > x || j > y) out.push({ a0: x, a1: i, b0: y, b1: j });
    x = i + 1;
    y = j + 1;
  }
  return out;
}

const codeUnits = (s: string, from: number, to: number): Uint16Array => {
  const out = new Uint16Array(to - from);
  for (let i = from; i < to; i++) out[i - from] = s.charCodeAt(i);
  return out;
};

/** Offsets at which each line of `s[from, to)` starts; a line keeps its `\n`. A CRLF is never split. */
function lineStarts(s: string, from: number, to: number): number[] {
  const starts = [from];
  for (let i = s.indexOf('\n', from); i !== -1 && i + 1 < to; i = s.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * Widen each change so none starts or ends between the two halves of a surrogate pair or of a CRLF (in either
 * text), then join changes that touch. The runs between changes are equal on both sides, so a change grows by the
 * same amount in `old` and in `text`.
 */
function widenChanges(changes: Change[], old: string, text: string, oldFloor: number, newFloor: number): Change[] {
  const out: Change[] = [];
  for (const change of changes) {
    const c = { ...change };
    while (c.a0 > oldFloor && c.b0 > newFloor && (cuts(old, c.a0) || cuts(text, c.b0))) {
      c.a0--;
      c.b0--;
    }
    while (c.a1 < old.length && c.b1 < text.length && (cuts(old, c.a1) || cuts(text, c.b1))) {
      c.a1++;
      c.b1++;
    }
    const last = out[out.length - 1];
    if (last !== undefined && c.a0 <= last.a1) {
      last.a1 = Math.max(last.a1, c.a1);
      last.b1 = Math.max(last.b1, c.b1);
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * Myers' O(ND) shortest edit script between two sequences: the runs of `a` and of `b` that are not common,
 * in order, as `[a0, a1)` replaced by `[b0, b1)`. `null` when they differ by more than `budget` elements.
 * Runs that are common to both stay out of every change, wherever they sit.
 */
function diffSequences(a: ArrayLike<number>, b: ArrayLike<number>, budget: number): Array<Change> | null {
  const n = a.length;
  const m = b.length;
  let lead = 0;
  while (lead < n && lead < m && a[lead] === b[lead]) lead++;
  let tail = 0;
  while (tail < n - lead && tail < m - lead && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const aEnd = n - tail;
  const bEnd = m - tail;
  if (lead === aEnd && lead === bEnd) return [];
  const width = Math.min(aEnd - lead + bEnd - lead, budget);
  const offset = width + 1;
  const v = new Int32Array(2 * width + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= width && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (lead + x < aEnd && lead + y < bEnd && a[lead + x] === b[lead + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (lead + x >= aEnd && lead + y >= bEnd) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  if (found < 0) return null;
  // Walk back from the end: each step is one inserted or deleted element, and the snake after it is common.
  const common: Array<[number, number, number]> = []; // [x, y, length] relative to `lead`
  let x = aEnd - lead;
  let y = bEnd - lead;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]!;
    const k = x - y;
    const at = (kk: number): number => prev[kk + (d - 1)]!;
    const fromAbove = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = fromAbove ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const midX = fromAbove ? prevX : prevX + 1;
    const midY = fromAbove ? prevY + 1 : prevY;
    if (x > midX) common.push([midX, midY, x - midX]);
    x = prevX;
    y = prevY;
  }
  if (x > 0) common.push([0, 0, x]);
  common.reverse();
  const changes: Change[] = [];
  let px = 0;
  let py = 0;
  const close = (qx: number, qy: number): void => {
    if (qx > px || qy > py) changes.push({ a0: lead + px, a1: lead + qx, b0: lead + py, b1: lead + qy });
  };
  for (const [cx, cy, length] of common) {
    close(cx, cy);
    px = cx + length;
    py = cy + length;
  }
  close(aEnd - lead, bEnd - lead);
  // The leading and trailing common runs trimmed above are matches too; the changes lie strictly between them.
  return changes;
}

const isHigh = (code: number): boolean => code >= 0xd800 && code < 0xdc00;
const isLow = (code: number): boolean => code >= 0xdc00 && code < 0xe000;

/** CodeMirror's UTF-16 offset for `byte`. ASCII is identity; otherwise a cached inverse table. */
export function byteToUtf16(buffer: Buffer, byte: number): number {
  const { text, offsets } = buffer;
  const clamped = byte < 0 ? 0 : byte > offsets.byteLength ? offsets.byteLength : byte;
  if (offsets.byteLength === text.length) return clamped;
  let inverse = utf16Cache.get(buffer);
  if (!inverse) {
    inverse = invertOffsets(text, offsets);
    utf16Cache.set(buffer, inverse);
  }
  return inverse[clamped]!;
}

/** Byte offset of UTF-16 code unit `cu`. The table from `byte-offsets.ts`, not a second scan. */
export function utf16ToByte(buffer: Buffer, cu: number): number {
  return buffer.offsets.at(cu);
}

/** FNV-1a 64 of `bytes` as 16 lowercase hex chars. Empty input is the offset basis. */
export function contentHash(bytes: Uint8Array): string {
  // The 64-bit state in four 16-bit limbs, so the loop does small-integer arithmetic and allocates
  // nothing (a BigInt per byte cost ~24 ms a megabyte). The prime is 2^40 + 0x1b3.
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i++) {
    h0 ^= bytes[i]!;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    // h << 40 lands h0 eight bits into the third limb and h1 eight bits into the fourth; h2 and h3
    // shift past bit 64 and drop.
    const t2 = h2 * 0x1b3 + (t1 >>> 16) + (h0 << 8);
    const t3 = h3 * 0x1b3 + (t2 >>> 16) + (h1 << 8);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, '0')).join('');
}

/**
 * Line ending to write. `crlf` → CRLF; `lf` and `none` → LF; `mixed` → the ending of
 * the line that contains `atByte`, or LF when `atByte` is omitted (fromText).
 */
export function eolString(buffer: Buffer, atByte?: number): '\n' | '\r\n' | '\r' {
  if (buffer.eol === 'crlf') return '\r\n';
  if (buffer.eol === 'cr') return '\r';
  if (buffer.eol === 'mixed' && atByte !== undefined) return endingAt(buffer.bytes, atByte);
  return '\n';
}

/** 1-based line number of `byte`. CRLF is one ending, not two. */
export function lineOf(buffer: Buffer, byte: number): number {
  const { bytes } = buffer;
  const limit = byte < 0 ? 0 : byte > bytes.length ? bytes.length : byte;
  let line = 1;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      i += 1;
      if (i < limit) line += 1;
    } else if (bytes[i] === 0x0a || bytes[i] === 0x0d) {
      line += 1;
    }
  }
  return line;
}

function makeBuffer(path: string, bytes: Uint8Array, version: number): Buffer {
  // Offsets from the bytes: a file that is not valid UTF-8 still maps every code unit to its own bytes.
  const { text, offsets } = decodeWithOffsets(bytes);
  return {
    path,
    bytes,
    text,
    bom: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    eol: detectEol(bytes),
    version,
    offsets,
  };
}

function detectEol(bytes: Uint8Array): Buffer['eol'] {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      crlf += 1;
      i += 1;
    } else if (bytes[i] === 0x0a) {
      lf += 1;
    } else if (bytes[i] === 0x0d) {
      cr += 1;
    }
  }
  if (crlf === 0 && lf === 0 && cr === 0) return 'none';
  if (crlf > 0 && lf === 0 && cr === 0) return 'crlf';
  if (lf > 0 && crlf === 0 && cr === 0) return 'lf';
  if (cr > 0 && crlf === 0 && lf === 0) return 'cr';
  return 'mixed';
}

function validateSpliceRange(bytes: Uint8Array, range: Source): void {
  if (range.start > range.end) {
    throw new RangeError(`splice range start ${range.start} is after end ${range.end}`);
  }
  if (range.start < 0 || range.end > bytes.length) {
    throw new RangeError(`splice range [${range.start}, ${range.end}) is outside 0..${bytes.length}`);
  }
  assertUtf8Boundary(bytes, range.start);
  assertUtf8Boundary(bytes, range.end);
}

function endingAt(bytes: Uint8Array, atByte: number): '\n' | '\r\n' {
  const start = atByte < 0 ? 0 : atByte > bytes.length ? bytes.length : atByte;
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return '\r\n';
    if (bytes[i] === 0x0a) return '\n';
  }
  return '\n';
}

function assertUtf8Boundary(bytes: Uint8Array, offset: number): void {
  if (offset < 0 || offset > bytes.length) {
    throw new RangeError(`byte offset ${offset} is outside 0..${bytes.length}`);
  }
  if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) {
    throw new RangeError(`byte offset ${offset} is a UTF-8 continuation byte`);
  }
}

function invertOffsets(text: string, offsets: ByteOffsets): Uint32Array {
  const inverse = new Uint32Array(offsets.byteLength + 1);
  for (let i = 0; i < text.length; i++) {
    const from = offsets.at(i);
    const to = offsets.at(i + 1);
    for (let b = from; b < to; b++) inverse[b] = i;
  }
  inverse[offsets.byteLength] = text.length;
  return inverse;
}
