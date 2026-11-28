// The rows of a table or records reading in Read, every one of them. Core's `reading/rows.ts` indexes the file's
// bytes a slice at a time and reads a row again from its bytes when it is drawn; this module keeps the table to the rows
// on screen and a screen either side, with a gap above and below that stands for the rest at their height, so a file of
// millions of rows scrolls like a short one and holds a few bytes a row. A table no longer than the page draws whole
// keeps every row on the page, as before.
//
// Sorting, the row filter and find go through every row, a slice at a time, the loop given back between slices; a
// line over the table says how far a long pass has got. They change only the view: no byte of the file moves.
import { yieldToMain } from '../scheduler/index.ts';
import {
  findInRows,
  headHtml,
  indexSome,
  parseSome,
  READING_MAX_ROWS,
  readingRowsNote,
  recordsHeadText,
  rowAt,
  rowCount,
  rowHolds,
  rowRange,
  rowsHolding,
  rowsHtml,
  rowsSettled,
  sortByKeys,
  sortByKeysNow,
  sortKeys,
  sortKeysNow,
  filterWords,
  type Nature,
  type ReadingRows,
  type RowMatches,
  type SortKeys,
} from '@marxy/core/src/reading/rows.ts';
import type { Pace } from '@marxy/core/src/data/table-view.ts';
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import type { ViewerFind } from '../viewers/types.ts';

/** A slice of reading, sorting or finding holds the main thread about this long. */
const SLICE_MS = 8;
/** Rows drawn past each edge of the screen. */
const OVERSCAN = 30;
/** Rows left past an edge before the window is drawn again further on. */
const MARGIN = 8;
/**
 * The table is never taller than this; a longer one is scrolled through a scale. Layout reaches about 33.5 million
 * pixels, but painting places boxes in single-precision floats: past 2^24 (16.7 million) rows land a pixel or two off
 * and their rules double up and vanish.
 */
const MAX_PX = 16_000_000;
/** How often a pass still running says how far it has got. */
const NOTE_MS = 200;

const WORDS: Readonly<Record<Nature, readonly [string, string]>> = {
  number: ['high to low', 'low to high'],
  date: ['newest first', 'oldest first'],
  text: ['A to Z', 'Z to A'],
};

/** A slice of work gives the loop back: the reader asked for what is being done. */
const yieldNow = (): Promise<void> => yieldToMain('input');

/** The table's rows on the page: what the sort, the filter, find and the reading place ask of them. */
export interface RowsView {
  /** Whether only the rows near the screen are on the page. */
  windowed(): boolean;
  /** The row holding `byte` drawn where the table's scale puts it, so the page can be scrolled to it. */
  ensureThrough(byte: number): void;
  /** Sorts by column `col` one way, then the other, then back to the file's order. */
  sortBy(col: number): Promise<void>;
  /** Keeps the rows holding every word of `q`; resolves how many. */
  filter(q: string): Promise<{ readonly shown: number; readonly total: number } | null>;
  clearFilter(): void;
  filterOn(): string | null;
  /** How many rows hold `q`, now when it is known; else null, and `counted` hears when it is. */
  countHolding(q: string, counted: () => void): { readonly shown: number; readonly total: number } | null;
  /** Find over every row, for a table drawn in part. */
  readonly find: ViewerFind;
  /** Resolves when every row is indexed (and, for records, parsed). */
  settled(): Promise<void>;
  destroy(): void;
}

const views = new WeakMap<Element, RowsView>();

/** The rows view of the reading table in `article`, if there is one. */
export function rowsViewIn(article: Element): RowsView | null {
  const table = article.querySelector('.marxy-records .marxy-reading-table');
  return table ? (views.get(table) ?? null) : null;
}

/** The rows view of `table`. */
export const rowsViewOf = (table: Element): RowsView | null => views.get(table) ?? null;

export interface RowsOptions {
  readonly rows: ReadingRows;
  readonly root: HTMLElement;
  readonly table: HTMLTableElement;
  /** The element the page scrolls in now (it changes when panes are split). */
  readonly scroller: () => HTMLElement;
  /** After rows were drawn again: the page's block list is made again from them. */
  readonly onDrawn: () => void;
  /** Scrolls the page to `top` as the reader's own move: whatever the page was holding (the end, a place) lets go. */
  readonly scrollTo: (top: number) => void;
}

export function mountRows(o: RowsOptions): RowsView {
  const { rows, root, table } = o;
  const tbody = table.tBodies[0]!;
  let destroyed = false;
  /** Rows in the view's order (sorted, filtered); null is every row in the file's. */
  let order: Int32Array | null = null;
  let perm: Int32Array | null = null;
  let keep: { readonly q: string; readonly rows: Uint8Array; readonly shown: number } | null = null;
  let sorted: { col: number; step: 0 | 1; nature: Nature } | null = null;
  let keys: SortKeys | null = null;
  /** Bumped by each sort and filter: a pass overtaken by a newer one stops. */
  let generation = 0;
  let rowPx = 0;
  let drawn: { first: number; last: number } | null = null;
  let frame = 0;
  const widths: number[] = [];

  const viewCount = (): number => (order ? order.length : rowCount(rows));
  const whole = (): boolean => rows.indexed && rowCount(rows) <= READING_MAX_ROWS;
  const pace = (gen: number, onSlice?: (f: number) => void): Pace => ({
    yieldNow,
    budgetMs: SLICE_MS,
    aborted: () => destroyed || gen !== generation,
    onSlice,
  });

  // The line that says how far a pass has got; empty, and so not drawn, when none runs. Not a reading foot: a wide
  // table's "N more columns" goes on the first foot after the table (render/wide-tables.ts), as before.
  const note = document.createElement('div');
  note.className = 'marxy-rows-note';
  note.setAttribute('data-marxy-rows-note', '');
  note.setAttribute('aria-live', 'polite');
  root.querySelector('.marxy-reading-scroll')?.before(note);
  // The line a preview of the reading says where the rest are: here the table has them.
  root.querySelector('[data-marxy-rows-more]')?.remove();
  let noteAt = 0;
  const say = (text: string, now = false): void => {
    const t = performance.now();
    if (!now && text !== '' && t - noteAt < NOTE_MS) return;
    noteAt = t;
    note.textContent = text;
  };

  const gap = (): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    tr.className = 'marxy-rows-gap';
    tr.setAttribute('aria-hidden', 'true');
    tr.setAttribute('data-marxy-rows-gap', '');
    tr.append(document.createElement('td'));
    return tr;
  };
  const top = gap();
  const bottom = gap();
  const template = document.createElement('template');

  function measureRow(): void {
    for (const tr of tbody.rows) {
      if (tr.classList.contains('marxy-rows-gap') || tr.classList.contains('marxy-records-bad')) continue;
      const h = tr.getBoundingClientRect().height;
      if (h > 0) {
        rowPx = h;
        return;
      }
    }
  }

  /** Columns only ever widen as rows come and go, so the table does not jump sideways while it scrolls. */
  function holdWidths(): void {
    const cells = table.tHead?.rows[0]?.cells;
    if (!cells) return;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const style = getComputedStyle(cell);
      // min-width is of the content box: the padding comes off, or every draw would widen the column by it.
      const w = cell.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (w > (widths[i] ?? 0)) widths[i] = w;
      const min = `${widths[i]}px`;
      if (cell.style.minWidth !== min) cell.style.minWidth = min;
    }
  }

  function put(first: number, last: number, topPx: number, bottomPx: number): void {
    template.innerHTML = rowsHtml(rows, order, first, last);
    const span = String(table.tHead?.rows[0]?.cells.length ?? 1);
    for (const g of [top, bottom]) g.cells[0]!.colSpan = Number(span);
    top.cells[0]!.style.height = `${topPx}px`;
    bottom.cells[0]!.style.height = `${bottomPx}px`;
    tbody.replaceChildren(...(topPx > 0 ? [top] : []), template.content, ...(bottomPx > 0 ? [bottom] : []));
    drawn = { first, last };
  }

  /** Where the rows begin in the scroller's content. The page's own scroller is the viewport, whose box moves as it scrolls. */
  function rowsTop(sc: HTMLElement): number {
    const origin = sc === document.documentElement || sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
    return tbody.getBoundingClientRect().top - origin + sc.scrollTop;
  }

  /** How far into the rows the scroller's top is, and the scroller's height. */
  function place(): { readonly y: number; readonly vh: number } {
    const sc = o.scroller();
    const bodyTop = rowsTop(sc);
    return { y: sc.scrollTop - bodyTop, vh: sc.clientHeight };
  }

  /**
   * The rows for a scroll `y` into the table: the row at the screen's top (a fraction), where it is drawn, and the
   * table's height. Up to MAX_PX every row has its own height in the gaps; past it the scroll is a scale.
   */
  function windowAt(y: number, vh: number): { first: number; last: number; topPx: number; bottomPx: number } {
    const n = viewCount();
    const natural = n * rowPx;
    const height = Math.min(natural, MAX_PX);
    const yc = Math.max(0, Math.min(y, Math.max(0, height - vh)));
    const r0 = natural <= MAX_PX ? yc / rowPx : (yc / Math.max(1, height - vh)) * Math.max(0, n - vh / rowPx);
    const first = Math.max(0, Math.floor(r0) - OVERSCAN, Math.ceil(r0 - yc / rowPx));
    const last = Math.min(n, Math.ceil(r0 + vh / rowPx) + OVERSCAN);
    const topPx = natural <= MAX_PX ? first * rowPx : Math.max(0, yc - (r0 - first) * rowPx);
    return { first, last, topPx, bottomPx: Math.max(0, height - topPx - (last - first) * rowPx) };
  }

  /** The rows on the page made right for the scroll now (or as if at `y`). `force` draws them again whatever. */
  function draw(force = false, at?: number): void {
    if (destroyed || !table.isConnected) return;
    if (!windowed()) {
      if (force) {
        put(0, viewCount(), 0, 0);
        o.onDrawn();
      }
      return;
    }
    if (rowPx === 0) {
      if (!drawn) put(0, Math.min(viewCount(), OVERSCAN * 2), 0, 0);
      measureRow();
      if (rowPx === 0) return;
    }
    const { y, vh } = place();
    const want = windowAt(at ?? y, vh);
    const scaled = viewCount() * rowPx > MAX_PX;
    if (!force && !scaled && drawn) {
      const seeFirst = Math.max(0, Math.floor((at ?? y) / rowPx));
      const seeLast = Math.min(viewCount(), Math.ceil(((at ?? y) + vh) / rowPx));
      const covered = (seeFirst >= drawn.first + MARGIN || drawn.first === 0) && (seeLast <= drawn.last - MARGIN || drawn.last === viewCount());
      if (covered) {
        // The rows on the page still cover the screen; only the rows still being indexed lengthen the gap below.
        const below = (viewCount() - drawn.last) * rowPx;
        bottom.cells[0]!.style.height = `${below}px`;
        if (below > 0 && !bottom.isConnected) tbody.append(bottom);
        return;
      }
    }
    put(want.first, want.last, want.topPx, want.bottomPx);
    holdWidths();
    o.onDrawn();
  }

  function windowed(): boolean {
    return !whole();
  }

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node) || !target.contains(table) || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // A new width or text size can change a row's height; the table's own height changing as it draws must not redraw it.
  // The redraw is made on the next frame, not inside the observer's delivery: drawing changes the table's height, which is
  // observed too, and a change made while notifications are delivered ends the frame with a "loop completed with undelivered
  // notifications" error (how often depends on how slowly the machine paints).
  let seen = '';
  let resizeFrame = 0;
  const resize = new ResizeObserver(() => {
    const sc = o.scroller();
    const now = `${root.clientWidth}x${sc.clientHeight}`;
    if (now === seen) return;
    seen = now;
    if (!windowed() || resizeFrame !== 0) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      rowPx = 0;
      draw(true);
    });
  });
  resize.observe(root);
  window.addEventListener('resize', onResize);
  function onResize(): void {
    resize.disconnect();
    resize.observe(root);
  }

  // ---- reading every row, in the background ----------------------------------------------------------------------

  const head = root.querySelector<HTMLElement>('[data-marxy-rows-head]');
  let settledDone: Promise<void>;
  {
    let resolve!: () => void;
    settledDone = new Promise((r) => (resolve = r));
    const columnsAt = rows.columns.length;
    const finish = (): void => {
      if (head) head.textContent = recordsHeadText(rows);
      const tr = table.tHead?.rows[0];
      if (rows.form === 'records' && tr) {
        // Keys found further down join the columns, and a key's numbers set it to the right, once every line is read.
        tr.innerHTML = headHtml(rows);
        if (rows.columns.length !== columnsAt) widths.length = 0;
      }
      const n = rowCount(rows);
      if (n > 0) table.setAttribute('data-marxy-e', String(rowRange(rows, n - 1).end));
      say('', true);
      draw(true);
      resolve();
    };
    if (rowsSettled(rows)) {
      // Read through already: by the reading, for a table drawn whole, or by another pane on the same bytes, whose page
      // was made from the same first rows and still says "so far".
      if (windowed()) finish();
      else {
        say('', true);
        resolve();
      }
    } else {
      say(readingRowsNote(rows), true);
      void (async () => {
        let lastDraw = performance.now();
        let lastHead = lastDraw;
        while (!destroyed && !rowsSettled(rows)) {
          const t0 = performance.now();
          const until = (): boolean => performance.now() - t0 >= SLICE_MS;
          if (!rows.indexed) indexSome(rows, { until });
          else parseSome(rows, { until });
          say(readingRowsNote(rows));
          if (head && performance.now() - lastHead > NOTE_MS) {
            lastHead = performance.now();
            head.textContent = recordsHeadText(rows);
          }
          if (performance.now() - lastDraw > 100) {
            lastDraw = performance.now();
            if (sorted === null && keep === null) draw();
          }
          await yieldNow();
        }
        if (!destroyed) finish();
      })();
    }
  }
  const settled = (): Promise<void> => settledDone;

  // ---- the view's order: sorted, filtered ------------------------------------------------------------------------

  function applyOrder(): void {
    const base = perm;
    if (!keep) order = base;
    else {
      const out = new Int32Array(keep.shown);
      let k = 0;
      if (base) for (const r of base) (keep.rows[r] ? (out[k++] = r) : 0);
      else for (let r = 0; r < keep.rows.length; r++) if (keep.rows[r]) out[k++] = r;
      order = out;
    }
    drawn = null;
    draw(true);
    paintFind();
  }

  const sortNote = (): HTMLElement | null => root.querySelector<HTMLElement>('[data-marxy-sort-note]');

  async function sortBy(col: number): Promise<void> {
    const th = table.tHead?.rows[0]?.cells[col];
    if (!th) return;
    const gen = ++generation;
    const next: 0 | 1 | null = sorted?.col !== col ? 0 : sorted.step === 0 ? 1 : null;
    const name = th.textContent ?? '';
    if (next === null) {
      sorted = null;
      perm = null;
    } else if (!windowed()) {
      // A table drawn whole is sorted before the click returns: whatever asked for it reads the new order at once.
      if (keys?.col !== col) keys = sortKeysNow(rows, col);
      const down = (keys.nature === 'text') === (next === 1);
      perm = sortByKeysNow(keys, Int32Array.from({ length: rowCount(rows) }, (_, i) => i), down);
      sorted = { col, step: next, nature: keys.nature };
      th.setAttribute('aria-sort', down ? 'descending' : 'ascending');
    } else {
      if (!rowsSettled(rows)) {
        say(`Sorting by ${name} once every row is read`, true);
        await settled();
        if (gen !== generation || destroyed) return;
      }
      if (keys?.col !== col) {
        keys = null;
        const got = await sortKeys(rows, col, pace(gen, (f) => say(`Sorting by ${name} · ${Math.floor(f * 50)}%`)));
        if (!got) return;
        keys = got;
      }
      const nature = keys.nature;
      const down = (nature === 'text') === (next === 1);
      const all = Int32Array.from({ length: rowCount(rows) }, (_, i) => i);
      const got = await sortByKeys(keys, all, down, pace(gen, (f) => say(`Sorting by ${name} · ${50 + Math.floor(f * 50)}%`)));
      if (!got) return;
      perm = got;
      sorted = { col, step: next, nature };
      th.setAttribute('aria-sort', down ? 'descending' : 'ascending');
    }
    say('', true);
    for (const other of table.tHead?.rows[0]?.cells ?? []) if (other !== th || next === null) other.removeAttribute('aria-sort');
    // A sorted table is one block: its rows are in the view's order, not the file's.
    table.toggleAttribute('data-marxy-sorted', sorted !== null);
    const foot = sortNote();
    if (foot) {
      foot.dataset.marxyAtRest ??= foot.textContent ?? '';
      foot.textContent =
        sorted === null
          ? foot.dataset.marxyAtRest
          : `Sorted by ${name}, ${WORDS[sorted.nature][sorted.step]}: the view’s order, never the file’s. Again for ${sorted.step === 0 ? WORDS[sorted.nature][1] : 'the file’s order'}.`;
    }
    applyOrder();
  }

  // ---- the row filter ------------------------------------------------------------------------------------------

  const counts = new Map<string, number>();

  async function holding(q: string, gen: number, say_: boolean): Promise<Uint8Array | null> {
    if (!rowsSettled(rows)) {
      await settled();
      if (gen !== generation || destroyed) return null;
    }
    const kept = await rowsHolding(rows, null, q, pace(gen, say_ ? (f) => say(`Keeping the rows holding “${q}” · ${Math.floor(f * 100)}%`) : undefined));
    if (!kept) return null;
    const mask = new Uint8Array(rowCount(rows));
    for (const r of kept) mask[r] = 1;
    counts.set(q, kept.length);
    return mask;
  }

  async function filter(q: string): Promise<{ readonly shown: number; readonly total: number } | null> {
    const gen = ++generation;
    table.setAttribute('data-marxy-row-filter', q);
    const mask = await holding(q, gen, true);
    if (!mask) return null;
    say('', true);
    keep = { q, rows: mask, shown: counts.get(q)! };
    applyOrder();
    return { shown: keep.shown, total: rowCount(rows) };
  }

  function clearFilter(): void {
    generation++;
    say('', true);
    table.removeAttribute('data-marxy-row-filter');
    if (!keep) return;
    keep = null;
    applyOrder();
  }

  /** A count asked for while the reader types is worked one at a time, the newest asked kept, the rest dropped. */
  let counting: string | null = null;
  function countHolding(q: string, counted: () => void): { readonly shown: number; readonly total: number } | null {
    const words = filterWords(q);
    const known = counts.get(q);
    if (known !== undefined) return { shown: known, total: rowCount(rows) };
    if (!windowed()) {
      let shown = 0;
      for (let r = 0; r < rowCount(rows); r++) if (rowHolds(rows, r, words)) shown++;
      counts.set(q, shown);
      return { shown, total: rowCount(rows) };
    }
    if (counting !== q) {
      counting = q;
      void (async () => {
        await settled();
        const kept = await rowsHolding(rows, null, q, { yieldNow, budgetMs: SLICE_MS, aborted: () => destroyed || counting !== q });
        if (!kept || counting !== q) return;
        counting = null;
        counts.set(q, kept.length);
        counted();
      })();
    }
    return null;
  }

  // ---- find --------------------------------------------------------------------------------------------------

  let matches: RowMatches | null = null;
  let current = -1;

  function highlightApi(): { registry: Map<string, unknown>; make(ranges: Range[]): unknown } | null {
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    const ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!css?.highlights || typeof ctor !== 'function') return null;
    return { registry: css.highlights, make: (ranges) => new ctor(...ranges) };
  }

  /** A Range over `[from, to)` of a cell's text, walking its text nodes. */
  function rangeIn(td: HTMLElement, from: number, to: number): Range | null {
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let at = 0;
    let started = false;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const len = node.data.length;
      if (!started && from <= at + len) {
        range.setStart(node, from - at);
        started = true;
      }
      if (started && to <= at + len) {
        range.setEnd(node, to - at);
        return range;
      }
      at += len;
    }
    return null;
  }

  /** The matches in the rows on the page marked, the current one apart. */
  function paintFind(): void {
    const api = highlightApi();
    if (!api || !matches || !drawn) return;
    const all: Range[] = [];
    const now: Range[] = [];
    const first = lowerBound(matches.at, drawn.first);
    const trs = [...tbody.rows].filter((tr) => !tr.classList.contains('marxy-rows-gap'));
    for (let i = first; i < matches.count && matches.at[i]! < drawn.last; i++) {
      const tr = trs[matches.at[i]! - drawn.first];
      const td = tr?.cells[matches.cell[i]!];
      const range = td ? rangeIn(td, matches.from[i]!, matches.to[i]!) : null;
      if (!range) continue;
      (i === current ? now : all).push(range);
    }
    api.registry.set('marxy-find', api.make(all));
    api.registry.set('marxy-find-current', api.make(now));
  }

  function lowerBound(a: Int32Array, v: number): number {
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The view position at the screen's top. */
  function topRow(): number {
    if (rowPx === 0) return 0;
    const { y, vh } = place();
    const n = viewCount();
    const natural = n * rowPx;
    if (natural <= MAX_PX) return Math.max(0, Math.floor(y / rowPx));
    const height = MAX_PX;
    return Math.max(0, Math.floor((Math.max(0, y) / Math.max(1, height - vh)) * Math.max(0, n - vh / rowPx)));
  }

  /** The view position `i` drawn and on the reading line. */
  function showRow(i: number): void {
    const sc = o.scroller();
    const vh = sc.clientHeight;
    const y = yFor(i, vh);
    draw(true, y);
    const bodyTop = rowsTop(sc);
    o.scrollTo(bodyTop + y);
    draw(true);
  }

  /** The scroll into the rows that puts view position `i` on the reading line. */
  function yFor(i: number, vh: number): number {
    const n = viewCount();
    const lead = readingLine(vh) / Math.max(1, rowPx);
    const r0 = Math.max(0, i - lead);
    const natural = n * rowPx;
    if (natural <= MAX_PX) return r0 * rowPx;
    return (r0 / Math.max(1, n - vh / rowPx)) * (MAX_PX - vh);
  }

  let findGen = 0;
  const find: ViewerFind = {
    async run(re, progress) {
      const gen = ++findGen;
      matches = null;
      current = -1;
      if (!re) {
        find.clear();
        return 0;
      }
      await settled();
      if (gen !== findGen || destroyed) return 0;
      const got = await findInRows(rows, order, re, { yieldNow, budgetMs: SLICE_MS, aborted: () => destroyed || gen !== findGen }, progress);
      if (!got || gen !== findGen) return 0;
      matches = got;
      paintFind();
      return got.count;
    },
    first() {
      if (!matches || matches.count === 0) return -1;
      const i = lowerBound(matches.at, topRow());
      return i < matches.count ? i : 0;
    },
    show(i) {
      if (!matches || i < 0 || i >= matches.count) return;
      current = i;
      showRow(matches.at[i]!);
      paintFind();
    },
    clear() {
      findGen++;
      matches = null;
      current = -1;
      const api = highlightApi();
      api?.registry.delete('marxy-find');
      api?.registry.delete('marxy-find-current');
    },
  };

  // ---- the reading place --------------------------------------------------------------------------------------------

  function ensureThrough(byte: number): void {
    if (!windowed() || order !== null) return;
    const r = rowAt(rows, byte);
    if (r < 0) return;
    if (rowPx === 0) draw(true);
    if (rowPx === 0) return;
    const vh = o.scroller().clientHeight;
    draw(true, yFor(r, vh));
  }

  const view: RowsView = {
    windowed,
    ensureThrough,
    sortBy,
    filter,
    clearFilter,
    filterOn: () => keep?.q ?? null,
    countHolding,
    find,
    settled,
    destroy() {
      destroyed = true;
      generation++;
      findGen++;
      document.removeEventListener('scroll', onScroll, { capture: true });
      resize.disconnect();
      window.removeEventListener('resize', onResize);
      if (frame !== 0) cancelAnimationFrame(frame);
      if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
      views.delete(table);
    },
  };
  views.set(table, view);
  if (windowed()) draw(true);
  return view;
}
