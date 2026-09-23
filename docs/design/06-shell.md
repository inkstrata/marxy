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
commands/net.rs  fetch_remote_image and the marxy-remote: URI scheme handler (ADR-0027); the only socket in the app
error.rs         ShellError { code, message, path } ← std::io::ErrorKind mapping
```

## Commands

Document bytes cross IPC as raw bodies in both directions, never as `Vec<u8>` / `number[]`: those
serialise as a JSON array of numbers, about 3.7 bytes of JSON per byte of document, encoded on
one side and parsed on the other (MARXY-198).

| Command (TS name → Rust) | Args | Returns | Errors | Module | Story |
| --- | --- | --- | --- | --- | --- |
| `readFile` → `read_file` | `path` | raw body (`ipc::Response`), an `ArrayBuffer` in the webview | not-found, permission, io | fs | done |
| `writeFileAtomic` → `write_file_atomic` | raw body = bytes; header `x-marxy-path` = `encodeURIComponent(path)` | `()` | permission, io | fs | MARXY-14 |
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
| `readDir` → `read_dir` | `dir` | `FileStat[]` (one level; deny list applied) | not-found, permission | fs (std, like `index/mod.rs`) | MARXY-87 |
| `setTitle` → `set_title` | `title` | `()` | — | app (`WebviewWindow::set_title`) | MARXY-49 |
| `allowAssetScope` → `allow_asset_scope` | `dir` | `()` | invalid (not a directory) | fs | MARXY-26, MARXY-47 |
| `saveDialog` → `save_dialog` | `{ defaultPath? }` | `string \| null` | — | os (`tauri-plugin-dialog`) | MARXY-49 |
| `fetchRemoteImage` → `fetch_remote_image` | `url` | `string` (a `marxy-remote:` URL) | unsupported (not https, or no network in the sandbox), invalid (not an image, too large), io | net (`ureq`, ADR-0027) | MARXY-97 |
| `args`, `mark_from_webview`, `startup_marks`, `quit` | | | | app | done |
| `onOpenFiles` | callback | — | — | `listen('marxy:open-files')` from the single-instance plugin | MARXY-183 |
| `onWatch` | callback | — | — | `listen('marxy:watch')` | MARXY-34 |

**Contract status (ADR-0026).** Most of this table is not in the frozen `Shell` interface on
`main`. ADR-0026 adds it in one contract PR; until then a story adds its member to the object in
`src/shell/tauri.ts` under exactly the name and signature above. The `listRoot`, `indexBuild`,
`indexQuery`, `indexLoad`/`indexSave` and `fuzzy` rows describe a Rust index that was not built:
MARXY-35 put the walker, ceiling and persistence in `packages/core/src/index-model` behind a
`DirectoryReader`, which `readDir` implements. Treat those rows as history.

`assetUrl(path)` is not a command: it is `convertFileSrc(path)` after the shell has allowed the
directory (below). Shipping `imageSize` reads headers through the Rust `imagesize` crate; core's
`imageSizeFromBytes` is the pure fallback for the memory shell and unit tests only.

## Asset protocol and image scoping (D-A10, ADR-0027 §5)

`tauri.conf.json`: `app.security.assetProtocol.enable = true`, `scope = []`. When a document
opens, the app calls `shell.allowAssetScope(imageRoot)` — the repository root the document is
indexed under, else its directory (§02 post-pass 3) — and Rust calls
`app.asset_protocol_scope().allow_directory(dir, /*recursive*/ true)`. The earlier
`fs::allow_document_dir` via a `read_file` argument is superseded: one explicit command is
easier to audit than a side effect of reading. Nothing outside it is ever allowed; a `../` that escapes is refused by the scope
and, before that, by the app's path check (§02). A theme's directory is allowed the same way
for its fonts. Scopes are not persisted (a fresh launch re-allows when it re-opens).

## CSP (final, MARXY-45; the Phase 0 string is looser)

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: http://asset.localhost marxy-remote: http://marxy-remote.localhost data:;
font-src 'self' asset: http://asset.localhost data:;
connect-src ipc: http://ipc.localhost;
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

No `http:`/`https:` source appears, ever (ADR-0027); remote images arrive through the
`marxy-remote:` scheme the shell serves from memory after consent. MARXY-45's gate asserts the
string: parse the policy, fail on `*`, on any `http(s):` source other than the two
`*.localhost` forms, and on any directive not in this list.

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
