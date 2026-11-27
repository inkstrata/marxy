//! The kept key index answers every judgement as the per-call key lists did. `old_judge` and the two `old_*_keys`
//! are those lists and their linear scan, kept here as the reference.

use std::path::{Path, PathBuf};

use super::*;

struct OldKeys {
    files: Vec<PathBuf>,
    read: Vec<PathBuf>,
    write: Vec<PathBuf>,
}

fn old_spelled_keys(set: &OpenedSet) -> OldKeys {
    let spellings = |f: &Folder| f.spellings.clone();
    OldKeys {
        files: set.file_spellings.iter().cloned().collect(),
        read: read_places(set).flat_map(spellings).collect(),
        write: write_places(set).flat_map(spellings).collect(),
    }
}

fn old_canonical_keys(set: &OpenedSet) -> OldKeys {
    let key = |f: &Folder| spelling(&f.canonical);
    OldKeys {
        files: set.files.iter().filter_map(|f| spelling(f)).collect(),
        read: read_places(set).filter_map(key).collect(),
        write: write_places(set).filter_map(key).collect(),
    }
}

fn old_judge(path: &Path, k: &OldKeys, need: Need) -> Judged {
    let inside = k.files.iter().any(|f| f == path) || k.read.iter().any(|p| path.starts_with(p));
    let above = |dir: &Path| {
        k.files
            .iter()
            .chain(&k.read)
            .any(|held| held.starts_with(dir))
    };
    let writable = k.files.iter().any(|f| f == path) || k.write.iter().any(|p| path.starts_with(p));
    let beside = || {
        path.parent()
            .is_some_and(|dir| k.files.iter().any(|f| f.parent() == Some(dir)))
    };
    let held = match need {
        Need::Read => inside,
        Need::List => inside || above(path),
        Need::Folder => inside || k.files.iter().any(|f| f.parent() == Some(path)),
        Need::Write => writable,
        Need::Create => writable || beside(),
    };
    if held {
        return Judged::Held;
    }
    match (need, git_probe(path)) {
        (Need::Read | Need::List, Some(dir)) if above(dir) => Judged::Probe(dir.to_path_buf()),
        _ => Judged::Outside,
    }
}

const NEEDS: [Need; 5] = [
    Need::Read,
    Need::List,
    Need::Folder,
    Need::Write,
    Need::Create,
];

struct Rng(u64);

impl Rng {
    fn next(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % below as u64) as usize
    }
}

/// A path from a small alphabet, so keys and probes collide often: case variants, `.git`, `HEAD`, mixed separators on
/// Windows, a second drive or share, verbatim spellings, and a bare drive or share root.
fn raw_path(rng: &mut Rng) -> String {
    const NAMES: [&str; 8] = ["a", "b", "A", "c", "d", ".git", "HEAD", "head"];
    let root = if cfg!(windows) {
        [
            "C:\\",
            "c:/",
            "D:\\",
            "\\\\srv\\share\\",
            "\\\\SRV\\Share\\",
            "\\\\?\\C:\\",
            "\\\\?\\UNC\\srv\\share\\",
        ][rng.next(7)]
    } else {
        "/"
    };
    let mut out = root.to_string();
    let depth = rng.next(6);
    for i in 0..depth {
        if i > 0 {
            out.push(if cfg!(windows) && rng.next(2) == 0 {
                '/'
            } else {
                std::path::MAIN_SEPARATOR
            });
        }
        out.push_str(NAMES[rng.next(NAMES.len())]);
    }
    out
}

fn agree(set: &OpenedSet, probes: &[PathBuf], what: &str) {
    let (os, oc) = (old_spelled_keys(set), old_canonical_keys(set));
    for p in probes {
        for need in NEEDS {
            assert_eq!(
                judge(p, &set.spelled, need),
                old_judge(p, &os, need),
                "spelled {p:?} {need:?} after {what}"
            );
            assert_eq!(
                judge(p, &set.canonical, need),
                old_judge(p, &oc, need),
                "canonical {p:?} {need:?} after {what}"
            );
        }
    }
}

#[test]
fn the_kept_keys_judge_every_path_as_the_per_call_lists_did() {
    let mut checked = 0usize;
    let mut dropped = 0usize;
    for seed in 1..=20u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut set = OpenedSet::default();
        let mut pool: Vec<PathBuf> = Vec::new();
        let mut root_names: Vec<String> = Vec::new();
        for step in 0..60 {
            let raw = raw_path(&mut rng);
            let other = raw_path(&mut rng);
            let (raw_p, other_p) = (PathBuf::from(&raw), PathBuf::from(&other));
            let what = match rng.next(8) {
                0 | 1 => {
                    set.add_file(&raw_p, other_p.clone());
                    "add_file"
                }
                2 => {
                    set.add_file(&raw_p, raw_p.clone());
                    "add_file same"
                }
                3 => {
                    if let Some(s) = spelling(&raw_p) {
                        set.add_file_spelling(s);
                    }
                    "spelling only"
                }
                4 => {
                    set.add_folder(&raw_p, other_p.clone());
                    "add_folder"
                }
                5 => {
                    root_names.push(if rng.next(2) == 0 {
                        raw.clone()
                    } else {
                        other.clone()
                    });
                    if rng.next(2) == 0 {
                        set.add_root(&raw_p, other_p.clone());
                    } else {
                        set.add_index_root(&raw_p, other_p.clone());
                    }
                    "add_root"
                }
                6 => {
                    if rng.next(2) == 0 {
                        set.add_picked_folder(&raw_p, other_p.clone());
                    } else {
                        set.add_app_folder(&raw_p, other_p.clone());
                    }
                    "add_picked or app"
                }
                _ => {
                    // `place` fails for a path that is not on disk: the spelled branch of the drop runs. Mostly a root
                    // added before, by either of its names, so roots do leave.
                    let name = match root_names.len() {
                        n if n > 0 && rng.next(4) != 0 => root_names.swap_remove(rng.next(n)),
                        _ => raw.clone(),
                    };
                    let before = set.roots.len();
                    let lock = RwLock::new(std::mem::take(&mut set));
                    drop_root(&lock, &name);
                    set = lock.into_inner().unwrap();
                    dropped += before - set.roots.len();
                    "drop_root"
                }
            };
            for p in [&raw_p, &other_p] {
                if let Some(s) = spelling(p) {
                    pool.push(s);
                }
            }
            if step % 3 == 0 || what == "drop_root" {
                // Every pooled key, its ancestors, its children and its repository probes.
                let mut probes: Vec<PathBuf> = Vec::new();
                for p in pool.iter().rev().take(24) {
                    probes.extend(p.ancestors().map(Path::to_path_buf));
                    probes.push(p.join("a"));
                    probes.push(p.join(".git"));
                    probes.push(p.join(".git").join("HEAD"));
                    if let Some(s) = spelling(&PathBuf::from(raw_path(&mut rng))) {
                        probes.push(s);
                    }
                }
                checked += probes.len() * NEEDS.len() * 2;
                agree(&set, &probes, what);
            }
        }
    }
    assert!(checked > 100_000, "{checked}");
    assert!(dropped > 20, "{dropped} roots dropped");
}

#[test]
fn a_place_key_that_is_a_bare_root_still_covers_what_is_under_it() {
    let mut set = OpenedSet::default();
    let root = if cfg!(windows) { r"C:\" } else { "/" };
    set.add_app_folder(Path::new(root), PathBuf::from(root));
    let deep = if cfg!(windows) { r"c:\x\y\z" } else { "/x/y/z" };
    let p = spelling(Path::new(deep)).unwrap();
    agree(
        &set,
        &[p.clone(), p.parent().unwrap().to_path_buf()],
        "root place",
    );
    assert_eq!(judge(&p, &set.spelled, Need::Read), Judged::Held);
}

fn probes_of(set: &OpenedSet, path: &Path, need: Need) -> usize {
    let key = spelling(path).unwrap();
    let before = PROBES.with(|c| c.get());
    let _ = judge(&key, &set.spelled, need);
    PROBES.with(|c| c.get()) - before
}

fn with_files(n: usize) -> OpenedSet {
    let mut set = OpenedSet::default();
    let base = if cfg!(windows) { r"C:\notes" } else { "/notes" };
    set.add_root(Path::new(base), PathBuf::from(base));
    for i in 0..n {
        let f = Path::new(base)
            .join(format!("d{}", i % 50))
            .join(format!("f{i}.md"));
        set.add_file(&f, f.clone());
    }
    set
}

#[test]
fn a_check_does_the_same_work_whatever_the_set_holds_and_rebuilds_nothing() {
    let probe_path = if cfg!(windows) {
        r"C:\notes\d3\sub\x.md"
    } else {
        "/notes/d3/sub/x.md"
    };
    let outside = if cfg!(windows) {
        r"C:\elsewhere\a\b\c.md"
    } else {
        "/elsewhere/a/b/c.md"
    };
    let (small, large) = (with_files(10), with_files(3000));
    for need in NEEDS {
        for path in [probe_path, outside] {
            let (a, b) = (
                probes_of(&small, Path::new(path), need),
                probes_of(&large, Path::new(path), need),
            );
            assert_eq!(
                a, b,
                "{path} {need:?}: 10 files and 3000 files cost the same"
            );
            assert!(a <= 40, "{a} lookups for one path");
        }
    }
    let rebuilds = REBUILDS.with(|c| c.get());
    let before = PROBES.with(|c| c.get());
    let calls = 1000;
    for i in 0..calls {
        let p = Path::new(if cfg!(windows) { r"C:\notes" } else { "/notes" })
            .join(format!("d{}", i % 50))
            .join(format!("f{i}.md"));
        let key = spelling(&p).unwrap();
        assert_eq!(judge(&key, &large.spelled, Need::Read), Judged::Held);
        assert_eq!(judge(&key, &large.canonical, Need::Read), Judged::Held);
    }
    assert_eq!(
        REBUILDS.with(|c| c.get()),
        rebuilds,
        "a check rebuilds no keys"
    );
    let per_call = (PROBES.with(|c| c.get()) - before) / (calls * 2);
    assert!(per_call <= 12, "{per_call} lookups a call, 3000 files held");
}

#[test]
fn a_thousand_opens_rebuild_the_place_keys_only_when_a_place_is_added() {
    let before = REBUILDS.with(|c| c.get());
    let set = with_files(1000);
    // One for the root, in each of the two indexes; adding files rebuilds no place key.
    assert_eq!(REBUILDS.with(|c| c.get()) - before, 2);
    drop(set);
}
