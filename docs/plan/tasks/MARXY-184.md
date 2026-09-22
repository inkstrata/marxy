---
key: MARXY-184
design: [06-shell, 09-app-shell]
depends: [MARXY-49]
verify: [pnpm precheck, pnpm done MARXY-184]
---
# MARXY-184 — Native File and Edit menu: Open File, Close, Quit, and standard editing commands

**Design:** [06-shell](../../design/06-shell.md) §Capabilities ·
[09-app-shell](../../design/09-app-shell.md) §Keyboard map ·
**Depends on:** MARXY-49 (`openDialog` / `open_dialog`, currently `todo` — this story is not
dispatchable until MARXY-49 lands) · **Delta:** [2026-09-21-mac-shell-gaps](../deltas/2026-09-21-mac-shell-gaps.md) ·
**ADRs:** ADR-0011 (palette is the tab manager, no tab bar) — this story does not reopen it; see
"Do not" below.

**Outcome.** `marxy` gets the smallest native menu a Mac (and, if `tauri::menu` allows it
cleanly, Linux) reader already expects: `Cmd+Q` reliably quits, `Cmd+C/V/A` reliably reach the
palette's search input and CodeMirror, and "Open File…" is reachable from the menu bar as well as
the palette. No document-specific command lives here — those stay in the palette, unchanged.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs` — build a `tauri::menu::Menu` before `.run(...)`:
  an app-level submenu with `PredefinedMenuItem::quit` (bound to Cmd+Q, calling the existing
  `quit` command's code path — do not create a second exit path), a File submenu with an "Open
  File…" item wired to the same `open_dialog` command MARXY-49 adds, "Close Window" via
  `PredefinedMenuItem`, and an Edit submenu built entirely from `tauri::menu`'s predefined items
  (`undo`, `redo`, `cut`, `copy`, `paste`, `select_all`) — check what `tauri::menu`'s
  `Menu::default(app)` already supplies (design doc's own caveat, and the delta's "how this would
  be wrong" #3) before writing any item by hand; use the predefined default and only add what it
  is missing.
- `apps/desktop/src-tauri/capabilities/default.json` — whatever the menu APIs need
  (`core:menu:default` or equivalent; check against the Tauri 2 permission autogen the way
  `docs/design/06-shell.md` §Capabilities describes for commands).
- `apps/desktop/src/shell/tauri.ts` — only if "Open File…" needs a TS-side hook beyond what the
  existing `open_dialog` → `openDialog` command already provides; if the menu item calls the Rust
  command directly with no TS involvement, this file does not change and the PR says so.
- `docs/design/06-shell.md` — add the menu's capability line to §Capabilities.
- `docs/design/09-app-shell.md` — a short note in §Keyboard map (or a new one-paragraph
  subsection) that `Cmd+Q`/`Cmd+C/V/A`/`Cmd+Z` are now guaranteed by the native menu's item
  validation, not only by the `keys.ts` table, so a future reader of that section is not misled
  into thinking the keyboard map alone covers them.

## Do this, in order
1. **First**, with no `.menu()` call added at all, check what `tauri::menu::Menu::default(app)`
   already gives a Tauri 2 app on macOS — the delta names this as the likely first-attempt
   failure mode (adding items Tauri already supplies). Narrow the acceptance criteria in the PR
   body if some are already met by the default menu.
2. Build the app-level Quit item, routed to the same command the existing `quit` shell-api member
   calls (`apps/desktop/src-tauri/src/commands/app.rs`; do not add a second quit path).
3. Build the File submenu's "Open File…" and "Close Window" items.
4. Build the Edit submenu from predefined items only.
5. `Menu::set_as_app_menu` (or the Tauri 2 equivalent) at builder time.
6. Manual check: Cmd+C/Cmd+V/Cmd+A inside the palette's search `<input>` and inside CodeMirror
   (Source mode) both work — paste the exact steps into the PR per criterion 3; this is a manual
   check like MARXY-16's release-artifact confirmation, not a Playwright case, because AppKit's
   menu-validation wiring is not observable through webview automation alone.
7. If step 1's audit, or `tauri::menu`'s actual Linux behaviour, shows the cross-platform story
   does not extend cleanly: scope this story to macOS explicitly in the PR body and open a new
   out-of-plan Task (`jira.mjs task`) for the Linux/Windows menu rather than silently skipping it
   (criterion 5).

## Tests → expected
| Check | Expect |
| --- | --- |
| `cargo test` (or a new Rust unit test) over the menu-building function | the expected item ids/labels are present, and no document-specific command id appears |
| manual: Cmd+Q from the menu and from the keyboard | both exit through the same `quit` code path |
| manual: Cmd+C/V/A in palette search input and CodeMirror | works; steps + result pasted into the PR |
| `apps/desktop/src/shell/tauri.ts` diff | empty, unless "Open File…" needed a hook (say so either way) |
| `docs/design/06-shell.md` / `09-app-shell.md` | updated as above |

## Acceptance → check
The five criteria on the CSV row: (1) File menu Open File/Close Window; (2) Quit bound to Cmd+Q
through the existing command; (3) Edit menu's predefined items reach the palette input and
CodeMirror; (4) no operations-catalogue or document-specific item in the native menu; (5) explicit
macOS-only scoping (with a follow-up Task) if Linux/Windows coverage is not clean.

## Do not
Add any item from the operations catalogue (MARXY-42/43) or anything document-specific — this
menu is OS-expected chrome, not a second command surface; ADR-0011 stands. Add a tab bar or window
list. Build Edit-menu items by hand when `tauri::menu`'s predefined ones already do the job. Touch
`packages/shell-api` — nothing here needs a new frozen member; "Open File…" and "Close Window"
call existing or MARXY-49-added commands. Start this story before MARXY-49 is Done.
