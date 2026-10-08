//! Content search over the files the webview passes (C-16, ADR-0053 §4). One IPC per query, std-only
//! reads, nothing indexed or written, no directory walked. The webview passes the index's own paths
//! (its ignore files, deny globs and extension allow-list already applied); this module re-checks
//! the floors it can check without a matcher: each path lies under one of the collection's roots,
//! no segment below the root is a built-in deny-listed directory, and nothing between the root and
//! the file is a symlink. `packages/core/src/index-model/content-search.ts` is the same search for
//! the memory shell; both pass `fixtures/content-search/cases.json`.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use crate::error::ShellError;

/// Same numbers as `CONTENT_SEARCH_LIMITS` in `content-search.ts`.
pub const DEFAULT_LIMIT: usize = 200;
pub const DEFAULT_PER_FILE: usize = 5;
pub const MAX_LIMIT: usize = 10_000;
pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
pub const BINARY_SNIFF_BYTES: usize = 8 * 1024;
pub const MAX_FILES: usize = 100_000;
pub const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
pub const PREVIEW_CHARS: usize = 160;

/// Same names as `index-model/deny.ts` and `commands/fs.rs`.
const DENY_DIRECTORY_NAMES: &[&str] = &[
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
    pub truncated: bool,
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
            let canonical = raw.canonicalize().ok()?;
            Some(Root { raw, canonical })
        })
        .collect()
}

fn denied_segment(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|n| DENY_DIRECTORY_NAMES.contains(&n))
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

/// The canonical path to read, or `None` when the path must not be read: not absolute, under no
/// root, below a deny-listed directory or a `..` relative to a root it is under, or reached through
/// a symlink (its canonical form is not the root's canonical form joined with the same segments).
fn resolve(path: &str, roots: &[Root]) -> Option<PathBuf> {
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
        let clean = rel
            .components()
            .all(|c| matches!(c, Component::Normal(name) if !denied_segment(name)));
        if !clean {
            return None;
        }
        candidates.push(root.canonical.join(rel));
    }
    if candidates.is_empty() {
        return None;
    }
    let canonical = p.canonicalize().ok()?;
    candidates
        .into_iter()
        .any(|c| c == canonical)
        .then_some(canonical)
}

/// The file's bytes when it is a regular file of at most `MAX_FILE_BYTES` with no NUL in its first
/// 8 KB; `None` skips it. `budget` is what the search may still read; a file that would pass it
/// returns `Err(())` so the search stops.
fn read_candidate(original: &Path, canonical: &Path, budget: u64) -> Result<Option<Vec<u8>>, ()> {
    let Ok(file) = File::open(canonical) else {
        return Ok(None);
    };
    let Ok(meta) = file.metadata() else {
        return Ok(None);
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Ok(None);
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
            _ => return Ok(None),
        }
    }
    #[cfg(not(unix))]
    {
        match fs::symlink_metadata(original) {
            Ok(link) if !link.file_type().is_symlink() => {}
            _ => return Ok(None),
        }
    }
    if meta.len() > budget {
        return Err(());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    if file
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_FILE_BYTES
    {
        return Ok(None);
    }
    let sniff = &bytes[..bytes.len().min(BINARY_SNIFF_BYTES)];
    if sniff.contains(&0) {
        return Ok(None);
    }
    Ok(Some(bytes))
}

/// Smart case: any uppercase character means exact bytes.
pub fn is_case_sensitive(query: &str) -> bool {
    query.chars().any(char::is_uppercase)
}

/// Finds non-overlapping occurrences of `needle` in `hay`. Valid UTF-8 (nearly every text file)
/// takes std's two-way string search; anything else a first-byte scan.
struct Finder<'a> {
    hay: &'a [u8],
    text: Option<&'a str>,
    needle: &'a [u8],
    needle_text: &'a str,
}

impl<'a> Finder<'a> {
    fn new(hay: &'a [u8], needle_text: &'a str) -> Self {
        Self {
            hay,
            text: std::str::from_utf8(hay).ok(),
            needle: needle_text.as_bytes(),
            needle_text,
        }
    }

    fn find(&self, from: usize) -> Option<usize> {
        if from > self.hay.len() {
            return None;
        }
        if let Some(text) = self.text {
            // `from` is always 0 or just past a match of a valid UTF-8 needle, so a char boundary.
            return text[from..].find(self.needle_text).map(|i| i + from);
        }
        let first = self.needle[0];
        let last = self.hay.len().checked_sub(self.needle.len())?;
        let mut i = from;
        while i <= last {
            let step = self.hay[i..=last].iter().position(|&b| b == first)?;
            i += step;
            if &self.hay[i..i + self.needle.len()] == self.needle {
                return Some(i);
            }
            i += 1;
        }
        None
    }
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

/// The preview for a match at `[ms, me)`: the line, without its line break, cut on character
/// boundaries to at most `PREVIEW_CHARS` characters with the match kept whole when it fits.
fn preview(hay: &[u8], ms: usize, me: usize) -> (String, u32, u32) {
    let mut line_start = hay[..ms]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    if line_start == 0 {
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
    let window = PREVIEW_CHARS * 4;
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

/// The search itself, shell-free so tests call it directly. `cancelled` is polled between files.
pub fn search(
    paths: &[String],
    query: &str,
    roots: &[String],
    limit: Option<usize>,
    per_file: Option<usize>,
    cancelled: &AtomicBool,
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
    let roots = prepare_roots(roots);
    let mut seen = HashSet::new();
    let mut considered = 0usize;
    let mut total: u64 = 0;
    let mut lowered = Vec::new();
    'paths: for path in paths {
        if !seen.insert(path.as_str()) {
            continue;
        }
        if considered >= MAX_FILES || cancelled.load(Ordering::Relaxed) {
            out.truncated = true;
            break;
        }
        considered += 1;
        let Some(canonical) = resolve(path, &roots) else {
            continue;
        };
        let bytes = match read_candidate(Path::new(path), &canonical, MAX_TOTAL_BYTES - total) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => continue,
            Err(()) => {
                out.truncated = true;
                break;
            }
        };
        total += bytes.len() as u64;
        out.scanned_files += 1;
        let hay: &[u8] = if fold {
            lowered.clear();
            lowered.extend(bytes.iter().map(u8::to_ascii_lowercase));
            &lowered
        } else {
            &bytes
        };
        let finder = Finder::new(hay, &needle);
        let mut line = 1u64;
        let mut counted = 0usize;
        let mut in_file = 0usize;
        let mut from = 0usize;
        while let Some(at) = finder.find(from) {
            if out.hits.len() >= limit {
                out.truncated = true;
                break 'paths;
            }
            if in_file >= per_file {
                out.truncated = true;
                break;
            }
            line += hay[counted..at].iter().filter(|&&b| b == b'\n').count() as u64;
            counted = at;
            let me = at + needle.len();
            let (text, match_start, match_end) = preview(&bytes, at, me);
            out.hits.push(ContentHit {
                path: path.clone(),
                line,
                byte_offset: at as u64,
                preview: text,
                match_start,
                match_end,
            });
            in_file += 1;
            from = me;
        }
    }
    out
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
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = running().lock() {
        map.insert(token, flag.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
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
    use std::time::Instant;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("marxy-search-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("tmpdir");
            // The temp directory may itself sit behind a symlink (/tmp on macOS); roots are canonical.
            Self(dir.canonicalize().expect("canonical tmpdir"))
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
    fn binary_and_oversized_files_are_skipped() {
        let dir = TempDir::new("skip");
        let bin = dir.write("bin.md", b"needle\0needle");
        let mut big = vec![b'x'; MAX_FILE_BYTES as usize];
        big.extend_from_slice(b"needle");
        let big = dir.write("big.md", &big);
        let mut just = vec![b'x'; MAX_FILE_BYTES as usize - 6];
        just.extend_from_slice(b"needle");
        let just = dir.write("just.md", &just);
        let got = run(&dir, &[bin, big, just.clone()], "needle");
        assert_eq!(got.scanned_files, 1);
        assert_eq!(got.hits.len(), 1);
        assert_eq!(got.hits[0].path, just);
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

    // Privacy (the C-10 ruling): what the index would never hold is never read, even when passed.

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
        }
    }

    /// `cargo test search_bench -- --ignored --nocapture`: 1,500 files, 10 MB, warm.
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
            let mut times = Vec::new();
            let mut last = SearchOutcome::default();
            for _ in 0..5 {
                let t = Instant::now();
                last = search(&paths, query, &roots, None, None, &flag);
                times.push(t.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!(
                "search_bench {label:>18}: {:.1} ms median of 5 ({} files scanned, {} hits, truncated {})",
                times[2],
                last.scanned_files,
                last.hits.len(),
                last.truncated
            );
        }
    }
}
