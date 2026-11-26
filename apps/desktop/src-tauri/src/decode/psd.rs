//! A Photoshop file's own preview, read by hand: its flattened (composite) image when the file says that image is real,
//! else the JPEG thumbnail in image resource 1036. Layers are never drawn. Every length is judged against the file and
//! its section before anything is read or allocated, so a damaged file is a sentence, not a panic.

use std::io::{self, Read, Seek, SeekFrom};

use image::{DynamicImage, GrayImage, RgbImage};

/// What the card says of a PSD whose flattened image is blank and which carries no thumbnail.
pub const NO_PREVIEW: &str = "This Photoshop file was saved without a preview: it holds no thumbnail, and its flattened image was left out (Photoshop's Maximize Compatibility was off). Marxy does not draw layers.";

/// Resources walked at most; a real file has a few dozen.
const MAX_RESOURCES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    /// A large document (PSB): wider lengths in its layer section and RLE table.
    pub psb: bool,
    pub channels: u16,
    pub width: u32,
    pub height: u32,
    pub depth: u16,
    /// 0 bitmap, 1 greyscale, 2 indexed, 3 RGB, 4 CMYK, 7 multichannel, 8 duotone, 9 Lab.
    pub mode: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composite {
    pub header: Header,
    /// 0 raw, 1 PackBits.
    pub compression: u16,
    /// Where the pixel data (or the RLE table) starts.
    pub data_at: u64,
    /// An indexed file's 256 reds, then greens, then blues.
    pub palette: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Preview {
    Composite(Composite),
    Thumbnail {
        offset: u64,
        len: u64,
        width: u32,
        height: u32,
    },
}

fn bad(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_owned())
}

fn be16(b: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([b[at], b[at + 1]])
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// `n` bytes at `at`, refused when they would run past `end`.
fn bytes_at<R: Read + Seek>(r: &mut R, at: u64, n: u64, end: u64) -> io::Result<Vec<u8>> {
    if at.checked_add(n).is_none_or(|e| e > end) {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    r.seek(SeekFrom::Start(at))?;
    let mut b = vec![0u8; n as usize];
    r.read_exact(&mut b)?;
    Ok(b)
}

pub fn is_psd(head: &[u8]) -> bool {
    head.starts_with(b"8BPS") && matches!(head.get(4..6), Some([0, 1] | [0, 2]))
}

/// The file header: InvalidData when it is no PSD or its sizes are outside what Photoshop writes.
pub fn header<R: Read + Seek>(r: &mut R) -> io::Result<Header> {
    let len = r.seek(SeekFrom::End(0))?;
    let h = bytes_at(r, 0, 26, len)?;
    if !is_psd(&h) {
        return Err(bad("not a PSD"));
    }
    let header = Header {
        psb: be16(&h, 4) == 2,
        channels: be16(&h, 12),
        height: be32(&h, 14),
        width: be32(&h, 18),
        depth: be16(&h, 22),
        mode: be16(&h, 24),
    };
    let side = if header.psb { 300_000 } else { 30_000 };
    if header.width == 0
        || header.height == 0
        || header.width > side
        || header.height > side
        || !(1..=56).contains(&header.channels)
        || !matches!(header.depth, 1 | 8 | 16 | 32)
    {
        return Err(bad("a PSD header out of range"));
    }
    Ok(header)
}

/// The planes a composite is drawn from, or why it cannot be.
fn planes(h: &Header, palette: bool) -> Result<u16, String> {
    let depth_ok = |d: &[u16]| d.contains(&h.depth);
    let (need, ok) = match h.mode {
        0 => (1, h.depth == 1),
        1 | 8 => (1, depth_ok(&[8, 16])),
        2 => (1, h.depth == 8 && palette),
        3 => (3, depth_ok(&[8, 16])),
        4 => (4, depth_ok(&[8, 16])),
        7 => return Err("multichannel colour".into()),
        9 => return Err("Lab colour".into()),
        m => return Err(format!("colour mode {m}")),
    };
    if !ok {
        return Err(format!("{}-bit samples", h.depth));
    }
    if h.channels < need {
        return Err(format!("{} channels", h.channels));
    }
    Ok(need)
}

fn row_bytes(h: &Header) -> u64 {
    if h.depth == 1 {
        (h.width as u64).div_ceil(8)
    } else {
        h.width as u64 * (h.depth as u64 / 8)
    }
}

/// The preview to draw, or the sentence the card says instead. Err is an I/O failure other than the file being short.
pub fn find<R: Read + Seek>(r: &mut R) -> io::Result<Result<Preview, String>> {
    let h = header(r)?;
    let len = r.seek(SeekFrom::End(0))?;
    let damaged = |what: &str| Ok(Err(format!("This Photoshop file is damaged: {what}.")));
    let short = |e: &io::Error| e.kind() == io::ErrorKind::UnexpectedEof;

    let mut at = 26u64;
    let mode_len = match bytes_at(r, at, 4, len) {
        Ok(b) => be32(&b, 0) as u64,
        Err(e) if short(&e) => return damaged("it ends inside its header"),
        Err(e) => return Err(e),
    };
    let palette = if h.mode == 2 && mode_len >= 768 {
        match bytes_at(r, at + 4, 768, len) {
            Ok(p) => Some(p),
            Err(e) if short(&e) => return damaged("its palette runs past the end of the file"),
            Err(e) => return Err(e),
        }
    } else {
        None
    };
    at += 4 + mode_len;
    let res_len = match bytes_at(r, at, 4, len) {
        Ok(b) => be32(&b, 0) as u64,
        Err(e) if short(&e) => return damaged("its colour data runs past the end of the file"),
        Err(e) => return Err(e),
    };
    let res_start = at + 4;
    let res_end = res_start + res_len;
    if res_end > len {
        return damaged("its image resources run past the end of the file");
    }

    let (mut merged, mut thumb) = (None::<bool>, None);
    let mut p = res_start;
    for _ in 0..MAX_RESOURCES {
        if p + 12 > res_end {
            break;
        }
        let b = bytes_at(r, p, 7, res_end)?;
        if &b[..4] != b"8BIM" {
            break;
        }
        let id = be16(&b, 4);
        let name_field = (1 + b[6] as u64).next_multiple_of(2);
        let size_at = p + 6 + name_field;
        let size = match bytes_at(r, size_at, 4, res_end) {
            Ok(s) => be32(&s, 0) as u64,
            Err(e) if short(&e) => return damaged("a resource's name runs past its section"),
            Err(e) => return Err(e),
        };
        let data = size_at + 4;
        if data + size > res_end {
            return damaged("a resource runs past the end of its section");
        }
        match id {
            1057 if size >= 5 => merged = Some(bytes_at(r, data + 4, 1, res_end)?[0] != 0),
            1036 if size > 28 => {
                let t = bytes_at(r, data, 28, res_end)?;
                if be32(&t, 0) == 1 {
                    thumb = Some(Preview::Thumbnail {
                        offset: data + 28,
                        len: size - 28,
                        width: be32(&t, 4),
                        height: be32(&t, 8),
                    });
                }
            }
            _ => {}
        }
        p = data + size + (size & 1);
    }

    let lay_width = if h.psb { 8 } else { 4 };
    let lay_len = match bytes_at(r, res_end, lay_width, len) {
        Ok(b) if h.psb => u64::from_be_bytes(b.try_into().unwrap_or_default()),
        Ok(b) => be32(&b, 0) as u64,
        Err(e) if short(&e) => return damaged("it ends before its layers"),
        Err(e) => return Err(e),
    };
    let image_at = match (res_end + lay_width).checked_add(lay_len) {
        Some(a) if a <= len => a,
        _ => return damaged("its layers run past the end of the file"),
    };

    let composite = (|| -> io::Result<Result<Composite, String>> {
        if merged == Some(false) {
            return Ok(Err(NO_PREVIEW.into()));
        }
        let need = match planes(&h, palette.is_some()) {
            Ok(n) => n,
            Err(what) => {
                return Ok(Err(format!(
                "This Photoshop file holds no thumbnail, and its flattened image is in {what}, which Marxy does not draw."
            )))
            }
        };
        if let Err(e) = super::within_budget(h.width, h.height) {
            return Ok(Err(format!("This Photoshop file holds no thumbnail, and its flattened image is too large to draw: {e}.")));
        }
        let compression = match bytes_at(r, image_at, 2, len) {
            Ok(b) => be16(&b, 0),
            Err(e) if short(&e) => {
                return Ok(Err(
                    "This Photoshop file is damaged: it ends before its flattened image.".into(),
                ))
            }
            Err(e) => return Err(e),
        };
        let data_at = image_at + 2;
        let needed = match compression {
            0 => need as u64 * h.height as u64 * row_bytes(&h),
            1 => h.channels as u64 * h.height as u64 * if h.psb { 4 } else { 2 },
            _ => {
                return Ok(Err(
                    "This Photoshop file holds no thumbnail, and its flattened image is zip-compressed, which Marxy does not draw.".into(),
                ))
            }
        };
        if data_at + needed > len {
            return Ok(Err(
                "This Photoshop file is damaged: its flattened image is cut short.".into(),
            ));
        }
        Ok(Ok(Composite {
            header: h,
            compression,
            data_at,
            palette: palette.clone(),
        }))
    })()?;
    Ok(match (composite, thumb) {
        (Ok(c), _) => Ok(Preview::Composite(c)),
        (Err(_), Some(t)) => Ok(t),
        (Err(why), None) => Err(why),
    })
}

/// The size a thumbnail of `thumb` pixels is drawn at for a file of `file` pixels: the file's, when that is within the
/// decode budget and the two agree in shape to a thumbnail pixel's rounding; else the thumbnail's own, never stretched.
pub fn thumbnail_shown(file: (u32, u32), thumb: (u32, u32)) -> (u32, u32) {
    let ((w, h), (tw, th)) = (file, thumb);
    let skew = (tw as u64 * h as u64).abs_diff(th as u64 * w as u64);
    if super::within_budget(w, h).is_ok() && skew <= w.max(h) as u64 {
        file
    } else {
        thumb
    }
}

/// PackBits into `out`, which it must fill exactly.
fn unpack_bits(src: &[u8], out: &mut [u8]) -> Result<(), String> {
    let (mut i, mut o) = (0usize, 0usize);
    while o < out.len() {
        let n = *src.get(i).ok_or("an RLE row ends early")? as i8;
        i += 1;
        if n >= 0 {
            let run = n as usize + 1;
            let from = src.get(i..i + run).ok_or("an RLE row ends early")?;
            out.get_mut(o..o + run)
                .ok_or("an RLE row runs long")?
                .copy_from_slice(from);
            i += run;
            o += run;
        } else if n != -128 {
            let run = 1 - n as isize;
            let v = *src.get(i).ok_or("an RLE row ends early")?;
            out.get_mut(o..o + run as usize)
                .ok_or("an RLE row runs long")?
                .fill(v);
            i += 1;
            o += run as usize;
        }
    }
    Ok(())
}

/// The composite, drawn opaque: extra channels (alpha, spot colours, saved selections) are left out.
pub fn decode_composite<R: Read + Seek>(r: &mut R, c: &Composite) -> Result<DynamicImage, String> {
    let h = &c.header;
    let need = planes(h, c.palette.is_some())? as usize;
    super::within_budget(h.width, h.height)?;
    let (w, ht) = (h.width as usize, h.height as usize);
    let rb = row_bytes(h) as usize;
    let io = |e: io::Error| e.to_string();
    // One byte a sample, planes side by side: at most 4 x the pixel budget.
    let mut samples = vec![0u8; w * ht * need];
    let mut row = vec![0u8; rb];
    let mut put = |plane: usize, y: usize, row: &[u8]| {
        for x in 0..w {
            let v = match h.depth {
                1 => {
                    if row[x / 8] & (0x80 >> (x % 8)) != 0 {
                        0
                    } else {
                        255
                    }
                }
                16 => row[x * 2],
                _ => row[x],
            };
            samples[(y * w + x) * need + plane] = v;
        }
    };
    if c.compression == 0 {
        r.seek(SeekFrom::Start(c.data_at)).map_err(io)?;
        for plane in 0..need {
            for y in 0..ht {
                r.read_exact(&mut row).map_err(io)?;
                put(plane, y, &row);
            }
        }
    } else {
        let esize = if h.psb { 4 } else { 2 };
        let rows = need * ht;
        r.seek(SeekFrom::Start(c.data_at)).map_err(io)?;
        let mut table = vec![0u8; rows * esize];
        r.read_exact(&mut table).map_err(io)?;
        let counts: Vec<u64> = table
            .chunks_exact(esize)
            .map(|e| {
                if esize == 4 {
                    be32(e, 0) as u64
                } else {
                    be16(e, 0) as u64
                }
            })
            .collect();
        let start = c.data_at + h.channels as u64 * ht as u64 * esize as u64;
        r.seek(SeekFrom::Start(start)).map_err(io)?;
        // A PackBits row is at most a byte more than every 128 it holds.
        let most = rb as u64 + rb.div_ceil(128) as u64 + 1;
        let mut packed = Vec::new();
        for (i, &n) in counts.iter().enumerate() {
            if n > most {
                return Err("an RLE row longer than its pixels allow".into());
            }
            packed.resize(n as usize, 0);
            r.read_exact(&mut packed).map_err(io)?;
            unpack_bits(&packed, &mut row)?;
            put(i / ht, i % ht, &row);
        }
    }
    let (w, ht) = (h.width, h.height);
    Ok(match h.mode {
        0 | 1 | 8 => DynamicImage::ImageLuma8(GrayImage::from_raw(w, ht, samples).ok_or("size")?),
        2 => {
            let p = c.palette.as_deref().ok_or("no palette")?;
            DynamicImage::ImageRgb8(RgbImage::from_fn(w, ht, |x, y| {
                let i = samples[(y * w + x) as usize] as usize;
                image::Rgb([p[i], p[256 + i], p[512 + i]])
            }))
        }
        3 => DynamicImage::ImageRgb8(RgbImage::from_raw(w, ht, samples).ok_or("size")?),
        // Photoshop stores CMYK inverted, 255 for no ink.
        _ => DynamicImage::ImageRgb8(RgbImage::from_fn(w, ht, |x, y| {
            let s = &samples[(y * w + x) as usize * 4..][..4];
            let k = s[3] as u32;
            let ink = |v: u8| (v as u32 * k / 255) as u8;
            image::Rgb([ink(s[0]), ink(s[1]), ink(s[2])])
        })),
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Cursor;

    pub fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/pictures")
                .join(name),
        )
        .unwrap()
    }

    fn found(bytes: &[u8]) -> Result<Preview, String> {
        find(&mut Cursor::new(bytes)).unwrap()
    }

    #[test]
    fn the_composite_is_chosen_when_the_file_says_it_is_real() {
        for name in ["preview.psd", "raw.psd"] {
            let Ok(Preview::Composite(c)) = found(&fixture(name)) else {
                panic!("{name}: a composite");
            };
            let img = decode_composite(&mut Cursor::new(fixture(name)), &c)
                .unwrap()
                .to_rgb8();
            assert_eq!(img.dimensions(), (8, 4), "{name}");
            assert_eq!(img.get_pixel(0, 0).0, [255, 0, 0], "{name}");
            assert_eq!(img.get_pixel(7, 3).0, [0, 0, 255], "{name}");
        }
    }

    #[test]
    fn a_blank_composite_falls_to_the_thumbnail_or_says_there_is_no_preview() {
        assert!(matches!(
            found(&fixture("thumb.psd")),
            Ok(Preview::Thumbnail {
                width: 8,
                height: 4,
                ..
            })
        ));
        assert_eq!(found(&fixture("bare.psd")), Err(NO_PREVIEW.to_owned()));
        let why = found(&fixture("oversized.psd")).unwrap_err();
        assert!(why.contains("image resources run past the end"), "{why}");
    }

    #[test]
    fn a_thumbnail_is_enlarged_to_the_file_only_within_the_budget_and_never_stretched() {
        assert_eq!(thumbnail_shown((8, 4), (4, 2)), (8, 4));
        // 1000 x 333 has a 160 x 53 thumbnail: one pixel's rounding.
        assert_eq!(thumbnail_shown((1000, 333), (160, 53)), (1000, 333));
        assert_eq!(
            thumbnail_shown((1000, 333), (160, 160)),
            (160, 160),
            "another shape"
        );
        assert_eq!(
            thumbnail_shown((12_000, 9_000), (160, 120)),
            (160, 120),
            "past the budget"
        );
    }

    #[test]
    fn packbits_is_bounded_both_ways() {
        let mut out = [0u8; 4];
        unpack_bits(&[0xFD, 7], &mut out).unwrap();
        assert_eq!(out, [7; 4]);
        assert!(unpack_bits(&[0xFD], &mut out).is_err());
        assert!(unpack_bits(&[0x05, 1, 2], &mut out).is_err());
        assert!(unpack_bits(&[0x80, 0x80], &mut out).is_err());
    }
}
