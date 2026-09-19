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
