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
//! Every command takes one snapshot of the pasteboard's item array and decides and reads from that
//! alone, so a copy that lands mid-command cannot be read, nor mixed with the copy that was checked.
//! A write allows only text, HTML, RTF and URL types, and then adds the markers itself.
//!
//! Two limits, stated plainly. `CAP` bounds what a response carries, not memory: AppKit hands over a
//! representation whole, so an oversized one is read and then dropped, not streamed. And a write is
//! `clearContents` then `writeObjects`; if AppKit refuses the second, the clipboard is left empty
//! (the item is built first, so only that refusal can do it), and the error says so.
//! The commands are synchronous on purpose: Tauri runs those on the main thread, which AppKit's
//! pasteboard needs. Do not make them `async`.
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

/// The representations `pasteboard_write` will write, mirroring `READABLE` minus PNG. Anything else,
/// the marker types included, is refused; the shell adds `SOURCE` and `TRANSIENT` itself. The match
/// is exact, so a case variant of a marker is simply not on the list.
pub const WRITABLE: [&str; 4] = [TEXT, HTML, RTF, URL];

/// Marxy's bundle identifier, `identifier` in `tauri.conf.json` (checked by a test).
pub const BUNDLE_ID: &str = "dev.marxy.app";

/// The largest representation `pasteboard_read` returns. It limits the response, not memory.
pub const CAP: usize = 16 * 1024 * 1024;

/// The pasteboard's item array as it was when `snapshot` was called. Later copies do not show here.
pub trait Snapshot {
    /// The types of each item, in item order. Not a data read.
    fn item_types(&self) -> Vec<Vec<String>>;
    /// The first item's bytes for `ty`, or `None` when it has none. This is the data read.
    fn read(&self, ty: &str) -> Option<Vec<u8>>;
}

/// One pasteboard, as the logic needs it.
pub trait Pasteboard {
    /// Take the item array once; a command uses the result for its type list and every read.
    fn snapshot(&self) -> Box<dyn Snapshot>;
    /// Clear the pasteboard once and write one item holding every `(type, bytes)` pair.
    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum PasteboardError {
    /// The item is marked concealed; nothing of it was read.
    Concealed,
    /// A write named a type outside `WRITABLE`.
    NotWritable(String),
    /// A write with no representations.
    Empty,
    /// Not macOS: the native pasteboard is not built here.
    #[cfg_attr(target_os = "macos", expect(dead_code))]
    Unsupported,
    /// AppKit refused the call.
    #[cfg_attr(not(target_os = "macos"), expect(dead_code))]
    Native(String),
}

impl From<PasteboardError> for ShellError {
    fn from(e: PasteboardError) -> Self {
        let (code, message) = match e {
            PasteboardError::Concealed => (
                "permission",
                "the clipboard holds a concealed item; Marxy does not read it".to_string(),
            ),
            PasteboardError::NotWritable(ty) => (
                "invalid",
                format!("{ty} cannot be written; only text, HTML, RTF and URL can"),
            ),
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

/// The types on the pasteboard's first item, plus `CONCEALED` when any item carries it. Reads no data.
pub fn read_types(pb: &dyn Pasteboard) -> Vec<String> {
    let items = pb.snapshot().item_types();
    let mut types = items.first().cloned().unwrap_or_default();
    if !types.iter().any(|t| t == CONCEALED) && is_concealed(&items) {
        types.push(CONCEALED.to_string());
    }
    types
}

/// A concealed marker on any item, not only the first, refuses the read.
fn is_concealed(items: &[Vec<String>]) -> bool {
    items.iter().flatten().any(|t| t == CONCEALED)
}

/// A representation that was held but not returned because it is over `CAP`.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Skipped {
    #[serde(rename = "type")]
    pub ty: String,
    pub len: usize,
}

/// What a read returned: the representations, and those skipped for size.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Read {
    pub reps: Vec<(String, Vec<u8>)>,
    pub skipped: Vec<Skipped>,
}

/// The requested representations that the first item holds, in `READABLE` order, from one snapshot.
/// A concealed item (on any item) is refused before any data read; a type not in `READABLE`, or not
/// requested, is never read; one over `CAP` is skipped and reported while the rest is returned.
pub fn read_reps(pb: &dyn Pasteboard, wanted: &[String]) -> Result<Read, PasteboardError> {
    let snap = pb.snapshot();
    let items = snap.item_types();
    if is_concealed(&items) {
        return Err(PasteboardError::Concealed);
    }
    let first = items.first().cloned().unwrap_or_default();
    let mut out = Read::default();
    for ty in READABLE {
        if !wanted.iter().any(|w| w == ty) || !first.iter().any(|t| t == ty) {
            continue;
        }
        if let Some(bytes) = snap.read(ty) {
            if bytes.len() > CAP {
                out.skipped.push(Skipped {
                    ty: ty.to_string(),
                    len: bytes.len(),
                });
            } else {
                out.reps.push((ty.to_string(), bytes));
            }
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
    if let Some((ty, _)) = reps.iter().find(|(ty, _)| !WRITABLE.contains(&ty.as_str())) {
        return Err(PasteboardError::NotWritable(ty.clone()));
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
    /// Representations over `CAP`, named but not returned.
    pub skipped: Vec<Skipped>,
}

/// One representation to write; `data` is the text itself (text, HTML and RTF are text).
#[derive(Debug, Deserialize)]
pub struct WriteRep {
    #[serde(rename = "type")]
    pub ty: String,
    pub data: String,
}

/// Text-like types cross as UTF-8 when they are; PNG, and any bytes that are not UTF-8, as base64.
fn encode_rep(ty: String, mut bytes: Vec<u8>) -> ReadRep {
    if ty != PNG {
        match String::from_utf8(bytes) {
            Ok(text) => {
                return ReadRep {
                    ty,
                    encoding: Encoding::Utf8,
                    data: text,
                }
            }
            Err(e) => bytes = e.into_bytes(),
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

// The three commands below stay synchronous: Tauri runs them on the main thread (AppKit needs it).

/// The first item's types, read on a reader action only. Reads no data.
#[tauri::command]
pub fn pasteboard_types() -> Result<Vec<String>, ShellError> {
    with_general(|pb| Ok(read_types(pb))).map_err(Into::into)
}

/// The requested representations of the first item; refuses a concealed item unread.
#[tauri::command]
pub fn pasteboard_read(types: Vec<String>) -> Result<PasteboardRead, ShellError> {
    with_general(|pb| read_reps(pb, &types))
        .map(|read| PasteboardRead {
            reps: read
                .reps
                .into_iter()
                .map(|(ty, bytes)| encode_rep(ty, bytes))
                .collect(),
            skipped: read.skipped,
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
        let got = read_reps(&pb, &wanted).unwrap().reps;
        assert_eq!(pb.reads(), vec![HTML.to_string(), PNG.to_string()]);
        assert_eq!(types_of(&got), vec![HTML, PNG]);
        assert_eq!(got[0].1, b"<p>html</p>");
    }

    #[test]
    fn an_oversized_rep_is_skipped_and_reported_and_the_rest_returns() {
        let big = vec![b'a'; CAP + 1];
        let pb = FakePasteboard::holding(vec![vec![(HTML.to_string(), big), rep(TEXT, "small")]]);
        let wanted = vec![TEXT.to_string(), HTML.to_string()];
        let got = read_reps(&pb, &wanted).unwrap();
        assert_eq!(types_of(&got.reps), vec![TEXT]);
        assert_eq!(
            got.skipped,
            vec![Skipped {
                ty: HTML.to_string(),
                len: CAP + 1
            }]
        );
        let at_cap = FakePasteboard::holding(vec![vec![(HTML.to_string(), vec![b'a'; CAP])]]);
        let got = read_reps(&at_cap, &wanted).unwrap();
        assert_eq!(got.reps[0].1.len(), CAP);
        assert!(got.skipped.is_empty());
    }

    #[test]
    fn a_read_uses_one_snapshot_so_a_later_copy_is_not_read() {
        let pb = FakePasteboard::holding(vec![vec![rep(TEXT, "checked")]]);
        *pb.lands_after_snapshot.borrow_mut() = Some(vec![vec![rep(TEXT, "landed later")]]);
        let wanted = vec![TEXT.to_string()];
        let got = read_reps(&pb, &wanted).unwrap();
        assert_eq!(pb.snapshots(), 1, "one snapshot per command");
        assert_eq!(got.reps, vec![rep(TEXT, "checked")]);
        assert_eq!(pb.current()[0][0].1, b"landed later", "the copy did land");
    }

    #[test]
    fn a_concealed_marker_on_any_item_refuses_the_read() {
        let pb = FakePasteboard::holding(vec![
            vec![rep(TEXT, "a")],
            vec![rep(TEXT, "b"), rep(CONCEALED, "")],
        ]);
        let wanted = vec![TEXT.to_string()];
        assert_eq!(read_reps(&pb, &wanted), Err(PasteboardError::Concealed));
        assert_eq!(pb.data_reads(), 0);
        assert!(read_types(&pb).contains(&CONCEALED.to_string()));
    }

    #[test]
    fn only_text_html_rtf_and_url_can_be_written() {
        let mut pb = FakePasteboard::default();
        for ty in [TEXT, HTML, RTF, URL] {
            write_reps(&mut pb, &[rep(ty, "x")], false).unwrap();
        }
        for ty in [PNG, "com.example.other"] {
            assert_eq!(
                write_reps(&mut pb, &[rep(TEXT, "x"), rep(ty, "y")], false),
                Err(PasteboardError::NotWritable(ty.to_string()))
            );
        }
        assert_eq!(write_reps(&mut pb, &[], false), Err(PasteboardError::Empty));
        assert_eq!(pb.clears, 4, "a refused write leaves the pasteboard alone");
    }

    #[test]
    fn a_write_cannot_forge_or_drop_the_markers_in_any_case() {
        let mut pb = FakePasteboard::default();
        for ty in [SOURCE, TRANSIENT, CONCEALED] {
            for variant in [ty.to_string(), ty.to_uppercase(), ty.to_lowercase()] {
                assert_eq!(
                    write_reps(&mut pb, &[rep(TEXT, "x"), rep(&variant, "y")], false),
                    Err(PasteboardError::NotWritable(variant.clone())),
                    "{variant}"
                );
            }
        }
        assert_eq!(pb.clears, 0);
        write_reps(&mut pb, &[rep(TEXT, "x")], false).unwrap();
        assert!(
            types_of(&pb.items[0]).contains(&SOURCE),
            "the shell adds it"
        );
    }

    #[test]
    fn a_failed_write_leaves_the_clipboard_empty() {
        let mut pb = FakePasteboard::holding(vec![vec![rep(TEXT, "kept?")]]);
        pb.fail_write = true;
        assert!(matches!(
            write_reps(&mut pb, &[rep(TEXT, "x")], false),
            Err(PasteboardError::Native(_))
        ));
        assert!(pb.items.is_empty(), "as the module doc says");
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
