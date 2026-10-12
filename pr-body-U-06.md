## What changed

The sidebar now looks like the mock's: a search field with a ⌘K chip, 11 px / 600 section heads with a chevron and a quiet count when folded, 28 px rows with the open document on the accent wash, and a foot saying how many documents are indexed and whether Marxy is watching.

## Decisions

- **Q20 (ruling in rulings-x21): flush panel.** `tauri.conf.json` sets no `titleBarStyle`, so the title bar is not yet an overlay (ADR-0038). The inset card (8 px margin, radius 13) is not built; it follows the overlay title bar.
- **Search field opens the palette** (via `openPalette`, as ⌘K does). There is no sidebar filter yet, and the card says to open the palette. Its accessible name says so.
- **Settings at the foot is not drawn**: no Settings surface exists, and a door shows only what is behind it.
- Dock and peek behaviour untouched. W-08 (tree) not touched.

## Checks

`pnpm precheck` and `pnpm check` green. WebKit run serially: sidebar 16/16, no-displacement 27/27, src/workspace/*.test.mjs all pass. New test covers the look, the search click and `aria-current`.

Pair: `docs/taste-review/2026-10-12-U-06/` (01-unfolded, Night and Paper).
