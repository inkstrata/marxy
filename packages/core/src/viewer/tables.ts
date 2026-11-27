// The table page's words and shapes for a SQLite database
// and a spreadsheet: the line under the title, each part's line, a cell as it is drawn and as the Cell card says it, a
// number in the file's own format where that is cheap, the pager and the 2,000-row draw, the schema in groups, CSV.
// Pure: the desktop's viewers (`viewers/sqlite.ts`, `viewers/sheet.ts`) draw from these.
import { magicOf } from './bytes.ts';
import { shortSize } from './archive.ts';
import { guardFormula } from '../operations/copy-table.ts';
import { plural } from '../util/count.ts';

// Structural copies of shell-api's table types: core cannot import the shell.

/**
 * One value of a table page: a database's NULL, or a sheet's empty cell, is null. An integer comes as text so 64
 * bits arrive whole; a real that is not finite comes as `s`; text past the cap is cut and `more` says how many characters
 * were left out; a BLOB is its size. A sheet's `none` is a formula's cell with no saved value.
 */
export type TableValue =
  | null
  | { readonly k: 'int'; readonly v: string }
  | { readonly k: 'real'; readonly v?: number; readonly s?: string }
  | { readonly k: 'text'; readonly v: string; readonly more?: number }
  | { readonly k: 'blob'; readonly n: number }
  | { readonly k: 'bool'; readonly v: boolean }
  | { readonly k: 'err'; readonly v: string }
  | { readonly k: 'date'; readonly v: number; readonly iso: string }
  | { readonly k: 'iso'; readonly v: string }
  | { readonly k: 'none' };

export interface DbColumn {
  readonly name: string;
  /** The declared type, as the CREATE statement writes it; '' when none. */
  readonly decl: string;
  readonly key: boolean;
  /** The column is the rowid itself (an INTEGER PRIMARY KEY). */
  readonly rowid: boolean;
}

/** A table or a view: `internal` is SQLite's own (`sqlite_sequence`). */
export interface DbPart {
  readonly name: string;
  readonly kind: 'table' | 'view' | 'internal';
  /** Counted from its b-tree as the database opened; null for a view, or a count stopped at its cap. */
  readonly rows: number | null;
  readonly columns: readonly DbColumn[];
  readonly columnsMore: number;
  /** The page shows a rowid column of its own. */
  readonly rowid: boolean;
  /** WITHOUT ROWID: stored in key order. */
  readonly keyOrder: boolean;
  readonly sql: string | null;
}

export interface DbSummary {
  /** In place; in place with its log over the file; the file without its log (the reader's choice); a copy in memory. */
  readonly state: 'place' | 'wal' | 'alone' | 'copy';
  /**
   * Why a copy: another program holds it (`locked`), its log has no index SQLite could read without making one (`index`),
   * or it is an archive's entry held in memory, with no place on disk and nothing beside it (`entry`).
   */
  readonly copyWhy: 'locked' | 'index' | 'entry' | null;
  readonly header: {
    readonly pageSize: number;
    readonly pages: number;
    readonly freelist: number;
    readonly encoding: string;
    readonly journal: 'wal' | 'rollback';
    readonly userVersion: number;
    readonly applicationId: number;
    /** SQLITE_VERSION_NUMBER of the SQLite that last wrote it (3049001). */
    readonly writtenBy: number;
    readonly schemaFormat: number;
  };
  readonly wal: {
    readonly name: string;
    readonly bytes: number;
    readonly frames: number;
    readonly commits: number;
    /** Frames not yet copied back into the file, as the -shm says. */
    readonly pending: number | null;
    /** The log was read: its pages stand over the file's. */
    readonly read: boolean;
  } | null;
  readonly shm: string | null;
  readonly parts: readonly DbPart[];
  readonly schema: readonly { readonly kind: string; readonly name: string; readonly table: string; readonly sql: string | null }[];
  readonly schemaMore: boolean;
  /** The SQLite that reads it here. */
  readonly library: string;
  readonly size: number;
}

export interface SheetPart {
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'very';
  readonly kind: 'worksheet' | 'chart' | 'dialog' | 'macro' | 'vba';
  /** The last row and column with something in them, counted from A1. */
  readonly rows: number;
  readonly cols: number;
  readonly cells: number;
  readonly formulas: number;
  readonly merged: number;
  /** Said when the sheet was read only so far. */
  readonly cut: string | null;
}

export interface BookSummary {
  readonly format: 'xlsx' | 'xlsm' | 'xls' | 'ods';
  readonly sheets: readonly SheetPart[];
  /** Number formats as the file writes them; a cell's `x` names one. */
  readonly formats: readonly string[];
  /** The file's number formats were read: an xlsx's styles, an xls's FORMAT and XF records, an ods's data styles. */
  readonly formatsRead: boolean;
  readonly properties: {
    readonly application: string | null;
    readonly appVersion: string | null;
    readonly creator: string | null;
    readonly lastModifiedBy: string | null;
    readonly created: string | null;
    readonly modified: string | null;
    readonly title: string | null;
  };
  readonly macros: boolean;
  /** Other files the workbook links to, by the name it gives them: never opened. */
  readonly links: readonly string[];
  readonly parts: number | null;
  readonly compound: { readonly sector: number; readonly streams: readonly (readonly [string, number])[] } | null;
  readonly size: number;
}

/** What `tablesOpen` found: a database or a workbook. */
export interface TablesSummary {
  readonly kind: 'sqlite' | 'sheet';
  readonly db: DbSummary | null;
  readonly book: BookSummary | null;
}

/** A page of a database's rows, from row `from` (0-based) in stored order. */
export interface DbRowsPage {
  readonly from: number;
  readonly rows: readonly (readonly TableValue[])[];
  readonly rowids: readonly number[] | null;
  /** A view's column names, as its query names them. */
  readonly columns: readonly string[] | null;
  readonly total: number | null;
  /** Said when the query was stopped at its time cap. */
  readonly stopped: string | null;
}

export interface SheetCell {
  readonly v?: TableValue;
  /** The formula as written, without its `=`. */
  readonly f?: string;
  /** The index of its number format in `BookSummary.formats`. */
  readonly x?: number;
}

/** A sheet's rows `from` up to `to`: its cells `[row, column, cell]` 0-based from A1, and the merges that touch them. */
export interface SheetPage {
  readonly from: number;
  readonly to: number;
  readonly cells: readonly (readonly [number, number, SheetCell])[];
  readonly merges: readonly (readonly [number, number, number, number])[];
}

/** Rows of a database a page shows. */
export const DB_PAGE = 200;
/** Rows of a sheet drawn at a time. */
export const SHEET_DRAW = 2_000;
/** Characters of one value drawn; past it the value says how many more. */
export const TEXT_CAP = 2_000;
/** The most a BLOB opens into memory with, as an archive's entry does. */
export const BLOB_OPEN_CAP = 16 * 1024 * 1024;
/** Columns a page draws; past them it says how many more. */
export const COLUMNS_DRAWN = 100;

const n2 = (n: number): string => n.toLocaleString('en-GB');

// The app's sheet and SQLite viewers take their counts from here.
export { plural };

/** A sheet's column letters: 0 is A, 26 is AA. */
export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "F5" for row 4, column 5 (both 0-based). */
export const cellName = (r: number, c: number): string => `${colName(c)}${r + 1}`;

// ---- a database ------------------------------------------------------------------------------------------------------

/** "3.49.1" from SQLITE_VERSION_NUMBER 3049001. */
export function sqliteVersion(n: number): string {
  if (!n) return 'not said';
  return `${Math.floor(n / 1_000_000)}.${Math.floor(n / 1_000) % 1_000}.${n % 1_000}`;
}

/** The application id as hex, with its four bytes as text when they are letters: `0x54444D4B · "TDMK"`. */
export function applicationWords(id: number): string {
  if (!id) return 'not set';
  const u = id >>> 0;
  const hex = `0x${u.toString(16).toUpperCase().padStart(8, '0')}`;
  const text = [24, 16, 8, 0].map((s) => (u >>> s) & 0xff);
  return text.every((b) => b >= 0x20 && b < 0x7f) ? `${hex} · “${String.fromCharCode(...text)}”` : hex;
}

export interface DbCounts {
  readonly tables: DbPart[];
  readonly views: DbPart[];
  readonly internal: DbPart[];
  readonly indexes: number;
  readonly triggers: number;
}

export function dbCounts(db: DbSummary): DbCounts {
  return {
    tables: db.parts.filter((p) => p.kind === 'table'),
    views: db.parts.filter((p) => p.kind === 'view'),
    internal: db.parts.filter((p) => p.kind === 'internal'),
    indexes: db.schema.filter((e) => e.kind === 'index' && e.sql).length,
    triggers: db.schema.filter((e) => e.kind === 'trigger').length,
  };
}

/** "SQLite 3 · 4 tables, 2 views, 2 indexes, 1 trigger · 300.0 KB". How it is read is in `dbAccount`. */
export function dbLine(db: DbSummary): string {
  const c = dbCounts(db);
  const parts = `${plural(c.tables.length, 'table')}, ${plural(c.views.length, 'view')}, ${plural(c.indexes, 'index', 'indexes')}, ${plural(c.triggers, 'trigger')}`;
  return `SQLite 3 · ${parts} · ${shortSize(db.size)}`;
}

/** What the head says of how the database is read: a tier in grey, or nothing when it is read in place. */
export function dbHeadWords(db: DbSummary): string | null {
  if (db.state === 'wal') return 'With its WAL';
  if (db.state === 'alone') return 'The file alone · your choice';
  if (db.state === 'copy') return db.copyWhy === 'locked' ? 'A copy in memory · the file is locked' : 'A copy in memory';
  return null;
}

/** The line above the rows, in words, and the choice it offers. */
export function dbStateLine(db: DbSummary): { readonly text: string; readonly action: 'alone' | 'with' | null } | null {
  const wal = db.wal?.name ?? '';
  if (db.state === 'wal') {
    return {
      text: `Read with its write-ahead log, ${wal}, beside it, as SQLite reads it: the log's committed pages stand over the file's own. Nothing is checkpointed or written.`,
      action: 'alone',
    };
  }
  if (db.state === 'alone') return { text: `The file alone, as of its last checkpoint: ${wal} beside it is left unread, your choice.`, action: 'with' };
  if (db.state === 'copy' && db.copyWhy === 'entry') {
    return {
      text: 'An entry of an archive, read from its bytes held in memory: it has no place on disk and nothing beside it, and nothing is written.',
      action: null,
    };
  }
  if (db.state === 'copy' && db.copyWhy === 'locked') {
    return {
      text: 'Another program holds this database for itself alone, so it cannot be opened in place. It is read from a copy of its bytes taken into memory when it opened, and read again when the file changes. A write in progress may be missing.',
      action: null,
    };
  }
  if (db.state === 'copy') {
    const log = db.wal?.read ? `, with the committed pages of ${wal} laid over it` : '';
    return {
      text: `Read from a copy of its bytes in memory${log}: reading it in place would have SQLite make an index file beside it, and nothing here writes. It is read again when the file changes.`,
      action: null,
    };
  }
  return null;
}

/** The Database card's journal row. */
export function journalWords(db: DbSummary): string {
  if (db.header.journal !== 'wal') return 'rollback';
  const w = db.wal;
  if (!w) return 'WAL · no log beside it';
  const frames = `${plural(w.frames, 'frame')} in the log, ${plural(w.commits, 'commit')}`;
  const pending = w.pending === null ? '' : w.pending > 0 ? ', not checkpointed' : ', all checkpointed';
  return `WAL · ${frames}${pending}; ${w.read ? 'read' : 'not read, your choice'}`;
}

/** "table · 1,240 rows · 5 columns", "table, WITHOUT ROWID · …", "view · 186 rows · 3 columns". */
export function partWords(part: DbPart, total: number | null, columns: number): string {
  const kind = part.kind === 'view' ? 'view' : part.keyOrder ? 'table, WITHOUT ROWID' : part.kind === 'internal' ? 'SQLite’s own table' : 'table';
  const rows = total === null ? (part.kind === 'view' ? 'rows not counted yet' : 'rows not counted') : plural(total, 'row');
  return `${kind} · ${rows} · ${plural(columns, 'column')}`;
}

/** How the rows of `part` are shown: their order and what is cut. */
export function rowsFoot(part: DbPart): string {
  const order =
    part.kind === 'view'
      ? 'Rows are in the order the view’s query gives them'
      : part.keyOrder
        ? 'Rows are in key order, as a WITHOUT ROWID table stores them'
        : 'Rows are in the order they are stored, by rowid';
  return `${order}, ${n2(DB_PAGE)} at a time. They are never sorted, since sorting would mean reading the whole table. A BLOB is shown as its size; click it to see what it is. Text longer than ${n2(TEXT_CAP)} characters is cut, and says so.`;
}

/** The page's account (core reading/account.ts): how the database is opened, then how `part`'s rows are shown. */
export function dbAccount(part: DbPart | null): string[] {
  return [
    'Opened read-only: Marxy never writes to the database, checkpoints it or rolls it back, so no trigger ever fires.',
    part ? rowsFoot(part) : 'The schema is every CREATE statement in sqlite_master, as written.',
  ];
}

const NUMERIC = /INT|REAL|FLOA|DOUB|NUM|DEC|BOOL/i;
export const isNumericDecl = (decl: string): boolean => NUMERIC.test(decl);

/** A real as SQLite writes it: up to 15 significant digits, and always a point (5.0 is a REAL, 5 an INTEGER). */
export function realText(v: number): string {
  const s = String(Number(v.toPrecision(15)));
  return /[.eE]|Infinity|NaN/.test(s) ? s : `${s}.0`;
}

export interface CellShown {
  readonly text: string;
  readonly kind: 'null' | 'num' | 'text' | 'blob' | 'err' | 'none' | 'bool';
  /** Characters past the cut, for text. */
  readonly more?: number;
}

/** A database's value as its cell draws it. */
export function dbCell(v: TableValue): CellShown {
  if (v === null) return { text: 'NULL', kind: 'null' };
  switch (v.k) {
    case 'int':
      return { text: v.v, kind: 'num' };
    case 'real':
      return { text: v.v === undefined ? (v.s ?? '') : realText(v.v), kind: 'num' };
    case 'text':
      return { text: v.v, kind: 'text', more: v.more };
    case 'blob':
      return { text: `BLOB · ${shortSize(v.n)}`, kind: 'blob' };
    default:
      return { text: '', kind: 'text' };
  }
}

/** The type SQLite stored, which can differ from the declared one. */
export function storedAs(v: TableValue): string {
  if (v === null) return 'NULL';
  return ({ int: 'INTEGER', real: 'REAL', text: 'TEXT', blob: 'BLOB' } as Record<string, string>)[v.k] ?? v.k;
}

/** Whether a value's stored type is not what its column declares (text in an INTEGER column). */
export function notDeclared(v: TableValue, decl: string): boolean {
  if (v === null || !decl) return false;
  if (v.k === 'text') return NUMERIC.test(decl);
  if (v.k === 'int' || v.k === 'real') return /CHAR|CLOB|TEXT/i.test(decl);
  return false;
}

/** The pager's words and steps: "Rows 201 to 400 of 1,240", with Earlier and Later where there are rows to step to. */
export function pager(from: number, shown: number, total: number | null, per = DB_PAGE): { readonly label: string; readonly earlier: number | null; readonly later: number | null } {
  const to = from + shown;
  const label = shown === 0 ? (total === 0 ? 'No rows' : `No rows from ${n2(from + 1)}`) : `Rows ${n2(from + 1)} to ${n2(to)}${total === null ? '' : ` of ${n2(total)}`}`;
  const more = total === null ? shown === per : to < total;
  return { label, earlier: from > 0 ? Math.max(0, from - per) : null, later: more ? to : null };
}

/** The 0-based row a "Go to row" answer names, or null when it names none: "1,240", "1240". */
export function goToRow(text: string, total: number | null): number | null {
  const n = Number(text.replace(/[\s,_]/g, ''));
  if (!Number.isInteger(n) || n < 1) return null;
  if (total !== null && n > total) return null;
  return n - 1;
}

export interface SchemaGroup {
  readonly label: string;
  readonly note: string | null;
  readonly entries: DbSummary['schema'];
}

/** The schema page's groups, each statement as sqlite_master holds it. */
export function schemaGroups(db: DbSummary): SchemaGroup[] {
  const of = (kind: string) => db.schema.filter((e) => e.kind === kind);
  const groups: SchemaGroup[] = [
    { label: 'Tables', note: null, entries: of('table') },
    { label: 'Views', note: null, entries: of('view') },
    { label: 'Indexes', note: null, entries: of('index') },
    { label: 'Triggers', note: 'A trigger runs only when something writes, and nothing here writes: these never run.', entries: of('trigger') },
  ];
  return groups.filter((g) => g.entries.length > 0);
}

/** The schema as Export writes it: every CREATE statement, in sqlite_master's order. */
export function schemaText(db: DbSummary): string {
  const lines = db.schema.filter((e) => e.sql).map((e) => `${e.sql!.trim().replace(/;\s*$/, '')};`);
  return `${lines.join('\n\n')}\n`;
}

const SQL_WORDS = new Set(
  ('ABORT ACTION ADD AFTER ALL ALTER ALWAYS AND AS ASC AUTOINCREMENT BEFORE BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE ' +
    'COLUMN CONFLICT CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DEFAULT DEFERRABLE DEFERRED DELETE DESC ' +
    'DISTINCT DO DROP EACH ELSE END ESCAPE EXCEPT EXISTS FAIL FILTER FOR FOREIGN FROM FULL GENERATED GLOB GROUP HAVING IF IGNORE ' +
    'IMMEDIATE IN INDEX INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LEFT LIKE LIMIT MATCH NATURAL NO NOT ' +
    'NOTNULL NULL OF OFFSET ON OR ORDER OUTER OVER PARTITION PRIMARY RAISE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME ' +
    'REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWID SELECT SET STORED STRICT TABLE TEMP TEMPORARY THEN TO TRIGGER UNION ' +
    'UNIQUE UPDATE USING VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT').split(' '),
);

export interface SqlToken {
  readonly text: string;
  readonly kind: 'kw' | 'str' | 'num' | 'com' | 'plain';
}

/** A statement in pieces for colour: keywords, strings, numbers and comments; everything else as written. */
export function sqlTokens(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  const re = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;
  let m: RegExpExecArray | null;
  const push = (text: string, kind: SqlToken['kind']): void => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') out[out.length - 1] = { text: last.text + text, kind };
    else out.push({ text, kind });
  };
  while ((m = re.exec(sql))) {
    if (m[1]) push(m[1], 'com');
    else if (m[2]) push(m[2], 'str');
    else if (m[4]) push(m[4], 'num');
    else if (m[5]) push(m[5], SQL_WORDS.has(m[5].toUpperCase()) ? 'kw' : 'plain');
    else push(m[0], 'plain');
  }
  return out;
}

/** Bits a byte over `bytes` (8 is evenly spread over all 256 values, as encrypted or compressed data is). */
export function entropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Array<number>(256).fill(0);
  for (const b of bytes) counts[b]!++;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const DB_NAME = /\.(db|sqlite3?|db3)$/i;

/**
 * Why a file named as a database is probably an encrypted one, in plain words, or null when its bytes do not say so: no
 * SQLite header, and bytes spread evenly over all 256 values.
 */
export function encryptedWhy(name: string, head: Uint8Array): string[] | null {
  if (!DB_NAME.test(name) || head.length < 1024) return null;
  if (new TextDecoder().decode(head.subarray(0, 16)) === 'SQLite format 3\0') return null;
  const bits = entropy(head);
  if (bits < 7.5) return null;
  const ext = /\.([^.]+)$/.exec(name)?.[1] ?? 'db';
  const hex = [...head.subarray(0, 16)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return [
    `The name says .${ext}, a database, but its first bytes, ${hex}, are not SQLite's header.`,
    `Its bytes are spread evenly over all 256 values (${bits.toFixed(2)} bits a byte, of 8), as encrypted data is. SQLCipher and its kind write nothing in the clear.`,
    'The app does not ask for database keys, so it shows the bytes.',
  ];
}

const be32 = (u: Uint8Array, at: number): number => ((u[at]! << 24) | (u[at + 1]! << 16) | (u[at + 2]! << 8) | u[at + 3]!) >>> 0;

/** What a BLOB seems to be from its first bytes, and the extension it opens under. */
export function blobSeems(head: Uint8Array): { readonly what: string; readonly ext: string } {
  const magic = magicOf(head);
  if (magic?.format === 'PNG' && head.length >= 24) return { what: `a PNG image, ${n2(be32(head, 16))} × ${n2(be32(head, 20))}`, ext: 'png' };
  const known: Record<string, [string, string]> = {
    JPEG: ['a JPEG image', 'jpg'], GIF: ['a GIF image', 'gif'], WebP: ['a WebP image', 'webp'], PDF: ['a PDF', 'pdf'], 'a zip archive': ['a zip', 'zip'],
    gzip: ['gzip data', 'gz'], 'an SQLite database': ['a SQLite database', 'sqlite'], BMP: ['a BMP image', 'bmp'], TIFF: ['a TIFF image', 'tif'],
  };
  const hit = magic ? known[magic.format] : undefined;
  if (hit) return { what: hit[0], ext: hit[1] };
  let printable = 0;
  for (const b of head) if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b !== 0x7f)) printable++;
  if (head.length > 0 && printable === head.length && !head.includes(0)) return { what: 'text', ext: 'txt' };
  return { what: 'bytes the app has no reading for', ext: 'bin' };
}

// ---- CSV ---------------------------------------------------------------------------------------------------------------

// A cell a spreadsheet would run as a formula gets a leading `'` (`guardFormula`); a plain number is left alone.
const csvField = (cell: string): string => {
  const s = guardFormula(cell);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180: a header line, then a line a row, CRLF between. */
export function csvOf(header: readonly string[] | null, rows: Iterable<readonly string[]>): string {
  const lines: string[] = [];
  if (header) lines.push(header.map(csvField).join(','));
  for (const r of rows) lines.push(r.map(csvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** A database value in a CSV field: as stored, a BLOB as its size (its bytes are Export's "the database, as it is"). */
export function dbCsvValue(v: TableValue): string {
  if (v === null) return '';
  switch (v.k) {
    case 'int':
      return v.v;
    case 'real':
      return v.v === undefined ? (v.s ?? '') : String(v.v);
    case 'text':
      return v.v;
    case 'blob':
      return `[BLOB, ${v.n} bytes]`;
    default:
      return '';
  }
}

// ---- a workbook ------------------------------------------------------------------------------------------------------

const BOOK_LABELS: Readonly<Record<BookSummary['format'], string>> = {
  xlsx: 'Excel workbook',
  xlsm: 'Excel workbook with macros',
  xls: 'Excel 97 to 2003 workbook',
  ods: 'OpenDocument spreadsheet',
};

export const bookLabel = (book: BookSummary): string => BOOK_LABELS[book.format] ?? book.format;

/** "Excel workbook · 5 sheets, 2 of them hidden". How its values are shown is in `bookAccount`. */
export function bookLine(book: BookSummary): string {
  const hidden = book.sheets.filter((s) => s.state !== 'visible').length;
  return `${bookLabel(book)} · ${plural(book.sheets.length, 'sheet')}${hidden ? `, ${hidden} of them hidden` : ''}`;
}

/** The page's account (core reading/account.ts): where the values come from, what Formulas shows, what is never done. */
export function bookAccount(formulas: boolean): string[] {
  return [
    'Each value is the one saved in the file, worked out by the app that last saved it. Marxy recalculates nothing, and no cell can be changed here.',
    formulas
      ? 'Formulas is on: a cell with a formula shows it as written; every other cell shows its value.'
      : 'A cell with a formula has a mark in its corner; Formulas shows them as written. Macros never run, and links to other files are never followed.',
    'Numbers and dates are shown in the workbook’s own formats where Marxy reads them, so a shown value may be rounded. Fractions, conditional and elapsed-time formats are shown as General.',
    'Hidden sheets are listed in the bar, marked.',
  ];
}

export const hiddenWords = (s: SheetPart): string | null => (s.state === 'hidden' ? 'hidden' : s.state === 'very' ? 'very hidden' : null);

/** "Summary · 17 rows, 7 columns · 37 formulas · 3 merged ranges"; a hidden sheet's says it is hidden in the workbook. */
export function sheetWords(s: SheetPart): string {
  const hidden = hiddenWords(s);
  const bits = [s.name];
  if (hidden) bits.push(`${hidden} in the workbook`);
  if (s.kind !== 'worksheet') bits.push(`a ${s.kind} sheet: it holds no cells to read here`);
  else bits.push(`${plural(s.rows, 'row')}, ${plural(s.cols, 'column')}`);
  if (s.formulas) bits.push(plural(s.formulas, 'formula'));
  if (s.merged) bits.push(plural(s.merged, 'merged range'));
  return bits.join(' · ');
}

/** The line after a draw that is not the whole sheet, and its steps. */
export function drawCap(from: number, rows: number, per = SHEET_DRAW): { readonly text: string; readonly next: [number, number] | null; readonly back: [number, number] | null } | null {
  const to = Math.min(rows, from + per);
  if (rows <= per && from === 0) return null;
  const text = from === 0 ? `The first ${n2(per)} of ${n2(rows)} rows are drawn, as the table page draws.` : `Rows ${n2(from + 1)} to ${n2(to)} of ${n2(rows)} are drawn.`;
  return {
    text,
    next: to < rows ? [to, Math.min(rows, to + per)] : null,
    back: from > 0 ? [Math.max(0, from - per), from] : null,
  };
}

// Number formats, where cheap: percent, fixed decimals, thousands, scientific, and dates and times. A format with a
// condition, a fraction or an elapsed time is not applied, and the Cell card says so.

/** Excel's builtin short date (id 14) as calamine names it; it is the reader's locale in Excel, here ISO. */
const LOCALE_DATE = 'mm-dd-yy';

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && i + 1 < code.length) {
      cur += ch + code[++i];
      continue;
    }
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The code with its quoted and escaped literals and its brackets taken out, for telling what kind it is. */
const bare = (code: string): string => code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');

export const isDateCode = (code: string): boolean => code === LOCALE_DATE || /[ymdhs]/i.test(bare(splitSections(code)[0] ?? '').replace(/[eE][+-]/g, ''));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Clock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function clockOf(v: TableValue): Clock | null {
  if (v && v.k === 'date') {
    const m = /^(-?\d+)-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(v.iso);
    if (m) return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]! };
  }
  if (v && v.k === 'real' && v.v !== undefined) {
    // The 1900 date system; a workbook on 1904 dates has its date cells as dates already.
    const ms = Math.round((v.v - 25_569) * 86_400_000);
    const t = new Date(ms);
    if (Number.isNaN(t.getTime())) return null;
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
  }
  return null;
}

function formatDate(c: Clock, code: string): string | null {
  if (code === LOCALE_DATE) return `${String(c.y).padStart(4, '0')}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
  if (/\[h+\]|\[m+\]|\[s+\]/i.test(code)) return null;
  const ampm = /AM\/PM|A\/P/i.test(code);
  const tokens = code.match(/"[^"]*"|\\.|\[[^\]]*\]|AM\/PM|A\/P|y+|m+|d+|h+|s+|\.0+|[^"\\[ymdhsAa]+|./gi) ?? [];
  let out = '';
  const two = (n: number): string => String(n).padStart(2, '0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lower = t.toLowerCase();
    if (t.startsWith('"')) out += t.slice(1, -1);
    else if (t.startsWith('\\')) out += t.slice(1);
    else if (t.startsWith('[')) continue;
    else if (/^am\/pm$/i.test(t)) out += c.h < 12 ? 'AM' : 'PM';
    else if (/^a\/p$/i.test(t)) out += c.h < 12 ? 'A' : 'P';
    else if (lower[0] === 'y') out += lower.length <= 2 ? two(c.y % 100) : String(c.y).padStart(4, '0');
    else if (lower[0] === 'd') out += lower.length === 1 ? String(c.d) : lower.length === 2 ? two(c.d) : lower.length === 3 ? DAYS[new Date(Date.UTC(c.y, c.mo - 1, c.d)).getUTCDay()]!.slice(0, 3) : DAYS[new Date(Date.UTC(c.y, c.mo - 1, c.d)).getUTCDay()]!;
    else if (lower[0] === 'h') {
      const h = ampm ? ((c.h + 11) % 12) + 1 : c.h;
      out += lower.length === 1 ? String(h) : two(h);
    } else if (lower[0] === 's') out += lower.length === 1 ? String(c.s) : two(c.s);
    else if (lower.startsWith('.0')) out += `.${'0'.repeat(lower.length - 1)}`;
    else if (lower[0] === 'm') {
      // Minutes after an hour or before a second; a month otherwise.
      const before = tokens.slice(0, i).reverse().find((x) => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x));
      const after = tokens.slice(i + 1).find((x) => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x));
      const minute = (before && /^h/i.test(before)) || (after && /^s/i.test(after));
      if (minute) out += lower.length === 1 ? String(c.mi) : two(c.mi);
      else out += lower.length === 1 ? String(c.mo) : lower.length === 2 ? two(c.mo) : lower.length === 3 ? MONTHS[c.mo - 1]!.slice(0, 3) : lower.length === 5 ? MONTHS[c.mo - 1]![0]! : MONTHS[c.mo - 1]!;
    } else out += t;
  }
  return out;
}

// Excel's own limits: a format code is at most 255 characters and a number shows at most 30 decimals.
const MAX_FORMAT_CODE = 255;
const MAX_DECIMALS = 30;
const MAX_MIN_INT = 30;

function formatNumber(v: number, code: string): string | null {
  if (code.length > MAX_FORMAT_CODE) return null;
  const sections = splitSections(code);
  let section = sections[0]!;
  let x = v;
  if (v < 0 && sections.length > 1) {
    section = sections[1]!;
    x = -v;
  } else if (v === 0 && sections.length > 2) section = sections[2]!;
  if (/\[[<>=]/.test(section) || /\?\/|#\/|\/\?/.test(bare(section))) return null;
  if (bare(section).trim() === '@') return null;
  // Literals kept, in order: quoted text, escaped characters and the plain ones around the number.
  const lit = section.replace(/\[\$([^\]-]*)[^\]]*\]/g, '"$1"').replace(/\[[^\]]*\]/g, '').replace(/_./g, ' ').replace(/\*./g, '');
  const body = bare(lit);
  const first = body.search(/[0#?]/);
  if (first < 0) return lit.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const pct = (body.match(/%/g) ?? []).length;
  x *= 100 ** pct;
  const numPart = /[0#?][0#?,.]*(?:[eE][+-][0#?]+)?/.exec(body)?.[0] ?? '0';
  const [intPart = '', decPart = ''] = numPart.replace(/[eE][+-].*$/, '').split('.');
  const decimals = Math.min((decPart.match(/[0#?]/g) ?? []).length, MAX_DECIMALS);
  const minInt = Math.min((intPart.match(/0/g) ?? []).length, MAX_MIN_INT);
  const grouped = /[0#?],[0#?]/.test(intPart);
  let digits: string;
  const sci = /[eE][+-]/.exec(numPart);
  if (sci) {
    const expDigits = (numPart.slice(sci.index + 2).match(/0/g) ?? []).length || 1;
    const [m, e] = x.toExponential(decimals).split('e');
    const en = Number(e);
    digits = `${m}E${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(expDigits, '0')}`;
  } else {
    const fixed = x.toFixed(decimals);
    let [i = '0', d] = fixed.split('.');
    const neg = i.startsWith('-');
    if (neg) i = i.slice(1);
    if (minInt === 0 && i === '0' && decimals > 0) i = '';
    i = i.padStart(minInt, '0');
    if (grouped) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    digits = `${neg ? '-' : ''}${i}${d !== undefined ? `.${d}` : ''}`;
  }
  // Put the digits where the number stood among the literals.
  const start = lit.search(/[0#?]/);
  const tail = lit.slice(start).replace(/^[0#?,.]*(?:[eE][+-][0#?]+)?/, '');
  const head = lit.slice(0, start);
  const unq = (s: string): string => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const sign = v < 0 && sections.length === 1 && !digits.startsWith('-') ? '-' : '';
  return `${unq(head)}${sign}${digits}${unq(tail)}`;
}

/** A number in Excel's General format: up to 11 significant digits. */
export function generalNumber(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    const [m, e] = v.toExponential(5).split('e');
    const en = Number(e);
    return `${String(Number(m))}E${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
  }
  return String(Number(v.toPrecision(11)));
}

export interface SheetShown {
  readonly text: string;
  readonly kind: CellShown['kind'] | 'date';
  /** The file's format, applied; false when the cell has one this page does not apply (it is shown as General). */
  readonly applied: boolean;
  readonly more?: number;
}

/** A sheet's cell as saved, in its own format where that is cheap. */
export function sheetValue(cell: SheetCell | undefined, formats: readonly string[]): SheetShown {
  try {
    return sheetValueIn(cell, formats);
  } catch {
    // A format code the file wrote must not stop the grid drawing: this one cell falls back to its General text.
    return sheetValueIn(cell, []);
  }
}

function sheetValueIn(cell: SheetCell | undefined, formats: readonly string[]): SheetShown {
  const v = cell?.v ?? null;
  const code = cell?.x === undefined ? null : (formats[cell.x] ?? null);
  if (v === null) return { text: '', kind: 'null', applied: true };
  switch (v.k) {
    case 'none':
      return { text: 'no saved value', kind: 'none', applied: true };
    case 'text':
      return { text: v.v, kind: 'text', applied: true, more: v.more };
    case 'bool':
      return { text: v.v ? 'TRUE' : 'FALSE', kind: 'bool', applied: true };
    case 'err':
      return { text: v.v, kind: 'err', applied: true };
    case 'iso':
      return { text: v.v.replace('T', ' '), kind: 'date', applied: true };
    case 'date': {
      const c = clockOf(v)!;
      const usable = code && isDateCode(code) ? formatDate(c, code) : null;
      if (usable !== null) return { text: usable, kind: 'date', applied: true };
      const plain = c.h || c.mi || c.s ? formatDate(c, 'yyyy-mm-dd hh:mm') : formatDate(c, 'yyyy-mm-dd');
      return { text: plain ?? v.iso, kind: 'date', applied: code === null };
    }
    case 'int':
    case 'real': {
      const n = v.k === 'int' ? Number(v.v) : v.v;
      if (n === undefined) return { text: v.k === 'real' ? (v.s ?? '') : '', kind: 'num', applied: true };
      if (!code) return { text: generalNumber(n), kind: 'num', applied: true };
      if (isDateCode(code)) {
        const c = clockOf({ k: 'real', v: n });
        const text = c ? formatDate(c, code) : null;
        return text === null ? { text: generalNumber(n), kind: 'num', applied: false } : { text, kind: 'date', applied: true };
      }
      const text = formatNumber(n, code);
      return text === null ? { text: generalNumber(n), kind: 'num', applied: false } : { text, kind: 'num', applied: true };
    }
    default:
      return { text: '', kind: 'text', applied: true };
  }
}

/** What the Cell card names the type saved. */
export function savedType(cell: SheetCell | undefined): string {
  const v = cell?.v ?? null;
  if (v === null) return 'empty';
  return ({ int: 'a number', real: 'a number', text: 'text', bool: 'true or false', err: 'an error', date: 'a date', iso: 'a date or a time', none: 'nothing saved', blob: 'bytes' } as Record<string, string>)[v.k] ?? v.k;
}

/** A sheet's value in a CSV field: what it shows. */
export const sheetCsvValue = (cell: SheetCell | undefined, formats: readonly string[]): string => {
  const s = sheetValue(cell, formats);
  return s.kind === 'none' ? '' : s.text;
};

export interface GridCell {
  readonly c: number;
  readonly cell?: SheetCell;
  /** A merged range's first cell: how many rows and columns it spans. */
  readonly span?: { readonly rows: number; readonly cols: number };
  readonly merged?: string;
}

export interface GridRow {
  readonly r: number;
  readonly cells: readonly GridCell[];
}

/**
 * The rows `from` to `to` of a page laid out for the grid: every column up to `cols`, merged ranges drawn as one cell
 * (the cells they cover left out), cells in row order.
 */
export function sheetGrid(page: SheetPage, cols: number): GridRow[] {
  const byRow = new Map<number, Map<number, SheetCell>>();
  for (const [r, c, cell] of page.cells) {
    if (c >= cols) continue;
    let row = byRow.get(r);
    if (!row) byRow.set(r, (row = new Map()));
    row.set(c, cell);
  }
  const starts = new Map<string, readonly [number, number, number, number, number]>();
  const covered = new Set<string>();
  for (const m of page.merges) {
    const [r0, c0, r1, c1] = m;
    // A range that starts above this draw still covers its cells here; its first cell is drawn at the draw's first row.
    const top = Math.max(r0, page.from);
    starts.set(`${top}:${c0}`, [top, c0, r1, c1, r0]);
    for (let r = top; r <= Math.min(r1, page.to - 1); r++) for (let c = c0; c <= Math.min(c1, cols - 1); c++) if (r !== top || c !== c0) covered.add(`${r}:${c}`);
  }
  const rows: GridRow[] = [];
  for (let r = page.from; r < page.to; r++) {
    const cells: GridCell[] = [];
    const row = byRow.get(r);
    for (let c = 0; c < cols; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const m = starts.get(`${r}:${c}`);
      const cell = row?.get(c);
      if (m) {
        const span = { rows: Math.min(m[2], page.to - 1) - m[0] + 1, cols: Math.min(m[3], cols - 1) - m[1] + 1 };
        cells.push({ c, cell, span, merged: `${cellName(m[4], m[1])}:${cellName(m[2], m[3])}` });
      } else cells.push({ c, cell });
    }
    rows.push({ r, cells });
  }
  return rows;
}
