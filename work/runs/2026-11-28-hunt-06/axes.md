# Axes

### LOK · look, Studio, settings and config.toml at ordinary sizes
- Round: 1
- Type: domain
- Source: no earlier hunt covered LOK
- Lens: Assume settings, themes and `config.toml` mishandle the ordinary case: a malformed or partial `config.toml`, an unknown or out-of-range value, a setting changed in the Studio that does not persist, apply live or reset, a theme or look switch that leaves stale styles, dark/light and contrast mistakes. Find wrong results, lost settings and crashes. Not performance.
- Start in: apps/desktop/src/studio/, apps/desktop/src/settings/, apps/desktop/src/look/, packages/theme/
- Model: sonnet

### CMD · commands, keys, the Line and the palette
- Round: 1
- Type: domain
- Source: no earlier hunt covered correctness here (hunt 02 CMD was freezes only)
- Lens: Assume a command or chord does the wrong thing or nothing: a chord bound twice or shadowed, a command enabled (`when`) when it cannot run or disabled when it can, a command that leaves the document or selection in the wrong state, the Line parsing a form wrongly (`@`, `:`, numbers, empty input, Escape), the palette choosing a different command than the one shown. Small files only.
- Start in: apps/desktop/src/commands/, apps/desktop/src/line/, apps/desktop/src/menu/, apps/desktop/src/palette/
- Model: sonnet

### VWR · viewers for small files: archives, office, mail, fonts, SQLite, notebooks, media facts
- Round: 1
- Type: domain
- Source: hunt 01 VWR found 4; the readers have since changed (caps, books, certificates)
- Lens: Assume a small, valid-but-unusual file is read wrongly: empty files, one-entry archives, non-ASCII or very long names, odd encodings in mail, notebooks with missing keys, spreadsheets with merged cells, formulas or dates, Word documents with lists, tables and footnotes. Find wrong or missing content, a viewer that errors on a valid file, or a wrong kind detected. Use `fixtures/` and plant small files. Not size caps.
- Start in: apps/desktop/src/viewers/, apps/desktop/src/kinds/, packages/core/src/kind/, packages/core/src/office/, packages/core/src/mail/
- Model: sonnet

### EDT · editing at ordinary sizes: splice, undo, line endings, BOM, save and close guard
- Round: 1
- Type: domain
- Source: hunt 01 EDT found 1; hunt 03 EDT was big files only
- Lens: Assume an edit changes bytes the reader did not ask to change or loses them: CRLF and mixed endings, a BOM, non-UTF-8 files, undo and redo across a save, multi-cursor or replace-all, paste of odd text, typing at a boundary between rendered elements, a save then an external change, the close and quit guard with unsaved edits in a second tab. Small files only. Compare bytes before and after.
- Start in: apps/desktop/src/source/, apps/desktop/src/paste/, apps/desktop/src/save.ts, apps/desktop/src/close.ts, packages/core/src/buffer/
- Model: sonnet

### NAV · tabs, panes, place keeping, history and the left panels
- Round: 1
- Type: domain
- Source: hunt 01 NAV found 2; hunts 02 and 03 NAV were freezes and big files
- Lens: Assume navigation loses or mixes state: closing a tab or pane and what is focused after, split then close, reopening a closed tab, Back and Forward across tabs and links, scroll or caret place restored to the wrong place after an edit or reload, a link to a heading or a relative path resolved wrongly (spaces, `#`, `..`, non-ASCII), drag of tabs, the same file in two panes edited in one. Small files only.
- Start in: apps/desktop/src/pane/, apps/desktop/src/left/, apps/desktop/src/position/, apps/desktop/src/layout/
- Model: sonnet
