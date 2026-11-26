//! Files dropped from Explorer on Windows. `dragDropEnabled` is off there (tauri.windows.conf.json) so the page's
//! HTML5 drags work, which also stops Tauri's `DragDrop` event. The page catches an OS file drop and posts
//! `marxy-drop` with the files as WebView2 additional objects; each is an `ICoreWebView2File`, whose `Path` is the
//! file on disk. The paths take the same route as a drop on macOS or a second launch.
//!
//! wry hands every page message to Tauri's IPC parser as well, which answers this one with a `console.error`
//! in the page: harmless, and the only way WebView2 gives a page's drop its paths.

use std::path::PathBuf;

use tauri::{Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
};
use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
use windows_core::{Interface, PWSTR};

const MESSAGE: &str = "marxy-drop";

pub fn listen(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut text = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut text).is_err() || take_pwstr(text) != MESSAGE {
                return Ok(());
            }
            let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
                return Ok(());
            };
            let Ok(objects) = args.AdditionalObjects() else {
                return Ok(());
            };
            let mut count = 0u32;
            objects.Count(&mut count)?;
            let mut paths = Vec::new();
            for i in 0..count {
                let Ok(file) = objects
                    .GetValueAtIndex(i)
                    .and_then(|o| o.cast::<ICoreWebView2File>())
                else {
                    continue;
                };
                let mut path = PWSTR::null();
                if file.Path(&mut path).is_ok() {
                    paths.push(PathBuf::from(take_pwstr(path)));
                }
            }
            crate::deliver_open_files(&app, crate::document_paths_from_drop(&paths));
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}
