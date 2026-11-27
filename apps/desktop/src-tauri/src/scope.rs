//! What the path commands answer for: `read_file`, `read_head`, `read_dir`, `stat_file`, `real_path`, `image_size`,
//! `detect_files`, `search_content`, the watches and the two writes. A path is in scope when it is a file the reader
//! opened, or lies in a place the reader chose (a folder scoped for a document, an index root, a collection's folder,
//! a folder picked in the picker), or in Marxy's own data and config folders. Reading a file never puts it in scope:
//! only `mark_opened`, the launch arguments, a second launch, a drop and the pickers do, so what the index reads stays
//! the index's and `marxy-file://` (src/file_scheme.rs) never serves a file because it was indexed. Writing is narrower
//! than reading: a file the reader opened or named, a folder they picked, Marxy's own folders, and a new name beside an
//! opened file; an index root, a theme folder or a folder scoped for a document is read-only.
//!
//! Judged the way `file_scheme::resolve` judges: by spelling first, so a path outside never reaches the disk (a share's
//! name would be looked up with the reader's credentials); then canonical, so a `..`, a symlink or a junction that leads
//! out is refused. A write is judged again by its folder's handle, held open through the write (`hold_parent`): on
//! Windows the folder and those above it cannot be renamed or swapped for a junction while it is held. Every read judges
//! the handle it opened, not the name: `read_file`, `read_head` (and `detect_files`, which reads through it),
//! `image_size` and `stat_file` read from that handle, `read_dir` lists a folder it holds open (on Unix the listing is by
//! name once the handle is judged), and `real_path` answers with the path the check judged rather than resolving it
//! again. A database's `-wal` and `-shm` are judged the same way before SQLite may read them (src/tables/sqlite.rs).
//! Paths compare by `file_scheme::spelling`: one separator, no verbatim prefix, and one case on Windows.
//!
//! The set is fed by the page, so it bounds what a document can make the page reach, not what a compromised page can.

use std::collections::HashSet;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::error::ShellError;
use crate::file_scheme::{self, push_folder, spelling, Folder, OpenedSet, Refusal};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Need {
    /// A file's bytes. Also a repository's `.git` marker in a folder above a held file or place, when no repository lies
    /// nearer, so the index can find the root of a document before that root is chosen.
    Read,
    /// One entry's metadata (`stat_file`, `real_path`): what `Read` holds, plus every folder above a held file or place
    /// (the breadcrumbs).
    List,
    /// A folder's listing (`read_dir`, a flat watch): inside a place, or the folder of a file the reader opened.
    Folder,
    /// Replace a file: one the reader opened or chose a name for, or one inside a folder they picked or Marxy's own.
    Write,
    /// Make a file that is not there: as `Write`, or a new name beside a file the reader opened (Fork). The name is
    /// judged, never what a link at it leads to.
    Create,
}

/// Where the reader may read: every place.
fn read_places(set: &OpenedSet) -> impl Iterator<Item = &Folder> {
    set.folders
        .iter()
        .chain(&set.roots)
        .chain(&set.picked)
        .chain(&set.app)
}

/// Where the reader may write: a folder picked in the picker, and Marxy's own.
fn write_places(set: &OpenedSet) -> impl Iterator<Item = &Folder> {
    set.picked.iter().chain(&set.app)
}

/// The folder a repository probe asks about: `<dir>/.git` or `<dir>/.git/HEAD`.
fn git_probe(path: &Path) -> Option<&Path> {
    let name = path.file_name()?.to_str()?;
    let parent = path.parent()?;
    if name == ".git" {
        return Some(parent);
    }
    let in_git = parent.file_name().and_then(|n| n.to_str()) == Some(".git");
    (name.eq_ignore_ascii_case("head") && in_git).then(|| parent.parent())?
}

/// The held files and places, as keys, kept in step with the set so a check looks a path up instead of listing every
/// key again. A path is "under" a place when one of its ancestors (itself included) is a place key, and a folder is
/// "above" a held key when it is one of that key's ancestors: both are the answers `starts_with` gave, as one lookup per
/// ancestor. Keys are spelled (`spelling`), so they carry no `.`, no trailing separator and one case on Windows.
#[derive(Debug, Default)]
pub(crate) struct KeyIndex {
    files: HashSet<PathBuf>,
    /// The folder of each file key: a file's folder is listable and a new name beside the file is creatable.
    file_parents: HashSet<PathBuf>,
    above_files: HashSet<PathBuf>,
    read: HashSet<PathBuf>,
    above_read: HashSet<PathBuf>,
    write: HashSet<PathBuf>,
}

/// Every ancestor of `key`, itself included, into `into`. It stops at the first one already there: its own ancestors
/// were added with it.
fn add_ancestors(into: &mut HashSet<PathBuf>, key: &Path) {
    for a in key.ancestors() {
        if !into.insert(a.to_path_buf()) {
            break;
        }
    }
}

fn under(set: &HashSet<PathBuf>, path: &Path) -> bool {
    path.ancestors().any(|a| {
        probe();
        set.contains(a)
    })
}

impl KeyIndex {
    fn add_file(&mut self, key: PathBuf) {
        if let Some(parent) = key.parent() {
            self.file_parents.insert(parent.to_path_buf());
        }
        add_ancestors(&mut self.above_files, &key);
        self.files.insert(key);
    }

    fn set_places(&mut self, read: HashSet<PathBuf>, write: HashSet<PathBuf>) {
        self.above_read.clear();
        for key in &read {
            add_ancestors(&mut self.above_read, key);
        }
        self.read = read;
        self.write = write;
        #[cfg(test)]
        REBUILDS.with(|c| c.set(c.get() + 1));
    }

    fn has_file(&self, path: &Path) -> bool {
        probe();
        self.files.contains(path)
    }

    fn has_parent(&self, dir: &Path) -> bool {
        probe();
        self.file_parents.contains(dir)
    }

    fn above(&self, dir: &Path) -> bool {
        probe();
        self.above_files.contains(dir) || self.above_read.contains(dir)
    }
}

#[cfg(test)]
thread_local! {
    /// Hash lookups a judgement made, and place-key rebuilds: what the tests count instead of a clock.
    pub(crate) static PROBES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    pub(crate) static REBUILDS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[inline]
fn probe() {
    #[cfg(test)]
    PROBES.with(|c| c.set(c.get() + 1));
}

#[derive(Debug, PartialEq, Eq)]
enum Judged {
    Held,
    /// Only as a repository probe of this folder (a key): held if no repository lies nearer (`nearest_repository`).
    Probe(PathBuf),
    Outside,
}

fn judge(path: &Path, k: &KeyIndex, need: Need) -> Judged {
    let is_file = k.has_file(path);
    let inside = is_file || under(&k.read, path);
    let beside = || path.parent().is_some_and(|dir| k.has_parent(dir));
    let held = match need {
        Need::Read => inside,
        Need::List => inside || k.above(path),
        Need::Folder => inside || k.has_parent(path),
        Need::Write => is_file || under(&k.write, path),
        Need::Create => is_file || under(&k.write, path) || beside(),
    };
    if held {
        return Judged::Held;
    }
    match (need, git_probe(path)) {
        (Need::Read | Need::List, Some(dir)) if k.above(dir) => Judged::Probe(dir.to_path_buf()),
        _ => Judged::Outside,
    }
}

impl OpenedSet {
    /// Rebuilds the place keys after the folder lists changed; folders are few, so this is cheap.
    pub(crate) fn reindex_places(&mut self) {
        let spelled = |places: &mut dyn Iterator<Item = &Folder>| -> HashSet<PathBuf> {
            places.flat_map(|f| f.spellings.iter().cloned()).collect()
        };
        let canonical = |places: &mut dyn Iterator<Item = &Folder>| -> HashSet<PathBuf> {
            places.filter_map(|f| spelling(&f.canonical)).collect()
        };
        let (sr, sw) = (
            spelled(&mut read_places(self)),
            spelled(&mut write_places(self)),
        );
        let (cr, cw) = (
            canonical(&mut read_places(self)),
            canonical(&mut write_places(self)),
        );
        self.spelled.set_places(sr, sw);
        self.canonical.set_places(cr, cw);
    }

    /// A file the page opened, by the spelling it was named with: held by that spelling alone until it has a canonical
    /// form.
    pub(crate) fn add_file_spelling(&mut self, spelled: PathBuf) {
        if self.file_spellings.insert(spelled.clone()) {
            self.spelled.add_file(spelled);
        }
    }

    /// A file's canonical key, for `files` gaining `plain_canonical`.
    pub(crate) fn add_file_canonical(&mut self, plain_canonical: &Path) {
        if let Some(key) = spelling(plain_canonical) {
            self.canonical.add_file(key);
        }
    }

    fn judge_canonical(&self, canonical: &Path, need: Need) -> Judged {
        match spelling(canonical) {
            Some(key) => judge(&key, &self.canonical, need),
            None => Judged::Outside,
        }
    }

    fn holds_canonical(&self, canonical: &Path, need: Need) -> bool {
        self.judge_canonical(canonical, need) == Judged::Held
    }

    /// The canonical folders a probe may climb from: each held file's folder and each place.
    fn starts(&self) -> Vec<PathBuf> {
        let files = self
            .files
            .iter()
            .filter_map(|f| f.parent().map(Path::to_path_buf));
        files
            .chain(read_places(self).map(|f| f.canonical.clone()))
            .collect()
    }

    pub fn add_root(&mut self, raw: &Path, canonical: PathBuf) {
        push_folder(&mut self.roots, raw, canonical);
        self.reindex_places();
    }

    /// A root only the index holds: `drop_root` ends it.
    pub fn add_index_root(&mut self, raw: &Path, canonical: PathBuf) {
        push_folder(&mut self.roots, raw, canonical);
        self.reindex_places();
    }

    /// A root the reader chose for something besides the index: `drop_root` leaves it.
    pub fn keep_root(&mut self, canonical: &Path) {
        self.roots_kept.insert(canonical.to_path_buf());
    }

    pub fn add_app_folder(&mut self, raw: &Path, canonical: PathBuf) {
        push_folder(&mut self.app, raw, canonical);
        self.reindex_places();
    }

    pub fn add_picked_folder(&mut self, raw: &Path, canonical: PathBuf) {
        push_folder(&mut self.picked, raw, canonical);
        self.reindex_places();
    }
}

fn held(set: &RwLock<OpenedSet>, judge: impl FnOnce(&OpenedSet) -> bool) -> bool {
    set.read().map(|s| judge(&s)).unwrap_or(false)
}

/// Whether `dir` (a key) is the nearest repository above some place the probe climbs from: no folder between holds a
/// `.git`. A probe stops at the first repository it meets, as the index's own search does, so nothing further up is read.
fn nearest_repository(starts: &[PathBuf], dir: &Path) -> bool {
    starts.iter().any(|start| {
        for folder in start.ancestors() {
            if spelling(folder).as_deref() == Some(dir) {
                return true;
            }
            if folder.join(".git").exists() {
                return false;
            }
        }
        false
    })
}

/// `raw`'s canonical form for `need`. A write may name a file that is not there yet: its folder is canonical and its
/// name kept. A create judges the name itself, so a link at it is never followed out of the place.
fn resolved(raw: &Path, need: Need) -> Result<PathBuf, Refusal> {
    let beside = || -> Result<PathBuf, Refusal> {
        let (Some(parent), Some(name)) = (raw.parent(), raw.file_name()) else {
            return Err(Refusal::Outside);
        };
        Ok(file_scheme::canonical(parent)?.join(name))
    };
    match need {
        Need::Read | Need::List | Need::Folder => file_scheme::canonical(raw),
        Need::Create => beside(),
        Need::Write => match file_scheme::canonical(raw) {
            Err(Refusal::NotFound) => beside(),
            other => other,
        },
    }
}

/// The canonical path of `raw` when `set` holds it for `need`, else a typed refusal (`outside`); a path in scope that is
/// not there is `not-found`.
pub fn check(set: &RwLock<OpenedSet>, raw: &str, need: Need) -> Result<PathBuf, ShellError> {
    crate::commands::fs::absolute(raw)?;
    let path = Path::new(raw);
    let spelled = spelling(path).ok_or_else(|| ShellError::outside(raw))?;
    if !held(set, |s| {
        judge(&spelled, &s.spelled, need) != Judged::Outside
    }) {
        return Err(ShellError::outside(raw));
    }
    let canonical = match resolved(path, need) {
        Ok(c) => c,
        Err(Refusal::NotFound) => {
            return Err(ShellError::not_found(
                raw,
                format!("{raw}: no such file or folder"),
            ))
        }
        Err(Refusal::Io(e)) => return Err(ShellError::io(raw, e)),
        Err(Refusal::Outside) => return Err(ShellError::outside(raw)),
    };
    // `starts` is only the probe's input, so it is listed only for a probe, under the same lock as the judgement.
    let (judged, starts) = match set.read() {
        Ok(s) => {
            let judged = s.judge_canonical(&canonical, need);
            let starts = if matches!(judged, Judged::Probe(_)) {
                s.starts()
            } else {
                Vec::new()
            };
            (judged, starts)
        }
        Err(_) => (Judged::Outside, Vec::new()),
    };
    // The probe's disk look runs outside the lock: a stalled share must not hold it.
    match judged {
        Judged::Held => Ok(canonical),
        Judged::Probe(dir) if nearest_repository(&starts, &dir) => Ok(canonical),
        _ => Err(ShellError::outside(raw)),
    }
}

/// `check` against the session's set.
pub fn admit(raw: &str, need: Need) -> Result<PathBuf, ShellError> {
    check(file_scheme::opened(), raw, need)
}

/// Whether the file behind `file`, opened from `path`, is still in scope: a link swapped in between the check and the
/// open would have led the open elsewhere.
pub fn handle_in(set: &RwLock<OpenedSet>, file: &File, path: &Path, need: Need) -> bool {
    #[cfg(windows)]
    {
        let _ = path;
        file_scheme::final_path(file).is_some_and(|p| held(set, |s| s.holds_canonical(&p, need)))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (Ok(opened), Ok(again)) = (file.metadata(), dunce::canonicalize(path)) else {
            return false;
        };
        let same = std::fs::metadata(&again)
            .is_ok_and(|m| m.dev() == opened.dev() && m.ino() == opened.ino());
        same && held(set, |s| s.holds_canonical(&again, need))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        held(set, |s| s.holds_canonical(path, need))
    }
}

/// Whether `file` is open on `canonical`, the path `check` judged: a link swapped in at the path, or onto a folder above
/// it, between the check and the open would have led the open elsewhere. Narrower than `handle_in`, so it also holds for
/// a repository probe, which `check` admits by more than the set.
pub fn handle_is(file: &File, canonical: &Path) -> bool {
    let key = |p: &Path| spelling(&file_scheme::plain(p));
    #[cfg(windows)]
    {
        file_scheme::final_path(file)
            .is_some_and(|p| key(&p).is_some() && key(&p) == key(canonical))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (Ok(opened), Ok(again)) = (file.metadata(), dunce::canonicalize(canonical)) else {
            return false;
        };
        let same = std::fs::metadata(&again)
            .is_ok_and(|m| m.dev() == opened.dev() && m.ino() == opened.ino());
        same && key(&again) == key(canonical)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (file, key, canonical);
        true
    }
}

/// Opens a file or folder for reading so that, on Windows, it cannot be renamed, deleted or replaced while the handle is
/// open (no delete sharing), and neither can a folder above it: what `handle_is` judged of it stays true until it is
/// dropped. Elsewhere it is an ordinary open that does not block on a pipe, judged once.
pub fn open_held(path: &Path) -> std::io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ_WRITE: u32 = 0x1 | 0x2;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        File::options()
            .read(true)
            .share_mode(FILE_SHARE_READ_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    }
    #[cfg(not(windows))]
    {
        file_scheme::open_unblocked(path)
    }
}

/// Opens a file or folder only to ask the handle where it is and what it is. On Windows it asks for its attributes alone,
/// so a file another program holds without sharing still answers, as a stat by name would.
pub fn open_for_stat(path: &Path) -> std::io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_READ_ATTRIBUTES: u32 = 0x80;
        const FILE_SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        File::options()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_ALL)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    }
    #[cfg(not(windows))]
    {
        file_scheme::open_unblocked(path)
    }
}

/// A write's folder, open for as long as the write runs. Dropping it lets the folder go.
#[derive(Debug)]
pub struct ParentHold {
    _folder: File,
}

/// Opens the folder `target` (a checked, canonical path) is written into and judges the file's place by that handle:
/// a junction or link swapped onto the folder after `check` is refused. On Windows the folder is opened without delete
/// sharing, so neither it nor a folder above it can be renamed or replaced until the write is done; on Unix the handle is
/// judged once, before the write stages.
pub fn hold_parent(
    set: &RwLock<OpenedSet>,
    target: &Path,
    need: Need,
) -> Result<ParentHold, ShellError> {
    let shown = target.to_string_lossy().into_owned();
    let (Some(parent), Some(name)) = (target.parent(), target.file_name()) else {
        return Err(ShellError::outside(shown));
    };
    #[cfg(windows)]
    let (folder, at) = {
        let folder = open_held(parent).map_err(|e| ShellError::io(&shown, e.to_string()))?;
        let at = file_scheme::final_path(&folder).ok_or_else(|| ShellError::outside(&shown))?;
        (folder, at)
    };
    #[cfg(not(windows))]
    let (folder, at) = {
        let folder = File::open(parent).map_err(|e| ShellError::io(&shown, e.to_string()))?;
        let at = dunce::canonicalize(parent).map_err(|e| ShellError::io(&shown, e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let (Ok(opened), Ok(named)) = (folder.metadata(), std::fs::metadata(&at)) else {
                return Err(ShellError::outside(shown));
            };
            if opened.dev() != named.dev() || opened.ino() != named.ino() {
                return Err(ShellError::outside(shown));
            }
        }
        (folder, at)
    };
    if held(set, |s| s.holds_canonical(&at.join(name), need)) {
        Ok(ParentHold { _folder: folder })
    } else {
        Err(ShellError::outside(shown))
    }
}

/// Records a file the reader opened. Its spelling is kept even when it is not there (a document from the layout that was
/// deleted), so its read says `not-found` rather than `outside`; a file not there yet is held by its folder's canonical
/// path and its name, which is how a Save as names its destination.
pub fn open_file(set: &RwLock<OpenedSet>, raw: &str) {
    let path = Path::new(raw);
    let Some(spelled) = spelling(path) else {
        return;
    };
    let canonical = resolved(path, Need::Write).ok();
    if let Ok(mut set) = set.write() {
        set.add_file_spelling(spelled);
        if let Some(c) = canonical {
            set.add_file(path, c);
        }
    }
}

/// An existing folder that may be a place: never a drive's or a share's root.
fn place(raw: &str) -> Result<PathBuf, ShellError> {
    crate::commands::fs::absolute(raw)?;
    let c = file_scheme::canonical(Path::new(raw)).map_err(|_| ShellError::outside(raw))?;
    if !c.is_dir() || c.parent().is_none() {
        return Err(ShellError::outside(raw));
    }
    Ok(c)
}

/// Records a folder chosen for the index (read only). The home folder may be one (a document saved straight into it is
/// indexed there).
pub fn open_root(set: &RwLock<OpenedSet>, raw: &str) -> Result<PathBuf, ShellError> {
    let c = place(raw)?;
    if let Ok(mut set) = set.write() {
        set.add_root(Path::new(raw), c.clone());
        set.keep_root(&c);
    }
    Ok(c)
}

/// As `open_root`, for a folder the index holds: `drop_root` ends it unless something else chose it too.
pub fn open_index_root(set: &RwLock<OpenedSet>, raw: &str) -> Result<PathBuf, ShellError> {
    let c = place(raw)?;
    if let Ok(mut set) = set.write() {
        set.add_index_root(Path::new(raw), c.clone());
    }
    Ok(c)
}

/// The index let go of a folder it held as a root: the path commands stop answering for it. A folder the reader also
/// opened, picked or scoped for a document stays in scope by those records.
pub fn drop_root(set: &RwLock<OpenedSet>, raw: &str) {
    let canonical = place(raw).ok();
    let spelled = spelling(Path::new(raw));
    if let Ok(mut set) = set.write() {
        if canonical
            .as_ref()
            .is_some_and(|c| set.roots_kept.contains(c))
        {
            return;
        }
        set.roots.retain(|f| {
            Some(&f.canonical) != canonical.as_ref()
                && !spelled.as_ref().is_some_and(|s| f.spellings.contains(s))
        });
        set.reindex_places();
    }
}

/// Records a folder the reader picked in the picker: read and written.
pub fn open_picked_folder(set: &RwLock<OpenedSet>, raw: &str) -> Result<PathBuf, ShellError> {
    let c = place(raw)?;
    if let Ok(mut set) = set.write() {
        set.add_picked_folder(Path::new(raw), c.clone());
    }
    Ok(c)
}

/// Records one of Marxy's own folders (data, config); one that does not canonicalise is held by its spelling alone.
pub fn open_app_folder(set: &RwLock<OpenedSet>, path: &Path) {
    let c = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if let Ok(mut set) = set.write() {
        set.add_app_folder(path, c);
    }
}

/// The reader opened `path` (a file), or chose it as a folder for the index (`root`). The page calls it before it reads
/// what it opens: a link followed, a document from history or the restored layout, Compare's other side.
#[tauri::command]
pub async fn mark_opened(
    path: String,
    root: Option<bool>,
    indexed: Option<bool>,
) -> Result<(), ShellError> {
    crate::commands::fs::absolute(&path)?;
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        if indexed.unwrap_or(false) {
            open_index_root(file_scheme::opened(), &path).map(drop)
        } else if root.unwrap_or(false) {
            open_root(file_scheme::opened(), &path).map(drop)
        } else {
            open_file(file_scheme::opened(), &path);
            Ok(())
        }
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

/// The index let go of `path`, a folder it held as a root (`mark_opened` with `root`).
#[tauri::command]
pub async fn forget_root(path: String) -> Result<(), ShellError> {
    crate::commands::fs::absolute(&path)?;
    let shown = path.clone();
    crate::commands::fs::off_main(move || drop_root(file_scheme::opened(), &path))
        .await
        .map_err(|e| ShellError::io(&shown, e))
}

#[cfg(test)]
#[path = "scope_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "scope_keys_tests.rs"]
mod key_tests;
