// The left section's contract: what a panel registers, and what the frame
// gives it. Three builders write panels against this; change it only with the contract file.
import type { LeftPanelId } from '@marxy/core/src/layout/frame-storage.ts';
import type { AppHandle } from '../app-types.ts';
import type { Command } from '../commands/registry.ts';
import type { DocumentStore } from '../document/store.ts';
import type { IconName } from '../frame/icons.ts';
import type { FramePane } from '../frame/types.ts';

export type PanelId = LeftPanelId;
export type PaneView = FramePane;

/** What the drawer can show besides a panel: the branches kept until their slices (settings, clip). Look is the Studio. */
export type ExtraId = 'settings' | 'clip';

export interface HeadButton {
  /** A glyph or a short word, drawn when there is no icon. */
  readonly label: string;
  readonly icon?: IconName;
  readonly title: string;
  run(e: MouseEvent): void;
}

export interface PanelContext<S> {
  readonly handle: AppHandle;
  /** The focused pane and its open document; null when it shows an app page or nothing. */
  pane(): PaneView | null;
  doc(): { readonly path: string; readonly store: DocumentStore } | null;
  /** The panel's own state, made once by `init`, kept while the window lives. Never persisted by the frame. */
  readonly st: S;
  redraw(): void;
  /** Runs the panel's `light` (its marker moved, nothing rebuilt), when the panel is the one shown. */
  light(): void;
  /** Changes whenever any open document's bytes or reading change: key caches by it. */
  rev(): number;
  /**
   * The panel cursor goes to the row keyed `key` once it is drawn, and the page follows it as on a key move: what `take`
   * (or a draw) uses to keep the Line's result under the cursor. The keys go to the rows, not the field.
   */
  cursorTo(key: string): void;
}

export interface PanelDef<S = unknown> {
  readonly id: PanelId;
  readonly name: string;
  /** The panel has a field in `top`; showing the panel with an argument focuses it. */
  readonly field?: boolean;
  /** The foot's words while the keys are not in the panel. */
  readonly rest?: string;
  init?(): S;
  /** Grey text beside the name in the head: what the panel is about now (a file name, a folder, a count). */
  subject(ctx: PanelContext<S>): string;
  /** At most two icon buttons at the head's right. */
  buttons?(ctx: PanelContext<S>): readonly HeadButton[];
  /** Called by `left.show(id, arg)`: a query from the Line, a path to reveal. */
  take?(ctx: PanelContext<S>, arg: unknown): void;
  /** Fill `body` (scrolls) and `top` (does not; the field goes here). Runs on every redraw: cheap or cached. */
  render(ctx: PanelContext<S>, body: HTMLElement, top: HTMLElement): void;
  /** Cheap update when the page scrolls or the cursor moves: move a marker, never rebuild. */
  light?(ctx: PanelContext<S>, body: HTMLElement): void;
  /** Commands the panel adds to the registry (so the Line lists them). */
  commands?(): readonly Command[];
  /**
   * A mark on the panel's rail button for state the reader made (a query's matches, staged changes), never for what a file
   * merely holds. Read on every redraw and page change: only read what the panel already worked out.
   */
  badge?(ctx: PanelContext<S>): RailBadge | null;
}

export interface RailBadge {
  /** A small number; none draws a dot. */
  readonly text?: string;
  readonly tone?: 'accent' | 'faint' | 'warn';
  /** Joined to the button's accessible name: "Search, 12 matches". */
  readonly say: string;
}

export interface Left {
  register(def: PanelDef<any>): void;
  show(id: PanelId, arg?: unknown, focus?: boolean): void;
  shown(): PanelId | null;
  draw(): void;
}

/** A row's verb: the key as the shell writes it (`'c'`, `'O'`, `'~'`, `'Space'`, `'Alt+ArrowUp'`), its word, its act. */
export type Verb = readonly [bind: string, label: string, run: (e?: Event) => void];

/** The options of `ui.row`. */
export interface RowOptions {
  /** Unique in the panel and stable across redraws: the cursor is restored by it. Needed for any row that acts. */
  readonly k?: string;
  readonly d?: number;
  /** The twisty: '▸' or '▾' (drawn as a chevron), another glyph drawn as it is, or '' to keep its column. */
  readonly tw?: string;
  readonly nm?: string | Node;
  readonly small?: string;
  /** 0..1, a small bar. */
  readonly bar?: number;
  readonly pv?: string;
  readonly as?: string;
  /** `as` in the accent: a guess. */
  readonly g?: boolean;
  /** `as` in the error colour. */
  readonly red?: boolean;
  readonly n?: number | string;
  readonly pre?: Node | null;
  readonly post?: Node | null;
  readonly lines?: readonly (readonly [string, string?])[];
  /** Words among dir, sub, dim, sel, at, open, dirty. */
  readonly cls?: string;
  readonly title?: string;
  run?(e?: RowEvent): void;
  /** The verb bar's word for `run` (default "open"). */
  readonly go?: string;
  enter?(e?: Event): void;
  toggle?(e?: RowEvent): void;
  readonly open?: boolean;
  tick?(e?: Event): void;
  /** The cursor arrived by key: make the page follow. */
  at?(): void;
  verbs?(): readonly (Verb | null)[];
  /** The verb bar's name for the row (default: its text). */
  readonly what?: string;
}

/** What a row's act is told: whether it was asked for beside (Shift O, Ctrl or Cmd with a click). */
export interface RowEvent {
  readonly beside?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  /** A click's count: 2 for a double click. */
  readonly detail?: number;
}

/** A field's options; `name` keeps focus and caret through a redraw. */
export interface FieldOptions {
  readonly name: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly mono?: boolean;
  readonly lb?: string;
  readonly right?: Node | null;
  oninput?(v: string): void;
  onenter?(v: string, e: KeyboardEvent): void;
}
