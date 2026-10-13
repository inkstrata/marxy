// The data strip's two built tools (K-10b; ADR-0071 ruling 3, Table first): *Table view* covers a CSV's or TSV's Source
// with a grid and takes it away again, and *Column stats* shows the stats of each column under it. Both are views: they
// write nothing. The grid's module is loaded on first use, off the way to first text (MARXY-33).
import type { Pane } from '../pane/pane-set.ts';
import type { AppPane } from '../pane/index.ts';
import { notify } from '../notices/index.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const lensModule = () => import('../kinds/table-lens.ts');

const CSV_OR_TSV = /\.(csv|tsv)$/i;

/** The focused pane when it holds a `.csv` or `.tsv`. */
function focusedTable(): Pane<AppPane> | null {
  const pane = appHandle()?.panes().focused;
  if (!pane || pane.view.store() === null) return null;
  const path = pane.path();
  return path !== null && CSV_OR_TSV.test(path) ? pane : null;
}

const offered = (): boolean => focusedTable() !== null;

/** Why a data tool is off: said on the strip's button (K-08's rule). */
function why(): string | null {
  const pane = appHandle()?.panes().focused;
  if (!pane || pane.kind() !== 'data') return null;
  return 'only a CSV or TSV file reads as a table';
}

async function toggleLens(): Promise<void> {
  const pane = focusedTable();
  if (!pane) return;
  const { lensOf, openTableLens } = await lensModule();
  const open = lensOf(pane);
  if (open) {
    await open.close();
    return;
  }
  const lens = await openTableLens(pane);
  if (!lens) notify({ kind: 'refused', text: 'Could not show the table · the file is unchanged · open it in Source and try again' });
}

async function toggleStats(): Promise<void> {
  const pane = focusedTable();
  if (!pane) return;
  const { lensOf, openTableLens } = await lensModule();
  const lens = lensOf(pane) ?? (await openTableLens(pane));
  if (!lens) {
    notify({ kind: 'refused', text: 'Could not show column stats · the file is unchanged · open it in Source and try again' });
    return;
  }
  await lens.setStats();
}

export function dataCommands(): readonly Command[] {
  return [
    {
      id: 'data.table-lens',
      title: 'Table view',
      group: 'view',
      when: offered,
      unavailable: why,
      run: toggleLens,
    },
    {
      id: 'data.column-stats',
      title: 'Column stats',
      group: 'view',
      when: offered,
      unavailable: why,
      run: toggleStats,
    },
  ];
}
