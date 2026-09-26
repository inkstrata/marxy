---
key: MARXY-230
design: [03-selection-and-operations, 02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-230]
---
# MARXY-230 — Copy code, kbd and sections byte for byte, and never add a newline the source did not have

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) · [02-render](../../design/02-render.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** nothing.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `copy.exact-code`, `copy.trailing-newline`, `rule.6-code-weight-no-smart`, `verify.copy-fidelity`, `proposal.P06`, `hs.copy-exactness`, `hs.copy-section-html`.

**Outcome.** What a reader copies from code is exactly what the file says: no curly quotes or en dashes inside code or keys, no newline that runs a command on paste, and a copied section keeps every character of its text.

## What is wrong today
Handbook [07](../../research/reader-artifacts/07-trust-safety.md) and [05](../../research/reader-artifacts/05-diffs-provenance.md), measured: smart typography reaches `kbd`; `copy-code-clean` appends `\n` to any non-empty block; `copy-section` runs two regular expressions over rendered HTML to strip provenance attributes, and they also match document text.

## Files and signatures
- `packages/core/src/render/typography.ts` — skip `code`, `kbd`, `samp`, `pre` subtrees whatever produced them (markdown or raw HTML).
- `packages/core/src/operations/copy-code-clean.ts` — keep the source's final newline state; never add one.
- `packages/core/src/operations/copy-section.ts` — strip provenance by walking the HAST/DOM attributes, not by regex over serialised HTML.
- `packages/core/src/operations/operations.test.ts` — acceptance 2 and 3.
- `packages/core/src/render/typography.test.ts` — acceptance 1.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Failing tests for all three defects.
2. Typography skip list.
3. Newline rule.
4. copy-section without regex.
5. Goldens, CHANGELOG.

## Tests → expected
| Check | Expect |
| --- | --- |
| `<kbd>--frozen-lockfile</kbd>` rendered | text is `--frozen-lockfile` with two hyphens |
| copy of a fence whose source ends `ls\n` then the closing fence | `ls` (the fence's newline before the closer is not content; match the source bytes of the code only) |
| copy of a fence whose code ends in a blank line | that blank line kept |
| section containing `` `a data-marxy-k="9" b` `` | clipboard text and html contain `a data-marxy-k="9" b` |

## Acceptance → check
1. packages/core/src/render/typography.test.ts asserts no quote, dash or ellipsis substitution inside code, kbd, samp or a fence, including those opened by raw HTML.
2. packages/core/src/operations/operations.test.ts asserts a block copy ends with a newline only if the source bytes did, and a one-line fence copies with none.
3. operations.test.ts asserts the clipboard html of a section holding the inline code `a data-marxy-k="9" b` and an html fence keeps their text byte for byte, and a test reading copy-section.ts asserts the two attribute-stripping regular expressions are gone.
4. pnpm gate:golden and pnpm gate:fidelity green; any golden diff is inside kbd/samp/code only.
5. CHANGELOG.md has an Unreleased line for this key.

## Do not
- Change drag-selection copy in prose (design 03 keeps rendered text; ADR-0036 clause 5).
- Resolve drag selections to byte spans (P06 §3; not in this story).
- Add new operations: `copy-command` and the rest are v1.1 (docs/scope.md).
- Touch `packages/*/src/contracts/**`.
