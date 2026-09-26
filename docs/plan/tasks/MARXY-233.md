---
key: MARXY-233
design: [13-trust, 02-render]
depends: [MARXY-232, MARXY-229, MARXY-44]
verify: [pnpm precheck, pnpm done MARXY-233]
---
# MARXY-233 — Keep instruction-file tag content, record every removal, and admit inert README layout HTML

**Design:** [13-trust](../../design/13-trust.md) · [02-render](../../design/02-render.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-232, MARXY-229, MARXY-44.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `vanish.xml-tags`, `vanish.removals`, `vanish.instruction-class`, `vanish.details`, `readme.hero-align`, `readme.picture-variants`, `verify.probe`, `proposal.P01`, `proposal.P03`, `hs.keep-xml-tag-content`, `hs.details-honoured`, `hs.badge-hero-picture`.

**Outcome.** An `AGENTS.md` or prompt file shows everything inside its XML-style tags; every thing the renderer removes is recorded so the app can tell the reader; README heroes keep their centring and sizes, collapsibles work, and a dark-mode logo shows only in dark mode.

## What is wrong today
Handbook [02](../../research/reader-artifacts/02-agent-artifacts.md), [06](../../research/reader-artifacts/06-readmes.md), [07](../../research/reader-artifacts/07-trust-safety.md); probe cases `prompt-xml-block`, `html-comment`, `details-blank-line`, `picture-dark`. MARXY-44 builds the grant and the notice; this story narrows the grant to images (ADR-0036 clause 4) and hands the notice its removal records. The notice UI itself is `MARXY-238`.

## Files and signatures
- `packages/core/src/sanitize/policy.ts` — instruction-class list as one exported constant (ADR-0036 clause 2); keep-children rule; inert attributes and `details`/`summary` in the default list.
- `packages/core/src/sanitize/` — removal records with kind and byte range, including never-closed removals MARXY-44 already reports.
- `packages/core/src/render/pipeline.ts` — the `<details>` pairing pass; the tag-name label as a registered class.
- `packages/core/src/render/picture.ts` — new: pure `resolveVariant(hast, variant)`; one URL, parsed single-URL `srcset` only.
- `fixtures/corpus/24-instruction-file.md` — new: an AGENTS.md-shaped file with `<instructions>`, `<example>`, two comments, an unreferenced definition and a `<script>`. The instruction-class test uses its logical name `AGENTS.md`.
- `fixtures/corpus/25-readme-layout.md` — new: centred hero, sized image, `<picture>`, gh-mode fragment pair, closed and open `<details>` with a blank-line body.
- `docs/design/13-trust.md` — the grant section narrowed to images.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Vectors and fixtures, failing.
2. Removal records.
3. Instruction-class keep-children.
4. Default-policy attributes and `details`; pairing pass.
5. Picture resolution.
6. Goldens, design doc, queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| `<instructions>do X</instructions>` in AGENTS.md | `do X` visible, label `instructions` |
| same in README.md | removed, and a removal record |
| `<!-- hidden -->` | one record, kind `comment` |
| `<script>` | removed with contents everywhere |
| `<p align="center"><img width="120">` | both attributes survive |

## Acceptance → check
1. packages/core/src/sanitize/vectors.test.ts asserts an unknown element in an instruction-class file keeps its children and records its tag name as a label, the same element in README.md is removed as today, and script, style, iframe, object, embed and form are removed with their contents in both.
2. The sanitiser returns a removal record {kind, start, end} for every comment, unknown element and unreferenced link reference definition, asserted in vectors.test.ts on fixtures/corpus/24-instruction-file.md.
3. packages/core/src/sanitize/policy.test.ts asserts align on div, p and h1-h6, width and height on img, and details/summary with open as a boolean survive the default policy, and on* and style attributes do not.
4. pipeline.test.ts asserts a <details> whose body follows a blank line contains that body, with provenance from the open tag to the close.
5. picture.test.ts asserts a <picture> and a #gh-dark-mode-only / #gh-light-mode-only pair resolve to one img for each variant, and gate:no-network with a grant applied requests only that one.
6. pnpm gate:golden regenerated with fixtures 24 and 25; pnpm gate:no-network green; docs/design/13-trust.md says the grant widens remote images only.
7. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `24-instruction-file.md` and `25-readme-layout.md`, dark and light, before/after.
- Question: Does the inline tag label read as the author's structure? (Default: tag name in the label voice, muted.)

## Do not
- Build the notice UI (`MARXY-238`) or the image fetch (MARXY-97).
- Style details (the README story owns `base.css` for it).
- Flag injection-looking prose (declined in the handbook).
- Touch `packages/*/src/contracts/**`.
