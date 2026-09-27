---
key: MARXY-235
design: [02-render, 05-theme]
depends: [MARXY-232, MARXY-241]
verify: [pnpm precheck, pnpm done MARXY-235]
---
# MARXY-235 — Diffs, console sessions, logs and escape bytes read without colour carrying the meaning

**Design:** [02-render](../../design/02-render.md) · [05-theme](../../design/05-theme.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-232, MARXY-241.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `code.long-lines`, `code.log-level`, `code.ansi`, `code.console`, `diff.colour`, `diff.tints-dark`, `diff.tints-light`, `diff.continuation`, `rule.1-tint-not-alone`, `rule.4-marker-display-only`, `verify.forced-colours`, `verify.taste`, `proposal.P07`, `proposal.P13`, `taste.same-book`, `taste.marker-quietness`, `taste.diff-palette`, `taste.truncation`, `taste.continuation-rule`, `hs.diff-tint`, `hs.console-and-ansi`.

**Outcome.** A diff in a plan or transcript shows added and removed lines at a glance, and still reads in greyscale because the `+` and `-` do the work; a console session reads as prompt and output; a log's ERROR stands out by weight; terminal escapes are visible instead of silent.

## What is wrong today
Handbook [03](../../research/reader-artifacts/03-structured-output.md), [05](../../research/reader-artifacts/05-diffs-provenance.md), [09](../../research/reader-artifacts/09-colour-access.md); probe `ansi-in-fence`. Tint values are measured (chapter 9), not taste.

## Files and signatures
- `packages/core/src/highlight/scopes.ts` — map `markup.inserted`/`markup.deleted` to line classes; a line-prefix pass on `.marxy-line`.
- `packages/core/src/highlight/` — allow-list `shellsession` (aliases `console`, `bash session`), `jsonl`, `log`; the log level weight class.
- `apps/desktop/src/render/highlight.ts` — ESC glyph, long-line elision (display only).
- `packages/theme/default/theme.css` — the light tint values of ADR-0036 clause 6.
- `packages/theme/src/base.css` — tint backgrounds; `prefers-contrast: more` border fallback from the handbook token sketch; continuation hang.
- `scripts/allowlists/` — the three grammars with their licences.
- `fixtures/corpus/28-artifact-fences.md` — new: a diff with a long wrapped line and a no-newline marker, a console session, a log, an ANSI-coloured output, a 5,000-character minified JSON line.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Registry names.
2. Diff classes and tints.
3. Console and log grammars.
4. ESC glyph and long lines.
5. Goldens, queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| `+added` in a diff fence | class `marxy-diff-add`, text `+added` |
| `$ ls` in a console fence | `$` punctuation, `ls` command, output plain |
| `\x1b[31mred\x1b[0m` | `␛[31mred␛[0m` visible, copy has 0x1B |

## Acceptance → check
1. packages/core/src/highlight/highlight.test.ts asserts inserted and deleted lines carry marxy-diff-add and marxy-diff-del, hunk headers and the `\ No newline` line carry neither, and the + or - stays in the text.
2. packages/theme/test/palettes.test.mjs asserts every Marxy token is at least 4.5:1 on all four diff tints in both variants, unrounded, and gate:aesthetics reads the tints (the a11y-gates pair walk).
3. The diff continuation row hangs at least 2ch past the marker column, asserted by the gate:aesthetics block walk on fixtures/corpus/28-artifact-fences.md.
4. highlight.test.ts asserts a console fence classes the $ prompt as punctuation and leaves output unclassed, and a log fence carries the level word in the registered weight class with no hue.
5. A render test asserts ESC renders as a visible ␛ glyph and copy yields the 0x1B byte, and a line over 1,000 characters draws its first 200 plus a count marker while copy takes every byte.
6. pnpm gate:licences green with shellsession, jsonl and log recorded in scripts/allowlists; pnpm gate:golden regenerated.
7. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `28-artifact-fences.md` dark and light, before/after, plus a deuteranopia simulation of the diff.
- Question: Confirm or tune the tints. (Defaults: measured values of chapter 9; added raised, removed near the ground.)

## Do not
- Render ANSI colour (declined).
- Add a scroller (ADR-0036 clause 10).
- Allow-list `csv`.
- Colour the marker or the text.
- Touch `packages/*/src/contracts/**`.
