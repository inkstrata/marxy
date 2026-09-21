// Summoned palette in the real document: input, list, keys, and ADR-0011 tab-bar checks (MARXY-87).

import type { IndexEntry, IndexHit } from '@marxy/core';
import { parseMarkdown } from '@marxy/core';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { READING_LINE_FRACTION } from '@marxy/core/src/position/blocks.ts';
import type { AppHandle, AppShell } from '../app.ts';
import { historyDirection, type PaletteKey } from './keys.ts';
import { jumpForHit, paletteResults, prepareIndex, type PreparedIndex } from './search.ts';
import {
  emptySession,
  goBack,
  goForward,
  recordOpen,
  togglePin,
  type PaletteSession,
} from './session.ts';

export type PaletteListSection = 'documents' | 'headings' | 'operations';
export type PalettePhase = 'empty' | 'typing' | 'operations';

export const PALETTE_ROW_LIMIT = 12;

/** Named mutation: CI must fail if a tab strip is inserted without removing this hook. */
export const TAB_BAR_DOM_MUTATION = 'marxy-87-insert-tab-bar';

const TAB_BAR_SELECTOR = '[role=tablist], [role=tab], .tab-bar, #marxy-tabs';

export interface PaletteModel {
  readonly phase: PalettePhase;
  readonly section: PaletteListSection;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly selected: number;
  readonly notice?: string;
}

export interface PaletteDeps {
  readonly shell: AppShell;
  readonly article: HTMLElement;
  readonly scroller: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly getCurrentPath: () => string | null;
  readonly setCurrentPath: (path: string) => void;
  readonly onSessionChange?: (session: PaletteSession) => void;
}

export interface PaletteController {
  readonly session: PaletteSession;
  open(): void;
  close(): void;
  setIndexEntries(entries: readonly IndexEntry[]): void;
}

function isMod(event: KeyboardEvent | PaletteKey): boolean {
  const mac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  return mac ? event.metaKey : event.ctrlKey;
}

function palettePhase(query: string, section: PaletteListSection): PalettePhase {
  if (section === 'operations') return 'operations';
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.startsWith('>')) return 'operations';
  return 'typing';
}

function toggleListSection(
  section: PaletteListSection,
  phase: PalettePhase,
): PaletteListSection {
  if (phase === 'operations' || section === 'operations') return section;
  return section === 'documents' ? 'headings' : 'documents';
}

function filterHits(hits: readonly IndexHit[], section: PaletteListSection): readonly IndexHit[] {
  if (section === 'headings') return hits.filter((hit) => hit.heading !== undefined);
  if (section === 'documents') return hits.filter((hit) => hit.heading === undefined);
  return hits;
}

function queryPalette(
  query: string,
  section: PaletteListSection,
  entries: readonly IndexEntry[],
  session: PaletteSession,
  prepared: PreparedIndex,
): PaletteModel {
  const phase = palettePhase(query, section);
  if (phase === 'operations') {
    return {
      phase: 'operations',
      section: 'operations',
      query,
      hits: [],
      selected: 0,
      notice: 'No operations yet',
    };
  }
  const trimmed = query.trim();
  const hits = paletteResults(trimmed, entries, session, { prepared, limit: 50 });
  const filtered = filterHits(hits, phase === 'empty' ? 'documents' : section);
  return {
    phase,
    section: phase === 'empty' ? 'documents' : section,
    query,
    hits: filtered.slice(0, PALETTE_ROW_LIMIT),
    selected: 0,
  };
}

/** True when the live document contains tab-bar chrome (ADR-0011). */
export function documentHasTabBar(doc: Document = document): boolean {
  applyTabBarMutation(doc);
  return doc.querySelector(TAB_BAR_SELECTOR) !== null;
}

function applyTabBarMutation(doc: Document): void {
  if (
    typeof process !== 'undefined' &&
    process.env?.MARXY_87_MUTATION === TAB_BAR_DOM_MUTATION &&
    doc.querySelector(TAB_BAR_SELECTOR) === null
  ) {
    const strip = doc.createElement('div');
    strip.id = 'marxy-tabs';
    strip.setAttribute('role', 'tablist');
    doc.body.appendChild(strip);
  }
}

function scrollToReadingLine(scroller: HTMLElement, target: HTMLElement): void {
  const line = READING_LINE_FRACTION * window.innerHeight;
  for (let pass = 0; pass < 3; pass++) {
    scroller.scrollTop = Math.max(0, scroller.scrollTop + target.getBoundingClientRect().top - line);
  }
}

function scrollToByteOffset(article: HTMLElement, scroller: HTMLElement, byteOffset: number): void {
  const node = article.querySelector(`[data-marxy-s="${byteOffset}"]`);
  const heading = node instanceof HTMLElement ? node : article.querySelector('h2,h3,h4');
  if (heading instanceof HTMLElement) scrollToReadingLine(scroller, heading);
}

async function renderPath(
  deps: PaletteDeps,
  path: string,
  setCurrentPath: (path: string) => void,
  byteOffset?: number,
): Promise<void> {
  const bytes = await deps.shell.readFile(path);
  const ast = parseMarkdown(bytes, { file: path });
  const { html } = renderDocumentSafeHtml(ast);
  deps.article.innerHTML = html;
  setCurrentPath(path);
  document.title = `${path.split('/').pop()} — marxy`;
  if (byteOffset !== undefined) scrollToByteOffset(deps.article, deps.scroller, byteOffset);
}

function injectPaletteStyles(doc: Document): void {
  if (doc.getElementById('marxy-palette-style')) return;
  const style = doc.createElement('style');
  style.id = 'marxy-palette-style';
  style.textContent = `
    #marxy-palette {
      margin: 2rem auto 0;
      padding: 0;
      border: 1px solid var(--marxy-color-border, #444);
      border-radius: 8px;
      width: min(640px, 90vw);
      background: var(--marxy-color-surface, #1a1a1a);
      color: var(--marxy-color-text, #eee);
      box-shadow: 0 12px 40px rgb(0 0 0 / 35%);
    }
    #marxy-palette::backdrop { background: rgb(0 0 0 / 25%); }
    #marxy-palette .marxy-palette-query {
      box-sizing: border-box;
      width: 100%;
      border: 0;
      border-bottom: 1px solid var(--marxy-color-border, #444);
      padding: 0.75rem 1rem;
      font: inherit;
      background: transparent;
      color: inherit;
    }
    #marxy-palette .marxy-palette-results {
      list-style: none;
      margin: 0;
      padding: 0.25rem 0;
      max-height: 50vh;
      overflow: auto;
    }
    #marxy-palette .marxy-palette-row {
      padding: 0.45rem 1rem;
      cursor: default;
    }
    #marxy-palette .marxy-palette-row[aria-selected="true"] {
      background: var(--marxy-color-accent-muted, rgb(255 255 255 / 8%));
    }
    #marxy-palette .marxy-palette-heading {
      opacity: 0.75;
      margin-left: 0.35rem;
    }
    #marxy-palette .marxy-palette-notice {
      margin: 0;
      padding: 0.5rem 1rem;
      font-size: 0.9em;
      opacity: 0.8;
      border-top: 1px solid var(--marxy-color-border, #444);
    }
  `;
  doc.head.appendChild(style);
}

type PaletteOwnerDocument = Pick<Document, 'createElement' | 'getElementById' | 'head'>;

function ensurePaletteStructure(
  dialog: HTMLElement,
  owner: PaletteOwnerDocument,
): {
  input: HTMLInputElement;
  list: HTMLOListElement;
  notice: HTMLParagraphElement;
} {
  if (dialog.querySelector('.marxy-palette-query')) {
    return {
      input: dialog.querySelector('.marxy-palette-query') as HTMLInputElement,
      list: dialog.querySelector('.marxy-palette-results') as HTMLOListElement,
      notice: dialog.querySelector('.marxy-palette-notice') as HTMLParagraphElement,
    };
  }
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Palette');
  const input = owner.createElement('input') as HTMLInputElement;
  input.className = 'marxy-palette-query';
  input.setAttribute('aria-label', 'Search titles, headings and paths');
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = owner.createElement('ol') as HTMLOListElement;
  list.className = 'marxy-palette-results';
  list.setAttribute('role', 'listbox');
  const notice = owner.createElement('p') as HTMLParagraphElement;
  notice.className = 'marxy-palette-notice';
  notice.hidden = true;
  dialog.replaceChildren(input, list, notice);
  return { input, list, notice };
}

function labelForHit(hit: IndexHit): string {
  if (hit.heading !== undefined) {
    const heading = hit.entry.headings[hit.heading];
    if (heading !== undefined) return `${hit.entry.title} › ${heading.text}`;
  }
  return hit.entry.title;
}

function ownerDocumentOf(node: HTMLElement): Document {
  if (node.ownerDocument) return node.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('paintRows requires an owner document');
}

function paintRows(list: HTMLOListElement, hits: readonly IndexHit[], selected: number): void {
  const doc = ownerDocumentOf(list);
  const keyed = new Map<string, HTMLLIElement>();
  for (const child of list.children) {
    if (child instanceof HTMLLIElement && child.dataset.rowKey) {
      keyed.set(child.dataset.rowKey, child);
    }
  }
  const next =
    'createDocumentFragment' in doc
      ? (doc as Document).createDocumentFragment()
      : document.createDocumentFragment();
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const key = `${hit.entry.path}:${hit.heading ?? 'doc'}`;
    let row = keyed.get(key);
    if (!row) {
      row = doc.createElement('li') as HTMLLIElement;
      row.className = 'marxy-palette-row';
      row.dataset.rowKey = key;
      row.setAttribute('role', 'option');
    }
    row.textContent = labelForHit(hit);
    row.toggleAttribute('aria-selected', i === selected);
    if (hit.heading !== undefined) {
      const heading = hit.entry.headings[hit.heading];
      if (heading !== undefined) row.dataset.marxyS = String(heading.byteOffset);
    } else {
      delete row.dataset.marxyS;
    }
    next.appendChild(row);
  }
  list.replaceChildren(next);
}

const keystrokeSamples: number[] = [];

function recordKeystrokePaint(ms: number, shell: AppShell): void {
  keystrokeSamples.push(ms);
  while (keystrokeSamples.length > 50) keystrokeSamples.shift();
  void shell.mark('palette_keystroke', Date.now(), `ms=${ms.toFixed(2)}`);
}

export function paletteKeystrokeP95(): number | null {
  if (keystrokeSamples.length === 0) return null;
  const sorted = keystrokeSamples.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function mountPaletteApp(deps: PaletteDeps): PaletteController {
  injectPaletteStyles(document);
  const { input, list, notice } = ensurePaletteStructure(deps.dialog, document);
  let session = emptySession('/');
  let entries: IndexEntry[] = [];
  let prepared = prepareIndex(entries);
  let section: PaletteListSection = 'documents';
  let model = queryPalette('', section, entries, session, prepared);
  let open = false;
  let selected = 0;
  const syncSession = () => deps.onSessionChange?.(session);

  const repaint = (markPerf?: number) => {
    model = queryPalette(input.value, section, entries, session, prepared);
    selected = Math.min(selected, Math.max(0, model.hits.length - 1));
    paintRows(list, model.hits, selected);
    if (model.notice) {
      notice.textContent = model.notice;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
    if (markPerf !== undefined) recordKeystrokePaint(markPerf, deps.shell);
  };

  const summon = () => {
    open = true;
    if (!deps.dialog.open) deps.dialog.showModal();
    input.value = model.query;
    repaint();
    input.focus();
    input.select();
  };

  const dismiss = () => {
    open = false;
    if (deps.dialog.open) deps.dialog.close();
  };

  const activateHit = async (hit: IndexHit | undefined) => {
    if (hit === undefined) return;
    const jump = jumpForHit(hit);
    session = recordOpen(session, jump.path);
    syncSession();
    dismiss();
    if (deps.getCurrentPath() !== jump.path) {
      await renderPath(deps, jump.path, deps.setCurrentPath);
    } else {
      deps.setCurrentPath(jump.path);
    }
    const offset = jump.byteOffset;
    if (offset !== undefined) {
      scrollToByteOffset(deps.article, deps.scroller, offset);
      requestAnimationFrame(() => scrollToByteOffset(deps.article, deps.scroller, offset));
    }
  };

  input.addEventListener('input', () => {
    selected = 0;
    const started = performance.now();
    repaint();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recordKeystrokePaint(performance.now() - started, deps.shell);
      });
    });
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      section = toggleListSection(section, model.phase);
      selected = 0;
      repaint();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.min(model.hits.length - 1, selected + 1);
      paintRows(list, model.hits, selected);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      paintRows(list, model.hits, selected);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void activateHit(model.hits[selected]);
    }
  });

  window.addEventListener('keydown', (event) => {
    const dir = historyDirection(event);
    if (dir !== undefined && !open) {
      event.preventDefault();
      const step = dir === 'back' ? goBack(session) : goForward(session);
      if (step === undefined) return;
      session = step.session;
      syncSession();
      void renderPath(deps, step.path, deps.setCurrentPath);
      return;
    }
    if (isMod(event) && event.key.toLowerCase() === 'p' && !event.shiftKey) {
      event.preventDefault();
      if (open) dismiss();
      else summon();
    }
    if (isMod(event) && event.key === '.' && open) {
      const hit = model.hits[selected];
      if (hit?.heading === undefined) {
        event.preventDefault();
        session = togglePin(session, hit?.entry.path ?? '');
        syncSession();
        repaint();
      }
    }
  });

  return {
    get session() {
      return session;
    },
    open: summon,
    close: dismiss,
    setIndexEntries(next) {
      entries = [...next];
      prepared = prepareIndex(entries);
      repaint();
    },
  };
}

export function mountPaletteFromHandle(
  handle: AppHandle,
  opts?: { initialPath?: string | null },
): PaletteController {
  const main = document.getElementById('marxy-main');
  const article = document.getElementById('doc') ?? document.querySelector('.marxy-article');
  const dialog = document.getElementById('marxy-palette');
  if (!(article instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement)) {
    throw new Error('palette mount: expected #doc and dialog#marxy-palette in the document');
  }
  const scroller = document.documentElement;
  const pathState = { current: opts?.initialPath ?? null };
  return mountPaletteApp({
    shell: handle.shell,
    article,
    scroller,
    dialog,
    getCurrentPath: () => pathState.current,
    setCurrentPath: (path) => {
      pathState.current = path;
    },
    onSessionChange: (next) => {
      const tip = next.history[next.historyIndex];
      if (tip !== undefined) pathState.current = tip;
    },
  });
}

/** Legacy model tests re-exported from palette.ts; production uses mountPaletteFromHandle. */
export interface PaletteViewState {
  readonly open: boolean;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly selected: number;
  readonly notice?: string;
}

const LEGACY_TAB_BAR_SELECTOR =
  '[role="tablist"], [role="tab"], [data-tab-bar], .tab-bar, #tab-bar, #marxy-tabs';

export function hasTabBar(root: ParentNode): boolean {
  return (
    root.querySelector(LEGACY_TAB_BAR_SELECTOR) !== null ||
    root.querySelector(TAB_BAR_SELECTOR) !== null
  );
}

export function createPaletteDocument(): Document {
  if (typeof document !== 'undefined') return document;
  return createHeadlessPaletteDocument() as unknown as Document;
}

export interface PaletteView {
  readonly root: HTMLDialogElement;
  update(state: PaletteViewState): void;
  destroy(): void;
}

export function mountPalette(
  host: HTMLElement,
  doc: Document,
  state: PaletteViewState,
): PaletteView {
  injectPaletteStyles(doc);
  const existing = doc.getElementById('marxy-palette');
  const root =
    existing !== null
      ? existing
      : (() => {
          const created = doc.createElement('dialog') as HTMLDialogElement;
          created.id = 'marxy-palette';
          host.appendChild(created);
          return created;
        })();
  const { input, list, notice } = ensurePaletteStructure(root, doc);

  const paint = (next: PaletteViewState) => {
    if (!next.open) {
      root.setAttribute('hidden', '');
      if ('open' in root && (root as HTMLDialogElement).open) (root as HTMLDialogElement).close();
      return;
    }
    root.removeAttribute('hidden');
    const dialogRoot = root as HTMLDialogElement;
    if (!dialogRoot.open && typeof dialogRoot.showModal === 'function') {
      dialogRoot.showModal();
    }
    input.value = next.query;
    paintRows(list, next.hits, next.selected);
    if (next.notice) {
      notice.textContent = next.notice;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  };

  paint(state);
  return {
    root: root as HTMLDialogElement,
    update: paint,
    destroy() {
      root.remove();
    },
  };
}

/** Node unit tests only; production uses the real document (MARXY-87). */
function createHeadlessPaletteDocument(): PaletteOwnerDocument & {
  createElement(tag: string): HTMLElement;
} {
  type HNode = {
    tagName: string;
    attrs: Map<string, string>;
    children: HNode[];
    textContent: string;
    parent?: HNode;
  };

  const makeNode = (tag: string): HTMLElement => {
    const node: HNode = {
      tagName: tag.toUpperCase(),
      attrs: new Map(),
      children: [],
      textContent: '',
    };
    const el = node as unknown as HTMLElement;
    el.getAttribute = (name: string) => node.attrs.get(name.toLowerCase()) ?? null;
    el.setAttribute = (name: string, value: string) => {
      node.attrs.set(name.toLowerCase(), value);
    };
    el.removeAttribute = (name: string) => {
      node.attrs.delete(name.toLowerCase());
    };
    el.toggleAttribute = (name: string, force?: boolean) => {
      const has = node.attrs.has(name.toLowerCase());
      const next = force ?? !has;
      if (next) node.attrs.set(name.toLowerCase(), '');
      else node.attrs.delete(name.toLowerCase());
      return next;
    };
    el.appendChild = <T extends Node>(child: T): T => {
      const h = child as unknown as HNode;
      h.parent = node;
      node.children.push(h);
      return child;
    };
    el.removeChild = <T extends Node>(child: T): T => {
      const at = node.children.indexOf(child as unknown as HNode);
      if (at >= 0) node.children.splice(at, 1);
      return child;
    };
    el.remove = () => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    };
    el.replaceChildren = (...nodes: Element[]) => {
      node.children.length = 0;
      for (const child of nodes) {
        const h = child as unknown as HNode;
        if (h.tagName === 'FRAGMENT') {
          for (const grand of h.children) node.children.push(grand);
        } else {
          node.children.push(h);
        }
      }
    };
    Object.defineProperty(el, 'hidden', {
      get: () => el.getAttribute('hidden') !== null,
      set: (v: boolean) => (v ? el.setAttribute('hidden', '') : el.removeAttribute('hidden')),
    });
    Object.defineProperty(el, 'className', {
      get: () => el.getAttribute('class') ?? '',
      set: (v: string) => el.setAttribute('class', v),
    });
    const dataKey = (prop: string) =>
      `data-${prop.replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`)}`;
    Object.defineProperty(el, 'dataset', {
      value: new Proxy({} as DOMStringMap, {
        set(_target, prop, value) {
          if (typeof prop === 'string') node.attrs.set(dataKey(prop), String(value));
          return true;
        },
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          return node.attrs.get(dataKey(prop));
        },
      }),
    });
    Object.defineProperty(el, 'id', {
      get: () => el.getAttribute('id') ?? '',
      set: (v: string) => el.setAttribute('id', v),
    });
    el.querySelector = (sel: string) => queryHeadless(node, sel, false) as Element | null;
    el.querySelectorAll = (sel: string) =>
      queryHeadlessAll(node, sel) as unknown as NodeListOf<Element>;
    return el;
  };

  const queryHeadlessAll = (root: HNode, sel: string): HNode[] => {
    const out: HNode[] = [];
    const visit = (n: HNode) => {
      for (const child of n.children) {
        if (headlessMatches(child, sel)) out.push(child);
        visit(child);
      }
    };
    visit(root);
    return out;
  };

  const queryHeadless = (root: HNode, sel: string, deep: boolean): HNode | null => {
    if (headlessMatches(root, sel)) return root;
    for (const child of root.children) {
      const hit = queryHeadless(child, sel, true);
      if (hit) return hit;
    }
    return null;
  };

  const headlessMatches = (node: HNode, sel: string): boolean => {
    const role = node.attrs.get('role');
    const id = node.attrs.get('id');
    const cls = node.attrs.get('class') ?? '';
    if (sel === '[role="tablist"]' || sel === '[role=tablist]') return role === 'tablist';
    if (sel === '[role="tab"]' || sel === '[role=tab]') return role === 'tab';
    if (sel === '[data-tab-bar]') return node.attrs.has('data-tab-bar');
    if (sel === '.tab-bar') return cls.split(/\s+/).includes('tab-bar');
    if (sel === '#tab-bar') return id === 'tab-bar';
    if (sel === '#marxy-palette') return id === 'marxy-palette';
    if (sel === '.marxy-palette-results') return cls.split(/\s+/).includes('marxy-palette-results');
    if (sel === '[data-marxy-s]') return node.attrs.has('data-marxy-s');
    if (sel.includes(',')) return sel.split(',').some((part) => headlessMatches(node, part.trim()));
    return false;
  };

  const body = makeNode('body');
  const docRef: PaletteOwnerDocument & {
    createElement(tag: string): HTMLElement;
    createDocumentFragment(): DocumentFragment;
  } = {
    createElement(tag: string) {
      const node = makeNode(tag);
      (node as HTMLElement & { ownerDocument?: Document }).ownerDocument = docRef as unknown as Document;
      return node;
    },
    createDocumentFragment() {
      const frag = makeNode('fragment');
      (frag as HTMLElement & { ownerDocument?: Document }).ownerDocument = docRef as unknown as Document;
      return frag as unknown as DocumentFragment;
    },
    getElementById(id: string) {
      return queryHeadless(body as unknown as HNode, `#${id}`, true) as HTMLElement | null;
    },
    head: { appendChild() {} } as unknown as HTMLHeadElement,
  };
  (body as HTMLElement & { ownerDocument?: Document }).ownerDocument = docRef as unknown as Document;
  return docRef;
}
