// The seam for files that are not a text buffer: a pane shows a document's text views, or a page of
// the app's own drawn by a viewer. A binary file has no store at all: its viewer draws Read (the image page, or the file
// card with the bytes beside it) and Source (the hex view). A text file whose Read is a page of its own (an SVG; later a
// notebook) keeps its store and Source's editor, and its viewer draws Read only. Archives and PDFs plug in as
// further viewers: a `PaneViewer`, a row's `viewer` in core's registry, and a case in `createViewer`.
import type { CardGroup, CardId } from '@marxy/core/src/layout/frame-storage.ts';
import type { CardDef } from '../frame/cards/types.ts';

export type ViewMode = 'rendered' | 'source';

/** What the pane's head says of how the file is shown: a guess in blue, as 19's guess mark is, or a tier in grey. */
export interface HeadSay {
  readonly text: string;
  /** `mine`: a reading the reader chose, said with `how` ("your choice") as 19 says any choice. */
  readonly tone: 'guess' | 'tier' | 'mine';
  readonly how?: string;
  /** The head's tooltip: why it says so, and that Metadata says more. */
  readonly title: string;
}

/** The hex view's place: the byte picked, and the byte at the top of its screen. */
export interface HexPlace {
  readonly selected: number | null;
  readonly top: number | null;
}

/** A viewer's place, carried to the page made from the file as it is now. Nothing of it is kept past the tab. */
export interface ViewerPlace {
  readonly hex?: HexPlace;
  /** The page's own scroll (the image's stage, the archive's tree). */
  readonly scroll?: { readonly top: number; readonly left: number };
}

export interface PaneViewer {
  readonly path: string;
  /** The viewer's kind, on the pane as `data-marxy-viewer`. */
  readonly kind: 'card' | 'image' | 'archive' | 'pdf' | 'sqlite' | 'sheet' | 'mail' | 'page' | 'font' | 'media' | 'office' | 'book';
  /** The panel's card choices are kept for this group of kinds. */
  readonly group: CardGroup;
  /** The file holds a secret (a private key): no byte of it is drawn in Read, the Reading, Facts or Metadata cards; Source still shows the file. */
  readonly bytesHidden?: boolean;
  /** The file has no text store: the viewer draws both modes, and Source is the hex view. */
  readonly binary: boolean;
  /** Whether the viewer draws `mode`; a mode it does not draw is the text views'. */
  owns(mode: ViewMode): boolean;
  /** Draws `mode` into `host` (the pane's viewer mount, shown). */
  show(mode: ViewMode, host: HTMLElement): void;
  /** The mount is hidden: Source's editor shows instead. */
  hide(): void;
  /** Where the reader is, for the page made again when the file changes on disk (`ViewerInputs.place`). */
  place?(): ViewerPlace;
  /** Picks byte `at` in the hex view and scrolls to it; returns the mode whose page shows the hex view. */
  land?(at: number): ViewMode;
  /** The store's bytes changed (an SVG edited in Source, or reloaded): Read draws them again when it next shows. */
  refresh?(): void;
  /** The panel's standing cards for this file in `mode`, by slot: the fourth card is Image, the metadata slot EXIF. */
  cards(mode: ViewMode): Partial<Record<CardId, CardDef>>;
  /** Cards that last while something applies (a byte picked in the hex view), drawn above the standing ones. */
  passing(mode: ViewMode): readonly CardDef[];
  /** What the head says, or null for a quiet head (no reading is not a guess). */
  headSay(): HeadSay | null;
  /** A key while the pane has focus; true when the viewer took it. */
  key(e: KeyboardEvent, mode: ViewMode): boolean;
  /** A key that names what the panel would draw, so it redraws when it changes. */
  panelKey(): string;
  /** Find in the page, for a viewer that holds text of its own (a PDF's text layer): Rendered find asks it in `mode`. */
  find?(mode: ViewMode): ViewerFind | null;
  /** What Export may write of the file in `mode`, for a viewer that offers it; none means Export is the text views'. */
  exports?(mode: ViewMode): readonly ViewerExport[];
  /** The page's parts in `mode`, for the cursor; null when the page has none to walk now. */
  parts?(mode: ViewMode): PartTree | null;
  /** The bytes floor: whether the file card and its bytes show in place of the page, and the switch (the Reading card's). */
  floor?: { on(): boolean; set(on: boolean): void };
  /** Reveal (`Shift X`) on a page of the viewer's own: what Read left out put back (an archive's file as stored). */
  reveal?: { on(): boolean; set(on: boolean): void };
  /** The Line's `=` on a page of rows of its own (an archive's entries): kept in the view only, never written. */
  rows?: ViewerRows;
  /** A page with contents of its own (a book's): the Outline lists them, with the verbs that read; null while there are none. */
  outline?(): ViewerOutline | null;
  /** The crumbs after the file's name: the chain of contents entries the reading line is under, outermost first. */
  chain?(): readonly ViewerCrumb[];
  destroy(): void;
}

/** A page's own contents, as the Outline lists them: a book's chapters, read and never rearranged. */
export interface ViewerOutline {
  /** The field's word, "chapters": Filter chapters. */
  readonly word: string;
  readonly rows: readonly ViewerOutlineRow[];
  /** The page folded to the rows of a depth (`1` the top level), or `all` unfolded; null when it is neither. */
  level(): string | null;
  setLevel(level: string): void;
}

export interface ViewerOutlineRow {
  /** Stable while the page is not drawn again from other bytes. */
  readonly key: string;
  readonly text: string;
  /** 0 at the top level. */
  readonly depth: number;
  readonly words: number;
  /** Rows nest under it. */
  readonly kids: boolean;
  /** Its first element on the page, where the dot that follows the page is measured. */
  el(): HTMLElement | null;
  go(): void;
  /** Folds its part of the page, or unfolds it. */
  fold(): void;
  /** Its part of the page as the page's text holds it (`c`), and the words the notice says it was copied as. */
  copy(): { readonly text: string; readonly as: string };
}

/** One step of a viewer's crumbs, and the steps beside it its menu offers. */
export interface ViewerCrumb {
  readonly key: string;
  readonly text: string;
  beside(): readonly { readonly title: string; readonly here: boolean; go(): void }[];
}

/** Where a page of the app's own keeps the reader's place across launches, as a text document's is kept (positions.json). */
export interface ViewerMemory {
  /**
   * The place kept for this file, when the page's own bytes are `length` long and were made as `stamp` says (a place
   * kept in a page made otherwise, the book having changed, is dropped); read once the places file is.
   */
  stored(length: number, stamp: string): Promise<{ readonly byteOffset: number; readonly fraction: number } | null>;
  note(place: { readonly byteOffset: number; readonly fraction: number }, stamp: string): void;
}

/**
 * One part of a page: what the cursor rests on, the verb bar names and the verbs act on. Units
 * form an ordered tree: a row holds its cells, a page its blocks.
 */
export interface PartUnit {
  /** Stable while the page is not drawn again from other bytes: the cursor finds its unit again by it after a redraw. */
  readonly id: string;
  /** The bar's word for it: "row", "cell", "entry", "page", "glyph", "table", "chunk". */
  readonly label: string;
  /**
   * Its address as written after the file's name, which the bar puts before it: `:12–18`, `#page=3`, `#Summary!F5`,
   * `#readings/1042/height_m`, `#cell=7`, `#U+00E9`, `@0x0020`, `!/path` (an archive's entry).
   */
  readonly address: string;
  /** The byte of the file it starts at, where it owns a run of them: `\` lands Source there. */
  readonly at?: number;
  /** Its element on the page; a page drawn a window at a time (the hex view) brings it into view first. Null when it cannot. */
  el(): HTMLElement | null;
  /** The parts inside it, in order; none for a part with nothing to go into. */
  readonly children?: readonly PartUnit[];
  /** What `c` copies: the part as the file holds it (a row's cells joined by tabs, an entry's path, a hex row's bytes). */
  stored(): string | Promise<string>;
  /**
   * Its stored form drawn (`x`): the bytes at their offsets for a chunk, box or table, the record for a row. Null when it
   * drew itself in place (a text kind's lines, in the depths' x-ray box).
   */
  xray?(): HTMLElement | Promise<HTMLElement | null> | null;
  /** The part is itself a file (an archive entry, an attachment, an embedded image): opens it in a tab of its own, read-only. */
  open?(): void | Promise<void>;
}

/** A page's parts as the cursor walks them. A page that draws a window at a time makes its units as they are asked for. */
export interface PartTree {
  /** The parts at the top level, in order. */
  top(): readonly PartUnit[];
  /** `id`'s unit as the page is now, or null when it is gone. */
  find(id: string): PartUnit | null;
  /** The part to start on: the first at or below the reading line. */
  start(): PartUnit | null;
  /** The unit that holds `unit`, or null at the top. */
  parent(unit: PartUnit): PartUnit | null;
  /** `]` / `[`: the kind's outline stepped (a sheet, a table, a page); the unit it lands on, null at the edge. */
  step?(from: PartUnit | null, dir: 1 | -1): PartUnit | null | Promise<PartUnit | null>;
  /** True: nothing here is changed (a kind read from bytes, a file from inside another); the change verbs refuse. */
  readonly readOnly: boolean;
  /** For a page that draws a window at a time: the next or previous unit at `unit`'s depth, made as it is asked for. */
  sibling?(unit: PartUnit, dir: 1 | -1): PartUnit | null;
  /** For a page that draws a window at a time: the first or last unit, made as it is asked for. */
  edge?(edge: 'first' | 'last'): PartUnit | null;
  /**
   * For a page that draws a window at a time: it marks the cursor's units itself as it draws them (null: none), and the
   * cursor does not paint them; a redraw then never scrolls back to the cursor.
   */
  mark?(head: PartUnit | null, run: readonly PartUnit[]): void;
  /**
   * For a tree whose units' `el()` draws, scrolls or picks (a window of rows, a page brought near, a glyph that picks
   * itself): the unit's element as the page stands now, touching nothing. A click and a note's place ask this.
   */
  drawn?(unit: PartUnit): HTMLElement | null;
  /**
   * For a tree too big to walk on a click (a sheet's 2,000 rows of 100 cells): the deepest unit whose element holds
   * `target`, worked out from the element itself, or null.
   */
  at?(target: Element): PartUnit | null;
  /** `z` on a viewer's own folds (an archive's folder): folds or unfolds `unit`; false when it is not foldable. */
  fold?(unit: PartUnit): boolean;
}

/** A viewer's row filter, for the Line's `=`. */
export interface ViewerRows {
  /** Keeps the rows matching `query`; how many remain (0 when the query cannot be read, and nothing is filtered). */
  filter(query: string): number;
  /** Every row again. */
  clear(): void;
  /** The query kept now, or null when every row shows. */
  on(): string | null;
  /** What `filter` would leave, without filtering: its count of the whole, or the sentence for a query it cannot read. */
  test(query: string): { readonly shown: number; readonly total: number; readonly words: string } | { readonly error: string };
}

/** Find over a viewer's own text: matches counted as they are found, one of them current and in view. */
export interface ViewerFind {
  /** Finds `re` (global), or clears with null; `progress` hears the count as pages are read. Resolves the count. */
  run(re: RegExp | null, progress: (count: number) => void): Promise<number>;
  /** The first match at or below the top of the view, from which find starts. */
  first(): number;
  /** Makes match `i` current and brings it into view. */
  show(i: number): void;
  /** Every mark taken away. */
  clear(): void;
  /** Hears when the matches no longer stand for the page (the view's order changed); returns what stops it. */
  stale?(heard: () => void): () => void;
}

/** One thing Export may write of a viewed file: its name in the dialog, and its bytes when chosen. */
export interface ViewerExport {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  /** The extension its file is suggested with. */
  readonly extension: string;
  /** The bytes it writes, and what the dialog shows of them. */
  build(): Promise<{ readonly bytes: Uint8Array; readonly preview: string }>;
}
