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

No element outside `#marxy-main` is visible unless its state is open. There is no toolbar,
tab bar, status bar or sidebar element in the DOM at all, so the "chrome at rest" gate is a DOM
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

Still bound to the first pane rather than the focused one, until the Phase D story named moves them:
the Rendered selection and command context (D-06), the window as scroller and the reading persistence
(D-05, D-12), the mode attribute on `<body>` (D-11), the close guard's prompt (D-08), notices other
than a pane's own region (D-10). The window title is the focused pane's document: a document opened in
the other pane does not take it, and focus moves it. Each pane's open path keeps its own live-reload
watch on the store it shows, closed when that pane lets the store go, even while the other pane still
shows it; one watch per store, however many panes, is D-10's.

## Keyboard map

`Mod` is `⌘` on macOS and `Ctrl` on Linux (and Windows later). Bound in one table
(`keys.ts`); the palette lists every command with its key so the map is discoverable without
chrome.

| Key | Action | Notes |
| --- | --- | --- |
| `Mod+P` | palette (documents) | with a selection: `Mod+P` again shows operations |
| `Mod+Shift+P` | palette (operations) | |
| `Mod+E` | toggle Rendered / Source | position kept (§08) |
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
| `Esc` | close overlay, else clear selection | |
| `Mod+C` | copy | runs the selection's default copy verb, from the table in §03 (never a splice, never a string-prefix match); with no default verb, the DOM selection |
| `Mod+Shift+C` | copy as markdown | the exact source bytes of the selected block, or of the blocks a drag covers (§03) |
| `Enter` | open the verb menu | with a `node`, `section`, `document` or `text` selection, outside editable fields and with no dialog open; anchored to the selection (§03, ADR-0054). On a selected link or heading anchor, Enter opens the verb menu, not the link; the link's default verb is "open link" (Enter again, or the first row) |
| `ContextMenu` / `Shift+F10` | open the verb menu | same; right-click and Ctrl-click open it at the pointer |

No single-letter bindings in v1 (a reader may be typing in find or the palette).

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

## Outline

Built from the AST's headings (`level`, text, `src.start`). Rendered as a `<dialog>` at the
right edge, width `min(320px, 40vw)`, one line per heading, indented by level. The current
heading (the last with `start ≤ position.byteOffset`) is marked; opening the dialog scrolls it
into view. `Enter` on a heading selects its section (§03) and scrolls it to the reading line;
`Esc` closes. Frontmatter `title:` shows as the first entry when there is no h1.

While the outline is open, the current-heading mark follows scrolling (the same per-frame
position sample §08 takes; no second scroll listener). Module: `apps/desktop/src/outline/`
(`outline.ts` builds entries from the AST — pure, tested without a DOM; `view.ts` owns the
dialog). Entries are plain text: inline markup in a heading is flattened with `textContent`
semantics, smart typography applied as in the article.

## Find (D-A14)

- Input at top-right, no chrome until `Mod+F`. Case-insensitive, whole document, incremental.
- Matching runs over a text index built at render: the concatenation of the article's text
  nodes with a map from string offset to `(textNode, offset)`. Soft hyphens (U+00AD) and the
  typesetter's `<br>` are invisible to it: the index is built *before* typesetting and kept in
  sync by the typesetter's split records (each split maps a node to its two halves).
- Highlights: `CSS.highlights.set('marxy-find', new Highlight(...ranges))` with
  `::highlight(marxy-find)` styled by the theme; the current match in a second highlight.
  Fallback when `CSS.highlights` is undefined: wrap matches in `<mark class="marxy-find">`
  and unwrap on close (the fallback is exercised by a test that deletes `CSS.highlights`).
- Navigation scrolls the current match to the reading line (40 % of the viewport), never to
  the top edge. Count shown as `3 of 41` inside the input.
- In Source mode, find is CodeMirror's `@codemirror/search` panel with the same key.
- **Matching folds what the renderer changed.** The article shows smart typography (§02) but a
  reader types straight quotes and double hyphens. The query is compiled to a regular
  expression (flags `giu`) after escaping, with these substitutions applied to the query, never
  to the text: `'` → `['‘’]`, `"` → `["“”]`, `---` → `(?:---|—)`, then `--` → `(?:--|–)`,
  `...` → `(?:\.\.\.|…)`, a space → `[ \u00A0]`. Everything else matches literally,
  case-insensitively. The haystack is the text index, which never contains soft hyphens.
- **Scope.** Text inside `.katex` subtrees is excluded from the index (it is layout glyphs, not
  the source); the TeX source is not searchable in Rendered mode in v1. Code blocks, tables and
  footnotes are included. Alt text is not (it is not painted unless the image is missing).
- **Budget.** Matching reruns one frame after the last keystroke; `find_first_match` is marked
  when the first highlight is set. < 50 ms for `01-long-technical.md` on the reference tier.
- Module: `apps/desktop/src/find/` (`text-index.ts` pure over a list of text-node strings,
  `query.ts` the compiler above, `view.ts` the input and highlights).

## Notices (`#marxy-notices`)

One region, in flow above the article, empty at rest. A notice is a single line with up to two
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

CodeMirror 6 in `#marxy-source`, created on first switch and kept:

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

Per-file-type default: `.md .markdown .mdx .txt` open Rendered; everything else Source. A
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

`<name> — marxy`, with ` •` appended while dirty. That is the only persistent indicator.

## Tests

- `state.test.ts`: the transition table; overlays exclusive; `Esc` semantics.
- Playwright: at rest the only visible elements are inside `#marxy-main`; each key in the map
  does what the table says; find lands the current match at 40 % ± 2 px; the fallback path
  wraps and unwraps `<mark>`; Source round-trip without edits leaves `buffer.bytes` identical.
