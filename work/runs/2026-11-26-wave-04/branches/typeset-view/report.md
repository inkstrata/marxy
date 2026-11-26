# typeset-view: builder report (Sonnet)

Branch `agent/typeset-view` (stacked on `agent/drop-floor` `ffb4cc7e`), tree clean, tip `fe53c0ed`. Verify not fully green (below). Measurement shows only a small drop in layouts, recalcs and durations; no "scroll while type is set" frame figure.

## Commits

- `a089ba4a` perf(view): patch the block list where blocks changed, read the place once a frame, discard a page that is replaced
- `fe53c0ed` fix(view): keep the block list honest (rebuilds ask each element's style every time; a patch checks entries still name a node)

## What changed (nothing the reader sees)

1. `destroyTypeset(discard)`: teardown in `clear`, `rerenderFromBuffer`, `mountDerived` pass `discard`; `startTypeset` still reverts.
2. A visible pass that set paragraphs runs `snapChanged` over the top-level blocks holding them, not a whole `snap`. Viewport pass, background passes and `showRendered` unchanged.
3. New module `view/block-list.ts` (`topLevelOf`, `updateBlocks`): patches the list from the first changed block (re-reads entries inside the changed blocks and neighbours, shifts the rest by a measured amount); falls back to a whole build when an entry is disconnected, no longer names a node, or the article top moved.
4. `position()` read once per frame (five askers, one read); no copy of the block list: `currentPosition` and `restoreScrollToPosition` take an `offset`; core's `blockPositionAtScroll` and `blockIndexForByteOffset` exported.
5. Spine writes styles only on change; table-aids `edgeOf` read once per pane per pass.
6. `docs/themes-and-type.md` updated.

Dropped: the per-element display memo (display depends on width: `hr` is `none` when narrow; it went stale and broke the progressive-large resize test).

## Measured (`long-reference`; loaded machine, durations not comparable)

Counts per run: wave 3 baseline, drop-floor tip, this branch.

- open layouts 414, 469, 452
- undo layouts 456, 697, 623
- reload layouts 475, 742, 564

Recalcs the same way; this branch 3% to 35% below drop-floor. Records: `plan\records\typeset-view-after.json`, `work\wave4\typeset-view-base-dropfloor.json` and measure logs there. No scroll-while-setting row in the tool.

## Tests

- New `apps/desktop/test/typeset-view.test.mjs` (3, in `verify-map.json`): patched list equals a whole build for a paragraph, a code block, an image and two far apart, in 12 or fewer reads against at least 600; five position askers cause one read; opening another document makes 20 or fewer writes inside the old page. Each fails with its fix broken.
- Verify on `fe53c0ed`: unit-desktop 1258, unit-desktop-browser 44. Browser 444 pass, 1 fail: `selection.test.mjs` "after the page fails to render a change, nothing stays selected" fails identically on drop-floor `ffb4cc7e` without these changes (the test makes the article's next `querySelectorAll` throw; after drop-floor's in-place splice that call never happens). unit-core 4237/1: the 10 MB notebook wall-clock test, 19/19 alone (load).

## Not done

- Background passes still schedule a whole snap.
- Position cache not tested for staleness after a width change with the scroll offset unchanged.

## Orchestrator notes

- The selection red is drop-floor's, missed by its verify and its review (neither ran `selection.test.mjs`). Sent to a fixer on `agent/drop-floor`; typeset-view merges drop-floor's fix after.
- The undo and reload layout counts rose from the wave 3 record to the drop-floor tip (456 to 697, 475 to 742) on a 195 KB page that drop-floor should not touch (it was over the floor already). Either load or something real: the integration measurement must settle it against master measured the same day.

## Fixes after review (builder)

- `c88ec830`: changed elements map to their top-level blocks; patch only when no snap is scheduled, `changedBlocks` is empty, no colour report waits (new `render/colour-reports.ts`, since `highlight.ts` is a lazy chunk) and the progressive mount is complete; else build whole. Position cache dropped, in-place search kept.
- `9a774ea0`: a list remembers the article's child count when built; `updateBlocks` refuses a mismatch.
- In-app differential (`blockListStats.verify`) over colour, images, maths, scrolling while setting, narrow and wide, a splice, Source and back, opening long-reference: 0 mismatches in about 60 updates per run (4 without the pending guard, 9 without the child-count check). Patched share about 50% three times (29 of 60), 92% once.
- New test: 0 copies of a list over 100 entries; position moves after 600 px inserted above the page.
- typeset-view 3/3; place, outline, typeset-idle, progressive, progressive-large, pane-scroll, no-displacement 90; minimap and joins 12; typecheck, lint, check green. Verify on `9a774ea0` 11/12, the selection red only.
- Orchestrator merged `agent/drop-floor` (`8395ac8d`) into the branch: tip `2e442113`. Same reviewer reads the delta and runs the verify turn on that tip.
