# typeset-view: review (Opus)

**Verdict: not ready.** No commits; tip `fe53c0ed`, tree clean.

## Ran

typecheck, lint, check 10/10 green. Place, persistence, Source, outline, spine (minimap, joins), no-displacement files, two at a time: 95/95. Mutations on the builder's file: position cache off fails test 2; `discard` false fails test 3; test 1 calls `updateBlocks` directly, so it cannot tell how the app calls it. `discard` passed only where the article is really replaced (`clear`, `rerenderFromBuffer`, `mountDerived`): fine.

## Must-fix 1: the patched block list almost never runs, and when it does it can be stale

- A temporary check (not committed) compared every `snapChanged` result with a fresh build over a scenario (open a long page, scroll while type is set, narrow and widen, Source and back, an outside edit, open `long-reference`): of 76 `snapChanged` calls, 70 fell back to a full build, all "notchild".
- Cause: highlighting and the image/maths/diagram resize path pass the inner element (`code`, `pre.marxy-math-block`), not the top-level block; `updateBlocks` returns null. The "highlight batch costs a few reads" goal is not met in the app; the builder's counts measure the fallback.
- With the fallback: 0 mismatches. With `changed` wrapped in `topLevelOf` so patching runs: 4 mismatches: a code block's height stale (a colour report still waiting in the once-a-frame coalescer); a progressively mounted chunk missing (its full rebuild only scheduled). The old whole rebuild hid both. The visible-pass path patches today and has the same exposure, and `holdAnchor` runs straight after it on the patched list.
- Suggested repair: map to top-level blocks; patch only when no snap is scheduled, `changedBlocks` is empty and no coloured report is pending; otherwise build whole. The differential test must go through the app's own path.

## Must-fix 2: the position cache can serve a stale position in the same frame

A 600 px element inserted above `#doc`, then `view.position()` again in the same task: cached 34710, fresh 33910. The cache key leaves out `contentOffset`. The width-change case with scroll offset unchanged matched a fresh read (the list had not been rebuilt yet). View: the in-place search already removes the copying, so the cache saves little; drop it or key it on the offset, and change test 2 to count searches.

## Gains

Apart from the fallback: discard on teardown, the in-place position search, spine writes on change, `edgeOf` once per pane. The 3-35% recalc figures were on a loaded machine and settle nothing.

Scenario test: `C:\Users\<user>\AppData\Local\Temp\claude\910f9a44fbe890f8\84f1d3cd-7446-43b1-8c69-a5c7873e0069\scratchpad\zz-review-blocks.test.mjs` (needs the temporary check in `snapChanged`, not in the tree).

## Delta review (same reviewer)

**Verdict: ready after my fix.** Tip `b8f378af`, tree clean; verify 12/12 on that tip, browser 522/0.

- The builder's fixes hold. A splice that replaces N blocks with N rebuilds the whole list and its replaced elements are disconnected, so it is covered twice. Fonts: `loadingdone` schedules a snap and the typesetter's font relayout builds whole. Images, maths, colour: the island resize observer runs before the IntersectionObserver callbacks. Margin notes are placed by absolute `top`. The colour counter can only fail towards "pending" (a whole build).
- Gap fixed: some height changes reach no guard (a `<details>` opening under wide HTML; a block edited in place growing via `followGrowth`). The patch checked only block 0 above the first changed block and each kept run at its first entry only; reproduced with a hidden height change above a resizing image (entry 50 onward stale). `view/block-list.ts` now reads the block just above the first changed one and the last entry of every kept run, building whole if either moved differently (about two extra reads per run). New test fails without it.
- Worth keeping? Correct as far as testable, but it saves only the cheap part (once layout is forced each read is cheap) and needs a global counter and five guards for a ~50% share. Keep only if integration measurement on `long-reference` shows `buildBlocks` costing whole milliseconds per update; otherwise drop it and keep the in-place search, `discard`, spine writes on change, `edgeOf` once per pane.

## Integration red, settled (same reviewer)

`typeset-defaults.test.mjs` "app.ts attach() does not pass hyphenate or hanging..." failed on this branch (passes on master): `startTypeset`'s `onPass` became a block body, and the test's `attach\(article, \{([^}]+)\}\)` stopped at the first `}`. Test-only fix `5b1f47f7`: options read to the matching brace with `//` comments stripped; the onPass assertion expects the new form (background schedules a snap; a visible pass naming paragraphs runs `snapChanged` over their top-level blocks; else `snap`). Loosening: an option word only in a comment no longer fails. Mutations (adding `hyphenate: false`, adding `hanging`, changing `lastLineMinWidth`, changing `onPass`) each fail. `typeset-defaults` + `typeset-view` 7/7; typecheck, lint, check 10/10.
