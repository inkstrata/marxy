// Live reload (ADR-0018): one watch per document store, following it through a rename and a Save as,
// and closed with it (B-14, lifted from app.ts). The watch belongs to the store, not to a pane: however
// many views show it, the store is read and reloaded once, every view is asked before it is (a view
// holding Source text the store cannot see keeps the change out), and each view is put at its own place
// in the new bytes (D-10).
import { contentHash, reparseMarkdown } from '@marxy/core';
import { followPath, restorePosition } from '@marxy/core/src/position/restore.ts';
import { effectForOpenDocument } from '@marxy/core/src/position/watch-events.ts';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import { classify } from '@marxy/core/src/index-model/kinds.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { AppShell } from '../app.ts';
import { diskChangedEditsKeptNotice, fileRemovedNotice } from '../notices/disk.ts';
import { paneOf, type NoticeTarget } from '../notices/index.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import type { DocumentStore } from './store.ts';

export interface LiveReloadDeps {
  readonly shell: Pick<AppShell, 'watch' | 'readFile' | 'peekFile' | 'mark' | 'allowAssetScope'>;
  /**
   * Opens `path` with `at` on the reading line, replacing this store, in `view` (every view of the store in
   * turn, each at its own place; `view` is unset for a caller with one). Called from inside `serially`
   * (a rename with nothing unsaved), so it must not queue: the open would wait on the task waiting for it.
   */
  open(path: string, at: number, view?: RenderedView): Promise<void>;
  /** The queue opens, mode switches and watch events run on, one at a time: every view's of the store. */
  serially<T>(fn: () => Promise<T>): Promise<T>;
  /** Source text typed, in any view, and not yet in the store goes into it, before a rename follow reads the buffer. */
  foldSource(): Promise<void>;
  /** The store follows a rename under unsaved edits and every view has set the page again: title and selection. */
  renamed(path: string): Promise<void>;
  /** A markdown file in the watched folder changed (not the echo of Marxy's own save): re-walk its root. */
  changed(path: string): void;
}

export interface DocumentWatch {
  close(): void;
  /**
   * Resolves once the watch follows the store's path as it is now: after a rename or a Save as, when
   * the new folder's watch is registered (on Tauri, `watch_root` and `listen` are round trips), so a
   * write right after it is seen (the B-14 review).
   */
  moved(): Promise<void>;
}

/**
 * One watch per store, however many panes show it and however often they ask (the B-14 review, D-10):
 * asking again for the store already watched returns its watch; asking for another starts one. A watch
 * closes with its store, which closes with its last view, so a pane that goes while another still shows
 * the store leaves the watch where it is.
 */
export function oneWatchPerStore(start: (store: DocumentStore) => Promise<DocumentWatch>): {
  watch(store: DocumentStore): Promise<DocumentWatch>;
  /** The watch started for `store`, or null when none was. */
  of(store: DocumentStore): Promise<DocumentWatch> | null;
} {
  const started = new Map<DocumentStore, Promise<DocumentWatch>>();
  return {
    watch(store) {
      let watch = started.get(store);
      if (!watch) {
        watch = start(store);
        started.set(store, watch);
        // The watch closed with the store; a store closed before its watch was ready is not asked for again.
        const off = store.subscribe((_snap, change) => {
          if (change.kind !== 'close') return;
          started.delete(store);
          off();
        });
      }
      return watch;
    },
    of: (store) => started.get(store) ?? null,
  };
}

/** `performance.now()` at the watch event and once the file was read, for the `live_reload` mark. */
interface ReloadStages {
  readonly start: number;
  readonly read: number;
}

const isMarkdownPath = (path: string): boolean => classify(path) === 'markdown';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Watches the folder of `store`'s file for as long as the store is open. A change to the file reloads
 * it through the store at each view's own place; a rename follows it (keeping unsaved edits); a delete
 * keeps the page and says so. The watch moves with the store's path (a rename, a Save as) and closes
 * when the store closes. The place for the watch is the first view's; every view restores to its own,
 * mapped through the same change.
 */
export async function watchDocument(
  store: DocumentStore,
  views: () => readonly RenderedView[],
  deps: LiveReloadDeps,
): Promise<DocumentWatch> {
  const { shell } = deps;
  let current: { close(): void } | null = null;
  let closed = false;
  let watchedPath = store.snapshot().path;
  /** The watch being moved to the store's new folder, awaited by a rename follow. */
  let moving: Promise<void> = Promise.resolve();

  async function readOpenFileWithRetry(path: string): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await (shell.peekFile ? shell.peekFile(path) : shell.readFile(path));
      } catch {
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    return null;
  }

  /**
   * New bytes from disk, as the store's `reload` transition: it adopts them (and records the read for
   * the stale-write guard) unless the buffer has unsaved edits, which it keeps. Each view is told its
   * place in the new bytes first, so its repaint holds that place, not a byte of the old bytes.
   */
  async function reloadOpenFromDisk(
    bytes: Uint8Array,
    places: ReadonlyMap<RenderedView, ReadingPosition>,
    stages: ReloadStages,
  ): Promise<void> {
    const t0 = performance.now();
    for (const [view, place] of places) view.expectReloadAt(place);
    let outcome: Awaited<ReturnType<DocumentStore['reload']>>;
    try {
      // Every view is asked, at the turn the store would commit: Source text typed in any pane that shows
      // it is an unsaved edit the store cannot see, and an outside write must not be adopted over it (and
      // the stale-write guard armed on it), or a save would write over the other program's change.
      outcome = await store.reload(bytes, { holds: unfoldedSourceInAnyView });
    } finally {
      for (const view of places.keys()) view.expectReloadAt(null);
    }
    if (outcome === 'kept') {
      say(diskChangedEditsKeptNotice);
      return;
    }
    const t1 = performance.now();
    for (const view of places.keys()) await view.settled();
    if (outcome !== 'reloaded') return;
    const t2 = performance.now();
    // From the watch event to every view settled at its place (B-23): the read, the parse and the mapping
    // of the place count, as the reader waits for them too. `store` is the store's transition, which sets the
    // page synchronously (render, sanitise, the first screens); `settle` is the typeset viewport after it.
    const detail = [
      `ms=${(t2 - stages.start).toFixed(1)}`,
      `read=${(stages.read - stages.start).toFixed(1)}`,
      `map=${(t0 - stages.read).toFixed(1)}`,
      `store=${(t1 - t0).toFixed(1)}`,
      `settle=${(t2 - t1).toFixed(1)}`,
    ];
    await shell.mark('live_reload', Date.now(), detail.join(' '));
  }

  /**
   * The watch is the document's directory: a markdown file there changed, so its root is re-walked
   * (coalesced, at idle). The echo of Marxy's own save is not a change: an event naming the open
   * document while disk holds exactly the buffer's bytes re-walks nothing.
   */
  function refreshIndexForWatch(events: readonly WatchEvent[], path: string, diskBytes: Uint8Array | null): void {
    const buffer = store.snapshot().buffer;
    const echo = diskBytes !== null && contentHash(diskBytes) === contentHash(buffer.bytes);
    const changed = (p: string | undefined) => p !== undefined && isMarkdownPath(p) && !(echo && p === path);
    if (events.some((e) => changed(e.path) || changed(e.to))) deps.changed(path);
  }

  /** Source text typed in any view of the store and not yet folded into it. */
  function unfoldedSourceInAnyView(): boolean {
    return views().some((view) => view.sourceHasUnfoldedEdits());
  }

  /** Unsaved changes: the buffer differs from disk, or a view's Source holds text not yet folded in. */
  function hasUnsavedChanges(): boolean {
    return store.snapshot().dirty || unfoldedSourceInAnyView();
  }

  /** The pane `view` draws in: a notice about the file is said in the panes that show it, and in no other. */
  const targetOf = (view: RenderedView): NoticeTarget => ({ pane: paneOf(view.host?.article) });
  const say = (notice: (target: NoticeTarget) => void): void => {
    for (const view of views()) notice(targetOf(view));
  };

  async function handleDocumentWatch(events: readonly WatchEvent[]): Promise<void> {
    const first = views()[0];
    if (closed || !first?.document()) return;
    const start = performance.now();
    const path = store.snapshot().path;
    const position = first.position();
    const effect = effectForOpenDocument(events, path);
    // The folder's watch fires for every file in it: an event that names another file is that file's
    // store's, and this document's bytes are not read for it.
    if (effect.action === 'ignore') {
      refreshIndexForWatch(events, path, null);
      return;
    }
    if (effect.action === 'gone') {
      refreshIndexForWatch(events, path, null);
      say(fileRemovedNotice);
      return;
    }
    if (effect.action === 'follow') {
      refreshIndexForWatch(events, path, null);
      // Already inside `serially`: queuing the open would put it behind the task waiting for it, and
      // every open, mode switch and reload after it would wait forever. Any view's unfolded Source text
      // counts: the store follows the rename once, under every pane, rather than each pane opening the new
      // path on a store of its own.
      if (hasUnsavedChanges()) {
        await retarget(effect.path);
        return;
      }
      const places = views().map((view) => [view, view === first ? position : view.position()] as const);
      for (const [view, place] of places) await deps.open(effect.path, followPath(place, effect.path).byteOffset, view);
      return;
    }
    const diskBytes = await readOpenFileWithRetry(path);
    const read = performance.now();
    refreshIndexForWatch(events, path, diskBytes);
    if (diskBytes === null) {
      say(fileRemovedNotice);
      return;
    }
    const { buffer, ast } = store.snapshot();
    // Text typed in Source and not yet folded in is an unsaved edit the store cannot see: keep it, as the
    // store keeps a dirty buffer. Bytes equal to the buffer change nothing the reader could lose.
    if (unfoldedSourceInAnyView()) {
      if (!sameBytes(diskBytes, buffer.bytes)) say(diskChangedEditsKeptNotice);
      return;
    }
    // The new bytes' parse, of only the blocks the change touched (B-23): the place is mapped through it.
    // The store's reload reparses the same way from its own parse, which costs as little.
    const document = reparseMarkdown(ast, buffer.bytes, diskBytes, { file: path });
    // A reload maps the place through the watch's own reading of the change (ADR-0037 §6), never
    // through a splice: every view's through the same edit.
    const places = new Map<RenderedView, ReadingPosition>();
    const edit = { before: buffer.bytes, after: diskBytes };
    for (const view of views()) {
      places.set(view, restorePosition(view === first ? position : view.position(), document, edit));
    }
    await reloadOpenFromDisk(diskBytes, places, { start, read });
  }

  /**
   * The open file was renamed while the buffer has unsaved edits: the buffer keeps them and follows the
   * new name, still unsaved against the file it came from, rather than being reloaded over them. The
   * history follows too: it is the store's, not a hash's (ADR-0037 §3).
   */
  async function retarget(newPath: string): Promise<void> {
    await deps.foldSource();
    if (closed || !views()[0]?.document()) return;
    // The store's subscription sets the page again under the new name, at the reader's position, and
    // moves this watch to the new folder.
    await store.rename(newPath);
    for (const view of views()) await view.settled();
    await shell.allowAssetScope(dirname(newPath));
    await moving;
    await deps.renamed(newPath);
  }

  async function watchFolderOf(file: string): Promise<void> {
    current?.close();
    current = null;
    try {
      const watch = await shell.watch(dirname(file), (events) => {
        void deps.serially(() => handleDocumentWatch(events));
      });
      // The store closed (or moved again) while the watch was being set up: it is not wanted.
      if (closed || watchedPath !== file) watch.close();
      else current = watch;
    } catch (e) {
      // The document is already on the page; a directory that cannot be watched costs live reload,
      // not the page the reader is looking at.
      console.warn(`marxy: not watching ${dirname(file)}: ${String(e)}`);
      await shell.mark('watch_failed', Date.now(), String(e));
    }
  }

  const close = (): void => {
    closed = true;
    unsubscribe();
    current?.close();
    current = null;
  };
  const unsubscribe = store.subscribe((snap, change) => {
    if (change.kind === 'close') return close();
    if (snap.path === watchedPath) return;
    watchedPath = snap.path;
    moving = watchFolderOf(snap.path);
  });

  moving = watchFolderOf(watchedPath);
  await moving;
  return { close, moved: () => moving };
}
