// Files the left section staged changes in. A replace across files stages its edit in each
// file's own store, one undo step each, and nothing is written until Save. A file no pane shows is read into a store
// held here: the same store, through the panes' registry, that a pane is given when it opens the file, so its changes
// are there to read, undo and save. A store is held until it is clean again (saved, or undone back to its disk bytes);
// meanwhile leaving it in a pane loses nothing, and quitting asks about it (close.ts).
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { notify } from '../notices/index.ts';
import { holdOutsidePanes } from '../close.ts';
import { encodedIo } from '../document/encoding.ts';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';
import { keepBeforeOverwrite } from '../versions/recorder.ts';

const held = new Map<DocumentStore, () => void>();
const listeners = new Set<() => void>();

const tell = (): void => {
  for (const cb of [...listeners]) cb();
};

let handleRef: AppHandle | null = null;

function letGo(store: DocumentStore): void {
  const off = held.get(store);
  if (!off) return;
  off();
  held.delete(store);
  handleRef?.panes().stores.release(store);
  tell();
}

function keep(handle: AppHandle, store: DocumentStore): void {
  if (held.has(store)) return;
  handleRef = handle;
  const off = store.subscribe((snap, change) => {
    if (change.kind === 'close') {
      held.get(store)?.();
      held.delete(store);
      tell();
    } else if (!snap.dirty) queueMicrotask(() => letGo(store));
    else tell();
  });
  held.set(store, off);
  tell();
}

const fatal = new TextDecoder('utf-8', { fatal: true });

/**
 * The store for `path` that a staged edit goes into: the one a pane shows, else one read from disk now. Either way it is
 * held until it is clean again; a store that comes back clean from the edit is let go at once. A file that is not UTF-8
 * text is refused with the reason: its reading is the pane's to decide.
 */
export async function storeToStage(handle: AppHandle, path: string): Promise<DocumentStore | string> {
  const stores = handle.panes().stores;
  const shown = stores.held(path);
  if (shown) {
    // A pane may hold bytes that are not UTF-8: a replace worked out on their decoded text would splice in the wrong place.
    try {
      fatal.decode(shown.snapshot().buffer.bytes);
    } catch {
      return `${path} is not UTF-8 text here: nothing was changed in it`;
    }
    if (!held.has(shown)) {
      stores.acquire(path, () => shown);
      keep(handle, shown);
    }
    return shown;
  }
  let bytes: Uint8Array;
  try {
    // The reader chose to change this file from the Line: it is theirs to read and save, though only indexed until now.
    await handle.shell.markOpened?.(path).catch(() => undefined);
    bytes = await handle.shell.readFile(path);
  } catch (e) {
    return `${path} could not be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    fatal.decode(bytes);
  } catch {
    return `${path} is not UTF-8 text here: open it to change it`;
  }
  // Read again by a pane in the meantime: that one.
  const now = stores.held(path);
  const shell = handle.shell;
  const store =
    now ??
    openDocumentStore(
      encodedIo(
        {
          writeFileAtomic: (p, b, expected) => shell.writeFileAtomic(p, b, expected),
          recordRead: shell.recordRead ? (p, b) => shell.recordRead?.(p, b) : undefined,
          peekFile: shell.peekFile ? (p) => shell.peekFile!(p) : undefined,
          beforeOverwrite: (p, b) => keepBeforeOverwrite(p, b),
          writeFileNew: (p, b) => shell.writeFileNew(p, b),
        },
        shell,
        path,
      ),
      path,
      bytes,
    );
  stores.acquire(path, () => store);
  keep(handle, store);
  return store;
}

/** After a staged edit that changed nothing: a store held only for it goes. */
export function settle(store: DocumentStore): void {
  if (!store.snapshot().dirty) letGo(store);
}

/** The stores held with changes not yet saved. */
export const heldStores = (): DocumentStore[] => [...held.keys()].filter((s) => s.snapshot().dirty);

holdOutsidePanes(heldStores);

export const isHeld = (store: DocumentStore): boolean => held.has(store);

/**
 * The held stores with unsaved changes that no pane shows: the tab row shows each as a tab marked unsaved,
 * Versions' Now names them, and quitting asks about them once.
 */
export function unseenHeld(handle: Pick<AppHandle, 'panes'>): DocumentStore[] {
  const shown = new Set(handle.panes().panes.map((p) => p.content.store()));
  return heldStores().filter((s) => !shown.has(s));
}

/** Saves a held store; a write that fails says why. True when it is saved. */
export async function saveHeld(store: DocumentStore): Promise<boolean> {
  const r = await store.save();
  if (r.result === 'failed') {
    const why = r.error instanceof Error ? r.error.message : String(r.error);
    notify({ kind: 'error', text: `${basename(store.snapshot().path)} could not be saved · ${why}` });
    return false;
  }
  return true;
}

export function onHeld(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
