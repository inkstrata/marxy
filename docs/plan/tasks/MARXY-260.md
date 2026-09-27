---
key: MARXY-260
design: [02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-260]
---
# MARXY-260 — Open a straight quote that follows a Unicode space

**Design:** [02-render](../../design/02-render.md) §Smart typography (D-A13) · **Depends on:** nothing (MARXY-29 already shipped `smarten`) · **ADRs:** ADR-0003 (the file's bytes stay straight; this is a render transform) · **Delta:** [2026-09-27](../deltas/2026-09-27.md) · **Sequencing:** `cross-phase`. MARXY-230 depends on this story because both edit `packages/core/src/render/typography.ts`. Do not start MARXY-230 first.

**Outcome.** A straight quote after a Unicode space opens. On the Keats line in the Commonplace, `"Beauty` after an EM SPACE indent is an opening quote, and the quote after `beauty` still closes.

## What is wrong today
`isOpeningContext` in `packages/core/src/render/typography.ts` is true only for no previous character, ASCII space, tab, CR, LF, `(` and `[`. U+2003 EM SPACE is a space separator and is not in that list, so the quote becomes U+201D. The frontispiece (MARXY-257) strips the EM SPACE only after `smarten` has run, which is why the Keats stanza in `apps/desktop/src/commonplace/pieces/keats-ode-on-a-grecian-urn.md` shows a closing quote at the start of the line. The corpus has no such line, so the goldens do not catch it.

## Files and signatures
- `packages/core/src/render/typography.ts` — `isOpeningContext` is true when the previous character matches Unicode category Zs (`\p{Zs}` with the `u` flag; that includes U+0020, U+00A0 and U+2003), or is tab, CR, LF, `(` or `[`, or when there is no previous character. No new dependency.
- `packages/core/src/render/typography.test.ts` — the cases in the test table below, added to the existing rule table so the idempotence test covers them.
- `docs/taste-review/queue.md` — one row for this key.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Add the failing rule-table cases.
2. Widen `isOpeningContext` to Zs. Do not special-case EM SPACE alone.
3. Confirm the existing rules still pass, including `don't` as a closing single and a quote after a letter as U+201D.
4. Queue row and CHANGELOG. Do not regenerate goldens.

## Tests → expected
| Check | Expect |
| --- | --- |
| `smarten` of U+2003 + `"` + `Beauty` | U+2003 + U+201C + `Beauty` |
| `smarten` of U+00A0 + `"` + `Hi` | U+00A0 + U+201C + `Hi` |
| `smarten` of U+3000 + `"` + `Hi` | U+3000 + U+201C + `Hi` |
| `smarten` of `said"` | `said` + U+201D |
| `smarten` of U+2003 + `"Beauty is truth, truth beauty,"` | first quote U+201C, the quote after `beauty` U+201D; a second call returns the same string |
| `pnpm gate:golden` | green; `git diff -- packages/core/goldens` empty |

## Acceptance → check
CSV 1 → the three space cases and the letter case. CSV 2 → the Keats-line case and the existing idempotence test. CSV 3 → `pnpm gate:golden` and an empty golden diff. CSV 4 → the queue row (name the line and point at `docs/taste-review/2026-09-marxy-257/keats-ode-on-a-grecian-urn-dark-1280-2x.png` as the before; do not add a PNG directory). CSV 5 → `CHANGELOG.md`.

## Do not
- Touch `packages/*/src/contracts/**` or `packages/core/goldens`.
- Skip smartening inside `code` or `kbd` (that is MARXY-230).
- Change the frontispiece. It already removes the EM SPACE after render; the quote has to be right before that.
- Treat an em dash, a letter, or an apostrophe in `don't` as opening context.
