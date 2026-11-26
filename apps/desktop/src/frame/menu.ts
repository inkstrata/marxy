// A menu of plain actions at an element, in the verb menu's chrome and keys.
import { appHandle } from '../commands/app-handle.ts';
import { buildAppContext } from '../selection/bind.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';

export interface MenuItem {
  readonly title: string;
  readonly run?: () => void | Promise<void>;
  readonly chord?: string;
  readonly detail?: string;
  /** Says something and does nothing. */
  readonly note?: boolean;
}

export function anchorBelow(el: Element): MenuAnchor {
  const box = el.getBoundingClientRect();
  return { x: Math.round(box.left), y: Math.round(box.bottom + 4), top: Math.round(box.top) };
}

export function openMenu(at: MenuAnchor, label: string, items: readonly MenuItem[]): boolean {
  const rows: VerbMenuRow[] = items.map((item, i) => ({
    command: null,
    title: item.title,
    chord: item.chord,
    detail: item.detail,
    note: item.note || item.run === undefined,
    key: `frame.menu.${i}`,
    run: item.run,
  }));
  return openVerbMenu(at, buildAppContext(appHandle()), { registered: [], allActions: () => {}, rows, label });
}
