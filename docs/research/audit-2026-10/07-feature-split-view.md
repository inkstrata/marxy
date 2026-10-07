# 07. Feature study: a split view for cross-reference

Date: 2026-10-01. Part of the MARXY-346 audit. Worktree `docs/MARXY-346-project-audit-codebase-orchestrator-prod`, at `origin/main`.

**Abstract.** The author wants "a tiled-window-manager-style screen split to park documents next to each other for cross-reference." This study asks what in Marxy helps that, what fights it, what other tools do, and what to build first. The findings: the Rust file watcher is already multi-document and needs no change; the typesetter attaches per article and handles two articles at about the cost of one; two full-measure columns fit on any window at least 1,318 px wide. Against that, the app shell holds "the open document" as 55 module-level variables across nine files, the page scrolls the whole window rather than a pane, the default theme sizes wide code and tables from `100vw` (measured: a code block spills 343 px out of a half-width pane), and ADR-0037, the document-store refactor that would be the natural foundation, is still unimplemented and, as written, puts the view mode and reading anchor in the store, which is exactly wrong for two views of one file. The recommendation is a two-column in-window split, built on an amended ADR-0037 that separates a document (store) from a view, after a short, separate step that lets Marxy open a second OS window so the author can try cross-reference with macOS tiling today. Nothing here needs a `shell-api` change for the split itself.

---

## 1. Findings

1. **The Rust watcher is not the obstacle.** `watch_root` keeps a ref-counted table of one poll thread per canonical directory, and events go out on one app-wide channel that each TypeScript subscriber filters by root (`apps/desktop/src-tauri/src/main.rs:249-330`, `apps/desktop/src/shell/tauri.ts:142-168`). Two documents, in one directory or two, already work at that layer.
2. **The app shell is the obstacle.** `apps/desktop/src/app.ts` is 1,399 lines with 33 top-level `let`s that together mean "the open document". Nine files hold 55. All of it assumes one document, one scroller (`document.documentElement`), one `#doc`, one `#marxy-source`, and one mode stored on `<body>`.
3. **The typesetter is per article and nearly ready.** `attach(article, opts)` (`packages/typeset/src/index.ts:103`) owns its own queue, generation counter and observer. Two places read `window.innerHeight` (lines 261 and 270), which is correct for side-by-side panes and wrong for stacked ones.
4. **The theme is the hidden blocker.** `--marxy-room` and a media query are computed from the window, not the column's container (`packages/theme/src/base.css:100`, `:125`). In a half-width pane they push code blocks and tables into the neighbouring pane. This is the one place where "just put two articles in a flex row" visibly breaks.
5. **Typography is fine at 1,318 px and up.** Two 66-character columns need 1,318 px. A 1,470 px laptop window gives each pane 735 px, which holds the full measure. A 960 px window gives 46.7 characters per pane, inside the handbook's 45 to 80 range but at its floor.
6. **ADR-0037 needs a small amendment before anyone builds it.** It puts `mode` and `anchor` in the one document store. With two views of one file, mode and anchor belong to the view.
7. **Find and outline are not built yet** (MARXY-48 is blocked, per `node orchestration/fleet.mjs why MARXY-48`). They can be written pane-aware from the first line, which is cheaper than retrofitting.
8. **The handbook warns about the obvious use.** `docs/research/reader-artifacts/01-reading-tasks.md` names "reading two full texts side by side" as the failure mode of the compare task. Split view serves cross-reference (plan next to result, README next to source). For "two versions of a regenerated file" a diff operation is the right tool and a split is the wrong one.

## 2. What helps and what fights it

Depth key: **shallow** is a local edit; **medium** touches several call sites but keeps its shape; **deep** needs a design change first.

### 2.1 Things that help

| What | Where | Why it helps |
| --- | --- | --- |
| Watcher is ref-counted per root, events are broadcast | `apps/desktop/src-tauri/src/main.rs:249-330`; `apps/desktop/src/shell/tauri.ts:142-168` | A second document adds a subscription, not a thread. Same directory shares one thread. |
| Position functions take the scroller as a parameter | `apps/desktop/src/position/position.ts:15-37` | `currentPosition(scroller, blocks, path, mode)` and `restoreScrollToPosition(...)` already work on any element, not only the window. |
| Reading position is a byte coordinate, not a pixel offset (ADR-0018) | `docs/adr/0018-reading-position-coordinate.md` | A pane that is resized, or a document shown at two widths, keeps its place. |
| Typesetter is per article | `packages/typeset/src/index.ts:103`, `packages/typeset/src/grid.ts:10` (`snapped` is a `WeakMap` keyed by article) | No global state to collide. |
| Source mode is a mounted CodeMirror, created on demand | `apps/desktop/src/app.ts:226-232` | One instance per view is a natural extension. |
| Close guard, save and title are small and host-injected | `apps/desktop/src/close.ts:21`, `apps/desktop/src/save.ts:24` | Each reads from one `host` object, so redirecting them to "the focused view" is one change each. |
| The chrome-at-rest gate asserts on `#marxy-main` | `scripts/gate-aesthetics.mjs:548-562` | Panes inside `#marxy-main` pass the gate. A divider hairline passes too. |
| The aesthetics gate already renders at 720 px | `scripts/gate-aesthetics.mjs:57` | A half-pane of a 1,440 px window is a width the corpus is already judged at. |
| Palette is the document switcher and already keeps an MRU stack (ADR-0011) | `docs/adr/0011-palette-not-tabs.md` | "Split with recent" is a palette row, not a new surface. |

### 2.2 Single-document assumptions

| # | Assumption | Evidence | Depth |
| --- | --- | --- | --- |
| 1 | The open document is 33 module-level variables: `openPath`, `documentBuffer`, `state.document`, `bytesOnDisk`, `viewMode`, `sourceEditor`, `anchor`, `typeset`, `resizeObserver`, snap timers and more | `apps/desktop/src/app.ts:165-195`, `:611`, `:644`, `:700-702`, `:723` | **Deep.** This is the refactor. It is also what ADR-0037 describes, from the other direction. |
| 2 | Document state is also held in `selection/view.ts` (10 `let`s: `ctx`, `state`, `installedOn`, link history `navHistory`/`navIndex`), `commands/edits.ts` (undo `history`, `savedVersion`, `saved`, `historyBase`), `save.ts:24`, `close.ts:21`, `notices/index.ts:11-12`, `palette/session.ts:19` | `apps/desktop/src/selection/view.ts:75-85`, `apps/desktop/src/commands/edits.ts:10-19` | **Deep.** ADR-0037 already names the first three as the holders to remove. |
| 3 | The page scrolls the window: `readingScroller()` returns `document.documentElement`; `selection/view.ts` and the palette copy that | `apps/desktop/src/app.ts:197-199`, `apps/desktop/src/selection/view.ts:94`, `apps/desktop/src/palette/view.ts:515` | **Medium.** Each pane must be its own `overflow: auto` container, which changes where the scroll listener, find's "reading line" and the anchor-hold logic attach. Three call sites, one helper. |
| 4 | Fixed ids in the skeleton: `#doc` (20 `getElementById('doc')` calls in `src/`, 54 test, script and package files mention it), `#marxy-source`, `#marxy-notices` | `apps/desktop/index.html:22-26`; `grep -rlE "#doc|'doc'"` | **Medium, with a trick.** Keep `#doc` as the id of the focused-or-first pane's article so the 54 files keep passing, and mark panes with a new `data-marxy-pane` attribute. |
| 5 | Mode is a `<body>` attribute (`data-marxy-mode`), and CSS keys on it | `apps/desktop/src/app.ts:212-224`, `apps/desktop/index.html:14-17` | **Medium.** Move to a pane attribute. `data-marxy-mode` is already in the registry; the pane marker is new. |
| 6 | Source mode is a `position: fixed; inset: 0` overlay covering the whole window | `apps/desktop/index.html:16` | **Medium.** Must become per-pane. Source in one pane and Rendered in the other is a feature (section 4.5), not a bug. |
| 7 | One `ResizeObserver`, one pending grid pass, one anchor | `apps/desktop/src/app.ts:723-760`, `:644-697` | **Medium.** Becomes per-view state. The logic itself is sound; it is just singleton-shaped. |
| 8 | One position store key per path | `docs/design/08-position-and-watching.md` ("Persistence"); `packages/core/src/position/persistence.ts` | **Shallow if one key per path stays.** Two views of one path need a rule: the focused or first view writes it (section 4.6). |
| 9 | `positions.json` and palette history are read once into memory and written whole | `apps/desktop/src/app.ts:1044-1062`; `PositionPersistence.open` | **Shallow in one window, deep across two OS windows.** Each webview would keep its own copy and the last writer wins. This is a cost of the multi-window option only. |
| 10 | Global overlays assume one article: palette binds `#doc` and the window scroller at mount; outline and find (unbuilt) are specified against "the article" | `apps/desktop/src/palette/view.ts:509-515`, `docs/design/09-app-shell.md:87-127` | **Shallow now, deep later.** Cheap while find and outline are unwritten. |
| 11 | Rust names a window `"main"` in five places: `set_title`, `close_confirmed`, `focus_main_window`, a menu path, the close handler. The capability file grants `windows: ["main"]` | `apps/desktop/src-tauri/src/main.rs:145,173,442,756,845`; `apps/desktop/src-tauri/capabilities/default.json` | **Not an obstacle to an in-window split. A real one for multiple windows.** |
| 12 | "Close Window" quits the process, "since Marxy is single-window" | `apps/desktop/src-tauri/src/main.rs:349-353`, `:614-616` | Same as 11. |
| 13 | A second launch is routed to the one window | `apps/desktop/src-tauri/src/main.rs:466-476`, `:795-797`; ADR-0013 | **Shallow for a split** (it opens into the focused pane). **Deep for multiple windows** (it must pick or create a window). |
| 14 | Process-wide render counters for the harness paint deadline | `apps/desktop/src-tauri/src/main.rs:367-376` | Only multi-window cares. |

Nothing in `packages/core` assumes one document: the parse, source map, operations and position maths are pure functions of a buffer. The coupling is entirely in `apps/desktop`.

### 2.3 What ADR-0037 gets right and wrong

ADR-0037 (status: proposed, MARXY-248) proposes `apps/desktop/src/document/store.ts` owning `path`, `disk`, `buffer`, `ast`, `nodeMap`, `mode`, `history`, `anchor`, `version`, with seven transitions and `subscribe()`. It explicitly leaves "more than one open document" undecided. Two corrections are needed so it does not have to be redone:

- **`mode` and `anchor` move out of the store into a view.** One file shown twice may be Rendered in one pane and Source in the other, and each has its own anchor. The store keeps what is true of the bytes: `path`, `disk`, `buffer`, `ast`, `nodeMap`, `history`, `version`. The view keeps `mode`, `anchor`, `scroller`, the typesetter, the resize observer, the Source editor and the selection.
- **The store is keyed by canonical path, and many views may subscribe.** `apply` bumps `version`; every view re-renders and maps its own anchor through the edit (the ADR's clause 6 already specifies the mapping). That also fixes the multi-window hazard of two buffers for one file, inside one window.

This is a one-paragraph ADR amendment today. After the store is built it would be a refactor.

## 3. Prior art

Verified by search in this session: macOS, VS Code, Obsidian, Arc, Zed, Logseq, Notion, Craft, Kaleidoscope. The rest is from general knowledge and is marked (g); treat the exact key chords there as unverified.

| Tool | Split model | Create / focus / close from the keyboard | Linked scroll | Layout persists | Chrome cost |
| --- | --- | --- | --- | --- | --- |
| **i3 / sway** (g) | Tree of containers, split direction chosen before the next window | `mod+h`/`mod+v` set direction; `mod+arrows` move focus; `mod+shift+q` kills | No | Per workspace, in memory | Title bars and borders by default; configurable to none |
| **yabai** (g) | Binary space partition per space | Scripted, `yabai -m window --focus west` | No | In memory | None, optional border |
| **Amethyst** (g) | Fixed layout modes (tall, wide, columns, fullscreen), no tree | Cycle layout, focus next/previous, swap | No | Per space | None |
| **Rectangle** (g) | No tiling, snap to halves, thirds, quarters | Shortcuts per snap position | No | No | None |
| **macOS 15 / 26 tiling** | Two windows to halves or quarters; Split View is a separate full-screen Space | `Fn+Ctrl+arrows` tile the active window; `Fn+Ctrl+Shift+arrows` place it and arrange the second; drag to edge | No | The OS remembers window frames, not pairs | Zero in-app |
| **Zed** | Panes; each can split again, so a tree | `cmd-k` then an arrow splits; `cmd-k cmd-arrow` moves focus; `cmd-\` splits right; drag divider, double-click resets to even | No | Per workspace | Tab bar per pane, a divider line |
| **VS Code** | Editor groups arranged in a grid, nested | `Cmd+\` split; `Cmd+1/2/3` focus group; "Toggle Locked Scrolling Across Editors" and a hold-to-lock command | **Yes**, pixel-delta, opt-in | Yes, with the workspace | Tab bar per group, sash |
| **Emacs** (g) | Windows are a tree; frames are OS windows | `C-x 3` / `C-x 2` split; `C-x o` other window; `C-x 0` close; `C-x 1` only this | `follow-mode` for one buffer in two windows | Via `desktop-save` or `winner-mode` for undo | Mode line per window |
| **Vim** (g) | Window tree | `:vsplit`, `Ctrl-w h/j/k/l`, `Ctrl-w c`, `Ctrl-w o`; `:set scrollbind` | **Yes**, `scrollbind` | Via sessions | One status line per window |
| **Acme** (g) | Columns of stacked windows, mouse-driven | Mouse: middle-click `New`, `Newcol`, `Delcol` | No | No | A tag line per window |
| **Sublime Text** (g) | Fixed layouts (1, 2, 3 columns, grid) | `Cmd+Opt+2` for two columns; `Ctrl+1/2` focus group; `Ctrl+Shift+1/2` move file | Per-group, plugins only | Yes | Tabs per group |
| **tmux** (g) | Tree of panes, window = a layout | prefix `%` and `"` split; prefix arrows focus; prefix `x` close; prefix `z` zoom | `synchronize-panes` types into all, not scroll | Via plugins | A one-cell border |
| **kitty** (g) | Named layouts (tall, grid, stack) | `ctrl+shift+enter` new window; layout cycling; focus by number | No | Via session files | A border, optional |
| **iTerm2** (g) | Tree of panes | `Cmd+D` / `Cmd+Shift+D` split; `Cmd+Opt+arrows` focus; zoom a pane | No | Per window arrangement | Pane title optional |
| **Arc** | Up to four tabs side by side, grid or columns | `Ctrl+Shift+=` splits the current tab, then a tab picker; drag to rearrange | No | Split is a saved tab group | Divider and a pane-level tab bar |
| **Preview / PDF viewers** (g) | Two windows, or two documents in a sidebar and a view | Mouse; Window menu | No | Per window | System chrome |
| **Obsidian** | Panes split right or down, tabs inside; any pane's tab group is a tree | Palette "Split right"; `Cmd+click` a link to open it in a new pane; "Link with tab" for a linked pair | **Yes**, scroll synced between linked tabs | Yes, in the workspace | Tab headers, optional hiding |
| **Logseq** | One main page plus a right sidebar stack | `Shift+click` or `Shift+Enter` opens in the right sidebar; sidebar pages stack | No | Sidebar state persists | A sidebar |
| **Kaleidoscope** | Two or three panes of one comparison (diff, not free documents) | Keyboard next/previous change | **Yes**, sync scroll with block alignment | Per comparison | Toolbar, change bar |
| **Meld** (g) | Two or three diff panes with curved connectors | Keyboard next/previous change | **Yes** | No | Toolbar, gutters |
| **Notion** | Side peek, a transient right panel; no persistent split | Click a link, choose Side Peek | No | No | A panel |
| **Craft** | Multiple OS windows, tiled with macOS Split View | OS | No | OS | System chrome |
| **Kindle / Books readers** (g) | None | None | None | None | None |

### What to borrow

- **Obsidian's "open the link in the other pane"** is the pattern that matches the stated use. A README links to a plan; a plan links to a result. The reader follows the link into the neighbour and keeps the origin in view. `Cmd+click` is the convention in both Obsidian and the browsers.
- **Zed's divider**: drag to resize, double-click to reset to even. No handle, no label.
- **VS Code's numbered focus (`Cmd+1`, `Cmd+2`)** and its `Cmd+\` to split. Familiar, one key each, no mode.
- **Amethyst and Sublime, not i3**: a fixed small set of layouts beats a tree for a reader. A tree is for people who need nine panes; the typography allows two to three (section 5).
- **Logseq's lesson in reverse**: it uses a persistent sidebar, which is chrome. Marxy should not.
- **VS Code's locked scrolling, as opt-in and explicit.** Obsidian and Vim both show the feature is wanted for two views of related text. All three do it in a way that fails for unrelated documents, so it should never be on by default.
- **Do not borrow tab bars, title strips, borders or pane headers.** They are the chrome Marxy has ruled out (`docs/design-language.md` constraint 6; ADR-0011).
- **Kaleidoscope and Meld are comparison tools, not split views.** Their sync scroll works because they align changed blocks. A split of two unrelated files cannot do that. That is the argument for a separate diff story if "two versions of a regenerated file" matters.

## 4. Design

### 4.1 Pane model: columns, two at first

An ordered list of **columns**, not a tree. Version one allows two. The data model is a list so that a third column later is a limit change, not a redesign; the width floor (section 5) caps it in practice at two on a laptop and three on a 1,400 px or wider window. No vertical splits. A stacked pane halves the height, which costs reading lines and gains nothing for prose, and the typesetter's `window.innerHeight` assumptions would fail.

### 4.2 Creation

From the palette, because the palette is already the document manager (ADR-0011):

| Action | How |
| --- | --- |
| **Open beside** | `Mod+\` opens the palette in "beside" mode: Enter opens the chosen document in the other column, creating it if absent. With an empty query the first row is the most recent other document, so `Mod+\` then Enter is **split with recent**. |
| Open beside from a result | `Mod+Enter` on any palette row. |
| **Follow a link into the other pane** | `Mod+click` on a relative link to a Markdown file (the existing `MARKDOWN_LINK` path in `apps/desktop/src/selection/view.ts:87`). Plain click keeps today's behaviour: replace in this pane. |
| **Same document twice** | A palette command "Split this document". Yes, a pane may show the same file twice. Two positions in one long document is a strong reading use (a spec's constraints against its examples). Both views subscribe to one store, so edits and live-reload reach both. |
| Close | `Mod+Shift+\` closes the focused pane and the survivor takes the window. Not `Mod+W`: that is the native menu's Close Window and quits (`apps/desktop/src-tauri/src/main.rs:614-616`). |

### 4.3 Focus

One focused pane at a time; the other is still scrollable and selectable. `Mod+1` and `Mod+2` focus left and right; `Mod+Alt+Left` and `Mod+Alt+Right` do the same for people who think spatially. A click or a scroll-wheel gesture in a pane focuses it. Focus is shown without chrome (4.4). Everything window-level binds to the focused pane **at the moment it opens**: the palette (`Mod+P` opens in the focused pane unless "beside"), find, outline, copy, operations, `Mod+E`, undo, save. Esc returns focus to the pane that was focused when the overlay opened, matching the keyboard-completeness rule in `docs/design/09-app-shell.md:187-196`.

### 4.4 The divider and the focus mark

At rest in one pane: nothing changes; the DOM skeleton adds no element for a single document. Splitting is itself a summoned state, so a split may show one thing:

- **One 1 px hairline** between the columns in the theme's rule colour, inside `#marxy-main`. The two 24 px gutters already make a 48 px gap; the hairline only says "these are two documents."
- **No handle.** The hairline's hit area is 8 px wide with a col-resize cursor. Drag resizes, double-click resets to even (Zed).
- **Focus is shown by the title and a 150 ms accent fade on the divider's focused side**, not by dimming the other pane. Dimming lowers contrast, and the aesthetics gate checks contrast. The window title names the focused document (`docs/design/09-app-shell.md:198-200`), plus a pane-sized dot for dirty on the focused one only.
- Whether the hairline is on by default is a taste call and goes on the taste queue.

### 4.5 Mode per pane

Each pane has its own Rendered/Source mode (ADR-0005). `Mod+E` toggles the focused pane. Rendered on the left and Source of the same file on the right is the one workflow where "reader but adept at both" meets the split: read the typeset README while the raw bytes sit next to it. ADR-0005's "preserves reading position via the source-map coordinate" already works per view. Source is a CodeMirror mounted in the pane rather than `position: fixed; inset: 0`.

### 4.6 Reading position per pane

Each view holds its own anchor, always as a byte coordinate (ADR-0018). Persistence rule: `positions.json` stays keyed by path and is written by the **first pane showing that path**, or by the focused one if both show it. The second view of a file opens at the first view's position and is not persisted. Layout itself persists separately in `layout.json` next to `positions.json`: `{ version, columns: [{ path, mode }], ratio, focused }`. It is restored only when the app launches without a file argument; a launch with a file replaces the focused pane's document. A path that no longer exists is dropped with the standard removed-file notice.

### 4.7 Scroll: independent by default

Independent scroll is the only default. A palette command "Link scrolling" (no key) syncs the panes by **reading-position coordinate**, not pixels. That is meaningful in one case: two views of the same file, or two versions of one file where byte offsets roughly track. For different documents nothing aligns, and pixel locking (VS Code's approach) scrolls two unrelated texts in lockstep, which is noise. A later refinement would align by shared heading text, which is a diff-adjacent story and should not ship in the first slice.

### 4.8 Find, outline, notices

- **Find** is bound to the focused pane's article and searches only it. `Mod+F` opens it anchored in that pane's top right; the count belongs to that pane. Searching both is a later palette command.
- **Outline** shows the focused pane's headings; the dialog is at the right window edge today, so with a split it would cover the right pane. Anchor it to the focused pane's right edge. (It is a modal summoned overlay, so covering text is acceptable.)
- **Notices** (`#marxy-notices`, `docs/design/09-app-shell.md:129-141`) are one region above the article. Make them per-pane: a pane's blocked-content or file-removed notice describes that pane's document.

### 4.9 Multiple windows, and macOS tiling

macOS 15 added OS window tiling (`Fn+Ctrl+arrows`, drag to edge, `Window > Move & Resize`), and macOS 26 keeps it alongside the older Split View ([Apple Support](https://support.apple.com/guide/mac-help/change-window-tiling-settings-on-mac-mchl118087b0/mac)). So on the author's machine the "tiling" is already free once Marxy can open a second window.

| Option | What it gives | What it costs | What it cannot do |
| --- | --- | --- | --- |
| **A. Multiple OS windows, tiled by macOS** | Cross-reference today; zero typographic risk because each window is a full viewport and every `100vw`, `documentElement` and `#doc` assumption stays true; each webview is its own JS realm, so section 2.2 rows 1 to 7 vanish | A `shell-api` member (open a new window), so an ADR (ADR-0026 says later members need one). Rust: five `"main"` sites, the capability glob, close-quits-the-process, single-instance routing. Persistence merge for `positions.json` and palette history across webviews. A stale-write guard already exists (`shell.recordRead`, `apps/desktop/test/tauri-stale-write.test.mjs`), but two buffers for one file is back, so opening an already-open path should focus its window | Same file twice with independent positions; "open link in the neighbour"; layout restore; linked scroll; `Mod+1/2` focus (macOS has `Cmd+backtick` between windows, which is fine) |
| **B. In-window two-column split** | All of 4.1 to 4.8 | The refactor in section 6: amended ADR-0037, per-view state, per-pane scroller, a theme fix. No `shell-api` change, no Rust change | Dragging a pane to another monitor |
| **C. Marxy places its own two windows left and right** | Feels like a split, built on A | Window-frame operations: a second `shell-api` member and ADR, like ADR-0038's `setWindowControls` | Fights the user's own window manager |

**What to pick first.** A hybrid, in this order:

1. **Do the ADR-0037 amendment now.** It is words, it blocks nothing, and it makes both options cheaper.
2. **Do B, not A, as the product.** Its cost is mostly TypeScript the project wants anyway (the store refactor fixes three reproduced data-loss and undo bugs, per ADR-0037), and it needs no contract change, no Rust, no macOS-specific verification. The fleet's harness is single-window (`paint-deadline` counters, `take_pending_opens`); multi-window verification is expensive to build and would be built for a stopgap.
3. **If the author wants to cross-reference this week, allow a second window as a stopgap only**, behind the same ADR-0013 amendment that says "single-instance" means "single process", and accept that it is a tool for trying the idea, not the feature. Its cost is real (rows 11 to 14 above) and most of it is thrown away if B lands. I would not do A if B is within a few weeks.

The honest tension: A is cheaper per capability but is the dead end, because the capabilities that make the feature Marxy's own (links into the neighbour, same-file-twice, persistence, `Mod+E` per pane) are exactly what A cannot do. The author's phrase, "tiling window manager style", is about those, not about frame geometry the OS already provides.

## 5. Typography constraints

The default measure is 66 average characters at 20 px (`packages/theme/src/tokens.css:8-11`, ADR-0033, `docs/research/reader-typography/10-spec.md:18`). The column is `clamp(45 chars, measure, 80 chars)` as an absolute length (`packages/theme/src/base.css:94`), set as `max-width` on the article with 24 px of padding on each side added outside it (`base.css:102`, `:125-127`).

| Characters per line | Column | Column plus gutters | Two panes |
| --- | --- | --- | --- |
| 45 (floor) | 416.7 px | 464.7 px | 929.4 px |
| 66 (default) | 611.2 px | 659.2 px | **1,318.3 px** |
| 80 (ceiling) | 740.8 px | 788.8 px | 1,577.6 px |

Command: see Appendix A.

What that means in practice (vendor default scaled resolutions, not measured here; pane width is half the window):

| Window | Pane | Characters per line |
| --- | --- | --- |
| 1,512 px (14-inch MacBook Pro default) | 756 px | 66 (full measure, 97 px spare per side) |
| 1,470 px (13-inch MacBook Air default) | 735 px | 66 |
| 1,440 px | 720 px | 66 |
| 1,280 px | 640 px | 63.9 |
| 960 px (`apps/desktop/src-tauri/tauri.conf.json` default window) | 480 px | 46.7 |

So on any 13-inch or 14-inch Mac at its default scaling, **two panes at the full 66-character measure fit**, because the column's `max-width` simply stops growing and the pane holds it with 38 px or more of margin. Below about 1,318 px the measure shrinks with the pane, and at 929 px each pane reaches the 45-character floor. Below that, the second pane should refuse to open and say why (a notice in the existing region), not run at 30 characters.

**The type does not scale fluidly.** There is one media query on the article, a gutter step at 30 em (`base.css:125`), and body size is a fixed 20 px token clamped to 13 to 28 px by the theme loader (`packages/theme/src/loader.ts:139`). The handbook's 18/19/20 px phone, tablet, desktop ramp (`10-spec.md:128-129`) is not implemented in the base stylesheet. That is the right behaviour for a split: panes should change measure, not text size. `Mod+=` and `Mod+-` change body size for the whole window.

**What the handbook says.** It gives a floor of about 13 characters per line below which speed collapses, weak support for a comprehension advantage at moderate lengths (55 over 100 in one study), a consistent preference for 55 to 70, and a stated range of 45 to 80 (`docs/research/reader-typography/02-evidence.md:63-75`, `04-spacing-layout.md:30-34`). It says nothing about two columns of different documents side by side; the only multi-column guidance is Bringhurst's 40 to 50 characters for multi-column print work. Narrower panes are inside the evidence. Justification is already off by default and the handbook says to fall back to ragged below 45 (`10-spec.md:24`, `:38`), so panes at the floor need no new rule.

**Two real problems the arithmetic does not show.**

1. **`--marxy-room` is computed from `100vw`.** `base.css:100` sets how far code and tables may run into the margin as `(100vw - column) / 2 - gutter`. In a 735 px pane at a 1,470 px window that resolves to 405 px, but the pane has 38 px of margin. Measured with a 140-character code line in two half-window panes:

   | Window | Pane | Code block width | Spills past its pane |
   | --- | --- | --- | --- |
   | 1,470 px | 735 px | 1,017 px | yes (right edge 1,078 px vs 735 px) |
   | 1,280 px | 640 px | 902 px | yes (926 px vs 640 px) |

   Wide tables use the same variable (`base.css:347`). The fix is container-relative: put `container-type: inline-size` on the pane and use `cqw` instead of `vw` in `--marxy-room`. Container query units are in current WebKit; the WebKitGTK floor needs a check (ADR-0010 cites WebKitGTK 2.52 for performance, not for this feature). The media query at `base.css:125` should become a container query for the same reason.
2. **The typesetter measures per paragraph from the live box** (`contentBox(p)`), so it is already correct at any pane width, and a divider drag fires the existing per-article `ResizeObserver` (`apps/desktop/src/app.ts:741-760`) with a 100 ms debounce. Nothing to change there beyond making the observer per view.

Aesthetics gate impact: the corpus gate renders at 720, 960 and 1,280 px (`scripts/gate-aesthetics.mjs:57`) with a screenshot baseline only at 960 px dark and light (`:574-577`). A pane renders at the same widths the gate already judges, so no baseline changes are needed for single-document pages. A split page needs its own screenshot case and a taste-queue row (voluntary, per the project's stated position).

## 6. Implementation sketch

### 6.1 The unit: a document view

A **document** (store, per canonical path) and a **view** (per pane). In terms of today's variables:

| Belongs to the document store | Belongs to the view |
| --- | --- |
| `path`, `bytesOnDisk` (`disk`), `documentBuffer` (`buffer`), `ast`, `nodeMap`, undo `history`, `version`, dirty state | `viewMode`, `anchor`, the scroller element, `blocks`, the `TypesetController`, the `ResizeObserver`, snap timers, the Source editor, the selection, the link history `navHistory`, the pane's notices |
| The watcher subscription (one per directory per store) | `lastReadingByteOffset` and `lastReadingFraction` |

The store's `subscribe()` (ADR-0037) lets every view re-render on a transition and map its own anchor. A view is created with `createView(host: HTMLElement, store)` and owns its teardown; today's `teardownDocument()` (`apps/desktop/src/app.ts:769-780`) is the model for `view.destroy()`.

### 6.2 DOM skeleton

Adds one element, only when two documents are open:

```html
<main id="marxy-main">
  <section class="marxy-pane" data-marxy-pane="0" data-marxy-mode="rendered" data-marxy-focus>
    <div id="marxy-notices" role="status"></div>
    <article id="doc" class="marxy-article"></article>
    <div class="marxy-source-mount" hidden></div>
  </section>
  <!-- only when split -->
  <div class="marxy-divider" role="separator" aria-orientation="vertical"></div>
  <section class="marxy-pane" data-marxy-pane="1" data-marxy-mode="rendered">...</section>
</main>
```

With one document it is `main > section > #doc`: still no visible element outside `#marxy-main`, so `checkChrome` passes. The first pane keeps `id="doc"`, so the 54 files that name it keep passing; the second pane's article is found by `data-marxy-pane`. New names go into `scripts/registry.json` first (`dataAttributes`, `classPrefix`): `data-marxy-pane`, `data-marxy-focus`, `marxy-pane`, `marxy-divider`, and a mark per pane for the perf record. The state table in `docs/design/09-app-shell.md:25-41` gains `layout` and `focusedPane`; `mode` moves to the view.

### 6.3 Keyboard commands

Each is a `Command` in the registry (`apps/desktop/src/commands/registry.ts:16-23`) so the palette lists it with its key: `view.open-beside` (`Mod+\`), `view.close-pane` (`Mod+Shift+\`), `view.focus-left` (`Mod+1`), `view.focus-right` (`Mod+2`), `view.split-same`, `view.link-scroll`, `view.reset-split`. `Mod+Enter` in the palette and `Mod+click` on a link are handled in `palette/view.ts` and `selection/view.ts`. The `Mod+W` row of the keyboard table stays as it is. `docs/design/09-app-shell.md` and the native menu table must be updated together, and the keyboard-completeness audit specified in `docs/design/09-app-shell.md:187-196` (the test file it names, `apps/desktop/test/keyboard.test.mjs`, does not exist in the tree today) should cover the new commands.

### 6.4 `shell-api`

**None for the in-window split.** It uses `readFile`, `watch`, `writeFileAtomic`, `configPaths` as today. Layout persistence uses `configPaths().data`. Only options A and C need a new member and an ADR (ADR-0026).

### 6.5 Persistence of layout

`layout.json` in the data directory, written debounced like `positions.json` (500 ms), atomically through the shell, restored at launch without a file argument. It is a new file under the same version-and-quarantine rules as `positions.json` (`packages/core/src/position/storage.ts`).

### 6.6 Stories

The order matters; 1 and 2 are prerequisites that pay off without the split.

| # | Story | Acceptance (one line) |
| --- | --- | --- |
| 1 | **Amend ADR-0037**: store holds bytes and history, view holds `mode` and `anchor`; many views per store | The ADR says so, names the view fields, and `docs/design/09-app-shell.md` state table matches. Docs only. |
| 2 | **Implement the document store** (ADR-0037 as amended) | The three reproduced failures from ADR-0037 are tests that pass; a gate rejects module-level document state outside `document/store.ts`; `app.ts` loses its 33 document `let`s. |
| 3 | **A view per pane, one pane**: `createView`, per-view scroller, typesetter, observer, anchor, mode, Source mount | With one document the app behaves byte-for-byte as today: the 54 `#doc` files and the existing Playwright suite pass unchanged, and `checkChrome` is green. |
| 4 | **Theme: container-relative room**: `container-type: inline-size` on the pane, `cqw` in `--marxy-room`, container query for the gutter step | A code block with a 140-character line in a half-width pane does not exceed the pane; the corpus gate output at 720, 960 and 1,280 px is unchanged. |
| 5 | **Two columns**: layout, divider (drag, double-click reset), `Mod+\` open beside, `Mod+Shift+\` close, focus via `Mod+1/2`, window-level overlays bound to the focused pane | With two documents open, each pane scrolls independently, a click focuses a pane, Esc returns focus to the pane that opened the overlay, and `Mod+E`, undo and save act on the focused pane only. |
| 6 | **Links and same-document**: `Mod+click` opens a link in the other pane; "Split this document" | Opening one file in both panes, an edit in one pane reaches the other through the store within one frame, and the other pane's reading anchor moves by the edit's delta (ADR-0037 clause 6). |
| 7 | **Per-pane live reload and notices** | An external write to a file shown in either pane triggers one watcher callback per store and reloads each view at its own position; a deleted file shows its notice in its own pane only. |
| 8 | **Layout persistence and the narrow-window rule**: `layout.json`, restore on launch without a file, refuse the second pane under 929 px | Relaunch restores both documents, modes and ratio; at a 900 px window `Mod+\` shows a notice instead of opening. |
| 9 | **Find and outline built on views** (re-scope MARXY-48) | `Mod+F` searches only the focused pane, the current match lands at 40% of that pane's height, and the outline's current heading follows that pane's scroll. |
| 10 | **Link scrolling (optional)** | With the command on, scrolling one pane moves the other to the same byte coordinate for a same-file pair; off by default, never persisted. |

Stories 1 to 3 are independent of whether the split ships. Story 9 is a re-scope of work the fleet already blocked (`node orchestration/fleet.mjs why MARXY-48`: "Needs follow-up ... app.ts/palette wiring for production mount").

### 6.7 Risks

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| **ADR-0037 is unimplemented, and the split depends on it.** Building the split on 55 module-level variables means the split's own state would be the 56th to 90th | ADR-0037 status "proposed"; `grep -c "^let "` over the nine files | Stories 1 to 3 first. Do not start story 5 until the store lands. |
| **Hidden coupling in the 54 `#doc` references** | `grep -rlE "#doc\|'doc'"` over `apps/desktop/test`, `scripts`, `packages` | Keep `#doc` on the first pane. Move tests to `data-marxy-pane` over time, not in this change. |
| **Single watcher in Rust** | Checked: it is not single | `main.rs:249-330` is a ref-counted table. One residual: `watch_root` canonicalises, and two views of one file share a store, so a store holds one subscription (not one per view). |
| **Perf of typesetting two documents** | Measured, below | Per-pane debounce stays; the idle background pass runs per article, and the 250 ms snap coalescing (`app.ts:699-721`) must become per view or two views share one timer and starve each other. |
| **Aesthetics gate and screenshots** | `scripts/gate-aesthetics.mjs:57,574` | New split case and baseline; keep the single-document baselines untouched. |
| **Selection and operations are singletons** | `apps/desktop/src/selection/view.ts:75-85` | One selection per window, bound to the focused pane; focusing the other pane clears it. |
| **Close and quit with two dirty documents** | `apps/desktop/src/close.ts:21-24` (one notice, one document) | The guard asks about each dirty store in turn, naming the file. |
| **Source mode in a pane has a fixed overlay today** | `apps/desktop/index.html:16` | Story 3 moves it in-pane before the second pane exists. |
| **ADR-0005 wording** ("One key toggles") | `docs/adr/0005-two-modes.md` | Add "the focused pane" to the sentence; no decision changes. |

**Typesetting cost, measured.** In Playwright WebKit (headless, this Mac, not the packaged WKWebView), the typesetter's synchronous viewport pass over `01-long-technical.md`, seven runs each:

| Case | Median |
| --- | --- |
| One article at the full 1,470 px window (cold first `attach` in the page) | 20 ms |
| Two articles in two 735 px panes, wall time for both `ready` promises | 26 ms |
| Per pane, within that pair | 13 ms and 12 ms |
| `16-api-reference.md`, single, then two panes | 13 ms, then 11 ms |

The first number includes cold start costs the second does not, so the comparison is noisy, but the headline holds: two panes do not double the cost of the first pass, and both are far under the 100 ms viewport budget in `AGENTS.md`. Background (idle) passes do double in total work and are scheduled in idle chunks. The measurement says nothing about the packaged app's `WKWebView`, the Linux WebKitGTK, or long scrolls with both panes' background passes running; the harness story should measure those before story 5 merges.

## 7. Recommendation

Build the in-window two-column split, with the document/view separation first (stories 1 to 3). Amend ADR-0037 now, re-scope MARXY-48 to take a view, make `--marxy-room` container-relative, cap version one at two columns (refusing below 929 px), keep scroll independent, and do not turn the split into a diff. Use a second OS window only as a stopgap if cross-reference is wanted before the store lands.

## Appendix A. Commands behind the numbers

Measure arithmetic (column, gutters, two panes, characters at each width):

```bash
cd /Users/ian/Dev/marxy-wt/MARXY-346 && node -e '
const avg=0.463, body=20, g=24;   // tokens.css: --marxy-avg-char, --marxy-size-body; base.css: 24px gutter
for (const ch of [45,55,66,80]) { const c=ch*avg*body; console.log(ch, c.toFixed(1), (c+2*g).toFixed(1), (2*(c+2*g)).toFixed(1)); }
for (const w of [1512,1470,1440,1280,960]) { const pane=w/2; const content=Math.min(66*avg*body, pane-2*g); console.log(w, pane, (content/(avg*body)).toFixed(1)); }'
```

Typesetter cost and the `100vw` spill (scratch scripts; both use `packages/typeset/test/harness.mjs`):

```bash
cd /Users/ian/Dev/marxy-wt/MARXY-346
node /private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/feature-split/two-pane.mjs        # W=1470, FILE=01-long-technical.md
FILE=16-api-reference.md node /private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/feature-split/two-pane.mjs
node /private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/feature-split/wide-code.mjs     # 1470 and 1280
```

Inventory counts:

```bash
cd /Users/ian/Dev/marxy-wt/MARXY-346/apps/desktop/src
grep -c "^let " app.ts selection/view.ts commands/edits.ts save.ts close.ts notices/index.ts source/editor.ts source/tab-width.ts palette/session.ts   # total 55
grep -c '"main"' ../src-tauri/src/main.rs                                                                                                             # 5
grep -rlE "#doc|'doc'|\"doc\"" ../test ../../../scripts ../../../packages --include='*.mjs' --include='*.ts' --include='*.html' | grep -v node_modules | wc -l   # 54
node ../../../orchestration/fleet.mjs why MARXY-48                                                                                                    # blocked, find/outline unbuilt
```

## Sources (web, read 2026-10-01)

- [Apple Support: window tiling settings](https://support.apple.com/guide/mac-help/change-window-tiling-settings-on-mac-mchl118087b0/mac) and tiling shortcut summaries ([SlashGear](https://www.slashgear.com/1673225/macos-sequoia-window-tiling-shortcuts/), [iBoysoft](https://iboysoft.com/wiki/macos-sequoia-window-tiling-keyboard-shortcuts.html))
- [VS Code locked scrolling](https://www.lexo.ch/blog/2025/04/toggle-lock-scrolling-across-editors-in-vs-code/); [VS Code tips](https://code.visualstudio.com/docs/getstarted/tips-and-tricks)
- [Obsidian "Link with tab"](https://medium.com/obsidian-observer/obsidian-quick-tip-enhance-markdown-editing-with-link-with-tab-55a8b5c99177); [Obsidian tabs](https://obsidian.md/help/tabs)
- [Arc split view](https://allthings.how/how-to-open-tabs-in-split-view-in-arc-browser-on-windows/)
- [Zed pane keybindings](https://github.com/zed-industries/zed/discussions/13121) and [Zed features](https://zed.dev/features)
- [Logseq sidebar](https://discuss.logseq.com/t/how-to-work-with-logseqs-right-hand-sidebar/8461)
- [Notion side peek](https://x.com/NotionHQ/status/1551616572518567936); [Craft multiwindow](https://www.macstories.net/reviews/craft-review-a-powerful-native-notes-and-collaboration-app/)
- [Kaleidoscope](https://www.git-tower.com/blog/kaleidoscope)

## For the synthesis

- Build the split as a two-column, in-window feature on an amended ADR-0037 (document store separate from per-pane view); it needs no `shell-api` or Rust change, and it delivers what OS tiling cannot (follow a link into the neighbour pane, same file twice, layout restore, per-pane Source/Rendered).
- ADR-0037 as written puts `mode` and `anchor` in the single store, which bakes in one view; amend it now (docs only), because after implementation it becomes a refactor.
- The real cost is the app shell, not the engine: `apps/desktop` holds "the open document" as 55 module-level `let`s across nine files, scrolls the window rather than a pane, and 54 test and script files name `#doc`; keep `#doc` on the first pane so none of them break.
- The Rust watcher is already a ref-counted multi-root design and the typesetter is per article, so the two worries in the brief are not blockers; measured typeset viewport pass was 20 ms for one article and 26 ms for two panes (WebKit headless, 1,470 px), far under the 100 ms budget.
- The default theme breaks in a pane: `--marxy-room` is computed from `100vw`, so a wide code block was measured spilling 343 px out of a 735 px pane; making it container-relative is a small, testable theme story and a prerequisite.
- Two 66-character columns need 1,318 px; any 13- or 14-inch Mac at default scaling (1,440 to 1,512 px) holds both at full measure, 960 px gives 46.7 characters per pane, and below 929 px the second pane should refuse; the type size does not scale fluidly, only the measure shrinks.
- Find and outline are unbuilt (MARXY-48 is blocked), so re-scope them to take a view handle now; retrofitting later costs more.
- Multiple OS windows with macOS tiling are cheaper per capability but a dead end (five hard-coded `"main"` sites in Rust, a capability glob, close-quits-the-process, a `shell-api` ADR, two-buffers-per-file and positions.json clobber); use only as a stopgap.
- Keep scroll independent by default and do not turn the split into a diff: the reader-artifacts handbook calls reading two full texts side by side the failure mode of the compare task, so "two versions of a regenerated file" deserves its own diff story.
