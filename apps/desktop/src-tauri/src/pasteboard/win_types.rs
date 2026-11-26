//! The one place the pasteboard's type names (`public.html`, `org.nspasteboard.ConcealedType`, the
//! names the page uses on every platform) meet Windows clipboard formats, and how each one's bytes
//! are held there. Pure, so the mapping is tested everywhere; `win32.rs` does the calls.

use std::collections::HashSet;

use super::cf_html;
use super::{PasteboardError, CONCEALED, HTML, PNG, RTF, SOURCE, TEXT, TRANSIENT, URL};

pub const CF_UNICODETEXT: u32 = 13;
pub const HTML_FORMAT: &str = "HTML Format";
pub const RTF_FORMAT: &str = "Rich Text Format";
pub const URL_FORMAT: &str = "UniformResourceLocatorW";
pub const PNG_FORMAT: &str = "PNG";
/// Set by password managers on a secret's copy; clipboard monitors are to ignore the item.
pub const EXCLUDE: &str = "ExcludeClipboardContentFromMonitorProcessing";
/// A DWORD 0 keeps the item out of Win+V history.
pub const HISTORY: &str = "CanIncludeInClipboardHistory";
/// A DWORD 0 keeps the item off the cloud clipboard (sync to other devices).
pub const CLOUD: &str = "CanUploadToCloudClipboard";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// A predefined format, by its number.
    Standard(u32),
    /// A format registered by name (`RegisterClipboardFormatW`).
    Registered(&'static str),
}

/// How a type's bytes are held on the Windows clipboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Body {
    /// UTF-16LE ending in a NUL.
    Utf16,
    /// CF_HTML: a header of byte offsets, then UTF-8.
    CfHtml,
    /// Bytes ending in a NUL (RTF is 7-bit ASCII).
    Nul,
    /// The bytes as they are; the allocation may be padded past them.
    Raw,
}

/// Every type the pasteboard reads or writes, with its Windows format.
const TYPES: [(&str, Format, Body); 5] = [
    (TEXT, Format::Standard(CF_UNICODETEXT), Body::Utf16),
    (HTML, Format::Registered(HTML_FORMAT), Body::CfHtml),
    (RTF, Format::Registered(RTF_FORMAT), Body::Nul),
    (URL, Format::Registered(URL_FORMAT), Body::Utf16),
    (PNG, Format::Registered(PNG_FORMAT), Body::Raw),
];

pub fn format_for(ty: &str) -> Option<(Format, Body)> {
    TYPES
        .iter()
        .find(|(t, _, _)| *t == ty)
        .map(|&(_, f, b)| (f, b))
}

/// The pasteboard type a clipboard format is listed as. `name` is the registered name of a format
/// numbered 0xC000 and up. Any of the three privacy markers lists as concealed, whatever its value:
/// password managers set the history and cloud ones without the exclusion one, and reading a value
/// would be a data read. `None` for the text forms Windows makes from CF_UNICODETEXT (CF_TEXT,
/// CF_OEMTEXT, CF_LOCALE). A format with no mapping is listed under its own name, so the page can
/// tell "only another format" from "nothing".
pub fn type_for(id: u32, name: Option<&str>) -> Option<String> {
    match (id, name) {
        (CF_UNICODETEXT, _) => Some(TEXT.to_string()),
        (1 | 7 | 16, _) => None,
        (_, Some(EXCLUDE | HISTORY | CLOUD)) => Some(CONCEALED.to_string()),
        (_, Some(name)) => Some(
            TYPES
                .iter()
                .find(|(_, f, _)| matches!(f, Format::Registered(n) if *n == name))
                .map_or_else(|| name.to_string(), |(t, _, _)| t.to_string()),
        ),
        (id, None) => Some(standard_name(id)),
    }
}

/// No clipboard holds more formats than this for a reason; enumeration stops here.
pub const MAX_FORMATS: usize = 500;

/// The listed formats of an enumeration, at most `MAX_FORMATS` of it, each type once (its first
/// format), in the source app's order.
pub fn list(formats: impl IntoIterator<Item = (u32, Option<String>)>) -> Vec<(u32, String)> {
    let mut seen = HashSet::new();
    formats
        .into_iter()
        .take(MAX_FORMATS)
        .filter_map(|(id, name)| type_for(id, name.as_deref()).map(|ty| (id, ty)))
        .filter(|(_, ty)| seen.insert(ty.clone()))
        .collect()
}

/// The most bytes a format may hold in memory for its decoded bytes to fit in `cap`: UTF-16 takes
/// two bytes a unit plus its NUL (and decodes to at most `cap` only if it is about that size), and
/// CF_HTML carries its header beside the HTML.
pub fn raw_cap(body: Body, cap: usize) -> usize {
    match body {
        Body::Utf16 => cap.saturating_mul(2).saturating_add(2),
        Body::CfHtml => cap.saturating_add(cf_html::HEADER_MAX),
        Body::Nul | Body::Raw => cap,
    }
}

fn standard_name(id: u32) -> String {
    let known = match id {
        2 => "CF_BITMAP",
        3 => "CF_METAFILEPICT",
        8 => "CF_DIB",
        14 => "CF_ENHMETAFILE",
        15 => "CF_HDROP",
        17 => "CF_DIBV5",
        _ => return format!("CF_{id}"),
    };
    known.to_string()
}

/// A format's bytes as the pasteboard returns them: text as UTF-8, CF_HTML as its HTML, RTF without
/// its NUL. `None` when CF_HTML's header does not hold together, so a broken one reads as no HTML.
pub fn decode(body: Body, raw: &[u8]) -> Option<Vec<u8>> {
    match body {
        Body::Utf16 => {
            let units: Vec<u16> = raw
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&c| u16::from_le_bytes(c))
                .take_while(|&u| u != 0)
                .collect();
            Some(utf16_to_wtf8(&units))
        }
        Body::CfHtml => {
            let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
            cf_html::parse(&raw[..end]).ok().map(<[u8]>::to_vec)
        }
        Body::Nul => {
            let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
            Some(raw[..end].to_vec())
        }
        Body::Raw => Some(raw.to_vec()),
    }
}

/// UTF-16 as UTF-8, except that a lone surrogate is written as its own three bytes (WTF-8), which
/// are not UTF-8: the page then refuses the text by name rather than reading it with U+FFFD in it.
pub fn utf16_to_wtf8(units: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(units.len());
    for r in char::decode_utf16(units.iter().copied()) {
        match r {
            Ok(c) => {
                let mut buf = [0; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            Err(e) => {
                let u = e.unpaired_surrogate();
                out.extend_from_slice(&[
                    0xE0 | (u >> 12) as u8,
                    0x80 | ((u >> 6) & 0x3F) as u8,
                    0x80 | (u & 0x3F) as u8,
                ]);
            }
        }
    }
    out
}

/// One item's representations as the formats to put on the clipboard, in order. `SOURCE` has no
/// Windows convention and is left out; `TRANSIENT` becomes the three markers that keep the item out
/// of clipboard monitors, Win+V history and the cloud clipboard.
pub fn plan_write(reps: &[(String, Vec<u8>)]) -> Result<Vec<(Format, Vec<u8>)>, PasteboardError> {
    let mut out = Vec::with_capacity(reps.len() + 3);
    for (ty, bytes) in reps {
        if ty == SOURCE {
            continue;
        }
        if ty == TRANSIENT {
            for marker in [EXCLUDE, HISTORY, CLOUD] {
                out.push((Format::Registered(marker), 0u32.to_le_bytes().to_vec()));
            }
            continue;
        }
        let (format, body) =
            format_for(ty).ok_or_else(|| PasteboardError::NotWritable(ty.clone()))?;
        out.push((format, encode(body, ty, bytes)?));
    }
    Ok(out)
}

fn encode(body: Body, ty: &str, bytes: &[u8]) -> Result<Vec<u8>, PasteboardError> {
    let text = || {
        std::str::from_utf8(bytes)
            .map_err(|_| PasteboardError::Native(format!("{ty} is not valid UTF-8")))
    };
    Ok(match body {
        Body::Utf16 => text()?
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect(),
        Body::CfHtml => {
            let mut out = cf_html::build(text()?);
            out.push(0);
            out
        }
        Body::Nul => [bytes, &[0]].concat(),
        Body::Raw => bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_type_maps_both_ways() {
        for (ty, format, _) in TYPES {
            let (id, name) = match format {
                Format::Standard(id) => (id, None),
                Format::Registered(name) => (0xC123, Some(name)),
            };
            assert_eq!(type_for(id, name).as_deref(), Some(ty), "{ty}");
            assert_eq!(format_for(ty).map(|(f, _)| f), Some(format));
        }
        assert_eq!(
            format_for(TEXT),
            Some((Format::Standard(CF_UNICODETEXT), Body::Utf16))
        );
        assert_eq!(
            format_for(HTML),
            Some((Format::Registered("HTML Format"), Body::CfHtml))
        );
        assert_eq!(
            format_for(RTF),
            Some((Format::Registered("Rich Text Format"), Body::Nul))
        );
        assert_eq!(format_for("com.example.other"), None);
        assert_eq!(format_for(CONCEALED), None, "a marker is not content");
    }

    #[test]
    fn the_exclusion_marker_lists_as_concealed() {
        assert_eq!(type_for(0xC200, Some(EXCLUDE)).as_deref(), Some(CONCEALED));
        assert_eq!(type_for(0xC201, Some(HISTORY)).as_deref(), Some(CONCEALED));
        assert_eq!(type_for(0xC202, Some(CLOUD)).as_deref(), Some(CONCEALED));
        // Listed once however many markers the copy carries.
        let got = list([
            (CF_UNICODETEXT, None),
            (0xC201, Some(HISTORY.to_string())),
            (0xC202, Some(CLOUD.to_string())),
        ]);
        assert_eq!(
            got,
            vec![
                (CF_UNICODETEXT, TEXT.to_string()),
                (0xC201, CONCEALED.to_string())
            ]
        );
    }

    #[test]
    fn synthesized_text_forms_are_not_listed_and_others_keep_their_names() {
        for id in [1, 7, 16] {
            assert_eq!(type_for(id, None), None, "CF {id}");
        }
        assert_eq!(type_for(8, None).as_deref(), Some("CF_DIB"));
        assert_eq!(type_for(99, None).as_deref(), Some("CF_99"));
        assert_eq!(
            type_for(0xC300, Some("Chromium Web Custom MIME Data Format")).as_deref(),
            Some("Chromium Web Custom MIME Data Format")
        );
        // Matching is exact: a case variant is just another format.
        assert_eq!(
            type_for(0xC301, Some("html format")).as_deref(),
            Some("html format")
        );
    }

    #[test]
    fn decode_reads_each_body() {
        let utf16: Vec<u8> = "hé 🙂"
            .encode_utf16()
            .chain([0, 0x41])
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode(Body::Utf16, &utf16).unwrap(), "hé 🙂".as_bytes());
        assert_eq!(
            decode(Body::Nul, b"{\\rtf1 x}\0\0pad").unwrap(),
            b"{\\rtf1 x}"
        );
        assert_eq!(decode(Body::Raw, b"\x89PNG\0x").unwrap(), b"\x89PNG\0x");
        let mut html = cf_html::build("<b>x</b>");
        html.extend_from_slice(b"\0garbage");
        let got = decode(Body::CfHtml, &html).unwrap();
        assert!(got.starts_with(b"<html>") && got.ends_with(b"</html>"));
        assert_eq!(decode(Body::CfHtml, b"not cf_html"), None);
    }

    #[test]
    fn a_lone_surrogate_becomes_bytes_that_are_not_utf8() {
        let got = utf16_to_wtf8(&[0x61, 0xD800, 0x62]);
        assert_eq!(got, b"a\xED\xA0\x80b");
        assert!(std::str::from_utf8(&got).is_err());
        assert_eq!(utf16_to_wtf8(&[0xD83D, 0xDE42]), "🙂".as_bytes());
    }

    #[test]
    fn a_write_plans_every_format_and_the_markers() {
        let reps = vec![
            (TEXT.to_string(), b"hi".to_vec()),
            (HTML.to_string(), b"<b>hi</b>".to_vec()),
            (RTF.to_string(), b"{\\rtf1 hi}".to_vec()),
            (SOURCE.to_string(), b"dev.marxy.app".to_vec()),
            (TRANSIENT.to_string(), Vec::new()),
        ];
        let plan = plan_write(&reps).unwrap();
        let formats: Vec<Format> = plan.iter().map(|(f, _)| *f).collect();
        assert_eq!(
            formats,
            vec![
                Format::Standard(CF_UNICODETEXT),
                Format::Registered(HTML_FORMAT),
                Format::Registered(RTF_FORMAT),
                Format::Registered(EXCLUDE),
                Format::Registered(HISTORY),
                Format::Registered(CLOUD),
            ]
        );
        assert_eq!(plan[0].1, [b'h', 0, b'i', 0, 0, 0]);
        assert_eq!(decode(Body::CfHtml, &plan[1].1).unwrap().len(), {
            let b = cf_html::build("<b>hi</b>");
            b.len() - b.iter().position(|&c| c == b'<').unwrap()
        });
        assert_eq!(plan[2].1, b"{\\rtf1 hi}\0");
        for (_, marker) in &plan[3..] {
            assert_eq!(marker, &[0, 0, 0, 0]);
        }
        let plain = plan_write(&[(TEXT.to_string(), b"x".to_vec())]).unwrap();
        assert_eq!(plain.len(), 1, "no markers unless transient");
    }

    #[test]
    fn a_write_of_an_unmapped_type_is_refused() {
        assert_eq!(
            plan_write(&[("com.example.x".to_string(), b"x".to_vec())]),
            Err(PasteboardError::NotWritable("com.example.x".to_string()))
        );
    }

    #[test]
    fn enumeration_stops_at_the_cap_and_lists_each_type_once() {
        let many = (0..10_000u32).map(|i| (0xC000 + i, Some(format!("Custom {i}"))));
        let got = list(many);
        assert_eq!(got.len(), MAX_FORMATS);
        assert_eq!(got.last().unwrap().1, format!("Custom {}", MAX_FORMATS - 1));
        let dup = list([(CF_UNICODETEXT, None), (1, None), (CF_UNICODETEXT, None)]);
        assert_eq!(dup, vec![(CF_UNICODETEXT, TEXT.to_string())]);
    }

    #[test]
    fn raw_cap_allows_for_how_each_body_is_held() {
        assert_eq!(raw_cap(Body::Utf16, 100), 202);
        assert_eq!(raw_cap(Body::CfHtml, 100), 100 + cf_html::HEADER_MAX);
        assert_eq!(raw_cap(Body::Nul, 100), 100);
        assert_eq!(raw_cap(Body::Raw, 100), 100);
        assert_eq!(raw_cap(Body::Utf16, usize::MAX), usize::MAX);
    }
}
