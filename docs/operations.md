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

## The Phase C pack, and the per-selection limit (ADR-0054)

The four-per-release cap is replaced by a limit per selection: no kind of selection shows more than
seven verbs in the verb menu ([§03](design/03-selection-and-operations.md)), and the palette stays
filtered by selection (constraint 5). The catalogue is composed from three packs, built in parallel:

- **Copy:** copy as plain text, as rich text, as exact markdown; copy a shell command without its
  prompts.
- **Table:** copy a table as TSV, CSV or JSON.
- **Extract:** every code block, every unchecked task, every link, to the clipboard or a scratch
  document, never a silent file write.

Still to come, in order: pretty-print / minify JSON and YAML; rewrap / unwrap; sort list items and
table rows; promote / demote headings; encoding utilities. Each is a function plus a registry
command once the mechanism exists. Cross-document operations are v2; keep the signature from
foreclosing them (an operation receives a `Document`, not a string, so a future multi-document
variant can receive several). Operations that change bytes need a minimal-diff property; the
fidelity property covers every clipboard-only operation at every node of every corpus file.

## Testing shape

Table-driven: `(input, range, expected)` triples per operation, plus the byte-fidelity
property (`scripts/gate-fidelity` via `packages/core`): for every corpus file and every
operation applied at every applicable node, bytes outside `[start, end)` are identical.
