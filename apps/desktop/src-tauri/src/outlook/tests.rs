//! Outlook messages made here with the cfb crate's writer, shaped as Outlook saves them (MS-OXMSG): no file of anyone's
//! is in the tests, and the demo's message is made by the same builder.

use std::io::{Cursor, Write};

use super::*;

/// A message, a recipient or an attachment: its properties, and what hangs under it.
#[derive(Default, Clone)]
pub struct Obj {
    pub unicode: Vec<(u16, String)>,
    pub eight: Vec<(u16, Vec<u8>)>,
    pub binary: Vec<(u16, Vec<u8>)>,
    pub long: Vec<(u16, u32)>,
    pub time: Vec<(u16, u64)>,
    pub recipients: Vec<Obj>,
    pub attachments: Vec<Obj>,
    /// An attachment's message (method 5).
    pub message: Option<Box<Obj>>,
}

impl Obj {
    pub fn s(mut self, id: u16, v: &str) -> Self {
        self.unicode.push((id, v.into()));
        self
    }
    pub fn s8(mut self, id: u16, v: &[u8]) -> Self {
        self.eight.push((id, v.into()));
        self
    }
    pub fn b(mut self, id: u16, v: &[u8]) -> Self {
        self.binary.push((id, v.into()));
        self
    }
    pub fn l(mut self, id: u16, v: u32) -> Self {
        self.long.push((id, v));
        self
    }
    pub fn t(mut self, id: u16, v: u64) -> Self {
        self.time.push((id, v));
        self
    }
    pub fn to(mut self, kind: u32, name: &str, smtp: &str) -> Self {
        self.recipients.push(
            Obj::default()
                .l(id::RECIPIENT_TYPE, kind)
                .s(id::DISPLAY_NAME, name)
                .s(id::SMTP_ADDRESS, smtp)
                .s(id::ADDRTYPE, "SMTP")
                .s(id::EMAIL_ADDRESS, smtp),
        );
        self
    }
    pub fn file(mut self, name: &str, mime: &str, bytes: &[u8]) -> Self {
        self.attachments.push(
            Obj::default()
                .l(id::ATTACH_METHOD, 1)
                .s(id::ATTACH_LONG_FILENAME, name)
                .s(id::ATTACH_MIME_TAG, mime)
                .b(id::ATTACH_DATA, bytes),
        );
        self
    }
    pub fn attach(mut self, name: &str, inner: Obj) -> Self {
        let mut a = Obj::default()
            .l(id::ATTACH_METHOD, 5)
            .s(id::DISPLAY_NAME, name);
        a.message = Some(Box::new(inner));
        self.attachments.push(a);
        self
    }
}

/// A FILETIME for a UTC time given in seconds since 1970.
pub fn filetime(unix: u64) -> u64 {
    (unix + 11_644_473_600) * 10_000_000
}

/// 2 November 2026, 08:14:09 UTC.
pub const SENT: u64 = 1_793_607_249;

fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

type W = cfb::CompoundFile<Cursor<Vec<u8>>>;

fn put(cf: &mut W, path: &str, bytes: &[u8]) {
    cf.create_stream(path).unwrap().write_all(bytes).unwrap();
}

fn write_obj(cf: &mut W, base: &str, o: &Obj, head: usize) {
    let mut props = vec![0u8; head];
    if head >= 24 {
        props[8..12].copy_from_slice(&(o.recipients.len() as u32).to_le_bytes());
        props[12..16].copy_from_slice(&(o.attachments.len() as u32).to_le_bytes());
        props[16..20].copy_from_slice(&(o.recipients.len() as u32).to_le_bytes());
        props[20..24].copy_from_slice(&(o.attachments.len() as u32).to_le_bytes());
    }
    let mut entry = |tag: u32, value: [u8; 8]| {
        props.extend_from_slice(&tag.to_le_bytes());
        props.extend_from_slice(&6u32.to_le_bytes());
        props.extend_from_slice(&value);
    };
    let sized = |n: usize| {
        let mut v = [0u8; 8];
        v[..4].copy_from_slice(&(n as u32).to_le_bytes());
        v
    };
    for (i, v) in &o.long {
        let mut b = [0u8; 8];
        b[..4].copy_from_slice(&v.to_le_bytes());
        entry(((*i as u32) << 16) | 0x0003, b);
    }
    for (i, v) in &o.time {
        entry(((*i as u32) << 16) | 0x0040, v.to_le_bytes());
    }
    for (i, v) in &o.unicode {
        entry(((*i as u32) << 16) | 0x001F, sized(v.len() * 2 + 2));
    }
    for (i, v) in &o.eight {
        entry(((*i as u32) << 16) | 0x001E, sized(v.len() + 1));
    }
    for (i, v) in &o.binary {
        entry(((*i as u32) << 16) | 0x0102, sized(v.len()));
    }
    if o.message.is_some() {
        entry(((id::ATTACH_DATA as u32) << 16) | 0x000D, [0xff; 8]);
    }
    put(cf, &format!("{base}/__properties_version1.0"), &props);
    for (i, v) in &o.unicode {
        put(cf, &format!("{base}/__substg1.0_{i:04X}001F"), &utf16le(v));
    }
    for (i, v) in &o.eight {
        put(cf, &format!("{base}/__substg1.0_{i:04X}001E"), v);
    }
    for (i, v) in &o.binary {
        put(cf, &format!("{base}/__substg1.0_{i:04X}0102"), v);
    }
    for (n, r) in o.recipients.iter().enumerate() {
        let at = format!("{base}/__recip_version1.0_#{n:08X}");
        cf.create_storage(&at).unwrap();
        write_obj(cf, &at, r, 8);
    }
    for (n, a) in o.attachments.iter().enumerate() {
        let at = format!("{base}/__attach_version1.0_#{n:08X}");
        cf.create_storage(&at).unwrap();
        write_obj(cf, &at, a, 8);
        if let Some(m) = &a.message {
            let inner = format!("{at}/__substg1.0_3701000D");
            cf.create_storage(&inner).unwrap();
            write_obj(cf, &inner, m, 24);
        }
    }
}

/// `o` as an Outlook message's bytes, every entry's times fixed so the same message is the same bytes.
pub fn build(o: &Obj) -> Vec<u8> {
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    cf.create_storage("/__nameid_version1.0").unwrap();
    write_obj(&mut cf, "", o, 32);
    let fixed = std::time::UNIX_EPOCH + std::time::Duration::from_secs(SENT);
    let storages: Vec<String> = cf
        .walk()
        .filter(|e| e.is_storage())
        .map(|e| e.path().to_string_lossy().replace('\\', "/"))
        .collect();
    for s in storages {
        let _ = cf.set_created_time(&s, fixed);
        let _ = cf.set_modified_time(&s, fixed);
    }
    cf.flush().unwrap();
    cf.into_inner().into_inner()
}

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// The message's base64 bodies, decoded, each with the Content-Type above it: enough of MIME to check what was written.
fn bodies(mime: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(mime).into_owned();
    let mut out = Vec::new();
    let mut ty = String::new();
    let mut lines = text.split("\r\n");
    while let Some(line) = lines.next() {
        if let Some(t) = line.strip_prefix("Content-Type: ") {
            ty = t.to_string();
        }
        if line == "Content-Transfer-Encoding: base64" {
            lines.next();
            let mut acc = 0u32;
            let mut bits = 0;
            let mut bytes = Vec::new();
            for l in lines.by_ref() {
                if l.is_empty() || l.starts_with("--") {
                    break;
                }
                for c in l.bytes() {
                    let Some(v) = BASE64.iter().position(|&b| b == c) else {
                        continue;
                    };
                    acc = (acc << 6) | v as u32;
                    bits += 6;
                    if bits >= 8 {
                        bits -= 8;
                        bytes.push((acc >> bits) as u8);
                    }
                }
            }
            out.push((ty.clone(), String::from_utf8_lossy(&bytes).into_owned()));
        }
    }
    out
}

fn read_ok(o: &Obj) -> (String, Facts) {
    let c = read(&build(o), &Limits::DEFAULT).unwrap();
    (String::from_utf8(c.mime).unwrap(), c.facts)
}

fn letter() -> Obj {
    Obj::default()
        .s(id::MESSAGE_CLASS, "IPM.Note")
        .s(id::SUBJECT, "Low water walk — 14 November")
        .s(id::SENT_REPRESENTING_NAME, "Harbour Office")
        .s(id::SENT_REPRESENTING_ADDRTYPE, "EX")
        .s(
            id::SENT_REPRESENTING_EMAIL,
            "/O=HARBOUR/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=OFFICE",
        )
        .s(id::SENDER_SMTP, "office@harbour.example")
        .s(id::SENDER_NAME, "Harbour Office")
        .t(id::CLIENT_SUBMIT_TIME, filetime(SENT))
        .t(id::DELIVERY_TIME, filetime(SENT + 75))
        .s(id::MESSAGE_ID, "<walk-14@harbour.example>")
        .l(id::INTERNET_CPID, 1252)
        .to(1, "Reader Lab", "lab@reader.example")
        .to(2, "Notices", "notices@harbour.example")
        .to(3, "Archive", "archive@harbour.example")
        .s(id::BODY, "The walk starts at the slipway.\r\n")
}

#[test]
fn a_unicode_message_reads_as_its_headers_and_its_html() {
    let o = letter().b(
        id::HTML,
        b"<html><body><p>The walk starts at the slipway, caf\xe9 at noon.</p></body></html>",
    );
    let (mime, facts) = read_ok(&o);
    assert!(
        mime.contains("Date: Mon, 02 Nov 2026 08:14:09 +0000\r\n"),
        "{mime}"
    );
    // The SMTP address stands in for the Exchange directory name.
    assert!(mime.contains("From: \"Harbour Office\" <office@harbour.example>\r\n"));
    assert!(!mime.contains("\r\nSender:"));
    assert!(mime.contains("To: \"Reader Lab\" <lab@reader.example>\r\n"));
    assert!(mime.contains("Cc: \"Notices\" <notices@harbour.example>\r\n"));
    assert!(mime.contains("Bcc: \"Archive\" <archive@harbour.example>\r\n"));
    assert!(mime.contains("Subject: =?utf-8?B?"));
    assert!(mime.contains("Message-ID: <walk-14@harbour.example>\r\n"));
    assert!(mime.contains("multipart/alternative"));
    let b = bodies(mime.as_bytes());
    assert_eq!(b[0].1, "The walk starts at the slipway.\r\n");
    assert!(b[1].0.starts_with("text/html"));
    assert!(b[1].1.contains("café at noon"));
    assert_eq!(
        facts,
        Facts {
            class: "IPM.Note".into(),
            body: "html",
            code_page: Some(1252),
            received: Some("Mon, 02 Nov 2026 08:15:24 +0000".into()),
            transport: false,
            recipients: 3,
            attachments: 0,
            notes: vec![],
        }
    );
}

#[test]
fn an_eight_bit_message_reads_in_its_code_page() {
    let o = Obj::default()
        .l(id::MESSAGE_CODEPAGE, 1251)
        .s8(id::SUBJECT, b"\xcf\xf0\xe8\xeb\xe8\xe2")
        .s8(id::SENDER_NAME, b"\xc3\xe0\xe2\xe0\xed\xfc")
        .s8(id::SENDER_EMAIL, b"port@harbour.example")
        .s8(id::SENDER_ADDRTYPE, b"SMTP")
        .s8(id::BODY, b"\xcf\xf0\xe8\xeb\xe8\xe2 \xe2 08:14\r\n");
    let (mime, facts) = read_ok(&o);
    assert_eq!(facts.code_page, Some(1251));
    assert_eq!(facts.body, "text");
    assert!(mime.contains(&format!("Subject: {}\r\n", mime::words("Прилив"))));
    assert!(mime.contains(&format!(
        "From: {} <port@harbour.example>\r\n",
        mime::words("Гавань")
    )));
    assert_eq!(bodies(mime.as_bytes())[0].1, "Прилив в 08:14\r\n");
}

const WRAPPED: &[u8] = b"{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\deff0{\\fonttbl{\\f0\\fswiss Arial;}}\\htmlrtf0 {\\*\\htmltag19 <html>}{\\*\\htmltag50 <body>}{\\*\\htmltag64 <p>}\\htmlrtf {\\htmlrtf0 Gauge 4 reads 2.1\\'a0m{\\*\\htmltag84 <img src=\"cid:chart@harbour\">}\\htmlrtf\\par\\htmlrtf0 {\\*\\htmltag72 </p>}\\htmlrtf }\\htmlrtf0 {\\*\\htmltag58 </body>}{\\*\\htmltag27 </html>}}";

#[test]
fn html_wrapped_in_rtf_comes_out_with_its_pictures_inline() {
    let o = letter()
        .b(id::RTF_COMPRESSED, &lzfu::pack_literal(WRAPPED))
        .file(
            "tide-table.csv",
            "text/csv",
            b"time,height\r\n08:14,0.4\r\n",
        );
    let mut chart = Obj::default()
        .l(id::ATTACH_METHOD, 1)
        .s(id::ATTACH_FILENAME, "chart.png")
        .s(id::ATTACH_CONTENT_ID, "chart@harbour")
        .b(id::ATTACH_DATA, b"\x89PNG\r\n\x1a\n");
    chart.long.push((0x3714, 4));
    let mut o = o;
    o.attachments.push(chart);
    let (mime, facts) = read_ok(&o);
    assert_eq!(facts.body, "rtf-html");
    assert_eq!(
        facts.attachments, 1,
        "the picture the HTML draws is not listed"
    );
    let b = bodies(mime.as_bytes());
    let html = b.iter().find(|(t, _)| t.starts_with("text/html")).unwrap();
    assert_eq!(
        html.1,
        "<html><body><p>Gauge 4 reads 2.1\u{a0}m<img src=\"cid:chart@harbour\"></p></body></html>"
    );
    assert!(mime.contains("multipart/related"));
    assert!(mime.contains("Content-ID: <chart@harbour>\r\n"));
    assert!(mime.contains("Content-Disposition: inline; filename=\"chart.png\"\r\n"));
    assert!(mime.contains("Content-Disposition: attachment; filename=\"tide-table.csv\"\r\n"));
    assert_eq!(
        b.iter().find(|(t, _)| t.starts_with("text/csv")).unwrap().1,
        "time,height\r\n08:14,0.4\r\n"
    );
}

#[test]
fn rtf_that_wraps_no_html_or_fails_its_check_leaves_the_plain_text() {
    let plain = letter().b(
        id::RTF_COMPRESSED,
        &lzfu::pack_literal(b"{\\rtf1\\ansi Hi}"),
    );
    let (_, facts) = read_ok(&plain);
    assert_eq!(facts.body, "text");
    let mut packed = lzfu::pack_literal(WRAPPED);
    let last = packed.len() - 5;
    packed[last] ^= 0x20;
    let (mime, facts) = read_ok(&letter().b(id::RTF_COMPRESSED, &packed));
    assert_eq!(facts.body, "text");
    assert_eq!(
        facts.notes,
        vec![
            "Its compressed RTF body does not match its check (CRC): the body is not read from it."
        ]
    );
    assert!(!mime.contains("text/html"));
}

#[test]
fn an_attached_message_is_a_message_inside_this_one() {
    let inner = Obj::default()
        .s(id::SUBJECT, "Gauge readings")
        .s(id::SENDER_NAME, "Gauge Desk")
        .s(id::SENDER_SMTP, "gauges@harbour.example")
        .s(id::BODY, "Gauge 4 reads 2.1 m.\r\n")
        .file("readings.csv", "text/csv", b"g,m\r\n4,2.1\r\n");
    let (mime, facts) = read_ok(&letter().attach("Gauge readings", inner));
    assert_eq!(facts.attachments, 1);
    assert!(mime.contains(
        "Content-Type: message/rfc822; name=\"Gauge readings.eml\"\r\nContent-Disposition: attachment; filename=\"Gauge readings.eml\"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
    ), "{mime}");
    assert!(mime.contains("\r\nSubject: Gauge readings\r\n"));
    assert!(mime.contains("From: \"Gauge Desk\" <gauges@harbour.example>"));
    assert!(bodies(mime.as_bytes())
        .iter()
        .any(|(_, b)| b == "g,m\r\n4,2.1\r\n"));
}

#[test]
fn messages_attached_past_eight_levels_are_left_out_and_said() {
    let mut o = Obj::default().s(id::SUBJECT, "level 9").s(id::BODY, "deep");
    for n in (0..9).rev() {
        o = Obj::default()
            .s(id::SUBJECT, &format!("level {n}"))
            .attach(&format!("level {}", n + 1), o);
    }
    let (mime, facts) = read_ok(&o);
    assert!(mime.contains("Subject: level 8"));
    assert!(!mime.contains("Subject: level 9"));
    assert_eq!(facts.notes.len(), 1);
    assert!(
        facts.notes[0].ends_with(
            "level 9 is a message attached 9 levels deep, past the 8 read, and is left out."
        ),
        "{:?}",
        facts.notes
    );
}

#[test]
fn the_headers_it_travelled_with_are_kept_and_the_body_ones_replaced() {
    let o = letter().s(
        id::TRANSPORT_HEADERS,
        "Received: from mx.harbour.example\r\n\tby mx.reader.example; Mon, 2 Nov 2026 08:14:30 +0000\r\nFrom: Harbour Office <office@harbour.example>\r\nTo: lab@reader.example\r\nSubject: Low water walk\r\nContent-Type: multipart/alternative;\r\n\tboundary=\"b1\"\r\nMIME-Version: 1.0\r\nnot a header\r\n\r\n--b1\r\n",
    );
    let (mime, facts) = read_ok(&o);
    assert!(facts.transport);
    let head = &mime[..mime.find("\r\n\r\n").unwrap()];
    assert!(head.starts_with("Received: from mx.harbour.example\r\n\tby mx.reader.example;"));
    assert!(head.contains("\r\nSubject: Low water walk\r\n"));
    assert_eq!(head.matches("Subject:").count(), 1);
    assert_eq!(head.matches("From:").count(), 1);
    assert!(head.contains("Bcc: \"Archive\" <archive@harbour.example>"));
    assert!(head.contains("Date: Mon, 02 Nov 2026"));
    assert!(!head.contains("b1"));
    assert!(!head.contains("not a header"));
    assert_eq!(head.matches("MIME-Version").count(), 1);
}

#[test]
fn a_property_cannot_start_a_header_or_a_part() {
    let o = Obj::default()
        .s(id::SUBJECT, "hi\r\nBcc: someone@else.example\r\n\r\n--x")
        .s(id::SENDER_NAME, "A\"B\r\nX-Bad: 1")
        .s(id::SENDER_SMTP, "a@b.example>\r\nX-Bad: 2")
        .file("a\"b\r\n.txt", "text/plain\r\nX-Bad: 3", b"x");
    let (mime, _) = read_ok(&o);
    assert!(!mime.contains("\r\nBcc:"));
    assert!(!mime.contains("\r\nX-Bad"));
    assert!(
        mime.contains("Content-Type: text/plain; name*=utf-8''a%22b%20%20.txt"),
        "{mime}"
    );
}

#[test]
fn caps_on_recipients_attachments_and_the_message_say_what_they_cut() {
    let mut o = letter();
    for n in 0..5 {
        o = o.to(1, &format!("R{n}"), &format!("r{n}@x.example")).file(
            &format!("{n}.txt"),
            "text/plain",
            b"x",
        );
    }
    let small = Limits {
        recipients: 4,
        attachments: 2,
        ..Limits::DEFAULT
    };
    let c = read(&build(&o), &small).unwrap();
    assert_eq!(c.facts.recipients, 4);
    assert_eq!(c.facts.attachments, 2);
    assert_eq!(
        c.facts.notes,
        vec![
            "Only the first 4 recipients are read.",
            "Only the first 2 attachments are read."
        ]
    );
    let tiny = Limits {
        message: 100,
        ..Limits::DEFAULT
    };
    assert!(
        matches!(read(&build(&o), &tiny), Err(Fault::TooBig(m)) if m == "The message is 1 MB, past the 0 MB read as a message.")
    );
    let stream = Limits {
        stream: 50,
        ..Limits::DEFAULT
    };
    let c = read(&build(&letter().file("big.bin", "", &[7; 100])), &stream).unwrap();
    assert!(
        c.facts.notes.contains(
            &"big.bin is 1 MB, past the 1 MB a part is read with, and is left out.".to_string()
        ),
        "{:?}",
        c.facts.notes
    );
}

#[test]
fn what_is_no_message_or_a_damaged_one_says_so() {
    assert_eq!(
        read(b"From: a@b\r\n\r\nhi", &Limits::DEFAULT)
            .err()
            .unwrap()
            .say(),
        "Its bytes are not an Outlook message: it does not start as a compound file does."
    );
    let mut bare = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    put(&mut bare, "/Workbook", b"x");
    bare.flush().unwrap();
    assert_eq!(
        read(&bare.into_inner().into_inner(), &Limits::DEFAULT)
            .err()
            .unwrap()
            .say(),
        "It is a compound file, but not an Outlook message: it holds no message properties."
    );
    let good = build(&letter().file("a.txt", "text/plain", b"x"));
    assert_eq!(
        read(&good[..600], &Limits::DEFAULT).err(),
        Some(Fault::Damaged)
    );
    assert_eq!(
        Fault::Damaged.say(),
        "The message could not be read: the file is damaged."
    );
}

#[test]
fn damaged_bytes_anywhere_never_panic() {
    let good = build(
        &letter()
            .b(id::RTF_COMPRESSED, &lzfu::pack_literal(WRAPPED))
            .file("a.txt", "text/plain", b"x")
            .attach("inner", Obj::default().s(id::SUBJECT, "inner")),
    );
    let mut seed = 0x2545_f491u32;
    for _ in 0..1_500 {
        let mut bad = good.clone();
        for _ in 0..4 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let at = seed as usize % bad.len();
            bad[at] = (seed >> 8) as u8;
        }
        let r = std::panic::catch_unwind(|| read(&bad, &Limits::DEFAULT).map(|c| c.mime.len()));
        assert!(r.is_ok(), "a panic on damaged bytes");
    }
    assert!(commands::convert(&good[..good.len() / 2]).is_err());
}

#[test]
fn the_frame_carries_the_facts_then_the_message() {
    let f = commands::convert(&build(&letter())).unwrap();
    let n = u32::from_le_bytes([f[0], f[1], f[2], f[3]]) as usize;
    let facts: serde_json::Value = serde_json::from_slice(&f[4..4 + n]).unwrap();
    assert_eq!(facts["body"], "text");
    assert_eq!(facts["codePage"], 1252);
    assert!(f[4 + n..].starts_with(b"Date: "));
}

/// The demo's message: a reply from the harbour office with an HTML body Outlook wrapped in RTF, a table attached, and
/// the message it answers attached to it.
pub fn demo() -> Obj {
    let earlier = Obj::default()
        .s(id::MESSAGE_CLASS, "IPM.Note")
        .s(id::SUBJECT, "Gauge 4 after the storm")
        .s(id::SENDER_NAME, "Reader Lab")
        .s(id::SENDER_SMTP, "lab@reader.example")
        .t(id::CLIENT_SUBMIT_TIME, filetime(SENT - 3 * 3600))
        .to(1, "Harbour Office", "office@harbour.example")
        .s(
            id::BODY,
            "Hello,\r\n\r\nGauge 4 read high all weekend. Is it the float or the storm?\r\n\r\n-- \r\nReader Lab\r\n",
        );
    let html = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\deff0{\\fonttbl{\\f0\\fswiss Arial;}}\\htmlrtf0 \
{\\*\\htmltag19 <html>}{\\*\\htmltag34 <head>}{\\*\\htmltag161 <style>body\\{font-family:Georgia,serif;color:#1d2a33\\} h2\\{color:#0b5c7a\\} table\\{border-collapse:collapse\\} td,th\\{border:1px solid #9fb3c0;padding:4px 10px\\}</style>}{\\*\\htmltag41 </head>}\
{\\*\\htmltag50 <body>}{\\*\\htmltag64 <h2>}Gauge 4 after the storm{\\*\\htmltag72 </h2>}\
{\\*\\htmltag64 <p>}\\htmlrtf {\\htmlrtf0 It was the float. We changed it on Thursday at low water; the readings since agree with the staff gauge to within a centimetre.{\\*\\htmltag72 </p>}\\htmlrtf }\\htmlrtf0 \
{\\*\\htmltag64 <table>}{\\*\\htmltag64 <tr>}{\\*\\htmltag64 <th>}Day{\\*\\htmltag72 </th>}{\\*\\htmltag64 <th>}Low water{\\*\\htmltag72 </th>}{\\*\\htmltag64 <th>}Height{\\*\\htmltag72 </th>}{\\*\\htmltag72 </tr>}\
{\\*\\htmltag64 <tr>}{\\*\\htmltag64 <td>}Thu{\\*\\htmltag72 </td>}{\\*\\htmltag64 <td>}08:14{\\*\\htmltag72 </td>}{\\*\\htmltag64 <td>}0.4\\'a0m{\\*\\htmltag72 </td>}{\\*\\htmltag72 </tr>}\
{\\*\\htmltag64 <tr>}{\\*\\htmltag64 <td>}Fri{\\*\\htmltag72 </td>}{\\*\\htmltag64 <td>}08:51{\\*\\htmltag72 </td>}{\\*\\htmltag64 <td>}0.5\\'a0m{\\*\\htmltag72 </td>}{\\*\\htmltag72 </tr>}{\\*\\htmltag72 </table>}\
{\\*\\htmltag64 <p>}The full table is attached, with your message below it.{\\*\\htmltag72 </p>}\
{\\*\\htmltag64 <p>}Harbour Office{\\*\\htmltag116 <br>}Tidemark Harbour{\\*\\htmltag72 </p>}{\\*\\htmltag58 </body>}{\\*\\htmltag27 </html>}}";
    Obj::default()
        .s(id::MESSAGE_CLASS, "IPM.Note")
        .s(id::SUBJECT, "Re: Gauge 4 after the storm")
        .s(id::SENT_REPRESENTING_NAME, "Harbour Office")
        .s(id::SENT_REPRESENTING_SMTP, "office@harbour.example")
        .s(id::SENDER_NAME, "Harbour Office")
        .s(id::SENDER_SMTP, "office@harbour.example")
        .t(id::CLIENT_SUBMIT_TIME, filetime(SENT))
        .t(id::DELIVERY_TIME, filetime(SENT + 41))
        .s(id::MESSAGE_ID, "<gauge-4-reply@harbour.example>")
        .s(id::IN_REPLY_TO, "<gauge-4@reader.example>")
        .l(id::MESSAGE_CODEPAGE, 1252)
        .l(id::INTERNET_CPID, 1252)
        .to(1, "Reader Lab", "lab@reader.example")
        .to(2, "Tide Desk", "tides@harbour.example")
        .s(
            id::BODY,
            "Gauge 4 after the storm\r\n\r\nIt was the float. We changed it on Thursday at low water; the readings since agree with the staff gauge to within a centimetre.\r\n\r\nDay  Low water  Height\r\nThu  08:14      0.4 m\r\nFri  08:51      0.5 m\r\n\r\nThe full table is attached, with your message below it.\r\n\r\nHarbour Office\r\nTidemark Harbour\r\n",
        )
        .b(id::RTF_COMPRESSED, &lzfu::pack_literal(html.as_bytes()))
        .file(
            "low-water-november.csv",
            "text/csv",
            b"day,low water,height (m)\r\nThu,08:14,0.4\r\nFri,08:51,0.5\r\nSat,09:30,0.5\r\nSun,10:12,0.6\r\n",
        )
        .attach("Gauge 4 after the storm", earlier)
}

#[test]
fn the_demo_message_is_what_the_builder_makes() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/mail/gauge-4-reply.msg");
    let want = build(&demo());
    if std::env::var("MARXY_BLESS").is_ok_and(|v| v == "1") {
        std::fs::write(&path, &want).unwrap();
    }
    assert!(
        std::fs::read(&path).unwrap_or_default() == want,
        "{} differs from the builder: run MARXY_BLESS=1 cargo test demo_message",
        path.display()
    );
    let c = read(&want, &Limits::DEFAULT).unwrap();
    assert_eq!(c.facts.body, "rtf-html");
    assert_eq!(c.facts.attachments, 2);
    assert!(c.facts.notes.is_empty());
}

fn recipients(n: usize) -> Obj {
    let mut o = Obj::default().s(id::SUBJECT, "many");
    for k in 0..n {
        o = o.to(1, &format!("R{k}"), &format!("r{k}@x.example"));
    }
    o
}

#[test]
fn a_header_that_lists_every_boundary_costs_one_scan() {
    let mut refs = String::new();
    for k in 0..200 {
        refs.push_str(&format!("--=_marxy_1_{k} "));
    }
    let inner = Obj::default()
        .s(id::SUBJECT, "inner")
        .s(id::REFERENCES, &refs)
        .s(id::BODY, "x")
        .file("big.bin", "", &vec![7u8; 1 << 20]);
    let o = letter().attach("inner", inner);
    mime::SCANS.with(|c| c.set(0));
    let (text, _) = read_ok(&o);
    let multiparts = text.matches("Content-Type: multipart/").count();
    assert!(multiparts >= 1);
    assert!(
        mime::SCANS.with(|c| c.get()) <= 3 * multiparts + 3 * 2,
        "boundary scans grew with what the headers list"
    );
}

#[test]
fn opening_many_streams_is_charged_whatever_they_hold() {
    let o = recipients(60);
    assert!(read(&build(&o), &Limits::DEFAULT).is_ok());
    let few = Limits {
        opens: 100,
        ..Limits::DEFAULT
    };
    assert!(
        matches!(read(&build(&o), &few), Err(Fault::TooBig(m)) if m.contains("opens more than 100 streams")),
    );
    // A one-byte stream still costs a minimum of the read budget.
    let small = Limits {
        read: 40 * OPEN_CHARGE,
        ..Limits::DEFAULT
    };
    assert!(
        matches!(read(&build(&o), &small), Err(Fault::TooBig(m)) if m.contains("streams come to more")),
    );
}

#[test]
fn streams_that_declare_more_than_the_file_could_hold_are_refused() {
    let mut bytes = build(&letter().file("a.bin", "", &vec![1u8; 8192]));
    let name: Vec<u8> = "__substg1.0_37010102"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let at = bytes
        .windows(name.len())
        .position(|w| w == name.as_slice())
        .unwrap();
    bytes[at + 120..at + 124].copy_from_slice(&(1u32 << 30).to_le_bytes());
    let got = read(&bytes, &Limits::DEFAULT);
    assert!(
        matches!(&got, Err(Fault::TooBig(m)) if m.contains("declare far more bytes")),
        "{:?}",
        got.map(|c| c.facts.notes)
    );
}

#[test]
fn a_wide_directory_is_read_through_one_map_and_capped() {
    let bytes = build(&recipients(1_000));
    let c = read(&bytes, &Limits::DEFAULT).unwrap();
    assert_eq!(c.facts.recipients, 1_000);
    let few = Limits {
        entries: 500,
        ..Limits::DEFAULT
    };
    assert!(
        matches!(read(&bytes, &few), Err(Fault::TooBig(m)) if m.contains("more than 500 directory entries")),
    );
}

/// `o` as bytes with a chain of `depth` storages hung under the root, as hostile files make them.
fn nested(o: &Obj, depth: usize) -> Vec<u8> {
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    cf.create_storage("/__nameid_version1.0").unwrap();
    write_obj(&mut cf, "", o, 32);
    let mut at = String::new();
    for _ in 0..depth {
        at.push_str("/d");
        cf.create_storage(&at).unwrap();
    }
    cf.flush().unwrap();
    cf.into_inner().into_inner()
}

#[test]
fn storages_nested_thousands_deep_cost_one_step_each() {
    let bytes = nested(&letter(), 3_000);
    let layout = layout::Layout::parse(&bytes, &Limits::DEFAULT).unwrap();
    assert!(
        (3_000..3_100).contains(&layout.entries()),
        "{}",
        layout.entries()
    );
    let started = std::time::Instant::now();
    let c = read(&bytes, &Limits::DEFAULT).unwrap();
    assert_eq!(c.facts.recipients, 3);
    assert!(STEPS.with(|c| c.get()) < 10_000);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(30),
        "{:?}",
        started.elapsed()
    );
}

/// The directory entries named `name` (UTF-16 in the first bytes of an entry), their start sector and size set.
fn point_at(bytes: &mut [u8], name: &str, start: u32, size: u32) -> usize {
    let key: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut hit = 0;
    for at in (0..bytes.len().saturating_sub(128)).step_by(128) {
        if bytes[at..].starts_with(&key) && bytes[at + key.len()..at + key.len() + 2] == [0, 0] {
            bytes[at + 116..at + 120].copy_from_slice(&start.to_le_bytes());
            bytes[at + 120..at + 124].copy_from_slice(&size.to_le_bytes());
            hit += 1;
        }
    }
    hit
}

fn start_of(bytes: &[u8], name: &str) -> u32 {
    let key: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let at = (0..bytes.len() - 128)
        .step_by(128)
        .find(|&at| bytes[at..].starts_with(&key))
        .unwrap();
    u32::from_le_bytes(bytes[at + 116..at + 120].try_into().unwrap())
}

#[test]
fn many_streams_sharing_the_head_of_one_long_chain_are_refused_by_what_cfb_would_walk() {
    let o = recipients(400).file("long.bin", "", &vec![9u8; 8 * 1024 * 1024]);
    let honest = build(&o);
    let limits = Limits {
        steps: 1_200_000,
        ..Limits::DEFAULT
    };
    assert!(read(&honest, &limits).is_ok());
    let honest_steps = STEPS.with(|c| c.get());

    let mut hostile = honest.clone();
    let head = start_of(&hostile, "__substg1.0_37010102");
    let hit = point_at(&mut hostile, "__properties_version1.0", head, 4096);
    assert!(hit > 400);
    let got = read(&hostile, &limits);
    eprintln!("honest {honest_steps} hostile {}", STEPS.with(|c| c.get()));
    assert!(
        matches!(&got, Err(Fault::TooBig(m)) if m.contains("sector chains")),
        "{:?}",
        got.map(|c| c.facts.notes)
    );
    let steps = STEPS.with(|c| c.get());
    // The refusal comes at the first open that passes the budget: one chain's walk past it, no more.
    assert!(steps <= limits.steps + 4_096 * 2 + 64, "{steps}");
    assert!(honest_steps * 2 < steps, "{honest_steps} against {steps}");
}

#[test]
fn a_cycle_in_a_sector_chain_is_damage_not_a_hang() {
    let honest = build(&letter().file("a.bin", "", &vec![1u8; 8192]));
    let mut bad = honest.clone();
    let head = start_of(&bad, "__substg1.0_37010102");
    // The first FAT entry of the chain points back at itself.
    let ssize = 1usize << u16::from_le_bytes([honest[0x1E], honest[0x1F]]);
    let slot = 0x4C + 4 * (head as usize / (ssize / 4));
    let fat_sector = u32::from_le_bytes(honest[slot..slot + 4].try_into().unwrap()) as usize;
    let at = (fat_sector + 1) * ssize + (head as usize % (ssize / 4)) * 4;
    bad[at..at + 4].copy_from_slice(&head.to_le_bytes());
    assert_eq!(read(&bad, &Limits::DEFAULT).err(), Some(Fault::Damaged));
}

#[test]
fn a_real_shaped_large_message_reads_far_under_the_step_budget() {
    let mut o = recipients(600).file("big.bin", "", &vec![3u8; 10 * 1024 * 1024]);
    for k in 0..19 {
        o = o.file(&format!("{k}.bin"), "", &vec![k as u8; 100 * 1024]);
    }
    let bytes = build(&o);
    let c = read(&bytes, &Limits::DEFAULT).unwrap();
    assert_eq!(c.facts.recipients, 600);
    assert_eq!(c.facts.attachments, 20);
    let steps = STEPS.with(|c| c.get());
    eprintln!("steps for 600 recipients and 20 attachments (10 MB largest): {steps}");
    assert!(steps < Limits::DEFAULT.steps / 20, "{steps}");
}

#[test]
fn a_long_name_and_a_long_value_are_cut_and_charged() {
    let huge: String = "é".repeat(500_000);
    let o = letter()
        .s(id::SUBJECT, &huge)
        .file(&huge, "text/plain", b"x");
    let (text, _) = read_ok(&o);
    assert!(text.len() < 300_000, "{} bytes written", text.len());
    let name = text
        .lines()
        .find(|l| l.starts_with("Content-Disposition: attachment"))
        .unwrap();
    assert!(name.len() < 3 * mime::NAME_MAX + 64, "{}", name.len());

    let mut many = Obj::default().s(id::SUBJECT, "names");
    let long = "ü".repeat(20_000);
    for k in 0..200 {
        many = many.to(1, &format!("{long}{k}"), &format!("r{k}@x.example"));
    }
    let tight = Limits {
        written: 2 * 1024 * 1024,
        ..Limits::DEFAULT
    };
    let c = read(&build(&many), &tight).unwrap();
    assert!(c.mime.len() <= tight.written, "{} bytes", c.mime.len());
    assert!(
        c.facts
            .notes
            .iter()
            .any(|n| n.starts_with("To is left out")),
        "{:?}",
        c.facts.notes
    );
}

#[test]
fn an_attached_message_is_charged_once() {
    let mut o = letter();
    for k in 0..3 {
        let inner = Obj::default().s(id::SUBJECT, &format!("inner {k}")).file(
            "data.bin",
            "",
            &vec![k as u8; 2 * 1024 * 1024],
        );
        o = o.attach(&format!("inner {k}"), inner);
    }
    let limits = Limits {
        written: 12 * 1024 * 1024,
        ..Limits::DEFAULT
    };
    let c = read(&build(&o), &limits).unwrap();
    assert_eq!(c.facts.attachments, 3);
    assert!(c.facts.notes.is_empty(), "{:?}", c.facts.notes);
}

#[test]
fn mini_streams_are_charged_for_each_mini_sector_cfb_reads() {
    let long_names = |n: usize| {
        let mut o = Obj::default().s(id::SUBJECT, "many");
        for k in 0..n {
            o = o.to(1, &format!("{k:04}{}", "n".repeat(1_900)), "r@x.example");
        }
        o
    };
    let limits = Limits {
        steps: 3_000_000,
        ..Limits::DEFAULT
    };
    assert!(read(&build(&long_names(10)), &limits).is_ok());
    let got = read(&build(&long_names(300)), &limits);
    assert!(
        matches!(&got, Err(Fault::TooBig(m)) if m.contains("sector chains")),
        "{:?}",
        got.map(|c| c.facts.notes)
    );
    assert!(STEPS.with(|c| c.get()) < limits.steps + 100_000);
}

/// The directory entry ids under the root, found by walking its sibling tree.
fn root_children(bytes: &[u8]) -> (Vec<usize>, Vec<usize>) {
    let ssize = 1usize << u16::from_le_bytes([bytes[0x1E], bytes[0x1F]]);
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let fat = |id: usize| {
        let sector = u32_at(0x4C + 4 * (id / (ssize / 4))) as usize;
        u32_at((sector + 1) * ssize + (id % (ssize / 4)) * 4) as usize
    };
    let mut at = Vec::new();
    let mut sector = u32_at(0x30) as usize;
    while sector < 0xFFFF_FFFC {
        for e in 0..ssize / 128 {
            at.push((sector + 1) * ssize + e * 128);
        }
        sector = fat(sector);
    }
    let mut out = Vec::new();
    let mut todo = vec![u32_at(at[0] + 76) as usize];
    while let Some(id) = todo.pop() {
        if id >= at.len() {
            continue;
        }
        out.push(id);
        todo.push(u32_at(at[id] + 68) as usize);
        todo.push(u32_at(at[id] + 72) as usize);
    }
    (out, at)
}

#[test]
fn a_lookup_is_charged_the_height_of_the_sibling_tree_whatever_its_order() {
    let mut bytes = build(&letter());
    let before = layout::Layout::parse(&bytes, &Limits::DEFAULT)
        .unwrap()
        .resolve("/__properties_version1.0")
        .unwrap()
        .1;
    let (mut kids, at) = root_children(&bytes);
    kids.sort();
    // Chain the root's children into one list, out of name order: cfb's search of it can take every link.
    bytes[at[0] + 76..at[0] + 80].copy_from_slice(&(kids[0] as u32).to_le_bytes());
    for (i, &k) in kids.iter().enumerate() {
        let next = kids.get(i + 1).map_or(u32::MAX, |&n| n as u32);
        bytes[at[k] + 68..at[k] + 72].copy_from_slice(&u32::MAX.to_le_bytes());
        bytes[at[k] + 72..at[k] + 76].copy_from_slice(&next.to_le_bytes());
    }
    let layout = layout::Layout::parse(&bytes, &Limits::DEFAULT).unwrap();
    let hops = layout.resolve("/__properties_version1.0").unwrap().1;
    assert_eq!(hops, kids.len() as u64, "{before} before");
    assert!(before < hops);
}
