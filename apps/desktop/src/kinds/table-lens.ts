// The table lens (K-10b; ADR-0071, amending ADR-0061): a `.csv` or `.tsv` shown as a grid in place of its Source, in the
// pane's own Source mount, until Esc or the Table tool again returns to Source at the same row.
//
// What it promises:
// - **It never writes** (commitment 3). The grid is derived from the store's bytes by core's `delimited-table` deriver;
//   the header choice, the sort and the column stats are view state; no cell reaches a splice. Source keeps the file
//   byte for byte. A `cell` selection is the whole raw field in bytes; ⌘C copies its decoded value; *Source field (CSV)*
//   copies the raw field; a copy of the whole table guards a formula (ADR-0071 item 5).
// - **Nothing hidden silently** (commitment 4). One line over the grid says what it is and what it reshaped (header,
//   decoded fields, unreadable rows, short rows, blank lines, a BOM), each count a list of its places; a decoded cell is
//   marked at rest and its raw field is its description; a line break, a bidi control, a zero-width character and a byte
//   that is not UTF-8 are each shown as a mark; an absent cell is told from an empty one.
// - **First rows never wait for the whole file** (commitment 5). The first screen of records is read and drawn at once;
//   the rest is read a few milliseconds a slice with the loop given back between slices, and a sort or the stats of a
//   column are worked the same way (core's `data/table-view.ts`). The grid draws only the rows and the columns on screen
//   (F-89): a file of thousands of columns costs the cells in view, not the cells in the file, and the stats are counted
//   for the columns in view and for others as they scroll in.
import {
  cellOf,
  createScan,
  delimiterFor,
  delimiterHint,
  FIELD_BREAK,
  FIELD_DECODED,
  fieldsOf,
  fieldValue,
  inferHeader,
  isValidUtf8,
  lineCount,
  lineOfByte,
  rawText,
  RECORD_PENDING,
  RECORD_ROW,
  RECORD_UNREADABLE,
  recordCount,
  scanSome,
  type TableScan,
} from '@marxy/core/src/data/delimited.ts';
import {
  columnStatsSliced,
  columnType,
  compareByKeys,
  profileRecord,
  sortKeysSliced,
  sortSliced,
  type ColumnProfile,
  type ColumnStats,
  type ColumnType,
  type Pace,
} from '@marxy/core/src/data/table-view.ts';
import { csvOf, tsvOf } from '@marxy/core/src/operations/copy-table.ts';
import { byteToUtf16 } from '@marxy/core';
import { invisibleSegments } from '@marxy/core/src/render/index.ts';
import type { DocumentStore } from '../document/store.ts';
import type { AppPane } from '../pane/index.ts';
import type { Pane } from '../pane/pane-set.ts';
import { appendInvisibleSegments } from '../render/invisibles-dom.ts';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { notify } from '../notices/index.ts';
import { buildAppContext } from '../selection/bind.ts';
import { closeVerbMenu, openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';

/** The mount's attribute while a lens covers its Source (scripts/registry.json). */
const LENS_ATTRIBUTE = 'data-marxy-lens';
/** Records read and drawn before the first yield: more than a screen. */
const FIRST_RECORDS = 120;
/** A slice of reading, sorting or counting holds the main thread about this long. */
const SLICE_MS = 8;
/** Rows drawn above and below the screen. */
const OVERSCAN = 12;
/** Pixels of columns drawn to the left and right of the screen. */
const COL_MARGIN = 320;
/** The scroll height is never more than this many pixels; a longer table is scrolled through a scale (WebKit's layout limit is ~33M). */
const MAX_SCROLL_PX = 16_000_000;
/** Rows read to choose the column widths. */
const WIDTH_SAMPLE = 200;
/** At most this many places a count lists. */
const PLACES = 12;

/** A slice of work gives the loop back through a message, not a timer: a timer's clamp would make each slice cost 4 ms more. */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What an unreadable row says of the lines its quote reached into (F-89): they are drawn as rows, and may belong to it. */
const swallowedNote = (lines: number, reason: 'unclosed-quote' | 'after-quote'): string =>
  `${reason === 'unclosed-quote' ? 'the quote runs on' : 'the quote closes later'} · the ${lines === 1 ? 'line' : `${lines.toLocaleString('en-US')} lines`} after it may have been part of it, read as ${lines === 1 ? 'a row' : 'rows'} of ${lines === 1 ? 'its' : 'their'} own`;

/** The delimiter a hint names, in words the header line can say. */
const delimiterWord = (d: string): string => (d === '\t' ? 'a tab' : `'${d}'`);

/** What a test, the commands and the strip may ask of an open lens. */
export interface TableLens {
  readonly pane: Pane<AppPane>;
  /** Back to Source at the selected row (else the first row on screen), the lens gone. */
  close(opts?: { readonly toSource?: boolean }): Promise<void>;
  /** The stats footer on or off (`on` omitted: the other way). */
  setStats(on?: boolean): Promise<void>;
  /** Orders the view by column `col` (`dir` null: the file's order). Writes nothing. */
  sortBy(col: number, dir: 'asc' | 'desc' | null): Promise<void>;
  /** Row 1 a header or a data row. */
  setHeader(on: boolean): void;
  /** Resolves when the file is wholly read and any sort and stats asked for are done. */
  settled(): Promise<void>;
  /** For tests and the menus: what the lens holds now. */
  state(): LensState;
}

export interface LensState {
  readonly done: boolean;
  readonly records: number;
  readonly header: boolean;
  readonly columns: number;
  readonly types: readonly ColumnType[];
  readonly sort: { readonly col: number; readonly dir: 'asc' | 'desc' } | null;
  readonly stats: readonly (ColumnStats | null)[] | null;
  readonly selected: { readonly pos: number; readonly col: number; readonly record: number } | null;
  /** The record index of each view position, header excluded, while the file is read in its own order. */
  readonly order: readonly number[];
  /** Bytes read when the first rows were drawn, and the file's length (commitment 5's record). */
  readonly firstDraw: { readonly bytesRead: number; readonly bytes: number; readonly records: number } | null;
  /** How the slow work was cut: slices of reading (and the most bytes one read), of the last sort and of the last stats. */
  readonly slices: { readonly read: number; readonly widestRead: number; readonly sort: number; readonly stats: number };
}

const lenses = new WeakMap<HTMLElement, TableLens>();

/** The lens over `pane`'s Source, when one is up. */
export function lensOf(pane: Pane<AppPane> | undefined | null): TableLens | null {
  return pane ? (lenses.get(pane.parts.source) ?? null) : null;
}

/** Whether `path` is one the lens reads: a `.csv` or a `.tsv`. */
export const tableReadable = (path: string | null | undefined): boolean => path != null && delimiterFor(path) !== null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Covers `pane`'s Source with the grid (Source first if the pane is in Read; the reader's Source edits are folded into
 * the store first, as leaving Source does, so the grid reads what Source shows). Resolves the lens, or null when the pane
 * holds no CSV or TSV.
 */
export async function openTableLens(pane: Pane<AppPane>): Promise<TableLens | null> {
  const existing = lensOf(pane);
  if (existing) return existing;
  const view = pane.view;
  const path = pane.path();
  if (!tableReadable(path) || view.store() === null) return null;
  if (view.mode !== 'source') await view.setMode('source');
  if (view.mode !== 'source') return null;
  if (view.sourceHasUnfoldedEdits()) await view.foldSource();
  const store = view.store();
  if (store === null || lensOf(pane)) return lensOf(pane);
  return createLens(pane, store);
}

function createLens(pane: Pane<AppPane>, store: DocumentStore): TableLens {
  const mount = pane.parts.source;
  const file = store.snapshot().path;
  const csv = delimiterFor(file) === ',';
  const kindWord = csv ? 'CSV' : 'TSV';

  // ---- the DOM -------------------------------------------------------------------------------------------------------
  const root = el('div', 'marxy-table-lens');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', `Table of ${file.split('/').pop()}`);
  const info = el('p', 'marxy-table-lens-info');
  info.setAttribute('aria-live', 'polite');
  const scroller = el('div', 'marxy-table-lens-scroll');
  const table = el('table', 'marxy-table-lens-grid');
  table.setAttribute('role', 'grid');
  // The grid holds focus and names its selected cell (`aria-activedescendant`); the arrows move the selection.
  table.tabIndex = 0;
  table.setAttribute('aria-readonly', 'true');
  const colgroup = el('colgroup');
  const thead = el('thead');
  const tbody = el('tbody');
  const tfoot = el('tfoot');
  tfoot.hidden = true;
  table.append(colgroup, thead, tbody, tfoot);
  scroller.append(table);
  root.append(info, scroller);

  // ---- state ---------------------------------------------------------------------------------------------------------
  let scan: TableScan = createScan(store.snapshot().buffer.bytes, csv ? ',' : '\t');
  let generation = 0;
  let header = false;
  /** The reader chose the header with a click: a reload keeps the choice instead of inferring again. */
  let headerChosen: boolean | null = null;
  let sort: { col: number; dir: 'asc' | 'desc' } | null = null;
  let order: Int32Array | null = null;
  let statsOn = false;
  /** Per column, once counted: the columns in view are counted first and the rest as they scroll in. */
  let stats: (ColumnStats | null)[] | null = null;
  let statsQueued = false;
  let selected: { pos: number; col: number } | null = null;
  let columns = 0;
  let widths: number[] = [];
  let profiles: ColumnProfile[] = [];
  let profileRow0: ColumnProfile[] = [];
  let decodedFields = 0;
  let counted = 0;
  const fieldCounts = new Map<number, number>();
  let rowH = 0;
  /** The left edge of each data column in the table's own pixels (the row-number column first), and one past the last. */
  let colX = new Float64Array(1);
  /** Bumped whenever the widths are fitted again, so the cells in view are laid out again. */
  let layout = 0;
  /** The `layout` the columns of the table (its colgroup) were last drawn at. */
  let headLayout = -1;
  /** The columns drawn: `[first, last)`. Everything else is a spacer. */
  let win = { first: 0, last: 0 };
  let drawn = { first: -1, last: -1, version: -1, cfirst: -1, clast: -1, layout: -1 };
  let version = 0;
  let firstDraw: LensState['firstDraw'] = null;
  const slices = { read: 0, widestRead: 0, sort: 0, stats: 0 };
  let busy: string | null = null;
  let closed = false;
  let reading: Promise<void> = Promise.resolve();
  let work: Promise<void> = Promise.resolve();

  const base = (): number => (header && recordCount(scan) > 0 && scan.records.kind.data[0] === RECORD_ROW ? 1 : 0);
  const viewLength = (): number => (order ? order.length : Math.max(0, recordCount(scan) - base()));
  const recordAt = (pos: number): number => (order ? order[pos]! : base() + pos);
  const typeOf = (c: number): ColumnType => {
    const p = profiles[c];
    const q = header ? undefined : profileRow0[c];
    if (!q) return columnType(p);
    return columnType({ numbers: (p?.numbers ?? 0) + q.numbers, idents: (p?.idents ?? 0) + q.idents, empty: (p?.empty ?? 0) + q.empty, other: (p?.other ?? 0) + q.other });
  };
  const types = (): ColumnType[] => Array.from({ length: columns }, (_, c) => typeOf(c));

  /** The columns to draw: those in view and a margin either side (a binary search over the columns' edges). */
  function colWindow(): { first: number; last: number } {
    if (columns === 0) return { first: 0, last: 0 };
    const left = scroller.scrollLeft - COL_MARGIN;
    const right = scroller.scrollLeft + (scroller.clientWidth || 1000) + COL_MARGIN;
    let lo = 0;
    let hi = columns;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (colX[mid + 1]! > left) hi = mid;
      else lo = mid + 1;
    }
    const first = Math.min(lo, columns - 1);
    lo = first + 1;
    hi = columns;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (colX[mid]! >= right) hi = mid;
      else lo = mid + 1;
    }
    return { first, last: lo };
  }

  // ---- reading -------------------------------------------------------------------------------------------------------
  /** What each newly read record adds to the counts the header line gives and the column types. */
  function account(): void {
    const n = recordCount(scan);
    for (let r = counted; r < n; r++) {
      if (scan.records.kind.data[r] !== RECORD_ROW) continue;
      const [first, end] = fieldsOf(scan, r);
      fieldCounts.set(end - first, (fieldCounts.get(end - first) ?? 0) + 1);
      for (let f = first; f < end; f++) if (scan.fields.flags.data[f]! & FIELD_DECODED) decodedFields++;
      if (r === 0) profileRecord(scan, 0, profileRow0);
      else profileRecord(scan, r, profiles);
    }
    counted = n;
    if (scan.widest > columns) {
      columns = scan.widest;
      chooseWidths();
      drawHead();
    }
  }

  function chooseHeader(): void {
    if (headerChosen !== null) {
      header = headerChosen;
      return;
    }
    if (recordCount(scan) === 0 || scan.records.kind.data[0] !== RECORD_ROW) {
      header = false;
      return;
    }
    const [first, end] = fieldsOf(scan, 0);
    const values: string[] = [];
    for (let f = first; f < end; f++) values.push(fieldValue(scan, f));
    header = inferHeader(values);
  }

  /** Reads the file from its start: the first screen now, the rest a slice at a time. */
  function read(): void {
    const mine = ++generation;
    scanSome(scan, { records: FIRST_RECORDS });
    chooseHeader();
    account();
    drawAll();
    firstDraw = { bytesRead: scan.pos, bytes: scan.bytes.length, records: recordCount(scan) };
    slices.read = 0;
    slices.widestRead = scan.pos;
    reading = (async () => {
      while (!scan.done) {
        await yieldNow();
        if (closed || mine !== generation) return;
        const began = performance.now();
        const from = scan.pos;
        scanSome(scan, { until: () => performance.now() - began > SLICE_MS });
        slices.read++;
        slices.widestRead = Math.max(slices.widestRead, scan.pos - from);
        account();
        scheduleDraw();
      }
      if (closed || mine !== generation) return;
      drawInfo();
      scheduleDraw();
    })();
  }

  // ---- drawing -------------------------------------------------------------------------------------------------------
  /** Each column's width in characters, from the first rows' raw fields; the widths are fixed so a scroll never moves them. */
  function chooseWidths(): void {
    const sample = Math.min(recordCount(scan), WIDTH_SAMPLE);
    const longest = new Array<number>(columns).fill(3);
    for (let r = 0; r < sample; r++) {
      if (scan.records.kind.data[r] !== RECORD_ROW) continue;
      const [first, end] = fieldsOf(scan, r);
      for (let f = first; f < end; f++) {
        const c = f - first;
        const len = Math.min(48, scan.fields.end.data[f]! - scan.fields.start.data[f]!);
        if (len > longest[c]!) longest[c] = len;
      }
    }
    widths = longest.map((n) => Math.max(4, Math.min(40, n)));
    fitWidths();
  }

  /** The widths in pixels, the data columns grown alike to fill the pane when the grid is narrower than it (as the mock's does). */
  let fittedTo = -1;
  function fitWidths(): void {
    const probe = el('span', undefined, '0000000000');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    scroller.append(probe);
    const ch = probe.getBoundingClientRect().width / 10 || 8;
    const pad = parseFloat(getComputedStyle(probe).fontSize || '13') * 1.5;
    probe.remove();
    const digits = String(Math.max(1, Math.ceil(scan.bytes.length / 8))).length;
    const rn = Math.ceil(Math.min(9, digits) * ch + pad);
    const data = widths.map((w) => Math.ceil(w * ch + pad + ch * 1.5));
    const sum = rn + data.reduce((a, b) => a + b, 0);
    const room = scroller.clientWidth;
    fittedTo = room;
    const grow = room > sum && sum > rn ? (room - rn) / (sum - rn) : 1;
    let total = rn;
    colX = new Float64Array(data.length + 1);
    colX[0] = rn;
    data.forEach((w, i) => {
      total += Math.floor(w * grow);
      colX[i + 1] = total;
    });
    table.style.width = `${total}px`;
    layout++;
  }

  const typeWords: Readonly<Record<ColumnType, string>> = { number: 'number', ident: 'id', text: 'text', empty: 'empty' };

  function headerLabel(c: number): string {
    if (header) {
      const [first, end] = fieldsOf(scan, 0);
      if (first + c < end) return fieldValue(scan, first + c);
    }
    return `Column ${c + 1}`;
  }

  /**
   * A cell standing for the columns that are not drawn on one side: one cell, of the width they would have had together.
   * The table has the row-number column, the columns in view and at most these two, however many columns the file has.
   */
  function hSpacer<K extends 'td' | 'th'>(tag: K): HTMLElementTagNameMap[K] {
    const cell = el(tag, 'marxy-table-lens-hspacer');
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  }

  /** The table's columns for the window `w`: the row numbers, a spacer, the columns in view, a spacer. */
  const tableSpan = (w: { first: number; last: number }): number => w.last - w.first + (w.first > 0 ? 1 : 0) + (w.last < columns ? 1 : 0);

  function fitColgroup(): void {
    const cols: HTMLElement[] = [];
    const col = (px: number): void => {
      const c = el('col');
      c.style.width = `${px}px`;
      cols.push(c);
    };
    col(colX[0]!);
    if (win.first > 0) col(colX[win.first]! - colX[0]!);
    for (let c = win.first; c < win.last; c++) col(colX[c + 1]! - colX[c]!);
    if (win.last < columns) col(colX[columns]! - colX[win.last]!);
    colgroup.replaceChildren(...cols);
    headLayout = layout;
  }

  function drawHead(): void {
    win = colWindow();
    fitColgroup();
    // The header is drawn again on a sideways scroll, which replaces its buttons: a sort control that had focus gets it back.
    const focusedCol = thead.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest('th')?.dataset.col : undefined;
    const tr = el('tr');
    tr.setAttribute('aria-rowindex', '1');
    const rn = el('th', 'marxy-table-lens-rn', '#');
    rn.scope = 'col';
    rn.setAttribute('aria-colindex', '1');
    tr.append(rn);
    if (win.first > 0) tr.append(hSpacer('th'));
    for (let c = win.first; c < win.last; c++) {
      const th = el('th');
      th.scope = 'col';
      th.dataset.col = String(c);
      th.setAttribute('aria-colindex', String(c + 2));
      if (typeOf(c) === 'number') th.classList.add('marxy-table-lens-num');
      th.setAttribute('aria-sort', sort?.col === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const button = el('button', 'marxy-table-lens-sort');
      button.type = 'button';
      const name = el('span', 'marxy-table-lens-name');
      appendText(name, headerLabel(c));
      const arrow = el('span', 'marxy-table-lens-arrow', sort?.col === c ? (sort.dir === 'asc' ? '↑' : '↓') : '↕');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(name, arrow);
      button.title = `Sort by this column · the view only, the file is unchanged`;
      button.addEventListener('click', () => void cycleSort(c));
      const type = el('span', 'marxy-table-lens-type', typeWords[typeOf(c)]);
      th.append(button, type);
      tr.append(th);
    }
    if (win.last < columns) tr.append(hSpacer('th'));
    thead.replaceChildren(tr);
    if (focusedCol !== undefined) {
      const again = thead.querySelector<HTMLButtonElement>(`th[data-col="${focusedCol}"] button`);
      // A column scrolled out of the window takes its focus to the grid, not to the page.
      if (again) again.focus({ preventScroll: true });
      else table.focus({ preventScroll: true });
    }
    table.setAttribute('aria-colcount', String(columns + 1));
    drawFoot();
  }

  /** `value` into `parent`: each line break a visible mark, each flagged character a marker, never raw (commitment 4). */
  function appendText(parent: HTMLElement, value: string, replaced = false): void {
    const parts = value.split(/(\r\n|\n|\r)/);
    for (const part of parts) {
      if (part === '\n' || part === '\r\n' || part === '\r') {
        const mark = el('span', 'marxy-table-lens-break', part === '\r\n' ? '↵' : part === '\n' ? '↵' : '␍');
        mark.title = part === '\r\n' ? 'line break (CRLF) in the field' : part === '\n' ? 'line break (LF) in the field' : 'carriage return in the field';
        parent.append(mark);
        continue;
      }
      if (part === '') continue;
      const pieces = replaced ? part.split('�') : [part];
      pieces.forEach((piece, i) => {
        if (i > 0) {
          const bad = el('span', 'marxy-table-lens-replaced', '�');
          bad.title = 'bytes here are not UTF-8; Source shows them';
          parent.append(bad);
        }
        if (piece !== '') appendInvisibleSegments(parent, invisibleSegments(piece, { inCode: true, sourceStart: 1 }));
      });
    }
  }

  function cellNode(r: number, c: number, pos: number): HTMLTableCellElement {
    const td = el('td');
    td.dataset.col = String(c);
    td.setAttribute('aria-colindex', String(c + 2));
    td.id = `marxy-table-lens-${generation}-${pos}-${c}`;
    const [first, end] = fieldsOf(scan, r);
    if (first + c >= end) {
      td.className = 'marxy-table-lens-absent';
      td.setAttribute('aria-label', `absent: this row has ${plural(end - first, 'field')}`);
      td.title = `No field here: this row has ${plural(end - first, 'field')}, the widest ${columns}`;
      return td;
    }
    const f = first + c;
    const flags = scan.fields.flags.data[f]!;
    const s = scan.fields.start.data[f]!;
    const e = scan.fields.end.data[f]!;
    const type = typeOf(c);
    if (type === 'number') td.classList.add('marxy-table-lens-num');
    else if (type === 'ident') td.classList.add('marxy-table-lens-ident');
    if (flags & FIELD_BREAK) td.classList.add('marxy-table-lens-multiline');
    appendText(td, fieldValue(scan, f), !isValidUtf8(scan.bytes, s, e));
    if (flags & FIELD_DECODED) {
      td.setAttribute('data-marxy-decoded', '');
      const rawField = rawText(scan, s, e);
      td.title = `decoded from ${rawField}`;
      td.setAttribute('aria-description', `decoded from ${rawField}`);
    }
    if (selected && selected.pos === pos && selected.col === c) {
      td.setAttribute('aria-selected', 'true');
      td.classList.add('marxy-table-lens-selected');
    }
    return td;
  }

  function rowNode(pos: number, w: { first: number; last: number }): HTMLTableRowElement {
    const r = recordAt(pos);
    const tr = el('tr');
    tr.dataset.record = String(r);
    tr.setAttribute('aria-rowindex', String(pos + 2));
    const kind = scan.records.kind.data[r]!;
    const rn = el('th', 'marxy-table-lens-rn', String(r - base() + 1));
    rn.scope = 'row';
    tr.append(rn);
    if (kind !== RECORD_ROW) {
      // An unreadable record and the pending one show their own bytes, raw, in the code face, and say what they are.
      tr.className = kind === RECORD_UNREADABLE ? 'marxy-table-lens-unreadable' : 'marxy-table-lens-pending';
      const td = el('td');
      td.colSpan = Math.max(1, tableSpan(w));
      const fault = scan.faults.get(r);
      const label = el(
        'span',
        'marxy-table-lens-label',
        kind === RECORD_UNREADABLE ? (fault?.reason === 'unclosed-quote' ? 'Unreadable · a quote is never closed' : 'Unreadable · bytes after a closing quote') : 'Unfinished last record',
      );
      const code = el('code');
      appendText(code, rawText(scan, scan.records.start.data[r]!, scan.records.end.data[r]!));
      td.append(label, code);
      // The lines after it that its quote reached into are drawn as rows of their own below, and may have been part of
      // this record (commitment 4): the row says how many, so none of them reads as certain.
      if (fault && fault.swallowed > 0) {
        const note = el('span', 'marxy-table-lens-swallowed', swallowedNote(fault.swallowed, fault.reason));
        td.append(note);
      }
      tr.append(td);
      return tr;
    }
    if (w.first > 0) tr.append(hSpacer('td'));
    for (let c = w.first; c < w.last; c++) tr.append(cellNode(r, c, pos));
    if (w.last < columns) tr.append(hSpacer('td'));
    return tr;
  }

  let frame = 0;
  function scheduleDraw(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawBody();
      drawInfo();
    });
  }

  /** The scale of the scroll when the table is taller than the scroller can be. */
  const fullHeight = (): number => viewLength() * (rowH || 24);
  const scale = (): number => {
    const full = fullHeight();
    const h = scroller.clientHeight;
    return full > MAX_SCROLL_PX ? Math.max(1, (full - h) / (MAX_SCROLL_PX - h)) : 1;
  };

  function drawBody(force = false): void {
    if (closed) return;
    const total = viewLength();
    const h = rowH || 24;
    const k = scale();
    const top = scroller.scrollTop;
    const virtualTop = top * k;
    const view = scroller.clientHeight || 600;
    const first = Math.max(0, Math.min(total, Math.floor(virtualTop / h) - OVERSCAN));
    const last = Math.min(total, Math.ceil((virtualTop + view) / h) + OVERSCAN);
    // The columns in view moved (a scroll across, a resize, a wider file): the header is drawn again with the cells.
    const w = colWindow();
    if (w.first !== win.first || w.last !== win.last || layout !== headLayout) {
      drawHead();
      if (statsOn) wantStats();
    }
    if (!force && first === drawn.first && last === drawn.last && version === drawn.version && w.first === drawn.cfirst && w.last === drawn.clast && layout === drawn.layout) {
      setSpacers(first, last, total, top, virtualTop, h);
      return;
    }
    drawn = { first, last, version, cfirst: w.first, clast: w.last, layout };
    const rows: HTMLTableRowElement[] = [];
    for (let pos = first; pos < last; pos++) rows.push(rowNode(pos, w));
    tbody.replaceChildren(spacerTop, ...rows, spacerBottom);
    table.setAttribute('aria-rowcount', String(total + 1));
    if (!rowH && rows.length > 0) {
      const measured = rows.find((r) => !r.className)?.getBoundingClientRect().height ?? 0;
      if (measured > 0) {
        rowH = measured;
        drawBody(true);
        return;
      }
    }
    setSpacers(first, last, total, top, virtualTop, h);
    if (selected) table.setAttribute('aria-activedescendant', `marxy-table-lens-${generation}-${selected.pos}-${selected.col}`);
    else table.removeAttribute('aria-activedescendant');
  }

  const spacerTop = el('tr', 'marxy-table-lens-spacer');
  const spacerBottom = el('tr', 'marxy-table-lens-spacer');
  spacerTop.setAttribute('aria-hidden', 'true');
  spacerBottom.setAttribute('aria-hidden', 'true');
  const spacerCell = (tr: HTMLTableRowElement): HTMLTableCellElement => {
    if (!tr.firstElementChild) tr.append(el('td'));
    const td = tr.firstElementChild as HTMLTableCellElement;
    td.colSpan = tableSpan(win) + 1;
    return td;
  };

  function setSpacers(first: number, last: number, total: number, top: number, virtualTop: number, h: number): void {
    const content = Math.min(fullHeight(), MAX_SCROLL_PX);
    // Row `first` sits where the scale puts it: at the scroll top, less how far into the window it starts.
    const before = Math.max(0, top + (first * h - virtualTop));
    const after = Math.max(0, content - before - (last - first) * h);
    spacerCell(spacerTop).style.height = `${before}px`;
    spacerCell(spacerBottom).style.height = `${after}px`;
    void total;
  }

  function drawAll(): void {
    version++;
    chooseWidths();
    drawHead();
    drawBody(true);
    drawInfo();
  }

  /** A count in the header line that lists its places (a menu of Jump to source rows). */
  function countButton(text: string, places: () => { readonly title: string; readonly start: number; readonly end: number }[], what: string): HTMLButtonElement {
    const b = el('button', 'marxy-table-lens-count', text);
    b.type = 'button';
    b.title = `List the ${what} · each one a Jump to source`;
    b.addEventListener('click', () => {
      const list = places();
      const rows: VerbMenuRow[] = list.slice(0, PLACES).map((p, i) => ({
        command: null,
        key: `table.place.${i}`,
        title: p.title,
        detail: 'Jump to source',
        run: () => void jumpToSource(p.start, p.end),
      }));
      if (list.length > PLACES) rows.push({ command: null, key: 'table.place.more', title: `and ${plural(list.length - PLACES, 'more')}`, note: true });
      const box = b.getBoundingClientRect();
      openVerbMenu({ x: box.left, y: box.bottom, top: box.top }, buildAppContext(appHandle()), { registered: [], allActions: () => {}, rows, label: what });
    });
    return b;
  }

  const lineOf = (byte: number): number => lineOfByte(scan.bytes, byte);

  function recordsWhere(test: (r: number) => boolean): { title: string; start: number; end: number }[] {
    const out: { title: string; start: number; end: number }[] = [];
    for (let r = 0; r < recordCount(scan) && out.length <= PLACES; r++) {
      if (test(r)) out.push({ title: `Row ${r - base() + 1} · line ${lineOf(scan.records.start.data[r]!)}`, start: scan.records.start.data[r]!, end: scan.records.end.data[r]! });
    }
    return out;
  }

  function drawInfo(): void {
    const parts: (string | Node)[] = [];
    const sep = (): void => {
      if (parts.length > 0) parts.push(el('span', 'marxy-table-lens-sep', ' · '));
    };
    if (!scan.done) {
      parts.push(`Reading ${kindWord} · ${Math.floor((scan.pos / Math.max(1, scan.bytes.length)) * 100)}% · ${plural(viewLength(), 'row')} so far`);
    } else {
      parts.push(`Table from ${plural(lineCount(scan), 'line')} of ${kindWord}`);
    }
    if (scan.bom) {
      sep();
      parts.push('starts with a byte-order mark');
    }
    if (scan.loneCr > 0) {
      sep();
      parts.push('lines end in CR alone');
    }
    // The delimiter is the extension's; a file that looks like another says so and is not read again (ADR-0071 rejects sniffing).
    const hint = delimiterHint(scan);
    if (hint !== null) {
      sep();
      const note = el('span', 'marxy-table-lens-hint', `This file may use ${delimiterWord(hint)} between fields`);
      parts.push(note);
    }
    if (recordCount(scan) > 0 && scan.records.kind.data[0] === RECORD_ROW) {
      sep();
      const toggle = el('button', 'marxy-table-lens-count', header ? 'Row 1 used as header' : 'Row 1 is data');
      toggle.type = 'button';
      toggle.title = header ? 'Make row 1 a data row · the file is unchanged' : 'Use row 1 as the header · the file is unchanged';
      toggle.setAttribute('aria-pressed', String(header));
      toggle.dataset.action = 'header';
      toggle.addEventListener('click', () => lens.setHeader(!header));
      parts.push(toggle);
    }
    if (decodedFields > 0) {
      sep();
      parts.push(countButton(`${plural(decodedFields, 'field')} decoded`, () => fieldsWhere((f) => (scan.fields.flags.data[f]! & FIELD_DECODED) !== 0), 'decoded fields'));
    }
    const unreadable = scan.faults.size;
    if (unreadable > 0) {
      sep();
      parts.push(countButton(`${plural(unreadable, 'row')} unreadable`, () => recordsWhere((r) => scan.records.kind.data[r] === RECORD_UNREADABLE), 'unreadable rows'));
    }
    // Ragged rows (ADR-0071 item 3), told against the field count most rows have: a short row's missing cells are absent,
    // a long row's extra fields are columns of their own; nothing is padded or trimmed.
    let usual = 0;
    let most = -1;
    for (const [count, n] of fieldCounts) if (n > most || (n === most && count > usual)) [usual, most] = [count, n];
    let short = 0;
    let long = 0;
    for (const [count, n] of fieldCounts) {
      if (count < usual) short += n;
      else if (count > usual) long += n;
    }
    const widthOf = (r: number): number => fieldsOf(scan, r)[1] - fieldsOf(scan, r)[0];
    if (short > 0) {
      sep();
      parts.push(
        countButton(
          `${plural(short, 'row')} short of ${usual} fields`,
          () => recordsWhere((r) => scan.records.kind.data[r] === RECORD_ROW && widthOf(r) < usual),
          'short rows (their missing cells are absent, not empty)',
        ),
      );
    }
    if (long > 0) {
      sep();
      parts.push(
        countButton(
          `${plural(long, 'row')} longer than ${usual} fields`,
          () => recordsWhere((r) => scan.records.kind.data[r] === RECORD_ROW && widthOf(r) > usual),
          'long rows (their extra fields are columns of their own)',
        ),
      );
    }
    const blanks = scan.blanks.length / 2;
    if (blanks > 0) {
      sep();
      parts.push(
        countButton(
          `${plural(blanks, 'blank line')} left out`,
          () => Array.from({ length: Math.min(blanks, PLACES + 1) }, (_, i) => ({ title: `Line ${lineOf(scan.blanks.data[i * 2]!)}`, start: scan.blanks.data[i * 2]!, end: scan.blanks.data[i * 2]! })),
          'blank lines',
        ),
      );
    }
    if (recordCount(scan) > 0 && scan.records.kind.data[recordCount(scan) - 1] === RECORD_PENDING) {
      sep();
      parts.push('the last record is unfinished');
    }
    if (sort) {
      sep();
      parts.push(`sorted by ${headerLabel(sort.col)} ${sort.dir === 'asc' ? '↑' : '↓'} · the file is unchanged`);
    }
    if (busy) {
      sep();
      parts.push(busy);
    }
    sep();
    const back = el('button', 'marxy-table-lens-count', 'Source Esc');
    back.type = 'button';
    back.title = 'Back to Source at this row';
    back.dataset.action = 'source';
    back.addEventListener('click', () => void lens.close());
    parts.push(back);
    info.replaceChildren(...parts);
  }

  function fieldsWhere(test: (f: number) => boolean): { title: string; start: number; end: number }[] {
    const out: { title: string; start: number; end: number }[] = [];
    for (let r = 0; r < recordCount(scan) && out.length <= PLACES; r++) {
      if (scan.records.kind.data[r] !== RECORD_ROW) continue;
      const [first, end] = fieldsOf(scan, r);
      for (let f = first; f < end && out.length <= PLACES; f++) {
        if (test(f)) out.push({ title: `Row ${r - base() + 1}, ${headerLabel(f - first)} · line ${lineOf(scan.fields.start.data[f]!)}`, start: scan.fields.start.data[f]!, end: scan.fields.end.data[f]! });
      }
    }
    return out;
  }

  function drawFoot(): void {
    if (!statsOn) {
      tfoot.hidden = true;
      tfoot.replaceChildren();
      return;
    }
    tfoot.hidden = false;
    const tr = el('tr', 'marxy-table-lens-stats');
    const rn = el('th', 'marxy-table-lens-rn', 'Σ');
    rn.scope = 'row';
    rn.title = 'Column stats · from the decoded values; the file is unchanged';
    tr.append(rn);
    const fmt = (v: number | null): string => (v === null ? '—' : Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 3 }));
    if (win.first > 0) tr.append(hSpacer('td'));
    for (let c = win.first; c < win.last; c++) {
      const td = el('td');
      td.dataset.col = String(c);
      const s = stats?.[c] ?? null;
      if (s === null) {
        td.textContent = '…';
      } else {
        const line = (label: string, value: string): HTMLElement => {
          const d = el('div');
          d.append(el('span', 'marxy-table-lens-stat', label), ` ${value}`);
          return d;
        };
        if (s.numbers > 0) td.append(line('min', fmt(s.min)), line('max', fmt(s.max)), line('mean', fmt(s.mean)));
        td.append(line('count', fmt(s.count)), line('empty', fmt(s.empty + s.absent)));
      }
      tr.append(td);
    }
    if (win.last < columns) tr.append(hSpacer('td'));
    tfoot.replaceChildren(tr);
  }

  // ---- order and stats -----------------------------------------------------------------------------------------------
  const pace = (mine: number, count: 'sort' | 'stats'): Pace => ({
    yieldNow,
    budgetMs: SLICE_MS,
    aborted: () => closed || mine !== generation,
    onSlice: () => {
      slices[count]++;
    },
  });

  /** The record indexes in the file's order, header left out. */
  const fileOrder = (): Int32Array => Int32Array.from({ length: Math.max(0, recordCount(scan) - base()) }, (_, i) => i + base());

  async function applySort(): Promise<void> {
    const mine = generation;
    await reading;
    if (closed || mine !== generation) return;
    if (sort === null) {
      order = null;
    } else {
      const want = sort;
      busy = `Sorting by ${headerLabel(want.col)}…`;
      table.setAttribute('aria-busy', 'true');
      drawInfo();
      const rows = fileOrder();
      slices.sort = 0;
      const keys = await sortKeysSliced(scan, rows, want.col, typeOf(want.col) === 'number', pace(mine, 'sort'));
      const sorted = keys ? await sortSliced(rows, compareByKeys(keys, want.dir === 'desc'), pace(mine, 'sort')) : null;
      busy = null;
      table.removeAttribute('aria-busy');
      if (!sorted || closed || mine !== generation || sort !== want) return;
      order = sorted;
    }
    selected = null;
    version++;
    drawHead();
    drawBody(true);
    drawInfo();
  }

  /**
   * Counts the columns in view that are not yet counted, one column at a time and each in slices, and again for the
   * columns a scroll brings in. A file of thousands of columns is never counted whole (F-89): the foot shows what is
   * in view, and the rest is counted when it is.
   */
  async function applyStats(): Promise<void> {
    statsQueued = false;
    const mine = generation;
    if (!statsOn) {
      stats = null;
      drawFoot();
      return;
    }
    if (stats === null) {
      stats = new Array<ColumnStats | null>(columns).fill(null);
      drawFoot();
    }
    await reading;
    if (closed || mine !== generation || !statsOn) return;
    if (stats.length !== columns) stats = Array.from({ length: columns }, (_, c) => stats?.[c] ?? null);
    const rows = fileOrder();
    slices.stats = 0;
    for (;;) {
      const here = colWindow();
      let c = here.first;
      while (c < here.last && stats[c] !== null) c++;
      if (c >= here.last) break;
      const s = await columnStatsSliced(scan, rows, c, pace(mine, 'stats'));
      if (s === null || !statsOn || closed || mine !== generation || stats === null) return;
      stats[c] = s;
      drawFoot();
    }
  }

  /** Asks for the columns now in view to be counted, once, after any count under way. */
  function wantStats(): void {
    if (statsQueued || !statsOn) return;
    statsQueued = true;
    void queue(applyStats);
  }

  const queue = (fn: () => Promise<void>): Promise<void> => {
    work = work.then(fn, fn);
    return work;
  };

  async function cycleSort(c: number): Promise<void> {
    const next: 'asc' | 'desc' | null = sort?.col !== c ? 'asc' : sort.dir === 'asc' ? 'desc' : null;
    await lens.sortBy(c, next);
  }

  // ---- selection, copy, menus ----------------------------------------------------------------------------------------
  function select(pos: number, col: number, scroll = true): void {
    const total = viewLength();
    if (total === 0) return;
    selected = { pos: Math.max(0, Math.min(total - 1, pos)), col: Math.max(0, Math.min(Math.max(0, columns - 1), col)) };
    if (scroll) {
      scrollToPos(selected.pos);
      scrollToCol(selected.col);
    }
    version++;
    drawBody(true);
  }

  function scrollToPos(pos: number): void {
    const h = rowH || 24;
    const k = scale();
    const head = thead.getBoundingClientRect().height;
    const foot = tfoot.hidden ? 0 : tfoot.getBoundingClientRect().height;
    const view = scroller.clientHeight - head - foot;
    const virtualTop = scroller.scrollTop * k;
    const y = pos * h;
    if (y < virtualTop) scroller.scrollTop = y / k;
    else if (y + h > virtualTop + view) scroller.scrollTop = (y + h - view) / k;
  }

  /** Brings column `col` into view, under the row-number column that stays put on the left. */
  function scrollToCol(col: number): void {
    if (col < 0 || col >= columns) return;
    const rn = colX[0]!;
    const left = colX[col]!;
    const right = colX[col + 1]!;
    const x = scroller.scrollLeft;
    const room = scroller.clientWidth;
    if (left - rn < x) scroller.scrollLeft = Math.max(0, left - rn);
    else if (right > x + room) scroller.scrollLeft = right - room;
  }

  /** The cell node of the selection: the raw field in bytes, or null for an absent cell or a row that is not one. */
  function selectedCell(): { readonly f: number; readonly r: number } | null {
    if (!selected) return null;
    const r = recordAt(selected.pos);
    if (scan.records.kind.data[r] !== RECORD_ROW) return null;
    const [first, end] = fieldsOf(scan, r);
    return first + selected.col < end ? { f: first + selected.col, r } : null;
  }

  async function copyValue(): Promise<void> {
    const cell = selectedCell();
    const ctx = buildAppContext(appHandle());
    if (!cell) {
      notify({ kind: 'refused', text: 'Nothing to copy · this cell is absent: its row has no field here · Copy as copies the row\'s table' });
      return;
    }
    // A single cell copies its decoded value, as the reader reads it, with no formula guard (ADR-0071 item 5).
    await writeCopy(ctx, { text: cellOf(scan, cell.f, file).value }, 'Copied the cell');
  }

  async function copySourceField(): Promise<void> {
    const cell = selectedCell();
    if (!cell) return;
    const node = cellOf(scan, cell.f, file);
    // The exact bytes of the raw field, quotes and doubled quotes included.
    await writeCopy(buildAppContext(appHandle()), { text: rawText(scan, node.src.start, node.src.end) }, 'Copied the source field (CSV)');
  }

  /** The grid as shown (header, then rows in the view's order), each cell's decoded value; an unreadable row is its raw line. */
  async function gridAsShown(): Promise<string[][]> {
    await reading;
    const grid: string[][] = [];
    if (header) grid.push(Array.from({ length: columns }, (_, c) => headerLabel(c)));
    const total = viewLength();
    for (let pos = 0; pos < total; pos++) {
      const r = recordAt(pos);
      if (scan.records.kind.data[r] !== RECORD_ROW) {
        grid.push([rawText(scan, scan.records.start.data[r]!, scan.records.end.data[r]!)]);
      } else {
        const [first, end] = fieldsOf(scan, r);
        const row: string[] = [];
        for (let c = 0; c < Math.max(columns, end - first); c++) row.push(first + c < end ? fieldValue(scan, first + c) : '');
        grid.push(row);
      }
      if ((pos & 8191) === 8191) await yieldNow();
    }
    return grid;
  }

  async function copyTable(format: 'tsv' | 'csv'): Promise<void> {
    const grid = await gridAsShown();
    // Many cells the reader has not each seen: every one that a spreadsheet would run is guarded (03-selection-and-operations.md).
    const text = format === 'tsv' ? tsvOf(grid) : csvOf(grid);
    await writeCopy(buildAppContext(appHandle()), { text }, `Copied the table as ${format.toUpperCase()}`);
  }

  function anchorOfSelection(): MenuAnchor {
    const td = selected ? tbody.querySelector<HTMLElement>(`#marxy-table-lens-${generation}-${selected.pos}-${selected.col}`) : null;
    const box = (td ?? scroller).getBoundingClientRect();
    return td ? { x: Math.round(box.left), y: Math.round(box.bottom), top: Math.round(box.top) } : { x: Math.round(box.left + 40), y: Math.round(box.top + 60) };
  }

  function copyAsRows(): VerbMenuRow[] {
    const rows: VerbMenuRow[] = [];
    if (selectedCell()) rows.push({ command: null, key: 'table.copy-value', title: 'Value (plain text)', run: copyValue });
    if (csv && selectedCell()) rows.push({ command: null, key: 'table.copy-source-field', title: 'Source field (CSV)', run: copySourceField });
    rows.push({ command: null, key: 'table.copy-tsv', title: 'Table as TSV', run: () => copyTable('tsv') });
    rows.push({ command: null, key: 'table.copy-csv', title: 'Table as CSV', run: () => copyTable('csv') });
    return rows;
  }

  function openCopyAs(at: MenuAnchor = anchorOfSelection()): void {
    openVerbMenu(at, buildAppContext(appHandle()), { registered: [], allActions: () => {}, rows: copyAsRows(), label: 'Copy as' });
  }

  /** The `cell` verbs, in ADR-0071 item 6's order. */
  function openCellMenu(at: MenuAnchor = anchorOfSelection()): void {
    if (!selected) return;
    const cell = selectedCell();
    const col = selected.col;
    const r = recordAt(selected.pos);
    const rows: VerbMenuRow[] = [];
    if (cell) rows.push({ command: null, key: 'table.copy', title: 'Copy', chord: 'Mod+C', run: copyValue });
    rows.push({ command: null, key: 'table.copy-as', title: 'Copy as…', chord: 'Mod+Shift+C', run: () => openCopyAs(at) });
    if (csv && cell) rows.push({ command: null, key: 'table.copy-source-field', title: 'Source field (CSV)', run: copySourceField });
    rows.push({ command: null, key: 'table.column-stats', title: statsOn ? 'Hide column stats' : 'Column stats', run: () => lens.setStats() });
    rows.push({ command: null, key: 'table.sort', title: sort?.col === col && sort.dir === 'asc' ? 'Sort by this column, descending' : 'Sort by this column', run: () => cycleSort(col) });
    if (cell) {
      const node = cellOf(scan, cell.f, file);
      rows.push({ command: null, key: 'table.jump', title: 'Jump to source', run: () => jumpToSource(node.src.start, node.src.end) });
    } else {
      rows.push({ command: null, key: 'table.jump', title: 'Jump to source', run: () => jumpToSource(scan.records.start.data[r]!, scan.records.end.data[r]!) });
    }
    rows.push({ command: null, key: 'table.open-source', title: 'Open in Source', run: () => lens.close() });
    openVerbMenu(at, buildAppContext(appHandle()), { registered: [], allActions: () => {}, rows, label: 'Cell' });
  }

  /** Leaves the grid and selects bytes `[start, end)` in Source: a cell lands on its whole raw field. */
  async function jumpToSource(start: number, end: number): Promise<void> {
    closeVerbMenu();
    await teardown();
    await pane.view.jumpToSource(start);
    const { activeSourceEditor } = await import('../source/editor.ts');
    const { utf16ToCmPos } = await import('../source/cm-position.ts');
    const editor = activeSourceEditor(mount);
    const buffer = store.snapshot().buffer;
    if (!editor) return;
    const state = editor.view.state;
    const from = utf16ToCmPos(buffer, state, byteToUtf16(buffer, start));
    const to = utf16ToCmPos(buffer, state, byteToUtf16(buffer, end));
    editor.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    editor.view.focus();
  }

  // ---- events --------------------------------------------------------------------------------------------------------
  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const isMod = (e: KeyboardEvent | MouseEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

  root.addEventListener('keydown', (event) => {
    if (event.target instanceof Element && event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) return;
    const page = Math.max(1, Math.floor((scroller.clientHeight - 60) / (rowH || 24)));
    const at = selected ?? { pos: Math.floor((scroller.scrollTop * scale()) / (rowH || 24)), col: 0 };
    let handled = true;
    if (event.key === 'Escape' && !event.altKey && !isMod(event)) void lens.close();
    else if (event.key === 'ArrowDown' && !isMod(event)) select(selected ? at.pos + 1 : at.pos, at.col);
    else if (event.key === 'ArrowUp' && !isMod(event)) select(at.pos - 1, at.col);
    else if (event.key === 'ArrowRight' && !isMod(event)) select(at.pos, selected ? at.col + 1 : at.col);
    else if (event.key === 'ArrowLeft' && !isMod(event)) select(at.pos, at.col - 1);
    else if (event.key === 'PageDown') select(at.pos + page, at.col);
    else if (event.key === 'PageUp') select(at.pos - page, at.col);
    else if (event.key === 'Home') select(isMod(event) ? 0 : at.pos, 0);
    else if (event.key === 'End') select(isMod(event) ? viewLength() - 1 : at.pos, columns - 1);
    else if ((event.key === 'c' || event.key === 'C') && isMod(event) && !event.altKey) {
      const native = document.getSelection();
      // A drag across the grid is `derived-text`: the webview copies it as displayed.
      if (!event.shiftKey && native && !native.isCollapsed && root.contains(native.anchorNode)) {
        event.stopPropagation();
        return;
      }
      if (event.shiftKey) openCopyAs();
      else if (selected) void copyValue();
      else handled = false;
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey) || (event.key === 'Enter' && selected)) {
      openCellMenu();
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });

  const cellAt = (target: EventTarget | null): { pos: number; col: number } | null => {
    const td = target instanceof Element ? target.closest<HTMLElement>('tbody td[data-col]') : null;
    const tr = td?.closest<HTMLElement>('tr[data-record]');
    if (!td || !tr) return null;
    const pos = Number(tr.getAttribute('aria-rowindex')) - 2;
    return { pos, col: Number(td.dataset.col) };
  };

  tbody.addEventListener('click', (event) => {
    const at = cellAt(event.target);
    const native = document.getSelection();
    if (!at || (native && !native.isCollapsed)) return;
    select(at.pos, at.col, false);
    table.focus({ preventScroll: true });
  });
  tbody.addEventListener('contextmenu', (event) => {
    const at = cellAt(event.target);
    if (!at) return;
    event.preventDefault();
    select(at.pos, at.col, false);
    openCellMenu({ x: event.clientX, y: event.clientY });
  });
  scroller.addEventListener('scroll', scheduleDraw, { passive: true });
  const resize = new ResizeObserver(() => {
    if (scroller.clientWidth !== fittedTo && columns > 0) fitWidths();
    scheduleDraw();
  });
  resize.observe(scroller);

  // A mode switch hides the mount; another document empties it: either way the lens is gone.
  const watch = new MutationObserver(() => {
    if (mount.hidden || !root.isConnected) void teardown();
  });
  watch.observe(mount, { attributes: true, attributeFilter: ['hidden'], childList: true });
  // An external change reloads the store: the grid is derived again, and the sort and the stats follow it.
  const unsubscribe = store.subscribe((snap) => {
    if (closed || snap.buffer.bytes === scan.bytes) return;
    const top = scroller.scrollTop;
    scan = createScan(snap.buffer.bytes, csv ? ',' : '\t');
    columns = 0;
    profiles = [];
    profileRow0 = [];
    counted = 0;
    decodedFields = 0;
    fieldCounts.clear();
    order = null;
    selected = null;
    stats = null;
    read();
    scroller.scrollTop = top;
    if (sort) void queue(applySort);
    if (statsOn) wantStats();
  });

  async function teardown(): Promise<void> {
    if (closed) return;
    closed = true;
    generation++;
    if (frame) cancelAnimationFrame(frame);
    watch.disconnect();
    resize.disconnect();
    unsubscribe();
    lenses.delete(mount);
    root.remove();
    mount.removeAttribute(LENS_ATTRIBUTE);
    mount.querySelector<HTMLElement>('.marxy-source-frame')?.removeAttribute('inert');
  }

  const lens: TableLens = {
    pane,
    async close(opts = {}) {
      if (closed) return;
      // The row the reader is on: the selected one, else the first on screen. Its first byte is a file offset (ADR-0018).
      const pos = selected?.pos ?? Math.floor((scroller.scrollTop * scale()) / (rowH || 24));
      const r = viewLength() > 0 ? recordAt(Math.max(0, Math.min(viewLength() - 1, pos))) : -1;
      const byte = r >= 0 ? scan.records.start.data[r]! : 0;
      closeVerbMenu();
      await teardown();
      if (opts.toSource === false) return;
      await pane.view.jumpToSource(byte);
      const { activeSourceEditor } = await import('../source/editor.ts');
      activeSourceEditor(mount)?.view.focus();
    },
    setStats(on) {
      statsOn = on ?? !statsOn;
      statsQueued = true;
      return queue(applyStats);
    },
    sortBy(col, dir) {
      sort = dir === null ? null : { col, dir };
      drawInfo();
      return queue(applySort);
    },
    setHeader(on) {
      headerChosen = on;
      header = on;
      selected = null;
      version++;
      drawHead();
      drawBody(true);
      drawInfo();
      if (sort) void queue(applySort);
      stats = null;
      if (statsOn) wantStats();
    },
    async settled() {
      for (;;) {
        const r = reading;
        const w = work;
        await r;
        await w;
        if (r === reading && w === work) return;
      }
    },
    state() {
      const total = viewLength();
      return {
        done: scan.done,
        records: recordCount(scan),
        header,
        columns,
        types: types(),
        sort: sort ? { ...sort } : null,
        stats: stats ? [...stats] : null,
        selected: selected ? { ...selected, record: recordAt(selected.pos) } : null,
        order: Array.from({ length: Math.min(total, 10_000) }, (_, i) => recordAt(i)),
        firstDraw,
        slices: { ...slices },
      };
    },
  };

  lenses.set(mount, lens);
  mount.setAttribute(LENS_ATTRIBUTE, 'table');
  // The editor stays mounted and keeps its place under the grid, but takes no focus or key while covered.
  mount.querySelector<HTMLElement>('.marxy-source-frame')?.setAttribute('inert', '');
  mount.append(root);
  read();
  table.focus({ preventScroll: true });
  return lens;
}
