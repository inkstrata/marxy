# ADR-0014 — "Aesthetics paramount" has a two-tier acceptance test

**Status:** accepted · **Source:** brainstorm Q3, A6, C3; handoff §9. Full text: `docs/aesthetics-acceptance.md`

## Decision
**Tier 1, mechanical, in CI on every PR** (`scripts/gate-aesthetics.mjs`, over the corpus):
baseline-grid conformance (every block's top edge lands on a multiple of the line box,
tolerance 0.5 px); measure between 60 and 75 `ch` at every supported size; body contrast
≥ 7:1 in both variants; zero layout shift after fonts and images resolve; rag metrics per
paragraph (coefficient of variation of line lengths, short-line count, hyphen runs) not worse
than the stored baseline; no colour on headings and no decorative rules in the default theme.

**Tier 2, human, scheduled at the end of each phase:** blind side-by-side of three corpus
documents in Marxy, Typora and Marked 2 at reading distance; pass when Marxy is preferred on
at least two of three; plus one fresh person's *first reaction* on opening Marxy, which must be
about how it looks, not about a feature. Results are recorded in `docs/taste-review/`.

## Why
Features have completion criteria; taste does not, so it loses every scheduling conflict
unless it is given one. Agents cannot see, so the mechanical tier must carry most of the load.
