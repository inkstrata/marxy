# Design language — six constraints and a type scale

These are the **default theme's** rules, stated so a screen can be judged against them and so
a theme author can be told which of them they may change (`theme-contract.md`). They are
enforced by the mechanical aesthetics gate where a machine can check them (ADR-0014).

The numbers follow the Reader Typography Handbook in `docs/research/reader-typography/`, which
grades every claim by its evidence and supersedes the earlier taste decisions (ADR-0033). When this
page and the research disagree, the research wins and this page is wrong.

## The six constraints

1. **Measure in characters, not pixels, and never in `ch`.** The column is 66 average characters
   of the text face (45–80 allowed), so it holds at whatever size the reader chooses. Every
   incumbent caps in `px`, which degrades the measure exactly when a reader enlarges the type.
   A `ch` is no better: it is the digit zero, a quarter wider than Literata's average character, so
   "68 ch" set 85 characters. The width is `--marxy-measure-chars × --marxy-avg-char` em, and the
   average advance is measured per face (ADR-0033).
   *Gate:* 66 average characters ± 10 % at every size from 16 to 28 px.
2. **One baseline grid.** Body lines are whole line boxes (30 px in the default theme), and
   every vertical space is an integer multiple of **half** a line box, so paragraphs can sit
   15 px apart (ADR-0030). Headings, code, images, lists, quotes and math land on it.
   The point is that a long document never accumulates drift; a reader is judged on the fourth
   page. Themes set the line box; Marxy enforces the multiples. *Gate:* every block's top edge
   sits on a multiple of half a line box ± 0.5 px across the corpus.
3. **Space belongs above.** A heading gets ~2.5× more space above than below, binding it to
   what it introduces. Getting this backwards is what makes Obsidian's default feel wrong.
4. **Hierarchy from size and weight only.** No coloured headings, no rules as decoration, no
   boxes around callouts by default. Colour is for links and one sparing accent. If the
   hierarchy is not legible in greyscale it is decoration. *Gate:* lint of the default theme.
5. **Monospace is a voice, not a size.** Code is a different family at a matched x-height,
   on its own line box that is still a grid multiple; never the body face at `0.85em`. Code is
   verbatim: no ligatures, no reader spacing, no hyphens, and it keeps its authored width.
6. **Chrome at rest is zero.** Rendered mode at rest is a column of text and nothing else.
   Everything is summoned by intent and dismissed. This is the constraint convenience erodes
   first: every affordance will feel worth 32 px of permanent chrome, and none is.

## Type scale (default theme)

Ratio 1.25 from a 20 px base on a 30 px line (1.5), the grid unit half of that. Literata for text,
JetBrains Mono for code (ADR-0015, confirmed by the research in ADR-0033).

| Role | Size / line | Weight (dark / light) | Tracking | Space above |
| --- | --- | --- | --- | --- |
| Title (h1) | 39 / 48 | 560 / 580 | −0.014em | — |
| Section (h2) | 31 / 38 | 560 / 580 | −0.011em | 60 px |
| Sub (h3) | 25 / 30 | 560 / 580 | −0.006em | 30 px |
| Body | 20 / 30 | 380 / 400 | 0 | 15 px |
| Code block | 18 / 30 | 380 / 400 | 0 | 30 px |
| Caption, meta | 15 / — | 380 / 400 | 0.01em | 15 px |

20 px because reading speed falls off below an x-height of about 0.2°, which is Literata at
18.5 px, and because the legibility cost of light text on dark grows as text shrinks: a dark
default needs generous size (research `02-evidence.md`, `09-color-access.md`). 1.5 leading is the
research's default and WCAG's AAA floor. Code is 18 px, where JetBrains Mono's x-height matches
Literata's at 20 within 3 %; inline code is therefore 0.9 em. Headings at 560–580, not 700:
hierarchy comes from size and space; 700 in a text serif shouts. The Linux build applies
`--marxy-weight-offset` (measured, ADR-0010) to keep rendered weight matched to macOS.

## The four hard problems behind "reading experience"

- **Fidelity.** CommonMark + GFM, passing the spec suite. Sanitise always (ADR-0009). Smart
  typography — real quotes, dashes, ellipses, non-breaking spaces before short last words —
  as a render pass, never written back.
- **Navigating long documents.** A summoned outline that tracks scroll; reading position
  remembered per file (ADR-0018); find that lands a match at the reading position, not the
  viewport edge; a progress readout that is honest about remaining length, no time estimates.
- **Embedded code.** Highlight off the main thread, only languages the fence names (never a guess),
  in a restrained palette: strings, literals, comments and defined names carry colour; keywords,
  operators and punctuation do not; comments are read, not dimmed. A block keeps its authored
  width, growing into the right margin up to 100 columns; a longer line wraps, hanging past its
  own indentation with a rule beside the continuation, so it never reads as two statements. Never
  a scrollbar per block; no ligatures; copy without highlight markup (ADR-0033).
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

## Colour: dark is primary (ADR-0024)

Marxy is designed on a dark ground first: warm near-black `#151412`, warm off-white text
`#e8e4dc` at 14.5:1, body weight 380 because a serif at 400 reads heavier on dark, one muted
blue accent, code one step lighter than the page. Every code token clears 4.5:1 on the code
background and on the selection and find highlights too; a find match is never told apart by
colour alone. Light is a second, separately designed
variant on warm paper `#faf8f4` at weight 400. Neither is the other inverted. The exact
palettes and their contrast ratios are in `docs/design/05-theme.md` §Palettes; both must pass
the contrast checks in the aesthetics gate.

## Deliberately absent

Justified text by default (no reader study shows justification helps, crude justification hurts,
and below 45 characters no line breaker can save it; K–P makes it *possible* as an option at
45 characters and up). A serif/sans toggle as a headline feature. A light theme produced by
inverting the dark one. Programming ligatures. Syntax colour on every token. Claims that any
typeface helps dyslexia (spacing can; letterforms do not). Animation of any kind. Reading-time
estimates.
