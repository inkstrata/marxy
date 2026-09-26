//! marxy desktop shell. Everything privileged lives here behind the shell-api contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod atomic_write;
mod commands;
mod error;
mod watch;

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use tauri::RunEvent;
use tauri::{Emitter, Manager};

use commands::app::config_paths;

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[tauri::command]
fn args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[tauri::command]
fn clipboard_write(
    app: tauri::AppHandle,
    text: String,
    html: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| e.to_string())?;
    if let Some(html) = html {
        app.clipboard()
            .write_html(html, None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
fn write_file_atomic(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_file_atomic: expected the document's bytes as a raw body".into());
    };
    let encoded = request
        .headers()
        .get(WRITE_PATH_HEADER)
        .ok_or_else(|| format!("write_file_atomic: missing {WRITE_PATH_HEADER}"))?
        .to_str()
        .map_err(|e| format!("write_file_atomic: {WRITE_PATH_HEADER}: {e}"))?;
    let path = percent_decode(encoded)?;
    atomic_write::write_atomic(std::path::Path::new(&path), bytes)
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
    ) || std::env::args().any(|a| a == "--quit-after-paint")
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

fn canonical_watch_root(root: &str) -> Result<String, String> {
    let path = PathBuf::from(root);
    let canon = path.canonicalize().map_err(|e| format!("{root}: {e}"))?;
    Ok(canon.to_string_lossy().into_owned())
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

/// Starts (or shares) one polling thread per canonical root; events go to `fs-watch`.
#[tauri::command]
fn watch_root(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let key = canonical_watch_root(&root)?;
    let mut table = watch_table().lock().map_err(|e| e.to_string())?;
    if let Some(entry) = table.get_mut(&key) {
        entry.refs += 1;
        return Ok(());
    }
    let app_handle = app.clone();
    let running = watch::spawn_poll_thread(PathBuf::from(&key), move |events| {
        emit_fs_watch(&app_handle, events);
    })?;
    table.insert(key, WatchEntry { running, refs: 1 });
    Ok(())
}

#[tauri::command]
fn unwatch_root(root: String) -> Result<(), String> {
    let key = canonical_watch_root(&root)?;
    let mut table = watch_table().lock().map_err(|e| e.to_string())?;
    let entry = table
        .get_mut(&key)
        .ok_or_else(|| format!("not watching {root}"))?;
    entry.refs -= 1;
    if entry.refs == 0 {
        let mut entry = table.remove(&key).expect("entry");
        entry.running.stop();
    }
    Ok(())
}

/// Exits with `code`: 0 for a launch that rendered, non-zero for one that failed, so a harness
/// waiting on the process learns the difference instead of only timing out. `AppHandle::exit` is not
/// enough — it ends the process with status 0 and never returns to `main` — so the code is applied
/// here, after Tauri's own teardown.
#[tauri::command]
fn quit(app: tauri::AppHandle, code: Option<i32>) {
    app.cleanup_before_exit();
    std::process::exit(code.unwrap_or(0));
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

/// The deadline's state machine, checkable from outside: `marxy --paint-deadline-selftest` runs these
/// cases and exits 0 or 1. It lives in the binary rather than in a `#[cfg(test)]` module because there
/// is no second-document path to drive it through yet — the app renders once per launch — and because
/// compiling a test harness for the Tauri dependency tree costs CI about two minutes for four
/// assertions, while this costs the launch of an already-built binary.
/// Absolute paths for `onOpenFiles`: skip flags and the macOS `-psn_…` launcher token.
fn document_paths_from_argv(argv: &[String], cwd: &str) -> Vec<String> {
    let base = Path::new(cwd);
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let path = PathBuf::from(a);
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
        })
        .collect()
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    focus_main_window(app);
    let _ = app.emit("marxy:open-files", paths);
}

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

fn main() {
    if std::env::args().any(|a| a == "--paint-deadline-selftest") {
        std::process::exit(paint_deadline_selftest());
    }
    mark("main_start", now_ms(), None);
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            emit_open_files(app, document_paths_from_argv(&argv, &cwd));
        }))
        .setup(|app| {
            if app.webview_windows().values().next().is_some() {
                mark("window_shown", now_ms(), None);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            args,
            read_file,
            write_file_atomic,
            mark_from_webview,
            startup_marks,
            quit,
            watch_root,
            unwatch_root,
            commands::fs::image_size,
            commands::fs::allow_asset_scope,
            config_paths,
            clipboard_write,
        ])
        .build(tauri::generate_context!())
        .expect("error while building marxy")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter(|url| url.scheme() == "file")
                    .filter_map(|url| {
                        url.to_file_path()
                            .ok()
                            .and_then(|p| p.to_str().map(String::from))
                    })
                    .collect();
                emit_open_files(app, paths);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

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
}
