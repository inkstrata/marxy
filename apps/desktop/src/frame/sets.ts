// Sets (proposal `sets`): the window's tabs, and what each pane shows, saved under a name in frame.json and opened again
// from the Library. Opening one puts its tabs in the row in order and shows its first pane's document in the first pane
// and its second beside it. Nothing about a file is kept but its path.
import type { TabSet } from '@marxy/core/src/layout/frame-storage.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { notify } from '../notices/index.ts';
import { intend } from './intent.ts';
import { isTransient } from './tabs.ts';
import type { Frame } from './types.ts';

/** The row's tabs that are files, and what each pane shows of them. */
export function openTabs(handle: AppHandle, frame: Frame): { tabs: string[]; shown: string[] } {
  const tabs = frame.tabs.model.tabs.map((t) => t.path).filter((p) => !isTransient(p));
  const shown = handle
    .panes()
    .panes.map((p) => p.path())
    .filter((p): p is string => p !== null && tabs.includes(p));
  return { tabs, shown: shown.length > 0 || tabs.length === 0 ? shown : [tabs[0]!] };
}

export function nextName(sets: readonly TabSet[], tabs: readonly string[]): string {
  const first = tabs[0];
  const base = first ? basename(first).replace(/\.[^.]+$/, '') : 'Set';
  if (!sets.some((s) => s.name === base)) return base;
  for (let n = 2; ; n++) if (!sets.some((s) => s.name === `${base} ${n}`)) return `${base} ${n}`;
}

export async function openSet(handle: AppHandle, frame: Frame, set: TabSet): Promise<void> {
  const panes = handle.panes();
  frame.tabs.model.adopt(set.tabs);
  frame.tabs.render();
  const first = panes.panes[0]!;
  panes.focus(first);
  const [left, right] = set.shown;
  if (left !== undefined) {
    intend(first.host, left, 'new');
    if (!(await panes.openIn(0, left))) return;
  }
  if (right !== undefined) {
    const second = handle.panes().panes[1];
    if (second) intend(second.host, right, 'new');
    await handle.panes().openIn(second ? second.slot : 'other', right);
    handle.panes().focus(first);
  }
  const total = set.tabs.length;
  notify({ kind: 'done', text: `Opened ${set.name}: ${total} ${total === 1 ? 'file' : 'files'}`, fades: true });
}
