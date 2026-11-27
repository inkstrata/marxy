//! What an image file is, from its headers and metadata alone: its format, size as stored,
//! orientation, depth, channels, colour profile, frames, EXIF and location, and whether the page shows it through the
//! webview, through a decoder here, or not at all (and why). No pixel is decoded; each read is bounded.

mod exif;
mod icc;
pub(crate) mod isobmff;
pub mod media;

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;

pub use self::exif::{Exif, ExifRead, Location};
use crate::decode::{self, psd, raw, svgz, tiff, tiff::Tiff};

/// The most bytes of an SVG read to find its root element.
const SVG_HEAD_BYTES: usize = 64 * 1024;
/// The most bytes of a JPEG XL file fed to find its header (and ICC profile).
const JXL_HEAD_BYTES: usize = 1024 * 1024;
/// The most bytes of an OpenEXR header read.
const EXR_HEAD_BYTES: usize = 64 * 1024;
/// The most markers walked in a JPEG, chunks in a WebP, blocks in a GIF.
const MAX_SEGMENTS: usize = 4096;
const MAX_GIF_BLOCKS: usize = 1 << 20;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFacts {
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub bit_depth: Option<u8>,
    pub channels: Option<&'static str>,
    pub color_profile: Option<String>,
    pub frames: u32,
    pub show: &'static str,
    pub why: Option<String>,
    pub exif: Option<Exif>,
    pub location: Option<Location>,
    /// What the picture drawn is, where it is not the file's own pixels: a PSD's thumbnail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// What a format's reader found, before the format's name and how it is shown are added.
#[derive(Debug, Default)]
struct Found {
    width: u32,
    height: u32,
    bit_depth: Option<u8>,
    channels: Option<&'static str>,
    icc: Option<Vec<u8>>,
    frames: u32,
    exif: ExifRead,
    /// An orientation the format carries outside EXIF (HEIF's transforms, JPEG XL's header, TIFF's own tag).
    orientation: Option<u16>,
    /// The pixels a decode fills where that is more than the size shown (HEIF's coded size and tiles).
    coded_pixels: Option<u64>,
    /// Why the file, read, is not drawn after all: a PSD with no preview, a DDS cut short or of a kind not decoded, an
    /// SVGZ that unpacks past its cap.
    refused: Option<String>,
    /// For the Image card: what is drawn, where it is not the file's own pixels.
    note: Option<String>,
}

fn bad(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_owned())
}

fn read_at<R: Read + Seek>(r: &mut R, at: u64, n: usize) -> io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(at))?;
    let mut b = vec![0u8; n];
    r.read_exact(&mut b)?;
    Ok(b)
}

/// Up to `n` bytes from the start.
fn head<R: Read + Seek>(r: &mut R, n: usize) -> io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(0))?;
    let mut b = Vec::with_capacity(n.min(1 << 16));
    r.take(n as u64).read_to_end(&mut b)?;
    Ok(b)
}

fn le16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn le32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn png<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    r.seek(SeekFrom::Start(0))?;
    let mut decoder = png::Decoder::new(BufReader::new(&mut *r));
    decoder.set_limits(png::Limits {
        bytes: tiff::MAX_VALUE_BYTES as usize,
    });
    decoder.set_ignore_text_chunk(true);
    let reader = decoder.read_info().map_err(|e| bad(&e.to_string()))?;
    let info = reader.info();
    use png::ColorType::*;
    let channels = match info.color_type {
        Grayscale => "Gray",
        Rgb => "RGB",
        Indexed => "Indexed",
        GrayscaleAlpha => "GrayA",
        Rgba => "RGBA",
    };
    Ok(Found {
        width: info.width,
        height: info.height,
        bit_depth: Some(info.bit_depth as u8),
        channels: Some(channels),
        icc: info.icc_profile.as_ref().map(|p| p.to_vec()),
        frames: info
            .animation_control
            .map(|a| a.num_frames.max(1))
            .unwrap_or(1),
        exif: info
            .exif_metadata
            .as_ref()
            .map(|e| exif::from_bytes(e))
            .unwrap_or_default(),
        orientation: None,
        coded_pixels: None,
        refused: None,
        note: None,
    })
}

/// A JPEG's facts by its markers, up to the first scan; `base` is where it starts in `r` (a RAF's embedded preview).
fn jpeg<R: Read + Seek>(r: &mut R, base: u64) -> io::Result<Found> {
    let mut found = Found {
        frames: 1,
        ..Found::default()
    };
    let soi = read_at(r, base, 2)?;
    if soi != [0xFF, 0xD8] {
        return Err(bad("not a JPEG"));
    }
    let mut icc: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut sized = false;
    for _ in 0..MAX_SEGMENTS {
        let mut m = [0u8; 2];
        r.read_exact(&mut m)?;
        if m[0] != 0xFF {
            return Err(bad("a JPEG marker out of step"));
        }
        if m[1] == 0xFF || (0xD0..=0xD7).contains(&m[1]) || m[1] == 0x01 {
            // Fill bytes, restart markers and TEM carry no length.
            if m[1] == 0xFF {
                r.seek(SeekFrom::Current(-1))?;
            }
            continue;
        }
        if m[1] == 0xDA || m[1] == 0xD9 {
            break;
        }
        let mut l = [0u8; 2];
        r.read_exact(&mut l)?;
        let len = u16::from_be_bytes(l) as usize;
        if len < 2 {
            return Err(bad("a JPEG segment shorter than its length"));
        }
        let body_at = r.stream_position()?;
        match m[1] {
            0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF if !sized => {
                let f = read_at(r, body_at, 6)?;
                found.bit_depth = Some(f[0]);
                found.height = u16::from_be_bytes([f[1], f[2]]) as u32;
                found.width = u16::from_be_bytes([f[3], f[4]]) as u32;
                found.channels = match f[5] {
                    1 => Some("Gray"),
                    3 => Some("RGB"),
                    _ => None,
                };
                sized = true;
            }
            0xE1 if found.exif.exif.is_none() && found.exif.orientation.is_none() => {
                let b = read_at(r, body_at, len - 2)?;
                if b.starts_with(b"Exif\0\0") {
                    found.exif = exif::from_bytes(&b);
                }
            }
            0xE2 if len > 16 => {
                let b = read_at(r, body_at, len - 2)?;
                if b.starts_with(b"ICC_PROFILE\0") {
                    icc.push((b[12], b[14..].to_vec()));
                }
            }
            _ => {}
        }
        r.seek(SeekFrom::Start(body_at + len as u64 - 2))?;
    }
    if !sized {
        return Err(bad("no JPEG frame header"));
    }
    if !icc.is_empty() {
        icc.sort_by_key(|(seq, _)| *seq);
        found.icc = Some(icc.into_iter().flat_map(|(_, b)| b).collect());
    }
    Ok(found)
}

/// Skips `n` bytes by reading them: a seek would empty the BufReader's buffer, and a GIF is mostly 255-byte blocks.
fn skip<R: Read>(r: &mut R, n: u64) -> io::Result<()> {
    let skipped = io::copy(&mut r.by_ref().take(n), &mut io::sink())?;
    if skipped < n {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    Ok(())
}

/// Skips GIF data sub-blocks up to and including the terminator.
fn gif_sub_blocks<R: Read + Seek>(r: &mut R) -> io::Result<()> {
    for _ in 0..MAX_GIF_BLOCKS {
        let mut n = [0u8; 1];
        r.read_exact(&mut n)?;
        if n[0] == 0 {
            return Ok(());
        }
        skip(r, n[0] as u64)?;
    }
    Err(bad("a GIF block run with no end"))
}

fn gif<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 13)?;
    let packed = h[10];
    let table = packed & 0x80 != 0;
    if table {
        skip(r, 3 << ((packed & 7) + 1))?;
    }
    let mut frames = 0u32;
    // A truncated file still says how many frames it reached.
    let _ = (|| -> io::Result<()> {
        for _ in 0..MAX_GIF_BLOCKS {
            let mut b = [0u8; 1];
            r.read_exact(&mut b)?;
            match b[0] {
                0x21 => {
                    skip(r, 1)?;
                    gif_sub_blocks(r)?;
                }
                0x2C => {
                    let mut d = [0u8; 9];
                    r.read_exact(&mut d)?;
                    if d[8] & 0x80 != 0 {
                        skip(r, 3 << ((d[8] & 7) + 1))?;
                    }
                    skip(r, 1)?;
                    gif_sub_blocks(r)?;
                    frames += 1;
                }
                _ => return Ok(()),
            }
        }
        Ok(())
    })();
    Ok(Found {
        width: le16(&h, 6) as u32,
        height: le16(&h, 8) as u32,
        bit_depth: table.then_some((packed & 7) + 1),
        channels: Some("Indexed"),
        frames: frames.max(1),
        ..Found::default()
    })
}

fn webp<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let riff = read_at(r, 0, 12)?;
    let end = (le32(&riff, 4) as u64 + 8).min(r.seek(SeekFrom::End(0))?);
    let mut at = 12u64;
    let mut found = Found {
        bit_depth: Some(8),
        ..Found::default()
    };
    let (mut alpha, mut anmf) = (false, 0u32);
    for _ in 0..MAX_SEGMENTS {
        if at + 8 > end {
            break;
        }
        let h = read_at(r, at, 8)?;
        let size = le32(&h, 4) as u64;
        let body = at + 8;
        match &h[..4] {
            b"VP8X" => {
                let b = read_at(r, body, 10)?;
                alpha |= b[0] & 0x10 != 0;
                found.width = 1 + (b[4] as u32 | (b[5] as u32) << 8 | (b[6] as u32) << 16);
                found.height = 1 + (b[7] as u32 | (b[8] as u32) << 8 | (b[9] as u32) << 16);
            }
            b"VP8 " if found.width == 0 => {
                let b = read_at(r, body, 10)?;
                if b[3..6] != [0x9D, 0x01, 0x2A] {
                    return Err(bad("a VP8 frame without its start code"));
                }
                found.width = (le16(&b, 6) & 0x3FFF) as u32;
                found.height = (le16(&b, 8) & 0x3FFF) as u32;
            }
            b"VP8L" if found.width == 0 => {
                let b = read_at(r, body, 5)?;
                let bits = le32(&b, 1);
                found.width = 1 + (bits & 0x3FFF);
                found.height = 1 + ((bits >> 14) & 0x3FFF);
                alpha |= (bits >> 28) & 1 == 1;
            }
            b"ALPH" => alpha = true,
            b"ANMF" => anmf += 1,
            b"ICCP" if size <= tiff::MAX_VALUE_BYTES as u64 => {
                found.icc = Some(read_at(r, body, size as usize)?);
            }
            b"EXIF" if size <= tiff::MAX_VALUE_BYTES as u64 => {
                found.exif = exif::from_bytes(&read_at(r, body, size as usize)?);
            }
            _ => {}
        }
        at = body + size + (size & 1);
    }
    if found.width == 0 {
        return Err(bad("a WebP with no image"));
    }
    found.channels = Some(if alpha { "RGBA" } else { "RGB" });
    found.frames = anmf.max(1);
    Ok(found)
}

fn heif<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = isobmff::read(r)?.ok_or_else(|| bad("no primary image"))?;
    Ok(Found {
        width: h.width,
        height: h.height,
        bit_depth: h.bit_depth,
        channels: h.channels,
        icc: h.icc,
        frames: 1,
        exif: h.exif.map(|e| exif::from_bytes(&e)).unwrap_or_default(),
        orientation: Some(h.orientation),
        coded_pixels: Some(h.coded_pixels),
        refused: None,
        note: None,
    })
}

/// Whether the head is a HEIF still that is not AVIF (HEIC and its relatives). Asked by the Windows decoder.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_heic(head: &[u8]) -> bool {
    isobmff::brand(head) == Some(isobmff::Brand::Heic)
}

/// A HEIC's primary item as the decoder needs it: its coded size and pixels, and its turns. None when the boxes do not
/// say. Read by the Windows decoder.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn heic_layout<R: Read + Seek>(r: &mut R) -> io::Result<Option<isobmff::Heif>> {
    isobmff::read(r)
}

fn bmp<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 30)?;
    let dib = le32(&h, 14);
    let (width, height, bpp) = if dib == 12 {
        (le16(&h, 18) as u32, le16(&h, 20) as u32, le16(&h, 24))
    } else if dib >= 40 {
        (
            (le32(&h, 18) as i32).unsigned_abs(),
            (le32(&h, 22) as i32).unsigned_abs(),
            le16(&h, 28),
        )
    } else {
        return Err(bad("an unknown BMP header"));
    };
    let mut found = Found {
        width,
        height,
        frames: 1,
        ..Found::default()
    };
    let alpha_mask = if dib >= 56 {
        le32(&read_at(r, 14 + 52, 4)?, 0)
    } else {
        0
    };
    (found.bit_depth, found.channels) = match bpp {
        1 | 2 | 4 | 8 => (Some(bpp as u8), Some("Indexed")),
        16 => (Some(5), Some("RGB")),
        24 => (Some(8), Some("RGB")),
        32 if alpha_mask != 0 => (Some(8), Some("RGBA")),
        32 => (Some(8), Some("RGB")),
        _ => (None, None),
    };
    // A V5 header may embed its profile (`MBED`), at an offset from the header's start.
    if dib >= 124 {
        let v5 = read_at(r, 14, 124)?;
        if &v5[56..60] == b"DEBM" {
            let (offset, size) = (le32(&v5, 112) as u64, le32(&v5, 116));
            if size <= tiff::MAX_VALUE_BYTES {
                found.icc = read_at(r, 14 + offset, size as usize).ok();
            }
        }
    }
    Ok(found)
}

fn ico<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 6)?;
    let count = le16(&h, 4) as usize;
    if count == 0 {
        return Err(bad("an icon with no images"));
    }
    let entries = read_at(r, 6, count.min(256) * 16)?;
    let side = |v: u8| if v == 0 { 256 } else { v as u32 };
    let largest = entries
        .as_chunks::<16>()
        .0
        .iter()
        .max_by_key(|e| (side(e[0]) * side(e[1]), le16(&e[..], 6)))
        .ok_or_else(|| bad("an icon with no images"))?;
    let bpp = le16(largest, 6);
    let (bit_depth, channels) = match bpp {
        32 => (Some(8), Some("RGBA")),
        24 => (Some(8), Some("RGB")),
        1 | 4 | 8 => (Some(bpp as u8), Some("Indexed")),
        _ => (None, None),
    };
    Ok(Found {
        width: side(largest[0]),
        height: side(largest[1]),
        bit_depth,
        channels,
        frames: 1,
        ..Found::default()
    })
}

fn tga_header(h: &[u8]) -> Option<Found> {
    if h.len() < 18 || h[1] > 1 || !matches!(h[2], 1 | 2 | 3 | 9 | 10 | 11) {
        return None;
    }
    let (width, height, depth, alpha_bits) =
        (le16(h, 12) as u32, le16(h, 14) as u32, h[16], h[17] & 15);
    if width == 0 || height == 0 || !matches!(depth, 8 | 15 | 16 | 24 | 32) {
        return None;
    }
    let (bit_depth, channels) = match (h[2] & 7, depth) {
        (1, d) => (d, "Indexed"),
        (2, 32) => (8, "RGBA"),
        (2, 24) => (8, "RGB"),
        (2, _) if alpha_bits > 0 => (5, "RGBA"),
        (2, _) => (5, "RGB"),
        (3, 16) => (8, "GrayA"),
        (3, _) => (8, "Gray"),
        _ => return None,
    };
    Some(Found {
        width,
        height,
        bit_depth: Some(bit_depth),
        channels: Some(channels),
        frames: 1,
        ..Found::default()
    })
}

fn exr<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let b = head(r, EXR_HEAD_BYTES)?;
    let mut at = 8;
    let cstr = |at: &mut usize| -> Option<String> {
        let end = b.get(*at..)?.iter().position(|&c| c == 0)? + *at;
        let s = String::from_utf8_lossy(&b[*at..end]).into_owned();
        *at = end + 1;
        Some(s)
    };
    let mut found = Found {
        frames: 1,
        ..Found::default()
    };
    let mut names: Vec<String> = Vec::new();
    let mut widest = 0u8;
    while let Some(name) = cstr(&mut at) {
        if name.is_empty() {
            break;
        }
        let kind = cstr(&mut at).ok_or_else(|| bad("a truncated EXR header"))?;
        let size = b
            .get(at..at + 4)
            .map(|s| le32(s, 0) as usize)
            .ok_or_else(|| bad("a truncated EXR header"))?;
        at += 4;
        let value = b
            .get(at..at + size)
            .ok_or_else(|| bad("a truncated EXR header"))?;
        at += size;
        match (name.as_str(), kind.as_str()) {
            ("dataWindow", "box2i") if size == 16 => {
                let v = |i: usize| le32(value, i * 4) as i32 as i64;
                found.width = (v(2) - v(0) + 1).clamp(0, u32::MAX as i64) as u32;
                found.height = (v(3) - v(1) + 1).clamp(0, u32::MAX as i64) as u32;
            }
            ("channels", "chlist") => {
                let mut c = 0;
                while let Some(end) = value.get(c..).and_then(|s| s.iter().position(|&x| x == 0)) {
                    if end == 0 {
                        break;
                    }
                    names.push(String::from_utf8_lossy(&value[c..c + end]).into_owned());
                    let pixel_type = value.get(c + end + 1..c + end + 5).map(|s| le32(s, 0));
                    widest = widest.max(match pixel_type {
                        Some(1) => 16,
                        Some(0 | 2) => 32,
                        _ => 0,
                    });
                    c += end + 1 + 16;
                }
            }
            _ => {}
        }
    }
    let has = |n: &str| names.iter().any(|c| c.rsplit('.').next() == Some(n));
    found.channels = match (has("R") && has("G") && has("B"), has("Y"), has("A")) {
        (true, _, true) => Some("RGBA"),
        (true, _, false) => Some("RGB"),
        (false, true, true) => Some("GrayA"),
        (false, true, false) => Some("Gray"),
        _ => None,
    };
    found.bit_depth = (widest > 0).then_some(widest);
    if found.width == 0 || found.height == 0 {
        return Err(bad("an EXR with no data window"));
    }
    Ok(found)
}

fn hdr<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let b = head(r, 8 * 1024)?;
    let text = String::from_utf8_lossy(&b);
    let mut lines = text.split('\n');
    lines
        .by_ref()
        .take_while(|l| !l.trim().is_empty())
        .for_each(drop);
    let size = lines
        .next()
        .ok_or_else(|| bad("no Radiance resolution line"))?;
    let t: Vec<&str> = size.split_whitespace().collect();
    let [a, av, b2, bv] = t[..] else {
        return Err(bad("a Radiance resolution line out of shape"));
    };
    let value = |v: &str| {
        v.parse::<u32>()
            .map_err(|_| bad("a Radiance size that is not a number"))
    };
    let (width, height) = match (a.ends_with('Y'), b2.ends_with('X')) {
        (true, true) => (value(bv)?, value(av)?),
        _ => (value(av)?, value(bv)?),
    };
    Ok(Found {
        width,
        height,
        channels: Some("RGB"),
        frames: 1,
        ..Found::default()
    })
}

fn qoi<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 14)?;
    Ok(Found {
        width: be32(&h, 4),
        height: be32(&h, 8),
        bit_depth: Some(8),
        channels: match h[12] {
            3 => Some("RGB"),
            4 => Some("RGBA"),
            _ => None,
        },
        frames: 1,
        ..Found::default()
    })
}

fn jxl<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    use jxl_oxide::{InitializeResult, JxlImage};
    r.seek(SeekFrom::Start(0))?;
    let mut uninit = JxlImage::builder().build_uninit();
    let mut buf = vec![0u8; 16 * 1024];
    let mut fed = 0;
    let image = loop {
        let n = r.read(&mut buf)?;
        if n == 0 || fed >= JXL_HEAD_BYTES {
            return Err(bad("no JPEG XL header within the bytes read"));
        }
        fed += n;
        uninit
            .feed_bytes(&buf[..n])
            .map_err(|e| bad(&e.to_string()))?;
        match uninit.try_init().map_err(|e| bad(&e.to_string()))? {
            InitializeResult::NeedMoreData(u) => uninit = u,
            InitializeResult::Initialized(image) => break image,
        }
    };
    let header = image.image_header();
    let m = &header.metadata;
    let alpha = m.ec_info.iter().any(|e| e.is_alpha());
    let exif = match image.aux_boxes().first_exif() {
        Ok(jxl_oxide::AuxBoxData::Data(e)) => exif::from_bytes(e.payload()),
        _ => ExifRead::default(),
    };
    Ok(Found {
        width: header.size.width,
        height: header.size.height,
        bit_depth: u8::try_from(m.bit_depth.bits_per_sample()).ok(),
        channels: Some(match (m.grayscale(), alpha) {
            (true, true) => "GrayA",
            (true, false) => "Gray",
            (false, true) => "RGBA",
            (false, false) => "RGB",
        }),
        icc: image.original_icc().map(<[u8]>::to_vec),
        frames: 1,
        exif,
        orientation: Some(m.orientation as u16),
        coded_pixels: None,
        refused: None,
        note: None,
    })
}

/// A TIFF's facts from IFD0. For a RAW file, the largest image among IFD0's chain and the sub-IFDs is the sensor's.
fn tiff_facts<R: Read + Seek>(r: &mut R, raw_file: bool) -> io::Result<Found> {
    let mut t = Tiff::new(&mut *r, 0)?.ok_or_else(|| bad("not a TIFF"))?;
    let exif = exif::from_tiff(&mut t);
    let first = t.first;
    let ifd0 = t.ifd(first)?;
    let mut chosen = vec![ifd0];
    if raw_file {
        let mut all = t.chain(first, 8);
        for i in 0..all.len() {
            let subs = all[i]
                .get(tiff::SUB_IFDS)
                .copied()
                .map(|e| t.uints(&e))
                .unwrap_or_default();
            all.extend(subs.into_iter().take(8).filter_map(|o| t.ifd(o).ok()));
        }
        chosen = all;
    }
    let mut best: Option<(u64, Found)> = None;
    for ifd in &chosen {
        let (Some(width), Some(height)) = (
            t.uint_of(ifd, tiff::IMAGE_WIDTH),
            t.uint_of(ifd, tiff::IMAGE_LENGTH),
        ) else {
            continue;
        };
        let area = width as u64 * height as u64;
        if best.as_ref().is_some_and(|(a, _)| *a >= area) {
            continue;
        }
        let bits = t.uint_of(ifd, tiff::BITS_PER_SAMPLE);
        let samples = t.uint_of(ifd, tiff::SAMPLES_PER_PIXEL).unwrap_or(1);
        let extra = ifd.get(tiff::EXTRA_SAMPLES).is_some();
        let channels = match (t.uint_of(ifd, tiff::PHOTOMETRIC), samples, extra) {
            (Some(0 | 1), 1, _) => Some("Gray"),
            (Some(0 | 1), 2, _) => Some("GrayA"),
            (Some(2), 3, _) => Some("RGB"),
            (Some(2), 4, true) => Some("RGBA"),
            (Some(3), _, _) => Some("Indexed"),
            (Some(6), 3, _) => Some("RGB"),
            _ => None,
        };
        let icc = ifd
            .get(tiff::ICC_PROFILE)
            .copied()
            .and_then(|e| t.bytes(&e).ok());
        best = Some((
            area,
            Found {
                width,
                height,
                bit_depth: bits.and_then(|b| u8::try_from(b).ok()),
                channels,
                icc,
                frames: 1,
                ..Found::default()
            },
        ));
    }
    let (_, mut found) = best.ok_or_else(|| bad("a TIFF with no image size"))?;
    // EXIF's own pixel size where the IFDs give none larger (a CR2's sensor IFD carries no width).
    if raw_file {
        if let Some(e) = exif_pixel_size(&mut t) {
            if e.0 as u64 * e.1 as u64 > found.width as u64 * found.height as u64 {
                (found.width, found.height) = e;
                found.bit_depth = None;
                found.channels = None;
            }
        }
    }
    found.exif = exif;
    Ok(found)
}

fn exif_pixel_size<R: Read + Seek>(t: &mut Tiff<R>) -> Option<(u32, u32)> {
    let first = t.first;
    let ifd0 = t.ifd(first).ok()?;
    let at = t.uint_of(&ifd0, tiff::EXIF_IFD)?;
    let sub = t.ifd(at).ok()?;
    Some((t.uint_of(&sub, 0xA002)?, t.uint_of(&sub, 0xA003)?))
}

fn raf<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 92)?;
    let mut found = jpeg(r, be32(&h, 84) as u64)?;
    found.bit_depth = None;
    found.channels = None;
    Ok(found)
}

/// The SVG's size from its root element: `width` and `height` in absolute units, else the `viewBox`'s.
fn svg<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let b = head(r, SVG_HEAD_BYTES)?;
    let text = String::from_utf8_lossy(&b);
    let start = root_svg(&text).ok_or_else(|| bad("no <svg> element"))?;
    let tag = &text[start..];
    let tag = &tag[..tag
        .find('>')
        .ok_or_else(|| bad("an <svg> tag that does not close"))?];
    let attr = |name: &str| -> Option<String> {
        let mut rest = tag;
        while let Some(i) = rest.find(name) {
            let before = rest[..i].chars().last();
            let after = rest[i + name.len()..].trim_start();
            rest = &rest[i + name.len()..];
            if !before.is_some_and(char::is_whitespace) {
                continue;
            }
            let Some(after) = after.strip_prefix('=') else {
                continue;
            };
            let after = after.trim_start();
            let quote = after.chars().next()?;
            if quote != '"' && quote != '\'' {
                continue;
            }
            let value = &after[1..];
            return Some(value[..value.find(quote)?].to_owned());
        }
        None
    };
    let view_box: Option<(f64, f64)> = attr("viewBox").and_then(|v| {
        let n: Vec<f64> = v
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect();
        (n.len() == 4 && n[2] > 0.0 && n[3] > 0.0).then(|| (n[2], n[3]))
    });
    let (w, h) = (
        attr("width").and_then(|v| length(&v)),
        attr("height").and_then(|v| length(&v)),
    );
    let (width, height) = match (w, h, view_box) {
        (Some(w), Some(h), _) => (w, h),
        (Some(w), None, Some((vw, vh))) => (w, w * vh / vw),
        (None, Some(h), Some((vw, vh))) => (h * vw / vh, h),
        (_, _, Some((vw, vh))) => (vw, vh),
        _ => (0.0, 0.0),
    };
    Ok(Found {
        width: width.round().clamp(0.0, u32::MAX as f64) as u32,
        height: height.round().clamp(0.0, u32::MAX as f64) as u32,
        frames: 1,
        ..Found::default()
    })
}

/// Whether `bytes` open with an SVG root element (within the head an SVG's facts read).
pub(crate) fn has_svg_root(bytes: &[u8]) -> bool {
    root_svg(&String::from_utf8_lossy(
        &bytes[..bytes.len().min(SVG_HEAD_BYTES)],
    ))
    .is_some()
}

/// Where the root `<svg` start tag begins, past the prolog, comments and doctype.
fn root_svg(text: &str) -> Option<usize> {
    let mut at = 0;
    loop {
        let i = text[at..].find('<')? + at;
        let rest = &text[i..];
        if rest.starts_with("<!--") {
            at = i + rest.find("-->")? + 3;
        } else if rest.starts_with("<?") || rest.starts_with("<!") {
            at = i + rest.find('>')? + 1;
        } else if rest.starts_with("<svg")
            && rest[4..].starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/')
        {
            return Some(i);
        } else {
            return None;
        }
    }
}

/// An SVG length in CSS pixels; a percentage or a relative unit has none.
fn length(v: &str) -> Option<f64> {
    let v = v.trim();
    let split = v
        .find(|c: char| {
            !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E')
        })
        .unwrap_or(v.len());
    let (n, unit) = v.split_at(split);
    let n: f64 = n.parse().ok()?;
    let px = match unit.trim() {
        "" | "px" => n,
        "pt" => n * 4.0 / 3.0,
        "pc" => n * 16.0,
        "in" => n * 96.0,
        "cm" => n * 96.0 / 2.54,
        "mm" => n * 96.0 / 25.4,
        _ => return None,
    };
    (px.is_finite() && px > 0.0).then_some(px)
}

/// A PNM header's numbers after its magic, past whitespace and `#` comments: width, height and (but for PBM) the maximum.
fn pnm<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let b = head(r, 4096)?;
    let kind = *b.get(1).ok_or_else(|| bad("no PNM magic"))?;
    let text = String::from_utf8_lossy(&b[2..]);
    let (width, height, max, channels) = if kind == b'7' {
        let value = |key: &str| {
            text.lines()
                .take_while(|l| l.trim() != "ENDHDR")
                .find_map(|l| l.trim().strip_prefix(key).map(|x| x.trim().to_owned()))
        };
        let n = |key: &str| value(key).and_then(|s| s.parse::<u32>().ok());
        let tuple = value("TUPLTYPE").unwrap_or_default();
        let channels = match (tuple.as_str(), n("DEPTH")) {
            ("BLACKANDWHITE" | "GRAYSCALE", _) => "Gray",
            ("BLACKANDWHITE_ALPHA" | "GRAYSCALE_ALPHA", _) => "GrayA",
            ("RGB", _) => "RGB",
            ("RGB_ALPHA", _) => "RGBA",
            (_, Some(1)) => "Gray",
            (_, Some(2)) => "GrayA",
            (_, Some(3)) => "RGB",
            _ => "RGBA",
        };
        (
            n("WIDTH").ok_or_else(|| bad("a PAM with no width"))?,
            n("HEIGHT").ok_or_else(|| bad("a PAM with no height"))?,
            n("MAXVAL").unwrap_or(1),
            channels,
        )
    } else {
        let mut numbers = text
            .lines()
            .map(|l| l.split('#').next().unwrap_or(""))
            .flat_map(str::split_whitespace)
            .map(|t| {
                t.parse::<u32>()
                    .map_err(|_| bad("a PNM header number out of shape"))
            });
        let mut next = || {
            numbers
                .next()
                .unwrap_or_else(|| Err(bad("a PNM header cut short")))
        };
        let (w, h) = (next()?, next()?);
        let max = if matches!(kind, b'1' | b'4') {
            1
        } else {
            next()?
        };
        let channels = if matches!(kind, b'3' | b'6') {
            "RGB"
        } else {
            "Gray"
        };
        (w, h, max, channels)
    };
    if max == 0 || max > 65535 {
        return Err(bad("a PNM maximum out of range"));
    }
    Ok(Found {
        width,
        height,
        bit_depth: Some((32 - max.leading_zeros()) as u8),
        channels: Some(channels),
        frames: 1,
        ..Found::default()
    })
}

fn farbfeld<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 16)?;
    let (width, height) = (be32(&h, 8), be32(&h, 12));
    let len = r.seek(SeekFrom::End(0))?;
    let need = 16 + width as u64 * height as u64 * 8;
    Ok(Found {
        width,
        height,
        bit_depth: Some(16),
        channels: Some("RGBA"),
        frames: 1,
        refused: (len < need).then(|| {
            format!("This farbfeld file is cut short: it holds {len} bytes of the {need} its pixels need.")
        }),
        ..Found::default()
    })
}

/// A DDS's size and block compression from its header. Only BC1 to BC3 (DXT1, DXT3, DXT5) are decoded; the rest, and
/// a file too short for its first image, are refused with the reason.
fn dds<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = read_at(r, 0, 128)?;
    if le32(&h, 4) != 124 {
        return Err(bad("a DDS header of the wrong size"));
    }
    let (height, width) = (le32(&h, 12), le32(&h, 16));
    let compressed = le32(&h, 80) & 0x4 != 0;
    let fourcc = &h[84..88];
    let mut header_len = 128u64;
    // What `image`'s DDS reader refuses before it looks at the pixels: the flags it requires (caps, height, width, pixel
    // format) and the ones it knows, the pixel format block's size, and a DX10 header's fields.
    const REQUIRED: u32 = 0x1 | 0x2 | 0x4 | 0x1000;
    const KNOWN: u32 = REQUIRED | 0x8 | 0x20000 | 0x80000 | 0x0080_0000;
    let flags = le32(&h, 8);
    let header_fault = if flags & (REQUIRED | !KNOWN) != REQUIRED {
        Some(format!("its flags, {flags:#x}, lack the caps, height, width or pixel format, or name ones it does not know"))
    } else if le32(&h, 76) != 32 {
        Some(format!(
            "its pixel format block says {} bytes, not 32",
            le32(&h, 76)
        ))
    } else if compressed && fourcc == b"DX10" {
        let d = read_at(r, 128, 20)?;
        let (dxgi, dimension, misc, array, misc2) = (
            le32(&d, 0),
            le32(&d, 4),
            le32(&d, 8),
            le32(&d, 12),
            le32(&d, 16),
        );
        (dxgi > 132
            || !(2..=4).contains(&dimension)
            || (misc != 0 && misc != 4)
            || (dimension == 4 && array != 1)
            || misc2 > 4)
            .then(|| "its DX10 header is out of range".to_owned())
    } else {
        None
    };
    if let Some(fault) = header_fault {
        return Ok(Found {
            width,
            height,
            frames: 1,
            refused: Some(format!(
                "This DDS's header is not one Marxy's decoder reads: {fault}."
            )),
            ..Found::default()
        });
    }
    // Bytes a 4 x 4 block takes, or the name of a kind not decoded (None: uncompressed).
    let kind: Result<u64, Option<String>> = if !compressed {
        Err(None)
    } else {
        match fourcc {
            b"DXT1" => Ok(8),
            b"DXT3" | b"DXT5" => Ok(16),
            b"DX10" => {
                header_len += 20;
                match le32(&read_at(r, 128, 4)?, 0) {
                    70..=72 => Ok(8),
                    73..=78 => Ok(16),
                    79..=81 => Err(Some("BC4".into())),
                    82..=84 => Err(Some("BC5".into())),
                    94..=96 => Err(Some("BC6H".into())),
                    97..=99 => Err(Some("BC7".into())),
                    n => Err(Some(format!("DXGI format {n}"))),
                }
            }
            b"ATI1" | b"BC4U" | b"BC4S" => Err(Some("BC4".into())),
            b"ATI2" | b"BC5U" | b"BC5S" => Err(Some("BC5".into())),
            other => Err(Some(String::from_utf8_lossy(other).trim().to_owned())),
        }
    };
    let len = r.seek(SeekFrom::End(0))?;
    let refused = match kind {
        Err(None) => Some("This DDS holds uncompressed pixels; Marxy draws only the block-compressed BC1 to BC3 (DXT1, DXT3, DXT5).".to_owned()),
        Err(Some(name)) => Some(format!(
            "This DDS is compressed as {name}; Marxy draws only BC1 to BC3 (DXT1, DXT3, DXT5)."
        )),
        Ok(_) if width % 4 != 0 || height % 4 != 0 => Some(format!(
            "This DDS is {width} by {height}, not whole 4-pixel blocks, which Marxy's decoder needs."
        )),
        Ok(block) => {
            let need =
                header_len + width.div_ceil(4) as u64 * height.div_ceil(4) as u64 * block;
            (len < need).then(|| {
                format!("This DDS is cut short: it holds {len} bytes of the {need} its first image needs.")
            })
        }
    };
    Ok(Found {
        width,
        height,
        bit_depth: Some(8),
        channels: Some(if fourcc == b"DXT1" { "RGB" } else { "RGBA" }),
        frames: 1,
        refused,
        ..Found::default()
    })
}

fn psd_facts<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    let h = psd::header(r)?;
    let found = psd::find(r)?;
    let (mut width, mut height, mut note) = (h.width, h.height, None);
    if let Ok(psd::Preview::Thumbnail { offset, .. }) = found {
        // The thumbnail's real size is its JPEG's, which the decoder draws, not what the resource claims.
        let thumb = jpeg(r, offset)
            .map(|j| (j.width, j.height))
            .unwrap_or((0, 0));
        let shown = psd::thumbnail_shown((h.width, h.height), thumb);
        note = Some(if shown == (h.width, h.height) {
            format!(
                "Drawn from the thumbnail Photoshop stores ({} by {}), enlarged to the file's size: the file's flattened image is not one Marxy can draw.",
                thumb.0, thumb.1
            )
        } else {
            (width, height) = shown;
            format!(
                "Drawn from the thumbnail Photoshop stores, at its own {} by {}: the file is {} by {}, which Marxy does not decode in full.",
                thumb.0, thumb.1, h.width, h.height
            )
        });
    }
    let refused = found.err();
    Ok(Found {
        width,
        height,
        note,
        bit_depth: u8::try_from(h.depth).ok(),
        channels: match h.mode {
            0 | 1 | 8 => Some("Gray"),
            2 => Some("Indexed"),
            3 => Some("RGB"),
            4 => Some("CMYK"),
            9 => Some("Lab"),
            _ => None,
        },
        frames: 1,
        refused,
        ..Found::default()
    })
}

/// An SVGZ's size from the SVG it unpacks to, within `svgz::MAX_UNPACKED`.
fn svgz_facts<R: Read + Seek>(r: &mut R) -> io::Result<Found> {
    r.seek(SeekFrom::Start(0))?;
    let refused = |why: String| Found {
        frames: 1,
        refused: Some(why),
        ..Found::default()
    };
    Ok(match svgz::unpack(&mut *r) {
        svgz::Unpacked::Svg(text) => match svg(&mut io::Cursor::new(text)) {
            Ok(found) => found,
            Err(_) => refused("This SVGZ unpacks to something that is not an SVG.".into()),
        },
        svgz::Unpacked::TooLarge => refused(svgz::too_large_why()),
        svgz::Unpacked::Damaged => refused(svgz::DAMAGED_WHY.into()),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Gif,
    Webp,
    Avif,
    Heic,
    Bmp,
    Ico,
    Svg,
    Tiff,
    Tga,
    Exr,
    Hdr,
    Qoi,
    Jxl,
    Raw,
    Pbm,
    Pgm,
    Ppm,
    Pam,
    Farbfeld,
    Dds,
    Psd,
    Svgz,
}

impl Format {
    fn name(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpeg",
            Format::Gif => "gif",
            Format::Webp => "webp",
            Format::Avif => "avif",
            Format::Heic => "heic",
            Format::Bmp => "bmp",
            Format::Ico => "ico",
            Format::Svg => "svg",
            Format::Tiff => "tiff",
            Format::Tga => "tga",
            Format::Exr => "exr",
            Format::Hdr => "hdr",
            Format::Qoi => "qoi",
            Format::Jxl => "jxl",
            Format::Raw => "raw",
            Format::Pbm => "pbm",
            Format::Pgm => "pgm",
            Format::Ppm => "ppm",
            Format::Pam => "pam",
            Format::Farbfeld => "farbfeld",
            Format::Dds => "dds",
            Format::Psd => "psd",
            Format::Svgz => "svgz",
        }
    }
}

/// What the head says the file is; the name decides only where the head cannot (TGA, an SVG with a long prolog, which
/// TIFF is a camera's RAW file).
fn identify(extension: &str, h: &[u8]) -> Option<Format> {
    let raw_ext = raw::EXTENSIONS.contains(&extension);
    if h.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Format::Png);
    }
    if h.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Format::Jpeg);
    }
    if h.starts_with(b"GIF87a") || h.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    if h.starts_with(b"RIFF") && h.get(8..12) == Some(b"WEBP") {
        return Some(Format::Webp);
    }
    if let Some(b) = isobmff::brand(h) {
        return Some(match b {
            isobmff::Brand::Avif => Format::Avif,
            isobmff::Brand::Heic => Format::Heic,
        });
    }
    if raw::is_raf(h) || (raw_ext && (h.starts_with(b"IIRO") || h.starts_with(b"IIU\0"))) {
        return Some(Format::Raw);
    }
    if h.starts_with(b"II*\0") || h.starts_with(b"MM\0*") {
        return Some(if raw_ext { Format::Raw } else { Format::Tiff });
    }
    if h.starts_with(&[0x76, 0x2F, 0x31, 0x01]) {
        return Some(Format::Exr);
    }
    if h.starts_with(b"#?RADIANCE") || h.starts_with(b"#?RGBE") {
        return Some(Format::Hdr);
    }
    if h.starts_with(b"qoif") {
        return Some(Format::Qoi);
    }
    if decode::is_jxl(h) {
        return Some(Format::Jxl);
    }
    if psd::is_psd(h) {
        return Some(Format::Psd);
    }
    if h.starts_with(b"farbfeld") {
        return Some(Format::Farbfeld);
    }
    if h.starts_with(b"DDS ") {
        return Some(Format::Dds);
    }
    if extension == "svgz" && svgz::is_gzip(h) {
        return Some(Format::Svgz);
    }
    if matches!(extension, "pbm" | "pgm" | "ppm" | "pnm" | "pam") && decode::is_pnm(h) {
        return Some(match h[1] {
            b'1' | b'4' => Format::Pbm,
            b'2' | b'5' => Format::Pgm,
            b'3' | b'6' => Format::Ppm,
            _ => Format::Pam,
        });
    }
    if h.starts_with(b"BM")
        && h.len() >= 18
        && matches!(le32(h, 14), 12 | 40 | 52 | 56 | 64 | 108 | 124)
    {
        return Some(Format::Bmp);
    }
    if matches!(extension, "ico" | "cur")
        && (h.starts_with(&[0, 0, 1, 0]) || h.starts_with(&[0, 0, 2, 0]))
    {
        return Some(Format::Ico);
    }
    match extension {
        "tga" | "icb" | "vda" | "vst" if tga_header(h).is_some() => Some(Format::Tga),
        "svg" => Some(Format::Svg),
        _ => {
            let text = String::from_utf8_lossy(&h[..h.len().min(1024)]);
            (text.trim_start().starts_with('<') && root_svg(&text).is_some()).then_some(Format::Svg)
        }
    }
}

/// What the card says where Windows has no HEIC decoder: the system's own codec comes from two Store extensions.
pub const HEIC_WINDOWS_WHY: &str = "This system cannot draw HEIC: Windows draws it with the HEIF Image Extension and the HEVC Video Extension from the Microsoft Store, and this one has not got both. Marxy does not carry a decoder of its own.";

/// What the card says while the system has not answered whether it decodes HEIC because a decode is stuck.
pub const HEIC_STALLED_WHY: &str = "Windows' own HEIC decoder is busy or stalled on another picture, so whether this system draws HEIC is not known yet. Open it again in a moment.";

/// How the page shows a format: through the webview, through a decoder here, or not at all, and why not.
/// `coded_pixels` is what a decode would fill, when more than `width` x `height` (HEIF's coded size and tiles);
/// `heic_decodable` is whether the system's own HEIC decoder answered (`decode::heic_decodable`).
fn show(
    format: Format,
    width: u32,
    height: u32,
    coded_pixels: Option<u64>,
    heic_decodable: bool,
) -> (&'static str, Option<String>) {
    use Format::*;
    let webview = match format {
        Png | Jpeg | Gif | Webp | Avif | Bmp | Ico | Svg => true,
        // WKWebView decodes HEIC and TIFF itself (Engines); JPEG XL only from macOS 14, so it is decoded here.
        Heic | Tiff => cfg!(target_os = "macos"),
        _ => false,
    };
    if webview {
        return ("webview", None);
    }
    if format == Heic && !heic_decodable {
        if cfg!(windows) {
            return ("none", Some(HEIC_WINDOWS_WHY.to_owned()));
        }
        return (
            "none",
            Some(
                "This system's web view cannot decode HEIC images, and Marxy does not carry a decoder for them."
                    .to_owned(),
            ),
        );
    }
    // A RAW file shows a preview whose size need not be the sensor's, judged at decode; an SVGZ's size is in CSS units,
    // and the webview draws it. A PSD's facts give the size drawn (`psd::thumbnail_shown`).
    if !matches!(format, Raw | Svgz) && decode::within_budget(width, height).is_err() {
        return (
            "none",
            Some(format!(
                "This image is {width} by {height} pixels, more than the {} megapixels Marxy decodes.",
                decode::MAX_PIXELS / 1_000_000
            )),
        );
    }
    if let Some(coded) = coded_pixels.filter(|&p| p > decode::MAX_PIXELS) {
        return (
            "none",
            Some(format!(
                "This image is stored as {} megapixels, cropped or cut down to {width} by {height}, more than the {} megapixels Marxy decodes.",
                coded / 1_000_000,
                decode::MAX_PIXELS / 1_000_000
            )),
        );
    }
    ("decoded", None)
}

/// The RAW file's orientation (1-8), 1 when it says none.
pub fn raw_orientation<R: Read + Seek>(r: &mut R) -> u16 {
    Tiff::new(&mut *r, 0)
        .ok()
        .flatten()
        .and_then(|mut t| exif::from_tiff(&mut t).orientation)
        .unwrap_or(1)
}

/// The facts of the image in `file` (named `path`), or None when it is not an image these readers know or its header
/// does not read.
pub fn read(path: &Path, file: File) -> io::Result<Option<ImageFacts>> {
    let mut r = BufReader::new(file);
    let h = head(&mut r, 64)?;
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let Some(format) = identify(&extension, &h) else {
        return Ok(None);
    };
    let found = match format {
        Format::Png => png(&mut r),
        Format::Jpeg => jpeg(&mut r, 0),
        Format::Gif => gif(&mut r),
        Format::Webp => webp(&mut r),
        Format::Avif | Format::Heic => heif(&mut r),
        Format::Bmp => bmp(&mut r),
        Format::Ico => ico(&mut r),
        Format::Svg => svg(&mut r),
        Format::Tiff => tiff_facts(&mut r, false),
        Format::Tga => tga_header(&h).ok_or_else(|| bad("not a TGA")),
        Format::Exr => exr(&mut r),
        Format::Hdr => hdr(&mut r),
        Format::Qoi => qoi(&mut r),
        Format::Jxl => jxl(&mut r),
        Format::Raw if raw::is_raf(&h) => raf(&mut r),
        Format::Raw => tiff_facts(&mut r, true),
        Format::Pbm | Format::Pgm | Format::Ppm | Format::Pam => pnm(&mut r),
        Format::Farbfeld => farbfeld(&mut r),
        Format::Dds => dds(&mut r),
        Format::Psd => psd_facts(&mut r),
        Format::Svgz => svgz_facts(&mut r),
    };
    let found = match found {
        Ok(f) => f,
        // A header that does not read is not an image these readers know.
        Err(e)
            if matches!(
                e.kind(),
                io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof
            ) =>
        {
            return Ok(None)
        }
        Err(e) => return Err(e),
    };
    let decodable = format == Format::Heic && decode::heic_decodable();
    let (mut show, mut why) = show(
        format,
        found.width,
        found.height,
        found.coded_pixels,
        decodable,
    );
    if format == Format::Heic
        && show == "none"
        && why.as_deref() == Some(HEIC_WINDOWS_WHY)
        && decode::heic_stalled()
    {
        why = Some(HEIC_STALLED_WHY.to_owned());
    }
    if let Some(refused) = found.refused.clone() {
        show = "none";
        why = Some(refused);
    }
    if format == Format::Raw && raw::find_preview(&mut r).ok().flatten().is_none() {
        show = "none";
        why = Some("This raw file carries no preview Marxy can show, and Marxy does not develop raw sensor data.".into());
    }
    let orientation = found
        .orientation
        .or(found.exif.orientation)
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1);
    Ok(Some(ImageFacts {
        format: format.name(),
        width: found.width,
        height: found.height,
        orientation,
        bit_depth: found.bit_depth,
        channels: found.channels,
        color_profile: found.icc.as_deref().and_then(icc::description),
        frames: found.frames.max(1),
        show,
        why,
        exif: found.exif.exif,
        location: found.exif.location,
        note: found.note,
    }))
}

#[cfg(test)]
mod tests;
