// One store per open document, shared by every view that shows it. Making a store per open and
// closing it on the next one does not hold: with two panes a document may be shown twice, and it must still have one
// owner of its bytes and its history. The registry hands the store already open for a path to the next
// view that asks for it and counts the views holding it, so the last one to let go closes it.
//
// Keyed by the store's path as it is now (a rename or a Save as moves it), looked up when asked: a store
// follows its file, and the registry follows the store. The path is the one the first open was given; another
// spelling of the same file (a Windows path in another case, with the other slash, `.` and `..` segments, or verbatim)
// finds the same store (`sameFilePath`), so two stores never hold one file's bytes under two spellings. A symlink
// and its target are two stores: the shell offers no way to resolve a path (`shell-api` has no realpath,
// and this changes neither it nor the Rust side), so the stale-write guard is what stands behind two
// buffers for one file reached through a link.
//
// A store released with `keep` (a tab the reader left, not a pane closed) may stay open with no view, a warm
// store, so coming back to it reads and parses nothing. Only the open path reaches a warm store, through
// `claim`; `held` and `acquire` never see one, so a store made by anything else for the same path replaces it.
// What bounds them: `limit` stores, the oldest evicted first, and `keeps` (clean, an ordinary file, not huge).

import { sameFilePath } from '@marxy/core/src/index-model/paths.ts';
import type { DocumentStore } from './store.ts';

export interface StoreRegistry {
  /** The store open for `path` (whatever the case of a Windows path), else the one `open` makes; either way one more view holds it. A warm store for `path` is closed first. */
  acquire(path: string, open: () => DocumentStore): DocumentStore;
  /** The store a view holds for `path`, without holding it; null when none is (a warm store is not held). */
  held(path: string): DocumentStore | null;
  /**
   * One view lets `store` go; the last one closes it, or, with `keep`, leaves it warm when it qualifies. True when it closed.
   */
  release(store: DocumentStore, opts?: { readonly keep?: boolean }): boolean;
  /** How many views hold `store` (0 when none does). */
  views(store: DocumentStore): number;
  /** The warm store for `path`, now held once by the caller; null when none is (or it no longer qualifies, and went). */
  claim(path: string): DocumentStore | null;
  /**
   * Whether the file of `store` may have changed while no view showed it. Clears the mark: the caller reads the file
   * now. Marked again by any later event, so call it until it answers false.
   */
  takeUnseen(store: DocumentStore): boolean;
  /** The watch heard a change to `store`'s file with no view to put it in. */
  markUnseen(store: DocumentStore): void;
  /** The warm store for `path` closes. True when there was one. */
  drop(path: string): boolean;
  /** Warm stores whose path is not in `paths` close (a tab the window no longer has). */
  retain(paths: readonly string[]): void;
  /** `store` closes whoever holds it (its file can no longer be read as it was). */
  discard(store: DocumentStore): void;
  /** Every warm store closes. */
  clearWarm(): void;
  /** The warm stores, oldest first. */
  warm(): readonly DocumentStore[];
}

export interface WarmPolicy {
  /** The most stores kept warm. */
  readonly limit: number;
  /** Whether `store` may be kept: clean, no pending disk change, an ordinary file of a size worth keeping. */
  keeps(store: DocumentStore): boolean;
}

/**
 * `onClosed`: a store closed, under the path it had then (the shell's stale-write record for it goes). What it hands back
 * runs once a save the store had under way is done: that save is still checked against the record.
 * `warm`: unset keeps nothing, and a released store closes as it always did.
 */
export function createStoreRegistry(opts: { readonly onClosed?: (path: string) => (() => void) | void; readonly warm?: WarmPolicy } = {}): StoreRegistry {
  /** Each open store and the number of views holding it. */
  const holders = new Map<DocumentStore, number>();
  /** Stores kept with no view, oldest first. Each is still open: its watch and its history stay. */
  const warm: DocumentStore[] = [];
  /** Stores whose file may have changed with no view to show it. */
  const unseen = new Set<DocumentStore>();
  /** Stores being closed by the registry to make way for another of the same path: that path's read record is the next store's. */
  const replaced = new Set<DocumentStore>();

  const forget = (store: DocumentStore): void => {
    holders.delete(store);
    unseen.delete(store);
    const at = warm.indexOf(store);
    if (at >= 0) warm.splice(at, 1);
  };

  const held = (path: string): DocumentStore | null => {
    for (const store of holders.keys()) if (sameFilePath(store.snapshot().path, path)) return store;
    return null;
  };

  const warmAt = (path: string): DocumentStore | null => warm.find((store) => sameFilePath(store.snapshot().path, path)) ?? null;

  const evict = (store: DocumentStore, quiet = false): void => {
    if (quiet) replaced.add(store);
    forget(store);
    store.close();
  };

  const trim = (): void => {
    const limit = opts.warm?.limit ?? 0;
    while (warm.length > limit) evict(warm[0]!);
  };

  return {
    acquire(path, open) {
      const shared = held(path);
      if (shared) {
        holders.set(shared, (holders.get(shared) ?? 0) + 1);
        return shared;
      }
      const old = warmAt(path);
      if (old) evict(old, true);
      const store = open();
      holders.set(store, 1);
      // A store closed by anything else (an app going) is no longer anyone's to share.
      store.subscribe((snap, change) => {
        if (change.kind === 'rename' || (change.kind === 'save' && change.renamedFrom !== undefined)) {
          // This store now answers to a path a warm store was kept for: two stores for one file would each save it.
          const clash = warmAt(snap.path);
          if (clash && clash !== store) evict(clash, true);
        }
        if (change.kind !== 'close') return;
        const quiet = replaced.delete(store);
        forget(store);
        if (quiet) return;
        const after = opts.onClosed?.(store.snapshot().path);
        if (after) store.whenSettled(after);
      });
      return store;
    },
    held,
    release(store, o) {
      const count = holders.get(store) ?? 0;
      if (count > 1) {
        holders.set(store, count - 1);
        return false;
      }
      forget(store);
      if (o?.keep === true && count === 1 && opts.warm && opts.warm.limit > 0 && opts.warm.keeps(store)) {
        warm.push(store);
        trim();
        return false;
      }
      store.close();
      return true;
    },
    views: (store) => holders.get(store) ?? 0,
    claim(path) {
      const store = warmAt(path);
      if (!store) return null;
      if (!opts.warm?.keeps(store)) {
        evict(store);
        return null;
      }
      warm.splice(warm.indexOf(store), 1);
      holders.set(store, 1);
      return store;
    },
    takeUnseen: (store) => unseen.delete(store),
    markUnseen(store) {
      if (holders.has(store) || warm.includes(store)) unseen.add(store);
    },
    drop(path) {
      const store = warmAt(path);
      if (!store) return false;
      evict(store);
      return true;
    },
    retain(paths) {
      for (const store of [...warm]) {
        const at = store.snapshot().path;
        if (!paths.some((p) => sameFilePath(p, at))) evict(store);
      }
    },
    discard(store) {
      forget(store);
      store.close();
    },
    clearWarm() {
      for (const store of [...warm]) evict(store);
    },
    warm: () => [...warm],
  };
}
