// The Studio's contract: what the shell (studio.ts) gives each piece that stands around the
// canvas: the dock's tabs, the shelf, the why column, Compare, Fit and the specimen sheet. A piece is a function
// `mount(host, ctx) => cleanup`; it draws into `host`, reads the look through `ctx`, changes it only through `ctx`, and
// redraws what moves in `ctx.onPaint`.
import type { Look, LookContext, LookState, LookTweaks, Over, Resolved, Scheme } from '@marxy/theme';

/** What the canvas shows: the reader's own prose (or the essay), or a specimen of another kind of text. */
export type SpecimenKind = 'prose' | 'code' | 'data' | 'table' | 'log' | 'patch' | 'talk';
export type TabId = 'tone' | 'colours' | 'type' | 'page' | 'code' | 'adapts' | 'file';
export type Width = 'narrow' | 'column' | 'wide';

export interface StudioView {
  /** Day or night as the Studio shows it (a simulation: the reader's mode is not changed). */
  readonly scheme: Scheme;
  readonly width: Width;
  readonly kind: SpecimenKind;
  /** The specimen (every kind of text, one after another) in place of the single canvas. */
  readonly sheet: boolean;
  readonly compare: boolean;
  /** A look the pointer is over on the shelf: shown on the canvas without being set. */
  readonly hover: string | null;
  readonly tab: TabId;
  /** The language the Code tab shows on the canvas, or null for the kind's own specimen. */
  readonly lang: string | null;
}

/** A page of text in the Studio: a box with its own scroller, painted by `paint`. */
export interface Leaf {
  /** The outer box: tokens are painted on it; it is `width` px wide at its logical size. */
  readonly el: HTMLElement;
  /** The element that scrolls. */
  readonly scroller: HTMLElement;
  readonly article: HTMLElement;
  /** Resolves once the text (and its code colour) is in. */
  readonly ready: Promise<void>;
}

export interface StudioCtx {
  /** The Studio's own element (a modal dialog over the window). */
  readonly root: HTMLElement;
  readonly view: () => StudioView;
  /** Changes what the Studio shows (not the reader's settings) and repaints. */
  setView(patch: Partial<StudioView>): void;
  /** The look state as the store has it, with the live change not yet committed laid over the look being edited. */
  state(): LookState;
  /** The look being edited: the one the canvas's context resolves to (a rule may pick it). */
  editId(): string;
  /** That look, with the reader's changes and the live change. */
  look(): Look;
  /** The look's own value of `key`, before the reader's changes (a dial's double-click returns to it). */
  own<K extends keyof LookTweaks>(key: K): Look[K];
  /**
   * The look being edited as it was when the Studio opened (Compare's "before"): its id and the reader's changes then, and
   * `theme`, the theme's own values of the look's tokens when the theme painted the page then (before is the theme).
   */
  opened(): { readonly id: string; readonly tweaks: LookTweaks; readonly theme?: Readonly<Record<string, string>> };
  /** A dial moved: shown at once, written to the store a few times a second. */
  set<K extends keyof LookTweaks>(key: K, value: LookTweaks[K]): void;
  /** The reader's change to `key` taken back. */
  reset(key: keyof LookTweaks): void;
  /** Any other change to the state (a look set, a rule switched, a look saved): through the store, at once. */
  apply(next: LookState, opts?: { readonly mine?: string; readonly removed?: string }): void;
  /** The context the canvas is resolved in now, and the override it is painted with. */
  canvasContext(): LookContext;
  canvasOver(): Over;
  /** What the canvas is painted with now. */
  resolved(): Resolved;
  /** The canvas's logical width in px (520, its natural width, or 1,600). */
  logicalWidth(): number;
  /** Paints `el` with the look for `ctx` and `over` (tokens and the look's attributes), and says what it resolved. */
  paint(el: HTMLElement, ctx: LookContext, over?: Over): Resolved;
  /** A new page of `kind` (or of a language's specimen), `width` px wide at its logical size. */
  makeLeaf(kind: SpecimenKind, opts?: { readonly lang?: string; readonly short?: boolean | number; readonly width?: number }): Leaf;
  /** The context a page of `kind` is resolved in, at `width`. */
  contextOf(kind: SpecimenKind, width: number): LookContext;
  /** The canvas page shown now, or null (on the sheet, or under Fit). */
  canvas(): Leaf | null;
  /** The element the canvas (or the sheet) lives in: Compare and Fit draw inside it. */
  stage(): HTMLElement;
  /** Runs after every repaint, with the look as it now is. */
  onPaint(cb: () => void): () => void;
  /** Rebuilds the stage (a piece that changed what it holds). */
  rebuild(): void;
  /** The measure rule on the canvas's column edge, showing a count while a dial is held; null hides it. */
  showMeasure(chars: number | null): void;
  /** Says something short in the Studio's own line (a copy done, a look saved). */
  say(text: string): void;
  /** Fit owns the keyboard and the canvas while it runs: Esc is offered to it first. */
  setKeyOwner(owner: ((e: KeyboardEvent) => boolean) | null): void;
  close(): void;
}

/** A piece of the Studio: draws into `host`, returns what undoes it. */
export type StudioPiece = (host: HTMLElement, ctx: StudioCtx) => () => void;
