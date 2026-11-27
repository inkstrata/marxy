// Summoned palette in the real document: input, list, keys, and tab-bar checks.
// It is the Line: one field whose first character picks the scope (`line/scopes.ts`); Go, `>` and `#` keep the
// palette's own machinery (the index feed, the fuzzy search, command rows, pins, the Rust content search), the other
// scopes give rows of their own (`line/scopes-rows.ts`), and Tab keeps a result in the left panel that owns it.

import { closeVerbMenu } from '../selection/verb-menu.ts';
import { isSecretName } from '@marxy/core/src/kind/registry.ts';
import { detectKind, fileTypeFor, type IndexEntry, type IndexHit } from '@marxy/core';
import { invisibleHexLabel, invisibleSegments } from '@marxy/core/src/render/index.ts';
import type { ContentHit, Shell } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppHandle, AppShell } from '../app.ts';
import { setAppHandle, setPalette } from '../commands/app-handle.ts';
import { commands, type Command } from '../commands/index.ts';
import { withPaletteListing } from '../commands/navigation.ts';
import { transformPreviewInput } from '../commands/transform.ts';
import type { DocumentStore } from '../document/store.ts';
import { appendInvisibleSegments } from '../render/invisibles-dom.ts';
import {
  commandPreview,
  createPreviewFollower,
  drawPreview,
  filePreview,
  previewReadBytes,
  sizeLabel,
  sectionPreview,
  transformPreview,
  type PreviewData,
} from '../render/palette-preview.ts';
import { focusOrigin } from '../pane/focus.ts';
import { splitRefusal } from '../pane/fit.ts';
import { buildAppContext, setPaletteCloser, setPaletteOpener } from '../selection/bind.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
import { viewerGlyphOf } from '../kind-icons/viewer-glyphs.ts';
import { answersKinds, kindKey, kindQuery, kindText } from './kind-words.ts';
import { copyDefault } from '../selection/verbs.ts';
import {
  contentQuery,
  createContentSearch,
  CONTENT_ROW_LIMIT,
  HINT_NOTICE,
  splitSegments,
  type ContentSearch,
  type ContentState,
} from './content.ts';
import { paletteChordFor } from './chords.ts';
import type { PaletteKey } from './keys.ts';
import { drillText, keyLabel, paletteCommands, paletteGroupOf, type PaletteGroup } from './commands.ts';
import { toolbarIconElement, type ToolbarGlyph } from './glyphs.ts';
import {
  emptyStateSections,
  relativeAge,
  spokenAge,
  type EmptySection,
  type EmptySectionKind,
  EMPTY_STATE_LIMIT,
  suggestedCommands,
} from './empty-state.ts';
import { setOpenListener } from './history.ts';
import { createIndexFeed, type IndexFeed } from './index-feed.ts';
import type { CheckoutKey } from './fold.ts';
import { acceptedHits, fuzzyScore, jumpForHit, paletteResults, sectionQuery, SECTION_LIMIT, type FoldCopies, type PreparedIndex, type RootRank, type SectionScope } from './search.ts';
import { appHandle } from '../commands/app-handle.ts';
import { orTypeRows, referenceRows, tabRows } from '../line/go-rows.ts';
import { drawLinePreview, isLinePreview, type LinePreview, type LineRow } from '../line/rows.ts';
import { scopeRows, type ScopeEnv } from '../line/scopes-rows.ts';
import { footHints, KEEP_IN, PANEL_NAMES, PLACEHOLDER, scopeOf, type ScopeId } from '../line/scopes.ts';
import {
  adoptHistory,
  emptySession,
  goBack,
  goForward,
  markRead,
  recentExcluding,
  recordOpen,
  setHydrationListener,
  takePaletteHydration,
  togglePin,
  type PaletteSession,
} from './session.ts';
import { isMac } from '../platform.ts';

export type PaletteListSection = 'documents' | 'headings' | 'operations';
/** `scope`: one of the Line's scopes past Go, `>` and `#`, whose rows are `LineRow`s. */
export type PalettePhase = 'empty' | 'typing' | 'operations' | 'content' | 'scope';

export const PALETTE_ROW_LIMIT = 12;

/** One row of a Go or scope list: a scope's own row, a document or heading hit, or a command. */
export type PaletteItem =
  | { readonly type: 'line'; readonly row: LineRow }
  | { readonly type: 'hit'; readonly hit: IndexHit }
  | { readonly type: 'cmd'; readonly cmd: Command };

/** A named run of items, painted under its label. */
export interface PaletteBlock {
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

export interface PaletteModel {
  readonly phase: PalettePhase;
  readonly section: PaletteListSection;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly operationCommands: readonly Command[];
  readonly selected: number;
  readonly notice?: string;
  /** An `@` or `#` query: `hits` are headings, and the rows lead with the heading and name the document. */
  readonly sectionScope?: SectionScope;
  /** The content phase only: the matches painted, in the order the shell returned them. */
  readonly contentHits?: readonly ContentHit[];
  /** The empty phase only: `hits` is these sections' rows in order, so a row index never counts a label. */
  readonly sections?: readonly EmptySection[];
  /** The empty phase only: commands listed after the sections as Suggested; selection runs on past `hits`. */
  readonly suggested?: readonly Command[];
  /** Go and the Line's scopes: the rows in order, under their labels; the selection counts `items`. */
  readonly blocks?: readonly PaletteBlock[];
  readonly items?: readonly PaletteItem[];
  readonly scope?: ScopeId;
  /** The field's count ("12 matches"). */
  readonly count?: string;
  /** A scope's own act on Enter with no row (find opens in-page find on the query). */
  readonly enter?: (how: { beside: boolean; alt: boolean }) => void;
}

export interface PaletteDeps {
  readonly shell: AppShell;
  /** The index feed, when the caller made it before the palette loaded (main.ts); else the palette makes its own. */
  readonly feed?: IndexFeed;
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
  readonly openDocument: (path: string, at?: number, onLanded?: () => void) => Promise<void>;
  /**
   * Selects the innermost block of the open document that holds `byte` (the rendered selection).
   * Called only from `openDocument`'s `onLanded`, so the document is the hit's and is mounted through `byte`.
   */
  readonly selectBlockAtByte?: (byte: number) => void;
  /** Content search for `/` queries. Without it the `/` phase says so and finds nothing. */
  readonly searchContent?: Shell['searchContent'];
  /** Milliseconds a content query waits for the next keystroke; 120 unless a test says otherwise. */
  readonly contentDebounceMs?: number;
  /** Which repository and checkout hold a path (the index service's `checkoutKey`): copies from worktrees fold. */
  readonly checkoutKey?: (path: string) => CheckoutKey | undefined;
  /** The clock, for the ages. */
  readonly now?: () => number;
  /** Called each time the palette is summoned: the index re-walks folders it could not watch. */
  readonly onSummon?: () => void;
  /**
   * Open beside. Opens `path` in the other pane, making it when there is one pane, and moves focus
   * there. Without it a document opens here (`openDocument`).
   */
  readonly openBeside?: (path: string, at?: number, onLanded?: () => void) => Promise<void>;
  /** The documents the panes show now; "open beside" does not offer them again. */
  readonly visiblePaths?: () => readonly string[];
  /** Why a second pane cannot be made now (the window is too narrow), or null. */
  readonly splitRefusal?: () => string | null;
  /** The pane focused as the palette opens, to give focus back to on dismissal; null with one pane. */
  readonly focusOrigin?: () => { restore(): void } | null;
  /** What a transform's preview runs on: the selection, else the document's first characters (read only); null when there is none. */
  readonly transformInput?: () => Promise<{ readonly text: string; readonly scope: 'selection' | 'document' } | null>;
}

/** Where a chosen document opens: in the focused pane (`'here'`) or the other one (`'split'`). */
export type PaletteTarget = 'here' | 'split';

export interface PaletteController {
  readonly session: PaletteSession;
  /**
   * Summons the palette; with `query` (such as `'>'`), opens it on that query (for the menu).
   * With `target: 'split'` it is "open beside": the empty list is the recent documents not on screen, and
   * Enter opens the chosen one in the other pane.
   */
  open(query?: string, opts?: { target?: PaletteTarget }): void;
  close(): void;
  /** Takes the chords off the window; the palette is not summoned again. */
  destroy(): void;
  setIndexEntries(entries: readonly IndexEntry[]): void;
  /** What the palette searches: the index in scope order. The collection sets its folders here. */
  readonly feed: IndexFeed;
  /**
   * `path` was read (an open by any route) or saved from Marxy: it moves to the front of Recent. A save leaves the
   * MRU order alone.
   */
  noteRead(path: string, how: 'open' | 'save'): void;
  /** Pins `path`, or unpins it (Places' `m`); kept in history.json as a pin made here is. */
  togglePin(path: string): void;
  /** One step back through the session history; false when there is none (the key is then left alone). */
  back(): boolean;
  /** One step forward through the session history; false when there is none. */
  forward(): boolean;
}

function isMod(event: KeyboardEvent | PaletteKey): boolean {
  const mac = isMac();
  return mac ? event.metaKey : event.ctrlKey;
}

/** The scope `query` is in: its first character, past any leading spaces (`>` and `#` keep the palette's own phases). */
function lineScope(query: string): ScopeId {
  return scopeOf(query.trimStart()).scope.id;
}

function palettePhase(query: string, section: PaletteListSection): PalettePhase {
  if (section === 'operations') return 'operations';
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'empty';
  const scope = lineScope(query);
  if (scope === 'cmd') return 'operations';
  if (scope === 'grep') return 'content';
  if (scope !== 'go') return 'scope';
  return 'typing';
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
  suggestedFn: () => readonly Command[],
  currentPath: string | null,
): PaletteModel {
  const phase = palettePhase(query, section);
  if (phase === 'scope') return { phase, section: 'documents', query, hits: [], operationCommands: [], selected: 0 };
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
      notice: operationCommands.length === 0 ? 'No command by that name · Backspace past > finds files' : undefined,
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
      suggested: suggestedFn(),
    };
  }
  const trimmed = query.trim();
  let folded = 0;
  // `@` and `#` list headings: the section toggle and the row limit of a file list do not apply.
  const sections = sectionQuery(trimmed);
  const options = {
    prepared,
    limit: sections === null ? 50 : SECTION_LIMIT,
    rootRank,
    fold: fold && { ...fold, folded: (copies: number) => (folded = copies) },
    currentPath,
  };
  // A word that names a kind narrows the files ("ragged pdf"); no file of it falls back to the words as typed.
  const kinds = sections === null ? kindQuery(query) : null;
  let hits: readonly IndexHit[] = [];
  if (kinds !== null) {
    const accept = (entry: IndexEntry): boolean => answersKinds(entry, kinds);
    hits = paletteResults(kinds.rest === '' ? kindText(kinds) : kinds.rest, entries, session, { ...options, accept });
    // Only kind words: the files the words match as names lead, then the rest of the kind.
    if (kinds.rest === '' && hits.length < options.limit) {
      const seen = new Set(hits.map((h) => h.entry.path));
      const more = acceptedHits(prepared, session, options.limit, rootRank, fold && { ...fold, folded: (copies: number) => (folded = Math.max(folded, copies)) }, accept, kindKey(kinds), new Set(trimmed.toLowerCase().split(/[\s/]+/)));
      hits = [...hits, ...more.filter((h) => !seen.has(h.entry.path))].slice(0, options.limit);
    }
  }
  if (kinds === null || hits.length === 0) hits = paletteResults(trimmed, entries, session, options);
  if (sections !== null) {
    const none = sections.scope === 'here' && currentPath === null ? 'No document is open' : hits.length === 0 ? 'No headings match' : undefined;
    return {
      phase,
      section: 'headings',
      query,
      hits,
      operationCommands: [],
      selected: 0,
      notice: none ?? foldedNotice(folded, scopeNotice),
      sectionScope: sections.scope,
    };
  }
  const filtered = filterHits(hits, section);
  // An empty list says so, and where else to look.
  const none = filtered.length === 0 ? 'Nothing by that name · # searches the text, > the commands, ? lists the rest' : undefined;
  return {
    phase,
    section,
    query,
    hits: filtered.slice(0, PALETTE_ROW_LIMIT),
    operationCommands: [],
    selected: 0,
    notice: none ?? foldedNotice(folded, scopeNotice),
  };
}

async function renderPath(deps: PaletteDeps, path: string, byteOffset?: number, onLanded?: () => void): Promise<void> {
  await deps.openDocument(path, byteOffset, onLanded);
  deps.setCurrentPath(path);
}

function injectPaletteStyles(doc: Document): void {
  if (doc.getElementById('marxy-palette-style')) return;
  // Lengths are ratios of the chrome size (13 px), as in base.css: the reader's chrome_size scales them.
  adoptRuntimeSheet(doc, 'marxy-palette-style', `
    /* The Line: one field over the page, under the tab row. */
    #marxy-palette {
      margin: calc(var(--marxy-frame-tabs, 0px) + var(--marxy-size-chrome) * 18 / 13) auto 0;
      padding: 0;
      border-color: var(--marxy-color-rule-strong);
      width: min(820px, calc(100vw - 40px));
      overflow: hidden;
      font-size: var(--marxy-size-chrome);
      line-height: 1.4;
    }
    #marxy-palette[open] {
      display: flex;
      flex-direction: column;
      max-height: min(76vh, calc(100vh - var(--marxy-frame-tabs, 0px) - 2rem));
    }
    #marxy-palette::backdrop { background: rgb(0 0 0 / 25%); }
    /* The container the preview column asks about: a narrow palette has no column. */
    #marxy-palette { container: marxy-palette / inline-size; }
    #marxy-palette .marxy-palette-field {
      display: flex;
      align-items: center;
      gap: calc(var(--marxy-size-chrome) * 10 / 13);
      padding: 0 calc(var(--marxy-size-chrome) * 14 / 13);
      flex: none;
      min-height: calc(var(--marxy-size-chrome) * 48 / 13);
      border-bottom: 1px solid var(--marxy-color-edge);
    }
    /* The scope the first character picked, in the accent's small capitals; Go with none. */
    #marxy-palette .marxy-palette-scope {
      flex: none;
      font-size: calc(var(--marxy-size-chrome) * 10.5 / 13);
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--marxy-color-accent);
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-count { flex: none; color: var(--marxy-color-text-secondary); font-size: calc(var(--marxy-size-chrome) * 12 / 13); white-space: nowrap; font-variant-numeric: tabular-nums; }
    #marxy-palette .marxy-palette-query {
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
      border: 0;
      padding: calc(var(--marxy-size-chrome) * 10 / 13) calc(var(--marxy-size-chrome) * 4 / 13);
      font: inherit;
      font-size: calc(var(--marxy-size-chrome) * 16 / 13);
      background: transparent;
      color: var(--marxy-color-text-strong, inherit);
    }
    #marxy-palette .marxy-palette-query::placeholder { color: var(--marxy-color-text-secondary); }
    /* One focus frame: the ring is the field's own, drawn inside its border; the query inside draws none. */
    #marxy-palette .marxy-palette-query:focus,
    #marxy-palette .marxy-palette-query:focus-visible { outline: none; }
    #marxy-palette .marxy-palette-field:focus-within { outline: 2px solid var(--marxy-color-accent); outline-offset: -2px; }
    #marxy-palette .marxy-palette-esc,
    #marxy-palette .marxy-palette-keycap {
      flex: none;
      padding: 0 calc(var(--marxy-size-chrome) * 6 / 13);
      border: 1px solid var(--marxy-color-rule-strong);
      border-radius: calc(var(--marxy-size-chrome) * 4 / 13);
      background: transparent;
      color: var(--marxy-color-text-secondary);
      font: inherit;
      font-size: 0.85em;
      line-height: 1.5;
      white-space: nowrap;
    }
    /* The mock's keycap (.kbd): 18 px tall, 11 px type, a heavier bottom edge. */
    #marxy-palette .marxy-palette-keycap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-width: calc(var(--marxy-size-chrome) * 18 / 13);
      height: calc(var(--marxy-size-chrome) * 18 / 13);
      padding: 0 calc(var(--marxy-size-chrome) * 4 / 13);
      font-size: calc(var(--marxy-size-chrome) * 11 / 13);
      line-height: 1;
      border-bottom-width: 2px;
    }
    #marxy-palette .marxy-palette-esc:focus-visible { outline: 2px solid var(--marxy-color-accent); outline-offset: -2px; }
    /* The preview is a second column when the palette is wide enough: a 460 / 399 split. It is part of
       the sheet, which overlays the page: nothing under the reader moves. */
    /* The body is the one row that gives: it takes what the field, chips and footer leave, never less than three result
       rows, and its results and preview scroll inside it, so nothing in it is drawn over the footer. */
    #marxy-palette .marxy-palette-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    /* The shortest supported window is 400 px tall: from there the body keeps three rows, and the panel gives up its
       top margin to do it. Shorter than that the body shrinks and scrolls, and the footer stays. */
    @media (min-height: 400px) {
      #marxy-palette .marxy-palette-body { min-height: calc(var(--marxy-size-chrome) * 150 / 13); }
    }
    @media (max-height: 560px) {
      #marxy-palette { margin-top: 0.5rem; }
      #marxy-palette[open] { max-height: calc(100vh - 1rem); }
    }
    #marxy-palette .marxy-palette-aside { display: none; }
    @container marxy-palette (min-width: 720px) {
      #marxy-palette .marxy-palette-body { grid-template-columns: minmax(0, 460fr) minmax(0, 399fr); }
      #marxy-palette .marxy-palette-aside {
        display: block;
        min-height: 0;
        overflow: auto;
        box-sizing: border-box;
        padding: calc(var(--marxy-size-chrome) * 14 / 13) calc(var(--marxy-size-chrome) * 16 / 13);
        border-inline-start: 1px solid var(--marxy-color-rule);
        background: var(--marxy-color-bg);
        font-size: calc(var(--marxy-size-chrome) * 12.5 / 13);
        color: var(--marxy-color-text);
      }
    }
    #marxy-palette .marxy-palette-aside[data-marxy-pending] > * { opacity: 0.55; }
    #marxy-palette .marxy-palette-prev-chips { display: flex; flex-wrap: wrap; gap: calc(var(--marxy-size-chrome) * 5 / 13); margin: 0 0 calc(var(--marxy-size-chrome) * 12 / 13); }
    #marxy-palette .marxy-palette-prev-chip {
      padding: 0 calc(var(--marxy-size-chrome) * 8 / 13);
      border: 1px solid var(--marxy-color-rule-strong);
      border-radius: calc(var(--marxy-size-chrome) * 12 / 13);
      color: var(--marxy-color-text-secondary);
      font-size: 0.92em;
      line-height: 1.7;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    #marxy-palette .marxy-palette-prev-chip-lead { color: var(--marxy-color-text); font-weight: 600; }
    #marxy-palette .marxy-palette-prev-title { margin: 0; padding: 0; font-family: var(--marxy-face-chrome); font-variation-settings: normal; letter-spacing: normal; font-size: 1.1em; font-weight: 650; line-height: 1.3; }
    #marxy-palette .marxy-palette-prev-group { margin: calc(var(--marxy-size-chrome) * 2 / 13) 0 calc(var(--marxy-size-chrome) * 10 / 13); color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-prev-note { margin: 0 0 calc(var(--marxy-size-chrome) * 8 / 13); color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-prev-more { margin: 0; color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-prev-image { color: var(--marxy-color-text-secondary); font-style: italic; }
    #marxy-palette .marxy-palette-prev-result { margin: 0 0 calc(var(--marxy-size-chrome) * 8 / 13); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.92em; line-height: 1.5; }
    /* A section or a file's own text (the reading face is set on the element by palette-preview.ts: the chrome's rules carry no face but the chrome's), set small and off the baseline grid: the reading face for prose, the page's own code rules for code. Links
       and images are inert here (palette-preview.ts). The article's custom properties are given what they stand for. */
    #marxy-palette .marxy-palette-prev-text {
      --lb: var(--marxy-line-box);
      --marxy-half: calc(var(--lb) / 2);
      --marxy-room: 0px;
      pointer-events: none;
      user-select: none;
      overflow-wrap: anywhere;
    }
    #marxy-palette .marxy-palette-prev-prose { line-height: 1.5; font-weight: var(--marxy-weight-body, 400); }
    #marxy-palette .marxy-palette-prev-prose :is(h1, h2, h3, h4, h5, h6) { margin: 1em 0 0.35em; padding: 0; letter-spacing: normal; line-height: 1.25; text-wrap: balance; }
    #marxy-palette .marxy-palette-prev-prose > :first-child { margin-top: 0; }
    #marxy-palette .marxy-palette-prev-prose h1 { font-size: 1.65em; }
    #marxy-palette .marxy-palette-prev-prose h2 { font-size: 1.3em; }
    #marxy-palette .marxy-palette-prev-prose h3 { font-size: 1.12em; }
    #marxy-palette .marxy-palette-prev-prose :is(h4, h5, h6) { font-size: 1em; }
    #marxy-palette .marxy-palette-prev-prose :is(p, ul, ol, dl, blockquote, table, figure) { margin: 0 0 0.7em; }
    #marxy-palette .marxy-palette-prev-prose :is(ul, ol) { padding-inline-start: 1.3em; }
    #marxy-palette .marxy-palette-prev-prose blockquote { padding-inline-start: 0.8em; border-inline-start: 2px solid var(--marxy-color-rule-strong); color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-prev-prose :not(pre) > code { padding: 0 0.3em; border-radius: calc(var(--marxy-size-chrome) * 4 / 13); background: var(--marxy-color-code-bg); font-size: 0.88em; }
    #marxy-palette .marxy-palette-prev-text pre { width: auto; min-width: 0; max-width: 100%; margin: 0 0 0.7em; padding: calc(var(--marxy-size-chrome) * 8 / 13) calc(var(--marxy-size-chrome) * 10 / 13); font-size: calc(var(--marxy-size-chrome) * 11.5 / 13); line-height: 1.5; text-indent: 0; }
    #marxy-palette .marxy-palette-prev-code pre { margin: 0; }
    #marxy-palette .marxy-palette-prev-text table { border-collapse: collapse; font-size: 0.95em; }
    #marxy-palette .marxy-palette-prev-text :is(td, th) { padding: 0 0.6em 0 0; text-align: start; }
    #marxy-palette .marxy-palette-prev-text .marxy-line { text-indent: 0; background: none; }
    #marxy-palette .marxy-palette-results {
      list-style: none;
      margin: 0;
      padding: calc(var(--marxy-size-chrome) * 6 / 13);
      min-height: 0;
      overflow: auto;
    }
    /* One line a row (the Line): the title, then what it is in quiet type, then its key. */
    #marxy-palette .marxy-palette-row {
      min-height: round(calc(var(--marxy-size-chrome) * 30 / 13), 1px);
      border-radius: calc(var(--marxy-size-chrome) * 7 / 13);
    }
    #marxy-palette .marxy-palette-text { display: flex; align-items: baseline; gap: calc(var(--marxy-size-chrome) * 10 / 13); flex: 1; min-width: 0; }
    #marxy-palette .marxy-palette-title,
    #marxy-palette .marxy-palette-sub,
    #marxy-palette .marxy-palette-ex {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-title { flex: 0 1 auto; color: var(--marxy-color-text-strong, inherit); }
    #marxy-palette .marxy-palette-title b { color: var(--marxy-color-accent); font-weight: 600; }
    #marxy-palette .marxy-palette-sub { flex: 1 1 0; color: var(--marxy-color-text-secondary); font-size: calc(var(--marxy-size-chrome) * 12 / 13); }
    #marxy-palette .marxy-palette-ex { flex: 1 1 0; font-family: var(--marxy-face-mono); font-size: calc(var(--marxy-size-chrome) * 12 / 13); color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-ex mark { background: transparent; color: var(--marxy-color-text-strong, inherit); font-weight: 600; }
    #marxy-palette .marxy-palette-row.marxy-palette-hit .marxy-palette-sub { flex: none; font-variant-numeric: tabular-nums; }
    #marxy-palette .marxy-palette-row[aria-selected="true"] { box-shadow: inset 2px 0 0 var(--marxy-color-accent); }
    #marxy-palette .marxy-line-prev-head { margin: 0 0 calc(var(--marxy-size-chrome) * 8 / 13); font-size: calc(var(--marxy-size-chrome) * 10.5 / 13); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--marxy-color-text-secondary); overflow-wrap: anywhere; }
    #marxy-palette .marxy-line-prev { font-family: var(--marxy-face-mono); font-size: calc(var(--marxy-size-chrome) * 12 / 13); line-height: 1.6; color: var(--marxy-color-text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 calc(var(--marxy-size-chrome) * 8 / 13); }
    #marxy-palette .marxy-line-prev-row[data-marxy-at] { background: var(--marxy-color-find); color: var(--marxy-color-text-strong, inherit); }
    #marxy-palette .marxy-line-prev-row[data-marxy-sign="+"] { background: var(--marxy-color-diff-add); color: var(--marxy-color-text-strong, inherit); }
    #marxy-palette .marxy-line-prev-row[data-marxy-sign="-"] { background: var(--marxy-color-diff-del); color: var(--marxy-color-text-strong, inherit); }
    #marxy-palette .marxy-line-prev-no { display: inline-block; min-width: 3.2em; margin-inline-end: 1em; text-align: end; color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-palette-row[data-marxy-unavailable] .marxy-palette-title { color: var(--marxy-color-text-faint); }
    #marxy-palette .marxy-palette-why { color: var(--marxy-color-text-faint); font-size: 0.85em; white-space: normal; }
    #marxy-palette .marxy-kind-glyph {
      display: inline-flex;
      flex: none;
      align-self: center;
      color: var(--marxy-lang, var(--marxy-color-text-secondary));
      inline-size: calc(var(--marxy-size-chrome) * 16 / 13);
      block-size: calc(var(--marxy-size-chrome) * 16 / 13);
    }
    #marxy-palette .marxy-palette-glyph { display: inline-flex; flex: none; align-self: center; color: var(--marxy-color-text-secondary); }
    #marxy-palette .marxy-kind-glyph svg { display: block; inline-size: 100%; block-size: 100%; }
    #marxy-palette .marxy-palette-key {
      padding: 0 calc(var(--marxy-size-chrome) * 6 / 13);
      border: 1px solid var(--marxy-color-rule-strong);
      border-radius: calc(var(--marxy-size-chrome) * 4 / 13);
      font-size: 0.85em;
    }
    #marxy-palette .marxy-palette-group { list-style: none; }
    #marxy-palette .marxy-palette-group > ol { list-style: none; margin: 0; padding: 0; }
    #marxy-palette .marxy-palette-section {
      display: block;
      padding: calc(var(--marxy-size-chrome) * 9 / 13) calc(var(--marxy-size-chrome) * 10 / 13) calc(var(--marxy-size-chrome) * 4 / 13);
      font-size: calc(var(--marxy-size-chrome) * 10.5 / 13);
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--marxy-color-text-secondary);
      cursor: default;
      user-select: none;
    }
    #marxy-palette .marxy-palette-age {
      flex: none;
      margin-inline-start: auto;
      color: var(--marxy-color-text-secondary);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }
    #marxy-palette .marxy-palette-changed {
      flex: none;
      align-self: center;
      width: 0.4em;
      height: 0.4em;
      border-radius: 50%;
      background: var(--marxy-color-accent);
    }
    #marxy-palette .marxy-palette-row[aria-selected="true"] {
      background: var(--marxy-color-accent-wash);
    }
    #marxy-palette .marxy-palette-hit-head { display: flex; gap: 0.6em; align-items: baseline; }
    #marxy-palette .marxy-palette-line {
      flex: none;
      color: var(--marxy-color-text-secondary);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }
    #marxy-palette .marxy-palette-preview {
      color: var(--marxy-color-text-secondary);
      font-size: 0.85em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-match {
      background: transparent;
      color: var(--marxy-color-text);
      font-weight: 600;
      text-decoration: underline;
    }
    #marxy-palette .marxy-palette-notice {
      flex: none;
      margin: 0;
      padding: 0.5rem 1rem;
      font-size: 0.9em;
      opacity: 0.8;
      border-top: 1px solid var(--marxy-color-rule-strong);
    }
    #marxy-palette .marxy-palette-foot {
      flex: none;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: calc(var(--marxy-size-chrome) * 4 / 13) calc(var(--marxy-size-chrome) * 14 / 13);
      padding: calc(var(--marxy-size-chrome) * 7 / 13) calc(var(--marxy-size-chrome) * 14 / 13);
      border-top: 1px solid var(--marxy-color-rule);
      color: var(--marxy-color-text-secondary);
      font-size: calc(var(--marxy-size-chrome) * 11.5 / 13);
    }
    #marxy-palette .marxy-palette-foot > span { display: inline-flex; align-items: center; gap: calc(var(--marxy-size-chrome) * 5 / 13); }
    #marxy-palette .marxy-palette-foot-end { margin-inline-start: auto; }
  `);
}

type PaletteOwnerDocument = Pick<Document, 'createElement' | 'getElementById' | 'head'>;

/** The keys of the foot: the scope's own (`line/scopes.ts`), then Tab where a panel keeps the scope, then Esc. */
function fillFooter(foot: HTMLElement, doc: PaletteOwnerDocument, mac: boolean, scope: ScopeId): void {
  foot.className = 'marxy-palette-foot';
  const hint = (keys: readonly string[], what: string, end = false): HTMLElement => {
    const one = doc.createElement('span') as HTMLElement;
    if (end) one.className = 'marxy-palette-foot-end';
    for (const key of keys) {
      const cap = doc.createElement('kbd') as HTMLElement;
      cap.className = 'marxy-palette-keycap';
      cap.textContent = key;
      one.appendChild(cap);
    }
    one.append(` ${what}`);
    return one;
  };
  const chord = (spec: string) => keyLabel(spec, mac);
  const items = [hint(['↑', '↓'], 'move'), ...footHints(scope).map(([spec, what]) => hint([chord(spec)], what))];
  const panel = KEEP_IN[scope];
  if (panel !== undefined) items.push(hint([chord('Tab')], `keep it in ${PANEL_NAMES[panel]}`));
  items.push(hint([chord('Escape') === '⎋' ? 'esc' : 'Esc'], 'close', true));
  foot.replaceChildren(...items);
}

function ensurePaletteStructure(
  dialog: HTMLElement,
  owner: PaletteOwnerDocument,
): {
  input: HTMLInputElement;
  list: HTMLOListElement;
  notice: HTMLParagraphElement;
  esc: HTMLButtonElement;
  aside: HTMLElement;
  scopeEl: HTMLElement;
  countEl: HTMLElement;
} {
  const found = () => ({
    aside: dialog.querySelector('.marxy-palette-aside') as HTMLElement,
    input: dialog.querySelector('.marxy-palette-query') as HTMLInputElement,
    list: dialog.querySelector('.marxy-palette-results') as HTMLOListElement,
    notice: dialog.querySelector('.marxy-palette-notice') as HTMLParagraphElement,
    esc: dialog.querySelector('.marxy-palette-esc') as HTMLButtonElement,
    scopeEl: dialog.querySelector('.marxy-palette-scope') as HTMLElement,
    countEl: dialog.querySelector('.marxy-palette-count') as HTMLElement,
  });
  if (dialog.querySelector('.marxy-palette-query')) return found();
  dialog.classList.add('marxy-surface', 'marxy-surface-md');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'The Line');
  dialog.dataset.marxyScope = 'go';
  const mac = isMac();
  const field = owner.createElement('div') as HTMLDivElement;
  field.className = 'marxy-palette-field';
  // The scope the first character picked: the field's own label, so a screen reader hears it with the query.
  const scopeEl = owner.createElement('span') as HTMLSpanElement;
  scopeEl.className = 'marxy-palette-scope';
  scopeEl.id = 'marxy-palette-scope';
  scopeEl.textContent = 'Go';
  const input = owner.createElement('input') as HTMLInputElement;
  input.className = 'marxy-palette-query';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Go anywhere, or type a first character to pick a scope');
  input.setAttribute('aria-describedby', 'marxy-palette-scope');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'marxy-palette-listbox');
  input.placeholder = PLACEHOLDER;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const countEl = owner.createElement('span') as HTMLSpanElement;
  countEl.className = 'marxy-palette-count';
  countEl.setAttribute('aria-live', 'polite');
  // A real button: the pointer's way to Esc. Out of the tab order: Tab in the field keeps a result in its panel, and Esc
  // is the keyboard's own way to close.
  const esc = owner.createElement('button') as HTMLButtonElement;
  esc.type = 'button';
  esc.className = 'marxy-palette-esc';
  esc.setAttribute('aria-label', 'Close the Line');
  esc.tabIndex = -1;
  esc.textContent = 'esc';
  field.append(scopeEl, input, countEl, esc);
  const body = owner.createElement('div') as HTMLDivElement;
  body.className = 'marxy-palette-body';
  const list = owner.createElement('ol') as HTMLOListElement;
  list.className = 'marxy-palette-results';
  list.id = 'marxy-palette-listbox';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  // The preview of the highlighted row: drawn beside the list when the palette is wide enough, empty otherwise.
  const aside = owner.createElement('aside') as HTMLElement;
  aside.className = 'marxy-palette-aside';
  aside.setAttribute('aria-label', 'Preview');
  aside.setAttribute('aria-live', 'polite');
  body.append(list, aside);
  const notice = owner.createElement('p') as HTMLParagraphElement;
  notice.className = 'marxy-palette-notice';
  notice.hidden = true;
  const foot = owner.createElement('div') as HTMLElement;
  fillFooter(foot, owner, mac, 'go');
  dialog.replaceChildren(field, body, notice, foot);
  return found();
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
 * The chords name the selection's own default verbs, from the written tables. The selection
 * cannot change while the palette is up, so they are read once per summon, not on every keystroke.
 */
let chordCache: { readonly copyId?: string } | undefined;
function selectionChords(): { readonly copyId?: string } {
  if (chordCache === undefined) {
    const ctx = buildAppContext();
    const registered = commands();
    chordCache = { copyId: copyDefault(ctx, registered)?.id };
  }
  return chordCache;
}

/** The glyph each command group leads its rows with: the toolbar set, and the document icon for File. */
const GROUP_GLYPH: Readonly<Record<PaletteGroup, ToolbarGlyph | null>> = {
  Navigate: 'sidebar',
  File: null,
  View: 'read',
  Copy: 'copy',
  Source: 'source',
  Extract: 'export',
  Transform: 'transform',
};

function groupGlyph(doc: Document, group: PaletteGroup): HTMLElement {
  const glyph = GROUP_GLYPH[group];
  if (glyph === null) return kindIconElement(doc, 'docs');
  const el = toolbarIconElement(doc, glyph);
  el.classList.add('marxy-palette-glyph');
  return el;
}

/** `aria-selected="true"` on the row the keys act on; no attribute on the others. */
function markSelected(row: Element, on: boolean): void {
  if (on) row.setAttribute('aria-selected', 'true');
  else row.removeAttribute('aria-selected');
}

/** One named group of rows. The label is not an option: the arrow keys count `.marxy-palette-row` only. */
function groupShell(doc: Document, text: string, n: number): { group: HTMLLIElement; rows: HTMLOListElement } {
  const group = doc.createElement('li') as HTMLLIElement;
  group.className = 'marxy-palette-group';
  group.setAttribute('role', 'group');
  const label = doc.createElement('span') as HTMLSpanElement;
  label.className = 'marxy-palette-section';
  label.id = `marxy-palette-section-${n}`;
  label.textContent = text;
  group.setAttribute('aria-labelledby', label.id);
  const rows = doc.createElement('ol') as HTMLOListElement;
  rows.setAttribute('role', 'none');
  group.append(label, rows);
  return { group, rows };
}

function fragmentOf(doc: Document): DocumentFragment {
  return 'createDocumentFragment' in doc ? (doc as Document).createDocumentFragment() : document.createDocumentFragment();
}

/** A command row: glyph, the title over its group, and the chord (or a chevron for a row that opens a list). */
function commandRow(doc: Document, cmd: Command, selected: boolean, copyId: string | undefined): HTMLLIElement {
  const group = paletteGroupOf(cmd);
  const row = doc.createElement('li') as HTMLLIElement;
  row.className = 'marxy-palette-row marxy-menu-row';
  row.dataset.rowKey = cmd.id;
  row.setAttribute('role', 'option');
  const text = doc.createElement('span') as HTMLSpanElement;
  text.className = 'marxy-palette-text';
  const title = doc.createElement('span') as HTMLSpanElement;
  title.className = 'marxy-palette-title';
  title.textContent = cmd.title;
  // No second line: the group header above already names the group.
  text.append(title);
  row.append(groupGlyph(doc, group), text);
  const spec = cmd.key ?? (cmd.id === copyId ? 'Mod+C' : undefined);
  if (cmd.unavailableNow !== undefined) {
    row.dataset.marxyUnavailable = '';
    row.setAttribute('aria-disabled', 'true');
    const why = doc.createElement('span') as HTMLSpanElement;
    why.className = 'marxy-palette-why';
    why.textContent = cmd.unavailableNow;
    text.append(why);
  } else if (spec !== undefined) {
    const key = doc.createElement('span') as HTMLSpanElement;
    key.className = 'marxy-palette-key marxy-menu-key';
    key.textContent = keyLabel(spec, isMac());
    row.appendChild(key);
  } else if (drillText(cmd.id) !== undefined) {
    const more = doc.createElement('span') as HTMLSpanElement;
    more.className = 'marxy-palette-key marxy-menu-key';
    more.setAttribute('aria-hidden', 'true');
    more.textContent = '›';
    row.appendChild(more);
  }
  markSelected(row, selected);
  return row;
}

function paintOperationRows(
  list: HTMLOListElement,
  cmds: readonly Command[],
  selected: number,
): void {
  const doc = ownerDocumentOf(list);
  const next = fragmentOf(doc);
  const { copyId } = selectionChords();
  // A header whenever the group changes; the list is sorted by group (commands.ts), so each group is one run.
  let rows: HTMLOListElement | null = null;
  let current: PaletteGroup | null = null;
  let n = 0;
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]!;
    const group = paletteGroupOf(cmd);
    if (rows === null || group !== current) {
      const shell = groupShell(doc, group, n++);
      next.appendChild(shell.group);
      rows = shell.rows;
      current = group;
    }
    rows.appendChild(commandRow(doc, cmd, i === selected, copyId));
  }
  list.replaceChildren(next);
}

/** What a document row says besides its title: its age. */
interface RowDecor {
  readonly age: (hit: IndexHit) => string | undefined;
  /** An `@` or `#` list: a row leads with its heading and names its document under it. */
  readonly headingFirst: () => boolean;
}

const SECTION_LABELS: Record<EmptySectionKind, string> = {
  pinned: 'Pinned',
  recent: 'Recent',
};

/** The folder a document sits in, from its root's own folder name down: `repo/docs`. */
function folderLine(entry: IndexEntry): string {
  const slash = entry.path.lastIndexOf('/');
  if (slash <= 0) return '';
  const dir = entry.path.slice(0, slash);
  const root = entry.root;
  if (root.length > 1 && (dir === root || dir.startsWith(`${root}/`))) return dir.slice(root.lastIndexOf('/') + 1);
  return dir;
}

/** A document's path as its row shows it, from its root's folder down: `repo/docs/guide.md`. */
function pathLine(entry: IndexEntry): string {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  const folder = folderLine(entry);
  return folder === '' ? name : `${folder}/${name}`;
}

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
    row.className = 'marxy-palette-row marxy-menu-row';
    row.dataset.rowKey = key;
    row.setAttribute('role', 'option');
  }
  const age = decor.age(hit);
  // The kind icon leads every document row: the kind the index recorded (a reader's rule included), and
  // only for an entry that records none, the path alone (no bytes are read).
  const kind = hit.entry.readerKind ?? detectKind({ path: hit.entry.path, head: new Uint8Array() }).kind;
  const viewerGlyph = viewerGlyphOf(hit.entry.path);
  const icon = viewerGlyph === null ? kindIconElement(doc, kind, kind === 'code' ? langOfPath(hit.entry.path) : undefined) : viewerGlyph.draw(doc);
  // The title over its folder: two lines at the palette's 46 px.
  const text = doc.createElement('span') as HTMLSpanElement;
  text.className = 'marxy-palette-text';
  const title = doc.createElement('span') as HTMLSpanElement;
  title.className = 'marxy-palette-title';
  const headingText = hit.heading === undefined ? undefined : hit.entry.headings[hit.heading]?.text;
  const sectionRow = decor.headingFirst() && headingText !== undefined;
  const label = sectionRow ? `${headingText} in ${hit.entry.title}` : labelForHit(hit);
  title.textContent = sectionRow ? headingText : labelForHit(hit);
  const sub = doc.createElement('span') as HTMLSpanElement;
  sub.className = 'marxy-palette-sub';
  const folder = folderLine(hit.entry);
  // The document is named under its heading, with the folder it is in; a file row shows its path.
  // A file that is not text says what it is and how big first: its kind icon alone does not.
  const facts = viewerGlyph === null ? '' : `${viewerGlyph.label} · ${sizeLabel(hit.entry.size)} · `;
  sub.textContent = sectionRow ? (folder === '' ? hit.entry.title : `${hit.entry.title} · ${folder}`) : `${facts}${pathLine(hit.entry)}`;
  text.append(title, sub);
  if (age === undefined) {
    row.replaceChildren(icon, text);
    row.removeAttribute('aria-label');
  } else {
    row.replaceChildren(icon, text);
    const when = doc.createElement('span') as HTMLSpanElement;
    when.className = 'marxy-palette-age';
    when.setAttribute('aria-hidden', 'true');
    when.textContent = age;
    row.appendChild(when);
    // An option's children are presentational to a screen reader, so the age is said in the option's own name.
    row.setAttribute('aria-label', `${label}, ${spokenAge(age)}`);
  }
  if (sectionRow && age === undefined) row.setAttribute('aria-label', label);
  markSelected(row, selected);
  if (hit.heading !== undefined) {
    const heading = hit.entry.headings[hit.heading];
    if (heading !== undefined) row.dataset.marxyS = String(heading.byteOffset);
  } else {
    delete row.dataset.marxyS;
  }
  return row;
}

/** `text` with each flagged character named (`U+202E`) in place of itself, for a label a screen reader speaks. */
function namedInvisibles(text: string): string {
  return invisibleSegments(text, { inCode: false, sourceStart: 1 })
    .map((seg) =>
      seg.kind === 'text' ? seg.value : seg.kind === 'tag-run' ? ` tag ×${seg.count} ` : ` U+${invisibleHexLabel(seg.cp)} `)
    .join('');
}

/** The folder and name a content hit's group is labelled with, as the rows' paths are written. */
function hitGroupLabel(path: string, entryOf: (path: string) => IndexEntry | undefined): string {
  const entry = entryOf(path);
  return entry ? pathLine(entry) : path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The workspace search (`#`): the hits grouped under their file, each row the line cut around the match (the match marked,
 * textContent only) and its line number.
 */
function paintContentRows(
  list: HTMLOListElement,
  hits: readonly ContentHit[],
  titleOf: (path: string) => string,
  entryOf: (path: string) => IndexEntry | undefined,
  selected: number,
): void {
  const doc = ownerDocumentOf(list);
  const next = doc.createDocumentFragment();
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.path, (counts.get(hit.path) ?? 0) + 1);
  let rows: HTMLOListElement | null = null;
  let current: string | null = null;
  let n = 0;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    if (rows === null || hit.path !== current) {
      const many = counts.get(hit.path)!;
      const shell = groupShell(doc, `${hitGroupLabel(hit.path, entryOf)}${many > 1 ? `  (${many})` : ''}`, n++);
      next.appendChild(shell.group);
      rows = shell.rows;
      current = hit.path;
    }
    const row = doc.createElement('li') as HTMLLIElement;
    row.className = 'marxy-palette-row marxy-menu-row marxy-palette-hit';
    row.dataset.rowKey = `${hit.path}:${hit.byteOffset}`;
    row.setAttribute('role', 'option');
    const preview = doc.createElement('span') as HTMLSpanElement;
    preview.className = 'marxy-palette-ex';
    const start = Math.min(Math.max(0, hit.matchStart), hit.preview.length);
    const end = Math.min(Math.max(start, hit.matchEnd), hit.preview.length);
    const mark = doc.createElement('mark') as HTMLElement;
    mark.className = 'marxy-palette-match';
    // Bidi controls and zero-width characters are marked, never painted raw (commitment 4). The whole
    // preview is segmented once and then cut, so a joiner at the match's edge is judged with its neighbours.
    const [before, match, after] = splitSegments(invisibleSegments(hit.preview, { inCode: false, sourceStart: 1 }), start, end);
    appendInvisibleSegments(preview, before);
    appendInvisibleSegments(mark, match);
    preview.append(mark);
    appendInvisibleSegments(preview, after);
    const line = doc.createElement('span') as HTMLSpanElement;
    line.className = 'marxy-palette-sub marxy-palette-line';
    line.textContent = `:${hit.line}`;
    row.append(preview, line);
    row.setAttribute('aria-label', `${titleOf(hit.path)}, line ${hit.line}: ${namedInvisibles(hit.preview)}`);
    markSelected(row, i === selected);
    rows.appendChild(row);
  }
  list.replaceChildren(next);
}

/** `text` with the characters at `marks` in bold (the letters a query matched), as text nodes. */
function markedText(doc: Document, text: string, marks: readonly number[] | undefined): DocumentFragment {
  const out = fragmentOf(doc);
  if (!marks || marks.length === 0) {
    out.append(text);
    return out;
  }
  const set = new Set(marks);
  let run = '';
  let on = false;
  const flush = (): void => {
    if (run === '') return;
    if (on) {
      const b = doc.createElement('b');
      b.textContent = run;
      out.append(b);
    } else out.append(run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== on) {
      flush();
      on = hit;
    }
    run += text[i];
  }
  flush();
  return out;
}

/** A scope's own row: its title (or an excerpt), its quiet detail, and its key or why it cannot run. */
function lineRowElement(doc: Document, row: LineRow, selected: boolean): HTMLLIElement {
  const li = doc.createElement('li') as HTMLLIElement;
  li.className = row.ex ? 'marxy-palette-row marxy-menu-row marxy-palette-hit' : 'marxy-palette-row marxy-menu-row';
  li.dataset.rowKey = row.key;
  li.setAttribute('role', 'option');
  const text = doc.createElement('span') as HTMLSpanElement;
  text.className = 'marxy-palette-text';
  if (row.ex) {
    const ex = doc.createElement('span') as HTMLSpanElement;
    ex.className = 'marxy-palette-ex';
    const mark = doc.createElement('mark') as HTMLElement;
    mark.className = 'marxy-palette-match';
    mark.textContent = row.ex.match;
    ex.append(row.ex.before, mark, row.ex.after);
    text.append(ex);
  } else {
    const title = doc.createElement('span') as HTMLSpanElement;
    title.className = 'marxy-palette-title';
    title.append(markedText(doc, row.title, row.marks));
    text.append(title);
  }
  if (row.detail) {
    const sub = doc.createElement('span') as HTMLSpanElement;
    sub.className = 'marxy-palette-sub';
    sub.textContent = row.detail;
    text.append(sub);
  }
  li.append(text);
  if (row.why !== undefined) {
    li.dataset.marxyUnavailable = '';
    li.setAttribute('aria-disabled', 'true');
    const why = doc.createElement('span') as HTMLSpanElement;
    why.className = 'marxy-palette-why';
    why.textContent = row.why;
    li.append(why);
  } else if (row.key2 !== undefined) {
    const key = doc.createElement('span') as HTMLSpanElement;
    key.className = 'marxy-palette-key marxy-menu-key';
    key.textContent = keyLabel(row.key2, isMac());
    li.append(key);
  }
  li.setAttribute('aria-label', [row.ex ? `${row.ex.before}${row.ex.match}${row.ex.after}` : row.title.trim(), row.detail, row.why].filter(Boolean).join(', '));
  markSelected(li, selected);
  return li;
}

/**
 * Go's rows and a scope's: each block under its label (an empty label paints none), the selection counting items across
 * them. A document row already on screen is patched, not rebuilt.
 */
function paintBlocks(list: HTMLOListElement, blocks: readonly PaletteBlock[], selected: number, decor: RowDecor): void {
  const doc = ownerDocumentOf(list);
  const keyed = new Map<string, HTMLLIElement>();
  for (const child of list.querySelectorAll('li[data-row-key]')) {
    if (child instanceof HTMLLIElement && child.dataset.rowKey) keyed.set(child.dataset.rowKey, child);
  }
  const next = fragmentOf(doc);
  const { copyId } = selectionChords();
  let index = 0;
  let n = 0;
  for (const block of blocks) {
    if (block.items.length === 0) continue;
    let rows: HTMLElement;
    if (block.label === '') {
      const group = doc.createElement('li') as HTMLLIElement;
      group.className = 'marxy-palette-group';
      group.setAttribute('role', 'group');
      const ol = doc.createElement('ol') as HTMLOListElement;
      ol.setAttribute('role', 'none');
      group.append(ol);
      next.appendChild(group);
      rows = ol;
    } else {
      const shell = groupShell(doc, block.label, n++);
      next.appendChild(shell.group);
      rows = shell.rows;
    }
    for (const item of block.items) {
      const on = index++ === selected;
      if (item.type === 'hit') rows.appendChild(documentRow(doc, item.hit, decor, on, keyed.get(`${item.hit.entry.path}:${item.hit.heading ?? 'doc'}`)));
      else if (item.type === 'cmd') rows.appendChild(commandRow(doc, item.cmd, on, copyId));
      else rows.appendChild(lineRowElement(doc, item.row, on));
    }
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
  const { input, list, notice, esc, aside, scopeEl, countEl } = ensurePaletteStructure(deps.dialog, document);
  let session = takePaletteHydration() ?? emptySession('/');
  const feed =
    deps.feed ??
    createIndexFeed({
      currentRoot: () => session.currentRoot,
      recentRoots: () => session.recentRoots,
      readAt: () => session.readAt,
    });
  const now = deps.now ?? Date.now;
  // The empty state is worked out when the palette is summoned or what it reads changes, never on a
  // keystroke: clearing the query reuses it. Ages are those of the moment of the summons.
  let emptyNow = now();
  let emptyCache: { entries: readonly IndexEntry[]; session: PaletteSession; sections: readonly EmptySection[] } | undefined;
  let target: PaletteTarget = 'here';
  // The suggested commands are asked for once a summons (they read the app's context), never per keystroke.
  let suggestedCache: readonly Command[] | undefined;
  const suggested = (): readonly Command[] => {
    if (target === 'split') return [];
    if (suggestedCache === undefined) {
      try {
        suggestedCache = withPaletteListing(() => suggestedCommands(commands(), buildAppContext()));
      } catch {
        // Mounted before the app's context exists: nothing to suggest yet; the next summons asks again.
        return [];
      }
    }
    return suggestedCache;
  };
  /** The paths the panes showed as the palette was summoned (beside mode leaves them out). */
  let visible: readonly string[] = [];
  /** Set when a second pane was refused: shown in place of the notice, until the next key. */
  let refusal: string | undefined;
  let origin: { restore(): void } | null = null;
  /** Beside mode with nothing typed: Recent alone, the MRU without what is on screen. */
  const besideSections = (): readonly EmptySection[] => {
    const byPath = new Map<string, IndexEntry>();
    for (const entry of feed.entries()) byPath.set(entry.path, entry);
    const hits: IndexHit[] = [];
    for (const path of recentExcluding(session, visible)) {
      if (hits.length >= EMPTY_STATE_LIMIT) break;
      const indexed = byPath.get(path);
      const read = session.readAt[path];
      // A document opened from outside the index still has a row: it was read, so it can be read again.
      const entry: IndexEntry = indexed ?? {
        path,
        root: session.currentRoot,
        title: path.slice(path.lastIndexOf('/') + 1),
        headings: [],
        mtimeMs: read ?? 0,
        size: 0,
        kind: 'markdown',
      };
      hits.push({ entry: read === undefined ? entry : { ...entry, lastReadMs: read }, score: 0 });
    }
    return hits.length === 0 ? [] : [{ kind: 'recent', hits }];
  };
  const emptySections = (): readonly EmptySection[] => {
    if (target === 'split') return besideSections();
    const entries = feed.entries();
    if (emptyCache !== undefined && emptyCache.entries === entries && emptyCache.session === session) {
      return emptyCache.sections;
    }
    const started = performance.now();
    const entriesByPath = new Map<string, IndexEntry>();
    for (const entry of entries) entriesByPath.set(entry.path, entry);
    const sections = emptyStateSections({ entriesByPath, session, nowMs: emptyNow });
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
  // the latest answer of the content search. Only the `/` phase reads it.
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
            // The palette lists every file; its content search reads only text.
            return { paths: entries.filter((entry) => entry.kind !== 'binary' && fileTypeFor(entry.path).searchable).map((entry) => entry.path), roots: [...roots] };
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
  /** Puts `value` in the field, as typed: a help row or an "Or type" row picks a scope this way. */
  const setQuery = (value: string): void => {
    input.value = value;
    selected = 0;
    refusal = undefined;
    syncContent();
    repaint();
    input.focus();
    input.setSelectionRange(value.length, value.length);
  };
  const scopeEnv: ScopeEnv = {
    refresh: () => {
      if (open) repaint();
    },
    setQuery,
    ctx: () => buildAppContext(),
    entries: () => feed.entries(),
  };
  const asItems = (rows: readonly LineRow[]): PaletteItem[] => rows.map((row) => ({ type: 'line', row }));
  /** Open tabs: a file the index holds is a document row (opened as any is, into the session's history); a scratch or app page is the Line's own row. */
  const tabItems = (rows: readonly LineRow[], indexedToo: boolean): PaletteItem[] =>
    rows.flatMap((row): PaletteItem[] => {
      const entry = entryOf(row.key.slice('tab:'.length));
      if (entry === undefined) return [{ type: 'line', row }];
      return indexedToo ? [{ type: 'hit', hit: { entry, score: 0 } }] : [];
    });
  /** Rows under their own group labels, in the order they come (a scope's rows name their groups). */
  const blocksOfRows = (rows: readonly LineRow[]): PaletteBlock[] => {
    const out: { label: string; items: PaletteItem[] }[] = [];
    for (const row of rows) {
      const last = out.at(-1);
      if (last && last.label === row.group) last.items.push({ type: 'line', row });
      else out.push({ label: row.group, items: [{ type: 'line', row }] });
    }
    return out;
  };
  /** The one row of an empty window: the system's open dialog, as Mod+O runs it. */
  const openFileRows = (): LineRow[] => {
    const cmd = commands().find((c) => c.id === 'document.open');
    if (cmd === undefined) return [];
    return [{ key: 'start:open-file', group: 'Start', title: 'Open a file', key2: 'Mod+O', run: () => void cmd.run(buildAppContext()) }];
  };
  const GO_HEADINGS = 8;
  const GO_COMMANDS = 6;
  /** Go's headings: this document's that match first, then the other documents' (the heading index). */
  const headingHits = (q: string): IndexHit[] => {
    // Copies of one document in other checkouts fold as the files do.
    const opts = { prepared: feed.prepared(), limit: GO_HEADINGS, rootRank: feed.rootRank(), currentPath: deps.getCurrentPath(), fold: foldCopies() };
    const here = deps.getCurrentPath() === null ? [] : paletteResults(`#${q}`, feed.entries(), session, opts);
    const seen = new Set(here.map((h) => `${h.entry.path}:${h.heading}`));
    const elsewhere = paletteResults(`@${q}`, feed.entries(), session, opts).filter((h) => !seen.has(`${h.entry.path}:${h.heading}`));
    return [...here, ...elsewhere].slice(0, GO_HEADINGS);
  };
  /** Go's commands: those that can run now whose title holds the query, best first. */
  const goCommands = (q: string): Command[] => {
    if (target === 'split') return [];
    try {
      const needle = q.toLowerCase();
      const found = withPaletteListing(() => paletteCommands(commands(), buildAppContext(), q)).filter((c) => c.unavailableNow === undefined && !c.id.startsWith('palette.drill.'));
      // Go names commands only by words they hold: a scattered subsequence ("rollb" in "all code blocks") is `>`'s to find.
      const terms = needle.split(/\s+/).filter(Boolean);
      return found
        .filter((c) => terms.every((term) => c.title.toLowerCase().includes(term)))
        .map((c) => ({ c, s: fuzzyScore(c.title.toLowerCase(), needle) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, GO_COMMANDS)
        .map((x) => x.c);
    } catch {
      return [];
    }
  };
  const dressModel = (base: PaletteModel, text: string): PaletteModel => {
    const here = deps.getCurrentPath();
    if (base.phase === 'scope') {
      const { scope, q } = scopeOf(text.trimStart());
      let result: ReturnType<typeof scopeRows>;
      try {
        result = scopeRows(scope.id, q, scopeEnv);
      } catch (e) {
        result = { rows: [], note: `This scope could not be listed here: ${e instanceof Error ? e.message : String(e)}` };
      }
      const blocks = blocksOfRows(result.rows);
      return { ...base, scope: scope.id, blocks, items: asItems(result.rows), notice: result.note, count: result.count, enter: result.enter };
    }
    if (base.phase === 'empty') {
      // An open tab already in Pinned or Recent is listed there once.
      const listed = new Set((base.sections ?? []).flatMap((s) => s.hits.map((h) => h.entry.path)));
      const lead = target === 'split' ? [] : tabRows('', here).filter((r) => !listed.has(r.key.slice('tab:'.length)));
      const tail = target === 'split' ? [] : orTypeRows(setQuery);
      // With nothing open the first row is the way in; Mod+O is its key.
      const door = target === 'split' || here !== null || tabRows('', here).length > 0 ? [] : openFileRows();
      const blocks: PaletteBlock[] = [
        { label: 'Start', items: asItems(door) },
        { label: 'Open', items: tabItems(lead, true) },
        ...(base.sections ?? []).map((s) => ({ label: SECTION_LABELS[s.kind], items: s.hits.map((hit): PaletteItem => ({ type: 'hit', hit })) })),
        { label: 'Suggested', items: (base.suggested ?? []).map((cmd): PaletteItem => ({ type: 'cmd', cmd })) },
        { label: 'Or type', items: asItems(tail) },
      ];
      return { ...base, scope: 'go', blocks, items: blocks.flatMap((b) => b.items) };
    }
    if (base.phase === 'typing') {
      const q = text.trim();
      const lead = [...referenceRows(q, feed.entries(), here), ...(target === 'split' ? [] : tabRows(q, here))];
      // A heading that is its listed file's own title would only name that file again.
      const filed = new Set(base.hits.map((h) => h.entry.path));
      // A query written `.ext` asks for files of that kind alone.
      const kq = kindQuery(text);
      const narrowed = kq !== null && kq.explicit && base.hits.length > 0 && base.hits.every((h) => answersKinds(h.entry, kq));
      const heads = narrowed ? [] : headingHits(q).filter((h) => !(filed.has(h.entry.path) && h.entry.headings[h.heading ?? -1]?.text === h.entry.title));
      const cmds = goCommands(q);
      const blocks: PaletteBlock[] = [
        { label: 'Reference', items: asItems(lead.filter((r) => r.group === 'Reference')) },
        { label: 'Open', items: tabItems(lead.filter((r) => r.group === 'Open'), false) },
        { label: 'Files', items: base.hits.map((hit): PaletteItem => ({ type: 'hit', hit })) },
        { label: 'Headings', items: heads.map((hit): PaletteItem => ({ type: 'hit', hit })) },
        { label: 'Commands', items: cmds.map((cmd): PaletteItem => ({ type: 'cmd', cmd })) },
      ];
      const items = blocks.flatMap((b) => b.items);
      const notice = items.length === 0 ? base.notice : base.hits.length === 0 ? undefined : base.notice;
      return { ...base, scope: 'go', blocks, items, notice };
    }
    return { ...base, scope: base.phase === 'operations' ? 'cmd' : 'grep' };
  };
  const query = (text: string): PaletteModel =>
    dressModel(
      queryPalette(text, section, feed.entries(), session, feed.prepared(), feed.rootRank(), foldCopies(), feed.notice(), emptySections, contentState, suggested, deps.getCurrentPath()),
      text,
    );
  const decor: RowDecor = {
    // Every document row has its age: the modified time at the row's end.
    age: (hit) => relativeAge(model.phase === 'empty' ? emptyNow : now(), hit.entry.mtimeMs) || undefined,
    // A heading row leads with its heading and names its document under it.
    headingFirst: () => true,
  };
  const rowCountOf = (m: PaletteModel): number =>
    m.phase === 'operations'
      ? m.operationCommands.length
      : m.phase === 'content'
        ? (m.contentHits?.length ?? 0)
        : (m.items?.length ?? m.hits.length + (m.suggested?.length ?? 0));
  /** The item at row `i` of a Go or scope list. */
  const itemAt = (i: number): PaletteItem | undefined => model.items?.[i];
  // the preview column follows the highlighted row, after a pause. Opening a preview reads a file's first
  // bytes (`readHead`, never `readFile`) and writes nothing; the highlight moving on drops the wait, so holding an
  // arrow key reads nothing until the key is released.
  const HEAD_CACHE = 6;
  const headCache = new Map<string, Uint8Array | null>();
  /** A file's first bytes for a preview, the last few kept (arrowing back reads nothing); none for a file over the large-file limit. */
  const headOf = async (entry: IndexEntry): Promise<Uint8Array | null> => {
    if (previewReadBytes(entry) === 0) return null;
    const key = `${entry.path}\0${entry.mtimeMs}\0${entry.size}`;
    const held = headCache.get(key);
    if (held !== undefined) {
      headCache.delete(key);
      headCache.set(key, held);
      return held;
    }
    const bytes = await deps.shell.readHead(entry.path, previewReadBytes(entry));
    headCache.set(key, bytes);
    for (const old of headCache.keys()) {
      if (headCache.size <= HEAD_CACHE) break;
      headCache.delete(old);
    }
    return bytes;
  };
  const entryCache: { entries?: readonly IndexEntry[]; byPath: Map<string, IndexEntry> } = { byPath: new Map() };
  const entryOf = (path: string): IndexEntry | undefined => {
    const entries = feed.entries();
    if (entryCache.entries !== entries) {
      entryCache.entries = entries;
      entryCache.byPath = new Map(entries.map((entry) => [entry.path, entry]));
    }
    return entryCache.byPath.get(path);
  };
  const loadFile = async (entry: IndexEntry, heading: number | undefined): Promise<PreviewData> => {
    // A file named for credentials or keys (.env, .pem, .key) is not read for a preview: its head may be the secret.
    if (isSecretName(entry.path)) return { type: 'file', title: entry.title, chips: [], notice: 'May hold secrets · no preview. Open it to read it.' };
    let head: Uint8Array | null;
    try {
      head = await headOf(entry);
    } catch (err) {
      // A file from history outside every folder in scope is the shell's to refuse until the reader opens it again.
      if ((err as { code?: unknown } | null)?.code === 'outside') return { type: 'file', title: entry.title, chips: [], notice: 'Not opened since Marxy started · open it to read it here.' };
      return { type: 'file', title: entry.title, chips: [], notice: `Could not read this file: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (heading !== undefined) return sectionPreview(entry, heading, head);
    return filePreview(entry, head);
  };
  const loadCommand = async (cmd: Command): Promise<PreviewData> => {
    const { copyId } = selectionChords();
    const spec = cmd.key ?? (cmd.id === copyId ? 'Mod+C' : undefined);
    const plain = commandPreview(cmd, paletteGroupOf(cmd), spec === undefined ? undefined : keyLabel(spec, isMac()));
    const prefix = 'transform.run.';
    if (cmd.id.startsWith(prefix) && deps.transformInput !== undefined) {
      const input = await deps.transformInput().catch(() => null);
      const result = input === null ? null : transformPreview(cmd.id.slice(prefix.length), input);
      if (result !== null) return result;
    }
    return plain;
  };
  /** The highlighted row's preview: a key naming what it shows (the same key, the same preview) and how to make it. */
  const previewTarget = (): { key: string; load: () => Promise<PreviewData | LinePreview | null> } | null => {
    if (!open) return null;
    let entry: IndexEntry | undefined;
    let heading: number | undefined;
    let command: Command | undefined;
    if (model.phase === 'operations') command = model.operationCommands[selected];
    else if (model.phase === 'content') {
      const found = model.contentHits?.[selected];
      entry = found === undefined ? undefined : entryOf(found.path);
    } else {
      const item = itemAt(selected);
      if (item?.type === 'hit') {
        entry = item.hit.entry;
        heading = item.hit.heading;
      } else if (item?.type === 'cmd') command = item.cmd;
      else if (item?.type === 'line') {
        const row = item.row;
        const preview = row.preview;
        return preview ? { key: `line\0${model.query}\0${row.key}`, load: () => preview.call(row) } : null;
      }
    }
    if (command !== undefined) {
      const cmd = command;
      return { key: `cmd\0${cmd.id}`, load: () => loadCommand(cmd) };
    }
    if (entry === undefined) return null;
    const file = entry;
    return { key: `${heading === undefined ? 'file' : `section${heading}`}\0${file.path}\0${file.mtimeMs}\0${file.size}`, load: () => loadFile(file, heading) };
  };
  const follower = createPreviewFollower({
    show: (data) => {
      if (isLinePreview(data)) drawLinePreview(aside, data);
      else drawPreview(aside, data);
    },
    pending: (on) => {
      if (on) aside.setAttribute('data-marxy-pending', '');
      else aside.removeAttribute('data-marxy-pending');
    },
  });
  const syncPreview = () => {
    const target = previewTarget();
    if (target === null) {
      follower.follow(null, () => Promise.resolve(null));
      return;
    }
    // Asked only when the pause ends: a palette too narrow for the column (it is not drawn) reads nothing. The follower
    // draws the palette's own previews; a Line preview goes through it as the same opaque value.
    follower.follow(target.key, () => (aside.getClientRects().length === 0 ? Promise.reject(new Error('no column')) : (target.load() as Promise<PreviewData | null>)));
  };
  const paintModel = () => {
    if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
    else if (model.phase === 'content') paintContentRows(list, model.contentHits ?? [], titleOf, entryOf, selected);
    else paintBlocks(list, model.blocks ?? [], selected, decor);
    syncActive();
    syncPreview();
  };
  /** The highlighted row is the field's active descendant, so a screen reader hears it and its group. */
  const syncActive = () => {
    const rows = list.querySelectorAll('.marxy-palette-row');
    for (let i = 0; i < rows.length; i++) rows[i]!.id = `marxy-palette-opt-${i}`;
    const current = rows[selected];
    if (current) input.setAttribute('aria-activedescendant', current.id);
    else input.removeAttribute('aria-activedescendant');
  };
  /** The scope's word in the field, its count, and its keys in the foot. */
  let footScope: ScopeId | null = null;
  const syncScope = () => {
    const scope = model.scope ?? 'go';
    const label = scope === 'go' ? 'Go' : scopeOf(input.value.trimStart()).scope.label;
    if (scopeEl.textContent !== label) scopeEl.textContent = label;
    deps.dialog.dataset.marxyScope = scope;
    countEl.textContent = model.count ?? '';
    const foot = deps.dialog.querySelector('.marxy-palette-foot');
    if (scope !== footScope && foot instanceof HTMLElement) {
      footScope = scope;
      fillFooter(foot, document, isMac(), scope);
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
    syncScope();
    const line = refusal ?? (target === 'split' ? (model.notice ? `Open beside. ${model.notice}` : 'Open beside') : model.notice);
    if (line) {
      notice.textContent = line;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
    if (markPerf !== undefined) recordKeystrokePaint(markPerf, deps.shell);
  };

  const summon = (withQuery?: string, opts?: { target?: PaletteTarget }) => {
    open = true;
    target = opts?.target ?? 'here';
    refusal = undefined;
    visible = target === 'split' ? (deps.visiblePaths?.() ?? []) : [];
    // The pane focused now, once: a second summons (the beside chord pressed in the palette) keeps it.
    origin ??= deps.focusOrigin?.() ?? null;
    chordCache = undefined;
    suggestedCache = undefined;
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
    follower.reset();
    headCache.clear();
    search?.cancel();
    if (deps.dialog.open) deps.dialog.close();
    // With two panes, focus goes back to the one the palette was summoned from (focusOrigin); an
    // open beside moves it on once the document is on screen.
    origin?.restore();
    origin = null;
  };

  // Every rebuild of what the palette searches repaints it: a new walk, a folder added or dropped.
  feed.subscribe(() => repaint());

  // Ends the palette's listeners on the window and on its own elements, which outlive it in the page.
  const life = new AbortController();
  deps.dialog.addEventListener('close', () => {
    // Native cancel (Esc with focus off the input) closes the dialog without going through dismiss.
    // (Reads the live state: a stale close event must not shut a palette summoned since.)
    if (open && !deps.dialog.open) dismiss();
  }, { signal: life.signal });

  /** Runs a command row; a row that opens a list turns the query into that list instead of closing. */
  const runCommandRow = (cmd: Command | undefined) => {
    if (cmd === undefined) return;
    const drill = drillText(cmd.id, input.value);
    if (drill !== undefined) {
      input.value = `>${drill}`;
      selected = 0;
      repaint();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    runPaletteCommand(cmd);
  };
  /** Runs a scope's row: the Line closes first unless the row keeps it open (it set the query). */
  const runLineRow = (row: LineRow, how: { beside: boolean; alt: boolean }) => {
    if (row.why !== undefined) {
      buildAppContext().showNotice(row.why, { kind: 'refused' });
      return;
    }
    let kept: boolean | void | Promise<boolean | void>;
    try {
      // Run before dismissing: a row that sets the query keeps the Line, and focus goes back to the page only when it closes.
      kept = row.run(how);
    } catch (e) {
      dismiss();
      buildAppContext().showNotice(`That could not be done: ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' });
      return;
    }
    if (kept === true) return;
    dismiss();
  };
  /** Chooses row `index` of the list as it is now. */
  const choose = (index: number, how: { beside: boolean; alt: boolean }) => {
    if (model.phase === 'operations') return runCommandRow(model.operationCommands[index]);
    if (model.phase === 'content') return void activateContentHit(model.contentHits?.[index], target === 'split' || how.beside);
    const item = itemAt(index);
    if (item === undefined) {
      // A scope with nothing to choose acts on the query itself (find opens in-page find), then closes.
      if (model.enter) {
        const enter = model.enter;
        dismiss();
        enter(how);
      }
      return;
    }
    if (item.type === 'cmd') return runCommandRow(item.cmd);
    if (item.type === 'line') return runLineRow(item.row, how);
    void activateHit(item.hit, target === 'split' || how.beside);
  };

  /**
   * Tab: what the Line found, kept in the left panel that owns its scope: a workspace search becomes
   * Search with that query, an outline result Outline, a file Places, a transform Transforms, a reading Metadata.
   */
  const keepInPanel = (): boolean => {
    const { scope, q } = scopeOf(input.value.trimStart());
    let panel = KEEP_IN[scope.id];
    let arg: unknown = { q, scope: scope.id };
    if (model.phase === 'content') {
      const hit = model.contentHits?.[selected];
      arg = hit === undefined ? { q, scope: 'grep' } : { q, scope: 'grep', path: hit.path, line: hit.line };
    } else {
      const item = itemAt(selected);
      if (item?.type === 'line' && item.row.keep) {
        panel = item.row.keep.panel;
        arg = item.row.keep.arg;
      } else if (item?.type === 'hit') {
        panel = 'places';
        arg = { q, reveal: item.hit.entry.path };
      }
    }
    const handle = appHandle();
    // A window with no left section (the palette's own test page) has nowhere to keep it.
    const left = typeof handle?.frame === 'function' ? handle.frame()?.left : undefined;
    if (panel === undefined || !left) return false;
    dismiss();
    left.show(panel, arg, true);
    return true;
  };

  list.addEventListener('click', (event) => {
    const eventTarget = event.target as { closest?: (s: string) => Element | null } | null;
    const row = eventTarget?.closest?.('.marxy-palette-row') as HTMLElement | null | undefined;
    if (!row) return;
    // Group labels sit between rows: count rows only.
    const index = Array.prototype.indexOf.call(list.querySelectorAll('.marxy-palette-row'), row);
    if (index < 0) return;
    const mouse = event as MouseEvent;
    choose(index, { beside: target === 'split' || (isMac() ? mouse.metaKey : mouse.ctrlKey) === true, alt: mouse.altKey === true });
  }, { signal: life.signal });

  esc.addEventListener('click', () => dismiss(), { signal: life.signal });
  /**
   * Whether this open goes beside and cannot: when a second pane cannot be made the palette stays up with
   * the reason in its notice line, and Enter then opens the document here (the reader loses nothing).
   */
  const besideRefused = (beside: boolean): boolean => {
    if (!beside) return false;
    const reason = deps.splitRefusal?.() ?? null;
    if (reason === null) return false;
    refusal = `${reason} Enter opens it here.`;
    target = 'here';
    repaint();
    return true;
  };

  const activateHit = async (hit: IndexHit | undefined, beside = false) => {
    if (hit === undefined) return;
    if (besideRefused(beside)) return;
    const jump = jumpForHit(hit);
    session = recordOpen(session, jump.path, hit.entry.root);
    syncSession();
    dismiss();
    // After the palette is gone, and off this tick: the open never waits on a re-prepare.
    setTimeout(() => feed.refresh(), 0);
    if (beside && deps.openBeside !== undefined) {
      await deps.openBeside(jump.path, jump.byteOffset);
      return;
    }
    // The document on screen with no heading to land on: nothing to open.
    if (deps.getCurrentPath() === jump.path && jump.byteOffset === undefined) return;
    await renderPath(deps, jump.path, jump.byteOffset);
  };

  const rootOf = (path: string): string => {
    for (const entry of feed.entries()) if (entry.path === path) return entry.root;
    return session.currentRoot;
  };
  /** Open the file at the match and select the block that holds it. */
  const activateContentHit = async (hit: ContentHit | undefined, beside = false) => {
    if (hit === undefined) return;
    if (besideRefused(beside)) return;
    session = recordOpen(session, hit.path, rootOf(hit.path));
    syncSession();
    dismiss();
    setTimeout(() => feed.refresh(), 0);
    // The block is selected once the hit's document is on screen: over unsaved edits that waits for "Save
    // and open" or "Open without saving", and "Dismiss" leaves the open document untouched.
    const select = () => deps.selectBlockAtByte?.(hit.byteOffset);
    if (beside && deps.openBeside !== undefined) {
      await deps.openBeside(hit.path, hit.byteOffset, select);
      return;
    }
    await renderPath(deps, hit.path, hit.byteOffset, select);
  };

  /** A long list (149 commands) scrolls to keep the highlighted row in view; the group headers are not stops. */
  const scrollSelectedIntoView = () => {
    const row = list.querySelectorAll('.marxy-palette-row')[selected] as HTMLElement | undefined;
    row?.scrollIntoView?.({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    selected = 0;
    refusal = undefined;
    const started = performance.now();
    syncContent();
    repaint();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recordKeystrokePaint(performance.now() - started, deps.shell);
      });
    });
  }, { signal: life.signal });

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
      // Focus stays in the field: Tab keeps what was found in its panel, and Shift+Tab has nowhere to go.
      event.preventDefault();
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) keepInPanel();
      return;
    }
    const rowCount = rowCountOf(model);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.max(0, Math.min(rowCount - 1, selected + 1));
      paintModel();
      scrollSelectedIntoView();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      paintModel();
      scrollSelectedIntoView();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected, { beside: isMod(event), alt: event.altKey });
    }
  }, { signal: life.signal });

  // The summoning chords: `Mod+P` and `Mod+K` open the palette on documents, `Mod+Shift+P` and `Mod+/`
  // open it on commands (`>`; `Mod+/` on `>Transform`). `Mod+P` and `Mod+K` with the palette open select its text (Esc closes); the others close it when it is already open on what the chord opens. On `window` in
  // the capture phase, so a Source editor's own `Mod+/` (toggle comment) never sees the press.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!isMod(event) || event.altKey) return;
      const key = event.key.toLowerCase();
      const chord = paletteChordFor(key, event.shiftKey);
      if (!chord) return;
      const documents = chord.opens === 'documents';
      event.preventDefault();
      // Only Mod+/ is also a Source editor chord (CodeMirror's toggle comment): it stops here. The others go on,
      // so an open verb menu still closes on them.
      if (key === '/') event.stopPropagation();
      // An open verb menu closes first: closing it later would hand focus back from under the palette's field.
      closeVerbMenu();
      if (documents) {
        // Open already: the chord selects what is typed (Esc closes), so a second press never hands the next word to the page.
        if (open) {
          input.focus();
          input.select();
        } else summon();
      } else {
        // Mod+/ opens on the transforms (`>Transform`); Mod+Shift+P on every command (`>`).
        const query = key === '/' ? '>Transform' : '>';
        if (open && input.value === query) dismiss();
        else summon(query);
      }
    },
    { capture: true, signal: life.signal },
  );

  window.addEventListener('keydown', (event) => {
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
      const item = itemAt(selected);
      const hit = item?.type === 'hit' ? item.hit : undefined;
      // `hit?.heading === undefined` alone is also true when there is no hit at all (an empty
      // result list, or the operations phase, where `hits` is always []) — pin only a real hit.
      if (hit !== undefined && hit.heading === undefined) {
        event.preventDefault();
        session = togglePin(session, hit.entry.path);
        syncSession();
        repaint();
      }
    }
  }, { signal: life.signal });

  const travel = (step: ReturnType<typeof goBack>): boolean => {
    if (step === undefined) return false;
    session = step.session;
    syncSession();
    // Off the critical path, as in activateHit: the navigation never waits on a re-prepare.
    setTimeout(() => feed.refresh(), 0);
    void renderPath(deps, step.path);
    return true;
  };

  // history.json is read after first text, and this palette may be up before it.
  setHydrationListener((disk) => {
    session = adoptHistory(disk, session);
    syncSession();
  });
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
    togglePin(path) {
      session = togglePin(session, path);
      syncSession();
    },
    back: () => travel(goBack(session)),
    forward: () => travel(goForward(session)),
    open: summon,
    close: dismiss,
    destroy: () => life.abort(),
    setIndexEntries(next) {
      feed.setEntries(next);
    },
    feed,
  };
}

export function mountPaletteFromHandle(
  handle: AppHandle,
  opts?: { initialPath?: string | null; feed?: IndexFeed },
): PaletteController {
  // The selection controller and the command keys are the app's own: `startApp` made and installed them.
  const main = document.getElementById('marxy-main');
  const article = document.getElementById('doc') ?? document.querySelector('.marxy-article');
  const dialog = document.getElementById('marxy-palette');
  if (!(article instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement)) {
    throw new Error('palette mount: expected #doc and dialog#marxy-palette in the document');
  }
  const panes = typeof handle.panes === 'function' ? handle.panes() : null;
  const controller = mountPaletteApp({
    shell: handle.shell,
    ...(opts?.feed ? { feed: opts.feed } : {}),
    article,
    // The focused pane's scroller, asked each time: it moves with focus and with a split.
    get scroller() {
      return handle.panes().focused.view.host.scroller;
    },
    dialog,
    // What is on screen is the app's to say. A copy kept here and moved to the history tip on every
    // session change named the document being opened as the one already shown, so it never opened.
    getCurrentPath: () => handle.currentPath() ?? opts?.initialPath ?? null,
    setCurrentPath: () => {},
    openDocument: (path, at, onLanded) => handle.open(path, { at, onLanded }),
    selectBlockAtByte: (byte) => handle.selection.selectBlockAtByte(byte),
    searchContent: (paths, query, opts) => handle.shell.searchContent(paths, query, opts),
    // Looked up on each call: the service's answers move as roots are walked.
    checkoutKey: (path) => handle.index.checkoutKey(path),
    onSummon: () => handle.index.revalidate(),
    openBeside: (path, at, onLanded) => handle.open(path, { at, onLanded, target: 'other' }),
    visiblePaths: () => (panes?.panes ?? []).map((pane) => pane.path()).filter((path): path is string => path !== null),
    splitRefusal: () => (panes ? splitRefusal(panes) : null),
    focusOrigin: () => (panes && panes.panes.length > 1 ? focusOrigin(panes) : null),
    transformInput: async () => transformPreviewInput(buildAppContext()),
  });
  setPaletteCloser(() => controller.close());
  setPaletteOpener((query) => controller.open(query));
  // Any open the app records (command line, menu, a link), not only the palette's own.
  setOpenListener((path) => controller.noteRead(path, 'open'));
  // A save from Marxy is a read too: follow the store of every pane and note each of its saves.
  const followed = new Map<DocumentStore, () => void>();
  const followStores = () => {
    const now = new Set((panes?.panes ?? []).map((p) => p.content.store()).filter((s): s is DocumentStore => s !== null));
    for (const [store, off] of followed) {
      if (now.has(store)) continue;
      off();
      followed.delete(store);
    }
    for (const store of now) {
      if (followed.has(store)) continue;
      followed.set(store, store.subscribe((_snap, change) => {
        if (change.kind === 'save') controller.noteRead(change.path, 'save');
      }));
    }
  };
  followStores();
  panes?.onAnyDocumentChange(followStores);
  setAppHandle(handle);
  setPalette(controller);
  return controller;
}
