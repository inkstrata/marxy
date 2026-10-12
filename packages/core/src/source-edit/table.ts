// Table tools for the Source editor (V-02): with the caret in a GFM table, align its columns, add a row, add a
// column, sort the body rows, or read it as CSV. Pure: the editor's text and a caret offset in, one splice
// (and the caret's new place) or null out; never the DOM.
//
// Safety, in the order it is enforced:
//  1. The table is the parse's: the byte span of the `table` node holding the caret. Not a regex over lines.
//     A table in a code fence, an indented block or an HTML block is not a table to the parse, so a caret
//     there finds none and every tool answers null.
//  2. The row and cell structure this file reads (`splitRows`) must agree with the parse's, row for row and
//     cell for cell, or the tool refuses (null). A pipe is a separator unless a backslash escapes it, which
//     is GFM's rule and the parse's: a pipe inside a code span still splits a cell unless it is written `\|`.
//  3. The edit is built as splices inside the table's span only, so every byte outside it is the old byte.
//     CRLF, CR and mixed endings are kept because a row's ending is never rebuilt: a moved row keeps the
//     ending its place had, a new row copies the ending of the row it follows. A container prefix (`> `,
//     the indentation of a list item) is copied from the delimiter row onto each new row.
//  4. The result is parsed again and must say what the edit meant (`checked`): the same table at the same
//     place with the same cells, plus or minus the row or column that was asked for. If it does not, null.
//
// Offsets are UTF-16 indexes into the text as the editor holds it (no byte-order mark: the editor's text has
// none, so a text that starts with one is refused). The parse counts bytes; they are converted at the seam.
// Lines are as the parse sees them (CRLF, CR and LF each end one), so a mixed-ending file's "\r\n" is one
// ending and its lone CR is another.

import type { Document, Node, Table } from '../contracts/ast.ts';
import { byteOffsets, type ByteOffsets } from '../parse/byte-offsets.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { reparseMarkdown } from '../parse/reparse.ts';
import { alignTablePipes } from '../operations/align-table-pipes.ts';
import { csvOf } from '../operations/copy-table.ts';
import { inlinePlainText } from '../operations/inline-text.ts';
import { cellGrid } from '../operations/table-cells.ts';
import { compareBytes, type LineEdit, type TextSplice } from './lines.ts';

// ---- the table under the caret -------------------------------------------------------------------------

interface Located {
  readonly doc: Document;
  readonly table: Table;
  /** How many block quotes hold the table: each puts one `>` in front of every row after the first. */
  readonly quotes: number;
  /** The table's span as indexes: the first byte of its first row to the last byte of its last row, before any ending. */
  readonly from: number;
  readonly to: number;
}

function indexOfByte(offsets: ByteOffsets, length: number, byte: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (offsets.at(mid) < byte) low = mid + 1;
    else high = mid;
  }
  return low;
}

const childrenOf = (node: Node): readonly Node[] => (node as { children?: readonly Node[] }).children ?? [];

/** The table that holds `caret` (a position from its first byte to its last), or null. */
function locate(text: string, caret: number): Located | null {
  if (text.length === 0 || text.charCodeAt(0) === 0xfeff || caret < 0 || caret > text.length) return null;
  const doc = parseMarkdown(text);
  const offsets = byteOffsets(text);
  const at = offsets.at(caret);
  let found: { table: Table; quotes: number } | null = null;
  const walk = (node: Node, quotes: number): void => {
    for (const child of childrenOf(node)) {
      if (found || child.src.start > at || child.src.end < at) continue;
      if (child.type === 'table') found = { table: child as Table, quotes };
      else walk(child, quotes + (child.type === 'blockquote' ? 1 : 0));
    }
  };
  walk(doc, 0);
  if (!found) return null;
  const { table, quotes } = found as { table: Table; quotes: number };
  return { doc, table, quotes, from: indexOfByte(offsets, text.length, table.src.start), to: indexOfByte(offsets, text.length, table.src.end) };
}

// ---- rows and cells, as bytes of the text ----------------------------------------------------------------

interface Cell {
  /** The raw text between its two pipes (or the line's edge), spaces included. */
  readonly from: number;
  readonly to: number;
  /** The same without the spaces and tabs GFM trims. */
  readonly trimFrom: number;
  readonly trimTo: number;
  /** The index of the pipe that ends this cell, or null for the last cell of a row with no closing pipe. */
  readonly pipeAfter: number | null;
}

interface Row {
  /** The line's first index: the prefix is `[start, contentFrom)`. */
  readonly start: number;
  /** Where the row itself begins, after a container's prefix. */
  readonly contentFrom: number;
  /** The end of the row, before its line ending. */
  readonly to: number;
  /** The line ending that follows this row, or '' for the table's last row. */
  readonly ending: string;
  readonly cells: readonly Cell[];
  readonly leading: boolean;
  readonly trailing: boolean;
}

const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** The prefix of a row after the first: indentation, and one `>` for each enclosing block quote, with the spaces after it. */
function prefixLength(line: string, quotes: number): number {
  let i = 0;
  while (isBlank(line[i])) i++;
  for (let q = 0; q < quotes && line[i] === '>'; q++) {
    i++;
    while (isBlank(line[i])) i++;
  }
  return i;
}

function splitRow(text: string, start: number, contentFrom: number, to: number, ending: string): Row {
  const pipes: number[] = [];
  for (let i = contentFrom; i < to; i++) {
    // A backslash escapes the character after it, so `\\|` is an escaped backslash and then a pipe.
    if (text[i] === '\\' && i + 1 < to) i++;
    else if (text[i] === '|') pipes.push(i);
  }
  let first = contentFrom;
  while (first < to && isBlank(text[first])) first++;
  let last = to;
  while (last > first && isBlank(text[last - 1])) last--;
  const leading = pipes.length > 0 && pipes[0] === first;
  // A lone pipe is a leading one and not also a closing one.
  const trailing = pipes.length > (leading ? 1 : 0) && pipes[pipes.length - 1] === last - 1;
  const cells: Cell[] = [];
  for (let j = 0; j <= pipes.length; j++) {
    if ((j === 0 && leading) || (j === pipes.length && trailing)) continue;
    const from = j === 0 ? contentFrom : pipes[j - 1]! + 1;
    const end = j === pipes.length ? to : pipes[j]!;
    let trimFrom = from;
    while (trimFrom < end && isBlank(text[trimFrom])) trimFrom++;
    let trimTo = end;
    while (trimTo > trimFrom && isBlank(text[trimTo - 1])) trimTo--;
    cells.push({ from, to: end, trimFrom, trimTo, pipeAfter: j < pipes.length ? pipes[j]! : null });
  }
  return { start, contentFrom, to, ending, cells, leading, trailing };
}

/** The rows of the span `[from, to)`: one per line. */
function splitRows(text: string, from: number, to: number, quotes: number): Row[] {
  const rows: Row[] = [];
  let at = from;
  for (;;) {
    let end = at;
    while (end < to && text[end] !== '\n' && text[end] !== '\r') end++;
    const ending = end >= to ? '' : text[end] === '\r' && text[end + 1] === '\n' ? '\r\n' : text[end]!;
    const contentFrom = rows.length === 0 ? at : at + prefixLength(text.slice(at, end), quotes);
    rows.push(splitRow(text, at, contentFrom, end, ending));
    if (end >= to) break;
    at = end + ending.length;
  }
  return rows;
}

// ---- the tool's view of one table ----------------------------------------------------------------------------

/** Where the caret was, in the table's own terms. */
interface Place {
  readonly line: number;
  readonly col: number;
  /** The offset inside the cell's trimmed text. */
  readonly rel: number;
}

interface Ctx extends Located {
  readonly text: string;
  readonly rows: readonly Row[];
  /** How many columns the table has: the header's cells, which the delimiter row repeats. */
  readonly columns: number;
  readonly place: Place;
  /** Whether `align` would change nothing: the table is laid out as the align tool would lay it out. */
  readonly aligned: boolean;
  /** The text of the span. */
  readonly span: string;
  /** The table as the parse reads it before the edit. */
  readonly facts: Facts;
}

const DELIMITER_CELL = /^:?-+:?$/;

/** Why a table tool declined a table it found under the caret (V-02.1); a caret in no table, or nothing to do, is not a refusal. */
export type TableRefusal = 'columns' | 'shape' | 'closing-pipe' | 'rewrite';
interface Refused {
  readonly refused: TableRefusal;
}
const refuse = (refused: TableRefusal): Refused => ({ refused });
/** What a tool says: the edit, a refusal with its reason, or null (no table under the caret, or nothing to do). */
export type TableOutcome = LineEdit | Refused | null;

function context(text: string, caret: number): Ctx | null {
  const c = contextOf(text, caret);
  return c && !('refused' in c) ? c : null;
}

function contextOf(text: string, caret: number): Ctx | Refused | null {
  const loc = locate(text, caret);
  if (!loc) return null;
  const rows = splitRows(text, loc.from, loc.to, loc.quotes);
  // The parse and this file must read the same table: the same rows (the delimiter row is not one of its
  // rows) and the same cells in each.
  const parsed = loc.table.children;
  if (rows.length < 2 || rows.length - 1 !== parsed.length) return refuse('shape');
  for (let i = 0; i < rows.length; i++) {
    if (i === 1) continue;
    if (rows[i]!.cells.length !== parsed[i === 0 ? 0 : i - 1]!.children.length) return refuse('columns');
  }
  const columns = rows[0]!.cells.length;
  const delimiter = rows[1]!;
  if (columns === 0 || delimiter.cells.length !== columns) return refuse('columns');
  if (loc.table.align.length !== columns) return refuse('shape');
  for (const cell of delimiter.cells) if (!DELIMITER_CELL.test(text.slice(cell.trimFrom, cell.trimTo))) return refuse('shape');
  // The caret's row: the last whose line starts at or before it.
  let line = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i]!.start <= caret) line = i;
  const row = rows[line]!;
  let col = 0;
  for (let i = 0; i < row.cells.length; i++) if (row.cells[i]!.pipeAfter !== null && row.cells[i]!.pipeAfter! < caret) col = i + 1;
  col = Math.max(0, Math.min(col, row.cells.length - 1));
  const cell = row.cells[col];
  const rel = cell ? Math.max(0, Math.min(caret - cell.trimFrom, cell.trimTo - cell.trimFrom)) : 0;
  const span = text.slice(loc.from, loc.to);
  const aligned = alignedSpan(loc, span) === span;
  return { ...loc, text, rows, columns, place: { line, col, rel }, aligned, span, facts: factsOf(loc.doc, loc.table) };
}

function alignedSpan(loc: Located, span: string): string {
  return alignTablePipes.run({ document: loc.doc, node: loc.table, range: loc.table.src, text: span }).replacement;
}

// ---- turning splices into one edit ----------------------------------------------------------------------------

interface Facts {
  /** The table's rows as plain cell text, the header first (the delimiter row is not one). */
  readonly grid: readonly (readonly string[])[];
  readonly align: Table['align'];
  readonly tables: number;
}

/** `table` as the parse reads it, and how many tables `doc` has. */
function factsOf(doc: Document, table: Table): Facts {
  let tables = 0;
  const walk = (node: Node): void => {
    for (const child of childrenOf(node)) {
      if (child.type === 'table') tables++;
      else walk(child);
    }
  };
  walk(doc);
  return { grid: table.children.map((r) => r.children.map((c) => inlinePlainText(c.children, { hardBreak: ' ' }))), align: table.align, tables };
}

const encoder = new TextEncoder();

/**
 * The table of the edited text that starts where the old one did, as the parse reads it. The edited text is
 * parsed by the reparse (B-23), which gives the parse of the whole text and parses only the blocks the edit
 * touches (a 300 KB document takes seconds to parse whole), so the check is cheap where the document is large.
 */
function factsAfter(c: Located, before: string, after: string): Facts | null {
  const doc = reparseMarkdown(c.doc, encoder.encode(before), encoder.encode(after));
  let table: Table | null = null;
  const walk = (node: Node): void => {
    for (const child of childrenOf(node)) {
      if (child.type === 'table') {
        if (child.src.start === c.table.src.start) table = child as Table;
      } else walk(child);
    }
  };
  walk(doc);
  return table ? factsOf(doc, table as Table) : null;
}

/** What an edit says it did, checked against the parse of its result. */
interface Expect {
  /** The grid and the alignments the result must have. */
  readonly grid: readonly (readonly string[])[];
  readonly align: Table['align'];
  /** A further check on the new text (the extent of what changed). */
  readonly extra?: (rows: readonly Row[], text: string) => boolean;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The one splice that does what `out` differs from `text` by, over `[first, lastTo)` of the old text: the common head and tail left out. */
function trimmed(text: string, out: string, first: number, lastTo: number, delta: number): TextSplice {
  const old = text.slice(first, lastTo);
  const mid = out.slice(first, lastTo + delta);
  let p = 0;
  const max = Math.min(old.length, mid.length);
  while (p < max && old[p] === mid[p]) p++;
  // Never cut a surrogate pair in two.
  if (p > 0 && mid.charCodeAt(p - 1) >= 0xd800 && mid.charCodeAt(p - 1) <= 0xdbff) p--;
  let s = 0;
  while (s < max - p && old[old.length - 1 - s] === mid[mid.length - 1 - s]) s++;
  if (s > 0 && mid.charCodeAt(mid.length - s) >= 0xdc00 && mid.charCodeAt(mid.length - s) <= 0xdfff) s--;
  return { from: first + p, to: lastTo - s, insert: mid.slice(p, mid.length - s) };
}

/** A caret at `cell` of `row`: inside its text, `rel` into it, or in the empty cell's first space. */
function caretIn(row: Row, col: number, rel: number): number {
  const cell = row.cells[Math.min(col, row.cells.length - 1)];
  if (!cell) return row.contentFrom;
  if (cell.trimTo > cell.trimFrom) return cell.trimFrom + Math.min(rel, cell.trimTo - cell.trimFrom);
  return Math.min(cell.from + 1, cell.to);
}

/**
 * Applies `splices` (inside the span, in the old text's offsets), checks the result against `expect`, and
 * returns it as one splice over the part that changed, with the caret at `target` of the new table.
 */
function finish(c: Ctx, splices: readonly TextSplice[], expect: Expect, target: Place): TableOutcome {
  const out = finishEdit(c, splices, expect, target);
  if (out === 'nothing') return null;
  if (out) return out;
  // A ragged table is the usual reason an edit does not read back as asked: say that first.
  return refuse(c.rows.some((r, i) => i !== 1 && r.cells.length !== c.columns) ? 'columns' : 'rewrite');
}

function finishEdit(c: Ctx, splices: readonly TextSplice[], expect: Expect, target: Place): LineEdit | 'nothing' | null {
  if (splices.length === 0) return 'nothing';
  const sorted = [...splices].sort((a, b) => a.from - b.from);
  let out = '';
  let at = 0;
  let delta = 0;
  for (const s of sorted) {
    if (s.from < at || s.from < c.from || s.to > c.to || s.to < s.from) return null;
    out += c.text.slice(at, s.from) + s.insert;
    at = s.to;
    delta += s.insert.length - (s.to - s.from);
  }
  out += c.text.slice(at);
  if (out === c.text) return 'nothing';
  // Everything outside the span is the old text, by construction; say so again where it is cheap.
  if (out.slice(0, c.from) !== c.text.slice(0, c.from) || out.slice(c.from + c.span.length + delta) !== c.text.slice(c.to)) return null;
  const after = factsAfter(c, c.text, out);
  if (!after || after.tables !== c.facts.tables) return null;
  if (!sameJson(after.grid, expect.grid) || !sameJson(after.align, expect.align)) return null;
  const rows = splitRows(out, c.from, c.to + delta, c.quotes);
  if (expect.extra && !expect.extra(rows, out)) return null;
  const row = rows[target.line];
  if (!row) return null;
  const pos = caretIn(row, target.col, target.rel);
  const splice = trimmed(c.text, out, sorted[0]!.from, sorted[sorted.length - 1]!.to, delta);
  return { changes: [splice], selection: [{ from: pos, to: pos }] };
}

// ---- align -----------------------------------------------------------------------------------------------------

/** The cell texts of `rows` in `text`, trimmed; the delimiter row only by its `:` markers. */
function cellTexts(rows: readonly Row[], text: string): string[][] {
  return rows.map((row, i) =>
    row.cells.map((cell) => {
      const t = text.slice(cell.trimFrom, cell.trimTo);
      return i === 1 ? `${t.startsWith(':') ? ':' : ''}-${t.endsWith(':') && t.length > 1 ? ':' : ''}` : t;
    }),
  );
}

/**
 * Align: the table's pipes line up by display width (a CJK or emoji grapheme is two cells), the delimiter row
 * keeps each column's `:` markers, no cell's text is reflowed. The existing `align-table-pipes` operation on
 * this table's span and nothing else. Null when the caret is in no table or the table is already aligned.
 */
export function alignTable(text: string, caret: number): LineEdit | null {
  const out = alignTableOutcome(text, caret);
  return out && !('refused' in out) ? out : null;
}

/** `alignTable` with the reason when it declines a table it found (V-02.1). */
export function alignTableOutcome(text: string, caret: number): TableOutcome {
  const c = contextOf(text, caret);
  if (!c || 'refused' in c) return c;
  const aligned = alignedSpan(c, c.span);
  if (aligned === c.span) return null;
  const grid = c.facts.grid;
  const old = cellTexts(c.rows, text);
  return finish(
    c,
    [{ from: c.from, to: c.to, insert: aligned }],
    {
      grid,
      align: c.table.align,
      // Only the spacing moved: every cell's text and every column's markers are as they were.
      extra: (rows, out) => rows.length === c.rows.length && sameJson(cellTexts(rows, out), old),
    },
    c.place,
  );
}

// ---- add row ---------------------------------------------------------------------------------------------------

/** A new row for `c`: empty cells, in the table's own style, as wide as the columns when the table was aligned. */
function newRowText(c: Ctx): string {
  const cells = Array.from({ length: c.columns }, (_, k) => {
    if (!c.aligned) return '';
    const d = c.rows[1]!.cells[k]!;
    return ' '.repeat(d.trimTo - d.trimFrom);
  });
  // Always with the outer pipes: a row that is only spaces and a pipe is not a row of a table that has none.
  return `| ${cells.join(' | ')} |`;
}

/**
 * Add row: one empty row below the caret's (below the delimiter row when the caret is in the header), with
 * the table's container prefix and the line ending of the row it follows. Null outside a table.
 */
export function addTableRow(text: string, caret: number): LineEdit | null {
  const out = addTableRowOutcome(text, caret);
  return out && !('refused' in out) ? out : null;
}

/** `addTableRow` with the reason when it declines a table it found (V-02.1). */
export function addTableRowOutcome(text: string, caret: number): TableOutcome {
  const c = contextOf(text, caret);
  if (!c || 'refused' in c) return c;
  const after = Math.max(c.place.line, 1);
  const row = c.rows[after]!;
  // The ending that separates this row from the next, or (last row) the one that separates the rows above it.
  const ending = row.ending !== '' ? row.ending : c.rows[after - 1]!.ending;
  const prefix = text.slice(c.rows[1]!.start, c.rows[1]!.contentFrom);
  if (ending === '') return refuse('rewrite');
  const body = c.facts.grid.map((r) => [...r]);
  // The parse's row `after - 1` (the delimiter row is not one) is the row the new one follows.
  body.splice(after, 0, Array.from({ length: c.columns }, () => ''));
  return finish(
    c,
    [{ from: row.to, to: row.to, insert: ending + prefix + newRowText(c) }],
    { grid: body, align: c.table.align },
    { line: after + 1, col: 0, rel: 0 },
  );
}

// ---- add column ------------------------------------------------------------------------------------------------

/** The text a new cell takes in a row of `c`, between the pipe before it and its own pipe. */
function newCellRaw(c: Ctx, rowIndex: number, col: number): string {
  const neighbour = c.rows[rowIndex]!.cells[col]!;
  const raw = c.text.slice(neighbour.from, neighbour.to);
  const spaced = /^[ \t]/.test(raw);
  const spacedEnd = /[ \t]$/.test(raw);
  if (rowIndex === 1) return `${spaced ? ' ' : ''}---${spacedEnd ? ' ' : ''}`;
  if (c.aligned) return '     ';
  return `${spaced ? ' ' : ''}${spacedEnd ? ' ' : ''}`;
}

/**
 * Add column: an empty column after the caret's, with `---` in the delimiter row (no alignment marker).
 * A row that is shorter than the caret's column is left as it is: only rows that reach it get a cell. A row
 * of the table with no closing pipe and its last cell in the caret's column cannot take a cell after it
 * (an empty cell there would be read as the pipe that closes the row), so the tool refuses (null).
 */
export function addTableColumn(text: string, caret: number): LineEdit | null {
  const out = addTableColumnOutcome(text, caret);
  return out && !('refused' in out) ? out : null;
}

/** `addTableColumn` with the reason when it declines a table it found (V-02.1). */
export function addTableColumnOutcome(text: string, caret: number): TableOutcome {
  const c = contextOf(text, caret);
  if (!c || 'refused' in c) return c;
  // A cell beyond the header's (a row with too many) is not a column the table has: add after the last one.
  const col = Math.min(c.place.col, c.columns - 1);
  const splices: TextSplice[] = [];
  for (let i = 0; i < c.rows.length; i++) {
    const row = c.rows[i]!;
    if (row.cells.length <= col) continue;
    const pipe = row.cells[col]!.pipeAfter;
    if (pipe === null) return refuse('closing-pipe');
    splices.push({ from: pipe + 1, to: pipe + 1, insert: `${newCellRaw(c, i, col)}|` });
  }
  const grid = c.facts.grid;
  const widened = grid.map((r) => (r.length > col ? [...r.slice(0, col + 1), '', ...r.slice(col + 1)] : [...r]));
  const align = [...c.table.align.slice(0, col + 1), null, ...c.table.align.slice(col + 1)];
  const reaches = (c.rows[c.place.line]?.cells.length ?? 0) > col;
  return finish(c, splices, { grid: widened, align }, { ...c.place, col: reaches && c.place.col > col ? c.place.col + 1 : c.place.col });
}

// ---- sort ------------------------------------------------------------------------------------------------------

/**
 * Sort: the body rows by the source text of the caret's column (trimmed), in UTF-8 byte order and stable; a row
 * with no cell in that column sorts first. The header and delimiter rows stay. A row moves whole: its text,
 * not its prefix or its line ending, which stay where the position had them. Null when the order is
 * already that, there are no body rows, or the caret's row has no cell.
 */
export function sortTableRows(text: string, caret: number): LineEdit | null {
  const out = sortTableRowsOutcome(text, caret);
  return out && !('refused' in out) ? out : null;
}

/** `sortTableRows` with the reason when it declines a table it found (V-02.1). */
export function sortTableRowsOutcome(text: string, caret: number): TableOutcome {
  const c = contextOf(text, caret);
  if (!c || 'refused' in c) return c;
  if (c.rows.length < 3 || c.rows[c.place.line]!.cells.length === 0) return null;
  const col = c.place.col;
  const key = (i: number): string => {
    const cell = c.rows[i]!.cells[col];
    return cell ? c.text.slice(cell.trimFrom, cell.trimTo) : '';
  };
  const order = Array.from({ length: c.rows.length - 2 }, (_, k) => k + 2);
  order.sort((a, b) => compareBytes(key(a), key(b)) || a - b);
  const splices: TextSplice[] = [];
  order.forEach((from, k) => {
    const into = k + 2;
    if (from === into) return;
    const dest = c.rows[into]!;
    const src = c.rows[from]!;
    splices.push({ from: dest.contentFrom, to: dest.to, insert: text.slice(src.contentFrom, src.to) });
  });
  const grid = c.facts.grid;
  const sortedGrid = [grid[0]!, ...order.map((i) => grid[i - 1]!)];
  const line = c.place.line;
  const moved = line >= 2 ? order.indexOf(line) + 2 : line;
  return finish(c, splices, { grid: sortedGrid, align: c.table.align }, { ...c.place, line: moved });
}

// ---- copy as CSV -----------------------------------------------------------------------------------------------

/** The table as CSV, the text C-07's copy-table-csv puts on the clipboard (`csvOf` over the same cell grid), or null outside a table. */
export function tableCsv(text: string, caret: number): string | null {
  const loc = locate(text, caret);
  return loc ? csvOf(cellGrid(loc.table)) : null;
}
