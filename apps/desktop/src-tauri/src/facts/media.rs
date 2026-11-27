//! What an audio or video file is, from its container's header alone: its length,
//! tracks, codecs, size, rates, channels and tags. WAV from its chunks (fmt, data, LIST INFO); MP4 and QuickTime from
//! their boxes (`isobmff::movie`); Matroska and WebM from their EBML header, Info, Tracks and Tags; MP3 from its ID3 tag
//! and first frame (a Xing or VBRI count where there is one); Ogg and FLAC from their headers (`xiph`). Never the
//! samples, but for a PCM WAV's envelope, read in bounded steps.

use std::io::{self, Read, Seek, SeekFrom};

use serde::Serialize;

use super::isobmff;

mod xiph;

/// The most chunks walked in a RIFF file, elements in a Matroska segment's top level.
const MAX_CHUNKS: usize = 4096;
/// The most bytes of a LIST INFO, an ID3 tag, a Matroska Info, Tracks or Tags element read.
const MAX_META_BYTES: u64 = 1024 * 1024;
/// The most buckets an envelope is asked for.
pub const MAX_BUCKETS: usize = 4096;
/// A PCM data chunk up to this size is read whole for its envelope; past it, a window at each bucket.
pub const ENVELOPE_WHOLE_BYTES: u64 = 64 * 1024 * 1024;
/// Frames read at each bucket of a sampled envelope, fewer when the frames are wide (see `ENVELOPE_WHOLE_BYTES`).
const WINDOW_FRAMES: u64 = 2048;
/// The most channels whose envelope is read. WAVE_FORMAT_EXTENSIBLE's mask names 18 speaker positions and higher-order
/// ambisonics stop at 64; a header claiming more is made up, and a frame that wide makes every read huge.
const MAX_ENVELOPE_CHANNELS: u16 = 256;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFacts {
    /// `wav`, `aiff`, `mp4`, `mov`, `matroska`, `webm`, `mp3`, `ogg` or `flac`.
    pub container: &'static str,
    /// MP4's major brand, Matroska's DocType.
    pub brand: Option<String>,
    /// Seconds.
    pub duration: Option<f64>,
    /// Where the length came from: `data` (WAV's data size and byte rate), `movie` (the movie header), `segment`
    /// (Matroska's Info), `frames` (an MP3's frame count), `bitrate` (an MP3's bit rate and size: an estimate),
    /// `granule` (an Ogg stream's last granule position), `streaminfo` (FLAC's sample count).
    pub duration_from: Option<&'static str>,
    pub fragmented: bool,
    /// The top-level boxes, in order, at most 32 (MP4, QuickTime).
    pub boxes: Vec<String>,
    /// The index (moov) comes before the media data, so a player can start at once.
    pub index_first: Option<bool>,
    pub tracks: Vec<Track>,
    pub tags: Vec<MediaTag>,
    /// A PCM WAV's samples, where its envelope is read from.
    pub pcm: Option<Pcm>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// `video`, `audio`, `text` or `other`.
    pub kind: &'static str,
    /// As the container names it: a four-character code (`avc1`, `apch`), a Matroska codec id (`V_VP9`), `pcm`, `mp3`.
    pub codec: String,
    /// In words: "H.264 (AVC)", "Apple ProRes 422 HQ", "PCM, little-endian".
    pub codec_name: String,
    /// The RFC 6381 string a player is asked about ("avc1.640028", "mp4a.40.2"), where the header gives it.
    pub codecs: Option<String>,
    /// A visual sample entry's compressor name.
    pub compressor: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
    /// The rate is frames over length: the track has no fixed rate.
    pub frame_rate_average: bool,
    pub frames: Option<u64>,
    pub channels: Option<u16>,
    pub sample_rate: Option<u32>,
    /// PCM's bits a sample; compressed audio's is nominal and not said.
    pub bits: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTag {
    /// title, artist, album, made, software, comment, genre...
    pub key: String,
    pub value: String,
    /// As the file names it: `INAM`, `©nam`, `TIT2`, `TITLE`.
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pcm {
    pub data_at: u64,
    pub data_len: u64,
    pub channels: u16,
    pub bits: u16,
    pub float: bool,
    pub rate: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    /// Per bucket, the lowest and highest sample over every channel, from -1 to 1.
    pub peaks: Vec<[f32; 2]>,
    /// Read from a window at each bucket rather than every sample (a long file).
    pub sampled: bool,
}

pub(crate) fn tag(key: &str, value: impl Into<String>, id: &str) -> MediaTag {
    MediaTag {
        key: key.into(),
        value: value.into(),
        id: id.into(),
    }
}

fn le16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn le32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn read_at<R: Read + Seek>(r: &mut R, at: u64, n: u64) -> io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(at))?;
    let mut b = Vec::with_capacity(n.min(1 << 20) as usize);
    r.take(n).read_to_end(&mut b)?;
    Ok(b)
}

/// The container the first bytes name, or None.
pub fn sniff(head: &[u8]) -> Option<&'static str> {
    if head.get(..4) == Some(b"RIFF") && head.get(8..12) == Some(b"WAVE") {
        return Some("wav");
    }
    if head.get(..4) == Some(b"FORM") && matches!(head.get(8..12), Some(b"AIFF" | b"AIFC")) {
        return Some("aiff");
    }
    if head.get(4..8) == Some(b"ftyp") {
        return Some(if head.get(8..12) == Some(b"qt  ") {
            "mov"
        } else {
            "mp4"
        });
    }
    // An old QuickTime file may start with its moov, mdat or a wide/free box.
    if matches!(head.get(4..8), Some(b"moov" | b"mdat" | b"wide" | b"free")) {
        return Some("mov");
    }
    if head.get(..4) == Some(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some("matroska");
    }
    if head.get(..4) == Some(b"OggS") {
        return Some("ogg");
    }
    if head.get(..4) == Some(b"fLaC") {
        return Some("flac");
    }
    if head.get(..3) == Some(b"ID3") || mpeg_frame(head, 0).is_some() {
        return Some("mp3");
    }
    None
}

/// The facts of the media file in `r`; None when it is not a container this reads.
pub fn read<R: Read + Seek>(r: &mut R) -> io::Result<Option<MediaFacts>> {
    let head = read_at(r, 0, 64)?;
    let len = r.seek(SeekFrom::End(0))?;
    Ok(match sniff(&head) {
        Some("wav") => wav(r, len)?,
        Some("aiff") => aiff(r, len)?,
        Some("mp4") | Some("mov") => isobmff::movie(r, len)?,
        Some("matroska") => matroska(r, len)?,
        Some("ogg") => xiph::ogg(r, len)?,
        Some("flac") => xiph::flac(r, len, 0)?,
        // A tagger may put an ID3 tag before a FLAC file's marker.
        Some("mp3") => {
            match id3_end(&head).filter(|&at| read_at(r, at, 4).is_ok_and(|m| m == b"fLaC")) {
                Some(at) => xiph::flac(r, len, at)?,
                None => mp3(r, len)?,
            }
        }
        _ => None,
    })
}

// ---- AIFF --------------------------------------------------------------------------------------------------------------

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// AIFF writes its sample rate as an 80-bit IEEE extended float.
fn extended(b: &[u8]) -> Option<f64> {
    let exp = (be16(b, 0)? & 0x7fff) as i32;
    let mant = u64::from_be_bytes(b.get(2..10)?.try_into().ok()?);
    if exp == 0 && mant == 0 {
        return Some(0.0);
    }
    Some(mant as f64 * 2f64.powi(exp - 16383 - 63))
}

fn aiff<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "aiff",
        ..MediaFacts::default()
    };
    let form = read_at(r, 8, 4)?;
    let compressed = form == b"AIFC";
    let mut at = 12u64;
    for _ in 0..MAX_CHUNKS {
        if at + 8 > len {
            break;
        }
        let h = read_at(r, at, 8)?;
        let id: [u8; 4] = h[..4].try_into().unwrap_or_default();
        let size = be32(&h, 4).unwrap_or(0) as u64;
        let body = at + 8;
        match &id {
            b"COMM" if out.tracks.is_empty() => {
                let c = read_at(r, body, size.min(64))?;
                if c.len() < 18 {
                    break;
                }
                let channels = be16(&c, 0).unwrap_or(0);
                let frames = be32(&c, 2).unwrap_or(0) as u64;
                let bits = be16(&c, 6).unwrap_or(0);
                let rate = c
                    .get(8..18)
                    .and_then(extended)
                    .filter(|r| (1.0..1e9).contains(r));
                let (codec, name) = match (compressed, c.get(18..22)) {
                    (true, Some(b"sowt")) => ("pcm", "PCM, little-endian".to_string()),
                    (true, Some(b"twos" | b"in24" | b"in32")) => {
                        ("pcm", "PCM, big-endian".to_string())
                    }
                    (true, Some(b"raw ")) => ("pcm", "PCM, unsigned 8-bit".to_string()),
                    (true, Some(b"fl32" | b"FL32" | b"fl64" | b"FL64")) => {
                        ("pcm-float", "PCM, floating point".to_string())
                    }
                    (true, Some(b"NONE")) | (false, _) => ("pcm", "PCM".to_string()),
                    (true, Some(t)) => ("other", String::from_utf8_lossy(t).trim().to_string()),
                    (true, None) => ("other", "compressed".to_string()),
                };
                out.tracks.push(Track {
                    kind: "audio",
                    codec: codec.into(),
                    codec_name: name,
                    channels: (channels > 0).then_some(channels),
                    sample_rate: rate.map(|r| r.round() as u32),
                    bits: (codec != "other" && bits > 0).then_some(bits),
                    frames: Some(frames),
                    ..Track::default()
                });
                if let Some(rate) = rate.filter(|_| frames > 0) {
                    out.duration = Some(frames as f64 / rate);
                    out.duration_from = Some("frames");
                }
            }
            b"ID3 " => {
                let t = read_at(r, body, size.min(MAX_META_BYTES + 10))?;
                if t.len() >= 10 && t.get(..3) == Some(b"ID3") {
                    id3_frames(&t[10..], t[3], &mut out);
                }
            }
            b"NAME" | b"AUTH" | b"(c) " | b"ANNO" => {
                let v = latin_or_utf8(&read_at(r, body, size.min(MAX_META_BYTES))?);
                let key = match &id {
                    b"NAME" => "title",
                    b"AUTH" => "artist",
                    b"(c) " => "copyright",
                    _ => "comment",
                };
                if !v.is_empty() && !out.tags.iter().any(|t| t.key == key) {
                    out.tags.push(tag(key, v, &String::from_utf8_lossy(&id)));
                }
            }
            _ => {}
        }
        at = body.saturating_add(size).saturating_add(size & 1);
    }
    Ok(Some(out))
}

// ---- WAV ---------------------------------------------------------------------------------------------------------------

const INFO_KEYS: &[(&[u8; 4], &str)] = &[
    (b"INAM", "title"),
    (b"IART", "artist"),
    (b"IPRD", "album"),
    (b"ICRD", "made"),
    (b"ISFT", "software"),
    (b"ICMT", "comment"),
    (b"IGNR", "genre"),
    (b"ICOP", "copyright"),
    (b"IENG", "engineer"),
    (b"ITRK", "track"),
    (b"IPRT", "track"),
];

fn latin_or_utf8(b: &[u8]) -> String {
    let b = b.split(|&c| c == 0).next().unwrap_or_default();
    match std::str::from_utf8(b) {
        Ok(s) => s.trim().to_string(),
        Err(_) => b
            .iter()
            .map(|&c| c as char)
            .collect::<String>()
            .trim()
            .to_string(),
    }
}

fn wav<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "wav",
        ..MediaFacts::default()
    };
    let mut fmt: Option<Vec<u8>> = None;
    let mut data: Option<(u64, u64)> = None;
    let mut at = 12u64;
    for _ in 0..MAX_CHUNKS {
        if at + 8 > len {
            break;
        }
        let h = read_at(r, at, 8)?;
        let id: [u8; 4] = h[..4].try_into().unwrap_or_default();
        let size = le32(&h, 4).unwrap_or(0) as u64;
        let body = at + 8;
        match &id {
            b"fmt " => fmt = Some(read_at(r, body, size.min(64))?),
            b"data" => {
                // A writer that never came back to fill in the size leaves 0 or 0xFFFFFFFF: the rest of the file.
                let n = if size == 0 || size == 0xFFFF_FFFF || body + size > len {
                    len.saturating_sub(body)
                } else {
                    size
                };
                data = Some((body, n));
            }
            b"LIST" => {
                let list = read_at(r, body, size.min(MAX_META_BYTES))?;
                if list.get(..4) == Some(b"INFO") {
                    let mut k = 4usize;
                    while k + 8 <= list.len() {
                        let sid: [u8; 4] = list[k..k + 4].try_into().unwrap_or_default();
                        let n = le32(&list, k + 4).unwrap_or(0) as usize;
                        let v = list
                            .get(k + 8..(k + 8).saturating_add(n).min(list.len()))
                            .unwrap_or_default();
                        let value = latin_or_utf8(v);
                        if !value.is_empty() {
                            let key = INFO_KEYS.iter().find(|(i, _)| *i == &sid).map(|(_, k)| *k);
                            let id = String::from_utf8_lossy(&sid).into_owned();
                            out.tags.push(tag(key.unwrap_or(&id), value, &id));
                        }
                        k += 8 + n + (n & 1);
                    }
                }
            }
            _ => {}
        }
        at = body.saturating_add(size).saturating_add(size & 1);
        if data.is_some() && size == 0xFFFF_FFFF {
            break;
        }
    }
    let Some(fmt) = fmt else {
        return Ok(Some(out));
    };
    let mut format = le16(&fmt, 0).unwrap_or(0);
    let channels = le16(&fmt, 2).unwrap_or(0);
    let rate = le32(&fmt, 4).unwrap_or(0);
    let byte_rate = le32(&fmt, 8).unwrap_or(0);
    let bits = le16(&fmt, 14).unwrap_or(0);
    // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of its sub-format GUID.
    if format == 0xFFFE {
        format = le16(&fmt, 24).unwrap_or(format);
    }
    let (codec, name) = match format {
        1 => ("pcm", "PCM".to_string()),
        3 => ("pcm-float", "PCM, floating point".to_string()),
        6 => ("alaw", "A-law".to_string()),
        7 => ("ulaw", "µ-law".to_string()),
        0x11 => ("ima-adpcm", "IMA ADPCM".to_string()),
        0x55 => ("mp3", "MP3".to_string()),
        n => ("other", format!("format {n}")),
    };
    let pcm = matches!(format, 1 | 3);
    out.tracks.push(Track {
        kind: "audio",
        codec: codec.into(),
        codec_name: name,
        channels: Some(channels),
        sample_rate: Some(rate),
        bits: (pcm || matches!(format, 6 | 7)).then_some(bits),
        ..Track::default()
    });
    if let Some((data_at, data_len)) = data {
        if byte_rate > 0 {
            out.duration = Some(data_len as f64 / byte_rate as f64);
            out.duration_from = Some("data");
        }
        let float = format == 3;
        let readable = (1..=MAX_ENVELOPE_CHANNELS).contains(&channels)
            && if float {
                matches!(bits, 32 | 64)
            } else {
                matches!(bits, 8 | 16 | 24 | 32)
            };
        if pcm && readable {
            out.pcm = Some(Pcm {
                data_at,
                data_len,
                channels,
                bits,
                float,
                rate,
            });
        }
    }
    Ok(Some(out))
}

/// One sample at `b[at..]` as -1 to 1.
fn sample(b: &[u8], at: usize, bits: u16, float: bool) -> f32 {
    match (bits, float) {
        (8, false) => (b[at] as f32 - 128.0) / 128.0,
        (16, false) => i16::from_le_bytes([b[at], b[at + 1]]) as f32 / 32768.0,
        (24, false) => {
            (i32::from_le_bytes([0, b[at], b[at + 1], b[at + 2]]) >> 8) as f32 / 8_388_608.0
        }
        (32, false) => {
            i32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as f32 / 2_147_483_648.0
        }
        (32, true) => f32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]).clamp(-1.0, 1.0),
        (64, true) => (f64::from_le_bytes(b[at..at + 8].try_into().unwrap_or_default()) as f32)
            .clamp(-1.0, 1.0),
        _ => 0.0,
    }
}

/// A PCM WAV's envelope in `buckets` steps: every sample when the data is at most `ENVELOPE_WHOLE_BYTES`, else a window
/// of at most `WINDOW_FRAMES` at the start of each bucket, kept to a share of `ENVELOPE_WHOLE_BYTES` so that the bytes
/// read stay bounded however wide a frame is.
pub fn envelope<R: Read + Seek>(r: &mut R, pcm: &Pcm, buckets: usize) -> io::Result<Envelope> {
    let buckets = buckets.clamp(1, MAX_BUCKETS);
    let frame = (pcm.bits as u64 / 8) * pcm.channels as u64;
    if pcm.channels > MAX_ENVELOPE_CHANNELS || frame == 0 {
        return Ok(Envelope {
            peaks: vec![[0f32, 0f32]; buckets],
            sampled: false,
        });
    }
    let frames = pcm.data_len.checked_div(frame).unwrap_or(0);
    let mut peaks = vec![[0f32, 0f32]; buckets];
    if frames == 0 {
        return Ok(Envelope {
            peaks,
            sampled: false,
        });
    }
    let width = (pcm.bits / 8) as usize;
    let mut take = |bytes: &[u8], first: u64| {
        for (i, f) in bytes.chunks_exact(frame as usize).enumerate() {
            let b =
                (((first + i as u64) * buckets as u64) / frames).min(buckets as u64 - 1) as usize;
            let p = &mut peaks[b];
            for c in 0..pcm.channels as usize {
                let s = sample(f, c * width, pcm.bits, pcm.float);
                p[0] = p[0].min(s);
                p[1] = p[1].max(s);
            }
        }
    };
    let sampled = pcm.data_len > ENVELOPE_WHOLE_BYTES;
    if !sampled {
        r.seek(SeekFrom::Start(pcm.data_at))?;
        let piece = frame * 64 * 1024;
        let mut done = 0u64;
        while done < frames {
            let n = (frames - done).min(piece / frame);
            let mut buf = vec![0u8; (n * frame) as usize];
            let got = read_full(r, &mut buf)?;
            let whole = got / frame as usize;
            take(&buf[..whole * frame as usize], done);
            if whole < n as usize {
                break;
            }
            done += n;
        }
    } else {
        let window = WINDOW_FRAMES
            .min(ENVELOPE_WHOLE_BYTES / buckets as u64 / frame)
            .max(1);
        for b in 0..buckets as u64 {
            let first = b * frames / buckets as u64;
            let n = window.min(frames - first);
            let buf = read_at(r, pcm.data_at + first * frame, n * frame)?;
            let whole = buf.len() / frame as usize;
            take(&buf[..whole * frame as usize], first);
        }
    }
    Ok(Envelope { peaks, sampled })
}

fn read_full<R: Read>(r: &mut R, buf: &mut [u8]) -> io::Result<usize> {
    let mut at = 0;
    while at < buf.len() {
        match r.read(&mut buf[at..])? {
            0 => break,
            n => at += n,
        }
    }
    Ok(at)
}

// ---- Matroska and WebM -------------------------------------------------------------------------------------------------

/// An EBML variable-length integer at `b[*at..]`: (value, its length); the marker bit is kept for ids, dropped for sizes.
fn vint(b: &[u8], at: &mut usize, keep_marker: bool) -> Option<u64> {
    let first = *b.get(*at)?;
    let n = first.leading_zeros() as usize + 1;
    if n > 8 {
        return None;
    }
    let mut v = if keep_marker {
        first as u64
    } else {
        (first as u64) & (0xff >> n)
    };
    for i in 1..n {
        v = (v << 8) | *b.get(*at + i)? as u64;
    }
    *at += n;
    // A size of all ones means "unknown".
    if !keep_marker && v == (1u64 << (7 * n)) - 1 {
        return Some(u64::MAX);
    }
    Some(v)
}

/// The children of an EBML element's body: (id, body).
fn ebml(b: &[u8]) -> Vec<(u64, &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < b.len() && out.len() < MAX_CHUNKS {
        let (Some(id), Some(size)) = (vint(b, &mut at, true), vint(b, &mut at, false)) else {
            break;
        };
        let end = if size == u64::MAX {
            b.len()
        } else {
            at.saturating_add(size as usize).min(b.len())
        };
        out.push((id, &b[at..end]));
        at = end;
    }
    out
}

fn uint(b: &[u8]) -> u64 {
    b.iter().take(8).fold(0, |v, &x| (v << 8) | x as u64)
}

fn float(b: &[u8]) -> Option<f64> {
    match b.len() {
        4 => Some(f32::from_be_bytes(b.try_into().ok()?) as f64),
        8 => Some(f64::from_be_bytes(b.try_into().ok()?)),
        _ => None,
    }
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b.split(|&c| c == 0).next().unwrap_or_default())
        .trim()
        .to_string()
}

fn matroska_codec(id: &str) -> String {
    match id {
        "V_VP8" => "VP8",
        "V_VP9" => "VP9",
        "V_AV1" => "AV1",
        "V_MPEG4/ISO/AVC" => "H.264 (AVC)",
        "V_MPEGH/ISO/HEVC" => "H.265 (HEVC)",
        "V_THEORA" => "Theora",
        "V_PRORES" => "Apple ProRes",
        "V_MJPEG" => "Motion JPEG",
        "A_OPUS" => "Opus",
        "A_VORBIS" => "Vorbis",
        "A_AAC" => "AAC",
        "A_FLAC" => "FLAC",
        "A_MPEG/L3" => "MP3",
        "A_AC3" => "Dolby Digital (AC-3)",
        "A_EAC3" => "Dolby Digital Plus",
        "A_PCM/INT/LIT" => "PCM, little-endian",
        "A_PCM/INT/BIG" => "PCM, big-endian",
        "A_PCM/FLOAT/IEEE" => "PCM, floating point",
        "S_TEXT/UTF8" => "subtitles, plain text",
        "S_TEXT/WEBVTT" => "WebVTT",
        "S_TEXT/ASS" | "S_TEXT/SSA" => "subtitles, SubStation",
        other => other,
    }
    .to_string()
}

/// The `codecs` string a player is asked about for a Matroska codec id, where there is a plain one.
fn matroska_codecs(id: &str) -> Option<String> {
    Some(
        match id {
            "V_VP8" => "vp8",
            "V_VP9" => "vp9",
            "V_AV1" => "av01.0.08M.08",
            "V_MPEG4/ISO/AVC" => "avc1.42E01E",
            "A_OPUS" => "opus",
            "A_VORBIS" => "vorbis",
            "A_AAC" => "mp4a.40.2",
            "A_FLAC" => "flac",
            _ => return None,
        }
        .to_string(),
    )
}

fn matroska<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "matroska",
        ..MediaFacts::default()
    };
    let head = read_at(r, 0, 64)?;
    let mut at = 0usize;
    let (Some(_), Some(size)) = (vint(&head, &mut at, true), vint(&head, &mut at, false)) else {
        return Ok(None);
    };
    let header_end = at as u64 + size.min(len);
    let header = read_at(r, at as u64, size.min(64))?;
    for (id, body) in ebml(&header) {
        if id == 0x4282 {
            let doc = text(body);
            if doc == "webm" {
                out.container = "webm";
            }
            out.brand = Some(doc);
        }
    }
    // The Segment, then its children by their headers; Clusters are skipped, and one of unknown size ends the walk.
    let mut pos = header_end;
    let seg = read_at(r, pos, 16)?;
    let mut k = 0usize;
    let (Some(seg_id), Some(seg_size)) = (vint(&seg, &mut k, true), vint(&seg, &mut k, false))
    else {
        return Ok(Some(out));
    };
    if seg_id != 0x1853_8067 {
        return Ok(Some(out));
    }
    pos += k as u64;
    let seg_end = if seg_size == u64::MAX {
        len
    } else {
        (pos + seg_size).min(len)
    };
    let mut scale = 1_000_000u64;
    let mut duration = None;
    for _ in 0..MAX_CHUNKS {
        if pos + 2 > seg_end {
            break;
        }
        let h = read_at(r, pos, 16)?;
        let mut k = 0usize;
        let (Some(id), Some(size)) = (vint(&h, &mut k, true), vint(&h, &mut k, false)) else {
            break;
        };
        let body = pos + k as u64;
        if size == u64::MAX {
            break;
        }
        match id {
            0x1549_A966 | 0x1654_AE6B | 0x1254_C367 if size <= MAX_META_BYTES => {
                let b = read_at(r, body, size)?;
                match id {
                    0x1549_A966 => {
                        for (cid, c) in ebml(&b) {
                            match cid {
                                0x2AD7B1 => scale = uint(c).max(1),
                                0x4489 => duration = float(c),
                                0x7BA9 => {
                                    let t = text(c);
                                    if !t.is_empty() {
                                        out.tags.push(tag("title", t, "Title"));
                                    }
                                }
                                0x4D80 => {
                                    let t = text(c);
                                    if !t.is_empty() {
                                        out.tags.push(tag("software", t, "MuxingApp"));
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    0x1654_AE6B => {
                        for (_, entry) in ebml(&b).into_iter().filter(|(i, _)| *i == 0xAE) {
                            out.tracks.push(matroska_track(entry));
                        }
                    }
                    _ => {
                        for (_, t) in ebml(&b).into_iter().filter(|(i, _)| *i == 0x7373) {
                            for (_, simple) in ebml(t).into_iter().filter(|(i, _)| *i == 0x67C8) {
                                let kids = ebml(simple);
                                let name = kids
                                    .iter()
                                    .find(|(i, _)| *i == 0x45A3)
                                    .map(|(_, v)| text(v));
                                let value = kids
                                    .iter()
                                    .find(|(i, _)| *i == 0x4487)
                                    .map(|(_, v)| text(v));
                                if let (Some(n), Some(v)) = (name, value) {
                                    if !v.is_empty() {
                                        out.tags.push(tag(&n.to_lowercase(), v, &n));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // A Cluster: the media itself.
            0x1F43_B675 => {}
            _ => {}
        }
        pos = body.saturating_add(size);
    }
    if let Some(d) = duration {
        out.duration = Some(d * scale as f64 / 1e9);
        out.duration_from = Some("segment");
    }
    Ok(Some(out))
}

fn matroska_track(entry: &[u8]) -> Track {
    let mut t = Track {
        kind: "other",
        ..Track::default()
    };
    for (id, c) in ebml(entry) {
        match id {
            0x83 => {
                t.kind = match uint(c) {
                    1 => "video",
                    2 => "audio",
                    17 => "text",
                    _ => "other",
                }
            }
            0x86 => {
                let codec = text(c);
                t.codec_name = matroska_codec(&codec);
                t.codecs = matroska_codecs(&codec);
                t.codec = codec;
            }
            0x23E383 => {
                let ns = uint(c);
                if ns > 0 {
                    t.frame_rate = Some(1e9 / ns as f64);
                }
            }
            0xE0 => {
                for (v, x) in ebml(c) {
                    match v {
                        0xB0 => t.width = Some(uint(x) as u32),
                        0xBA => t.height = Some(uint(x) as u32),
                        _ => {}
                    }
                }
            }
            0xE1 => {
                for (v, x) in ebml(c) {
                    match v {
                        0xB5 => t.sample_rate = float(x).map(|f| f.round() as u32),
                        0x9F => t.channels = Some(uint(x) as u16),
                        0x6264 => t.bits = Some(uint(x) as u16),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    if !t.codec.starts_with("A_PCM") {
        t.bits = None;
    }
    t
}

// ---- MP3 ---------------------------------------------------------------------------------------------------------------

/// An MPEG audio frame header at `b[at..]`: (version 1, 2 or 25 for 2.5; layer; bit rate in kbit/s; sample rate;
/// channels; samples a frame).
fn mpeg_frame(b: &[u8], at: usize) -> Option<(u8, u8, u32, u32, u16, u32)> {
    let h = b.get(at..at + 4)?;
    if h[0] != 0xFF || h[1] & 0xE0 != 0xE0 {
        return None;
    }
    let version = match (h[1] >> 3) & 3 {
        0 => 25,
        2 => 2,
        3 => 1,
        _ => return None,
    };
    let layer = match (h[1] >> 1) & 3 {
        1 => 3,
        2 => 2,
        3 => 1,
        _ => return None,
    };
    let bi = (h[2] >> 4) as usize;
    let si = ((h[2] >> 2) & 3) as usize;
    if bi == 0 || bi == 15 || si == 3 {
        return None;
    }
    const V1: [[u32; 15]; 3] = [
        [
            0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
        ],
        [
            0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
        ],
        [
            0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
        ],
    ];
    const V2: [[u32; 15]; 2] = [
        [
            0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
        ],
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    ];
    let bitrate = if version == 1 {
        V1[layer as usize - 1][bi]
    } else {
        V2[if layer == 1 { 0 } else { 1 }][bi]
    };
    let rate = [44100u32, 48000, 32000][si]
        / if version == 1 {
            1
        } else if version == 2 {
            2
        } else {
            4
        };
    let channels = if h[3] >> 6 == 3 { 1 } else { 2 };
    let samples = match (layer, version) {
        (1, _) => 384,
        (2, _) => 1152,
        (3, 1) => 1152,
        _ => 576,
    };
    Some((version, layer, bitrate, rate, channels, samples))
}

/// Where the audio starts past an ID3v2 tag at the head of the file.
fn id3_end(head: &[u8]) -> Option<u64> {
    if head.get(..3) != Some(b"ID3") {
        return None;
    }
    let size = syncsafe(head.get(6..10)?) as u64;
    Some(10 + size + if head[5] & 0x10 != 0 { 10 } else { 0 })
}

fn syncsafe(b: &[u8]) -> u32 {
    b.iter()
        .take(4)
        .fold(0, |v, &x| (v << 7) | (x & 0x7f) as u32)
}

fn id3_text(b: &[u8]) -> String {
    let Some((&enc, rest)) = b.split_first() else {
        return String::new();
    };
    let s = match enc {
        1 | 2 => {
            let (rest, be) = match rest.get(..2) {
                Some([0xFF, 0xFE]) => (&rest[2..], false),
                Some([0xFE, 0xFF]) => (&rest[2..], true),
                _ => (rest, enc == 2),
            };
            let units: Vec<u16> = rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| {
                    if be {
                        u16::from_be_bytes([c[0], c[1]])
                    } else {
                        u16::from_le_bytes([c[0], c[1]])
                    }
                })
                .take_while(|&u| u != 0)
                .collect();
            String::from_utf16_lossy(&units)
        }
        3 => text(rest),
        _ => rest
            .iter()
            .take_while(|&&c| c != 0)
            .map(|&c| c as char)
            .collect(),
    };
    s.trim().to_string()
}

const ID3_KEYS: &[(&str, &str)] = &[
    ("TIT2", "title"),
    ("TT2", "title"),
    ("TPE1", "artist"),
    ("TP1", "artist"),
    ("TALB", "album"),
    ("TAL", "album"),
    ("TYER", "made"),
    ("TDRC", "made"),
    ("TYE", "made"),
    ("TCON", "genre"),
    ("TCO", "genre"),
    ("TRCK", "track"),
    ("TRK", "track"),
    ("TSSE", "software"),
    ("TSS", "software"),
    ("TCOP", "copyright"),
];

/// The text frames of an ID3v2 tag's body (past its ten-byte header) as tags.
fn id3_frames(tag_bytes: &[u8], major: u8, out: &mut MediaFacts) {
    let (id_len, header) = if major == 2 { (3, 6) } else { (4, 10) };
    let mut k = 0usize;
    while k + header <= tag_bytes.len() {
        let id = &tag_bytes[k..k + id_len];
        if id[0] == 0 {
            break;
        }
        let n = match major {
            2 => uint(&tag_bytes[k + 3..k + 6]) as usize,
            4 => syncsafe(&tag_bytes[k + 4..k + 8]) as usize,
            _ => uint(&tag_bytes[k + 4..k + 8]) as usize,
        };
        let body = tag_bytes
            .get(k + header..(k + header).saturating_add(n).min(tag_bytes.len()))
            .unwrap_or_default();
        let id = String::from_utf8_lossy(id).into_owned();
        if let Some((_, key)) = ID3_KEYS.iter().find(|(i, _)| *i == id) {
            let v = id3_text(body);
            if !v.is_empty() && !out.tags.iter().any(|t| t.key == *key) {
                out.tags.push(tag(key, v, &id));
            }
        }
        k += header + n;
    }
}

fn mp3<R: Read + Seek>(r: &mut R, len: u64) -> io::Result<Option<MediaFacts>> {
    let mut out = MediaFacts {
        container: "mp3",
        ..MediaFacts::default()
    };
    let head = read_at(r, 0, 10)?;
    let mut audio_at = 0u64;
    if head.get(..3) == Some(b"ID3") && head.len() == 10 {
        let major = head[3];
        let size = syncsafe(&head[6..10]) as u64;
        audio_at = 10 + size + if head[5] & 0x10 != 0 { 10 } else { 0 };
        let tag_bytes = read_at(r, 10, size.min(MAX_META_BYTES))?;
        id3_frames(&tag_bytes, major, &mut out);
    }
    // The first frame: within the next 64 KB past the tag.
    let scan = read_at(r, audio_at, 64 * 1024)?;
    let Some(first) = (0..scan.len().saturating_sub(4)).find(|&i| mpeg_frame(&scan, i).is_some())
    else {
        return Ok(if out.tags.is_empty() { None } else { Some(out) });
    };
    let (version, layer, bitrate, rate, channels, samples) =
        mpeg_frame(&scan, first).unwrap_or_default();
    out.tracks.push(Track {
        kind: "audio",
        codec: "mp3".into(),
        codec_name: format!(
            "MPEG-{} layer {}",
            if version == 25 {
                "2.5".into()
            } else {
                version.to_string()
            },
            ["I", "II", "III"][layer as usize - 1]
        ),
        codecs: Some("mp3".into()),
        channels: Some(channels),
        sample_rate: Some(rate),
        ..Track::default()
    });
    if layer == 3 {
        out.tracks[0].codec_name = "MP3".into();
    }
    // A Xing or Info header (VBR) sits after the side information; VBRI 32 bytes in.
    let side = match (version, channels) {
        (1, 1) => 17,
        (1, _) => 32,
        (_, 1) => 9,
        _ => 17,
    };
    let x = first + 4 + side;
    let frames = if matches!(scan.get(x..x + 4), Some(b"Xing" | b"Info"))
        && scan.get(x + 7).is_some_and(|f| f & 1 != 0)
    {
        scan.get(x + 8..x + 12).map(uint)
    } else if scan.get(first + 36..first + 40) == Some(b"VBRI") {
        scan.get(first + 50..first + 54).map(uint)
    } else {
        None
    };
    if let (Some(n), true) = (frames, rate > 0) {
        out.duration = Some(n as f64 * samples as f64 / rate as f64);
        out.duration_from = Some("frames");
    } else if bitrate > 0 {
        let audio = len.saturating_sub(audio_at + first as u64);
        out.duration = Some(audio as f64 * 8.0 / (bitrate as f64 * 1000.0));
        out.duration_from = Some("bitrate");
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests;
