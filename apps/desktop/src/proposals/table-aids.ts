// Table aids (proposal `table_aids`): a long table's header stays in view while its rows scroll under it, and the row and
// the column under the pointer are traced. The header is moved with a transform, not made sticky: a table that scrolls
// sideways is its own scroll box, which a sticky header cannot leave.
import { onProposals, proposalOn } from './state.ts';

/** Past this many rows the column is not traced: marking it touches every row. */
const TRACE_MAX_ROWS = 2000;

const TABLES = '.marxy-article table';

/** The bottom of the pane head a table's header stays under, read once per pane in a pass (`edges`), not once per table. */
function edgeOf(table: HTMLElement, edges: Map<Element | null, number>): number {
  const pane = table.closest('.marxy-pane');
  let edge = edges.get(pane);
  if (edge === undefined) {
    edge = pane?.querySelector<HTMLElement>(':scope > .marxy-head')?.getBoundingClientRect().bottom ?? 0;
    edges.set(pane, edge);
  }
  return edge;
}

function lift(on: boolean): void {
  const edges = new Map<Element | null, number>();
  for (const table of document.querySelectorAll<HTMLTableElement>(TABLES)) {
    const head = table.tHead;
    if (!head) continue;
    const rect = table.getBoundingClientRect();
    const by = on ? Math.min(Math.max(0, edgeOf(table, edges) - rect.top), Math.max(0, rect.height - head.offsetHeight * 2)) : 0;
    if (by > 0) {
      head.style.transform = `translateY(${by}px)`;
      head.setAttribute('data-marxy-lifted', '');
    } else if (head.hasAttribute('data-marxy-lifted')) {
      head.style.removeProperty('transform');
      head.removeAttribute('data-marxy-lifted');
    }
  }
}

let traced: HTMLTableElement | null = null;

function untrace(): void {
  traced?.querySelectorAll('[data-marxy-col-here]').forEach((c) => c.removeAttribute('data-marxy-col-here'));
  traced = null;
}

function trace(cell: HTMLTableCellElement): void {
  const table = cell.closest('table');
  if (!table || table.rows.length > TRACE_MAX_ROWS) return untrace();
  const col = cell.cellIndex;
  if (traced === table && table.querySelector(`[data-marxy-col-here]`) === table.rows[0]?.cells[col]) return;
  untrace();
  traced = table;
  for (const row of table.rows) row.cells[col]?.setAttribute('data-marxy-col-here', '');
}

export function installTableAids(): () => void {
  let queued = false;
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      lift(proposalOn('table_aids'));
    });
  };
  const onOver = (event: PointerEvent): void => {
    if (!proposalOn('table_aids')) return;
    const cell = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>(`${TABLES} :is(td, th)`) : null;
    if (cell) trace(cell);
    else if (traced) untrace();
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  const off = onProposals((now) => {
    lift(now.table_aids);
    if (!now.table_aids) untrace();
  });
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onScroll);
    document.removeEventListener('pointerover', onOver);
    off();
    lift(false);
    untrace();
  };
}
