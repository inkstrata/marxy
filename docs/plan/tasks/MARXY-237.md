---
key: MARXY-237
design: [02-render, 13-trust]
depends: [MARXY-233, MARXY-48, MARXY-97]
verify: [pnpm precheck, pnpm done MARXY-237]
---
# MARXY-237 — Show a README's badges as one masthead line and its collapsibles folded on the grid

**Design:** [02-render](../../design/02-render.md) · [13-trust](../../design/13-trust.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-233, MARXY-48, MARXY-97.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `vanish.details`, `readme.badges`, `readme.hero-align`, `rule.3-folding-is-view`, `verify.keyboard`, `verify.taste`, `taste.same-book`, `taste.marker-quietness`, `hs.details-honoured`, `hs.badge-hero-picture`.

**Outcome.** The top of a real-world README reads like a masthead, and its collapsible sections open and close like GitHub's, with Find still reaching inside them.

## What is wrong today
Handbook [06](../../research/reader-artifacts/06-readmes.md); `02-readme-real-world.md` today.

## Files and signatures
- `packages/core/src/render/badges.ts` — new: the badge-line pass.
- `apps/desktop/src/render/images.ts` — badge images in the line, reserved boxes.
- `apps/desktop/src/find/` — open closed `details` ancestors of a match (MARXY-48's module).
- `packages/theme/src/base.css` — summary as a bold run-in line with a text glyph; the open body inset; grid multiples.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Badge line.
2. Details styling and button semantics.
3. Find into details.
4. Goldens, queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| three adjacent shields | one line `build · coverage · licence` |
| Find a word in a closed details | it opens, match at reading position |

## Acceptance → check
1. badges.test.ts asserts two or more consecutive image-only links collapse to one line of alt texts joined by a middle dot with their links kept, and a single image link is untouched.
2. With a grant applied, badge images load on the grid in that line, asserted in apps/desktop/test/remote-images.test.mjs, and gate:no-network stays green.
3. gate:aesthetics grid check green with a closed and an open details in fixtures/corpus/25-readme-layout.md; the summary is a real button with aria-expanded, asserted in apps/desktop/test/details.test.mjs.
4. apps/desktop/test/details.test.mjs asserts Find opens the closed ancestors of a match and "open all" is a view state that changes no bytes.
5. pnpm gate:golden regenerated; pnpm check:registry green.
6. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `02-readme-real-world.md` and `25-readme-layout.md`, blocked and allowed, dark and light, before/after.
- Question: Confirm or tune: badge line reads as a masthead; details marker and inset. (Defaults: middle-dot alt line; text glyph ▸/▾; one-grid inset.)

## Do not
- Change the sanitiser (done in `MARXY-233`).
- Fetch an image outside MARXY-97's path.
- Stripe tables (declined).
- Touch `packages/*/src/contracts/**`.
