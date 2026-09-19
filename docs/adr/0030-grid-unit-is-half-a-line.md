# ADR-0030 — The grid unit is half the body line box

**Status:** proposed (lands with MARXY-20) · **Amends:** `docs/design-language.md` constraint 2,
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
but marxy's first content types are READMEs and agent artifacts — lists, code and one-sentence
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
- **Indented paragraphs, no spacing:** right for novels, wrong for the content marxy reads first.
  A theme may still choose it; the grid unit is unaffected.
- **Leaving the contradiction and relying on snapToGrid:** padding every other paragraph by half a
  line is the same page with the arithmetic hidden in a script.
