# Design language — six constraints and a type scale

These are the **default theme's** rules, stated so a screen can be judged against them and so
a theme author can be told which of them they may change (`theme-contract.md`). They are
enforced by the mechanical aesthetics gate where a machine can check them (ADR-0014).

## The six constraints

1. **Optical measure, not pixel width.** The column is capped in `ch`, 65–70 characters,
   so it holds at whatever size the reader chooses. Every incumbent caps in `px`, which
   degrades the measure exactly when a reader enlarges the type to read more comfortably.
   *Gate:* measure between 60 and 75 `ch` at every size from 14 to 24 px.
2. **One baseline grid.** Every vertical space is an integer multiple of the body line box
   (28 px in the default theme). Headings, code, images, lists, quotes and math land on it.
   The point is that a long document never accumulates drift; a reader is judged on the fourth
   page. Themes set the unit; marxy enforces the multiples. *Gate:* every block's top edge
   sits on a grid line ± 0.5 px across the corpus.
3. **Space belongs above.** A heading gets ~2.5× more space above than below, binding it to
   what it introduces. Getting this backwards is what makes Obsidian's default feel wrong.
4. **Hierarchy from size and weight only.** No coloured headings, no rules as decoration, no
   boxes around callouts by default. Colour is for links and one sparing accent. If the
   hierarchy is not legible in greyscale it is decoration. *Gate:* lint of the default theme.
5. **Monospace is a voice, not a size.** Code is a different family at a matched x-height,
   on its own line box that is still a grid multiple; never the body face at `0.85em`.
6. **Chrome at rest is zero.** Rendered mode at rest is a column of text and nothing else.
   Everything is summoned by intent and dismissed. This is the constraint convenience erodes
   first: every affordance will feel worth 32 px of permanent chrome, and none is.

## Type scale (default theme)

Ratio 1.25 from a 17 px base, line heights snapped to the 28 px grid. Literata for text,
JetBrains Mono for code (ADR-0015).

| Role | Size / line | Weight | Tracking | Space above |
| --- | --- | --- | --- | --- |
| Title (h1) | 33 / 40 | 600 | −0.014em | — |
| Section (h2) | 27 / 34 | 600 | −0.011em | 56 px |
| Sub (h3) | 21 / 28 | 600 | −0.006em | 28 px |
| Body | 17 / 28 | 400 | 0 | 14 px |
| Code block | 14 / 22 | 400 | 0 | 28 px |
| Caption, meta | 13 / 20 | 400 | 0.01em | 14 px |

17 px because desktop reading distance is greater than a phone's and a serif at 16 loses its
italics. Headings at 600 not 700: hierarchy comes from size; 700 in a text serif shouts. The
Linux build applies `--marxy-weight-offset` (measured, ADR-0010) to keep rendered weight
matched to macOS.

## The four hard problems behind "reading experience"

- **Fidelity.** CommonMark + GFM, passing the spec suite. Sanitise always (ADR-0009). Smart
  typography — real quotes, dashes, ellipses, non-breaking spaces before short last words —
  as a render pass, never written back.
- **Navigating long documents.** A summoned outline that tracks scroll; reading position
  remembered per file (ADR-0018); find that lands a match at the reading position, not the
  viewport edge; a progress readout that is honest about remaining length, no time estimates.
- **Embedded code.** Highlight at parse time; long lines soft-wrap with a hanging indent;
  never a scrollbar per block; copy without highlight markup.
- **Images, math, diagrams.** Reserve intrinsic dimensions before decode so the column never
  reflows mid-read (a correctness requirement: the line breaker measures against it). KaTeX
  on first use, on the grid. Mermaid deferred.

## Per mode

| Constraint | Rendered | Source |
| --- | --- | --- |
| Measure | yes | partial |
| Baseline grid | strict | n/a |
| Space above | yes | no |
| Size/weight hierarchy only | yes | syntax colour permitted |
| Monospace as a voice | yes | everything is mono |
| Chrome at rest zero | absolute | line numbers permitted |
| Knuth–Plass, hanging punctuation | yes | no |

Source mode is a code surface and is judged as one.

## Deliberately absent

Justified text by default (ragged reads better on screen; K–P makes justification *possible*
as a theme option). A serif/sans toggle as a headline feature. Dark mode as an inversion (it
needs its own weight and contrast decisions). Animation of any kind. Reading-time estimates.
