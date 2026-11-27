// The unsaved state of every open document, for whoever draws it: the window's unsaved chip
// and spine marks ask `changesSummary(path)` and listen with `onChangesSummary`. Each store a pane shows is followed; its
// patch is worked out only when asked, and kept until its bytes or its disk copy change.
import type { AppHandle } from '../app-types.ts';
import type { DocumentStore } from '../document/store.ts';
import { changesOf, NO_CHANGES, type Changes } from './patch.ts';

export interface ChangesSummary {
  readonly places: number;
  readonly added: number;
  readonly removed: number;
}

let handleRef: AppHandle | null = null;
const listeners = new Set<(path: string, movedFrom?: string) => void>();
const cache = new WeakMap<DocumentStore, { readonly bytes: Uint8Array; readonly disk: Uint8Array | null; readonly changes: Changes | null }>();

/** The store a pane shows for `path`, or null when none is open. */
export function storeFor(path: string): DocumentStore | null {
  for (const pane of handleRef?.panes().panes ?? []) {
    const store = pane.content.store();
    if (store && store.snapshot().path === path) return store;
  }
  return null;
}

/** The store's changes now: null when too large to compare. */
export function changesOfStore(store: DocumentStore): Changes | null {
  const snap = store.snapshot();
  const bytes = snap.buffer.bytes;
  const held = cache.get(store);
  if (held && held.bytes === bytes && held.disk === snap.disk) return held.changes;
  const changes = snap.dirty ? changesOf(snap.path, snap.disk, bytes) : NO_CHANGES;
  cache.set(store, { bytes, disk: snap.disk, changes });
  return changes;
}

/** Places, lines added and removed for the open document at `path`; null when it is not open or too large to compare. */
export function changesSummary(path: string): ChangesSummary | null {
  const store = storeFor(path);
  const c = store ? changesOfStore(store) : null;
  return c ? { places: c.places, added: c.added, removed: c.removed } : null;
}

/** The buffer lines (0-based) the unsaved changes add or change at `path`: where a spine marks an edit. */
export function changedLines(path: string): readonly number[] {
  const store = storeFor(path);
  return (store ? changesOfStore(store)?.lines : null) ?? [];
}

/**
 * `cb` hears the path of each open document whose unsaved state may have changed, and the path it had when a Save As or a
 * rename just moved it; returns the off switch.
 */
export function onChangesSummary(cb: (path: string, movedFrom?: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const tell = (path: string, movedFrom?: string): void => {
  for (const cb of [...listeners]) {
    try {
      cb(path, movedFrom);
    } catch (e) {
      console.warn('marxy: a changes listener threw', e);
    }
  }
};

/** Follows every store the panes show, once for the window. */
export function installChangesWatch(handle: AppHandle): () => void {
  handleRef = handle;
  const followed = new Map<DocumentStore, () => void>();
  const sync = (): void => {
    const now = new Set(handle.panes().panes.map((p) => p.content.store()).filter((s): s is DocumentStore => s !== null));
    for (const [store, off] of followed) {
      if (now.has(store)) continue;
      off();
      followed.delete(store);
    }
    for (const store of now) {
      if (followed.has(store)) continue;
      followed.set(store, store.subscribe((snap, change) => {
        if (change.kind === 'close') return;
        tell(snap.path, change.kind === 'save' ? change.renamedFrom : change.kind === 'rename' ? change.from : undefined);
      }));
      tell(store.snapshot().path);
    }
  };
  const offPanes = handle.panes().onChange(sync);
  // A store opened in place of another in a pane is no pane change; each pane's own document signal says it.
  const offDoc = handle.panes().onAnyDocumentChange(sync);
  sync();
  return () => {
    offPanes();
    offDoc();
    for (const off of followed.values()) off();
    followed.clear();
    if (handleRef === handle) handleRef = null;
  };
}
