# ADR-0050 — "At rest" is defined: the column of text; anything else is summoned

- **Status:** accepted (author, 2026-10-02)
- **Date:** 2026-10-02
- **Amends:** ADR-0011 (the palette is the tab manager) and design constraint 6 in
  `docs/design-language.md` ("Chrome at rest is zero"). The ADR-0011 reversal criterion is retired.
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §4;
  `06-feature-collection-and-search.md` and `07-feature-split-view.md`.

## Context

Constraint 6 says Rendered mode at rest is a column of text and nothing else. ADR-0011 applied it
to documents: no persistent tab bar, the palette is the switcher. Two features the author now wants
put "which documents are open or near" back on screen: a collection with a quick search, and a
split view for cross-reference. Both studies were written inside a reading of the constraint that
the repository had never stated: what counts as "at rest", and what may appear when the reader asks.

ADR-0011's reversal criterion (reach the document from three switches ago within five seconds at
taste review #2) has never been evaluated; review #2's decision form is empty. A criterion nobody
runs does not protect anything.

## Decision

1. **At rest is what is on screen when the reader has pressed nothing.** In Rendered mode that is
   the column of text, and nothing else: no toolbar, no tab bar, no sidebar, no status line. This
   is constraint 6, unchanged.
2. **A summoned surface may be any shape.** If a keystroke, a gesture or a palette command brings
   it, and a keystroke dismisses it, it is not chrome at rest. A search field that appears on `Mod+F`,
   a switcher inside the palette, an outline overlay, a popover of operations: all pass.
3. **Two persistent things are permitted because they are not chrome.** A **pane divider** between two
   documents is a hairline, with no handle, title or button, and it exists only while a split is
   open. A **collection** is scoped to the palette: it is a list of documents the palette can
   show, not a region of the window.
4. **A permanent sidebar does not pass,** nor a tab bar, a breadcrumb, a minimap, or a status bar,
   however narrow or translucent. A surface that stays on screen until the reader closes it is
   chrome at rest.
5. **ADR-0011's reversal criterion is retired.** Its fallback ("tabs revealed only while switching")
   is already inside item 2, so no review is needed to allow it. The decision in ADR-0011 stands: the
   palette is the tab manager.
6. **Window controls** keep ADR-0038's rule: hidden at rest, through the shell.
7. **`docs/design-language.md` constraint 6** gains one sentence defining "at rest" as above, and
   `checkChrome` in `scripts/gate-aesthetics.mjs` (the mechanical test that asserts a column of text and nothing else at rest) keeps
   its meaning and gains a split-view case when a split exists.

## Consequences

- The collection and split-view designs stand as written, with no new exception to argue.
- Reviews of new UI have one question to ask: is it on screen when nothing was pressed?
- A future feature that wants to be persistent must change this ADR, in the open.

## Rejected

- **Allow a hidden-by-default sidebar that remembers it was open.** It is chrome at rest for
  every reader who opened it once.
- **Leave constraint 6 undefined.** Each new feature then re-argues it from the principle.
- **A tab bar that appears with two or more documents.** It makes the second document change the
  look of the first.

## How we would know this was wrong

1. A summoned surface is summoned so often it is effectively always open (a reader leaves the
   outline up): the reader is telling us it is not chrome, and the answer is a faster summon, not a
   permanent surface.
2. A split divider acquires a handle, a title or a button: item 3 was a loophole.
