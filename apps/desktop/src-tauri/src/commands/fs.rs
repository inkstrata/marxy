//! File commands: natural image size, asset-protocol scoping, and read_dir (docs/design/06-shell.md).

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use imagesize::{size, ImageError};
use serde::Serialize;
use tauri::Manager;

use crate::error::ShellError;

/// Same names as `index-model/deny.ts`; a gitignore `!` cannot undo these.
const DENY_DIRECTORY_NAMES: &[&str] = &[
    "node_modules",
    "target",
    ".venv",
    "venv",
    "dist",
    "build",
    "out",
    ".git",
    "__pycache__",
    ".next",
    ".turbo",
    "coverage",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub is_dir: bool,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn denied_name(name: &str) -> bool {
    DENY_DIRECTORY_NAMES.contains(&name)
}

fn scope_directory(dir: &str) -> Result<PathBuf, ShellError> {
    let p = Path::new(dir);
    if !p.is_dir() {
        return Err(ShellError::invalid(dir, "not a directory"));
    }
    Ok(p.to_path_buf())
}

#[derive(Debug, Serialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// `imagesize` uses `IoError` for short reads as well as real filesystem failures; only the latter
/// propagate to the webview.
fn image_size_io_is_format_miss(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::InvalidData
    )
}

fn map_image_size_error(
    path: &str,
    err: ImageError,
) -> Result<Option<ImageDimensions>, ShellError> {
    match err {
        ImageError::NotSupported | ImageError::CorruptedImage => Ok(None),
        ImageError::IoError(e) if image_size_io_is_format_miss(&e) => Ok(None),
        ImageError::IoError(e) => Err(ShellError::io(path, e.to_string())),
    }
}

/// Natural pixel size from the file header only (`imagesize`, MIT). `null` when the bytes are not an image.
#[tauri::command]
pub fn image_size(path: String) -> Result<Option<ImageDimensions>, ShellError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(ShellError::not_found(
            &path,
            format!("{path}: no such file"),
        ));
    }
    match size(&path) {
        Ok(dim) => Ok(Some(ImageDimensions {
            width: dim.width as u32,
            height: dim.height as u32,
        })),
        Err(err) => map_image_size_error(&path, err),
    }
}

/// Adds a recursive asset-protocol scope for this session (ADR-0027 §5).
#[tauri::command]
pub fn allow_asset_scope(app: tauri::AppHandle, dir: String) -> Result<(), ShellError> {
    scope_directory(&dir)?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| ShellError::io(&dir, e.to_string()))
}

/// Lists immediate children of `dir`; deny-listed directory names are omitted (ADR-0026).
#[tauri::command]
pub fn read_dir(dir: String) -> Result<Vec<FileStat>, ShellError> {
    let path = Path::new(&dir);
    if !path.is_dir() {
        return Err(ShellError::not_found(
            &dir,
            format!("{dir}: not a directory"),
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| ShellError::io(&dir, e.to_string()))?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&canonical).map_err(|e| ShellError::io(&dir, e.to_string()))?;
    // A single directory entry can itself fail to read mid-iteration (the same races metadata()
    // below tolerates); `.flatten()` skips it rather than failing the whole listing.
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if denied_name(&name) {
            continue;
        }
        let child = entry.path();
        if child
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(denied_name)
        {
            continue;
        }
        // A file can vanish (or its permissions change) between `fs::read_dir` listing it and this
        // `metadata()` call; that one entry is omitted rather than failing the whole listing, the
        // same TOCTOU tolerance `collectFiles` (`packages/core/src/index-model/walk.ts`) gives a racy directory
        // tree with its try/catch around each listing.
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let abs = if child.is_absolute() {
            child
        } else {
            canonical.join(child)
        };
        out.push(FileStat {
            path: abs.to_string_lossy().into_owned(),
            size,
            mtime_ms: mtime_ms(&meta),
            is_dir,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// The most `read_head` ever returns, whatever the caller asks for: the index's head size.
pub const MAX_HEAD_BYTES: u64 = 256 * 1024;

/// One file's size and modification time, without listing its folder (C-11.2). A narrower form of
/// `read_dir`, so it reaches no further: `None` for a path that is missing, is a symlink (`read_dir`
/// omits every one), or is named like a deny-listed directory. A folder is reported as one.
#[tauri::command]
pub fn stat_file(path: String) -> Result<Option<FileStat>, ShellError> {
    let p = Path::new(&path);
    if p.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(denied_name)
    {
        return Ok(None);
    }
    let meta = match fs::symlink_metadata(p) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ShellError::io(&path, e.to_string())),
    };
    if meta.file_type().is_symlink() {
        return Ok(None);
    }
    let is_dir = meta.is_dir();
    Ok(Some(FileStat {
        path,
        size: if is_dir { 0 } else { meta.len() },
        mtime_ms: mtime_ms(&meta),
        is_dir,
    }))
}

/// Opens `p` for `read_head_bytes` without following a link at the path and without blocking. On unix
/// the open itself carries `O_NOFOLLOW` (a symlink at the path fails the open) and `O_NONBLOCK` (opening
/// a FIFO returns at once instead of waiting for a writer; it has no effect on a regular file), so a
/// path swapped for a link or a pipe between the type check and the open cannot slip through.
fn open_head(p: &Path) -> std::io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(p)
    }
    #[cfg(not(unix))]
    {
        File::open(p)
    }
}

/// The first `max_bytes` of a regular file (never more than `MAX_HEAD_BYTES`), behind the `read_head`
/// command in `main.rs`. A narrower form of `read_file`: a symlink at the path, a FIFO, a device or a
/// folder is refused. The type is checked before the open, and the open itself neither follows a link
/// nor blocks on a pipe (`open_head`); the type of what was opened is checked again.
pub fn read_head_bytes(path: &str, max_bytes: u64) -> Result<Vec<u8>, ShellError> {
    let p = Path::new(path);
    let meta = fs::symlink_metadata(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ShellError::not_found(path, format!("{path}: no such file"))
        } else {
            ShellError::io(path, e.to_string())
        }
    })?;
    if !meta.file_type().is_file() {
        return Err(ShellError::invalid(
            path,
            format!("{path}: not a regular file"),
        ));
    }
    let file = open_head(p).map_err(|e| ShellError::io(path, e.to_string()))?;
    // The path may have been swapped for something else between the check and the open.
    if !file.metadata().map(|m| m.is_file()).unwrap_or(false) {
        return Err(ShellError::invalid(
            path,
            format!("{path}: not a regular file"),
        ));
    }
    let mut head = Vec::new();
    file.take(max_bytes.min(MAX_HEAD_BYTES))
        .read_to_end(&mut head)
        .map_err(|e| ShellError::io(path, e.to_string()))?;
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn corpus_png() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/image.png")
    }

    fn corpus_ts() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/04-source.ts")
    }

    #[test]
    fn image_size_on_corpus_png_is_1200_by_400() {
        let path = corpus_png();
        assert!(path.is_file(), "fixture missing: {}", path.display());
        let got = image_size(path.to_string_lossy().into_owned())
            .unwrap()
            .unwrap();
        assert_eq!(got.width, 1200);
        assert_eq!(got.height, 400);
    }

    #[test]
    fn image_size_on_text_source_is_none() {
        let path = corpus_ts();
        assert!(path.is_file());
        assert!(image_size(path.to_string_lossy().into_owned())
            .unwrap()
            .is_none());
    }

    #[test]
    fn image_size_on_missing_path_is_not_found() {
        let err = image_size("/no/such/marxy-image.png".into()).unwrap_err();
        assert_eq!(err.code, "not-found");
    }

    #[test]
    fn map_image_size_error_permission_denied_is_io() {
        use std::io::{Error, ErrorKind};

        let err = map_image_size_error(
            "/locked.png",
            ImageError::IoError(Error::new(ErrorKind::PermissionDenied, "permission denied")),
        )
        .expect_err("real I/O failure must not become null");
        assert_eq!(err.code, "io");
    }

    #[test]
    fn map_image_size_error_format_miss_is_none() {
        use std::io::{Error, ErrorKind};

        assert!(map_image_size_error(
            "/short.png",
            ImageError::IoError(Error::new(ErrorKind::UnexpectedEof, "eof")),
        )
        .unwrap()
        .is_none());
        assert!(map_image_size_error(
            "/short.png",
            ImageError::IoError(Error::new(ErrorKind::InvalidData, "bad")),
        )
        .unwrap()
        .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn image_size_on_unreadable_file_is_io_not_none() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("marxy-image-size-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("tmpdir");
        let file = root.join("locked.png");
        fs::write(&file, b"\x89PNG\r\n\x1a\n").expect("seed png header");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).expect("chmod");

        let path = file.to_string_lossy().into_owned();
        let restore = || {
            let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o644));
            let _ = fs::remove_dir_all(&root);
        };

        // Root on Linux can still read mode 000; map_image_size_error tests cover the contract there.
        if fs::read(&file).is_ok() {
            restore();
            return;
        }

        let err = match image_size(path) {
            Err(e) => e,
            Ok(none) => {
                restore();
                panic!("permission denied must not look like a non-image: {none:?}");
            }
        };
        restore();
        assert_eq!(err.code, "io");
    }

    #[test]
    fn allow_asset_scope_on_a_file_is_invalid() {
        let path = corpus_png();
        let err = scope_directory(&path.to_string_lossy()).unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    /// The scope handed to the asset protocol is exactly the directory asked for, never its parent
    /// (G-04: the Rust half of the asset-scope tests in test/images.test.mjs; `allow_asset_scope`
    /// itself needs a Tauri `AppHandle`, so its argument check is the testable part).
    #[test]
    fn allow_asset_scope_on_a_directory_is_that_directory_and_no_wider() {
        let root = std::env::temp_dir().join(format!("marxy-asset-scope-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let docs = root.join("docs");
        fs::create_dir_all(&docs).expect("tmpdir");

        let got = scope_directory(&docs.to_string_lossy()).expect("a directory is a valid scope");
        let _ = fs::remove_dir_all(&root);

        assert_eq!(got, docs);
        assert_ne!(got, root, "the scope must not widen to the parent");
    }

    #[test]
    fn allow_asset_scope_on_a_missing_path_is_invalid() {
        let err = scope_directory("/no/such/marxy-asset-dir").unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    /// The index walk trusts `read_dir` never to list a symlink, so it never leaves the root.
    /// Every symlink is omitted: out-of-root directory and file links, and one that stays inside.
    #[cfg(unix)]
    #[test]
    fn read_dir_omits_every_symlink() {
        use std::os::unix::fs::symlink;
        let base =
            std::env::temp_dir().join(format!("marxy-read-dir-links-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("secret.md"), b"# secret\n").expect("secret");
        fs::write(root.join("real.md"), b"# real\n").expect("real");
        symlink(&outside, root.join("dirlink")).expect("dir symlink");
        symlink(outside.join("secret.md"), root.join("filelink.md")).expect("file symlink");
        symlink(root.join("real.md"), root.join("insidelink.md")).expect("inside symlink");

        let listed = read_dir(root.to_string_lossy().into_owned()).expect("read_dir");
        let names: Vec<String> = listed
            .iter()
            .map(|s| {
                Path::new(&s.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let _ = fs::remove_dir_all(&base);

        assert_eq!(names, vec!["real.md".to_string()]);
    }

    #[test]
    fn read_dir_lists_one_level_with_mtime_and_skips_node_modules() {
        let root = std::env::temp_dir().join(format!("marxy-read-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("tmpdir");
        fs::write(root.join("a.md"), b"# a\n").expect("a.md");
        fs::create_dir(root.join("sub")).expect("sub");
        fs::create_dir_all(root.join("node_modules").join("pkg")).expect("node_modules");
        fs::write(root.join("node_modules/pkg/x.md"), b"x").expect("nm file");

        let dir = root.to_string_lossy().into_owned();
        let listed = read_dir(dir).expect("read_dir");
        let names: Vec<String> = listed
            .iter()
            .map(|stat| {
                Path::new(&stat.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();

        assert!(names.iter().any(|n| n == "a.md"));
        assert!(names.iter().any(|n| n == "sub"));
        assert!(!names.iter().any(|n| n == "node_modules"));
        let file = listed
            .iter()
            .find(|s| s.path.ends_with("a.md"))
            .expect("a.md stat");
        assert!(!file.is_dir);
        assert!(file.size > 0);
        assert!(file.mtime_ms > 0);
        let sub = listed
            .iter()
            .find(|s| s.path.ends_with("sub"))
            .expect("sub stat");
        assert!(sub.is_dir);

        let _ = fs::remove_dir_all(&root);
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("tmpdir");
        dir
    }

    #[test]
    fn stat_file_reports_a_file_a_folder_and_a_missing_path() {
        let dir = scratch_dir("stat-basic");
        fs::write(dir.join("a.md"), b"# a\n").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        let file = stat_file(dir.join("a.md").to_string_lossy().into_owned())
            .unwrap()
            .expect("file");
        assert_eq!((file.size, file.is_dir), (4, false));
        assert!(file.mtime_ms > 0);
        let sub = stat_file(dir.join("sub").to_string_lossy().into_owned())
            .unwrap()
            .expect("folder");
        assert!(sub.is_dir);
        assert!(
            stat_file(dir.join("gone.md").to_string_lossy().into_owned())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stat_file_omits_what_read_dir_omits() {
        let dir = scratch_dir("stat-denied");
        fs::create_dir(dir.join("node_modules")).unwrap();
        assert!(
            stat_file(dir.join("node_modules").to_string_lossy().into_owned())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn stat_file_refuses_a_symlink_to_a_file_or_a_folder() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("stat-link");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("filelink.md")).unwrap();
        symlink(&dir, dir.join("dirlink")).unwrap();
        for name in ["filelink.md", "dirlink"] {
            assert!(
                stat_file(dir.join(name).to_string_lossy().into_owned())
                    .unwrap()
                    .is_none(),
                "{name}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_returns_at_most_the_bytes_asked_for() {
        let dir = scratch_dir("head-limit");
        fs::write(dir.join("a.md"), b"0123456789").unwrap();
        let path = dir.join("a.md").to_string_lossy().into_owned();
        assert_eq!(read_head_bytes(&path, 4).unwrap(), b"0123");
        assert_eq!(read_head_bytes(&path, 100).unwrap(), b"0123456789");
        assert_eq!(read_head_bytes(&path, 0).unwrap(), b"");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_is_capped_whatever_the_caller_asks_for() {
        let dir = scratch_dir("head-cap");
        fs::write(dir.join("big.md"), vec![b'x'; MAX_HEAD_BYTES as usize + 10]).unwrap();
        let path = dir.join("big.md").to_string_lossy().into_owned();
        assert_eq!(
            read_head_bytes(&path, u64::MAX).unwrap().len() as u64,
            MAX_HEAD_BYTES
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_refuses_a_folder_and_reports_a_missing_file() {
        let dir = scratch_dir("head-kinds");
        assert_eq!(
            read_head_bytes(&dir.to_string_lossy(), 10)
                .unwrap_err()
                .code,
            "invalid"
        );
        assert_eq!(
            read_head_bytes(&dir.join("gone.md").to_string_lossy(), 10)
                .unwrap_err()
                .code,
            "not-found"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn read_head_refuses_a_symlink() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("head-link");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        let err = read_head_bytes(&dir.join("link.md").to_string_lossy(), 10).unwrap_err();
        assert_eq!(err.code, "invalid");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The open itself refuses a symlink at the path, whatever the type check before it saw (the swap
    /// between the check and the open), and returns at once on a FIFO.
    #[cfg(unix)]
    #[test]
    fn the_head_open_refuses_a_symlink_and_does_not_block_on_a_pipe() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("head-open");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        assert!(open_head(&dir.join("real.md")).is_ok());
        let err = open_head(&dir.join("link.md")).unwrap_err();
        assert_eq!(err.raw_os_error(), Some(libc::ELOOP));
        let pipe = dir.join("pipe.md");
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(open_head(&pipe).is_ok());
        });
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(30))
                .expect("the head open blocked on a named pipe"),
            true,
            "a FIFO opens at once (and the fstat check then refuses it)"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Opening a FIFO blocks until a writer appears, so the type is checked first. The read runs on a
    /// thread, and a missing answer is a failure rather than a hang; the bound guards against blocking.
    #[cfg(unix)]
    #[test]
    fn read_head_refuses_a_named_pipe_without_opening_it() {
        let dir = scratch_dir("head-fifo");
        let pipe = dir.join("pipe.md").to_string_lossy().into_owned();
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        let (tx, rx) = std::sync::mpsc::channel();
        let p = pipe.clone();
        std::thread::spawn(move || {
            let _ = tx.send(read_head_bytes(&p, 10).map_err(|e| e.code));
        });
        let got = rx
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("read_head blocked on a named pipe");
        assert_eq!(got, Err("invalid".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }
}
