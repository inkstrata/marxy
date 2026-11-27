//! File commands: natural image size, the `marxy-file://` scope, and read_dir. Each command answers only for a path in
//! scope (src/scope.rs); the `*_blocking` bodies below it do not judge scope.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use imagesize::{reader_size, ImageError};
use serde::Serialize;

use crate::error::ShellError;
use crate::file_scheme::OpenedSet;
use crate::scope::{self, Need};
use std::sync::RwLock;

/// Same names as `index-model/deny.ts` (a test reads it); a gitignore `!` cannot undo these. The one list of the
/// shell: `read_dir`, `stat_file`, content search, the tree watch and `marxy-file://` all ask `denied_name`.
pub(crate) const DENY_DIRECTORY_NAMES: &[&str] = &[
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub is_dir: bool,
    /// When the file was made, where the platform keeps it (`stat_file` only; never for a listing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_ms: Option<u64>,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// In any case: on a case-insensitive volume `Build` is `build`. Ask it of a folder only: a file named `build` or `out`
/// is a file, listed, searched and served like any other.
pub(crate) fn denied_name(name: &str) -> bool {
    DENY_DIRECTORY_NAMES
        .iter()
        .any(|d| d.eq_ignore_ascii_case(name))
}

/// Every path the app reads is absolute. A relative one (an archive's entry held in memory, `archive-entry:4/notes`) would
/// be resolved against the process's working folder, so it is refused rather than read from wherever that is.
pub fn absolute(path: &str) -> Result<(), ShellError> {
    if Path::new(path).is_absolute() {
        Ok(())
    } else {
        Err(ShellError::invalid(
            path,
            format!("{path}: not a path on disk (every path the app reads is absolute)"),
        ))
    }
}

fn scope_directory(dir: &str) -> Result<PathBuf, ShellError> {
    absolute(dir)?;
    let p = Path::new(dir);
    if !p.is_dir() {
        return Err(ShellError::invalid(dir, "not a directory"));
    }
    Ok(p.to_path_buf())
}

#[derive(Debug, Serialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// `imagesize` uses `IoError` for short reads as well as real filesystem failures; only the latter
/// propagate to the webview.
fn image_size_io_is_format_miss(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::InvalidData
    )
}

fn map_image_size_error(
    path: &str,
    err: ImageError,
) -> Result<Option<ImageDimensions>, ShellError> {
    match err {
        ImageError::NotSupported | ImageError::CorruptedImage => Ok(None),
        ImageError::IoError(e) if image_size_io_is_format_miss(&e) => Ok(None),
        ImageError::IoError(e) => Err(ShellError::io(path, e.to_string())),
    }
}

/// The root element is near the start; a larger prolog or comment block is not worth reading past.
const SVG_HEAD_BYTES: u64 = 64 * 1024;

fn has_svg_extension(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("svg"))
}

fn svg_dimensions_of_file(path: &str, file: File) -> Result<Option<ImageDimensions>, ShellError> {
    let mut head = Vec::new();
    file.take(SVG_HEAD_BYTES)
        .read_to_end(&mut head)
        .map_err(|e| ShellError::io(path, e.to_string()))?;
    Ok(svg_dimensions(&head))
}

/// `<svg ...>` start tag's attributes as (name, value) pairs, skipping the prolog, doctype and comments.
fn svg_root_attributes(text: &str) -> Option<Vec<(String, String)>> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while let Some(off) = text[i..].find('<') {
        i += off;
        let rest = &text[i..];
        if rest.starts_with("<!--") {
            i += rest.find("-->")? + 3;
        } else if rest.starts_with("<svg")
            && bytes
                .get(i + 4)
                .is_some_and(|b| b.is_ascii_whitespace() || *b == b'>' || *b == b'/')
        {
            return Some(parse_attributes(&rest[4..]));
        } else {
            i += 1;
        }
    }
    None
}

/// Reads `name="value"` pairs up to the tag's closing `>`; a tag cut off by the read limit yields what came before.
fn parse_attributes(tag: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = tag.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && (chars[i].is_whitespace() || chars[i] == '/') {
            i += 1;
        }
        if i >= chars.len() || chars[i] == '>' {
            break;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && !matches!(chars[i], '=' | '>' | '/') {
            i += 1;
        }
        let name: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            if i < chars.len() && (matches!(chars[i], '"' | '\'')) {
                let quote = chars[i];
                i += 1;
                let vstart = i;
                while i < chars.len() && chars[i] != quote {
                    i += 1;
                }
                if i >= chars.len() {
                    break;
                }
                out.push((name, chars[vstart..i].iter().collect()));
                i += 1;
            }
        } else if i >= chars.len() {
            break;
        }
    }
    out
}

/// A CSS length as px: unitless and `px` as is, absolute units at 96 dpi, `em`/`ex` at a 16px em; `%` and the rest are unknown.
fn svg_length_px(value: &str) -> Option<f64> {
    let v = value.trim();
    let b = v.as_bytes();
    let digits = |mut i: usize| {
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        i
    };
    let mut cut = usize::from(matches!(b.first(), Some(b'+' | b'-')));
    cut = digits(cut);
    if b.get(cut) == Some(&b'.') {
        cut = digits(cut + 1);
    }
    // An exponent only when digits follow, so `1em` is one em and not `1e` of something.
    if matches!(b.get(cut), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(b.get(cut + 1), Some(b'+' | b'-')));
        if b.get(cut + 1 + sign).is_some_and(u8::is_ascii_digit) {
            cut = digits(cut + 1 + sign);
        }
    }
    let n = v[..cut].parse::<f64>().ok()?;
    let factor = match v[cut..].trim().to_ascii_lowercase().as_str() {
        "" | "px" => 1.0,
        "pt" => 4.0 / 3.0,
        "pc" => 16.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        "q" => 96.0 / 101.6,
        "em" | "rem" => 16.0,
        "ex" => 8.0,
        _ => return None,
    };
    let px = n * factor;
    (px.is_finite() && px > 0.0).then_some(px)
}

fn svg_view_box(value: &str) -> Option<(f64, f64)> {
    let nums: Vec<f64> = value
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|t| !t.is_empty())
        .map(|t| t.parse::<f64>())
        .collect::<Result<_, _>>()
        .ok()?;
    match nums.as_slice() {
        [_, _, w, h] if w.is_finite() && h.is_finite() && *w > 0.0 && *h > 0.0 => Some((*w, *h)),
        _ => None,
    }
}

fn to_pixels(w: f64, h: f64) -> Option<ImageDimensions> {
    let (w, h) = (w.round(), h.round());
    (w >= 1.0 && h >= 1.0 && w <= f64::from(u32::MAX) && h <= f64::from(u32::MAX)).then_some(
        ImageDimensions {
            width: w as u32,
            height: h as u32,
        },
    )
}

/// Intrinsic size of an SVG as a browser draws it in `<img>`: the root's `width`/`height`, a missing or
/// percentage one taken from the viewBox (its aspect ratio when one side is given), else the viewBox itself.
pub(crate) fn svg_dimensions(head: &[u8]) -> Option<ImageDimensions> {
    let text = String::from_utf8_lossy(head);
    let attrs = svg_root_attributes(&text)?;
    let find = |name: &str| {
        attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    };
    let width = find("width").and_then(svg_length_px);
    let height = find("height").and_then(svg_length_px);
    let view_box = find("viewBox").and_then(svg_view_box);
    match (width, height, view_box) {
        (Some(w), Some(h), _) => to_pixels(w, h),
        (Some(w), None, Some((vw, vh))) => to_pixels(w, w * vh / vw),
        (None, Some(h), Some((vw, vh))) => to_pixels(h * vw / vh, h),
        (None, None, Some((vw, vh))) => to_pixels(vw, vh),
        _ => None,
    }
}

/// Natural pixel size from the file header only (`imagesize`, MIT). `null` when the bytes are not an image.
#[cfg(test)]
pub fn image_size_blocking(path: String) -> Result<Option<ImageDimensions>, ShellError> {
    image_size_checked(path, |_| true)
}

/// `image_size_blocking`, with `accept` asked of the opened handle before a byte is read; the header is read from that
/// handle, never from the path again.
fn image_size_checked(
    path: String,
    accept: impl FnOnce(&File) -> bool,
) -> Result<Option<ImageDimensions>, ShellError> {
    absolute(&path)?;
    let p = Path::new(&path);
    let file = crate::file_scheme::open_unblocked(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ShellError::not_found(&path, format!("{path}: no such file"))
        } else {
            ShellError::io(&path, e.to_string())
        }
    })?;
    if !accept(&file) {
        return Err(ShellError::outside(&path));
    }
    let measured = if has_svg_extension(p) {
        svg_dimensions_of_file(&path, file)
    } else {
        match reader_size(std::io::BufReader::new(file)) {
            Ok(dim) => Ok(Some(ImageDimensions {
                width: dim.width as u32,
                height: dim.height as u32,
            })),
            Err(err) => map_image_size_error(&path, err),
        }
    };
    if matches!(measured, Ok(Some(_))) {
        crate::file_scheme::open_measured_image(crate::file_scheme::opened(), &path);
    }
    measured
}

/// Adds a folder, recursively, to what `marxy-file://` serves this session (src/file_scheme.rs).
#[tauri::command]
pub async fn allow_asset_scope(dir: String) -> Result<(), ShellError> {
    let probe = dir.clone();
    off_main_shell(&dir, move || {
        scope_directory(&probe)?;
        crate::file_scheme::open_folder(&probe)
            .map(drop)
            .map_err(|_| ShellError::invalid(&probe, "not a folder that can be opened"))
    })
    .await
}

/// Lists immediate children of `dir`; deny-listed directory names are omitted.
#[cfg(test)]
pub fn read_dir_blocking(dir: String) -> Result<Vec<FileStat>, ShellError> {
    absolute(&dir)?;
    let path = Path::new(&dir);
    if !path.is_dir() {
        return Err(ShellError::not_found(
            &dir,
            format!("{dir}: not a directory"),
        ));
    }
    let canonical = dunce::canonicalize(path).map_err(|e| ShellError::io(&dir, e.to_string()))?;
    list_canonical(&dir, &canonical)
}

/// The children of `canonical`, a resolved folder; `dir` is how the caller named it.
fn list_canonical(dir: &str, canonical: &Path) -> Result<Vec<FileStat>, ShellError> {
    let mut out = Vec::new();
    let entries = fs::read_dir(canonical).map_err(|e| ShellError::io(dir, e.to_string()))?;
    // A single directory entry can itself fail to read mid-iteration (the same races metadata()
    // below tolerates); `.flatten()` skips it rather than failing the whole listing.
    for entry in entries.flatten() {
        let name = entry.file_name();
        let child = entry.path();
        // A file can vanish (or its permissions change) between `fs::read_dir` listing it and this
        // `metadata()` call; that one entry is omitted rather than failing the whole listing, the
        // same TOCTOU tolerance `collectFiles` (`packages/core/src/index-model/walk.ts`) gives a racy directory
        // tree with its try/catch around each listing.
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let is_dir = meta.is_dir();
        if is_dir && name.to_str().is_some_and(denied_name) {
            continue;
        }
        let size = if is_dir { 0 } else { meta.len() };
        let abs = if child.is_absolute() {
            child
        } else {
            canonical.join(child)
        };
        out.push(FileStat {
            path: abs.to_string_lossy().into_owned(),
            size,
            mtime_ms: mtime_ms(&meta),
            is_dir,
            created_ms: None,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// The path with every symlink and `.`/`..` resolved, as `read_dir` and the watches spell paths.
#[cfg(test)]
pub fn real_path_blocking(path: String) -> Result<String, ShellError> {
    absolute(&path)?;
    match dunce::canonicalize(Path::new(&path)) {
        Ok(p) => Ok(p.to_string_lossy().into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(ShellError::not_found(&path, format!("{path}: not found")))
        }
        Err(e) => Err(ShellError::io(&path, e.to_string())),
    }
}

/// The most `read_head` ever returns, whatever the caller asks for: the index's head size.
pub const MAX_HEAD_BYTES: u64 = 256 * 1024;

/// The most `read_file` opens: one named ceiling, 256 MB (the memory a document takes once parsed and
/// typeset is about ten times its size). A larger file is refused with a notice, not read.
pub const MAX_OPEN_BYTES: u64 = 256 * 1024 * 1024;

/// A file's bytes exactly as on disk, behind the `read_file` command in `main.rs`. A symlink is followed
/// (a link to a document opens as the document), then anything that is not a regular file, and any
/// file above `ceiling`, is refused before a byte is read. The open never blocks on a pipe, and the
/// opened handle is checked again, as `read_opened_head` does, because the path may be swapped between
/// the check and the open. The error's `code` says what happened (not-found, refused, io); its message, which
/// the webview shows as the open-error notice, is never read for that.
#[cfg(test)]
pub fn read_regular_file(path: &str, ceiling: u64) -> Result<Vec<u8>, ShellError> {
    read_regular_file_checked(path, ceiling, |_| true)
}

/// `read_regular_file`, with `accept` asked of the opened handle before a byte is read.
pub fn read_regular_file_checked(
    path: &str,
    ceiling: u64,
    accept: impl FnOnce(&File) -> bool,
) -> Result<Vec<u8>, ShellError> {
    absolute(path)?;
    let p = Path::new(path);
    let failed = |e: std::io::Error| {
        let message = format!("{path}: {e}");
        if e.kind() == std::io::ErrorKind::NotFound {
            ShellError::not_found(path, message)
        } else {
            ShellError::io(path, message)
        }
    };
    let meta = fs::metadata(p).map_err(failed)?;
    check_openable(path, &meta, ceiling)?;
    let file = open_following(p).map_err(failed)?;
    if !accept(&file) {
        return Err(ShellError::outside(path));
    }
    let meta = file.metadata().map_err(failed)?;
    check_openable(path, &meta, ceiling)?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    // One byte past the ceiling: a file that grew after the check is refused, not truncated.
    file.take(ceiling.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(failed)?;
    if bytes.len() as u64 > ceiling {
        return Err(ShellError::refused(
            path,
            format!(
                "{} (it grew while being read)",
                too_large(path, bytes.len() as u64, ceiling)
            ),
        ));
    }
    Ok(bytes)
}

fn check_openable(path: &str, meta: &fs::Metadata, ceiling: u64) -> Result<(), ShellError> {
    if !meta.is_file() {
        return Err(ShellError::refused(
            path,
            format!("{path}: not a regular file (a folder, pipe or device cannot be opened)"),
        ));
    }
    if meta.len() > ceiling {
        return Err(ShellError::refused(
            path,
            too_large(path, meta.len(), ceiling),
        ));
    }
    Ok(())
}

fn too_large(path: &str, size: u64, ceiling: u64) -> String {
    let mb = |n: u64| n.div_ceil(1024 * 1024);
    format!(
        "{path}: too large to open ({} MB; the most Marxy opens is {} MB)",
        mb(size),
        mb(ceiling)
    )
}

/// Opens `p` following a link, without blocking on a pipe (`O_NONBLOCK` has no effect on a regular file).
fn open_following(p: &Path) -> std::io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(p)
    }
    #[cfg(not(unix))]
    {
        File::open(p)
    }
}

/// One file's size and modification time, without listing its folder. A narrower form of
/// `read_dir`, so it reaches no further: `None` for a path that is missing, is a symlink (`read_dir`
/// omits every one), or is a folder named like a deny-listed directory. A folder is reported as one.
#[cfg(test)]
pub fn stat_file_blocking(path: String) -> Result<Option<FileStat>, ShellError> {
    stat_file_checked(path, |_| true)
}

/// `stat_file_blocking`, the size and times taken from a handle `accept` judged rather than from the name.
fn stat_file_checked(
    path: String,
    accept: impl FnOnce(&File) -> bool,
) -> Result<Option<FileStat>, ShellError> {
    absolute(&path)?;
    let p = Path::new(&path);
    let meta = match fs::symlink_metadata(p) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ShellError::io(&path, e.to_string())),
    };
    if meta.file_type().is_symlink() {
        return Ok(None);
    }
    let file = match crate::scope::open_for_stat(p) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ShellError::io(&path, e.to_string())),
    };
    if !accept(&file) {
        return Err(ShellError::outside(&path));
    }
    let meta = file
        .metadata()
        .map_err(|e| ShellError::io(&path, e.to_string()))?;
    let is_dir = meta.is_dir();
    if is_dir
        && p.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(denied_name)
    {
        return Ok(None);
    }
    Ok(Some(FileStat {
        path,
        size: if is_dir { 0 } else { meta.len() },
        mtime_ms: mtime_ms(&meta),
        is_dir,
        created_ms: created_ms(&meta),
    }))
}

/// The birth time, or None where the platform or the file system does not keep one (most Linux file
/// systems before statx, some network shares): the card then says nothing of it.
fn created_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .filter(|&ms| ms > 0)
}

/// Opens `p` for `read_head_bytes` without following a link at the path and without blocking. On unix
/// the open itself carries `O_NOFOLLOW` (a symlink at the path fails the open) and `O_NONBLOCK` (opening
/// a FIFO returns at once instead of waiting for a writer; it has no effect on a regular file), so a
/// path swapped for a link or a pipe between the type check and the open cannot slip through.
fn open_head(p: &Path) -> std::io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(p)
    }
    #[cfg(not(unix))]
    {
        File::open(p)
    }
}

/// The first `max_bytes` of a regular file (never more than `MAX_HEAD_BYTES`), behind the `read_head`
/// command in `main.rs`. A narrower form of `read_file`: a symlink at the path, a FIFO, a device or a
/// folder is refused. The type is checked before the open, and on unix the open itself neither follows a
/// link nor blocks on a pipe (`open_head`); the type of what was opened is checked again. It judges no
/// scope: `read_head_in` does.
#[cfg(test)]
pub fn read_head_bytes(path: &str, max_bytes: u64) -> Result<Vec<u8>, ShellError> {
    read_head_bytes_checked(path, max_bytes, |_| true)
}

/// `read_head_bytes`, with `accept` asked of the opened handle before a byte is read.
fn read_head_bytes_checked(
    path: &str,
    max_bytes: u64,
    accept: impl FnOnce(&File) -> bool,
) -> Result<Vec<u8>, ShellError> {
    absolute(path)?;
    let p = Path::new(path);
    let meta = fs::symlink_metadata(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ShellError::not_found(path, format!("{path}: no such file"))
        } else {
            ShellError::io(path, e.to_string())
        }
    })?;
    if !meta.file_type().is_file() {
        return Err(ShellError::invalid(
            path,
            format!("{path}: not a regular file"),
        ));
    }
    let file = open_head(p).map_err(|e| ShellError::io(path, e.to_string()))?;
    if !accept(&file) {
        return Err(ShellError::outside(path));
    }
    read_opened_head(path, file, max_bytes)
}

/// Read the head of a file `open_head` opened. The path may have been swapped for something else
/// between the type check and the open, so the opened file's own type is checked again here.
fn read_opened_head(path: &str, file: File, max_bytes: u64) -> Result<Vec<u8>, ShellError> {
    if !file.metadata().map(|m| m.is_file()).unwrap_or(false) {
        return Err(ShellError::invalid(
            path,
            format!("{path}: not a regular file"),
        ));
    }
    let mut head = Vec::new();
    file.take(max_bytes.min(MAX_HEAD_BYTES))
        .read_to_end(&mut head)
        .map_err(|e| ShellError::io(path, e.to_string()))?;
    Ok(head)
}

/// Runs disk work on the blocking pool. A sync command runs on the main thread, where a read that stalls on
/// a share freezes the window; blocking inside an async command would hold a runtime worker instead.
pub async fn off_main<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("disk task failed: {e}"))
}

pub(crate) async fn off_main_shell<T: Send + 'static>(
    path: &str,
    work: impl FnOnce() -> Result<T, ShellError> + Send + 'static,
) -> Result<T, ShellError> {
    off_main(work).await.map_err(|e| ShellError::io(path, e))?
}

/// `read_file`'s body: a file in scope, its handle judged again once opened (a link swapped in meanwhile).
pub fn read_file_in(set: &RwLock<OpenedSet>, path: &str) -> Result<Vec<u8>, ShellError> {
    scope::check(set, path, Need::Read)?;
    read_regular_file_checked(path, MAX_OPEN_BYTES, |file| {
        scope::handle_in(set, file, Path::new(path), Need::Read)
    })
}

/// `read_head`'s body. On Windows the open follows a link at the path and every folder above it, so the handle is
/// judged as well as the path: it must be open on the file the check judged.
pub fn read_head_in(
    set: &RwLock<OpenedSet>,
    path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, ShellError> {
    let canonical = scope::check(set, path, Need::Read)?;
    read_head_judged(path, &canonical, max_bytes)
}

/// The read `read_head_in` makes once `canonical` is judged.
pub(crate) fn read_head_judged(
    path: &str,
    canonical: &Path,
    max_bytes: u64,
) -> Result<Vec<u8>, ShellError> {
    read_head_bytes_checked(path, max_bytes, |file| scope::handle_is(file, canonical))
}

/// `image_size`'s body: the header is read from a handle judged to be open on the file the check judged.
pub fn image_size_in(
    set: &RwLock<OpenedSet>,
    path: String,
) -> Result<Option<ImageDimensions>, ShellError> {
    let canonical = scope::check(set, &path, Need::Read)?;
    image_size_judged(path, &canonical)
}

/// The measure `image_size_in` takes once `canonical` is judged.
pub(crate) fn image_size_judged(
    path: String,
    canonical: &Path,
) -> Result<Option<ImageDimensions>, ShellError> {
    image_size_checked(path, |file| scope::handle_is(file, canonical))
}

/// `read_dir`'s body: the folder the check judged is held open and its handle judged, then listed by that path. On
/// Windows the hold keeps a junction from being swapped onto it, or onto a folder above it, while it is listed.
pub fn read_dir_in(set: &RwLock<OpenedSet>, dir: String) -> Result<Vec<FileStat>, ShellError> {
    let canonical = scope::check(set, &dir, Need::Folder)?;
    read_dir_judged(&dir, &canonical)
}

/// The listing `read_dir_in` makes once `canonical` is judged.
pub(crate) fn read_dir_judged(dir: &str, canonical: &Path) -> Result<Vec<FileStat>, ShellError> {
    let folder = scope::open_held(canonical).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ShellError::not_found(dir, format!("{dir}: not a directory"))
        } else {
            ShellError::io(dir, e.to_string())
        }
    })?;
    if !scope::handle_is(&folder, canonical) {
        return Err(ShellError::outside(dir));
    }
    if !folder.metadata().is_ok_and(|m| m.is_dir()) {
        return Err(ShellError::not_found(
            dir,
            format!("{dir}: not a directory"),
        ));
    }
    let listed = list_canonical(dir, canonical);
    drop(folder);
    listed
}

/// The path the check resolved and judged: resolving it again would answer for wherever the path leads by then.
pub fn real_path_in(set: &RwLock<OpenedSet>, path: String) -> Result<String, ShellError> {
    let canonical = scope::check(set, &path, Need::List)?;
    Ok(canonical.to_string_lossy().into_owned())
}

/// A path in scope that is not there is `None`, as it always was.
pub fn stat_in(set: &RwLock<OpenedSet>, path: String) -> Result<Option<FileStat>, ShellError> {
    let canonical = match scope::check(set, &path, Need::List) {
        Err(e) if e.code == "not-found" => return Ok(None),
        Err(e) => return Err(e),
        Ok(c) => c,
    };
    stat_judged(path, &canonical)
}

/// The stat `stat_in` takes once `canonical` is judged.
pub(crate) fn stat_judged(path: String, canonical: &Path) -> Result<Option<FileStat>, ShellError> {
    stat_file_checked(path, |file| scope::handle_is(file, canonical))
}

#[tauri::command]
pub async fn image_size(path: String) -> Result<Option<ImageDimensions>, ShellError> {
    off_main_shell(&path.clone(), move || {
        image_size_in(crate::file_scheme::opened(), path)
    })
    .await
}

#[tauri::command]
pub async fn read_dir(dir: String) -> Result<Vec<FileStat>, ShellError> {
    off_main_shell(&dir.clone(), move || {
        read_dir_in(crate::file_scheme::opened(), dir)
    })
    .await
}

#[tauri::command]
pub async fn real_path(path: String) -> Result<String, ShellError> {
    off_main_shell(&path.clone(), move || {
        real_path_in(crate::file_scheme::opened(), path)
    })
    .await
}

#[tauri::command]
pub async fn stat_file(path: String) -> Result<Option<FileStat>, ShellError> {
    off_main_shell(&path.clone(), move || {
        stat_in(crate::file_scheme::opened(), path)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn corpus_png() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/image.png")
    }

    fn corpus_ts() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/04-source.ts")
    }

    #[test]
    fn a_relative_path_is_refused_never_read_against_the_working_folder() {
        // An archive's entry held in memory, its folder, and the folders a walk up from it reaches.
        for rel in [
            "archive-entry:4/notes",
            "archive-entry:4",
            ".",
            "",
            "src",
            "./Cargo.toml",
            "../desktop",
        ] {
            let refused = |r: Result<(), ShellError>| matches!(r, Err(e) if e.code == "invalid");
            assert!(refused(absolute(rel)), "{rel:?}");
            assert!(
                refused(read_dir_blocking(rel.into()).map(drop)),
                "read_dir {rel:?}"
            );
            assert!(
                refused(real_path_blocking(rel.into()).map(drop)),
                "real_path {rel:?}"
            );
            assert!(
                refused(stat_file_blocking(rel.into()).map(drop)),
                "stat {rel:?}"
            );
            assert!(
                refused(read_head_bytes(rel, 16).map(drop)),
                "read_head {rel:?}"
            );
            assert!(
                refused(image_size_blocking(rel.into()).map(drop)),
                "image_size {rel:?}"
            );
            assert!(
                refused(scope_directory(rel).map(drop)),
                "allow_asset_scope {rel:?}"
            );
            assert!(
                refused(read_regular_file(rel, 16).map(drop)),
                "read_file {rel:?}"
            );
        }
        // The same names, absolute, are read as before.
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        assert!(read_dir_blocking(here.to_string_lossy().into_owned()).is_ok());
        assert!(real_path_blocking(here.join("Cargo.toml").to_string_lossy().into_owned()).is_ok());
        assert!(
            stat_file_blocking(here.join("Cargo.toml").to_string_lossy().into_owned())
                .unwrap()
                .is_some()
        );
    }

    fn svg_of(root: &str) -> Option<(u32, u32)> {
        svg_dimensions(root.as_bytes()).map(|d| (d.width, d.height))
    }

    #[test]
    fn svg_width_and_height_attributes() {
        assert_eq!(
            svg_of(r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>"#),
            Some((120, 80))
        );
        assert_eq!(
            svg_of("<svg width='64px' height='32px' viewBox='0 0 10 10'/>"),
            Some((64, 32))
        );
    }

    #[test]
    fn svg_view_box_only() {
        assert_eq!(svg_of(r#"<svg viewBox="0 0 200 100">"#), Some((200, 100)));
        assert_eq!(svg_of(r#"<svg viewBox="-5,-5,48.4,24.6">"#), Some((48, 25)));
    }

    #[test]
    fn svg_units_become_pixels() {
        assert_eq!(
            svg_of(r#"<svg width="1in" height="0.5in">"#),
            Some((96, 48))
        );
        assert_eq!(svg_of(r#"<svg width="3pt" height="6pt">"#), Some((4, 8)));
        assert_eq!(svg_of(r#"<svg width="2em" height="1em">"#), Some((32, 16)));
        assert_eq!(
            svg_of(r#"<svg width="2.54cm" height="25.4mm">"#),
            Some((96, 96))
        );
        assert_eq!(svg_of(r#"<svg width="1e2" height="5E1">"#), Some((100, 50)));
    }

    #[test]
    fn svg_percent_falls_back_to_view_box() {
        assert_eq!(
            svg_of(r#"<svg width="100%" height="100%" viewBox="0 0 40 20">"#),
            Some((40, 20))
        );
        assert_eq!(svg_of(r#"<svg width="100%" height="100%">"#), None);
    }

    #[test]
    fn svg_one_side_uses_the_view_box_ratio() {
        assert_eq!(
            svg_of(r#"<svg width="100" viewBox="0 0 50 25">"#),
            Some((100, 50))
        );
        assert_eq!(
            svg_of(r#"<svg height="10" viewBox="0 0 50 25">"#),
            Some((20, 10))
        );
        assert_eq!(svg_of(r#"<svg width="100">"#), None);
    }

    #[test]
    fn svg_prolog_comments_and_inner_elements_do_not_confuse_the_root() {
        let text = "<?xml version=\"1.0\"?>
<!DOCTYPE svg>
<!-- <svg width=\"1\" height=\"1\"> -->
<svg
  width=\"30\"
  height=\"20\">
<svg width=\"5\" height=\"5\"/></svg>";
        assert_eq!(svg_of(text), Some((30, 20)));
        // Attributes after the root's `>` belong to children.
        assert_eq!(svg_of(r#"<svg><rect width="9" height="9"/></svg>"#), None);
    }

    #[test]
    fn svg_without_a_size_or_a_root_is_none() {
        assert_eq!(
            svg_of("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
            None
        );
        assert_eq!(svg_of("<html><body>not an svg</body></html>"), None);
        assert_eq!(svg_of(r#"<svg width="0" height="0">"#), None);
        assert_eq!(svg_of(r#"<svgfoo width="4" height="4">"#), None);
        assert_eq!(svg_of(""), None);
    }

    #[test]
    fn image_size_reads_an_svg_file_by_its_extension() {
        let dir = std::env::temp_dir().join(format!("marxy-svg-size-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Logo.SVG");
        // The root sits after a large comment: still inside the bounded read.
        let body = format!(
            "<!-- {} --><svg width=\"48\" height=\"24\"/>",
            "x".repeat(40 * 1024)
        );
        fs::write(&path, body).unwrap();
        let dim = image_size_blocking(path.to_string_lossy().into_owned())
            .unwrap()
            .unwrap();
        assert_eq!((dim.width, dim.height), (48, 24));
        let far = dir.join("far.svg");
        fs::write(
            &far,
            format!(
                "<!-- {} --><svg width=\"1\" height=\"1\"/>",
                "x".repeat(70 * 1024)
            ),
        )
        .unwrap();
        assert!(image_size_blocking(far.to_string_lossy().into_owned())
            .unwrap()
            .is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn image_size_on_corpus_png_is_1200_by_400() {
        let path = corpus_png();
        assert!(path.is_file(), "fixture missing: {}", path.display());
        let got = image_size_blocking(path.to_string_lossy().into_owned())
            .unwrap()
            .unwrap();
        assert_eq!(got.width, 1200);
        assert_eq!(got.height, 400);
    }

    #[test]
    fn image_size_on_text_source_is_none() {
        let path = corpus_ts();
        assert!(path.is_file());
        assert!(image_size_blocking(path.to_string_lossy().into_owned())
            .unwrap()
            .is_none());
    }

    #[test]
    fn image_size_on_missing_path_is_not_found() {
        let missing = std::env::temp_dir().join("no-such-marxy-folder/marxy-image.png");
        let err = image_size_blocking(missing.to_string_lossy().into_owned()).unwrap_err();
        assert_eq!(err.code, "not-found");
    }

    #[test]
    fn map_image_size_error_permission_denied_is_io() {
        use std::io::{Error, ErrorKind};

        let err = map_image_size_error(
            "/locked.png",
            ImageError::IoError(Error::new(ErrorKind::PermissionDenied, "permission denied")),
        )
        .expect_err("real I/O failure must not become null");
        assert_eq!(err.code, "io");
    }

    #[test]
    fn map_image_size_error_format_miss_is_none() {
        use std::io::{Error, ErrorKind};

        assert!(map_image_size_error(
            "/short.png",
            ImageError::IoError(Error::new(ErrorKind::UnexpectedEof, "eof")),
        )
        .unwrap()
        .is_none());
        assert!(map_image_size_error(
            "/short.png",
            ImageError::IoError(Error::new(ErrorKind::InvalidData, "bad")),
        )
        .unwrap()
        .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn image_size_on_unreadable_file_is_io_not_none() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("marxy-image-size-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("tmpdir");
        let file = root.join("locked.png");
        fs::write(&file, b"\x89PNG\r\n\x1a\n").expect("seed png header");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).expect("chmod");

        let path = file.to_string_lossy().into_owned();
        let restore = || {
            let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o644));
            let _ = fs::remove_dir_all(&root);
        };

        // Root on Linux can still read mode 000; map_image_size_error tests cover the contract there.
        if fs::read(&file).is_ok() {
            restore();
            return;
        }

        let err = match image_size_blocking(path) {
            Err(e) => e,
            Ok(none) => {
                restore();
                panic!("permission denied must not look like a non-image: {none:?}");
            }
        };
        restore();
        assert_eq!(err.code, "io");
    }

    #[test]
    fn allow_asset_scope_on_a_file_is_invalid() {
        let path = corpus_png();
        let err = scope_directory(&path.to_string_lossy()).unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    /// The scope handed to the asset protocol is exactly the directory asked for, never its parent
    /// (the Rust half of the asset-scope tests in test/images.test.mjs; `allow_asset_scope`
    /// itself needs a Tauri `AppHandle`, so its argument check is the testable part).
    #[test]
    fn allow_asset_scope_on_a_directory_is_that_directory_and_no_wider() {
        let root = std::env::temp_dir().join(format!("marxy-asset-scope-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let docs = root.join("docs");
        fs::create_dir_all(&docs).expect("tmpdir");

        let got = scope_directory(&docs.to_string_lossy()).expect("a directory is a valid scope");
        let _ = fs::remove_dir_all(&root);

        assert_eq!(got, docs);
        assert_ne!(got, root, "the scope must not widen to the parent");
    }

    #[test]
    fn allow_asset_scope_on_a_missing_path_is_invalid() {
        let err = scope_directory("/no/such/marxy-asset-dir").unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    #[test]
    fn allow_asset_scope_refuses_a_drive_root_and_the_home_folder() {
        let temp = dunce::canonicalize(std::env::temp_dir()).expect("temp dir");
        let root = temp.ancestors().last().expect("a root").to_path_buf();
        let mut refused = vec![root];
        refused.extend(
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from),
        );
        for dir in refused {
            let dir = dir.to_string_lossy().into_owned();
            let err = tauri::async_runtime::block_on(allow_asset_scope(dir.clone())).unwrap_err();
            assert_eq!(err.code, "invalid", "{dir}");
        }
    }

    /// The index walk trusts `read_dir` never to list a symlink, so it never leaves the root.
    /// Every symlink is omitted: out-of-root directory and file links, and one that stays inside.
    #[cfg(unix)]
    #[test]
    fn read_dir_omits_every_symlink() {
        use std::os::unix::fs::symlink;
        let base =
            std::env::temp_dir().join(format!("marxy-read-dir-links-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("secret.md"), b"# secret\n").expect("secret");
        fs::write(root.join("real.md"), b"# real\n").expect("real");
        symlink(&outside, root.join("dirlink")).expect("dir symlink");
        symlink(outside.join("secret.md"), root.join("filelink.md")).expect("file symlink");
        symlink(root.join("real.md"), root.join("insidelink.md")).expect("inside symlink");

        let listed = read_dir_blocking(root.to_string_lossy().into_owned()).expect("read_dir");
        let names: Vec<String> = listed
            .iter()
            .map(|s| {
                Path::new(&s.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let _ = fs::remove_dir_all(&base);

        assert_eq!(names, vec!["real.md".to_string()]);
    }

    /// The deny list holds in any case, as `marxy-file://` holds it: an index that listed `Build` would show files whose
    /// images it then refuses.
    #[test]
    fn read_dir_skips_a_denied_name_in_any_case() {
        let root = std::env::temp_dir().join(format!("marxy-read-dir-case-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Build")).expect("Build");
        fs::create_dir_all(root.join("NODE_MODULES")).expect("NODE_MODULES");
        fs::write(root.join("a.md"), b"a").expect("a.md");
        let listed = read_dir_blocking(root.to_string_lossy().into_owned()).expect("read_dir");
        let names: Vec<String> = listed
            .iter()
            .map(|s| {
                Path::new(&s.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["a.md".to_string()]);
        assert!(
            stat_file_blocking(root.join("Build").to_string_lossy().into_owned())
                .expect("stat")
                .is_none()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// the deny list names folders; a file named `build` or `out` is listed and stated like any file.
    #[test]
    fn a_file_named_like_a_denied_folder_is_listed_and_stated() {
        let root =
            std::env::temp_dir().join(format!("marxy-read-dir-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Out")).expect("Out");
        fs::write(root.join("build"), b"#!/bin/sh\n").expect("build");
        fs::write(root.join("TARGET"), b"t").expect("TARGET");
        let listed = read_dir_blocking(root.to_string_lossy().into_owned()).expect("read_dir");
        let mut names: Vec<String> = listed
            .iter()
            .map(|s| {
                Path::new(&s.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["TARGET".to_string(), "build".to_string()]);
        let stat =
            stat_file_blocking(root.join("build").to_string_lossy().into_owned()).expect("stat");
        assert!(stat.is_some_and(|s| !s.is_dir));
        assert!(
            stat_file_blocking(root.join("Out").to_string_lossy().into_owned())
                .expect("stat")
                .is_none()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// The shell's one list is core's: `index-model/deny.ts` and this hold the same names, both ways.
    #[test]
    fn the_deny_list_is_the_index_walkers() {
        let deny_ts = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core/src/index-model/deny.ts");
        let source = fs::read_to_string(&deny_ts).expect("read deny.ts");
        let start = source
            .find("DENY_DIRECTORY_NAMES")
            .expect("DENY_DIRECTORY_NAMES in deny.ts");
        let open = start + source[start..].find("= [").expect("array start");
        let close = open + source[open..].find(']').expect("array end");
        let list = source[open..close].replace('"', "'");
        let mut names: Vec<&str> = list.split('\'').skip(1).step_by(2).collect();
        let mut ours = DENY_DIRECTORY_NAMES.to_vec();
        names.sort_unstable();
        ours.sort_unstable();
        assert_eq!(
            names, ours,
            "deny.ts and commands/fs.rs name the same folders"
        );
        for name in DENY_DIRECTORY_NAMES {
            assert!(
                denied_name(name) && denied_name(&name.to_ascii_uppercase()),
                "{name}"
            );
        }
    }

    #[test]
    fn read_dir_lists_one_level_with_mtime_and_skips_node_modules() {
        let root = std::env::temp_dir().join(format!("marxy-read-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("tmpdir");
        fs::write(root.join("a.md"), b"# a\n").expect("a.md");
        fs::create_dir(root.join("sub")).expect("sub");
        fs::create_dir_all(root.join("node_modules").join("pkg")).expect("node_modules");
        fs::write(root.join("node_modules/pkg/x.md"), b"x").expect("nm file");

        let dir = root.to_string_lossy().into_owned();
        let listed = read_dir_blocking(dir).expect("read_dir");
        let names: Vec<String> = listed
            .iter()
            .map(|stat| {
                Path::new(&stat.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();

        assert!(names.iter().any(|n| n == "a.md"));
        assert!(names.iter().any(|n| n == "sub"));
        assert!(!names.iter().any(|n| n == "node_modules"));
        let file = listed
            .iter()
            .find(|s| s.path.ends_with("a.md"))
            .expect("a.md stat");
        assert!(!file.is_dir);
        assert!(file.size > 0);
        assert!(file.mtime_ms > 0);
        let sub = listed
            .iter()
            .find(|s| s.path.ends_with("sub"))
            .expect("sub stat");
        assert!(sub.is_dir);

        let _ = fs::remove_dir_all(&root);
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("tmpdir");
        dir
    }

    #[cfg(unix)]
    #[test]
    fn real_path_resolves_links_and_dots_as_the_os_does_and_rejects_a_missing_path() {
        let dir = scratch_dir("real-path").canonicalize().unwrap();
        fs::create_dir_all(dir.join("real/deep")).unwrap();
        fs::create_dir(dir.join("elsewhere")).unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();
        std::os::unix::fs::symlink(dir.join("elsewhere"), dir.join("real/sub")).unwrap();
        let resolve = |p: String| real_path_blocking(p).unwrap();
        assert_eq!(
            resolve(dir.join("link").to_string_lossy().into_owned()),
            dir.join("real").to_string_lossy()
        );
        // `sub` is a link: `..` is taken from its target, not from `link/`.
        assert_eq!(
            resolve(format!("{}/link/sub/..", dir.display())),
            dir.to_string_lossy()
        );
        assert_eq!(
            real_path_blocking(format!("{}/gone", dir.display()))
                .unwrap_err()
                .code,
            "not-found"
        );
    }

    #[test]
    fn stat_file_reports_a_file_a_folder_and_a_missing_path() {
        let dir = scratch_dir("stat-basic");
        fs::write(dir.join("a.md"), b"# a\n").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        let file = stat_file_blocking(dir.join("a.md").to_string_lossy().into_owned())
            .unwrap()
            .expect("file");
        assert_eq!((file.size, file.is_dir), (4, false));
        assert!(file.mtime_ms > 0);
        let sub = stat_file_blocking(dir.join("sub").to_string_lossy().into_owned())
            .unwrap()
            .expect("folder");
        assert!(sub.is_dir);
        assert!(
            stat_file_blocking(dir.join("gone.md").to_string_lossy().into_owned())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stat_file_says_when_a_file_was_made_where_the_platform_keeps_it() {
        let dir = scratch_dir("stat-created");
        fs::write(dir.join("a.bin"), [0u8, 1]).unwrap();
        let path = dir.join("a.bin").to_string_lossy().into_owned();
        let stat = stat_file_blocking(path.clone()).unwrap().expect("file");
        let json = serde_json::to_value(&stat).unwrap();
        match fs::metadata(&path).unwrap().created() {
            Ok(_) => {
                let made = stat
                    .created_ms
                    .expect("a birth time where the platform has one");
                assert!(made > 0 && made <= stat.mtime_ms + 1_000);
                assert_eq!(json["createdMs"].as_u64(), Some(made));
            }
            Err(_) => assert!(json.get("createdMs").is_none()),
        }
        let listed = read_dir_blocking(dir.to_string_lossy().into_owned()).unwrap();
        assert!(listed.iter().all(|s| s.created_ms.is_none()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stat_file_omits_what_read_dir_omits() {
        let dir = scratch_dir("stat-denied");
        fs::create_dir(dir.join("node_modules")).unwrap();
        assert!(
            stat_file_blocking(dir.join("node_modules").to_string_lossy().into_owned())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn stat_file_refuses_a_symlink_to_a_file_or_a_folder() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("stat-link");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("filelink.md")).unwrap();
        symlink(&dir, dir.join("dirlink")).unwrap();
        for name in ["filelink.md", "dirlink"] {
            assert!(
                stat_file_blocking(dir.join(name).to_string_lossy().into_owned())
                    .unwrap()
                    .is_none(),
                "{name}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_returns_at_most_the_bytes_asked_for() {
        let dir = scratch_dir("head-limit");
        fs::write(dir.join("a.md"), b"0123456789").unwrap();
        let path = dir.join("a.md").to_string_lossy().into_owned();
        assert_eq!(read_head_bytes(&path, 4).unwrap(), b"0123");
        assert_eq!(read_head_bytes(&path, 100).unwrap(), b"0123456789");
        assert_eq!(read_head_bytes(&path, 0).unwrap(), b"");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_is_capped_whatever_the_caller_asks_for() {
        let dir = scratch_dir("head-cap");
        fs::write(dir.join("big.md"), vec![b'x'; MAX_HEAD_BYTES as usize + 10]).unwrap();
        let path = dir.join("big.md").to_string_lossy().into_owned();
        assert_eq!(
            read_head_bytes(&path, u64::MAX).unwrap().len() as u64,
            MAX_HEAD_BYTES
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_head_refuses_a_folder_and_reports_a_missing_file() {
        let dir = scratch_dir("head-kinds");
        assert_eq!(
            read_head_bytes(&dir.to_string_lossy(), 10)
                .unwrap_err()
                .code,
            "invalid"
        );
        assert_eq!(
            read_head_bytes(&dir.join("gone.md").to_string_lossy(), 10)
                .unwrap_err()
                .code,
            "not-found"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn read_head_refuses_a_symlink() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("head-link");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        let err = read_head_bytes(&dir.join("link.md").to_string_lossy(), 10).unwrap_err();
        assert_eq!(err.code, "invalid");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The open itself refuses a symlink at the path, whatever the type check before it saw (the swap
    /// between the check and the open), and returns at once on a FIFO.
    #[cfg(unix)]
    #[test]
    fn the_head_open_refuses_a_symlink_and_does_not_block_on_a_pipe() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("head-open");
        fs::write(dir.join("real.md"), b"# real\n").unwrap();
        symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        assert!(open_head(&dir.join("real.md")).is_ok());
        let err = open_head(&dir.join("link.md")).unwrap_err();
        assert_eq!(err.raw_os_error(), Some(libc::ELOOP));
        let pipe = dir.join("pipe.md");
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        let (tx, rx) = std::sync::mpsc::channel();
        let opening = pipe.clone();
        std::thread::spawn(move || {
            let _ = tx.send(open_head(&opening).is_ok());
        });
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(30))
                .expect("the head open blocked on a named pipe"),
            true,
            "a FIFO opens at once (and the fstat check then refuses it)"
        );
        // A FIFO swapped in after the type check: the opened file's own type refuses it.
        let opened = open_head(&pipe).unwrap();
        let err = read_opened_head(pipe.to_str().unwrap(), opened, 16).unwrap_err();
        assert!(
            err.message.contains("not a regular file"),
            "{}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Opening a FIFO blocks until a writer appears, so the type is checked first. The read runs on a
    /// thread, and a missing answer is a failure rather than a hang; the bound guards against blocking.
    #[cfg(unix)]
    #[test]
    fn read_head_refuses_a_named_pipe_without_opening_it() {
        let dir = scratch_dir("head-fifo");
        let pipe = dir.join("pipe.md").to_string_lossy().into_owned();
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        let (tx, rx) = std::sync::mpsc::channel();
        let p = pipe.clone();
        std::thread::spawn(move || {
            let _ = tx.send(read_head_bytes(&p, 10).map_err(|e| e.code));
        });
        let got = rx
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("read_head blocked on a named pipe");
        assert_eq!(got, Err("invalid".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn read_regular_file_refuses_a_pipe_a_device_and_a_file_over_the_ceiling() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("open-guard");
        let s = |p: &Path| p.to_string_lossy().into_owned();
        // A FIFO: refused without blocking (run on a thread so a hang is a failure).
        let pipe = dir.join("pipe.md");
        assert!(std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap()
            .success());
        let (tx, rx) = std::sync::mpsc::channel();
        let p = s(&pipe);
        std::thread::spawn(move || {
            let _ = tx.send(read_regular_file(&p, MAX_OPEN_BYTES));
        });
        let err = rx
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("opening a FIFO blocked")
            .unwrap_err();
        assert_eq!(err.code, "refused");
        assert!(
            err.message.contains("not a regular file"),
            "{}",
            err.message
        );
        // A symlink to /dev/zero: followed, then refused as a device (main reads it until memory runs out).
        symlink("/dev/zero", dir.join("zero.log")).unwrap();
        let err = read_regular_file(&s(&dir.join("zero.log")), MAX_OPEN_BYTES).unwrap_err();
        assert_eq!(err.code, "refused");
        assert!(
            err.message.contains("not a regular file"),
            "{}",
            err.message
        );
        // A folder.
        assert!(read_regular_file(&s(&dir), MAX_OPEN_BYTES).is_err());
        // A sparse file one byte over the ceiling: nothing is written, nothing is read.
        let big = dir.join("big.log");
        let f = File::create(&big).unwrap();
        f.set_len(MAX_OPEN_BYTES + 1).unwrap();
        let err = read_regular_file(&s(&big), MAX_OPEN_BYTES)
            .unwrap_err()
            .message;
        assert!(err.contains("too large") && err.contains("256 MB"), "{err}");
        assert!(
            !err.contains("grew"),
            "refused by size, before reading: {err}"
        );
        // At the ceiling exactly, via a small ceiling.
        fs::write(dir.join("ten.md"), b"0123456789").unwrap();
        assert_eq!(
            read_regular_file(&s(&dir.join("ten.md")), 10)
                .unwrap()
                .len(),
            10
        );
        let err = read_regular_file(&s(&dir.join("ten.md")), 9).unwrap_err();
        assert_eq!(err.code, "refused");
        assert!(err.message.contains("too large"), "{}", err.message);
        // The opened handle is checked too: a FIFO that replaced the path after the path check.
        let opened = open_following(&pipe).unwrap();
        assert!(!opened.metadata().unwrap().is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn read_regular_file_still_follows_a_symlink_to_a_regular_file() {
        use std::os::unix::fs::symlink;
        let dir = scratch_dir("open-link");
        fs::write(dir.join("real.md"), b"# real\r\n\xff").unwrap();
        symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        let bytes =
            read_regular_file(&dir.join("link.md").to_string_lossy(), MAX_OPEN_BYTES).unwrap();
        assert_eq!(bytes, b"# real\r\n\xff");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The webview tells a missing file from a failed read by `code` alone: a folder whose name has
    /// "not found" in it must not make a read error look like a missing file.
    #[test]
    fn read_regular_file_says_what_failed_by_code() {
        let dir = scratch_dir("open-codes");
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let named = dir.join("not found");
        fs::create_dir_all(&named).unwrap();
        let err = read_regular_file(&s(&named.join("gone.md")), MAX_OPEN_BYTES).unwrap_err();
        assert_eq!(err.code, "not-found", "{}", err.message);
        assert_eq!(
            err.path.as_deref(),
            Some(s(&named.join("gone.md")).as_str())
        );
        let err = read_regular_file(&s(&named), MAX_OPEN_BYTES).unwrap_err();
        assert_eq!(err.code, "refused", "a folder: {}", err.message);
        fs::write(named.join("ten.md"), b"0123456789").unwrap();
        let err = read_regular_file(&s(&named.join("ten.md")), 9).unwrap_err();
        assert_eq!(err.code, "refused", "{}", err.message);
        assert!(
            err.message.contains("too large to open ("),
            "{}",
            err.message
        );
        assert_eq!(
            read_regular_file("relative.md", MAX_OPEN_BYTES)
                .unwrap_err()
                .code,
            "invalid"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
