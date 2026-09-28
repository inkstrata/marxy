---
key: MARXY-281
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-281]
---
# MARXY-281 — Guard the ragged-line badness calculation against a NaN or non-finite font size

**Design:** [04-typeset](../../design/04-typeset.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A NaN or non-finite stretch value (e.g. from an unparseable computed font size) is caught explicitly instead of silently poisoning every line-break cost comparison.

## Why
`breakRagged`'s badness is `Math.min(INF_BAD, 100 * (shortfall / stretch) ** 3)`. `Math.min` propagates `NaN` rather than clamping it, so if `stretch` (derived from `settings.stretchEm * fontSize`) is `NaN`, every `cost < best[k]` comparison in `pass()` is `false` (NaN comparisons are always false), `best[k]` never updates, and the paragraph falls back to 'overfull' in a way indistinguishable from a genuinely too-narrow measure — nobody can tell a metrics bug from real overflow.

## Files and signatures
- `packages/typeset/src/ragged.ts`: detect a non-finite stretch/font-size before the badness calculation and handle it explicitly (throw with a clear message, or treat the line as definitely overfull).

## Tests → expected
| Check | Expect |
| --- | --- |
| A NaN or otherwise non-finite stretch input | the new explicit handling fires, not a silent `Infinity` fallback for every candidate |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.

## Do not
- Silently coerce NaN to 0 or Infinity without a comment — a future reader needs to know why.
