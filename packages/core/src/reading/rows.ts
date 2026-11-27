// Every row of a CSV, TSV or JSON Lines file for the Table reading, read from the bytes the document already holds.
// An index of where each row starts is built a slice at a time (a few bytes a row; no field is kept), and the rows the
// table shows are read again from their bytes when it draws them. Sorting, the row filter and find read every row the
// same way, a slice at a time. Nothing here writes: the bytes stay the document, and every row drawn carries its range.
// Pure: no DOM, no shell.
//
// Why here and not in the shell: the bytes are already in memory (they are the document), an edit not yet saved is in
// them and not on disk, and the CSV rules (unreadable rows, blank lines, a BOM) are core's alone; a second reader in Rust
// would have to agree with them byte for byte and would read the file a second time.
import { createScan, FIELD_DECODED, FIELD_QUOTED, fieldsOf, fieldValue, RECORD_ROW, RECORD_UNREADABLE, scanSome, type TableScan } from '../data/delimited.ts';
import { sortSliced, type Pace } from '../data/table-view.ts';
import { type Budget, budget, figure } from '../util/budget.ts';
import { parseJson, TreeError, type TreeNode } from './tree.ts';

/** Rows a table or records reading draws whole; past it the table draws the rows on screen and reads the rest as it scrolls. */
export const READING_MAX_ROWS = 2000;

/** Columns a table or records reading draws: a file a thousand columns wide is a page of markup a row. */
export const READING_MAX_COLUMNS = 100;

/** The longest a drawn cell's text or value runs, in UTF-16 units; the row's bytes still cover the whole field. */
export const READING_MAX_CELL = 4096;

/** Distinct keys JSON Lines are read for: a file can name a new key in every record, and each one kept is a column. */
export const READING_MAX_KEYS = 10_000;

/** The most bytes of one JSON Lines record that are parsed; a longer one is a cut row that says its size and shows its head. */
export const READING_MAX_RECORD = 1024 * 1024;

/** Bytes of a cut record that are decoded to show its head. */
const CUT_HEAD_BYTES = 480;

const HEADER_STEPS = 1 << 16;

/** Rows the page is first set with when there are more than it draws whole: more than a screen. */
export const FIRST_ROWS = 200;

const LF = 0x0a;
const CR = 0x0d;
const utf8 = new TextDecoder();

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** An Int32Array that doubles as it fills. */
class Ints {
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

class Bits {
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

export interface RowColumn {
  readonly name: string;
  /** Every value read so far is a number (or empty): set to the right. */
  numeric: boolean;
  /** Records holding the key (JSON Lines). */
  has: number;
  /** The byte the column is first named at: its header field, or the first record holding the key. */
  readonly first: number;
  /** The header field's end (a table); `first` for a key. */
  readonly end: number;
}

/** A CSV, TSV or JSON Lines file as rows: where each starts, which do not read, and its columns. */
export interface ReadingRows {
  readonly form: 'table' | 'records';
  readonly bytes: Uint8Array;
  readonly delimiter: ',' | '\t';
  /** A table's header record (its first that reads as fields); null for records. */
  readonly header: { readonly start: number; readonly end: number } | null;
  /** A table's header fields, or the keys found so far in the order they first appear. */
  readonly columns: RowColumn[];
  /** Where each data row starts (the header excluded), in file order. */
  readonly starts: Ints;
  /** 1 for a row that does not read: an unreadable CSV record, or a line that is not a JSON object. */
  readonly bad: Bits;
  /** JSON Lines: a run of blank lines as [rows indexed when it was passed, blank lines up to and including it], for a row's line number. */
  readonly blanks: Ints;
  /** Where indexing resumes, and whether every row is indexed. */
  pos: number;
  indexed: boolean;
  /** Rows that do not read, of those known. */
  badRows: number;
  /** JSON Lines: rows past READING_MAX_RECORD, not parsed; they are in `badRows` too. */
  cutRows: number;
  /** JSON Lines: rows parsed for their keys so far (a table's rows need no such pass). */
  parsed: number;
  /** The widest record's field count (a table). */
  widest: number;
  readonly keyAt: Map<string, number>;
  /** JSON Lines: the keys taken as columns; a new key past its limit is not. */
  readonly keys: Budget;
  /** A scan reused to read one record's fields when a row is drawn. */
  readonly page: TableScan;
}

const isBlankByte = (b: number): boolean => b === 0x20 || b === 0x09 || b === CR || b === 0x0b || b === 0x0c;

/** A line of nothing but white space: dropped, as the text's `trim() === ''` drops it. */
function blankLine(bytes: Uint8Array, s: number, e: number): boolean {
  for (let i = s; i < e; i++) {
    const b = bytes[i]!;
    if (isBlankByte(b)) continue;
    if (b < 0x80) return false;
    return utf8.decode(bytes.subarray(s, e)).trim() === '';
  }
  return true;
}

function emptyRows(bytes: Uint8Array, form: ReadingRows['form'], delimiter: ',' | '\t', header: ReadingRows['header'], pos: number): ReadingRows {
  return {
    form,
    bytes,
    delimiter,
    header,
    columns: [],
    starts: new Ints(),
    bad: new Bits(),
    blanks: new Ints(64),
    pos,
    indexed: pos >= bytes.length,
    badRows: 0,
    cutRows: 0,
    parsed: 0,
    widest: 0,
    keyAt: new Map(),
    keys: budget(READING_MAX_KEYS),
    page: createScan(bytes, delimiter),
  };
}

/** The record at `start` read again with its fields, in the reused scan: record 0 of it. */
function readRecord(rows: ReadingRows, start: number): TableScan {
  const s = rows.page;
  s.records.kind.length = 0;
  s.records.start.length = 0;
  s.records.end.length = 0;
  s.records.next.length = 0;
  s.records.firstField.length = 0;
  s.fields.start.length = 0;
  s.fields.end.length = 0;
  s.fields.flags.length = 0;
  s.blanks.length = 0;
  s.faults.clear();
  s.pos = start;
  s.done = false;
  scanSome(s, { records: 1 });
  return s;
}

/**
 * The values of fields `[first, end)` of the record read into `scan` (record 0). The record is decoded once; where it is
 * all ASCII a field is a slice of that text, which saves a decoder call a field, most of what reading every row costs.
 */
function fieldValues(scan: TableScan, first: number, end: number): string[] {
  const s = scan.records.start.data[0]!;
  const e = scan.records.end.data[0]!;
  const text = utf8.decode(scan.bytes.subarray(s, e));
  const out: string[] = [];
  if (text.length !== e - s) {
    for (let f = first; f < end; f++) out.push(fieldValue(scan, f));
    return out;
  }
  const { start, end: stop, flags } = scan.fields;
  for (let f = first; f < end; f++) {
    const fl = flags.data[f]!;
    if (fl & FIELD_QUOTED) {
      const inner = text.slice(start.data[f]! + 1 - s, stop.data[f]! - 1 - s);
      out.push(fl & FIELD_DECODED ? inner.replaceAll('""', '"') : inner);
    } else out.push(text.slice(start.data[f]! - s, stop.data[f]! - s));
  }
  return out;
}

/** `text` as a cell draws it: past READING_MAX_CELL, its start and an ellipsis (never half of a surrogate pair). */
function capText(text: string): string {
  if (text.length <= READING_MAX_CELL) return text;
  let cut = READING_MAX_CELL;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return `${text.slice(0, cut)}…`;
}

/**
 * The values of fields `[first, end)` for drawing, each capped. A record much larger than its cells (one huge field) is
 * not decoded whole: a field past the cap is read from its first bytes alone.
 */
function drawnValues(scan: TableScan, first: number, end: number): string[] {
  const s = scan.records.start.data[0]!;
  const e = scan.records.end.data[0]!;
  if (e - s <= READING_MAX_CELL * 16) return fieldValues(scan, first, end).map(capText);
  const { bytes } = scan;
  const { start, end: stop, flags } = scan.fields;
  const out: string[] = [];
  for (let f = first; f < end; f++) {
    const quoted = (flags.data[f]! & FIELD_QUOTED) !== 0;
    const cs = start.data[f]! + (quoted ? 1 : 0);
    const ce = stop.data[f]! - (quoted ? 1 : 0);
    if (ce - cs <= READING_MAX_CELL) {
      out.push(capText(fieldValue(scan, f)));
      continue;
    }
    // Back to a character boundary, and off the first quote of a doubled pair.
    let cut = cs + READING_MAX_CELL;
    while (cut > cs && (bytes[cut]! & 0xc0) === 0x80) cut--;
    if (quoted) {
      let run = 0;
      while (cut - run > cs && bytes[cut - run - 1] === 0x22) run++;
      if (run & 1) cut--;
    }
    const head = utf8.decode(bytes.subarray(cs, cut));
    out.push(`${quoted && (flags.data[f]! & FIELD_DECODED) ? head.replaceAll('""', '"') : head}…`);
  }
  return out;
}

/** A CSV or TSV as rows, its header read; null when no record reads as fields. */
export function tableRows(bytes: Uint8Array, delimiter: ',' | '\t'): ReadingRows | null {
  const head = createScan(bytes, delimiter);
  let h = -1;
  // A header that is not among the first steps (blank lines count) is not a table's: a file of newlines is not scanned whole.
  for (let step = 0; h < 0 && !head.done && step < HEADER_STEPS; step++) {
    const before = head.records.start.length;
    const pos = head.pos;
    scanSome(head, { records: 1 });
    if (head.pos === pos) break;
    if (head.records.start.length > before && head.records.kind.data[before] === RECORD_ROW) h = before;
  }
  if (h < 0) return null;
  const rows = emptyRows(bytes, 'table', delimiter, { start: head.records.start.data[h]!, end: head.records.end.data[h]! }, head.bom ? 3 : 0);
  const [first, end] = fieldsOf(head, h);
  for (let f = first; f < end; f++) {
    rows.columns.push({ name: fieldValue(head, f), numeric: true, has: 0, first: head.fields.start.data[f]!, end: head.fields.end.data[f]! });
  }
  return rows;
}

/** A JSON Lines file as rows: each line that is not blank. */
export function recordRows(bytes: Uint8Array): ReadingRows {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return emptyRows(bytes, 'records', ',', null, bom ? 3 : 0);
}

/** Rows indexed so far. */
export const rowCount = (rows: ReadingRows): number => rows.starts.length;

/** Whether everything a reader is told about the rows is known: indexed, and for records, every line parsed. */
export const rowsSettled = (rows: ReadingRows): boolean => rows.indexed && (rows.form === 'table' || rows.parsed === rows.starts.length);

/**
 * Indexes up to `budget.rows` more rows, or until `budget.until()` says stop. Returns true once every row is indexed.
 * Rows already indexed never change, so a table may draw them between calls.
 */
export function indexSome(rows: ReadingRows, budget: { readonly rows?: number; readonly until?: () => boolean } = {}): boolean {
  if (rows.indexed) return true;
  const limit = budget.rows ?? Number.POSITIVE_INFINITY;
  const { bytes } = rows;
  const n = bytes.length;
  if (rows.form === 'records') {
    let p = rows.pos;
    // A blank line is a step like a row, so a file of nothing else still gives the call back.
    let made = 0;
    while (p < n && made < limit) {
      if ((made & 1023) === 1023 && budget.until?.()) break;
      let e = bytes.indexOf(LF, p);
      if (e < 0) e = n;
      if (blankLine(bytes, p, e)) noteBlank(rows);
      else {
        rows.starts.push(p);
        rows.bad.push(0);
      }
      made++;
      p = Math.min(n, e + 1);
    }
    rows.pos = p;
    rows.indexed = p >= n;
    return rows.indexed;
  }
  // A scan that keeps no fields, made afresh each call: its arrays hold only this call's records.
  const scan = createScan(bytes, rows.delimiter, { fields: false });
  scan.pos = rows.pos;
  const header = rows.header!.start;
  // One more than asked when the header is among them, so `rows` data rows are indexed.
  scanSome(scan, { records: limit === Number.POSITIVE_INFINITY ? limit : limit + (rows.pos <= header ? 1 : 0), until: budget.until });
  const rec = scan.records;
  for (let i = 0; i < rec.start.length; i++) {
    const s = rec.start.data[i]!;
    if (s === header) continue;
    const bad = rec.kind.data[i] === RECORD_UNREADABLE ? 1 : 0;
    rows.starts.push(s);
    rows.bad.push(bad);
    rows.badRows += bad;
  }
  if (scan.widest > rows.widest) rows.widest = scan.widest;
  rows.pos = scan.pos;
  rows.indexed = scan.done;
  return rows.indexed;
}

/** Parses JSON Lines rows for their keys and whether they read, up to `budget`; true once every indexed row is parsed. */
export function parseSome(rows: ReadingRows, budget: { readonly rows?: number; readonly until?: () => boolean } = {}): boolean {
  if (rows.form !== 'records') return true;
  const limit = budget.rows ?? Number.POSITIVE_INFINITY;
  let made = 0;
  while (rows.parsed < rows.starts.length && made < limit) {
    if ((made & 255) === 255 && budget.until?.()) break;
    const r = rows.parsed;
    const record = recordAt(rows, r);
    if (record.node) {
      const start = rows.starts.data[r]!;
      for (const c of record.node.children ?? []) {
        if (c.key === null) continue;
        let at = rows.keyAt.get(c.key);
        if (at === undefined) {
          if (!rows.keys.take()) continue;
          at = rows.columns.length;
          rows.keyAt.set(c.key, at);
          rows.columns.push({ name: c.key, numeric: true, has: 0, first: start, end: start });
        }
        const column = rows.columns[at]!;
        column.has++;
        if (c.type !== 'number' && c.type !== 'null') column.numeric = false;
      }
    } else {
      rows.bad.data[r] = 1;
      rows.badRows++;
      if (record.cut > 0) rows.cutRows++;
    }
    rows.parsed++;
    made++;
  }
  return rows.parsed === rows.starts.length && rows.indexed;
}

/** The data row holding `byte`: the last starting at or before it; -1 before the first. */
export function rowAt(rows: ReadingRows, byte: number): number {
  const s = rows.starts.data;
  let lo = 0;
  let hi = rows.starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]! <= byte) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** A JSON Lines row's line: its range (to its line break, a `\r` before it included) and where its text ends (before the `\r`). */
function lineOf(rows: ReadingRows, r: number): { readonly start: number; readonly end: number; readonly textEnd: number } {
  const { bytes } = rows;
  const start = rows.starts.data[r]!;
  let end = bytes.indexOf(LF, start);
  if (end < 0) end = bytes.length;
  const textEnd = end > start && bytes[end - 1] === CR ? end - 1 : end;
  return { start, end, textEnd };
}

/** Records one more blank line, joining the run it continues. */
function noteBlank(rows: ReadingRows): void {
  const b = rows.blanks;
  const at = rows.starts.length;
  if (b.length > 0 && b.data[b.length - 2] === at) b.data[b.length - 1] = b.data[b.length - 1]! + 1;
  else {
    const total = b.length > 0 ? b.data[b.length - 1]! : 0;
    b.push(at);
    b.push(total + 1);
  }
}

/** A JSON Lines row's line number in the file: blank lines counted. */
function lineNumber(rows: ReadingRows, r: number): number {
  const b = rows.blanks.data;
  let lo = 0;
  let hi = rows.blanks.length >> 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid * 2]! <= r) lo = mid + 1;
    else hi = mid;
  }
  return r + 1 + (lo > 0 ? b[lo * 2 - 1]! : 0);
}

interface Record {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly node: TreeNode | null;
  readonly why: string;
  /** The record's bytes when it is past READING_MAX_RECORD and so not parsed; 0 otherwise. */
  readonly cut: number;
}

function recordAt(rows: ReadingRows, r: number): Record {
  const { start, end, textEnd } = lineOf(rows, r);
  const size = textEnd - start;
  if (!budget(READING_MAX_RECORD).take(size)) {
    // Only the head is decoded: the rest of the record is never read, whatever its size.
    const text = utf8.decode(rows.bytes.subarray(start, start + CUT_HEAD_BYTES));
    return { start, end, text, node: null, why: `record of ${byteSize(size)}, over ${byteSize(READING_MAX_RECORD)}, not read`, cut: size };
  }
  const text = utf8.decode(rows.bytes.subarray(start, textEnd));
  try {
    const node = parseJson(text);
    if (node.kind !== 'map') throw new TreeError('a record (an object)', 0);
    return { start, end, text, node, why: '', cut: 0 };
  } catch (error) {
    return { start, end, text, node: null, why: error instanceof TreeError ? error.message : 'not JSON', cut: 0 };
  }
}

/** A size as the page says it: `50.0 MB`, `1.0 MB`, `900 KB`. */
function byteSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** A record's cell: a value as it reads, unquoted; a short list of values inline; anything deeper as its count. */
function cellHtml(node: TreeNode): string {
  if (node.kind === 'scalar') {
    const v = esc(capText(node.value ?? ''));
    if (node.type === 'null') return '';
    if (node.type === 'bool') return `<span class="marxy-tree-literal">${v}</span>`;
    return v;
  }
  const kids = node.children ?? [];
  if (node.kind === 'list' && kids.length <= 6 && kids.every((k) => k.kind === 'scalar')) {
    return `<span class="marxy-tree-meta">[</span> ${kids.map((k) => esc(capText(k.value ?? ''))).join(', ')} <span class="marxy-tree-meta">]</span>`;
  }
  return `<span class="marxy-tree-meta">${node.kind === 'list' ? '[ ]' : '{ }'} ${countOf(node)}</span>`;
}

/** `cellHtml`'s text, as the reader sees it. */
function cellText(node: TreeNode): string {
  if (node.kind === 'scalar') return node.type === 'null' ? '' : (node.value ?? '');
  const kids = node.children ?? [];
  if (node.kind === 'list' && kids.length <= 6 && kids.every((k) => k.kind === 'scalar')) return `[ ${kids.map((k) => k.value ?? '').join(', ')} ]`;
  return `${node.kind === 'list' ? '[ ]' : '{ }'} ${countOf(node)}`;
}

function countOf(node: TreeNode): string {
  const n = node.children?.length ?? 0;
  return node.kind === 'list' ? plural(n, 'item') : plural(n, 'key');
}

/** The columns a row draws: the first READING_MAX_COLUMNS. */
export const drawnColumns = (rows: ReadingRows): readonly RowColumn[] => rows.columns.slice(0, READING_MAX_COLUMNS);

/** The header's cells: each sorts its column. */
export function headHtml(rows: ReadingRows): string {
  return drawnColumns(rows)
    .map((c, i) =>
      rows.form === 'table'
        ? `<th data-marxy-sort="${i}" tabindex="0" data-marxy-s="${c.first}" data-marxy-e="${c.end}">${esc(c.name)}</th>`
        : `<th data-marxy-sort="${i}" tabindex="0"${c.numeric ? ' class="marxy-num"' : ''}>${esc(c.name)}</th>`,
    )
    .join('');
}

/** One data row as the table draws it, carrying its bytes. */
export function rowHtml(rows: ReadingRows, r: number): string {
  const columns = drawnColumns(rows);
  if (rows.form === 'records') {
    const rec = recordAt(rows, r);
    const span = ` data-marxy-s="${rec.start}" data-marxy-e="${rec.end}"`;
    if (!rec.node) return `<tr class="marxy-records-bad"${span}><td colspan="${columns.length}">line ${lineNumber(rows, r)}: ${esc(rec.why)} · <code>${esc(rec.text.slice(0, 120))}</code></td></tr>`;
    const byKey = new Map<string | null, TreeNode>();
    for (const c of rec.node.children ?? []) byKey.set(c.key, c);
    return `<tr${span}>${columns
      .map((k) => {
        const cell = byKey.get(k.name);
        const num = k.numeric ? ' class="marxy-num"' : '';
        const value = cell?.kind === 'scalar' && cell.type !== 'null' ? ` data-marxy-value="${esc(capText(cell.value ?? ''))}"` : '';
        return `<td${num}${value}>${cell ? cellHtml(cell) : ''}</td>`;
      })
      .join('')}</tr>`;
  }
  const scan = readRecord(rows, rows.starts.data[r]!);
  const s = scan.records.start.data[0]!;
  const e = scan.records.end.data[0]!;
  const span = ` data-marxy-s="${s}" data-marxy-e="${e}"`;
  if (scan.records.kind.data[0] !== RECORD_ROW) {
    return `<tr class="marxy-records-bad"${span}><td colspan="${columns.length}">not read as fields · <code>${esc(utf8.decode(rows.bytes.subarray(s, Math.min(e, s + 160))))}</code></td></tr>`;
  }
  const [first, end] = fieldsOf(scan, 0);
  const cells: string[] = [];
  drawnValues(scan, first, Math.min(end, first + READING_MAX_COLUMNS)).forEach((value, i) => {
    const v = esc(value);
    cells.push(`<td${columns[i]?.numeric ? ' class="marxy-num"' : ''} data-marxy-value="${v}">${v}</td>`);
  });
  return `<tr${span}>${cells.join('')}</tr>`;
}

/** Rows `order[from..to)` as the table draws them. */
export function rowsHtml(rows: ReadingRows, order: ArrayLike<number> | null, from: number, to: number): string {
  const out: string[] = [];
  for (let i = from; i < to; i++) out.push(rowHtml(rows, order ? order[i]! : i));
  return out.join('');
}

/** A row's range in the file: from its first byte to the end of its record (the line break excluded). */
export function rowRange(rows: ReadingRows, r: number): { readonly start: number; readonly end: number } {
  if (rows.form === 'records') {
    const { start, end } = lineOf(rows, r);
    return { start, end };
  }
  const scan = readRecord(rows, rows.starts.data[r]!);
  return { start: scan.records.start.data[0]!, end: scan.records.end.data[0]! };
}

/**
 * One cell's value for sorting: null where the row has none, `undefined` for a row that does not read. A table's row
 * decodes only that field, which is most of what a sort of a million rows costs.
 */
export function cellValue(rows: ReadingRows, r: number, col: number): string | null | undefined {
  if (rows.form === 'records') {
    const cells = rowCells(rows, r);
    return cells.bad ? undefined : (cells.values[col] ?? null);
  }
  const scan = readRecord(rows, rows.starts.data[r]!);
  if (scan.records.kind.data[0] !== RECORD_ROW) return undefined;
  const [first, end] = fieldsOf(scan, 0);
  return first + col < end ? fieldValue(scan, first + col) : null;
}

/** What a row says, as the reader sees it, and each drawn cell's value for sorting (null where it has none). */
export interface RowCells {
  readonly bad: boolean;
  readonly texts: readonly string[];
  readonly values: readonly (string | null)[];
}

export function rowCells(rows: ReadingRows, r: number): RowCells {
  if (rows.form === 'records') {
    const rec = recordAt(rows, r);
    if (!rec.node) return { bad: true, texts: [`line ${lineNumber(rows, r)}: ${rec.why} · ${rec.text.slice(0, 120)}`], values: [] };
    const byKey = new Map<string | null, TreeNode>();
    for (const c of rec.node.children ?? []) byKey.set(c.key, c);
    const texts: string[] = [];
    const values: (string | null)[] = [];
    for (const k of drawnColumns(rows)) {
      const cell = byKey.get(k.name);
      texts.push(cell ? cellText(cell) : '');
      values.push(cell?.kind === 'scalar' && cell.type !== 'null' ? (cell.value ?? '') : null);
    }
    return { bad: false, texts, values };
  }
  const scan = readRecord(rows, rows.starts.data[r]!);
  const s = scan.records.start.data[0]!;
  const e = scan.records.end.data[0]!;
  if (scan.records.kind.data[0] !== RECORD_ROW) return { bad: true, texts: [`not read as fields · ${utf8.decode(rows.bytes.subarray(s, Math.min(e, s + 160)))}`], values: [] };
  const [first, end] = fieldsOf(scan, 0);
  const values = fieldValues(scan, first, Math.min(end, first + READING_MAX_COLUMNS));
  return { bad: false, texts: values, values };
}

// ---- passes over every row ----------------------------------------------------------------------------------------------

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Visits `order` (every row in file order when null) a slice of about `pace.budgetMs` at a time, giving the loop back
 * between slices. Resolves false when aborted.
 */
async function eachRow(rows: ReadingRows, order: ArrayLike<number> | null, visit: (r: number, i: number) => void, pace: Pace): Promise<boolean> {
  const now = pace.now ?? clock;
  const budget = pace.budgetMs ?? 8;
  const n = order ? order.length : rowCount(rows);
  let sliceStart = now();
  for (let i = 0; i < n; i++) {
    visit(order ? order[i]! : i, i);
    if ((i & 255) === 255 && now() - sliceStart >= budget) {
      pace.onSlice?.(i / n);
      await pace.yieldNow();
      if (pace.aborted?.()) return false;
      sliceStart = now();
    }
  }
  pace.onSlice?.(1);
  return true;
}

export type Nature = 'number' | 'date' | 'text';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const numberOf = (v: string): number => Number(v.replace(/[,%]/g, ''));

/**
 * A word's sort key: case and accents set aside, and a run of digits read as its number (`item 2` before `item 10`), by
 * its length then its digits. Compared as plain strings, which is a few times quicker over a million rows than a collator.
 */
export function textKey(value: string): string {
  // Plain ASCII has no accents to set aside: most cells, and the normalising is most of a key's cost.
  const plain = ASCII.test(value) ? value.toLowerCase() : value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  if (!DIGIT.test(plain)) return plain;
  return plain.replace(/\d+/g, (d) => {
    const t = d.replace(/^0+(?=\d)/, '');
    return `0${String.fromCharCode(0x30 + Math.min(t.length, 48))}${t}`;
  });
}

const ASCII = /^[\x00-\x7f]*$/;
const DIGIT = /\d/;

/** What a column's values are, for its sort: numbers, dates (ISO days), or words. Empty values are set aside. */
export function natureOf(values: Iterable<string | null>): Nature {
  let number = true;
  let date = true;
  let any = false;
  for (const v of values) {
    if (v === null || v.trim() === '') continue;
    any = true;
    if (number && !Number.isFinite(numberOf(v))) number = false;
    if (date && !ISO_DAY.test(v)) date = false;
    if (!number && !date) break;
  }
  if (!any) return 'text';
  return number ? 'number' : date ? 'date' : 'text';
}

/** Every row's key for one column: its nature, a number or a string per row, and its place (0 a value, 1 empty, 2 a row that does not read). */
export interface SortKeys {
  readonly col: number;
  readonly nature: Nature;
  readonly numbers: Float64Array | null;
  readonly texts: (string | null)[] | null;
  readonly place: Uint8Array;
}

/** Reads column `col` of every row for its sort. Resolves null when aborted. */
export async function sortKeys(rows: ReadingRows, col: number, pace: Pace): Promise<SortKeys | null> {
  const keys = startKeys(rows, col);
  return (await eachRow(rows, null, keys.visit, pace)) ? keys.done() : null;
}

/** `sortKeys` at once, for a table drawn whole: its sort is done before the click that asked returns. */
export function sortKeysNow(rows: ReadingRows, col: number): SortKeys {
  const keys = startKeys(rows, col);
  for (let r = 0; r < rowCount(rows); r++) keys.visit(r);
  return keys.done();
}

function startKeys(rows: ReadingRows, col: number): { visit: (r: number) => void; done: () => SortKeys } {
  const n = rowCount(rows);
  const raw: (string | null)[] = new Array(n).fill(null);
  const place = new Uint8Array(n);
  const visit = (r: number): void => {
    const v = cellValue(rows, r, col);
    if (v === undefined) {
      place[r] = 2;
      return;
    }
    if (v === null || v.trim() === '') place[r] = 1;
    else raw[r] = v;
  };
  const done = (): SortKeys => {
    const nature = natureOf(raw);
    if (nature === 'number') {
      const numbers = new Float64Array(n);
      for (let r = 0; r < n; r++) if (raw[r] !== null) numbers[r] = numberOf(raw[r]!);
      return { col, nature, numbers, texts: null, place };
    }
    if (nature === 'text') for (let r = 0; r < n; r++) if (raw[r] !== null) raw[r] = textKey(raw[r]!);
    return { col, nature, numbers: null, texts: raw, place };
  };
  return { visit, done };
}

/** Rows without a value after those with one, rows that do not read last, either way; else by key, high to low when `down`. */
function compareByKeys(keys: SortKeys, down: boolean): (a: number, b: number) => number {
  const { place, numbers, texts } = keys;
  const dir = down ? -1 : 1;
  return (a, b) => {
    const pa = place[a]!;
    const pb = place[b]!;
    if (pa !== pb || pa !== 0) return pa - pb;
    if (numbers) {
      const x = numbers[a]!;
      const y = numbers[b]!;
      return x < y ? -dir : x > y ? dir : 0;
    }
    const x = texts![a]!;
    const y = texts![b]!;
    return x < y ? -dir : x > y ? dir : 0;
  };
}

/** `order` sorted by `keys`, a slice at a time; ties keep their order. */
export function sortByKeys(keys: SortKeys, order: Int32Array, down: boolean, pace: Pace): Promise<Int32Array | null> {
  return sortSliced(order, compareByKeys(keys, down), pace);
}

/** `sortByKeys` at once (Array.prototype.sort is stable: ties keep their order). */
export function sortByKeysNow(keys: SortKeys, order: Int32Array, down: boolean): Int32Array {
  return Int32Array.from(Array.from(order).sort(compareByKeys(keys, down)));
}

/** Lower-cased words of `q`, each of which a row must hold somewhere in its cells. */
export const filterWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether a row holds every word, in any of its cells. */
export function rowHolds(rows: ReadingRows, r: number, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  // A table's cell is its bytes less quotes, so a word with no quote in it that is not in the row's bytes is in no cell:
  // one decode of the row turns most rows away without reading their fields.
  if (rows.form === 'table' && rows.bad.data[r] === 0 && words.every((w) => !w.includes('"'))) {
    const start = rows.starts.data[r]!;
    const next = r + 1 < rows.starts.length ? rows.starts.data[r + 1]! : rows.bytes.length;
    const raw = utf8.decode(rows.bytes.subarray(start, next)).toLowerCase();
    if (!words.every((w) => raw.includes(w))) return false;
  }
  const text = rowCells(rows, r).texts.join('\n').toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The rows of `order` that hold every word of `q`, in its order. Resolves null when aborted. */
export async function rowsHolding(rows: ReadingRows, order: ArrayLike<number> | null, q: string, pace: Pace): Promise<Int32Array | null> {
  const words = filterWords(q);
  const kept = new Ints(1024);
  const ok = await eachRow(rows, order, (r) => (rowHolds(rows, r, words) ? kept.push(r) : undefined), pace);
  return ok ? kept.data.slice(0, kept.length) : null;
}

/** Find's matches over rows: for each, its place in the view's order, the cell, and where in the cell's text it is. */
export interface RowMatches {
  /** The match's position in the order searched. */
  readonly at: Int32Array;
  readonly cell: Int32Array;
  readonly from: Int32Array;
  readonly to: Int32Array;
  readonly count: number;
}

/** Every match of `re` (global) in the cells of `order`'s rows, counted to `progress` as they are found. */
export async function findInRows(
  rows: ReadingRows,
  order: ArrayLike<number> | null,
  re: RegExp,
  pace: Pace,
  progress: (count: number) => void,
): Promise<RowMatches | null> {
  const at = new Ints();
  const cell = new Ints();
  const from = new Ints();
  const to = new Ints();
  const ok = await eachRow(
    rows,
    order,
    (r, i) => {
      const { texts } = rowCells(rows, r);
      for (let c = 0; c < texts.length; c++) {
        const text = texts[c]!;
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          at.push(i);
          cell.push(c);
          from.push(m.index);
          to.push(m.index + m[0].length);
        }
      }
    },
    { ...pace, onSlice: (f) => (pace.onSlice?.(f), progress(at.length)) },
  );
  if (!ok) return null;
  return { at: at.data.slice(0, at.length), cell: cell.data.slice(0, cell.length), from: from.data.slice(0, from.length), to: to.data.slice(0, to.length), count: at.length };
}

// ---- what the page says of the rows -------------------------------------------------------------------------------------

/** How many columns there are, as the page says it: past the key budget, more than were read. */
export const columnTotal = (rows: ReadingRows): string => (rows.keys.hit ? `more than ${figure(rows.keys.limit)}` : figure(rows.columns.length));
const keyCount = (rows: ReadingRows): string => (rows.keys.hit ? `more than ${figure(rows.keys.limit)} keys` : plural(rows.columns.length, 'key'));

/** JSON Lines' first line: its records, keys and lines that are not one, so far while it is still being read. */
export function recordsHeadText(rows: ReadingRows): string {
  const good = rows.parsed - rows.badRows;
  const settled = rowsSettled(rows);
  const notRecords = rows.badRows - rows.cutRows;
  return `JSON Lines · ${plural(good, 'record')}${settled ? '' : ' so far'} · ${keyCount(rows)}${notRecords > 0 ? ` · ${plural(notRecords, 'line')} not a record` : ''}${rows.cutRows > 0 ? ` · ${plural(rows.cutRows, 'record')} cut` : ''}`;
}

/** The line under a table still being read: how far through the file it is. Empty once every row is known. */
export function readingRowsNote(rows: ReadingRows): string {
  if (rowsSettled(rows)) return '';
  const share = rows.indexed ? rows.parsed / Math.max(1, rowCount(rows)) : rows.pos / Math.max(1, rows.bytes.length);
  return `Reading the rows · ${Math.floor(share * 100)}%`;
}
