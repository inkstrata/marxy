//! Content search over the files the webview passes. One IPC per query, std-only
//! reads, nothing indexed or written, no directory walked. The webview passes the index's own paths
//! (its ignore files, deny globs and extension allow-list already applied); this module re-checks
//! the floors it can check without a matcher: each path lies under one of the collection's roots,
//! no segment below the root is a built-in deny-listed directory, and nothing between the root and
//! the file is a symlink. `packages/core/src/index-model/content-search.ts` is the same search for
//! the memory shell; both pass `fixtures/content-search/cases.json`.

use std::collections::{HashMap, HashSet};
#[cfg(unix)]
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::ShellError;

/// Same numbers as `CONTENT_SEARCH_LIMITS` in `content-search.ts`.
pub const DEFAULT_LIMIT: usize = 200;
pub const DEFAULT_PER_FILE: usize = 5;
pub const MAX_LIMIT: usize = 10_000;
/// The app's open limit: a file the reader can open is a file it can search.
pub const MAX_FILE_BYTES: u64 = crate::commands::fs::MAX_OPEN_BYTES;
pub const BINARY_SNIFF_BYTES: usize = 8 * 1024;
pub const MAX_FILES: usize = 100_000;
/// Room for several of the biggest files; a search over a whole tree still ends.
pub const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_SECONDS: u64 = 15;
pub const PREVIEW_CHARS: usize = 160;
/// How much of a file is held at once.
pub const CHUNK_BYTES: usize = 4 * 1024 * 1024;

/// Which budget ended a search before it had looked at every path (a hit limit is not one).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stop {
    Bytes,
    Time,
    Files,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    pub path: String,
    pub line: u64,
    pub byte_offset: u64,
    pub preview: String,
    /// UTF-16 offsets in `preview`, as the webview indexes strings.
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<ContentHit>,
    pub scanned_files: u64,
    /// Allowed files not searched: binary, over the size limit, unreadable or gone.
    pub skipped_files: u64,
    pub truncated: bool,
    pub stopped: Option<Stop>,
}

/// A root as passed and as the filesystem resolves it.
struct Root {
    raw: PathBuf,
    canonical: PathBuf,
}

fn prepare_roots(roots: &[String]) -> Vec<Root> {
    roots
        .iter()
        .map(PathBuf::from)
        .filter(|raw| raw.is_absolute())
        .filter_map(|raw| {
            let canonical = dunce::canonicalize(&raw).ok()?;
            Some(Root { raw, canonical })
        })
        .collect()
}

/// A folder the deny list names, in any case, as `read_dir` and the tree watch judge one.
fn denied_segment(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(crate::commands::fs::denied_name)
}

/// No `.`, `..` or empty segment anywhere: `Path::components` would quietly drop a `.` and an
/// empty segment, so the string is checked as written, as `searchablePaths` checks it.
fn lexically_clean(path: &str) -> bool {
    let separators: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    let trimmed = path.trim_end_matches(separators);
    let mut segments = trimmed.split(separators);
    // The first segment is empty for `/a` and a drive (`C:`) on Windows.
    segments.next();
    segments.all(|s| !s.is_empty() && s != "." && s != "..")
}

/// Where the file may lie if it is what its spelling says: one path per root it is under (the root's canonical
/// path joined with the rest), or `None` when the path must not be read: not absolute, under no root, below a
/// deny-listed directory, or holding a `.` or `..`. The disk is not touched, so a path outside never reaches it.
fn expected_paths(path: &str, roots: &[Root]) -> Option<Vec<PathBuf>> {
    let p = Path::new(path);
    if !p.is_absolute() || !lexically_clean(path) {
        return None;
    }
    let mut candidates = Vec::new();
    for root in roots {
        let Ok(rel) = p.strip_prefix(&root.raw) else {
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        // The last part is the file read (only a regular file is), not a folder: a file named `build` is searched.
        let parts: Vec<Component> = rel.components().collect();
        let clean = parts.iter().enumerate().all(|(i, c)| {
            matches!(c, Component::Normal(name) if i + 1 == parts.len() || !denied_segment(name))
        });
        if !clean {
            return None;
        }
        candidates.push(root.canonical.join(rel));
    }
    (!candidates.is_empty()).then_some(candidates)
}

/// Paths opened, so a test can see that one outside the roots never was.
#[cfg(test)]
static OPENED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Opens `path` and judges the handle, not the name: it must be open on one of `expected`, so a link or junction
/// at the path or above it, swapped in since the spelling was judged, fails here. Windows asks the handle where it
/// is (`scope::handle_is`), as `read_head` does; nothing there can block on open, and a folder or device is refused
/// by the handle's own type.
#[cfg(not(unix))]
fn open_judged(path: &Path, expected: &[PathBuf]) -> Result<File, Refused> {
    let file = File::open(path).map_err(gone_or_refused)?;
    #[cfg(test)]
    OPENED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(path.to_owned());
    if expected.iter().any(|c| crate::scope::handle_is(&file, c)) {
        Ok(file)
    } else {
        Err(Refused::Skipped)
    }
}

/// Unix: the canonical path must be one of `expected` (a symlink in the path fails), it must be a regular file
/// before it is opened (opening a FIFO blocks until a writer appears, and a device never ends), and the path as
/// passed must still be this very file, by device and inode.
#[cfg(unix)]
fn open_judged(path: &Path, expected: &[PathBuf]) -> Result<File, Refused> {
    use std::os::unix::fs::MetadataExt;
    let canonical = dunce::canonicalize(path).map_err(|_| Refused::Gone)?;
    if !expected.contains(&canonical) {
        return Err(Refused::Skipped);
    }
    match fs::symlink_metadata(&canonical) {
        Ok(m) if m.file_type().is_file() => {}
        _ => return Err(Refused::Skipped),
    }
    let file = File::open(&canonical).map_err(gone_or_refused)?;
    #[cfg(test)]
    OPENED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(canonical.clone());
    let meta = file.metadata().map_err(|_| Refused::Skipped)?;
    match fs::symlink_metadata(path) {
        Ok(link)
            if !link.file_type().is_symlink()
                && link.dev() == meta.dev()
                && link.ino() == meta.ino() =>
        {
            Ok(file)
        }
        _ => Err(Refused::Skipped),
    }
}

/// Why a path was not opened: a file that is gone is not counted as skipped, one that is refused is.
#[derive(Debug, PartialEq, Eq)]
enum Refused {
    Gone,
    Skipped,
}

fn gone_or_refused(e: std::io::Error) -> Refused {
    if e.kind() == std::io::ErrorKind::NotFound {
        Refused::Gone
    } else {
        Refused::Skipped
    }
}

/// The opened file and its size when it is a regular file of at most `MAX_FILE_BYTES` that the path judges
/// to be the one in scope.
fn open_candidate(path: &Path, expected: &[PathBuf]) -> Result<(File, u64), Refused> {
    let file = open_judged(path, expected)?;
    let meta = file.metadata().map_err(|_| Refused::Skipped)?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(Refused::Skipped);
    }
    Ok((file, meta.len()))
}

/// Smart case: any uppercase character means exact bytes.
pub fn is_case_sensitive(query: &str) -> bool {
    query.chars().any(char::is_uppercase)
}

/// Finds `needle` in `hay` from `from`. Valid UTF-8 (nearly every text file) takes std's two-way
/// string search; anything else a first-byte scan. Matches are byte for byte either way.
fn find_in(hay: &[u8], text: Option<&str>, needle: &str, from: usize) -> Option<usize> {
    if from > hay.len() {
        return None;
    }
    if let Some(text) = text {
        // A match starts on a character boundary, so a `from` inside a character moves on.
        let mut from = from;
        while !text.is_char_boundary(from) {
            from += 1;
        }
        return text[from..].find(needle).map(|i| i + from);
    }
    let needle = needle.as_bytes();
    let first = needle[0];
    let last = hay.len().checked_sub(needle.len())?;
    let mut i = from;
    while i <= last {
        let step = hay[i..=last].iter().position(|&b| b == first)?;
        i += step;
        if &hay[i..i + needle.len()] == needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// `find_in` for a case-insensitive query: `needle` is already ASCII-lowercased, and the haystack is compared with
/// ASCII folding as it is scanned, so no lowered copy of the chunk is made. Bytes above 127 match exactly, which is
/// what comparing against a lowered copy did.
fn find_folded(hay: &[u8], needle: &str, from: usize) -> Option<usize> {
    let needle = needle.as_bytes();
    let first = needle[0];
    let upper = first.to_ascii_uppercase();
    let rest = &needle[1..];
    let last = hay.len().checked_sub(needle.len())?;
    let mut i = from;
    while i <= last {
        let step = if first == upper {
            hay[i..=last].iter().position(|&b| b == first)?
        } else {
            hay[i..=last]
                .iter()
                .position(|&b| b == first || b == upper)?
        };
        i += step;
        if hay[i + 1..i + needle.len()].eq_ignore_ascii_case(rest) {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn is_continuation(b: u8) -> bool {
    b & 0xc0 == 0x80
}

fn chars(bytes: &[u8]) -> Vec<char> {
    String::from_utf8_lossy(bytes)
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn utf16_len(cs: &[char]) -> u32 {
    cs.iter().map(|c| c.len_utf16() as u32).sum()
}

/// How far a preview looks either side of a match.
const PREVIEW_WINDOW: usize = PREVIEW_CHARS * 4;

/// The preview for a match at `[ms, me)`: the line, without its line break, cut on character
/// boundaries to at most `PREVIEW_CHARS` characters with the match kept whole when it fits. `hay` may
/// be a slice of the file reaching `PREVIEW_WINDOW` and a few bytes either side of the match;
/// `file_start` says it begins at the file's first byte, where a byte-order mark is skipped.
fn preview(hay: &[u8], ms: usize, me: usize, file_start: bool) -> (String, u32, u32) {
    let mut line_start = hay[..ms]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    if line_start == 0 && file_start {
        while line_start + 3 <= ms && hay[line_start..line_start + 3] == [0xef, 0xbb, 0xbf] {
            line_start += 3;
        }
    }
    let mut line_end = hay[me..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(hay.len(), |i| i + me);
    if line_end > me && hay[line_end - 1] == b'\r' {
        line_end -= 1;
    }
    let window = PREVIEW_WINDOW;
    let mut ws = line_start.max(ms.saturating_sub(window));
    while ws < ms && is_continuation(hay[ws]) {
        ws += 1;
    }
    let mut we = line_end.min(me + window);
    while we > me && we < line_end && is_continuation(hay[we]) {
        we -= 1;
    }
    let before = chars(&hay[ws..ms]);
    let matched = chars(&hay[ms..me]);
    let after = chars(&hay[me..we]);
    let (kept_before, kept_match, kept_after): (&[char], &[char], &[char]) =
        if before.len() + matched.len() + after.len() <= PREVIEW_CHARS {
            (&before, &matched, &after)
        } else if matched.len() >= PREVIEW_CHARS {
            (&[], &matched[..PREVIEW_CHARS], &[])
        } else {
            let room = PREVIEW_CHARS - matched.len();
            let n_after = after.len().min(room - before.len().min(room / 2));
            let n_before = before.len().min(room - n_after);
            (
                &before[before.len() - n_before..],
                &matched,
                &after[..n_after],
            )
        };
    let start = utf16_len(kept_before);
    let end = start + utf16_len(kept_match);
    let text: String = kept_before
        .iter()
        .chain(kept_match)
        .chain(kept_after)
        .collect();
    (text, start, end)
}

/// What the search holds that does not change between files.
struct Plan<'a> {
    /// Lowercased (ASCII) when the query is case-insensitive.
    needle: &'a str,
    /// Compare with ASCII folding (`find_folded`) instead of exactly.
    fold: bool,
    limit: usize,
    per_file: usize,
    chunk: usize,
    deadline: Instant,
    cancelled: &'a AtomicBool,
    /// Set once the search's outcome is settled, so a file still being read ahead stops at its next chunk.
    settled: &'a AtomicBool,
}

/// Why one file's scan ended.
#[derive(Debug, PartialEq, Eq)]
enum FileEnd {
    /// Every byte was looked at, or the file stopped being readable.
    Done,
    /// A NUL in the first 8 KB, or the first chunk could not be read: the file is skipped.
    Unreadable,
    /// The file has more hits than `per_file` allows.
    PerFile,
    /// `limit` hits are in and another was found.
    Limit,
    Cancelled,
    Time,
}

/// The preview of the match at file offset `at`, from the chunk in `buf` (which begins at `base`) when
/// it holds the whole window around the match, else from the file.
fn preview_at(
    file: &mut File,
    buf: &[u8],
    base: u64,
    at: u64,
    n: usize,
    len: u64,
    moved: &mut bool,
) -> (String, u32, u32) {
    let pad = (PREVIEW_WINDOW + 4) as u64;
    let start = at.saturating_sub(pad);
    let end = len.min(at + n as u64 + pad);
    if start >= base && end <= base + buf.len() as u64 {
        let slice = &buf[(start - base) as usize..(end - base) as usize];
        let ms = (at - start) as usize;
        return preview(slice, ms, ms + n, start == 0);
    }
    let mut ctx = vec![0u8; (end - start) as usize];
    *moved = true;
    let read = file.seek(SeekFrom::Start(start)).is_ok() && file.read_exact(&mut ctx).is_ok();
    if !read {
        ctx.clear();
        ctx.extend_from_slice(&buf[(at - base) as usize..(at - base) as usize + n]);
        return preview(&ctx, 0, n, false);
    }
    let ms = (at - start) as usize;
    preview(&ctx, ms, ms + n, start == 0)
}

/// Scans a file of `len` bytes in chunks of about `plan.chunk`. Each chunk starts `needle.len() - 1`
/// bytes before the last one's searched end, so a match across an edge is whole in the next chunk, and
/// the next search starts after the last match, so none is found twice. A UTF-8 chunk is cut back to a
/// character boundary so std's string search can run on it. Offsets, line numbers and previews are
/// those of the whole file. The first chunk is also the binary sniff (it always covers the first 8 KB),
/// so a file is read once.
fn scan_file(
    file: &mut File,
    len: u64,
    path: &str,
    plan: &Plan,
    out: &mut SearchOutcome,
) -> FileEnd {
    let n = plan.needle.len();
    let mut buf: Vec<u8> = Vec::new();
    let mut base = 0u64;
    let mut line = 1u64;
    let mut line_pos = 0u64;
    let mut next_from = 0u64;
    let mut in_file = 0usize;
    // `preview_at` may seek away from the chunk; the next chunk then seeks back.
    let mut moved = false;
    loop {
        if plan.cancelled.load(Ordering::Relaxed) || plan.settled.load(Ordering::Relaxed) {
            return FileEnd::Cancelled;
        }
        if Instant::now() >= plan.deadline {
            return FileEnd::Time;
        }
        let first_chunk = base == 0;
        let mut want = (len - base).min((plan.chunk + n) as u64) as usize;
        if first_chunk {
            want = want.max((len as usize).min(BINARY_SNIFF_BYTES));
        }
        buf.resize(want, 0);
        // A new file is already at its start.
        let read = (first_chunk && !moved || file.seek(SeekFrom::Start(base)).is_ok())
            && file.read_exact(&mut buf).is_ok();
        if !read {
            return if first_chunk {
                FileEnd::Unreadable
            } else {
                FileEnd::Done
            };
        }
        if first_chunk && buf[..buf.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
            return FileEnd::Unreadable;
        }
        let at_end = base + want as u64 >= len;
        let hay_all: &[u8] = &buf;
        // A match never starts on a continuation byte, so a chunk that begins inside a character
        // can leave those bytes out and still be valid UTF-8.
        let lead = hay_all
            .iter()
            .take(3)
            .take_while(|&&b| is_continuation(b))
            .count();
        let (text, searched) = match std::str::from_utf8(&hay_all[lead..]) {
            Ok(t) => (Some(t), want),
            // Only the last character was cut by the chunk's end: search the rest as text.
            Err(e) if e.error_len().is_none() && !at_end => {
                let valid = e.valid_up_to();
                (
                    std::str::from_utf8(&hay_all[lead..lead + valid]).ok(),
                    lead + valid,
                )
            }
            Err(_) => (None, want),
        };
        let hay = &hay_all[lead..searched];
        let hay_base = base + lead as u64;
        let mut from = (next_from.max(hay_base) - hay_base) as usize;
        loop {
            let found = if plan.fold {
                find_folded(hay, plan.needle, from)
            } else {
                find_in(hay, text, plan.needle, from)
            };
            let Some(found) = found else {
                break;
            };
            if out.hits.len() >= plan.limit {
                return FileEnd::Limit;
            }
            if in_file >= plan.per_file {
                return FileEnd::PerFile;
            }
            let idx = lead + found;
            let at = base + idx as u64;
            let counted = (line_pos - base) as usize;
            line += buf[counted..idx].iter().filter(|&&b| b == b'\n').count() as u64;
            line_pos = at;
            let (preview, match_start, match_end) =
                preview_at(file, &buf, base, at, n, len, &mut moved);
            out.hits.push(ContentHit {
                path: path.to_owned(),
                line,
                byte_offset: at,
                preview,
                match_start,
                match_end,
            });
            in_file += 1;
            next_from = at + n as u64;
            from = found + n;
        }
        if at_end {
            return FileEnd::Done;
        }
        let new_base = (base + searched as u64)
            .saturating_sub(n as u64 - 1)
            .max(base + 1);
        // Lines in the part dropped from the buffer still count.
        let counted = (line_pos - base) as usize;
        let dropped = (new_base - base) as usize;
        if counted < dropped {
            line += buf[counted..dropped]
                .iter()
                .filter(|&&b| b == b'\n')
                .count() as u64;
            line_pos = new_base;
        }
        base = new_base;
    }
}

/// The search itself, shell-free so tests call it directly. `cancelled` is polled between chunks.
pub fn search(
    paths: &[String],
    query: &str,
    roots: &[String],
    limit: Option<usize>,
    per_file: Option<usize>,
    cancelled: &AtomicBool,
) -> SearchOutcome {
    search_chunked(
        paths,
        query,
        roots,
        limit,
        per_file,
        cancelled,
        Tuning {
            chunk: CHUNK_BYTES,
            budget: Duration::from_secs(MAX_SECONDS),
            workers: default_workers(),
        },
    )
}

/// Reading is disk-bound past a few threads, so more only add contention.
const MAX_WORKERS: usize = 8;

fn default_workers() -> usize {
    thread::available_parallelism().map_or(1, |n| n.get().min(MAX_WORKERS))
}

/// The chunk size, time budget and worker count, which tests set.
struct Tuning {
    chunk: usize,
    budget: Duration,
    workers: usize,
}

/// What looking at one path found, before the paths' results are put in order.
enum Slot {
    /// Refused by spelling: counted nowhere.
    Skip,
    /// Binary, too big, unreadable, gone or swapped: counted in `skipped_files`.
    Unreadable,
    Cancelled,
    /// The time budget had run out before the file was opened.
    TimeUp,
    Scanned {
        len: u64,
        /// At most the file's own `per_file` and `limit`, in file order.
        hits: Vec<ContentHit>,
        end: FileEnd,
    },
}

/// Opens and scans one path with nothing but the plan to go on, so any worker can take any path.
fn examine(path: &str, roots: &[Root], plan: &Plan) -> Slot {
    if plan.cancelled.load(Ordering::Relaxed) {
        return Slot::Cancelled;
    }
    let Some(expected) = expected_paths(path, roots) else {
        return Slot::Skip;
    };
    if Instant::now() >= plan.deadline {
        return Slot::TimeUp;
    }
    let (mut file, len) = match open_candidate(Path::new(path), &expected) {
        Ok(opened) => opened,
        Err(Refused::Gone) => return Slot::Skip,
        Err(Refused::Skipped) => return Slot::Unreadable,
    };
    let mut own = SearchOutcome::default();
    match scan_file(&mut file, len, path, plan, &mut own) {
        FileEnd::Unreadable => Slot::Unreadable,
        end => Slot::Scanned {
            len,
            hits: own.hits,
            end,
        },
    }
}

/// Takes the paths' results in input order, whenever they arrive, and says when the search is over. Every limit
/// is applied here, on the ordered prefix, so the outcome is what a loop over the paths would give: a file read
/// ahead of an earlier one that ends the search is dropped, and a budget counts only the files before it ran out.
struct Merge {
    slots: Vec<Option<Slot>>,
    next: usize,
    out: SearchOutcome,
    /// Bytes of the files taken so far.
    total: u64,
    done: bool,
}

impl Merge {
    fn advance(&mut self, plan: &Plan) {
        while !self.done && self.next < self.slots.len() {
            let Some(slot) = self.slots[self.next].take() else {
                break;
            };
            self.next += 1;
            self.take(slot, plan);
        }
    }

    fn end(&mut self, stopped: Option<Stop>) {
        self.out.truncated = true;
        if stopped.is_some() {
            self.out.stopped = stopped;
        }
        self.done = true;
    }

    fn take(&mut self, slot: Slot, plan: &Plan) {
        match slot {
            Slot::Skip => {}
            Slot::Unreadable => self.out.skipped_files += 1,
            Slot::Cancelled => self.end(None),
            Slot::TimeUp => self.end(Some(Stop::Time)),
            Slot::Scanned { len, hits, end } => {
                if len > MAX_TOTAL_BYTES.saturating_sub(self.total) {
                    return self.end(Some(Stop::Bytes));
                }
                self.total += len;
                self.out.scanned_files += 1;
                let room = plan.limit.saturating_sub(self.out.hits.len());
                let over = hits.len() > room;
                self.out.hits.extend(hits.into_iter().take(room));
                if over {
                    return self.end(None);
                }
                let full = self.out.hits.len() >= plan.limit;
                match end {
                    FileEnd::Done | FileEnd::Unreadable => {}
                    // The file had a further match: the limit ends the search, `per_file` only the file.
                    FileEnd::PerFile | FileEnd::Limit if full => self.end(None),
                    FileEnd::PerFile | FileEnd::Limit => self.out.truncated = true,
                    FileEnd::Cancelled => self.end(None),
                    FileEnd::Time => self.end(Some(Stop::Time)),
                }
            }
        }
    }
}

/// Searches with `tuning.workers` threads that take paths by an atomic index. The outcome does not depend on how
/// the threads interleave (apart from where a time budget or a cancel falls): see `Merge`. Budgets: the time budget
/// is one deadline for the whole search, and a file in progress when it passes stops at its next chunk; the byte
/// budget is spent in input order by the files `Merge` takes, not by what the threads happened to read.
fn search_chunked(
    paths: &[String],
    query: &str,
    roots: &[String],
    limit: Option<usize>,
    per_file: Option<usize>,
    cancelled: &AtomicBool,
    tuning: Tuning,
) -> SearchOutcome {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let per_file = per_file.unwrap_or(DEFAULT_PER_FILE);
    if query.is_empty() || query.contains(['\n', '\r']) {
        return SearchOutcome::default();
    }
    let fold = !is_case_sensitive(query);
    let needle = if fold {
        query.to_ascii_lowercase()
    } else {
        query.to_owned()
    };
    let stop = AtomicBool::new(false);
    let plan = Plan {
        needle: &needle,
        fold,
        limit,
        per_file,
        chunk: tuning.chunk.max(needle.len() + 4),
        deadline: Instant::now() + tuning.budget,
        cancelled,
        settled: &stop,
    };
    let roots = prepare_roots(roots);
    let mut seen = HashSet::new();
    let unique: Vec<&str> = paths
        .iter()
        .map(String::as_str)
        .filter(|p| seen.insert(*p))
        .collect();
    let n = unique.len().min(MAX_FILES);
    let merge = Mutex::new(Merge {
        slots: (0..n).map(|_| None).collect(),
        next: 0,
        out: SearchOutcome::default(),
        total: 0,
        done: false,
    });
    let cursor = AtomicUsize::new(0);
    let work = || {
        while !stop.load(Ordering::Relaxed) {
            let i = cursor.fetch_add(1, Ordering::Relaxed);
            if i >= n {
                break;
            }
            let slot = examine(unique[i], &roots, &plan);
            let mut m = merge.lock().unwrap_or_else(PoisonError::into_inner);
            m.slots[i] = Some(slot);
            m.advance(&plan);
            if m.done {
                stop.store(true, Ordering::Relaxed);
            }
        }
    };
    let workers = tuning.workers.clamp(1, n.max(1));
    if workers == 1 {
        work();
    } else {
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(work);
            }
        });
    }
    let mut m = merge.into_inner().unwrap_or_else(PoisonError::into_inner);
    if !m.done && unique.len() > MAX_FILES {
        m.end(Some(Stop::Files));
    }
    m.out
}

/// The searches running now, by the webview's token, so `cancel_content_search` can stop one.
fn running() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Searches `paths` for `query` off the main thread. `token` names this search for
/// `cancel_content_search`; the webview gives each search its own.
#[tauri::command]
pub async fn search_content(
    paths: Vec<String>,
    query: String,
    roots: Vec<String>,
    limit: Option<usize>,
    per_file: Option<usize>,
    token: u64,
) -> Result<SearchOutcome, ShellError> {
    for p in paths.iter().chain(roots.iter()) {
        super::fs::absolute(p)?;
    }

    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = running().lock() {
        map.insert(token, flag.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Only roots in scope are searched; a file under none of them is skipped, as one outside every root always was.
        let roots: Vec<String> = roots
            .into_iter()
            .filter(|r| crate::scope::admit(r, crate::scope::Need::Read).is_ok())
            .collect();
        search(&paths, &query, &roots, limit, per_file, &flag)
    })
    .await;
    if let Ok(mut map) = running().lock() {
        map.remove(&token);
    }
    result.map_err(|e| ShellError::io("", e.to_string()))
}

/// Stops the search with this token at its next file; a token not running is ignored.
#[tauri::command]
pub fn cancel_content_search(token: u64) {
    if let Ok(map) = running().lock() {
        if let Some(flag) = map.get(&token) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::time::Instant;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("marxy-search-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("tmpdir");
            // The temp directory may itself sit behind a symlink (/tmp on macOS); roots are canonical.
            Self(dunce::canonicalize(&dir).expect("canonical tmpdir"))
        }

        fn write(&self, rel: &str, bytes: &[u8]) -> String {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).expect("parent");
            fs::write(&path, bytes).expect("write");
            path.to_string_lossy().into_owned()
        }

        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run(dir: &TempDir, paths: &[String], query: &str) -> SearchOutcome {
        search(
            paths,
            query,
            &[dir.root()],
            None,
            None,
            &AtomicBool::new(false),
        )
    }

    #[test]
    fn crlf_lines_are_numbered_by_their_line_feeds_and_the_preview_drops_the_return() {
        let dir = TempDir::new("crlf");
        let p = dir.write("a.md", b"one\r\ntwo\r\nthree needle\r\nfour");
        let got = run(&dir, std::slice::from_ref(&p), "needle");
        assert_eq!(got.hits.len(), 1);
        assert_eq!(got.hits[0].line, 3);
        assert_eq!(got.hits[0].byte_offset, 16);
        assert_eq!(got.hits[0].preview, "three needle");
    }

    #[test]
    fn a_multibyte_character_before_the_match_counts_its_bytes_and_one_utf16_unit() {
        let dir = TempDir::new("multibyte");
        let p = dir.write("a.md", "café needle".as_bytes());
        let got = run(&dir, std::slice::from_ref(&p), "needle");
        assert_eq!(got.hits[0].byte_offset, 6);
        assert_eq!((got.hits[0].match_start, got.hits[0].match_end), (5, 11));
    }

    #[test]
    fn smart_case_both_ways() {
        let dir = TempDir::new("case");
        let p = dir.write("a.md", b"Needle needle NEEDLE");
        let lower = run(&dir, std::slice::from_ref(&p), "needle");
        let offsets: Vec<u64> = lower.hits.iter().map(|h| h.byte_offset).collect();
        assert_eq!(offsets, vec![0, 7, 14]);
        let exact = run(&dir, std::slice::from_ref(&p), "Needle");
        let offsets: Vec<u64> = exact.hits.iter().map(|h| h.byte_offset).collect();
        assert_eq!(offsets, vec![0]);
    }

    #[test]
    fn a_bom_prefixed_file_counts_the_bom_in_the_offset_and_not_in_the_preview() {
        let dir = TempDir::new("bom");
        let p = dir.write("a.md", b"\xef\xbb\xbfneedle");
        let got = run(&dir, std::slice::from_ref(&p), "needle");
        assert_eq!(got.hits[0].byte_offset, 3);
        assert_eq!(got.hits[0].preview, "needle");
    }

    #[test]
    fn binary_files_are_skipped_and_counted() {
        let dir = TempDir::new("skip");
        let bin = dir.write("bin.md", b"needle\0needle");
        let ok = dir.write("ok.md", b"needle");
        let got = run(&dir, &[bin, ok.clone()], "needle");
        assert_eq!((got.scanned_files, got.skipped_files), (1, 1));
        assert_eq!(got.hits.len(), 1);
        assert_eq!(got.hits[0].path, ok);
    }

    #[test]
    fn a_file_over_the_open_limit_is_skipped_and_one_at_it_is_not() {
        let dir = TempDir::new("limit");
        let over = dir.write("over.md", b"needle");
        let at = dir.write("at.md", b"needle");
        // Extended with zeros: no NUL check is reached for the first, and the second's first 8 KB are text.
        File::options()
            .write(true)
            .open(&over)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        let mut head = fs::read(&at).unwrap();
        head.resize(8 * 1024, b'x');
        fs::write(&at, &head).unwrap();
        File::options()
            .write(true)
            .open(&at)
            .unwrap()
            .set_len(MAX_FILE_BYTES)
            .unwrap();
        let got = search(
            &[over, at.clone()],
            "needle",
            &[dir.root()],
            None,
            None,
            &AtomicBool::new(false),
        );
        assert_eq!((got.scanned_files, got.skipped_files), (1, 1));
        assert_eq!(got.hits.len(), 1);
        assert_eq!(got.hits[0].path, at);
        assert_eq!(got.hits[0].byte_offset, 0);
    }

    #[test]
    fn a_utf16_file_is_binary_at_any_size() {
        let dir = TempDir::new("utf16");
        let mut bytes = vec![0xff, 0xfe];
        for c in "a needle in utf16".encode_utf16() {
            bytes.extend_from_slice(&c.to_le_bytes());
        }
        let small = dir.write("small.txt", &bytes);
        let mut big = bytes.clone();
        big.resize(CHUNK_BYTES * 2 + 100, 0);
        let big = dir.write("big.txt", &big);
        let got = run(&dir, &[small, big], "needle");
        assert_eq!(
            (got.hits.len(), got.scanned_files, got.skipped_files),
            (0, 0, 2)
        );
    }

    /// The whole-file search this module did before it read in chunks, kept as the yardstick.
    fn reference(paths: &[String], query: &str, roots: &[String]) -> SearchOutcome {
        let mut out = SearchOutcome::default();
        let fold = !is_case_sensitive(query);
        let needle = if fold {
            query.to_ascii_lowercase()
        } else {
            query.to_owned()
        };
        let roots = prepare_roots(roots);
        for path in paths {
            let Some(expected) = expected_paths(path, &roots) else {
                continue;
            };
            let bytes = fs::read(&expected[0]).unwrap();
            if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
                continue;
            }
            out.scanned_files += 1;
            let hay: Vec<u8> = if fold {
                bytes.iter().map(u8::to_ascii_lowercase).collect()
            } else {
                bytes.clone()
            };
            let text = std::str::from_utf8(&hay).ok();
            let (mut line, mut counted, mut from, mut in_file) = (1u64, 0usize, 0usize, 0usize);
            while let Some(at) = find_in(&hay, text, &needle, from) {
                if in_file >= DEFAULT_PER_FILE {
                    out.truncated = true;
                    break;
                }
                line += hay[counted..at].iter().filter(|&&b| b == b'\n').count() as u64;
                counted = at;
                let me = at + needle.len();
                let (preview, match_start, match_end) = preview(&bytes, at, me, true);
                out.hits.push(ContentHit {
                    path: path.clone(),
                    line,
                    byte_offset: at as u64,
                    preview,
                    match_start,
                    match_end,
                });
                in_file += 1;
                from = me;
            }
        }
        out
    }

    fn same(a: &SearchOutcome, b: &SearchOutcome, what: &str) {
        assert_eq!(a.hits, b.hits, "{what}: hits");
        assert_eq!(a.scanned_files, b.scanned_files, "{what}: scanned");
        assert_eq!(a.truncated, b.truncated, "{what}: truncated");
    }

    fn mixed_corpus(dir: &TempDir) -> Vec<String> {
        let long = format!("{}needle{}\n", "é".repeat(300), "€".repeat(300));
        let mut files: Vec<(&str, Vec<u8>)> = vec![
            ("lf.md", b"one\ntwo needle\nthree Needle NEEDLE\n".to_vec()),
            ("crlf.md", b"one\r\ntwo\r\nthree needle\r\nfour".to_vec()),
            (
                "bom.md",
                b"\xef\xbb\xbfneedle at the start\nneedle".to_vec(),
            ),
            (
                "multi.md",
                "café needle ☕ needle 😀needle\nneedle😀"
                    .as_bytes()
                    .to_vec(),
            ),
            (
                "latin1.txt",
                b"caf\xe9 needle \xe9needle\xe9 \xff\xfeneedle".to_vec(),
            ),
            ("long.md", long.into_bytes()),
            ("empty.md", Vec::new()),
            ("tail.md", b"ends on a needle".to_vec()),
            (
                "many.md",
                b"needle needle needle needle needle needle needle".to_vec(),
            ),
            ("none.md", b"nothing here at all".to_vec()),
            ("bin.md", b"needle\0needle".to_vec()),
            ("ctrl.md", b"a\tneedle\x07b\x1bc needle".to_vec()),
        ];
        // A file that puts a match on every possible offset of a chunk edge.
        let mut dense = Vec::new();
        for i in 0..400 {
            dense.extend_from_slice(format!("row {i} é€😀 needle x\n").as_bytes());
        }
        files.push(("dense.md", dense));
        files
            .into_iter()
            .map(|(name, bytes)| dir.write(name, &bytes))
            .collect()
    }

    #[test]
    fn chunked_results_equal_the_whole_file_results_for_every_chunk_size() {
        let dir = TempDir::new("mixed");
        let paths = mixed_corpus(&dir);
        let roots = [dir.root()];
        let flag = AtomicBool::new(false);
        for query in [
            "needle", "Needle", "é", "€", "😀n", "e\u{301}", "x", "row 39", "\u{ff}",
        ] {
            let want = reference(&paths, query, &roots);
            for chunk in (1..=70).chain([128, 1000, CHUNK_BYTES]) {
                let got = search_chunked(
                    &paths,
                    query,
                    &roots,
                    None,
                    None,
                    &flag,
                    Tuning {
                        chunk,
                        budget: Duration::from_secs(MAX_SECONDS),
                        workers: 1,
                    },
                );
                same(&got, &want, &format!("query {query:?}, chunk {chunk}"));
            }
        }
    }

    #[test]
    fn a_hit_near_the_end_of_a_40_mb_file_is_found_with_its_line_and_offset() {
        let dir = TempDir::new("forty");
        let line = b"the quick brown fox jumps over the lazy dog\n";
        let mut bytes = Vec::with_capacity(40 * 1024 * 1024 + 64);
        while bytes.len() < 40 * 1024 * 1024 {
            bytes.extend_from_slice(line);
        }
        let lines_before = bytes.iter().filter(|&&b| b == b'\n').count() as u64;
        let at = bytes.len() as u64 + 7;
        bytes.extend_from_slice(b"before needle after\n");
        let p = dir.write("big.log", &bytes);
        let got = run(&dir, &[p], "needle");
        assert_eq!(got.hits.len(), 1);
        assert_eq!(got.hits[0].byte_offset, at);
        assert_eq!(got.hits[0].line, lines_before + 1);
        assert_eq!(got.hits[0].preview, "before needle after");
        assert_eq!(
            (got.scanned_files, got.skipped_files, got.truncated),
            (1, 0, false)
        );
    }

    #[test]
    fn a_hit_straddling_a_chunk_edge_of_a_big_file_is_found_once() {
        let dir = TempDir::new("edge");
        let n = "needle".len();
        let mut starts = Vec::new();
        for edge in [CHUNK_BYTES, CHUNK_BYTES + n, 2 * CHUNK_BYTES + n] {
            for back in [1usize, 3, 5] {
                starts.push(edge - back);
            }
        }
        starts.sort_unstable();
        let mut bytes = vec![b'a'; 3 * CHUNK_BYTES];
        let mut want = Vec::new();
        let mut last_end = 0;
        for s in starts {
            if s < last_end {
                continue;
            }
            bytes[s..s + n].copy_from_slice(b"needle");
            want.push(s as u64);
            last_end = s + n;
        }
        let p = dir.write("big.txt", &bytes);
        let got = search(
            std::slice::from_ref(&p),
            "needle",
            &[dir.root()],
            Some(100),
            Some(100),
            &AtomicBool::new(false),
        );
        let found: Vec<u64> = got.hits.iter().map(|h| h.byte_offset).collect();
        assert_eq!(found, want);
        assert!(got.hits.iter().all(|h| h.line == 1));
    }

    #[test]
    fn a_multibyte_character_split_by_a_chunk_edge_still_matches() {
        let dir = TempDir::new("split");
        // Every alignment of a 3-byte character against the first edge.
        for pad in 0..4usize {
            let mut bytes = "a".repeat(CHUNK_BYTES - 2 + pad).into_bytes();
            bytes.extend_from_slice("€€ needle €€".as_bytes());
            let p = dir.write(&format!("c{pad}.md"), &bytes);
            let got = run(&dir, std::slice::from_ref(&p), "€ needle €");
            assert_eq!(got.hits.len(), 1, "pad {pad}");
            assert_eq!(got.hits[0].byte_offset, (CHUNK_BYTES - 2 + pad + 3) as u64);
        }
    }

    #[test]
    fn a_search_over_its_time_budget_says_so() {
        let dir = TempDir::new("time");
        let p = dir.write("a.md", b"needle");
        let got = search_chunked(
            &[p],
            "needle",
            &[dir.root()],
            None,
            None,
            &AtomicBool::new(false),
            Tuning {
                chunk: CHUNK_BYTES,
                budget: Duration::ZERO,
                workers: 1,
            },
        );
        assert_eq!(
            (got.hits.len(), got.truncated, got.stopped),
            (0, true, Some(Stop::Time))
        );
    }

    #[test]
    fn a_hit_limit_is_truncated_without_a_stop() {
        let dir = TempDir::new("nostop");
        let p = dir.write("a.md", b"n n n n");
        let got = search(
            &[p],
            "n",
            &[dir.root()],
            Some(2),
            Some(10),
            &AtomicBool::new(false),
        );
        assert_eq!(
            (got.hits.len(), got.truncated, got.stopped),
            (2, true, None)
        );
    }

    #[test]
    fn per_file_and_limit_are_respected_and_say_truncated() {
        let dir = TempDir::new("caps");
        let a = dir.write("a.md", b"n n n n");
        let b = dir.write("b.md", b"n n");
        let roots = [dir.root()];
        let flag = AtomicBool::new(false);
        let per = search(std::slice::from_ref(&a), "n", &roots, None, Some(3), &flag);
        assert_eq!((per.hits.len(), per.truncated), (3, true));
        let exact = search(std::slice::from_ref(&a), "n", &roots, None, Some(4), &flag);
        assert_eq!((exact.hits.len(), exact.truncated), (4, false));
        let lim = search(&[a.clone(), b.clone()], "n", &roots, Some(5), None, &flag);
        assert_eq!((lim.hits.len(), lim.truncated), (5, true));
        let all = search(&[a, b], "n", &roots, Some(6), None, &flag);
        assert_eq!((all.hits.len(), all.truncated), (6, false));
    }

    #[test]
    fn a_missing_path_or_a_directory_is_skipped() {
        let dir = TempDir::new("missing");
        let p = dir.write("a.md", b"needle");
        let gone = format!("{}/gone.md", dir.root());
        let sub = dir.write("sub/x.md", b"x");
        let sub_dir = Path::new(&sub)
            .parent()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let got = run(&dir, &[gone, sub_dir, p], "needle");
        assert_eq!((got.hits.len(), got.scanned_files), (1, 1));
    }

    #[test]
    fn a_cancelled_search_stops_before_the_next_file() {
        let dir = TempDir::new("cancel");
        let p = dir.write("a.md", b"needle");
        let got = search(
            &[p],
            "needle",
            &[dir.root()],
            None,
            None,
            &AtomicBool::new(true),
        );
        assert_eq!(
            (got.hits.len(), got.scanned_files, got.truncated),
            (0, 0, true)
        );
    }

    #[test]
    fn cancel_reaches_only_a_running_token() {
        let flag = Arc::new(AtomicBool::new(false));
        running().lock().unwrap().insert(7_000_001, flag.clone());
        cancel_content_search(7_000_002);
        assert!(!flag.load(Ordering::Relaxed));
        cancel_content_search(7_000_001);
        assert!(flag.load(Ordering::Relaxed));
        running().lock().unwrap().remove(&7_000_001);
    }

    // Privacy: what the index would never hold is never read, even when passed.

    #[test]
    fn a_file_outside_every_root_or_a_relative_path_is_never_read() {
        let dir = TempDir::new("outside");
        let inside = dir.write("root/a.md", b"secret");
        let outside = dir.write("elsewhere/b.md", b"secret");
        let sibling = dir.write("root2/c.md", b"secret");
        let dotdot = format!("{}/root/../elsewhere/b.md", dir.root());
        let roots = [format!("{}/root", dir.root())];
        let got = search(
            &[
                outside,
                sibling,
                dotdot,
                "elsewhere/b.md".into(),
                inside.clone(),
            ],
            "secret",
            &roots,
            None,
            None,
            &AtomicBool::new(false),
        );
        assert_eq!(got.scanned_files, 1);
        let paths: Vec<&str> = got.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec![inside.as_str()]);
    }

    #[test]
    fn a_file_under_a_deny_listed_directory_is_never_read() {
        let dir = TempDir::new("deny");
        let nm = dir.write("node_modules/pkg/readme.md", b"secret");
        let git = dir.write(".git/config", b"secret");
        let deep = dir.write("a/target/b.md", b"secret");
        let ok = dir.write("a/b.md", b"secret");
        let got = run(&dir, &[nm, git, deep, ok.clone()], "secret");
        let paths: Vec<&str> = got.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec![ok.as_str()]);
        assert_eq!(got.scanned_files, 1);
    }

    #[test]
    fn a_denied_name_in_any_case_is_never_read() {
        let dir = TempDir::new("deny-case");
        let build = dir.write("Build/notes.md", b"secret");
        let nm = dir.write("a/Node_Modules/x.md", b"secret");
        let ok = dir.write("a/b.md", b"secret");
        let got = run(&dir, &[build, nm, ok.clone()], "secret");
        let paths: Vec<&str> = got.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec![ok.as_str()]);
    }

    /// the list names folders; a file called `build` or `Out` is searched like any other.
    #[test]
    fn a_file_named_like_a_denied_folder_is_read() {
        let dir = TempDir::new("deny-file");
        let build = dir.write("scripts/build", b"secret");
        let out = dir.write("notes/Out", b"secret");
        let under = dir.write("out/x.md", b"secret");
        let got = run(&dir, &[build.clone(), out.clone(), under], "secret");
        let mut paths: Vec<&str> = got.hits.iter().map(|h| h.path.as_str()).collect();
        paths.sort_unstable();
        let mut want = vec![build.as_str(), out.as_str()];
        want.sort_unstable();
        assert_eq!(paths, want);
    }

    #[test]
    fn a_root_inside_a_deny_listed_name_still_searches_its_own_files() {
        // The deny list applies below a root, as the walk applies it, not to the root's own path.
        let dir = TempDir::new("rootbuild");
        let p = dir.write("build/notes/a.md", b"needle");
        let roots = [format!("{}/build/notes", dir.root())];
        let got = search(&[p], "needle", &roots, None, None, &AtomicBool::new(false));
        assert_eq!(got.hits.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_that_leaves_the_root_is_never_followed() {
        use std::os::unix::fs::symlink;
        let dir = TempDir::new("links");
        let secret = dir.write("outside/secret.md", b"secret");
        let real = dir.write("root/real.md", b"secret");
        let root = format!("{}/root", dir.root());
        symlink(&secret, format!("{root}/file-link.md")).unwrap();
        symlink(
            format!("{}/outside", dir.root()),
            format!("{root}/dir-link"),
        )
        .unwrap();
        symlink(&real, format!("{root}/inside-link.md")).unwrap();
        let passed = vec![
            format!("{root}/file-link.md"),
            format!("{root}/dir-link/secret.md"),
            format!("{root}/inside-link.md"),
            real.clone(),
        ];
        let got = search(
            &passed,
            "secret",
            &[root],
            None,
            None,
            &AtomicBool::new(false),
        );
        let paths: Vec<&str> = got.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec![real.as_str()]);
        assert_eq!(got.scanned_files, 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_root_that_is_itself_a_symlink_is_searched_through_its_own_path() {
        use std::os::unix::fs::symlink;
        let dir = TempDir::new("rootlink");
        dir.write("real/a.md", b"needle");
        let link = format!("{}/link", dir.root());
        symlink(format!("{}/real", dir.root()), &link).unwrap();
        let got = search(
            &[format!("{link}/a.md")],
            "needle",
            std::slice::from_ref(&link),
            None,
            None,
            &AtomicBool::new(false),
        );
        assert_eq!(got.hits.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_named_pipe_is_skipped_without_opening_it() {
        let dir = TempDir::new("fifo");
        let p = dir.write("a.md", b"needle");
        let pipe = format!("{}/pipe.md", dir.root());
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        // Opening the pipe would block forever, so the search runs on a thread and a missing answer is a
        // failure, not a hang. The bound is a guard against blocking, not a speed claim.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let got = run(&dir, &[pipe, p], "needle");
            let _ = tx.send(got.hits.len());
        });
        let hits = rx
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("the search blocked on a named pipe");
        assert_eq!(hits, 1);
    }

    #[test]
    fn a_long_line_is_cut_to_160_characters_around_the_match() {
        let dir = TempDir::new("long");
        let line = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        let p = dir.write("a.md", line.as_bytes());
        let got = run(&dir, &[p], "needle");
        let h = &got.hits[0];
        assert_eq!(h.preview.chars().count(), PREVIEW_CHARS);
        assert_eq!(
            &h.preview[h.match_start as usize..h.match_end as usize],
            "needle"
        );
        assert_eq!(h.match_start, 77);
    }

    // The shared cases: the memory shell runs the same file (`memory-search.test.ts`).

    fn fixture() -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/content-search/cases.json");
        serde_json::from_slice(&fs::read(&path).expect("cases.json")).expect("cases.json parses")
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
            .collect()
    }

    fn content(spec: &Value) -> Vec<u8> {
        let mut bytes = if let Some(text) = spec.get("text").and_then(Value::as_str) {
            text.as_bytes().to_vec()
        } else {
            hex(spec["hex"].as_str().expect("text or hex"))
        };
        if let Some(size) = spec.get("padTo").and_then(Value::as_u64) {
            bytes.resize(size as usize, b'x');
        }
        bytes
    }

    #[test]
    fn the_shared_cases_pass() {
        let cases = fixture();
        let cases = cases["cases"].as_array().expect("cases");
        assert!(cases.len() >= 12, "a dozen cases at least");
        for (i, case) in cases.iter().enumerate() {
            let name = case["name"].as_str().unwrap();
            let dir = TempDir::new(&format!("case{i}"));
            let base = dir.root();
            let map = |p: &str| -> String { format!("{base}{p}") };
            for (path, spec) in case["files"].as_object().unwrap() {
                let full = PathBuf::from(map(path));
                fs::create_dir_all(full.parent().unwrap()).unwrap();
                fs::write(&full, content(spec)).unwrap();
            }
            let paths: Vec<String> = case["paths"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| map(p.as_str().unwrap()))
                .collect();
            let roots: Vec<String> = case["roots"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| map(p.as_str().unwrap()))
                .collect();
            let opts = &case["opts"];
            let got = search(
                &paths,
                case["query"].as_str().unwrap(),
                &roots,
                opts.get("limit")
                    .and_then(Value::as_u64)
                    .map(|n| n as usize),
                opts.get("perFile")
                    .and_then(Value::as_u64)
                    .map(|n| n as usize),
                &AtomicBool::new(false),
            );
            let expect = &case["expect"];
            let want: Vec<ContentHit> = expect["hits"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| ContentHit {
                    path: map(h["path"].as_str().unwrap()),
                    line: h["line"].as_u64().unwrap(),
                    byte_offset: h["byteOffset"].as_u64().unwrap(),
                    preview: h["preview"].as_str().unwrap().to_owned(),
                    match_start: h["matchStart"].as_u64().unwrap() as u32,
                    match_end: h["matchEnd"].as_u64().unwrap() as u32,
                })
                .collect();
            assert_eq!(got.hits, want, "case {name}: hits");
            assert_eq!(
                got.scanned_files,
                expect["scannedFiles"].as_u64().unwrap(),
                "case {name}: scannedFiles"
            );
            assert_eq!(
                got.truncated,
                expect["truncated"].as_bool().unwrap(),
                "case {name}: truncated"
            );
            if let Some(skipped) = expect.get("skippedFiles").and_then(Value::as_u64) {
                assert_eq!(got.skipped_files, skipped, "case {name}: skippedFiles");
            }
        }
    }

    // The serial search this module made before it used several threads and the handle's own path, kept as the
    // yardstick for the differential test.
    fn old_resolve(path: &str, roots: &[Root]) -> Option<PathBuf> {
        let p = Path::new(path);
        if !p.is_absolute() || !lexically_clean(path) {
            return None;
        }
        let mut candidates = Vec::new();
        for root in roots {
            let Ok(rel) = p.strip_prefix(&root.raw) else {
                continue;
            };
            if rel.as_os_str().is_empty() {
                continue;
            }
            // The last part is the file read (only a regular file is), not a folder: a file named `build` is searched.
            let parts: Vec<Component> = rel.components().collect();
            let clean = parts.iter().enumerate().all(|(i, c)| {
                matches!(c, Component::Normal(name) if i + 1 == parts.len() || !denied_segment(name))
            });
            if !clean {
                return None;
            }
            candidates.push(root.canonical.join(rel));
        }
        if candidates.is_empty() {
            return None;
        }
        let canonical = dunce::canonicalize(p).ok()?;
        candidates
            .into_iter()
            .any(|c| c == canonical)
            .then_some(canonical)
    }

    fn old_open_candidate(original: &Path, canonical: &Path) -> Option<(File, u64)> {
        // Only a regular file is ever opened: opening a FIFO blocks until a writer appears (and would take
        // another process's bytes), and a device never ends. Checked before `open`, not after.
        match fs::symlink_metadata(canonical) {
            Ok(m) if m.file_type().is_file() => {}
            _ => return None,
        }
        let Ok(mut file) = File::open(canonical) else {
            return None;
        };
        let Ok(meta) = file.metadata() else {
            return None;
        };
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            return None;
        }
        // The path as passed must still be this very file, not a link swapped in since `resolve`.
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            match fs::symlink_metadata(original) {
                Ok(link)
                    if !link.file_type().is_symlink()
                        && link.dev() == meta.dev()
                        && link.ino() == meta.ino() => {}
                _ => return None,
            }
        }
        #[cfg(not(unix))]
        {
            match fs::symlink_metadata(original) {
                Ok(link) if !link.file_type().is_symlink() => {}
                _ => return None,
            }
        }
        let mut head = vec![0u8; (meta.len() as usize).min(BINARY_SNIFF_BYTES)];
        if file.read_exact(&mut head).is_err() || head.contains(&0) {
            return None;
        }
        Some((file, meta.len()))
    }

    fn old_scan_file(
        file: &mut File,
        len: u64,
        path: &str,
        plan: &Plan,
        out: &mut SearchOutcome,
    ) -> FileEnd {
        let n = plan.needle.len();
        let mut buf: Vec<u8> = Vec::new();
        let mut folded: Vec<u8> = Vec::new();
        let mut base = 0u64;
        let mut line = 1u64;
        let mut line_pos = 0u64;
        let mut next_from = 0u64;
        let mut in_file = 0usize;
        loop {
            if plan.cancelled.load(Ordering::Relaxed) {
                return FileEnd::Cancelled;
            }
            if Instant::now() >= plan.deadline {
                return FileEnd::Time;
            }
            let want = (len - base).min((plan.chunk + n) as u64) as usize;
            buf.resize(want, 0);
            if file.seek(SeekFrom::Start(base)).is_err() || file.read_exact(&mut buf).is_err() {
                return FileEnd::Done;
            }
            let at_end = base + want as u64 >= len;
            let hay_all: &[u8] = if plan.fold {
                folded.clear();
                folded.extend(buf.iter().map(u8::to_ascii_lowercase));
                &folded
            } else {
                &buf
            };
            // A match never starts on a continuation byte, so a chunk that begins inside a character
            // can leave those bytes out and still be valid UTF-8.
            let lead = hay_all
                .iter()
                .take(3)
                .take_while(|&&b| is_continuation(b))
                .count();
            let (text, searched) = match std::str::from_utf8(&hay_all[lead..]) {
                Ok(t) => (Some(t), want),
                // Only the last character was cut by the chunk's end: search the rest as text.
                Err(e) if e.error_len().is_none() && !at_end => {
                    let valid = e.valid_up_to();
                    (
                        std::str::from_utf8(&hay_all[lead..lead + valid]).ok(),
                        lead + valid,
                    )
                }
                Err(_) => (None, want),
            };
            let hay = &hay_all[lead..searched];
            let hay_base = base + lead as u64;
            let mut from = (next_from.max(hay_base) - hay_base) as usize;
            while let Some(found) = find_in(hay, text, plan.needle, from) {
                if out.hits.len() >= plan.limit {
                    return FileEnd::Limit;
                }
                if in_file >= plan.per_file {
                    return FileEnd::PerFile;
                }
                let idx = lead + found;
                let at = base + idx as u64;
                let counted = (line_pos - base) as usize;
                line += buf[counted..idx].iter().filter(|&&b| b == b'\n').count() as u64;
                line_pos = at;
                let (preview, match_start, match_end) =
                    preview_at(file, &buf, base, at, n, len, &mut false);
                out.hits.push(ContentHit {
                    path: path.to_owned(),
                    line,
                    byte_offset: at,
                    preview,
                    match_start,
                    match_end,
                });
                in_file += 1;
                next_from = at + n as u64;
                from = found + n;
            }
            if at_end {
                return FileEnd::Done;
            }
            let new_base = (base + searched as u64)
                .saturating_sub(n as u64 - 1)
                .max(base + 1);
            // Lines in the part dropped from the buffer still count.
            let counted = (line_pos - base) as usize;
            let dropped = (new_base - base) as usize;
            if counted < dropped {
                line += buf[counted..dropped]
                    .iter()
                    .filter(|&&b| b == b'\n')
                    .count() as u64;
                line_pos = new_base;
            }
            base = new_base;
        }
    }

    fn old_search(
        paths: &[String],
        query: &str,
        roots: &[String],
        limit: Option<usize>,
        per_file: Option<usize>,
        cancelled: &AtomicBool,
        chunk: usize,
        budget: Duration,
    ) -> SearchOutcome {
        let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
        let per_file = per_file.unwrap_or(DEFAULT_PER_FILE);
        let mut out = SearchOutcome::default();
        if query.is_empty() || query.contains(['\n', '\r']) {
            return out;
        }
        let fold = !is_case_sensitive(query);
        let needle = if fold {
            query.to_ascii_lowercase()
        } else {
            query.to_owned()
        };
        let plan = Plan {
            needle: &needle,
            fold,
            limit,
            per_file,
            chunk: chunk.max(needle.len() + 4),
            deadline: Instant::now() + budget,
            cancelled,
            settled: &AtomicBool::new(false),
        };
        let roots = prepare_roots(roots);
        let mut seen = HashSet::new();
        let mut considered = 0usize;
        let mut total: u64 = 0;
        for path in paths {
            if !seen.insert(path.as_str()) {
                continue;
            }
            if considered >= MAX_FILES {
                out.truncated = true;
                out.stopped = Some(Stop::Files);
                break;
            }
            if cancelled.load(Ordering::Relaxed) {
                out.truncated = true;
                break;
            }
            considered += 1;
            let Some(canonical) = old_resolve(path, &roots) else {
                continue;
            };
            let Some((mut file, len)) = old_open_candidate(Path::new(path), &canonical) else {
                out.skipped_files += 1;
                continue;
            };
            if len > MAX_TOTAL_BYTES.saturating_sub(total) {
                out.truncated = true;
                out.stopped = Some(Stop::Bytes);
                break;
            }
            total += len;
            out.scanned_files += 1;
            match old_scan_file(&mut file, len, path, &plan, &mut out) {
                FileEnd::Done | FileEnd::Unreadable => {}
                FileEnd::PerFile => out.truncated = true,
                FileEnd::Limit | FileEnd::Cancelled => {
                    out.truncated = true;
                    break;
                }
                FileEnd::Time => {
                    out.truncated = true;
                    out.stopped = Some(Stop::Time);
                    break;
                }
            }
        }
        out
    }

    /// A tree that exercises every way a path can end: hits, none, binary, empty, over the per-file cap, a
    /// deny-listed folder, a missing file, an outside file, a repeated path.
    fn differential_tree(dir: &TempDir) -> Vec<String> {
        let mut paths = mixed_corpus(dir);
        for i in 0..70 {
            let body = match i % 7 {
                0 => format!("line {i}\nNeedle and needle {i}\nthe end\n").into_bytes(),
                1 => format!("café {i} NEEDLE ☕\n").into_bytes(),
                2 => b"nothing\n".to_vec(),
                3 => format!("bin\0{i} needle").into_bytes(),
                4 => "needle ".repeat(20 + i).into_bytes(),
                5 => Vec::new(),
                _ => format!("{}\nneedle\n", "ünï ".repeat(i * 3)).into_bytes(),
            };
            paths.push(dir.write(&format!("tree/d{}/f{i}.md", i % 5), &body));
        }
        paths.push(dir.write("tree/node_modules/x.md", b"needle"));
        paths.push(format!("{}/tree/missing.md", dir.root()));
        paths.push(dir.write("elsewhere/out.md", b"needle"));
        let again = paths[3].clone();
        paths.push(again);
        paths
    }

    #[test]
    fn the_threaded_search_equals_the_serial_one_for_every_worker_count() {
        let dir = TempDir::new("differential");
        let paths = differential_tree(&dir);
        let whole = [dir.root()];
        let tree_only = [format!("{}/tree", dir.root())];
        let flag = AtomicBool::new(false);
        let mut runs = 0u32;
        for roots in [&whole[..], &tree_only[..]] {
            for query in ["needle", "Needle", "é", "x", "line 3", "\u{ff}", "ünï"] {
                for (limit, per_file) in [
                    (None, None),
                    (Some(3), Some(5)),
                    (Some(10), Some(1)),
                    (Some(0), None),
                    (Some(7), Some(0)),
                    (Some(40), Some(100)),
                ] {
                    for chunk in [9usize, 4096, CHUNK_BYTES] {
                        let budget = Duration::from_secs(MAX_SECONDS);
                        let want =
                            old_search(&paths, query, roots, limit, per_file, &flag, chunk, budget);
                        for workers in [1usize, 2, 3, 4, 8] {
                            for _ in 0..2 {
                                let got = search_chunked(
                                    &paths,
                                    query,
                                    roots,
                                    limit,
                                    per_file,
                                    &flag,
                                    Tuning {
                                        chunk,
                                        budget,
                                        workers,
                                    },
                                );
                                let what = format!(
                                    "{query:?} limit {limit:?} per_file {per_file:?} chunk {chunk} workers {workers}"
                                );
                                assert_eq!(got.hits, want.hits, "{what}: hits");
                                assert_eq!(
                                    (
                                        got.scanned_files,
                                        got.skipped_files,
                                        got.truncated,
                                        got.stopped
                                    ),
                                    (
                                        want.scanned_files,
                                        want.skipped_files,
                                        want.truncated,
                                        want.stopped
                                    ),
                                    "{what}: counts"
                                );
                                runs += 1;
                            }
                        }
                    }
                }
            }
        }
        println!(
            "differential: {runs} threaded runs against the serial search, workers 1, 2, 3, 4, 8"
        );
    }

    #[test]
    fn a_file_read_ahead_stops_once_the_outcome_is_settled() {
        let dir = TempDir::new("settled");
        let p = dir.write("a.md", "needle\n".repeat(64).as_bytes());
        let mut file = File::open(&p).unwrap();
        let (cancelled, settled) = (AtomicBool::new(false), AtomicBool::new(true));
        let plan = Plan {
            needle: "needle",
            fold: false,
            limit: DEFAULT_LIMIT,
            per_file: 1000,
            chunk: 16,
            deadline: Instant::now() + Duration::from_secs(MAX_SECONDS),
            cancelled: &cancelled,
            settled: &settled,
        };
        let mut out = SearchOutcome::default();
        assert_eq!(
            scan_file(&mut file, 448, &p, &plan, &mut out),
            FileEnd::Cancelled
        );
        assert!(out.hits.is_empty());
    }

    #[test]
    fn a_path_outside_every_root_is_never_opened() {
        let dir = TempDir::new("opened");
        let inside = dir.write("root/in.md", b"secret");
        let outside = dir.write("other/out.md", b"secret");
        let denied = dir.write("root/node_modules/d.md", b"secret");
        let dotdot = format!("{}/root/../other/out.md", dir.root());
        let roots = [format!("{}/root", dir.root())];
        let got = search_chunked(
            &[outside.clone(), denied.clone(), dotdot, inside.clone()],
            "secret",
            &roots,
            None,
            None,
            &AtomicBool::new(false),
            Tuning {
                chunk: CHUNK_BYTES,
                budget: Duration::from_secs(MAX_SECONDS),
                workers: 4,
            },
        );
        assert_eq!(got.hits.len(), 1);
        let key = |p: &str| p.replace('\\', "/");
        let opened: Vec<String> = OPENED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .map(|p| key(&p.to_string_lossy()))
            .collect();
        assert!(opened.contains(&key(&inside)), "the file inside is opened");
        assert!(
            !opened.contains(&key(&outside)),
            "the outside file was opened"
        );
        assert!(
            !opened.contains(&key(&denied)),
            "the deny-listed file was opened"
        );
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let done = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .expect("cmd");
        assert!(done.status.success(), "mklink /J failed");
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_swapped_in_for_a_folder_after_the_spelling_was_judged_is_refused() {
        let dir = TempDir::new("swap-junction");
        let p = dir.write("root/sub/a.md", b"inside");
        dir.write("elsewhere/a.md", b"outside");
        let roots = prepare_roots(&[format!("{}/root", dir.root())]);
        let expected = expected_paths(&p, &roots).expect("spelling is fine");
        assert!(
            open_candidate(Path::new(&p), &expected).is_ok(),
            "control: the real folder opens"
        );
        let sub = dir.0.join("root").join("sub");
        fs::rename(&sub, dir.0.join("root").join("sub-old")).unwrap();
        junction(&sub, &dir.0.join("elsewhere"));
        assert!(
            open_candidate(Path::new(&p), &expected).is_err(),
            "a file reached through the swapped-in junction was opened"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_symlink_swapped_in_for_a_file_after_the_spelling_was_judged_is_refused() {
        let dir = TempDir::new("swap-symlink");
        let p = dir.write("root/a.md", b"inside");
        let other = dir.write("elsewhere/a.md", b"outside");
        let roots = prepare_roots(&[format!("{}/root", dir.root())]);
        let expected = expected_paths(&p, &roots).expect("spelling is fine");
        assert!(
            open_candidate(Path::new(&p), &expected).is_ok(),
            "control: the real file opens"
        );
        fs::remove_file(&p).unwrap();
        if std::os::windows::fs::symlink_file(&other, &p).is_err() {
            eprintln!("symlink case not run: this machine refuses symlinks (no Developer Mode)");
            return;
        }
        assert!(
            open_candidate(Path::new(&p), &expected).is_err(),
            "a symlink swapped in for the file was followed"
        );
    }

    /// `cargo test search_bench -- --ignored --nocapture`: 1,500 files, 10 MB, warm, then this repository; the serial search beside the threaded one.
    #[test]
    #[ignore]
    fn search_bench() {
        let dir = TempDir::new("bench");
        let para = "The quick brown fox jumps over the lazy dog; a reader sets text like a well-made book.\n";
        let per_file = 10 * 1024 * 1024 / 1500;
        let body: String = para.repeat(per_file / para.len() + 1)[..per_file].to_owned();
        let mut paths = Vec::with_capacity(1500);
        for i in 0..1500 {
            let mut text = body.clone();
            if i % 100 == 0 {
                text.push_str("\nzanzibar quartz\n");
            }
            paths.push(dir.write(&format!("d{}/f{i}.md", i % 30), text.as_bytes()));
        }
        let roots = [dir.root()];
        let flag = AtomicBool::new(false);
        for (label, query) in [
            ("lowercase, rare", "zanzibar"),
            ("Exact, rare", "Zanzibar"),
            ("lowercase, common", "lazy dog"),
        ] {
            // One cold-ish pass to warm the page cache, then the median of five.
            search(&paths, query, &roots, None, None, &flag);
            bench_row(label, query, &paths, &roots, &flag);
        }
    }

    fn bench_row(label: &str, query: &str, paths: &[String], roots: &[String], flag: &AtomicBool) {
        let budget = Duration::from_secs(MAX_SECONDS);
        let median = |f: &dyn Fn() -> SearchOutcome| {
            f();
            let mut times = Vec::new();
            let mut last = SearchOutcome::default();
            for _ in 0..5 {
                let t = Instant::now();
                last = f();
                times.push(t.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (times[2], last)
        };
        let (before, a) =
            median(&|| old_search(paths, query, roots, None, None, flag, CHUNK_BYTES, budget));
        let mut row = format!("search_bench {label:>18}: serial {before:.1} ms");
        for workers in [1usize, 2, 4, 8] {
            let (ms, b) = median(&|| {
                search_chunked(
                    paths,
                    query,
                    roots,
                    None,
                    None,
                    flag,
                    Tuning {
                        chunk: CHUNK_BYTES,
                        budget,
                        workers,
                    },
                )
            });
            assert_eq!(a.hits, b.hits);
            row.push_str(&format!(", {workers} worker(s) {ms:.1} ms"));
        }
        println!(
            "{row} ({} files scanned, {} hits)",
            a.scanned_files,
            a.hits.len()
        );
    }

    /// The same, over the files of this repository (the source folders, no build output).
    #[test]
    #[ignore]
    fn search_bench_repository() {
        fn walk(dir: &Path, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
                let path = entry.path();
                let name = entry.file_name();
                if crate::commands::fs::denied_name(&name.to_string_lossy()) {
                    continue;
                }
                match entry.file_type() {
                    Ok(t) if t.is_dir() => walk(&path, out),
                    Ok(t) if t.is_file() => out.push(path.to_string_lossy().into_owned()),
                    _ => {}
                }
            }
        }
        let root =
            dunce::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")).unwrap();
        let mut paths = Vec::new();
        for sub in [
            "apps/desktop/src",
            "packages",
            "docs",
            "scripts",
            "fixtures",
        ] {
            walk(&root.join(sub), &mut paths);
        }
        let roots = [root.to_string_lossy().into_owned()];
        let flag = AtomicBool::new(false);
        for (label, query) in [
            ("rare", "zanzibarquartz"),
            ("Exact common", "Shell"),
            ("lowercase common", "the"),
        ] {
            bench_row(label, query, &paths, &roots, &flag);
        }
        println!("repository: {} files", paths.len());
    }
}
