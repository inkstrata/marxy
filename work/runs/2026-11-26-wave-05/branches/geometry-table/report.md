# geometry-table: builder report (Opus)

Saved by the orchestrator, 2026-11-26. Checked: the seven commits exist on `agent/geometry-table`, worktree clean, verify log ends "12/12 steps passed" (exit 0, 04:49).

Built; verify 12/12 on tip `57fca039` (browser 510, desktop 1270, core 4248). Nothing changes for the reader. One brief target not met: Source to Read layouts went 60 to 54, not "a fraction".

**Commits** (cut from `663a7f7f`)
- `1219d5d3` the table, with the comparison test written against today's code before anything used it
- `dad0195e` consumers moved to the table; whole-list rebuilds and `block-list.ts` removed
- `6c9d9ebd` table changes only on a whole notification batch; read-count tests; long CSV table
- `053e7297` the spine
- `7409351b` scroll frames read the position from the table without layout
- `2b952f94` Read shown again after Source makes no grid pass unless a block came back another size
- `57fca039` blocks that are not laid out (a theme-hidden `hr`)

**What changed**
- `view/block-geometry.ts`: one entry per top-level block; ResizeObserver reports changes, only changed blocks are read, the ones between are shifted; a MutationObserver on the article's children adds and drops entries.
- Finer positions (list items, rows) measured only for the block under the reading line.
- Pure parts in `packages/core/src/position/geometry.ts`.
- Moved to the table: position, restore, saved place, spine, `holdPlace`, `holdAnchor`, rows and lines views. `buildBlocks` kept as test oracle only.
- Docs: `docs/architecture.md` ("Where the blocks are"), `docs/themes-and-type.md`.

**Find out first**
- Observer cost, Edge, per frame: +0.14 ms at 1,245 blocks; +1.2 ms at 10,000 when a block changes, +0.7 ms scrolling only. WebKit at 10,000: +5.5 ms when something changes. Delivering 10,000 notifications 2-6 ms. Every block is observed; observing on demand may be worth it later in WebKit at 10,000. Synthetic pages, not the 1 MB document.
- WebKit on un-hiding: reports every block like Chromium.
- Readings draw escaped HTML with byte ranges; rows and lines are drawn as the page scrolls, each draw used to rebuild the whole list, now drops only that block's cached inner list. Transcript names its own blocks; unchanged.

**Proofs (revert and fail)**
- Notifications ignored: 3 of 4 table tests fail (read-count test still passes).
- Read-count test on old consumers: Source and back 234 reads of list items/quote paragraphs, grid pass 170, grown code block 4; now 0/0/0. The code-block case passes on both.
- `shiftAround` broken: 1 unit test fails.
- Hidden-block fix removed: comparison fails on long reference.
- New spine unit test: 2 pass; not broken to check it fails.

**Counts** (records in `work\wave5\geometry-table\`)
- Against the wave-4 baseline, open layouts rose (353 to 474 to 517); master measured under the same load (`interactions-master-663a7f7f-same-load.json`) gave 472: load, not the change.
- Tip `2b952f94` vs that master run, long reference: open layouts 472 to 420; tab switch back 622 to 534; Source to Read 60 to 54. Key, click, undo, reload unchanged. Remaining Source-to-Read layouts come from other work in the quiet window. Durations not comparable (load). Script time per wheel event not measured.

**Know**
- A first verify run was spoiled by editing the tree during it; the run that counts is the clean one at 04:28 (log shows exit 04:49).
- Known gaps: inner blocks change height while the top-level block pads back to the same size (cached inner positions stale); a margin change without a size change goes unnoticed. Both covered only by the comparison test. While a long page is still mounting, the spine's height estimate uses top-level bottoms.
- Not verified: `check:tauri`, real WebView2 window, two panes on one document through the table.
