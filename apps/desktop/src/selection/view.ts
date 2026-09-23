// Rendered-mode clicks, keys, `.marxy-selected`, and re-render restore (MARXY-41; keys migrate in MARXY-42).

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
import type { AppHandle, AppShell } from '../app.ts';
import type { NodeMap } from '../render/post.ts';
import { moveSibling, parentOf, select, type Selection, type SelectionState } from './selection.ts';
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

async function followLink(anchor: HTMLAnchorElement): Promise<void> {
  const href = anchor.getAttribute('href');
  if (!href) return;
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
    await followLink(link);
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

/** Attach listeners once; keyboard chords live in the command registry (MARXY-42). */
export async function installRenderedSelection(handle: AppHandle): Promise<void> {
  const open = handle.state.document;
  const article = document.getElementById('doc');
  if (!open || !article || article.querySelector('[data-marxy-s]') === null) return;
  if (installedOn === article) return;
  installedOn = article;
  const path = open.ast.path;
  const bytes = await handle.shell.readFile(path);
  const buffer = createBuffer(path, bytes);
  ctx = {
    article,
    nodeMap: open.nodeMap,
    document: open.ast,
    buffer,
    shell: handle.shell as SelectionRuntime['shell'],
  };

  article.addEventListener('mousedown', () => { pointerDrag = false; });
  article.addEventListener('mousemove', () => { pointerDrag = true; });
  article.addEventListener('mouseup', () => onPointerUp());
  article.addEventListener('click', (ev) => { void onClick(ev); });

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
    state = select(state, { kind: 'text', text: domSel.toString() });
    clearSelectedClass(ctx.article);
  }
}
