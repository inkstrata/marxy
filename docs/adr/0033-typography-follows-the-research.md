# ADR-0033 — Typography follows the reader-typography research

**Status:** accepted 2026-09-23 (the author) · **Source:** `docs/research/reader-typography/` (the
Reader Typography Handbook: sources unmodified under `source/`, readable chapters generated from them),
measurements in WebKit with the bundled files ·
**Supersedes:** ADR-0015's consequence "68 `ch` stays"; every taste-review decision on size, measure,
code colour and code layout · **Amends:** ADR-0030 (the grid numbers; multi-line headings), ADR-0007
(hyphenation costs), ADR-0024 (palette values), `docs/design-language.md` constraints 1 and 5 and the
type scale

## Context

The typography so far rested on convention and on taste reviews held with one reader. The author
commissioned a twelve-chapter handbook that grades every claim by its evidence (A replicated … D
convention, X contested), measures what the literature does not say, and ends in a specification
(`10-spec.md`). The author's instruction is that **this research supersedes every earlier taste
decision, including the font choices.**

Read against the code, the handbook confirmed most of Marxy: Literata as the text face, dark as a
designed variant at a lighter weight, ragged right by default, Knuth–Plass line breaking with the
engine's greedy wrap as the thing to beat, hyphenation from shipped patterns rather than the engine,
highlighting from TextMate grammars with no guessing of languages, and a contrast check on every
token. It contradicted five things, and on each one the old choice had been approved by a taste
review.

1. **The measure was in `ch`, and `ch` is the digit zero.** Measured in WebKit with the bundled file,
   Literata's zero is 0.58 em wide and its average character of English prose is 0.463 em. The
   68 `ch` column review #0 approved therefore set **about 85 characters a line**, beyond Bringhurst's
   75 and WCAG 1.4.8's 80, and it moved with the zero's width on the optical-size axis
   (`03-fonts.md` "Measured metrics", `04-spacing-layout.md` "Measure").
2. **17 px is below the critical print size for this face on a dark ground.** Reading speed falls off
   below an x-height of about 0.2° (A); at the CSS reference pixel that is about 9.4 px, which is
   Literata at 18.5 px. The research's desktop default is 20 px, and it adds that a dark default
   should come with generous size, because the legibility cost of light-on-dark text grows as text
   shrinks (`02-evidence.md` "Size", `09-color-access.md` "Polarity").
3. **The code palette coloured everything, and dimmed comments.** Highlighting's measured benefit is
   small (C). What colour is for is navigation, and navigation needs a few landmarks. Comments are
   the author speaking, so they are read, not dimmed (`06-code.md` "Designing a code theme").
4. **Code was confined to the prose column.** Code has its own line lengths (79, 88, 100 columns),
   and a reader should show it at its authored width, into the margin where there is room. A wrapped
   line must never pass for two statements, so its continuation must hang past its own indentation
   and be marked (`06-code.md` "Wrap or scroll?").
5. **Ligatures were on.** JetBrains Mono draws its programming ligatures through `calt`, so `!=` was
   drawn as ≠, a different character. For a reader of other people's code, ligatures are off
   (`06-code.md` "Ligatures").

## Decision

1. **The measure is counted in average characters of the text face, never in `ch`.** Two tokens are
   added within contract version 1, each with a default. `--marxy-measure-chars` (66) is the number
   of characters, and `--marxy-avg-char` (0.463) is the text face's average advance in em, measured.
   `--marxy-measure` keeps its name, unit kind and meaning (the column's length) and defaults to their
   product in em. `base.css` clamps the column to 45–80 characters however a theme sets it, and the
   loader clamps `--marxy-measure-chars` to the same range. A theme that changes the text face must
   set `--marxy-avg-char` for it.
2. **Body 20 px on a 30 px line (1.5), so the grid unit is 15 px** (ADR-0030's rule, new numbers).
   With a ratio of 1.25, h3 is 25 px, h2 31/38 and h1 39/48. Code is 18 px, the x-height matched to
   Literata's within 3 % (constraint 5), on a 30 px code line. The reader's size setting runs 15–50 px,
   75–250 % of the default.
3. **A heading that wraps is an island the grid pass pads.** A heading's line box is not a grid unit,
   and CSS cannot know how many lines a heading will take, so a heading that sets on two lines is
   padded by `snapToGrid` like code and tables. The alternative was heading line boxes rounded to the
   grid unit, which sets a two-line h2 at 1.45 leading. The CSS-alone guarantee (ADR-0030 Amendment 1)
   now covers text whose headings set on one line; `grid.test.mjs` writes that case out.
4. **Restrained code colour.** Colour goes to strings, numbers and constants, comments, and the
   names being defined or called (function, tag). Keywords, types, variables, operators and
   punctuation stay in the code text colour. Comments are coloured, not dimmed. Every token clears
   4.5:1 on the code background, and **also on the selection and find highlights**. Those highlights
   were darkened (dark) and lightened (light) until they do. Where the current find match's fill
   cannot differ enough from the other matches, the current match must also carry an outline, so
   colour is never the only signal (WCAG 1.4.1).
5. **Code keeps its authored width.** A code block starts at the column's left edge, is at least the
   column wide, and grows into the right margin up to 100 columns (to 3rem from the window's edge). A
   line longer than that still wraps, never scrolls, which keeps chrome at rest at zero. Its
   continuation rows hang 2ch past the line's own indentation (capped at half the block), with a
   1 px rule beside them. The highlight pass wraps every source line in `.marxy-line` for this and
   leaves the text nodes, and so copy and find, untouched. Wide tables get the same room, then
   scroll, and a table that scrolls gets a tab stop and a name, so it can be scrolled from the
   keyboard.
6. **Code is verbatim:** no ligatures (`font-variant-ligatures: none`, `calt` and `liga` off), no
   letter or word spacing, no hyphenation. Tracking is never applied to headings in cursive or Indic
   scripts.
7. **Highlighting runs in a worker.** Compiling a grammar in WebKit took about 800 ms the first time
   a README's `ts` and `sh` fences were seen, on the main thread, as a frozen page just after open.
   The highlight pass now posts code to `highlight.worker.ts` and builds spans from the returned
   token data. If a worker cannot start, it falls back to the page.
8. **The fence ids people write are recognised.** `ts`, `js`, `sh`, `py`, `rs`, `yml` and the other
   common aliases map to allow-listed grammars (`shiki-languages.json` `aliases`). Before this, most
   README code was silently uncoloured. An alias adds no grammar and so needs no licence entry.
9. **Hyphenation costs follow TeX** (`05-line-breaking.md`). A first pass with no hyphens is kept
   when every line is within `\pretolerance` (100), so text that sets well is not hyphenated. Two
   hyphenated lines in a row cost `\doublehyphendemerits` (3,000), as two dashes already did. A
   hyphen on the second-to-last line costs `\finalhyphendemerits` (5,000). A line that ends in a
   generated hyphen now counts the hyphen's width, which the breaker had been leaving out.
10. **Fonts are unchanged, on the research's own terms.** Literata is its default text face, and
    JetBrains Mono is on its shortlist for code. Both declare no Reserved Font Name and ship
    unmodified from upstream with every OpenType feature. `docs/design/14-release.md` wrongly said
    Literata carries an RFN, and now does not.

## What the research asks that this does not yet do

Each needs its own story; none is contradicted here.

- **Justification** (never wired in the app: `--marxy-justify` is read nowhere). When it is built, it
  applies only when the measure is at least 45 characters, uses 3 em of emergency stretch rather than
  unlimited tolerance, and falls back to ragged right with a one-line reason in settings.
- **Reader spacing controls with coupling rules:** letter spacing drags word spacing, leading has
  per-script floors (×1.17 CJK, ×1.1 Devanagari and pointed Hebrew, ×1.07 Thai), and code, verse,
  math and tables take size and face only.
- **A second face.** Atkinson Hyperlegible Next as the offered sans, with faces matched by x-height
  (`font-size-adjust`) so that switching the face does not also switch the apparent size. No
  typography is claimed to help dyslexia.
- **Gates:** WCAG 1.4.12 text spacing (no clipping under the four overrides), reflow at 320 px and
  at 400 % zoom, `forced-colors: active`, a feature probe of the bundled faces, and a keyboard walk
  of every scroll region.
- **Content types:** pop-up or margin footnotes rather than endnotes, admonitions distinguished by
  label rather than colour, speaker labels on a hanging indent for agent transcripts, and verse kept
  as authored.
- **Explicit optical size.** Browsers set `opsz` to the size in CSS px, which is lighter than the
  designers intended (X). Measure before overriding.

## Consequences

- Every screenshot and rag baseline moved, and both engines' were regenerated with this change. The
  Linux ones were captured by the MARXY-25 route (`gate-aesthetics --update` inside
  `mcr.microsoft.com/playwright:v1.63.0-noble`, the image CI's browser job runs, as `linux/amd64`).
  The rag numbers are not comparable across the change: at 66 characters a line fewer paragraphs fit
  on one line, and short documents' coefficients rose from zero.
- The measure gate (aesthetics §10 check 2 and `grid.test.mjs`) counts average characters (66 ± 10 %)
  rather than `ch`, and the matrix runs at 16, 20, 24 and 28 px.
- A theme author who sets `--marxy-measure` in `ch` still gets a column, clamped to 45–80 real
  characters. `--marxy-measure-chars` is the supported way to set a measure.
- The first `sh` block in a session pays about 40 ms to load its grammar, in the worker, off the
  reading path.

## What would falsify it

A reader study on Marxy's own corpus, run as `10-spec.md` "Testing with readers" describes (speed
*and* comprehension, counterbalanced, preference reported separately), that finds 20 px / 66
characters measurably worse than 17 px / 85 for the READMEs and agent artifacts Marxy reads first.
