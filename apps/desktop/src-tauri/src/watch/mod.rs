//! Directory watch for the open document's folder: non-recursive scan/diff plus, in the
//! shipped binary, a `notify` thread (`spawn_notify.rs`) on the folder and symlink target parents.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// What a directory's entries are, read in one enumeration. On Windows each record of the listing already carries the
/// file's id, its attributes, size and write time, so there is no open per file (a `lstat` there is a handle per file)
/// and no second listing for the ids. NTFS keeps a file's id across a rename or a move within its volume, as an inode
/// does; std keeps `MetadataExt::file_index` unstable, so before the ids came from here every file had id 0 and never
/// paired. Std only, the system calls declared here, so this file still compiles on its own
/// (`packages/core/src/position/watch-rust.test.ts`).
pub(crate) mod ids {
    use std::ffi::OsString;
    use std::fs;
    use std::io;
    use std::path::Path;

    use super::{file_id, FileId};

    /// What the listing says an entry is. `Other` is every entry whose kind the listing cannot settle: a symlink, and
    /// on Windows any reparse point (a symlink, a junction, a cloud placeholder: the record has the attribute, not the
    /// tag). The caller asks the file itself for those, as it did for every entry before.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum Kind {
        File,
        Dir,
        Other,
    }

    pub(crate) struct Listed {
        pub(crate) name: OsString,
        pub(crate) kind: Kind,
        /// Time, size and id as the listing has them; `link` is never set here.
        pub(crate) id: FileId,
    }

    impl Listed {
        /// The listing's id with the time and size of `meta`, for an entry the listing could not settle.
        pub(crate) fn with_meta(&self, meta: &fs::Metadata) -> FileId {
            FileId {
                ino: self.id.ino,
                ..file_id(meta)
            }
        }
    }

    /// The entries directly in `dir`. An error only when it cannot be listed at all.
    pub(crate) fn list(dir: &Path) -> io::Result<Vec<Listed>> {
        #[cfg(windows)]
        if let Some(listed) = sys::list(dir) {
            return Ok(listed);
        }
        list_std(dir)
    }

    /// The listing through `read_dir`. `DirEntry::metadata` is the find data on Windows (no open) and an `fstatat` on
    /// Unix, a symlink's own and not its target's. It is also what Windows falls back to when the one enumeration
    /// cannot be had (there ids are 0, so nothing pairs, as before).
    fn list_std(dir: &Path) -> io::Result<Vec<Listed>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(dir)?.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let kind = if meta.is_dir() {
                Kind::Dir
            } else if meta.is_file() {
                Kind::File
            } else {
                Kind::Other
            };
            out.push(Listed {
                name: entry.file_name(),
                kind,
                id: file_id(&meta),
            });
        }
        Ok(out)
    }

    /// The identity of a file met on its own rather than in a directory's listing.
    pub(crate) fn file_id_at(_path: &Path, meta: &fs::Metadata) -> FileId {
        #[cfg(windows)]
        return FileId {
            ino: sys::id_of(_path),
            ..file_id(meta)
        };
        #[cfg(not(windows))]
        file_id(meta)
    }

    #[cfg(windows)]
    mod sys {
        use std::ffi::{c_void, OsString};
        use std::fs::OpenOptions;
        use std::mem::{offset_of, size_of};
        use std::os::windows::ffi::OsStringExt;
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use std::path::Path;

        use super::{FileId, Kind, Listed};

        /// FILE_ID_BOTH_DIR_INFO (fileapi.h): one record of a directory's listing.
        #[repr(C)]
        struct FileIdBothDirInfo {
            next_entry_offset: u32,
            file_index: u32,
            creation_time: i64,
            last_access_time: i64,
            last_write_time: i64,
            change_time: i64,
            end_of_file: i64,
            allocation_size: i64,
            file_attributes: u32,
            file_name_length: u32,
            ea_size: u32,
            short_name_length: i8,
            short_name: [u16; 12],
            file_id: i64,
            file_name: [u16; 1],
        }

        /// BY_HANDLE_FILE_INFORMATION (fileapi.h), its three FILETIMEs as pairs of words.
        #[repr(C)]
        struct ByHandleFileInformation {
            file_attributes: u32,
            creation_time: [u32; 2],
            last_access_time: [u32; 2],
            last_write_time: [u32; 2],
            volume_serial_number: u32,
            file_size_high: u32,
            file_size_low: u32,
            number_of_links: u32,
            file_index_high: u32,
            file_index_low: u32,
        }

        const FILE_ID_BOTH_DIRECTORY_INFO: i32 = 10;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_READ_ATTRIBUTES: u32 = 0x80;
        const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        /// 100 ns ticks from 1601-01-01 to 1970-01-01.
        const FILETIME_UNIX_EPOCH: i64 = 116_444_736_000_000_000;

        #[link(name = "kernel32")]
        extern "system" {
            fn GetFileInformationByHandleEx(
                file: *mut c_void,
                class: i32,
                info: *mut c_void,
                size: u32,
            ) -> i32;
            fn GetFileInformationByHandle(
                file: *mut c_void,
                info: *mut ByHandleFileInformation,
            ) -> i32;
        }

        /// A FILETIME as `file_id` has std's `modified()`: whole milliseconds since the Unix epoch, 0 before it.
        pub(super) fn unix_ms(filetime: i64) -> u128 {
            if filetime < FILETIME_UNIX_EPOCH {
                0
            } else {
                ((filetime - FILETIME_UNIX_EPOCH) / 10_000) as u128
            }
        }

        /// Every entry directly in `dir`, in one enumeration. `None` when the directory cannot be opened for it or the
        /// enumeration does not run to its end.
        pub(super) fn list(dir: &Path) -> Option<Vec<Listed>> {
            // Read access on a directory handle is list access; std opens with every share mode, so a writer or a
            // rename in the folder is never blocked by the watch.
            let handle = OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(dir)
                .ok()?;
            let mut out = Vec::new();
            // u64s for the records' 8-byte alignment.
            let mut buf = vec![0u64; 8 * 1024];
            let bytes = (buf.len() * size_of::<u64>()) as u32;
            // Each call goes on where the handle's last one ended, until ERROR_NO_MORE_FILES.
            while unsafe {
                GetFileInformationByHandleEx(
                    handle.as_raw_handle(),
                    FILE_ID_BOTH_DIRECTORY_INFO,
                    buf.as_mut_ptr().cast(),
                    bytes,
                )
            } != 0
            {
                let base = buf.as_ptr().cast::<u8>();
                let mut at = 0usize;
                loop {
                    // SAFETY: the call wrote whole records, each `next_entry_offset` bytes after the last.
                    let rec = unsafe { &*base.add(at).cast::<FileIdBothDirInfo>() };
                    let name = unsafe {
                        std::slice::from_raw_parts(
                            base.add(at + offset_of!(FileIdBothDirInfo, file_name))
                                .cast::<u16>(),
                            rec.file_name_length as usize / 2,
                        )
                    };
                    let name = OsString::from_wide(name);
                    if name != "." && name != ".." {
                        let kind = if rec.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                            Kind::Other
                        } else if rec.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                            Kind::Dir
                        } else {
                            Kind::File
                        };
                        out.push(Listed {
                            name,
                            kind,
                            id: FileId {
                                mtime_ms: unix_ms(rec.last_write_time),
                                size: rec.end_of_file as u64,
                                ino: rec.file_id as u64,
                                link: false,
                            },
                        });
                    }
                    if rec.next_entry_offset == 0 {
                        break;
                    }
                    at += rec.next_entry_offset as usize;
                }
            }
            // Any end but ERROR_NO_MORE_FILES (a file system without this class, a failure part way) would leave
            // files out, and a file left out is reported removed; `read_dir` lists them all instead.
            const ERROR_NO_MORE_FILES: i32 = 18;
            if std::io::Error::last_os_error().raw_os_error() != Some(ERROR_NO_MORE_FILES) {
                return None;
            }
            Some(out)
        }

        /// 0 when the file cannot be opened even to read its attributes.
        pub(super) fn id_of(path: &Path) -> u64 {
            let Ok(file) = OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(path)
            else {
                return 0;
            };
            // SAFETY: a plain struct of integers, filled by the call.
            let mut info: ByHandleFileInformation = unsafe { std::mem::zeroed() };
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
                return 0;
            }
            (u64::from(info.file_index_high) << 32) | u64::from(info.file_index_low)
        }

        #[cfg(test)]
        mod tests {
            use super::*;
            use std::fs;

            fn listed(dir: &Path, name: &str) -> Option<Listed> {
                list(dir)?.into_iter().find(|l| l.name == name)
            }

            #[test]
            fn a_listing_and_a_single_open_agree_and_a_rename_keeps_the_id() {
                let dir =
                    std::env::temp_dir().join(format!("marxy-d20-ids-{}", std::process::id()));
                let _ = fs::remove_dir_all(&dir);
                fs::create_dir_all(&dir).expect("scratch");
                let a = dir.join("a.md");
                fs::write(&a, b"a").expect("seed");
                let before = listed(&dir, "a.md").map(|l| l.id.ino);
                let single = id_of(&a);
                fs::rename(&a, dir.join("b.md")).expect("rename");
                let after_b = listed(&dir, "b.md").map(|l| l.id.ino);
                let after_a = listed(&dir, "a.md");
                let _ = fs::remove_dir_all(&dir);
                assert!(before.is_some_and(|id| id != 0), "{before:?}");
                assert_eq!(before, Some(single));
                assert_eq!(after_b, before);
                assert!(after_a.is_none());
            }

            #[test]
            fn filetimes_convert_as_std_does() {
                let at = |ticks: i64| FILETIME_UNIX_EPOCH + ticks;
                assert_eq!(unix_ms(at(0)), 0);
                assert_eq!(unix_ms(at(9_999)), 0);
                assert_eq!(unix_ms(at(10_000)), 1);
                assert_eq!(unix_ms(at(15_000_000_019)), 1_500_000);
                assert_eq!(unix_ms(at(-1)), 0);
                assert_eq!(unix_ms(0), 0);
            }
        }
    }
}

/// One change under the watched root, matching `shell-api`'s `WatchEvent`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchEvent {
    pub kind: WatchKind,
    pub path: PathBuf,
    pub to: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WatchKind {
    Modified,
    Created,
    Removed,
    Renamed,
}

/// What the open document should do with a batch.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg(test)]
pub enum OpenEffect {
    Reload,
    Follow(PathBuf),
    Gone,
    Ignore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FileId {
    mtime_ms: u128,
    size: u64,
    ino: u64,
    /// A symlink's entry carries its target's identity, so the inode is not the link's own and
    /// must never pair the link with another path as a rename.
    link: bool,
}

/// Path → identity at the last poll. Paths are absolute.
pub(crate) type Snapshot = BTreeMap<PathBuf, FileId>;

/// `fs::canonicalize` without Windows' verbatim prefix (`\\?\C:\...` read as `C:\...`), as the rest of the shell has it
/// through `dunce`: an event names a path the page holds, and the page holds plain ones, so an event under `\\?\` was
/// never the open file's. Std only, as this file is (see `ids`): a drive path is stripped, anything else (UNC, a name
/// Windows reserves, a path too long for the plain form) is left as it is.
pub(crate) fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    let canon = fs::canonicalize(path)?;
    #[cfg(windows)]
    if let Some(rest) = canon.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        let b = rest.as_bytes();
        let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\';
        let reserved = rest.split('\\').any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            matches!(
                stem.as_str(),
                "CON"
                    | "PRN"
                    | "AUX"
                    | "NUL"
                    | "COM1"
                    | "COM2"
                    | "COM3"
                    | "COM4"
                    | "COM5"
                    | "COM6"
                    | "COM7"
                    | "COM8"
                    | "COM9"
                    | "LPT1"
                    | "LPT2"
                    | "LPT3"
                    | "LPT4"
                    | "LPT5"
                    | "LPT6"
                    | "LPT7"
                    | "LPT8"
                    | "LPT9"
            ) || part.ends_with('.')
                || part.ends_with(' ')
        });
        if drive && !reserved && rest.len() < 260 {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(canon)
}

/// Roots watched together: the document directory and parents of symlinked documents in it.
pub struct RootWatch {
    pub(crate) roots: Vec<PathBuf>,
    snapshot: Snapshot,
}

impl RootWatch {
    /// Start watching `root`. The first scan is the baseline, so opening is silent.
    pub fn open(root: &Path) -> Result<Self, String> {
        let root = canonical(root).map_err(|e| format!("{}: {e}", root.display()))?;
        // The extra roots (target parents) are computed once, here. A link retargeted into a new
        // directory is not watched there; it is noticed only by the safety poll (spawn_notify) of the link itself.
        let roots = watch_roots(&root)?;
        let snapshot = scan_roots(&roots)?;
        Ok(Self { roots, snapshot })
    }

    /// Events since the last poll. Empty when nothing in the watched roots changed.
    pub fn poll(&mut self) -> Result<Vec<WatchEvent>, String> {
        let next = self.scan_lenient();
        let events = diff(&self.snapshot, &next);
        self.snapshot = next;
        Ok(events)
    }
}

impl RootWatch {
    /// Scan for a poll without failing it. When the primary root (first) cannot be read it is gone:
    /// the result is an empty snapshot, so every file known becomes `Removed` once and later polls
    /// diff empty against empty. An unreadable symlink-target root is dropped with its files.
    fn scan_lenient(&mut self) -> Snapshot {
        let mut out = BTreeMap::new();
        let mut kept = Vec::with_capacity(self.roots.len());
        for (i, root) in self.roots.iter().enumerate() {
            match scan(root) {
                Ok(snap) => {
                    out.extend(snap);
                    kept.push(root.clone());
                }
                Err(_) if i == 0 => return BTreeMap::new(),
                Err(_) => {}
            }
        }
        self.roots = kept;
        out
    }
}

/// Canonical directories to watch: `root` plus parents of file symlinks directly in `root`.
fn watch_roots(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![root.to_path_buf()];
    for extra in symlink_target_dirs(root)? {
        if !roots.contains(&extra) {
            roots.push(extra);
        }
    }
    Ok(roots)
}

#[cfg(unix)]
fn symlink_target_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut extras = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("{}: {e}", root.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if !meta.is_symlink() {
            continue;
        }
        let Ok(target_meta) = fs::metadata(&path) else {
            continue;
        };
        if !target_meta.is_file() {
            continue;
        }
        let Ok(canon) = fs::canonicalize(&path) else {
            continue;
        };
        let Some(parent) = canon.parent() else {
            continue;
        };
        if parent == root {
            continue;
        }
        let parent = parent.to_path_buf();
        if !extras.contains(&parent) {
            extras.push(parent);
        }
    }
    Ok(extras)
}

#[cfg(not(unix))]
fn symlink_target_dirs(_root: &Path) -> Result<Vec<PathBuf>, String> {
    Ok(Vec::new())
}

/// Record every regular file directly in `root` (non-recursive). Unreadable children are skipped. No folder is
/// descended, so the deny list (folders only, `commands/fs.rs`) has nothing to skip here: a file named `target` or
/// `.git` (a worktree's) is a file of the folder like any other.
pub fn scan(root: &Path) -> Result<Snapshot, String> {
    let mut out = BTreeMap::new();
    let listed = ids::list(root).map_err(|e| format!("{}: {e}", root.display()))?;
    scan_entries(root, listed, &mut out);
    Ok(out)
}

fn scan_roots(roots: &[PathBuf]) -> Result<Snapshot, String> {
    let mut out = BTreeMap::new();
    for root in roots {
        out.extend(scan(root)?);
    }
    Ok(out)
}

fn scan_entries(root: &Path, listed: Vec<ids::Listed>, out: &mut Snapshot) {
    for entry in listed {
        let path = root.join(&entry.name);
        match entry.kind {
            ids::Kind::Dir => {}
            ids::Kind::File => {
                out.insert(path, entry.id);
            }
            ids::Kind::Other => {
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if meta.is_file() {
                    // A reparse point that is not a link (a cloud placeholder): a file with its own metadata.
                    out.insert(path, entry.with_meta(&meta));
                } else if meta.is_symlink() {
                    // Not followed by the listing. A link to a regular file is recorded under its own path with the
                    // target's identity (`fs::metadata` follows it), so an edit of the target is `Modified` on the
                    // link and deleting the link is `Removed`. A link to a directory or a dangling link is not
                    // recorded, and nothing here descends a link, so a loop cannot arise.
                    if let Ok(target) = fs::metadata(&path) {
                        if target.is_file() {
                            out.insert(
                                path,
                                FileId {
                                    link: true,
                                    ..file_id(&target)
                                },
                            );
                        }
                    }
                }
            }
        }
    }
}

pub(crate) fn file_id(meta: &Metadata) -> FileId {
    FileId {
        mtime_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0),
        size: meta.len(),
        ino: inode(meta),
        link: false,
    }
}

#[cfg(unix)]
fn inode(meta: &Metadata) -> u64 {
    meta.ino()
}

#[cfg(not(unix))]
fn inode(_meta: &Metadata) -> u64 {
    0
}

/// Events that turn one snapshot into the next. A new inode at the same path is `Renamed`
/// onto that path — write-temp-then-rename, which is how agent tooling saves.
pub fn diff(prev: &Snapshot, next: &Snapshot) -> Vec<WatchEvent> {
    let mut used_removed = BTreeSet::new();
    let mut used_added = BTreeSet::new();
    let mut events = Vec::new();

    for (from, id) in prev {
        // A link never pairs: its inode is its target's, so a renamed target would retarget the
        // open document to a file elsewhere while the link dangles. A vanished link is `Removed`.
        if next.contains_key(from) || id.ino == 0 || id.link {
            continue;
        }
        let to = next.iter().find_map(|(path, other)| {
            if !prev.contains_key(path)
                && !other.link
                && !used_added.contains(path)
                && other.ino == id.ino
            {
                Some(path.clone())
            } else {
                None
            }
        });
        if let Some(to) = to {
            events.push(WatchEvent {
                kind: WatchKind::Renamed,
                path: from.clone(),
                to: Some(to.clone()),
            });
            used_removed.insert(from.clone());
            used_added.insert(to);
        }
    }

    for from in prev.keys() {
        if !next.contains_key(from) && !used_removed.contains(from) {
            events.push(WatchEvent {
                kind: WatchKind::Removed,
                path: from.clone(),
                to: None,
            });
        }
    }
    for to in next.keys() {
        if !prev.contains_key(to) && !used_added.contains(to) {
            events.push(WatchEvent {
                kind: WatchKind::Created,
                path: to.clone(),
                to: None,
            });
        }
    }

    for (path, before) in prev {
        let Some(after) = next.get(path) else {
            continue;
        };
        if before.ino != 0 && after.ino != 0 && before.ino != after.ino {
            events.push(WatchEvent {
                kind: WatchKind::Renamed,
                path: path.clone(),
                to: None,
            });
        } else if before.mtime_ms != after.mtime_ms || before.size != after.size {
            events.push(WatchEvent {
                kind: WatchKind::Modified,
                path: path.clone(),
                to: None,
            });
        }
    }
    events
}

/// Collapse a batch against the open document. Follow beats gone so a move is not a loss.
#[cfg(test)]
pub fn effect_for_open_document(events: &[WatchEvent], open: &Path) -> OpenEffect {
    let mut effect = OpenEffect::Ignore;
    for event in events {
        let next = classify_one(event, open);
        if rank(&next) > rank(&effect) {
            effect = next;
        }
    }
    effect
}

#[cfg(test)]
fn classify_one(event: &WatchEvent, open: &Path) -> OpenEffect {
    match event.kind {
        WatchKind::Renamed
            if same_path(&event.path, open)
                && event.to.as_deref().is_some_and(|to| !same_path(to, open)) =>
        {
            OpenEffect::Follow(event.to.clone().unwrap())
        }
        WatchKind::Removed if same_path(&event.path, open) => OpenEffect::Gone,
        WatchKind::Renamed
            if same_path(&event.path, open)
                || event.to.as_deref().is_some_and(|to| same_path(to, open)) =>
        {
            OpenEffect::Reload
        }
        WatchKind::Modified | WatchKind::Created if same_path(&event.path, open) => {
            OpenEffect::Reload
        }
        _ => OpenEffect::Ignore,
    }
}

/// The production comparison (`samePath` in `packages/core/src/position/watch-events.ts`): backslashes
/// read as slashes, nothing else. It does not resolve a link, so an event must name the open path itself.
#[cfg(test)]
fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().replace('\\', "/") == right.to_string_lossy().replace('\\', "/")
}

pub fn watch_kind_name(kind: WatchKind) -> &'static str {
    match kind {
        WatchKind::Modified => "modified",
        WatchKind::Created => "created",
        WatchKind::Removed => "removed",
        WatchKind::Renamed => "renamed",
    }
}

/// Stops the notify loop when dropped or when `stop` is called.
pub struct RunningWatch {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    /// How a tree watch is handed a new list of folders to leave out; a folder watch has none.
    ignore: Option<Box<dyn Fn(Vec<PathBuf>) + Send + Sync>>,
}

impl RunningWatch {
    pub(crate) fn new(stop: Arc<AtomicBool>, join: JoinHandle<()>) -> Self {
        Self {
            stop,
            join: Some(join),
            ignore: None,
        }
    }

    pub(crate) fn with_ignore(
        mut self,
        set: impl Fn(Vec<PathBuf>) + Send + Sync + 'static,
    ) -> Self {
        self.ignore = Some(Box::new(set));
        self
    }

    /// Hand a tree watch the folders to leave out from now on; false for a watch that takes none.
    pub fn set_ignore(&self, folders: Vec<PathBuf>) -> bool {
        match &self.ignore {
            Some(set) => {
                set(folders);
                true
            }
            None => false,
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// A watch dropped without `stop` (a failed install, a table entry forgotten) still ends: the loop sees the flag
/// within one wait and leaves. It is not joined here, since a drop can happen on the watch's own thread or under the
/// table lock that thread may be waiting for.
impl Drop for RunningWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
fn rank(effect: &OpenEffect) -> u8 {
    match effect {
        OpenEffect::Ignore => 0,
        OpenEffect::Reload => 1,
        OpenEffect::Gone => 2,
        OpenEffect::Follow(_) => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn a_running_watch_dropped_without_stop_still_ends_its_loop() {
        let stop = Arc::new(AtomicBool::new(false));
        let seen = stop.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let join = std::thread::spawn(move || {
            while !seen.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let _ = tx.send(());
        });
        drop(RunningWatch::new(stop, join));
        rx.recv_timeout(std::time::Duration::from_secs(2))
            .expect("the loop still runs after its watch was dropped");
    }

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("marxy-34-watch-{name}-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        let dir = canonical(&dir).expect("canonicalize scratch");
        let open = dir.join("open.md");
        fs::write(&open, b"# open\n\nbody\n").expect("seed");
        (dir, open)
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// The flat scan as it was: `read_dir` for the names, `DirEntry::metadata` for each entry, a link followed, the id
    /// from an open of the file itself.
    fn reference_scan(root: &Path) -> Snapshot {
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(root).expect("read_dir").flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_file() {
                out.insert(path.clone(), ids::file_id_at(&path, &meta));
            } else if meta.is_symlink() {
                if let Ok(target) = fs::metadata(&path) {
                    if target.is_file() {
                        out.insert(
                            path,
                            FileId {
                                link: true,
                                ..file_id(&target)
                            },
                        );
                    }
                }
            }
        }
        out
    }

    #[test]
    fn the_one_listing_scan_equals_the_per_file_scan_field_for_field() {
        let (dir, _open) = scratch("differential");
        let outside = dir.join("outside");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("far.md"), b"far").expect("far");
        fs::create_dir_all(dir.join("empty-folder")).expect("empty folder");
        fs::create_dir_all(dir.join("a/b/c/d/e")).expect("deep");
        fs::write(dir.join("a/b/c/d/e/deep.md"), b"deep").expect("deep file");
        fs::write(dir.join("empty.md"), b"").expect("empty");
        fs::write(dir.join("Case.md"), b"upper").expect("case");
        fs::write(dir.join("case.txt"), b"lower").expect("case");
        fs::write(dir.join("CASE.TXT"), b"upper again, longer").expect("case");
        fs::write(dir.join(format!("{}.md", "long".repeat(50))), b"long").expect("long name");
        fs::write(dir.join("hard-src.md"), b"hard").expect("hard");
        fs::hard_link(dir.join("hard-src.md"), dir.join("hard-twin.md")).expect("hard link");
        let junction = cfg!(windows)
            && std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(dir.join("junction"))
                .arg(&outside)
                .output()
                .is_ok_and(|o| o.status.success());
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(dir.join("open.md"), dir.join("link.md"));
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(dir.join("open.md"), dir.join("link.md"));
        if let Err(e) = &linked {
            println!("symlink case skipped: {e}");
        }
        println!(
            "flat differential: junction {junction}, symlink {}",
            linked.is_ok()
        );
        let new = scan(&dir).expect("scan");
        assert_eq!(new, reference_scan(&dir));
        assert!(new.len() >= 6, "{} files", new.len());
        assert!(!new.keys().any(|p| p.ends_with("far.md")));
        assert_eq!(new.keys().any(|p| p.ends_with("link.md")), linked.is_ok());
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_broken_symlink_in_the_watched_root_does_not_fail_open() {
        let (dir, open) = scratch("broken-symlink");
        std::os::unix::fs::symlink("/no/such/target/for-marxy-299", dir.join(".env"))
            .expect("broken symlink");
        let mut watch = RootWatch::open(&dir).expect("watch despite broken symlink");
        assert!(
            watch.roots.contains(&dir),
            "roots should include the document directory: {:?}",
            watch.roots
        );
        fs::write(&open, b"# open\n\nedited\n").expect("edit open");
        let events = watch.poll().expect("poll");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Reload);
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_or_skipped_subdirectory_does_not_fail_the_scan() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, open) = scratch("unreadable");
        let locked = dir.join("locked");
        fs::create_dir(&locked).expect("locked dir");
        fs::write(locked.join("x.md"), b"x").expect("seed locked");
        fs::create_dir(dir.join("node_modules")).expect("node_modules");
        fs::write(dir.join("node_modules/y.md"), b"y").expect("seed skipped");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("chmod");
        let snap = scan(&dir);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).expect("chmod back");
        let snap = snap.expect("the root is readable, so the scan succeeds");
        assert!(snap.contains_key(&open));
        assert!(!snap.keys().any(|p| p.starts_with(dir.join("node_modules"))));
        cleanup(&dir);
    }

    /// the deny list names folders; a file called `target` or `.venv` beside the document is watched.
    #[test]
    fn a_file_named_like_a_denied_folder_is_watched() {
        let (dir, open) = scratch("deny-file");
        fs::write(dir.join("target"), b"t").expect("target");
        fs::write(dir.join(".venv"), b"v").expect(".venv");
        fs::create_dir(dir.join("node_modules")).expect("node_modules");
        let snap = scan(&dir).expect("scan");
        assert!(snap.contains_key(&open));
        assert!(snap.contains_key(&dir.join("target")));
        assert!(snap.contains_key(&dir.join(".venv")));
        assert!(!snap.contains_key(&dir.join("node_modules")));
        cleanup(&dir);
    }

    /// a document opened through a symlink lives in the link's
    /// directory; an edit to the target must reload it.
    #[cfg(unix)]
    #[test]
    fn an_edit_through_a_symlinked_document_reloads() {
        let (dir, _open) = scratch("symlink");
        let elsewhere = dir.join("elsewhere");
        fs::create_dir(&elsewhere).expect("target dir");
        let real = elsewhere.join("real.md");
        fs::write(&real, b"# real\n").expect("seed target");
        let docs = dir.join("docs");
        fs::create_dir(&docs).expect("link dir");
        let link = docs.join("link.md");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        let mut watch = RootWatch::open(&docs).expect("watch the link's directory");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&real, b"# real, edited by another tool\n").expect("edit target");
        let events = watch.poll().expect("poll");
        let effect = effect_for_open_document(&events, &link);
        cleanup(&dir);
        assert_eq!(effect, OpenEffect::Reload, "events: {events:?}");
    }

    #[cfg(unix)]
    fn linked(name: &str, target_in_docs: bool) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let (dir, _open) = scratch(name);
        let docs = dir.join("docs");
        fs::create_dir(&docs).expect("docs");
        let real = if target_in_docs {
            docs.join("real.md")
        } else {
            let elsewhere = dir.join("elsewhere");
            fs::create_dir(&elsewhere).expect("target dir");
            elsewhere.join("real.md")
        };
        fs::write(&real, b"# real\n").expect("seed target");
        let link = docs.join("link.md");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        (dir, docs, real, link)
    }

    #[cfg(unix)]
    #[test]
    fn an_edit_of_a_target_in_the_same_directory_is_modified_on_the_link() {
        let (dir, docs, real, link) = linked("link-same-dir", true);
        let mut watch = RootWatch::open(&docs).expect("watch");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&real, b"# real, edited by another tool\n").expect("edit target");
        let events = watch.poll().expect("poll");
        let named = events
            .iter()
            .any(|e| e.kind == WatchKind::Modified && e.path == link);
        let effect = effect_for_open_document(&events, &link);
        cleanup(&dir);
        assert!(named, "{events:?}");
        assert_eq!(effect, OpenEffect::Reload);
    }

    #[cfg(unix)]
    #[test]
    fn an_edit_of_a_target_in_another_directory_is_modified_on_the_link() {
        let (dir, docs, real, link) = linked("link-other-dir", false);
        let mut watch = RootWatch::open(&docs).expect("watch");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&real, b"# real, edited by another tool\n").expect("edit target");
        let events = watch.poll().expect("poll");
        let named = events
            .iter()
            .any(|e| e.kind == WatchKind::Modified && e.path == link);
        let effect = effect_for_open_document(&events, &link);
        cleanup(&dir);
        assert!(named, "{events:?}");
        assert_eq!(effect, OpenEffect::Reload);
    }

    #[cfg(unix)]
    #[test]
    fn removing_the_link_is_removed_on_the_link() {
        let (dir, docs, real, link) = linked("link-removed", true);
        let mut watch = RootWatch::open(&docs).expect("watch");
        fs::remove_file(&link).expect("unlink");
        let events = watch.poll().expect("poll");
        let named = events
            .iter()
            .any(|e| e.kind == WatchKind::Removed && e.path == link);
        let effect = effect_for_open_document(&events, &link);
        let real_untouched = real.exists();
        cleanup(&dir);
        assert!(real_untouched);
        assert!(named, "{events:?}");
        assert_eq!(effect, OpenEffect::Gone);
    }

    #[cfg(unix)]
    #[test]
    fn renaming_the_target_of_a_link_is_removed_on_the_link_and_never_follows() {
        let (dir, docs, real, link) = linked("link-target-renamed", false);
        let mut watch = RootWatch::open(&docs).expect("watch");
        let moved = real.with_file_name("moved.md");
        fs::rename(&real, &moved).expect("rename target");
        let events = watch.poll().expect("poll");
        let effect = effect_for_open_document(&events, &link);
        let link_renamed = events
            .iter()
            .any(|e| e.kind == WatchKind::Renamed && e.path == link);
        let link_removed = events
            .iter()
            .any(|e| e.kind == WatchKind::Removed && e.path == link);
        cleanup(&dir);
        assert!(!link_renamed, "{events:?}");
        assert!(link_removed, "{events:?}");
        assert_eq!(effect, OpenEffect::Gone);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_of_a_target_still_reloads_the_link() {
        let (dir, docs, real, link) = linked("link-atomic-save", false);
        let mut watch = RootWatch::open(&docs).expect("watch");
        let temp = real.with_file_name(".real.md.tmp");
        fs::write(&temp, b"# real, saved atomically\n").expect("temp");
        fs::rename(&temp, &real).expect("rename over target");
        let events = watch.poll().expect("poll");
        let effect = effect_for_open_document(&events, &link);
        cleanup(&dir);
        assert_eq!(effect, OpenEffect::Reload, "{events:?}");
    }

    #[test]
    fn a_new_link_is_never_the_destination_of_a_rename() {
        let id = |link| FileId {
            mtime_ms: 1,
            size: 1,
            ino: 9,
            link,
        };
        let prev: Snapshot = [(PathBuf::from("/d/real.md"), id(false))]
            .into_iter()
            .collect();
        let next: Snapshot = [(PathBuf::from("/d/link.md"), id(true))]
            .into_iter()
            .collect();
        let events = diff(&prev, &next);
        assert!(events.iter().all(|e| e.to.is_none()), "{events:?}");
    }

    #[test]
    fn two_renames_never_share_one_destination() {
        let id = |ino| FileId {
            mtime_ms: 1,
            size: 1,
            ino,
            link: false,
        };
        let prev: Snapshot = [
            (PathBuf::from("/d/a"), id(7)),
            (PathBuf::from("/d/b"), id(7)),
        ]
        .into_iter()
        .collect();
        let next: Snapshot = [(PathBuf::from("/d/c"), id(7))].into_iter().collect();
        let events = diff(&prev, &next);
        let tos: Vec<_> = events.iter().filter_map(|e| e.to.clone()).collect();
        assert_eq!(tos, vec![PathBuf::from("/d/c")], "{events:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_directory_or_a_dangling_link_is_not_recorded() {
        let (dir, docs, _real, link) = linked("link-kinds", true);
        let sub = dir.join("sub");
        fs::create_dir(&sub).expect("sub");
        fs::write(sub.join("inner.md"), b"x").expect("inner");
        std::os::unix::fs::symlink(&sub, docs.join("dirlink")).expect("dir link");
        std::os::unix::fs::symlink(docs.join("nope.md"), docs.join("dangling.md"))
            .expect("dangling");
        std::os::unix::fs::symlink(&docs, docs.join("loop")).expect("loop");
        let snap = scan(&docs).expect("scan");
        let keys: Vec<_> = snap.keys().cloned().collect();
        cleanup(&dir);
        assert!(keys.contains(&link), "{keys:?}");
        for name in ["dirlink", "dangling.md", "loop"] {
            assert!(!keys.iter().any(|p| p.ends_with(name)), "{name}: {keys:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_comparison_does_not_resolve_a_link() {
        let (dir, _docs, real, link) = linked("link-compare", true);
        let same = same_path(&real, &link);
        cleanup(&dir);
        assert!(
            !same,
            "a target event must not match the link by canonicalising"
        );
    }

    #[test]
    fn a_write_two_directories_down_is_not_watched() {
        let (dir, open) = scratch("nested");
        let nested = dir.join("nested").join("deep");
        fs::create_dir_all(&nested).expect("nested dirs");
        let deep = nested.join("deep.md");
        fs::write(&deep, b"deep\n").expect("seed deep");
        let mut watch = RootWatch::open(&dir).expect("watch");
        fs::write(&deep, b"deep, edited\n").expect("edit deep");
        let events = watch.poll().expect("poll");
        assert!(events.is_empty(), "non-recursive watch: {events:?}");
        fs::write(&open, b"# open\n\nedited\n").expect("edit open");
        let events = watch.poll().expect("poll");
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Modified && e.path == open),
            "{events:?}"
        );
        cleanup(&dir);
    }

    /// The page holds `C:\...` paths: an event under `\\?\C:\...` was never the open file's, and nothing reloaded.
    #[cfg(windows)]
    #[test]
    fn events_name_plain_paths_never_verbatim_ones() {
        let (dir, open) = scratch("plain");
        assert!(!dir.to_string_lossy().starts_with(r"\\?\"), "{dir:?}");
        let mut watch = RootWatch::open(&dir).expect("watch");
        fs::write(&open, b"# open\n\nedited\n").expect("edit");
        let events = watch.poll().expect("poll");
        cleanup(&dir);
        assert!(!events.is_empty());
        assert!(
            events
                .iter()
                .all(|e| !e.path.to_string_lossy().starts_with(r"\\?\")),
            "{events:?}"
        );
    }

    #[test]
    fn in_place_write_while_open_reloads() {
        let (dir, open) = scratch("in-place");
        let mut watch = RootWatch::open(&dir).expect("watch");
        fs::write(&open, b"# open\n\nbody rewritten in place\n").expect("write");
        let events = watch.poll().expect("poll");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Reload);
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Modified && e.path == open),
            "{events:?}"
        );
        cleanup(&dir);
    }

    #[test]
    fn write_temp_then_rename_while_open_reloads() {
        let (dir, open) = scratch("atomic");
        let mut watch = RootWatch::open(&dir).expect("watch");
        let tmp = dir.join(".open.md.tmp");
        fs::write(&tmp, b"# open\n\natomic replacement\n").expect("tmp");
        fs::rename(&tmp, &open).expect("rename");
        let events = watch.poll().expect("poll");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Reload);
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Renamed && e.path == open && e.to.is_none()),
            "{events:?}"
        );
        cleanup(&dir);
    }

    #[test]
    fn delete_while_open_is_gone() {
        let (dir, open) = scratch("delete");
        let mut watch = RootWatch::open(&dir).expect("watch");
        fs::remove_file(&open).expect("unlink");
        let events = watch.poll().expect("poll");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Gone);
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Removed && e.path == open),
            "{events:?}"
        );
        cleanup(&dir);
    }

    #[test]
    fn move_while_open_follows() {
        let (dir, open) = scratch("move");
        let mut watch = RootWatch::open(&dir).expect("watch");
        let dest = dir.join("moved.md");
        fs::rename(&open, &dest).expect("rename");
        let events = watch.poll().expect("poll");
        assert_eq!(
            effect_for_open_document(&events, &open),
            OpenEffect::Follow(dest.clone())
        );
        assert!(
            events.iter().any(|e| e.kind == WatchKind::Renamed
                && e.path == open
                && e.to.as_deref() == Some(dest.as_path())),
            "{events:?}"
        );
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_vanished_symlink_target_directory_does_not_kill_the_poll() {
        let (dir, _open) = scratch("target-vanishes");
        let elsewhere = dir.join("elsewhere");
        fs::create_dir(&elsewhere).expect("target dir");
        let real = elsewhere.join("real.md");
        fs::write(&real, b"# real\n").expect("seed target");
        let docs = dir.join("docs");
        fs::create_dir(&docs).expect("docs");
        let docs_open = docs.join("open.md");
        fs::write(&docs_open, b"# open\n").expect("seed open");
        std::os::unix::fs::symlink(&real, docs.join("link.md")).expect("symlink");
        let mut watch = RootWatch::open(&docs).expect("watch");
        assert_eq!(watch.roots.len(), 2, "{:?}", watch.roots);
        fs::remove_dir_all(&elsewhere).expect("remove target dir");
        let events = watch.poll().expect("poll survives a vanished target root");
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Removed && e.path == real),
            "{events:?}"
        );
        fs::write(&docs_open, b"# open, edited\n").expect("edit open");
        let events = watch.poll().expect("later poll still works");
        assert_eq!(
            effect_for_open_document(&events, &docs_open),
            OpenEffect::Reload
        );
        cleanup(&dir);
    }

    #[test]
    fn removing_the_watched_directory_reports_removed_once() {
        let (dir, open) = scratch("dir-removed");
        let mut watch = RootWatch::open(&dir).expect("watch");
        fs::remove_dir_all(&dir).expect("remove dir");
        let events = watch.poll().expect("poll survives a vanished root");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Gone);
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Removed && e.path == open),
            "{events:?}"
        );
        let again = watch.poll().expect("poll again");
        assert!(again.is_empty(), "no repeated events: {again:?}");
        cleanup(&dir);
    }

    #[test]
    fn renaming_the_watched_directory_reports_removed() {
        let (dir, open) = scratch("dir-renamed");
        let mut watch = RootWatch::open(&dir).expect("watch");
        let moved = dir.with_file_name(format!(
            "{}-moved",
            dir.file_name().unwrap().to_string_lossy()
        ));
        fs::rename(&dir, &moved).expect("rename dir");
        let events = watch.poll().expect("poll");
        assert_eq!(effect_for_open_document(&events, &open), OpenEffect::Gone);
        cleanup(&moved);
    }
}
