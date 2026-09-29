//! marxy desktop shell. Everything privileged lives here behind the shell-api contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod atomic_write;
mod commands;
mod error;
mod watch;
#[path = "watch/spawn_notify.rs"]
mod watch_notify;

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use crate::atomic_write::WriteErrorKind;
use crate::error::ShellError;

use commands::app::config_paths;

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// The launch arguments, with each document path made absolute and canonical the same way a second
/// launch's are (`document_paths_from_argv`): the watcher reports canonical paths, so a relative
/// `marxy README.md` or a path through `/tmp` → `/private/tmp` otherwise never matched its events,
/// and `dirname("README.md")` named the file itself as the directory to watch. `args_os`, so an
/// argument that is not UTF-8 is skipped rather than panicking the process.
#[tauri::command]
fn args() -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    std::env::args_os()
        .skip(1)
        .filter_map(|a| a.into_string().ok())
        .map(|a| {
            if a.starts_with('-') {
                a
            } else {
                absolute_document_path(&cwd, &a).unwrap_or(a)
            }
        })
        .collect()
}

fn absolute_document_path(base: &Path, arg: &str) -> Option<String> {
    let path = PathBuf::from(arg);
    let resolved = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    resolved
        .canonicalize()
        .unwrap_or(resolved)
        .to_str()
        .map(String::from)
}

#[tauri::command]
fn clipboard_write(
    app: tauri::AppHandle,
    text: String,
    html: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match clipboard_payload(text, html) {
        ClipboardPayload::Text(text) => app.clipboard().write_text(text),
        // One write carrying both flavours: arboard's macOS `html()` clears the pasteboard first, so
        // a `write_text` followed by `write_html(_, None)` left only HTML and no plain text.
        ClipboardPayload::Html { html, alt } => app.clipboard().write_html(html, Some(alt)),
    }
    .map_err(|e| e.to_string())
}

/// What one `clipboard_write` puts on the pasteboard, decided apart from the real clipboard.
#[derive(Debug, PartialEq, Eq)]
enum ClipboardPayload {
    Text(String),
    Html { html: String, alt: String },
}

fn clipboard_payload(text: String, html: Option<String>) -> ClipboardPayload {
    match html {
        Some(html) => ClipboardPayload::Html { html, alt: text },
        None => ClipboardPayload::Text(text),
    }
}

/// The document's bytes exactly as they are on disk: no decoding, no line-ending or byte-order-mark
/// handling, because everything above this reads what the reader's file actually contains.
///
/// Returned as a raw IPC body, which the webview receives as an `ArrayBuffer`. A `Vec<u8>` would be
/// serialised as a JSON array of numbers: about 3.7 bytes of JSON per byte of document, built here
/// and parsed there, on the cold-start path.
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

/// The header `write_file_atomic` reads its destination from, percent-encoded by the webview.
const WRITE_PATH_HEADER: &str = "x-marxy-path";

/// Saves exactly the request's raw body and nothing else about the file; see `atomic_write` for the
/// guarantees and the cases it refuses. The bytes arrive as a raw body, not a JSON array of numbers,
/// and the path in `x-marxy-path`. Checked end to end over the corpus by `pnpm gate:fidelity`.
#[tauri::command]
fn write_file_atomic(request: tauri::ipc::Request<'_>) -> Result<(), ShellError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(ShellError::invalid(
            "",
            "write_file_atomic: expected the document's bytes as a raw body",
        ));
    };
    let encoded = request
        .headers()
        .get(WRITE_PATH_HEADER)
        .ok_or_else(|| {
            ShellError::invalid(
                "",
                format!("write_file_atomic: missing {WRITE_PATH_HEADER}"),
            )
        })?
        .to_str()
        .map_err(|e| {
            ShellError::invalid("", format!("write_file_atomic: {WRITE_PATH_HEADER}: {e}"))
        })?;
    let path = percent_decode(encoded).map_err(|e| ShellError::invalid("", e))?;
    atomic_write::write_atomic(std::path::Path::new(&path), bytes).map_err(|e| match e.kind {
        WriteErrorKind::Permission => ShellError::permission(&path, e.message),
        WriteErrorKind::Io => ShellError::io(&path, e.message),
    })
}

#[tauri::command]
fn set_title(app: tauri::AppHandle, title: String) -> Result<(), ShellError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| ShellError::invalid("", "no main window"))?;
    window
        .set_title(&title)
        .map_err(|e| ShellError::io("", e.to_string()))
}

#[tauri::command]
async fn save_dialog(
    app: tauri::AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, ShellError> {
    use tauri_plugin_dialog::DialogExt;
    let path = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = app.dialog().file();
        if let Some(path) = default_path {
            picker = picker.set_file_name(&path);
        }
        picker.blocking_save_file()
    })
    .await
    .map_err(|e| ShellError::io("", e.to_string()))?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
fn close_confirmed(app: tauri::AppHandle) -> Result<(), ShellError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| ShellError::invalid("", "no main window"))?;
    // `destroy`, not `close`: `close` raises CloseRequested again, the run handler prevents it and asks
    // the webview again, and confirm -> close -> ask never ends (MARXY-337). `destroy` is Tauri's forced
    // close; it skips CloseRequested, and the last window going ends the app.
    window
        .destroy()
        .map_err(|e| ShellError::io("", e.to_string()))
}

/// Decodes `encodeURIComponent` output: `%XX` escapes back to bytes, then UTF-8.
fn percent_decode(encoded: &str) -> Result<String, String> {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = encoded
                .get(i + 1..i + 3)
                .ok_or_else(|| format!("bad escape in {encoded}"))?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| format!("bad escape in {encoded}"))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| format!("path is not UTF-8: {e}"))
}

/// Prints `MARK <name> <epoch ms>` and, only when there is any, a trailing detail field.
/// The startup measurement parses these lines, so the two-field form must stay exact.
fn mark(name: &str, t: f64, data: Option<String>) {
    let detail = data.unwrap_or_default();
    let ms = t as i64;
    let mut out = std::io::stdout().lock();
    let _ = if detail.is_empty() {
        writeln!(out, "MARK {} {}", name, ms)
    } else {
        writeln!(out, "MARK {} {} {}", name, ms, detail)
    };
    let _ = out.flush();
}

/// Prints a mark and, in harness mode, runs the paint deadline off the marks themselves: `render` arms
/// it, and any mark that reports an outcome disarms it. Doing it here rather than from two extra
/// commands keeps the webview's measured path — script start to `first_text` — free of added IPC.
#[tauri::command]
fn mark_from_webview(app: tauri::AppHandle, name: String, t: f64, data: Option<String>) {
    mark(&name, t, data);
    if !quit_after_paint() {
        return;
    }
    match name.as_str() {
        "render" => arm_paint_deadline(app, begin_render()),
        // `no_paint` is also emitted from the webview when `#doc` is not visible: that is not a
        // paint, and it must disarm the deadline the same way a real paint does.
        "painted" | "no_text" | "error" | "no_paint" => settle_render(),
        _ => {}
    }
}

/// True when a harness launched us: the startup measurement sets the variable, and `--quit-after-paint`
/// is the same request made by hand.
fn quit_after_paint() -> bool {
    matches!(
        std::env::var("MARXY_QUIT_AFTER_PAINT").as_deref(),
        Ok("1") | Ok("true")
    ) || std::env::args_os().any(|a| a == "--quit-after-paint")
}

#[tauri::command]
fn startup_marks() -> serde_json::Value {
    serde_json::json!({ "quit_after_paint": quit_after_paint() })
}

struct WatchEntry {
    running: watch::RunningWatch,
    refs: u32,
}

fn watch_table() -> &'static Mutex<HashMap<String, WatchEntry>> {
    static TABLE: OnceLock<Mutex<HashMap<String, WatchEntry>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Every raw root string a `watch_root` call has used, mapped to the canonical key it resolved to
/// at that time. `unwatch_root` consults this when the root no longer canonicalises (deleted or
/// renamed since), so it can still find the table entry that was actually stored under the old
/// canonical path instead of a fresh, non-matching fallback string.
fn raw_watch_roots() -> &'static Mutex<HashMap<String, String>> {
    static TABLE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonical_watch_root(root: &str) -> Result<String, String> {
    let path = PathBuf::from(root);
    let canon = path.canonicalize().map_err(|e| format!("{root}: {e}"))?;
    Ok(canon.to_string_lossy().into_owned())
}

/// The watch-table key for `root`: its current canonical form, or, when it no longer canonicalises,
/// whatever canonical key a previous `watch_root(root)` call recorded for that exact raw string.
fn resolve_watch_key(raw_roots: &HashMap<String, String>, root: &str) -> String {
    canonical_watch_root(root).unwrap_or_else(|_| {
        raw_roots
            .get(root)
            .cloned()
            .unwrap_or_else(|| root.to_string())
    })
}

fn emit_fs_watch(app: &tauri::AppHandle, events: Vec<watch::WatchEvent>) {
    let payload: Vec<serde_json::Value> = events
        .iter()
        .map(|event| {
            let mut value = serde_json::json!({
                "kind": watch::watch_kind_name(event.kind),
                "path": event.path.to_string_lossy(),
            });
            if let Some(to) = &event.to {
                value["to"] = serde_json::Value::String(to.to_string_lossy().into_owned());
            }
            value
        })
        .collect();
    let _ = app.emit("fs-watch", payload);
}

/// Starts (or shares) one `notify` thread per canonical root; events go to `fs-watch`. Async, so
/// registering watches and joining a stopping thread run off the main thread.
#[tauri::command]
async fn watch_root(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let key = canonical_watch_root(&root)?;
    raw_watch_roots()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(root.clone(), key.clone());
    let mut table = watch_table().lock().map_err(|e| e.to_string())?;
    if let Some(entry) = table.get_mut(&key) {
        entry.refs += 1;
        return Ok(());
    }
    let app_handle = app.clone();
    let running = watch_notify::spawn_poll_thread(PathBuf::from(&key), move |events| {
        emit_fs_watch(&app_handle, events);
    })?;
    table.insert(key, WatchEntry { running, refs: 1 });
    Ok(())
}

#[tauri::command]
async fn unwatch_root(root: String) -> Result<(), String> {
    let key = {
        let raw_roots = raw_watch_roots().lock().map_err(|e| e.to_string())?;
        resolve_watch_key(&raw_roots, &root)
    };
    let mut table = watch_table().lock().map_err(|e| e.to_string())?;
    let entry = table
        .get_mut(&key)
        .ok_or_else(|| format!("not watching {root}"))?;
    entry.refs -= 1;
    if entry.refs == 0 {
        let mut entry = table.remove(&key).expect("entry");
        entry.running.stop();
        if let Ok(mut raw_roots) = raw_watch_roots().lock() {
            raw_roots.retain(|_, v| v != &key);
        }
    }
    Ok(())
}

/// Ends the process the one sanctioned way: Tauri's own teardown, then `exit(code)`.
/// `AppHandle::exit` is not enough — it ends the process with status 0 and never returns to
/// `main` — so the code is applied here. The `quit` command and the native menu's Quit and Close
/// Window items (MARXY-184; a closed window leaves nothing to open into, since Marxy is
/// single-window) all call this, so there is exactly one exit path.
fn quit_now(app: &tauri::AppHandle, code: i32) {
    app.cleanup_before_exit();
    std::process::exit(code);
}

/// Exits with `code`: 0 for a launch that rendered, non-zero for one that failed, so a harness
/// waiting on the process learns the difference instead of only timing out.
#[tauri::command]
fn quit(app: tauri::AppHandle, code: Option<i32>) {
    quit_now(&app, code.unwrap_or(0));
}

/// How long a harness launch may wait for a paint. Generous next to the 20-50 ms a real paint takes on
/// both platforms, and short enough that a machine which cannot paint at all is not a hang.
const PAINT_DEADLINE_MS: u64 = 2500;

/// Renders counted so far, and the one still owed a paint (0 when none is). Numbering the renders rather
/// than keeping a single reported flag is what makes a second document in the same process safe: without
/// it the flag left over from the first document silences the second document's deadline for good, and
/// with a flag merely reset per render the first document's thread, still sleeping, would wake up and end
/// the process on the second document's behalf. Neither failure shows up until something renders twice.
static RENDERS: AtomicU64 = AtomicU64::new(0);
static AWAITING_PAINT: AtomicU64 = AtomicU64::new(0);

/// A document has begun rendering; returns the render a deadline should be armed for.
fn begin_render() -> u64 {
    let render = RENDERS.fetch_add(1, Ordering::SeqCst) + 1;
    AWAITING_PAINT.store(render, Ordering::SeqCst);
    render
}

/// The render in flight reported its outcome, so nothing is owed a paint.
fn settle_render() {
    AWAITING_PAINT.store(0, Ordering::SeqCst);
}

/// True while `render` is the one still waiting: an outcome or a newer render both retire a deadline.
fn deadline_is_current(render: u64) -> bool {
    AWAITING_PAINT.load(Ordering::SeqCst) == render
}

/// Bounds a harness launch's wait for a paint from outside the webview, because inside it there is no
/// such thing as a deadline: WebKit aligns timers in a window that cannot paint to about 15 s, which is
/// the very state this guards against (a display asleep or in dark wake delivers no animation frames).
/// This thread is not throttled. Only a harness arms it; a reader keeps waiting and gets the document
/// when the display wakes.
fn arm_paint_deadline(app: tauri::AppHandle, render: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(PAINT_DEADLINE_MS));
        if deadline_is_current(render) {
            // No `first_text`: nothing was painted, so there is no cold start to report.
            mark(
                "no_paint",
                now_ms(),
                Some(format!("deadline_ms={PAINT_DEADLINE_MS}")),
            );
            app.cleanup_before_exit();
            std::process::exit(1);
        }
    });
}

/// Absolute paths for `onOpenFiles`: skip flags and the macOS `-psn_…` launcher token.
fn document_paths_from_argv(argv: &[String], cwd: &str) -> Vec<String> {
    let base = Path::new(cwd);
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| absolute_document_path(base, a))
        .collect()
}

/// The reader window never navigates away from the app: a link in a document is not a way to load a
/// remote page (or a relative path) into the window that shows it. Links are the app's to follow.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("marxy-navigation")
        .on_navigation(|_, url| navigation_allowed(url))
        .build()
}

fn navigation_allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost") | Some("tauri.localhost") | Some("127.0.0.1")
        ),
        _ => false,
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn pending_opens_table() -> &'static Mutex<Vec<Vec<String>>> {
    static TABLE: OnceLock<Mutex<Vec<Vec<String>>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(Vec::new()))
}

/// After the webview drains with `take_pending_opens`, later opens emit live; until then they queue.
static OPENS_LISTENER_READY: AtomicBool = AtomicBool::new(false);

fn enqueue_open_files(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = pending_opens_table().lock() {
        pending.push(paths);
    }
}

fn deliver_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    focus_main_window(app);
    if OPENS_LISTENER_READY.load(Ordering::SeqCst) {
        let _ = app.emit("marxy:open-files", paths);
    } else {
        enqueue_open_files(paths);
    }
}

/// Returns every open batch queued before the page listened, then clears the queue (MARXY-252).
#[tauri::command]
fn take_pending_opens() -> Vec<Vec<String>> {
    OPENS_LISTENER_READY.store(true, Ordering::SeqCst);
    pending_opens_table()
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

/// The deadline's state machine, checkable from outside: `marxy --paint-deadline-selftest` runs these
/// cases and exits 0 or 1. It lives in the binary rather than in a `#[cfg(test)]` module because
/// compiling a test harness for the Tauri dependency tree cost CI minutes for four assertions, while
/// this costs the launch of an already-built binary.
fn paint_deadline_selftest() -> i32 {
    let mut failed: Vec<&str> = Vec::new();
    let first = begin_render();
    if !deadline_is_current(first) {
        failed.push("a render that has not reported yet is still owed a paint");
    }
    settle_render();
    if deadline_is_current(first) {
        failed.push("a render that reported its paint is owed nothing");
    }
    // Fails if a render does not start a new wait: the first document's outcome would still be on
    // record, the second document's deadline would never fire, and a launch that cannot paint would
    // hang again — silently, because only a second render reveals it.
    let second = begin_render();
    if !deadline_is_current(second) {
        failed.push("a second document must get a deadline of its own");
    }
    // Fails if that reset is a plain flag: the first document's thread is still sleeping, and waking to
    // find "not reported" it would end the process over a paint that already happened.
    if deadline_is_current(first) {
        failed.push("a retired deadline must not fire against a later render");
    }
    for case in &failed {
        println!("paint-deadline selftest failed: {case}");
    }
    if failed.is_empty() {
        println!("paint-deadline selftest ok: 4 cases");
        0
    } else {
        1
    }
}

/// The extensions "Open File…" offers, matching the documents `marxy` already knows how to open:
/// the markdown kinds `packages/core/src/index-model/kinds.ts` and
/// `apps/desktop/src-tauri/src/index/mod.rs` recognise, plus `txt` (the other extension
/// `apps/desktop/src/source/default-mode.ts` defaults to Rendered mode).
#[cfg(target_os = "macos")]
const DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx", "txt"];

/// The native menu: the smallest set a Mac reader already expects (App/File/Edit/Window), with no
/// document-specific command (ADR-0011 — the palette is the tab manager, not this menu). `MENU` is
/// the whole menu as data: `build_app_menu` builds exactly what it lists and `action_for` is the
/// only way a click turns into work, so the test below checks the menu a reader gets, not a copy.
#[cfg(target_os = "macos")]
mod app_menu {
    /// An item the OS implements itself (AppKit responder selectors), so it carries no marxy id.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Native {
        About,
        Services,
        Hide,
        HideOthers,
        ShowAll,
        Undo,
        Redo,
        Cut,
        Copy,
        Paste,
        SelectAll,
        Minimize,
        Zoom,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Entry {
        /// One of marxy's own items: id, label, accelerator.
        Own(&'static str, &'static str, &'static str),
        Native(Native),
        Separator,
    }

    /// What a click on one of marxy's own items does.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Action {
        Quit,
        CloseWindow,
        OpenFile,
    }

    impl Action {
        /// Quit and Close Window both ask the webview first, so a dirty document gets its notice
        /// (ADR-0041, MARXY-337); only the webview's confirmation ends the window.
        pub fn asks_the_webview_first(self) -> bool {
            matches!(self, Action::Quit | Action::CloseWindow)
        }
    }

    pub const QUIT: &str = "marxy-quit";
    pub const OPEN_FILE: &str = "marxy-open-file";
    pub const CLOSE_WINDOW: &str = "marxy-close-window";

    use Entry::{Native as N, Own, Separator};
    use Native::*;

    pub const MENU: &[(&str, &[Entry])] = &[
        (
            "Marxy",
            &[
                N(About),
                Separator,
                N(Services),
                Separator,
                N(Hide),
                N(HideOthers),
                N(ShowAll),
                Separator,
                Own(QUIT, "Quit Marxy", "CmdOrCtrl+Q"),
            ],
        ),
        (
            "File",
            &[
                Own(OPEN_FILE, "Open File…", "CmdOrCtrl+O"),
                Separator,
                // Not the predefined close_window: Marxy is single-window, so closing the one
                // window leaves nothing to open into and is the same as quitting (see `quit_now`).
                Own(CLOSE_WINDOW, "Close Window", "CmdOrCtrl+W"),
            ],
        ),
        (
            "Edit",
            &[
                N(Undo),
                N(Redo),
                Separator,
                N(Cut),
                N(Copy),
                N(Paste),
                N(SelectAll),
            ],
        ),
        ("Window", &[N(Minimize), N(Zoom)]),
    ];

    pub fn action_for(id: &str) -> Option<Action> {
        match id {
            QUIT => Some(Action::Quit),
            CLOSE_WINDOW => Some(Action::CloseWindow),
            OPEN_FILE => Some(Action::OpenFile),
            _ => None,
        }
    }
}

/// Builds the macOS app menu from `app_menu::MENU`, item for item.
#[cfg(target_os = "macos")]
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use app_menu::{Entry, Native};
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let menu = Menu::new(app)?;
    for (title, entries) in app_menu::MENU {
        let submenu = Submenu::new(app, *title, true)?;
        for entry in *entries {
            match *entry {
                Entry::Own(id, label, accelerator) => {
                    submenu.append(&MenuItem::with_id(app, id, label, true, Some(accelerator))?)?
                }
                Entry::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
                Entry::Native(native) => submenu.append(&match native {
                    Native::About => PredefinedMenuItem::about(app, None, None)?,
                    Native::Services => PredefinedMenuItem::services(app, None)?,
                    Native::Hide => PredefinedMenuItem::hide(app, None)?,
                    Native::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
                    Native::ShowAll => PredefinedMenuItem::show_all(app, None)?,
                    Native::Undo => PredefinedMenuItem::undo(app, None)?,
                    Native::Redo => PredefinedMenuItem::redo(app, None)?,
                    Native::Cut => PredefinedMenuItem::cut(app, None)?,
                    Native::Copy => PredefinedMenuItem::copy(app, None)?,
                    Native::Paste => PredefinedMenuItem::paste(app, None)?,
                    Native::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                    Native::Minimize => PredefinedMenuItem::minimize(app, None)?,
                    Native::Zoom => PredefinedMenuItem::maximize(app, None)?,
                })?,
            }
        }
        menu.append(&submenu)?;
    }
    Ok(menu)
}

/// "Open File…": the native picker, filtered to the documents `marxy` opens. Non-blocking
/// (`pick_file`'s callback runs off the main thread's event loop turn), so the menu action returns
/// immediately and the chosen path arrives through the same `marxy:open-files` event a second
/// launch or a Finder "Open With" would emit (`emit_open_files`, MARXY-183).
#[cfg(target_os = "macos")]
fn open_file_via_dialog(app: tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Markdown", DOCUMENT_EXTENSIONS)
        .pick_file(move |file| {
            let Some(file) = file else { return };
            let Some(path) = file
                .into_path()
                .ok()
                .and_then(|p| p.to_str().map(String::from))
            else {
                return;
            };
            deliver_open_files(&app, vec![path]);
        });
}

/// Two close requests this close together are the reader asking twice (a double Cmd+Q, a second
/// click on the close button). The webview treats the second as "discard" when it is listening; when
/// it is not (crashed, hung, not yet loaded) nothing else could end the app, so the shell does.
const REPEATED_CLOSE_MS: u64 = 1500;

/// What a close request does: ask the webview, or, when it repeats one still fresh, quit.
#[derive(Debug, PartialEq, Eq)]
enum CloseRequest {
    AskWebview,
    QuitNow,
}

/// Pure decision: `previous_ms` is when the last request arrived, `now_ms` when this one did.
fn close_request_decision(previous_ms: Option<u64>, now_ms: u64) -> CloseRequest {
    match previous_ms {
        Some(previous) if now_ms.saturating_sub(previous) <= REPEATED_CLOSE_MS => {
            CloseRequest::QuitNow
        }
        _ => CloseRequest::AskWebview,
    }
}

static LAST_CLOSE_REQUEST_MS: Mutex<Option<u64>> = Mutex::new(None);

/// The one path every close request takes (window close box, Cmd+W, Cmd+Q): the webview decides
/// whether a dirty document must be answered first, unless the request repeats one still fresh.
fn request_close_of_main(app: &tauri::AppHandle) {
    let now = now_ms() as u64;
    let previous = LAST_CLOSE_REQUEST_MS
        .lock()
        .map(|mut last| last.replace(now))
        .unwrap_or(None);
    match (
        close_request_decision(previous, now),
        app.get_webview_window("main"),
    ) {
        (CloseRequest::AskWebview, Some(window)) => {
            let _ = window.emit("marxy:close-requested", ());
        }
        // A repeat, or no window to ask: the reader has asked twice, or there is nothing to protect.
        _ => quit_now(app, 0),
    }
}

/// The menu's Quit and Close Window go through the same request a click on the window's close button
/// makes.
#[cfg(target_os = "macos")]
fn request_close(app: &tauri::AppHandle) {
    request_close_of_main(app);
}

#[cfg(target_os = "macos")]
fn on_app_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match app_menu::action_for(event.id().as_ref()) {
        Some(action) if action.asks_the_webview_first() => request_close(app),
        Some(app_menu::Action::OpenFile) => open_file_via_dialog(app.clone()),
        _ => {}
    }
}

fn main() {
    if std::env::args_os().any(|a| a == "--paint-deadline-selftest") {
        std::process::exit(paint_deadline_selftest());
    }
    mark("main_start", now_ms(), None);
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(navigation_guard())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            deliver_open_files(app, document_paths_from_argv(&argv, &cwd));
        }));
    // Only "Open File…" (the macOS menu) calls the dialog plugin; the webview never does, so no
    // capability is added for it (docs/design/06-shell.md §Capabilities).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .plugin(tauri_plugin_dialog::init())
            .on_menu_event(on_app_menu_event);
    }
    builder
        .setup(|_app| {
            if _app.webview_windows().values().next().is_some() {
                mark("window_shown", now_ms(), None);
            }
            #[cfg(target_os = "macos")]
            _app.set_menu(build_app_menu(_app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            args,
            read_file,
            write_file_atomic,
            set_title,
            save_dialog,
            close_confirmed,
            mark_from_webview,
            startup_marks,
            quit,
            watch_root,
            unwatch_root,
            commands::fs::image_size,
            commands::fs::allow_asset_scope,
            config_paths,
            commands::fs::read_dir,
            clipboard_write,
            take_pending_opens,
            commands::os::open_external,
        ])
        .build(tauri::generate_context!())
        .expect("error while building marxy")
        .run(|app, event| {
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                api.prevent_close();
                if label == "main" {
                    request_close_of_main(app);
                } else if let Some(window) = app.get_webview_window(label) {
                    let _ = window.emit("marxy:close-requested", ());
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter(|url| url.scheme() == "file")
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(|p| {
                        p.to_str()
                            .and_then(|s| absolute_document_path(Path::new("/"), s))
                    })
                    .collect();
                deliver_open_files(app, paths);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::ClipboardPayload;
    use super::{
        absolute_document_path, clipboard_payload, enqueue_open_files, navigation_allowed,
        percent_decode, resolve_watch_key, take_pending_opens, OPENS_LISTENER_READY,
    };
    use std::collections::HashMap;
    use std::sync::atomic::Ordering;

    #[test]
    fn a_repeated_close_request_quits_and_a_first_or_stale_one_asks_the_webview() {
        use super::{close_request_decision, CloseRequest, REPEATED_CLOSE_MS};
        assert_eq!(
            close_request_decision(None, 10_000),
            CloseRequest::AskWebview
        );
        assert_eq!(
            close_request_decision(Some(10_000), 10_000 + REPEATED_CLOSE_MS),
            CloseRequest::QuitNow,
            "a second Cmd+Q right behind the first ends the app"
        );
        assert_eq!(
            close_request_decision(Some(10_000), 10_000 + REPEATED_CLOSE_MS + 1),
            CloseRequest::AskWebview,
            "a request long after the last one is a new question, not a repeat"
        );
    }

    fn reset_pending_opens_for_test() {
        OPENS_LISTENER_READY.store(false, Ordering::SeqCst);
        let _ = take_pending_opens();
        OPENS_LISTENER_READY.store(false, Ordering::SeqCst);
    }

    #[test]
    fn copy_with_html_is_one_write_that_keeps_the_plain_text() {
        assert_eq!(
            clipboard_payload("plain".into(), Some("<b>plain</b>".into())),
            ClipboardPayload::Html {
                html: "<b>plain</b>".into(),
                alt: "plain".into()
            }
        );
        assert_eq!(
            clipboard_payload("plain".into(), None),
            ClipboardPayload::Text("plain".into())
        );
    }

    #[test]
    fn an_open_before_the_webview_listens_is_queued_once() {
        reset_pending_opens_for_test();
        enqueue_open_files(vec!["/tmp/a.md".into()]);
        let first = take_pending_opens();
        assert_eq!(first, vec![vec!["/tmp/a.md".to_string()]]);
        assert!(take_pending_opens().is_empty());
    }

    #[test]
    fn resolve_watch_key_falls_back_to_the_recorded_canonical_key_when_the_root_is_gone() {
        let mut raw_roots = HashMap::new();
        raw_roots.insert(
            "/no/such/deleted-marxy-root".to_string(),
            "/real/canonical/path".to_string(),
        );
        // Without a recording, an unresolvable root used to fall back to the raw string itself,
        // which is not the key `watch_root` actually stored the entry under.
        assert_eq!(
            resolve_watch_key(&raw_roots, "/no/such/deleted-marxy-root"),
            "/real/canonical/path",
        );
    }

    #[test]
    fn resolve_watch_key_with_no_recording_falls_back_to_the_raw_root() {
        let raw_roots = HashMap::new();
        assert_eq!(
            resolve_watch_key(&raw_roots, "/no/such/never-watched-marxy-root"),
            "/no/such/never-watched-marxy-root",
        );
    }

    #[test]
    fn the_window_navigates_only_within_the_app() {
        for ok in [
            "tauri://localhost/index.html",
            "http://localhost:1420/",
            "https://tauri.localhost/",
        ] {
            assert!(navigation_allowed(&ok.parse().unwrap()), "{ok}");
        }
        for no in [
            "https://example.org/",
            "http://evil.localhost.example/",
            "file:///etc/passwd",
        ] {
            assert!(!navigation_allowed(&no.parse().unwrap()), "{no}");
        }
    }

    #[test]
    fn a_relative_document_path_is_made_absolute_against_the_launch_directory() {
        let dir = std::env::temp_dir().canonicalize().unwrap();
        let file = dir.join(format!("marxy-args-{}.md", std::process::id()));
        std::fs::write(&file, b"# x\n").unwrap();
        let name = file.file_name().unwrap().to_str().unwrap();
        assert_eq!(absolute_document_path(&dir, name).as_deref(), file.to_str());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn percent_decode_undoes_encode_uri_component() {
        // encodeURIComponent("/Users/a b/résumé #1.md")
        assert_eq!(
            percent_decode("%2FUsers%2Fa%20b%2Fr%C3%A9sum%C3%A9%20%231.md").unwrap(),
            "/Users/a b/résumé #1.md"
        );
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%2").is_err());
        assert!(
            percent_decode("%FF").is_err(),
            "a path that is not UTF-8 is refused, not guessed at"
        );
    }

    /// A real `Menu` needs a running app on the main thread, so this walks `app_menu::MENU`, the
    /// table `build_app_menu` builds from item for item (MARXY-184 criterion 4). It fails if an item
    /// of marxy's own is added — Save, a view mode, an operation — or if one has no action, and if
    /// Edit stops being the OS's own items.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_native_menu_carries_only_the_expected_items() {
        use super::app_menu::{action_for, Action, Entry, CLOSE_WINDOW, MENU, OPEN_FILE, QUIT};

        let titles: Vec<&str> = MENU.iter().map(|(title, _)| *title).collect();
        assert_eq!(titles, ["Marxy", "File", "Edit", "Window"]);

        let own: Vec<(&str, &str)> = MENU
            .iter()
            .flat_map(|(_, entries)| entries.iter())
            .filter_map(|entry| match entry {
                Entry::Own(id, _, accelerator) => Some((*id, *accelerator)),
                _ => None,
            })
            .collect();
        assert_eq!(
            own,
            [
                (QUIT, "CmdOrCtrl+Q"),
                (OPEN_FILE, "CmdOrCtrl+O"),
                (CLOSE_WINDOW, "CmdOrCtrl+W")
            ],
            "the menu's own items are Quit, Open File… and Close Window, and nothing else"
        );
        assert_eq!(action_for(QUIT), Some(Action::Quit));
        assert_eq!(action_for(CLOSE_WINDOW), Some(Action::CloseWindow));
        assert!(
            action_for(QUIT).unwrap().asks_the_webview_first()
                && action_for(CLOSE_WINDOW).unwrap().asks_the_webview_first(),
            "Cmd+Q and Cmd+W go through the close guard, never straight to exit"
        );
        assert!(!Action::OpenFile.asks_the_webview_first());
        assert_eq!(action_for(OPEN_FILE), Some(Action::OpenFile));
        assert_eq!(action_for("marxy-save"), None);

        let (_, edit) = MENU.iter().find(|(title, _)| *title == "Edit").unwrap();
        assert!(
            edit.iter().all(|entry| !matches!(entry, Entry::Own(..))),
            "Edit is the OS's own items, never hand-built ones"
        );
    }
}
