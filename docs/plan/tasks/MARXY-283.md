---
key: MARXY-283
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-283]
---
# MARXY-283 — Give the justif engine's hyphen breakpoints their own demerits

**Design:** [04-typeset](../../design/04-typeset.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** The justif engine's hyphenation choices match the TeX-faithful quality model the ragged engine already implements (or a documented, deliberate departure from it).

## Why
`items.ts` assigns a hyphenation breakpoint the exact same penalty as an explicit dash (`settings.dashPenalty`) whenever `engine: 'justif'` is selected (`index.ts`), with no equivalent of `ragged.ts`'s `doubleDashDemerits`/`finalHyphenDemerits`. Two consecutive hyphenated lines, or a hyphen stranding a short fragment on the paragraph's last line, cost nothing extra under this engine — a real divergence in hyphenation aesthetics/correctness from what ADR-0033 and `ragged.ts` describe as the intended model, whenever a caller opts into `justif`.

## Files and signatures
- `packages/typeset/src/items.ts`: give a hyphen breakpoint its own penalty distinct from `dashPenalty`.
- `packages/typeset/src/index.ts`: wire the justif pass to apply consecutive-hyphen and final-line-hyphen demerits, mirroring `ragged.ts`, unless ADR-0033 gives a documented reason the two engines should differ here.

## Tests → expected
| Check | Expect |
| --- | --- |
| A paragraph where justif would otherwise produce two consecutive hyphenated lines | an equally good non-hyphenated break is preferred |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.

## Do not
- Change ragged.ts's existing demerits — this story is about bringing justif in line with it, not the reverse.
