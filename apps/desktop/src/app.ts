// Application startup: given a shell, open the document, render it, and emit startup marks (MARXY-95).
import { createBuffer, contentHash, parseMarkdown, type Buffer, type Document } from '@marxy/core';
import { applyWatchToOpenDocument } from '@marxy/core/src/position/reload.ts';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { IndexEntry } from '@marxy/core';
import type { Shell } from '@marxy/shell-api';
import { buildBlocks, buildNodeMap, nodeFor, type BlockList, type NodeMap } from './render/post.ts';
import { stripNonLocalImages } from './render/images.ts';
import { blockedContentNotice } from './notices/blocked.ts';
import { diskChangedEditsKeptNotice, fileRemovedNotice } from './notices/disk.ts';
import { clearNotices } from './notices/index.ts';
import { leaveSourceMode } from './source/buffer-commit.ts';
import { applyWeightOffset, platformOf } from './theme/offset.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme/theme-document.ts';
import { startUserTheme, themeDirFromConfig, type UserThemeContext } from './theme/user-theme.ts';
import { isDocVisible, waitForEnginePaint } from './paint-signal.mjs';
import { type ApplyImagesContext } from './render/images.ts';
import { type DeferredStartupContext, runDeferredStartup, whenIdle } from './startup/idle-work.ts';
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
  'readFile' | 'writeFileAtomic' | 'watch' | 'platform' | 'startupMarks' | 'readDir'
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
  /**
   * Called whenever the open document's bytes or identity change — an open, a reload from disk, an
   * edit folded in from Source, an operation — and with null when nothing is open. Every holder of
   * document state follows the app through this, instead of keeping a copy that goes stale.
   */
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /**
   * Saves an operation's result: writes `buffer` to disk, then makes it the open document and renders
   * it through the same path an open takes. Refused if a different document is open by then.
   */
  commitEdit(buffer: Buffer): Promise<void>;
  /** Pin or unpin a document for palette history (same as Mod+. on a document row). */
  pinPaletteDocument(path: string): void;
};

const t0 = Date.now();

const state: { document: OpenDocument | null } = { document: null };

let openPath: string | null = null;
let documentBuffer: Buffer | null = null;
const documentListeners = new Set<(open: OpenDocumentState | null) => void>();

function openDocumentState(): OpenDocumentState | null {
  if (!openPath || !documentBuffer || !state.document) return null;
  return { path: openPath, buffer: documentBuffer, ast: state.document.ast, nodeMap: state.document.nodeMap };
}

/** Tell every holder of document state what is open now (see AppHandle.onDocumentChange). */
function announceDocument(): void {
  const open = openDocumentState();
  for (const cb of documentListeners) cb(open);
}
/** Bytes last read from disk for the open path; local edits are detected against this. */
let bytesOnDisk: Uint8Array | null = null;
let documentWatch: { close(): void } | null = null;
let viewMode: 'rendered' | 'source' = 'rendered';
let sourceEditor: MountedSourceEditor | null = null;
let keysInstalled = false;
let lastReadingByteOffset = 0;
let lastReadingFraction = 0;
let modeToggleBusy = false;
let positionPersistence: PositionPersistence | null = null;
let persistenceLoaded = false;
let scrollPersistenceInstalled = false;
let restoreAfterTypeset = false;

function readingScroller(): HTMLElement {
  return document.documentElement;
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
  if (!documentBuffer) throw new Error('source editor requires an open buffer');
  const { createSourceEditor } = await import('./source/editor.ts');
  sourceEditor = await createSourceEditor({ parent: sourceMount(), buffer: documentBuffer, lineNumbers: false });
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
  if (state.document && openPath) {
    // Block positions must be measured with the article laid out, not from whatever a hidden pass saw.
    snap(document.getElementById('doc')!);
    restoreScrollToPosition(readingScroller(), state.document.blocks, {
      path: openPath,
      byteOffset,
      fraction,
      mode: 'rendered',
    });
  }
}

async function enterSourceFromRendered(): Promise<void> {
  if (!documentBuffer || !state.document || !openPath) return;
  const pos = currentPosition(readingScroller(), state.document.blocks, openPath, 'rendered');
  lastReadingByteOffset = pos.byteOffset;
  lastReadingFraction = pos.fraction;
  await showSource(pos.byteOffset);
}

async function leaveSourceForRendered(): Promise<void> {
  if (!sourceEditor || !documentBuffer) return;
  const docText = sourceEditor.docText();
  const left = leaveSourceMode(documentBuffer, docText);
  documentBuffer = left.buffer;
  let byteOffset = lastReadingByteOffset;
  let fraction = lastReadingFraction;
  if (left.changed) {
    const { sourceVisibleByteOffset } = await import('./source/mode-switch.ts');
    sourceEditor.replaceBuffer(documentBuffer);
    byteOffset = sourceVisibleByteOffset(documentBuffer, sourceEditor.view as never);
    fraction = 0;
    // The AST, the node map and the blocks were built from the old bytes; an operation resolved
    // through them now would splice at offsets that no longer name what the reader sees.
    rerenderFromBuffer(document.getElementById('doc')!);
  }
  lastReadingByteOffset = byteOffset;
  lastReadingFraction = fraction;
  await showRendered(byteOffset, fraction);
}

async function toggleViewMode(): Promise<void> {
  if (modeToggleBusy || !documentBuffer) return;
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

function installKeyDispatcher(): void {
  if (keysInstalled) return;
  keysInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    if (e.key !== 'e' && e.key !== 'E') return;
    e.preventDefault();
    void toggleViewMode();
  });
}

function sourceHarness(): ReturnType<AppHandle['sourceHarness']> {
  if (!documentBuffer || !openPath) return null;
  const byteOffset =
    viewMode === 'rendered' && state.document
      ? currentPosition(readingScroller(), state.document.blocks, openPath, 'rendered').byteOffset
      : lastReadingByteOffset;
  return { mode: viewMode, bufferHash: contentHash(documentBuffer.bytes), byteOffset };
}

/**
 * Counts animation frames from the moment the script runs, independently of anything below. The
 * paint mark reports how many frames passed between the DOM mutation and `first_text`, and the CLI
 * smoke check asserts that count is at least two — because a mark that only *claims* to be after
 * the paint would silently make every cold-start number optimistic (ADR-0013). The counter lives
 * out here, not inside waitForEnginePaint(), so that a wait which never actually waited still
 * reports frames=0 and fails the check instead of passing quietly.
 */
let framesObserved = 0;
let observing = true;
const observeFrame = () => { framesObserved += 1; if (observing) requestAnimationFrame(observeFrame); };
requestAnimationFrame(observeFrame);

/** Sanitised (or empty-state) HTML into `#doc`. `app.ts` is in registry.innerHtmlAllowedIn. */
function assignHtml(doc: HTMLElement, html: string): void {
  doc.innerHTML = html;
}

interface RenderEvidence { readonly blocks: number; readonly chars: number; readonly heading: string }

/** Evidence that the document actually reached the DOM, for the CLI smoke check. */
function renderEvidence(doc: HTMLElement): RenderEvidence {
  return {
    blocks: doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote').length,
    chars: doc.textContent?.length ?? 0,
    heading: doc.querySelector('h1,h2,h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
  };
}

/** The arguments this launch was given, kept so the error path can honour the flag too. */
let launchArgs: readonly string[] = [];

/** Delivers idle-built index entries to whoever mounted the palette (main.ts). */
let deliverIndex: ((entries: readonly IndexEntry[]) => void) | undefined;

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
    onIndexLoaded: deliverIndex,
    openedBytes: documentBuffer?.bytes,
    onLayoutChanged: () => snap(doc),
  };
}

/** The shell this launch is using; set by startApp, never imported from tauri.ts. */
let shell: AppShell;

/** Asset-protocol roots allowed this session (post-pass 3). */
const scopedAssetRoots = new Set<string>();

/** True when a harness launched us: the startup harness sets the env var, the flag is for a person. */
async function inHarness(): Promise<boolean> {
  if (launchArgs.includes('--quit-after-paint')) return true;
  try {
    return Boolean((await shell.startupMarks()).quit_after_paint);
  } catch {
    return false;
  }
}

/**
 * Every path ends here: the frame observer stops so an idle window is not woken once a frame, and a
 * harness launch exits with a code that says whether it painted. Harness mode is resolved here rather
 * than before the render so that its IPC round trip stays out of the measured path.
 */
let settleReady: (code: number) => void = () => {};

async function finish(code: number): Promise<void> {
  observing = false;
  settleReady(code);
  if (await inHarness()) await shell.quit(code);
}

/**
 * The grid pass (ADR-0030), now and whenever heights can change under it: when fonts arrive and
 * when the column is resized. Reading position is re-read after each, because tops move.
 */
let typeset: TypesetController | null = null;
let userThemeHandle: { stop(): void } | null = null;

function userThemeContext(doc: HTMLElement): UserThemeContext {
  return {
    shell,
    article: doc,
    getTypeset: () => typeset,
    readingScroller,
    getOpenPath: () => openPath,
    getBlocks: () => state.document?.blocks ?? null,
  };
}

async function restartUserTheme(dir: string | null): Promise<void> {
  userThemeHandle?.stop();
  userThemeHandle = await startUserTheme(userThemeContext(document.getElementById('doc')!), dir);
}

function snap(article: HTMLElement): void {
  cancelScheduledSnap();
  lastSnapAt = performance.now();
  snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight));
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

function releaseAnchor(): void {
  anchor = null;
}

function listenForReaderScroll(): void {
  if (anchorListening) return;
  anchorListening = true;
  // Input, not `scroll`: the anchor's own scrolls must not release it.
  for (const type of ['wheel', 'touchstart', 'mousedown', 'keydown'] as const) {
    window.addEventListener(type, releaseAnchor, { capture: true, passive: true });
  }
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
  if (anchor === null || !state.document || !openPath || viewMode !== 'rendered') return;
  const block = blockContaining(state.document, anchor);
  if (block === undefined) return;
  restoreScrollToPosition(readingScroller(), state.document.blocks, {
    path: openPath,
    byteOffset: block.start,
    fraction: 0,
    mode: 'rendered',
  });
}

function landOn(at: number | undefined): void {
  if (at === undefined) return;
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

function cancelScheduledSnap(): void {
  if (snapTimer !== 0) clearTimeout(snapTimer);
  if (snapFrame !== 0) cancelAnimationFrame(snapFrame);
  snapTimer = 0;
  snapFrame = 0;
}

function scheduleSnap(article: HTMLElement): void {
  if (snapTimer !== 0 || snapFrame !== 0) return;
  const wait = Math.max(0, lastSnapAt + SNAP_INTERVAL_MS - performance.now());
  snapTimer = window.setTimeout(() => {
    snapTimer = 0;
    snapFrame = requestAnimationFrame(() => {
      snapFrame = 0;
      snap(article);
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

function disconnectResizeObserver(): void {
  if (resizeObserver) liveResizeObservers -= 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function keepOnGrid(article: HTMLElement): void {
  snap(article);
  void document.fonts.ready.then(() => snap(article));
  let pending = 0;
  let width = article.clientWidth;
  disconnectResizeObserver();
  liveResizeObservers += 1;
  const laidOut = () => !article.hidden && article.clientWidth > 0;
  resizeObserver = new ResizeObserver(() => {
    // Hidden (Source mode) the article is zero-width: measuring now would zero every block position.
    if (!laidOut() || article.clientWidth === width) return;
    width = article.clientWidth;
    clearTimeout(pending);
    // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
    pending = window.setTimeout(() => {
      if (!laidOut()) return;
      if (typeset) typeset.relayout('resize');
      else snap(article);
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
  documentWatch?.close();
  documentWatch = null;
  bytesOnDisk = null;
  releaseAnchor();
  destroyTypeset();
  disconnectResizeObserver();
  cancelScheduledSnap();
  sourceEditor?.destroy();
  sourceEditor = null;
  document.getElementById('marxy-source')?.replaceChildren();
}

function hasLocalEdits(diskBytes: Uint8Array): boolean {
  if (!documentBuffer) return false;
  // Unfolded edits in the editor, and then — whatever the mode — edits already folded into the buffer
  // by an earlier trip back to Rendered, which the editor's text alone no longer shows.
  if (viewMode === 'source' && sourceEditor && leaveSourceMode(documentBuffer, sourceEditor.docText()).changed) return true;
  if (contentHash(documentBuffer.bytes) === contentHash(diskBytes)) return false;
  if (!bytesOnDisk) return true;
  return contentHash(documentBuffer.bytes) !== contentHash(bytesOnDisk);
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

async function reloadOpenFromDisk(bytes: Uint8Array, position: ReadingPosition): Promise<void> {
  if (!openPath) return;
  const t0 = performance.now();
  const doc = document.getElementById('doc')!;
  // A held palette jump names a byte offset in the old bytes; the reading position below is the
  // one that was mapped through the edit.
  releaseAnchor();
  shell.recordRead?.(openPath, bytes);
  bytesOnDisk = bytes.slice();
  documentBuffer = createBuffer(openPath, bytes);
  sourceEditor?.replaceBuffer(documentBuffer);
  rerenderFromBuffer(doc);
  if (state.document) restoreScrollToPosition(readingScroller(), state.document.blocks, position);
  await typesetDocument(doc);
  const ms = performance.now() - t0;
  await shell.mark('live_reload', Date.now(), `ms=${ms.toFixed(1)}`);
}

async function handleDocumentWatch(events: readonly WatchEvent[]): Promise<void> {
  if (!openPath || !documentBuffer || !state.document) return;
  const path = openPath;
  const position = currentPosition(readingScroller(), state.document.blocks, path, viewMode);
  const diskBytes = await readOpenFileWithRetry(path);
  const update = applyWatchToOpenDocument(
    events,
    position,
    diskBytes,
    documentBuffer.bytes,
  );
  if (update.action === 'ignore') return;
  if (update.action === 'gone') {
    fileRemovedNotice();
    return;
  }
  if (update.action === 'follow') {
    // Already inside `serially`: going through replaceOpenDocument would queue this open behind the
    // task waiting for it, and every open, mode switch and reload after it would wait forever.
    await openReplacing(update.path, update.position.byteOffset);
    return;
  }
  if (diskBytes === null) {
    fileRemovedNotice();
    return;
  }
  if (contentHash(diskBytes) === contentHash(documentBuffer.bytes)) return;
  if (hasLocalEdits(diskBytes)) {
    diskChangedEditsKeptNotice();
    return;
  }
  await reloadOpenFromDisk(diskBytes, update.position);
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

/** Write an operation's result and show it through the one render path (AppHandle.commitEdit). */
function commitEdit(next: Buffer): Promise<void> {
  return serially(async () => {
    if (!openPath || next.path !== openPath || !state.document) throw new Error('the edited document is no longer open');
    const doc = document.getElementById('doc')!;
    const position = currentPosition(readingScroller(), state.document.blocks, openPath, 'rendered');
    await shell.writeFileAtomic(openPath, next.bytes);
    bytesOnDisk = next.bytes.slice();
    documentBuffer = next;
    sourceEditor?.replaceBuffer(documentBuffer);
    releaseAnchor();
    rerenderFromBuffer(doc);
    if (state.document) restoreScrollToPosition(readingScroller(), state.document.blocks, position);
    await typesetDocument(doc);
  });
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
  await controller.ready;
  const { viewportMs, hyphenationLoadMs, typeset: set } = controller.stats;
  await shell.mark('typeset_viewport', Date.now(), `ms=${viewportMs.toFixed(1)} hyphenation_load_ms=${hyphenationLoadMs.toFixed(1)} set=${set}`);
}

/**
 * The page again from `documentBuffer`, after its bytes changed under the open document (an edit in
 * Source). Same parse, render and passes as an open; the reading position is the caller's.
 */
function rerenderFromBuffer(doc: HTMLElement): void {
  if (!documentBuffer || !openPath) return;
  const file = openPath;
  const ast = parseMarkdown(documentBuffer.bytes, { file });
  const { html, blockedImages } = renderDocumentSafeHtml(ast);
  destroyTypeset();
  assignHtml(doc, html);
  state.document = { ast, html, nodeMap: buildNodeMap(ast), blocks: [] };
  announceDocument();
  stripNonLocalImages(doc, file);
  blockedContentNotice(blockedImages);
  snap(doc);
  startTypeset(doc);
  void whenIdle(() =>
    runDeferredStartup(deferredStartupContext(file, doc, { shell, scopedRoots: scopedAssetRoots })),
  );
}

/** Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183). */
async function flushReadingPersistence(): Promise<void> {
  if (!positionPersistence || !openPath || !state.document) return;
  const pos = currentPosition(readingScroller(), state.document.blocks, openPath, viewMode);
  positionPersistence.note(openPath, pos);
  await positionPersistence.flush();
}

async function flushPaletteHistory(): Promise<void> {
  const palette = (window as Window & { __marxyPalette?: { session: import('./palette/session.ts').PaletteSession } })
    .__marxyPalette;
  if (!shell.configPaths) return;
  await flushPaletteHistoryFromApp({ ...shell, configPaths: shell.configPaths }, palette?.session);
}

async function flushAllPersistence(): Promise<void> {
  await flushReadingPersistence();
  await flushPaletteHistory();
}

function installScrollPersistence(): void {
  if (scrollPersistenceInstalled || !positionPersistence) return;
  scrollPersistenceInstalled = true;
  readingScroller().addEventListener(
    'scroll',
    () => {
      if (!positionPersistence || !openPath || !state.document || viewMode !== 'rendered') return;
      const pos = currentPosition(readingScroller(), state.document.blocks, openPath, 'rendered');
      positionPersistence.note(openPath, pos);
    },
    { passive: true },
  );
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
  if (!positionPersistence || !openPath || !state.document || !documentBuffer) return;
  const stored = positionPersistence.positionForOpen(openPath, documentBuffer.bytes.length);
  if (!stored) return;
  lastReadingByteOffset = stored.byteOffset;
  lastReadingFraction = stored.fraction;
  if (stored.mode === 'source') {
    await showSource(stored.byteOffset);
    return;
  }
  restoreScrollToPosition(readingScroller(), state.document.blocks, stored);
  landOn(stored.byteOffset);
  holdAnchor();
}

async function openDocumentThroughRenderMark(file: string, doc: HTMLElement, at?: number): Promise<RenderEvidence> {
  const bytes = await shell.readFile(file);
  let landing = at;
  if (landing === undefined && positionPersistence) {
    const stored = positionPersistence.positionForOpen(file, bytes.length);
    if (stored) landing = stored.byteOffset;
  }
  teardownDocument();
  openPath = file;
  bytesOnDisk = bytes.slice();
  documentBuffer = createBuffer(file, bytes);
  sourceMount();
  installKeyDispatcher();
  await shell.mark('file_read', Date.now(), `bytes=${bytes.length}`);
  const ast = parseMarkdown(bytes, { file });
  await shell.mark('parsed', Date.now());
  const { html, removed, blockedImages } = renderDocumentSafeHtml(ast);
  const nodeMap = buildNodeMap(ast);
  console.info(`marxy: sanitiser removed ${removed.length}`);
  // A different document starts with no notices (blocked.ts no longer clears the rest on every render).
  clearNotices();
  assignHtml(doc, html);
  state.document = { ast, html, nodeMap, blocks: [] };
  announceDocument();
  await shell.mark('rendered', Date.now());
  stripNonLocalImages(doc, file);
  blockedContentNotice(blockedImages);
  void doc.offsetHeight;
  await document.fonts.ready;
  await shell.mark('fonts_ready', Date.now(), `faces=${[...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}/${f.style}`).join(',')}`);
  document.title = `${file.split('/').pop()} — Marxy`;
  // The grid pass also builds the block list the reading position is read from.
  keepOnGrid(doc);
  landOn(landing);
  const evidence = renderEvidence(doc);
  await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
  return evidence;
}

async function finishDocumentOpen(file: string, doc: HTMLElement, at?: number): Promise<void> {
  await typesetDocument(doc);
  const shouldRestore = restoreAfterTypeset;
  restoreAfterTypeset = false;
  if (shouldRestore) await restorePersistedPositionIfNeeded();
  await whenIdle(async () => {
    await runDeferredStartup(deferredStartupContext(file, doc, { shell, scopedRoots: scopedAssetRoots }));
    const themeDir = await themeDirFromConfig(shell);
    await restartUserTheme(themeDir);
  });
  await shell.mark('position_restored', Date.now());
  if (defaultModeForPath(file) === 'source') {
    await showSource(at ?? 0);
  } else {
    setModeChrome('rendered');
  }
  await maybeThemeDocumentNotice(userThemeContext(doc), file, async (dir) => {
    userThemeHandle = await adoptThemeDirectory(userThemeContext(doc), dir, userThemeHandle);
  });
  await registerDocumentWatch(file);
}

function replaceOpenDocument(file: string, opts?: { at?: number }): Promise<void> {
  return serially(() => openReplacing(file, opts?.at));
}

async function openReplacing(file: string, at?: number): Promise<void> {
  const doc = document.getElementById('doc')!;
  if (openPath && file !== openPath) await flushReadingPersistence();
  if (file === openPath && state.document && at !== undefined) {
    // A heading in the document already on screen: move, do not read and set it again.
    if (viewMode === 'source') await leaveSourceForRendered();
    landOn(at);
    return;
  }
  try {
    await openDocumentThroughRenderMark(file, doc, at);
    trackDocumentOpen(file);
    await finishDocumentOpen(file, doc, at);
  } catch (e) {
    // Nothing of the last document may outlive the page that showed it.
    teardownDocument();
    state.document = null;
    documentBuffer = null;
    openPath = null;
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
  // Before anything is laid out, so no weight is set twice. The shell-api has webkitVersion() since
  // MARXY-94, but AppShell and tauri.ts do not implement it, so Linux takes the table's unknown-version row.
  const offset = applyWeightOffset(document.documentElement, platformOf(navigator.userAgent), null);
  void shell.mark('weight_offset', Date.now(), `offset=${offset}`);
  launchArgs = launchArgs.length > 0 ? launchArgs : await shell.args();
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
    const piece = await showFrontispiece(doc);
    if (!piece) assignHtml(doc, '<p class="marxy-empty">Open a markdown file: <code>marxy README.md</code></p>');
    await shell.mark('no_document', Date.now(), piece ? `piece=${piece}` : undefined);
    if (piece) setFrontispiece(doc);
    return finish(0);
  }

  const after = performance.now();
  const evidence = await openDocumentThroughRenderMark(file, doc);
  const renderedAt = Date.now();

  // Nothing on screen is not "first readable text": a build whose rendering silently produced nothing
  // must not be able to hand the startup measurement a number either — and it has no paint to wait for,
  // so this runs before the wait. The `no_text` mark also disarms the shell's paint deadline.
  if (evidence.blocks === 0 || evidence.chars === 0) {
    await shell.mark('no_text', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars}`);
    return finish(1);
  }

  // Hidden text is still in `textContent` and frames still tick; that is not a paint (MARXY-71).
  if (!isDocVisible(doc)) {
    await shell.mark('no_paint', Date.now(), 'reason=not-visible');
    return finish(1);
  }

  // Counted from here, so the number covers the wait and not the render mark's IPC round trip.
  // The wait has no deadline of its own: some environments deliver no frames and no paint entries
  // (a Mac in dark wake, a locked screen) and there it never resolves. A harness launch is ended
  // by the shell's deadline instead, because WebKit aligns in-page timers in a window that cannot
  // paint to about 15 s. A reader is left waiting and gets the document when the display wakes.
  const framesAtRender = framesObserved;
  const { signal } = await waitForEnginePaint({ after });
  // One timestamp for both marks: the paint detail costs an IPC round trip and `first_text` must not
  // be pushed later by the cost of reporting it.
  const paintedAt = Date.now();
  const frames = framesObserved - framesAtRender;

  await shell.mark('painted', paintedAt, `frames=${frames} since_render_ms=${paintedAt - renderedAt} signal=${signal}`);
  // Two fields exactly: the acceptance criterion names this line, and the startup harness parses it.
  // Anything the check needs beyond the timestamp goes on the `painted` line above.
  await shell.mark('first_text', paintedAt);
  await ensurePersistenceLoaded(dirname(file));
  await finishDocumentOpen(file, doc);
  return finish(0);
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
    onIndexLoaded?: (entries: readonly IndexEntry[]) => void;
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
  deliverIndex = opts?.onIndexLoaded;
  launchArgs = opts?.argv ? [...opts.argv] : [];
  frontispiecePieces = opts?.pieces ?? null;
  injected.onOpenFiles?.((paths) => {
    const file = paths.find((p) => p.length > 0 && !p.startsWith('-'));
    if (file) void replaceOpenDocument(file);
  });
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  settleReady = () => resolveReady();
  const handle: AppHandle = {
    get state() { return state; },
    dispatch() {},
    commands() { return []; },
    shell,
    ready,
    open: replaceOpenDocument,
    currentPath: () => openPath,
    sourceHarness,
    debugCounts: () => ({ typesetters: liveTypesetters.size, resizeObservers: liveResizeObservers }),
    openDocument: openDocumentState,
    onDocumentChange(cb) {
      documentListeners.add(cb);
      return () => documentListeners.delete(cb);
    },
    commitEdit,
    pinPaletteDocument(path: string) {
      const palette = (window as Window & { __marxyPalette?: { session: import('./palette/session.ts').PaletteSession } })
        .__marxyPalette;
      pinDocumentOnPaletteSession(palette?.session ?? emptySession('/'), path);
    },
  };
  try {
    await serially(boot);
  } catch (e) {
    document.getElementById('doc')!.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await finish(1);
  }
  return handle;
}
