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
 * encoding, (UTF-8 offset, file offset) pairs where their difference changes, (0, bom) implied before the first; held as
 * `ByteTable`, runs of equal steps, so a CJK file's map is not four bytes for each of its bytes.
 */
export type ByteMap =
  | { readonly kind: 'identity' }
  | { readonly kind: 'units'; readonly unit: 1 | 2 | 4; readonly count: 'scalar' | 'utf16' }
  | { readonly kind: 'table'; readonly table: ByteTable };

/**
 * The pairs of a `table` map, as steps from the pair before, equal steps as one record (Rust's `encoding/table.rs`).
 * `runs`: records of three LEB128 varints, the step in UTF-8 offset, the step in file offset, how many such steps.
 * `index`: (UTF-8 offset, file offset, byte offset in `runs`) before every `TABLE_GROUP`th record, the first (0, bom, 0).
 */
export interface ByteTable {
  readonly index: Uint32Array;
  readonly runs: Uint8Array;
}

export const TABLE_GROUP = 64;

/** Makes a `ByteTable` from pairs pushed in order (both offsets rising). */
export function createTableBuilder(bom: number): { push(u: number, f: number): void; finish(): ByteTable } {
  const index: number[] = [];
  const runs: number[] = [];
  let records = 0;
  let end: [number, number] = [0, bom];
  let start: [number, number] = [0, bom];
  let pending: [number, number, number] | null = null;
  const put = (v: number): void => {
    while (v >= 0x80) {
      runs.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    runs.push(v);
  };
  const flush = (): void => {
    if (!pending) return;
    if (records % TABLE_GROUP === 0) index.push(start[0], start[1], runs.length);
    put(pending[0]);
    put(pending[1]);
    put(pending[2]);
    records++;
    pending = null;
  };
  return {
    push(u, f) {
      const du = u - end[0];
      const df = f - end[1];
      if (pending && pending[0] === du && pending[1] === df) pending[2]++;
      else {
        flush();
        start = end;
        pending = [du, df, 1];
      }
      end = [u, f];
    },
    finish() {
      flush();
      if (index.length === 0) index.push(0, end[1], 0);
      return { index: Uint32Array.from(index), runs: Uint8Array.from(runs) };
    },
  };
}

/** The last pair whose UTF-8 offset (`byFile` false) or file offset is at most `value`: (0, bom) when none. */
export function seekTable(table: ByteTable, byFile: boolean, value: number): [number, number] {
  const { index, runs } = table;
  const key = (e: number): number => index[e * 3 + (byFile ? 1 : 0)]!;
  let lo = 0;
  let hi = index.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(mid) <= value) lo = mid + 1;
    else hi = mid;
  }
  const e = Math.max(0, lo - 1);
  let u = index[e * 3]!;
  let f = index[e * 3 + 1]!;
  let at = index[e * 3 + 2]!;
  const get = (): number => {
    let v = 0;
    let scale = 1;
    while (at < runs.length) {
      const b = runs[at++]!;
      v += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) break;
      scale *= 0x80;
    }
    return v;
  };
  while (at < runs.length) {
    const du = get();
    const df = get();
    const n = get();
    const now = byFile ? f : u;
    if (value < now) break;
    const k = Math.min(n, Math.floor((value - now) / Math.max(1, byFile ? df : du)));
    u += k * du;
    f += k * df;
    if (k < n) break;
  }
  return [u, f];
}

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

/** `decode_text`'s answer: the head's length (u32 LE), the head, the table's index (length in u32s, then the u32s LE), its runs (length in bytes, then the bytes), then the text. */
export function parseDecodedFrame(body: Uint8Array): DecodedText {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const bad = (what: string): Error => new Error(`decode_text: the frame is cut short or its ${what} is wrong`);
  if (body.byteLength < 4) throw bad('head length');
  const n = view.getUint32(0, true);
  if (n > body.byteLength - 12) throw bad('head length');
  const head = JSON.parse(utf8.decode(body.subarray(4, 4 + n))) as { found: EncodingFound; map: { kind: string; unit?: number; count?: string } };
  const t = view.getUint32(4 + n, true);
  if (t > (body.byteLength - 12 - n) / 4) throw bad('index length');
  const index = new Uint32Array(t);
  for (let i = 0; i < t; i++) index[i] = view.getUint32(8 + n + i * 4, true); // scale: the index is one entry per 64 records
  const r = view.getUint32(8 + n + t * 4, true);
  const runsAt = 12 + n + t * 4;
  if (r > body.byteLength - runsAt) throw bad('runs length');
  const runs = body.slice(runsAt, runsAt + r);
  const text = body.slice(runsAt + r);
  const map: ByteMap =
    head.map.kind === 'units'
      ? { kind: 'units', unit: head.map.unit as 1 | 2 | 4, count: head.map.count === 'utf16' ? 'utf16' : 'scalar' }
      : head.map.kind === 'table'
        ? { kind: 'table', table: { index, runs } }
        : { kind: 'identity' };
  return { found: head.found, text, map };
}

/** The same frame, made from a decode (the memory shell answers as the Rust shell does). */
export function decodedFrame(d: DecodedText): Uint8Array {
  const map = d.map.kind === 'units' ? { kind: 'units', unit: d.map.unit, count: d.map.count } : { kind: d.map.kind };
  const head = encoder.encode(JSON.stringify({ found: d.found, map }));
  const index = d.map.kind === 'table' ? d.map.table.index : new Uint32Array(0);
  const runs = d.map.kind === 'table' ? d.map.table.runs : new Uint8Array(0);
  const runsAt = 12 + head.length + index.length * 4;
  const out = new Uint8Array(runsAt + runs.length + d.text.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, head.length, true);
  out.set(head, 4);
  view.setUint32(4 + head.length, index.length, true);
  index.forEach((v, i) => view.setUint32(8 + head.length + i * 4, v, true));
  view.setUint32(8 + head.length + index.length * 4, runs.length, true);
  out.set(runs, runsAt);
  out.set(d.text, runsAt + runs.length);
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
      const [u0, f0] = seekTable(map.table, false, at);
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
      const [u0, f0] = seekTable(map.table, true, f);
      return charStart(text, u0 + Math.max(0, f - f0));
    }
  }
}

/** The file's bytes a range of the page names: what a find hit or a selection is, in the file. */
export function fileRangeOf(found: Pick<EncodingFound, 'bom' | 'fileBytes'>, map: ByteMap, text: Uint8Array, start: number, end: number): { start: number; end: number } {
  return { start: fileOffsetOf(found, map, text, start), end: fileOffsetOf(found, map, text, end) };
}
