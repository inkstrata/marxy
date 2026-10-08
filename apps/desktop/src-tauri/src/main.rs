//! marxy desktop shell. Everything privileged lives here behind the shell-api contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod atomic_write;
mod commands;
mod error;
mod watch;
#[path = "watch/spawn_notify.rs"]
mod watch_notify;
#[path = "watch/tree.rs"]
mod watch_tree;

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
///
/// Lock order: the watch table, then this. A recording is added and dropped with the table lock held,
/// in the same step as the entry it belongs to, so a watch registered while an older one for the same
/// key is still stopping keeps its recording (C-11.1).
fn raw_watch_roots() -> &'static Mutex<HashMap<String, String>> {
    static TABLE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

type WatchTable = Mutex<HashMap<String, WatchEntry>>;
type RawRoots = Mutex<HashMap<String, String>>;

/// Share the running watch under `key` if there is one: one more reference, and `raw_key` recorded.
fn share_watch(
    table: &WatchTable,
    raw_roots: &RawRoots,
    raw_key: &str,
    key: &str,
) -> Result<bool, String> {
    let mut table = table.lock().map_err(|e| e.to_string())?;
    let Some(entry) = table.get_mut(key) else {
        return Ok(false);
    };
    entry.refs += 1;
    raw_roots
        .lock()
        .map_err(|e| e.to_string())?
        .insert(raw_key.to_string(), key.to_string());
    Ok(true)
}

/// Install a watch that was started without the table locked. When another call installed one for
/// `key` meanwhile, theirs is shared and `running` is handed back to be stopped.
fn install_watch(
    table: &WatchTable,
    raw_roots: &RawRoots,
    raw_key: &str,
    key: &str,
    running: watch::RunningWatch,
) -> Result<Option<watch::RunningWatch>, String> {
    let mut table = table.lock().map_err(|e| e.to_string())?;
    let spare = match table.get_mut(key) {
        Some(entry) => {
            entry.refs += 1;
            Some(running)
        }
        None => {
            table.insert(key.to_string(), WatchEntry { running, refs: 1 });
            None
        }
    };
    raw_roots
        .lock()
        .map_err(|e| e.to_string())?
        .insert(raw_key.to_string(), key.to_string());
    Ok(spare)
}

/// Let go of one reference to the watch under `key`. The last one removes the entry and every
/// recording that points at it, both under the table lock, then hands the entry to `stop` with no
/// lock held (stopping joins a thread). Dropping the recordings after the stop instead would also
/// drop one made by a watch registered in between.
fn release_watch(
    table: &WatchTable,
    raw_roots: &RawRoots,
    key: &str,
    what: &str,
    stop: impl FnOnce(WatchEntry),
) -> Result<(), String> {
    let entry = {
        let mut table = table.lock().map_err(|e| e.to_string())?;
        let entry = table
            .get_mut(key)
            .ok_or_else(|| format!("not watching {what}"))?;
        entry.refs -= 1;
        if entry.refs > 0 {
            return Ok(());
        }
        let entry = table.remove(key).expect("entry");
        if let Ok(mut raw_roots) = raw_roots.lock() {
            raw_roots.retain(|_, v| v != key);
        }
        entry
    };
    stop(entry);
    Ok(())
}

/// A watch that ended itself (a tree past its limit): take its entry and recordings out, so a later
/// `watch_root` of the same tree starts a fresh watch rather than sharing one that never fires. The
/// thread is already leaving, so nothing is joined; a later `unwatch_root` of it finds no entry.
fn forget_watch(table: &WatchTable, raw_roots: &RawRoots, key: &str) {
    if let Ok(mut table) = table.lock() {
        table.remove(key);
        if let Ok(mut raw_roots) = raw_roots.lock() {
            raw_roots.retain(|_, v| v != key);
        }
    }
}

fn canonical_watch_root(root: &str) -> Result<String, String> {
    let path = PathBuf::from(root);
    let canon = path.canonicalize().map_err(|e| format!("{root}: {e}"))?;
    Ok(canon.to_string_lossy().into_owned())
}

/// Appended to a tree watch's table key, so a tree watch and a folder watch of the same directory
/// never share a thread (C-05). A NUL cannot occur in a path, so no folder key ever ends this way.
const TREE_KEY_SUFFIX: &str = "\u{0}tree";

/// The table key for a watch of `canonical`: the path itself for a folder, the path and the suffix
/// for a tree. Also the key of the `raw_watch_roots` recording for a raw root string.
fn watch_table_key(canonical: &str, recursive: bool) -> String {
    if recursive {
        format!("{canonical}{TREE_KEY_SUFFIX}")
    } else {
        canonical.to_string()
    }
}

/// The watch-table key for `root`: its current canonical form, or, when it no longer canonicalises,
/// whatever canonical key a previous `watch_root(root)` call recorded for that exact raw string.
#[cfg(test)]
fn resolve_watch_key(raw_roots: &HashMap<String, String>, root: &str) -> String {
    resolve_table_key(raw_roots, root, false)
}

/// `resolve_watch_key` for a folder or a tree watch: the same resolution, under that kind's key.
fn resolve_table_key(raw_roots: &HashMap<String, String>, root: &str, recursive: bool) -> String {
    match canonical_watch_root(root) {
        Ok(canonical) => watch_table_key(&canonical, recursive),
        Err(_) => raw_roots
            .get(&watch_table_key(root, recursive))
            .cloned()
            .unwrap_or_else(|| watch_table_key(root, recursive)),
    }
}

/// `resolve_table_key` for a root the webview names in `unwatch_root`. A path holds no NUL, so one
/// that does is refused: `X\0tree` would otherwise find the recording of a tree watch of `X` and
/// release it from a call that named a folder.
fn unwatch_key(
    raw_roots: &HashMap<String, String>,
    root: &str,
    recursive: bool,
) -> Result<String, String> {
    if root.contains('\u{0}') {
        return Err("not a path: contains a NUL".to_string());
    }
    Ok(resolve_table_key(raw_roots, root, recursive))
}

/// One `fs-watch` payload: the table key of the watch that saw the batch, and its events. Every
/// watcher in the webview listens on the one channel and keeps only its own key's.
fn fs_watch_payload(key: &str, events: &[watch::WatchEvent]) -> serde_json::Value {
    let events: Vec<serde_json::Value> = events
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
    serde_json::json!({ "key": key, "events": events })
}

/// The `fs-watch` payload of a tree watch that ended after it opened (it outgrew its limit): no
/// events, and the reason. The webview treats the watch as refused.
fn fs_watch_refusal_payload(key: &str, reason: &str) -> serde_json::Value {
    serde_json::json!({ "key": key, "events": [], "refused": reason })
}

fn emit_fs_watch(app: &tauri::AppHandle, key: &str, events: Vec<watch::WatchEvent>) {
    let _ = app.emit("fs-watch", fs_watch_payload(key, &events));
}

/// Starts (or shares) one `notify` thread per table key and returns the key; events go to
/// `fs-watch` tagged with it. A folder watch (the default) sees the folder's own files; a
/// `recursive` watch sees the tree. Async, so registering watches, scanning a tree and joining a
/// stopping thread run off the main thread; the table is not locked while a tree is scanned.
#[tauri::command]
async fn watch_root(
    app: tauri::AppHandle,
    root: String,
    recursive: Option<bool>,
) -> Result<String, String> {
    let recursive = recursive.unwrap_or(false);
    let canonical = canonical_watch_root(&root)?;
    let key = watch_table_key(&canonical, recursive);
    let raw_key = watch_table_key(&root, recursive);
    if share_watch(watch_table(), raw_watch_roots(), &raw_key, &key)? {
        return Ok(key);
    }
    let app_handle = app.clone();
    let emit_key = key.clone();
    let emit = move |events| emit_fs_watch(&app_handle, &emit_key, events);
    let running = if recursive {
        let app_handle = app.clone();
        let refuse_key = key.clone();
        let refuse = move |reason: String| {
            forget_watch(watch_table(), raw_watch_roots(), &refuse_key);
            let _ = app_handle.emit("fs-watch", fs_watch_refusal_payload(&refuse_key, &reason));
        };
        watch_notify::spawn_tree_thread(PathBuf::from(&canonical), emit, refuse)?
    } else {
        watch_notify::spawn_poll_thread(PathBuf::from(&canonical), emit)?
    };
    // Another call may have started the same watch while this one scanned: share theirs.
    if let Some(mut spare) =
        install_watch(watch_table(), raw_watch_roots(), &raw_key, &key, running)?
    {
        spare.stop();
    }
    Ok(key)
}

#[tauri::command]
async fn unwatch_root(root: String, recursive: Option<bool>) -> Result<(), String> {
    let key = {
        let raw_roots = raw_watch_roots().lock().map_err(|e| e.to_string())?;
        unwatch_key(&raw_roots, &root, recursive.unwrap_or(false))?
    };
    release_watch(
        watch_table(),
        raw_watch_roots(),
        &key,
        &root,
        |mut entry| entry.running.stop(),
    )
}

/// Ends the process the one sanctioned way: Tauri's own teardown, then `exit(code)`.
/// `AppHandle::exit` is not enough — it ends the process with status 0 and never returns to
/// `main` — so the code is applied here. The `quit` command and the native menu's Quit and Close
/// Window items (MARXY-184; a closed window leaves nothing to open into, since Marxy is
/// single-window) all call this, so there is exactly one exit path.
///
/// A harness launch (`quit_after_paint`) prints `MARK quit code=<n>` first, so a launch that stalls
/// on the way out says whether it stalled before asking to quit or after, and then leaves through
/// `harness_exit`.
fn quit_now(app: &tauri::AppHandle, code: i32) {
    let harness = quit_after_paint();
    if harness {
        mark("quit", now_ms(), Some(format!("code={code}")));
    }
    app.cleanup_before_exit();
    if harness {
        harness_exit(code);
    }
    std::process::exit(code);
}

/// How a harness launch ends once its code is decided and printed: `_exit(2)`, which skips the C
/// `atexit` handlers that `exit(3)` runs. Those belong to GTK, WebKitGTK, GLib and Mesa, not to Marxy,
/// and they are the one part of the way out that this program does not control; a smoke launch on
/// Linux once painted, reported, and then never exited (CI run 37040073668). Nothing is lost: every
/// mark is flushed as it is written, persistence was flushed by the webview before it asked to quit,
/// and Tauri's own teardown has already run. A reader's quit keeps the ordinary `exit(3)`.
fn harness_exit(code: i32) -> ! {
    #[cfg(unix)]
    {
        extern "C" {
            fn _exit(status: i32) -> !;
        }
        // SAFETY: `_exit` takes any status and never returns; nothing is left to run in this process.
        unsafe { _exit(code) }
    }
    #[cfg(not(unix))]
    std::process::exit(code)
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
            harness_exit(1);
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

/// The files of a drop onto the window, for `onOpenFiles`: existing regular files only, made absolute
/// and canonical the way a second launch's paths are. A folder or a path that is gone opens nothing.
fn document_paths_from_drop(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| p.is_file())
        .filter_map(|p| p.to_str())
        .filter_map(|p| absolute_document_path(Path::new("/"), p))
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
/// the markdown kinds `packages/core/src/index-model/kinds.ts` recognises, plus `txt` (the other extension
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
        /// A reader-facing command the webview already implements for its key chord; the click
        /// only carries the menu id to it (`marxy:menu`), so the key and the menu cannot disagree.
        ToWebview,
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
    pub const OPEN_QUICKLY: &str = "marxy-open-quickly";
    pub const TOGGLE_SOURCE: &str = "marxy-toggle-source";
    pub const GO_BACK: &str = "marxy-go-back";
    pub const GO_FORWARD: &str = "marxy-go-forward";

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
        (
            "View",
            &[Own(
                TOGGLE_SOURCE,
                "Toggle Rendered / Source",
                "CmdOrCtrl+E",
            )],
        ),
        (
            "Go",
            &[
                Own(GO_BACK, "Back", "CmdOrCtrl+["),
                Own(GO_FORWARD, "Forward", "CmdOrCtrl+]"),
                Separator,
                Own(OPEN_QUICKLY, "Open Quickly…", "CmdOrCtrl+P"),
            ],
        ),
        ("Window", &[N(Minimize), N(Zoom)]),
    ];

    pub fn action_for(id: &str) -> Option<Action> {
        match id {
            QUIT => Some(Action::Quit),
            CLOSE_WINDOW => Some(Action::CloseWindow),
            OPEN_FILE => Some(Action::OpenFile),
            OPEN_QUICKLY | TOGGLE_SOURCE | GO_BACK | GO_FORWARD => Some(Action::ToWebview),
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
        Some(app_menu::Action::ToWebview) => {
            let _ = app.emit("marxy:menu", event.id().as_ref());
        }
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
        builder = builder.on_menu_event(on_app_menu_event);
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
            commands::os::reveal_in_editor,
            commands::search::search_content,
            commands::search::cancel_content_search,
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
            // A file dropped on the window opens the way Finder or a second launch opens it (A-16).
            if let RunEvent::WindowEvent {
                event: WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
                ..
            } = &event
            {
                deliver_open_files(app, document_paths_from_drop(paths));
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
        absolute_document_path, clipboard_payload, document_paths_from_drop, enqueue_open_files,
        navigation_allowed, percent_decode, resolve_watch_key, take_pending_opens,
        OPENS_LISTENER_READY,
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
    fn a_tree_watch_and_a_folder_watch_of_one_directory_have_different_keys() {
        use super::{resolve_table_key, watch_table_key};
        let dir = std::env::temp_dir();
        let raw_roots = HashMap::new();
        let folder = resolve_table_key(&raw_roots, &dir.to_string_lossy(), false);
        let tree = resolve_table_key(&raw_roots, &dir.to_string_lossy(), true);
        assert_ne!(folder, tree);
        assert_eq!(tree, watch_table_key(&folder, true));
        assert_eq!(
            folder,
            resolve_watch_key(&raw_roots, &dir.to_string_lossy())
        );
        let mut raw_roots = HashMap::new();
        raw_roots.insert(
            watch_table_key("/no/such/deleted-marxy-tree", true),
            watch_table_key("/real/tree", true),
        );
        assert_eq!(
            resolve_table_key(&raw_roots, "/no/such/deleted-marxy-tree", true),
            watch_table_key("/real/tree", true),
        );
        assert_eq!(
            resolve_table_key(&raw_roots, "/no/such/deleted-marxy-tree", false),
            "/no/such/deleted-marxy-tree",
            "a gone tree's recording does not resolve a folder watch",
        );
    }

    fn idle_watch_entry(refs: u32) -> super::WatchEntry {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;
        super::WatchEntry {
            running: crate::watch::RunningWatch::new(
                Arc::new(AtomicBool::new(false)),
                std::thread::spawn(|| {}),
            ),
            refs,
        }
    }

    #[test]
    fn unwatch_refuses_a_root_with_a_nul_so_it_cannot_name_a_tree_watchs_key() {
        use super::{unwatch_key, watch_table_key};
        let mut raw_roots = HashMap::new();
        raw_roots.insert(
            watch_table_key("/no/such/deleted-marxy-tree", true),
            watch_table_key("/real/tree", true),
        );
        // The tree watch's own raw root resolves to its key...
        assert_eq!(
            unwatch_key(&raw_roots, "/no/such/deleted-marxy-tree", true),
            Ok(watch_table_key("/real/tree", true)),
        );
        // ...and the same string with the suffix typed out by hand, as a folder, does not.
        let forged = format!("/no/such/deleted-marxy-tree{}", super::TREE_KEY_SUFFIX);
        assert!(unwatch_key(&raw_roots, &forged, false).is_err());
        assert!(unwatch_key(&raw_roots, &forged, true).is_err());
        assert!(unwatch_key(&raw_roots, "/a\0b", false).is_err());
    }

    #[test]
    fn the_last_unwatch_drops_its_recordings_before_the_stop_so_a_new_watch_keeps_its_own() {
        use super::{install_watch, release_watch, share_watch};
        use std::sync::Mutex;
        let table = Mutex::new(HashMap::new());
        let raw_roots = Mutex::new(HashMap::new());
        let running = idle_watch_entry(1).running;
        assert!(
            install_watch(&table, &raw_roots, "/link/tree", "/real/tree", running)
                .expect("install")
                .is_none()
        );
        assert!(share_watch(&table, &raw_roots, "/other/tree", "/real/tree").expect("share"));
        release_watch(&table, &raw_roots, "/real/tree", "x", |_| {
            panic!("one still holds it")
        })
        .expect("first release");
        assert_eq!(
            raw_roots.lock().unwrap().len(),
            2,
            "still held, still recorded"
        );
        let mut stopped = 0;
        release_watch(&table, &raw_roots, "/real/tree", "x", |mut entry| {
            // While the old thread stops, the same tree is watched again.
            let running = idle_watch_entry(1).running;
            assert!(
                install_watch(&table, &raw_roots, "/link/tree", "/real/tree", running)
                    .expect("install again")
                    .is_none()
            );
            entry.running.stop();
            stopped += 1;
        })
        .expect("last release");
        assert_eq!(stopped, 1);
        assert_eq!(
            raw_roots
                .lock()
                .unwrap()
                .get("/link/tree")
                .map(String::as_str),
            Some("/real/tree"),
            "the new watch's recording survived the old one's stop",
        );
        assert!(
            !raw_roots.lock().unwrap().contains_key("/other/tree"),
            "the old watch's other recording went with it",
        );
        assert!(table.lock().unwrap().contains_key("/real/tree"));
    }

    #[test]
    fn a_watch_that_ended_itself_leaves_no_entry_for_a_later_call_to_share() {
        use super::{forget_watch, install_watch, share_watch};
        use std::sync::Mutex;
        let table = Mutex::new(HashMap::new());
        let raw_roots = Mutex::new(HashMap::new());
        let running = idle_watch_entry(1).running;
        install_watch(&table, &raw_roots, "/t", "/t\u{0}tree", running).expect("install");
        forget_watch(&table, &raw_roots, "/t\u{0}tree");
        assert!(!share_watch(&table, &raw_roots, "/t", "/t\u{0}tree").expect("share"));
        assert!(raw_roots.lock().unwrap().is_empty());
    }

    #[test]
    fn a_refusal_payload_carries_the_key_the_reason_and_no_events() {
        assert_eq!(
            super::fs_watch_refusal_payload("/r\u{0}tree", "too many files"),
            serde_json::json!({ "key": "/r\u{0}tree", "events": [], "refused": "too many files" }),
        );
    }

    #[test]
    fn an_fs_watch_payload_carries_the_watch_key_and_its_events() {
        use super::fs_watch_payload;
        use crate::watch::{WatchEvent, WatchKind};
        use std::path::PathBuf;
        let events = [
            WatchEvent {
                kind: WatchKind::Created,
                path: PathBuf::from("/r/a/b.md"),
                to: None,
            },
            WatchEvent {
                kind: WatchKind::Renamed,
                path: PathBuf::from("/r/x.md"),
                to: Some(PathBuf::from("/r/y.md")),
            },
        ];
        assert_eq!(
            fs_watch_payload("/r\u{0}tree", &events),
            serde_json::json!({
                "key": "/r\u{0}tree",
                "events": [
                    { "kind": "created", "path": "/r/a/b.md" },
                    { "kind": "renamed", "path": "/r/x.md", "to": "/r/y.md" },
                ],
            })
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
    fn a_drop_keeps_files_and_drops_folders_and_missing_paths() {
        let dir = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("marxy-drop-{}", std::process::id()));
        let folder = dir.join("a folder");
        std::fs::create_dir_all(&folder).unwrap();
        let file = dir.join("read me.md");
        std::fs::write(&file, b"# x\n").unwrap();
        let missing = dir.join("gone.md");
        let kept = document_paths_from_drop(&[folder.clone(), file.clone(), missing]);
        assert_eq!(kept, vec![file.to_str().unwrap().to_string()]);
        assert!(document_paths_from_drop(&[folder]).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
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
        use super::app_menu::{
            action_for, Action, Entry, CLOSE_WINDOW, GO_BACK, GO_FORWARD, MENU, OPEN_FILE,
            OPEN_QUICKLY, QUIT, TOGGLE_SOURCE,
        };

        let titles: Vec<&str> = MENU.iter().map(|(title, _)| *title).collect();
        assert_eq!(titles, ["Marxy", "File", "Edit", "View", "Go", "Window"]);

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
                (CLOSE_WINDOW, "CmdOrCtrl+W"),
                (TOGGLE_SOURCE, "CmdOrCtrl+E"),
                (GO_BACK, "CmdOrCtrl+["),
                (GO_FORWARD, "CmdOrCtrl+]"),
                (OPEN_QUICKLY, "CmdOrCtrl+P"),
            ],
            "the menu's own items are the app and window items, the view toggle, history and the \
             palette, and no document operation (ADR-0011)"
        );
        for id in [TOGGLE_SOURCE, GO_BACK, GO_FORWARD, OPEN_QUICKLY] {
            assert_eq!(action_for(id), Some(Action::ToWebview));
            assert!(!Action::ToWebview.asks_the_webview_first());
        }
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
