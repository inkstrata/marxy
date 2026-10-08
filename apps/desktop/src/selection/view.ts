// Rendered-mode clicks, `.marxy-selected`, and re-render restore (MARXY-41); keys are in the command registry.
// One controller per article (B-12): it holds what the reader selected and where links have taken them,
// and reads the open document from its store whenever it needs it, so nothing here can go stale.

import {
  createBuffer,
  parseMarkdown,
  sectionRange,
  textOf,
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
import type { AppHandle, AppShell } from '../app.ts';
import type { DocumentStore } from '../document/store.ts';
import { notify } from '../notices/index.ts';
import { pathsForDocument } from '../render/images.ts';
import type { NodeMap } from '../render/post.ts';
import { moveSibling, parentOf, select, type Selection, type SelectionState } from './selection.ts';
import { applyInvisibleMarkers } from '../render/invisibles-dom.ts';
import { applyLinkDestinations } from '../render/link-dest.ts';
import { textFromDomSelection } from './copy-text.ts';
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
  /** Opens a document through the app's one open path. */
  open(path: string): Promise<void>;
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
  /** One step back in the link history; true when it moved (the caller then has nothing left to do). */
  back(): boolean;
  /** The page was set again: re-resolve the selection on it, mark it, and land a pending fragment. */
  afterRender(): void;
  destroy(): void;
}

const DRAG_THRESHOLD_PX = 4;
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
  let pointerDrag = false;
  let downAt: { x: number; y: number } | null = null;
  let navHistory: string[] = [];
  let navIndex = -1;
  let pendingFragment: string | undefined;
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
    (window as Window & { __marxyJumpCarrier?: Element }).__marxyJumpCarrier = undefined;
  };

  const recordNavOpen = (nextPath: string): void => {
    const current = opts.currentPath();
    const kept = navIndex >= 0 ? navHistory.slice(0, navIndex + 1) : [];
    if (current && kept[kept.length - 1] !== current) kept.push(current);
    if (kept[kept.length - 1] !== nextPath) kept.push(nextPath);
    navHistory = kept;
    navIndex = navHistory.length - 1;
  };

  const followLink = async (anchor: HTMLAnchorElement, ev: MouseEvent): Promise<void> => {
    const href = anchor.getAttribute('href');
    const snap = opts.store()?.snapshot();
    if (!href || !snap) return;
    const path = opts.currentPath() ?? snap.buffer.path;

    if (href.startsWith('#')) {
      ev.preventDefault();
      landFragment(href);
      return;
    }

    if (isExternalHref(href) || anchor.classList.contains('marxy-external')) {
      ev.preventDefault();
      if (typeof opts.shell.openExternal === 'function') await opts.shell.openExternal(href);
      return;
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      ev.preventDefault();
      notify({ kind: 'info', text: 'That link uses a scheme Marxy does not open.' });
      return;
    }

    const local = localLinkTarget(path, href, opts.imageRoot(path));
    ev.preventDefault();
    if ('refused' in local) {
      notify({ kind: 'info', text: local.refused });
      return;
    }
    const { target, fragment } = local;

    try {
      await opts.shell.readFile(target);
    } catch {
      notify({ kind: 'info', text: 'That document could not be found.' });
      return;
    }

    recordNavOpen(target);
    pendingFragment = fragment;
    await opts.open(target);
    const landing = pendingFragment;
    pendingFragment = undefined;
    if (landing) landFragment(landing);
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

  /** Test hook: replace `#doc` HTML without changing bytes, then restore selection. */
  const rerenderWithSameHtml = (): void => {
    if (!opts.store()) return;
    const cloned = [...article.childNodes].map((n) => n.cloneNode(true));
    article.replaceChildren(...cloned);
    reresolve();
  };

  const selectNone = (): void => {
    state = select(state, { kind: 'none' });
    paint();
  };

  const onClick = async (ev: MouseEvent): Promise<void> => {
    const snap = opts.store()?.snapshot();
    if (!snap) return;
    const { nodeMap } = snap;
    if (pointerDrag) return;
    const domSel = window.getSelection();
    if (domSel && !domSel.isCollapsed) return;

    const raw = ev.target;
    if (!(raw instanceof Element) || raw === article || !article.contains(raw)) {
      selectNone();
      return;
    }

    const link = raw.closest('a[href]');
    if (link instanceof HTMLAnchorElement && !ev.altKey) {
      await followLink(link, ev);
      return;
    }

    const carrier = raw.closest('[data-marxy-s]');
    if (!carrier) {
      selectNone();
      return;
    }

    const resolved = resolve(carrier, nodeMap);
    if (!resolved) return;

    if (ev.altKey && link instanceof HTMLAnchorElement) {
      state = select(state, { kind: 'node', node: resolved.node as Inline, el: carrier });
      lastClickTarget = carrier;
      paint();
      return;
    }

    if (isInline(resolved.node) && resolved.node.type === 'code' && carrier === lastClickTarget) {
      const blockEl = carrier.parentElement?.closest('[data-marxy-s]') ?? carrier;
      const blockResolved = resolve(blockEl, nodeMap);
      if (blockResolved && isBlock(blockResolved.node)) {
        state = select(state, { kind: 'node', node: blockResolved.node, el: blockEl });
        lastClickTarget = blockEl;
        paint();
        return;
      }
    }

    lastClickTarget = carrier;
    state = select(state, { kind: 'node', node: resolved.node as Block | Inline, el: carrier });
    paint();
  };

  const onPointerUp = (): void => {
    if (!opts.store()) return;
    const domSel = window.getSelection();
    if (domSel && !domSel.isCollapsed && domSel.toString().trim().length > 0) {
      state = select(state, { kind: 'text', text: textFromDomSelection(domSel) });
      clearSelectedClass(article);
    }
  };

  // A click is not a drag until the pointer has moved a few pixels: a hand's jitter must still select.
  const onMouseDown = (ev: MouseEvent): void => {
    pointerDrag = false;
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
    void onClick(ev);
  };
  article.addEventListener('mousedown', onMouseDown);
  article.addEventListener('mousemove', onMouseMove);
  article.addEventListener('mouseup', onPointerUp);
  article.addEventListener('click', onArticleClick);

  const controller: RenderedSelection = {
    state: () => state,
    runtime,
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
      if (navIndex <= 0) return false;
      navIndex -= 1;
      void opts.open(navHistory[navIndex]!);
      return true;
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
      // Another document: nothing selected in the last one names anything in this one.
      if (shownPath !== null && shownPath !== snap.path) {
        state = select(state, { kind: 'none' });
        forgetClick();
      }
      shownPath = snap.path;
      reresolve();
      applyInvisibleMarkers(article);
      applyLinkDestinations(article);
      if (pendingFragment) {
        const landing = pendingFragment;
        pendingFragment = undefined;
        requestAnimationFrame(() => landFragment(landing));
      }
    },
    destroy() {
      article.removeEventListener('mousedown', onMouseDown);
      article.removeEventListener('mousemove', onMouseMove);
      article.removeEventListener('mouseup', onPointerUp);
      article.removeEventListener('click', onArticleClick);
      const w = window as Window & { marxySelection?: { getSelectionState(): SelectionState } };
      if (w.marxySelection?.getSelectionState === controller.state) w.marxySelection = undefined;
    },
  };

  (window as Window & { marxySelection?: unknown }).marxySelection = {
    getSelectionState: controller.state,
    rerenderWithSameHtml,
    afterDocumentRendered: reresolve,
    resolve,
    textOf,
    parseMarkdown,
    sectionRange,
    createBuffer,
  };

  return controller;
}

/**
 * The app's selection controller. `startApp` makes it once `#doc` exists; this stays for the callers
 * that installed it before (the selection harness), and is idempotent: it returns the one there is.
 */
export function installRenderedSelection(handle: AppHandle): RenderedSelection {
  return handle.selection;
}
