# Building Marxy mock v2 with Tauri v2

How the design in [FEATURES.md](FEATURES.md) maps onto a Tauri v2 application. This is a plan, not a measured implementation: crate and plugin capabilities were checked against what is known as of this writing, and the places where a capability needs verifying before you rely on it are marked **verify**.

## Shape of the app

```
+-------------------------------- Marxy.app ---------------------------------+
|                                                                             |
|  WebView (WKWebView / WebView2 / WebKitGTK)        Rust core (Tauri v2)     |
|  ---------------------------------------          -----------------------  |
|  UI shell, panes, menus in-window                  file access + scopes     |
|  render panel (DOM from parsed Markdown)  <--IPC-> watcher (change on disk) |
|  source panel (CodeMirror 6)              commands  indexer (tantivy)       |
|  fold-up engine (fold, peek, dock)        channels  metadata (SQLite)       |
|  palette, library, themes, typography     events    snapshots (blobs)       |
|                                                     menus, window state     |
|                                                                             |
|  Later: Contents/PlugIns (Swift, built with xcodebuild, bundled before      |
|  signing): Quick Look, Share extension, Finder action, App Intents          |
+-----------------------------------------------------------------------------+
```

The rule of thumb: anything that touches the file system, the clipboard, the network or the operating system lives in Rust; anything that touches pixels lives in the webview. The webview never reads files directly.

## Frontend

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | |
| UI framework | Svelte 5 or SolidJS | Fine-grained reactivity and a small runtime; the document itself is rendered outside the framework |
| Fold-up | A `data-fold` attribute on the window root (`folded` or `unfolded`) plus plain classes on the chrome (`.sidebar`, `.toolbar`, `.tabs`, `.statusbar`, `.inspector`, `.modebar`, `.pane-head`); the engine folds them by class, so a panel needs no code of its own to take part | The document column never changes width or position when a panel peeks, because a peeked panel overlays it |
| Document rendering | Parsed in Rust (below), turned into DOM by a small renderer that adds block handles, path chips, badges and admonition icons | Keeps one parser for index and display |
| Editor | CodeMirror 6 with `@codemirror/lang-markdown`, GFM, nested fence languages, search, lint, fold, Vim and Emacs keymaps | Mature, handles large files, multiple cursors, transactions for undo |
| Highlighting | Shiki with TextMate grammars, run once per code block content hash, cached via IPC | The handbook's recommendation (VS Code parity, audited themes as CSS variables) |
| Themes | CSS custom properties as in `shared/tokens.css`; a theme is a token set | Switching is free; audit runs in CI |
| Find | CSS Custom Highlight API | Never mutates the document DOM |
| Measurement | Average character width measured per face and size with a long sample; cached | Measure holds in characters (handbook chapter 3) |

The prototype's `shared/` folder is a working sketch of most of this: the token system, the per-type typography, the transforms, the palette and the block-to-line mapping carry over; the textarea editor and regex Markdown parser do not.

## Rust core

| Concern | Crate or plugin | Notes |
|---|---|---|
| Markdown parsing | `comrak` | GFM, footnotes, front matter, and `sourcepos` so every block carries its source lines; GitHub-style alerts are supported in recent versions (**verify** the version) |
| Front matter | a maintained YAML crate | `serde_yaml` is archived; pick a maintained successor |
| File watching | `notify` with `notify-debouncer-full` | FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux; debouncing collapses editor save-through-temp-file sequences |
| Full-text index | `tantivy` | Fields: path, title, headings, body, code, kind, modified |
| Metadata | `rusqlite` with bundled SQLite | Schema below |
| Hashing | `blake3` | Content hashes for snapshots and the highlight cache |
| Diff | `similar` | Line and word diffs for versions and replace previews |
| Snapshots | Content-addressed blobs compressed with `zstd` | Deduplicated across revisions |
| HTML sanitising | `ammonia` | For raw HTML inside Markdown |
| macOS APIs | `objc2` family (`objc2-app-kit`, `objc2-foundation`) | Pasteboard types, security-scoped bookmarks; later, the Services provider and Core Spotlight |
| Parallelism | `rayon` for indexing, `tokio` for IO | |

### Tauri plugins

| Plugin | Used for |
|---|---|
| `tauri-plugin-fs` | Scoped file access; scopes extended at runtime for each added collection |
| `tauri-plugin-dialog` | Folder and file pickers, confirmation sheets |
| `tauri-plugin-clipboard-manager` | Writing text and HTML together for rich copies (**verify** multi-type writes; fall back to `objc2` for full `NSPasteboard` control on macOS) |
| `tauri-plugin-deep-link` | `marxy://open?path=…` links |
| `tauri-plugin-single-instance` | Opening a file from Finder routes to the running app |
| `tauri-plugin-opener` | Open in default app, reveal in Finder, open URLs externally |
| `tauri-plugin-window-state` | Window positions and sizes; the fold state is deliberately not restored, so the window always launches folded |
| `tauri-plugin-updater` | Direct-download builds (not App Store) |
| Core `tauri::menu` | App menu bar |

## IPC surface

Commands are request and response; channels stream; events broadcast.

| Kind | Name | Purpose |
|---|---|---|
| command | `open_document(path)` | Returns parsed document: HTML blocks with source lines, headings, tasks, code blocks, tables, front matter, stats, detected kind with reasons |
| command | `render_markdown(text, kind)` | Re-render unsaved text from the editor (debounced 50 to 120 ms) |
| command | `save_document(path, text, base_hash)` | Writes atomically; refuses with a conflict if the file changed since `base_hash` |
| command | `verify_paths(file_id)` | Resolves mentioned paths against the collection base |
| command | `search(query, filters, limit)` | Palette and library queries |
| command | `add_collection(spec)` / `dry_run_collection(spec)` | Dry run returns counts and skipped files with reasons |
| command | `list_snapshots(file_id)` / `diff(a, b)` / `restore(file_id, rev)` | Versions |
| command | `clip_write(formats)` | Writes the copy formats to the pasteboard in several types at once |
| command | `run_transform(id, text)` | Pure transforms can run on either side; the webview has the same library |
| channel | `index_progress` | Indexing status |
| event | `file_changed` | Reload on change; the changed-on-disk bar when there are unsaved edits |

## Data model

SQLite, in `~/Library/Application Support/Marxy/marxy.db`; blobs beside it.

| Table | Key columns |
|---|---|
| `collections` | id, name, root, path_base, default_kind, watch_mode, include_globs, exclude_globs, bookmark (security-scoped, macOS) |
| `files` | id, collection_id, path, size, mtime, content_hash, kind, kind_reasons, kind_override, title, words, tasks_done, tasks_total, read_hash, archived |
| `headings` | file_id, level, text, line |
| `mentions` | file_id, kind (path or url), target, line, resolved |
| `snapshots` | file_id, rev, content_hash, at, lines_added, lines_removed |
| `annotations` | file_id, quote, prefix, suffix, position_hint, note, style |
| `rules` | glob, kind (folder-to-type rules) |

Settings live in a JSON file (`settings.json`) so they are inspectable and diffable, including the last unfolded arrangement; the Settings window shows the file.

## Behaviours that need care

**Fold-up.** Two states on the window root: `folded` (only the document column) and `unfolded` (the full workspace). When folded, a pointer that pauses at the left, right or top edge for a short delay peeks the sidebar, inspector, or toolbar and tabs as an overlay; the webview sees edge pointer events itself, and **verify** whether a native tracking area is needed for the screen edge when the pointer leaves the window. A click inside a peeked panel, or the panel's own shortcut, docks it into the layout. Escape (when nothing else is open) or ⌘\ folds again. The last unfolded arrangement is saved to `settings.json`; the window always launches folded.

**Changed on disk.** The watcher emits `file_changed`. With no unsaved edits the file re-renders in place. With unsaved edits the editor shows a bar, "This file changed on disk", with Keep mine as a copy (the user's text is saved beside the original) and Take theirs (the editor reloads); nothing is merged and nothing is overwritten silently.

**Atomic saves.** Write to a temporary file in the same directory, fsync, rename; compare the on-disk hash with the editor's base hash first, so a change made by another program is never silently overwritten.

**Pasteboard writes.** Copies put several types on the pasteboard at once (`public.utf8-plain-text`, `public.html`, and RTF for rich copies), so each destination takes what it understands.

**File access.** Tauri capability scopes limit the webview's reach; the Rust core holds the real access. For a sandboxed App Store build, each added folder's security-scoped bookmark is stored and resolved at launch through `objc2`; Tauri does not manage these for you.

**Not in this direction.** Model provider, AI client, tokenizer, summary cache, agent-file watching and lock, live-file detection, clipboard history and global shortcuts.

**Untrusted content.** Markdown can contain HTML and links. Raw HTML is sanitised; remote images and fonts are blocked until allowed per collection; links open in the default browser; nothing in a document is ever executed, and "send to Terminal" pastes without a newline.

## macOS extensions (later)

Not in the first release. Tauri's bundler builds the main app; extensions are separate Xcode targets built with `xcodebuild` in a pre-bundle step and copied into `Marxy.app/Contents/PlugIns` before code signing and notarisation.

| Surface | Implementation | Talks to the app through |
|---|---|---|
| Quick Look | Quick Look preview extension (`QLPreviewingController`) rendering with the same CSS in a `WKWebView` | Reads the file itself; shares theme tokens via an App Group container |
| Share extension | `NSExtension` share target | App Group inbox folder, then a deep link to wake the app |
| Finder Quick Actions | Action extension shown in Finder's Quick Actions (**verify** the exact extension point and Info.plist keys) | Deep link or App Group |
| Services | `NSServices` entries in Info.plist and a services provider object registered at launch through the Objective-C runtime (`objc2`) | In-process |
| Shortcuts | App Intents (Swift) compiled into the app or an App Intents extension (**verify** how this links with a Rust main binary) | Calls into the core through a small C ABI or XPC |
| Spotlight | Core Spotlight items written by the core through `objc2` | In-process |

## Windows and Linux

The webview and Rust core are unchanged. Platform layers swap: title bar drawn in the webview with native window controls; Explorer context-menu entries (Windows 11 needs a sparse package or `IExplorerCommand` handler for the modern menu, **verify**) and file-manager actions on Linux. Services, Quick Look and App Intents have no equivalent.

## Testing

- **Contrast:** `tools/audit_contrast.py` in CI; a theme that fails does not build.
- **Typography:** the handbook's measure, hyphenation and pagination tests run in a headless Chromium against the frontend.
- **Transforms:** golden-file tests for each transform on the sample corpus.
- **End to end:** WebDriver via `tauri-driver` works on Windows and Linux; macOS has no WKWebView WebDriver, so macOS UI tests drive the app through accessibility (XCUITest) or test the frontend in a browser harness.
- **Fold-up:** pointer-pause at each edge peeks the right panel; click or shortcut docks it; Escape and ⌘\ fold; a fresh launch is folded whatever was saved.
- **Changed on disk:** rewrite the open file under unsaved edits and assert the bar, Keep mine as a copy and Take theirs.

## Performance budget

Targets are in [FEATURES.md](FEATURES.md#18-performance-targets); a peek or fold must not re-layout the document column. The levers: parse in Rust and send blocks with stable hashes so re-renders patch only changed blocks; virtualise very long documents by block; highlight lazily and cache by hash; index on a background pool with search available as it goes.
