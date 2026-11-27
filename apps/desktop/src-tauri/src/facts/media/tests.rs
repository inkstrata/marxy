use super::*;
use std::fs::File;
use std::io::{self, Cursor, Read, Seek, SeekFrom};
use std::path::PathBuf;

pub fn demo_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/media")
        .join(name)
}

fn facts_of(name: &str) -> MediaFacts {
    let mut f = File::open(demo_path(name)).unwrap();
    read(&mut f).unwrap().unwrap()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.05
}

#[test]
fn a_wav_says_its_pcm_length_and_info_tags() {
    let f = facts_of("bell-buoy.wav");
    assert_eq!((f.container, f.duration_from), ("wav", Some("data")));
    assert!(close(f.duration.unwrap(), 5.0), "{:?}", f.duration);
    let a = &f.tracks[0];
    assert_eq!(
        (a.kind, a.codec.as_str(), a.codec_name.as_str()),
        ("audio", "pcm", "PCM")
    );
    assert_eq!(
        (a.channels, a.sample_rate, a.bits),
        (Some(1), Some(22050), Some(16))
    );
    let tags: Vec<(&str, &str, &str)> = f
        .tags
        .iter()
        .map(|t| (t.key.as_str(), t.value.as_str(), t.id.as_str()))
        .collect();
    assert_eq!(
        tags,
        [
            ("title", "Bell buoy, outer channel", "INAM"),
            ("artist", "Reader lab (constructed)", "IART"),
            ("made", "2026-10-12", "ICRD"),
            ("software", "make-mail-media.py", "ISFT"),
        ]
    );
    let pcm = f.pcm.unwrap();
    assert_eq!(
        (pcm.channels, pcm.bits, pcm.float, pcm.rate),
        (1, 16, false, 22050)
    );
    assert_eq!(pcm.data_len, 22050 * 2 * 5);
}

#[test]
fn a_wav_envelope_shows_the_three_strikes() {
    let f = facts_of("bell-buoy.wav");
    let mut file = File::open(demo_path("bell-buoy.wav")).unwrap();
    let env = envelope(&mut file, &f.pcm.unwrap(), 100).unwrap();
    assert!(!env.sampled);
    assert_eq!(env.peaks.len(), 100);
    let loud: Vec<usize> = env
        .peaks
        .iter()
        .enumerate()
        .filter(|(_, p)| p[1] - p[0] > 0.5)
        .map(|(i, _)| i)
        .collect();
    // A bell struck three times: three loud starts, quiet before the first.
    assert!(!loud.is_empty() && loud[0] > 0, "{loud:?}");
    let starts = loud.windows(2).filter(|w| w[1] > w[0] + 3).count() + 1;
    assert_eq!(starts, 3, "{loud:?}");
    assert!(env
        .peaks
        .iter()
        .all(|p| (-1.0..=1.0).contains(&p[0]) && (-1.0..=1.0).contains(&p[1])));
    // Sampled, the same strikes are found.
    let sampled = {
        let pcm = f.pcm.unwrap();
        let mut file = File::open(demo_path("bell-buoy.wav")).unwrap();
        let mut out = vec![[0f32; 2]; 50];
        let frame = 2u64;
        for (b, p) in out.iter_mut().enumerate() {
            let first = b as u64 * (pcm.data_len / frame) / 50;
            let w = read_at(&mut file, pcm.data_at + first * frame, 64 * frame).unwrap();
            for c in w.as_chunks::<2>().0 {
                let s = sample(c, 0, 16, false);
                p[0] = p[0].min(s);
                p[1] = p[1].max(s);
            }
        }
        out
    };
    assert!(sampled.iter().any(|p| p[1] > 0.25));
}

/// Endless zero bytes that count what is read from them.
struct Zeros {
    at: u64,
    read: u64,
}

impl Read for Zeros {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        buf.fill(0);
        self.at += buf.len() as u64;
        self.read += buf.len() as u64;
        Ok(buf.len())
    }
}

impl Seek for Zeros {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        if let SeekFrom::Start(n) = to {
            self.at = n;
        }
        Ok(self.at)
    }
}

fn wav_header(channels: u16, bits: u16, format: u16, data_len: u32) -> Vec<u8> {
    let mut b = b"RIFF".to_vec();
    b.extend((36 + data_len).to_le_bytes());
    b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes());
    b.extend(format.to_le_bytes());
    b.extend(channels.to_le_bytes());
    b.extend(48000u32.to_le_bytes());
    let width = (bits / 8) as u32 * channels as u32;
    b.extend(48000u32.wrapping_mul(width).to_le_bytes());
    b.extend((width as u16).to_le_bytes());
    b.extend(bits.to_le_bytes());
    b.extend(b"data");
    b.extend(data_len.to_le_bytes());
    b
}

#[test]
fn a_wav_with_an_absurd_channel_count_has_no_envelope() {
    let header = wav_header(65535, 64, 3, u32::MAX - 64);
    let facts = read(&mut Cursor::new(header)).unwrap().unwrap();
    assert!(facts.pcm.is_none());
    let sane = wav_header(256, 16, 1, 1 << 20);
    assert!(read(&mut Cursor::new(sane)).unwrap().unwrap().pcm.is_some());
    let wide = wav_header(257, 16, 1, 1 << 20);
    assert!(read(&mut Cursor::new(wide)).unwrap().unwrap().pcm.is_none());
}

#[test]
fn a_sampled_envelope_reads_a_bounded_number_of_bytes_however_wide_a_frame_is() {
    for (channels, bits, float) in [(2u16, 16u16, false), (256, 64, true), (255, 32, true)] {
        let pcm = Pcm {
            data_at: 44,
            data_len: u32::MAX as u64,
            channels,
            bits,
            float,
            rate: 48000,
        };
        let mut src = Zeros { at: 0, read: 0 };
        let env = envelope(&mut src, &pcm, MAX_BUCKETS).unwrap();
        assert!(env.sampled);
        let frame = (bits as u64 / 8) * channels as u64;
        assert!(
            src.read <= ENVELOPE_WHOLE_BYTES + MAX_BUCKETS as u64 * frame,
            "{channels} channels read {}",
            src.read
        );
    }
}

#[test]
fn an_envelope_of_more_channels_than_it_reads_is_empty_without_reading() {
    let pcm = Pcm {
        data_at: 44,
        data_len: u32::MAX as u64,
        channels: 65535,
        bits: 64,
        float: true,
        rate: 48000,
    };
    let mut src = Zeros { at: 0, read: 0 };
    let env = envelope(&mut src, &pcm, 100).unwrap();
    assert_eq!(src.read, 0);
    assert!(!env.sampled && env.peaks.len() == 100);
}

#[test]
fn a_fragmented_mp4_counts_its_frames_for_an_average_rate() {
    let f = facts_of("ferry-leaving.mp4");
    assert_eq!(f.container, "mp4");
    assert!(f.fragmented);
    assert_eq!(f.brand.as_deref(), Some("isom"));
    assert!(
        close(f.duration.unwrap(), 4.2) || f.duration.unwrap() > 4.0,
        "{:?}",
        f.duration
    );
    assert_eq!(f.index_first, Some(true));
    assert_eq!(&f.boxes[..3], ["ftyp", "moov", "moof"]);
    let v = f.tracks.iter().find(|t| t.kind == "video").unwrap();
    assert_eq!(
        (v.codec.as_str(), v.codec_name.as_str()),
        ("avc1", "H.264 (AVC)")
    );
    assert_eq!((v.width, v.height), (Some(640), Some(360)));
    assert!(v.frame_rate_average);
    assert_eq!(v.frames, Some(76));
    let fps = v.frame_rate.unwrap();
    assert!((17.0..19.5).contains(&fps), "{fps}");
    assert!(v.codecs.as_deref().unwrap().starts_with("avc1."));
    let a = f.tracks.iter().find(|t| t.kind == "audio").unwrap();
    assert_eq!(a.codec_name, "AAC (mp4a)");
    assert_eq!(
        (a.channels, a.sample_rate, a.bits),
        (Some(2), Some(48000), None)
    );
    assert_eq!(a.codecs.as_deref(), Some("mp4a.40.2"));
}

#[test]
fn a_prores_movie_says_its_codec_rate_sound_and_title() {
    let f = facts_of("interview-prores.mov");
    assert_eq!((f.container, f.brand.as_deref()), ("mov", Some("qt")));
    assert!(close(f.duration.unwrap(), 12.0));
    assert_eq!(f.boxes, ["ftyp", "moov", "mdat"]);
    assert_eq!(f.index_first, Some(true));
    let v = &f.tracks[0];
    assert_eq!(
        (v.codec.as_str(), v.codec_name.as_str()),
        ("apch", "Apple ProRes 422 HQ")
    );
    assert_eq!(
        (v.width, v.height, v.frame_rate, v.frame_rate_average),
        (Some(1920), Some(1080), Some(25.0), false)
    );
    assert_eq!(v.frames, Some(300));
    let a = &f.tracks[1];
    assert_eq!(a.codec_name, "PCM, little-endian");
    assert_eq!(
        (a.channels, a.sample_rate, a.bits),
        (Some(2), Some(48000), Some(16))
    );
    assert_eq!(f.tags, [tag("title", "Interview on the quay", "©nam")]);
}

/// An EBML element: its id's bytes, a one-byte size, its body.
fn el(id: &[u8], body: &[u8]) -> Vec<u8> {
    let mut b = id.to_vec();
    assert!(body.len() < 127);
    b.push(0x80 | body.len() as u8);
    b.extend_from_slice(body);
    b
}

#[test]
fn a_webm_says_its_tracks_and_length() {
    let header = el(&[0x1a, 0x45, 0xdf, 0xa3], &el(&[0x42, 0x82], b"webm"));
    let info = el(
        &[0x15, 0x49, 0xa9, 0x66],
        &[
            el(&[0x2a, 0xd7, 0xb1], &[0x0f, 0x42, 0x40]),
            el(&[0x44, 0x89], &2500.0f32.to_be_bytes()),
        ]
        .concat(),
    );
    let video = el(
        &[0xae],
        &[
            el(&[0x83], &[1]),
            el(&[0x86], b"V_VP9"),
            el(
                &[0xe0],
                &[el(&[0xb0], &[0x02, 0x80]), el(&[0xba], &[0x01, 0x68])].concat(),
            ),
        ]
        .concat(),
    );
    let audio = el(
        &[0xae],
        &[
            el(&[0x83], &[2]),
            el(&[0x86], b"A_OPUS"),
            el(
                &[0xe1],
                &[el(&[0xb5], &48000.0f32.to_be_bytes()), el(&[0x9f], &[2])].concat(),
            ),
        ]
        .concat(),
    );
    let tracks = el(&[0x16, 0x54, 0xae, 0x6b], &[video, audio].concat());
    // A Segment of unknown size, as a live recorder writes it, then a Cluster of unknown size.
    let mut file = header;
    file.extend_from_slice(&[
        0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    file.extend(info);
    file.extend(tracks);
    file.extend_from_slice(&[0x1f, 0x43, 0xb6, 0x75, 0xff, 0, 0, 0]);
    let f = matroska(&mut Cursor::new(&file), file.len() as u64)
        .unwrap()
        .unwrap();
    assert_eq!(
        (f.container, f.brand.as_deref(), f.duration_from),
        ("webm", Some("webm"), Some("segment"))
    );
    assert!(close(f.duration.unwrap(), 2.5));
    assert_eq!(f.tracks.len(), 2);
    assert_eq!(
        (
            f.tracks[0].kind,
            f.tracks[0].codec_name.as_str(),
            f.tracks[0].width,
            f.tracks[0].height
        ),
        ("video", "VP9", Some(640), Some(360))
    );
    assert_eq!(
        (
            f.tracks[1].codec_name.as_str(),
            f.tracks[1].channels,
            f.tracks[1].sample_rate
        ),
        ("Opus", Some(2), Some(48000))
    );
    assert_eq!(sniff(&file), Some("matroska"));
}

#[test]
fn an_mp3_says_its_tags_and_length() {
    // ID3v2.3 with a title, then 100 frames of MPEG-1 layer III at 128 kbit/s, 44.1 kHz, stereo, 417 bytes each.
    let mut title = vec![3u8];
    title.extend_from_slice("Low water".as_bytes());
    let mut frame = b"TIT2".to_vec();
    frame.extend_from_slice(&(title.len() as u32).to_be_bytes());
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(&title);
    let mut file = b"ID3\x03\x00\x00".to_vec();
    let n = frame.len() as u32;
    file.extend_from_slice(&[
        (n >> 21) as u8 & 0x7f,
        (n >> 14) as u8 & 0x7f,
        (n >> 7) as u8 & 0x7f,
        n as u8 & 0x7f,
    ]);
    file.extend(frame);
    for _ in 0..100 {
        let mut f = vec![0xFF, 0xFB, 0x90, 0x00];
        f.resize(417, 0);
        file.extend(f);
    }
    let f = mp3(&mut Cursor::new(&file), file.len() as u64)
        .unwrap()
        .unwrap();
    assert_eq!(f.tracks[0].codec_name, "MP3");
    assert_eq!(
        (f.tracks[0].channels, f.tracks[0].sample_rate),
        (Some(2), Some(44100))
    );
    assert_eq!(f.duration_from, Some("bitrate"));
    assert!(
        close(f.duration.unwrap(), 100.0 * 1152.0 / 44100.0),
        "{:?}",
        f.duration
    );
    assert_eq!(f.tags, [tag("title", "Low water", "TIT2")]);
}

#[test]
fn what_is_not_media_is_none() {
    assert_eq!(sniff(b"hello world, plain text"), None);
    let mut f = File::open(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
    assert_eq!(read(&mut f).unwrap(), None);
    // A WAV cut inside its header still says what it is, without a length.
    let mut cut = std::fs::read(demo_path("bell-buoy.wav")).unwrap();
    cut.truncate(30);
    let w = wav(&mut Cursor::new(&cut), cut.len() as u64)
        .unwrap()
        .unwrap();
    assert_eq!((w.container, w.duration), ("wav", None));
}

fn fixture(name: &str) -> MediaFacts {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/media")
        .join(name);
    read(&mut File::open(p).unwrap()).unwrap().unwrap()
}

fn tags_of(f: &MediaFacts) -> Vec<(&str, &str, &str)> {
    f.tags
        .iter()
        .map(|t| (t.key.as_str(), t.value.as_str(), t.id.as_str()))
        .collect()
}

#[test]
fn a_flac_says_its_streaminfo_and_vorbis_comments() {
    let f = fixture("chime.flac");
    assert_eq!(
        (f.container, f.duration, f.duration_from),
        ("flac", Some(0.5), Some("streaminfo"))
    );
    let a = &f.tracks[0];
    assert_eq!(
        (a.kind, a.codec.as_str(), a.codec_name.as_str()),
        ("audio", "flac", "FLAC")
    );
    assert_eq!(
        (a.channels, a.sample_rate, a.bits),
        (Some(1), Some(8000), Some(16))
    );
    assert_eq!(
        tags_of(&f),
        [
            ("title", "Chime", "TITLE"),
            ("artist", "Reader Lab", "ARTIST"),
            ("made", "2026-11-09", "DATE"),
            ("comment", "A tone, constructed", "COMMENT"),
            ("software", "make-xiph.py (constructed)", "vendor"),
        ]
    );
    assert!(
        f.pcm.is_none(),
        "FLAC is compressed: the webview decodes it"
    );
}

#[test]
fn a_flac_behind_an_id3_tag_is_still_flac() {
    let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x0a".to_vec();
    bytes.extend_from_slice(&[0; 10]);
    let flac = std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/media/chime.flac"),
    )
    .unwrap();
    bytes.extend_from_slice(&flac);
    let dir = std::env::temp_dir().join(format!("marxy-id3-flac-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("tagged.flac");
    std::fs::write(&p, &bytes).unwrap();
    let f = read(&mut File::open(&p).unwrap()).unwrap().unwrap();
    std::fs::remove_dir_all(&dir).ok();
    assert_eq!((f.container, f.duration), ("flac", Some(0.5)));
}

#[test]
fn an_ogg_opus_says_its_channels_its_length_less_the_pre_skip_and_its_tags() {
    let f = fixture("chime.opus");
    assert_eq!(
        (f.container, f.duration, f.duration_from),
        ("ogg", Some(0.5), Some("granule"))
    );
    let a = &f.tracks[0];
    assert_eq!(
        (a.codec.as_str(), a.codec_name.as_str(), a.codecs.as_deref()),
        ("opus", "Opus", Some("opus"))
    );
    assert_eq!(
        (a.channels, a.sample_rate, a.bits),
        (Some(1), Some(48_000), None)
    );
    assert_eq!(
        tags_of(&f),
        [
            ("title", "Chime", "TITLE"),
            ("artist", "Reader Lab", "ARTIST"),
            ("made", "2026", "DATE"),
            ("software", "make-xiph.py (constructed)", "vendor"),
        ]
    );
}

#[test]
fn an_ogg_vorbis_says_its_rate_channels_length_and_tags_but_never_a_picture() {
    let f = fixture("chime-headers.ogg");
    assert_eq!(
        (f.container, f.duration, f.duration_from),
        ("ogg", Some(0.5), Some("granule"))
    );
    let a = &f.tracks[0];
    assert_eq!(
        (
            a.codec.as_str(),
            a.codec_name.as_str(),
            a.channels,
            a.sample_rate
        ),
        ("vorbis", "Vorbis", Some(2), Some(44_100))
    );
    let tags = tags_of(&f);
    assert_eq!(
        tags.iter().map(|t| t.0).collect::<Vec<_>>(),
        ["title", "artist", "album", "genre", "track", "software"]
    );
    assert!(tags.iter().all(|t| t.2 != "METADATA_BLOCK_PICTURE"));
}

#[test]
fn ogg_and_flac_are_sniffed_from_their_first_bytes() {
    assert_eq!(sniff(b"OggS\x00\x02"), Some("ogg"));
    assert_eq!(sniff(b"fLaC\x00\x00\x00\x22"), Some("flac"));
    // A page cut short is no facts, not a fault.
    let mut cut = Cursor::new(b"OggS\x00\x02\x00\x00".to_vec());
    assert_eq!(xiph::ogg(&mut cut, 8).unwrap(), None);
}

fn aiff_bytes(form: &[u8; 4], channels: u16, frames: u32, bits: u16) -> Vec<u8> {
    let mut b = b"FORM".to_vec();
    b.extend_from_slice(&0u32.to_be_bytes());
    b.extend_from_slice(form);
    b.extend_from_slice(b"COMM");
    b.extend_from_slice(&18u32.to_be_bytes());
    b.extend_from_slice(&channels.to_be_bytes());
    b.extend_from_slice(&frames.to_be_bytes());
    b.extend_from_slice(&bits.to_be_bytes());
    // 44100 Hz as an 80-bit extended float.
    b.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
    b
}

#[test]
fn an_aiff_says_its_channels_rate_and_length() {
    let b = aiff_bytes(b"AIFF", 2, 88200, 16);
    let f = read(&mut Cursor::new(b)).unwrap().unwrap();
    assert_eq!((f.container, f.duration_from), ("aiff", Some("frames")));
    assert!(close(f.duration.unwrap(), 2.0), "{:?}", f.duration);
    let a = &f.tracks[0];
    assert_eq!(
        (a.codec.as_str(), a.channels, a.sample_rate, a.bits),
        ("pcm", Some(2), Some(44100), Some(16))
    );
}

#[test]
fn a_truncated_aiff_has_no_track_and_no_panic() {
    let mut b = aiff_bytes(b"AIFF", 2, 10, 16);
    b.truncate(20);
    let f = read(&mut Cursor::new(b)).unwrap().unwrap();
    assert!(f.tracks.is_empty());
}

fn aifc_comm(channels: u16, frames: u32, bits: u16, kind: &[u8; 4], rate: [u8; 10]) -> Vec<u8> {
    let mut b = b"FORM".to_vec();
    b.extend_from_slice(&0u32.to_be_bytes());
    b.extend_from_slice(b"AIFC");
    b.extend_from_slice(b"COMM");
    b.extend_from_slice(&23u32.to_be_bytes());
    b.extend_from_slice(&channels.to_be_bytes());
    b.extend_from_slice(&frames.to_be_bytes());
    b.extend_from_slice(&bits.to_be_bytes());
    b.extend_from_slice(&rate);
    b.extend_from_slice(kind);
    b.extend_from_slice(&[0, 0]);
    b
}

const RATE_44100: [u8; 10] = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];

#[test]
fn an_aifc_names_its_big_endian_unsigned_and_float_forms_with_their_bits() {
    let name_bits = |kind: &[u8; 4], bits: u16| {
        let f = read(&mut Cursor::new(aifc_comm(2, 10, bits, kind, RATE_44100)))
            .unwrap()
            .unwrap();
        (f.tracks[0].codec_name.clone(), f.tracks[0].bits)
    };
    assert_eq!(name_bits(b"twos", 16), ("PCM, big-endian".into(), Some(16)));
    assert_eq!(name_bits(b"in24", 24), ("PCM, big-endian".into(), Some(24)));
    assert_eq!(name_bits(b"in32", 32), ("PCM, big-endian".into(), Some(32)));
    assert_eq!(
        name_bits(b"raw ", 8),
        ("PCM, unsigned 8-bit".into(), Some(8))
    );
    assert_eq!(
        name_bits(b"fl64", 64),
        ("PCM, floating point".into(), Some(64))
    );
    assert_eq!(
        name_bits(b"sowt", 16),
        ("PCM, little-endian".into(), Some(16))
    );
    assert_eq!(name_bits(b"ima4", 16), ("ima4".into(), None));
}

#[test]
fn an_aiff_with_no_channels_or_an_absurd_rate_says_neither_and_gives_no_length() {
    let f = read(&mut Cursor::new(aifc_comm(0, 10, 16, b"NONE", RATE_44100)))
        .unwrap()
        .unwrap();
    assert_eq!(f.tracks[0].channels, None);
    // Exponent 0x7fff: infinity.
    let inf = [0x7f, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0];
    let f = read(&mut Cursor::new(aifc_comm(1, 10, 16, b"NONE", inf)))
        .unwrap()
        .unwrap();
    assert_eq!((f.tracks[0].sample_rate, f.duration), (None, None));
}

#[test]
fn an_aiff_takes_its_first_comm_and_reads_an_id3_chunk() {
    let mut b = aiff_bytes(b"AIFF", 2, 88200, 16);
    b.extend_from_slice(&aiff_bytes(b"AIFF", 1, 10, 8)[12..]);
    let tag = [
        b"TIT2".to_vec(),
        6u32.to_be_bytes().to_vec(),
        vec![0, 0],
        vec![0, b'B', b'e', b'l', b'l'],
    ]
    .concat();
    let mut id3 = b"ID3\x03\x00\x00".to_vec();
    id3.extend_from_slice(&[0, 0, 0, tag.len() as u8]);
    id3.extend_from_slice(&tag);
    b.extend_from_slice(b"ID3 ");
    b.extend_from_slice(&(id3.len() as u32).to_be_bytes());
    b.extend_from_slice(&id3);
    // A NAME after the ID3 chunk adds no second title.
    b.extend_from_slice(b"NAME\0\0\0\x04Late");
    let f = read(&mut Cursor::new(b)).unwrap().unwrap();
    assert_eq!(f.tracks.len(), 1);
    assert_eq!(f.tracks[0].channels, Some(2));
    assert_eq!(
        f.tags
            .iter()
            .map(|t| (t.key.as_str(), t.value.as_str()))
            .collect::<Vec<_>>(),
        [("title", "Bell")]
    );
}

#[test]
fn the_demo_aiff_and_mka_say_their_facts() {
    let a = facts_of("harbor-bell.aiff");
    assert_eq!((a.container, a.duration_from), ("aiff", Some("frames")));
    assert!(close(a.duration.unwrap(), 0.5));
    assert_eq!(
        (
            a.tracks[0].channels,
            a.tracks[0].sample_rate,
            a.tracks[0].bits
        ),
        (Some(1), Some(8000), Some(16))
    );
    assert_eq!(a.tags[0].value, "Harbour bell");
    let m = facts_of("harbor-bell.mka");
    assert_eq!(
        (m.container, m.duration_from),
        ("matroska", Some("segment"))
    );
    assert!(close(m.duration.unwrap(), 0.5));
    assert_eq!(
        (
            m.tracks[0].codec_name.as_str(),
            m.tracks[0].codecs.as_deref(),
            m.tracks[0].channels
        ),
        ("Opus", Some("opus"), Some(1))
    );
}
