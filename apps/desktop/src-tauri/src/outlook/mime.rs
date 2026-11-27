//! The message written as it would travel (RFC 5322 headers, MIME parts), so the mail page reads an Outlook message
//! with the one parser it reads `.eml` with. Every header value is one line with its control characters gone, so
//! nothing a property holds can start a header or a part of its own; bodies travel as base64, and each boundary is
//! derived from the bytes it encloses and checked against them once.

use std::hash::{Hash, Hasher};

/// A filename in a header is at most this many bytes of text, a single header value this many.
pub const NAME_MAX: usize = 1024;
pub const VALUE_MAX: usize = 64 * 1024;

/// `s` cut to at most `max` bytes, at a character boundary.
pub fn clip(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// One part: headers of its own (the message's on the root), its type, and what it holds.
pub struct Part {
    pub headers: Vec<String>,
    pub content_type: String,
    pub disposition: Option<String>,
    pub cid: Option<String>,
    pub body: Body,
}

pub enum Body {
    /// Bytes sent as base64.
    Encoded(Vec<u8>),
    /// A message inside this one, written as it travels (RFC 2046 keeps `message/rfc822` unencoded).
    Message(Vec<u8>),
    /// A multipart's subtype and its parts.
    Multi(&'static str, Vec<Part>),
}

impl Part {
    pub fn leaf(content_type: String, bytes: Vec<u8>) -> Part {
        Part {
            headers: Vec::new(),
            content_type,
            disposition: None,
            cid: None,
            body: Body::Encoded(bytes),
        }
    }

    pub fn multi(subtype: &'static str, parts: Vec<Part>) -> Part {
        Part {
            headers: Vec::new(),
            content_type: String::new(),
            disposition: None,
            cid: None,
            body: Body::Multi(subtype, parts),
        }
    }
}

/// `s` on one line: control characters (CR and LF among them) become spaces, and the ends are trimmed.
pub fn one_line(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// The base64 of `n` bytes in 76-character lines, as written: what a body costs in the message.
pub fn encoded_len(n: usize) -> usize {
    let chars = n.div_ceil(3) * 4;
    chars + chars.div_ceil(76) * 2
}

fn base64_lines(bytes: &[u8], out: &mut Vec<u8>) {
    let all = base64(bytes);
    for line in all.as_bytes().chunks(76) {
        out.extend_from_slice(line);
        out.extend_from_slice(b"\r\n");
    }
}

/// An unstructured header value: as it is when it is printable ASCII, else as UTF-8 encoded words (RFC 2047) of whole
/// characters, so a strict reader of the written message reads it too.
pub fn words(s: &str) -> String {
    let s = one_line(clip(s, VALUE_MAX));
    if s.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        return s;
    }
    let mut out = Vec::new();
    let mut chunk = String::new();
    for c in s.chars() {
        if chunk.len() + c.len_utf8() > 45 {
            out.push(format!("=?utf-8?B?{}?=", base64(chunk.as_bytes())));
            chunk.clear();
        }
        chunk.push(c);
    }
    if !chunk.is_empty() {
        out.push(format!("=?utf-8?B?{}?=", base64(chunk.as_bytes())));
    }
    out.join(" ")
}

/// `"Name" <address>`, the name quoted or written as encoded words; the address with what would end it taken out.
pub fn mailbox(name: &str, address: &str) -> String {
    let address: String = one_line(address)
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ',' | ';' | '"' | ' '))
        .collect();
    let name = one_line(name);
    if name.is_empty() || name == address {
        return format!("<{address}>");
    }
    let shown = if name.is_ascii() {
        format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        words(&name)
    };
    format!("{shown} <{address}>")
}

/// A list of mailboxes, one to a folded line.
pub fn mailboxes(list: &[(String, String)]) -> String {
    list.iter()
        .map(|(n, a)| mailbox(n, a))
        .collect::<Vec<_>>()
        .join(",\r\n ")
}

/// `key="value"`, or RFC 2231's `key*=utf-8''…` for a value that is not plain ASCII.
pub fn param(key: &str, value: &str) -> String {
    let value = one_line(clip(value, NAME_MAX));
    if value
        .bytes()
        .all(|b| (0x20..0x7f).contains(&b) && b != b'"' && b != b'\\')
    {
        return format!("{key}=\"{value}\"");
    }
    let mut enc = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
            enc.push(b as char);
        } else {
            enc.push_str(&format!("%{b:02X}"));
        }
    }
    format!("{key}*=utf-8''{enc}")
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
thread_local! {
    pub static SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A boundary no one can name ahead: it comes from the bytes it will enclose, so text written to contain it has to
/// contain its own hash.
fn boundary(written: &[Vec<u8>], n: u32, attempt: u32) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (n, attempt).hash(&mut h);
    for w in written {
        w.hash(&mut h);
    }
    format!("=_marxy_{n}_{:016x}", h.finish())
}

/// How many boundaries are tried for one multipart before giving up: a miss means the content holds a hash of itself.
const BOUNDARY_TRIES: u32 = 3;

/// The part as bytes: its headers, an empty line, its body. `n` numbers the boundaries made. None when no boundary
/// could be found that its parts do not hold.
pub fn write(part: &Part, n: &mut u32) -> Option<Vec<u8>> {
    write_with(part, n, &boundary)
}

/// Makes a boundary from what it will enclose, the part's number and the attempt.
type Pick = dyn Fn(&[Vec<u8>], u32, u32) -> String;

fn write_with(part: &Part, n: &mut u32, pick: &Pick) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for h in &part.headers {
        out.extend_from_slice(h.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    match &part.body {
        Body::Multi(subtype, parts) => {
            let written = parts
                .iter()
                .map(|p| write_with(p, n, pick))
                .collect::<Option<Vec<Vec<u8>>>>()?;
            *n += 1;
            let mut found = None;
            for attempt in 0..BOUNDARY_TRIES {
                let b = pick(&written, *n, attempt);
                let needle = format!("--{b}");
                #[cfg(test)]
                SCANS.with(|c| c.set(c.get() + 1));
                if !written.iter().any(|w| contains(w, needle.as_bytes())) {
                    found = Some(b);
                    break;
                }
            }
            let boundary = found?;
            out.extend_from_slice(
                format!("Content-Type: multipart/{subtype}; boundary=\"{boundary}\"\r\n\r\n")
                    .as_bytes(),
            );
            for w in &written {
                out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
                out.extend_from_slice(w);
                out.extend_from_slice(b"\r\n");
            }
            out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        }
        Body::Encoded(bytes) => {
            leaf_head(part, &mut out);
            out.extend_from_slice(b"Content-Transfer-Encoding: base64\r\n\r\n");
            base64_lines(bytes, &mut out);
        }
        Body::Message(bytes) => {
            leaf_head(part, &mut out);
            out.extend_from_slice(b"Content-Transfer-Encoding: 8bit\r\n\r\n");
            out.extend_from_slice(bytes);
        }
    }
    Some(out)
}

fn leaf_head(part: &Part, out: &mut Vec<u8>) {
    out.extend_from_slice(format!("Content-Type: {}\r\n", part.content_type).as_bytes());
    if let Some(d) = &part.disposition {
        out.extend_from_slice(format!("Content-Disposition: {d}\r\n").as_bytes());
    }
    if let Some(c) = &part.cid {
        out.extend_from_slice(format!("Content-ID: <{c}>\r\n").as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_stay_on_one_line_and_say_what_they_hold() {
        assert_eq!(one_line(" a\r\nBcc: x\u{0}y "), "a  Bcc: x y");
        assert_eq!(words("Tide table"), "Tide table");
        assert_eq!(words("Marée"), "=?utf-8?B?TWFyw6ll?=");
        assert_eq!(
            mailbox("Harbour \"Office\"", "a@b.example"),
            "\"Harbour \\\"Office\\\"\" <a@b.example>"
        );
        assert_eq!(mailbox("", "a@b>, c"), "<a@bc>");
        assert_eq!(
            param("filename", "tide table.csv"),
            "filename=\"tide table.csv\""
        );
        assert_eq!(
            param("filename", "marée.csv"),
            "filename*=utf-8''mar%C3%A9e.csv"
        );
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(encoded_len(57), 78);
    }

    fn message_part(body: &[u8]) -> Part {
        Part {
            headers: vec![],
            content_type: "message/rfc822".into(),
            disposition: None,
            cid: None,
            body: Body::Message(body.to_vec()),
        }
    }

    #[test]
    fn a_boundary_is_never_one_its_parts_hold() {
        let mut held = b"Subject: x

"
        .to_vec();
        for k in 0..200 {
            held.extend_from_slice(
                format!(
                    "--=_marxy_1_{k} --=_marxy_1
"
                )
                .as_bytes(),
            );
        }
        held.extend_from_slice(&vec![b'x'; 1 << 20]);
        SCANS.with(|c| c.set(0));
        let out = write(&Part::multi("mixed", vec![message_part(&held)]), &mut 0).unwrap();
        let scans = SCANS.with(|c| c.get());
        assert_eq!(scans, 1, "one scan, not one per name the content lists");
        let text = String::from_utf8_lossy(&out);
        let at = text.find("boundary=\"").unwrap() + 10;
        let b = &text[at..at + text[at..].find('"').unwrap()];
        assert!(!String::from_utf8_lossy(&held).contains(&format!("--{b}")));
    }

    #[test]
    fn a_boundary_that_keeps_colliding_fails_after_three_scans() {
        let held = b"--same\r\n";
        SCANS.with(|c| c.set(0));
        let got = write_with(
            &Part::multi("mixed", vec![message_part(held)]),
            &mut 0,
            &|_, _, _| "same".to_string(),
        );
        assert!(got.is_none());
        assert_eq!(SCANS.with(|c| c.get()), BOUNDARY_TRIES as usize);
    }

    #[test]
    fn clipping_stops_at_a_character_boundary() {
        assert_eq!(clip("aéb", 2), "a");
        assert_eq!(clip("aéb", 3), "aé");
        assert!(param("filename", &"é".repeat(5000)).len() < 3 * NAME_MAX + 32);
        assert!(words(&"é".repeat(100_000)).len() < 2 * VALUE_MAX);
    }
}
