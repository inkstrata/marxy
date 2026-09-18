# Document operations

One mechanism (ADR-0004): selection → source map → byte range → pure `string → string`
function → splice → re-render. The signature is frozen in
`packages/core/src/contracts/operation.ts`.

## Design constraints

1. Every operation is a pure source transformation: text in, text out, no view state, no
   bytes outside its range.
2. Every operation is reachable from the palette; buttons and menus are shortcuts to it.
3. Every operation is one undo step, including multi-block ones.
4. No operation writes to disk. Saving stays explicit.
5. Operations declare what they apply to (span, block, section, document) and are offered
   only when the selection matches. This keeps the palette quiet.
6. Nothing destructive without a visible result.

## v1 set (ADR-0019) — proves the mechanism end to end

| Operation | Applies to | Proves |
| --- | --- | --- |
| Copy section | section | section-level selection through the outline |
| Copy code block clean | block | block selection; strips fence and highlight markup |
| Toggle task item | block (list item) | a splice mutation, the checklist case for agent artifacts |
| Align table pipes | block (table) | an in-place reformat that touches only the table's bytes |

## v1.1 candidates, in order

Copy as plain text; extract all code blocks; pretty-print / minify JSON and YAML; extract
links and task items; rewrap / unwrap; sort list items and table rows; promote / demote
headings; copy as rich HTML; encoding utilities. Each is a function plus a palette entry once
the mechanism exists. Cross-document operations are v2; keep the signature from foreclosing
them (an operation receives a `Document`, not a string, so a future multi-document variant can
receive several).

## Testing shape

Table-driven: `(input, range, expected)` triples per operation, plus the byte-fidelity
property (`scripts/gate-fidelity` via `packages/core`): for every corpus file and every
operation applied at every applicable node, bytes outside `[start, end)` are identical.
