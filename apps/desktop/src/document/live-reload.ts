// Live reload: one watch per document store, following it through a rename and a Save as,
// and closed with it (lifted from app.ts). The watch belongs to the store, not to a pane: however
// many views show it, the store is read and reloaded once, every view is asked before it is (a view
// holding Source text the store cannot see keeps the change out), and each view is put at its own place
// in the new bytes.
import { contentHash } from '@marxy/core';
import { appendedBytes, tailRead, type TailRead } from '@marxy/core/src/buffer/tail.ts';
import { pageLangOf } from '@marxy/core/src/kind/registry.ts';
import { LINES_FROM, knownUtf8, noteUtf8 } from '@marxy/core/src/reading/lines.ts';
import { followPath, offsetThroughEdit, restorePosition } from '@marxy/core/src/position/restore.ts';
import { effectForOpenDocument } from '@marxy/core/src/position/watch-events.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { classify } from '@marxy/core/src/index-model/kinds.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { AppShell } from '../app.ts';
import { clearDiskChangedChooseNotices, diskChangedChooseNotice, fileOnDiskNotice, fileRefusedNotice, fileRefusedText, fileRemovedNotice, fileUnreadableText } from '../notices/disk.ts';
import { paneOf, type NoticeTarget } from '../notices/index.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { encodingChoiceOf, heldEncoding, lookForStore } from './encoding.ts';
import { reparsedAst, type DocumentStore } from './store.ts';
import { pushAll } from '@marxy/core/src/util/spread.ts';

export interface LiveReloadDeps {
  readonly shell: Pick<AppShell, 'watch' | 'readFile' | 'peekFile' | 'mark' | 'allowAssetScope' | 'markOpened' | 'decodeText'> &
    /** Without them a grown log is read whole, as every other change is. */
    Partial<Pick<AppShell, 'stat' | 'readRange'>>;
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
  /** Says the change is waiting for the reader's choice, in a pane; the page's own notice unless a test names one. */
  readonly onConflict?: (target: NoticeTarget) => void;
  /** Says the open file can no longer be opened, in a pane; the page's own notice unless a test names one. */
  readonly onRefused?: (text: string, target: NoticeTarget) => void;
  /**
   * An event for the store's file arrived while no view could show it (a warm store, or a pane still opening it): the
   * change is not read now, and the next open of the path checks the file.
   */
  readonly unseen?: () => void;
  /** Whether the store's folder is watched now: a store whose watch could not start hears no change, so is not kept warm. */
  readonly watching?: (ok: boolean) => void;
  /** A markdown file in the watched folder changed (not the echo of Marxy's own save): re-walk its root. */
  changed(path: string): void;
}

export interface DocumentWatch {
  close(): void;
  /**
   * Resolves once the watch follows the store's path as it is now: after a rename or a Save as, when
   * the new folder's watch is registered (on Tauri, `watch_root` and `listen` are round trips), so a
   * write right after it is seen.
   */
  moved(): Promise<void>;
}

/**
 * One watch per store, however many panes show it and however often they ask:
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
/** The most one `readRange` gives, in either shell. */
const RANGE_MAX = 4 * 1024 * 1024;
/** The waits between reads of a file that is there but failed to read: about a second in all. */
const READ_RETRIES = [50, 50, 100, 150, 250, 400] as const;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const CR = 13;
const LF = 10;

/** The one run `after` changes in `before`: from their common prefix to where their common suffix starts in `before`. */
function changedRun(before: Uint8Array, after: Uint8Array): { readonly start: number; readonly end: number } {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < limit - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { start, end: before.length - suffix };
}

/** The bytes with every line ending one LF (a CRLF's CR dropped, a lone CR made LF). */
function oneEnding(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === CR && bytes[i + 1] === LF) continue;
    out[n++] = bytes[i] === CR ? LF : bytes[i]!;
  }
  return out.subarray(0, n);
}

/** `raw` in `bytes` as an offset in `oneEnding(bytes)`, and back. */
function toOneEnding(bytes: Uint8Array, raw: number): number {
  let dropped = 0;
  for (let i = 0; i < raw && i < bytes.length; i++) if (bytes[i] === CR && bytes[i + 1] === LF) dropped++;
  return raw - dropped;
}
function fromOneEnding(bytes: Uint8Array, normal: number): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (n === normal) return i;
    if (!(bytes[i] === CR && bytes[i + 1] === LF)) n++;
  }
  return bytes.length;
}

/** The line `offset` is on (0-based), and the byte each line starts at. */
function lineOf(bytes: Uint8Array, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < bytes.length; i++) if (bytes[i] === LF || (bytes[i] === CR && bytes[i + 1] !== LF)) line++;
  return line;
}
function lineStarts(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === LF || (bytes[i] === CR && bytes[i + 1] !== LF)) starts.push(i + 1);
  return starts;
}

/**
 * `offset` through a change that covers it, where the bytes alone would put the reader at the change's first byte (the top,
 * for a whole-file change: LF to CRLF, a reformat). Through the text with its line endings made one; else to the same line
 * when the file has as many lines; else to the same share of its lines. Null for an offset the change does not cover.
 */
export function offsetThroughWholeChange(offset: number, before: Uint8Array, after: Uint8Array): number | null {
  const run = changedRun(before, after);
  if (offset <= run.start || offset >= run.end) return null;
  const normalBefore = oneEnding(before);
  const normalAfter = oneEnding(after);
  const normal = toOneEnding(before, offset);
  const normalRun = changedRun(normalBefore, normalAfter);
  // An edit round the reader, not over the file: the bytes' answer, its first byte, is near.
  const local = normalRun.end - normalRun.start < normalBefore.length / 2;
  if (local || normal <= normalRun.start || normal >= normalRun.end) {
    return fromOneEnding(after, offsetThroughEdit(normal, normalBefore, normalAfter));
  }
  const line = lineOf(before, offset);
  const starts = lineStarts(after);
  const lines = lineStarts(before).length;
  const to = lines === starts.length ? line : Math.floor((line * starts.length) / Math.max(1, lines));
  return starts[Math.min(to, starts.length - 1)]!;
}

/** `offset` in `before` where it is in `after`: through the change, or for a change over it, by `offsetThroughWholeChange`. */
function placeThrough(offset: number, before: Uint8Array, after: Uint8Array): number {
  return offsetThroughWholeChange(offset, before, after) ?? offsetThroughEdit(offset, before, after);
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

  /**
   * The file's bytes; `null` when it is gone, `{ refused }` (the shell's words) when it is there and cannot be opened,
   * `{ unreadable }` when it is there and the read failed. Only "not found" is gone: on Windows an editor or a
   * virus scan holds a file it is writing for a while (a sharing violation), so a failure is retried longer than a
   * missing file, whose name an atomic save gives back within a few tries.
   */
  async function readOpenFileWithRetry(
    path: string,
  ): Promise<Uint8Array | { readonly refused: string } | { readonly unreadable: string } | null> {
    let failure: { readonly refused: string } | { readonly unreadable: string } | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await (shell.peekFile ? shell.peekFile(path) : shell.readFile(path));
        // Text in another encoding is read as the open file is: the store compares and adopts the page's bytes.
        return await lookForStore(shell, path, raw);
      } catch (e) {
        const err = e as { code?: string; message?: string } | null;
        const message = String(err?.message ?? e);
        failure = err?.code === 'not-found' ? null : err?.code === 'refused' ? { refused: message } : { unreadable: message };
        if (failure !== null && 'refused' in failure) return failure;
        if (attempt >= (failure === null ? 2 : READ_RETRIES.length)) return failure;
        await new Promise((resolve) => setTimeout(resolve, READ_RETRIES[attempt]));
      }
    }
  }

  /**
   * New bytes from disk, as the store's `reload` transition: it adopts them (and records the read for
   * the stale-write guard) unless the buffer has unsaved edits, which it keeps. Each view is told its
   * place in the new bytes first, so its repaint holds that place, not a byte of the old bytes. `readAt` is the store's
   * `writes()` before the read: bytes read before a save of ours wrote are never adopted over it.
   */
  async function reloadOpenFromDisk(
    bytes: Uint8Array,
    readAt: number,
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
      outcome = await store.reload(bytes, { holds: unfoldedSourceInAnyView, readAt });
    } finally {
      for (const view of places.keys()) view.expectReloadAt(null);
    }
    if (outcome === 'kept') {
      say(conflictNotice);
      return;
    }
    // Disk came back to what the buffer has (or the reader's edits are gone): there is no choice to make.
    if (store.conflict() === null) clearDiskChangedChooseNotices();
    const t1 = performance.now();
    for (const view of places.keys()) await view.settled();
    if (outcome !== 'reloaded') return;
    const t2 = performance.now();
    // From the watch event to every view settled at its place: the read, the parse and the mapping
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
    // Hashed only when asked, after the Markdown test: a log appended to all the time is never hashed for it.
    let echo: boolean | undefined;
    const isEcho = (): boolean => (echo ??= diskBytes !== null && contentHash(diskBytes) === contentHash(store.snapshot().buffer.bytes));
    const changed = (p: string | undefined) => p !== undefined && isMarkdownPath(p) && !(p === path && isEcho());
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
  const conflictNotice = (target: NoticeTarget): void => (deps.onConflict ?? diskChangedChooseNotice)(target);
  const say = (notice: (target: NoticeTarget) => void): void => {
    for (const view of views()) notice(targetOf(view));
  };

  async function handleDocumentWatch(events: readonly WatchEvent[]): Promise<void> {
    const first = views()[0];
    if (closed) return;
    const path = store.snapshot().path;
    const effect = effectForOpenDocument(events, path);
    if (!first?.document()) {
      if (effect.action !== 'ignore') deps.unseen?.();
      return;
    }
    const start = performance.now();
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
      const places = views().map((view) => [view, view.position()] as const);
      for (const [view, place] of places) await deps.open(effect.path, followPath(place, effect.path).byteOffset, view);
      return;
    }
    if (await followAppend(path, events, start)) return;
    // Taken before the read: a save of ours that writes while it runs makes these bytes older than the file (`reload`'s `readAt`).
    const readAt = store.writes();
    const read_ = await readOpenFileWithRetry(path);
    const read = performance.now();
    const diskBytes = read_ instanceof Uint8Array ? read_ : null;
    refreshIndexForWatch(events, path, diskBytes);
    if (read_ !== null) say(fileOnDiskNotice);
    if (read_ !== null && !(read_ instanceof Uint8Array)) {
      // The file is there, but Marxy cannot open what it has become, or cannot read it now: the buffer is kept and
      // nothing is written. An unreadable file is read again at its next change on disk.
      const name = basename(path);
      const text = 'refused' in read_ ? fileRefusedText(name, read_.refused) : fileUnreadableText(name);
      for (const view of views()) (deps.onRefused ?? fileRefusedNotice)(text, targetOf(view));
      return;
    }
    if (diskBytes === null) {
      say(fileRemovedNotice);
      return;
    }
    const { buffer } = store.snapshot();
    // Text typed in Source and not yet folded in is an unsaved edit the store cannot see: keep it, as the
    // store keeps a dirty buffer. Bytes equal to the buffer change nothing the reader could lose.
    // The store is told, so the change is held for the reader's choice like a dirty buffer's.
    if (unfoldedSourceInAnyView()) {
      if (!sameBytes(diskBytes, buffer.bytes) && (await store.reload(diskBytes, { holds: unfoldedSourceInAnyView, readAt })) === 'kept') {
        say(conflictNotice);
      }
      return;
    }
    // The new bytes' parse, of only the blocks the change touched: the place is mapped through it.
    // The store's reload reparses the same way from its own parse, which costs as little.
    // Read here, not above: a store opened lazily (a file that opens in Source) parses when asked, and the held-apart branch above has no use for it.
    // A reload maps the place through the watch's own reading of the change, never
    // through a splice: every view's through the same edit.
    // Each place is read now, after the read: the reader may have scrolled while it (and its retries) ran.
    const places = new Map<RenderedView, ReadingPosition>();
    const edit = { before: buffer.bytes, after: diskBytes };
    if (!store.parsed()) {
      // Nothing has asked for this file's parse (a file in Source, a JSONL session's derived view): the place is a
      // byte, mapped through the bytes alone. Reading the AST here would parse the whole file as Markdown on every append.
      for (const view of views()) {
        const place = view.position();
        places.set(view, { ...place, path, byteOffset: placeThrough(place.byteOffset, edit.before, edit.after) });
      }
    } else {
      const document = reparsedAst(path, store.snapshot().ast, buffer.bytes, diskBytes);
      for (const view of views()) {
        const place = view.position();
        const whole = offsetThroughWholeChange(place.byteOffset, edit.before, edit.after);
        places.set(view, whole === null ? restorePosition(place, document, edit) : { ...restorePosition(place, document), byteOffset: whole });
      }
    }
    await reloadOpenFromDisk(diskBytes, readAt, places, { start, read });
  }

  /**
   * Whether `path` is read as a log (the log page, or Lines for a log) and is the file's own bytes. Plain text and code in
   * Lines are big files that are edited and rewritten (a CSV, a dump), so they are read whole.
   */
  function followsTail(path: string): boolean {
    if (heldEncoding(path) !== null || encodingChoiceOf(path) !== null) return false;
    const kind = views()[0]?.host?.article?.closest('[data-marxy-kind]')?.getAttribute('data-marxy-kind') ?? null;
    return pageLangOf(path, kind) === 'log';
  }

  /** The file's creation time at the last stat: a file made again under the name is another file, whatever it holds. */
  let seenCreated: number | undefined;

  async function readTail(path: string, plan: TailRead): Promise<Uint8Array> {
    const out = new Uint8Array(plan.length);
    for (let done = 0; done < plan.length; ) {
      const piece = await shell.readRange!(path, plan.at + done, Math.min(RANGE_MAX, plan.length - done));
      if (piece.length === 0) return out.subarray(0, done);
      out.set(piece.subarray(0, plan.length - done), done);
      done += piece.length;
    }
    return out;
  }

  /**
   * A log that grew is read from where Marxy's copy ends, not whole: the last bytes held are read again to show the file
   * still begins with them (`appendedBytes`), and only what follows is read and spliced on. False, with nothing changed,
   * for anything else (a file that shrank, was rotated or rewritten, is held in another encoding, or has unsaved edits
   * in Marxy), and the caller reads and reloads the whole file as it does for every change.
   */
  async function followAppend(path: string, events: readonly WatchEvent[], start: number): Promise<boolean> {
    if (!shell.stat || !shell.readRange || hasUnsavedChanges() || store.conflict() !== null) return false;
    const held = store.snapshot().buffer.bytes;
    if (!followsTail(path)) return false;
    const readAt = store.writes();
    let added: Uint8Array | null;
    try {
      const info = await shell.stat(path);
      const created = info?.createdMs;
      const remade = created !== undefined && seenCreated !== undefined && created !== seenCreated;
      if (created !== undefined) seenCreated = created;
      const plan = info && !info.isDir && !remade ? tailRead(held.length, info.size) : null;
      if (!plan) return false;
      const head = plan.head > 0 ? await shell.readRange(path, 0, plan.head) : null;
      added = appendedBytes(held, plan, await readTail(path, plan), head);
    } catch {
      return false;
    }
    if (!added || added.length === 0 || closed) return false;
    const read = performance.now();
    // An append moves no byte above the reader: every view keeps the place it has.
    const places = new Map(views().map((view) => [view, view.position()] as const));
    const following = views().filter((view) => view.atEnd());
    for (const [view, place] of places) view.expectReloadAt(place);
    let outcome: Awaited<ReturnType<DocumentStore['append']>>;
    try {
      outcome = await store.append(added, { from: held.length, holds: unfoldedSourceInAnyView, readAt,
        keepReplaced: held.length < LINES_FROM,
        // The appended bytes passed the UTF-8 check: the new array is UTF-8 when the old one was known to be.
        spliced: (bytes) => knownUtf8(held) === true && noteUtf8(bytes, true),
      });
    } finally {
      for (const view of places.keys()) view.expectReloadAt(null);
    }
    if (outcome === 'stale') return false;
    say(fileOnDiskNotice);
    clearDiskChangedChooseNotices();
    for (const view of places.keys()) await view.settled();
    for (const view of following) view.followEnd();
    await shell.mark('live_reload', Date.now(), `ms=${(performance.now() - start).toFixed(1)} read=${(read - start).toFixed(1)} appended=${added.length}`);
    refreshIndexForWatch(events, path, null);
    return true;
  }

  /**
   * The open file was renamed while the buffer has unsaved edits: the buffer keeps them and follows the
   * new name, still unsaved against the file it came from, rather than being reloaded over them. The
   * history follows too: it is the store's, not a hash's.
   */
  async function retarget(newPath: string): Promise<void> {
    await deps.foldSource();
    if (closed || !views()[0]?.document()) return;
    // The file the reader has open now has this name: it is theirs to save there.
    await shell.markOpened?.(newPath).catch(() => undefined);
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
    // A batch that only changes the open file (or names others) joins one still waiting in the queue: each reload reads
    // disk whole, so for a file appended to all the time one reload runs and one waits. A removal or a rename is queued
    // on its own, so a remove-then-create is not read as a removal alone.
    let waiting: WatchEvent[] | null = null;
    const quiet = (events: readonly WatchEvent[]): boolean => {
      const action = effectForOpenDocument(events, store.snapshot().path).action;
      return action === 'reload' || action === 'ignore';
    };
    try {
      const watch = await shell.watch(dirname(file), (events) => {
        if (waiting !== null && quiet(events)) {
          pushAll(waiting, events);
          return;
        }
        const batch = [...events];
        waiting = quiet(batch) ? batch : null;
        void deps.serially(() => {
          if (waiting === batch) waiting = null;
          return handleDocumentWatch(batch);
        });
      });
      // The store closed (or moved again) while the watch was being set up: it is not wanted.
      if (closed || watchedPath !== file) watch.close();
      else {
        current = watch;
        deps.watching?.(true);
      }
    } catch (e) {
      // The document is already on the page; a directory that cannot be watched costs live reload,
      // not the page the reader is looking at.
      console.warn(`marxy: not watching ${dirname(file)}: ${String(e)}`);
      deps.watching?.(false);
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
