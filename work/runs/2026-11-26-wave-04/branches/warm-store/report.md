# warm-store: builder report (Sonnet)

Commits on `agent/warm-store` (base `b0d9cb52`):

- `f90e82f1` perf(document): keep the last three clean stores warm so a tab switch reads and parses nothing
- `46a0d700` test(save-as): the page the scratch replaced is kept warm with its watch

Reader: returning to a tab (click, Back, Forward) no longer reads, detects, decodes or parses the file; undo history survives (`docs/using-marxy.md`, `architecture.md` updated).

## How

- registry: `release(store,{keep})` leaves a clean, ordinary, <=16 MB store warm; limit 3, oldest evicted (store closes, memory released). New `claim`, `retain`, `drop`, `discard`, `takeUnseen`, `markUnseen`. `held` and `acquire` never see warm stores; `acquire` closes a warm store for its path without forgetting the read record. A store renamed onto a warm path evicts it.
- live-reload: an event with no view showing the store marks it "check on return" (`unseen`) instead of dropping it.
- open.ts: claims the warm store and reads the file only if marked, through `lookForStore` and `store.reload`, looped until no mark remains (including after claim and before the page is made). Gone or unreadable discards the store and the open fails as today. Kind, encoding, recents, index, position and title still decided on return.
- tab-row: `render` calls `stores.retain(tab paths)`, so a closed tab forgets its store, encoding, read record and watch. `pane/index.ts` wired; dropped on an encoding choice.
- Rename follow does not keep the old store; pane close does (the store stays for the tab).

## Correctness

- Stale: marked by event, validated on return. No stat check: a change made within the poll lag before its event is shown stale until the event, then live reload fixes it.
- Dirty stores are never kept; claim re-checks.
- One store per path enforced (no double save).

`view/rendered-view.ts` (small): `pageOf` memoises the sanitised page per parse and policy (`sanitisedPage`, WeakMap); no DOM kept.

## Tests

- New `test/warm-store.test.mjs`: 7 pass; 6 fail with keep disabled (the unsaved-edits test passes on master too). Registry unit tests 12.
- Verify: typecheck, lint, check, unit-desktop 1264, browser-unit pass. Browser 779 pass, 2 fail: `split-narrow` passes alone (load); `save-as-onto-open` a legitimate expectation change, fixed in `46a0d700`.
- Existing expectations changed, reasons in the tests: watch counts in `split-watch`, `pane-set` (leak cycles now bounded 2-3), `live-reload` (previous watch kept), `store-walk-panes` (warm counted as stores, plus invariants).

## Measurement (long-reference tabBack)

shownMs 713 to 349, taskMs 3699 to 3177; short-document shownMs 179 to 141. Record `plan\records\warm-store-after.json`.

Not done: `check:tauri`.

## Orchestrator notes

- Changed expectations in four existing test files: the reviewer must judge each (a leak test now bounded 2-3 is a weakened guard unless argued).
- The stale window: a file changed on disk just before the switch back, with its event not yet delivered, shows old content. The reviewer should decide whether a cheap stat or fingerprint check on claim is needed.
- Memory: 3 stores up to 16 MB each plus their parses and node maps.
