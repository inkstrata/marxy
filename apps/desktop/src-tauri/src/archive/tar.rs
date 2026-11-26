//! A tar listed and read through the `tar` crate's entry iterator, never its unpack. A plain tar is walked by seeking
//! over data; a compressed one is decompressed through a counter that fails the read once `Limits::stream` bytes have
//! passed, which is what bounds a bomb. The crate folds GNU long names and PAX headers into the entry they describe,
//! reading each whole into memory first, so a reader in front of it refuses one that declares more than 1 MB.

use std::cell::Cell;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::rc::Rc;

use ::tar::{Archive, Entries, Entry};

use super::{
    changed, commas, damaged, folder, head_of, iso_from_unix, link_text, raw_name_of, sanitise,
    size_words, too_big_actual, too_big_declared, unpacked, ArchiveEntry, ArchiveListing, Comp,
    Fault, Format, Head, Limits, Span, Want,
};

/// A tar unpacked from a span of the file by `comp`, or read as it lies there when there is none: the whole of a
/// compressed tar, or the control or data tar inside a Debian package.
#[derive(Debug, Clone, Copy)]
pub struct Inner {
    pub comp: Option<Comp>,
    pub span: Span,
}

/// The most a GNU long name or long link, or a PAX header, may declare.
const MAX_EXTENSION_BYTES: u64 = 1024 * 1024;

/// How far the counting reader has gone, and whether it stopped a read for going too far; and the size an
/// extension header declared when `Headers` refused it.
#[derive(Default)]
struct Stream {
    count: Cell<u64>,
    tripped: Cell<bool>,
    header: Cell<Option<u64>>,
}

/// Sees every 512-byte block the crate reads, from the tar's first byte, and fails the read that completes a GNU
/// long-name (`L`) or long-link (`K`) header, or a PAX (`x`, `g`) one, that declares more than `MAX_EXTENSION_BYTES`:
/// the crate's next step is to read that much into one buffer. A block inside an entry's data is looked at too, which
/// refuses only a tar inside the tar that holds such a header itself.
struct Headers<R> {
    inner: R,
    pos: u64,
    block: [u8; 512],
    /// Whether `block` has been filled from the start of the current block (not after a seek into its middle).
    whole: bool,
    state: Rc<Stream>,
}

impl<R> Headers<R> {
    fn new(inner: R, state: Rc<Stream>) -> Self {
        Self {
            inner,
            pos: 0,
            block: [0; 512],
            whole: true,
            state,
        }
    }
}

impl<R: Read> Read for Headers<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        let mut at = 0;
        while at < n {
            let off = (self.pos % 512) as usize;
            let take = (512 - off).min(n - at);
            self.block[off..off + take].copy_from_slice(&buf[at..at + take]);
            at += take;
            self.pos += take as u64;
            if off + take == 512 {
                if self.whole {
                    if let Some(size) = oversized_extension(&self.block) {
                        self.state.header.set(Some(size));
                        return Err(io::Error::other("an extension header past its limit"));
                    }
                }
                self.whole = true;
            }
        }
        Ok(n)
    }
}

impl<R: Seek> Seek for Headers<R> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let pos = self.inner.seek(to)?;
        self.pos = pos;
        self.whole = pos % 512 == 0;
        Ok(pos)
    }
}

/// A tar number field as the crate reads it: octal text up to a NUL, or base-256 when the high bit is set.
fn tar_number(field: &[u8]) -> Option<u64> {
    if field.first().is_some_and(|b| b & 0x80 != 0) {
        return Some(field.iter().enumerate().fold(0u64, |n, (i, &b)| {
            n.saturating_mul(256)
                .saturating_add(u64::from(if i == 0 { b & 0x7f } else { b }))
        }));
    }
    let text = field.split(|&b| b == 0).next().unwrap_or(&[]);
    u64::from_str_radix(std::str::from_utf8(text).ok()?.trim(), 8).ok()
}

/// The size `block` declares when it is a valid GNU or ustar extension header declaring more than the cap.
fn oversized_extension(block: &[u8; 512]) -> Option<u64> {
    if !matches!(block[156], b'L' | b'K' | b'x' | b'g') {
        return None;
    }
    let magic = &block[257..265];
    if magic != b"ustar\x0000" && magic != b"ustar  \x00" {
        return None;
    }
    let sum: u64 = block[..148]
        .iter()
        .chain(&block[156..])
        .map(|&b| u64::from(b))
        .sum::<u64>()
        + 8 * 32;
    if tar_number(&block[148..156]) != Some(sum) {
        return None;
    }
    tar_number(&block[124..136]).filter(|&size| size > MAX_EXTENSION_BYTES)
}

fn extension_words(size: u64) -> String {
    format!(
        "a name or extension header of {}, past the 1 MB the app reads",
        size_words(size)
    )
}

const DRAIN_BYTES: u64 = 64 * 1024 * 1024;

struct Counting<R> {
    inner: R,
    state: Rc<Stream>,
    limit: u64,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        let total = self.state.count.get() + n as u64;
        self.state.count.set(total);
        if total > self.limit {
            self.state.tripped.set(true);
            return Err(io::Error::other("the unpacked stream passed its limit"));
        }
        Ok(n)
    }
}

fn lies_past(name: &str) -> Fault {
    Fault::Refused(format!(
        "{name} lies past the first 1 GB of the unpacked stream, further than the app walks."
    ))
}

fn kind_of(entry: &Entry<'_, impl Read>, name_is_dir: bool) -> &'static str {
    let t = entry.header().entry_type();
    if t.is_dir() || (name_is_dir && (t.is_file() || t.is_contiguous())) {
        "dir"
    } else if t.is_file() || t.is_contiguous() {
        "file"
    } else if t.is_symlink() || t.is_hard_link() {
        "link"
    } else {
        "other"
    }
}

/// The entry as listed, or `None` when it is left out. `raw` is the decoded name, for messages.
fn describe(
    entry: &mut Entry<'_, impl Read>,
    index: u32,
    limits: &Limits,
) -> Option<(ArchiveEntry, Option<Vec<u8>>)> {
    let raw = entry.path_bytes();
    if raw.len() > limits.name_bytes {
        return None;
    }
    let decoded = String::from_utf8_lossy(&raw).into_owned();
    let kind = kind_of(entry, decoded.ends_with(['/', '\\']));
    let clean = sanitise(&decoded, kind == "dir")?;
    if clean.depth > limits.depth {
        return None;
    }
    let target = entry.link_name_bytes().map(|b| b.into_owned());
    // The PAX mtime (fractional, floored) wins over the header's, as in core's archive-read.ts.
    let pax = entry
        .pax_extensions()
        .ok()
        .flatten()
        .and_then(|exts| {
            exts.flatten()
                .find(|x| x.key_bytes() == b"mtime")
                .and_then(|x| {
                    String::from_utf8_lossy(x.value_bytes())
                        .trim()
                        .parse::<f64>()
                        .ok()
                })
        })
        .filter(|m| m.is_finite() && *m >= 0.0)
        .map(|m| m.floor() as u64);
    let mtime = pax
        .or_else(|| entry.header().mtime().ok())
        .filter(|&m| m > 0)
        .and_then(|m| i64::try_from(m).ok())
        .and_then(|m| iso_from_unix(m, true));
    Some((
        ArchiveEntry {
            index,
            raw_name: raw_name_of(&clean, &decoded),
            path: clean.path,
            size: (kind == "file").then(|| entry.size()),
            packed: None,
            mtime,
            encrypted: false,
            method: None,
            link: (kind == "link")
                .then(|| target.as_deref().map(|t| link_text(t, limits)))
                .flatten(),
            kind: kind.into(),
            offset: Some(entry.raw_header_position()),
            crc: None,
            host: None,
            mode: entry.header().mode().ok(),
            flags: None,
            comment: None,
        },
        target,
    ))
}

/// Where an entry begins in the stream (its extension headers first), so a plain tar can seek straight to it.
#[derive(Debug, Clone)]
pub struct Slot {
    index: u32,
    start: Option<u64>,
}

/// Where the entry after `entry` begins, as the crate steps: past the data, which a PAX size overrides, in whole
/// blocks. None after a GNU sparse entry, whose extra headers the crate reads past without saying where.
fn next_start<R: Read>(entry: &mut Entry<'_, R>) -> Option<u64> {
    let kind = entry.header().entry_type();
    if kind.is_gnu_sparse() {
        return None;
    }
    let mut size = entry.header().entry_size().ok()?;
    if !kind.is_pax_global_extensions() {
        if let Ok(Some(pax)) = entry.pax_extensions() {
            for ext in pax.flatten() {
                if ext.key() == Ok("size") {
                    size = ext.value().ok()?.parse().ok()?;
                }
            }
        }
    }
    entry
        .raw_file_position()
        .checked_add(size.checked_add(511)? & !511)
}

enum Stop {
    End,
    Words(String),
}

struct Walked {
    entries: Vec<ArchiveEntry>,
    slots: Vec<Slot>,
    skipped: u32,
    stop: Stop,
    damage: Option<String>,
    /// Ordinals walked, listed or not.
    ordinals: u32,
}

fn walk<R: Read>(mut entries: Entries<'_, R>, limits: &Limits, stream: Option<&Stream>) -> Walked {
    let mut walked = Walked {
        entries: Vec::new(),
        slots: Vec::new(),
        skipped: 0,
        stop: Stop::End,
        damage: None,
        ordinals: 0,
    };
    let mut listed = 0usize;
    let mut index = 0usize;
    let mut start = Some(0u64);
    loop {
        let item = entries.next();
        if index >= limits.entries && matches!(item, Some(Ok(_))) {
            walked.stop = Stop::Words(format!(
                "Listed the first {} entries; more follow.",
                commas(walked.entries.len() as u64)
            ));
            break;
        }
        let mut entry = match item {
            None => break,
            Some(Ok(e)) => e,
            Some(Err(e)) => {
                if let Some(size) = stream.and_then(|s| s.header.get()) {
                    walked.stop = Stop::Words(format!(
                        "Listed the first {} entries: the next has {}.",
                        commas(walked.entries.len() as u64),
                        extension_words(size)
                    ));
                } else if stream.is_some_and(|s| s.tripped.get()) {
                    walked.stop = Stop::Words(format!(
                        "Listed the first {} entries: the walk stops after 1 GB of unpacked stream.",
                        commas(walked.entries.len() as u64)
                    ));
                } else {
                    walked.damage = Some(e.to_string());
                }
                break;
            }
        };
        let this = index as u32;
        index += 1;
        let here = start;
        start = next_start(&mut entry);
        if entry.header().entry_type().is_pax_global_extensions() {
            continue;
        }
        match describe(&mut entry, this, limits) {
            None => walked.skipped += 1,
            Some((e, _)) => {
                if listed + e.path.len() > limits.listed_bytes {
                    walked.stop = Stop::Words(format!(
                        "Listed the first {} entries: their names reach the 16 MB a listing may hold.",
                        commas(walked.entries.len() as u64)
                    ));
                    break;
                }
                listed += e.path.len();
                walked.slots.push(Slot {
                    index: this,
                    start: here,
                });
                walked.entries.push(e);
            }
        }
    }
    walked.ordinals = u32::try_from(index).unwrap_or(u32::MAX);
    walked
}

fn finish(
    format: Format,
    walked: Walked,
    size: u64,
    unpacked: Option<u64>,
) -> Result<(ArchiveListing, Vec<Slot>), Fault> {
    let truncated = match (walked.stop, walked.damage) {
        (Stop::Words(w), _) => Some(w),
        (Stop::End, Some(e)) if walked.entries.is_empty() && walked.skipped == 0 => {
            return Err(Fault::Invalid(format!(
                "The listing could not be read: {e}."
            )));
        }
        (Stop::End, Some(e)) => Some(format!("The listing stopped at a damaged part: {e}.")),
        (Stop::End, None) => None,
    };
    let unpacked = if truncated.is_none() { unpacked } else { None };
    let listing = ArchiveListing {
        format: format.name().into(),
        entries: walked.entries,
        comment: None,
        truncated,
        skipped: walked.skipped,
        declared: None,
        size,
        unpacked,
        directory: None,
        note: None,
    };
    Ok((listing, walked.slots))
}

/// The decompressed stream behind its counter and the header check, and their state.
type Packed<'a> = (Headers<Counting<Box<dyn Read + 'a>>>, Rc<Stream>);

#[cfg(test)]
thread_local! {
    /// Compressed streams opened from byte 0 on this thread: what proves many heads took one walk.
    pub static WALKS: Cell<u32> = const { Cell::new(0) };
}

fn counting<'a>(file: &'a File, inner: Inner, limits: &Limits) -> Result<Packed<'a>, Fault> {
    #[cfg(test)]
    WALKS.with(|w| w.set(w.get() + 1));
    let state = Rc::new(Stream::default());
    let reader = Counting {
        inner: unpacked(file, inner.comp, inner.span)?,
        state: state.clone(),
        limit: limits.stream,
    };
    Ok((Headers::new(reader, state.clone()), state))
}

/// The tar crate counts from its own zero, so the file must be at byte 0.
fn plain(file: &File) -> io::Result<(Archive<Headers<&File>>, Rc<Stream>)> {
    let mut f = file;
    f.seek(SeekFrom::Start(0))?;
    let state = Rc::new(Stream::default());
    Ok((Archive::new(Headers::new(file, state.clone())), state))
}

#[cfg(test)]
pub fn list(
    file: &File,
    comp: Option<Comp>,
    size: u64,
    limits: &Limits,
) -> Result<ArchiveListing, Fault> {
    list_slots(file, comp, size, limits).map(|(l, _)| l)
}

/// The listing, and where each entry in it begins.
pub fn list_slots(
    file: &File,
    comp: Option<Comp>,
    size: u64,
    limits: &Limits,
) -> Result<(ArchiveListing, Vec<Slot>), Fault> {
    let format = Format::Tar(comp);
    let fail = |e: io::Error| Fault::Invalid(format!("The listing could not be read: {e}."));
    let Some(comp) = comp else {
        let (mut archive, state) = plain(file)?;
        let entries = archive.entries_with_seek().map_err(fail)?;
        return finish(format, walk(entries, limits, Some(&state)), size, None);
    };
    let (reader, state) = counting(file, whole(comp), limits)?;
    let mut archive = Archive::new(reader);
    let walked = walk(archive.entries().map_err(fail)?, limits, Some(&state));
    // Padding after the end blocks still counts toward the stream; its end is the tar stream's length.
    let ended = matches!(walked.stop, Stop::End) && walked.damage.is_none();
    let unpacked = if ended {
        let mut reader = archive.into_inner();
        // Only the padding after the end blocks is left; a long tail is not worth unpacking just to say its length.
        match io::copy(&mut (&mut reader).take(DRAIN_BYTES), &mut io::sink()) {
            Ok(n) if n < DRAIN_BYTES => Some(state.count.get()),
            _ => None,
        }
    } else {
        None
    };
    finish(format, walked, size, unpacked)
}

fn whole(comp: Comp) -> Inner {
    Inner {
        comp: Some(comp),
        span: Span::ALL,
    }
}

/// The listing of a tar held in a span of the file, how many ordinals its walk took (listed or not), and how many
/// unpacked bytes the walk read, so a caller listing several can hold them to one stream budget.
pub fn list_inner(
    file: &File,
    inner: Inner,
    limits: &Limits,
) -> Result<(ArchiveListing, u32, u64), Fault> {
    let (reader, state) = counting(file, inner, limits)?;
    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|e| Fault::Invalid(format!("The listing could not be read: {e}.")))?;
    let walked = walk(entries, limits, Some(&state));
    let ordinals = walked.ordinals;
    let (listing, _) = finish(Format::Tar(inner.comp), walked, inner.span.len, None)?;
    Ok((listing, ordinals, state.count.get()))
}

/// Entry `index` of a tar held in a span of the file, walked from its start.
pub fn read_inner(
    file: &File,
    inner: Inner,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let (reader, state) = counting(file, inner, limits)?;
    let mut archive = Archive::new(reader);
    let entries = archive.entries().map_err(|_| damaged(name))?;
    pick(entries, index, name, limits, Some(&state))
}

/// The heads of a tar held in a span of the file, from one walk of it.
pub fn heads_inner(
    file: &File,
    inner: Inner,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, Fault> {
    if wants.is_empty() {
        return Ok(Vec::new());
    }
    let mut out: Vec<Option<Head>> = vec![None; wants.len()];
    let walk: Vec<(usize, &Want)> = wants.iter().enumerate().collect();
    let (reader, state) = counting(file, inner, limits)?;
    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|e| Fault::Invalid(format!("The listing could not be read: {e}.")))?;
    walk_heads(entries, &walk, max_each, limits, Some(&state), &mut out)?;
    Ok(out.into_iter().flatten().collect())
}

/// Why a walk could not go on, as the sentence for `name`.
fn broken(name: &str, stream: Option<&Stream>) -> Fault {
    if let Some(size) = stream.and_then(|s| s.header.get()) {
        Fault::Refused(format!("{name} has {}.", extension_words(size)))
    } else if stream.is_some_and(|s| s.tripped.get()) {
        lies_past(name)
    } else {
        damaged(name)
    }
}

/// At most `cap` bytes of `entry`, which must be the `name` listed at `index`, and whether it ended inside them.
/// `declared_cap` refuses an entry that declares more before anything is read.
fn entry_bytes<R: Read>(
    entry: &mut Entry<'_, R>,
    index: u32,
    name: &str,
    limits: &Limits,
    cap: u64,
    declared_cap: Option<u64>,
    stream: Option<&Stream>,
) -> Result<(Vec<u8>, bool), Fault> {
    let (listed, target) = describe(entry, index, limits).ok_or_else(changed)?;
    if listed.path != name {
        return Err(changed());
    }
    match listed.kind.as_str() {
        "dir" => return Err(folder()),
        "link" => {
            let to = target.map(|t| link_text(&t, limits)).unwrap_or_default();
            return Err(Fault::Invalid(format!(
                "{name} is a link to {to}: links are not followed."
            )));
        }
        "file" => {}
        _ => return Err(Fault::Invalid(format!("{name} is not a file."))),
    }
    let declared = entry.size();
    if declared_cap.is_some_and(|c| declared > c) {
        return Err(too_big_declared(name, declared));
    }
    let (out, whole) = head_of(&mut *entry, cap).map_err(|_| broken(name, stream))?;
    if whole && (out.len() as u64) < declared {
        return Err(damaged(name));
    }
    Ok((out, whole))
}

/// The whole of an entry, as `read` gives it.
fn whole_of<R: Read>(
    entry: &mut Entry<'_, R>,
    index: u32,
    name: &str,
    limits: &Limits,
    stream: Option<&Stream>,
) -> Result<Vec<u8>, Fault> {
    let (out, whole) = entry_bytes(
        entry,
        index,
        name,
        limits,
        limits.entry,
        Some(limits.entry),
        stream,
    )?;
    if !whole {
        return Err(too_big_actual(name, Some(entry.size())));
    }
    Ok(out)
}

fn pick<R: Read>(
    entries: Entries<'_, R>,
    index: u32,
    name: &str,
    limits: &Limits,
    stream: Option<&Stream>,
) -> Result<Vec<u8>, Fault> {
    for (at, item) in entries.enumerate() {
        let mut entry = item.map_err(|_| broken(name, stream))?;
        if at as u64 != u64::from(index) {
            continue;
        }
        return whole_of(&mut entry, index, name, limits, stream);
    }
    Err(if stream.is_some_and(|s| s.tripped.get()) {
        lies_past(name)
    } else {
        changed()
    })
}

pub fn read(
    file: &File,
    comp: Option<Comp>,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let Some(comp) = comp else {
        let (_, slots) = list_slots(file, None, file.metadata()?.len(), limits)?;
        return read_plain(file, &slots, index, name, limits);
    };
    read_inner(file, whole(comp), index, name, limits)
}

/// The plain tar from the byte where entry `slot.index` begins (its extension headers first), so the crate's first
/// entry is that one.
fn plain_at(file: &File, start: u64) -> io::Result<(Archive<Headers<&File>>, Rc<Stream>)> {
    let mut f = file;
    f.seek(SeekFrom::Start(start))?;
    let state = Rc::new(Stream::default());
    Ok((Archive::new(Headers::new(file, state.clone())), state))
}

/// Entry `index` of a plain tar by its slot: a seek to where it begins, then that one entry.
pub fn read_plain(
    file: &File,
    slots: &[Slot],
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    // An entry the listing never reached (it stopped at a cap) is walked to, so the walk's sentence says why.
    let Some(start) = slot_at(slots, index).and_then(|s| s.start) else {
        let (mut archive, state) = plain(file)?;
        let entries = archive.entries_with_seek().map_err(|_| damaged(name))?;
        return pick(entries, index, name, limits, Some(&state));
    };
    let (mut archive, state) = plain_at(file, start)?;
    let mut entries = archive.entries().map_err(|_| damaged(name))?;
    match entries.next() {
        Some(Ok(mut entry)) => whole_of(&mut entry, index, name, limits, Some(&state)),
        Some(Err(_)) => Err(broken(name, Some(&state))),
        None => Err(changed()),
    }
}

fn slot_at(slots: &[Slot], index: u32) -> Option<&Slot> {
    slots
        .binary_search_by_key(&index, |s| s.index)
        .ok()
        .map(|at| &slots[at])
}

/// The heads of `wants` from one walk of `entries`, which stops after the last wanted ordinal. A walk that fails before
/// its first entry fails the call; one that fails later refuses each want not yet reached.
fn walk_heads<R: Read>(
    entries: Entries<'_, R>,
    wants: &[(usize, &Want)],
    max_each: u64,
    limits: &Limits,
    stream: Option<&Stream>,
    out: &mut [Option<Head>],
) -> Result<(), Fault> {
    let Some(last) = wants.iter().map(|(_, w)| w.index).max() else {
        return Ok(());
    };
    let mut ended = false;
    for (at, item) in entries.enumerate() {
        let mut entry = match item {
            Ok(e) => e,
            Err(e) => {
                let stopped = stream.is_some_and(|s| s.header.get().is_some() || s.tripped.get());
                if at == 0 && !stopped {
                    return Err(Fault::Invalid(format!(
                        "The listing could not be read: {e}."
                    )));
                }
                for (slot, w) in wants {
                    if out[*slot].is_none() {
                        out[*slot] = Some(Head::of(w.index, Err(broken(&w.name, stream)))?);
                    }
                }
                return Ok(());
            }
        };
        let at = at as u32;
        let listed = describe(&mut entry, at, limits).map(|(e, _)| e.path);
        let mut read: Option<Head> = None;
        for (slot, w) in wants.iter().filter(|(_, w)| w.index == at) {
            let head = if listed.as_deref() != Some(w.name.as_str()) {
                Head::of(at, Err(changed()))?
            } else if let Some(head) = &read {
                head.clone()
            } else {
                let got = entry_bytes(&mut entry, at, &w.name, limits, max_each, None, stream);
                let head = Head::of(at, got)?;
                read = Some(head.clone());
                head
            };
            out[*slot] = Some(head);
        }
        if at >= last {
            ended = true;
            break;
        }
    }
    let past = !ended && stream.is_some_and(|s| s.tripped.get());
    for (slot, w) in wants {
        if out[*slot].is_none() {
            let fault = if past { lies_past(&w.name) } else { changed() };
            out[*slot] = Some(Head::of(w.index, Err(fault))?);
        }
    }
    Ok(())
}

/// The beginning of each want, at most `max_each` bytes; the budget was applied by the caller. A compressed tar is
/// unpacked from byte 0 once for all of them; a plain one seeks to each entry its slot places.
pub fn heads(
    file: &File,
    comp: Option<Comp>,
    slots: Option<&[Slot]>,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, Fault> {
    if wants.is_empty() {
        return Ok(Vec::new());
    }
    if let Some(comp) = comp {
        return heads_inner(file, whole(comp), wants, max_each, limits);
    }
    let mut out: Vec<Option<Head>> = vec![None; wants.len()];
    let mut walk: Vec<(usize, &Want)> = Vec::new();
    let owned;
    let slots = match slots {
        Some(s) => s,
        None => {
            owned = list_slots(file, None, file.metadata()?.len(), limits)?.1;
            &owned
        }
    };
    for (i, w) in wants.iter().enumerate() {
        let Some(start) = slot_at(slots, w.index).and_then(|s| s.start) else {
            walk.push((i, w));
            continue;
        };
        let (mut archive, state) = plain_at(file, start)?;
        let first = archive.entries().map(|mut e| e.next());
        let got = match first {
            Ok(Some(Ok(mut entry))) => entry_bytes(
                &mut entry,
                w.index,
                &w.name,
                limits,
                max_each,
                None,
                Some(&state),
            ),
            Ok(None) => Err(changed()),
            Ok(Some(Err(_))) | Err(_) => Err(broken(&w.name, Some(&state))),
        };
        out[i] = Some(Head::of(w.index, got)?);
    }
    if !walk.is_empty() {
        let (mut archive, state) = plain(file)?;
        let entries = archive
            .entries_with_seek()
            .map_err(|e| Fault::Invalid(format!("The listing could not be read: {e}.")))?;
        walk_heads(entries, &walk, max_each, limits, Some(&state), &mut out)?;
    }
    Ok(out.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::testkit::{self, T};
    use std::path::{Path, PathBuf};

    fn temp(name: &str, bytes: &[u8]) -> (PathBuf, File, u64) {
        let dir = std::env::temp_dir().join(format!("marxy-tar-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.tar"), bytes).unwrap();
        (
            dir.clone(),
            File::open(dir.join("a.tar")).unwrap(),
            bytes.len() as u64,
        )
    }

    fn fixture(name: &str) -> (File, u64) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/archives")
            .join(name);
        let file = File::open(path).unwrap();
        let size = file.metadata().unwrap().len();
        (file, size)
    }

    fn sample() -> Vec<u8> {
        testkit::tar(&[
            (b"docs/", T::Dir, b""),
            (b"docs/a.md", T::File, b"# A\n"),
            (b"b.txt", T::File, b"bee\n"),
            (b"link", T::Symlink("../../etc/passwd"), b""),
            (b"pax", T::Global, b""),
            (b"c.txt", T::File, b"sea\n"),
        ])
    }

    fn check_sample(comp: Option<Comp>, file: &File, size: u64) -> ArchiveListing {
        let l = list(file, comp, size, &Limits::DEFAULT).unwrap();
        let paths: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.index, e.path.as_str(), e.kind.as_str()))
            .collect();
        assert_eq!(
            paths,
            [
                (0, "docs/", "dir"),
                (1, "docs/a.md", "file"),
                (2, "b.txt", "file"),
                (3, "link", "link"),
                (5, "c.txt", "file")
            ]
        );
        assert_eq!(l.entries[1].size, Some(4));
        assert_eq!(l.entries[1].mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(l.entries[3].link.as_deref(), Some("../../etc/passwd"));
        assert_eq!(l.truncated, None);
        assert_eq!(
            read(file, comp, 1, "docs/a.md", &Limits::DEFAULT).unwrap(),
            b"# A\n"
        );
        assert_eq!(
            read(file, comp, 5, "c.txt", &Limits::DEFAULT).unwrap(),
            b"sea\n"
        );
        assert!(
            matches!(read(file, comp, 0, "docs/", &Limits::DEFAULT), Err(Fault::Invalid(m)) if m == "A folder has nothing to open.")
        );
        assert!(
            matches!(read(file, comp, 3, "link", &Limits::DEFAULT), Err(Fault::Invalid(m))
            if m == "link is a link to ../../etc/passwd: links are not followed.")
        );
        assert!(
            matches!(read(file, comp, 2, "nope", &Limits::DEFAULT), Err(Fault::Invalid(m))
            if m == "The archive changed since it was listed.")
        );
        l
    }

    #[test]
    fn a_pax_mtime_wins_and_a_sparse_entry_is_not_a_file() {
        let body = " mtime=1700000100.5
";
        let mut len = body.len() + 1;
        while len.to_string().len() + body.len() != len {
            len = len.to_string().len() + body.len();
        }
        let record = format!("{len}{body}");
        let mut b = ::tar::Builder::new(Vec::new());
        let mut x = ::tar::Header::new_ustar();
        x.set_path("PaxHeader").unwrap();
        x.set_entry_type(::tar::EntryType::XHeader);
        x.set_size(record.len() as u64);
        x.set_cksum();
        b.append(&x, record.as_bytes()).unwrap();
        let mut f = ::tar::Header::new_ustar();
        f.set_path("a.txt").unwrap();
        f.set_size(0);
        f.set_mtime(1_700_000_000);
        f.set_cksum();
        b.append(&f, &b""[..]).unwrap();
        let mut bytes = b.into_inner().unwrap();
        bytes.extend(testkit::tar(&[(b"sparse", testkit::T::Sparse, b"")]));
        let (dir, file, size) = temp("pax-mtime", &bytes);
        let l = list(&file, None, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries[0].mtime.as_deref(), Some("2023-11-14T22:15:00Z"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let sparse = testkit::tar(&[(b"sparse", testkit::T::Sparse, b"")]);
        let (dir, file, size) = temp("sparse", &sparse);
        let l = list(&file, None, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries[0].kind, "other");
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_long_tail_after_the_end_blocks_is_not_unpacked_for_its_length() {
        let mut tar = sample();
        tar.resize(tar.len() + 80 * 1024 * 1024, 0);
        let gz = testkit::gzip(&tar);
        let (dir, file, size) = temp("tail", &gz);
        let l = list(&file, Some(Comp::Gz), size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.unpacked, None);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_plain_tar_a_gzip_tar_and_the_committed_bz2_and_xz_tars_list_and_read() {
        let tar = sample();
        let (dir, file, size) = temp("plain", &tar);
        let l = check_sample(None, &file, size);
        assert_eq!((l.format.as_str(), l.unpacked), ("tar", None));
        drop(file);
        let gz = testkit::gzip(&tar);
        let (dir2, file, size) = temp("gz", &gz);
        let l = check_sample(Some(Comp::Gz), &file, size);
        assert_eq!(l.unpacked, Some(tar.len() as u64));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    #[test]
    fn the_committed_bz2_and_xz_tars_list_and_read() {
        for (name, comp, format) in [
            ("sample.tar.bz2", Comp::Bz2, "tar.bz2"),
            ("sample.tar.xz", Comp::Xz, "tar.xz"),
        ] {
            let (file, size) = fixture(name);
            assert_eq!(
                crate::archive::detect(&file, size).unwrap(),
                Some(Format::Tar(Some(comp))),
                "{name}"
            );
            let l = list(&file, Some(comp), size, &Limits::DEFAULT).unwrap();
            let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
            assert_eq!(paths, ["docs/", "docs/a.md", "b.txt"], "{name}");
            assert_eq!(l.format, format);
            assert!(l.unpacked.unwrap() >= 1536, "{name}");
            assert_eq!(
                read(&file, Some(comp), 1, "docs/a.md", &Limits::DEFAULT).unwrap(),
                b"# A\n"
            );
            assert_eq!(
                read(&file, Some(comp), 2, "b.txt", &Limits::DEFAULT).unwrap(),
                b"bee\n"
            );
        }
    }

    #[test]
    fn hostile_names_list_as_plain_relative_paths_and_read_back_by_index() {
        let names: [&[u8]; 4] = [
            b"../../evil.txt",
            b"/etc/passwd",
            b"C:\\Windows\\win.ini",
            b"a/../../b.txt",
        ];
        let want = ["evil.txt", "etc/passwd", "Windows/win.ini", "a/b.txt"];
        let entries: Vec<_> = names.iter().map(|n| (*n, T::File, *n)).collect();
        let bytes = testkit::tar(&entries);
        for (label, comp, bytes) in [
            ("h-plain", None, bytes.clone()),
            ("h-gz", Some(Comp::Gz), testkit::gzip(&bytes)),
        ] {
            let (dir, file, size) = temp(label, &bytes);
            let l = list(&file, comp, size, &Limits::DEFAULT).unwrap();
            for (i, e) in l.entries.iter().enumerate() {
                assert_eq!(e.path, want[i]);
                assert_eq!(
                    e.raw_name.as_deref(),
                    Some(std::str::from_utf8(names[i]).unwrap())
                );
                assert_eq!(
                    read(&file, comp, i as u32, &e.path, &Limits::DEFAULT).unwrap(),
                    names[i]
                );
            }
            drop(file);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn the_caps_stop_the_listing_and_say_so() {
        let mut entries: Vec<(&[u8], T, &[u8])> = (0..5)
            .map(|_| (&b"f.txt"[..], T::File, &b"x"[..]))
            .collect();
        entries.push((b"a/b/c/d/e/f.txt", T::File, b"x"));
        entries.push((b"a-name-that-is-long-enough.txt", T::File, b"x"));
        let bytes = testkit::tar(&entries);
        let (dir, file, size) = temp("caps", &bytes);
        let l = list(
            &file,
            None,
            size,
            &Limits {
                entries: 3,
                ..Limits::DEFAULT
            },
        )
        .unwrap();
        assert_eq!(l.entries.len(), 3);
        assert_eq!(
            l.truncated.as_deref(),
            Some("Listed the first 3 entries; more follow.")
        );
        let l = list(
            &file,
            None,
            size,
            &Limits {
                entries: 7,
                ..Limits::DEFAULT
            },
        )
        .unwrap();
        assert_eq!((l.entries.len(), l.truncated), (7, None));
        let l = list(
            &file,
            None,
            size,
            &Limits {
                depth: 3,
                name_bytes: 20,
                ..Limits::DEFAULT
            },
        )
        .unwrap();
        assert_eq!((l.entries.len(), l.skipped), (5, 2));
        let l = list(
            &file,
            None,
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

    #[test]
    fn a_compressed_walk_stops_at_the_stream_cap_and_a_read_past_it_is_refused() {
        let zeros = vec![0u8; 300_000];
        let tar = testkit::tar(&[
            (b"a.txt", T::File, b"small"),
            (b"big.bin", T::File, &zeros),
            (b"z.txt", T::File, b"late"),
        ]);
        let gz = testkit::gzip(&tar);
        let (dir, file, size) = temp("stream", &gz);
        let tight = Limits {
            stream: 100_000,
            ..Limits::DEFAULT
        };
        let l = list(&file, Some(Comp::Gz), size, &tight).unwrap();
        assert_eq!(l.entries.len(), 2);
        assert_eq!(
            l.truncated.as_deref(),
            Some("Listed the first 2 entries: the walk stops after 1 GB of unpacked stream.")
        );
        assert_eq!(l.unpacked, None);
        match read(&file, Some(Comp::Gz), 2, "z.txt", &tight).unwrap_err() {
            Fault::Refused(m) => assert_eq!(
                m,
                "z.txt lies past the first 1 GB of the unpacked stream, further than the app walks."
            ),
            other => panic!("{other:?}"),
        }
        assert_eq!(
            read(&file, Some(Comp::Gz), 0, "a.txt", &tight).unwrap(),
            b"small"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_entry_over_the_cap_is_refused_by_declaration_and_a_short_one_is_damaged() {
        let big = vec![7u8; 5_000];
        let tar = testkit::tar(&[(b"big.bin", T::File, &big)]);
        let (dir, file, size) = temp("entry-cap", &tar);
        let tight = Limits {
            entry: 1_000,
            ..Limits::DEFAULT
        };
        assert!(
            matches!(read(&file, None, 0, "big.bin", &tight), Err(Fault::Refused(m))
            if m == "big.bin is 4.9 KB unpacked, over the 16 MB an entry may open with.")
        );
        assert_eq!(
            read(&file, None, 0, "big.bin", &Limits::DEFAULT).unwrap(),
            big
        );
        drop(file);
        let cut = &tar[..512 + 1_000];
        let (dir2, file, _) = temp("short", cut);
        assert!(
            matches!(read(&file, None, 0, "big.bin", &Limits::DEFAULT), Err(Fault::Invalid(m))
            if m == "big.bin could not be read: the archive is damaged.")
        );
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
        let _ = size;
    }

    /// A tar whose first member is an extension header of `kind` carrying `data`, then `a.txt`.
    fn with_extension(kind: ::tar::EntryType, data: &[u8]) -> Vec<u8> {
        let mut b = ::tar::Builder::new(Vec::new());
        let mut h = ::tar::Header::new_gnu();
        h.as_old_mut().name[..13].copy_from_slice(b"././@LongLink");
        h.set_mode(0o644);
        h.set_size(data.len() as u64);
        h.set_entry_type(kind);
        h.set_cksum();
        b.append(&h, data).unwrap();
        let mut f = ::tar::Header::new_gnu();
        f.as_old_mut().name[..5].copy_from_slice(b"a.txt");
        f.set_mode(0o644);
        f.set_size(3);
        f.set_entry_type(::tar::EntryType::Regular);
        f.set_cksum();
        b.append(&f, &b"aaa"[..]).unwrap();
        b.into_inner().unwrap()
    }

    /// The tar crate reads a long name or PAX header whole before the entry it names: an 8 MB one in a 9 KB tar.gz is
    /// refused when its header passes, before the crate allocates for it, plain or compressed. A small one still names.
    #[test]
    fn a_long_name_or_pax_header_over_1_mb_is_refused_before_the_crate_reads_it() {
        use ::tar::EntryType;
        let huge = vec![b'a'; 8 * 1024 * 1024];
        for kind in [
            EntryType::GNULongName,
            EntryType::GNULongLink,
            EntryType::XHeader,
        ] {
            let tar = with_extension(kind, &huge);
            let gz = testkit::gzip(&tar);
            assert!(gz.len() < 64 * 1024, "{} bytes", gz.len());
            for (comp, bytes) in [(None, &tar), (Some(Comp::Gz), &gz)] {
                let (dir, file, size) = temp("long-header", bytes);
                let l = list(&file, comp, size, &Limits::DEFAULT).unwrap();
                assert!(l.entries.is_empty(), "{kind:?} {comp:?}");
                assert_eq!(
                    l.truncated.as_deref(),
                    Some(
                        "Listed the first 0 entries: the next has a name or extension header of 8.0 MB, \
                         past the 1 MB the app reads."
                    ),
                    "{kind:?} {comp:?}"
                );
                match read(&file, comp, 0, "a.txt", &Limits::DEFAULT).unwrap_err() {
                    Fault::Refused(m) => assert_eq!(
                        m,
                        "a.txt has a name or extension header of 8.0 MB, past the 1 MB the app reads."
                    ),
                    other => panic!("{kind:?} {comp:?}: {other:?}"),
                }
                drop(file);
                let _ = std::fs::remove_dir_all(dir);
            }
        }
        let mut name = vec![b'n'; 600];
        name.extend_from_slice(b".txt\0");
        let tar = with_extension(EntryType::GNULongName, &name);
        let (dir, file, size) = temp("long-name-ok", &tar);
        let l = list(&file, None, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.truncated, None);
        assert_eq!(l.entries.len(), 1);
        assert_eq!(l.entries[0].path.len(), 604);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_header_check_reads_octal_and_base_256_sizes() {
        assert_eq!(tar_number(b"0000644\0"), Some(0o644));
        assert_eq!(tar_number(b" 17777777777\0"), Some(0o17777777777));
        let mut big = [0u8; 12];
        big[0] = 0x80;
        big[7] = 1;
        assert_eq!(tar_number(&big), Some(1 << 32));
        assert_eq!(tar_number(&[0xff; 12]), Some(u64::MAX));
    }

    #[test]
    fn a_damaged_tar_lists_what_came_before_the_damage() {
        let mut tar = testkit::tar(&[(b"a.txt", T::File, b"x"), (b"b.txt", T::File, b"y")]);
        tar[1024 + 148] = b'Z';
        let (dir, file, size) = temp("damaged", &tar);
        let l = list(&file, None, size, &Limits::DEFAULT).unwrap();
        assert_eq!(l.entries.len(), 1);
        assert!(l
            .truncated
            .unwrap()
            .starts_with("The listing stopped at a damaged part: "));
        drop(file);
        let mut first = tar.clone();
        first[148] = b'Z';
        let (dir2, file, size) = temp("damaged-first", &first);
        assert!(matches!(
            list(&file, None, size, &Limits::DEFAULT),
            Err(Fault::Invalid(m)) if m.starts_with("The listing could not be read: ")
        ));
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    /// A plain tar's slot is where its entry begins, extension headers first: a long-named entry's header lies past its
    /// start, and a read or a head seeks to the start and finds the entry listed there.
    #[test]
    fn a_plain_tar_seeks_to_where_each_entry_begins() {
        let mut name = vec![b'n'; 600];
        name.extend_from_slice(b".txt\0");
        let mut tar = with_extension(::tar::EntryType::GNULongName, &name);
        // The end blocks go, and one more entry follows the long-named one.
        tar.truncate(tar.len() - 1024);
        tar.extend(testkit::tar(&[(b"z.txt", T::File, b"zed")]));
        let (dir, file, size) = temp("seek", &tar);
        let (l, slots) = list_slots(&file, None, size, &Limits::DEFAULT).unwrap();
        let long = format!("{}.txt", "n".repeat(600));
        let paths: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, [long.as_str(), "z.txt"]);
        let starts: Vec<_> = slots.iter().map(|s| s.start).collect();
        assert_eq!(starts, [Some(0), Some(2560)]);
        let offsets: Vec<_> = l.entries.iter().map(|e| e.offset).collect();
        assert_eq!(
            offsets,
            [Some(1536), Some(2560)],
            "the long name's own header and data come first"
        );
        assert_eq!(l.entries[0].mode, Some(0o644));
        let before = WALKS.with(|w| w.get());
        assert_eq!(
            read_plain(&file, &slots, 1, "z.txt", &Limits::DEFAULT).unwrap(),
            b"zed"
        );
        assert_eq!(
            read_plain(&file, &slots, 0, &long, &Limits::DEFAULT).unwrap(),
            b"aaa"
        );
        assert!(matches!(
            read_plain(&file, &slots, 1, "a.txt", &Limits::DEFAULT),
            Err(Fault::Invalid(m)) if m == "The archive changed since it was listed."
        ));
        let wants = [
            Want {
                index: 1,
                name: "z.txt".into(),
            },
            Want {
                index: 0,
                name: long.clone(),
            },
        ];
        let got = heads(&file, None, Some(&slots), &wants, 2, &Limits::DEFAULT).unwrap();
        assert_eq!(got[0].bytes, b"ze");
        assert_eq!(got[1].bytes, b"aa");
        assert_eq!(
            WALKS.with(|w| w.get()),
            before,
            "a plain tar is never unpacked"
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_head_past_the_stream_cap_says_so_and_heads_before_it_are_read() {
        let zeros = vec![0u8; 300_000];
        let tar = testkit::tar(&[
            (b"a.txt", T::File, b"small"),
            (b"big.bin", T::File, &zeros),
            (b"z.txt", T::File, b"late"),
        ]);
        let gz = testkit::gzip(&tar);
        let (dir, file, _) = temp("stream-heads", &gz);
        let tight = Limits {
            stream: 100_000,
            ..Limits::DEFAULT
        };
        let wants = [
            Want {
                index: 2,
                name: "z.txt".into(),
            },
            Want {
                index: 0,
                name: "a.txt".into(),
            },
        ];
        let got = heads(&file, Some(Comp::Gz), None, &wants, 64, &tight).unwrap();
        assert_eq!(
            got[0].refused.as_deref(),
            Some("z.txt lies past the first 1 GB of the unpacked stream, further than the app walks.")
        );
        assert_eq!(
            (got[1].bytes.as_slice(), got[1].whole),
            (&b"small"[..], true)
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
