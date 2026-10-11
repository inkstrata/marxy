// One store per open document, shared by every view that shows it (ADR-0037 Amendment 1, point 1; D-01
// under precondition P1). Phase B left `openDocumentStore` making a store per open and the open path
// closing it on the next one; with two panes a document may be shown twice, and it must still have one
// owner of its bytes and its history. The registry hands the store already open for a path to the next
// view that asks for it and counts the views holding it, so the last one to let go closes it.
//
// Keyed by the store's path as it is now (a rename or a Save as moves it), looked up when asked: a store
// follows its file, and the registry follows the store. The path is the one the open was given. A symlink
// and its target are two stores: the shell offers no way to resolve a path (`shell-api` has no realpath,
// and D-10 changes neither it nor the Rust side), so the stale-write guard is what stands behind two
// buffers for one file reached through a link.

import type { DocumentStore } from './store.ts';

export interface StoreRegistry {
  /** The store open for `path`, else the one `open` makes; either way one more view holds it. */
  acquire(path: string, open: () => DocumentStore): DocumentStore;
  /** The store open for `path`, without holding it; null when none is. */
  held(path: string): DocumentStore | null;
  /** One view lets `store` go; the last one closes it. True when it closed. */
  release(store: DocumentStore): boolean;
  /** How many views hold `store` (0 when none does). */
  views(store: DocumentStore): number;
}

export function createStoreRegistry(): StoreRegistry {
  /** Each open store and the number of views holding it. */
  const holders = new Map<DocumentStore, number>();

  const forget = (store: DocumentStore): void => {
    holders.delete(store);
  };

  const held = (path: string): DocumentStore | null => {
    for (const store of holders.keys()) if (store.snapshot().path === path) return store;
    return null;
  };

  return {
    acquire(path, open) {
      const shared = held(path);
      if (shared) {
        holders.set(shared, (holders.get(shared) ?? 0) + 1);
        return shared;
      }
      const store = open();
      holders.set(store, 1);
      // A store closed by anything else (an app going) is no longer anyone's to share.
      store.subscribe((_snap, change) => {
        if (change.kind === 'close') forget(store);
      });
      return store;
    },
    held,
    release(store) {
      const count = holders.get(store) ?? 0;
      if (count > 1) {
        holders.set(store, count - 1);
        return false;
      }
      forget(store);
      store.close();
      return true;
    },
    views: (store) => holders.get(store) ?? 0,
  };
}
