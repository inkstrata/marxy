//! What a document may load: the rule `marxy-file://` (src/file_scheme.rs) serves by, and the readers that answer for
//! a file the page shows (`image_facts`, `font_facts`, `media_facts`, the archive and table commands, Open with). A file
//! the reader opened, or one under a folder scoped through `allow_asset_scope` (the document's folder, an image root, a
//! theme's folder), but never a dot file or folder, nor one of the index's denied folders (`.git`, `node_modules`...),
//! below that folder, unless the page measured the file there as an image a document names (`open_measured_image`).
//! Narrower than any `Need` of the path commands: an index root, a picked folder and Marxy's own folders are never
//! served. Judged by spelling first, then canonical, then by the handle actually opened (`handle_served`).

use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;

use super::set::{canonical, held, opened, plain, spelling, OpenedSet, Refusal};
use crate::error::ShellError;

/// Whether `rest`, the part of a path below an opened folder, is a dot name, or passes through a dot name or a denied
/// folder. The last part is the file asked for, so a file named `build` or `out` is no denied folder.
pub(crate) fn hidden_below(rest: &Path) -> bool {
    let count = rest.components().count();
    rest.components().enumerate().any(|(i, c)| match c {
        Component::Normal(name) => name.to_str().is_none_or(|n| {
            n.starts_with('.') || (i + 1 < count && crate::commands::fs::denied_name(n))
        }),
        _ => false,
    })
}

/// `path` is `folder` or below it, and not hidden there.
fn under(path: &Path, folder: &Path) -> bool {
    path.strip_prefix(folder)
        .is_ok_and(|rest| !hidden_below(rest))
}

impl OpenedSet {
    /// Whether the set could hold `raw`, judged by its spelling alone, without asking the disk.
    pub fn may_hold(&self, raw: &Path) -> bool {
        let Some(s) = spelling(raw) else {
            return false;
        };
        self.file_spellings.contains(&s)
            || self
                .folders
                .iter()
                .any(|f| f.spellings.iter().any(|folder| under(&s, folder)))
    }

    /// Whether `canonical` sits under a folder the page opened, hidden there or not.
    fn within_a_folder(&self, canonical: &Path) -> bool {
        let canonical = plain(canonical);
        self.folders
            .iter()
            .any(|f| canonical.starts_with(plain(&f.canonical)))
    }

    /// Whether `canonical` is a file the page opened or sits, not hidden, under a folder it opened.
    pub fn holds(&self, canonical: &Path) -> bool {
        let canonical = plain(canonical);
        self.files.contains(&canonical)
            || self
                .folders
                .iter()
                .any(|f| under(&canonical, &plain(&f.canonical)))
    }
}

/// The canonical path of `raw` when `set` holds it: by spelling first, so nothing outside reaches the disk (a share's
/// name would be looked up, and answered with the reader's credentials), then canonical. Canonicalised outside the lock:
/// a stalled share must not hold it.
pub fn resolve(set: &RwLock<OpenedSet>, raw: &Path) -> Result<PathBuf, Refusal> {
    if !held(set, |s| s.may_hold(raw)) {
        return Err(Refusal::Outside);
    }
    let path = canonical(raw)?;
    if held(set, |s| s.holds(&path)) {
        Ok(path)
    } else {
        Err(Refusal::Outside)
    }
}

/// Records an image the page measured (`image_size`) for a document, under a folder it opened (the image root), even
/// below a dot or denied folder there: the document names it (`![logo](.github/logo.png)`) and its header says
/// it is an image, so the box the page reserved for it fills. A path outside every opened folder is not recorded.
pub fn open_measured_image(set: &RwLock<OpenedSet>, path: &str) {
    let raw = Path::new(path);
    let Ok(c) = canonical(raw) else {
        return;
    };
    if let Ok(mut set) = set.write() {
        if set.within_a_folder(&c) {
            set.add_file(raw, c);
        }
    }
}

/// The reader's home folder, canonical.
pub(crate) fn home() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).and_then(|h| dunce::canonicalize(h).ok())
}

/// A folder too wide to open as a whole: a drive's or a share's root, the home folder or a folder above it.
pub(crate) fn too_wide(folder: &Path, home: Option<&Path>) -> bool {
    folder.parent().is_none() || home.is_some_and(|h| h.starts_with(folder))
}

/// Records a folder the page opened; anything but an existing folder, or a folder `too_wide`, is refused.
pub fn open_folder(path: &str) -> Result<PathBuf, Refusal> {
    let raw = Path::new(path);
    let c = canonical(raw)?;
    if !c.is_dir() || too_wide(&c, home().as_deref()) {
        return Err(Refusal::Outside);
    }
    if let Ok(mut set) = opened().write() {
        set.add_folder(raw, c.clone());
    }
    Ok(c)
}

/// `raw` when it names an existing folder in `set` (a `[[command]]`'s working folder).
pub fn opened_folder(set: &RwLock<OpenedSet>, raw: &Path) -> Result<PathBuf, Refusal> {
    let c = resolve(set, raw)?;
    if c.is_dir() {
        Ok(c)
    } else {
        Err(Refusal::Outside)
    }
}

/// Whether `file`, opened from `canonical` (the path `resolve` judged), is open on that very file and the set still
/// serves it: a link swapped in between the judgement and the open would have led the open elsewhere.
pub fn handle_served(set: &RwLock<OpenedSet>, file: &File, canonical: &Path) -> bool {
    super::handle_judged(set, file, canonical, |s, on| s.holds(on))
}

/// The file at `raw`, open, when the set serves it and it is a regular file: what a reader that answers for a file the
/// page shows reads from, never the path again.
pub fn open_judged(set: &RwLock<OpenedSet>, raw: &str) -> Result<(File, PathBuf), ShellError> {
    let path = match resolve(set, Path::new(raw)) {
        Ok(p) => p,
        Err(Refusal::Outside) => {
            return Err(ShellError::permission(raw, "not a file Marxy has opened"))
        }
        Err(Refusal::NotFound) => return Err(ShellError::not_found(raw, "no such file")),
        Err(Refusal::Io(e)) => return Err(ShellError::io(raw, e)),
    };
    let file = super::open_unblocked(&path).map_err(|e| ShellError::io(raw, e.to_string()))?;
    if !handle_served(set, &file, &path) {
        return Err(ShellError::permission(raw, "not a file Marxy has opened"));
    }
    if !file.metadata().is_ok_and(|m| m.is_file()) {
        return Err(ShellError::invalid(raw, "not a file"));
    }
    Ok((file, path))
}
