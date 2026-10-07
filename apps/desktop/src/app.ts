// Application startup: given a shell, open the document, render it, and emit startup marks (MARXY-95).
import { setAppHandle } from './commands/app-handle.ts';
import { installCommandKeys } from './selection/bind.ts';
import { contentHash, type Buffer, type Document } from '@marxy/core';
import { applyWatchToOpenDocument } from '@marxy/core/src/position/reload.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { classify } from '@marxy/core/src/index-model/kinds.ts';
import { confirmLeaveDocument, installCloseGuard } from './close.ts';
import { save, type SaveDeps, type SaveResult } from './save.ts';
// Static, as it was through save.ts before B-11: a lazy chunk here would put the first title (and the
// late trust read queued after it) behind a fetch.
import { updateTitle } from './title.ts';
import { openDocumentStore, type DocumentSnapshot, type DocumentStore, type Transition } from './document/store.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { Shell } from '@marxy/shell-api';
import { buildBlocks, nodeFor, type BlockList, type NodeMap } from './render/post.ts';
import { stripNonLocalImages } from './render/images.ts';
import { clearDismissForPath, resetDismissedNotices } from './notices/blocked.ts';
import { commands as appCommands } from './commands/index.ts';
import { wireTrustRevokeCommands } from './commands/trust.ts';
import { createTrustController, type TrustController } from './trust/controller.ts';
import { diskChangedEditsKeptNotice, fileRemovedNotice } from './notices/disk.ts';
import { clearNotices } from './notices/index.ts';
import { leaveSourceMode } from './source/buffer-commit.ts';
import { applyWeightOffset, platformOf } from './theme/offset.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme/theme-document.ts';
import { parseConfig } from '@marxy/theme';
import { applyReaderConfig, readReaderConfig, takeConfigRead } from './theme/reader-config.ts';
import { resolveThemeDir, startUserTheme, themeDirFromConfig, type UserThemeContext } from './theme/user-theme.ts';
import { createLaunchMeasure, t0, type LaunchMeasure, type RenderEvidence } from './startup/measure.ts';
import { type ApplyImagesContext } from './render/images.ts';
import { type DeferredStartupContext, runDeferredStartup, whenIdle } from './startup/idle-work.ts';
import { mountProgressively, type ProgressiveMount } from './render/progressive.ts';
import { createIndexService, indexShellFor, type IndexService } from './index/service.ts';
import { currentPosition, restoreScrollToPosition, PositionPersistence } from './position/index.ts';
import {
  flushPaletteHistoryFromApp,
  loadPaletteHistory,
  pinDocumentOnPaletteSession,
  resetPaletteHistoryMirror,
  trackDocumentOpen,
} from './palette/history.ts';
import { emptySession } from './palette/session.ts';
import { defaultModeForPath } from './source/default-mode.ts';
import type { PieceSource } from './frontispiece/pieces.ts';

/** Minimal surface used by the shell; CM6 types stay on the lazy chunk (MARXY-33). */
interface MountedSourceEditor {
  docText(): string;
  scrollToByte(byteOffset: number): void;
  /** The buffer the editor maps bytes through; its text is kept when it already matches. */
  replaceBuffer(buffer: Buffer): void;
  destroy(): void;
  readonly view: {
    scrollDOM: HTMLElement;
    lineBlockAtHeight(height: number): { from: number };
  };
}

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

export interface OpenDocument {
  readonly ast: Document;
  readonly html: string;
  /** Rendered element → AST node, through its byte range (ADR-0023). */
  readonly nodeMap: NodeMap;
  /** Refreshed whenever layout moves them; built once here for now (MARXY-38 reads them). */
  blocks: BlockList;
}

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
  /** Playwright harness: buffer fingerprint and reading position (MARXY-169). */
  sourceHarness(): {
    readonly mode: 'rendered' | 'source';
    readonly bufferHash: string;
    readonly byteOffset: number;
  } | null;
  /** Playwright harness: live typesetters and resize observers, so N opens are seen to leave one of each. */
  debugCounts(): { typesetters: number; resizeObservers: number };
  /** The open document's buffer and parse, or null. */
  openDocument(): OpenDocumentState | null;
  /** The open document's store (ADR-0037), or null before the first document (B-11). */
  document(): DocumentStore | null;
  /**
   * The open document's explicit save (save.ts) with the deps only the app has: the fold from Source
   * and what follows a Save as. Resolves once the title shows the result (B-11).
   */
  save(opts?: { as?: boolean }): Promise<SaveResult>;
  /**
   * Called whenever the open document's bytes or identity change — an open, a reload from disk, an
   * edit folded in from Source, an operation — and with null when nothing is open. Every holder of
   * document state follows the app through this, instead of keeping a copy that goes stale.
   */
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /**
   * Applies an operation's result: makes `buffer` the open document and renders it through the same
   * path an open takes. The file is not written; that is an explicit save. Refused if a different
   * document is open by then.
   */
  commitEdit(buffer: Buffer): Promise<void>;
  /** Pin or unpin a document for palette history (same as Mod+. on a document row). */
  pinPaletteDocument(path: string): void;
  /** The palette index: one walk per repository root, every root opened so far published (A-04). */
  readonly index: IndexService;
  /**
   * Resolves when the open document is wholly in the article (A-02): at once for a document under the
   * progressive threshold, after the last idle chunk for a larger one.
   */
  contentComplete(): Promise<void>;
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

const state: { document: OpenDocument | null } = { document: null };

/**
 * The open document (ADR-0037): its path, its bytes and the bytes on disk, its parse and its history.
 * Every change to them is one of the store's transitions, and the page follows them through its
 * subscription (`followStore`). Transitional: B-15 removes this `let` when the open path leaves.
 */
let store: DocumentStore | null = null;
const documentListeners = new Set<(open: OpenDocumentState | null) => void>();

/** The open document's path, from the store. */
function openPathNow(): string | null {
  return store?.snapshot().path ?? null;
}

/** The open document's bytes, from the store. */
function bufferNow(): Buffer | null {
  return store?.snapshot().buffer ?? null;
}

function openDocumentState(): OpenDocumentState | null {
  if (!store || !state.document) return null;
  const snap = store.snapshot();
  return { path: snap.path, buffer: snap.buffer, ast: snap.ast, nodeMap: snap.nodeMap };
}

/** Tell every holder of document state what is open now (see AppHandle.onDocumentChange). */
function announceDocument(): void {
  const open = openDocumentState();
  for (const cb of documentListeners) cb(open);
}
let documentWatch: { close(): void } | null = null;
let viewMode: 'rendered' | 'source' = 'rendered';
let sourceEditor: MountedSourceEditor | null = null;
let lastReadingByteOffset = 0;
let lastReadingFraction = 0;
let modeToggleBusy = false;
let positionPersistence: PositionPersistence | null = null;
let persistenceLoaded = false;
let scrollPersistenceInstalled = false;
let restoreAfterTypeset = false;
/** The byte the open in progress lands on (an `at`, or the stored place), read before anything re-notes it. */
let openLanding: number | undefined;
/** `sourceReadingPosition` (source/mode-switch.ts), loaded with the editor: CM6 stays on the lazy chunk. */
let sourceReadingPositionIn:
  | ((buffer: Buffer, view: never, readingLinePx: number) => { readonly byteOffset: number; readonly fraction: number })
  | null = null;

function readingScroller(): HTMLElement {
  return document.documentElement;
}

/**
 * The reader's place while Source shows (F-04): the line on the reading line. In Source the window
 * scrolls and the article is hidden, so neither its block list nor CodeMirror's scroller says where
 * the reader is. Null in Rendered.
 */
function sourcePosition(path: string): ReadingPosition | null {
  const buffer = bufferNow();
  if (viewMode !== 'source' || !sourceEditor || !buffer || !sourceReadingPositionIn) return null;
  const place = sourceReadingPositionIn(buffer, sourceEditor.view as never, Math.round(window.innerHeight * 0.4));
  return { path, byteOffset: place.byteOffset, fraction: place.fraction, mode: 'source' };
}

/** The start of the line holding byte `at`. */
function lineStartAt(bytes: Uint8Array, at: number): number {
  let i = Math.min(at, bytes.length);
  while (i > 0 && bytes[i - 1] !== 0x0a) i--;
  return i;
}

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

function setModeChrome(mode: 'rendered' | 'source'): void {
  const doc = document.getElementById('doc')!;
  const host = sourceMount();
  viewMode = mode;
  document.body.dataset.marxyMode = mode;
  if (mode === 'source') {
    doc.hidden = true;
    host.hidden = false;
  } else {
    doc.hidden = false;
    host.hidden = true;
  }
}

async function ensureSourceEditor(): Promise<MountedSourceEditor> {
  if (sourceEditor) return sourceEditor;
  const buffer = bufferNow();
  if (!buffer) throw new Error('source editor requires an open buffer');
  const { createSourceEditor } = await import('./source/editor.ts');
  ({ sourceReadingPosition: sourceReadingPositionIn } = await import('./source/mode-switch.ts'));
  sourceEditor = await createSourceEditor({ parent: sourceMount(), buffer, lineNumbers: false });
  return sourceEditor;
}

async function showSource(byteOffset: number): Promise<void> {
  releaseAnchor();
  lastReadingByteOffset = byteOffset;
  const editor = await ensureSourceEditor();
  setModeChrome('source');
  editor.scrollToByte(byteOffset);
}

async function showRendered(byteOffset: number, fraction: number): Promise<void> {
  setModeChrome('rendered');
  const path = openPathNow();
  if (state.document && path) {
    const doc = document.getElementById('doc')!;
    mountThrough(doc, byteOffset);
    // Block positions must be measured with the article laid out, not from whatever a hidden pass saw.
    snap(doc);
    restoreScrollToPosition(readingScroller(), state.document.blocks, {
      path,
      byteOffset,
      fraction,
      mode: 'rendered',
    });
  }
}

async function enterSourceFromRendered(): Promise<void> {
  const path = openPathNow();
  if (!state.document || !path) return;
  const pos = currentPosition(readingScroller(), state.document.blocks, path, 'rendered');
  lastReadingByteOffset = pos.byteOffset;
  lastReadingFraction = pos.fraction;
  await showSource(pos.byteOffset);
}

async function leaveSourceForRendered(): Promise<void> {
  const open = store;
  if (!sourceEditor || !open) return;
  // Leaving Source is one history entry (`commitSource`): Mod+Z in Rendered undoes what was typed there.
  // The page follows the store: its subscription sets the article from the new bytes, so nothing
  // resolves an operation through an AST, node map or block list built from the old ones.
  const changed = await open.commitSource(sourceEditor.docText());
  let byteOffset = lastReadingByteOffset;
  let fraction = lastReadingFraction;
  // The line on the reading line, read before anything moves the window. Still the line Source was
  // entered on (no edit, no scroll away): the exact place it was entered from. Otherwise that line's
  // block, at its top.
  const { path, buffer } = open.snapshot();
  const place = sourcePosition(path);
  if (place && (changed || lineStartAt(buffer.bytes, lastReadingByteOffset) !== place.byteOffset)) {
    byteOffset = place.byteOffset;
    fraction = 0;
  }
  if (changed && sourceEditor) {
    sourceEditor.replaceBuffer(buffer);
    await refreshTitle();
  }
  lastReadingByteOffset = byteOffset;
  lastReadingFraction = fraction;
  await showRendered(byteOffset, fraction);
}

async function toggleViewMode(): Promise<void> {
  if (modeToggleBusy || !store) return;
  modeToggleBusy = true;
  try {
    await serially(async () => {
      if (viewMode === 'rendered') await enterSourceFromRendered();
      else await leaveSourceForRendered();
    });
  } finally {
    modeToggleBusy = false;
  }
}

async function jumpToSource(byteOffset: number): Promise<void> {
  if (modeToggleBusy || !store) return;
  modeToggleBusy = true;
  try {
    await serially(async () => {
      lastReadingFraction = 0;
      await showSource(byteOffset);
    });
  } finally {
    modeToggleBusy = false;
  }
}

/**
 * Opens and mode switches run one at a time: each reads and replaces the same module state (the
 * buffer, the typesetter, the editor), so two interleaved would leave one file's buffer behind
 * another's page. A failure does not stop the next one from running.
 */
let chain: Promise<unknown> = Promise.resolve();
function serially<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function sourceHarness(): ReturnType<AppHandle['sourceHarness']> {
  if (!store) return null;
  const { path, buffer } = store.snapshot();
  const byteOffset =
    viewMode === 'rendered' && state.document
      ? currentPosition(readingScroller(), state.document.blocks, path, 'rendered').byteOffset
      : lastReadingByteOffset;
  return { mode: viewMode, bufferHash: contentHash(buffer.bytes), byteOffset };
}

/** Sanitised (or empty-state) HTML into `#doc`. `app.ts` is in registry.innerHtmlAllowedIn. */
function assignHtml(doc: HTMLElement, html: string): void {
  doc.innerHTML = html;
}

/** The source bytes the article holds so far: the end of its last block with provenance. */
function mountedBytes(doc: HTMLElement): number {
  for (let el = doc.lastElementChild; el !== null; el = el.previousElementSibling) {
    const end = el.getAttribute('data-marxy-e');
    if (end !== null) return Number(end);
  }
  return 0;
}

/** The arguments this launch was given (or the shell reported), for the document and the flags. */
let launchArgs: readonly string[] = [];

/** This launch's measurement (B-08): frame counter, harness detection, first text and the exit code. */
let measure: LaunchMeasure;

/** The palette index for this launch; created by startApp (A-04). */
let index: IndexService;
/** The launch document's walk, so `ready` (and a harness quit) follows its `index_loaded` mark. */
let indexing: Promise<void> = Promise.resolve();
/** History records opens in order even though each waits on its root (palette/history.ts). */
let historyTracked: Promise<void> = Promise.resolve();

function deferredStartupContext(
  file: string,
  doc: HTMLElement,
  imageCtx: Omit<ApplyImagesContext, 'documentPath' | 'documentDir' | 'imageRoot'>,
): DeferredStartupContext {
  return {
    shell,
    file,
    doc,
    imageCtx,
    onLayoutChanged: () => snap(doc),
  };
}

/** The shell this launch is using; set by startApp, never imported from tauri.ts. */
let shell: AppShell;

/** What the open document may show (B-10); created by startApp, one per launch. */
let trust: TrustController;

/** Asset-protocol roots allowed this session (post-pass 3). */
const scopedAssetRoots = new Set<string>();

/**
 * The grid pass (ADR-0030), now and whenever heights can change under it: when fonts arrive and
 * when the column is resized. Reading position is re-read after each, because tops move.
 */
let typeset: TypesetController | null = null;
/** The open document's mount (A-02), beside its typesetter: what of the article is in so far. */
let mount: ProgressiveMount | null = null;
let userThemeHandle: { stop(): void } | null = null;

function userThemeContext(doc: HTMLElement): UserThemeContext {
  return {
    shell,
    article: doc,
    getTypeset: () => typeset,
    readingScroller,
    getOpenPath: openPathNow,
    getBlocks: () => state.document?.blocks ?? null,
  };
}

async function restartUserTheme(dir: string | null): Promise<void> {
  userThemeHandle?.stop();
  userThemeHandle = await startUserTheme(userThemeContext(document.getElementById('doc')!), dir);
}

/** A change of variant, size or window width: same position, new layout (A-14, S-02-0001). */
async function relayoutKeepingReader(
  reason: 'theme' | 'resize' = 'theme',
  from: ReadingPosition | null = null,
): Promise<void> {
  const doc = document.getElementById('doc');
  const path = openPathNow();
  if (!doc || !path || !state.document || viewMode !== 'rendered') return;
  const pos = from?.path === path ? from : currentPosition(readingScroller(), state.document.blocks, path, 'rendered');
  if (typeset) {
    typeset.relayout(reason);
    await typeset.ready;
  } else {
    snap(doc);
  }
  if (!state.document) return;
  restoreScrollToPosition(readingScroller(), state.document.blocks, { ...pos, path, mode: 'rendered' });
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

function snap(article: HTMLElement, from?: HTMLElement): void {
  cancelScheduledSnap();
  lastSnapAt = performance.now();
  snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight), from ? { from } : undefined);
  if (state.document) state.document.blocks = buildBlocks(article, state.document.nodeMap);
  holdAnchor();
}

/**
 * The byte offset an open asked to land on. Every grid pass rebuilds the block list and the
 * background typesetter reflows paragraphs above the target after the open returns, so one scroll
 * would land off by the reflow; the anchor is re-applied after each pass instead, until the reader
 * scrolls, changes mode or opens something else.
 */
let anchor: number | null = null;
let anchorListening = false;
/**
 * A reading position a re-render restored (a reload, an edit), held the same way until the
 * typesetter has set the new page (A-02): its passes reflow paragraphs above the reading line, and
 * at 1 MB they run for seconds after the render returns.
 */
let heldPosition: ReadingPosition | null = null;

const READER_INPUT = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

function releaseAnchor(): void {
  anchor = null;
  heldPosition = null;
  stopListeningForReaderScroll();
}

function listenForReaderScroll(): void {
  if (anchorListening) return;
  anchorListening = true;
  // Input, not `scroll`: the anchor's own scrolls must not release it.
  for (const type of READER_INPUT) {
    window.addEventListener(type, releaseAnchor, { capture: true, passive: true });
  }
}

/**
 * Nothing held, nothing to release: the listeners go. While any `wheel` listener is on the window,
 * WebKit repaints the whole page after every layout (B-02.8), so one left behind would cost every
 * later open of a large document.
 */
function stopListeningForReaderScroll(): void {
  if (!anchorListening) return;
  anchorListening = false;
  for (const type of READER_INPUT) window.removeEventListener(type, releaseAnchor, { capture: true });
}

/** The innermost block whose node's byte range contains `at`, else the last one starting before it. */
function blockContaining(doc: OpenDocument, at: number): BlockList[number] | undefined {
  let before: BlockList[number] | undefined;
  let containing: BlockList[number] | undefined;
  for (const block of doc.blocks) {
    if (block.start > at) break;
    before = block;
    const node = nodeFor(doc.nodeMap, block.el);
    if (node !== undefined && at < node.src.end) containing = block;
  }
  return containing ?? before;
}

function holdAnchor(): void {
  const openPath = openPathNow();
  if (!state.document || !openPath || viewMode !== 'rendered') return;
  if (heldPosition !== null && heldPosition.path === openPath) {
    restoreScrollToPosition(readingScroller(), state.document.blocks, heldPosition);
    return;
  }
  if (anchor === null) return;
  const block = blockContaining(state.document, anchor);
  if (block === undefined) return;
  restoreScrollToPosition(readingScroller(), state.document.blocks, {
    path: openPath,
    byteOffset: block.start,
    fraction: 0,
    mode: 'rendered',
  });
}

/**
 * Restores `position` on the page a re-render just made, and holds it there through the passes that
 * follow: until the reader scrolls, or until the document is wholly in and wholly set.
 */
function holdPosition(doc: HTMLElement, position: ReadingPosition): void {
  mountThrough(doc, position.byteOffset);
  if (!state.document) return;
  restoreScrollToPosition(readingScroller(), state.document.blocks, position);
  listenForReaderScroll();
  anchor = null;
  heldPosition = position;
  const current = mount;
  void (async () => {
    await current?.complete;
    // `done` is replaced when adopted paragraphs arrive after it resolved: wait for the last one.
    for (let set = typeset; set !== null && set === typeset; ) {
      const done = set.done;
      await done;
      if (set.done === done) break;
    }
    if (heldPosition !== position || mount !== current) return;
    snap(doc);
    heldPosition = null;
    if (anchor === null) stopListeningForReaderScroll();
  })();
}

function landOn(at: number | undefined): void {
  if (at === undefined) return;
  mountThrough(document.getElementById('doc')!, at);
  listenForReaderScroll();
  anchor = at;
  holdAnchor();
}

/**
 * The grid pass and the block list each read the whole article, so running them after every idle
 * batch of eight paragraphs made background typesetting quadratic in the document's length (a
 * 516 KB document: 357,000 layout reads). A pass the reader can see — the viewport, or paragraphs
 * scrolling into view — is snapped at once; background passes are coalesced to one snap per
 * SNAP_INTERVAL_MS, with a trailing one so the last batch is always on the grid.
 */
const SNAP_INTERVAL_MS = 250;
let lastSnapAt = 0;
let snapTimer = 0;
let snapFrame = 0;
/**
 * What the pending snap covers: undefined for none asked, null for the whole article, or the first
 * block appended since the last snap (A-02), when only appends asked for it.
 */
let snapFrom: HTMLElement | null | undefined;

function cancelScheduledSnap(): void {
  if (snapTimer !== 0) clearTimeout(snapTimer);
  if (snapFrame !== 0) cancelAnimationFrame(snapFrame);
  snapTimer = 0;
  snapFrame = 0;
  snapFrom = undefined;
}

/** Runs the pending snap now, over what it would have covered. */
function snapPending(article: HTMLElement): void {
  snap(article, snapFrom ?? undefined);
}

/** `from` asks only for the blocks from it on (the earliest asked wins); without it, the whole article. */
function scheduleSnap(article: HTMLElement, from?: HTMLElement): void {
  if (from === undefined || snapFrom === null) snapFrom = null;
  else if (snapFrom === undefined || from.compareDocumentPosition(snapFrom) & Node.DOCUMENT_POSITION_FOLLOWING) snapFrom = from;
  if (snapTimer !== 0 || snapFrame !== 0) return;
  const wait = Math.max(0, lastSnapAt + SNAP_INTERVAL_MS - performance.now());
  snapTimer = window.setTimeout(() => {
    snapTimer = 0;
    snapFrame = requestAnimationFrame(() => {
      snapFrame = 0;
      snapPending(article);
    });
  }, wait);
}

let resizeObserver: ResizeObserver | null = null;

/** What `debugCounts` reports: every typesetter started and not yet destroyed, and live observers. */
const liveTypesetters = new Set<TypesetController>();
let liveResizeObservers = 0;

function destroyTypeset(): void {
  if (typeset) liveTypesetters.delete(typeset);
  typeset?.destroy();
  typeset = null;
}

/** The open article's listener for faces that load after the first screens (A-02). */
let fontsLoaded: (() => void) | null = null;
/**
 * Islands that arrived in chunks (A-02). An island can change height after the pass that measured it
 * with nothing in its style changing (WebKitGTK relays out some tables a layout later), and a later
 * pass from further down would not see it: when one does, the pass is asked again from its block.
 */
let islandObserver: ResizeObserver | null = null;
const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

function watchIslands(article: HTMLElement, added: readonly HTMLElement[]): void {
  if (!islandObserver) {
    const sized = new WeakMap<Element, number>();
    islandObserver = new ResizeObserver((entries) => {
      for (const { target, contentRect } of entries) {
        const was = sized.get(target);
        sized.set(target, contentRect.height);
        if (was === undefined || Math.abs(was - contentRect.height) < 0.1) continue;
        let block = target as HTMLElement;
        while (block.parentElement && block.parentElement !== article) block = block.parentElement;
        if (block.parentElement === article) scheduleSnap(article, block);
      }
    });
  }
  for (const el of added) {
    if (el.matches(ISLANDS)) islandObserver.observe(el);
    for (const island of el.querySelectorAll(ISLANDS)) islandObserver.observe(island);
  }
}

function disconnectResizeObserver(): void {
  if (resizeObserver) liveResizeObservers -= 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (fontsLoaded) document.fonts.removeEventListener('loadingdone', fontsLoaded);
  fontsLoaded = null;
  islandObserver?.disconnect();
  islandObserver = null;
}

function keepOnGrid(article: HTMLElement): void {
  snap(article);
  void document.fonts.ready.then(() => snap(article));
  let pending = 0;
  let width = article.clientWidth;
  disconnectResizeObserver();
  // A face first used further down (in a chunk appended after the first screens) loads late and
  // changes the height of every block set in it, above the chunk passes' reach: the whole article again.
  fontsLoaded = () => scheduleSnap(article);
  document.fonts.addEventListener('loadingdone', fontsLoaded);
  liveResizeObservers += 1;
  const laidOut = () => !article.hidden && article.clientWidth > 0;
  // The reader's place before a burst of resizes: read from the block list the last layout built,
  // which the new width has not rebuilt yet, and put back once the relayout has set the page (S-02-0001).
  let before: ReadingPosition | null = null;
  // A window that narrows with the article at its full measure still reflows what is wider than the
  // measure (tables, code): the article's height changes, its width does not.
  let viewportWidth = window.innerWidth;
  let rebreak = false;
  resizeObserver = new ResizeObserver(() => {
    // Hidden (Source mode) the article is zero-width: measuring now would zero every block position.
    if (!laidOut() || (article.clientWidth === width && window.innerWidth === viewportWidth)) return;
    rebreak ||= article.clientWidth !== width;
    width = article.clientWidth;
    viewportWidth = window.innerWidth;
    const path = openPathNow();
    if (before === null && path && state.document) {
      before = currentPosition(readingScroller(), state.document.blocks, path, 'rendered');
    }
    clearTimeout(pending);
    // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
    pending = window.setTimeout(() => {
      const position = before;
      const relayout = rebreak;
      before = null;
      rebreak = false;
      if (!laidOut()) return;
      if (relayout) {
        void relayoutKeepingReader('resize', position);
        return;
      }
      snap(article);
      if (position && state.document && position.path === openPathNow() && viewMode === 'rendered') {
        restoreScrollToPosition(readingScroller(), state.document.blocks, position);
      }
    }, 100);
  });
  resizeObserver.observe(article);
}

/**
 * Everything one open document started: its typesetter, its resize observer, a pending grid pass
 * and its Source editor. Run before the next document replaces it, so N opens leave one of each and
 * not N — each old observer would otherwise relayout on every resize.
 */
function teardownDocument(): void {
  mount?.cancel();
  mount = null;
  documentWatch?.close();
  documentWatch = null;
  // The store goes with its page: a transition still queued on it is refused, not applied elsewhere.
  store?.close();
  store = null;
  releaseAnchor();
  destroyTypeset();
  disconnectResizeObserver();
  cancelScheduledSnap();
  sourceEditor?.destroy();
  sourceEditor = null;
  document.getElementById('marxy-source')?.replaceChildren();
}

/** Source text the reader typed and has not yet folded into the store: the store cannot see it. */
function unfoldedSourceEdits(): boolean {
  const buffer = bufferNow();
  return buffer !== null && viewMode === 'source' && sourceEditor !== null && leaveSourceMode(buffer, sourceEditor.docText()).changed;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What the page waits on after a store transition re-set it (B-11): the new page's first typeset pass,
 * then the title. A repaint superseded by the next one stops being waited on. Transitional, with
 * `store`: B-13 moves it into the per-article view.
 */
const page: {
  settled: Promise<void>;
  supersede: () => void;
  /** A reload's reading position, mapped through the change by the watcher; read by the repaint. */
  reloadAt: ReadingPosition | null;
} = { settled: Promise.resolve(), supersede: () => {}, reloadAt: null };

function settlePage(work: Promise<void>): void {
  page.supersede();
  let supersede!: () => void;
  const superseded = new Promise<void>((resolve) => { supersede = resolve; });
  page.supersede = supersede;
  page.settled = Promise.race([work, superseded])
    .then(() => refreshTitle())
    .catch((e: unknown) => console.warn(`marxy: the page did not settle after a change: ${String(e)}`));
}

/**
 * The page again, from the store's bytes, at `position`: the same render, typeset and hold an open
 * gets. Used for every transition that changed the bytes or the name (an operation, undo, redo, a
 * reload, a rename) and for `commitEdit` of unchanged bytes.
 */
function repaint(snap: DocumentSnapshot, position: ReadingPosition): void {
  const doc = document.getElementById('doc')!;
  sourceEditor?.replaceBuffer(snap.buffer);
  releaseAnchor();
  rerenderFromBuffer(doc, position.byteOffset);
  const typesetting = typesetDocument(doc);
  if (viewMode === 'source' && sourceEditor) {
    // Source shows and the window is its scroller: the place goes back into the editor, not onto the
    // hidden article, whose block list has nothing measured to place it by (F-04).
    lastReadingByteOffset = position.byteOffset;
    lastReadingFraction = 0;
    sourceEditor.scrollToByte(position.byteOffset);
  } else {
    holdPosition(doc, { ...position, path: snap.path });
  }
  settlePage(typesetting);
}

/**
 * A render that throws after the store committed (B-11): the change stands — it is in the buffer and
 * in the history, so undo and save still see it — and the page says what went wrong in its place.
 */
function showRenderFailure(e: unknown): void {
  console.warn(`marxy: the page could not be set after a change: ${String(e)}`);
  const message = document.createElement('p');
  message.textContent = String(e);
  document.getElementById('doc')!.replaceChildren(message);
  settlePage(Promise.resolve());
}

/** The page's side of a committed transition on the open store. */
function followTransition(before: DocumentSnapshot, snap: DocumentSnapshot, change: Transition): void {
  switch (change.kind) {
    case 'open':
    case 'close':
      return;
    case 'save':
      // A Save as moved the store to another name: the parse the page resolves through follows it.
      if (change.renamedFrom !== undefined && state.document) {
        state.document = { ...state.document, ast: snap.ast, nodeMap: snap.nodeMap };
      }
      settlePage(Promise.resolve());
      return;
    case 'commitSource':
      // Leaving Source (or folding before a save or a rename): the caller restores the position.
      try {
        rerenderFromBuffer(document.getElementById('doc')!);
      } catch (e) {
        showRenderFailure(e);
      }
      return;
    case 'reload':
      // Disk caught up with the buffer (our save's echo, or an external write of the same bytes).
      if (snap.buffer === before.buffer) {
        settlePage(Promise.resolve());
        return;
      }
      break;
    case 'apply':
    case 'undo':
    case 'redo':
    case 'rename':
      break;
  }
  if (!state.document) return;
  const position =
    change.kind === 'reload' && page.reloadAt !== null
      ? page.reloadAt
      : sourcePosition(before.path) ?? currentPosition(readingScroller(), state.document.blocks, before.path, 'rendered');
  try {
    repaint(snap, position);
  } catch (e) {
    showRenderFailure(e);
  }
}

/** The page follows `next` for as long as it is the open store (ADR-0037 §1: readers subscribe). */
function followStore(next: DocumentStore): void {
  let shown = next.snapshot();
  next.subscribe((snap, change) => {
    const before = shown;
    shown = snap;
    if (store === next) followTransition(before, snap, change);
  });
}

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
 * the stale-write guard) unless the buffer has unsaved edits, which it keeps.
 */
async function reloadOpenFromDisk(open: DocumentStore, bytes: Uint8Array, position: ReadingPosition): Promise<void> {
  const t0 = performance.now();
  page.reloadAt = position;
  let outcome: Awaited<ReturnType<DocumentStore['reload']>>;
  try {
    outcome = await open.reload(bytes);
  } finally {
    page.reloadAt = null;
  }
  if (outcome === 'kept') {
    diskChangedEditsKeptNotice();
    return;
  }
  await page.settled;
  if (outcome !== 'reloaded') return;
  const ms = performance.now() - t0;
  await shell.mark('live_reload', Date.now(), `ms=${ms.toFixed(1)}`);
}

const isMarkdownPath = (path: string): boolean => classify(path) === 'markdown';

/**
 * The watch is the document's directory: a markdown file there changed, so its root is re-walked
 * (coalesced, at idle). The echo of Marxy's own save is not a change: an event naming the open
 * document while disk holds exactly the buffer's bytes re-walks nothing. Recursive watching is a later phase.
 */
function refreshIndexForWatch(events: readonly WatchEvent[], path: string, diskBytes: Uint8Array | null): void {
  const buffer = bufferNow();
  const echo = diskBytes !== null && buffer !== null && contentHash(diskBytes) === contentHash(buffer.bytes);
  const changed = (p: string | undefined) => p !== undefined && isMarkdownPath(p) && !(echo && p === path);
  if (events.some((e) => changed(e.path) || changed(e.to))) {
    void index.rootFor(path).then((root) => index.refresh(root));
  }
}

async function handleDocumentWatch(events: readonly WatchEvent[]): Promise<void> {
  const open = store;
  if (!open || !state.document) return;
  const path = open.snapshot().path;
  const position = sourcePosition(path) ?? currentPosition(readingScroller(), state.document.blocks, path, viewMode);
  const diskBytes = await readOpenFileWithRetry(path);
  refreshIndexForWatch(events, path, diskBytes);
  const buffer = open.snapshot().buffer;
  const update = applyWatchToOpenDocument(
    events,
    position,
    diskBytes,
    buffer.bytes,
  );
  if (update.action === 'ignore') return;
  if (update.action === 'gone') {
    fileRemovedNotice();
    return;
  }
  if (update.action === 'follow') {
    // Already inside `serially`: going through replaceOpenDocument would queue this open behind the
    // task waiting for it, and every open, mode switch and reload after it would wait forever.
    if (hasUnsavedChanges()) await retargetOpenDocument(update.path);
    else await openReplacing(update.path, update.position.byteOffset);
    return;
  }
  if (diskBytes === null) {
    fileRemovedNotice();
    return;
  }
  // Text typed in Source and not yet folded in is an unsaved edit the store cannot see: keep it, as the
  // store keeps a dirty buffer. Bytes equal to the buffer change nothing the reader could lose.
  if (unfoldedSourceEdits()) {
    if (!sameBytes(diskBytes, buffer.bytes)) diskChangedEditsKeptNotice();
    return;
  }
  await reloadOpenFromDisk(open, diskBytes, update.position);
}

/**
 * The open file was renamed while the buffer has unsaved edits: the buffer keeps them and follows the
 * new name, still unsaved against the file it came from, rather than being reloaded over them. The
 * history follows too: it is the store's, not a hash's (ADR-0037 §3).
 */
async function retargetOpenDocument(newPath: string): Promise<void> {
  await foldSourceIntoBuffer();
  const open = store;
  if (!open || !state.document) return;
  // The store's subscription sets the page again under the new name, at the reader's position.
  await open.rename(newPath);
  await page.settled;
  await shell.allowAssetScope(dirname(newPath));
  await registerDocumentWatch(newPath);
  document.title = `${basename(newPath)} — Marxy`;
  announceDocument();
  await refreshTitle();
}

async function registerDocumentWatch(file: string): Promise<void> {
  documentWatch?.close();
  documentWatch = null;
  try {
    documentWatch = await shell.watch(dirname(file), (events) => {
      void serially(() => handleDocumentWatch(events));
    });
  } catch (e) {
    // The document is already on the page; a directory that cannot be watched costs live reload,
    // not the page the reader is looking at.
    console.warn(`marxy: not watching ${dirname(file)}: ${String(e)}`);
    await shell.mark('watch_failed', Date.now(), String(e));
  }
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
    if (!open || next.path !== open.snapshot().path || !state.document) throw new Error('the edited document is no longer open');
    const snap = open.snapshot();
    const change = byteChange(snap.buffer.bytes, next.bytes);
    if (change === null) {
      repaint(snap, sourcePosition(snap.path) ?? currentPosition(readingScroller(), state.document.blocks, snap.path, 'rendered'));
    } else {
      await open.apply({
        range: { file: snap.path, start: change.start, end: change.end },
        replacement: new TextDecoder().decode(change.replacement),
        label: 'edit',
      });
    }
    await page.settled;
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
  const open = store;
  if (!open || viewMode === 'rendered' || !sourceEditor) return;
  if (await open.commitSource(sourceEditor.docText())) {
    sourceEditor?.replaceBuffer(open.snapshot().buffer);
    await refreshTitle();
  }
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
      await registerDocumentWatch(path);
      announceDocument();
    },
  };
}

async function saveOpenDocument(opts?: { as?: boolean }): Promise<SaveResult> {
  const open = store;
  if (!open) return 'failed';
  const result = await save(saveDeps(open), opts);
  // The store's subscription refreshes the title on a save; resolve once it has.
  await page.settled;
  return result;
}

function startTypeset(article: HTMLElement): TypesetController {
  const lineBox = parseFloat(getComputedStyle(article).lineHeight);
  destroyTypeset();
  typeset = attach(article, {
    lineBox,
    glueStretchEm: 0.6,
    lastLineMinWidth: 0.33,
    onPass: (kind) => (kind === 'background' ? scheduleSnap(article) : snap(article)),
  });
  liveTypesetters.add(typeset);
  return typeset;
}

/**
 * The typesetter (MARXY-23), after first text: the reader sees the engine's wrapping for at most a
 * frame, then the viewport set with hyphenation and hanging punctuation, and the rest in idle time.
 */
async function typesetDocument(article: HTMLElement): Promise<void> {
  const controller = startTypeset(article);
  const current = mount;
  await controller.ready;
  const { viewportMs, hyphenationLoadMs, typeset: set } = controller.stats;
  await shell.mark('typeset_viewport', Date.now(), `ms=${viewportMs.toFixed(1)} hyphenation_load_ms=${hyphenationLoadMs.toFixed(1)} set=${set}`);
  // `typeset_done` (B-01): every paragraph of the whole document considered. Never awaited, so first
  // text and `ready` do not wait for it. A large document's later chunks reopen `done` as they are
  // adopted, so this follows the mount to its last chunk, then `done` to its last promise. A cancelled
  // mount or a destroyed controller (another document) emits nothing.
  void (async () => {
    if (current && !current.isComplete()) {
      await current.complete;
      if (!current.isComplete()) return;
    }
    let done: Promise<void>;
    do {
      done = controller.done;
      await done;
    } while (done !== controller.done);
    if (typeset !== controller) return;
    await shell.mark('typeset_done', Date.now(), `set=${controller.stats.typeset}`);
  })().catch(() => {});
}

/**
 * The page again from the store's snapshot, after its bytes or its grants changed under the open
 * document (an edit, a reload, a trust change). The store has already parsed the bytes; this is the
 * same render and passes as an open. Given a byte offset, the mount lands there and the reading
 * position is the caller's; given a position (a trust change), it is also restored here.
 */
function rerenderFromBuffer(doc: HTMLElement, at?: number | Pick<ReadingPosition, 'byteOffset' | 'fraction'>): void {
  if (!store) return;
  const { path: file, ast, nodeMap } = store.snapshot();
  const byteOffset = typeof at === 'number' ? at : at?.byteOffset;
  const { html, removed, blockedImages } = renderDocumentSafeHtml(ast, trust.policyFor(file));
  destroyTypeset();
  state.document = { ast, html, nodeMap, blocks: [] };
  const mounted = mountDocument(doc, html, file, byteOffset);
  announceDocument();
  trust.showNotices(removed, blockedImages);
  snap(doc);
  startTypeset(doc);
  if (at !== undefined && typeof at !== 'number') {
    mountThrough(doc, at.byteOffset);
    restoreScrollToPosition(readingScroller(), state.document.blocks, {
      path: file,
      byteOffset: at.byteOffset,
      fraction: at.fraction,
      mode: 'rendered',
    });
  }
  deferAfterComplete(mounted, file, doc);
}

/**
 * The open document's HTML into `#doc` through its one mount (A-02): all of it at once under the
 * threshold, else the first screens (from `landing` down, when given) now and the rest in idle chunks
 * once `start` settles. Replaces, and cancels, the mount of whatever was open before.
 */
function mountDocument(doc: HTMLElement, html: string, file: string, landing?: number, start?: Promise<unknown>): ProgressiveMount {
  mount?.cancel();
  cancelScheduledSnap();
  const t0 = performance.now();
  let chunks = 0;
  const current: ProgressiveMount = mountProgressively(doc, html, {
    landing,
    start,
    prepare: (parsed) => stripNonLocalImages(parsed, file),
    onChunk: (added) => {
      if (mount !== current) return;
      chunks += 1;
      scheduleSnap(doc, added[0]);
      watchIslands(doc, added);
      typeset?.adopt(added);
    },
  });
  mount = current;
  void current.complete.then(() => {
    if (mount !== current || !current.isComplete() || chunks === 0) return;
    // The last chunk's blocks are on the grid before anything reads the whole document.
    snap(doc);
    void shell.mark('content_complete', Date.now(), `ms=${(performance.now() - t0).toFixed(1)} chunks=${chunks}`);
  });
  return current;
}

/**
 * Appends, now, every block up to the one holding `byte` and the screens below it, then puts what
 * was appended on the grid and in the block list, so a position can be restored there at once.
 */
function mountThrough(doc: HTMLElement, byte: number): void {
  if (!mount || mount.isComplete()) return;
  const before = doc.childElementCount;
  mount.ensureThrough(byte);
  if (doc.childElementCount !== before) snapPending(doc);
}

/**
 * Images, KaTeX and highlighting see the whole document (A-02): they run once the mount is
 * complete, and not at all for a mount a later render or open replaced.
 */
function afterComplete(current: ProgressiveMount, fn: () => Promise<void>): Promise<void> {
  if (current.isComplete()) return fn();
  return current.complete.then(() => (mount === current && current.isComplete() ? fn() : undefined));
}

/** Images, KaTeX and highlighting for `file` (startup/idle-work.ts): the one place they are started. */
function deferredStartup(file: string, doc: HTMLElement): () => Promise<void> {
  return () => runDeferredStartup(deferredStartupContext(file, doc, { shell, scopedRoots: scopedAssetRoots }));
}

function deferAfterComplete(current: ProgressiveMount, file: string, doc: HTMLElement): void {
  void afterComplete(current, () => whenIdle(deferredStartup(file, doc)));
}

async function flushReadingPersistence(): Promise<void> {
  const openPath = openPathNow();
  if (!positionPersistence || !openPath || !state.document) return;
  const pos = sourcePosition(openPath) ?? currentPosition(readingScroller(), state.document.blocks, openPath, viewMode);
  positionPersistence.note(openPath, pos);
  await positionPersistence.flush();
}

async function flushPaletteHistory(): Promise<void> {
  const palette = (window as Window & { __marxyPalette?: { session: import('./palette/session.ts').PaletteSession } })
    .__marxyPalette;
  if (!shell.configPaths) return;
  await historyTracked;
  await flushPaletteHistoryFromApp({ ...shell, configPaths: shell.configPaths }, palette?.session);
}

async function flushAllPersistence(): Promise<void> {
  await flushReadingPersistence();
  await flushPaletteHistory();
}

function installScrollPersistence(): void {
  if (scrollPersistenceInstalled || !positionPersistence) return;
  scrollPersistenceInstalled = true;
  // WebKit fires the viewport's scroll at the Document, not at documentElement, so listen there.
  // PositionPersistence debounces the write itself (POSITIONS_DEBOUNCE_MS), so noting on every
  // scroll event only updates an in-memory entry.
  // One sample per frame: currentPosition walks the blocks, so it must not run per scroll event.
  let frame = 0;
  document.addEventListener(
    'scroll',
    () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const openPath = openPathNow();
        if (!positionPersistence || !openPath || !state.document) return;
        // In Source the window scrolls the editor: the place is the line on the reading line.
        const source = sourcePosition(openPath);
        if (source) return positionPersistence.note(openPath, source);
        if (viewMode !== 'rendered') return;
        const pos = currentPosition(readingScroller(), state.document.blocks, openPath, 'rendered');
        positionPersistence.note(openPath, pos);
      });
    },
    { passive: true },
  );
  // A window close that skips shell.quit still gets the last position out.
  window.addEventListener('pagehide', () => {
    void flushReadingPersistence();
  });
}

/** The memory shell can say a state file is absent without a recorded `readFile`. */
function optionalStatePresent(path: string): boolean | undefined {
  const peek = shell as AppShell & { hasFile?(p: string): boolean };
  return typeof peek.hasFile === 'function' ? peek.hasFile(path) : undefined;
}

async function readOptionalState(path: string): Promise<Uint8Array> {
  if (optionalStatePresent(path) === false) {
    const err = new Error(`not found: ${path}`) as Error & { code: 'not-found'; path: string };
    err.code = 'not-found';
    err.path = path;
    throw err;
  }
  return shell.readFile(path);
}

async function ensurePersistenceLoaded(fallbackRoot: string): Promise<void> {
  if (persistenceLoaded) return;
  persistenceLoaded = true;
  // A shell without configPaths (ADR-0026) has nowhere to keep state: read and write nothing.
  if (!shell.configPaths) return;
  const io = {
    readFile: (path: string) => readOptionalState(path),
    writeFileAtomic: (path: string, bytes: Uint8Array) => shell.writeFileAtomic(path, bytes),
    dataDirectory: async () => (await shell.configPaths!()).data,
  };
  positionPersistence = await PositionPersistence.open(io);
  await loadPaletteHistory(
    { ...shell, readFile: readOptionalState, configPaths: shell.configPaths },
    fallbackRoot,
  );
  installScrollPersistence();
  restoreAfterTypeset = true;
}

/** After `first_text`, positions.json may ask to move the document already on screen (MARXY-195). */
async function restorePersistedPositionIfNeeded(): Promise<void> {
  if (!positionPersistence || !store || !state.document) return;
  const { path, buffer } = store.snapshot();
  const stored = positionPersistence.positionForOpen(path, buffer.bytes.length);
  if (!stored) return;
  openLanding = stored.byteOffset;
  // A file that opens in Source is put there by finishDocumentOpen, at this byte.
  if (defaultModeForPath(path) === 'source') return;
  // A place kept in Source is a line, not a fraction of a block: its block, at the top (S-08-0001).
  const position = stored.mode === 'source' ? { ...stored, fraction: 0, mode: 'rendered' as const } : stored;
  lastReadingByteOffset = position.byteOffset;
  lastReadingFraction = position.fraction;
  mountThrough(document.getElementById('doc')!, position.byteOffset);
  restoreScrollToPosition(readingScroller(), state.document.blocks, position);
  landOn(stored.byteOffset);
  holdAnchor();
}

/**
 * Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183).
 * A large document's idle chunks wait for `start` (A-02), so nothing is appended before first text.
 */
async function openDocumentThroughRenderMark(
  file: string,
  doc: HTMLElement,
  at: number | undefined,
  start: Promise<unknown>,
): Promise<RenderEvidence> {
  const bytes = await shell.readFile(file);
  await applyReaderConfigOnce();
  let landing = at;
  if (landing === undefined && positionPersistence) {
    const stored = positionPersistence.positionForOpen(file, bytes.length);
    if (stored) landing = stored.byteOffset;
  }
  openLanding = landing;
  teardownDocument();
  clearDismissForPath(file);
  sourceMount();
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
  followStore(opened);
  const { ast, nodeMap } = opened.snapshot();
  await shell.mark('parsed', Date.now());
  const { html, removed, blockedImages } = renderDocumentSafeHtml(ast, trust.policyFor(file));
  console.info(`marxy: sanitiser removed ${removed.length}`);
  // A different document starts with no notices (blocked.ts no longer clears the rest on every render).
  clearNotices();
  state.document = { ast, html, nodeMap, blocks: [] };
  // Only the first screens go in now (A-02); images are checked before any block reaches the page.
  mountDocument(doc, html, file, landing, start);
  announceDocument();
  await shell.mark('rendered', Date.now());
  await shell.mark('first_screen', Date.now(), `blocks=${doc.childElementCount} bytes=${mountedBytes(doc)}`);
  trust.showNotices(removed, blockedImages);
  void doc.offsetHeight;
  await document.fonts.ready;
  // No face list here (A-02): reading `document.fonts` made WebKit restyle the whole article as soon
  // as the bundled fonts had loaded, seconds at 1 MB booked to the grid stage. The restyle still
  // happens at the next style read, but now while the article holds only the first screens.
  await shell.mark('fonts_ready', Date.now());
  document.title = `${file.split('/').pop()} — Marxy`;
  // The grid pass also builds the block list the reading position is read from.
  keepOnGrid(doc);
  landOn(landing);
  const evidence = measure.renderEvidence(doc);
  await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
  return evidence;
}

async function finishDocumentOpen(file: string, doc: HTMLElement, at?: number): Promise<void> {
  await typesetDocument(doc);
  const shouldRestore = restoreAfterTypeset;
  restoreAfterTypeset = false;
  if (shouldRestore) await restorePersistedPositionIfNeeded();
  const current = mount;
  await whenIdle(async () => {
    // Once the whole document is in (at once under the threshold); later chunks do not hold the open
    // up, so the reader can switch mode or open another document while they are appended (A-02).
    const deferred = deferredStartup(file, doc);
    if (!current || current.isComplete()) await deferred();
    else void afterComplete(current, () => whenIdle(deferred));
    indexing = index.ensureFor(file, bufferNow()?.bytes);
    void indexing;
    const themeDir = await themeDirFromBootConfig();
    await restartUserTheme(themeDir);
  });
  await shell.mark('position_restored', Date.now());
  if (defaultModeForPath(file) === 'source') {
    await showSource(at ?? openLanding ?? 0);
  } else {
    setModeChrome('rendered');
  }
  await maybeThemeDocumentNotice(userThemeContext(doc), file, async (dir) => {
    userThemeHandle = await adoptThemeDirectory(userThemeContext(doc), dir, userThemeHandle);
  });
  await registerDocumentWatch(file);
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
  return store.snapshot().dirty || unfoldedSourceEdits();
}

async function openReplacing(file: string, at?: number): Promise<void> {
  const doc = document.getElementById('doc')!;
  const openPath = openPathNow();
  if (openPath && file !== openPath) await flushReadingPersistence();
  if (file === openPath && state.document && at !== undefined) {
    // A heading in the document already on screen: move, do not read and set it again.
    if (viewMode === 'source') await leaveSourceForRendered();
    landOn(at);
    return;
  }
  const chunks = gate();
  try {
    await openDocumentThroughRenderMark(file, doc, at, chunks.promise);
    chunks.release();
    historyTracked = historyTracked
      .then(() => index.rootFor(file))
      .then((root) => trackDocumentOpen(file, root))
      // A failed record must not poison the chain: every later open and the quit flush wait on it.
      .catch((e: unknown) => console.warn(`marxy: history could not record ${file}: ${String(e)}`));
    await finishDocumentOpen(file, doc, at);
  } catch (e) {
    chunks.release();
    // Nothing of the last document may outlive the page that showed it.
    teardownDocument();
    state.document = null;
    announceDocument();
    setModeChrome('rendered');
    // A read error names the path, and a path is not markup.
    const message = document.createElement('p');
    message.textContent = String(e);
    doc.replaceChildren(message);
  }
}

/** The pieces a launch with no document chooses from; null is the bundled Commonplace (MARXY-256). */
let frontispiecePieces: readonly PieceSource[] | null = null;

/**
 * One Commonplace piece, through the one parse and the sanitiser, into `#doc` (MARXY-257). Returns its
 * name, or null when there is none to show — no pieces bundled, or one that could not be read — and
 * the caller shows the hint instead.
 */
async function showFrontispiece(doc: HTMLElement): Promise<string | null> {
  try {
    const frontispiece = await import('./frontispiece/index.ts');
    const piece = await frontispiece.renderPiece(frontispiecePieces ?? frontispiece.bundledPieces);
    if (!piece) return null;
    assignHtml(doc, piece.html);
    stripNonLocalImages(doc, piece.file);
    frontispiece.shape(doc, piece.matter);
    return piece.name;
  } catch (e) {
    console.warn(`marxy: no frontispiece: ${String(e)}`);
    doc.replaceChildren();
    return null;
  }
}

/**
 * The frontispiece set like a page, after `no_document`: the grid pass and the typesetter for its
 * prose (the typesetter never sets verse), and highlighting for a code piece. The next open's
 * teardown stops all of it, as it does a document's.
 */
function setFrontispiece(doc: HTMLElement): void {
  keepOnGrid(doc);
  startTypeset(doc);
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
  const doc = document.getElementById('doc')!;
  // Harness-only: the negative test that `#doc { visibility: hidden }` is not first readable text.
  // The flag only hides the element; refusing `first_text` is the visibility check below, not the flag.
  if (launchArgs.includes('--smoke-hide-doc')) doc.style.visibility = 'hidden';

  // No document means no `first_text`: nothing was read, so a launch like this must not be able to
  // hand the startup measurement a cold-start number.
  // A passage from the Commonplace is shown, not opened: no path, no buffer, no watch, no Source mode
  // and no reading position, so the palette and every open replace it as they would the hint.
  if (!file) {
    await applyReaderConfigOnce();
    const piece = await showFrontispiece(doc);
    if (!piece) assignHtml(doc, '<p class="marxy-empty">Open a markdown file: <code>marxy README.md</code></p>');
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
  const evidence = await openDocumentThroughRenderMark(file, doc, undefined, chunks.promise);
  const renderedAt = Date.now();

  const outcome = await measure.waitForFirstText(doc, evidence, after, renderedAt);
  if (outcome !== 'painted') return measure.finish(1);
  chunks.release();
  await ensurePersistenceLoaded(dirname(file));
  await finishDocumentOpen(file, doc);
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
  persistenceLoaded = false;
  positionPersistence = null;
  restoreAfterTypeset = false;
  scrollPersistenceInstalled = false;
  resetPaletteHistoryMirror();
  chain = Promise.resolve();
  const base = injected;
  shell = {
    ...base,
    quit: async (code) => {
      await flushAllPersistence();
      return base.quit(code);
    },
  };
  trust = createTrustController({
    shell,
    currentPath: openPathNow,
    buffer: bufferNow,
    position: (path) => currentPosition(readingScroller(), state.document?.blocks ?? [], path, viewMode),
    rerender: (at) => rerenderFromBuffer(document.getElementById('doc')!, at),
    showSource,
  });
  index = createIndexService(indexShellFor(shell));
  indexing = Promise.resolve();
  historyTracked = Promise.resolve();
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
  const handle: AppHandle = {
    get state() { return state; },
    dispatch() {},
    commands() { return appCommands(); },
    shell,
    ready,
    open: replaceOpenDocument,
    currentPath: openPathNow,
    sourceHarness,
    debugCounts: () => ({ typesetters: liveTypesetters.size, resizeObservers: liveResizeObservers }),
    openDocument: openDocumentState,
    document: () => store,
    save: saveOpenDocument,
    onDocumentChange(cb) {
      documentListeners.add(cb);
      return () => documentListeners.delete(cb);
    },
    commitEdit,
    contentComplete: () => mount?.complete ?? Promise.resolve(),
    toggleMode: toggleViewMode,
    jumpToSource,
    relayout: () => relayoutKeepingReader(),
    pinPaletteDocument(path: string) {
      const palette = (window as Window & { __marxyPalette?: { session: import('./palette/session.ts').PaletteSession } })
        .__marxyPalette;
      pinDocumentOnPaletteSession(palette?.session ?? emptySession('/'), path);
    },
    index,
  };
  // The registry's one key dispatcher runs wherever the app does (it used to be Mod+E's own listener
  // here); the palette mount and the selection harness call the same idempotent install.
  setAppHandle(handle);
  installCommandKeys();
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
