//! A bounded reader of TIFF structure: the header, IFDs and their values, read by seeking, never the strips. It serves
//! TIFF and camera RAW files on disk and the EXIF block of a JPEG, PNG, WebP or HEIF held in memory.

use std::io::{self, Read, Seek, SeekFrom};

/// The most entries one IFD may claim; a real one has a few dozen.
const MAX_ENTRIES: u16 = 1024;
/// The most bytes one value is read as (an ICC profile is the largest that is read).
pub const MAX_VALUE_BYTES: u32 = 4 * 1024 * 1024;

pub const IMAGE_WIDTH: u16 = 0x0100;
pub const IMAGE_LENGTH: u16 = 0x0101;
pub const BITS_PER_SAMPLE: u16 = 0x0102;
pub const COMPRESSION: u16 = 0x0103;
pub const PHOTOMETRIC: u16 = 0x0106;
pub const STRIP_OFFSETS: u16 = 0x0111;
pub const ORIENTATION: u16 = 0x0112;
pub const SAMPLES_PER_PIXEL: u16 = 0x0115;
pub const STRIP_BYTE_COUNTS: u16 = 0x0117;
pub const SUB_IFDS: u16 = 0x014A;
pub const EXTRA_SAMPLES: u16 = 0x0152;
pub const JPEG_OFFSET: u16 = 0x0201;
pub const JPEG_LENGTH: u16 = 0x0202;
pub const ICC_PROFILE: u16 = 0x8773;
pub const EXIF_IFD: u16 = 0x8769;
pub const GPS_IFD: u16 = 0x8825;
/// Panasonic's RW2 keeps its full-size preview JPEG in this tag of IFD0.
pub const JPG_FROM_RAW: u16 = 0x002E;

#[derive(Debug, Clone, Copy)]
pub struct Entry {
    pub tag: u16,
    pub kind: u16,
    pub count: u32,
    /// The value itself when it fits in four bytes, else its offset, as stored.
    raw: [u8; 4],
}

#[derive(Debug, Default)]
pub struct Ifd {
    pub entries: Vec<Entry>,
    pub next: u32,
}

impl Ifd {
    pub fn get(&self, tag: u16) -> Option<&Entry> {
        self.entries.iter().find(|e| e.tag == tag)
    }
}

fn kind_size(kind: u16) -> Option<u32> {
    Some(match kind {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 => 8,
        _ => return None,
    })
}

pub struct Tiff<R> {
    r: R,
    /// Where the header starts in `r`: offsets in the file are from here.
    base: u64,
    pub little: bool,
    pub first: u32,
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_owned())
}

impl<R: Read + Seek> Tiff<R> {
    /// The TIFF whose header is at `base`: `II` or `MM`, then 42, or Olympus' `RO` / Panasonic's 0x55 for their RAW.
    /// None when the bytes there are not one.
    pub fn new(mut r: R, base: u64) -> io::Result<Option<Self>> {
        let mut head = [0u8; 8];
        r.seek(SeekFrom::Start(base))?;
        if r.read_exact(&mut head).is_err() {
            return Ok(None);
        }
        let little = match &head[..2] {
            b"II" => true,
            b"MM" => false,
            _ => return Ok(None),
        };
        let u16_at = |b: [u8; 2]| {
            if little {
                u16::from_le_bytes(b)
            } else {
                u16::from_be_bytes(b)
            }
        };
        let magic = u16_at([head[2], head[3]]);
        if !matches!(magic, 42 | 0x4F52 | 0x5352 | 0x55) {
            return Ok(None);
        }
        let b = [head[4], head[5], head[6], head[7]];
        let first = if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        };
        Ok(Some(Tiff {
            r,
            base,
            little,
            first,
        }))
    }

    fn u16(&self, b: [u8; 2]) -> u16 {
        if self.little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        }
    }

    fn u32(&self, b: [u8; 4]) -> u32 {
        if self.little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        }
    }

    /// The IFD at `offset` (from the header).
    pub fn ifd(&mut self, offset: u32) -> io::Result<Ifd> {
        if offset < 8 {
            return Err(invalid("an IFD inside the header"));
        }
        self.r.seek(SeekFrom::Start(self.base + offset as u64))?;
        let mut n = [0u8; 2];
        self.r.read_exact(&mut n)?;
        let n = self.u16(n);
        if n == 0 || n > MAX_ENTRIES {
            return Err(invalid("an IFD with no entries or too many"));
        }
        let mut bytes = vec![0u8; n as usize * 12 + 4];
        self.r.read_exact(&mut bytes)?;
        let entries = bytes[..n as usize * 12]
            .as_chunks::<12>()
            .0
            .iter()
            .map(|e| Entry {
                tag: self.u16([e[0], e[1]]),
                kind: self.u16([e[2], e[3]]),
                count: self.u32([e[4], e[5], e[6], e[7]]),
                raw: [e[8], e[9], e[10], e[11]],
            })
            .collect();
        let t = &bytes[n as usize * 12..];
        Ok(Ifd {
            entries,
            next: self.u32([t[0], t[1], t[2], t[3]]),
        })
    }

    /// The IFDs of the chain from `offset`, at most `max`, stopping at a loop or a bad one.
    pub fn chain(&mut self, mut offset: u32, max: usize) -> Vec<Ifd> {
        let mut seen = Vec::new();
        let mut out = Vec::new();
        while offset != 0 && out.len() < max && !seen.contains(&offset) {
            seen.push(offset);
            let Ok(ifd) = self.ifd(offset) else { break };
            offset = ifd.next;
            out.push(ifd);
        }
        out
    }

    /// The entry's value bytes, as stored; refused past `MAX_VALUE_BYTES`.
    pub fn bytes(&mut self, e: &Entry) -> io::Result<Vec<u8>> {
        let size = kind_size(e.kind).ok_or_else(|| invalid("an unknown field type"))?;
        let len = size
            .checked_mul(e.count)
            .filter(|&l| l <= MAX_VALUE_BYTES)
            .ok_or_else(|| invalid("a value too large to read"))?;
        if len <= 4 {
            return Ok(e.raw[..len as usize].to_vec());
        }
        let offset = self.u32(e.raw);
        self.r.seek(SeekFrom::Start(self.base + offset as u64))?;
        let mut out = vec![0u8; len as usize];
        self.r.read_exact(&mut out)?;
        Ok(out)
    }

    /// The entry's values as unsigned integers (BYTE, SHORT, LONG, IFD).
    pub fn uints(&mut self, e: &Entry) -> Vec<u32> {
        let Ok(b) = self.bytes(e) else {
            return Vec::new();
        };
        match e.kind {
            1 | 7 => b.iter().map(|&v| v as u32).collect(),
            3 => b
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| self.u16([c[0], c[1]]) as u32)
                .collect(),
            4 | 13 => b
                .as_chunks::<4>()
                .0
                .iter()
                .map(|c| self.u32([c[0], c[1], c[2], c[3]]))
                .collect(),
            _ => Vec::new(),
        }
    }

    pub fn uint(&mut self, e: &Entry) -> Option<u32> {
        self.uints(e).first().copied()
    }

    /// The first value of `tag` in `ifd` as an unsigned integer.
    pub fn uint_of(&mut self, ifd: &Ifd, tag: u16) -> Option<u32> {
        let e = *ifd.get(tag)?;
        self.uint(&e)
    }

    /// The entry's values as numbers (RATIONAL, SRATIONAL, and the integer types).
    pub fn numbers(&mut self, e: &Entry) -> Vec<f64> {
        match e.kind {
            5 | 10 => {
                let Ok(b) = self.bytes(e) else {
                    return Vec::new();
                };
                b.as_chunks::<8>()
                    .0
                    .iter()
                    .map(|c| {
                        let (n, d) = (
                            self.u32([c[0], c[1], c[2], c[3]]),
                            self.u32([c[4], c[5], c[6], c[7]]),
                        );
                        let (n, d) = if e.kind == 10 {
                            (n as i32 as f64, d as i32 as f64)
                        } else {
                            (n as f64, d as f64)
                        };
                        if d == 0.0 {
                            f64::NAN
                        } else {
                            n / d
                        }
                    })
                    .collect()
            }
            _ => self.uints(e).into_iter().map(f64::from).collect(),
        }
    }

    /// The entry as text: ASCII (or UNDEFINED) up to its first NUL, trimmed; None when empty.
    pub fn text(&mut self, e: &Entry) -> Option<String> {
        if !matches!(e.kind, 1 | 2 | 7) {
            return None;
        }
        let b = self.bytes(e).ok()?;
        let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
        let s = String::from_utf8_lossy(&b[..end]).trim().to_owned();
        (!s.is_empty()).then_some(s)
    }

    pub fn text_of(&mut self, ifd: &Ifd, tag: u16) -> Option<String> {
        let e = *ifd.get(tag)?;
        self.text(&e)
    }

    /// Where the entry's value starts in the underlying reader, and its length in bytes.
    pub fn value_span(&self, e: &Entry) -> Option<(u64, u64)> {
        let len = kind_size(e.kind)? as u64 * e.count as u64;
        (len > 4).then(|| (self.base + self.u32(e.raw) as u64, len))
    }

    /// The offset of the header in the underlying reader.
    pub fn base(&self) -> u64 {
        self.base
    }

    pub fn reader(&mut self) -> &mut R {
        &mut self.r
    }
}

#[cfg(test)]
pub mod build {
    //! A little-endian TIFF writer for tests: IFDs of SHORT, LONG, ASCII, RATIONAL and UNDEFINED values.

    pub enum Value {
        Short(Vec<u16>),
        Long(Vec<u32>),
        Ascii(&'static str),
        Rational(Vec<(u32, u32)>),
        Undefined(Vec<u8>),
        /// LONGs holding the offsets of these IFDs (SubIFDs).
        IfdRefs(Vec<usize>),
        /// A LONG holding the offset of the blob with this index.
        BlobRef(usize),
    }

    /// A TIFF whose header points at `ifds[0]`, followed by the IFDs (each chained to none) and the blobs.
    pub fn write(ifds: &[Vec<(u16, Value)>], blobs: &[&[u8]]) -> Vec<u8> {
        // Two passes: sizes first, so every offset is known before anything is written.
        let ifd_len = |ifd: &Vec<(u16, Value)>| {
            let extra: usize = ifd.iter().map(|(_, v)| padded(external(v))).sum();
            2 + ifd.len() * 12 + 4 + extra
        };
        let mut ifd_at = Vec::new();
        let mut at = 8;
        for ifd in ifds {
            ifd_at.push(at);
            at += ifd_len(ifd);
        }
        let mut blob_at = Vec::new();
        for b in blobs {
            blob_at.push(at);
            at += padded(b.len());
        }
        let mut out = b"II*\0".to_vec();
        out.extend_from_slice(&(ifd_at.first().copied().unwrap_or(0) as u32).to_le_bytes());
        for (i, ifd) in ifds.iter().enumerate() {
            let mut sorted: Vec<&(u16, Value)> = ifd.iter().collect();
            sorted.sort_by_key(|(t, _)| *t);
            let mut data_at = ifd_at[i] + 2 + ifd.len() * 12 + 4;
            let mut data = Vec::new();
            out.extend_from_slice(&(ifd.len() as u16).to_le_bytes());
            for (tag, v) in sorted {
                let (kind, count, bytes) = encode(v, &ifd_at, &blob_at);
                out.extend_from_slice(&tag.to_le_bytes());
                out.extend_from_slice(&kind.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                if bytes.len() <= 4 {
                    let mut b = bytes.clone();
                    b.resize(4, 0);
                    out.extend_from_slice(&b);
                } else {
                    out.extend_from_slice(&(data_at as u32).to_le_bytes());
                    data_at += padded(bytes.len());
                    data.extend_from_slice(&bytes);
                    data.resize(padded(data.len()), 0);
                }
            }
            out.extend_from_slice(&0u32.to_le_bytes());
            out.extend_from_slice(&data);
        }
        for b in blobs {
            out.extend_from_slice(b);
            out.resize(padded(out.len()), 0);
        }
        out
    }

    fn padded(n: usize) -> usize {
        n + (n & 1)
    }

    fn external(v: &Value) -> usize {
        let n = match v {
            Value::Short(s) => s.len() * 2,
            Value::Long(l) => l.len() * 4,
            Value::Ascii(a) => a.len() + 1,
            Value::Rational(r) => r.len() * 8,
            Value::Undefined(u) => u.len(),
            Value::BlobRef(_) => 4,
            Value::IfdRefs(r) => r.len() * 4,
        };
        if n > 4 {
            n
        } else {
            0
        }
    }

    fn encode(v: &Value, ifd_at: &[usize], blob_at: &[usize]) -> (u16, u32, Vec<u8>) {
        match v {
            Value::Short(s) => (
                3,
                s.len() as u32,
                s.iter().flat_map(|x| x.to_le_bytes()).collect(),
            ),
            Value::Long(l) => (
                4,
                l.len() as u32,
                l.iter().flat_map(|x| x.to_le_bytes()).collect(),
            ),
            Value::Ascii(a) => {
                let mut b = a.as_bytes().to_vec();
                b.push(0);
                (2, b.len() as u32, b)
            }
            Value::Rational(r) => (
                5,
                r.len() as u32,
                r.iter()
                    .flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat())
                    .collect(),
            ),
            Value::Undefined(u) => (7, u.len() as u32, u.clone()),
            Value::BlobRef(i) => (4, 1, (blob_at[*i] as u32).to_le_bytes().to_vec()),
            Value::IfdRefs(r) => (
                4,
                r.len() as u32,
                r.iter()
                    .flat_map(|i| (ifd_at[*i] as u32).to_le_bytes())
                    .collect(),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build::{write, Value};
    use super::*;
    use std::io::Cursor;

    #[test]
    fn values_are_read_inline_and_by_offset_and_a_loop_ends_the_chain() {
        let bytes = write(
            &[vec![
                (IMAGE_WIDTH, Value::Long(vec![7])),
                (BITS_PER_SAMPLE, Value::Short(vec![8, 8, 8])),
                (0x010F, Value::Ascii("Marxy")),
                (0x829A, Value::Rational(vec![(1, 250)])),
            ]],
            &[],
        );
        let mut t = Tiff::new(Cursor::new(&bytes[..]), 0).unwrap().unwrap();
        let ifd = t.ifd(t.first).unwrap();
        assert_eq!(t.uint_of(&ifd, IMAGE_WIDTH), Some(7));
        let bps = *ifd.get(BITS_PER_SAMPLE).unwrap();
        assert_eq!(t.uints(&bps), vec![8, 8, 8]);
        assert_eq!(t.text_of(&ifd, 0x010F).as_deref(), Some("Marxy"));
        let e = *ifd.get(0x829A).unwrap();
        assert_eq!(t.numbers(&e), vec![1.0 / 250.0]);
        // An IFD whose next points at itself is read once.
        let mut looped = bytes.clone();
        let next_at = 8 + 2 + 4 * 12;
        looped[next_at..next_at + 4].copy_from_slice(&8u32.to_le_bytes());
        let mut t = Tiff::new(Cursor::new(&looped[..]), 0).unwrap().unwrap();
        assert_eq!(t.chain(t.first, 10).len(), 1);
    }

    #[test]
    fn a_value_past_the_cap_or_the_end_is_refused() {
        let mut huge = write(&[vec![(ICC_PROFILE, Value::Undefined(vec![0; 8]))]], &[]);
        // The count claims 64 MB.
        let count_at = 8 + 2 + 4;
        huge[count_at..count_at + 4].copy_from_slice(&(64u32 << 20).to_le_bytes());
        let mut t = Tiff::new(Cursor::new(&huge[..]), 0).unwrap().unwrap();
        let ifd = t.ifd(t.first).unwrap();
        assert!(t.bytes(ifd.get(ICC_PROFILE).unwrap()).is_err());
        assert!(Tiff::new(Cursor::new(&b"not a tiff"[..]), 0)
            .unwrap()
            .is_none());
    }
}
