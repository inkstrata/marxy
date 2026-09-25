//! Watch the root directory, not a file's inode (ADR-0018). Std only so the same file can be
//! compiled with a bare `rustc --test` — `notify` would need a crate the desktop manifest and
//! the licence allowlist, both outside this story's paths, to take on.

mod runtime;

pub use runtime::{spawn_poll_thread, watch_kind_name, RunningWatch};

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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
type Snapshot = BTreeMap<PathBuf, FileId>;

/// A root being polled. Each `poll` diffs against the last scan.
pub struct RootWatch {
    root: PathBuf,
    snapshot: Snapshot,
}

impl RootWatch {
    /// Start watching `root`. The first scan is the baseline, so opening is silent.
    pub fn open(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
        let snapshot = scan(&root)?;
        Ok(Self { root, snapshot })
    }

    /// Events since the last poll. Empty when nothing under the root changed.
    pub fn poll(&mut self) -> Result<Vec<WatchEvent>, String> {
        let next = scan(&self.root)?;
        let events = diff(&self.snapshot, &next);
        self.snapshot = next;
        Ok(events)
    }
}

/// Walk `root` and record every regular file. `.git` is skipped so a repository root is usable.
pub fn scan(root: &Path) -> Result<Snapshot, String> {
    let mut out = BTreeMap::new();
    scan_dir(root, &mut out)?;
    Ok(out)
}

fn scan_dir(dir: &Path, out: &mut Snapshot) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = entry.path();
        if entry.file_name() == ".git" {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.is_dir() {
            scan_dir(&path, out)?;
        } else if meta.is_file() {
            out.insert(path, file_id(&meta));
        }
    }
    Ok(())
}

fn file_id(meta: &Metadata) -> FileId {
    FileId {
        mtime_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
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

/// `/var` and `/private/var` are the same directory on macOS; a deleted file still compares by
/// its parent, because `canonicalize` of the file itself then fails.
#[cfg(test)]
fn same_path(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    if let (Ok(a), Ok(b)) = (fs::canonicalize(left), fs::canonicalize(right)) {
        return a == b;
    }
    if left.file_name() != right.file_name() {
        return false;
    }
    match (left.parent(), right.parent()) {
        (Some(a), Some(b)) => match (fs::canonicalize(a), fs::canonicalize(b)) {
            (Ok(ca), Ok(cb)) => ca == cb,
            _ => false,
        },
        _ => false,
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

    #[test]
    fn poll_thread_emits_modified_then_stops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, open) = scratch("thread");
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_poll_thread(dir.clone(), move |events| {
            let _ = tx.send(events);
        })
        .expect("spawn");
        std::thread::sleep(Duration::from_millis(70));
        fs::write(&open, b"# open\n\nrewritten on disk\n").expect("write");
        let events = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("modified within 2 s");
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Modified && e.path == open),
            "{events:?}"
        );
        running.stop();
        fs::write(&open, b"# open\n\nagain\n").expect("write again");
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "no events after stop"
        );
        cleanup(&dir);
    }
}
