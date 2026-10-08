// Summoned palette in the real document: input, list, keys, and ADR-0011 tab-bar checks (MARXY-87).

import type { IndexEntry, IndexHit } from '@marxy/core';
import type { ContentHit, Shell } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppHandle, AppShell } from '../app.ts';
import { setAppHandle, setPalette } from '../commands/app-handle.ts';
import { commands, type Command } from '../commands/index.ts';
import { withPaletteListing } from '../commands/navigation.ts';
import type { DocumentStore } from '../document/store.ts';
import { buildAppContext, setPaletteCloser, setPaletteOpener } from '../selection/bind.ts';
import { copyDefault, markdownCopy } from '../selection/verbs.ts';
import {
  contentQuery,
  createContentSearch,
  CONTENT_ROW_LIMIT,
  HINT_NOTICE,
  type ContentSearch,
  type ContentState,
} from './content.ts';
import type { PaletteKey } from './keys.ts';
import { keyLabel, paletteCommands } from './commands.ts';
import {
  changedSinceRead,
  emptyStateSections,
  relativeAge,
  spokenAge,
  type EmptySection,
  type EmptySectionKind,
} from './empty-state.ts';
import { setOpenListener } from './history.ts';
import { createIndexFeed, type IndexFeed } from './index-feed.ts';
import type { CheckoutKey } from './fold.ts';
import { jumpForHit, paletteResults, type FoldCopies, type PreparedIndex, type RootRank } from './search.ts';
import {
  emptySession,
  goBack,
  goForward,
  markRead,
  recordOpen,
  togglePin,
  type PaletteSession,
} from './session.ts';

export type PaletteListSection = 'documents' | 'headings' | 'operations';
export type PalettePhase = 'empty' | 'typing' | 'operations' | 'content';

export const PALETTE_ROW_LIMIT = 12;

export interface PaletteModel {
  readonly phase: PalettePhase;
  readonly section: PaletteListSection;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly operationCommands: readonly Command[];
  readonly selected: number;
  readonly notice?: string;
  /** The content phase only (C-17): the matches painted, in the order the shell returned them. */
  readonly contentHits?: readonly ContentHit[];
  /** The empty phase only: `hits` is these sections' rows in order, so a row index never counts a label. */
  readonly sections?: readonly EmptySection[];
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
  /** Selects the innermost block of the open document that holds `byte` (the rendered selection, C-17). */
  readonly selectBlockAtByte?: (byte: number) => void;
  /** Content search for `/` queries (C-16). Without it the `/` phase says so and finds nothing. */
  readonly searchContent?: Shell['searchContent'];
  /** Milliseconds a content query waits for the next keystroke; 120 unless a test says otherwise. */
  readonly contentDebounceMs?: number;
  /** Whether a root is watched (the index service's `isWatched`). Read on each summon, never held. */
  readonly isWatched?: (root: string) => boolean;
  /** When Marxy first indexed a root (the index service's `baselineMs`). */
  readonly baselineMs?: (root: string) => number | undefined;
  /** Which repository and checkout hold a path (the index service's `checkoutKey`): copies from worktrees fold (C-15). */
  readonly checkoutKey?: (path: string) => CheckoutKey | undefined;
  /** The clock, for the ages. */
  readonly now?: () => number;
  /** Called each time the palette is summoned: the index re-walks folders it could not watch (C-11). */
  readonly onSummon?: () => void;
}

export interface PaletteController {
  readonly session: PaletteSession;
  /** Summons the palette; with `query` (such as `'>'`), opens it on that query (C-06, for C-13's menu). */
  open(query?: string): void;
  close(): void;
  setIndexEntries(entries: readonly IndexEntry[]): void;
  /** What the palette searches: the index in scope order (C-10). The collection sets its folders here. */
  readonly feed: IndexFeed;
  /**
   * `path` was read (an open by any route) or saved from Marxy: its read time is now, so it is no longer
   * "changed since you read". A save leaves the MRU order alone.
   */
  noteRead(path: string, how: 'open' | 'save'): void;
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
  if (trimmed.startsWith('/')) return 'content';
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

/** One quiet line when copies from other checkouts were folded away (commitment 4: nothing hidden silently). */
export function foldedNotice(copies: number, scopeNotice: string | undefined): string | undefined {
  if (copies === 0) return scopeNotice;
  const line = `${copies} ${copies === 1 ? 'copy' : 'copies'} in other checkouts ${copies === 1 ? 'is' : 'are'} folded; type a checkout's folder name and a slash first to list ${copies === 1 ? 'it' : 'them'}.`;
  return scopeNotice === undefined ? line : `${scopeNotice} ${line}`;
}

function queryPalette(
  query: string,
  section: PaletteListSection,
  entries: readonly IndexEntry[],
  session: PaletteSession,
  prepared: PreparedIndex,
  rootRank: RootRank,
  fold: FoldCopies | undefined,
  scopeNotice: string | undefined,
  emptySections: () => readonly EmptySection[],
  content: ContentState,
): PaletteModel {
  const phase = palettePhase(query, section);
  if (phase === 'content') {
    // Never the fuzzy matcher: the shell's scan answers, after a pause (content.ts).
    return {
      phase,
      section: 'documents',
      query,
      hits: [],
      operationCommands: [],
      selected: 0,
      notice: content.notice,
      contentHits: content.hits.slice(0, CONTENT_ROW_LIMIT),
    };
  }
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
  if (phase === 'empty') {
    const sections = emptySections();
    return {
      phase,
      section: 'documents',
      query,
      hits: sections.flatMap((one) => one.hits),
      operationCommands: [],
      selected: 0,
      notice: scopeNotice,
      sections,
    };
  }
  const trimmed = query.trim();
  let folded = 0;
  const hits = paletteResults(trimmed, entries, session, {
    prepared,
    limit: 50,
    rootRank,
    fold: fold && { ...fold, folded: (copies) => (folded = copies) },
  });
  const filtered = filterHits(hits, section);
  return {
    phase,
    section,
    query,
    hits: filtered.slice(0, PALETTE_ROW_LIMIT),
    operationCommands: [],
    selected: 0,
    notice: foldedNotice(folded, scopeNotice),
  };
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
    #marxy-palette .marxy-palette-row:has(.marxy-palette-age) {
      display: flex;
      align-items: baseline;
      gap: 0.6em;
    }
    #marxy-palette .marxy-palette-row:has(.marxy-palette-age) .marxy-palette-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-group { list-style: none; }
    #marxy-palette .marxy-palette-group > ol { list-style: none; margin: 0; padding: 0; }
    #marxy-palette .marxy-palette-section {
      display: block;
      padding: 0.55rem 1rem 0.15rem;
      font-size: 0.8em;
      color: var(--marxy-color-text-secondary, #a39e94);
      cursor: default;
      user-select: none;
    }
    #marxy-palette .marxy-palette-group:first-child > .marxy-palette-section { padding-top: 0.25rem; }
    #marxy-palette .marxy-palette-age {
      color: var(--marxy-color-text-secondary, #a39e94);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }
    #marxy-palette .marxy-palette-changed {
      flex: none;
      align-self: center;
      width: 0.4em;
      height: 0.4em;
      border-radius: 50%;
      background: var(--marxy-color-accent, #8fb4dd);
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
    #marxy-palette .marxy-palette-hit-head { display: flex; gap: 0.6em; align-items: baseline; }
    #marxy-palette .marxy-palette-hit-head .marxy-palette-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-line {
      flex: none;
      color: var(--marxy-color-text-secondary, #a39e94);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }
    #marxy-palette .marxy-palette-preview {
      color: var(--marxy-color-text-secondary, #a39e94);
      font-size: 0.85em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-match {
      background: transparent;
      color: var(--marxy-color-text, #eee);
      font-weight: 600;
      text-decoration: underline;
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

/**
 * The chords name the selection's own default verbs, from the written tables (ADR-0054). The selection
 * cannot change while the palette is up, so they are read once per summon, not on every keystroke.
 */
let chordCache: { readonly copyId?: string; readonly markdownId?: string } | undefined;
function selectionChords(): { readonly copyId?: string; readonly markdownId?: string } {
  if (chordCache === undefined) {
    const ctx = buildAppContext();
    const registered = commands();
    chordCache = { copyId: copyDefault(ctx, registered)?.id, markdownId: markdownCopy(ctx, registered)?.id };
  }
  return chordCache;
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
  const { copyId, markdownId } = selectionChords();
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
    const spec = cmd.key ?? (cmd.id === copyId ? 'Mod+C' : cmd.id === markdownId ? 'Mod+Shift+C' : undefined);
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

/** What a document row says besides its title: its age and whether it changed since it was read. */
interface RowDecor {
  readonly age: (hit: IndexHit) => string | undefined;
  readonly changed: (hit: IndexHit) => boolean;
}

const SECTION_LABELS: Record<EmptySectionKind, string> = {
  pinned: 'Pinned',
  changed: 'Changed since you read',
  recent: 'Recent',
};

function documentRow(
  doc: Document,
  hit: IndexHit,
  decor: RowDecor,
  selected: boolean,
  reuse?: HTMLLIElement,
): HTMLLIElement {
  const key = `${hit.entry.path}:${hit.heading ?? 'doc'}`;
  const row = reuse ?? (doc.createElement('li') as HTMLLIElement);
  if (reuse === undefined) {
    row.className = 'marxy-palette-row';
    row.dataset.rowKey = key;
    row.setAttribute('role', 'option');
  }
  const age = decor.age(hit);
  if (age === undefined) {
    row.textContent = labelForHit(hit);
    row.removeAttribute('aria-label');
  } else {
    const title = doc.createElement('span') as HTMLSpanElement;
    title.className = 'marxy-palette-title';
    title.textContent = labelForHit(hit);
    row.replaceChildren(title);
    if (decor.changed(hit)) {
      const mark = doc.createElement('span') as HTMLSpanElement;
      mark.className = 'marxy-palette-changed';
      mark.setAttribute('aria-hidden', 'true');
      row.appendChild(mark);
    }
    const when = doc.createElement('span') as HTMLSpanElement;
    when.className = 'marxy-palette-age';
    when.setAttribute('aria-hidden', 'true');
    when.textContent = age;
    row.appendChild(when);
    // An option's children are presentational to a screen reader, so the age and the changed state
    // are said in the option's own name.
    row.setAttribute(
      'aria-label',
      `${labelForHit(hit)}, ${spokenAge(age)}${decor.changed(hit) ? ', changed since you read' : ''}`,
    );
  }
  row.toggleAttribute('aria-selected', selected);
  if (hit.heading !== undefined) {
    const heading = hit.entry.headings[hit.heading];
    if (heading !== undefined) row.dataset.marxyS = String(heading.byteOffset);
  } else {
    delete row.dataset.marxyS;
  }
  return row;
}

/** The empty phase: a quiet label before each section, then its rows. Labels are not options. */
function paintEmptyRows(
  list: HTMLOListElement,
  sections: readonly EmptySection[],
  selected: number,
  decor: RowDecor,
): void {
  const doc = ownerDocumentOf(list);
  const next =
    'createDocumentFragment' in doc
      ? (doc as Document).createDocumentFragment()
      : document.createDocumentFragment();
  let index = 0;
  let n = 0;
  for (const section of sections) {
    // One group per section, named by its label. The label is not an option: the arrow keys count
    // `.marxy-palette-row` only.
    const group = doc.createElement('li') as HTMLLIElement;
    group.className = 'marxy-palette-group';
    group.setAttribute('role', 'group');
    const label = doc.createElement('span') as HTMLSpanElement;
    label.className = 'marxy-palette-section';
    label.id = `marxy-palette-section-${n++}`;
    label.textContent = SECTION_LABELS[section.kind];
    group.setAttribute('aria-labelledby', label.id);
    const rows = doc.createElement('ol') as HTMLOListElement;
    rows.setAttribute('role', 'none');
    for (const hit of section.hits) rows.appendChild(documentRow(doc, hit, decor, index++ === selected));
    group.append(label, rows);
    next.appendChild(group);
  }
  list.replaceChildren(next);
}

/** A content hit's row: the document's title, `· line N`, and a dim preview with the match marked (textContent only). */
function paintContentRows(
  list: HTMLOListElement,
  hits: readonly ContentHit[],
  titleOf: (path: string) => string,
  selected: number,
): void {
  const doc = ownerDocumentOf(list);
  const next = doc.createDocumentFragment();
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const row = doc.createElement('li') as HTMLLIElement;
    row.className = 'marxy-palette-row marxy-palette-hit';
    row.dataset.rowKey = `${hit.path}:${hit.byteOffset}`;
    row.setAttribute('role', 'option');
    const head = doc.createElement('div') as HTMLDivElement;
    head.className = 'marxy-palette-hit-head';
    const title = doc.createElement('span') as HTMLSpanElement;
    title.className = 'marxy-palette-title';
    title.textContent = titleOf(hit.path);
    const line = doc.createElement('span') as HTMLSpanElement;
    line.className = 'marxy-palette-line';
    line.textContent = `· line ${hit.line}`;
    head.append(title, line);
    const preview = doc.createElement('div') as HTMLDivElement;
    preview.className = 'marxy-palette-preview';
    const start = Math.min(Math.max(0, hit.matchStart), hit.preview.length);
    const end = Math.min(Math.max(start, hit.matchEnd), hit.preview.length);
    const mark = doc.createElement('mark') as HTMLElement;
    mark.className = 'marxy-palette-match';
    mark.textContent = hit.preview.slice(start, end);
    preview.append(hit.preview.slice(0, start), mark, hit.preview.slice(end));
    row.append(head, preview);
    row.setAttribute('aria-label', `${titleOf(hit.path)}, line ${hit.line}: ${hit.preview}`);
    row.toggleAttribute('aria-selected', i === selected);
    next.appendChild(row);
  }
  list.replaceChildren(next);
}

function paintRows(
  list: HTMLOListElement,
  hits: readonly IndexHit[],
  selected: number,
  decor: RowDecor,
): void {
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
    next.appendChild(documentRow(doc, hit, decor, i === selected, keyed.get(key)));
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
  const now = deps.now ?? Date.now;
  const watched = (root: string) => deps.isWatched?.(root) === true;
  const baselineMs = (root: string) => deps.baselineMs?.(root);
  // The empty state is worked out when the palette is summoned or what it reads changes, never on a
  // keystroke: clearing the query reuses it. Ages are those of the moment of the summons.
  let emptyNow = now();
  let emptyCache: { entries: readonly IndexEntry[]; session: PaletteSession; sections: readonly EmptySection[] } | undefined;
  const emptySections = (): readonly EmptySection[] => {
    const entries = feed.entries();
    if (emptyCache !== undefined && emptyCache.entries === entries && emptyCache.session === session) {
      return emptyCache.sections;
    }
    const started = performance.now();
    const entriesByPath = new Map<string, IndexEntry>();
    for (const entry of entries) entriesByPath.set(entry.path, entry);
    const sections = emptyStateSections({ entriesByPath, session, nowMs: emptyNow, watched, baselineMs });
    emptyCache = { entries, session, sections };
    void deps.shell.mark('palette_empty', Date.now(), `ms=${(performance.now() - started).toFixed(2)}`);
    return sections;
  };
  // Copies of one document from worktrees of one repository fold to the open document's checkout.
  const foldCopies = (): FoldCopies | undefined => {
    const keyOf = deps.checkoutKey;
    if (keyOf === undefined) return undefined;
    const open = deps.getCurrentPath();
    return { keyOf, currentCheckout: (open === null ? undefined : keyOf(open)?.checkout) ?? session.currentRoot };
  };
  // C-17: the latest answer of the content search. Only the `/` phase reads it.
  let contentState: ContentState = { status: 'hint', notice: HINT_NOTICE, hits: [] };
  const titleCache: { entries?: readonly IndexEntry[]; byPath: Map<string, string> } = { byPath: new Map() };
  const titleOf = (path: string): string => {
    const entries = feed.entries();
    if (titleCache.entries !== entries) {
      titleCache.entries = entries;
      titleCache.byPath = new Map(entries.map((entry) => [entry.path, entry.title]));
    }
    return titleCache.byPath.get(path) ?? path.slice(path.lastIndexOf('/') + 1);
  };
  const search: ContentSearch | undefined =
    deps.searchContent === undefined
      ? undefined
      : createContentSearch(
          { searchContent: deps.searchContent, mark: (name, t, data) => deps.shell.mark(name, t, data) },
          () => {
            const entries = feed.entries();
            const roots = new Set<string>();
            for (const entry of entries) roots.add(entry.root);
            return { paths: entries.map((entry) => entry.path), roots: [...roots] };
          },
          (state) => {
            contentState = state;
            if (open && palettePhase(input.value, section) === 'content') repaint();
          },
          { debounceMs: deps.contentDebounceMs },
        );
  /** Starts, restarts or cancels the content search for what the input holds now. */
  const syncContent = () => {
    const phrase = contentQuery(input.value);
    if (phrase === null || section === 'operations') search?.update(null);
    else if (search === undefined) contentState = { status: 'failed', notice: 'Content search is not available here', hits: [] };
    else search.update(phrase);
  };
  const query = (text: string) =>
    queryPalette(text, section, feed.entries(), session, feed.prepared(), feed.rootRank(), foldCopies(), feed.notice(), emptySections, contentState);
  const decor: RowDecor = {
    // Empty: every row has its age. Typed: only a document in a watched root does.
    age: (hit) =>
      model.phase === 'empty' || watched(hit.entry.root)
        ? relativeAge(model.phase === 'empty' ? emptyNow : now(), hit.entry.mtimeMs)
        : undefined,
    changed: (hit) =>
      watched(hit.entry.root) && changedSinceRead(hit.entry, baselineMs(hit.entry.root), now()),
  };
  const rowCountOf = (m: PaletteModel): number =>
    m.phase === 'operations' ? m.operationCommands.length : m.phase === 'content' ? (m.contentHits?.length ?? 0) : m.hits.length;
  const paintModel = () => {
    if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
    else if (model.phase === 'content') paintContentRows(list, model.contentHits ?? [], titleOf, selected);
    else paintDocuments();
  };
  const paintDocuments = () => {
    if (model.phase === 'empty' && model.sections !== undefined) {
      paintEmptyRows(list, model.sections, selected, decor);
    } else {
      paintRows(list, model.hits, selected, decor);
    }
  };
  let section: PaletteListSection = 'documents';
  let model = query('');
  let open = false;
  let selected = 0;
  const syncSession = () => deps.onSessionChange?.(session);

  const repaint = (markPerf?: number) => {
    model = query(input.value);
    selected = Math.min(selected, Math.max(0, rowCountOf(model) - 1));
    paintModel();
    if (model.notice) {
      notice.textContent = model.notice;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
    if (markPerf !== undefined) recordKeystrokePaint(markPerf, deps.shell);
  };

  const summon = (withQuery?: string) => {
    open = true;
    chordCache = undefined;
    emptyNow = now();
    emptyCache = undefined;
    if (!deps.dialog.open) deps.dialog.showModal();
    deps.onSummon?.();
    if (typeof withQuery === 'string') selected = 0;
    input.value = typeof withQuery === 'string' ? withQuery : model.query;
    syncContent();
    repaint();
    input.focus();
    // A given query is kept and typed after (`>` then the action's name); a remembered one is replaced.
    if (typeof withQuery === 'string') input.setSelectionRange(withQuery.length, withQuery.length);
    else input.select();
  };

  const dismiss = () => {
    open = false;
    search?.cancel();
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
    // Section labels sit between rows in the empty phase: count rows only.
    const index = Array.prototype.indexOf.call(list.querySelectorAll('.marxy-palette-row'), row);
    if (index < 0) return;
    if (model.phase === 'operations') {
      runPaletteCommand(model.operationCommands[index]);
    } else if (model.phase === 'content') {
      void activateContentHit(model.contentHits?.[index]);
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

  const rootOf = (path: string): string => {
    for (const entry of feed.entries()) if (entry.path === path) return entry.root;
    return session.currentRoot;
  };
  /** Open the file at the match and select the block that holds it (C-17). */
  const activateContentHit = async (hit: ContentHit | undefined) => {
    if (hit === undefined) return;
    session = recordOpen(session, hit.path, rootOf(hit.path));
    syncSession();
    dismiss();
    setTimeout(() => feed.refresh(), 0);
    await renderPath(deps, hit.path, hit.byteOffset);
    deps.selectBlockAtByte?.(hit.byteOffset);
  };

  input.addEventListener('input', () => {
    selected = 0;
    const started = performance.now();
    syncContent();
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
      if (model.phase === 'content') return;
      section = toggleListSection(section, model.phase);
      selected = 0;
      repaint();
      return;
    }
    const rowCount = rowCountOf(model);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.max(0, Math.min(rowCount - 1, selected + 1));
      paintModel();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      paintModel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (model.phase === 'operations') {
        runPaletteCommand(model.operationCommands[selected]);
      } else if (model.phase === 'content') {
        void activateContentHit(model.contentHits?.[selected]);
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
    if (isMod(event) && event.key === '.' && open && model.phase === 'content') {
      const found = model.contentHits?.[selected];
      if (found !== undefined) {
        event.preventDefault();
        session = togglePin(session, found.path);
        syncSession();
        repaint();
      }
      return;
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
    noteRead(path, how) {
      session = markRead(session, path, how, now());
      syncSession();
      // Off this tick, as in activateHit: the prepared index follows, the open never waits on it.
      setTimeout(() => feed.refresh(), 0);
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
    selectBlockAtByte: (byte) => handle.selection.selectBlockAtByte(byte),
    // The real shells have it (C-16); `AppShell` is the narrower type the app is built against.
    searchContent: (handle.shell as AppShell & Partial<Pick<Shell, 'searchContent'>>).searchContent?.bind(handle.shell),
    // Looked up on each call: the service's answers move as roots are walked and watched.
    isWatched: (root) => handle.index.isWatched(root),
    baselineMs: (root) => handle.index.baselineMs(root),
    checkoutKey: (path) => handle.index.checkoutKey(path),
    onSummon: () => handle.index.revalidate(),
  });
  setPaletteCloser(() => controller.close());
  setPaletteOpener((query) => controller.open(query));
  // Any open the app records (command line, menu, a link), not only the palette's own (C-12).
  setOpenListener((path) => controller.noteRead(path, 'open'));
  // A save from Marxy is a read too: follow whichever store is open and note each of its saves.
  let followed: DocumentStore | null = null;
  let unfollow: (() => void) | undefined;
  const followStore = () => {
    const store = handle.document();
    if (store === followed) return;
    unfollow?.();
    followed = store;
    unfollow = store?.subscribe((_snap, change) => {
      if (change.kind === 'save') controller.noteRead(change.path, 'save');
    });
  };
  followStore();
  handle.onDocumentChange(followStore);
  setAppHandle(handle);
  setPalette(controller);
  return controller;
}
