# 01 Workspace

The main window. Open [01-workspace.html](01-workspace.html); it starts **folded**: one column of text on the page ground, nothing else. Press ⌘\ to unfold the full workspace. It opens on a plan (a report-type sample). Append `#doc=<id>` to open another sample (`auth-handoff`, `vector-db`, `indexer-chat`, `ragged-right`, `cartographer-ch3`, `tidemark-readme`, `watch-docs`, `indexer-rs`, `bench-csv`, `notes-1008`, `changelog`).

## Purpose

Read a document properly, see and edit its source beside it, and get any part of it out in the form you need. Everything else in Marxy (the library, the palette) feeds into or out of this window. While you read, everything else folds away.

## Fold-up

The window has two states.

| State | What shows |
|---|---|
| Folded (reading) | Only the document's reading column, centred, on the page ground (`--doc` fills the window). No sidebar, toolbar, tabs, tool strip, inspector, status bar or source pane. In Source view, the source editor alone shows, centred, with no chrome. |
| Unfolded (workspace) | The full workspace described below: sidebar, toolbar, tabs, tool strip, panes, inspector, status bar. |

| Gesture | What it does |
|---|---|
| ⌘\ (Ctrl+\ off the Mac), or the palette command "Fold / Unfold workspace" | Toggles between the two states. Unfolding restores the last arrangement you used. |
| Rest the pointer at the left edge (8 px, 150 ms) | Peeks the sidebar over the page, with a shadow. |
| Rest the pointer at the right edge | Peeks the inspector. |
| Rest the pointer at the top edge | Peeks the toolbar and tabs. |
| Move away from a peeked panel | The peek hides. |
| Click inside a peeked panel, or press its own shortcut (⌃⌘S sidebar, ⌥⌘I inspector) | Docks it. Anything docked brings the toolbar with it. |
| Escape with nothing else open, or ⌘\ | Folds everything again. |

The reading column does not reflow its measure when panels come and go; it only shifts sideways. Panels slide or fade in 170 ms or less, and not at all under reduced motion. The first time the window opens, a hint at the bottom centre ("⌘\ unfolds the workspace · move to an edge to peek") fades after three seconds and never returns. The last unfolded arrangement (which panels were docked) is remembered; the window always launches folded.

## Anatomy (unfolded)

```
+-----------+-------------------------------------------------------------+------------+
|  ● ● ●  ▯ | < >  Title / path   [Read|Split|Source]  [Report v]   [Copy|v][Export v] [xf find insp] |
|  Search   +-------------------------------------------------------------+            |
|           | tabs: plan | handoff | indexer.rs | article | +               |            |
| Library   +------------------------------+------------------------------+ Inspector  |
| Collections| REPORT  Paths  Changes  Split by H2 ... | Markdown · UTF-8 · LF  ! wrap| Outline    |
| Tree       |                              +------------------------------+ Info       |
| Smart      | # Postgres 14 → 16 ...       |  1 | ---                     | Stack      |
|            |   rendered document          |  2 | title: ...              | Versions   |
|            |                              |    source editor   minimap  | Links      |
| index foot |                              |                              |            |
+-----------+------------------------------+------------------------------+------------+
| Report · 435 words · Ln 1 · UTF-8 · LF                          Ink · Classic · 100% |
+---------------------------------------------------------------------------------------+
```

| Region | Contents |
|---|---|
| Sidebar | Traffic lights; toggled by the sidebar button at the left of the toolbar, ⌃⌘S (in every state) or the palette's "Show / Hide sidebar"; when closed, resting at the left edge peeks it; search (opens the palette); a foldable Recent list (last eight documents, state remembered); Library views (Pinned, Changed since you read); Repositories (name, branch glyph, a quiet count of files changed since you read); Folders; each repository and folder opens inline as a tree to any depth with chevrons and indentation guides, children made as it opens, ← → collapse and expand; Smart collections (near-duplicates, broken paths or links); index status and Settings |
| Toolbar | Back and forward; title and path; view switch; content-type chip; copy group; tool group; utility group (described below) |
| Tabs | Open documents with kind glyph, unsaved dot and close; a + that opens the New menu (New file, New file in this folder…, Fork this file, Open file…) |
| Render pane | Tool strip for the content type; find bar; the rendered document; the diff view when comparing versions |
| Source pane | Header with language, encoding, line endings and line count, Copy file and Copy as…, problems count, wrap, scroll sync and options; the editor with gutter and minimap |
| Inspector | Outline, Metadata, Versions, Links tabs |
| Status bar | Type, words and reading time, caret line, encoding, problems when there are any, theme and type set, text size |

## Toolbar controls

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Back, Forward | Document history for this window | ⌘[, ⌘] | |
| Read, Split, Source | Rendered only, both, or source only | ⌘1, ⌘2, ⌘3 | Default per type in Settings › Content types. When folded, Split shows the rendered column alone |
| Content-type chip | Shows the detected type; the menu shows the detection reasons, lets you show the file as another type, save a folder rule, reset, and jump to that type's typography | | Changing type changes layout, typography and tool strip at once |
| New (+) | New file (untitled scratch document, writes nothing until Save As), New file in this folder…, Fork this file | ⌘N, ⇧⌘N | Fork writes `name (fork).md` beside the original, never over it, opens it in a new tab and toasts "Forked to name (fork).md · Undo". Both work folded |
| Copy | A split button: a click copies the selection, or the document; the chevron opens Copy as (Markdown, Plain text, Rich text, HTML, Code block with path) | ⌘C, ⇧⌘C | With nothing selected in the page, ⌘C copies the document |
| Export | PDF…, Image (PNG)…, HTML…, Word…, Markdown (clean)…, then Print…; each opens a small sheet of two or three options and is mocked with a toast | none; palette "Export…" | Reveal in Finder and Open in external editor (⇧⌘E) are on the title's right-click menu and in the palette |
| Transform | A wand button beside Copy and Export: opens the palette on the transforms (`>Transform`) for the selection, else the document; Enter copies the result, ⌘Enter replaces the text | ⌘/ | |
| Extract | Exactly four: Code blocks, Shell commands (prompts stripped), Links, Tables as CSV | none | No toolbar button or strip tool: in the verb menu (right-click, or Enter on a selection) and the palette (`>Extract`) |
| Find | Find bar over the rendered text; floats over the page when folded | ⌘F | Replace writes to the source |
| Inspector | Dock or fold away | ⌥⌘I | |

## Tool strip (reports)

Each content type has its own strip; reports get these. Other types are described in [03-content-modes.md](03-content-modes.md).

| Tool | What it does |
|---|---|
| Extract | The extract menu |
| Verify paths | Checks paths against the collection's base folder; toast reports found and missing |
| Changes | Diff against the previous snapshot (rev 3 to now in the sample) |
| Split by H2 | One file per section |
| Customise | How to hide, reorder or add tools |

## Render pane behaviours

- **Block copy.** Hover a block: a small copy button at its top right copies it as Markdown; the grip opens a menu (Copy as…, copy section, add to stack, reveal in source). Headings offer copy section and copy link. Code blocks carry Copy in their header.
- **Logs and terminal captures.** Log: timestamps muted, level words bold, stack traces kept, line numbers hung; tools Copy as, Filter by level, Wrap, Jump to first error, Follow tail. Terminal: prompt, command in strong, output as it came, a half line between groups; tools Copy commands only, Copy output only, Wrap.
- **Selection toolbar.** Appears over a text selection with Copy first, then Copy as, quote with link, add to stack, highlight, transform, and the selection's character count. A selection across blocks copies as their Markdown source.
- **Code blocks.** Copy, wrap, and a menu: copy without prompts, as one line, fenced with source path; save as file; open as scratch; paste into Terminal (never run).
- **Checkboxes.** Ticking a checkbox writes to the source line, with undo in the toast. There is no task panel, progress bar or count anywhere.
- **Paths.** Code spans that look like paths are checked and marked; click for open, copy, reveal, open in editor, change the path base.
- **Footnotes.** Pop up on hover.
- **Split view.** Clicking a block flashes its source lines; ⌥-click selects them; the source caret marks the matching block with an accent bar.

## Inspector

Docking the inspector is part of the fold-up arrangement (⌥⌘I, or peek at the right edge). Settings › Appearance offers Auto, Always and Never for whether it is in the default arrangement. In Split view the reading pane takes the larger share (1.3 to 1).

| Tab | Contents |
|---|---|
| Outline | Headings with words per section; click to jump; copy outline (for a log, its warnings and errors; for a terminal capture, its commands) |
| Info | Detected type with reasons; measures (words, reading time, characters, lines, code blocks, links); typography in use measured live (face, size, leading, characters per line, average character width); file (path, collection, modified, encoding) |
| Versions | Snapshots with what changed; choosing an older one opens the diff |
| Links | Paths mentioned with found or missing; links; backlinks from other documents |

## Result sheet

Every transform opens a sheet with before and after side by side and their character counts. Actions: **Open as new document**, **Add another step** (chains a further transform onto the result), **Copy result**, and **Apply** to the selection or document, which is a single undo step.

## Find

Case, whole word and regex options; match count; previous and next; **Replace all** writes to the source with undo. Matches are painted with the CSS Custom Highlight API, so the rendered DOM is never modified.

## Version diff

**Changes** in the strip or a version in the inspector swaps the rendered view for a line diff: old and new line numbers, plus and minus markers as well as colour, unchanged runs folded, counts of added and removed lines and **Copy diff**.

## Keyboard

| Keys | Action |
|---|---|
| ⌘\ | Fold / unfold the workspace |
| Esc | Fold again (when nothing else is open) |
| ⌘K (⌘P alias) | Palette: Everything; `/` there searches file contents |
| ⇧⌘P | Palette on commands (`>`) |
| ⌘1 / ⌘2 / ⌘3 | Read / Split / Source |
| ⌘F | Find |
| ⌘E | Toggle Read ↔ Source |
| ⌘/ | Transform (palette on `>Transform`) |
| ⇧⌘E | Open in external editor |
| ⌥⌘R | Reveal in Finder |
| ⌃⌘I | Metadata: margin block if there is room, else the Metadata tab |
| ⌥⌘I | Inspector (docks it; brings the toolbar) |
| ⌃⌘S | Sidebar (docks it; brings the toolbar) |
| ⌘+ / ⌘− / ⌘0 | Text size |
| ⌘C with no selection | Copy the document as Markdown |
| ⇧⌘C | Copy as… menu for the selection, else the block under the pointer, else the document (also in Source) |
| ⌘N / ⇧⌘N | New file / Fork this file (also when folded) |
| ⌘S | Save; an untitled file asks for a name and folder (Save As) |
| ⌥-click a block | Select its source |
| ⌘↵ in the editor | Toggle the task on the caret line |

## States

| State | Behaviour |
|---|---|
| Folded | One column; panels peek at the edges |
| Unfolded | Sidebar, toolbar, tabs, tool strip, panes, inspector, status bar, in the remembered arrangement |
| Unsaved edits | Dot on the tab; gutter markers in the source |
| Metadata-only file | Opening it says the file is indexed but not loaded (a prototype limit; the app always loads) |
| No headings | Outline says so |
| Missing paths | Wavy underline and "missing" label; counted in Extract and Links |

## Settings this window reads

`view`, `syncScroll`, `inspector`, `sidebar`, `checkPaths`, `blockHandles`, `selectionToolbar`, `footnotes`, `edWrap`, `edMinimap`, `edLineNumbers`, `edLint`, `edTabSize`, `theme`, `typeset`, `scale`. See [08-settings.md](08-settings.md).

## Open questions

- Should Split view remember a per-document divider position, or one per window?
- Should the peek hide faster when the pointer leaves toward the document, or wait for the reader to pause?
- Should folding remember its arrangement per window or once for the app?

## Source pane, measures and metadata (round 4)

- **Source pane.** The same framed editor as 02-source (path, bytes and endings, column ruler, strip, bottom bar), with compact bars below 640px and no ruler below 520px. Folded Source shows the frame alone, centred. The pane header and minimap are gone.
- **Measures.** Settings › Measures (`measuresMode`: contextual, all or custom; `measures`; `kindMeasures`; `tokenizer`). Contextual sets: prose kinds words · chars · ≈tokens · lines; code lines · chars · ≈tokens · bytes; data lines · bytes · chars; log and terminal lines · bytes. Tokens are a local estimate (about chars / 3.8, shown with ≈); nothing is sent. `G.measure` feeds the status bar, the Source bottom bar (selection adds bytes), the selection toolbar, the copy toast, the Metadata tab (chosen measures first), library rows (the kind's first measure), the palette preview and the outline rows.
- **Metadata toggle.** ⌃⌘I, the palette's "Show / Hide metadata" and the (i) toolbar button (`showMetadata`, default off). On: a quiet block in the left margin of Read, sticky, aligned to the first line (front matter, then modified, size, Git status and branch, "More…"; at most 14 rows); in a narrow margin it becomes a head above the title; in folded Source it sits outside the frame when there is room. Off: front matter stays folded with a marker ("Front matter · 5 keys, folded") that turns the block on.
- **Metadata tab** (was Info). Foldable sections: File, Git, Front matter, Extended attributes, Detection, Measures, Typography in use, Hidden and reshaped, Marxy. Editable, each with a quiet toast and Undo: front matter values (click), add and remove a key (one YAML line each; "1 line changed"), rename, the executable bit, Finder tags, Remove quarantine, Show as (kind), Always open this folder as…, Pin and Forget reading position. Everything else is read-only with a copy button on hover. "Hidden and reshaped" lists invisible characters (click to jump) and what Read folded or moved. Values are mocked per document.

## Opening files, Share and the rule about the text (round 5)

- **Opening never leaves the page.** The sidebar tree, Recent, the palette, links inside documents (a path or relative link opens that file; a web address opens in the browser; an anchor scrolls), backlinks and tabs all go through `G.openDoc`. 01 opens a tab, keeping fold state; ⌘[ and ⌘] walk the history. 02 loads the file into its Source editor in place. 05 and 04 show it in an in-page document view (reading and Source panes) with a back control. Only "Open in Workspace" navigates to 01.
- **One Copy and one Export per surface (round 6 supersedes the Share button).** Tool strips hold no Copy as; the reading view has one hover copy affordance, on code blocks; right-click a block for Copy, Copy as, section and link. The selection toolbar is Copy with a Copy as chevron. Right-click a Metadata value to copy it. Keys: ⌘C, ⇧⌘C, ⇧⌘E (Open in external editor).
- **Notes, never marks on the text.** Read shows no underline or colour on a missing path (the Links tab lists them); Source shows notes only on the right strip.

## Round 6 (current)

- **Sidebar.** A sidebar button sits at the left of every toolbar, before back and forward (pressed when docked). ⌃⌘S works in every state on every page; resting the pointer at the left edge peeks a closed sidebar, also when unfolded; the palette has "Show / Hide sidebar". The engine adds the toggle to every page's toolbar (and re-adds it if a page rebuilds the toolbar). When folded there is no toolbar, so a quiet floating button appears at the top left while the pointer moves, fades after 1.5 s of stillness, and also shows on Tab focus; clicking it docks the sidebar. The sidebar's own close button moves focus to whichever toggle is showing.
- **Toolbar.** New (+), Copy (split), Export, Transform, Find, Inspector. No theme button (themes: palette and the themes page), no collect mode or stack anywhere, no info button.
- **Tool strips (at most four buttons per kind).** report: Paths, Changes, Split by H2 · article: Focus, Highlight, Margin notes, Read aloud · book: Paged, Contents, Justify, Bookmark · readme: Outline, Config table, Open repo (… Copy install command) · docs: On this page, Examples only, Search docs set, Prev / next · code: Wrap, Literate, Symbols, Go to line (… Copy with path) · transcript: Collapse tools, Only you, Only assistant · data: Column stats, Filter, Transpose, Chart · notes: Backlinks, Append clipboard, Daily · changelog: Versions, Compare · log: Filter by level, Wrap, Jump to first error, Follow tail · terminal: Wrap (… Copy commands only).
- **Metadata.** ⌃⌘I and the palette toggle the margin block when the margin has room; with no room (Split, narrow windows) they open the inspector's Metadata tab. Nothing is ever drawn above the text or the code.

- **Collapsible sidebar sections.** Recent, Library, Repositories, Folders and Smart collections each fold on their 28px header (chevron, quiet count when collapsed, height animation of at most 150 ms, none under reduced motion). The state is remembered per section; ⌥-click a header folds or unfolds all; with a header focused, Space and Enter toggle, ← collapses, → expands. Trees inside Repositories and Folders keep their own per-folder chevrons.

## Round 7: keys

⌘K opens the palette (⌘P is an alias); ⇧⌘P opens it on commands; ⌘/ opens it on `>Transform`; `/` inside it is content search. ⌘E toggles Read and Source (⌘1–⌘3 stay). Extract has no key and no button: right-click or press Enter on a selection for the verb menu (Copy, Copy as, Transform…, Extract), or use `>Extract` in the palette. The toolbar is New, Copy, Export, Transform, Find, Inspector.
