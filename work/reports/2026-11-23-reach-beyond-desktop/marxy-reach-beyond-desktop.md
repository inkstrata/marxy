# Marxy beyond the desktop: browser, extension, other platforms

Investigation, 2026-11-23, against master `690d455f`. Question: can the browser-facing part of Marxy run
on its own, in a web page or a Chrome extension, reading real files, and what stands between today's
Windows app and true multi-platform reach?

## The short answer

The split already exists. Everything the page needs from the machine goes through one interface
(`Shell` in `packages/shell-api`, plus `AppShell` in `apps/desktop/src/app-types.ts`, about 70 methods),
`check-boundaries` keeps Tauri out of every other folder, and a second implementation of that interface,
the in-memory shell (`shell/memory.ts`), already runs the whole app in a plain browser (`pnpm build:demo`).
So the front end is portable today. Two things are missing:

1. **A shell that reaches real files from a browser.** In Chromium that is the File System Access API;
   elsewhere it is read-only (picker and drop) unless a native helper is installed.
2. **The native readers outside Tauri.** About half of the Rust side is pure computation on bytes
   (archives, spreadsheets, SQLite, encodings, Outlook, Word 97-2003, image and font facts, decoders).
   In the browser build these are stand-ins that answer only for the demo's own files. Moved into one
   Rust crate with no Tauri and no paths, they compile to WebAssembly and run in a worker.

Recommended order: a Chromium web page over File System Access first, the readers crate second, the
extension as a wrapper of that same bundle third, macOS and Linux desktop builds alongside, native
messaging and phones last.

## What the Rust side does today

Three kinds of work sit behind the shell, and they port very differently.

| Kind | Where | In a browser |
| --- | --- | --- |
| Readers: bytes in, facts or pages out | `archive/` (zip, tar, 7z, rar, cab, iso, ar; deflate64, bzip2, xz, zstd), `tables/` (calamine sheets, rusqlite), `encoding/` (encoding_rs, chardetng), `outlook/`, `legacy_office/`, `facts/`, `decode/` (image, jxl-oxide, psd, raw, tiff, svgz), `font/` (skrifa, wuff), `detect.rs` (infer), char names | portable: every crate is pure Rust (the licence gate already forced that). Compile to wasm32 and run in a worker |
| Files and the OS | read, range read, stat, readDir, realPath, scope, atomic write with compare, watch (notify), dialogs, recent, open in system, external editor, `run_command`, single instance, window and title | re-implemented per host; some have no browser equivalent |
| Windows only | WIC (HEIC), WebView2 file drop, CF_HTML and RTF clipboard, jump list | none; each needs a fallback or goes |

The readers are not yet shaped for this. Some take bytes (`encoding`, `outlook::read`, `legacy_office::read`,
`sqlite::open_bytes`, `sheets::open_from`), but archives take `&File`, SQLite and sheets open by `&Path`,
and the time budgets measure thread CPU time, which WebAssembly does not have.

## Host by host

### A web page in Chrome or Edge (the strongest case)

The File System Access API gives the page handles to files and folders the reader picks or drops:

- `readFile`, `readHead`, `readRange`: `handle.getFile()` gives a Blob; `Blob.slice` gives ranges without
  reading the whole file, so big logs, Lines and the tables index keep working.
- `readDir`, `listRoot`, `fuzzy`, `searchContent`: walk a directory handle.
- `writeFileAtomic`: `createWritable()` writes a swap file and commits on close, so a save is all or
  nothing. What is lost is the compare inside the same open: the "refused if the file changed" check
  becomes read, compare, then write, with a window between. The save docs would have to say so.
- `watch`: `FileSystemObserver` (Chrome desktop, shipped around 133 after an origin trial); polling
  `lastModified` where it is absent. Live reload and log following survive.
- Paths: virtual, `/<root>/<relative path>`, mapped to handles. The memory shell already uses virtual
  POSIX paths, and the scope model maps straight on: the page can reach only what the reader granted,
  which the browser itself enforces.
- Recent and restored layouts: handles persist in IndexedDB, but each session asks again
  (`requestPermission` on a click). Restore becomes "click to reopen", not silent.
- Marxy's own data (`config.toml`, state, `versions/`): the Origin Private File System, which also gives
  synchronous access handles in a worker.
- `assetUrl`, `fileUrl` (images, PDF, media): `blob:` URLs, revoked when the view closes.
- "Open with" from the OS: an installed PWA declares `file_handlers` and receives files through
  `launchQueue`.

The cost that will be felt most: a single file opened alone cannot see its siblings, so a Markdown
page's relative images do not load until the reader grants the folder. That needs a clear notice and a
one-click "grant the folder".

Gone in a browser: `run_command`, the external editor, reveal in Explorer, rich clipboard formats beyond
`text/html` and `text/plain`, jump lists, the window frame controls.

### Firefox, Safari, phones

No writable handles. Reading still works through the file picker (`webkitdirectory` for folders) and
drop, with `File` objects that slice like Blobs; saving becomes a download, or a copy kept in OPFS.
No watch. A read-only Marxy is still useful here, but nothing past Chromium has been looked at: the
scrollbar rules are Chromium only, and typesetting measures the DOM, so expect visual work. Phone
browsers get the same file story plus a layout built for a keyboard and a wide window.

### A Chrome extension: three different things

1. **The same bundle, packaged.** An extension page (`chrome-extension://...`) gets the File System
   Access API exactly as a web page does, works offline by construction, and its CSP enforces the
   no-network rule better than a hosted page can. MV3 needs `'wasm-unsafe-eval'` for the readers.
2. **Marxy as the viewer for `file://` and text URLs.** Redirect `file:///.../notes.md` (and
   `text/plain`, JSON, logs served raw) into the extension's viewer. Reading a `file://` URL from the
   extension needs a `file:///*` host permission and the reader switching on "Allow access to file URLs";
   reports from Web Store installs say the toggle may only appear with an optional host permission, so
   this needs a spike. Read-only, single file; a folder listing over `file://` is Chrome's own HTML page,
   which would have to be parsed. Pages fetched from the web need no new network code: the content script
   reads what the tab already loaded.
3. **Extension plus a native messaging host.** The extension talks over stdio to a headless build of
   the Rust shell: every capability, any path, in Chrome, Edge and Firefox. But the reader installs a
   native program anyway, so it pays only for people who want Marxy inside a browser tab. Last.

### Other desktops and phones through Tauri

The Rust shell already has `cfg(unix)` and `cfg(target_os = "macos")` code and a macOS menu, so macOS and
Linux builds are closer than any browser host: the work is building, verifying (every check today runs on
Windows) and signing there, plus fallbacks for the Windows-only pieces. Tauri 2's iOS and Android targets
exist, but their files are content URIs and bookmarks, not paths, so phones share the browser's path
problem and the browser's layout problem.

## What bridging needs

1. **A shell contract suite.** One set of tests run against every `Shell` (memory, Tauri, the new
   browser shell): reads, ranges, writes and refusals, scope, watch events, error codes. Today the shell's
   behaviour is pinned by tests of each implementation separately.
2. **Host capabilities in the open.** The page must know what this host can do (write in place, watch,
   folders, run commands, open in system) and hide or reword what it cannot. `AppShell`'s optional methods
   are a start; the notices already say "the desktop app reads any" in the demo build.
3. **`fileKey` per host.** It folds case and `.`/`..` for Windows; handle paths are exact names.
4. **A readers crate.** Move `archive/`, `tables/`, `encoding/`, `outlook/`, `legacy_office/`, `facts/`,
   `decode/` (less WIC), `font/` and `detect.rs` into `crates/marxy-readers`: no Tauri, no paths;
   generic `Read + Seek` or `&[u8]` in, serde structs out. `src-tauri` calls it with a `File`; a
   wasm-bindgen build calls it in a worker with a `Read + Seek` over a Blob, read synchronously through
   `FileReaderSync`, so range reads stay range reads. Budgets move from thread CPU time to a wall clock in
   the worker. The desktop gains too: the readers become testable without Tauri.
5. **SQLite in the browser.** Either rusqlite built for wasm, or the official `sqlite3.wasm` behind the
   same `tables` answers; `open_bytes` already exists for a whole-file copy. A spike decides.
6. **The browser shell.** `shell/fs-access.ts`: virtual paths over handles, OPFS for Marxy's data,
   IndexedDB for remembered handles, `FileSystemObserver` or polling for watch, the readers worker for the
   rest. It must sit under `apps/desktop/src/shell/` to pass `check-boundaries`.
7. **Packaging.** A `build:web` mode that boots the new shell (today the plain-browser path is the
   demo), a service worker and manifest with `file_handlers`, CSP `connect-src 'none'` after load; the
   extension is that output plus a manifest.
8. **Weight.** The web build is 30 MB, mostly Shiki grammars loaded on demand; several grammar chunks are
   built twice (`cpp`, `emacs-lisp` appear in two copies, likely the page and the highlight worker).
   Harmless on a desktop, worth halving for a page.

## Rules that change meaning

- **No network.** A hosted page is fetched from a server once. The promise becomes "nothing after load",
  enforced by CSP and a service worker; the extension keeps the stronger form. The remote-image fetch has
  no browser equivalent that respects the rule and should stay desktop-only.
- **Bytes are the document** holds unchanged: Blob and handle reads give the bytes as they are.
- **Saves cannot overwrite a changed file** weakens to a check-then-write in the browser (above).

## Suggested first step

A spike, about two days, on a branch: `shell/fs-access.ts` implementing reads, ranges, readDir, atomic
write and polling watch over a picked folder, using the memory shell's stand-ins for the native readers;
`build:web` booting it; open the demo folder from disk in Chrome, edit, save, reload from an outside
edit. It proves or disproves the path model, the permission flow and the save story before anything in
Rust moves. In parallel, a half-day spike compiling `encoding` and `archive::zip` to wasm32 tells how
large the readers worker will be.

## Open questions for the spikes

- Does `FileSystemObserver` report changes made by other programs reliably on Windows, and with what delay?
- Can a Web Store extension get `file://` read access today, and does fetch from the extension page
  succeed with the toggle on?
- rusqlite for wasm or `sqlite3.wasm`: size, and whether `tables` answers stay identical.
- How large is the readers worker with `image`, `jxl-oxide`, `calamine` and SQLite in it?

## Sources

- [The File System Observer API origin trial](https://developer.chrome.com/blog/file-system-observer)
- [Intent to Ship: FileSystemObserver](https://groups.google.com/a/chromium.org/g/blink-dev/c/6oOaFmia2dc)
- [Chrome extensions: declare permissions](https://developer.chrome.com/docs/extensions/mv3/declare_permissions)
- [How to fetch local files in manifest v3](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zy9qIkCCwqg)
