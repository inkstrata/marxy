# ADR-0021 — The parser is mdast/micromark, not markdown-it

**Status:** accepted (MARXY-11, 2026-09-18) · **Constrains:** ADR-0003

## Decision
`packages/core` parses with `mdast-util-from-markdown` plus `micromark-extension-gfm` (both
MIT), and converts micromark's UTF-16 offsets to byte offsets once per document at parse
time. `markdown-it` is not the parser; it stays in the tree only as long as the placeholder
harnesses in `apps/desktop` and `scripts/gate-no-network.mjs` need it. MARXY-11 implemented the
parser inside `packages/core` and could not remove `markdown-it`, because both of those paths lie
outside that story's boundaries; taking it out of the tree, with the harnesses that use it and the
line in `docs/plan.md` that still names it, is MARXY-61.

GFM comes through `micromark-extension-gfm`, frontmatter and math through the matching
`micromark-extension-frontmatter` and `micromark-extension-math`, because the AST contract has
`frontmatter`, `mathBlock` and `mathInline` nodes and the corpus exercises all three. Each is
switchable per parse, and all three are off for the conformance suite, which must see plain
CommonMark.

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

## What the implementation measured
MARXY-11 confirmed the decision rather than superseding it. `mdast-util-from-markdown` positions
every inline node, so byte provenance is a conversion and not a reconstruction, and the whole
conversion is one `Uint32Array` pass per document (ASCII documents skip even that). Parsing
`fixtures/corpus/01-long-technical.md` (20 KB) takes a median 6 ms in Node 24, against the 10 ms
story budget; micromark is effectively all of it, and the byte conversion does not register.
Conformance is checked by rendering the AST to HTML and comparing it with the reference
implementation (`commonmark`, BSD-2-Clause, dev-only) over inputs written here from the
specification's rules plus a seeded generator that composes them; the specification's own example
set is CC-BY-SA-4.0 and stays out of the tree (ADR-0006), reachable through an optional check that
reads a file the developer fetches. Matching the reference implementation at all would not have
been possible from line-level block positions.

One caveat the implementation had to resolve: `mdast-util-gfm-autolink-literal` ships a tree
transform that rewrites a paragraph's inline children to linkify candidates micromark's own scanner
cannot match, and it rebuilds them without positions, so every inline node in that paragraph loses
its provenance. `packages/core` drops that one transform and keeps the extension's token handlers,
so every node it emits carries offsets, and a node that reaches the converter without a position is
refused with an error rather than given a default one.

The cost of dropping it was measured, not estimated: 39 autolink inputs covering bare emails, `www.`
hosts and `http(s)://` URLs, each with a backslash escape or a character reference placed in the
host, the address, the path and the query, were parsed twice — with the transform and without — and
the resulting `link` nodes diffed. Three classes lose their link and keep their exact bytes as text:
a bare email with a backslash escape anywhere in it, a bare email with a character reference after
the `@`, and a `www.` candidate whose escape or character reference falls inside the `www.` host.
Everything else is byte-for-byte identical, including every `http(s)://` form tested, because the
scheme is what anchors micromark's scanner; an escape or reference in the path or query of a `www.`
candidate; and a character reference before the `@` of an email. The rule behind the three is that
the candidate loses its link only when the escape or reference falls in the part that identifies it
to the scanner. That is the price of ADR-0003 being structural rather than best-effort, and it is
smaller than "escaped candidates stop linkifying" would suggest.

## Consequences
- Parse cost moves onto the Phase 2 cold-start waterfall (MARXY-33) as a measured number. If
  it shows there, the escape hatch is `pulldown-cmark` compiled to WASM, which produces the
  same AST by contract with native byte offsets; the golden files are parser-independent, so
  the swap is contained to `packages/core/src/parse`.
- The UTF-16 → byte conversion is a single pass and must be covered by the corpus fixtures
  that exercise it: `07-cjk.md`, `08-rtl.md`, `12-crlf-and-bom.md`.
- Licence hygiene is unchanged: micromark and mdast are MIT (ADR-0006).
- Nothing in `packages/core` may import from `apps/desktop` to get positions (ADR-0020).
