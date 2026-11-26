# What Marxy keeps on disk

Every file Marxy writes outside the documents a reader saves, where it lives, what it holds and
which module writes it. Browser storage holds one switch (below), and nothing is sent anywhere (see
[desktop-shell.md](desktop-shell.md#network) for the one network path, remote images a reader allows).

## Folders

| Folder | Default | Holds |
| --- | --- | --- |
| Config folder | Tauri's `app_config_dir` for `dev.marxy.app`: `%APPDATA%\dev.marxy.app` on Windows, `~/Library/Application Support/dev.marxy.app` on macOS, `~/.config/dev.marxy.app` on Linux | `config.toml`, `collection.toml`, `look.toml`, `looks/` |
| Data folder | Tauri's `app_data_dir` for the same identifier | everything in the data table below |
| Webview profile | Tauri's `app_local_data_dir` (`%LOCALAPPDATA%\dev.marxy.app` on Windows) | the engine's own data, and its local storage, where Marxy keeps one key: `marxy.account.open`, whether How this is shown is open (`frame/account.ts`) |

On Windows and macOS the config folder and the data folder are the same folder; on Linux they are
`~/.config/dev.marxy.app` and `~/.local/share/dev.marxy.app`.

`MARXY_DATA_DIR=<folder>` puts the config folder, the data folder and (on Windows and Linux) the
webview profile in that one folder, and gives the run its own single-instance identifier
(`apps/desktop/src-tauri/src/data_dir.rs`). The real-window check and the smoke check use it so they
never touch a reader's own Marxy.

## Config folder

| File | Contents | Written by |
| --- | --- | --- |
| `config.toml` | settings (see [using-marxy.md](using-marxy.md#settings)): theme, variant, sizes, typesetting, Source options, contrast, versions, proposals, `[syntax]` colours, `[[kind]]` rules, `[strip]` tools, `[[command]]` entries, `external_editor`. Applied before first paint. | `settings/settings.ts` and the commands that change one key (`commands/appearance.ts`, `commands/kind.ts`, `commands/source-view.ts`, `look/commands.ts`, `left/panels/versions.ts`, `frame/branches/look-by-language.ts`). A write changes one line over the bytes last read, and is refused if the file changed on disk or is not valid TOML. |
| `collection.toml` | places (`[[root]]`) and saved searches | `collection/load.ts`, `commands/collection.ts`, the Places and Search panels |
| `look.toml` | whether looks are on, the look in use, scheme mode, lean-back, rule switches, per-look tweaks, the reader's own rules | `look/store.ts` |
| `looks/<id>.look.toml` | one look of the reader's own | `look/store.ts` |
| `<theme folder>/` | a theme of the reader's own, if `config.toml` names one | the reader |

## Data folder

Paths are relative to the data folder; modules are under `apps/desktop/src/` unless marked Rust.

| File | Contents | Written by | Read at |
| --- | --- | --- | --- |
| `positions.json` | reading place per path (up to 5,000) | `position/reading-persistence.ts` | each open |
| `history.json` | opened files (up to 500), pins, recent roots | `palette/history.ts` | the Line's Recent and Pinned, Places' Pinned |
| `layout.json` | panes, their files and modes, split ratio, focus, the tab row | `layout/restore.ts` | launch, to restore the window |
| `frame.json` | fold state, the panel shown, rail mode, saved tab sets, place order | `frame/state.ts` | launch |
| `readings.json` | how each file or part is read: chosen readings, colour tier overrides, encodings, bytes views, code files put in Source (a `pages` list an earlier Marxy wrote is kept and no longer read) (up to 5,000 files) | `render/readings-file.ts` | each open |
| `kinds.json` | "show as" choices by path | `commands/kind.ts` | each open |
| `trust.json` | per-file grants for raw HTML and remote image hosts (up to 2,000) | `trust/trust.ts` | after first text |
| `notes.json` | margin notes by path | `notes/store.ts` | first use |
| `index-<sha1 of root>.json` | titles, headings and paths of a folder, for the Line | `index/service.ts` | when a folder is indexed; removed by the shell when its folder is gone |
| `versions-<key>.json`, `versions-<key>-NN` | a file's earlier copies and their manifest (20 per file by default, 30 days, 200 MB in all) | `versions/store.ts`, `versions/recorder.ts` | the Versions panel |
| `<file>.bad-<ms>` | a state file that did not parse, set aside | the modules above | never |
| `window.json` | window position, size and maximised state | Rust `window_state.rs` | before the window shows |
| `decoded/<hash>.png` | decoded images (RAW previews, TIFF, EXR, HDR, QOI, JPEG XL, TGA), trimmed to 512 MB | Rust `file_scheme.rs` | when such an image is shown |

## Timing

`frame.json`, `notes.json`, `readings.json` and the looks are written 400 ms after a change;
`positions.json` and `layout.json` after 500 ms; `history.json` after 1 s. Everything is flushed when
the window closes or the app quits (the close waits at most 1.5 s). Writes go through the shell's
atomic write.

## Not kept

The tray, panel filters, folds and ticks, the Studio's view, glance and pair marks on tabs, each pane's
back and forward history, and closed tabs live only as long as the window.

## Clearing it

Settings › Privacy shows stored files with their sizes, clears all versions (asked first; it cannot
be undone) and forgets how parts are read (`settings/privacy.ts`).
