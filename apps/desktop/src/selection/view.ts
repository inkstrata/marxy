// Rendered-mode clicks, `.marxy-selected`, and re-render restore; keys are in the command registry.
// One controller per window: it holds what the reader selected and where links have taken
// them, and reads the open document from its store whenever it needs it, so nothing here can go stale.
// It listens on every pane's article and acts on the focused one's: focusing another pane clears it.

import {
  sectionRange,
  type Block,
  type Buffer,
  type Document,
  type Heading,
  type Inline,
  type Node,
} from '@marxy/core';
import { headingIdsForDocument } from '@marxy/core/src/render/heading-ids.ts';
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import { offsetThroughEdit } from '@marxy/core/src/position/restore.ts';
import { readingPage } from '../parts/reading-parts.ts';
import type { AppShell } from '../app.ts';
import type { OpenOptions } from '../document/open.ts';
import type { DocumentStore } from '../document/store.ts';
import { appHandle } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';
import { splitRefusal } from '../pane/fit.ts';
import { defaultModeForPath, isNamedTextFamily } from '../source/default-mode.ts';
import { localLinkTarget } from './link-target.ts';
import type { NodeMap } from '../render/post.ts';
import {
  blockAt,
  extendRun,
  extendRunTo,
  moveSibling,
  parentOf,
  runBlocks,
  runHull,
  runRange,
  select,
  type Selection,
  type SelectionState,
} from './selection.ts';
import { blockSpanning } from '../changes/part-edits.ts';
import { cursorSelection, edgePart, extendHead, headingPart, intoPart, outPart, stepPart, type PartOk } from './cursor.ts';
import { applyInvisibleMarkers } from '../render/invisibles-dom.ts';
import { depthHidden, dressDepths, exposeAt, standIn } from '../depths/dress.ts';
import { mapRange, type Range } from '../depths/depth-maths.ts';
import { applyLinkDestinations } from '../render/link-dest.ts';
import { recordDrag } from './drag.ts';
import { linesViewIn } from '../view/reading-lines.ts';
import { resolve } from './resolve.ts';
import { isMac } from '../platform.ts';

const INLINE_TYPES: ReadonlySet<Inline['type']> = new Set([
  'text',
  'emphasis',
  'strong',
  'strikethrough',
  'code',
  'link',
  'image',
  'html',
  'softBreak',
  'hardBreak',
  'footnoteReference',
  'mathInline',
  'taskMarker',
]);

function isInline(node: Node): node is Inline {
  return INLINE_TYPES.has(node.type as Inline['type']);
}

function isBlock(node: Node): node is Block {
  return node.type !== 'document' && !isInline(node);
}

function elementForRange(article: HTMLElement, start: number, end: number): Element | null {
  return article.querySelector(`[data-marxy-s="${start}"][data-marxy-e="${end}"]`);
}

const PAINTED = ['marxy-selected', 'marxy-cursor', 'marxy-in-section'];

function clearSelectedClass(article: HTMLElement): void {
  for (const el of article.querySelectorAll('.marxy-selected, .marxy-cursor, .marxy-in-section')) el.classList.remove(...PAINTED);
}

/**
 * `head` is the block the cursor is on: a run's free end. `held` are the carriers of what a section holds, marked faintly
 * beside it (the prototype's `insec`).
 */
function paintSelected(article: HTMLElement, selection: Selection, head: Element | null, held: readonly Element[]): void {
  clearSelectedClass(article);
  if (selection.kind === 'node') selection.el.classList.add('marxy-selected', 'marxy-cursor');
  else if (selection.kind === 'blocks') {
    for (const el of selection.els) el.classList.add('marxy-selected');
    (head && selection.els.includes(head) ? head : selection.els.at(-1))?.classList.add('marxy-cursor');
  } else if (selection.kind === 'section') {
    const { heading } = selection;
    elementForRange(article, heading.src.start, heading.src.end)?.classList.add('marxy-selected', 'marxy-cursor');
    for (const el of held) el.classList.add('marxy-in-section');
  }
}

/** A derived view's root (scripts/registry.json): the app's selection never resolves inside one. */
const DERIVED = '[data-marxy-derived]';

export type SelectionShell = AppShell & {
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  openExternal?(url: string): Promise<void>;
};

/** What an operation resolves and splices against: the store's snapshot as of `version`, and the page. */
export interface SelectionRuntime {
  readonly article: HTMLElement;
  readonly nodeMap: NodeMap;
  readonly document: Document;
  readonly buffer: Buffer;
  /**
   * The store version the page on the article, and so every selection resolved on it, was set from:
   * an edit passes it as `baseVersion`. It is recorded when the page is set
   * (`afterRender`), not read when the edit is made, so a page that has not yet caught up with the
   * store's bytes cannot hand an edit offsets the store has moved past.
   */
  readonly version: number;
  readonly shell: SelectionShell;
}

/** One pane's article as the selection reads it: its page, its scroller and its open path. */
export interface SelectionTarget {
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  /** The open document's store, or null when nothing is open. */
  store(): DocumentStore | null;
  /**
   * Opens a document through this pane's open path. Over unsaved edits the promise settles once the reader
   * is asked, so anything that must follow the move goes in the options (`OpenOptions`).
   */
  open(path: string, opts?: Pick<OpenOptions, 'onCommitted' | 'onLanded'>): Promise<void>;
  currentPath(): string | null;
  /** Mounts every block up to the one holding `byte` (a link to a heading not yet on the page). */
  mountThrough(byte: number): void;
}

/** The first pane's article, which the selection starts on, and what every pane shares. */
export interface RenderedSelectionOptions extends SelectionTarget {
  readonly shell: SelectionShell;
  /** The root a link from `path` may not leave: `AppHandle.imageRoot`. */
  imageRoot(path: string): string;
}

export interface RenderedSelection {
  state(): SelectionState;
  /** The open document as the selection resolves against it; null when nothing is open. */
  runtime(): SelectionRuntime | null;
  clear(): void;
  moveDown(): void;
  moveUp(): void;
  moveParent(): void;
  /** `Alt+Shift+↓`: the selected block, or run of blocks, grows by the next sibling block. */
  extendDown(): void;
  /** Whether the focused pane's page can hold the cursor now: Rendered, a document of blocks, no derived view. */
  cursorReady(): boolean;
  /**
   * Moves the cursor and scrolls its part into view, only as far as it must. With no cursor, every move
   * but `out` starts it on the first part at or below the reading line. False when it did not move.
   */
  cursorMove(move: CursorMove): boolean;
  /** Puts the cursor on the innermost block at `byte` (after an edit moved its part there); false when it is not on the page. */
  cursorAt(byte: number, length?: number): boolean;
  /** `cb` runs after each change of the selection, or of the pane it acts on. Returns the off switch. */
  onChange(cb: () => void): () => void;
  /**
   * Select what a click on `target` selects, without following a link when `link` is `'select'` (the verb
   * menu's right-click). Synchronous for `'select'`.
   */
  selectAt(target: Element, opts: { readonly link: 'select' | 'follow' }): Promise<void>;
  /**
   * Select the innermost block whose `[data-marxy-s, data-marxy-e)` holds `byte` (a content-search hit).
   * The caller has already mounted the page through `byte` (the open's `landOn`). Nothing is
   * selected when no mounted block holds the byte (a gap between blocks, or a byte past the end).
   */
  selectBlockAtByte(byte: number): void;
  /** One step back in the link history; true when it moved (the caller then has nothing left to do). */
  back(): boolean;
  /** Whether `back()` would move: the link history of the focused pane has a step before the page it is heading for. */
  canBack(): boolean;
  /** `cb` runs whenever the link history moves (a step taken, one recorded, a pending step settled). Returns the off switch. */
  onHistoryChange(cb: () => void): () => void;
  /** The block carrier (`[data-marxy-s]`) last pressed on in this article, or null: where Jump to source starts. */
  lastPointerCarrier(): Element | null;
  /**
   * Records a keyboard-made DOM selection now rather than at its `selectionchange`, which is a queued task: a
   * Mod+C pressed right after Mod+A would otherwise copy the selection made before it.
   */
  recordLive?(): void;
  /** The first pane's page was set again: re-resolve the selection on it and mark it. */
  afterRender(): void;
  /**
   * Listens on another pane's article too: the selection acts on it once `focusArticle` names it.
   * Returns what takes it off again; a selection on it goes with it.
   */
  attach(target: SelectionTarget): () => void;
  /**
   * The selection now acts on `article`'s pane, the focused one: whatever was selected in another pane is
   * cleared, its highlight included. Nothing happens for the article already focused or one not attached.
   */
  focusArticle(article: HTMLElement): void;
  /** The article the selection acts on: the focused pane's. */
  article(): HTMLElement;
  /**
   * The selection as the view on `article` tells it: `afterRender` re-sets that article and
   * `runtime` reads that pane's store, whichever pane is focused. Null for an article not attached.
   */
  forArticle(article: HTMLElement): RenderedSelection | null;
  destroy(): void;
}

export type CursorMove = 'next' | 'prev' | 'in' | 'out' | 'extend-down' | 'extend-up' | 'next-heading' | 'prev-heading' | 'first' | 'last';

const DRAG_THRESHOLD_PX = 4;

/** A right-click, or a Ctrl-click on a Mac: it opens the verb menu, and is not a click that selects. */
export function isSecondaryClick(ev: MouseEvent): boolean {
  if (ev.button === 2) return true;
  const mac = isMac();
  return mac && ev.ctrlKey && ev.button === 0;
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

export { localLinkTarget };

/** Where links have taken one pane: back walks this pane's, whichever pane the key is pressed in. */
interface PaneNav {
  history: string[];
  index: number;
  /** The index a Back still in flight is heading for, so a second press steps on from it; null when none is. */
  pendingBack: number | null;
}

/** Whether a Cmd-click (Ctrl-click off a Mac) asks for the link to open in the other pane. */
function opensBeside(ev: MouseEvent | undefined): boolean {
  if (!ev) return false;
  const mac = isMac();
  return mac ? ev.metaKey : ev.ctrlKey;
}

/** A file is text when its first 8 KB hold no NUL byte. */
function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

/** What the selection keeps for one pane's article: what was last pressed there and the page it shows. */
interface PaneRecord {
  /** The links followed in this pane. */
  readonly nav: PaneNav;
  readonly target: SelectionTarget;
  lastClickTarget: Element | null;
  /** The block carrier last pressed on, which Jump to source starts from; cleared when the document changes. */
  pointerCarrier: Element | null;
  /** The path of the document the page last showed: a different one starts with nothing selected. */
  shownPath: string | null;
  /** The store version the page was last set from (`afterRender`); null before the first. */
  shownVersion: number | null;
  /** Takes this article's listeners off. */
  unlisten(): void;
  /** The selection as this article's view tells it (`forArticle`), made once. */
  facade?: RenderedSelection;
}

/**
 * The selection controller for the window. Listeners attach to the first pane's article here, and to a
 * second one's through `attach`, and come off in `destroy`; one selection state acts on the focused
 * pane's article (`focusArticle`). Keyboard chords live in the command registry; they reach
 * this through `AppHandle.selection`.
 */
export function createRenderedSelection(first: RenderedSelectionOptions): RenderedSelection {
  let state: SelectionState = { selection: { kind: 'none' } };
  const records = new Map<HTMLElement, PaneRecord>();
  /** The focused pane's record: everything below reads its article and its store. */
  let active: PaneRecord;
  let pointerDrag = false;
  let downAt: { x: number; y: number } | null = null;
  let pointerDown = false;

  /** The focused pane's open path, as link following and history read it. */
  const opts = {
    shell: first.shell,
    imageRoot: (path: string) => first.imageRoot(path),
    store: () => active.target.store(),
    open: (path: string) => active.target.open(path),
    currentPath: () => active.target.currentPath(),
    mountThrough: (byte: number) => active.target.mountThrough(byte),
  };

  const runtimeOf = (record: PaneRecord): SelectionRuntime | null => {
    const snap = record.target.store()?.snapshot();
    if (!snap) return null;
    const version = record.shownVersion ?? snap.version;
    // `nodeMap` and `document` are read when asked for, not when the runtime is made: a Source-default file's parse is
    // made on its first read, and the toolbar's strip makes this runtime at every document change.
    return {
      article: record.target.article,
      get nodeMap() { return snap.nodeMap; },
      get document() { return snap.ast; },
      buffer: snap.buffer,
      version,
      shell: opts.shell,
    };
  };
  const runtime = (): SelectionRuntime | null => runtimeOf(active);

  const changeListeners = new Set<() => void>();
  const changed = (): void => {
    for (const cb of [...changeListeners]) cb();
  };

  /**
   * The selection last painted and the bytes it named: a page set again maps the cursor's range from them to the bytes
   * now (a line added above, an undo, a reload, a Line transform). Read off the bytes, not the transition: the page is
   * set inside the store's commit, before a subscriber here would hear of it.
   */
  let paintedOn: { readonly selection: Selection; readonly bytes: Uint8Array } | null = null;
  const cursorRange = (sel: Selection): Range | null =>
    sel.kind === 'node' ? sel.node.src : sel.kind === 'section' ? sel.heading.src : null;
  /** `sel`'s range in `after`, or null when it names nothing or nothing changed. */
  const carriedRange = (sel: Selection, after: Uint8Array): Range | null => {
    const from = cursorRange(sel);
    if (!from || paintedOn?.selection !== sel || paintedOn.bytes === after) return null;
    const before = paintedOn.bytes;
    // A splice over the part (a whole-file transform) keeps the place its start maps to.
    const start = offsetThroughEdit(from.start, before, after);
    return mapRange({ kind: 'reload' }, from, { before, after }) ?? { start, end: start };
  };

  /**
   * The run the cursor made with `J` and `K`: which end stays and which moves. Blocks are matched by their bytes, so a
   * page set again keeps it; a run made another way (Shift+click, Alt+Shift+↓) is anchored at its first block.
   */
  let runEnds: { anchor: Block; head: Block } | null = null;
  const runOf = (sel: Extract<Selection, { kind: 'blocks' }>): { anchor: Block; head: Block } => {
    if (runEnds) {
      const { anchor, head } = runEnds;
      const lo = anchor.src.start <= head.src.start ? anchor : head;
      const hi = lo === anchor ? head : anchor;
      if (lo.src.start === sel.first.src.start && hi.src.end === sel.last.src.end) {
        return anchor === lo ? { anchor: sel.first, head: sel.last } : { anchor: sel.last, head: sel.first };
      }
    }
    return { anchor: sel.first, head: sel.last };
  };

  const paint = (): void => {
    const painted = opts.store()?.snapshot().buffer.bytes;
    paintedOn = painted ? { selection: state.selection, bytes: painted } : null;
    const { article } = active.target;
    const sel = state.selection;
    let head: Element | null = null;
    const held: Element[] = [];
    if (sel.kind === 'blocks') {
      const end = runOf(sel).head;
      head = elementForRange(article, end.src.start, end.src.end);
    } else if (sel.kind === 'section') {
      for (const block of opts.store()?.snapshot().ast.children ?? []) {
        if (block.src.start < sel.heading.src.end || block.src.end > sel.range.end) continue;
        const el = elementForRange(article, block.src.start, block.src.end);
        if (el) held.push(el);
      }
    }
    paintSelected(article, sel, head, held);
    changed();
  };

  /**
   * What `record`'s pane scrolls now: its view's live scroller, which moves from the window to the pane's
   * own section when a second pane appears; the one it was attached with is where it began.
   */
  const scrollerOf = (record: PaneRecord): HTMLElement =>
    appHandle()?.panes().panes.find((pane) => pane.article === record.target.article)?.view.scroller ?? record.target.scroller;

  /** Scroll the heading `fragment` names to the reading line of `record`'s pane; false when it is not on the page (yet). */
  const scrollToFragment = (record: PaneRecord, fragment: string): boolean => {
    const { article } = record.target;
    const scroller = scrollerOf(record);
    const id = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    if (!id || !record.target.store()) return true;
    const target = article.querySelector(`#${CSS.escape(id)}`);
    if (!(target instanceof HTMLElement)) return false;
    exposeAt(target);
    const top = target.getBoundingClientRect().top + scroller.scrollTop - readingLine(scroller.clientHeight);
    scroller.scrollTop = Math.max(0, top);
    return true;
  };

  /** The byte where the heading `fragment` names starts, from the parsed document, mounted or not. */
  const headingByte = (record: PaneRecord, fragment: string): number | undefined => {
    const id = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    const snap = record.target.store()?.snapshot();
    if (!id || !snap) return undefined;
    for (const [range, headingId] of headingIdsForDocument(snap.ast)) {
      if (headingId === id) return Number(range.slice(0, range.indexOf('-')));
    }
    return undefined;
  };

  /**
   * Land on a fragment. A long document mounts progressively, so the heading may not be on the page
   * yet: mount through it, at once, and land. An id the document has no heading for does nothing. It
   * never waits, so nothing can pull the page after the reader has moved on.
   */
  const landFragment = (record: PaneRecord, fragment: string): void => {
    if (scrollToFragment(record, fragment)) return;
    const byte = headingByte(record, fragment);
    if (byte === undefined) return;
    record.target.mountThrough(byte);
    scrollToFragment(record, fragment);
  };

  /** Nothing the reader clicked in the last document names anything in the next one (or in none). */
  const forgetClick = (record: PaneRecord): void => {
    record.lastClickTarget = null;
    record.pointerCarrier = null;
  };

  /**
   * `nextPath` joins `record`'s history after the document the pane shows now. Called when the open commits,
   * before the page flips, so the history and `currentPath()` never disagree across an await.
   */
  const historyListeners = new Set<() => void>();
  const historyMoved = (): void => {
    for (const cb of [...historyListeners]) cb();
  };

  const recordNavOpen = (record: PaneRecord, nextPath: string): void => {
    const { nav } = record;
    const current = record.target.currentPath();
    const kept = nav.index >= 0 ? nav.history.slice(0, nav.index + 1) : [];
    if (current && kept[kept.length - 1] !== current) kept.push(current);
    if (kept[kept.length - 1] !== nextPath) kept.push(nextPath);
    nav.history = kept;
    nav.index = kept.length - 1;
    nav.pendingBack = null;
    historyMoved();
  };

  /**
   * A link followed beside: `target` opens in the pane that is not `origin`, made when there is only
   * one and two columns fit; the origin pane keeps its document, its place and its focus. The neighbour's
   * history starts with the target. Unsaved edits in the neighbour go through the pane set's guard.
   */
  const openBesideOf = async (origin: PaneRecord, target: string, fragment: string | undefined): Promise<void> => {
    const panes = appHandle()?.panes();
    const from = panes?.panes.find((pane) => pane.article === origin.target.article);
    if (!panes || !from) return;
    const refusal = splitRefusal(panes);
    if (refusal !== null) {
      notify({ kind: 'refused', text: refusal });
      return;
    }
    const opened = await panes.openIn(from.slot === 0 ? 1 : 0, target);
    if (!opened) return;
    const landed = records.get(opened.article);
    if (landed) {
      landed.nav.history = [target];
      landed.nav.index = 0;
      historyMoved();
      if (fragment) landFragment(landed, fragment);
    }
    if (panes.focused !== from) panes.focus(from);
  };

  const followLink = async (anchor: HTMLAnchorElement, ev?: MouseEvent): Promise<void> => {
    const href = anchor.getAttribute('href');
    const record = active;
    const snap = record.target.store()?.snapshot();
    if (!href || !snap) return;
    const path = record.target.currentPath() ?? snap.buffer.path;

    if (href.startsWith('#')) {
      ev?.preventDefault();
      landFragment(record, href);
      return;
    }

    if (isExternalHref(href) || anchor.classList.contains('marxy-external')) {
      ev?.preventDefault();
      if (typeof opts.shell.openExternal === 'function') await opts.shell.openExternal(href);
      return;
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      ev?.preventDefault();
      notify({ kind: 'refused', text: 'That link uses a scheme Marxy does not open · nothing was opened · Copy the link to use it elsewhere.' });
      return;
    }

    const beside = opensBeside(ev);
    const local = localLinkTarget(path, href, opts.imageRoot(path), { allowSource: beside });
    ev?.preventDefault();
    if ('refused' in local) {
      notify({ kind: 'refused', text: local.refused });
      return;
    }
    const { target, fragment } = local;

    // A link to a heading of this very document (`[self](a.md#far)`) is the `#` branch with a path: land
    // on it. No open, no re-read of the file, no history entry, so unsaved edits are left alone.
    if (!beside && target === record.target.currentPath()) {
      if (fragment) landFragment(record, fragment);
      return;
    }

    let bytes: Uint8Array;
    try {
      // A look at the target, not a load: `peekFile` leaves the stale-write guard where it was. `readFile` would
      // record these bytes as read, so a link to a file already open (a self link, a neighbour's file) would
      // let the next save overwrite another program's change.
      bytes = await (opts.shell.peekFile ?? opts.shell.readFile).call(opts.shell, target);
    } catch {
      notify({ kind: 'refused', text: 'That document could not be found · nothing was opened · Check that the file still exists.' });
      return;
    }

    if (beside) {
      if ((defaultModeForPath(target) === 'source' || isNamedTextFamily(target)) && !looksLikeText(bytes)) {
        notify({ kind: 'refused', text: 'That file is not text · nothing was opened.' });
        return;
      }
      await openBesideOf(record, target, fragment);
      return;
    }

    // Over unsaved edits the reader is asked first: the history entry waits for their choice and is made
    // when the open commits, the landing once the page is set. A Dismiss leaves both undone.
    await record.target.open(target, {
      onCommitted: () => recordNavOpen(record, target),
      onLanded: () => {
        if (fragment) landFragment(record, fragment);
      },
    });
  };


  /** The selection's element again, by its byte range, after a move or a new page. */
  const move = (next: Selection): void => {
    const doc = opts.store()?.snapshot().ast;
    if (!doc) return;
    state = select(state, next);
    if (state.selection.kind === 'node') {
      const el = elementForRange(active.target.article, state.selection.node.src.start, state.selection.node.src.end);
      if (el) state = select(state, { ...state.selection, el });
    }
    paint();
  };

  /** Re-resolve the structured selection after the DOM was replaced. */
  const reresolve = (): void => {
    const snap = opts.store()?.snapshot();
    if (!snap) return;
    const { article } = active.target;
    const sel = state.selection;
    const moved = carriedRange(sel, snap.buffer.bytes);
    if (moved) {
      const el = elementForRange(article, moved.start, moved.end);
      const resolved = el ? resolve(el, snap.nodeMap)?.node : null;
      const block = resolved ? null : blockAt(snap.ast, moved.start);
      const carrier = block ? elementForRange(article, block.src.start, block.src.end) : null;
      if (resolved && el) state = select(state, cursorSelection(snap.ast, resolved as Block, el));
      else if (block && carrier) state = select(state, cursorSelection(snap.ast, block, carrier));
      else state = select(state, { kind: 'none' });
    } else if (sel.kind === 'node') {
      const el = elementForRange(article, sel.node.src.start, sel.node.src.end);
      if (el) {
        const resolved = resolve(el, snap.nodeMap);
        if (resolved) state = select(state, { kind: 'node', node: resolved.node as Block | Inline, el });
        else state = select(state, { kind: 'none' });
      } else {
        state = select(state, { kind: 'none' });
      }
    } else if (sel.kind === 'section') {
      const el = elementForRange(article, sel.heading.src.start, sel.heading.src.end);
      // The heading of the page now, not the one the section was made on: the cursor's moves find it among its siblings.
      const heading = el ? resolve(el, snap.nodeMap)?.node : null;
      if (heading?.type === 'heading') state = select(state, { kind: 'section', heading: heading as Heading, range: sectionRange(snap.ast, heading as Heading) });
      else state = select(state, { kind: 'none' });
    } else if (sel.kind === 'blocks') {
      state = select(state, resolveRun(sel) ?? { kind: 'none' });
    }
    paint();
  };

  /** The run's elements: the carrier of each block still on the page, in order. */
  const elementsOfRun = (doc: Document, first: Block, last: Block): Element[] => {
    const out: Element[] = [];
    for (const block of runBlocks(doc, first, last)) {
      const el = elementForRange(active.target.article, block.src.start, block.src.end);
      if (el) out.push(el);
    }
    return out;
  };

  /**
   * A run again after the page was set: by its two end ranges, on the new page. Both ends must still be
   * on it as blocks of one container; otherwise null, and nothing stays painted.
   */
  const resolveRun = (sel: Extract<Selection, { kind: 'blocks' }>): Selection | null => {
    const snap = opts.store()?.snapshot();
    if (!snap) return null;
    const { article } = active.target;
    const firstEl = elementForRange(article, sel.first.src.start, sel.first.src.end);
    const lastEl = elementForRange(article, sel.last.src.start, sel.last.src.end);
    if (!firstEl || !lastEl) return null;
    const firstNode = resolve(firstEl, snap.nodeMap)?.node;
    const lastNode = resolve(lastEl, snap.nodeMap)?.node;
    if (!firstNode || !lastNode || !isBlock(firstNode) || !isBlock(lastNode)) return null;
    if (firstNode.src.start > lastNode.src.start) return null;
    const { first, last } = runHull(snap.ast, firstNode, lastNode);
    const blocks = runBlocks(snap.ast, first, last);
    if (blocks.length < 2) return null;
    return { kind: 'blocks', first, last, range: runRange(first, last), els: elementsOfRun(snap.ast, first, last) };
  };

  /** Select the run `first`..`last`, painted together; the browser's own selection goes, so nothing competes with it. */
  const selectRun = (from: Block, to: Block): void => {
    const doc = opts.store()?.snapshot().ast;
    if (!doc) return;
    const { first, last } = runHull(doc, from, to);
    const els = elementsOfRun(doc, first, last);
    if (els.length === 0) return;
    window.getSelection()?.removeAllRanges();
    state = select(state, { kind: 'blocks', first, last, range: runRange(first, last), els });
    paint();
  };

  /** The block a pressed element belongs to: the innermost block carrier at or above it. */
  const blockOfElement = (raw: Element): Block | null => {
    const snap = opts.store()?.snapshot();
    if (!snap) return null;
    for (let carrier = raw.closest('[data-marxy-s]'); carrier; carrier = carrier.parentElement?.closest('[data-marxy-s]') ?? null) {
      const resolved = resolve(carrier, snap.nodeMap);
      if (resolved && isBlock(resolved.node)) return resolved.node;
    }
    return null;
  };

  /** `Shift+click` with a block or a run selected: the run grows to the clicked block's sibling; elsewhere, nothing happens. */
  const extendTo = (raw: Element): void => {
    const snap = opts.store()?.snapshot();
    const target = blockOfElement(raw);
    if (!snap || !target) return;
    const run = extendRunTo(snap.ast, state.selection, target);
    if (!run || run.first === run.last) return;
    selectRun(run.first, run.last);
  };

  /** The block carrier holding `byte`, the narrowest range winning; inline carriers are skipped. */
  const blockCarrierAt = (byte: number): Element | null => {
    const snap = opts.store()?.snapshot();
    if (!snap) return null;
    let best: Element | null = null;
    let bestSpan = Infinity;
    for (const el of active.target.article.querySelectorAll('[data-marxy-s][data-marxy-e]')) {
      const start = Number(el.getAttribute('data-marxy-s'));
      const end = Number(el.getAttribute('data-marxy-e'));
      if (!(start <= byte && byte < end) || end - start >= bestSpan) continue;
      const resolved = resolve(el, snap.nodeMap);
      if (resolved && isBlock(resolved.node)) {
        best = el;
        bestSpan = end - start;
      }
    }
    return best;
  };

  const selectNone = (): void => {
    state = select(state, { kind: 'none' });
    paint();
  };

  /**
   * Select what a click on `raw` selects (a click and a right-click share it). A link is followed
   * (`link: 'follow'`, a plain click) or selected as its inline node (`'select'`: Alt+click, and the verb
   * menu, which never follows one). Resolves once a followed link has landed; a selection is made
   * synchronously, before the returned promise is awaited. Only the focused pane's article selects.
   */
  /** Big Markdown read as lines and not yet parsed: nothing here may ask for its tree. */
  const unparsedLines = (article: Element): boolean => linesViewIn(article)?.lines.markdown === true && opts.store()?.parsed() !== true;

  const selectAt = (raw: Element, how: { readonly link: 'select' | 'follow' }, ev?: MouseEvent): Promise<void> => {
    const snap = opts.store()?.snapshot();
    if (!snap) return Promise.resolve();
    const record = active;
    const { article } = record.target;
    // Its rows are lines, not nodes, and resolving one would parse the whole file.
    if (unparsedLines(article)) {
      selectNone();
      return Promise.resolve();
    }
    const { nodeMap } = snap;
    if (raw === article || !article.contains(raw)) {
      selectNone();
      return Promise.resolve();
    }
    // A derived view is not a page of AST nodes: nothing in it resolves to one, so no verb that splices
    // is ever offered on what it shows. It selects its own turns and tools.
    if (raw.closest(DERIVED) !== null) {
      selectNone();
      return Promise.resolve();
    }

    const link = raw.closest('a[href]');
    if (link instanceof HTMLAnchorElement && how.link === 'follow') return followLink(link, ev);

    // Inside a fenced part read as data, the part is what a click selects: its rows name bytes of the fence, not nodes.
    const carrier = raw.closest('.marxy-part[data-marxy-s]') ?? raw.closest('[data-marxy-s]');
    if (!carrier) {
      selectNone();
      return Promise.resolve();
    }

    const resolved = resolve(carrier, nodeMap);
    if (!resolved) return Promise.resolve();

    if (link instanceof HTMLAnchorElement) {
      state = select(state, { kind: 'node', node: resolved.node as Inline, el: carrier });
      record.lastClickTarget = carrier;
      paint();
      return Promise.resolve();
    }

    if (isInline(resolved.node) && resolved.node.type === 'code' && carrier === record.lastClickTarget) {
      const blockEl = carrier.parentElement?.closest('[data-marxy-s]') ?? carrier;
      const blockResolved = resolve(blockEl, nodeMap);
      if (blockResolved && isBlock(blockResolved.node)) {
        state = select(state, { kind: 'node', node: blockResolved.node, el: blockEl });
        record.lastClickTarget = blockEl;
        paint();
        return Promise.resolve();
      }
    }

    record.lastClickTarget = carrier;
    state = select(state, { kind: 'node', node: resolved.node as Block | Inline, el: carrier });
    paint();
    return Promise.resolve();
  };

  const onClick = async (ev: MouseEvent): Promise<void> => {
    if (!opts.store()) return;
    if (pointerDrag) return;
    const domSel = window.getSelection();
    if (domSel && !domSel.isCollapsed) return;

    const raw = ev.target;
    if (!(raw instanceof Element)) {
      selectNone();
      return;
    }
    if (raw.closest(DERIVED) !== null) return;
    // Shift+click grows a block selection into a run of its siblings.
    if (ev.shiftKey && !ev.altKey && (state.selection.kind === 'node' || state.selection.kind === 'blocks') && active.target.article.contains(raw)) {
      extendTo(raw);
      return;
    }
    await selectAt(raw, { link: ev.altKey ? 'select' : 'follow' }, ev);
  };

  /**
   * The DOM selection on the article becomes the `text` selection, recorded now: its range, its text and
   * the bytes of the blocks it touches, at the version the page shows. A copy verb run later, from
   * the palette whose input has taken the DOM selection away, reads this record.
   */
  const recordTextSelection = (): void => {
    const { article } = active.target;
    const snap = opts.store()?.snapshot();
    const domSel = window.getSelection();
    if (!snap || !domSel || article.closest('[hidden]') !== null) return;
    // A drag over a derived view is `derived-text`: the view copies it as displayed, and no byte range of
    // the file is recorded from it, so no operation can be handed the bytes behind decoded text.
    if (article.querySelector(DERIVED) !== null) {
      if (state.selection.kind !== 'none') selectNone();
      return;
    }
    // A click is no drag: nothing is recorded. Big Markdown read as lines has its rows' own ranges, and asking for its
    // blocks would parse the whole file, which it is never until it is shown rendered.
    if (domSel.rangeCount === 0 || domSel.isCollapsed) return;
    const blocks = unparsedLines(article) ? [] : snap.ast.children.map((b) => b.src);
    const drag = recordDrag(article, domSel, snap.buffer.path, blocks);
    if (!drag) return;
    state = select(state, { kind: 'text', ...drag, version: active.shownVersion ?? snap.version });
    clearSelectedClass(article);
    changed();
  };

  // A selection made with the keyboard (Cmd+A, Shift+arrows) has no pointer-up: it is recorded when it
  // changes, unless a pointer is down (the pointer-up records that one) or it lies outside the article.
  // A key that may have moved the selection (Mod+A, Shift+arrows) since the last `selectionchange`; a modifier or the
  // copy chord's own C cannot.
  let keyedSinceChange = false;
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Shift' && ev.key !== 'Control' && ev.key !== 'Meta' && ev.key !== 'Alt' && ev.key.toLowerCase() !== 'c') keyedSinceChange = true;
  };
  const onSelectionChange = (): void => {
    keyedSinceChange = false;
    if (pointerDown) return;
    const domSel = window.getSelection();
    if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return;
    if (!domSel.getRangeAt(0).intersectsNode(active.target.article)) return;
    recordTextSelection();
  };
  // On the document, not the article: a drag that ends in the margin or outside the window's text column
  // releases off the article, and it is still the selection the reader sees.
  const onDocumentMouseUp = (ev: MouseEvent): void => {
    pointerDown = false;
    // A secondary click (right-click, or Ctrl-click on a Mac) opens the verb menu: it neither makes
    // nor drops a drag, and the word WebKit selects under it is not the reader's selection.
    if (isSecondaryClick(ev)) return;
    // Only a selection that touches the article is recorded (`recordDrag` clamps to it), wherever the
    // pointer came up.
    recordTextSelection();
    // A plain click that takes the highlight away (in the margin, say) takes the recorded drag with it, so
    // Mod+C cannot copy a passage the reader no longer sees. WebKit collapses the selection as
    // the press's default action, after this listener, so the check waits a task. A click in a summoned
    // surface (the palette, the verb menu) is not one: they act on the drag made before they were summoned.
    const inSurface = ev.target instanceof Element && ev.target.closest('dialog, .marxy-verb-menu') !== null;
    if (!inSurface) {
      const recorded = state.selection;
      setTimeout(() => {
        // A surface summoned in the meantime (Mod+P straight after the drag) took the highlight by taking focus.
        if (document.activeElement?.closest('dialog, .marxy-verb-menu')) return;
        const live = window.getSelection();
        const collapsed = !live || live.isCollapsed || live.rangeCount === 0;
        if (collapsed && state.selection === recorded && recorded.kind === 'text') selectNone();
      }, 0);
    }
  };

  /**
   * One article's listeners. They act only while their pane is the focused one: a press in the other pane
   * focuses it first (pane/focus.ts listens in the capture phase above the article), so by the time these
   * run it is.
   */
  const listen = (record: PaneRecord): (() => void) => {
    const { article } = record.target;
    // A click is not a drag until the pointer has moved a few pixels: a hand's jitter must still select.
    const onMouseDown = (ev: MouseEvent): void => {
      // Shift+press with a block or a run selected extends the run: the browser must not extend a text selection.
      if (ev.shiftKey && ev.button === 0 && record === active && (state.selection.kind === 'node' || state.selection.kind === 'blocks')) {
        ev.preventDefault();
      }
      pointerDrag = false;
      pointerDown = true;
      downAt = { x: ev.clientX, y: ev.clientY };
    };
    const onMouseMove = (ev: MouseEvent): void => {
      if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) >= DRAG_THRESHOLD_PX) pointerDrag = true;
    };
    const onArticleClick = (ev: MouseEvent): void => {
      // Before anything that can return early (a drag, a text selection, no document yet): a link
      // click that is not prevented navigates the window whether or not a handler follows it.
      const link = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
      if (link) ev.preventDefault();
      // Ctrl-click on a Mac is a secondary click: the verb menu's, never a link to follow.
      if (isSecondaryClick(ev)) return;
      if (record !== active) return;
      void onClick(ev);
    };
    const onPointerDown = (ev: PointerEvent): void => {
      const raw = ev.target;
      const carrier = raw instanceof Element && raw.closest(DERIVED) === null ? raw.closest('[data-marxy-s]') : null;
      if (carrier) record.pointerCarrier = carrier;
    };
    article.addEventListener('pointerdown', onPointerDown, true);
    article.addEventListener('mousedown', onMouseDown);
    article.addEventListener('mousemove', onMouseMove);
    article.addEventListener('click', onArticleClick);
    return () => {
      article.removeEventListener('pointerdown', onPointerDown, true);
      article.removeEventListener('mousedown', onMouseDown);
      article.removeEventListener('mousemove', onMouseMove);
      article.removeEventListener('click', onArticleClick);
    };
  };

  const register = (target: SelectionTarget): PaneRecord => {
    const record: PaneRecord = {
      target,
      lastClickTarget: null,
      pointerCarrier: null,
      nav: { history: [], index: -1, pendingBack: null },
      shownPath: null,
      shownVersion: null,
      unlisten: () => {},
    };
    record.unlisten = listen(record);
    records.set(target.article, record);
    return record;
  };

  const owner = register(first);
  active = owner;
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mouseup', onDocumentMouseUp);
  document.addEventListener('keydown', onKeyDown, true);

  /** Nothing selected, on the focused pane's page or the browser's: a drag there is the reader's no longer. */
  const dropSelectionOf = (record: PaneRecord): void => {
    state = select(state, { kind: 'none' });
    clearSelectedClass(record.target.article);
    const live = window.getSelection();
    if (live && live.rangeCount > 0 && live.getRangeAt(0).intersectsNode(record.target.article)) live.removeAllRanges();
  };

  /** `record`'s page was set again: re-resolve the selection on it if it is the focused one, and mark it. */
  const afterRenderOf = (record: PaneRecord): void => {
    const { article } = record.target;
    const snap = record.target.store()?.snapshot();
    const focused = record === active;
    if (!snap) {
      if (focused) state = select(state, { kind: 'none' });
      record.shownPath = null;
      record.shownVersion = null;
      forgetClick(record);
      if (focused) changed();
      return;
    }
    record.shownVersion = snap.version;
    // A drag names bytes of the page it was made on: a page set from other bytes drops it.
    if (focused && state.selection.kind === 'text' && state.selection.version !== snap.version) {
      state = select(state, { kind: 'none' });
    }
    // Another document: nothing selected in the last one names anything in this one.
    if (record.shownPath !== null && record.shownPath !== snap.path) {
      if (focused) state = select(state, { kind: 'none' });
      forgetClick(record);
    }
    record.shownPath = snap.path;
    if (focused) reresolve();
    applyInvisibleMarkers(article);
    applyLinkDestinations(article);
    dressDepths(record.target);
  };

  const carrierOf = (block: Block): Element | null => elementForRange(active.target.article, block.src.start, block.src.end);

  /** A block can hold the cursor once it is on the page: a long document is mounted as far as it, first. */
  const partOk: PartOk = (block) => {
    active.target.mountThrough(block.src.start);
    const el = carrierOf(block);
    // A part a lens left out is depth-hidden too (depths/lens.ts).
    return el !== null && el.closest(DERIVED) === null && !depthHidden(el);
  };

  /** The block the cursor is on: a run's free end, a section's heading, an inline's block. */
  const cursorHead = (doc: Document): Block | null => {
    const sel = state.selection;
    if (sel.kind === 'node') return isBlock(sel.node) ? sel.node : blockAt(doc, sel.node.src.start);
    if (sel.kind === 'section') return sel.heading;
    if (sel.kind === 'blocks') return runOf(sel).head;
    return null;
  };

  /** The window, or the pane's own section once there are two. */
  const scrollBox = (scroller: HTMLElement): { top: number; bottom: number } =>
    scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect();

  /** The first part at the top level whose bottom is below the reading line; the last one on the page if none is. */
  const startPart = (doc: Document): Block | null => {
    const scroller = scrollerOf(active);
    const line = scrollBox(scroller).top + readingLine(scroller.clientHeight);
    const byRange = new Map(doc.children.map((b) => [`${b.src.start}-${b.src.end}`, b]));
    let last: Block | null = null;
    for (const el of active.target.article.querySelectorAll('[data-marxy-s]')) {
      const block = byRange.get(`${el.getAttribute('data-marxy-s')}-${el.getAttribute('data-marxy-e')}`);
      if (!block || el.closest(DERIVED) !== null) continue;
      last = block;
      if (el.getBoundingClientRect().bottom > line) return block;
    }
    return last;
  };

  // What the bar at the foot of the pane and a line of room above it take; the head at the top covers the page under it.
  const REVEAL_FOOT = 64;
  const REVEAL_TOP = 8;

  /** Scrolls `el` into the visible part of its pane only as far as it must: nothing when it is all in view already. */
  const reveal = (el: Element): void => {
    const scroller = scrollerOf(active);
    const box = scrollBox(scroller);
    const slot = appHandle()?.panes().panes.find((pane) => pane.article === active.target.article)?.slot ?? 0;
    const headBottom = document.querySelector(`[data-marxy-head="${slot}"]`)?.getBoundingClientRect().bottom ?? box.top;
    const top = Math.max(box.top, headBottom) + REVEAL_TOP;
    const bottom = Math.min(box.bottom, window.innerHeight) - REVEAL_FOOT;
    const at = standIn(el);
    const r = (at.closest('pre') ?? at).getBoundingClientRect();
    // A part taller than the room left is shown from its top.
    const delta = r.top < top ? r.top - top : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - top) : 0;
    if (delta !== 0) scroller.scrollTop += delta;
  };

  /** Puts the cursor on `block`; with `anchor`, the run from it to `block`. False when `block` is not on the page. */
  const setCursor = (doc: Document, block: Block, anchor?: Block): boolean => {
    const el = carrierOf(block);
    if (!el) return false;
    // A goto (the Line, Outline, Search) may land in a fold, only-this or a lens: open it first, as a fragment landing does.
    exposeAt(el);
    // The cursor takes over from a drag: the browser's own selection would otherwise still be copied.
    const live = window.getSelection();
    if (live && !live.isCollapsed) live.removeAllRanges();
    if (anchor && anchor !== block) {
      runEnds = { anchor, head: block };
      const [first, last] = anchor.src.start <= block.src.start ? [anchor, block] : [block, anchor];
      selectRun(first, last);
    } else {
      runEnds = null;
      active.lastClickTarget = el;
      state = select(state, cursorSelection(doc, block, el));
      paint();
    }
    reveal(el);
    return true;
  };

  const cursorMove = (move: CursorMove): boolean => {
    const doc = opts.store()?.snapshot().ast;
    if (!doc || !controller.cursorReady()) return false;
    const from = cursorHead(doc);
    let target: Block | null = null;
    if (move === 'first' || move === 'last') target = edgePart(doc, move, partOk);
    else if (move === 'next-heading' || move === 'prev-heading') {
      const at = from ?? startPart(doc);
      target = headingPart(doc, at?.src.start ?? -1, move === 'next-heading' ? 1 : -1, partOk);
    } else if (!from) {
      if (move === 'out') return false;
      target = startPart(doc);
    } else if (move === 'next' || move === 'prev') target = stepPart(doc, from, move === 'next' ? 1 : -1, partOk);
    else if (move === 'in') target = intoPart(doc, from, partOk);
    else if (move === 'out') target = outPart(doc, from, partOk);
    else {
      const sel = state.selection;
      const ends = sel.kind === 'blocks' ? runOf(sel) : { anchor: from, head: from };
      const head = extendHead(doc, ends.anchor, ends.head, move === 'extend-down' ? 1 : -1, partOk);
      return head ? setCursor(doc, head, ends.anchor) : false;
    }
    return target ? setCursor(doc, target) : false;
  };

  const controller: RenderedSelection = {
    state: () => state,
    runtime,
    selectAt: (target, how) => selectAt(target, how),
    clear() {
      if (!opts.store()) return;
      selectNone();
    },
    moveDown() {
      const doc = opts.store()?.snapshot().ast;
      if (!doc) return;
      // A run collapses to its last block.
      if (state.selection.kind === 'blocks') {
        const { last, els } = state.selection;
        const el = elementForRange(active.target.article, last.src.start, last.src.end) ?? els.at(-1);
        if (el) move({ kind: 'node', node: last, el });
        return;
      }
      move(moveSibling(doc, state.selection, 1));
    },
    moveUp() {
      const doc = opts.store()?.snapshot().ast;
      if (!doc) return;
      if (state.selection.kind === 'blocks') {
        const { first, els } = state.selection;
        const el = elementForRange(active.target.article, first.src.start, first.src.end) ?? els[0];
        if (el) move({ kind: 'node', node: first, el });
        return;
      }
      move(moveSibling(doc, state.selection, -1));
    },
    extendDown() {
      const doc = opts.store()?.snapshot().ast;
      if (!doc) return;
      const run = extendRun(doc, state.selection, 1);
      if (!run) return;
      // The next block may not be on the page yet (a long document mounts progressively).
      active.target.mountThrough(run.last.src.start);
      selectRun(run.first, run.last);
    },
    moveParent() {
      const doc = opts.store()?.snapshot().ast;
      if (doc) move(parentOf(doc, state.selection));
    },
    cursorReady() {
      if (!opts.store()) return false;
      const { article } = active.target;
      if (article.hidden || article.closest('[hidden]') !== null || article.querySelector(DERIVED) !== null) return false;
      // A reading's page (a data tree, records, a log's entries) is walked by the parts cursor (parts/cursor.ts).
      if (readingPage(article)) return false;
      return article.querySelector('[data-marxy-s]') !== null;
    },
    cursorMove,
    cursorAt(byte, length) {
      const doc = opts.store()?.snapshot().ast;
      const block = doc ? (length === undefined ? null : blockSpanning(doc, byte, length)) ?? blockAt(doc, byte) : null;
      if (!doc || !block || !controller.cursorReady()) return false;
      active.target.mountThrough(block.src.start);
      return setCursor(doc, block);
    },
    onChange(cb) {
      changeListeners.add(cb);
      return () => {
        changeListeners.delete(cb);
      };
    },
    onHistoryChange(cb) {
      historyListeners.add(cb);
      return () => {
        historyListeners.delete(cb);
      };
    },
    canBack() {
      const { nav } = active;
      return (nav.pendingBack ?? nav.index) > 0;
    },
    back() {
      const { nav, target } = active;
      // A second press before the first open has committed steps on from where the first is heading. The
      // pending index lasts only until then: `open()` settles at once when it asks about unsaved edits, so a
      // Dismiss clears it and the next press starts from the page that is shown.
      const from = nav.pendingBack ?? nav.index;
      if (from <= 0) return false;
      const index = from - 1;
      nav.pendingBack = index;
      historyMoved();
      const settle = (): void => {
        if (nav.pendingBack !== index) return;
        nav.pendingBack = null;
        historyMoved();
      };
      // The step back counts once the open commits, before the page flips, so a press while it is still
      // finishing steps on from it; a Dismiss over unsaved edits keeps the place.
      void target.open(nav.history[index]!, { onCommitted: () => { nav.index = index; settle(); } }).then(settle, settle);
      return true;
    },
    selectBlockAtByte(byte) {
      const snap = opts.store()?.snapshot();
      if (!snap) return;
      const carrier = blockCarrierAt(byte);
      if (carrier === null) return;
      const resolved = resolve(carrier, snap.nodeMap);
      if (!resolved || !isBlock(resolved.node)) return;
      active.lastClickTarget = carrier;
      state = select(state, { kind: 'node', node: resolved.node, el: carrier });
      paint();
    },
    lastPointerCarrier() {
      return active.pointerCarrier;
    },
    recordLive() {
      // Only a keyboard change its `selectionchange` has not reached yet: a mouse drag was recorded at its pointer-up.
      if (keyedSinceChange) onSelectionChange();
    },
    afterRender() {
      afterRenderOf(owner);
    },
    attach(target) {
      if (records.has(target.article)) return () => {};
      const record = register(target);
      return () => {
        if (records.get(target.article) !== record) return;
        record.unlisten();
        records.delete(target.article);
        if (active === record) {
          dropSelectionOf(record);
          active = owner;
        }
      };
    },
    focusArticle(article) {
      const record = records.get(article);
      if (!record || record === active) return;
      dropSelectionOf(active);
      active = record;
      changed();
    },
    article: () => active.target.article,
    forArticle(article) {
      const record = records.get(article);
      if (!record) return null;
      record.facade ??= {
        ...controller,
        runtime: () => runtimeOf(record),
        afterRender: () => afterRenderOf(record),
        clear() {
          if (record === active) controller.clear();
        },
        lastPointerCarrier: () => record.pointerCarrier,
      };
      return record.facade;
    },
    destroy() {
      for (const record of records.values()) record.unlisten();
      records.clear();
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseup', onDocumentMouseUp);
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };

  return controller;
}
