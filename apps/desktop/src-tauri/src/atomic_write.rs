//! Byte-faithful saving: stage the new bytes beside the destination, then rename over it. The only
//! place marxy writes a reader's document (AGENTS.md non-negotiable 4, ADR-0004).
//!
//! The module depends on `std` alone so that `pnpm gate:fidelity` can compile it with a bare `rustc`
//! and drive this exact code over the corpus, instead of checking a second implementation of it.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Saves attempted in this process; part of the temporary file's name so two saves never collide.
static ATTEMPTS: AtomicU64 = AtomicU64::new(0);

/// Writes exactly `bytes` to `path`, atomically, changing nothing else about the file.
///
/// Every byte is written to a temporary file in the destination's own directory and flushed to disk
/// before a rename puts it in place, so an interrupted save leaves either the old bytes or the new
/// ones and never a truncated file. The destination's mode is carried across the rename. Anything
/// that would quietly change something the reader did not ask to change — a read-only file, a file
/// owned by someone else, a name with more than one hard link — is refused with a message rather
/// than done silently.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let target = resolve_symlink(path)?;
    let dir = parent_directory(&target)?;
    let destination = refuse_surprising_destination(&target)?;
    let tmp = temp_path_for(&target);
    let saved = stage(&tmp, &target, destination.as_ref(), bytes)
        .and_then(|()| commit(&tmp, &target, &dir));
    if saved.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    saved
}

/// Where the new bytes are staged: the destination's own directory, so the rename stays inside one
/// filesystem and is therefore atomic. A temporary file under `/tmp` would degrade to a copy across
/// devices, which is exactly the truncated-file window this avoids. Hidden, and unique per attempt
/// so that two saves of one document cannot meet in the same temporary file.
pub fn temp_path_for(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    let attempt = ATTEMPTS.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    dir.join(format!(
        ".{name}.marxy-tmp-{}-{attempt}-{nanos}",
        std::process::id()
    ))
}

/// A symlinked document is saved *through* the link: the bytes of the file it points at are replaced,
/// so the link survives instead of being quietly turned into a regular file.
fn resolve_symlink(path: &Path) -> Result<PathBuf, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path).map_err(|e| {
            format!(
                "{}: is a symlink that does not resolve: {e}",
                path.display()
            )
        }),
        _ => Ok(path.to_path_buf()),
    }
}

fn parent_directory(target: &Path) -> Result<PathBuf, String> {
    match target.parent().filter(|d| !d.as_os_str().is_empty()) {
        Some(dir) => Ok(dir.to_path_buf()),
        None => Err(format!(
            "{}: has no directory to stage a save in",
            target.display()
        )),
    }
}

/// `Ok(None)` when the destination does not exist yet; `Err` when saving would change more than the
/// bytes. Refusals are deliberate: a documented "no" is better than a surprise in someone's history.
fn refuse_surprising_destination(target: &Path) -> Result<Option<Metadata>, String> {
    let meta = match fs::metadata(target) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: cannot be inspected: {e}", target.display())),
    };
    if !meta.is_file() {
        return Err(format!(
            "{}: is not a regular file; marxy saves documents only",
            target.display()
        ));
    }
    if meta.permissions().readonly() {
        return Err(format!(
            "{}: is read-only; marxy will not overwrite it, because clearing that would change more \
             than the bytes",
            target.display()
        ));
    }
    #[cfg(unix)]
    if meta.nlink() > 1 {
        return Err(format!(
            "{}: has {} hard links, and a rename would leave the other names on the old bytes",
            target.display(),
            meta.nlink()
        ));
    }
    Ok(Some(meta))
}

/// Puts the new bytes in the temporary file, with the destination's metadata already on it.
fn stage(
    tmp: &Path,
    target: &Path,
    destination: Option<&Metadata>,
    bytes: &[u8],
) -> Result<(), String> {
    // `create_new` so a temporary path planted by someone else is an error rather than a file we
    // follow, and so two concurrent saves cannot share a staging file.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| {
            format!(
                "{}: cannot stage a save beside the destination: {e}",
                tmp.display()
            )
        })?;
    if destination.is_some() {
        // Cloning the destination onto the staging file carries its mode everywhere and, on macOS,
        // its ACL and extended attributes too (`fs::copy` is `fcopyfile` with `COPYFILE_ALL` there).
        // Copying the old contents first is wasted I/O for a document-sized file and the only way to
        // get that metadata without a libc dependency.
        fs::copy(target, tmp).map_err(|e| {
            format!(
                "{}: cannot carry the file's metadata onto the save: {e}",
                target.display()
            )
        })?;
        refuse_ownership_change(target, tmp)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(tmp)
        .map_err(|e| format!("{}: cannot be written: {e}", tmp.display()))?;
    file.write_all(bytes)
        .map_err(|e| format!("{}: cannot be written: {e}", tmp.display()))?;
    // Durability before visibility: the bytes reach the disk before any name points at them, so the
    // rename can only publish a complete file.
    file.sync_all()
        .map_err(|e| format!("{}: cannot be flushed to disk: {e}", tmp.display()))
}

/// Publishes the staged file. After this the destination is the new bytes; before it, the old ones.
fn commit(tmp: &Path, target: &Path, dir: &Path) -> Result<(), String> {
    fs::rename(tmp, target).map_err(|e| {
        format!(
            "{}: cannot be replaced with the saved file: {e}",
            target.display()
        )
    })?;
    sync_directory(dir);
    Ok(())
}

/// Flushes the directory entry so the rename itself survives a power loss. Best effort: a filesystem
/// that refuses to open a directory has already published the rename by other means.
fn sync_directory(dir: &Path) {
    #[cfg(unix)]
    let _ = File::open(dir).and_then(|handle| handle.sync_all());
    #[cfg(not(unix))]
    let _ = dir;
}

/// Refuses a save that would hand the file to a different owner. marxy cannot restore the old owner
/// without a libc dependency, so it declines instead of changing it.
#[cfg(unix)]
fn refuse_ownership_change(target: &Path, tmp: &Path) -> Result<(), String> {
    let destination = fs::metadata(target).map_err(|e| format!("{}: {e}", target.display()))?;
    let staged = fs::metadata(tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if destination.uid() != staged.uid() || destination.gid() != staged.gid() {
        return Err(format!(
            "{}: is owned by {}:{} and marxy would save it as {}:{}; refusing rather than changing \
             the owner",
            target.display(),
            destination.uid(),
            destination.gid(),
            staged.uid(),
            staged.gid()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn refuse_ownership_change(_target: &Path, _tmp: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-atomic-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    fn staged_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("marxy-tmp"))
            .collect()
    }

    /// The shapes that every plausible save path gets wrong: Windows line endings, a byte-order mark,
    /// a missing final newline, a lone carriage return, and bytes that are not text at all.
    #[test]
    fn hostile_payloads_survive_a_round_trip() {
        let dir = scratch("payloads");
        let payloads: [(&str, &[u8]); 6] = [
            ("crlf-and-bom", b"\xef\xbb\xbf# t\r\n\r\nbody\r\n"),
            ("no-trailing-newline", b"one\ntwo"),
            ("lone-cr", b"a\rb\r\nc\n"),
            ("trailing-blank-lines", b"text\n\n\n"),
            ("not-utf8", b"\x00\xff\xfe binary \x80"),
            ("empty", b""),
        ];
        for (name, bytes) in payloads {
            let target = dir.join(name);
            write_atomic(&target, bytes).expect("save");
            assert_eq!(
                fs::read(&target).expect("read back"),
                bytes,
                "{name} changed on save"
            );
        }
    }

    #[test]
    fn a_new_file_is_created() {
        let dir = scratch("new");
        let target = dir.join("fresh.md");
        write_atomic(&target, b"hello").expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"hello");
    }

    #[test]
    fn the_staging_file_is_in_the_destinations_own_directory() {
        let target = Path::new("/some/deep/place/notes.md");
        let first = temp_path_for(target);
        let second = temp_path_for(target);
        assert_eq!(
            first.parent(),
            target.parent(),
            "a rename across directories is not atomic"
        );
        assert_ne!(first, second, "two saves must not share a staging file");
        let name = first.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with('.'),
            "the staging file should not appear in a listing: {name}"
        );
    }

    #[test]
    fn a_successful_save_leaves_no_staging_file() {
        let dir = scratch("clean");
        let target = dir.join("doc.md");
        write_atomic(&target, b"one").expect("first save");
        write_atomic(&target, b"two").expect("second save");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    #[cfg(unix)]
    fn a_failed_save_leaves_no_staging_file_and_the_old_bytes_intact() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("failed");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        // Write-only: the destination is writable, so the save begins, and unreadable, so carrying its
        // metadata onto the staging file fails partway through.
        fs::set_permissions(&target, fs::Permissions::from_mode(0o200)).expect("chmod");
        let readable_anyway = File::open(&target).is_ok();
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("chmod back");
        if readable_anyway {
            return; // Running as root, where no file is unreadable; nothing to assert.
        }
        assert!(
            refused.is_err(),
            "an unreadable destination should not be saved over"
        );
        assert_eq!(fs::read(&target).expect("read back"), b"old");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// The property that makes a crash safe: the destination is never opened for writing, so a reader
    /// holding it open keeps a whole file. An in-place write would fail this with truncated bytes.
    #[test]
    fn a_reader_holding_the_file_open_still_sees_the_old_bytes() {
        let dir = scratch("reader");
        let target = dir.join("doc.md");
        fs::write(&target, b"the old bytes").expect("seed");
        let mut reader = File::open(&target).expect("open");
        write_atomic(&target, b"the new bytes, longer").expect("save");
        let mut seen = Vec::new();
        reader.read_to_end(&mut seen).expect("read");
        assert_eq!(
            seen, b"the old bytes",
            "the save was visible to an open reader"
        );
        assert_eq!(
            fs::read(&target).expect("read back"),
            b"the new bytes, longer"
        );
    }

    #[test]
    #[cfg(unix)]
    fn the_destinations_mode_survives_the_save() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("chmod");
        write_atomic(&target, b"new").expect("save");
        let mode = fs::metadata(&target).expect("stat").permissions().mode() & 0o777;
        assert_eq!(mode, 0o640, "the save changed the file's mode");
    }

    #[test]
    #[cfg(unix)]
    fn a_read_only_destination_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("readonly");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o444)).expect("chmod");
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("chmod back");
        assert!(refused
            .expect_err("expected a refusal")
            .contains("read-only"));
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    #[cfg(unix)]
    fn an_unwritable_directory_is_refused_and_the_old_bytes_survive() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("unwritable");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).expect("chmod");
        let writable_anyway = File::create(dir.join(".probe")).is_ok();
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).expect("chmod back");
        if writable_anyway {
            return; // Running as root, where no directory is unwritable; nothing to assert.
        }
        assert!(
            refused.is_err(),
            "a save into an unwritable directory should fail"
        );
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    #[cfg(unix)]
    fn a_symlinked_document_is_saved_through_the_link() {
        let dir = scratch("symlink");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, b"old").expect("seed");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        write_atomic(&link, b"new").expect("save");
        assert!(fs::symlink_metadata(&link)
            .expect("stat")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&real).expect("read back"), b"new");
    }

    #[test]
    #[cfg(unix)]
    fn a_dangling_symlink_is_refused() {
        let dir = scratch("dangling");
        let link = dir.join("link.md");
        std::os::unix::fs::symlink(dir.join("missing.md"), &link).expect("symlink");
        assert!(write_atomic(&link, b"new")
            .expect_err("expected a refusal")
            .contains("symlink"));
    }

    #[test]
    #[cfg(unix)]
    fn a_hard_linked_document_is_refused() {
        let dir = scratch("hardlink");
        let target = dir.join("doc.md");
        let other = dir.join("other.md");
        fs::write(&target, b"old").expect("seed");
        fs::hard_link(&target, &other).expect("hard link");
        assert!(write_atomic(&target, b"new")
            .expect_err("expected a refusal")
            .contains("hard links"));
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    fn a_directory_is_not_a_document() {
        let dir = scratch("directory");
        let target = dir.join("sub");
        fs::create_dir(&target).expect("mkdir");
        assert!(write_atomic(&target, b"new")
            .expect_err("expected a refusal")
            .contains("regular file"));
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// macOS is the only platform where `std` carries extended attributes across a copy, so this is
    /// the only platform that can assert it. It skips when the `xattr` tool is missing.
    #[test]
    #[cfg(target_os = "macos")]
    fn extended_attributes_survive_the_save_on_macos() {
        let dir = scratch("xattr");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        let path = target.to_string_lossy().into_owned();
        let set = std::process::Command::new("xattr")
            .args(["-w", "com.marxy.test", "kept", &path])
            .status();
        match set {
            Ok(status) if status.success() => {}
            _ => return, // No `xattr` on this machine; nothing to assert.
        }
        write_atomic(&target, b"new").expect("save");
        let read = std::process::Command::new("xattr")
            .args(["-p", "com.marxy.test", &path])
            .output()
            .expect("xattr -p");
        assert_eq!(String::from_utf8_lossy(&read.stdout).trim(), "kept");
    }
}
