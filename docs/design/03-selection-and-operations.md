# 03 — Selection and operations

How a reader points at something in Rendered mode, how that becomes bytes, and the four v1
operations, each with its algorithm and its test table. Contracts: `operation.ts` (frozen).
Buffer: §01. DOM provenance: §02.

## Selection model (D-A2)

```ts
export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; node: Block | Inline; el: Element }        // one AST node
  | { kind: 'section'; heading: Heading; range: Source }       // heading + everything until the next heading of ≤ level
  | { kind: 'document' }
  | { kind: 'text'; text: string };                            // a native DOM text selection; copy only, never mutates
```

- **Click on a block** (`closest('[data-marxy-s]')` that is block-level) selects that node.
  Click on an inline `code` selects the inline node; a second click on the same element
  selects its enclosing block. A plain click on a link **follows it** (§02 post-pass 2: a
  reader clicks links to go somewhere); `Alt+click` selects the link node instead. A click on a
  task checkbox toggles it (§02 post-pass 7) and does not change the selection. A click that
  ends a native text drag is not a selection click. Click on empty article space → `none`.
- **Outline** (§09) selects a `section`. `Alt+Up/Down` moves a node selection to the
  previous/next block sibling; `Alt+Shift+Up` selects the parent block; `Esc` → `none`.
  (`Alt+Left/Right` are history back/forward on Linux, as MARXY-86's `keys.ts` binds them.)
- **Native text selection** (drag) is `text`; it never resolves to bytes in v1. Copy of a
  `text` selection copies the DOM text (with smart typography, as seen).
- **Rendering:** the selected element gets `class="marxy-selected"` (a theme-owned outline
  colour on the block's left edge; no fill). Only one selection exists at a time.

**Resolution.** Split by what each half needs: the AST half is pure and lives in core, the DOM
half in the app.

```ts
// packages/core/src/sourcemap/section.ts — pure, Node-testable over the corpus
export function sectionRange(doc: Document, heading: Heading): Source;
export function nodeAt(doc: Document, byte: number): Block | null;          // the innermost block whose range contains byte
// apps/desktop/src/selection/resolve.ts — needs a DOM
export function resolve(el: Element, map: NodeMap): { node: Node; range: Source } | null;
```

**Why `text` never resolves (and what MARXY-41's acceptance means by "span").** The frozen
contract names a `span` applicability, and the CSV's MARXY-41 row asks that "span, block,
section and document selections resolve to ranges whose bytes match the selected text". A DOM
text selection cannot do that honestly in v1: smart typography (§02) and the typesetter's soft
hyphens make the painted characters differ from the source, and a drag that starts inside a
link and ends inside a code span has no byte range that is "the selected text" in both
directions. v1 therefore resolves **node, section and document** selections and treats a DOM
drag as `text` (copy only). No v1 operation declares `'span'`; the contract keeps the word for
later. The property test is stated over what does resolve:

> For every element carrying provenance in every corpus document: `resolve(el)` returns the
> node whose `src` is `{s, e}`; `textOf(buffer, range)` is at UTF-8 boundaries; re-parsing that
> slice alone yields a first top-level node of the same `type` (blocks) or a paragraph whose
> only child has that `type` (inlines). For every heading: `sectionRange` starts at the heading
> and ends at the next heading of equal or higher rank or at the end of the document.

`sectionRange` = `[heading.src.start, next.src.start)` where `next` is the first later
top-level block that is a heading with `level <= heading.level`, else `doc.src.end`. Trailing
blank lines belong to the section (they are inside the range); operations that copy trim them.

## Applying an operation

```ts
export async function apply(op: Operation, sel: Selection, ctx: AppContext): Promise<void>
```

1. `input = { document, node, range, text: textOf(buffer, range) }`; `op.canApply(input)` must
   be true (the palette only offered it because it was).
2. `result = op.run(input)`. If `result.clipboard`, `shell.clipboardWrite(result.clipboard)`.
3. If `result.replacement !== input.text`: `history.push({ range, before, after, label: op.title })`,
   `buffer = splice(buffer, range, result.replacement)`.
4. Reparse, re-render (§02) with `policyFor(trust.grantsFor(path))` (§12), **restore** reading
   position (§08) and selection: the selection is re-resolved by `range.start` (the node that
   now starts at the same byte, else `none`).
5. Typeset re-runs with the paragraph cache (§04); unchanged paragraphs are instant.
6. `result.summary`, if present, shows as a transient notice for 4 s ("Table aligned: 6 rows").

Budget: steps 3–5 under 100 ms for a 200 KB document (the live-reload budget, same path).

## The four operations (`packages/core/src/operations/`)

Each is one file exporting one `Operation`; `index.ts` exports `OPERATIONS: readonly Operation[]`
in palette order. All pure; all table-tested; the fidelity property runs every operation at every
applicable node of every corpus file and asserts bytes outside `range` are unchanged.

### `copy-section` — applies to `section`, `document`

`clipboard.text = textOf(range).replace(/\s+$/, '') + '\n'`; `replacement = text` (no change).
For `document`, the whole buffer text. Also sets `clipboard.html` to
`renderDocumentSafeHtml(parseMarkdown(clipboard.text)).html` so pasting into a rich target keeps
structure (the same sanitised pipeline; nothing new to trust).

| Case | Expect |
| --- | --- |
| h2 followed by h3, h3, h2 | range ends at the second h2's start; text includes both h3 sections |
| last section of the file | range ends at `doc.src.end`; trailing newline normalised to exactly one |
| h1 with nested h2s | includes all of them |
| heading with trailing `##` closers | copied text is the source bytes, closers included |

### `copy-code-clean` — applies to `block` where `node.type === 'codeBlock'`

`clipboard.text = node.value` (the content between the fences, as the parser stores it, ending
with exactly one `\n` if non-empty); no `clipboard.html`. `replacement = text`.

| Case | Expect |
| --- | --- |
| fenced ` ```ts ` with info string | value only; no fence, no info string |
| indented code block | value with the 4-space indent removed (already so in the AST) |
| unclosed fence at EOF | value = everything after the opening fence |
| empty block | `''` |

### `toggle-task` — applies to `block` where the node is a `taskMarker` (or a `listItem` with one)

`range = marker.src` (exactly the `[ ]` / `[x]` bytes, 3 bytes). `replacement = marker.checked ? '[ ]' : '[x]'`.
When invoked on a `listItem`, use its first child marker. `summary` = none (the change is visible).

| Case | Expect |
| --- | --- |
| `- [ ] a` | bytes 2..5 become `[x]`; everything else identical |
| `* [X] b` | becomes `[ ]` (case is not preserved: `X` and `x` are the same marker) |
| `1. [x] c` | becomes `[ ]` |
| nested item under a task | only the clicked marker's bytes change |
| marker inside a code block (not a task) | `canApply` false |
| CRLF file | no line ending touched (the range is inside the line) |

### `align-table-pipes` — applies to `block` where `node.type === 'table'`

Rewrites the table's lines so every column's pipes align. `range = table.src`.

Algorithm, on `text = textOf(range)`:

1. Split into lines keeping each line's own ending (`/\r?\n/` positions; the last line may
   have none). Every line of a GFM table is one row; there are no continuation lines.
2. For each line, split into cells on **unescaped** `|` (a `|` not preceded by an odd run of
   `\`); a leading `|` and a trailing `|` (after trimming trailing spaces) are *delimiters*,
   not cells; record whether the row had them (`leading`, `trailing`). Cell text is trimmed.
3. Column count = max cells over rows; short rows are padded with empty cells.
4. Display width of a cell = sum over grapheme clusters (`Intl.Segmenter`, `'grapheme'`):
   0 for combining marks (`\p{M}`), 2 for East Asian Wide and Fullwidth (ranges:
   `ᄀ–ᅟ`, `⺀–꓏`, `가–힣`, `豈–﫿`, `︰–﹏`,
   `＀–｠`, `￠–￦`, `\u{1F300}–\u{1FAFF}`, `\u{20000}–\u{3FFFD}`), else 1.
   Escaped pipes `\|` count 2 (they are two characters in the source).
5. Column width = max display width in the column, minimum 3 (the alignment row needs `---`).
6. Rebuild: cells padded with spaces to the column width, one space padding inside each pipe,
   `leading`/`trailing` pipes as the row originally had them. The alignment row keeps its
   colons: `:---`, `---:`, `:--:` stretched to the column width.
7. Rejoin with each line's original ending. If the result equals the input, `replacement = text`.

`summary = "Aligned N columns across M rows"`.

| Case | Expect |
| --- | --- |
| ragged widths | pipes aligned; content unchanged |
| `a \| b` escaped pipe in a cell | stays escaped; counted as width 2 |
| inline code `` `x|y` `` | the `|` splits the cell (GFM semantics); output identical to input semantics |
| CJK cell (`07-cjk.md` table) | wide characters counted 2; pipes align in a monospace column |
| row without leading pipe | rebuilt without leading pipe |
| alignment row `:---:` | becomes `:----:` at width 6 |
| CRLF table | every line keeps `\r\n` |
| 40-row pathological table | completes in < 5 ms |

## Palette integration (§09)

`OPERATIONS.filter(op => op.canApply(input))` for the current selection; each entry shows
`title` and, for copy operations, a `⌘C`-style hint. `Enter` applies. After a mutation the
palette closes; after a copy it closes and the notice says "Copied".

## The command registry (`apps/desktop/src/commands/`)

Operations are pure and live in core; everything else a reader can *do* (save, find, outline,
switch mode, revoke a grant, about) is app code. The palette's operations section and the
keyboard map read **one list**, so a command cannot be reachable by key and invisible in the
palette, or the reverse (MARXY-48's keyboard-completeness audit is then a test over this list):

```ts
// apps/desktop/src/commands/registry.ts
export interface Command {
  readonly id: string;                         // 'save', 'find.open', 'op.toggle-task', 'trust.revoke-html', 'about'
  readonly title: string;                      // palette text, sentence case, no trailing period
  readonly key?: string;                       // the §09 keyboard-map string, e.g. 'Mod+S'; absent = palette only
  readonly group: 'document' | 'selection' | 'view' | 'app';
  when(ctx: AppContext): boolean;              // cheap; evaluated on every palette open
  run(ctx: AppContext): Promise<void>;
}
export function fromOperation(op: Operation): Command;   // id 'op.<op.id>', group 'selection', when = canApply on the current selection, run = apply (above)
export function commands(): readonly Command[];          // the concatenation below, in palette order
```

Each feature owns one file that exports its commands (`commands/document.ts` save and save-as,
`commands/view.ts` mode, find, outline, size, `commands/trust.ts`, `commands/app.ts` about and
quit), and `commands/index.ts` concatenates them with `OPERATIONS.map(fromOperation)`. MARXY-42
creates the registry, the operation adapter and `index.ts`; every later story adds its own file
and one line to `index.ts`. `keys.ts` (MARXY-86) binds by looking up `key` in this list rather
than holding its own table once the registry exists; MARXY-48 moves it over.
