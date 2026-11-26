// Where a data tree drawn in part is drawn from (Draw from here), and the page's two ways on from a stop:
// Go on in Source at the line where the rest is, and Draw from here. The starting point is the tab's, never kept.
import { isTreeTop, treeFromOf, type TreeFrom } from '@marxy/core/src/reading/tree.ts';
import { tabState } from '../viewers/tab-state.ts';

const listeners = new Set<(host: Element, path: string) => void>();

/** Where `path`'s tree is drawn from in the tab at `host`, or null for the top. */
export function treeStartOf(host: Element | null, path: string): TreeFrom | null {
  if (!host) return null;
  return tabState(host, path).treeFrom.get(path) ?? null;
}

/** Draws `path`'s tree from `from` in the tab at `host` (the top for null); the views showing it set it again. */
export function drawTreeFrom(host: Element, path: string, from: TreeFrom | null): void {
  const held = tabState(host, path).treeFrom;
  if (isTreeTop(from)) held.delete(path);
  else held.set(path, from!);
  for (const cb of [...listeners]) cb(host, path);
}

export function onTreeStart(cb: (host: Element, path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Listens on `doc` for the tree's ways: a draw from somewhere, or Source at a byte. Returns the off switch. */
export function installTreeWays(doc: HTMLElement, ways: { readonly from: (from: TreeFrom) => void; readonly source: (byte: number) => void }): () => void {
  const onClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest<HTMLElement>('[data-marxy-tree-from], [data-marxy-tree-source]');
    if (!button || !doc.contains(button)) return;
    e.preventDefault();
    e.stopPropagation();
    const code = button.getAttribute('data-marxy-tree-from');
    if (code !== null) {
      const from = treeFromOf(code);
      if (from) ways.from(from);
      return;
    }
    const byte = Number(button.getAttribute('data-marxy-tree-source'));
    if (Number.isFinite(byte)) ways.source(byte);
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
