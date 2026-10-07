// Summoned palette in the real document: input, list, keys, and ADR-0011 tab-bar checks (MARXY-87).

import type { IndexEntry, IndexHit } from '@marxy/core';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppHandle, AppShell } from '../app.ts';
import { setAppHandle, setPalette } from '../commands/app-handle.ts';
import { commands, type Command } from '../commands/index.ts';
import { withPaletteListing } from '../commands/navigation.ts';
import { buildAppContext, setPaletteCloser } from '../selection/bind.ts';
import type { PaletteKey } from './keys.ts';
import { keyLabel, paletteCommands } from './commands.ts';
import { createIndexFeed, type IndexFeed } from './index-feed.ts';
import { jumpForHit, paletteResults, type PreparedIndex, type RootRank } from './search.ts';
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
  readonly operationCommands: readonly Command[];
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
  /**
   * The app's one way to open a document (`AppHandle.open`): buffer, parse, render, typeset, grid,
   * deferred passes, and teardown of the one before. `at` is a byte offset to land on. The palette
   * never writes `#doc` itself, so the app never holds one file's buffer while showing another.
   */
  readonly openDocument: (path: string, at?: number) => Promise<void>;
}

export interface PaletteController {
  readonly session: PaletteSession;
  open(): void;
  close(): void;
  setIndexEntries(entries: readonly IndexEntry[]): void;
  /** What the palette searches: the index in scope order (C-10). The collection sets its folders here. */
  readonly feed: IndexFeed;
  /** One step back through the session history; false when there is none (the key is then left alone). */
  back(): boolean;
  /** One step forward through the session history; false when there is none. */
  forward(): boolean;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
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

function commandsForPalette(query: string): readonly Command[] {
  const after = query.trim().slice(1);
  return withPaletteListing(() => paletteCommands(commands(), buildAppContext(), after));
}

/** Operations close the palette themselves once they apply; every other command is closed over here. */
function runPaletteCommand(cmd: Command | undefined): void {
  if (cmd === undefined) return;
  const ctx = buildAppContext();
  if (!cmd.id.startsWith('op.')) ctx.closePalette();
  void cmd.run(ctx);
}

function queryPalette(
  query: string,
  section: PaletteListSection,
  entries: readonly IndexEntry[],
  session: PaletteSession,
  prepared: PreparedIndex,
  rootRank: RootRank,
  scopeNotice: string | undefined,
): PaletteModel {
  const phase = palettePhase(query, section);
  if (phase === 'operations') {
    const operationCommands = commandsForPalette(query);
    return {
      phase: 'operations',
      section: 'operations',
      query,
      hits: [],
      operationCommands,
      selected: 0,
      notice: operationCommands.length === 0 ? 'No commands here' : undefined,
    };
  }
  const trimmed = query.trim();
  const hits = paletteResults(trimmed, entries, session, { prepared, limit: 50, rootRank });
  const filtered = filterHits(hits, phase === 'empty' ? 'documents' : section);
  return {
    phase,
    section: phase === 'empty' ? 'documents' : section,
    query,
    hits: filtered.slice(0, PALETTE_ROW_LIMIT),
    operationCommands: [],
    selected: 0,
    notice: scopeNotice,
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

async function renderPath(deps: PaletteDeps, path: string, byteOffset?: number): Promise<void> {
  await deps.openDocument(path, byteOffset);
  deps.setCurrentPath(path);
}

function injectPaletteStyles(doc: Document): void {
  if (doc.getElementById('marxy-palette-style')) return;
  adoptRuntimeSheet(doc, 'marxy-palette-style', `
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
    #marxy-palette .marxy-palette-row:has(.marxy-palette-key) {
      display: flex;
      gap: 1em;
    }
    #marxy-palette .marxy-palette-key {
      margin-inline-start: auto;
      opacity: 0.75;
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
  `);
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

function paintOperationRows(
  list: HTMLOListElement,
  cmds: readonly Command[],
  selected: number,
): void {
  const doc = ownerDocumentOf(list);
  const next =
    'createDocumentFragment' in doc
      ? (doc as Document).createDocumentFragment()
      : document.createDocumentFragment();
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]!;
    const row = doc.createElement('li') as HTMLLIElement;
    row.className = 'marxy-palette-row';
    row.dataset.rowKey = cmd.id;
    row.setAttribute('role', 'option');
    const title = doc.createElement('span') as HTMLSpanElement;
    title.className = 'marxy-palette-title';
    title.textContent = cmd.title;
    row.appendChild(title);
    const spec = cmd.key ?? (cmd.id.startsWith('op.copy-') ? 'Mod+C' : undefined);
    if (spec !== undefined) {
      const key = doc.createElement('span') as HTMLSpanElement;
      key.className = 'marxy-palette-key';
      key.textContent = keyLabel(spec, isMacPlatform());
      row.appendChild(key);
    }
    row.toggleAttribute('aria-selected', i === selected);
    next.appendChild(row);
  }
  list.replaceChildren(next);
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

export function mountPaletteApp(deps: PaletteDeps): PaletteController {
  injectPaletteStyles(document);
  const { input, list, notice } = ensurePaletteStructure(deps.dialog, document);
  let session = emptySession('/');
  const feed = createIndexFeed({
    currentRoot: () => session.currentRoot,
    recentRoots: () => session.recentRoots,
    readAt: () => session.readAt,
  });
  const query = (text: string) =>
    queryPalette(text, section, feed.entries(), session, feed.prepared(), feed.rootRank(), feed.notice());
  let section: PaletteListSection = 'documents';
  let model = query('');
  let open = false;
  let selected = 0;
  const syncSession = () => deps.onSessionChange?.(session);

  const repaint = (markPerf?: number) => {
    model = query(input.value);
    const rowCount =
      model.phase === 'operations' ? model.operationCommands.length : model.hits.length;
    selected = Math.min(selected, Math.max(0, rowCount - 1));
    if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
    else paintRows(list, model.hits, selected);
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

  // Every rebuild of what the palette searches repaints it: a new walk, a folder added or dropped.
  feed.subscribe(() => repaint());

  deps.dialog.addEventListener('close', () => {
    // Native cancel (Esc with focus off the input) closes the dialog without going through dismiss.
    // (Reads the live state: a stale close event must not shut a palette summoned since.)
    if (open && !deps.dialog.open) dismiss();
  });

  list.addEventListener('click', (event) => {
    const target = event.target as { closest?: (s: string) => Element | null } | null;
    const row = target?.closest?.('.marxy-palette-row') as HTMLElement | null | undefined;
    if (!row) return;
    const index = Array.prototype.indexOf.call(list.children, row);
    if (index < 0) return;
    if (model.phase === 'operations') {
      runPaletteCommand(model.operationCommands[index]);
    } else {
      void activateHit(model.hits[index]);
    }
  });

  const activateHit = async (hit: IndexHit | undefined) => {
    if (hit === undefined) return;
    const jump = jumpForHit(hit);
    session = recordOpen(session, jump.path, hit.entry.root);
    syncSession();
    dismiss();
    // After the palette is gone, and off this tick: the open never waits on a re-prepare.
    setTimeout(() => feed.refresh(), 0);
    // The document on screen with no heading to land on: nothing to open.
    if (deps.getCurrentPath() === jump.path && jump.byteOffset === undefined) return;
    await renderPath(deps, jump.path, jump.byteOffset);
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
    // A key that drives an IME composition (candidate confirm, cancel, navigation) is the
    // IME's, not the palette's. Safari reports keyCode 229 for the keydown after compositionend.
    if (event.isComposing || event.keyCode === 229) return;
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
    const rowCount =
      model.phase === 'operations' ? model.operationCommands.length : model.hits.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.min(rowCount - 1, selected + 1);
      if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
      else paintRows(list, model.hits, selected);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
      else paintRows(list, model.hits, selected);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (model.phase === 'operations') {
        runPaletteCommand(model.operationCommands[selected]);
      } else {
        void activateHit(model.hits[selected]);
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    if (isMod(event) && event.key.toLowerCase() === 'p' && !event.shiftKey) {
      event.preventDefault();
      if (open) dismiss();
      else summon();
    }
    if (isMod(event) && event.key === '.' && open) {
      const hit = model.hits[selected];
      // `hit?.heading === undefined` alone is also true when there is no hit at all (an empty
      // result list, or the operations phase, where `hits` is always []) — pin only a real hit.
      if (hit !== undefined && hit.heading === undefined) {
        event.preventDefault();
        session = togglePin(session, hit.entry.path);
        syncSession();
        repaint();
      }
    }
  });

  const travel = (step: ReturnType<typeof goBack>): boolean => {
    if (step === undefined) return false;
    session = step.session;
    syncSession();
    // Off the critical path, as in activateHit: the navigation never waits on a re-prepare.
    setTimeout(() => feed.refresh(), 0);
    void renderPath(deps, step.path);
    return true;
  };

  return {
    get session() {
      return session;
    },
    back: () => travel(goBack(session)),
    forward: () => travel(goForward(session)),
    open: summon,
    close: dismiss,
    setIndexEntries(next) {
      feed.setEntries(next);
    },
    feed,
  };
}

export function mountPaletteFromHandle(
  handle: AppHandle,
  opts?: { initialPath?: string | null },
): PaletteController {
  // The selection controller and the command keys are the app's own: `startApp` made and installed them.
  const main = document.getElementById('marxy-main');
  const article = document.getElementById('doc') ?? document.querySelector('.marxy-article');
  const dialog = document.getElementById('marxy-palette');
  if (!(article instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement)) {
    throw new Error('palette mount: expected #doc and dialog#marxy-palette in the document');
  }
  const scroller = document.documentElement;
  const controller = mountPaletteApp({
    shell: handle.shell,
    article,
    scroller,
    dialog,
    // What is on screen is the app's to say. A copy kept here and moved to the history tip on every
    // session change named the document being opened as the one already shown, so it never opened.
    getCurrentPath: () => handle.currentPath() ?? opts?.initialPath ?? null,
    setCurrentPath: () => {},
    openDocument: (path, at) => handle.open(path, { at }),
  });
  setPaletteCloser(() => controller.close());
  setAppHandle(handle);
  setPalette(controller);
  return controller;
}
