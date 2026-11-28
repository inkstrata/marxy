//! Text that is not UTF-8. How a file's bytes are known to be text: a byte-order mark is a
//! fact (UTF-8, UTF-16 LE/BE, UTF-32 LE/BE); with none, valid UTF-8 is UTF-8 and nothing else is done; anything else is
//! guessed with `chardetng` and decoded with `encoding_rs`. The decode gives the page UTF-8 and a byte map back to the
//! file, so every place the page names (a find, a copy, the reading position, a line) still names the file's bytes. The
//! bytes are never changed: a save writes the text back in the file's encoding, or is refused (`encode`).
//!
//! Pure: bytes in, bytes out. `commands.rs` is the IPC.

pub mod commands;
pub mod table;

pub use table::Table;

use encoding_rs::{DecoderResult, EncoderResult, Encoding};
use serde::Serialize;

/// The encodings Read with encoding... offers, in its order: (label, the name said on screen).
pub const CANDIDATES: &[(&str, &str)] = &[
    ("utf-8", "UTF-8"),
    ("utf-16le", "UTF-16 LE"),
    ("utf-16be", "UTF-16 BE"),
    ("windows-1252", "Windows-1252"),
    ("iso-8859-1", "ISO-8859-1"),
    ("iso-8859-15", "ISO-8859-15"),
    ("macintosh", "Mac Roman"),
    ("windows-1251", "Windows-1251"),
    ("koi8-r", "KOI8-R"),
    ("shift_jis", "Shift_JIS"),
    ("gb18030", "GB18030"),
    ("euc-kr", "EUC-KR"),
    ("big5", "Big5"),
];

/// Most bytes chardetng is fed, and Read with encoding... counts unreadable bytes in, per encoding.
pub const GUESS_BYTES: usize = 1024 * 1024;
pub const COUNT_BYTES: usize = 8 * 1024 * 1024;
/// Read with encoding... counts each candidate's unreadable bytes in this many bytes of the file, not more: thirteen
/// decodes of the file would cost seconds at 5 MB.
pub const READING_BYTES: usize = 1024 * 1024;
/// The bytes each encoding reads in Read with encoding...: around the first byte above 7F.
const SAMPLE_BYTES: usize = 120;

/// The name said on screen for `label`; an encoding chardetng found that the list does not hold is said by its own name.
pub fn name_of(label: &str) -> String {
    match label {
        "utf-32le" => "UTF-32 LE".into(),
        "utf-32be" => "UTF-32 BE".into(),
        _ => CANDIDATES
            .iter()
            .find(|(l, _)| *l == label)
            .map(|(_, n)| (*n).to_string())
            .unwrap_or_else(|| {
                Encoding::for_label(label.as_bytes())
                    .map(|e| e.name().to_string())
                    .unwrap_or_else(|| label.to_string())
            }),
    }
}

/// How the encoding was known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum How {
    /// A byte-order mark: a fact.
    Bom,
    /// No BOM, and every byte reads as UTF-8.
    Utf8,
    /// No BOM, not UTF-8: chardetng's guess.
    Guess,
    /// The reader chose it (Read with encoding...).
    Chosen,
}

/// The byte that ruled out UTF-8: its offset in the file, its line and column (1-based, the column in bytes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Deciding {
    pub offset: u64,
    pub line: u64,
    pub column: u64,
    pub byte: u8,
}

/// Why the guess won: the bytes above 7F, and how the guessed encoding reads them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// Bytes above 7F in the bytes fed to the guess.
    pub high: u64,
    /// How many different values those are.
    pub distinct: u32,
    /// Those in 80 to 9F, where Windows-1252 keeps its quotes and dashes and ISO-8859-1 has only controls.
    pub c1: u64,
    /// For a single-byte guess: whether every value above 7F is a letter or a mark there (no control, nothing unread).
    pub all_letters: bool,
    /// For a single-byte guess: the first values above 7F and what each reads as, in order.
    pub shown: Vec<(u8, String)>,
}

/// What the page is told about how the file was read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub label: String,
    pub name: String,
    pub how: How,
    /// The byte-order mark's length, kept out of the text and written back on a save.
    pub bom: u32,
    pub file_bytes: u64,
    /// What the file would be read as without the reader's choice (the way back).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_how: Option<How>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deciding: Option<Deciding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Evidence>,
    /// Bytes this encoding cannot read (each read as U+FFFD).
    pub unreadable: u64,
    /// Whether the text, encoded again, gives exactly these bytes: a save can then write the file's own encoding.
    pub writable: bool,
}

/// From a place in the page's UTF-8 back to the file's bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ByteMap {
    /// The text is the bytes (UTF-8).
    Identity,
    /// Every character is `unit` bytes in the file, counted by scalar value (single-byte, UTF-32) or by UTF-16 unit.
    Units { unit: u8, utf16: bool },
    /// A multi-byte legacy encoding: (UTF-8 offset, file offset) pairs at each place their difference changes; between
    /// two, both advance together. The first pair, (0, bom), is implied. Held as runs of equal steps (`table.rs`).
    Table(Table),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub found: Found,
    pub text: Vec<u8>,
    pub map: ByteMap,
}

/// The encoding a byte-order mark names, and its length.
pub fn bom_of(bytes: &[u8]) -> Option<(&'static str, u32)> {
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) {
        Some(("utf-32le", 4))
    } else if bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        Some(("utf-32be", 4))
    } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        Some(("utf-8", 3))
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        Some(("utf-16le", 2))
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        Some(("utf-16be", 2))
    } else {
        None
    }
}

/// The first byte that is not UTF-8, or None when every byte is.
pub fn first_not_utf8(bytes: &[u8]) -> Option<Deciding> {
    let at = match std::str::from_utf8(bytes) {
        Ok(_) => return None,
        Err(e) => e.valid_up_to(),
    };
    let before = &bytes[..at];
    let line = before.iter().filter(|&&b| b == b'\n').count() as u64 + 1;
    let start = before
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    Some(Deciding {
        offset: at as u64,
        line,
        column: (at - start) as u64 + 1,
        byte: bytes[at],
    })
}

/// Fewer bytes above 7F than this, in bytes that do not look like UTF-8, are stray bytes in UTF-8 rather than another
/// encoding.
pub const MIN_GUESS_BYTES: usize = 4;

/// Whether `bytes` read as UTF-8, perhaps damaged: the bytes above ASCII that sit in complete well-formed characters (and
/// in one cut short at the very end of the input) are at least four times the bytes that are not. A few well-formed
/// pairs among stray bytes are not enough: Shift_JIS, GBK and EUC-JP text is full of byte pairs that happen to be
/// well-formed UTF-8, but a larger share of its bytes are not. A UTF-8 file with a stray byte or two keeps its many
/// complete characters.
pub fn looks_like_utf8(bytes: &[u8]) -> bool {
    let (mut good, mut stray) = (0usize, 0usize);
    let mut rest = bytes;
    loop {
        match std::str::from_utf8(rest) {
            Ok(s) => {
                good += s.bytes().filter(|&b| b >= 0x80).count();
                break;
            }
            Err(e) => {
                good += rest[..e.valid_up_to()]
                    .iter()
                    .filter(|&&b| b >= 0x80)
                    .count();
                match e.error_len() {
                    // A character cut short by the end of the input is damaged UTF-8, not another encoding.
                    None => {
                        let cut = rest.len() - e.valid_up_to();
                        if cut > 1 {
                            good += cut;
                        } else {
                            stray += cut;
                        }
                        break;
                    }
                    Some(n) => {
                        stray += n;
                        rest = &rest[e.valid_up_to() + n..];
                    }
                }
            }
        }
    }
    good > 0 && good >= 4 * stray
}

/// How `bytes` would be read with no choice: the label, how it was known, and (for a guess) why.
pub fn sniff(bytes: &[u8]) -> (String, How, u32, Option<Deciding>, Option<Evidence>) {
    if let Some((label, len)) = bom_of(bytes) {
        return (label.into(), How::Bom, len, None, None);
    }
    let Some(deciding) = first_not_utf8(bytes) else {
        return ("utf-8".into(), How::Utf8, 0, None, None);
    };
    // UTF-8 with a damaged byte, not another encoding: read as written, the stray byte kept and shown in Source. So are
    // a few stray bytes in ASCII text: too few to guess from, and a guess that is often wrong stops meaning anything.
    if looks_like_utf8(bytes) || bytes.iter().filter(|&&b| b >= 0x80).count() < MIN_GUESS_BYTES {
        return ("utf-8".into(), How::Utf8, 0, None, None);
    }
    let fed = &bytes[..bytes.len().min(GUESS_BYTES)];
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(fed, fed.len() == bytes.len());
    let guess = detector.guess(None, false);
    let label = guess.name().to_ascii_lowercase();
    let evidence = evidence(fed, guess);
    (label, How::Guess, 0, Some(deciding), Some(evidence))
}

fn evidence(bytes: &[u8], enc: &'static Encoding) -> Evidence {
    let mut seen = [false; 256];
    let (mut high, mut c1) = (0u64, 0u64);
    for &b in bytes {
        if b >= 0x80 {
            high += 1;
            seen[b as usize] = true;
            if b < 0xa0 {
                c1 += 1;
            }
        }
    }
    let values: Vec<u8> = (0x80..=0xffu8).filter(|&b| seen[b as usize]).collect();
    let (mut all_letters, mut shown) = (enc.is_single_byte(), Vec::new());
    if enc.is_single_byte() {
        // In the order they first come, as a reader meets them.
        let mut order: Vec<u8> = Vec::new();
        let mut met = [false; 256];
        for &b in bytes {
            if b >= 0x80 && !met[b as usize] {
                met[b as usize] = true;
                order.push(b);
            }
        }
        for b in order {
            let one = [b];
            let (text, _) = enc.decode_without_bom_handling(&one);
            let ch = text.chars().next().unwrap_or('\u{fffd}');
            if ch == '\u{fffd}' || ch.is_control() {
                all_letters = false;
            }
            if shown.len() < 12 {
                shown.push((b, text.into_owned()));
            }
        }
    }
    Evidence {
        high,
        distinct: values.len() as u32,
        c1,
        all_letters,
        shown,
    }
}

/// `bytes` read as text: with the reader's `chosen` label, else as `sniff` finds them.
pub fn decode(bytes: &[u8], chosen: Option<&str>) -> Result<Decoded, String> {
    let (detected, detected_how, bom, deciding, evidence) = sniff(bytes);
    let chosen = chosen.filter(|c| !c.is_empty() && *c != detected);
    let label = match chosen {
        Some(c) => canonical(c).ok_or_else(|| format!("{c} is not an encoding Marxy reads"))?,
        None => detected.clone(),
    };
    // A chosen encoding reads the bytes after a BOM only when the BOM is its own. UTF-8 is read as written, its BOM
    // and all, as it always has been.
    let bom = match (chosen, bom_of(bytes)) {
        _ if label == "utf-8" => 0,
        (None, _) => bom,
        (Some(_), Some((own, len))) if own == label => len,
        _ => 0,
    };
    let body = &bytes[bom as usize..];
    let (text, map, unreadable) = decode_body(body, &label, bom);
    let writable = match &map {
        ByteMap::Identity => true,
        _ => std::str::from_utf8(&text)
            .ok()
            .and_then(|t| encode_body(t, &label).ok())
            .is_some_and(|again| again == body),
    };
    let how = if chosen.is_some() {
        How::Chosen
    } else {
        detected_how
    };
    Ok(Decoded {
        found: Found {
            name: name_of(&label),
            label,
            how,
            bom,
            file_bytes: bytes.len() as u64,
            detected: chosen.map(|_| detected.clone()),
            detected_how: chosen.map(|_| detected_how),
            deciding,
            evidence,
            unreadable,
            writable,
        },
        text,
        map,
    })
}

/// The encoding a Windows code page number names (an Outlook message's `PR_MESSAGE_CODEPAGE`, an RTF's `\ansicpg`), for
/// the code pages encoding_rs decodes; None for any other. UTF-16 is read by its callers, which hold it as units.
pub fn of_code_page(cp: u32) -> Option<&'static Encoding> {
    use encoding_rs as e;
    Some(match cp {
        // US-ASCII is a subset of Windows-1252, which WHATWG decodes for it.
        1252 | 20127 | 28591 => e::WINDOWS_1252,
        1250 => e::WINDOWS_1250,
        1251 => e::WINDOWS_1251,
        1253 => e::WINDOWS_1253,
        1254 | 28599 => e::WINDOWS_1254,
        1255 => e::WINDOWS_1255,
        1256 => e::WINDOWS_1256,
        1257 => e::WINDOWS_1257,
        1258 => e::WINDOWS_1258,
        874 => e::WINDOWS_874,
        866 => e::IBM866,
        932 => e::SHIFT_JIS,
        936 => e::GBK,
        949 => e::EUC_KR,
        950 => e::BIG5,
        10000 => e::MACINTOSH,
        20866 => e::KOI8_R,
        21866 => e::KOI8_U,
        28592 => e::ISO_8859_2,
        28593 => e::ISO_8859_3,
        28594 => e::ISO_8859_4,
        28595 => e::ISO_8859_5,
        28596 => e::ISO_8859_6,
        28597 => e::ISO_8859_7,
        28598 | 38598 => e::ISO_8859_8,
        28603 => e::ISO_8859_13,
        28605 => e::ISO_8859_15,
        50220..=50222 => e::ISO_2022_JP,
        51932 => e::EUC_JP,
        51949 => e::EUC_KR,
        54936 => e::GB18030,
        65001 => e::UTF_8,
        _ => return None,
    })
}

/// The label Marxy reads `label` as: its own for the ones it decodes itself, else encoding_rs's.
fn canonical(label: &str) -> Option<String> {
    let lower = label.trim().to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be" | "iso-8859-1"
    ) {
        return Some(lower);
    }
    Encoding::for_label_no_replacement(lower.as_bytes()).map(|e| e.name().to_ascii_lowercase())
}

/// The text of `body` (the bytes after any BOM) as `label`, the map back to the file, and the bytes it cannot read.
fn decode_body(body: &[u8], label: &str, bom: u32) -> (Vec<u8>, ByteMap, u64) {
    match label {
        "utf-8" => {
            // Read as written, as every UTF-8 file is: a byte that is not UTF-8 stays itself (Source shows it).
            let unreadable = count_unreadable(body, label);
            (body.to_vec(), ByteMap::Identity, unreadable)
        }
        "iso-8859-1" => (
            body.iter()
                .map(|&b| b as char)
                .collect::<String>()
                .into_bytes(),
            ByteMap::Units {
                unit: 1,
                utf16: false,
            },
            0,
        ),
        "utf-32le" | "utf-32be" => {
            let le = label == "utf-32le";
            let mut out = String::with_capacity(body.len() / 4);
            let mut unreadable = 0;
            for chunk in body.chunks(4) {
                let ch = (chunk.len() == 4)
                    .then(|| {
                        let b = [chunk[0], chunk[1], chunk[2], chunk[3]];
                        if le {
                            u32::from_le_bytes(b)
                        } else {
                            u32::from_be_bytes(b)
                        }
                    })
                    .and_then(char::from_u32);
                if ch.is_none() {
                    unreadable += chunk.len() as u64;
                }
                out.push(ch.unwrap_or('\u{fffd}'));
            }
            (
                out.into_bytes(),
                ByteMap::Units {
                    unit: 4,
                    utf16: false,
                },
                unreadable,
            )
        }
        _ => {
            let enc = Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::WINDOWS_1252);
            let unreadable = count_unreadable(body, label);
            if enc == encoding_rs::UTF_16LE || enc == encoding_rs::UTF_16BE {
                let (text, _) = enc.decode_without_bom_handling(body);
                return (
                    text.into_owned().into_bytes(),
                    ByteMap::Units {
                        unit: 2,
                        utf16: true,
                    },
                    unreadable,
                );
            }
            if enc.is_single_byte() {
                let (text, _) = enc.decode_without_bom_handling(body);
                return (
                    text.into_owned().into_bytes(),
                    ByteMap::Units {
                        unit: 1,
                        utf16: false,
                    },
                    unreadable,
                );
            }
            let (text, pairs) = decode_mapped(body, enc, bom);
            (text, ByteMap::Table(pairs), unreadable)
        }
    }
}

/// A multi-byte encoding, a byte at a time, so each character's bytes in the file are known: the pairs of `ByteMap::Table`.
/// Where the decoder holds no half character, an ASCII run is copied whole (both offsets advance together there, so it
/// makes no pair); ISO-2022-JP keeps state across ASCII bytes and is fed a byte at a time.
fn decode_mapped(body: &[u8], enc: &'static Encoding, bom: u32) -> (Vec<u8>, Table) {
    let mut decoder = enc.new_decoder_without_bom_handling();
    let ascii_runs = enc.is_ascii_compatible();
    let mut out: Vec<u8> = Vec::with_capacity(body.len() * 3 / 2);
    let mut table = Table::new(bom);
    let mut delta: i64 = -(bom as i64);
    let mut buf = [0u8; 64];
    // True when the last byte fed finished a character (or none was fed): no lead byte is waiting.
    let mut clean = true;
    let mut i = 0;
    while i < body.len() {
        if clean && ascii_runs && body[i] < 0x80 {
            let run = body[i..].iter().take_while(|&&b| b < 0x80).count();
            // The last byte of the body is fed to the decoder so it can flush; a run never holds it.
            let run = if i + run == body.len() { run - 1 } else { run };
            if run > 0 {
                out.extend_from_slice(&body[i..i + run]);
                i += run;
                continue;
            }
        }
        let last = i + 1 == body.len();
        let mut input = &body[i..=i];
        let before = out.len();
        loop {
            let (result, read, written, _) = decoder.decode_to_utf8(input, &mut buf, last);
            out.extend_from_slice(&buf[..written]);
            input = &input[read..];
            if matches!(result, encoding_rs::CoderResult::InputEmpty) {
                break;
            }
        }
        // A lead byte alone writes nothing: the pair is made when its character ends.
        clean = out.len() > before;
        let u = out.len() as i64;
        let f = (i + 1) as i64 + bom as i64;
        if clean && u - f != delta {
            delta = u - f;
            table.push(u as u32, f as u32);
        }
        i += 1;
    }
    (out, table.finish())
}

/// Bytes of `body` that `label` cannot read.
pub fn count_unreadable(body: &[u8], label: &str) -> u64 {
    let body = &body[..body.len().min(COUNT_BYTES)];
    match label {
        "iso-8859-1" => 0,
        "utf-32le" | "utf-32be" => decode_body(body, label, 0).2,
        _ => {
            let enc = match label {
                "utf-8" => encoding_rs::UTF_8,
                _ => match Encoding::for_label(label.as_bytes()) {
                    Some(e) => e,
                    None => return body.len() as u64,
                },
            };
            let mut decoder = enc.new_decoder_without_bom_handling();
            let mut buf = vec![0u8; 64 * 1024];
            let (mut at, mut bad) = (0usize, 0u64);
            loop {
                let (result, read, _) =
                    decoder.decode_to_utf8_without_replacement(&body[at..], &mut buf, true);
                at += read;
                match result {
                    DecoderResult::InputEmpty => return bad,
                    DecoderResult::OutputFull => {}
                    DecoderResult::Malformed(n, _) => bad += n.max(1) as u64,
                }
            }
        }
    }
}

/// Why a save cannot write the text in the file's encoding: a character it has no bytes for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unwritable {
    pub ch: char,
    pub line: u64,
}

impl Unwritable {
    pub fn say(&self, name: &str) -> String {
        format!(
            "“{}” (U+{:04X}) on line {} has no bytes in {name}, so the file cannot be saved in its own encoding",
            self.ch, self.ch as u32, self.line
        )
    }
}

fn unwritable(text: &str, at: usize, ch: char) -> Unwritable {
    Unwritable {
        ch,
        line: text[..at].matches('\n').count() as u64 + 1,
    }
}

/// `text` as `label`'s bytes, without a BOM, or the first character it has none for.
pub fn encode_body(text: &str, label: &str) -> Result<Vec<u8>, Unwritable> {
    match label {
        "utf-8" => Ok(text.as_bytes().to_vec()),
        "utf-16le" | "utf-16be" => {
            let le = label == "utf-16le";
            Ok(text
                .encode_utf16()
                .flat_map(|u| if le { u.to_le_bytes() } else { u.to_be_bytes() })
                .collect())
        }
        "utf-32le" | "utf-32be" => {
            let le = label == "utf-32le";
            Ok(text
                .chars()
                .flat_map(|c| {
                    let v = c as u32;
                    if le {
                        v.to_le_bytes()
                    } else {
                        v.to_be_bytes()
                    }
                })
                .collect())
        }
        "iso-8859-1" => text
            .char_indices()
            .map(|(i, c)| u8::try_from(c as u32).map_err(|_| unwritable(text, i, c)))
            .collect(),
        _ => {
            let enc =
                Encoding::for_label(label.as_bytes()).ok_or(Unwritable { ch: '?', line: 0 })?;
            let mut encoder = enc.new_encoder();
            let mut out = Vec::with_capacity(text.len());
            let mut buf = vec![0u8; 64 * 1024];
            let mut at = 0;
            loop {
                let (result, read, written) =
                    encoder.encode_from_utf8_without_replacement(&text[at..], &mut buf, true);
                out.extend_from_slice(&buf[..written]);
                match result {
                    EncoderResult::InputEmpty => return Ok(out),
                    EncoderResult::OutputFull => at += read,
                    EncoderResult::Unmappable(ch) => {
                        let end = at + read;
                        return Err(unwritable(text, end - ch.len_utf8(), ch));
                    }
                }
            }
        }
    }
}

/// The bytes a save writes: the BOM the file had, then the text in its encoding.
pub fn encode(text: &str, label: &str, bom: bool) -> Result<Vec<u8>, Unwritable> {
    let body = encode_body(text, label)?;
    if !bom {
        return Ok(body);
    }
    let mark: &[u8] = match label {
        "utf-8" => &[0xef, 0xbb, 0xbf],
        "utf-16le" => &[0xff, 0xfe],
        "utf-16be" => &[0xfe, 0xff],
        "utf-32le" => &[0xff, 0xfe, 0, 0],
        "utf-32be" => &[0, 0, 0xfe, 0xff],
        _ => &[],
    };
    Ok([mark, &body].concat())
}

/// One row of Read with encoding...: the same few bytes read as `label`, and what it cannot read in the whole file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub label: String,
    pub name: String,
    pub sample: String,
    pub unreadable: u64,
    /// C1 control characters it reads in the sample: a byte that is a mark in one encoding and nothing in another.
    pub controls: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
    pub rows: Vec<Reading>,
    /// The bytes the unreadable counts cover: the whole file, or its first `READING_BYTES`.
    pub counted: u64,
    pub sample_at: u64,
}

/// Where the encodings differ: a line's worth of bytes from just before the first byte above 7F (a few units of a
/// UTF-16 or UTF-32 file, after its BOM, from just before its first character above 7F).
fn sample_range(bytes: &[u8]) -> (usize, usize) {
    if let Some((label, bom)) = bom_of(bytes).filter(|(l, _)| *l != "utf-8") {
        let unit = if label.starts_with("utf-32") { 4 } else { 2 };
        let bom = bom as usize;
        let le = label.ends_with("le");
        let first = bytes[bom..]
            .chunks_exact(unit)
            .position(|c| {
                let hi = if le { &c[1..] } else { &c[..unit - 1] };
                let lo = if le { c[0] } else { c[unit - 1] };
                lo >= 0x80 || hi.iter().any(|&b| b != 0)
            })
            .unwrap_or(0);
        let start = bom + first.saturating_sub(5) * unit;
        return (start, (start + 64 * unit).min(bytes.len()));
    }
    let first = bytes.iter().position(|&b| b >= 0x80).unwrap_or(0);
    let line_start = bytes[..first]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    let start = first.saturating_sub(5).max(line_start);
    let end = bytes[start..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |i| start + i)
        .min(start + SAMPLE_BYTES);
    (start, end)
}

/// Each candidate's reading of the same few bytes, and how many bytes of the file it cannot read. An encoding the
/// file was found or guessed in that the list does not hold is added to it.
pub fn readings(whole: &[u8]) -> Readings {
    let bytes = &whole[..whole.len().min(READING_BYTES)];
    let (start, end) = sample_range(whole);
    let sample = &whole[start..end];
    let (found, ..) = sniff(bytes);
    let mut labels: Vec<String> = CANDIDATES.iter().map(|(l, _)| (*l).to_string()).collect();
    if !labels.contains(&found) {
        labels.push(found);
    }
    let rows = labels
        .into_iter()
        .map(|label| {
            let (text, ..) = decode_body(sample, &label, 0);
            let text = String::from_utf8_lossy(&text).into_owned();
            let controls = text
                .chars()
                .filter(|c| ('\u{80}'..='\u{9f}').contains(c))
                .count() as u64;
            let own_bom = bom_of(bytes)
                .filter(|(l, _)| *l == label)
                .map_or(0, |(_, n)| n as usize);
            Reading {
                name: name_of(&label),
                unreadable: count_unreadable(&bytes[own_bom..], &label),
                sample: text.trim_end_matches(['\r', '\n']).to_string(),
                controls,
                label,
            }
        })
        .collect();
    Readings {
        rows,
        counted: bytes.len() as u64,
        sample_at: start as u64,
    }
}

#[cfg(test)]
mod tests;
