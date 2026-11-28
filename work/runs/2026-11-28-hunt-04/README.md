# Hunt 04

Goal: the bugs a reader meets first in what changed since hunt 03 (windowing and scale-record work, the work
budgets, the automation scripts), so the week plan `work/weeks/2026-11-27.md` has tracker rows to draw its queue
from. Owner reports: none. Run by the owner's session by hand on 2026-11-27 evening (Pacific), one round.

Files: `axes.md` (ten axes planned by an Opus planner, six sent), `briefs/`, `findings.md`, `verification.md`,
`triage.md`, `probes/`.

## Counts

19 findings from six Sonnet catchers; 19 verdicts from five Sonnet verifiers who did not catch them: 18 confirmed,
1 duplicate (DIF-01 of WRK-01), none plausible, none not reproduced. By severity after verification: 0 S1, 10 S2
(one, AUTO-02, lowered to S3), 9 S3. 13 tracker rows were made, B23 to B35: eight S2 rows under Next, five S3
rows under Later.

## Yield, round 1

| Axis | Round | Findings | Confirmed | Plausible | Alone | Shared | Dup. of known | Dup. of another axis | Precision | Rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTO · the merge gate, the governor and the weekly clean decide against the written policy | 1 | 5 | 5 | 0 | 5 | 0 | 0 | 0 | 100% | B25, B26, B32 |
| CAP · a cap landed since hunt 03 drops content silently or fails at its limit | 1 | 4 | 4 | 0 | 4 | 0 | 0 | 0 | 100% | B30, B33, B34 |
| FND · find, select all and copy on a long page still mounting break their promises | 1 | 4 | 4 | 0 | 4 | 0 | 0 | 0 | 100% | B27, B28, B29 |
| DIF · the latest merges broke something they did not touch | 1 | 3 | 2 | 0 | 2 | 0 | 0 | 1 | 67% | B23 (shared), B35 |
| ENC · an edit or save of a non-UTF-8 file names the wrong bytes after the compact byte map | 1 | 2 | 2 | 0 | 2 | 0 | 0 | 0 | 100% | B24, B31 |
| WRK · a big Markdown file parsed in the worker is not the file parsed on the page | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 100% | B23 |

Round 1: 6 axes, 19 findings, 17 found by one axis alone. Overlap: WRK-01 and DIF-01 are one bug.

## What the round showed

- The one finding that matters most is that #829's parse worker never runs in the browser build. It was merged as
  a draft, its tests pass through the page fallback, and `verify --tier changed` does not even run them (B23).
- The merge gate, the clean and presence (AUTO) had five confirmed bugs in code that is two days old. Two are the
  ones to fix before the automation gets more autonomy: the clean's loss of untracked work (B25) and the gate's
  loose reading of markers (B26).
- Find and copy on a page still mounting (FND) keep the same shape as hunt 03's: the model counts text the page then
  changes. L33 replaces that path, so B27 and B28 may fold into it.

## For the next hunt

**Extend**
- **FND**: the unreached half: a kept match across a remake while mounting, Range staleness as idle chunks mount,
  the `rows`, `lines` and PDF viewers, and the per-scroll cost of `ensureWindow` on a 5 MB page.
- **AUTO**: `attribution` in `state.mjs`, the check rollup's `ERROR` status, the 100-comment limit of
  `gh pr list`, `stale-run.mjs` folder archiving and `dashboard.mjs`; and drive the outsider-marker claim of B26
  against a throwaway repository.
- **ENC**: Rust `decode_mapped`, the save and write path, `document/encoding.ts`, UTF-32 and a map across a
  64-record group boundary; one Opus catcher, since two of its bugs were in the map itself.
- **CAP**: #803 positions, and whether Source or hex still holds every byte past each cap.

**Drop**
- None found nothing alone. WRK found nothing beyond the worker that DIF also found: do not run it again until
  B23 is fixed, then rerun it, because with the worker running its real question (equality of the parse) is open.

**Converged** (covered clean by one or more axes; none by two)
- Core handoff against `parseMarkdown` (WRK: all fixtures, 672 random edits): closed until the worker runs.
- `lastReset`, `slotsUntilReset`, `decide` and DST weekends, `codeowners` and the head pin (AUTO): closed.
- Find's stepping to a pending match and the select-all copy of footnotes, tables and code (FND): closed.
- Word, RTF, mail, archive and diff caps at limit and limit plus one (CAP) and the scripts' unit tests (DIF):
  closed. The certificate and paste caps were read, not driven: an Opus catcher or the real window.
- Still waiting in `axes.md`: TWO (two opens at once), SCH (the scheduler's lanes), PRS (whole-file parses outside
  the store), WKT (WebKit).
