//! An RTF body that wraps HTML or plain text (`\fromhtml1`, `\fromtext`), taken back out as MS-OXRTFEX describes: the
//! text of `\*\htmltag` groups and the text outside `\htmlrtf` runs, every other destination left out. This is no RTF
//! renderer: an RTF that wraps neither is not read here, and the message's plain text stands in for it.

use encoding_rs::Encoding;

/// What an RTF body wraps.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Wrapped {
    Html,
    Text,
}

/// Groups deeper than this are read as if at this depth: enough for any mail, and no stack to exhaust.
const DEPTH: usize = 1_000;

/// Destinations whose text is never the message's (font and colour tables, pictures, document info).
const SKIPPED: &[&[u8]] = &[
    b"fonttbl",
    b"colortbl",
    b"stylesheet",
    b"info",
    b"pict",
    b"object",
    b"listtable",
    b"listoverridetable",
    b"rsidtbl",
    b"generator",
    b"xmlnstbl",
    b"themedata",
    b"colorschememapping",
    b"latentstyles",
    b"datastore",
    b"filetbl",
    b"revtbl",
    b"header",
    b"footer",
    b"headerl",
    b"headerr",
    b"headerf",
    b"footerl",
    b"footerr",
    b"footerf",
];

/// What `rtf` wraps, from the control words of its first kilobyte, before any text.
pub fn wraps(rtf: &[u8]) -> Option<Wrapped> {
    if !rtf.starts_with(b"{\\rtf") {
        return None;
    }
    let head = &rtf[..rtf.len().min(1024)];
    let has = |word: &[u8]| {
        head.windows(word.len() + 1)
            .any(|w| &w[..word.len()] == word && !w[word.len()].is_ascii_alphabetic())
    };
    if has(b"\\fromhtml") {
        Some(Wrapped::Html)
    } else if has(b"\\fromtext") {
        Some(Wrapped::Text)
    } else {
        None
    }
}

#[derive(Clone, Copy)]
struct Group {
    /// Inside `\htmlrtf`: RTF written only for RTF readers.
    suppressed: bool,
    /// Inside a destination whose text is not the message's.
    skipped: bool,
    /// Inside `\*\htmltag`: the HTML as written.
    tag: bool,
    /// Fallback characters after a `\u`, set by `\uc`.
    uc: u32,
}

/// Text that arrives as bytes in the RTF's code page and as Unicode from `\u`, joined.
struct Out {
    enc: &'static Encoding,
    pending: Vec<u8>,
    text: String,
}

impl Out {
    fn flush(&mut self) {
        if !self.pending.is_empty() {
            let (s, _, _) = self.enc.decode(&self.pending);
            self.text.push_str(&s);
            self.pending.clear();
        }
    }
    fn byte(&mut self, b: u8) {
        self.pending.push(b);
    }
    fn char(&mut self, c: char) {
        self.flush();
        self.text.push(c);
    }
}

fn number(b: &[u8], at: &mut usize) -> Option<i64> {
    let start = *at;
    if b.get(*at) == Some(&b'-') {
        *at += 1;
    }
    let digits = *at;
    while *at < b.len() && b[*at].is_ascii_digit() && *at - digits < 10 {
        *at += 1;
    }
    if *at == digits {
        *at = start;
        return None;
    }
    std::str::from_utf8(&b[start..*at]).ok()?.parse().ok()
}

/// The HTML or text `rtf` wraps. `code_page` decodes `\'hh` bytes when the RTF names no `\ansicpg`.
pub fn unwrap(rtf: &[u8], fallback: &'static Encoding) -> String {
    let mut enc = fallback;
    if let Some(i) = find(rtf, b"\\ansicpg") {
        let mut at = i + 8;
        if let Some(cp) = number(rtf, &mut at) {
            if let Some(e) = u32::try_from(cp)
                .ok()
                .and_then(crate::encoding::of_code_page)
            {
                enc = e;
            }
        }
    }
    let mut out = Out {
        enc,
        pending: Vec::new(),
        text: String::new(),
    };
    let mut stack: Vec<Group> = Vec::new();
    let mut g = Group {
        suppressed: false,
        skipped: false,
        tag: false,
        uc: 1,
    };
    // Bytes of a `\u`'s fallback still to pass over.
    let mut skip_fallback = 0u32;
    // The group just opened, and whether `\*` has been seen as its first word.
    let mut fresh = false;
    let mut starred = false;
    let mut overflow = 0usize;
    let b = rtf;
    let mut at = 0;
    while at < b.len() {
        let c = b[at];
        match c {
            b'{' => {
                at += 1;
                if stack.len() < DEPTH {
                    stack.push(g);
                } else {
                    overflow += 1;
                }
                fresh = true;
                starred = false;
                skip_fallback = 0;
            }
            b'}' => {
                at += 1;
                if overflow > 0 {
                    overflow -= 1;
                } else if let Some(prev) = stack.pop() {
                    g = prev;
                }
                fresh = false;
                skip_fallback = 0;
            }
            b'\r' | b'\n' => at += 1,
            b'\\' => {
                at += 1;
                let Some(&n) = b.get(at) else { break };
                if n.is_ascii_alphabetic() {
                    let start = at;
                    while at < b.len() && b[at].is_ascii_alphabetic() && at - start < 32 {
                        at += 1;
                    }
                    let word = &b[start..at];
                    let param = number(b, &mut at);
                    if b.get(at) == Some(&b' ') {
                        at += 1;
                    }
                    let was_fresh = fresh;
                    fresh = false;
                    if was_fresh || starred {
                        // The first word of a group names its destination.
                        if starred {
                            starred = false;
                            if word == b"htmltag" {
                                g.tag = true;
                                g.skipped = false;
                            } else {
                                g.skipped = true;
                            }
                            continue;
                        }
                        if SKIPPED.contains(&word) {
                            g.skipped = true;
                            continue;
                        }
                    }
                    if g.skipped {
                        continue;
                    }
                    if word == b"htmlrtf" {
                        g.suppressed = param != Some(0);
                        continue;
                    }
                    if word == b"uc" {
                        g.uc = param.unwrap_or(1).clamp(0, 16) as u32;
                        continue;
                    }
                    if word == b"u" {
                        if let Some(p) = param {
                            if !g.suppressed || g.tag {
                                let unit = if p < 0 { p + 65_536 } else { p } as u32;
                                out.char(char::from_u32(unit).unwrap_or('\u{FFFD}'));
                            }
                            skip_fallback = g.uc;
                        }
                        continue;
                    }
                    if g.suppressed && !g.tag {
                        continue;
                    }
                    let said = match word {
                        b"par" | b"line" => Some("\r\n"),
                        b"tab" => Some("\t"),
                        b"lquote" => Some("\u{2018}"),
                        b"rquote" => Some("\u{2019}"),
                        b"ldblquote" => Some("\u{201C}"),
                        b"rdblquote" => Some("\u{201D}"),
                        b"bullet" => Some("\u{2022}"),
                        b"endash" => Some("\u{2013}"),
                        b"emdash" => Some("\u{2014}"),
                        _ => None,
                    };
                    if let Some(s) = said {
                        out.flush();
                        out.text.push_str(s);
                    }
                    continue;
                }
                at += 1;
                match n {
                    b'*' => {
                        if fresh {
                            starred = true;
                        }
                        fresh = false;
                    }
                    b'\'' => {
                        let hex = b.get(at..at + 2).and_then(|h| std::str::from_utf8(h).ok());
                        let v = hex.and_then(|h| u8::from_str_radix(h, 16).ok());
                        if v.is_some() {
                            at += 2;
                        }
                        fresh = false;
                        if skip_fallback > 0 {
                            skip_fallback -= 1;
                            continue;
                        }
                        if let Some(v) = v {
                            if !g.skipped && (!g.suppressed || g.tag) {
                                out.byte(v);
                            }
                        }
                    }
                    b'\\' | b'{' | b'}' => {
                        fresh = false;
                        if !g.skipped && (!g.suppressed || g.tag) {
                            out.byte(n);
                        }
                    }
                    b'~' => {
                        fresh = false;
                        if !g.skipped && (!g.suppressed || g.tag) {
                            out.char('\u{A0}');
                        }
                    }
                    b'_' => {
                        fresh = false;
                        if !g.skipped && (!g.suppressed || g.tag) {
                            out.byte(b'-');
                        }
                    }
                    b'\r' | b'\n' => {
                        fresh = false;
                        if !g.skipped && (!g.suppressed || g.tag) {
                            out.flush();
                            out.text.push_str("\r\n");
                        }
                    }
                    _ => fresh = false,
                }
            }
            _ => {
                at += 1;
                fresh = false;
                if skip_fallback > 0 {
                    skip_fallback -= 1;
                    continue;
                }
                if !g.skipped && (!g.suppressed || g.tag) {
                    out.byte(c);
                }
            }
        }
    }
    out.flush();
    out.text
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WRAPPED: &[u8] = b"{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\fbidis \\deff0{\\fonttbl\r\n{\\f0\\fswiss Arial;}}\r\n{\\colortbl\\red0\\green0\\blue0;}\r\n\\uc1\\pard\\plain\\deftab360 \\ql \\htmlrtf0 \r\n{\\*\\htmltag19 <html>}\r\n{\\*\\htmltag34 <head>}{\\*\\htmltag161 <style>p\\{margin:0\\}</style>}{\\*\\htmltag41 </head>}\r\n{\\*\\htmltag50 <body>}\\htmlrtf {\\htmlrtf0 \r\n{\\*\\htmltag64 <p>}\\htmlrtf {\\htmlrtf0 Caf\\'e9 \\u8364?5 \r\n{\\*\\htmltag244 &amp;}\\htmlrtf &\\htmlrtf0  tide\r\n{\\*\\mhtmltag84 <img src=\"cid:x\">}\\htmlrtf\\par\\htmlrtf0\r\n{\\*\\htmltag72 </p>}\\htmlrtf }\\htmlrtf0 \\htmlrtf }\\htmlrtf0 \r\n{\\*\\htmltag58 </body>}{\\*\\htmltag27 </html>}}";

    #[test]
    fn wrapped_html_comes_back_out() {
        assert_eq!(wraps(WRAPPED), Some(Wrapped::Html));
        let html = unwrap(WRAPPED, encoding_rs::WINDOWS_1252);
        assert_eq!(
            html,
            "<html><head><style>p{margin:0}</style></head><body><p>Café €5 &amp; tide</p></body></html>"
        );
    }

    #[test]
    fn wrapped_text_and_rtf_that_wraps_nothing() {
        let text = b"{\\rtf1\\ansi\\ansicpg1251\\fromtext \\deff0{\\fonttbl{\\f0 Courier;}}\\pard \\'cf\\'f0\\'e8\\'eb\\'e8\\'e2\\par line two\\par}";
        assert_eq!(wraps(text), Some(Wrapped::Text));
        assert_eq!(
            unwrap(text, encoding_rs::WINDOWS_1252),
            "Прилив\r\nline two\r\n"
        );
        assert_eq!(wraps(b"{\\rtf1\\ansi Hello}"), None);
        assert_eq!(wraps(b"plain"), None);
    }

    #[test]
    fn hostile_rtf_ends_without_a_panic() {
        let deep = [
            b"{\\rtf1\\fromhtml1 ".to_vec(),
            vec![b'{'; 50_000],
            b"x".to_vec(),
            vec![b'}'; 60_000],
        ]
        .concat();
        assert_eq!(unwrap(&deep, encoding_rs::WINDOWS_1252), "x");
        for s in [
            &b"{\\rtf1\\fromhtml1 \\"[..],
            b"\\'",
            b"\\'z",
            b"\\u",
            b"\\u-",
            b"}}}}",
            b"\\uc99999999999 \\u65",
        ] {
            let _ = unwrap(s, encoding_rs::WINDOWS_1252);
        }
        assert_eq!(unwrap(b"\\u-4064?", encoding_rs::WINDOWS_1252), "\u{F020}");
    }
}
