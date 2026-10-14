# 09 — The app shell: DOM, state, keys, outline, find, notices, Source mode

`apps/desktop/src/`. Chrome at rest is zero: at rest the DOM contains the article and nothing
visible else. Everything below is summoned and dismissed.

## DOM skeleton (D-A19)

```html
<body data-marxy-mode="rendered" data-marxy-variant="dark">   <!-- dark is primary (ADR-0024) -->
  <main id="marxy-main">
    <section class="marxy-pane" data-marxy-pane="0" data-marxy-focus>   <!-- one pane per document shown (ADR-0057) -->
      <article id="doc" class="marxy-article" data-marxy-s="0" data-marxy-e="…"></article>
      <div id="marxy-source" class="marxy-source-mount" hidden></div>   <!-- CodeMirror mounts here in Source mode -->
      <div class="marxy-find-slot"></div>                   <!-- empty and not drawn at rest; Rendered find fills it -->
      <div id="marxy-notices" role="status"></div>          <!-- empty at rest; last, so it can pin to the pane's foot (§Notices) -->
    </section>
  </main>
  <dialog id="marxy-palette"></dialog>                      <!-- §07 -->
  <dialog id="marxy-outline"></dialog>
  <div id="marxy-find" hidden></div>
</body>
```

No element outside `#marxy-main` is visible unless its state is open. Folded, there is no toolbar,
tab bar, status bar or sidebar element in the DOM at all (the workspace below puts them in only while unfolded), so the "chrome at rest" gate is a DOM
assertion, not a screenshot judgement.

**Two documents side by side** (ADR-0057). `#marxy-main` takes `data-marxy-split` and becomes a grid of
two columns (`ratio fr` and `1 − ratio fr`), and a second `section.marxy-pane[data-marxy-pane="1"]`
follows the first with the same four children, whose ids end in `-2` (`doc-2`, `marxy-notices-2`,
`marxy-source-2`). Each pane of a split scrolls on its own (`overflow-y: auto; height: 100vh`), and its
Source mount covers only its pane. `data-marxy-focus` marks the focused pane's section and no other.
The first pane is permanent: its elements keep their ids, and closing the left pane shows the right
pane's document in it. Each pane is a size container, so an article's margins (`--marxy-room`) are
measured against its own pane. With one document none of this is visible: one pane fills
`#marxy-main`, and there is no divider element and no split attribute.

**The kind (K-05a; ADR-0060 items 6 to 9).** Each pane's `section.marxy-pane` carries `data-marxy-kind="<kind>"`, one of
the fourteen, once its document is read and before its first text. It is decided once per open, in `document/open.ts`,
by `detectFileKind` over the file's first `KIND_HEAD_BYTES`, the reader's `[[kind]]` rules (`config.toml`) and *show as*
(`kinds.json`): *show as* beats a rule, a rule beats detection. A missing or unreadable `config.toml` or `kinds.json`
is as if empty. A live reload, an edit and a save never decide it again; opening the file again does, and a failed open
leaves the attribute off. The full result, with every reason that fired, is `OpenPath.detected()` (a pane's
`content.detected()`), and `Pane.kind()` reads the attribute. The default theme has a rule on it for three kinds
(K-05b, `docs/design/05-theme.md` §Kind profiles): `article`, `readme` and `report` change the face, size, line box
and column of the pane's Rendered page, and the Source editor in the same pane keeps the reader's sizes. The launch's
document is decided before its first paint, from the bytes in hand and the config read the launch makes anyway
(K-05a.1), so a profile does not move the page after first text: the launch shift is 0 by
`docs/taste-review/2026-10-k05b/cls-launch.mjs`. A `kinds.json` still unread then is not waited for; the kind is decided
again when it arrives, and only if the answer differs. The palette's kind icon reads the index entry's `readerKind`, and the
path alone only for an entry that has none.

**The workspace (W-02; ADR-0058).** The window is *folded* (the skeleton above, exactly) or *unfolded*. Unfolding
(`AppHandle.workspace().unfold()`, from `workspace/state.ts`) sets `data-marxy-workspace="unfolded"` on `<body>` and
puts six empty `div[data-marxy-workspace-region]` into `<body>`: `sidebar`, `toolbar`, `tabs`, `strip` before
`#marxy-main`, `inspector` and `status-bar` after it. Folding takes them out and removes the attribute, so a folded
page has neither: nothing is hidden by style, and a page with no attribute is the folded window (the aesthetics gate
reads the attribute from the page and judges every other page as folded). A region the reader has not docked stays
in the page, `hidden`, and takes no room. The regions hold no content of their own: a story that has some registers it
with `Workspace.fill(region, mount)` (W-05; `workspace/fill.ts` is the one place that happens), and `mount(el)` runs
whenever that region's element is made (each unfold) and its disposer when it is removed (fold, destroy), so a folded
page has none of it.

The grid is `base.css`, under `[data-marxy-workspace="unfolded"]` only. `<body>` has three columns: the two side
columns are the same width (the wider of the sidebar and the inspector, 252 and 300 px), so the middle column and the
reading column in it stay centred on the window and do not move when a panel is docked or taken away. They give way
only when the middle would fall below 45 characters and a gutter each side (twice that with two panes), so at the
two-column floor (929 px at the default size) both panels together still leave the column its 45 characters. The
bands above the panes and the status bar are sticky; the window is still the scroller. `#marxy-main` is the middle
column, so `splitRefusal` measures it as it always did and, unfolded, names the window width that includes the panels.

**Toolbar (W-05; ADR-0065).** The first fill: unfolded, the `toolbar` region holds
`div.marxy-toolbar[role="toolbar"]`, and folded there is no such node. It is a table (`workspace/toolbar.ts`,
`TOOLBAR_ITEMS`) of doors, each naming the registry command it runs, drawn left to right only when that command is
registered (`visibleItems`); a panel toggle also needs a fill in the region it opens. Today that draws Back, Forward,
the title (the focused document's name, a dot while its store is dirty, its folder; "Untitled" for a scratch
document), the Read / Split / Source switch (`view.mode-*`), Copy with its *Copy as* chevron (`copy-as.<copy_format>`
and `copy-as.menu`), Transform (`transform.open`, W-21: it opens the palette on `>Transform`) and Find (`view.find`).
A story that wants a control registers its command and the control appears with no change here: `document.new-menu`
(W-14), `kind.chip` (K-07), `export.menu` (W-15), and `view.toggle-sidebar` and `view.toggle-inspector` (W-03, with
the panel's fill). With Transform drawn the default row is about 510 px wide: it fits the middle column from a
1024 px window, and in the 929 px window it scrolls with the edge fade W-04 draws, as it does at `chrome_size` 26. There is no Extract
button and no theme switcher (06-reconciliation rows 3 and 4).

Each control is a `<button>` named by its command's title, with the key in its tooltip; a press runs
`command.when(ctx)` then `command.run(ctx)` as the palette does. A control whose `when` is false is
`aria-disabled`, not removed. The row is one tab stop (roving `tabindex`), the arrows, Home and End move within it,
Return and Space press. The switch is a `radiogroup`: Split is checked when two panes show one path, else the
focused pane's mode. A press does not take focus or the selection from the page (`mousedown` is cancelled), so Copy
copies what was selected. State is exposed as `aria-disabled`, `aria-checked` and `aria-pressed` and nothing here
styles it: `base.css` has the layout (a flex row; the title takes what the controls leave and gives way first) and the
look is W-04's.

**The kind chip and the strip (K-07; ADR-0060 items 3 and 6).** Two more fills, both made on unfold and gone when folded
(`workspace/kind-chip.ts`, installed in `fill.ts` after the toolbar's). The chip is the toolbar's `kind` door, drawn once
`kind.chip` is registered: the kind's glyph (K-18) and name, following the focused pane's `data-marxy-kind` (so a kind
decided late, or again by a reopen, shows at once). With no document the door is taken out of the row. In a row too narrow for it, the toolbar folds
it into *More* (below). Pressing it runs `kind.chip`
(`commands/kind-chip.ts`), a menu in the verb menu's chrome: first why the file is the kind it is (the `Reason`s
`detectFileKind` returned at open, the decisive one first, as quiet rows that do nothing), then *Show as* each kind,
*Show as detected* and *Always open this folder as…* (a second list). A choice runs K-04's command and then reopens the
file, so the kind takes effect now (`AppHandle.open`: unsaved edits meet its own prompt); only `kinds.json` or
`config.toml` is written, never the document. The `strip` region holds the focused kind's tools (`workspace/strip.ts`:
`STRIP_TOOLS`, at most four per kind, each naming a command or `null`; `toolsFor` keeps those whose command is
registered, or the reader's `[strip]` list). A kind with no tool puts nothing in the region and hides it from that
emptiness, on the element, not through `setPanel`: the remembered arrangement is unchanged.

**More (K-07).** When the toolbar row would overflow, the doors in `FOLD_ORDER` (`workspace/toolbar.ts`: Transform, Export,
New, the kind chip, Find, lowest first) fold into one *More* button at its end, measured on the element so no frame shows
both. Its menu lists each folded door's command in the verb menu's chrome, so every action stays reachable by mouse and
keyboard and nothing is clipped. Back, Forward, the title, the switch and Copy never fold; where even they do not fit
(`chrome_size` 26 in the narrowest column) the row scrolls as before.

**Tabs (W-06; ADR-0058 item 5).** Unfolded, the `tabs` region holds `div.marxy-tabs[role="tablist"]`
(`workspace/tabs-view.ts`; the list itself is `workspace/tabs.ts`, pure). A tab is a document a pane has shown since the
window unfolded: the kind's glyph, the file's name, an unsaved dot, and a close button; its accessible name adds the
folder (`A.md, in notes`) and says when it has unsaved changes or is shown in the other pane. The row follows the panes
and never leads them: every signal (a document landing, a save, a Save As, focus moving) re-reads what the panes show
(`TabList.sync`), so a document the reader refused to leave at the unsaved-changes prompt gets no tab, and a Save As
(the same store under a new path) moves its tab instead of adding one. A new tab goes right of the tab the reader was on,
the active tab is the focused pane's document, and the other pane's document has `data-marxy-tab-shown` (as does the
active one if it is shown, so both tabs of a Split are marked and one is `data-marxy-tab-active`). At most 24 tabs;
one more drops the oldest that no pane shows. A scratch document (`untitled`) and a bundled page (`marxy:`) are tabs
only while a pane shows them. Folding forgets the tab list; nothing is remembered across a fold or a launch.

**A tab keeps no unsaved edits** (the author's ruling of 2026-10-11; a version that keeps them is W-06.1). Only a
document a pane shows can be dirty, so quit, fold, a closed pane and the close guard see what they always saw.
Clicking a tab is `focused.content.open(path)` and nothing else, so leaving a document with unsaved edits asks (Save,
Discard, Dismiss) exactly as opening over it does, and Dismiss leaves the pane, the buffer and the row as they were.
A tab whose document the other pane shows is not opened a second time: the click moves focus to that pane. The close
button on a tab no pane shows forgets it; on a document a pane shows it opens the nearest other tab there first
(the right neighbour, else the left, preferring one the other pane is not showing), asking the same way, and the tab
goes once that has landed. Below two tabs the band hides itself (`region.hidden`, on the element, as the strip does;
`workspace.arrangement.tabs` is unchanged), and the last tab has no close button. In a row too wide for the window each
tab shrinks to six ems and the row scrolls with its edges faded, the active tab scrolled into view; the page never
scrolls sideways. The row is one tab stop; arrows, Home and End move within it, Return shows the tab and Delete closes
it. Palette commands: `tab.next`, `tab.previous`, `tab.close` (no keys: ⌘W closes the window and ⌃Tab is the author's
to rule), available only while the row holds two tabs or more.

**Inspector (W-09; ADR-0058 item 5).** Unfolded, the `inspector` region holds `div.marxy-inspector`: a `role="tablist"`
strip and the selected tab's `role="tabpanel"` (`workspace/inspector.ts`). The strip is a table:
`registerInspectorTab({ id, title, mount })` adds a tab and returns its withdrawal, a tab is drawn only while its builder
is registered, and the tab shown is kept in memory for the session, never written. Links is registered beside the fill in
`workspace/fill.ts`; Outline (W-10), Metadata (W-17) and Versions (V-06) register theirs and change nothing here. A panel
is mounted when its tab is selected and let go when another is, and does no work while the region is hidden. The whole
region is one tab stop: Left and Right move between tabs, Down enters the panel's rows, Up and Down move through them,
Up from the first row returns to the tab strip.

*Links* (`workspace/links-tab.ts`) lists, for the focused document, **Links**: each link as written (the link text, the
real destination as text and never an anchor, and `linkHostMismatchLabel`'s warning when the text names another host),
a row that moves the document to the link (`handle.open(path, { at })`, the outline's way); and **Paths mentioned**
(`pathMentions`, the backticked paths with a slash that `x-paths` prints), each *found*, *not found* or *not checked*.
A path is looked for beside the document and in its repository root (`~/` in the home folder) with `shell.stat`, which
answers null for a missing path and also for a symlink or a deny-listed folder, so "not found" is said only when every
folder above the file is a real, listed one; otherwise the row says "not checked". Nothing is fetched or opened from
here. A file that opens in Source and has not been parsed (`store.parsed()` false) is never parsed for the tab: its paths
come from the bytes and the link list reads "Links are listed for Markdown" until the reader's first switch to Rendered
makes the parse. Backlinks are not in the tab (they need a scan of other files; the author has not ruled).

**Status bar (W-11; ADR-0058 item 6, mock-v2 01-workspace).** Unfolded, the `status-bar` region (26 px, `--marxy-ws-status-h`) holds
`div.marxy-status-bar[role=group]` (`workspace/status-bar.ts` reads the page; `workspace/status-facts.ts` holds the rules, under node).
Left: the **kind** ("Report", "Log", "Code · Rust"), **one measure** for that kind (words for `article`, `report`, `readme`, `docs`,
`notes`, `transcript` and `book`; lines for every other kind; W-16 makes it the reader's choice), **where you are** (`Ln 23, Col 14` in
Source; in Read the heading of the section under the reading line, ADR-0018's coordinate, and nothing above the first heading) and the
bytes' **encoding and line endings** ("UTF-8 · LF"). Right: the **theme** (Night, Paper, Ink, Dusk, Sepia, Fjord, High contrast) and the
**text size** in pixels. Every label is `source/frame-facts.ts`'s, so Source's frame and the bar read alike; a count is the
focused pane's document, in Source the editor's text. An item is a `<button>` only where something is behind it: *where you are* opens
the Outline tab once it is registered (`selectInspectorTab('outline')` docks the inspector and selects it; until then, and in a narrow
window over Source where the inspector cannot show, it is plain text), and the theme opens the palette on `>Theme`; every other item is
a `<span>`. A click leaves focus where it was. The bar is not a live region and announces nothing; it writes nothing and keeps no
state. While the first walk of a root Marxy has never indexed (`baselineMs` undefined) runs longer than 600 ms the bar shows "Indexing…" (and no pill), and when it ends the
one notice says "Indexed N documents. Your files are unchanged."; a walk that ends sooner, and every later walk of an indexed root, says nothing, and folded there is no bar and
no pill. Cost: a keystroke in Source reaches the bar through one `updateListener` and one redraw a frame (an O(log n) caret lookup);
the word count of a prose file is cached against the text, made at once under 64 KB and otherwise 300 ms after typing stops, in
6 ms slices. Read scrolling compares one number against the headings, listed once per parse. The bar adds no static import of
CodeMirror (MARXY-33): the editor and CodeMirror are looked up once Source is showing.

**Sidebar (W-07; ADR-0058).** The `sidebar` region (252 px, `--marxy-ws-sidebar-w`) holds `nav.marxy-sidebar`
(`workspace/sidebar-view.ts`; the lists are `workspace/sidebar.ts`, pure). Two sections, each a header button that folds
it (`aria-expanded`; folded, it keeps its header and a quiet count): **Recent**, the last eight documents opened, newest
first, and **Pinned · Changed since you read**, the pinned documents and then the files in watched folders modified
after they were read. They are C-12's lists (`emptyStateSections`, `changedSinceRead`: no rule of the sidebar's own),
so a document is in one list only, and a row is the kind glyph, the title and a quiet age (`relativeAge`, the file's
modified time as in the palette); a changed file's age is in the accent. A section with no rows is not drawn. Nothing
reads the disk: the rows come from the palette's feed and session and the index service's watch state, so a pinned or
recent file the feed's scope cap leaves out has no row, as in the palette. A click or Return opens the row in the focused
pane (`AppHandle.open`: the unsaved-changes prompt, history and read time are the open's own); `Mod`-click or `Mod+Return`
opens it beside, in a pane made if need be. `Alt`-click on a header folds or opens every section as the clicked one
does. A *Library* row opens the sidebar only when the command `library.open` is registered (Q-03 registers it); there is
a Smart-collections section only when `collection.toml` has a query (Q-07, below) and no pin control (the palette's `Mod+.` stays the only
one). The list is one tab stop; arrows, Home and End move within it; each row and header has an accessible name (title,
pinned or changed, age in words). The sidebar redraws when a document opens or saves, the index patches, and when the
pointer or focus comes back after a pin made in the palette; the palette mounts after the app, so a sidebar made before
it looks again every 200 ms until it exists. The folded sections are `sidebar: { collapsed: [...] }` in `workspace.json`,
read when the sidebar is first drawn (never at launch), written when a section is folded, unknown ids dropped. With
the sidebar docked or undocked the reading column does not move (the side columns are one width, see the workspace
grid above). This is also what makes `view.toggle-sidebar` (`Ctrl+Mod+S`), the toolbar's sidebar toggle and the left
edge's peek appear.

**Repositories and Folders (W-08).** After Pinned, two more sections, each a header that folds like the others
(`repos`, `folders` in `SIDEBAR_SECTION_IDS`; `workspace.json` keeps them). They list the index service's roots
(`IndexService.roots()`): a root is a **repository** when its own checkout holds a `.git` (some entry of it has a
`checkoutKey` whose checkout is the root), and then the checkouts of one repository (git worktrees, C-15's group) are one row
with a quiet "N checkouts" when there are several, a branch glyph (the glyph only says repository; the branch's name waits for
W-18's git facts) and a quiet count of the files changed since read, counted through the palette's feed and once per path
inside the repository however many checkouts hold it. Every other root is a **folder**. A section with no rows is not drawn.
A row opens inline as a tree (`role="tree"`; each row a `treeitem` with `aria-level`, folders `aria-expanded`), to any depth,
with chevrons and indentation guides. A folder is listed with `readDir` when it opens, one level and nothing deeper, folders
first and then files by name; closing a folder forgets what was open under it. An open folder lists again when the index
patches a path appearing or going away under it, or a walk ends, so it shows the disk; a modified file costs no read. A file
row opens in the focused pane (`Mod`-click beside) and carries the kind glyph (from the index's entry, else the name; no file
is read to draw a row) and, when it changed since read, a dot and "changed since you read" in its accessible name. The tree
is part of the sidebar's one tab stop: arrows move, → opens a closed folder or steps into an open one, ← closes an open folder
or steps out to its parent (on a section header, ← folds and → opens). A folder shows at most 500 children and says how
many it does not draw. Which folders are open is held while the window lives; a launch starts closed. `readDir` leaves out
symlinks and deny-listed names without a count, so the tree can show fewer names than the disk holds; a count needs a
`shell-api` field and is its own story. A folder or repository row has a menu (right-click, the context-menu key or Shift+F10)
with one action, *New file here* (W-14): it opens a new document whose Save As starts in that folder, and writes nothing (see
*New file, New file here and Fork this file*, below).

**Smart collections (Q-07).** After Folders, a **Smart collections** section (`smart` in `SIDEBAR_SECTION_IDS`; `workspace.json`
keeps its fold) lists the `[[query]]` tables of `collection.toml` by name, in file order (`CollectionHandle.queries()`, the
same read as the folders; a hand edit updates the section, a broken one keeps the last good list). With no query the
section is not drawn, and there are no built-in rows: near-duplicates and broken paths wait for Q-06 to make `is:dup` and
`is:broken` match. A row is a glyph, the name and a quiet count; the query is its tooltip. A click opens the library on
the query over *All files* (`libraryFor(handle).open({ query })`; a library already open takes the query in place). The
count is the library's own first answer for the same query (`queryContext` is shared), computed from the index on each
change and only while the section is open: a folded section counts nothing. A query that needs files read (a word of two
letters or more is searched in the lines of files; `words:`, `has:` and `tasks:` measure them) has no count in the
sidebar, because a row never reads a file; the library gives its number. A row's menu (right-click, the context-menu key
or Shift+F10) has one action, *Edit in collection.toml*, which opens the file in Source with the table's first byte at the
reading line (`queryRange`). Nothing here renames or deletes a query.

**Remembered panels.** Which regions are docked is `workspace.json` in the data directory beside `layout.json`
(`{ version, panels: { sidebar, toolbar, tabs, strip, inspector, status-bar }, sidebar?: { collapsed: [...] } }`; same version guard and quarantine; `sidebar` is absent until a section is first folded, W-07).
It is read when the reader unfolds (the first time in a session) and written when they fold or quit while unfolded,
never at launch. With nothing remembered every region is docked except the inspector, which opens by default only in
a window of 1600 px or more (ADR-0058 item 6). The command `view.toggle-workspace` ("Fold or unfold the workspace")
is on `Mod+\` (ADR-0058 item 1, the mockup), a pane chord in the table below; D-07's Open beside moved to
`Mod+Alt+\` to make room (the lead's ruling, the author's to veto before merge), and stays in the palette as
"Open beside…". `Esc` folds the unfolded window (W-03, below).

**Peeking (W-03; ADR-0058 item 5).** Folded, the pointer resting within 8 px of the left, right or top edge of the
window for 150 ms shows that edge's panel (the sidebar, the inspector, the toolbar) as an overlay: one region at a
time, `position: fixed` over the page with the theme's shadow, a fade of 150 ms and none under reduced motion. The
panes and the reading column never move for it. Leaving both the edge and the panel hides it. A click inside it
docks it: the window unfolds with that region and the toolbar shown (`Workspace.dock`), and folding again remembers
that. The side bands win over the top band at a corner; the bottom edge never peeks. A region peeks only once
something fills it (`Workspace.hasFill`), so today only the top edge works; the sidebar and inspector light up with
their stories and no change here. No peek with a button held (a drag-select near the edge), with a dialog open, or
while unfolded: the pointer is listened to only while the window is folded, and a folded window at rest has no peek
element and draws nothing. `<body data-marxy-peek="<region>">` names the peeking region, and the aesthetics gate
allows exactly that one region in a folded page that carries it. Unverified outside the built app: whether the
webview receives pointer events in the last pixels of a window's edge, where macOS keeps the resize handle.
There is no floating sidebar button and no first-run hint: either would put a control in the folded window at rest.

`Mod+Ctrl+S` (the sidebar) and `Mod+Alt+I` (the inspector) dock from a folded window and toggle the panel when it is
unfolded, from a Source editor too (pane chords, `Ctrl` honoured for the first). They do nothing until something
fills the region. Off a Mac `Ctrl+Cmd+S` has no spelling; the palette command is the route. `Esc` folds when nothing
else owns it: no selection (a selection clears first), no palette, outline, find or verb menu open, and not in an
editable (a Source editor, a text field). `Esc` is therefore shared by `selection.clear` and `view.fold-workspace`,
whose conditions are never both true; the keys table (`test/keys-table.test.mjs`) declares the pair.

## State

There is no `AppState` record and no `state.ts`. State lives in three places, each owned by one object
(ADR-0037 and its Amendment 1):

- **The document store** (`apps/desktop/src/document/store.ts`): what is true of the bytes. Its path,
  `disk` (the bytes last read or written), `buffer`, the parse (`ast`, `nodeMap`), one undo history
  for both modes, and a `version`. `dirty` is derived (`buffer ≠ disk`). Every change is one of its
  transitions: `open`, `reload`, `apply`, `commitSource`, `undo`, `redo`, `save`, `rename`, `close`.
  Readers call `snapshot()` or `subscribe()`. One store per open path, however many panes show it: the
  registry (`document/registry.ts`) hands the open store to the next view of that path and closes it
  when the last view lets go.
- **The view** (`apps/desktop/src/view/rendered-view.ts`): how one article shows a store. The **mode**
  (Rendered or Source) and the Source editor, the anchor the reader is held at, the layout (the mount,
  the typesetter, the grid, the block list). It subscribes to the store it shows and sets the page
  again after each transition, mapping its anchor through the edit (ADR-0037 §6). One per pane.
- **The app instance** (`apps/desktop/src/app.ts`, the composition root): the **layout** and the
  **focused pane** (`pane/pane-set.ts`, `AppHandle.panes()`: one pane or two, their ratio, which one has
  focus) and the overlays. `startApp` builds the instance from a shell and connects its parts: the
  panes (`pane/index.ts`: for each, a view and an open path, `document/open.ts`), live reload
  (`document/live-reload.ts`), reading persistence (`position/reading-persistence.ts`), trust
  (`trust/controller.ts`), the launch measurement (`startup/measure.ts`) and the selection.

No module keeps any of this at module scope (`apps/desktop/test/module-state.test.mjs`).
`AppHandle.dispatch(action)` routes `apply`, `undo`, `redo` and `save` to the focused pane's store and
`toggle-mode` to its view; `open`, `currentPath`, `document` and `save` are the focused pane's too.
Overlays are exclusive: opening one closes another. `Esc` closes the open overlay, else clears the
selection, else does nothing.

The Rendered selection is the window's one and acts on the focused pane's article (D-06): it listens on
every pane's article, each view tells it when its page is set, and focusing another pane clears it, so
copy, the operations and `Mod+Z` reach the focused pane's document. Still bound to the first pane rather
than the focused one, until the Phase D story named moves them: the window as scroller and the reading
persistence (D-05, D-12), notices other than a pane's own region
(D-10). The close guard is per document, never the focused pane's alone (D-08, §Close). The window title
is the focused pane's document: a document opened in the other pane does not take it, and focus moves
it. Each pane's open path keeps its own live-reload
watch on the store it shows, closed when that pane lets the store go, even while the other pane still
shows it; one watch per store, however many panes, is D-10's.

## Keyboard map

`Mod` is `⌘` on macOS and `Ctrl` on Linux (and Windows later). Bound in one table
(`keys.ts`); the palette lists every command with its key so the map is discoverable without
chrome.

| Key | Action | Notes |
| --- | --- | --- |
| `Mod+P` / `Mod+K` | palette (documents) | W-19: `Mod+K` is the same palette; either again closes it |
| `Mod+Shift+P` | palette on commands (`>`) | W-19: the command list, including the operations; again closes it |
| `Mod+/` | palette on the transforms (`>Transform`) | W-19, W-21: one row per transform core can run (`Transform: <name>`), none that is `NOT_YET`; again closes it; in Source `Mod+/` opens the palette, it does not toggle a comment. A choice opens the result sheet (below) |
| `Mod+1` / `Mod+2` / `Mod+3` | Read / Split / Source | W-19 (`commands/view-mode.ts`): Read and Source set the focused pane's mode and do nothing when it is already there (`Mod+E` flips). Split shows the document twice, Read left and Source right; with two panes over two files it refuses and says why. Inside Split (two panes, one document), Read and Source end it in one pane in that mode, and Split again goes back to one pane in Read (F-44); the pane that closes has its Source text folded into the store first, and a close that would lose text asks as `Mod+Shift+\` does |
| `Mod+E` | toggle Rendered / Source | position kept (§08) |
| `Ctrl+Mod+S` / `Mod+Alt+I` | dock or undock the sidebar / the inspector | W-03: from folded they unfold with that panel; physical keys, so they work from Source (§Peeking) |
| `Mod+F` | find | `Enter` next, `Shift+Enter` previous, `Esc` closes and keeps the reading position |
| `Mod+Shift+O` | outline | `↑/↓ Enter`, `Esc` |
| `Mod+Alt+N` | go to the newest notice | U-02: a pane chord, by physical key, so it works from Source; `Tab` and the arrows move among the notice's buttons, `Esc` dismisses it and gives focus back (§Notices) |
| `Mod+[` / `Mod+]` | back / forward | history stack (§07) |
| `Mod+S` | save | byte-faithful, atomic |
| `Mod+N` | new file | W-14: an untitled document that opens in Source, in the pane the window's rule names; nothing is written until Save As (E-13). Runs from a Source editor too |
| `Mod+Shift+N` | fork this file | W-14: writes the open file's bytes (with any unsaved edits) beside it as `name (fork).md`, never over a file, and opens it; offered only on a file on disk. Marxy is one window, so this is not *New Window* (the mock's menu bar) |
| `Mod+Z` / `Mod+Shift+Z` | undo / redo | in Rendered mode: the operation history (§01); in Source: CodeMirror's |
| `Cmd+Alt+[` / `Cmd+Alt+]` (`Ctrl+Shift+[` / `Ctrl+Shift+]` elsewhere) | fold / unfold the folds on the caret's line | K-10a: CodeMirror's own keys, in Source only; a placeholder is clickable but not a tab stop, so Tab leaves the editor however many folds there are |
| `Mod+Shift+E` | open in external editor | at the current block's line |
| `Mod+=` / `Mod+-` / `Mod+0` | body size ±1 px / reset | persisted in config; re-layout |
| `Alt+↑` / `Alt+↓` / `Alt+Shift+↑` | move block selection / select parent | §03 |
| `Alt+←` / `Alt+→` | back / forward | the Linux browser convention; also `BrowserBack`/`BrowserForward` (MARXY-86 `keys.ts`) |
| `Mod+Shift+S` | save as | §01 |
| `Space` / `Shift+Space`, `PageDown/Up`, `Home/End`, arrows | scroll | native |
| `Esc` | close overlay, else clear selection, else fold the workspace | W-03: one at a time; never in an editable (§Peeking) |
| `Mod+C` | copy | runs the selection's default copy verb, from the table in §03 (never a splice, never a string-prefix match); with no default verb, the DOM selection |
| `Mod+Shift+C` | Copy as… | opens the Copy as menu at the pointer for the selection, else the block under the pointer, else the document, in Rendered and in Source, and not in the find field or over the open palette (§03, ADR-0065 item 1). The `copy_format` row (default Markdown) is first and has focus, so `Mod+Shift+C` then `Return` copies the exact source bytes, as the key did before |
| `Mod+V` | paste | In Source, the editor's own paste, except that a paste carrying HTML is read through the shell, converted to Markdown (E-14) and inserted at every selection as one undo step, in the buffer's own line break, with one notice ("Pasted as Markdown (converted from HTML)"); a paste with no HTML is untouched. In Rendered it opens the clipboard, as Markdown, in a new scratch document (E-13; with two panes, in the other pane), and writes nothing until Save As. A concealed item (a password manager's copy) is refused before any read, with a notice. Not bound in the find field or the palette (ADR-0065 §3, J-05) |
| `Mod+Alt+Shift+V` | paste as plain text | Source only: inserts the clipboard's plain text unconverted, as one undo step (*Paste and Match Style*). The editor answers it by physical key, because Option rewrites `event.key` on a Mac. Not bound in the find field or the palette (J-05) |
| `Enter` | open the verb menu | with a `node`, `section`, `document` or `text` selection, outside editable fields and with no dialog open; anchored to the selection (§03, ADR-0054). On a selected link or heading anchor, Enter opens the verb menu, not the link; the link's default verb is "open link" (Enter again, or the first row) |
| `ContextMenu` / `Shift+F10` | open the verb menu | same; right-click and Ctrl-click open it at the pointer |
| `Mod+Enter` | edit the selected block in place | opens a CodeMirror editor over that block's bytes where the block was (E-04, ADR-0048); `Esc` (which keeps what was typed, ADR-0048 clause 3 as amended), `Mod+Enter` again or a press outside leaves it and folds the text back as one undo step; `Mod+E`, `Mod+S`, undo, close and quit leave it first |
| `Shift+click` | grow a block selection into a run | with a block or a run selected, the run reaches the clicked sibling (E-05); `dedupe-lines` and the copy verbs then act on the run (§03) |

No single-letter bindings in v1 (a reader may be typing in find or the palette).

**The menu column (W-20, ADR-0073).** On macOS every key above whose command is in the registry also sits in the native
menu bar, with the key the registry gives it, and nothing else does: a menu item adds no key. File has New File,
Fork This File, Open File…, Add This Folder to the Collection, Save, Save As… and Close Window (`Mod+W`); Edit has the
OS's items, Find…, Replace…, Copy As… and Transform…; Format has Bold, Italic, Inline Code, Strikethrough, Link and the
inserts (Source on Markdown); View has Read, Split, Source, Toggle Rendered / Source, Sidebar, Inspector, Outline, Fold
or Unfold the Workspace, Show Whitespace, Line Numbers and Column Guide; Go has Back, Forward and Open Quickly…; Help has
Keyboard Shortcuts, which opens the palette on commands. An item whose command cannot run now is disabled. The keys that
stay out of the menu (Source's line and selection chords, pane chords, `Esc`, text size) are named, with a reason, in
`test/keys-table.test.mjs`. §The native menu in `06-shell.md` says how.

**New file, New file here and Fork this file (W-14).** Three ways to start a file, from the toolbar's **+** (`document.new-menu`, drawn
once the command exists), the tab row's **+** (drawn with it, the row's last child and not a tab) and the palette (one row each; the menu
itself is not a row). A row whose command cannot run now is not drawn, so the menu never offers a shut door.

- **New file** (`Mod+N`, `document.new`) opens an empty scratch document in Source, where the reader can type. It writes nothing; closing
  it untouched writes and asks nothing. The first write is the reader's Save As.
- **New file here** (`document.new-here`; from a sidebar folder row's menu it takes that folder) is the same, and its Save As dialog
  starts in the folder (`saveDialog({ defaultPath: '<folder>/Untitled.md' })`; the shell opens the dialog in the folder when it exists).
  The file is not named from its first heading: the reader names it.
- **Fork this file** (`Mod+Shift+N`, `document.fork`) writes the buffer, as on disk plus any unsaved edits (Source text is folded in
  first; text held apart from another pane's is refused), to the first free name beside the file: `name (fork).md`, then `(fork 2)`
  and up to 999 (a dotfile or a name with no extension takes the tag last; a name so long that the tag would pass 255 bytes has its stem cut a whole grapheme at a time to fit). It opens the fork in the focused pane (over unsaved edits
  that asks, as any open does; the fork is already written and the notice says so) and says where it went. The original is never
  written or read again, and there is no undo: the shell has no delete, and the fork is an ordinary file the reader can remove.
  *Reveal in Finder* is not offered: the shell cannot reveal a file, and that is a privileged capability of its own.

What Fork never does (the rules `document/fork.ts` and its tests hold): it never writes over a file, a folder, or a symlink (a link that leads nowhere
included), and a name that differs only in case from an existing one counts as taken where the filesystem folds case. It does not
look for a free name and then write: each name is tried with one create-only write (`writeFileNew`, ADR-0074), which the shell
refuses `exists` when anything is at the name, and Fork goes on to the next. The refusal is decided by the operating system in the
same step that makes the name appear (an exclusive rename), so there is no window in which another program's file can be replaced,
and no link to write through. The same write is *Keep mine as a copy*'s and *Restore to a copy*'s. The bytes are the
buffer's, so a BOM, CRLF and bytes that are not text are kept. A failed write says so (an `error` notice: what failed, that nothing was
written and the original is unchanged, what to do; it names the file that was to be written and says why in words, never the shell's text with its hidden temporary file or an OS number), opens nothing and leaves no file, because the shell publishes a whole file or none.
Nothing leaves the machine. Where a volume supports neither the exclusive rename nor a hard link, the write fails ("this disk can't add
a file without risking replacing another") rather than fall back to check-then-write.

**Source editing keys (V-01).** In a pane that shows Source, and only there (Rendered does nothing with them),
the registry binds these from `apps/desktop/src/commands/source-edit.ts`; each is also a palette command. They
are `global` commands, so they run from inside the editor, and the editor's own default on the same chord is
removed so a press runs one thing. A literal `Ctrl` is a Mac's Control key; elsewhere those operations are in
the palette.

| Key | Action | Notes |
| --- | --- | --- |
| `Mod+L` | select line | the editor's own, on `⌘L` |
| `Ctrl+Shift+B` | select block | the parse's innermost block at the caret; any file that is not Markdown: the paragraph |
| `Ctrl+Shift+S` | select section | the heading's section, to the next heading of equal or higher rank; Markdown only |
| `Ctrl+Shift+→` | expand selection | word, line, block, section, document; stops at the document |
| `Mod+D` / `Mod+Shift+L` | add next occurrence / select all occurrences | the editor's search; several selections |
| `Ctrl+J` | join lines | a caret joins its line to the next; a selection joins what it reaches |
| `Mod+Shift+K` | delete line | with its break |
| `Ctrl+Shift+T` | toggle task | `[ ]` and `[x]` on list lines; a plain item gains `[ ] `; a line with no list marker is left alone |
| `Ctrl+Shift+Q` | toggle quote | `> ` on or off each line of the selection |
| `Ctrl+Shift+C` | toggle comment | the language's own comment syntax; `Mod+/` is the transforms key and is not this |
| `Alt+↑/↓`, `Alt+Shift+↑/↓` | move line, duplicate line | the editor's own; Rendered's `Alt+↑/↓` are the block moves and stay so |
| palette only | sort lines (byte order) | UTF-8 byte-wise, not the locale's |
| palette only | align table, add table row, add table column, sort table rows, copy table at caret as CSV | V-02, with the caret in a GFM table; see below |
| `Mod+B` / `Mod+I` / `Ctrl+\`` | bold / italic / inline code | V-08, Markdown only; wraps the selection or the word at the caret, and again unwraps; see *Formatting and inserts* |
| palette only | strikethrough, link, insert table / code block / horizontal rule / details block / footnote | V-08, Markdown only; no key for Link (`Mod+K` is the palette) and none for the rest until the menu bar shows them (W-20) |

**Table tools (V-02).** With the caret in a table (the parse's `table` node, so a table in a code fence is not
one), the five palette commands act on that table and nothing else; with the caret anywhere else they do nothing
and say nothing. Align lays the pipes out by display width (CJK and emoji are two cells) and keeps each
column's `:` markers (it is `align-table-pipes` on the table's span). Add row puts an empty row below the caret's
row (below the delimiter row from the header), padded to the column widths only when the table was aligned. Add
column puts an empty column after the caret's, with `---` in the delimiter row, in the rows that reach that
column and no other. Sort orders the body rows by the source text of the caret's column, trimmed, in UTF-8 byte
order and stably; the header and delimiter rows stay, and a row moves whole while each line keeps its own
ending. Copy as CSV is Copy table as CSV (C-07's `copy-table-csv`) through the one copy path. A pipe separates
cells unless a backslash escapes it, in a code span too (the parse's rule, GFM's: an unescaped pipe in a code span
splits the cell, and the tools split where the parse does). A table in a block quote or a list item keeps its
prefix on every line, new rows included. The tools refuse (do nothing) rather than guess: where this file's
reading of the rows differs from the parse's, where a column cannot be added without a closing pipe, or where the
result would not parse as the edit meant. None of them is in `MUTATING_OPERATIONS` or the transform catalogue.

One operation is one undo step, changes only the bytes it targets, and writes the file's own line separator
(LF, CRLF or CR) and keeps its BOM and its last line's ending (`source/structure.ts`; the pure part is
`packages/core/src/source-edit/`). Three of the defaults a Mac's editor had on these chords go (next
occurrence, all occurrences and delete line are the registry's now; emacs `Ctrl+Shift+→` and `Ctrl+Shift+B`,
which select by syntax and by character, give way to expand and select block).

**Pane chords (Phase D).** One table, `apps/desktop/src/pane/keys.ts`, matched on physical keys
(`event.code`: `Mod+Shift+\` arrives as `|` on a US layout), run from a `window` capture-phase listener so
they work from inside a Source editor too, and run once (the registry's dispatcher does not see them).
They do nothing while a dialog is open, except `Mod+Alt+\`. A chord whose command is not registered yet, or
whose `when` does not hold (one pane), does nothing.

| Key | Action | Notes |
| --- | --- | --- |
| `Mod+\` | fold or unfold the workspace (`view.toggle-workspace`) | W-02, ADR-0058; held while a dialog is open; a held key counts once |
| `Mod+Alt+\` | open beside (`view.open-beside`) | D-07, moved here by W-02: the palette in beside mode (below); works with the palette already open. Focus in a Source editor or another text field (the palette's query aside) leaves it to the field: CodeMirror's indent selection |
| `Mod+Shift+\` | close the focused pane (`view.close-pane`) | D-08; never `Mod+W`, which is the native Close Window and quits |
| `Mod+Alt+←` / `Mod+Alt+→` | focus the left / right pane (`view.focus-left`, `view.focus-right`) | with two panes; moved here from `Mod+1`/`Mod+2` by W-19; `Alt+←`/`→` without `Mod` stays history |

**Open beside.** `Mod+Alt+\` opens the palette in beside mode. With nothing typed it lists Recent alone, the
most recently used documents without those already on screen (`recentExcluding`, `palette/session.ts`), the
first row selected, so `Mod+Alt+\` then `Enter` is "split with recent". Typed, it finds what the palette finds.
`Enter` opens the row in the other pane, made if there is one pane; `Mod+Enter` on any row, in either mode,
does the same. The notice line says "Open beside". The other pane's unsaved document is asked about in that
pane (`beforeReplace`, D-08) before it is replaced, and focus moves to the pane that opened once its document
is on screen; `Esc` gives it back to the pane the palette came from. When the window cannot hold two
columns at the typography floor (`pane/fit.ts`, 929 px at the default text size) no second pane is made: with
one pane `Mod+Alt+\` shows the notice "Marxy needs a window at least 929 px wide to show two documents side by
side." and opens no palette; with the palette already up, `Enter` keeps it open with that notice and then
opens the document here. The number is worked out from the page's metrics, never typed.

A press in a pane focuses it before anything in the pane sees the press, so a click in the other pane
focuses it and then selects. The first wheel event over the other pane after 150 ms without one focuses it
too (`FOCUS_ON_WHEEL` in `pane/focus.ts`, one constant). Focus is shown by the window title naming the
focused document and by the divider's fade, never by a ring or by dimming. A pane in Source passes focus
to its editor. An overlay records the pane focused when it opened (`focusOrigin` in `pane/focus.ts`) and
gives focus back to it on `Esc` or dismissal.

**Guaranteed by the native menu, not only by this table (macOS, MARXY-184).** `Mod+Q`,
`Mod+C`/`Mod+V`/`Mod+A`, and `Mod+Z`/`Mod+Shift+Z` also have a native macOS menu item behind
them (Quit; Edit's predefined copy/paste/select-all; Edit's predefined undo/redo). AppKit wires a
menu item's key equivalent from menu-item validation, not from `keys.ts` alone, so a reader
outside a text field who presses one of these keys is relying on the menu, not this table, to
reach the responder chain — the two are expected to agree, and a change to either should keep
them in sync. `Mod+O` (Open File…) is native-menu-only in v1: the palette and the **+** menus do not list it (the shell has no file picker the page can call).
A menu item may also stand for a chord this table binds (MARXY-342): View's Toggle Rendered / Source
(`Mod+E`) and Go's Back, Forward (`Mod+[`, `Mod+]`) and Open Quickly… (`Mod+P`). AppKit takes the key
equivalent for the menu, so the webview never sees the keystroke; the click emits `marxy:menu` with
the item's id and `apps/desktop/src/menu/menu-commands.ts` replays the same chord, so there is one
behaviour per command. Nothing that acts on the document (an operation, save, copy-section) belongs in
the menu (ADR-0011); a command joins it only when the table above already binds it and the webview
implements it.
`Mod+W` (Close Window) is native-menu-only too, and — since Marxy is single-window — exits
through the same path as Quit (`docs/design/06-shell.md` §Capabilities).

## Navigation

A plain click on a relative link to a Markdown document replaces the document in the pane it was clicked in, and
`Mod+[` / `Mod+]` walk that pane's link history, not the window's (each pane keeps its own).

### Open a link beside (D-09)

Cmd-click (Ctrl-click off a Mac) on a relative link opens the target in the other pane, made when there is only
one and the window holds two columns at the typography floor (otherwise the fit notice, `splitFitNotice`, and
nothing opens). The pane clicked in keeps its document, its place and its focus; the neighbour's history starts
with the target, a fragment is landed in the neighbour, and unsaved edits in the neighbour go through the pane
set's guard (`beforeReplace`, D-08) before it is replaced. Beside only, a link to a file that opens in Source
(`defaultModeForPath`) is accepted when its first 8 KB hold no NUL byte, and opens there; otherwise the notice
is "That file is not text." A plain click keeps refusing such files. A `#fragment` link scrolls the pane it is in,
and an external link ignores the modifier. Links never leave the image root, beside or not.

## Library view (Q-03; ADR-0062 item 2)

The palette command **Library** (`library.open`) shows a full-window view in the unfolded workspace, in the cell the
panes use; folded it is not offered and no element exists. No key opens it (the palette and, later, the sidebar's
Library row are the doors until the author rules one). The panes are `hidden` and `inert`, not closed: their
documents, unsaved edits, Source editors and scroll positions are untouched, and the view puts the scroll back when it
leaves. Folding closes it, and so does any document opening in a pane (the palette's, a link's) or anything about to act
on the panes from outside `PaneSet.open`: a click on a tab and the tab commands let go of the view first
(`workspace/pane-cover.ts`), so the "Save and open" prompt of a pane with unsaved edits is never raised under it.

Top to bottom: the scope's name and what it is (a folder's path); the query field with one removable chip per term
and a completion list; a status line and the sort choice; the results and, on the right, a text preview. The toolbar,
the tabs and the strip stay as they were.

- **Scopes.** *All files*, each folder `collection.toml` declares (`IndexFeed.declared()`), *Recent* (the palette
  session, last opened first), *Pinned*, and *Changed since you read* (the palette's own rule). Switching clears the
  query and the selection. Each scope is a base set; the query narrows it.
- **Query.** `parseQuery` and `completeQuery` (Q-02), evaluated by core's `evaluateQuery`. An unknown key and an
  incomplete value are amber chips that say they are searched as text or ignored; `is:dup`, `is:broken`,
  `is:archived`, `is:error`, `is:captured` say "not available yet" and match nothing. Tab accepts a completion, the
  arrows move.
- **Index keys and content keys.** `kind:` (the entry's reader kind), `in:` (a declared folder's name), `path:`,
  `modified:`, `size:` and `is:` are answered from the index and the session, with no read. Plain words match a title,
  a path or a heading, and then the lines of the files the index keys left (`shell.searchContent`). `words:`, `has:`
  and `tasks:` measure those files with `shell.readHead`: each at most once while the view is open, at most 256 KB of
  it (a longer file is measured on its first 256 KB and says "≥"), within `CONTENT_SEARCH_LIMITS.maxTotalBytes`; past
  that the status says "measured N of M files". `readFile` is never used (it arms the stale-write guard), and
  nothing is written. Nothing is read at launch or on opening. Three bounds keep the window answering, and the status
  line says when one holds: a query is evaluated with its first 64 terms and the first 64 values of a term ("the query
  is long"); a link is found by a linear scan, not a pattern, so a minified line cannot stall a measure; the line search
  reads at most 20,000 files ("line search covers the first 20,000 of N files").
- **Rows.** The kind's glyph, the title, the path under its folder, the kind, the age, a status mark (changed,
  pinned: an icon with a name, never colour alone) and one line for each reason the file is there: `title`, `path`,
  `heading "Cache"`, `line 12: ...`, `kind:report`, `changed since you read`; past four lines the last says how many
  more. The list is windowed (a row is a fixed number of lines, so only the screenful and a few more exist) and is a
  `listbox` with `aria-activedescendant`.
- **Keys, inside the view.** `/` or `Mod+F` focuses the field; `Down` or `Return` in the field goes into the list;
  in the list the arrows, `Home`, `End`, `PageUp` and `PageDown` move; `Return` opens the row in the focused pane
  and closes the view; `Alt+Return` opens it in the other pane (a second tab is the pane's own: the tab row follows the
  panes), and in a window too narrow for two columns says so in the status line and stays; `Esc` clears the field, then
  closes the view and focus goes back to the pane that had it (it does not fold the window).
- **Save as smart collection (Q-07).** A query with at least one term (a term the parser ignores, such as `kind:` alone,
  is not one) ends its row of chips with **Save as smart collection**. It reads `collection.toml` and keeps those bytes,
  then asks for a name in a field in the same row (Return saves, Esc puts the field away and keeps the search). Saving
  reads the file again; if its bytes are no longer the ones kept, the save is refused and nothing is written (a hand
  edit, a sync, another Marxy). Otherwise `appendQuery` adds one `[[query]]` table at the end and writes the file
  atomically. A duplicate name (case folded), an empty name, an empty query and a file that is not TOML are refused, a
  failed write is an error, and each says what is unchanged: the file is exactly as it was. The view's notices are pills
  in its own region at its foot, because the panes' are hidden under it. The section in the sidebar updates at once.
  There is no rule builder (a row is one query; the field is the builder), and no rename or delete: *Edit in
  collection.toml* is the way to either.
- **Not here.** A rendered preview (Q-03.1), facet menus, grouping, density, columns, Add source, Index
  health, bulk actions, near-duplicates and broken paths are later cards.

## Outline

Built from the AST's headings (`level`, text, `src.start`). Rendered as a `<dialog>` at the
right edge, width `min(320px, 40vw)`, one line per heading, indented by level. The current
heading (the last with `start ≤ position.byteOffset`) is marked; opening the dialog scrolls it
into view. `Enter` on a heading selects its section (§03) and scrolls it to the reading line;
`Esc` closes. Frontmatter `title:` shows as the first entry when there is no h1.

While the outline is open, the current-heading mark follows scrolling (the same per-frame
position sample §08 takes; no second scroll listener).

**Per pane** (D-13). The outline is the focused pane's: opened with two panes it lists the headings of
the pane focused when it opened, takes that pane's reading position, follows that pane's scroll through
its view's own scroll subscription, sits against that pane's right edge (`inset-inline-end` from the
pane's box; the dialog is modal and may cover text), lands a heading in that pane, and gives focus back
to it (`focusOrigin`). `outline/pane.ts` makes that binding. Module: `apps/desktop/src/outline/`
(`outline.ts` builds entries from the AST — pure, tested without a DOM; `view.ts` owns the
dialog). Entries are plain text: inline markup in a heading is flattened with `textContent`
semantics, smart typography applied as in the article.

## Transform and the result sheet (W-21; ADR-0065 item 4)

`Mod+/` and the toolbar's Transform button open the palette on `>Transform`. The list is core's `TRANSFORMS`: one
registry command per entry, `transform.run.<id>`, titled `Transform: <name>`, in the palette group `transform` (last
in the group order). `transform.open`, the toolbar's door, is registered with `listed: false`, so the palette does not
show a row for the way into itself. Choosing one runs it on the input and opens **the result sheet**
(`transform/sheet.ts`, built on demand like the outline: a modal `dialog#marxy-transform` on the shared chrome
classes `marxy-surface marxy-surface-lg`, nothing in the page until then).

**The input** (`commands/transform.ts`). Rendered: the selection's source range (a node, a section or a run of
blocks; a drag is the top-level blocks it touched, as recorded when it was made), else the whole buffer of the
store. The text is read from the store's current bytes and checked against what the page resolved; a drag that cannot
be matched to its page is refused with a notice and never widened to the document. Source: the editor's one
selection, else the whole document, read with the file's own line separator. The sheet shows Before and After side by
side with their character counts (code points; a byte-order mark is not one), at most 20,000 characters painted per
side, the counts and every action using all of it.

**Actions.** *Copy result* (`Return`, first focus): one pasteboard item through `writeCopy`, the text without a
byte-order mark, nothing in the document changes. *Apply* (`Mod+Return`): replaces the input range, one undo step;
offered only when every step is an `edit` transform (`derive` and `literal` outputs are new text, not an edit of the
input: they are copied or opened as a document). *Open as new document*: `openScratch`. *Add another step*: the same
list, filtered as typed, run on the result (`transform/chain.ts`; no saved pipeline, no history). `Esc` closes the
step list first, then the sheet; nothing is changed or copied. The sheet reads no clipboard and owns the keyboard
while it is up (the app's keys do not act on the document behind it). Focus returns to the pane it came from.

**Apply is a data write, and refuses rather than guesses.** Rendered: `applyToStore` splices the range once through
`store.apply` with the base version the sheet read; when the store's bytes are no longer the ones the sheet read (an
edit, an undo, a reload from disk, another pane's fold) nothing is done and the sheet says the document changed. A
save does not make it stale. Nothing is written to disk by Apply: the reader saves. The result is written in the
document's own line ending (a CRLF or CR file gets no bare LF from a transform that adds lines to a one-line
selection), `edit` transforms keep a leading byte-order mark, and a range holding a byte that is not UTF-8 is not
offered Apply (writing the text back would turn that byte into U+FFFD). Source: `replaceRange` (`source/structure.ts`),
one CodeMirror transaction and one undo step, refused when the editor's document is no longer the object the sheet
read. Source holds a byte that is not UTF-8 as a lone surrogate and writes it back as that byte (ADR-0069), so Apply is
offered there whether the file was read that way or the byte was pasted in since; the sheet paints, copies and opens
such a byte as U+FFFD, and a result that is new text (a conversion) is made from that readable input, so it never spells
`\udcff`. A
transform marked `outsideCode` leaves fenced code and front matter alone by Markdown's rules; in a file that is not
Markdown the sheet says which steps do that. The data-safety walk (`test/support/store-walk.mjs`, op
`applyTransform`) drives the same functions over random ranges.

## Find (D-A14)

- **Per pane** (D-13). `Mod+F` opens find in the focused pane only: the field sits at that pane's
  top right (its `.marxy-find-slot`, a zero-height sticky holder moved to the pane's top while
  find is open), and matching, highlights, the count and the reading line are that pane's. Opening
  find in one pane closes it in the other; each pane keeps its own last query. Nothing searches
  both panes. `Esc` gives focus back to the pane find opened from (`focusOrigin`).
- Input at top-right, no chrome until `Mod+F`. Case-insensitive, whole document, incremental.
- Matching runs over a text index of the article's text nodes, concatenated with no separator
  (`text-index.ts`), walked afresh for every run (`walk.ts`). The typesetter's line breaks are
  empty spans whose generated content is not text, so a pass never changes the index's text, only
  where its pieces split; a range is therefore resolved from a fresh walk, never from stored node
  references. A match ending on a piece boundary ends in the earlier piece, so it never reaches
  into the next block.
- **Few Ranges held** (F-43). The matches are kept as spans of the index text; a `Range` is held only for
  the ones near the view (within two screens above and three below, at most 600), or for all of them
  while there are 200 or fewer. The engine updates every live `Range` on every DOM change, so the 18,000
  matches of "the" in a 1 MB document made the typesetter's background pass (a split and an insert per
  line break) four times slower with the fallback overlay, and with highlights held the mount of the
  document's last chunks for minutes. A text pass never changes the index's text, so the window is made
  again from a fresh walk (about 15 ms on 1 MB) when the view has moved a screen from where it was made,
  and for a current match outside it; the Ranges are re-pointed, not made again.
- Highlights: `CSS.highlights.set('marxy-find', new Highlight(...ranges))` over the held Ranges with
  `::highlight(marxy-find)` styled by the theme; the current match in a second highlight.
  Fallback when `CSS.highlights` is undefined: the matches near the view are drawn as rectangles in
  a `.marxy-find-rects` layer beside the article, repainted on scroll; the article's DOM is never
  written, because the typesetter watches it (the fallback is exercised by a test that deletes
  `CSS.highlights`, and one that runs it on a 1 MB document).
- Navigation scrolls the current match to the reading line (40 % of the pane's height), never to
  the top edge. Count shown as `3 of 41` inside the input. A new query starts at the first match
  at or below the top of the pane's view.
- In Source mode, find is CodeMirror's `@codemirror/search` panel with the same key, in that
  pane's editor.
- **Matching folds what the renderer changed.** The article shows smart typography (§02) but a
  reader types straight quotes and double hyphens. The query is compiled to a regular
  expression (flags `giu`) after escaping, with these substitutions applied to the query, never
  to the text: `'` → `['‘’]`, `"` → `["“”]`, `---` → `(?:---|—)`, then `--` → `(?:--|–)`,
  `...` → `(?:\.\.\.|…)`, a space → `[ \u00A0]`. Everything else matches literally,
  case-insensitively. The haystack is the text index, which never contains soft hyphens.
- **Scope.** Text inside `.katex` subtrees is excluded from the index (it is layout glyphs, not
  the source); the TeX source is not searchable in Rendered mode in v1. Code blocks, tables and
  footnotes are included. Alt text is not (it is not painted unless the image is missing).
- **Nothing found where the reader cannot see it** (commitment 4). One rule, `NON_CONTENT` in
  `walk.ts`: a subtree that is not the document's visible reading text is skipped whole. That is
  what the page does not draw (`[hidden]`, `<template>`, `aria-hidden`: a link's hidden
  destination), KaTeX's glyphs, the elided tail of a long code line and its note, and Marxy's own
  labels (a link's host label, notices, controls). A match inside a horizontally or vertically
  scrolled inner scroller (a wide table, a code block) scrolls that scroller as well as the pane.
  Find sits above the outline and the other summoned surfaces. A match inside a closed `<details>` is counted,
  and the details element is opened when that match becomes current. An invisible character's
  marker (§02) is searched by its byte, not its hex label: a zero-width or bidi control inside a
  word splits it, so a query typed without it does not match (the marker shows why), and a match
  that touches the byte is highlighted over the whole marker, never as a zero-width box. Folded
  front-matter rows are not in the article and are found in Source.
- **Budget.** Matching reruns one frame after the last keystroke; `find_first_match` is marked
  when the first highlight is set. < 50 ms for `01-long-technical.md` on the reference tier.
- Module: `apps/desktop/src/find/` (`text-index.ts` pure over a list of text-node strings,
  `query.ts` the compiler above, `walk.ts` the DOM walk and ranges, `view.ts` the input and
  highlights; `commands/find.ts` is `view.find`).

## Notices (`#marxy-notices`)

News is a **pill at the foot of the pane it is about** (U-02; the author's rulings on X-19, `docs/plan/direction-2026-10/rulings-x21.md`
1 to 10). Nothing is ever put in the reading column's flow or in a document's text.

**Where.** One region per pane (D-10), `[role=status]`, the pane's last child (`#marxy-notices`, `#marxy-notices-2`), empty and not
drawn at rest. It is a zero-height layer pinned to the bottom edge of what the reader sees of the pane (sticky in a pane that
scrolls; the pane is at least a screen tall; in Source, fixed to the window or absolute in its pane, because the editor's mount
is out of the pane's flow). Its pills are centred on the pane and stack upward, newest nearest the edge; at most three show
(`MAX_SHOWN`), a decision always among them, and the older wait under them and come up as the newer go. A notice about a file
is said in the pane that shows it and in no other, one about the app in the focused pane; the same words twice in a pane are one
line, and a document opened in a pane clears that pane's notices only. Unfolded, a pane's pills clear the status bar. Raising or
dismissing one moves no text, a pixel of `scrollTop` or the document's height (`test/no-displacement.test.mjs`, the `noticeColumn`
rows of `gate:aesthetics`).

**What.** A pill is the chrome face on the surface roles (`.marxy-notice`): a glyph, a word for its kind, the text, its actions
and Dismiss. Kind is told by the glyph and the word first and by `--marxy-color-status-*` after, never by colour alone:

| Kind | Word | Glyph | Goes when |
| --- | --- | --- | --- |
| `done` (an outcome; `info` with `transient` is the same) | Done | check | fades at 4 s; held while the pointer or focus is on it |
| `refused`, `error` | Not done | slashed circle, triangle | stays until dismissed |
| `decision` | Needs you | question | stays until answered; takes focus |
| `info`, `blocked` | Note | i, shield | stays until dismissed |

A refusal says what was not done and that the file is unchanged. Every notice is built by `noticeLine` and placed by `placeNotice`
(`notices/index.ts`): the glyph, the word and the buttons are the same wherever it comes from. `ctx.showNotice(text, { kind })`
names the kind; with none it is `info`, or `done` with `transient`. Where a call site is not yet classified (kind settings,
the collection, the live-reload lines, theme and index news) it is `info`, a note that stays.

**Announced.** The region stays a polite live region. A decision is `role="alertdialog"` and moves focus to its first button
(Save, the safe one), so it is read and answered at once; it is not modal. The unsaved-changes guard (`close.ts`) is one.
Window close stays the native dialog.

**Keys.** `Mod+Alt+N` (a pane chord, `pane/keys.ts`, so it works from Source) focuses the newest notice showing. Tab, Shift+Tab and
the arrow keys move among the pill's buttons (the pill does this itself: a macOS webview does not Tab to buttons unless Full
Keyboard Access is on); a decision wraps. Esc on a focused notice dismisses it, as Dismiss does (so a decision's Esc stops the
action), and focus goes back to where it came from. Esc elsewhere keeps its order (sheet, find, peek).

**Look.** `packages/theme/src/base.css`: the surface ground and outline and elevation, a 10 px radius (at 13), the status role's
colour and wash for the glyph and word, quiet text buttons; forced colours keep the outline, and reduced motion removes the
slide and the fade (an outcome then goes at once). Placement is `index.html`'s (and `gate.html`'s copy), and `base.css`'s for
the unfolded workspace. Not built: a history of notices, progress for slow work, sound (rulings 6 to 8).

## Source mode (D-A15)

Source is a mode of a pane, not of the window (D-11, ADR-0005): each pane's section carries its own
`data-marxy-mode`, `Mod+E` toggles the focused pane only, and `<body>`'s `data-marxy-mode` mirrors the
focused pane's (written again whenever focus moves), so CSS and tests that read it still mean "the pane
the reader is in". The editor mounts **in the pane**: one CodeMirror per pane's Source mount
(`#marxy-source`, `#marxy-source-2`), with its own scroll and cursor; alone, the mount covers the window,
and beside another pane it is `position: absolute` inside its own section. A file that opens in Source
does so in whichever pane it opens in. Commands that mean "the editor" (line numbers, tab width, the
external editor's line) take the focused pane's (`activeSourceEditor()`).

Two panes on one file, one Rendered and one Source: what is typed in Source reaches the other view
when focus leaves the editor (a click or `Mod+Alt+←`/`→` into the other pane, the palette), not per
keystroke. It is folded into the store then, one history entry, exactly as leaving Source folds it; a
Source pane that is the only view of its store folds only on leaving Source, as before. Two views of one
store never both hold unfolded Source text: a pane that comes to show a document another pane holds
unfolded in Source folds the holder first, so the newcomer starts from bytes that include it. With the
file in Source in both panes, each fold reaches the other editor, which then holds no typing of its own
and takes the new bytes (caret mapped), so neither pane's next fold writes the other's typing back
out. Edits are never merged. Should an editor with its own typing still meet another pane's fold, it is
held apart: it keeps its text, the store keeps the other pane's, a notice says "Source in the other pane
changed this file; your text was not folded", and that editor's folds (on blur, before a save, an undo
or a close) and leaving Source are refused until its text reads as the store's again or the pane opens
the document again. Its text still counts as unsaved, so closing, opening over it or quitting asks. If another view's watch reloads the file
from disk while a Source pane holds text not yet folded, that text is kept and folded on top, as an
unsaved edit the store kept. A rename followed by the other pane's watch is not settled here: each
pane still runs its own watch, and one watch per store is D-10's. Live mirroring per keystroke would
need the store to take CodeMirror transactions (Phase E's block editing).

CodeMirror 6 in each pane's Source mount, created on its first switch and kept:

```ts
new EditorView({ state: EditorState.create({ doc: buffer.text /* without BOM */, extensions: [
  history(), drawSelection(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  EditorView.lineWrapping, language(byExtension(path)), lineNumbers?  // config.line_numbers
  EditorState.lineSeparator.of(buffer.eol === 'crlf' ? '\r\n' : '\n'),
  themeBridge,   // maps --marxy-* tokens to CM6's theme
] }) })
```

`themeBridge` reads `--marxy-font-mono`, `--marxy-size-code`, the `code-bg`/`code-text` colour
pair and `--marxy-line-box` (the grid unit, ADR-0030) from the document root, so `.cm-content`
gets the theme's mono face and a grid-unit inset instead of the browser's default monospace
stack flush against the viewport edge; the `EditorView.theme` `dark` flag follows
`data-marxy-variant` so Source matches whichever variant the reader is on (MARXY-265). No
gutter restyling and no syntax-highlight theme beyond what CodeMirror ships — that is later
work, not this pass.

### The Source frame (V-05)

The editor sits in an enclosure, `.marxy-source-frame`, that `createSourceEditor` builds inside the mount in the same task as the
editor (so nothing paints between them and first text never waits for a bar). A mount that is not the app's (the editor's own
harness) gets the bare editor. The frame has a hairline edge (`--marxy-color-rule`), radius 13 and the page ground, and is inset
from its pane (14 px folded, 12 px unfolded); folded it is at most 960 px wide and centred, unfolded it fills the pane. The text
column inside is ADR-0067's, centred in the frame. The editor scrolls inside the frame (its own scroller), so the bars stay put.

Every bar shows only what the bytes say, and says nothing else (no score, no summary, nothing drawn on the text):

| Edge | Contents |
| --- | --- |
| Top bar (24 px) | the path as quiet segments, the file's name last; the encoding (`UTF-8`, `UTF-8 with BOM`, or `Not valid UTF-8 · n bytes`); line endings as they are (`LF`, `CRLF`, `CR`, `Mixed`; none for a file with no break); indentation as the lines begin (`n spaces`, `Tabs, width n` from EditorConfig and V-16, `Mixed indentation`; nothing when no line is indented); size in bytes; line count (a last empty row after a final break is not a line) |
| Column ruler (17 px) | a tick every fifth column on the text's character grid (`ch` of the text's own face and size, so tick N is under character N), taller every tenth, numbers every tenth, the caret's column as a notch, a selection on one line as a bar. Scrolls with the text. Not built for a file that wraps (Markdown, the text family), and hidden below 520 px |
| Right strip (8 px) | marks at the height of their bytes: invisible and bidi characters (the rule of `shouldFlagInvisible`) and, while the find panel is open, its matches. Hover names the place (`U+200B ZERO WIDTH SPACE at 23:14`); a click selects it. Pointer-only and `aria-hidden`: Find and the bottom bar say the same in words |
| Bottom bar (24 px) | `Ln, Col · byte` (column in characters, a tab is one; the byte offset from the start of the file, counted from the text once it has been edited); a selection's length in characters and bytes; the character after the caret by code point, named where it cannot be seen (`U+200B ZERO WIDTH SPACE`), `Byte FF, not UTF-8`, `U+000D U+000A CRLF` at the end of a CRLF line, `End of file` |

The bars cost rows: in an 800 px folded window about 33 rows of Markdown and 32 of code are in view, where ADR-0067 counted about 37 with the text alone.

Line numbers for Markdown stay off (L-06.1, ruling Q14); `Ln, Col` is in the bottom bar. The measures (words, tokens: W-16), the
language, the notes marks (V-04) and the line-ending and indentation menus (V-08) are not built. The bars are not focus stops and the
caret readout is plain text, not a live region, so a screen reader reads it when asked and does not announce every key. Source's
scroll position, which the window used to hold, is the editor's own now: `scrollSourceToByte` takes the scroller's offset from the
window's top off the reading line's margin, so a place round-trips through Rendered unchanged.

### Formatting, inserts, show whitespace and the column guide (V-08)

**Formatting and inserts.** In a Markdown file in Source (and a scratch document, which is Markdown until it is named),
*Bold* (`Mod+B`), *Italic* (`Mod+I`), *Inline code* (`Ctrl+\``), *Strikethrough* and *Link* wrap the selection, or the
word at the caret; run again on wrapped text each unwraps, so twice returns the bytes. White space at the edge of a
selection stays outside the markers; an empty selection with no word puts the pair at the caret, and an empty pair at the
caret comes out. Bold is `**`, italic `*`, so `***` is both and each takes only its own off. *Link* wraps as
`[text](url)` with `url` selected, and unwraps from anywhere inside a link on one line. *Insert table*, *Insert code
block*, *Insert horizontal rule*, *Insert details block* and *Insert footnote* (palette, under `>Insert`) put a block at the
caret with a blank line each side, moving no other byte (a rule at the very start is `***`, since `---` there could open
front matter); a footnote puts `[^n]` at the caret and its definition after the last line. Each is one splice and one undo
step, written in the file's own line ending, and none is offered, or does anything, in a file that is not Markdown. A
selection that is in or across a fenced block, or runs over a paragraph break or into a list or quote, is declined with a
refusal that says what is unchanged and what to do (the X-21 template); an insert with the caret in a fenced block is
declined likewise. There is no formatting toolbar and no slash menu: in a source editor `/` types a slash. The pure part is
`source/format-ops.ts`. The in-place block editor in Rendered has none of these keys.

**Show whitespace** (palette toggle, off by default) marks a tab with a faint line through its width and trailing spaces
with a faint tint, as CodeMirror decorations on its own classes: the text, the clipboard and the file are unchanged.
**Column guide** (palette toggle) draws a one-pixel faint hairline at the right edge of character 80 (or of the file's
`.editorconfig` `max_line_length` when it has one), a pseudo-element of the content on the ruler's character grid, taking
no space and no pointer. It is on for code, logs and terminal output and off for Markdown and the text family until
chosen. Both are remembered as `show_whitespace` and `column_guide` in `config.toml` (a choice applies to every file, as
`line_numbers` does; absent, the column guide follows the file's kind), each written without touching another byte.

### Folds and the depth lens (K-10a)

A fold is a view and nothing else: CodeMirror keeps it as a decoration, so the document, a copy of it (Mod+A, Mod+C copies the
hidden text too), a save and the bytes are the file's own with it or without it (commitment 3). Nothing is folded at rest and no
fold is remembered. Every fold's placeholder is text in the flow that says what it hides, `… 42 lines` (`… 1 line`): the number
of lines that have text under the fold (all between its two ends, and an end line only if something other than white space of it
is hidden). A click on the placeholder unfolds it, and so does the unfold key with the caret on its line (below); the placeholder is not a tab stop. A change that reaches into a
fold counts it again; a deletion opens the fold it touches, as CodeMirror does, so no text is deleted out of sight (commitment 4).
Large files (over 2 MB) have no folding.

For a JSON or YAML file in Source the palette offers **Fold to depth 1** to **4** and **Unfold all** (`source.fold-depth-N`,
`source.unfold-all`; no keys until the menu bar checks conflicts). Depth counts the containers a value sits in: the file's top
container is depth 0 and always shows its entries, depth *N* folds every container nested *N* deep, using the range the language
folds by hand (a bracket's inside; a YAML pair or item, behind an anchor or tag too), so the gutter's chevron undoes one. Fold to depth replaces the folds there
were; a caret inside a new fold moves to the line it opens on; a depth that folds nothing says so. The lens is not offered for
TOML (its mode has no tree), for a file over the large-file limit, or in Rendered. A fence in Rendered is not folded.

Languages, MIT only: `@codemirror/lang-markdown`, `-javascript`, `-rust`, `-python`, `-css`,
`-json`, `-yaml`, `-html`; others plain. Files over 2 MB: no language, no wrapping.

Leaving Source: if `view.state.doc.toString() === buffer.text.slice(bom ? 1 : 0)`, keep the
original buffer untouched. Otherwise `buffer = fromText(path, doc, like: buffer)` (§01) and
`history.push` one edit covering the whole document with label "edit in Source". A `mixed`
buffer edited in Source becomes LF with a one-time notice.

Per-file-type default: `.md .markdown .mdx .txt`, and an extension-less `README`, `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or
`HISTORY` (K-05a, ADR-0060 item 8), open Rendered; everything else Source. A
`theme.css` next to a `theme.toml` opens in Source with a notice offering "apply this theme".

## Open in external editor (`Mod+Shift+E`)

`shell.revealInExternalEditor(path, line)`. `line` is 1-based: in Rendered mode the line of
the reading position's block start (§08; the buffer's line index), in Source mode the cursor's
line. Rust (`commands/os.rs`) reads `external_editor` from `config.toml` on each call (the
`toml` crate, MIT/Apache-2.0; only that key), splits the template on whitespace **without a
shell**, substitutes `{file}` and `{line}` inside each token, and runs it with
`std::process::Command`, detached. No template → the platform opener (`open -t <file>` on macOS,
`xdg-open <file>` on Linux; no line). Failure → notice "Could not open README.md in the
external editor: <reason>." The template is never passed to `sh -c`, so a path with spaces or
quotes cannot become a command.

## Keyboard completeness

Every command in the registry (§03) is reachable without a pointer: by its `key`, or by the
palette (which is itself `Mod+P`). The audit is a test, not a checklist alone
(`apps/desktop/test/keyboard.test.mjs`): for each command with a `key`, a synthetic key event
runs it (its `when` satisfied by a fixture state); for each command, the palette lists it when
`when` is true; at rest, `Tab` reaches the article (`tabindex="0"`, no focus ring on the article itself)
and then its links in document order, and never an invisible element; every open dialog returns focus to the
article on `Esc`. The PR also pastes the manual checklist: VoiceOver/Orca reads the notice
region (`role="status"`), the palette list is a `listbox` with `aria-activedescendant`.

## Window title

`<name> — marxy`, with ` •` appended while dirty. That is the only persistent indicator. With two panes
it names the **focused** pane's document, with the dot for that document only (`07` §4.4): focus moves
it, a document opened in the other pane does not take it, and an unsaved document in the unfocused pane
is caught by the quit guard rather than shown here. One writer: each pane's open path titles the window
only while its pane has focus, and the focus change re-titles it (`title.ts`, `updateTitle`).

## Close

Unsaved edits live in memory until an explicit save, so closing or replacing a view is where they could
be dropped. The guard (`close.ts`) is a notice, never a modal (§01), and it is **per document**: it
names the document being left ("<name> has changes that are not saved."), it sits in the notices region
of the pane that shows it, and its save writes that document. A document another pane still shows is not
lost by closing or replacing one view, so that asks nothing (text typed in the closing view's Source
goes into the store first).

- **Close a pane:** `Mod+Shift+\` ("Close this pane", listed with two panes) closes the focused pane and
  the other takes the window. Over unsaved changes the pane stays until the reader answers: Save and
  close, Close without saving, or Dismiss. A close refused for any other reason (the other pane has no
  document, or its Source text could not be kept) says so in the pane. `Mod+W` is unchanged: it closes
  the window.
- **Open over unsaved changes,** in either pane: Save and open, Open without saving, or Dismiss, in the
  pane being replaced; nothing is replaced until the answer.
- **Quit or close the window** with unsaved documents asks about each in turn, left to right, each in
  its own pane. Either answer goes on to the next; Dismiss on any stops the quit. The next question is
  worked out afresh each time, Source text in every pane folded in first: a document that became unsaved
  during the walk, or was edited after its answer, is asked about before the window closes. One walk at a
  time: a close request while a save is writing waits for it. A second close request while the last
  document's notice is up quits.
- **`Mod+S`** saves the focused pane's document only.

## Tests

- `state.test.ts`: the transition table; overlays exclusive; `Esc` semantics.
- Playwright: at rest the only visible elements are inside `#marxy-main`; each key in the map
  does what the table says; find lands the current match at 40 % ± 2 px; the fallback path
  draws overlay rectangles and leaves the article's markup untouched; Source round-trip without edits leaves `buffer.bytes` identical.
