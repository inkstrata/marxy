# Handoff: geometry table, phase 1 (prior design for the windowed-pages research)

Branch `agent/geometry-table`, archived as tag `archive/branch/geometry-table-rebuild-phase1` (cf4986cb). Built on
2026-11-27 on `main` as a rebuild of the lost wave 5 branch (accounts, reports and reviews of that build are in
`work/runs/2026-11-26-wave-05/`). On the owner's change of direction (windowing as the architecture for Markdown pages),
this is **held**: the windowed-pages research reads it as a candidate E22 design; it is not to be rebased or landed as is.

## Done (phase 1)

- `apps/desktop/src/view/block-geometry.ts`: one entry per top-level block (element, byte range, top, height,
  measured or estimated), kept from ResizeObserver reports, so mounting a chunk reads no layout.
- `packages/core/src/position/geometry.ts`: the pure parts (search by byte and by offset, runs, invalidation).
- `positionNear` and `scrollTopNear` in `apps/desktop/src/position/position.ts`; `innerBlocks` in `render/post.ts`
  (refactor only).
- Guards for the four bugs wave 5's reviewers found: margin notes kept out of the table (they made out-of-order
  entries, so the last ~20% of a long reference read a footnote's byte as the place); a margin-only change caught (each
  run checked at its last block, halved where they disagree); inner positions dropped when an item grows inside a list
  of unchanged size; readers that read the table in a frame told again the next frame, and only they (the 20,000-heading
  outline's late crumbs).
- Tests: core `position/geometry.test.ts` 10/10; browser `block-geometry.test.mjs` 5/5 on the shared kit (compares the
  table with the page after each kind of change, and the place with a whole block list). Each guard was removed once
  and a test failed. `check-scale` passes (three reads marked `// scale:`).
- Nothing in the app reads the table yet: no change for the reader.

## Phase 2 plan, as the builder left it (all in `apps/desktop/src/view/rendered-view.ts` unless named)

1. Make the table beside `blocksOf`, destroy it with the view. `currentPosition` uses `positionNear`; `restoreTo` uses
   `scrollTopNear`. The transcript view keeps its own list. The table's `onMoved` re-tells the scroll listeners.
2. Reads that go: the `shown.blocks = blocksOf(doc)` lines in rows/lines `onDrawn`, `mountThrough`, `snap`, `snapWhole`,
   `relayoutForTheme`, the splice path and the block-edit path; `updatedBlocks` and `block-list.ts`. The table still
   needs an `onSettled` callback (the place is put back from it, before paint) and `measureNow()` for the synchronous
   cases. Grid passes call `forgetInner`.
3. `showRendered`: `snap(doc)` runs only when the page is stale or its width changed while hidden.
4. `holdPlace`: read the element under the line before and after the change (two reads in all).
5. `blockContaining` and `landOn`: search the table by byte.
6. `blocks()` returns the entries for `frame/spine.ts`.
Also: update `typeset-view.test.mjs`, the docs, and the tracker row.

Checks to run when it lands, from wave 5's history: the `outline-rows` 20,000-headings test alone, and `live-reload`,
`mode-swap` and `splice-all` (wave 5's integration failed them alone).

## Numbers that bear on the node budget

Windows Chromium, Markdown prose, main-thread task time from open until quiet (branch `agent/scale-measure`, L27):
0.25 MB 1.5 s (24.5k nodes), 0.5 MB 5.3 s (45k), 1 MB 30 s (81k), 2 MB and 4 MB still busy at the 2-minute cap (160k
nodes at 4 MB). WebKit and Edge runs and the report are on that branch's pull request.
