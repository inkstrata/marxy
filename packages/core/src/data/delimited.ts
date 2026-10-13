// The `delimited-table` deriver (ADR-0071, amending ADR-0061; K-10b): a CSV or TSV file read as records of fields, each
// field a byte range of the file. Pure: no DOM, no shell. It never writes and nothing it makes reaches a splice.
//
// Two shapes of the same reading:
// - a **scan** (`createScan`, `scanSome`): compact typed arrays of record and field ranges, filled a slice at a time from
//   the start of the file, so the first rows can be shown before the last byte is read (commitment 5) and a file of
//   half a million rows costs a few bytes a field. Values are decoded on demand (`fieldValue`), never all at once;
// - a **tree** (`deriveTable`, `tableOf`): `contracts/derived.ts`'s nodes, for the invariants, the tests and one cell
//   at a time (`cellOf`).
//
// The rules, in bytes (ADR-0071 items 1 to 3):
// - the delimiter comes from the extension, never from the content: `.csv` is `,`, `.tsv` a tab;
// - a record ends at a line break outside quotes: `\n`, `\r\n`, or a lone `\r` (an old Mac file's line ending; Source
//   shows the bytes as they are, the table reads them as line breaks: F-89);
// - a leading UTF-8 BOM is its own range, in no field;
// - a line with no bytes before its terminator is a blank line: dropped from the rows and counted (`dropped`);
// - CSV: a field whose first byte is `"` is quoted and runs to its closing `"` (a `""` inside is one `"`), and may hold
//   delimiters and line breaks; any other field is verbatim. A record with an unclosed quote, or a byte after a closing
//   quote that is not a delimiter or a terminator (`"a"b`), is **unreadable**: its first line becomes one unreadable row,
//   shown raw, and reading resumes at the next line, so one bad quote reaches its own line and no further. The lines
//   after it that its quote reached into are still read as rows of their own, so the row says how many (`swallowed`):
//   the lines a quote that never closes runs through to the end of the file, or the lines up to the quote that closed
//   late (F-89, commitment 4: a reader is told which rows may have been misread);
// - TSV: no quoting at all. A field is the bytes between tabs, a `"` is data, and no record is ever unreadable;
// - a record a file still being read has not finished (`final: false`) is the one `pending` record.
// Every byte of the file is then in exactly one cell, delimiter, terminator, BOM, unreadable row, dropped blank line or
// pending record (the accounting rule), which `checkTableInvariants` asserts.
import type { Source } from '../contracts/ast.ts';
import type {
  DerivedCell,
  DerivedPending,
  DerivedRow,
  DerivedTable,
  DerivedUnreadable,
  DroppedLine,
  UnreadableReason,
} from '../contracts/derived.ts';

const LF = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const COMMA = 0x2c;
const TAB = 0x09;

/** `,` for a `.csv`, a tab for a `.tsv` (any case), else null: the extension says, the content is never sniffed. */
export function delimiterFor(path: string): ',' | '\t' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return ',';
  if (lower.endsWith('.tsv')) return '\t';
  return null;
}

/** The record kinds a scan holds, in `recordKind`. */
export const RECORD_ROW = 0;
export const RECORD_UNREADABLE = 1;
export const RECORD_PENDING = 2;

/** Bits of `fieldFlags`. */
export const FIELD_QUOTED = 1;
/** A `""` collapsed: the value differs from the bytes between the quotes (ADR-0071 item 4's mark). */
export const FIELD_DECODED = 2;
/** The value holds a line break. */
export const FIELD_BREAK = 4;
/** The value is a plain number (`-5`, `1.25`, `3e4`): for alignment and sort only. */
export const FIELD_NUMBER = 8;
/** The value is one short token of letters, digits and `_ . : / @ # -` (a name, an id, a hash): set in the code face. */
export const FIELD_IDENT = 16;
/** The value is empty. */
export const FIELD_EMPTY = 32;

/** An Int32Array that doubles as it fills. */
class Grow {
  data: Int32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Int32Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

class GrowBytes {
  data: Uint8Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Uint8Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Uint8Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

/** A delimited file read so far, as ranges. Every array is filled in file order; read lengths, not capacities. */
export interface TableScan {
  readonly bytes: Uint8Array;
  readonly delimiter: ',' | '\t';
  readonly final: boolean;
  /** The leading byte-order mark, `[0, 3)`, when there is one. */
  readonly bom: boolean;
  /** Where reading resumes; `bytes.length` once done. */
  pos: number;
  done: boolean;
  /** Line breaks passed so far, for "Table from N lines". */
  newlines: number;
  /** The widest record's field count so far. */
  widest: number;
  /** Records and blank lines so far that end in a lone `\r` (not `\r\n`): an old Mac file's line ending. */
  loneCr: number;
  readonly records: {
    readonly kind: GrowBytes;
    readonly start: Grow;
    /** The record's end, its terminator excluded. */
    readonly end: Grow;
    /** After its terminator (`end` when it has none). */
    readonly next: Grow;
    /** The index of its first field in `fields`; its count is the next record's first less this. */
    readonly firstField: Grow;
  };
  readonly fields: { readonly start: Grow; readonly end: Grow; readonly flags: GrowBytes };
  /** Per unreadable record (by record index): why, the byte the fault was found at, and how many lines after its own its quote reached into. */
  readonly faults: Map<number, { readonly reason: UnreadableReason; readonly at: number; readonly swallowed: number }>;
  /** Each blank line's terminator range, as [start, end] pairs. */
  readonly blanks: Grow;
}

/** A scan of `bytes` at its start. `final: false` reads a file still being written: its unfinished last record is pending. */
export function createScan(bytes: Uint8Array, delimiter: ',' | '\t', opts: { readonly final?: boolean } = {}): TableScan {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return {
    bytes,
    delimiter,
    final: opts.final ?? true,
    bom,
    pos: bom ? 3 : 0,
    done: false,
    newlines: 0,
    widest: 0,
    loneCr: 0,
    records: { kind: new GrowBytes(), start: new Grow(), end: new Grow(), next: new Grow(), firstField: new Grow() },
    fields: { start: new Grow(4096), end: new Grow(4096), flags: new GrowBytes(4096) },
    faults: new Map(),
    blanks: new Grow(64),
  };
}

/** Records read so far (rows, unreadable rows and the pending one). */
export const recordCount = (scan: TableScan): number => scan.records.start.length;

/** The fields of record `r`: `[first, end)` indexes into `scan.fields`. */
export function fieldsOf(scan: TableScan, r: number): readonly [number, number] {
  const first = scan.records.firstField.data[r]!;
  const end = r + 1 < scan.records.firstField.length ? scan.records.firstField.data[r + 1]! : scan.fields.start.length;
  return [first, end];
}

const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;

/** `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$` over bytes, without making a string. */
export function isNumberBytes(bytes: Uint8Array, start: number, end: number): boolean {
  let i = start;
  if (i < end && (bytes[i] === 0x2b || bytes[i] === 0x2d)) i++;
  let digits = 0;
  while (i < end && isDigit(bytes[i]!)) {
    i++;
    digits++;
  }
  if (i < end && bytes[i] === 0x2e) {
    i++;
    while (i < end && isDigit(bytes[i]!)) {
      i++;
      digits++;
    }
  }
  if (digits === 0) return false;
  if (i < end && (bytes[i] === 0x65 || bytes[i] === 0x45)) {
    i++;
    if (i < end && (bytes[i] === 0x2b || bytes[i] === 0x2d)) i++;
    let exp = 0;
    while (i < end && isDigit(bytes[i]!)) {
      i++;
      exp++;
    }
    if (exp === 0) return false;
  }
  return i === end;
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The same rule over a string (a decoded value). */
export const isNumberText = (value: string): boolean => PLAIN_NUMBER.test(value);

function isIdentBytes(bytes: Uint8Array, start: number, end: number): boolean {
  if (end <= start || end - start > 64) return false;
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    const ok =
      (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) ||
      b === 0x5f || b === 0x2e || b === 0x3a || b === 0x2f || b === 0x40 || b === 0x23 || b === 0x2d;
    if (!ok) return false;
  }
  return true;
}

/** The flags of a value whose bytes are `[s, e)` (the inside of a quoted field, or a verbatim field). */
function contentFlags(bytes: Uint8Array, s: number, e: number, decoded: boolean, broke: boolean): number {
  let flags = 0;
  if (decoded) flags |= FIELD_DECODED;
  if (broke) flags |= FIELD_BREAK;
  if (s === e) return flags | FIELD_EMPTY;
  if (!decoded && !broke) {
    if (isNumberBytes(bytes, s, e)) flags |= FIELD_NUMBER;
    else if (isIdentBytes(bytes, s, e)) flags |= FIELD_IDENT;
  }
  return flags;
}

/**
 * The line break at `i`: 1 for `\n` or a lone `\r`, 2 for `\r\n`, 0 where there is none. A `\r` last in a file still being
 * read (`final: false`) may yet be the start of a `\r\n`: -1.
 */
function breakAt(bytes: Uint8Array, i: number, n: number, final: boolean): number {
  const b = bytes[i];
  if (b === LF) return 1;
  if (b !== CR) return 0;
  if (i + 1 < n) return bytes[i + 1] === LF ? 2 : 1;
  return final ? 1 : -1;
}

/** The first line of the record at `at`: where its text ends, and where the next line starts. */
function firstLine(bytes: Uint8Array, at: number): { readonly end: number; readonly next: number } {
  const n = bytes.length;
  for (let i = at; i < n; i++) {
    const b = bytes[i];
    if (b === LF) return { end: i, next: i + 1 };
    if (b === CR) return { end: i, next: bytes[i + 1] === LF ? i + 2 : i + 1 };
  }
  return { end: n, next: n };
}

/**
 * Reads up to `budget.records` more records, or until `budget.until()` says stop (checked every 256 records). Returns
 * true once the whole file is read. Records already read never change, so a caller may draw them between calls.
 */
export function scanSome(scan: TableScan, budget: { readonly records?: number; readonly until?: () => boolean } = {}): boolean {
  const { bytes, final } = scan;
  const n = bytes.length;
  const csv = scan.delimiter === ',';
  const delim = csv ? COMMA : TAB;
  const rec = scan.records;
  const fld = scan.fields;
  const limit = budget.records ?? Number.POSITIVE_INFINITY;
  const from = scan.pos;
  let p = scan.pos;
  let made = 0;
  while (p < n && made < limit) {
    if ((made & 255) === 255 && budget.until?.()) break;
    // A blank line: its terminator, dropped and counted.
    const blank = breakAt(bytes, p, n, final);
    if (blank > 0) {
      scan.blanks.push(p);
      scan.blanks.push(p + blank);
      if (blank === 1 && bytes[p] === CR) scan.loneCr++;
      p += blank;
      continue;
    }
    if (blank < 0) {
      // A CR last in a file still being written may yet be a CRLF: the pending record.
      rec.kind.push(RECORD_PENDING);
      rec.start.push(p);
      rec.end.push(n);
      rec.next.push(n);
      rec.firstField.push(fld.start.length);
      p = n;
      made++;
      break;
    }
    const recStart = p;
    const firstField = fld.start.length;
    let fault: { reason: UnreadableReason; at: number; swallowed: number } | null = null;
    let recEnd = -1;
    let next = -1;
    let unfinished = false;
    for (;;) {
      const fs = p;
      let fe: number;
      let flags: number;
      let after: number;
      if (csv && bytes[p] === QUOTE) {
        let q = p + 1;
        let decoded = false;
        let broke = false;
        let close = -1;
        // Line breaks the quote runs through that start another line before the end of the file: the lines it may swallow.
        let lines = 0;
        while (q < n) {
          const b = bytes[q]!;
          if (b === QUOTE) {
            if (q + 1 < n && bytes[q + 1] === QUOTE) {
              decoded = true;
              q += 2;
              continue;
            }
            if (q + 1 === n && !final) break; // a quote at the end of what is read may yet be doubled
            close = q;
            break;
          }
          if (b === LF || b === CR) {
            broke = true;
            const len = b === CR && q + 1 < n && bytes[q + 1] === LF ? 2 : 1;
            if (q + len < n) lines++;
            q += len;
            continue;
          }
          q++;
        }
        if (close < 0) {
          if (!final) {
            unfinished = true;
            break;
          }
          fault = { reason: 'unclosed-quote', at: fs, swallowed: lines };
          break;
        }
        fe = close + 1;
        after = fe;
        flags = FIELD_QUOTED | contentFlags(bytes, fs + 1, close, decoded, broke);
        if (after < n && bytes[after] !== delim) {
          const gap = breakAt(bytes, after, n, final);
          if (gap < 0) {
            unfinished = true;
            break;
          }
          if (gap === 0) {
            fault = { reason: 'after-quote', at: after, swallowed: lines };
            break;
          }
        }
      } else {
        let q = p;
        while (q < n) {
          const b = bytes[q]!;
          if (b === delim || b === LF || b === CR) break;
          q++;
        }
        fe = q;
        after = q;
        flags = contentFlags(bytes, fs, fe, false, false);
      }
      fld.start.push(fs);
      fld.end.push(fe);
      fld.flags.push(flags);
      if (after === n) {
        if (!final) unfinished = true;
        recEnd = n;
        next = n;
        break;
      }
      const b = bytes[after]!;
      if (b === delim) {
        p = after + 1;
        if (p === n) {
          // A delimiter last in the file: one more, empty, field after it.
          if (!final) {
            unfinished = true;
            break;
          }
          fld.start.push(n);
          fld.end.push(n);
          fld.flags.push(FIELD_EMPTY);
          recEnd = n;
          next = n;
          break;
        }
        continue;
      }
      const gap = breakAt(bytes, after, n, final);
      if (gap < 0) {
        unfinished = true;
        break;
      }
      recEnd = after;
      next = after + gap;
      if (gap === 1 && b === CR) scan.loneCr++;
      break;
    }
    if (unfinished) {
      fld.start.length = firstField;
      fld.end.length = firstField;
      fld.flags.length = firstField;
      rec.kind.push(RECORD_PENDING);
      rec.start.push(recStart);
      rec.end.push(n);
      rec.next.push(n);
      rec.firstField.push(firstField);
      p = n;
      made++;
      break;
    }
    if (fault) {
      // The record's first line, raw; the fields read before the fault are let go.
      fld.start.length = firstField;
      fld.end.length = firstField;
      fld.flags.length = firstField;
      const line = firstLine(bytes, recStart);
      scan.faults.set(rec.start.length, fault);
      rec.kind.push(RECORD_UNREADABLE);
      rec.start.push(recStart);
      rec.end.push(line.end);
      rec.next.push(line.next);
      rec.firstField.push(firstField);
      p = line.next;
      made++;
      continue;
    }
    rec.kind.push(RECORD_ROW);
    rec.start.push(recStart);
    rec.end.push(recEnd);
    rec.next.push(next);
    rec.firstField.push(firstField);
    const count = fld.start.length - firstField;
    if (count > scan.widest) scan.widest = count;
    p = next;
    made++;
  }
  scan.newlines += breaksIn(bytes, from, p);
  scan.pos = p;
  scan.done = p >= n;
  return scan.done;
}

/** Reads the rest of the file at once. */
export function scanAll(scan: TableScan): TableScan {
  scanSome(scan);
  return scan;
}

/** Line breaks in `[from, to)`: each `\n`, each lone `\r`, and a `\r\n` once. */
export function breaksIn(bytes: Uint8Array, from: number, to: number): number {
  let count = 0;
  for (let i = bytes.indexOf(LF, from); i >= 0 && i < to; i = bytes.indexOf(LF, i + 1)) count++;
  for (let i = bytes.indexOf(CR, from); i >= 0 && i < to; i = bytes.indexOf(CR, i + 1)) if (bytes[i + 1] !== LF) count++;
  return count;
}

/** The line (from 1) that byte `at` is on. */
export function lineOfByte(bytes: Uint8Array, at: number): number {
  return 1 + breaksIn(bytes, 0, Math.min(at, bytes.length));
}

/**
 * A hint, never a re-parse (ADR-0071 rejects sniffing the delimiter): when the rows read so far are all one field and
 * every one of the first 20 holds the same number of one other candidate (`;`, a tab, `|`, or `,` in a TSV), the file
 * may use that between fields. The table stays as the extension reads it and the view says so.
 */
export function delimiterHint(scan: TableScan): ';' | '\t' | '|' | ',' | null {
  const sample: number[] = [];
  for (let r = 0; r < recordCount(scan) && sample.length < 20; r++) {
    if (scan.records.kind.data[r] !== RECORD_ROW) continue;
    const [first, end] = fieldsOf(scan, r);
    if (end - first !== 1) return null;
    sample.push(first);
  }
  if (sample.length === 0) return null;
  const candidates = [0x3b, TAB, 0x7c, COMMA].filter((b) => b !== (scan.delimiter === ',' ? COMMA : TAB));
  for (const cand of candidates) {
    let each = -1;
    for (const f of sample) {
      let k = 0;
      for (let i = scan.fields.start.data[f]!; i < scan.fields.end.data[f]!; i++) if (scan.bytes[i] === cand) k++;
      if (k === 0 || (each >= 0 && k !== each)) {
        each = -2;
        break;
      }
      each = k;
    }
    if (each > 0) return String.fromCharCode(cand) as ';' | '\t' | '|' | ',';
  }
  return null;
}

/** Lines in the file: its line breaks, and one more when it does not end in one. */
export function lineCount(scan: TableScan): number {
  const n = scan.bytes.length;
  if (n === 0 || (scan.bom && n === 3)) return 0;
  const last = scan.bytes[n - 1];
  return scan.newlines + (scan.done && last !== LF && last !== CR ? 1 : 0);
}

/** UTF-8 as the standard decoder reads it (U+FFFD for each invalid sequence), a byte-order mark kept as a character. */
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
const strict = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

/** Whether `[s, e)` is valid UTF-8, so each U+FFFD in its value is the file's own and not one the decoder made. */
export function isValidUtf8(bytes: Uint8Array, s: number, e: number): boolean {
  for (let i = s; i < e; i++) {
    if (bytes[i]! >= 0x80) {
      try {
        strict.decode(bytes.subarray(s, e));
        return true;
      } catch {
        return false;
      }
    }
  }
  return true;
}

/**
 * The `csv-field` decoding of one whole raw field (ADR-0071 item 2): a field not starting with `"` is its bytes as
 * UTF-8; a quoted one is the bytes between its quotes with each `""` read as one `"`. Throws on bytes that are not one
 * well-formed field (a quoted field without its closing quote, or with a lone `"` inside).
 */
export function decodeCsvField(field: Uint8Array): string {
  if (field.length === 0 || field[0] !== QUOTE) return utf8.decode(field);
  if (field.length < 2 || field[field.length - 1] !== QUOTE) throw new Error('decodeCsvField: a quoted field has no closing quote');
  for (let i = 1; i < field.length - 1; i++) {
    if (field[i] !== QUOTE) continue;
    if (field[i + 1] !== QUOTE || i + 1 === field.length - 1) throw new Error('decodeCsvField: a lone quote inside a quoted field');
    i++;
  }
  return utf8.decode(field.subarray(1, field.length - 1)).replaceAll('""', '"');
}

/** The value of field `f`: its decoding (CSV) or its bytes as UTF-8 (TSV). */
export function fieldValue(scan: TableScan, f: number): string {
  const s = scan.fields.start.data[f]!;
  const e = scan.fields.end.data[f]!;
  if (scan.fields.flags.data[f]! & FIELD_QUOTED) {
    const inner = utf8.decode(scan.bytes.subarray(s + 1, e - 1));
    return scan.fields.flags.data[f]! & FIELD_DECODED ? inner.replaceAll('""', '"') : inner;
  }
  return utf8.decode(scan.bytes.subarray(s, e));
}

/** The raw bytes of `[s, e)` as text: what an unreadable row or the pending record shows. */
export function rawText(scan: TableScan, s: number, e: number): string {
  return utf8.decode(scan.bytes.subarray(s, e));
}

/** The `cell` node of field `f`: what a selection of it is (ADR-0071 item 5). */
export function cellOf(scan: TableScan, f: number, file: string): DerivedCell {
  return {
    type: 'cell',
    src: { file, start: scan.fields.start.data[f]!, end: scan.fields.end.data[f]! },
    value: fieldValue(scan, f),
    decoding: scan.delimiter === ',' ? 'csv-field' : 'none',
    syntax: 'plain',
    decoded: (scan.fields.flags.data[f]! & FIELD_DECODED) !== 0,
  };
}

/** The tree of what `scan` has read (the whole file once `scan.done`). */
export function tableOf(scan: TableScan, file: string): DerivedTable {
  const at = (start: number, end: number): Source => ({ file, start, end });
  const rec = scan.records;
  const children: (DerivedRow | DerivedUnreadable | DerivedPending)[] = [];
  for (let r = 0; r < rec.start.length; r++) {
    const s = rec.start.data[r]!;
    const e = rec.end.data[r]!;
    const nx = rec.next.data[r]!;
    const terminator = nx > e ? at(e, nx) : null;
    const kind = rec.kind.data[r]!;
    if (kind === RECORD_PENDING) {
      children.push({ type: 'pending', src: at(s, e) });
    } else if (kind === RECORD_UNREADABLE) {
      const fault = scan.faults.get(r)!;
      children.push({ type: 'unreadable', src: at(s, e), reason: fault.reason, at: fault.at, swallowed: fault.swallowed, terminator });
    } else {
      const [first, end] = fieldsOf(scan, r);
      const cells: DerivedCell[] = [];
      for (let f = first; f < end; f++) cells.push(cellOf(scan, f, file));
      children.push({ type: 'row', src: at(s, e), children: cells, terminator });
    }
  }
  const dropped: DroppedLine[] = [];
  for (let i = 0; i < scan.blanks.length; i += 2) dropped.push({ src: at(scan.blanks.data[i]!, scan.blanks.data[i + 1]!), reason: 'blank' });
  return {
    type: 'table',
    deriver: 'delimited-table',
    src: at(0, scan.bytes.length),
    delimiter: scan.delimiter,
    bom: scan.bom ? at(0, 3) : null,
    children,
    dropped,
  };
}

/** The whole tree of `bytes` read as the file at `path` (its extension says the delimiter; anything else reads as CSV). */
export function deriveTable(bytes: Uint8Array, path: string, opts: { readonly final?: boolean } = {}): DerivedTable {
  return tableOf(scanAll(createScan(bytes, delimiterFor(path) ?? ',', opts)), path);
}

/**
 * Whether the first row is a header (ADR-0071 ruling 2): every field in it is non-numeric and the fields are distinct.
 * The view says so and one click makes it a data row; nothing is written.
 */
export function inferHeader(values: readonly string[]): boolean {
  if (values.length === 0) return false;
  if (values.some(isNumberText)) return false;
  return new Set(values).size === values.length;
}

/** The ways a tree can break `DERIVED_TABLE_INVARIANTS` against `bytes`; empty when it holds them all. */
export function checkTableInvariants(tree: DerivedTable, bytes: Uint8Array): string[] {
  const problems: string[] = [];
  const n = bytes.length;
  if (tree.src.start !== 0 || tree.src.end !== n) problems.push(`the table covers [${tree.src.start}, ${tree.src.end}), not [0, ${n})`);
  const delim = tree.delimiter === ',' ? COMMA : TAB;
  const decode = (s: Source): string => (tree.delimiter === ',' ? decodeCsvField(bytes.subarray(s.start, s.end)) : utf8.decode(bytes.subarray(s.start, s.end)));
  // Accounting: every range the tree names, in order, must tile the file.
  const pieces: { start: number; end: number; what: string }[] = [];
  if (tree.bom) pieces.push({ start: tree.bom.start, end: tree.bom.end, what: 'bom' });
  for (const d of tree.dropped) {
    if (d.src.end <= d.src.start) problems.push(`a dropped line at ${d.src.start} is empty`);
    pieces.push({ start: d.src.start, end: d.src.end, what: 'blank' });
  }
  let lastEnd = -1;
  for (const child of tree.children) {
    const { start, end } = child.src;
    if (start > end) problems.push(`${child.type} at ${start} ends before it starts`);
    if (start < lastEnd) problems.push(`${child.type} at ${start} overlaps the record before it`);
    lastEnd = end;
    if (child.type === 'pending') {
      pieces.push({ start, end, what: 'pending' });
      continue;
    }
    if (end <= start) problems.push(`${child.type} at ${start} is empty`);
    if (child.type === 'unreadable') {
      pieces.push({ start, end, what: 'unreadable' });
    } else {
      let cursor = start;
      child.children.forEach((cell, i) => {
        if (cell.src.start > cell.src.end) problems.push(`a cell at ${cell.src.start} ends before it starts`);
        if (i > 0) {
          if (cell.src.start !== cursor + 1 || bytes[cursor] !== delim) problems.push(`no single delimiter before the cell at ${cell.src.start}`);
          else pieces.push({ start: cursor, end: cursor + 1, what: 'delimiter' });
        } else if (cell.src.start !== start) {
          problems.push(`the row at ${start} has bytes before its first cell`);
        }
        pieces.push({ start: cell.src.start, end: cell.src.end, what: 'cell' });
        cursor = cell.src.end;
        let value: string | null = null;
        try {
          value = decode(cell.src);
        } catch (e) {
          problems.push(`the cell at ${cell.src.start} is not one well-formed field: ${(e as Error).message}`);
        }
        if (value !== null && value !== cell.value) problems.push(`the cell at ${cell.src.start} says ${JSON.stringify(cell.value)}, its bytes decode to ${JSON.stringify(value)}`);
        const quoted = bytes[cell.src.start] === QUOTE && tree.delimiter === ',';
        const inner = quoted ? utf8.decode(bytes.subarray(cell.src.start + 1, cell.src.end - 1)) : null;
        const decoded = inner !== null && inner !== cell.value;
        if (decoded !== cell.decoded) problems.push(`the cell at ${cell.src.start} has decoded=${cell.decoded}, its bytes say ${decoded}`);
        if (cell.decoding !== (tree.delimiter === ',' ? 'csv-field' : 'none')) problems.push(`the cell at ${cell.src.start} declares ${cell.decoding}`);
      });
      if (child.children.length === 0) problems.push(`the row at ${start} has no cells`);
      if (cursor !== end) problems.push(`the row at ${start} has bytes after its last cell`);
    }
    if (child.terminator) {
      const t = bytes.subarray(child.terminator.start, child.terminator.end);
      const ok = (t.length === 1 && (t[0] === LF || t[0] === CR)) || (t.length === 2 && t[0] === CR && t[1] === LF);
      if (!ok || child.terminator.start !== end) problems.push(`the record at ${start} has no terminator where it ends`);
      pieces.push({ start: child.terminator.start, end: child.terminator.end, what: 'terminator' });
    } else if (end !== n) {
      problems.push(`the record at ${start} has no terminator and is not last`);
    }
  }
  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  let at = 0;
  for (const piece of pieces) {
    if (piece.start !== at) {
      problems.push(piece.start > at ? `bytes [${at}, ${piece.start}) are in nothing` : `the ${piece.what} at ${piece.start} overlaps what is before it`);
    }
    at = Math.max(at, piece.end);
  }
  if (at !== n) problems.push(`bytes [${at}, ${n}) are in nothing`);
  return problems;
}
