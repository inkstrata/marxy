# The fold-up workspace

**In short.** Marxy's window has two states. **Folded** is what Marxy is today: one column of text
on the page and nothing else. **Unfolded** is Galley's workspace: a sidebar with the library and
the folder tree, tabs, a toolbar, the tool strip for the document's kind, the source pane in Split
view, an inspector and a status bar. `⌘\` moves between them. Between the two, the pointer can
*peek* a single panel from an edge without unfolding the rest. The reader decides how much machinery
is on screen, one step at a time, and Marxy always offers the column of text first.

## Folded

- The page ground fills the window. The document's column sits where it reads best, at its measure.
- Nothing else is on screen: no toolbar, tabs, sidebar, inspector or status bar. Window controls stay
  hidden until the pointer reaches them (ADR-0038).
- Read and Source both fold. In Source, the editor alone shows, at the column's position.
- The palette (`⌘K`, or today's `⌘P`), find, the outline and the verb menu are summoned and dismissed exactly as
  today. A reader who never unfolds has today's Marxy.
- The window always opens folded.

## Peeking

When folded, the pointer resting at an edge for about 150 ms peeks one panel as an overlay with the
theme's shadow:

| Edge | Peeks |
| --- | --- |
| Left | The sidebar: library views, collections, the current folder's tree |
| Right | The inspector, on its last tab |
| Top | The toolbar and tabs |

Moving away hides the peek. Moving the pointer anywhere also shows one quiet sidebar button at the
top left, which fades after a second and a half of stillness (and shows on keyboard focus); clicking
it docks the sidebar. At rest it is gone, so the folded window stays a column of text. Clicking inside it, or pressing the panel's own key, *docks* it, which
unfolds the workspace with that panel showing. Peeking never moves the column.

## Unfolded

Galley's workspace (Galley `01-workspace.md`), with the changes below.

```
+-----------+---------------------------------------------------------------+------------+
|  sidebar  | ‹ ›  plan.md · ~/Work/plans   [Read|Split|Source]  [Report ▾]  …  |            |
|           | tabs:  plan.md | handoff.md | indexer.rs | +                     | inspector  |
| Recent    +-------------------------------+-------------------------------+            |
| Pinned    | tool strip for this kind      | UTF-8 · LF · 96 lines         | Outline    |
| Changed   |                               |  1 | # Cache the harmonic …   | Info       |
|           |   the rendered document       |  2 |                          | Versions   |
| Plans     |                               |    source editor              | Links      |
| tidemark  |                               |                               | Look       |
| Reading   |                               |                               |            |
| (tree)    |                               |                               |            |
+-----------+-------------------------------+-------------------------------+------------+
| Report · 435 words · Ln 1 · UTF-8                                         Ink · 100%   |
+---------------------------------------------------------------------------------------+
```

### Layout: detail sits beside its parent

Every multi-panel view reads left to right as **navigation → its detail and controls → the
canvas**. A panel that configures or describes the thing selected in a list sits immediately beside
that list, never stranded across the window on the far right: on the themes page the theme list and
the selected theme's controls sit together on the left, with the preview filling the rest; on the
content-types page the typography controls sit beside the type list, with the sample on the right.
The workspace inspector is the exception that proves the rule: it describes the document, so it sits
beside the document.

### Keys

| Keys | Action |
| --- | --- |
| `⌘\` | Fold or unfold the whole workspace |
| `⌃⌘S` | Sidebar (from folded: unfolds with the sidebar) |
| `⌥⌘I` | Inspector (from folded: unfolds with the inspector) |
| `⌘1` `⌘2` `⌘3` | Read, Split, Source (`⌘E` keeps toggling Read and Source, as today) |
| `⌘K` | Palette, folded or not (`⌘P` stays as an alias; `⇧⌘P` opens it on commands; `⌘/` on transforms) |
| `Esc` | Closes the topmost summoned thing; with nothing summoned, folds |

Unfolding restores the panels the reader last had open. Folding never forgets them.

### Sidebar

Four sections, top to bottom. **Every section collapses on its header** (a collapsed one keeps its
header and a quiet count), `⌥`-click collapses or expands them all, and each state is remembered.

| Section | Holds |
| --- | --- |
| **Recent** | The last eight documents opened, newest first. Foldable; most readers keep it open |
| **Pinned · Changed since you read** | C-12's two views, already built. No task view, no "live" view |
| **Repositories** | Git repositories as first-class rows: name, and a quiet count of files changed since you read when there are any. A repository expands into its tree in place |
| **Folders** | Folders the reader added in `collection.toml` (plans, notes, reading, an inbox) |

Every repository and folder **drills down to any depth** in the sidebar itself: a tree with
disclosure chevrons and indentation guides, children loaded when a folder opens, `←` and `→` to
fold and unfold. The tree honours `.gitignore` and the deny list, folds worktree copies (C-15),
and carries one quiet mark, *changed since you read*. A folder's context menu offers *New file
here*. Index status appears at the foot only when something is wrong.

### Toolbar

Galley's default toolbar has thirteen or more controls. Here it carries only what is not better as
a key or a verb: a sidebar toggle at the far left (so a closed sidebar is always one click away),
back and forward, the title and path, a **+** menu (*New file*, *New file in this folder*, *Fork
this file*), the Read/Split/Source switch, the kind menu, Copy, Export and Transform (`⌘/`), Find,
and the inspector toggle. No Extract button: Extract has no key and lives in the verb menu and the
palette. No theme switcher: themes are in the palette and on the themes page. The customize sheet is kept, so a reader can put back what they use.

### Tabs

Tabs return, in the unfolded workspace only (ADR-0058 reverses ADR-0011 there). Folded, the palette's Recent
is still the switcher. Each tab shows the kind's icon, the name and an unsaved dot, and nothing else.

### Tool strip

Each kind has its own strip of quick tools (Galley `03-content-modes.md`), shown only when unfolded:
at most four per kind, for example Paths, Changes and Split by H2 for a report; Wrap, Symbols and
Go to line for code; Filter and Table for data; Collapse tools for a transcript. AI tools (TL;DR, Summarise, Clean AI copy, Prose lint, Follow) are
removed. Strips are customisable per kind in settings.

### Inspector

| Tab | Holds |
| --- | --- |
| Outline | Headings with section moves (drag, up, down, promote, demote); tables |
| Metadata | Everything known about the file, by source: **File** (path, size, created, modified, permissions, encoding, line endings); **Git** (repository, branch, status, the last commit touching it); **Front matter** (keys and values, editable, each edit a splice of only the affected lines); **Extended attributes** (Finder tags, where from, quarantine); **Detection** (kind, language, reasons, *show as*, *always open this folder as*); **Measures**; **Marxy** (last read, pinned, reading position); **Hidden and reshaped** (invisible characters, every place Read reshaped the file) |
| Versions | Changed since you read; snapshots by time; diff; restore to a copy |
| Links | Paths mentioned, found or missing; links; backlinks |
| Look | The current kind's typography and colours, live: Galley's typography panel with sliders that obey the coupling rules, and the measured colophon ([03](03-kinds-and-the-look.md#the-look-tab)) |

Galley's *Clips* tab and the collect stack leave with the clipboard studio. The inspector opens by default only in
windows wide enough that Split never squeezes the reading measure (Galley's 1,600 px rule).

### Status bar

Kind, the reader's chosen measures, caret line, encoding, and on the right the theme and text size.
No clip count, no live state. Clicking any item opens its inspector tab.

### Split and Source

Phase D's two panes are Galley's Split view: rendered on the left at the larger share, source on the
right, with scroll sync, click-to-locate and the source caret marking its block.

**Source is an enclosed editor around the raw bytes.** It sits in a framed surface (a hairline
border, a large radius, the text on the page ground) and reads as a text editor, whether
full-window, in Split, or folded. Around the bytes are thin bars and rulers. Each shows only
information with **provenance**: derived from exact bytes, and pointing back at them.

| Edge | What it shows |
| --- | --- |
| Top bar | The path; encoding · line endings (LF, CRLF, mixed) · indentation as detected · size in bytes · line count; one copy control |
| Column ruler | Under the top bar, on the editor's character grid: a tick per column, taller every five, numbers every ten; the caret's column and a selection's span marked; a hairline guide at column 80 |
| Left gutter | Line numbers, never selectable, the current one stronger; fold arrows on hover; nothing else |
| Right edge | A thin strip of marks at the height of things that sit at exact bytes: invisible and bidi characters, find matches, lines changed since you read, and quiet notes (an unclosed fence, a heading that skips a level). Hover names the place (`U+200B at 23:14`); click jumps |
| Bottom bar | `Ln 23, Col 14 · byte 1,284`; a selection's length in characters and bytes; the character under the caret as a code point (`U+00E9 é`, invisible characters by name); the language |

The bytes themselves are shown exactly. Invisible and bidi characters carry their boxed hex marker.
Tabs and trailing spaces are drawn faintly only when *show whitespace* is on. A minority line ending
gets a faint `␍`, and a missing final newline is said in a faint line after the last.

Nothing interpretive lives in the frame: no formatting toolbar, structure panel, bottom panel tabs or
minimap. Formatting commands stay in the palette and on keys. The outline lives in the inspector.
Galley's other source tools come in Phase V without adding chrome: structural selection, table tools,
and find and replace with a diff preview.

**Marxy never decorates the reader's text to correct or judge it.** The source is theirs to edit. No
squiggles, underlines, highlighted lines or gutter icons mark a "problem" in Source, and Read draws
no lint marks either. Notes Marxy has about a file (an unclosed fence, a skipped heading level, a
path that does not exist) are quiet marks on the right edge with the detail on hover, a count in
the bottom bar only when there are any, and lists in the inspector (missing paths in Links, notes
under Metadata). Invisible characters are different: they are bytes that are there, so showing them
is faithfulness, not judgement. The AI-prose lint, AI rewrite and the agent
write-lock are left out. When the file changes on disk over unsaved edits, a bar offers *keep mine as a
copy* or *take theirs*, whoever wrote it.

## New and fork

- **New file** (`⌘N`): an untitled scratch document that writes nothing until Save As (E-13).
- **New file here**: from a folder's context menu in the sidebar, named on first save.
- **Fork this file** (`⇧⌘N`): a copy written *beside* the original as `name (fork).md`, never over
  it, opened in a new tab, with undo in the confirmation.

All three are in the toolbar's **+** menu, the tab bar's **+**, and the palette, and work folded.

## Copying and exporting

Galley's clipboard studio is descoped, and so are its collect stack and clipboard history
([01](01-galley-keep-knead-leave.md#clipboard-studio-galley-06)). Copying is immediate instead, from
one place per surface plus keys, never a button on every block:

- **Keys:** `⌘C` copies the selection, or the document when nothing is selected; `⇧⌘C` opens *Copy
  as* at the pointer (Markdown, plain text, rich text, HTML, a fenced block with its path).
  `⇧⌘E` stays *open in external editor*, as in the app today.
- **Workspace toolbar:** two grouped controls. **Copy** (a click copies; its chevron opens Copy as)
  and **Export** (PDF, image, HTML, Word, clean Markdown, Print), each export with a small sheet of
  at most three options. The same pair heads the library preview and the in-page document view.
- **Read:** code blocks show one copy control on hover; nothing else does. The selection toolbar
  has Copy with a chevron for Copy as.
- **Source:** keys and the gutter's menu (*Copy line*, *Copy with path:line*); no copy button in
  the frame.
- **Extract** has four items (code blocks, shell commands with prompts stripped, links, tables as
  CSV), no key and no button: it is in the verb menu and the palette.
- One quiet confirmation names what was copied and how ("Copied as Markdown · 412 chars · ≈108 tokens").

The copy pack built in C-07 to C-09 supplies the formats.

## Tasks

Tasks are ordinary text. Checkboxes render and toggle (`toggle-task`), and task extraction stays
in the Extract menu, but no progress bars, task counts, task views or task tools appear anywhere.

## Metadata on demand

A file's metadata is hidden by default and shown on request: `⌃⌘I` or a palette command. With it on, Read's empty left margin carries a quiet preview beside the first
line: front matter first, then modified date, size, git status and branch, in small chrome type,
sticky as you scroll, with *More…* opening the Metadata tab. In a window whose margin is too narrow, `⌃⌘I`
opens the Metadata tab instead; nothing is ever placed above the text. With it off, folded front matter keeps its marker
(commitment 4), and clicking the marker turns the preview on.

The Metadata tab is the full view and the control surface: front matter is edited in place (each
change a splice of the affected lines), a file can be renamed or made executable, Finder tags edited,
quarantine removed, the kind overridden, and Marxy's own state for the file forgotten. Every change
has undo. Everything else is read-only, with copy on each value.

## Measures

Lines, words, characters, tokens, bytes and reading time are **measures**. By default they are
**contextual**, a set per kind:

| Kind | Measures, in order |
| --- | --- |
| Prose, README, report, docs, transcript | words · characters · ≈tokens · lines |
| Code | lines · characters · ≈tokens · bytes |
| Data | lines · bytes · characters |
| Log, terminal | lines · bytes |

The reader can switch to *all* (every measure, everywhere) or *custom* (an ordered list), and
override the set for any kind in its content-type settings. The choice propagates everywhere a size appears: the status bar, Source's bottom bar, the
selection toolbar, the copy confirmation ("Copied as Markdown · 412 chars · ≈108 tokens"), the
inspector's Info tab and outline rows, library rows and the palette preview. Where only one fits,
the first is used.

Tokens are an estimate made on the reader's machine, always marked `≈`; nothing is sent to count
them. In Source a selection always shows its bytes too, because there the bytes are the subject.

## The palette

Galley's palette, minus Ask and Clipboard. `⌘K` opens it (`⌘P`, today's key, stays as an alias).
Prefixes: everything (none), `>` commands, with the transforms grouped under them (`⌘/` opens the
palette there, `⇧⌘P` on commands), `#` headings here, `@` sections everywhere, `/` content search
(as shipped in C-17), `~` collections and `:` line. It keeps Galley's preview pane, which shows a
file's first lines in its kind, a section's text, or a transform's result before you commit.

## The library

Galley's Library window (Galley `05-collections.md`) is the deep view of the collection: a scope
(a collection, Recent, Pinned, Changed since you read), a query, dense result rows and a preview.
It opens from the sidebar or the palette and is a full-window view inside the workspace, so folding
hides it too.

Kept: add a folder with a dry run, the query field with completions, *why it matched* lines, the
preview pane, near-duplicate folding, broken-path checks, archive by moving to `.archive/` beside the
files, and undo for everything. Removed: model, session and tag facets and columns, `is:live`,
`is:ai`, the AI smart collection, context packs and the Tag action. The query language keeps
`kind:`, `in:`, `path:`, `is:changed`, `is:pinned`, `has:tasks`, `modified:` and `words:`.

## Settings

Galley's settings surface, trimmed and file-backed. The settings are still `config.toml`, written
only where they differ from the defaults, atomically, watched and with unknown keys kept. The
surface is a view of that file, opened with `⌘,` as a document in the workspace rather than a
separate window, with Galley's search, a dot for changed values with click-to-reset, and coupling
rules that disable a control and say why. Categories: General, Appearance, Reading, Content types
(per-kind profiles, tool strips and folder rules), Source editor, Collections, Accessibility, Privacy
(a computed list of everything that can leave the machine), Advanced (the file itself). The AI,
clipboard and macOS-integration categories wait for the features they configure.
