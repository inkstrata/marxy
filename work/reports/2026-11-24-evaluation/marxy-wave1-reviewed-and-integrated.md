# Wave 1 reviewed and integrated

24 November 2026, evening. What the last few passes did: all six wave-1 branches are reviewed ready and merged into one integration branch, both wave-2 branches are reviewed ready for your call, and the first experiment is done. Master has not moved; it is still `17cfe661`.

## Where it stands

Every branch that was built has now had a review on a different model from its builder, and every review ended ready. Five of the eight needed a fix, and the reviewer made each one itself. All six wave-1 branches are merged into `agent/wave1` (tip `f99eed3e`) without a conflict, and the checks that guard the merge seams pass there.

Not done yet, in order: the last small clean-up branch (`residue`, being built now), the full verify on `agent/wave1` (about an hour, holding the whole machine), the before-and-after measurement, and the fast-forward of master. You said master may move for wave 1 once those pass. Nothing after wave 1 lands without coming to you first.

| Branch | Wave | Verdict | Fix by the reviewer |
| --- | --- | --- | --- |
| `key-lookup` | 1 | ready | none |
| `perf-record` | 1 | ready after a fix | the record counts nodes put in as well as taken out, leads with counts, and warns when two records differ |
| `first-click` | 1 | ready after a fix | a margin note is copied again when its markup changes; the verb-bar test now catches the whole-page restyle coming back |
| `grammars-once` | 1 | ready after a fix | no font is inlined as a data: URL, so KaTeX's Size3 face loads under the release security policy |
| `verify-defaults` | 1 | ready after a fix | a change to the shared test helpers also runs the desktop unit tests |
| `dead-code` | 1 | ready after a fix | removes the verify-map entry for a folder the branch deleted |
| `typeset-waste` | 2 | ready after a fix | margin notes are set at the first pass again; the typesetting switch is honoured again |
| `definitions-index` | 2 | ready, two reviews | tests only: three cases that were missing |

## What changes for the reader, once wave 1 lands

- **Moving the cursor on a long page** stops re-scanning the whole article for every lookup. Six key presses on the 195 KB reference page went from 240 whole-article scans to none or one.
- **The first click on a long page** stops forcing a whole-page restyle. Style recalculation went from 177 ms to 27 ms on the 195 KB page, and margin notes are no longer rebuilt on every click.
- **Smaller app.** Each code-highlighting grammar ships once instead of twice, and KaTeX ships only woff2 fonts. A fresh build of that branch has 596 JavaScript files totalling 15.4 MB, against master's 883 files and 22.0 MB.
- **Maths still draws.** All 20 KaTeX faces load from woff2 in Edge, the engine the app ships with, and the picture is pixel for pixel the same as master's. Without the reviewer's fix one face would not have loaded at all in the release build.
- **Less dead weight.** About 3,000 lines of source and 2,600 lines of tests for code nothing reached are gone (66 files changed, 25 deleted), along with two unused chunks.
- **Faster checks for whoever works on it.** A changed-tier verify ran in about 21 minutes on the branch that changes it, against 30 to 38 minutes on the others. The desktop unit step used to take 360 s, one file at a time. Its files that need no browser now run side by side in about 90 s, and the four that start a browser take another 195 s.
- **A measuring tool.** `perf:interactions` records what the reader feels on a long page (open, cursor key, first click, undo, reload, tab switch, Source to Read) as counts and timings, so later waves can show a number moving rather than claim it.

These figures come from the builders and reviewers, each on its own branch. The measurement of the integrated branch against master's baseline has not been taken yet; it is the step before landing.

## Wave 2: ready for your call

Both branches are reviewed and verified. Neither goes into master without your word.

**`typeset-waste`** stops the typesetter doing work nobody uses. Layout reads from opening a page to ready no longer grow with the page: 239 at 200 paragraphs and 2,039 at 2,000 before; within 16 of each other after. Its reviewer found and fixed two real regressions the builder's tests missed:

- margin notes on screen were left unset at the first pass;
- flipping the typesetting switch could un-set a whole page (120 paragraphs to 0).

It has not been tried in the running app.

**`definitions-index`** lets a one-line edit to a file with link or footnote definitions re-parse just the region around the edit instead of the whole file: 144 ms to 1.3 ms on the 195 KB reference.

- Two reviewers, on Sonnet and then on Opus, each wrote their own search for an edit where the two parses differ.
- Together they tried more than 245,000 edits and found none. The same search finds thousands of differences when the mechanism is deliberately broken, so it is able to catch a fault.
- You will not see the gain yet: the page update still refuses on documents with footnotes until a later branch.
- The plan's claim that this would also speed up opening large files was wrong, and is corrected in the plan.

## The first experiment: what the test engine supports

X9 asked which of the next wave's browser features the test suite's engine (Playwright's WebKit 26.6) can exercise.

| Feature | WebKit, the test engine | Edge, the shipped engine |
| --- | --- | --- |
| Skipping layout for off-screen blocks, and its event | yes | yes |
| Holding the page still when content is added above | yes | yes |
| `scheduler.yield` and `scheduler.postTask` | no | yes |

So most of the next wave can be tested where the tests already run. Anything that relies on the scheduler needs a small set of tests run in Edge. Running ten test files in Edge took about 6.5 minutes and needs nothing installed, but two of the ten fail there and are not yet explained. One guess for one of them is that the test browser reports a Mac.

## What went wrong along the way

- **Two sessions orchestrated at once.** This session took over believing the planning session had stopped, because the session list showed it as not running. It had not stopped, and for about twenty minutes two reviewers worked in some of the same worktrees.
  - Two of the live reviewer's deliberate test-breaks in `definitions-index` were undone mid-test.
  - The duplicates were stopped, nothing committed was lost, and the affected checks were rerun from scratch.
  - The planning session then hit its usage limit, and its reviews were restarted here, one reviewer per worktree.
- **One builder's numbers were wrong.** `grammars-once` reported sizes from an out-of-date build. The reviewer's fresh build is the figure above.
- **One test fails under load on master's own code.** `source-looks` checks Source's Markdown colours as soon as the lines appear, before they are coloured. It failed in three branches' verify runs, none of which touches that code, and passes alone on master. A fix is drafted and kept for a later branch.

## Not verified

- Nothing in wave 1 or wave 2 has been seen in an installed build or a real window. `pnpm work installer` is yours to ask for.
- The full verify and the measurement of `agent/wave1` have not run.
- Maths was checked in Edge and WebKit pages, not in the app's own window.
- The two Edge failures from X9 are not explained.

## Filed for later

- The real-window check has no maths test.
- The bundle gate checks whatever build is on disk and verify does not build first, so an out-of-date build can pass it.
- The check that keeps browser-starting tests out of the side-by-side step reads only the test file, not what it imports.
- `source-looks` should wait for its colours; the patch is drafted.
- The typesetter's off-flow check reads one style per top-level block, which still grows with the page.
- The page's root padding should be recomputed when the window chrome changes size while the verb bar shows.
