# Library and collections

Prototype: `05-collections.html`. Related screens: `01-workspace.html` (where files open), `04-palette.html` (the ⌘K palette, which lists every Library command), `08-settings.html` (library defaults).

## Purpose

The Library is where you point Marxy at folders and decide what it reads. Once a source is added, the Library is how you find, triage and tidy what is in it.

Marxy indexes source of any kind: Markdown, code, logs, data, plans, notes. The Library does not care who wrote a file; it is built around the problems any growing folder has:

- **Volume.** Folders fill up, often in bursts. The list has to stay dense and fast to scan, so it is made of rows, not cards.
- **Copies.** `v2`, `v3` and `copy` files pile up. The Library finds near-duplicates and offers to keep the newest.
- **Wrong paths.** Documents write paths relative to the repository they describe, not to where the file lands. Marxy checks every path a document mentions against a "path base" and flags the ones that do not exist.
- **Changes.** The Library shows which files have changed since you last read them.

## Anatomy

From top to bottom, inside the standard window (floating sidebar on the left, `Marxy.boot({ active })`):

1. **Toolbar.** Back and forward, the scope name and its path, then Add source, New smart collection, Index health (with an issue count), Search everything (⌘K), Theme, and the Preview pane toggle.
2. **Scope header.** For a collection: icon, name, watch state, and actions (Re-index, Pause watching, Settings, Reveal in Finder, Remove from library, More). Underneath: root path, file count, size, last indexed, the path base, and collection rules. For a library view or smart collection: name, description, file count, and the rule or query that defines it.
3. **Banner (when relevant).** Similarity threshold for near-duplicates, the path base for broken paths, indexing progress, or a "watching paused" warning.
4. **Filter bar.** The query field (with syntax help and completion), three facet menus (Kind, Status, Modified), Sort, Group, row density, and the column chooser.
5. **Query chips.** When a query is active, each token appears as a removable chip, with the match count and "Save as smart collection".
6. **Results.** A sortable column header, then one row per file. Rows can be grouped. Full-text matches show the matching lines underneath the row.
7. **Bulk action bar.** Floats over the bottom of the list once more than one file is selected, or one file is ticked.
8. **Preview pane.** On the right: rendered preview, Info and Outline tabs, and actions. Shows a selection summary when several files are selected.
9. **Status bar.** Item count, selection count, words (of the selection, or of everything shown), watcher state, index issues, theme.

## The scopes

Every view is a scope plus an optional query. The sidebar links straight to them by URL hash.

| Hash | Scope | Defined by |
|---|---|---|
| `#c=<id>` | A collection (`plans`, `projects`, `reading`, `notes`, `inbox`, or one you add) | The folder |
| `#view=all` | All files | Every collection |
| `#view=inbox` | Inbox | `in:inbox` |
| `#view=recent` | Recent | `is:recent`, sorted by last opened |
| `#view=pinned` | Pinned | `is:pinned` |
| `#view=changed` | Changed since you read | `is:changed`, newest first |
| `#smart=dupes` | Near-duplicates | `is:dup`, shown as groups |
| `#smart=broken` | Broken paths or links | `is:broken`, with the bad paths listed |
| `#add` | Opens Add source over the current scope | |
| `#health` | Opens Index health over the current scope | |

With no hash, the Library opens on Plans. Switching scope clears the query and the selection; sort, grouping, density, columns and the preview pane persist.

## Controls

### Toolbar

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Back, Forward | Move through scope history (each scope is a URL) | ⌘[ ⌘] | |
| Add source | Opens the Add source sheet | ⌥⌘O | Also the + beside Collections in the sidebar |
| New smart collection | Opens the rule builder, empty | | |
| Index health | Opens the health sheet; shows the number of open issues | | Same as the status bar issue count |
| Search everything | Opens the command palette | ⌘K | Library commands are listed under "Library" |
| Theme | Theme and type menu | | Shared |
| Preview pane | Shows or hides the preview pane | ⌥⌘I | Space on a focused row does the same |

### Collection header

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Watch chip | Menu: On change (FSEvents), On launch, Every 15 minutes, Manual; Pause watching | | Change takes effect at once, with Undo |
| Re-index | Re-reads changed files; shows progress in the header and status bar | ⇧⌘R in the app | Unchanged files are skipped by content hash |
| Pause watching / Resume watching | Stops picking up changes; a banner says so | | Changes queue and are applied on resume |
| Settings | Opens the collection settings sheet | | Same form as Add source |
| Reveal in Finder | Reveals the root folder | | |
| Remove from library | Confirmation dialog, then removes the collection | | Files on disk are never touched; Undo restores it |
| More | Copy path, Open in Terminal, Index health, New smart collection from this collection, Prototype states, Remove from library | | "Prototype states" exists only in the prototype |
| Root path | Copies the path | | |
| "Paths resolve against" | Menu of path bases, plus Choose folder | | Changes the base for the whole collection, with Undo |

The Inbox is a plain folder (`~/Inbox`). Its header swaps the collection actions for **Import files** (file picker). Its More menu offers Promote everything, Inbox settings, and Reveal Inbox folder.

### View and smart collection header

| Control | What it does | Notes |
|---|---|---|
| Edit rules | Opens the rule builder with this collection's rules | Built-ins are editable; the change is saved with Undo |
| Duplicate | Opens the builder pre-filled as a new collection | |
| Delete | Deletes a user smart collection | Built-ins cannot be deleted; Undo restores |
| Save as smart collection | For library views: opens the builder with the view's query plus the current filter | |
| Similarity slider (near-duplicates banner) | Sets the minimum similarity for a group, 60 to 99 percent | Default 85 |
| Keep newest in every group | Archives every older copy in every group | Undo |
| Change path base (broken banner) | Menu of path bases | |
| Resume (paused banner) | Resumes watching | |

### Filter bar

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Query field | Filters as you type; see Query syntax | ⌘F or / | Enter or ↓ moves into the list and selects the first result; Esc clears, then returns focus to the list |
| Completion list | Suggests keys after a word, values after `key:`, with counts | Tab accepts; ↑ ↓ move | Values come from what is in the current scope |
| Syntax help (?) | Menu of example tokens; clicking one inserts it. Links to this document | | |
| Kind, Status, Modified | Facet menus with counts that follow the rest of the query | | Ticking several values writes `key:a,b` (any of). Modified is single choice |
| Sort | Relevance (only while searching text), Modified, Name, Words, Kind, Path, Size, Last opened; Ascending or Descending | | Relevance is chosen automatically when you start typing words, until you pick another sort |
| Group | None, Folder, Kind, Day, Collection | | |
| Density | Compact (one line) or Comfortable (path under the title) | | |
| Columns | Path, Kind, Words, Size, Modified, Status; Reset | | When the list is narrow, low-priority columns hide first: size, kind, words, path. The menu marks them "hidden: too narrow" |

### Query chips

| Control | What it does |
|---|---|
| Chip × | Removes that token from the query |
| Save as smart collection | Opens the builder with the scope's rule plus the query |
| Clear | Clears the query |

Chips show negation ("not"), unknown keys (amber: searched as plain text), and incomplete values (amber: ignored).

### Results

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Select-all checkbox | Selects or clears every visible row; shows a mixed state | ⌘A | |
| Column header | Sorts by that column; click again to reverse | | |
| Row click | Selects the row, shows it in the preview | | |
| ⌘-click | Adds or removes a row | | Ctrl on other platforms |
| Shift-click | Selects the range from the last anchor | | Add ⌘ to extend instead of replace |
| Row checkbox | Ticks the row without clearing others; shows the bulk bar | x | |
| Double-click | Opens the file in the workspace | Enter | ⌥ opens in a new tab |
| Snippet line | Selects the file and scrolls the preview to that line | | |
| Row ⋯ / right-click | Row menu | ⇧F10 or the context-menu key | |
| Group header chevron | Collapses or expands the group | | Collapsed rows are skipped by the keyboard |
| Group "Select" | Selects every file in the group | | |
| Dupe group: Compare, Keep newest, Merge | See Duplicates | | |
| Broken path: Find file, Resolve against, Ignore | See Broken paths | | |
| Inbox row: Promote, Delete | Moves the file into a collection, or to the Trash | | Both have Undo |

Each row carries, as columns: a kind icon, the title (bold when unread), the path relative to the collection, a kind badge, words, size, modified, and status marks. Status marks are always an icon with a tooltip and screen-reader text, never colour alone:

| Mark | Meaning |
|---|---|
| Accent dot | Unread since it last changed |
| Compare arrows | Changed since you last read it |
| Two sheets | Near-duplicate of another file |
| Broken link | Mentions paths or links that do not resolve |
| Warning triangle | Index problem, such as too large to index content |
| Pin | Pinned |
| Archive box | Archived (only visible with `is:archived`) |

### Row menu

Open, Open in new tab, Preview, Open in default editor (⇧⌘E), Reveal in Finder (⌥⌘R), Copy path (⌥⌘C), Copy as (every shared copy format), Pin or Unpin, Mark read or unread (⇧⌘U), Move to (collections and folders), Treat as (content type), Compare with its near-duplicate, Compare the two (when two are selected), Merge (when several are selected), Fix missing paths (find, resolve against, ignore), Archive (⌘⌫), Remove from index. With several rows selected, the menu acts on all of them.

### Bulk action bar

| Control | What it does | Shortcut |
|---|---|---|
| Count, × | Shows how many are selected; clears the selection | Esc |
| Open | Opens the selection in the workspace | Enter |
| Tabs | Opens each file in its own tab | ⌥Enter |
| Merge | Opens the merge sheet (two or more) | |
| Compare | Opens the diff (exactly two; disabled otherwise, with a tooltip saying why) | |
| Export | Markdown files (.zip), one combined Markdown file, PDF per file, single PDF with contents, HTML bundle; Copy JSON manifest, paths, or Markdown links | |
| Move | Collections and folders | |
| Mark read / unread | Toggles, depending on whether any are unread | ⇧⌘U |
| Archive | Archives the selection | ⌘⌫ |
| More | Pin or unpin, Treat as, Copy paths, Reveal in Finder, Save selection as smart collection, Remove from index | |

Labels collapse to icons when the list is narrow; every button keeps an accessible name and a tooltip.

### Preview pane

| Control | What it does |
|---|---|
| Open | Opens the file in the workspace |
| Copy as | Shared copy menu, with the file as the source |
| Reveal in Finder | Reveals the file |
| More | The row menu |
| Preview tab | The file rendered exactly as the workspace renders it, per content type, at a slightly smaller size |
| Info tab | Content type and why it was detected, modified date, status and where it was dropped from (Inbox), measures (words, size, lines, code blocks, links), every path the file mentions with found, missing or ignored, near-duplicates with Compare, and index facts (full text or metadata, snapshots) |
| Outline tab | Headings with line numbers and word counts; clicking one jumps to it in the Preview tab; copy outline |

With several files selected, the pane shows a summary instead: count, words, collections, and the list of files (click one to select only it). Actions: Open in tabs, Compare (two), Merge.

### Status bar

Items shown, "N selected", words of the selection (or of everything shown), the watcher state for this scope, index issues (opens Index health), theme.

## Query syntax

Plain words search titles, paths and full text. Tokens combine with AND. `OR` (upper case) separates alternatives. A leading `-` excludes. Commas inside a value mean "any of". Quotes make a phrase.

| Token | Matches | Examples |
|---|---|---|
| `kind:` | Content type, by id or name prefix | `kind:report`, `kind:trans`, `kind:report,transcript` |
| `is:` | Status | `unread`, `read`, `changed`, `pinned`, `dup`, `broken`, `archived`, `recent`, `error`, `captured` |
| `has:` | Contents | `code`, `paths`, `links` (`has:tasks` still parses; nothing suggests it) |
| `modified:` | Age | `today`, `yesterday`, `<2h`, `<7d`, `<4w`, `>30d`, `<3mo` |
| `words:` | Word count | `>1000`, `<300`, `>=2k` |
| `tasks:` | Open task count (still parses; not suggested, not a column or a sort) | `>0`, `>5`, `0` |
| `size:` | File size | `>1mb`, `<10kb` |
| `path:` | Path contains | `path:plans/`, `path:handoffs` |
| `in:` | Collection, by id or name | `in:plans`, `in:notes` |
| `"…"` | Exact phrase in the text | `"pg_upgrade --link"` |
| `-token` | Excludes | `-kind:code`, `-is:archived` |
| `A OR B` | Either group | `is:unread OR is:changed` |

Units: `min`/`m`, `h`, `d`, `w`, `mo`, `y` for ages; `k`, `kb`, `mb` for counts and sizes. A token with an unknown key is searched as text and shown in amber. A token with an incomplete value (`words:>`) filters nothing until it is complete, so the list does not empty out while you type.

When a query contains words, rows are ranked by relevance (title hits first, then path and body), and each row shows up to three matching lines with line numbers and the terms highlighted. That is the "why it matched" answer. A short fuzzy match on the title also counts, so `pgupg` finds the upgrade plan.

## Add source

The Add source sheet has the form on the left and an updating dry run on the right. Nothing is written until you press **Add and index**.

| Option | Default | Why |
|---|---|---|
| Source type: Folder, Git repository, Notes vault, Single file, iCloud folder | Folder | Each type sets sensible defaults: a repository respects `.gitignore` and includes code and data; a vault excludes `.obsidian` and `.trash` and treats files as Notes; iCloud uses a timer instead of change events |
| Folder or file | none | Chosen with the macOS open panel. Marxy keeps a security-scoped bookmark so access survives restarts |
| Name, icon | From the folder | Shown in the sidebar |
| Include | `**/*` | Globs, one per line or comma-separated. `plans/**` limits the index to one folder |
| Exclude | `indexExclude` (`node_modules, .git, dist, target`) | Keeps dependency trees and build output out of search |
| File types | `.md`, `.mdx`, `.markdown`, `.txt` on; Code and Data off (on for repositories) | Markdown is the point; code and data are opt-in so a repository does not drown its docs |
| Treat as | Detect per file | The fallback content type when detection is unsure. Per-folder rules in the workspace override it |
| Resolve paths against | The source folder (a repository: itself) | Documents write paths relative to the repository they describe. This is where Marxy looks those paths up |
| Pick up changes | On change (FSEvents); iCloud: every 15 minutes | iCloud can deliver change events late |
| Index | Content and metadata (`indexContent`) | Metadata only keeps the index small for very large trees |
| Respect .gitignore | On for repositories | Generated files are rarely worth reading |
| Include hidden files | Off (`indexHidden`) | Dotfiles are usually tool state |
| Follow symbolic links | Off | A link to a large shared folder can quietly double the index |
| Keep a snapshot on every change | On | Powers version diffs in the workspace; 30 days or 50 revisions per file |
| Largest file | 8 MB (`indexMaxMb`) | Bigger files are listed with metadata only and opened on request |

**Dry run.** A sentence such as "Will index 214 files, 9.7 MB; skip 12: 3 too large, 9 binary", a bar of file types with a legend, the top folders, every skipped file with its reason and a one-click fix (Raise limit to N MB, Include hidden, Ignore .gitignore, Follow, Read as Windows-1252, Grant access, Download), and what your exclude rules removed. It updates as you change any option. If the folder is already in the library, a warning says so.

**Settings** for an existing collection use the same form. The dry run then shows the difference ("+3 files on the next re-index"), and saving a change that affects what is indexed starts a re-index. The footer offers Remove from library.

**Dropping a folder** on the window opens Add source with it filled in. Dropping files adds them to the Inbox.

## Indexing and watching

- **Triggers.** A file is re-indexed when the watcher reports a change, when you press Re-index, when Marxy launches (for "On launch" sources), on the timer (for "Every 15 minutes"), or when a collection's settings change what is included.
- **Debounce.** Watching coalesces events per file and re-indexes 250 ms after the last one. A file saved in quick succession is indexed once per pause, not once per save, and an editor that saves through a temporary file causes one re-index, not three.
- **Skip work.** Each file is keyed by size, modification time and content hash. If the hash is unchanged, parsing, highlighting and path checks are skipped.
- **Order.** Text is indexed first so search works early. Path checks and duplicate detection run after, and their marks appear when they finish.
- **Snapshots.** When a watched file changes, the previous version is stored as a compressed snapshot. Snapshots power "changed since you last read it" and the workspace's version diff. They are pruned after 30 days or 50 revisions; Index health can compact them.
- **Rescans.** If the operating system reports that events were dropped or coalesced (after sleep, for example), Marxy schedules a rescan of that root and lists it in Index health until it finishes.
- **Pausing** stops the watcher for that collection. Changes queue and are applied on resume.

**Index health** lists every collection (files, size, last run, how it watches, issues, Re-index) and every issue with its fix:

| Issue | Example | Fixes |
|---|---|---|
| Too large | A 14.2 MB transcript export, limit 8 MB | Raise the limit, or exclude the file |
| Binary | Images saved with `.md` extensions | Exclude the folder |
| Permission denied | A folder moved after access was granted | Grant access again (open panel) |
| Unreadable encoding | Not UTF-8; looks like Windows-1252 | Read with that encoding, or skip |
| Watcher | The OS asked for a full rescan | Rescan now |

Every fix has Undo. **Rebuild index** builds a fresh index while the old one stays in use, then swaps. **Compact snapshots** prunes old revisions.

## Smart collections

A smart collection is a saved set of rules. Every rule maps one-to-one onto a query token, so the builder and the search field can express the same things, and the builder shows the equivalent query as you edit.

- **Fields:** Content type, Path, Collection, Modified (within the last, more than), Words, Status, Has, Text.
- **Match:** All rules (AND) or Any rule (OR).
- **Running count:** "Matches 19 files in 2 collections", with the first matches listed.
- **Show in library** runs the query in All files without saving. **Save** adds the collection to the sidebar and opens it.

Built-ins:

| Name | Rule |
|---|---|
| Near-duplicates | `is:dup`, shown as groups, with a similarity threshold |
| Broken paths or links | `is:broken`, with the bad paths listed under each file |

Built-ins can be edited and duplicated but not deleted.

## Duplicates

Files get rewritten instead of edited, so folders fill with `plan.md`, `plan.v2.md` and `plan (copy).md`. The near-duplicates view groups files whose text overlaps by at least the threshold (default 85 percent), newest first.

- Each group header shows the shared title, the number of files and the lowest similarity in the group.
- The newest file carries a "Newest" badge; each older file shows its similarity to the newest.
- **Compare** opens a line diff of the newest against an older copy: unified or side by side, unchanged runs folded, with Swap, Copy diff, Merge, and Keep older or Keep newer (archiving the other).
- **Keep newest, archive others** archives every older copy in the group. The banner's **Keep newest in every group** does it for all groups. Both have Undo.
- **Merge** opens the merge sheet with the group in order.

The prototype measures similarity as the share of identical non-blank lines. The app should use a shingle-based measure (see Implementation).

## Broken paths

Documents name files: "see `migrations/2026_10_drop_regproc.sql`". Marxy extracts every backticked path and every relative link target, and checks it against the file's path base: the collection's "Resolve paths against" folder, or a per-file override. Paths that start with `~/` are checked against the library.

The broken view lists each affected file with its missing paths underneath, each with its line number and three actions:

- **Find file** searches the known path bases. If it finds an exact match, it offers to resolve this file against that base.
- **Resolve against…** sets a per-file path base. This is common: a plans folder collects documents written from several repositories.
- **Ignore** stops flagging that path in that file (for example, a file the document says it deleted).

**Change path base** in the banner and header changes the base for the whole collection. Every change has Undo.

## Inbox

The Inbox is a plain folder (`~/Inbox`) for things that do not belong anywhere yet: files you drop on the window or import with **Import files**. Text types only (`.md`, `.mdx`, `.markdown`, `.txt`, `.csv`, `.tsv`, `.json`, `.yaml`); other files are refused with a message.

Rows show the source ("Dropped · Finder") instead of a path. Each row has **Promote** (move into a collection; the file becomes an ordinary file there) and **Delete** (moves to the Trash). Both have Undo.

## Bulk actions

All bulk actions act on the selection, have Undo where they change anything, and report what they did in a toast.

### Merge

Combines two or more files into one new document. Options: title; order (move files up and down; earlier files win when paragraphs repeat); headings (nest each file under its title, or keep as written); a source note under each heading; remove repeated paragraphs (reports how many); combined front matter listing `merged_from`; where to save (collection and path); and whether to archive the originals. The preview is rendered or source. **Create file** adds the new file to the collection and selects it, with Undo.

### Compare

Exactly two files with text. Unified or side-by-side line diff, older on the left, unchanged runs folded, with counts of added and removed lines and the similarity. Swap, Copy diff, Merge, and keep one and archive the other.

### Others

**Open** opens in the workspace; **Tabs** opens each in a tab. **Export** writes files or copies a JSON manifest, paths or Markdown links. **Move** moves files between collections or folders and updates links to them. **Mark read / unread**. **Archive** moves files to an `.archive/` folder beside them; they leave every view except `is:archived`. **Remove from index** keeps the files on disk and adds them to the collection's exclude list.

## States

| State | When | What it shows |
|---|---|---|
| Nothing matches | A query excludes everything | The query, a button to remove each of the last three tokens, Search all files, Clear filter |
| Empty collection | No file matches the include rules | Edit include rules, Re-index |
| Empty Inbox | No files | Import files |
| Empty smart collection | Nothing matches the rules | The collection's description |
| No near-duplicates | Nothing above the threshold | Suggests lowering it |
| Every path resolves | No broken paths | Reassurance |
| Indexing, first run | A new source with nothing indexed yet | Progress bar, current file, count, Cancel, skeleton rows |
| Indexing, partial | Some files indexed | Rows appear as they are indexed; a banner shows progress; skeleton rows at the end |
| Re-indexing | Re-index pressed | Progress in the header bar and the status bar; the list stays usable |
| Folder missing | The root cannot be read | Locate folder, Show cached index, Remove from library |
| Paused | Watching paused | Banner with Resume |
| Preview, nothing selected | No active row | How to preview and open |

The prototype's collection More menu has "Prototype: show state" to show the first-run, missing-folder and empty states on demand.

## Keyboard

| Keys | Action |
|---|---|
| ↑ ↓ | Move the focused row; in single selection, the selection follows |
| Shift ↑ ↓ | Extend the selection |
| Home, End, Page Up, Page Down | Jump |
| x | Tick or untick the focused row (multi-select without the mouse); arrows then move without changing the selection |
| Space | Toggle the preview pane |
| Enter | Open the focused file, or the selection in tabs |
| ⌥Enter | Open in a new tab |
| ⌘↓ | Open the focused file |
| ⌘A | Select all visible rows |
| Esc | Clear the selection; in the query field, close suggestions, then clear, then return to the list |
| ⌘⌫ | Archive the selection (or the focused row) |
| ⇧⌘U | Mark read or unread |
| ⇧F10, context-menu key | Row menu |
| ⌘F, / | Focus the query field |
| Tab (in the query field) | Accept the suggestion |
| ⌥⌘I | Toggle the preview pane |
| ⌥⌘O | Add source |
| ⌘[ ⌘] | Back, forward |
| ⌘K | Command palette (every Library command is listed) |
| ← → (preview tabs) | Switch between Preview, Info and Outline |

From an empty focus, ↑ ↓ (or j k) move focus into the list.

## Accessibility

- The list is a `listbox` with `aria-multiselectable`; rows are `option`s with `aria-selected` and a concise `aria-label` (title, kind, modified, unread). Focus stays on the list and moves with `aria-activedescendant`, so there is one tab stop for the whole list. The focused row has a visible outline once you use the keyboard.
- Row checkboxes and row buttons are not in the tab order; everything they do is in the row menu and the bulk bar, both keyboard reachable.
- Group headers label their `group`; the collapse button has `aria-expanded`.
- The query field is a `combobox` with `aria-expanded`, `aria-controls` and `aria-activedescendant` into the suggestion `listbox`.
- Sheets are modal dialogs with a label, trap focus, close on Esc, and return focus to where it came from. Radio groups (source type, match) have roving focus with arrow keys.
- Status marks are icons with tooltips and screen-reader text; colour is never the only signal. Similarity also shows a number.
- Counts that change (dry run, match count, selection count, indexing progress) are in polite live regions.
- All colours come from theme tokens, so the page follows the eight themes including both high-contrast themes. Motion respects Reduce Motion through the shared stylesheet.
- When the list is narrow, columns hide by priority rather than truncating everything; the column menu says which are hidden and why. Button labels collapse to icons but keep their accessible names.

## Settings it binds to

From `G.prefDefaults` (Settings › Library and related panes in `08-settings.html`):

| Key | Default | Used for |
|---|---|---|
| `indexExclude` | `node_modules, .git, dist, target` | Default Exclude in Add source |
| `indexMaxMb` | 8 | Default Largest file |
| `indexHidden` | false | Default Include hidden files |
| `indexContent` | true | Default Index mode (content and metadata) |
| `checkPaths` | true | Path verification in the preview and the broken-paths view |
| `scale`, `typeset`, `theme` | | The preview re-renders when they change |

The prototype keeps its own view state (sort, direction, grouping, density, columns, preview pane, preview tab) under `marxy.lib.ui`, and user smart collections under `marxy.lib.smart`. In the app these belong in the preferences store as `libSort`, `libGroup`, `libDensity`, `libColumns`, `libPreview`, and in the index database for smart collections.

## Implementation notes (Tauri, macOS first)

These are design-level suggestions; check each crate's current API and maintenance before committing to it.

- **Watching.** The `notify` crate uses FSEvents on macOS. Use one of its debouncers (`notify-debouncer-full` or `notify-debouncer-mini`) for per-file coalescing at about 250 ms. FSEvents can tell you to rescan a subtree when events were coalesced or dropped (the `MustScanSubDirs` flag); `notify` surfaces this as a rescan hint. Treat it as "rescan this root" and show it in Index health. Change events for iCloud Drive folders can arrive late, which is why iCloud sources default to a timer.
- **Walking.** The `ignore` crate (from ripgrep) handles `.gitignore`, hidden files, symlink following and parallel walking; `globset` handles include and exclude globs.
- **Reading.** Detect binary files the way git does: a NUL byte in the first 8 KB. Detect encodings with `chardetng` and decode with `encoding_rs`. Hash content with a fast hash (BLAKE3 or xxHash) to skip unchanged files.
- **Full text.** `tantivy` for the text index: BM25 ranking, phrase queries (index positions), and `SnippetGenerator` for the "why it matched" lines. Keep line offsets so snippets can show line numbers. Run the index writer on a background thread and commit in batches, so search stays responsive during indexing.
- **Metadata.** SQLite (through `rusqlite` or `sqlx`) in WAL mode for everything that is not full text: paths, sizes, hashes, front matter, kind, task counts, statuses, path checks, duplicate groups, smart collection definitions and snapshot records. Facet counts are cheap `GROUP BY` queries over the filtered id set.
- **Query language.** Parse in Rust into a small AST (AND, OR, NOT, field terms, text terms). Field terms become SQL predicates; text terms become a tantivy query; intersect the id sets. The same parser serves the search field, smart collections and the palette.
- **Near-duplicates.** MinHash over word shingles (about five words), with locality-sensitive hashing to find candidate pairs, then an exact measure on candidates. Recompute only for changed files.
- **Path checks.** Extract paths during indexing; re-check when the path base changes or when files appear or disappear under a base. Store per-file overrides.
- **Snapshots.** Compressed copies (for example with `zstd`) in Application Support, keyed by path and hash, pruned by age and count.
- **Folder access.** A sandboxed app (required for the Mac App Store, optional for Developer ID distribution) needs the user-selected files entitlement and security-scoped bookmarks: create the bookmark from the URL the open panel returns, store it, resolve it at launch, and call `startAccessingSecurityScopedResource` before reading. Tauri does not do this out of the box as far as we know; it needs a small native bridge (for example with the `objc2` family of crates) or a community plugin, if a maintained one exists. A stale bookmark is the "Permission denied" issue in Index health.
- **Drops.** Tauri's window drag-and-drop events deliver dropped file and folder paths.
- **Undo.** Keep an undo stack of reversible operations (archive is a move, remove-from-index is an exclude rule). Never delete files; Delete in the Inbox moves to the Trash.

## Open questions

1. Should the preview pane share the workspace inspector's preference (`inspector`, now `auto`), or keep its own? They are different panes, but users may expect one "right pane" setting.
2. Archive location: an `.archive/` folder beside each file, one archive folder per collection, or a Marxy-managed archive? Beside-the-file is easiest to find in Finder but clutters plan folders.
3. Similarity threshold: one global default, or per collection? Transcripts overlap naturally and may need a higher threshold.
4. Should "Unread since it last changed" reset on preview, or only on opening the file in the workspace?
5. Path base inference: could Marxy read the repository from a document's front matter (`cwd:`, `repo:`) and set per-file bases automatically?
6. How should a collection behave when its root is on a volume that is sometimes unmounted: an error state, or a quieter "offline" state with the cached index?
7. Re-index shortcut: ⇧⌘R is free in the app but reserved by browsers, so the prototype does not bind it.

## Related prototypes

- `01-workspace.html`: opening files, the reading surface, version diffs, the inspector.
- `04-palette.html`: the command palette; `~` lists collections, and every Library command appears under "Library".
- `08-settings.html`: Library defaults (`indexExclude`, `indexMaxMb`, `indexHidden`, `indexContent`).

## Sidebar (shared engine)

The sidebar on this page is the shared one: a foldable **Recent** list (the last eight documents opened, its state remembered), **Library** views (Pinned, Changed since you read), **Repositories** (name, branch glyph, a quiet count of files changed since you read when above zero) and **Folders**. Every repository and folder opens inline as a tree, to any depth, with children made as each folder opens; the arrow keys collapse and expand (← →) and move (↑ ↓), and right-click offers New file here. Clicking a repository or folder here also opens it in the list. Source kinds use the custom glyph set; code files tint their glyph with the language colour.
