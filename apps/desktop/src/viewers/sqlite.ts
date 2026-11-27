// A SQLite database as the table page: its tables and views in the bar at the
// page's foot, Schema last; rows 200 at a time in stored order with Earlier, Later and Go to row, never sorted; each
// column with its declared type under its name, numbers to the right, NULL grey and italic. A cell picked is the passing
// Cell card; a BLOB is its size there, and its first bytes, what it seems to be and Open it on the card. A view runs
// when opened, read-only and stopped at a time cap. How it is read (with its WAL, alone, a copy in memory) is said in
// grey in the head and in a line above the rows. Source is the bytes. The shell reads it (`tablesOpen`); nothing writes.
// The cursor walks rows, then a row's cells (`#readings/1042/height_m`); `]` and `[` step the tables and views.
import { accountElement } from '../frame/account.ts';
import {
  BLOB_OPEN_CAP,
  DB_PAGE,
  TEXT_CAP,
  applicationWords,
  blobSeems,
  csvOf,
  dbCell,
  dbCounts,
  dbCsvValue,
  dbHeadWords,
  dbLine,
  dbStateLine,
  goToRow,
  isNumericDecl,
  journalWords,
  notDeclared,
  pager,
  partWords,
  plural,
  dbAccount,
  schemaGroups,
  schemaText,
  sqlTokens,
  sqliteVersion,
  storedAs,
} from '@marxy/core/src/viewer/tables.ts';
import { firstBytes, sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import { shortSize } from '@marxy/core/src/viewer/archive.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { DbPart, DbRowsPage, DbSummary, TableValue } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { el, factRow } from '../frame/dom.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { notify } from '../notices/index.ts';
import { byteCard, factsCard } from './cards.ts';
import { fileCardElement } from './card.ts';
import type { ViewedFile } from './file.ts';
import { asItIs } from './exports.ts';
import { createHexView, type HexView } from './hex.ts';
import { partsBar } from './parts-bar.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { csvExport, openHeld, tablesReadingCard } from './table-cards.ts';
import { readAlone, setReadAlone } from './table-choices.ts';
import { bytesBox, textBox } from '../parts/xray-box.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerExport, ViewerPlace, ViewMode } from './types.ts';
import css from './tables.css?inline';

const n2 = (n: number): string => n.toLocaleString('en-GB');
const SCHEMA = '\u0000schema';
/** Rows read a call while Export gathers a table. */
const EXPORT_PAGE = 5_000;

interface Kept {
  part: string;
  from: Map<string, number>;
  ddl: boolean;
  /** The cell picked: its row on the page and its column. */
  cell: { row: number; col: number } | null;
  asCard: boolean;
  /** A view's rows counted when it ran. */
  counted: Map<string, number>;
}

// What the reader was looking at in each database while the app runs (memory only, never written).
const kept = new Map<string, Kept>();

export interface SqliteOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly summary: DbSummary;
  readonly paneHost: HTMLElement;
  readonly place?: ViewerPlace;
}

/** Appends `sql` coloured as SQL. */
function sqlBlock(sql: string): HTMLElement {
  const pre = el('pre', 'marxy-tbl-sql');
  for (const t of sqlTokens(sql)) pre.append(t.kind === 'plain' ? t.text : el('span', `marxy-sql-${t.kind}`, t.text));
  return pre;
}

export function createSqliteViewer(o: SqliteOptions): PaneViewer {
  const { shell, file, paneHost } = o;
  let db = o.summary;
  const path = file.path;
  adoptRuntimeSheet(document, 'marxy-tables-style', css);
  const firstPart = (): string => db.parts.find((p) => p.kind === 'table')?.name ?? db.parts[0]?.name ?? SCHEMA;
  const state: Kept = kept.get(path) ?? { part: firstPart(), from: new Map(), ddl: false, cell: null, asCard: false, counted: new Map() };
  kept.set(path, state);
  if (kept.size > 50) kept.delete(kept.keys().next().value!);
  if (state.part !== SCHEMA && !db.parts.some((p) => p.name === state.part)) state.part = firstPart();

  const id = nextViewerId();
  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let page: DbRowsPage | null = null;
  let pageFor = '';
  let reading = 0;
  let failed: string | null = null;
  let scrollBack = o.place?.scroll?.top ?? null;
  const blobHeads = new Map<string, Uint8Array | 'reading' | 'failed'>();
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const alone = (): boolean => db.state === 'alone';
  const partOf = (name: string): DbPart | undefined => db.parts.find((p) => p.name === name);
  const fromOf = (name: string): number => state.from.get(name) ?? 0;

  function columnsOf(part: DbPart): { name: string; decl: string; key: boolean }[] {
    if (part.kind === 'view' && page?.columns && pageFor === part.name) return page.columns.map((name) => ({ name, decl: part.columns.find((c) => c.name === name)?.decl ?? '', key: false }));
    return part.columns.map((c) => ({ name: c.name, decl: c.decl, key: c.key }));
  }

  function totalOf(part: DbPart): number | null {
    if (part.kind === 'view') return state.counted.get(part.name) ?? null;
    return part.rows;
  }

  /** Pages read for the cursor beside the one drawn, by part and first row, so `j` past the page draws the next at once. */
  const near = new Map<string, DbRowsPage>();
  const nearing = new Set<string>();
  let nearAge = 0;

  function keepNear(key: string, part: DbPart, got: DbRowsPage): void {
    near.delete(key);
    near.set(key, got);
    while (near.size > 4) near.delete(near.keys().next().value!);
    if (part.kind === 'view' && got.total !== null) state.counted.set(part.name, got.total);
  }

  function readAhead(part: DbPart, from: number): void {
    const key = `${part.name}\u0000${from}`;
    if (near.has(key) || nearing.has(key)) return;
    nearing.add(key);
    const age = nearAge;
    shell
      .tablesRows(path, part.name, from, DB_PAGE, alone())
      .then((got) => {
        if (age === nearAge) keepNear(key, part, got as DbRowsPage);
      })
      .catch(() => {})
      .finally(() => nearing.delete(key));
  }

  async function load(): Promise<void> {
    const part = partOf(state.part);
    if (!part) return;
    const want = `${part.name}\u0000${fromOf(part.name)}`;
    if (pageFor === want && page) return;
    const ticket = ++reading;
    failed = null;
    const ahead = near.get(want);
    if (ahead) {
      page = ahead;
      pageFor = want;
      draw();
      viewerChanged();
      return;
    }
    try {
      const got = (await shell.tablesRows(path, part.name, fromOf(part.name), DB_PAGE, alone())) as DbRowsPage;
      if (ticket !== reading) return;
      page = got;
      pageFor = want;
      keepNear(want, part, got);
    } catch (e) {
      if (ticket !== reading) return;
      page = null;
      pageFor = want;
      failed = e instanceof Error ? e.message : String(e);
    }
    draw();
    viewerChanged();
  }

  function pickPart(name: string): Promise<void> {
    if (name === state.part) return Promise.resolve();
    state.part = name;
    state.cell = null;
    state.ddl = false;
    draw();
    viewerChanged();
    return load();
  }

  function goTo(from: number): void {
    state.from.set(state.part, Math.max(0, from));
    state.cell = null;
    page = null;
    draw();
    viewerChanged();
    void load();
  }

  async function reopen(asAlone: boolean): Promise<void> {
    try {
      const next = await shell.tablesOpen(path, asAlone);
      if (next?.db) db = next.db;
    } catch (e) {
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) }, { pane: paneHost });
    }
    // Said once the database reads the new way, so the head's tier and the page agree.
    setReadAlone(path, asAlone);
    page = null;
    pageFor = '';
    near.clear();
    nearAge++;
    state.cell = null;
    draw();
    viewerChanged();
    void load();
  }

  function pickCell(row: number, col: number): void {
    state.cell = { row, col };
    for (const td of host?.querySelectorAll('.marxy-tbl-grid td[aria-selected="true"]') ?? []) td.setAttribute('aria-selected', 'false');
    host?.querySelector(`.marxy-tbl-grid tbody tr:nth-child(${row + 1}) td[data-marxy-col="${col}"]`)?.setAttribute('aria-selected', 'true');
    viewerChanged();
    const v = page?.rows[row]?.[col];
    const part = partOf(state.part);
    if (v && v.k === 'blob' && part) void readBlobHead(part, row, col);
  }

  const blobKey = (part: string, row: number, col: number): string => `${part}\u0000${fromOf(part) + row}\u0000${col}`;

  async function readBlobHead(part: DbPart, row: number, col: number): Promise<void> {
    const key = blobKey(part.name, row, col);
    if (blobHeads.has(key)) return;
    blobHeads.set(key, 'reading');
    const column = columnsOf(part)[col]?.name ?? '';
    try {
      blobHeads.set(key, await shell.tablesBlob(path, part.name, page?.rowids?.[row] ?? null, fromOf(part.name) + row, column, 64, alone()));
    } catch {
      blobHeads.set(key, 'failed');
    }
    viewerChanged();
  }

  /** Opens the BLOB in `column` of row `at` (0-based, stored order) into memory, in a tab of its own. */
  async function openBlob(part: DbPart, column: string, rowid: number | null, at: number, n: number): Promise<void> {
    if (n > BLOB_OPEN_CAP) {
      notify({ kind: 'refused', text: `This BLOB is ${shortSize(n)}, over the ${shortSize(BLOB_OPEN_CAP)} one may open with.` }, { pane: paneHost });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await shell.tablesBlob(path, part.name, rowid, at, column, BLOB_OPEN_CAP, alone());
    } catch (e) {
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) }, { pane: paneHost });
      return;
    }
    const seems = blobSeems(bytes.subarray(0, 64));
    const label = rowid !== null ? rowid : at + 1;
    await openHeld({
      paneHost,
      source: path,
      name: `${part.name}/${column}-${label}.${seems.ext}`,
      index: at,
      bytes,
      said: `The BLOB in ${part.name}.${column}, row ${n2(label)}: opened into memory. Nothing was written.`,
    });
  }

  function headRow(part: DbPart): HTMLTableRowElement {
    const tr = el('tr');
    if (part.rowid) {
      const th = el('th', 'marxy-table-lens-rn', 'rowid');
      th.scope = 'col';
      tr.append(th);
    }
    for (const c of columnsOf(part)) {
      const th = el('th', isNumericDecl(c.decl) ? 'marxy-table-lens-num' : undefined);
      th.scope = 'col';
      th.append(el('span', 'marxy-table-lens-name', c.name));
      const type = [c.decl, c.key ? 'key' : ''].filter(Boolean).join(' · ');
      if (type) th.append(el('span', 'marxy-table-lens-type', type));
      tr.append(th);
    }
    return tr;
  }

  function cellEl(v: TableValue, decl: string, row: number, col: number): HTMLTableCellElement {
    const shown = dbCell(v);
    const td = el('td');
    td.dataset.marxyCol = String(col);
    const cls = ['marxy-tbl-cell'];
    if (shown.kind === 'num') cls.push('marxy-table-lens-num');
    if (shown.kind === 'null') cls.push('marxy-tbl-null');
    if (shown.kind === 'blob') cls.push('marxy-tbl-blob');
    if (shown.kind === 'text' && isNumericDecl(decl)) cls.push('marxy-table-lens-num');
    td.className = cls.join(' ');
    const text = shown.text.length > 200 ? `${shown.text.slice(0, 200)}…` : shown.text;
    td.append(text);
    if (shown.more) td.append(el('span', 'marxy-tbl-more', ` +${n2(shown.more)} more`));
    td.title = shown.kind === 'text' && shown.text.length > 200 ? 'Pick it to read it whole in Metadata' : '';
    td.setAttribute('aria-selected', String(state.cell?.row === row && state.cell.col === col));
    td.addEventListener('click', () => pickCell(row, col));
    return td;
  }

  function rowsPage(part: DbPart, wrap: HTMLElement): void {
    const total = totalOf(part);
    const cols = columnsOf(part);
    const head = el('div', 'marxy-tbl-head');
    head.append(el('h2', 'marxy-tbl-title', part.name), el('span', 'marxy-tbl-sub', partWords(part, total, cols.length + part.columnsMore)));
    if (part.sql) {
      const ddl = el('button', 'marxy-linkish marxy-tbl-ddl', state.ddl ? 'Hide CREATE statement' : 'Its CREATE statement');
      ddl.type = 'button';
      ddl.setAttribute('aria-expanded', String(state.ddl));
      ddl.addEventListener('click', () => {
        state.ddl = !state.ddl;
        draw();
      });
      head.append(ddl);
    }
    wrap.append(head);
    if (state.ddl && part.sql) {
      wrap.append(sqlBlock(part.sql));
      for (const e of db.schema) if (e.kind === 'index' && e.table === part.name && e.sql) wrap.append(sqlBlock(e.sql));
    }
    if (part.kind === 'view') wrap.append(el('p', 'marxy-tbl-note', 'A view is a query: its rows are what it selects now, read-only. SQLite runs it with query_only on, a page at a time, and stops it after 2 s.'));
    if (part.columnsMore > 0) wrap.append(el('p', 'marxy-tbl-note', `The first ${n2(cols.length)} of ${n2(cols.length + part.columnsMore)} columns are drawn.`));
    if (failed) {
      wrap.append(el('p', 'marxy-tbl-note', `${part.kind === 'view' ? 'The view could not run' : 'The rows could not be read'}: ${failed}`));
      return;
    }
    if (!page || pageFor !== `${part.name}\u0000${fromOf(part.name)}`) {
      wrap.append(el('p', 'marxy-tbl-note', part.kind === 'view' ? 'Running the view, read-only…' : 'Reading the rows…'));
      return;
    }
    if (page.stopped) wrap.append(el('p', 'marxy-tbl-note marxy-tbl-stopped', `The query was ${page.stopped}: these are the rows it gave before then.`));
    const scroll = el('div', 'marxy-tbl-scroll');
    const table = el('table', 'marxy-table-lens-grid marxy-tbl-grid');
    table.setAttribute('aria-label', `The rows of ${part.name}`);
    const thead = el('thead');
    thead.append(headRow(part));
    const tbody = el('tbody');
    page.rows.forEach((r, i) => {
      const tr = el('tr');
      if (part.rowid) tr.append(el('td', 'marxy-table-lens-rn', String(page!.rowids?.[i] ?? '')));
      r.forEach((v, j) => tr.append(cellEl(v, cols[j]?.decl ?? '', i, j)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    scroll.append(table);
    wrap.append(scroll);
    const p = pager(page.from, page.rows.length, total);
    if (total === null || total > DB_PAGE || page.from > 0) {
      const bar = el('div', 'marxy-tbl-pager');
      bar.append(el('span', 'marxy-tbl-pager-label', p.label));
      const earlier = el('button', 'marxy-btn', 'Earlier');
      earlier.type = 'button';
      earlier.disabled = p.earlier === null;
      earlier.addEventListener('click', () => p.earlier !== null && goTo(p.earlier));
      const later = el('button', 'marxy-btn', 'Later');
      later.type = 'button';
      later.disabled = p.later === null;
      later.addEventListener('click', () => p.later !== null && goTo(p.later));
      const go = el('label', 'marxy-tbl-goto');
      const input = el('input', 'marxy-tbl-goto-input');
      input.type = 'text';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Go to a row');
      input.placeholder = total === null ? 'a row number' : `1 to ${n2(total)}`;
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const row = goToRow(input.value, total);
        if (row === null) {
          notify({ kind: 'refused', text: `${input.value.trim() || 'That'} is not a row of ${part.name}${total === null ? '' : `, which has ${n2(total)}`}.` }, { pane: paneHost });
          return;
        }
        goTo(Math.floor(row / DB_PAGE) * DB_PAGE);
      });
      go.append('Go to row ', input);
      bar.append(earlier, later, go);
      wrap.append(bar);
    }
  }

  function schemaPage(wrap: HTMLElement): void {
    const head = el('div', 'marxy-tbl-head');
    head.append(el('h2', 'marxy-tbl-title', 'Schema'), el('span', 'marxy-tbl-sub', 'every CREATE statement in sqlite_master, as written'));
    wrap.append(head);
    for (const g of schemaGroups(db)) {
      wrap.append(el('h3', 'marxy-tbl-group', g.label));
      if (g.note) wrap.append(el('p', 'marxy-tbl-note', g.note));
      for (const e of g.entries) {
        const name = el('p', 'marxy-tbl-entry');
        name.append(el('b', '', e.name));
        if (e.table && e.table !== e.name) name.append(el('span', 'marxy-tbl-sub', ` on ${e.table}`));
        wrap.append(name, e.sql ? sqlBlock(e.sql) : el('p', 'marxy-tbl-note', `made by SQLite for ${e.table}'s key; it has no CREATE statement`));
      }
    }
    if (db.schemaMore) wrap.append(el('p', 'marxy-tbl-note', 'sqlite_master holds more entries than the page reads.'));
  }

  function bar(): HTMLElement {
    const c = dbCounts(db);
    const item = (p: DbPart) => ({ id: p.name, name: p.name, count: p.rows === null ? undefined : n2(p.rows) });
    return partsBar({
      label: `Tables and views in ${basename(path)}`,
      groups: [
        { label: 'Tables', items: c.tables.map(item) },
        { label: 'Views', items: c.views.map((p) => ({ id: p.name, name: p.name })) },
        { label: 'SQLite’s', items: c.internal.map(item) },
      ],
      end: { id: SCHEMA, name: 'Schema' },
      selected: state.part,
      pick: pickPart,
    });
  }

  function tablePage(): HTMLElement {
    const pageEl = el('div', 'marxy-tpage');
    pageEl.tabIndex = -1;
    const wrap = el('div', 'marxy-tbl');
    const account = accountElement(dbAccount(state.part === SCHEMA ? null : partOf(state.part) ?? null), dbLine(db), 'marxy-tbl-line');
    if (account) wrap.append(account);
    const said = dbStateLine(db);
    if (said) {
      const note = el('p', 'marxy-tbl-state');
      note.append(said.text);
      if (said.action) {
        const b = el('button', 'marxy-linkish', said.action === 'alone' ? 'Read the file alone' : 'Read it with its WAL');
        b.type = 'button';
        b.addEventListener('click', () => void reopen(said.action === 'alone'));
        note.append(' ', b);
      }
      wrap.append(note);
    }
    const part = partOf(state.part);
    if (state.part === SCHEMA || !part) schemaPage(wrap);
    else rowsPage(part, wrap);
    pageEl.append(wrap, bar());
    return pageEl;
  }

  function cardPage(): HTMLElement {
    const pageEl = el('div', 'marxy-fcpage');
    const side = el('div', 'marxy-fchex');
    const view = ensureHex();
    side.append(view.el);
    pageEl.append(fileCardElement({ shell, file, back: { words: 'Show the database instead', run: () => setCard(false) } }, () => paneHost), side);
    requestAnimationFrame(() => view.draw());
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
    if (mode === 'source') {
      const view = ensureHex();
      const pageEl = el('div', 'marxy-hexpage');
      pageEl.append(view.el);
      host.replaceChildren(pageEl);
      requestAnimationFrame(() => view.draw());
      return;
    }
    if (state.asCard) {
      host.replaceChildren(cardPage());
      return;
    }
    const pageEl = tablePage();
    host.replaceChildren(pageEl);
    pageEl.scrollTop = top;
    paintMarks();
  }

  const tiers = [
    { name: 'The database', words: 'read in place, read-only' },
    { name: 'A copy in memory', words: 'when another program holds it locked' },
    { name: 'The bytes', words: 'when it is not SQLite, or is encrypted' },
  ];
  const readingCardDef = tablesReadingCard({
    file,
    shownAs: () => (state.asCard && mode === 'rendered' ? 'a file card and the bytes' : 'a SQLite database'),
    tiers,
    at: () => (state.asCard ? 2 : db.state === 'copy' || db.state === 'alone' ? 1 : 0),
    caps: [
      `rows ${n2(DB_PAGE)} at a time`,
      `a cell's text to ${n2(TEXT_CAP)} characters, then cut and said`,
      `a BLOB as its size; opened on request, up to ${shortSize(BLOB_OPEN_CAP)}`,
      'views run read-only, a page at a time, stopped after 2 s',
      'triggers never run: nothing writes',
    ],
    ways: () => {
      if (mode !== 'rendered') return [];
      const ways = [];
      if (db.state === 'wal') ways.push({ words: 'Read the file alone, as of its last checkpoint', run: () => void reopen(true) });
      if (db.state === 'alone') ways.push({ words: 'Read it with its WAL', run: () => void reopen(false) });
      ways.push(state.asCard ? { words: 'Show the database instead', run: () => setCard(false) } : { words: 'Show the file card and the bytes instead', run: () => setCard(true) });
      return ways;
    },
  });

  const tablesCard: CardDef = {
    id: 'contents',
    title: () => 'Tables',
    detail: () => n2(db.parts.filter((p) => p.kind !== 'internal').length),
    relevant: () => true,
    render(body) {
      const list = el('div', 'marxy-tbl-list');
      const row = (id: string, name: string, kind: string, count: string): void => {
        const b = el('button', 'marxy-tbl-item');
        b.type = 'button';
        b.setAttribute('aria-current', String(state.part === id));
        const label = el('span', 'marxy-tbl-item-name', name);
        if (kind) label.append(el('span', 'marxy-tbl-item-kind', ` ${kind}`));
        b.append(label, el('span', 'marxy-tbl-item-count', count));
        b.addEventListener('click', () => pickPart(id));
        list.append(b);
      };
      for (const p of db.parts.filter((x) => x.kind === 'table')) row(p.name, p.name, '', p.rows === null ? '' : n2(p.rows));
      for (const p of db.parts.filter((x) => x.kind === 'view')) {
        const n = state.counted.get(p.name);
        row(p.name, p.name, 'view', n === undefined ? '' : n2(n));
      }
      row(SCHEMA, 'Schema', '', n2(db.schema.length));
      body.append(list);
    },
  };

  const databaseCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Database',
    detail: () => 'from its header',
    relevant: () => true,
    render(body) {
      const h = db.header;
      body.append(
        factRow('pages', `${n2(h.pages)} of ${n2(h.pageSize)} bytes${h.freelist ? ` · ${plural(h.freelist, 'free page')}` : ''}`),
        factRow('text', h.encoding),
        factRow('journal', journalWords(db)),
        factRow('user_version', String(h.userVersion)),
        factRow('application', applicationWords(h.applicationId)),
        factRow('written by', `SQLite ${sqliteVersion(h.writtenBy)}`),
        factRow('schema', `format ${h.schemaFormat} · ${plural(db.schema.length, 'entry', 'entries')} in sqlite_master`),
      );
      const beside = [db.wal ? `${db.wal.name} (${shortSize(db.wal.bytes)})` : null, db.shm].filter(Boolean).join(', ');
      if (beside) body.append(factRow('beside it', beside));
      if (db.state === 'copy' && db.copyWhy === 'entry') body.append(factRow('read from', 'an entry of an archive, held in memory'));
      else if (db.state === 'copy') body.append(factRow(db.copyWhy === 'locked' ? 'locked' : 'read from', db.copyWhy === 'locked' ? 'by another program: read from a copy in memory' : 'a copy in memory, so no index file is made beside it'));
      body.append(factRow('opened', `read-only; nothing is written, checkpointed or rolled back · SQLite ${db.library} reads it`));
    },
  };

  const cellCard: CardDef = {
    id: 'selection',
    title: () => 'Cell',
    detail: () => {
      const part = partOf(state.part);
      const col = part && state.cell ? columnsOf(part)[state.cell.col] : undefined;
      return part && col ? `${part.name}.${col.name}` : '';
    },
    relevant: () => mode === 'rendered' && !state.asCard && state.cell !== null && page?.rows[state.cell.row] !== undefined,
    render(body) {
      const part = partOf(state.part);
      if (!part || !state.cell || !page) return;
      const { row, col } = state.cell;
      const v = page.rows[row]?.[col] ?? null;
      const c = columnsOf(part)[col];
      if (!c) return;
      const rowid = page.rowids?.[row];
      const at = fromOf(part.name) + row + 1;
      body.append(factRow('row', `${n2(at)}${rowid !== undefined ? ` · rowid ${n2(rowid)}` : ''}`));
      body.append(factRow('column', `${c.name} · declared ${c.decl || 'no type'}`));
      const stored = el('span', '', storedAs(v));
      if (notDeclared(v, c.decl)) stored.append(el('span', 'marxy-fact-quiet', ' · not the declared type: SQLite keeps what was written'));
      if (part.columns[col]?.rowid) stored.append(el('span', 'marxy-fact-quiet', ' · the rowid itself'));
      body.append(factRow('stored as', stored));
      if (v && v.k === 'blob') {
        const head = blobHeads.get(blobKey(part.name, row, col));
        body.append(factRow('size', sizeWords(v.n)));
        if (head instanceof Uint8Array) {
          const fb = firstBytes(head, 8);
          const code = el('code', 'marxy-fact-code', fb.hex);
          body.append(factRow('starts', code), factRow('seems', blobSeems(head).what));
        } else body.append(factRow('starts', head === 'failed' ? 'could not be read' : 'reading…'));
        const open = el('button', 'marxy-btn marxy-tbl-open', 'Open it');
        open.type = 'button';
        open.disabled = v.n > BLOB_OPEN_CAP;
        open.addEventListener('click', () => void openBlob(part, c.name, rowid ?? null, at - 1, v.n));
        body.append(open, el('p', 'marxy-card-note', `Opens into memory, read-only, in a tab of its own, as an archive entry does. Up to ${shortSize(BLOB_OPEN_CAP)}.`));
        return;
      }
      if (v && v.k === 'text') {
        const len = [...v.v].length + (v.more ?? 0);
        body.append(factRow('length', plural(len, 'character')));
        const value = el('span', 'marxy-tbl-cv', v.v);
        if (v.more) value.append(el('span', 'marxy-fact-quiet', ` … ${n2(v.more)} more characters, not read`));
        body.append(factRow('value', value));
        return;
      }
      body.append(factRow('value', v === null ? 'NULL: no value' : dbCell(v).text));
    },
  };

  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  function exports(): ViewerExport[] {
    const out: ViewerExport[] = [{ ...asItIs(shell, file, 'file'), name: 'The database, as it is' }];
    const part = partOf(state.part);
    if (part) {
      out.push(
        csvExport({
          id: 'csv',
          name: `${part.name} as CSV`,
          sub: `every row in ${part.kind === 'view' ? 'the order the view gives' : 'stored order'}; a BLOB as its size`,
          async build(keep, stopped) {
            let header: string[] | null = part.columns.map((c) => c.name);
            if (part.rowid) header.unshift('rowid');
            for (let from = 0; ; from += EXPORT_PAGE) {
              const got = (await shell.tablesRows(path, part.name, from, EXPORT_PAGE, alone(), true)) as DbRowsPage;
              if (got.columns && from === 0) header = [...got.columns];
              const rows = got.rows.map((r, i) => {
                const vals = r.map(dbCsvValue);
                if (part.rowid) vals.unshift(String(got.rowids?.[i] ?? ''));
                return vals;
              });
              if (!keep(csvOf(from === 0 ? header : null, rows).replace(/\r\n$/, rows.length ? '\r\n' : ''))) return;
              if (got.stopped) {
                stopped(String(got.stopped));
                return;
              }
              if (got.rows.length < EXPORT_PAGE) return;
            }
          },
        }),
      );
    }
    out.push({
      id: 'schema',
      name: 'The schema',
      sub: 'every CREATE statement, as written',
      extension: 'sql',
      async build() {
        const text = schemaText(db);
        return { bytes: new TextEncoder().encode(text), preview: text };
      },
    });
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

  // ---- the cursor's parts: the rows of the table or view shown, then each row's cells ----

  let marked: { head: string; run: Set<string> } | null = null;
  const rowId = (name: string, index: number): string => `${name}\u0000${index}`;

  /** The page holding row `index` (0-based, stored order) of `name`: the one drawn, or one read ahead. */
  function holding(name: string, index: number): { pg: DbRowsPage; i: number } | null {
    const drawn = page && pageFor === `${name}\u0000${fromOf(name)}` ? [page] : [];
    for (const pg of [...drawn, ...[...near].filter(([k]) => k.startsWith(`${name}\u0000`)).map(([, p]) => p)]) {
      if (index >= pg.from && index < pg.from + pg.rows.length) return { pg, i: index - pg.from };
    }
    return null;
  }

  /** Draws the page holding row `index` when it was read ahead and is not the one drawn; false when it is not at hand. */
  function showRow(name: string, index: number): boolean {
    if (!host || mode !== 'rendered' || state.asCard || state.part !== name) return false;
    const at = holding(name, index);
    if (!at) return false;
    if (at.pg !== page) {
      state.from.set(name, at.pg.from);
      state.cell = null;
      page = at.pg;
      pageFor = `${name}\u0000${at.pg.from}`;
      draw();
      viewerChanged();
    }
    return true;
  }

  /** The row drawn for `index`, without drawing anything. */
  function drawnRow(index: number): HTMLElement | null {
    if (!page) return null;
    const i = index - page.from;
    if (i < 0 || i >= page.rows.length) return null;
    return (host?.querySelector('.marxy-tbl-grid tbody')?.children[i] as HTMLElement | undefined) ?? null;
  }

  function drawnEl(id: string): HTMLElement | null {
    const [name, index, col] = id.split('\u0000');
    if (name !== state.part || !page || pageFor !== `${name}\u0000${fromOf(name)}`) return null;
    const tr = drawnRow(Number(index));
    return col === undefined ? tr : (tr?.querySelector<HTMLElement>(`td[data-marxy-col="${col}"]`) ?? null);
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

  /** The pages before and after the one drawn are read while the cursor is on it, so it can step past either edge. */
  function readAround(part: DbPart): void {
    if (!page) return;
    const p = pager(page.from, page.rows.length, totalOf(part));
    if (p.later !== null) readAhead(part, p.later);
    if (p.earlier !== null) readAhead(part, p.earlier);
  }

  /** The row's name in its address: its rowid; a WITHOUT ROWID table's key; a view's row by its place. */
  function rowKey(part: DbPart, pg: DbRowsPage, i: number): string {
    const rowid = pg.rowids?.[i];
    if (rowid !== undefined && rowid !== null) return String(rowid);
    const keys = part.kind === 'table' ? part.columns.flatMap((c, j) => (c.key ? [j] : [])) : [];
    if (keys.length > 0) return keys.map((j) => dbCsvValue(pg.rows[i]?.[j] ?? null)).join(',');
    return String(pg.from + i + 1);
  }

  /** A value as the file holds it, for `c`: NULL as nothing, a BLOB as its length and first bytes. */
  async function valueStored(part: DbPart, column: string, v: TableValue, rowid: number | null, index: number): Promise<string> {
    if (v === null || v.k !== 'blob') return dbCsvValue(v);
    try {
      const head = await shell.tablesBlob(path, part.name, rowid, index, column, 8, alone());
      return `BLOB, ${n2(v.n)} bytes, starting ${firstBytes(head, 8).hex}`;
    } catch {
      return `BLOB, ${n2(v.n)} bytes`;
    }
  }

  /** A value as the record box writes it: text quoted, a BLOB as its size. */
  function valueWords(v: TableValue): string {
    if (v === null) return 'NULL';
    if (v.k === 'text') return `${JSON.stringify(v.v)}${v.more ? ` … ${n2(v.more)} more characters, not read` : ''}`;
    if (v.k === 'blob') return plural(v.n, 'byte');
    return dbCsvValue(v);
  }

  function clearCell(): void {
    if (!state.cell) return;
    state.cell = null;
    for (const td of host?.querySelectorAll('.marxy-tbl-grid td[aria-selected="true"]') ?? []) td.setAttribute('aria-selected', 'false');
    viewerChanged();
  }

  function rowUnit(part: DbPart, index: number): PartUnit | null {
    const at = holding(part.name, index);
    if (!at) return null;
    const { pg, i } = at;
    const values = pg.rows[i]!;
    const cols = columnsOf(part);
    const key = rowKey(part, pg, i);
    const rowid = pg.rowids?.[i] ?? null;
    const id = rowId(part.name, index);
    const whose = rowid !== null ? `rowid ${rowid}` : part.kind === 'view' ? `row ${n2(index + 1)}` : `key ${key}`;
    const cells: PartUnit[] = values.map((v, j) => {
      const column = cols[j]?.name ?? String(j + 1);
      const decl = cols[j]?.decl ?? '';
      return {
        id: `${id}\u0000${j}`,
        label: `cell ${column}`,
        address: `#${part.name}/${key}/${column}`,
        el() {
          if (!showRow(part.name, index)) return null;
          readAround(part);
          const td = drawnEl(`${id}\u0000${j}`);
          if (td && page && (state.cell?.row !== index - page.from || state.cell.col !== j)) pickCell(index - page.from, j);
          return td;
        },
        stored: () => valueStored(part, column, v, rowid, index),
        async xray() {
          const head = `${column} of ${part.name}, ${whose}`;
          if (v === null || v.k !== 'blob') return textBox(`${head} · as stored`, [`${storedAs(v)}, declared ${decl || 'with no type'}`, valueWords(v)]);
          const bytes = await shell.tablesBlob(path, part.name, rowid, index, column, 64, alone()).catch(() => null);
          if (!bytes) return textBox(`${head} · as stored`, [`BLOB, ${plural(v.n, 'byte')}`, 'its bytes could not be read']);
          return bytesBox(`${head} · the BLOB's first ${n2(bytes.length)} of ${n2(v.n)} bytes, at its own offsets`, bytes, 0);
        },
        open: v && v.k === 'blob' ? () => openBlob(part, column, rowid, index, v.n) : undefined,
      };
    });
    return {
      id,
      label: `row ${key}`,
      address: `#${part.name}/${key}`,
      children: cells.length > 0 ? cells : undefined,
      el() {
        if (!showRow(part.name, index)) return null;
        readAround(part);
        clearCell();
        return drawnRow(index);
      },
      stored: async () => (await Promise.all(values.map((v, j) => valueStored(part, cols[j]?.name ?? '', v, rowid, index)))).join('\t'),
      xray: () =>
        textBox(
          part.kind === 'view' ? `Row ${n2(index + 1)} of the view ${part.name}, as it gave it · each value with its class` : `The record of ${part.name}, ${whose}, as stored · each value with its class`,
          values.map((v, j) => `${cols[j]?.name ?? j + 1}  ${storedAs(v)}  ${valueWords(v)}`),
        ),
    };
  }

  function tableParts(): PartTree {
    const part = partOf(state.part);
    const listed = db.parts.filter((p) => p.kind !== 'internal');
    const drawn = (): PartUnit[] => (part && page && pageFor === `${part.name}\u0000${fromOf(part.name)}` ? page.rows.flatMap((_, i) => rowUnit(part, page!.from + i) ?? []) : []);
    const find = (id: string): PartUnit | null => {
      const [name, index, col] = id.split('\u0000');
      if (!part || name !== part.name) return null;
      const row = rowUnit(part, Number(index));
      return col === undefined ? row : (row?.children?.[Number(col)] ?? null);
    };
    return {
      top: drawn,
      find,
      parent: (u) => (u.id.split('\u0000').length > 2 ? find(u.id.split('\u0000').slice(0, 2).join('\u0000')) : null),
      start() {
        const rows = drawn();
        if (state.cell && page) return rows[state.cell.row] ?? rows[0] ?? null;
        const top = host?.querySelector('.marxy-tpage')?.getBoundingClientRect().top ?? 0;
        return rows.find((_, i) => (drawnRow(page!.from + i)?.getBoundingClientRect().bottom ?? 0) > top) ?? rows[0] ?? null;
      },
      sibling(u, dir) {
        const [name, index, col] = u.id.split('\u0000');
        if (!part || name !== part.name) return null;
        if (col === undefined) return rowUnit(part, Number(index) + dir);
        return rowUnit(part, Number(index))?.children?.[Number(col) + dir] ?? null;
      },
      drawn: (u) => drawnEl(u.id),
      async step(_from, dir) {
        const at = listed.findIndex((p) => p.name === state.part);
        const next = at < 0 ? (dir === 1 ? listed[0] : listed.at(-1)) : listed[at + dir];
        if (!next) return null;
        await pickPart(next.name);
        const now = partOf(state.part);
        return now && page && pageFor === `${now.name}\u0000${fromOf(now.name)}` ? rowUnit(now, page.from) : null;
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
    kind: 'sqlite',
    group: 'database',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'sqlite');
      draw();
    },
    hide() {
      host = null;
    },
    cards: () => (state.asCard ? { reading: readingCardDef, facts } : { reading: readingCardDef, contents: tablesCard, frontmatter: databaseCard, facts }),
    passing: (m) => (m === 'source' || state.asCard ? [byte] : [cellCard]),
    headSay() {
      const text = dbHeadWords(db);
      if (!text) return null;
      return { text, tone: 'tier', title: 'How the database is read · Metadata says more' };
    },
    key(e, m) {
      if (m === 'source' || state.asCard) return hex?.key(e) ?? false;
      return key(e);
    },
    parts: (m) => (m === 'source' || state.asCard ? ensureHex().parts() : tableParts()),
    floor: { on: () => state.asCard, set: (on) => setCard(on) },
    panelKey: () => `${id}:${mode}:${state.asCard}:${state.part}:${fromOf(state.part)}:${state.cell?.row ?? ''}:${state.cell?.col ?? ''}:${db.state}:${pageFor}:${blobHeads.size}:${hex?.selected() ?? ''}`,
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
      hex?.destroy();
      hex = null;
      host = null;
    },
  };
}

/** Opens `file` with the shell, as the reader last chose (with its log or alone): its summary, or why the page cannot be made. */
export async function openSqliteFor(shell: AppShell, path: string): Promise<{ readonly db: DbSummary } | { readonly kicker: string; readonly line: string }> {
  try {
    const got = await shell.tablesOpen(path, readAlone(path));
    if (got?.db) return { db: got.db };
    return { kicker: 'No reading for this file', line: 'Its bytes are not a SQLite database the app reads.' };
  } catch (e) {
    return { kicker: 'A database the app cannot read', line: e instanceof Error ? e.message : String(e) };
  }
}
