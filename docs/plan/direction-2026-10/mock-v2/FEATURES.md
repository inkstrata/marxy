# Marxy mock v2: the complete feature set

Marxy is a desktop reader and text workbench for source of any kind, built with Tauri for macOS first and Windows and Linux after: Markdown, code, data, logs, READMEs, essays, notes and the plain text that people and their tools write. Source comes first. The render panel is where you read, the source panel is a real editor sized to the work of reading, and a workspace of sidebar, tabs, inspector and status bar folds away to a single document column while you read and unfolds when you need it. There is no session tracking and no tagging: Marxy reads files where they are and keeps its own state beside them.

This document lists every feature, grouped by area. Each table gives the feature, what it does, its release tier, and the prototype that shows it.

**Tiers.** `v1` ships in the first release. `v1.x` follows in point releases. `Later` is designed for but not scheduled.

**Prototypes.** `01` Workspace, `02` Source editor, `03` Content modes, `04` Palette, `05` Library, `06` Clipboard studio (descoped for now: copying lives in the reading and source views), `07` Themes, `08` Settings, `09` macOS integration (later, not in this direction). A dash means the feature is specified here but not prototyped.

## Contents

1. [Principles](#principles)
2. [Jobs Marxy is for](#jobs-marxy-is-for)
3. [Reading: the render panel](#1-reading-the-render-panel)
4. [The source panel](#2-the-source-panel)
5. [Render and source together](#3-render-and-source-together)
6. [Fold-up](#4-fold-up)
7. [Content types](#5-content-types)
8. [Checking and extracting](#6-checking-and-extracting)
9. [Copy](#7-copy-and-collect)
10. [Transforms](#8-transforms)
11. [Library: collections and indexing](#9-library-collections-and-indexing)
12. [Search and the command palette](#10-search-and-the-command-palette)
13. [Themes and typography](#11-themes-and-typography)
14. [Versions, snapshots and diffs](#12-versions-snapshots-and-diffs)
15. [Export and sharing](#13-export-and-sharing)
16. [macOS integration](#14-macos-integration)
17. [Windows and Linux](#15-windows-and-linux)
18. [Accessibility](#16-accessibility)
19. [Privacy and security](#17-privacy-and-security)
20. [Performance targets](#18-performance-targets)
21. [Settings and keyboard](#19-settings-and-keyboard)
22. [Release plan](#release-plan)
23. [Non-goals](#non-goals)

## Principles

1. **The file is the truth.** Marxy never rewrites a file behind your back. Highlights, bookmarks and read state live beside the file, in Marxy's own store. Edits happen only when you edit, apply a transform, or tick a checkbox, and every one of those is undoable and shown in the edit history.
2. **Source first, reading first.** Any file opens at once as what it is. The render panel is where prose is read; the source panel is a real editor, the workshop behind the shop window.
3. **Every type of text gets the typography it needs.** A plan is scanned, a novel is read, a poem's line breaks are the poem, and code is never reflowed. Marxy detects the type and switches layout, tools and typography, and it always says why and lets you override.
4. **Chrome at rest is zero.** While you read, everything but the document folds away; every tool is summoned and dismissed (section 4).
5. **Copy is a first-class verb.** Most of what people do with a document is move part of it somewhere else. Every block, section, selection, table and code block can be copied in the format the destination wants.
6. **Verify, don't trust.** Documents name files, link sources and claim tasks are done. Marxy checks paths against the disk, marks links and shows what changed since the last version.
7. **Local and private.** Indexing, search, transforms and rendering run on the machine. Nothing leaves it without an action of yours.
8. **Keyboard complete.** Everything in a menu, toolbar or panel is reachable from the keyboard and from the palette.
9. **Measured, not guessed.** Typographic defaults come from the Reader Typography Handbook in `../docs/`. Line length is set from each face's measured character width and reported as you read.

## Jobs Marxy is for

| Job | How Marxy does it |
|---|---|
| Read anything properly | Articles, books, READMEs, docs, code, data, notes, transcripts and reports each get their own layout and typography |
| Check what a document claims | Path verification against the collection's base folder, broken-link marks |
| Get the useful parts out | Extract code, shell commands as a script, open tasks, links, file paths, tables as CSV, open questions |
| Pass it on | Copy as Slack, Jira, rich text, plain text or Markdown |
| See what changed | Snapshots on every change on disk; line diff between any two |
| Triage a folder | Library with query syntax, unread and changed filters, near-duplicate groups, broken-path view, bulk actions |
| Edit a source file without leaving | A source panel with structure, line operations, table tools and find and replace with preview |
| Read without the workspace in the way | Fold-up: one document column, with every panel a pointer-pause or one key away |

## 1. Reading: the render panel

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| CommonMark plus GFM rendering | Tables, task lists, strikethrough, autolinks, footnotes, front matter, GitHub alerts (`> [!NOTE]`) | v1 | 01 |
| Source line mapping | Every rendered block knows its source lines, which powers sync scrolling, copy-as-source and reveal | v1 | 01 |
| Per-type layout and typography | Twelve content types (logs and terminal captures included) with their own column, faces, spacing and tools (section 5) | v1 | 03 |
| Measured line length | Column width computed from the face's measured average character width; characters-per-line readout | v1 | 03 |
| Right-click a block | Copy, Copy as, Copy section, Copy link to heading, Reveal in source; code blocks have one hover copy button | v1 | 01 |
| Selection toolbar | Copy with a Copy as chevron, highlight, transform, with the chosen measures | v1 | 01 |
| Selection copies as source | A selection spanning blocks copies their Markdown source, not flattened text | v1 | 01 |
| Code blocks | Language label, title, copy, copy without prompts, copy as one line, copy fenced with source path, save as file, wrap toggle, open in scratch editor, paste to Terminal (never run) | v1 | 01 |
| Tables | Sticky header, numeric columns right-aligned with tabular figures, scroll in their own focusable container, copy as Markdown, CSV, TSV or JSON, sort by column (view only) | v1 | 01, 03 |
| Footnotes | Pop-up on hover or click, margin notes on wide windows, or endnotes; never a jump to the bottom | v1 | 01, 03 |
| Admonitions | Note, Tip, Important, Warning, Caution, each with label, icon and border style, never colour alone | v1 | 01 |
| Task checkboxes | Ticking a box in the rendered view writes `[x]` to that source line, with undo | v1 | 01 |
| Path chips | File paths in code spans are checked against the disk and marked found or missing; click to open, copy, reveal or open in editor | v1 | 01 |
| Local badges | shields.io badge images are drawn locally from their URL, so READMEs render offline with no tracking request | v1 | 03 |
| Images | Local and remote images, with alt text shown when images are off; remote images blocked until allowed per collection | v1 | – |
| Math | MathML rendering with a MATH-table font; spacing settings never applied inside formulas | v1.x | – |
| Diagrams | Mermaid and Graphviz fences rendered to SVG, with the source one click away | v1.x | – |
| Find in document | Case, whole word and regex options; highlights through the CSS Custom Highlight API so the DOM is never modified | v1 | 01 |
| Focus mode | Dims everything except the block under the pointer or caret | v1 | 03 |
| Reading position | Remembered per file; progress bar for articles and books | v1 | 03 |
| Highlights and annotations | Stored beside the file, exportable as Markdown; survive edits by anchoring to text and nearby context | v1.x | 01 |
| Read aloud | macOS speech with word highlighting; voice and rate in settings | v1.x | 03 |
| Zoom | Text size 75 to 250 per cent, reflowing; ⌘+ ⌘− ⌘0 | v1 | 01 |
| Reload on change | A change to the open file on disk re-renders in place, keeping scroll position and selection | v1 | 01 |

## 2. The source panel

The source panel is a focused editor for Markdown and the languages people write alongside it. The prototype uses a textarea over a highlighted layer; the app uses CodeMirror 6, which brings multiple cursors, folding, bracket matching, large-file performance and Vim and Emacs keymaps.

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Markdown-aware highlighting | Markers dimmed but legible (4.5:1), headings strong, links, code spans, fences with the inner language highlighted, front matter, tables | v1 | 02 |
| Gutter | Line numbers, unsaved-change markers (added, modified), problem markers, fold arrows | v1 | 02 |
| Minimap | Shape of the document with headings and fences picked out; click to jump | v1 | 01, 02 |
| Source frame | Framed editor: path, encoding, line endings, indentation, bytes, lines; a column ruler on the character grid; line-number gutter; a right strip of marks at exact bytes (invisible characters, matches, changes, problems); bottom bar with Ln, Col, byte offset and the code point under the caret. Only information derived from the bytes. No minimap, no structure panel, no formatting toolbar | v1 | 01, 02 |
| Section moves | Drag a section, or use buttons or ⌃⌥↑↓, to move it with everything under it | v1 | 02 |
| Promote and demote | Shift a section and its subsections up or down a heading level | v1 | 02 |
| Structural selection | Select line, block, section; expand selection; select next occurrence; select all occurrences with bulk actions | v1 | 02 |
| Line operations | Move, duplicate, delete, sort, join, toggle task, toggle quote, toggle comment | v1 | 02 |
| Formatting | Bold, italic, inline code, link, heading levels, with keyboard shortcuts | v1 | 02 |
| Slash inserts | Type `/` on an empty line: table, code block, task list, admonitions, details, footnote, date, rule, front matter, clipboard as table or quote | v1 | 02 |
| Table tools | When the caret is in a table: align columns (respecting alignment markers), add row, add column, sort, copy as CSV | v1 | 02 |
| Find and replace | Case, whole word, regex with capture groups, in selection only; preview every replacement as a diff before applying | v1 | 02 |
| Problems | Lint for heading jumps, trailing whitespace, missing paths, unclosed fences, long lines; quick fixes and "fix all" | v1 | 02 |
| Unsaved changes panel | Line diff against the saved file | v1 | 02 |
| Edit history | Every structural edit, transform and replacement listed with time, each undoable | v1 | 02 |
| Selection panel | Characters, words and lines of the selection with a rendered preview and copy actions | v1 | 02 |
| Changed on disk bar | When the file changes on disk while you have unsaved edits, a bar says so and offers Keep mine as a copy or Take theirs; nothing is merged or overwritten silently | v1 | 02 |
| Language modes | Markdown (GFM, CommonMark strict, MDX), plain text, and the common source and data languages | v1 | 02 |
| Keymaps | Standard macOS, Vim, Emacs | v1.x | 02 |
| Multiple cursors | ⌥-click and ⌘D add cursors (CodeMirror) | v1 | – |
| Autosave | Off, on focus change, or after a delay; off by default because other programs may also write the file | v1 | 08 |
| Encoding and line endings | Detected and preserved; conversion on request | v1 | 02 |

## 3. Render and source together

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Read, Split, Source | Three views on ⌘1, ⌘2, ⌘3; default per content type and per window | v1 | 01 |
| Sync scrolling | Proportional between blocks in both directions; can be switched off | v1 | 01 |
| Cursor follows | The block containing the source caret is marked in the render panel | v1 | 01, 02 |
| Click to locate | In Split view, clicking a rendered block flashes its source lines; ⌥-click selects them | v1 | 01 |
| Re-render on edit | Source edits re-render after a short debounce, keeping both scroll positions | v1 | 01 |
| Rendered preview in the editor | Source editor can show a narrower preview beside it | v1 | 02 |

## 4. Fold-up

The workspace has two states. **Folded** is for reading: only the document column. **Unfolded** is the full workspace: sidebar, toolbar and tabs, inspector, status bar, mode bar.

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Fold and unfold | ⌘\ (Ctrl \ elsewhere) or the palette command "Fold / Unfold workspace" toggles the two states | v1 | 01 |
| Peek | When folded, pausing the pointer at the left, right or top screen edge shows the sidebar, inspector, or toolbar and tabs over the document, without moving the text | v1 | 01 |
| Dock | Clicking inside a peeked panel, or pressing its own shortcut (⌃⌘S sidebar, ⌥⌘I inspector), docks it: the panel takes its place in the layout | v1 | 01 |
| Fold again | Escape (when nothing else is open) or ⌘\ folds the workspace back up | v1 | 01 |
| Starts folded | The window always launches folded; 01-workspace starts folded | v1 | 01 |
| Remembers the arrangement | The last unfolded arrangement (which panels, which widths) is remembered and comes back on the next unfold | v1 | 01 |

## 5. Content types

Marxy detects a document's type from its path, front matter and structure, names it in the toolbar chip, and lets you override it for the file or for a folder pattern. The chip menu lists the signals that decided it. The type changes layout, typography and the tool strip. Typography for each type is set out in [TYPOGRAPHY.md](TYPOGRAPHY.md). A report is one kind among many; the others are as central.

| Type | Detected from | Layout and special interface | Quick tools | Proto |
|---|---|---|---|---|
| Report | Headings such as Summary, Risks, Next steps, Verified; checklists | Outline rail; report panel collecting open questions, risks, next steps and mentioned paths with status | Copy as, Extract, Verify paths, Tasks, Changes, Split by H2 | 01, 03 |
| Article | Byline front matter (author, published, source) | Centred column, dek, byline, reading progress, margin notes on wide windows, pull quotes | Focus, Highlight, Quote with link, Margin notes, Read aloud | 03 |
| Book | Chapter headings, chapter-numbered files, long paragraphs | Paged with exact column widths (or scroll), running head, small-caps opening, scene-break asterisms, chapter progress | Paged, Contents, Justify, Bookmark, Highlight, Initial | 03 |
| README | File name | Repository header with description, facts and an install command with a method switch and copy; section chips | Copy install, All commands, Badges, Outline, Config table, Open repo | 03 |
| Docs | API sections (Parameters, Returns, Errors, Example), admonitions | Three columns: docs-set tree, content with breadcrumbs and prev/next, "on this page" rail with scroll-spy and an examples list; signature block emphasised | On this page, Copy section, Copy link, Examples only, Search docs set, Prev / next | 03 |
| Code | Source extensions | Gutter, symbols rail, breadcrumbs, changed marker; Literate view turns doc comments into prose beside the code | Wrap, Literate, Symbols, Copy fenced, Go to line | 03 |
| Transcript | Speaker headings (You, Assistant, Tool) | Turns with hanging speaker labels; tool calls fold to one line; prompts rail; filters for prompts, answers, tools | Collapse tools, Only you, Only assistant, Last reply, Export as doc | 03 |
| Data | CSV, TSV, JSON, YAML extensions | Grid with typed sticky headers, row numbers, column stats footer, filter, delimiter switch, sort | Copy as, Column stats, Filter, Transpose, Chart | 03 |
| Notes | Dated note paths | Quiet column, daily navigation, backlinks | Backlinks, Append clipboard, Daily | 03 |
| Changelog | File name | Version rail | Versions, Copy release notes, Compare | 03 |
| Verse | Line-level markup or a `poem` class | Every line and indent kept, hanging indents for turnovers, stanzas kept together across pages | Size and face only | Later |
| Slides | `---`-separated Markdown (Marp style) | One slide per screen, presenter notes, export to PDF | Present, Export | Later |
| Drama and screenplay | Speaker labels in small capitals, Fountain files | Reading view, or faithful Courier Prime production format | Toggle format | Later |

| Detection feature | What it does | Tier | Proto |
|---|---|---|---|
| Type name and reasons | The chip shows the type's name; its menu lists the signals that decided it | v1 | 01 |
| Override per file | "Show as" in the chip menu | v1 | 01 |
| Folder rules | "Always open this folder as…" writes a glob rule | v1 | 01, 08 |
| Per-type defaults | Each type's view, typography and tool strip are configurable | v1 | 08 |

## 6. Checking and extracting

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Path verification | Every file path mentioned is checked against a per-collection base folder; found, missing, open, reveal | v1 | 01, 03 |
| Extract | Code blocks, shell commands as a runnable script (never run by Marxy), open tasks, links, paths, tables as CSV, open questions, outline | v1 | 01 |
| Report panel | Open questions, risks, next steps and paths collected beside the report | v1 | 03 |
| Version diff | Snapshot on every change on disk; compare any two | v1 | 01 |
| Split by H2 | Writes one file per section into a folder | v1.x | 01 |
| Near-duplicates | Groups `plan.md`, `plan.v2.md`, `plan-final.md` with similarity scores; keep newest, merge, archive | v1 | 05 |
| Transcript tools | Collapse tool calls, filter to your prompts or the assistant's replies, extract the last reply, export as a document | v1 | 03 |

## 7. Copy and export

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Copy formats | Markdown, plain text, rich text, HTML, Slack, Jira wiki, JSON string, quote with source link | v1 | 01 |
| Multiple pasteboard types | Rich copies write HTML and plain text together so each destination takes what it understands | v1 | 01 |
| Snippets | Reusable text with placeholders such as `{{date}}` and `{{selection}}` | Later | 06 |
| URL cleaning | Strips tracking parameters from copied URLs | Later | 06 |

## 8. Transforms

Transforms are pure text functions. They run on a selection or a document, and their result is previewed before it is applied. The prototype implements the library for real (`shared/app.js`).

| Group | Transforms | Tier |
|---|---|---|
| Clean | Emoji, front matter, citation markers, bold, horizontal rules, blank lines, list markers, heading levels, promote and demote headings, unwrap hard-wrapped lines, hard-wrap at 80, smart and straight punctuation | v1 |
| Convert | Markdown to plain text, Slack, Jira wiki, HTML; TSV or CSV to table; table to CSV or JSON; format, minify and escape JSON; wrap in a fence; quote and unquote; indent and dedent | v1 |
| Lines | Sort, sort and de-duplicate, de-duplicate keeping order, reverse, number, remove markers, join, lines to bullets | v1 |
| Case | Title Case and sentence case headings, lower, upper, slugify | v1 |
| Extract | Code blocks, shell commands as a script, open tasks, links, file paths, outline, tables as CSV, open questions | v1 |

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Result sheet | Before and after side by side with character counts; apply, copy, open as a new document, or chain another step | v1 | 01 |
| Palette transforms | `/` in the palette with a preview of the result | v1 | 04 |
| Undo | Every applied transform is a single undo step and appears in edit history | v1 | 02 |
| Pipelines | Ordered steps with enable, reorder and per-step preview; saved and shortcut-assignable | Later | 06 |

## 9. Library: collections and indexing

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Collections | Point Marxy at folders, Git repositories, notes vaults, iCloud folders or single files | v1 | 05 |
| Add-source options | Include and exclude globs, file types, default type, path base for verification, watch mode, content or metadata-only, symlinks, hidden files, .gitignore, size limit | v1 | 05 |
| Dry run | Shows how many files will be indexed and which are skipped and why, before adding | v1 | 05 |
| Watching | FSEvents on macOS; debounced; editors that save through temporary files produce one re-index | v1 | 05 |
| Full-text index | Words, headings, code blocks and front matter; snippets with line numbers | v1 | 05 |
| Query syntax | `kind:` `has:code` `is:unread` `modified:<7d` `words:>1000` `path:` | v1 | 05 |
| Facets, sort, group | Kind, status, modified; group by folder, kind or day | v1 | 05 |
| List rows | Dense rows with type, words, modified and status marks | v1 | 05 |
| Preview pane | Rendered preview, metadata, detection reasons and outline for the selected file | v1 | 05 |
| Bulk actions | Open, open in tabs, merge, compare, export, move, mark read, archive, remove from index | v1 | 05 |
| Smart collections | Rule builder with counts; built-ins for near-duplicates and broken paths | v1 | 05 |
| Sidebar | Foldable Recent (last eight), Pinned, Changed since you read, Repositories with a quiet changed-file count, Folders; every repository and folder drills down inline to any depth, ← → to collapse and expand | v1 | 01, 05 |
| New file and fork | A + in the toolbar and tab bar: New file (⌘N, writes nothing until Save As), New file in this folder…, Fork this file (⇧⌘N, `name (fork).md` beside the original, with Undo); also in the palette and a folder's context menu; works folded | v1 | 01 |
| Copy in the reading view | ⌘C copies the document when nothing is selected; ⇧⌘C Copy as (Markdown, plain text, rich text, HTML, code block with path) for the selection, else the block under the pointer, else the document; a copy button on hovered blocks; a quiet toast names format and size | v1 | 01 |
| Copy in the source view | Copy file and Copy as… in the source header; gutter menu: Copy line, Copy lines with path:line; ⇧⌘C | v1 | 01, 02 |
| Logs and terminal captures | Two source kinds: log (timestamps, bold level words, stack traces kept, hung line numbers; Filter by level, Jump to first error, Follow tail) and terminal (prompt, command, output; Copy commands only, Copy output only; ESC shown as ␛) | v1 | 01, 03 |
| Kind glyphs | One custom 1.5px glyph per kind and for folder and repository; code files tint theirs with the language colour | v1 | all |
| Index health | Per-collection files, size, last run, watcher state, errors with fixes, rebuild | v1 | 05 |
| Inbox | A plain folder (`~/Inbox`) for shared items and dropped files; promote to a collection | v1 | 05 |
| Read state | Unread, and "changed since you last read it" | v1 | 05 |
| Semantic search | Embedding index alongside full text, merged ranking | Later | – |

## 10. Search and the command palette

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| One palette | ⌘K for files, `>` commands, `#` headings here, `@` sections everywhere, `/` content search, `~` collections, `:` line: seven modes | v1 | 04 |
| Filters | `kind:` and `in:` inside file search | v1 | 04 |
| Preview | Files, sections, transforms (with their actual result) and commands preview on the right | v1 | 04 |
| Modifiers | ⌘Return opens in a split or replaces text; ⌥Return opens a new tab; ⌘C copies the path or result | v1 | 04 |
| Fuzzy ranking | Prefix and word-start matches first, then consecutive characters; recency boost | v1 | 04 |
| Recent and suggested | Empty palette shows recent files and suggested commands | v1 | 04 |

## 11. Themes and typography

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Eight audited themes | Paper, Ink, Sepia, Dusk, Fjord, Night, High contrast light and dark; every pair audited to its WCAG threshold, with the audit in the theme inspector's Access tab, which speaks only when a pair fails | v1 | 07 |
| Follow system | Separate light and dark choices | v1 | 07 |
| Type sets | Classic, Plex, Hyperlegible, System, Typewriter: one choice maps every reading role to a face | v1 | 07 |
| Themes inform every view | A theme is a palette of tokens used by chrome, reading surface and code alike; per-type typography layers on top | v1 | 03, 07 |
| Dark-mode weight | Text weight lightened on dark grounds | v1 | 03 |
| Code highlighting modes | Full, minimal (strings, constants, comments and definitions only) or off; comments never dimmed below 4.5:1 | v1 | 07 |
| Accent override | Validated for contrast before it is accepted | v1 | 07 |
| Theme editor | Edit tokens with an audit that blocks saving a failing palette and suggests fixes | v1.x | 07 |
| Import | VS Code and Base16 themes, audited and auto-fixed | v1.x | 07 |
| Per-type themes | For example, books in Sepia and code in Night | v1.x | 07 |
| Schedule | Switch by time or sunset | Later | 07 |
| Reading settings | Measure, leading, paragraph style, justification, hyphenation, letter and word spacing with the coupling rules enforced | v1 | 03, 08 |

## 12. Versions, snapshots and diffs

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Snapshots | Content-addressed snapshot on each change to a watched file; 30 days or 50 revisions by default | v1 | 01 |
| Version list | Time and size of change | v1 | 01 |
| Line diff | Unified diff with context and folded unchanged runs | v1 | 01, 02 |
| Rendered diff | Changed blocks marked in the reading view | v1.x | – |
| Restore | Copies an old version back into the file after confirmation | v1 | 01 |
| Compare two files | From the Library with two selected | v1 | 05 |

## 13. Export and sharing

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| PDF | Paged typography with running heads; page size and margins | v1 | 01, 08 |
| HTML | Self-contained, fonts subset, theme baked in | v1 | 01 |
| Word | DOCX with mapped styles | v1.x | 01 |
| Share sheet | AirDrop, Mail, Messages, Notes | v1 | 01 |
| Links to files | `marxy://open?path=…` deep links | v1 | 01 |

## 14. macOS integration

Later, not in this direction. These surfaces are prototyped in 09-macos for reference and are not part of the first release.

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Open with | Marxy offered in Finder for Markdown and source files | v1 | – |
| Full menu bar | Every command with its shortcut | v1 | 09 |
| Unified toolbar | Quick-action buttons with a Customize Toolbar sheet; icon and text, icon only, text only | Later | 09 |
| Finder Quick Actions | Open in Marxy, Copy as Rich Text, Combine into One File, Add Folder to Library | Later | 09 |
| Services menu | Convert to table, open as Markdown, send to Inbox, from any app | Later | 09 |
| Quick Look | Marxy typography for `.md` previews in Finder | Later | 09 |
| Share extension | Send text or files to the Inbox | Later | 09 |
| Shortcuts actions | Transform, copy as, find, open, get text, add to Inbox | Later | 09 |
| Spotlight | Documents indexed with their headings | Later | 09 |
| Dock | Recent documents | Later | 09 |

## 15. Windows and Linux

Same app, platform conventions. The toolbar becomes a custom title bar; Finder Quick Actions become Explorer context-menu entries (Windows) or file-manager actions (Linux); Services and Quick Look have no direct equivalent. The mapping is tabled in [09-macos.md](09-macos.md).

## 16. Accessibility

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| WCAG 2.2 AA throughout, AAA for body text | Contrast audited per theme by `tools/audit_contrast.py` | v1 | 07 |
| Text spacing | Survives WCAG 1.4.12 overrides; letter and word spacing coupled | v1 | 08 |
| Reflow | Text to 250 per cent without horizontal scrolling except code and tables, which scroll in focusable containers | v1 | 03 |
| Keyboard | Every control reachable; visible focus; palette for everything; every peeked panel has a keyboard route to dock | v1 | all |
| Screen readers | Real labels, announced values, landmarks; folded panels stay in the accessibility tree and are reachable by their shortcut; code read line by line on request | v1 | 08 |
| Platform settings | Text size, increase contrast, reduce motion (peek and fold animate only when motion is allowed), reduce transparency, forced colours | v1 | 08 |
| Colour never alone | Admonitions, diffs, path status, log levels (bold) and status marks all have a second cue | v1 | 01 |
| No dyslexia-font claims | Spacing controls offered prominently; special fonts offered without claims | v1 | 08 |

## 17. Privacy and security

| Feature | What it does | Tier | Proto |
|---|---|---|---|
| Local first | Index, search, render and transforms run on the machine | v1 | – |
| Scoped file access | Marxy reads only folders you add, through Tauri capability scopes and macOS security-scoped bookmarks | v1 | 08 |
| Nothing sent | Marxy sends nothing anywhere for its own features | v1 | 08 |
| No analytics | No telemetry in any form | v1 | 08 |
| Remote content blocked | Remote images and fonts in documents load only when allowed | v1 | – |

## 18. Performance targets

| Measure | Target |
|---|---|
| Cold start to first paint | Under 400 ms on Apple silicon |
| Open a 1 MB Markdown file | Under 150 ms to first render |
| Keystroke to re-render in Split view | Under 50 ms for files under 200 KB |
| Initial index of 10,000 files | Under 60 s in the background, searchable as it goes |
| Re-index after a file change | Under 200 ms after the debounce |
| Palette query over 50,000 files | Under 30 ms |
| Peek or fold | One frame; no layout of the document column |
| Memory at idle with five tabs | Under 250 MB |

## 19. Settings and keyboard

Every setting is listed with its default, range and preference key in [08-settings.md](08-settings.md). The complete menu bar and keyboard map is in [09-macos.md](09-macos.md). The core shortcuts:

| Action | Keys |
|---|---|
| Palette | ⌘K (⌘P alias) |
| Commands | ⇧⌘P |
| Transforms (under `>`) | ⌘/ |
| Content search | `/` in the palette |
| Fold / Unfold workspace | ⌘\ (Ctrl \ elsewhere) |
| Fold again | Escape, when nothing else is open |
| Read, Split, Source | ⌘1, ⌘2, ⌘3 |
| Toggle Read ↔ Source | ⌘E |
| Find | ⌘F |
| Open in external editor | ⇧⌘E |
| Reveal in Finder | ⌥⌘R |
| Metadata | ⌃⌘I |
| Inspector | ⌥⌘I |
| Sidebar | ⌃⌘S |
| Text size | ⌘+, ⌘−, ⌘0 |
| Settings | ⌘, |

## Release plan

**v1: the reader and the workbench.** Render and source panels with sync, fold-up, the twelve content types, copy formats and collect mode, the transform library and result sheet, the palette, collections with full-text index and watching, path verification, snapshots and diffs, themes and type sets, Open with in Finder, PDF and HTML export.

**v1.x: reaching further.** Theme editor and imports; highlights and annotations; read aloud; diagrams and math; Word export; Vim and Emacs keymaps; split by H2.

**Later.** Finder Quick Actions, Services, Quick Look, Share extension and Shortcuts actions; snippets, URL cleaning and pipelines; semantic search; verse, slides and screenplay modes; Spotlight; scheduled themes; Windows and Linux shell integrations.

## Non-goals

- A general-purpose code editor or IDE. The source panel edits text well; it does not build, debug or run code.
- A notes app with its own database. Marxy reads folders you already have and keeps its own data beside them.
- Session tracking, tagging, or generated text of any kind: Marxy shows what is in the file and nothing it made up.
- Running commands from documents. Marxy copies or pastes commands; it never executes them.
- Syncing. Files sync however they already sync; Marxy's annotations can live in a synced folder if you choose.

## Measures and metadata

| Feature | What it is | Tier | Prototype |
|---|---|---|---|
| Measures | Lines, words, chars, tokens (a local estimate, shown with ≈), bytes, reading time: contextual by kind, all, or a custom ordered list, with per-kind overrides; shown in the status bar, Source bottom bar, selection toolbar, copy toast, library rows, palette preview and outline rows | v1 | 01, 05, 08 |
| Metadata margin | ⌃⌘I shows front matter, modified, size and Git state beside the text; front matter otherwise stays folded with a marker | v1 | 01 |
| Metadata tab | File, Git, Front matter, Extended attributes, Detection, Measures, Hidden and reshaped, Marxy; edit front matter lines, rename, executable bit, Finder tags, quarantine, kind, pin, reading position, each with Undo | v1 | 01 |

## Rounds 5 and 6

| Feature | What it is | Tier | Prototype |
|---|---|---|---|
| Opening stays in the page | A file opens in a tab (01), in the Source editor (02), or in an in-page document view with a back control (04, 05); only "Open in Workspace" navigates | v1 | 01, 02, 04, 05 |
| Sidebar toggle | A button at the left of the toolbar, ⌃⌘S in every state, the palette, and the left-edge peek | v1 | all |
| Copy and Export | Copy (split, with Copy as) beside Export (PDF, Image, HTML, Word, clean Markdown, Print), each with a small options sheet; the same pair in the library preview, the in-page view and (as menus) the bulk bar | v1 | 01, 05 |
| Extract | Four items: Code blocks, Shell commands, Links, Tables as CSV | v1 | 01 |
| Tool strips | At most four buttons per kind; only essential copy tools (Copy commands only, Copy install command, Copy with path) in the … menu | v1 | 01, 03 |
| No policing | Source never underlines or colours the reader's text; notes are marks on the right strip and a count in the bottom bar | v1 | 01, 02 |

## Round 7: keys and verbs

| Feature | What it is | Tier | Prototype |
|---|---|---|---|
| Palette keys | ⌘K Everything (⌘P alias), ⇧⌘P commands, ⌘/ transforms (the Transform group under `>`), `/` content search with line snippets | v1 | 04 |
| Verb menu | Right-click or Enter on a selection: Copy, Copy as, Transform…, Extract (code blocks, shell commands, links, tables); Extract has no key or button | v1 | 01 |
| Read ↔ Source | ⌘E toggles; ⌘1–⌘3 pick Read, Split or Source | v1 | 01, 02 |
