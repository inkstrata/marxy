# ADR-0030 — The grid unit is half the body line box

**Status:** accepted, amended (Amendment 1 — a table is an island the grid pass pads, 2026-09-19) · **Amends:** `docs/design-language.md` constraint 2,
`docs/design/05-theme.md`, `docs/design/04-typeset.md` §Grid, `docs/design/10-gates-and-testing.md` check 1

## Context

Constraint 2 said every vertical space is an integer multiple of the body line box (28 px), and
the same page's type scale put 14 px between paragraphs. Both cannot hold. The base stylesheet as
designed (`p { margin-bottom: calc(lb / 2) }`) would put every second paragraph half a line off
the grid, so the grid gate would have failed by construction on the first document with two
paragraphs. The note that "two half-line gaps sum to a whole line" is true of the sum and false
of every block top in between, which is what the gate measures.

There are three ways out: a whole line between paragraphs, no space and a first-line indent, or a
grid of half lines. A whole blank line at 17/28 reads as double spacing and makes a README of short
paragraphs fall apart. Indented paragraphs are the book convention and would be lovely for prose,
but Marxy's first content types are READMEs and agent artifacts — lists, code and one-sentence
paragraphs — where an indent reads as a mistake.

## Decision

1. The grid unit is **half the body line box** (14 px in the default theme). Every block's top edge
   sits on a multiple of it, ± 0.5 px. Body lines remain whole line boxes, so within a paragraph the
   rhythm is the line box; between blocks it is the half.
2. The type scale's numbers are unchanged and now all consistent: 14 between paragraphs, 56 / 34 /
   22 around an h2, 28 above an h3, code blocks 28 above on a 22 px line box padded to the unit.
3. The stylesheet constructs the grid wherever it can. A heading's margin below is
   `half + mod(−(line box + margin above), half)`: always between half a line and a line, so a
   heading never sits on its paragraph at any size, and 22 falls out at 17 px. Tables sit on the grid
   by construction (one line box per row, rules drawn as inset shadows that take no height). Inline
   code and keyboard keys set `line-height: 1` so a run in another face never grows its line.
4. What the stylesheet cannot construct — code on its own line box, images, math, inline content
   in a raw-HTML island — `snapToGrid` pads, measuring the result rather than predicting it.

## Consequences

- The aesthetics gate's grid check divides by `lineBox / 2`. A theme that sets an odd line box
  gets a half-pixel unit; the default theme and the sizes the gate runs keep it even.
- "A long document never drifts" still holds: every top is a whole number of units from the
  article's top, however many blocks come before it.
- Heading line boxes grow past their tokens when a reader enlarges the type (the tokens are px):
  `max(token, 1.2 × size rounded up to 2 px)`, capped at two line boxes.

## Rejected

- **Whole-line paragraph spacing:** double-spaced at the default size; READMEs fall apart.
- **Indented paragraphs, no spacing:** right for novels, wrong for the content Marxy reads first.
  A theme may still choose it; the grid unit is unaffected.
- **Leaving the contradiction and relying on snapToGrid:** padding every other paragraph by half a
  line is the same page with the arithmetic hidden in a script.

## Amendment 1 — a table is an island the grid pass pads (2026-09-19, MARXY-141)

**Status:** accepted · **Source:** the MARXY-128 review of PR #94 (`orchestration/results/MARXY-128.notes.md`)

This amendment supersedes the table clause of decision 3 and the `snapToGrid` enumeration in
decision 4. The original numbered decisions remain as first written; nothing above is deleted.

**What it supersedes.** Decision 3's sentence "Tables sit on the grid by construction (one line box
per row, rules drawn as inset shadows that take no height)" no longer holds. Tables move out of
decision 3's by-construction list and into decision 4's `snapToGrid` set.
A table is an island the grid pass pads — `snapToGrid` measures it rather than the stylesheet constructing it.

Decision 3's heading construction is restated: a heading's margin below is `half`, and a
`padding-bottom` remainder closes the line box onto the unit. Decision 2's 22 px total at 17 px is
unchanged — the remainder moved from the margin into padding, so a reader should not think the type
scale moved.

Decision 4, as this amendment supersedes it, is: what the stylesheet cannot construct — code on its
own line box, images, math, inline content in a raw-HTML island, and tables — `snapToGrid` pads,
measuring the result rather than predicting it.

**Consequence.** The CSS-alone guarantee no longer covers a document containing a table.
`grid.test.mjs`'s `TEXT_ONLY` set — the set the stylesheet alone must hold, without `snapToGrid` —
therefore narrows to `14-marxy-plan.md`. Re-adding `01-long-technical.md` at PR #94's head failed
with ten blocks 8 px off the 14 px unit, starting at the first block after the weighted-passes
table. The ten measured offsets from the MARXY-128 review: `<p s=3308> top 2122.00`,
`<h3 s=3354> top 2178.00`, … `<h2 s=4709> top 2850.00`. Every corpus file still passes after the
grid pass, so the page is correct in the app. What moved is the "CSS alone" guarantee, and this
amendment records that cost rather than letting it happen quietly.

**What would falsify it.** If a table can be made a whole number of grid units by construction at
any cell padding the design wants, this amendment is wrong and decision 3 stands.

**Unchanged, deliberately:** decision 1 (the grid unit is half the body line box); decision 2, whose
22 px total at 17 px is unchanged.

## Checks (MARXY-141)

These commands fail if this amendment is reverted. They are the acceptance checks.

```sh
adr=docs/adr/0030-grid-unit-is-half-a-line.md
theme=docs/design/05-theme.md
grep -q '## Amendment 1 — a table is an island the grid pass pads (2026-09-19, MARXY-141)' "$adr"
grep -q 'Tables sit on the grid by construction (one line box per row, rules drawn as inset shadows that take no height)' "$adr"
grep -q 'code on its own line box, images, math, inline content' "$adr"
grep -q 'into decision 4'\''s `snapToGrid` set' "$adr"
grep -q 'padding-bottom' "$adr"
grep -q "Decision 2's 22 px total at 17 px is unchanged" "$adr"
grep -q 'TEXT_ONLY' "$adr"
grep -q '14-marxy-plan.md' "$adr"
grep -q '<p s=3308> top 2122.00' "$adr"
grep -q '<h3 s=3354> top 2178.00' "$adr"
grep -q '<h2 s=4709> top 2850.00' "$adr"
grep -q 'If a table can be made a whole number of grid units by construction at' "$adr"
grep -q 'this amendment is wrong and decision 3 stands' "$adr"
grep -F '| [0030](0030-grid-unit-is-half-a-line.md) | The grid unit is half the body line box | accepted, amended (1: a table is an island the grid pass pads, 2026-09-19) |' docs/adr/README.md
sentence="A table is an island the grid pass pads — \`snapToGrid\` measures it rather than the stylesheet constructing it."
grep -F "$sentence" "$adr"
grep -F "$sentence" "$theme"
grep -q 'MARXY-141' CHANGELOG.md
```
