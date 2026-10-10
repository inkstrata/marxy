# 09 macOS integration

Later, not in this direction: this page is kept for reference and is not part of Marxy mock v2.

Every place Marxy appears in macOS outside its own document view, as working replicas. Open [09-macos.html](09-macos.html); the list down the left of the main area moves between surfaces (Option-Up and Option-Down also step through them). Each replica runs Marxy's real transforms, copy formats and commands on the sample library.

## Purpose

Marxy is a reader for source of any kind. Much of that text arrives while you are in another app: a terminal, a browser, Slack, Mail. A reader that only works inside its own window makes you go and get the text. So Marxy meets the text where it is:

- **In its own window**: a customisable toolbar and a complete menu bar that documents every command and shortcut.
- **Anywhere, while it runs**: a menu bar extra, a floating clipboard ring and a global palette that works on the front app's selection.
- **In Finder and other apps**: Quick Actions, Services, Quick Look, a share extension and Shortcuts actions.
- **In system chrome**: the Dock menu, Spotlight and notifications.

Design rules that hold across all of them: never steal focus from the app you are working in; ask for a permission at the moment it is needed, after saying why; write results beside originals, never over them; every surface has a keyboard path; every surface can be turned off.

The Touch Bar is not a surface. No Mac sold today has one (the last was the 13-inch MacBook Pro with M2, discontinued in 2023), so nothing is designed or built for it.

## 1. Window toolbar

The default set matches [01-workspace.html](01-workspace.html). The toolbar is HTML inside the webview (see Tauri notes), styled and behaving like a unified NSToolbar, with its own Customize Toolbar sheet.

### Items

| Identifier | Label | Icon (Lucide) | Action | Shortcut | Default |
|---|---|---|---|---|---|
| `sidebar` | Sidebar | panel-left | Show or hide the sidebar | ⌃⌘S | Off: lives in the sidebar header |
| `nav` | Back/Forward | chevron-left, chevron-right | Document history in this window | ⌘[ ⌘] | On |
| `view` | View Mode | book-open-text, columns-2, square-code | Read, Split, Source | ⌘1 ⌘2 ⌘3 | On |
| `kind` | Content Type | kind icon | Show as another content type; with per-type toolbars, also switches the toolbar | | On |
| `copy` | Copy | copy | Selection, or whole document, as Markdown | ⌘C | On |
| `copyas` | Copy As | chevron-down | Every copy format | | On |
| `transform` | Transform | wand-sparkles | Every transform by group; result sheet | ⌘/ | On |
| `collect` | Collect | layers | Collect mode; the stack size is shown | ⌥⌘K | On |
| `find` | Find | search | Find and replace | ⌘F | On |
| `theme` | Theme | palette | Theme, type set, text size | | On |
| `share` | Share | share | Share menu, copy link, exports | | On |
| `inspector` | Inspector | panel-right | Outline, Info, Versions, Links | ⌥⌘I | On |
| `editor` | Open in Editor | square-pen | Open the file in the chosen editor | ⇧⌘E | Off |
| `reveal` | Reveal in Finder | folder-open | Select the file in Finder | ⌥⌘R | Off |
| `print` | Print | printer | Print or PDF with paged typography (⌘P is the palette alias) | | Off |
| `textsize` | Text Size | a-arrow-down, a-arrow-up | Smaller, larger | ⌘− ⌘+ | Off |
| `focus` | Focus Mode | focus | Dim all but the paragraph under the pointer | ⇧⌘D | Off |
| `reading` | Reading Settings | type | Measure, justification, paged, text size, Settings | | Off |
| `palette` | Command Palette | command | Files, commands, transforms, headings | ⌘K | Off |
| `newclip` | New from Clipboard | clipboard-paste | Clipboard to a new Inbox document | ⌥⌘N | Off |
| `splith2` | Split by H2 | split | One file per H2 section | | Off |
| `compare` | Compare Versions | git-compare | Diff against a snapshot | | Off |
| `verify` | Verify Paths | folder-check | Check every mentioned path exists | | Off; in the Report set |
| `history` | Clipboard Ring | clipboard-list | Opens the clipboard ring | ⌥⌘V | Off |
| `library` | Library | library | Collections and search | ⌃⌘L | Off |
| `wrap` | Wrap | wrap-text | Soft-wrap long lines | ⌥Z | Code set |
| `literate` | Literate | book-text | Comments beside the code they describe | | Code set |
| `colstats` | Column Stats | sigma | Per-column min, max, mean, distinct | | Data set |
| `filter` | Filter | list-filter | Filter rows | | Data set |
| `collapse` | Collapse Tools | chevrons-down-up | Fold tool calls | | Transcript set |
| `final` | Final Answer | flag | Copy the last assistant turn | | Transcript set |
| `paged` | Paged | book-open | Pages instead of scrolling | ⌥⌘P | Book set |
| `contents` | Contents | list-tree | Chapters and position | | Book set |
| `flex` | Flexible Space | | Pushes later items to the trailing edge | | One, after Content Type |
| `space` | Space | | Fixed gap; starts a new capsule group | | One, before Collect |
| `sep` | Separator | | Thin rule inside a capsule group | | One, after Copy As |

Default order: `nav view kind flex copy copyas sep transform extract space collect find theme share inspector`. The window title and path sit after the leading navigation items and are not an item.

### Per-content-type sets

Off by default. When **Separate toolbar for each content type** is on, each type keeps its own item list, starting from the default set plus:

| Type | Adds (before the trailing group) |
|---|---|
| Report | Verify Paths |
| Code | Wrap, Literate |
| Data | Column Stats, Filter |
| Transcript | Collapse Tools, Final Answer |
| Book | Paged, Contents |
| Article, README, Docs, Notes, Changelog | Nothing; the default set |

The Content Type chip picks which set is shown and, while customising, which set is being edited.

### Customisation behaviour

- **Customize Toolbar…** (View menu, toolbar context menu, or the button under the replica) drops a sheet from under the toolbar, as NSToolbar does: a palette of every item with icon and label, the default set as one draggable strip, and a footer with **Show** (Icon and Text, Icon Only, Text Only), **Use small size**, **Separate toolbar for each content type** with an **Editing** type picker, and **Done**.
- While the sheet is open the toolbar's items stop acting and become draggable. Drag a palette item into the toolbar to add it at the insertion marker; drag an item already in the toolbar to move it; drag an item out of the toolbar to remove it; drag the default set into the toolbar to restore it. Items other than Space, Flexible Space and Separator are unique: dragging one that is already present moves it.
- Keyboard: Tab to a palette item and press Return to add it at the end; Tab to a toolbar item and press Delete to remove it, Option-Left or Option-Right to move it, Left or Right to move focus; Return on the default set restores it; Esc or Done closes the sheet.
- Right-clicking the toolbar offers Icon and Text, Icon Only, Text Only, Use Small Size, Remove “item”, and Customize Toolbar….
- Items that do not fit move into a trailing overflow menu (chevrons), as in AppKit.
- Configuration is saved per user (`macos.toolbar`: items, per-type lists, display mode, small size).

## 2. Menu bar

Order: Marxy, File, Edit, Format, View, Transform, Go, Window, Help. Format holds the source editor's commands from [02-source.html](02-source.html). Glyphs are in Apple order: ⌃ Control, ⌥ Option, ⇧ Shift, ⌘ Command. “Source” says whether an item is a Marxy command, a standard AppKit item, or one macOS adds by itself. Items marked “(⌥: …)” change while Option is held.

The replica generates its shortcut map and a conflict check from the same data, so the map below and the page cannot drift; the check reports any two items sharing a key equivalent and any shortcut that collides with a system-wide macOS one.

### Marxy

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| About Marxy | | AppKit | |
| Check for Updates… | | Marxy | Signed feed through the updater plugin |
| Settings… | ⌘, | Marxy | `go-settings` |
| Global Shortcuts… | | Marxy | Record the three system-wide shortcuts |
| Install Command Line Tool… | | Marxy | `marxy open`, `marxy pipe`; shared by extensions and other platforms |
| Services ▸ | | AppKit | System-owned submenu |
| Hide Marxy | ⌘H | AppKit | |
| Hide Others | ⌥⌘H | AppKit | |
| Show All | | AppKit | |
| Quit Marxy | ⌘Q (⌥: Quit and Keep Windows ⌥⌘Q) | AppKit | The menu bar extra and global shortcuts stop too |

### File

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| New Document | ⌘N | Marxy | Untitled Markdown scratch buffer |
| New from Clipboard | ⌥⌘N | Marxy | Global equivalent ⌃⌥⌘N |
| New Window | ⇧⌘N | Marxy | |
| Open… | ⌘O | Marxy | |
| Open Recent ▸ | | Marxy | Recent files, Clear Menu; same list as the Dock menu |
| Add Folder to Library… | ⌥⌘O | Marxy | `add-folder` |
| Close Tab | ⌘W (⌥: Close Other Tabs ⌥⌘W) | Marxy | |
| Close Window | ⇧⌘W (⌥: Close All ⌥⇧⌘W) | AppKit | Marxy keeps running in the menu bar |
| Reopen Closed Tab | ⇧⌘T | Marxy | |
| Save | ⌘S | Marxy | Snapshot first, then write |
| Save As… | ⇧⌘S | Marxy | |
| Revert To ▸ | | Marxy | Last Saved, snapshots by revision, Browse All Versions… |
| Rename…, Move To… | | Marxy | |
| Export ▸ | | Marxy | PDF, HTML (self-contained), Word, Rich Text, Plain Text, Markdown, EPUB, Code Blocks as Files, Split by H2 into Files |
| Share ▸ | | Marxy | AirDrop, Mail, Messages, Notes, Copy Link to File, Edit Extensions… |
| Page Setup… | | Marxy | No shortcut: ⇧⌘P is Run Command |
| Print… | | Marxy | Paged typography, running heads; ⌘P is the palette alias |
| Reveal in Finder | ⌥⌘R | Marxy | |
| Open in Editor | ⇧⌘E | Marxy | Editor chosen in Settings |
| Open With ▸ | | Marxy | Installed editors, Other… |

### Edit

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Undo, Redo | ⌘Z, ⇧⌘Z | AppKit | |
| Cut | ⌘X | AppKit | |
| Copy | ⌘C | AppKit item, Marxy handler | Selection as Markdown; whole document when nothing is selected |
| Copy As ▸ Markdown | | Marxy | Its shortcut lives on Copy |
| Copy As ▸ Plain text | ⇧⌘C | Marxy | |
| Copy As ▸ Rich text, HTML source, Slack, Jira / Confluence wiki, JSON string, Quote with source link | | Marxy | |
| Copy Path, Copy Link to Heading | | Marxy | |
| Paste | ⌘V | AppKit | |
| Paste and Match Style | ⌥⇧⌘V | AppKit | Plain text |
| Delete | | AppKit | |
| Select All | ⌘A | AppKit | |
| Select ▸ Line, Block, Section, Expand Selection | ⌘L, ⌃⇧B, ⌃⇧S, ⌃⇧→ | Marxy | As in 02-source |
| Select ▸ Next Occurrence, All Occurrences | ⌘D, ⇧⌘L | Marxy | As in 02-source |
| Collect Mode | ⌥⌘K | Marxy | `collect`, checkmark while on |
| Copy Collected Stack | ⌥⇧⌘K | Marxy | `copy-stack` |
| Clear Stack | | Marxy | |
| Find ▸ Find…, Find and Replace…, Find Next, Find Previous | ⌘F, ⌥⌘F, ⌘G, ⇧⌘G | Marxy | |
| Find ▸ Use Selection for Find | | Marxy | No ⌘E: that toggles Read and Source |
| Find ▸ Find in Library… | ⇧⌘F | Marxy | |
| Spelling and Grammar ▸ | ⌘:, ⌘; | AppKit | Source editor |
| Substitutions ▸, Transformations ▸, Speech ▸ | | AppKit | Smart quotes off by default in the source editor |
| Start Dictation…, Emoji & Symbols | fn E (emoji) | macOS | Added by the system |

### Format

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Bold, Italic | ⌘B, ⌘I | Marxy | Source editor |
| Strikethrough | | Marxy | |
| Inline Code | ⌃` | Marxy | Not ⌘`: that is the system's Move focus to next window |
| Link… | ⌥⌘L | Marxy | |
| Heading ▸ Body Text, Heading 1 to 4 | ⌥⌘0, ⌥⌘1 to ⌥⌘4 | Marxy | |
| Toggle Task, Toggle Quote, Toggle Comment | ⌘↩, ⌘', ⌥⌘/ | Marxy | |
| Line ▸ Move Up, Move Down, Duplicate, Delete, Join | ⌥↑, ⌥↓, ⌥⇧↓, ⇧⌘K, ⌃J | Marxy | |
| Section ▸ Move Up, Move Down, Promote, Demote | ⌃⌥↑, ⌃⌥↓, ⌃⌥←, ⌃⌥→ | Marxy | |
| Wrap in Code Fence, Make Table from Selection | | Marxy | |

### View

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Read, Split, Source | ⌘1, ⌘2, ⌘3 | Marxy | Radio group |
| Show Sidebar | ⌃⌘S | Marxy | `toggle-sidebar` |
| Show Inspector | ⌥⌘I | Marxy | |
| Inspector Tab ▸ | | Marxy | Outline, Info, Versions, Links; no shortcuts because ⌥⌘0 to ⌥⌘4 are heading levels |
| Show Tab Bar, Show Status Bar | | Marxy | |
| Show Toolbar | ⌥⌘T | AppKit | |
| Customize Toolbar… | | AppKit | Opens Marxy's sheet |
| Content Type ▸ | | Marxy | Detected type; all ten types; Always Open This Folder As ▸; Reset to Detected |
| Theme ▸ | | Marxy | Follow System; Paper, Ink, Sepia, Dusk, Fjord, Night, High contrast light, High contrast dark; Next Theme ⌃⌘T; Theme Picker… |
| Type Set ▸ | | Marxy | Classic, Plex, Hyperlegible, System, Typewriter |
| Larger Text, Smaller Text, Actual Size | ⌘+, ⌘−, ⌘0 | Marxy | |
| Focus Mode | ⇧⌘D | Marxy | |
| Paged Layout | ⌥⌘P | Marxy | |
| Sync Scrolling, Line Numbers, Minimap | | Marxy | |
| Soft Wrap | ⌥Z | Marxy | As in 01 and 02; see open questions |
| Verify Paths, Block Handles | | Marxy | Checkmarks bound to prefs |
| Enter Full Screen | ⌃⌘F | AppKit | Newer macOS shows fn F |

### Transform

All transforms apply to the selection, or to the document when nothing is selected.

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Transform… | ⌘/ | Marxy | Palette in transform mode |
| Repeat Last Transform | ⌃⌘/ | Marxy | |
| Clean ▸ | | Marxy | Remove emoji, Remove front matter, Remove citation markers, Remove bold, Remove horizontal rules, Collapse blank lines, Normalise list markers, Normalise heading levels, Demote headings, Promote headings, Unwrap hard-wrapped lines, Hard-wrap at 80, Smart punctuation, Straight punctuation |
| Convert ▸ | | Marxy | Markdown to plain text, Slack, Jira wiki, HTML; TSV or CSV to Markdown table; Markdown table to CSV, JSON; Format JSON; Minify JSON; Escape as JSON string; Wrap in code fence; Quote; Unquote; Indent 4 spaces; Dedent |
| Lines ▸ | | Marxy | Sort, Sort and de-duplicate, Remove duplicates, Reverse, Number, Remove list markers, Join, Lines to bullet list |
| Case ▸ | | Marxy | Title Case headings, Sentence case headings, lowercase, UPPERCASE, slugify |
| Extract ▸ | Code blocks, Shell commands, Links, Tables as CSV | Marxy | No key: also the right-click verb menu and the palette (`>Extract`) |
| Pipelines ▸ | | Marxy | Saved pipelines (Notes → Slack, Handoff → Jira ticket, Tables → CSV files, Plain and wrapped); New Pipeline…; Edit Pipelines… |
| Split by H2…, Compare Versions… | | Marxy | |

### Go

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Command Palette | ⌘K | Marxy | `palette` |
| Run Command… | ⇧⌘P | Marxy | `palette-commands` |
| Go to File… | ⌘T | Marxy | Palette limited to files |
| Go to Heading… | ⇧⌘O | Marxy | `palette-headings` |
| Go to Section Everywhere… | ⌥⇧⌘O | Marxy | Palette `@` mode |
| Go to Line… | ⌃G | Marxy | As in 02-source |
| Back, Forward | ⌘[, ⌘] | Marxy | |
| Next Heading, Previous Heading | ⌥⌘↓, ⌥⌘↑ | Marxy | |
| Library | ⌃⌘L | Marxy | `go-collections` |
| Recent, Pinned, Changed Since You Read | | Marxy | Library views with counts |
| Collections ▸, Smart Collections ▸ | | Marxy | |

### Window

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Minimize | ⌘M (⌥: Minimize All ⌥⌘M) | AppKit | |
| Zoom | (⌥: Zoom All) | AppKit | |
| Fill, Center | fn ⌃F, fn ⌃C | macOS | Added to the Window menu by macOS 15 and later |
| Move & Resize ▸, Full Screen Tile ▸ | | macOS | Halves, quarters, arrangements, Return to Previous Size |
| Show Previous Tab, Show Next Tab | ⌃⇧Tab, ⌃Tab | macOS | Native window tabs |
| Move Tab to New Window, Merge All Windows | | macOS | |
| Show All Tabs | ⇧⌘\ | macOS | |
| Clipboard Ring | ⌥⌘V (global) | Marxy | |
| Global Palette | ⌃⌥Space (global) | Marxy | |
| Menu Bar Extra | | Marxy | |
| Bring All to Front | | AppKit | |
| Window list | | AppKit | One row per window, checkmark on the front one |

### Help

| Item | Shortcut | Source | Notes |
|---|---|---|---|
| Search field | ⇧⌘/ | macOS | Searches every menu item; Marxy adds help topics |
| Marxy Help | | Marxy | |
| Keyboard Shortcuts | ⌃⌘K | Marxy | Opens the shortcut map |
| Typography Handbook, Markdown Reference | | Marxy | |
| What's New in Marxy, Release Notes | | Marxy | |
| Privacy: What Marxy Stores | | Marxy | Where history and settings are kept; nothing is sent anywhere |
| Report an Issue…, Show Logs in Finder | | Marxy | |

### Global shortcuts

| Setting key | Default | Action | Known clash |
|---|---|---|---|
| `globalPalette` | ⌃⌥Space | Global palette | Input Sources: Select next source in Input menu (when more than one input source is on) |
| `globalClipRing` | ⌥⌘V | Clipboard ring | Finder: Move Item Here. A global hotkey takes it from Finder too; offer ⌃⌥V or ⇧⌘V |
| `globalCapture` | ⌃⌥⌘N | New document from clipboard | None known |

### Reconciliation with the other screens

| Item | Elsewhere | Here | Why |
|---|---|---|---|
| Library | ⇧⌘L in earlier drafts | ⌃⌘L | Matches shared/app.js `go-collections`; frees ⇧⌘L for Select All Occurrences as in 02-source |
| Add Folder to Library | ⌥⌘O | ⌥⌘O | ⇧⌘O stays Go to Heading |
| Go to Line | ⌃G | ⌃G | ⌘L is Select Line |
| Inline Code | ⌃` | ⌃` | Avoids the system's ⌘` |
| Page Setup | macOS standard ⇧⌘P | none | ⇧⌘P is Run Command |
| Use Selection for Find | macOS standard ⌘E | none | ⌘E toggles Read and Source |
| Show Fonts | macOS standard ⌘T | not offered | ⌘T is Go to File; Marxy has no font panel |

## 3. Menu bar extra

A status item, present while Marxy runs, with or without a window. The icon is a monochrome template image so macOS tints it for any menu bar; when clipboard history is paused it shows at reduced opacity. 

| Gesture | Result |
|---|---|
| Click | Popover |
| Right-click or Control-click | Plain menu: five recent clips with ⌘1 to ⌘5, New Document from Clipboard, Run Pipeline ▸, Pause Clipboard History, Open Marxy, Settings…, Quit |
| Option-click | Pause or resume clipboard history |
| Drop a file on the icon | Add it to the Inbox |

Popover, top to bottom:

| Section | Contents | Keys |
|---|---|---|
| Header | Marxy, recording or paused chip, Pause (5 minutes, 1 hour, until tomorrow, until resumed; Resume when paused), Settings (Show in menu bar, Open at login, Settings…, Quit) | |
| Search | Filters the clipboard list | Type |
| Clipboard | Nine most recent clips, numbered, with type icon, first line, app and age; pinned clips show a pin | 1–9 or Return copies; ⌥ copies plain text; ↑ ↓ |
| Quick actions | New document from clipboard, Run pipeline on clipboard ▸, Clipboard ring, Open palette | |
| Footer | Index size and watched folders, Open Marxy | Esc closes |

Concealed and transient pasteboard types are never recorded, paused or not.

## 4. Clipboard ring HUD

Global shortcut (default ⌥⌘V). A floating panel over the front app, which keeps focus; the replica shows it over TextEdit.

| Key | Does |
|---|---|
| Type | Fuzzy filter over every clip, not only the first nine |
| 1–9 | Paste that clip (⌘1–⌘9 once a filter is typed) |
| Return | Paste as copied |
| ⌥ Return | Paste as plain text (Markdown syntax removed) |
| ⌘P | Pin or unpin; pinned clips sort first |
| ⌘ Delete | Forget the clip |
| ↑ ↓ | Move; the preview shows the full clip, its source document and line, and size |
| Esc | Close; focus returns to the app you were in |

Paste mode: **Paste into the front app** (default; needs Accessibility) or **Copy only** (puts the clip on the clipboard; you press ⌘V). Pasting saves and restores the user's clipboard around the synthetic paste.

## 5. Global palette

Global shortcut (default ⌃⌥Space). Marxy's palette as a non-activating panel over any app.

- **Context chips**: the front app's selection (read through Accessibility) or the clipboard.
- **Groups**: Transform the selection (six curated transforms until you type; `>Transform` lists every transform, and `/` searches file contents), Open from the Library (fuzzy over indexed files), Marxy commands (clipboard ring, new from clipboard, open Marxy).
- **Preview**: the transform's result on the actual selection, before anything changes.
- **Return** replaces the selection in the front app (one undo step there); **⌘ Return** copies the result; **⌥ Return** opens the result as a new Marxy document. For files, Return opens in Marxy and ⌘ Return copies the path.

## 6. Finder Quick Actions

In Finder's context menu under Quick Actions, and as buttons at the bottom of the preview pane (three plus More…). Each action appears only when it applies.

| Action | Shown for | Result |
|---|---|---|
| Open in Marxy | Markdown files | Opens each in a Marxy tab |
| Copy as Rich Text | One Markdown file | Rendered HTML plus plain text on the clipboard |
| Combine into One File | Two or more Markdown files | `Combined (n files).md` in selection order, one heading per source, front matter dropped, headings demoted |
| Add Folder to Marxy Library | Folders, or the window background | Adds a watched collection and indexes it |

`finderActions` turns them all off; `finderActionList` (shared with 08-settings) turns each off. Customize… points to System Settings › General › Login Items & Extensions › Finder, where macOS also lets the user hide them.

## 7. Services

In every app's app menu › Services, under Text, and in the text context menu (macOS shows them inline when few are enabled).

| Service | Does | Info.plist |
|---|---|---|
| Send to Marxy Inbox | Saves the selection as a Markdown note; source is the app name | send: text, RTF |
| Convert to Markdown Table | Replaces tab or comma separated rows with a Markdown table, numeric columns right-aligned | send and return: text |
| Open Selection as Markdown | Opens the selection as an untitled document | send: text, RTF, HTML |
| Run Pipeline… | Asks which saved pipeline, previews, then replaces the selection | send and return: text |

No default key equivalents (Apple discourages them for services); the user assigns any in System Settings › Keyboard › Keyboard Shortcuts › Services. `servicesMenu` and `servicesList` (shared with 08-settings) control Marxy's handler; an app cannot remove its own services from other apps' menus at runtime, so turning one off also points the user to that pane.

## 8. Quick Look

Space in Finder previews `.md` files with Marxy's typography: front matter is folded and marked, and callouts, tables and code are rendered. Title bar: close, full screen, file name, position (n of m), **Open with Marxy**, share. Arrow keys step through the folder. Footer states what rendered it.

- `quicklook` off: macOS's plain-text preview.
- `quicklookTheme` off: Paper or Ink to match the system appearance instead of the user's Marxy theme.
- Thumbnails: Finder icons and the preview pane show a rendered first page.

## 9. Share extension

A **Marxy Inbox** target in the system share menu.

| Field | Options |
|---|---|
| Capture | Selection (as a quote with a source link, or as is), Page as Markdown (reader extraction), Link only |
| Title | Prefilled from the page; becomes the file name (slugified) |
| Save to | Inbox (default) or any collection |
| Options | Open in Marxy after saving |

Accepts one web page or URL, plain and rich text, and up to 20 Markdown, text, CSV or JSON files; declines images and PDFs so the target only appears where it helps. ⌘ Return saves, Esc cancels. Turned off with `shareExt`.

## 10. Shortcuts actions (App Intents)

| Action | Parameters | Input | Output |
|---|---|---|---|
| Get Clipboard History | Limit (1, 3, 5, 10); Type (Any, Markdown, Code, URL, Plain) | – | Text, newest first |
| Clean Text | Remove (Emoji, Front matter, Citation markers) | Text | Text |
| Run Pipeline | Pipeline (saved pipelines, an App Enum) | Text | Text |
| Transform Text | Transform (every transform) | Text | Text |
| Copy as Format | Format (every copy format) | Text | Text, also on the clipboard |
| Find Documents | Collection; Kind; Modified (Any time, Today, This week); plus text | – | Documents (App Entities) |
| Open Document | View (Read, Split, Source) | Document | – |
| Get Document Text | Part (Whole document, Code blocks, Open tasks, Outline) | Document | Text |
| Add to Inbox | Title (From first line, Date and time) | Text | Document |

Example shortcuts, runnable in the replica:

1. **Plan to Slack**: Find Documents (Plans, Report, Today) → Get Document Text (Whole document) → Clean Text (Front matter) → Copy as Format (Slack).
2. **Clipboard to Inbox**: Get Clipboard History (1) → Add to Inbox (From first line).
3. **Handoff tasks for Jira**: Find Documents (Plans, Report) → Get Document Text (Open tasks) → Transform Text (Markdown → Jira wiki) → Copy as Format (Plain text).

App Shortcuts phrases ship with the app: “Open the Marxy Inbox”, “Run a Marxy pipeline”, “Find documents in Marxy”. Any user shortcut built from these can be marked Use as Quick Action.

## 11. Dock

Dock menu, top to bottom: open windows (checkmark on the front one); Recent (four); New Document from Clipboard, Open Palette, Clipboard Ring, Pause Clipboard History; then the system's Options ▸ (Keep in Dock, Open at Login, Show in Finder, Assign To), Show All Windows, Hide, Quit. `dockMenu` off removes Marxy's section.

| Setting | Values |
|---|---|
| Progress | Indexing progress drawn on the icon |

## 12. Spotlight

| Indexed item | Attributes | Opens |
|---|---|---|
| Document | Title, path, content type, words, modified, first 2 KB | Marxy at the top of the file |
| Section (H2, H3) | Heading, parent title, section text, line | Marxy at that heading |
| Collection | Name, folder, file count | Library at that collection |
| Clip (opt-in) | Pinned clips only | The clipboard ring with that clip selected |

Marxy's App Intents also appear as Spotlight actions on macOS 26. `spotlight` off deletes Marxy's items from the index; files still appear as plain documents through the system's own indexing.

## 13. Notifications

| Event | Default | Title | Actions |
|---|---|---|---|
| Any watched file changes | Off | name changed on disk | Open, Show changes |
| A background pipeline finishes | On | Pipeline “…” finished | Show result, Open source |
| A capture lands in the Inbox | On | Saved to the Inbox from app | Open Inbox |
| Indexing finishes | Off | Indexed n files | Open Library |

Banners by default; Alerts keep the actions visible until used. Permission is requested at the first qualifying event, never at launch. Focus modes and the system's per-app settings override Marxy's.

## Permissions

| Permission | Needed by | When asked | If denied |
|---|---|---|---|
| Accessibility | Clipboard ring paste; global palette reading and replacing the selection | First paste into, or read from, another app; Marxy explains, then opens Privacy & Security › Accessibility | Ring copies only; palette works on the clipboard |
| Notifications | Events above | First qualifying event | Silent; the menu bar extra still shows state |
| Files in Desktop, Documents, Downloads | Collections inside those folders | When such a collection is added or first watched; folders picked in an Open panel are granted by the pick | That collection is not indexed |
| Login item | Open at login, menu-bar-only start | When the user turns it on | Starts only when opened |
| Pasteboard access | Background clipboard history | Recent macOS releases add a prompt or setting for programmatic pasteboard reads; behaviour on the target macOS is unverified | History records only copies made inside Marxy |
| Network (outgoing) | Updates, optional link checks | No prompt outside the App Sandbox | Updates and link checks are skipped |
| Input Monitoring | Not needed: global shortcuts are registered hotkeys | Never | – |
| Full Disk Access | Not needed | Never | – |
| Automation (Apple Events) | Only if Open in Editor scripts a specific editor | Per target app, first use | Default editor used |

Accessibility-based features and system-wide hotkeys rule out the Mac App Store sandbox in practice, so Marxy ships with Developer ID signing and notarisation. App extensions are sandboxed regardless.

## Windows and Linux mapping

| macOS surface | Windows | Linux |
|---|---|---|
| Window toolbar | Same HTML toolbar; caption buttons on the right (custom title bar) | Same HTML toolbar; client-side decorations |
| Menu bar | In-window menu bar, Ctrl for ⌘, Alt access keys; or a compact menu button | In-window GTK menu bar |
| Menu bar extra | Notification-area (tray) icon with a flyout window | StatusNotifierItem (AppIndicator); many desktops show a menu only, and GNOME needs an extension |
| Clipboard ring | Global hotkey (not Win+V, which is Windows clipboard history; default Ctrl+Alt+V); paste via SendInput, no permission, but not into elevated windows | X11: hotkey plus XTest paste. Wayland: global shortcuts portal where available; synthetic paste generally not allowed, so copy-only |
| Global palette | Ctrl+Alt+Space (Alt+Space is the window menu) | Same; on Wayland the palette works on the clipboard |
| Finder Quick Actions | Explorer context menu: Windows 11 top-level entries need an IExplorerCommand handler with package identity (sparse MSIX); otherwise classic verbs under Show more options; Send To shortcuts | Nautilus scripts or a nautilus-python extension, Dolphin service menus, Thunar custom actions |
| Services | No equivalent; the global palette covers it | No equivalent; the global palette covers it |
| Quick Look | Explorer preview handler (IPreviewHandler) and thumbnail provider (IThumbnailProvider) | GNOME Sushi has no plug-in API; thumbnailer entries for icons only |
| Share extension | Share target needs package identity; otherwise Send To and a `marxy://` capture link | No system share sheet; `marxy://` links, drag and drop, the CLI |
| Shortcuts actions | `marxy` CLI and `marxy://` URLs for Power Automate and scripts | CLI and a D-Bus interface |
| Dock menu | Taskbar Jump List (tasks and recent files); taskbar progress | `.desktop` Actions for static items; launcher progress through the Unity LauncherEntry API where the dock supports it |
| Spotlight | Windows Search indexes files; no rich app results without a protocol handler or property handler | GNOME Shell search provider and KRunner, both over D-Bus |
| Notifications | Toast notifications with buttons (needs an AppUserModelID, set by the installer's Start menu shortcut) | libnotify with actions where the notification server supports them |

## Tauri v2 implementation notes

What Tauri provides, and what has to be native code bundled into the `.app`. Where I am not sure how Tauri exposes something, it says so.

### Provided by Tauri and its official plugins

| Surface | Mechanism |
|---|---|
| Menu bar | `tauri::menu` (`MenuBuilder`, `SubmenuBuilder`, `MenuItem`, `CheckMenuItem`, `IconMenuItem`, `PredefinedMenuItem`); set with `app.set_menu`; handle with `on_menu_event` by item id. Accelerators are strings such as `CmdOrCtrl+Shift+P`. `PredefinedMenuItem` covers About, Services, Hide, Hide Others, Show All, Quit, Undo, Redo, Cut, Copy, Paste, Select All, Minimize, Maximize (Zoom), Fullscreen and Close Window. On macOS the first submenu is the app menu. Marking submenus as the Window and Help menus (so macOS adds tiling items and the help search field): the underlying `muda` crate has `set_as_windows_menu_for_nsapp` and `set_as_help_menu_for_nsapp`; confirm the Tauri wrapper exposes them in the pinned version. Option-key alternates are not in the API as far as I know. |
| Context menus | `Menu::popup` on a window (also from JavaScript through `@tauri-apps/api/menu`) |
| Menu bar extra | `TrayIconBuilder` (feature `tray-icon`): `icon_as_template(true)`, a menu, `show_menu_on_left_click(false)`, `on_tray_icon_event` with click position and icon rect; `set_title` can show text beside the icon on macOS |
| Popover | No NSPopover. A borderless, always-on-top webview window positioned from the tray rect (or `tauri-plugin-positioner`), hidden on blur. Vibrancy through window effects (`Effect::Popover`, `Effect::HudWindow`, `Effect::Menu`) needs a transparent window, which on macOS needs `macOSPrivateApi`. The macOS 26 glass material is not exposed as far as I know; vibrancy approximates it. |
| Menu-bar-only mode | `set_activation_policy(ActivationPolicy::Accessory)` hides the Dock icon |
| Global shortcuts | `tauri-plugin-global-shortcut`; system hotkey registration, so no Input Monitoring permission. Report a failed registration in Settings. |
| Clipboard | `tauri-plugin-clipboard-manager`: read and write text, write HTML with plain-text fallback, images. It has no change events: watch `NSPasteboard` `changeCount` on a short timer in Rust (objc2) and skip `org.nspasteboard.ConcealedType`, `TransientType` and `AutoGeneratedType` entries. Multi-representation writes beyond HTML plus text (RTF, custom types) need native code. |
| Notifications (plain) | `tauri-plugin-notification` for title and body |
| Deep links | `tauri-plugin-deep-link`: `marxy://` declared in config and written to Info.plist at bundle time (runtime registration is not supported on macOS); `on_open_url` receives them. Extensions hand work to the app this way. |
| Single instance | `tauri-plugin-single-instance`; macOS already keeps one instance for normal launches, so this matters mostly on Windows and Linux, combined with deep links |
| Open at login | `tauri-plugin-autostart` (LaunchAgent or AppleScript launcher on macOS). The modern `SMAppService` login item is not what it uses, as far as I know. |
| File associations | `bundle.fileAssociations` for `.md` and `.markdown` (role Viewer); opened files arrive as `RunEvent::Opened` |
| Dock progress | `set_progress_bar` for indexing progress. Confirm in the pinned version. |
| Window chrome | `titleBarStyle: "Overlay"`, `hiddenTitle`, traffic-light position, `data-tauri-drag-region` for the HTML toolbar |

### Needs native code (Swift or Objective-C targets, or objc2 in Rust)

| Surface | What to build | Notes |
|---|---|---|
| Window toolbar | Nothing native if the HTML toolbar is kept | A real NSToolbar (free customisation sheet and autosave) would need objc2 code against the window's `ns_window()` and an event bridge to the webview; see open questions |
| Clipboard ring and global palette panels | A non-activating `NSPanel`, so the front app keeps its selection and key status | Tauri windows are `NSWindow`s; the community `tauri-nspanel` plugin converts one, check its v2 support. Accessibility calls (`AXIsProcessTrustedWithOptions` to prompt; focused element's selected-text attribute to read and set; `CGEventPost` for ⌘C and ⌘V fallbacks) through objc2 or FFI from Rust |
| Notification actions | `UNUserNotificationCenter` with a category holding Open, Show changes, plus a delegate for the response | As far as I know the notification plugin's action types are documented for iOS and Android only. Requires a signed bundle with an identifier. |
| Dock menu | `applicationDockMenu:` on the application delegate | Tao owns the delegate; adding the method needs objc runtime work or a nib referenced by `AppleDockMenu` in Info.plist. Not a Tauri API as far as I know; check current releases first. Recent documents through `NSDocumentController` `noteNewRecentDocumentURL:`. |
| Services | `NSServices` entries in Info.plist (merged from `src-tauri/Info.plist`), a services provider object registered at launch with one method per service (`sendToInbox:userData:error:` and so on), then `NSUpdateDynamicServices()` | The provider is an Objective-C object: objc2 `define_class!` in Rust or a small linked Objective-C file. Services launch Marxy if it is not running. |
| Finder Quick Actions | Action extensions (`com.apple.ui-services`, role Editor, `NSExtensionServiceAllowsFinderPreviewItem`, a preview icon name, an activation rule on Markdown types), one per action | Extensions are always sandboxed and receive only the selected files. They either do the work with the shared Rust core linked as a static library, or write a request to the App Group container and open a `marxy://` link. |
| Quick Look | A preview extension (`QLPreviewProvider` returning HTML, macOS 12 and later) and a thumbnail extension (`QLThumbnailProvider`) | HTML replies render without running scripts, as far as I know, so render Markdown to HTML in the extension with the Rust renderer and embed Marxy's CSS and fonts. A view-based extension hosting `WKWebView` is the alternative. Import the Markdown type declaration if the oldest supported macOS does not declare it. |
| Share extension | `com.apple.share-services` with an activation rule (one URL, text, up to 20 files of Markdown, text, CSV, JSON) | Writes into the App Group container; recent macOS versions prompt when an app reads another app's group container unless the group identifier is prefixed with the team ID |
| Shortcuts | App Intents (Swift): intents, App Entities with queries for documents and collections, App Enums for pipelines and formats, an `AppShortcutsProvider` | Xcode extracts intent metadata at build time into the bundle. Marxy's main binary is built by Cargo, so the practical route is an App Intents extension built by Xcode and embedded, calling the Rust core or the app over XPC or the App Group. Whether intents in an extension can do everything needed here (opening a document in the app, for instance) needs a spike. |
| Spotlight | `CSSearchableIndex` items with `CSSearchableItemAttributeSet`, a domain per collection | Callable from Rust through objc2 Core Spotlight bindings. Selecting a result calls `application:continueUserActivity:restorationHandler:` on the delegate, which Tauri does not expose as far as I know; same delegate problem as the Dock menu. |

### Build and signing

Tauri's bundler builds the app; it does not build app extensions. Plan an Xcode project for the extensions (Quick Look, thumbnail, share, action extensions, App Intents), built in CI, copied into `Contents/PlugIns` (check whether `bundle.macOS.files` copies bundle directories intact or whether a post-build step is needed), each signed with its own entitlements before the app is signed, then the whole app notarised. Every extension carries the App Group entitlement.

## Open questions

1. **Toolbar: HTML or NSToolbar?** HTML keeps one implementation for all three platforms and matches the design exactly; a real NSToolbar gets AppKit's customisation sheet, overflow and accessibility for free but needs a native bridge and differs from Windows and Linux. The prototype assumes HTML.
2. **Clipboard ring shortcut.** ⌥⌘V takes Finder's Move Item Here from every app while registered. Keep it as the default (with the recorder warning), or ship ⌃⌥V or ⇧⌘V?
3. **Global palette shortcut.** ⌃⌥Space can collide with Input Sources for multilingual users. Detect enabled input sources at first run and pick another default?
4. **macOS 26 overlap.** Spotlight now has clipboard history and runs actions. Marxy's ring has to justify itself on source tracking, Markdown awareness and transforms; should Marxy also feed Spotlight's clipboard surface instead of only running its own?
5. **Pasteboard privacy.** Confirm on the target macOS release how background pasteboard reads are gated, and design the first-run explanation around it.
6. **Option-letter shortcuts.** ⌥Z (Soft Wrap) types a character on many keyboard layouts. Keep it for VS Code familiarity, or move it?
7. **Finder and Services defaults.** 08-settings ships Convert to Markdown Table and Run Pipeline (Services) off by default; this page honours those settings, so those actions only appear after they are switched on. Agree the defaults.
8. **Distribution.** Developer ID only, or also a reduced Mac App Store edition without Accessibility features?
9. **App Intents in an extension.** Spike whether an App Intents extension can open a document in the running app and return entities quickly enough for Spotlight.
10. **Shortcuts for services.** Services cannot reliably carry default key equivalents; is a Marxy-side global shortcut for New from Clipboard (`globalCapture`) enough?
