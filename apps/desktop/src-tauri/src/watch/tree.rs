//! Recursive watch of a collection folder: one snapshot of every regular file in the tree,
//! patched from the paths the OS reports rather than rescanned on every event.
//!
//! Std only. The tree is read with `fs::symlink_metadata`, so a symlink is never followed: a
//! symlinked directory is not descended and a symlinked file is not reported (the index walker,
//! `packages/core/src/index-model/walk.ts`, does the same). A folder named in the shell's deny list
//! (`commands/fs.rs`) is skipped wherever it appears, as `index-model/deny.ts` does. Events
//! come from the folder watch's own `watch::diff`, so an inode change at a path (write-temp-then-
//! rename) is `Renamed` onto it exactly as it is for the open document's folder.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use crate::scope::plain;
use crate::watch::ids::{file_id_at, list, Kind, Listed};
use crate::watch::{canonical, diff, Snapshot, WatchEvent};

/// Past this many files a tree is refused, so the app can fall back rather than hold a snapshot of
/// a whole disk. Every regular file counts: the index lists every file, whatever its name says,
/// so no name may be filtered out here without its edits going missing from the index.
pub const MAX_FILES: usize = 200_000;

/// What `open` and `apply` answer when the tree holds more than `MAX_FILES` files.
pub const TOO_MANY: &str = "too many files";

/// A watched tree: its canonical root and the identity of every regular file under it.
pub struct TreeWatch {
    root: PathBuf,
    snapshot: Snapshot,
    /// `MAX_FILES`, smaller in a test that must cross it.
    max: usize,
    /// Keys (`key`) of the folders left out: the ones the index walk left out by an ignore file or a deny glob.
    ignored: BTreeSet<String>,
}

impl TreeWatch {
    /// Scan `root` once. The scan is the baseline, so opening is silent. Fails when the root is not
    /// a readable directory or holds more than `MAX_FILES` listed files.
    #[cfg(test)]
    pub fn open(root: &Path) -> Result<Self, String> {
        Self::open_limited(root, MAX_FILES, &[])
    }

    /// `ignore` names folders to leave out; one that is not strictly inside `root` is dropped, so the list cannot
    /// reach beyond the tree.
    pub(crate) fn open_limited(
        root: &Path,
        max: usize,
        ignore: &[PathBuf],
    ) -> Result<Self, String> {
        let root = canonical(root).map_err(|e| format!("{}: {e}", root.display()))?;
        let meta = lstat(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        if !meta.is_dir() {
            return Err(format!("{}: not a directory", root.display()));
        }
        let ignored = ignored_inside(&root, ignore);
        let mut snapshot = BTreeMap::new();
        scan_tree(&root, &mut snapshot, Some(max), &ignored)?;
        Ok(Self {
            root,
            snapshot,
            max,
            ignored,
        })
    }

    /// Replace the folders left out. Folders newly left out drop their files from the snapshot without events (the
    /// index dropped them in the walk that found the rule). A folder no longer left out is read again, and its files
    /// come back as created.
    pub fn set_ignored(&mut self, ignore: &[PathBuf]) -> Result<Vec<WatchEvent>, String> {
        let next = ignored_inside(&self.root, ignore);
        if next == self.ignored {
            return Ok(Vec::new());
        }
        let widened = !self.ignored.iter().all(|old| covered(old, &next));
        self.ignored = next;
        let gone: Vec<PathBuf> = self
            .snapshot
            .keys()
            .filter(|path| self.inside_ignored(&key(path)))
            .cloned()
            .collect();
        for path in gone {
            self.snapshot.remove(&path);
        }
        if widened {
            self.apply(&[], true)
        } else {
            Ok(Vec::new())
        }
    }

    /// `k` is a folder left out or lies under one.
    fn inside_ignored(&self, k: &str) -> bool {
        if self.ignored.is_empty() {
            return false;
        }
        covered(k, &self.ignored)
    }

    /// How many of `paths` the tree can learn something from: those under the root and outside a denied folder.
    /// A build writing into `target/` reports thousands that `apply` drops, and counting them would owe a whole rescan.
    pub(crate) fn countable(&self, paths: &[PathBuf]) -> usize {
        paths
            .iter()
            .filter(|path| {
                path.strip_prefix(&self.root)
                    .is_ok_and(|rel| !rel.components().any(|c| is_denied(c.as_os_str())))
                    && !self.inside_ignored(&key(path))
            })
            .count()
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
    pub fn apply(
        &mut self,
        changed: &[PathBuf],
        rescan_all: bool,
    ) -> Result<Vec<WatchEvent>, String> {
        let regions: Vec<PathBuf> = if rescan_all {
            vec![self.root.clone()]
        } else {
            self.regions_for(changed)
        };
        let mut prev = Snapshot::new();
        for region in &regions {
            prev.extend(
                self.snapshot
                    .range(region.clone()..)
                    .take_while(|(path, _)| path.starts_with(region))
                    .map(|(path, id)| (path.clone(), *id)),
            );
        }
        // The limit holds after the patch as it did at open: what the snapshot keeps outside the
        // regions, plus what they hold now, may not pass `MAX_FILES`. A rebuild stops reading as
        // soon as it would.
        let kept = self.snapshot.len() - prev.len();
        let room = self.max.saturating_sub(kept);
        let mut next = Snapshot::new();
        for region in &regions {
            examine(region, &mut next, room, &self.ignored)?;
        }
        let events = diff(&prev, &next);
        for path in prev.keys() {
            self.snapshot.remove(path);
        }
        self.snapshot.extend(next);
        Ok(events)
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
            // Every part but the last is a folder; the last is one only when the disk says so (a file `out` is a file).
            let mut parts = rel.components();
            let last = parts.next_back();
            if parts.any(|c| is_denied(c.as_os_str()))
                || last.is_some_and(|c| {
                    is_denied(c.as_os_str()) && lstat(path).is_ok_and(|m| m.is_dir())
                })
            {
                continue;
            }
            // Under a folder left out, or the folder itself when the disk still says it is one.
            let k = key(path);
            if self.inside_ignored(&k)
                && (!self.ignored.contains(&k) || lstat(path).is_ok_and(|m| m.is_dir()))
            {
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

/// What `region` holds now: itself when it is a listed regular file, its subtree when it is a real
/// directory, nothing when it is gone, a symlink or anything else. Past `room` listed files in
/// `out` it is `TOO_MANY`.
fn examine(
    region: &Path,
    out: &mut Snapshot,
    room: usize,
    ignored: &BTreeSet<String>,
) -> Result<(), String> {
    let Ok(meta) = lstat(region) else {
        return Ok(());
    };
    if (meta.is_file() || meta.is_dir()) && !spelled_as_on_disk(region) {
        return Ok(());
    }
    if meta.is_file() {
        out.insert(region.to_path_buf(), file_id_at(region, &meta));
        if out.len() > room {
            return Err(TOO_MANY.into());
        }
    } else if meta.is_dir() {
        match scan_tree(region, out, Some(room), ignored) {
            Err(e) if e == TOO_MANY => return Err(e),
            // A directory that vanished or cannot be read now has nothing to list.
            _ => {}
        }
    }
    Ok(())
}

/// Every listed regular file under `dir`, never following a symlink and skipping denied names. An
/// unreadable subdirectory is skipped; an unreadable `dir` is an error.
fn scan_tree(
    dir: &Path,
    out: &mut Snapshot,
    limit: Option<usize>,
    ignored: &BTreeSet<String>,
) -> Result<(), String> {
    let mut stack = vec![dir.to_path_buf()];
    let mut first = true;
    while let Some(next) = stack.pop() {
        let entries = match list_dir(&next) {
            Ok(entries) => entries,
            Err(e) if first => return Err(format!("{}: {e}", next.display())),
            Err(_) => continue,
        };
        first = false;
        for entry in entries {
            let path = next.join(&entry.name);
            // The listing settles files and folders. Only an entry it cannot (a link, a reparse point) is asked
            // of the file itself, and a link is neither descended nor listed.
            let (is_dir, is_file, id) = match entry.kind {
                Kind::Dir => (true, false, entry.id),
                Kind::File => (false, true, entry.id),
                Kind::Other => match lstat(&path) {
                    Ok(meta) => (meta.is_dir(), meta.is_file(), entry.with_meta(&meta)),
                    Err(_) => continue,
                },
            };
            if is_dir {
                if !is_denied(&entry.name)
                    && !(!ignored.is_empty() && ignored.contains(&key(&path)))
                {
                    stack.push(path);
                }
            } else if is_file {
                out.insert(path, id);
                if limit.is_some_and(|max| out.len() > max) {
                    return Err(TOO_MANY.into());
                }
            }
        }
    }
    Ok(())
}

/// Whether `path`, which exists, is spelled as the disk spells it. On a case-insensitive volume the old name of a
/// case-only rename (`A.md` to `a.md`, `Docs` to `docs`) still finds the file, and listing it there as well as under
/// its new name would leave a ghost of it, or of a whole folder, in the index.
fn spelled_as_on_disk(path: &Path) -> bool {
    if !cfg!(any(windows, target_os = "macos")) {
        return true;
    }
    canonical(path).is_ok_and(|real| plain(&real) == plain(path))
}

/// A path as one comparable string: forward slashes, no trailing one, and lower case where the volume ignores case.
fn key(path: &Path) -> String {
    let mut k = path.to_string_lossy().replace('\\', "/");
    while k.len() > 1 && k.ends_with('/') {
        k.pop();
    }
    if cfg!(windows) {
        k = k.to_lowercase();
    }
    k
}

/// `k` is in `set` or lies under a member.
fn covered(k: &str, set: &BTreeSet<String>) -> bool {
    if set.contains(k) {
        return true;
    }
    k.match_indices('/')
        .any(|(i, _)| i > 0 && set.contains(&k[..i]))
}

/// The keys of the folders in `list` that lie strictly inside `root`, spelled without `.` or `..` parts.
fn ignored_inside(root: &Path, list: &[PathBuf]) -> BTreeSet<String> {
    let base = key(root);
    let prefix = if base.ends_with('/') {
        base
    } else {
        format!("{base}/")
    };
    list.iter()
        .map(|path| key(path))
        .filter(|k| {
            k.strip_prefix(&prefix)
                .is_some_and(|rest| rest.split('/').all(|part| !matches!(part, "" | "." | "..")))
        })
        .collect()
}

/// A folder name the shell's one deny list holds (`commands/fs.rs`), in any case. Asked of folders only.
fn is_denied(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(crate::commands::fs::denied_name)
}

fn lstat(path: &Path) -> io::Result<Metadata> {
    #[cfg(test)]
    stat_count::bump();
    fs::symlink_metadata(path)
}

fn list_dir(path: &Path) -> io::Result<Vec<Listed>> {
    #[cfg(test)]
    stat_count::bump();
    list(path)
}

/// Test-only count of the file-system calls this module makes (each `symlink_metadata` and each
/// directory listing), per thread so parallel tests do not see each other's.
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
        canonical(&dir).expect("canonicalize scratch")
    }

    fn write(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).expect("parents");
        fs::write(path, body).expect("write");
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// The scan as it was before the listing carried the metadata: `read_dir`, a `symlink_metadata` per entry, and the
    /// id from an open of the file itself.
    fn reference_scan(dir: &Path, out: &mut Snapshot) {
        for entry in fs::read_dir(dir).expect("read_dir").flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.is_dir() {
                if !is_denied(&entry.file_name()) {
                    reference_scan(&path, out);
                }
            } else if meta.is_file() {
                out.insert(path.clone(), file_id_at(&path, &meta));
            }
        }
    }

    /// A junction, through `mklink /J` (no privilege needed). False where there is no such thing.
    fn junction(link: &Path, target: &Path) -> bool {
        cfg!(windows)
            && std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link.to_string_lossy().replace('/', "\\"))
                .arg(target.to_string_lossy().replace('/', "\\"))
                .output()
                .is_ok_and(|o| o.status.success())
    }

    /// A symlink to a file; false, with the reason printed, where the machine refuses one.
    fn file_symlink(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(target, link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        match made {
            Ok(()) => true,
            Err(e) => {
                println!("symlink case skipped: {e}");
                false
            }
        }
    }

    #[test]
    fn the_listing_scan_equals_the_per_file_scan_field_for_field() {
        let dir = scratch("differential");
        let outside = scratch("differential-outside");
        write(&outside.join("far.md"), b"far");
        write(&dir.join("plain.md"), b"plain");
        write(&dir.join("empty.md"), b"");
        fs::create_dir_all(dir.join("empty-folder")).expect("empty folder");
        write(&dir.join("a/b/c/d/e/f/deep.md"), b"deep");
        write(&dir.join("node_modules/denied.md"), b"denied");
        write(&dir.join("Case.md"), b"upper");
        write(&dir.join("case.txt"), b"lower");
        write(&dir.join("CASE.TXT"), b"upper again, longer");
        write(&dir.join(format!("{}.md", "long".repeat(50))), b"long name");
        write(&dir.join("with space and \u{e9}.md"), b"unicode");
        write(&dir.join("hard-src.md"), b"hard");
        fs::hard_link(dir.join("hard-src.md"), dir.join("hard-twin.md")).expect("hard link");
        let junction_made = junction(&dir.join("junction"), &outside)
            && junction(&dir.join("a/inner-junction"), &dir.join("a/b"));
        let symlink_made = file_symlink(&dir.join("link.md"), &dir.join("plain.md"));
        println!("differential: junctions {junction_made}, symlink {symlink_made}");

        let mut old = Snapshot::new();
        reference_scan(&dir, &mut old);
        let mut new = Snapshot::new();
        scan_tree(&dir, &mut new, None, &BTreeSet::new()).expect("scan");
        assert_eq!(new, old);
        assert!(new.len() >= 9, "{} files", new.len());
        assert!(!new.keys().any(|p| p.ends_with("denied.md")));
        assert!(
            !new.keys().any(|p| p.ends_with("far.md")),
            "no junction is followed"
        );
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn a_scan_lists_each_folder_once_and_opens_only_reparse_entries() {
        let dir = scratch("one-listing");
        let outside = scratch("one-listing-outside");
        for d in ["", "a", "a/b"] {
            for f in 0..5 {
                write(&dir.join(d).join(format!("f{f}.md")), b"x");
            }
        }
        let mut out = Snapshot::new();
        let before = stat_count::get();
        scan_tree(&dir, &mut out, None, &BTreeSet::new()).expect("scan");
        let plain_calls = stat_count::get() - before;
        assert_eq!(out.len(), 15);
        assert_eq!(plain_calls, 3, "one listing per folder, no stat per file");

        if junction(&dir.join("j1"), &outside) && junction(&dir.join("a/j2"), &outside) {
            let mut out = Snapshot::new();
            let before = stat_count::get();
            scan_tree(&dir, &mut out, None, &BTreeSet::new()).expect("scan");
            assert_eq!(out.len(), 15, "a junction is not followed");
            assert_eq!(
                stat_count::get() - before,
                3 + 2,
                "one stat per junction, nothing else"
            );
        } else {
            println!("junction call count skipped: no junctions here");
        }
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn a_file_created_two_directories_down_is_one_created() {
        let dir = scratch("created");
        write(&dir.join("top.md"), b"top");
        fs::create_dir_all(dir.join("a/b")).expect("dirs");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let new = dir.join("a/b/new.md");
        write(&new, b"# new\n");
        let events = tree
            .apply(std::slice::from_ref(&new), false)
            .expect("apply");
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Created,
                path: new.clone(),
                to: None
            }]
        );
        // FSEvents may name the directory instead; the subtree rebuild finds nothing new again.
        assert!(tree
            .apply(&[dir.join("a")], false)
            .expect("apply")
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn a_file_in_a_new_directory_reported_by_its_directory_is_one_created() {
        let dir = scratch("created-dir");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let new = dir.join("a/b/new.md");
        write(&new, b"# new\n");
        let events = tree.apply(&[dir.join("a")], false).expect("apply");
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
        let events = tree
            .apply(&[tmp.clone(), doc.clone()], false)
            .expect("apply");
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
        let events = tree
            .apply(&[from.clone(), to.clone()], false)
            .expect("apply");
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
        let events = tree.apply(&reported, false).expect("apply");
        let mut removed: Vec<_> = events
            .iter()
            .inspect(|e| assert_eq!(e.kind, WatchKind::Removed, "{events:?}"))
            .map(|e| e.path.clone())
            .collect();
        removed.sort();
        let mut want = gone.to_vec();
        want.sort();
        assert_eq!(removed, want);
        assert!(
            tree.apply(&reported, false).expect("apply").is_empty(),
            "once"
        );
        assert!(
            tree.apply(&[], true).expect("apply").is_empty(),
            "a full rescan agrees"
        );
        assert_eq!(tree.len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn paths_under_denied_folders_do_not_count_toward_a_reconcile() {
        let dir = scratch("countable");
        write(&dir.join("keep.md"), b"k");
        let tree = TreeWatch::open(&dir).expect("open");
        let root = canonical(&dir).expect("canonical");
        let reported = vec![
            root.join("target/debug/a.o"),
            root.join("node_modules/pkg/index.js"),
            root.join("src/node_modules/x.js"),
            root.join("keep.md"),
            root.join("src/b.md"),
            dir.parent().expect("parent").join("outside.md"),
        ];
        assert_eq!(tree.countable(&reported), 2);
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
        assert!(tree.apply(&reported, false).expect("apply").is_empty());
        assert!(
            tree.apply(&[], true).expect("apply").is_empty(),
            "nor on a full rescan"
        );
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
        assert!(tree.apply(&reported, false).expect("apply").is_empty());
        assert!(tree.apply(&[], true).expect("apply").is_empty());
        cleanup(&dir);
        cleanup(&outside);
    }

    #[test]
    fn paths_outside_the_root_are_ignored() {
        let dir = scratch("outside");
        let mut tree = TreeWatch::open(&dir).expect("open");
        let other = scratch("outside-other");
        write(&other.join("x.md"), b"x");
        assert!(tree
            .apply(&[other.join("x.md")], false)
            .expect("apply")
            .is_empty());
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
            scan_tree(&dir, &mut out, Some(4), &BTreeSet::new()),
            Err("too many files".to_string())
        );
        cleanup(&dir);
    }

    /// The index lists every file, so the watch reports every file: an image, an extension-less README and the names
    /// the registry knows (Program.cs, Dockerfile.dev, Justfile) all count against the limit and make events.
    #[test]
    fn every_regular_file_is_listed_and_reported_whatever_its_name() {
        let dir = scratch("every");
        let names = [
            "a.md",
            "img/logo.png",
            "README",
            "src/Program.cs",
            "Dockerfile.dev",
            "Justfile",
            "x.mk",
            "bin/blob",
        ];
        for name in names {
            write(&dir.join(name), b"x");
        }
        let mut out = Snapshot::new();
        scan_tree(&dir, &mut out, None, &BTreeSet::new()).expect("scan");
        assert_eq!(out.len(), names.len(), "{out:?}");
        assert_eq!(
            scan_tree(
                &dir,
                &mut Snapshot::new(),
                Some(names.len() - 1),
                &BTreeSet::new()
            ),
            Err(TOO_MANY.to_string())
        );
        let mut tree = TreeWatch::open(&dir).expect("open");
        let cs = dir.join("src/Program.cs");
        fs::remove_file(&cs).expect("remove");
        let events = tree.apply(std::slice::from_ref(&cs), false).expect("apply");
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Removed,
                path: cs,
                to: None
            }]
        );
        let png = dir.join("img/new.png");
        write(&png, b"png");
        let events = tree
            .apply(std::slice::from_ref(&png), false)
            .expect("apply");
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Created,
                path: png,
                to: None
            }]
        );
        cleanup(&dir);
    }

    #[test]
    fn a_tree_that_outgrows_the_limit_after_open_is_refused_and_keeps_its_snapshot() {
        let dir = scratch("grows");
        write(&dir.join("a.md"), b"a");
        write(&dir.join("b.md"), b"b");
        let mut tree =
            TreeWatch::open_limited(&dir, 3, &[]).expect("two files fit a limit of three");
        // A new file brings it to three: still within the limit.
        let c = dir.join("sub/c.md");
        write(&c, b"c");
        assert_eq!(
            tree.apply(std::slice::from_ref(&c), false)
                .expect("fits")
                .len(),
            1
        );
        // A directory of three more takes it past the limit; reported as the directory (a subtree
        // rebuild)...
        for name in ["x.md", "y.md", "z.md"] {
            write(&dir.join("big").join(name), b"x");
        }
        assert_eq!(
            tree.apply(&[dir.join("big")], false),
            Err(TOO_MANY.to_string())
        );
        assert_eq!(tree.len(), 3, "a refused patch changes nothing");
        // ...as one of its files...
        let one = dir.join("big/x.md");
        let two = dir.join("big/y.md");
        assert_eq!(tree.apply(&[one, two], false), Err(TOO_MANY.to_string()));
        // ...or by a full rescan.
        assert_eq!(tree.apply(&[], true), Err(TOO_MANY.to_string()));
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
        let events = tree
            .apply(std::slice::from_ref(&changed), false)
            .expect("apply");
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

    /// The reviewer's case: a case-only rename of a file and of a folder, as ReadDirectoryChangesW reports them (old
    /// name, then new). The old spelling still finds the file on a case-insensitive volume, and must not stay listed.
    /// Skipped, loudly, on a case-sensitive volume, where the two spellings are two names.
    #[test]
    fn a_case_only_rename_leaves_no_ghost_of_the_file_or_the_folder() {
        let dir = scratch("case-rename");
        write(&dir.join("Docs/x.md"), b"x");
        write(&dir.join("A.md"), b"a");
        if lstat(&dir.join("a.md")).is_err() {
            println!("case-rename: skipped: this volume is case-sensitive");
            cleanup(&dir);
            return;
        }
        let mut tree = TreeWatch::open(&dir).expect("open");
        fs::rename(dir.join("A.md"), dir.join("a.md")).expect("rename file");
        let events = tree
            .apply(&[dir.join("A.md"), dir.join("a.md")], false)
            .expect("apply");
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Renamed,
                path: dir.join("A.md"),
                to: Some(dir.join("a.md"))
            }]
        );
        fs::rename(dir.join("Docs"), dir.join("docs")).expect("rename folder");
        let events = tree
            .apply(&[dir.join("Docs"), dir.join("docs")], false)
            .expect("apply");
        assert_eq!(
            events,
            vec![WatchEvent {
                kind: WatchKind::Renamed,
                path: dir.join("Docs/x.md"),
                to: Some(dir.join("docs/x.md"))
            }]
        );
        assert_eq!(tree.len(), 2, "one entry per file");
        assert!(
            tree.apply(&[], true).expect("rescan").is_empty(),
            "a full rescan agrees"
        );
        fs::remove_file(dir.join("a.md")).expect("remove");
        let events = tree.apply(&[dir.join("a.md")], false).expect("apply");
        assert_eq!(events.len(), 1, "{events:?}");
        cleanup(&dir);
    }

    #[test]
    fn a_denied_name_in_any_case_is_never_listed() {
        let dir = scratch("deny-case");
        write(&dir.join("keep.md"), b"k");
        write(&dir.join("Build/out.md"), b"x");
        write(&dir.join("a/Node_Modules/x.md"), b"x");
        let mut tree = TreeWatch::open(&dir).expect("open");
        assert_eq!(tree.len(), 1);
        write(&dir.join("Build/new.md"), b"x");
        assert!(tree
            .apply(&[dir.join("Build/new.md"), dir.join("Build")], false)
            .expect("apply")
            .is_empty());
        cleanup(&dir);
    }

    /// the tree watch judges a name as `read_dir` does (its list is checked against deny.ts in fs.rs).
    #[test]
    fn the_deny_list_is_the_shells_one() {
        for name in crate::commands::fs::DENY_DIRECTORY_NAMES {
            for spelt in [name.to_string(), name.to_ascii_uppercase()] {
                assert!(is_denied(std::ffi::OsStr::new(&spelt)), "{spelt}");
            }
        }
        assert!(!is_denied(std::ffi::OsStr::new("notes")));
    }

    /// the list names folders; a file called `out` or `Build` is a file, listed and reported.
    #[test]
    fn a_file_named_like_a_denied_folder_is_listed_and_reported() {
        let dir = scratch("deny-file");
        write(&dir.join("out"), b"o");
        write(&dir.join("scripts/Build"), b"b");
        write(&dir.join("dist/x.md"), b"x");
        let mut tree = TreeWatch::open(&dir).expect("open");
        assert_eq!(tree.len(), 2);
        write(&dir.join("scripts/Build"), b"rebuilt, longer");
        let events = tree
            .apply(&[dir.join("scripts/Build")], false)
            .expect("apply");
        assert_eq!(events.len(), 1, "{events:?}");
        write(&dir.join("dist/y.md"), b"y");
        assert!(tree
            .apply(&[dir.join("dist/y.md"), dir.join("dist")], false)
            .expect("apply")
            .is_empty());
        cleanup(&dir);
    }

    /// A fixture with a build folder the index walk left out: its files are not in the snapshot, the count or the events.
    fn with_build_folder(name: &str) -> PathBuf {
        let dir = scratch(name);
        for n in 0..3 {
            write(&dir.join(format!("notes/n{n}.md")), b"n");
        }
        write(&dir.join("readme.md"), b"r");
        for n in 0..50 {
            write(&dir.join(format!("gen-out/deep/f{n}.js")), b"g");
        }
        dir
    }

    #[test]
    fn a_folder_left_out_has_no_files_in_the_snapshot_the_count_or_the_events() {
        let dir = with_build_folder("ignore-fixture");
        let before = TreeWatch::open(&dir).expect("open").len();
        let mut tree =
            TreeWatch::open_limited(&dir, MAX_FILES, &[dir.join("gen-out")]).expect("open");
        println!(
            "tree watch snapshot files: {before} without a folder left out, {} with it",
            tree.len()
        );
        assert_eq!(before, 54);
        assert_eq!(tree.len(), 4);

        write(&dir.join("gen-out/deep/new.js"), b"n");
        write(&dir.join("gen-out/deep/f1.js"), b"changed");
        let reported = [
            dir.join("gen-out"),
            dir.join("gen-out/deep"),
            dir.join("gen-out/deep/new.js"),
            dir.join("gen-out/deep/f1.js"),
        ];
        assert_eq!(
            tree.countable(&reported),
            0,
            "a build writing there owes no rescan"
        );
        assert!(tree.apply(&reported, false).expect("apply").is_empty());
        assert!(tree.apply(&[], true).expect("rescan").is_empty());
        assert_eq!(tree.len(), 4);

        write(&dir.join("notes/n9.md"), b"9");
        let events = tree
            .apply(&[dir.join("notes/n9.md")], false)
            .expect("apply");
        assert_eq!(events.len(), 1, "the rest of the tree is still watched");
        cleanup(&dir);
    }

    #[test]
    fn a_folder_that_stops_being_left_out_is_read_again_and_its_files_are_created() {
        let dir = with_build_folder("ignore-lift");
        let mut tree =
            TreeWatch::open_limited(&dir, MAX_FILES, &[dir.join("gen-out")]).expect("open");
        let events = tree.set_ignored(&[]).expect("lift");
        assert_eq!(tree.len(), 54);
        assert_eq!(events.len(), 50, "{events:?}");
        assert!(events.iter().all(|e| e.kind == WatchKind::Created));
        // And left out again: the files go from the snapshot without a word, and with no rescan.
        let calls = stat_count::get();
        let events = tree.set_ignored(&[dir.join("gen-out")]).expect("again");
        assert!(events.is_empty());
        assert_eq!(stat_count::get(), calls, "narrowing reads nothing");
        assert_eq!(tree.len(), 4);
        cleanup(&dir);
    }

    #[test]
    fn a_folder_inside_a_folder_left_out_changes_nothing_when_the_outer_one_stays() {
        let dir = with_build_folder("ignore-nested");
        let mut tree =
            TreeWatch::open_limited(&dir, MAX_FILES, &[dir.join("gen-out")]).expect("open");
        let events = tree
            .set_ignored(&[dir.join("gen-out"), dir.join("gen-out/deep")])
            .expect("set");
        assert!(events.is_empty());
        assert_eq!(tree.len(), 4);
        cleanup(&dir);
    }

    /// The front end may spell a folder with other separators or, on Windows, in other case.
    #[test]
    fn a_folder_is_left_out_whatever_its_spelling() {
        let dir = with_build_folder("ignore-spelling");
        let spelled = if cfg!(windows) {
            PathBuf::from(format!("{}\\GEN-OUT\\", dir.display()).replace('/', "\\"))
        } else {
            PathBuf::from(format!("{}/gen-out/", dir.display()))
        };
        let tree = TreeWatch::open_limited(&dir, MAX_FILES, &[spelled]).expect("open");
        assert_eq!(tree.len(), 4);
        cleanup(&dir);
    }

    #[test]
    fn a_folder_outside_the_root_cannot_be_named() {
        let dir = with_build_folder("ignore-outside");
        let sibling = scratch("ignore-outside-sibling");
        write(&sibling.join("x.md"), b"x");
        let named = [
            sibling.clone(),
            dir.clone(),
            dir.join("notes/../../escape"),
            dir.join("notes/./"),
            PathBuf::from("notes"),
            PathBuf::from(format!("{}-notes", dir.display())),
            // Other spellings of a folder inside are dropped too: the list only ever narrows by plain prefix.
            PathBuf::from(format!(r"\\?\{}\gen-out", dir.display())),
            PathBuf::from(format!(r"\\localhost\{}\gen-out", dir.display())),
        ];
        let tree = TreeWatch::open_limited(&dir, MAX_FILES, &named).expect("open");
        assert_eq!(tree.len(), 54, "nothing was left out");
        assert!(tree.ignored.is_empty(), "{:?}", tree.ignored);
        cleanup(&dir);
        cleanup(&sibling);
    }
}
