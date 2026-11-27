//! What a font file is: its names, units, glyph count, weight, outlines, what it covers, its
//! axes and named instances, its embedding bits and its tables, for each face of a collection. WOFF is inflated and WOFF2
//! decoded here (`wuff`: Brotli and WOFF2's glyf and loca transforms in pure Rust, bounded at 128 MB out and a ratio of
//! 100), so the facts come from the file itself. Read with `skrifa` and `read-fonts`; nothing is installed, nothing in the
//! font runs, and a file past `MAX_FONT_BYTES` is not read.

mod blocks;

use std::fs::File;
use std::io::{self, Read};

use serde::Serialize;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::glyf::Glyph;
use skrifa::raw::{FileRef, FontRef, TableProvider};
use skrifa::string::StringId;
use skrifa::{MetadataProvider, Tag};

/// The largest font file read: the page's own cap ("fonts up to 30 MB").
pub const MAX_FONT_BYTES: u64 = 30 * 1024 * 1024;
/// Faces read from one collection.
const MAX_FACES: u32 = 64;
/// Characters listed for the page's grid; the count past it is still said.
pub const MAX_MAPPED: usize = 6_000;
/// The longest name kept: a licence can run to pages.
const MAX_NAME_CHARS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFacts {
    /// `truetype`, `cff`, `woff`, `woff2` or `collection`.
    pub format: &'static str,
    /// The file's own bytes.
    pub size: u64,
    /// A WOFF or WOFF2's font once unwrapped.
    pub unpacked: Option<u64>,
    /// A WOFF or WOFF2's own table directory, in the file's order.
    pub directory: Vec<WrappedTable>,
    pub faces: Vec<Face>,
    /// Why the faces could not be read, when they could not.
    pub why: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedTable {
    pub tag: String,
    /// As the font holds it.
    pub length: u64,
    /// WOFF: its compressed length; WOFF2 compresses the tables as one stream.
    pub packed: Option<u64>,
    /// WOFF2: stored transformed (glyf, loca, hmtx), rebuilt when read.
    pub transformed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Names {
    pub copyright: Option<String>,
    pub family: Option<String>,
    pub style: Option<String>,
    pub full: Option<String>,
    pub version: Option<String>,
    pub postscript: Option<String>,
    pub trademark: Option<String>,
    pub maker: Option<String>,
    pub designer: Option<String>,
    pub description: Option<String>,
    pub vendor_url: Option<String>,
    pub designer_url: Option<String>,
    pub licence: Option<String>,
    pub licence_url: Option<String>,
    pub typo_family: Option<String>,
    pub typo_style: Option<String>,
    pub sample: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub tag: String,
    pub name: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub name: String,
    /// One per axis, in the axes' order.
    pub coords: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub name: &'static str,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub names: Names,
    pub tables: Vec<String>,
    /// `glyf`, `CFF`, `CFF2`, `bitmaps` or `none`.
    pub outlines: &'static str,
    pub units_per_em: u16,
    pub glyphs: u32,
    pub weight: Option<u16>,
    pub width_class: Option<u16>,
    /// OS/2 fsType.
    pub embedding: Option<u16>,
    pub vendor: Option<String>,
    pub cap_height: Option<i16>,
    pub x_height: Option<i16>,
    pub fixed_pitch: bool,
    pub italic: bool,
    pub axes: Vec<Axis>,
    pub instances: Vec<Instance>,
    /// Characters the cmap maps.
    pub chars: u32,
    pub coverage: Vec<Block>,
    /// The mapped characters in order, at most `MAX_MAPPED`.
    pub mapped: Vec<u32>,
    /// Whether the glyphs carry names of their own (post or CFF).
    pub glyph_names: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphFacts {
    pub glyph: u32,
    pub name: Option<String>,
    /// In font units, at the default axes.
    pub advance: Option<i32>,
    /// -1: made of other glyphs.
    pub contours: Option<i32>,
    pub components: Option<u32>,
    pub points: Option<u32>,
    /// xMin, yMin, xMax, yMax.
    pub bbox: Option<[i32; 4]>,
}

fn bad(what: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.into())
}

/// The file's bytes, refused past `MAX_FONT_BYTES`.
pub fn read_bytes(mut file: File) -> io::Result<Vec<u8>> {
    let len = file.metadata()?.len();
    if len > MAX_FONT_BYTES {
        return Err(bad(format!(
            "the file is {len} bytes, past the {MAX_FONT_BYTES} a font is read to"
        )));
    }
    let mut bytes = Vec::with_capacity(len as usize);
    (&mut file).take(MAX_FONT_BYTES).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// The format the first bytes name, or None for what is not a font.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    match bytes.get(..4)? {
        [0, 1, 0, 0] | b"true" => Some("truetype"),
        b"OTTO" => Some("cff"),
        b"ttcf" => Some("collection"),
        b"wOFF" => Some("woff"),
        b"wOF2" => Some("woff2"),
        _ => None,
    }
}

/// Past this, or a table inflating more than `WOFF_RATIO`-fold, a WOFF1 is refused (wuff bounds only WOFF2).
const WOFF_MAX_OUT: u64 = 128 * 1024 * 1024;
const WOFF_RATIO: u64 = 100;

/// Walks every WOFF1 directory entry (not only the first 1,024) before wuff allocates a table's claimed length.
fn check_woff1(b: &[u8]) -> io::Result<()> {
    let n = be16(b, 12).unwrap_or(0) as usize;
    let mut sum = 0u64;
    for i in 0..n {
        let at = 44 + i * 20;
        let (Some(packed), Some(orig)) = (be32(b, at + 8), be32(b, at + 12)) else {
            break;
        };
        let (packed, orig) = (packed as u64, orig as u64);
        sum += orig;
        if orig > WOFF_MAX_OUT || sum > WOFF_MAX_OUT || orig > packed.max(1) * WOFF_RATIO {
            return Err(bad(format!(
                "its WOFF inflates past the {WOFF_MAX_OUT} bytes (or {WOFF_RATIO} times its size) a font is read to"
            )));
        }
    }
    Ok(())
}

/// The sfnt (or collection) inside `bytes`: itself, or a WOFF inflated, or a WOFF2 decoded.
pub fn unwrap(bytes: &[u8]) -> io::Result<std::borrow::Cow<'_, [u8]>> {
    match sniff(bytes) {
        Some("woff") => check_woff1(bytes)
            .and_then(|_| {
                wuff::decompress_woff1(bytes)
                    .map_err(|e| bad(format!("its WOFF could not be inflated: {e:?}")))
            })
            .map(std::borrow::Cow::Owned),
        Some("woff2") => wuff::decompress_woff2(bytes)
            .map(std::borrow::Cow::Owned)
            .map_err(|e| bad(format!("its WOFF2 could not be decoded: {e:?}"))),
        Some(_) => Ok(std::borrow::Cow::Borrowed(bytes)),
        None => Err(bad("not a font")),
    }
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn tag_text(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect::<String>()
}

/// WOFF's table directory: tag, compressed and original length, after a 44-byte header.
fn woff_directory(b: &[u8]) -> Vec<WrappedTable> {
    let n = be16(b, 12).unwrap_or(0) as usize;
    (0..n.min(1024))
        .map_while(|i| {
            let at = 44 + i * 20;
            Some(WrappedTable {
                tag: tag_text(b.get(at..at + 4)?),
                length: be32(b, at + 12)? as u64,
                packed: Some(be32(b, at + 8)? as u64),
                transformed: false,
            })
        })
        .collect()
}

/// WOFF2's known-table tags, by the index its flags byte gives.
const WOFF2_TAGS: [&str; 63] = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
    "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
    "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
    "Gloc", "Feat", "Sill",
];

fn base128(b: &[u8], at: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    for i in 0..5 {
        let x = *b.get(*at)?;
        *at += 1;
        if i == 0 && x == 0x80 {
            return None;
        }
        v = (v << 7) | (x & 0x7f) as u64;
        if x & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

/// WOFF2's table directory, after its 48-byte header: each table's tag, length, and whether it is stored transformed.
fn woff2_directory(b: &[u8]) -> Vec<WrappedTable> {
    let n = be16(b, 12).unwrap_or(0) as usize;
    let mut at = 48usize;
    let mut out = Vec::new();
    for _ in 0..n.min(1024) {
        let Some(&flags) = b.get(at) else { break };
        at += 1;
        let tag = match WOFF2_TAGS.get((flags & 0x3f) as usize) {
            Some(t) if flags & 0x3f != 63 => (*t).to_string(),
            _ => {
                let Some(t) = b.get(at..at + 4) else { break };
                at += 4;
                tag_text(t)
            }
        };
        let Some(length) = base128(b, &mut at) else {
            break;
        };
        let version = flags >> 6;
        // glyf and loca are transformed at version 0, every other table at any version but 0.
        let transformed = if tag == "glyf" || tag == "loca" {
            version == 0
        } else {
            version != 0
        };
        if transformed && base128(b, &mut at).is_none() {
            break;
        }
        out.push(WrappedTable {
            tag,
            length,
            packed: None,
            transformed,
        });
    }
    out
}

fn name(font: &FontRef, id: u16) -> Option<String> {
    let s: String = font
        .localized_strings(StringId::new(id))
        .english_or_first()?
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let s = s.trim_end_matches('\0').to_string();
    (!s.trim().is_empty()).then_some(s)
}

fn names(font: &FontRef) -> Names {
    Names {
        copyright: name(font, 0),
        family: name(font, 1),
        style: name(font, 2),
        full: name(font, 4),
        version: name(font, 5),
        postscript: name(font, 6),
        trademark: name(font, 7),
        maker: name(font, 8),
        designer: name(font, 9),
        description: name(font, 10),
        vendor_url: name(font, 11),
        designer_url: name(font, 12),
        licence: name(font, 13),
        licence_url: name(font, 14),
        typo_family: name(font, 16),
        typo_style: name(font, 17),
        sample: name(font, 19),
    }
}

fn has(font: &FontRef, tag: &[u8; 4]) -> bool {
    font.table_data(Tag::new(tag)).is_some()
}

fn outlines(font: &FontRef) -> &'static str {
    if has(font, b"glyf") {
        "glyf"
    } else if has(font, b"CFF2") {
        "CFF2"
    } else if has(font, b"CFF ") {
        "CFF"
    } else if has(font, b"CBDT") || has(font, b"sbix") || has(font, b"EBDT") {
        "bitmaps"
    } else {
        "none"
    }
}

fn face(font: &FontRef) -> Face {
    let tables = font
        .table_directory()
        .table_records()
        .iter()
        .map(|r| tag_text(&r.tag().to_be_bytes()))
        .collect();
    let os2 = font.os2().ok();
    let head = font.head().ok();
    let post = font.post().ok();
    let axes: Vec<Axis> = font
        .axes()
        .iter()
        .map(|a| Axis {
            tag: tag_text(&a.tag().to_be_bytes()),
            name: name(font, a.name_id().to_u16())
                .unwrap_or_else(|| tag_text(&a.tag().to_be_bytes())),
            min: a.min_value(),
            default: a.default_value(),
            max: a.max_value(),
            hidden: a.is_hidden(),
        })
        .collect();
    let instances = font
        .named_instances()
        .iter()
        .map(|i| Instance {
            name: name(font, i.subfamily_name_id().to_u16())
                .unwrap_or_else(|| "an instance".into()),
            coords: i.user_coords().collect(),
        })
        .collect();
    let mut mapped = Vec::new();
    let mut chars = 0u32;
    let mut coverage: Vec<Block> = Vec::new();
    for (c, _) in font.charmap().mappings() {
        chars += 1;
        if mapped.len() < MAX_MAPPED {
            mapped.push(c);
        }
        if let Some(block) = blocks::block_of(c) {
            match coverage.iter_mut().find(|b| b.name == block) {
                Some(b) => b.count += 1,
                None => coverage.push(Block {
                    name: block,
                    count: 1,
                }),
            }
        }
    }
    mapped.sort_unstable();
    let glyph_names = font.glyph_names().source() != skrifa::GlyphNameSource::Synthesized;
    Face {
        names: names(font),
        tables,
        outlines: outlines(font),
        units_per_em: head.as_ref().map(|h| h.units_per_em()).unwrap_or(0),
        glyphs: font.maxp().map(|m| m.num_glyphs() as u32).unwrap_or(0),
        weight: os2.as_ref().map(|o| o.us_weight_class()),
        width_class: os2.as_ref().map(|o| o.us_width_class()),
        embedding: os2.as_ref().map(|o| o.fs_type()),
        vendor: os2
            .as_ref()
            .map(|o| tag_text(&o.ach_vend_id().to_be_bytes()).trim().to_string())
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_graphic())),
        cap_height: os2.as_ref().and_then(|o| o.s_cap_height()),
        x_height: os2.as_ref().and_then(|o| o.sx_height()),
        fixed_pitch: post.as_ref().is_some_and(|p| p.is_fixed_pitch() != 0),
        italic: head.as_ref().is_some_and(|h| h.mac_style().bits() & 2 != 0),
        axes,
        instances,
        chars,
        coverage,
        mapped,
        glyph_names,
    }
}

/// The faces in `sfnt` (a font or a collection), at most `MAX_FACES`.
fn faces(sfnt: &[u8]) -> Result<Vec<Face>, String> {
    let file = FileRef::new(sfnt).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for font in file.fonts().take(MAX_FACES as usize) {
        let font = font.map_err(|e| e.to_string())?;
        // The directory is read lazily: a cut file still makes a FontRef, with nothing in it.
        font.head().map_err(|e| format!("its head table: {e}"))?;
        font.maxp().map_err(|e| format!("its maxp table: {e}"))?;
        out.push(face(&font));
    }
    Ok(out)
}

/// The facts of a font file's `bytes`; None when they are not a font.
pub fn facts(bytes: &[u8]) -> Option<FontFacts> {
    let format = sniff(bytes)?;
    let directory = match format {
        "woff" => woff_directory(bytes),
        "woff2" => woff2_directory(bytes),
        _ => Vec::new(),
    };
    let mut out = FontFacts {
        format,
        size: bytes.len() as u64,
        unpacked: None,
        directory,
        faces: Vec::new(),
        why: None,
    };
    match unwrap(bytes) {
        Ok(sfnt) => {
            if matches!(format, "woff" | "woff2") {
                out.unpacked = Some(sfnt.len() as u64);
            }
            match faces(&sfnt) {
                Ok(f) if !f.is_empty() => out.faces = f,
                Ok(_) => out.why = Some("it holds no faces".into()),
                Err(e) => out.why = Some(format!("its tables could not be read: {e}")),
            }
        }
        Err(e) => out.why = Some(e.to_string()),
    }
    Some(out)
}

/// Counts what an outline draws: a contour at each move, a point at each on- or off-curve point.
#[derive(Default)]
struct Counter {
    contours: u32,
    points: u32,
    bbox: Option<[f32; 4]>,
}

impl Counter {
    fn at(&mut self, x: f32, y: f32) {
        self.points += 1;
        let b = self.bbox.get_or_insert([x, y, x, y]);
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    }
}

impl OutlinePen for Counter {
    fn move_to(&mut self, x: f32, y: f32) {
        self.contours += 1;
        self.at(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.at(x, y);
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.at(cx, cy);
        self.at(x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.at(cx0, cy0);
        self.at(cx1, cy1);
        self.at(x, y);
    }
    fn close(&mut self) {}
}

/// What face `index` of `sfnt` holds for the character `code`: its glyph, name, advance and outline. None when the face
/// maps no glyph to it.
pub fn glyph(sfnt: &[u8], index: u32, code: u32) -> Result<Option<GlyphFacts>, String> {
    let font = FontRef::from_index(sfnt, index).map_err(|e| e.to_string())?;
    let Some(gid) = font.charmap().map(code) else {
        return Ok(None);
    };
    let advance = font
        .glyph_metrics(Size::unscaled(), LocationRef::default())
        .advance_width(gid)
        .map(|a| a.round() as i32);
    let name = font
        .glyph_names()
        .get(gid)
        .filter(|n| !n.is_synthesized())
        .map(|n| n.as_str().to_string());
    let mut out = GlyphFacts {
        glyph: gid.to_u32(),
        name,
        advance,
        contours: None,
        components: None,
        points: None,
        bbox: None,
    };
    if let (Ok(glyf), Ok(loca)) = (font.glyf(), font.loca(None)) {
        match loca.get_glyf(gid, &glyf) {
            Ok(Some(Glyph::Simple(g))) => {
                out.contours = Some(g.number_of_contours() as i32);
                out.points = Some(g.num_points() as u32);
                out.bbox = Some([
                    g.x_min() as i32,
                    g.y_min() as i32,
                    g.x_max() as i32,
                    g.y_max() as i32,
                ]);
            }
            Ok(Some(Glyph::Composite(g))) => {
                out.contours = Some(-1);
                out.components = Some(g.components().count() as u32);
                out.bbox = Some([
                    g.x_min() as i32,
                    g.y_min() as i32,
                    g.x_max() as i32,
                    g.y_max() as i32,
                ]);
            }
            Ok(None) => {
                out.contours = Some(0);
                out.points = Some(0);
            }
            Err(_) => {}
        }
        return Ok(Some(out));
    }
    if let Some(outline) = font.outline_glyphs().get(gid) {
        let mut pen = Counter::default();
        if outline
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )
            .is_ok()
        {
            out.contours = Some(pen.contours as i32);
            out.points = Some(pen.points);
            out.bbox = pen.bbox.map(|b| b.map(|v| v.round() as i32));
        }
    }
    Ok(Some(out))
}

/// `font_glyph`'s answer from a font file's `bytes`.
#[cfg(test)]
pub fn glyph_in(bytes: &[u8], index: u32, code: u32) -> Result<Option<GlyphFacts>, String> {
    let sfnt = unwrap(bytes).map_err(|e| e.to_string())?;
    glyph(&sfnt, index, code)
}

#[cfg(test)]
mod stand_in;
#[cfg(test)]
mod tests;
