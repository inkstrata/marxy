//! A 7z's signature header and header read only as far as their declared counts, before `sevenz-rust2` parses them.
//! The crate sizes its tables from those counts before it returns (about 112 bytes for each entry, more for each
//! block), and a count is bounded only by the header's length, which an LZMA-packed header makes cheap: so an archive
//! declaring more than `MAX_DECLARED` entries or `MAX_BLOCKS` blocks or packed streams is refused here. A header packed
//! with anything but one copy, LZMA or LZMA2 coder is refused too, since the crate would unpack a filter chain and
//! parse it uncounted; so is a signature header whose CRC is zero or wrong, which sends the crate searching the file's
//! last megabyte for a header.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use sevenz_rust2::EncoderMethod;

use super::{commas, Fault};

/// The most entries a 7z may declare: ten times what a listing shows.
pub const MAX_DECLARED: u64 = 1_000_000;

/// The most blocks, and the most packed streams, a 7z may declare: the crate keeps well over a hundred bytes for each,
/// and no more than the 100,000 entries a listing shows could need more than twice that.
pub const MAX_BLOCKS: u64 = 200_000;

/// The most a header may hold unpacked, and the largest dictionary its own decoder may use.
pub const HEADER_BYTES: u64 = 16 * 1024 * 1024;

/// The most coders, and streams in or out of one coder, a block may have; the crate's own limit.
const MAX_CODERS: u64 = 64;

pub fn damaged_list() -> Fault {
    Fault::Invalid("The listing could not be read: the archive is damaged.".into())
}

pub fn encrypted_list() -> Fault {
    Fault::Unsupported(
        "This 7z archive's list of entries is encrypted. The app does not ask for archive passwords.".into(),
    )
}

/// A method as the page says it, from the crate's name for it.
pub fn method_words(name: &str) -> String {
    match name {
        "COPY" => "copy",
        "LZMA" => "LZMA",
        "LZMA2" => "LZMA2",
        "DELTA" => "Delta",
        "BCJ_X86" => "BCJ",
        "BCJ2" => "BCJ2",
        "BCJ_PPC" => "BCJ PowerPC",
        "BCJ_IA64" => "BCJ IA-64",
        "BCJ_ARM" => "BCJ ARM",
        "BCJ_ARM64" => "BCJ ARM64",
        "BCJ_ARM_THUMB" => "BCJ ARM Thumb",
        "BCJ_SPARC" => "BCJ SPARC",
        "BCJ_RISCV" => "BCJ RISC-V",
        "PPMD" => "PPMd",
        "BZIP2" => "bzip2",
        "DEFLATE" => "Deflate",
        "DEFLATE64" => "Deflate64",
        "ZSTD" => "Zstandard",
        "BROTLI" => "Brotli",
        "LZ4" => "LZ4",
        "LZS" => "LZS",
        "LIZARD" => "Lizard",
        "AES256_SHA256" => "AES",
        _ => "an unknown method",
    }
    .into()
}

/// A method as the page says it, from its id.
pub fn method_of(id: &[u8]) -> String {
    method_words(EncoderMethod::by_id(id).map_or("", |m| m.name()))
}

pub fn header_too_big() -> Fault {
    Fault::Refused(
        "This 7z archive's list of entries needs more than the 16 MB the app gives it.".into(),
    )
}

/// LZMA's dictionary size, from its five property bytes.
pub fn lzma_dictionary(props: &[u8]) -> Option<u64> {
    let b: [u8; 4] = props.get(1..5)?.try_into().ok()?;
    Some(u64::from(u32::from_le_bytes(b)))
}

/// LZMA2's dictionary size, from its one property byte.
pub fn lzma2_dictionary(props: &[u8]) -> Option<u64> {
    let b = u64::from(*props.first()?);
    match b {
        0..=39 => Some((2 | (b & 1)) << (b / 2 + 11)),
        40 => Some(u64::from(u32::MAX)),
        _ => None,
    }
}

enum Stop {
    Damaged,
    TooMany(u64, u64, &'static str),
}

impl Stop {
    fn fault(self) -> Fault {
        match self {
            Stop::Damaged => damaged_list(),
            Stop::TooMany(n, cap, what) => Fault::Refused(format!(
                "This 7z archive declares {} {what}, more than the {} the app reads.",
                commas(n),
                commas(cap)
            )),
        }
    }
}

type Parsed<T> = Result<T, Stop>;

struct Cur<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Cur<'a> {
    fn byte(&mut self) -> Parsed<u8> {
        let v = *self.b.get(self.at).ok_or(Stop::Damaged)?;
        self.at += 1;
        Ok(v)
    }

    fn take(&mut self, n: u64) -> Parsed<&'a [u8]> {
        let n = usize::try_from(n).map_err(|_| Stop::Damaged)?;
        let end = self.at.checked_add(n).ok_or(Stop::Damaged)?;
        let v = self.b.get(self.at..end).ok_or(Stop::Damaged)?;
        self.at = end;
        Ok(v)
    }

    /// A 7z NUMBER: the leading one bits of the first byte say how many little-endian bytes follow.
    fn number(&mut self) -> Parsed<u64> {
        let first = self.byte()?;
        let mut value = 0u64;
        for i in 0..8u32 {
            let mask = 0x80u8 >> i;
            if first & mask == 0 {
                let high = u64::from(first & mask.wrapping_sub(1));
                return Ok(value | (high << (8 * i)));
            }
            value |= u64::from(self.byte()?) << (8 * i);
        }
        Ok(value)
    }

    fn count(&mut self, cap: u64, what: &'static str) -> Parsed<u64> {
        let n = self.number()?;
        if n > cap {
            return Err(Stop::TooMany(n, cap, what));
        }
        Ok(n)
    }

    fn expect(&mut self, id: u8) -> Parsed<()> {
        if self.byte()? == id {
            Ok(())
        } else {
            Err(Stop::Damaged)
        }
    }

    /// A digest list for `n` items: which are defined, and their CRCs skipped.
    fn defined(&mut self, n: u64) -> Parsed<Vec<bool>> {
        let all = self.byte()?;
        let flags: Vec<bool> = if all != 0 {
            vec![true; n as usize]
        } else {
            let bits = self.take(n.div_ceil(8))?;
            (0..n as usize)
                .map(|i| bits[i / 8] & (0x80 >> (i % 8)) != 0)
                .collect()
        };
        let crcs = flags.iter().filter(|&&f| f).count() as u64;
        self.take(4 * crcs)?;
        Ok(flags)
    }
}

/// One coder of the first block: its method and properties.
type Coder = (Vec<u8>, Vec<u8>);

#[derive(Default)]
struct Streams {
    pack_pos: u64,
    pack_sizes: Vec<u64>,
    /// Output streams of each block, and whether the block has its own CRC.
    outs: Vec<u64>,
    crcs: Vec<bool>,
    /// The first block's coders and its unpacked sizes, which an encoded header is decoded with.
    first: Vec<Coder>,
    first_sizes: Vec<u64>,
}

fn block(c: &mut Cur, keep: bool) -> Parsed<(Vec<Coder>, u64)> {
    let n = c.number()?;
    if n == 0 || n > MAX_CODERS {
        return Err(Stop::Damaged);
    }
    let (mut ins, mut outs) = (0u64, 0u64);
    let mut coders = Vec::new();
    for _ in 0..n {
        let flag = c.byte()?;
        if flag & 0x80 != 0 {
            return Err(Stop::Damaged);
        }
        let id = c.take(u64::from(flag & 0x0F))?;
        let (i, o) = if flag & 0x10 != 0 {
            (c.number()?, c.number()?)
        } else {
            (1, 1)
        };
        if i > MAX_CODERS || o > MAX_CODERS {
            return Err(Stop::Damaged);
        }
        let props = if flag & 0x20 != 0 {
            let size = c.number()?;
            c.take(size)?
        } else {
            &[]
        };
        if keep {
            coders.push((id.to_vec(), props.to_vec()));
        }
        ins += i;
        outs += o;
    }
    if outs == 0 || outs - 1 > ins {
        return Err(Stop::Damaged);
    }
    let pairs = outs - 1;
    for _ in 0..pairs {
        c.number()?;
        c.number()?;
    }
    let packed = ins - pairs;
    if packed > 1 {
        for _ in 0..packed {
            c.number()?;
        }
    }
    Ok((coders, outs))
}

fn streams(c: &mut Cur) -> Parsed<Streams> {
    let mut s = Streams::default();
    loop {
        match c.byte()? {
            0x00 => return Ok(s),
            0x06 => {
                s.pack_pos = c.number()?;
                let n = c.count(MAX_BLOCKS, "packed streams")?;
                loop {
                    match c.byte()? {
                        0x00 => break,
                        0x09 => {
                            s.pack_sizes = (0..n).map(|_| c.number()).collect::<Parsed<_>>()?;
                        }
                        0x0A => {
                            c.defined(n)?;
                        }
                        _ => return Err(Stop::Damaged),
                    }
                }
            }
            0x07 => {
                c.expect(0x0B)?;
                let n = c.count(MAX_BLOCKS, "blocks")?;
                if c.byte()? != 0 {
                    return Err(Stop::Damaged);
                }
                for i in 0..n {
                    let (coders, outs) = block(c, i == 0)?;
                    if i == 0 {
                        s.first = coders;
                    }
                    s.outs.push(outs);
                }
                c.expect(0x0C)?;
                for (i, &outs) in s.outs.iter().enumerate() {
                    for _ in 0..outs {
                        let size = c.number()?;
                        if i == 0 {
                            s.first_sizes.push(size);
                        }
                    }
                }
                s.crcs = vec![false; s.outs.len()];
                loop {
                    match c.byte()? {
                        0x00 => break,
                        0x0A => s.crcs = c.defined(n)?,
                        _ => return Err(Stop::Damaged),
                    }
                }
            }
            0x08 => {
                let mut per = vec![1u64; s.outs.len()];
                let mut id = c.byte()?;
                if id == 0x0D {
                    let mut total = 0u64;
                    for p in per.iter_mut() {
                        *p = c.number()?;
                        total = total.saturating_add(*p);
                    }
                    if total > MAX_DECLARED {
                        return Err(Stop::TooMany(total, MAX_DECLARED, "entries"));
                    }
                    id = c.byte()?;
                }
                if id == 0x09 {
                    for &p in &per {
                        for _ in 1..p {
                            c.number()?;
                        }
                    }
                    id = c.byte()?;
                }
                if id == 0x0A {
                    let digests = per
                        .iter()
                        .zip(&s.crcs)
                        .map(|(&p, &crc)| if p == 1 && crc { 0 } else { p })
                        .sum();
                    c.defined(digests)?;
                    id = c.byte()?;
                }
                if id != 0x00 {
                    return Err(Stop::Damaged);
                }
            }
            _ => return Err(Stop::Damaged),
        }
    }
}

/// The entries a decoded header declares, checking every count on the way.
fn declared(h: &[u8]) -> Parsed<u64> {
    let mut c = Cur { b: h, at: 0 };
    c.expect(0x01)?;
    let mut id = c.byte()?;
    if id == 0x02 {
        loop {
            if c.byte()? == 0 {
                break;
            }
            let size = c.number()?;
            c.take(size)?;
        }
        id = c.byte()?;
    }
    if id == 0x03 {
        // Additional streams: the crate refuses them before it sizes anything.
        return Ok(0);
    }
    if id == 0x04 {
        streams(&mut c)?;
        id = c.byte()?;
    }
    if id == 0x05 {
        return c.count(MAX_DECLARED, "entries");
    }
    Ok(0)
}

fn read_at(file: &File, at: u64, len: u64) -> Option<Vec<u8>> {
    let mut f = file;
    f.seek(SeekFrom::Start(at)).ok()?;
    let mut out = Vec::new();
    f.take(len).read_to_end(&mut out).ok()?;
    (out.len() as u64 == len).then_some(out)
}

fn unread_list(id: &[u8]) -> Fault {
    Fault::Unsupported(format!(
        "This 7z archive's list of entries is compressed with {}, which the app does not read.",
        method_of(id)
    ))
}

fn chained_list(chain: &[Coder]) -> Fault {
    let words: Vec<String> = chain.iter().map(|(id, _)| method_of(id)).collect();
    Fault::Unsupported(format!(
        "This 7z archive's list of entries is packed with {}: the app reads a list of entries packed \
         with one of copy, LZMA or LZMA2 only.",
        words.join(" over ")
    ))
}

/// An encoded header unpacked. Its block must be one copy, LZMA or LZMA2 coder, as 7-Zip writes it; anything else is
/// refused here, encryption and methods the crate would also refuse included, so no header goes uncounted.
fn unpack_header(file: &File, size: u64, s: &Streams) -> Result<Vec<u8>, Fault> {
    let readable = [
        EncoderMethod::ID_COPY,
        EncoderMethod::ID_LZMA,
        EncoderMethod::ID_LZMA2,
    ];
    if s.first
        .iter()
        .any(|(id, _)| id == EncoderMethod::ID_AES256_SHA256)
    {
        return Err(encrypted_list());
    }
    let (id, props) = match s.first.as_slice() {
        [] => return Err(damaged_list()),
        [(id, props)] if readable.contains(&id.as_slice()) => (id, props),
        [(id, _)] => return Err(unread_list(id)),
        chain => return Err(chained_list(chain)),
    };
    let unpacked = *s.first_sizes.first().ok_or_else(damaged_list)?;
    if unpacked > HEADER_BYTES {
        return Err(header_too_big());
    }
    let packed = *s.pack_sizes.first().ok_or_else(damaged_list)?;
    let at = s.pack_pos.checked_add(32).ok_or_else(damaged_list)?;
    if at.checked_add(packed).is_none_or(|end| end > size) {
        return Err(damaged_list());
    }
    let mut f = file;
    f.seek(SeekFrom::Start(at))?;
    let src = f.take(packed);
    let mut reader: Box<dyn Read> = if id == EncoderMethod::ID_COPY {
        Box::new(src)
    } else if id == EncoderMethod::ID_LZMA {
        let dict = lzma_dictionary(props).ok_or_else(damaged_list)?;
        if dict > HEADER_BYTES {
            return Err(header_too_big());
        }
        Box::new(
            lzma_rust2::LzmaReader::new_with_props(src, unpacked, props[0], dict as u32, None)
                .map_err(|_| damaged_list())?,
        )
    } else {
        let dict = lzma2_dictionary(props).ok_or_else(damaged_list)?;
        if dict > HEADER_BYTES {
            return Err(header_too_big());
        }
        Box::new(lzma_rust2::Lzma2Reader::new(src, dict as u32, None))
    };
    let mut out = Vec::new();
    (&mut reader)
        .take(unpacked)
        .read_to_end(&mut out)
        .map_err(|_| damaged_list())?;
    if out.len() as u64 != unpacked {
        return Err(damaged_list());
    }
    Ok(out)
}

/// Checks a 7z's signature header and the counts its header declares, before the crate parses either.
pub fn check(file: &File, size: u64) -> Result<(), Fault> {
    let start = read_at(file, 0, 32).ok_or_else(damaged_list)?;
    let crc = u32::from_le_bytes(start[8..12].try_into().map_err(|_| damaged_list())?);
    if crc == 0 || crc != crc32fast::hash(&start[12..32]) {
        return Err(damaged_list());
    }
    let off = u64::from_le_bytes(start[12..20].try_into().map_err(|_| damaged_list())?);
    let len = u64::from_le_bytes(start[20..28].try_into().map_err(|_| damaged_list())?);
    if len == 0 {
        return Ok(());
    }
    if len > HEADER_BYTES {
        return Err(header_too_big());
    }
    let at = off.checked_add(32).ok_or_else(damaged_list)?;
    if at.checked_add(len).is_none_or(|end| end > size) {
        return Err(damaged_list());
    }
    let next = read_at(file, at, len).ok_or_else(damaged_list)?;
    if crc32fast::hash(&next)
        != u32::from_le_bytes(start[28..32].try_into().map_err(|_| damaged_list())?)
    {
        return Err(damaged_list());
    }
    let header = match next[0] {
        0x01 => next,
        0x17 => {
            let mut c = Cur { b: &next, at: 1 };
            let s = streams(&mut c).map_err(Stop::fault)?;
            unpack_header(file, size, &s)?
        }
        _ => return Err(damaged_list()),
    };
    declared(&header).map(|_| ()).map_err(Stop::fault)
}
