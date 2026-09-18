# ADR-0021 — The parser is mdast/micromark, not markdown-it

**Status:** proposed (planner, 2026-09-18) · **Decided by:** MARXY-11, which moves this to
accepted or supersedes it · **Constrains:** ADR-0003

## Decision
`packages/core` parses with `mdast-util-from-markdown` plus `micromark-extension-gfm` (both
MIT), and converts micromark's UTF-16 offsets to byte offsets once per document at parse
time. `markdown-it` is not the parser; it stays in the tree only as long as the placeholder
harnesses in `apps/desktop` and `scripts/gate-no-network.mjs` need it, and leaves with
MARXY-12.

## Why
ADR-0003 requires **every** node — inline nodes included — to carry `{file, start, end}` byte
provenance, because the source map is what makes editing-as-transformation, selection
resolution (MARXY-41) and reading position (ADR-0018) work at all. `markdown-it` reports
line ranges for block tokens and no positions for inline tokens, so meeting ADR-0003 on top of
it would mean re-deriving inline positions by re-scanning source text — the kind of
approximate mapping that eventually writes a byte the user did not ask to change.
`mdast-util-from-markdown` is CommonMark-compliant, GFM-complete through one extension, and
positions every node natively.

This choice was made in `docs/plan/next-steps.md` during handoff but never recorded where an
implementor would look, while `docs/plan.md` still said "markdown-it". A parser swap after the
golden files exist is cheap; a provenance retrofit after Phase 3 is not. Recording it as an ADR
is the difference.

## Consequences
- Parse cost moves onto the Phase 2 cold-start waterfall (MARXY-33) as a measured number. If
  it shows there, the escape hatch is `pulldown-cmark` compiled to WASM, which produces the
  same AST by contract with native byte offsets; the golden files are parser-independent, so
  the swap is contained to `packages/core/src/parse`.
- The UTF-16 → byte conversion is a single pass and must be covered by the corpus fixtures
  that exercise it: `07-cjk.md`, `08-rtl.md`, `12-crlf-and-bom.md`.
- Licence hygiene is unchanged: micromark and mdast are MIT (ADR-0006).
- Nothing in `packages/core` may import from `apps/desktop` to get positions (ADR-0020).
