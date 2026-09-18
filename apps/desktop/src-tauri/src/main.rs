//! marxy desktop shell. Everything privileged lives here behind the shell-api contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ms() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0) }

#[tauri::command]
fn args() -> Vec<String> { std::env::args().skip(1).collect() }

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> { std::fs::read(&path).map_err(|e| format!("{path}: {e}")) }

/// Write-temp-then-rename in the same directory: never in place, so a crash leaves the old file intact
/// and watchers see one atomic event. Byte-faithful by construction: writes exactly `bytes`.
#[tauri::command]
fn write_file_atomic(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    let dir = target.parent().ok_or("no parent directory")?;
    let tmp = dir.join(format!(".{}.marxy-tmp", target.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())
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
        "painted" | "no_text" | "error" => settle_render(),
        _ => {}
    }
}

/// True when a harness launched us: the startup measurement sets the variable, and `--quit-after-paint`
/// is the same request made by hand.
fn quit_after_paint() -> bool {
    matches!(std::env::var("MARXY_QUIT_AFTER_PAINT").as_deref(), Ok("1") | Ok("true"))
        || std::env::args().any(|a| a == "--quit-after-paint")
}

#[tauri::command]
fn startup_marks() -> serde_json::Value {
    serde_json::json!({ "quit_after_paint": quit_after_paint() })
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
            mark("no_paint", now_ms(), Some(format!("deadline_ms={PAINT_DEADLINE_MS}")));
            app.cleanup_before_exit();
            std::process::exit(1);
        }
    });
}

fn main() {
    mark("main_start", now_ms(), None);
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![args, read_file, write_file_atomic, mark_from_webview, startup_marks, quit])
        .run(tauri::generate_context!())
        .expect("error while running marxy");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test function, not several: the counters above are process-global and cargo runs test
    /// functions on parallel threads, so the sequence has to be driven in one place.
    #[test]
    fn a_paint_deadline_speaks_only_for_the_render_it_was_armed_for() {
        let first = begin_render();
        assert!(deadline_is_current(first), "a render that has not reported yet is still owed a paint");

        settle_render();
        assert!(!deadline_is_current(first), "a render that reported its paint is owed nothing");

        // Fails if a render does not start a new wait: the outcome of the first document would still be
        // on record, the second document's deadline would never fire, and a launch that cannot paint
        // would hang again — silently, because only a second render reveals it.
        let second = begin_render();
        assert!(deadline_is_current(second), "a second document must get a deadline of its own");

        // Fails if that reset is a plain flag: the first document's thread is still sleeping, and waking
        // to find "not reported" it would end the process over a paint that already happened.
        assert!(!deadline_is_current(first), "a retired deadline must not fire against a later render");
    }
}
