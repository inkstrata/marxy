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
 * mixed-ending file keeps each line's ending and a byte that is not UTF-8 in a line the reader did not touch is not
 * rewritten as U+FFFD, however many changes the reader made and wherever they sit (F-34); an edit in Source touches
 * only what the reader changed. Inside a change, line endings follow the file (CRLF for a CRLF file). `null` when
 * nothing differs.
 *
 * The range is one span, so the API and its callers are unchanged; its replacement is the changed runs'
 * encodings with the file's own bytes between them. A run is left to the file's bytes only when it is provably
 * the same text at the same place (see `alignChanges`); a U+FFFD in any other run is written as U+FFFD is (EF BF BD),
 * and no path writes another byte's value in its place. (A byte in a line the reader edited or moved is therefore
 * lost to U+FFFD, as it always was; keeping it is F-34.1.)
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
  let oldFrom = skip + prefix;
  let oldTo = old.length - suffix;
  let newFrom = prefix;
  let newTo = text.length - suffix;
  // Every run of the middle that is the same on both sides re-encodes to the bytes it came from, except a
  // run holding a byte that is not UTF-8 (decoded as U+FFFD, written as EF BF BD). Only then is it worth
  // finding which runs are unchanged; with none, the middle is one change.
  let changes: Change[] | null = null;
  if (old.includes('\ufffd')) {
    // A line of the file whose text is also another line's, with different bytes, is not "the same line" just
    // because it is outside the change: the span grows to take in every such line.
    const ambiguous = ambiguousLines(like);
    if (ambiguous.size > 0) {
      const lineAt = (k: number): [number, number] => {
        const nl = old.indexOf('\n', k);
        return [Math.max(skip, old.lastIndexOf('\n', k) + 1), nl === -1 ? old.length : nl + 1];
      };
      for (let k = old.indexOf('\ufffd', skip); k !== -1 && k < oldFrom; k = old.indexOf('\ufffd', k + 1)) {
        const [from, to] = lineAt(k);
        if (ambiguous.has(old.slice(from, to))) {
          newFrom -= oldFrom - from;
          oldFrom = from;
          break;
        }
      }
      for (let k = old.lastIndexOf('\ufffd'); k >= oldTo; k = k === 0 ? -1 : old.lastIndexOf('\ufffd', k - 1)) {
        const [from, to] = lineAt(k);
        if (ambiguous.has(old.slice(from, to))) {
          newTo += to - oldTo;
          oldTo = to;
          break;
        }
      }
    }
  }
  if (holdsStrayByte(like, oldFrom, oldTo)) {
    // Compare whole lines: the unchanged text just before the first change and just after the last is the same
    // on both sides, so the span grows by the same amount in each.
    const back = newFrom === 0 ? 0 : newFrom - (text.lastIndexOf('\n', newFrom - 1) + 1);
    const nl = text.indexOf('\n', newTo);
    const forward = (nl === -1 ? text.length : nl + 1) - newTo;
    const from = oldFrom - back;
    changes = widenChanges(alignChanges(like, from, oldTo + forward, text, newFrom - back, newTo + forward), old, text, from, newFrom - back);
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

/**
 * The changed runs between `like.text[a, a2)` and `text[b, b2)`, which both start and end on a line. Everything
 * outside them is copied from the file's own bytes, so a run is left out of the changes (is "equal") only when it
 * is the same text at the same place, and, if it holds a U+FFFD, only when copying cannot write another byte's
 * value there:
 *
 *  - Lines first (patience: lines that occur once on each side anchor, the longest increasing run of them is kept,
 *    and what lies between is compared again). A line that moved is not in that run, so it is a deletion and an
 *    insertion. A line with a U+FFFD is equal only if every line of the file with that text has the same bytes
 *    (otherwise the text cannot say which one this is).
 *  - What lines leave changed is a hunk. Its lines are paired one for one if both sides have as many; in each pair
 *    (or in the whole hunk, if they do not pair) the common start and end stay equal and the change between them is
 *    encoded, if no U+FFFD is in that change; otherwise the whole pair is encoded.
 *
 * So the one thing a Source fold still does to a byte that is not UTF-8 is write it as U+FFFD is (EF BF BD) when it
 * is in a line the reader edited or moved and the text cannot show it is the same byte: as before F-34, but only there.
 */
function alignChanges(like: Buffer, a: number, a2: number, text: string, b: number, b2: number): Change[] {
  const old = like.text;
  const oldLines = lineStarts(old, a, a2);
  const newLines = lineStarts(text, b, b2);
  const ids = new Map<string, number>();
  const idsOf = (s: string, starts: number[], end: number): number[] =>
    starts.map((start, i) => {
      // In a CRLF file the editor may hand over LF: the ending is the file's, so a line is the same either way.
      const raw = s.slice(start, i + 1 < starts.length ? starts[i + 1]! : end);
      const line = like.eol === 'crlf' ? raw.replace(/\r\n$/, '\n') : raw;
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = ids.size));
      return id;
    });
  const oldIds = idsOf(old, oldLines, a2);
  const newIds = idsOf(text, newLines, b2);
  const edge = (starts: number[], line: number, end: number): number => (line < starts.length ? starts[line]! : end);
  const heavyIds: boolean[] = [];
  for (const [line, id] of ids) heavyIds[id] = line.includes('\ufffd');
  const ambiguous = ambiguousLines(like);
  const matched = matchLines(oldIds, newIds, heavyIds).filter(([i]) => {
    const from = oldLines[i]!;
    const to = edge(oldLines, i + 1, a2);
    const at = old.indexOf('\ufffd', from);
    return at === -1 || at >= to || !ambiguous.has(old.slice(from, to));
  });
  const out: Change[] = [];
  const hunk = (i0: number, i1: number, j0: number, j1: number): void => {
    if (i0 === i1 && j0 === j1) return;
    const x0 = edge(oldLines, i0, a2);
    const x1 = edge(oldLines, i1, a2);
    const y0 = edge(newLines, j0, b2);
    const y1 = edge(newLines, j1, b2);
    out.push(...compareHunk(like, x0, x1, text, y0, y1, ambiguous));
  };
  let i = 0;
  let j = 0;
  for (const [mi, mj] of matched) {
    hunk(i, mi, j, mj);
    i = mi + 1;
    j = mj + 1;
  }
  hunk(i, oldLines.length, j, newLines.length);
  return out;
}

/**
 * The changed runs of one hunk that lines left changed: what the hunk's two sides share at either end stays equal, and
 * the one change between is encoded. If a U+FFFD is in that change, on either side, the text cannot say which of them
 * is which, so nothing of the hunk keeps the file's bytes for it: the hunk is one change, whole.
 */
function compareHunk(like: Buffer, x0: number, x1: number, text: string, y0: number, y1: number, ambiguous: Set<string>): Change[] {
  // The same number of lines on both sides: line for line, so an edit in one line does not cost the next its bytes.
  const xs = x1 > x0 ? lineStarts(like.text, x0, x1) : [];
  const ys = y1 > y0 ? lineStarts(text, y0, y1) : [];
  if (xs.length !== ys.length || xs.length < 2) return compareLines(like, x0, x1, text, y0, y1, ambiguous);
  const out: Change[] = [];
  for (let k = 0; k < xs.length; k++) {
    const e = (starts: number[], end: number): number => (k + 1 < starts.length ? starts[k + 1]! : end);
    out.push(...compareLines(like, xs[k]!, e(xs, x1), text, ys[k]!, e(ys, y1), ambiguous));
  }
  return out;
}

function compareLines(like: Buffer, x0: number, x1: number, text: string, y0: number, y1: number, ambiguous: Set<string>): Change[] {
  const whole: Change[] = [{ a0: x0, a1: x1, b0: y0, b1: y1 }];
  const old = like.text;
  if (x1 === x0 || y1 === y0 || (!hasStray(old, x0, x1) && !hasStray(text, y0, y1))) return whole;
  // A line the text cannot tell from another with different bytes is re-encoded, even if it reads the same here.
  for (let k = old.indexOf('\ufffd', x0); k !== -1 && k < x1; k = old.indexOf('\ufffd', k + 1)) {
    const nl = old.indexOf('\n', k);
    if (ambiguous.has(old.slice(Math.max(x0, old.lastIndexOf('\n', k) + 1), nl === -1 ? old.length : nl + 1))) return whole;
  }
  const limit = Math.min(x1 - x0, y1 - y0);
  let lead = 0;
  while (lead < limit && old.charCodeAt(x0 + lead) === text.charCodeAt(y0 + lead)) lead++;
  let tail = 0;
  while (tail < limit - lead && old.charCodeAt(x1 - 1 - tail) === text.charCodeAt(y1 - 1 - tail)) tail++;
  const change = { a0: x0 + lead, a1: x1 - tail, b0: y0 + lead, b1: y1 - tail };
  return hasStray(old, change.a0, change.a1) || hasStray(text, change.b0, change.b1) ? whole : [change];
}

const hasStray = (s: string, from: number, to: number): boolean => {
  const at = s.indexOf('\ufffd', from);
  return at !== -1 && at < to;
};

const ambiguousCache = new WeakMap<object, Set<string>>();

/**
 * The texts of the file's lines that hold a U+FFFD and occur with different bytes (`caf\ufffd` as E9 in one place and
 * E8 in another): the editor's text cannot say which of them a line of it is, so none is taken as unchanged.
 */
function ambiguousLines(like: Buffer): Set<string> {
  let found = ambiguousCache.get(like);
  if (found) return found;
  found = new Set<string>();
  const seen = new Map<string, string>();
  const { text } = like;
  let doneTo = 0;
  for (let k = text.indexOf('\ufffd'); k !== -1; k = text.indexOf('\ufffd', Math.max(k + 1, doneTo))) {
    const from = Math.max(like.bom ? 1 : 0, text.lastIndexOf('\n', k) + 1);
    const nl = text.indexOf('\n', k);
    const to = nl === -1 ? text.length : nl + 1;
    doneTo = to;
    const line = text.slice(from, to);
    const key = bytesKey(like, from, to);
    const before = seen.get(line);
    if (before === undefined) seen.set(line, key);
    else if (before !== key) found.add(line);
  }
  ambiguousCache.set(like, found);
  return found;
}

/** The bytes of `like.text[from, to)` as a string, to compare two stretches of the file. */
const bytesKey = (like: Buffer, from: number, to: number): string => {
  let key = '';
  const start = like.offsets.at(from);
  const end = like.offsets.at(to);
  for (let k = start; k < end; k += 8192) key += String.fromCharCode(...like.bytes.subarray(k, Math.min(end, k + 8192)));
  return key;
};

/**
 * Pairs `[i, j]` of equal lines (`a[i] === b[j]`) increasing in both, by patience: trim what the two share at either
 * end, anchor on the lines that occur once on each side (the longest increasing run of them), and do the same
 * between the anchors. A region with no line in common once on each side, and none at its ends, pairs nothing.
 */
function matchLines(a: number[], b: number[], weightOf: boolean[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const regions: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (regions.length > 0) {
    let [i0, i1, j0, j1] = regions.pop()!;
    while (i0 < i1 && j0 < j1 && a[i0] === b[j0]) pairs.push([i0++, j0++]);
    while (i0 < i1 && j0 < j1 && a[i1 - 1] === b[j1 - 1]) pairs.push([--i1, --j1]);
    if (i0 === i1 || j0 === j1) continue;
    const inOld = new Map<number, number>(); // id -> index, or -1 when it occurs more than once
    for (let i = i0; i < i1; i++) inOld.set(a[i]!, inOld.has(a[i]!) ? -1 : i);
    const inNew = new Map<number, number>();
    for (let j = j0; j < j1; j++) inNew.set(b[j]!, inNew.has(b[j]!) ? -1 : j);
    // Candidates in the old order, with their new index; the longest strictly increasing run of the new index.
    const cand: Array<[number, number]> = [];
    for (let i = i0; i < i1; i++) {
      const j = inNew.get(a[i]!);
      if (j !== undefined && j !== -1 && inOld.get(a[i]!) === i) cand.push([i, j]);
    }
    if (cand.length === 0) continue;
    // The run of candidates, increasing in both, that holds the most weight: a line with a U+FFFD counts for more
    // than any number of lines without (so a short line that happens to be unique cannot displace one that matters).
    const order = cand.map((_, k) => k).sort((x, y) => cand[x]![1] - cand[y]![1]);
    const rank = new Array<number>(cand.length);
    order.forEach((k, r) => (rank[k] = r + 1));
    const tree = new Array<number>(cand.length + 1).fill(-1); // Fenwick tree of the best chain end for ranks so far
    const best = new Array<number>(cand.length).fill(0);
    const back = new Array<number>(cand.length).fill(-1);
    const heavy = cand.length + 1;
    let top = -1;
    for (let k = 0; k < cand.length; k++) {
      let before = -1;
      for (let r = rank[k]! - 1; r > 0; r -= r & -r) if (tree[r]! !== -1 && (before === -1 || best[tree[r]!]! > best[before]!)) before = tree[r]!;
      best[k] = (before === -1 ? 0 : best[before]!) + (weightOf[a[cand[k]![0]]!] ? heavy : 1);
      back[k] = before;
      for (let r = rank[k]!; r <= cand.length; r += r & -r) if (tree[r]! === -1 || best[tree[r]!]! < best[k]!) tree[r] = k;
      if (top === -1 || best[k]! > best[top]!) top = k;
    }
    const chain: number[] = [];
    for (let k = top; k !== -1; k = back[k]!) chain.push(k);
    chain.reverse();
    let pi = i0;
    let pj = j0;
    for (const k of chain) {
      const [ci, cj] = cand[k]!;
      pairs.push([ci, cj]);
      regions.push([pi, ci, pj, cj]);
      pi = ci + 1;
      pj = cj + 1;
    }
    regions.push([pi, i1, pj, j1]);
  }
  return pairs.sort((x, y) => x[0] - y[0]);
}

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
