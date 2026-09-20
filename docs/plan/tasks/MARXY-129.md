---
key: MARXY-129
design: [05-theme]
depends: [MARXY-128, MARXY-133, MARXY-139, MARXY-145]
verify: [node scripts/check-tokens.mjs, node --test packages/theme/test/grid.test.mjs, pnpm gate:specimen]
---
# MARXY-129 — Tune pair A: the mono size and the heading voice

**Design:** [05-theme](../../design/05-theme.md), `docs/design-language.md` (the type scale) · **ADRs:** ADR-0015 (pair A, accepted), ADR-0031 (values are taste) · **Review:** [2026-09-review-0](../../taste-review/2026-09-review-0/decisions.md) · **Depends on:** MARXY-128, MARXY-133.

**Outcome.** The three tunes review #0 left when it confirmed pair A: *A's inline code is slightly small
and B's mono was preferred at 2×*, *A's headings shout while B's are too quiet*, *numbered-list markers
look weird on both*. A tune, not a swap — Literata and JetBrains Mono stay. It edits values in
`packages/theme/src/tokens.css`, which is only legal once MARXY-133 has replaced that file's byte pin
with the name-and-unit check.

## Files and signatures
- `packages/theme/src/tokens.css` — values only: `--marxy-size-code` up a step, `--marxy-line-box-code`
  kept a whole multiple of the grid unit, `--marxy-weight-heading` down. No name added or removed.
- `packages/theme/src/base.css` — `ol` markers: tabular figures, secondary colour, right edges aligned
  in the hanging margin; any heading rule the new weight needs.
- `packages/theme/test/` — three named cases: the x-height match at the new code size (the canvas probe of
  `gate-aesthetics.mjs` check 8); the heading weight ceiling, the ≥ 120-unit gap over body and hierarchy
  from size and weight only (check 7); marker alignment across a one-digit and a two-digit item.
- `docs/taste-review/2026-09-marxy-129/` — review #0 passages 2 (inline code) and 4 (heading stack), 1×
  and 2×, before and after.

## Do this, in order
1. Write the three checks against today's values; the first two are red at the target and green at the
   current values or the reverse — either way, paste the run that shows each case can fail.
2. Move `--marxy-size-code` one step and check the x-height ratio; if the match breaks, the step is
   wrong, not the assertion.
3. Lower `--marxy-weight-heading` until the stack stops shouting and the gap over body still reads.
4. Fix the `ol` markers.
5. `node scripts/check-tokens.mjs` (values only), grid test, `pnpm gate:specimen`. Render the artifacts,
   add the queue row, `pnpm done MARXY-129`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `check-tokens.mjs` | green; only values changed |
| the three named cases | each shown failing once, then green |
| `grid.test.mjs` | green — the code line box is still a whole unit |
| `pnpm gate:specimen` | green; `docs/design-language.md` unchanged |

## Acceptance → check
The seven criteria on the CSV row.

## Do not
Swap a face or a pair (ADR-0015 is accepted). Change `--marxy-measure`, `--marxy-scale-ratio` or the
type scale. Add, remove or re-kind a token. Touch a font file or anything under `apps/`. Start before
MARXY-133 has merged: editing `tokens.css` fails `pnpm test` until then, and the pin is not yours to
move.
