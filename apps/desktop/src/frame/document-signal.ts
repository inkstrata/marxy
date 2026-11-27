// What tells the workspace's panels that the page changed: a document opened, changed, saved or closed in any
// pane, or focus moved. Its own module because it is made at launch (workspace/fill.ts, the menu), while the
// panels that read it are summoned and load on their first unfold.
import type { AppHandle } from '../app.ts';

/** What the toolbar needs to know that the registry does not say: when the page changed. */
export interface DocumentSignal {
  /** Called when a document opened, changed, saved or closed in any pane, or focus moved. */
  onChange(cb: () => void): () => void;
}

/**
 * One per app instance, made where the fills are installed, so it has seen every open since launch. It holds
 * no subscription that outlives the panes: they are let go with the panes.
 */
export function createDocumentSignal(handle: AppHandle): DocumentSignal {
  const panes = handle.panes();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const watch = (pane: (typeof panes.panes)[number]): (() => void) =>
    pane.content.onDocumentChange(() => {
      emit();
    });
  watch(panes.panes[0]!);
  panes.onSplit(() => {
    const second = panes.panes[1];
    return second ? watch(second) : () => {};
  });
  panes.onChange(() => {
    emit();
  });
  return {
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
