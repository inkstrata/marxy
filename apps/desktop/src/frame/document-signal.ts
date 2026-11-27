// What tells the workspace's panels that the page changed: a document opened, changed, saved or closed in any
// pane, or focus moved. Its own module because it is made at launch (workspace/fill.ts, the menu), while the
// panels that read it are summoned and load on their first unfold.
import type { AppHandle } from '../app.ts';

/** What the toolbar needs to know that the registry does not say: when the page changed. */
export interface DocumentSignal {
  /** Called when a document opened, changed, saved or closed in any pane, or focus moved. */
  onChange(cb: () => void): () => void;
  /** Lets go of every pane subscription and listener; a pane split after this is not watched. */
  destroy(): void;
}

/**
 * One per app instance, made where the fills are installed, so it has seen every open since launch. `destroy`
 * lets go of its pane subscriptions, for an instance that goes before its panes do.
 */
export function createDocumentSignal(handle: AppHandle): DocumentSignal {
  const panes = handle.panes();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };
  let dead = false;
  const offs = new Set<() => void>();
  const watch = (pane: (typeof panes.panes)[number]): (() => void) => {
    const off = pane.content.onDocumentChange(() => {
      emit();
    });
    offs.add(off);
    return () => {
      if (offs.delete(off)) off();
    };
  };
  watch(panes.panes[0]!);
  panes.onSplit(() => {
    const second = panes.panes[1];
    return second && !dead ? watch(second) : () => {};
  });
  offs.add(
    panes.onChange(() => {
      emit();
    }),
  );
  return {
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      dead = true;
      for (const off of [...offs]) off();
      offs.clear();
      listeners.clear();
    },
  };
}
