//! A Microsoft cabinet by hand: the CFHEADER, its CFFOLDER records and its CFFILE records give the listing. An entry in
//! a folder stored as is or packed with MSZIP is read block by block; LZX and Quantum folders are listed, not unpacked.
//! Every count, offset and length is checked against the file before it is used.

use std::fs::File;
use std::io::Read;

use super::{
    bytes_at, changed, commas, damaged, too_big_actual, too_big_declared, zip, ArchiveEntry,
    ArchiveListing, Fault, Format, Head, Limits, Want,
};

const MAGIC: &[u8; 4] = b"MSCF";
/// MSZIP's window, which each block may reach back into across the block before it.
const WINDOW: usize = 32 * 1024;

pub fn is_cab(head: &[u8]) -> bool {
    head.len() >= 36 && head.starts_with(MAGIC) && head[4..8] == [0; 4] && head[25] == 1
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

#[derive(Debug, Clone, Copy)]
struct Folder {
    start: u32,
    blocks: u16,
    method: u16,
}

#[derive(Debug, Clone)]
struct Slot {
    index: u32,
    path: String,
    folder: u16,
    offset: u32,
    size: u32,
}

/// What a read needs of a cabinet: its folders, where each entry lies in them, and the reserve each data block carries.
#[derive(Debug)]
pub struct Cab {
    folders: Vec<Folder>,
    slots: Vec<Slot>,
    data_reserve: u64,
}

fn method_name(method: u16) -> &'static str {
    match method & 0x0f {
        0 => "stored",
        1 => "MSZIP",
        2 => "Quantum",
        3 => "LZX",
        _ => "an unknown method",
    }
}

fn damage(what: &str) -> Fault {
    Fault::Invalid(format!("The listing could not be read: {what}."))
}

/// A NUL-ended string at `at`, at most `max` bytes, and the byte after its NUL.
fn c_string(file: &File, size: u64, at: u64, max: usize) -> Option<(Vec<u8>, u64)> {
    let room = usize::try_from(size.checked_sub(at)?)
        .unwrap_or(usize::MAX)
        .min(max + 1);
    let bytes = bytes_at(file, size, at, room)?;
    let end = bytes.iter().position(|&b| b == 0)?;
    Some((bytes[..end].to_vec(), at + end as u64 + 1))
}

pub fn list(file: &File, size: u64, limits: &Limits) -> Result<(ArchiveListing, Cab), Fault> {
    let h = bytes_at(file, size, 0, 36).ok_or_else(|| damage("the header is cut short"))?;
    let files_at = u64::from(u32_at(&h, 16));
    let (n_folders, n_files, flags) = (u16_at(&h, 26), u16_at(&h, 28), u16_at(&h, 30));
    let mut at = 36u64;
    let (mut folder_reserve, mut data_reserve) = (0u64, 0u64);
    if flags & 4 != 0 {
        let r = bytes_at(file, size, at, 4).ok_or_else(|| damage("the header is cut short"))?;
        folder_reserve = u64::from(r[2]);
        data_reserve = u64::from(r[3]);
        at += 4 + u64::from(u16_at(&r, 0));
    }
    // A cabinet in a set names the ones before and after it; its entries that cross into them are listed, not read.
    for bit in [1u16, 2] {
        if flags & bit != 0 {
            for _ in 0..2 {
                at = c_string(file, size, at, 255)
                    .ok_or_else(|| damage("a neighbour's name is damaged"))?
                    .1;
            }
        }
    }
    let mut folders = Vec::with_capacity(usize::from(n_folders).min(1024));
    for _ in 0..n_folders {
        let f = bytes_at(file, size, at, 8)
            .ok_or_else(|| damage("a folder record lies past the end of the file"))?;
        folders.push(Folder {
            start: u32_at(&f, 0),
            blocks: u16_at(&f, 4),
            method: u16_at(&f, 6),
        });
        at += 8 + folder_reserve;
    }
    let mut entries = Vec::new();
    let mut slots = Vec::new();
    let mut truncated = None;
    let mut skipped = 0u32;
    let mut listed = 0usize;
    let mut at = files_at;
    for i in 0..n_files {
        if usize::from(i) >= limits.entries {
            truncated = Some(format!(
                "Listed the first {} entries; the cabinet declares {}.",
                commas(entries.len() as u64),
                commas(u64::from(n_files))
            ));
            break;
        }
        let Some(rec) = bytes_at(file, size, at, 16) else {
            truncated = Some(format!("The listing stopped at a damaged part after {} entries: the file ends inside an entry.", commas(entries.len() as u64)));
            break;
        };
        let Some((raw, next)) = c_string(file, size, at + 16, limits.name_bytes) else {
            truncated = Some(format!(
                "The listing stopped at a damaged part after {} entries: a name does not end.",
                commas(entries.len() as u64)
            ));
            break;
        };
        at = next;
        let attribs = u16_at(&rec, 14);
        // Bit 7 marks a UTF-8 name; zip's flag for the same is bit 11.
        let decoded = zip::decode_name(&raw, if attribs & 0x80 != 0 { 0x800 } else { 0 });
        let Some(clean) = super::sanitise(&decoded, false).filter(|c| c.depth <= limits.depth)
        else {
            skipped += 1;
            continue;
        };
        let folder = u16_at(&rec, 8);
        let mut e = ArchiveEntry::bare(u32::from(i), clean.path.clone(), "file");
        e.raw_name = super::raw_name_of(&clean, &decoded);
        e.size = Some(u64::from(u32_at(&rec, 0)));
        e.mtime = zip::dos_text((u16_at(&rec, 12), u16_at(&rec, 10)));
        // As the page reads it, a method is one the app does not unpack: stored and MSZIP are left unsaid.
        e.method = folders
            .get(usize::from(folder))
            .map(|f| method_name(f.method))
            .filter(|m| !matches!(*m, "stored" | "MSZIP"))
            .map(Into::into);
        if listed + e.path.len() > limits.listed_bytes {
            truncated = Some(format!(
                "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                commas(entries.len() as u64)
            ));
            break;
        }
        listed += e.path.len();
        slots.push(Slot {
            index: e.index,
            path: e.path.clone(),
            folder,
            offset: u32_at(&rec, 4),
            size: u32_at(&rec, 0),
        });
        entries.push(e);
    }
    if entries.is_empty() && truncated.is_some() && n_files > 0 && skipped == 0 {
        return Err(damage("the first entry is damaged"));
    }
    let unread: Vec<&str> = folders
        .iter()
        .map(|f| method_name(f.method))
        .filter(|m| !matches!(*m, "stored" | "MSZIP"))
        .collect();
    let note = (!unread.is_empty()).then(|| {
        let mut kinds: Vec<&str> = unread.clone();
        kinds.dedup();
        format!(
            "Entries packed with {} are listed but not unpacked: the app has no decoder for it.",
            kinds.join(" or ")
        )
    });
    let listing = ArchiveListing {
        format: Format::Cab.name().into(),
        entries,
        comment: None,
        truncated,
        skipped,
        declared: Some(u64::from(n_files)),
        size,
        unpacked: None,
        directory: None,
        note,
    };
    Ok((
        listing,
        Cab {
            folders,
            slots,
            data_reserve,
        },
    ))
}

/// One MSZIP block: `CK`, then a deflate stream that may reach back into `history`. The history goes in front as a
/// stored deflate block, so the one deflate decoder unpacks it with no dictionary call of its own.
fn mszip(block: &[u8], history: &[u8], expect: usize) -> Option<Vec<u8>> {
    let data = block.strip_prefix(b"CK")?;
    let h = &history[history.len().saturating_sub(WINDOW)..];
    let mut stream = Vec::with_capacity(5 + h.len() + data.len());
    if !h.is_empty() {
        let n = h.len() as u16;
        stream.push(0);
        stream.extend(n.to_le_bytes());
        stream.extend((!n).to_le_bytes());
        stream.extend(h);
    }
    stream.extend(data);
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&stream[..])
        .take((h.len() + expect + 1) as u64)
        .read_to_end(&mut out)
        .ok()?;
    (out.len() == h.len() + expect).then(|| out.split_off(h.len()))
}

/// What a walk of one folder gives each range asked of it: the bytes, or the reason there are none.
type Got = Result<Vec<u8>, Fault>;

/// The bytes of each `(from, len)` range of `folder`'s unpacked stream, from one walk of its blocks that ends once the
/// last range is filled. The walk is charged every block's unpacked bytes against `Limits::stream`.
fn walk_folder(
    file: &File,
    size: u64,
    cab: &Cab,
    folder: &Folder,
    ranges: &[(u64, u64)],
    limits: &Limits,
    name: &str,
) -> Vec<Got> {
    let mut got: Vec<Vec<u8>> = ranges.iter().map(|_| Vec::new()).collect();
    let end = ranges.iter().map(|(f, l)| f + l).max().unwrap_or(0);
    let mut produced = 0u64;
    let mut history: Vec<u8> = Vec::new();
    let mut at = u64::from(folder.start);
    let fail = |f: Fault| ranges.iter().map(|_| Err(f.clone())).collect::<Vec<Got>>();
    for _ in 0..folder.blocks {
        if produced >= end {
            break;
        }
        if produced > limits.stream {
            return fail(Fault::Refused(format!(
                "{name} lies past the first 1 GB of its folder, further than the app unpacks."
            )));
        }
        let Some(head) = bytes_at(file, size, at, 8) else {
            return fail(damaged(name));
        };
        let (packed, unpacked) = (usize::from(u16_at(&head, 4)), usize::from(u16_at(&head, 6)));
        let Some(data) = bytes_at(file, size, at + 8 + cab.data_reserve, packed) else {
            return fail(damaged(name));
        };
        at += 8 + cab.data_reserve + packed as u64;
        let block = match folder.method & 0x0f {
            0 if packed == unpacked => data,
            1 => match mszip(&data, &history, unpacked) {
                Some(b) => b,
                None => return fail(damaged(name)),
            },
            _ => return fail(damaged(name)),
        };
        // Zero unpacked bytes ends a block that continues in the next cabinet.
        if block.is_empty() {
            return fail(Fault::Unsupported(format!(
                "{name} continues in another cabinet, which the app does not open."
            )));
        }
        let (lo, hi) = (produced, produced + block.len() as u64);
        for ((from, len), out) in ranges.iter().zip(got.iter_mut()) {
            let (s, e) = (lo.max(*from), hi.min(from + len));
            if s < e {
                out.extend(&block[(s - lo) as usize..(e - lo) as usize]);
            }
        }
        produced = hi;
        history.extend(&block);
        if history.len() > WINDOW {
            history.drain(..history.len() - WINDOW);
        }
    }
    ranges
        .iter()
        .zip(got)
        .map(|((_, len), out)| {
            if out.len() as u64 == *len {
                Ok(out)
            } else {
                Err(damaged(name))
            }
        })
        .collect()
}

fn slot_of<'a>(cab: &'a Cab, index: u32, name: &str) -> Result<&'a Slot, Fault> {
    cab.slots
        .binary_search_by_key(&index, |s| s.index)
        .ok()
        .map(|at| &cab.slots[at])
        .filter(|s| s.path == name)
        .ok_or_else(changed)
}

/// The folder an entry is unpacked from, or why it cannot be.
fn folder_of<'a>(cab: &'a Cab, slot: &Slot) -> Result<&'a Folder, Fault> {
    if slot.folder >= 0xfffd {
        return Err(Fault::Unsupported(format!(
            "{} continues in another cabinet, which the app does not open.",
            slot.path
        )));
    }
    let f = cab
        .folders
        .get(usize::from(slot.folder))
        .ok_or_else(|| damaged(&slot.path))?;
    match method_name(f.method) {
        "stored" | "MSZIP" => Ok(f),
        m => Err(Fault::Unsupported(format!(
            "{} is packed with {m}, which the app does not unpack.",
            slot.path
        ))),
    }
}

pub fn read(
    file: &File,
    size: u64,
    cab: &Cab,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let slot = slot_of(cab, index, name)?;
    let folder = folder_of(cab, slot)?;
    let len = u64::from(slot.size);
    if len > limits.entry {
        return Err(too_big_declared(name, len));
    }
    let got = walk_folder(
        file,
        size,
        cab,
        folder,
        &[(u64::from(slot.offset), len)],
        limits,
        name,
    );
    got.into_iter()
        .next()
        .unwrap_or_else(|| Err(too_big_actual(name, Some(len))))
}

type Range = (usize, u64, u64);

/// The heads of `wants`, each folder walked once for all of its wants.
pub fn heads(
    file: &File,
    size: u64,
    cab: &Cab,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, Fault> {
    let mut out: Vec<Option<Head>> = vec![None; wants.len()];
    // Each folder with the wants in it: the want's place, and the range of the folder it asks for.
    let mut by_folder: Vec<(u16, Vec<Range>)> = Vec::new();
    for (i, w) in wants.iter().enumerate() {
        let found = slot_of(cab, w.index, &w.name).and_then(|s| folder_of(cab, s).map(|_| s));
        match found {
            Err(f) => out[i] = Some(Head::of(w.index, Err(f))?),
            Ok(s) => {
                let range = (i, u64::from(s.offset), u64::from(s.size).min(max_each));
                match by_folder.iter_mut().find(|(f, _)| *f == s.folder) {
                    Some((_, list)) => list.push(range),
                    None => by_folder.push((s.folder, vec![range])),
                }
            }
        }
    }
    for (f, list) in by_folder {
        let folder = cab.folders[usize::from(f)];
        let ranges: Vec<(u64, u64)> = list.iter().map(|&(_, from, len)| (from, len)).collect();
        let name = &wants[list[0].0].name;
        let got = walk_folder(file, size, cab, &folder, &ranges, limits, name);
        for ((i, _, len), g) in list.into_iter().zip(got) {
            let w = &wants[i];
            let whole = cab
                .slots
                .iter()
                .find(|s| s.index == w.index)
                .is_some_and(|s| u64::from(s.size) == len);
            out[i] = Some(Head::of(w.index, g.map(|b| (b, whole)))?);
        }
    }
    Ok(out.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{heads as all_heads, list as list_any, read as read_any};
    use std::io::Write;

    /// A cabinet of one folder with `method` (0 stored, 1 MSZIP, 3 LZX) whose data blocks are `blocks`, each
    /// `(packed bytes, unpacked length)`, and `files`, each `(name, offset in the folder, size)`.
    pub fn cab(method: u16, blocks: &[(Vec<u8>, usize)], files: &[(&str, u32, u32)]) -> Vec<u8> {
        let files_at = 36 + 8;
        let mut file_recs = Vec::new();
        for (name, off, size) in files {
            file_recs.extend(size.to_le_bytes());
            file_recs.extend(off.to_le_bytes());
            file_recs.extend(0u16.to_le_bytes());
            // 2023-11-14, 22:13:20
            file_recs.extend((((2023 - 1980) << 9) | (11 << 5) | 14u16).to_le_bytes());
            file_recs.extend(((22 << 11) | (13 << 5) | 10u16).to_le_bytes());
            file_recs.extend(0x20u16.to_le_bytes());
            file_recs.extend(name.as_bytes());
            file_recs.push(0);
        }
        let data_at = files_at + file_recs.len();
        let mut out = Vec::new();
        out.extend(MAGIC);
        out.extend(0u32.to_le_bytes());
        out.extend(0u32.to_le_bytes()); // cabinet size, patched below
        out.extend(0u32.to_le_bytes());
        out.extend((files_at as u32).to_le_bytes());
        out.extend(0u32.to_le_bytes());
        out.extend([3, 1]);
        out.extend(1u16.to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out.extend((data_at as u32).to_le_bytes());
        out.extend((blocks.len() as u16).to_le_bytes());
        out.extend(method.to_le_bytes());
        out.extend(file_recs);
        for (packed, unpacked) in blocks {
            out.extend(0u32.to_le_bytes());
            out.extend((packed.len() as u16).to_le_bytes());
            out.extend((*unpacked as u16).to_le_bytes());
            out.extend(packed);
        }
        let n = out.len() as u32;
        out[8..12].copy_from_slice(&n.to_le_bytes());
        out
    }

    fn mszip_block(data: &[u8]) -> (Vec<u8>, usize) {
        let mut e =
            flate2::write::DeflateEncoder::new(b"CK".to_vec(), flate2::Compression::default());
        e.write_all(data).unwrap();
        (e.finish().unwrap(), data.len())
    }

    fn temp(name: &str, bytes: &[u8]) -> (std::path::PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-cab-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, File::open(&path).unwrap())
    }

    #[test]
    fn a_stored_cabinet_lists_and_reads_its_entries() {
        let body = b"first file.second file, a little longer.".to_vec();
        let bytes = cab(
            0,
            &[(body.clone(), body.len())],
            &[("docs\\first.txt", 0, 11), ("second.txt", 11, 29)],
        );
        let (dir, file) = temp("stored.cab", &bytes);
        let l = list_any(&file, "stored.cab", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "cab");
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| {
                (
                    e.path.as_str(),
                    e.size,
                    e.method.as_deref(),
                    e.mtime.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                (
                    "docs/first.txt",
                    Some(11),
                    None,
                    Some("2023-11-14T22:13:20")
                ),
                ("second.txt", Some(29), None, Some("2023-11-14T22:13:20"))
            ]
        );
        assert_eq!(
            read_any(&file, "stored.cab", 1, "second.txt", &Limits::DEFAULT, None).unwrap(),
            b"second file, a little longer."
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A fixed-Huffman deflate block that is one match of length 4, 5 bytes back, and the end of the block.
    fn back_reference() -> Vec<u8> {
        let mut bits: Vec<u8> = vec![1, 1, 0]; // BFINAL, then BTYPE 01 low bit first
        let code = |bits: &mut Vec<u8>, v: u32, n: u32| {
            (0..n).rev().for_each(|i| bits.push(((v >> i) & 1) as u8))
        };
        code(&mut bits, 2, 7); // symbol 258: length 4
        code(&mut bits, 4, 5); // distance code 4: 5 or 6, one extra bit
        bits.push(0); // extra bit 0: distance 5
        code(&mut bits, 0, 7); // symbol 256: end of block
        let mut out = b"CK".to_vec();
        for chunk in bits.chunks(8) {
            out.push(
                chunk
                    .iter()
                    .enumerate()
                    .fold(0u8, |b, (i, &bit)| b | (bit << i)),
            );
        }
        out
    }

    #[test]
    fn mszip_blocks_unpack_and_a_later_block_reaches_back_into_the_one_before() {
        let one = mszip_block(b"Hello");
        let bytes = cab(
            1,
            &[one, (back_reference(), 4)],
            &[("greeting.txt", 0, 9), ("tail.txt", 5, 4)],
        );
        let (dir, file) = temp("mszip.cab", &bytes);
        let l = list_any(&file, "mszip.cab", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(
            l.entries[0].method, None,
            "a method the app unpacks is left unsaid"
        );
        assert_eq!(
            read_any(
                &file,
                "mszip.cab",
                0,
                "greeting.txt",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"HelloHell"
        );
        assert_eq!(
            read_any(&file, "mszip.cab", 1, "tail.txt", &Limits::DEFAULT, None).unwrap(),
            b"Hell"
        );
        let wants = [
            Want {
                index: 1,
                name: "tail.txt".into(),
            },
            Want {
                index: 0,
                name: "greeting.txt".into(),
            },
        ];
        let got = all_heads(&file, "mszip.cab", &wants, 6, &Limits::DEFAULT, None).unwrap();
        assert_eq!(
            (got[0].index, got[0].bytes.as_slice(), got[0].whole),
            (1, &b"Hell"[..], true)
        );
        assert_eq!(
            (got[1].index, got[1].bytes.as_slice(), got[1].whole),
            (0, &b"HelloH"[..], false)
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_lzx_entry_is_listed_and_refused_with_a_sentence() {
        let bytes = cab(
            3 | (16 << 8),
            &[(vec![0u8; 16], 32)],
            &[("setup.inf", 0, 32)],
        );
        let (dir, file) = temp("lzx.cab", &bytes);
        let l = list_any(&file, "lzx.cab", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.entries[0].method.as_deref(), Some("LZX"));
        assert_eq!(l.note.as_deref(), Some("Entries packed with LZX are listed but not unpacked: the app has no decoder for it."));
        assert!(
            matches!(read_any(&file, "lzx.cab", 0, "setup.inf", &Limits::DEFAULT, None), Err(Fault::Unsupported(m)) if m == "setup.inf is packed with LZX, which the app does not unpack.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_huge_declared_count_or_a_cut_file_stops_without_reading_past_the_end() {
        let body = b"0123456789".to_vec();
        let mut bytes = cab(0, &[(body.clone(), 10)], &[("a.txt", 0, 10)]);
        bytes[28..30].copy_from_slice(&u16::MAX.to_le_bytes());
        let (dir, file) = temp("many.cab", &bytes);
        let started = std::time::Instant::now();
        let l = list_any(&file, "many.cab", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert!(l.entries.len() < 10, "{}", l.entries.len());
        assert!(l.truncated.is_some());
        assert!(started.elapsed().as_secs() < 5);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let whole = cab(1, &[mszip_block(&[7u8; 5000])], &[("seven.bin", 0, 5000)]);
        for cut in [36, 44, 50, 70, whole.len() - 10] {
            let (dir, file) = temp(&format!("cut{cut}.cab"), &whole[..cut]);
            if let Ok(Some(l)) = list_any(&file, "cut.cab", &Limits::DEFAULT, None) {
                for e in &l.entries {
                    let _ = read_any(&file, "cut.cab", e.index, &e.path, &Limits::DEFAULT, None);
                }
            }
            drop(file);
            let _ = std::fs::remove_dir_all(dir);
        }
        // An entry that claims more of its folder than the blocks hold is damaged, not read past.
        let bytes = cab(0, &[(body.clone(), 10)], &[("short.txt", 4, 100)]);
        let (dir, file) = temp("short.cab", &bytes);
        assert!(matches!(
            read_any(&file, "short.cab", 0, "short.txt", &Limits::DEFAULT, None),
            Err(Fault::Invalid(_))
        ));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
