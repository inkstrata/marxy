# key-lookup: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Sonnet builder, 24 November 2026.

Commit: `3df64d41` perf(parts): find the reading page once per drawing of the article, not once per call (branch `agent/key-lookup`, from `17cfe661`).

What changed for the reader: nothing visible. Keys on a long Markdown page and the palette's command checks no longer scan the whole article each time.

## Change

- `apps/desktop/src/parts/reading-parts.ts`: `readingRoot` keeps its answer per article, with a MutationObserver on the article. The answer is dropped when a node holding a page or a fence is added, when a removed node holds the cached root, when a `data-marxy-reading`, `-derived` or `-part` attribute changes, or when a `pre` or fence class changes. Cursor repaints (class on parts) and the typesetter's line spans do not drop it. `takeRecords()` is read first, so a change made in the same task is seen before the observer callback runs. An emptied or redrawn article is a childList change.
- `apps/desktop/src/source/frame.ts`: `setText` writes `hidden` and `title` only when they differ.
- `scripts/verify-map.json`: new test listed under parts.

## Measured (195 KB `32-long-reference.md`, once the page is set, 6 presses of `j`)

- Reading-page scans: 240 before (40 per key), 0 to 1 after.
- Handler time not re-measured with the profilers; the scan was about 38 ms of the key handler in the evaluation.

## Tests (`apps/desktop/test/reading-root-lookup.test.mjs`, 3 tests, pass 3)

1. Long page, six `j` presses, at most 1 scan; waits on 30 quiet frames, no sleeps. Revert-and-fail: with the old `reading-parts.ts` it fails with "six keys made 240 scans".
2. Late and departing roots: node added in the same task as the previous look, removed, attribute set and cleared, a `pre` gaining run classes, a reading inside a fence and out of it, the article emptied and redrawn. Revert-and-fail: with `mayChangeRoot` forced to false it fails. It passes on the old code, since it guards the cache.
3. Typing in Source writes no `hidden` or `title` attribute on the facts bar. Revert-and-fail: with the old `frame.ts` it fails.

Related files run: cursor, kinds-cursor, transcript, frame-tables (33 pass).

## Verify

Tip `3df64d41`, log `C:\Dev\reader\work\wave1\key-lookup-verify.log`: 10 of 10 steps pass. unit-scripts 243 pass; unit-desktop 1319 pass, 1 skip; browser 477 pass, 3 skip. typecheck, lint and check also green alone.

## Not done or not verified

No dev-server handler timing before and after. Late-root coverage for "Show as", progressive mount and transcript views rests on the synthetic DOM cases plus the existing kinds-cursor and transcript files passing.

## Calls the orchestrator should know about

An observer-backed cache was chosen over a scoped query because reading roots can sit anywhere in the article (a log's `pre`, a derived view, a fenced part). Class changes on any element other than a `pre` or a fence are ignored on purpose.

## Orchestrator's notes for the reviewer

- The cache is kept honest by a MutationObserver over the whole article subtree. While type is being set on a long page the typesetter writes thousands of nodes and attributes, every one of which becomes a record this observer must look at. Find out what that costs: count records delivered and time spent in the observer's callback (and in `takeRecords()` on each lookup) across an open of the 195 KB document. If it is more than a few milliseconds in total, the observer should watch less (childList on the article's direct children plus a narrow attribute filter) or be replaced by invalidation from the code that draws readings.
- Is the observer created once per article and released with it, or does it leak one per article element across opens? `apps/desktop/test/lifetimes.test.mjs` counts observers with connected targets; `scripts/check-listeners.mjs` counts listeners.
- "Show as", a progressive mount still appending, and the transcript view are covered only by synthetic cases: drive each for real once.
