//! An ISO 9660 image by hand: the volume descriptors from sector 16, then the directory records from the root down,
//! with Joliet's names when a supplementary descriptor carries them. Every folder is walked once (a record that points
//! back at a folder already walked is listed, not followed), and the walk is charged a step for each record and each
//! sector against a budget, so a cycle or a huge declared folder ends in a sentence, not a hang.

use std::collections::{HashSet, VecDeque};
use std::fs::File;

use super::{
    bytes_at, changed, commas, folder, head_of, iso_from_unix, sanitise, too_big_declared,
    ArchiveEntry, ArchiveListing, Fault, Format, Head, Limits, Want,
};

const SECTOR: u64 = 2048;
/// Volume descriptors looked at before giving up on a terminator.
const DESCRIPTORS: u64 = 64;
/// Records plus sectors one listing may walk.
const STEPS: u64 = 4_000_000;
/// The most of one folder's records read, and of all folders together.
const FOLDER_BYTES: u64 = 16 * 1024 * 1024;
const ALL_FOLDER_BYTES: u64 = 256 * 1024 * 1024;

/// `CD001` in the first volume descriptor.
pub fn is_iso(file: &File, size: u64) -> bool {
    bytes_at(file, size, 16 * SECTOR + 1, 5).is_some_and(|b| b == b"CD001")
}

#[derive(Debug, Clone)]
pub struct Slot {
    index: u32,
    path: String,
    dir: bool,
    /// Where its bytes lie: more than one when the file is recorded in several extents.
    extents: Vec<(u64, u64)>,
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// Days from 1970-01-01 to a civil date (proleptic Gregorian).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = i64::from((m + 9) % 12);
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// A directory record's seven-byte date: years since 1900, month, day, hour, minute, second, and its zone in quarter
/// hours from UTC, given in UTC.
fn record_date(b: &[u8]) -> Option<String> {
    let (m, d) = (u32::from(b[1]), u32::from(b[2]));
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || b[3] > 23 || b[4] > 59 || b[5] > 59 {
        return None;
    }
    let days = days_from_civil(1900 + i64::from(b[0]), m, d);
    let secs = days * 86_400 + i64::from(b[3]) * 3_600 + i64::from(b[4]) * 60 + i64::from(b[5]);
    iso_from_unix(secs - i64::from(b[6] as i8) * 900, true)
}

/// A record's name: Joliet's UCS-2, or the primary's d-characters; the `;1` version and a bare trailing dot go.
fn record_name(raw: &[u8], joliet: bool) -> String {
    let name = if joliet {
        let units = raw
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_be_bytes(*c));
        char::decode_utf16(units)
            .map(|c| c.unwrap_or('\u{fffd}'))
            .collect::<String>()
    } else {
        raw.iter().map(|&b| b as char).collect()
    };
    let name = match name.rfind(';') {
        Some(at) if name[at + 1..].chars().all(|c| c.is_ascii_digit()) => name[..at].to_owned(),
        _ => name,
    };
    match name.strip_suffix('.') {
        Some(stem) if !stem.is_empty() && !joliet => stem.to_owned(),
        _ => name,
    }
}

struct Walk<'a> {
    file: &'a File,
    size: u64,
    block: u64,
    joliet: bool,
    limits: &'a Limits,
    steps: u64,
    folder_bytes: u64,
    stop: Option<String>,
    entries: Vec<ArchiveEntry>,
    slots: Vec<Slot>,
    skipped: u32,
    listed: usize,
    ordinal: u32,
}

impl Walk<'_> {
    fn charge(&mut self, n: u64) -> bool {
        self.steps += n;
        if self.steps > STEPS && self.stop.is_none() {
            self.stop = Some(format!(
                "Listed the first {} entries: the walk of the image's folders stops after {} steps.",
                commas(self.entries.len() as u64),
                commas(STEPS)
            ));
        }
        self.stop.is_none()
    }

    fn damaged(&mut self, what: &str) {
        self.stop.get_or_insert_with(|| {
            format!(
                "The listing stopped at a damaged part after {} entries: {what}.",
                commas(self.entries.len() as u64)
            )
        });
    }

    /// The records of the folder at `lba`, `len` bytes long, whose own path is `prefix`; its subfolders go on `queue`.
    fn folder(
        &mut self,
        lba: u64,
        len: u64,
        prefix: &str,
        depth: usize,
        queue: &mut VecDeque<(u64, u64, String, usize)>,
        seen: &mut HashSet<u64>,
    ) {
        let len = len.min(FOLDER_BYTES);
        self.folder_bytes += len;
        if self.folder_bytes > ALL_FOLDER_BYTES {
            self.stop.get_or_insert_with(|| "The walk stopped: the image's folders pass the 256 MB of records the app reads.".into());
            return;
        }
        if !self.charge(len.div_ceil(SECTOR)) {
            return;
        }
        let Some(data) = lba
            .checked_mul(self.block)
            .and_then(|at| bytes_at(self.file, self.size, at, len as usize))
        else {
            self.damaged("a folder lies past the end of the image");
            return;
        };
        let mut at = 0usize;
        let mut pending: Option<usize> = None;
        while at < data.len() {
            if !self.charge(1) || self.stop.is_some() {
                return;
            }
            let rec_len = usize::from(data[at]);
            // Records never cross a sector; a zero length pads to the next one.
            if rec_len == 0 {
                at = (at / SECTOR as usize + 1) * SECTOR as usize;
                continue;
            }
            if rec_len < 34 || at + rec_len > data.len() {
                self.damaged("a folder record is cut short");
                return;
            }
            let rec = &data[at..at + rec_len];
            at += rec_len;
            let name_len = usize::from(rec[32]);
            if 33 + name_len > rec.len() {
                self.damaged("a name runs past its record");
                return;
            }
            let raw = &rec[33..33 + name_len];
            if raw == [0] || raw == [1] {
                continue;
            }
            let flags = rec[25];
            let (extent, size) = (u64::from(u32_at(rec, 2)), u64::from(u32_at(rec, 10)));
            let dir = flags & 2 != 0;
            let place = extent.saturating_mul(self.block);
            // A file recorded in several extents: each record but the last carries bit 7, all under one name.
            if let Some(i) = pending.take() {
                let slot = &mut self.slots[i];
                slot.extents.push((place, size));
                let total: u64 = slot.extents.iter().map(|e| e.1).sum();
                self.entries[i].size = Some(total);
                if flags & 0x80 != 0 {
                    pending = Some(i);
                }
                continue;
            }
            let index = self.ordinal;
            self.ordinal += 1;
            if flags & 4 != 0 || name_len > self.limits.name_bytes {
                self.skipped += 1;
                continue;
            }
            let decoded = format!("{prefix}{}", record_name(raw, self.joliet));
            let Some(clean) = sanitise(&decoded, dir).filter(|c| c.depth <= self.limits.depth)
            else {
                self.skipped += 1;
                continue;
            };
            if self.entries.len() >= self.limits.entries {
                self.stop = Some(format!(
                    "Listed the first {} entries; more follow.",
                    commas(self.entries.len() as u64)
                ));
                return;
            }
            if self.listed + clean.path.len() > self.limits.listed_bytes {
                self.stop = Some(format!(
                    "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                    commas(self.entries.len() as u64)
                ));
                return;
            }
            self.listed += clean.path.len();
            let mut e =
                ArchiveEntry::bare(index, clean.path.clone(), if dir { "dir" } else { "file" });
            e.mtime = record_date(&rec[18..25]);
            e.offset = Some(place);
            if !dir {
                e.size = Some(size);
                if flags & 0x80 != 0 {
                    pending = Some(self.entries.len());
                }
            } else if seen.insert(extent) {
                queue.push_back((extent, size, clean.path.clone(), depth + 1));
            }
            self.slots.push(Slot {
                index,
                path: clean.path,
                dir,
                extents: vec![(place, size)],
            });
            self.entries.push(e);
        }
    }
}

pub fn list(file: &File, size: u64, limits: &Limits) -> Result<(ArchiveListing, Vec<Slot>), Fault> {
    let bad = |what: &str| Fault::Invalid(format!("The listing could not be read: {what}."));
    let mut primary: Option<Vec<u8>> = None;
    let mut joliet: Option<Vec<u8>> = None;
    for n in 16..16 + DESCRIPTORS {
        let Some(d) = bytes_at(file, size, n * SECTOR, SECTOR as usize) else {
            break;
        };
        if &d[1..6] != b"CD001" || d[0] == 255 {
            break;
        }
        // Joliet's escape sequences name UCS-2 at levels 1 to 3.
        if d[0] == 2 && d[88..90] == *b"%/" && matches!(d[90], b'@' | b'C' | b'E') {
            joliet.get_or_insert(d);
        } else if d[0] == 1 {
            primary.get_or_insert(d);
        }
    }
    let primary = primary.ok_or_else(|| bad("the image has no primary volume descriptor"))?;
    let use_joliet = joliet.is_some();
    let d = joliet.unwrap_or(primary);
    let block = u64::from(u16::from_le_bytes([d[128], d[129]]));
    if !matches!(block, 512 | 1024 | 2048) {
        return Err(bad("its block size is not one an image uses"));
    }
    let root = &d[156..190];
    let (root_lba, root_len) = (u64::from(u32_at(root, 2)), u64::from(u32_at(root, 10)));
    let mut walk = Walk {
        file,
        size,
        block,
        joliet: use_joliet,
        limits,
        steps: 0,
        folder_bytes: 0,
        stop: None,
        entries: Vec::new(),
        slots: Vec::new(),
        skipped: 0,
        listed: 0,
        ordinal: 0,
    };
    let mut seen = HashSet::from([root_lba]);
    let mut queue = VecDeque::from([(root_lba, root_len, String::new(), 0usize)]);
    while let Some((lba, len, prefix, depth)) = queue.pop_front() {
        if walk.stop.is_some() {
            break;
        }
        let prefix = if prefix.is_empty() {
            prefix
        } else {
            format!("{}/", prefix.trim_end_matches('/'))
        };
        walk.folder(lba, len, &prefix, depth, &mut queue, &mut seen);
    }
    if walk.entries.is_empty() && walk.skipped == 0 {
        if let Some(stop) = walk.stop.as_ref().filter(|s| s.contains("damaged")) {
            return Err(Fault::Invalid(stop.clone()));
        }
    }
    let listing = ArchiveListing {
        format: Format::Iso.name().into(),
        entries: walk.entries,
        comment: None,
        truncated: walk.stop,
        skipped: walk.skipped,
        declared: None,
        size,
        unpacked: None,
        directory: None,
        note: None,
    };
    Ok((listing, walk.slots))
}

fn slot_of<'a>(slots: &'a [Slot], index: u32, name: &str) -> Result<&'a Slot, Fault> {
    slots
        .binary_search_by_key(&index, |s| s.index)
        .ok()
        .map(|at| &slots[at])
        .filter(|s| s.path == name)
        .ok_or_else(changed)
}

/// At most `cap` bytes of the file the slot places, read from its extents as they lie, and whether it ended in them.
fn file_bytes(file: &File, size: u64, slot: &Slot, cap: u64) -> Result<(Vec<u8>, bool), Fault> {
    if slot.dir {
        return Err(folder());
    }
    let mut out = Vec::new();
    for &(at, len) in &slot.extents {
        if at.checked_add(len).is_none_or(|e| e > size) {
            return Err(super::damaged(&slot.path));
        }
        let room = cap + 1 - out.len() as u64;
        let take = len.min(room);
        out.extend(
            bytes_at(file, size, at, take as usize).ok_or_else(|| super::damaged(&slot.path))?,
        );
        if out.len() as u64 > cap {
            break;
        }
    }
    let (bytes, whole) = head_of(&out[..], cap)?;
    Ok((bytes, whole))
}

pub fn read(
    file: &File,
    size: u64,
    slots: &[Slot],
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let slot = slot_of(slots, index, name)?;
    let total: u64 = slot.extents.iter().map(|e| e.1).sum();
    if !slot.dir && total > limits.entry {
        return Err(too_big_declared(name, total));
    }
    Ok(file_bytes(file, size, slot, limits.entry)?.0)
}

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
            Head::of(
                w.index,
                slot_of(slots, w.index, &w.name).and_then(|s| file_bytes(file, size, s, max_each)),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{heads as all_heads, list as list_any, read as read_any};

    /// One directory record.
    fn record(name: &[u8], lba: u32, len: u32, flags: u8) -> Vec<u8> {
        let mut r = vec![0u8; 33];
        r[2..6].copy_from_slice(&lba.to_le_bytes());
        r[6..10].copy_from_slice(&lba.to_be_bytes());
        r[10..14].copy_from_slice(&len.to_le_bytes());
        r[14..18].copy_from_slice(&len.to_be_bytes());
        // 2023-11-14 22:13:20 UTC, written as 23:13:20 at UTC+1.
        r[18..25].copy_from_slice(&[123, 11, 14, 23, 13, 20, 4]);
        r[25] = flags;
        r[28] = 1;
        r[32] = name.len() as u8;
        r.extend(name);
        if r.len() % 2 == 1 {
            r.push(0);
        }
        r[0] = r.len() as u8;
        r
    }

    fn joliet(name: &str) -> Vec<u8> {
        name.encode_utf16().flat_map(u16::to_be_bytes).collect()
    }

    /// An image: descriptors at 16 (primary), 17 (Joliet when asked), then the terminator; the folders and files after.
    /// `cycle` makes the subfolder hold a record that points back at the root.
    pub fn image(with_joliet: bool, cycle: bool) -> Vec<u8> {
        let mut img = vec![0u8; 2048 * 30];
        let mut put = |sector: usize, bytes: &[u8]| {
            img[sector * 2048..sector * 2048 + bytes.len()].copy_from_slice(bytes)
        };
        let names = |j: bool, n: &str| {
            if j {
                joliet(n)
            } else {
                n.to_uppercase().into_bytes()
            }
        };
        for (sector, j, root_at, sub_at) in [(20usize, false, 20u32, 21u32), (22, true, 22, 23)] {
            if j && !with_joliet {
                continue;
            }
            let mut root = record(&[0], root_at, 2048, 2);
            root.extend(record(&[1], root_at, 2048, 2));
            let mut file_name = names(j, "readme.txt");
            if !j {
                file_name.extend(b";1");
            }
            root.extend(record(&file_name, 25, 13, 0));
            root.extend(record(&names(j, "docs"), sub_at, 2048, 2));
            put(sector, &root);
            let mut sub = record(&[0], sub_at, 2048, 2);
            sub.extend(record(&[1], root_at, 2048, 2));
            let mut long = names(j, "a long note name.md");
            if !j {
                long = b"NOTE.MD;1".to_vec();
            }
            sub.extend(record(&long, 26, 5, 0));
            if cycle {
                sub.extend(record(&names(j, "loop"), root_at, 2048, 2));
            }
            put(sector + 1, &sub);
        }
        put(25, b"Hello, image\n");
        put(26, b"notes");
        for (sector, kind) in [(16usize, 1u8), (17, 2)] {
            if kind == 2 && !with_joliet {
                continue;
            }
            let mut d = vec![0u8; 2048];
            d[0] = kind;
            d[1..6].copy_from_slice(b"CD001");
            d[6] = 1;
            d[128..130].copy_from_slice(&2048u16.to_le_bytes());
            if kind == 2 {
                d[88..91].copy_from_slice(b"%/E");
            }
            let root = record(&[0], if kind == 1 { 20 } else { 22 }, 2048, 2);
            d[156..156 + 34].copy_from_slice(&root[..34]);
            put(sector, &d);
        }
        let mut term = vec![0u8; 2048];
        term[0] = 255;
        term[1..6].copy_from_slice(b"CD001");
        put(if with_joliet { 18 } else { 17 }, &term);
        img
    }

    fn temp(name: &str, bytes: &[u8]) -> (std::path::PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-iso-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, File::open(&path).unwrap())
    }

    #[test]
    fn an_image_lists_its_folders_and_files_and_reads_one() {
        let (dir, file) = temp("plain.iso", &image(false, false));
        let l = list_any(&file, "plain.iso", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "iso");
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str(), e.size))
            .collect();
        assert_eq!(
            rows,
            [
                ("README.TXT", "file", Some(13)),
                ("DOCS/", "dir", None),
                ("DOCS/NOTE.MD", "file", Some(5))
            ]
        );
        assert_eq!(l.entries[0].mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(
            read_any(&file, "plain.iso", 0, "README.TXT", &Limits::DEFAULT, None).unwrap(),
            b"Hello, image\n"
        );
        let got = all_heads(
            &file,
            "plain.iso",
            &[
                Want {
                    index: 2,
                    name: "DOCS/NOTE.MD".into(),
                },
                Want {
                    index: 1,
                    name: "DOCS/".into(),
                },
            ],
            3,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!(
            (got[0].bytes.as_slice(), got[0].whole),
            (&b"not"[..], false)
        );
        assert_eq!(
            got[1].refused.as_deref(),
            Some("A folder has nothing to open.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn joliet_names_are_used_when_the_image_has_them() {
        let (dir, file) = temp("joliet.iso", &image(true, false));
        let l = list_any(&file, "joliet.iso", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["readme.txt", "docs/", "docs/a long note name.md"]);
        assert_eq!(
            read_any(
                &file,
                "joliet.iso",
                2,
                "docs/a long note name.md",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"notes"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_folder_that_points_back_at_the_root_is_listed_once_and_not_followed() {
        let (dir, file) = temp("cycle.iso", &image(false, true));
        let started = std::time::Instant::now();
        let l = list_any(&file, "cycle.iso", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["README.TXT", "DOCS/", "DOCS/NOTE.MD", "DOCS/LOOP/"]);
        assert_eq!(l.truncated, None);
        assert!(started.elapsed().as_secs() < 5);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn huge_declared_folders_and_files_and_a_cut_image_stop_with_a_sentence() {
        let mut img = image(false, false);
        // The subfolder declares 4 GB of records and the file 4 GB of bytes.
        let at = 20 * 2048 + 34 + 34;
        let file_rec = img[at] as usize;
        img[at + 10..at + 14].copy_from_slice(&u32::MAX.to_le_bytes());
        img[at + file_rec + 10..at + file_rec + 14].copy_from_slice(&u32::MAX.to_le_bytes());
        let (dir, file) = temp("huge.iso", &img);
        let started = std::time::Instant::now();
        let l = list_any(&file, "huge.iso", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert!(
            l.truncated
                .as_deref()
                .unwrap()
                .contains("past the end of the image"),
            "{:?}",
            l.truncated
        );
        assert!(matches!(
            read_any(&file, "huge.iso", 0, "README.TXT", &Limits::DEFAULT, None),
            Err(Fault::Refused(_))
        ));
        assert!(started.elapsed().as_secs() < 5);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let whole = image(true, true);
        for cut in [
            16 * 2048 + 10,
            17 * 2048,
            20 * 2048 + 40,
            23 * 2048 + 100,
            25 * 2048 + 4,
        ] {
            let (dir, file) = temp(&format!("cut{cut}.iso"), &whole[..cut]);
            if let Ok(Some(l)) = list_any(&file, "cut.iso", &Limits::DEFAULT, None) {
                for e in &l.entries {
                    let _ = read_any(&file, "cut.iso", e.index, &e.path, &Limits::DEFAULT, None);
                }
            }
            drop(file);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn dates_turn_from_their_zone_to_utc() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 2, 29), 11_016);
        assert_eq!(
            record_date(&[70, 1, 1, 0, 0, 0, 0]).as_deref(),
            Some("1970-01-01T00:00:00Z")
        );
        assert_eq!(record_date(&[0, 0, 0, 0, 0, 0, 0]), None);
    }
}
