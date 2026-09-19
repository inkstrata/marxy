# ADR-0007 — Own paragraph line breaking (Knuth–Plass) as the demonstrable differentiator

**Status:** accepted, amended (1: the ragged engine) · **Source:** brainstorm D4, docs/07, docs/16 §1; handoff §4

## Decision
Rendered mode sets paragraphs with a Knuth–Plass total-fit line breaker, with hanging
punctuation and optical margin alignment, ragged-right by default, hyphenated with
allow-listed patterns. Engine: `justif/core` (MIT, DOM-free) driven by `packages/typeset`,
which must prove **ragged-right** output on the corpus in Phase 1; fallback engine is
`tex-linebreak2`. Body text stays inline HTML so selection, find and assistive technology
keep paragraph semantics; canvas or absolutely-positioned words are refused for on-screen text.

## Amendment 1 — ragged text uses a per-line right-skip breaker (MARXY-23, 2026-09-19)

Measured on the rendered corpus (`packages/typeset/RESEARCH.md`, "Rendered"), justif/core over a stream
with stretch on every word space made technical paragraphs worse than the engine's own wrapping.
Ragged-right in Knuth and Plass's own formulation gives each *line* a fixed stretch (TeX's
`\rightskip`), which justif cannot express because it needs negative glue. The default ragged setting
therefore uses `packages/typeset/src/ragged.ts`, a small total-fit breaker with a 2 em right-skip, and
justif/core remains the engine for justified setting. Everything else in this decision is unchanged:
own line breaking, ragged by default, inline HTML, no canvas. `tex-linebreak2` remains the named fallback
for justification.

## Why
This is the only identified route to being *measurably* better set than every incumbent, and
it makes `hanging-punctuation` and whole-paragraph `text-wrap: pretty` (WebKit-only) available
on every engine. The differentiator a first-time user sees is the bundle: even rag, hung
punctuation, a baseline grid with zero drift, and a measure in `ch` — all four are measured
by the mechanical aesthetics gate (ADR-0014).

## Consequences
- Typesetting runs on open, reload, resize, font load and theme change; never per keystroke.
  Viewport first (< 100 ms budget), remainder in the background.
- If the Phase 1 review finds no visible improvement over engine wrapping on the corpus, the
  breaker is cut and the differentiator claim rests on the remaining three properties — that
  outcome must be argued in a superseding ADR, not drifted into.
