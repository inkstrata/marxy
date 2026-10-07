# Text operations and click tools: what exists, what to build, how it should appear

**Date:** 2026-10-01 · **Audit task:** `feature-textops` · **Scope:** the author's third feature idea,
"really strong clipboard/text manipulation with simple click tools", read with the restated spirit
"a reader before a writer, but adept at both; manage AI output in Markdown/HTML".

**Abstract.** Marxy already has the hard part of this feature: one frozen operation contract
(`string -> string` over a byte range), a command registry that feeds both the palette and the keys,
an exact-byte splice with one undo step per operation, and a clipboard path that writes plain text and
HTML together. What it lacks is the catalogue (four operations ship), a way to *reach* them by pointer
(there is no click surface; two of the four are awkward to reach at all), a rich-clipboard path for
ordinary text selections, and any paste-side behaviour. This document inventories what exists, surveys
how fourteen tools model the same problem, proposes a ranked catalogue of about thirty operations
grouped as copy, transform, extract and paste, designs a zero-chrome way to click them, answers the
"how much writing" question, and breaks the work into nine stories. The main recommendations are: build
the copy and extract catalogue first, because it is clipboard-only and cannot corrupt a byte by
construction; make one *verb menu* (right-click, context-menu key, Enter on a selection) the click
surface; let Rendered mode paste open the clipboard as a scratch document instead of giving it a caret;
and treat inline block editing as an optional, ADR-gated later step, not part of this feature.

---

## 1. Findings in brief

1. **The mechanism is finished and sound; the catalogue is four items.** `OPERATIONS` holds
   `copy-code-clean`, `copy-section`, `toggle-task` and `align-table-pipes`
   (`packages/core/src/operations/index.ts:7`). All 43 operation tests pass today (command in the
   appendix).
2. **Two of the four operations are hard to reach by pointer.** A click on a table cell selects the cell,
   not the table, so `align-table-pipes` needs a click plus two `Alt+Shift+Up` presses. `toggle-task` is
   *not offered by the palette at all* for a selected list item, because its `canApply` demands the range
   equal the three marker bytes (probe in the appendix). Only the checkbox click reaches it.
3. **`Mod+C` dispatch will break the day a second copy operation applies to the same node.** It picks the
   first operation whose id starts with `copy-` (`apps/desktop/src/selection/apply.ts:39-49`). A catalogue
   needs an explicit default verb per selection kind.
4. **A drag selection copies plain text only.** `runCopyShortcut` writes `{ text }` with no HTML flavour for
   a `text` selection (`apply.ts:50-53`), so a styled excerpt pasted into Docs or an email loses bold, links
   and lists. The HTML path exists and is sanitised; it is only wired for node and section selections.
5. **The shell already supports the rich clipboard.** `clipboard_write` calls the plugin's
   `write_html(html, Some(alt))`, so HTML and plain flavours go out in one write
   (`apps/desktop/src-tauri/src/main.rs:66-79`). `tauri-plugin-clipboard-manager` 2.3.3 has **no
   `read_html`** (it exposes `read_text`, `read_image` and the writers); paste-side HTML must come from
   the webview's `paste` event, not the plugin.
6. **Most of the catalogue fits the frozen contract unchanged.** A prototype of `copy-table-tsv` and
   `unwrap-markdown-fence` took 32 lines in scratch, ran over all 20 corpus tables, and left every
   `replacement` equal to its input. The things that need more are: span or multi-block selection,
   `OperationInput` lacking the whole source (already deferred as P04 in ADR-0036), and paste.
7. **The roadmap's "at most four new operations per release" cap contradicts this feature.** It was written
   to keep the palette quiet. The palette is already filtered by selection (`palette/view.ts:94`), so the
   cap protects against a problem the design already solves; the real constraint is how many verbs one
   kind of selection shows.
8. **"Writing" does not need Rendered-mode authoring.** Source mode is CodeMirror 6, "Jump to source"
   exists, and `foldText` already turns an editor change into one minimal byte splice
   (`packages/core/src/buffer/buffer.ts:85`). A block editor is a small step on top, but under ADR-0005's
   own sentence it is a decision for the author, recorded in an ADR, not a drive-by feature.

---

## 2. What exists

### 2.1 The mechanism (read from the code, not the docs)

- **Contract** (`packages/core/src/contracts/operation.ts`, frozen by ADR-0004): an `Operation` has
  `id`, `title`, `appliesTo` (`span | block | section | document`), `canApply(input)` and `run(input)`;
  the result is a `replacement` for the range plus an optional `clipboard: { text, html? }` and `summary`.
  `replacement === text` means "no change". An operation never sees view state or bytes outside its range.
- **Selection** (`apps/desktop/src/selection/selection.ts:7-12`): `none | node | section | document | text`.
  A click selects the innermost carrier of `data-marxy-s`; a heading click means its whole section
  (`selection/input.ts:20-26`); a drag is `text`, which never resolves to bytes (design 03).
- **Apply** (`selection/apply.ts:6-37`): `canApply` -> `run` -> clipboard write -> optional splice through
  `applyBufferMutation` -> notice ("Copied" or the summary). The splice is serialised, reparsed and
  pushed to the undo history (`commands/edits.ts`, `applyDocumentMutation`). Nothing is written to disk.
- **Registry** (`commands/registry.ts:36-46`): `fromOperation(op)` yields a `Command` with id `op.<id>`,
  group `selection`, `when = canApply(current selection)`. The palette's `>` mode lists exactly the
  applicable `op.*` commands (`palette/view.ts:94`). Keys come from the same list.
- **Splice** (`buffer.ts:47-60`): bytes before and after the range are copied verbatim; **no line-ending
  conversion happens**. An operation that emits new newlines in a CRLF file must read the ending from its
  own input text. This is the single most likely fidelity bug in new operations.
- **Source-mode edits** fold back with `foldText` (`buffer.ts:85-115`): common prefix and suffix are kept,
  CRLF and surrogate pairs are never cut, and the replacement follows the file's line-ending convention.
- **Clipboard** (`packages/shell-api/src/index.ts:36`, `apps/desktop/src/shell/tauri.ts:195`): the shell API
  has `clipboardWrite({ text, html? })` and nothing that reads. The Tauri capability grants only
  `clipboard-manager:allow-write-text` and `allow-write-html`
  (`apps/desktop/src-tauri/capabilities/default.json:8-9`).

### 2.2 Inventory

| Operation | Implemented in | Reachable from | Tested by |
| --- | --- | --- | --- |
| Copy code (`copy-code-clean`) | `packages/core/src/operations/copy-code-clean.ts` (20 lines) | `Mod+C` with a code block selected; palette `>` | Table in `operations.test.ts:129`; corpus fidelity `operations.test.ts:369`; Playwright `operations-copy.test.mjs:106,179` |
| Copy section (`copy-section`) | `copy-section.ts` (152 lines; carries sanitised HTML with `data-marxy-*` stripped) | `Mod+C` with a heading, section or document selected; palette `>` | Table `operations.test.ts:59`; fidelity `:369`; Playwright `operations-copy.test.mjs:72` |
| Toggle task (`toggle-task`) | `toggle-task.ts` (38 lines) | **Checkbox click only** (`apps/desktop/src/render/tasks.ts:30-50`, capture-phase listener). Not offered by the palette for a list-item selection | Table `operations.test.ts:260`; mutation fidelity `:407`; Playwright `operations-edit.test.mjs:95,197` |
| Align table pipes (`align-table-pipes`) | `align-table-pipes.ts` (166) + `display-width.ts` (41) | Palette `>` when the *table* is selected: click a cell, then `Alt+Shift+Up` twice (cell, row, table) | `align-table-pipes.test.ts`; fidelity `operations.test.ts:407` |
| Undo / redo of any of the above | `commands/edits.ts` | `Mod+Z`, `Mod+Shift+Z` | `operations-edit.test.mjs:197` |
| Edit in Source, fold back | `source/buffer-commit.ts`, `buffer.ts:foldText` | `Mod+E` toggle; "Jump to source" palette command | `buffer-commit.test.mjs`, `mode-switch.test.mjs` |
| Drag-selection copy | `selection/copy-text.ts` (drops marker glyph text) | `Mod+C` | `invisibles.test.mjs` (marker glyphs); no test for the HTML flavour because there is none |
| Paste | none (the native Edit menu has the OS Paste item; Rendered mode has no caret to receive it) | - | - |

Counts: 27 `test(` calls in `operations.test.ts`, 5 each in `operations-copy.test.mjs` and
`operations-edit.test.mjs`. The corpus has 22 markdown files with 20 tables, 20 fenced code blocks and 22
task markers, which is what the fidelity property runs over.

### 2.3 What the handbook already settled

- **ADR-0036 clause 5**: copy is exact where the text is code; smart typography never runs in code; a
  block copy ends in a newline only if the source did.
- **Handbook spec 10** lists operations as proposals (`copy-source`, `copy-command`, `copy-diff-after`,
  `extract-*`, `copy-json-pretty`, `strip-ansi`, `copy-front-matter`, ...) with the rule that the
  **`copy-*` form of a transform comes before the splice form**. I adopt that rule below.
- **Three gaps** the handbook records and I confirm: `OperationInput` lacks the whole source, so
  `copy-with-reference` is not expressible (ADR-0036 clause 12, P04); lenses are not operations (clause 8);
  a drag in prose copies rendered text, source bytes are "one named operation away" (spec coupling rule).
- **Chapter 01 §9, item 8** calls the copy button on every code block "exactly the chrome Marxy forbids at
  rest; no study tests it". That is the evidence base for section 5.

---

## 3. Prior art

Each row says how the tool *models* the operation, how it is invoked, what undo means, what selection
granularity it works at, and what a reader should borrow. Rows marked (K) rest on my knowledge of the
product, not on a page fetched in this session; the others are backed by the sources listed after the
table.

| Tool | Operation model | Invocation | Undo | Selection granularity | Borrow for a reader |
| --- | --- | --- | --- | --- | --- |
| Boop | A scratchpad; a script is `string -> string` over the whole buffer or the selection | Global shortcut, then a fuzzy picker (Cmd+B) | The result replaces the input; the editor's undo | Whole text or selection | The picker model is Marxy's palette. Its failure mode is replacing the input: Marxy must keep *copy* forms next to *splice* forms |
| DevToys | Tools chosen by content; "smart detection" reads the clipboard and suggests the tools that accept it | Sidebar of tools, clipboard auto-detect | Per-tool input/output panes, no document | Whole clipboard | **Clipboard sniffing**: offer verbs by what the clipboard or selection *is* (JSON, table, markdown), exactly Marxy's `canApply` |
| Raycast clipboard history and text tools | History of clips; actions per clip ("Paste as plain text", "Paste as..." to pick a flavour) | Hotkey, filter by type, action panel | Not applicable | Whole clip | **Flavour choice at paste time**: plain, rich, HTML, as a named verb rather than a preference |
| Maccy | Clipboard history, search, paste | Hotkey; option-Enter pastes, option-shift-Enter pastes without formatting | Not applicable | Whole clip | A modifier on the confirm key picks the variant. Maps to Enter vs Shift+Enter in a verb menu |
| Paste (K) | Visual clipboard history with pinboards | Hotkey, filmstrip UI | Not applicable | Whole clip | Little; its UI is chrome-heavy |
| Sublime Text / VS Code commands | Pure edits over each selection: case, sort lines, join, dedupe, trim, align | Command palette, key chords | Native undo, one step | **Per selection, multi-cursor** | The best catalogue of *line-level* verbs. They need a caret and spans, so in Marxy they belong in Source mode |
| Vim text objects (K) | A noun (word, paragraph, block, tag) composed with a verb | Keys: `d i p`, `y a {` | Native undo, count-aware | Semantic nouns, not pixels | **Selection by meaning**: Marxy's node, section, document are text objects; adding "the list" or "all code blocks" extends the same idea |
| Obsidian | Core commands act on the editor; "copy as HTML" is only available through community plugins | Command palette, context menu | Native | Selection or note | A strong signal that readers want copy-as-HTML (five plugins exist) and the core never shipped it |
| Typora | Default Copy puts HTML, RTF and text on the clipboard together; explicit **Copy as Markdown** (Cmd+Shift+C) and **Copy as HTML Code** in the Edit menu | Edit menu, key chords | Native | Selection | **The pair "copy rich" and "copy source" on stable chords**; the explicit menu entries make the formats discoverable |
| iA Writer | "Copy as HTML" in Edit; "Copy Formatted" (Option-Cmd-C) for rich text | Edit menu, chords | Native | Selection or document | Same lesson: a menu entry per output format |
| Drafts | An *action* is a named list of steps (text transforms, services, clipboard); "Copy as Rich Text" is a stock action; "HTML > Markdown" exists | Action list, key, URL | Draft versioning | Whole draft or selection | Named, curated actions; **no user scripting needed** if the list is good. (Drafts allows scripts; ADR-0004 forbids them) |
| TextSoap | Cleaners: ordered rule sets (strip spaces, fix quotes, remove characters); 100+ built in | Window, menu-bar, macOS Services, context menu | Original text kept | Selection or document | **Cleaners as one-click named verbs**, and exposure through a context menu |
| macOS Services and Shortcuts (K) | The OS lists services that accept the selection's type | Services submenu, context menu, key | Per app | Selection, typed | Marxy is not a Services provider, but its verb menu mimics the Services idea: only what applies |
| `jq` / `yq` (K) | Structured query and transform over a typed value | Shell | None (pipes) | Whole value | Typed transforms (pretty-print, minify, pick fields) fit "copy table as JSON". The danger is a parse-then-print round trip that drops comments; handbook ch. 03 already bans it |
| mdformat, Prettier, remark plugins | Whole-document formatters over an AST; `proseWrap: preserve` exists because wrapping is renderer-sensitive; idempotency bugs have shipped | CLI, editor integration | Version control | Whole document | A cautionary row: a whole-document normaliser **violates "never touch a byte the user did not ask to change"** unless it is a named, previewed, opt-in verb. Marxy's operations are local and say what they touched |

Sources fetched in this session: Boop and clones ([Boop](https://github.com/felixse/Boop),
[Woop](https://github.com/felixse/Woop)); [Typora copy and paste](https://support.typora.io/Copy-and-Paste/);
[Maccy](https://maccy.app/); [Drafts actions](https://actions.getdrafts.com/a/197) (HTML > Markdown, Copy as
Rich Text); [Raycast clipboard history](https://manual.raycast.com/clipboard-history);
[DevToys smart detection](https://devtoys.app/doc/articles/extension-development/guidelines/UX/support-smart-detection.html);
Obsidian [Copy as HTML](https://community.obsidian.md/plugins/copy-as-html) and
[Content Copy](https://community.obsidian.md/plugins/markdown2html); VS Code transform, sort and join
commands (search results only, no primary page); [TextSoap](https://www.macworld.com/article/173482/textsoap-2.html);
[Prettier options](https://prettier.io/docs/options). Search summaries are not primary documentation; treat
exact key chords as to be re-checked before they are copied into a spec.

**What the survey says.** Three patterns recur. (1) *Verbs filtered by what the selection or clipboard is*
(DevToys, Services, Marxy's own `canApply`). (2) *Output format as an explicit, named, chord-bound verb*
(Typora, iA Writer, Raycast "Paste as..."). (3) *Curated actions, not scripts* (Drafts' stock actions,
TextSoap's cleaners). Marxy's architecture already matches (1) and (3); (2) is the gap. No surveyed tool
combines these with a byte-exact splice and a provenance map, which is Marxy's real edge here: it can
promise that "Copy as Markdown" returns the author's bytes and that an in-place verb changed only the
bytes it names.

---

## 4. The catalogue

Ranking is by *value for reading and managing AI output* divided by *risk and effort*. The value column is
a judgement ([D] in the handbook's grading: reasoned default, no study behind it); effort is a relative
size anchored to measured code: `toggle-task` is 38 lines, `copy-code-clean` 20, `align-table-pipes` 207
with its width helper, and my scratch prototype of two operations was 32 lines.

**Fidelity risk key.** *None*: clipboard-only, `replacement === text`, safe by construction and covered by
the existing property at `operations.test.ts:369`. *Low*: rewrites marker or delimiter bytes only.
*Medium*: rewrites text inside the range, so the "only the named bytes changed" claim needs its own
property. *High*: semantic rewrite; do not build as a splice. **Contract fit key.** `S->C`: string to
clipboard. `S->S`: splice inside the selected range. `S->S*`: needs a span or multi-block selection.
`needs P04`: needs the whole source in `OperationInput`.

### 4.1 Copy side (build first; none of these can change a byte)

| # | Operation | Value for AI output | Risk | Fit | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | Copy code (exists) | High | None | S->C | done |
| 2 | Copy section as markdown + HTML (exists) | High | None | S->C | done |
| 3 | **Copy as plain text** (block, section): inline text joined, straight quotes, no markup | High: pasting into chat, commits, email | None | S->C | S |
| 4 | **Copy as rich HTML** for a node (reuses the sanitised path in `copy-section.ts`) and for a drag selection | High: Docs, Notion, email | None | S->C; shell already writes both flavours | S for node, M for drag |
| 5 | **Copy as markdown (exact source bytes)** for a block | Medium: the "named operation" ch. 05 promised | None | S->C | XS (`copy-source` in spec 10) |
| 6 | **Copy command** (strip `$ ` prompts from a shell fence) | High: install steps | None | S->C | S; rules written in ch. 06 §8 |
| 7 | **Copy all code blocks** (section, document) | High: an agent answer with five snippets | None | S->C | S |
| 8 | **Copy table as TSV / CSV / JSON / markdown** | High: AI tables go to spreadsheets | None | S->C | S (prototype: 20 of 20 corpus tables, regular columns) |
| 9 | Copy links (destinations, or markdown) and **copy link address** | Medium | None | S->C | S |
| 10 | Copy outline (headings as a nested list) | Medium: `outlineFrom` exists | None | S->C | XS |
| 11 | Copy with or without front matter | Medium: agent files carry YAML heads | None | S->C | XS (ch. 03 `copy-front-matter`) |
| 12 | Copy diff after / before; copy as patch (= the fence content) | Medium | None | S->C | S (ch. 05) |
| 13 | Copy JSON pretty-printed (token-level) | Medium | None | S->C | M (never parse-then-print, ch. 03) |
| 14 | Copy without invisible characters | Medium (trust) | None | S->C | S |
| 15 | Copy with `path:L-M` reference | Medium | None | **needs P04** | blocked on a contract change |

### 4.2 Transform in place (value is real, but each needs a minimal-diff property)

| # | Operation | Value | Risk | Fit | Effort |
| --- | --- | --- | --- | --- | --- |
| 16 | Toggle task (exists); **make it palette-reachable** | High | Low | S->S | S (fix `canApply` for a list item) |
| 17 | Align table pipes (exists) | Medium | Low | S->S | done |
| 18 | **Unwrap a `markdown` fence around a whole document** | High: LLMs routinely return the answer inside one | Low: replaces the fence lines with the content bytes | S->S | S (prototype ran; use `codeBlock.content`, not `value`, which drops the last newline) |
| 19 | Promote / demote heading (section: its `#` run and its sub-headings) | Medium | Low (ATX only; refuse setext; clamp 1..6; closers preserved) | S->S | S |
| 20 | Convert bullets to numbers and back; **renumber** a list | Medium | Low-medium (marker bytes only; keep start and delimiter) | S->S | S to M |
| 21 | Normalise `*`, `+`, `•` bullets to `-` | Medium: chat UIs paste `•` | Low | S->S | S |
| 22 | Pretty-print / minify JSON in a fence | Medium | Medium (token-level only) | S->S | M |
| 23 | Sort list items (top-level, children travel with their item) | Low-medium | Medium (loose lists, blank lines) | S->S | M |
| 24 | Fix smart quotes in text nodes (outside code, links, HTML, front matter) | Medium | Medium | S->S* | M |
| 25 | Rewrap / unwrap paragraphs | Medium | Medium-high (hard breaks, code spans, list indent, quote prefixes) | S->S* | L |
| 26 | Strip markdown to plain text **as a splice** | Low | High: destructive | - | **Do not build**; item 3 is the safe form |
| 27 | "Normalise document" (mdformat style) | Low | High: touches bytes nobody asked about | - | **Do not build** (commitment 4) |
| 28 | Dedupe lines, join lines, change case, trim | Low in Rendered | Medium | S->S* | S, **in Source mode only** (section 6.2) |

### 4.3 Extract (clipboard or scratch document, never a silent file write)

| # | Operation | Value | Risk | Fit | Effort |
| --- | --- | --- | --- | --- | --- |
| 29 | Extract all tasks / **every unchecked item** (section, document) | High: the agent's TODO list | None | S->C | S (ch. 01) |
| 30 | Extract all code, all links, all headings | Medium | None | S->C | S (items 7, 9, 10 at document scope) |
| 31 | **Section to a new document**: opens a scratch buffer, then Save As | High | None until the reader saves | needs scratch buffer (section 7.2) | M |
| 32 | Every unchecked item across the repository | High | None | v2 cross-document, the index exists | L, roadmap Horizon 3 |

### 4.4 Paste side

Rendered mode has no caret, so "paste" needs a target. The reader-shaped answers:

| # | Operation | Value | Risk | Fit | Effort |
| --- | --- | --- | --- | --- | --- |
| 33 | **Paste in Rendered mode opens the clipboard as a scratch document**: markdown as is; HTML (a chat UI's copy) sanitised then converted to markdown; JSON or code wrapped in a fence | Highest paste value: read an answer typeset, then copy sections from it | None: no file exists until Save As | new app-side command | M |
| 34 | In Source mode: paste HTML as markdown | High | Low: the reader pasted it | CodeMirror paste handler | M |
| 35 | In Source mode: paste as a code fence (language guessed) | Medium | Low | CodeMirror handler | S; **core has no content-based language detection** (`grep -i detect packages/core/src/highlight` finds nothing), so start from the tag the source gave or ask |
| 36 | In Source mode: paste a TSV or CSV as a GFM table (reuses `align-table-pipes`) | Medium | Low | CodeMirror handler | S |

HTML to markdown has a design wrinkle. The core sanitiser is a *tokenizer, not a tree builder*
(`packages/core/src/sanitize/sanitize-html.ts:1-30`) and core takes no DOM, so a converter cannot reuse it as
a tree. Two honest options: write the converter in `apps/desktop` over `DOMParser` after sanitising (pasted
HTML is hostile input), or add a tree-building dependency to core through the licence allow-list
(`scripts/allowlists/dependencies.json`, ADR-0006). The first keeps core small; it is not an
`Operation` because it has no source range to transform.

### 4.5 The ten to build first

By rank: 3, 4, 8, 7, 6, 18, 29, 33, 16 (reachability), 5. All are clipboard-only or marker-level, and the
first eight need no selection or contract change.

---

## 5. "Simple click tools" at zero chrome

The constraint is design constraint 6 in `docs/design-language.md`: "Rendered mode at rest is a column of
text and nothing else." The bar in AGENTS.md is that an ordinary-looking viewer is a failure. A surface is
acceptable only if it is **absent at rest and appears only on intent**, and does not fight the baseline grid
or the measure.

| Surface | At rest | Fights the grid or measure | Keyboard parity | Notice |
| --- | --- | --- | --- | --- |
| Hover copy glyph on code and tables (GitHub style) | Zero until the pointer arrives | Needs a position inside the measure or margin; code blocks hang on a 2ch rule | Needs a focus stop per block (chapter 01 notes the cost) | Appears on *any* mouse pass over a block while reading. Reading with a mouse resting over text is common. Evidence: "no study tests it" |
| Selection popover (Medium style) | Zero | Floats over text, covers the thing being selected | Hard: no natural key to open | A click selects a block in Marxy (paints a left edge). A popover on every click is noise |
| Block handle in the gutter (Notion style) | A glyph appears per hovered block | Directly competes with hanging punctuation and the margin; this is the construct the constraint exists to prevent | None natural | Rejected |
| Right-click context menu (DOM, themed) | Zero | Appears where the pointer is, then goes away | **Natural**: context-menu key, `Shift+F10`, ctrl-click on macOS | A deliberate gesture, so it cannot become noise |
| Palette `>` filtered by selection | Zero | A modal overlay already shipped | Complete | Already built; the weakness is that it is not "click" |
| Native menu (Edit > Copy as...) | Zero | None | Chords shown beside entries | Fixes discoverability; needs a menu change (below) |

**Recommendation.**

- **Primary surface: one verb menu.** A single DOM component, drawn from the registry
  (`commands().filter(group === 'selection' && when(ctx))`), ordered by an explicit rank, at most seven
  rows plus a last row "All actions..." that opens the palette in `>` mode. It opens by **right-click**, by
  the **context-menu key**, and by **Enter on a selected block** (Enter is not a letter, so the "no
  single-letter bindings" rule in design 09 holds). Rows show their chord. Arrow keys and Enter drive it;
  Esc closes. For a drag selection the rows are the copy formats (plain, rich, markdown of the covering
  blocks). For a code block: Copy code, Copy command, Copy as markdown, Pretty-print JSON. For a table:
  Copy as TSV, CSV, JSON, Align pipes. For a heading: Copy section, Copy as rich, Extract tasks, Section to
  new document, Promote, Demote.
- **Secondary surface: the palette `>` list as it is**, plus a selection-kind line ("Code block, json") at
  the top so a reader sees *why* those verbs are offered.
- **Not now: the hover glyph.** If the author wants one-click copy for code, the cheapest variant is a text
  label ("Copy") in the block's caption position on hover or focus-within, only for code and tables, behind
  a taste-queue row. It is the only element on this list that appears without a deliberate act, so it should
  be the last to ship and the first to be judged.

**Keyboard parity (required by `docs/operations.md` constraint 2).** `Mod+C` runs the selection's *default
verb* (copy code, copy section, copy table as TSV, copy plain text for a drag selection); `Mod+Shift+C`
copies as markdown (Typora's chord for the same idea, to be re-checked); `Mod+Alt+C` copies as rich HTML
(iA Writer's "Copy Formatted" chord, to be re-checked); every verb is a registry command, so it is also in
the palette. A native **Edit > Copy as** submenu would make the formats discoverable on macOS, but a test
currently pins Edit to the OS's own items (`main.rs:1047-1051`) and the menu-chord replay table in
`apps/desktop/src/menu/menu-commands.ts` is a hand-kept list; treat the submenu as a later, separate
decision, not part of this feature.

**Required plumbing change.** Replace the `copy-` string-prefix dispatch with an explicit
`defaultVerbFor(selectionKind, nodeType)` table. Today two copy operations applying to one node make
`Mod+C` order-dependent.

---

## 6. The writing question

The author says "adept at both". The question is how much writing fits a reader.

### 6.1 What the project's own text says

- **ADR-0001**: authoring features, named as "live render, WYSIWYM, table editors", are out of scope;
  "when reading and editing want different things, reading wins". It does not forbid editing text.
- **ADR-0004**: editing in Rendered mode *is* transformation of existing bytes. Nothing in it permits
  typing new text into the rendered surface.
- **ADR-0005**: Source mode is "both the edit surface and the code-observation surface"; "if authoring ever
  re-enters scope this ADR must be revisited first".
- **Roadmap tripwire**: "Authoring re-enters scope -> ADR-0005 first; then the stack (Electron's single engine
  matters again for `contenteditable`)". The second half tells us what the tripwire is *about*: caret and IME
  inside decorated, typeset output. ADR-0005's rationale lists exactly that cluster as the risk it deleted.

### 6.2 What that implies

The tripwire fires on **writing into the rendered surface**. It does not fire on anything that stays in
Source mode or on the operation mechanism. That gives three options.

| Option | What it is | Fits | Cost | Verdict |
| --- | --- | --- | --- | --- |
| A. Nothing beyond Source | A fix to one block today is: select, "Jump to source", edit, toggle back; position survives by source-map coordinate (ADR-0018) | Fully | Zero | **The baseline.** Make "Edit in Source" a visible verb on a selected block so the path is one click |
| B. Edit this block in place | Enter-and-edit: a small CodeMirror 6 island opens over the selected block's byte range in the code face; on commit a `foldText`-style slice fold produces one splice and one undo step | Does not touch the typeset surface and needs no `contenteditable`, but it *is* authoring in Rendered mode, so ADR-0005's sentence applies | M: one story for the island, one for the slice fold with CRLF and BOM handling | **Recommended as the "adept at both" answer, but only after a short ADR** that says: writing is bounded to a source range, in the code face, one undo step, no caret in the typeset text |
| C. Quick note append | Add a line, bullet or `- [ ]` task after a block or at the end of a section | Same bytes-the-reader-typed principle | S to M | **Not recommended.** It makes Marxy rewrite files that an agent will regenerate; it also collides with the external-change-while-dirty path (design 08) for little reading value |

The honest reading is that "adept at both" is already mostly true: Source mode is a real editor with
explicit save, byte-faithful folding and mixed-ending preservation. What is missing is not a feature but a
*short path* (option A made one click) and, if the author wants it, one bounded step (option B). Neither
needs the stack reconsidered.

**Span-level text tools** (case, sort lines, dedupe, join, trim, fix quotes, rewrap) belong in **Source
mode**. A CodeMirror selection already gives a precise span in UTF-16 units, convertible to bytes with
`utf16ToByte` (`buffer.ts`). In Rendered mode a drag cannot resolve to bytes honestly (design 03: smart
typography and soft hyphens change the painted characters), so the Rendered equivalent is **block-aligned
multi-block selection** (Shift+click, or Shift+Alt+Down extending a sibling range). A run of sibling blocks
is one contiguous range with block-aligned ends and `node` undefined, which is exactly what the contract's
`span` applicability can carry without any contract change. `Selection` is an app-side union, not a frozen
file.

---

## 7. Implementation sketch

### 7.1 What is a weekend, what needs more

| Need | Items | What changes |
| --- | --- | --- |
| Pure function, no other change | 3, 5, 6, 7, 8, 9, 10, 11, 12, 14, 29, 30, 18, 19, 21 | A file in `packages/core/src/operations/`, one line in `OPERATIONS`, a table test |
| Selection or reachability change | 16 (toggle from a list item), 17 (table click should select the table on a second click or a "select enclosing block" verb), 25, 24 (multi-block), 28 (Source-mode input) | `selection/input.ts`, `selection/selection.ts`, a Source-mode `operationInputFor` |
| Shell or webview clipboard | 4 (drag selection HTML), 33-36 (paste) | See 7.2 |
| Contract change (own ADR, own PR) | 15 | `OperationInput.source` (P04) |
| New app-side concept | 31, 33 (scratch buffer), the verb menu | `untitled` buffer paths exist (`save.ts:85`, `design/01-buffer.md:92`) but nothing creates one |

Every operation that emits newlines must take the line ending from its input text, because `splice` does no
conversion. Operations that need the last newline of a fence body must use `codeBlock.content`, a byte
range, and convert it to string offsets themselves (the string `text` and the byte `Source` use different
units; a 5-line helper in core would serve every such operation).

### 7.2 Shell and clipboard

- **HTML flavour is supported, and already used.** `tauri-plugin-clipboard-manager` 2.3.3 exposes
  `write_text`, `write_html(html, alt_text)`, `write_image`, `read_text`, `read_image`, `clear`; the shell
  command writes both flavours in one call because arboard's macOS HTML write clears the pasteboard first
  (`main.rs:73-76`). Items 4 and 5 need **no Rust change**: only the HTML producer for a drag selection
  (clone the DOM range, sanitise, strip `data-marxy-*`, as `copy-section.ts` does).
- **There is no `read_html`.** arboard 3.6.1 (the plugin's backend) has `Get::html()`, but the plugin does not
  expose it. For paste, use the webview: a document-level `paste` listener reads `clipboardData.getData
  ('text/html')` and `('text/plain')` during the user gesture. That needs no new capability and no new Rust
  code. **Unverified here:** whether WKWebView and WebKitGTK deliver a `paste` event to a document with no
  editable focus (the macOS Edit > Paste item may be disabled there); a half-day spike on both engines
  should settle it before story 5 is sized. A command that reads the clipboard *without* a paste event (a palette "Open clipboard") would need
  `clipboard-manager:allow-read-text` plus either a plugin fork or a direct arboard command; I recommend
  against it, because the paste event is both sufficient and the better-behaved privacy surface (no
  background clipboard read exists in the shell API).
- **Trust.** Pasted HTML is untrusted: it goes through the existing sanitiser before conversion, and the
  scratch buffer renders under the default policy (remote images blocked, ADR-0027).
- **Shell API.** `clipboardWrite` is all that is needed; keep `shell-api` unchanged. A `clipboardRead` would
  widen a frozen surface (ADR-0026) for a gain the paste event already provides.

### 7.3 Story breakdown

Nine stories, in order. Each has one acceptance line and names its test shape. They are separable: stories
2, 3 and 4 can run in parallel after 1.

| # | Story | One-line acceptance |
| --- | --- | --- |
| 1 | **Default verbs and reachability** | A table in code maps each selection kind to one default verb; `Mod+C` uses it; a registry test asserts exactly one default per kind; a selected list item offers `toggle-task` in the palette |
| 2 | **Copy pack** (items 3, 5, 6, 7, 8, 9, 10, 11, 12) | Each operation has a table-driven test and `replacement === text` over every corpus node it applies to; a CRLF and a no-trailing-newline fixture are in every table |
| 3 | **Rich clipboard for a drag selection and a node** (item 4) | `Mod+C` on a drag writes plain and sanitised HTML in one `clipboard_write`; the HTML has no `data-marxy-*`, no script, no remote URL beyond link `href`s; a Playwright test checks both payloads |
| 4 | **Extract pack** (29, 30) | "Every unchecked item" over `03-ai-plan.md` returns the expected lines in document order; section and document scope both covered |
| 5 | **Scratch buffer and paste** (31, 33) | In Rendered mode `Mod+V` opens the clipboard as an untitled buffer; HTML input is sanitised then converted; nothing is written to disk until Save As; golden pairs cover the markdown, HTML and JSON paths |
| 6 | **Transform pack** (16 fix, 18, 19, 20, 21) | Each has a table test, a CRLF case, and the *minimal-diff property* below, over every applicable corpus node |
| 7 | **Verb menu** (section 5) | Right-click, the context-menu key and Enter open one menu built from the registry; at rest the DOM contains no menu or glyph (a test asserts it); every row is also a palette command; keyboard-complete |
| 8 | **Source-mode span operations** (28 and span items) | A CodeMirror selection becomes an `OperationInput`; sort, dedupe, join, case and trim run as one undo step and leave bytes outside the selection unchanged |
| 9 | **Multi-block selection and span operations** (24, 25) | Shift+click selects a contiguous sibling range; rewrap and quote-fix run over it; a property test shows only whitespace or quote bytes changed |

Gated, not scheduled: **edit block in place** (option B) after an ADR; **cross-document extract** (item 32)
with the v2 work; **`copy-with-reference`** after the P04 contract ADR.

### 7.4 Test shape

1. **Table-driven `(input, range, expected)`** per operation, as in `operations.test.ts:59,129,260`, with
   mandatory rows for CRLF, no trailing newline, BOM, empty input, CJK width where columns exist, and
   "`canApply` false on the wrong node".
2. **The existing fidelity property** (`operations.test.ts:369,407`): for every corpus node an operation
   accepts, `replacement === text` for clipboard operations and bytes outside the range are unchanged for
   splices. Extend it to the non-markdown corpus files, as spec 10 already asks.
3. **A new minimal-diff property** for transforms whose range is larger than the bytes they mean to change
   (promote heading, renumber, normalise bullets, fix quotes). Define the *target spans* (heading markers,
   list markers, text-node bytes) and assert that the replacement differs from the input **only inside
   those spans**. This is stronger than "outside the range" and is what "never touch a byte the user did not
   ask to change" means inside a large range.
4. **A round-trip property for clipboard formats**: for `copy-table-*`, re-parse the TSV or the markdown
   output and compare the cell grid to the AST's; for plain text, assert the output contains no markup
   characters that the AST says were markup.
5. **A mutation guard**, as at `operations.test.ts:427`: corrupt one byte outside the range and assert the
   guard fails, so the property is shown able to fail.
6. **Playwright** only where the DOM is the point: the clipboard payloads (`operations-copy.test.mjs` style),
   the verb menu's absence at rest, and the paste path.

---

## 8. Risks and what would change my mind

- **Catalogue sprawl.** Thirty-odd operations in a palette that is meant to feel quiet. The mitigation is
  that `when` filters per selection and the verb menu caps at seven rows; if the palette shows more than a
  handful for any one kind, the catalogue is too large.
- **ADR-0019 and `docs/scope.md`** say operations beyond the four are v1.1, "a weekend each". This feature
  moves some of them earlier. That is a scope decision for the author, not something this document can
  assume; the roadmap's "four per release" line should be reworded as a per-selection verb limit if the
  author agrees.
- **HTML to markdown** is the single piece with real code risk (nested lists, tables, code language
  hints). It should land with golden fixtures taken from real chat-UI clipboard payloads, which I have not
  collected; there are none in the corpus (`fixtures/corpus` has no HTML-clipboard sample and no
  whole-document `markdown` fence: the scan found one `md` fence, zero whole-document wrappers).
- **My value ranking is a judgement.** Nobody has measured how people manage AI output in Marxy. If the
  author's own use shows that most work is "read, then copy a section", the copy and extract packs carry the
  feature and the transform pack can slip.

---

## Appendix: commands run

```sh
# Operation tests (43 pass, 0 fail)
cd packages/core && node --test --experimental-strip-types src/operations/operations.test.ts src/operations/align-table-pipes.test.ts

# Operations registered
node --experimental-strip-types scratch/stats.mts
#   ops copy-code-clean,copy-section,toggle-task,align-table-pipes
#   corpus: 22 md files; 20 tables; 20 codeBlocks; 22 task markers; 1 md fence; 0 whole-document fences

# Reachability probe: which operations canApply to which node (scratch/probe1.mts)
#   listItem[5,12)   -> (none)            <- toggle-task is not offered for a list item
#   taskMarker[7,10) -> toggle-task        <- only the marker bytes qualify; only the checkbox click selects them
#   tableCell        -> (none)
#   table[22,52)     -> align-table-pipes  <- needs the table itself selected
#   codeBlock        -> copy-code-clean

# Prototype: copy-table-tsv over every corpus table; unwrap-markdown-fence on a sample (scratch/proto.mts, 32 lines)
#   tables 20, replacement unchanged 20; ragged TSV: none; unwrap value "# Plan\n\n- [ ] a" (value drops the final newline; use codeBlock.content)

# Cost of a document-level copy-section on the largest corpus file (scratch/timing.mts, 5 runs, Node 24)
#   {"big":"10-hostile.md","bytes":265918,"parseMs":35.8,"copyDocumentRunMs":3.6,"canApplyMs":0.0002}

# Clipboard plugin surface
grep -n "pub fn" ~/.cargo/registry/src/*/tauri-plugin-clipboard-manager-2.3.3/src/desktop.rs
#   write_text, write_image, read_text, write_html, clear, read_image  (no read_html)
grep -n "pub fn html" ~/.cargo/registry/src/*/arboard-3.6.1/src/lib.rs
#   Get::html exists in arboard; the plugin does not expose it

# No content-based language detection in core
grep -n -i "detect" packages/core/src/highlight/*.ts     # no output
```

Scratch scripts are in the audit scratchpad (`feature-textops/`), not in the repository.

---

## For the synthesis

1. The operation mechanism (frozen `string -> string` contract, registry, exact splice, one undo step) is sound and already carries the feature; only four operations ship, and the work is catalogue, reach and clipboard, not architecture.
2. Build the copy and extract packs first (plain text, rich HTML, table as TSV/CSV/JSON, copy command, all code blocks, unchecked tasks): they are clipboard-only, cannot change a byte by construction, and fit the frozen contract unchanged (a 32-line prototype ran over all 20 corpus tables with `replacement === text`).
3. Two shipped operations are hard to reach by pointer (`toggle-task` is not palette-offered for a list item; `align-table-pipes` needs a cell click plus two `Alt+Shift+Up`), and `Mod+C` picks the first `copy-` operation by string prefix (`selection/apply.ts:39-49`), which breaks as soon as a second copy verb applies to one node; add an explicit default verb per selection kind first.
4. A drag selection copies plain text only (`apply.ts:50-53`), so styled excerpts lose formatting in Docs and email; the shell already writes HTML and plain flavours together (`main.rs:66-79`), so rich copy needs no Rust change, and the clipboard plugin has no `read_html`, so paste must use the webview `paste` event.
5. Make one themed verb menu the click surface (right-click, context-menu key, Enter on a selection, drawn from the registry, at most seven rows), keep the palette as the secondary surface, and reject a gutter block handle and a selection popover; defer any hover copy glyph because it is the only candidate that appears without a deliberate act.
6. Let paste in Rendered mode open the clipboard as an untitled scratch document (HTML sanitised, then converted to markdown) rather than giving the rendered surface a caret; it is the highest-value reader-shaped paste and writes nothing until Save As.
7. "Adept at both" needs no stack change: Source mode is already a real editor and `foldText` already makes minimal byte splices; make "Edit in Source" a one-click verb now, and treat edit-block-in-place as an optional step that needs a short ADR because ADR-0005 says authoring re-entering scope reopens it, while the roadmap tripwire is really about `contenteditable` in the rendered surface.
8. Span-level text tools (sort, dedupe, join, case, trim) belong in Source mode, where a CodeMirror selection is already a precise span; the Rendered equivalent is block-aligned multi-block selection, which the contract's `span` applicability can carry without a contract change.
9. The roadmap's "at most four new operations per release" cap and ADR-0019's per-release bound conflict with this feature; replace them with a per-selection verb limit (the palette is already filtered by selection), a decision only the author can make.
10. New transforms need one extra property beyond the existing outside-the-range fidelity check: a minimal-diff property that the result differs from the input only inside the target spans, plus CRLF rows in every table, because `splice` performs no line-ending conversion (`buffer.ts:47-60`).
