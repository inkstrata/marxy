# Shared prototype engine (Marxy mock v2)

Every prototype page loads the same five things, in this order:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">   <!-- copy the exact URL from 01-workspace.html -->
<link rel="stylesheet" href="shared/tokens.css">   <!-- themes, type sets, per-kind typography -->
<link rel="stylesheet" href="shared/app.css">      <!-- chrome, controls, reading surface -->
...
<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
<script src="shared/corpus.js"></script>  <!-- sample library -->
<script src="shared/app.js"></script>     <!-- core -->
<script src="shared/render.js"></script>  <!-- rendering -->
```

Page skeleton:

```html
<div class="win" data-fold="folded">
  <aside class="sidebar" data-slot="sidebar"></aside>   <!-- filled by Marxy.boot() -->
  <div class="main">
    <header class="toolbar">...</header>
    ...page content...
    <footer class="statusbar">...</footer>
  </div>
</div>
<script> /* page code */ Marxy.boot({ active: 'c:plans' }); </script>
```

Icons: `<i data-lucide="name"></i>`, then `Marxy.icons()` after inserting markup. Lucide 0.469 names. Source kinds, folders and repositories use a custom inline-SVG glyph set instead: `G.ic('g-report')` (names `g-prose g-report g-readme g-docs g-code g-data g-log g-terminal g-transcript g-diff g-changelog g-notes g-book g-folder g-repo`); `G.kinds[k].icon` already holds the right name, so `G.ic(G.kinds[k].icon)` just works. Put `data-lang="<id>"` on a row or container and its glyph takes the `--lang` colour (shared/lang-colors.css, loaded after app.css); `G.langId(x)` and `G.langOfPath(p)` give the ids. Pages also load `shared/lang-colors.css` after `app.css`; `boot()` applies the reader's `langCss` overrides.

## Files

| File | Holds |
|---|---|
| `tokens.css` | 8 themes as `[data-theme]` blocks, 5 type sets as `[data-typeset]`, per-kind reading variables on `.doc[data-kind]`. Audited by `tools/audit_contrast.py`. |
| `app.css` | Window, sidebar, toolbar, tabs, panes, mode bar, inspector, status bar, controls (`.btn .field .switch .seg .chip .kbd`), lists (`.list .lrow`), menus, palette, toasts, reading surface (`.doc`), code blocks, tables, admonitions, editor (`.ed`), per-kind presentation. |
| `corpus.js` | `Marxy.collections`, `Marxy.kinds`, `Marxy.docs` (full sources), `Marxy.library` (docs plus metadata-only rows), `Marxy.fs` (paths that "exist"), `Marxy.prevVersions`. |
| `app.js` | Prefs, themes, icons, menus, toasts, collect stack, transforms, copy formats, commands, fuzzy match, command palette, sidebar builder, fold-up. |
| `render.js` | Highlighter, Markdown renderer with `data-line` source mapping, stats, kind detection, measured line length, document views per kind, selection toolbar, Markdown linter, source editor. |

## API (all on `window.Marxy`, usually aliased `G`)

**Preferences** `G.prefs`, `G.prefDefaults`, `G.setPref(key, value)` (persists that key only, emits `pref` and `pref:<key>`; other open windows pick the change up through the `storage` event). 08-settings introduces further keys in its `LOCAL` defaults and exposes its schema as `G.settingsSchema`. Theme keys: `theme` (`system` or a theme id), `themeLight`, `themeDark`, `typeset`, `scale`.

**Themes** `G.themes`, `G.typesets`, `G.customThemes`, `G.themeById(id)`, `G.resolvedTheme()` (built-in id after the schedule and Increase contrast), `G.appliedTheme()` (the custom theme when one stands in for that base), `G.applyTheme()`, `G.themeMenu(anchor)`. `G.applyTheme` also loads the compiled stylesheet that 07-themes saves (`themeCss`) and sets the root classes for code highlighting (`hl-minimal`, `hl-off`, `cm-upright`, `defs-plain`) and reduced transparency (`solid`). An element carrying `data-theme="dusk"` renders its subtree in that theme, which is how swatches and side-by-side previews work.

**UI** `G.menu(anchor, items, {width, align:'end'})` with items `{label, icon, kbd, run, desc, checked, disabled, sub}`, `{sep:true}`, `{header}`, `{html}`. `G.toast(msg, {icon, action:{label, run}, ms})`: `msg` is HTML, so pass every interpolated value through `G.esc`. `G.ui.setActive(navKey)` moves the sidebar highlight for pages that route by hash. `G.palette.open(prefix)`. `G.ui.sidebar(opts)`, `G.ui.statusbar(items)`. `G.el(html)`, `G.esc`, `G.ic(name)`.

**Commands** `G.command({id, name, icon, kbd, group, run})`, `G.run(id)`. Any element with `data-cmd="id"` runs that command on click.

**Copy and collect** `G.copy(text, {as, source, lang})` writes, stacks in collect mode and toasts. `G.copyAs(formatId, text)`, `G.copyFormats`, `G.copyMenu(anchor, getText)`. `G.stack.on / items / toggle() / joined(sep)`. Event `stack`.

**Transforms** `G.transforms` (`{id, group, name, icon, desc, fn(text, ctx)}`; groups Clean, Convert, Lines, Case, Extract), `G.transform(id, text, ctx)`, `G.transformMenu(anchor, getText, apply(t, out))`.

**Rendering** `G.md.render(src, {bare, checkPaths})` returns `{html, meta, headings, tasks, code, tables, footnotes}`. `G.renderDoc(el, doc, {kind, justify, focus, wrap, literate, handles, kindTheme})`; it ends by calling `G.applyReadingPrefs(el, kind, opts)`, which applies the reader settings and per-type overrides with the spec's coupling rules, and pages re-render on the `reading-prefs` event. `kindTheme: true` applies the per-type theme and type set (leave it off for side-by-side previews). `G.hl(code, lang)`. `G.mdSourceLines(src)`. `G.stats(src)` (words, lines and the like, no token count), `G.detect(doc)` (returns `{kind, conf, reasons}`; show the kind name only, keep the reasons for menus). `G.measureDoc(el)` and `G.colophon(el)` report the live face, size, leading and characters per line.

**Fold-up** `G.fold` folds the workspace to the document column and back. `G.fold.fold()`, `G.fold.unfold()` and `G.fold.toggle()` change state; `G.fold.toggle(part)` toggles one part, where `part` is `'side'` (sidebar), `'bar'` (toolbar and tabs) or `'insp'` (inspector); `G.fold.dock(part)` docks a peeked part into the layout; `G.fold.isFolded()` reports the state. A window opts in by being `.win`, and starts folded with `<div class="win" data-fold="folded">`; it opts out with `data-fold="off"`. Chrome is plain `.sidebar`, `.toolbar`, `.tabs`, `.statusbar`, `.inspector`, `.modebar` and `.pane-head`, and the engine folds them by class, so a page needs no fold code of its own. Shortcuts: ⌘\ (Ctrl \ elsewhere) toggles, Escape folds when nothing else is open, ⌃⌘S and ⌥⌘I dock the sidebar and inspector; the palette command is "Fold / Unfold workspace". The window always launches folded; the last unfolded arrangement is remembered.

**Editor** `G.Editor(host, {value, lang, wrap, minimap, lint})` returns `{getValue, setValue, on('change'|'cursor'|'scroll'), scrollToLine, reveal, select, getSelection, replaceSelection, insert, setWrap, undo, diags}`.

## Rules for pages

- Colours only from tokens. A page must work in all eight themes.
- No emoji in UI or copy.
- Lists of rows by default; cards only for rich, self-contained items.
- Every control does something: real behaviour where the prototype can, otherwise a toast that says what the full app does.
- Keyboard reachable, visible focus, real labels.

## Added in round 3

- **Sidebar** `G.ui.sidebar(opts)` builds Recent (foldable, `G.recent`), Library views, Repositories and Folders (`type: 'repo' | 'folder'` on `G.collections`, `changed` is the quiet count) and Smart collections. Repositories and folders are lazy trees over `G.tree.children(collId, rel)`; open state is kept in `localStorage` (`sideOpen`, `sideRecent`). `G.ui.mountSidebar(opts)` re-renders it, `G.ui.reveal(doc)` opens the folders above a document. Root rows keep `data-nav="c:<id>"`; tree rows carry `data-doc`.
- **Documents** `G.docById(id)` (corpus, made files, or a stand-in from `G.synth`), `G.userDocs`, `G.recent.push/docs`, `G.newFile()`, `G.newFileIn(folder)`, `G.forkDoc(doc)`, `G.saveDoc(doc)`, `G.fileSheet({title, name, folder, onOk})`, `G.newMenu(anchor)`, `G.openAny(id)`. A page with tabs defines `G.openDoc(id, {newTab})` and `G.closeDoc(id)`, and listens for the `docs-changed` event. Commands: `new-file` (⌘N), `new-file-here`, `fork` (⇧⌘N), `save` (⌘S), `new-menu`, `copy-doc`, `copy-as` (⇧⌘C).
- **Copy** `G.copy` shows a quiet toast ("Copied as Markdown · 412 characters"). `G.copyMenu(anchor, getText, {header})` lists Markdown, Plain text, Rich text, HTML, Code block with path, then More formats. `G.copyScope()`, `G.copyScoped()`, `G.copyAsScoped(anchor)` resolve selection, else the block under `G.pointer`, else the document. The editor's gutter has a context menu (Copy line, Copy lines with path:line).
- **Kinds** `log` and `terminal`: detection in `G.detect`, rendering in `G.renderDoc` (`opts.level` filters a log), `G.logLevels`, `G.termParts(src)`. Tool ids: log `copy-as level wrap first-error tail`; terminal `copy-cmds copy-out wrap`. `G.kindTools` has no Tasks tool.

## Added in round 4

- **Source frame** `G.Editor(host, {value, lang, path, kind, base, wrap, lint, menuItems})` builds the framed editor (top bar, ruler, gutter, strip, bottom bar). New API: `getRaw()` (the file with its real line breaks), `setPath`, `setBase`, `setFindHits(ranges, current)`, `cw()` (the character width the ruler uses), `info()`. Helpers: `G.srcInfo(raw)`, `G.scanInvisible(text)`, `G.cpLabel(char)`, `G.cpName/cpHex`, `G.langLabel`. Prefs `edShowWs`, `edGuide`. The minimap is removed.
- **Measures** `G.measure(src, {kind, keys})`, `G.measureParts`, `G.measureFirst`, `G.measureSel`, `G.measureKeys(kind)`, `G.measureStats`. Prefs `measuresMode`, `measures`, `kindMeasures`, `tokenizer`.
- **Metadata** `G.meta.get(doc)`, `G.meta.rows(doc)`, `G.meta.setOv(id, patch)` (edits kept in localStorage `meta`), `G.fm.parse/set/add/remove` (front matter edits that splice only the affected lines). Pref `showMetadata`; command `toggle-metadata` (⌃⌘I).

## Added in round 5

- **In-page document view** `G.docView(host, {backLabel, onClose})` returns `{open(id, mods), back, forward, close, isOpen}`: a pages without tabs defines `G.openDoc = (id, mods) => dv.open(id, mods)`. `G.resolveLink(href, fromDoc)` maps a link to a document id; `G.pageDocs` registers documents a page invents. Sidebar file rows call `G.openDoc` when a page has one.
- **Share** `G.shareButton(ctx)`, `G.shareMenu(anchor, ctx)`, `G.exportItems(doc)`; commands `share-menu`, `export` (⇧⌘E). `G.kindOverflow` lists kind tools shown only in a strip's … menu.
- **Notes** `editor.notes()` and `editor.nextNote()`; the Source frame never decorates text for problems.
