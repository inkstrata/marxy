// Application startup: given a shell, open the document, render it, and emit startup marks (MARXY-95).
import { setAppHandle } from './commands/app-handle.ts';
import { startDocumentEditingWire } from './commands/document.ts';
import { buildAppContext, installCommandKeys } from './selection/bind.ts';
import { createRenderedSelection, type RenderedSelection, type SelectionShell } from './selection/view.ts';
import type { Buffer, Document } from '@marxy/core';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { confirmLeaveDocument, installCloseGuard } from './close.ts';
import { save, type SaveDeps, type SaveResult } from './save.ts';
// Static, as it was through save.ts before B-11: a lazy chunk here would put the first title (and the
// late trust read queued after it) behind a fetch.
import { updateTitle } from './title.ts';
import { openDocumentStore, type DocumentSnapshot, type DocumentStore } from './document/store.ts';
import type { Shell } from '@marxy/shell-api';
import type { NodeMap } from './render/post.ts';
import { pathsForDocument } from './render/images.ts';
import { clearDismissForPath, resetDismissedNotices } from './notices/blocked.ts';
import { commands as appCommands } from './commands/index.ts';
import { wireTrustRevokeCommands } from './commands/trust.ts';
import { createTrustController, type TrustController } from './trust/controller.ts';
import { clearNotices } from './notices/index.ts';
import { applyWeightOffset, platformOf } from './theme/offset.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme/theme-document.ts';
import { parseConfig } from '@marxy/theme';
import { applyReaderConfig, readReaderConfig, takeConfigRead } from './theme/reader-config.ts';
import { resolveThemeDir, startUserTheme, themeDirFromConfig, type UserThemeContext } from './theme/user-theme.ts';
import { createLaunchMeasure, t0, type LaunchMeasure, type RenderEvidence } from './startup/measure.ts';
import { whenIdle } from './startup/idle-work.ts';
import { createIndexService, indexShellFor, type IndexService } from './index/service.ts';
import { createReadingPersistence, type ReadingPersistence } from './position/reading-persistence.ts';
import { watchDocument } from './document/live-reload.ts';
import { pinDocumentOnPaletteSession } from './palette/history.ts';
import { emptySession, type PaletteSession } from './palette/session.ts';
import { defaultModeForPath } from './source/default-mode.ts';
import type { PieceSource } from './frontispiece/pieces.ts';
import { createRenderedView, type OpenDocument, type RenderedView, type ViewHost } from './view/rendered-view.ts';

/** The Phase 0 shell surface: frozen Shell members tauri.ts already implements, plus startup extras. */
export type AppShell = Pick<
  Shell,
  | 'readFile'
  | 'writeFileAtomic'
  | 'watch'
  | 'platform'
  | 'startupMarks'
  | 'readDir'
  | 'setTitle'
  | 'saveDialog'
  | 'allowAssetScope'
  | 'onCloseRequested'
  | 'confirmClose'
> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  /** Tauri shell only: read without arming the stale-write guard (MARXY-337). */
  peekFile?(path: string): Promise<Uint8Array>;
  recordRead?(path: string, bytes: Uint8Array): void;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
  configPaths?(): Promise<{ config: string; data: string }>;
  onOpenFiles?(cb: (paths: readonly string[]) => void): void;
};

export type { OpenDocument } from './view/rendered-view.ts';

/** The open document as the app holds it: what operations resolve and splice against. */
export interface OpenDocumentState {
  readonly path: string;
  readonly buffer: Buffer;
  readonly ast: Document;
  readonly nodeMap: NodeMap;
}

export type AppHandle = {
  readonly state: { document: OpenDocument | null };
  dispatch(action: unknown): void;
  commands(): readonly unknown[];
  readonly shell: AppShell;
  readonly ready: Promise<void>;
  /**
   * Opens `path` through the one open path, after any open already under way: launch, open events
   * and the palette all end here. `at` is a byte offset; the block containing it is held at the
   * reading line until the reader scrolls. `at` for the document already on screen moves to it
   * without reading the file again.
   */
  open(path: string, opts?: { at?: number }): Promise<void>;
  /** The document on screen, or null before the first one. */
  currentPath(): string | null;
  /** The folder every image and link of the document at `path` must stay inside: its repository root, else its folder (ADR-0027 §5). */
  imageRoot(path: string): string;
  /** Playwright harness: buffer fingerprint and reading position (MARXY-169). */
  sourceHarness(): {
    readonly mode: 'rendered' | 'source';
    readonly bufferHash: string;
    readonly byteOffset: number;
  } | null;
  /** Playwright harness: live typesetters and resize observers, so N opens are seen to leave one of each. */
  debugCounts(): { typesetters: number; resizeObservers: number };
  /** The open document's buffer and parse, from its store's snapshot, or null. */
  openDocument(): OpenDocumentState | null;
  /** The open document's store (ADR-0037), or null before the first document (B-11). */
  document(): DocumentStore | null;
  /**
   * The open document's explicit save (save.ts) with the deps only the app has: the fold from Source
   * and what follows a Save as. Resolves once the title shows the result (B-11).
   */
  save(opts?: { as?: boolean }): Promise<SaveResult>;
  /**
   * The open document's store subscription, seen through the app (ADR-0037): called with the document
   * on every committed transition and on each open, which moves the subscription to the new store, and
   * with null when the store closes. A page set again with the same bytes is not a change.
   */
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /** The Rendered selection on `#doc` (B-12): what is selected, and the open document as it resolves it. */
  readonly selection: RenderedSelection;
  /**
   * Applies an operation's result: makes `buffer` the open document and renders it through the same
   * path an open takes. The file is not written; that is an explicit save. Refused if a different
   * document is open by then, or while Source holds text not yet folded into the document.
   */
  commitEdit(buffer: Buffer): Promise<void>;
  /** Source text typed and not yet in the document goes into it, as one history entry (undo and redo call this first). */
  foldSource(): Promise<void>;
  /** True while Source holds typed text the document does not have yet (it would become an undo step). */
  hasUnfoldedSource(): boolean;
  /** Pin or unpin a document for palette history (same as Mod+. on a document row). */
  pinPaletteDocument(path: string): void;
  /**
   * The mounted palette's session (main.ts, once the palette is mounted): what a pin and the quit
   * flush of history.json read. Before it is called there is no palette session (B-14).
   */
  setPaletteSession(session: () => PaletteSession): void;
  /** The palette index: one walk per repository root, every root opened so far published (A-04). */
  readonly index: IndexService;
  /**
   * Resolves when the open document is wholly in the article (A-02): at once for a document under the
   * progressive threshold, after the last idle chunk for a larger one.
   */
  contentComplete(): Promise<void>;
  /** Mounts, now, every block up to the one holding `byteOffset` (a link to a heading not yet shown). */
  mountThrough(byteOffset: number): void;
  /** Rendered to Source or back, as `Mod+E` does; resolves when the switch is done. */
  toggleMode(): Promise<void>;
  /**
   * Source with the line holding `byteOffset` at the reading line (Jump to source). The same Source as
   * `Mod+E`: what is typed there is saved, guarded and undoable (F-03).
   */
  jumpToSource(byteOffset: number): Promise<void>;
  /**
   * Sets the rendered page again after a change of variant or size, on the grid, with the reader on
   * the same line (A-14). Nothing to do in Source mode or with no document open.
   */
  relayout(): Promise<void>;
};


/**
 * The open document (ADR-0037): its path, its bytes and the bytes on disk, its parse and its history.
 * Every change to them is one of the store's transitions, and the page follows them through its
 * subscription (the view's, `view/rendered-view.ts`). Transitional: B-15 removes this `let` when the open path leaves.
 */
let store: DocumentStore | null = null;
/** `onDocumentChange` subscribers: each moves its subscription to a newly opened store (B-12). */
const storeFollowers = new Set<(next: DocumentStore) => void>();
/** The selection controller on `#doc`, made by `startApp`. */
let selection: RenderedSelection | null = null;
/**
 * The one view, on `#doc` (B-13): the page, the mode, the Source editor, the typesetter, the grid and the
 * anchor. Made by `startApp`; Phase D makes one per pane.
 */
let view: RenderedView | null = null;

/** The view `startApp` made; everything that reaches the page runs after it. */
function theView(): RenderedView {
  if (!view) throw new Error('marxy: no view before startApp');
  return view;
}

/** Opens, mode switches and watch events run one at a time, on the view's queue. */
function serially<T>(fn: () => Promise<T>): Promise<T> {
  return theView().serially(fn);
}

/** The Source mount, `#marxy-source`: the app skeleton has one; the harness page gets one here. */
function sourceMount(): HTMLElement {
  let host = document.getElementById('marxy-source');
  if (!host) {
    host = document.createElement('div');
    host.id = 'marxy-source';
    host.hidden = true;
    document.body.appendChild(host);
  }
  return host;
}

/** The open document's path, from the store. */
function openPathNow(): string | null {
  return store?.snapshot().path ?? null;
}

/** The open document's bytes, from the store. */
function bufferNow(): Buffer | null {
  return store?.snapshot().buffer ?? null;
}

function documentState(snap: DocumentSnapshot): OpenDocumentState {
  return { path: snap.path, buffer: snap.buffer, ast: snap.ast, nodeMap: snap.nodeMap };
}

function openDocumentState(): OpenDocumentState | null {
  return store ? documentState(store.snapshot()) : null;
}

/** `cb` on the open store's transitions, and on every store opened after this. */
function onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void {
  let unsubscribe: (() => void) | null = null;
  const follow = (next: DocumentStore): void => {
    unsubscribe?.();
    unsubscribe = next.subscribe((snap, change) => cb(change.kind === 'close' ? null : documentState(snap)));
  };
  const opened = (next: DocumentStore): void => {
    follow(next);
    cb(documentState(next.snapshot()));
  };
  if (store) follow(store);
  storeFollowers.add(opened);
  return () => {
    storeFollowers.delete(opened);
    unsubscribe?.();
    unsubscribe = null;
  };
}
/** positions.json and history.json for this launch (B-14); made by startApp. */
let persistence: ReadingPersistence;
let restoreAfterTypeset = false;
/** The byte the open in progress lands on (an `at`, or the stored place), read before anything re-notes it. */
let openLanding: number | undefined;

/** The arguments this launch was given (or the shell reported), for the document and the flags. */
let launchArgs: readonly string[] = [];

/** This launch's measurement (B-08): frame counter, harness detection, first text and the exit code. */
let measure: LaunchMeasure;

/** The palette index for this launch; created by startApp (A-04). */
let index: IndexService;
/** The launch document's walk, so `ready` (and a harness quit) follows its `index_loaded` mark. */
let indexing: Promise<void> = Promise.resolve();

/** The shell this launch is using; set by startApp, never imported from tauri.ts. */
let shell: AppShell;

/** What the open document may show (B-10); created by startApp, one per launch. */
let trust: TrustController;

let userThemeHandle: { stop(): void } | null = null;

function userThemeContext(): UserThemeContext {
  return {
    shell,
    views: () => (view ? [view] : []),
  };
}

async function restartUserTheme(dir: string | null): Promise<void> {
  userThemeHandle?.stop();
  userThemeHandle = await startUserTheme(userThemeContext(), dir);
}

/**
 * The variant and text size from config.toml, applied once per launch before anything is read onto the
 * page, so a light reader never sees dark first (A-14). A failure keeps the defaults.
 */
let readerConfigApplied = false;
async function applyReaderConfigOnce(): Promise<void> {
  if (readerConfigApplied) return;
  readerConfigApplied = true;
  try {
    applyReaderConfig(document.documentElement, await readReaderConfig(shell));
  } catch {
    /* defaults stand */
  }
}

/** The theme directory: from the bytes the pre-paint read already has, else from the file (A-14). */
async function themeDirFromBootConfig(): Promise<string | null> {
  const read = takeConfigRead();
  if (read === null) return themeDirFromConfig(shell);
  return resolveThemeDir(parseConfig(read.bytes).config.theme, read.path);
}

/**
 * Everything one open document started: the view's page (its typesetter, resize observer, pending grid
 * pass and Source editor), the watch and the store. Run before the next document replaces it.
 */
function teardownDocument(): void {
  view?.clear();
  // The store goes with its page: a transition still queued on it is refused, not applied elsewhere.
  // Its watch closes with it (document/live-reload.ts).
  store?.close();
  store = null;
}

/** Live reload for the store just opened (B-14): one watch, which follows the store and closes with it. */
async function watchOpenDocument(open: DocumentStore): Promise<void> {
  await watchDocument(open, () => (view ? [view] : []), {
    shell,
    open: openReplacing,
    serially,
    foldSource: foldSourceIntoBuffer,
    async renamed(path) {
      document.title = `${basename(path)} — Marxy`;
      selection?.afterRender();
      await refreshTitle();
    },
    changed(path) {
      void index.rootFor(path).then((root) => index.refresh(root));
    },
  });
}

/**
 * The one range by which `next` differs from `bytes`, widened so neither end cuts a UTF-8 sequence;
 * null when they are the same bytes.
 */
function byteChange(bytes: Uint8Array, next: Uint8Array): { start: number; end: number; replacement: Uint8Array } | null {
  const limit = Math.min(bytes.length, next.length);
  let prefix = 0;
  while (prefix < limit && bytes[prefix] === next[prefix]) prefix++;
  if (prefix === bytes.length && prefix === next.length) return null;
  let suffix = 0;
  while (suffix < limit - prefix && bytes[bytes.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const continues = (b: number | undefined): boolean => b !== undefined && (b & 0xc0) === 0x80;
  while (prefix > 0 && (continues(bytes[prefix]) || continues(next[prefix]))) prefix--;
  while (suffix > 0 && (continues(bytes[bytes.length - suffix]) || continues(next[next.length - suffix]))) suffix--;
  return { start: prefix, end: bytes.length - suffix, replacement: next.subarray(prefix, next.length - suffix) };
}

/**
 * Makes `next` the open document's bytes, as one `apply` of the range by which it differs, labelled
 * `edit`; disk is updated only on explicit save (MARXY-49). Bytes equal to the buffer change nothing in
 * the store, but the page is set again, as it always was for this call.
 */
function commitEdit(next: Buffer): Promise<void> {
  return serially(async () => {
    const open = store;
    const shownIn = theView();
    if (!open || next.path !== open.snapshot().path || !shownIn.document()) throw new Error('the edited document is no longer open');
    // `next` was built from the bytes before the reader typed; applying it would be folded back over by
    // the typed text, or lose the typed text. Refused, nothing written (F-12).
    if (shownIn.sourceHasUnfoldedEdits()) throw new Error('Source holds text not yet in the document; leave Source or save first');
    const snap = open.snapshot();
    const change = byteChange(snap.buffer.bytes, next.bytes);
    if (change === null) {
      shownIn.repaint();
    } else {
      await open.apply({
        range: { file: snap.path, start: change.start, end: change.end },
        replacement: new TextDecoder().decode(change.replacement),
        label: 'edit',
        baseVersion: snap.version,
      });
    }
    await shownIn.settled();
  });
}

async function refreshTitle(): Promise<void> {
  if (!shell.setTitle) return;
  const snap = store?.snapshot();
  if (!snap) {
    await updateTitle(shell, null, false);
    return;
  }
  await updateTitle(shell, snap.path, snap.dirty);
}

/** Source text into the store (`commitSource`), before a save or a rename reads the buffer. */
async function foldSourceIntoBuffer(): Promise<void> {
  if (!store || !view) return;
  if (await view.foldSource()) await refreshTitle();
}

/** The store's save, with what only the app can do around it (save.ts). */
function saveDeps(open: DocumentStore): SaveDeps {
  return {
    store: open,
    shell,
    foldSource: async () => {
      if (store === open) await foldSourceIntoBuffer();
    },
    onSaveAs: async (path) => {
      if (store !== open) return;
      await shell.allowAssetScope(dirname(path));
      // The watch moved with the store when it took the new path (document/live-reload.ts).
      selection?.afterRender();
    },
  };
}

async function saveOpenDocument(opts?: { as?: boolean }): Promise<SaveResult> {
  const open = store;
  if (!open) return 'failed';
  const result = await save(saveDeps(open), opts);
  // The store's subscription refreshes the title on a save; resolve once it has.
  await theView().settled();
  return result;
}


/** After `first_text`, positions.json may ask to move the document already on screen (MARXY-195). */
async function restorePersistedPositionIfNeeded(): Promise<void> {
  if (!store || !view?.document()) return;
  const { path, buffer } = store.snapshot();
  const stored = persistence.storedFor(path, buffer.bytes.length);
  if (!stored) return;
  openLanding = stored.byteOffset;
  // A file that opens in Source is put there by finishDocumentOpen, at this byte.
  if (defaultModeForPath(path) === 'source') return;
  // A place kept in Source is a line, not a fraction of a block: its block, at the top (S-08-0001).
  const position = stored.mode === 'source' ? { ...stored, fraction: 0, mode: 'rendered' as const } : stored;
  view.restore(position);
  view.landOn(stored.byteOffset);
}

/**
 * Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183).
 * A large document's idle chunks wait for `start` (A-02), so nothing is appended before first text.
 */
async function openDocumentThroughRenderMark(
  file: string,
  at: number | undefined,
  start: Promise<unknown>,
): Promise<RenderEvidence> {
  const shownIn = theView();
  const bytes = await shell.readFile(file);
  await applyReaderConfigOnce();
  let landing = at;
  if (landing === undefined) {
    const stored = persistence.storedFor(file, bytes.length);
    if (stored) landing = stored.byteOffset;
  }
  openLanding = landing;
  teardownDocument();
  clearDismissForPath(file);
  await shell.mark('file_read', Date.now(), `bytes=${bytes.length}`);
  // The open transition (ADR-0037): the store copies the bytes, parses them once and starts an empty
  // history with `disk` as read. The page renders from its snapshot and follows it from here on.
  const opened = openDocumentStore(
    {
      writeFileAtomic: (path, written) => shell.writeFileAtomic(path, written),
      recordRead: shell.recordRead ? (path, read) => shell.recordRead?.(path, read) : undefined,
    },
    file,
    bytes,
  );
  store = opened;
  await shell.mark('parsed', Date.now());
  // A different document starts with no notices (blocked.ts no longer clears the rest on every render).
  clearNotices();
  // The view renders from the store's snapshot and follows it from here on (B-13).
  const evidence = await shownIn.show(opened, {
    at: landing,
    start,
    onMounted: () => {
      for (const follow of [...storeFollowers]) follow(opened);
    },
  });
  document.title = `${file.split('/').pop()} — Marxy`;
  return evidence;
}

async function finishDocumentOpen(file: string, at?: number): Promise<void> {
  const shownIn = theView();
  await shownIn.typeset();
  const shouldRestore = restoreAfterTypeset;
  restoreAfterTypeset = false;
  if (shouldRestore) await restorePersistedPositionIfNeeded();
  const deferred = shownIn.deferredWork(file);
  await whenIdle(async () => {
    await deferred();
    indexing = index.ensureFor(file, bufferNow()?.bytes);
    void indexing;
    const themeDir = await themeDirFromBootConfig();
    await restartUserTheme(themeDir);
  });
  await shell.mark('position_restored', Date.now());
  if (defaultModeForPath(file) === 'source') {
    await shownIn.showSource(at ?? openLanding ?? 0);
  } else {
    shownIn.showRenderedChrome();
  }
  await maybeThemeDocumentNotice(userThemeContext(), file, async (dir) => {
    userThemeHandle = await adoptThemeDirectory(userThemeContext(), dir, userThemeHandle);
  });
  if (store) await watchOpenDocument(store);
  await refreshTitle();
}

function replaceOpenDocument(file: string, opts?: { at?: number }): Promise<void> {
  const open = () =>
    serially(async () => {
      // The document already on screen, asked for again with nowhere to go (a second launch, Finder, a
      // drag, the palette on the current document): reading it back from disk would drop unsaved edits.
      if (file === openPathNow() && opts?.at === undefined && hasUnsavedChanges()) return;
      await openReplacing(file, opts?.at);
    });
  // Another document over unsaved edits asks first (save / discard / dismiss), as a close does. Moving
  // within the open document, or opening with nothing unsaved, goes straight through.
  if (file !== openPathNow() && confirmLeaveDocument(open)) return Promise.resolve();
  return open();
}

/** Unsaved changes: the store's buffer differs from disk, or Source holds text not yet folded into it. */
function hasUnsavedChanges(): boolean {
  if (!store) return false;
  return store.snapshot().dirty || (view?.sourceHasUnfoldedEdits() ?? false);
}

async function openReplacing(file: string, at?: number): Promise<void> {
  const shownIn = theView();
  const doc = shownIn.host.article;
  const openPath = openPathNow();
  if (openPath && file !== openPath) await persistence.flushReading();
  if (file === openPath && shownIn.document() && at !== undefined) {
    // A heading in the document already on screen: move, do not read and set it again.
    if (shownIn.mode === 'source') await shownIn.leaveSource();
    shownIn.landOn(at);
    return;
  }
  const chunks = gate();
  try {
    await openDocumentThroughRenderMark(file, at, chunks.promise);
    chunks.release();
    persistence.trackOpen(file, () => index.rootFor(file));
    await finishDocumentOpen(file, at);
  } catch (e) {
    chunks.release();
    // Nothing of the last document may outlive the page that showed it.
    teardownDocument();
    selection?.afterRender();
    shownIn.showRenderedChrome();
    // A read error names the path, and a path is not markup.
    const message = document.createElement('p');
    message.textContent = String(e);
    doc.replaceChildren(message);
  }
}

/** The pieces a launch with no document chooses from; null is the bundled Commonplace (MARXY-256). */
let frontispiecePieces: readonly PieceSource[] | null = null;

/**
 * The frontispiece set like a page, after `no_document`: the grid pass and the typesetter for its
 * prose (the typesetter never sets verse), and highlighting for a code piece. The next open's
 * teardown stops all of it, as it does a document's.
 */
function setFrontispiece(doc: HTMLElement): void {
  theView().setStatic();
  const root = doc.querySelector('.marxy-frontispiece');
  if (!root?.querySelector('pre')) return;
  void whenIdle(async () => {
    const { startCodeHighlight } = await import('./render/highlight.ts');
    if (root.isConnected) startCodeHighlight(doc);
  });
}

async function boot(): Promise<void> {
  await shell.mark('script_start', t0);
  // Before anything is laid out, so no weight is set twice. shell-api declares webkitVersion(), but no
  // desktop shell calls it yet, so the version is null and the table's unknown-version row applies.
  const offset = applyWeightOffset(document.documentElement, platformOf(navigator.userAgent), null);
  void shell.mark('weight_offset', Date.now(), `offset=${offset}`);
  launchArgs = launchArgs.length > 0 ? launchArgs : await shell.args();
  measure.adoptArgs(launchArgs);
  await shell.mark('args', Date.now(), `n=${launchArgs.length}`);
  // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
  const file = launchArgs.find(a => !a.startsWith('-'));
  const doc = theView().host.article;
  // Harness-only: the negative test that `#doc { visibility: hidden }` is not first readable text.
  // The flag only hides the element; refusing `first_text` is the visibility check below, not the flag.
  if (launchArgs.includes('--smoke-hide-doc')) doc.style.visibility = 'hidden';

  // No document means no `first_text`: nothing was read, so a launch like this must not be able to
  // hand the startup measurement a cold-start number.
  // A passage from the Commonplace is shown, not opened: no path, no buffer, no watch, no Source mode
  // and no reading position, so the palette and every open replace it as they would the hint.
  if (!file) {
    await applyReaderConfigOnce();
    const piece = await theView().showFrontispiece(frontispiecePieces);
    if (!piece) theView().showEmptyHint();
    await shell.mark('no_document', Date.now(), piece ? `piece=${piece}` : undefined);
    if (piece) setFrontispiece(doc);
    return measure.finish(0);
  }

  const after = performance.now();
  // A large document's idle chunks wait for first text: anything appended before the paint would be
  // styled and laid out in the frame first text is waiting for.
  const chunks = gate();
  try {
    return await bootDocument(file, doc, after, chunks);
  } finally {
    chunks.release();
  }
}

/** Released once: a promise for a mount's `start`, and the call that settles it. */
function gate(): { readonly promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function bootDocument(file: string, doc: HTMLElement, after: number, chunks: ReturnType<typeof gate>): Promise<void> {
  const evidence = await openDocumentThroughRenderMark(file, undefined, chunks.promise);
  const renderedAt = Date.now();

  const outcome = await measure.waitForFirstText(doc, evidence, after, renderedAt);
  // A document of blocks with no text (only images, F-17) was not painted as text, and the measurement
  // said so with `no_text`, but it is a document: it opens like any other. Nothing at all still fails.
  const imagesOnly = outcome === 'no_text' && evidence.blocks > 0;
  if (outcome !== 'painted' && !imagesOnly) return measure.finish(1);
  chunks.release();
  await persistence.ensureLoaded(dirname(file));
  restoreAfterTypeset = true;
  await finishDocumentOpen(file);
  setTimeout(() => void trust.load().then(() => trust.maybeRerenderForLateTrust()), 0);
  await indexing;
  return measure.finish(0);
}

/**
 * Everything main.ts used to do after it had a shell. `opts.argv` overrides `shell.args` so the
 * browser harness can name a document without Tauri; `opts.pieces` replaces the bundled Commonplace,
 * so it can launch with no document against pieces of its own, or none.
 */
export async function startApp(
  injected: AppShell,
  opts?: {
    argv?: readonly string[];
    pieces?: readonly PieceSource[];
  },
): Promise<AppHandle> {
  restoreAfterTypeset = false;
  const base = injected;
  // The mounted palette's session, once main.ts has said where it is (B-14).
  let paletteSession: (() => PaletteSession) | null = null;
  shell = {
    ...base,
    quit: async (code) => {
      await persistence.flush();
      return base.quit(code);
    },
  };
  persistence = createReadingPersistence(shell, () => paletteSession?.());
  trust = createTrustController({
    shell,
    currentPath: openPathNow,
    buffer: bufferNow,
    position: (path) => theView().blockPosition(path),
    rerender: (at) => theView().rerender(at),
    showSource: (byteOffset) => theView().showSource(byteOffset),
  });
  index = createIndexService(indexShellFor(shell));
  indexing = Promise.resolve();
  launchArgs = opts?.argv ? [...opts.argv] : [];
  measure = createLaunchMeasure(shell, launchArgs);
  readerConfigApplied = false;
  resetDismissedNotices();
  wireTrustRevokeCommands({
    grantsForPath: () => {
      const path = openPathNow();
      return path ? trust.grantsFor(path) : null;
    },
    revokeHtml: trust.revokeHtml,
  });
  frontispiecePieces = opts?.pieces ?? null;
  injected.onOpenFiles?.((paths) => {
    const file = paths.find((p) => p.length > 0 && !p.startsWith('-'));
    if (file) void replaceOpenDocument(file);
  });
  const ready = measure.ready.then(() => {});
  // The repository root once the index has said (F-14), else the document's folder.
  const imageRootFor = (path: string): string => pathsForDocument(path).imageRoot;
  // The selection on `#doc`, which the skeleton always has; it reads the open document from the store.
  selection?.destroy();
  view?.destroy();
  storeFollowers.clear();
  // One view for `#doc` (B-13). The host is the DOM the app always had: `#doc`, the window's scroller,
  // `#marxy-source` and `data-marxy-mode` on the body.
  const host: ViewHost = {
    article: document.getElementById('doc')!,
    scroller: document.documentElement,
    sourceHost: sourceMount(),
    modeHost: document.body,
  };
  // Asset-protocol roots allowed this session (post-pass 3): one set per app instance, shared by its views.
  const assetRoots = new Set<string>();
  // The handle is built below; the view reads it only when a command runs on its article.
  let handleRef: AppHandle | null = null;
  const articleView = createRenderedView(host, {
    shell,
    trust,
    assetRoots,
    measure,
    rootFor: (path) => index.rootFor(path),
    selection: () => selection,
    context: () => buildAppContext(handleRef),
    refreshTitle,
  });
  view = articleView;
  persistence.follow(articleView);
  const renderedSelection = createRenderedSelection({
    article: host.article,
    scroller: host.scroller,
    store: () => store,
    // AppShell narrows the real shell; clipboardWrite (and openExternal, where there is one) is on it.
    shell: shell as SelectionShell,
    open: (path) => replaceOpenDocument(path),
    currentPath: openPathNow,
    mountThrough: (byteOffset) => articleView.mountThrough(byteOffset),
    imageRoot: imageRootFor,
  });
  selection = renderedSelection;
  const handle: AppHandle = {
    get state() { return { document: articleView.document() }; },
    dispatch() {},
    commands() { return appCommands(); },
    shell,
    ready,
    open: replaceOpenDocument,
    currentPath: openPathNow,
    imageRoot: imageRootFor,
    sourceHarness: () => articleView.sourceHarness(),
    // Summed over the app's views; there is one until Phase D.
    debugCounts: () => articleView.debugCounts(),
    openDocument: openDocumentState,
    document: () => store,
    save: saveOpenDocument,
    onDocumentChange,
    selection: renderedSelection,
    commitEdit,
    hasUnfoldedSource: () => articleView.sourceHasUnfoldedEdits(),
    foldSource: async () => { await foldSourceIntoBuffer(); },
    contentComplete: () => articleView.contentComplete(),
    mountThrough: (byteOffset) => articleView.mountThrough(byteOffset),
    toggleMode: () => articleView.toggleMode(),
    jumpToSource: (byteOffset) => articleView.jumpToSource(byteOffset),
    relayout: () => articleView.relayout(),
    pinPaletteDocument(path: string) {
      pinDocumentOnPaletteSession(paletteSession?.() ?? emptySession('/'), path);
    },
    setPaletteSession(session) {
      paletteSession = session;
    },
    index,
  };
  handleRef = handle;
  // The registry's one key dispatcher runs wherever the app does (it used to be Mod+E's own listener
  // here); the palette mount and the selection harness call the same idempotent install.
  setAppHandle(handle);
  installCommandKeys(handle);
  startDocumentEditingWire(() => buildAppContext(handle));
  installCloseGuard({
    shell,
    isDirty: hasUnsavedChanges,
    documentName: () => {
      const path = openPathNow();
      return path ? basename(path) : null;
    },
    save: () => saveOpenDocument(),
  });
  try {
    await serially(boot);
  } catch (e) {
    document.getElementById('doc')!.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await measure.finish(1);
  }
  return handle;
}
