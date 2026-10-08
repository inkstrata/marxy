// Rendered-mode clicks, `.marxy-selected`, and re-render restore (MARXY-41); keys are in the command registry.
// One controller per article (B-12): it holds what the reader selected and where links have taken them,
// and reads the open document from its store whenever it needs it, so nothing here can go stale.

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
import { notify } from '../notices/index.ts';
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

export interface RenderedSelectionOptions {
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  /** The open document's store, or null when nothing is open. */
  store(): DocumentStore | null;
  readonly shell: SelectionShell;
  /**
   * Opens a document through the app's one open path. Over unsaved edits the promise settles once the reader
   * is asked, so anything that must follow the move (a landing, a history entry) goes in `onLanded`, which
   * runs only once `path` is the document on screen.
   */
  open(path: string, opts?: { onLanded?: () => void }): Promise<void>;
  currentPath(): string | null;
  /** Mounts every block up to the one holding `byte` (a link to a heading not yet on the page). */
  mountThrough(byte: number): void;
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
  /** The page was set again: re-resolve the selection on it, mark it, and land a pending fragment. */
  afterRender(): void;
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
  if (!MARKDOWN_LINK.test(basename(target))) return { refused: 'Only markdown documents open inside Marxy.' };
  return { target, fragment };
}

/**
 * The selection controller for one article. Listeners attach to `article` here and come off in
 * `destroy`. Keyboard chords live in the command registry (MARXY-42); they reach this through
 * `AppHandle.selection`.
 */
export function createRenderedSelection(opts: RenderedSelectionOptions): RenderedSelection {
  const { article, scroller } = opts;
  let state: SelectionState = { selection: { kind: 'none' } };
  let lastClickTarget: Element | null = null;
  /** The block carrier last pressed on, which Jump to source starts from; cleared when the document changes. */
  let pointerCarrier: Element | null = null;
  let pointerDrag = false;
  let downAt: { x: number; y: number } | null = null;
  let pointerDown = false;
  let navHistory: string[] = [];
  let navIndex = -1;
  /** The index a Back still in flight is heading for, so a second press steps on from it; null when none is. */
  let pendingBack: number | null = null;
  /** The path of the document the page last showed: a different one starts with nothing selected. */
  let shownPath: string | null = null;
  /** The store version the page was last set from (`afterRender`); null before the first. */
  let shownVersion: number | null = null;

  const runtime = (): SelectionRuntime | null => {
    const snap = opts.store()?.snapshot();
    if (!snap) return null;
    const version = shownVersion ?? snap.version;
    return { article, nodeMap: snap.nodeMap, document: snap.ast, buffer: snap.buffer, version, shell: opts.shell };
  };

  const paint = (): void => paintSelected(article, state.selection);

  /** Scroll the heading `fragment` names to the reading line; false when it is not on the page (yet). */
  const scrollToFragment = (fragment: string): boolean => {
    const id = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    if (!id || !opts.store()) return true;
    const target = article.querySelector(`#${CSS.escape(id)}`);
    if (!(target instanceof HTMLElement)) return false;
    const top = target.getBoundingClientRect().top + scroller.scrollTop - readingLine(scroller.clientHeight);
    scroller.scrollTop = Math.max(0, top);
    return true;
  };

  /** The byte where the heading `fragment` names starts, from the parsed document, mounted or not. */
  const headingByte = (fragment: string): number | undefined => {
    const id = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    const snap = opts.store()?.snapshot();
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
  const landFragment = (fragment: string): void => {
    if (scrollToFragment(fragment)) return;
    const byte = headingByte(fragment);
    if (byte === undefined) return;
    opts.mountThrough(byte);
    scrollToFragment(fragment);
  };

  /** Nothing the reader clicked in the last document names anything in the next one (or in none). */
  const forgetClick = (): void => {
    lastClickTarget = null;
    pointerCarrier = null;
  };

  /** `current` is the document the move leaves: read before the open, since a landed open has replaced it. */
  const recordNavOpen = (current: string | null, nextPath: string): void => {
    const kept = navIndex >= 0 ? navHistory.slice(0, navIndex + 1) : [];
    if (current && kept[kept.length - 1] !== current) kept.push(current);
    if (kept[kept.length - 1] !== nextPath) kept.push(nextPath);
    navHistory = kept;
    navIndex = navHistory.length - 1;
    pendingBack = null;
  };

  const followLink = async (anchor: HTMLAnchorElement, ev?: MouseEvent): Promise<void> => {
    const href = anchor.getAttribute('href');
    const snap = opts.store()?.snapshot();
    if (!href || !snap) return;
    const path = opts.currentPath() ?? snap.buffer.path;

    if (href.startsWith('#')) {
      ev?.preventDefault();
      landFragment(href);
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

    const local = localLinkTarget(path, href, opts.imageRoot(path));
    ev?.preventDefault();
    if ('refused' in local) {
      notify({ kind: 'info', text: local.refused });
      return;
    }
    const { target, fragment } = local;

    // A link to a heading of this very document (`[self](a.md#far)`) is the `#` branch with a path: land
    // on it. No open, no re-read of the file, no history entry, so unsaved edits are left alone.
    if (target === opts.currentPath()) {
      if (fragment) landFragment(fragment);
      return;
    }

    try {
      await opts.shell.readFile(target);
    } catch {
      notify({ kind: 'info', text: 'That document could not be found.' });
      return;
    }

    // Over unsaved edits the reader is asked first: the history entry and the landing wait for their
    // choice (F-21), and a Dismiss leaves both undone.
    const from = opts.currentPath();
    await opts.open(target, {
      onLanded: () => {
        recordNavOpen(from, target);
        if (fragment) landFragment(fragment);
      },
    });
  };

  /** The selection's element again, by its byte range, after a move or a new page. */
  const move = (next: Selection): void => {
    const doc = opts.store()?.snapshot().ast;
    if (!doc) return;
    state = select(state, next);
    if (state.selection.kind === 'node') {
      const el = elementForRange(article, state.selection.node.src.start, state.selection.node.src.end);
      if (el) state = select(state, { ...state.selection, el });
    }
    paint();
  };

  /** Re-resolve the structured selection after the DOM was replaced (§03). */
  const reresolve = (): void => {
    const snap = opts.store()?.snapshot();
    if (!snap) return;
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
    for (const el of article.querySelectorAll('[data-marxy-s][data-marxy-e]')) {
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
   * synchronously, before the returned promise is awaited.
   */
  const selectAt = (raw: Element, how: { readonly link: 'select' | 'follow' }, ev?: MouseEvent): Promise<void> => {
    const snap = opts.store()?.snapshot();
    if (!snap) return Promise.resolve();
    const { nodeMap } = snap;
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
      lastClickTarget = carrier;
      paint();
      return Promise.resolve();
    }

    if (isInline(resolved.node) && resolved.node.type === 'code' && carrier === lastClickTarget) {
      const blockEl = carrier.parentElement?.closest('[data-marxy-s]') ?? carrier;
      const blockResolved = resolve(blockEl, nodeMap);
      if (blockResolved && isBlock(blockResolved.node)) {
        state = select(state, { kind: 'node', node: blockResolved.node, el: blockEl });
        lastClickTarget = blockEl;
        paint();
        return Promise.resolve();
      }
    }

    lastClickTarget = carrier;
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
    const snap = opts.store()?.snapshot();
    const domSel = window.getSelection();
    if (!snap || !domSel || article.closest('[hidden]') !== null) return;
    const drag = recordDrag(article, domSel, snap.buffer.path, snap.ast.children.map((b) => b.src));
    if (!drag) return;
    state = select(state, { kind: 'text', ...drag, version: shownVersion ?? snap.version });
    clearSelectedClass(article);
  };

  // A selection made with the keyboard (Cmd+A, Shift+arrows) has no pointer-up: it is recorded when it
  // changes, unless a pointer is down (the pointer-up records that one) or it lies outside the article.
  const onSelectionChange = (): void => {
    if (pointerDown) return;
    const domSel = window.getSelection();
    if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return;
    if (!domSel.getRangeAt(0).intersectsNode(article)) return;
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
    void onClick(ev);
  };
  const onPointerDown = (ev: PointerEvent): void => {
    const raw = ev.target;
    const carrier = raw instanceof Element ? raw.closest('[data-marxy-s]') : null;
    if (carrier) pointerCarrier = carrier;
  };
  article.addEventListener('pointerdown', onPointerDown, true);
  article.addEventListener('mousedown', onMouseDown);
  article.addEventListener('mousemove', onMouseMove);
  article.addEventListener('click', onArticleClick);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mouseup', onDocumentMouseUp);

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
      // A second press before the first open has landed steps on from where the first is heading. The
      // pending index lasts only while that open is in flight: `open()` settles at once when it asks
      // about unsaved edits, so a Dismiss clears it and the next press starts from the page that is shown.
      const from = pendingBack ?? navIndex;
      if (from <= 0) return false;
      const index = from - 1;
      pendingBack = index;
      const settle = (): void => { if (pendingBack === index) pendingBack = null; };
      // The step back counts only once that document is on screen; a Dismiss over unsaved edits keeps the place.
      void opts.open(navHistory[index]!, { onLanded: () => { navIndex = index; settle(); } }).then(settle, settle);
      return true;
    },
    selectBlockAtByte(byte) {
      const snap = opts.store()?.snapshot();
      if (!snap) return;
      const carrier = blockCarrierAt(byte);
      if (carrier === null) return;
      const resolved = resolve(carrier, snap.nodeMap);
      if (!resolved || !isBlock(resolved.node)) return;
      lastClickTarget = carrier;
      state = select(state, { kind: 'node', node: resolved.node, el: carrier });
      paint();
    },
    lastPointerCarrier() {
      return pointerCarrier;
    },
    afterRender() {
      const snap = opts.store()?.snapshot();
      if (!snap) {
        state = select(state, { kind: 'none' });
        shownPath = null;
        shownVersion = null;
        forgetClick();
        return;
      }
      shownVersion = snap.version;
      // A drag names bytes of the page it was made on: a page set from other bytes drops it.
      if (state.selection.kind === 'text' && state.selection.version !== snap.version) {
        state = select(state, { kind: 'none' });
      }
      // Another document: nothing selected in the last one names anything in this one.
      if (shownPath !== null && shownPath !== snap.path) {
        state = select(state, { kind: 'none' });
        forgetClick();
      }
      shownPath = snap.path;
      reresolve();
      applyInvisibleMarkers(article);
      applyLinkDestinations(article);
    },
    destroy() {
      article.removeEventListener('pointerdown', onPointerDown, true);
      article.removeEventListener('mousedown', onMouseDown);
      article.removeEventListener('mousemove', onMouseMove);
      article.removeEventListener('click', onArticleClick);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseup', onDocumentMouseUp);
    },
  };

  return controller;
}
