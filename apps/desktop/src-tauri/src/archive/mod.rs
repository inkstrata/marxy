//! Archives: list one and read one entry into memory (`src/commands/archive.rs`). Nothing here writes to disk or
//! builds a path from an entry name: a name is text for the page to show, sanitised so it can never be mistaken for a
//! place (`..`, a drive, a leading slash), and an entry is addressed by its ordinal. Every walk is bounded by `Limits`.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

mod ar;
mod cab;
mod iso;
mod rar;
mod sevenz;
mod sevenz_header;
mod tar;
#[cfg(test)]
pub mod testkit;
mod zip;

/// The bounds on every walk. Fields are public so a test can shrink them.
#[derive(Clone)]
pub struct Limits {
    /// Ordinals walked in one listing.
    pub entries: usize,
    /// Raw name length; a longer entry is skipped and counted.
    pub name_bytes: usize,
    /// Path segments; a deeper entry is skipped and counted.
    pub depth: usize,
    /// Sum of the listed names; past it the listing stops.
    pub listed_bytes: usize,
    /// Decompressed bytes walked through a compressed tar, or unpacked from a 7z's blocks in one call.
    pub stream: u64,
    /// The most one entry may open with.
    pub entry: u64,
    /// The most one head may hold.
    pub head: u64,
    /// The bytes one `heads` call may return in all.
    pub heads: u64,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        entries: 100_000,
        name_bytes: 1_024,
        depth: 64,
        listed_bytes: 16 * 1024 * 1024,
        stream: 1024 * 1024 * 1024,
        entry: 16 * 1024 * 1024,
        head: 256 * 1024,
        heads: 16 * 1024 * 1024,
    };
}

/// xz decoder memory, in KiB: a block asking for more fails before it allocates.
const XZ_MEM_KB: u32 = 262_144;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    pub comment: Option<String>,
    pub truncated: Option<String>,
    pub skipped: u32,
    pub declared: Option<u64>,
    pub size: u64,
    pub unpacked: Option<u64>,
    pub directory: Option<Directory>,
    /// A sentence about the whole archive, said under the lede: what of it the app does not read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Where a zip's central directory lies in the file.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
pub struct Directory {
    pub at: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub index: u32,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub packed: Option<u64>,
    pub mtime: Option<String>,
    pub encrypted: bool,
    pub method: Option<String>,
    pub raw_name: Option<String>,
    pub link: Option<String>,
    /// zip: its local header's byte in the file; tar: its header's byte in the unpacked stream.
    pub offset: Option<u64>,
    pub crc: Option<u32>,
    pub host: Option<String>,
    pub mode: Option<u32>,
    pub flags: Option<u16>,
    pub comment: Option<String>,
}

impl ArchiveEntry {
    /// An entry with only its ordinal, path and kind known; a format fills in what else it has.
    fn bare(index: u32, path: String, kind: &str) -> ArchiveEntry {
        ArchiveEntry {
            index,
            path,
            kind: kind.into(),
            size: None,
            packed: None,
            mtime: None,
            encrypted: false,
            method: None,
            raw_name: None,
            link: None,
            offset: None,
            crc: None,
            host: None,
            mode: None,
            flags: None,
            comment: None,
        }
    }
}

/// One entry the page asks the beginning of: `name` must still be what the listing gave at `index`.
#[derive(Debug, Deserialize, Clone)]
pub struct Want {
    pub index: u32,
    pub name: String,
}

/// The first bytes of one entry, or the sentence why there are none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub index: u32,
    pub bytes: Vec<u8>,
    /// The entry ended inside `bytes`.
    pub whole: bool,
    pub refused: Option<String>,
}

impl Head {
    fn of(index: u32, got: Result<(Vec<u8>, bool), Fault>) -> Result<Head, Fault> {
        match got {
            Ok((bytes, whole)) => Ok(Head {
                index,
                bytes,
                whole,
                refused: None,
            }),
            Err(Fault::Io(e)) => Err(Fault::Io(e)),
            Err(Fault::Invalid(m) | Fault::Refused(m) | Fault::Unsupported(m)) => Ok(Head {
                index,
                bytes: Vec::new(),
                whole: false,
                refused: Some(m),
            }),
        }
    }
}

/// Why a list or a read stopped; the command maps each to its `ShellError` code.
#[derive(Debug, Clone)]
pub enum Fault {
    Invalid(String),
    Refused(String),
    Unsupported(String),
    Io(String),
}

impl From<io::Error> for Fault {
    fn from(e: io::Error) -> Self {
        Fault::Io(e.to_string())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Comp {
    Gz,
    Bz2,
    Xz,
    Zst,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Format {
    Zip,
    Tar(Option<Comp>),
    Single(Comp),
    SevenZ,
    /// An `ar` archive; `true` when it is a Debian package.
    Ar(bool),
    Cab,
    Iso,
    Rar,
}

impl Format {
    fn name(self) -> &'static str {
        match self {
            Format::Zip => "zip",
            Format::Tar(None) => "tar",
            Format::Tar(Some(Comp::Gz)) => "tar.gz",
            Format::Tar(Some(Comp::Bz2)) => "tar.bz2",
            Format::Tar(Some(Comp::Xz)) => "tar.xz",
            Format::Tar(Some(Comp::Zst)) => "tar.zst",
            Format::Single(Comp::Gz) => "gz",
            Format::Single(Comp::Bz2) => "bz2",
            Format::Single(Comp::Xz) => "xz",
            Format::Single(Comp::Zst) => "zst",
            Format::SevenZ => "7z",
            Format::Ar(true) => "deb",
            Format::Ar(false) => "ar",
            Format::Cab => "cab",
            Format::Iso => "iso",
            Format::Rar => "rar",
        }
    }
}

// ---- words and dates ------------------------------------------------------------------------------------------------

/// "1,234,567".
pub fn commas(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// "512 bytes", "4.0 KB", "20.0 MB": 1024 units, one decimal from KB up.
pub fn size_words(n: u64) -> String {
    const KB: f64 = 1024.0;
    if n < 1024 {
        return format!("{n} {}", if n == 1 { "byte" } else { "bytes" });
    }
    let n = n as f64;
    if n < KB * KB {
        format!("{:.1} KB", n / KB)
    } else if n < KB * KB * KB {
        format!("{:.1} MB", n / (KB * KB))
    } else {
        format!("{:.1} GB", n / (KB * KB * KB))
    }
}

/// Calendar date of a day count from 1970-01-01 (proleptic Gregorian).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// "YYYY-MM-DDTHH:MM:SS" for Unix seconds, with a trailing "Z" when `utc`; None outside years 0 to 9999.
pub fn iso_from_unix(secs: i64, utc: bool) -> Option<String> {
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    if !(0..=9999).contains(&y) {
        return None;
    }
    let t = secs.rem_euclid(86_400);
    Some(format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}{}",
        t / 3_600,
        t % 3_600 / 60,
        t % 60,
        if utc { "Z" } else { "" }
    ))
}

// ---- names ----------------------------------------------------------------------------------------------------------

/// A name made safe to show and to compare: see `sanitise`.
#[derive(Debug, PartialEq, Eq)]
pub struct Clean {
    pub path: String,
    pub depth: usize,
    /// Differs from the raw name beyond backslash-to-slash.
    pub changed: bool,
}

fn is_drive(segment: &str) -> bool {
    let b = segment.as_bytes();
    b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// Backslashes become slashes, control characters become U+FFFD, empty, `.` and `..` segments go, and so does a first
/// segment that is a drive (`C:`) or `?` (from `//?/`). The result is never absolute, never carries a drive or a `..`.
/// `None` when nothing is left. A directory's path ends in `/`.
pub fn sanitise(decoded: &str, dir: bool) -> Option<Clean> {
    let norm = decoded.replace('\\', "/");
    let cleaned: String = norm
        .chars()
        .map(|c| {
            if c < ' ' || c == '\u{7f}' {
                '\u{fffd}'
            } else {
                c
            }
        })
        .collect();
    let mut segments: Vec<&str> = cleaned
        .split('/')
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .collect();
    while segments.first().is_some_and(|s| *s == "?" || is_drive(s)) {
        segments.remove(0);
    }
    if segments.is_empty() {
        return None;
    }
    let mut path = segments.join("/");
    let changed = path != norm.trim_end_matches('/');
    let depth = segments.len();
    if dir {
        path.push('/');
    }
    Some(Clean {
        path,
        depth,
        changed,
    })
}

/// The `rawName` of an entry whose sanitising changed more than its slashes.
fn raw_name_of(clean: &Clean, decoded: &str) -> Option<String> {
    clean.changed.then(|| decoded.to_owned())
}

/// What the page shows of a link's target: control characters replaced, never resolved or followed.
fn link_text(raw: &[u8], limits: &Limits) -> String {
    shown_text(&String::from_utf8_lossy(raw), limits)
}

/// Text for the page (a link's target, an entry's comment): control characters replaced, cut to the name length.
fn shown_text(text: &str, limits: &Limits) -> String {
    let mut out: String = text
        .chars()
        .map(|c| {
            if c < ' ' || c == '\u{7f}' {
                '\u{fffd}'
            } else {
                c
            }
        })
        .collect();
    if out.len() > limits.name_bytes {
        let mut cut = limits.name_bytes;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
    }
    out
}

// ---- messages shared by every format ----------------------------------------------------------------------------------

fn damaged(name: &str) -> Fault {
    Fault::Invalid(format!("{name} could not be read: the archive is damaged."))
}

fn changed() -> Fault {
    Fault::Invalid("The archive changed since it was listed.".into())
}

fn too_big_declared(name: &str, size: u64) -> Fault {
    Fault::Refused(format!(
        "{name} is {} unpacked, over the 16 MB an entry may open with.",
        size_words(size)
    ))
}

fn too_big_actual(name: &str, declared: Option<u64>) -> Fault {
    match declared {
        Some(d) => Fault::Refused(format!(
            "{name} unpacks past the 16 MB an entry may open with, though it declares {}.",
            size_words(d)
        )),
        None => Fault::Refused(format!(
            "{name} unpacks past the 16 MB an entry may open with."
        )),
    }
}

fn folder() -> Fault {
    Fault::Invalid("A folder has nothing to open.".into())
}

fn not_archive() -> Fault {
    Fault::Invalid("This file is not an archive.".into())
}

/// At most `cap + 1` bytes of `r`, cut to `cap`, and whether `r` ended inside them.
fn head_of(r: impl Read, cap: u64) -> io::Result<(Vec<u8>, bool)> {
    let mut out = slurp(r, cap)?;
    let whole = out.len() as u64 <= cap;
    out.truncate(cap as usize);
    Ok((out, whole))
}

/// At most `limit + 1` bytes of `r`, so a read that runs past `limit` shows itself.
fn slurp(r: impl Read, limit: u64) -> io::Result<Vec<u8>> {
    let mut out = Vec::new();
    r.take(limit.saturating_add(1)).read_to_end(&mut out)?;
    Ok(out)
}

// ---- detection ------------------------------------------------------------------------------------------------------

fn read_up_to(mut r: impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

fn octal(field: &[u8]) -> Option<u64> {
    let text: String = field
        .iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as char)
        .collect();
    u64::from_str_radix(text.trim(), 8).ok()
}

/// A tar header block: `ustar` at 257, or a v7 header whose checksum field matches its bytes.
fn looks_like_tar(block: &[u8]) -> bool {
    if block.len() < 512 {
        return false;
    }
    if &block[257..262] == b"ustar" {
        return true;
    }
    let sum: u64 = block[..512]
        .iter()
        .enumerate()
        .map(|(i, &b)| {
            if (148..156).contains(&i) {
                32
            } else {
                u64::from(b)
            }
        })
        .sum();
    octal(&block[148..156]).is_some_and(|c| c == sum)
}

fn comp_of(head: &[u8]) -> Option<Comp> {
    if head.starts_with(&[0x1f, 0x8b, 8]) {
        Some(Comp::Gz)
    } else if head.len() >= 10
        && head.starts_with(b"BZh")
        && (b'1'..=b'9').contains(&head[3])
        && (head[4..10] == [0x31, 0x41, 0x59, 0x26, 0x53, 0x59]
            || head[4..10] == [0x17, 0x72, 0x45, 0x38, 0x50, 0x90])
    {
        Some(Comp::Bz2)
    } else if head.starts_with(&[0xfd, b'7', b'z', b'X', b'Z', 0]) {
        Some(Comp::Xz)
    } else if head.starts_with(&ZSTD_MAGIC) {
        Some(Comp::Zst)
    } else {
        None
    }
}

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];

/// The content size a Zstandard frame header declares; `None` when it does not say.
fn zstd_content_size(h: &[u8]) -> Option<u64> {
    if h.len() < 5 || h[..4] != ZSTD_MAGIC {
        return None;
    }
    let fhd = h[4];
    let single = fhd & 0x20 != 0;
    let fcs_len = match fhd >> 6 {
        0 => usize::from(single),
        1 => 2,
        2 => 4,
        _ => 8,
    };
    if fcs_len == 0 {
        return None;
    }
    let dict_len = [0usize, 1, 2, 4][usize::from(fhd & 3)];
    let at = 5 + usize::from(!single) + dict_len;
    let bytes = h.get(at..at + fcs_len)?;
    let v = bytes
        .iter()
        .enumerate()
        .fold(0u64, |v, (i, &b)| v | u64::from(b) << (8 * i));
    // A two-byte size counts from 256.
    Some(if fcs_len == 2 { v + 256 } else { v })
}

/// Bytes `start` to `start + len` of a file: the whole of it, or one member of an `ar`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: u64,
    pub len: u64,
}

impl Span {
    pub const ALL: Span = Span {
        start: 0,
        len: u64::MAX,
    };
}

/// The bytes of `span`, unpacked by `comp` when there is one. A Zstandard frame's window is held as a zip entry's is,
/// by the size its header declares, and one that asks for more is refused before the decoder is made.
fn unpacked<'a>(
    file: &'a File,
    comp: Option<Comp>,
    span: Span,
) -> Result<Box<dyn Read + 'a>, Fault> {
    let mut f = file;
    f.seek(SeekFrom::Start(span.start))?;
    let mut buffered = BufReader::new(Read::take(f, span.len));
    Ok(match comp {
        None => Box::new(buffered),
        Some(Comp::Gz) => Box::new(flate2::bufread::MultiGzDecoder::new(buffered)),
        Some(Comp::Bz2) => Box::new(bzip2_rs::DecoderReader::new(buffered)),
        Some(Comp::Xz) => Box::new(lzma_rust2::XzReader::new_mem_limit(
            buffered, true, XZ_MEM_KB,
        )),
        Some(Comp::Zst) => {
            let cap = zip::zstd_window(zstd_content_size(buffered.fill_buf()?).unwrap_or(0));
            match ruzstd::decoding::StreamingDecoder::new_with_max_window_size(buffered, cap) {
                Ok(d) => Box::new(d),
                Err(ruzstd::decoding::errors::FrameDecoderError::WindowSizeTooBig {
                    requested,
                    ..
                }) => return Err(zip::needs_memory("This Zstandard stream", requested, cap)),
                Err(_) => {
                    return Err(Fault::Invalid(
                        "The Zstandard stream could not be read: it is damaged.".into(),
                    ))
                }
            }
        }
    })
}

/// The decompressed stream of `file`, from its start.
fn decoder<'a>(file: &'a File, comp: Comp) -> Result<Box<dyn Read + 'a>, Fault> {
    unpacked(file, Some(comp), Span::ALL)
}

/// `buf.len()` bytes at `at`; an error when the file ends first.
fn read_at(file: &File, at: u64, buf: &mut [u8]) -> io::Result<()> {
    let mut f = file;
    f.seek(SeekFrom::Start(at))?;
    f.read_exact(buf)
}

/// Bytes `at` to `at + len` of a file `size` long, or `None` when they run past its end.
fn bytes_at(file: &File, size: u64, at: u64, len: usize) -> Option<Vec<u8>> {
    if at.checked_add(len as u64)? > size {
        return None;
    }
    let mut buf = vec![0u8; len];
    read_at(file, at, &mut buf).ok()?;
    Some(buf)
}

/// By bytes, never by extension. `Ok(None)` is a file the app does not read as an archive.
fn detect(file: &File, size: u64) -> Result<Option<Format>, Fault> {
    let mut head = [0u8; 512];
    let mut f = file;
    f.seek(SeekFrom::Start(0))?;
    let n = read_up_to(f, &mut head)?;
    let head = &head[..n];
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        return Ok(Some(Format::Zip));
    }
    if head.starts_with(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
        return Ok(Some(Format::SevenZ));
    }
    if rar::is_rar(head) {
        return Ok(Some(Format::Rar));
    }
    if cab::is_cab(head) {
        return Ok(Some(Format::Cab));
    }
    if let Some(deb) = ar::is_ar(head) {
        return Ok(Some(Format::Ar(deb)));
    }
    if let Some(comp) = comp_of(head) {
        let mut first = [0u8; 512];
        let got = decoder(file, comp)
            .ok()
            .and_then(|r| read_up_to(r, &mut first).ok())
            .unwrap_or(0);
        return Ok(Some(if looks_like_tar(&first[..got]) {
            Format::Tar(Some(comp))
        } else {
            Format::Single(comp)
        }));
    }
    if looks_like_tar(head) {
        return Ok(Some(Format::Tar(None)));
    }
    if iso::is_iso(file, size) {
        return Ok(Some(Format::Iso));
    }
    // A zip with something in front of it (a self-extractor) has no magic at byte 0.
    Ok(zip::open(file, size).ok().map(|_| Format::Zip))
}

// ---- a lone compressed file -----------------------------------------------------------------------------------------

/// A gzip header's FNAME and MTIME; `None` for each when the header does not say.
fn gzip_header(file: &File) -> (Option<Vec<u8>>, Option<u32>) {
    let mut f = file;
    if f.seek(SeekFrom::Start(0)).is_err() {
        return (None, None);
    }
    let mut r = BufReader::new(f);
    let mut fixed = [0u8; 10];
    if r.read_exact(&mut fixed).is_err() {
        return (None, None);
    }
    let mtime = u32::from_le_bytes([fixed[4], fixed[5], fixed[6], fixed[7]]);
    let mtime = (mtime != 0).then_some(mtime);
    let flags = fixed[3];
    if flags & 4 != 0 {
        let mut xlen = [0u8; 2];
        if r.read_exact(&mut xlen).is_err() {
            return (None, mtime);
        }
        let skip = u64::from(u16::from_le_bytes(xlen));
        if io::copy(&mut Read::take(&mut r, skip), &mut io::sink()).ok() != Some(skip) {
            return (None, mtime);
        }
    }
    if flags & 8 == 0 {
        return (None, mtime);
    }
    let mut name = Vec::new();
    match Read::take(&mut r, 4_097).read_until(0, &mut name) {
        Ok(_) if name.last() == Some(&0) => {
            name.pop();
            (Some(name), mtime)
        }
        _ => (None, mtime),
    }
}

/// FNAME is Latin-1 by the format, but writers put UTF-8 in it; a name that is not UTF-8 reads as Latin-1.
fn gzip_name(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

/// `notes.txt.gz` is `notes.txt`; `x.gz` is `x`.
fn stem_of(file_name: &str) -> String {
    let stem = std::path::Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    sanitise(&stem, false).map_or_else(|| "file".to_owned(), |c| c.path)
}

/// What a lone Zstandard file's frame header declares it unpacks to.
fn zstd_declared(file: &File) -> Option<u64> {
    let mut head = [0u8; 18];
    let mut f = file;
    f.seek(SeekFrom::Start(0)).ok()?;
    let n = read_up_to(f, &mut head).ok()?;
    zstd_content_size(&head[..n])
}

fn single_entry(file: &File, file_name: &str, comp: Comp, size: u64) -> ArchiveEntry {
    let (fname, mtime) = if comp == Comp::Gz {
        gzip_header(file)
    } else {
        (None, None)
    };
    let named = fname.and_then(|b| {
        let decoded = gzip_name(&b);
        sanitise(&decoded, false).map(|c| (raw_name_of(&c, &decoded), c.path))
    });
    let (raw_name, path) = match named {
        Some((raw, path)) => (raw, path),
        None => (None, stem_of(file_name)),
    };
    let declared = if comp == Comp::Gz && size >= 18 {
        let mut f = file;
        let mut tail = [0u8; 4];
        f.seek(SeekFrom::End(-4))
            .and_then(|_| f.read_exact(&mut tail))
            .ok()
            .map(|_| u64::from(u32::from_le_bytes(tail)))
    } else if comp == Comp::Zst {
        zstd_declared(file)
    } else {
        None
    };
    ArchiveEntry {
        index: 0,
        path,
        kind: "file".into(),
        size: declared,
        packed: None,
        mtime: mtime.and_then(|m| iso_from_unix(i64::from(m), true)),
        encrypted: false,
        method: None,
        raw_name,
        link: None,
        offset: None,
        crc: None,
        host: None,
        mode: None,
        flags: None,
        comment: None,
    }
}

/// The lone file's decompressed stream, after checking it is still the `name` listed at `index`.
fn single_stream<'a>(
    file: &'a File,
    file_name: &str,
    comp: Comp,
    size: u64,
    index: u32,
    name: &str,
) -> Result<Box<dyn Read + 'a>, Fault> {
    let entry = single_entry(file, file_name, comp, size);
    if index != 0 || entry.path != name {
        return Err(changed());
    }
    decoder(file, comp)
}

fn read_single(
    file: &File,
    file_name: &str,
    comp: Comp,
    size: u64,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let reader = single_stream(file, file_name, comp, size, index, name)?;
    let out = slurp(reader, limits.entry).map_err(|_| damaged(name))?;
    if out.len() as u64 > limits.entry {
        // A gzip ISIZE wraps at 4 GB and a bz2 or xz stream declares nothing: no declared size is quoted.
        return Err(too_big_actual(name, None));
    }
    Ok(out)
}

// ---- the index: where each entry lies, kept for the last few archives ---------------------------------------------------

/// An archive as it was when its index was made: any change to its length or time drops the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Key {
    path: PathBuf,
    len: u64,
    modified: Option<SystemTime>,
}

impl Key {
    /// `path` is the canonical path the file was opened by.
    pub fn of(path: &Path, file: &File) -> io::Result<Key> {
        let meta = file.metadata()?;
        Ok(Key {
            path: path.to_path_buf(),
            len: meta.len(),
            modified: meta.modified().ok(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Debug)]
enum Slots {
    None,
    Zip(Vec<zip::Slot>),
    Tar(Vec<tar::Slot>),
    /// A 7z's parsed header: the blocks and where each entry lies in them.
    SevenZ(Box<sevenz_rust2::Archive>),
    Ar(Vec<ar::Part>),
    Cab(Box<cab::Cab>),
    Iso(Vec<iso::Slot>),
}

#[derive(Debug)]
pub struct Indexed {
    format: Format,
    slots: Slots,
}

/// How many archives keep their index.
const KEPT: usize = 4;

/// The indexes of the last `KEPT` archives listed or read. The lock is held only to look up or to insert.
pub struct Indexes(Mutex<VecDeque<(Key, Arc<Indexed>)>>);

impl Indexes {
    pub const fn new() -> Self {
        Indexes(Mutex::new(VecDeque::new()))
    }

    fn get(&self, key: &Key) -> Option<Arc<Indexed>> {
        let mut kept = self.0.lock().unwrap_or_else(|e| e.into_inner());
        kept.retain(|(k, _)| k.path != key.path || k == key);
        let at = kept.iter().position(|(k, _)| k == key)?;
        let found = kept.remove(at)?;
        let indexed = found.1.clone();
        kept.push_front(found);
        Some(indexed)
    }

    fn put(&self, key: Key, indexed: Arc<Indexed>) {
        let mut kept = self.0.lock().unwrap_or_else(|e| e.into_inner());
        kept.retain(|(k, _)| k.path != key.path);
        kept.push_front((key, indexed));
        kept.truncate(KEPT);
    }
}

impl Default for Indexes {
    fn default() -> Self {
        Self::new()
    }
}

/// The app's one set of indexes.
pub static INDEXES: Indexes = Indexes::new();

/// Where a call may find or keep an index: `None` builds one for the call alone.
pub struct Cache<'a> {
    pub indexes: &'a Indexes,
    pub key: Key,
}

/// The index of `file`, from `cache` or made now (and kept there). `Ok(None)` when it is not an archive the app reads.
/// A compressed tar is walked from its start by every read, so its index holds no slots.
fn indexed(
    file: &File,
    size: u64,
    limits: &Limits,
    cache: Option<&Cache>,
) -> Result<Option<Arc<Indexed>>, Fault> {
    if let Some(found) = cache.and_then(|c| c.indexes.get(&c.key)) {
        return Ok(Some(found));
    }
    let Some(format) = detect(file, size)? else {
        return Ok(None);
    };
    let slots = match format {
        Format::Zip => Slots::Zip(zip::list_slots(file, size, limits)?.1),
        Format::Tar(None) => Slots::Tar(tar::list_slots(file, None, size, limits)?.1),
        Format::Tar(Some(_)) | Format::Single(_) | Format::Rar => Slots::None,
        Format::SevenZ => Slots::SevenZ(Box::new(sevenz::open(file)?)),
        Format::Ar(deb) => Slots::Ar(ar::list(file, size, deb, limits)?.1),
        Format::Cab => Slots::Cab(Box::new(cab::list(file, size, limits)?.1)),
        Format::Iso => Slots::Iso(iso::list(file, size, limits)?.1),
    };
    let indexed = Arc::new(Indexed { format, slots });
    if let Some(c) = cache {
        c.indexes.put(c.key.clone(), indexed.clone());
    }
    Ok(Some(indexed))
}

// ---- the three calls ----------------------------------------------------------------------------------------------------

/// The listing of `file`; `Ok(None)` when it is not an archive the app reads. `file_name` names a lone `.gz`'s entry.
pub fn list(
    file: &File,
    file_name: &str,
    limits: &Limits,
    cache: Option<&Cache>,
) -> Result<Option<ArchiveListing>, Fault> {
    let size = file.metadata()?.len();
    let Some(format) = detect(file, size)? else {
        return Ok(None);
    };
    let (listing, slots) = match format {
        Format::Zip => {
            let (l, s) = zip::list_slots(file, size, limits)?;
            (l, Slots::Zip(s))
        }
        Format::Tar(comp) => {
            let (l, s) = tar::list_slots(file, comp, size, limits)?;
            (
                l,
                if comp.is_none() {
                    Slots::Tar(s)
                } else {
                    Slots::None
                },
            )
        }
        Format::SevenZ => {
            let (l, a) = sevenz::list(file, size, limits)?;
            (l, Slots::SevenZ(Box::new(a)))
        }
        Format::Single(comp) => (
            ArchiveListing {
                format: format.name().into(),
                entries: vec![single_entry(file, file_name, comp, size)],
                comment: None,
                truncated: None,
                skipped: 0,
                declared: None,
                size,
                unpacked: None,
                directory: None,
                note: None,
            },
            Slots::None,
        ),
        Format::Ar(deb) => {
            let (l, parts) = ar::list(file, size, deb, limits)?;
            (l, Slots::Ar(parts))
        }
        Format::Cab => {
            let (l, cab) = cab::list(file, size, limits)?;
            (l, Slots::Cab(Box::new(cab)))
        }
        Format::Iso => {
            let (l, slots) = iso::list(file, size, limits)?;
            (l, Slots::Iso(slots))
        }
        Format::Rar => (rar::list(file, size, limits)?, Slots::None),
    };
    if let Some(c) = cache {
        c.indexes
            .put(c.key.clone(), Arc::new(Indexed { format, slots }));
    }
    Ok(Some(listing))
}

/// Entry `index` of `file`, which must be the `name` the page listed there.
pub fn read(
    file: &File,
    file_name: &str,
    index: u32,
    name: &str,
    limits: &Limits,
    cache: Option<&Cache>,
) -> Result<Vec<u8>, Fault> {
    let size = file.metadata()?.len();
    let indexed = indexed(file, size, limits, cache)?.ok_or_else(not_archive)?;
    match (indexed.format, &indexed.slots) {
        (Format::Zip, Slots::Zip(slots)) => zip::read_slot(file, size, slots, index, name, limits),
        (Format::Tar(None), Slots::Tar(slots)) => tar::read_plain(file, slots, index, name, limits),
        (Format::Tar(comp), _) => tar::read(file, comp, index, name, limits),
        (Format::Single(comp), _) => read_single(file, file_name, comp, size, index, name, limits),
        (Format::Zip, _) => zip::read(file, size, index, name, limits),
        (Format::SevenZ, Slots::SevenZ(a)) => sevenz::read(file, a, index, name, limits),
        (Format::SevenZ, _) => sevenz::read(file, &sevenz::open(file)?, index, name, limits),
        (Format::Ar(_), Slots::Ar(parts)) => ar::read(file, parts, index, name, limits),
        (Format::Cab, Slots::Cab(cab)) => cab::read(file, size, cab, index, name, limits),
        (Format::Iso, Slots::Iso(slots)) => iso::read(file, size, slots, index, name, limits),
        (Format::Rar, _) => Err(rar::refused()),
        (Format::Ar(_) | Format::Cab | Format::Iso, _) => Err(changed()),
    }
}

/// The first bytes of each wanted entry, in the order of `wants`: at most `max_each` (1 to `Limits::head`) each, and as
/// many wants as `Limits::heads` holds at that size; the rest are left out for the page to ask again. A want the archive
/// cannot answer is refused with its sentence; only a fault reaching the file itself fails the call.
pub fn heads(
    file: &File,
    file_name: &str,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
    cache: Option<&Cache>,
) -> Result<Vec<Head>, Fault> {
    let max_each = max_each.clamp(1, limits.head.max(1));
    let served = usize::try_from(limits.heads / max_each).unwrap_or(usize::MAX);
    let wants = &wants[..wants.len().min(served)];
    let size = file.metadata()?.len();
    let indexed = indexed(file, size, limits, cache)?.ok_or_else(not_archive)?;
    match (indexed.format, &indexed.slots) {
        (Format::Zip, Slots::Zip(slots)) => zip::heads(file, size, slots, wants, max_each),
        (Format::Zip, _) => {
            let (_, slots) = zip::list_slots(file, size, limits)?;
            zip::heads(file, size, &slots, wants, max_each)
        }
        (Format::Tar(None), Slots::Tar(slots)) => {
            tar::heads(file, None, Some(slots), wants, max_each, limits)
        }
        (Format::Tar(comp), _) => tar::heads(file, comp, None, wants, max_each, limits),
        (Format::SevenZ, Slots::SevenZ(a)) => sevenz::heads(file, a, wants, max_each, limits),
        (Format::SevenZ, _) => sevenz::heads(file, &sevenz::open(file)?, wants, max_each, limits),
        (Format::Single(comp), _) => wants
            .iter()
            .map(|w| {
                let got = single_stream(file, file_name, comp, size, w.index, &w.name)
                    .and_then(|r| head_of(r, max_each).map_err(|_| damaged(&w.name)));
                Head::of(w.index, got)
            })
            .collect(),
        (Format::Ar(_), Slots::Ar(parts)) => ar::heads(file, parts, wants, max_each, limits),
        (Format::Cab, Slots::Cab(cab)) => cab::heads(file, size, cab, wants, max_each, limits),
        (Format::Iso, Slots::Iso(slots)) => iso::heads(file, size, slots, wants, max_each),
        (Format::Rar, _) => wants
            .iter()
            .map(|w| Head::of(w.index, Err(rar::refused())))
            .collect(),
        (Format::Ar(_) | Format::Cab | Format::Iso, _) => Err(changed()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(raw: &str) -> String {
        sanitise(raw, false).unwrap().path
    }

    #[test]
    fn sanitising_drops_everything_that_could_name_a_place() {
        assert_eq!(clean("../../evil.txt"), "evil.txt");
        assert_eq!(clean("/etc/passwd"), "etc/passwd");
        assert_eq!(clean("C:\\Windows\\win.ini"), "Windows/win.ini");
        assert_eq!(clean("a/../../b.txt"), "a/b.txt");
        assert_eq!(clean("//?/C:/x/y"), "x/y");
        assert_eq!(clean("\\\\?\\D:\\x"), "x");
        assert_eq!(clean("./a//b/./c"), "a/b/c");
        assert_eq!(clean("a/C:/b"), "a/C:/b");
        assert_eq!(clean("tab\there"), "tab\u{fffd}here");
        assert_eq!(sanitise("docs/", true).unwrap().path, "docs/");
        assert_eq!(sanitise("docs", true).unwrap().path, "docs/");
        for none in ["", "/", "..", "../..", "C:", "C:\\", "//?/", "./."] {
            assert_eq!(sanitise(none, false), None, "{none:?}");
        }
    }

    #[test]
    fn sanitising_says_when_it_changed_more_than_slashes() {
        assert!(!sanitise("docs\\a.md", false).unwrap().changed);
        assert!(!sanitise("docs/", true).unwrap().changed);
        assert!(!sanitise("docs", true).unwrap().changed);
        for raw in [
            "../../evil.txt",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "a//b",
            "x\u{1}y",
        ] {
            assert!(sanitise(raw, false).unwrap().changed, "{raw:?}");
        }
        assert_eq!(sanitise("a/b/c", false).unwrap().depth, 3);
    }

    #[test]
    fn numbers_and_sizes_read_the_way_the_page_does() {
        assert_eq!(commas(0), "0");
        assert_eq!(commas(999), "999");
        assert_eq!(commas(100_000), "100,000");
        assert_eq!(commas(1_234_567), "1,234,567");
        assert_eq!(size_words(1), "1 byte");
        assert_eq!(size_words(312), "312 bytes");
        assert_eq!(size_words(4096), "4.0 KB");
        assert_eq!(size_words(20 * 1024 * 1024), "20.0 MB");
        assert_eq!(size_words(3 * 1024 * 1024 * 1024), "3.0 GB");
    }

    #[test]
    fn dates_are_civil_and_zoned_only_when_known() {
        assert_eq!(iso_from_unix(0, true).unwrap(), "1970-01-01T00:00:00Z");
        assert_eq!(
            iso_from_unix(1_700_000_000, true).unwrap(),
            "2023-11-14T22:13:20Z"
        );
        assert_eq!(
            iso_from_unix(951_782_400, false).unwrap(),
            "2000-02-29T00:00:00"
        );
        assert_eq!(
            iso_from_unix(-86_400, true).unwrap(),
            "1969-12-31T00:00:00Z"
        );
    }

    #[test]
    fn a_tar_header_is_told_by_ustar_or_by_its_checksum() {
        let mut v7 = [0u8; 512];
        v7[..5].copy_from_slice(b"a.txt");
        let sum: u32 = v7
            .iter()
            .enumerate()
            .map(|(i, &b)| {
                if (148..156).contains(&i) {
                    32
                } else {
                    u32::from(b)
                }
            })
            .sum();
        v7[148..155].copy_from_slice(format!("{sum:06o}\0").as_bytes());
        assert!(looks_like_tar(&v7));
        v7[0] = b'b';
        assert!(!looks_like_tar(&v7));
        let mut ustar = [0u8; 512];
        ustar[257..262].copy_from_slice(b"ustar");
        assert!(looks_like_tar(&ustar));
        assert!(!looks_like_tar(&[0u8; 512]));
        assert!(!looks_like_tar(b"short"));
    }

    // ---- the shared table, heads and the index ---------------------------------------------------

    use serde_json::Value;
    use std::path::PathBuf;

    fn shared_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/archives")
    }

    fn table() -> Value {
        serde_json::from_slice(&std::fs::read(shared_dir().join("expected.json")).unwrap()).unwrap()
    }

    fn temp_file(name: &str, bytes: &[u8]) -> (PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-arch-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        let file = File::open(&path).unwrap();
        (dir, file)
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn opt<T: Into<Value>>(v: Option<T>) -> Value {
        v.map_or(Value::Null, Into::into)
    }

    /// Each listed entry's offset, CRC, system, mode, flags and comment, and the directory, as the table records them;
    /// `shift` is a prefix written before the archive.
    fn check_listing(listing: &ArchiveListing, want: &Value, shift: u64) {
        assert_eq!(listing.format, want["format"]);
        let directory = listing
            .directory
            .map(|d| serde_json::json!({ "at": d.at - shift, "size": d.size }));
        assert_eq!(opt(directory), want["directory"]);
        let rows = want["entries"].as_array().unwrap();
        assert_eq!(listing.entries.len(), rows.len());
        for (e, w) in listing.entries.iter().zip(rows) {
            let at = &w["path"];
            assert_eq!(Value::from(e.index), w["index"], "{at}");
            assert_eq!(Value::from(e.path.as_str()), w["path"]);
            assert_eq!(opt(e.size), w["size"], "{at} size");
            assert_eq!(opt(e.offset.map(|o| o - shift)), w["offset"], "{at} offset");
            assert_eq!(opt(e.crc), w["crc"], "{at} crc");
            assert_eq!(opt(e.host.clone()), w["host"], "{at} host");
            assert_eq!(opt(e.mode), w["mode"], "{at} mode");
            assert_eq!(opt(e.flags), w["flags"], "{at} flags");
            assert_eq!(opt(e.comment.clone()), w["comment"], "{at} comment");
        }
    }

    fn wants_of(listing: &ArchiveListing) -> Vec<Want> {
        listing
            .entries
            .iter()
            .map(|e| Want {
                index: e.index,
                name: e.path.clone(),
            })
            .collect()
    }

    fn check_heads(heads: &[Head], want: &Value) {
        let rows = want["entries"].as_array().unwrap();
        assert_eq!(heads.len(), rows.len());
        for (h, w) in heads.iter().zip(rows) {
            let at = &w["path"];
            assert_eq!(Value::from(h.index), w["index"]);
            match w["head"]["refused"].as_str() {
                Some(m) => {
                    assert_eq!(h.refused.as_deref(), Some(m), "{at}");
                    assert!(h.bytes.is_empty() && !h.whole, "{at}");
                }
                None => {
                    assert_eq!(h.refused, None, "{at}");
                    assert_eq!(Value::from(hex(&h.bytes)), w["head"]["hex"], "{at}");
                    assert_eq!(Value::from(h.whole), w["head"]["whole"], "{at}");
                }
            }
        }
    }

    #[test]
    fn the_shared_table_lists_entry_by_entry_and_heads_match_it() {
        let table = table();
        let max_each = table["maxEach"].as_u64().unwrap();
        for name in ["shared.zip", "shared.tar.gz"] {
            let want = &table["archives"][name];
            let file = File::open(shared_dir().join(name)).unwrap();
            let listing = list(&file, name, &Limits::DEFAULT, None).unwrap().unwrap();
            check_listing(&listing, want, 0);
            let heads = heads(
                &file,
                name,
                &wants_of(&listing),
                max_each,
                &Limits::DEFAULT,
                None,
            )
            .unwrap();
            check_heads(&heads, want);
        }
    }

    #[test]
    fn a_prefix_shifts_every_offset_and_the_directory_by_its_length() {
        let table = table();
        let mut bytes = b"MZ a self-extractor's stub, 31 b".to_vec();
        let shift = bytes.len() as u64;
        bytes.extend(std::fs::read(shared_dir().join("shared.zip")).unwrap());
        let (dir, file) = temp_file("prefixed.zip", &bytes);
        let listing = list(&file, "prefixed.zip", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        check_listing(&listing, &table["archives"]["shared.zip"], shift);
        let max_each = table["maxEach"].as_u64().unwrap();
        let heads = heads(
            &file,
            "prefixed.zip",
            &wants_of(&listing),
            max_each,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        check_heads(&heads, &table["archives"]["shared.zip"]);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The heads of ten entries of a tar.gz come from one walk of its stream, counted.
    #[test]
    fn ten_heads_of_a_tar_gz_take_one_walk() {
        let file = File::open(shared_dir().join("shared.tar.gz")).unwrap();
        let listing = list(&file, "shared.tar.gz", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        let mut wants: Vec<Want> = wants_of(&listing).into_iter().skip(1).take(10).collect();
        wants.reverse();
        let before = tar::WALKS.with(|w| w.get());
        let got = heads(&file, "shared.tar.gz", &wants, 1024, &Limits::DEFAULT, None).unwrap();
        assert_eq!(tar::WALKS.with(|w| w.get()) - before, 1);
        assert_eq!(got.len(), 10);
        let order: Vec<u32> = got.iter().map(|h| h.index).collect();
        assert_eq!(
            order,
            (1..=10).rev().collect::<Vec<u32>>(),
            "in the order asked"
        );
        for h in &got {
            let i = h.index as usize - 1;
            assert_eq!(h.bytes, format!("file {i}\n").repeat(i * 9 + 1).as_bytes());
            assert!(h.whole && h.refused.is_none());
        }
    }

    #[test]
    fn whole_says_whether_the_entry_ended_and_the_bytes_are_its_beginning() {
        let file = File::open(shared_dir().join("shared.tar.gz")).unwrap();
        let wants = [
            Want {
                index: 1,
                name: "src/f00.txt".into(),
            },
            Want {
                index: 13,
                name: "src/big.txt".into(),
            },
        ];
        let got = heads(&file, "shared.tar.gz", &wants, 100, &Limits::DEFAULT, None).unwrap();
        assert_eq!(
            (got[0].bytes.as_slice(), got[0].whole),
            (&b"file 0\n"[..], true)
        );
        let big = "a big line of text\n".repeat(280);
        assert_eq!(got[1].bytes, &big.as_bytes()[..100]);
        assert!(!got[1].whole);
        let got = heads(
            &file,
            "shared.tar.gz",
            &wants[1..],
            1 << 30,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!(
            (got[0].bytes.len(), got[0].whole),
            (big.len(), true),
            "maxEach is clamped, not refused"
        );
        let got = heads(
            &file,
            "shared.tar.gz",
            &wants[..1],
            0,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!(
            (got[0].bytes.as_slice(), got[0].whole),
            (&b"f"[..], false),
            "and at least 1"
        );
    }

    /// Heads stop at the budget in all; the wants past it are left out, not refused.
    #[test]
    fn heads_stop_at_the_budget_and_leave_the_rest_out() {
        let file = File::open(shared_dir().join("shared.zip")).unwrap();
        let listing = list(&file, "shared.zip", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        let wants = wants_of(&listing);
        let tight = Limits {
            heads: 3 * 64,
            head: 64,
            ..Limits::DEFAULT
        };
        let got = heads(&file, "shared.zip", &wants, 64, &tight, None).unwrap();
        assert_eq!(got.iter().map(|h| h.index).collect::<Vec<_>>(), [0, 1, 2]);
        let got = heads(&file, "shared.zip", &wants, 1 << 20, &tight, None).unwrap();
        assert_eq!(got.len(), 3, "maxEach past the per-head cap is the cap");
        assert!(got.iter().map(|h| h.bytes.len() as u64).sum::<u64>() <= tight.heads);
        assert_eq!(Limits::DEFAULT.heads / Limits::DEFAULT.head, 64);
    }

    #[test]
    fn a_want_that_does_not_match_is_refused_and_the_call_goes_on() {
        for name in ["shared.zip", "shared.tar.gz"] {
            let file = File::open(shared_dir().join(name)).unwrap();
            let wants = [
                Want {
                    index: 1,
                    name: "not/what/was/listed".into(),
                },
                Want {
                    index: 999,
                    name: "gone".into(),
                },
                Want {
                    index: 0,
                    name: if name == "shared.zip" {
                        "docs/"
                    } else {
                        "src/"
                    }
                    .into(),
                },
            ];
            let got = heads(&file, name, &wants, 64, &Limits::DEFAULT, None).unwrap();
            let said: Vec<_> = got.iter().map(|h| h.refused.as_deref().unwrap()).collect();
            assert_eq!(
                said,
                [
                    "The archive changed since it was listed.",
                    "The archive changed since it was listed.",
                    "A folder has nothing to open."
                ],
                "{name}"
            );
        }
    }

    #[test]
    fn heads_of_a_lone_gz_and_a_file_that_is_no_archive() {
        let body = b"a lone file, longer than eight bytes".to_vec();
        let (dir, file) = temp_file("lone.txt.gz", &testkit::gzip(&body));
        let want = |name: &str| Want {
            index: 0,
            name: name.into(),
        };
        let got = heads(
            &file,
            "lone.txt.gz",
            &[want("lone.txt"), want("other")],
            8,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!((got[0].bytes.as_slice(), got[0].whole), (&body[..8], false));
        assert_eq!(
            got[1].refused.as_deref(),
            Some("The archive changed since it was listed.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let (dir, file) = temp_file("plain.txt", b"just some text, not an archive");
        assert!(
            matches!(heads(&file, "plain.txt", &[want("x")], 8, &Limits::DEFAULT, None), Err(Fault::Invalid(m)) if m == "This file is not an archive.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_index_is_kept_for_four_archives_and_dropped_when_one_changes() {
        let indexes = Indexes::new();
        let mut dirs = Vec::new();
        let mut keys = Vec::new();
        for i in 0..5 {
            let bytes = testkit::zip(&[testkit::Z::stored(&format!("f{i}.txt"), b"one")], b"");
            let (dir, file) = temp_file(&format!("kept{i}.zip"), &bytes);
            let key = Key::of(&dir.join(format!("kept{i}.zip")), &file).unwrap();
            let cache = Cache {
                indexes: &indexes,
                key: key.clone(),
            };
            list(&file, "a.zip", &Limits::DEFAULT, Some(&cache)).unwrap();
            keys.push(key);
            dirs.push(dir);
        }
        assert!(indexes.get(&keys[0]).is_none(), "the oldest went");
        assert!(keys[1..].iter().all(|k| indexes.get(k).is_some()));

        // The same path written again: its old index is not used, and a read finds the new entry.
        let path = dirs[4].join("kept4.zip");
        std::fs::write(
            &path,
            testkit::zip(&[testkit::Z::stored("new-name.txt", b"fresh bytes")], b""),
        )
        .unwrap();
        let file = File::open(&path).unwrap();
        let key = Key::of(&path, &file).unwrap();
        assert_ne!(key, keys[4]);
        let cache = Cache {
            indexes: &indexes,
            key,
        };
        assert_eq!(
            read(
                &file,
                "a.zip",
                0,
                "new-name.txt",
                &Limits::DEFAULT,
                Some(&cache)
            )
            .unwrap(),
            b"fresh bytes"
        );
        assert!(
            indexes.get(&cache.key).is_some(),
            "a read keeps the index it made"
        );
        assert!(
            indexes.get(&keys[4]).is_none(),
            "the stale index was dropped"
        );
        drop(file);
        for dir in dirs {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    // ---- Zstandard ------------------------------------------------------------------------------------------------

    fn zst(bytes: &[u8]) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(bytes, ruzstd::encoding::CompressionLevel::Fastest)
    }

    #[test]
    fn a_lone_zst_is_its_one_file_and_a_tar_zst_lists_its_tar() {
        let body = b"a zstandard body, said twice. ".repeat(40);
        let (dir, file) = temp_file("notes.txt.zst", &zst(&body));
        let l = list(&file, "notes.txt.zst", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "zst");
        assert_eq!(l.entries.len(), 1);
        assert_eq!(l.entries[0].path, "notes.txt");
        assert_eq!(
            read(
                &file,
                "notes.txt.zst",
                0,
                "notes.txt",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            body
        );
        let h = heads(
            &file,
            "notes.txt.zst",
            &[Want {
                index: 0,
                name: "notes.txt".into(),
            }],
            9,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!((h[0].bytes.as_slice(), h[0].whole), (&body[..9], false));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        let tar = testkit::tar(&[
            (b"src/", testkit::T::Dir, b""),
            (b"src/main.rs", testkit::T::File, b"fn main() {}\n"),
        ]);
        let (dir, file) = temp_file("code.tar.zst", &zst(&tar));
        let l = list(&file, "code.tar.zst", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "tar.zst");
        let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["src/", "src/main.rs"]);
        assert_eq!(
            read(
                &file,
                "code.tar.zst",
                1,
                "src/main.rs",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"fn main() {}\n"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_frame_header_says_its_content_size_in_each_width() {
        assert_eq!(
            zstd_content_size(&[0x28, 0xb5, 0x2f, 0xfd, 0x20, 42]),
            Some(42),
            "one byte, single segment"
        );
        assert_eq!(
            zstd_content_size(&[0x28, 0xb5, 0x2f, 0xfd, 0x40, 0x58, 0x00, 0x01]),
            Some(256 + 256),
            "two bytes count from 256"
        );
        assert_eq!(
            zstd_content_size(&[0x28, 0xb5, 0x2f, 0xfd, 0x80, 0x58, 0, 0, 0, 1]),
            Some(1 << 24),
            "four bytes after the window"
        );
        assert_eq!(
            zstd_content_size(&[0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x58]),
            None,
            "not declared"
        );
        assert_eq!(
            zstd_content_size(&[0x28, 0xb5, 0x2f, 0xfd, 0x80]),
            None,
            "cut short"
        );
    }

    #[test]
    fn a_zstd_bomb_stops_at_the_entry_cap_and_a_wide_window_is_refused_before_it_is_made() {
        let zeros = vec![0u8; 3 * 1024 * 1024];
        let packed = zst(&zeros);
        assert!(packed.len() < zeros.len() / 100);
        let (dir, file) = temp_file("bomb.zst", &packed);
        let tight = Limits {
            entry: 1024 * 1024,
            ..Limits::DEFAULT
        };
        let started = std::time::Instant::now();
        assert!(
            matches!(read(&file, "bomb.zst", 0, "bomb", &tight, None), Err(Fault::Refused(m))
            if m == "bomb unpacks past the 16 MB an entry may open with.")
        );
        assert!(started.elapsed().as_secs() < 10);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        // No content size and a window descriptor asking for 2^30 bytes.
        let mut wide = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xa0];
        wide.extend([0u8; 8]);
        let (dir, file) = temp_file("wide.zst", &wide);
        let l = list(&file, "wide.zst", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "zst");
        assert!(
            matches!(read(&file, "wide.zst", 0, "wide", &Limits::DEFAULT, None), Err(Fault::Refused(m))
            if m == "This Zstandard stream needs 1.0 GB of memory to unpack, over the 8 MB the app gives this entry.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
