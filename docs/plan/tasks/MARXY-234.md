---
key: MARXY-234
design: [02-render, 05-theme, 12-outline]
depends: [MARXY-232]
verify: [pnpm precheck, pnpm done MARXY-234]
---
# MARXY-234 — Show front matter as a quiet document head, GitHub alerts by their label, and diagram fences with a caption

**Design:** [02-render](../../design/02-render.md) · [05-theme](../../design/05-theme.md) · [12-outline](../../design/12-outline.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-232.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `vanish.front-matter`, `readme.alerts`, `readme.diagram-caption`, `rule.1-tint-not-alone`, `rule.2-grid-multiple`, `verify.taste`, `proposal.P08`, `taste.same-book`, `taste.front-matter`, `taste.alert-warning`, `taste.truncation`, `hs.front-matter-head`, `hs.alerts-label-first`, `hs.registry-hygiene`.

**Outcome.** A SKILL.md opens with its name, description and globs visible in a small, quiet head above the title; a README's `> [!WARNING]` reads "Warning" as a run-in word; a Mermaid fence says what it is.

## What is wrong today
`render-html.ts` returns `''` for `frontmatter`. Alerts: handbook [06](../../research/reader-artifacts/06-readmes.md) and [09](../../research/reader-artifacts/09-colour-access.md). Diagrams stay unrendered (ADR-0036 clause 11).

## Files and signatures
- `packages/core/src/render/render-html.ts` — the `frontmatter` case: a `dl`-shaped head, keys in the label voice, values verbatim, nested lines in the code face, never parsed-and-reprinted.
- `packages/core/src/render/alerts.ts` — new: recognise `[!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` as the first line of a blockquote.
- `packages/core/src/outline/outline.ts` — TOML `title`.
- `packages/theme/src/base.css` — head: `--marxy-size-caption` lines on the grid, 14ch key column; alert word semibold at body size; caption muted. Every unit a grid multiple (ADR-0030).
- `scripts/registry.json` — the head, alert and caption classes, first.
- `fixtures/corpus/26-skill-front-matter.md` — new: a SKILL.md-shaped file with a 1,024-character description and 15 keys.
- `fixtures/corpus/27-alerts.md` — new: all five alerts, one titled, one legacy.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Registry names.
2. Front matter head and outline.
3. Alerts.
4. Diagram caption.
5. Goldens, grid check, queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| 15-key YAML | 12 lines then `3 more` |
| `+++ title = "x" +++` | head and outline entry `x` |
| `> [!WARNING]\n> text` | `Warning` run-in, no `[!WARNING]` text |

## Acceptance → check
1. A new packages/core/src/render/frontmatter.test.ts asserts YAML and TOML front matter render as a key and value head showing every key, capped at 12 lines with a text count of the rest, carrying provenance and copying as the source bytes.
2. A new packages/core/src/render/alerts.test.ts asserts the five GitHub alert types render a run-in type word and no marker text, a custom title replaces the word, a legacy > **Note** is untouched, and no alert sets a colour, background, border or icon.
3. render tests assert a mermaid fence renders its source plus one caption `mermaid · diagram source` and nothing else.
4. packages/core/src/outline tests assert a TOML front matter title yields the first outline entry, as YAML does.
5. pnpm gate:golden regenerated with fixtures 26 and 27; gate:aesthetics grid check green with the head at 16, 20, 24 and 28 px; pnpm check:registry green with every new class registered first.
6. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `26-skill-front-matter.md` and `27-alerts.md`, dark and light, before/after.
- Question: Confirm or tune: head quiet enough that the title still reads first; Warning noticed without a box. (Defaults: caption size, 14ch keys, 12 lines; label-only alerts.)

## Do not
- Add tokens (clause 7).
- Add an icon, box, fill or colour to alerts.
- Collapse the head at rest: hiding it is a summoned toggle (v1.1 lens).
- Render Mermaid.
- Touch `packages/*/src/contracts/**`.
