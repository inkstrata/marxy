use std::path::PathBuf;

use super::*;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/encodings")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The file offset of the page's UTF-8 offset `b`, as core's `fileOffsetOf` reads the map.
fn file_offset(d: &Decoded, b: usize) -> u64 {
    let bom = d.found.bom as u64;
    let text = &d.text[..b];
    match &d.map {
        ByteMap::Identity => b as u64,
        ByteMap::Units { unit, utf16 } => {
            let s = std::str::from_utf8(text).unwrap();
            let units = if *utf16 {
                s.encode_utf16().count()
            } else {
                s.chars().count()
            };
            (bom + units as u64 * *unit as u64).min(d.found.file_bytes)
        }
        ByteMap::Table(pairs) => {
            let (mut u0, mut f0) = (0u64, bom);
            for p in pairs.chunks(2) {
                if p[0] as usize > b {
                    break;
                }
                (u0, f0) = (p[0] as u64, p[1] as u64);
            }
            (f0 + (b as u64 - u0)).min(d.found.file_bytes)
        }
    }
}

/// Where `needle` is in the page, and the file's bytes it names.
fn file_range_of(d: &Decoded, needle: &str) -> (u64, u64) {
    let at = std::str::from_utf8(&d.text)
        .unwrap()
        .find(needle)
        .expect("in the text");
    (file_offset(d, at), file_offset(d, at + needle.len()))
}

#[test]
fn utf16_le_from_its_bom_is_a_fact_and_reads_right() {
    let bytes = fixture("tide-notes-utf16.txt");
    assert_eq!(bytes.len(), 2736);
    let d = decode(&bytes, None).unwrap();
    assert_eq!(d.found.label, "utf-16le");
    assert_eq!(d.found.name, "UTF-16 LE");
    assert_eq!(d.found.how, How::Bom);
    assert_eq!(d.found.bom, 2);
    assert_eq!(d.found.file_bytes, 2736);
    assert!(d.found.deciding.is_none() && d.found.evidence.is_none());
    assert_eq!(d.found.unreadable, 0);
    assert!(d.found.writable);
    let text = std::str::from_utf8(&d.text).unwrap();
    for word in ["Θάλασσα", "Ærø", "½", "Field notes"] {
        assert!(text.contains(word), "{word}");
    }
    // The BOM is the file's, not the text's; CRLF stays.
    assert!(text.starts_with("Field notes") && text.contains("\r\n"));
    assert_eq!(
        d.map,
        ByteMap::Units {
            unit: 2,
            utf16: true
        }
    );
    // A find hit names the file's bytes: two to a character, after the BOM.
    let (start, end) = file_range_of(&d, "Θάλασσα");
    let units: Vec<u16> = "Θάλασσα".encode_utf16().collect();
    let expected: Vec<u8> = units.iter().flat_map(|u| u.to_le_bytes()).collect();
    assert_eq!(&bytes[start as usize..end as usize], expected.as_slice());
    assert_eq!(file_offset(&d, 0), 2);
    assert_eq!(file_offset(&d, d.text.len()), 2736);
    // Written back as it came.
    assert_eq!(encode(text, "utf-16le", true).unwrap(), bytes);
}

#[test]
fn windows_1252_with_no_bom_is_guessed_and_says_the_byte_that_decided() {
    let bytes = fixture("harbourmaster-1998.txt");
    let d = decode(&bytes, None).unwrap();
    assert_eq!(d.found.label, "windows-1252");
    assert_eq!(d.found.how, How::Guess);
    assert_eq!(d.found.bom, 0);
    assert_eq!(
        d.found.deciding,
        Some(Deciding {
            offset: 24,
            line: 1,
            column: 25,
            byte: 0x97
        })
    );
    let why = d.found.evidence.clone().unwrap();
    assert_eq!((why.high, why.distinct, why.c1), (25, 15, 19));
    assert!(why.all_letters);
    assert_eq!(why.shown[0], (0x97, "—".to_string()));
    assert_eq!(d.found.unreadable, 0);
    assert!(d.found.writable);
    let text = std::str::from_utf8(&d.text).unwrap();
    assert!(text.starts_with("HARBOUR MASTER'S OFFICE — NOTE"));
    assert!(text.contains("café clock") && text.contains("€85") && text.contains("Peña"));
    // One byte to a character: the dash is the byte at 24.
    assert_eq!(file_range_of(&d, "—"), (24, 25));
    assert_eq!(file_range_of(&d, "Peña").1 - file_range_of(&d, "Peña").0, 4);
    assert_eq!(encode(text, "windows-1252", false).unwrap(), bytes);
}

#[test]
fn a_choice_reads_the_same_bytes_another_way_and_says_what_it_would_have_been() {
    let bytes = fixture("harbourmaster-1998.txt");
    let d = decode(&bytes, Some("macintosh")).unwrap();
    assert_eq!(d.found.label, "macintosh");
    assert_eq!(d.found.name, "Mac Roman");
    assert_eq!(d.found.how, How::Chosen);
    assert_eq!(d.found.detected.as_deref(), Some("windows-1252"));
    assert_eq!(d.found.detected_how, Some(How::Guess));
    // The dash becomes ó, as it would.
    assert!(std::str::from_utf8(&d.text)
        .unwrap()
        .starts_with("HARBOUR MASTER'S OFFICE ó NOTE"));
    // Choosing what it would be read as anyway is no choice.
    assert_eq!(
        decode(&bytes, Some("windows-1252")).unwrap().found.how,
        How::Guess
    );
    assert!(decode(&bytes, Some("no-such-thing")).is_err());
}

#[test]
fn utf16_be_and_utf32_from_their_boms_map_two_or_four_bytes_to_a_unit() {
    let text = "Tide \u{2192} 4.9 m, \u{1F30A} high\r\nÆrø\r\n";
    for (label, unit, utf16) in [
        ("utf-16be", 2u8, true),
        ("utf-32le", 4, false),
        ("utf-32be", 4, false),
    ] {
        let bytes = encode(text, label, true).unwrap();
        let d = decode(&bytes, None).unwrap();
        assert_eq!(d.found.label, label);
        assert_eq!(d.found.how, How::Bom);
        assert_eq!(d.text, text.as_bytes(), "{label}");
        assert_eq!(d.map, ByteMap::Units { unit, utf16 });
        let bom = d.found.bom as u64;
        // The wave is past the BMP: a surrogate pair in UTF-16 (4 bytes), one unit in UTF-32 (4 bytes).
        let (start, end) = file_range_of(&d, "\u{1F30A}");
        assert_eq!(end - start, 4, "{label}");
        let before = "Tide \u{2192} 4.9 m, ";
        let units = if utf16 {
            before.encode_utf16().count()
        } else {
            before.chars().count()
        } as u64;
        assert_eq!(start, bom + units * unit as u64, "{label}");
        assert_eq!(
            file_range_of(&d, "Ærø").0,
            bom + if utf16 {
                "Tide \u{2192} 4.9 m, \u{1F30A} high\r\n"
                    .encode_utf16()
                    .count() as u64
                    * 2
            } else {
                "Tide \u{2192} 4.9 m, \u{1F30A} high\r\n".chars().count() as u64 * 4
            },
            "{label}"
        );
        assert!(d.found.writable);
        assert_eq!(encode(text, label, true).unwrap(), bytes);
    }
}

#[test]
fn a_multi_byte_encoding_keeps_a_table_of_where_each_character_starts() {
    let text = "abc 日本語 def\r\nテスト";
    let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode(text);
    let d = decode(&bytes, Some("shift_jis")).unwrap();
    assert_eq!(d.found.label, "shift_jis");
    assert_eq!(d.text, text.as_bytes());
    assert!(matches!(d.map, ByteMap::Table(_)));
    // Two bytes to each of these characters, one to each ASCII letter.
    assert_eq!(file_range_of(&d, "日本語"), (4, 10));
    assert_eq!(file_range_of(&d, "def"), (11, 14));
    assert_eq!(file_range_of(&d, "テスト"), (16, 22));
    assert!(d.found.writable);
}

#[test]
fn a_save_writes_the_files_encoding_or_says_which_character_it_cannot() {
    assert_eq!(encode("café", "iso-8859-1", false).unwrap(), b"caf\xe9");
    let refused = encode("one\ntwo \u{20ac}", "iso-8859-1", false).unwrap_err();
    assert_eq!((refused.ch, refused.line), ('€', 2));
    assert!(refused
        .say("ISO-8859-1")
        .contains("on line 2 has no bytes in ISO-8859-1"));
    let refused = encode("a\nb\nΘ", "windows-1252", false).unwrap_err();
    assert_eq!((refused.ch, refused.line), ('Θ', 3));
    // A byte the encoding cannot read is lost on the way back, so such a file is not written in it.
    let d = decode(b"caf\xe9 \x81", Some("windows-1252")).unwrap();
    assert!(
        d.found.writable,
        "Windows-1252 reads 81 as a control and writes it back"
    );
    let d = decode(b"\x82\xa0\x82", Some("shift_jis")).unwrap();
    assert!(d.found.unreadable > 0);
    assert!(!d.found.writable);
}

#[test]
fn utf8_with_a_stray_byte_is_still_utf8_and_keeps_the_byte() {
    // A character above ASCII that is well-formed UTF-8 says the file is UTF-8; the stray byte is damage, shown in Source.
    let bytes = "café crème brûlée and a naïve façade\n".repeat(3);
    let mut bytes = bytes.into_bytes();
    bytes.insert(20, 0xff);
    let bytes = bytes.as_slice();
    let d = decode(bytes, None).unwrap();
    assert_eq!((d.found.label.as_str(), d.found.how), ("utf-8", How::Utf8));
    assert_eq!(d.map, ByteMap::Identity);
    assert_eq!(d.text, bytes);
    assert!(looks_like_utf8(bytes));
    assert!(!looks_like_utf8(b"caf\xe9 au lait"));
    // A character cut short at the very end (E2 82, its last byte gone) is damaged UTF-8 too.
    let mut cut = "Café ☃ crème brûlée ".repeat(3).into_bytes();
    cut.extend_from_slice(b"\xe2\x82");
    assert!(looks_like_utf8(&cut));
    assert_eq!(decode(&cut, None).unwrap().found.how, How::Utf8);
    // In the middle it is two stray bytes, not evidence.
    assert!(!looks_like_utf8(b"\xe2\x82 a \xe2\x82 b \xe2\x82 c"));
    // One byte above 7F is too few to guess from: a stray byte in UTF-8, as before.
    assert_eq!(
        decode(b"caf\xe9 au lait", None).unwrap().found.how,
        How::Utf8
    );
    assert_eq!(
        decode(b"caf\xe9 cr\xe8me br\xfbl\xe9e", None)
            .unwrap()
            .found
            .how,
        How::Guess
    );
}

#[test]
fn valid_utf8_is_left_as_it_is() {
    let d = decode("caf\u{e9}\n".as_bytes(), None).unwrap();
    assert_eq!(d.found.how, How::Utf8);
    assert_eq!(d.map, ByteMap::Identity);
    let d = decode(b"\xef\xbb\xbfhi", None).unwrap();
    assert_eq!((d.found.how, d.found.bom), (How::Bom, 0));
    assert_eq!(d.text, b"\xef\xbb\xbfhi");
}

#[test]
fn read_with_encoding_reads_the_same_bytes_each_way() {
    let bytes = fixture("harbourmaster-1998.txt");
    let r = readings(&bytes);
    let row = |label: &str| r.rows.iter().find(|x| x.label == label).unwrap().clone();
    assert_eq!(r.sample_at, 19);
    assert!(row("windows-1252").sample.starts_with("FICE — NOTE"));
    assert_eq!(row("windows-1252").unreadable, 0);
    assert_eq!(row("utf-8").unreadable, 25);
    assert!(row("macintosh").sample.starts_with("FICE ó NOTE"));
    assert_eq!(row("iso-8859-1").controls, 1);
    assert_eq!(row("iso-8859-15").controls, 1);
    assert_eq!(r.counted, bytes.len() as u64);
    for (label, _) in CANDIDATES {
        assert!(r.rows.iter().any(|x| x.label == *label), "{label}");
    }
    let utf16 = readings(&fixture("tide-notes-utf16.txt"));
    let row16 = utf16.rows.iter().find(|x| x.label == "utf-16le").unwrap();
    assert_eq!(row16.unreadable, 0);
    assert!(!row16.sample.is_empty());
}

#[test]
fn the_frame_carries_the_head_the_table_and_the_text() {
    let d = decode(&fixture("tide-notes-utf16.txt"), None).unwrap();
    let f = commands::frame(&d);
    let n = u32::from_le_bytes([f[0], f[1], f[2], f[3]]) as usize;
    let head: serde_json::Value = serde_json::from_slice(&f[4..4 + n]).unwrap();
    assert_eq!(head["found"]["label"], "utf-16le");
    assert_eq!(head["found"]["how"], "bom");
    assert_eq!(head["map"]["kind"], "units");
    assert_eq!(head["map"]["count"], "utf16");
    let t = u32::from_le_bytes([f[4 + n], f[5 + n], f[6 + n], f[7 + n]]) as usize;
    assert_eq!(t, 0);
    assert_eq!(&f[8 + n..], d.text.as_slice());
}

#[test]
fn shift_jis_and_gbk_text_is_guessed_as_such_not_taken_for_damaged_utf8() {
    let sjis_text =
        "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。\n".repeat(20);
    let gbk_text = "我是一只猫。名字还没有。出生在哪里全然不知道。\n".repeat(20);
    for (text, enc, label) in [
        (&sjis_text, encoding_rs::SHIFT_JIS, "shift_jis"),
        (&gbk_text, encoding_rs::GBK, "gbk"),
    ] {
        let (bytes, _, _) = enc.encode(text);
        assert!(!looks_like_utf8(&bytes), "{label}");
        let d = decode(&bytes, None).unwrap();
        assert_eq!(d.found.how, How::Guess, "{label}");
        assert_eq!(d.found.label, label);
        assert_eq!(d.text, text.as_bytes());
    }
    // Controls: UTF-8 and ASCII are not guessed at.
    assert!(looks_like_utf8(sjis_text.as_bytes()));
    assert!(!looks_like_utf8(b"plain ascii"));
    assert_eq!(decode(b"plain ascii", None).unwrap().found.how, How::Utf8);
    assert_eq!(
        decode(gbk_text.as_bytes(), None).unwrap().found.how,
        How::Utf8
    );
}

#[test]
fn short_and_mixed_legacy_text_is_not_taken_for_utf8() {
    let samples: [(&str, &encoding_rs::Encoding, &str); 5] = [
        ("吾輩は猫である。", encoding_rs::SHIFT_JIS, "shift_jis"),
        ("我是一只猫。", encoding_rs::GBK, "gbk"),
        ("吾輩は猫である。名前はまだ無い。", encoding_rs::EUC_JP, "euc-jp"),
        ("ｱｲｳｴｵ ｶｷｸｹｺ ｻｼｽｾｿ", encoding_rs::SHIFT_JIS, "shift_jis"),
        (
            "Release notes for version 2.1: the installer now keeps your settings. See the manual. これは新しい",
            encoding_rs::SHIFT_JIS,
            "shift_jis",
        ),
    ];
    for (text, enc, label) in samples {
        let (bytes, _, _) = enc.encode(text);
        assert!(!looks_like_utf8(&bytes), "{label}: {text}");
    }
    // A UTF-8 file with one corrupt byte stays UTF-8, bytes kept.
    let mut bytes = "日本語のテキスト、これは普通のファイルです。\n".repeat(4).into_bytes();
    bytes[30] = 0xff;
    assert!(looks_like_utf8(&bytes));
    let d = decode(&bytes, None).unwrap();
    assert_eq!((d.found.label.as_str(), d.found.how), ("utf-8", How::Utf8));
    assert_eq!(d.text, bytes);
}
