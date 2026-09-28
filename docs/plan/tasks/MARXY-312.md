---
key: MARXY-312
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-312]
---
# MARXY-312 — Don't let pnpm done re-write a stale "done" status when a later run fails

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-4](../deltas/2026-09-28-bugcatch-4.md) · **Depends on:** nothing.

**Outcome.** A reviewer (or the fleet's automated adoption logic) reading a story's stored result JSON never sees a stale "done, all gates ok" record after a later local run has actually failed.

## Why
On a re-run of `pnpm done KEY` where a result already exists on disk, only `acceptance` is refreshed (`mergeResult(existingResult, { acceptance })`) — `status` and `gates` keep whatever an *earlier* successful run wrote, even when this run's own freshly-computed `ok` is `false`. The CLI correctly prints an error and exits 1 without opening a PR, but it has already rewritten the result file with the stale `status: "done"` / all-ok `gates`. `orchestration/review.mjs`'s `buildReview()` embeds that JSON verbatim for a human reviewer, and `validateResult()` only checks schema shape, not truthfulness against current branch state.

## Files and signatures
- `scripts/done.mjs`: when the fresh run's `ok` is `false`, don't leave a stale `status: "done"` / all-ok `gates` object from an earlier run in place — refresh the whole result to reflect the current outcome, or clearly mark the stale record as superseded.

## Tests → expected
| Check | Expect |
| --- | --- |
| An on-disk result with `status: "done"`, then a re-run whose fresh checks fail | the on-disk result no longer claims `"done"` with all-ok gates |

## Acceptance → check
Row acceptance 1–4, checked as listed in the CSV row's acceptance text.

## Do not
- Change what a *successful* re-run writes — only the stale-on-failure case is in scope.
