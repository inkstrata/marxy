// A spreadsheet as the table page: each sheet with the column letters and row numbers
// a sheet is addressed by, values as saved in the file's own formats where that is cheap, a formula's cell marked in its
// corner and Formulas on request for the tab, merged ranges drawn merged, errors and missing values shown as saved. The
// sheets are in the bar at the page's foot, hidden ones in italic and marked. 2,000 rows are drawn at a time, then a
// line and the step to the next. Nothing recalculates, no macro runs, no link is followed. Source is the bytes.
// The cursor walks rows, then a row's cells (`#Summary!5`, `#Summary!F5`); `]` and `[` step the sheets.
import { accountElement } from '../frame/account.ts';
import {
  COLUMNS_DRAWN,
  SHEET_DRAW,
  bookLabel,
  bookAccount,
  bookLine,
  cellName,
  colName,
  csvOf,
  drawCap,
  hiddenWords,
  plural,
  savedType,
  sheetCsvValue,
  sheetGrid,
  sheetValue,
  sheetWords,
  type GridCell,
  type GridRow,
} from '@marxy/core/src/viewer/tables.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { BookSummary, SheetCell, SheetPage, SheetPart } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { el, factRow } from '../frame/dom.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { byteCard, factsCard } from './cards.ts';
import { fileCardElement } from './card.ts';
import { dateWords, type ViewedFile } from './file.ts';
import { asItIs } from './exports.ts';
import { createHexView, type HexView } from './hex.ts';
import { partsBar } from './parts-bar.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { csvExport, tablesReadingCard } from './table-cards.ts';
import { textBox } from '../parts/xray-box.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerExport, ViewerPlace, ViewMode } from './types.ts';
import css from './tables.css?inline';

const n2 = (n: number): string => n.toLocaleString('en-GB');
const EXPORT_PAGE = 100_000;

interface Kept {
  sheet: number;
  from: Map<number, number>;
  formulas: boolean;
  /** The cell picked, by its row and column from A1 (0-based). */
  cell: { r: number; c: number } | null;
  asCard: boolean;
}

const kept = new Map<string, Kept>();

export interface SheetOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly book: BookSummary;
  readonly place?: ViewerPlace;
}

/** "18 Oct 2026, 09:00" from the file's own ISO time, or the text as written. */
function whenWords(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? iso : dateWords(ms + new Date(ms).getTimezoneOffset() * 60_000);
}

export function createSheetViewer(o: SheetOptions): PaneViewer {
  const { shell, file, book } = o;
  const path = file.path;
  adoptRuntimeSheet(document, 'marxy-tables-style', css);
  const firstVisible = Math.max(0, book.sheets.findIndex((s) => s.state === 'visible'));
  const state: Kept = kept.get(path) ?? { sheet: firstVisible, from: new Map(), formulas: false, cell: null, asCard: false };
  kept.set(path, state);
  if (kept.size > 50) kept.delete(kept.keys().next().value!);
  if (state.sheet >= book.sheets.length) state.sheet = firstVisible;

  const id = nextViewerId();
  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let page: SheetPage | null = null;
  let pageFor = '';
  let reading = 0;
  let failed: string | null = null;
  let scrollBack = o.place?.scroll?.top ?? null;
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const sheet = (): SheetPart | undefined => book.sheets[state.sheet];
  const fromOf = (i: number): number => state.from.get(i) ?? 0;
  const cellAt = (r: number, c: number): SheetCell | undefined => page?.cells.find(([pr, pc]) => pr === r && pc === c)?.[2];

  async function load(): Promise<void> {
    const s = sheet();
    if (!s || s.kind !== 'worksheet') return;
    const want = `${state.sheet}\u0000${fromOf(state.sheet)}`;
    if (pageFor === want && page) return;
    const ticket = ++reading;
    failed = null;
    try {
      const got = (await shell.tablesRows(path, s.name, fromOf(state.sheet), SHEET_DRAW)) as SheetPage;
      if (ticket !== reading) return;
      page = got;
    } catch (e) {
      if (ticket !== reading) return;
      page = null;
      failed = e instanceof Error ? e.message : String(e);
    }
    pageFor = want;
    draw();
    viewerChanged();
    // The cursor went to a row of a page not drawn yet: it is brought into view now that it is.
    if (revealing) {
      const [, r, c] = revealing.split('!');
      rowsTo(Number(r));
      const el = drawnEl(revealing);
      revealing = null;
      if (el && c !== undefined) pickCell(Number(r), Number(c));
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function pickSheet(i: number): Promise<void> {
    if (i === state.sheet) return Promise.resolve();
    state.sheet = i;
    state.cell = null;
    page = null;
    draw();
    viewerChanged();
    return load();
  }

  function goTo(from: number, toTop = true): void {
    state.from.set(state.sheet, from);
    state.cell = null;
    page = null;
    draw();
    viewerChanged();
    void load();
    if (!toTop) return;
    requestAnimationFrame(() => {
      const scroller = host?.querySelector<HTMLElement>('.marxy-tpage');
      if (scroller) scroller.scrollTop = 0;
    });
  }

  function pickCell(r: number, c: number): void {
    state.cell = { r, c };
    for (const td of host?.querySelectorAll('.marxy-tbl-grid td[aria-selected="true"]') ?? []) td.setAttribute('aria-selected', 'false');
    host?.querySelector(`.marxy-tbl-grid td[data-marxy-cell="${cellName(r, c)}"]`)?.setAttribute('aria-selected', 'true');
    viewerChanged();
  }

  function cellEl(r: number, g: GridCell): HTMLTableCellElement {
    const td = el('td');
    const name = cellName(r, g.c);
    td.dataset.marxyCell = name;
    if (g.span) {
      if (g.span.cols > 1) td.colSpan = g.span.cols;
      if (g.span.rows > 1) td.rowSpan = g.span.rows;
    }
    const cls = ['marxy-tbl-cell'];
    if (g.span) cls.push('marxy-tbl-merged');
    const cell = g.cell;
    const showFormula = state.formulas && cell?.f !== undefined;
    if (showFormula) {
      cls.push('marxy-tbl-formula');
      td.append(el('code', 'marxy-tbl-fx', `=${cell!.f}`));
    } else {
      const shown = sheetValue(cell, book.formats);
      if (shown.kind === 'num' || shown.kind === 'date') cls.push('marxy-table-lens-num');
      if (shown.kind === 'err') cls.push('marxy-tbl-err');
      if (shown.kind === 'none') cls.push('marxy-tbl-none');
      if (shown.kind === 'bool') cls.push('marxy-tbl-bool');
      td.append(shown.text.length > 200 ? `${shown.text.slice(0, 200)}…` : shown.text);
      if (shown.more) td.append(el('span', 'marxy-tbl-more', ` +${n2(shown.more)} more`));
    }
    if (cell?.f !== undefined) cls.push('marxy-tbl-hasf');
    td.className = cls.join(' ');
    td.setAttribute('aria-selected', String(state.cell?.r === r && state.cell.c === g.c));
    return td;
  }

  // A page is up to 2,000 rows of 100 cells: its rows are made as they come near the screen, a step at a time, never
  // all at once. The step is a few thousand cells, so a narrow sheet takes more rows a step than a wide one.
  const STEP_CELLS = 2000;
  let grid: { readonly rows: readonly GridRow[]; readonly tbody: HTMLElement; readonly step: number; drawn: number } | null = null;
  let filler: ResizeObserver | null = null;

  function appendRows(n: number): void {
    const g = grid;
    if (!g) return;
    const end = Math.min(g.rows.length, g.drawn + n);
    for (; g.drawn < end; g.drawn++) {
      const row = g.rows[g.drawn]!;
      const tr = el('tr');
      tr.dataset.marxyRow = String(row.r);
      const th = el('th', 'marxy-table-lens-rn', String(row.r + 1));
      th.scope = 'row';
      tr.append(th);
      for (const c of row.cells) tr.append(cellEl(row.r, c));
      g.tbody.append(tr);
    }
  }

  /** Rows made until the last is past the foot of the pane; true when any were. */
  function fillRows(): boolean {
    const g = grid;
    const scroller = host?.querySelector<HTMLElement>('.marxy-tpage');
    if (!g || !scroller || !g.tbody.isConnected || scroller.clientHeight === 0) return false;
    const foot = scroller.getBoundingClientRect().bottom;
    const before = g.drawn;
    while (g.drawn < g.rows.length && (g.tbody.lastElementChild?.getBoundingClientRect().bottom ?? 0) < foot) appendRows(g.step);
    if (g.drawn === before) return false;
    paintMarks();
    return true;
  }

  /** Row `r` of the page drawn made, with every row before it. */
  function rowsTo(r: number): void {
    if (!grid || !page) return;
    const want = r - page.from + 1;
    if (want > grid.drawn) {
      appendRows(want - grid.drawn);
      paintMarks();
    }
  }

  /** The row and column (0-based) of a cell named "F5". */
  function cellOfName(name: string): { r: number; c: number } | null {
    const m = /^([A-Z]+)(\d+)$/.exec(name);
    if (!m) return null;
    let n = 0;
    for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
    return { r: Number(m[2]) - 1, c: n - 1 };
  }

  function sheetPage(s: SheetPart, wrap: HTMLElement): void {
    const top = el('div', 'marxy-tbl-bar');
    const seg = el('span', 'marxy-tbl-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Show');
    for (const [label, on] of [['Values', false], ['Formulas', true]] as const) {
      const b = el('button', 'marxy-tbl-segb', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.formulas === on));
      b.addEventListener('click', () => {
        if (state.formulas === on) return;
        state.formulas = on;
        draw();
        viewerChanged();
      });
      seg.append(b);
    }
    top.append(seg, el('span', 'marxy-tbl-sub', sheetWords(s)));
    wrap.append(top);
    if (s.cut) wrap.append(el('p', 'marxy-tbl-note', `This sheet was ${s.cut}.`));
    if (s.kind !== 'worksheet') return;
    if (failed) {
      wrap.append(el('p', 'marxy-tbl-note', `The sheet could not be read: ${failed}`));
      return;
    }
    if (!page || pageFor !== `${state.sheet}\u0000${fromOf(state.sheet)}`) {
      wrap.append(el('p', 'marxy-tbl-note', 'Reading the sheet…'));
      return;
    }
    const cols = Math.max(1, Math.min(s.cols, COLUMNS_DRAWN));
    const scroll = el('div', 'marxy-tbl-scroll');
    const table = el('table', 'marxy-table-lens-grid marxy-tbl-grid marxy-tbl-sheet');
    table.setAttribute('aria-label', `The cells of ${s.name}`);
    const head = el('tr');
    head.append(el('th', 'marxy-table-lens-rn marxy-tbl-corner'));
    for (let c = 0; c < cols; c++) {
      const th = el('th', 'marxy-tbl-col', colName(c));
      th.scope = 'col';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    const to = Math.min(s.rows, page.to);
    table.setAttribute('aria-rowcount', String(to - page.from + 1));
    tbody.addEventListener('click', (e) => {
      const td = (e.target as Element).closest<HTMLElement>('td[data-marxy-cell]');
      const at = td ? cellOfName(td.dataset.marxyCell ?? '') : null;
      if (at) pickCell(at.r, at.c);
    });
    grid = { rows: sheetGrid({ ...page, to }, cols), tbody, step: Math.max(20, Math.ceil(STEP_CELLS / cols)), drawn: 0 };
    appendRows(grid.step);
    table.append(thead, tbody);
    scroll.append(table);
    wrap.append(scroll);
    if (s.cols > COLUMNS_DRAWN) wrap.append(el('p', 'marxy-tbl-note', `The first ${n2(COLUMNS_DRAWN)} of ${n2(s.cols)} columns are drawn.`));
    const cap = drawCap(fromOf(state.sheet), s.rows);
    if (cap) {
      const line = el('p', 'marxy-tbl-drawcap');
      line.append(cap.text);
      for (const step of [cap.next, cap.back]) {
        if (!step) continue;
        const b = el('button', 'marxy-btn', `Rows ${n2(step[0] + 1)} to ${n2(step[1])}`);
        b.type = 'button';
        b.addEventListener('click', () => goTo(step[0]));
        line.append(' ', b);
      }
      wrap.append(line);
    }
  }

  function tablePage(): HTMLElement {
    const pageEl = el('div', 'marxy-tpage');
    pageEl.tabIndex = -1;
    const wrap = el('div', 'marxy-tbl');
    const account = accountElement(bookAccount(state.formulas), bookLine(book), 'marxy-tbl-line');
    if (account) wrap.append(account);
    const s = sheet();
    if (s) sheetPage(s, wrap);
    else wrap.append(el('p', 'marxy-tbl-note', 'The workbook holds no sheets.'));
    pageEl.append(
      wrap,
      partsBar({
        label: `Sheets in ${basename(path)}`,
        groups: [{ label: 'Sheets', items: book.sheets.map((x, i) => ({ id: String(i), name: x.name, mark: hiddenWords(x) ?? undefined })) }],
        selected: String(state.sheet),
        pick: (i) => pickSheet(Number(i)),
      }),
    );
    return pageEl;
  }

  function setCard(on: boolean): void {
    state.asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const scroller = host.querySelector<HTMLElement>('.marxy-tpage');
    const top = scrollBack ?? scroller?.scrollTop ?? 0;
    scrollBack = null;
    grid = null;
    filler?.disconnect();
    filler = null;
    if (mode === 'source') {
      const view = ensureHex();
      const pageEl = el('div', 'marxy-hexpage');
      pageEl.append(view.el);
      host.replaceChildren(pageEl);
      requestAnimationFrame(() => view.draw());
      return;
    }
    if (state.asCard) {
      const pageEl = el('div', 'marxy-fcpage');
      const side = el('div', 'marxy-fchex');
      const view = ensureHex();
      side.append(view.el);
      pageEl.append(fileCardElement({ shell, file, back: { words: 'Show the workbook instead', run: () => setCard(false) } }, () => host?.closest<HTMLElement>('section.marxy-pane') ?? undefined), side);
      host.replaceChildren(pageEl);
      requestAnimationFrame(() => view.draw());
      return;
    }
    const pageEl = tablePage();
    host.replaceChildren(pageEl);
    // The rows down to the place kept are made first, or the scroll would stop short at the rows made so far.
    do pageEl.scrollTop = top;
    while (pageEl.scrollTop < top && fillRows());
    fillRows();
    paintMarks();
    pageEl.addEventListener('scroll', () => fillRows(), { passive: true });
    filler = new ResizeObserver(() => fillRows());
    filler.observe(pageEl);
  }

  const readingCardDef = tablesReadingCard({
    file,
    shownAs: () => (state.asCard && mode === 'rendered' ? 'a file card and the bytes' : `a spreadsheet · ${book.format}`),
    tiers: [
      { name: 'Every sheet, as cells', words: `drawn ${n2(SHEET_DRAW)} rows at a time` },
      { name: 'The bytes', words: 'when the workbook will not read' },
    ],
    at: () => (state.asCard ? 1 : 0),
    caps: [
      `${n2(SHEET_DRAW)} rows drawn at a time, then a step to the next`,
      'values as saved; nothing recalculates',
      'formulas shown as written, never run',
      'macros and links to other files never run or followed',
      'hidden sheets shown, marked',
    ],
    ways: () =>
      mode !== 'rendered'
        ? []
        : [state.asCard ? { words: 'Show the workbook instead', run: () => setCard(false) } : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }],
  });

  const sheetsCard: CardDef = {
    id: 'contents',
    title: () => 'Sheets',
    detail: () => n2(book.sheets.length),
    relevant: () => true,
    render(body) {
      const list = el('div', 'marxy-tbl-list');
      book.sheets.forEach((s, i) => {
        const b = el('button', 'marxy-tbl-item');
        b.type = 'button';
        b.setAttribute('aria-current', String(state.sheet === i));
        const label = el('span', 'marxy-tbl-item-name', s.name);
        const hidden = hiddenWords(s);
        if (hidden) label.append(el('span', 'marxy-tbl-item-kind', ` ${hidden}`));
        const count = s.kind === 'worksheet' ? `${plural(s.rows, 'row')}${s.formulas ? ` · ${n2(s.formulas)} ƒ` : ''}` : s.kind;
        b.append(label, el('span', 'marxy-tbl-item-count', count));
        b.addEventListener('click', () => pickSheet(i));
        list.append(b);
      });
      body.append(list);
    },
  };

  const workbookCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Workbook',
    detail: () => 'from the file’s own fields',
    relevant: () => true,
    render(body) {
      const p = book.properties;
      let format = bookLabel(book);
      if (book.parts !== null) format += ` · ${plural(book.parts, 'part')} in the zip`;
      if (book.compound) {
        const streams = book.compound.streams.filter(([n]) => /^(Workbook|Book)$/.test(n)).map(([n, size]) => `${n} (${n2(size)} bytes)`);
        format += ` · a compound file, ${n2(book.compound.sector)}-byte sectors${streams.length ? `, streams ${streams.join(', ')}` : ''}`;
      }
      body.append(factRow('format', format));
      const made = [p.application, p.appVersion].filter(Boolean).join(' ');
      if (made) body.append(factRow('made by', made));
      if (p.creator) body.append(factRow('author', p.creator));
      if (p.lastModifiedBy && p.lastModifiedBy !== p.creator) body.append(factRow('saved by', p.lastModifiedBy));
      const created = whenWords(p.created);
      const saved = whenWords(p.modified);
      if (created) body.append(factRow('created', created));
      if (saved) body.append(factRow('saved', saved));
      const hidden = book.sheets.filter((s) => s.state !== 'visible').map((s) => s.name);
      body.append(factRow('hidden', hidden.length ? hidden.join(', ') : 'none'));
      const formulas = book.sheets.reduce((n, s) => n + s.formulas, 0);
      body.append(factRow('formulas', formulas ? `${n2(formulas)}, shown as saved; never recalculated` : 'none'));
      body.append(factRow('macros', book.macros ? 'in the file, never run' : 'none'));
      body.append(factRow('links', book.links.length ? `${plural(book.links.length, 'other file')}, never followed: ${book.links.join(', ')}` : 'none to other files'));
      body.append(
        factRow(
          'formats',
          book.formatsRead
            ? 'the file’s own: percent, decimals, thousands and dates applied; fractions, conditions and elapsed times shown as General'
            : `not read from this ${book.format}: numbers as saved, dates as dates`,
        ),
      );
    },
  };

  const cellCard: CardDef = {
    id: 'selection',
    title: () => (state.cell ? `Cell ${cellName(state.cell.r, state.cell.c)}` : 'Cell'),
    detail: () => sheet()?.name ?? '',
    relevant: () => mode === 'rendered' && !state.asCard && state.cell !== null,
    render(body) {
      if (!state.cell) return;
      const cell = cellAt(state.cell.r, state.cell.c);
      const shown = sheetValue(cell, book.formats);
      const v = cell?.v ?? null;
      if (!cell) body.append(factRow('value', 'empty'));
      else {
        body.append(factRow('shows', shown.kind === 'none' ? 'nothing: no value was saved' : shown.text));
        if (v && (v.k === 'real' || v.k === 'int')) {
          const raw = v.k === 'int' ? v.v : v.v === undefined ? (v.s ?? '') : String(v.v);
          if (raw !== shown.text) body.append(factRow('stored', raw));
        }
        if (v && v.k === 'date' && v.iso.replace('T', ' ') !== shown.text) body.append(factRow('stored', `${v.iso.replace('T', ' ')} (serial ${v.v})`));
        body.append(factRow('type', savedType(cell)));
        const code = cell.x === undefined ? null : book.formats[cell.x];
        if (v && v.k !== 'text') {
          const fmt = el('span');
          fmt.append(el('code', 'marxy-fact-code', code ?? 'General'));
          if (!shown.applied) fmt.append(el('span', 'marxy-fact-quiet', ' · not applied here: shown as General'));
          body.append(factRow('format', fmt));
        }
        if (cell.f !== undefined) {
          body.append(factRow('formula', el('code', 'marxy-fact-code', `=${cell.f}`)));
          body.append(factRow('worked out', v?.k === 'none' ? 'never: the app that saved it did not calculate it' : 'by the app that saved it; the reader does not recalculate'));
        }
      }
      const m = page?.merges.find((x) => x[0] <= state.cell!.r && state.cell!.r <= x[2] && x[1] <= state.cell!.c && state.cell!.c <= x[3]);
      if (m) body.append(factRow('merged', `${cellName(m[0], m[1])}:${cellName(m[2], m[3])}`));
    },
  };

  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  function exports(): ViewerExport[] {
    const out: ViewerExport[] = [{ ...asItIs(shell, file, 'file'), name: 'The workbook, as it is' }];
    const s = sheet();
    if (s && s.kind === 'worksheet') {
      out.push(
        csvExport({
          id: 'csv',
          name: `${s.name} as CSV`,
          sub: 'every row, each value as it shows; no formulas',
          async build(keep) {
            const cols = s.cols;
            for (let from = 0; from < s.rows; from += EXPORT_PAGE) {
              const got = (await shell.tablesRows(path, s.name, from, EXPORT_PAGE, false, true)) as SheetPage;
              const rows: string[][] = [];
              for (let r = from; r < Math.min(s.rows, got.to); r++) rows.push(new Array<string>(cols).fill(''));
              for (const [r, c, cell] of got.cells) if (c < cols && rows[r - from]) rows[r - from]![c] = sheetCsvValue(cell, book.formats);
              if (!keep(csvOf(null, rows))) return;
            }
          },
        }),
      );
    }
    return out;
  }

  // The cursor walks rows and cells (j k, l h); the arrows scroll the page. Escape lets go of a cell the pointer picked,
  // and is the cursor's own while the cursor is set.
  function key(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape' || !state.cell || marked || e.ctrlKey || e.metaKey || e.altKey) return false;
    state.cell = null;
    draw();
    viewerChanged();
    return true;
  }

  // ---- the cursor's parts: a sheet's rows, every one of them, then each row's cells ----

  let marked: { head: string; run: Set<string> } | null = null;
  /** A row or cell the cursor went to on a page still being read: brought into view once it is drawn. */
  let revealing: string | null = null;

  const drawnTo = (s: SheetPart): number => (page ? Math.min(s.rows, page.to) : 0);
  const isDrawn = (r: number): boolean => {
    const s = sheet();
    return !!s && !!page && pageFor === `${state.sheet}\u0000${fromOf(state.sheet)}` && r >= page.from && r < drawnTo(s);
  };

  function drawnEl(id: string): HTMLElement | null {
    const [i, r, c] = id.split('!');
    if (Number(i) !== state.sheet || !isDrawn(Number(r))) return null;
    const tr = host?.querySelector('.marxy-tbl-sheet tbody')?.children[Number(r) - page!.from] as HTMLElement | undefined;
    if (c === undefined) return tr ?? null;
    return tr?.querySelector<HTMLElement>(`td[data-marxy-cell="${cellName(Number(r), Number(c))}"]`) ?? null;
  }

  function paintMarks(): void {
    for (const el of host?.querySelectorAll('.marxy-tbl-grid .marxy-selected') ?? []) el.classList.remove('marxy-selected', 'marxy-cursor');
    if (!marked) return;
    for (const id of marked.run) {
      const el = drawnEl(id);
      el?.classList.add('marxy-selected');
      if (id === marked.head) el?.classList.add('marxy-cursor');
    }
  }

  /** Row `r` drawn: true when it is; else the page holding it is read and drawn, and the row named comes into view then. */
  function showRow(r: number, id: string): boolean {
    if (!host || mode !== 'rendered' || state.asCard) return false;
    if (isDrawn(r)) {
      rowsTo(r);
      return true;
    }
    const from = Math.floor(r / SHEET_DRAW) * SHEET_DRAW;
    revealing = id;
    // The page holding it is being read already.
    if (fromOf(state.sheet) === from && !page && failed === null) return false;
    goTo(from, false);
    return false;
  }

  /** The cells of row `r` as saved, by column: from the page drawn, or read for the row alone. */
  async function rowCells(s: SheetPart, r: number): Promise<Map<number, SheetCell>> {
    const out = new Map<number, SheetCell>();
    const cells = isDrawn(r) ? page!.cells : ((await shell.tablesRows(path, s.name, r, 1)) as SheetPage).cells;
    for (const [pr, pc, cell] of cells) if (pr === r) out.set(pc, cell);
    return out;
  }

  /** A cell's value as the file saved it, for `c`: a formula's result, a date's serial number, not the formatted text. */
  function savedValue(cell: SheetCell | undefined): string {
    const v = cell?.v ?? null;
    if (v === null) return '';
    switch (v.k) {
      case 'int':
        return v.v;
      case 'real':
        return v.v === undefined ? (v.s ?? '') : String(v.v);
      case 'text':
      case 'err':
      case 'iso':
        return v.v;
      case 'bool':
        return v.v ? 'TRUE' : 'FALSE';
      case 'date':
        return String(v.v);
      default:
        return '';
    }
  }

  /** The columns of row `r` that hold a cell of their own: those a merge covers from above or the left are left out. */
  function rowColumns(s: SheetPart, r: number): number[] {
    const cols = Math.max(1, Math.min(s.cols, COLUMNS_DRAWN));
    const merges = isDrawn(r) ? page!.merges : [];
    const from = page?.from ?? 0;
    const covered = (c: number): boolean => merges.some(([r0, c0, r1, c1]) => r >= r0 && r <= r1 && c >= c0 && c <= c1 && !(r === Math.max(r0, from) && c === c0));
    return Array.from({ length: cols }, (_, c) => c).filter((c) => !covered(c));
  }

  function clearCell(): void {
    if (!state.cell) return;
    state.cell = null;
    for (const td of host?.querySelectorAll('.marxy-tbl-grid td[aria-selected="true"]') ?? []) td.setAttribute('aria-selected', 'false');
    viewerChanged();
  }

  function cellUnit(s: SheetPart, i: number, r: number, c: number): PartUnit {
    const name = cellName(r, c);
    const id = `${i}!${r}!${c}`;
    return {
      id,
      label: `cell ${name}`,
      address: `#${s.name}!${name}`,
      el() {
        if (!showRow(r, id)) return null;
        const td = drawnEl(id);
        if (td && (state.cell?.r !== r || state.cell.c !== c)) pickCell(r, c);
        return td;
      },
      stored: async () => savedValue((await rowCells(s, r)).get(c)),
      async xray() {
        const cell = (await rowCells(s, r)).get(c);
        const lines = [cell?.v === undefined || cell.v === null ? 'value  none: the cell is empty' : `value  ${savedValue(cell) || 'none saved'}`, `type  ${savedType(cell)}`];
        if (cell?.f !== undefined) lines.push(`formula  =${cell.f}`);
        if (cell?.x !== undefined && book.formats[cell.x]) lines.push(`format  ${book.formats[cell.x]}`);
        const m = isDrawn(r) ? page!.merges.find(([r0, c0, r1, c1]) => r0 <= r && r <= r1 && c0 <= c && c <= c1) : undefined;
        if (m) lines.push(`merged  ${cellName(m[0], m[1])}:${cellName(m[2], m[3])}`);
        return textBox(`Cell ${name} of ${s.name}, as the ${bookLabel(book)} saved it · read by the app, not its XML`, lines);
      },
    };
  }

  function rowUnit(s: SheetPart, i: number, r: number): PartUnit | null {
    if (r < 0 || r >= s.rows) return null;
    const id = `${i}!${r}`;
    // Made when asked for: a walk past the rows, or j and k, makes no cells.
    let cells: PartUnit[] | null = null;
    return {
      id,
      label: `row ${r + 1}`,
      address: `#${s.name}!${r + 1}`,
      get children() {
        return (cells ??= rowColumns(s, r).map((c) => cellUnit(s, i, r, c)));
      },
      el() {
        if (!showRow(r, id)) return null;
        clearCell();
        return drawnEl(id);
      },
      async stored() {
        const got = await rowCells(s, r);
        return Array.from({ length: s.cols }, (_, c) => savedValue(got.get(c))).join('\t');
      },
      async xray() {
        const got = [...(await rowCells(s, r))].sort(([a], [b]) => a - b).filter(([, cell]) => cell.v != null || cell.f !== undefined);
        const lines = got.map(([c, cell]) => `${cellName(r, c)}  ${savedValue(cell) || 'none saved'}${cell.f !== undefined ? `  =${cell.f}` : ''}`);
        return textBox(`Row ${r + 1} of ${s.name}, as the ${bookLabel(book)} saved it · each cell with a value or a formula`, lines.length > 0 ? lines : ['nothing saved in this row']);
      },
    };
  }

  function sheetParts(): PartTree {
    const s = sheet();
    const i = state.sheet;
    const worksheets = book.sheets.flatMap((x, k) => (x.kind === 'worksheet' ? [k] : []));
    const rows = s && s.kind === 'worksheet' ? s : null;
    const unit = (r: number): PartUnit | null => (rows ? rowUnit(rows, i, r) : null);
    const drawn = (): PartUnit[] => {
      if (!rows || !page || !isDrawn(page.from)) return [];
      return Array.from({ length: drawnTo(rows) - page.from }, (_, k) => unit(page!.from + k)!);
    };
    const find = (id: string): PartUnit | null => {
      const [si, r, c] = id.split('!');
      if (Number(si) !== i) return null;
      const row = unit(Number(r));
      return c === undefined ? row : (row?.children?.find((u) => u.id === id) ?? null);
    };
    return {
      top: drawn,
      find,
      parent: (u) => (u.id.split('!').length > 2 ? find(u.id.split('!').slice(0, 2).join('!')) : null),
      start() {
        if (state.cell && isDrawn(state.cell.r)) return unit(state.cell.r);
        const list = drawn();
        const top = host?.querySelector('.marxy-tpage')?.getBoundingClientRect().top ?? 0;
        return list.find((u) => (drawnEl(u.id)?.getBoundingClientRect().bottom ?? 0) > top) ?? list[0] ?? null;
      },
      sibling(u, dir) {
        const [, r, c] = u.id.split('!');
        if (c === undefined) return unit(Number(r) + dir);
        const cells = unit(Number(r))?.children ?? [];
        const at = cells.findIndex((x) => x.id === u.id);
        return at < 0 ? null : (cells[at + dir] ?? null);
      },
      edge: (edge) => (rows && rows.rows > 0 ? unit(edge === 'first' ? 0 : rows.rows - 1) : null),
      drawn: (u) => drawnEl(u.id),
      at(target) {
        const hit = target.closest<HTMLElement>('td[data-marxy-cell], tr[data-marxy-row]');
        if (!hit || !host?.contains(hit) || !hit.closest('.marxy-tbl-sheet')) return null;
        if (hit.localName === 'tr') return find(`${i}!${hit.dataset.marxyRow}`);
        const at = cellOfName(hit.dataset.marxyCell ?? '');
        return at ? find(`${i}!${at.r}!${at.c}`) : null;
      },
      async step(_from, dir) {
        const at = worksheets.indexOf(state.sheet);
        const next = at < 0 ? (dir === 1 ? worksheets[0] : worksheets.at(-1)) : worksheets[at + dir];
        if (next === undefined) return null;
        await pickSheet(next);
        const now = sheet();
        return now && now.kind === 'worksheet' && now.rows > 0 && page ? rowUnit(now, next, page.from) : null;
      },
      mark(head, run) {
        marked = head ? { head: head.id, run: new Set(run.map((u) => u.id)) } : null;
        if (!head) clearCell();
        paintMarks();
      },
      readOnly: true,
    };
  }

  void load();

  return {
    path,
    kind: 'sheet',
    group: 'sheet',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'sheet');
      draw();
    },
    hide() {
      filler?.disconnect();
      filler = null;
      host = null;
    },
    cards: () => (state.asCard ? { reading: readingCardDef, facts } : { reading: readingCardDef, contents: sheetsCard, frontmatter: workbookCard, facts }),
    passing: (m) => (m === 'source' || state.asCard ? [byte] : [cellCard]),
    headSay: () => null,
    key(e, m) {
      if (m === 'source' || state.asCard) return hex?.key(e) ?? false;
      return key(e);
    },
    parts: (m) => (m === 'source' || state.asCard ? ensureHex().parts() : sheetParts()),
    floor: { on: () => state.asCard, set: (on) => setCard(on) },
    panelKey: () => `${id}:${mode}:${state.asCard}:${state.sheet}:${fromOf(state.sheet)}:${state.formulas}:${state.cell?.r ?? ''}:${state.cell?.c ?? ''}:${pageFor}:${hex?.selected() ?? ''}`,
    place() {
      const scroller = mode === 'rendered' && !state.asCard ? host?.querySelector<HTMLElement>('.marxy-tpage') : null;
      return { hex: hex?.place(), scroll: scroller ? { top: scroller.scrollTop, left: 0 } : undefined };
    },
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode === 'rendered' && state.asCard ? 'rendered' : 'source';
    },
    exports: (m) => (m === 'rendered' ? exports() : [asItIs(shell, file, 'file')]),
    destroy() {
      filler?.disconnect();
      filler = null;
      hex?.destroy();
      hex = null;
      host = null;
    },
  };
}

/** The workbook at `path` as the shell reads it, or why the page cannot be made. */
export async function openSheetFor(shell: AppShell, path: string): Promise<{ readonly book: BookSummary } | { readonly kicker: string; readonly line: string }> {
  try {
    const got = await shell.tablesOpen(path);
    if (got?.book) return { book: got.book };
    return { kicker: 'No reading for this file', line: 'Its bytes are not a workbook the app reads: xlsx, xlsm, xls or ods.' };
  } catch (e) {
    return { kicker: 'A workbook the app cannot read', line: e instanceof Error ? e.message : String(e) };
  }
}

