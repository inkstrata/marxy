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

## The Phase E catalogue: shipped

Every row is a registered operation, reachable from the palette (`>`) on a selection it applies to, one undo step,
and held by the byte-fidelity property over every corpus file and by its own table, on every line ending
(`packages/core/src/operations/testing/test-kit.ts`). The verb menu shows a row only where
[§03](design/03-selection-and-operations.md) lists it; the rest are palette-only for now.

| Operation | Id | Applies to | Story |
| --- | --- | --- | --- |
| Unwrap markdown fence | `unwrap-markdown-fence` | a `markdown`-fenced block | E-06 |
| Promote heading, Demote heading | `promote-heading`, `demote-heading` | a heading and its section | E-07 |
| Move section up, Move section down | `move-section-up`, `move-section-down` | a heading; the range is it and its sibling section together; offered from the inspector's Outline tab (`⌥↑`, `⌥↓`) and by the commands of the same names, never from a selection's verb menu | W-10 |
| Renumber list, List to numbers, List to bullets, Bullets from glyphs | `renumber-list`, `list-to-numbers`, `list-to-bullets`, `bullets-from-glyphs` | a list, or a paragraph of glyph bullets | E-08, E-08.1 |
| Sort list items | `sort-list-items` | a list | E-09 |
| Pretty-print JSON, Re-indent YAML | `format-json`, `format-yaml` | a fenced `json` or `yaml` block | E-10 |
| Dedupe lines | `dedupe-lines` | a run of blocks (`Shift+click` grows one) | E-05 |
| Toggle task, Align table pipes | `toggle-task`, `align-table-pipes` | a task item, a table; both from a click in Rendered | E-02 |
| Copy as plain text | `copy-plain` | a block, section or document; stripping is a copy form, never a splice | E-11 |

Around them, not operations: **Edit block in place** (`Mod+Enter`, ADR-0048, E-04), **Paste as a new Markdown
document** (`Mod+V` in Rendered, J-05), the scratch document that paste and the comparisons open (E-13), and
**Show what changed on disk** and **Show unsaved changes** (E-17).

The phase's screen criterion is one test, `apps/desktop/test/phase-e-flow.test.mjs`: paste an assistant's answer,
unwrap its fence, tick and untick a task, fix a typo in place, save, then undo to the pasted text, on LF and CRLF
files, with every byte outside those four changes asserted identical.

Still to come, in order: minify JSON; rewrap; sort table rows; encoding utilities. Each is a function plus a
registry command once the mechanism exists. Stripping markdown as a splice stays out (E-11's guard).
Cross-document operations are v2; keep the signature from foreclosing them (an operation receives a `Document`,
not a string, so a future multi-document variant can receive several). User-defined operations are ADR-0049,
recorded and not scheduled. Operations that change bytes need a minimal-diff property; the
fidelity property covers every clipboard-only operation at every node of every corpus file.

## Testing shape

Table-driven: `(input, range, expected)` triples per operation, plus the byte-fidelity
property (`scripts/gate-fidelity` via `packages/core`): for every corpus file and every
operation applied at every applicable node, bytes outside `[start, end)` are identical.
