---
key: MARXY-241
design: [10-gates-and-testing, 05-theme]
depends: []
verify: [pnpm precheck, pnpm done MARXY-241]
---
# MARXY-241 — Gate every colour pair and honour forced colours, contrast preference, reduced motion and 320 px reflow

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · [05-theme](../../design/05-theme.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** nothing.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `rule.7-token-reader-check`, `verify.contrast`, `verify.grid`, `verify.forced-colours`, `proposal.P14`, `hs.contrast-gate-all-pairs`, `hs.media-query-rules`.

**Outcome.** No colour Marxy or a theme sets can fall below the contrast floor without CI saying so, and the page still works for readers who force their own colours, ask for more contrast, or read at 320 px.

## What is wrong today
Handbook [09](../../research/reader-artifacts/09-colour-access.md).

## Files and signatures
- `scripts/gate-aesthetics.mjs` — the pair walk, the media emulations, the 320 px pass, `--selftest` cases.
- `packages/theme/src/base.css` — the three media-query blocks.
- `packages/theme/test/media-queries.test.mjs` — new.
- `docs/aesthetics-acceptance.md` — what the gate runs.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Selftest fixture that must fail.
2. Pair walk.
3. Media emulations and reflow.
4. base.css rules.
5. Docs.

## Tests → expected
| Check | Expect |
| --- | --- |
| `--selftest` low-contrast link | fails |
| 320 px corpus | no horizontal page scroll |

## Acceptance → check
1. gate:aesthetics fails a fixture in which a link, a kbd or a table head is below 4.5:1, shown by --selftest.
2. The gate:aesthetics contrast pass covers every text-bearing computed style and every text-on-tint pair declared in the theme, for every fixtures/themes theme and both variants, unrounded.
3. gate:aesthetics renders the corpus under forced-colors: active, prefers-contrast: more and prefers-reduced-motion: reduce, and at 320 px and 400 % zoom asserts no page-level horizontal scroll.
4. packages/theme/test/media-queries.test.mjs asserts base.css contains the three media queries.
5. docs/aesthetics-acceptance.md matches what the gate runs.
6. CHANGELOG.md has an Unreleased line for this key.

## Do not
- Round a contrast ratio.
- Mark a failing pair as known-bad; fix it or fail.
- Move a perf number onto the PR path.
- Touch `packages/*/src/contracts/**`.
