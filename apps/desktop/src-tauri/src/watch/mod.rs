//! Directory watch for the open document's folder (ADR-0018): non-recursive scan/diff plus, in the
//! shipped binary, a `notify` thread (`spawn_notify.rs`) on the folder and symlink target parents.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

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
}

/// Path → identity at the last poll. Paths are absolute.
pub(crate) type Snapshot = BTreeMap<PathBuf, FileId>;

/// Roots watched together: the document directory and parents of symlinked documents in it.
pub struct RootWatch {
    pub(crate) roots: Vec<PathBuf>,
    snapshot: Snapshot,
}

impl RootWatch {
    /// Start watching `root`. The first scan is the baseline, so opening is silent.
    pub fn open(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
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

/// Directories no reader opens a document from; skipped when they appear as a direct child name.
const SKIP_DIRS: [&str; 4] = [".git", "node_modules", "target", ".venv"];

/// Record every regular file directly in `root` (non-recursive). Unreadable children are skipped.
pub fn scan(root: &Path) -> Result<Snapshot, String> {
    let mut out = BTreeMap::new();
    let entries = fs::read_dir(root).map_err(|e| format!("{}: {e}", root.display()))?;
    scan_entries(entries, &mut out);
    Ok(out)
}

fn scan_roots(roots: &[PathBuf]) -> Result<Snapshot, String> {
    let mut out = BTreeMap::new();
    for root in roots {
        out.extend(scan(root)?);
    }
    Ok(out)
}

fn scan_entries(entries: fs::ReadDir, out: &mut Snapshot) {
    for entry in entries.flatten() {
        let path = entry.path();
        if SKIP_DIRS.iter().any(|d| entry.file_name() == *d) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.is_dir() {
            continue;
        }
        if meta.is_file() {
            out.insert(path, file_id(&meta));
        } else if meta.is_symlink() {
            // `DirEntry::metadata` does not follow links. A link to a regular file is recorded under
            // its own path with the target's identity (`fs::metadata` follows it), so an edit of the
            // target is `Modified` on the link and deleting the link is `Removed`. A link to a
            // directory or a dangling link is not recorded, and nothing here descends a link, so a
            // loop cannot arise.
            if let Ok(target) = fs::metadata(&path) {
                if target.is_file() {
                    out.insert(path, file_id(&target));
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
        if next.contains_key(from) || id.ino == 0 {
            continue;
        }
        let to = next.iter().find_map(|(path, other)| {
            if !prev.contains_key(path) && other.ino == id.ino {
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
}

impl RunningWatch {
    pub(crate) fn new(stop: Arc<AtomicBool>, join: JoinHandle<()>) -> Self {
        Self {
            stop,
            join: Some(join),
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
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

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("marxy-34-watch-{name}-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        let dir = fs::canonicalize(&dir).expect("canonicalize scratch");
        let open = dir.join("open.md");
        fs::write(&open, b"# open\n\nbody\n").expect("seed");
        (dir, open)
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
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

    /// H3 (seams pass, MARXY-248): a document opened through a symlink lives in the link's
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
