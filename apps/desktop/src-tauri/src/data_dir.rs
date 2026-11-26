//! Where Marxy keeps its state, and the sweep of indexes whose folder is gone.
//!
//! `MARXY_DATA_DIR`, when set, is the one folder for everything: config.toml, the data files and the webview's profile. The
//! checks launch the app on a fresh one, so a run never reads or writes the reader's own state. Unset, the folders are
//! Tauri's, as they always were.

use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const DATA_DIR_VAR: &str = "MARXY_DATA_DIR";

/// The folder `MARXY_DATA_DIR` names, made absolute against the launch directory; None when it is unset or empty.
pub fn data_dir_override() -> Option<PathBuf> {
    let dir = std::env::var_os(DATA_DIR_VAR).filter(|v| !v.is_empty())?;
    std::path::absolute(PathBuf::from(dir)).ok()
}

/// The folder config.toml lives in.
pub fn config_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<PathBuf> {
    match data_dir_override() {
        Some(dir) => Ok(dir),
        None => app.path().app_config_dir(),
    }
}

/// The folder the data files (history, layout, indexes, Versions) live in.
pub fn data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<PathBuf> {
    match data_dir_override() {
        Some(dir) => Ok(dir),
        None => app.path().app_data_dir(),
    }
}

/// The folder `marxy-file://` keeps decoded images in (src/file_scheme.rs), keyed by source path, mtime and size.
pub fn decoded_cache_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<PathBuf> {
    data_dir(app).map(|dir| dir.join("decoded"))
}

/// The identifier an app on `dir` runs under. The single-instance plugin keys on the identifier, so with the bundle's own a
/// check's second launch would be handed to a Marxy the reader has open, and open its file there.
pub fn identifier_for(identifier: &str, dir: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    dir.hash(&mut hasher);
    format!("{identifier}.data-{:016x}", hasher.finish())
}

/// How long after launch the index sweep waits: past the first document, its index walk and the restored layout.
pub const INDEX_SWEEP_DELAY: Duration = Duration::from_secs(20);

/// `index-<hex>.json`, the name the index service gives a root's snapshot (`src/index/service.ts`).
fn is_index_name(name: &str) -> bool {
    name.strip_prefix("index-")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(|hex| {
            !hex.is_empty()
                && hex
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

/// Folders whose children are mount points: a root that is a volume reads as missing while the volume is unplugged.
fn holds_mounts(dir: &Path) -> bool {
    let per_user = |p: &Path| p == Path::new("/media") || p == Path::new("/run/media");
    ["/Volumes", "/media", "/mnt", "/run/media"]
        .map(Path::new)
        .contains(&dir)
        || dir.parent().is_some_and(per_user)
}

/// `root` is gone and can be shown to be: it is absolute, not there, and its parent folder is there to say so. A root
/// whose parent is missing too (an unplugged drive, an unreachable share), or that cannot be looked at, is kept.
pub fn root_is_gone(root: &Path) -> bool {
    if !root.is_absolute() || !matches!(root.try_exists(), Ok(false)) {
        return false;
    }
    match root.parent() {
        Some(parent) if !holds_mounts(parent) => fs::metadata(parent).is_ok_and(|m| m.is_dir()),
        _ => false,
    }
}

#[derive(serde::Deserialize)]
struct SnapshotRoot {
    root: String,
}

/// Removes each `index-<hex>.json` in `data` whose root folder is gone (`root_is_gone`). A file that cannot be read or does
/// not name a root is left alone. Returns the files removed.
pub fn sweep_indexes(data: &Path) -> Vec<PathBuf> {
    let Ok(listing) = fs::read_dir(data) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    for entry in listing.flatten() {
        let path = entry.path();
        if !entry.file_name().to_str().is_some_and(is_index_name)
            || !entry.file_type().is_ok_and(|t| t.is_file())
        {
            continue;
        }
        let Some(snapshot) = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SnapshotRoot>(&bytes).ok())
        else {
            continue;
        };
        if root_is_gone(Path::new(&snapshot.root)) && fs::remove_file(&path).is_ok() {
            removed.push(path);
        }
    }
    removed
}

/// Sweeps the data folder's indexes once, `INDEX_SWEEP_DELAY` after launch, off the main thread.
pub fn sweep_indexes_later<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Ok(data) = data_dir(app) else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(INDEX_SWEEP_DELAY);
        sweep_indexes(&data);
    });
}

#[cfg(test)]
mod tests {
    use super::{holds_mounts, identifier_for, is_index_name, root_is_gone, sweep_indexes};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("marxy-data-dir-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn snapshot(data: &Path, name: &str, root: &Path) {
        let json = serde_json::json!({ "version": 1, "root": root.to_string_lossy().replace('\\', "/"), "generatedAtMs": 1, "entries": [] });
        fs::write(data.join(name), json.to_string()).expect("seed snapshot");
    }

    #[test]
    fn only_the_index_services_names_are_indexes() {
        assert!(is_index_name(
            "index-6447904b3f72f7499c8fc7a2792b3877ac6f3a9e.json"
        ));
        for name in [
            "index-.json",
            "index-ABC.json",
            "index-abc.json.tmp",
            "versions-abc.json",
            "index-abc",
            "xindex-abc.json",
        ] {
            assert!(!is_index_name(name), "{name}");
        }
    }

    #[test]
    fn a_root_is_gone_only_when_its_parent_is_there_to_say_so() {
        let base = scratch("gone");
        let there = base.join("there");
        fs::create_dir_all(&there).expect("root");
        assert!(!root_is_gone(&there), "a root that exists");
        assert!(
            root_is_gone(&base.join("deleted")),
            "a root whose parent lists no such folder"
        );
        assert!(
            !root_is_gone(&base.join("missing-parent").join("root")),
            "a root whose parent is gone too cannot be checked"
        );
        assert!(
            !root_is_gone(Path::new("relative/root")),
            "a relative root names no one folder"
        );
        let file = base.join("file");
        fs::write(&file, b"x").expect("file");
        assert!(
            !root_is_gone(&file.join("root")),
            "a parent that is a file says nothing about the root"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_volume_that_is_not_mounted_is_not_gone() {
        assert!(holds_mounts(Path::new("/Volumes")));
        assert!(holds_mounts(Path::new("/media/ian")));
        assert!(holds_mounts(Path::new("/run/media/ian")));
        assert!(holds_mounts(Path::new("/mnt")));
        assert!(
            !holds_mounts(Path::new("/Volumes/Disk")),
            "a folder inside a mounted volume is an ordinary folder"
        );
        assert!(!holds_mounts(Path::new("/home/ian")));
        #[cfg(unix)]
        assert!(!root_is_gone(Path::new("/Volumes/marxy-unplugged-disk")));
    }

    #[test]
    fn the_sweep_removes_the_indexes_of_gone_roots_and_nothing_else() {
        let base = scratch("sweep");
        let data = base.join("data");
        let kept_root = base.join("kept");
        fs::create_dir_all(&data).expect("data");
        fs::create_dir_all(&kept_root).expect("kept root");
        snapshot(&data, "index-aa.json", &base.join("deleted"));
        snapshot(&data, "index-bb.json", &kept_root);
        snapshot(
            &data,
            "index-cc.json",
            &base.join("missing-parent").join("root"),
        );
        fs::write(data.join("index-dd.json"), b"{ not json").expect("damaged");
        fs::write(data.join("index-ee.json"), br#"{"version":1,"entries":[]}"#).expect("no root");
        snapshot(&data, "versions-ff.json", &base.join("deleted"));
        snapshot(&data, "index-ff.json.tmp", &base.join("deleted"));

        let removed = sweep_indexes(&data);
        assert_eq!(removed, vec![data.join("index-aa.json")]);
        let mut left: Vec<String> = fs::read_dir(&data)
            .expect("list")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "index-bb.json",
                "index-cc.json",
                "index-dd.json",
                "index-ee.json",
                "index-ff.json.tmp",
                "versions-ff.json"
            ]
        );
        assert!(sweep_indexes(&base.join("no-such-folder")).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn each_data_folder_runs_as_its_own_instance() {
        let a = identifier_for("dev.marxy.app", Path::new("/tmp/a"));
        assert!(a.starts_with("dev.marxy.app.data-"));
        assert_eq!(
            a,
            identifier_for("dev.marxy.app", Path::new("/tmp/a")),
            "every launch on one folder finds the same instance"
        );
        assert_ne!(a, identifier_for("dev.marxy.app", Path::new("/tmp/b")));
    }
}
