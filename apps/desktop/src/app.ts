// Application startup: given a shell, open the document, render it, and emit startup marks (MARXY-95).
import { createBuffer, contentHash, parseMarkdown, type Buffer, type Document } from '@marxy/core';
import { applyWatchToOpenDocument } from '@marxy/core/src/position/reload.ts';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { Shell } from '@marxy/shell-api';
import { buildBlocks, buildNodeMap, nodeFor, type BlockList, type NodeMap } from './render/post.ts';
import { stripNonLocalImages } from './render/images.ts';
import { blockedContentNotice } from './notices/blocked.ts';
import { diskChangedEditsKeptNotice, fileRemovedNotice } from './notices/disk.ts';
import { ensureNoticesRegion } from './notices/index.ts';
import { leaveSourceMode } from './source/buffer-commit.ts';
import { applyWeightOffset, platformOf } from './theme/offset.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme/theme-document.ts';
import { startUserTheme, themeDirFromConfig, type UserThemeContext } from './theme/user-theme.ts';
import { isDocVisible, waitForEnginePaint } from './paint-signal.mjs';
import { runDeferredStartup, whenIdle } from './startup/idle-work.ts';
import { currentPosition, restoreScrollToPosition } from './position/index.ts';
import { defaultModeForPath } from './source/default-mode.ts';

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
export type AppShell = Pick<Shell, 'readFile' | 'writeFileAtomic' | 'watch' | 'platform' | 'startupMarks'> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
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
};

const t0 = Date.now();

const state: { document: OpenDocument | null } = { document: null };

let openPath: string | null = null;
let documentBuffer: Buffer | null = null;
/** Bytes last read from disk for the open path; local edits are detected against this. */
let bytesOnDisk: Uint8Array | null = null;
let documentWatch: { close(): void } | null = null;
let viewMode: 'rendered' | 'source' = 'rendered';
let sourceEditor: MountedSourceEditor | null = null;
let keysInstalled = false;
let lastReadingByteOffset = 0;
let lastReadingFraction = 0;
let modeToggleBusy = false;

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
  resizeObserver = new ResizeObserver(() => {
    if (article.clientWidth === width) return;
    width = article.clientWidth;
    clearTimeout(pending);
    // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
    pending = window.setTimeout(() => (typeset ? typeset.relayout('resize') : snap(article)), 100);
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
  if (viewMode === 'source' && sourceEditor) {
    return leaveSourceMode(documentBuffer, sourceEditor.docText()).changed;
  }
  if (contentHash(documentBuffer.bytes) === contentHash(diskBytes)) return false;
  if (!bytesOnDisk) return true;
  return contentHash(documentBuffer.bytes) !== contentHash(bytesOnDisk);
}

async function readOpenFileWithRetry(path: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await shell.readFile(path);
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
    await replaceOpenDocument(update.path, { at: update.position.byteOffset });
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
  documentWatch = await shell.watch(dirname(file), (events) => {
    void serially(() => handleDocumentWatch(events));
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
 * frame, then the viewport set by Knuth–Plass, and the rest in idle time. Hyphenation and hanging
 * punctuation are MARXY-24.
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
  stripNonLocalImages(doc, file);
  blockedContentNotice(blockedImages);
  snap(doc);
  startTypeset(doc);
  void whenIdle(() =>
    runDeferredStartup({ shell, file, doc, imageCtx: { shell, scopedRoots: scopedAssetRoots } }),
  );
}

/** Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183). */
async function openDocumentThroughRenderMark(file: string, doc: HTMLElement, at?: number): Promise<RenderEvidence> {
  const bytes = await shell.readFile(file);
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
  ensureNoticesRegion();
  assignHtml(doc, html);
  state.document = { ast, html, nodeMap, blocks: [] };
  await shell.mark('rendered', Date.now());
  stripNonLocalImages(doc, file);
  blockedContentNotice(blockedImages);
  void doc.offsetHeight;
  await document.fonts.ready;
  await shell.mark('fonts_ready', Date.now(), `faces=${[...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}/${f.style}`).join(',')}`);
  document.title = `${file.split('/').pop()} — Marxy`;
  // The grid pass also builds the block list the reading position is read from.
  keepOnGrid(doc);
  landOn(at);
  const evidence = renderEvidence(doc);
  await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
  return evidence;
}

async function finishDocumentOpen(file: string, doc: HTMLElement): Promise<void> {
  await typesetDocument(doc);
  await shell.mark('position_restored', Date.now());
  await whenIdle(async () => {
    await runDeferredStartup({
      shell,
      file,
      doc,
      imageCtx: { shell, scopedRoots: scopedAssetRoots },
    });
    const themeDir = await themeDirFromConfig(shell);
    await restartUserTheme(themeDir);
  });
  if (defaultModeForPath(file) === 'source') {
    await showSource(0);
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
  if (file === openPath && state.document && at !== undefined) {
    // A heading in the document already on screen: move, do not read and set it again.
    if (viewMode === 'source') await leaveSourceForRendered();
    landOn(at);
    return;
  }
  try {
    await openDocumentThroughRenderMark(file, doc, at);
    await finishDocumentOpen(file, doc);
  } catch (e) {
    // Nothing of the last document may outlive the page that showed it.
    teardownDocument();
    state.document = null;
    documentBuffer = null;
    openPath = null;
    setModeChrome('rendered');
    // A read error names the path, and a path is not markup.
    const message = document.createElement('p');
    message.textContent = String(e);
    doc.replaceChildren(message);
  }
}

async function boot(): Promise<void> {
  await shell.mark('script_start', t0);
  // Before anything is laid out, so no weight is set twice. The WebKitGTK version arrives with the
  // shell-api amendment (MARXY-94); until then Linux takes the table's unknown-version row.
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
  if (!file) {
    assignHtml(doc, '<p class="marxy-empty">Open a markdown file: <code>marxy README.md</code></p>');
    await shell.mark('no_document', Date.now());
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
  await finishDocumentOpen(file, doc);
  return finish(0);
}

/**
 * Everything main.ts used to do after it had a shell. `opts.argv` overrides `shell.args` so the
 * browser harness can name a document without Tauri.
 */
export async function startApp(injected: AppShell, opts?: { argv?: readonly string[] }): Promise<AppHandle> {
  shell = injected;
  launchArgs = opts?.argv ? [...opts.argv] : [];
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
    shell: injected,
    ready,
    open: replaceOpenDocument,
    currentPath: () => openPath,
    sourceHarness,
    debugCounts: () => ({ typesetters: liveTypesetters.size, resizeObservers: liveResizeObservers }),
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
