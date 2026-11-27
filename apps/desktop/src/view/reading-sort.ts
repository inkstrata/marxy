// Sorting a table reading (a CSV, JSON Lines) by a column: the view's order, never the file's. A column's name, clicked
// or given Enter, sorts its rows one way, then the other, then puts them back in the file's order. Numbers and dates
// start high to low, words A to Z. Rows that did not read stay at the end; a cell a row does not have sorts last. The
// rows view (reading-rows.ts) sorts every row of the file, not only those on the page.
import { rowsViewOf } from './reading-rows.ts';

/** Listens on `doc` for a sort on any table reading in it. Returns the off switch. */
export function installReadingSort(doc: HTMLElement): () => void {
  const sortBy = (th: HTMLTableCellElement): void => {
    const table = th.closest<HTMLTableElement>('table.marxy-reading-table');
    const view = table ? rowsViewOf(table) : null;
    if (view) void view.sortBy(Number(th.getAttribute('data-marxy-sort')));
  };

  const header = (target: EventTarget | null): HTMLTableCellElement | null =>
    target instanceof Element ? target.closest<HTMLTableCellElement>('.marxy-reading-table th[data-marxy-sort]') : null;
  const onClick = (event: MouseEvent): void => {
    const th = header(event.target);
    if (!th || event.button !== 0) return;
    event.preventDefault();
    sortBy(th);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const th = header(event.target);
    if (!th) return;
    event.preventDefault();
    sortBy(th);
  };
  doc.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey);
  return () => {
    doc.removeEventListener('click', onClick);
    doc.removeEventListener('keydown', onKey);
  };
}
