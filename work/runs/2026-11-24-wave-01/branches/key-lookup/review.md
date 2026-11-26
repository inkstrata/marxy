# key-lookup: review

Saved by the orchestrator from the reviewer's final message. Opus reviewer (the builder was Sonnet), 24 November 2026.

## Verdict: ready, at `3df64d41`

No fixes or commits. The worktree is clean. Typecheck, lint and `pnpm check` (10/10) pass on `3df64d41`. The builder's verify log shows 10/10 steps passing on this same tip, so no second verify turn was run.

## Staleness

`PAGE` and `FENCED` were compared with the invalidation clause by clause:

- Those selectors depend only on `data-marxy-reading`, `data-marxy-derived` and `data-marxy-part`, a `pre`'s class, and `marxy-part` on any element. The attribute filter covers all of them.
- Every way a root can arrive goes through an added node checked with `matches` or `querySelector(WATCHED)`. That includes `innerHTML`, `replaceChildren`, a moved root (remove plus add) and a subtree whose descendant matches.
- Removing a node can never create a root, and any removal that contains the cached root marks the answer stale.
- Changes made in the same task are caught because `takeRecords()` runs first.

No hole found. One cosmetic over-invalidation: any class change on a `pre` (for example the cursor landing on a code block) causes one rescan.

## Observer cost

Measured with `C:\Dev\reader\work\wave1\key-lookup\observer-cost.test.mjs`. WebKit's clock is too coarse to time one call, so a copy of the filter was replayed 50 times over each batch. One observer covered the open of the 195 KB page (9,181 nodes): 114 callbacks, 5,358 records (4,436 childList, 922 class). The callback cost about 2.0 ms in total, at most 0.06 ms per call. `takeRecords` ran 17 times and returned 32 records. Six `j` presses added 240 `takeRecords` calls returning 57 records. For scale, one old whole-article scan costs 0.74 ms in WebKit. The total is small, so no narrower observation is needed.

## Lifetime

One observer per article element, and pane articles are reused across documents. It is never disconnected, but it goes when its article goes. `lifetimes.test.mjs` passes 4/4, with observers steady at 33 across rounds, and "a closed pane's view, page and document can be collected" passes. `scripts/check-listeners.mjs` does not count observers.

## Real drives

In `C:\Dev\reader\work\wave1\key-lookup\late-roots-real.test.mjs`, 2/2 pass:

- The long Markdown page, `j` (the lookup remembers "no reading"), then opening `40-session.jsonl` in the same pane: the transcript view arrives late and the cursor reads "turn · you".
- The long page, then `run.log` in the same pane: the cursor reads "entry".

"Show as" was not driven for real: `kind.show-as.*` on a `.md` does not draw a reading, and a `g r` attempt timed out.

## Mutations

- Old `reading-parts.ts` plus old `frame.ts` restored: test 1 fails ("six keys made 240 scans"), test 3 fails, and test 2 passes, as the builder said.
- `mayChangeRoot` forced to false: test 2 and both real drives fail.

All restored with `git checkout`.

## Docs

No document describes the lookup, and none needs to.

## To file for later

Limit the `pre` class clause to changes in the `language-log`, `language-diff` and `marxy-run` tokens; make "Show as" draw a reading so it can be driven in a test.

## Orchestrator's notes

- Ready for integration. The two real-drive tests the reviewer wrote are outside the repository; they would be worth adding to the branch's test file (they fail when the invalidation is disabled, which the committed synthetic test also does, but they drive the real views). Not required for landing.
- Handler time on the long page has still not been measured after the change; the integration measurement covers it.
