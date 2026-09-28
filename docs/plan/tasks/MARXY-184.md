---
key: MARXY-184
design: [06-shell, 09-app-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-184]
---
# MARXY-184 — Native File and Edit menu: Open File, Close, Quit, and standard editing commands

**Design:** [06-shell](../../design/06-shell.md) §Capabilities ·
[09-app-shell](../../design/09-app-shell.md) §Keyboard map ·
**Depends on:** nothing. The task card originally named MARXY-49 (`openDialog` / `open_dialog`)
as a dependency, but MARXY-49 is the webview-facing save dialog and explicit save, a different
surface; the open picker this story's "Open File…" menu item needs comes straight from
`tauri-plugin-dialog`, added by this story, called only from the menu's own Rust event handler
(never through IPC, so it needs no `shell-api` member and no capability). ·
**Delta:** [2026-09-21-mac-shell-gaps](../deltas/2026-09-21-mac-shell-gaps.md) ·
**ADRs:** ADR-0011 (palette is the tab manager, no tab bar) — this story does not reopen it; see
"Do not" below.

**Outcome.** `marxy` gets the smallest native menu a Mac (and, if `tauri::menu` allows it
cleanly, Linux) reader already expects: `Cmd+Q` reliably quits, `Cmd+C/V/A` reliably reach the
palette's search input and CodeMirror, and "Open File…" is reachable from the menu bar as well as
the palette. No document-specific command lives here — those stay in the palette, unchanged.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs` — build a `tauri::menu::Menu` (macOS only,
  `#[cfg(target_os = "macos")]`) and set it in `.setup(...)`: an app-level submenu ("Marxy":
  About, Services, Hide/Hide Others/Show All, a custom Quit item bound to Cmd+Q that calls the
  same code path the existing `quit` command uses — do not create a second exit path), a File
  submenu with a custom "Open File…" item (Cmd+O) that opens `tauri-plugin-dialog`'s native
  picker directly from the menu's event handler and a custom "Close Window" item (Cmd+W) that
  also calls the shared quit path (marxy is single-window, so closing it is quitting), and an Edit
  submenu built entirely from `tauri::menu`'s predefined items (`undo`, `redo`, `cut`, `copy`,
  `paste`, `select_all`) — `Menu::default(app)`'s own Edit submenu already has exactly this shape,
  confirmed by reading `tauri`'s source rather than by adding items by hand.
- `apps/desktop/src-tauri/Cargo.toml` / `Cargo.lock` — add `tauri-plugin-dialog = "2"` (already on
  `scripts/allowlists/dependencies.json`'s cargo allow-list; MIT/Apache-2.0, confirmed by
  `pnpm gate:licences` alongside its own transitive dependencies).
- `scripts/allowlists/crate-licences.json` — record the licence of `tauri-plugin-dialog` and the
  new transitive crates it pulls in (`tauri-plugin-fs`, `rfd`), read from each crate's own
  `Cargo.toml` in the local registry cache, the same way every other entry here was recorded.
- `apps/desktop/src-tauri/capabilities/default.json` — unchanged. The menu is built and its
  events handled entirely in Rust (`.setup(...)`, `.on_menu_event(...)`); nothing here crosses
  IPC, so no capability gates it, and the dialog plugin is called the same way — no webview
  command calls it, so no `dialog:*` capability is added either.
- `apps/desktop/src/shell/tauri.ts` — unchanged. "Open File…" needs no TS-side hook: the menu's
  Rust handler calls `emit_open_files` directly, the same function a second launch or a Finder
  "Open With" already uses, which reaches `replaceOpenDocument` in `apps/desktop/src/app.ts`
  through the existing `onOpenFiles` listener.
- `docs/design/06-shell.md` — add the menu's (lack of a) capability line to §Capabilities.
- `docs/design/09-app-shell.md` — a short note in §Keyboard map (or a new one-paragraph
  subsection) that `Cmd+Q`/`Cmd+C/V/A`/`Cmd+Z` are now guaranteed by the native menu's item
  validation, not only by the `keys.ts` table, so a future reader of that section is not misled
  into thinking the keyboard map alone covers them.

## Do this, in order
1. **First**, with no `.menu()` call added at all, check what `tauri::menu::Menu::default(app)`
   already gives a Tauri 2 app on macOS — the delta names this as the likely first-attempt
   failure mode (adding items Tauri already supplies). Its Edit submenu already matches what this
   story needs; its App and File submenus do not (no Show All, no custom Quit/Close-Window path,
   no Open File…), so those three are built by hand while Edit is reused verbatim.
2. Build the app-level Quit item and the File submenu's "Close Window" item, both routed to one
   shared helper that does what the existing `quit` command's body does (`main.rs`; there is no
   separate `commands/app.rs` — `quit` lives in `main.rs` itself). Do not add a second exit path.
3. Build the File submenu's "Open File…" item, wired to `tauri-plugin-dialog`'s `pick_file` from
   the menu's own event handler.
4. Build the Edit submenu from predefined items only.
5. `Menu::set_as_app_menu` (or the Tauri 2 equivalent, `AppHandle::set_menu`) at `.setup(...)`
   time.
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
