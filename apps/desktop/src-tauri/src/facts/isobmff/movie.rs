//! MP4 and QuickTime movies: the boxes' own facts, `ftyp`, `moov` (read whole, up to `MAX_MOOV_BYTES`) and, for a
//! fragmented file, each `moof`'s sample counts; never `mdat`.

use std::io::{self, Read, Seek, SeekFrom};

use super::{be, boxes, child};
use crate::facts::media::{tag, MediaFacts, MediaTag, Track};

/// The most bytes of `moov` read: a long film's sample tables run to a few megabytes.
const MAX_MOOV_BYTES: u64 = 32 * 1024 * 1024;
/// The most bytes of one `moof` read, and of every `moof` together, for a fragmented file's frame count.
const MAX_MOOF_BYTES: u64 = 1024 * 1024;
const MAX_MOOFS_BYTES: u64 = 64 * 1024 * 1024;
/// Top-level boxes walked: a fragmented file has two a fragment.
const MAX_MOVIE_BOXES: usize = 200_000;

/// A full box's version, flags, and content past them.
fn full_box(c: &[u8]) -> (u8, u32, &[u8]) {
    let v = c.first().copied().unwrap_or(0);
    let flags = be(c, 0, 4).unwrap_or(0) as u32 & 0xFF_FFFF;
    (v, flags, c.get(4..).unwrap_or_default())
}

fn path<'a>(b: &'a [u8], path: &[&[u8; 4]]) -> Option<&'a [u8]> {
    path.iter().try_fold(b, |at, kind| child(at, kind))
}

fn fourcc(b: &[u8]) -> String {
    b.iter()
        .map(|&c| {
            if c.is_ascii_graphic() || c == b' ' {
                c as char
            } else {
                '?'
            }
        })
        .collect()
}

fn codec_name(code: &str) -> String {
    match code {
        "avc1" | "avc3" => "H.264 (AVC)",
        "hvc1" | "hev1" => "H.265 (HEVC)",
        "dvh1" | "dvhe" => "Dolby Vision (HEVC)",
        "av01" => "AV1",
        "vp09" => "VP9",
        "vp08" => "VP8",
        "mp4v" => "MPEG-4 Part 2",
        "apch" => "Apple ProRes 422 HQ",
        "apcn" => "Apple ProRes 422",
        "apcs" => "Apple ProRes 422 LT",
        "apco" => "Apple ProRes 422 Proxy",
        "ap4h" => "Apple ProRes 4444",
        "ap4x" => "Apple ProRes 4444 XQ",
        "jpeg" | "mjpa" | "mjpb" => "Motion JPEG",
        "dvc " | "dvcp" | "dv5p" | "dv5n" => "DV",
        "mp4a" => "AAC (mp4a)",
        "ac-3" => "Dolby Digital (AC-3)",
        "ec-3" => "Dolby Digital Plus",
        "Opus" => "Opus",
        "fLaC" => "FLAC",
        "alac" => "Apple Lossless",
        "sowt" => "PCM, little-endian",
        "twos" => "PCM, big-endian",
        "lpcm" => "PCM",
        "in24" => "PCM, 24-bit",
        "in32" => "PCM, 32-bit",
        "fl32" | "fl64" => "PCM, floating point",
        "ulaw" => "µ-law",
        "alaw" => "A-law",
        "tx3g" => "timed text",
        "wvtt" => "WebVTT",
        "c608" | "c708" => "closed captions",
        "tmcd" => "timecode",
        other => return other.trim().to_string(),
    }
    .to_string()
}

/// An `esds` descriptor's length: one to four bytes of seven bits.
fn descriptor_len(b: &[u8], at: &mut usize) -> Option<usize> {
    let mut n = 0usize;
    for _ in 0..4 {
        let x = *b.get(*at)?;
        *at += 1;
        n = (n << 7) | (x & 0x7f) as usize;
        if x & 0x80 == 0 {
            break;
        }
    }
    Some(n)
}

/// `mp4a.40.2` from an `esds`: its object type, then (for MPEG-4 audio) the audio object type.
fn esds_codecs(esds: &[u8]) -> Option<String> {
    let (_, _, b) = full_box(esds);
    let mut at = 0usize;
    if *b.get(at)? != 0x03 {
        return None;
    }
    at += 1;
    descriptor_len(b, &mut at)?;
    let flags = *b.get(at + 2)?;
    at += 3;
    if flags & 0x80 != 0 {
        at += 2;
    }
    if flags & 0x40 != 0 {
        at += 1 + *b.get(at)? as usize;
    }
    if flags & 0x20 != 0 {
        at += 2;
    }
    if *b.get(at)? != 0x04 {
        return None;
    }
    at += 1;
    descriptor_len(b, &mut at)?;
    let oti = *b.get(at)?;
    at += 13;
    if oti != 0x40 {
        return Some(format!("mp4a.{oti:02X}"));
    }
    if b.get(at) != Some(&0x05) {
        return Some("mp4a.40".into());
    }
    at += 1;
    descriptor_len(b, &mut at)?;
    let aot = b.get(at)? >> 3;
    Some(format!("mp4a.40.{aot}"))
}

const PCM_CODES: &[&str] = &[
    "sowt", "twos", "lpcm", "in24", "in32", "fl32", "fl64", "raw ",
];

/// A track's id, its facts, and its media's timescale and duration, from its `trak`.
fn track(trak: &[u8]) -> (u32, Track, Option<u64>) {
    let mut t = Track {
        kind: "other",
        ..Track::default()
    };
    let (tv, _, tkhd) = child(trak, b"tkhd").map(full_box).unwrap_or((0, 0, &[]));
    let id = be(tkhd, if tv == 1 { 16 } else { 8 }, 4).unwrap_or(0) as u32;
    let (timescale, duration) = match path(trak, &[b"mdia", b"mdhd"]).map(full_box) {
        Some((1, _, c)) => (be(c, 16, 4), be(c, 20, 8)),
        Some((_, _, c)) => (be(c, 8, 4), be(c, 12, 4)),
        None => (None, None),
    };
    let timescale = timescale.filter(|&t| t > 0);
    t.kind = match path(trak, &[b"mdia", b"hdlr"]).and_then(|h| h.get(8..12)) {
        Some(b"vide") => "video",
        Some(b"soun") => "audio",
        Some(b"text" | b"sbtl" | b"subt" | b"clcp") => "text",
        _ => "other",
    };
    let stbl = path(trak, &[b"mdia", b"minf", b"stbl"]);
    // The first sample entry: its size, its code, then its fields.
    if let Some(entry) = stbl
        .and_then(|s| child(s, b"stsd"))
        .and_then(|s| s.get(8..))
    {
        let code = fourcc(entry.get(4..8).unwrap_or_default());
        t.codec_name = codec_name(&code);
        match t.kind {
            "video" => {
                t.width = be(entry, 32, 2).map(|v| v as u32);
                t.height = be(entry, 34, 2).map(|v| v as u32);
                if let Some(&n) = entry.get(50) {
                    let name = String::from_utf8_lossy(
                        entry.get(51..51 + n.min(31) as usize).unwrap_or_default(),
                    )
                    .trim()
                    .to_string();
                    if !name.is_empty() {
                        t.compressor = Some(name);
                    }
                }
                let kids = entry.get(86..).map(boxes).unwrap_or_default();
                if let Some((_, avcc)) = kids.iter().find(|(k, _)| k == b"avcC") {
                    if let Some(p) = avcc.get(1..4) {
                        t.codecs = Some(format!("{code}.{:02X}{:02X}{:02X}", p[0], p[1], p[2]));
                    }
                }
                if matches!(code.as_str(), "vp09" | "av01" | "hvc1" | "hev1" | "vp08") {
                    t.codecs = Some(code.clone());
                }
            }
            "audio" => {
                let version = be(entry, 16, 2).unwrap_or(0);
                if version == 2 {
                    t.sample_rate = entry
                        .get(40..48)
                        .and_then(|b| b.try_into().ok())
                        .map(|b| f64::from_be_bytes(b).round() as u32);
                    t.channels = be(entry, 48, 4).map(|v| v as u16);
                    t.bits = be(entry, 56, 4).map(|v| v as u16);
                } else {
                    t.channels = be(entry, 24, 2).map(|v| v as u16);
                    t.bits = be(entry, 26, 2).map(|v| v as u16);
                    t.sample_rate = be(entry, 32, 2).map(|v| v as u32);
                }
                // A compressed track's sample size is nominal; only PCM's means anything.
                if !PCM_CODES.contains(&code.as_str()) {
                    t.bits = None;
                }
                let skip = match version {
                    1 => 52,
                    2 => 72,
                    _ => 36,
                };
                let kids = entry.get(skip..).map(boxes).unwrap_or_default();
                if let Some((_, esds)) = kids.iter().find(|(k, _)| k == b"esds") {
                    t.codecs = esds_codecs(esds);
                }
                match code.as_str() {
                    "Opus" => t.codecs = Some("opus".into()),
                    "fLaC" => t.codecs = Some("flac".into()),
                    _ => {}
                }
            }
            _ => {}
        }
        t.codec = code;
    }
    if t.kind == "video" {
        if t.width.unwrap_or(0) == 0 || t.height.unwrap_or(0) == 0 {
            let n = tkhd.len();
            t.width = be(tkhd, n.saturating_sub(8), 4).map(|v| (v >> 16) as u32);
            t.height = be(tkhd, n.saturating_sub(4), 4).map(|v| (v >> 16) as u32);
        }
        if let (Some((_, _, stts)), Some(ts)) = (
            stbl.and_then(|s| child(s, b"stts")).map(full_box),
            timescale,
        ) {
            let n = be(stts, 0, 4).unwrap_or(0) as usize;
            let mut frames = 0u64;
            for i in 0..n.min(1 << 20) {
                frames += be(stts, 4 + i * 8, 4).unwrap_or(0);
            }
            if n == 1 {
                let delta = be(stts, 8, 4).unwrap_or(0);
                if delta > 0 {
                    t.frame_rate = Some(ts as f64 / delta as f64);
                }
            } else if n > 1 {
                if let Some(d) = duration.filter(|&d| d > 0) {
                    t.frame_rate = Some(frames as f64 * ts as f64 / d as f64);
                    t.frame_rate_average = true;
                }
            }
            if frames > 0 {
                t.frames = Some(frames);
            }
        }
    }
    (id, t, timescale.and(duration))
}

/// The tags in a `udta`: QuickTime's `©nam` and the like, and MP4's `meta`/`ilst`.
fn tags(udta: &[u8]) -> Vec<MediaTag> {
    const KEYS: &[(&[u8; 4], &str)] = &[
        (b"\xa9nam", "title"),
        (b"\xa9ART", "artist"),
        (b"\xa9alb", "album"),
        (b"\xa9day", "made"),
        (b"\xa9too", "software"),
        (b"\xa9swr", "software"),
        (b"\xa9cmt", "comment"),
        (b"\xa9des", "description"),
        (b"\xa9gen", "genre"),
        (b"cprt", "copyright"),
    ];
    let shown = |k: &[u8; 4]| {
        let first = if k[0] == 0xa9 { '©' } else { k[0] as char };
        format!("{first}{}", String::from_utf8_lossy(&k[1..]))
    };
    let mut out: Vec<MediaTag> = Vec::new();
    for (k, c) in boxes(udta) {
        let Some((_, key)) = KEYS.iter().find(|(i, _)| **i == k) else {
            continue;
        };
        let n = be(c, 0, 2).unwrap_or(0) as usize;
        let v = String::from_utf8_lossy(c.get(4..4 + n).unwrap_or_default())
            .trim()
            .to_string();
        if !v.is_empty() {
            out.push(tag(key, v, &shown(&k)));
        }
    }
    let ilst = child(udta, b"meta")
        .and_then(|m| m.get(4..))
        .and_then(|m| child(m, b"ilst"));
    for (k, c) in ilst.map(boxes).unwrap_or_default() {
        let Some((_, key)) = KEYS.iter().find(|(i, _)| **i == k) else {
            continue;
        };
        if let Some(d) = child(c, b"data") {
            let v = String::from_utf8_lossy(d.get(8..).unwrap_or_default())
                .trim()
                .to_string();
            if !v.is_empty() && !out.iter().any(|t| t.key == *key) {
                out.push(tag(key, v, &shown(&k)));
            }
        }
    }
    out
}

fn read_at<R: Read + Seek>(r: &mut R, at: u64, n: u64) -> io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(at))?;
    let mut b = Vec::with_capacity(n.min(1 << 20) as usize);
    r.take(n).read_to_end(&mut b)?;
    Ok(b)
}

/// An MP4 or QuickTime file's facts from its boxes.
pub fn movie<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "mp4",
        ..MediaFacts::default()
    };
    let mut at = 0u64;
    let mut moov: Option<Vec<u8>> = None;
    let mut moofs: Vec<(u64, u64)> = Vec::new();
    let mut mdat_seen = false;
    for _ in 0..MAX_MOVIE_BOXES {
        if at + 8 > len {
            break;
        }
        r.seek(SeekFrom::Start(at))?;
        let mut h = [0u8; 16];
        r.read_exact(&mut h[..8])?;
        let (header, size) = match u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64 {
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
        let kind: [u8; 4] = h[4..8].try_into().unwrap_or_default();
        if out.boxes.len() < 32 {
            out.boxes.push(fourcc(&kind));
        }
        match &kind {
            b"ftyp" => {
                let b = read_at(r, at + header, (size - header).min(256))?;
                let brand = fourcc(b.get(..4).unwrap_or_default());
                if brand == "qt  " {
                    out.container = "mov";
                }
                out.brand = Some(brand.trim().to_string());
            }
            b"moov" if size - header <= MAX_MOOV_BYTES => {
                moov = Some(read_at(r, at + header, size - header)?);
                out.index_first.get_or_insert(!mdat_seen);
            }
            b"mdat" => mdat_seen = true,
            b"moof" => {
                out.fragmented = true;
                moofs.push((at + header, size - header));
            }
            _ => {}
        }
        at = at.saturating_add(size);
    }
    if out.brand.is_none() {
        out.container = "mov";
    }
    let Some(moov) = moov else {
        return Ok(Some(out));
    };
    let mvhd = child(&moov, b"mvhd").map(full_box);
    let movie_scale = mvhd
        .and_then(|(v, _, c)| be(c, if v == 1 { 16 } else { 8 }, 4))
        .filter(|&t| t > 0);
    if let (Some((v, _, c)), Some(ts)) = (mvhd, movie_scale) {
        let d = if v == 1 { be(c, 20, 8) } else { be(c, 12, 4) };
        // A duration of all ones means "not known".
        if let Some(d) = d.filter(|&d| d > 0 && d != u32::MAX as u64 && d != u64::MAX) {
            out.duration = Some(d as f64 / ts as f64);
            out.duration_from = Some("movie");
        }
    }
    // A fragmented file's mvhd may give only the part before its fragments; mvex/mehd gives the whole.
    if let (Some((v, _, c)), Some(ts)) =
        (path(&moov, &[b"mvex", b"mehd"]).map(full_box), movie_scale)
    {
        if let Some(d) = (if v == 1 { be(c, 0, 8) } else { be(c, 0, 4) }).filter(|&d| d > 0) {
            out.duration = Some(d as f64 / ts as f64);
            out.duration_from = Some("movie");
        }
    }
    let mut tracks: Vec<(u32, Track, Option<u64>)> = boxes(&moov)
        .into_iter()
        .filter(|(k, _)| k == b"trak")
        .map(|(_, c)| track(c))
        .collect();
    if out.fragmented {
        // Each fragment's runs count its samples, track by track: a recording's frame rate is their sum over its length.
        let mut counts: Vec<(u32, u64)> = Vec::new();
        let mut read = 0u64;
        for (at, n) in moofs {
            if n > MAX_MOOF_BYTES || read + n > MAX_MOOFS_BYTES {
                counts.clear();
                break;
            }
            read += n;
            let moof = read_at(r, at, n)?;
            for (_, traf) in boxes(&moof).into_iter().filter(|(k, _)| k == b"traf") {
                let id = child(traf, b"tfhd")
                    .map(full_box)
                    .and_then(|(_, _, c)| be(c, 0, 4))
                    .unwrap_or(0) as u32;
                let samples: u64 = boxes(traf)
                    .into_iter()
                    .filter(|(k, _)| k == b"trun")
                    .filter_map(|(_, c)| be(full_box(c).2, 0, 4))
                    .sum();
                match counts.iter_mut().find(|(i, _)| *i == id) {
                    Some(c) => c.1 += samples,
                    None => counts.push((id, samples)),
                }
            }
        }
        let length = out.duration.filter(|&d| d > 0.0);
        for (id, t, _) in tracks.iter_mut().filter(|(_, t, _)| t.kind == "video") {
            let n = counts
                .iter()
                .find(|(i, _)| i == id)
                .map(|(_, n)| *n)
                .unwrap_or(0);
            if let (true, Some(d)) = (n > 0, length) {
                let frames = n + t.frames.unwrap_or(0);
                t.frames = Some(frames);
                t.frame_rate = Some(frames as f64 / d);
                t.frame_rate_average = true;
            }
        }
    }
    out.tracks = tracks.into_iter().map(|(_, t, _)| t).collect();
    if let Some(udta) = child(&moov, b"udta") {
        out.tags = tags(udta);
    }
    Ok(Some(out))
}
