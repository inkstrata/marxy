//! Byte-faithful saving: stage the new bytes beside the destination, then rename over it. The only
//! place marxy writes a reader's document (AGENTS.md non-negotiable 4, ADR-0004).
//!
//! The module depends on `std` and, on Linux, xattr syscalls declared inline so that
//! `pnpm gate:fidelity` can compile it with a bare `rustc` and drive this exact code over the
//! corpus, instead of checking a second implementation of it.

use std::fmt;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Refusal vs I/O failure for the shell boundary (MARXY-49); message is shown to the reader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteErrorKind {
    Permission,
    Io,
    /// A create-only write found something at the name (F-85, ADR-0074); nothing was written.
    Exists,
}

#[derive(Debug, Clone)]
pub struct WriteError {
    pub kind: WriteErrorKind,
    pub message: String,
}

impl WriteError {
    fn permission(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Permission,
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Io,
            message: message.into(),
        }
    }

    fn exists(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Exists,
            message: message.into(),
        }
    }
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

#[cfg(unix)]
use std::os::unix::fs::{chown, MetadataExt};

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
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
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

/// Writes exactly `bytes` at `path` only if nothing is there, and otherwise writes nothing (F-85, ADR-0074).
///
/// "Nothing" is exact: a file, a folder, a symlink, a symlink that leads nowhere, and on a case-insensitive
/// volume a name that differs only in case all count as something, and the answer is `WriteErrorKind::Exists`.
/// A link at `path` is never followed (`write_atomic` writes through one on purpose; this never does).
///
/// The bytes are staged and flushed in a hidden temporary file in the destination's own directory, exactly as
/// `write_atomic` does, and the name is then made to appear by an *exclusive* rename: the kernel decides
/// "nothing is at this name" and "this name is now the file" in one step, so a creator racing this write
/// cannot be replaced (there is no look-then-write window). When the volume or kernel does not support the
/// exclusive rename, `link` then `unlink` is used, which is also exclusive; when that is refused too the write
/// fails and writes nothing. A failed write removes its temporary file.
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let dir = parent_directory(path)?;
    // A cheap, early and readable refusal. It is not what makes the write safe: the exclusive commit below is.
    refuse_taken_name(path)?;
    let tmp = temp_path_for(path);
    let created = stage_new(&tmp, bytes).and_then(|()| {
        commit_new(&tmp, path, &dir, &exclusive::rename, &|from, to| {
            fs::hard_link(from, to)
        })
    });
    if created.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    created
}

/// `Err(Exists)` when anything at all is at `path`, a link that leads nowhere and a folder included.
fn refuse_taken_name(path: &Path) -> Result<(), WriteError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            let what = if meta.file_type().is_symlink() {
                "symbolic link"
            } else if meta.is_dir() {
                "folder"
            } else {
                "file"
            };
            Err(taken(path, what))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(WriteError::io(format!(
            "{}: cannot be inspected: {e}",
            path.display()
        ))),
    }
}

fn taken(path: &Path, what: &str) -> WriteError {
    WriteError::exists(format!(
        "{}: there is already a {what} with this name; marxy will not replace it",
        path.display()
    ))
}

/// Puts the new bytes in the temporary file, which nothing else can already hold (`create_new`).
fn stage_new(tmp: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| {
            WriteError::io(format!(
                "{}: cannot stage a new file beside the destination: {e}",
                tmp.display()
            ))
        })?;
    file.write_all(bytes)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    file.sync_all()
        .map_err(|e| WriteError::io(format!("{}: cannot be flushed to disk: {e}", tmp.display())))
}

/// The refusal when neither exclusive way of publishing a file is available.
const VOLUME_CANNOT: &str = "this volume cannot create a file without risk of replacing one";

/// Publishes the staged file at `target` only if nothing is there. `exclusive` is the kernel's exclusive
/// rename and `link` is the fallback; both are parameters so a test can make either one refuse.
fn commit_new(
    tmp: &Path,
    target: &Path,
    dir: &Path,
    exclusive: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
    link: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), WriteError> {
    use std::io::ErrorKind;
    match exclusive(tmp, target) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            return Err(taken(target, "file or folder"))
        }
        // Unsupported (macOS ENOTSUP, ENOSYS) and InvalidInput (Linux EINVAL for a flag the filesystem lacks):
        // the exclusive rename is not available here, so the other exclusive way is used.
        Err(e) if matches!(e.kind(), ErrorKind::Unsupported | ErrorKind::InvalidInput) => {
            match link(tmp, target) {
                Ok(()) => {
                    // The file now has two names; the staging one is dropped so it has one. If that drop fails
                    // the file is still complete and in place, so it is not an error of the write.
                    let _ = fs::remove_file(tmp);
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    return Err(taken(target, "file or folder"))
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::Unsupported | ErrorKind::PermissionDenied
                    ) =>
                {
                    return Err(WriteError::io(format!(
                        "{}: {VOLUME_CANNOT} ({e})",
                        target.display()
                    )))
                }
                Err(e) => {
                    return Err(WriteError::io(format!(
                        "{}: cannot be created: {e}",
                        target.display()
                    )))
                }
            }
        }
        Err(e) => {
            return Err(WriteError::io(format!(
                "{}: cannot be created: {e}",
                target.display()
            )))
        }
    }
    sync_directory(dir);
    Ok(())
}

/// The kernel's exclusive rename: `rename`, but failing `AlreadyExists` instead of replacing whatever is at
/// the destination (a file, a folder or a link, which it does not follow). Declared inline so the fidelity
/// gate can compile this module with a bare `rustc`.
#[cfg(unix)]
mod exclusive {
    use std::io;
    use std::path::Path;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use std::ffi::{c_char, c_int, c_uint, CString};
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use std::os::unix::ffi::OsStrExt;

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
    }
    /// `RENAME_EXCL` in `<stdio.h>`.
    #[cfg(target_os = "macos")]
    const RENAME_EXCL: c_uint = 0x0000_0004;

    #[cfg(target_os = "linux")]
    unsafe extern "C" {
        fn renameat2(
            olddirfd: c_int,
            oldpath: *const c_char,
            newdirfd: c_int,
            newpath: *const c_char,
            flags: c_uint,
        ) -> c_int;
    }
    #[cfg(target_os = "linux")]
    const AT_FDCWD: c_int = -100;
    /// `RENAME_NOREPLACE` in `<linux/fs.h>`.
    #[cfg(target_os = "linux")]
    const RENAME_NOREPLACE: c_uint = 1;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
        let from = CString::new(from.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        let to = CString::new(to.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        // SAFETY: both are valid, NUL-terminated C strings that outlive the call.
        #[cfg(target_os = "macos")]
        let rc = unsafe { renamex_np(from.as_ptr(), to.as_ptr(), RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let rc = unsafe {
            renameat2(
                AT_FDCWD,
                from.as_ptr(),
                AT_FDCWD,
                to.as_ptr(),
                RENAME_NOREPLACE,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// Other Unixes have no exclusive rename declared here: `Unsupported` sends the caller to `link`.
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    pub fn rename(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

/// Without an exclusive rename, `link` (which never replaces) is the only way.
#[cfg(not(unix))]
mod exclusive {
    use std::io;
    use std::path::Path;

    pub fn rename(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
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
    let suffix = format!(".marxy-tmp-{}-{attempt}-{nanos}", std::process::id());
    // A file name is at most 255 bytes on the filesystems we save to. A long document name would
    // push the staging name over that and fail the save, so the name portion is cut to fit.
    let room = 255usize.saturating_sub(1 + suffix.len());
    let name = truncate_on_char_boundary(name, room);
    dir.join(format!(".{name}{suffix}"))
}

fn truncate_on_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// A symlinked document is saved *through* the link: the bytes of the file it points at are replaced,
/// so the link survives instead of being quietly turned into a regular file.
fn resolve_symlink(path: &Path) -> Result<PathBuf, WriteError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path).map_err(|e| {
            WriteError::io(format!(
                "{}: is a symlink that does not resolve: {e}",
                path.display()
            ))
        }),
        _ => Ok(path.to_path_buf()),
    }
}

fn parent_directory(target: &Path) -> Result<PathBuf, WriteError> {
    match target.parent().filter(|d| !d.as_os_str().is_empty()) {
        Some(dir) => Ok(dir.to_path_buf()),
        None => Err(WriteError::io(format!(
            "{}: has no directory to stage a save in",
            target.display()
        ))),
    }
}

/// `Ok(None)` when the destination does not exist yet; `Err` when saving would change more than the
/// bytes. Refusals are deliberate: a documented "no" is better than a surprise in someone's history.
fn refuse_surprising_destination(target: &Path) -> Result<Option<Metadata>, WriteError> {
    let meta = match fs::metadata(target) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(WriteError::io(format!(
                "{}: cannot be inspected: {e}",
                target.display()
            )))
        }
    };
    if !meta.is_file() {
        return Err(WriteError::permission(format!(
            "{}: is not a regular file; marxy saves documents only",
            target.display()
        )));
    }
    if meta.permissions().readonly() {
        return Err(WriteError::permission(format!(
            "{}: is read-only; marxy will not overwrite it, because clearing that would change more \
             than the bytes",
            target.display()
        )));
    }
    #[cfg(unix)]
    if meta.nlink() > 1 {
        return Err(WriteError::permission(format!(
            "{}: has {} hard links, and a rename would leave the other names on the old bytes",
            target.display(),
            meta.nlink()
        )));
    }
    Ok(Some(meta))
}

/// Puts the new bytes in the temporary file, with the destination's metadata already on it.
fn stage(
    tmp: &Path,
    target: &Path,
    destination: Option<&Metadata>,
    bytes: &[u8],
) -> Result<(), WriteError> {
    // `create_new` so a temporary path planted by someone else is an error rather than a file we
    // follow, and so two concurrent saves cannot share a staging file.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| {
            WriteError::io(format!(
                "{}: cannot stage a save beside the destination: {e}",
                tmp.display()
            ))
        })?;
    if destination.is_some() {
        // Cloning the destination onto the staging file carries its mode everywhere and, on macOS,
        // its ACL and extended attributes too (`fs::copy` is `fcopyfile` with `COPYFILE_ALL` there).
        // On Linux `fs::copy` is a data+mode copy, so extended attributes and POSIX ACLs are
        // written afterwards from the same syscalls the kernel uses. Copying the old contents first
        // is wasted I/O for a document-sized file and the only way to get that metadata from `std`
        // on macOS without a crate.
        fs::copy(target, tmp).map_err(|e| {
            WriteError::io(format!(
                "{}: cannot carry the file's metadata onto the save: {e}",
                target.display()
            ))
        })?;
        #[cfg(target_os = "linux")]
        linux_xattr::copy_from(target, tmp).map_err(WriteError::io)?;
        refuse_ownership_change(target, tmp)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(tmp)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    file.write_all(bytes)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    // Durability before visibility: the bytes reach the disk before any name points at them, so the
    // rename can only publish a complete file.
    file.sync_all()
        .map_err(|e| WriteError::io(format!("{}: cannot be flushed to disk: {e}", tmp.display())))
}

/// Publishes the staged file. After this the destination is the new bytes; before it, the old ones.
fn commit(tmp: &Path, target: &Path, dir: &Path) -> Result<(), WriteError> {
    fs::rename(tmp, target).map_err(|e| {
        WriteError::io(format!(
            "{}: cannot be replaced with the saved file: {e}",
            target.display()
        ))
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

/// True when the staged file would belong to a different user than the destination. A group
/// mismatch is not a refusal: `refuse_ownership_change` restores the group so a save into a
/// directory whose group is not the user's own still succeeds.
fn ownership_refuses(destination_uid: u32, staged_uid: u32) -> bool {
    destination_uid != staged_uid
}

/// Refuses a save that would hand the file to a different user. A group mismatch is restored
/// when the process can set that group (a user may chown a file they own to a group they belong
/// to); only if that restore fails, or the owning user would change, does the save refuse.
#[cfg(unix)]
fn refuse_ownership_change(target: &Path, tmp: &Path) -> Result<(), WriteError> {
    let destination =
        fs::metadata(target).map_err(|e| WriteError::io(format!("{}: {e}", target.display())))?;
    let staged =
        fs::metadata(tmp).map_err(|e| WriteError::io(format!("{}: {e}", tmp.display())))?;
    if ownership_refuses(destination.uid(), staged.uid()) {
        return Err(WriteError::permission(format!(
            "{}: is owned by {} and marxy would save it as {}; refusing rather than changing \
             the owner",
            target.display(),
            destination.uid(),
            staged.uid()
        )));
    }
    if destination.gid() != staged.gid() {
        chown(tmp, None, Some(destination.gid())).map_err(|_| {
            WriteError::permission(format!(
                "{}: is owned by {}:{} and marxy would save it as {}:{}; refusing rather than \
                 changing the owner",
                target.display(),
                destination.uid(),
                destination.gid(),
                staged.uid(),
                staged.gid()
            ))
        })?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn refuse_ownership_change(_target: &Path, _tmp: &Path) -> Result<(), WriteError> {
    Ok(())
}

/// Linux `listxattr(2)` / `getxattr(2)` / `setxattr(2)`, declared inline so the fidelity gate can
/// still compile this module with a bare `rustc`. POSIX ACLs are the `system.posix_acl_*`
/// attributes; copying every user and ACL name is what stops a save from silently dropping them.
#[cfg(target_os = "linux")]
mod linux_xattr {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    unsafe extern "C" {
        fn listxattr(path: *const c_char, list: *mut c_char, size: usize) -> isize;
        fn getxattr(
            path: *const c_char,
            name: *const c_char,
            value: *mut c_void,
            size: usize,
        ) -> isize;
        fn setxattr(
            path: *const c_char,
            name: *const c_char,
            value: *const c_void,
            size: usize,
            flags: c_int,
        ) -> c_int;
    }

    /// `ENOTSUP` / `EOPNOTSUPP` on Linux; the errno a filesystem returns when it has no xattrs.
    const ENOTSUP: i32 = 95;
    /// `ENOSYS`: the kernel has no xattr syscalls at all.
    const ENOSYS: i32 = 38;

    fn c_path(path: &Path) -> io::Result<CString> {
        CString::new(path.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
    }

    fn c_name(name: &str) -> io::Result<CString> {
        CString::new(name).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
    }

    /// True only when the filesystem (or kernel) genuinely cannot store extended attributes.
    pub fn filesystem_lacks_support(err: &io::Error) -> bool {
        matches!(err.raw_os_error(), Some(ENOTSUP) | Some(ENOSYS))
    }

    fn must_preserve(name: &str) -> bool {
        name.starts_with("user.")
            || name == "system.posix_acl_access"
            || name == "system.posix_acl_default"
    }

    pub fn list_names(path: &Path) -> io::Result<Vec<String>> {
        let c = c_path(path)?;
        // SAFETY: `c` is a valid C string; a null buffer with size 0 is the documented size query.
        let mut size = unsafe { listxattr(c.as_ptr(), std::ptr::null_mut(), 0) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        if size == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is `size` writable bytes, which is what the previous query returned.
        size = unsafe { listxattr(c.as_ptr(), buf.as_mut_ptr() as *mut c_char, buf.len()) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        buf.truncate(size as usize);
        Ok(buf
            .split(|&b| b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect())
    }

    pub fn get(path: &Path, name: &str) -> io::Result<Vec<u8>> {
        let c = c_path(path)?;
        let n = c_name(name)?;
        // SAFETY: both pointers are valid C strings; a null buffer with size 0 queries the length.
        let mut size = unsafe { getxattr(c.as_ptr(), n.as_ptr(), std::ptr::null_mut(), 0) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is `size` writable bytes, matching the query.
        size = unsafe {
            getxattr(
                c.as_ptr(),
                n.as_ptr(),
                buf.as_mut_ptr() as *mut c_void,
                buf.len(),
            )
        };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        buf.truncate(size as usize);
        Ok(buf)
    }

    pub fn set(path: &Path, name: &str, value: &[u8]) -> io::Result<()> {
        let c = c_path(path)?;
        let n = c_name(name)?;
        // SAFETY: path and name are valid C strings; `value` is `value.len()` readable bytes.
        let rc = unsafe {
            setxattr(
                c.as_ptr(),
                n.as_ptr(),
                value.as_ptr() as *const c_void,
                value.len(),
                0,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// A POSIX ACL xattr with a named user (`nobody`) so a mode-only copy cannot fake preservation.
    #[cfg(test)]
    pub fn named_user_acl(uid: u32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&2u32.to_le_bytes());
        const UNDEF: u32 = 0xffff_ffff;
        let mut entry = |tag: u16, perm: u16, id: u32| {
            out.extend_from_slice(&tag.to_le_bytes());
            out.extend_from_slice(&perm.to_le_bytes());
            out.extend_from_slice(&id.to_le_bytes());
        };
        entry(0x01, 6, UNDEF); // ACL_USER_OBJ rw
        entry(0x02, 4, uid); // ACL_USER r
        entry(0x04, 4, UNDEF); // ACL_GROUP_OBJ r
        entry(0x10, 4, UNDEF); // ACL_MASK r
        entry(0x20, 4, UNDEF); // ACL_OTHER r
        out
    }

    pub fn copy_from(from: &Path, to: &Path) -> Result<(), String> {
        let names = match list_names(from) {
            Ok(names) => names,
            Err(err) if filesystem_lacks_support(&err) => return Ok(()),
            Err(err) => {
                return Err(format!(
                    "{}: cannot read extended attributes: {err}",
                    from.display()
                ))
            }
        };
        for name in names {
            let value = get(from, &name).map_err(|e| {
                format!(
                    "{}: cannot read extended attribute {name}: {e}",
                    from.display()
                )
            })?;
            if let Err(err) = set(to, &name, &value) {
                if must_preserve(&name) {
                    return Err(format!(
                        "{}: cannot keep extended attribute {name}: {err}",
                        from.display()
                    ));
                }
            }
        }
        Ok(())
    }
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
    fn a_long_document_name_still_gets_a_staging_name_that_fits() {
        // 250 ASCII bytes, and 3-byte characters so the cut has a boundary to respect.
        for stem in ["a".repeat(247), "é".repeat(122), "日".repeat(82)] {
            let name = format!("{stem}.md");
            assert!(name.len() <= 255, "the document name itself is legal");
            let staged = temp_path_for(Path::new("/some/dir").join(&name).as_path());
            let staged_name = staged.file_name().unwrap().to_string_lossy().into_owned();
            assert!(staged_name.len() <= 255, "{} bytes", staged_name.len());
            assert!(staged_name.starts_with('.') && staged_name.contains(".marxy-tmp-"));
        }
        let dir = scratch("long-name");
        let target = dir.join(format!("{}.md", "a".repeat(247)));
        write_atomic(&target, b"long").expect("save under a near-limit name");
        assert_eq!(fs::read(&target).expect("read back"), b"long");
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
        let err = refused.expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("read-only"));
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
        let err = write_atomic(&link, b"new").expect_err("expected a refusal");
        assert!(err.message.contains("symlink"));
    }

    #[test]
    #[cfg(unix)]
    fn a_hard_linked_document_is_refused() {
        let dir = scratch("hardlink");
        let target = dir.join("doc.md");
        let other = dir.join("other.md");
        fs::write(&target, b"old").expect("seed");
        fs::hard_link(&target, &other).expect("hard link");
        let err = write_atomic(&target, b"new").expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("hard links"));
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    fn a_directory_is_not_a_document() {
        let dir = scratch("directory");
        let target = dir.join("sub");
        fs::create_dir(&target).expect("mkdir");
        let err = write_atomic(&target, b"new").expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("regular file"));
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

    /// The case `refuse_ownership_change` still refuses: a different owning user. A different
    /// group is restored, so a save into a directory whose group is not the user's own succeeds.
    #[test]
    fn refuse_ownership_change_refuses_a_uid_mismatch() {
        assert!(
            ownership_refuses(501, 0),
            "a file owned by someone else is the case the save refuses"
        );
        assert!(
            !ownership_refuses(501, 501),
            "a file we own is not refused for the uid"
        );
    }

    /// A supplementary group the process belongs to, so the tests can chown without root.
    #[cfg(unix)]
    fn supplementary_gid() -> Option<u32> {
        let output = std::process::Command::new("id").arg("-G").output().ok()?;
        let gids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();
        let primary = gids.first().copied()?;
        gids.into_iter().find(|&g| g != primary)
    }

    #[test]
    #[cfg(unix)]
    fn a_file_whose_group_differs_from_the_process_keeps_its_group_on_save() {
        let Some(gid) = supplementary_gid() else {
            panic!(
                "process has no supplementary group, so the narrowed ownership check cannot be proved"
            );
        };
        let dir = scratch("group-restore");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        chown(&target, None, Some(gid)).expect("chgrp the destination to a supplementary group");
        write_atomic(&target, b"new").expect("a group mismatch must be restored, not refused");
        assert_eq!(fs::read(&target).expect("read back"), b"new");
        assert_eq!(
            fs::metadata(&target).expect("stat").gid(),
            gid,
            "the save changed the file's group"
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_save_into_a_directory_whose_group_differs_from_the_users_own_succeeds() {
        let Some(gid) = supplementary_gid() else {
            panic!(
                "process has no supplementary group, so a different-group directory cannot be set up"
            );
        };
        let dir = scratch("dir-group");
        chown(&dir, None, Some(gid)).expect("chgrp the directory");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        write_atomic(&target, b"new")
            .expect("saving into a different-group directory must succeed");
        assert_eq!(fs::read(&target).expect("read back"), b"new");
    }

    /// Sets `user.marxy.test`, saves through the real path, and reads the attribute back. POSIX
    /// ACLs are asserted the same way when the filesystem accepts them. The only skip is
    /// `filesystem_lacks_support`; a catch-all skip fails the fidelity gate.
    #[test]
    #[cfg(target_os = "linux")]
    fn extended_attributes_and_posix_acls_survive_the_save_on_linux() {
        let dir = scratch("linux-xattr");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");

        match linux_xattr::set(&target, "user.marxy.test", b"kept") {
            Ok(()) => {}
            Err(err) if linux_xattr::filesystem_lacks_support(&err) => {
                println!(
                    "linux-xattr: skipped: filesystem does not support extended attributes ({err})"
                );
                return;
            }
            Err(err) => panic!("setting user.marxy.test failed: {err}"),
        }

        let acl = linux_xattr::named_user_acl(65534);
        let acl_set = match linux_xattr::set(&target, "system.posix_acl_access", &acl) {
            Ok(()) => true,
            Err(err) if linux_xattr::filesystem_lacks_support(&err) => {
                println!("linux-acl: skipped: filesystem does not support POSIX ACLs ({err})");
                false
            }
            Err(err) => panic!("setting POSIX ACL failed: {err}"),
        };

        write_atomic(&target, b"new").expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"new");

        let value = linux_xattr::get(&target, "user.marxy.test").expect("read xattr back");
        assert_eq!(&value, b"kept", "the save dropped user.marxy.test");
        println!("linux-xattr: preserved");

        if acl_set {
            let got = linux_xattr::get(&target, "system.posix_acl_access").expect("read ACL back");
            assert_eq!(got, acl, "the save dropped the POSIX ACL");
            println!("linux-acl: preserved");
        }
    }
}

/// `write_new` (F-85, ADR-0074): create-only. Every refusal here must leave the name exactly as it was and
/// no staging file beside it.
#[cfg(test)]
mod write_new_tests {
    use super::*;
    use std::io::ErrorKind;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-new-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    /// Every name in `dir`, hidden staging files included, sorted.
    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        out.sort();
        out
    }

    fn assert_refused_exists(result: Result<(), WriteError>) -> WriteError {
        let err = result.expect_err("a create-only write onto a taken name must fail");
        assert_eq!(
            err.kind,
            WriteErrorKind::Exists,
            "wrong refusal: {}",
            err.message
        );
        assert!(!err.message.is_empty());
        err
    }

    #[test]
    fn write_new_onto_a_free_name_writes_the_bytes() {
        let dir = scratch("free");
        let target = dir.join("fresh (fork).md");
        let bytes: &[u8] = b"\xef\xbb\xbf# t\r\n\r\nbody\r\n\x00\xff";
        write_new(&target, bytes).expect("create");
        assert_eq!(fs::read(&target).expect("read back"), bytes);
        assert_eq!(
            names(&dir),
            vec!["fresh (fork).md".to_string()],
            "no staging file remains"
        );
    }

    #[test]
    fn write_new_onto_an_existing_file_fails_exists_and_the_file_is_unchanged() {
        let dir = scratch("file");
        let target = dir.join("doc.md");
        fs::write(&target, b"mine").expect("seed");
        assert_refused_exists(write_new(&target, b"theirs"));
        assert_eq!(fs::read(&target).expect("read back"), b"mine");
        assert_eq!(
            names(&dir),
            vec!["doc.md".to_string()],
            "no staging file remains"
        );
    }

    #[test]
    fn write_new_onto_a_folder_fails_exists_and_the_folder_is_unchanged() {
        let dir = scratch("folder");
        let target = dir.join("folder.md");
        fs::create_dir(&target).expect("seed");
        fs::write(target.join("inside.txt"), b"in").expect("seed inside");
        assert_refused_exists(write_new(&target, b"x"));
        assert!(target.is_dir());
        assert_eq!(fs::read(target.join("inside.txt")).expect("inside"), b"in");
        assert_eq!(names(&dir), vec!["folder.md".to_string()]);
    }

    #[test]
    #[cfg(unix)]
    fn write_new_onto_a_symlink_fails_exists_and_neither_the_link_nor_its_file_changes() {
        let dir = scratch("symlink");
        let real = dir.join("real.md");
        let link = dir.join("x (mine).md");
        fs::write(&real, b"the other file").expect("seed");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        assert_refused_exists(write_new(&link, b"copy"));
        assert_eq!(
            fs::read(&real).expect("real"),
            b"the other file",
            "the file the link points at was written through"
        );
        assert_eq!(fs::read_link(&link).expect("still a link"), real);
        assert_eq!(
            names(&dir),
            vec!["real.md".to_string(), "x (mine).md".to_string()]
        );
    }

    #[test]
    #[cfg(unix)]
    fn write_new_onto_a_dangling_symlink_fails_exists_and_creates_nothing_at_its_destination() {
        let dir = scratch("dangling-new");
        let missing = dir.join("missing.md");
        let link = dir.join("link.md");
        std::os::unix::fs::symlink(&missing, &link).expect("symlink");
        assert_refused_exists(write_new(&link, b"copy"));
        assert!(
            !missing.exists(),
            "the write created the file the dangling link led to"
        );
        assert_eq!(fs::read_link(&link).expect("still a link"), missing);
        assert_eq!(names(&dir), vec!["link.md".to_string()]);
    }

    /// On a case-insensitive volume (the APFS default) `Notes (Fork).md` is the same name as `notes (fork).md`.
    /// Skipped, loudly, where the volume is case-sensitive: there the two really are different names.
    #[test]
    fn write_new_onto_a_case_variant_of_an_existing_name_fails_on_a_case_insensitive_volume() {
        let dir = scratch("case");
        let existing = dir.join("Notes (fork).md");
        fs::write(&existing, b"mine").expect("seed");
        let variant = dir.join("notes (FORK).md");
        if fs::symlink_metadata(&variant).is_err() {
            println!("case-insensitive: skipped: this volume is case-sensitive, so a case variant is a different name");
            write_new(&variant, b"x").expect("a different name is free");
            return;
        }
        assert_refused_exists(write_new(&variant, b"theirs"));
        assert_eq!(fs::read(&existing).expect("read back"), b"mine");
        assert_eq!(
            names(&dir),
            vec!["Notes (fork).md".to_string()],
            "no second name, no staging file"
        );
    }

    /// The race itself: a creator appears after the early look and before the commit. The exclusive commit
    /// must refuse and leave the creator's bytes, and the staged file must be gone.
    #[test]
    fn a_creator_that_appears_before_the_commit_is_not_replaced() {
        let dir = scratch("race-commit");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        fs::write(&target, b"the racing creator").expect("the creator wins the name");
        let err = assert_refused_exists(commit_new(
            &tmp,
            &target,
            &dir,
            &exclusive::rename,
            &|a, b| fs::hard_link(a, b),
        ));
        assert_eq!(fs::read(&target).expect("read back"), b"the racing creator");
        // `write_new` removes the staging file on any failure; `commit_new` alone leaves that to it.
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), vec!["doc (fork).md".to_string()]);
        assert!(err.message.contains("will not replace"));
    }

    /// The same race through the link fallback, with the exclusive rename made to refuse.
    #[test]
    fn a_creator_that_appears_before_the_link_fallback_is_not_replaced() {
        let dir = scratch("race-link");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        fs::write(&target, b"the racing creator").expect("creator");
        let unsupported = |_: &Path, _: &Path| Err(ErrorKind::Unsupported.into());
        assert_refused_exists(commit_new(&tmp, &target, &dir, &unsupported, &|a, b| {
            fs::hard_link(a, b)
        }));
        assert_eq!(fs::read(&target).expect("read back"), b"the racing creator");
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), vec!["doc (fork).md".to_string()]);
    }

    #[test]
    fn when_the_exclusive_rename_is_unsupported_link_and_unlink_create_the_file() {
        let dir = scratch("fallback");
        for kind in [ErrorKind::Unsupported, ErrorKind::InvalidInput] {
            let refuse = move |_: &Path, _: &Path| Err(kind.into());
            let target = dir.join(format!("{kind:?}.md"));
            let tmp = temp_path_for(&target);
            stage_new(&tmp, b"mine").expect("stage");
            commit_new(&tmp, &target, &dir, &refuse, &|a, b| fs::hard_link(a, b))
                .expect("link fallback");
            assert_eq!(fs::read(&target).expect("read back"), b"mine");
            assert!(!tmp.exists(), "the staging name was not unlinked");
        }
        assert_eq!(
            names(&dir),
            vec!["InvalidInput.md".to_string(), "Unsupported.md".to_string()]
        );
    }

    #[test]
    fn when_neither_exclusive_way_is_available_it_fails_saying_so_and_writes_nothing() {
        let dir = scratch("no-way");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        let unsupported = |_: &Path, _: &Path| Err(ErrorKind::Unsupported.into());
        let refused = |_: &Path, _: &Path| Err(ErrorKind::PermissionDenied.into());
        let err = commit_new(&tmp, &target, &dir, &unsupported, &refused).expect_err("must fail");
        assert_eq!(err.kind, WriteErrorKind::Io);
        assert!(
            err.message
                .contains("this volume cannot create a file without risk of replacing one"),
            "{}",
            err.message
        );
        assert!(!target.exists(), "the name was created");
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_failed_write_new_leaves_no_staging_file() {
        // A directory that is not there: staging fails, and nothing is left anywhere.
        let dir = scratch("no-dir");
        let target = dir.join("missing-folder").join("doc.md");
        let err = write_new(&target, b"x").expect_err("must fail");
        assert_eq!(err.kind, WriteErrorKind::Io);
        assert_eq!(names(&dir), Vec::<String>::new());
    }

    /// Many creators at one name: exactly one wins and its bytes are whole; every other fails `Exists`;
    /// nothing is left behind. Check-then-write would let more than one succeed.
    #[test]
    fn concurrent_creators_at_one_name_have_exactly_one_winner() {
        use std::sync::{Arc, Barrier};
        for round in 0..20 {
            let dir = scratch(&format!("concurrent-{round}"));
            let target = Arc::new(dir.join("doc (fork).md"));
            let creators = 8usize;
            let start = Arc::new(Barrier::new(creators));
            let handles: Vec<_> = (0..creators)
                .map(|i| {
                    let target = Arc::clone(&target);
                    let start = Arc::clone(&start);
                    std::thread::spawn(move || {
                        let bytes =
                            format!("creator {i} {}", "x".repeat(4096 * (i + 1))).into_bytes();
                        start.wait();
                        (i, bytes.clone(), write_new(&target, &bytes))
                    })
                })
                .collect();
            let results: Vec<_> = handles
                .into_iter()
                .map(|h| h.join().expect("thread"))
                .collect();
            let winners: Vec<_> = results.iter().filter(|(_, _, r)| r.is_ok()).collect();
            assert_eq!(
                winners.len(),
                1,
                "round {round}: {} creators succeeded",
                winners.len()
            );
            for (i, _, result) in &results {
                if let Err(err) = result {
                    assert_eq!(
                        err.kind,
                        WriteErrorKind::Exists,
                        "creator {i}: {}",
                        err.message
                    );
                }
            }
            assert_eq!(
                fs::read(&*target).expect("read back"),
                winners[0].1,
                "the file is not the winner's whole bytes"
            );
            assert_eq!(
                names(&dir),
                vec!["doc (fork).md".to_string()],
                "round {round}: a staging file remains"
            );
        }
    }

    /// The kernel's own exclusive rename, called directly: it must refuse every kind of occupant rather than
    /// replace it, and it must not be the `Unsupported` that would silently route everything to `link`.
    #[test]
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn the_exclusive_rename_refuses_a_file_a_folder_a_link_and_a_dangling_link() {
        let dir = scratch("excl");
        let occupants = ["file", "folder", "link", "dangling"];
        for name in occupants {
            let tmp = dir.join(format!(".stage-{name}"));
            fs::write(&tmp, b"mine").expect("stage");
            let target = dir.join(name);
            match name {
                "file" => fs::write(&target, b"theirs").expect("seed"),
                "folder" => fs::create_dir(&target).expect("seed"),
                "link" => {
                    fs::write(dir.join("real"), b"theirs").expect("real");
                    std::os::unix::fs::symlink(dir.join("real"), &target).expect("link")
                }
                _ => std::os::unix::fs::symlink(dir.join("nowhere"), &target).expect("dangling"),
            }
            let err = exclusive::rename(&tmp, &target).expect_err("must not replace");
            assert_eq!(err.kind(), ErrorKind::AlreadyExists, "{name}: {err}");
            assert_eq!(fs::read(&tmp).expect("stage kept"), b"mine");
        }
        assert_eq!(fs::read(dir.join("file")).expect("file"), b"theirs");
        assert_eq!(fs::read(dir.join("real")).expect("real"), b"theirs");
        assert!(!dir.join("nowhere").exists());
        let free = dir.join("free");
        exclusive::rename(&dir.join(".stage-file"), &free).expect("a free name is taken");
        assert_eq!(fs::read(&free).expect("free"), b"mine");
    }

    #[test]
    #[cfg(unix)]
    fn the_new_file_is_an_ordinary_one_with_one_name() {
        use std::os::unix::fs::MetadataExt;
        let dir = scratch("one-name");
        let target = dir.join("doc.md");
        write_new(&target, b"x").expect("create");
        let meta = fs::metadata(&target).expect("meta");
        assert!(meta.is_file());
        assert_eq!(
            meta.nlink(),
            1,
            "the staging name must not remain as a second link"
        );
    }
}
