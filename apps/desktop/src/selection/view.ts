// Rendered-mode clicks, `.marxy-selected`, and re-render restore (MARXY-41); keys are in the command registry.
// One controller per window (B-12, D-06): it holds what the reader selected and where links have taken
// them, and reads the open document from its store whenever it needs it, so nothing here can go stale.
// It listens on every pane's article and acts on the focused one's: focusing another pane clears it.

import {
  type Block,
  type Buffer,
  type Document,
  type Inline,
  type Node,
} from '@marxy/core';
import { headingIdsForDocument } from '@marxy/core/src/render/heading-ids.ts';
import { basename, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import type { AppShell } from '../app.ts';
import type { DocumentStore } from '../document/store.ts';
import { appHandle } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';
import { splitRefusal } from '../pane/fit.ts';
import { defaultModeForPath } from '../source/default-mode.ts';
import { pathsForDocument } from '../render/images.ts';
import type { NodeMap } from '../render/post.ts';
import { moveSibling, parentOf, select, type Selection, type SelectionState } from './selection.ts';
import { applyInvisibleMarkers } from '../render/invisibles-dom.ts';
import { applyLinkDestinations } from '../render/link-dest.ts';
import { recordDrag } from './drag.ts';
import { resolve } from './resolve.ts';

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

function clearSelectedClass(article: HTMLElement): void {
  for (const el of article.querySelectorAll('.marxy-selected')) el.classList.remove('marxy-selected');
}

function paintSelected(article: HTMLElement, selection: Selection): void {
  clearSelectedClass(article);
  if (selection.kind === 'node') selection.el.classList.add('marxy-selected');
}

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
   * an edit passes it as `baseVersion` (ADR-0037 Amendment 1). It is recorded when the page is set
   * (`afterRender`), not read when the edit is made, so a page that has not yet caught up with the
   * store's bytes cannot hand an edit offsets the store has moved past (the B-12 review).
   */
  readonly version: number;
  readonly shell: SelectionShell;
}

/** One pane's article as the selection reads it (D-06): its page, its scroller and its open path. */
export interface SelectionTarget {
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  /** The open document's store, or null when nothing is open. */
  store(): DocumentStore | null;
  /** Opens a document through this pane's open path. */
  open(path: string): Promise<void>;
  currentPath(): string | null;
  /** Mounts every block up to the one holding `byte` (a link to a heading not yet on the page). */
  mountThrough(byte: number): void;
}

/** The first pane's article, which the selection starts on, and what every pane shares. */
export interface RenderedSelectionOptions extends SelectionTarget {
  readonly shell: SelectionShell;
  /** The root a link from `path` may not leave: `AppHandle.imageRoot` (F-14). */
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
  /**
   * Select what a click on `target` selects, without following a link when `link` is `'select'` (the verb
   * menu's right-click, C-13). Synchronous for `'select'`.
   */
  selectAt(target: Element, opts: { readonly link: 'select' | 'follow' }): Promise<void>;
  /**
   * Select the innermost block whose `[data-marxy-s, data-marxy-e)` holds `byte` (a content-search hit,
   * C-17). The caller has already mounted the page through `byte` (the open's `landOn`). Nothing is
   * selected when no mounted block holds the byte (a gap between blocks, or a byte past the end).
   */
  selectBlockAtByte(byte: number): void;
  /** One step back in the link history; true when it moved (the caller then has nothing left to do). */
  back(): boolean;
  /** The block carrier (`[data-marxy-s]`) last pressed on in this article, or null: where Jump to source starts. */
  lastPointerCarrier(): Element | null;
  /** The first pane's page was set again: re-resolve the selection on it, mark it, and land a pending fragment. */
  afterRender(): void;
  /**
   * Listens on another pane's article too (D-06): the selection acts on it once `focusArticle` names it.
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
   * The selection as the view on `article` tells it (D-06): `afterRender` re-sets that article and
   * `runtime` reads that pane's store, whichever pane is focused. Null for an article not attached.
   */
  forArticle(article: HTMLElement): RenderedSelection | null;
  destroy(): void;
}

const DRAG_THRESHOLD_PX = 4;

/** A right-click, or a Ctrl-click on a Mac: it opens the verb menu (C-13), and is not a click that selects. */
export function isSecondaryClick(ev: MouseEvent): boolean {
  if (ev.button === 2) return true;
  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  return mac && ev.ctrlKey && ev.button === 0;
}
const MARKDOWN_LINK = /\.(md|markdown|mdx|txt)$/i;

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/**
 * Where a relative link from the document at `path` leads, or the notice that says why it does not open.
 * `imageRoot` is the app's answer for `path` (`AppHandle.imageRoot`): the repository root when the
 * document is in one, else its folder (F-14, ADR-0027 §5).
 */
export function localLinkTarget(
  path: string,
  href: string,
  imageRoot: string,
  /** A link followed beside (D-09): a file that opens in Source is a target too; whether it is text is for the caller. */
  opts?: { readonly allowSource?: boolean },
): { readonly target: string; readonly fragment: string | undefined } | { readonly refused: string } {
  const hash = href.indexOf('#');
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? undefined : href.slice(hash + 1);
  const { documentDir } = pathsForDocument(path);
  const base = documentDir.endsWith('/') ? documentDir : `${documentDir}/`;
  const target = normalizePath(new URL(pathPart, `file://${base}`).pathname);
  if (!isInsideImageRoot(target, imageRoot)) {
    const where = normalizePath(imageRoot) === normalizePath(documentDir) ? 'folder' : 'repository';
    return { refused: `That link points outside this ${where} and was not opened.` };
  }
  if (!MARKDOWN_LINK.test(basename(target)) && !(opts?.allowSource && defaultModeForPath(target) === 'source')) {
    return { refused: 'Only markdown documents open inside Marxy.' };
  }
  return { target, fragment };
}

/** Where links have taken one pane (D-09): back walks this pane's, whichever pane the key is pressed in. */
interface PaneNav {
  history: string[];
  index: number;
  /** A followed link's fragment, landed when this pane's page is next set. */
  pendingFragment?: string;
}

/** Whether a Cmd-click (Ctrl-click off a Mac) asks for the link to open in the other pane. */
function opensBeside(ev: MouseEvent | undefined): boolean {
  if (!ev) return false;
  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  return mac ? ev.metaKey : ev.ctrlKey;
}

/** A file is text when its first 8 KB hold no NUL byte. */
function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

/** What the selection keeps for one pane's article (D-06): what was last pressed there and the page it shows. */
interface PaneRecord {
  /** The links followed in this pane (D-09). */
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
 * pane's article (`focusArticle`). Keyboard chords live in the command registry (MARXY-42); they reach
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
    return { article: record.target.article, nodeMap: snap.nodeMap, document: snap.ast, buffer: snap.buffer, version, shell: opts.shell };
  };
  const runtime = (): SelectionRuntime | null => runtimeOf(active);

  const paint = (): void => paintSelected(active.target.article, state.selection);

  /**
   * What `record`'s pane scrolls now: its view's live scroller, which moves from the window to the pane's
   * own section when a second pane appears (D-05); the one it was attached with is where it began.
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

  /** `nextPath` joins `record`'s history after the document the pane shows now. */
  const recordNavOpen = (record: PaneRecord, nextPath: string): void => {
    const { nav } = record;
    const current = record.target.currentPath();
    const kept = nav.index >= 0 ? nav.history.slice(0, nav.index + 1) : [];
    if (current && kept[kept.length - 1] !== current) kept.push(current);
    if (kept[kept.length - 1] !== nextPath) kept.push(nextPath);
    nav.history = kept;
    nav.index = kept.length - 1;
  };

  /**
   * A link followed beside (D-09): `target` opens in the pane that is not `origin`, made when there is only
   * one and two columns fit; the origin pane keeps its document, its place and its focus. The neighbour's
   * history starts with the target. Unsaved edits in the neighbour go through the pane set's guard (D-08).
   */
  const openBesideOf = async (origin: PaneRecord, target: string, fragment: string | undefined): Promise<void> => {
    const panes = appHandle()?.panes();
    const from = panes?.panes.find((pane) => pane.article === origin.target.article);
    if (!panes || !from) return;
    const refusal = splitRefusal(panes);
    if (refusal !== null) {
      notify({ kind: 'info', text: refusal });
      return;
    }
    const opened = await panes.openIn(from.slot === 0 ? 1 : 0, target);
    if (!opened) return;
    const landed = records.get(opened.article);
    if (landed) {
      landed.nav.history = [target];
      landed.nav.index = 0;
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
      notify({ kind: 'info', text: 'That link uses a scheme Marxy does not open.' });
      return;
    }

    const beside = opensBeside(ev);
    const local = localLinkTarget(path, href, opts.imageRoot(path), { allowSource: beside });
    ev?.preventDefault();
    if ('refused' in local) {
      notify({ kind: 'info', text: local.refused });
      return;
    }
    const { target, fragment } = local;

    let bytes: Uint8Array;
    try {
      // A look at the target, not a load: `peekFile` leaves the stale-write guard where it was. `readFile` would
      // record these bytes as read, so a link to a file already open (a self link, a neighbour's file) would
      // let the next save overwrite another program's change.
      bytes = await (opts.shell.peekFile ?? opts.shell.readFile).call(opts.shell, target);
    } catch {
      notify({ kind: 'info', text: 'That document could not be found.' });
      return;
    }

    if (beside) {
      if (defaultModeForPath(target) === 'source' && !looksLikeText(bytes)) {
        notify({ kind: 'info', text: 'That file is not text.' });
        return;
      }
      await openBesideOf(record, target, fragment);
      return;
    }

    recordNavOpen(record, target);
    record.nav.pendingFragment = fragment;
    await record.target.open(target);
    const landing = record.nav.pendingFragment;
    record.nav.pendingFragment = undefined;
    if (landing) landFragment(record, landing);
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

  /** Re-resolve the structured selection after the DOM was replaced (§03). */
  const reresolve = (): void => {
    const snap = opts.store()?.snapshot();
    if (!snap) return;
    const { article } = active.target;
    const sel = state.selection;
    if (sel.kind === 'node') {
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
      if (!el) state = select(state, { kind: 'none' });
    }
    paint();
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
   * Select what a click on `raw` selects (C-13: a click and a right-click share it). A link is followed
   * (`link: 'follow'`, a plain click) or selected as its inline node (`'select'`: Alt+click, and the verb
   * menu, which never follows one). Resolves once a followed link has landed; a selection is made
   * synchronously, before the returned promise is awaited. Only the focused pane's article selects.
   */
  const selectAt = (raw: Element, how: { readonly link: 'select' | 'follow' }, ev?: MouseEvent): Promise<void> => {
    const snap = opts.store()?.snapshot();
    if (!snap) return Promise.resolve();
    const { nodeMap } = snap;
    const record = active;
    const { article } = record.target;
    if (raw === article || !article.contains(raw)) {
      selectNone();
      return Promise.resolve();
    }

    const link = raw.closest('a[href]');
    if (link instanceof HTMLAnchorElement && how.link === 'follow') return followLink(link, ev);

    const carrier = raw.closest('[data-marxy-s]');
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
    await selectAt(raw, { link: ev.altKey ? 'select' : 'follow' }, ev);
  };

  /**
   * The DOM selection on the article becomes the `text` selection, recorded now: its range, its text and
   * the bytes of the blocks it touches, at the version the page shows (C-06). A copy verb run later, from
   * the palette whose input has taken the DOM selection away, reads this record.
   */
  const recordTextSelection = (): void => {
    const { article } = active.target;
    const snap = opts.store()?.snapshot();
    const domSel = window.getSelection();
    if (!snap || !domSel || article.closest('[hidden]') !== null) return;
    const drag = recordDrag(article, domSel, snap.buffer.path, snap.ast.children.map((b) => b.src));
    if (!drag) return;
    state = select(state, { kind: 'text', ...drag, version: active.shownVersion ?? snap.version });
    clearSelectedClass(article);
  };

  // A selection made with the keyboard (Cmd+A, Shift+arrows) has no pointer-up: it is recorded when it
  // changes, unless a pointer is down (the pointer-up records that one) or it lies outside the article.
  const onSelectionChange = (): void => {
    if (pointerDown) return;
    const domSel = window.getSelection();
    if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return;
    if (!domSel.getRangeAt(0).intersectsNode(active.target.article)) return;
    recordTextSelection();
  };
  // On the document, not the article: a drag that ends in the margin or outside the window's text column
  // releases off the article, and it is still the selection the reader sees (C-06 review).
  const onDocumentMouseUp = (ev: MouseEvent): void => {
    pointerDown = false;
    // A secondary click (right-click, or Ctrl-click on a Mac) opens the verb menu (C-13): it neither makes
    // nor drops a drag, and the word WebKit selects under it is not the reader's selection.
    if (isSecondaryClick(ev)) return;
    // Only a selection that touches the article is recorded (`recordDrag` clamps to it), wherever the
    // pointer came up.
    recordTextSelection();
    // A plain click that takes the highlight away (in the margin, say) takes the recorded drag with it, so
    // Mod+C cannot copy a passage the reader no longer sees (C-06 review). WebKit collapses the selection as
    // the press's default action, after this listener, so the check waits a task. A click in a summoned
    // surface (the palette, the verb menu) is not one: they act on the drag made before they were summoned.
    const inSurface = ev.target instanceof Element && ev.target.closest('dialog, .marxy-verb-menu') !== null;
    if (!inSurface) {
      const recorded = state.selection;
      setTimeout(() => {
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
      // Ctrl-click on a Mac is a secondary click: the verb menu's, never a link to follow (C-13).
      if (isSecondaryClick(ev)) return;
      if (record !== active) return;
      void onClick(ev);
    };
    const onPointerDown = (ev: PointerEvent): void => {
      const raw = ev.target;
      const carrier = raw instanceof Element ? raw.closest('[data-marxy-s]') : null;
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
      nav: { history: [], index: -1 },
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
    if (record.nav.pendingFragment) {
      const landing = record.nav.pendingFragment;
      record.nav.pendingFragment = undefined;
      requestAnimationFrame(() => landFragment(record, landing));
    }
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
      if (doc) move(moveSibling(doc, state.selection, 1));
    },
    moveUp() {
      const doc = opts.store()?.snapshot().ast;
      if (doc) move(moveSibling(doc, state.selection, -1));
    },
    moveParent() {
      const doc = opts.store()?.snapshot().ast;
      if (doc) move(parentOf(doc, state.selection));
    },
    back() {
      const { nav } = active;
      if (nav.index <= 0) return false;
      nav.index -= 1;
      void active.target.open(nav.history[nav.index]!);
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
    },
  };

  return controller;
}
