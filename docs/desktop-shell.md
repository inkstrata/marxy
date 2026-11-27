# The desktop shell (Rust)

The Tauri 2 side of Marxy, in `apps/desktop/src-tauri/`: startup, the commands the page can call,
file access, watching, archives and decoders, operating-system integration, and what it writes to
disk. The page reaches all of it through one TypeScript module, `apps/desktop/src/shell/tauri.ts`,
which implements the `Shell` interface of `packages/shell-api`.

## Crate and configuration

- One binary, `src/main.rs`, package `marxy`. Release builds use `windows_subsystem = "windows"`
  (no console). Profiles: `release` (LTO, one codegen unit, stripped) and `ci` (thin LTO).
- `build.rs` lists the commands (`COMMANDS`); tauri-build generates an `allow-<command>` permission
  for each. `capabilities/main.json`, the only capability, grants those and event listen/unlisten,
  nothing else: no plugin permission reaches the page. `apps/desktop/test/shell-boundary.test.mjs`
  holds the three lists (`build.rs`, `generate_handler!` in `main.rs`, the capability) equal.
- `tauri.conf.json`: identifier `dev.marxy.app`; one window `main`, 960×760, minimum 564×480,
  created hidden and shown once placed; `withGlobalTauri: false`; Tauri's asset protocol off.
- `tauri.windows.conf.json` (replaces the base arrays on Windows): file drops handled by the app
  (`dragDropEnabled: false`), the signing command, and a file association for Markdown only (the rest are offered by the installer
  hooks, below).
- Content-Security-Policy: `default-src 'none'; script-src 'self'; style-src 'self';
  style-src-attr 'unsafe-inline'`, images, fonts and media from `marxy-file:` (and images from
  `marxy-remote:`), `connect-src` limited to IPC and `marxy-file:`. No `http(s)` source.

### File associations on macOS

`bundle.fileAssociations` in `tauri.conf.json` becomes `CFBundleDocumentTypes` in `Info.plist`, in three tiers.

- **Default** (a double-click opens Marxy): Markdown, which declares `net.daringfireball.markdown` (conforming to
  `public.plain-text`) because macOS has no type for it; and "Logs, data and mail" (`log`, `jsonl`, `ndjson`, `diff`,
  `patch`, `ipynb`, `eml`, `yaml`, `yml`, `toml`), which macOS opens in a plain editor or a mail client at best and Marxy
  reads better.
- **Alternate** (offered in Open With, never the default): "Source and text" (code, scripts, `json`, `html`, `xml`, `css`,
  `csv`, `tsv` and the rest), because editors, browsers and spreadsheets own those; PDF and images, because Preview owns
  them; and archives, Word, Excel, PowerPoint and OpenDocument files, audio and video, fonts and EPUB, so Marxy is
  listed for everything it reads without claiming any of it.
- **Not declared**: programs, installers and packages (`app`, `pkg`, `dmg`, `exe`, `apk`, `deb`, `rpm`, `iso`, `jar`),
  which Marxy only describes, never opens as a document.

Windows is separate and unchanged (below).

### File associations on Windows

The installer is per-user (NSIS, `HKCU`). Tauri's own association writes the extension's default
value (`HKCU\Software\Classes\.md` = `Markdown`, with `Markdown_backup` holding the previous
value), which makes Marxy the handler of that type unless the user has chosen another app. That is
kept for Markdown only. Every other type Marxy has a page for (text and every source language, data,
logs, notebooks, mail, images, audio and video, PDF, Office files, spreadsheets, SQLite, archives,
EPUB and fonts; `openWithExtensions()` in the file-type registry) is offered in "Open with" and
"Choose another app" by `src-tauri/installer-hooks.nsh`, which never writes an extension's default
value and so takes over no existing handler. Types that get only the file card (programs, shortcuts,
certificates, bytes no viewer reads) are not offered.

| Key under `HKCU\Software\Classes` | Written |
| --- | --- |
| `.<ext>\OpenWithProgids`, value `Marxy.File` (empty) | per extension |
| `Marxy.File\shell\open\command` | the executable and `"%1"` |
| `Applications\marxy.exe\SupportedTypes`, value `.<ext>` | per extension |
| `Applications\marxy.exe` `FriendlyAppName`, `shell\open\command` | the name and the command |

Uninstall deletes those values and keys, and an `OpenWithProgids` or extension key left with nothing
in it; both ends call `SHChangeNotify(SHCNE_ASSOCCHANGED)`. The list of extensions in the hooks is
held equal to the registry by `packages/core/src/kind/registry.test.ts`.

### Dependencies by purpose (`Cargo.toml`)

| Purpose | Crates |
| --- | --- |
| Shell and plugins | `tauri`, `tauri-plugin-single-instance`, `tauri-plugin-clipboard-manager`, `tauri-plugin-dialog` |
| Config and data | `serde`, `serde_json`, `toml` |
| Paths and watching | `dunce`, `notify`; `libc` on Unix |
| Detection and text | `infer`, `chardetng`, `encoding_rs`, `unicode_names2` |
| Images | `imagesize`, `image` (png, jpeg, tiff, tga, exr, hdr, qoi), `jxl-oxide`, `png` |
| Archives | `flate2`, `crc32fast`, `tar`, `bzip2-rs`, `lzma-rust2`, `sevenz-rust2`, `deflate64`, `ruzstd` |
| Tables and Outlook messages | `rusqlite` (bundled SQLite), `calamine`, `zip`, `quick-xml`, `cfb` |
| Fonts | `skrifa`, `wuff` |
| Network (remote images only) | `ureq` |
| Windows | `webview2-com`, `windows-core` (file drops), `windows` (clipboard) |
| macOS | `objc2`, `objc2-app-kit`, `objc2-foundation` (pasteboard, menu) |

A new crate needs an entry in `scripts/allowlists/dependencies.json` (`pnpm check`) and a licence
record (`node scripts/gate-licences.mjs`).

## Startup (`src/main.rs`)

1. Prints `MARK main_start`. With `MARXY_DATA_DIR` set, the app identifier becomes
   `dev.marxy.app.data-<hash of the folder>` (`data_dir.rs`), so the run has its own
   single-instance lock and its own folders.
2. Registers the navigation guard, the clipboard, dialog and single-instance plugins, and two URI
   schemes: `marxy-file` (`file_scheme.rs`) and `marxy-remote` (`remote.rs`).
3. `setup`: schedules the sweep of stale index files 20 s after launch, restores the window's
   bounds from `window.json` and shows it (`window_state.rs`), installs the Windows drop listener
   (`drop_windows.rs`), and on macOS builds the menu.
4. The run loop turns every window close into a request to the page (`marxy:close-requested`); the
   page answers with `close_confirmed` once unsaved work is settled. A second close request within
   1.5 s quits without asking. On macOS a quit from outside the app (Dock Quit, Log Out, an Apple-event
   quit) arrives as `ExitRequested` with no code; the run loop prevents it and sends the same request. The
   exit that follows an answered prompt, and any exit with a code, is let through.

### Opening files

- First launch: the page calls `args`; non-flag arguments come back absolute and canonical.
- Second launch: the single-instance plugin passes the new arguments to the running window; a
  launch with no file only focuses it.
- Drops: macOS and Linux through Tauri's drop event; Windows through a WebView2 message the page
  posts (`listenForFileDrops` in `shell/tauri.ts`), read by `drop_windows.rs`. Only regular files
  are kept.
- Files are delivered as `marxy:open-files`; those that arrive before the page is listening are
  queued and drained by `take_pending_opens`.
- Every one of these routes (and `args`, `open_dialog`, `save_dialog`) records its paths as opened in the scope
  (below) before the page sees them.

### Harness mode

`MARXY_QUIT_AFTER_PAINT=1` (or `--quit-after-paint`) makes the app print `MARK <name> <epoch ms>`
lines for the page's startup marks and exit after the first paint; a render with no paint within
2.5 s exits 1 with `MARK no_paint`. The smoke check and the start-up measurement use it.

## Commands

All commands are registered in `generate_handler!` in `src/main.rs` and called only from
`apps/desktop/src/shell/tauri.ts` (the pasteboard ones from `shell/clipboard.ts`). Byte payloads
travel as raw IPC bodies, never JSON arrays; write paths ride percent-encoded in an `x-marxy-path`
header. Errors serialise as `{code, message, path?}` with codes `not-found`, `invalid`, `io`,
`exists`, `changed`, `permission`, `refused`, `unsupported`, `outside` (a path not in scope, below) (`src/error.rs`).

| Command | What it does | Module |
| --- | --- | --- |
| `args` | launch arguments, documents made absolute | `main.rs` |
| `set_title`, `set_menu_enabled` | window title; enable or disable macOS menu items by command id | `main.rs` |
| `set_fullscreen`, `is_fullscreen` | put the window in or out of full screen; whether it is | `main.rs` |
| `close_confirmed`, `quit` | the page's answer to a close request; quit with a code | `main.rs` |
| `mark_from_webview`, `startup_marks` | print a startup mark; whether this is a harness launch | `main.rs` |
| `take_pending_opens` | files queued before the page listened | `main.rs` |
| `config_paths` | the config file and data folder (created if missing) | `commands/app.rs` |
| `save_dialog`, `open_dialog` | native pickers | `main.rs` |
| `clipboard_write` | plain text, or HTML with a text alternative | `main.rs` |
| `pasteboard_types`, `pasteboard_read`, `pasteboard_write` | typed pasteboard items (macOS and Windows) | `pasteboard/` |
| `read_file` | a whole regular file, up to 256 MB, bytes as on disk | `commands/fs.rs` |
| `read_head` | the first bytes of a regular file, up to 256 KB | `commands/fs.rs` |
| `write_file_atomic`, `write_file_new` | replace a file atomically; create a file only if the name is free | `atomic_write.rs` |
| `read_dir`, `stat_file`, `real_path` | one folder level; one entry; the canonical path | `commands/fs.rs` |
| `image_size`, `image_facts` | image dimensions from the header; size, orientation, colour, EXIF, GPS | `commands/fs.rs`, `facts/` |
| `allow_asset_scope` | adds a folder to the opened set (below) | `commands/fs.rs` |
| `mark_opened` | records a file the reader opened, or a folder chosen for the index (`root`) | `scope.rs` |
| `forget_root` | the index let go of a folder it held as a root: the path commands stop answering for it | `scope.rs` |
| `detect_files` | classify up to 5,000 files from an 8 KB head each | `detect.rs` |
| `search_content`, `cancel_content_search` | literal search over the files passed, read in chunks | `commands/search.rs` |
| `watch_root`, `watch_ignore`, `unwatch_root` | watch a folder or a tree; change the folders a tree leaves out; release it | `main.rs`, `watch/` |
| `list_archive`, `read_archive_entry`, `read_archive_heads` | list an archive; read one entry (up to 16 MB); read the heads of many | `commands/archive.rs`, `archive/` |
| `tables_open`, `tables_rows`, `tables_blob` | open a SQLite database or a workbook; page through rows; read a BLOB | `commands/tables.rs`, `tables/` |
| `font_facts`, `font_glyph` | a font's faces, tables, axes and coverage; one glyph's outline | `commands/font.rs`, `font/` |
| `media_facts`, `media_envelope` | container facts of audio and video; a PCM WAV's waveform | `commands/media.rs`, `facts/` |
| `char_name` | a character's Unicode name | `commands/chars.rs` |
| `decode_text`, `encode_text`, `encoding_readings` | bytes to UTF-8 with a byte map; UTF-8 to an encoding; each candidate encoding's reading of a sample | `encoding/` |
| `mail_from_msg` | an Outlook message's bytes (a raw body the page already read) as the message it would be as it travels, framed after its facts; nothing read from disk | `outlook/` |
| `office_from_ole` | a Word 97-2003 document's or deck's bytes (a raw body the page already read) as the office page's blocks, through the compound-file reader `.msg` uses; nothing read from disk | `legacy_office/` |
| `open_external` | hand an http, https or mailto URL to the OS | `commands/os.rs` |
| `open_with_system` | open an opened file in its default app, or show it in the file manager | `commands/os.rs` |
| `note_recent` | add an opened document to the system's Recent list (Windows) | `commands/recent.rs` |
| `reveal_in_editor` | run the `external_editor` template from `config.toml` | `commands/os.rs` |
| `run_command` | run one of the reader's `[[command]]` entries from `config.toml` | `commands/run.rs` |
| `fetch_remote_image` | fetch one https image into memory, served as `marxy-remote://` | `remote.rs` |

Rust emits `fs-watch` (watch events), `marxy:open-files`, `marxy:close-requested` and, on macOS,
`marxy:menu`.

## Files

### Paths

Every path command refuses a relative path (`commands::fs::absolute`), so archive-entry paths such as
`archive-entry:4/notes` never reach the disk; the page applies the same rule first (`onDiskOnly`).
Folders named `node_modules`, `target`, `.venv`, `venv`, `dist`, `build`, `out`, `.git`,
`__pycache__`, `.next`, `.turbo` and `coverage` are skipped by listing, search, the tree watch and
`marxy-file://` (`DENY_DIRECTORY_NAMES`, held equal to `packages/core/src/index-model/deny.ts`).

### Scope of the path commands (`src/scope.rs`)

One module decides which paths and handles the shell may touch: `src/scope.rs` with `src/scope/`. The opened set
(`scope/set.rs`) records what the reader opened and chose; `scope::check` judges it for a path command by what the
command needs (below), and `scope/served.rs` judges it for what a document may load (`marxy-file://` and the readers
of a file the page shows, further down). Every handle opened after either judgement is judged again in one place,
`scope.rs`, and must be open on the very path that was judged. No command judges a path or a handle any other way.

The path commands answer only for what the reader opened or chose, and for Marxy's own folders. The set has five
parts, each canonical and as spelled: **files** the reader opened, **folders** scoped for a document
(`allow_asset_scope`: its folder, an image root, a theme), **roots** chosen for the index (`mark_opened` with `root`:
the open document's repository or folder, a collection's folder, a recent folder, a theme folder; never a drive's or a
share's root), **picked folders** (a folder chosen in the picker) and **Marxy's folders** (data and config, recorded at
startup). Reading a file, its head or its folder never adds anything: the index reads heads of files under a root, and
they stay out of `files`, so `marxy-file://` never serves a file because it was indexed. What adds a file:
`mark_opened` (the page calls it before every open, for each column and tab of the restored layout, for Compare's other
file, for a file changed from the Line and for a new file the tray writes), the launch arguments, a second launch, a
drop, Open with and the jump list, and the pickers (a Save as name counts before a file is there). After a restart the
set starts empty and is rebuilt from the launch, the restored layout and the folders the index holds, never from
history. Writing is narrower than reading: roots and folders scoped for a document are read-only.

A path is judged by spelling first, so a path outside never reaches the disk (no share lookup); then canonical, so a
`..`, a symlink or a junction inside a root that leads out is refused. `read_file`, which follows links, refuses a
handle open on any file but the one judged, or one the set no longer holds for reading (so it refuses the repository
probe that `read_head` answers); `read_head` (and `detect_files` through it), `image_size` and `stat_file` refuse a handle open on
any file but the one judged and read from that handle, so a folder swapped for a junction between the check and the
open is refused; `read_dir` holds the judged folder open while it lists it (on Windows without delete sharing, so it
cannot be swapped meanwhile; on Unix the handle is judged once, then the folder is listed by name); `real_path` answers
with the path the check judged rather than resolving it again. A SQLite database's `-wal`, `-shm` and `-journal`
are opened and judged the same way before SQLite, which opens them by name and follows links, may read them: one that
is a link, junction or reparse point leading elsewhere, or a second name of another file (a hard link), is never read,
and the database is read from a copy in memory (with its log only when the log was judged). The judged files and the
database are held open while SQLite opens them. A `-journal` can also appear after that check, since SQLite looks for a
hot journal before every read, so a database read in place goes through a file layer of Marxy's own that opens the
journal itself, judges it by that handle and gives SQLite only that handle to read; one that is refused, or gone, is
taken by SQLite as hot, and the open falls to the copy (or, once open, that page is refused). SQLite reads at most a
journal's first byte, to tell whether it is hot, and never rolls one back: a database with a hot journal beside it is
read from a copy as the file stands, which can hold a writer's half-made change. Not covered: a database turned to
WAL by another program between the check and the open has its new `-wal` and `-shm` opened by SQLite by name; and on
Unix a held file can still be renamed, so there the database, `-wal` and `-shm` are judged once, before SQLite opens
them by name (the journal is read from its judged handle on every system). A write opens the folder it writes into, judges the
file's place by that handle and holds it through the write: on Windows without delete sharing, so neither that folder
nor one above it can be renamed or swapped for a junction meanwhile; on Unix the handle is judged once, before staging.
Paths compare with one separator, without the `\\?\` prefix, and in one case on Windows. A refusal is the shell error
`outside`; a path in scope that is not there is `not-found` (`stat_file`: null).

| Command | Must be in |
| --- | --- |
| `read_file`, `read_head`, `image_size` | **Read**: a file opened, or inside a folder, root, picked folder or Marxy's folder (dot files too); plus `<dir>/.git` and `<dir>/.git/HEAD` for the nearest repository above an opened file or a place, so the index can find it |
| `detect_files` | Read; a path outside answers null |
| `search_content` | each root Read, and each file held for Read before it is opened (a root admitted only as a repository probe lends nothing below it); a file must also lie under a kept root, below no denied folder and through no link, and is opened without blocking and judged by its handle; files under no kept root are skipped |
| `real_path`, `stat_file` | **List**: Read, or any folder above an opened file or a place (the breadcrumbs) |
| `read_dir`, a flat `watch_root` | **Folder**: inside a place, or the folder of a file opened (its neighbours); a folder above is not listed |
| a tree `watch_root` | Read |
| `write_file_atomic` | **Write**: a file opened (a Save as name included), or inside a picked folder or Marxy's folder |
| `write_file_new` | **Create**: Write, or a new name beside a file opened (Fork); the name is judged, not a link at it |
| `note_recent` | Read; otherwise not recorded |
| `image_facts`, `list_archive`, `read_archive_*`, `tables_*`, `font_*`, `media_*`, `open_with_system`, `reveal_in_editor`, `run_command`'s folder, `marxy-file://` | the **served** set: files opened, and what is under a scoped folder that is no dot name and not under a dot or denied folder there (roots, picked folders and Marxy's folders are not served) |
| `allow_asset_scope`, `mark_opened` | add to the set; a drive or share root (and for `allow_asset_scope` the home folder or above) is refused |
| `open_dialog`, `save_dialog`, `args`, `take_pending_opens` | record what they return (a picked folder as a picked folder) |

Tauri's own asset protocol is off; `allow_asset_scope` is the app's command for `marxy-file://`.

`mark_opened`, `allow_asset_scope` and the roots they record trust the page's own code: the page decides what the
reader opened and chose. The scope stops content in a document (a link, an image path, a name in a file) from making
the shell read or write elsewhere; it does not stop a compromised page, which can call `mark_opened` itself.

### Content search (`commands/search.rs`)

Literal, byte for byte: smart case folds ASCII only, there is no regular expression and no decoding, so a UTF-16
file (its NULs mark it binary) is skipped and a legacy code page matches on its bytes. A file is read
4 MB at a time, each chunk starting `query length - 1` bytes before the last one's end, so a match across an edge
is whole in the next chunk and none is reported twice; a chunk is cut back to a character boundary when it is
UTF-8. Hits keep the file's byte offsets, line numbers and previews, whatever the chunk size. The first chunk
is also the binary sniff, so a file is read once, and smart case compares with ASCII folding as it scans rather
than on a lowered copy. The files passed must lie under a root, outside the deny list and not behind a symlink:
the path is judged by its spelling first (a path outside never reaches the disk), then the opened handle is
judged, on Windows by asking it where it is (as `read_head` does), on Unix by its device and inode against the
canonical path, so a link or junction swapped in after the check is refused. Each file must be a regular file of
at most 256 MB (the open limit) with no NUL in its first 8 KB, else it is skipped and counted in `skippedFiles`
(a path that no longer exists is not counted). Up to eight threads take the paths by an atomic index; their
results are put back in the order the paths were passed, and every limit is applied on that ordered prefix, so
the hits and counts are those a loop over the paths would give, whatever the timing. Budgets: 1 GB read in
all (the sizes of the files in order, so a file a thread read ahead of the point where it ran out is dropped),
15 s (one deadline for the search; a file in progress stops at its next chunk), 100,000 files, 10,000 hits, and
`perFile` hits in one file. The first three end the search with `truncated` and `stopped` (`bytes`, `time`,
`files`); the hit limits set `truncated` alone. Cancelling is polled between chunks.

### Reading

`read_file` follows symlinks, refuses anything that is not a regular file or is over 256 MB, and
refuses a file that grew during the read rather than cutting it. `read_head` refuses symlinks, FIFOs,
devices and folders. Neither adds the file to the scope. Nothing is decoded on read; text decoding is a separate
request (`decode_text`).

### Writing (`src/atomic_write.rs`)

- `write_atomic` writes through a symlinked destination, keeps the on-disk spelling of the name on
  Windows, and refuses a destination that is not a regular file, is read-only or has more than one
  hard link. It stages the bytes in a hidden temporary file in the same folder, carries over the old
  file's permissions (and on Windows its ACL, creation time and hidden/system attributes; on Unix its
  owner and group, refusing a save that would change the owner), syncs, and renames over the
  destination. On Windows a locked file is retried for about a second.
- `write_file_atomic` with an `x-marxy-expect` header (the length and SHA-256 of what the webview read, in
  hex) runs `write_atomic_unless_changed`: the file is opened and its length, then its SHA-256, compared
  through that handle before staging. The handle is held through the rename; on Windows it is opened so that
  other programs may read the file and rename over it but not open it for writing, so their write fails
  rather than being lost. Just before the rename the handle's and the name's length and write time, and which
  file the name leads to (inode on Unix, volume serial and file index on Windows), are compared again, so an
  editor's rename-into-place while the save stages is caught. A mismatch is the error code `changed`, with the
  old bytes and no staging file left. A file that is gone has nothing to overwrite and is written, by an
  exclusive rename, so one that another program made at the name meanwhile is refused (`changed`) rather
  than replaced. The hash is plain `std` (the x86 SHA
  instructions where the CPU has them, about 11 ms for 20 MB) so the module still compiles alone for the
  fidelity gate.
- `write_new` refuses any existing entry at the name and publishes with an exclusive rename.
- After the first successful save or new file in a folder each run, that folder is swept of staging files an
  earlier Marxy left when it was stopped between staging and rename: only a name of exactly the form
  `.<name>.marxy-tmp-<pid>-<attempt>-<nanos>` that Marxy writes, only when that pid is neither this process nor
  any running process (a pid reused by another program keeps the file), and only a plain file with one name,
  judged by an open handle that does not follow links. A folder, a link, a junction or a hard link with such a name
  stays, and so does every folder this run did not save into. On Windows the file is removed through that handle;
  on Unix it is first moved by an exclusive rename to a fresh `.marxy-swept-…` name, which no sweep takes for a
  leftover, and removed only if that name still leads to the file judged; anything else found there is put back,
  and if that fails it stays under that name rather than being deleted later. Nothing about the sweep is logged.

### Watching (`src/watch/`)

- One OS watch per canonical root, shared and reference-counted.
- A folder watch rescans the folder on each signal and every 2 s, diffing a snapshot of its regular
  files. A scan lists each folder once; on Windows that one listing also gives each file's id, size and write time, and only a reparse point (a link, a junction, a cloud placeholder) is asked of the file itself. A tree watch gathers events for 50 ms, re-examines only the reported paths, rescans when the
  OS reports lost events, reconciles quietly every 60 s, and stops with a refusal past 200,000 files.
- A tree watch is also given the folders the index walk left out through a `.gitignore`, a `.ignore` or a deny glob
  (`ignore` on `watch_root`, replaced by `watch_ignore`): they are not listed, counted or reported, and only folders
  inside the watched root count. A walk that finds the rules changed sends the new list; a folder that stops being left
  out is read again and its files reported created. A folder is left out only when every root the tree holds left it out.
- Events are `created`, `removed`, `modified`, and `renamed` (paired by inode on Unix and NTFS file id
  on Windows, so a save by rename is seen as one). `\\?\` prefixes are stripped from Windows paths.

### `marxy-file://` and the served set (`src/file_scheme.rs`, `src/scope/served.rs`)

Images, fonts, media and PDFs a document shows are served through `marxy-file://` (on Windows
`http://marxy-file.localhost/…`). Only the served part of the scope can be reached: files the reader opened
(above), folders added with `allow_asset_scope` (never a drive root, the home folder or its
parents), and images measured under such a folder; never a file only read or indexed. `file_scheme.rs` only serves
bytes; the rule is `scope/served.rs`. Each request is checked by spelling, after canonicalisation and by the opened
handle, which must be open on the very file the canonical check resolved. Ranges are served up to 4 MB per response; a whole file over
64 MB needs a range. `?decoded` answers PNG from the first decoder that reads the file (an SVGZ's unpacked SVG, as `image/svg+xml`), cached on disk under a name ending in what it holds (`.png`, `.svg`). A decoder that panics on a hostile file refuses that file (422), and any panic in answering a request is a 500: the request always completes.
The archive, table, font and media commands open their file through the same rule and handle check
(`served::open_judged`); `open_with_system` and `run_command`'s working folder are limited to the same set.

## Archives and decoders

| Area | What is read | Limits |
| --- | --- | --- |
| Archives (`archive/`) | zip (stored, deflate, Deflate64, bzip2, LZMA, Zstandard and xz entries, zip64, CRC-checked), tar and tar.gz/bz2/xz, lone gz/bz2/xz, 7z (copy, LZMA, LZMA2, BCJ, BCJ2 and delta, solid or not, CRC-checked); detected by bytes, never by extension. A zip entry packed with PPMd or another method is listed with its method and refused as unsupported. A 7z entry packed with PPMd, bzip2, Deflate, Zstandard or another method is listed and refused the same way; an encrypted entry (zip or 7z, AES or not) is listed as encrypted and refused; a 7z whose list of entries is encrypted is refused before anything is listed. tar.zst and a lone .zst (one Zstandard frame, its window held as a zip entry's is, by the content size its header declares). An `ar` archive and a Debian package: the members as they lie, and a package's control and data tars (gzip, bzip2, xz, Zstandard or none) walked through the tar reader over the member's bytes, their files listed under `control/` and `data/` (only the first control tar and the first data tar; any more are members only, counted in the `note`); another packing is named in the listing's `note`. Only `.deb` is routed to the archive page; another `ar` (`.a`, `.lib`) keeps its own row and would list its members alone. A Windows cabinet from its CFHEADER, CFFOLDER and CFFILE records: stored and MSZIP folders read block by block (a block reaches back into the 32 KB before it), LZX and Quantum listed and refused, an entry that crosses into another cabinet refused. An ISO 9660 image from its volume descriptors and directory records, with Joliet names when a supplementary descriptor has them; a file is read from its extents as they lie. RAR 4 and 5 from their block headers, listed only: every read is refused, and the listing's `note` says the contents cannot be read here; an archive whose headers are encrypted lists nothing and says so | 100,000 entries, names to 1 KB and 64 segments, 16 MB per entry, 1 GB decompressed per stream; a zip entry's LZMA dictionary to 256 MB and its Zstandard window to twice its declared size, rounded up to a power of two and held between 8 MB and 32 MB (more is refused before the decoder is made, since the decoder fills a whole window before it gives out a byte), Deflate64's window fixed at 128 KB and bzip2 at about 4 MB for its largest (900 KB) block; a 7z's list of entries to 16 MB unpacked, 1,000,000 declared entries and 200,000 declared blocks or packed streams (more is refused, not cut short), and packed with one copy, LZMA or LZMA2 coder or not at all (a filter chain, another method or AES there is refused), the dictionaries of one block to 256 MB in all, and 1 GB unpacked per call (an entry further into a solid block than that is refused); a 7z whose signature header has a zero or wrong CRC is damaged, not searched; an ISO walk charged a step per record and per sector (4,000,000), 16 MB of records per folder and 256 MB in all, each folder walked once (a record pointing back at one already walked is listed, not followed); a RAR walk to 4,000,000 headers, a RAR 5 header to 2 MB; a cabinet's folder walk charged its unpacked bytes against the 1 GB stream cap; a Debian package's control and data tars share one 1 GB stream budget for the listing; every count, offset and length in a cabinet, ar, ISO or RAR checked against the file before it is used; links shown, never followed; nothing written to disk |
| SQLite (`tables/sqlite.rs`, `tables/wal.rs`) | read-only, `query_only`, no schema trust; an in-memory copy with the WAL laid over it when the file is locked or would need a `-shm` | pages of 200 rows and 100 columns, time caps per page, text cut at 2,000 characters |
| Spreadsheets (`tables/sheets.rs`, `tables/formats.rs`) | xlsx, xlsm, ods, xls through `calamine`; cached values, formulas as text, number formats | 256 MB workbook, 2,000,000 cells; macros reported, never run; external links listed, never opened |
| Fonts (`font/`) | TrueType, CFF, collections, WOFF, WOFF2 | 30 MB, 64 faces |
| Image facts (`facts/`) | png, jpeg, gif, webp, avif, heic, raw, tiff, exr, hdr, qoi, jxl, bmp, ico, tga, svg, pbm, pgm, ppm, pam, farbfeld, dds, psd, svgz | 64-byte identification, header reads; a PSD's resources walked to find its preview; an SVGZ unpacked within its cap to read its root |
| Image decoders (`decode/`) | RAW (embedded JPEG preview only), TIFF, OpenEXR, Radiance HDR, QOI, JPEG XL, TGA, the PNM family, farbfeld, DDS (BC1 to BC3; BC4 to BC7 and uncompressed refused), a PSD's flattened image when the file says it is real (raw or PackBits, 8 or 16 bits, bitmap, grey, indexed, RGB or CMYK; layers never) else its resource 1036 JPEG thumbnail, enlarged to the file's size within the pixel budget and when of the same shape (`decode/psd.rs`), converted to PNG; an SVGZ unpacked to its SVG (`decode/svgz.rs`); on Windows HEIC through the system's Windows Imaging Component decoder (`decode/wic.rs`), COM on a worker thread of its own, when a probe decode finds the codec | 2^26 pixels, 1 GiB per decode, two decodes at once; a HEIC judged on its coded size before the system decoder sees it (its `ispe` before `clap` crops it, and for a grid the larger of its output and the sum of its tiles' sizes), then on the decoder's own size before pixels are allocated; 20 s per system decode, and no new one starts while a decode past that has not returned; every PSD length judged against its section and the file before it is read; an SVGZ unpacked to 16 MB at most (past that refused, unread further) |
| Media (`facts/media.rs`) | wav, mp4, mov, mkv/webm, mp3, ogg, flac: duration, tracks, codecs, tags | `moov` up to 32 MB |
| Encodings (`encoding/`) | BOM as fact, else UTF-8 when valid, else a `chardetng` guess; 13 candidate encodings for "read as"; Windows code page numbers mapped to `encoding_rs` (`of_code_page`) | first 1 MB for the guess |
| Outlook messages (`outlook/`) | `.msg` through `cfb`, from bytes in memory: the properties of the message, its recipients and attachments (strings as UTF-16 or in the message's code page), transport headers, `PR_HTML`, `PR_BODY`, `PR_RTF_COMPRESSED` (LZFu or stored; the CRC checked; HTML or text wrapped with `\fromhtml1` or `\fromtext` taken back out, any other RTF left unread), attachments by value, and messages attached to it; written as RFC 5322 and MIME with every value on one line and every boundary derived from what it holds and checked against it (`docs/file-kinds.md`) | 64 MB a message, 16 MB a stream, 128 MB read in all and at least 4 KB for each of at most 20,000 streams opened (a compound file can point many streams at the same sectors), 50,000 directory entries, streams declaring at most 64 times the file, 200 million sector-chain steps (the FAT and directory are read from the bytes first, so what cfb would walk is charged before it opens a stream), 4,096 properties, 1,000 recipients and 256 attachments an object, 8 levels of attached messages, RTF unpacked to its declared size and at most 16 MB, 60 MB written with headers and names counted (a filename cut at 1 KB, a header value at 64 KB); past a cap a part is left out and said; not a compound file, not a message, or damaged is said in a sentence; a panic in the read is caught and said as damaged; nothing written to disk |
| Word 97-2003 documents and decks (`legacy_office/`) | `.doc` and `.ppt` through `outlook/layout.rs` and `cfb`, from bytes in memory: a document's FIB, piece table (8-bit and UTF-16 pieces), paragraph and character property pages and style sheet; a deck's Current User, edit chain and persist directories (or a top-level record scan), slide list, slides' drawings and notes pages; SummaryInformation for the title, author and dates; answered as the office page's blocks (`docs/file-kinds.md`) | 64 MB a file and a stream, 16 MB of text and 500,000 paragraphs, cells and line breaks written, 50 million steps over records, pieces and characters, 200 million sector-chain steps, 50,000 directory entries, drawings 64 containers deep, 10,000 slides, 10,000 pictures and objects named; past the text or slide cap the rest is left out and said; encrypted, not a document, or damaged is said in a sentence; a panic in the read is caught and said as damaged; nothing written to disk |

## Operating-system integration

- **Links**: `open_external` accepts `http`, `https` and `mailto` only and passes the URL as one
  argument (`ShellExecuteW` on Windows, `open` on macOS, `xdg-open` on Linux).
- **Recent documents (Windows)**: `note_recent` (`commands/recent.rs`) calls `SHAddToRecentDocs` for a
  document the page has opened: any route (launch argument, second launch, drop, Open dialog, link,
  quick open), once per open and not for a reload of the open file. Archive entries and other paths
  that name no regular file are skipped, as is anything under the data folder, the config folder or
  the temp folder. It feeds Explorer's Recent list and the Recent category of the taskbar jump list;
  Windows' own "Show recently opened items" setting governs both, and Marxy adds no setting of its own.
  The process sets its AppUserModelID to the bundle identifier (`dev.marxy.app`), the same string the
  installer stamps on its Start menu and desktop shortcuts, so the taskbar button and the jump list
  belong to one app; neither tao nor wry sets one. No custom jump list is built.
- **Open and reveal**: `open_with_system` opens only files in the opened set and refuses programs
  (a list of extensions, `AssocIsDangerous` on Windows, and any file whose first two bytes are MZ, whatever its name); reveal selects the file in Explorer,
  Finder or the Linux file manager.
- **External editor**: `reveal_in_editor` reads `external_editor` from `config.toml` on every call
  and substitutes `{file}` and `{line}`. With none set, macOS runs `open -t`, Linux `xdg-open`, and
  Windows starts `notepad.exe` with the path as one argument; that path takes only files the window
  opened, never a program, and drops the line. A bare program name that is not found on Windows is
  tried again as a `.cmd` shim (`code`).
- **Your own commands**: `run_command` receives only an id and a folder. The program and its
  arguments come from `[[command]]` in `config.toml`, read on every run; it runs without a shell,
  with the page's text on stdin, a 10 s limit and 16 MB of output; on Windows inside a job object
  that kills the process tree. On Windows the folder is kept out of the child's program search
  (`NoDefaultCurrentDirectoryInExePath`), so a `node.exe` planted in a document's folder is not run.
- **Clipboard**: typed pasteboard items on macOS (NSPasteboard) and Windows (Win32), named with the
  macOS types everywhere; Linux writes text and HTML through the plugin (`clipboard_write`) and has no
  read. On Windows `win_types.rs` maps the names: `public.utf8-plain-text` is `CF_UNICODETEXT`,
  `public.html` is `HTML Format` (CF_HTML; a read returns its `StartHTML`..`EndHTML`, or the fragment,
  after checking every offset against the buffer; a write wraps the HTML with a byte-exact header),
  `public.rtf` is `Rich Text Format`, `public.url` is `UniformResourceLocatorW`, `public.png` is
  `PNG`. Other formats are listed under their own names, up to 500. Reads and writes hold the
  clipboard open for the whole command on a thread with no window, retrying for about a third of a
  second while another app holds it; the window waits for that thread 3 s at most ("The app that
  copied this is not answering"). A format over the 16 MB cap is sized and skipped before it is
  copied.
- **Clipboard privacy**: nothing watches the clipboard; data is read only on a paste or a clipboard
  command, and only the types it needs. A concealed item (`org.nspasteboard.ConcealedType`; on
  Windows any of `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` or
  `CanUploadToCloudClipboard`, whatever its value, since password managers set them) is refused
  before any data is read. A transient write carries `org.nspasteboard.TransientType`; on Windows
  `ExcludeClipboardContentFromMonitorProcessing` plus `CanIncludeInClipboardHistory` and
  `CanUploadToCloudClipboard` set to 0. Writes on macOS name Marxy in `org.nspasteboard.source`;
  Windows has no such convention.
- **Menu**: a native menu on macOS only (`app_menu::MENU`), whose items run registry commands in the
  page through `marxy:menu`. Windows and Linux have no menu bar.

## Network

`src/remote.rs` is the only network code, used only by `fetch_remote_image` when a reader allows a
document's remote images. It accepts `https` URLs to public hosts only (no `localhost`, `.local`,
private, loopback, link-local, multicast or reserved addresses, including ones carried inside IPv6, checked again
after resolution; environment proxies are ignored so that check sees the real host), follows at most three
same-host redirects by hand, accepts only status 200 and a confirmed `image/*` body of at most 10 MB,
and keeps images in memory only (256 images or 128 MB). There is no updater and no telemetry.

## Files the shell writes

| File | Contents | When |
| --- | --- | --- |
| `<data>/window.json` | window position, size and maximised state | on close and quit |
| `<data>/decoded/<hash>.png`, `.svg` | decoded images, an SVGZ's SVG | on a cache miss; trimmed to 512 MB |
| `<data>/index-<hash>.json` | (removed) index files whose folder is gone | 20 s after launch |
| `.<name>.marxy-tmp-…` beside a document | staging bytes for a save | during a write; renamed or removed, or swept by a later run's first save in that folder once its process is gone |
| `.marxy-swept-…` beside a document (Unix) | a leftover the sweep is removing | for an instant; left only if the removal or putting back a file swapped in there could not finish, or Marxy stopped between the two; nothing removes it later |

The page's own files are listed in [data-on-disk.md](data-on-disk.md).

## Tests

- `cargo test` in `apps/desktop/src-tauri` runs the Rust tests (inline `mod tests` and the `*_tests.rs`
  and `tests.rs` modules); `pnpm lint:rust` runs `cargo fmt --check` and `clippy -D warnings`.
- Fixtures: `src-tauri/tests/fixtures/` (archives, images) and the repo's `fixtures/` (corpus, demo,
  detect, sheets, media, content-search cases).
- `MARXY_BLESS=1 cargo test stand_in` rewrites `apps/desktop/src/harness/native-facts.ts`, the font and
  media facts the browser dev loop uses in place of the Rust readers; the test fails while they differ.
- Ignored tests write `apps/desktop/src/harness/tables-demo.json` (`write_the_demo_tables`) and run
  benchmarks.
- Outside cargo: `packages/core/src/position/watch-rust.test.ts` compiles `watch/mod.rs` alone;
  `scripts/gate-fidelity.mjs` compiles `atomic_write.rs` and drives it over the corpus.
