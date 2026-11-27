//! Windows' `HTML Format` (CF_HTML): an ASCII header of `Key:Value` lines whose byte offsets locate
//! UTF-8 HTML in the same buffer. Any app can put one on the clipboard, so every offset is checked
//! against the buffer before it is used, and a header that does not hold together reads as no HTML.

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// The header never runs this long; a buffer with no HTML in its first bytes is not CF_HTML.
pub const HEADER_MAX: usize = 4096;

#[derive(Debug, PartialEq, Eq)]
pub enum CfHtmlError {
    /// Neither `StartHTML`/`EndHTML` nor `StartFragment`/`EndFragment` is present and in range.
    NoRange,
}

/// The HTML a CF_HTML buffer carries: `StartHTML`..`EndHTML` when that range is valid, since it keeps
/// the parents a fragment was cut from (Excel's fragment is bare `<tr>` rows, its `<table>` outside),
/// else `StartFragment`..`EndFragment`. A leading byte-order mark is dropped; other bytes are returned
/// as they are, UTF-8 or not, for the caller to accept or refuse.
pub fn parse(buf: &[u8]) -> Result<&[u8], CfHtmlError> {
    let header = header_fields(buf);
    let range = |start: &str, end: &str| -> Option<&[u8]> {
        let s = header.iter().find(|(k, _)| *k == start)?.1?;
        let e = header.iter().find(|(k, _)| *k == end)?.1?;
        (s <= e && e <= buf.len()).then(|| &buf[s..e])
    };
    let html = range("StartHTML", "EndHTML")
        .or_else(|| range("StartFragment", "EndFragment"))
        .ok_or(CfHtmlError::NoRange)?;
    Ok(html.strip_prefix(BOM).unwrap_or(html))
}

/// The header's fields, in order, up to the first line that is not `Key:Value` ASCII. A value that is
/// not a non-negative decimal number is `None` (`StartHTML:-1` says there is no such range).
fn header_fields(buf: &[u8]) -> Vec<(&str, Option<usize>)> {
    let head = &buf[..buf.len().min(HEADER_MAX)];
    let mut fields = Vec::new();
    for line in head.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let Ok(line) = std::str::from_utf8(line) else {
            break;
        };
        if line.starts_with('<') || !line.is_ascii() {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            break;
        };
        let value = value.trim();
        let number = (!value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()))
            .then(|| value.parse::<usize>().ok())
            .flatten();
        fields.push((key.trim(), number));
    }
    fields
}

/// The width every offset is written at, so the header's length does not depend on the numbers in it.
const DIGITS: usize = 10;

/// `html` as CF_HTML: a version 0.9 header whose offsets are byte-exact, the fragment wrapped in a body
/// and marked with the `StartFragment`/`EndFragment` comments that readers look for.
pub fn build(html: &str) -> Vec<u8> {
    const PREFIX: &str = "<html><body>\r\n<!--StartFragment-->";
    const SUFFIX: &str = "<!--EndFragment-->\r\n</body></html>";
    let header_len = header(0, 0, 0, 0).len();
    let start_html = header_len;
    let start_fragment = start_html + PREFIX.len();
    let end_fragment = start_fragment + html.len();
    let end_html = end_fragment + SUFFIX.len();
    let mut out = header(start_html, end_html, start_fragment, end_fragment).into_bytes();
    debug_assert_eq!(out.len(), header_len);
    out.reserve(end_html - header_len);
    out.extend_from_slice(PREFIX.as_bytes());
    out.extend_from_slice(html.as_bytes());
    out.extend_from_slice(SUFFIX.as_bytes());
    out
}

fn header(
    start_html: usize,
    end_html: usize,
    start_fragment: usize,
    end_fragment: usize,
) -> String {
    format!(
        "Version:0.9\r\nStartHTML:{start_html:0DIGITS$}\r\nEndHTML:{end_html:0DIGITS$}\r\nStartFragment:{start_fragment:0DIGITS$}\r\nEndFragment:{end_fragment:0DIGITS$}\r\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A CF_HTML buffer the way browsers write one, with offsets computed from `before`, `fragment`
    /// and `after`.
    fn browser_style(before: &str, fragment: &[u8], after: &str) -> Vec<u8> {
        let probe = header(0, 0, 0, 0).len();
        let sh = probe;
        let sf = sh + before.len();
        let ef = sf + fragment.len();
        let eh = ef + after.len();
        let mut out = header(sh, eh, sf, ef).into_bytes();
        out.extend_from_slice(before.as_bytes());
        out.extend_from_slice(fragment);
        out.extend_from_slice(after.as_bytes());
        out
    }

    #[test]
    fn a_good_header_gives_the_whole_html() {
        let buf = browser_style(
            "<html><body>\r\n<!--StartFragment-->",
            b"<ul><li><a href=\"https://x.test/\">x</a></li></ul>",
            "<!--EndFragment-->\r\n</body></html>",
        );
        assert_eq!(
            parse(&buf).unwrap(),
            b"<html><body>\r\n<!--StartFragment--><ul><li><a href=\"https://x.test/\">x</a></li></ul><!--EndFragment-->\r\n</body></html>"
        );
    }

    #[test]
    fn real_world_header_with_source_url_and_short_numbers() {
        // Chrome writes SourceURL (which holds colons) and the numbers unpadded on some versions.
        let body = "<html><body><!--StartFragment--><b>hi</b><!--EndFragment--></body></html>";
        let head_tpl = |sh: usize, eh: usize, sf: usize, ef: usize| {
            format!("Version:0.9\r\nStartHTML:{sh}\r\nEndHTML:{eh}\r\nStartFragment:{sf}\r\nEndFragment:{ef}\r\nSourceURL:https://example.test/a?b=c\r\n")
        };
        // The header's own length depends on the numbers; settle it by iterating.
        let mut len = head_tpl(0, 0, 0, 0).len();
        loop {
            let sf = len + body.find("<b>").unwrap();
            let ef = len + body.find("<!--EndF").unwrap();
            let h = head_tpl(len, len + body.len(), sf, ef);
            if h.len() == len {
                let buf = [h.as_bytes(), body.as_bytes(), b"\0"].concat();
                assert_eq!(parse(&buf).unwrap(), body.as_bytes());
                return;
            }
            len = h.len();
        }
    }

    #[test]
    fn whole_range_missing_or_minus_one_falls_back_to_the_fragment() {
        let tail = "<html><body><!--StartFragment--><i>f</i><!--EndFragment--></body></html>";
        for start_html in ["-1", "", "abc"] {
            let head = |sf: usize, ef: usize| {
                format!("Version:1.0\r\nStartHTML:{start_html}\r\nEndHTML:-1\r\nStartFragment:{sf:010}\r\nEndFragment:{ef:010}\r\n")
            };
            let n = head(0, 0).len();
            let sf = n + tail.find("<i>").unwrap();
            let ef = n + tail.find("<!--EndF").unwrap();
            let buf = [head(sf, ef).as_bytes(), tail.as_bytes()].concat();
            assert_eq!(parse(&buf).unwrap(), b"<i>f</i>", "StartHTML:{start_html}");
        }
        // No StartHTML line at all.
        let head = "StartFragment:0000000040\r\nEndFragment:0000000048\r\n";
        assert_eq!(head.len(), 50);
        let buf = format!("{head}<i>abcd</i>");
        assert_eq!(parse(buf.as_bytes()).unwrap(), &buf.as_bytes()[40..48]);
    }

    #[test]
    fn offsets_out_of_range_are_refused() {
        let buf = b"Version:0.9\r\nStartHTML:0000000097\r\nEndHTML:0000099999\r\nStartFragment:0000000097\r\nEndFragment:0000099999\r\n<b>x</b>";
        assert_eq!(parse(buf), Err(CfHtmlError::NoRange));
        // Start after end.
        let buf = b"Version:0.9\r\nStartHTML:0000000100\r\nEndHTML:0000000090\r\nStartFragment:0000000100\r\nEndFragment:0000000090\r\n<b>x</b>";
        assert_eq!(parse(buf), Err(CfHtmlError::NoRange));
        // A number too large for usize, or one with a sign.
        let buf = b"StartHTML:99999999999999999999999999\r\nEndHTML:+5\r\n<b>x</b>";
        assert_eq!(parse(buf), Err(CfHtmlError::NoRange));
        // A bad whole range with a good fragment still reads the fragment.
        let head = |sf: usize, ef: usize| {
            format!("StartHTML:0000000000\r\nEndHTML:0000099999\r\nStartFragment:{sf:010}\r\nEndFragment:{ef:010}\r\n")
        };
        let n = head(0, 0).len();
        let buf = format!("{}<i>ok</i>", head(n, n + "<i>ok</i>".len()));
        assert_eq!(parse(buf.as_bytes()).unwrap(), b"<i>ok</i>");
    }

    #[test]
    fn missing_fields_are_refused() {
        assert_eq!(parse(b""), Err(CfHtmlError::NoRange));
        assert_eq!(parse(b"<b>no header</b>"), Err(CfHtmlError::NoRange));
        assert_eq!(
            parse(b"Version:0.9\r\nStartHTML:0000000010\r\n<b>x</b>"),
            Err(CfHtmlError::NoRange),
            "an end is required"
        );
        assert_eq!(
            parse(b"Version:0.9\r\nEndFragment:0000000010\r\n<b>x</b>"),
            Err(CfHtmlError::NoRange),
            "a start is required"
        );
    }

    #[test]
    fn the_header_ends_at_the_html_so_markup_cannot_add_fields() {
        // A `StartHTML:` written inside the HTML is not a header line.
        let head = "Version:0.9\r\n";
        let buf = format!("{head}<p>\nStartHTML:0\nEndHTML:5\n</p>");
        assert_eq!(parse(buf.as_bytes()), Err(CfHtmlError::NoRange));
    }

    #[test]
    fn a_fragment_with_a_bom_loses_only_the_bom() {
        let mut frag = BOM.to_vec();
        frag.extend_from_slice("<p>é</p>".as_bytes());
        let probe = header(0, 0, 0, 0).len();
        let mut buf = header(probe, probe + frag.len(), probe, probe + frag.len()).into_bytes();
        buf.extend_from_slice(&frag);
        assert_eq!(parse(&buf).unwrap(), "<p>é</p>".as_bytes());
    }

    #[test]
    fn non_utf8_bytes_pass_through_for_the_caller_to_refuse() {
        let buf = browser_style("<html><body>", b"<p>caf\xe9</p>", "</body></html>");
        let html = parse(&buf).unwrap();
        assert_eq!(html, b"<html><body><p>caf\xe9</p></body></html>");
        assert!(std::str::from_utf8(html).is_err());
        // Non-UTF-8 in the header ends it: nothing after it is read as a field.
        assert_eq!(
            parse(b"Version:0.9\r\n\xff\r\nStartHTML:0000000000\r\nEndHTML:0000000004\r\n"),
            Err(CfHtmlError::NoRange)
        );
    }

    #[test]
    fn a_trailing_nul_is_outside_the_range() {
        let mut buf = browser_style("<html><body>", b"<b>x</b>", "</body></html>");
        buf.extend_from_slice(b"\0\0\0");
        assert_eq!(parse(&buf).unwrap(), b"<html><body><b>x</b></body></html>");
    }

    #[test]
    fn build_writes_byte_exact_offsets() {
        for html in [
            "",
            "<b>x</b>",
            "<p>é — 漢字 🙂</p>",
            "<!--EndFragment--> inside",
        ] {
            let buf = build(html);
            let fields = header_fields(&buf);
            let get = |k: &str| fields.iter().find(|(f, _)| *f == k).unwrap().1.unwrap();
            let (sh, eh, sf, ef) = (
                get("StartHTML"),
                get("EndHTML"),
                get("StartFragment"),
                get("EndFragment"),
            );
            assert_eq!(&buf[sf..ef], html.as_bytes(), "{html}");
            assert_eq!(eh, buf.len());
            assert!(buf[..sh].starts_with(b"Version:0.9\r\n"));
            assert!(buf[sh..].starts_with(b"<html>"));
            assert!(buf[..sf].ends_with(b"<!--StartFragment-->"));
            assert!(buf[ef..].starts_with(b"<!--EndFragment-->"));
            assert!(buf.ends_with(b"</html>"));
            assert_eq!(parse(&buf).unwrap(), &buf[sh..eh]);
        }
    }

    #[test]
    fn build_header_is_fixed_width() {
        let a = build("x");
        let b = build(&"y".repeat(123_456));
        let head = |buf: &[u8]| buf.iter().position(|&c| c == b'<').unwrap();
        assert_eq!(head(&a), head(&b));
        assert_eq!(head(&a), header(0, 0, 0, 0).len());
    }
}
