# typeset-waste: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Sonnet builder, 24 November 2026.

Branch `agent/typeset-waste`, one commit: `10b8fa32` perf(typeset): stop reads and passes nobody uses. Files: `packages/typeset/src/index.ts`, new `packages/typeset/test/unused-work.test.mjs`, 4 lines in `docs/themes-and-type.md` (Scheduling).

## What changed (nothing the reader sees; every paragraph still ends up set the same)

1. `destroy({ discard: true })` disconnects observers, change watcher and listeners, bumps the generation (queued steps and observer callbacks go inert) and reverts nothing. Plain `destroy()` is unchanged.
2. `setBatch` returns `{ moved, set }`. Both IntersectionObserver callbacks call `onPass('visible', set)` only when `moved`. `onPass` is now `(kind, set?)`: `viewport` and `background` passes also hand over the paragraphs they set. The viewport pass still calls whenever it set something. `set` is every paragraph the batch left set (a superset of those whose height changed).
3. `layout()` no longer reads every candidate. Tops are monotonic in document order, so two bisections (first top >= viewport bottom; first top > 0) plus a short walk back over paragraphs straddling the top edge find the screen. The queue is the rest in document order outward from the screen, alternating one below and one above. What changed: it was sorted by pixel distance from the screen's middle, now by index distance with below/above alternating. Same paragraphs, same "nearest first" sense; a page of very unequal paragraph heights could order differently.
4. Kill switch: one read per batch. `inBatch` caches the verdict the step or observer callback just read, so `resetChanged` inside the batch no longer reads again (2 to 1). `adopt()` no longer reads it: the step that takes the paragraphs reads it before setting any. The kill switch acts no slower than one batch. Edge: adopt while killed now schedules a step that aborts and resolves `done`, instead of returning early.

## Measured (counts)

- Layout reads (`getBoundingClientRect`, Element and Range `getClientRects`) from attach to `ready`: before 239 at 200 paragraphs, 2039 at 2,000; after: within 16 of each other (test bound).
- Kill-switch reads: a batch that rewrites a marked paragraph 2 to 1; adopt 1 to 0.

## Tests

- `pnpm --filter @marxy/typeset test`: 87 pass, 0 fail (existing suite unchanged, including "chunks end with every paragraph set as one pass sets them" and the keep-place tests). typecheck and lint pass.
- `verify-turn.sh typeset-waste` (changed tier) on the tip: 9/9 steps passed, unit-typeset 87 pass, browser 16 pass. Log `C:\Dev\reader\work\wave1\typeset-waste-verify.log`.
- Revert-and-fail (`index.ts` restored to master, new file run, then restored): reads-at-attach FAILS (239 / 2039), discard FAILS, both visible-pass tests FAIL, kill-switch reads FAILS. Passing on old code by design: the outward-queue test (pins the new order) and "destroy without an option restores exactly" (pins the default).

## Not done / not verified

The order test pins chunk-level nearness only. No timing measured; not tried in the running app.

## For the view (`apps/desktop/src/view/rendered-view.ts`)

- `destroyTypeset()` has four callers. Pass `discard` where the article's content is thrown away straight afterwards: the one before `shown = { html ... }` (about line 2400, a new page replaces the article) and the clear/close one (about 2456). The one at about 1864 (view leaving: `store = null; shown = null`) can too if the article is then emptied or replaced, as it appears to be; check. Not the one in `startTypeset` (about 2320): it destroys before attaching a new typesetter to the same article, which still holds the old breaks, so it must revert. Suggest `destroyTypeset(discard = false)` calling `typeset?.destroy(discard ? { discard: true } : undefined)`.
- `onPass: (kind, set)`: visible passes now arrive only when heights moved, so `snap(article)` on `visible` is no longer wasted. `set` lets the view later re-pad only the top-level blocks of those paragraphs (and those after them) instead of the whole article; `background` keeps `scheduleSnap`. Ignoring `set` is correct today.

## Orchestrator's notes for the reviewer

- "Tops are monotonic in document order" is the assumption the bisection rests on, and it is not true everywhere. The candidates are `p[data-marxy-s], li[data-marxy-s], dd, figcaption`. A table row whose first cell holds three paragraphs and whose second holds one has a later paragraph with a smaller top than an earlier one; so does a definition list laid out in columns, a figure floated beside text, and any multi-column reading. Where the order breaks inside the screen, the bisection can miss paragraphs that are on screen. Find out what then happens to them (the on-screen IntersectionObserver may catch them a frame later, which would show as a moment of unset type) and whether the first screen of such a page is set in the first pass as it is on master. Build the cases and compare with master.
- The view answers a visible pass with a grid pass. Before this change a visible pass that set paragraphs without moving lines still triggered it; if anything relied on that pass happening (the block list refreshed after a set, a held position re-applied), it no longer does. Check `apps/desktop/src/view/rendered-view.ts`'s `onPass` handler and what else runs inside `snap`.
- "Adopt while killed now schedules a step that aborts and resolves `done`": confirm nothing awaits `done` expecting it to stay pending, and that no step runs after `destroy`.
- This branch is wave 2: it goes to Ian, not into wave 1.
