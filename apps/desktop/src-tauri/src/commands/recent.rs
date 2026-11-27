//! Windows' Recent list: Explorer's, and the Recent category of the taskbar jump list, which is built from it.

use std::path::{Path, PathBuf};

/// The canonical path to record for `path`, or None when it must not be: not an absolute path to a regular file (an
/// archive's entry is a virtual path and names none), or inside one of `excluded` (the app's own folders, temp).
pub fn recordable(path: &str, excluded: &[PathBuf]) -> Option<PathBuf> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return None;
    }
    let canonical = dunce::canonicalize(path).ok()?;
    if !canonical.is_file() {
        return None;
    }
    let inside = |dir: &PathBuf| {
        let dir = dunce::canonicalize(dir).unwrap_or_else(|_| dir.clone());
        canonical.starts_with(dir)
    };
    if excluded.iter().any(inside) {
        return None;
    }
    Some(canonical)
}

/// Where files opened are not remembered: what Marxy keeps itself (versions, notes, indexes) and scratch space.
fn excluded_folders(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut folders = vec![std::env::temp_dir()];
    folders.extend(crate::data_dir::data_dir(app).ok());
    folders.extend(crate::data_dir::config_dir(app).ok());
    folders
}

#[cfg(windows)]
fn add_to_recent(path: &Path) {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::{SHAddToRecentDocs, SHARD_PATHW};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives the call.
    unsafe { SHAddToRecentDocs(SHARD_PATHW.0 as u32, Some(wide.as_ptr().cast::<c_void>())) };
}

#[cfg(not(windows))]
fn add_to_recent(_path: &Path) {}

/// Names this process the way the installer's shortcuts name the app (its bundle identifier), so the taskbar button and the
/// jump list's Recent category are one app's. Neither tao nor wry sets one, and a process with none is matched to its
/// shortcut by guesswork. Before any window exists.
#[cfg(windows)]
pub fn set_app_user_model_id(identifier: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    // SAFETY: the string is a valid HSTRING for the call.
    let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(identifier)) };
}

/// A document the reader opened, for the system's Recent list. Never an error to the page: a refused path is just
/// not remembered. Off the UI thread, since the shell can stall on a network share.
#[tauri::command]
pub async fn note_recent(app: tauri::AppHandle, path: String) -> Result<(), String> {
    crate::commands::fs::off_main(move || {
        let in_scope = crate::scope::admit(&path, crate::scope::Need::Read).is_ok();
        if let Some(file) = recordable(&path, &excluded_folders(&app)).filter(|_| in_scope) {
            add_to_recent(&file);
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::recordable;
    use std::fs;

    #[test]
    fn a_file_outside_the_excluded_folders_is_recorded_and_the_rest_are_not() {
        let root = dunce::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("marxy-recent-{}", std::process::id()));
        let data = root.join("data");
        let docs = root.join("docs");
        fs::create_dir_all(data.join("versions")).unwrap();
        fs::create_dir_all(&docs).unwrap();
        let note = docs.join("a.md");
        let kept = data.join("versions").join("a.md");
        fs::write(&note, "# a").unwrap();
        fs::write(&kept, "# a").unwrap();
        let excluded = vec![data.clone()];

        assert!(recordable(note.to_str().unwrap(), &excluded).is_some());
        assert!(
            recordable(kept.to_str().unwrap(), &excluded).is_none(),
            "the app's own folder"
        );
        assert!(
            recordable(docs.to_str().unwrap(), &excluded).is_none(),
            "a folder"
        );
        assert!(
            recordable(docs.join("gone.md").to_str().unwrap(), &excluded).is_none(),
            "a missing file"
        );
        assert!(recordable("a.md", &excluded).is_none(), "a relative path");
        let entry = format!("{}/inner.md", note.display());
        assert!(
            recordable(&entry, &excluded).is_none(),
            "an archive entry's virtual path"
        );
        assert!(
            recordable(note.to_str().unwrap(), &[docs]).is_none(),
            "a folder listed as excluded"
        );
        fs::remove_dir_all(&root).unwrap();
    }
}
