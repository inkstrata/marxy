// Summoned palette in the real document: input, list, keys, and ADR-0011 tab-bar checks (MARXY-87).

import { closeVerbMenu } from '../selection/verb-menu.ts';
import { detectKind, type IndexEntry, type IndexHit } from '@marxy/core';
import { invisibleHexLabel, invisibleSegments } from '@marxy/core/src/render/index.ts';
import type { ContentHit, Shell } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppHandle, AppShell } from '../app.ts';
import { setAppHandle, setPalette } from '../commands/app-handle.ts';
import { commands, type Command } from '../commands/index.ts';
import { withPaletteListing } from '../commands/navigation.ts';
import { transformPreviewInput } from '../commands/transform.ts';
import { checksFor } from '../library/checks.ts';
import type { DocumentStore } from '../document/store.ts';
import { appendInvisibleSegments } from '../render/invisibles-dom.ts';
import {
  commandPreview,
  createPreviewFollower,
  drawPreview,
  filePreview,
  previewReadBytes,
  sectionPreview,
  transformPreview,
  type PreviewData,
} from '../render/palette-preview.ts';
import { focusOrigin } from '../pane/focus.ts';
import { splitRefusal } from '../pane/fit.ts';
import { buildAppContext, setPaletteCloser, setPaletteOpener } from '../selection/bind.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
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
import { toolbarIconElement, type ToolbarGlyph } from '../workspace/toolbar-icons.ts';
import {
  changedSinceRead,
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
import { jumpForHit, paletteResults, sectionQuery, SECTION_LIMIT, type FoldCopies, type PreparedIndex, type RootRank, type SectionScope } from './search.ts';
import {
  emptySession,
  goBack,
  goForward,
  markRead,
  recentExcluding,
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
  /** An `@` or `#` query (W-13): `hits` are headings, and the rows lead with the heading and name the document. */
  readonly sectionScope?: SectionScope;
  /** The content phase only (C-17): the matches painted, in the order the shell returned them. */
  readonly contentHits?: readonly ContentHit[];
  /** The empty phase only: `hits` is these sections' rows in order, so a row index never counts a label. */
  readonly sections?: readonly EmptySection[];
  /** The empty phase only: commands listed after the sections as Suggested; selection runs on past `hits`. */
  readonly suggested?: readonly Command[];
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
  readonly openDocument: (path: string, at?: number, onLanded?: () => void) => Promise<void>;
  /**
   * Selects the innermost block of the open document that holds `byte` (the rendered selection, C-17).
   * Called only from `openDocument`'s `onLanded`, so the document is the hit's and is mounted through `byte`.
   */
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
  /**
   * Open beside (D-07). Opens `path` in the other pane, making it when there is one pane, and moves focus
   * there. Without it a document opens here (`openDocument`).
   */
  readonly openBeside?: (path: string, at?: number, onLanded?: () => void) => Promise<void>;
  /** The documents the panes show now; "open beside" does not offer them again. */
  readonly visiblePaths?: () => readonly string[];
  /** Why a second pane cannot be made now (the window is too narrow), or null. */
  readonly splitRefusal?: () => string | null;
  /** The pane focused as the palette opens, to give focus back to on dismissal; null with one pane. */
  readonly focusOrigin?: () => { restore(): void } | null;
  /** How many near copies the library's check (Q-06) already found of this file; 0 when it has not run. Never starts the check. */
  readonly nearCopies?: (entry: IndexEntry) => number | Promise<number>;
  /** What a transform's preview runs on: the selection, else the document's first characters (read only); null when there is none. */
  readonly transformInput?: () => Promise<{ readonly text: string; readonly scope: 'selection' | 'document' } | null>;
}

/** Where a chosen document opens: in the focused pane (`'here'`) or the other one (`'split'`, D-07). */
export type PaletteTarget = 'here' | 'split';

export interface PaletteController {
  readonly session: PaletteSession;
  /**
   * Summons the palette; with `query` (such as `'>'`), opens it on that query (C-06, for C-13's menu).
   * With `target: 'split'` it is "open beside": the empty list is the recent documents not on screen, and
   * Enter opens the chosen one in the other pane (D-07).
   */
  open(query?: string, opts?: { target?: PaletteTarget }): void;
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
  suggestedFn: () => readonly Command[],
  currentPath: string | null,
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
      suggested: suggestedFn(),
    };
  }
  const trimmed = query.trim();
  let folded = 0;
  // `@` and `#` list headings: the section toggle and the row limit of a file list do not apply (W-13).
  const sections = sectionQuery(trimmed);
  const hits = paletteResults(trimmed, entries, session, {
    prepared,
    limit: sections === null ? 50 : SECTION_LIMIT,
    rootRank,
    fold: fold && { ...fold, folded: (copies) => (folded = copies) },
    currentPath,
  });
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

async function renderPath(deps: PaletteDeps, path: string, byteOffset?: number, onLanded?: () => void): Promise<void> {
  await deps.openDocument(path, byteOffset, onLanded);
  deps.setCurrentPath(path);
}

function injectPaletteStyles(doc: Document): void {
  if (doc.getElementById('marxy-palette-style')) return;
  // Lengths are ratios of the chrome size (13 px), as in base.css: the reader's chrome_size scales them (W-04).
  adoptRuntimeSheet(doc, 'marxy-palette-style', `
    #marxy-palette {
      margin: 11vh auto 0;
      padding: 0;
      border-color: var(--marxy-color-rule-strong);
      width: min(860px, calc(100vw - 2rem));
      overflow: hidden;
    }
    #marxy-palette[open] {
      display: flex;
      flex-direction: column;
      max-height: min(70vh, calc(100vh - 11vh - 1rem));
    }
    #marxy-palette::backdrop { background: rgb(0 0 0 / 25%); }
    /* The container the preview column asks about: a narrow palette has no column (W-13). */
    #marxy-palette { container: marxy-palette / inline-size; }
    #marxy-palette .marxy-palette-field {
      display: flex;
      align-items: center;
      gap: calc(var(--marxy-size-chrome) * 10 / 13);
      padding: 0 calc(var(--marxy-size-chrome) * 14 / 13);
      flex: none;
      min-height: calc(var(--marxy-size-chrome) * 51 / 13);
      border-bottom: 1px solid var(--marxy-color-edge);
    }
    #marxy-palette .marxy-palette-query {
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
      border: 0;
      padding: calc(var(--marxy-size-chrome) * 12 / 13) calc(var(--marxy-size-chrome) * 6 / 13);
      font: inherit;
      font-size: calc(var(--marxy-size-chrome) * 17 / 13);
      background: transparent;
      color: inherit;
    }
    #marxy-palette .marxy-palette-query::placeholder { color: var(--marxy-color-text-secondary); }
    /* One focus frame (F-97): the ring is the field's own, drawn inside its border; the query inside draws none. */
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
    #marxy-palette .marxy-palette-esc:focus-visible,
    #marxy-palette .marxy-palette-mode:focus-visible { outline: 2px solid var(--marxy-color-accent); outline-offset: -2px; }
    #marxy-palette .marxy-palette-modes {
      flex: none;
      display: flex;
      gap: calc(var(--marxy-size-chrome) * 4 / 13);
      padding: calc(var(--marxy-size-chrome) * 7 / 13) calc(var(--marxy-size-chrome) * 12 / 13);
      border-bottom: 1px solid var(--marxy-color-rule);
      overflow-x: auto;
    }
    #marxy-palette .marxy-palette-mode {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--marxy-size-chrome) * 5 / 13);
      height: calc(var(--marxy-size-chrome) * 24 / 13);
      padding: 0 calc(var(--marxy-size-chrome) * 9 / 13);
      border: 1px solid var(--marxy-color-rule-strong);
      border-radius: calc(var(--marxy-size-chrome) * 12 / 13);
      background: transparent;
      color: var(--marxy-color-text-secondary);
      font: inherit;
      font-size: 0.95em;
      white-space: nowrap;
      cursor: default;
    }
    #marxy-palette .marxy-palette-mode[aria-pressed="true"] { background: var(--marxy-color-accent-wash); border-color: transparent; color: var(--marxy-color-text); }
    #marxy-palette .marxy-palette-mode-prefix { font-size: 0.9em; }
    /* The preview is a second column when the palette is wide enough (W-13): the mock's 460 / 399 split. It is part of
       the sheet, which overlays the page: nothing under the reader moves (ADR-0058, F-45). */
    /* The body is the one row that gives: it takes what the field, chips and footer leave, never less than three result
       rows, and its results and preview scroll inside it, so nothing in it is drawn over the footer (F-97). */
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
    /* Two lines in the palette alone (Q16); menus keep the 28 px row of base.css. */
    #marxy-palette .marxy-palette-row {
      min-height: round(calc(var(--marxy-size-chrome) * 46 / 13), 1px);
      border-radius: calc(var(--marxy-size-chrome) * 7 / 13);
    }
    #marxy-palette .marxy-palette-row.marxy-palette-hit {
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      gap: 0;
    }
    #marxy-palette .marxy-palette-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    #marxy-palette .marxy-palette-title,
    #marxy-palette .marxy-palette-sub {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #marxy-palette .marxy-palette-sub { color: var(--marxy-color-text-secondary); font-size: 0.85em; }
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
      padding: calc(var(--marxy-size-chrome) * 8 / 13) calc(var(--marxy-size-chrome) * 10 / 13) calc(var(--marxy-size-chrome) * 4 / 13);
      font-size: 0.85em;
      font-weight: 650;
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

/** Modes the chips offer. `prefix` is what the query starts with; Headings is the list section, not a prefix. */
interface ModeChip {
  readonly label: string;
  readonly prefix: '' | '>' | '/' | null;
  readonly headings?: true;
}
const MODE_CHIPS: readonly ModeChip[] = [
  { label: 'Everything', prefix: '' },
  { label: 'Commands', prefix: '>' },
  { label: 'Headings', prefix: null, headings: true },
  { label: 'Content', prefix: '/' },
];

const PROMPT = 'Search files, or type > for commands, / for content';

type FooterMode = 'files' | 'commands' | 'content';

/** The footer's hints for the active mode: the chord labels come from the registry spellings, never retyped. */
function fillFooter(foot: HTMLElement, doc: PaletteOwnerDocument, mac: boolean, mode: FooterMode): void {
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
  const move = hint(['\u2191', '\u2193'], 'move');
  const items =
    mode === 'commands'
      ? [move, hint([chord('Enter')], 'run'), hint([chord('Mod+/')], 'transforms', true), hint([chord('Mod+Shift+P')], 'commands')]
      : mode === 'content'
        ? [move, hint([chord('Enter')], 'open'), hint([chord('Mod+Enter')], 'open beside')]
        : [
            move,
            hint([chord('Enter')], 'open'),
            hint([chord('Mod+Enter')], 'open beside'),
            hint([chord('Mod+.')], 'pin'),
            hint([chord('Tab')], 'headings'),
            hint(['@'], 'sections'),
            hint([chord('Mod+Shift+P')], 'commands', true),
            hint([chord('Mod+/')], 'transforms'),
          ];
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
  chips: readonly HTMLButtonElement[];
  aside: HTMLElement;
} {
  const found = () => ({
    aside: dialog.querySelector('.marxy-palette-aside') as HTMLElement,
    input: dialog.querySelector('.marxy-palette-query') as HTMLInputElement,
    list: dialog.querySelector('.marxy-palette-results') as HTMLOListElement,
    notice: dialog.querySelector('.marxy-palette-notice') as HTMLParagraphElement,
    esc: dialog.querySelector('.marxy-palette-esc') as HTMLButtonElement,
    chips: [...dialog.querySelectorAll('.marxy-palette-mode')] as HTMLButtonElement[],
  });
  if (dialog.querySelector('.marxy-palette-query')) return found();
  dialog.classList.add('marxy-surface', 'marxy-surface-md');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Palette');
  const mac = isMacPlatform();
  const doc = owner as Document;
  const field = owner.createElement('div') as HTMLDivElement;
  field.className = 'marxy-palette-field';
  const search = toolbarIconElement(doc, 'find');
  search.classList.add('marxy-palette-glyph');
  const input = owner.createElement('input') as HTMLInputElement;
  input.className = 'marxy-palette-query';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Search files, commands and content');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'marxy-palette-listbox');
  input.placeholder = PROMPT;
  input.autocomplete = 'off';
  input.spellcheck = false;
  // A real button: the pointer's way to Esc. Out of the tab order, because Tab inside the field switches the
  // list section and Esc is the keyboard's own way to close.
  const esc = owner.createElement('button') as HTMLButtonElement;
  esc.type = 'button';
  esc.className = 'marxy-palette-esc';
  esc.setAttribute('aria-label', 'Close palette');
  esc.tabIndex = -1;
  esc.textContent = 'esc';
  field.append(search, input, esc);
  const modes = owner.createElement('div') as HTMLDivElement;
  modes.className = 'marxy-palette-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Search mode');
  for (const mode of MODE_CHIPS) {
    const chip = owner.createElement('button') as HTMLButtonElement;
    chip.type = 'button';
    chip.className = 'marxy-palette-mode';
    chip.tabIndex = -1;
    chip.setAttribute('aria-pressed', 'false');
    chip.append(mode.label);
    if (mode.prefix) {
      const prefix = owner.createElement('span') as HTMLSpanElement;
      prefix.className = 'marxy-palette-mode-prefix';
      prefix.setAttribute('aria-hidden', 'true');
      prefix.textContent = mode.prefix;
      chip.append(prefix);
    }
    modes.appendChild(chip);
  }
  const body = owner.createElement('div') as HTMLDivElement;
  body.className = 'marxy-palette-body';
  const list = owner.createElement('ol') as HTMLOListElement;
  list.className = 'marxy-palette-results';
  list.id = 'marxy-palette-listbox';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  // The preview of the highlighted row (W-13): drawn beside the list when the palette is wide enough, empty otherwise.
  const aside = owner.createElement('aside') as HTMLElement;
  aside.className = 'marxy-palette-aside';
  aside.setAttribute('aria-label', 'Preview');
  aside.setAttribute('aria-live', 'polite');
  body.append(list, aside);
  const notice = owner.createElement('p') as HTMLParagraphElement;
  notice.className = 'marxy-palette-notice';
  notice.hidden = true;
  const foot = owner.createElement('div') as HTMLElement;
  fillFooter(foot, owner, mac, 'files');
  dialog.replaceChildren(field, modes, body, notice, foot);
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
 * The chords name the selection's own default verbs, from the written tables (ADR-0054). The selection
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

/** The glyph each command group leads its rows with: U-03's toolbar set, and K-18's document icon for File. */
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
  if (spec !== undefined) {
    const key = doc.createElement('span') as HTMLSpanElement;
    key.className = 'marxy-palette-key marxy-menu-key';
    key.textContent = keyLabel(spec, isMacPlatform());
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

/** What a document row says besides its title: its age and whether it changed since it was read. */
interface RowDecor {
  readonly age: (hit: IndexHit) => string | undefined;
  readonly changed: (hit: IndexHit) => boolean;
  /** An `@` or `#` list (W-13): a row leads with its heading and names its document under it. */
  readonly headingFirst: () => boolean;
}

const SECTION_LABELS: Record<EmptySectionKind, string> = {
  pinned: 'Pinned',
  changed: 'Changed since you read',
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
  const icon = kindIconElement(doc, kind, kind === 'code' ? langOfPath(hit.entry.path) : undefined);
  // The title over its folder (U-04): two lines at the palette's 46 px.
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
  // The document is named under its heading, with the folder it is in.
  sub.textContent = sectionRow ? (folder === '' ? hit.entry.title : `${hit.entry.title} · ${folder}`) : folder;
  text.append(title, sub);
  if (age === undefined) {
    row.replaceChildren(icon, text);
    row.removeAttribute('aria-label');
  } else {
    row.replaceChildren(icon, text);
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
      `${label}, ${spokenAge(age)}${decor.changed(hit) ? ', changed since you read' : ''}`,
    );
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

/**
 * The empty phase: a header before each section, then its rows, then the suggested commands. Headers are
 * not options. `selected` counts rows across all of them.
 */
function paintEmptyRows(
  list: HTMLOListElement,
  sections: readonly EmptySection[],
  suggested: readonly Command[],
  selected: number,
  decor: RowDecor,
): void {
  const doc = ownerDocumentOf(list);
  const next = fragmentOf(doc);
  let index = 0;
  let n = 0;
  for (const section of sections) {
    const shell = groupShell(doc, SECTION_LABELS[section.kind], n++);
    for (const hit of section.hits) shell.rows.appendChild(documentRow(doc, hit, decor, index++ === selected));
    next.appendChild(shell.group);
  }
  if (suggested.length > 0) {
    const shell = groupShell(doc, 'Suggested', n++);
    const { copyId } = selectionChords();
    for (const cmd of suggested) shell.rows.appendChild(commandRow(doc, cmd, index++ === selected, copyId));
    next.appendChild(shell.group);
  }
  list.replaceChildren(next);
}

/** `text` with each flagged character named (`U+202E`) in place of itself, for a label a screen reader speaks. */
function namedInvisibles(text: string): string {
  return invisibleSegments(text, { inCode: false, sourceStart: 1 })
    .map((seg) =>
      seg.kind === 'text' ? seg.value : seg.kind === 'tag-run' ? ` tag ×${seg.count} ` : ` U+${invisibleHexLabel(seg.cp)} `)
    .join('');
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
    row.className = 'marxy-palette-row marxy-menu-row marxy-palette-hit';
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
    // Bidi controls and zero-width characters are marked, never painted raw (commitment 4). The whole
    // preview is segmented once and then cut, so a joiner at the match's edge is judged with its neighbours.
    const [before, match, after] = splitSegments(invisibleSegments(hit.preview, { inCode: false, sourceStart: 1 }), start, end);
    appendInvisibleSegments(preview, before);
    appendInvisibleSegments(mark, match);
    preview.append(mark);
    appendInvisibleSegments(preview, after);
    row.append(head, preview);
    row.setAttribute('aria-label', `${titleOf(hit.path)}, line ${hit.line}: ${namedInvisibles(hit.preview)}`);
    markSelected(row, i === selected);
    next.appendChild(row);
  }
  list.replaceChildren(next);
}

function paintRows(
  list: HTMLOListElement,
  hits: readonly IndexHit[],
  selected: number,
  decor: RowDecor,
  label: string,
): void {
  const doc = ownerDocumentOf(list);
  const keyed = new Map<string, HTMLLIElement>();
  for (const child of list.querySelectorAll('li[data-row-key]')) {
    if (child instanceof HTMLLIElement && child.dataset.rowKey) keyed.set(child.dataset.rowKey, child);
  }
  const next = fragmentOf(doc);
  if (hits.length > 0) {
    // One group, named for what the rows are; a row already on screen is patched, not rebuilt (C-04).
    const shell = groupShell(doc, label, 0);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]!;
      const key = `${hit.entry.path}:${hit.heading ?? 'doc'}`;
      shell.rows.appendChild(documentRow(doc, hit, decor, i === selected, keyed.get(key)));
    }
    next.appendChild(shell.group);
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
  const { input, list, notice, esc, chips, aside } = ensurePaletteStructure(deps.dialog, document);
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
    queryPalette(text, section, feed.entries(), session, feed.prepared(), feed.rootRank(), foldCopies(), feed.notice(), emptySections, contentState, suggested, deps.getCurrentPath());
  const decor: RowDecor = {
    // Empty: every row has its age. Typed: only a document in a watched root does.
    age: (hit) =>
      model.phase === 'empty' || watched(hit.entry.root)
        ? relativeAge(model.phase === 'empty' ? emptyNow : now(), hit.entry.mtimeMs) || undefined
        : undefined,
    changed: (hit) =>
      watched(hit.entry.root) && changedSinceRead(hit.entry, baselineMs(hit.entry.root), now()),
    headingFirst: () => model.sectionScope !== undefined,
  };
  const rowCountOf = (m: PaletteModel): number =>
    m.phase === 'operations'
      ? m.operationCommands.length
      : m.phase === 'content'
        ? (m.contentHits?.length ?? 0)
        : m.hits.length + (m.suggested?.length ?? 0);
  // W-13: the preview column follows the highlighted row, after a pause. Opening a preview reads a file's first
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
    let head: Uint8Array | null;
    try {
      head = await headOf(entry);
    } catch (err) {
      return { type: 'file', title: entry.title, chips: [], notice: `Could not read this file: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (heading !== undefined) return sectionPreview(entry, heading, head);
    let copies = 0;
    try {
      copies = (await deps.nearCopies?.(entry)) ?? 0;
    } catch {
      copies = 0;
    }
    return filePreview(entry, head, copies);
  };
  const loadCommand = async (cmd: Command): Promise<PreviewData> => {
    const { copyId } = selectionChords();
    const spec = cmd.key ?? (cmd.id === copyId ? 'Mod+C' : undefined);
    const plain = commandPreview(cmd, paletteGroupOf(cmd), spec === undefined ? undefined : keyLabel(spec, isMacPlatform()));
    const prefix = 'transform.run.';
    if (cmd.id.startsWith(prefix) && deps.transformInput !== undefined) {
      const input = await deps.transformInput().catch(() => null);
      const result = input === null ? null : transformPreview(cmd.id.slice(prefix.length), input);
      if (result !== null) return result;
    }
    return plain;
  };
  /** The highlighted row's preview: a key naming what it shows (the same key, the same preview) and how to make it. */
  const previewTarget = (): { key: string; load: () => Promise<PreviewData> } | null => {
    if (!open) return null;
    let entry: IndexEntry | undefined;
    let heading: number | undefined;
    let command: Command | undefined;
    if (model.phase === 'operations') command = model.operationCommands[selected];
    else if (model.phase === 'content') {
      const found = model.contentHits?.[selected];
      entry = found === undefined ? undefined : entryOf(found.path);
    } else {
      const hit = model.hits[selected];
      if (hit !== undefined) {
        entry = hit.entry;
        heading = hit.heading;
      } else command = suggestedAt(selected);
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
    show: (data) => drawPreview(aside, data),
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
    // Asked only when the pause ends: a palette too narrow for the column (it is not drawn) reads nothing.
    follower.follow(target.key, () => (aside.getClientRects().length === 0 ? Promise.reject(new Error('no column')) : target.load()));
  };
  const paintModel = () => {
    if (model.phase === 'operations') paintOperationRows(list, model.operationCommands, selected);
    else if (model.phase === 'content') paintContentRows(list, model.contentHits ?? [], titleOf, selected);
    else paintDocuments();
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
  /** Which chip is on: the prefix the query starts with, or the Headings section. */
  let footerMode: FooterMode = 'files';
  const syncChips = () => {
    const mode: FooterMode = model.phase === 'operations' ? 'commands' : model.phase === 'content' ? 'content' : 'files';
    const foot = deps.dialog.querySelector('.marxy-palette-foot');
    if (mode !== footerMode && foot instanceof HTMLElement) {
      footerMode = mode;
      fillFooter(foot, document, isMacPlatform(), mode);
    }
    const prefix = model.phase === 'operations' ? '>' : model.phase === 'content' ? '/' : '';
    MODE_CHIPS.forEach((mode, i) => {
      const on = mode.headings ? prefix === '' && section === 'headings' : mode.prefix === prefix && !(prefix === '' && section === 'headings');
      chips[i]?.setAttribute('aria-pressed', String(on));
    });
  };
  const paintDocuments = () => {
    if (model.phase === 'empty' && model.sections !== undefined) {
      paintEmptyRows(list, model.sections, model.suggested ?? [], selected, decor);
    } else {
      paintRows(
        list,
        model.hits,
        selected,
        decor,
        model.sectionScope === 'everywhere' ? 'Sections everywhere' : model.sectionScope === 'here' ? 'Headings here' : section === 'headings' ? 'Headings' : 'Files',
      );
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
    syncChips();
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
    // With two panes, focus goes back to the one the palette was summoned from (D-06's focusOrigin); an
    // open beside moves it on once the document is on screen.
    origin?.restore();
    origin = null;
  };

  // Every rebuild of what the palette searches repaints it: a new walk, a folder added or dropped.
  feed.subscribe(() => repaint());

  deps.dialog.addEventListener('close', () => {
    // Native cancel (Esc with focus off the input) closes the dialog without going through dismiss.
    // (Reads the live state: a stale close event must not shut a palette summoned since.)
    if (open && !deps.dialog.open) dismiss();
  });

  /** Runs a command row; a row that opens a list (U-04) turns the query into that list instead of closing. */
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
  /** The row at `index` in the empty phase's suggested group, or undefined. */
  const suggestedAt = (index: number): Command | undefined =>
    model.phase === 'empty' ? model.suggested?.[index - model.hits.length] : undefined;

  list.addEventListener('click', (event) => {
    const eventTarget = event.target as { closest?: (s: string) => Element | null } | null;
    const row = eventTarget?.closest?.('.marxy-palette-row') as HTMLElement | null | undefined;
    if (!row) return;
    // Group labels sit between rows: count rows only.
    const index = Array.prototype.indexOf.call(list.querySelectorAll('.marxy-palette-row'), row);
    if (index < 0) return;
    if (model.phase === 'operations') {
      runCommandRow(model.operationCommands[index]);
    } else if (model.phase === 'content') {
      void activateContentHit(model.contentHits?.[index], target === 'split');
    } else if (suggestedAt(index) !== undefined) {
      runCommandRow(suggestedAt(index));
    } else {
      void activateHit(model.hits[index], target === 'split');
    }
  });

  esc.addEventListener('click', () => dismiss());
  chips.forEach((chip, i) => {
    chip.addEventListener('click', () => {
      const mode = MODE_CHIPS[i]!;
      // The prefix is swapped and the words after it are kept (the mock: "clicking swaps the prefix and keeps the query").
      const rest = input.value.replace(/^\s*[>/]\s?/, '');
      if (mode.headings) {
        section = 'headings';
        input.value = rest;
      } else {
        section = 'documents';
        input.value = `${mode.prefix}${rest}`;
      }
      selected = 0;
      syncContent();
      repaint();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

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
  /** Open the file at the match and select the block that holds it (C-17). */
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
      if (model.phase === 'operations') {
        runCommandRow(model.operationCommands[selected]);
      } else if (model.phase === 'content') {
        void activateContentHit(model.contentHits?.[selected], target === 'split' || isMod(event));
      } else if (suggestedAt(selected) !== undefined) {
        runCommandRow(suggestedAt(selected));
      } else {
        void activateHit(model.hits[selected], target === 'split' || isMod(event));
      }
    }
  });

  // The summoning chords (W-19): `Mod+P` and `Mod+K` open the palette on documents, `Mod+Shift+P` and `Mod+/`
  // open it on commands (`>`; `Mod+/` on `>Transform`, W-21). Each closes it when it is already open on what the chord opens. On `window` in
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
        if (open) dismiss();
        else summon();
      } else {
        // Mod+/ opens on the transforms (`>Transform`); Mod+Shift+P on every command (`>`).
        const query = key === '/' ? '>Transform' : '>';
        if (open && input.value === query) dismiss();
        else summon(query);
      }
    },
    true,
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
  const panes = typeof handle.panes === 'function' ? handle.panes() : null;
  let facts: { readonly run: unknown; readonly threshold: number; readonly byPath: ReadonlyMap<string, { readonly copies: readonly unknown[] }> } | undefined;
  const controller = mountPaletteApp({
    shell: handle.shell,
    article,
    // The focused pane's scroller, asked each time: it moves with focus and with a split (D-05, D-07).
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
    // Looked up on each call: the service's answers move as roots are walked and watched.
    isWatched: (root) => handle.index.isWatched(root),
    baselineMs: (root) => handle.index.baselineMs(root),
    checkoutKey: (path) => handle.index.checkoutKey(path),
    onSummon: () => handle.index.revalidate(),
    openBeside: (path, at, onLanded) => handle.open(path, { at, onLanded, target: 'other' }),
    visiblePaths: () => (panes?.panes ?? []).map((pane) => pane.path()).filter((path): path is string => path !== null),
    splitRefusal: () => (panes ? splitRefusal(panes) : null),
    focusOrigin: () => (panes && panes.panes.length > 1 ? focusOrigin(panes) : null),
    nearCopies: async (entry) => {
      // What the library's check already found (Q-06); the palette never starts it.
      const checks = checksFor(handle);
      const run = checks.latestDup();
      if (run === null) return 0;
      if (facts?.run !== run || facts.threshold !== checks.threshold) facts = { run, threshold: checks.threshold, byPath: checks.dupFacts(run) };
      return facts.byPath.get(entry.path)?.copies.length ?? 0;
    },
    transformInput: async () => transformPreviewInput(buildAppContext()),
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
