// A split the window can no longer hold gives one pane back (F-106; X-32 finding 6). Opening a second pane is
// refused where two columns do not fit at the typography floor (`splitRefusal`, `fitsTwoColumns`); a split made in a
// wide window and then narrowed used to keep both panes at about 250 px. This watches the grid's width and applies
// the same test to the panes already open: with two panes and no room for two columns, the pane that is not
// focused is closed through `PaneSet.close`, so everything that guards a close guards this one (a document with
// unsaved edits that no other pane shows is asked about, in its pane, and stays open until the reader answers).
//
// Nothing the reader had is dropped: the document of the pane given back keeps its tab (a tab is any path a pane has
// shown), and its place, its mode and the split's ratio are remembered. When the window is wide enough again, and
// the reader has not opened anything in the meantime, the split comes back as it was, on the same side, at both
// places. A reader's own open, or a different document under the surviving pane, ends that promise: the
// narrowed window is theirs now. While a pane is given back the saved layout (layout.json) is left as it was.
//
// No flapping: the gutter shrinks with the column, so the floor measured with two panes is never above the floor
// measured with one; a split that comes back at the open rule's width is still above the rule that keeps it.

import { isTransient } from '../workspace/tabs.ts';
import { activeFind } from '../find/view.ts';
import { clampToMain } from './divider.ts';
import { canShowTwoColumns } from './fit.ts';
import type { AppPanes } from './index.ts';

type AppPane = AppPanes['panes'][number];

/** What was given back, to bring it back. */
interface GivenBack {
  readonly path: string;
  readonly mode: 'rendered' | 'source';
  readonly at: number;
  /** The slot the given-back pane was in; the other pane is the one that stayed. */
  readonly side: 0 | 1;
  readonly stayedPath: string;
  readonly ratio: number;
  readonly focusedSide: 0 | 1;
}

export interface NarrowHooks {
  /** Layout.json is left alone while a pane is given back (`true`), and caught up when it is not (`false`). */
  hold(on: boolean): void;
}

/** Starts watching `main`; returns what stops it. */
export function keepTwoColumns(panes: AppPanes, main: HTMLElement, hooks: NarrowHooks): () => void {
  let given: GivenBack | null = null;
  let busy = false;
  let again = false;
  /** The reader dismissed the question over unsaved edits: not asked again until the window has room. */
  let declined = false;
  let stopped = false;

  const modeOf = (pane: AppPane): 'rendered' | 'source' => (pane.view.mode === 'source' ? 'source' : 'rendered');
  const inMode = async (pane: AppPane | undefined, mode: 'rendered' | 'source'): Promise<void> => {
    if (pane && pane.path() !== null && modeOf(pane) !== mode) await pane.view.toggleMode();
  };

  async function giveBack(): Promise<void> {
    const [left, right] = panes.panes as readonly [AppPane, AppPane];
    // The focused pane stays, unless it shows nothing: then the one with a document does.
    let stays = panes.focused.path() === null ? (panes.focused === left ? right : left) : panes.focused;
    let leaves = stays === left ? right : left;
    // A document that exists nowhere else (a scratch, Untitled, a bundled page) has no file or tab to come back to:
    // it is never the one given back. Two of them, and the split stays.
    if (leaves.path() !== null && isTransient(leaves.path()!)) {
      if (stays.path() !== null && isTransient(stays.path()!)) {
        declined = true;
        return;
      }
      [stays, leaves] = [leaves, stays];
    }
    const record: GivenBack | null =
      leaves.path() !== null && stays.path() !== null && !isTransient(leaves.path()!) && !(leaves === right && isTransient(stays.path()!))
        ? {
            path: leaves.path()!,
            side: leaves === left ? 0 : 1,
            stayedPath: stays.path()!,
            mode: modeOf(leaves),
            at: leaves.view.position().byteOffset,
            ratio: panes.ratio,
            focusedSide: panes.focused === left ? 0 : 1,
          }
        : null;
    // Find and Replace in the pane about to be asked about would cover the question's buttons in a narrow pane.
    const find = activeFind();
    if (find && find.pane === leaves) find.close();
    leaves.host.querySelector<HTMLButtonElement>('.cm-search button[name="close"]')?.click();
    hooks.hold(true);
    const closed = await panes.close(leaves);
    if (!closed) {
      // Refused or dismissed: both panes stay as they were, and the layout is the reader's again.
      declined = true;
      hooks.hold(false);
      return;
    }
    given = record;
    if (!record) hooks.hold(false);
  }

  async function restore(g: GivenBack): Promise<void> {
    if (g.side === 1) {
      // The pane that stayed is not touched: its place, mode and text are the reader's now.
      const pane = await panes.openIn('other', g.path, { at: g.at });
      if (!pane) return;
      await inMode(pane, g.mode);
    } else {
      // The pane that stayed is in slot 0 now; it goes to the right, as it is now, and the given-back document takes the left.
      const now = panes.panes[0]!;
      const stayedMode = modeOf(now);
      const stayedAt = now.view.position().byteOffset;
      const right = await panes.openIn('other', g.stayedPath, { at: stayedAt });
      if (!right) return;
      await inMode(right, stayedMode);
      const left = await panes.openIn(0, g.path, { at: g.at });
      if (!left) return;
      await inMode(left, g.mode);
    }
    panes.setRatio(clampToMain(main, g.ratio));
    panes.focus(panes.panes[g.focusedSide] ?? panes.panes[0]!);
  }

  /** The reader closed the given-back document's tab while the window was narrow: the split is not coming back. */
  const tabClosed = (path: string): boolean => {
    const row = document.querySelectorAll('[data-marxy-tab]');
    return row.length > 0 && ![...row].some((t) => t.getAttribute('data-marxy-tab') === path);
  };

  async function settle(): Promise<void> {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const fits = canShowTwoColumns(main);
        if (fits) declined = false;
        if (panes.panes.length > 1) {
          if (!fits && !declined) await giveBack();
        } else if (given) {
          const g = given;
          const same = panes.panes[0]?.path() === g.stayedPath;
          if (!same) {
            given = null;
            hooks.hold(false);
          } else if (tabClosed(g.path)) {
            given = null;
            hooks.hold(false);
          } else if (fits) {
            given = null;
            await restore(g);
            hooks.hold(false);
          }
        }
      } while (again && !stopped);
    } finally {
      busy = false;
    }
  }

  // The reader's own open, while a pane is given back, is a change of layout that is theirs.
  const off = panes.onChange((e) => {
    if (busy || !given) return;
    if (e.kind === 'open') {
      given = null;
      hooks.hold(false);
    }
  });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => void settle());
  observer?.observe(main);
  // A split made when the window already cannot hold it (opened by a command that does not ask) is caught too.
  const offSplit = panes.onChange((e) => {
    if (e.kind === 'open' && !busy) void settle();
  });
  return () => {
    stopped = true;
    off();
    offSplit();
    observer?.disconnect();
  };
}
