# 06 — The shell (Tauri)

Everything privileged, as named commands behind `packages/shell-api` (frozen). This document
lists every command the app will ever call in v1, the Rust module that implements it, its
error mapping, the capability it needs, and the final CSP. `apps/desktop/src/shell/tauri.ts`
is the only TypeScript that imports `@tauri-apps/*`.

## Rust layout (`apps/desktop/src-tauri/src/`)

```
main.rs          builder, plugins, single-instance, startup marks (exists)
commands/mod.rs  re-exports; most #[tauri::command]s live under commands/ (main.rs and pasteboard/ hold the rest)
commands/fs.rs   read_file, write_file_atomic, stat, image_size, repository_root
commands/watch.rs   watch_start, watch_stop; emits "marxy:watch" events
commands/index.rs   index_build, index_query, index_load, index_save; headings scanner
commands/search.rs  search_content, cancel_content_search: on-demand content scan (C-16)
commands/os.rs   open_external, reveal_in_editor, clipboard_write, open_dialog, webkit_version
commands/app.rs  args, mark_from_webview, startup_marks, quit, config_paths, on second-instance forwarding
commands/net.rs  fetch_remote_image and the marxy-remote: URI scheme handler (ADR-0027); the only socket in the app
pasteboard/mod.rs  pasteboard_types, pasteboard_read, pasteboard_write: the Pasteboard trait and its logic (J-01)
pasteboard/macos.rs  NSPasteboard through objc2-app-kit; the only cfg(target_os = "macos") file of the three
pasteboard/fake.rs   an in-memory pasteboard that counts snapshots and data reads (#[cfg(test)])
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
| `stat` → `stat_file` | `path` | `FileStat \| null`: one entry's size and mtime without listing its folder; `null` for a missing path, one that is itself a symlink or a deny-listed name (the last component only, as `read_dir` checks) | permission, io | fs | MARXY-14, C-11.2 |
| `readHead` → `read_head` | `path, maxBytes` | raw body (`ipc::Response`): at most the first `maxBytes`, capped at 256 KB in Rust | not-found, invalid (a symlink at the path, a folder, a FIFO or device), io | fs; opens with `O_NOFOLLOW \| O_NONBLOCK` on unix and checks the type again after opening; does not arm the stale-write guard | C-11.2 |
| `imageSize` → `image_size` | `path` | `{ width, height } \| null` | not-found | fs (`imagesize` crate, MIT) | MARXY-26 |
| `repositoryRoot` → `repository_root` | `path` | `string \| null` | — | fs | MARXY-35 |
| `listRoot` → `list_root` | `root, extensions[], limit` | `FileStat[]` | permission | index (`ignore` walker) | MARXY-35 |
| `indexBuild` → `index_build` | `root` | `{ count, ms, truncated }` | permission | index | MARXY-35 |
| `indexQuery` → `index_query` | `root, query, limit` | `IndexHit[]` | invalid | index (`nucleo-matcher`) | MARXY-35 |
| `indexLoad` / `indexSave` | `root` | `IndexEntry[]` / `()` | io | index | MARXY-35 |
| `watch` → `watch_start` / `watch_stop` | `root` → `watchId` | `number` | permission | watch (`notify` + `notify-debouncer-full`); history, see the next row | MARXY-34 |
| `watch_root` / `unwatch_root` | `root, recursive?` / `root, recursive?, id?` | `{ key, id }` / `()`; `id` names the watch the handle holds, so a late close of an ended watch finds "not watching" and leaves a newer watch of the same tree alone | permission, io | watch (`notify`) | C-05, C-11.1 |
| `openExternal` → `open_external` | `url` | `()` | unsupported (scheme not http/https/mailto) | os (`open` crate) | MARXY-61 |
| `revealInExternalEditor` → `reveal_in_editor` | `path, line?` | `()` | unsupported (no editor configured) | os | MARXY-48 |
| `clipboardWrite` → `clipboard_write` | `{ text, html? }` | `()` | io | os (`tauri-plugin-clipboard-manager`) | MARXY-42 |
| `pasteboard_types` | — | `string[]`: the first item's types (plus `org.nspasteboard.ConcealedType` if any item carries it), from one snapshot of the item array; reads no data | unsupported (not macOS) | pasteboard (`objc2-app-kit` NSPasteboard; a synchronous command, so on the main thread). Called only on a reader action; nothing polls or reads `changeCount` (ADR-0065 §3) | J-01 |
| `pasteboard_read` | `types[]` | `{ reps: { type, encoding: 'utf8' \| 'base64', data }[], skipped: { type, len }[] }`: from one snapshot of the item array, of the requested types, those of text (`public.utf8-plain-text`), HTML (`public.html`), RTF (`public.rtf`), URL (`public.url`) and PNG (`public.png`) the first item holds, in that order; PNG and non-UTF-8 bytes as base64. Any other type is never read. A representation over 16 MB is skipped and listed in `skipped`, the rest returned (the cap limits the response, not memory) | permission (a concealed marker on any item, refused before any data read), unsupported (not macOS) | pasteboard. The only path that reads clipboard data | J-01 |
| `pasteboard_write` | `reps: { type, data }[], transient` | `()`: only text, HTML, RTF and URL types; clears once and writes one item holding every representation plus `org.nspasteboard.source` = `dev.marxy.app`, and `org.nspasteboard.TransientType` when `transient` (ADR-0065 §2). If AppKit refuses `writeObjects` after the clear, the clipboard is left empty | invalid (no representations, or a type outside the allowlist, markers included), io, unsupported (not macOS) | pasteboard | J-01 |
| `openDialog` → `open_dialog` | `{ directory?, multiple? }` | `string[]` | — | os (`tauri-plugin-dialog`) | MARXY-49 |
| `webkitVersion` → `webkit_version` | — | `{ major, minor, micro } \| null` (Linux only) | — | os (`webkit2gtk::{major,minor,micro}_version`) | MARXY-21 |
| `configPaths` → `config_paths` | — | `{ config, data }` | — | app (`tauri::path` resolver) | MARXY-38 |
| `readDir` → `read_dir` | `dir` | `FileStat[]` (one level; deny list applied) | not-found, permission | fs (std) | MARXY-87 |
| `setTitle` → `set_title` | `title` | `()` | — | app (`WebviewWindow::set_title`) | MARXY-49 |
| `allowAssetScope` → `allow_asset_scope` | `dir` | `()` | invalid (not a directory) | fs | MARXY-26, MARXY-47 |
| `saveDialog` → `save_dialog` | `{ defaultPath? }` | `string \| null` | — | os (`tauri-plugin-dialog`) | MARXY-49 |
| `fetchRemoteImage` → `fetch_remote_image` | `url` | `string` (a `marxy-remote:` URL) | unsupported (not https, or no network in the sandbox), invalid (not an image, too large), io | net (`ureq`, ADR-0027) | MARXY-97 |
| `searchContent` → `search_content`, `cancel_content_search` | `paths[], query, roots[], limit?, perFile?, token`; `token` | `{ hits: ContentHit[], scannedFiles, truncated }`; `()` | — (an unreadable, missing, binary, oversized or out-of-root file is skipped) | search (std only; `spawn_blocking`). Reads only the passed paths, each under a root, below no deny-listed directory and reached through no symlink; nothing is indexed or written (ADR-0053 §4) | C-16 |
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
style-src 'self';
style-src-attr 'unsafe-inline';
img-src 'self' asset: http://asset.localhost marxy-remote: http://marxy-remote.localhost data:;
font-src 'self' asset: http://asset.localhost data:;
connect-src ipc: http://ipc.localhost;
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

No `http:`/`https:` source appears, ever (ADR-0027); remote images arrive through the
`marxy-remote:` scheme the shell serves from memory after consent. MARXY-45's gate asserts the
string: parse the policy, fail on `*`, on any `http(s):` source other than the two
`*.localhost` forms, and on any directive not in this list.

A release build injects a per-load style nonce, and a nonce makes WebKit ignore
`'unsafe-inline'` on `style-src`. Runtime `<style>` elements (theme, palette, hyphenation,
KaTeX's sheet) move to `adoptedStyleSheets`, which apply under `style-src 'self'`. Markup
`style` attributes, which KaTeX uses for layout, need `style-src-attr 'unsafe-inline'`.
`style-src` itself does not carry `'unsafe-inline'` once the nonce is present (MARXY-250).
`scripts/check-csp.mjs` fails a planted `document.createElement('style')`. Scripts are never
inline. `data:` for images covers a markdown `![](data:…)` that the
sanitiser's subresource rule admits only when the allow-list is widened (MARXY-44); by default
`img-src` is moot because the sanitiser removed the element.

## Capabilities (`capabilities/default.json`)

`core:default`, `core:event:allow-listen`, `core:window:allow-set-title`,
`clipboard-manager:allow-write-text`, `clipboard-manager:allow-write-html`,
`dialog:allow-open`, `opener:allow-open-url` (scheme-limited in the command anyway),
plus each custom command (Tauri 2 requires `allow-<command>` entries for commands defined in
the app when using the permission system; generate them with the `tauri` CLI's permission
autogen). Nothing else. `fs` plugin is **not** used; file access goes only through our commands
so the audit surface is the table above. The commands defined in the app itself (as opposed to a plugin's) need no entry while
`build.rs` declares no `AppManifest`: Tauri's permission system then gates only plugin commands,
which is why `pasteboard_*` (J-01) added none.

**Native menu (macOS, MARXY-184).** `main.rs` builds and sets a `tauri::menu::Menu` from
`.setup(...)`, entirely in Rust: no capability entry is added for it because a capability gates
the webview's IPC calls into Rust, and the webview never calls into the menu. "Open File…" opens
`tauri-plugin-dialog`'s native picker the same way, from the menu's own event handler
(`app.dialog().file().pick_file(...)`) — again no webview call, so no `dialog:*` capability is
needed either; the `dialog:allow-open` line above stays reserved for MARXY-49's webview-facing
`openDialog` command, a separate thing. Its View and Go items (MARXY-342) reach the webview by the `marxy:menu` event, which
the existing `core:event:allow-listen` already covers, so they add no capability either. The menu is macOS-only (`#[cfg(target_os = "macos")]`): a
visible menu bar on Linux/Windows is in-window chrome, which "chrome at rest is zero" forbids: see
the follow-up task drafted for Linux/Windows `openDialog` menu coverage.

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
