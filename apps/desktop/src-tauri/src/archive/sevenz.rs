//! A 7z read through `sevenz-rust2`. Its header, the list of entries (often LZMA-packed itself), is parsed whole before
//! anything is listed, so `sevenz_header` first holds what it declares to `MAX_DECLARED` and its size to 16 MB; the
//! listing then stops at the same caps as a zip's. An entry's
//! bytes come from decoding its block from the block's first byte: a solid block packs many entries into one stream, so
//! reaching one means unpacking every entry before it, and each call counts what it unpacks against `Limits::stream`.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};

use sevenz_rust2::{Archive, Block, BlockDecoder, EncoderMethod, Error, Password};

use super::sevenz_header::{
    self, damaged_list, encrypted_list, header_too_big, lzma2_dictionary, lzma_dictionary,
    method_of, method_words, HEADER_BYTES,
};
use super::{
    changed, commas, damaged, folder, head_of, iso_from_unix, raw_name_of, sanitise, size_words,
    too_big_actual, too_big_declared, ArchiveEntry, ArchiveListing, Directory, Fault, Head, Limits,
    Want, XZ_MEM_KB,
};

/// The most a header may unpack to, in KiB, and the most its own decoder may ask for.
const HEADER_KB: usize = (HEADER_BYTES / 1024) as usize;

/// The most a block's dictionaries may ask for in all, in bytes.
const BLOCK_DICTIONARIES: u64 = XZ_MEM_KB as u64 * 1024;

const ATTR_DIRECTORY: u32 = 0x10;
const ATTR_REPARSE_POINT: u32 = 0x400;
/// p7zip and 7-Zip keep a Unix mode in the high 16 bits of the attributes when this bit is set.
const ATTR_UNIX_EXTENSION: u32 = 0x8000;

/// Seconds from 1601-01-01 (an NT time's epoch) to 1970-01-01.
const NT_TO_UNIX: i64 = 11_644_473_600;

fn encrypted_entry() -> Fault {
    Fault::Refused("This entry is encrypted. The app does not ask for archive passwords.".into())
}

fn lies_past(name: &str) -> Fault {
    Fault::Refused(format!(
        "{name} lies past the first 1 GB unpacked from its block, further than the app unpacks."
    ))
}

/// What a block's coders allow: read, encrypted (AES), or packed with a method the app does not read.
enum Coders {
    Read,
    Encrypted,
    Unread(String),
}

fn coders_of(block: &Block) -> Coders {
    let mut unread = None;
    for coder in &block.coders {
        let id = coder.encoder_method_id();
        if id == EncoderMethod::ID_AES256_SHA256 {
            return Coders::Encrypted;
        }
        let read = [
            EncoderMethod::ID_COPY,
            EncoderMethod::ID_LZMA,
            EncoderMethod::ID_LZMA2,
            EncoderMethod::ID_DELTA,
            EncoderMethod::ID_BCJ_X86,
            EncoderMethod::ID_BCJ2,
            EncoderMethod::ID_BCJ_PPC,
            EncoderMethod::ID_BCJ_IA64,
            EncoderMethod::ID_BCJ_ARM,
            EncoderMethod::ID_BCJ_ARM64,
            EncoderMethod::ID_BCJ_ARM_THUMB,
            EncoderMethod::ID_BCJ_SPARC,
            EncoderMethod::ID_BCJ_RISCV,
        ]
        .contains(&id);
        if !read && unread.is_none() {
            unread = Some(method_of(id));
        }
    }
    unread.map_or(Coders::Read, Coders::Unread)
}

/// What a block's LZMA and LZMA2 coders ask for between them: a BCJ2 block has three, each with a dictionary.
fn dictionaries(block: &Block) -> u64 {
    block
        .coders
        .iter()
        .map(|c| {
            let (id, props) = (c.encoder_method_id(), c.properties());
            if id == EncoderMethod::ID_LZMA {
                lzma_dictionary(props).unwrap_or(0)
            } else if id == EncoderMethod::ID_LZMA2 {
                lzma2_dictionary(props).unwrap_or(0)
            } else {
                0
            }
        })
        .fold(0u64, u64::saturating_add)
}

fn needs_memory(name: &str, bytes: u64) -> Fault {
    Fault::Refused(format!(
        "{name} needs {} of memory to unpack, over the 256 MB the app gives one block.",
        size_words(bytes)
    ))
}

/// The Unix mode the attributes carry, if they carry one.
fn unix_mode(e: &sevenz_rust2::ArchiveEntry) -> Option<u32> {
    (e.has_windows_attributes && e.windows_attributes & ATTR_UNIX_EXTENSION != 0)
        .then_some(e.windows_attributes >> 16)
        .filter(|&m| m != 0)
}

fn kind_of(e: &sevenz_rust2::ArchiveEntry) -> &'static str {
    let mode = unix_mode(e).map(|m| m & 0o170_000);
    let attrs = if e.has_windows_attributes {
        e.windows_attributes
    } else {
        0
    };
    if e.is_directory || attrs & ATTR_DIRECTORY != 0 || mode == Some(0o040_000) {
        return "dir";
    }
    if e.is_anti_item {
        // A deletion marker from an update: it names a file but holds none.
        return "other";
    }
    match mode {
        Some(0o120_000) => "link",
        Some(0o020_000 | 0o060_000 | 0o010_000 | 0o140_000) => "other",
        // 7-Zip's -snl keeps a Windows link as its reparse data, flagged by this attribute.
        _ if attrs & ATTR_REPARSE_POINT != 0 => "link",
        _ => "file",
    }
}

fn mtime_of(e: &sevenz_rust2::ArchiveEntry) -> Option<String> {
    if !e.has_last_modified_date {
        return None;
    }
    let ticks: u64 = e.last_modified_date.into();
    let secs = i64::try_from(ticks / 10_000_000).ok()? - NT_TO_UNIX;
    iso_from_unix(secs, true)
}

/// How many entries with data each block holds: an entry alone in its block owns the block's packed size.
fn streams_per_block(archive: &Archive) -> Vec<u32> {
    let mut counts = vec![0u32; archive.blocks.len()];
    for (i, f) in archive.files.iter().enumerate() {
        if let Some(Some(b)) = archive.stream_map.file_block_index.get(i) {
            if f.has_stream {
                if let Some(c) = counts.get_mut(*b) {
                    *c += 1;
                }
            }
        }
    }
    counts
}

fn block_of(archive: &Archive, index: usize) -> Option<usize> {
    archive
        .stream_map
        .file_block_index
        .get(index)
        .copied()
        .flatten()
        .filter(|&b| b < archive.blocks.len())
}

/// The entry as listed, or `None` when it is left out (name too long, too deep, or nothing left after sanitising).
fn describe(
    archive: &Archive,
    index: usize,
    counts: &[u32],
    limits: &Limits,
) -> Option<ArchiveEntry> {
    let e = archive.files.get(index)?;
    if e.name.len() > limits.name_bytes {
        return None;
    }
    let kind = kind_of(e);
    let clean = sanitise(&e.name, kind == "dir")?;
    if clean.depth > limits.depth {
        return None;
    }
    let block = block_of(archive, index).filter(|_| e.has_stream);
    let (encrypted, method) = match block.map(|b| coders_of(&archive.blocks[b])) {
        Some(Coders::Encrypted) => (true, None),
        Some(Coders::Unread(m)) => (false, Some(m)),
        Some(Coders::Read) | None => (false, None),
    };
    let alone = block.is_some_and(|b| counts.get(b) == Some(&1));
    Some(ArchiveEntry {
        index: u32::try_from(index).ok()?,
        raw_name: raw_name_of(&clean, &e.name),
        path: clean.path,
        kind: kind.into(),
        size: Some(e.size),
        packed: alone.then_some(e.compressed_size),
        mtime: mtime_of(e),
        encrypted,
        method,
        link: None,
        offset: None,
        crc: e.has_crc.then_some(e.crc as u32),
        host: None,
        mode: unix_mode(e),
        flags: None,
        comment: None,
    })
}

/// Where the header lies, from the signature header's first 32 bytes; `None` when it does not fit in the file.
fn directory(file: &File, size: u64) -> Option<Directory> {
    let mut start = [0u8; 32];
    let mut f = file;
    f.seek(SeekFrom::Start(0)).ok()?;
    f.read_exact(&mut start).ok()?;
    let off = u64::from_le_bytes(start[12..20].try_into().ok()?);
    let len = u64::from_le_bytes(start[20..28].try_into().ok()?);
    let at = off.checked_add(32)?;
    (len > 0 && at.checked_add(len)? <= size).then_some(Directory { at, size: len })
}

fn header_fault(e: Error) -> Fault {
    match e {
        Error::UnsupportedVersion { major, minor } => Fault::Unsupported(format!(
            "This 7z archive is written in format version {major}.{minor}, which the app does not read."
        )),
        Error::PasswordRequired | Error::MaybeBadPassword(_) => encrypted_list(),
        Error::UnsupportedCompressionMethod(m) if m == EncoderMethod::AES256_SHA256.name() => {
            encrypted_list()
        }
        Error::UnsupportedCompressionMethod(m) => Fault::Unsupported(format!(
            "This 7z archive's list of entries is compressed with {}, which the app does not read.",
            method_words(&m)
        )),
        Error::MaxMemLimited { .. } => header_too_big(),
        Error::ExternalUnsupported | Error::Unsupported(_) => Fault::Unsupported(
            "This 7z archive uses a part of the format the app does not read.".into(),
        ),
        _ => damaged_list(),
    }
}

/// The archive's header, parsed whole.
pub fn open(file: &File) -> Result<Archive, Fault> {
    sevenz_header::check(file, file.metadata()?.len())?;
    let mut f = file;
    Archive::read_with_memory_limit(&mut f, &Password::empty(), HEADER_KB).map_err(header_fault)
}

/// The listing, and the parsed header a later read decodes from.
pub fn list(file: &File, size: u64, limits: &Limits) -> Result<(ArchiveListing, Archive), Fault> {
    let archive = open(file)?;
    let counts = streams_per_block(&archive);
    let declared = archive.files.len() as u64;
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut skipped = 0u32;
    let mut listed = 0usize;
    let mut truncated = None;
    for index in 0..archive.files.len() {
        if index >= limits.entries {
            truncated = Some(format!(
                "Listed the first {} entries; the archive declares {}.",
                commas(entries.len() as u64),
                commas(declared)
            ));
            break;
        }
        match describe(&archive, index, &counts, limits) {
            None => skipped += 1,
            Some(entry) => {
                let weight = entry.path.len() + entry.raw_name.as_ref().map_or(0, String::len);
                if listed + weight > limits.listed_bytes {
                    truncated = Some(format!(
                        "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                        commas(entries.len() as u64)
                    ));
                    break;
                }
                listed += weight;
                entries.push(entry);
            }
        }
    }
    let listing = ArchiveListing {
        format: "7z".into(),
        entries,
        comment: None,
        truncated,
        skipped,
        declared: Some(declared),
        size,
        unpacked: None,
        directory: directory(file, size),
        note: None,
    };
    Ok((listing, archive))
}

/// Entry `index` checked against the `name` listed there: the block to decode it from, or `None` for an entry with no
/// data (an empty file).
fn check(
    archive: &Archive,
    counts: &[u32],
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Option<usize>, Fault> {
    let i = index as usize;
    let entry = describe(archive, i, counts, limits)
        .filter(|e| e.path == name)
        .ok_or_else(changed)?;
    match entry.kind.as_str() {
        "dir" => return Err(folder()),
        "link" => {
            return Err(Fault::Invalid(format!(
                "{name} is a link: links are not followed."
            )))
        }
        "other" => return Err(Fault::Invalid(format!("{name} is not a file."))),
        _ => {}
    }
    if entry.encrypted {
        return Err(encrypted_entry());
    }
    if let Some(m) = entry.method {
        return Err(Fault::Unsupported(format!(
            "{name} is compressed with {m}, which the app does not read."
        )));
    }
    if !archive.files[i].has_stream {
        return Ok(None);
    }
    let block = block_of(archive, i).ok_or_else(|| damaged(name))?;
    let asked = dictionaries(&archive.blocks[block]);
    if asked > BLOCK_DICTIONARIES {
        return Err(needs_memory(name, asked));
    }
    Ok(Some(block))
}

/// Why a block's decoding stopped, as the sentence for `name`.
fn block_fault(e: &Error, name: &str) -> Fault {
    match e {
        Error::MaxMemLimited { actaul_kb, .. } => {
            needs_memory(name, (*actaul_kb as u64).saturating_mul(1024))
        }
        Error::UnsupportedCompressionMethod(m) => Fault::Unsupported(format!(
            "{name} is compressed with {}, which the app does not read.",
            method_words(m)
        )),
        Error::PasswordRequired | Error::MaybeBadPassword(_) => encrypted_entry(),
        Error::ExternalUnsupported | Error::Unsupported(_) => {
            Fault::Unsupported(format!("{name} is packed in a way the app does not read."))
        }
        _ => damaged(name),
    }
}

/// Unpacked bytes counted across one call's passes; a read that takes the count past `budget` fails.
struct Spent {
    count: Cell<u64>,
    budget: u64,
    tripped: Cell<bool>,
}

struct Counted<'a, R> {
    inner: R,
    spent: &'a Spent,
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        let total = self.spent.count.get() + n as u64;
        self.spent.count.set(total);
        if total > self.spent.budget {
            self.spent.tripped.set(true);
            return Err(io::Error::other("the unpacked block passed its limit"));
        }
        Ok(n)
    }
}

#[cfg(test)]
thread_local! {
    /// Blocks decoded on this thread: what proves the heads of a solid block take one pass.
    pub static PASSES: Cell<u32> = const { Cell::new(0) };
}

/// One entry a pass is to stop at.
struct Wanted<'n> {
    index: usize,
    name: &'n str,
}

type Got = Result<(Vec<u8>, bool), Fault>;

/// The entries with data in each of `blocks`, in block order.
fn streamed_in(
    archive: &Archive,
    blocks: impl IntoIterator<Item = usize>,
) -> BTreeMap<usize, Vec<usize>> {
    let mut out: BTreeMap<usize, Vec<usize>> =
        blocks.into_iter().map(|b| (b, Vec::new())).collect();
    for (i, f) in archive.files.iter().enumerate() {
        if !f.has_stream {
            continue;
        }
        if let Some(list) = block_of(archive, i).and_then(|b| out.get_mut(&b)) {
            list.push(i);
        }
    }
    out
}

/// One pass over `block` from its first byte: at most `cap` bytes of each wanted entry (ascending indexes, all in that
/// block) and whether it ended inside them, in the order of `wanted`. `streamed` is the block's entries with data. The
/// pass stops after the last wanted entry. One that ended is checked against its declared size and its CRC-32.
fn pass(
    file: &File,
    archive: &Archive,
    block: usize,
    streamed: &[usize],
    wanted: &[Wanted],
    cap: u64,
    spent: &Spent,
) -> Vec<Got> {
    let mut got: Vec<Option<Got>> = wanted.iter().map(|_| None).collect();
    // An entry further into the block than the budget reaches is refused without unpacking toward it.
    let mut ahead = spent.count.get();
    let mut reachable = 0;
    for &i in streamed {
        if reachable < wanted.len() && wanted[reachable].index == i {
            if ahead >= spent.budget {
                break;
            }
            reachable += 1;
        }
        ahead = ahead.saturating_add(archive.files[i].size);
    }
    for (slot, w) in got.iter_mut().zip(wanted).skip(reachable) {
        *slot = Some(Err(lies_past(w.name)));
    }
    let wanted = &wanted[..reachable];
    let Some(last) = wanted.last().map(|w| w.index) else {
        return got
            .into_iter()
            .map(|g| g.unwrap_or_else(|| Err(changed())))
            .collect();
    };
    #[cfg(test)]
    PASSES.with(|p| p.set(p.get() + 1));
    let password = Password::empty();
    let mut f = file;
    let decoder = BlockDecoder::new_with_memory_limit(
        1,
        XZ_MEM_KB as usize,
        block,
        archive,
        &password,
        &mut f,
    );
    let mut at = 0usize;
    let outcome = decoder.for_each_entries(&mut |entry, reader| {
        // Folders and empty files between a solid block's entries are called back too, with nothing to read.
        if !entry.has_stream {
            return Ok(true);
        }
        let Some(&index) = streamed.get(at) else {
            return Err(Error::Other(
                "the block holds more entries than its header says".into(),
            ));
        };
        at += 1;
        if !std::ptr::eq(entry, &archive.files[index]) {
            return Err(Error::Other("the block's entries are out of order".into()));
        }
        let mut counted = Counted {
            inner: reader,
            spent,
        };
        if let Ok(k) = wanted.binary_search_by_key(&index, |w| w.index) {
            let name = wanted[k].name;
            let head = head_of(&mut counted, cap);
            let failed = head.is_err();
            got[k] = Some(match head {
                Ok((out, whole)) => checked(out, whole, &archive.files[index], name),
                Err(_) if spent.tripped.get() => Err(lies_past(name)),
                Err(e) if is_crc(&e) => Err(crc_mismatch(name)),
                Err(_) => Err(damaged(name)),
            });
            if failed {
                return Err(Error::Other("stopped".into()));
            }
            if index == last {
                return Ok(false);
            }
        }
        // Read to the entry's end here, through the count, rather than leave the crate to drain it uncounted.
        io::copy(&mut counted, &mut io::sink())?;
        Ok(true)
    });
    let stopped = outcome.err();
    wanted.iter().zip(got.iter_mut()).for_each(|(w, slot)| {
        if slot.is_none() {
            *slot = Some(Err(if spent.tripped.get() {
                lies_past(w.name)
            } else {
                stopped
                    .as_ref()
                    .map_or_else(|| damaged(w.name), |e| block_fault(e, w.name))
            }));
        }
    });
    got.into_iter()
        .map(|g| g.unwrap_or_else(|| Err(changed())))
        .collect()
}

fn crc_mismatch(name: &str) -> Fault {
    Fault::Invalid(format!(
        "{name} does not match its check (CRC-32): the archive is damaged."
    ))
}

/// The crate's verifying reader fails the read that ends an entry whose CRC-32 does not match.
fn is_crc(e: &io::Error) -> bool {
    e.get_ref()
        .and_then(|inner| inner.downcast_ref::<Error>())
        .is_some_and(|inner| matches!(inner, Error::ChecksumVerificationFailed))
}

/// An entry that ended inside its bytes must be the size it declares and match its CRC-32.
fn checked(out: Vec<u8>, whole: bool, e: &sevenz_rust2::ArchiveEntry, name: &str) -> Got {
    if whole {
        if out.len() as u64 != e.size {
            return Err(Fault::Invalid(format!(
                "{name} unpacks to {} bytes, not the {} it declares: the archive is damaged.",
                commas(out.len() as u64),
                commas(e.size)
            )));
        }
        if e.has_crc && crc32fast::hash(&out) != e.crc as u32 {
            return Err(crc_mismatch(name));
        }
    }
    Ok((out, whole))
}

fn spent(limits: &Limits) -> Spent {
    Spent {
        count: Cell::new(0),
        budget: limits.stream,
        tripped: Cell::new(false),
    }
}

/// Entry `index`, which must be the `name` listed there.
pub fn read(
    file: &File,
    archive: &Archive,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let Some(block) = check(archive, &streams_per_block(archive), index, name, limits)? else {
        return Ok(Vec::new());
    };
    let declared = archive.files[index as usize].size;
    if declared > limits.entry {
        return Err(too_big_declared(name, declared));
    }
    let want = [Wanted {
        index: index as usize,
        name,
    }];
    let streamed = streamed_in(archive, [block])
        .remove(&block)
        .unwrap_or_default();
    let (out, whole) = pass(
        file,
        archive,
        block,
        &streamed,
        &want,
        limits.entry,
        &spent(limits),
    )
    .pop()
    .unwrap_or_else(|| Err(damaged(name)))?;
    if !whole {
        return Err(too_big_actual(name, Some(declared)));
    }
    Ok(out)
}

/// The beginning of each want, at most `max_each` bytes; the budget was applied by the caller. The wants in one block
/// come from one pass over it, and all the passes of a call share `Limits::stream`.
pub fn heads(
    file: &File,
    archive: &Archive,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, Fault> {
    let mut got: Vec<Option<Got>> = wants.iter().map(|_| None).collect();
    let mut by_block: BTreeMap<usize, BTreeMap<usize, Vec<usize>>> = BTreeMap::new();
    let counts = streams_per_block(archive);
    for (k, w) in wants.iter().enumerate() {
        match check(archive, &counts, w.index, &w.name, limits) {
            Err(f) => got[k] = Some(Err(f)),
            Ok(None) => got[k] = Some(Ok((Vec::new(), true))),
            Ok(Some(block)) => by_block
                .entry(block)
                .or_default()
                .entry(w.index as usize)
                .or_default()
                .push(k),
        }
    }
    let spent = spent(limits);
    let streamed = streamed_in(archive, by_block.keys().copied());
    for (block, entries) in &by_block {
        let wanted: Vec<Wanted> = entries
            .iter()
            .map(|(&index, ks)| Wanted {
                index,
                name: &wants[ks[0]].name,
            })
            .collect();
        let results = pass(
            file,
            archive,
            *block,
            streamed.get(block).map_or(&[][..], Vec::as_slice),
            &wanted,
            max_each,
            &spent,
        );
        for (ks, result) in entries.values().zip(results) {
            for &k in ks {
                got[k] = Some(result.clone());
            }
        }
    }
    wants
        .iter()
        .zip(got)
        .map(|(w, g)| Head::of(w.index, g.unwrap_or_else(|| Err(damaged(&w.name)))))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{self as arch, Fault};
    use sevenz_rust2::{ArchiveWriter, EncoderConfiguration, NtTime, SourceReader};
    use std::io::Cursor;
    use std::path::PathBuf;

    /// 2023-11-14T22:13:20Z as an NT time.
    const MTIME: u64 = (1_700_000_000 + NT_TO_UNIX as u64) * 10_000_000;

    fn temp(name: &str, bytes: &[u8]) -> (PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-7z-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        let file = File::open(&path).unwrap();
        (dir, file)
    }

    fn done(dir: PathBuf, file: File) {
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn entry(name: &str) -> sevenz_rust2::ArchiveEntry {
        let mut e = sevenz_rust2::ArchiveEntry::new_file(name);
        e.has_last_modified_date = true;
        e.last_modified_date = NtTime::new(MTIME);
        e
    }

    fn writer(method: EncoderMethod) -> ArchiveWriter<Cursor<Vec<u8>>> {
        let mut w = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
        w.set_content_methods(vec![EncoderConfiguration::new(method)]);
        w
    }

    /// `docs/`, `docs/a.md`, `b.txt` and an empty `empty.txt`, one block per entry with data.
    fn sample(method: EncoderMethod) -> Vec<u8> {
        let mut w = writer(method);
        w.push_archive_entry(
            sevenz_rust2::ArchiveEntry::new_directory("docs"),
            None::<&[u8]>,
        )
        .unwrap();
        w.push_archive_entry(entry("docs/a.md"), Some(&b"# A\n"[..]))
            .unwrap();
        w.push_archive_entry(entry("b.txt"), Some(&b"bee\n".repeat(50)[..]))
            .unwrap();
        w.push_archive_entry(entry("empty.txt"), None::<&[u8]>)
            .unwrap();
        w.finish().unwrap().into_inner()
    }

    fn body(i: usize) -> Vec<u8> {
        format!("file {i}\n").repeat(i * 40 + 1).into_bytes()
    }

    /// Six files packed into one solid block.
    fn solid(method: EncoderMethod) -> Vec<u8> {
        let mut w = writer(method);
        let entries = (0..6).map(|i| entry(&format!("src/f{i}.txt"))).collect();
        let readers = (0..6)
            .map(|i| SourceReader::new(Cursor::new(body(i))))
            .collect();
        w.push_archive_entries(entries, readers).unwrap();
        w.finish().unwrap().into_inner()
    }

    fn listed(file: &File, limits: &Limits) -> ArchiveListing {
        arch::list(file, "a.7z", limits, None).unwrap().unwrap()
    }

    fn read(file: &File, index: u32, name: &str, limits: &Limits) -> Result<Vec<u8>, Fault> {
        arch::read(file, "a.7z", index, name, limits, None)
    }

    fn want(index: u32, name: &str) -> Want {
        Want {
            index,
            name: name.into(),
        }
    }

    #[test]
    fn stored_lzma_and_lzma2_entries_list_and_read() {
        for method in [
            EncoderMethod::COPY,
            EncoderMethod::LZMA,
            EncoderMethod::LZMA2,
        ] {
            let (dir, file) = temp(&format!("sample-{}.7z", method.name()), &sample(method));
            let l = listed(&file, &Limits::DEFAULT);
            assert_eq!(l.format, "7z");
            let rows: Vec<_> = l
                .entries
                .iter()
                .map(|e| (e.index, e.path.as_str(), e.kind.as_str(), e.size))
                .collect();
            assert_eq!(
                rows,
                [
                    (0, "docs/", "dir", Some(0)),
                    (1, "docs/a.md", "file", Some(4)),
                    (2, "b.txt", "file", Some(200)),
                    (3, "empty.txt", "file", Some(0)),
                ],
                "{}",
                method.name()
            );
            let a = &l.entries[1];
            assert_eq!(a.mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
            assert_eq!(a.crc, Some(crc32fast::hash(b"# A\n")));
            assert!(!a.encrypted && a.method.is_none());
            assert!(
                a.packed.is_some(),
                "an entry alone in its block owns its packed size"
            );
            assert_eq!(
                (l.declared, l.truncated.as_deref(), l.skipped),
                (Some(4), None, 0)
            );
            let d = l.directory.unwrap();
            assert_eq!(d.at + d.size, l.size, "the header ends the file");

            assert_eq!(
                read(&file, 1, "docs/a.md", &Limits::DEFAULT).unwrap(),
                b"# A\n"
            );
            assert_eq!(
                read(&file, 2, "b.txt", &Limits::DEFAULT).unwrap(),
                b"bee\n".repeat(50)
            );
            assert_eq!(read(&file, 3, "empty.txt", &Limits::DEFAULT).unwrap(), b"");
            assert!(
                matches!(read(&file, 0, "docs/", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "A folder has nothing to open.")
            );
            assert!(
                matches!(read(&file, 2, "c.txt", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "The archive changed since it was listed.")
            );
            assert!(
                matches!(read(&file, 9, "b.txt", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "The archive changed since it was listed.")
            );
            done(dir, file);
        }
    }

    #[test]
    fn any_entry_of_a_solid_block_reads_and_its_heads_take_one_pass() {
        for method in [EncoderMethod::LZMA, EncoderMethod::LZMA2] {
            let (dir, file) = temp(&format!("solid-{}.7z", method.name()), &solid(method));
            let l = listed(&file, &Limits::DEFAULT);
            assert_eq!(l.entries.len(), 6);
            assert!(
                l.entries.iter().all(|e| e.packed.is_none()),
                "a solid block's packed size is no one entry's"
            );
            for i in [5u32, 0, 3] {
                let name = format!("src/f{i}.txt");
                assert_eq!(
                    read(&file, i, &name, &Limits::DEFAULT).unwrap(),
                    body(i as usize)
                );
            }
            let wants: Vec<Want> = [4u32, 1, 4, 2]
                .iter()
                .map(|&i| want(i, &format!("src/f{i}.txt")))
                .collect();
            let before = PASSES.with(Cell::get);
            let got = arch::heads(&file, "a.7z", &wants, 16, &Limits::DEFAULT, None).unwrap();
            assert_eq!(PASSES.with(Cell::get) - before, 1, "one pass for the block");
            let order: Vec<u32> = got.iter().map(|h| h.index).collect();
            assert_eq!(order, [4, 1, 4, 2], "in the order asked");
            for h in &got {
                assert_eq!(h.bytes, body(h.index as usize)[..16]);
                assert!(!h.whole && h.refused.is_none());
            }
            let got = arch::heads(
                &file,
                "a.7z",
                &[want(0, "src/f0.txt")],
                64,
                &Limits::DEFAULT,
                None,
            )
            .unwrap();
            assert_eq!(
                (got[0].bytes.as_slice(), got[0].whole),
                (&b"file 0\n"[..], true)
            );
            done(dir, file);
        }
    }

    #[test]
    fn the_listing_stops_at_its_caps_and_counts_what_it_leaves_out() {
        let deep = format!("{}x.txt", "d/".repeat(64));
        let long = "n".repeat(1_100);
        let mut w = writer(EncoderMethod::COPY);
        for name in [
            "a.txt",
            deep.as_str(),
            long.as_str(),
            "../../evil.txt",
            "b.txt",
            "c.txt",
        ] {
            w.push_archive_entry(entry(name), Some(&b"x"[..])).unwrap();
        }
        let (dir, file) = temp("caps.7z", &w.finish().unwrap().into_inner());
        let l = listed(&file, &Limits::DEFAULT);
        let paths: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.index, e.path.as_str()))
            .collect();
        assert_eq!(
            paths,
            [(0, "a.txt"), (3, "evil.txt"), (4, "b.txt"), (5, "c.txt")]
        );
        assert_eq!(l.entries[1].raw_name.as_deref(), Some("../../evil.txt"));
        assert_eq!(l.skipped, 2, "too deep and too long");
        let tight = Limits {
            entries: 4,
            ..Limits::DEFAULT
        };
        let l = listed(&file, &tight);
        assert_eq!(l.entries.len(), 2);
        assert_eq!(
            l.truncated.as_deref(),
            Some("Listed the first 2 entries; the archive declares 6.")
        );
        let tight = Limits {
            listed_bytes: 10,
            ..Limits::DEFAULT
        };
        assert_eq!(
            listed(&file, &tight).truncated.as_deref(),
            Some("Listed the first 1 entries: their names reach the 16 MB a listing may hold.")
        );
        done(dir, file);
    }

    #[test]
    fn an_entry_past_its_caps_is_refused() {
        let (dir, file) = temp("cap-solid.7z", &solid(EncoderMethod::LZMA2));
        let tight = Limits {
            entry: 10,
            ..Limits::DEFAULT
        };
        assert!(
            matches!(read(&file, 1, "src/f1.txt", &tight), Err(Fault::Refused(m)) if m == "src/f1.txt is 287 bytes unpacked, over the 16 MB an entry may open with.")
        );
        // Entries 0 to 2 unpack to 7, 287 and 567 bytes: entry 1 ends inside 300 bytes, entry 3 starts past them.
        let tight = Limits {
            stream: 300,
            ..Limits::DEFAULT
        };
        assert_eq!(read(&file, 1, "src/f1.txt", &tight).unwrap(), body(1));
        let past = "src/f3.txt lies past the first 1 GB unpacked from its block, further than the app unpacks.";
        assert!(
            matches!(read(&file, 3, "src/f3.txt", &tight), Err(Fault::Refused(m)) if m == past)
        );
        let before = PASSES.with(Cell::get);
        assert!(read(&file, 5, "src/f5.txt", &tight).is_err());
        assert_eq!(
            PASSES.with(Cell::get),
            before,
            "refused without unpacking toward it"
        );
        let got = arch::heads(
            &file,
            "a.7z",
            &[
                want(2, "src/f2.txt"),
                want(3, "src/f3.txt"),
                want(0, "src/f0.txt"),
            ],
            1_000,
            &tight,
            None,
        )
        .unwrap();
        assert_eq!(got[2].bytes, body(0));
        let f2 = "src/f2.txt lies past the first 1 GB unpacked from its block, further than the app unpacks.";
        assert_eq!(
            got[0].refused.as_deref(),
            Some(f2),
            "its own bytes take the count past the cap"
        );
        assert_eq!(got[1].refused.as_deref(), Some(past));
        done(dir, file);
    }

    #[test]
    fn a_damaged_block_or_header_says_so() {
        let bytes = sample(EncoderMethod::COPY);
        let at = bytes.windows(4).position(|w| w == b"# A\n").unwrap();
        let mut bad = bytes.clone();
        bad[at] = b'!';
        let (dir, file) = temp("bad-data.7z", &bad);
        let e = read(&file, 1, "docs/a.md", &Limits::DEFAULT).unwrap_err();
        assert!(
            matches!(&e, Fault::Invalid(m) if m == "docs/a.md does not match its check (CRC-32): the archive is damaged."),
            "{e:?}"
        );
        done(dir, file);
        let (dir, file) = temp("cut.7z", &bytes[..bytes.len() - 10]);
        assert!(
            matches!(arch::list(&file, "a.7z", &Limits::DEFAULT, None), Err(Fault::Invalid(m)) if m == "The listing could not be read: the archive is damaged.")
        );
        done(dir, file);
        let mut junk = b"7z\xbc\xaf\x27\x1c\x00\x04".to_vec();
        junk.extend((0..4096u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8));
        let (dir, file) = temp("junk.7z", &junk);
        assert!(matches!(
            arch::list(&file, "a.7z", &Limits::DEFAULT, None),
            Err(Fault::Invalid(_))
        ));
        done(dir, file);
    }

    // ---- archives written by hand: coders and attributes the crate's writer does not make ----------------------------

    /// A 7z NUMBER: the leading one bits of the first byte say how many bytes follow.
    fn number(out: &mut Vec<u8>, v: u64) {
        for extra in 0..8u32 {
            if v < 1u64 << (7 * (extra + 1)) {
                let mask = (0xFF00u16 >> extra) as u8;
                out.push(mask | (v >> (8 * extra)) as u8);
                out.extend(&v.to_le_bytes()[..extra as usize]);
                return;
            }
        }
        out.push(0xFF);
        out.extend(v.to_le_bytes());
    }

    struct Raw<'a> {
        name: &'a str,
        /// None for a folder.
        data: Option<&'a [u8]>,
        attrs: u32,
    }

    fn bits(flags: impl Iterator<Item = bool>) -> Vec<u8> {
        let flags: Vec<bool> = flags.collect();
        let mut out = vec![0u8; flags.len().div_ceil(8)];
        for (i, f) in flags.iter().enumerate() {
            if *f {
                out[i / 8] |= 0x80 >> (i % 8);
            }
        }
        out
    }

    fn folder(h: &mut Vec<u8>, id: &[u8], props: &[u8]) {
        number(h, 1);
        h.push(id.len() as u8 | if props.is_empty() { 0 } else { 0x20 });
        h.extend(id);
        if !props.is_empty() {
            number(h, props.len() as u64);
            h.extend(props);
        }
    }

    /// One coder (`id`, `props`) per block and one block per entry with data, whose packed bytes are the data as given,
    /// so only a copy coder decodes them. `header` wraps the header in a block of its own with that coder.
    fn raw7z(files: &[Raw], id: &[u8], props: &[u8], header: Option<(&[u8], &[u8])>) -> Vec<u8> {
        raw7z_chain(files, &[(id, props)], header)
    }

    /// A block of `coders` chained, the first giving the block's output: coder `i` reads what coder `i + 1` writes.
    fn chain(h: &mut Vec<u8>, coders: &[(&[u8], &[u8])]) {
        number(h, coders.len() as u64);
        for (id, props) in coders {
            h.push(id.len() as u8 | if props.is_empty() { 0 } else { 0x20 });
            h.extend(*id);
            if !props.is_empty() {
                number(h, props.len() as u64);
                h.extend(*props);
            }
        }
        for i in 0..coders.len() as u64 - 1 {
            number(h, i);
            number(h, i + 1);
        }
    }

    fn raw7z_chain(
        files: &[Raw],
        coders: &[(&[u8], &[u8])],
        header: Option<(&[u8], &[u8])>,
    ) -> Vec<u8> {
        let empty = |f: &Raw| f.data.is_none_or(<[u8]>::is_empty);
        let streams: Vec<&[u8]> = files
            .iter()
            .filter(|f| !empty(f))
            .filter_map(|f| f.data)
            .collect();
        let mut h = vec![0x01, 0x04, 0x06];
        number(&mut h, 0);
        number(&mut h, streams.len() as u64);
        h.push(0x09);
        for s in &streams {
            number(&mut h, s.len() as u64);
        }
        h.extend([0x00, 0x07, 0x0B]);
        number(&mut h, streams.len() as u64);
        h.push(0x00);
        for _ in &streams {
            chain(&mut h, coders);
        }
        h.push(0x0C);
        for s in &streams {
            for _ in coders {
                number(&mut h, s.len() as u64);
            }
        }
        h.extend([0x00, 0x08, 0x0A, 0x01]);
        for s in &streams {
            h.extend(crc32fast::hash(s).to_le_bytes());
        }
        h.extend([0x00, 0x00, 0x05]);
        number(&mut h, files.len() as u64);
        if files.iter().any(empty) {
            let v = bits(files.iter().map(empty));
            h.push(0x0E);
            number(&mut h, v.len() as u64);
            h.extend(&v);
            let v = bits(files.iter().filter(|f| empty(f)).map(|f| f.data.is_some()));
            h.push(0x0F);
            number(&mut h, v.len() as u64);
            h.extend(&v);
        }
        let mut names = vec![0u8];
        for f in files {
            for u in f.name.encode_utf16().chain([0]) {
                names.extend(u.to_le_bytes());
            }
        }
        h.push(0x11);
        number(&mut h, names.len() as u64);
        h.extend(&names);
        h.push(0x15);
        number(&mut h, 2 + 4 * files.len() as u64);
        h.extend([0x01, 0x00]);
        for f in files {
            h.extend(f.attrs.to_le_bytes());
        }
        h.extend([0x00, 0x00]);

        let mut packed: Vec<u8> = streams.concat();
        let next = match header {
            None => h,
            Some((id, props)) => {
                let at = packed.len() as u64;
                packed.extend(&h);
                let mut e = vec![0x17, 0x06];
                number(&mut e, at);
                number(&mut e, 1);
                e.push(0x09);
                number(&mut e, h.len() as u64);
                e.extend([0x00, 0x07, 0x0B]);
                number(&mut e, 1);
                e.push(0x00);
                folder(&mut e, id, props);
                e.push(0x0C);
                number(&mut e, h.len() as u64);
                e.extend([0x00, 0x00]);
                e
            }
        };
        let mut start = Vec::new();
        start.extend((packed.len() as u64).to_le_bytes());
        start.extend((next.len() as u64).to_le_bytes());
        start.extend(crc32fast::hash(&next).to_le_bytes());
        let mut out = b"7z\xbc\xaf\x27\x1c\x00\x04".to_vec();
        out.extend(crc32fast::hash(&start).to_le_bytes());
        out.extend(start);
        out.extend(packed);
        out.extend(next);
        out
    }

    /// A 7z of nothing but `next` as its header, with a valid signature header.
    fn with_header(next: &[u8]) -> Vec<u8> {
        let mut start = Vec::new();
        start.extend(0u64.to_le_bytes());
        start.extend((next.len() as u64).to_le_bytes());
        start.extend(crc32fast::hash(next).to_le_bytes());
        let mut out = b"7z\xbc\xaf\x27\x1c\x00\x04".to_vec();
        out.extend(crc32fast::hash(&start).to_le_bytes());
        out.extend(start);
        out.extend(next);
        out
    }

    fn file<'a>(name: &'a str, data: &'a [u8]) -> Raw<'a> {
        Raw {
            name,
            data: Some(data),
            attrs: 0x20,
        }
    }

    #[test]
    fn the_hand_writer_makes_what_the_reader_reads() {
        let bytes = raw7z(
            &[
                Raw {
                    name: "docs",
                    data: None,
                    attrs: ATTR_DIRECTORY,
                },
                file("docs/a.md", b"# A\n"),
                file("none.txt", b""),
            ],
            EncoderMethod::ID_COPY,
            &[],
            None,
        );
        let (dir, f) = temp("hand.7z", &bytes);
        let l = listed(&f, &Limits::DEFAULT);
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str()))
            .collect();
        assert_eq!(
            rows,
            [
                ("docs/", "dir"),
                ("docs/a.md", "file"),
                ("none.txt", "file")
            ]
        );
        assert_eq!(
            read(&f, 1, "docs/a.md", &Limits::DEFAULT).unwrap(),
            b"# A\n"
        );
        done(dir, f);
    }

    #[test]
    fn an_unread_coder_or_an_encrypted_entry_is_listed_and_refused_with_its_reason() {
        let ppmd = raw7z(
            &[file("a.txt", b"some text")],
            EncoderMethod::ID_PPMD,
            &[6, 0, 0, 0, 1],
            None,
        );
        let (dir, f) = temp("ppmd.7z", &ppmd);
        let l = listed(&f, &Limits::DEFAULT);
        assert_eq!(l.entries[0].method.as_deref(), Some("PPMd"));
        let said = "a.txt is compressed with PPMd, which the app does not read.";
        assert!(
            matches!(read(&f, 0, "a.txt", &Limits::DEFAULT), Err(Fault::Unsupported(m)) if m == said)
        );
        let got = arch::heads(&f, "a.7z", &[want(0, "a.txt")], 8, &Limits::DEFAULT, None).unwrap();
        assert_eq!(got[0].refused.as_deref(), Some(said));
        done(dir, f);

        for (name, id) in [
            ("bzip2", EncoderMethod::ID_BZIP2),
            ("Deflate", EncoderMethod::ID_DEFLATE),
            ("an unknown method", &[0x7F, 0x7F][..]),
        ] {
            let (dir, f) = temp("other.7z", &raw7z(&[file("a.txt", b"x")], id, &[], None));
            assert_eq!(
                listed(&f, &Limits::DEFAULT).entries[0].method.as_deref(),
                Some(name)
            );
            assert!(matches!(
                read(&f, 0, "a.txt", &Limits::DEFAULT),
                Err(Fault::Unsupported(_))
            ));
            done(dir, f);
        }

        let aes = raw7z(
            &[file("secret.txt", b"0123456789abcdef")],
            EncoderMethod::ID_AES256_SHA256,
            &[0],
            None,
        );
        let (dir, f) = temp("aes.7z", &aes);
        let l = listed(&f, &Limits::DEFAULT);
        assert!(l.entries[0].encrypted && l.entries[0].method.is_none());
        assert!(
            matches!(read(&f, 0, "secret.txt", &Limits::DEFAULT), Err(Fault::Refused(m)) if m == "This entry is encrypted. The app does not ask for archive passwords.")
        );
        done(dir, f);
    }

    #[test]
    fn an_encrypted_or_oversized_header_is_refused_before_anything_is_listed() {
        let entries = [file("a.txt", b"x")];
        let header = |id: &[u8], props: &[u8]| {
            raw7z(&entries, EncoderMethod::ID_COPY, &[], Some((id, props)))
        };
        let (dir, f) = temp(
            "aes-header.7z",
            &header(EncoderMethod::ID_AES256_SHA256, &[0]),
        );
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Unsupported(m)) if m == "This 7z archive's list of entries is encrypted. The app does not ask for archive passwords.")
        );
        done(dir, f);
        let (dir, f) = temp(
            "ppmd-header.7z",
            &header(EncoderMethod::ID_PPMD, &[6, 0, 0, 0, 1]),
        );
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Unsupported(m)) if m == "This 7z archive's list of entries is compressed with PPMd, which the app does not read.")
        );
        done(dir, f);
        // A 1 GB dictionary for the header: refused before the decoder allocates it.
        let (dir, f) = temp(
            "huge-header.7z",
            &header(EncoderMethod::ID_LZMA, &[0x5D, 0, 0, 0, 0x40]),
        );
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Refused(m)) if m == "This 7z archive's list of entries needs more than the 16 MB the app gives it.")
        );
        done(dir, f);
        let (dir, f) = temp("copied-header.7z", &header(EncoderMethod::ID_COPY, &[]));
        assert_eq!(
            listed(&f, &Limits::DEFAULT).entries[0].path,
            "a.txt",
            "an encoded header in a block the app reads"
        );
        done(dir, f);
    }

    #[test]
    fn folders_and_empty_files_between_solid_entries_keep_the_rest_in_place() {
        let mut w = writer(EncoderMethod::LZMA2);
        let mut empty = entry("d/empty.txt");
        empty.has_stream = false;
        let entries = vec![
            entry("a.txt"),
            sevenz_rust2::ArchiveEntry::new_directory("d"),
            entry("d/b.txt"),
            empty,
            entry("c.txt"),
        ];
        let bodies: [&[u8]; 5] = [b"alpha\n", b"", b"bravo\n", b"", b"charlie\n"];
        let readers = bodies
            .iter()
            .map(|b| SourceReader::new(Cursor::new(b.to_vec())))
            .collect();
        w.push_archive_entries(entries, readers).unwrap();
        let (dir, file) = temp("solid-gaps.7z", &w.finish().unwrap().into_inner());
        let l = listed(&file, &Limits::DEFAULT);
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str()))
            .collect();
        assert_eq!(
            rows,
            [
                ("a.txt", "file"),
                ("d/", "dir"),
                ("d/b.txt", "file"),
                ("d/empty.txt", "file"),
                ("c.txt", "file")
            ]
        );
        for (i, name, want) in [
            (0, "a.txt", &b"alpha\n"[..]),
            (2, "d/b.txt", b"bravo\n"),
            (3, "d/empty.txt", b""),
            (4, "c.txt", b"charlie\n"),
        ] {
            assert_eq!(
                read(&file, i, name, &Limits::DEFAULT).unwrap(),
                want,
                "{name}"
            );
        }
        let got = arch::heads(
            &file,
            "a.7z",
            &[want(4, "c.txt"), want(2, "d/b.txt")],
            64,
            &Limits::DEFAULT,
            None,
        )
        .unwrap();
        assert_eq!(got[0].bytes, b"charlie\n");
        assert_eq!(got[1].bytes, b"bravo\n");
        done(dir, file);
    }

    #[test]
    fn a_header_declaring_too_many_entries_or_blocks_is_refused_before_the_crate_sizes_them() {
        let too_many =
            "This 7z archive declares 2,000,000 entries, more than the 1,000,000 the app reads.";
        let mut files = vec![0x01, 0x05];
        number(&mut files, 2_000_000);
        files.extend([0x00, 0x00]);
        let (dir, f) = temp("many-files.7z", &with_header(&files));
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Refused(m)) if m == too_many)
        );
        done(dir, f);

        // The same header packed in a block of its own, as an LZMA-packed one is: its packed bytes come first.
        let mut encoded = vec![0x17, 0x06];
        number(&mut encoded, 0);
        number(&mut encoded, 1);
        encoded.push(0x09);
        number(&mut encoded, files.len() as u64);
        encoded.extend([0x00, 0x07, 0x0B, 0x01, 0x00]);
        folder(&mut encoded, EncoderMethod::ID_COPY, &[]);
        encoded.push(0x0C);
        number(&mut encoded, files.len() as u64);
        encoded.extend([0x00, 0x00]);
        let mut bytes = with_header(&encoded);
        bytes.splice(32..32, files.iter().copied());
        bytes[12..20].copy_from_slice(&(files.len() as u64).to_le_bytes());
        let crc = crc32fast::hash(&bytes[12..32]).to_le_bytes();
        bytes[8..12].copy_from_slice(&crc);
        let (dir, f) = temp("many-files-encoded.7z", &bytes);
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Refused(m)) if m == too_many)
        );
        done(dir, f);

        let mut blocks = vec![0x01, 0x04, 0x07, 0x0B];
        number(&mut blocks, 200_001);
        blocks.push(0x00);
        let (dir, f) = temp("many-blocks.7z", &with_header(&blocks));
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Refused(m)) if m == "This 7z archive declares 200,001 blocks, more than the 200,000 the app reads.")
        );
        done(dir, f);
    }

    /// A 7z whose header is `inner`, packed (as stored) in a block of `coders`.
    fn encoded_header(inner: &[u8], coders: &[(&[u8], &[u8])]) -> Vec<u8> {
        let mut encoded = vec![0x17, 0x06];
        number(&mut encoded, 0);
        number(&mut encoded, 1);
        encoded.push(0x09);
        number(&mut encoded, inner.len() as u64);
        encoded.extend([0x00, 0x07, 0x0B, 0x01, 0x00]);
        chain(&mut encoded, coders);
        encoded.push(0x0C);
        for _ in coders {
            number(&mut encoded, inner.len() as u64);
        }
        encoded.extend([0x00, 0x00]);
        let mut bytes = with_header(&encoded);
        bytes.splice(32..32, inner.iter().copied());
        bytes[12..20].copy_from_slice(&(inner.len() as u64).to_le_bytes());
        let crc = crc32fast::hash(&bytes[12..32]).to_le_bytes();
        bytes[8..12].copy_from_slice(&crc);
        bytes
    }

    #[test]
    fn a_header_packed_with_a_filter_chain_is_refused_before_anything_parses_it() {
        // The crate would unpack these chains and size its tables from the 16,000,000 entries declared inside.
        let mut inner = vec![0x01, 0x05];
        number(&mut inner, 16_000_000);
        inner.extend([0x00, 0x00]);
        for (coders, words) in [
            (
                [
                    (EncoderMethod::ID_DELTA, &[0u8][..]),
                    (EncoderMethod::ID_LZMA2, &[16u8][..]),
                ],
                "Delta over LZMA2",
            ),
            (
                [
                    (EncoderMethod::ID_BCJ_X86, &[][..]),
                    (EncoderMethod::ID_COPY, &[][..]),
                ],
                "BCJ over copy",
            ),
        ] {
            let (dir, f) = temp("chained-header.7z", &encoded_header(&inner, &coders));
            let said = format!("This 7z archive's list of entries is packed with {words}: the app reads a list of entries packed with one of copy, LZMA or LZMA2 only.");
            assert!(
                matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Unsupported(m)) if m == said),
                "{words}"
            );
            done(dir, f);
        }
        let (dir, f) = temp(
            "copied-many.7z",
            &encoded_header(&inner, &[(EncoderMethod::ID_COPY, &[])]),
        );
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Refused(m)) if m == "This 7z archive declares 16,000,000 entries, more than the 1,000,000 the app reads.")
        );
        done(dir, f);
    }

    #[test]
    fn a_zeroed_or_wrong_signature_header_is_damaged_at_once() {
        // A zero CRC and twenty zero bytes would send the crate searching the last megabyte for a header, parsing at
        // every 0x01 it meets.
        let mut bytes = b"7z\xbc\xaf\x27\x1c\x00\x04".to_vec();
        bytes.extend([0u8; 24]);
        for _ in 0..512 * 1024 {
            bytes.extend([0x01, 0x00]);
        }
        let (dir, f) = temp("zeroed.7z", &bytes);
        let started = std::time::Instant::now();
        assert!(
            matches!(arch::list(&f, "a.7z", &Limits::DEFAULT, None), Err(Fault::Invalid(m)) if m == "The listing could not be read: the archive is damaged.")
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        done(dir, f);
        let mut wrong = sample(EncoderMethod::COPY);
        wrong[8] ^= 1;
        let (dir, f) = temp("wrong-crc.7z", &wrong);
        assert!(matches!(
            arch::list(&f, "a.7z", &Limits::DEFAULT, None),
            Err(Fault::Invalid(_))
        ));
        done(dir, f);
    }

    #[test]
    fn a_block_whose_dictionaries_together_pass_the_cap_is_refused() {
        // LZMA2's dictionary byte 31 asks for 192 MB: one is within the cap, two chained are not.
        let lzma2: (&[u8], &[u8]) = (EncoderMethod::ID_LZMA2, &[31]);
        let bytes = raw7z_chain(&[file("a.txt", b"x")], &[lzma2, lzma2], None);
        let (dir, f) = temp("two-dicts.7z", &bytes);
        assert!(
            matches!(read(&f, 0, "a.txt", &Limits::DEFAULT), Err(Fault::Refused(m)) if m == "a.txt needs 384.0 MB of memory to unpack, over the 256 MB the app gives one block.")
        );
        done(dir, f);
    }

    #[test]
    fn a_block_whose_dictionary_is_too_big_is_refused_when_read() {
        // LZMA2's dictionary byte 40 asks for 4 GB.
        let bytes = raw7z(&[file("a.txt", b"x")], EncoderMethod::ID_LZMA2, &[40], None);
        let (dir, f) = temp("dict.7z", &bytes);
        assert_eq!(listed(&f, &Limits::DEFAULT).entries[0].method, None);
        let e = read(&f, 0, "a.txt", &Limits::DEFAULT).unwrap_err();
        assert!(
            matches!(&e, Fault::Refused(m) if m.starts_with("a.txt needs ") && m.ends_with(" of memory to unpack, over the 256 MB the app gives one block.")),
            "{e:?}"
        );
        done(dir, f);
    }

    #[test]
    fn links_and_devices_are_shown_never_followed() {
        let unix = |mode: u32| ATTR_UNIX_EXTENSION | (mode << 16);
        let bytes = raw7z(
            &[
                Raw {
                    name: "link",
                    data: Some(b"../../etc/passwd"),
                    attrs: unix(0o120_777),
                },
                Raw {
                    name: "fifo",
                    data: Some(b""),
                    attrs: unix(0o010_644),
                },
                Raw {
                    name: "junction",
                    data: Some(b"reparse data"),
                    attrs: ATTR_REPARSE_POINT,
                },
                Raw {
                    name: "run.sh",
                    data: Some(b"#!/bin/sh\n"),
                    attrs: unix(0o100_755),
                },
            ],
            EncoderMethod::ID_COPY,
            &[],
            None,
        );
        let (dir, f) = temp("links.7z", &bytes);
        let l = listed(&f, &Limits::DEFAULT);
        let rows: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.kind.as_str(), e.mode))
            .collect();
        assert_eq!(
            rows,
            [
                ("link", "link", Some(0o120_777)),
                ("fifo", "other", Some(0o010_644)),
                ("junction", "link", None),
                ("run.sh", "file", Some(0o100_755)),
            ]
        );
        assert!(
            matches!(read(&f, 0, "link", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "link is a link: links are not followed.")
        );
        assert!(
            matches!(read(&f, 1, "fifo", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "fifo is not a file.")
        );
        assert_eq!(
            read(&f, 3, "run.sh", &Limits::DEFAULT).unwrap(),
            b"#!/bin/sh\n"
        );
        done(dir, f);
    }

    #[test]
    fn the_index_keeps_the_parsed_header_for_later_reads() {
        let indexes = arch::Indexes::new();
        let (dir, f) = temp("kept.7z", &solid(EncoderMethod::LZMA2));
        let cache = arch::Cache {
            indexes: &indexes,
            key: arch::Key::of(&dir.join("kept.7z"), &f).unwrap(),
        };
        arch::list(&f, "kept.7z", &Limits::DEFAULT, Some(&cache)).unwrap();
        let kept = indexes.get(&cache.key).unwrap();
        assert!(matches!(&kept.slots, arch::Slots::SevenZ(_)));
        assert_eq!(
            arch::read(
                &f,
                "kept.7z",
                4,
                "src/f4.txt",
                &Limits::DEFAULT,
                Some(&cache)
            )
            .unwrap(),
            body(4)
        );
        done(dir, f);
    }

    // ---- the demo's 7z ----------------------------------------------------------------------------------------------

    fn demo() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/demo")
    }

    const DEMO_FONTS: [&str; 6] = [
        "Tidemark.ttc",
        "TidemarkSans-Bold.otf",
        "TidemarkSans-Regular.ttf",
        "TidemarkSans-Regular.woff",
        "TidemarkSans[wdth,wght].ttf",
        "TidemarkSans[wdth,wght].woff2",
    ];

    /// Writes `fixtures/demo/archives/fonts.7z`, one solid LZMA2 block of the demo's fonts in a folder:
    /// `cargo test write_the_demo_7z -- --ignored`. The bytes are the same on every run.
    #[test]
    #[ignore]
    fn write_the_demo_7z() {
        let mut w = writer(EncoderMethod::LZMA2);
        let mut folder = sevenz_rust2::ArchiveEntry::new_directory("tidemark-fonts");
        folder.has_last_modified_date = true;
        folder.last_modified_date = NtTime::new(MTIME);
        w.push_archive_entry(folder, None::<&[u8]>).unwrap();
        let entries = DEMO_FONTS
            .iter()
            .map(|n| entry(&format!("tidemark-fonts/{n}")))
            .collect();
        let readers = DEMO_FONTS
            .iter()
            .map(|n| SourceReader::new(File::open(demo().join("fonts").join(n)).unwrap()))
            .collect();
        w.push_archive_entries(entries, readers).unwrap();
        std::fs::write(
            demo().join("archives/fonts.7z"),
            w.finish().unwrap().into_inner(),
        )
        .unwrap();
    }

    #[test]
    fn the_demo_7z_holds_the_demo_fonts() {
        let file = File::open(demo().join("archives/fonts.7z")).unwrap();
        let l = listed(&file, &Limits::DEFAULT);
        assert_eq!(l.entries[0].path, "tidemark-fonts/");
        assert_eq!(l.entries.len(), 1 + DEMO_FONTS.len());
        for (e, n) in l.entries[1..].iter().zip(DEMO_FONTS) {
            assert_eq!(e.path, format!("tidemark-fonts/{n}"));
            let want = std::fs::read(demo().join("fonts").join(n)).unwrap();
            assert_eq!(
                read(&file, e.index, &e.path, &Limits::DEFAULT).unwrap(),
                want,
                "{n}"
            );
        }
    }
}
