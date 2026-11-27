//! A RAR archive listed by hand from its block headers, RAR 4 and RAR 5: names, sizes, dates, folders and which entries
//! are encrypted. Nothing is unpacked: there is no RAR decoder under a licence the app may ship, so an entry's bytes are
//! refused with that sentence and the page says so for the whole archive.

use std::fs::File;

use super::{
    bytes_at, commas, iso_from_unix, link_text, raw_name_of, sanitise, zip, ArchiveEntry,
    ArchiveListing, Fault, Format, Limits,
};

const RAR4: &[u8; 7] = b"Rar!\x1a\x07\x00";
const RAR5: &[u8; 8] = b"Rar!\x1a\x07\x01\x00";
/// Headers one listing may step through, entries or not.
const STEPS: u64 = 4_000_000;
/// A RAR 5 header is at most 2 MB by the format.
const RAR5_HEADER: u64 = 2 * 1024 * 1024;

const NOTE: &str =
    "The contents cannot be read here: Marxy lists a RAR archive but does not unpack it.";

pub fn is_rar(head: &[u8]) -> bool {
    head.starts_with(RAR4) || head.starts_with(RAR5)
}

/// The sentence an entry's bytes are refused with.
pub fn refused() -> Fault {
    Fault::Unsupported("Marxy does not unpack RAR archives: there is no decoder it may use, so only the listing is shown.".into())
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// What a walk keeps between headers.
struct Listing<'a> {
    limits: &'a Limits,
    entries: Vec<ArchiveEntry>,
    skipped: u32,
    listed: usize,
    stop: Option<String>,
    note: &'static str,
}

impl Listing<'_> {
    fn damaged(&mut self, what: &str) {
        self.stop.get_or_insert_with(|| {
            format!(
                "The listing stopped at a damaged part after {} entries: {what}.",
                commas(self.entries.len() as u64)
            )
        });
    }

    /// Adds one entry by its decoded name; false once the listing is full.
    fn add(&mut self, decoded: &str, dir: bool, fill: impl FnOnce(&mut ArchiveEntry)) -> bool {
        if self.entries.len() >= self.limits.entries {
            self.stop = Some(format!(
                "Listed the first {} entries; more follow.",
                commas(self.entries.len() as u64)
            ));
            return false;
        }
        let index = (self.entries.len() as u32).saturating_add(self.skipped);
        let Some(clean) = sanitise(decoded, dir)
            .filter(|c| c.depth <= self.limits.depth && decoded.len() <= self.limits.name_bytes)
        else {
            self.skipped += 1;
            return true;
        };
        if self.listed + clean.path.len() > self.limits.listed_bytes {
            self.stop = Some(format!(
                "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                commas(self.entries.len() as u64)
            ));
            return false;
        }
        self.listed += clean.path.len();
        let mut e = ArchiveEntry::bare(index, clean.path.clone(), if dir { "dir" } else { "file" });
        e.raw_name = raw_name_of(&clean, decoded);
        fill(&mut e);
        self.entries.push(e);
        true
    }
}

fn host_name(host: u8, rar5: bool) -> Option<String> {
    let name = if rar5 {
        match host {
            0 => "Windows",
            1 => "Unix",
            _ => return None,
        }
    } else {
        match host {
            0 => "MS-DOS",
            1 => "OS/2",
            2 => "Windows",
            3 => "Unix",
            4 => "Mac OS",
            5 => "BeOS",
            _ => return None,
        }
    };
    Some(name.into())
}

/// RAR 4's Unicode name: the bytes after the NUL in the name field, which mostly refer back to the OEM name before it.
fn rar4_unicode(oem: &[u8], enc: &[u8]) -> Option<String> {
    let mut out: Vec<u16> = Vec::new();
    let high = u16::from(*enc.first()?);
    let mut pos = 1;
    let (mut flags, mut bits) = (0u8, 0u32);
    while pos < enc.len() {
        if bits == 0 {
            flags = enc[pos];
            pos += 1;
            bits = 8;
        }
        match flags >> 6 {
            0 => {
                out.push(u16::from(*enc.get(pos)?));
                pos += 1;
            }
            1 => {
                out.push(u16::from(*enc.get(pos)?) | high << 8);
                pos += 1;
            }
            2 => {
                out.push(u16::from(*enc.get(pos)?) | u16::from(*enc.get(pos + 1)?) << 8);
                pos += 2;
            }
            _ => {
                let len = *enc.get(pos)?;
                pos += 1;
                if len & 0x80 != 0 {
                    let fix = *enc.get(pos)?;
                    pos += 1;
                    for _ in 0..(len & 0x7f) + 2 {
                        let b = *oem.get(out.len())?;
                        out.push(u16::from(b.wrapping_add(fix)) | high << 8);
                    }
                } else {
                    for _ in 0..len + 2 {
                        out.push(u16::from(*oem.get(out.len())?));
                    }
                }
            }
        }
        flags <<= 2;
        bits -= 2;
    }
    Some(
        char::decode_utf16(out)
            .map(|c| c.unwrap_or('\u{fffd}'))
            .collect(),
    )
}

fn rar4(file: &File, size: u64, l: &mut Listing) {
    let mut at = RAR4.len() as u64;
    for _ in 0..STEPS {
        if at >= size || l.stop.is_some() {
            return;
        }
        let Some(h) = bytes_at(file, size, at, 7) else {
            return l.damaged("the file ends inside a header");
        };
        let (kind, flags, head_size) = (h[2], u16_at(&h, 3), u64::from(u16_at(&h, 5)));
        if head_size < 7 {
            return l.damaged("a header is too short");
        }
        let Some(hdr) = bytes_at(file, size, at, head_size as usize) else {
            return l.damaged("the file ends inside a header");
        };
        let mut add = if flags & 0x8000 != 0 && hdr.len() >= 11 {
            u64::from(u32_at(&hdr, 7))
        } else {
            0
        };
        match kind {
            // The main header: bit 7 says every later header is encrypted.
            0x73 if flags & 0x80 != 0 => {
                l.note = "The names in this RAR archive are encrypted: Marxy does not ask for archive passwords, so nothing is listed.";
                return;
            }
            0x74 => {
                if hdr.len() < 32 {
                    return l.damaged("an entry's header is too short");
                }
                let big = flags & 0x100 != 0;
                let name_at = if big { 40 } else { 32 };
                let name_len = usize::from(u16_at(&hdr, 26));
                let Some(raw) = hdr.get(name_at..name_at + name_len) else {
                    return l.damaged("an entry's name runs past its header");
                };
                let high = |at: usize| {
                    if big {
                        u64::from(u32_at(&hdr, at)) << 32
                    } else {
                        0
                    }
                };
                let packed = u64::from(u32_at(&hdr, 7)) | high(32);
                let unpacked = u64::from(u32_at(&hdr, 11)) | high(36);
                add = packed;
                let decoded = match raw.iter().position(|&b| b == 0) {
                    Some(nul) if flags & 0x200 != 0 => rar4_unicode(&raw[..nul], &raw[nul + 1..])
                        .unwrap_or_else(|| zip::decode_name(&raw[..nul], 0)),
                    _ if flags & 0x200 != 0 => String::from_utf8_lossy(raw).into_owned(),
                    _ => zip::decode_name(raw, 0),
                };
                let dir = flags & 0xe0 == 0xe0;
                let ftime = u32_at(&hdr, 20);
                let more = l.add(&decoded, dir, |e| {
                    if !dir {
                        e.size = Some(unpacked);
                        e.packed = Some(packed);
                        e.crc = Some(u32_at(&hdr, 16));
                        e.method = Some("RAR".into());
                    }
                    e.encrypted = flags & 0x04 != 0;
                    e.mtime = zip::dos_text(((ftime & 0xffff) as u16, (ftime >> 16) as u16));
                    e.host = host_name(hdr[15], false);
                    e.offset = Some(at);
                });
                if !more {
                    return;
                }
            }
            0x7b => return,
            _ => {}
        }
        let Some(next) = at
            .checked_add(head_size)
            .and_then(|n| n.checked_add(add))
            .filter(|&n| n > at)
        else {
            return l.damaged("a block's size is out of range");
        };
        if next > size {
            return l.damaged("an entry's data runs past the end of the file");
        }
        at = next;
    }
    l.stop
        .get_or_insert_with(|| format!("The listing stopped after {} headers.", commas(STEPS)));
}

/// A RAR 5 variable-length integer at `*pos` of `b`.
fn vint(b: &[u8], pos: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    for i in 0..10 {
        let byte = *b.get(*pos)?;
        *pos += 1;
        v |= u64::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

/// Windows FILETIME (100 ns from 1601) as Unix seconds.
fn filetime(ft: u64) -> i64 {
    (ft / 10_000_000) as i64 - 11_644_473_600
}

fn rar5(file: &File, size: u64, l: &mut Listing) {
    let mut at = RAR5.len() as u64;
    for _ in 0..STEPS {
        if at >= size || l.stop.is_some() {
            return;
        }
        let Some(head) = bytes_at(file, size, at, 14.min((size - at) as usize)) else {
            return l.damaged("the file ends inside a header");
        };
        let mut p = 4;
        let Some(head_size) = vint(&head, &mut p).filter(|&s| s > 0 && s <= RAR5_HEADER) else {
            return l.damaged("a header's size is out of range");
        };
        let start = at + p as u64;
        let Some(hdr) = bytes_at(file, size, start, head_size as usize) else {
            return l.damaged("the file ends inside a header");
        };
        if crc32fast::hash(&head_and(&head[4..p], &hdr)) != u32_at(&head, 0) {
            return l.damaged("a header does not match its check (CRC-32)");
        }
        let mut q = 0;
        let fields = (|| {
            let kind = vint(&hdr, &mut q)?;
            let flags = vint(&hdr, &mut q)?;
            let extra = if flags & 1 != 0 {
                vint(&hdr, &mut q)?
            } else {
                0
            };
            let data = if flags & 2 != 0 {
                vint(&hdr, &mut q)?
            } else {
                0
            };
            Some((kind, extra, data))
        })();
        let Some((kind, extra, data)) = fields else {
            return l.damaged("a header is cut short");
        };
        match kind {
            4 => {
                l.note = "The names in this RAR archive are encrypted: Marxy does not ask for archive passwords, so nothing is listed.";
                return;
            }
            2 => {
                if !file_header(&hdr, q, extra, data, at, l) {
                    return;
                }
            }
            5 => return,
            _ => {}
        }
        let Some(next) = start
            .checked_add(head_size)
            .and_then(|n| n.checked_add(data))
            .filter(|&n| n > at)
        else {
            return l.damaged("a block's size is out of range");
        };
        if next > size {
            return l.damaged("an entry's data runs past the end of the file");
        }
        at = next;
    }
    l.stop
        .get_or_insert_with(|| format!("The listing stopped after {} headers.", commas(STEPS)));
}

/// The header size field and the header after it, which is what RAR 5's CRC covers.
fn head_and(size_field: &[u8], hdr: &[u8]) -> Vec<u8> {
    let mut v = size_field.to_vec();
    v.extend(hdr);
    v
}

/// One RAR 5 file header from byte `q` of `hdr`; false once the listing is full or the header is damaged.
fn file_header(hdr: &[u8], mut q: usize, extra: u64, data: u64, at: u64, l: &mut Listing) -> bool {
    let parsed = (|| {
        let file_flags = vint(hdr, &mut q)?;
        let unpacked = vint(hdr, &mut q)?;
        let _attributes = vint(hdr, &mut q)?;
        let mtime = if file_flags & 2 != 0 {
            let t = u32_at(hdr.get(q..q + 4)?, 0);
            q += 4;
            Some(i64::from(t))
        } else {
            None
        };
        let crc = if file_flags & 4 != 0 {
            let c = u32_at(hdr.get(q..q + 4)?, 0);
            q += 4;
            Some(c)
        } else {
            None
        };
        let _compression = vint(hdr, &mut q)?;
        let host = vint(hdr, &mut q)?;
        let name_len = usize::try_from(vint(hdr, &mut q)?).ok()?;
        let name = hdr.get(q..q.checked_add(name_len)?)?;
        Some((file_flags, unpacked, mtime, crc, host, name))
    })();
    let Some((file_flags, unpacked, mtime, crc, host, name)) = parsed else {
        l.damaged("an entry's header is cut short");
        return false;
    };
    let mut encrypted = false;
    let mut link: Option<String> = None;
    let mut mtime = mtime;
    // The extra area is the header's last `extra` bytes: records of size, type and data.
    if let Some(mut p) = usize::try_from(extra)
        .ok()
        .and_then(|x| hdr.len().checked_sub(x))
    {
        while p < hdr.len() {
            let Some(rec_size) = vint(hdr, &mut p).and_then(|s| usize::try_from(s).ok()) else {
                break;
            };
            let Some(end) = p.checked_add(rec_size).filter(|&e| e <= hdr.len()) else {
                break;
            };
            let mut r = p;
            match vint(hdr, &mut r) {
                Some(1) => encrypted = true,
                Some(3) => {
                    let time_flags = vint(hdr, &mut r).unwrap_or(0);
                    if time_flags & 2 != 0 && mtime.is_none() {
                        mtime = if time_flags & 1 != 0 {
                            hdr.get(r..r + 4).map(|b| i64::from(u32_at(b, 0)))
                        } else {
                            hdr.get(r..r + 8).map(|b| {
                                filetime(u64::from_le_bytes(b.try_into().unwrap_or([0; 8])))
                            })
                        };
                    }
                }
                Some(5) => {
                    let _kind = vint(hdr, &mut r);
                    let _flags = vint(hdr, &mut r);
                    let target = vint(hdr, &mut r)
                        .and_then(|n| usize::try_from(n).ok())
                        .and_then(|n| hdr.get(r..r.checked_add(n)?));
                    link = Some(target.map(|t| link_text(t, l.limits)).unwrap_or_default());
                }
                _ => {}
            }
            p = end;
        }
    }
    let dir = file_flags & 1 != 0;
    let decoded = String::from_utf8_lossy(name).into_owned();
    l.add(&decoded, dir, |e| {
        if link.is_some() {
            e.kind = "link".into();
            e.link = link;
        }
        if !dir {
            e.size = (file_flags & 8 == 0).then_some(unpacked);
            e.packed = Some(data);
            e.crc = crc;
            // The page reads a method as one the app does not unpack, which is every RAR entry, stored or not.
            e.method = Some("RAR".into());
        }
        e.encrypted = encrypted;
        e.mtime = mtime.and_then(|m| iso_from_unix(m, true));
        e.host = u8::try_from(host).ok().and_then(|h| host_name(h, true));
        e.offset = Some(at);
    })
}

pub fn list(file: &File, size: u64, limits: &Limits) -> Result<ArchiveListing, Fault> {
    let mut l = Listing {
        limits,
        entries: Vec::new(),
        skipped: 0,
        listed: 0,
        stop: None,
        note: NOTE,
    };
    let head = bytes_at(file, size, 0, 8.min(size as usize)).unwrap_or_default();
    if head.starts_with(RAR5) {
        rar5(file, size, &mut l);
    } else {
        rar4(file, size, &mut l);
    }
    let listing = ArchiveListing {
        format: Format::Rar.name().into(),
        entries: l.entries,
        comment: None,
        truncated: l.stop,
        skipped: l.skipped,
        declared: None,
        size,
        unpacked: None,
        directory: None,
        note: Some(l.note.into()),
    };
    Ok(listing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{heads as all_heads, list as list_any, read as read_any, Want};

    fn temp(name: &str, bytes: &[u8]) -> (std::path::PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-rar-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, File::open(&path).unwrap())
    }

    /// A RAR 4 file block: `(name, data, flags)`, its date 2023-11-14 22:13:20.
    fn block4(name: &str, data: &[u8], flags: u16) -> Vec<u8> {
        let mut h = vec![0u8; 32];
        h[2] = 0x74;
        h[3..5].copy_from_slice(&(flags | 0x8000).to_le_bytes());
        h[5..7].copy_from_slice(&((32 + name.len()) as u16).to_le_bytes());
        h[7..11].copy_from_slice(&(data.len() as u32).to_le_bytes());
        h[11..15].copy_from_slice(&(data.len() as u32).to_le_bytes());
        h[15] = 3;
        h[16..20].copy_from_slice(&crc32fast::hash(data).to_le_bytes());
        let date = ((2023 - 1980) << 9) | (11 << 5) | 14u32;
        let time = (22 << 11) | (13 << 5) | 10u32;
        h[20..24].copy_from_slice(&(time | date << 16).to_le_bytes());
        h[24] = 29;
        h[25] = 0x30;
        h[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
        h.extend(name.as_bytes());
        h.extend(data);
        h
    }

    pub fn rar4(main_flags: u16, blocks: &[Vec<u8>]) -> Vec<u8> {
        let mut out = RAR4.to_vec();
        let mut main = vec![0u8; 13];
        main[2] = 0x73;
        main[3..5].copy_from_slice(&main_flags.to_le_bytes());
        main[5..7].copy_from_slice(&13u16.to_le_bytes());
        out.extend(main);
        for b in blocks {
            out.extend(b);
        }
        out.extend([0, 0, 0x7b, 0, 0x40, 7, 0]);
        out
    }

    fn v(mut n: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let b = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                out.push(b);
                return out;
            }
            out.push(b | 0x80);
        }
    }

    /// A RAR 5 block of `kind`, with `body` after the type and flags, `extra` records and `data` after the header.
    fn block5(kind: u64, body: &[u8], extra: &[u8], data: &[u8]) -> Vec<u8> {
        let mut flags = 0;
        let mut hdr = Vec::new();
        if !extra.is_empty() {
            flags |= 1;
        }
        if !data.is_empty() {
            flags |= 2;
        }
        hdr.extend(v(kind));
        hdr.extend(v(flags));
        if !extra.is_empty() {
            hdr.extend(v(extra.len() as u64));
        }
        if !data.is_empty() {
            hdr.extend(v(data.len() as u64));
        }
        hdr.extend(body);
        hdr.extend(extra);
        let size = v(hdr.len() as u64);
        let mut checked = size.clone();
        checked.extend(&hdr);
        let mut out = crc32fast::hash(&checked).to_le_bytes().to_vec();
        out.extend(size);
        out.extend(hdr);
        out.extend(data);
        out
    }

    fn file5(name: &str, data: &[u8], dir: bool, extra: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend(v(if dir { 1 } else { 2 | 4 }));
        body.extend(v(data.len() as u64));
        body.extend(v(0x20));
        if !dir {
            body.extend(1_700_000_000u32.to_le_bytes());
            body.extend(crc32fast::hash(data).to_le_bytes());
        }
        body.extend(v(2 << 7));
        body.extend(v(1));
        body.extend(v(name.len() as u64));
        body.extend(name.as_bytes());
        block5(2, &body, extra, data)
    }

    pub fn rar5(blocks: &[Vec<u8>]) -> Vec<u8> {
        let mut out = RAR5.to_vec();
        out.extend(block5(1, &v(0), &[], &[]));
        for b in blocks {
            out.extend(b);
        }
        out.extend(block5(5, &v(0), &[], &[]));
        out
    }

    #[test]
    fn a_rar4_archive_lists_names_sizes_dates_and_encryption_and_refuses_its_bytes() {
        let bytes = rar4(
            0,
            &[
                block4("docs\\a.txt", b"alpha", 0),
                block4("docs", b"", 0xe0),
                block4("secret.bin", b"xyz", 0x04),
            ],
        );
        let (dir, file) = temp("four.rar", &bytes);
        let l = list_any(&file, "four.rar", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "rar");
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str(), e.size, e.encrypted))
            .collect();
        assert_eq!(
            rows,
            [
                ("docs/a.txt", "file", Some(5), false),
                ("docs/", "dir", None, false),
                ("secret.bin", "file", Some(3), true)
            ]
        );
        assert_eq!(l.entries[0].mtime.as_deref(), Some("2023-11-14T22:13:20"));
        assert_eq!(l.entries[0].host.as_deref(), Some("Unix"));
        assert_eq!(l.note.as_deref(), Some(NOTE));
        assert_eq!(l.truncated, None);
        assert!(matches!(
            read_any(&file, "four.rar", 0, "docs/a.txt", &Limits::DEFAULT, None),
            Err(Fault::Unsupported(_))
        ));
        let got = all_heads(
            &file,
            "four.rar",
            &[Want {
                index: 0,
                name: "docs/a.txt".into(),
            }],
            8,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert!(got[0]
            .refused
            .as_deref()
            .unwrap()
            .starts_with("Marxy does not unpack RAR archives"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_rar4_unicode_name_is_decoded() {
        // "ab" in OEM, then high byte 0, flags 0b11 (copy from OEM) with length 0: two bytes copied.
        assert_eq!(rar4_unicode(b"ab", &[0, 0xc0, 0]).as_deref(), Some("ab"));
        // A two-byte character: flags 0b10.
        assert_eq!(
            rar4_unicode(b"?", &[0, 0x80, 0xac, 0x20]).as_deref(),
            Some("\u{20ac}")
        );
        assert_eq!(
            rar4_unicode(b"", &[0, 0xc0, 5]),
            None,
            "a copy past the OEM name is refused"
        );
    }

    #[test]
    fn a_rar5_archive_lists_names_sizes_dates_links_and_encryption() {
        let crypt = {
            let rec = [v(1), vec![0u8; 4]].concat();
            [v(rec.len() as u64), rec].concat()
        };
        let link = {
            let rec = [v(5), v(1), v(0), v(6), b"a.txt".to_vec(), vec![0]].concat();
            [v(rec.len() as u64), rec].concat()
        };
        let bytes = rar5(&[
            file5("notes/a.txt", b"alpha", false, &[]),
            file5("notes", b"", true, &[]),
            file5("locked.bin", b"xyz", false, &crypt),
            file5("notes/to-a", b"", false, &link),
        ]);
        let (dir, file) = temp("five.rar", &bytes);
        let l = list_any(&file, "five.rar", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str(), e.size, e.encrypted))
            .collect();
        assert_eq!(
            rows,
            [
                ("notes/a.txt", "file", Some(5), false),
                ("notes/", "dir", None, false),
                ("locked.bin", "file", Some(3), true),
                ("notes/to-a", "link", Some(0), false)
            ]
        );
        assert_eq!(l.entries[0].mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(l.entries[0].method.as_deref(), Some("RAR"));
        assert_eq!(l.entries[3].link.as_deref(), Some("a.txt\u{fffd}"));
        assert_eq!(l.truncated, None);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn encrypted_names_cut_files_and_huge_sizes_end_in_a_sentence() {
        let (dir, file) = temp("hidden.rar", &rar4(0x80, &[block4("a.txt", b"alpha", 0)]));
        let l = list_any(&file, "hidden.rar", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert!(l.entries.is_empty());
        assert!(l
            .note
            .unwrap()
            .starts_with("The names in this RAR archive are encrypted"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let (dir, file) = temp(
            "hidden5.rar",
            &[RAR5.to_vec(), block5(4, &v(0), &[], &[])].concat(),
        );
        assert!(list_any(&file, "hidden5.rar", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap()
            .note
            .unwrap()
            .contains("encrypted"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        let mut huge = block4("big.bin", b"abc", 0);
        huge[7..11].copy_from_slice(&u32::MAX.to_le_bytes());
        let (dir, file) = temp("huge.rar", &rar4(0, &[huge, block4("after.txt", b"x", 0)]));
        let l = list_any(&file, "huge.rar", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.entries.len(), 1);
        assert!(l.truncated.unwrap().contains("runs past the end"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);

        for whole in [
            rar4(0, &[block4("a.txt", b"alpha", 0)]),
            rar5(&[file5("a.txt", b"alpha", false, &[])]),
        ] {
            for cut in 8..whole.len() {
                let (dir, file) = temp(&format!("cut{cut}.rar"), &whole[..cut]);
                let l = list_any(&file, "cut.rar", &Limits::DEFAULT, None)
                    .unwrap()
                    .unwrap();
                assert!(l.entries.len() <= 1);
                drop(file);
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }
}
