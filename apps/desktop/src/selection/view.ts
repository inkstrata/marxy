// Rendered-mode clicks, `.marxy-selected`, and re-render restore (MARXY-41); keys are in the command registry.

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
import { basename, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import type { AppHandle, AppShell, OpenDocumentState } from '../app.ts';
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

export interface SelectionRuntime {
  article: HTMLElement;
  nodeMap: NodeMap;
  document: Document;
  buffer: Buffer;
  shell: AppShell & { clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void> };
}

interface Ctx extends SelectionRuntime {}

let ctx: Ctx | null = null;
let state: SelectionState = { selection: { kind: 'none' } };
let lastClickTarget: Element | null = null;
let pointerDrag = false;
const DRAG_THRESHOLD_PX = 4;
let installedOn: HTMLElement | null = null;
let appHandle: AppHandle | null = null;
let navHistory: string[] = [];
let navIndex = -1;
let pendingFragment: string | undefined;

const MARKDOWN_LINK = /\.(md|markdown|mdx|txt)$/i;

function scrollToFragment(fragment: string): void {
  const id = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!id || !ctx) return;
  const target = ctx.article.querySelector(`#${CSS.escape(id)}`);
  if (!(target instanceof HTMLElement)) return;
  const scroller = document.documentElement;
  const top = target.getBoundingClientRect().top + scroller.scrollTop - readingLine(scroller.clientHeight);
  scroller.scrollTop = Math.max(0, top);
}

function recordNavOpen(nextPath: string): void {
  const current = appHandle?.currentPath();
  const kept = navIndex >= 0 ? navHistory.slice(0, navIndex + 1) : [];
  if (current && kept[kept.length - 1] !== current) kept.push(current);
  if (kept[kept.length - 1] !== nextPath) kept.push(nextPath);
  navHistory = kept;
  navIndex = navHistory.length - 1;
}

/** One step back in the link history; true when it moved (the caller then has nothing left to do). */
export function linkBack(): boolean {
  if (navIndex <= 0 || !appHandle) return false;
  navIndex -= 1;
  void appHandle.open(navHistory[navIndex]!);
  return true;
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

async function followLink(anchor: HTMLAnchorElement, ev: MouseEvent): Promise<void> {
  const href = anchor.getAttribute('href');
  if (!href || !ctx || !appHandle) return;
  const path = appHandle.currentPath() ?? ctx.buffer.path;

  if (href.startsWith('#')) {
    ev.preventDefault();
    scrollToFragment(href);
    return;
  }

  if (isExternalHref(href) || anchor.classList.contains('marxy-external')) {
    ev.preventDefault();
    const ext = ctx.shell as AppShell & { openExternal?(url: string): Promise<void> };
    if (typeof ext.openExternal === 'function') await ext.openExternal(href);
    return;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    ev.preventDefault();
    notify({ kind: 'info', text: 'That link uses a scheme Marxy does not open.' });
    return;
  }

  const hash = href.indexOf('#');
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? undefined : href.slice(hash + 1);
  const { documentDir } = pathsForDocument(path);
  const base = documentDir.endsWith('/') ? documentDir : `${documentDir}/`;
  const target = normalizePath(new URL(pathPart, `file://${base}`).pathname);
  const { imageRoot } = pathsForDocument(path);

  ev.preventDefault();

  if (!isInsideImageRoot(target, imageRoot)) {
    notify({ kind: 'info', text: 'That link points outside this folder and was not opened.' });
    return;
  }

  if (!MARKDOWN_LINK.test(basename(target))) {
    notify({ kind: 'info', text: 'Only markdown documents open inside Marxy.' });
    return;
  }

  try {
    await ctx.shell.readFile(target);
  } catch {
    notify({ kind: 'info', text: 'That document could not be found.' });
    return;
  }

  recordNavOpen(target);
  pendingFragment = fragment;
  await appHandle.open(target);
  if (pendingFragment) {
    scrollToFragment(pendingFragment);
    pendingFragment = undefined;
  }
}

/** The app this selection follows: operations commit through it (render/tasks.ts). */
export function selectionApp(): AppHandle | null {
  return appHandle;
}

export function getSelectionState(): SelectionState {
  return state;
}

export function getSelectionBufferContext(): (SelectionRuntime & { state: SelectionState }) | null {
  if (!ctx) return null;
  return { ...ctx, state };
}

export function structuredSelectionActive(): boolean {
  const kind = state.selection.kind;
  return kind === 'node' || kind === 'section' || kind === 'document';
}

export function clearStructuredSelection(): void {
  if (!ctx) return;
  state = select(state, { kind: 'none' });
  paintSelected(ctx.article, state.selection);
}

export function moveSelectionDown(): void {
  if (!ctx) return;
  const { article, document } = ctx;
  state = select(state, moveSibling(document, state.selection, 1));
  if (state.selection.kind === 'node') {
    const el = elementForRange(article, state.selection.node.src.start, state.selection.node.src.end);
    if (el) state = select(state, { ...state.selection, el });
  }
  paintSelected(article, state.selection);
}

export function moveSelectionUp(): void {
  if (!ctx) return;
  const { article, document } = ctx;
  state = select(state, moveSibling(document, state.selection, -1));
  if (state.selection.kind === 'node') {
    const el = elementForRange(article, state.selection.node.src.start, state.selection.node.src.end);
    if (el) state = select(state, { ...state.selection, el });
  }
  paintSelected(article, state.selection);
}

export function moveSelectionParent(): void {
  if (!ctx) return;
  const { article, document } = ctx;
  state = select(state, parentOf(document, state.selection));
  if (state.selection.kind === 'node') {
    const el = elementForRange(article, state.selection.node.src.start, state.selection.node.src.end);
    if (el) state = select(state, { ...state.selection, el });
  }
  paintSelected(article, state.selection);
}

/** Re-resolve the structured selection after the DOM was replaced with the same bytes (§03). */
export function afterDocumentRendered(next?: Partial<Ctx>): void {
  if (!ctx) return;
  if (next) ctx = { ...ctx, ...next };
  const { article, nodeMap } = ctx;
  const sel = state.selection;
  if (sel.kind === 'node') {
    const el = elementForRange(article, sel.node.src.start, sel.node.src.end);
    if (el) {
      const resolved = resolve(el, nodeMap);
      if (resolved) state = select(state, { kind: 'node', node: resolved.node as Block | Inline, el });
      else state = select(state, { kind: 'none' });
    } else {
      state = select(state, { kind: 'none' });
    }
  } else if (sel.kind === 'section') {
    const el = elementForRange(article, sel.heading.src.start, sel.heading.src.end);
    if (!el) state = select(state, { kind: 'none' });
  }
  paintSelected(article, state.selection);
}

/** Test hook: replace `#doc` HTML without changing bytes, then restore selection. */
export function rerenderWithSameHtml(): void {
  if (!ctx) return;
  const cloned = [...ctx.article.childNodes].map((n) => n.cloneNode(true));
  ctx.article.replaceChildren(...cloned);
  afterDocumentRendered();
}

async function onClick(ev: MouseEvent): Promise<void> {
  if (!ctx) return;
  const { article, nodeMap, document } = ctx;
  if (pointerDrag) return;
  const domSel = window.getSelection();
  if (domSel && !domSel.isCollapsed) return;

  const raw = ev.target;
  if (!(raw instanceof Element)) {
    state = select(state, { kind: 'none' });
    paintSelected(article, state.selection);
    return;
  }

  if (raw === article || !article.contains(raw)) {
    state = select(state, { kind: 'none' });
    paintSelected(article, state.selection);
    return;
  }

  const link = raw.closest('a[href]');
  if (link instanceof HTMLAnchorElement && !ev.altKey) {
    await followLink(link, ev);
    return;
  }

  const carrier = raw.closest('[data-marxy-s]');
  if (!carrier) {
    state = select(state, { kind: 'none' });
    paintSelected(article, state.selection);
    return;
  }

  const resolved = resolve(carrier, nodeMap);
  if (!resolved) return;

  if (ev.altKey && link instanceof HTMLAnchorElement) {
    state = select(state, { kind: 'node', node: resolved.node as Inline, el: carrier });
    lastClickTarget = carrier;
    paintSelected(article, state.selection);
    return;
  }

  if (isInline(resolved.node) && resolved.node.type === 'code' && carrier === lastClickTarget) {
    const blockEl = carrier.parentElement?.closest('[data-marxy-s]') ?? carrier;
    const blockResolved = resolve(blockEl, nodeMap);
    if (blockResolved && isBlock(blockResolved.node)) {
      state = select(state, { kind: 'node', node: blockResolved.node, el: blockEl });
      lastClickTarget = blockEl;
      paintSelected(article, state.selection);
      return;
    }
  }

  lastClickTarget = carrier;
  state = select(state, {
    kind: 'node',
    node: resolved.node as Block | Inline,
    el: carrier,
  });
  paintSelected(article, state.selection);
}

/**
 * Attach listeners once, and follow the app's open document from then on: an operation resolves and
 * splices against the buffer the page was rendered from. A copy read here once at install went stale
 * on the first reload, Source edit or second open, and the next checkbox tick wrote it over the file.
 * Keyboard chords live in the command registry (MARXY-42).
 */
export async function installRenderedSelection(handle: AppHandle): Promise<void> {
  const article = document.getElementById('doc');
  if (!article || installedOn === article) return;
  installedOn = article;
  appHandle = handle;
  const adopt = (open: OpenDocumentState | null): void => {
    if (!open) {
      ctx = null;
      state = select(state, { kind: 'none' });
      lastClickTarget = null;
      return;
    }
    const next = { nodeMap: open.nodeMap, document: open.ast, buffer: open.buffer };
    if (!ctx) {
      ctx = { article, ...next, shell: handle.shell as SelectionRuntime['shell'] };
    } else {
      // Another document: nothing selected in the last one names anything in this one.
      if (ctx.buffer.path !== open.path) {
        state = select(state, { kind: 'none' });
        lastClickTarget = null;
      }
      afterDocumentRendered(next);
    }
    applyInvisibleMarkers(article);
    applyLinkDestinations(article);
  };
  adopt(handle.openDocument());
  handle.onDocumentChange((open) => {
    adopt(open);
    if (open && pendingFragment) {
      requestAnimationFrame(() => {
        scrollToFragment(pendingFragment!);
        pendingFragment = undefined;
      });
    }
  });


  // A click is not a drag until the pointer has moved a few pixels: a hand's jitter must still select.
  let downAt: { x: number; y: number } | null = null;
  article.addEventListener('mousedown', (ev) => {
    pointerDrag = false;
    downAt = { x: ev.clientX, y: ev.clientY };
  });
  article.addEventListener('mousemove', (ev) => {
    if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) >= DRAG_THRESHOLD_PX) pointerDrag = true;
  });
  article.addEventListener('mouseup', () => onPointerUp());
  article.addEventListener('click', (ev) => {
    // Before anything that can return early (a drag, a text selection, no document yet): a link
    // click that is not prevented navigates the window whether or not a handler follows it.
    const link = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
    if (link) ev.preventDefault();
    void onClick(ev);
  });

  const w = window as Window & {
    marxySelection?: {
      getSelectionState: typeof getSelectionState;
      rerenderWithSameHtml: typeof rerenderWithSameHtml;
      afterDocumentRendered: typeof afterDocumentRendered;
      resolve: typeof resolve;
      textOf: typeof textOf;
      parseMarkdown: typeof parseMarkdown;
      sectionRange: typeof sectionRange;
      createBuffer: typeof createBuffer;
    };
  };
  w.marxySelection = {
    getSelectionState,
    rerenderWithSameHtml,
    afterDocumentRendered,
    resolve,
    textOf,
    parseMarkdown,
    sectionRange,
    createBuffer,
  };
}

function onPointerUp(): void {
  if (!ctx) return;
  const domSel = window.getSelection();
  if (domSel && !domSel.isCollapsed && domSel.toString().trim().length > 0) {
    state = select(state, { kind: 'text', text: textFromDomSelection(domSel) });
    clearSelectedClass(ctx.article);
  }
}
