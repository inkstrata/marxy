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
- `packages/typeset/src/grid.ts`: account for margin-collapse changes caused by its own padding insertions — e.g. re-measure the affected siblings after each push, or compute the push from the actual collapsed/uncollapsed state rather than a pure running accumulator.

## Tests → expected
| Check | Expect |
| --- | --- |
| Two adjacent elements with default collapsing margins, where a grid push on the first would break the collapse | the second element still lands on-grid |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
