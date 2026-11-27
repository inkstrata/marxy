//! The opened set: the files and places the reader opened or chose this session, as they were spelled and canonical,
//! and the helpers every judgement compares paths by. What the set holds for which need is judged in src/scope.rs (the
//! path commands) and src/scope/served.rs (what a document may load).

use std::collections::HashSet;
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::{OnceLock, RwLock};

/// A path as written, made comparable: absolute, no `..`, no `.`, and on Windows one separator and one case. None for
/// what the set never holds: a relative path, a NUL, a `..`, a device path (`\\.\`) or a verbatim one (`\\?\`).
pub(crate) fn spelling(raw: &Path) -> Option<PathBuf> {
    let text = raw.as_os_str().to_str()?;
    if !raw.is_absolute() || text.contains('\0') {
        return None;
    }
    #[cfg(windows)]
    let text = text.replace('/', "\\");
    // One case on Windows, applied per part: the prefix is read first, and `\\?\UNC` is only a prefix in capitals.
    let fold = |s: &str| -> String {
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s.to_owned()
        }
    };
    let mut out = PathBuf::new();
    for c in Path::new(&text).components() {
        match c {
            Component::Prefix(p) => match p.kind() {
                Prefix::Disk(_) | Prefix::UNC(..) => {
                    out.push(fold(&c.as_os_str().to_string_lossy()))
                }
                // A long path (`\\?\C:\...`, `\\?\UNC\server\share\...`) names the same place as its plain form, which is how
                // the set spells it; the canonical path is judged again after the disk is asked.
                Prefix::VerbatimDisk(letter) => out.push(fold(&format!("{}:", char::from(letter)))),
                Prefix::VerbatimUNC(server, share) => {
                    let (Some(server), Some(share)) = (server.to_str(), share.to_str()) else {
                        return None;
                    };
                    out.push(fold(&format!(r"\\{server}\{share}")));
                }
                _ => return None,
            },
            Component::RootDir => out.push(c.as_os_str()),
            Component::Normal(name) => out.push(fold(&name.to_string_lossy())),
            Component::CurDir => {}
            Component::ParentDir => return None,
        }
    }
    Some(out)
}

/// `path` without Windows' verbatim prefix (`\\?\C:\...` as `C:\...`, `\\?\UNC\s\share\...` as `\\s\share\...`), to
/// compare by: `dunce` keeps the prefix on a path too long for the plain form, so a file deep under a folder opened by
/// its short plain path was never under it. Only for comparing; a path the disk is asked about keeps its prefix.
pub(crate) fn plain(path: &Path) -> PathBuf {
    #[cfg(windows)]
    if let Some(text) = path.to_str() {
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            let b = rest.as_bytes();
            if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
                return PathBuf::from(rest);
            }
        }
    }
    path.to_path_buf()
}

#[derive(Debug)]
pub(crate) struct Folder {
    pub(crate) canonical: PathBuf,
    pub(crate) spellings: Vec<PathBuf>,
}

pub(crate) fn push_folder(list: &mut Vec<Folder>, raw: &Path, canonical: PathBuf) {
    let spellings: Vec<PathBuf> = [spelling(raw), spelling(&canonical)]
        .into_iter()
        .flatten()
        .collect();
    match list.iter_mut().find(|f| f.canonical == canonical) {
        Some(f) => f.spellings.extend(spellings),
        None => list.push(Folder {
            canonical,
            spellings,
        }),
    }
}

/// The files and folders the page opened this session: canonical, and as they were spelled. `marxy-file://` serves
/// `files` and what is under `folders`; the path commands also answer for `roots` and `app` (src/scope.rs).
#[derive(Debug, Default)]
pub struct OpenedSet {
    pub(crate) files: HashSet<PathBuf>,
    pub(crate) file_spellings: HashSet<PathBuf>,
    pub(crate) folders: Vec<Folder>,
    /// Folders the reader chose for the index (a document's repository, a collection's folder): read by the path
    /// commands, never served to a document.
    pub(crate) roots: Vec<Folder>,
    /// Roots something besides the index chose (a crumb, a folder page, a theme folder): the index letting go of one
    /// does not end the reader's use of it.
    pub(crate) roots_kept: HashSet<PathBuf>,
    /// Folders the reader picked in the picker (Add a folder): read and written by the path commands, never served.
    pub(crate) picked: Vec<Folder>,
    /// Marxy's own data and config folders.
    pub(crate) app: Vec<Folder>,
    /// The keys above, spelled and canonical, kept in step by the `add_*` methods (src/scope.rs).
    pub(crate) spelled: super::KeyIndex,
    pub(crate) canonical: super::KeyIndex,
}

impl OpenedSet {
    pub fn add_file(&mut self, raw: &Path, canonical: PathBuf) {
        for spelled in [spelling(raw), spelling(&canonical)].into_iter().flatten() {
            self.add_file_spelling(spelled);
        }
        let plain = plain(&canonical);
        self.add_file_canonical(&plain);
        self.files.insert(plain);
    }

    pub fn add_folder(&mut self, raw: &Path, canonical: PathBuf) {
        push_folder(&mut self.folders, raw, canonical);
        self.reindex_places();
    }
}

pub fn opened() -> &'static RwLock<OpenedSet> {
    static SET: OnceLock<RwLock<OpenedSet>> = OnceLock::new();
    SET.get_or_init(Default::default)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Not absolute, a `..` in it, a NUL, outside the opened set, or a folder too wide to open.
    Outside,
    NotFound,
    Io(String),
}

/// The canonical form of an absolute path, refusing `..` before the file system is asked: the page names files by
/// their normalised absolute path, so a `..` is never the reader's.
pub fn canonical(raw: &Path) -> Result<PathBuf, Refusal> {
    if !raw.is_absolute()
        || raw.as_os_str().to_string_lossy().contains('\0')
        || raw.components().any(|c| c == Component::ParentDir)
    {
        return Err(Refusal::Outside);
    }
    dunce::canonicalize(raw).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => Refusal::NotFound,
        _ => Refusal::Io(e.to_string()),
    })
}

pub(crate) fn held(set: &RwLock<OpenedSet>, judge: impl FnOnce(&OpenedSet) -> bool) -> bool {
    set.read().map(|s| judge(&s)).unwrap_or(false)
}
