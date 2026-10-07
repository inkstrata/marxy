# ADR-0054 — One verb menu is the click surface for operations; `Mod+C` runs a default copy verb, never a splice

- **Status:** proposed
- **Date:** 2026-10-07
- **Amends:** ADR-0019 and `docs/roadmap.md` ("at most four new operations per release" is replaced by
  a per-selection limit). Builds on ADR-0004 (editing is transformation) and ADR-0050 ("at rest" is
  defined: a summoned surface may be any shape).
- **Evidence:** [`docs/research/audit-2026-10/08-feature-text-operations.md`](../research/audit-2026-10/08-feature-text-operations.md)
  §1 findings 2, 3, 4 and 7, §5 (the surfaces compared, "Keyboard parity", "Required plumbing
  change"), §8.

## Context

The catalogue is four operations and the mechanism is sound, but two things block growth. A click on
a table cell selects the cell, so `align-table-pipes` takes a click and two key presses; a task item
is not offered `toggle-task` at all. And `Mod+C` picks the first operation whose id starts with
`copy-`, which becomes order-dependent the day a second copy operation applies to the same node. A
drag selection copies plain text only, although the shell writes both flavours. Meanwhile the
"four per release" cap was written to keep the palette quiet, and the palette is already filtered by
selection.

## Decision

1. **One verb menu is the click surface.** A single themed DOM menu, drawn from the command registry,
   opens by right-click (Ctrl-click on macOS), by the context-menu key or `Shift+F10`, and by `Enter`
   on a selected block. It lists at most seven verbs for the selection, in one written order, each with
   its chord, and a last row "All actions…" that opens the palette in `>` mode when more apply. It is
   built on open and removed on close; at rest nothing of it exists in the DOM (ADR-0050).
2. **Rejected surfaces.** A hover glyph on code and tables (it appears on any mouse pass), a gutter
   handle (it competes with hanging punctuation and the margin), and a selection popover (it covers
   what is being selected, and a click already selects a block) are not built. A native Edit > Copy as
   submenu is a separate, later decision.
3. **`Mod+C` always runs the selection's default copy verb, and never a splice.** The verb comes from
   an explicit table, `defaultVerbFor(selection kind)`, and never from a string prefix of a command id.
   Copy verbs write the clipboard only; a verb that changes the buffer is never a default. The table
   is in `docs/design/03-selection-and-operations.md`.
4. **Keyboard parity.** `Mod+Shift+C` copies exact markdown (the source bytes of the block, or of the
   blocks a drag covers). `Enter` on a selection and `ContextMenu` / `Shift+F10` open the menu. Every
   verb is a registry command, so it is also in the palette. No binding is a single letter
   (`docs/design/09-app-shell.md`).
5. **The four-per-release cap is replaced** by the per-selection limit: no selection kind shows more
   than seven verbs. The catalogue may grow; if the palette shows more than a handful for one kind,
   the catalogue is too large. `docs/scope.md` and ADR-0019 are not edited; this ADR amends them.
6. **At rest.** The menu is summoned by a deliberate act and dismissed by a keystroke, so it is not
   chrome at rest (ADR-0050).

## Consequences

- Stories C-06 (the tables and dispatch), C-07 to C-09 (the packs) and C-13 (the menu) implement this.
- Departure from `08` §5: a plain-text drag's `Mod+C` default is now `selection.copy-rich` (rich text with formatting, as C-06's outcome states), where `08` said plain text. Plain text stays one menu row away.
- Rich copy of a drag selection reaches the clipboard as sanitised HTML plus plain text in one write.
  Paste-side HTML must come from the webview's `paste` event; that is not decided here.
- Writing into the rendered surface is not decided here (ADR-0005 still governs).
- Marking this ADR accepted is the author's act.
