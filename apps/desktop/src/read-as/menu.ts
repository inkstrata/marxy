// The Read as menu: `readingsFor` laid out in its three groups, the way shown now marked, at the
// top of the pane. `r` opens it from the page; the Metadata panel lists the same ladder as rows, which retired
// the pane head's chip.
import type { AppContext } from '../commands/registry.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import { readAs, readingsFor } from './ladder.ts';

/** Where the menu opens: the middle of the pane's top. */
function anchorFor(host: HTMLElement | null): MenuAnchor {
  const r = host?.getBoundingClientRect();
  return { x: Math.round(r ? r.left + r.width / 2 : window.innerWidth / 2), y: Math.round((r?.top ?? 0) + 60) };
}

export function openReadAsMenu(path: string, ctx: AppContext, host: HTMLElement | null): boolean {
  const ways = readingsFor(path);
  if (ways.length === 0) return false;
  const rows: VerbMenuRow[] = [];
  let group = '';
  ways.forEach((way, i) => {
    if (way.group !== group) {
      group = way.group;
      rows.push({ command: null, note: true, key: `read-as.group.${i}`, title: group });
    }
    rows.push({
      command: null,
      key: `read-as.${way.id || 'found'}`,
      title: way.label,
      detail: way.current ? 'shown now' : way.note || undefined,
      run: way.current ? undefined : () => readAs(path, way.id, ctx),
      note: way.current,
    });
  });
  return openVerbMenu(anchorFor(host), ctx, { registered: [], allActions: () => {}, rows, label: `Read ${path.split('/').pop()} as` });
}
