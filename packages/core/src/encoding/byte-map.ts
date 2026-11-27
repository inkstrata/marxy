// Text that is not UTF-8: what the shell says about how a file's bytes were read, and the byte map from a place in
// the page's UTF-8 back to the file's bytes. The page works in UTF-8 throughout (the buffer, the parse, Source, find,
// copy); a place that leaves the page as a place in the file (the reading position, a byte the inspector names, a
// find across files) goes through `fileOffsetOf`, and one that comes back through `bufferOffsetOf`.
//
// Pure: no DOM, no shell. The map is made in Rust (`src-tauri/src/encoding`) or, in the browser dev loop, by
// `decode.ts`; both give the frame `parseDecodedFrame` reads.

export type EncodingHow = 'bom' | 'utf8' | 'guess' | 'chosen';

/** The byte that ruled out UTF-8: its offset in the file, its line and its column (1-based, in bytes). */
export interface Deciding {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly byte: number;
}

/** Why the guess won: the bytes above 7F and, for a single-byte guess, what each reads as there. */
export interface Evidence {
  readonly high: number;
  readonly distinct: number;
  /** Those in 80 to 9F, where Windows-1252 keeps its quotes and dashes and ISO-8859-1 has only controls. */
  readonly c1: number;
  /** Every value above 7F is a letter or a mark in the guessed encoding. */
  readonly allLetters: boolean;
  readonly shown: readonly (readonly [number, string])[];
}

export interface EncodingFound {
  /** WHATWG's label, lowercased (`utf-16le`, `windows-1252`, `macintosh`), or Marxy's own (`iso-8859-1`, `utf-32le`). */
  readonly label: string;
  /** As said on screen: `UTF-16 LE`, `Mac Roman`. */
  readonly name: string;
  readonly how: EncodingHow;
  /** The byte-order mark's length: kept out of the text and written back on a save. */
  readonly bom: number;
  readonly fileBytes: number;
  /** What the file is read as without the reader's choice, and how that was known: the way back. */
  readonly detected?: string;
  readonly detectedHow?: EncodingHow;
  readonly deciding?: Deciding;
  readonly evidence?: Evidence;
  /** Bytes this encoding cannot read (each read as U+FFFD). */
  readonly unreadable: number;
  /** The text encoded again gives exactly the file's bytes, so a save can write the file's own encoding. */
  readonly writable: boolean;
}

/**
 * From the page's UTF-8 to the file. `identity`: the text is the bytes. `units`: every character is `unit` bytes, counted by
 * scalar value (a single-byte encoding, UTF-32) or by UTF-16 unit (2 or 4 bytes a character). `table`: a multi-byte legacy
 * encoding, (UTF-8 offset, file offset) pairs where their difference changes, (0, bom) implied before the first.
 */
export type ByteMap =
  | { readonly kind: 'identity' }
  | { readonly kind: 'units'; readonly unit: 1 | 2 | 4; readonly count: 'scalar' | 'utf16' }
  | { readonly kind: 'table'; readonly pairs: Uint32Array };

export interface DecodedText {
  readonly found: EncodingFound;
  /** The text as UTF-8: what the page reads. */
  readonly text: Uint8Array;
  readonly map: ByteMap;
}

/** One row of Read with encoding...: the same few bytes read as `label`, and what it cannot read in the file. */
export interface EncodingReading {
  readonly label: string;
  readonly name: string;
  readonly sample: string;
  readonly unreadable: number;
  readonly controls: number;
}

export interface EncodingReadings {
  readonly rows: readonly EncodingReading[];
  /** The bytes the counts cover: the whole file, or its first 8 MB. */
  readonly counted: number;
  readonly sampleAt: number;
}

const utf8 = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/** `decode_text`'s answer: the head's length (u32 LE), the head, the table's length in u32s and the table, then the text. */
export function parseDecodedFrame(body: Uint8Array): DecodedText {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = view.getUint32(0, true);
  const head = JSON.parse(utf8.decode(body.subarray(4, 4 + n))) as { found: EncodingFound; map: { kind: string; unit?: number; count?: string } };
  const t = view.getUint32(4 + n, true);
  const pairs = new Uint32Array(t);
  for (let i = 0; i < t; i++) pairs[i] = view.getUint32(8 + n + i * 4, true);
  const text = body.slice(8 + n + t * 4);
  const map: ByteMap =
    head.map.kind === 'units'
      ? { kind: 'units', unit: head.map.unit as 1 | 2 | 4, count: head.map.count === 'utf16' ? 'utf16' : 'scalar' }
      : head.map.kind === 'table'
        ? { kind: 'table', pairs }
        : { kind: 'identity' };
  return { found: head.found, text, map };
}

/** The same frame, made from a decode (the memory shell answers as the Rust shell does). */
export function decodedFrame(d: DecodedText): Uint8Array {
  const map = d.map.kind === 'units' ? { kind: 'units', unit: d.map.unit, count: d.map.count } : { kind: d.map.kind };
  const head = encoder.encode(JSON.stringify({ found: d.found, map }));
  const pairs = d.map.kind === 'table' ? d.map.pairs : new Uint32Array(0);
  const out = new Uint8Array(8 + head.length + pairs.length * 4 + d.text.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, head.length, true);
  out.set(head, 4);
  view.setUint32(4 + head.length, pairs.length, true);
  pairs.forEach((v, i) => view.setUint32(8 + head.length + i * 4, v, true));
  out.set(d.text, 8 + head.length + pairs.length * 4);
  return out;
}

// ---- units: counting characters in UTF-8, with a checkpoint every STEP bytes --------------------------------------

const STEP = 4096;

interface Counts {
  /** Characters (scalar values) before each checkpoint. */
  readonly scalars: Float64Array;
  /** Characters past the BMP before each checkpoint: each is two UTF-16 units. */
  readonly astral: Float64Array;
}

const countsCache = new WeakMap<Uint8Array, Counts>();

function countsOf(text: Uint8Array): Counts {
  let c = countsCache.get(text);
  if (c) return c;
  const n = Math.floor(text.length / STEP) + 1;
  const scalars = new Float64Array(n);
  const astral = new Float64Array(n);
  let s = 0;
  let a = 0;
  for (let i = 0; i < text.length; i++) {
    if (i % STEP === 0) {
      scalars[i / STEP] = s;
      astral[i / STEP] = a;
    }
    const b = text[i]!;
    if ((b & 0xc0) !== 0x80) s++;
    if (b >= 0xf0) a++;
  }
  if (text.length % STEP === 0) {
    scalars[n - 1] = s;
    astral[n - 1] = a;
  }
  c = { scalars, astral };
  countsCache.set(text, c);
  return c;
}

/** UTF-16 units (or scalar values) in `text` before byte `b`. */
function unitsBefore(text: Uint8Array, b: number, utf16: boolean): number {
  const c = countsOf(text);
  const k = Math.floor(b / STEP);
  let s = c.scalars[k]!;
  let a = c.astral[k]!;
  for (let i = k * STEP; i < b; i++) {
    const v = text[i]!;
    if ((v & 0xc0) !== 0x80) s++;
    if (v >= 0xf0) a++;
  }
  return utf16 ? s + a : s;
}

/** The first byte of `text` at a character start with `units` units before it (the end of the text past them). */
function byteAtUnits(text: Uint8Array, units: number, utf16: boolean): number {
  const c = countsOf(text);
  const at = (k: number): number => (utf16 ? c.scalars[k]! + c.astral[k]! : c.scalars[k]!);
  let lo = 0;
  let hi = c.scalars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (at(mid) <= units) lo = mid;
    else hi = mid - 1;
  }
  let b = lo * STEP;
  let have = at(lo);
  while (b < text.length) {
    const v = text[b]!;
    const width = v < 0x80 ? 1 : v >= 0xf0 ? 4 : v >= 0xe0 ? 3 : v >= 0xc0 ? 2 : 1;
    const step = utf16 && v >= 0xf0 ? 2 : 1;
    if (have + step > units) break;
    have += step;
    b += width;
  }
  return Math.min(b, text.length);
}

/** The character start at or before `b`. */
function charStart(text: Uint8Array, b: number): number {
  let i = Math.max(0, Math.min(b, text.length));
  while (i > 0 && i < text.length && (text[i]! & 0xc0) === 0x80) i--;
  return i;
}

/** The file offset of the page's UTF-8 offset `b` (`text` is the page's bytes). */
export function fileOffsetOf(found: Pick<EncodingFound, 'bom' | 'fileBytes'>, map: ByteMap, text: Uint8Array, b: number): number {
  const at = Math.max(0, Math.min(b, text.length));
  switch (map.kind) {
    case 'identity':
      return at;
    case 'units':
      return Math.min(found.bom + unitsBefore(text, at, map.count === 'utf16') * map.unit, found.fileBytes);
    case 'table': {
      const { pairs } = map;
      let lo = 0;
      let hi = pairs.length / 2 - 1;
      let u0 = 0;
      let f0 = found.bom;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pairs[mid * 2]! <= at) {
          u0 = pairs[mid * 2]!;
          f0 = pairs[mid * 2 + 1]!;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return Math.min(f0 + (at - u0), found.fileBytes);
    }
  }
}

/** The page's UTF-8 offset of the file offset `f`: the character that holds that byte (a BOM's bytes are before the text). */
export function bufferOffsetOf(found: Pick<EncodingFound, 'bom' | 'fileBytes'>, map: ByteMap, text: Uint8Array, f: number): number {
  switch (map.kind) {
    case 'identity':
      return Math.max(0, Math.min(f, text.length));
    case 'units':
      return byteAtUnits(text, Math.floor(Math.max(0, f - found.bom) / map.unit), map.count === 'utf16');
    case 'table': {
      const { pairs } = map;
      let lo = 0;
      let hi = pairs.length / 2 - 1;
      let u0 = 0;
      let f0 = found.bom;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pairs[mid * 2 + 1]! <= f) {
          u0 = pairs[mid * 2]!;
          f0 = pairs[mid * 2 + 1]!;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return charStart(text, u0 + Math.max(0, f - f0));
    }
  }
}

/** The file's bytes a range of the page names: what a find hit or a selection is, in the file. */
export function fileRangeOf(found: Pick<EncodingFound, 'bom' | 'fileBytes'>, map: ByteMap, text: Uint8Array, start: number, end: number): { start: number; end: number } {
  return { start: fileOffsetOf(found, map, text, start), end: fileOffsetOf(found, map, text, end) };
}
