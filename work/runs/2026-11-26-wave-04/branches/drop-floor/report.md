# drop-floor: builder report (Sonnet)

Branch `agent/drop-floor`, base `b0d9cb52`. Commit `ffb4cc7e` feat(view): replace changed blocks in small documents too, with no size floor. Tree clean.

Reader: undo, redo, operations, reloads and Source commits on documents under 64 KB replace only the changed blocks; before, the whole page was rebuilt. Documents with footnotes still refuse.

Code: `view/rendered-view.ts` only: `INCREMENTAL_MIN_BYTES`, its comment and the 'a small document' refusal in `splicePageNow` removed (6 lines). `docs/architecture.md` had no mention of the floor left; no doc edit.

## Tests (both in `splice-all.test.mjs`)

- Equality over small documents: chains of apply, undo, redo and Source commits over the 22 footnote-free corpus documents of 1-60 KB; replaced page equals a whole render byte for byte; over 40% of cases splice. Calls `spliceRendered` directly, so passes on master too (proves equality at small sizes, not the floor).
- Mod+Z on a 25 KB page: `how=['replaced']`, fewer than 10 top-level nodes added, every set paragraph keeps `marxy-set`. Fails on master (with the floor restored: "the small page was patched, not set whole").

Existing: live-reload and mode-swap 61/61; no test pinned a whole repaint on a small document.

Verify changed 10/10: unit-desktop 1258/2 skip, unit-desktop-browser 44/1 skip, browser 76. Log `work\wave4\drop-floor-verify.log`.

## Not done

- No code moved out of `rendered-view.ts` (nothing to extract).
- No before/after measurement of the 25 KB undo (X10's numbers stand).

## Orchestrator notes

The reviewer should look for anything that relied on small pages being rebuilt whole as a reset: an image or embed whose state a whole render refreshed, notices, the block editor on small pages, the transcript and readings (`a reading is set whole` still refuses), and a page that grows past or shrinks below 64 KB between edits.
