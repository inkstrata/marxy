// The per-article view (B-13; ADR-0037 Amendment 1, point 2): everything about showing one document
// store in one article. It owns the render into the article, the mode and the Source editor, the
// typesetter, grid scheduling, the anchor, the resize observer, the block list and the mount. The
// store owns the bytes; the view subscribes to the store it shows and sets the page again when they
// change. Nothing here is held at module scope, so a second view can be created beside the first.

import { byteToUtf16, contentHash, utf16ToByte, type Buffer, type Document } from '@marxy/core';
import { offsetThroughEdit } from '@marxy/core/src/position/restore.ts';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import { attach, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { AppShell } from '../app.ts';
import type { AppContext } from '../commands/registry.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import { wireArticle } from '../commands/document.ts';
import type { DocumentSnapshot, DocumentStore, Transition } from '../document/store.ts';
import { currentPosition as positionOf, restoreScrollToPosition } from '../position/index.ts';
import type { ScrollerGeometry } from '../position/position.ts';
import { resolveImageRoot, stripNonLocalImages } from '../render/images.ts';
import { buildBlocks, nodeFor, type BlockList, type NodeMap } from '../render/post.ts';
import { mountProgressively, type ProgressiveMount } from '../render/progressive.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { diskChangedEditsKeptNotice } from '../notices/disk.ts';
import { notify, SOURCE_HELD_APART } from '../notices/index.ts';
import { leaveSourceMode } from '../source/buffer-commit.ts';
import { type CmStateLike, cmPosToUtf16, utf16ToCmPos } from '../source/cm-position.ts';
import { type DeferredStartupContext, runDeferredStartup, whenIdle } from '../startup/idle-work.ts';
import type { LaunchMeasure, RenderEvidence } from '../startup/measure.ts';
import type { TrustController } from '../trust/controller.ts';

/** Minimal surface used by the view; CM6 types stay on the lazy chunk (MARXY-33). */
interface MountedSourceEditor {
  docText(): string;
  scrollToByte(byteOffset: number): void;
  /** The buffer the editor maps bytes through; its text is kept when it already matches. */
  replaceBuffer(buffer: Buffer): void;
  /** The buffer the editor last took (its text was equal to this one's when it was set). */
  readonly buffer: Buffer;
  destroy(): void;
  readonly view: {
    scrollDOM: HTMLElement;
    lineBlockAtHeight(height: number): { from: number };
    readonly state: CmStateLike & { readonly selection: { readonly main: { readonly anchor: number; readonly head: number } } };
    dispatch(spec: { selection: { anchor: number; head: number } }): void;
  };
}

export interface OpenDocument {
  readonly ast: Document;
  readonly html: string;
  /** Rendered element → AST node, through its byte range (ADR-0023). */
  readonly nodeMap: NodeMap;
  /** Refreshed whenever layout moves them; built once here for now (MARXY-38 reads them). */
  blocks: BlockList;
}

/**
 * Where a view draws. In the app the article is `#doc`, the scroller `document.documentElement`, the
 * Source mount `#marxy-source` and the mode host `document.body`, so the DOM is what it was before B-13.
 * An article inside a `section.marxy-pane` carries its mode on that section instead (D-11; see
 * `writeMode`).
 */
export interface ViewHost {
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  readonly sourceHost: HTMLElement;
  /** Carries `data-marxy-mode` when the article is in no `section.marxy-pane` (a harness page). */
  readonly modeHost: HTMLElement;
}

export interface RenderedViewDeps {
  readonly shell: AppShell;
  readonly trust: TrustController;
  /** Asset-protocol roots allowed this session: one set per app instance, shared by its views. */
  readonly assetRoots: Set<string>;
  readonly measure: LaunchMeasure;
  /** The repository root a document's images and links resolve against (the palette index's answer). */
  rootFor(path: string): Promise<string>;
  /** The selection on this view's article: told each time the page is set again. */
  selection?(): RenderedSelection | null;
  /** The registry context commands on this article run in (the task click, the harness hooks). */
  context?(): AppContext;
  /** The title, after a change settled or Source text was folded in. */
  refreshTitle?(): Promise<void>;
}

export type SourceHarness = {
  readonly mode: 'rendered' | 'source';
  readonly bufferHash: string;
  readonly byteOffset: number;
};

export interface RenderedView {
  /** Where the view was made to draw; `host.scroller` is the scroller it started on. */
  readonly host: ViewHost;
  /** What the view scrolls now: the window with one pane, its own pane with two (D-05). */
  readonly scroller: HTMLElement;
  /**
   * Scroll `next` from now on, keeping the reader's place (read from where the old scroller was last
   * seen) or holding `position` when given. `pane/scroll.ts` calls it as a second pane comes and goes.
   */
  rebindScroller(next: HTMLElement, position?: ReadingPosition): void;
  /** `cb` on each scroll of the view's scroller, whichever it is now; returns the unsubscribe. */
  onScroll(cb: () => void): () => void;
  /**
   * Shows `store` in the article: subscribes to it, renders its snapshot through the one mount (the
   * first screens from `at` down now, the rest in idle chunks once `start` settles), sets the grid and
   * lands on `at`. Whatever was shown before is cleared first. `onMounted` runs once the first screens
   * are in and the selection has been told, before the `rendered` mark.
   */
  show(store: DocumentStore, opts?: { at?: number; start?: Promise<unknown>; onMounted?: () => void }): Promise<RenderEvidence>;
  /** The store shown, or null. */
  store(): DocumentStore | null;
  /** The page again from the shown store's snapshot (a trust change); `at` lands the mount and, given a fraction, is restored. */
  rerender(at?: number | Pick<ReadingPosition, 'byteOffset' | 'fraction'>): void;
  /** The page again, typeset and held at the reader's place, as an edit gets (`commitEdit` of unchanged bytes). */
  repaint(): void;
  /** Resolves once the last repaint's first typeset pass and the title are done. */
  settled(): Promise<void>;
  /** A reload's position, mapped through the change by the watcher, for the repaint the reload causes. */
  expectReloadAt(position: ReadingPosition | null): void;
  /** Where the reader is: the line on the reading line in Source, else the block position in this mode. */
  position(): ReadingPosition;
  /** The reader's place while Source shows; null in Rendered or before the editor loaded. */
  sourcePosition(): ReadingPosition | null;
  /** The block position for `path` in `mode` (this view's mode by default), from the block list. */
  blockPosition(path: string, mode?: 'rendered' | 'source'): ReadingPosition;
  /** Mounts through `p` and puts it on the reading line. */
  restore(p: ReadingPosition): void;
  /** Holds the block containing `byte` at the reading line until the reader scrolls. */
  landOn(byte: number | undefined): void;
  /** Mounts, now, every block up to the one holding `byte`. */
  mountThrough(byte: number): void;
  /** Resolves when the shown document is wholly in the article. */
  contentComplete(): Promise<void>;
  readonly mode: 'rendered' | 'source';
  /** Rendered to Source or back, on the view's queue. */
  toggleMode(): Promise<void>;
  /** Source at `byteOffset` on the view's queue (Jump to source). */
  jumpToSource(byteOffset: number): Promise<void>;
  /** Source at `byteOffset`, now (the caller is already on the queue). */
  showSource(byteOffset: number): Promise<void>;
  /** Source back to Rendered, now (the caller is already on the queue). */
  leaveSource(): Promise<void>;
  /** The article showing and Source hidden, with nothing else changed. */
  showRenderedChrome(): void;
  /** Source text into the store as one history entry; true when it changed the store. */
  foldSource(): Promise<boolean>;
  sourceHasUnfoldedEdits(): boolean;
  /** The typesetter for the shown page, including the `typeset_viewport` and `typeset_done` marks. */
  typeset(): Promise<void>;
  /** Images, KaTeX and highlighting for the page as mounted now: run the result at idle. */
  deferredWork(file: string): () => Promise<void>;
  /** Sets the rendered page again after a change of variant, size or width, with the reader on the same line. */
  relayout(reason?: 'theme' | 'resize', from?: ReadingPosition | null): Promise<void>;
  /** A user theme was applied: every paragraph set again, the reader kept on the same block. */
  relayoutForTheme(): Promise<void>;
  /**
   * One Commonplace piece, through the one parse and the sanitiser, into the article (MARXY-257).
   * `pieces` null is the bundled Commonplace. Returns its name, or null when there is none to show
   * (none bundled, or one that could not be read), and the caller shows the hint instead. Markup
   * reaches the article only from here, the hint and a store's render: nothing outside the view
   * hands it a string (the B-13 review).
   */
  showFrontispiece(pieces: readonly PieceSource[] | null): Promise<string | null>;
  /** The empty-state hint, for a launch with no document and no piece. */
  showEmptyHint(): void;
  /** The grid pass and the typesetter for a page with no store (the frontispiece). */
  setStatic(): void;
  /** `{ ast, html, nodeMap, blocks }` of the shown document, or null. */
  document(): OpenDocument | null;
  blocks(): BlockList;
  sourceHarness(): SourceHarness | null;
  debugCounts(): { typesetters: number; resizeObservers: number };
  /** Opens and mode switches in this view run one at a time on this queue. */
  serially<T>(fn: () => Promise<T>): Promise<T>;
  /** Releases everything the shown document started (today's `teardownDocument`); the view can show again. */
  clear(): void;
  /** `clear`, and the view's own wiring on its article: nothing of it is left. */
  destroy(): void;
}

const READER_INPUT = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

/**
 * The grid pass and the block list each read the whole article, so running them after every idle
 * batch of eight paragraphs made background typesetting quadratic in the document's length (a
 * 516 KB document: 357,000 layout reads). A pass the reader can see — the viewport, or paragraphs
 * scrolling into view — is snapped at once; background passes are coalesced to one snap per
 * SNAP_INTERVAL_MS, with a trailing one so the last batch is always on the grid. Per view.
 */
const SNAP_INTERVAL_MS = 250;

const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

/** What a launch with no document and no Commonplace piece shows. */
const EMPTY_HINT = '<p class="marxy-empty">Open a markdown file: <code>marxy README.md</code></p>';

/** The source bytes the article holds so far: the end of its last block with provenance. */
function mountedBytes(doc: HTMLElement): number {
  for (let el = doc.lastElementChild; el !== null; el = el.previousElementSibling) {
    const end = el.getAttribute('data-marxy-e');
    if (end !== null) return Number(end);
  }
  return 0;
}

/** Sanitised (or empty-state) HTML into the article. `view/` is in registry.innerHtmlAllowedIn. */
function assignHtml(doc: HTMLElement, html: string): void {
  doc.innerHTML = html;
}

/** True when the editor's text differs from both the buffer it last took and `next`: text only the editor has. */
function holdsUnfoldedText(editor: MountedSourceEditor, next: Buffer): boolean {
  const text = editor.docText();
  return leaveSourceMode(editor.buffer, text).changed && leaveSourceMode(next, text).changed;
}

/**
 * Where `byte` of the bytes before `change` is in the bytes after it (ADR-0037 §6): after the edited
 * range it moves by the change in length, inside it to its start. Unchanged for a transition that did
 * not splice.
 */
export function mapThroughTransition(change: Transition, byte: number): number {
  const splice = spliceOf(change);
  if (splice === null) return byte;
  const { start, removed, inserted } = splice;
  const end = start + removed;
  if (byte < start) return byte;
  if (byte >= end) return byte + inserted - removed;
  return start;
}

/**
 * True when `change` removed the bytes `byte` was in, so it maps to the edit's start (B-15, from the
 * B-13 review): an edit that starts in the block above a held heading and runs into it. The page then
 * holds the first block that starts at or after the edit's start, not the block the start is in.
 */
export function removedBy(change: Transition, byte: number): boolean {
  const splice = spliceOf(change);
  return splice !== null && byte >= splice.start && byte < splice.start + splice.removed;
}

/** The range a splicing transition replaced, in the bytes before it; null for one that did not splice. */
function spliceOf(change: Transition): { start: number; removed: number; inserted: number } | null {
  if (change.kind !== 'apply' && change.kind !== 'commitSource' && change.kind !== 'undo' && change.kind !== 'redo') {
    return null;
  }
  const { edit } = change;
  const [removed, inserted] = change.kind === 'undo' ? [edit.after.length, edit.before.length] : [edit.before.length, edit.after.length];
  return { start: edit.range.start, removed, inserted };
}

export function createRenderedView(host: ViewHost, deps: RenderedViewDeps): RenderedView {
  const { article: doc, sourceHost, modeHost } = host;
  const { shell, trust } = deps;
  /**
   * What this view scrolls (D-05, `pane/scroll.ts`): the window while its pane is the only one, its own
   * pane while two are shown. `rebindScroller` moves it, keeping the reader's place.
   */
  let scroller = host.scroller;
  /**
   * The scroller's offset and height as last seen: on each of its scroll events and after each restore.
   * Read when the scroller is rebound, because by then the layout has changed under it (the window
   * cannot scroll once two panes are shown, and a pane cannot once it is alone) and its own `scrollTop`
   * has been clamped.
   */
  let seen = { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight };
  /**
   * How far the article's top sits below the top of the scroller's content (a pane's padding, the page's
   * margin). The block list measures from the article, the scroll offset from the content, so a block's
   * place in the scroller is its `top` and this. Left out, a position read at one width and put back at
   * another was off by this much of every block's change in height (F-27).
   */
  const contentOffset = (): number => {
    // The window scroller (one pane) is left as it was: its blocks are measured as before.
    if (scroller === document.documentElement) return 0;
    const offset = doc.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + scroller.clientTop) + scroller.scrollTop;
    return Number.isFinite(offset) ? offset : 0;
  };
  let seenOffset = contentOffset();
  const scrollListeners = new Set<() => void>();
  const noteScroll = (): void => {
    seen = { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight };
    seenOffset = contentOffset();
  };
  /** `blocks` with their tops measured from the scroller's content, as its scroll offset is. */
  const inScroller = (blocks: BlockList, offset: number): BlockList =>
    offset === 0 ? blocks : blocks.map((block) => ({ ...block, top: block.top + offset }));
  /** The reading position on `geometry` (the scroller, or what it last was), over `blocks`. */
  const currentPosition = (
    geometry: ScrollerGeometry,
    blocks: BlockList,
    path: string,
    mode: ReadingPosition['mode'],
  ): ReadingPosition =>
    positionOf(geometry, inScroller(blocks, geometry === seen ? seenOffset : contentOffset()), path, mode);
  const onScrollerScroll = (): void => {
    // A scroll nobody here made (every restore notes its own, and the event finds nothing moved) is the
    // reader's or a script's, and releases whatever this view is holding the place with, as the reader's
    // input does: a hold put back after it would undo it (F-27, from the D-13 review: a scroll made just
    // after a pane opened was reset to the top).
    if (scroller !== document.documentElement && scroller.scrollTop !== seen.scrollTop) releaseAnchor();
    noteScroll();
    for (const cb of [...scrollListeners]) cb();
  };
  /** WebKit fires the viewport's scroll at the Document, not at documentElement. */
  const scrollTarget = (el: HTMLElement): EventTarget => (el === document.documentElement ? document : el);
  scrollTarget(scroller).addEventListener('scroll', onScrollerScroll, { passive: true });

  /** Puts `p` on the reading line of this view's scroller, and notes where that left it. */
  function restoreTo(blocks: BlockList, p: ReadingPosition, offset: number = contentOffset()): void {
    restoreScrollToPosition(scroller, inScroller(blocks, offset), p);
    noteScroll();
  }

  /** The store this view shows, and its subscription. */
  let store: DocumentStore | null = null;
  let unsubscribe: (() => void) | null = null;
  /** `{ ast, html, nodeMap, blocks }` of the page on screen. */
  let shown: OpenDocument | null = null;

  let viewMode: 'rendered' | 'source' = 'rendered';
  let sourceEditor: MountedSourceEditor | null = null;
  /** The accessor for the editor in a Source mount, once the editor module has loaded (it stays off the start-up path). */
  let activeSourceEditorIn: ((parent: HTMLElement) => MountedSourceEditor | null) | null = null;
  let lastReadingByteOffset = 0;
  let lastReadingFraction = 0;
  let modeToggleBusy = false;
  /** This pane's Source text and the store went different ways under it (D-11; `holdApart`). */
  let heldApart = false;
  /** The line on the reading line just after Source was shown; leaving from it with no edit is exact. */
  let sourceEntryPlace: number | null = null;
  /** Bumped each time Source is shown, so a late measurement of an earlier visit is dropped. */
  let sourceSession = 0;
  /** `sourceReadingPosition` (source/mode-switch.ts), loaded with the editor: CM6 stays on the lazy chunk. */
  let sourceReadingPositionIn:
    | ((buffer: Buffer, view: never, readingLinePx: number) => { readonly byteOffset: number; readonly fraction: number })
    | null = null;

  /**
   * The grid pass (ADR-0030), now and whenever heights can change under it: when fonts arrive and
   * when the column is resized. Reading position is re-read after each, because tops move.
   */
  let typeset: TypesetController | null = null;
  /** The shown document's mount (A-02), beside its typesetter: what of the article is in so far. */
  let mount: ProgressiveMount | null = null;

  /**
   * The byte offset an open asked to land on. Every grid pass rebuilds the block list and the
   * background typesetter reflows paragraphs above the target after the open returns, so one scroll
   * would land off by the reflow; the anchor is re-applied after each pass instead, until the reader
   * scrolls, changes mode or opens something else. An edit maps it (ADR-0037 §6).
   */
  let anchor: number | null = null;
  let anchorListening = false;
  /**
   * A reading position a re-render restored (a reload, an edit), held the same way until the
   * typesetter has set the new page (A-02): its passes reflow paragraphs above the reading line, and
   * at 1 MB they run for seconds after the render returns.
   */
  let heldPosition: ReadingPosition | null = null;
  /**
   * The place a burst of resizes holds (F-27): taken when the first resize is noticed, ended when its
   * relayout has set the page. Reader input in between releases it (`releaseAnchor`), and the relayout
   * then leaves the reader where they put themselves instead of putting back the place read before.
   */
  let resizeHold: ReadingPosition | null = null;
  /** Each resize hold's place, until its relayout ends: whether the reader released it. */
  const resizeReleased = new WeakMap<ReadingPosition, boolean>();

  let lastSnapAt = 0;
  let snapTimer = 0;
  let snapFrame = 0;
  /**
   * What the pending snap covers: undefined for none asked, null for the whole article, or the first
   * block appended since the last snap (A-02), when only appends asked for it.
   */
  let snapFrom: HTMLElement | null | undefined;

  let resizeObserver: ResizeObserver | null = null;
  /** What `debugCounts` reports: every typesetter started and not yet destroyed, and live observers. */
  const liveTypesetters = new Set<TypesetController>();
  let liveResizeObservers = 0;
  /** The article's listener for faces that load after the first screens (A-02). */
  let fontsLoaded: (() => void) | null = null;
  /**
   * Islands that arrived in chunks (A-02). An island can change height after the pass that measured it
   * with nothing in its style changing (WebKitGTK relays out some tables a layout later), and a later
   * pass from further down would not see it: when one does, the pass is asked again from its block.
   */
  let islandObserver: ResizeObserver | null = null;

  /**
   * What the page waits on after a store transition re-set it (B-11): the new page's first typeset pass,
   * then the title. A repaint superseded by the next one stops being waited on.
   */
  let settledPage: Promise<void> = Promise.resolve();
  let supersedePage: () => void = () => {};
  /** A reload's reading position, mapped through the change by the watcher; read by the repaint. */
  let reloadAt: ReadingPosition | null = null;

  /**
   * Opens and mode switches run one at a time: each reads and replaces the same view state (the
   * buffer, the typesetter, the editor), so two interleaved would leave one file's buffer behind
   * another's page. A failure does not stop the next one from running.
   */
  let chain: Promise<unknown> = Promise.resolve();
  function serially<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  const openPathNow = (): string | null => store?.snapshot().path ?? null;
  const bufferNow = (): Buffer | null => store?.snapshot().buffer ?? null;
  const afterRender = (): void => deps.selection?.()?.afterRender();
  const refreshTitle = (): Promise<void> => deps.refreshTitle?.() ?? Promise.resolve();

  // The article's wiring (the task click, the harness's "wired" flag), with this view's context: a
  // second view, or the next app's view on the same article, has its own (B-12 review).
  const unwire = deps.context ? wireArticle(doc, deps.context, () => deps.selection?.()?.runtime() ?? null) : () => {};

  /**
   * The reader's place while Source shows (F-04): the line on the reading line. In Source the window
   * scrolls and the article is hidden, so neither its block list nor CodeMirror's scroller says where
   * the reader is. Null in Rendered. A reader who has not scrolled (no `scrollTop` above 0) is at the top of
   * the file, byte 0, as `positionAtScroll` reads it in Rendered (F-19.1): a line under the reading
   * line would put them below text written above.
   */
  function sourcePosition(path: string): ReadingPosition | null {
    const buffer = bufferNow();
    if (viewMode !== 'source' || !sourceEditor || !buffer || !sourceReadingPositionIn) return null;
    // What scrolls in Source is the window, the mount (a pane's, or one pane's fixed overlay) or the
    // editor's own scroller, depending on the page's rules: at the top only when none of them has moved.
    const atTop = scroller.scrollTop <= 0 && sourceHost.scrollTop <= 0 && sourceEditor.view.scrollDOM.scrollTop <= 0;
    if (atTop) return { path, byteOffset: 0, fraction: 0, mode: 'source' };
    const place = sourceReadingPositionIn(buffer, sourceEditor.view as never, readingLinePx());
    return { path, byteOffset: place.byteOffset, fraction: place.fraction, mode: 'source' };
  }

  /**
   * The reading line, in window coordinates: 40 % down this view's scroller. The window's own height
   * while the window scrolls (as it always was); a pane's top and height while two are shown (D-11).
   */
  function readingLinePx(): number {
    if (scroller === document.documentElement) return Math.round(window.innerHeight * 0.4);
    return Math.round(scroller.getBoundingClientRect().top + scroller.clientHeight * 0.4);
  }

  /**
   * The mode on the page (D-11). Each pane's section carries its own `data-marxy-mode`, and
   * `document.body`'s mirrors the focused pane's: the CSS and the tests that read the body's (one pane
   * is the window, so they were always reading the one pane's) keep working. The composition root
   * writes the body's when focus moves; a view writes it here only while its pane has focus. An article
   * in no pane (a harness page) writes its `modeHost`, as the one view always did.
   */
  function writeMode(mode: 'rendered' | 'source'): void {
    const pane = doc.closest<HTMLElement>('section.marxy-pane');
    if (!pane) {
      modeHost.dataset.marxyMode = mode;
      return;
    }
    pane.dataset.marxyMode = mode;
    if (pane.hasAttribute('data-marxy-focus')) document.body.dataset.marxyMode = mode;
  }

  function setModeChrome(mode: 'rendered' | 'source'): void {
    // WebKit blurs a hidden element's focus only at a later rendering update; until then a key (Mod+Z)
    // would go to the hidden editor. Move focus out now (F-12).
    if (mode === 'rendered' && sourceHost.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    viewMode = mode;
    writeMode(mode);
    if (mode === 'source') {
      doc.hidden = true;
      sourceHost.hidden = false;
    } else {
      doc.hidden = false;
      sourceHost.hidden = true;
    }
  }

  async function ensureSourceEditor(): Promise<MountedSourceEditor> {
    if (sourceEditor) return sourceEditor;
    const buffer = bufferNow();
    if (!buffer) throw new Error('source editor requires an open buffer');
    const { createSourceEditor, activeSourceEditor } = await import('../source/editor.ts');
    activeSourceEditorIn = activeSourceEditor;
    ({ sourceReadingPosition: sourceReadingPositionIn } = await import('../source/mode-switch.ts'));
    sourceEditor = await createSourceEditor({ parent: sourceHost, buffer });
    return sourceEditor;
  }

  async function showSource(byteOffset: number): Promise<void> {
    releaseAnchor();
    lastReadingByteOffset = byteOffset;
    sourceEntryPlace = null;
    const editor = await ensureSourceEditor();
    setModeChrome('source');
    editor.scrollToByte(byteOffset);
    // Where Source landed, as the reading line reads it: near either end of a document the window
    // cannot put the entered line on the reading line, so "untouched" is "still here", not "on that line".
    // Measured once CodeMirror has applied the scroll (its next frame), and not awaited: the next toggle
    // must not wait on a frame, which a hidden window may never paint.
    const session = ++sourceSession;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const path = openPathNow();
        if (session === sourceSession && sourceEditor === editor && viewMode === 'source' && path) {
          sourceEntryPlace = sourcePosition(path)?.byteOffset ?? null;
        }
      }),
    );
  }

  async function showRendered(byteOffset: number, fraction: number): Promise<void> {
    setModeChrome('rendered');
    const path = openPathNow();
    if (shown && path) {
      mountThrough(byteOffset);
      // Block positions must be measured with the article laid out, not from whatever a hidden pass saw.
      snap(doc);
      restoreTo(shown.blocks, {
        path,
        byteOffset,
        fraction,
        mode: 'rendered',
      });
    }
  }

  async function enterSourceFromRendered(): Promise<void> {
    const path = openPathNow();
    if (!shown || !path) return;
    const pos = currentPosition(scroller, shown.blocks, path, 'rendered');
    lastReadingByteOffset = pos.byteOffset;
    lastReadingFraction = pos.fraction;
    await showSource(pos.byteOffset);
  }

  async function leaveSourceForRendered(): Promise<void> {
    const open = store;
    if (!sourceEditor || !open) return;
    // Held apart from the other pane's fold (D-11): leaving would fold this text over it. Stay, and say why.
    if (stillHeldApart()) {
      notify({ kind: 'info', text: SOURCE_HELD_APART });
      return;
    }
    // Leaving Source is one history entry (`commitSource`): Mod+Z in Rendered undoes what was typed there.
    // The page follows the store: its subscription sets the article from the new bytes, so nothing
    // resolves an operation through an AST, node map or block list built from the old ones.
    const changed = await open.commitSource(sourceEditor.docText());
    let byteOffset = lastReadingByteOffset;
    let fraction = lastReadingFraction;
    // The line on the reading line, read before anything moves the window. Still where Source landed when
    // shown (no edit, no scroll away): the exact place it was entered from. Otherwise that line's block,
    // at its top.
    const { path, buffer } = open.snapshot();
    const place = sourcePosition(path);
    // Not measured yet (left within a frame or two, or the window is hidden): untouched unless edited.
    const movedAway = sourceEntryPlace !== null && place?.byteOffset !== sourceEntryPlace;
    if (place && (changed || movedAway)) {
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

  function sourceHarness(): SourceHarness | null {
    if (!store) return null;
    const { path, buffer } = store.snapshot();
    const byteOffset =
      viewMode === 'rendered' && shown
        ? currentPosition(scroller, shown.blocks, path, 'rendered').byteOffset
        : lastReadingByteOffset;
    return { mode: viewMode, bufferHash: contentHash(buffer.bytes), byteOffset };
  }

  function deferredStartupContext(file: string): DeferredStartupContext {
    return {
      shell,
      file,
      doc,
      rootFor: (path) => deps.rootFor(path),
      imageCtx: { shell, scopedRoots: deps.assetRoots },
      onLayoutChanged: () => snap(doc),
    };
  }

  /** Holds `p` until the resize burst it was read for has been laid out, or the reader scrolls. */
  function holdThroughResize(p: ReadingPosition): void {
    if (anchor !== null || (heldPosition !== null && heldPosition !== resizeHold)) return;
    resizeHold = p;
    resizeReleased.set(p, false);
    heldPosition = p;
    listenForReaderScroll();
  }

  function releaseResizeHold(): void {
    if (resizeHold === null) return;
    resizeReleased.set(resizeHold, true);
    if (heldPosition === resizeHold) heldPosition = null;
    resizeHold = null;
  }

  /** True when `p` should be put back: false when it was a resize hold that a scroll released. */
  function endResizeHold(p: ReadingPosition | null): boolean {
    const released = p === null ? undefined : resizeReleased.get(p);
    if (p === null || released === undefined) return true;
    resizeReleased.delete(p);
    if (resizeHold === p) {
      resizeHold = null;
      if (heldPosition === p) {
        heldPosition = null;
        if (anchor === null) stopListeningForReaderScroll();
      }
    }
    return !released;
  }

  /** A change of variant, size or window width: same position, new layout (A-14, S-02-0001). */
  async function relayoutKeepingReader(
    reason: 'theme' | 'resize' = 'theme',
    from: ReadingPosition | null = null,
  ): Promise<void> {
    const path = openPathNow();
    if (!path || !shown || viewMode !== 'rendered') {
      endResizeHold(from);
      return;
    }
    const pos = from?.path === path ? from : currentPosition(scroller, shown.blocks, path, 'rendered');
    if (typeset) {
      typeset.relayout(reason);
      await typeset.ready;
    } else {
      snap(doc);
    }
    if (!endResizeHold(from) || !shown) return;
    restoreTo(shown.blocks, { ...pos, path, mode: 'rendered' });
  }

  /** A user theme was applied (theme/user-theme.ts): the typesetter sets every paragraph again. */
  async function relayoutForTheme(): Promise<void> {
    const set = typeset;
    const openPath = openPathNow();
    const blocks = shown?.blocks ?? null;
    if (!set || !openPath || !blocks) return;
    // The offset is read with the place and put back with it: what sits above the article (a notice that
    // comes or goes while the page is set) is not the reader's place, and the page leaves it where it was.
    const offset = contentOffset();
    const pos = positionOf(scroller, inScroller(blocks, offset), openPath, 'rendered');
    set.relayout('theme');
    await set.ready;
    restoreTo(blocks, { ...pos, path: openPath, mode: 'rendered' }, offset);
  }

  function snap(article: HTMLElement, from?: HTMLElement): void {
    cancelScheduledSnap();
    lastSnapAt = performance.now();
    snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight), from ? { from } : undefined);
    if (shown) shown.blocks = buildBlocks(article, shown.nodeMap);
    holdAnchor();
  }

  function releaseAnchor(): void {
    anchor = null;
    heldPosition = null;
    releaseResizeHold();
    stopListeningForReaderScroll();
  }

  /**
   * Reader input releases what this view holds only when it is this view's (D-05). With the window as
   * the scroller (one pane) every input is. With a pane of its own, a pointer or touch counts inside
   * that pane, and a key inside it or, from outside every pane (the body), when this pane has focus:
   * scrolling the other pane must not let this pane's pending open drift.
   */
  function isOwnInput(event: Event): boolean {
    if (scroller === document.documentElement) return true;
    const target = event.target;
    if (target instanceof Node && scroller.contains(target)) return true;
    if (event.type !== 'keydown') return false;
    const inPane = target instanceof Element && target.closest('[data-marxy-pane]') !== null;
    return !inPane && scroller.hasAttribute('data-marxy-focus');
  }

  function onReaderInput(event: Event): void {
    if (isOwnInput(event)) releaseAnchor();
  }

  function listenForReaderScroll(): void {
    if (anchorListening) return;
    anchorListening = true;
    // Input, not `scroll`: the anchor's own scrolls must not release it.
    for (const type of READER_INPUT) {
      window.addEventListener(type, onReaderInput, { capture: true, passive: true });
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
    for (const type of READER_INPUT) window.removeEventListener(type, onReaderInput, { capture: true });
  }

  /** The innermost block whose node's byte range contains `at`, else the last one starting before it. */
  function blockContaining(open: OpenDocument, at: number): BlockList[number] | undefined {
    let before: BlockList[number] | undefined;
    let containing: BlockList[number] | undefined;
    for (const block of open.blocks) {
      if (block.start > at) break;
      before = block;
      const node = nodeFor(open.nodeMap, block.el);
      if (node !== undefined && at < node.src.end) containing = block;
    }
    return containing ?? before;
  }

  function holdAnchor(): void {
    const openPath = openPathNow();
    if (!shown || !openPath || viewMode !== 'rendered') return;
    if (heldPosition !== null && heldPosition.path === openPath) {
      restoreTo(shown.blocks, heldPosition);
      return;
    }
    if (anchor === null) return;
    const block = blockContaining(shown, anchor);
    if (block === undefined) return;
    restoreTo(shown.blocks, {
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
  function holdPosition(position: ReadingPosition): void {
    mountThrough(position.byteOffset);
    if (!shown) return;
    restoreTo(shown.blocks, position);
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

  /** `from`: hold the first block that starts at or after `at`, not the block `at` is in (a spanning edit). */
  function landOn(at: number | undefined, opts?: { from?: boolean }): void {
    if (at === undefined) return;
    mountThrough(at);
    listenForReaderScroll();
    anchor = (opts?.from ? shown?.blocks.find((block) => block.start >= at)?.start : undefined) ?? at;
    holdAnchor();
  }

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

  function destroyTypeset(): void {
    if (typeset) liveTypesetters.delete(typeset);
    typeset?.destroy();
    typeset = null;
  }

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
      if (before === null && path && shown) {
        before = currentPosition(scroller, shown.blocks, path, 'rendered');
        if (scroller !== document.documentElement) holdThroughResize(before);
      }
      clearTimeout(pending);
      // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
      pending = window.setTimeout(() => {
        const position = before;
        const relayout = rebreak;
        before = null;
        rebreak = false;
        if (!laidOut()) {
          endResizeHold(position);
          return;
        }
        if (relayout) {
          void relayoutKeepingReader('resize', position);
          return;
        }
        snap(article);
        if (!endResizeHold(position)) return;
        if (position && shown && position.path === openPathNow() && viewMode === 'rendered') {
          restoreTo(shown.blocks, position);
        }
      }, 100);
    });
    resizeObserver.observe(article);
  }

  /**
   * Everything one shown document started: its mount, its subscription, its typesetter, its resize
   * observer, a pending grid pass and its Source editor. Run before the next document replaces it, so
   * N opens leave one of each and not N — each old observer would otherwise relayout on every resize.
   * The store is not the view's: whoever opened it closes it.
   */
  function clear(): void {
    mount?.cancel();
    mount = null;
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    shown = null;
    releaseAnchor();
    destroyTypeset();
    disconnectResizeObserver();
    cancelScheduledSnap();
    // The editor in this view's mount too, whoever made it: it must not outlive the page it was built for,
    // or the next Source entry would reuse an editor holding the previous document (F-12). Only this
    // mount's: another view's editor is its own (D-01).
    const shared = activeSourceEditorIn?.(sourceHost) ?? null;
    sourceEditor?.destroy();
    if (shared && shared !== sourceEditor) shared.destroy();
    sourceEditor = null;
    heldApart = false;
    sourceHost.replaceChildren();
  }

  /** Source text the reader typed and has not yet folded into the store: the store cannot see it. */
  function unfoldedSourceEdits(): boolean {
    const buffer = bufferNow();
    return buffer !== null && viewMode === 'source' && sourceEditor !== null && leaveSourceMode(buffer, sourceEditor.docText()).changed;
  }

  function settlePage(work: Promise<void>): void {
    supersedePage();
    let supersede!: () => void;
    const superseded = new Promise<void>((resolve) => { supersede = resolve; });
    supersedePage = supersede;
    settledPage = Promise.race([work, superseded])
      .then(() => refreshTitle())
      .catch((e: unknown) => console.warn(`marxy: the page did not settle after a change: ${String(e)}`));
  }

  /**
   * The editor takes new bytes from outside (a reload). Replacing the text would put the caret back on
   * line 1, so the caret and selection are carried through the change the way the reading position is
   * (`offsetThroughEdit`): the same text stays selected, and a caret in removed text lands where it was
   * removed (F-19.3).
   */
  function replaceSourceBuffer(editor: MountedSourceEditor, next: Buffer): void {
    const old = editor.buffer;
    const before = editor.view.state;
    const { anchor, head } = before.selection.main;
    // Positions through the old text's separator and BOM, back through the new text's (F-23).
    const offsets = (pos: number): number =>
      byteToUtf16(next, offsetThroughEdit(utf16ToByte(old, cmPosToUtf16(old, before, pos)), old.bytes, next.bytes));
    const mapped = old === next ? null : { anchor: offsets(anchor), head: offsets(head) };
    editor.replaceBuffer(next);
    if (mapped === null) return;
    const after = editor.view.state;
    editor.view.dispatch({
      selection: { anchor: utf16ToCmPos(next, after, mapped.anchor), head: utf16ToCmPos(next, after, mapped.head) },
    });
  }

  /**
   * The page again, from the store's bytes, at `position`: the same render, typeset and hold an open
   * gets. Used for every transition that changed the bytes or the name (an operation, undo, redo, a
   * reload, a rename) and for `commitEdit` of unchanged bytes. `landing`, when given, is the anchor
   * the view held, mapped through the change: it is held again rather than released.
   */
  function repaint(snapshot: DocumentSnapshot, position: ReadingPosition, landing: number | null = null, spanned = false): void {
    // Every path that changes the store while Source shows folds the editor's text first (undo, redo, save,
    // rename) or refuses (commitEdit), so the editor holds nothing the store lacks here. If it does (another
    // pane changed the store under it, D-11), the editor is held apart: its text is kept, not reset, and
    // its folds are refused, so neither the reader's text nor the store's change is written over (F-12).
    if (sourceEditor && !heldApart && holdsUnfoldedText(sourceEditor, snapshot.buffer)) {
      console.error('marxy: Source held unfolded text at a repaint; the editor keeps it, held apart');
      holdApart();
    }
    if (sourceEditor && !heldApart) replaceSourceBuffer(sourceEditor, snapshot.buffer);
    releaseAnchor();
    rerenderFromBuffer(landing ?? position.byteOffset);
    const typesetting = typesetDocument();
    if (viewMode === 'source' && sourceEditor) {
      // Source shows and the window is its scroller: the place goes back into the editor, not onto the
      // hidden article, whose block list has nothing measured to place it by (F-04).
      lastReadingByteOffset = position.byteOffset;
      lastReadingFraction = 0;
      sourceEditor.scrollToByte(position.byteOffset);
    } else if (landing !== null) {
      landOn(landing, { from: spanned });
    } else {
      holdPosition({ ...position, path: snapshot.path });
    }
    settlePage(typesetting);
  }

  /**
   * A render that throws after the store committed (B-11): the change stands — it is in the buffer and
   * in the history, so undo and save still see it — and the page says what went wrong in its place.
   */
  function showRenderFailure(e: unknown): void {
    console.warn(`marxy: the page could not be set after a change: ${String(e)}`);
    // What was selected named elements of the page that is gone, at offsets of bytes the store has moved past.
    deps.selection?.()?.clear();
    const message = document.createElement('p');
    message.textContent = String(e);
    doc.replaceChildren(message);
    settlePage(Promise.resolve());
  }

  /**
   * Text typed in this view's Source that the store did not have when another view's watch reloaded it
   * from disk or followed a rename (two panes on one file, D-11): the store could not see it, so it moved
   * on without it. The editor keeps it and it goes into the store on top, one history entry, as an
   * unsaved edit the store kept would have: the page is set from the folded bytes. Never lost to a
   * transition this view did not ask for.
   */
  function keepTypedText(before: DocumentSnapshot, snapshot: DocumentSnapshot, change: Transition): boolean {
    if (change.kind !== 'reload' && change.kind !== 'rename') return false;
    // A reload that only adopted the bytes on disk (the buffer is the one it was) took nothing away.
    if (snapshot.buffer === before.buffer) return false;
    const open = store;
    const editor = sourceEditor;
    if (!open || !editor || viewMode !== 'source' || heldApart) return false;
    const text = editor.docText();
    if (!leaveSourceMode(before.buffer, text).changed) return false;
    if (change.kind === 'reload') diskChangedEditsKeptNotice();
    void open.commitSource(text).then(
      (changed) => {
        if (changed && sourceEditor === editor && store === open) editor.replaceBuffer(open.snapshot().buffer);
      },
      (e: unknown) => console.warn(`marxy: Source text could not be kept over a change on disk: ${String(e)}`),
    );
    return true;
  }

  /**
   * A fold committed to the store this view shows, from this view or another (two panes on one file,
   * D-11). Two safe cases only: the editor already reads as the store (this view's own fold), so it is
   * re-pointed at the new bytes and the caret stays; or it holds no typing of its own, so it takes the
   * new bytes, caret mapped. An editor still holding its own unfolded typing (no route should reach
   * this: a pane opening a file another pane holds unfolded folds the holder first, app.ts) is held
   * apart rather than merged: both texts are kept, neither written over the other.
   */
  function followFoldIn(editor: MountedSourceEditor, snapshot: DocumentSnapshot): void {
    if (heldApart) return;
    const text = editor.docText();
    if (!leaveSourceMode(snapshot.buffer, text).changed) return editor.replaceBuffer(snapshot.buffer);
    if (!leaveSourceMode(editor.buffer, text).changed) return replaceSourceBuffer(editor, snapshot.buffer);
    holdApart();
  }

  /**
   * This pane's Source text and the store went different ways under it (D-11): the editor keeps its text
   * and the store keeps the other pane's, and the reader is told. Until the editor's text reads as the
   * store's again, or this pane opens a document again, its folds are refused (on blur, before a save,
   * an undo or a close) and so is leaving Source, which would fold: nothing of one pane is written over
   * the other's. Its text still counts as unsaved, so a close, an open over it or quitting asks first.
   */
  function holdApart(): void {
    if (!heldApart) notify({ kind: 'info', text: SOURCE_HELD_APART });
    heldApart = true;
  }

  /** Whether the editor is still held apart; it is released once its text reads as the store's. */
  function stillHeldApart(): boolean {
    if (!heldApart) return false;
    const buffer = bufferNow();
    if (sourceEditor && buffer && !leaveSourceMode(buffer, sourceEditor.docText()).changed) {
      heldApart = false;
      sourceEditor.replaceBuffer(buffer);
      return false;
    }
    return true;
  }

  /** The page's side of a committed transition on the shown store. */
  function followTransition(before: DocumentSnapshot, snapshot: DocumentSnapshot, change: Transition): void {
    if (keepTypedText(before, snapshot, change)) return;
    switch (change.kind) {
      case 'open':
      case 'close':
        return;
      case 'save':
        // A Save as moved the store to another name: the parse the page resolves through follows it.
        if (change.renamedFrom !== undefined && shown) {
          shown = { ...shown, ast: snapshot.ast, nodeMap: snapshot.nodeMap };
        }
        settlePage(Promise.resolve());
        return;
      case 'commitSource':
        // Leaving Source (or folding before a save or a rename): the caller restores the position. Another
        // view's fold reaches this view's editor too, or its next fold would write the old text back (D-11).
        if (sourceEditor) followFoldIn(sourceEditor, snapshot);
        try {
          rerenderFromBuffer();
        } catch (e) {
          showRenderFailure(e);
        }
        return;
      case 'reload':
        // Disk caught up with the buffer (our save's echo, or an external write of the same bytes).
        if (snapshot.buffer === before.buffer) {
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
    if (!shown) return;
    const read =
      change.kind === 'reload' && reloadAt !== null
        ? reloadAt
        : sourcePosition(before.path) ?? currentPosition(scroller, shown.blocks, before.path, 'rendered');
    // The place was read in the bytes before the change; the page is set in the bytes after it (ADR-0037 §6).
    const position = { ...read, byteOffset: mapThroughTransition(change, read.byteOffset) };
    // A held anchor is mapped through a splice. A reload is not a splice: its place is the watcher's,
    // already mapped through the new bytes (`reloadAt`), and the anchor's old offset means nothing in
    // them, so the page holds that place instead, as before B-13 (the B-13 review).
    const landing =
      anchor !== null && viewMode === 'rendered' && change.kind !== 'reload' ? mapThroughTransition(change, anchor) : null;
    // An anchor the edit removed lands on the edit's start: the block from there on is held, not the one above.
    const spanned = landing !== null && anchor !== null && removedBy(change, anchor);
    try {
      repaint(snapshot, position, landing, spanned);
    } catch (e) {
      showRenderFailure(e);
    }
  }

  /** The page follows `next` for as long as it is the shown store (ADR-0037 §1: readers subscribe). */
  function follow(next: DocumentStore): void {
    let seen = next.snapshot();
    const off = next.subscribe((snapshot, change) => {
      const before = seen;
      seen = snapshot;
      if (store === next) followTransition(before, snapshot, change);
    });
    unsubscribe = off;
  }

  function startTypeset(article: HTMLElement): TypesetController {
    const lineBox = parseFloat(getComputedStyle(article).lineHeight);
    destroyTypeset();
    typeset = attach(article, {
      lineBox,
      lastLineMinWidth: 0.33,
      // The scroller the typesetter holds the reader's place on: read at each pass, so a rebind (one pane
      // to two and back) is followed without a new typesetter (B-26).
      scroller: () => scroller,
      onPass: (kind) => (kind === 'background' ? scheduleSnap(article) : snap(article)),
    });
    liveTypesetters.add(typeset);
    return typeset;
  }

  /**
   * The typesetter (MARXY-23), after first text: the reader sees the engine's wrapping for at most a
   * frame, then the viewport set with hyphenation and hanging punctuation, and the rest in idle time.
   */
  async function typesetDocument(): Promise<void> {
    const controller = startTypeset(doc);
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
   * The page again from the store's snapshot, after its bytes or its grants changed under the shown
   * document (an edit, a reload, a trust change). The store has already parsed the bytes; this is the
   * same render and passes as an open. Given a byte offset, the mount lands there and the reading
   * position is the caller's; given a position (a trust change), it is also restored here.
   */
  function rerenderFromBuffer(at?: number | Pick<ReadingPosition, 'byteOffset' | 'fraction'>): void {
    if (!store) return;
    const { path: file, ast, nodeMap } = store.snapshot();
    const byteOffset = typeof at === 'number' ? at : at?.byteOffset;
    const { html, removed, blockedImages } = renderDocumentSafeHtml(ast, trust.policyFor(file));
    destroyTypeset();
    shown = { ast, html, nodeMap, blocks: [] };
    const mounted = mountDocument(html, file, byteOffset);
    afterRender();
    trust.showNotices(removed, blockedImages);
    snap(doc);
    startTypeset(doc);
    if (at !== undefined && typeof at !== 'number') {
      mountThrough(at.byteOffset);
      restoreTo(shown.blocks, {
        path: file,
        byteOffset: at.byteOffset,
        fraction: at.fraction,
        mode: 'rendered',
      });
    }
    deferAfterComplete(mounted, file);
  }

  /**
   * The shown document's HTML into the article through its one mount (A-02): all of it at once under the
   * threshold, else the first screens (from `landing` down, when given) now and the rest in idle chunks
   * once `start` settles. Replaces, and cancels, the mount of whatever was shown before.
   */
  function mountDocument(html: string, file: string, landing?: number, start?: Promise<unknown>): ProgressiveMount {
    mount?.cancel();
    cancelScheduledSnap();
    // The repository root the images and links resolve against (F-14): asked once, never waited on.
    void resolveImageRoot(file, (path) => deps.rootFor(path));
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
  function mountThrough(byte: number): void {
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
  function deferredStartup(file: string): () => Promise<void> {
    return () => runDeferredStartup(deferredStartupContext(file));
  }

  function deferAfterComplete(current: ProgressiveMount, file: string): void {
    void afterComplete(current, () => whenIdle(deferredStartup(file)));
  }

  /** The render half of an open (MARXY-183): the store's snapshot into the article through the `render` mark. */
  async function show(
    next: DocumentStore,
    opts?: { at?: number; start?: Promise<unknown>; onMounted?: () => void },
  ): Promise<RenderEvidence> {
    if (store !== null) clear();
    store = next;
    follow(next);
    const { path: file, ast, nodeMap } = next.snapshot();
    const { html, removed, blockedImages } = renderDocumentSafeHtml(ast, trust.policyFor(file));
    console.info(`marxy: sanitiser removed ${removed.length}`);
    shown = { ast, html, nodeMap, blocks: [] };
    // Only the first screens go in now (A-02); images are checked before any block reaches the page.
    mountDocument(html, file, opts?.at, opts?.start);
    afterRender();
    opts?.onMounted?.();
    await shell.mark('rendered', Date.now());
    await shell.mark('first_screen', Date.now(), `blocks=${doc.childElementCount} bytes=${mountedBytes(doc)}`);
    trust.showNotices(removed, blockedImages);
    void doc.offsetHeight;
    await document.fonts.ready;
    // No face list here (A-02): reading `document.fonts` made WebKit restyle the whole article as soon
    // as the bundled fonts had loaded, seconds at 1 MB booked to the grid stage. The restyle still
    // happens at the next style read, but now while the article holds only the first screens.
    await shell.mark('fonts_ready', Date.now());
    // The grid pass also builds the block list the reading position is read from.
    keepOnGrid(doc);
    landOn(opts?.at);
    const evidence = deps.measure.renderEvidence(doc);
    await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
    return evidence;
  }

  /**
   * This view scrolls `next` from now on (D-05): the scroll listeners move to it, and the reader's place,
   * read from where the old scroller was last seen, is put back on it and held through the passes that
   * follow (the width changes with the scroller, so the typesetter re-breaks the page). A pending open's
   * anchor is kept instead, unless `given` names the place to hold (a pane closing on its left hands the
   * survivor's place, fraction and all, to the first pane). Source keeps its own place (D-11). The
   * typesetter reads `scroller` at each pass, so it holds the reader's place on `next` from here (B-26).
   */
  function rebindScroller(next: HTMLElement, given?: ReadingPosition): void {
    const path = openPathNow();
    const before =
      given ?? (shown && path && viewMode === 'rendered' ? currentPosition(seen, shown.blocks, path, 'rendered') : null);
    if (next !== scroller) {
      scrollTarget(scroller).removeEventListener('scroll', onScrollerScroll);
      scroller = next;
      scrollTarget(scroller).addEventListener('scroll', onScrollerScroll, { passive: true });
    }
    noteScroll();
    if (!shown || !path || viewMode !== 'rendered' || doc.hidden) return;
    // The block list again at the new geometry; a held anchor is put back on the new scroller by it.
    snap(doc);
    if (given === undefined && anchor !== null) return;
    if (before && before.path === path && before.mode === 'rendered') holdPosition({ ...before, path });
  }

  function position(): ReadingPosition {
    const path = openPathNow() ?? '';
    return sourcePosition(path) ?? currentPosition(scroller, shown?.blocks ?? [], path, viewMode);
  }

  const view: RenderedView = {
    host,
    get scroller() {
      return scroller;
    },
    rebindScroller,
    onScroll(cb) {
      scrollListeners.add(cb);
      return () => {
        scrollListeners.delete(cb);
      };
    },
    show,
    store: () => store,
    rerender: (at) => rerenderFromBuffer(at),
    repaint() {
      const snapshot = store?.snapshot();
      if (!snapshot || !shown) return;
      repaint(snapshot, sourcePosition(snapshot.path) ?? currentPosition(scroller, shown.blocks, snapshot.path, 'rendered'));
    },
    settled: () => settledPage,
    expectReloadAt(p) {
      reloadAt = p;
    },
    position,
    sourcePosition: () => sourcePosition(openPathNow() ?? ''),
    blockPosition: (path, mode = viewMode) => currentPosition(scroller, shown?.blocks ?? [], path, mode),
    restore(p) {
      lastReadingByteOffset = p.byteOffset;
      lastReadingFraction = p.fraction;
      mountThrough(p.byteOffset);
      if (shown) restoreTo(shown.blocks, p);
    },
    landOn,
    mountThrough,
    contentComplete: () => mount?.complete ?? Promise.resolve(),
    get mode() {
      return viewMode;
    },
    toggleMode: toggleViewMode,
    jumpToSource,
    showSource,
    leaveSource: leaveSourceForRendered,
    showRenderedChrome: () => setModeChrome('rendered'),
    async foldSource() {
      const open = store;
      if (!open || viewMode === 'rendered' || !sourceEditor || stillHeldApart()) return false;
      if (!(await open.commitSource(sourceEditor.docText()))) return false;
      sourceEditor?.replaceBuffer(open.snapshot().buffer);
      return true;
    },
    sourceHasUnfoldedEdits: unfoldedSourceEdits,
    typeset: typesetDocument,
    deferredWork(file) {
      // Once the whole document is in (at once under the threshold); later chunks do not hold the open
      // up, so the reader can switch mode or open another document while they are appended (A-02).
      const current = mount;
      const deferred = deferredStartup(file);
      return async () => {
        if (!current || current.isComplete()) await deferred();
        else void afterComplete(current, () => whenIdle(deferred));
      };
    },
    relayout: relayoutKeepingReader,
    relayoutForTheme,
    async showFrontispiece(pieces) {
      try {
        const frontispiece = await import('../frontispiece/index.ts');
        const piece = await frontispiece.renderPiece(pieces ?? frontispiece.bundledPieces);
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
    },
    showEmptyHint: () => assignHtml(doc, EMPTY_HINT),
    setStatic() {
      keepOnGrid(doc);
      startTypeset(doc);
    },
    document: () => shown,
    blocks: () => shown?.blocks ?? [],
    sourceHarness,
    debugCounts: () => ({ typesetters: liveTypesetters.size, resizeObservers: liveResizeObservers }),
    serially,
    clear,
    destroy() {
      clear();
      unwire();
      scrollListeners.clear();
      scrollTarget(scroller).removeEventListener('scroll', onScrollerScroll);
    },
  };
  return view;
}
