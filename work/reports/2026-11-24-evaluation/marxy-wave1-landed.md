# Wave 1 landed

24 November 2026, night. Master is now `978b8251`, fast-forwarded from `17cfe661` under your word to merge wave 1 when verified. Two wave-2 branches are reviewed and wait for your call.

## What landed

Seven branches, each reviewed ready on a different model from its builder, merged into one integration branch and verified there as a whole:

- `key-lookup`: the cursor no longer re-scans the whole article for each lookup.
- `first-click`: the first click no longer restyles the whole page, and margin notes are kept and moved rather than rebuilt.
- `grammars-once`: each code-highlighting grammar ships once, KaTeX ships only woff2 fonts, and no font is inlined, so every maths face loads under the release security policy.
- `dead-code`: about 3,000 lines of source and 2,600 of tests for unreachable code are gone.
- `verify-defaults`: the changed-tier verify runs side by side and takes about 21 minutes where it took 30 to 38.
- `perf-record`: `pnpm perf:interactions`, a recorded measurement of open, cursor key, first click, undo, reload, tab switch and Source to Read.
- `residue`: process ids out of about 370 comments and 105 test names, the unread 545-entry class list gone, and the prose about CI jobs that no longer exist removed.

## Before and after

Measured with the new tool on the 195 KB reference document. The rows compare master's baseline with the landed code. The baseline was recorded while two verify runs loaded the machine, and the landed run was on a quiet machine, so every duration below is flattered by that. Counts are not affected by load, and they are what the verdict rests on.

| On the 195 KB document | Before | After |
| --- | --- | --- |
| First click: layouts / style recalculations | 9 / 13 | 6 / 9 |
| First click: handler time | 188 ms | 10 ms |
| First click: style recalculation time | 266 ms | 10 ms |
| Cursor key: script time | 57 ms | 6.5 ms |
| Cursor key: handler time | 82 ms | 23 ms |
| Open: layouts / style recalculations | 567 / 1,034 | 396 / 675 |
| Undo: top-level nodes replaced | 2,763 | 2,463 |
| Reload of one line: top-level nodes put in | 2,739 | 2,467 |

| Built app | Before | After |
| --- | --- | --- |
| JavaScript files | 883 | 589 |
| JavaScript size | 22.0 MB | 13.9 MB |
| A grammar shipped twice | yes | no |

- The first click and the cursor key did what was claimed: the work that grew with the page is gone.
- The cursor key handler is 23 ms, not the 10 ms the plan expected. Its scanning cost is gone; what remains is the key's own work.
- Undo and reload still rebuild the page, as expected for this wave. They replace about 300 fewer nodes because margin-note boxes are now kept. Making them replace a handful of nodes is the next wave's main work.
- The bundle is 8.1 MB smaller, against the 7.7 MB the evaluation predicted.

## Verification

- The full verify on the integration branch passed 17 of 18 steps, including the release build and the real-window check (117 of 117).
- The browser step had 2 failures in 2,504 tests. Each failing file passed alone three times out of three, so by the landing rule both are load:
  - `source-format`: the column-80 ruler.
  - `source-looks`: a race in master's own test that checks Markdown colours before they arrive. It failed under load in four runs, never alone on master. A fix is drafted for a later branch.

Not verified:

- Nothing has been seen in an installed build. `pnpm work installer` is yours to ask for, if you want to try it in the real app.
- Maths was checked in Edge and WebKit pages, not in the app's own window.

## Wave 2: for your call

Both branches are reviewed and verified on their own. Neither is merged.

- **`typeset-waste`** stops the typesetter doing work nobody uses. Layout reads from open to ready stay flat as the page grows: 239 at 200 paragraphs and 2,039 at 2,000 before; within 16 of each other after. Its reviewer found and fixed two regressions the builder missed: margin notes on screen were left unset, and flipping the typesetting switch could un-set a whole page. It has not been tried in the running app.
- **`definitions-index`** lets a one-line edit to a file with link or footnote definitions re-parse around the edit instead of the whole file: 144 ms to 1.3 ms on the reference. Two reviewers searched more than 245,000 edits for a wrong parse and found none. You will not see the gain until the page update stops refusing on footnotes, a later branch.

Both were cut from the old master, so each needs master merged in and verifying again before it can land. Say which, if either, should go in, and I will bring it to you integrated and measured.

## Next, per the plan

With wave 1 in master, the next starts are:

- X1, the skipped-layout spike (Opus);
- `splice-all`, the in-place page update for undo and reload;
- `verify-lock`, moving the verify-slot arrangement into `verify` itself;
- the three shell branches: `one-listing`, `search-handle`, `scope-keys`.

X9, the first experiment, found the test engine can test the next wave's layout features, but anything using `scheduler.yield` or `scheduler.postTask` needs a small set of tests in Edge.

Round 16, another session's work, has not landed. When it does, it is merged into whatever is in flight and a new baseline is taken.
