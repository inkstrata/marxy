# ADR-0058 — The fold-up workspace: at rest is the folded window; unfolded, the workspace may persist

- **Status:** accepted (author, 2026-10-10)
- **Date:** 2026-10-10
- **Reverses:** ADR-0050 items 3 (in part), 4 and its first two rejected options, inside the unfolded
  workspace only; ADR-0011 (no tab bar) inside the unfolded workspace only.
- **Amends:** ADR-0057 item 4 (scroll is independent) for one document shown as Read and Source;
  design constraint 6 in `docs/design-language.md`.
- **Evidence:** [`docs/plan/direction-2026-10/02-fold-up-workspace.md`](../plan/direction-2026-10/02-fold-up-workspace.md),
  the mockup in `docs/plan/direction-2026-10/mock-v2/` (`01-workspace.html`), and the Galley prototype
  it adapts.

## Context

ADR-0050 defined "at rest" as the column of text and ruled every persistent surface out. That kept
Marxy quiet, but it also kept out everything a reader needs to go deep: a tree of the folders they
read, tabs for the five documents they are working across, an inspector that says what a file is,
a status line with its measures. The Galley prototype showed that workspace, and the author ruled
(2026-10-09, 2026-10-10) that Marxy should grow into it nearly whole, while keeping today's quiet as
the default: "it just needs more access to deep dive."

## Decision

1. **Two states.** The window is **folded** or **unfolded**. Folded is Marxy as ADR-0050 defines it:
   the column of text and nothing else. Unfolded is the workspace: sidebar, toolbar, tabs, the kind's
   tool strip, the panes, an inspector and a status bar. `⌘\` moves between them.
2. **At rest is the folded window.** ADR-0050 items 1, 2, 6 and 7 stand for the folded window and
   for every summoned surface. `checkChrome` keeps asserting the folded window and nothing else.
3. **Unfolded, persistent chrome is permitted.** A surface the reader unfolded stays until they fold
   it. This is the reversal of ADR-0050 item 4 and of ADR-0011, and it holds only inside the
   unfolded workspace: folded, there is no tab bar and the palette is still the switcher.
4. **Windows open folded.** The panels last unfolded are remembered in Marxy's own state and come
   back on the next `⌘\`. Folding never forgets them.
5. **Peeking.** Folded, the pointer resting at the left, right or top edge for about 150 ms shows one
   panel as an overlay. Peeking never moves the column. Clicking into a peeked panel, or its key,
   docks it and unfolds.
6. **The column never reflows on fold or unfold** unless the measure no longer fits; the inspector
   opens by default only where Split would not squeeze the reading measure.
7. **Split is one document as Read and Source,** side by side in Phase D's two panes, with scroll
   linked by source position and click-to-locate. Two different documents side by side keep
   ADR-0057's independent scroll.
8. **No tracking chrome.** No surface in either state carries model, session, tag, live-state or
   confidence metadata (`docs/plan/direction-2026-10/01-galley-keep-knead-leave.md`, the strip list).

## Consequences

- `docs/design-language.md` constraint 6 reads "at rest" as the folded window.
- Phase W builds the workspace (`docs/plan/direction-2026-10/05-plan.md`). W-01 extends the
  aesthetics gate with an unfolded case and keeps the folded one exactly as strict.
- Tabs are views over the document store (ADR-0037); closing a tab is closing a view, not a file.
- A reader who never presses `⌘\` sees no change.

## Rejected

- **Reopen as the reader left it.** A window that opens unfolded makes the workspace the default
  for every reader who unfolded once, which is ADR-0050's own rejected option in another form.
- **A workspace in a second window.** It splits the reader's state across windows and doubles the
  shell surface.
- **Keep ADR-0050 and summon each panel separately.** The author tried that reading in the first
  draft of the direction and ruled it too thin.

## How we would know this was wrong

1. Readers unfold on every launch: the folded window is not where they read, and the default should
   be revisited.
2. The folded window gains a control "just for discoverability": item 2 has a loophole.
