//! HEIF and AVIF facts from their ISO base media boxes: the primary item's `ispe`, `clap`, `pixi`, `colr`, `irot` and
//! `imir`,
//! and its `Exif` item through `iinf` and `iloc`. Only `ftyp` and `meta` are read, never `mdat`'s image data. MP4 and
//! QuickTime movies are read by the same boxes in `movie`.

mod movie;

use std::io::{self, Read, Seek, SeekFrom};

pub use movie::movie;

/// The most bytes of `meta` read; a grid image's item tables are a few kilobytes.
const MAX_META_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOP_BOXES: usize = 64;
const MAX_EXIF_BYTES: u64 = 1024 * 1024;
/// The most sources (a grid's tiles) a derived item is judged by; more count as past the decode budget. An iPhone's
/// 48 MP photo has 192.
const MAX_SOURCES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Brand {
    Avif,
    Heic,
}

/// The brand family `ftyp` names (its major brand, else a compatible one), from the file's first bytes.
pub fn brand(head: &[u8]) -> Option<Brand> {
    if head.get(4..8) != Some(b"ftyp") {
        return None;
    }
    let size = u32::from_be_bytes(head.get(..4)?.try_into().ok()?) as usize;
    let end = size.min(head.len());
    let mut brands = vec![head.get(8..12)?];
    let mut at = 16;
    while at + 4 <= end {
        brands.push(&head[at..at + 4]);
        at += 4;
    }
    if brands.iter().any(|b| matches!(*b, b"avif" | b"avis")) {
        return Some(Brand::Avif);
    }
    brands
        .iter()
        .any(|b| {
            matches!(
                *b,
                b"heic"
                    | b"heix"
                    | b"hevc"
                    | b"hevx"
                    | b"heim"
                    | b"heis"
                    | b"hevm"
                    | b"hevs"
                    | b"mif1"
                    | b"msf1"
            )
        })
        .then_some(Brand::Heic)
}

#[derive(Debug, Default)]
pub struct Heif {
    pub width: u32,
    pub height: u32,
    pub bit_depth: Option<u8>,
    pub channels: Option<&'static str>,
    pub icc: Option<Vec<u8>>,
    pub orientation: u16,
    pub exif: Option<Vec<u8>>,
    /// The primary item's `ispe`, before `clap` crops it: what its decoder fills.
    pub coded_width: u32,
    pub coded_height: u32,
    /// The pixels a decode fills: the coded size, or, for a grid (or any item derived from others), the sum of its
    /// tiles' coded sizes when that is more.
    pub coded_pixels: u64,
}

fn be(b: &[u8], at: usize, n: usize) -> Option<u64> {
    let s = b.get(at..at.checked_add(n)?)?;
    Some(s.iter().fold(0u64, |v, &x| (v << 8) | x as u64))
}

/// The boxes in `b`: (type, content).
fn boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= b.len() {
        let Some(size) = be(b, at, 4) else { break };
        let kind: [u8; 4] = b[at + 4..at + 8].try_into().unwrap_or_default();
        let (header, size) = match size {
            0 => (8, (b.len() - at) as u64),
            1 => match be(b, at + 8, 8) {
                Some(s) => (16, s),
                None => break,
            },
            s => (8, s),
        };
        let Some(end) = at
            .checked_add(size as usize)
            .filter(|&e| e <= b.len() && size >= header as u64)
        else {
            break;
        };
        out.push((kind, &b[at + header..end]));
        at = end;
    }
    out
}

fn child<'a>(b: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    boxes(b)
        .into_iter()
        .find(|(k, _)| k == kind)
        .map(|(_, c)| c)
}

/// The `meta` box's content, past its version and flags, read from the top level of `r`.
fn meta<R: Read + Seek>(r: &mut R) -> io::Result<Option<Vec<u8>>> {
    let len = r.seek(SeekFrom::End(0))?;
    let mut at = 0u64;
    for _ in 0..MAX_TOP_BOXES {
        if at + 8 > len {
            break;
        }
        r.seek(SeekFrom::Start(at))?;
        let mut h = [0u8; 16];
        r.read_exact(&mut h[..8])?;
        let size = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
        let (header, size) = match size {
            0 => (8, len - at),
            1 => {
                r.read_exact(&mut h[8..16])?;
                (
                    16,
                    u64::from_be_bytes(h[8..16].try_into().unwrap_or_default()),
                )
            }
            s => (8, s),
        };
        if size < header {
            break;
        }
        if &h[4..8] == b"meta" {
            let content = size - header;
            if !(4..=MAX_META_BYTES).contains(&content) {
                return Ok(None);
            }
            let mut b = vec![0u8; content as usize];
            r.read_exact(&mut b)?;
            return Ok(Some(b.split_off(4)));
        }
        at += size;
    }
    Ok(None)
}

/// The EXIF orientation (1-8) for HEIF's transforms, applied in the order the item lists them.
fn orientation(transforms: &[(u8, u8)]) -> u16 {
    // (mirrored left to right first, then turned this many quarters clockwise): EXIF's own way of saying it.
    let (mut flip, mut quarters) = (false, 0u8);
    for &(kind, value) in transforms {
        match (kind, value) {
            // irot: anticlockwise quarter turns.
            (0, a) => quarters = (quarters + 4 - (a & 3)) % 4,
            // imir 1: left and right swap. (Windows' decoder and libheif read 0 as top and bottom, below.)
            (1, 1) => {
                flip = !flip;
                quarters = (4 - quarters) % 4;
            }
            // imir 0: top and bottom swap, a left-right mirror and a half turn.
            (1, _) => {
                flip = !flip;
                quarters = (4 - (quarters + 2) % 4) % 4;
            }
            _ => {}
        }
    }
    match (flip, quarters) {
        (false, 0) => 1,
        (true, 0) => 2,
        (false, 2) => 3,
        (true, 2) => 4,
        (true, 3) => 5,
        (false, 1) => 6,
        (true, 1) => 7,
        _ => 8,
    }
}

/// The facts of a HEIF or AVIF file in `r`.
pub fn read<R: Read + Seek>(r: &mut R) -> io::Result<Option<Heif>> {
    let Some(meta) = meta(r)? else {
        return Ok(None);
    };
    let primary = child(&meta, b"pitm").and_then(|p| match p.first()? {
        0 => be(p, 4, 2),
        _ => be(p, 4, 4),
    });
    let Some(iprp) = child(&meta, b"iprp") else {
        return Ok(None);
    };
    let properties: Vec<([u8; 4], &[u8])> = child(iprp, b"ipco").map(boxes).unwrap_or_default();
    let items = child(iprp, b"ipma").map(associations).unwrap_or_default();
    // The primary item's property indices (1-based), in order; the first item listed when there is no `pitm`.
    let associated: &[usize] = items
        .iter()
        .find(|(id, _)| primary.is_none_or(|p| p == *id))
        .map(|(_, a)| a.as_slice())
        .unwrap_or_default();
    let props: Vec<&([u8; 4], &[u8])> = associated
        .iter()
        .filter_map(|&i| properties.get(i.checked_sub(1)?))
        .collect();
    let mut out = Heif {
        orientation: 1,
        ..Heif::default()
    };
    let mut transforms = Vec::new();
    let mut clap = None;
    for (kind, c) in props {
        match kind {
            b"ispe" => {
                out.width = be(c, 4, 4).unwrap_or(0) as u32;
                out.height = be(c, 8, 4).unwrap_or(0) as u32;
            }
            // The size shown: an encoder pads to its block size (a 64 x 32 picture coded as 68 x 34) and crops back.
            b"clap" => clap = clean_aperture(c),
            b"pixi" => {
                let n = c.get(4).copied().unwrap_or(0);
                out.bit_depth = c.get(5).copied();
                out.channels = match n {
                    1 => Some("Gray"),
                    3 => Some("RGB"),
                    _ => None,
                };
            }
            b"colr" if matches!(c.get(..4), Some(b"prof" | b"rICC")) => {
                out.icc = Some(c[4..].to_vec());
            }
            b"irot" => transforms.push((0, c.first().copied().unwrap_or(0))),
            b"imir" => transforms.push((1, c.first().copied().unwrap_or(0) & 1)),
            _ => {}
        }
    }
    (out.coded_width, out.coded_height) = (out.width, out.height);
    out.coded_pixels = out.width as u64 * out.height as u64;
    // A grid's tiles (or an item's sources) are each decoded at their own coded size before they are put together.
    if let Some(id) = primary {
        let sources = derived_from(&meta, id);
        if !sources.is_empty() {
            out.coded_pixels = out
                .coded_pixels
                .max(sources_pixels(&sources, &items, &properties));
        }
    }
    if let Some((w, h)) = clap.filter(|&(w, h)| w <= out.width && h <= out.height) {
        (out.width, out.height) = (w, h);
    }
    // Windows' decoder applies the turn before the mirror whatever order the item lists them in (MIAF files list
    // clap, irot, imir anyway): the facts do the same, so they say what is drawn.
    transforms.sort_by_key(|t| t.0);
    out.orientation = orientation(&transforms);
    // An alpha plane is an auxiliary image of its own; its `auxC` names it.
    let alpha = properties
        .iter()
        .any(|(k, c)| k == b"auxC" && c.windows(5).any(|w| w == b"alpha"));
    if alpha {
        out.channels = match out.channels {
            Some("Gray") => Some("GrayA"),
            _ => Some("RGBA"),
        };
    }
    out.exif = exif_item(&meta, r)?;
    Ok((out.width > 0 && out.height > 0).then_some(out))
}

/// Every item's property indices (1-based) in `ipma`, in order.
fn associations(ipma: &[u8]) -> Vec<(u64, Vec<usize>)> {
    let version = ipma.first().copied().unwrap_or(0);
    let wide = ipma.get(3).is_some_and(|f| f & 1 == 1);
    let (step, mask) = if wide { (2, 0x7FFF) } else { (1, 0x7F) };
    let id_len = if version < 1 { 2 } else { 4 };
    let count = be(ipma, 4, 4).unwrap_or(0);
    let mut out = Vec::new();
    let mut at = 8;
    for _ in 0..count.min(65_536) {
        let (Some(id), Some(n)) = (be(ipma, at, id_len), be(ipma, at + id_len, 1)) else {
            break;
        };
        at += id_len + 1;
        let props = (0..n as usize)
            .map_while(|i| be(ipma, at + i * step, step).map(|v| (v & mask) as usize))
            .collect();
        out.push((id, props));
        at += n as usize * step;
    }
    out
}

/// The `ispe` among an item's properties.
fn ispe(properties: &[([u8; 4], &[u8])], associated: &[usize]) -> Option<(u32, u32)> {
    associated
        .iter()
        .filter_map(|&i| properties.get(i.checked_sub(1)?))
        .find(|(k, _)| k == b"ispe")
        .map(|(_, c)| {
            (
                be(c, 4, 4).unwrap_or(0) as u32,
                be(c, 8, 4).unwrap_or(0) as u32,
            )
        })
}

/// The pixels `sources` decode to, each at its own coded size; `u64::MAX` (past any budget) when there are more than
/// `MAX_SOURCES`, when one has no size or a zero one, or as soon as the sum passes the budget.
fn sources_pixels(
    sources: &[u64],
    items: &[(u64, Vec<usize>)],
    properties: &[([u8; 4], &[u8])],
) -> u64 {
    if sources.len() > MAX_SOURCES {
        return u64::MAX;
    }
    let sizes: std::collections::HashMap<u64, (u32, u32)> = items
        .iter()
        .filter_map(|(id, a)| Some((*id, ispe(properties, a)?)))
        .collect();
    let mut sum = 0u64;
    for src in sources {
        match sizes.get(src) {
            Some(&(w, h)) if w > 0 && h > 0 => sum = sum.saturating_add(w as u64 * h as u64),
            _ => return u64::MAX,
        }
        if sum > crate::decode::MAX_PIXELS {
            return u64::MAX;
        }
    }
    sum
}

/// The items `from` is derived from (`iref`'s `dimg`): a grid's tiles in order, a repeated tile once per use.
fn derived_from(meta: &[u8], from: u64) -> Vec<u64> {
    let Some(iref) = child(meta, b"iref") else {
        return Vec::new();
    };
    let id_len = if iref.first() == Some(&0) { 2 } else { 4 };
    let mut out = Vec::new();
    for (kind, c) in boxes(iref.get(4..).unwrap_or_default()) {
        if kind != *b"dimg" || be(c, 0, id_len) != Some(from) {
            continue;
        }
        let n = be(c, id_len, 2).unwrap_or(0) as usize;
        let room = (MAX_SOURCES + 1).saturating_sub(out.len());
        out.extend((0..n.min(room)).map_while(|i| be(c, id_len + 2 + i * id_len, id_len)));
    }
    out
}

/// A `clap` box's width and height, each a fraction rounded down, when both are whole positive numbers.
fn clean_aperture(c: &[u8]) -> Option<(u32, u32)> {
    let side = |at: usize| -> Option<u32> {
        let (n, d) = (be(c, at, 4)?, be(c, at + 4, 4)?);
        (d > 0 && n >= d).then(|| (n / d) as u32)
    };
    Some((side(0)?, side(8)?))
}

/// The bytes of the `Exif` item, past its offset field, when it is one extent in the file.
fn exif_item<R: Read + Seek>(meta: &[u8], r: &mut R) -> io::Result<Option<Vec<u8>>> {
    let Some(iinf) = child(meta, b"iinf") else {
        return Ok(None);
    };
    let skip = if iinf.first() == Some(&0) { 6 } else { 8 };
    let id = boxes(iinf.get(skip..).unwrap_or_default())
        .into_iter()
        .filter(|(k, _)| k == b"infe")
        .find_map(|(_, c)| {
            let version = *c.first()?;
            let (id, at) = match version {
                2 => (be(c, 4, 2)?, 8),
                3 => (be(c, 4, 4)?, 10),
                _ => return None,
            };
            (c.get(at..at + 4)? == b"Exif").then_some(id)
        });
    let (Some(id), Some(iloc)) = (id, child(meta, b"iloc")) else {
        return Ok(None);
    };
    let version = iloc.first().copied().unwrap_or(0);
    let (Some(a), Some(b)) = (iloc.get(4), iloc.get(5)) else {
        return Ok(None);
    };
    let (offset_size, length_size, base_size) =
        ((a >> 4) as usize, (a & 15) as usize, (b >> 4) as usize);
    let index_size = if version >= 1 { (b & 15) as usize } else { 0 };
    let (count, mut at) = if version < 2 {
        (be(iloc, 6, 2).unwrap_or(0), 8)
    } else {
        (be(iloc, 6, 4).unwrap_or(0), 10)
    };
    let id_len = if version < 2 { 2 } else { 4 };
    for _ in 0..count.min(65_536) {
        let Some(item) = be(iloc, at, id_len) else {
            break;
        };
        at += id_len;
        let method = if version >= 1 {
            let m = be(iloc, at, 2).unwrap_or(0) & 15;
            at += 2;
            m
        } else {
            0
        };
        at += 2;
        let base = if base_size > 0 {
            be(iloc, at, base_size).unwrap_or(0)
        } else {
            0
        };
        at += base_size;
        let extents = be(iloc, at, 2).unwrap_or(0) as usize;
        at += 2;
        let mut first = None;
        // An extent of no bytes moves `at` nowhere, so 65,535 of them in each of 65,535 items would spin for seconds.
        let step = index_size + offset_size + length_size;
        for _ in 0..if step == 0 { extents.min(1) } else { extents } {
            if at > iloc.len() {
                break;
            }
            at += index_size;
            let o = if offset_size > 0 {
                be(iloc, at, offset_size).unwrap_or(0)
            } else {
                0
            };
            at += offset_size;
            let l = if length_size > 0 {
                be(iloc, at, length_size).unwrap_or(0)
            } else {
                0
            };
            at += length_size;
            first.get_or_insert((o, l));
        }
        if item != id {
            continue;
        }
        let Some((o, l)) = first.filter(|_| method == 0 && extents == 1) else {
            return Ok(None);
        };
        if !(4..=MAX_EXIF_BYTES).contains(&l) {
            return Ok(None);
        }
        let mut bytes = vec![0u8; l as usize];
        r.seek(SeekFrom::Start(base + o))?;
        r.read_exact(&mut bytes)?;
        // Four bytes give the TIFF header's offset past them.
        let skip = 4 + u32::from_be_bytes(bytes[..4].try_into().unwrap_or_default()) as usize;
        return Ok(bytes.get(skip..).map(<[u8]>::to_vec));
    }
    Ok(None)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn bx(kind: &[u8; 4], content: &[u8]) -> Vec<u8> {
        let mut b = ((content.len() + 8) as u32).to_be_bytes().to_vec();
        b.extend_from_slice(kind);
        b.extend_from_slice(content);
        b
    }

    fn full(kind: &[u8; 4], version: u8, flags: u32, content: &[u8]) -> Vec<u8> {
        let mut c = vec![version];
        c.extend_from_slice(&flags.to_be_bytes()[1..]);
        c.extend_from_slice(content);
        bx(kind, &c)
    }

    /// A HEIF file of one primary item (id 1) 4032 x 3024, 10 bits, an ICC profile, turned by `irot`, and an `Exif`
    /// item (id 2) holding `exif`; no image data.
    pub fn heif(major: &[u8; 4], irot: u8, icc: &[u8], exif: &[u8]) -> Vec<u8> {
        heif_of(major, 4032, 3024, irot, icc, exif)
    }

    /// The same file declaring `width` x `height`, with no turn, profile or EXIF. Used by the Windows decoder's tests.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn heif_sized(major: &[u8; 4], width: u32, height: u32) -> Vec<u8> {
        heif_of(major, width, height, 0, b"", b"")
    }

    fn heif_of(
        major: &[u8; 4],
        width: u32,
        height: u32,
        irot: u8,
        icc: &[u8],
        exif: &[u8],
    ) -> Vec<u8> {
        let mut ftyp = major.to_vec();
        ftyp.extend_from_slice(&[0, 0, 0, 0]);
        ftyp.extend_from_slice(b"mif1");
        ftyp.extend_from_slice(major);
        let ftyp = bx(b"ftyp", &ftyp);
        let hdlr = full(b"hdlr", 0, 0, b"\0\0\0\0pict\0\0\0\0\0\0\0\0\0\0\0\0\0");
        let pitm = full(b"pitm", 0, 0, &1u16.to_be_bytes());
        let mut infe1 = 1u16.to_be_bytes().to_vec();
        infe1.extend_from_slice(&[0, 0]);
        infe1.extend_from_slice(if major == b"avif" { b"av01" } else { b"hvc1" });
        infe1.push(0);
        let mut infe2 = 2u16.to_be_bytes().to_vec();
        infe2.extend_from_slice(&[0, 0]);
        infe2.extend_from_slice(b"Exif\0");
        let mut iinf = 2u16.to_be_bytes().to_vec();
        iinf.extend(full(b"infe", 2, 0, &infe1));
        iinf.extend(full(b"infe", 2, 0, &infe2));
        let iinf = full(b"iinf", 0, 0, &iinf);
        let mut ispe = width.to_be_bytes().to_vec();
        ispe.extend_from_slice(&height.to_be_bytes());
        let mut colr = b"prof".to_vec();
        colr.extend_from_slice(icc);
        let ipco = bx(
            b"ipco",
            &[
                full(b"ispe", 0, 0, &ispe),
                full(b"pixi", 0, 0, &[3, 10, 10, 10]),
                bx(b"colr", &colr),
                bx(b"irot", &[irot]),
            ]
            .concat(),
        );
        let mut ipma = 1u32.to_be_bytes().to_vec();
        ipma.extend_from_slice(&1u16.to_be_bytes());
        ipma.extend_from_slice(&[4, 0x81, 0x02, 0x83, 0x84]);
        let ipma = full(b"ipma", 0, 0, &ipma);
        let iprp = bx(b"iprp", &[ipco, ipma].concat());
        // iloc v0: offset 4 bytes, length 4 bytes, no base; one item, the Exif one, whose offset is patched below.
        let mut iloc = vec![0x44, 0x00];
        iloc.extend_from_slice(&1u16.to_be_bytes());
        iloc.extend_from_slice(&2u16.to_be_bytes());
        iloc.extend_from_slice(&0u16.to_be_bytes());
        iloc.extend_from_slice(&1u16.to_be_bytes());
        iloc.extend_from_slice(&0u32.to_be_bytes());
        iloc.extend_from_slice(&((exif.len() + 4) as u32).to_be_bytes());
        let iloc = full(b"iloc", 0, 0, &iloc);
        let meta = full(b"meta", 0, 0, &[hdlr, pitm, iinf, iprp, iloc].concat());
        let mut file = [ftyp, meta].concat();
        let exif_at = file.len() + 8;
        let mut payload = 0u32.to_be_bytes().to_vec();
        payload.extend_from_slice(exif);
        file.extend(bx(b"mdat", &payload));
        // Patch the extent's offset, the last eight bytes of iloc but four.
        let iloc_offset =
            file.windows(4).position(|w| w == b"iloc").unwrap() + 4 + 4 + 2 + 2 + 2 + 2 + 2;
        file[iloc_offset..iloc_offset + 4].copy_from_slice(&(exif_at as u32).to_be_bytes());
        file
    }

    pub fn ispe_box(width: u32, height: u32) -> Vec<u8> {
        let mut c = width.to_be_bytes().to_vec();
        c.extend_from_slice(&height.to_be_bytes());
        full(b"ispe", 0, 0, &c)
    }

    pub fn clap_box(width: u32, height: u32) -> Vec<u8> {
        let mut c = Vec::new();
        for v in [width, 1, height, 1, 0, 1, 0, 1] {
            c.extend_from_slice(&v.to_be_bytes());
        }
        bx(b"clap", &c)
    }

    /// An item: its id, its type and its properties' boxes.
    pub type Item<'a> = (u16, &'a [u8; 4], Vec<Vec<u8>>);

    /// A HEIC of items, item 1 primary, with `dimg` references from item 1 to `tiles`; no image data, so only facts and
    /// the budget read it.
    pub fn heif_items(items: &[Item], tiles: &[u16]) -> Vec<u8> {
        let ftyp = bx(b"ftyp", b"heic\0\0\0\0mif1heic");
        let hdlr = full(b"hdlr", 0, 0, b"\0\0\0\0pict\0\0\0\0\0\0\0\0\0\0\0\0\0");
        let pitm = full(b"pitm", 0, 0, &1u16.to_be_bytes());
        let mut iinf = (items.len() as u16).to_be_bytes().to_vec();
        let mut ipco = Vec::new();
        let mut ipma = (items.len() as u32).to_be_bytes().to_vec();
        let mut index = 0u16;
        for (id, kind, props) in items {
            let mut infe = id.to_be_bytes().to_vec();
            infe.extend_from_slice(&[0, 0]);
            infe.extend_from_slice(*kind);
            infe.push(0);
            iinf.extend(full(b"infe", 2, 0, &infe));
            ipma.extend_from_slice(&id.to_be_bytes());
            ipma.push(props.len() as u8);
            for p in props {
                index += 1;
                ipco.extend_from_slice(p);
                ipma.extend_from_slice(&(0x8000 | index).to_be_bytes());
            }
        }
        let iinf = full(b"iinf", 0, 0, &iinf);
        let iprp = bx(
            b"iprp",
            &[bx(b"ipco", &ipco), full(b"ipma", 0, 1, &ipma)].concat(),
        );
        let mut dimg = 1u16.to_be_bytes().to_vec();
        dimg.extend_from_slice(&(tiles.len() as u16).to_be_bytes());
        for t in tiles {
            dimg.extend_from_slice(&t.to_be_bytes());
        }
        let iref = full(b"iref", 0, 0, &bx(b"dimg", &dimg));
        let meta = full(b"meta", 0, 0, &[hdlr, pitm, iinf, iprp, iref].concat());
        [ftyp, meta].concat()
    }

    #[test]
    fn clap_crops_the_shown_size_and_the_coded_size_is_kept_for_the_budget() {
        let f = heif_items(
            &[(
                1,
                b"hvc1",
                vec![ispe_box(100_000, 100_000), clap_box(100, 100)],
            )],
            &[],
        );
        let h = read(&mut std::io::Cursor::new(f)).unwrap().unwrap();
        assert_eq!((h.width, h.height), (100, 100));
        assert_eq!(
            (h.coded_width, h.coded_height, h.coded_pixels),
            (100_000, 100_000, 10_000_000_000)
        );
    }

    #[test]
    fn a_grid_counts_its_tiles_and_its_output() {
        // A 100 x 100 output made of four 8000 x 8000 tiles: each tile is decoded whole before the grid is cut.
        let tile = |id| (id, b"hvc1", vec![ispe_box(8000, 8000)]);
        let f = heif_items(
            &[
                (1, b"grid", vec![ispe_box(100, 100)]),
                tile(2),
                tile(3),
                tile(4),
                tile(5),
            ],
            &[2, 3, 4, 5],
        );
        let h = read(&mut std::io::Cursor::new(f)).unwrap().unwrap();
        assert_eq!((h.width, h.height), (100, 100));
        // The walk stops once the tiles pass the budget, at the second.
        assert_eq!(h.coded_pixels, u64::MAX);
        // A tile without its size is judged past any budget.
        let f = heif_items(
            &[
                (1, b"grid", vec![ispe_box(100, 100)]),
                tile(2),
                (3, b"hvc1", vec![]),
            ],
            &[2, 3],
        );
        assert_eq!(
            read(&mut std::io::Cursor::new(f))
                .unwrap()
                .unwrap()
                .coded_pixels,
            u64::MAX
        );
        // An iPhone's 48 MP grid: 8064 x 6048 out of 16 x 12 tiles of 512 x 512, within the budget.
        let mut items = vec![(1u16, b"grid", vec![ispe_box(8064, 6048)])];
        let ids: Vec<u16> = (2..2 + 192).collect();
        items.extend(
            ids.iter()
                .map(|&id| (id, b"hvc1", vec![ispe_box(512, 512)])),
        );
        let h = read(&mut std::io::Cursor::new(heif_items(&items, &ids)))
            .unwrap()
            .unwrap();
        assert_eq!(h.coded_pixels, 192 * 512 * 512);
        assert!(h.coded_pixels <= crate::decode::MAX_PIXELS);
    }

    #[test]
    fn a_grid_of_tens_of_thousands_of_tiles_is_judged_at_once() {
        // 60,000 items, and a grid listing 65,535 tiles: past the cap of sources, so past the budget, and quickly.
        let mut items = vec![(1u16, b"grid", vec![ispe_box(64, 64)])];
        items.extend((2..60_002u32).map(|id| (id as u16, b"hvc1", vec![])));
        let tiles: Vec<u16> = (0..65_535u32).map(|i| (2 + i % 60_000) as u16).collect();
        let started = std::time::Instant::now();
        let h = read(&mut std::io::Cursor::new(heif_items(&items, &tiles)))
            .unwrap()
            .unwrap();
        assert_eq!(h.coded_pixels, u64::MAX);
        assert!(started.elapsed().as_secs() < 2, "{:?}", started.elapsed());
        // A tile that reads 0 x 0 is judged past the budget too.
        let f = heif_items(
            &[
                (1, b"grid", vec![ispe_box(64, 64)]),
                (2, b"hvc1", vec![ispe_box(0, 0)]),
            ],
            &[2],
        );
        assert_eq!(
            read(&mut std::io::Cursor::new(f))
                .unwrap()
                .unwrap()
                .coded_pixels,
            u64::MAX
        );
    }

    #[test]
    fn an_iloc_of_empty_extents_by_the_thousand_is_read_in_bounded_time() {
        let mut infe = 1u16.to_be_bytes().to_vec();
        infe.extend_from_slice(&[0, 0]);
        infe.extend_from_slice(b"Exif\0");
        let mut iinf = 1u16.to_be_bytes().to_vec();
        iinf.extend(full(b"infe", 2, 0, &infe));
        let mut iloc = vec![0x00, 0x00];
        iloc.extend_from_slice(&0xFFFFu16.to_be_bytes());
        for _ in 0..0xFFFF {
            iloc.extend_from_slice(&[0, 2, 0, 0, 0xFF, 0xFF]);
        }
        let meta = full(
            b"meta",
            0,
            0,
            &[
                full(b"pitm", 0, 0, &1u16.to_be_bytes()),
                bx(b"iprp", &[]),
                full(b"iinf", 0, 0, &iinf),
                full(b"iloc", 0, 0, &iloc),
            ]
            .concat(),
        );
        let file = [bx(b"ftyp", b"heic\0\0\0\0mif1heic"), meta].concat();
        let started = std::time::Instant::now();
        let _ = read(&mut std::io::Cursor::new(file));
        assert!(started.elapsed().as_secs() < 2, "{:?}", started.elapsed());
    }

    #[test]
    fn transforms_map_to_exif_orientations() {
        assert_eq!(orientation(&[]), 1);
        assert_eq!(orientation(&[(0, 1)]), 8);
        assert_eq!(orientation(&[(0, 2)]), 3);
        assert_eq!(orientation(&[(0, 3)]), 6);
        assert_eq!(orientation(&[(1, 1)]), 2);
        assert_eq!(orientation(&[(1, 0)]), 4);
        assert_eq!(orientation(&[(0, 3), (1, 1)]), 5);
        assert_eq!(orientation(&[(0, 1), (1, 1)]), 7);
    }

    #[test]
    fn brands_name_the_family() {
        let f = heif(b"heic", 0, b"", b"");
        assert_eq!(brand(&f), Some(Brand::Heic));
        assert_eq!(brand(&heif(b"avif", 0, b"", b"")), Some(Brand::Avif));
        assert_eq!(brand(b"\0\0\0\x18ftypisom\0\0\0\0isomiso2"), None);
    }
}
