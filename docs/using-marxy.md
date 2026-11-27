# Using Marxy

What the app does, from the reader's side, with the module behind each part. Paths are under
`apps/desktop/src/` unless they say otherwise. Keys are listed in full in [keys.md](keys.md); "Mod" is
Ctrl on Windows and Linux and Cmd on macOS.

## Opening files

- **From the system**: a file passed on the command line, opened with Marxy, or dropped on the window.
  A second launch hands its files to the running window.
- **From inside**: Mod+O (the system's open dialog), the Line (Mod+P), Places, links in a page, the
  crumbs in the pane head, back and forward. `g ]` and `g [` (or Mod+Alt+] and Mod+Alt+[) open the next and
  previous file in this file's folder, in the order the folder's page lists them, in the same tab. They do not
  wrap: at either end a notice says so. The file crumb's menu shows the keys beside the two neighbours.
- **Without a file**: Mod+N opens an empty scratch document (`untitled`), written only by Save as; Mod+V
  in Read opens the clipboard as a scratch Markdown document.
- **From inside another file**: an archive entry, a mail attachment or a database cell opens as a tab of
  its own, held in memory and read-only (`document/entries.ts`).

What happens on open (`document/open.ts`):

1. The shell reads the file's head to learn whether it is text or binary, its encoding and its format.
   A binary file goes to its viewer without being read whole.
2. Text is read whole (up to 256 MB) and decoded if it is not UTF-8 ([file-kinds.md](file-kinds.md#encodings)).
3. The file's type and kind are decided ([file-kinds.md](file-kinds.md)), and with them whether it opens
   in Read or Source. Code under 1 MB and HTML land in Read (its coloured code, the sandboxed page), with Source one key away;
   a code file the reader switched to Source opens there again.
4. The page is shown at the place it was last read (`positions.json`). Large files are parsed and drawn
   in slices: the first screens appear at once and the rest follows while the page is idle.
5. The file's folder is watched. When the file changes on disk, the page reloads and keeps its place;
   if it was renamed, the page follows it; if it was removed, the page stays with a notice. A log that
   grows (the log page, or Lines from 5 MB) takes only its new lines: the end Marxy holds is checked against
   the file, and only what follows is read. A reader at the end stays at the end, as with `tail -f`; a reader
   further up keeps the place. A log that was truncated, rotated or rewritten is read whole, as is any file
   with unsaved changes in Marxy.
6. The file's folder (or repository) becomes a place, whatever the file is: a PDF, image, sheet or Word file
   opened on its own is listed in Places beside its neighbours and its crumbs start at that folder.

A file that cannot be opened shows a card saying why (too large, not a regular file, missing, no
permission). One document is held once per window, so two panes showing the same file share its
unsaved changes.

## Read and Source

Each pane shows its document in one of two modes.

- **Read** shows the file as a page: Markdown typeset, data as a tree or table, code coloured, an HTML file as
  the sandboxed page a message's HTML part is drawn in (no scripts, nothing from the network until asked), logs,
  patches and sessions drawn for what they are, binary files in their viewer. Every element carries the
  byte range it came from, so the cursor, copy and edits always name exact bytes.
- **Source** is a CodeMirror 6 editor over the file's exact text (`source/editor.ts`): line numbers and
  folding for code, wrapping for prose, the file's own line endings and indent, invisible characters
  and bytes that are not UTF-8 marked and kept. A frame around it shows the encoding, line endings,
  indent, size, the caret's line, column and byte, and marks for find hits and notes about the file.
  The column ruler shows only while the column guide is on. A binary file's Source is its hex view.

Mod+E or `\` switches; Mod+1, Mod+2 and Mod+3 choose Read, Read beside Source, or Source. The place is
kept across the switch: Source opens at the reading line's byte, and Read comes back to the byte it
left. Mod+E, the Source button and `\` leave the caret in the editor with the keys: at the reading line, or where it was when Source was last left and Read was not scrolled. Source opened another way (Split, a restored layout) leaves the keys where they were. Typing in Source is folded into the document when Source is left, as one undo step.

In Read, fenced blocks in Markdown are read as what they hold (a JSON fence as a tree, a CSV fence as a
table, a session, a patch, a log, a Mermaid diagram), maths is set with KaTeX, local images are shown,
code is coloured in a worker as it comes into view, and links show where they lead. Remote images and
raw HTML are held back until the reader allows them for that document (Trust, `trust/`). Allowing or revoking raw HTML for a file applies at once in every pane showing that file.

A Markdown page starts with its title. Its front matter's author and date (`date`, else `published`, else
`created`; a calendar day is written in words) are one quiet byline under the title; every other key is in
the Metadata panel, and Reveal draws the whole head as the file has it. Each value in the byline carries
the bytes it shows, so the cursor, x-ray and Source reach them (`packages/core/src/render/frontmatter.ts`).

A page has one line of meta above its content: its caption (`JSON · 9 keys at the top`, `PDF 1.4 · A5`), a
key that opens **How this is shown** beneath it. A viewer puts the key at the end of its toolbar row, and
a page whose caption is a sentence (an archive's) has the key's chevron before it. The account is a few
sentences on how the page shows the file: that the file is untouched, that sorting or folding changes
only the view, how much of a large file is drawn and that Source has the rest. A page drawn inside
another (a fenced block in Markdown, an entry previewed in an archive, a gzip's one file) has no line of
its own. One press opens or folds it on every page, and the choice is kept across launches
(`frame/account.ts`; each reading and viewer gives its sentences through
`packages/core/src/reading/account.ts`). The Metadata panel lists the same sentences.

## The cursor

A cursor moves over the parts of what is shown: sections, blocks, list items and table rows in a
Markdown page; tree nodes, records, rows and cells in data; stanzas and lines in verse; cells in a
notebook; turns in a transcript; entries in a log; hunks and lines in a patch; entries in an archive;
the parts of a viewer. `j` and `k` move along, `l` goes in, `h` comes out; a heading stands for its
section.

The verb bar at the foot of the pane shows the part's address (`notes.md:12–18`, `#cell=7`,
`#Sheet!F5`, `@0x1F00`) and its verbs. Single keys act on the part: copy it exactly (`c`) or as a
quote with its source (`C`), edit it in place (`e`), tick a task (`t`), see it as stored (`x`) or with
its markup put back (`X`), fold (`z`), show only it (`v`), open it alone (`o`), read it another way
(`r`), move it (Alt+↑/↓), promote or demote a heading (`<` `>`), remove it (`d`), collect it into the
tray (`y`) or write a margin note on it (`n`). Enter opens the full verb menu, which lists the bar's verbs after the operations; a right-click opens the operations alone. `e` puts the caret at the end of the block's text, after a list or quote marker. In the Line, Mod+P again selects what is typed; Esc closes it.
While the bar shows, the page keeps a foot as tall as it, in the page's ground, so no line of the page is under the bar, and a part the cursor moves to is scrolled clear of it.

**Lenses** show only the parts that hold something: headings only, open tasks, code and fenced parts,
tables, links, noted parts, unsaved changes, odd characters, or a find. Esc ends a lens.

**The pointer**: a click selects the block under it, Shift+click grows a run, a drag selects text with
its byte range. A link click follows it: an anchor lands in the page, `http`, `https` and `mailto` open
in the system browser, a relative link to a Markdown or text file opens in Marxy (Mod+click in the other
pane); other schemes are refused.

## The Line

One field for going anywhere and doing anything (`palette/view.ts`, `line/`). Its first character picks
the scope:

| Mark | Scope | Enter |
| --- | --- | --- |
| none | files, open tabs, headings and commands, ranked by match and by how recently they were read | open (Mod+Enter beside) |
| `>` | every command, grouped | run it |
| `@` | headings in this document | go there |
| `:` | a line or range, `40` or `40-52` | put the cursor there |
| `/` | find in this document; `/re/flags` for a regular expression, a capital letter for exact case | go there; Alt+Enter shows only what matches |
| `#` | search the text of every file in scope | open at the line |
| `=` | filter rows: a log's levels, a table's rows, an archive's entries | keep the filter |
| `!` | change the text with one of 50 transforms, with a preview | stage the change |
| `%` | lenses, with their counts | apply |
| `~` | compare this file with disk, an earlier copy or another file | compare beside |
| `&` | read this file another way, with a preview | read it so |
| `?` | what each mark means | |

With an empty field it lists the open tabs, pinned and recent files and a few suggestions; with no file open its
first row is Open a file (Mod+O). Tab keeps a result in its panel (files in Places, finds in Search, headings in
Outline).

**Kinds.** A word that names a kind narrows the files: `ragged pdf` lists the PDFs called ragged, `notes md` the
Markdown files called notes, `log errors` the logs. The words are pdf, image, sheet, csv, xlsx, log, deck, docx, epub, mail,
font, audio, video, archive, zip, sqlite, notebook, markdown, md, json and yaml (with their plurals and common
spellings); any known extension written with its dot, such as `.rs`, narrows too and hides headings. A kind word is
also a name: `md` keeps `md-guide.txt`, matching whole words of the path, a word and its plural alike. A query of only
kind words lists the files the words match first, then the rest of the kind. A file with a page of its own wears an
icon for what it is and opens its second line with its kind and size.

**What it searches.** Files come from an index of each folder in scope: the open document's repository
(the nearest folder holding `.git`), the places added in Places, and recent folders
(`index/`, `collection/`). Only Markdown files are read for the index (title and headings from their
first 256 KB); `.gitignore` and `.ignore` are honoured and folders such as `node_modules`, `target` and
`.git` are skipped. The index is kept in `index-<hash>.json` in the data folder and patched from a tree
watch. `#` searches file contents through the shell without indexing them: smart case, files up to 256 MB read
in chunks, binaries and credential files (`.env`, `.npmrc`, keys and the like; see file-kinds) skipped. The notice under the field says when a search stopped early (after
1 GB read, 15 seconds or 100,000 files) and how many files were skipped as binary, too large or unreadable. The
Search panel reads whole files and still leaves out those over 4 MB, saying how many.

## The window

| Part | What it is | Module (`apps/desktop/src/`) |
| --- | --- | --- |
| Tab row | one row of tabs for the whole window; each open document appears once | `frame/tab-row.ts`, `frame/window-tabs.ts` |
| Rail | icons for the panels, with Look and Settings at its foot | `left/frame.ts`, `left/registry.ts` |
| Drawer | the panel shown beside the page | `left/frame.ts` |
| Panes | one or two documents side by side, with a divider between | `pane/` |
| Pane head | Back and Forward, the crumbs (place, folders, file, the headings above the reading line), chips for the reading, encoding and unsaved changes, and Read / Source | `frame/head.ts`, `frame/crumbs.ts` |
| Spine | a map down the right edge of a page in Read: heading ticks, the view, the cursor's part, find hits, unsaved changes and notes; press or drag to move | `frame/spine.ts` |
| Notices | messages at the foot of each pane | `notices/index.ts` |
| Verb bar | the verbs for the part under the cursor, at the foot of the focused pane | `selection/verb-bar.ts` |

In the Windows app every box that scrolls draws the same bar: no arrows or track, and a thumb that rests
at 2 px, widens to 4 px while its box is under the pointer and to 6 px on the thumb itself
(`packages/theme/src/frame.css`). The rail, the tab row and the minimap hide theirs, and in Read the
spine stands in for the page's. On macOS and Linux, and with forced colours, the system draws its own.

### Tabs

- Click shows a tab in the focused pane; Ctrl+click shows it beside; a double-click keeps a glance tab.
- Middle-click, the close button, Alt+W or Delete closes it. A pane left with nothing closes; the last
  tab cannot be closed.
- An unsaved document is marked on its close button; a file gone from disk is marked too.
- Tabs keep their own width while the row has room. Past that, one width is found and only the tabs
  wider than it are cut to it, down to 124 px at 13 px type; then the row scrolls (the wheel over it
  scrolls it sideways) and fades at an edge with tabs beyond it. A cut name keeps its extension, starts
  its tail at a word, and keeps the end that tells it from the other open names; two open files of one
  name show the folders that tell them apart. "All tabs" says how many tabs are not wholly in view and
  lists every tab with its folder (`frame/tab-row.ts`, `cutName` in `frame/tabs.ts`).
- A dragged tab shows a mark where it will land.
- Mod+Shift+T reopens the last tab closed, in the focused pane and at its old place; the row remembers
  20 for the life of the window (not scratch documents, app pages or archive entries).
- Up to 48 tabs: one more closes the oldest tab no pane shows, with a notice. Scratch documents, app
  pages and archive entries leave the row once no pane shows them.
- Coming back to a tab you left (a click, Back, Forward) shows it without reading or parsing the file again,
  and keeps its undo history, so Mod+Z still undoes an edit made before you left. The last three documents
  left clean are kept this way (not scratch documents, archive entries or files over 16 MB); a file that
  changed on disk meanwhile is read once on return and shown as it is now, and a closed tab's document is let
  go. A document with unsaved changes is never left behind: leaving it asks first.
- `g t` and `g T` move through tabs (also Ctrl+Tab and Ctrl+Shift+Tab on macOS). The + button and a
  double-click on the empty row open the finder. Split shows the current document beside, or closes the other pane.
- Right-click (or Shift+F10) opens the tab menu: Close, Close the others, Close the tabs to the right,
  Open beside, Copy its path, Show in Places, Compare with the other file, Keep this tab (on a glance
  tab), Reopen the closed tab, and for files with staged changes Read its changes, Save or Discard.

### Panes

- At most two. A second pane opens only when both columns fit at 45 characters; otherwise a notice
  says how wide the window must be.
- The divider drags; ← and → move it, Home or a double-click evens it. Narrowing the window gives back
  the unfocused pane, and widening brings it back.
- Each pane has its own back and forward history over the tabs it showed.

### The page alone

Mod+\ hides the rail, drawer and tab row; the head fades and returns while the pointer moves. A press
on the quiet button (top left) brings everything back; holding the pointer at the left edge peeks the
rail and drawer. `b` or Mod+B cycles the left section between open, rail only and hidden. The drawer
docks beside the page when the window has room (at least 900 px, keeping 520 px for one pane or 960 px
for two) and otherwise opens over the page. A first window, with no layout kept yet, opens the drawer only when the page
keeps its whole measure and gutters beside it; otherwise it starts with the rail alone. Until the reader chooses, a
resize follows the same rule, so a widened window looks as one opened at that width; from then on
the reader's own choice is kept.

F11 takes the window full screen with the page alone: the rail, drawer, tabs and head stay out of sight and
come back as they do for the page alone (the pointer at the top or the left edge, or the keys that open
them), then go again. F11 leaves, and so does Esc when nothing else would use it: an open Line, menu, find
field or editor takes it first. Leaving puts the frame back as it was.

## Panels

The rail holds eight panels in this order; Alt+1 to Alt+8 show them, and the same key again folds the
drawer back to the rail. Every panel has a head (name, subject, at most two buttons), a field, rows and
a foot whose verbs are buttons that act on the row under the cursor (Enter opens them all as a menu).

A rail icon held under the pointer for 400 ms, or reached from the keyboard, shows a tip: the panel's
name, its key and what it is for. Once one tip shows, the next follows at once until the pointer has
been off the rail for 600 ms (`left/frame.ts`). Badges on the rail mark what the reader has made in a
panel: Search's matches while a query stands, Transforms' staged edits, a dot on Versions while the
file is unsaved, and links that lead nowhere once Links has found them.

Keys inside a panel: Tab on the page hands the keys to the panel and Esc or Tab gives them back;
`j` `k` and the arrows move, `l` opens or descends, `h` folds or goes up, Enter opens a row's verb
menu, `O` opens beside, Space ticks, `/` goes to the field.

For a screen reader the keys sit on the panel's list (focusable by script, not by Tab), which points at the cursor row with `aria-activedescendant`; where a panel has no rows the drawer holds them.
A panel whose rows nest (Places, Outline, Links, Search) is a tree of `treeitem`
rows with `aria-level` and `aria-expanded`; the others (Metadata among them) are a `listbox` of `option` rows, a row that opens saying open or shut in its name. A row's name
is its text plus the state it only shows by colour (current, open in a tab, unsaved changes, on or off),
and a ticked or chosen row is `aria-checked` (`left/aria.ts`). Notices are said once, by the pane's
status region (see Menus and notices).

An Outline of 300 sections or more (a long Markdown file shown rendered) draws only the rows near the
panel's view, and the cursor's row wherever it is (`left/row-window.ts`): the panel's scrollbar still
measures the whole list, the keys walk all of it (End reaches the last section), and each row says its
place among its siblings with `aria-posinset` and `aria-setsize`. When the page moves the mark to
another section the Outline brings that row into view (centred when it comes from far off) unless the reader had scrolled the panel away from the mark; a shorter
Outline is drawn whole and follows the page the same way.

| Panel | Shows | Verbs and controls |
| --- | --- | --- |
| Places | pinned files, each place (repositories, then folders, in the reader's order), loose files that are open but in no place, saved sets of tabs; a filter that takes `kind:`, `>size`, `<size`; counts per kind that filter the list | file: `o` open, `O` beside, `~` compare, `m` pin, `r` read as, `i` metadata, `e` export, `c` copy path; place: open as a folder page, `f` find in it, Alt+↑/↓ reorder, `d` remove; + menu: open a file, add a folder, save the tabs as a set |
| Metadata | how the file is read and why; Read / Reveal / X-ray / Source; How this is shown, as the page says it; the readings it could take, Bytes last; the file as stored (size, encoding, line endings, indent, modified); odd characters; front matter or a viewer's facts; what it holds (tasks, fenced parts, tables, footnotes, links, notes); the part under the cursor | `v` show only those parts, `x` show them in Source; a file with no reading shows its hex head and the readings tried |
| Outline | Markdown: headings with a size bar and word count, fold levels 1, 2, 3, all; a book: its own contents (chapters and what nests in them) with a size bar and word count, fold levels 1, 2, 3, all; tables: columns; logs: a time strip, levels, warnings and errors; other kinds: their parts | headings: Alt+↑/↓ move a section (staged, one undo step), `<` `>` promote and demote, `z` fold on the page, `c` copy the section; a book's chapters: `o` go, `z` fold on the page, `c` copy the chapter (a book is only read: nothing moves); columns: `S` sort the view |
| Links | links to files here (each checked), links that lead nowhere, links within the file, links outside (never fetched), other files here that point to this one | `o` go or open, `p` peek, `c` copy, `w` where it is written |
| Search | find and replace with match case, regular expression and whole word, in this file, its folder or every place; results grouped by file, a hundred files drawn at a time (a last row draws the next hundred; the count and Stage cover them all); a log or JSON Lines file starts unticked, and its row says Replace leaves it alone until ticked | `r` replace on this line, `o` go, `y` collect; "Stage N places in M files" stages every replacement as an unsaved change, one undo step per file; save a search |
| Transforms | text transforms for the selection or the whole file, grouped: space, lines, Markdown, JSON, bytes, and the reader's own commands; each row says how many lines it would change | Enter stages it, `p` peeks the patch, `u` undoes |
| Export | this file, the selection, the files ticked in Places, or the tray, as a web page, a PDF (through the system's print), Markdown or the file as written, plain text, JSON Lines (tables), one combined page, or a zip bundle with a manifest, notes, unsaved changes as patches and the files linked | options: the look worn or plain, paper size, folded sections, notes in the margin; Copy instead of saving for text forms |
| Versions | what is unsaved now; earlier copies of the file, with time, size and why each was made; backup settings | `o` read the patch, `s` save, `x` discard; for a copy: `~` compare, Enter restore (staged), `m` keep for good, `o` open, `d` delete; export all copies as a zip |

Look (Mod+Alt+T) opens the Studio ([themes-and-type.md](themes-and-type.md#the-studio)). Settings (Mod+,)
opens in the drawer. Clip (Mod+Alt+C) lists every Copy-as form for the selection or the file.

**Copy and paste** (`commands/copy-write.ts`, `source/paste.ts`, `paste/`). A copy puts one clipboard
item holding its plain text, and its HTML when the form has one: Copy as Rich text writes the selection's
sanitised HTML beside its plain text (CF_HTML on Windows); no form writes RTF. A paste into Source that
carries HTML (from a browser, Word, Teams or a chat tool) is read through the shell and goes in as
Markdown, with its links, lists, headings, tables and code; Mod+Alt+Shift+V pastes the plain text
unconverted. This needs the native clipboard of macOS or Windows; on Linux the editor pastes the plain
text. A clipboard a password manager marked concealed is never read.

## Pages that are not documents

- **Empty state.** A launch with no file and no saved layout shows one passage chosen at random from
  `apps/desktop/src/commonplace/pieces/`, typeset like a page with its source beneath it.
- **Folder page.** A folder's files as rows, with how each would be read, its size and date. When most
  entries are images, each row starts with a small picture (an image this system cannot draw shows its
  extension) and says its pixel size, format and size under its name; pictures are drawn only for rows
  near the view, and none past 64 megapixels. One line at the foot, "Search leaves out ... here", opens
  to what search leaves out there and why; it keeps its own open state, unlike the reading pages' folds,
  which open and close together. Opened from a folder crumb or a place.
- **Compare page.** A scratch page beside the document: what was compared with what, the counts, and
  one diff. Opened by "Show what changed on disk", "Compare with unsaved", "Compare two files", a
  version's `~`, or the Line's `~` scope.
- **Changes page** (Shift+R, or the head's Unsaved chip). The patch saving would make, kept up to date,
  with Save, Undo the last change, Discard them all and Copy the patch. With `review_changes` on, Save
  opens it first.
- **Tray** (Shift+T). What `y` collected, in order, each with its source and a note line; copy all as
  Markdown or write it to a new file. Kept for the session only.
- **Reply page** (Shift+Y). A file's margin notes under the lines they belong to, to copy or write out.

## Editing and saving

Nothing is written until Save. Every change is one step in the document's history (100 steps; `u` /
`U` or Mod+Z / Mod+Shift+Z) and a splice over exact bytes (`document/store.ts`).

Changes come from:

- the cursor's verbs (remove, move, promote, demote, tick) and the Outline panel;
- operations on a selection (`op.*` commands: copy code, align table pipes, renumber a list, format a
  JSON fence, sort list items, move a section and others; `packages/core/src/operations/`);
- editing a block in place (`e`), a small editor over that block's bytes;
- Source;
- transforms (the Line's `!`, the Transforms panel, Mod+/);
- search and replace across files (the Search panel), which stages each file's changes;
- restoring an earlier copy from Versions.

**Seeing changes.** The pane head shows "Unsaved · n places"; the spine marks changed lines. `R` opens
the changes page beside the document: the patch saving would make, with Save, Undo the last change,
Discard them all and Copy the patch. With `review_changes = true`, Save opens that page first.

**Saving** (`save.ts`): Mod+S writes the document through the shell's atomic write, keeping its
encoding, BOM and line endings. A save is refused when the file changed on disk since it was read, and
before it replaces a file Marxy keeps a copy of the bytes on disk (Versions). Save as (Mod+Shift+S)
moves the document, its watch and its history to the new path. Fork (Mod+Shift+N) writes the document
beside itself as `name (fork).ext`, in the file's encoding, without touching anything that exists.

**A change on disk while edited.** The edits are kept and the disk's version is held aside; every pane
showing the file says so. "Keep my version as a copy" writes the edits to `name (mine).ext`, in the file's encoding (when that
encoding cannot hold them, nothing is written and the notice says to copy the text out of Source), and takes
the disk's version; "Take the version on disk" discards the edits.

**Closing with unsaved work** asks in the pane that shows it, as a notice with "Save and close" and
"Close without saving" (never a modal dialog); quitting walks every unsaved document in turn.

## The tray, notes and the reply page

- **Tray**: `y` collects the part under the cursor, with its file and lines; `T` opens the tray page to
  reorder, annotate, copy everything as Markdown or write it to a new file. It lasts for the session.
- **Margin notes**: `n` writes a note on the part; notes are kept in `notes.json` in the data folder,
  never in the file, and follow their lines through edits. In Read they sit in the margin when there is
  room, else under the block. `Y` lays a file's notes out under the lines they belong to, to copy or
  write out as `<name>.reply.md`.
- **Notes about a file** (Source only): an unclosed fence, a heading that skips a level, a backticked
  path that does not exist, marked on the editor's edge.

## Versions

Before a save replaces a file, and before a reload replaces what Marxy held, the bytes are kept as an
earlier copy in the data folder (`versions/`): 20 per file by default (`version_copies`: 5, 20 or 100),
30 days, 200 MB in all; copies marked "keep for good" are exempt. Files over 2 MB, scratch documents and
entries are not kept. The Versions panel compares a copy with the document, restores it (as a staged
change), keeps it, opens it or deletes it, and exports all copies as a zip.

## Compare

Compare pages are scratch pages beside the document holding a summary and one diff, with changed words
marked: what changed on disk at the last reload, the unsaved changes, the file in the other pane, or an
earlier copy. The Line's `~`, the tab menu, Places and Versions start them. Nothing is written.

## Find and replace

- **Find in Read** (Mod+F): literal and case-insensitive, with typographic folding (straight quotes match
  curly ones, `--` matches a dash); skips hidden text, maths glyphs, notes and the page's caption key; "N of M"; the current match
  opens folds. In a PDF it searches the text layer, page by page. Where find reads in passes (a PDF's pages, a big file's lines, a long table's rows), while a new query is still reading the count is that query's matches so far with "still counting" after it (or "counting…" before any), never the last query's. When the page is matched again (it changed, or was remade from disk) the match you were on is kept, and until the count reaches it the line reads "M so far · still counting", never a place past the total. While a count is still running, stepping does not guess at matches not yet counted: Next from the last match counted (or from a kept match past it) stays where you are rather than wrap to the first, and Previous from a kept match past the count goes to the last match counted. The field belongs to the document it was opened on:
  another document in its pane puts it away, and it comes back, with its words, when that document is shown
  again, in either pane.
- **Find and replace in Source** (Mod+Alt+F): case, regular expression and whole word; Enter replaces one;
  "Replace all…" previews every change and applies them as one step.
- **Across files**: the Search panel finds in this file, its folder or every place, and stages
  replacements per file, each its own undo step.

## Transforms

Fifty text transforms (`packages/core/src/transforms/`), grouped as clean (strip emoji, front matter,
citations, bold, rules; collapse blank lines; normalise bullets and headings; wrap and unwrap; smart or
straight punctuation), convert (plain text, Slack, Jira, HTML, CSV and JSON tables, JSON pretty and
minified, fence, quote, indent), lines (sort, unique, dedupe, reverse, number, join, bullets), case and
extract (code, commands, tasks, links, paths, headings, tables, questions). They act on the selection or
the whole file and keep line endings and BOM; those that leave code alone do so for code, maths and
front matter. A transform opens a sheet with before and after, where it can be applied as one undo
step, copied, opened as a new document or chained with another. The reader's own `[[command]]` programs
from `config.toml` run on the selection or file through the shell and show their output the same way.

## Export

The Export panel (or "Export…") writes this file, the selection, the files ticked in Places or the tray
as a web page (sanitised, no scripts, with the look or plain, notes as asides), a PDF through the
system's print dialog, the file as written, plain text, JSON Lines for tables, one combined page or
Markdown file, or a zip bundle (the files as on disk, with an optional manifest of sizes and SHA-256,
notes, unsaved changes as patches, the files they link and a page of each). A viewer adds its own forms:
an archive's listing, a PDF's text, a mail part, a sheet or table as CSV, a database's schema. A CSV cell that opens with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` so a spreadsheet shows it as text; a plain number such as `-3.5` is left as it is. A database view stopped at its 2 s cap exports the rows it gave, and the preview says the rest are not in the file.
Everything goes through the system's save dialog.

## Looks

Look, at the foot of the rail (Mod+Alt+T or `A`), opens the Studio, where the page's theme, tone, type,
measure and code colours are chosen or made; `a` opens a small pop-over with the looks and the main
dials. See [themes-and-type.md](themes-and-type.md).

## Settings

Settings are `config.toml` in the config folder ([data-on-disk.md](data-on-disk.md)). The Settings
page (`apps/desktop/src/settings/settings.ts`) draws one row per key from `SETTINGS` in
`packages/theme/src/settings-schema.ts`, writes one line per change over the bytes it last read, and
refuses to write if the file changed on disk or is not valid TOML. A hand edit to the file shows at
once. A changed row has a dot that resets it.

| Section | Setting | Key | Values (default) |
| --- | --- | --- | --- |
| General | External editor | `external_editor` | a command with `{file}` and `{line}` (none: Notepad on Windows; set a command here for another editor) |
| General | Copy as, first choice | `copy_format` | Markdown, Plain text, Rich text, HTML, Slack, Jira, JSON string, Quote (Markdown) |
| General | Read the patch before saving | `review_changes` | on / off (off) |
| Appearance | Theme | `theme` | a bundled theme or a theme folder (Ink) |
| Appearance | Variant | `variant` | Dark, Light, Follow the system (Dark) |
| Appearance | Interface text size | `chrome_size` | 11–26 px (the theme's) |
| Appearance | Colour by language | `syntax` | table (each language's own colours) |
| Reading | Text size | `size` | 15–50 px (20) |
| Reading | Measure | `measure` | 45–80 characters (66) |
| Reading | Typeset | `typeset` | on / off (on) |
| Reading | Single-key verbs | `verbs` | on / off (on) |
| Source | Line numbers | `line_numbers` | Per file, On, Off (Per file) |
| Source | Show whitespace | `show_whitespace` | on / off (off) |
| Source | Column guide | `column_guide` | Per file, On, Off (Per file; column 80 or `.editorconfig`) |
| Content types | How folders are read | `kind` | `[[kind]]` rules: `glob`, `is`, `read` |
| Content types | Tools a kind shows | `strip` | `[strip]` table, at most four tools per kind |
| Accessibility | Contrast | `contrast` | System, More, Normal (System) |
| Accessibility | Reduce transparency | `reduce_transparency` | on / off (off) |
| Privacy | Keep a version before a file is replaced | `versions` | on / off (on) |
| Privacy | Earlier copies kept of each file | `version_copies` | 5, 20, 100 (20) |
| Proposals | one switch per optional feature | `proposals` | inline table of the switches that differ from their defaults |
| Advanced | Your commands | `command` | `[[command]]` tables: `name`, `run = [program, args…]`, `prints` |
| Advanced | Linux font weight offset | `linux` | `[linux] weight_offset` |

Privacy also lists the files Marxy keeps and what can leave the machine (opening a link, loading a
message's remote images when asked, copying to the clipboard). Advanced shows the file's path, the
keys Marxy does not know (kept as they are) and the warnings from reading it. A config.toml that exists but cannot be read, or is not valid TOML, raises a notice with the reason at launch and every setting is at its default; a missing file says nothing.

### Optional features

Switches under Proposals (`packages/theme/src/proposals.ts`), each read when its feature acts:

| Switch | Default | Feature |
| --- | --- | --- |
| `minimap` | on | the file's shape as the scrollbar, in Source |
| `glance` | off | a click from a list opens a glance tab that the next glance replaces |
| `pairs` | on | two tabs kept as a pair |
| `drag` | on | drag a tab along the row |
| `inspector` | on | hold Alt to see what a character is |
| `paging` | on | Space turns the page |
| `notes_in_place` | on | margin notes beside the lines they belong to |
| `sets` | on | saved sets of tabs in Places |
| `compare_files` | on | Compare two files from the tab menu |
| `table_aids` | on | table aids |
| `log_zone` | on | log times in your own time zone |

## Menus and notices

- On macOS the native menu (Marxy, File, Edit, Format, View, Go, Window, Help) runs the same commands as
  the keys; items are disabled, never hidden, when their command cannot run. Windows and Linux have no
  menu bar: everything is in the Line, the keys and the in-app menus.
- In-app menus open from tabs, crumbs, the reading chip, panel heads, a row's verbs (Enter) and the page
  (right-click or Shift+F10).
- Notices sit at the foot of each pane, at most three at a time: Done (fades after 4 s), Not done and
  Note (stay until dismissed), Needs you (takes focus; used for unsaved-work questions, never a modal).
  Mod+Alt+N focuses the newest; Esc dismisses it. One event says one notice: opening an archive's entry,
  an attachment or a database's value says once what it is and that nothing was written.
