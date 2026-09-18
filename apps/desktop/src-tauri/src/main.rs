//! marxy desktop shell. Everything privileged lives here behind the shell-api contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::Write;
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

#[tauri::command]
fn mark(name: String, t: f64, data: Option<String>) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "MARK {} {} {}", name, t, data.unwrap_or_default());
    let _ = out.flush();
}

#[tauri::command]
fn startup_marks() -> serde_json::Value {
    serde_json::json!({ "quit_after_paint": std::env::var("MARXY_QUIT_AFTER_PAINT").is_ok() })
}

#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

fn main() {
    mark("main_start".into(), now_ms(), None);
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![args, read_file, write_file_atomic, mark, startup_marks, quit])
        .run(tauri::generate_context!())
        .expect("error while running marxy");
}
