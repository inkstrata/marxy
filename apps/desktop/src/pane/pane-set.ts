// The window's panes (D-01; ADR-0057): an ordered list of at most two columns, left to right, each a
// `section.marxy-pane` with its own view over a store. With one document there is one pane and the page
// is what it always was; a second pane exists only while two documents are shown side by side.
//
// What a pane shows is the composition root's (`PaneContent`: a view and the open path that reads,
// stores, shows, watches and titles a document in it); the set only creates, focuses, lays out and
// closes panes around it. Slot 0 is permanent: it is the window's first pane, and the selection, the
// reading persistence, the mode on <body> and the window scroller are bound to its view (Phase B left
// them so, and D-05, D-06 and D-11 move them per pane). Closing the left pane therefore shows the
// right pane's document in slot 0, at the right pane's place and through the same store, and removes
// slot 1: the survivor's article is `#doc` again without any element being renamed.

import { createPaneElement, type PaneParts, type Slot } from './dom.ts';
import type { OpenOptions } from '../document/open.ts';
import type { RenderedView } from '../view/rendered-view.ts';

export const MAX_PANES = 2;

/** What the composition root makes for each pane. */
export interface PaneContent {
  readonly view: RenderedView;
  /**
   * Opens `path` in this pane as `AppHandle.open` does (asking first over unsaved edits). Over unsaved
   * edits it resolves once the reader is asked, and `onLanded` waits for their choice.
   */
  open(path: string, opts?: OpenOptions): Promise<void>;
  /** Opens `path` in this pane without asking: the set has already asked `beforeReplace`. */
  replace(path: string, opts?: OpenOptions): Promise<void>;
  /** Source text typed in this pane and not yet in its store goes into it. */
  foldSource(): Promise<void>;
  /** The path shown, or null. */
  currentPath(): string | null;
  /** The view and its open path go, and the store is let go (the last view closes it). */
  destroy(): void;
}

export interface Pane<C extends PaneContent = PaneContent> {
  readonly slot: Slot;
  readonly host: HTMLElement;
  readonly article: HTMLElement;
  readonly parts: PaneParts;
  readonly view: RenderedView;
  readonly content: C;
  path(): string | null;
}

export type PaneChange<C extends PaneContent = PaneContent> = { readonly kind: 'open' | 'close' | 'focus' | 'ratio'; readonly pane?: Pane<C> };

export interface PaneSet<C extends PaneContent = PaneContent> {
  /** Length 1 or 2, left to right. */
  readonly panes: readonly Pane<C>[];
  readonly focused: Pane<C>;
  /** The left pane's share of the width; 0.5 by default. */
  readonly ratio: number;
  /**
   * Opens `path` in the focused pane, the other one (made when there is one pane, if `canSplit`
   * allows), or a slot. An occupied pane asks `beforeReplace` first. Resolves the pane, or null when
   * refused. `opts.onLanded`, the `open` change and (for a new pane) the `split_open` mark come once the
   * document is on screen in that pane: with the unsaved-edits prompt up, after the promise resolves, and
   * never when the reader dismisses it or the set refuses.
   */
  openIn(target: 'focused' | 'other' | Slot, path: string, opts?: OpenOptions): Promise<Pane<C> | null>;
  /**
   * Closes `pane`; false when refused (by `beforeReplace`), when it is the only one, or when it is the left
   * pane and the right one is empty or its Source text cannot go into its store.
   */
  close(pane: Pane<C>): Promise<boolean>;
  /** Moves `data-marxy-focus` to `pane`'s host alone and focuses it without scrolling. */
  focus(pane: Pane<C>): void;
  /** The grid's two columns as `ratio fr` and `1 - ratio fr`; callers clamp (D-02's `clampRatio`). */
  setRatio(ratio: number): void;
  /** `cb` runs when a second pane appears (at once if one is open); its cleanup runs when that pane goes. */
  onSplit(cb: (main: HTMLElement) => () => void): void;
  onChange(cb: (e: PaneChange<C>) => void): () => void;
  /** Asked before a pane's document is replaced or the pane closed (D-08 sets it); unset permits. */
  beforeReplace?: (pane: Pane<C>) => Promise<boolean>;
  /** Asked before a second pane is made (D-07 sets it); unset permits. */
  canSplit?: () => boolean;
  /** Every pane's content goes and the second pane's DOM with it (the app instance going). */
  destroy(): void;
}

export interface PaneSetDeps<C extends PaneContent> {
  /** The grid both panes sit in: `#marxy-main`. */
  readonly main: HTMLElement;
  /** The first pane's elements, adopted from the page (`adoptFirstPane`). */
  readonly first: PaneParts;
  /** The content of the pane at `slot`, over `parts`. */
  content(parts: PaneParts, slot: Slot): C;
  mark(name: 'split_open', data?: string): void;
}

export function createPaneSet<C extends PaneContent>(deps: PaneSetDeps<C>): PaneSet<C> {
  const { main } = deps;
  const panes: Pane<C>[] = [];
  const changeListeners = new Set<(e: PaneChange<C>) => void>();
  const splitListeners: ((main: HTMLElement) => () => void)[] = [];
  /** The cleanups the split listeners returned for the second pane now open. */
  let splitCleanups: (() => void)[] = [];
  let ratio = 0.5;

  const makePane = (parts: PaneParts, slot: Slot): Pane<C> => {
    const content = deps.content(parts, slot);
    return {
      slot,
      host: parts.host,
      article: parts.article,
      parts,
      view: content.view,
      content,
      path: () => content.currentPath(),
    };
  };

  const emit = (e: PaneChange<C>): void => {
    for (const cb of [...changeListeners]) {
      try {
        cb(e);
      } catch (error) {
        console.warn('marxy: a pane listener threw', error);
      }
    }
  };

  const writeRatio = (): void => {
    if (panes.length > 1) main.style.gridTemplateColumns = `${ratio}fr ${1 - ratio}fr`;
  };

  const markFocus = (pane: Pane<C>): void => {
    for (const p of panes) p.host.toggleAttribute('data-marxy-focus', p === pane);
  };

  panes.push(makePane(deps.first, 0));
  let focused = panes[0]!;
  markFocus(focused);

  /** The second pane: in the grid, at its width, before anything is opened in it. */
  function split(): Pane<C> {
    const parts = createPaneElement(1);
    main.append(parts.host);
    main.setAttribute('data-marxy-split', '');
    const pane = makePane(parts, 1);
    panes.push(pane);
    writeRatio();
    markFocus(focused);
    splitCleanups = splitListeners.map((cb) => cb(main));
    return pane;
  }

  /** The second pane goes; the first takes the window again. */
  function unsplit(): void {
    const right = panes[1];
    if (!right) return;
    panes.length = 1;
    for (const cleanup of splitCleanups.splice(0)) cleanup();
    right.content.destroy();
    right.host.remove();
    main.removeAttribute('data-marxy-split');
    main.style.gridTemplateColumns = '';
    if (main.getAttribute('style') === '') main.removeAttribute('style');
  }

  const set: PaneSet<C> = {
    get panes() {
      return panes;
    },
    get focused() {
      return focused;
    },
    get ratio() {
      return ratio;
    },

    async openIn(target, path, opts) {
      const slot: Slot = target === 'focused' ? focused.slot : target === 'other' ? (focused.slot === 0 ? 1 : 0) : target;
      let pane = panes[slot];
      let made = false;
      if (!pane) {
        if (panes.length >= MAX_PANES || (set.canSplit && !set.canSplit())) return null;
        pane = split();
        made = true;
      } else if (pane.path() !== null && set.beforeReplace && !(await set.beforeReplace(pane))) {
        return null;
      }
      const t0 = performance.now();
      const opened = pane;
      await opened.content.open(path, {
        at: opts?.at,
        onLanded() {
          if (made) deps.mark('split_open', `ms=${(performance.now() - t0).toFixed(1)} blocks=${opened.article.childElementCount}`);
          emit({ kind: 'open', pane: opened });
          opts?.onLanded?.();
        },
      });
      return opened;
    },

    async close(pane) {
      if (panes.length < 2 || !panes.includes(pane)) return false;
      const [left, right] = panes as [Pane<C>, Pane<C>];
      // An empty survivor (its read failed) has nothing to show in slot 0: closing the left pane would
      // keep the left document and drop the right pane, the opposite of what was asked.
      if (pane === left && right.path() === null) return false;
      if (pane.path() !== null && set.beforeReplace && !(await set.beforeReplace(pane))) return false;
      if (pane === left) {
        // The survivor's document into slot 0, at its place, in its mode and through its store (held by
        // both views for this moment), then slot 1 goes. Text typed in the survivor's Source lives only in
        // its editor until folded, and that editor goes with slot 1: it goes into the store first, or the
        // close is refused.
        const path = right.path();
        if (path === null) return false;
        await right.content.foldSource();
        if (right.view.sourceHasUnfoldedEdits()) return false;
        const source = right.view.mode === 'source';
        const position = right.view.position();
        await left.content.replace(path, { at: position.byteOffset });
        if (left.path() !== path) return false;
        // The place is kept to the block: the open's landing holds the block's top, so the fraction within
        // it is D-05's (per-pane scroll).
        if (source && left.view.mode !== 'source') await left.view.jumpToSource(position.byteOffset);
      }
      unsplit();
      set.focus(left);
      emit({ kind: 'close', pane });
      return true;
    },

    focus(pane) {
      if (!panes.includes(pane)) return;
      focused = pane;
      markFocus(pane);
      if (!pane.host.hasAttribute('tabindex')) pane.host.tabIndex = -1;
      pane.host.focus({ preventScroll: true });
      emit({ kind: 'focus', pane });
    },

    setRatio(next) {
      ratio = next;
      writeRatio();
      emit({ kind: 'ratio' });
    },

    onSplit(cb) {
      splitListeners.push(cb);
      if (panes.length > 1) splitCleanups.push(cb(main));
    },

    onChange(cb) {
      changeListeners.add(cb);
      return () => {
        changeListeners.delete(cb);
      };
    },

    destroy() {
      unsplit();
      focused = panes[0]!;
      markFocus(focused);
      panes[0]!.content.destroy();
      changeListeners.clear();
      splitListeners.length = 0;
    },
  };
  return set;
}
