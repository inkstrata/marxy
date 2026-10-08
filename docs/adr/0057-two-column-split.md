# ADR-0057 — Two documents side by side: a two-column split inside one window

- **Status:** proposed
- **Date:** 2026-10-08
- **Amends:** ADR-0005 (Rendered or Source is the mode of a pane, toggled in the focused one) and
  ADR-0011 (a summoned split is not a tab bar). Builds on ADR-0037 Amendment 1 (one store per document,
  one view per article) and ADR-0018 (positions are byte coordinates).
- **Evidence:** [`docs/research/audit-2026-10/07-feature-split-view.md`](../research/audit-2026-10/07-feature-split-view.md)
  §4.1, §4.7, §4.9 and §6.2; the phase plan, [`docs/plan/roadmap-2026-10/04-phase-d.md`](../plan/roadmap-2026-10/04-phase-d.md).

## Context

Reading across documents (a plan beside its result, a README beside the source it documents) needs two
documents on screen at once. The split could be OS windows tiled by the system, a tree of panes, or
columns in one window. Phase B left one store per document and one view per article, so a second view
in the same page is now construction rather than a rewrite.

## Decision

1. **Columns in one window.** The window holds an ordered list of panes, left to right, each a
   `section.marxy-pane` in `#marxy-main` with its own notices region, article, Source mount and view.
   No second OS window, so `shell-api` and the Rust side do not change.
2. **Two at most, and binary.** `MAX_PANES` is 2, a constant rather than a setting. There is no tree,
   no vertical split and no third column: a stacked pane halves the reading height, and two columns at
   the 45-character floor already need about 929 px.
3. **One pane is the page as it always was.** With one document there is one pane and no divider,
   no split attribute and no visible element beyond the article. A second pane exists only while two
   documents are shown, and that state is summoned and dismissed like any other.
4. **Scroll is independent.** Each pane of a split scrolls on its own. Nothing links the two.
5. **`#doc` is the first pane.** The first pane's article, notices region and Source mount keep the
   ids `doc`, `marxy-notices` and `marxy-source`; the second pane's are `doc-2`, `marxy-notices-2`
   and `marxy-source-2`. Slot 0 is permanent: closing the left pane shows the right pane's document
   in it, through the same store and in the same mode, and removes the second pane, so nothing is
   renamed and every reader of `#doc` keeps working. Source text typed in the right pane goes into the
   store first; if it cannot, the close is refused.
6. **One store per document, however many panes show it.** A store is shared through a registry keyed
   by path that counts the views holding it; the last view to let go closes it.

## Consequences

- Nothing a reader sees changes with one document; the split is reached from the palette and keys
  added by later stories (Phase D).
- What still means "the one document" (the selection, the mode on `<body>`, the window scroller,
  notices, the close guard) is bound to the first pane until the story that owns it moves it
  to the focused pane. `docs/design/09-app-shell.md` §State lists them.
- A third column, linked scrolling or a second OS window each need a new decision.
- The divider between two panes is drawn from three theme tokens: `--marxy-color-divider` (the 1 px line;
  the rule colour by default), `--marxy-color-divider-focus` (the line on the focused pane's side, and
  the divider's hover, drag and keyboard-focus states; the accent by default) and `--marxy-divider-hit`
  (the pointer target, centred on the line, which takes no layout width; 8px by default). At rest the
  line is deliberately below 3:1 against the page (about 1.25:1): chrome at rest is zero, the edge
  between two columns is visible from the text itself, and the control is a named `separator` with
  keyboard and palette alternatives. Its interactive states are not below 3:1: hover, drag and
  keyboard focus draw the line in the accent (6.4:1 or better), a test holds that, and focus also
  shows a 2px outline. The 8px target is under WCAG 2.2's 24px (2.5.8); the gutters keep other targets
  clear of it and the palette commands are the equivalent.
