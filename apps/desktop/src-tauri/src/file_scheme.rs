//! `marxy-file://`, the page's way to load a local file it shows (an image beside a document, a theme's font, a video),
//! served from disk off the main thread with HTTP Range, so a long video seeks without the whole file being read.
//! It serves only what the reader opened: a file recorded by `mark_opened` or delivered by Rust (the launch, a second
//! launch, a drop, the pickers; src/scope.rs), never one only read or indexed, or what
//! sits under a folder it scoped through `allow_asset_scope` (the document's folder, an image root, a theme's folder),
//! but never a dot file or folder, nor one of the index's denied folders (`.git`, `node_modules`...), below that folder,
//! unless the page measured the file there as an image a document names (`open_measured_image`).
//! The set is fed by the page, so it bounds what a document can reach, not what a compromised page can: that page can
//! already read files. A request is judged by its spelling first, so a path the set cannot hold (a share, a device) is
//! refused before the disk is asked; then canonicalised (dunce), so a `..` or a link that leads out is refused; then
//! judged again by the handle actually opened.
//!
//! On Windows WebView2 reaches a custom scheme as `http://marxy-file.localhost/<path>`, elsewhere as
//! `marxy-file://localhost/<path>`; the path is `encodeURIComponent` of the file's absolute path (`convertFileSrc`).

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::http::{header, Method, Request, Response, StatusCode};

pub const SCHEME: &str = "marxy-file";
/// The most bytes one ranged response carries; a media element asks again from where the last one stopped.
pub const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;
/// The largest file served whole to a request without a Range (an image, a font); past it only ranges are served.
pub const MAX_WHOLE_BYTES: u64 = 64 * 1024 * 1024;
/// How many whole-file answers may be held in memory at once; the rest wait their turn.
const WHOLE_READS_AT_ONCE: usize = 4;
/// The decoded-image cache's ceiling on disk; the least recently used images go first past it.
pub const DECODED_CACHE_BYTES: u64 = 512 * 1024 * 1024;

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

/// Whether `rest`, the part of a path below an opened folder, is a dot name, or passes through a dot name or a denied
/// folder. The last part is the file asked for, so a file named `build` or `out` is no denied folder.
fn hidden_below(rest: &Path) -> bool {
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

/// Opens `path` to read without waiting on it: a FIFO swapped in for a file would hold the open until a writer came
/// (Unix). Every caller then checks the handle is a regular file.
pub fn open_unblocked(path: &Path) -> io::Result<File> {
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    options.open(path)
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
    pub(crate) spelled: crate::scope::KeyIndex,
    pub(crate) canonical: crate::scope::KeyIndex,
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

fn held(set: &RwLock<OpenedSet>, judge: impl FnOnce(&OpenedSet) -> bool) -> bool {
    set.read().map(|s| judge(&s)).unwrap_or(false)
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

/// Whether the file behind `file`, opened from `path`, is still one `set` holds: a link swapped in between the
/// canonicalisation and the open would have led the open elsewhere.
pub fn handle_held(set: &RwLock<OpenedSet>, file: &File, path: &Path) -> bool {
    #[cfg(windows)]
    {
        let _ = path;
        final_path(file).is_some_and(|p| held(set, |s| s.holds(&p)))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (Ok(opened), Ok(again)) = (file.metadata(), dunce::canonicalize(path)) else {
            return false;
        };
        let same =
            fs::metadata(&again).is_ok_and(|m| m.dev() == opened.dev() && m.ino() == opened.ino());
        same && held(set, |s| s.holds(&again))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        held(set, |s| s.holds(path))
    }
}

/// The path of the file a handle is open on, as the canonicalisation spells it.
#[cfg(windows)]
pub(crate) fn final_path(file: &File) -> Option<PathBuf> {
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(
            file: *mut c_void,
            path: *mut u16,
            len: u32,
            flags: u32,
        ) -> u32;
    }
    let mut buf = vec![0u16; 512];
    loop {
        // SAFETY: the handle is open for as long as `file` is, and `buf` holds `buf.len()` u16s.
        let n = unsafe {
            GetFinalPathNameByHandleW(file.as_raw_handle(), buf.as_mut_ptr(), buf.len() as u32, 0)
        } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            let path = PathBuf::from(OsString::from_wide(&buf[..n]));
            return Some(dunce::simplified(&path).to_path_buf());
        }
        buf.resize(n + 1, 0);
    }
}

/// A turn at holding a whole file in memory, `WHOLE_READS_AT_ONCE` at most.
struct WholeRead;

fn whole_reads() -> &'static (Mutex<usize>, Condvar) {
    static TURNS: OnceLock<(Mutex<usize>, Condvar)> = OnceLock::new();
    TURNS.get_or_init(|| (Mutex::new(0), Condvar::new()))
}

impl WholeRead {
    fn take() -> WholeRead {
        let (count, freed) = whole_reads();
        let mut n = count.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= WHOLE_READS_AT_ONCE {
            n = freed.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        WholeRead
    }
}

impl Drop for WholeRead {
    fn drop(&mut self) {
        let (count, freed) = whole_reads();
        *count.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        freed.notify_one();
    }
}

/// A decoder for an image format the webview cannot show (`src/decode`). It enforces its own limits on what it reads.
pub trait Decoder: Send + Sync {
    /// Whether this decoder reads the file, by its lower-case extension and its first bytes.
    fn reads(&self, extension: &str, head: &[u8]) -> bool;
    /// The image as PNG bytes, upright (its orientation applied), read from `file`, the handle the request opened and
    /// judged: never the path again, which may name another file by now. Read from its start.
    fn decode(&self, file: File) -> Result<Vec<u8>, String>;
    /// The type of what `decode` answers: PNG, but for an SVGZ the SVG it unpacks to.
    fn media_type(&self) -> &'static str {
        "image/png"
    }
}

/// The decoders a `?decoded` request may use, in order.
pub static DECODERS: &[&dyn Decoder] = crate::decode::DECODERS;

/// Decoded images on disk, keyed by the source's path, modification time and size, so an edit to the file misses.
pub struct DecodedCache {
    dir: PathBuf,
    cap: u64,
}

impl DecodedCache {
    pub fn new(dir: PathBuf, cap: u64) -> Self {
        Self { dir, cap }
    }

    /// The entry's name without its extension, which says what the decoder answers (`.png`, `.svg`).
    pub fn key(path: &Path, modified: SystemTime, size: u64) -> String {
        let mut h = DefaultHasher::new();
        path.hash(&mut h);
        modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
            .hash(&mut h);
        size.hash(&mut h);
        format!("{:016x}", h.finish())
    }

    /// The cached decode of `path`, decoding `file` (open on it) and storing it on a miss.
    pub fn get_or_decode(
        &self,
        path: &Path,
        meta: &fs::Metadata,
        file: &File,
        decoder: &dyn Decoder,
    ) -> Result<Vec<u8>, String> {
        let ext = match decoder.media_type() {
            "image/svg+xml" => "svg",
            _ => "png",
        };
        let key = format!(
            "{}.{ext}",
            Self::key(path, meta.modified().unwrap_or(UNIX_EPOCH), meta.len())
        );
        let entry = self.dir.join(&key);
        if let Ok(bytes) = fs::read(&entry) {
            // Touched so the trim keeps what is in use.
            if let Ok(f) = File::options().write(true).open(&entry) {
                let _ = f.set_modified(SystemTime::now());
            }
            return Ok(bytes);
        }
        let handle = file.try_clone().map_err(|e| e.to_string())?;
        // A decoder reads a stranger's bytes: its panic is this file's refusal, not the request's end.
        let bytes =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| decoder.decode(handle)))
                .unwrap_or_else(|_| Err("the decoder failed on this file".to_string()))?;
        // A cache that cannot be written still serves the decode it just made.
        if self.store(&key, &entry, &bytes).is_ok() {
            self.trim();
        }
        Ok(bytes)
    }

    fn store(&self, key: &str, entry: &Path, bytes: &[u8]) -> std::io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        // One name per write: two requests for one image may decode it at once.
        static WRITES: AtomicU64 = AtomicU64::new(0);
        let partial = self.dir.join(format!(
            "{key}.{}-{}.partial",
            std::process::id(),
            WRITES.fetch_add(1, Ordering::Relaxed)
        ));
        let done = fs::write(&partial, bytes).and_then(|_| fs::rename(&partial, entry));
        if done.is_err() {
            let _ = fs::remove_file(&partial);
        }
        done
    }

    /// Removes the least recently used entries until the cache is within its cap.
    pub fn trim(&self) {
        let Ok(listing) = fs::read_dir(&self.dir) else {
            return;
        };
        let listing: Vec<_> = listing.flatten().collect();
        // A partial left by a crash; a live write is younger than the hour.
        for e in &listing {
            let stale = e.file_name().to_string_lossy().ends_with(".partial")
                && e.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age > std::time::Duration::from_secs(3600));
            if stale {
                let _ = fs::remove_file(e.path());
            }
        }
        let mut entries: Vec<(SystemTime, u64, PathBuf)> = listing
            .into_iter()
            .filter(|e| !e.file_name().to_string_lossy().ends_with(".partial"))
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                meta.is_file()
                    .then(|| (meta.modified().unwrap_or(UNIX_EPOCH), meta.len(), e.path()))
            })
            .collect();
        let mut total: u64 = entries.iter().map(|e| e.1).sum();
        entries.sort_by_key(|e| e.0);
        for (_, len, path) in entries {
            if total <= self.cap {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total -= len;
            }
        }
    }
}

/// The content type by extension, else by the first bytes; what is neither is served as bytes.
pub fn content_type(path: &Path, head: &[u8]) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let by_ext = match ext.as_str() {
        "png" | "apng" => Some("image/png"),
        "jpg" | "jpeg" | "jfif" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" | "cur" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        "tif" | "tiff" => Some("image/tiff"),
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "ogv" => Some("video/ogg"),
        "mov" => Some("video/quicktime"),
        "mkv" => Some("video/x-matroska"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "ogg" | "oga" | "opus" => Some("audio/ogg"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "pdf" => Some("application/pdf"),
        _ => None,
    };
    by_ext.unwrap_or_else(|| sniff(head))
}

fn sniff(head: &[u8]) -> &'static str {
    let starts = |magic: &[u8]| head.starts_with(magic);
    let at = |offset: usize, magic: &[u8]| head.get(offset..offset + magic.len()) == Some(magic);
    if starts(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if starts(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        "image/gif"
    } else if starts(b"RIFF") && at(8, b"WEBP") {
        "image/webp"
    } else if starts(b"RIFF") && at(8, b"WAVE") {
        "audio/wav"
    } else if at(4, b"ftypavif") {
        "image/avif"
    } else if at(4, b"ftypqt") {
        "video/quicktime"
    } else if at(4, b"ftyp") {
        "video/mp4"
    } else if starts(b"\x1a\x45\xdf\xa3") {
        "video/webm"
    } else if starts(b"OggS") {
        "audio/ogg"
    } else if starts(b"fLaC") {
        "audio/flac"
    } else if starts(b"ID3") {
        "audio/mpeg"
    } else if starts(b"BM") {
        "image/bmp"
    } else if starts(b"wOF2") {
        "font/woff2"
    } else if starts(b"wOFF") {
        "font/woff"
    } else if starts(b"%PDF-") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

/// One `bytes=` range against a file of `size` bytes, inclusive, before the response cap. `Ok(None)` when the header
/// is not a valid byte range, which RFC 9110 says to ignore (served whole instead); `Err` when it is valid and none of
/// its ranges can be satisfied. The unit is matched in any case, as RFC 9110 has it.
pub fn parse_range(value: &str, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let value = value.trim();
    let Some(spec) = value
        .get(..6)
        .filter(|unit| unit.eq_ignore_ascii_case("bytes="))
        .map(|_| &value[6..])
    else {
        return Ok(None);
    };
    // A multi-range request is answered with its first satisfiable range, which a client must accept.
    let mut first = None;
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match one_range(part, size) {
            None => return Ok(None),
            Some(Ok(range)) => {
                first.get_or_insert(range);
            }
            Some(Err(())) => {}
        }
    }
    first.map(Some).ok_or(())
}

/// One range spec: `None` when it is not one, `Err` when it cannot be satisfied.
fn one_range(spec: &str, size: u64) -> Option<Result<(u64, u64), ()>> {
    let (start, end) = spec.split_once('-')?;
    let (start, end) = (start.trim(), end.trim());
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 || size == 0 {
            return Some(Err(()));
        }
        return Some(Ok((size.saturating_sub(suffix), size - 1)));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        u64::MAX
    } else {
        match end.parse::<u64>() {
            Ok(end) if end >= start => end,
            _ => return None,
        }
    };
    if start >= size {
        return Some(Err(()));
    }
    Some(Ok((start, end.min(size - 1))))
}

/// The app's own origins, the only ones a cross-origin read (a font, a fetch) is allowed to.
fn allowed_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost"
    ) || (cfg!(debug_assertions) && origin == "http://localhost:1420")
}

fn etag(meta: &fs::Metadata) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("\"{:x}-{:x}\"", meta.len(), modified)
}

fn read_at(file: &mut File, start: u64, len: u64) -> io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(start))?;
    let mut out = Vec::with_capacity(len as usize);
    file.take(len).read_to_end(&mut out)?;
    Ok(out)
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}

/// The answer to one request, read under `set` (and `cache` for a `?decoded` request).
pub fn respond(
    request: &Request<Vec<u8>>,
    set: &RwLock<OpenedSet>,
    cache: Option<&DecodedCache>,
) -> Response<Vec<u8>> {
    let mut response = answer(request, set, cache);
    let headers = response.headers_mut();
    if let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|o| o.to_str().ok())
        .filter(|o| allowed_origin(o))
    {
        if let Ok(value) = origin.parse() {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            headers.insert(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                header::HeaderValue::from_static("Content-Range, Accept-Ranges, Content-Length"),
            );
        }
    }
    headers.insert(header::VARY, header::HeaderValue::from_static("Origin"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    // A file opened on its own (an SVG, an HTML page) never runs as a document.
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    response
}

fn answer(
    request: &Request<Vec<u8>>,
    set: &RwLock<OpenedSet>,
    cache: Option<&DecodedCache>,
) -> Response<Vec<u8>> {
    let method = request.method();
    if method == Method::OPTIONS {
        let mut r = status(StatusCode::NO_CONTENT);
        r.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            header::HeaderValue::from_static("Range"),
        );
        return r;
    }
    if method != Method::GET && method != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let encoded = request.uri().path();
    let Ok(raw) = crate::percent_decode(encoded.strip_prefix('/').unwrap_or(encoded)) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let path = match resolve(set, Path::new(&raw)) {
        Ok(path) => path,
        Err(Refusal::NotFound) => return status(StatusCode::NOT_FOUND),
        Err(Refusal::Outside) => return status(StatusCode::FORBIDDEN),
        Err(Refusal::Io(_)) => return status(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let mut file = match open_unblocked(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return status(StatusCode::NOT_FOUND),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            return status(StatusCode::FORBIDDEN)
        }
        Err(_) => return status(StatusCode::INTERNAL_SERVER_ERROR),
    };
    if !handle_held(set, &file, &path) {
        return status(StatusCode::FORBIDDEN);
    }
    let meta = match file.metadata() {
        Ok(m) if m.is_file() => m,
        _ => return status(StatusCode::FORBIDDEN),
    };
    let size = meta.len();
    let mut head = [0u8; 16];
    let head_len = read_at(&mut file, 0, head.len() as u64)
        .map(|b| {
            head[..b.len()].copy_from_slice(&b);
            b.len()
        })
        .unwrap_or(0);
    let head = &head[..head_len];

    if request
        .uri()
        .query()
        .is_some_and(|q| q.split('&').any(|p| p == "decoded"))
    {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        let Some(decoder) = DECODERS.iter().find(|d| d.reads(&ext, head)) else {
            return status(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        };
        let Some(cache) = cache else {
            return status(StatusCode::INTERNAL_SERVER_ERROR);
        };
        return match cache.get_or_decode(&path, &meta, &file, *decoder) {
            Ok(png) => {
                let mut r = Response::new(png);
                r.headers_mut().insert(
                    header::CONTENT_TYPE,
                    header::HeaderValue::from_static(decoder.media_type()),
                );
                r
            }
            Err(_) => status(StatusCode::UNPROCESSABLE_ENTITY),
        };
    }

    let tag = etag(&meta);
    let mut response = status(StatusCode::OK);
    {
        let headers = response.headers_mut();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static(content_type(&path, head)),
        );
        headers.insert(
            header::ACCEPT_RANGES,
            header::HeaderValue::from_static("bytes"),
        );
        // The file can change on disk while it is shown: the webview asks again each time, cheaply when unchanged.
        headers.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-cache"),
        );
        if let Ok(value) = tag.parse() {
            headers.insert(header::ETAG, value);
        }
    }
    let header_str = |name: header::HeaderName| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    if header_str(header::IF_NONE_MATCH).is_some_and(|v| v.split(',').any(|t| t.trim() == tag)) {
        *response.status_mut() = StatusCode::NOT_MODIFIED;
        return response;
    }
    let if_range_holds = header_str(header::IF_RANGE).is_none_or(|v| v.trim() == tag);
    let range = match header_str(header::RANGE).filter(|_| if_range_holds) {
        Some(value) => match parse_range(&value, size) {
            Ok(range) => range,
            Err(()) => {
                *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
                if let Ok(value) = format!("bytes */{size}").parse() {
                    response.headers_mut().insert(header::CONTENT_RANGE, value);
                }
                return response;
            }
        },
        None => None,
    };
    let (start, len) = match range {
        Some((start, end)) => {
            let end = end.min(start + MAX_RANGE_BYTES - 1);
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            if let Ok(value) = format!("bytes {start}-{end}/{size}").parse() {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            (start, end - start + 1)
        }
        None if size > MAX_WHOLE_BYTES => {
            *response.status_mut() = StatusCode::PAYLOAD_TOO_LARGE;
            return response;
        }
        None => (0, size),
    };
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, header::HeaderValue::from(len));
    if method == Method::HEAD {
        return response;
    }
    let _turn = range.is_none().then(WholeRead::take);
    match read_at(&mut file, start, len) {
        Ok(bytes) => with_body(response, range.map(|_| start), size, bytes),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// `response` carrying `bytes`, its length headers said from what was read: a file that shrank after its size was
/// taken sends less than asked, and a Content-Length past the body would leave the webview waiting for the rest.
/// `range_start` is where a ranged answer's bytes begin.
fn with_body(
    mut response: Response<Vec<u8>>,
    range_start: Option<u64>,
    size: u64,
    bytes: Vec<u8>,
) -> Response<Vec<u8>> {
    let sent = bytes.len() as u64;
    if let Some(start) = range_start {
        let value = if sent == 0 {
            *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            format!("bytes */{size}")
        } else {
            format!("bytes {start}-{}/{size}", start + sent - 1)
        };
        if let Ok(value) = value.parse() {
            response.headers_mut().insert(header::CONTENT_RANGE, value);
        }
    }
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, header::HeaderValue::from(sent));
    *response.body_mut() = bytes;
    response
}

/// The scheme's handler: each request is answered on the blocking pool, never on the main thread.
pub fn handle<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let cache_dir = crate::data_dir::decoded_cache_dir(ctx.app_handle()).ok();
    tauri::async_runtime::spawn_blocking(move || {
        let cache = cache_dir.map(|dir| DecodedCache::new(dir, DECODED_CACHE_BYTES));
        responder.respond(guarded(|| respond(&request, opened(), cache.as_ref())));
    });
}

/// `answer`'s response, or a 500 if it panicked: a dropped responder leaves the webview's request open forever.
fn guarded(answer: impl FnOnce() -> Response<Vec<u8>>) -> Response<Vec<u8>> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(answer))
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// A folder of the test's own, removed when the test ends however it ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir =
                std::env::temp_dir().join(format!("marxy-file-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(dunce::canonicalize(dir).unwrap())
        }
    }

    impl std::ops::Deref for Scratch {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn url_of(path: &Path) -> String {
        let mut out = String::from("http://marxy-file.localhost/");
        for b in path.to_string_lossy().bytes() {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
        out
    }

    fn get(url: &str, headers: &[(&str, &str)]) -> Request<Vec<u8>> {
        let mut builder = Request::builder().method("GET").uri(url);
        for (k, v) in headers {
            builder = builder.header(*k, *v);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn set_with_folder(dir: &Path) -> RwLock<OpenedSet> {
        let mut set = OpenedSet::default();
        set.add_folder(dir, dir.to_path_buf());
        RwLock::new(set)
    }

    fn status_of(path: &Path, set: &RwLock<OpenedSet>) -> StatusCode {
        respond(&get(&url_of(path), &[]), set, None).status()
    }

    #[test]
    fn a_file_in_an_opened_folder_is_served_whole_with_its_type() {
        let dir = Scratch::new("whole");
        fs::write(dir.join("a.png"), b"\x89PNG\r\n\x1a\nrest").unwrap();
        let set = set_with_folder(&dir);
        let r = respond(&get(&url_of(&dir.join("a.png")), &[]), &set, None);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(r.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(r.body(), b"\x89PNG\r\n\x1a\nrest");
    }

    #[test]
    fn a_range_is_answered_with_206_and_its_content_range() {
        let dir = Scratch::new("range");
        let bytes: Vec<u8> = (0..=255u8).cycle().take(10_000).collect();
        fs::write(dir.join("clip.mp4"), &bytes).unwrap();
        let set = set_with_folder(&dir);
        let url = url_of(&dir.join("clip.mp4"));
        let r = respond(&get(&url, &[("Range", "bytes=100-199")]), &set, None);
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes 100-199/10000");
        assert_eq!(r.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(r.body(), &bytes[100..200]);
        let tail = respond(&get(&url, &[("Range", "bytes=-10")]), &set, None);
        assert_eq!(
            tail.headers()[header::CONTENT_RANGE],
            "bytes 9990-9999/10000"
        );
        let open = respond(&get(&url, &[("Range", "bytes=9000-")]), &set, None);
        assert_eq!(open.body().len(), 1000);
        let past = respond(&get(&url, &[("Range", "bytes=10000-")]), &set, None);
        assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(past.headers()[header::CONTENT_RANGE], "bytes */10000");
        // A Range that is not one is ignored (RFC 9110): the file is served whole.
        let malformed = respond(&get(&url, &[("Range", "bytes=x-")]), &set, None);
        assert_eq!(malformed.status(), StatusCode::OK);
        assert_eq!(malformed.body().len(), 10_000);
    }

    #[test]
    fn an_open_ended_range_of_a_large_sparse_file_reads_only_the_cap() {
        let dir = Scratch::new("sparse");
        let path = dir.join("big.mp4");
        drop(File::create(&path).unwrap());
        // Sparse before it grows, or NTFS gives it three real gigabytes of disk.
        #[cfg(windows)]
        assert!(std::process::Command::new("fsutil")
            .args(["sparse", "setflag"])
            .arg(&path)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(3 * 1024 * 1024 * 1024)
            .unwrap();
        let set = set_with_folder(&dir);
        let url = url_of(&path);
        let r = respond(&get(&url, &[("Range", "bytes=2500000000-")]), &set, None);
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body().len() as u64, MAX_RANGE_BYTES);
        let whole = respond(&get(&url, &[]), &set, None);
        assert_eq!(whole.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(whole.body().is_empty());
    }

    #[test]
    fn a_path_outside_the_opened_set_is_refused() {
        let dir = Scratch::new("outside");
        let inside = dir.join("inside");
        fs::create_dir_all(&inside).unwrap();
        fs::write(dir.join("secret.txt"), b"no").unwrap();
        fs::write(inside.join("ok.txt"), b"yes").unwrap();
        let set = set_with_folder(&inside);
        let refused = respond(&get(&url_of(&dir.join("secret.txt")), &[]), &set, None);
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        assert!(refused.body().is_empty());
        // A `..` that climbs out, and one that stays in, are both refused before the disk is asked.
        let climb = format!("{}/../secret.txt", inside.display());
        assert_eq!(status_of(Path::new(&climb), &set), StatusCode::FORBIDDEN);
        let stay = format!("{}/../inside/ok.txt", inside.display());
        assert_eq!(status_of(Path::new(&stay), &set), StatusCode::FORBIDDEN);
        assert_eq!(
            respond(&get("http://marxy-file.localhost/ok.txt", &[]), &set, None).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(status_of(&inside.join("ok.txt"), &set), StatusCode::OK);
        // A file opened on its own is served; its neighbour is not.
        let mut one = OpenedSet::default();
        let secret = dir.join("secret.txt");
        one.add_file(&secret, secret.clone());
        let one = RwLock::new(one);
        assert_eq!(status_of(&secret, &one), StatusCode::OK);
        assert_eq!(
            status_of(&inside.join("ok.txt"), &one),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn dot_files_and_denied_folders_below_an_opened_folder_are_refused_unless_opened_themselves() {
        let dir = Scratch::new("hidden");
        for sub in [".git", "node_modules/pkg", "docs"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
        }
        fs::write(dir.join(".env"), b"KEY=1").unwrap();
        fs::write(dir.join(".git/config"), b"[core]").unwrap();
        fs::write(dir.join("node_modules/pkg/a.png"), b"x").unwrap();
        fs::write(dir.join("docs/a.png"), b"x").unwrap();
        let set = set_with_folder(&dir);
        for hidden in [".env", ".git/config", "node_modules/pkg/a.png"] {
            assert_eq!(
                status_of(&dir.join(hidden), &set),
                StatusCode::FORBIDDEN,
                "{hidden}"
            );
        }
        assert_eq!(status_of(&dir.join("docs/a.png"), &set), StatusCode::OK);
        let env = dir.join(".env");
        set.write().unwrap().add_file(&env, env.clone());
        assert_eq!(status_of(&env, &set), StatusCode::OK, "opened on its own");
        // The rule is for what is below the opened folder: a dot folder that is itself opened serves its files.
        let git = set_with_folder(&dir.join(".git"));
        assert_eq!(status_of(&dir.join(".git/config"), &git), StatusCode::OK);
    }

    /// the deny list names folders; a file called `build` below an opened folder is served like any file.
    #[test]
    fn a_file_named_like_a_denied_folder_is_served() {
        let dir = Scratch::new("deny-file");
        fs::create_dir_all(dir.join("docs/build")).unwrap();
        fs::write(dir.join("docs/Out"), b"x").unwrap();
        fs::write(dir.join("docs/build/a.png"), b"x").unwrap();
        let set = set_with_folder(&dir);
        assert_eq!(status_of(&dir.join("docs/Out"), &set), StatusCode::OK);
        assert_eq!(
            status_of(&dir.join("docs/build/a.png"), &set),
            StatusCode::FORBIDDEN
        );
        for name in crate::commands::fs::DENY_DIRECTORY_NAMES {
            assert!(hidden_below(&Path::new(name).join("x.png")), "{name}");
            assert!(
                hidden_below(&Path::new(&name.to_ascii_uppercase()).join("x.png")),
                "{name}"
            );
            assert_eq!(
                hidden_below(Path::new(name)),
                name.starts_with('.'),
                "{name}"
            );
        }
    }

    /// a README's `![logo](.github/logo.png)` under the image root loads once the page has measured it.
    #[test]
    fn an_image_the_page_measured_below_a_dot_folder_is_served() {
        let dir = Scratch::new("measured");
        fs::create_dir_all(dir.join(".github/assets")).unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        let logo = dir.join(".github/assets/logo.png");
        let shot = dir.join("build/shot.png");
        fs::write(&logo, b"x").unwrap();
        fs::write(&shot, b"x").unwrap();
        let outside = Scratch::new("measured-outside");
        let away = outside.join("a.png");
        fs::write(&away, b"x").unwrap();
        let set = set_with_folder(&dir);
        assert_eq!(status_of(&logo, &set), StatusCode::FORBIDDEN);
        for path in [&logo, &shot, &away] {
            open_measured_image(&set, &path.to_string_lossy());
        }
        assert_eq!(status_of(&logo, &set), StatusCode::OK);
        assert_eq!(status_of(&shot, &set), StatusCode::OK);
        assert_eq!(
            status_of(&away, &set),
            StatusCode::FORBIDDEN,
            "outside every opened folder"
        );
        assert_eq!(
            status_of(&dir.join(".github/assets"), &set),
            StatusCode::FORBIDDEN,
            "the file, not its folder"
        );
    }

    #[test]
    fn a_share_or_device_path_the_set_does_not_spell_never_reaches_the_disk() {
        let dir = Scratch::new("share");
        let set = set_with_folder(&dir);
        // TEST-NET-1: a lookup would stall for seconds; a refusal by spelling is immediate.
        for raw in [
            r"\\192.0.2.1\share\x.png",
            r"//192.0.2.1/share/x.png",
            r"\\?\C:\Windows\win.ini",
            r"\\.\PhysicalDrive0",
        ] {
            let started = std::time::Instant::now();
            assert!(!set.read().unwrap().may_hold(Path::new(raw)), "{raw}");
            assert_eq!(
                resolve(&set, Path::new(raw)),
                Err(Refusal::Outside),
                "{raw}"
            );
            assert!(
                started.elapsed() < std::time::Duration::from_millis(500),
                "{raw}"
            );
        }
        // A folder the page spelled differently from its canonical form is still found by either spelling.
        let spelled = PathBuf::from(dir.to_string_lossy().replace('\\', "/"));
        let mut other = OpenedSet::default();
        other.add_folder(&spelled, dir.to_path_buf());
        assert!(other.may_hold(&dir.join("a.png")));
        assert!(other.may_hold(&spelled.join("a.png")));
        #[cfg(windows)]
        assert!(other.may_hold(&Path::new(&dir.to_string_lossy().to_uppercase()).join("a.png")));
    }

    /// A share is spelled `\\server\share\...` by Windows and `//server/share/...` by the page; both name one place, in any case.
    #[test]
    #[cfg(windows)]
    fn a_share_the_page_opened_is_held_by_either_spelling() {
        let mut set = OpenedSet::default();
        let folder = PathBuf::from(r"\\server\share\notes");
        set.add_folder(&folder, folder.clone());
        for raw in [
            r"\\server\share\notes\a.png",
            "//server/share/notes/a.png",
            r"\\SERVER\Share\notes\sub\a.png",
            r"\\?\UNC\server\share\notes\a.png",
        ] {
            assert!(set.may_hold(Path::new(raw)), "{raw}");
        }
        for raw in [
            "//server/share/other/a.png",
            "//server/other/notes/a.png",
            "//server/share/notes/../x.png",
            "//server/share",
        ] {
            assert!(!set.may_hold(Path::new(raw)), "{raw}");
        }
        // A file opened on its own through the page's spelling.
        let mut one = OpenedSet::default();
        one.add_file(
            Path::new("//server/share/notes/doc.md"),
            PathBuf::from(r"\\server\share\notes\doc.md"),
        );
        assert!(one.may_hold(Path::new(r"\\server\share\notes\doc.md")));
        assert!(one.may_hold(Path::new("//SERVER/share/notes/DOC.md")));
    }

    /// A path over 260 characters comes back from the system as `\\?\C:\...`; the page keeps it, and its image requests carry it.
    #[test]
    #[cfg(windows)]
    fn a_long_path_the_page_opened_is_held_by_its_plain_or_verbatim_spelling() {
        let mut set = OpenedSet::default();
        let folder = PathBuf::from(r"\\?\C:\deep\notes");
        set.add_folder(&folder, PathBuf::from(r"C:\deep\notes"));
        for raw in [
            r"\\?\C:\deep\notes\a.png",
            "//?/C:/deep/notes/a.png",
            r"C:\deep\notes\a.png",
            r"\\?\c:\DEEP\notes\a.png",
        ] {
            assert!(set.may_hold(Path::new(raw)), "{raw}");
        }
        for raw in [
            r"\\?\C:\deep\other\a.png",
            r"\\?\D:\deep\notes\a.png",
            r"\\.\PhysicalDrive0",
        ] {
            assert!(!set.may_hold(Path::new(raw)), "{raw}");
        }
    }

    /// A real share on this machine (the administrative `C$`), where the reader may look at it: an image under it is served.
    #[test]
    #[cfg(windows)]
    fn an_image_on_a_share_is_served_by_the_pages_spelling() {
        let dir = Scratch::new("unc");
        fs::write(dir.join("a.png"), b"\x89PNG\r\n\x1a\nrest").unwrap();
        let text = dir.to_string_lossy().into_owned();
        let (drive, tail) = text.split_at(2);
        let share = format!(r"\\localhost\{}${}", &drive[..1], tail);
        if fs::metadata(&share).is_err() {
            println!("unc: skipped: {share} is not reachable by this user");
            return;
        }
        let share_dir = PathBuf::from(&share);
        let mut set = OpenedSet::default();
        set.add_folder(&share_dir, dunce::canonicalize(&share_dir).unwrap());
        let set = RwLock::new(set);
        for spelled in [share.clone(), share.replace('\\', "/")] {
            let sep = if spelled.contains('/') { "/" } else { "\\" };
            let path = PathBuf::from(format!("{spelled}{sep}a.png"));
            assert_eq!(status_of(&path, &set), StatusCode::OK, "{}", path.display());
        }
    }

    #[test]
    fn a_folder_too_wide_to_open_is_refused() {
        let home = Path::new(if cfg!(windows) {
            r"C:\Users\reader"
        } else {
            "/home/reader"
        });
        let root = home.ancestors().last().unwrap();
        assert!(too_wide(root, Some(home)), "a drive's root");
        assert!(too_wide(home, Some(home)), "the home folder");
        assert!(too_wide(home.parent().unwrap(), Some(home)), "above home");
        assert!(!too_wide(&home.join("notes"), Some(home)));
        #[cfg(windows)]
        assert!(
            too_wide(Path::new(r"\\server\share\"), None),
            "a share's root"
        );
        let real_root = std::env::temp_dir()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        assert_eq!(
            open_folder(&real_root.to_string_lossy()),
            Err(Refusal::Outside)
        );
        if let Some(h) = super::home() {
            assert_eq!(open_folder(&h.to_string_lossy()), Err(Refusal::Outside));
        }
    }

    #[test]
    fn a_link_inside_an_opened_folder_that_leads_out_is_refused() {
        let dir = Scratch::new("link");
        let inside = dir.join("inside");
        let outside = dir.join("outside");
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), b"no").unwrap();
        // A junction needs no privilege on Windows, where a symbolic link does.
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(inside.join("door"))
            .arg(&outside)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, inside.join("door")).unwrap();
        assert!(
            inside.join("door/secret.txt").exists(),
            "the link leads out"
        );
        let set = set_with_folder(&inside);
        assert_eq!(
            status_of(&inside.join("door/secret.txt"), &set),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn only_the_apps_origin_may_read_across_origins_and_a_file_never_runs() {
        let dir = Scratch::new("origin");
        fs::write(dir.join("f.woff2"), b"wOF2....").unwrap();
        let set = set_with_folder(&dir);
        let url = url_of(&dir.join("f.woff2"));
        let ours = respond(
            &get(&url, &[("Origin", "http://tauri.localhost")]),
            &set,
            None,
        );
        assert_eq!(
            ours.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://tauri.localhost"
        );
        assert_eq!(ours.headers()[header::CONTENT_TYPE], "font/woff2");
        let theirs = respond(&get(&url, &[("Origin", "https://example.com")]), &set, None);
        assert!(theirs
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert!(theirs.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("sandbox"));
        assert_eq!(theirs.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    }

    #[test]
    fn an_unchanged_file_is_not_sent_again() {
        let dir = Scratch::new("etag");
        fs::write(dir.join("a.gif"), b"GIF89a").unwrap();
        let set = set_with_folder(&dir);
        let url = url_of(&dir.join("a.gif"));
        let first = respond(&get(&url, &[]), &set, None);
        let tag = first.headers()[header::ETAG].to_str().unwrap().to_owned();
        let again = respond(&get(&url, &[("If-None-Match", &tag)]), &set, None);
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED);
        assert!(again.body().is_empty());
    }

    #[test]
    fn the_type_comes_from_the_extension_else_the_magic() {
        assert_eq!(content_type(Path::new("a.JPG"), b""), "image/jpeg");
        assert_eq!(
            content_type(Path::new("noext"), b"\x1a\x45\xdf\xa3...."),
            "video/webm"
        );
        assert_eq!(
            content_type(Path::new("noext"), b"\0\0\0\x18ftypisom"),
            "video/mp4"
        );
        assert_eq!(
            content_type(Path::new("noext"), b"RIFF\0\0\0\0WEBPVP8 "),
            "image/webp"
        );
        assert_eq!(
            content_type(Path::new("x.bin"), b"plain"),
            "application/octet-stream"
        );
    }

    #[test]
    fn a_range_header_is_read_as_one_byte_range() {
        assert_eq!(parse_range("bytes=0-", 10), Ok(Some((0, 9))));
        assert_eq!(parse_range("bytes=2-4, 6-8", 10), Ok(Some((2, 4))));
        assert_eq!(parse_range("bytes=5-100", 10), Ok(Some((5, 9))));
        assert_eq!(parse_range("bytes=-3", 10), Ok(Some((7, 9))));
        assert_eq!(parse_range("bytes=-30", 10), Ok(Some((0, 9))));
        // Not a valid range: ignored.
        assert_eq!(parse_range("items=0-1", 10), Ok(None));
        assert_eq!(parse_range("bytes=4-2", 10), Ok(None));
        assert_eq!(parse_range("bytes=x-", 10), Ok(None));
        assert_eq!(parse_range("bytes=-x", 10), Ok(None));
        // Valid, and not satisfiable.
        assert_eq!(parse_range("bytes=10-", 10), Err(()));
        assert_eq!(parse_range("bytes=-0", 10), Err(()));
        assert_eq!(parse_range("bytes=0-", 0), Err(()));
    }

    /// RFC 9110: 416 only when no range in the set can be satisfied, and the unit is matched in any case.
    #[test]
    fn a_multi_range_is_satisfied_by_any_of_its_ranges_and_the_unit_has_no_case() {
        assert_eq!(parse_range("bytes=20-30, 2-4", 10), Ok(Some((2, 4))));
        assert_eq!(parse_range("bytes=20-30,-0, 7-", 10), Ok(Some((7, 9))));
        assert_eq!(parse_range("bytes=20-30, 40-", 10), Err(()));
        assert_eq!(parse_range("bytes=20-30, x-", 10), Ok(None));
        assert_eq!(parse_range("Bytes=2-4", 10), Ok(Some((2, 4))));
        assert_eq!(parse_range("BYTES=-3", 10), Ok(Some((7, 9))));
        assert_eq!(parse_range("bytés=2-4", 10), Ok(None));
    }

    /// The length headers say what was read: a file that shrank after its size was taken sends a shorter body, and
    /// the headers agree with it.
    #[test]
    fn the_length_headers_follow_the_bytes_read() {
        let ranged = with_body(
            status(StatusCode::PARTIAL_CONTENT),
            Some(100),
            10_000,
            vec![7; 40],
        );
        assert_eq!(ranged.headers()[header::CONTENT_LENGTH], "40");
        assert_eq!(
            ranged.headers()[header::CONTENT_RANGE],
            "bytes 100-139/10000"
        );
        assert_eq!(ranged.body().len(), 40);
        let gone = with_body(
            status(StatusCode::PARTIAL_CONTENT),
            Some(100),
            10_000,
            Vec::new(),
        );
        assert_eq!(gone.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(gone.headers()[header::CONTENT_RANGE], "bytes */10000");
        let mut whole = status(StatusCode::OK);
        whole
            .headers_mut()
            .insert(header::CONTENT_LENGTH, header::HeaderValue::from(500u64));
        let whole = with_body(whole, None, 500, vec![1; 120]);
        assert_eq!(whole.headers()[header::CONTENT_LENGTH], "120");
        assert!(whole.headers().get(header::CONTENT_RANGE).is_none());
    }

    /// A file deep under an opened folder, its path past 260 characters (which `dunce` keeps verbatim), is served and
    /// held by every caller that judges a path: the scheme, `image_facts`, `list_archive`, a run's working folder.
    #[test]
    #[cfg(windows)]
    fn a_path_past_260_characters_under_an_opened_folder_is_held() {
        let dir = Scratch::new("long-under");
        let mut deep = dir.to_path_buf();
        for i in 0..6 {
            deep.push(format!(
                "a-fairly-long-folder-name-number-{i:02}-xxxxxxxxxxxxxxxx"
            ));
        }
        fs::create_dir_all(&deep).unwrap();
        let png = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/images/icc.png");
        fs::copy(&png, deep.join("pic.png")).unwrap();
        let zip = crate::archive::testkit::zip(
            &[crate::archive::testkit::Z::stored("a.txt", b"abcd")],
            b"",
        );
        fs::write(deep.join("a.zip"), zip).unwrap();
        let file = deep.join("pic.png");
        assert!(file.as_os_str().len() > 260);
        let canonical = dunce::canonicalize(&file).unwrap();
        assert!(
            canonical.to_string_lossy().starts_with(r"\\?\"),
            "dunce kept {canonical:?} plain"
        );
        let set = set_with_folder(&dir);
        assert_eq!(status_of(&file, &set), StatusCode::OK);
        assert!(resolve(&set, &file).is_ok());
        assert!(opened_folder(&set, &deep).is_ok());
        let raw = file.to_string_lossy().into_owned();
        assert!(crate::commands::image::facts_in(&set, &raw)
            .unwrap()
            .is_some());
        let zip = deep.join("a.zip").to_string_lossy().into_owned();
        let listing =
            crate::commands::archive::list_in(&set, &zip, &crate::archive::Limits::DEFAULT)
                .unwrap()
                .expect("a zip");
        assert_eq!(listing.entries.len(), 1);
        // Opened as a file on its own, by its long path, it is held too.
        let mut alone = OpenedSet::default();
        alone.add_file(&file, canonical.clone());
        assert!(alone.holds(&canonical));
        assert!(alone.holds(&plain(&canonical)));
    }

    /// A FIFO in an opened folder is refused at once, not waited on until a writer comes.
    #[test]
    #[cfg(unix)]
    fn a_fifo_in_an_opened_folder_is_refused_without_waiting() {
        let dir = Scratch::new("fifo");
        let fifo = dir.join("pipe.png");
        let c = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let set = set_with_folder(&dir);
        let (tx, rx) = std::sync::mpsc::channel();
        let url = url_of(&fifo);
        let set = std::sync::Arc::new(set);
        let held = set.clone();
        std::thread::spawn(move || {
            let _ = tx.send(respond(&get(&url, &[]), &held, None).status());
        });
        let answered = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the request waited on the FIFO");
        assert_eq!(answered, StatusCode::FORBIDDEN);
        let raw = fifo.to_string_lossy().into_owned();
        assert!(crate::commands::image::facts_in(&set, &raw).is_err());
    }

    #[test]
    fn whole_file_reads_take_turns() {
        let turns: Vec<WholeRead> = (0..WHOLE_READS_AT_ONCE)
            .map(|_| WholeRead::take())
            .collect();
        let (tx, rx) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let _turn = WholeRead::take();
            tx.send(()).unwrap();
        });
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(200))
                .is_err(),
            "a fifth read waits"
        );
        drop(turns);
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .expect("a turn freed lets it in");
        waiter.join().unwrap();
    }

    struct Counting(AtomicUsize);

    impl Decoder for Counting {
        fn reads(&self, extension: &str, _head: &[u8]) -> bool {
            extension == "tga"
        }
        fn decode(&self, mut file: File) -> Result<Vec<u8>, String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            let mut bytes = Vec::new();
            file.seek(SeekFrom::Start(0))
                .and_then(|_| file.read_to_end(&mut bytes))
                .map_err(|e| e.to_string())?;
            Ok(bytes.repeat(100))
        }
    }

    struct Panicking;

    impl Decoder for Panicking {
        fn reads(&self, extension: &str, _head: &[u8]) -> bool {
            extension == "tga"
        }
        fn decode(&self, _file: File) -> Result<Vec<u8>, String> {
            crate::decode::with_turn(|| panic!("hostile bytes"))
        }
    }

    #[test]
    fn a_decoder_that_panics_refuses_that_file_and_the_next_still_decodes() {
        let dir = Scratch::new("decoder-panic");
        let src = dir.join("a.tga");
        fs::write(&src, b"0123456789").unwrap();
        let cache = DecodedCache::new(dir.join("decoded"), 2500);
        let meta = fs::metadata(&src).unwrap();
        let file = File::open(&src).unwrap();
        assert!(cache.get_or_decode(&src, &meta, &file, &Panicking).is_err());
        assert!(
            crate::decode::every_turn_comes_back(std::time::Duration::from_secs(10)),
            "the panicking decode kept its turn"
        );
        let ok = cache.get_or_decode(&src, &meta, &file, &Counting(AtomicUsize::new(0)));
        assert_eq!(ok.unwrap().len(), 1000);
        let r = guarded(|| panic!("anything"));
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn a_cache_that_cannot_be_written_still_returns_the_decode() {
        let dir = Scratch::new("cache-unwritable");
        let src = dir.join("a.tga");
        fs::write(&src, b"0123456789").unwrap();
        let blocked = dir.join("decoded");
        fs::write(&blocked, b"a file where the folder should be").unwrap();
        let cache = DecodedCache::new(blocked, 2500);
        let meta = fs::metadata(&src).unwrap();
        let got = cache.get_or_decode(
            &src,
            &meta,
            &File::open(&src).unwrap(),
            &Counting(AtomicUsize::new(0)),
        );
        assert_eq!(got.unwrap().len(), 1000);
    }

    #[test]
    fn a_decode_is_cached_by_path_mtime_and_size_and_trimmed_to_its_cap() {
        let dir = Scratch::new("cache");
        let src = dir.join("a.tga");
        fs::write(&src, b"0123456789").unwrap();
        let cache = DecodedCache::new(dir.join("decoded"), 2500);
        let decoder = Counting(AtomicUsize::new(0));
        let meta = fs::metadata(&src).unwrap();
        assert_eq!(
            cache
                .get_or_decode(&src, &meta, &File::open(&src).unwrap(), &decoder)
                .unwrap()
                .len(),
            1000
        );
        cache
            .get_or_decode(&src, &meta, &File::open(&src).unwrap(), &decoder)
            .unwrap();
        assert_eq!(
            decoder.0.load(Ordering::SeqCst),
            1,
            "the second read is the cache's"
        );
        fs::write(&src, b"01234567890").unwrap();
        let changed = fs::metadata(&src).unwrap();
        assert_eq!(
            cache
                .get_or_decode(&src, &changed, &File::open(&src).unwrap(), &decoder)
                .unwrap()
                .len(),
            1100
        );
        assert_eq!(decoder.0.load(Ordering::SeqCst), 2, "a changed file misses");
        // A write in progress elsewhere is not the trim's to remove.
        let partial = dir.join("decoded").join("ffff.png.1-1.partial");
        fs::write(&partial, vec![0u8; 5000]).unwrap();
        for name in ["b.tga", "c.tga"] {
            fs::write(dir.join(name), b"0123456789").unwrap();
            let m = fs::metadata(dir.join(name)).unwrap();
            let f = File::open(dir.join(name)).unwrap();
            cache
                .get_or_decode(&dir.join(name), &m, &f, &decoder)
                .unwrap();
        }
        assert!(partial.exists());
        let total: u64 = fs::read_dir(dir.join("decoded"))
            .unwrap()
            .flatten()
            .filter(|e| e.path() != partial)
            .map(|e| e.metadata().unwrap().len())
            .sum();
        assert!(total <= 2500, "the cache holds {total} bytes past its cap");
        assert_ne!(
            DecodedCache::key(&src, UNIX_EPOCH, 10),
            DecodedCache::key(&src, UNIX_EPOCH, 11)
        );
    }

    #[test]
    fn a_decoded_request_with_no_decoder_for_the_file_is_unsupported() {
        let dir = Scratch::new("nodecoder");
        fs::write(dir.join("a.xyz"), b"xyz").unwrap();
        let set = set_with_folder(&dir);
        let r = respond(
            &get(&format!("{}?decoded", url_of(&dir.join("a.xyz"))), &[]),
            &set,
            None,
        );
        assert_eq!(r.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn a_decoded_request_for_a_tiff_answers_a_png() {
        let dir = Scratch::new("decoded");
        let tiff = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/images/tiny.tiff");
        fs::copy(tiff, dir.join("scan.tiff")).unwrap();
        let set = set_with_folder(&dir);
        let cache = DecodedCache::new(dir.join("decoded"), DECODED_CACHE_BYTES);
        let url = format!("{}?decoded", url_of(&dir.join("scan.tiff")));
        let r = respond(&get(&url, &[]), &set, Some(&cache));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "image/png");
        assert!(r.body().starts_with(b"\x89PNG\r\n\x1a\n"));
        // A file the decoder cannot read is unprocessable, not a crash.
        fs::write(dir.join("broken.tiff"), b"II*\0garbage").unwrap();
        let broken = format!("{}?decoded", url_of(&dir.join("broken.tiff")));
        assert_eq!(
            respond(&get(&broken, &[]), &set, Some(&cache)).status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn a_working_folder_must_be_an_opened_folder() {
        let dir = Scratch::new("cwd");
        let inside = dir.join("inside");
        fs::create_dir_all(&inside).unwrap();
        let set = set_with_folder(&inside);
        assert_eq!(opened_folder(&set, &inside).unwrap(), inside);
        assert_eq!(opened_folder(&set, &dir), Err(Refusal::Outside));
        fs::write(inside.join("f.txt"), b"").unwrap();
        assert_eq!(
            opened_folder(&set, &inside.join("f.txt")),
            Err(Refusal::Outside)
        );
    }
}
