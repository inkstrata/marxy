# Marxy Clipboard Studio

**Descoped for now.** Good ideas, too much scope; copying lives in the reading and source views instead (⌘C, ⇧⌘C Copy as, a copy button on every block, Copy file in the source header). This page and spec are kept for reference.

Companion spec for `06-clipboard.html`. Related prototypes: [01-workspace.html](01-workspace.html) (where most copies start), [08-settings.html](08-settings.html) (Settings › Clipboard holds the same preferences), [09-macos.html](09-macos.html) (menu bar extra, Services, Shortcuts, global hotkeys).

## Purpose

Marxy is a reader for source of any kind. Much of what it shows is read once and then moved somewhere else: into Slack, a Jira ticket, a document, an email. The Clipboard Studio is where that move happens deliberately. It brings five things together:

1. **History.** Everything copied on the Mac, with its source, type and age, searchable and filterable. Anything private is left out.
2. **Workbench.** Text from a clip, a document, a snippet or a paste, run through an ordered **pipeline** of transforms, with a live result, a diff and the size change.
3. **Copy targets.** Every copy format previewed live against the result, each writing the right pasteboard types for the app it targets.
4. **Saved pipelines.** Named pipelines that run on the clipboard from a global shortcut, the Services menu, the Shortcuts app or the menu bar, with no window open.
5. **Compare, Collect, Snippets and the Ring.** A side-by-side diff of any two texts, a stack for gathering pieces, reusable text with placeholders, and a floating clipboard ring (⌥⌘V) usable over any app.

Open it with ⇧⌘V or from the menu bar extra. Other pages link to `06-clipboard.html#pipelines`.

## Anatomy

| Region | Width | Contents, top to bottom |
|---|---|---|
| Sidebar | 252 | Shared Marxy sidebar: library, collections, collection tree |
| Toolbar | full | Title and subtitle; Pipeline, Compare; Paste in, Run, History menu; Collect, Ring, Rules, Keyboard map, Theme, Side panel |
| History | 290 | Header (count, Select several, Preview pane, menu); search; type chips; From filter; clip rows (Pinned, then Last hour, Today, Yesterday, Earlier, with "Not recorded" rows); selection bar; preview pane; privacy policy line |
| Workbench | flexible | Input (source chip, stats, editor); resize handle; then by mode: Pipeline (steps, then Output with Before/After/Diff/Rendered, stats, body, Copy, Copy as, Replace clipboard, As input, Send to) or Compare (pickers, side-by-side diff; input hidden) |
| Side panel | 312 | Tabs: Copy as (one row per format: live preview and pasteboard types), Pipelines (#pipelines: list and detail with shortcut, input, result, Services, Shortcuts, menu bar), Stack (items, separator, copy), Snippets (list and editor) |
| Status bar | full | Recording, clips and pins, not recorded today, pipeline and steps, stack, ring shortcut, theme, text size |

- Under 1100 px wide the side panel becomes an overlay and starts closed; toolbar labels and the title collapse to icons.
- Compare mode hides the input editor so the two columns get the full height.
- The input height is user-resizable (drag, ↑ ↓ on the handle, double-click resets) and remembered.

## Controls

Every control below works in the prototype unless the Notes column says otherwise. "Toast" means the prototype states what the app does instead of doing it.

### Toolbar

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Pipeline / Compare | Switches the workbench mode | ⌥⌘1, ⌥⌘2 | The subtitle changes to describe the mode |
| Paste in | Loads the system clipboard into the input | none | The browser may refuse to read the clipboard; the prototype then loads the newest history item and says so. The app reads NSPasteboard directly |
| Run (play) | Runs the builder's pipeline on the clipboard, copies the result, and offers Review | ⌘R | Review loads the before-text and the pipeline into the workbench |
| History menu | Pause recording (5 min, 1 hour, until resumed), Ignore the next copy, Select several, Preview pane, Clear unpinned, Clear everything, Clipboard rules, History in Settings | none | Pause flips `clipHistory` off with a resume time. Clears offer Undo for 10 s |
| Collect | Toggles collect mode; the button shows the stack size | ⌥⌘K | Shared `G.stack.toggle()` |
| Ring | Opens the clipboard ring mock | ⌥⌘V | Global in the app |
| Rules | Opens the Clipboard rules sheet | ⌥⌘R | |
| Keyboard map | Opens the studio keyboard map | ⌘? | Also `?` when focus is not in a field |
| Theme | Theme and type menu | none | Shared |
| Side panel | Shows or hides the right panel | ⌥⌘I | Same key as the Workspace inspector |

### History column

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Search field | Filters by text, source title and path, app name and recognised image text; highlights the match in the row (shows the matching line, not just the first) | ⌘F | Query terms: `app:Safari`, `type:code`, `is:pinned`, `is:replaced`, `from:handoff` |
| Clear search (x) | Empties the search | esc in the field | |
| Type chips | All, Pinned, Markdown, Code, URL, Plain, Images, each with a live count | none | Counts respect the From filter, not the search |
| From | Any app, Marxy, Other apps | none | Combines with the type chip (AND) |
| Select several | Shows checkboxes on every row | none | ⌘-click and ⇧-click also select |
| Preview pane toggle | Shows or hides the preview pane | Space in the list | Remembered |
| History menu (…) | Same as the toolbar History menu | none | |
| Row | Click: focus it. Double-click: load into the workbench. ⌘-click: toggle selection. ⇧-click: range. Right-click: row menu | ↑ ↓ Home End, ↵ load | Listbox with `aria-activedescendant`; pinned rows first, then Last hour, Today, Yesterday, Earlier |
| Row checkbox | Toggles selection | none | Visible on hover, when selected, or in Select several mode |
| Row: Copy | Puts the clip on the clipboard and moves it to the top, keeping its pin and source app | ⌘C | Stacks instead when collecting |
| Row: Paste into workbench | Loads the clip as the input | ↵ | For an image, loads its recognised text |
| Row: Pin / Unpin | Pins; pinned clips never expire and do not count toward the limit | ⌥P | |
| Row: More | Copy, Copy as (every format), Paste into the workbench, Insert at the input caret, Run a saved pipeline on it, Add to the stack, Compare with the input, Save as a snippet, Pin, Open the source document, Delete | ⇧F10 or the context-menu key | Open source goes to the Workspace at the document and line |
| Delete | Removes the clip, with Undo | ⌫ | Removes all selected when several are selected |
| Type to search | Any printable key in the list jumps to the search field | | |
| "Not recorded" rows | Show that a copy was skipped: app, reason, time. Never the content | | Only under All, with no search |
| Selection bar: Merge | Into the workbench oldest first or newest first, as a bullet list, with rules between, Copy merged, Save merged as a new clip | ⇧↵ (oldest first) | Images are skipped |
| Selection bar: Compare | Opens Compare with the two selected clips, oldest on the left | none | Enabled for exactly two |
| Selection bar: Stack, Pin, Delete, Clear | As named | esc clears | |
| Preview: source link | Opens the source document at its line | none | Shown when the clip came from a Marxy document |
| Preview: Show original / Restore | For clips replaced by a pipeline result: view the original, or keep it instead | none | Restore has Undo |
| Preview: Strip | Removes tracking parameters from a link clip and puts the clean link on the clipboard | none | Shown when a link has utm_*, fbclid and similar |
| Preview: Use the text | Loads the text recognised in an image | none | |
| Policy line: Rules / Resume | Opens rules; resumes recording when paused | none | |

### Workbench: input

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Source chip | Shows where the input came from; opens the Load menu: Current clipboard, Selected clip, Selected clips merged, Marxy document ▸, Snippet ▸, Collect stack, Pipeline output (chain), two samples, Open a file… | none | Open a file is a toast |
| Stats | Characters, words, lines | | Live |
| Paste the clipboard in | Same as toolbar Paste in | none | |
| Undo | Editor undo | ⌘Z | |
| Soft wrap | Wraps long lines in the editor | none | On by default here |
| Clear | Empties the input, with Undo | none | |
| Editor | Markdown source editor with highlighting and line numbers (`G.Editor`) | ⇥ expands a snippet abbreviation; ⌘↵ copies the output; ⌥⌘↵ replaces the clipboard | ⌘↵ is taken over from the editor's task toggle on purpose |
| Resize handle | Changes the input height | ↑ ↓ when focused; double-click resets | |

### Workbench: pipeline

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Pipeline name | The loaded pipeline, marked "edited" after a change | | |
| Add step | Searchable picker grouped Clean, Convert, Lines, Case, Extract, with a live preview of that step applied to the current output and the size change | ⇧⌘A; in the picker ↑ ↓, ↵ adds, ⌥↵ adds and stays open | Marks steps already in use |
| Load saved | Menu of saved pipelines plus Manage pipelines… | none | |
| Save | Updates the loaded saved pipeline; skipped steps are left out and the toast says so | ⌘S | With nothing loaded, behaves as Save as |
| Save as | Names and saves a new pipeline, then opens it in the Pipelines tab | ⇧⌘S | |
| Remove every step | Clears the pipeline, with Undo | none | |
| Step row: grip | Drag to reorder; an accent line shows the drop point | ⌥↑ ⌥↓ on the focused row | |
| Step row: number, icon, name, group | Identify the step; hover the name for its description | | |
| Step row: size change | Characters removed (green) or added; hover for chars and run time | | "error" with the message when a step throws; "empty result" and "no change" are flagged |
| Step row: switch | Runs or skips the step without removing it | ⌘E | Skipped steps pass text through |
| Step row: eye | Shows the output after this step; Before becomes that step's input | ↵ or Space on the row | A banner offers "Show the final output" |
| Step row: up, down | Move one place | ⌥↑ ⌥↓ | |
| Step row: remove | Removes the step, with Undo | ⌫ | |
| Add a step… (row) | Same as Add step | | Empty pipeline shows three quick starts (Remove bold, Markdown → Slack, Markdown → Jira wiki) |

### Workbench: output

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Before / After / Diff / Rendered | Input text, result, unified line diff with three lines of context and folded unchanged runs, or the result rendered as Markdown | ⌘D cycles | Remembered |
| Stats | Chars before and after, chars saved and percentage, lines, run time | | |
| Copy | Copies the result, recorded in history under the pipeline name | ⌘↵ | |
| Copy as | Shared copy menu for the result | none | Includes Collect mode |
| Replace clipboard | Writes the result and updates the newest history item in place instead of adding one; keeps the original for Show original | ⌥⌘↵ | Undo restores both the clipboard and the item |
| As input | The result becomes the input, for chaining | ⌘U | Toast offers Clear steps |
| Send to | A new document (⌥⌘N), the Marxy Inbox, Write back to the source file (only when the input is a document), the collect stack, a new snippet, Compare with the input, Share…, Save as a file… | none | New document, Inbox, Write back, Share and Save are toasts. Write back asks first and snapshots the old version |

### Workbench: Compare

| Control | What it does | Shortcut | Notes |
|---|---|---|---|
| Left, Right | Workbench input or output, any of the last 40 text clips, any document, or an earlier document revision | | |
| Ignore whitespace, Ignore case | Normalise lines before matching | | |
| Side-by-side diff | Line diff with word-level highlights inside changed pairs; unchanged runs over 8 lines fold to "N unchanged lines · show" | | |
| Swap | Swaps the sides | | |
| Copy diff | Copies a unified diff with `---` and `+++` headers | | |
| Right as input | Loads the right side into the workbench | | |

### Side panel: Copy as

| Control | What it does | Notes |
|---|---|---|
| Copy from | Output or Input | |
| Name source | With every format, Never (`nameSource`, a page-local rule) | "With every format" appends a Source line to every format except Quote and JSON string |
| Format row | Name, shortcut in the Workspace, target apps, live preview, pasteboard types | Rich text previews as rendered HTML |
| Star | Makes the format the default for ⌘C everywhere in Marxy (`copyDefault`) | |
| Expand | Shows the full preview | Clicking the preview also expands it |
| Copy | Copies in that format | Real: text/plain, plus text/html for rich text |

### Side panel: Pipelines (`#pipelines`)

| Control | What it does | Notes |
|---|---|---|
| From builder | Save the builder's pipeline as a new saved pipeline | ⇧⌘S |
| Row | Click or ↵ expands the detail; ↑ ↓ move between rows; ⌘↵ runs; ⌫ deletes | Shows the step chain, the shortcut and "in builder" |
| Row: Run | Runs on the clipboard and copies the result; counts the use | Uses the clip's own source for the `{{path}}` placeholder |
| Row: More | Run, Edit in the builder, Rename…, Duplicate, Assign a shortcut…, Copy as JSON, Delete (with Undo) | |
| Detail: Name | Renames on change | |
| Detail: steps | Read-only list; Edit in the builder loads it | |
| Detail: Global shortcut | Click, then press keys; esc keeps the old one; ⌫ clears; needs ⌘, ⌃ or ⌥ | Warns on a clash with another pipeline or a reserved key (⌥⌘V, ⌃⌥Space, ⌥⇧⌘V, ⇧⌘V, ⌥⌘K, ⌘C, ⌘V, ⌘Space, ⇧⌘3/4/5) |
| Detail: Input | The clipboard, Selected text in the front app, Prompt each time | |
| Detail: Result | Replace the clipboard, Paste into the front app, Preview in the ring first, Save to Inbox | |
| Detail: Services menu, Shortcuts app, Menu bar extra | Where this pipeline appears | See Pipelines below |
| Where pipelines appear | Global switches: Services menu (`servicesMenu`), Shortcuts app, Menu bar extra (`menubarExtra`) | |
| Add to Shortcuts… | Toast: opens Shortcuts with a prepared "Run Marxy pipeline" shortcut | |
| Copy all as JSON / Import from clipboard | Real export and import; unknown step ids are dropped and listed; shortcuts are not imported | |

### Side panel: Stack

| Control | What it does | Notes |
|---|---|---|
| Start collecting / Stop | Toggles collect mode | ⌥⌘K |
| Item row | Drag, ⌥↑ ⌥↓, up and down buttons to reorder; ⌫ or x removes (with Undo) | |
| Reverse | Reverses the order | |
| Separator | Blank line, Horizontal rule, Newline, Custom… (`\n` and `\t` escapes) | |
| Drop duplicates | Joins unique items only | |
| Paste in sequence | Each ⌘V pastes the next item | Toast in the prototype |
| Joined preview | The text Copy all will produce, with chars | |
| Copy all, Into the workbench, Clear (with Undo) | As named | |

### Side panel: Snippets

| Control | What it does | Notes |
|---|---|---|
| New, From output | Create a snippet, empty or from the pipeline result | |
| Row | Expands the editor; shows abbreviation and placeholders used | |
| Row: Expand | Inserts the expanded snippet at the input caret; `{{cursor}}` places the caret | |
| Row: Copy | Copies the expanded text | |
| Editor: Name, Abbrev., text | Edits live; warns on a duplicate abbreviation; suggests a `;` prefix | |
| Placeholder buttons | Insert `{{date}}`, `{{time}}`, `{{clipboard}}`, `{{selection}}`, `{{title}}`, `{{path}}`, `{{cursor}}` at the caret | Tooltips describe each |
| Expands to | Live preview of the expansion | |
| Delete | Removes, with Undo | |
| Expand in other apps | System-wide expansion switch | Off by default; needs permissions (see Snippets) |

### Clipboard rules sheet

Covered in History policy and privacy and in Settings it binds to. Every switch and select is live. The secret tester and the tracking-parameter example are real.

### Status bar

Recording state (click to pause for 5 minutes or resume), clip and pin counts, "N not recorded today" (opens rules), the pipeline and its enabled steps, the stack (click toggles collect), the ring shortcut (opens the ring), theme, and text size (click resets).

## Transform catalogue

All 50 transforms come from `G.transforms` in `shared/app.js`. Every one is deterministic, local JavaScript and runs for real in the prototype. In the app they move to Rust so that headless runs (hotkeys, Services) need no WebView.

| Group | Id | Name | Behaviour |
|---|---|---|---|
| Clean | `strip-emoji` | Remove emoji | Removes emoji outside code blocks |
| Clean | `strip-frontmatter` | Remove front matter | Removes a leading `---` YAML block |
| Clean | `strip-citations` | Remove citation markers | Removes `[1]`, `[^note]`, `【1】` markers and footnote definitions |
| Clean | `strip-bold` | Remove bold | Unwraps `**bold**` and `__bold__`, keeping the words |
| Clean | `strip-hr` | Remove horizontal rules | Deletes `---`, `***`, `___` lines outside code |
| Clean | `collapse-blank` | Collapse blank lines | Trailing spaces off, runs of blank lines to one |
| Clean | `normalize-bullets` | Normalise list markers | `*` and `+` bullets become `-` |
| Clean | `normalize-headings` | Normalise heading levels | Starts at H1 and removes skipped levels |
| Clean | `demote` | Demote headings | Adds one `#` (to H6 at most) |
| Clean | `promote` | Promote headings | Removes one `#` |
| Clean | `unwrap` | Unwrap hard-wrapped lines | Joins lines inside paragraphs; lists, tables, quotes, headings and code untouched |
| Clean | `wrap-80` | Hard-wrap at 80 | Wraps prose at 80 columns, keeping list indents; tables untouched |
| Clean | `smart-punct` | Smart punctuation | Curly quotes, en dashes in ranges, em dashes for `--`, ellipses; skips code |
| Clean | `straight-punct` | Straight punctuation | The reverse of smart punctuation |
| Convert | `to-plain` | Markdown → plain text | Strips markup; links become `text (url)`; tables become tab-separated |
| Convert | `to-slack` | Markdown → Slack | mrkdwn: headings as `*bold*` lines, `*bold*`, `_italic_`, `<url|text>`, `•` bullets, tasks as `• [x]` and `• [ ]`, callouts as quoted labels |
| Convert | `to-jira` | Markdown → Jira wiki | `h1.` headings, `*bold*`, `_italic_`, `{{code}}`, `{code:lang}` blocks, `[text|url]`, `(/)` and `( )` tasks, `*`/`#` nested lists, `||header||` tables, `{info}`/`{warning}` panels |
| Convert | `to-html` | Markdown → HTML | Marxy's renderer, bare HTML |
| Convert | `tsv-to-table` | TSV / CSV → Markdown table | First row as header; right-aligns numeric columns |
| Convert | `table-to-csv` | Markdown table → CSV | Every table, RFC 4180 quoting |
| Convert | `table-to-json` | Markdown table → JSON | First table as an array of objects keyed by header |
| Convert | `json-pretty` | Format JSON | Two-space indent; returns the input unchanged if it is not JSON |
| Convert | `json-min` | Minify JSON | Same guard |
| Convert | `json-string` | Escape as JSON string | One JSON string literal |
| Convert | `fence` | Wrap in code fence | Uses the input's language when known |
| Convert | `quote` | Quote (> ) | Prefixes every line |
| Convert | `unquote` | Unquote | Removes one level of `>` |
| Convert | `indent` | Indent 4 spaces | Non-empty lines |
| Convert | `dedent` | Dedent | Removes common leading whitespace |
| Lines | `sort` | Sort lines | Natural, locale-aware |
| Lines | `sort-unique` | Sort and de-duplicate | |
| Lines | `dedupe` | Remove duplicate lines | Keeps first occurrence and order |
| Lines | `reverse` | Reverse lines | |
| Lines | `number` | Number lines | `1. ` prefixes, replacing bullets |
| Lines | `unnumber` | Remove list markers and numbers | Also removes task boxes |
| Lines | `join` | Join lines | Trimmed, non-empty lines joined with spaces |
| Lines | `to-bullets` | Lines → bullet list | `- ` prefixes, blank lines dropped |
| Case | `title-headings` | Title Case headings | Minor words stay lower case |
| Case | `sentence-headings` | Sentence case headings | Keeps acronyms |
| Case | `lower` | lowercase | Whole text |
| Case | `upper` | UPPERCASE | Whole text |
| Case | `slug` | slugify | `lower-case-with-hyphens` |
| Extract | `x-code` | All code blocks | Every fence, nothing else |
| Extract | `x-commands` | Shell commands as a script | bash/sh/zsh/console fences joined under `set -euo pipefail`, `$ ` prompts removed |
| Extract | `x-tasks` | Open tasks | Unchecked `- [ ]` lines |
| Extract | `x-links` | Links | Unique Markdown links, autolinks and bare URLs |
| Extract | `x-paths` | File paths mentioned | Unique backticked paths |
| Extract | `x-headings` | Outline | Headings as an indented list |
| Extract | `x-tables` | Tables as CSV | Every table |
| Extract | `x-questions` | Open questions | Lines ending in `?` |

A pipeline step that throws keeps its input and shows "error" with the message. A step that empties the text is flagged so the user can find where a chain went wrong.

## Copy formats

Each format is one entry in `G.copyFormats`. On macOS the app writes every listed type in one `NSPasteboardItem`, after `clearContents`, so the receiving app picks the richest type it understands. Marxy also writes `org.nspasteboard.source` with its own bundle identifier, which lets its own watcher attribute the change and lets other clipboard managers show the source.

| Format | Produces | Targets | Pasteboard types (macOS) |
|---|---|---|---|
| Markdown (⌘C) | The text as is | Text editors, GitHub, Obsidian, issue trackers | `public.utf8-plain-text`; optionally `net.daringfireball.markdown`, the de facto Markdown type that Markdown editors declare |
| Plain text (⇧⌘C) | `to-plain` | Terminals, web forms, Messages, search fields | `public.utf8-plain-text` |
| Rich text | HTML rendered from the Markdown, with the plain text as fallback | Mail, Notes, Pages, Google Docs, Word, Outlook | `public.html`, `public.rtf` (generated from the HTML through `NSAttributedString`), `public.utf8-plain-text` |
| HTML source | The rendered HTML as text | CMS source views, email builders, code | `public.utf8-plain-text` |
| Slack | `to-slack` | Slack's message composer | `public.utf8-plain-text` (see Open questions on adding `public.html`) |
| Jira / Confluence wiki | `to-jira` | Jira Data Center and Server, Confluence's Insert markup dialog | `public.utf8-plain-text` |
| JSON string | `json-string` | Code, config files, API payloads | `public.utf8-plain-text` |
| Quote with source link | `> ` lines plus `— [title](path)` | Notes, docs, PR descriptions | `public.utf8-plain-text` |

The prototype writes `text/plain`, plus `text/html` for Rich text, through the async Clipboard API. Chromium maps those to `public.utf8-plain-text` and `public.html` on macOS. It cannot write RTF or custom types.

`nameSource` (a page-local rule) decides whether the source is named: never (default), or with every format (a `Source: title (path)` line, except for Quote and JSON string).

## Pipelines

**Shape.** A pipeline is `{ id, name, steps: [transformId…], shortcut, input, output, services, shortcuts, menubar, uses, lastUsed }`. Steps are transform ids, so a pipeline survives transform implementation changes. In the builder each step also has an on/off flag. Saving drops skipped steps and says so; the alternative is in Open questions.

**Storage.** In the app: a `pipelines` table in Marxy's SQLite store under `~/Library/Application Support/Marxy/`, with JSON export and import as shown (`{"marxyPipelines": 1, "pipelines": [...]}`). Import validates step ids, drops unknown ones and lists them, and never imports shortcuts, so an imported file cannot take over a hotkey. The prototype keeps pipelines in `localStorage` under `marxy.studio.pipes`.

**Running headless.** Transforms run in Rust (ported from `app.js`), so a hotkey or Service needs no window. 

**Input.**
- *The clipboard*: read the general pasteboard.
- *Selected text in the front app*: via the Services entry (no permission needed). For hotkeys, by sending ⌘C to the front app and reading the pasteboard, which needs Accessibility. Marxy restores the previous clipboard afterwards and marks its temporary write `org.nspasteboard.TransientType` so other managers skip it.
- *Prompt each time*: opens the ring in pipeline scope.

**Result.** Replace the clipboard (default), paste into the front app (⌘V sent with `CGEventPost`, needs Accessibility), preview in the ring before pasting, or save to the Inbox.

**Exposure.**
- **Global shortcuts**: `tauri-plugin-global-shortcut`. Registering a hotkey needs no permission; acting on another app's selection or pasting does. Clashes are checked against other pipelines and Marxy's reserved keys. The app also tries registration and reports when the system or another app already holds the combination.
- **Services menu**: `NSServices` entries are static in `Info.plist`, so per-pipeline Services items are not possible. Marxy declares one service, *Transform with Marxy…*, sending and returning `public.utf8-plain-text`. It opens a small chooser listing the pipelines whose Services switch is on, and returns the result in place. The global `servicesMenu` preference removes the entry; `NSUpdateDynamicServices` refreshes it. Tauri merges a custom `Info.plist` from `src-tauri/`.
- **Shortcuts app**: an App Intent, *Run Marxy pipeline*, with a pipeline entity parameter whose query lists pipelines with the Shortcuts switch on. With "Use as Quick Action" in Shortcuts, a user shortcut also appears in the Services menu under its own name. This is the way to get named per-pipeline Services items. See the Tauri notes for the build risk and the fallback.
- **Menu bar extra**: pipelines with the Menu bar switch on appear under recent clips in the extra (see [09-macos.html](09-macos.html)).
- **Command palette**: every saved pipeline registers `Run pipeline: <name>` with its shortcut, so ⌘K then `>` finds it.

## Not in this direction

The workbench's third mode and its settings are gone; the page keeps Pipeline and Compare.

## History policy and privacy

- **Watching.** macOS has no clipboard-changed notification. Marxy polls `NSPasteboard.general.changeCount` on a background thread, twice a second by default, and reads content only when the count moves.
- **Never recorded.** Before reading any data, Marxy checks the item's `types`. Any of `org.nspasteboard.ConcealedType`, `org.nspasteboard.TransientType` or `org.nspasteboard.AutoGeneratedType` (the nspasteboard.org conventions used by password managers and well-behaved apps) means the copy is skipped. Only "app, reason, time" is kept, so the "Not recorded" rows can explain the gap. nspasteboard.org allows managers to show concealed items masked; Marxy goes further and keeps nothing. Apps on the ignore list (`clipIgnoreApps`, default 1Password and Keychain Access) are skipped the same way.
- **Likely secrets.** With Skip text that looks like a secret on, text matching key patterns is skipped: AWS access keys, GitHub tokens, Slack tokens, provider API keys, private-key blocks, JWTs. Matching runs locally before anything is written. The rules sheet has a live tester.
- **Source attribution.** `org.nspasteboard.source` when present; otherwise the frontmost application (`NSWorkspace.frontmostApplication`) at the moment the change count moved. For Marxy's own copies, the document and line.
- **Limits.** `clipLimit` (default 500) and `clipExpireDays` (default 30) apply to unpinned clips only. Clips larger than the size limit (default 1 MB) still work as the clipboard but are not stored. Images (on by default) are stored as PNG with recognised text (Vision) indexed for search. Rich formats (HTML, RTF) are stored beside the plain text so a paste from history keeps formatting.

- **Tracking parameters.** Optional and off by default: utm_*, fbclid, gclid, dclid, gbraid, wbraid, msclkid, mc_cid, mc_eid, igshid, _hsenc, _hsmi, mkt_tok, yclid and ref_src are removed from copied links. Any link can be cleaned by hand from the preview.
- **Pause and ignore.** Pause for 5 minutes, an hour or until resumed; Ignore the next copy. Both show in the status bar and the policy line.
- **Storage.** SQLite plus an image folder in Application Support, protected by FileVault. Clear unpinned and Clear everything offer Undo for 10 seconds, then delete for real.

## Collect mode

Collect mode (⌥⌘K anywhere) appends every copy to a stack instead of losing the previous one. Copies are still recorded in history, and the clipboard holds the latest item. The stack can be reordered (drag, ⌥↑ ⌥↓), trimmed, reversed and de-duplicated, then copied out as one with a separator: blank line, horizontal rule, newline, or custom with `\n` and `\t` escapes. **Paste in sequence** makes successive ⌘V presses paste item 1, then 2, then 3. The app swaps the pasteboard after each paste it observes and shows "2 of 5" in the ring. The stack also feeds the workbench (Load › Collect stack) and receives clips, selections and outputs ("Add to the stack").

## Snippets

A snippet is `{ name, abbreviation, body }`. Placeholders fill in at expansion:

| Placeholder | Value |
|---|---|
| `{{date}}` | Today, `YYYY-MM-DD` |
| `{{time}}` | Now, `HH:MM` |
| `{{clipboard}}` | The newest text on the clipboard |
| `{{selection}}` | The selection in the workbench input (in other apps, the selected text) |
| `{{title}}` | The source document's title, else "Untitled" |
| `{{path}}` | The source document's path, else `clipboard` |
| `{{cursor}}` | Where the caret lands after expansion |

In the workbench, typing an abbreviation and pressing ⇥ expands it. A leading `;` is recommended so abbreviations never fire on ordinary words; duplicates are refused. Expansion in other apps is a separate switch, off by default. It needs Input Monitoring to watch typing and Accessibility to replace the abbreviation; until both are granted, expansion works only inside Marxy. Snippets also appear in the ring's Snippets scope and the Load menu.

## Clipboard ring (HUD)

The ring is a small floating panel opened by a global shortcut (default ⌥⌘V) over whatever app is in front. The prototype shows it over a mock team chat so the paste result is visible.

- A filter field, focused on open. Typing filters; typing while focus is elsewhere returns to the field.
- Scopes: History, Pinned, Snippets, Pipelines (⇥ and ⇧⇥ cycle).
- Up to 60 rows. The first nine are numbered for ⌘1–⌘9. Each row shows a type icon, the first line and app · age.
- A preview of the highlighted row. For a pipeline, the preview shows its result on the current clipboard.
- **↵** pastes as copied. **⌥↵** pastes as plain text. "Paste as plain text by default" swaps ↵ and ⌥↵.
- **⌥P** pins. **⌥⌫** deletes from history. **esc** clears the filter, then closes.
- Pasting moves the clip to the top of the history.

**Implementation.** The ring must not take focus from the target app. It is a non-activating `NSPanel` (Tauri windows are plain `NSWindow`s; a community plugin such as `tauri-nspanel` or a small `objc2` shim provides the panel), floating level, on all Spaces, no title bar, with the `--glass` material.

On ↵:
1. Write the chosen representation to the pasteboard.
2. Hide the panel.
3. If "Paste straight into the front app" is on (needs Accessibility), post ⌘V with `CGEventPost`. Otherwise leave it for the user to press ⌘V.

If the panel did activate Marxy, record the frontmost app before showing it and reactivate that app before sending ⌘V.

## Keyboard map

| Scope | Action | Keys |
|---|---|---|
| Anywhere on the Mac | Clipboard ring | ⌥⌘V |
| | Marxy palette | ⌃⌥Space |
| | Collect mode on or off | ⌥⌘K |
| | Run a saved pipeline | its own shortcut, e.g. ⌃⌥⌘S, ⌃⌥⌘J, ⌃⌥⌘T |
| Studio | Open the studio | ⇧⌘V |
| | Search the history | ⌘F |
| | Focus history, input, pipeline, output | ⌘1 – ⌘4 |
| | Pipeline, Compare | ⌥⌘1 – ⌥⌘2 |
| | Side panel | ⌥⌘I |
| | Clipboard rules | ⌥⌘R |
| | Command palette, transforms | ⌘K, ⌘/ |
| | Keyboard map | ⌘? |
| History list | Move, extend selection, select all | ↑ ↓, ⇧↑ ⇧↓, ⌘A |
| | Load into the workbench, merge selected | ↵, ⇧↵ |
| | Copy (moves to the top), pin, delete | ⌘C, ⌥P, ⌫ |
| | Preview pane, more actions, search | Space, ⇧F10, any letter |
| Input | Expand a snippet abbreviation | ⇥ |
| | Copy the output, replace the clipboard | ⌘↵, ⌥⌘↵ |
| Pipeline | Add a step | ⇧⌘A |
| | Move, enable or skip, preview after, remove a focused step | ⌥↑ ⌥↓, ⌘E, ↵, ⌫ |
| | Save, Save as, Run on the clipboard | ⌘S, ⇧⌘S, ⌘R |
| Output | Copy, replace the clipboard, cycle views, use as input, new document | ⌘↵, ⌥⌘↵, ⌘D, ⌘U, ⌥⌘N |
| Ring | Paste, plain text, item 1–9, next scope, pin, delete, close | ↵, ⌥↵, ⌘1–⌘9, ⇥, ⌥P, ⌥⌫, esc |

All are rebindable in Settings › Shortcuts. Every studio command is registered with `G.command` (group "Clipboard studio", plus "Pipelines") and is reachable from ⌘K.

## Settings it binds to

| Preference | Default | Where in the studio | Effect |
|---|---|---|---|
| `clipHistory` | true | Rules › Record clipboard history; Pause and Resume; status bar | Recording on or off |
| `clipLimit` | 500 | Rules › Keep at most | Unpinned clip cap |
| `clipExpireDays` | 30 | Rules › Remove unpinned clips after | 0 means never |
| `clipIgnoreApps` | "1Password, Keychain Access" | Rules › Never record from these apps; policy line | Apps never recorded |
| `stripEmoji` | false | Rules › Remove emoji when cleaning | |
| `smartPunctOnCopy` | false | Rules › Smart punctuation on copy | |
| `copyDefault` | "markdown" | Copy as › star; Rules › Default format | Format for ⌘C in Marxy |

| `servicesMenu` | true | Pipelines › Services menu | The single Services entry |
| `menubarExtra` | true | Pipelines › Menu bar extra | |

Page-local rules, which belong in `G.prefDefaults` (see the report):

| Rule | Default |
|---|---|
| `maxItemKb` | 1024 |
| `images` | true |
| `richFormats` | true |
| `skipSecrets` | true |
| `stripTracking` | false |
| `nameSource` | "never" |
| `pastePlain` | false |
| `pasteDirect` | true |
| `shortcutsApp` | true |
| `expandEverywhere` | false |
| `pausedUntil` | none |

## Tauri implementation notes

- **Clipboard plugin.** `tauri-plugin-clipboard-manager` (2.4.1 on docs.rs) offers `write_text`, `read_text`, `write_html(html, alt_text)`, `write_image`, `read_image` and `clear`. It has no HTML or RTF read, no custom pasteboard types, no type listing and no change event. Its docs warn against calling `read_text` and `read_image` on the main thread. It is fine for simple writes. The watcher, type checks, multi-type writes and source tagging need native code.
- **Native pasteboard.** `objc2-app-kit` (`NSPasteboard`, `NSPasteboardItem`) on a background thread:
  - poll `changeCount`
  - read `types` first, and skip concealed or transient copies before reading data
  - then read `public.utf8-plain-text`, `public.html`, `public.rtf`, `public.url`, `public.png` and `public.tiff` as needed
  - write all representations of one copy into a single item, with `org.nspasteboard.source`
  - generate RTF from HTML with `NSAttributedString` (HTML in, RTF data out)
- **Pasteboard privacy.** macOS 15.4 previewed alerts when an app reads the general pasteboard without user interaction (`NSPasteboard.accessBehavior`, plus detect methods that inspect types without reading). Clipboard history depends on unprompted reads, so onboarding must explain and link to Privacy & Security. The watcher should use the type-only detect calls where available, and degrade to "record on demand" when access is denied. Shipping behaviour on macOS 26 should be checked on a current build.
- **Global shortcuts.** `tauri-plugin-global-shortcut` for the ring, the palette, collect mode and per-pipeline keys. Shortcuts are re-registered when pipelines change. A registration failure is reported in the pipeline detail.
- **Accessibility.** Needed to paste into the front app (`CGEventPost` ⌘V), to read the selection for hotkey pipelines (send ⌘C, or the `kAXSelectedText` attribute), and for system-wide snippet expansion, which also needs Input Monitoring. Request it only when a feature that needs it is switched on. Check with `AXIsProcessTrustedWithOptions`.
- **Ring panel.** A second webview window converted to a non-activating `NSPanel`: floating level, `canJoinAllSpaces`, transparent, no decorations. It is prewarmed hidden so ⌥⌘V shows it within one frame.
- **Services.** One `NSServices` entry in a merged `Info.plist`, with send and return types `public.utf8-plain-text`. The provider object is registered at launch with `NSApp.servicesProvider`.
- **Shortcuts.** App Intents are Swift, and their metadata is produced by Xcode's build, which a Cargo build does not run. Options, in order:
  1. An Xcode-built helper or extension inside the bundle that implements the intent and talks to Marxy over XPC or a local socket.
  2. A `marxy://run?pipeline=<id>` URL scheme that a user shortcut opens with Open URLs.
  3. A bundled `marxy` CLI for the Run Shell Script action.
- **Storage.** SQLite (`rusqlite`) with FTS5 over clip text and recognised image text; images on disk; pipelines and snippets in the same database.
- **Transforms.** Port `G.transforms` to a Rust module with the same ids and table-driven tests generated from the prototype's outputs, so the studio, hotkeys, Services and the CLI agree byte for byte.
- **OCR.** Vision `VNRecognizeTextRequest` on captured images, off the main thread.

## Open questions

1. **Saving skipped steps.** Should saved pipelines keep skipped steps, stored as disabled, instead of dropping them on save?
2. **Slack paste.** Slack's composer handles a rich paste well. Is writing `public.html` beside the mrkdwn text more reliable than mrkdwn alone? Needs a test across Slack versions.
3. **Jira Cloud.** Its editor converts pasted Markdown and rich text, and wiki markup mainly helps Data Center and Confluence's Insert markup. Should the Jira format detect the target, or should there be separate "Jira Cloud" and "Jira wiki" formats?
4. **Markdown type.** Is writing `net.daringfireball.markdown` worth it? Check which apps read it, and whether the system declares it or Marxy must import the declaration.
5. **Pasteboard privacy on macOS 26.** If unprompted reads always prompt, does history fall back to recording only copies made in Marxy, plus copies made while the ring is open?
6. **Encryption at rest.** Should history be encrypted beyond FileVault, for example with SQLCipher and a Keychain key, for people who store client data?
7. **macOS 26 Spotlight clipboard history.** It overlaps the basic ring. Should Marxy lean on its own strengths (pipelines, transforms, the collect stack) and offer to coexist rather than compete?
8. **Collect mode in other apps.** Should copies there go to the stack only, or to the stack and history, as now?
9. **Pipeline-run history.** Should runs from hotkeys record the before-text so the ring can offer "undo last transform"?

## Prototype notes

- **Persistence.**
  - `localStorage` keys: `marxy.studio.pipes`, `marxy.studio.snips`, `marxy.studio.rules`, `marxy.studio.ui`.
  - Five demo clips from other apps (Notes, Numbers, Mail, Terminal, Screenshot) are added to the shared ring in memory. They are saved only the first time the ring is saved from this page.
  - The collect stack is seeded with three pieces of the Postgres plan when it is empty.
- **Integration.** The studio defines `G.openDoc` (a palette file choice loads it into the workbench), `G.replaceText` and `G.insertText` (⌘↵ on palette transforms and clips acts on the input), and `G.undo`.
- **Not real.** Writing files, Services, Shortcuts, the menu bar, pasting into other apps, OCR, and the "Not recorded" events are simulated. Everything else is live.
