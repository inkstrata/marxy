import type { AppPane } from './index.ts';
import type { Pane, PaneSet } from './pane-set.ts';

/**
 * Calls `cb` whenever any pane's store opens, changes or closes. A pane's content says so itself, so a link
 * or Back that opens a document straight in the second pane is heard, which the pane set's own `open`
 * change (only `openIn` emits it) is not.
 */
export function followAnyDocument(panes: Pick<PaneSet<AppPane>, 'panes' | 'onChange'>, cb: () => void): () => void {
  const watching = new Map<Pane<AppPane>, () => void>();
  const sync = (): boolean => {
    let moved = false;
    for (const [pane, off] of watching) {
      if (panes.panes.includes(pane)) continue;
      off();
      watching.delete(pane);
      moved = true;
    }
    for (const pane of panes.panes) {
      if (watching.has(pane)) continue;
      watching.set(pane, pane.content.onDocumentChange(cb));
      moved = true;
    }
    return moved;
  };
  // A split pane is announced only once its first document has landed, after that document's own signal,
  // so a pane arriving or leaving counts as a document change too.
  const offPanes = panes.onChange(() => {
    if (sync()) cb();
  });
  sync();
  return () => {
    offPanes();
    for (const off of watching.values()) off();
    watching.clear();
  };
}
