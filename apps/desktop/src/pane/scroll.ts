// Each pane its own scroller (D-05; ADR-0057: scroll independent).
//
// The model: **one pane scrolls the window, two panes scroll their own elements.** With one document
// the window scrolls, as it always has: the scroll listener, the reading anchor, the persistence and
// most of the harness read `document.documentElement` and `window.scrollTo`, and nothing about them
// changes. With two, each `section.marxy-pane` is `overflow-y: auto` at the window's height (the split
// rules in index.html), and each view scrolls its own section. An always-pane scroller was rejected:
// every test and script that reads the window's scroll would have had to move with it.
//
// The cost is one transition each way, made here. When the second pane appears the first pane's view
// moves from the window to its section; when the split closes the survivor (always the first pane, see
// pane-set.ts) moves back to the window. Each move reads the reader's place as the view last saw it, a
// byte coordinate (ADR-0018), and holds it on the new scroller through the relayout the new width
// causes, so a pane that changes width and scroller keeps its place. The second pane's view is made on
// its own section and never moves. Closing the left pane hands the right pane's place (fraction too) to
// the first pane, which shows that document from then on.

import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { PaneContent, PaneSet } from './pane-set.ts';

export function installScroll<C extends PaneContent>(panes: PaneSet<C>): void {
  /** The right pane's place as its split ended, for a close that keeps its document in the first pane. */
  let rightPlace: ReadingPosition | null = null;

  panes.onSplit(() => {
    const [first, right] = panes.panes;
    first?.view.rebindScroller(first.host);
    return () => {
      // The split is still laid out here: the cleanup runs before the second pane goes (it has already
      // left `panes.panes`, so it is the one taken when the split began).
      rightPlace = right && right.view.mode === 'rendered' && right.view.document() ? right.view.position() : null;
    };
  });

  panes.onChange((e) => {
    if (e.kind !== 'close') return;
    const first = panes.panes[0];
    const given = e.pane?.slot === 0 && rightPlace !== null && rightPlace.path === first?.path() ? rightPlace : undefined;
    rightPlace = null;
    first?.view.rebindScroller(document.documentElement, given);
  });
}
