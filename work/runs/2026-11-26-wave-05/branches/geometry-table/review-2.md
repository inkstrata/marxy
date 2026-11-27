# geometry-table: second review (Opus)

Saved by the orchestrator, 2026-11-26.

Verdict: ready after the reviewer's fix `85606aba` (on `8277b4e6`). Verify turn on it 12/12 (browser 511, desktop 1270, core 4249); typecheck, lint, `pnpm check` 10/10 green; tree clean.

**Three problems found, each shown in WebKit through the app**
1. Notes in the margin broke positions (a regression from master). "Notes where you read" is on by default; in a wide pane note boxes are absolutely positioned children of the article. The table made them entries at the end, out of order, so the binary search failed: on the long reference at 2200 px about the last 20% of the page read the footnotes' byte (194695) as the place (saved position, crumbs, spine). Master's list skipped them (no byte range); the reader's own notes (`notes/margin.ts`) are added the same way. Fix: a child with no range and absolute or fixed position gets no entry.
2. A margin-only change left the table stale (a theme-folder `h2 { margin-top }` that moves blocks by whole lines changes no size, so nothing is reported). Fix in `shiftAround`: the last entry of each run is also read; where it is off, the first entry that moved is found by halving, and the rest of the run is moved again. About 2 extra reads per run.
3. Inner positions went stale (the known gap, now shown): a list item growing in the same frame as a grid pass (an image loading in an item) is padded back to its old size, nothing reported, fractions off by about 0.06. Fix: `snap`, `snapWhole` and `snapChanged` forget cached inner positions.

**Tests added** (each proved by mutation): margin-only theme step, 2200 px notes-in-margin step and a list-padded-back test in `block-geometry.test.mjs`; the core unit test for a margin change fails with run settling off. Three unit tests that list exact reads updated for the run-end reads.

**Checked fine:** Source and back, reload with a line appended, another document and back (warm store), two panes on one document: positions equal master `663a7f7f` exactly. MutationObserver rebuilds from live children, so add-then-remove in one batch is safe. Splices only add nodes. Observer cost at 10,000 blocks in WebKit: 0.35 ms per callback (5 reads), scrolling no callbacks (the builder's +5.5 ms is pessimistic).

**Slip:** a stray `git checkout 663a7f7f --` detached HEAD briefly; switched straight back, branch ref never moved. (Orchestrator confirmed: branch `agent/geometry-table`, tip `85606aba`, clean.)

**To file:** two margin changes cancelling exactly inside a run, or a margin change leaving the article height the same, still go unseen. On a pane split the reading position moves back a block (105674 to 105185); master does the same. `check:tauri` not run.
