# 06 — The shell (Tauri)

Everything privileged, as named commands behind `packages/shell-api` (frozen). This document
lists every command the app will ever call in v1, the Rust module that implements it, its
error mapping, the capability it needs, and the final CSP. `apps/desktop/src/shell/tauri.ts`
is the only TypeScript that imports `@tauri-apps/*`.

## Rust layout (`apps/desktop/src-tauri/src/`)

```
main.rs          builder, plugins, single-instance, startup marks (exists)
commands/mod.rs  re-exports; every #[tauri::command] lives under commands/
commands/fs.rs   read_file, write_file_atomic, stat, image_size, repository_root
commands/watch.rs   watch_start, watch_stop; emits "marxy:watch" events
commands/index.rs   index_build, index_query, index_load, index_save; headings scanner
commands/os.rs   open_external, reveal_in_editor, clipboard_write, open_dialog, webkit_version
commands/app.rs  args, mark_from_webview, startup_marks, quit, config_paths, on second-instance forwarding
error.rs         ShellError { code, message, path } ← std::io::ErrorKind mapping
```

## Commands

| Command (TS name → Rust) | Args | Returns | Errors | Module | Story |
| --- | --- | --- | --- | --- | --- |
| `readFile` → `read_file` | `path` | `Vec<u8>` | not-found, permission, io | fs | done |
| `writeFileAtomic` → `write_file_atomic` | `path, bytes` | `()` | permission, io | fs | MARXY-14 |
| `stat` | `path` | `FileStat \| null` | permission | fs | MARXY-14 |
| `imageSize` → `image_size` | `path` | `{ width, height } \| null` | not-found | fs (`imagesize` crate, MIT) | MARXY-26 |
| `repositoryRoot` → `repository_root` | `path` | `string \| null` | — | fs | MARXY-35 |
| `listRoot` → `list_root` | `root, extensions[], limit` | `FileStat[]` | permission | index (`ignore` walker) | MARXY-35 |
| `indexBuild` → `index_build` | `root` | `{ count, ms, truncated }` | permission | index | MARXY-35 |
| `indexQuery` → `index_query` | `root, query, limit` | `IndexHit[]` | invalid | index (`nucleo-matcher`) | MARXY-35 |
| `indexLoad` / `indexSave` | `root` | `IndexEntry[]` / `()` | io | index | MARXY-35 |
| `watch` → `watch_start` / `watch_stop` | `root` → `watchId` | `number` | permission | watch (`notify` + `notify-debouncer-full`) | MARXY-34 |
| `openExternal` → `open_external` | `url` | `()` | unsupported (scheme not http/https/mailto) | os (`open` crate) | MARXY-61 |
| `revealInExternalEditor` → `reveal_in_editor` | `path, line?` | `()` | unsupported (no editor configured) | os | MARXY-48 |
| `clipboardWrite` → `clipboard_write` | `{ text, html? }` | `()` | io | os (`tauri-plugin-clipboard-manager`) | MARXY-42 |
| `openDialog` → `open_dialog` | `{ directory?, multiple? }` | `string[]` | — | os (`tauri-plugin-dialog`) | MARXY-49 |
| `webkitVersion` → `webkit_version` | — | `{ major, minor, micro } \| null` (Linux only) | — | os (`webkit2gtk::{major,minor,micro}_version`) | MARXY-21 |
| `configPaths` → `config_paths` | — | `{ config, data }` | — | app (`tauri::path` resolver) | MARXY-38 |
| `args`, `mark_from_webview`, `startup_marks`, `quit` | | | | app | done |
| `onOpenFiles` | callback | — | — | `listen('marxy:open-files')` from the single-instance plugin | MARXY-33 |
| `onWatch` | callback | — | — | `listen('marxy:watch')` | MARXY-34 |

`assetUrl(path)` is not a command: it is `convertFileSrc(path)` after the shell has allowed the
directory (below).

## Asset protocol and image scoping (D-A10)

`tauri.conf.json`: `app.security.assetProtocol.enable = true`, `scope = []`. When a document
opens, the Rust side (`fs::allow_document_dir`, called from `read_file` when the path is a
document the app is opening, via a `scope` argument) calls
`app.asset_protocol_scope().allow_directory(dir, /*recursive*/ true)` for the document's
directory. Nothing outside it is ever allowed; a `../` that escapes is refused by the scope
and, before that, by the app's path check (§02). A theme's directory is allowed the same way
for its fonts. Scopes are not persisted (a fresh launch re-allows when it re-opens).

## CSP (final, MARXY-45; the Phase 0 string is looser)

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: http://asset.localhost data:;
font-src 'self' asset: http://asset.localhost data:;
connect-src ipc: http://ipc.localhost;
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

`'unsafe-inline'` for styles is required by the theme injection and by the typesetter's inline
margins; scripts are never inline. `data:` for images covers a markdown `![](data:…)` that the
sanitiser's subresource rule admits only when the allow-list is widened (MARXY-44); by default
`img-src` is moot because the sanitiser removed the element.

## Capabilities (`capabilities/default.json`)

`core:default`, `core:event:allow-listen`, `core:window:allow-set-title`,
`clipboard-manager:allow-write-text`, `clipboard-manager:allow-write-html`,
`dialog:allow-open`, `opener:allow-open-url` (scheme-limited in the command anyway),
plus each custom command (Tauri 2 requires `allow-<command>` entries for commands defined in
the app when using the permission system; generate them with the `tauri` CLI's permission
autogen). Nothing else. `fs` plugin is **not** used; file access goes only through our commands
so the audit surface is the table above.

## Single instance and second launches

`tauri-plugin-single-instance`: a second `marxy file.md` forwards `argv` and `cwd` to the
running process, which emits `marxy:open-files` with absolute paths and focuses the window.
The app opens the first path (v1 has one window). macOS "Open With" arrives through the
`RunEvent::Opened` handler and takes the same path.

## Watching (`commands/watch.rs`)

`notify` with `notify-debouncer-full` (100 ms), recursive on `root`, events mapped:

| notify | `WatchEvent.kind` |
| --- | --- |
| `Modify(Data)` on P | `modified` |
| `Create` of P | `created` (an atomic write that created a new inode arrives as `created` on the watched path; the app treats `created` on the open path as `modified`) |
| `Modify(Name(To))` → P / `Rename(From, To)` with `To = P` | `renamed` with `to = P`, treated as `modified` for the open path |
| `Remove` of P | `removed` |

Events are batched per debounce window and emitted as one `marxy:watch` payload
`{ watchId, events: WatchEvent[] }`. Paths under the deny list (§07) are dropped in Rust so the
webview never hears about `node_modules`.

## Errors

`error.rs`: `NotFound → 'not-found'`, `PermissionDenied → 'permission'`, `InvalidInput → 'invalid'`,
everything else `'io'`; commands that refuse by policy return `'unsupported'` with a message
saying what would be needed. Every command's `Result<T, ShellError>` serialises as
`{ code, message, path }`.

## Tests

- Rust unit tests per module (`cargo test`): atomic write leaves the original on a simulated
  failure (write to a read-only temp dir); `repository_root` finds `.git` two levels up and
  returns `None` outside; `image_size` on the corpus PNGs; the headings scanner (§07) on the
  corpus; the watch mapping table via `notify`'s mock events.
- `apps/desktop/test/shell-boundary.test.mjs` (exists): extended so every command in this table
  is referenced from `src/shell/tauri.ts` and nowhere else.
