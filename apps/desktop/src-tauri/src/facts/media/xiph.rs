//! Ogg and FLAC, read by hand from their headers. Ogg: the first pages' packets name each stream's codec (Vorbis, Opus,
//! FLAC, Theora) and carry its comment header; the length is the last page's granule position over the stream's rate.
//! FLAC: STREAMINFO gives the rate, channels, bits and sample count; VORBIS_COMMENT the tags. Never the audio.

use std::io::{self, Read, Seek};

use super::{read_at, tag, MediaFacts, MediaTag, Track, MAX_CHUNKS, MAX_META_BYTES};

/// The most pages walked from the start of an Ogg file for its streams' headers.
const MAX_PAGES: usize = 1024;
/// The tail read for the last page: past the largest page Ogg allows (27 + 255 + 255 * 255 bytes).
const TAIL_BYTES: u64 = 128 * 1024;
const MAX_TAGS: usize = 64;

fn le32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn be(b: &[u8]) -> u64 {
    b.iter().fold(0, |n, &c| (n << 8) | c as u64)
}

const VORBIS_KEYS: &[(&str, &str)] = &[
    ("TITLE", "title"),
    ("ARTIST", "artist"),
    ("ALBUM", "album"),
    ("DATE", "made"),
    ("YEAR", "made"),
    ("ENCODER", "software"),
    ("ENCODED-BY", "software"),
    ("COMMENT", "comment"),
    ("DESCRIPTION", "comment"),
    ("GENRE", "genre"),
    ("COPYRIGHT", "copyright"),
    ("TRACKNUMBER", "track"),
    ("PERFORMER", "artist"),
    ("ALBUMARTIST", "album artist"),
    ("COMPOSER", "composer"),
];

/// A Vorbis comment block (Vorbis's, Opus's after their magic, FLAC's VORBIS_COMMENT): the vendor, then `NAME=value`s.
fn vorbis_comments(b: &[u8], tags: &mut Vec<MediaTag>) {
    let Some(n) = le32(b, 0) else { return };
    let mut at = 4usize.saturating_add(n as usize);
    let vendor = b.get(4..at).map(String::from_utf8_lossy);
    let Some(count) = le32(b, at) else { return };
    at += 4;
    for _ in 0..count.min(4096) {
        let Some(n) = le32(b, at) else { break };
        let Some(field) = b.get(at + 4..(at + 4).saturating_add(n as usize)) else {
            break;
        };
        at += 4 + n as usize;
        let field = String::from_utf8_lossy(field);
        let Some((name, value)) = field.split_once('=') else {
            continue;
        };
        let id = name.to_ascii_uppercase();
        // Pictures are base64 bytes, not words.
        if matches!(id.as_str(), "METADATA_BLOCK_PICTURE" | "COVERART") || value.trim().is_empty() {
            continue;
        }
        if tags.len() >= MAX_TAGS {
            break;
        }
        let key = VORBIS_KEYS
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, k)| *k)
            .unwrap_or(name);
        if !tags.iter().any(|t| t.key == key) {
            tags.push(tag(key, value.trim(), name));
        }
    }
    if let Some(v) = vendor.filter(|v| !v.trim().is_empty()) {
        if !tags.iter().any(|t| t.key == "software") {
            tags.push(tag("software", v.trim(), "vendor"));
        }
    }
}

// ---- Ogg ---------------------------------------------------------------------------------------------------------------

struct Page<'a> {
    bos: bool,
    granule: i64,
    serial: u32,
    lacing: &'a [u8],
    body: &'a [u8],
    len: usize,
}

/// The page at `b[at..]`, when it is whole there.
fn page(b: &[u8], at: usize) -> Option<Page<'_>> {
    if b.get(at..at + 4)? != b"OggS" || *b.get(at + 4)? != 0 {
        return None;
    }
    let granule = i64::from_le_bytes(b.get(at + 6..at + 14)?.try_into().ok()?);
    let serial = le32(b, at + 14)?;
    let segs = *b.get(at + 26)? as usize;
    let lacing = b.get(at + 27..at + 27 + segs)?;
    let size: usize = lacing.iter().map(|&n| n as usize).sum();
    let body = b.get(at + 27 + segs..at + 27 + segs + size)?;
    Some(Page {
        bos: b[at + 5] & 0x02 != 0,
        granule,
        serial,
        lacing,
        body,
        len: 27 + segs + size,
    })
}

#[derive(Default)]
struct Stream {
    serial: u32,
    /// Its first two packets, whole or cut at `MAX_META_BYTES`: the identification header and the comments.
    packets: Vec<Vec<u8>>,
    open: Vec<u8>,
}

impl Stream {
    fn done(&self) -> bool {
        self.packets.len() >= 2
    }

    fn take(&mut self, p: &Page<'_>) {
        let mut at = 0usize;
        for &n in p.lacing {
            if self.done() {
                return;
            }
            let seg = &p.body[at..at + n as usize];
            at += n as usize;
            if (self.open.len() as u64) < MAX_META_BYTES {
                self.open.extend_from_slice(seg);
            }
            if n < 255 {
                self.packets.push(std::mem::take(&mut self.open));
            }
        }
    }
}

/// The rate a stream's granule positions count in, and the pre-skip to take off them.
type Clock = Option<(f64, u64)>;

/// What a stream's first packet says it is: its track, its clock and its codec.
fn ogg_track(id: &[u8]) -> Option<(Track, Clock, &'static str)> {
    if id.starts_with(b"\x01vorbis") {
        let channels = *id.get(11)? as u16;
        let rate = le32(id, 12)?;
        return Some((
            Track {
                kind: "audio",
                codec: "vorbis".into(),
                codec_name: "Vorbis".into(),
                codecs: Some("vorbis".into()),
                channels: Some(channels),
                sample_rate: Some(rate),
                ..Track::default()
            },
            (rate > 0).then_some((rate as f64, 0)),
            "vorbis",
        ));
    }
    if id.starts_with(b"OpusHead") {
        let channels = *id.get(9)? as u16;
        let pre_skip = u16::from_le_bytes(id.get(10..12)?.try_into().ok()?) as u64;
        // Opus always decodes at 48 kHz; the header's own rate is the input's, kept only as information.
        return Some((
            Track {
                kind: "audio",
                codec: "opus".into(),
                codec_name: "Opus".into(),
                codecs: Some("opus".into()),
                channels: Some(channels),
                sample_rate: Some(48_000),
                ..Track::default()
            },
            Some((48_000.0, pre_skip)),
            "opus",
        ));
    }
    if id.starts_with(b"\x7fFLAC") && id.get(9..13) == Some(b"fLaC") {
        let (track, _) = streaminfo(id.get(17..)?)?;
        let rate = track.sample_rate.unwrap_or(0);
        return Some((track, (rate > 0).then_some((rate as f64, 0)), "flac"));
    }
    if id.starts_with(b"\x80theora") {
        return Some((
            Track {
                kind: "video",
                codec: "theora".into(),
                codec_name: "Theora".into(),
                codecs: Some("theora".into()),
                width: Some(be(id.get(14..17)?) as u32),
                height: Some(be(id.get(17..20)?) as u32),
                frame_rate: {
                    let (n, d) = (be(id.get(22..26)?), be(id.get(26..30)?));
                    (n > 0 && d > 0).then(|| n as f64 / d as f64)
                },
                ..Track::default()
            },
            None,
            "theora",
        ));
    }
    None
}

pub(super) fn ogg<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "ogg",
        ..MediaFacts::default()
    };
    let mut streams: Vec<Stream> = Vec::new();
    let mut at = 0u64;
    let mut buf = Vec::new();
    for _ in 0..MAX_PAGES {
        if at >= len {
            break;
        }
        buf = read_at(r, at, 27 + 255)?;
        let segs = *buf.get(26).unwrap_or(&0) as u64;
        let size: u64 = buf
            .get(27..27 + segs as usize)
            .unwrap_or_default()
            .iter()
            .map(|&n| n as u64)
            .sum();
        buf = read_at(r, at, 27 + segs + size)?;
        let Some(p) = page(&buf, 0) else { break };
        if p.bos {
            streams.push(Stream {
                serial: p.serial,
                ..Stream::default()
            });
        }
        if let Some(s) = streams.iter_mut().find(|s| s.serial == p.serial) {
            s.take(&p);
        }
        at += p.len as u64;
        // Every stream starts on the first pages; once a page is not a start and every stream has its headers, done.
        if !p.bos && streams.iter().all(Stream::done) {
            break;
        }
    }
    drop(buf);
    if streams.is_empty() {
        return Ok(None);
    }
    // The tail, for each stream's last granule position.
    let from = len.saturating_sub(TAIL_BYTES);
    let tail = read_at(r, from, TAIL_BYTES)?;
    let mut last: Vec<(u32, i64)> = Vec::new();
    let mut k = 0usize;
    while k + 27 <= tail.len() {
        match page(&tail, k) {
            Some(p) => {
                if p.granule >= 0 {
                    match last.iter_mut().find(|(s, _)| *s == p.serial) {
                        Some(e) => e.1 = p.granule,
                        None => last.push((p.serial, p.granule)),
                    }
                }
                k += p.len;
            }
            None => k += 1,
        }
    }
    for s in &streams {
        let Some(id) = s.packets.first() else {
            continue;
        };
        let Some((track, clock, codec)) = ogg_track(id) else {
            out.tracks.push(Track {
                kind: "other",
                codec: "unknown".into(),
                codec_name: "a stream this does not name".into(),
                ..Track::default()
            });
            continue;
        };
        if let (Some((rate, skip)), Some((_, g)), None) = (
            clock,
            last.iter().find(|(serial, _)| *serial == s.serial),
            out.duration,
        ) {
            out.duration = Some((*g as u64).saturating_sub(skip) as f64 / rate);
            out.duration_from = Some("granule");
        }
        if let Some(c) = s.packets.get(1) {
            match codec {
                "vorbis" if c.starts_with(b"\x03vorbis") => vorbis_comments(&c[7..], &mut out.tags),
                "opus" if c.starts_with(b"OpusTags") => vorbis_comments(&c[8..], &mut out.tags),
                // Ogg FLAC's second packet is a metadata block: its header, then a VORBIS_COMMENT's body.
                "flac" if c.first().is_some_and(|b| b & 0x7f == 4) => {
                    vorbis_comments(c.get(4..).unwrap_or_default(), &mut out.tags)
                }
                _ => {}
            }
        }
        out.tracks.push(track);
    }
    // A video stream first, as the other containers list it.
    out.tracks.sort_by_key(|t| t.kind != "video");
    Ok(Some(out))
}

// ---- FLAC --------------------------------------------------------------------------------------------------------------

/// STREAMINFO's body: the track, and its sample count where it is written (0 is "not known").
fn streaminfo(b: &[u8]) -> Option<(Track, u64)> {
    let bits = be(b.get(10..18)?);
    let rate = (bits >> 44) as u32;
    let channels = ((bits >> 41) & 0x7) as u16 + 1;
    let depth = ((bits >> 36) & 0x1f) as u16 + 1;
    let samples = bits & 0xF_FFFF_FFFF;
    Some((
        Track {
            kind: "audio",
            codec: "flac".into(),
            codec_name: "FLAC".into(),
            codecs: Some("flac".into()),
            channels: Some(channels),
            sample_rate: Some(rate),
            bits: Some(depth),
            ..Track::default()
        },
        samples,
    ))
}

/// A FLAC file whose `fLaC` marker is at `start` (after an ID3 tag, where a tagger put one).
pub(super) fn flac<R: Read + Seek>(
    r: &mut R,
    len: u64,
    start: u64,
) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "flac",
        ..MediaFacts::default()
    };
    let mut at = start + 4;
    let mut info = None;
    for _ in 0..MAX_CHUNKS {
        if at + 4 > len {
            break;
        }
        let h = read_at(r, at, 4)?;
        let (last, kind, size) = (h[0] & 0x80 != 0, h[0] & 0x7f, be(&h[1..4]));
        match kind {
            0 => info = streaminfo(&read_at(r, at + 4, size.min(64))?),
            4 => vorbis_comments(
                &read_at(r, at + 4, size.min(MAX_META_BYTES))?,
                &mut out.tags,
            ),
            _ => {}
        }
        at += 4 + size;
        if last {
            break;
        }
    }
    let Some((track, samples)) = info else {
        return Ok(None);
    };
    if let (Some(rate), true) = (track.sample_rate.filter(|&r| r > 0), samples > 0) {
        out.duration = Some(samples as f64 / rate as f64);
        out.duration_from = Some("streaminfo");
    }
    out.tracks.push(track);
    Ok(Some(out))
}
