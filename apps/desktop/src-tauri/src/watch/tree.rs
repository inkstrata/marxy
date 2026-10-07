//! Recursive watch of a collection folder (C-05): one snapshot of every regular file in the tree,
//! patched from the paths the OS reports rather than rescanned on every event.
//!
//! Std only. The tree is read with `fs::symlink_metadata`, so a symlink is never followed: a
//! symlinked directory is not descended and a symlinked file is not reported (the index walker,
//! `packages/core/src/index-model/walk.ts`, does the same). The directory names in
//! `DENY_DIRECTORY_NAMES` are skipped wherever they appear, as `index-model/deny.ts` does. Events
//! come from the folder watch's own `watch::diff`, so an inode change at a path (write-temp-then-
//! rename) is `Renamed` onto it exactly as it is for the open document's folder.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use crate::watch::{diff, file_id, Snapshot, WatchEvent};

/// The names in `DENY_DIRECTORY_NAMES` of `packages/core/src/index-model/deny.ts`; a test reads that
/// file and fails when a name there is missing here.
pub const DENY_DIRECTORY_NAMES: [&str; 12] = [
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

/// Past this many files a tree is refused, so the app can fall back rather than hold a snapshot of
/// a whole disk.
pub const MAX_FILES: usize = 200_000;

/// A watched tree: its canonical root and the identity of every regular file under it.
pub struct TreeWatch {
    root: PathBuf,
    snapshot: Snapshot,
}

impl TreeWatch {
    /// Scan `root` once. The scan is the baseline, so opening is silent. Fails when the root is not
    /// a readable directory or holds more than `MAX_FILES` files.
    pub fn open(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
        let meta = lstat(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        if !meta.is_dir() {
            return Err(format!("{}: not a directory", root.display()));
        }
        let mut snapshot = BTreeMap::new();
        scan_tree(&root, &mut snapshot, Some(MAX_FILES))?;
        Ok(Self { root, snapshot })
    }

    /// The canonical root, as events report it.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// How many files the snapshot holds.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.snapshot.len()
    }

    /// Events for the paths the OS reported. Only those paths are re-examined: a file is
    /// re-stat'ed, a directory has its subtree rescanned, a path that is gone (or is no longer a
    /// real directory on the way down) removes itself and every key under it. `rescan_all` rescans
    /// the whole root, for a batch the OS says it dropped or coalesced.
    pub fn apply(&mut self, changed: &[PathBuf], rescan_all: bool) -> Vec<WatchEvent> {
        let regions: Vec<PathBuf> = if rescan_all {
            vec![self.root.clone()]
        } else {
            self.regions_for(changed)
        };
        let mut prev = Snapshot::new();
        let mut next = Snapshot::new();
        for region in &regions {
            prev.extend(
                self.snapshot
                    .range(region.clone()..)
                    .take_while(|(path, _)| path.starts_with(region))
                    .map(|(path, id)| (path.clone(), *id)),
            );
            examine(region, &mut next);
        }
        let events = diff(&prev, &next);
        for path in prev.keys() {
            self.snapshot.remove(path);
        }
        self.snapshot.extend(next);
        events
    }

    /// The subtrees to rebuild for `changed`: each reported path under the root and outside a denied
    /// directory, or the first ancestor on its way down that is no longer a real directory, with any
    /// region inside another dropped (the outer one's rebuild covers it).
    fn regions_for(&self, changed: &[PathBuf]) -> Vec<PathBuf> {
        let mut wanted: BTreeSet<PathBuf> = BTreeSet::new();
        for path in changed {
            let Ok(rel) = path.strip_prefix(&self.root) else {
                continue;
            };
            if rel.components().any(|c| is_denied(c.as_os_str())) {
                continue;
            }
            wanted.insert(path.clone());
        }
        let wanted = outermost(wanted);
        // One lstat per ancestor directory, shared by every reported path in the batch.
        let mut real_dir: HashMap<PathBuf, bool> = HashMap::new();
        let mut regions = BTreeSet::new();
        for path in wanted {
            let mut region = path.clone();
            let rel = path.strip_prefix(&self.root).expect("filtered above");
            let mut ancestor = self.root.clone();
            let mut parts: Vec<_> = rel.components().collect();
            parts.pop();
            for part in parts {
                ancestor.push(part);
                let is_dir = *real_dir
                    .entry(ancestor.clone())
                    .or_insert_with(|| lstat(&ancestor).map(|m| m.is_dir()).unwrap_or(false));
                if !is_dir {
                    region = ancestor.clone();
                    break;
                }
            }
            regions.insert(region);
        }
        outermost(regions).into_iter().collect()
    }
}

/// `paths` without any path that lies under another one in the set.
fn outermost(paths: BTreeSet<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for path in paths {
        if out.last().is_some_and(|kept| path.starts_with(kept)) {
            continue;
        }
        out.push(path);
    }
    out
}

/// What `region` holds now: itself when it is a regular file, its subtree when it is a real
/// directory, nothing when it is gone, a symlink or anything else.
fn examine(region: &Path, out: &mut Snapshot) {
    let Ok(meta) = lstat(region) else {
        return;
    };
    if meta.is_file() {
        out.insert(region.to_path_buf(), file_id(&meta));
    } else if meta.is_dir() {
        // A rebuild is never refused: only `open` holds the tree to the limit.
        let _ = scan_tree(region, out, None);
    }
}

/// Every regular file under `dir`, never following a symlink and skipping denied names. An
/// unreadable subdirectory is skipped; an unreadable `dir` is an error.
fn scan_tree(dir: &Path, out: &mut Snapshot, limit: Option<usize>) -> Result<(), String> {
    let mut stack = vec![dir.to_path_buf()];
    let mut first = true;
    while let Some(next) = stack.pop() {
        let entries = match read_dir(&next) {
            Ok(entries) => entries,
            Err(e) if first => return Err(format!("{}: {e}", next.display())),
            Err(_) => continue,
        };
        first = false;
        for entry in entries.flatten() {
            if is_denied(&entry.file_name()) {
                continue;
            }
            let path = entry.path();
            let Ok(meta) = lstat(&path) else {
                continue;
            };
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                out.insert(path, file_id(&meta));
                if limit.is_some_and(|max| out.len() > max) {
                    return Err("too many files".into());
                }
            }
        }
    }
    Ok(())
}

fn is_denied(name: &std::ffi::OsStr) -> bool {
    DENY_DIRECTORY_NAMES.iter().any(|d| name == *d)
}

fn lstat(path: &Path) -> io::Result<Metadata> {
    #[cfg(test)]
    stat_count::bump();
    fs::symlink_metadata(path)
}

fn read_dir(path: &Path) -> io::Result<fs::ReadDir> {
    #[cfg(test)]
    stat_count::bump();
    fs::read_dir(path)
}

/// Test-only count of the file-system calls this module makes (each `symlink_metadata` and each
/// `read_dir`), per thread so parallel tests do not see each other's.
#[cfg(test)]
pub(crate) mod stat_count {
    use std::cell::Cell;

    thread_local! {
        static COUNT: Cell<usize> = const { Cell::new(0) };
    }

    pub fn bump() {
        COUNT.with(|c| c.set(c.get() + 1));
    }

    pub fn get() -> usize {
        COUNT.with(|c| c.get())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::WatchKind;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn scratch(name: &str) -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("marxy-c05-tree-{name}-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        fs::canonicalize(&dir).expect("canonicalize scratch")
    }

    fn write(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).expect("parents");
        fs::write(path, body).expect("write");
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_created_two_directories_down_is_one_created() {
        let dir = scratch("created");
        write(&dir.join("top.md"), b"top");
        fs::create_dir_all(dir.join("a/b")).expect("dirs");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let new = dir.join("a/b/new.md");
        write(&new, b"# new\n");
        let events = tree.apply(std::slice::from_ref(&new), false);
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Created,
                path: new.clone(),
                to: None
            }]
        );
        // FSEvents may name the directory instead; the subtree rebuild finds nothing new again.
        assert!(tree.apply(&[dir.join("a")], false).is_empty());
        cleanup(&dir);
    }

    #[test]
    fn a_file_in_a_new_directory_reported_by_its_directory_is_one_created() {
        let dir = scratch("created-dir");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let new = dir.join("a/b/new.md");
        write(&new, b"# new\n");
        let events = tree.apply(&[dir.join("a")], false);
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Created,
                path: new,
                to: None
            }]
        );
        cleanup(&dir);
    }

    #[test]
    fn write_temp_then_rename_two_levels_down_is_renamed_onto_the_path() {
        let dir = scratch("atomic");
        let doc = dir.join("a/b/doc.md");
        write(&doc, b"# doc\n");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let tmp = dir.join("a/b/.doc.md.tmp");
        fs::write(&tmp, b"# doc\n\nreplaced atomically\n").expect("tmp");
        fs::rename(&tmp, &doc).expect("rename");
        let events = tree.apply(&[tmp.clone(), doc.clone()], false);
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Renamed,
                path: doc,
                to: None
            }]
        );
        cleanup(&dir);
    }

    #[test]
    fn a_file_moved_between_directories_is_renamed_from_to() {
        let dir = scratch("move");
        let from = dir.join("a/x.md");
        write(&from, b"x");
        fs::create_dir_all(dir.join("b/c")).expect("dest");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let to = dir.join("b/c/x.md");
        fs::rename(&from, &to).expect("move");
        let events = tree.apply(&[from.clone(), to.clone()], false);
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Renamed,
                path: from,
                to: Some(to)
            }]
        );
        cleanup(&dir);
    }

    #[test]
    fn removing_a_directory_reports_each_file_under_it_removed_once() {
        let dir = scratch("rmdir");
        let gone = [
            dir.join("a/one.md"),
            dir.join("a/b/two.md"),
            dir.join("a/b/c/three.md"),
        ];
        for path in &gone {
            write(path, b"x");
        }
        let kept = dir.join("keep.md");
        write(&kept, b"k");
        let mut tree = TreeWatch::open(&dir).expect("open");
        fs::remove_dir_all(dir.join("a")).expect("remove");
        // The OS may report the directory, its files, or both, in one batch.
        let reported = [
            dir.join("a"),
            gone[1].clone(),
            dir.join("a/b/c"),
            gone[2].clone(),
        ];
        let events = tree.apply(&reported, false);
        let mut removed: Vec<_> = events
            .iter()
            .inspect(|e| assert_eq!(e.kind, WatchKind::Removed, "{events:?}"))
            .map(|e| e.path.clone())
            .collect();
        removed.sort();
        let mut want = gone.to_vec();
        want.sort();
        assert_eq!(removed, want);
        assert!(tree.apply(&reported, false).is_empty(), "once");
        assert!(tree.apply(&[], true).is_empty(), "a full rescan agrees");
        assert_eq!(tree.len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn files_under_denied_directories_are_never_reported() {
        let dir = scratch("deny");
        write(&dir.join("keep.md"), b"k");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let hidden = [
            dir.join("node_modules/pkg/readme.md"),
            dir.join(".git/HEAD"),
            dir.join("target/debug/out.md"),
            dir.join("a/node_modules/x.md"),
        ];
        for path in &hidden {
            write(path, b"x");
        }
        let mut reported = hidden.to_vec();
        reported.push(dir.join("node_modules"));
        reported.push(dir.join("a"));
        assert!(tree.apply(&reported, false).is_empty());
        assert!(tree.apply(&[], true).is_empty(), "nor on a full rescan");
        assert!(
            TreeWatch::open(&dir).expect("reopen").len() == 1,
            "nor in the baseline"
        );
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_directory_is_not_descended() {
        let dir = scratch("symlink");
        let outside = scratch("symlink-target");
        write(&outside.join("deep/far.md"), b"far");
        write(&dir.join("keep.md"), b"k");
        let link = dir.join("linked");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");
        let mut tree = TreeWatch::open(&dir).expect("open");
        assert_eq!(tree.len(), 1, "the baseline holds only keep.md");
        write(&outside.join("deep/new.md"), b"new");
        let reported = [link.clone(), link.join("deep/new.md"), link.join("deep")];
        assert!(tree.apply(&reported, false).is_empty());
        assert!(tree.apply(&[], true).is_empty());
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn paths_outside_the_root_are_ignored() {
        let dir = scratch("outside");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let other = scratch("outside-other");
        write(&other.join("x.md"), b"x");
        assert!(tree.apply(&[other.join("x.md")], false).is_empty());
        cleanup(&dir);
        cleanup(&other);
    }

    #[test]
    fn a_tree_past_the_file_limit_is_refused() {
        let dir = scratch("limit");
        let mut out = Snapshot::new();
        for i in 0..5 {
            write(&dir.join(format!("d/{i}.md")), b"x");
        }
        assert_eq!(
            scan_tree(&dir, &mut out, Some(4)),
            Err("too many files".to_string())
        );
        cleanup(&dir);
    }

    #[test]
    fn one_changed_file_in_ten_thousand_costs_fewer_than_ten_stat_calls() {
        let dir = scratch("no-rescan");
        for d in 0..100 {
            let sub = dir.join(format!("d{d:03}"));
            fs::create_dir_all(&sub).expect("dir");
            for f in 0..100 {
                fs::write(sub.join(format!("f{f:03}.md")), b"x").expect("seed");
            }
        }
        let mut tree = TreeWatch::open(&dir).expect("open");
        assert_eq!(tree.len(), 10_000);
        let changed = dir.join("d042/f017.md");
        fs::write(&changed, b"changed, and longer").expect("edit");
        let before = stat_count::get();
        let events = tree.apply(std::slice::from_ref(&changed), false);
        let calls = stat_count::get() - before;
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Modified,
                path: changed,
                to: None
            }]
        );
        eprintln!("apply for one changed file in 10,000: {calls} stat calls");
        assert!(calls < 10, "{calls} stat calls for one changed file");
        cleanup(&dir);
    }

    #[test]
    fn the_deny_list_matches_the_index_walkers() {
        let deny_ts = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core/src/index-model/deny.ts");
        let source = fs::read_to_string(&deny_ts).expect("read deny.ts");
        let start = source
            .find("DENY_DIRECTORY_NAMES")
            .expect("DENY_DIRECTORY_NAMES in deny.ts");
        let open = start + source[start..].find("= [").expect("array start");
        let close = open + source[open..].find(']').expect("array end");
        let list = source[open..close].replace('"', "'");
        let names: Vec<&str> = list.split('\'').skip(1).step_by(2).collect();
        assert!(names.len() >= 12, "parsed {names:?}");
        for name in names {
            assert!(
                DENY_DIRECTORY_NAMES.contains(&name),
                "{name} is in deny.ts but not in tree.rs"
            );
        }
    }
}
