// The frame as the rest of the app sees it: commands, the left section's panels and the cards go through this.
import type { AppPane } from '../pane/index.ts';
import type { Pane } from '../pane/pane-set.ts';
import type { LeftView } from '../left/frame.ts';
import type { CardId, FrameStore, Placement } from './state.ts';
import type { WindowTabs } from './window-tabs.ts';
import type { FullScreen } from './full-screen.ts';

export type FramePane = Pane<AppPane>;

/** The window's one row of tabs (tab-row.ts): every open document once; the panes are views onto it. */
export interface TabRow {
  readonly el: HTMLElement;
  readonly model: WindowTabs;
  /** Shows tab `id` in the focused pane (or `slot`), and with Pairs its partner beside; `alone` shows it without. */
  show(id: number, opts?: { readonly slot?: number; readonly alone?: boolean }): Promise<void>;
  /** Closes tab `id`: each pane showing it moves to its neighbour, and a pane left with nothing of its own closes. */
  close(id: number): Promise<void>;
  /** Opens the newest closed tab again in the focused pane, where it was in the row; one that no longer opens is passed over. */
  reopen(): Promise<void>;
  /** The next or previous tab in the row, wrapping, shown in the focused pane. */
  cycle(dir: -1 | 1): Promise<void>;
  /** The pane at `slot`'s back or forward. */
  step(slot: number, dir: -1 | 1): Promise<void>;
  /** `pane` landed a document (or the same one again): the row takes it in. */
  note(pane: FramePane): void;
  render(): void;
  destroy(): void;
}

/** A pane's head: the address of what the pane shows, and the kind's tools. */
export interface Head {
  readonly el: HTMLElement;
  readonly pane: FramePane;
  back(): Promise<void>;
  forward(): Promise<void>;
  render(): void;
  destroy(): void;
}

export interface Frame {
  readonly store: FrameStore;
  readonly tabs: TabRow;
  /** The left section: the rail of panels and the drawer (left/frame.ts). */
  readonly left: LeftView;
  placement(): Placement;
  readonly folded: boolean;
  readonly fullScreen: FullScreen;
  fold(): void;
  unfold(): void;
  toggleFold(): void;
  /** The keys go back to the page, and a drawer lying over it goes (a hosted branch's Escape). */
  closeDrawer(): void;
  /** Shows the panel that holds `card`'s content (Metadata, Outline or Links), or Metadata. */
  showPanel(opts?: { readonly card?: CardId }): void;
  headOf(pane: FramePane): Head | null;
  focusedHead(): Head | null;
  /** The finder, with `query` typed into it. */
  openFinder(query?: string): void;
  /** The focused pane's document changed, or focus moved, or the frame did. */
  onChange(cb: () => void): () => void;
  destroy(): void;
}
