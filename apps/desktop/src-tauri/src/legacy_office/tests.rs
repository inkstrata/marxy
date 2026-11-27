//! Word 97 documents and PowerPoint 97 decks built here byte by byte, as the formats lay them out, and read back: the
//! demo's two are what these builders make.

use std::io::{Cursor, Write};

use super::*;

// ---- compound files -----------------------------------------------------------------------------------------------------

pub type W = cfb::CompoundFile<Cursor<Vec<u8>>>;

pub fn compound(streams: &[(&str, &[u8])], storages: &[&str]) -> Vec<u8> {
    let mut cf: W = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    for s in storages {
        cf.create_storage(format!("/{s}")).unwrap();
    }
    for (name, bytes) in streams {
        cf.create_stream(format!("/{name}"))
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    let fixed = std::time::UNIX_EPOCH + std::time::Duration::from_secs(SAVED);
    let _ = cf.set_created_time("/", fixed);
    let _ = cf.set_modified_time("/", fixed);
    for s in storages {
        let _ = cf.set_created_time(format!("/{s}"), fixed);
        let _ = cf.set_modified_time(format!("/{s}"), fixed);
    }
    cf.flush().unwrap();
    cf.into_inner().into_inner()
}

const SAVED: u64 = 917_000_000;

fn put16(v: &mut Vec<u8>, x: u16) {
    v.extend_from_slice(&x.to_le_bytes());
}

fn put32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}

fn set32(v: &mut [u8], at: usize, x: u32) {
    v[at..at + 4].copy_from_slice(&x.to_le_bytes());
}

fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
}

/// A SummaryInformation stream: the code page, a title, an author and when it was saved.
pub fn summary(title: &str, author: &str) -> Vec<u8> {
    let mut values: Vec<(u32, Vec<u8>)> = Vec::new();
    let mut i2 = Vec::new();
    put32(&mut i2, 2);
    put16(&mut i2, 1252);
    put16(&mut i2, 0);
    values.push((1, i2));
    for (id, s) in [(2u32, title), (4, author), (18, "Microsoft Office")] {
        let mut v = Vec::new();
        put32(&mut v, 0x1E);
        let (b, _, _) = encoding_rs::WINDOWS_1252.encode(s);
        put32(&mut v, b.len() as u32 + 1);
        v.extend_from_slice(&b);
        v.push(0);
        while v.len() % 4 != 0 {
            v.push(0);
        }
        values.push((id, v));
    }
    let mut ft = Vec::new();
    put32(&mut ft, 0x40);
    ft.extend_from_slice(&props::filetime_of(SAVED).to_le_bytes());
    values.push((13, ft));
    let mut out = Vec::new();
    put16(&mut out, 0xFFFE);
    put16(&mut out, 0);
    put32(&mut out, 0x0002_0006);
    out.extend_from_slice(&[0; 16]);
    put32(&mut out, 1);
    out.extend_from_slice(&[
        0xE0, 0x85, 0x9F, 0xF2, 0xF9, 0x4F, 0x68, 0x10, 0xAB, 0x91, 0x08, 0x00, 0x2B, 0x27, 0xB3,
        0xD9,
    ]);
    put32(&mut out, 48);
    let head = 8 + 8 * values.len();
    let size = head + values.iter().map(|v| v.1.len()).sum::<usize>();
    put32(&mut out, size as u32);
    put32(&mut out, values.len() as u32);
    let mut at = head;
    for (id, v) in &values {
        put32(&mut out, *id);
        put32(&mut out, at as u32);
        at += v.len();
    }
    for (_, v) in values {
        out.extend_from_slice(&v);
    }
    out
}

// ---- Word 97 ------------------------------------------------------------------------------------------------------------

pub const BOLD: &[u8] = &[0x35, 0x08, 1];
pub const ITALIC: &[u8] = &[0x36, 0x08, 1];
pub const HIDDEN: &[u8] = &[0x3C, 0x08, 1];
/// fSpec: the character is a special one, as Word marks a picture's.
pub const SPEC: &[u8] = &[0x55, 0x08, 1];
pub const IN_TABLE: &[u8] = &[0x16, 0x24, 1];
pub const ROW_END: &[u8] = &[0x16, 0x24, 1, 0x17, 0x24, 1];
pub const IN_LIST: &[u8] = &[0x0B, 0x46, 1, 0];

/// Built-in style identifiers, in the style sheet's order: Normal, Heading 1, Heading 2, Title.
pub const STYLES: [u16; 4] = [0, 1, 2, 62];
pub const NORMAL: u16 = 0;
pub const H1: u16 = 1;
pub const H2: u16 = 2;
pub const TITLE: u16 = 3;

#[derive(Default)]
pub struct Word {
    pub units: Vec<u16>,
    /// Character runs: units [from, to) and their properties.
    chp: Vec<(usize, usize, Vec<u8>)>,
    /// Paragraphs: units [from, to), the last the mark, with their style and properties.
    pap: Vec<(usize, usize, u16, Vec<u8>)>,
    para_from: usize,
    /// Units before this are written as one 8-bit piece in Windows-1252, the rest as UTF-16.
    pub eight_bit: usize,
    pub encrypted: bool,
    pub extra_streams: Vec<(String, Vec<u8>)>,
    pub storages: Vec<String>,
    /// Pieces after the first two: each names units [from, to) again, as a file can.
    pub repeat: Vec<(usize, usize)>,
}

impl Word {
    pub fn text(mut self, s: &str, props: &[u8]) -> Self {
        let from = self.units.len();
        self.units.extend(s.encode_utf16());
        self.chp.push((from, self.units.len(), props.to_vec()));
        self
    }

    pub fn raw(mut self, u: u16) -> Self {
        let from = self.units.len();
        self.units.push(u);
        self.chp.push((from, from + 1, Vec::new()));
        self
    }

    fn mark(mut self, u: u16, style: u16, props: &[u8]) -> Self {
        self.units.push(u);
        let to = self.units.len();
        self.chp.push((to - 1, to, Vec::new()));
        self.pap.push((self.para_from, to, style, props.to_vec()));
        self.para_from = to;
        self
    }

    pub fn para(self, style: u16, props: &[u8]) -> Self {
        self.mark(0x0D, style, props)
    }

    pub fn p(self, s: &str) -> Self {
        self.text(s, &[]).para(NORMAL, &[])
    }

    pub fn cell(self, s: &str) -> Self {
        self.text(s, &[]).mark(0x07, NORMAL, IN_TABLE)
    }

    pub fn row_end(self) -> Self {
        self.mark(0x07, NORMAL, ROW_END)
    }

    /// The WordDocument stream and the 1Table stream.
    pub fn streams(&self) -> (Vec<u8>, Vec<u8>) {
        let table = cp1252_back();
        let n = self.units.len();
        let split = self.eight_bit.min(n);
        let mut w = vec![0u8; 1024];
        // Byte of each unit, for the property pages.
        let mut fc = Vec::with_capacity(n + 1);
        let p1 = w.len();
        for &u in &self.units[..split] {
            fc.push(w.len());
            w.push(
                *table
                    .get(&u)
                    .expect("an 8-bit piece holds Windows-1252 only"),
            );
        }
        if w.len() % 2 == 1 {
            w.push(0);
        }
        let p2 = w.len();
        for &u in &self.units[split..] {
            fc.push(w.len());
            put16(&mut w, u);
        }
        fc.push(w.len());
        let byte_end = |to: usize| {
            if to == 0 {
                fc[0]
            } else {
                fc[to - 1] + if to - 1 < split { 1 } else { 2 }
            }
        };
        // The repeated pieces point at the same bytes again.
        let mut pieces: Vec<(u32, u32)> = Vec::new(); // (cp, fc field)
        if split > 0 {
            pieces.push((0, ((p1 as u32) * 2) | 0x4000_0000));
        }
        if split < n {
            pieces.push((split as u32, p2 as u32));
        }
        let mut cp_end = n as u32;
        for &(from, to) in &self.repeat {
            let f = if from < split {
                ((fc[from] as u32) * 2) | 0x4000_0000
            } else {
                fc[from] as u32
            };
            pieces.push((cp_end, f));
            cp_end += (to - from) as u32;
        }
        let mut cps: Vec<u32> = pieces.iter().map(|p| p.0).collect();
        cps.push(cp_end);

        // Character and paragraph pages, a few runs to a page.
        while w.len() % 512 != 0 {
            w.push(0);
        }
        let chp_runs: Vec<(usize, usize, Vec<u8>)> = self
            .chp
            .iter()
            .map(|(a, b, g)| (fc[*a], byte_end(*b), g.clone()))
            .collect();
        let chp_bte = pages(&mut w, &chp_runs, false);
        let pap_runs: Vec<(usize, usize, Vec<u8>)> = self
            .pap
            .iter()
            .map(|(a, b, istd, g)| {
                let mut d = istd.to_le_bytes().to_vec();
                d.extend_from_slice(g);
                (fc[*a], byte_end(*b), d)
            })
            .collect();
        let pap_bte = pages(&mut w, &pap_runs, true);

        // The table stream: the style sheet, the bin tables, the piece table.
        let mut t = Vec::new();
        let stsh = t.len();
        put16(&mut t, 4);
        put16(&mut t, STYLES.len() as u16);
        put16(&mut t, 10);
        for sti in STYLES {
            put16(&mut t, 10);
            put16(&mut t, sti);
            t.extend_from_slice(&[0; 8]);
        }
        let stsh_len = t.len() - stsh;
        let chp_at = t.len();
        t.extend_from_slice(&chp_bte);
        let pap_at = t.len();
        t.extend_from_slice(&pap_bte);
        let clx = t.len();
        t.push(2);
        put32(&mut t, (cps.len() * 4 + pieces.len() * 8) as u32);
        for cp in &cps {
            put32(&mut t, *cp);
        }
        for (_, f) in &pieces {
            put16(&mut t, 0);
            put32(&mut t, *f);
            put16(&mut t, 0);
        }
        let clx_len = t.len() - clx;

        // The FIB.
        let mut f = Vec::new();
        put16(&mut f, 0xA5EC);
        put16(&mut f, 0x00C1);
        put16(&mut f, 0);
        put16(&mut f, 0);
        put16(&mut f, 0);
        let mut flags = 0x0200u16;
        if self.encrypted {
            flags |= 0x0100;
        }
        put16(&mut f, flags);
        f.resize(32, 0);
        put16(&mut f, 14);
        f.resize(34 + 28, 0);
        put16(&mut f, 22);
        let mut lw = [0u32; 22];
        lw[0] = w.len() as u32;
        lw[3] = cp_end;
        for x in lw {
            put32(&mut f, x);
        }
        put16(&mut f, 93);
        let mut fclcb = vec![(0u32, 0u32); 93];
        fclcb[1] = (stsh as u32, stsh_len as u32);
        fclcb[12] = (chp_at as u32, chp_bte.len() as u32);
        fclcb[13] = (pap_at as u32, pap_bte.len() as u32);
        fclcb[33] = (clx as u32, clx_len as u32);
        for (a, b) in fclcb {
            put32(&mut f, a);
            put32(&mut f, b);
        }
        put16(&mut f, 0);
        w[..f.len()].copy_from_slice(&f);
        (w, t)
    }

    pub fn build(&self) -> Vec<u8> {
        let (w, t) = self.streams();
        let mut streams: Vec<(&str, &[u8])> = vec![("WordDocument", &w), ("1Table", &t)];
        for (n, b) in &self.extra_streams {
            streams.push((n, b));
        }
        let storages: Vec<&str> = self.storages.iter().map(|s| s.as_str()).collect();
        compound(&streams, &storages)
    }
}

fn cp1252_back() -> std::collections::HashMap<u16, u8> {
    let all: Vec<u8> = (0..=255u8).collect();
    let (s, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(&all);
    s.chars()
        .enumerate()
        .map(|(i, c)| (c as u16, i as u8))
        .collect()
}

/// Formatted-disk pages for `runs` (byte ranges and their property bytes), appended to `w`; the bin table back.
fn pages(w: &mut Vec<u8>, runs: &[(usize, usize, Vec<u8>)], pap: bool) -> Vec<u8> {
    let mut firsts = Vec::new();
    let mut pns = Vec::new();
    let mut last = 0;
    for chunk in runs.chunks(12) {
        let mut page = vec![0u8; 512];
        let crun = chunk.len();
        for (j, r) in chunk.iter().enumerate() {
            set32(&mut page, 4 * j, r.0 as u32);
        }
        set32(&mut page, 4 * crun, chunk.last().unwrap().1 as u32);
        let mut top = 511usize;
        let index = 4 * (crun + 1);
        for (j, r) in chunk.iter().enumerate() {
            let g = &r.2;
            let block: Vec<u8> = if pap {
                if g.len() % 2 == 1 {
                    let mut b = vec![g.len().div_ceil(2) as u8];
                    b.extend_from_slice(g);
                    b
                } else {
                    let mut b = vec![0, (g.len() / 2) as u8];
                    b.extend_from_slice(g);
                    b
                }
            } else if g.is_empty() {
                Vec::new()
            } else {
                let mut b = vec![g.len() as u8];
                b.extend_from_slice(g);
                b
            };
            let off = if block.is_empty() {
                0
            } else {
                top = (top - block.len()) & !1;
                page[top..top + block.len()].copy_from_slice(&block);
                top / 2
            };
            if pap {
                page[index + 13 * j] = off as u8;
            } else {
                page[index + j] = off as u8;
            }
        }
        page[511] = crun as u8;
        firsts.push(chunk[0].0 as u32);
        last = chunk.last().unwrap().1 as u32;
        pns.push((w.len() / 512) as u32);
        w.extend_from_slice(&page);
    }
    let mut bte = Vec::new();
    for f in &firsts {
        put32(&mut bte, *f);
    }
    put32(&mut bte, last);
    for p in pns {
        put32(&mut bte, p);
    }
    bte
}

/// A field: its code hidden, its result shown.
pub fn field(w: Word, code: &str, result: &str, props: &[u8]) -> Word {
    w.raw(0x13)
        .text(code, &[])
        .raw(0x14)
        .text(result, props)
        .raw(0x15)
}

/// The demo's document: a title, headings, bold and italic words, a link, a table, a list, a picture, and text in both
/// an 8-bit piece and a UTF-16 one.
pub fn demo_doc() -> Word {
    let w = Word::default()
        .text("Harbour survey, 1998", &[])
        .para(TITLE, &[])
        .text("Prepared for the harbour board, set down in Word 97.", &[])
        .para(NORMAL, &[])
        .text("Soundings", &[])
        .para(H1, &[])
        .text("The channel held ", &[])
        .text("four metres", BOLD)
        .text(" at low water, the caf\u{e9} pier \u{2013} as \u{2018}ever\u{2019} \u{2013} a little less.", &[])
        .para(NORMAL, &[]);
    let w = field(
        w.text("The full table is on ", &[]),
        " HYPERLINK \"https://example.org/survey\" ",
        "the board\u{2019}s page",
        &[],
    )
    .text(", page ", &[]);
    let w = field(w, " PAGE ", "3", &[])
        .text(".", &[])
        .para(NORMAL, &[]);
    let w = w
        .text("Readings", &[])
        .para(H2, &[])
        .cell("Gauge")
        .cell("Metres")
        .row_end()
        .cell("North mole")
        .cell("4.2")
        .row_end()
        .cell("Inner basin")
        .cell("3.9")
        .row_end()
        .text("Buoys relaid", &[])
        .para(NORMAL, IN_LIST)
        .text("Leading lights checked", &[])
        .para(NORMAL, IN_LIST)
        .text("\u{1}", SPEC)
        .para(NORMAL, &[]);
    let eight_bit = w.units.len();
    let mut w = w
        .text("Notes from the pilots", &[])
        .para(H1, &[])
        .text("\u{3a9}\u{3bc}\u{3ad}\u{3b3}\u{3b1} buoy, ", &[])
        .text("emphatically", ITALIC)
        .text(" relit \u{6f22}\u{5b57}.", &[])
        .para(NORMAL, &[]);
    w.eight_bit = eight_bit;
    w.extra_streams.push((
        "\u{5}SummaryInformation".into(),
        summary("Harbour survey, 1998", "R. Marsh"),
    ));
    w.storages.push("Macros".into());
    w
}

fn text_of(kids: &[Inline]) -> String {
    kids.iter()
        .map(|k| match k {
            Inline::Run { text, .. } => text.clone(),
            Inline::Link { kids, .. } => text_of(kids),
            Inline::Br => "\n".into(),
            Inline::Image { .. } => "[image]".into(),
        })
        .collect()
}

fn read_ok(bytes: &[u8]) -> Reading {
    read(bytes, &Limits::DEFAULT).unwrap()
}

#[test]
fn a_word_97_document_reads_with_headings_bold_a_table_a_list_and_a_link() {
    let r = read_ok(&demo_doc().build());
    assert_eq!(r.format, "doc");
    let b = &r.blocks;
    assert!(
        matches!(&b[0], Block::Heading { level: 1, kids, .. } if text_of(kids) == "Harbour survey, 1998")
    );
    assert!(matches!(&b[2], Block::Heading { level: 2, kids, .. } if text_of(kids) == "Soundings"));
    let Block::Para { kids } = &b[3] else {
        panic!("{:?}", b[3])
    };
    assert!(kids.contains(&Inline::Run {
        text: "four metres".into(),
        b: true,
        i: false,
        s: false
    }));
    assert_eq!(
        text_of(kids),
        "The channel held four metres at low water, the caf\u{e9} pier \u{2013} as \u{2018}ever\u{2019} \u{2013} a little less."
    );
    let Block::Para { kids } = &b[4] else {
        panic!("{:?}", b[4])
    };
    assert_eq!(
        text_of(kids),
        "The full table is on the board\u{2019}s page, page 3."
    );
    assert!(kids.iter().any(|k| matches!(k, Inline::Link { href, kids } if href == "https://example.org/survey" && text_of(kids) == "the board\u{2019}s page")));
    assert!(matches!(&b[5], Block::Heading { level: 3, .. }));
    let Block::Table { rows } = &b[6] else {
        panic!("{:?}", b[6])
    };
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[1].iter().map(|c| text_of(c)).collect::<Vec<_>>(),
        ["North mole", "4.2"]
    );
    let Block::List { items, .. } = &b[7] else {
        panic!("{:?}", b[7])
    };
    assert_eq!(items.len(), 2);
    assert!(matches!(&b[8], Block::Para { kids } if kids == &[Inline::Image { image: 0 }]));
    assert_eq!(r.images[0].what, "held picture");
    let Block::Para { kids } = &b[10] else {
        panic!("{:?}", b[10])
    };
    assert_eq!(
        text_of(kids),
        "\u{3a9}\u{3bc}\u{3ad}\u{3b3}\u{3b1} buoy, emphatically relit \u{6f22}\u{5b57}."
    );
    assert!(kids.contains(&Inline::Run {
        text: "emphatically".into(),
        b: false,
        i: true,
        s: false
    }));
    assert_eq!(r.props.title.as_deref(), Some("Harbour survey, 1998"));
    assert_eq!(r.props.creator.as_deref(), Some("R. Marsh"));
    assert!(r.props.modified.is_some());
    assert_eq!(r.left_out, ["macros"]);
    assert!(r.cut.is_empty());
}

#[test]
fn an_8_bit_piece_and_a_utf_16_piece_both_decode() {
    let mut w = Word::default()
        .p("\u{201c}Fa\u{e7}ade\u{201d} \u{2014} \u{20ac}5")
        .p("\u{3b4}\u{3b5}\u{3bb}\u{3c4}\u{3af}\u{3bf} \u{1f30a}");
    // The whole first paragraph, its mark too.
    w.eight_bit = 14;
    let (stream, _) = w.streams();
    // The 8-bit piece holds the curly quotes and the euro sign as Windows-1252 bytes.
    assert!(stream.windows(3).any(|x| x == [0x93, b'F', b'a']));
    assert!(stream.contains(&0x80));
    let r = read_ok(&w.build());
    let texts: Vec<String> = r
        .blocks
        .iter()
        .map(|b| match b {
            Block::Para { kids } => text_of(kids),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        texts,
        [
            "\u{201c}Fa\u{e7}ade\u{201d} \u{2014} \u{20ac}5",
            "\u{3b4}\u{3b5}\u{3bb}\u{3c4}\u{3af}\u{3bf} \u{1f30a}"
        ]
    );
}

#[test]
fn a_field_shows_its_result_and_hidden_text_is_left_out() {
    let w = field(Word::default().text("Total: ", &[]), " =2+2 ", "four", &[]);
    let w = w
        .text(" (not shown)", HIDDEN)
        .text(" sums", &[])
        .raw(0x0B)
        .text("next line", &[])
        .para(NORMAL, &[]);
    let r = read_ok(&w.build());
    let Block::Para { kids } = &r.blocks[0] else {
        panic!()
    };
    assert_eq!(text_of(kids), "Total: four sums\nnext line");
}

#[test]
fn an_embedded_object_is_named_never_run() {
    let mut w = field(Word::default(), " EMBED Excel.Sheet.8 ", "\u{1}", SPEC).para(NORMAL, &[]);
    w.storages.push("ObjectPool".into());
    let r = read_ok(&w.build());
    assert_eq!(r.images[0].what, "object");
    assert_eq!(r.left_out, ["embedded objects"]);
}

#[test]
fn an_encrypted_document_says_so() {
    let mut w = demo_doc();
    w.encrypted = true;
    let e = read(&w.build(), &Limits::DEFAULT).unwrap_err();
    assert!(
        matches!(&e, Fault::Encrypted(why) if why.contains("encrypted with a password")),
        "{e:?}"
    );
    let locked = compound(
        &[
            ("EncryptionInfo", &[4, 0, 4, 0]),
            ("EncryptedPackage", &[0; 64]),
        ],
        &[],
    );
    assert!(matches!(
        read(&locked, &Limits::DEFAULT),
        Err(Fault::Encrypted(_))
    ));
}

#[test]
fn what_is_not_a_document_says_so() {
    assert!(matches!(
        read(b"{\\rtf1 hello}", &Limits::DEFAULT),
        Err(Fault::Not(_))
    ));
    let other = compound(&[("Workbook", &[0; 64])], &[]);
    assert!(
        matches!(read(&other, &Limits::DEFAULT), Err(Fault::Not(why)) if why.contains("no Word document"))
    );
    let (mut s, t) = Word::default().p("old").streams();
    s[2..4].copy_from_slice(&0x0068u16.to_le_bytes());
    let old = compound(&[("WordDocument", &s), ("1Table", &t)], &[]);
    assert!(
        matches!(read(&old, &Limits::DEFAULT), Err(Fault::Not(why)) if why.contains("Word 95"))
    );
}

#[test]
fn pieces_that_name_the_same_text_again_stop_at_the_text_cap() {
    let mut w = Word::default().p("tide ".repeat(100).trim());
    w.repeat = (0..2000).map(|_| (0, 100)).collect();
    let limits = Limits {
        chars: 10_000,
        ..Limits::DEFAULT
    };
    let r = read(&w.build(), &limits).unwrap();
    assert!(r.cut.iter().any(|c| c.contains("runs past")), "{:?}", r.cut);
    let words: usize = r
        .blocks
        .iter()
        .map(|b| match b {
            Block::Para { kids } => text_of(kids).len(),
            _ => 0,
        })
        .sum();
    assert!(words <= 10_000);
}

#[test]
fn a_piece_past_the_stream_is_cut_not_read() {
    let w = Word::default().p("the start").p("the end");
    let (s, mut t) = w.streams();
    // The piece's offset, pointed far past the stream's end.
    let clx = u32::from_le_bytes(s[154 + 33 * 8..154 + 33 * 8 + 4].try_into().unwrap()) as usize;
    let n = (u32::from_le_bytes(t[clx + 1..clx + 5].try_into().unwrap()) as usize - 4) / 12;
    let pcd = clx + 5 + 4 * (n + 1);
    set32(&mut t, pcd + 2, 0x0100_0000);
    let r = read_ok(&compound(&[("WordDocument", &s), ("1Table", &t)], &[]));
    assert!(r.cut.iter().any(|c| c.contains("past the end")));
}

// ---- PowerPoint 97 ------------------------------------------------------------------------------------------------------

fn record(ver: u16, inst: u16, ty: u16, body: &[u8]) -> Vec<u8> {
    let mut r = Vec::new();
    put16(&mut r, ver | (inst << 4));
    put16(&mut r, ty);
    put32(&mut r, body.len() as u32);
    r.extend_from_slice(body);
    r
}

fn atom(ty: u16, body: &[u8]) -> Vec<u8> {
    record(0, 0, ty, body)
}

fn container(ty: u16, inst: u16, kids: &[Vec<u8>]) -> Vec<u8> {
    record(0xF, inst, ty, &kids.concat())
}

fn text_atoms(ty: u32, s: &str, bytes: bool) -> Vec<Vec<u8>> {
    let mut out = vec![atom(0x0F9F, &ty.to_le_bytes())];
    if bytes {
        out.push(atom(
            0x0FA8,
            &s.chars().map(|c| c as u8).collect::<Vec<_>>(),
        ));
    } else {
        out.push(atom(0x0FA0, &utf16le(s)));
    }
    out
}

fn persist_atom(persist: u32, id: u32) -> Vec<u8> {
    let mut b = Vec::new();
    put32(&mut b, persist);
    put32(&mut b, 0);
    put32(&mut b, 0);
    put32(&mut b, id);
    put32(&mut b, 0);
    atom(0x03F3, &b)
}

#[derive(Clone, Default)]
pub struct Slide {
    pub title: String,
    pub body: Vec<String>,
    pub text_box: Option<String>,
    pub picture: bool,
    pub hidden: bool,
    pub notes: Option<String>,
}

pub struct Deck {
    pub slides: Vec<Slide>,
    pub encrypted: bool,
    pub current_user: bool,
    /// The edit's offset to the one before it: itself makes a cycle.
    pub edit_loops: bool,
}

fn drawing(kids: Vec<Vec<u8>>) -> Vec<u8> {
    let shapes: Vec<Vec<u8>> = kids
        .into_iter()
        .map(|k| container(0xF004, 0, &[k]))
        .collect();
    container(
        0x040C,
        0,
        &[container(0xF002, 0, &[container(0xF003, 0, &shapes)])],
    )
}

impl Deck {
    pub fn new(slides: Vec<Slide>) -> Deck {
        Deck {
            slides,
            encrypted: false,
            current_user: true,
            edit_loops: false,
        }
    }

    /// The PowerPoint Document stream and the Current User stream.
    pub fn streams(&self) -> (Vec<u8>, Vec<u8>) {
        let mut list = Vec::new();
        let mut notes_list = Vec::new();
        for (i, s) in self.slides.iter().enumerate() {
            list.push(persist_atom(2 + i as u32, 256 + i as u32));
            list.extend(text_atoms(0, &s.title, false));
            if !s.body.is_empty() {
                list.extend(text_atoms(1, &s.body.join("\r"), i % 2 == 1));
            }
            if s.notes.is_some() {
                notes_list.push(persist_atom(1000 + i as u32, 512 + i as u32));
            }
        }
        let doc = container(
            0x03E8,
            0,
            &[
                atom(0x03E9, &[0; 40]),
                container(0x0FF0, 0, &list),
                container(0x0FF0, 2, &notes_list),
            ],
        );
        let mut d = Vec::new();
        let mut offsets: Vec<(u32, u32)> = vec![(1, 0)];
        d.extend_from_slice(&doc);
        for (i, s) in self.slides.iter().enumerate() {
            let mut slide_atom = vec![0u8; 24];
            if s.notes.is_some() {
                set32(&mut slide_atom, 16, 512 + i as u32);
            }
            let mut kids = vec![atom(0x03EF, &slide_atom)];
            if s.hidden {
                let mut info = vec![0u8; 16];
                info[10] = 0x04;
                kids.push(atom(0x03F9, &info));
            }
            let mut shapes = Vec::new();
            if let Some(t) = &s.text_box {
                shapes.push(container(0xF00D, 0, &text_atoms(4, t, false)));
            }
            if s.picture {
                let mut opt = Vec::new();
                put16(&mut opt, 0x4104);
                put32(&mut opt, 1);
                shapes.push(record(3, 1, 0xF00B, &opt));
            }
            kids.push(drawing(shapes));
            offsets.push((2 + i as u32, d.len() as u32));
            d.extend_from_slice(&container(0x03EE, 0, &kids));
            if let Some(n) = &s.notes {
                offsets.push((1000 + i as u32, d.len() as u32));
                let shapes = vec![container(0xF00D, 0, &text_atoms(2, n, false))];
                d.extend_from_slice(&container(
                    0x03F0,
                    0,
                    &[atom(0x03F1, &[0; 8]), drawing(shapes)],
                ));
            }
        }
        let mut dir = Vec::new();
        for (id, off) in &offsets {
            put32(&mut dir, id | (1 << 20));
            put32(&mut dir, *off);
        }
        let dir_at = d.len() as u32;
        d.extend_from_slice(&atom(0x1772, &dir));
        let edit_at = d.len() as u32;
        let mut e = Vec::new();
        put32(&mut e, 256);
        put16(&mut e, 0);
        e.push(0);
        e.push(3);
        put32(&mut e, if self.edit_loops { edit_at } else { 0 });
        put32(&mut e, dir_at);
        put32(&mut e, 1);
        put32(&mut e, 2000);
        put16(&mut e, 1);
        put16(&mut e, 0);
        if self.encrypted {
            put32(&mut e, 3000);
        }
        d.extend_from_slice(&atom(0x0FF5, &e));
        let mut cu = Vec::new();
        put32(&mut cu, 0x14);
        put32(
            &mut cu,
            if self.encrypted {
                0xF3D1_C4DF
            } else {
                0xE391_C05F
            },
        );
        put32(&mut cu, edit_at);
        put16(&mut cu, 4);
        put16(&mut cu, 0x03F4);
        cu.push(3);
        cu.push(0);
        put16(&mut cu, 0);
        cu.extend_from_slice(b"user");
        put32(&mut cu, 8);
        (d, atom(0x0FF6, &cu))
    }

    pub fn build(&self) -> Vec<u8> {
        let (d, cu) = self.streams();
        let s = summary("Tide gauge review", "R. Marsh");
        let mut streams: Vec<(&str, &[u8])> =
            vec![("PowerPoint Document", &d), ("\u{5}SummaryInformation", &s)];
        if self.current_user {
            streams.push(("Current User", &cu));
        }
        compound(&streams, &[])
    }
}

pub fn demo_deck() -> Deck {
    Deck::new(vec![
        Slide {
            title: "Tide gauge review".into(),
            body: vec![
                "North mole gauge drifted 4 cm".into(),
                "Replace the float in March".into(),
            ],
            notes: Some("Mention the winter storms.\rThank the pilots.".into()),
            ..Slide::default()
        },
        Slide {
            title: "Readings by month".into(),
            body: vec!["January: 4.21 m".into(), "February: 4.18 m".into()],
            text_box: Some("Figures from the harbour log".into()),
            picture: true,
            ..Slide::default()
        },
        Slide {
            title: "Spares".into(),
            body: vec!["Two floats, one cable".into()],
            hidden: true,
            ..Slide::default()
        },
    ])
}

fn slide_titles(r: &Reading) -> Vec<(String, u32, bool)> {
    r.blocks
        .iter()
        .filter_map(|b| match b {
            Block::Heading {
                kids,
                slide: Some(s),
                ..
            } => Some((text_of(kids), s.n, s.hidden)),
            _ => None,
        })
        .collect()
}

#[test]
fn a_deck_of_three_slides_lists_three_with_their_titles() {
    let r = read_ok(&demo_deck().build());
    assert_eq!(r.format, "ppt");
    assert_eq!(
        slide_titles(&r),
        [
            ("Tide gauge review".to_string(), 1, false),
            ("Readings by month".to_string(), 2, false),
            ("Spares".to_string(), 3, true)
        ]
    );
    assert_eq!((r.slides, r.hidden_slides, r.speaker_notes), (3, 1, 1));
    let Block::List { items, .. } = &r.blocks[1] else {
        panic!("{:?}", r.blocks[1])
    };
    assert_eq!(items.len(), 2);
    let Block::Aside { who, blocks, .. } = &r.blocks[2] else {
        panic!("{:?}", r.blocks[2])
    };
    assert_eq!(who, "Speaker notes");
    assert_eq!(blocks.len(), 2);
    // Slide 2: its body in 8-bit text, a text box of its own and a picture named.
    let Block::List { items, .. } = &r.blocks[4] else {
        panic!("{:?}", r.blocks[4])
    };
    assert!(matches!(&items[0][0], Block::Para { kids } if text_of(kids) == "January: 4.21 m"));
    assert!(
        matches!(&r.blocks[5], Block::Para { kids } if text_of(kids) == "Figures from the harbour log")
    );
    assert!(matches!(&r.blocks[6], Block::Para { kids } if kids == &[Inline::Image { image: 0 }]));
    assert_eq!(r.props.title.as_deref(), Some("Tide gauge review"));
}

#[test]
fn a_deck_whose_edit_chain_does_not_read_is_found_by_its_records() {
    let mut d = demo_deck();
    d.current_user = false;
    assert_eq!(slide_titles(&read_ok(&d.build())).len(), 3);
    let mut d = demo_deck();
    d.edit_loops = true;
    assert_eq!(slide_titles(&read_ok(&d.build())).len(), 3);
}

#[test]
fn an_encrypted_deck_says_so() {
    let mut d = demo_deck();
    d.encrypted = true;
    let e = read(&d.build(), &Limits::DEFAULT).unwrap_err();
    assert!(
        matches!(&e, Fault::Encrypted(why) if why.contains("deck is encrypted")),
        "{e:?}"
    );
    let s = compound(
        &[
            ("PowerPoint Document", &[0; 64]),
            ("EncryptedSummary", &[0; 64]),
        ],
        &[],
    );
    assert!(matches!(
        read(&s, &Limits::DEFAULT),
        Err(Fault::Encrypted(_))
    ));
}

/// Where the persist directory's entries start in a deck's stream.
fn directory(d: &[u8]) -> usize {
    d.windows(4).rposition(|w| w == [0, 0, 0x72, 0x17]).unwrap() + 8
}

#[test]
fn slides_sharing_one_large_record_stop_at_the_step_budget() {
    let slides: Vec<Slide> = (0..400)
        .map(|i| Slide {
            title: format!("s{i}"),
            ..Slide::default()
        })
        .collect();
    let (mut d, cu) = Deck::new(slides).streams();
    let dir_at = directory(&d);
    // One slide with a drawing of many shapes, which every slide's persist entry is then pointed at.
    let big = container(
        0x03EE,
        0,
        &[drawing((0..2000).map(|_| atom(0xF00A, &[0; 8])).collect())],
    );
    let big_at = d.len() as u32;
    d.extend_from_slice(&big);
    let n = u32::from_le_bytes(d[dir_at - 4..dir_at].try_into().unwrap()) as usize / 8;
    for k in 1..n {
        set32(&mut d, dir_at + 8 * k + 4, big_at);
    }
    let bytes = compound(&[("PowerPoint Document", &d), ("Current User", &cu)], &[]);
    let limits = Limits {
        steps: 200_000,
        ..Limits::DEFAULT
    };
    let started = std::time::Instant::now();
    assert!(matches!(read(&bytes, &limits), Err(Fault::TooBig(_))));
    assert!(started.elapsed().as_secs() < 5);
}

#[test]
fn drawings_nested_past_the_depth_cap_are_cut_not_followed() {
    let mut deep = container(0xF00D, 0, &text_atoms(4, "deep down", false));
    for _ in 0..2_000 {
        deep = container(0xF003, 0, &[deep]);
    }
    let (mut d, _) = Deck::new(vec![Slide {
        title: "One".into(),
        ..Slide::default()
    }])
    .streams();
    let dir_at = directory(&d);
    // Appended as a slide of its own, and the slide's persist entry pointed at it.
    let at = d.len() as u32;
    d.extend_from_slice(&container(0x03EE, 0, &[container(0x040C, 0, &[deep])]));
    set32(&mut d, dir_at + 8 + 4, at);
    let bytes = compound(&[("PowerPoint Document", &d)], &[]);
    let r = read_ok(&bytes);
    assert!(r.cut.iter().any(|c| c.contains("deep")), "{:?}", r.cut);
}

#[test]
fn a_file_or_stream_past_its_cap_is_refused() {
    let bytes = demo_doc().build();
    let small = Limits {
        file: bytes.len() - 1,
        ..Limits::DEFAULT
    };
    assert!(matches!(read(&bytes, &small), Err(Fault::TooBig(_))));
    let small = Limits {
        stream: 1024,
        ..Limits::DEFAULT
    };
    assert!(
        matches!(read(&bytes, &small), Err(Fault::TooBig(why)) if why.contains("WordDocument"))
    );
}

#[test]
fn truncated_and_damaged_files_never_panic_or_hang() {
    for good in [demo_doc().build(), demo_deck().build()] {
        for cut in (0..good.len()).step_by(97) {
            let r = std::panic::catch_unwind(|| {
                read(&good[..cut], &Limits::DEFAULT).map(|r| r.blocks.len())
            });
            assert!(r.is_ok(), "a panic on the first {cut} bytes");
        }
        let mut seed = 0x2545_f491u32;
        for _ in 0..1_500 {
            let mut bad = good.clone();
            for _ in 0..6 {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let at = seed as usize % bad.len();
                bad[at] = (seed >> 8) as u8;
            }
            let r =
                std::panic::catch_unwind(|| read(&bad, &Limits::DEFAULT).map(|r| r.blocks.len()));
            assert!(r.is_ok(), "a panic on damaged bytes");
        }
    }
    assert!(convert(&demo_doc().build()[..2000]).is_err());
}

#[test]
fn damaged_streams_never_panic() {
    // The streams themselves, damaged, inside a sound compound file.
    let (w, t) = demo_doc().streams();
    let (d, cu) = demo_deck().streams();
    let mut seed = 0x9e37_79b9u32;
    for round in 0..600 {
        let (mut a, mut b) = if round % 2 == 0 {
            (w.clone(), t.clone())
        } else {
            (d.clone(), cu.clone())
        };
        for _ in 0..8 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let target = if seed & 1 == 0 { &mut a } else { &mut b };
            let at = (seed >> 1) as usize % target.len();
            target[at] = (seed >> 9) as u8;
        }
        let bytes = if round % 2 == 0 {
            compound(&[("WordDocument", &a), ("1Table", &b)], &[])
        } else {
            compound(&[("PowerPoint Document", &a), ("Current User", &b)], &[])
        };
        let r = std::panic::catch_unwind(|| read(&bytes, &Limits::DEFAULT).map(|r| r.blocks.len()));
        assert!(r.is_ok(), "a panic on a damaged stream");
    }
}

#[test]
fn the_reading_is_the_office_page_shape() {
    let r = read_ok(&demo_deck().build());
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["format"], "ppt");
    assert_eq!(v["blocks"][0]["t"], "heading");
    assert_eq!(v["blocks"][0]["slide"]["n"], 1);
    assert_eq!(v["blocks"][1]["t"], "list");
    assert_eq!(v["blocks"][2]["t"], "aside");
    assert_eq!(v["images"][0]["what"], "held picture");
    assert_eq!(v["hiddenSlides"], 1);
    assert!(v["blocks"][1]["items"][0][0]["kids"][0].get("b").is_none());
}

fn demo_path(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/documents")
        .join(name)
}

#[test]
fn the_demo_document_and_deck_are_what_the_builders_make() {
    for (name, want) in [
        ("harbour-survey-1998.doc", demo_doc().build()),
        ("tide-gauge-review.ppt", demo_deck().build()),
    ] {
        let path = demo_path(name);
        if std::env::var("MARXY_BLESS").is_ok_and(|v| v == "1") {
            std::fs::write(&path, &want).unwrap();
        }
        assert!(
            std::fs::read(&path).unwrap_or_default() == want,
            "{} differs from the builder: run MARXY_BLESS=1 cargo test demo_document",
            path.display()
        );
    }
}

// ---- what hostile files cost ----------------------------------------------------------------------------------------

/// A deck of `slides` slides, every one of them pointed at one slide record holding `kids`.
fn deck_sharing(slides: usize, kids: &[Vec<u8>]) -> Vec<u8> {
    let titles: Vec<Slide> = (0..slides)
        .map(|i| Slide {
            title: format!("s{i}"),
            ..Slide::default()
        })
        .collect();
    let (mut d, cu) = Deck::new(titles).streams();
    let dir_at = directory(&d);
    let n = u32::from_le_bytes(d[dir_at - 4..dir_at].try_into().unwrap()) as usize / 8;
    let at = d.len() as u32;
    d.extend_from_slice(&container(0x03EE, 0, kids));
    for k in 1..n {
        set32(&mut d, dir_at + 8 * k + 4, at);
    }
    compound(&[("PowerPoint Document", &d), ("Current User", &cu)], &[])
}

fn timed(bytes: &[u8], limits: &Limits) -> (Result<(Reading, u64), Fault>, std::time::Duration) {
    let started = std::time::Instant::now();
    let r = read_counted(bytes, limits);
    (r, started.elapsed())
}

#[test]
fn shape_properties_claiming_thousands_each_cost_what_their_bytes_hold() {
    // 200,000 property records that each claim 4,095 properties and hold none: 819 million reads if the claim were
    // believed.
    let props: Vec<Vec<u8>> = (0..200_000)
        .map(|_| record(3, 0xFFF, 0xF00B, &[]))
        .collect();
    let bytes = deck_sharing(1, &[drawing(vec![props.concat()])]);
    let (r, took) = timed(&bytes, &Limits::DEFAULT);
    let (r, steps) = r.unwrap();
    assert_eq!(r.slides, 1);
    assert!(steps < 1_000_000, "{steps} steps");
    assert!(took.as_secs() < 5, "{took:?}");
}

#[test]
fn one_large_text_shared_by_every_slide_is_decoded_only_while_there_is_room() {
    // A text box of a million characters, which 400 slides all point at: 400 million characters to decode unchecked.
    let big = container(0xF00D, 0, &text_atoms(4, &"w".repeat(1_000_000), false));
    let bytes = deck_sharing(400, &[drawing(vec![big])]);
    let (r, took) = timed(&bytes, &Limits::DEFAULT);
    let (r, steps) = r.unwrap();
    assert!(r.cut.iter().any(|c| c.contains("runs past")), "{:?}", r.cut);
    assert!(steps < 20_000_000, "{steps} steps");
    assert!(took.as_secs() < 20, "{took:?}");
}

#[test]
fn many_distinct_text_boxes_on_a_slide_are_told_apart_in_linear_time() {
    // 100,000 different text boxes: 5 billion comparisons if each were checked against all before it.
    let boxes: Vec<Vec<u8>> = (0..100_000)
        .map(|i| container(0xF00D, 0, &text_atoms(4, &format!("b{i}"), false)))
        .collect();
    let bytes = deck_sharing(1, &[drawing(boxes)]);
    let (r, took) = timed(&bytes, &Limits::DEFAULT);
    let (r, steps) = r.unwrap();
    assert_eq!(r.blocks.len(), 1 + 100_000);
    assert!(steps < 2_000_000, "{steps} steps");
    assert!(took.as_secs() < 10, "{took:?}");
}

#[test]
fn a_property_page_named_a_million_times_is_read_once() {
    let (w, t) = demo_doc().streams();
    let fc = u32::from_le_bytes(w[154 + 13 * 8..154 + 13 * 8 + 4].try_into().unwrap()) as usize;
    let lcb = u32::from_le_bytes(w[158 + 13 * 8..158 + 13 * 8 + 4].try_into().unwrap()) as usize;
    let bte = &t[fc..fc + lcb];
    let pages = (lcb - 4) / 8;
    let first_pn = u32::from_le_bytes(
        bte[4 * (pages + 1)..4 * (pages + 1) + 4]
            .try_into()
            .unwrap(),
    );
    let once = super::doc::paragraph_runs(&w, bte, &mut Out::new(&Limits::DEFAULT)).unwrap();
    // The same page, named a million times.
    let n = 1_000_000;
    let mut plc = Vec::with_capacity(8 * n + 4);
    for _ in 0..=n {
        put32(&mut plc, 0);
    }
    for _ in 0..n {
        put32(&mut plc, first_pn);
    }
    let mut out = Out::new(&Limits::DEFAULT);
    let runs = super::doc::paragraph_runs(&w, &plc, &mut out).unwrap();
    assert!(runs <= 12 && runs > 0 && runs <= once, "{runs} runs held");
    assert!(out.steps < 1_100_000, "{} steps", out.steps);
}

#[test]
fn line_breaks_count_against_the_text_cap() {
    let mut w = Word::default();
    for _ in 0..20_000 {
        w = w.raw(0x0B);
    }
    let w = w.text("end", &[]).para(NORMAL, &[]);
    let limits = Limits {
        chars: 1_000,
        ..Limits::DEFAULT
    };
    let r = read(&w.build(), &limits).unwrap();
    let brs: usize = r
        .blocks
        .iter()
        .map(|b| match b {
            Block::Para { kids } => kids.iter().filter(|k| matches!(k, Inline::Br)).count(),
            _ => 0,
        })
        .sum();
    assert!(brs <= 1_000, "{brs} breaks");
    assert!(r.cut.iter().any(|c| c.contains("runs past")));
}

#[test]
fn a_flood_of_paragraphs_stops_at_the_paragraph_cap() {
    let limits = Limits {
        nodes: 1_000,
        ..Limits::DEFAULT
    };
    let mut w = Word::default();
    for _ in 0..5_000 {
        w = w.p("a");
    }
    let (r, took) = timed(&w.build(), &limits);
    let (r, _) = r.unwrap();
    assert!(r.blocks.len() <= 1_000, "{} blocks", r.blocks.len());
    assert!(
        r.cut.iter().any(|c| c.contains("line breaks")),
        "{:?}",
        r.cut
    );
    assert!(took.as_secs() < 5);
    // Empty paragraphs cost a mark each too.
    let mut w = Word::default();
    for _ in 0..50_000 {
        w = w.para(NORMAL, &[]);
    }
    let r = read(&w.build(), &limits).unwrap();
    assert!(
        r.cut.iter().any(|c| c.contains("line breaks")),
        "{:?}",
        r.cut
    );
    // And a slide's text of many short lines.
    let text = container(0xF00D, 0, &text_atoms(4, &"a\r".repeat(5_000), false));
    let r = read(&deck_sharing(1, &[drawing(vec![text])]), &limits).unwrap();
    assert!(r.blocks.len() <= 1_001, "{} blocks", r.blocks.len());
    assert!(
        r.cut.iter().any(|c| c.contains("line breaks")),
        "{:?}",
        r.cut
    );
}

#[test]
fn a_container_of_millions_of_records_is_walked_not_gathered() {
    // Two million empty records inside one slide: walked one at a time and charged a step each.
    let atoms = vec![0u8; 8 * 2_000_000];
    let bytes = deck_sharing(1, &[container(0x1000, 0, &[atoms])]);
    let (r, took) = timed(&bytes, &Limits::DEFAULT);
    let (_, steps) = r.unwrap();
    assert!((2_000_000..2_100_000).contains(&steps), "{steps} steps");
    assert!(took.as_secs() < 10, "{took:?}");
    let few = Limits {
        steps: 100_000,
        ..Limits::DEFAULT
    };
    assert!(matches!(read(&bytes, &few), Err(Fault::TooBig(_))));
}

#[test]
fn a_1_or_an_8_is_a_picture_only_where_word_marks_it_special() {
    let w = Word::default()
        .raw(0x01)
        .raw(0x08)
        .text("text", &[])
        .text("\u{1}", SPEC)
        .para(NORMAL, &[]);
    let r = read_ok(&w.build());
    assert_eq!(r.images.len(), 1);
}

fn breaks(r: &Reading) -> usize {
    fn count(kids: &[Inline]) -> usize {
        kids.iter().filter(|k| matches!(k, Inline::Br)).count()
    }
    r.blocks
        .iter()
        .map(|b| match b {
            Block::Para { kids } | Block::Heading { kids, .. } => count(kids),
            Block::List { items, .. } => items
                .iter()
                .flatten()
                .map(|b| match b {
                    Block::Para { kids } => count(kids),
                    _ => 0,
                })
                .sum(),
            _ => 0,
        })
        .sum()
}

#[test]
fn sixteen_million_line_breaks_stop_at_the_paragraph_cap() {
    let n = 16_000_000;
    let mut w = Word::default()
        .text("start", &[])
        .text(&"\u{b}".repeat(n), &[])
        .para(NORMAL, &[]);
    w.eight_bit = w.units.len();
    let (r, took) = timed(&w.build(), &Limits::DEFAULT);
    let (r, _) = r.unwrap();
    assert!(breaks(&r) <= Limits::DEFAULT.nodes, "{} breaks", breaks(&r));
    assert!(
        r.cut.iter().any(|c| c.contains("line breaks")),
        "{:?}",
        r.cut
    );
    assert!(took.as_secs() < 60, "{took:?}");

    let text = container(
        0xF00D,
        0,
        &text_atoms(4, &format!("start{}", "\u{b}".repeat(n)), true),
    );
    let (r, took) = timed(&deck_sharing(1, &[drawing(vec![text])]), &Limits::DEFAULT);
    let (r, _) = r.unwrap();
    assert!(breaks(&r) <= Limits::DEFAULT.nodes, "{} breaks", breaks(&r));
    assert!(
        r.cut.iter().any(|c| c.contains("line breaks")),
        "{:?}",
        r.cut
    );
    assert!(took.as_secs() < 60, "{took:?}");
}
