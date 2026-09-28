---
key: MARXY-282
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-282]
---
# MARXY-282 — Re-measure baseline-grid pushes instead of predicting margin-collapse deltas

**Design:** [04-typeset](../../design/04-typeset.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A long document does not drift off the baseline grid when a grid push on one element changes whether its margin collapses with the next sibling's.

## Why
`grid.ts`'s baseline-grid enforcement predicts each subsequent sibling's shifted `top` by accumulating `moved += short` from the padding it adds to the previous sibling, never re-measuring after writing. CSS collapses adjacent sibling margins only when nothing (no padding/border) separates them; writing `padding-bottom` onto a child whose margin was previously collapsing with the next sibling's `margin-top` stops that collapse, so the real gap grows by the pushed amount *plus* the previously-collapsed margin — not just the pushed amount. Every `top` computed after the first pushed element can then be wrong, which is exactly the drift the module's own docstring says never happens.

## Files and signatures
- `packages/typeset/src/grid.ts`: account for margin-collapse changes caused by its own padding insertions — re-measure the next sibling after each push. The module comment must not claim a fixed three layouts (design [04-typeset](../../design/04-typeset.md) §Grid).
- `apps/desktop/src/theme/user-theme.ts`: `relayoutKeepingPosition` restores scroll after the grid pass has settled.
- `apps/desktop/test/user-theme.test.mjs`: `config theme applies after first_text with #marxy-theme and keeps scroll position` stays within 8px. Do not loosen the assertion.

## This attempt
PR #271 (head `9d422f1a`) is the remeasure. `browser` failed because that test went from scrollTop 400 to 409. Fix the restore in `user-theme.ts`. Do not revert `grid.ts` and do not widen the 8px bound.

## Tests → expected
| Check | Expect |
| --- | --- |
| Two adjacent elements with default collapsing margins, where a grid push on the first would break the collapse | the second element still lands on-grid |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
