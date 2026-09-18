# ADR-0008 — Themes are declarative CSS documents under a system-owned typography contract

**Status:** accepted · **Source:** brainstorm docs/09, A3, A13, C9

## Decision
A theme is a directory: `theme.toml` (name, author, contract version, variants), `theme.css`,
optional bundled `fonts/`, `LICENSE`. No JavaScript, no network, no conditional logic, no AST
access — stated as a boundary, not a current limitation. Themes set **tokens** (colour,
families, base size, measure, the grid unit, code and quote presentation) through the
`--marxy-*` custom properties in `packages/theme/src/tokens.css`; marxy owns line breaking,
grid snapping, reserved image dimensions, hanging punctuation, and Rendered-mode immutability.
A theme is a document: opening `theme.css` in marxy shows it in Source mode.

## Consequences
- Give theme authors the variables, not the declarations: all vertical spacing is computed
  from `--marxy-line-box`; a theme cannot set a 13px margin.
- Any token change to family, size or measure re-runs typesetting.
- The contract is versioned; a theme declaring an older version gets a warning, not a
  silent misrender. A supported-CSS baseline (WebKitGTK 2.50+, WKWebView 26+) is published
  with the contract. Theme rendering issues below the baseline are not marxy bugs.
- The default theme is implemented *as* a theme, so the loader is exercised from Phase 1.
