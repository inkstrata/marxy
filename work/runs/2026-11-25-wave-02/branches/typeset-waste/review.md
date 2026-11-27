# typeset-waste: Opus review

Reviewer of record, started 16:55. Saved by the orchestrator from the reviewer's text report.

**Verdict: ready after its fix.** The reviewer committed one fix, `1051e339`, on top of `9759222f`. The verify turn passed 9/9 on it (unit-typeset 90 pass, browser 16 pass, 17:09 to 17:12). The worktree is clean.

**How it checked.** It read the diff `17cfe661...HEAD` itself and ran scratch pages in the package harness against both the branch and master (`review\outflow.mjs`). It also ran typecheck, lint, check and the package suite.

- **Bisection where paragraph tops are out of order.** `9759222f` is sound for tables, folded sections and columns: it bisects over the article's top-level blocks and reads every paragraph inside the blocks the screen meets. Its test fails if the bisection goes back to paragraphs.
  - One case was missing: a top-level box placed out of the flow. Margin notes are exactly that, and they are on by default (`notes_in_place`): absolutely placed boxes appended at the end of the article, holding copies of paragraphs.
  - On the branch, a note on screen was not set by the first pass at three scroll positions; master set it.
  - The fix leaves absolute, fixed and floated blocks out of the bisection and reads their paragraphs one by one. That costs one style read per top-level block and no extra layout reads. A new test covers it.
- **`adopt()` and the kill switch.** Confirmed as a visible change: after the kill switch flipped with the background finished, adopting a paragraph un-set the whole page (120 set paragraphs to 0), where master left it set. The reviewer restored master's check, with a test.
- **`destroy({ discard: true })` callers.** There are none yet.
- **`onPass` with no lines moved.** The view's only listener is `snap`. Its grid padding, block list and held place all depend on heights, so skipping it when nothing moved loses nothing.

**Mutations** (all on `unused-work.test.mjs`, 10 tests; each restored afterwards; log `review\mutate.log`):

| Mutation | Tests failing |
| --- | --- |
| Out-of-flow blocks ignored | 1 |
| `adopt` ignores the kill switch | 2 |
| Visible pass always announced | 1 |
| `discard` ignored | 1 |
| Kill switch not cached for the batch | 1 |
| Bisect over paragraphs instead of blocks | 2 |

**To file for later:**

- The out-of-flow check reads the style of every top-level block (about 1,245 on the reference page). They are not layout reads, but their number grows with the page.
- A top-level `display: contents` block would count as hidden; the app has none today.
- The view's four `destroyTypeset` callers still need `discard` passed where the page is thrown away, as the builder describes.

## Orchestrator's notes

- Checked: the branch is `10b8fa32`, `9759222f`, `1051e339` over master; the worktree is clean; `typeset-waste-verify.log` ends `9/9`, exit 0 at 17:12:46 on a turn started 17:09:51.
- This is a wave-2 branch: it goes to Ian, not into `agent/wave1`. Not tried in the running app; layout reads not re-measured with the measuring tool after the fix.
