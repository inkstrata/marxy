// Tauri shell for the marxy spike. Same frontend as the Electron shell; only this crate differs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use ignore::WalkBuilder;
use nucleo_matcher::{pattern::{CaseMatching, Normalization, Pattern}, Config, Matcher, Utf32Str};
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;
use tauri::State;

struct Index(Mutex<Vec<String>>);

#[tauri::command]
fn args() -> Vec<String> { std::env::args().skip(1).collect() }

#[tauri::command]
fn read_file(path: String) -> Result<String, String> { std::fs::read_to_string(&path).map_err(|e| e.to_string()) }

#[tauri::command]
fn mark(name: String, t: f64, data: Option<String>) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "MARK {} {} {}", name, t, data.unwrap_or_default());
    let _ = out.flush();
}

#[tauri::command]
fn index_build(root: String, state: State<Index>) -> serde_json::Value {
    let t0 = Instant::now();
    let mut v: Vec<String> = Vec::new();
    for e in WalkBuilder::new(&root).hidden(true).git_ignore(true).build().flatten() {
        if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            v.push(e.path().to_string_lossy().into_owned());
        }
    }
    let n = v.len();
    *state.0.lock().unwrap() = v;
    serde_json::json!({ "count": n, "ms": t0.elapsed().as_secs_f64() * 1000.0 })
}

#[tauri::command]
fn index_query(q: String, state: State<Index>) -> serde_json::Value {
    let t0 = Instant::now();
    let items = state.0.lock().unwrap();
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pat = Pattern::parse(&q, CaseMatching::Ignore, Normalization::Smart);
    let mut buf = Vec::new();
    let mut scored: Vec<(u32, &String)> = items
        .iter()
        .filter_map(|s| pat.score(Utf32Str::new(s, &mut buf), &mut matcher).map(|sc| (sc, s)))
        .collect();
    scored.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    let top: Vec<&String> = scored.iter().take(50).map(|x| x.1).collect();
    serde_json::json!({ "n": scored.len(), "top": top, "ms": t0.elapsed().as_secs_f64() * 1000.0 })
}

/// Capture the WKWebView's own rendering (what the user sees on macOS) without screen-recording permission.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn snapshot(window: tauri::WebviewWindow, path: String) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let out = path.clone();
    window
        .with_webview(move |pw| {
            use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
            use objc2_foundation::{NSDictionary, NSError};
            use objc2_web_kit::WKWebView;
            let wv: &WKWebView = unsafe { &*(pw.inner() as *const WKWebView) };
            let block = block2::RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
                let r = (|| -> Result<(), String> {
                    if img.is_null() { return Err("null image".into()); }
                    let img: &NSImage = unsafe { &*img };
                    let tiff = img.TIFFRepresentation().ok_or("no tiff")?;
                    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("no rep")?;
                    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("no png")?;
                    std::fs::write(&out, png.to_vec()).map_err(|e| e.to_string())
                })();
                let _ = tx.send(r);
            });
            unsafe { wv.takeSnapshotWithConfiguration_completionHandler(None, &block) };
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(15)).map_err(|e| e.to_string())??;
    Ok(path)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn snapshot(_path: String) -> Result<String, String> { Err("snapshot only implemented on macOS".into()) }

#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

fn main() {
    mark("main_start".into(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as f64, None);
    tauri::Builder::default()
        .manage(Index(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![args, read_file, mark, index_build, index_query, snapshot, quit])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
