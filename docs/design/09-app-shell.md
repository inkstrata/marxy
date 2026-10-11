# 09 — The app shell: DOM, state, keys, outline, find, notices, Source mode

`apps/desktop/src/`. Chrome at rest is zero: at rest the DOM contains the article and nothing
visible else. Everything below is summoned and dismissed.

## DOM skeleton (D-A19)

```html
<body data-marxy-mode="rendered" data-marxy-variant="dark">   <!-- dark is primary (ADR-0024) -->
  <main id="marxy-main">
    <section class="marxy-pane" data-marxy-pane="0" data-marxy-focus>   <!-- one pane per document shown (ADR-0057) -->
      <div id="marxy-notices" role="status"></div>          <!-- empty at rest -->
      <article id="doc" class="marxy-article" data-marxy-s="0" data-marxy-e="…"></article>
      <div id="marxy-source" class="marxy-source-mount" hidden></div>   <!-- CodeMirror mounts here in Source mode -->
      <div class="marxy-find-slot"></div>                   <!-- empty and not drawn at rest; Rendered find fills it -->
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
`content.detected()`), and `Pane.kind()` reads the attribute. No stylesheet has a rule on the attribute yet (the
profiles are K-05b), so it changes no pixel. The palette's kind icon reads the index entry's `readerKind`, and the
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
and `copy-as.menu`) and Find (`view.find`). A story that wants a control registers its command and the control
appears with no change here: `document.new-menu` (W-14), `kind.chip` (K-07), `export.menu` (W-15), `transform.open`
(W-21), and `view.toggle-sidebar` and `view.toggle-inspector` (W-03, with the panel's fill). There is no Extract
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
decided late, or again by a reopen, shows at once). With no document the door is taken out of the row. Where its name
would push a control off the end of the row it gives way to the glyph. Pressing it runs `kind.chip`
(`commands/kind-chip.ts`), a menu in the verb menu's chrome: first why the file is the kind it is (the `Reason`s
`detectFileKind` returned at open, the decisive one first, as quiet rows that do nothing), then *Show as* each kind,
*Show as detected* and *Always open this folder as…* (a second list). A choice runs K-04's command and then reopens the
file, so the kind takes effect now (`AppHandle.open`: unsaved edits meet its own prompt); only `kinds.json` or
`config.toml` is written, never the document. The `strip` region holds the focused kind's tools (`workspace/strip.ts`:
`STRIP_TOOLS`, at most four per kind, each naming a command or `null`; `toolsFor` keeps those whose command is
registered, or the reader's `[strip]` list). A kind with no tool puts nothing in the region and hides it from that
emptiness, on the element, not through `setPanel`: the remembered arrangement is unchanged.

**Remembered panels.** Which regions are docked is `workspace.json` in the data directory beside `layout.json`
(`{ version, panels: { sidebar, toolbar, tabs, strip, inspector, status-bar } }`; same version guard and quarantine).
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
| `Mod+Shift+P` / `Mod+/` | palette on commands (`>`) | W-19: the command list, including the operations; either again closes it; in Source `Mod+/` opens the palette, it does not toggle a comment |
| `Mod+1` / `Mod+2` / `Mod+3` | Read / Split / Source | W-19 (`commands/view-mode.ts`): Read and Source set the focused pane's mode and do nothing when it is already there (`Mod+E` flips). Split shows the document twice, Read left and Source right; with two panes over two files it refuses and says why |
| `Mod+E` | toggle Rendered / Source | position kept (§08) |
| `Ctrl+Mod+S` / `Mod+Alt+I` | dock or undock the sidebar / the inspector | W-03: from folded they unfold with that panel; physical keys, so they work from Source (§Peeking) |
| `Mod+F` | find | `Enter` next, `Shift+Enter` previous, `Esc` closes and keeps the reading position |
| `Mod+Shift+O` | outline | `↑/↓ Enter`, `Esc` |
| `Mod+[` / `Mod+]` | back / forward | history stack (§07) |
| `Mod+S` | save | byte-faithful, atomic |
| `Mod+Z` / `Mod+Shift+Z` | undo / redo | in Rendered mode: the operation history (§01); in Source: CodeMirror's |
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
them in sync. `Mod+O` (Open File…) is native-menu-only in v1: the palette does not yet list it.
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
- Highlights: `CSS.highlights.set('marxy-find', new Highlight(...ranges))` with
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

One region per pane (D-10), in flow above its article, empty at rest. A notice about a file is said in the
pane that shows it and in no other, one about the app in the focused pane; the same words twice in a pane
are one line, and a document opened in a pane clears that pane's notices only. A notice is a single line with up to two
actions, dismissible, and it never overlaps the text. Kinds in v1: blocked content (§02),
external change while dirty (§08), file removed, save failed, theme warnings (§05), index
truncated (§07), operation summary (transient, 4 s). Never a modal dialog.

Styled in `packages/theme/src/base.css` (MARXY-264): the region shares the article's own column
width and margins, and each `.marxy-notice` is its own line with a background
(`--marxy-color-notice`) and border distinct from the page, spaced in grid-unit multiples so it
reads as the app speaking rather than as page content. `.marxy-notice-dismiss` and
`.marxy-notice-action` (theme-document.ts's "Use this theme") share one button style with a
hover and focus-visible state.

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
