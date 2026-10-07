# ADR-0055 — `--marxy-color-find-edge`: a find match carries a 2 px edge, because its fill cannot

- **Status:** proposed
- **Date:** 2026-10-07
- **Amends:** ADR-0024 (the additive set of find, notice and code-token colours gains one name).
  Builds on ADR-0033 (the current match is told apart by more than colour).

## Context

A find match must be distinguishable from its ground (WCAG 1.4.11, 3:1 for the mark itself).
The light fill `#fcefc0` is 1.01:1 against the code ground and the current fill 1.14:1 against it. A
fill that reached 3:1 would need a relative luminance of at most 0.25, and then the comment token
(which needs a pale ground, 4.5:1) could not be read on it. The accent cannot be the edge: it is
the link and caret colour, and the current match already uses a heavier mark.

## Decision

1. A new token, `--marxy-color-find-edge`, a colour, with a default (so an existing theme is
   unharmed). Meaning: the 2 px edge drawn under every find match. It is at least 3:1 against both the
   page and the code ground in both variants. Dark `#94701a`, light `#8a6200`.
2. Fills stay pale and keep 4.5:1 for every foreground token on them (unchanged).
3. The current match adds a 2 px outline in the code text colour; the edge colour and the text colour
   differ by at least 3:1 in both variants, so current versus other is told apart by colour and by
   shape, never by fill alone.
4. Rendered find (D-13) uses the same token and the same rule.

## Consequences

Themes may set the token; one that does not gets the default. `palettes.test.mjs` holds the ratios.
