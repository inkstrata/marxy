// A row filter for a table or records reading (the Line's `=`, the Outline's rows field): the
// rows that hold the words stay, the rest are out of the view. Only the view: the file is never touched, and the filter
// goes with the page (a table drawn again keeps it, another document drops it). The rows view (reading-rows.ts) looks
// through every row of the file, a long one in the background.
import { rowsViewIn } from './reading-rows.ts';

const TABLE = '.marxy-records .marxy-reading-table';

interface Held {
  readonly q: string;
  readonly path: string | null;
  readonly watch: MutationObserver;
}

const held = new WeakMap<HTMLElement, Held>();

/** The reading table on the page, if the page is one. */
export function readingTable(article: HTMLElement): HTMLTableElement | null {
  return article.querySelector<HTMLTableElement>(TABLE);
}

/**
 * How many of the table's rows hold every word of `q`, and how many there are. Null while a long table is still being
 * counted: `counted` hears when it is done, and the next call has it.
 */
export function rowsHolding(article: HTMLElement, q: string, counted: () => void = () => {}): { readonly shown: number; readonly total: number } | null {
  return rowsViewIn(article)?.countHolding(q, counted) ?? null;
}

/**
 * Keeps only the rows holding every word of `q`, now and whenever the table is drawn again; `pathNow` says what the page
 * shows, so another document drops the filter. Resolves how many rows stay; null where the page has no reading table.
 */
export function filterRows(article: HTMLElement, q: string, pathNow: () => string | null): Promise<{ readonly shown: number; readonly total: number } | null> {
  clearRowFilter(article);
  const view = rowsViewIn(article);
  if (q.trim() === '' || !view) return Promise.resolve(null);
  const path = pathNow();
  const watch = new MutationObserver(() => {
    const now = held.get(article);
    if (!now) return;
    if (pathNow() !== now.path) {
      clearRowFilter(article);
      return;
    }
    // The page was made again (an edit, a reload): its new rows view takes the filter on.
    const fresh = rowsViewIn(article);
    if (fresh && fresh.filterOn() !== now.q && readingTable(article)?.getAttribute('data-marxy-row-filter') !== now.q) void fresh.filter(now.q);
  });
  watch.observe(article, { childList: true });
  held.set(article, { q, path, watch });
  return view.filter(q);
}

/** The filter on the page's table, or null. */
export function rowFilterOf(article: HTMLElement): string | null {
  return held.get(article)?.q ?? null;
}

/** Every row back. False when no filter was on. */
export function clearRowFilter(article: HTMLElement): boolean {
  const h = held.get(article);
  if (!h) return false;
  h.watch.disconnect();
  held.delete(article);
  rowsViewIn(article)?.clearFilter();
  return true;
}
