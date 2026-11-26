//! A camera RAW file's largest embedded JPEG preview, found by its IFDs (DNG, CR2, NEF, ARW, PEF, SRW, RW2) or by the
//! header (RAF). The sensor data itself is never read: demosaicing is LGPL territory and out of scope.
//! Olympus ORF keeps its preview in the maker note, which is not walked, so an ORF has no preview here.

use std::io::{self, Read, Seek, SeekFrom};

use super::tiff::{self, Ifd, Tiff};

/// The extensions read as camera RAW (TIFF-based, and Fujifilm's RAF).
pub const EXTENSIONS: &[&str] = &[
    "dng", "cr2", "nef", "arw", "orf", "rw2", "raf", "pef", "srw",
];

const RAF_MAGIC: &[u8] = b"FUJIFILMCCD-RAW ";
/// IFDs walked at most: the main chain and each one's sub-IFDs.
const MAX_IFDS: usize = 16;
/// Markers walked at most looking for a JPEG's frame header.
const MAX_MARKERS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preview {
    pub offset: u64,
    pub len: u64,
    pub width: u16,
    pub height: u16,
}

pub fn is_raf(head: &[u8]) -> bool {
    head.starts_with(RAF_MAGIC)
}

/// A baseline or progressive JPEG's size from its frame header, by walking its markers from `offset`; None for anything
/// else (a lossless JPEG is a CR2's or a DNG's sensor data, not a preview).
pub fn jpeg_frame<R: Read + Seek>(r: &mut R, offset: u64) -> Option<(u16, u16)> {
    r.seek(SeekFrom::Start(offset)).ok()?;
    let mut b = [0u8; 2];
    r.read_exact(&mut b).ok()?;
    if b != [0xFF, 0xD8] {
        return None;
    }
    for _ in 0..MAX_MARKERS {
        let mut m = [0u8; 4];
        r.read_exact(&mut m).ok()?;
        if m[0] != 0xFF {
            return None;
        }
        let len = u16::from_be_bytes([m[2], m[3]]);
        match m[1] {
            0xC0..=0xC2 => {
                let mut f = [0u8; 5];
                r.read_exact(&mut f).ok()?;
                let (h, w) = (
                    u16::from_be_bytes([f[1], f[2]]),
                    u16::from_be_bytes([f[3], f[4]]),
                );
                return (w > 0 && h > 0).then_some((w, h));
            }
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF | 0xDA | 0xD9 => return None,
            _ => {
                r.seek(SeekFrom::Current(len as i64 - 2)).ok()?;
            }
        }
    }
    None
}

fn consider<R: Read + Seek>(r: &mut R, best: &mut Option<Preview>, offset: u64, len: u64) {
    if len < 4 {
        return;
    }
    let Some((width, height)) = jpeg_frame(r, offset) else {
        return;
    };
    let p = Preview {
        offset,
        len,
        width,
        height,
    };
    let area = |p: &Preview| (p.width as u64 * p.height as u64, p.len);
    if best.is_none_or(|b| area(&p) > area(&b)) {
        *best = Some(p);
    }
}

fn candidates_in<R: Read + Seek>(t: &mut Tiff<R>, ifd: &Ifd, best: &mut Option<Preview>) {
    if let (Some(o), Some(l)) = (
        t.uint_of(ifd, tiff::JPEG_OFFSET),
        t.uint_of(ifd, tiff::JPEG_LENGTH),
    ) {
        let base = t.base();
        consider(t.reader(), best, base + o as u64, l as u64);
    }
    // A JPEG held as the IFD's one strip (CR2's IFD0, many DNG previews); a CFA or linear-raw IFD is sensor data.
    let compression = t.uint_of(ifd, tiff::COMPRESSION);
    let photometric = t.uint_of(ifd, tiff::PHOTOMETRIC);
    if matches!(compression, Some(6 | 7)) && !matches!(photometric, Some(32803 | 34892)) {
        let offsets = ifd
            .get(tiff::STRIP_OFFSETS)
            .copied()
            .map(|e| t.uints(&e))
            .unwrap_or_default();
        let counts = ifd
            .get(tiff::STRIP_BYTE_COUNTS)
            .copied()
            .map(|e| t.uints(&e))
            .unwrap_or_default();
        if let ([o], [l]) = (&offsets[..], &counts[..]) {
            let base = t.base();
            consider(t.reader(), best, base + *o as u64, *l as u64);
        }
    }
    if let Some(e) = ifd.get(tiff::JPG_FROM_RAW).copied() {
        if let Some((o, l)) = t.value_span(&e) {
            consider(t.reader(), best, o, l);
        }
    }
}

/// The largest JPEG preview in the RAW file `r`, or None.
pub fn find_preview<R: Read + Seek>(mut r: R) -> io::Result<Option<Preview>> {
    let mut head = [0u8; 92];
    r.seek(SeekFrom::Start(0))?;
    let n = r.read(&mut head)?;
    if is_raf(&head[..n]) {
        if n < 92 {
            return Ok(None);
        }
        let o = u32::from_be_bytes([head[84], head[85], head[86], head[87]]) as u64;
        let l = u32::from_be_bytes([head[88], head[89], head[90], head[91]]) as u64;
        let mut best = None;
        consider(&mut r, &mut best, o, l);
        return Ok(best);
    }
    let Some(mut t) = Tiff::new(r, 0)? else {
        return Ok(None);
    };
    let mut best = None;
    let first = t.first;
    let main = t.chain(first, MAX_IFDS);
    let mut walked = 0;
    for ifd in &main {
        candidates_in(&mut t, ifd, &mut best);
        walked += 1;
        let subs = ifd
            .get(tiff::SUB_IFDS)
            .copied()
            .map(|e| t.uints(&e))
            .unwrap_or_default();
        for sub in subs {
            if walked >= MAX_IFDS {
                break;
            }
            if let Ok(s) = t.ifd(sub) {
                candidates_in(&mut t, &s, &mut best);
                walked += 1;
            }
        }
    }
    Ok(best)
}

#[cfg(test)]
pub mod tests {
    use super::super::tiff::build::{write, Value};
    use super::*;
    use std::io::Cursor;

    const NEW_SUBFILE_TYPE: u16 = 0x00FE;

    /// A JPEG of `w` x `h`, its left half red and its right half blue.
    pub fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, _| {
            if x < w / 2 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([0, 0, 255])
            }
        });
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95)
            .encode_image(&img)
            .unwrap();
        out
    }

    /// A DNG-shaped file: IFD0 a small thumbnail by JPEGInterchangeFormat with Orientation 6, a sub-IFD holding the
    /// larger preview as its one strip, another the CFA sensor data (64 x 48, 12 bits).
    pub fn dng(orientation: u16) -> Vec<u8> {
        let small = jpeg(4, 2);
        let large = jpeg(16, 8);
        let sensor = vec![0u8; 64];
        write(
            &[
                vec![
                    (NEW_SUBFILE_TYPE, Value::Long(vec![1])),
                    (tiff::IMAGE_WIDTH, Value::Long(vec![4])),
                    (tiff::IMAGE_LENGTH, Value::Long(vec![2])),
                    (0x010F, Value::Ascii("Marxy")),
                    (0x0110, Value::Ascii("Marxy RAW")),
                    (tiff::ORIENTATION, Value::Short(vec![orientation])),
                    (tiff::JPEG_OFFSET, Value::BlobRef(0)),
                    (tiff::JPEG_LENGTH, Value::Long(vec![small.len() as u32])),
                    (tiff::SUB_IFDS, Value::IfdRefs(vec![1, 2])),
                ],
                vec![
                    (NEW_SUBFILE_TYPE, Value::Long(vec![1])),
                    (tiff::IMAGE_WIDTH, Value::Long(vec![16])),
                    (tiff::IMAGE_LENGTH, Value::Long(vec![8])),
                    (tiff::COMPRESSION, Value::Short(vec![7])),
                    (tiff::PHOTOMETRIC, Value::Short(vec![6])),
                    (tiff::STRIP_OFFSETS, Value::BlobRef(1)),
                    (
                        tiff::STRIP_BYTE_COUNTS,
                        Value::Long(vec![large.len() as u32]),
                    ),
                ],
                vec![
                    (NEW_SUBFILE_TYPE, Value::Long(vec![0])),
                    (tiff::IMAGE_WIDTH, Value::Long(vec![64])),
                    (tiff::IMAGE_LENGTH, Value::Long(vec![48])),
                    (tiff::BITS_PER_SAMPLE, Value::Short(vec![12])),
                    (tiff::COMPRESSION, Value::Short(vec![7])),
                    (tiff::PHOTOMETRIC, Value::Short(vec![32803])),
                    (tiff::STRIP_OFFSETS, Value::BlobRef(2)),
                    (
                        tiff::STRIP_BYTE_COUNTS,
                        Value::Long(vec![sensor.len() as u32]),
                    ),
                ],
            ],
            &[&small, &large, &sensor],
        )
    }

    #[test]
    fn the_largest_baseline_preview_is_chosen_and_the_sensor_data_never() {
        let bytes = dng(1);
        let p = find_preview(Cursor::new(&bytes[..])).unwrap().unwrap();
        assert_eq!((p.width, p.height), (16, 8));
        assert_eq!(
            &bytes[p.offset as usize..p.offset as usize + 2],
            &[0xFF, 0xD8]
        );
    }

    #[test]
    fn a_raf_preview_comes_from_its_header() {
        let preview = jpeg(10, 6);
        let mut bytes = RAF_MAGIC.to_vec();
        bytes.resize(100, 0);
        bytes[84..88].copy_from_slice(&100u32.to_be_bytes());
        bytes[88..92].copy_from_slice(&(preview.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&preview);
        let p = find_preview(Cursor::new(&bytes[..])).unwrap().unwrap();
        assert_eq!((p.offset, p.width, p.height), (100, 10, 6));
    }

    #[test]
    fn a_tiff_with_no_jpeg_has_no_preview() {
        let bytes = write(&[vec![(tiff::IMAGE_WIDTH, Value::Long(vec![4]))]], &[]);
        assert_eq!(find_preview(Cursor::new(&bytes[..])).unwrap(), None);
    }
}
