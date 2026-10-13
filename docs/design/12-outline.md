# 12 — Outline from the AST

The heading list a summoned outline (and later the palette) will read. Lives in
`packages/core/src/outline/`. Shell-free (ADR-0020). No contract change: the entry type
is local to this module, not `packages/core/src/contracts/`.

The UI that renders the list is §09 and is **not** this module. This document is the
extraction only, so Phase 0 can ship the mechanism while the dialog waits on Phase 3.

## Type

```ts
import type { Document, Source } from '../contracts/ast.ts';

export interface OutlineEntry {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;   // visible heading text, no markers
  readonly src: Source;    // the heading node's src (or the frontmatter node's, see below)
}

export function outlineFrom(doc: Document): OutlineEntry[];
```

## Walk

Document order, every `heading` node, including headings nested in blockquotes and lists.
Do **not** invent headings from setext/ATX source: the parser already produced `heading`
nodes (ADR-0003). A document with no headings returns `[]`.

`text` is the concatenation of visible inline text inside the heading, in child order:

| Inline | Contribution |
| --- | --- |
| `text` | `value` |
| `code` | `value` |
| `emphasis` / `strong` / `strikethrough` / `link` | recurse children |
| `image` | `alt` |
| `softBreak` / `hardBreak` | one space |
| `html` / `footnoteReference` / `mathInline` / `taskMarker` | nothing |

Collapse runs of whitespace to a single space and trim. Empty text is allowed (a `#` with
no content still occupies a row; `text === ''`).

`src` is the heading node's `src`. Do not shrink it to the text run.

## Frontmatter title

If the document has a `frontmatter` child whose `value` contains a line matching
`/^title:\s*(.+)$/m` (first match; trim quotes around the value if both ends are `"` or
`'`) **and** there is no `heading` with `level === 1` anywhere in the walk, prepend one
entry `{ level: 1, text: <title>, src: frontmatter.src }`. If there is an h1, ignore the
frontmatter title. Do not add a YAML parser.

## Tests (`packages/core/src/outline/outline.test.ts`)

`node --test --experimental-strip-types` already picks up `src/**/*.test.ts`.

| Case | Expect |
| --- | --- |
| `01-long-technical.md` | every AST heading appears once, same order, same `level`, same `src.start`/`src.end` |
| `09-gfm-everything.md` | same, including headings after tables and lists |
| empty document / `#` only / no headings | `[]` or one empty-text entry for `#` |
| heading inside a blockquote | included, document order |
| `**bold**` / `` `code` `` in a heading | markers stripped; `text` is the visible words |
| frontmatter `title: Hello` and no h1 | first entry is `{ level: 1, text: 'Hello' }` |
| frontmatter `title:` plus an h1 | frontmatter title absent from the list |
| import of `apps/desktop` or `packages/shell-api` from `src/outline/` | fails (ADR-0020; same style as other core boundary tests) |

`outlineFrom` is exported from `packages/core/src/index.ts`.

## The inspector's Outline tab (W-10)

The inspector (`apps/desktop/src/workspace/outline-tab.ts`, tab id `outline`) lists the focused document's headings
with `outlineModelOf`, which walks the same headings as `outlineFrom` (those in a quote or a list item too; a title that
only front matter holds is a name and is not listed). Beside the folded outline's jump it adds what a tab can keep on screen.

| Part | Rule |
| --- | --- |
| Row | The heading's text, indented by its level less the shallowest level in the document, and the words of its section. Enter or a click opens the heading's place (`handle.open(path, { at })`, as Links does). |
| Words | The status bar's counter (`createWordCounter`), over the section's bytes: the heading, its text and every sub-section, which is what a move carries. They are counted in one pass and read at the places sections begin and end, so the sections at one level and the text above the first add up to the document's count. |
| Tables | A table is listed under its section as `Table: first header cells` (four at most, then `…`), one step in. Its row jumps to the table. |
| The mark | The section under the reading line in Read, under the caret in Source (`aria-current="location"`), found from the heading starts: the last heading that starts at or before the byte. Above the first heading nothing is marked (the status bar names nothing there either). |
| Live | The panel subscribes to the document's store: an edit, an undo, a reload after an outside change and a first parse draw the list again, and focus stays on the row it was on. A file that has not been parsed (it opens in Source) is not parsed for the tab: it says the outline is listed for Markdown. |
| Copy outline | The headings as a Markdown list, nested as the document nests them (a skipped level is not a skipped indent), on the pasteboard with the common "Copied" pill. |
| Empty | "No headings in this document." |

**Moving a section.** A row's section is the heading and everything under it up to the next heading of the same or a higher
level. `⌥↑` and `⌥↓` on a row (and the context-menu key or the row's three dots, which open a four-item menu: Move up, Move down,
Promote, Demote) trade it with the sibling section before or after it, as one `store.apply` (one undo step). Promote and
Demote are E-07's operations over the section's range and decline setext headings as they do; a move does not rewrite a
heading, so setext sections move.

- Only a heading that is a top-level block of the document is a section: a `#` line in a fence, in front matter, in a quote or in
  a list item is neither moved nor moved past. A section begins at the start of its heading's line (an indent travels with it).
- A section never moves across a heading of a higher level: the first child of a heading has no sibling above it and the last has
  none below it; the tab says so.
- The bytes: the range is the two sections; they trade places with their own bytes. The join: the last section of a file may end with
  no line ending; moved up, the section above it hands its line endings to the join, so the file ends on a text byte exactly as it did, and
  moved back the original bytes return. Line endings are never converted, a byte-order mark is outside every range.
- Refused, with the file untouched and the reason said (a notice, "Not moved: …"): no sibling; bytes in the range that are not UTF-8
  (the splice would write U+FFFD over them); a heading that is no longer where the row said (the document changed under it); and a
  result whose top-level blocks are not the two sections' blocks in their new order (`shapeAfterSwap`). The last is the case of a
  section with no blank line after its last paragraph, moved to sit above a setext heading: the paragraph would become part of that
  heading. Add a blank line, then move.
- The proof: `core/src/operations/move-section.test.ts` (table rows in every line ending, a differential against a reference
  written from the generator's structure over a thousand random documents, the round trip), `outline-tab.test.ts` (the same documents
  through a real store), `test/support/store-walk.mjs` (`moveSection`, in the standing walk), and `pnpm gate:fidelity`, which saves every
  move of the two `sections` fixtures through the real save path.
