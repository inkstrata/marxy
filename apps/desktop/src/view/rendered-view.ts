// The per-article view: everything about showing one document
// store in one article. It owns the render into the article, the mode and the Source editor, the
// typesetter, grid scheduling, the anchor, the resize observer, the block list and the mount. The
// store owns the bytes; the view subscribes to the store it shows and sets the page again when they
// change. Nothing here is held at module scope, so a second view can be created beside the first.

import { byteToUtf16, contentHash, utf16ToByte, type Buffer, type Document } from '@marxy/core';
import { offsetThroughEdit } from '@marxy/core/src/position/restore.ts';
import { blockedImagesFrom, renderDocumentSafeHtml, renderDocumentSafeHtmlInSlices } from '@marxy/core/src/render/index.ts';
import { readingOf, type Reading } from '@marxy/core/src/reading/index.ts';
import { installReadingSort } from './reading-sort.ts';
import { mountRows, type RowsView } from './reading-rows.ts';
import { mountLines, type LinesView } from './reading-lines.ts';
import { drawTreeFrom, installTreeWays, onTreeStart, treeStartOf } from './tree-from.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import { attach, snapBlocks, snapInSlices, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { AppShell } from '../app.ts';
import type { AppContext } from '../commands/registry.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import { wireArticle } from '../commands/document.ts';
import type { DocumentSnapshot, DocumentStore, Transition } from '../document/store.ts';
import { parserOfPath } from '../document/store.ts';
import { documentName } from '../document/untitled.ts';
import { currentPosition as positionOf, restoreScrollToPosition, type HeldPosition } from '../position/index.ts';
import type { ScrollerGeometry } from '../position/position.ts';
import { renderRecord, spliceRendered, type RenderRecord } from '../render/incremental.ts';
import { resolveImageRoot, stripNonLocalImages } from '../render/images.ts';
import { blockListStats, builtList, topLevelOf, updateBlocks } from './block-list.ts';
import { buildBlocks, buildBlocksByRange, nodeFor, type BlockList, type NodeMap } from '../render/post.ts';
import { guardLongRuns } from '../render/long-runs.ts';
import { markBlockDirections } from '../render/direction.ts';
import { installWideTables } from '../render/wide-tables.ts';
import { DEFAULT_THRESHOLD, mountProgressively, parseInertInSlices, type ProgressiveMount } from '../render/progressive.ts';
import { onPartChoice, readParts, type PartsPage } from '../render/parts.ts';
import { colourReportsWaiting } from '../render/colour-reports.ts';
import { onColourChoice } from '../render/colour-tier.ts';
import { yieldToEventLoop } from '../startup/yield.ts';
import type { RenderedSelection } from '../selection/view.ts';
import type { TranscriptView } from '../kinds/transcript-view.ts';
import { diskChangedEditsKeptNotice } from '../notices/disk.ts';
import { notify, paneOf, SOURCE_HELD_APART } from '../notices/index.ts';
import { cmDocText, leaveSourceMode } from '../source/buffer-commit.ts';
import { type CmStateLike, cmPosToUtf16, utf16ToCmPos } from '../source/cm-position.ts';
import { type DeferredStartupContext, runDeferredStartup, whenIdle } from '../startup/idle-work.ts';
import type { LaunchMeasure, RenderEvidence } from '../startup/measure.ts';
import { landsInRead } from '../source/default-mode.ts';
import type { TrustController } from '../trust/controller.ts';
import type { PaneViewer } from '../viewers/types.ts';

/** Minimal surface used by the view; CM6 types stay on the lazy chunk. */
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
    readonly dom: HTMLElement;
    readonly state: CmStateLike & { readonly selection: { readonly main: { readonly anchor: number; readonly head: number } } };
    dispatch(spec: { selection: { anchor: number; head: number } }): void;
  };
}

/**
 * One block open for editing in place (commands/block-edit.ts): a CodeMirror editor where the block's
 * element was. The view asks it before it lets the reader's text go, as it asks Source: it counts as unsaved
 * text the store does not have, folds into the store on every route that folds Source, and is closed before
 * the page under it is set again. At most one at a time, in the one view whose article holds it.
 */
export interface BlockEdit {
  /** The reader's text differs from the block it was opened on: the store does not have it. */
  dirty(): boolean;
  /** That text into the store as one history entry, then the editor closes; true when the store changed. */
  fold(): Promise<boolean>;
  /** Whether `change` is this editor's own commit (its `fold`), not another view's or the disk's. */
  owns(change: Transition): boolean;
  /**
   * The page under the editor is about to be set again, by `change` (null: with no change to the bytes). It
   * closes at once; text it held that the store does not have is put back over the new bytes.
   */
  release(before: DocumentSnapshot | null, snapshot: DocumentSnapshot, change: Transition | null): void;
  /** Closes it and keeps nothing: the document is being closed or replaced. */
  discard(): void;
}

export interface OpenDocument {
  readonly ast: Document;
  /** The sanitised HTML of the whole document. After a reload that replaced only some blocks it is rendered when first read. */
  readonly html: string;
  /** Rendered element → AST node, through its byte range. */
  readonly nodeMap: NodeMap;
  /** Refreshed whenever layout moves them; built once here for now. */
  blocks: BlockList;
  /** What the page was rendered from, for the next reload to replace only what it changed; null when none. */
  readonly render: RenderRecord | null;
}

/**
 * Where a view draws. In the app the article is `#doc`, the scroller `document.documentElement`, the
 * Source mount `#marxy-source` and the mode host `document.body`, so the DOM is what it was before.
 * An article inside a `section.marxy-pane` carries its mode on that section instead (see
 * `writeMode`).
 */
export interface ViewHost {
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  readonly sourceHost: HTMLElement;
  /** Carries `data-marxy-mode` when the article is in no `section.marxy-pane` (a harness page). */
  readonly modeHost: HTMLElement;
  /** Where a page of the app's own is drawn (an image, the file card, the bytes); made beside Source's mount when absent. */
  readonly viewerHost?: HTMLElement;
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
  /** The reader switched this view's document to `mode` (a key, a button, Jump to source): not an open's landing. */
  modeChosen?(path: string, mode: 'rendered' | 'source'): void;
}

export type SourceHarness = {
  readonly mode: 'rendered' | 'source';
  readonly bufferHash: string;
  readonly byteOffset: number;
};

/** Where an open lands: a byte (a heading, a link), or a stored place, with how far down its block the reading line sat. */
export type Landing = number | Pick<ReadingPosition, 'byteOffset' | 'fraction'>;

const byteOfLanding = (at: Landing): number => (typeof at === 'number' ? at : at.byteOffset);

export interface RenderedView {
  /** Where the view was made to draw; `host.scroller` is the scroller it started on. */
  readonly host: ViewHost;
  /** What the view scrolls now: the window with one pane, its own pane with two. */
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
   * are in and the selection has been told, before the `rendered` mark. `sliced` renders and parses a
   * large document a few milliseconds at a time with the event loop given back between slices, for a pane
   * opening beside another: the page it makes is the same, and first text comes a little later.
   *
   * `source`: the document opens in Source, so no page is made for it now. Source is mounted at `at`
   * (a failed mount says so and shows the file as plain text), the Rendered page is made when the reader first
   * asks for Rendered, and the evidence is Source's own text.
   */
  show(
    store: DocumentStore,
    opts?: { at?: Landing; start?: Promise<unknown>; onMounted?: () => void; sliced?: boolean; source?: boolean; viewer?: PaneViewer },
  ): Promise<RenderEvidence>;
  /**
   * A file that is not a text buffer: `viewer` draws Read and Source in the pane's viewer mount, and there is
   * no store, no page and no editor. With `show`'s `viewer`, a text file's Read is the viewer's page and Source its text.
   */
  showViewer(viewer: PaneViewer, opts?: { onMounted?: () => void; mode?: 'rendered' | 'source' }): Promise<RenderEvidence>;
  /** The page of the app's own the pane shows, or null. */
  viewer(): PaneViewer | null;
  /**
   * An open of a document begins in this view: until the returned function is called a mode press is
   * dropped, as is one already queued behind it. A press means the document the reader was looking at; the
   * one opening is not that, and a toggle applied after it opened would undo the mode it opened in.
   */
  beginOpen(): () => void;
  /** Starts loading Source's code for `path`, so an open that ends in Source does not wait for it after the file is read. */
  warmSource(path: string): void;
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
  /** Whether the reader is at the end of the page (a wholly mounted one, or one holding the end), as a followed log asks before it grows. */
  atEnd(): boolean;
  /** The page at its end, held there as the page grows: a followed log whose reader was at the end stays at it. */
  followEnd(): void;
  /** Where the reader is: the line on the reading line in Source, else the block position in this mode. */
  position(): ReadingPosition;
  /** The reader's place while Source shows; null in Rendered or before the editor loaded. */
  sourcePosition(): ReadingPosition | null;
  /** The block position for `path` in `mode` (this view's mode by default), from the block list. */
  blockPosition(path: string, mode?: 'rendered' | 'source'): ReadingPosition;
  /** Mounts through `p` and puts it on the reading line. */
  restore(p: ReadingPosition): void;
  /**
   * Holds the block containing `at` at the reading line until the reader scrolls; a stored place is held at its
   * fraction of its block, as it was read.
   */
  landOn(at: Landing | undefined): void;
  /** Mounts, now, every block up to the one holding `byte`. */
  mountThrough(byte: number): void;
  /** Resolves when the shown document is wholly in the article. */
  contentComplete(): Promise<void>;
  readonly mode: 'rendered' | 'source';
  /** Rendered to Source or back, on the view's queue: each call is a request against the mode the calls before it end in. */
  toggleMode(): Promise<void>;
  /** `mode`, on the view's queue; a call for the mode the calls before it end in changes nothing. */
  setMode(mode: 'rendered' | 'source'): Promise<void>;
  /** Focus into the Source editor now showing, at the reading line (or the reader's own caret when kept); nothing in another pane. */
  focusSource(): void;
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
  /** Source text this view's fold cannot take because another pane's fold went another way: a save would not write it. */
  sourceHeldApart(): boolean;
  /** The block open for editing in place in this view's article, or null. The block-edit command sets and clears it. */
  blockEdit: BlockEdit | null;
  /**
   * Runs `change`, which alters the page's layout at or above the reader's place (a block opened in place
   * takes more or less room than the block did), and puts the reader back on the block they were reading.
   */
  holdPlace(change: () => void): void;
  /**
   * `el` changed height by `by` px as the reader worked in it (a block open in place gaining or losing a line).
   * When it ends above the reading line the page scrolls with it, so the block being read does not move.
   */
  followGrowth(el: HTMLElement, by: number): void;
  /** The typesetter for the shown page, including the `typeset_viewport` and `typeset_done` marks. */
  typeset(): Promise<void>;
  /** Images, KaTeX and highlighting for the page as mounted now: run the result at idle. */
  deferredWork(file: string): () => Promise<void>;
  /** Sets the rendered page again after a change of variant, size or width, with the reader on the same line. */
  relayout(reason?: 'theme' | 'resize', from?: ReadingPosition | null): Promise<void>;
  /** A user theme was applied: every paragraph set again, the reader kept on the same block. */
  relayoutForTheme(): Promise<void>;
  /**
   * One Commonplace piece, through the one parse and the sanitiser, into the article.
   * `pieces` null is the bundled Commonplace. Returns its name, or null when there is none to show
   * (none bundled, or one that could not be read), and the caller shows the hint instead. Markup
   * reaches the article only from here, the hint and a store's render: nothing outside the view
   * hands it a string.
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
  /**
   * Releases everything the shown document started (today's `teardownDocument`); the view can show again.
   * `keepSourceShowing`: an open is under way and Source stays on screen, with the old text in it, until the next
   * document's first screens replace it; `show` takes it away.
   */
  clear(keepSourceShowing?: boolean): void;
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
/** Blocks in a window of the whole-article grid pass made when a long document is wholly in. */
const SLICE_BLOCKS = 128;
/** How long after the reader's own input a scroll up is theirs, and how long after landing at the end the engine may move the page. */
const PIN_INPUT_MS = 600;
const PIN_SETTLE_MS = 3000;

const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

/** The grid pass below a replaced block runs at once when at most this many blocks follow it, else at idle. */
const SYNC_SNAP_BLOCKS = 300;

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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when the editor's text differs from both the buffer it last took and `next`: text only the editor has. */
function holdsUnfoldedText(editor: MountedSourceEditor, next: Buffer): boolean {
  const text = editor.docText();
  return leaveSourceMode(editor.buffer, text).changed && leaveSourceMode(next, text).changed;
}

/**
 * Where `byte` of the bytes before `change` is in the bytes after it: after the edited
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
 * True when `change` removed the bytes `byte` was in, so it maps to the edit's start:
 * an edit that starts in the block above a held heading and runs into it. The page then
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

/** An `OpenDocument` whose `html` is made when first read. */
function openDocumentOf(
  ast: Document,
  nodeMap: NodeMap,
  blocks: BlockList,
  render: RenderRecord | null,
  html: () => string,
): OpenDocument {
  let made: string | undefined;
  return {
    ast,
    nodeMap,
    blocks,
    render,
    get html() {
      return (made ??= html());
    },
  };
}

/**
 * The sanitised page of a parse under a policy. A parse is replaced, never edited, when its bytes change, so one
 * parse and one policy always give the same page: a document coming back from a warm store mounts it without rendering again.
 */
const pages = new WeakMap<object, { readonly policy: object; readonly page: ReturnType<typeof renderDocumentSafeHtml> }>();
function sanitisedPage(ast: Parameters<typeof renderDocumentSafeHtml>[0], policy: NonNullable<Parameters<typeof renderDocumentSafeHtml>[1]>): ReturnType<typeof renderDocumentSafeHtml> {
  const kept = pages.get(ast);
  if (kept && kept.policy === policy) return kept.page;
  const page = renderDocumentSafeHtml(ast, policy);
  pages.set(ast, { policy, page });
  return page;
}

export function createRenderedView(host: ViewHost, deps: RenderedViewDeps): RenderedView {
  const { article: doc, sourceHost, modeHost } = host;
  const { shell, trust } = deps;
  // The view's lifetime: whatever it listens for on the window, the document or its scroller is given this signal, so
  // `destroy` leaves none of it holding the view (and the document it shows) however it was left.
  const life = new AbortController();
  const { signal } = life;
  /**
   * What this view scrolls (`pane/scroll.ts`): the window while its pane is the only one, its own
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
   * margin, the frame's head above the one pane). The block list measures from the article, the scroll offset
   * from the content, so a block's place in the scroller is its `top` and this. Left out, a position read at
   * one width and put back at another was off by this much of every block's change in height, and the
   * window's reading line sat the head's height below 40 % of it.
   */
  const contentOffset = (): number => {
    // The window's content starts at the viewport's top: documentElement's own box scrolls with the page, so
    // measuring from it, as from a pane, would count the scroll twice.
    const top = scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop;
    const offset = doc.getBoundingClientRect().top - top + scroller.scrollTop;
    return Number.isFinite(offset) ? offset : 0;
  };
  let seenOffset = contentOffset();
  const scrollListeners = new Set<() => void>();
  const noteScroll = (): void => {
    seen = { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight };
    seenOffset = contentOffset();
  };
  /** The reading position on `geometry` (the scroller, or what it last was), over `blocks`; the offset puts the list's tops in the scroller's content. */
  const currentPosition = (
    geometry: ScrollerGeometry,
    blocks: BlockList,
    path: string,
    mode: ReadingPosition['mode'],
  ): HeldPosition =>
    positionOf(geometry, blocks, path, mode, geometry === seen ? seenOffset : contentOffset());
  const onScrollerScroll = (): void => {
    // A scroll nobody here made (every restore notes its own, and the event finds nothing moved) is the
    // reader's or a script's, and releases whatever this view is holding the place with, as the reader's
    // input does: a hold put back after it would undo it (a scroll made just
    // after a pane opened was reset to the top).
    const own = scroller.scrollTop === seen.scrollTop;
    if (scroller !== document.documentElement && !own) releaseAnchor();
    noteScroll();
    notePinned(own);
    for (const cb of [...scrollListeners]) cb();
  };
  const distanceToEnd = (): number => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  /**
   * Whether this scroll is the reader at the end of the whole page, or away from it. A scroll up the reader did not
   * make, soon after they landed at the end, is the engine's (laying out a piece that has just come near the screen can
   * move the offset with the height unchanged): the end is put back. A scroll up after the reader's own input, or
   * after the settling time, is theirs and ends the pin. A scroll this view made (`own`, a restore) never pins: one
   * clamped on a page still short of its height would otherwise follow the end as the page grows (the relaunch fault).
   */
  const notePinned = (own: boolean): void => {
    const top = scroller.scrollTop;
    if (!own && top > 0 && distanceToEnd() <= 2 && viewMode === 'rendered' && (mount === null || mount.isComplete())) {
      endPinned = true;
      pinnedTop = top;
      pinnedAt = performance.now();
      return;
    }
    if (!endPinned || top >= pinnedTop - 1) return;
    const now = performance.now();
    // The reader's wheel is not listened for (a wheel listener makes WebKit repaint the whole page after every layout):
    // a wheel or a key moves the page a little, and what the engine did moved it by more than three screens.
    if (now - lastReaderInputAt < PIN_INPUT_MS || now - pinnedAt > PIN_SETTLE_MS || pinnedTop - top < scroller.clientHeight * 3) {
      endPinned = false;
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  };
  /** Input that is the reader's, except the ones that take them to the end (those are what pins it). */
  const onPinInput = (event: Event): void => {
    if (event.type === 'keydown') {
      const key = event as KeyboardEvent;
      if (key.key === 'End' || (key.key === 'ArrowDown' && (key.metaKey || key.ctrlKey))) return;
    }
    if (isOwnInput(event)) lastReaderInputAt = performance.now();
  };
  const PIN_INPUT_TYPES = ['touchstart', 'pointerdown', 'mousedown', 'keydown'] as const;
  for (const type of PIN_INPUT_TYPES) window.addEventListener(type, onPinInput, { capture: true, passive: true, signal });
  /** WebKit fires the viewport's scroll at the Document, not at documentElement. */
  const scrollTarget = (el: HTMLElement): EventTarget => (el === document.documentElement ? document : el);
  scrollTarget(scroller).addEventListener('scroll', onScrollerScroll, { passive: true, signal });

  let restored: { readonly place: HeldPosition; readonly scroller: HTMLElement; readonly top: number } | null = null;
  /** Puts `p` on the reading line of this view's scroller, and notes where that left it. */
  function restoreTo(blocks: BlockList, p: HeldPosition, offset: number = contentOffset()): void {
    restoreScrollToPosition(scroller, blocks, p, offset);
    noteScroll();
    restored = { place: p, scroller, top: scroller.scrollTop };
  }

  /**
   * The place last put back, exact, while the scroller still shows it; else `read`. A place read from a whole-pixel offset
   * is up to half a pixel off the one put there, and a run of resizes (a divider moved step by step) added those up.
   */
  function exactly(read: HeldPosition): HeldPosition {
    const r = restored;
    if (!r || r.scroller !== scroller || r.top !== scroller.scrollTop) return read;
    return r.place.path === read.path && r.place.mode === read.mode && r.place.byteOffset === read.byteOffset ? r.place : read;
  }

  /** The store this view shows, and its subscription. */
  let store: DocumentStore | null = null;
  let unsubscribe: (() => void) | null = null;
  /** `{ ast, html, nodeMap, blocks }` of the page on screen. */
  let shown: OpenDocument | null = null;

  let viewMode: 'rendered' | 'source' = 'rendered';
  /** A page of the app's own: it draws the modes it owns in `viewerMount`, in place of the article or Source. */
  let viewer: PaneViewer | null = null;
  let viewerMount: HTMLElement | null = host.viewerHost ?? null;
  const mountForViewer = (): HTMLElement => {
    if (viewerMount) return viewerMount;
    const made = document.createElement('div');
    made.className = 'marxy-viewer-mount';
    made.hidden = true;
    sourceHost.after(made);
    viewerMount = made;
    return made;
  };
  const hideViewerMount = (): void => {
    if (viewerMount && !viewerMount.hidden) viewerMount.hidden = true;
  };
  /** The block open for editing in place; closed before the page under it is set again. */
  let blockEdit: BlockEdit | null = null;
  let sourceEditor: MountedSourceEditor | null = null;
  /** The accessor for the editor in a Source mount, once the editor module has loaded (it stays off the start-up path). */
  let activeSourceEditorIn: ((parent: HTMLElement) => MountedSourceEditor | null) | null = null;
  let lastReadingByteOffset = 0;
  let lastReadingFraction = 0;
  /**
   * Source's place as its last scroll left it, and the editor's box then. A new box (the window resized, a split made or
   * given back) re-wraps the lines and the engine clamps the offset, often to 0, with no script involved: the place is
   * put back from here. A scroll at another box than the one noted is that clamp, not the reader, and is not noted.
   */
  let sourceKept: { readonly editor: MountedSourceEditor; box: string; byteOffset: number | null } | null = null;
  let sourceKeeper: ResizeObserver | null = null;
  const sourceBox = (el: HTMLElement): string => `${el.clientWidth}x${el.clientHeight}`;
  function noteSourcePlace(): void {
    const kept = sourceKept;
    const path = openPathNow();
    if (!kept || kept.editor !== sourceEditor || viewMode !== 'source' || sourceHost.hidden || !path) return;
    const box = sourceBox(kept.editor.view.scrollDOM);
    if (box !== kept.box) return;
    const place = sourcePosition(path);
    kept.byteOffset = place && place.byteOffset > 0 ? place.byteOffset : null;
  }
  function keepSourcePlace(editor: MountedSourceEditor): void {
    sourceKeeper?.disconnect();
    const scrollDOM = editor.view.scrollDOM;
    sourceKept = { editor, box: sourceBox(scrollDOM), byteOffset: null };
    scrollDOM.addEventListener('scroll', noteSourcePlace, { passive: true });
    if (typeof ResizeObserver === 'undefined') return;
    sourceKeeper = new ResizeObserver(() => {
      const kept = sourceKept;
      if (!kept || kept.editor !== sourceEditor) return;
      const box = sourceBox(scrollDOM);
      if (box === kept.box) return;
      kept.box = box;
      if (viewMode !== 'source' || sourceHost.hidden || scrollDOM.clientHeight === 0 || kept.byteOffset === null) return;
      editor.scrollToByte(kept.byteOffset);
    });
    sourceKeeper.observe(scrollDOM);
  }
  function dropSourceKeeper(): void {
    sourceKeeper?.disconnect();
    sourceKeeper = null;
    sourceKept?.editor.view.scrollDOM.removeEventListener('scroll', noteSourcePlace);
    sourceKept = null;
  }
  /**
   * Mode requests not yet done (Mod+E, Read, Source, Jump to source), and the mode the last of them ends in.
   * A press is a request against the mode the queue before it ends in, so ten presses end where ten
   * flips would, and none is dropped for arriving while another is under way.
   */
  let modeRequests = 0;
  let modeEndsIn: 'rendered' | 'source' = 'rendered';
  /** Opens under way in this view, and a count of them started: see `beginOpen`. */
  let opening = 0;
  let openings = 0;
  /**
   * The file is shown as plain text in Rendered because Source could not be mounted and no page was ever made
   * for it: a reload sets that text again and does not render the file as Markdown in its place.
   */
  let plainText = false;
  /**
   * The hidden article is behind the store: a fold committed while Source showed did not set it from
   * the new bytes, since nobody can see it. Whatever shows Rendered again sets it first (`showRendered`).
   * Any whole render, and a close or an open, make it current again.
   */
  let pageStale = false;
  /**
   * Every reason the page went stale was a change to the bytes: the held render record is still the page, so showing
   * Rendered can replace the blocks that differ. A theme, a size or face, a trust grant, a rename or any whole render
   * asked for while hidden clears it.
   */
  let staleByBytesOnly = false;
  function markStale(bytesOnly = false): void {
    staleByBytesOnly = pageStale ? staleByBytesOnly && bytesOnly : bytesOnly;
    pageStale = true;
  }
  /** This pane's Source text and the store went different ways under it (`holdApart`). */
  let heldApart = false;
  /** The line on the reading line just after Source was shown; leaving from it with no edit is exact. */
  let sourceEntryPlace: number | null = null;
  /** Bumped each time Source is shown, so a late measurement of an earlier visit is dropped. */
  let sourceSession = 0;
  /**
   * Where the last leave of Source landed Rendered: the exact byte it came from, and what Rendered read as its
   * place once it was there (the block under the reading line is a paragraph, a whole code file, never a line).
   * Going back to Source from the place it landed on, with nothing changed, returns to that byte, not to the
   * start of the block.
   */
  let swapPlace: { path: string; version: number; exact: number; landed: ReadingPosition } | null = null;
  /** `sourceReadingPosition` (source/mode-switch.ts), loaded with the editor: CM6 stays on the lazy chunk. */
  let sourceReadingPositionIn:
    | ((buffer: Buffer, view: never, readingLinePx: number) => { readonly byteOffset: number; readonly fraction: number })
    | null = null;

  /**
   * The grid pass, now and whenever heights can change under it: when fonts arrive and
   * when the column is resized. Reading position is re-read after each, because tops move.
   */
  let typeset: TypesetController | null = null;
  /** The shown document's mount, beside its typesetter: what of the article is in so far. */
  let mount: ProgressiveMount | null = null;

  /**
   * The byte offset an open asked to land on. Every grid pass rebuilds the block list and the
   * background typesetter reflows paragraphs above the target after the open returns, so one scroll
   * would land off by the reflow; the anchor is re-applied after each pass instead, until the reader
   * scrolls, changes mode or opens something else. An edit maps it.
   */
  let anchor: number | null = null;
  /**
   * How far down the anchor's block the reading line sat: a stored place's fraction, held with it. 0, the
   * block's top, for every other landing (a heading, a link, an edit's mapped anchor).
   */
  let anchorFraction = 0;
  let anchorListening = false;
  /**
   * A reading position a re-render restored (a reload, an edit), held the same way until the
   * typesetter has set the new page: its passes reflow paragraphs above the reading line, and
   * at 1 MB they run for seconds after the render returns.
   */
  let heldPosition: HeldPosition | null = null;
  /**
   * The place a burst of resizes holds: taken when the first resize is noticed, ended when its
   * relayout has set the page. Reader input in between releases it (`releaseAnchor`), and the relayout
   * then leaves the reader where they put themselves instead of putting back the place read before.
   */
  let resizeHold: ReadingPosition | null = null;
  /**
   * Each resize's place, until its relayout ends: whether the reader released it. Kept for a resize that found another
   * hold in place too (a split's rebind), so a scroll after it is not undone by its relayout.
   */
  const resizeReleased = new Map<ReadingPosition, boolean>();

  let lastSnapAt = 0;
  /** Bumped by every whole-article pass; a sliced one asks whether it is still the latest between windows. */
  let wholeGeneration = 0;
  /** The whole-article pass made when the mount completed: `contentComplete` waits for it, so the page is on the grid when it resolves. */
  let completePass: Promise<void> = Promise.resolve();
  /** A resize burst's relayout and the place it holds until the page is set again: `contentComplete` waits for it too. */
  let resizeSettled: Promise<void> = Promise.resolve();
  /**
   * True from a scroll that lands at the very end of a wholly mounted page until the reader scrolls up: the
   * end then follows the page as pieces change height under it (they are split into lines and, being laid out only
   * when near, take their real height as they arrive), so a jump to the end stays at the end.
   */
  let endPinned = false;
  let pinnedTop = 0;
  let pinnedAt = 0;
  let lastReaderInputAt = Number.NEGATIVE_INFINITY;
  let endObserver: ResizeObserver | null = null;
  let snapTimer = 0;
  let snapFrame = 0;
  /** The blocks whose own height changed since the last pass, for the next. */
  let changedBlocks: Set<HTMLElement> | null = null;
  /**
   * What the pending snap covers: undefined for none asked, null for the whole article, or the first
   * block appended since the last snap, when only appends asked for it.
   */
  let snapFrom: HTMLElement | null | undefined;

  let resizeObserver: ResizeObserver | null = null;
  /** Drops a resize burst still waiting out its 100 ms: its place is the last document's, not the next one's. */
  let cancelResizeBurst: (() => void) | null = null;
  /** What `debugCounts` reports: every typesetter started and not yet destroyed, and live observers. */
  const liveTypesetters = new Set<TypesetController>();
  let liveResizeObservers = 0;
  /** The article's listener for faces that load after the first screens. */
  let fontsLoaded: (() => void) | null = null;
  /**
   * Islands that arrived in chunks. An island can change height after the pass that measured it
   * with nothing in its style changing (WebKitGTK relays out some tables a layout later), and a later
   * pass from further down would not see it: when one does, the pass is asked again from its block.
   */
  let islandObserver: ResizeObserver | null = null;

  /**
   * What the page waits on after a store transition re-set it: the new page's first typeset pass,
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

  /**
   * The derived transcript view, when this document is a JSONL session read as a transcript: Read mounts
   * it in the article in place of a page, and its module is loaded the first time one is shown, never on the way to first
   * text. No Markdown page is made for such a file: its block list is the view's, so the reading position, ⌘E and
   * a held place work through it as through any page, and no AST node is read for it.
   */
  let derived: TranscriptView | null = null;
  let transcriptModule: typeof import('../kinds/transcript-view.ts') | null = null;
  const loadTranscriptModule = async (): Promise<typeof import('../kinds/transcript-view.ts')> =>
    (transcriptModule ??= await import('../kinds/transcript-view.ts'));
  /** Whether Read shows `path` as the derived view: a `.jsonl` this pane reads as a transcript (the transcript kind). */
  const readsAsTranscript = (path: string | null | undefined): boolean =>
    path != null && /\.jsonl$/i.test(path) && doc.closest('[data-marxy-kind]')?.getAttribute('data-marxy-kind') === 'transcript';
  /** The block list of what is on the page: the derived view's, or the page's own. */
  /** The reading the page is set as (a data tree, records, a table, verse, plain prose), or null for the parse's page. */
  let reading: Reading | null = null;
  const kindNow = (): string | null => doc.closest('[data-marxy-kind]')?.getAttribute('data-marxy-kind') ?? null;
  const paneHostNow = (): Element | null => doc.closest('[data-marxy-pane]');
  const readingFor = (snap: Pick<DocumentSnapshot, 'path' | 'buffer'>): Reading | null =>
    readingOf(snap.path, snap.buffer.bytes, kindNow(), treeStartOf(paneHostNow(), snap.path));
  /** The page's HTML for `snap`: its reading's, else the parse's, sanitised. Notes which it was. */
  const pageOf = (snap: Pick<DocumentSnapshot, 'path' | 'buffer' | 'ast'>): ReturnType<typeof renderDocumentSafeHtml> => {
    reading = readingFor(snap);
    // An empty file is said so (base.css): the page's own words, in no block, so find and copy pass over them.
    doc.toggleAttribute('data-marxy-empty', snap.buffer.bytes.length === 0);
    // A reading's HTML is made from escaped text alone: it has nothing for the allow-list to take out.
    if (reading) return { html: reading.html, removed: [], blockedImages: [] };
    return sanitisedPage(snap.ast, trust.policyFor(snap.path));
  };
  const blocksOf = (article: HTMLElement): BlockList =>
    derived ? derived.blocks() : reading ? buildBlocksByRange(article) : builtList(article, buildBlocks(article, shown?.nodeMap ?? new Map()));
  const refreshTitle = (): Promise<void> => deps.refreshTitle?.() ?? Promise.resolve();
  const offReadingSort = installReadingSort(doc);
  /** A table or records reading's rows, every one of them drawn as the table scrolls (reading-rows.ts). */
  let rowsView: RowsView | null = null;
  /** The rows view for the reading just mounted, in place of the last page's. */
  function attachRows(current: ProgressiveMount): void {
    rowsView?.destroy();
    rowsView = null;
    const rows = reading?.rows;
    if (!rows) return;
    const attach = (): void => {
      if (mount !== current || rowsView) return;
      const table = doc.querySelector<HTMLTableElement>('.marxy-records .marxy-reading-table');
      const root = table?.closest<HTMLElement>('.marxy-reading');
      if (!table || !root) return;
      rowsView = mountRows({
        rows,
        root,
        table,
        scroller: () => scroller,
        onDrawn: () => {
          if (shown && !pageHidden()) shown.blocks = blocksOf(doc);
        },
        scrollTo: (top) => {
          releaseAnchor();
          endPinned = false;
          scroller.scrollTop = top;
          noteScroll();
        },
      });
    };
    attach();
    if (!rowsView) void current.complete.then(attach);
  }
  /** A big file's lines, the ones on screen drawn as the page scrolls (reading-lines.ts). */
  let linesView: LinesView | null = null;
  function attachLines(current: ProgressiveMount): void {
    // A page set again over the same file (a reload, an edit) keeps the level its log was filtered to; another file's
    // view is gone before this (`clear`).
    const level = linesView?.level() ?? 0;
    linesView?.destroy();
    linesView = null;
    const lines = reading?.lines;
    if (!lines) return;
    const attach = (): void => {
      if (mount !== current || linesView) return;
      const body = doc.querySelector<HTMLElement>('[data-marxy-lines]');
      if (!body) return;
      linesView = mountLines({
        lines,
        body,
        level,
        scroller: () => scroller,
        onDrawn: () => {
          if (shown && !pageHidden()) shown.blocks = blocksOf(doc);
        },
        scrollTo: (top) => {
          releaseAnchor();
          endPinned = false;
          scroller.scrollTop = top;
          noteScroll();
        },
      });
    };
    attach();
    if (!linesView) void current.complete.then(attach);
  }
  // A wide table's note line comes and goes with its width: the page below it goes back on the grid.
  const offWideTables = installWideTables(doc, (box) => {
    let block: HTMLElement = box;
    while (block.parentElement && block.parentElement !== doc) block = block.parentElement;
    if (block.parentElement === doc) scheduleChanged(doc, block);
  });
  /** The fenced parts of a Markdown page are read on their own (render/parts.ts); a reading's page has none. */
  const partsPage = (path: string, ast: Document, buffer: Buffer): PartsPage | null => (reading ? null : { path, ast, bytes: buffer.bytes });
  // A part read another way is set again where the reader is, in every view of its file.
  const offPartChoice = onPartChoice((path) => {
    if (store?.snapshot().path === path && !reading && shown?.render) rerenderFromBuffer(currentPosition(scroller, shown.blocks, path, viewMode));
  });
  // Colour anyway, or plain text again (the plain-text tier): the page is set again where the reader is.
  const offColourChoice = onColourChoice((path) => {
    if (store?.snapshot().path === path && !reading && shown?.render) rerenderFromBuffer(currentPosition(scroller, shown.blocks, path, viewMode));
  });
  // A data tree drawn in part: Draw from here sets it again from that point, at its top; Go on in Source lands on the line.
  const offTreeWays = installTreeWays(doc, {
    from: (from) => {
      const host = paneHostNow();
      const path = store?.snapshot().path;
      if (host && path) drawTreeFrom(host, path, from);
    },
    source: (byte) => void jumpToSource(byte),
  });
  const offTreeStart = onTreeStart((host, path) => {
    if (host !== paneHostNow() || store?.snapshot().path !== path || !reading || !shown?.render) return;
    rerenderFromBuffer(0);
    if (viewMode === 'rendered') scroller.scrollTop = 0;
  });

  // The article's wiring (the task click, the harness's "wired" flag), with this view's context: a
  // second view, or the next app's view on the same article, has its own.
  const unwire = deps.context ? wireArticle(doc, deps.context, () => deps.selection?.()?.runtime() ?? null) : () => {};

  /**
   * The reader's place while Source shows: the line on the reading line. In Source the article is
   * hidden, so its block list cannot say where the reader is, and no one scroll offset can either: the line is
   * found at the reading line on screen, whatever scrolled it there. Null in Rendered. A reader who has not
   * scrolled (no `scrollTop` above 0) is at the top of the file, byte 0, as `positionAtScroll` reads it in
   * Rendered: a line under the reading line would put them below text written above.
   */
  function sourcePosition(path: string): ReadingPosition | null {
    const buffer = bufferNow();
    if (viewMode !== 'source' || !sourceEditor || !buffer || !sourceReadingPositionIn) return null;
    // What scrolls in Source is the editor's own scroller in the frame (frame.css fixes the mount under the
    // head), else the window or the mount, depending on the page's rules: at the top only when none has moved.
    const atTop = scroller.scrollTop <= 0 && sourceHost.scrollTop <= 0 && sourceEditor.view.scrollDOM.scrollTop <= 0;
    if (atTop) return { path, byteOffset: 0, fraction: 0, mode: 'source' };
    const place = sourceReadingPositionIn(buffer, sourceEditor.view as never, readingLinePx());
    return { path, byteOffset: place.byteOffset, fraction: place.fraction, mode: 'source' };
  }

  /**
   * The reading line, in window coordinates: 40 % down this view's scroller. The window's own height
   * while the window scrolls (as it always was); a pane's top and height while two are shown.
   */
  function readingLinePx(): number {
    if (scroller === document.documentElement) return Math.round(window.innerHeight * 0.4);
    return Math.round(scroller.getBoundingClientRect().top + scroller.clientHeight * 0.4);
  }

  /**
   * The mode on the page. Each pane's section carries its own `data-marxy-mode`, and
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
    // would go to the hidden editor. Move focus out now.
    if (mode === 'rendered' && sourceHost.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    viewMode = mode;
    writeMode(mode);
    if (viewer?.owns(mode)) {
      const mount = mountForViewer();
      doc.hidden = true;
      sourceHost.hidden = true;
      mount.hidden = false;
      viewer.show(mode, mount);
      return;
    }
    if (viewer) viewer.hide();
    hideViewerMount();
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
    sourceEditor = await createSourceEditor({
      parent: sourceHost,
      buffer,
      // The editor's style sheet restyles the whole page, and Source is about to cover it: hide it first, in the very
      // task that makes the editor and shows it (nothing paints between), so that the restyle skips the article.
      beforeMount: () => {
        doc.hidden = true;
      },
    });
    keepSourcePlace(sourceEditor);
    return sourceEditor;
  }

  /** Source at `byteOffset`; rejects when the editor cannot be made (`showSource` says so instead). */
  async function mountSource(byteOffset: number): Promise<void> {
    releaseAnchor();
    lastReadingByteOffset = byteOffset;
    sourceEntryPlace = null;
    const editor = await ensureSourceEditor();
    // The place a Source shown again had before is not put back over the one it is entered at.
    if (sourceKept) sourceKept.byteOffset = null;
    plainText = false;
    setModeChrome('source');
    dropRetiredSource();
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

  /**
   * Source at `byteOffset`, now. A Source that cannot be mounted (its code did not load) never rejects and never
   * loses the document: the reader is told what failed, and Rendered stays; a file that has no page yet is
   * shown there as plain text.
   */
  async function showSource(byteOffset: number): Promise<void> {
    try {
      await mountSource(byteOffset);
    } catch (e) {
      showSourceFailure(e);
    }
  }

  function showSourceFailure(e: unknown): void {
    const path = openPathNow();
    const reason = (e instanceof Error ? e.message : String(e)).trim().replace(/\.$/, '');
    console.warn(`marxy: Source could not be mounted: ${reason}`);
    setModeChrome('rendered');
    dropRetiredSource();
    // The page may have been hidden while the editor was being made, and its grid passes skipped for it.
    if (shown) scheduleSnap(doc);
    // No page was ever made for this file (it opens in Source): the reader still gets its text, as it is.
    const bare = mount === null && derived === null;
    if (bare) showPlainText();
    notify(
      {
        kind: 'error',
        text: `Source could not open ${path ? documentName(path) : 'this file'}: ${reason}.${bare ? ' The file is shown here as plain text.' : ''}`,
      },
      { pane: paneOf(doc) },
    );
  }

  /** The buffer's text, verbatim, in one monospace block: the page of a file whose Source would not mount. */
  function showPlainText(): void {
    const buffer = bufferNow();
    if (!buffer) return;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = cmDocText(buffer);
    pre.append(code);
    doc.replaceChildren(pre);
    plainText = true;
    afterRender();
  }

  async function showRendered(byteOffset: number, fraction: number): Promise<void> {
    // Read is a page of the app's own (an SVG's image page): it is drawn by the viewer, not set from the bytes.
    if (viewer?.owns('rendered')) {
      setModeChrome('rendered');
      return;
    }
    // A JSONL session's Read is the derived view: its module is in before Read shows, so the page never shows empty.
    if (readsAsTranscript(openPathNow())) await loadTranscriptModule();
    setModeChrome('rendered');
    const path = openPathNow();
    // Folds that came in while Source showed left the page as it was: set it from the store's bytes now.
    if (pageStale && shown && path) {
      try {
        // Commits made while Source showed are one change from the held record to the store's document.
        if (!(staleByBytesOnly && spliceStalePage())) rerenderFromBuffer(byteOffset);
      } catch (e) {
        showRenderFailure(e);
        return;
      }
    }
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
    if (derived && !pageHidden()) shown.blocks = derived.blocks();
    const pos = currentPosition(scroller, shown.blocks, path, 'rendered');
    const exact = exactPlaceOf(pos, path);
    caretKept = exact !== null;
    // A byte the open landed on, the page not moved since: Source puts the caret on that byte's line, whatever line the
    // scroll could bring to the reading line (near a file's end it cannot bring it there).
    const landed = exact === null && landedAt !== null && landedAt.path === path && Math.abs(scroller.scrollTop - landedAt.top) <= 2 ? landedAt.byte : null;
    const line = exact === null && landed === null ? codeLineAt(pos) : null;
    lastReadingByteOffset = exact ?? landed ?? line ?? pos.byteOffset;
    lastReadingFraction = exact === null && landed === null && line === null ? pos.fraction : 0;
    await showSource(lastReadingByteOffset);
  }

  /** The byte an open asked for and where the page stood once it was held there: Mod+E from there is that byte's line. */
  let landedAt: { readonly path: string; readonly byte: number; top: number } | null = null;

  /**
   * The code reading's block that starts at `start` (a file that lands in Read as code): its element and the byte each
   * of its lines begins at. A piece is up to 200 lines in one block, so the block's own start is far from the reader's
   * line. Null in any other reading: a Markdown fence keeps the block's place, as Mod+E always had it.
   */
  function codeBlock(start: number): { readonly code: HTMLElement; readonly starts: number[] } | null {
    const path = openPathNow();
    const buffer = bufferNow();
    if (!path || !buffer || !landsInRead(path)) return null;
    const code = doc.querySelector<HTMLElement>(`pre > code[data-marxy-s="${start}"]`) ?? doc.querySelector<HTMLElement>(`pre[data-marxy-s="${start}"] > code`);
    if (!code) return null;
    const end = Number(code.dataset.marxyE ?? code.closest<HTMLElement>('pre')?.dataset.marxyE);
    if (!Number.isFinite(end) || end <= start) return null;
    const bytes = buffer.bytes;
    const starts = [start];
    for (let i = start; i < end - 1; i++) if (bytes[i] === 0x0a) starts.push(i + 1);
    return { code, starts };
  }

  /**
   * The start of the code line on the reading line, read from where the text lies on screen (a wrapped line takes more
   * rows than its neighbours); by the fraction through the block when nothing is laid out. Null for any other block.
   */
  function codeLineAt(pos: ReadingPosition): number | null {
    const block = codeBlock(pos.byteOffset);
    if (!block) return null;
    const { code, starts } = block;
    const box = code.getBoundingClientRect();
    const y = readingLinePx();
    if (box.height > 0 && y >= box.top && y < box.bottom) {
      const hit = document.caretRangeFromPoint?.(box.left + 1, y);
      if (hit && code.contains(hit.startContainer)) {
        const before = document.createRange();
        before.setStart(code, 0);
        before.setEnd(hit.startContainer, hit.startOffset);
        const breaks = before.toString().split('\n').length - 1;
        return starts[Math.min(starts.length - 1, breaks)]!;
      }
    }
    if (pos.fraction <= 0) return null;
    return starts[Math.min(starts.length - 1, Math.floor(pos.fraction * starts.length))]!;
  }

  /** How far through the code block line `line` sits, its middle, measured where it is laid out; by count otherwise. */
  function codeLineFraction(code: HTMLElement, line: number, lines: number): number {
    const pre = code.closest<HTMLElement>('pre') ?? code;
    const box = pre.getBoundingClientRect();
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const text = node.data;
      let at = 0;
      while (seen < line) {
        const next = text.indexOf('\n', at);
        if (next === -1) break;
        seen++;
        at = next + 1;
      }
      if (seen < line || at >= text.length) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const rect = range.getClientRects()[0];
      if (rect && box.height > 0) return Math.min(1, Math.max(0, (rect.top + rect.height / 2 - box.top) / box.height));
      break;
    }
    return (line + 0.5) / lines;
  }

  /** Source was entered where the reader left it: the editor's own caret is theirs, and is not moved. */
  let caretKept = false;

  /**
   * Focus into the Source editor, the caret at the reading line unless the reader's own is kept, so the next key typed is
   * text and not a page key. Only for a pane that has the keys: a Source opened in another pane never takes them.
   */
  function focusSource(): void {
    const editor = sourceEditor;
    const buffer = bufferNow();
    if (!editor || !buffer || viewMode !== 'source') return;
    const pane = doc.closest('section.marxy-pane');
    if (pane && !pane.hasAttribute('data-marxy-focus')) return;
    if (!caretKept) {
      const at = utf16ToCmPos(buffer, editor.view.state as CmStateLike, byteToUtf16(buffer, lastReadingByteOffset));
      editor.view.dispatch({ selection: { anchor: at, head: at } });
    }
    editor.view.dom.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true });
  }

  /**
   * The byte Source was left at, when `pos` is still the place Rendered landed on after that leave: the same
   * document and bytes, the same block, the reading line within a few pixels of where it was put. Null otherwise
   * (the reader scrolled, or the bytes changed), and the block's start is the place.
   */
  function exactPlaceOf(pos: ReadingPosition, path: string): number | null {
    const kept = swapPlace;
    swapPlace = null;
    const snapshot = store?.snapshot();
    if (!kept || !snapshot || !shown || kept.path !== path || kept.version !== snapshot.version) return null;
    if (kept.landed.byteOffset !== pos.byteOffset) return null;
    const block = blockContaining(shown, pos.byteOffset);
    const height = block?.el.getBoundingClientRect().height ?? 0;
    return Math.abs(pos.fraction - kept.landed.fraction) * height <= 4 ? kept.exact : null;
  }

  async function leaveSourceForRendered(): Promise<void> {
    const open = store;
    if (!sourceEditor || !open) return;
    // Held apart from the other pane's fold: leaving would fold this text over it. Stay, and say why.
    if (stillHeldApart()) {
      notify({ kind: 'refused', text: SOURCE_HELD_APART }, { pane: paneOf(doc) });
      return;
    }
    // Leaving Source is one history entry (`commitSource`): Mod+Z in Rendered undoes what was typed there.
    // The page follows the store: its subscription sets the article from the new bytes, so nothing
    // resolves an operation through an AST, node map or block list built from the old ones.
    // A key typed while the fold waits is folded too: taking the store's bytes over it would delete it.
    const editor = sourceEditor;
    let changed = await foldEditorInto(open, editor);
    // Held apart while the fold waited (another pane's fold landed first): that text is still only in this editor.
    if (keepsSourceHeldApart(editor)) return;
    let byteOffset = lastReadingByteOffset;
    let fraction = lastReadingFraction;
    // The line on the reading line, read before anything moves the window. Still where Source landed when
    // shown (no edit, no scroll away): the exact place it was entered from. Otherwise that line's block,
    // at its top.
    const { path } = open.snapshot();
    const place = sourcePosition(path);
    // Not measured yet (left within a frame or two, or the window is hidden): untouched unless edited.
    const movedAway = sourceEntryPlace !== null && place?.byteOffset !== sourceEntryPlace;
    if (place && (changed || movedAway)) {
      byteOffset = place.byteOffset;
      fraction = 0;
    }
    // The title waits on the shell, and a key can land while it does: fold that too, then look again. The last look is
    // followed by no wait, so nothing is typed between it and Source being hidden.
    for (;;) {
      if (changed && sourceEditor === editor) {
        editor.replaceBuffer(open.snapshot().buffer);
        await refreshTitle();
      }
      if (sourceEditor !== editor || store !== open || !leaveSourceMode(open.snapshot().buffer, editor.docText()).changed) break;
      if (!(await foldEditorInto(open, editor))) break;
      changed = true;
    }
    if (keepsSourceHeldApart(editor)) return;
    lastReadingByteOffset = byteOffset;
    lastReadingFraction = fraction;
    await showRendered(byteOffset, fraction);
    const now = open.snapshot();
    swapPlace = shown && store === open && viewMode === 'rendered'
      ? { path: now.path, version: now.version, exact: byteOffset, landed: currentPosition(scroller, shown.blocks, now.path, 'rendered') }
      : null;
  }

  /** Whether `editor` was held apart by the fold that just ran, so Source stays and says why (as at the top of `leaveSourceForRendered`). */
  function keepsSourceHeldApart(editor: MountedSourceEditor): boolean {
    if (sourceEditor !== editor || !stillHeldApart()) return false;
    notify({ kind: 'refused', text: SOURCE_HELD_APART }, { pane: paneOf(doc) });
    return true;
  }

  /**
   * A request for a mode, on the view's queue. `target` is the mode it asks for, fixed when it is made:
   * against the mode the requests before it end in, or the mode in force when there are none. It is dropped
   * while a document is opening here, and when a document opened after it was made: it meant the page the
   * reader was looking at, not the one that replaced it. `run` is done on the queue, with the block open in
   * place folded first, so Source shows what was typed there.
   */
  function requestMode(target: 'rendered' | 'source', run: () => Promise<void>): Promise<void> {
    const made = openings;
    modeRequests += 1;
    modeEndsIn = target;
    return serially(async () => {
      if (made !== openings || !store) return;
      await blockEdit?.fold();
      await run();
    }).finally(() => {
      modeRequests -= 1;
    });
  }

  /** `target` for the requests so far: a request that would only ask for the mode the queue ends in changes nothing. */
  function requestSwitchTo(target: 'rendered' | 'source'): Promise<void> {
    // A file with no store: its viewer draws both modes, and nothing is folded or set from bytes.
    if (viewer && !store) {
      if (opening > 0) return Promise.resolve();
      const made = openings;
      return serially(async () => {
        if (made === openings && viewer && !store && viewMode !== target) setModeChrome(target);
      });
    }
    if (!store || opening > 0) return Promise.resolve();
    return requestMode(target, async () => {
      if (viewMode === target) return;
      if (target === 'source') await enterSourceFromRendered();
      else await leaveSourceForRendered();
      const path = openPathNow();
      if (path && viewMode === target) deps.modeChosen?.(path, target);
    });
  }

  /** Mod+E: the other mode than the one the requests before it end in. */
  function toggleViewMode(): Promise<void> {
    return requestSwitchTo((modeRequests > 0 ? modeEndsIn : viewMode) === 'rendered' ? 'source' : 'rendered');
  }

  /** Read or Source (Mod+1, Mod+3): that mode, however many times it is asked for. */
  function setViewMode(target: 'rendered' | 'source'): Promise<void> {
    return requestSwitchTo(target);
  }

  function jumpToSource(byteOffset: number): Promise<void> {
    if (!store || opening > 0) return Promise.resolve();
    return requestMode('source', async () => {
      lastReadingFraction = 0;
      caretKept = false;
      await showSource(byteOffset);
      const path = openPathNow();
      if (path && viewMode === 'source') deps.modeChosen?.(path, 'source');
    });
  }

  function beginOpen(): () => void {
    opening += 1;
    openings += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      opening -= 1;
    };
  }

  function warmSource(path: string): void {
    void import('../source/warm.ts').then((m) => m.warmSourceEditor(path)).catch(() => {});
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
      bytes: () => bufferNow()?.bytes ?? null,
      onLayoutChanged: (changed) => {
        if (changed && changed.length > 0) snapChanged(doc, changed);
        else if (doc.childElementCount > SLICE_BLOCKS && mount !== null) void snapWhole(mount, doc);
        else snap(doc);
      },
    };
  }

  /** Holds `p` until the resize burst it was read for has been laid out, or the reader scrolls. */
  function holdThroughResize(p: ReadingPosition): void {
    resizeReleased.set(p, false);
    if (anchor !== null || (heldPosition !== null && heldPosition !== resizeHold)) return;
    resizeHold = p;
    heldPosition = p;
    listenForReaderScroll();
  }

  function releaseResizeHold(): void {
    for (const p of resizeReleased.keys()) resizeReleased.set(p, true);
    if (resizeHold === null) return;
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

  /** A change of variant, size or window width: same position, new layout. */
  async function relayoutKeepingReader(
    reason: 'theme' | 'resize' = 'theme',
    from: ReadingPosition | null = null,
  ): Promise<void> {
    const path = openPathNow();
    // A page that is no document (the frontispiece) has no place to keep, but its paragraphs were broken for the
    // width they were set at: a new width sets them again, or they overrun the columns of the new one.
    if (!path && !shown && typeset && viewMode === 'rendered') {
      typeset.relayout(reason);
      await typeset.ready;
      endResizeHold(from);
      return;
    }
    if (!path || !shown || viewMode !== 'rendered') {
      // Behind Source the paragraphs keep the old size or face: the page is set whole when Read next shows.
      if (shown && viewMode === 'source') markStale();
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
    // Held until the background passes are done too: they set the paragraphs off the screen again at the new width and
    // keep the place by the scroller's top, not its reading line, which then ended on another block.
    // A landing asked for during the burst (an open at a place, a jump) is newer than the place read before it: it stands.
    if (anchor !== null) holdAnchor();
    else if (reason === 'resize') await holdPosition({ ...pos, path, mode: 'rendered' });
    else restoreTo(shown.blocks, { ...pos, path, mode: 'rendered' });
  }

  /** A user theme was applied (theme/user-theme.ts): the typesetter sets every paragraph again. */
  async function relayoutForTheme(): Promise<void> {
    const set = typeset;
    const openPath = openPathNow();
    const blocks = shown?.blocks ?? null;
    if (!set || !openPath || !blocks) return;
    // Source is showing: the hidden page is not set again for a theme, it is set whole when Rendered next shows.
    if (viewMode === 'source') {
      markStale();
      return;
    }
    // The offset is read with the place and put back with it: what sits above the article (a notice that
    // comes or goes while the page is set) is not the reader's place, and the page leaves it where it was.
    const offset = contentOffset();
    const pos = positionOf(scroller, blocks, openPath, 'rendered', offset);
    set.relayout('theme');
    await set.ready;
    if (!shown || openPathNow() !== openPath || viewMode !== 'rendered') return;
    // Put back on the page as the new face set it: the list read before the relayout has the old heights.
    shown.blocks = blocksOf(doc);
    restoreTo(shown.blocks, { ...pos, path: openPath, mode: 'rendered' }, offset);
  }

  /**
   * Whether the page is behind Source. A hidden element keeps no computed style, so a grid pass over a hidden article
   * resolves the style of every block it reads from nothing: on a 2 MB page, seconds of the main thread in one task.
   * Nothing is lost by waiting: `showRendered` sets the page on the grid when it shows (and the typesetter and the
   * mount, `hold`, go on then).
   */
  function pageHidden(): boolean {
    return doc.hidden;
  }

  function snap(article: HTMLElement, from?: HTMLElement): void {
    cancelScheduledSnap();
    // The derived view is set by its own rules, not the grid pass: its block list is read, and the held place put back.
    if (derived) {
      if (pageHidden()) return;
      lastSnapAt = performance.now();
      if (shown) shown.blocks = derived.blocks();
      holdAnchor();
      return;
    }
    if (pageHidden()) {
      changedBlocks = null;
      wholeGeneration += 1;
      return;
    }
    if (from === undefined) {
      wholeGeneration += 1;
      changedBlocks = null;
    }
    lastSnapAt = performance.now();
    snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight), from ? { from } : undefined);
    if (shown) shown.blocks = blocksOf(article);
    holdAnchor();
  }

  /**
   * The grid pass for blocks that changed height by themselves, a highlight batch's: the blocks alone, and the
   * block list rebuilt, not the layout of every block of the article.
   */
  function snapChanged(article: HTMLElement, changed: readonly HTMLElement[]): void {
    if (pageHidden()) return;
    holdingScroll(() => snapBlocks(article, parseFloat(getComputedStyle(article).lineHeight), changed));
    if (shown) shown.blocks = updatedBlocks(article, shown.blocks, changed);
    holdAnchor();
  }

  /**
   * A height change still on its way to this view (a grid pass asked for, an island's resize, a colour report waiting for
   * its frame) is not in a patched list, nor is a chunk a mount is still adding: build whole then.
   */
  function changesPending(): boolean {
    return (mount !== null && !mount.isComplete()) || snapTimer !== 0 || snapFrame !== 0 || (changedBlocks !== null && changedBlocks.size > 0) || colourReportsWaiting();
  }

  /**
   * The block list after `changed` blocks changed height: read again only where they are, the rest moved by what they
   * moved. A reading, a derived view, or a list that does not fit is built whole.
   */
  function updatedBlocks(article: HTMLElement, before: BlockList, changed: readonly HTMLElement[]): BlockList {
    const whole = (): BlockList => {
      blockListStats.whole += 1;
      return blocksOf(article);
    };
    if (derived || reading || before.length === 0 || changesPending()) return whole();
    const tops = topLevelOf(article, changed);
    if (tops.length === 0) return whole();
    const patched = updateBlocks(article, before, tops, shown?.nodeMap ?? new Map());
    if (patched === null) return whole();
    blockListStats.patched += 1;
    blockListStats.verify?.(patched, article, shown?.nodeMap ?? new Map());
    return patched;
  }

  /**
   * Runs a grid pass without moving the reader. The pass takes padding off blocks and puts it back, and reads the
   * layout between: for that moment the page is shorter, the engine clamps the scroll offset to the shorter page, and the
   * offset is not given back when the page grows again. A reader who had jumped to the end was left a screen or more above it.
   */
  function holdingScroll(pass: () => void): void {
    const top = scroller.scrollTop;
    pass();
    if (scroller.scrollTop < top) scroller.scrollTop = top;
  }

  /** The whole-article pass for a document that has just become whole, in windows when it is long. */
  async function snapWhole(current: ProgressiveMount, article: HTMLElement): Promise<void> {
    cancelScheduledSnap();
    if (pageHidden()) return;
    const generation = (wholeGeneration += 1);
    lastSnapAt = performance.now();
    await snapInSlices(article, parseFloat(getComputedStyle(article).lineHeight), {
      size: SLICE_BLOCKS,
      around: holdingScroll,
      yieldNow: yieldToEventLoop,
      aborted: () => generation !== wholeGeneration || mount !== current || pageHidden(),
    });
    if (generation !== wholeGeneration || mount !== current || pageHidden()) return;
    if (shown) shown.blocks = blocksOf(article);
    holdAnchor();
  }

  function releaseAnchor(): void {
    anchor = null;
    anchorFraction = 0;
    heldPosition = null;
    releaseResizeHold();
    stopListeningForReaderScroll();
  }

  /**
   * Reader input releases what this view holds only when it is this view's. With the window as
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
      window.addEventListener(type, onReaderInput, { capture: true, passive: true, signal });
    }
  }

  /**
   * Nothing held, nothing to release: the listeners go. While any `wheel` listener is on the window,
   * WebKit repaints the whole page after every layout, so one left behind would cost every
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
    // A stored place names the block its fraction was read in, by the lookup `restoreTo` makes: not the innermost
    // block containing it, which can be another block starting at the same byte (a list and its first item).
    if (anchorFraction > 0) {
      restoreTo(shown.blocks, { path: openPath, byteOffset: anchor, fraction: anchorFraction, mode: 'rendered' });
      return;
    }
    const block = blockContaining(shown, anchor);
    if (block === undefined) return;
    // A byte inside a piece of code (up to 200 lines in one block) lands on its own line, not the piece's first: the
    // line's middle on the reading line, so the line read back from there (`codeLineAt`) is this one.
    const code = anchor > block.start ? codeBlock(block.start) : null;
    let line = -1;
    if (code) while (line + 1 < code.starts.length && code.starts[line + 1]! <= anchor) line++;
    restoreTo(shown.blocks, {
      path: openPath,
      byteOffset: block.start,
      fraction: code && line > 0 ? codeLineFraction(code.code, line, code.starts.length) : 0,
      mode: 'rendered',
    });
    if (landedAt !== null && landedAt.path === openPath) landedAt.top = scroller.scrollTop;
  }

  /**
   * Restores `position` on the page a re-render just made, and holds it there through the passes that
   * follow: until the reader scrolls, or until the document is wholly in and wholly set.
   */
  function holdPosition(position: HeldPosition): Promise<void> {
    mountThrough(position.byteOffset);
    if (!shown) return Promise.resolve();
    restoreTo(shown.blocks, position);
    listenForReaderScroll();
    anchor = null;
    heldPosition = position;
    const current = mount;
    return (async () => {
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
  function landOn(at: Landing | undefined, opts?: { from?: boolean }): void {
    if (at === undefined) return;
    const byte = byteOfLanding(at);
    mountThrough(byte);
    listenForReaderScroll();
    // A landing is the newest place asked for: a place held from before it (the launch's, a resize's) gives way.
    releaseResizeHold();
    heldPosition = null;
    anchor = (opts?.from ? shown?.blocks.find((block) => block.start >= byte)?.start : undefined) ?? byte;
    const path = openPathNow();
    landedAt = typeof at === 'number' && path ? { path, byte, top: scroller.scrollTop } : null;
    anchorFraction = typeof at === 'number' || anchor !== byte ? 0 : at.fraction;
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
    if (pageHidden()) {
      cancelScheduledSnap();
      changedBlocks = null;
      return;
    }
    const changed = changedBlocks;
    // Only blocks that changed height are asked for: the pass is over them. Anything else asked for is the pass it was.
    if (snapFrom === undefined && changed !== null && changed.size > 0) {
      cancelScheduledSnap();
      changedBlocks = null;
      lastSnapAt = performance.now();
      snapChanged(article, [...changed].filter((block) => block.isConnected));
      return;
    }
    snap(article, snapFrom ?? undefined);
    if (changed !== null && changedBlocks !== null) {
      changedBlocks = null;
      snapChanged(article, [...changed].filter((block) => block.isConnected));
    }
  }

  /** `from` asks only for the blocks from it on (the earliest asked wins); without it, the whole article. */
  function scheduleSnap(article: HTMLElement, from?: HTMLElement): void {
    if (from === undefined || snapFrom === null) snapFrom = null;
    else if (snapFrom === undefined || from.compareDocumentPosition(snapFrom) & Node.DOCUMENT_POSITION_FOLLOWING) snapFrom = from;
    armSnap(article);
  }

  /** `block` changed height by itself (an island's observer): the pass is over it, and not over the article from it on. */
  function scheduleChanged(article: HTMLElement, block: HTMLElement): void {
    (changedBlocks ??= new Set()).add(block);
    armSnap(article);
  }

  function armSnap(article: HTMLElement): void {
    if (snapTimer !== 0 || snapFrame !== 0 || pageHidden()) return;
    const wait = Math.max(0, lastSnapAt + SNAP_INTERVAL_MS - performance.now());
    snapTimer = window.setTimeout(() => {
      snapTimer = 0;
      snapFrame = requestAnimationFrame(() => {
        snapFrame = 0;
        snapPending(article);
      });
    }, wait);
  }

  /**
   * `discard`: the article's content is thrown away straight after (a new page, a close), so what the typesetter set is
   * left as it is; reverting every paragraph first is a write to each of them and a read of the layout between.
   */
  function destroyTypeset(discard = false): void {
    if (typeset) liveTypesetters.delete(typeset);
    typeset?.destroy(discard ? { discard: true } : undefined);
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
          if (block.parentElement === article) scheduleChanged(article, block);
        }
      });
    }
    for (const el of added) {
      if (el.matches(ISLANDS)) islandObserver.observe(el);
      for (const island of el.querySelectorAll(ISLANDS)) islandObserver.observe(island);
    }
  }

  function disconnectResizeObserver(): void {
    cancelResizeBurst?.();
    cancelResizeBurst = null;
    if (resizeObserver) liveResizeObservers -= 1;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (fontsLoaded) document.fonts.removeEventListener('loadingdone', fontsLoaded);
    fontsLoaded = null;
    islandObserver?.disconnect();
    islandObserver = null;
    endObserver?.disconnect();
    endObserver = null;
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
    document.fonts.addEventListener('loadingdone', fontsLoaded, { signal });
    liveResizeObservers += 1;
    const laidOut = () => !article.hidden && article.clientWidth > 0;
    // The reader's place before a burst of resizes: read from the block list the last layout built,
    // which the new width has not rebuilt yet, and put back once the relayout has set the page.
    let before: ReadingPosition | null = null;
    // A window that narrows with the article at its full measure still reflows what is wider than the
    // measure (tables, code): the article's height changes, its width does not.
    let viewportWidth = window.innerWidth;
    let rebreak = false;
    let settleResize: (() => void) | null = null;
    cancelResizeBurst = () => {
      clearTimeout(pending);
      endResizeHold(before);
      before = null;
      rebreak = false;
      settleResize?.();
      settleResize = null;
    };
    resizeObserver = new ResizeObserver(() => {
      // Hidden (Source mode) the article is zero-width: measuring now would zero every block position.
      if (!laidOut() || (article.clientWidth === width && window.innerWidth === viewportWidth)) return;
      rebreak ||= article.clientWidth !== width;
      width = article.clientWidth;
      viewportWidth = window.innerWidth;
      const path = openPathNow();
      if (before === null && path && shown) {
        // A place a repaint or a relayout holds is the reader's: the page under it is still being set, and a place read
        // off it now (a chunk mounted above, a pass not yet put back) would be held in its stead.
        const held = heldPosition !== null && heldPosition !== resizeHold && heldPosition.path === path ? heldPosition : null;
        before = held ?? exactly(currentPosition(scroller, shown.blocks, path, 'rendered'));
        if (scroller !== document.documentElement) holdThroughResize(before);
      }
      clearTimeout(pending);
      settleResize ??= (() => {
        let settle!: () => void;
        resizeSettled = new Promise<void>((resolve) => (settle = resolve));
        return settle;
      })();
      // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
      pending = window.setTimeout(() => {
        const settled = settleResize;
        settleResize = null;
        void (async () => {
          try {
            await afterBurst();
          } finally {
            settled?.();
          }
        })();
      }, 100);
    });
    /** The burst's end: put the place back, or relayout and hold it until the page is set again. */
    async function afterBurst(): Promise<void> {
      // A pane scrolled during the burst, its scroll event not come yet (it waits for a frame, and this runs first):
      // released now, as that event would, so the relayout does not put back the place read before it.
      if (scroller !== document.documentElement && scroller.scrollTop !== seen.scrollTop) releaseAnchor();
      const position = before;
      const relayout = rebreak;
      before = null;
      rebreak = false;
      if (!laidOut()) {
        endResizeHold(position);
        return;
      }
      if (relayout) {
        await relayoutKeepingReader('resize', position);
        return;
      }
      snap(article);
      if (!endResizeHold(position)) return;
      // A landing or a hold in force was put back by the pass (`holdAnchor`): the place read at the burst's start is older.
      if (anchor !== null || heldPosition !== null) return;
      if (position && shown && position.path === openPathNow() && viewMode === 'rendered') {
        restoreTo(shown.blocks, position);
      }
    }
    resizeObserver.observe(article);
    // The page changes height under a reader who jumped to the end: the end stays where they put it.
    endObserver = new ResizeObserver(() => {
      if (!endPinned || article.hidden || viewMode !== 'rendered') return;
      if (distanceToEnd() > 2) scroller.scrollTop = scroller.scrollHeight;
    });
    endObserver.observe(article);
  }

  /**
   * Everything one shown document started: its mount, its subscription, its typesetter, its resize
   * observer, a pending grid pass and its Source editor. Run before the next document replaces it, so
   * N opens leave one of each and not N — each old observer would otherwise relayout on every resize.
   * The store is not the view's: whoever opened it closes it.
   */
  function clear(keepSourceShowing = false): void {
    if (viewer) {
      viewer.destroy();
      viewer = null;
      viewerMount?.replaceChildren();
      viewerMount?.removeAttribute('data-marxy-viewer');
      hideViewerMount();
      // The article was hidden under the viewer's page; the next document's page is shown by its own open.
      if (viewMode === 'rendered') doc.hidden = false;
    }
    blockEdit?.discard();
    blockEdit = null;
    doc.removeAttribute('data-marxy-empty');
    mount?.cancel();
    mount = null;
    derived?.destroy();
    rowsView?.destroy();
    rowsView = null;
    linesView?.destroy();
    linesView = null;
    derived = null;
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    shown = null;
    pageStale = false;
    plainText = false;
    swapPlace = null;
    releaseAnchor();
    destroyTypeset(true);
    disconnectResizeObserver();
    cancelScheduledSnap();
    // The editor in this view's mount too, whoever made it: it must not outlive the page it was built for,
    // or the next Source entry would reuse an editor holding the previous document. Only this
    // mount's: another view's editor is its own.
    const shared = activeSourceEditorIn?.(sourceHost) ?? null;
    const leaving = sourceEditor ?? shared;
    // An open that is coming leaves the old text on screen until the next document can take its place, as a
    // picture of it and never as the editor: the editor is destroyed here, as ever, so it cannot be typed into with
    // no store behind it, reused for the next file, or destroyed twice.
    const kept =
      keepSourceShowing && viewMode === 'source' && leaving
        ? { picture: pictureOfSource(leaving), top: leaving.view.scrollDOM.scrollTop }
        : null;
    dropSourceKeeper();
    sourceEditor?.destroy();
    if (shared && shared !== sourceEditor) shared.destroy();
    sourceEditor = null;
    heldApart = false;
    if (kept) {
      dropRetiredSource();
      retiredPicture = kept.picture;
      sourceHost.replaceChildren(kept.picture);
      kept.picture.querySelector('.cm-scroller')?.scrollTo({ top: kept.top });
    } else if (!(keepSourceShowing && retiredPicture)) {
      dropRetiredSource();
      sourceHost.replaceChildren();
    }
  }

  /** The old Source text kept on screen while an open replaces it: not an editor, inert, gone when the next page shows. */
  let retiredPicture: HTMLElement | null = null;

  function pictureOfSource(editor: MountedSourceEditor): HTMLElement {
    // The whole frame when the editor is in one: it gives the editor its height, its bars and its scroll box.
    const picture = (editor.view.dom.closest('.marxy-source-frame') ?? editor.view.dom).cloneNode(true) as HTMLElement;
    picture.classList.remove('cm-focused');
    for (const el of picture.querySelectorAll('.cm-focused')) el.classList.remove('cm-focused');
    for (const el of picture.querySelectorAll('[contenteditable]')) el.setAttribute('contenteditable', 'false');
    picture.setAttribute('inert', '');
    picture.setAttribute('aria-hidden', 'true');
    picture.style.pointerEvents = 'none';
    return picture;
  }

  /** The picture of the old Source text goes. */
  function dropRetiredSource(): void {
    retiredPicture?.remove();
    retiredPicture = null;
  }

  /** Source text the reader typed and has not yet folded into the store: the store cannot see it. */
  function unfoldedSourceEdits(): boolean {
    // Text typed in a block open in place is the same kind of thing: the store does not have it.
    if (blockEdit?.dirty()) return true;
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
   * removed.
   */
  function replaceSourceBuffer(editor: MountedSourceEditor, next: Buffer): void {
    const old = editor.buffer;
    // Text a fold of this view made ready against the old bytes is out of date: it would write the change out.
    if (!sameBytes(old.bytes, next.bytes)) bytesChangedUnder += 1;
    const before = editor.view.state;
    const { anchor, head } = before.selection.main;
    // Positions through the old text's separator and BOM, back through the new text's.
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
   * reload, a rename) and for `commitEdit` of unchanged bytes; the blocks that differ are replaced, not the page,
   * where the splice can be shown to give the same page. `landing`, when given, is the anchor
   * the view held, mapped through the change: it is held again rather than released.
   */
  function repaint(
    snapshot: DocumentSnapshot,
    position: ReadingPosition,
    landing: number | null = null,
    spanned = false,
    wholeBecause: string | null = null,
  ): void {
    // Every path that changes the store while Source shows folds the editor's text first (undo, redo, save,
    // rename) or refuses (commitEdit), so the editor holds nothing the store lacks here. If it does (another
    // pane changed the store under it), the editor is held apart: its text is kept, not reset, and
    // its folds are refused, so neither the reader's text nor the store's change is written over.
    if (sourceEditor && !heldApart && holdsUnfoldedText(sourceEditor, snapshot.buffer)) {
      console.error('marxy: Source held unfolded text at a repaint; the editor keeps it, held apart');
      holdApart();
    }
    if (sourceEditor && !heldApart) replaceSourceBuffer(sourceEditor, snapshot.buffer);
    releaseAnchor();
    // The file is on screen as plain text because Source would not mount: its new bytes, as plain text.
    if (plainText) {
      showPlainText();
      settlePage(Promise.resolve());
      return;
    }
    if (viewMode === 'source' && sourceEditor) {
      // Source shows and the window is its scroller: the place goes back into the editor, not onto the hidden
      // article, whose block list has nothing measured to place it by. The article is not set, gridded or
      // anchored for a reader who cannot see it: it is marked stale, and `showRendered` sets it once, in view.
      markStale(wholeBecause === null);
      lastReadingByteOffset = position.byteOffset;
      lastReadingFraction = 0;
      sourceEditor.scrollToByte(position.byteOffset);
      settlePage(Promise.resolve());
      return;
    }
    const t0 = performance.now();
    // A file that opened in Source has no page yet: Source has the new bytes, and Rendered is made from
    // them when the reader first asks for it, so nothing is made now for a page nobody sees.
    const unmade = pageUnmade();
    // Whatever changed the bytes, only the blocks that differ are replaced when that can be shown to give the
    // whole render; otherwise the page is set whole. `wholeBecause` names a caller whose page must be set whole.
    const fell = unmade ? null : wholeBecause ?? splicePage(snapshot);
    if (fell !== null) rerenderFromBuffer(landing ?? position.byteOffset);
    const typesetting = fell === null ? (typeset?.ready ?? Promise.resolve()) : typesetDocument();
    if (landing !== null) {
      landOn(landing, { from: spanned });
    } else {
      holdPosition({ ...position, path: snapshot.path });
    }
    recordRepaint(t0, fell);
    settlePage(typesetting);
  }

  /**
   * What the last repaint did and how long it took, for a measurement or a test to read
   * (`performance.getEntriesByName('marxy:repaint')`): nothing in the app reads it, and nothing leaves the page.
   */
  function recordRepaint(start: number, fell: string | null): void {
    try {
      performance.measure('marxy:repaint', {
        start,
        end: performance.now(),
        detail: fell === null ? { how: 'replaced' } : { how: 'whole', reason: fell },
      });
    } catch {
      // A page with no user-timing: nothing to read it.
    }
  }

  /**
   * The page after a change, with only the blocks it touched replaced (render/incremental.ts).
   * Null when it was done; else why the page must be rendered whole, with nothing in it changed.
   */
  function splicePage(snapshot: DocumentSnapshot): string | null {
    try {
      return splicePageNow(snapshot);
    } catch (e) {
      // Whatever it did to the page, the whole render that follows replaces: the page is never left half done.
      console.warn(`marxy: the blocks a change touched could not be replaced; rendering the page whole: ${String(e)}`);
      return `the replacement failed: ${String(e)}`;
    }
  }

  /** The stale page brought up to the store's document by replacing the blocks that differ; false when it must be set whole. */
  function spliceStalePage(): boolean {
    if (!store || plainText || reading) return false;
    const t0 = performance.now();
    const snapshot = store.snapshot();
    blockEdit?.release(null, snapshot, null);
    const fell = splicePage(snapshot);
    recordRepaint(t0, fell);
    if (fell !== null) return false;
    pageStale = false;
    return true;
  }

  function splicePageNow(snapshot: DocumentSnapshot): string | null {
    const prior = shown;
    const record = prior?.render ?? null;
    if (!prior || !record || !mount) return 'the page was not set from a whole render';
    if (reading || readingFor(snapshot)) return 'a reading is set whole';
    if (viewMode !== 'rendered' || doc.hidden) return 'the page is not showing';
    const file = snapshot.path;
    if (record.htmlGranted !== trust.grantsFor(file).html) return 'the trust grant changed';
    const result = spliceRendered(
      record,
      snapshot.ast,
      { live: doc, pending: mount.pending() },
      { policy: trust.policyFor(file), prepare: (parsed) => prepareParsed(parsed, file, partsPage(file, snapshot.ast, snapshot.buffer)) },
    );
    if (!result.spliced) return result.reason;
    const { record: next, added, from, removed } = result.value;
    const { ast, nodeMap } = snapshot;
    const policy = trust.policyFor(file);
    shown = openDocumentOf(ast, nodeMap, prior.blocks, next, () => renderDocumentSafeHtml(ast, policy).html);
    // The blocks that came in join what the page watches and sets; the rest of them are as they were.
    watchIslands(doc, added);
    typeset?.adopt(added);
    afterRender();
    trust.showNotices(removed, blockedImagesFrom(removed), { path: file, buffer: snapshot.buffer, pane: paneOf(doc) });
    shown.blocks = builtList(doc, buildBlocks(doc, nodeMap));
    if (from !== null) {
      // Under the change the grid is what it was, off by what the change added or removed. Near the end of the
      // page that is a few blocks, set now; in the middle of a long one it is every block below, set at idle.
      let below = 0;
      for (let el = from.nextElementSibling; el !== null && below <= SYNC_SNAP_BLOCKS; el = el.nextElementSibling) below++;
      if (below <= SYNC_SNAP_BLOCKS) snap(doc, from);
      else scheduleSnap(doc, from);
    }
    deferAfterComplete(mount, file);
    return null;
  }

  /**
   * A render that throws after the store committed: the change stands — it is in the buffer and
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
   * from disk or followed a rename (two panes on one file): the store could not see it, so it moved
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
    if (change.kind === 'reload') diskChangedEditsKeptNotice({ pane: paneOf(doc) });
    void foldEditorInto(open, editor).catch((e: unknown) =>
      console.warn(`marxy: Source text could not be kept over a change on disk: ${String(e)}`),
    );
    return true;
  }

  /**
   * A fold committed to the store this view shows, from this view or another (two panes on one file).
   * Two safe cases only: the editor already reads as the store (this view's own fold), so it is
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
    // This view's own fold, with a key typed since it began: the store reads as the text that was folded, so
    // this is the reader's next keystroke and not another pane's change. `foldEditorInto` folds it next.
    if (foldingText.some((folded) => !leaveSourceMode(snapshot.buffer, folded).changed)) return;
    holdApart();
  }

  /** The Source text each of this view's folds is putting into the store, until the store has it. */
  const foldingText: string[] = [];

  /**
   * How many times the store's bytes changed under this view's editor by something other than its own fold: the
   * editor took them (`replaceSourceBuffer`), so a fold prepared before is out of date.
   */
  let bytesChangedUnder = 0;

  /**
   * Folds the editor's text into the store, and again for whatever was typed while the fold waited its turn (the
   * store's queue, a save's own steps), until the store reads as the editor; then the editor takes the store's bytes.
   * Taking them over a key typed meanwhile would replace the text and delete it: that key is folded too, one more
   * history entry, so the next save writes it. Resolves whether any fold changed the store.
   *
   * A fold diffs its text against the store at its turn, so one made ready before another pane's fold landed would
   * write that fold out (B's text, gone, when A's key came while B left). The store asks this view at the turn
   * (`refuse`): held apart by then, or its editor took other bytes, the fold does not go. The text stays in the
   * editor, held apart or folded again from the bytes it now has; and what the other pane folded stays in the store.
   */
  async function foldEditorInto(open: DocumentStore, editor: MountedSourceEditor): Promise<boolean> {
    let any = false;
    for (;;) {
      const text = editor.docText();
      const stamp = bytesChangedUnder;
      foldingText.push(text);
      try {
        any = (await open.commitSource(text, { refuse: () => heldApart || bytesChangedUnder !== stamp })) || any;
      } finally {
        foldingText.splice(foldingText.indexOf(text), 1);
      }
      // Held apart while the fold waited: the editor keeps its text, and taking the store's bytes over it would lose it.
      if (heldApart) return any;
      if (editor.docText() !== text) continue;
      if (any && sourceEditor === editor && store === open) editor.replaceBuffer(open.snapshot().buffer);
      return any;
    }
  }

  /**
   * This pane's Source text and the store went different ways under it: the editor keeps its text
   * and the store keeps the other pane's, and the reader is told. Until the editor's text reads as the
   * store's again, or this pane opens a document again, its folds are refused (on blur, before a save,
   * an undo or a close) and so is leaving Source, which would fold: nothing of one pane is written over
   * the other's. Its text still counts as unsaved, so a close, an open over it or quitting asks first.
   */
  function holdApart(): void {
    if (!heldApart) notify({ kind: 'refused', text: SOURCE_HELD_APART }, { pane: paneOf(doc) });
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

  /** Whether `change` sets the page again: a block open in place cannot stay on a page that is replaced. */
  function setsPage(before: DocumentSnapshot, snapshot: DocumentSnapshot, change: Transition): boolean {
    switch (change.kind) {
      case 'open':
      case 'close':
      case 'save':
        return false;
      case 'reload':
        return snapshot.buffer !== before.buffer;
      default:
        return true;
    }
  }

  /** The page's side of a committed transition on the shown store. */
  function followTransition(before: DocumentSnapshot, snapshot: DocumentSnapshot, change: Transition): void {
    if (keepTypedText(before, snapshot, change)) return;
    // Read is a page of the app's own: no article is set from the bytes; Source's editor follows a fold as ever, and the
    // viewer draws the new bytes when it next shows.
    if (viewer?.owns('rendered')) {
      if (change.kind === 'commitSource' && sourceEditor && viewMode === 'source') followFoldIn(sourceEditor, snapshot);
      if (setsPage(before, snapshot, change)) {
        markStale();
        viewer.refresh?.();
      }
      settlePage(Promise.resolve());
      return;
    }
    // A block open in place: the reader's place is read with it on the page, as the reader sees it, and
    // it closes just before the page is set again, putting back any text the store does not have.
    const editing = blockEdit !== null && setsPage(before, snapshot, change) ? blockEdit : null;
    if (editing && shown) shown.blocks = blocksOf(doc);
    switch (change.kind) {
      case 'open':
      case 'close':
        return;
      case 'save':
        // A Save as moved the store to another name: the parse the page resolves through follows it.
        if (change.renamedFrom !== undefined && shown && !derived) {
          // The name changed what the file is read as (a scratch Markdown page saved as `.py`, or the reverse):
          // the page is set again from the new parse, as for a rename, not kept under it.
          if (parserOfPath(change.renamedFrom) !== parserOfPath(change.path)) break;
          const was = shown;
          shown = openDocumentOf(snapshot.ast, snapshot.nodeMap, was.blocks, was.render, () => was.html);
        }
        settlePage(Promise.resolve());
        return;
      case 'commitSource':
        // A Rendered view over a store another view folded Source text into (two panes on one file) is set
        // again as for any edit: its own place mapped through the fold's splice, not sent to the top.
        if (viewMode === 'rendered') break;
        // Leaving Source (or folding before a save or a rename): the caller restores the position. Another
        // view's fold reaches this view's editor too, or its next fold would write the old text back.
        if (sourceEditor) followFoldIn(sourceEditor, snapshot);
        // A pane in Source shows no article, and a fold only moves text from the editor into the store:
        // the page is set when Rendered next shows, not now, from every fold.
        if (viewMode === 'source' && doc.hidden) {
          markStale(true);
          return;
        }
        try {
          editing?.release(before, snapshot, change);
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
    // The place was read in the bytes before the change; the page is set in the bytes after it.
    const position = { ...read, byteOffset: mapThroughTransition(change, read.byteOffset) };
    // A held anchor is mapped through a splice. A reload is not a splice: its place is the watcher's,
    // already mapped through the new bytes (`reloadAt`), and the anchor's old offset means nothing in
    // them, so the page holds that place instead, as before.
    const landing =
      anchor !== null && viewMode === 'rendered' && change.kind !== 'reload' ? mapThroughTransition(change, anchor) : null;
    // An anchor the edit removed lands on the edit's start: the block from there on is held, not the one above.
    const spanned = landing !== null && anchor !== null && removedBy(change, anchor);
    try {
      editing?.release(before, snapshot, change);
      repaint(snapshot, position, landing, spanned, change.kind === 'rename' ? 'the file was renamed' : null);
    } catch (e) {
      showRenderFailure(e);
    }
  }

  /** The page follows `next` for as long as it is the shown store (readers subscribe). */
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
      // to two and back) is followed without a new typesetter.
      scroller: () => scroller,
      // The typesetter's own move keeps the place: not a scroll that releases what this view holds (`onScrollerScroll`).
      onPlaceKept: noteScroll,
      // Every restore here notes where it put the scroller (`onScrollerScroll` tells its own scrolls the same way).
      ownScroll: () => scroller.scrollTop === seen.scrollTop,
      hold: pageHidden,
      // An open find holds Ranges placed from its walk of the text nodes; set in new nodes, those would leave the page.
      inPlace: () => article.ownerDocument.querySelector('.marxy-find') !== null,
      onPass: (kind, set) => {
        if (kind === 'background') scheduleSnap(article);
        // A visible pass is announced only when lines moved, and names the paragraphs it set: the grid pass is over the
        // blocks holding them, not every block of the article.
        else if (kind === 'visible' && set !== undefined && set.length > 0 && !derived) snapChanged(article, topLevelOf(article, set));
        else snap(article);
      },
    });
    liveTypesetters.add(typeset);
    return typeset;
  }

  /**
   * The typesetter, after first text: the reader sees the engine's wrapping for at most a
   * frame, then the viewport set with hyphenation and hanging punctuation, and the rest in idle time.
   */
  async function typesetDocument(): Promise<void> {
    // The derived view is not a page of paragraphs to set.
    if (derived) return;
    const controller = startTypeset(doc);
    const current = mount;
    await controller.ready;
    const { viewportMs, hyphenationLoadMs, typeset: set } = controller.stats;
    await shell.mark('typeset_viewport', Date.now(), `ms=${viewportMs.toFixed(1)} hyphenation_load_ms=${hyphenationLoadMs.toFixed(1)} set=${set}`);
    // `typeset_done`: every paragraph of the whole document considered. Never awaited, so first
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
    if (plainText) return showPlainText();
    if (pageUnmade()) return;
    // Source is showing (a trust change reaches here): the page is set when Rendered next shows.
    if (viewMode === 'source' && sourceEditor) {
      markStale();
      return;
    }
    if (readsAsTranscript(store.snapshot().path)) {
      rerenderTranscript(at);
      return;
    }
    pageStale = false;
    const made = store.snapshot();
    const { path: file, buffer } = made;
    // The page is about to go: a block open in place goes with it, its text kept (a trust change, a fold of
    // another view). The transitions that reach here have released it already, with their change.
    blockEdit?.release(null, store.snapshot(), null);
    const byteOffset = typeof at === 'number' ? at : at?.byteOffset;
    // The parse is read only where the page needs it: a reading (a log's Lines) is set from the bytes, and a log that grew
    // is not parsed whole again for it.
    const { html, removed, blockedImages } = pageOf({ path: file, buffer, get ast() { return made.ast; } });
    destroyTypeset(true);
    const granted = trust.grantsFor(file).html;
    shown = {
      get ast() {
        return made.ast;
      },
      html,
      get nodeMap() {
        return made.nodeMap;
      },
      blocks: [],
      render: reading ? { get ast() { return made.ast; }, removed, htmlGranted: granted } : renderRecord(made.ast, removed, granted),
    };
    const mounted = mountDocument(html, file, reading ? null : partsPage(file, made.ast, buffer), byteOffset);
    afterRender();
    trust.showNotices(removed, blockedImages, { path: file, buffer, pane: paneOf(doc) });
    snap(doc);
    startTypeset(doc);
    // A page made here for the first time (a document that opened in Source) has no resize observer or
    // font listener yet: `show` gives them to a page it makes.
    if (resizeObserver === null) keepOnGrid(doc);
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
   * The shown document's HTML into the article through its one mount: all of it at once under the
   * threshold, else the first screens (from `landing` down, when given) now and the rest in idle chunks
   * once `start` settles. Replaces, and cancels, the mount of whatever was shown before.
   */
  /**
   * The derived view over the store's bytes, in place of whatever the article held, its first rows through `at` drawn now.
   * A view it replaces hands on its filters. `shown` is the store's document, read only when asked, with no node
   * map: nothing on this page resolves to an AST node.
   */
  function mountDerived(at?: number): void {
    const open = store;
    if (!open || !transcriptModule) return;
    const { path, buffer } = open.snapshot();
    const carry = derived?.state() ?? null;
    derived?.destroy();
    rowsView?.destroy();
    rowsView = null;
    linesView?.destroy();
    linesView = null;
    derived = null;
    mount?.cancel();
    mount = null;
    destroyTypeset(true);
    cancelScheduledSnap();
    pageStale = false;
    shown = {
      get ast() {
        return open.snapshot().ast;
      },
      html: '',
      nodeMap: new Map(),
      blocks: [],
      render: null,
    };
    derived = transcriptModule.mountTranscript({
      article: doc,
      bytes: buffer.bytes,
      path,
      through: at,
      carry: carry ? { only: carry.only, toolsCollapsed: carry.toolsCollapsed } : undefined,
      onGrow: () => {
        if (derived && !pageHidden()) scheduleSnap(doc);
      },
      jumpToSource: (start, end) => jumpToSourceRange(start, end),
      openSource: () => requestSwitchTo('source'),
    });
    if (!pageHidden()) shown.blocks = derived.blocks();
  }

  /** The derived view again from the store's bytes, at `at` (a reload, an edit folded in from Source). */
  function rerenderTranscript(at?: number | Pick<ReadingPosition, 'byteOffset' | 'fraction'>): void {
    if (!transcriptModule) {
      // Not loaded yet (the file opened in Source): it is loaded, and the view made when it is, if Read still shows.
      markStale();
      void loadTranscriptModule().then(() => {
        if (store && viewMode === 'rendered' && pageStale) rerenderFromBuffer(at);
      });
      return;
    }
    const byteOffset = typeof at === 'number' ? at : at?.byteOffset;
    // An append (the agent wrote on): the view derives and draws only the new lines, the rows on the page
    // stay, and the place is held by the caller as for any reload. Anything else is derived again from the start.
    const open = store;
    if (derived && open && derived.update(open.snapshot().buffer.bytes)) {
      pageStale = false;
      if (shown && !pageHidden()) shown.blocks = derived.blocks();
      return;
    }
    mountDerived(byteOffset);
    afterRender();
    if (resizeObserver === null) keepOnGrid(doc);
    if (at !== undefined && typeof at !== 'number' && shown && store) {
      mountThrough(at.byteOffset);
      restoreTo(shown.blocks, { path: store.snapshot().path, byteOffset: at.byteOffset, fraction: at.fraction, mode: 'rendered' });
    }
  }

  /** The open of a JSONL session in Read: the derived view's first rows, then the open goes on as for a page. */
  async function showTranscript(next: DocumentStore, opts?: { at?: Landing; onMounted?: () => void }): Promise<RenderEvidence> {
    await loadTranscriptModule();
    if (store !== next) throw new Error('the document was replaced while its transcript view loaded');
    if (viewMode === 'source') {
      setModeChrome('rendered');
      dropRetiredSource();
    }
    mountDerived(opts?.at === undefined ? undefined : byteOfLanding(opts.at));
    afterRender();
    opts?.onMounted?.();
    await shell.mark('rendered', Date.now());
    await shell.mark('first_screen', Date.now(), `blocks=${doc.querySelectorAll('.marxy-turn, .marxy-unreadable, .marxy-pending').length} bytes=${derived?.state().bytesRead ?? 0}`);
    keepOnGrid(doc);
    landOn(opts?.at);
    const evidence = deps.measure.renderEvidence(doc);
    await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
    return evidence;
  }

  /** Source with bytes `[start, end)` selected: the derived view's Jump to source. */
  async function jumpToSourceRange(start: number, end: number): Promise<void> {
    await jumpToSource(start);
    const editor = sourceEditor;
    const buffer = bufferNow();
    if (!editor || !buffer || viewMode !== 'source') return;
    const state = editor.view.state;
    const from = utf16ToCmPos(buffer, state as CmStateLike, byteToUtf16(buffer, start));
    const to = utf16ToCmPos(buffer, state as CmStateLike, byteToUtf16(buffer, end));
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    editor.scrollToByte(start);
    editor.view.dom.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true });
  }

  /**
   * What a parsed page gets before it is mounted: each fenced part read on its own, remote images stripped, and a break
   * put in any run of text too long to lay out, a part's reading's text included.
   */
  function prepareParsed(parsed: HTMLElement, file: string, page: PartsPage | null): void {
    if (page) readParts(parsed, page);
    guardLongRuns(parsed);
    stripNonLocalImages(parsed, file);
    markBlockDirections(parsed);
  }

  function mountDocument(html: string, file: string, page: PartsPage | null, landing?: number, start?: Promise<unknown>, parsed?: HTMLElement): ProgressiveMount {
    mount?.cancel();
    cancelScheduledSnap();
    endPinned = false;
    // The repository root the images and links resolve against: asked once, never waited on.
    void resolveImageRoot(file, (path) => deps.rootFor(path));
    const t0 = performance.now();
    let chunks = 0;
    const current: ProgressiveMount = mountProgressively(doc, html, {
      landing,
      start,
      parsed,
      prepare: (parsed) => prepareParsed(parsed, file, page),
      hold: pageHidden,
      onChunk: (added) => {
        if (mount !== current) return;
        chunks += 1;
        // A reading's runs are appended inside its root (render/progressive.ts): the grid pass is from the root.
        let first: HTMLElement = added[0]!;
        while (first.parentElement && first.parentElement !== doc) first = first.parentElement;
        scheduleSnap(doc, first);
        watchIslands(doc, added);
        typeset?.adopt(added);
      },
    });
    mount = current;
    attachRows(current);
    attachLines(current);
    void current.complete.then(() => {
      if (mount !== current || !current.isComplete() || chunks === 0) return;
      // The last chunk's blocks are on the grid before anything reads the whole document.
      completePass = snapWhole(current, doc);
      void shell.mark('content_complete', Date.now(), `ms=${(performance.now() - t0).toFixed(1)} chunks=${chunks}`);
    });
    return current;
  }

  /**
   * Appends, now, every block up to the one holding `byte` and the screens below it, then puts what
   * was appended on the grid and in the block list, so a position can be restored there at once.
   */
  function mountThrough(byte: number): void {
    if (derived) {
      derived.ensureThrough(byte);
      if (shown && !pageHidden()) shown.blocks = derived.blocks();
      return;
    }
    if (mount && !mount.isComplete()) {
      const before = doc.childElementCount;
      mount.ensureThrough(byte);
      if (doc.childElementCount !== before) snapPending(doc);
    }
    if (rowsView?.windowed()) {
      rowsView.ensureThrough(byte);
      if (shown && !pageHidden()) shown.blocks = blocksOf(doc);
    }
    if (linesView) {
      linesView.ensureThrough(byte);
      if (shown && !pageHidden()) shown.blocks = blocksOf(doc);
    }
  }

  /**
   * Images, KaTeX and highlighting see the whole document: they run once the mount is
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

  /** Each call supersedes the ones before it on the same mount: a reload during the first mount must not run the passes twice. */
  let deferredGeneration = 0;
  function deferAfterComplete(current: ProgressiveMount, file: string): void {
    const generation = ++deferredGeneration;
    void afterComplete(current, () => (generation === deferredGeneration ? whenIdle(deferredStartup(file)) : Promise.resolve()));
  }

  /** A file that opened in Source has made no page, and Source is showing: nothing sets a page now. */
  function pageUnmade(): boolean {
    return mount === null && pageStale && viewMode === 'source';
  }

  /**
   * The open of a document whose mode is Source: Source first, and no page. The Rendered page is made
   * when the reader first asks for Rendered (`showRendered` finds the page stale and renders it then), so
   * nothing Markdown-shaped is made, let alone painted, for a Python file on its way to Source. The evidence
   * first text is measured on is Source's text, or the plain text a failed mount fell back to.
   */
  async function showInSource(
    next: DocumentStore,
    opts: { at?: number; onMounted?: () => void },
  ): Promise<RenderEvidence> {
    const file = next.snapshot().path;
    // A page that is not on screen yet: `document()` still answers, and the parse (which the store has not made
    // for a file that opens in Source) and the HTML are made when read.
    const unmade: OpenDocument = {
      get ast() {
        return next.snapshot().ast;
      },
      get nodeMap() {
        return next.snapshot().nodeMap;
      },
      get html() {
        return pageOf(next.snapshot()).html;
      },
      blocks: [],
      render: null,
    };
    shown = unmade;
    markStale();
    await showSource(opts.at ?? 0);
    if (store !== next) throw new Error('the document was replaced while Source was mounted');
    // The page of whatever was open before is behind Source now, hidden; it goes. (A failed mount has put the
    // file's plain text there instead.)
    if (viewMode === 'source') doc.replaceChildren();
    afterRender();
    opts.onMounted?.();
    await shell.mark('rendered', Date.now());
    const evidence = sourceEvidence();
    await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
    return evidence;
  }

  /**
   * A text file whose Read is a viewer's page (an SVG): no page is made from its bytes (Source's text is the store's, and
   * a page is made only if the reader ever asks for one), and Read shows the viewer.
   */
  async function showUnderViewer(next: DocumentStore, opts: { onMounted?: () => void }): Promise<RenderEvidence> {
    const unmade: OpenDocument = {
      get ast() {
        return next.snapshot().ast;
      },
      get nodeMap() {
        return next.snapshot().nodeMap;
      },
      get html() {
        return pageOf(next.snapshot()).html;
      },
      blocks: [],
      render: null,
    };
    shown = unmade;
    markStale();
    dropRetiredSource();
    sourceHost.replaceChildren();
    doc.replaceChildren();
    setModeChrome('rendered');
    afterRender();
    opts.onMounted?.();
    await shell.mark('rendered', Date.now());
    return { blocks: 0, chars: 0, hasText: false, heading: '' };
  }

  /** A file with no store: its viewer draws Read and Source; the page and the editor of what was open before go. */
  async function showViewer(next: PaneViewer, opts?: { onMounted?: () => void; mode?: 'rendered' | 'source' }): Promise<RenderEvidence> {
    clear(false);
    viewer = next;
    shown = null;
    pageStale = false;
    dropRetiredSource();
    sourceHost.replaceChildren();
    doc.replaceChildren();
    // A file that holds a private key opens in Read whatever the layout or the pane remembered; Source is one press away.
    setModeChrome(next.bytesHidden ? 'rendered' : (opts?.mode ?? 'rendered'));
    afterRender();
    opts?.onMounted?.();
    await shell.mark('rendered', Date.now());
    return { blocks: 0, chars: 0, hasText: false, heading: '' };
  }

  /** What first text is measured on when Source is what showed: its lines and the file's characters. */
  function sourceEvidence(): RenderEvidence {
    const buffer = bufferNow();
    if (viewMode !== 'source' || !buffer) return deps.measure.renderEvidence(doc);
    const text = buffer.text;
    return { blocks: sourceHost.querySelectorAll('.cm-line').length, chars: text.length, hasText: /\S/.test(text), heading: '' };
  }

  /** The render half of an open: the store's snapshot into the article through the `render` mark. */
  async function show(
    next: DocumentStore,
    opts?: { at?: Landing; start?: Promise<unknown>; onMounted?: () => void; sliced?: boolean; source?: boolean; viewer?: PaneViewer },
  ): Promise<RenderEvidence> {
    if (store !== null || viewer !== null) clear(true);
    pageStale = false;
    store = next;
    follow(next);
    const landing = opts?.at === undefined ? undefined : byteOfLanding(opts.at);
    if (opts?.viewer) viewer = opts.viewer;
    if (opts?.source === true) return showInSource(next, { ...opts, at: landing });
    if (opts?.viewer) return showUnderViewer(next, opts);
    if (readsAsTranscript(next.snapshot().path)) return showTranscript(next, opts);
    const opened = next.snapshot();
    let { path: file, buffer } = opened;
    // The parse is read through the snapshot only where the page needs it: a reading is set from the bytes alone, and a
    // store that left its parse for later (open.ts) is not made to make it here.
    let tree: Pick<DocumentSnapshot, 'ast' | 'nodeMap'> = opened;
    const abandoned = (): boolean => store !== next;
    // A large document beside another pane: rendered, then parsed into the inert body, in slices. A document
    // the sliced render declines (raw HTML left open) is rendered whole, as ever.
    const slicedPolicy = trust.policyFor(file);
    let slices =
      opts?.sliced === true && readingFor(opened) === null
        ? await renderDocumentSafeHtmlInSlices(tree.ast, { policy: slicedPolicy, yieldNow: yieldToEventLoop, aborted: abandoned })
        : null;
    if (store !== next) throw new Error('the document was replaced while it was rendered');
    let inert =
      slices !== null && slices.html.length >= DEFAULT_THRESHOLD
        ? await parseInertInSlices(slices.pieces, (holder) => prepareParsed(holder, file, { path: file, ast: tree.ast, bytes: buffer.bytes }), yieldToEventLoop, undefined, abandoned)
        : undefined;
    // A pane opening beside another gives the frame back between the stages that each take most of one.
    if (opts?.sliced) await yieldToEventLoop();
    if (store !== next) throw new Error('the document was replaced while it was parsed');
    // The last await is behind us, and the store went on while they ran (the other pane of a same-file pair
    // edited it, or the file was read again): the page is made from the store as it is now, whole, so that
    // `shown`, the page and the version the selection will stamp are one document. Slicing resumes with the
    // next open; this one has nothing left to give the frame back for.
    const latest = next.snapshot();
    // A grant made while the slices rendered leaves them sanitised under the old policy: the page is made whole under the new one.
    const policyMoved = slices !== null && trust.policyFor(file).name !== slicedPolicy.name;
    if (policyMoved) {
      slices = null;
      inert = undefined;
    }
    if (latest !== opened && latest.ast !== tree.ast) {
      ({ path: file, buffer } = latest);
      tree = latest;
      slices = null;
      inert = undefined;
    }
    if (slices) reading = null;
    const { html, removed, blockedImages } = slices ?? pageOf({ path: file, buffer, get ast() { return tree.ast; } });
    console.info(`marxy: sanitiser removed ${removed.length}`);
    const granted = trust.grantsFor(file).html;
    const made = tree;
    shown = {
      get ast() {
        return made.ast;
      },
      html,
      get nodeMap() {
        return made.nodeMap;
      },
      blocks: [],
      render: reading ? { get ast() { return made.ast; }, removed, htmlGranted: granted } : renderRecord(made.ast, removed, granted),
    };
    // A document opened from Source takes Rendered's place now, with its page laid out and visible for every pass
    // below, not set while hidden behind the old document's text until the open ends.
    if (viewMode === 'source') {
      setModeChrome('rendered');
      dropRetiredSource();
    }
    // Only the first screens go in now; images are checked before any block reaches the page.
    mountDocument(html, file, reading ? null : partsPage(file, made.ast, buffer), landing, opts?.start, inert);
    afterRender();
    opts?.onMounted?.();
    await shell.mark('rendered', Date.now());
    await shell.mark('first_screen', Date.now(), `blocks=${doc.childElementCount} bytes=${mountedBytes(doc)}`);
    trust.showNotices(removed, blockedImages, { path: file, buffer, pane: paneOf(doc) });
    if (opts?.sliced) await yieldToEventLoop();
    void doc.offsetHeight;
    await document.fonts.ready;
    // No face list here: reading `document.fonts` made WebKit restyle the whole article as soon
    // as the bundled fonts had loaded, seconds at 1 MB booked to the grid stage. The restyle still
    // happens at the next style read, but now while the article holds only the first screens.
    await shell.mark('fonts_ready', Date.now());
    // The grid pass also builds the block list the reading position is read from.
    if (opts?.sliced) await yieldToEventLoop();
    keepOnGrid(doc);
    landOn(opts?.at);
    const evidence = deps.measure.renderEvidence(doc);
    await shell.mark('render', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);
    return evidence;
  }

  /**
   * This view scrolls `next` from now on: the scroll listeners move to it, and the reader's place,
   * read from where the old scroller was last seen, is put back on it and held through the passes that
   * follow (the width changes with the scroller, so the typesetter re-breaks the page). A pending open's
   * anchor is kept instead, unless `given` names the place to hold (a pane closing on its left hands the
   * survivor's place, fraction and all, to the first pane). Source keeps its own place. The
   * typesetter reads `scroller` at each pass, so it holds the reader's place on `next` from here.
   */
  function rebindScroller(next: HTMLElement, given?: ReadingPosition): void {
    const path = openPathNow();
    const before =
      given ?? (shown && path && viewMode === 'rendered' ? currentPosition(seen, shown.blocks, path, 'rendered') : null);
    if (next !== scroller) {
      scrollTarget(scroller).removeEventListener('scroll', onScrollerScroll);
      scroller = next;
      scrollTarget(scroller).addEventListener('scroll', onScrollerScroll, { passive: true, signal });
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
    showViewer,
    viewer: () => viewer,
    store: () => store,
    rerender: (at) => rerenderFromBuffer(at),
    repaint() {
      const snapshot = store?.snapshot();
      if (!snapshot || !shown) return;
      repaint(snapshot, sourcePosition(snapshot.path) ?? currentPosition(scroller, shown.blocks, snapshot.path, 'rendered'), null, false, 'the bytes are unchanged');
    },
    settled: () => settledPage,
    expectReloadAt(p) {
      reloadAt = p;
    },
    atEnd: () => viewMode === 'rendered' && !doc.hidden && (endPinned || ((mount === null || mount.isComplete()) && distanceToEnd() <= 2)),
    followEnd() {
      if (viewMode !== 'rendered' || doc.hidden) return;
      releaseAnchor();
      scroller.scrollTop = scroller.scrollHeight;
      noteScroll();
      endPinned = true;
      pinnedTop = scroller.scrollTop;
      pinnedAt = performance.now();
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
    contentComplete: async () => {
      await mount?.complete;
      await completePass;
      await resizeSettled;
      await derived?.settled();
    },
    get mode() {
      return viewMode;
    },
    toggleMode: toggleViewMode,
    setMode: setViewMode,
    beginOpen,
    warmSource,
    jumpToSource,
    focusSource,
    showSource,
    leaveSource: leaveSourceForRendered,
    showRenderedChrome: () => setModeChrome('rendered'),
    async foldSource() {
      const open = store;
      // The block open in place folds as Source does: one history entry, and the editor closes.
      if (blockEdit) return blockEdit.fold();
      if (!open || viewMode === 'rendered' || !sourceEditor || stillHeldApart()) return false;
      return foldEditorInto(open, sourceEditor);
    },
    sourceHasUnfoldedEdits: unfoldedSourceEdits,
    sourceHeldApart: stillHeldApart,
    get blockEdit() {
      return blockEdit;
    },
    set blockEdit(next) {
      blockEdit = next;
    },
    holdPlace(change) {
      const path = openPathNow();
      if (!shown || !path || viewMode !== 'rendered' || doc.hidden) return change();
      // The block list as the page is now, not as the last grid pass left it: what the reader sees is what they hold.
      shown.blocks = blocksOf(doc);
      const place = currentPosition(scroller, shown.blocks, path, 'rendered');
      change();
      shown.blocks = blocksOf(doc);
      restoreTo(shown.blocks, place);
    },
    followGrowth(el, by) {
      if (by === 0 || viewMode !== 'rendered' || doc.hidden || !el.isConnected) return;
      // Its bottom before it changed: a block the reading line crosses grows under the reader, who stays on it.
      if (el.getBoundingClientRect().bottom - by > readingLinePx()) return;
      scroller.scrollTop += by;
      noteScroll();
    },
    typeset: typesetDocument,
    deferredWork(file) {
      // The derived view has no images, math or code to highlight after it: nothing waits on it.
      if (derived) return async () => {};
      // Once the whole document is in (at once under the threshold); later chunks do not hold the open
      // up, so the reader can switch mode or open another document while they are appended.
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
      life.abort();
      offReadingSort();
      rowsView?.destroy();
      rowsView = null;
      linesView?.destroy();
      linesView = null;
      offWideTables();
      offPartChoice();
      offColourChoice();
      offTreeWays();
      offTreeStart();
    },
  };
  return view;
}
