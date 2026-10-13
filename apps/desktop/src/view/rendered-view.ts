// The per-article view (B-13; ADR-0037 Amendment 1, point 2): everything about showing one document
// store in one article. It owns the render into the article, the mode and the Source editor, the
// typesetter, grid scheduling, the anchor, the resize observer, the block list and the mount. The
// store owns the bytes; the view subscribes to the store it shows and sets the page again when they
// change. Nothing here is held at module scope, so a second view can be created beside the first.

import { byteToUtf16, contentHash, isCodeFile, utf16ToByte, type Buffer, type Document } from '@marxy/core';
import { offsetThroughEdit } from '@marxy/core/src/position/restore.ts';
import { blockedImagesFrom, renderDocumentSafeHtml, renderDocumentSafeHtmlInSlices } from '@marxy/core/src/render/index.ts';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import { attach, snapBlocks, snapInSlices, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { AppShell } from '../app.ts';
import type { AppContext } from '../commands/registry.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import { wireArticle } from '../commands/document.ts';
import type { DocumentSnapshot, DocumentStore, Transition } from '../document/store.ts';
import { documentName } from '../document/untitled.ts';
import { currentPosition as positionOf, restoreScrollToPosition, type HeldPosition } from '../position/index.ts';
import type { ScrollerGeometry } from '../position/position.ts';
import { renderRecord, spliceRendered, type RenderRecord } from '../render/incremental.ts';
import { resolveImageRoot, stripNonLocalImages } from '../render/images.ts';
import { buildBlocks, nodeFor, type BlockList, type NodeMap } from '../render/post.ts';
import { DEFAULT_THRESHOLD, mountProgressively, parseInertInSlices, type ProgressiveMount } from '../render/progressive.ts';
import { yieldToEventLoop } from '../startup/yield.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { diskChangedEditsKeptNotice } from '../notices/disk.ts';
import { notify, paneOf, SOURCE_HELD_APART } from '../notices/index.ts';
import { cmDocText, leaveSourceMode } from '../source/buffer-commit.ts';
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
    readonly dom: HTMLElement;
    readonly state: CmStateLike & { readonly selection: { readonly main: { readonly anchor: number; readonly head: number } } };
    dispatch(spec: { selection: { anchor: number; head: number } }): void;
  };
}

/**
 * One block open for editing in place (E-04, commands/block-edit.ts): a CodeMirror editor where the block's
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
  /** Rendered element → AST node, through its byte range (ADR-0023). */
  readonly nodeMap: NodeMap;
  /** Refreshed whenever layout moves them; built once here for now (MARXY-38 reads them). */
  blocks: BlockList;
  /** What the page was rendered from, for the next reload to replace only what it changed (B-24); null when none. */
  readonly render: RenderRecord | null;
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
   * are in and the selection has been told, before the `rendered` mark. `sliced` (D-15) renders and parses a
   * large document a few milliseconds at a time with the event loop given back between slices, for a pane
   * opening beside another: the page it makes is the same, and first text comes a little later.
   *
   * `source` (V-11): the document opens in Source, so no page is made for it now. Source is mounted at `at`
   * (a failed mount says so and shows the file as plain text), the Rendered page is made when the reader first
   * asks for Rendered, and the evidence is Source's own text.
   */
  show(
    store: DocumentStore,
    opts?: { at?: number; start?: Promise<unknown>; onMounted?: () => void; sliced?: boolean; source?: boolean },
  ): Promise<RenderEvidence>;
  /**
   * An open of a document begins in this view (V-11): until the returned function is called a mode press is
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
  /** Rendered to Source or back, on the view's queue: each call is a request against the mode the calls before it end in. */
  toggleMode(): Promise<void>;
  /** `mode`, on the view's queue; a call for the mode the calls before it end in changes nothing (V-11). */
  setMode(mode: 'rendered' | 'source'): Promise<void>;
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
  /** Source text this view's fold cannot take because another pane's fold went another way (D-11): a save would not write it. */
  sourceHeldApart(): boolean;
  /** The block open for editing in place in this view's article, or null (E-04). The block-edit command sets and clears it. */
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
  /**
   * Releases everything the shown document started (today's `teardownDocument`); the view can show again.
   * `keepSourceShowing`: an open is under way and Source stays on screen, with the old text in it, until the next
   * document's first screens replace it (V-15); `show` takes it away.
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
/** Blocks in a window of the whole-article grid pass made when a long document is wholly in (F-80). */
const SLICE_BLOCKS = 128;
/** How long after the reader's own input a scroll up is theirs (F-80), and how long after landing at the end the engine may move the page. */
const PIN_INPUT_MS = 600;
const PIN_SETTLE_MS = 3000;

const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

/**
 * A reload replaces only the blocks it changed (B-24) in a document of at least this many bytes. Under it a
 * whole render costs a few milliseconds and is the one path with nothing to prove.
 */
const INCREMENTAL_MIN_BYTES = 64 * 1024;
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
  ): HeldPosition =>
    positionOf(geometry, inScroller(blocks, geometry === seen ? seenOffset : contentOffset()), path, mode);
  const onScrollerScroll = (): void => {
    // A scroll nobody here made (every restore notes its own, and the event finds nothing moved) is the
    // reader's or a script's, and releases whatever this view is holding the place with, as the reader's
    // input does: a hold put back after it would undo it (F-27, from the D-13 review: a scroll made just
    // after a pane opened was reset to the top).
    if (scroller !== document.documentElement && scroller.scrollTop !== seen.scrollTop) releaseAnchor();
    noteScroll();
    notePinned();
    for (const cb of [...scrollListeners]) cb();
  };
  const distanceToEnd = (): number => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  /**
   * Whether this scroll is the reader at the end of the whole page, or away from it (F-80). A scroll up the reader did not
   * make, soon after they landed at the end, is the engine's (laying out a piece that has just come near the screen can
   * move the offset with the height unchanged): the end is put back. A scroll up after the reader's own input, or
   * after the settling time, is theirs and ends the pin.
   */
  const notePinned = (): void => {
    const top = scroller.scrollTop;
    if (top > 0 && distanceToEnd() <= 2 && viewMode === 'rendered' && (mount === null || mount.isComplete())) {
      endPinned = true;
      pinnedTop = top;
      pinnedAt = performance.now();
      return;
    }
    if (!endPinned || top >= pinnedTop - 1) return;
    const now = performance.now();
    // The reader's wheel is not listened for (a wheel listener makes WebKit repaint the whole page after every layout, B-02.8):
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
  for (const type of PIN_INPUT_TYPES) window.addEventListener(type, onPinInput, { capture: true, passive: true });
  /** WebKit fires the viewport's scroll at the Document, not at documentElement. */
  const scrollTarget = (el: HTMLElement): EventTarget => (el === document.documentElement ? document : el);
  scrollTarget(scroller).addEventListener('scroll', onScrollerScroll, { passive: true });

  /** Puts `p` on the reading line of this view's scroller, and notes where that left it. */
  function restoreTo(blocks: BlockList, p: HeldPosition, offset: number = contentOffset()): void {
    restoreScrollToPosition(scroller, inScroller(blocks, offset), p);
    noteScroll();
  }

  /** The store this view shows, and its subscription. */
  let store: DocumentStore | null = null;
  let unsubscribe: (() => void) | null = null;
  /** `{ ast, html, nodeMap, blocks }` of the page on screen. */
  let shown: OpenDocument | null = null;

  let viewMode: 'rendered' | 'source' = 'rendered';
  /** The block open for editing in place (E-04); closed before the page under it is set again. */
  let blockEdit: BlockEdit | null = null;
  let sourceEditor: MountedSourceEditor | null = null;
  /** The accessor for the editor in a Source mount, once the editor module has loaded (it stays off the start-up path). */
  let activeSourceEditorIn: ((parent: HTMLElement) => MountedSourceEditor | null) | null = null;
  let lastReadingByteOffset = 0;
  let lastReadingFraction = 0;
  /**
   * Mode requests not yet done (Mod+E, Read, Source, Jump to source), and the mode the last of them ends in
   * (V-11). A press is a request against the mode the queue before it ends in, so ten presses end where ten
   * flips would, and none is dropped for arriving while another is under way.
   */
  let modeRequests = 0;
  let modeEndsIn: 'rendered' | 'source' = 'rendered';
  /** Opens under way in this view, and a count of them started: see `beginOpen`. */
  let opening = 0;
  let openings = 0;
  /**
   * The file is shown as plain text in Rendered because Source could not be mounted and no page was ever made
   * for it (K-R4): a reload sets that text again and does not render the file as Markdown in its place.
   */
  let plainText = false;
  /**
   * The hidden article is behind the store: a fold committed while Source showed (B-27) did not set it from
   * the new bytes, since nobody can see it. Whatever shows Rendered again sets it first (`showRendered`).
   * Any whole render, and a close or an open, make it current again.
   */
  let pageStale = false;
  /** This pane's Source text and the store went different ways under it (D-11; `holdApart`). */
  let heldApart = false;
  /** The line on the reading line just after Source was shown; leaving from it with no edit is exact. */
  let sourceEntryPlace: number | null = null;
  /** Bumped each time Source is shown, so a late measurement of an earlier visit is dropped. */
  let sourceSession = 0;
  /**
   * Where the last leave of Source landed Rendered: the exact byte it came from, and what Rendered read as its
   * place once it was there (the block under the reading line is a paragraph, a whole code file, never a line).
   * Going back to Source from the place it landed on, with nothing changed, returns to that byte, not to the
   * start of the block (V-15).
   */
  let swapPlace: { path: string; version: number; exact: number; landed: ReadingPosition } | null = null;
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
  let heldPosition: HeldPosition | null = null;
  /**
   * The place a burst of resizes holds (F-27): taken when the first resize is noticed, ended when its
   * relayout has set the page. Reader input in between releases it (`releaseAnchor`), and the relayout
   * then leaves the reader where they put themselves instead of putting back the place read before.
   */
  let resizeHold: ReadingPosition | null = null;
  /** Each resize hold's place, until its relayout ends: whether the reader released it. */
  const resizeReleased = new WeakMap<ReadingPosition, boolean>();

  let lastSnapAt = 0;
  /** Bumped by every whole-article pass; a sliced one asks whether it is still the latest between windows (F-80). */
  let wholeGeneration = 0;
  /** The whole-article pass made when the mount completed: `contentComplete` waits for it, so the page is on the grid when it resolves. */
  let completePass: Promise<void> = Promise.resolve();
  /**
   * True from a scroll that lands at the very end of a wholly mounted page until the reader scrolls up (F-80): the
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
  /** The blocks whose own height changed since the last pass, for the next (F-80). */
  let changedBlocks: Set<HTMLElement> | null = null;
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

  /** Source at `byteOffset`; rejects when the editor cannot be made (`showSource` says so instead). */
  async function mountSource(byteOffset: number): Promise<void> {
    releaseAnchor();
    lastReadingByteOffset = byteOffset;
    sourceEntryPlace = null;
    const editor = await ensureSourceEditor();
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
   * shown there as plain text (K-R4).
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
    // No page was ever made for this file (it opens in Source): the reader still gets its text, as it is.
    const bare = mount === null;
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
    setModeChrome('rendered');
    const path = openPathNow();
    // Folds that came in while Source showed left the page as it was (B-27): set it from the store's bytes now.
    if (pageStale && shown && path) {
      try {
        rerenderFromBuffer(byteOffset);
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
    const pos = currentPosition(scroller, shown.blocks, path, 'rendered');
    const exact = exactPlaceOf(pos, path);
    lastReadingByteOffset = exact ?? pos.byteOffset;
    lastReadingFraction = exact === null ? pos.fraction : 0;
    await showSource(lastReadingByteOffset);
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
    // Held apart from the other pane's fold (D-11): leaving would fold this text over it. Stay, and say why.
    if (stillHeldApart()) {
      notify({ kind: 'refused', text: SOURCE_HELD_APART }, { pane: paneOf(doc) });
      return;
    }
    // Leaving Source is one history entry (`commitSource`): Mod+Z in Rendered undoes what was typed there.
    // The page follows the store: its subscription sets the article from the new bytes, so nothing
    // resolves an operation through an AST, node map or block list built from the old ones.
    // A key typed while the fold waits is folded too (F-42.1): taking the store's bytes over it would delete it.
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
   * A request for a mode, on the view's queue (V-11). `target` is the mode it asks for, fixed when it is made:
   * against the mode the requests before it end in, or the mode in force when there are none. It is dropped
   * while a document is opening here, and when a document opened after it was made: it meant the page the
   * reader was looking at, not the one that replaced it. `run` is done on the queue, with the block open in
   * place folded first, so Source shows what was typed there (E-04).
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
    if (!store || opening > 0) return Promise.resolve();
    return requestMode(target, async () => {
      if (viewMode === target) return;
      if (target === 'source') await enterSourceFromRendered();
      else await leaveSourceForRendered();
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
      await showSource(byteOffset);
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
      onLayoutChanged: (changed) => {
        if (changed && changed.length > 0) snapChanged(doc, changed);
        else if (doc.childElementCount > SLICE_BLOCKS && mount !== null) void snapWhole(mount, doc);
        else snap(doc);
      },
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
    // Source is showing: the hidden page is not set again for a theme, it is set whole when Rendered next shows (V-15).
    if (viewMode === 'source') {
      pageStale = true;
      return;
    }
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
    if (from === undefined) {
      wholeGeneration += 1;
      changedBlocks = null;
    }
    lastSnapAt = performance.now();
    snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight), from ? { from } : undefined);
    if (shown) shown.blocks = buildBlocks(article, shown.nodeMap);
    holdAnchor();
  }

  /**
   * The grid pass for blocks that changed height by themselves, a highlight batch's (F-80): the blocks alone, and the
   * block list rebuilt, not the layout of every block of the article.
   */
  function snapChanged(article: HTMLElement, changed: readonly HTMLElement[]): void {
    holdingScroll(() => snapBlocks(article, parseFloat(getComputedStyle(article).lineHeight), changed));
    if (shown) shown.blocks = buildBlocks(article, shown.nodeMap);
    holdAnchor();
  }

  /**
   * Runs a grid pass without moving the reader (F-80). The pass takes padding off blocks and puts it back, and reads the
   * layout between: for that moment the page is shorter, the engine clamps the scroll offset to the shorter page, and the
   * offset is not given back when the page grows again. A reader who had jumped to the end was left a screen or more above it.
   */
  function holdingScroll(pass: () => void): void {
    const top = scroller.scrollTop;
    pass();
    if (scroller.scrollTop < top) scroller.scrollTop = top;
  }

  /** The whole-article pass for a document that has just become whole, in windows when it is long (F-80). */
  async function snapWhole(current: ProgressiveMount, article: HTMLElement): Promise<void> {
    cancelScheduledSnap();
    const generation = (wholeGeneration += 1);
    lastSnapAt = performance.now();
    await snapInSlices(article, parseFloat(getComputedStyle(article).lineHeight), {
      size: SLICE_BLOCKS,
      around: holdingScroll,
      yieldNow: yieldToEventLoop,
      aborted: () => generation !== wholeGeneration || mount !== current,
    });
    if (generation !== wholeGeneration || mount !== current) return;
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
  function holdPosition(position: HeldPosition): void {
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
    const changed = changedBlocks;
    // Only blocks that changed height are asked for: the pass is over them (F-80). Anything else asked for is the pass it was.
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

  /** `block` changed height by itself (an island's observer): the pass is over it, and not over the article from it on (F-80). */
  function scheduleChanged(article: HTMLElement, block: HTMLElement): void {
    (changedBlocks ??= new Set()).add(block);
    armSnap(article);
  }

  function armSnap(article: HTMLElement): void {
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
    // The page changes height under a reader who jumped to the end: the end stays where they put it (F-80).
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
    blockEdit?.discard();
    blockEdit = null;
    mount?.cancel();
    mount = null;
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    shown = null;
    pageStale = false;
    plainText = false;
    swapPlace = null;
    releaseAnchor();
    destroyTypeset();
    disconnectResizeObserver();
    cancelScheduledSnap();
    // The editor in this view's mount too, whoever made it: it must not outlive the page it was built for,
    // or the next Source entry would reuse an editor holding the previous document (F-12). Only this
    // mount's: another view's editor is its own (D-01).
    const shared = activeSourceEditorIn?.(sourceHost) ?? null;
    const leaving = sourceEditor ?? shared;
    // An open that is coming leaves the old text on screen until the next document can take its place, as a
    // picture of it and never as the editor: the editor is destroyed here, as ever, so it cannot be typed into with
    // no store behind it, reused for the next file, or destroyed twice (V-15).
    const kept =
      keepSourceShowing && viewMode === 'source' && leaving
        ? { picture: pictureOfSource(leaving), top: leaving.view.scrollDOM.scrollTop }
        : null;
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
    // The whole frame when the editor is in one (V-05): it gives the editor its height, its bars and its scroll box.
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
    // Text typed in a block open in place is the same kind of thing: the store does not have it (E-04).
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
   * removed (F-19.3).
   */
  function replaceSourceBuffer(editor: MountedSourceEditor, next: Buffer): void {
    const old = editor.buffer;
    // Text a fold of this view made ready against the old bytes is out of date: it would write the change out (F-48).
    if (!sameBytes(old.bytes, next.bytes)) bytesChangedUnder += 1;
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
  function repaint(
    snapshot: DocumentSnapshot,
    position: ReadingPosition,
    landing: number | null = null,
    spanned = false,
    reload = false,
  ): void {
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
    // The file is on screen as plain text because Source would not mount (K-R4): its new bytes, as plain text.
    if (plainText) {
      showPlainText();
      settlePage(Promise.resolve());
      return;
    }
    if (viewMode === 'source' && sourceEditor) {
      // Source shows and the window is its scroller: the place goes back into the editor, not onto the hidden
      // article, whose block list has nothing measured to place it by (F-04). The article is not set, gridded or
      // anchored for a reader who cannot see it: it is marked stale, and `showRendered` sets it once, in view (V-15).
      pageStale = true;
      lastReadingByteOffset = position.byteOffset;
      lastReadingFraction = 0;
      sourceEditor.scrollToByte(position.byteOffset);
      settlePage(Promise.resolve());
      return;
    }
    const t0 = performance.now();
    // A file that opened in Source has no page yet (V-11): Source has the new bytes, and Rendered is made from
    // them when the reader first asks for it, so nothing is made now for a page nobody sees.
    const unmade = pageUnmade();
    // A reload replaces only the blocks it changed when it can show that the result is the whole render (B-24);
    // anything else sets the page whole, as every other transition does.
    const fell = unmade ? null : reload ? splicePage(snapshot) : 'not a reload';
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
   * The page after a reload, with only the blocks the change touched replaced (B-24, render/incremental.ts).
   * Null when it was done; else why the page must be rendered whole, with nothing in it changed.
   */
  function splicePage(snapshot: DocumentSnapshot): string | null {
    try {
      return splicePageNow(snapshot);
    } catch (e) {
      // Whatever it did to the page, the whole render that follows replaces: the page is never left half done.
      console.warn(`marxy: the blocks a reload changed could not be replaced; rendering the page whole: ${String(e)}`);
      return `the replacement failed: ${String(e)}`;
    }
  }

  function splicePageNow(snapshot: DocumentSnapshot): string | null {
    const prior = shown;
    const record = prior?.render ?? null;
    if (!prior || !record || !mount) return 'the page was not set from a whole render';
    if (viewMode !== 'rendered' || doc.hidden) return 'the page is not showing';
    if (snapshot.buffer.bytes.length < INCREMENTAL_MIN_BYTES) return 'a small document';
    const file = snapshot.path;
    if (record.htmlGranted !== trust.grantsFor(file).html) return 'the trust grant changed';
    const result = spliceRendered(
      record,
      snapshot.ast,
      { live: doc, pending: mount.pending() },
      { policy: trust.policyFor(file), prepare: (parsed) => stripNonLocalImages(parsed, file) },
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
    trust.showNotices(removed, blockedImagesFrom(removed));
    shown.blocks = buildBlocks(doc, nodeMap);
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
    if (change.kind === 'reload') diskChangedEditsKeptNotice({ pane: paneOf(doc) });
    void foldEditorInto(open, editor).catch((e: unknown) =>
      console.warn(`marxy: Source text could not be kept over a change on disk: ${String(e)}`),
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
    // This view's own fold, with a key typed since it began (F-42): the store reads as the text that was folded, so
    // this is the reader's next keystroke and not another pane's change. `foldEditorInto` folds it next.
    if (foldingText.some((folded) => !leaveSourceMode(snapshot.buffer, folded).changed)) return;
    holdApart();
  }

  /** The Source text each of this view's folds is putting into the store, until the store has it (F-42). */
  const foldingText: string[] = [];

  /**
   * How many times the store's bytes changed under this view's editor by something other than its own fold: the
   * editor took them (`replaceSourceBuffer`), so a fold prepared before is out of date (F-48).
   */
  let bytesChangedUnder = 0;

  /**
   * Folds the editor's text into the store, and again for whatever was typed while the fold waited its turn (the
   * store's queue, a save's own steps), until the store reads as the editor; then the editor takes the store's bytes.
   * Taking them over a key typed meanwhile would replace the text and delete it (F-42): that key is folded too, one more
   * history entry, so the next save writes it. Resolves whether any fold changed the store.
   *
   * A fold diffs its text against the store at its turn, so one made ready before another pane's fold landed would
   * write that fold out (F-48: B's text, gone, when A's key came while B left). The store asks this view at the turn
   * (`refuse`): held apart by then (D-11), or its editor took other bytes, the fold does not go. The text stays in the
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
   * This pane's Source text and the store went different ways under it (D-11): the editor keeps its text
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

  /** Whether `change` sets the page again: a block open in place cannot stay on a page that is replaced (E-04). */
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
    // A block open in place (E-04): the reader's place is read with it on the page, as the reader sees it, and
    // it closes just before the page is set again, putting back any text the store does not have.
    const editing = blockEdit !== null && setsPage(before, snapshot, change) ? blockEdit : null;
    const ownCommit = editing?.owns(change) ?? false;
    if (editing && shown) shown.blocks = buildBlocks(doc, shown.nodeMap);
    switch (change.kind) {
      case 'open':
      case 'close':
        return;
      case 'save':
        // A Save as moved the store to another name: the parse the page resolves through follows it.
        if (change.renamedFrom !== undefined && shown) {
          // The name changed what the file is read as (a scratch Markdown page saved as `.py`, or the reverse, V-10):
          // the page is set again from the new parse, as for a rename, not kept under it.
          if (isCodeFile(change.renamedFrom) !== isCodeFile(change.path)) break;
          const was = shown;
          shown = openDocumentOf(snapshot.ast, snapshot.nodeMap, was.blocks, was.render, () => was.html);
        }
        settlePage(Promise.resolve());
        return;
      case 'commitSource':
        // A Rendered view over a store another view folded Source text into (two panes on one file) is set
        // again as for any edit: its own place mapped through the fold's splice, not sent to the top (D-10).
        if (viewMode === 'rendered') break;
        // Leaving Source (or folding before a save or a rename): the caller restores the position. Another
        // view's fold reaches this view's editor too, or its next fold would write the old text back (D-11).
        if (sourceEditor) followFoldIn(sourceEditor, snapshot);
        // A pane in Source shows no article, and a fold only moves text from the editor into the store:
        // the page is set when Rendered next shows, not now, from every fold (B-27).
        if (viewMode === 'source' && doc.hidden) {
          pageStale = true;
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
      editing?.release(before, snapshot, change);
      // The editor's own commit replaces only the block it changed, as a reload does (B-24): a long page is not rendered whole for a typo.
      repaint(snapshot, position, landing, spanned, change.kind === 'reload' || ownCommit);
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
    if (plainText) return showPlainText();
    if (pageUnmade()) return;
    // Source is showing (a trust change reaches here): the page is set when Rendered next shows (V-15).
    if (viewMode === 'source' && sourceEditor) {
      pageStale = true;
      return;
    }
    pageStale = false;
    const { path: file, ast, nodeMap, buffer } = store.snapshot();
    // The page is about to go: a block open in place goes with it, its text kept (a trust change, a fold of
    // another view). The transitions that reach here have released it already, with their change (E-04).
    blockEdit?.release(null, store.snapshot(), null);
    const byteOffset = typeof at === 'number' ? at : at?.byteOffset;
    const { html, removed, blockedImages } = renderDocumentSafeHtml(ast, trust.policyFor(file));
    destroyTypeset();
    shown = { ast, html, nodeMap, blocks: [], render: renderRecord(ast, removed, trust.grantsFor(file).html) };
    const mounted = mountDocument(html, file, byteOffset);
    afterRender();
    trust.showNotices(removed, blockedImages, { path: file, buffer, pane: paneOf(doc) });
    snap(doc);
    startTypeset(doc);
    // A page made here for the first time (a document that opened in Source, V-11) has no resize observer or
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
   * The shown document's HTML into the article through its one mount (A-02): all of it at once under the
   * threshold, else the first screens (from `landing` down, when given) now and the rest in idle chunks
   * once `start` settles. Replaces, and cancels, the mount of whatever was shown before.
   */
  function mountDocument(html: string, file: string, landing?: number, start?: Promise<unknown>, parsed?: HTMLElement): ProgressiveMount {
    mount?.cancel();
    cancelScheduledSnap();
    endPinned = false;
    // The repository root the images and links resolve against (F-14): asked once, never waited on.
    void resolveImageRoot(file, (path) => deps.rootFor(path));
    const t0 = performance.now();
    let chunks = 0;
    const current: ProgressiveMount = mountProgressively(doc, html, {
      landing,
      start,
      parsed,
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

  /** Each call supersedes the ones before it on the same mount: a reload during the first mount must not run the passes twice. */
  let deferredGeneration = 0;
  function deferAfterComplete(current: ProgressiveMount, file: string): void {
    const generation = ++deferredGeneration;
    void afterComplete(current, () => (generation === deferredGeneration ? whenIdle(deferredStartup(file)) : Promise.resolve()));
  }

  /** A file that opened in Source (V-11) has made no page, and Source is showing: nothing sets a page now. */
  function pageUnmade(): boolean {
    return mount === null && pageStale && viewMode === 'source';
  }

  /**
   * The open of a document whose mode is Source (V-11): Source first, and no page. The Rendered page is made
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
        return renderDocumentSafeHtml(next.snapshot().ast, trust.policyFor(file)).html;
      },
      blocks: [],
      render: null,
    };
    shown = unmade;
    pageStale = true;
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

  /** What first text is measured on when Source is what showed: its lines and the file's characters. */
  function sourceEvidence(): RenderEvidence {
    const buffer = bufferNow();
    if (viewMode !== 'source' || !buffer) return deps.measure.renderEvidence(doc);
    const text = buffer.text;
    return { blocks: sourceHost.querySelectorAll('.cm-line').length, chars: text.length, hasText: /\S/.test(text), heading: '' };
  }

  /** The render half of an open (MARXY-183): the store's snapshot into the article through the `render` mark. */
  async function show(
    next: DocumentStore,
    opts?: { at?: number; start?: Promise<unknown>; onMounted?: () => void; sliced?: boolean; source?: boolean },
  ): Promise<RenderEvidence> {
    if (store !== null) clear(true);
    pageStale = false;
    store = next;
    follow(next);
    if (opts?.source === true) return showInSource(next, opts);
    let { path: file, ast, nodeMap, buffer } = next.snapshot();
    const abandoned = (): boolean => store !== next;
    // A large document beside another pane: rendered, then parsed into the inert body, in slices. A document
    // the sliced render declines (a footnote, raw HTML left open) is rendered whole, as ever.
    let slices =
      opts?.sliced === true ? await renderDocumentSafeHtmlInSlices(ast, { policy: trust.policyFor(file), yieldNow: yieldToEventLoop, aborted: abandoned }) : null;
    if (store !== next) throw new Error('the document was replaced while it was rendered');
    let inert =
      slices !== null && slices.html.length >= DEFAULT_THRESHOLD
        ? await parseInertInSlices(slices.pieces, (holder) => stripNonLocalImages(holder, file), yieldToEventLoop, undefined, abandoned)
        : undefined;
    // A pane opening beside another gives the frame back between the stages that each take most of one.
    if (opts?.sliced) await yieldToEventLoop();
    if (store !== next) throw new Error('the document was replaced while it was parsed');
    // The last await is behind us, and the store went on while they ran (the other pane of a same-file pair
    // edited it, or the file was read again): the page is made from the store as it is now, whole, so that
    // `shown`, the page and the version the selection will stamp are one document. Slicing resumes with the
    // next open; this one has nothing left to give the frame back for.
    const latest = next.snapshot();
    if (latest.ast !== ast) {
      ({ path: file, ast, nodeMap, buffer } = latest);
      slices = null;
      inert = undefined;
    }
    const { html, removed, blockedImages } = slices ?? renderDocumentSafeHtml(ast, trust.policyFor(file));
    console.info(`marxy: sanitiser removed ${removed.length}`);
    shown = { ast, html, nodeMap, blocks: [], render: renderRecord(ast, removed, trust.grantsFor(file).html) };
    // A document opened from Source takes Rendered's place now, with its page laid out and visible for every pass
    // below, not set while hidden behind the old document's text until the open ends (V-15).
    if (viewMode === 'source') {
      setModeChrome('rendered');
      dropRetiredSource();
    }
    // Only the first screens go in now (A-02); images are checked before any block reaches the page.
    mountDocument(html, file, opts?.at, opts?.start, inert);
    afterRender();
    opts?.onMounted?.();
    await shell.mark('rendered', Date.now());
    await shell.mark('first_screen', Date.now(), `blocks=${doc.childElementCount} bytes=${mountedBytes(doc)}`);
    trust.showNotices(removed, blockedImages, { path: file, buffer, pane: paneOf(doc) });
    if (opts?.sliced) await yieldToEventLoop();
    void doc.offsetHeight;
    await document.fonts.ready;
    // No face list here (A-02): reading `document.fonts` made WebKit restyle the whole article as soon
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
    contentComplete: async () => {
      await mount?.complete;
      await completePass;
    },
    get mode() {
      return viewMode;
    },
    toggleMode: toggleViewMode,
    setMode: setViewMode,
    beginOpen,
    warmSource,
    jumpToSource,
    showSource,
    leaveSource: leaveSourceForRendered,
    showRenderedChrome: () => setModeChrome('rendered'),
    async foldSource() {
      const open = store;
      // The block open in place folds as Source does: one history entry, and the editor closes (E-04).
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
      shown.blocks = buildBlocks(doc, shown.nodeMap);
      const place = currentPosition(scroller, shown.blocks, path, 'rendered');
      change();
      shown.blocks = buildBlocks(doc, shown.nodeMap);
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
      for (const type of PIN_INPUT_TYPES) window.removeEventListener(type, onPinInput, { capture: true });
    },
  };
  return view;
}
