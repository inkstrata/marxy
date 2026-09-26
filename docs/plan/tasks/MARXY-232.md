---
key: MARXY-232
design: [05-theme]
depends: []
verify: [pnpm precheck, pnpm done MARXY-232]
---
# MARXY-232 — Accept ADR-0036 and add the four diff colour tokens to the theme contract

**Design:** [05-theme](../../design/05-theme.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** nothing.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `diff.colour`, `diff.tints-dark`, `rule.7-token-reader-check`, `proposal.P01`, `proposal.P03`, `proposal.P05`, `proposal.P07`, `proposal.P08`, `proposal.P14`, `hs.diff-tint`.

**Needs a person first.** The author reads `docs/adr/0036-artifact-units.md` (one page, 13 clauses, each with its recommendation) and removes `human-gated` from this row to accept it, or strikes clauses first.

**Outcome.** The decisions the reader-artifacts stories depend on are on record, and themes can colour diffs.

## What is wrong today
ADR-0035 and ADR-0036 are proposed. Four stories (`MARXY-233`, `MARXY-234`, `MARXY-235`, and through them the README and notice stories) wait on this.

## Files and signatures
- `docs/adr/0036-artifact-units.md` — status → accepted, date. If the author struck a clause, carry the strike into every dependent card in a follow-up plan delta, not here.
- `docs/adr/0035-artifact-presentation-follows-the-research.md` — status → accepted, date.
- `packages/theme/src/tokens.css` — the four tokens with a one-line comment each.
- `packages/theme/tokens.contract.json` — names and kind `colour`.
- `docs/theme-contract.md` — a Diff section.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Author reads ADR-0036 and removes the `human-gated` label (or edits the ADR).
2. Implementor flips the statuses and adds the tokens.
3. Update the contract pin in the same PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `pnpm check:tokens` | green, four new names |
| `pnpm test` | contract byte-compare green with the new pin |

## Acceptance → check
1. docs/adr/0036-artifact-units.md and docs/adr/0035-artifact-presentation-follows-the-research.md say accepted with the date, and docs/adr/README.md agrees.
2. packages/theme/src/tokens.css declares --marxy-color-diff-add, --marxy-color-diff-del, --marxy-color-diff-add-word and --marxy-color-diff-del-word with the dark defaults of ADR-0036 clause 6, and packages/theme/tokens.contract.json lists them with kind colour; pnpm check:tokens and pnpm test (the contract byte-compare) are green with the pin updated in this PR.
3. docs/theme-contract.md documents the four tokens and states the marker, not the tint, is the primary cue.
4. The diff of this PR touches only the files in this story's Paths (check:story --strict).
5. CHANGELOG.md has an Unreleased line for this key.

## Do not
- Add the light values to `tokens.css` (they go in `packages/theme/default/theme.css`, owned by `MARXY-235`).
- Add front matter tokens: ADR-0036 clause 7 reuses `--marxy-size-caption`.
- Touch anything outside Paths.
- Touch `packages/*/src/contracts/**` beyond this story's Paths.
