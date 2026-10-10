//! The native pasteboard (J-01, ADR-0065 items 2, 3 and 5): list the first item's types, read
//! chosen representations, and write several representations as one item tagged with Marxy as its
//! source.
//!
//! Privacy is the shape of this module. Nothing here watches the pasteboard: there is no polling and
//! no `changeCount` observation, and the only data reads are the ones `pasteboard_read` asks for, on
//! a reader action. An item marked `org.nspasteboard.ConcealedType` (a password manager's copy) is
//! refused before a single byte of it is read. Every write carries `org.nspasteboard.source`, and
//! Marxy's own temporary writes carry `org.nspasteboard.TransientType` so clipboard managers skip
//! them (nspasteboard.org).
//!
//! The trait, the types and the logic compile on every platform, so the Linux job's clippy sees them
//! used; only `macos.rs` is `cfg(target_os = "macos")`. Elsewhere the commands return `unsupported`
//! and Linux keeps the clipboard plugin's write path (`clipboard_write` in `main.rs`, unchanged).

#[cfg(test)]
mod fake;
#[cfg(target_os = "macos")]
mod macos;

use serde::{Deserialize, Serialize};

use crate::error::ShellError;

/// Plain text, UTF-8.
pub const TEXT: &str = "public.utf8-plain-text";
pub const HTML: &str = "public.html";
pub const RTF: &str = "public.rtf";
pub const URL: &str = "public.url";
pub const PNG: &str = "public.png";

/// The representations `pasteboard_read` will read, in the order it reads them. A requested type
/// outside this list is never read.
pub const READABLE: [&str; 5] = [TEXT, HTML, RTF, URL, PNG];

/// Names the app that put the item on the pasteboard; its value is the bundle identifier.
pub const SOURCE: &str = "org.nspasteboard.source";
/// Marks an item that clipboard managers and history tools should not record.
pub const TRANSIENT: &str = "org.nspasteboard.TransientType";
/// Marks an item (a password, a one-time code) that must not be read or recorded.
pub const CONCEALED: &str = "org.nspasteboard.ConcealedType";

/// The marker types only the shell writes, so a caller cannot forge or drop them.
const RESERVED: [&str; 3] = [SOURCE, TRANSIENT, CONCEALED];

/// Marxy's bundle identifier, `identifier` in `tauri.conf.json` (checked by a test).
pub const BUNDLE_ID: &str = "dev.marxy.app";

/// The largest representation `pasteboard_read` returns.
pub const CAP: usize = 16 * 1024 * 1024;

/// One pasteboard, as the logic needs it. `types` is not a data read; `read` is, and is the only one.
pub trait Pasteboard {
    /// The types of the first item (and `CONCEALED` if any item carries it).
    fn types(&self) -> Vec<String>;
    /// The first item's bytes for `ty`, or `None` when it has none.
    fn read(&self, ty: &str) -> Option<Vec<u8>>;
    /// Clear the pasteboard once and write one item holding every `(type, bytes)` pair.
    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum PasteboardError {
    /// The item is marked concealed; nothing of it was read.
    Concealed,
    /// A representation is larger than `CAP`.
    TooLarge { ty: String, len: usize },
    /// A write named a marker type the shell owns.
    Reserved(String),
    /// A write with no representations.
    Empty,
    /// Not macOS: the native pasteboard is not built here.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// AppKit refused the call.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Native(String),
}

impl From<PasteboardError> for ShellError {
    fn from(e: PasteboardError) -> Self {
        let (code, message) = match e {
            PasteboardError::Concealed => (
                "permission",
                "the clipboard holds a concealed item; Marxy does not read it".to_string(),
            ),
            PasteboardError::TooLarge { ty, len } => (
                "invalid",
                format!("{ty} on the clipboard is {len} bytes, over the {CAP}-byte limit"),
            ),
            PasteboardError::Reserved(ty) => {
                ("invalid", format!("{ty} is written by the shell only"))
            }
            PasteboardError::Empty => ("invalid", "nothing to write".to_string()),
            PasteboardError::Unsupported => (
                "unsupported",
                "the native pasteboard is macOS only; use clipboardWrite".to_string(),
            ),
            PasteboardError::Native(m) => ("io", m),
        };
        ShellError {
            code: code.into(),
            message,
            path: None,
        }
    }
}

/// The types on the pasteboard's first item. Reads no data.
pub fn read_types(pb: &dyn Pasteboard) -> Vec<String> {
    pb.types()
}

/// The requested representations that the first item holds, in `READABLE` order. A concealed item is
/// refused before any data read; a type not in `READABLE`, or not requested, is never read.
pub fn read_reps(
    pb: &dyn Pasteboard,
    wanted: &[String],
) -> Result<Vec<(String, Vec<u8>)>, PasteboardError> {
    let types = pb.types();
    if types.iter().any(|t| t == CONCEALED) {
        return Err(PasteboardError::Concealed);
    }
    let mut out = Vec::new();
    for ty in READABLE {
        if !wanted.iter().any(|w| w == ty) || !types.iter().any(|t| t == ty) {
            continue;
        }
        if let Some(bytes) = pb.read(ty) {
            if bytes.len() > CAP {
                return Err(PasteboardError::TooLarge {
                    ty: ty.to_string(),
                    len: bytes.len(),
                });
            }
            out.push((ty.to_string(), bytes));
        }
    }
    Ok(out)
}

/// Write `reps` as one item, plus `SOURCE` = Marxy's bundle id, plus `TRANSIENT` when `transient`.
pub fn write_reps(
    pb: &mut dyn Pasteboard,
    reps: &[(String, Vec<u8>)],
    transient: bool,
) -> Result<(), PasteboardError> {
    if reps.is_empty() {
        return Err(PasteboardError::Empty);
    }
    if let Some((ty, _)) = reps.iter().find(|(ty, _)| RESERVED.contains(&ty.as_str())) {
        return Err(PasteboardError::Reserved(ty.clone()));
    }
    let mut item = reps.to_vec();
    item.push((SOURCE.to_string(), BUNDLE_ID.as_bytes().to_vec()));
    if transient {
        item.push((TRANSIENT.to_string(), Vec::new()));
    }
    pb.write_item(&item)
}

/// How a representation's bytes cross IPC.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Base64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ReadRep {
    #[serde(rename = "type")]
    pub ty: String,
    pub encoding: Encoding,
    pub data: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PasteboardRead {
    pub reps: Vec<ReadRep>,
}

/// One representation to write; `data` is the text itself (text, HTML and RTF are text).
#[derive(Debug, Deserialize)]
pub struct WriteRep {
    #[serde(rename = "type")]
    pub ty: String,
    pub data: String,
}

/// Text-like types cross as UTF-8 when they are; PNG, and any bytes that are not UTF-8, as base64.
fn encode_rep(ty: String, bytes: Vec<u8>) -> ReadRep {
    if ty != PNG {
        if let Ok(text) = String::from_utf8(bytes.clone()) {
            return ReadRep {
                ty,
                encoding: Encoding::Utf8,
                data: text,
            };
        }
    }
    ReadRep {
        ty,
        encoding: Encoding::Base64,
        data: base64(&bytes),
    }
}

/// Standard base64 with padding (RFC 4648 §4).
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Run `f` on the general pasteboard. On macOS the command is synchronous, so Tauri runs it on the
/// main thread, where AppKit wants NSPasteboard; `macos::General::new` checks that it is.
fn with_general<R>(
    f: impl FnOnce(&mut dyn Pasteboard) -> Result<R, PasteboardError>,
) -> Result<R, PasteboardError> {
    #[cfg(target_os = "macos")]
    {
        let mut pb = macos::General::new()?;
        f(&mut pb)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = f;
        Err(PasteboardError::Unsupported)
    }
}

/// The first item's types, read on a reader action only. Reads no data.
#[tauri::command]
pub fn pasteboard_types() -> Result<Vec<String>, ShellError> {
    with_general(|pb| Ok(read_types(pb))).map_err(Into::into)
}

/// The requested representations of the first item; refuses a concealed item unread.
#[tauri::command]
pub fn pasteboard_read(types: Vec<String>) -> Result<PasteboardRead, ShellError> {
    with_general(|pb| read_reps(pb, &types))
        .map(|reps| PasteboardRead {
            reps: reps
                .into_iter()
                .map(|(ty, bytes)| encode_rep(ty, bytes))
                .collect(),
        })
        .map_err(Into::into)
}

/// Write `reps` as one item tagged with Marxy as its source, marked transient when asked.
#[tauri::command]
pub fn pasteboard_write(reps: Vec<WriteRep>, transient: bool) -> Result<(), ShellError> {
    let reps: Vec<(String, Vec<u8>)> = reps
        .into_iter()
        .map(|r| (r.ty, r.data.into_bytes()))
        .collect();
    with_general(|pb| write_reps(pb, &reps, transient)).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::fake::FakePasteboard;
    use super::*;

    fn rep(ty: &str, data: &str) -> (String, Vec<u8>) {
        (ty.to_string(), data.as_bytes().to_vec())
    }

    fn types_of(item: &[(String, Vec<u8>)]) -> Vec<&str> {
        item.iter().map(|(t, _)| t.as_str()).collect()
    }

    #[test]
    fn one_item_every_rep() {
        let mut pb = FakePasteboard::holding(vec![vec![rep("com.example.old", "x")]]);
        let reps = [
            rep(TEXT, "hi"),
            rep(HTML, "<b>hi</b>"),
            rep(RTF, "{\\rtf1 hi}"),
        ];
        write_reps(&mut pb, &reps, false).unwrap();
        assert_eq!(pb.clears, 1, "the pasteboard is cleared exactly once");
        assert_eq!(pb.items.len(), 1, "one copy is one item");
        let item = &pb.items[0];
        assert_eq!(types_of(item), vec![TEXT, HTML, RTF, SOURCE]);
        assert_eq!(item[0].1, b"hi");
        assert_eq!(item[1].1, b"<b>hi</b>");
        assert_eq!(item[2].1, b"{\\rtf1 hi}");
        assert_eq!(item[3].1, BUNDLE_ID.as_bytes());
    }

    #[test]
    fn transient_marked() {
        let mut pb = FakePasteboard::default();
        write_reps(&mut pb, &[rep(TEXT, "hi")], true).unwrap();
        assert_eq!(types_of(&pb.items[0]), vec![TEXT, SOURCE, TRANSIENT]);
        write_reps(&mut pb, &[rep(TEXT, "hi")], false).unwrap();
        assert!(!types_of(&pb.items[0]).contains(&TRANSIENT));
    }

    #[test]
    fn concealed_refused_unread() {
        let pb = FakePasteboard::holding(vec![vec![rep(TEXT, "hunter2"), rep(CONCEALED, "")]]);
        let wanted: Vec<String> = READABLE.iter().map(|t| t.to_string()).collect();
        assert_eq!(read_reps(&pb, &wanted), Err(PasteboardError::Concealed));
        assert_eq!(
            pb.data_reads(),
            0,
            "not one byte of a concealed item is read"
        );
        // The types alone are not a data read, and they say why.
        assert!(read_types(&pb).contains(&CONCEALED.to_string()));
        assert_eq!(pb.data_reads(), 0);
    }

    #[test]
    fn reads_only_requested() {
        let pb = FakePasteboard::holding(vec![vec![
            rep(TEXT, "plain"),
            rep(HTML, "<p>html</p>"),
            rep(RTF, "{\\rtf1}"),
            rep(PNG, "\u{89}PNG"),
            rep("com.example.private", "secret"),
        ]]);
        // Asked in reverse order and for a type outside READABLE: reads HTML then PNG, nothing else.
        let wanted = vec![
            "com.example.private".to_string(),
            PNG.to_string(),
            HTML.to_string(),
            URL.to_string(),
        ];
        let got = read_reps(&pb, &wanted).unwrap();
        assert_eq!(pb.reads(), vec![HTML.to_string(), PNG.to_string()]);
        assert_eq!(types_of(&got), vec![HTML, PNG]);
        assert_eq!(got[0].1, b"<p>html</p>");
    }

    #[test]
    fn cap() {
        let big = vec![b'a'; CAP + 1];
        let pb = FakePasteboard::holding(vec![vec![(HTML.to_string(), big), rep(TEXT, "small")]]);
        let wanted = vec![TEXT.to_string(), HTML.to_string()];
        assert_eq!(
            read_reps(&pb, &wanted),
            Err(PasteboardError::TooLarge {
                ty: HTML.to_string(),
                len: CAP + 1
            })
        );
        let at_cap = FakePasteboard::holding(vec![vec![(HTML.to_string(), vec![b'a'; CAP])]]);
        assert_eq!(read_reps(&at_cap, &wanted).unwrap()[0].1.len(), CAP);
    }

    #[test]
    fn a_write_cannot_forge_or_drop_the_markers() {
        let mut pb = FakePasteboard::default();
        for ty in RESERVED {
            assert_eq!(
                write_reps(&mut pb, &[rep(TEXT, "x"), rep(ty, "y")], false),
                Err(PasteboardError::Reserved(ty.to_string()))
            );
        }
        assert_eq!(write_reps(&mut pb, &[], false), Err(PasteboardError::Empty));
        assert_eq!(pb.clears, 0, "a refused write leaves the pasteboard alone");
    }

    #[test]
    fn the_source_is_the_bundle_identifier() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], BUNDLE_ID);
    }

    #[test]
    fn text_crosses_as_utf8_and_png_as_base64() {
        assert_eq!(
            encode_rep(HTML.into(), b"<b>\xc3\xa9</b>".to_vec()),
            ReadRep {
                ty: HTML.into(),
                encoding: Encoding::Utf8,
                data: "<b>é</b>".into()
            }
        );
        assert_eq!(
            encode_rep(PNG.into(), b"PNG".to_vec()).encoding,
            Encoding::Base64
        );
        assert_eq!(
            encode_rep(RTF.into(), vec![0xff]).encoding,
            Encoding::Base64
        );
        // RFC 4648 §10 test vectors.
        for (input, want) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), want);
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_platforms_say_unsupported() {
        assert_eq!(pasteboard_types().unwrap_err().code, "unsupported");
        assert_eq!(
            pasteboard_read(vec![TEXT.into()]).unwrap_err().code,
            "unsupported"
        );
    }
}
