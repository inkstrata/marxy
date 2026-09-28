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
import type { AppHandle, AppShell, OpenDocumentState } from '../app.ts';
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
let installedOn: HTMLElement | null = null;
let appHandle: AppHandle | null = null;

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

async function followLink(anchor: HTMLAnchorElement, ev: MouseEvent): Promise<void> {
  const href = anchor.getAttribute('href');
  // A fragment scrolls within the page; anything else would navigate the reader's own window away
  // (a remote page loaded where the document was), so it goes to the shell or nowhere.
  if (!href || href.startsWith('#')) return;
  ev.preventDefault();
  const ext = ctx!.shell as AppShell & { openExternal?(url: string): Promise<void> };
  if (typeof ext.openExternal === 'function') await ext.openExternal(href);
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
  handle.onDocumentChange(adopt);

  article.addEventListener('mousedown', () => { pointerDrag = false; });
  article.addEventListener('mousemove', () => { pointerDrag = true; });
  article.addEventListener('mouseup', () => onPointerUp());
  article.addEventListener('click', (ev) => {
    // Before anything that can return early (a drag, a text selection, no document yet): a link
    // click that is not prevented navigates the window whether or not a handler follows it.
    const link = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
    if (link && !link.getAttribute('href')!.startsWith('#')) ev.preventDefault();
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
