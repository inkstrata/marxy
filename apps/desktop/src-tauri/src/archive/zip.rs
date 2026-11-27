//! A zip read by hand: `ZipArchive::new` parses the whole central directory before it returns, and a listing has to
//! stop at its caps while streaming. The end record is found in the file's tail, the central directory is walked
//! through a buffered reader, and an entry's bytes are read from its local header only for `read`.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};

use super::{
    changed, commas, damaged, folder, head_of, iso_from_unix, raw_name_of, sanitise, shown_text,
    size_words, too_big_actual, too_big_declared, ArchiveEntry, ArchiveListing, Directory, Fault,
    Head, Limits, Want, XZ_MEM_KB,
};

const EOCD_SIG: &[u8; 4] = b"PK\x05\x06";
const EOCD64_SIG: &[u8; 4] = b"PK\x06\x06";
const LOCATOR_SIG: &[u8; 4] = b"PK\x06\x07";
const CD_SIG: &[u8; 4] = b"PK\x01\x02";
const LOCAL_SIG: &[u8; 4] = b"PK\x03\x04";
/// The end record is 22 bytes and its comment at most 65,535.
const TAIL: u64 = 65_557;
/// The most an LZMA dictionary may ask for, as the xz and 7z readers allow.
const DICTIONARY: u64 = XZ_MEM_KB as u64 * 1024;
/// The bounds of a Zstandard window, which is also what its decoder holds before it gives out a byte.
const ZSTD_WINDOW_MIN: u64 = 8 * 1024 * 1024;
const ZSTD_WINDOW_MAX: u64 = 32 * 1024 * 1024;

const CP437_HIGH: &str = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u{a0}";

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(a)
}

/// Where the central directory is and what the end record says about it.
#[derive(Debug)]
pub struct End {
    base: u64,
    cd_off: u64,
    cd_size: u64,
    declared: u64,
    comment: Vec<u8>,
}

#[derive(Debug)]
pub enum OpenError {
    NotZip,
    Unsupported(&'static str),
    Damaged(String),
}

impl OpenError {
    fn fault(self) -> Fault {
        match self {
            OpenError::NotZip => Fault::Invalid("This file is not a zip archive.".into()),
            OpenError::Unsupported(m) => Fault::Unsupported(m.into()),
            OpenError::Damaged(m) => Fault::Invalid(format!("The listing could not be read: {m}.")),
        }
    }
}

fn io_damage(e: io::Error) -> OpenError {
    OpenError::Damaged(format!("the file ended early ({e})"))
}

fn read_at(file: &File, at: u64, buf: &mut [u8]) -> io::Result<()> {
    let mut f = file;
    f.seek(SeekFrom::Start(at))?;
    f.read_exact(buf)
}

/// Finds the end record in the last 65,557 bytes (a prefixed archive has no magic at byte 0), follows the zip64
/// locator when a field is saturated, and works out how far the archive is shifted from byte 0.
pub fn open(file: &File, len: u64) -> Result<End, OpenError> {
    let tail_len = len.min(TAIL);
    let mut tail = vec![0u8; tail_len as usize];
    read_at(file, len - tail_len, &mut tail).map_err(io_damage)?;
    let at = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| {
            tail[i..i + 4] == EOCD_SIG[..]
                && i + 22 + usize::from(u16_at(&tail, i + 20)) <= tail.len()
        })
        .ok_or(OpenError::NotZip)?;
    let eocd_pos = len - tail_len + at as u64;
    let rec = &tail[at..];
    let comment_len = usize::from(u16_at(rec, 20));
    let comment = rec[22..22 + comment_len].to_vec();
    let (mut disk, mut cd_disk) = (u32::from(u16_at(rec, 4)), u32::from(u16_at(rec, 6)));
    let (mut on_disk, mut total) = (u64::from(u16_at(rec, 8)), u64::from(u16_at(rec, 10)));
    let (mut cd_size, mut cd_off) = (u64::from(u32_at(rec, 12)), u64::from(u32_at(rec, 16)));
    let saturated = u16_at(rec, 4) == 0xffff
        || u16_at(rec, 6) == 0xffff
        || u16_at(rec, 8) == 0xffff
        || u16_at(rec, 10) == 0xffff
        || u32_at(rec, 12) == 0xffff_ffff
        || u32_at(rec, 16) == 0xffff_ffff;
    let mut end_pos = eocd_pos;
    if saturated && eocd_pos >= 20 {
        let mut loc = [0u8; 20];
        read_at(file, eocd_pos - 20, &mut loc).map_err(io_damage)?;
        if loc[..4] == LOCATOR_SIG[..] {
            let declared_at = u64_at(&loc, 8);
            // The record normally sits right before its locator; the declared offset is relative to the archive's own
            // start, which a prefix shifts.
            let candidates = [declared_at, eocd_pos.saturating_sub(20 + 56)];
            let mut z = [0u8; 56];
            let found = candidates
                .into_iter()
                .find(|&c| read_at(file, c, &mut z).is_ok() && z[..4] == EOCD64_SIG[..]);
            let Some(pos) = found else {
                return Err(OpenError::Damaged("the zip64 end record is missing".into()));
            };
            end_pos = pos;
            disk = u32_at(&z, 16);
            cd_disk = u32_at(&z, 20);
            on_disk = u64_at(&z, 24);
            total = u64_at(&z, 32);
            cd_size = u64_at(&z, 40);
            cd_off = u64_at(&z, 48);
        }
    }
    if disk != 0 || cd_disk != 0 || on_disk != total {
        return Err(OpenError::Unsupported(
            "a zip split across several files is not read.",
        ));
    }
    let cd_end = cd_off
        .checked_add(cd_size)
        .filter(|&e| e <= len)
        .ok_or_else(|| {
            OpenError::Damaged("the central directory lies past the end of the file".into())
        })?;
    let base = end_pos.saturating_sub(cd_end);
    if total > 0 {
        let mut sig = [0u8; 4];
        let first = base.checked_add(cd_off).ok_or_else(|| {
            OpenError::Damaged("the central directory lies past the end of the file".into())
        })?;
        if read_at(file, first, &mut sig).is_err() || sig != CD_SIG[..] {
            return Err(OpenError::Damaged(
                "the central directory is missing".into(),
            ));
        }
    }
    Ok(End {
        base,
        cd_off,
        cd_size,
        declared: total,
        comment,
    })
}

// ---- the central directory ---------------------------------------------------------------------------------------------

#[derive(Debug)]
struct Rec {
    name: Vec<u8>,
    flags: u16,
    method: u16,
    crc: u32,
    csize: Option<u64>,
    size: Option<u64>,
    lho: Option<u64>,
    ext_attr: u32,
    made_by: u16,
    dos: (u16, u16),
    utc: Option<i64>,
    unicode: Option<String>,
    comment: Vec<u8>,
}

struct Cd<'a> {
    r: BufReader<io::Take<&'a File>>,
    declared: u64,
    next: u64,
}

impl<'a> Cd<'a> {
    fn new(file: &'a File, end: &End) -> io::Result<Self> {
        let mut f = file;
        f.seek(SeekFrom::Start(end.base + end.cd_off))?;
        Ok(Cd {
            r: BufReader::new(Read::take(f, end.cd_size)),
            declared: end.declared,
            next: 0,
        })
    }

    /// The next record; `Ok(None)` after the declared count. An `Err` names the damage.
    fn next(&mut self) -> Result<Option<Rec>, String> {
        if self.next >= self.declared {
            return Ok(None);
        }
        self.next += 1;
        let mut fixed = [0u8; 46];
        self.r
            .read_exact(&mut fixed)
            .map_err(|_| "the central directory ends early".to_owned())?;
        if fixed[..4] != CD_SIG[..] {
            return Err("a central directory record is not where it should be".into());
        }
        let (n, x, c) = (
            usize::from(u16_at(&fixed, 28)),
            usize::from(u16_at(&fixed, 30)),
            usize::from(u16_at(&fixed, 32)),
        );
        let mut var = vec![0u8; n + x + c];
        self.r
            .read_exact(&mut var)
            .map_err(|_| "the central directory ends early".to_owned())?;
        let name = var[..n].to_vec();
        let extra = &var[n..n + x];
        let sat32 = |v: u32| (v == 0xffff_ffff).then_some(());
        let (mut csize, mut size, mut lho) = (
            Some(u64::from(u32_at(&fixed, 20))),
            Some(u64::from(u32_at(&fixed, 24))),
            Some(u64::from(u32_at(&fixed, 42))),
        );
        let (need_size, need_csize, need_lho) = (
            sat32(u32_at(&fixed, 24)).is_some(),
            sat32(u32_at(&fixed, 20)).is_some(),
            sat32(u32_at(&fixed, 42)).is_some(),
        );
        if need_size {
            size = None;
        }
        if need_csize {
            csize = None;
        }
        if need_lho {
            lho = None;
        }
        let mut utc = None;
        let mut unicode = None;
        let mut at = 0;
        while at + 4 <= extra.len() {
            let (id, len) = (u16_at(extra, at), usize::from(u16_at(extra, at + 2)));
            let Some(data) = extra.get(at + 4..at + 4 + len) else {
                break;
            };
            at += 4 + len;
            match id {
                0x0001 => {
                    // Present in this order, each only when its 32-bit field is saturated.
                    let mut off = 0;
                    let mut take = |want: bool| -> Option<u64> {
                        if !want {
                            return None;
                        }
                        let v = data.get(off..off + 8).map(|_| u64_at(data, off));
                        off += 8;
                        v
                    };
                    if need_size {
                        size = take(true);
                    }
                    if need_csize {
                        csize = take(true);
                    }
                    if need_lho {
                        lho = take(true);
                    }
                }
                0x5455 if data.len() >= 5 && data[0] & 1 != 0 => {
                    utc = Some(i64::from(u32_at(data, 1) as i32));
                }
                // Honoured only when written for this very header name.
                0x7075
                    if data.len() >= 5
                        && data[0] == 1
                        && crc32fast::hash(&name) == u32_at(data, 1) =>
                {
                    unicode = std::str::from_utf8(&data[5..]).ok().map(str::to_owned);
                }
                _ => {}
            }
        }
        Ok(Some(Rec {
            name,
            flags: u16_at(&fixed, 8),
            method: u16_at(&fixed, 10),
            crc: u32_at(&fixed, 16),
            csize,
            size,
            lho,
            ext_attr: u32_at(&fixed, 38),
            made_by: u16_at(&fixed, 4),
            dos: (u16_at(&fixed, 12), u16_at(&fixed, 14)),
            utc,
            unicode,
            comment: var[n + x..].to_vec(),
        }))
    }
}

// ---- one record as the page sees it ------------------------------------------------------------------------------------

pub(super) fn decode_name(raw: &[u8], flags: u16) -> String {
    if flags & 0x800 != 0 {
        return String::from_utf8_lossy(raw).into_owned();
    }
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_owned(),
        Err(_) => {
            static HIGH: std::sync::OnceLock<Vec<char>> = std::sync::OnceLock::new();
            let high = HIGH.get_or_init(|| CP437_HIGH.chars().collect());
            raw.iter()
                .map(|&b| {
                    if b < 0x80 {
                        b as char
                    } else {
                        high.get(usize::from(b - 0x80))
                            .copied()
                            .unwrap_or('\u{fffd}')
                    }
                })
                .collect()
        }
    }
}

/// A DOS date and time: local, no zone, so it is given without a "Z".
pub(super) fn dos_text((time, date): (u16, u16)) -> Option<String> {
    let (y, m, d) = (1980 + i64::from(date >> 9), (date >> 5) & 15, date & 31);
    let (h, mi, s) = (time >> 11, (time >> 5) & 63, (time & 31) * 2);
    if date == 0 || !(1..=12).contains(&m) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 59
    {
        return None;
    }
    Some(format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}"))
}

/// The methods `entry_bytes` unpacks: stored, deflate, Deflate64, bzip2, LZMA, Zstandard (93, and 20 that it
/// replaced) and xz.
fn is_read(method: u16) -> bool {
    matches!(method, 0 | 8 | 9 | 12 | 14 | 20 | 93 | 95)
}

/// The name of a method the app does not read; `None` for one it does.
fn method_label(method: u16) -> Option<String> {
    if is_read(method) {
        return None;
    }
    Some(
        match method {
            98 => "ppmd",
            99 => "AES",
            n => return Some(format!("method {n}")),
        }
        .to_owned(),
    )
}

/// The system that wrote the entry, from the high byte of "version made by".
fn host_name(made_by: u16) -> String {
    match made_by >> 8 {
        0 => "DOS or Windows",
        3 => "Unix",
        10 => "Windows NTFS",
        11 => "VFAT",
        19 => "macOS",
        n => return format!("system {n}"),
    }
    .to_owned()
}

fn is_encrypted(rec: &Rec) -> bool {
    rec.flags & 1 != 0 || rec.method == 99
}

/// The entry as listed, or `None` when it is left out (name too long, too deep, or nothing left after sanitising).
/// `base` is how far a prefix shifts the archive in the file.
fn describe(rec: &Rec, index: u32, base: u64, limits: &Limits) -> Option<ArchiveEntry> {
    if rec.name.len() > limits.name_bytes {
        return None;
    }
    let decoded = match &rec.unicode {
        // The Info-ZIP Unicode path (0x7075) stands in for the name, so the cap holds for it too.
        Some(u) if u.len() > limits.name_bytes => return None,
        Some(u) => u.clone(),
        None => decode_name(&rec.name, rec.flags),
    };
    let unix_mode = (rec.made_by >> 8 == 3).then_some((rec.ext_attr >> 16) & 0o170_000);
    let dir =
        decoded.ends_with(['/', '\\']) || rec.ext_attr & 0x10 != 0 || unix_mode == Some(0o040_000);
    let kind = if dir {
        "dir"
    } else {
        match unix_mode {
            Some(0o120_000) => "link",
            Some(0o020_000 | 0o060_000 | 0o010_000 | 0o140_000) => "other",
            _ => "file",
        }
    };
    let clean = sanitise(&decoded, dir)?;
    if clean.depth > limits.depth {
        return None;
    }
    let mtime = match rec.utc {
        Some(t) => iso_from_unix(t, true),
        None => dos_text(rec.dos),
    };
    Some(ArchiveEntry {
        index,
        raw_name: raw_name_of(&clean, &decoded),
        path: clean.path,
        kind: kind.into(),
        size: rec.size,
        packed: rec.csize,
        mtime,
        encrypted: is_encrypted(rec),
        method: method_label(rec.method),
        link: None,
        offset: rec.lho.and_then(|l| base.checked_add(l)),
        crc: Some(rec.crc),
        host: Some(host_name(rec.made_by)),
        mode: (rec.made_by >> 8 == 3)
            .then_some(rec.ext_attr >> 16)
            .filter(|&m| m != 0),
        flags: Some(rec.flags),
        // Cut before decoding: a comment is up to 65,535 bytes and only `name_bytes` of it is shown.
        comment: (!rec.comment.is_empty()).then(|| {
            let kept = &rec.comment[..rec.comment.len().min(limits.name_bytes)];
            shown_text(&decode_name(kept, rec.flags), limits)
        }),
    })
}

/// What a read needs of a listed entry, kept so a later read seeks straight to its local header.
#[derive(Debug, Clone)]
pub struct Slot {
    index: u32,
    path: String,
    kind: String,
    encrypted: bool,
    method: u16,
    flags: u16,
    label: Option<String>,
    crc: u32,
    size: Option<u64>,
    packed: Option<u64>,
    /// The local header's byte in the file.
    local: Option<u64>,
    /// CRC-32 of the directory's raw name, which a local header may repeat where its decoding differs (a Unicode path).
    raw_name: u32,
}

impl Slot {
    fn of(rec: &Rec, entry: &ArchiveEntry) -> Slot {
        Slot {
            index: entry.index,
            path: entry.path.clone(),
            kind: entry.kind.clone(),
            encrypted: entry.encrypted,
            method: rec.method,
            flags: rec.flags,
            label: entry.method.clone(),
            crc: rec.crc,
            size: rec.size,
            packed: rec.csize,
            local: entry.offset,
            raw_name: crc32fast::hash(&rec.name),
        }
    }
}

fn slot_at<'a>(slots: &'a [Slot], index: u32, name: &str) -> Result<&'a Slot, Fault> {
    slots
        .binary_search_by_key(&index, |s| s.index)
        .ok()
        .map(|at| &slots[at])
        .filter(|s| s.path == name)
        .ok_or_else(changed)
}

// ---- list and read ----------------------------------------------------------------------------------------------------

#[cfg(test)]
pub fn list(file: &File, size: u64, limits: &Limits) -> Result<ArchiveListing, Fault> {
    list_slots(file, size, limits).map(|(l, _)| l)
}

/// The listing, and a slot for each entry in it.
pub fn list_slots(
    file: &File,
    size: u64,
    limits: &Limits,
) -> Result<(ArchiveListing, Vec<Slot>), Fault> {
    let end = open(file, size).map_err(OpenError::fault)?;
    let mut cd = Cd::new(file, &end)?;
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut slots: Vec<Slot> = Vec::new();
    let mut skipped = 0u32;
    let mut listed = 0usize;
    let mut truncated = None;
    let mut index = 0usize;
    loop {
        if index >= limits.entries {
            if (index as u64) < end.declared {
                truncated = Some(format!(
                    "Listed the first {} entries; the archive declares {}.",
                    commas(entries.len() as u64),
                    commas(end.declared)
                ));
            }
            break;
        }
        let rec = match cd.next() {
            Ok(Some(r)) => r,
            Ok(None) => break,
            Err(e) if entries.is_empty() && skipped == 0 => {
                return Err(Fault::Invalid(format!(
                    "The listing could not be read: {e}."
                )));
            }
            Err(e) => {
                truncated = Some(format!("The listing stopped at a damaged part: {e}."));
                break;
            }
        };
        match describe(&rec, index as u32, end.base, limits) {
            None => skipped += 1,
            Some(entry) => {
                let weight = entry.path.len()
                    + entry.raw_name.as_ref().map_or(0, String::len)
                    + entry.comment.as_ref().map_or(0, String::len)
                    + entry.link.as_ref().map_or(0, String::len);
                if listed + weight > limits.listed_bytes {
                    truncated = Some(format!(
                        "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                        commas(entries.len() as u64)
                    ));
                    break;
                }
                listed += weight;
                slots.push(Slot::of(&rec, &entry));
                entries.push(entry);
            }
        }
        index += 1;
    }
    let comment =
        (!end.comment.is_empty()).then(|| String::from_utf8_lossy(&end.comment).into_owned());
    let directory = Directory {
        at: end.base + end.cd_off,
        size: end.cd_size,
    };
    let listing = ArchiveListing {
        format: "zip".into(),
        entries,
        comment,
        truncated,
        skipped,
        declared: Some(end.declared),
        size,
        unpacked: None,
        directory: Some(directory),
        note: None,
    };
    Ok((listing, slots))
}

/// Entry `index`, read with a listing made for this call alone.
pub fn read(
    file: &File,
    size: u64,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let (_, slots) = list_slots(file, size, limits)?;
    read_slot(file, size, &slots, index, name, limits)
}

/// Entry `index` by its slot: straight to its local header, which must still be the entry listed.
pub fn read_slot(
    file: &File,
    size: u64,
    slots: &[Slot],
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let slot = slot_at(slots, index, name)?;
    let (out, whole) = entry_bytes(file, size, slot, name, limits.entry, Some(limits.entry))?;
    if !whole {
        return Err(too_big_actual(name, slot.size));
    }
    Ok(out)
}

/// The beginning of each want, at most `max_each` bytes; the budget was applied by the caller.
pub fn heads(
    file: &File,
    size: u64,
    slots: &[Slot],
    wants: &[Want],
    max_each: u64,
) -> Result<Vec<Head>, Fault> {
    wants
        .iter()
        .map(|w| {
            let got = slot_at(slots, w.index, &w.name)
                .and_then(|slot| entry_bytes(file, size, slot, &w.name, max_each, None));
            Head::of(w.index, got)
        })
        .collect()
}

/// Whether a local header's name is the slot's: sanitised to the same path, or the very bytes the directory holds.
fn local_name_is(raw: &[u8], flags: u16, slot: &Slot) -> bool {
    crc32fast::hash(raw) == slot.raw_name
        || sanitise(&decode_name(raw, flags), slot.kind == "dir")
            .is_some_and(|c| c.path == slot.path)
}

/// `cap` is a whole number of megabytes.
pub(super) fn needs_memory(name: &str, bytes: u64, cap: u64) -> Fault {
    Fault::Refused(format!(
        "{name} needs {} of memory to unpack, over the {} MB the app gives this entry.",
        size_words(bytes),
        cap >> 20
    ))
}

/// The largest Zstandard window an entry declaring `size` unpacked bytes may ask for: twice its size to the next power
/// of two, within 8 MB and 32 MB. The decoder fills a whole window before it hands out any of it, so a window is
/// memory spent before even a head is read. Encoders that know the size fit the window to the content; one streaming
/// without it declares 2 MB at the default level and 8 MB at level 19, which the floor lets through.
pub(super) fn zstd_window(size: u64) -> u64 {
    size.saturating_mul(2)
        .clamp(ZSTD_WINDOW_MIN, ZSTD_WINDOW_MAX)
        .next_power_of_two()
}

/// The unpacked bytes of a compressed entry, over `packed`, its data in the file. Every decoder here sizes its memory
/// by the format (deflate 32 KB, Deflate64 128 KB, bzip2 about 4 MB for a 900 KB block) or by a dictionary or window
/// the entry declares, which is held to its cap before anything is allocated for it: 256 MB for an LZMA dictionary
/// (whose window grows with the output), and `zstd_window` for Zstandard.
fn unpacker<'a>(
    slot: &Slot,
    packed: io::Take<&'a File>,
    name: &str,
) -> Result<Box<dyn Read + 'a>, Fault> {
    Ok(match slot.method {
        8 => Box::new(flate2::read::DeflateDecoder::new(packed)),
        9 => Box::new(deflate64::Deflate64Decoder::new(packed)),
        12 => Box::new(bzip2_rs::DecoderReader::new(BufReader::new(packed))),
        14 => {
            let mut r = BufReader::new(packed);
            // Two bytes of LZMA SDK version and two of properties size, then the five property bytes; the stream
            // carries no sizes of its own.
            let mut head = [0u8; 9];
            r.read_exact(&mut head).map_err(|_| damaged(name))?;
            if u16_at(&head, 2) != 5 {
                return Err(damaged(name));
            }
            let dict = u32_at(&head, 5);
            if u64::from(dict) > DICTIONARY {
                return Err(needs_memory(name, u64::from(dict), DICTIONARY));
            }
            // Bit 1 says the stream ends with a marker; without it, the declared size is where it stops.
            let size = if slot.flags & 2 != 0 {
                u64::MAX
            } else {
                slot.size.unwrap_or(u64::MAX)
            };
            Box::new(
                lzma_rust2::LzmaReader::new_with_props(r, size, head[4], dict, None)
                    .map_err(|_| damaged(name))?,
            )
        }
        20 | 93 => {
            let cap = zstd_window(slot.size.unwrap_or(0));
            match ruzstd::decoding::StreamingDecoder::new_with_max_window_size(
                BufReader::new(packed),
                cap,
            ) {
                Ok(d) => Box::new(d),
                Err(ruzstd::decoding::errors::FrameDecoderError::WindowSizeTooBig {
                    requested,
                    ..
                }) => return Err(needs_memory(name, requested, cap)),
                Err(_) => return Err(damaged(name)),
            }
        }
        95 => Box::new(lzma_rust2::XzReader::new_mem_limit(
            BufReader::new(packed),
            false,
            XZ_MEM_KB,
        )),
        _ => return Err(damaged(name)),
    })
}

/// At most `cap` bytes of the entry and whether it ended inside them. One that ended is checked against its declared
/// size and its CRC-32; `declared_cap` refuses an entry that declares more before anything is read.
fn entry_bytes(
    file: &File,
    size: u64,
    slot: &Slot,
    name: &str,
    cap: u64,
    declared_cap: Option<u64>,
) -> Result<(Vec<u8>, bool), Fault> {
    match slot.kind.as_str() {
        "dir" => return Err(folder()),
        "link" => {
            return Err(Fault::Invalid(format!(
                "{name} is a link: links are not followed."
            )))
        }
        "other" => return Err(Fault::Invalid(format!("{name} is not a file."))),
        _ => {}
    }
    if slot.encrypted {
        return Err(Fault::Refused(
            "This entry is encrypted. The app does not ask for archive passwords.".into(),
        ));
    }
    if !is_read(slot.method) {
        return Err(Fault::Unsupported(format!(
            "{name} is compressed with {}, which the app does not read.",
            slot.label.as_deref().unwrap_or("an unknown method")
        )));
    }
    let (Some(declared), Some(packed), Some(local)) = (slot.size, slot.packed, slot.local) else {
        return Err(damaged(name));
    };
    if declared_cap.is_some_and(|c| declared > c) {
        return Err(too_big_declared(name, declared));
    }
    // An offset from an index is trusted only once the header it lands on names the same entry.
    let mut head = [0u8; 30];
    if read_at(file, local, &mut head).is_err() || head[..4] != LOCAL_SIG[..] {
        return Err(changed());
    }
    let (n, x) = (u64::from(u16_at(&head, 26)), u64::from(u16_at(&head, 28)));
    let mut local_name = vec![0u8; n as usize];
    if read_at(file, local + 30, &mut local_name).is_err()
        || !local_name_is(&local_name, u16_at(&head, 6), slot)
    {
        return Err(changed());
    }
    let data = local + 30 + n + x;
    let in_file = |n: u64| data.checked_add(n).is_some_and(|e| e <= size);
    if !in_file(packed) || (slot.method == 0 && (packed != declared || !in_file(declared))) {
        return Err(damaged(name));
    }
    let mut f = file;
    f.seek(SeekFrom::Start(data))?;
    let reader = if slot.method == 0 {
        Box::new(Read::take(f, declared))
    } else {
        unpacker(slot, Read::take(f, packed), name)?
    };
    let (out, whole) = head_of(reader, cap).map_err(|_| damaged(name))?;
    if whole {
        if out.len() as u64 != declared {
            return Err(Fault::Invalid(format!(
                "{name} unpacks to {} bytes, not the {} it declares: the archive is damaged.",
                commas(out.len() as u64),
                commas(declared)
            )));
        }
        if crc32fast::hash(&out) != slot.crc {
            return Err(Fault::Invalid(format!(
                "{name} does not match its check (CRC-32): the archive is damaged."
            )));
        }
    }
    Ok((out, whole))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::testkit::{self, Z};

    fn open_bytes(name: &str, bytes: &[u8]) -> (std::path::PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-zip-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.zip");
        std::fs::write(&path, bytes).unwrap();
        let file = File::open(&path).unwrap();
        (dir, file)
    }

    fn fixture(name: &str, entries: &[Z]) -> (std::path::PathBuf, File, u64) {
        let bytes = testkit::zip(entries, b"");
        let (dir, file) = open_bytes(name, &bytes);
        (dir, file, bytes.len() as u64)
    }

    #[test]
    fn it_lists_names_sizes_dates_and_folders_and_reads_stored_and_deflated() {
        let body = b"hello hello hello hello hello hello".to_vec();
        let entries = [
            Z::dir("docs/"),
            Z::stored("docs/a.md", b"# A\n"),
            Z::deflated("docs\\b.md", &body),
            Z::stored("caf\u{e9}.txt", b"x"),
        ];
        let one = testkit::zip(&entries, b"made by a test");
        let (dir, file) = open_bytes("lists", &one);
        let listing = list(&file, one.len() as u64, &Limits::DEFAULT).unwrap();
        assert_eq!(listing.comment.as_deref(), Some("made by a test"));
        assert_eq!(listing.declared, Some(4));
        let paths: Vec<_> = listing.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["docs/", "docs/a.md", "docs/b.md", "caf\u{e9}.txt"]);
        let kinds: Vec<_> = listing.entries.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["dir", "file", "file", "file"]);
        assert_eq!(listing.entries[1].size, Some(4));
        assert_eq!(listing.entries[1].packed, Some(4));
        assert_eq!(listing.entries[2].size, Some(body.len() as u64));
        assert!(listing.entries[2].packed.unwrap() < body.len() as u64);
        assert_eq!(
            listing.entries[1].mtime.as_deref(),
            Some("2024-03-05T14:30:10")
        );
        assert!(listing
            .entries
            .iter()
            .all(|e| !e.encrypted && e.method.is_none()));
        assert_eq!(
            listing.entries[2].raw_name, None,
            "backslashes alone do not set rawName"
        );
        assert_eq!(listing.entries[2].index, 2);
        assert_eq!(
            read(&file, one.len() as u64, 1, "docs/a.md", &Limits::DEFAULT).unwrap(),
            b"# A\n"
        );
        assert_eq!(
            read(&file, one.len() as u64, 2, "docs/b.md", &Limits::DEFAULT).unwrap(),
            body
        );
        let err = read(&file, one.len() as u64, 0, "docs/", &Limits::DEFAULT).unwrap_err();
        assert!(matches!(&err, Fault::Invalid(m) if m == "A folder has nothing to open."));
        let err = read(
            &file,
            one.len() as u64,
            1,
            "docs/other.md",
            &Limits::DEFAULT,
        )
        .unwrap_err();
        assert!(
            matches!(&err, Fault::Invalid(m) if m == "The archive changed since it was listed.")
        );
        let err = read(&file, one.len() as u64, 9, "x", &Limits::DEFAULT).unwrap_err();
        assert!(
            matches!(&err, Fault::Invalid(m) if m == "The archive changed since it was listed.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn comments_count_against_what_a_listing_may_hold() {
        let comment = [0xffu8; 1000];
        let entries = [
            Z::stored("a.txt", b"x").commented(&comment),
            Z::stored("b.txt", b"x").commented(&comment),
            Z::stored("c.txt", b"x").commented(&comment),
        ];
        let bytes = testkit::zip(&entries, b"");
        let (dir, file) = open_bytes("comments", &bytes);
        let tight = Limits {
            listed_bytes: 1500,
            ..Limits::DEFAULT
        };
        let l = list(&file, bytes.len() as u64, &tight).unwrap();
        assert_eq!(l.entries.len(), 1);
        assert!(l.truncated.is_some());
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_cp437_name_without_the_utf8_flag_reads_in_cp437() {
        assert_eq!(CP437_HIGH.chars().count(), 128);
        assert_eq!(decode_name(b"caf\x82.txt", 0), "caf\u{e9}.txt");
        assert_eq!(decode_name("caf\u{e9}".as_bytes(), 0), "caf\u{e9}");
        assert_eq!(decode_name(b"caf\xc3", 0x800), "caf\u{fffd}");
        assert_eq!(decode_name(b"\xfb\xff", 0), "\u{221a}\u{a0}");
        let bytes = testkit::zip(&[Z::stored_raw(b"caf\x82.txt", b"y")], b"");
        let (dir, file) = open_bytes("cp437", &bytes);
        let l = list(&file, bytes.len() as u64, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries[0].path, "caf\u{e9}.txt");
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_zip_bomb_is_refused_by_its_declaration_or_by_its_output() {
        let zeros = vec![0u8; 17 * 1024 * 1024];
        let entries = [
            Z::deflated("lie.bin", &zeros).declaring(1024),
            Z::deflated("big.bin", b"tiny").declaring(20 * 1024 * 1024),
        ];
        let (dir, file, size) = fixture("bomb", &entries);
        match read(&file, size, 0, "lie.bin", &Limits::DEFAULT).unwrap_err() {
            Fault::Refused(m) => assert_eq!(
                m,
                "lie.bin unpacks past the 16 MB an entry may open with, though it declares 1.0 KB."
            ),
            other => panic!("{other:?}"),
        }
        match read(&file, size, 1, "big.bin", &Limits::DEFAULT).unwrap_err() {
            Fault::Refused(m) => assert_eq!(
                m,
                "big.bin is 20.0 MB unpacked, over the 16 MB an entry may open with."
            ),
            other => panic!("{other:?}"),
        }
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_bad_crc_a_wrong_length_a_flag_and_a_method_are_each_turned_away() {
        let entries = [
            Z::stored("crc.txt", b"abcd").with_crc(1),
            Z::deflated("len.txt", b"abcdef").declaring(5),
            Z::stored("locked.txt", b"abcd").flagged(1),
            Z::stored("pp.txt", b"abcd").method(98),
            Z::stored("aes.txt", b"abcd").method(99),
            Z::stored("odd.txt", b"abcd").method(77),
        ];
        let (dir, file, size) = fixture("refusals", &entries);
        let go = |i: u32, n: &str| read(&file, size, i, n, &Limits::DEFAULT).unwrap_err();
        assert!(matches!(go(0, "crc.txt"), Fault::Invalid(m)
            if m == "crc.txt does not match its check (CRC-32): the archive is damaged."));
        assert!(matches!(go(1, "len.txt"), Fault::Invalid(m)
            if m == "len.txt unpacks to 6 bytes, not the 5 it declares: the archive is damaged."));
        assert!(matches!(go(2, "locked.txt"), Fault::Refused(m)
            if m == "This entry is encrypted. The app does not ask for archive passwords."));
        assert!(matches!(go(3, "pp.txt"), Fault::Unsupported(m)
            if m == "pp.txt is compressed with ppmd, which the app does not read."));
        assert!(matches!(go(4, "aes.txt"), Fault::Refused(_)));
        assert!(matches!(go(5, "odd.txt"), Fault::Unsupported(m) if m.contains("method 77")));
        let listing = list(&file, size, &Limits::DEFAULT).unwrap();
        assert!(listing.entries[2].encrypted && listing.entries[4].encrypted);
        assert_eq!(listing.entries[3].method.as_deref(), Some("ppmd"));
        assert_eq!(listing.entries[4].method.as_deref(), Some("AES"));
        assert_eq!(listing.entries[5].method.as_deref(), Some("method 77"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn hostile_names_list_as_plain_relative_paths_and_read_back_by_index() {
        let names = [
            "../../evil.txt",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "a/../../b.txt",
        ];
        let want = ["evil.txt", "etc/passwd", "Windows/win.ini", "a/b.txt"];
        let entries: Vec<Z> = names.iter().map(|n| Z::stored(n, n.as_bytes())).collect();
        let (dir, file, size) = fixture("hostile", &entries);
        let listing = list(&file, size, &Limits::DEFAULT).unwrap();
        for (i, e) in listing.entries.iter().enumerate() {
            assert_eq!(e.path, want[i]);
            assert_eq!(e.raw_name.as_deref(), Some(names[i]));
            assert_eq!(
                read(&file, size, i as u32, &e.path, &Limits::DEFAULT).unwrap(),
                names[i].as_bytes()
            );
        }
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_caps_stop_the_listing_and_say_so() {
        let mut entries: Vec<Z> = (0..5)
            .map(|i| Z::stored(&format!("f{i}.txt"), b"x"))
            .collect();
        entries.push(Z::stored(&"n".repeat(40), b"x"));
        entries.push(Z::stored("a/b/c/d/e.txt", b"x"));
        entries.push(Z::stored("..", b"x"));
        let (dir, file, size) = fixture("caps", &entries);
        let tight = Limits {
            entries: 3,
            ..Limits::DEFAULT
        };
        let l = list(&file, size, &tight).unwrap();
        assert_eq!(l.entries.len(), 3);
        assert_eq!(l.declared, Some(8));
        assert_eq!(
            l.truncated.as_deref(),
            Some("Listed the first 3 entries; the archive declares 8.")
        );
        let l = list(
            &file,
            size,
            &Limits {
                name_bytes: 20,
                depth: 4,
                ..Limits::DEFAULT
            },
        )
        .unwrap();
        assert_eq!(l.entries.len(), 5);
        assert_eq!(
            l.skipped, 3,
            "too long, too deep and nothing left after sanitising"
        );
        assert_eq!(l.truncated, None);
        let l = list(
            &file,
            size,
            &Limits {
                listed_bytes: 12,
                ..Limits::DEFAULT
            },
        )
        .unwrap();
        assert_eq!(l.entries.len(), 2);
        assert_eq!(
            l.truncated.as_deref(),
            Some("Listed the first 2 entries: their names reach the 16 MB a listing may hold.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A short stored name cannot carry a Unicode path past the name cap: the entry is skipped as a long name is.
    #[test]
    fn a_unicode_path_longer_than_the_name_cap_is_skipped() {
        let long = format!("{}.txt", "u".repeat(40));
        let entries = [
            Z::stored_raw(b"a.txt", b"abcd").unicode_path(&long),
            Z::stored_raw(b"b.txt", b"abcd").unicode_path("short.txt"),
        ];
        let bytes = testkit::zip(&entries, b"");
        let (dir, file) = open_bytes("unicode-cap", &bytes);
        let tight = Limits {
            name_bytes: 20,
            ..Limits::DEFAULT
        };
        let l = list(&file, bytes.len() as u64, &tight).unwrap();
        let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["short.txt"]);
        assert_eq!(l.skipped, 1);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn zip64_fields_extended_times_and_unicode_names_parse() {
        let entries = [
            Z::stored("big.bin", b"abcd").zip64(),
            Z::stored("plain.txt", b"abcd").utc(1_700_000_000),
            Z::stored_raw(b"caf\x82.txt", b"abcd").unicode_path("caf\u{e9}-up.txt"),
            Z::stored_raw(b"caf\x82.txt", b"abcd").unicode_path_wrong_crc("nope.txt"),
        ];
        let bytes = testkit::zip(&entries, b"");
        let (dir, file) = open_bytes("zip64", &bytes);
        let size = bytes.len() as u64;
        let l = list(&file, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries[0].size, Some(4));
        assert_eq!(l.entries[0].packed, Some(4));
        assert_eq!(l.entries[1].mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(l.entries[2].path, "caf\u{e9}-up.txt");
        assert_eq!(l.entries[3].path, "caf\u{e9}.txt");
        assert_eq!(
            read(&file, size, 0, "big.bin", &Limits::DEFAULT).unwrap(),
            b"abcd"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        let z64 = testkit::zip64_end(&entries[..2]);
        let (dir, file) = open_bytes("zip64-end", &z64);
        let l = list(&file, z64.len() as u64, &Limits::DEFAULT).unwrap();
        assert_eq!(l.declared, Some(2));
        assert_eq!(l.entries.len(), 2);
        assert_eq!(
            read(&file, z64.len() as u64, 1, "plain.txt", &Limits::DEFAULT).unwrap(),
            b"abcd"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_zip_behind_a_prefix_and_an_empty_zip_still_list() {
        let inner = testkit::zip(&[Z::stored("in.txt", b"data")], b"");
        let mut bytes = b"MZ self-extractor stub ........".to_vec();
        bytes.extend(&inner);
        let (dir, file) = open_bytes("prefix", &bytes);
        let size = bytes.len() as u64;
        assert!(matches!(
            crate::archive::detect(&file, size),
            Ok(Some(crate::archive::Format::Zip))
        ));
        let l = list(&file, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries[0].path, "in.txt");
        assert_eq!(
            read(&file, size, 0, "in.txt", &Limits::DEFAULT).unwrap(),
            b"data"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        let empty = testkit::zip(&[], b"");
        let (dir, file) = open_bytes("empty", &empty);
        let l = list(&file, empty.len() as u64, &Limits::DEFAULT).unwrap();
        assert!(l.entries.is_empty() && l.declared == Some(0));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_split_zip_and_a_damaged_directory_are_named() {
        let mut bytes = testkit::zip(&[Z::stored("a.txt", b"x")], b"");
        let eocd = bytes.len() - 22;
        bytes[eocd + 4] = 1;
        let (dir, file) = open_bytes("split", &bytes);
        match list(&file, bytes.len() as u64, &Limits::DEFAULT).unwrap_err() {
            Fault::Unsupported(m) => assert_eq!(m, "a zip split across several files is not read."),
            other => panic!("{other:?}"),
        }
        drop(file);
        let mut bytes = testkit::zip(&[Z::stored("a.txt", b"x"), Z::stored("b.txt", b"y")], b"");
        let cd = testkit::find(&bytes, b"PK\x01\x02", 1);
        bytes[cd] = b'X';
        let (dir2, file) = open_bytes("damaged", &bytes);
        let l = list(&file, bytes.len() as u64, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries.len(), 1);
        assert!(l
            .truncated
            .unwrap()
            .starts_with("The listing stopped at a damaged part: "));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    /// A read by offset lands on a local header and checks it names the entry listed there.
    #[test]
    fn a_read_by_offset_refuses_a_header_that_names_another_entry() {
        let entries = [
            Z::stored("a.txt", b"aaaa"),
            Z::stored("b.txt", b"bbbb"),
            Z::stored_raw(b"caf\x82.txt", b"cccc").unicode_path("caf\u{e9}-up.txt"),
        ];
        let (dir, file, size) = fixture("by-offset", &entries);
        let (_, mut slots) = list_slots(&file, size, &Limits::DEFAULT).unwrap();
        let read_b = |slots: &[Slot]| read_slot(&file, size, slots, 1, "b.txt", &Limits::DEFAULT);
        assert_eq!(read_b(&slots).unwrap(), b"bbbb");
        assert_eq!(
            read_slot(&file, size, &slots, 2, "caf\u{e9}-up.txt", &Limits::DEFAULT).unwrap(),
            b"cccc",
            "a local header may carry the raw name a Unicode path stands in for"
        );
        let changed_since = |r: Result<Vec<u8>, Fault>| matches!(r, Err(Fault::Invalid(m)) if m == "The archive changed since it was listed.");
        let real = slots[1].local;
        slots[1].local = slots[0].local;
        assert!(changed_since(read_b(&slots)), "a header naming a.txt");
        let want = [Want {
            index: 1,
            name: "b.txt".into(),
        }];
        let got = heads(&file, size, &slots, &want, 64).unwrap();
        assert_eq!(
            got[0].refused.as_deref(),
            Some("The archive changed since it was listed.")
        );
        assert!(got[0].bytes.is_empty());
        slots[1].local = real.map(|l| l + 1);
        assert!(
            changed_since(read_b(&slots)),
            "no local header there at all"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A head of an encrypted entry is the refusal, never its bytes.
    #[test]
    fn a_head_of_an_encrypted_entry_or_an_unread_method_is_a_refusal() {
        let entries = [
            Z::stored("locked.txt", b"secret bytes").flagged(1),
            Z::stored("aes.txt", b"abcd").method(99),
            Z::stored("pp.txt", b"abcd").method(98),
            Z::deflated("ok.txt", b"plain plain plain"),
        ];
        let (dir, file, size) = fixture("head-refusals", &entries);
        let (listing, slots) = list_slots(&file, size, &Limits::DEFAULT).unwrap();
        let wants: Vec<Want> = listing
            .entries
            .iter()
            .map(|e| Want {
                index: e.index,
                name: e.path.clone(),
            })
            .collect();
        let got = heads(&file, size, &slots, &wants, 5).unwrap();
        let encrypted = "This entry is encrypted. The app does not ask for archive passwords.";
        assert_eq!(got[0].refused.as_deref(), Some(encrypted));
        assert_eq!(got[1].refused.as_deref(), Some(encrypted));
        assert_eq!(
            got[2].refused.as_deref(),
            Some("pp.txt is compressed with ppmd, which the app does not read.")
        );
        assert!(got[..3].iter().all(|h| h.bytes.is_empty() && !h.whole));
        assert_eq!(
            (got[3].bytes.as_slice(), got[3].whole),
            (&b"plain"[..], false)
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_system_that_wrote_an_entry_is_named() {
        let named: Vec<_> = [0u16, 3, 10, 11, 19, 7, 30]
            .iter()
            .map(|h| host_name((h << 8) | 20))
            .collect();
        assert_eq!(
            named,
            [
                "DOS or Windows",
                "Unix",
                "Windows NTFS",
                "VFAT",
                "macOS",
                "system 7",
                "system 30"
            ]
        );
    }

    // ---- the methods beyond stored and deflate ---------------------------------------------------------------------

    /// What a test Deflate64 stream says: literal bytes, or a copy of (length, distance).
    enum Op {
        Lit(&'static [u8]),
        Copy(u32, u32),
    }

    /// Bits packed least significant first, as deflate packs them.
    #[derive(Default)]
    struct Bits {
        out: Vec<u8>,
        acc: u64,
        n: u32,
    }

    impl Bits {
        fn put(&mut self, v: u32, n: u32) {
            self.acc |= u64::from(v) << self.n;
            self.n += n;
            while self.n >= 8 {
                self.out.push(self.acc as u8);
                self.acc >>= 8;
                self.n -= 8;
            }
        }

        /// A Huffman code goes most significant bit first.
        fn code(&mut self, v: u32, n: u32) {
            self.put(v.reverse_bits() >> (32 - n), n);
        }

        fn symbol(&mut self, sym: u32) {
            match sym {
                0..=143 => self.code(0x30 + sym, 8),
                144..=255 => self.code(0x190 + sym - 144, 9),
                256..=279 => self.code(sym - 256, 7),
                _ => self.code(0xc0 + sym - 280, 8),
            }
        }
    }

    /// Deflate64's distance codes: deflate's thirty, then two more reaching 64 KB back.
    const DIST_BASE: [u32; 32] = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
        2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 32769, 49153,
    ];

    /// One fixed-Huffman block. Every copy uses length code 285, which in Deflate64 is 3 plus sixteen extra bits
    /// (in deflate it is 258 flat), so a stream that reads as Deflate64 cannot pass for deflate.
    fn deflate64(ops: &[Op]) -> Vec<u8> {
        let mut b = Bits::default();
        b.put(1, 1);
        b.put(1, 2);
        for op in ops {
            match *op {
                Op::Lit(bytes) => bytes.iter().for_each(|&c| b.symbol(c.into())),
                Op::Copy(len, dist) => {
                    b.symbol(285);
                    b.put(len - 3, 16);
                    let d = (0..32).rev().find(|&d| DIST_BASE[d] <= dist).unwrap();
                    b.code(d as u32, 5);
                    b.put(dist - DIST_BASE[d], (d as u32 / 2).saturating_sub(1));
                }
            }
        }
        b.symbol(256);
        if b.n > 0 {
            b.out.push(b.acc as u8);
        }
        b.out
    }

    fn expand(ops: &[Op]) -> Vec<u8> {
        let mut out = Vec::new();
        for op in ops {
            match *op {
                Op::Lit(bytes) => out.extend(bytes),
                Op::Copy(len, dist) => {
                    for _ in 0..len {
                        out.push(out[out.len() - dist as usize]);
                    }
                }
            }
        }
        out
    }

    /// A zip LZMA entry's data: LZMA SDK version 9.20, five property bytes, then the raw stream.
    fn lzma(data: &[u8], end_marker: bool) -> Vec<u8> {
        let opts = lzma_rust2::LzmaOptions::with_preset(1);
        let mut w = lzma_rust2::LzmaWriter::new_no_header(Vec::new(), &opts, end_marker).unwrap();
        let props = w.props();
        std::io::Write::write_all(&mut w, data).unwrap();
        let mut out = vec![9, 20, 5, 0, props];
        out.extend(opts.dict_size.to_le_bytes());
        out.extend(w.finish().unwrap());
        out
    }

    fn zstd(data: &[u8]) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(data, ruzstd::encoding::CompressionLevel::Fastest)
    }

    fn xz(data: &[u8]) -> Vec<u8> {
        let mut w =
            lzma_rust2::XzWriter::new(Vec::new(), lzma_rust2::XzOptions::with_preset(1)).unwrap();
        std::io::Write::write_all(&mut w, data).unwrap();
        w.finish().unwrap()
    }

    /// `bzip2 -9` of "bzip2 in a zip, " eight times.
    const BZ2_TEXT: [u8; 59] = [
        0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59, 0x36, 0x31, 0x13, 0x4d, 0x00,
        0x00, 0x1f, 0x99, 0x80, 0x40, 0x04, 0x10, 0x00, 0x30, 0x21, 0x40, 0x10, 0x20, 0x00, 0x31,
        0x06, 0x4c, 0x40, 0x55, 0x26, 0x8d, 0x1e, 0xa7, 0x45, 0x8d, 0x8e, 0x0f, 0x06, 0x0a, 0x81,
        0x05, 0x58, 0x83, 0xe2, 0xee, 0x48, 0xa7, 0x0a, 0x12, 0x06, 0xc6, 0x22, 0x69, 0xa0,
    ];

    /// `bzip2 -9` of 200 MB of zeros: four identical full blocks, a short one and the stream's end.
    fn bz2_bomb() -> Vec<u8> {
        let block = [
            0x31, 0x41, 0x59, 0x26, 0x53, 0x59, 0x0e, 0x09, 0xe2, 0xdf, 0x01, 0x5f, 0x8e, 0x40,
            0x00, 0xc0, 0x00, 0x00, 0x08, 0x20, 0x00, 0x30, 0x80, 0x4d, 0x46, 0x42, 0xa0, 0x25,
            0xa9, 0x0a, 0x80, 0x97,
        ];
        let mut out = b"BZh9".to_vec();
        for _ in 0..4 {
            out.extend(block);
        }
        out.extend([
            0x31, 0x41, 0x59, 0x26, 0x53, 0x59, 0xf1, 0x31, 0x84, 0x70, 0x00, 0xc8, 0x0c, 0x40,
            0x40, 0xc0, 0x00, 0x00, 0x40, 0x00, 0x08, 0x20, 0x00, 0x30, 0xcc, 0x05, 0x29, 0xa6,
            0x14, 0x02, 0x2d, 0x88, 0xa0, 0x11, 0x78, 0xbb, 0x92, 0x29, 0xc2, 0x84, 0x82, 0x2e,
            0xa7, 0x8d, 0xd0,
        ]);
        out
    }

    fn read_all(file: &File, size: u64, names: &[&str]) -> Vec<Result<Vec<u8>, Fault>> {
        names
            .iter()
            .enumerate()
            .map(|(i, n)| read(file, size, i as u32, n, &Limits::DEFAULT))
            .collect()
    }

    fn crc_fault(name: &str) -> String {
        format!("{name} does not match its check (CRC-32): the archive is damaged.")
    }

    #[test]
    fn deflate64_bzip2_lzma_zstandard_and_xz_entries_read_and_are_checked() {
        let ops = [
            Op::Lit(b"Deflate64 reads "),
            Op::Copy(40_000, 16),
            Op::Lit(b"|"),
            // Code 30: further back than deflate's 32 KB window reaches.
            Op::Copy(300, 33_000),
        ];
        let d64 = expand(&ops);
        let text: Vec<u8> = b"lzma, zstd and xz in a zip. ".repeat(50);
        let bz_text = b"bzip2 in a zip, ".repeat(8);
        let entries = [
            Z::packed("a.d64", 9, deflate64(&ops), &d64),
            Z::packed("b.bz2", 12, BZ2_TEXT.to_vec(), &bz_text),
            Z::packed("c.lzma", 14, lzma(&text, false), &text),
            Z::packed("d.lzma", 14, lzma(&text, true), &text).flagged(2),
            Z::packed("e.zst", 93, zstd(&text), &text),
            Z::packed("f.xz", 95, xz(&text), &text),
            Z::packed("g.d64", 9, deflate64(&ops), &d64).with_crc(1),
            Z::packed("h.bz2", 12, BZ2_TEXT.to_vec(), &bz_text).with_crc(1),
            Z::packed("i.lzma", 14, lzma(&text, true), &text)
                .flagged(2)
                .with_crc(1),
            Z::packed("j.zst", 93, zstd(&text), &text).with_crc(1),
            Z::packed("k.xz", 95, xz(&text), &text).with_crc(1),
        ];
        let names = [
            "a.d64", "b.bz2", "c.lzma", "d.lzma", "e.zst", "f.xz", "g.d64", "h.bz2", "i.lzma",
            "j.zst", "k.xz",
        ];
        let (dir, file, size) = fixture("methods", &entries);
        let listing = list(&file, size, &Limits::DEFAULT).unwrap();
        assert!(listing.entries.iter().all(|e| e.method.is_none()));
        let got = read_all(&file, size, &names);
        let want = [&d64, &bz_text, &text, &text, &text, &text];
        for (i, w) in want.iter().enumerate() {
            assert_eq!(got[i].as_ref().unwrap(), *w, "{}", names[i]);
        }
        for (i, name) in names.iter().enumerate().skip(6) {
            assert!(
                matches!(&got[i], Err(Fault::Invalid(m)) if *m == crc_fault(name)),
                "{name}: {:?}",
                got[i]
            );
        }
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_damaged_stream_in_each_method_is_named() {
        let text: Vec<u8> = b"some text to pack, some text to pack. ".repeat(40);
        let bz_text = b"bzip2 in a zip, ".repeat(8);
        let mut bz = BZ2_TEXT.to_vec();
        bz[45] ^= 0x55;
        let mut lz = lzma(&text, true);
        let half = lz.len() / 2;
        lz[half..].iter_mut().for_each(|b| *b = !*b);
        let mut props_size = lzma(&text, true);
        props_size[2] = 4;
        let mut zs = zstd(&text);
        let half = zs.len() / 2;
        zs[half..].iter_mut().for_each(|b| *b = !*b);
        let mut x = xz(&text);
        let half = x.len() / 2;
        x[half] ^= 0x55;
        let entries = [
            // BFINAL set and block type 3, which no deflate stream has.
            Z::packed("a.d64", 9, vec![0x07], &text),
            Z::packed("b.bz2", 12, bz, &bz_text),
            Z::packed("c.lzma", 14, lz, &text).flagged(2),
            Z::packed("d.lzma", 14, props_size, &text).flagged(2),
            Z::packed("e.zst", 93, zs, &text),
            Z::packed("f.xz", 95, x, &text),
            Z::packed("g.zst", 93, b"not zstd at all".to_vec(), &text),
        ];
        let names = [
            "a.d64", "b.bz2", "c.lzma", "d.lzma", "e.zst", "f.xz", "g.zst",
        ];
        let (dir, file, size) = fixture("damaged-methods", &entries);
        for (name, got) in names.iter().zip(read_all(&file, size, &names)) {
            let damaged = format!("{name} could not be read: the archive is damaged.");
            let short = format!("{name} unpacks to ");
            assert!(
                matches!(&got, Err(Fault::Invalid(m))
                    if *m == damaged || *m == crc_fault(name) || m.starts_with(&short)),
                "{name}: {got:?}"
            );
        }
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_dictionary_or_window_over_the_cap_is_refused_before_the_decoder_is_made() {
        let text: Vec<u8> = b"a dictionary held to the cap. ".repeat(30);
        let mut big = lzma(&text, true);
        big[5..9].copy_from_slice(&(512u32 << 20).to_le_bytes());
        let mut at_cap = lzma(&text, true);
        at_cap[5..9].copy_from_slice(&(256u32 << 20).to_le_bytes());
        // A zstd frame header with no content size and a window descriptor asking for 2^30 bytes.
        let mut zs = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xa0];
        zs.extend([0u8; 8]);
        let entries = [
            Z::packed("big.lzma", 14, big, &text).flagged(2),
            Z::packed("cap.lzma", 14, at_cap, &text).flagged(2),
            Z::packed("big.zst", 93, zs, &text),
        ];
        let (dir, file, size) = fixture("dictionaries", &entries);
        let got = read_all(&file, size, &["big.lzma", "cap.lzma", "big.zst"]);
        assert!(matches!(&got[0], Err(Fault::Refused(m))
            if m == "big.lzma needs 512.0 MB of memory to unpack, over the 256 MB the app gives this entry."));
        assert_eq!(got[1].as_ref().unwrap(), &text, "256 MB is within the cap");
        assert!(matches!(&got[2], Err(Fault::Refused(m))
            if m == "big.zst needs 1.0 GB of memory to unpack, over the 8 MB the app gives this entry."));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deflate64_and_bzip2_bombs_are_cut_at_the_entry_cap() {
        // 4 GB of zeros in about 230 KB: inflated whole, it would take that memory and many seconds.
        let mut ops = vec![Op::Lit(b"\0")];
        ops.extend((0..65_536).map(|_| Op::Copy(65_538, 1)));
        let entries = [
            Z::packed("d64.bin", 9, deflate64(&ops), b"").declaring(1024),
            Z::packed("bz.bin", 12, bz2_bomb(), b"").declaring(1024),
        ];
        let (dir, file, size) = fixture("method-bombs", &entries);
        for (i, name) in ["d64.bin", "bz.bin"].iter().enumerate() {
            match read(&file, size, i as u32, name, &Limits::DEFAULT).unwrap_err() {
                Fault::Refused(m) => assert_eq!(
                    m,
                    format!(
                        "{name} unpacks past the 16 MB an entry may open with, though it declares 1.0 KB."
                    )
                ),
                other => panic!("{name}: {other:?}"),
            }
        }
        let (_, slots) = list_slots(&file, size, &Limits::DEFAULT).unwrap();
        let wants = [
            Want {
                index: 0,
                name: "d64.bin".into(),
            },
            Want {
                index: 1,
                name: "bz.bin".into(),
            },
        ];
        for h in heads(&file, size, &slots, &wants, 64).unwrap() {
            assert_eq!((h.bytes, h.whole, h.refused), (vec![0u8; 64], false, None));
        }
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Every single-byte flip of a small stream in each method is a damaged entry or bytes, never a panic or a hang.
    #[test]
    fn a_flipped_byte_anywhere_in_a_stream_never_panics() {
        let text: Vec<u8> = b"flip a byte, any byte. ".repeat(20);
        let ops = [Op::Lit(b"Deflate64 "), Op::Copy(300, 10)];
        let streams: [(u16, Vec<u8>, Vec<u8>, u16); 6] = [
            (9, deflate64(&ops), expand(&ops), 0),
            (12, BZ2_TEXT.to_vec(), b"bzip2 in a zip, ".repeat(8), 0),
            (14, lzma(&text, true), text.clone(), 2),
            (14, lzma(&text, false), text.clone(), 0),
            (93, zstd(&text), text.clone(), 0),
            (95, xz(&text), text.clone(), 0),
        ];
        for (method, comp, plain, flags) in streams {
            let entries: Vec<Z> = (0..comp.len())
                .map(|i| {
                    let mut c = comp.clone();
                    c[i] ^= 0xff;
                    Z::packed(&format!("{i}"), method, c, &plain).flagged(flags)
                })
                .collect();
            let (dir, file, size) = fixture(&format!("flips-{method}-{flags}"), &entries);
            let (_, slots) = list_slots(&file, size, &Limits::DEFAULT).unwrap();
            for i in 0..entries.len() {
                let got = read_slot(
                    &file,
                    size,
                    &slots,
                    i as u32,
                    &format!("{i}"),
                    &Limits::DEFAULT,
                );
                assert!(
                    matches!(&got, Ok(b) if *b == plain)
                        || matches!(&got, Err(Fault::Invalid(_) | Fault::Refused(_))),
                    "method {method}, byte {i}: {got:?}"
                );
            }
            drop(file);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn a_zstandard_window_is_held_to_twice_the_declared_size_within_8_and_32_mb() {
        const MB: u64 = 1024 * 1024;
        assert_eq!(zstd_window(0), 8 * MB);
        assert_eq!(zstd_window(1024), 8 * MB);
        assert_eq!(zstd_window(4 * MB), 8 * MB);
        assert_eq!(zstd_window(4 * MB + 1), 16 * MB);
        assert_eq!(zstd_window(8 * MB + 1), 32 * MB);
        assert_eq!(zstd_window(16 * MB), 32 * MB);
        assert_eq!(zstd_window(u64::MAX), 32 * MB);
    }

    /// A frame declaring a 256 MB window and 2,200 RLE blocks of 128 KB: about 9 KB that a decoder would fill 256 MB
    /// with before handing out its first byte.
    fn zstd_window_bomb() -> Vec<u8> {
        let mut f = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x90];
        for i in 0..2200u32 {
            let last = u32::from(i == 2199);
            let header = (131_072u32 << 3) | (1 << 1) | last;
            f.extend(&header.to_le_bytes()[..3]);
            f.push(0);
        }
        f
    }

    #[test]
    fn a_zstandard_window_past_what_the_declared_size_needs_is_refused_before_decoding() {
        let entries = [
            Z::packed("small.zst", 93, zstd_window_bomb(), b"").declaring(1024),
            Z::packed("large.zst", 93, zstd_window_bomb(), b"").declaring(15 << 20),
        ];
        let (dir, file, size) = fixture("zstd-window", &entries);
        let started = std::time::Instant::now();
        let got = read_all(&file, size, &["small.zst", "large.zst"]);
        assert!(matches!(&got[0], Err(Fault::Refused(m))
            if m == "small.zst needs 256.0 MB of memory to unpack, over the 8 MB the app gives this entry."));
        assert!(matches!(&got[1], Err(Fault::Refused(m))
            if m == "large.zst needs 256.0 MB of memory to unpack, over the 32 MB the app gives this entry."));
        let (_, slots) = list_slots(&file, size, &Limits::DEFAULT).unwrap();
        let wants = [Want {
            index: 1,
            name: "large.zst".into(),
        }];
        let h = &heads(&file, size, &slots, &wants, 64).unwrap()[0];
        assert!(h.bytes.is_empty() && h.refused.is_some());
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "refused from the frame header, not after decoding"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_honest_zstandard_entry_near_the_entry_cap_still_reads() {
        let mut data = Vec::with_capacity(15 << 20);
        let mut x = 1u32;
        while data.len() < 15 << 20 {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            data.extend(format!("line {} of an honest entry\n", x >> 20).as_bytes());
        }
        let entries = [Z::packed("big.zst", 93, zstd(&data), &data)];
        let (dir, file, size) = fixture("zstd-honest", &entries);
        assert!(read(&file, size, 0, "big.zst", &Limits::DEFAULT).unwrap() == data);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A streaming encoder that did not know the size: no content size, an 8 MB window, one raw block.
    #[test]
    fn a_small_zstandard_entry_with_an_8_mb_window_and_no_content_size_reads() {
        let data = b"streamed without a size, so the window is the level's own.";
        let mut frame = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00, 13 << 3];
        let header = ((data.len() as u32) << 3) | 1;
        frame.extend(&header.to_le_bytes()[..3]);
        frame.extend(data);
        let entries = [Z::packed("s.zst", 93, frame, data)];
        let (dir, file, size) = fixture("zstd-8mb", &entries);
        assert_eq!(
            read(&file, size, 0, "s.zst", &Limits::DEFAULT).unwrap(),
            data
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
