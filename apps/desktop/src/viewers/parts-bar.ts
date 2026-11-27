// The bar at the foot of a table page (decision "one kind of bar"): a database's tables, views and SQLite's
// own, with Schema last; a workbook's sheets, hidden ones in italic and marked. It sits inside the page, under the rows,
// and stays in view at the pane's foot while the rows scroll. A tab list: a press picks, ← and → move along it.
import { el } from '../frame/dom.ts';

export interface BarItem {
  readonly id: string;
  readonly name: string;
  /** A count after the name, small: a table's rows. */
  readonly count?: string;
  /** A mark after the name, in italic: "hidden", "very hidden". */
  readonly mark?: string;
}

export interface BarGroup {
  /** The small capitals before the group: "Tables", "Views", "SQLite's", "Sheets". */
  readonly label: string;
  readonly items: readonly BarItem[];
}

export interface PartsBarOptions {
  /** What the bar lists, for its accessible name: "Tables and views in gauges.sqlite". */
  readonly label: string;
  readonly groups: readonly BarGroup[];
  /** An item set apart at the bar's end: a database's Schema. */
  readonly end?: BarItem;
  readonly selected: string;
  pick(id: string): void;
}

export function partsBar(o: PartsBarOptions): HTMLElement {
  const nav = el('nav', 'marxy-pbar');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', o.label);
  const tabs: HTMLButtonElement[] = [];
  const tab = (item: BarItem): HTMLButtonElement => {
    const b = el('button', item.mark ? 'marxy-pbar-tab marxy-pbar-hid' : 'marxy-pbar-tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    const on = item.id === o.selected;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    b.dataset.marxyPart = item.id;
    b.append(el('span', 'marxy-pbar-name', item.name));
    if (item.mark) b.append(el('small', 'marxy-pbar-mark', item.mark));
    else if (item.count) b.append(el('small', 'marxy-pbar-count', item.count));
    b.addEventListener('click', () => o.pick(item.id));
    tabs.push(b);
    return b;
  };
  for (const g of o.groups) {
    if (g.items.length === 0) continue;
    nav.append(el('span', 'marxy-pbar-label', g.label));
    for (const item of g.items) nav.append(tab(item));
  }
  if (o.end) nav.append(el('span', 'marxy-pbar-gap'), tab(o.end));
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : Math.max(0, Math.min(tabs.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)));
    const id = tabs[next]?.dataset.marxyPart;
    if (id === undefined) return;
    o.pick(id);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.marxy-pbar-tab[aria-selected="true"]`)?.focus());
  });
  return nav;
}
