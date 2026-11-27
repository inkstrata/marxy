//! A PowerPoint 97-2003 deck (MS-PPT): the Current User stream points at the last edit, each edit at the one before and
//! at its persist directory, and the directory, newest entry first, says where the document and each slide lie in the
//! PowerPoint Document stream. A deck whose edit chain does not read is scanned record by record instead, top level only.
//! The slides are listed in the document's slide list, each followed by its placeholders' text (title, body); a slide's
//! own text boxes and pictures are read from its drawing, and its speaker notes from its notes page.

use std::collections::{HashMap, HashSet};
use std::iter::FusedIterator;

use super::{trim, u16_at, u32_at, Block, Fault, Fmt, Inline, Line, Out, SlideMark, Store};

const CURRENT_USER: u16 = 0x0FF6;
const USER_EDIT: u16 = 0x0FF5;
const PERSIST_DIRECTORY: u16 = 0x1772;
const DOCUMENT: u16 = 0x03E8;
const SLIDE_LIST: u16 = 0x0FF0;
const SLIDE_PERSIST: u16 = 0x03F3;
const SLIDE: u16 = 0x03EE;
const NOTES: u16 = 0x03F0;
const SLIDE_ATOM: u16 = 0x03EF;
const SLIDE_SHOW_INFO: u16 = 0x03F9;
const TEXT_HEADER: u16 = 0x0F9F;
const TEXT_CHARS: u16 = 0x0FA0;
const TEXT_BYTES: u16 = 0x0FA8;
const EX_OBJ_LIST: u16 = 0x0409;
const VBA_INFO: u16 = 0x03FF;
const CLIENT_TEXTBOX: u16 = 0xF00D;
const SHAPE_PROPERTIES: u16 = 0xF00B;

const HEADER_TOKEN_ENCRYPTED: u32 = 0xF3D1_C4DF;
/// Edits followed back from the last one.
const EDITS: usize = 10_000;

const TITLE: u32 = 0;
const BODY: u32 = 1;
const NOTES_TEXT: u32 = 2;
const CENTER_BODY: u32 = 5;
const CENTER_TITLE: u32 = 6;
const HALF_BODY: u32 = 7;
const QUARTER_BODY: u32 = 8;

fn encrypted() -> Fault {
    Fault::Encrypted(
        "The deck is encrypted with a password: its slides cannot be read, and Marxy does not unlock files."
            .into(),
    )
}

#[derive(Clone, Copy)]
struct Rec {
    inst: u16,
    ty: u16,
    container: bool,
    body: usize,
    end: usize,
}

/// The record at `at`, when it ends inside `end`.
fn rec(b: &[u8], at: usize, end: usize) -> Option<Rec> {
    let h = u16_at(b, at)?;
    let ty = u16_at(b, at + 2)?;
    let len = u32_at(b, at + 4)? as usize;
    let body = at + 8;
    let stop = body.checked_add(len)?;
    (stop <= end.min(b.len())).then_some(Rec {
        inst: h >> 4,
        ty,
        container: h & 0xF == 0xF,
        body,
        end: stop,
    })
}

/// The records inside a container, read as they are walked, never gathered: a container can hold millions. Each caller
/// charges a step for each. A record that runs past its container ends the walk.
struct Kids<'d> {
    b: &'d [u8],
    at: usize,
    end: usize,
}

impl Iterator for Kids<'_> {
    type Item = Rec;
    fn next(&mut self) -> Option<Rec> {
        if self.at + 8 > self.end {
            return None;
        }
        let Some(k) = rec(self.b, self.at, self.end) else {
            self.at = self.end;
            return None;
        };
        self.at = k.end;
        Some(k)
    }
}

impl FusedIterator for Kids<'_> {}

fn kids(b: &[u8], r: Rec) -> Kids<'_> {
    Kids {
        b,
        at: r.body,
        end: r.end,
    }
}

/// The persist directory: newest edit first, so the first offset found for an id is the one that counts.
fn persist(
    cu: Option<&[u8]>,
    d: &[u8],
    out: &mut Out,
) -> Result<(HashMap<u32, u32>, Option<u32>), Fault> {
    let mut map = HashMap::new();
    let mut doc = None;
    if let Some(cu) = cu.and_then(|cu| {
        rec(cu, 0, cu.len())
            .filter(|r| r.ty == CURRENT_USER)
            .map(|r| (cu, r))
    }) {
        let (cu, r) = cu;
        if u32_at(cu, r.body + 4) == Some(HEADER_TOKEN_ENCRYPTED) {
            return Err(encrypted());
        }
        let mut at = u32_at(cu, r.body + 8).unwrap_or(0) as usize;
        let mut seen = HashSet::new();
        let mut first = true;
        while seen.len() < EDITS && seen.insert(at) {
            out.step(1)?;
            let Some(e) =
                rec(d, at, d.len()).filter(|e| e.ty == USER_EDIT && e.end - e.body >= 0x1C)
            else {
                break;
            };
            if first {
                // Only an encrypted deck's edit carries the reference to its encryption session.
                if e.end - e.body >= 0x20 && u32_at(d, e.body + 0x1C).is_some_and(|v| v != 0) {
                    return Err(encrypted());
                }
                doc = u32_at(d, e.body + 16);
                first = false;
            }
            if let Some(dir) = u32_at(d, e.body + 12).and_then(|o| rec(d, o as usize, d.len())) {
                if dir.ty == PERSIST_DIRECTORY {
                    entries(d, dir, &mut map, false, out)?;
                }
            }
            match u32_at(d, e.body + 8) {
                Some(0) | None => break,
                Some(prev) => at = prev as usize,
            }
        }
    }
    Ok((map, doc))
}

fn entries(
    d: &[u8],
    dir: Rec,
    map: &mut HashMap<u32, u32>,
    newer: bool,
    out: &mut Out,
) -> Result<(), Fault> {
    let mut at = dir.body;
    while let Some(h) = u32_at(d, at).filter(|_| at + 4 <= dir.end) {
        at += 4;
        let (id, count) = (h & 0x000F_FFFF, h >> 20);
        out.step(u64::from(count) + 1)?;
        for k in 0..count {
            let Some(off) = u32_at(d, at).filter(|_| at + 4 <= dir.end) else {
                return Ok(());
            };
            at += 4;
            if newer {
                map.insert(id + k, off);
            } else {
                map.entry(id + k).or_insert(off);
            }
        }
    }
    Ok(())
}

/// What a scan of the top-level records found: the persist directories, newest last, the last edit's document, and the
/// last document record.
struct Scanned {
    map: HashMap<u32, u32>,
    doc_ref: Option<u32>,
    last_doc: Option<usize>,
}

/// The top-level records of the stream, in order: what a deck whose edit chain does not read is found from.
fn scan(d: &[u8], out: &mut Out) -> Result<Scanned, Fault> {
    let mut map = HashMap::new();
    let mut doc_ref = None;
    let mut last_doc = None;
    let mut at = 0usize;
    while at + 8 <= d.len() {
        out.step(1)?;
        let Some(r) = rec(d, at, d.len()) else { break };
        match r.ty {
            PERSIST_DIRECTORY => entries(d, r, &mut map, true, out)?,
            USER_EDIT => doc_ref = u32_at(d, r.body + 16),
            DOCUMENT => last_doc = Some(at),
            _ => {}
        }
        at = r.end;
    }
    Ok(Scanned {
        map,
        doc_ref,
        last_doc,
    })
}

struct Entry {
    persist: u32,
    id: u32,
    texts: Vec<(u32, String)>,
}

/// A text atom's characters: UTF-16, or one byte each for the first 256 code points. Charged before it is decoded, so
/// an atom many slides point at is decoded only while there is room for it.
fn text_of(d: &[u8], r: Rec, out: &mut Out) -> Result<Option<String>, Fault> {
    let Some(body) = d.get(r.body..r.end) else {
        return Ok(None);
    };
    let units = if r.ty == TEXT_CHARS {
        body.len() / 2
    } else {
        body.len()
    };
    out.step(1)?;
    if !out.room(units) {
        return Ok(None);
    }
    out.step(units as u64)?;
    let s = match r.ty {
        TEXT_CHARS => String::from_utf16_lossy(
            &body
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16::from_le_bytes(*c))
                .collect::<Vec<_>>(),
        ),
        TEXT_BYTES => body.iter().map(|&b| char::from(b)).collect(),
        _ => return Ok(None),
    };
    Ok(Some(s))
}

/// The slide list: each slide (or notes page) with the placeholder text that follows its persist atom.
fn slide_list(d: &[u8], list: Rec, out: &mut Out) -> Result<Vec<Entry>, Fault> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut ty = 4;
    for k in kids(d, list) {
        out.step(1)?;
        match k.ty {
            SLIDE_PERSIST => {
                if entries.len() >= out.limits.slides {
                    out.cut(format!(
                        "The deck has more than {} slides: those past them are not read.",
                        out.limits.slides
                    ));
                    break;
                }
                entries.push(Entry {
                    persist: u32_at(d, k.body).unwrap_or(u32::MAX),
                    id: u32_at(d, k.body + 12).unwrap_or(0),
                    texts: Vec::new(),
                });
            }
            TEXT_HEADER => ty = u32_at(d, k.body).unwrap_or(4),
            TEXT_CHARS | TEXT_BYTES => {
                if entries.is_empty() {
                    continue;
                }
                if let (Some(t), Some(e)) = (text_of(d, k, out)?, entries.last_mut()) {
                    e.texts.push((ty, t));
                }
            }
            _ => {}
        }
    }
    Ok(entries)
}

/// What a slide's or a notes page's own record holds: its notes page, whether it is hidden, and its drawing's text
/// boxes and pictures (as `None`), in the order the drawing lists them.
#[derive(Default)]
struct Page {
    notes_ref: u32,
    hidden: bool,
    drawn: Vec<Option<(u32, String)>>,
}

fn page(d: &[u8], at: Option<&u32>, want: u16, out: &mut Out) -> Result<Page, Fault> {
    let mut p = Page::default();
    let Some(r) = at
        .and_then(|&o| rec(d, o as usize, d.len()))
        .filter(|r| r.ty == want)
    else {
        return Ok(p);
    };
    for k in kids(d, r) {
        out.step(1)?;
        match k.ty {
            SLIDE_ATOM => p.notes_ref = u32_at(d, k.body + 16).unwrap_or(0),
            SLIDE_SHOW_INFO => p.hidden = u16_at(d, k.body + 10).is_some_and(|f| f & 0x0004 != 0),
            _ if k.container => drawing(d, k, 1, &mut p.drawn, out)?,
            _ => {}
        }
    }
    Ok(p)
}

fn drawing(
    d: &[u8],
    r: Rec,
    depth: usize,
    into: &mut Vec<Option<(u32, String)>>,
    out: &mut Out,
) -> Result<(), Fault> {
    if depth > out.limits.depth {
        out.cut(format!(
            "A slide's drawing nests shapes more than {} deep: those deeper are not read.",
            out.limits.depth
        ));
        return Ok(());
    }
    let mut ty = 4;
    for k in kids(d, r) {
        out.step(1)?;
        match k.ty {
            _ if k.container => drawing(d, k, depth + 1, into, out)?,
            TEXT_HEADER if r.ty == CLIENT_TEXTBOX => ty = u32_at(d, k.body).unwrap_or(4),
            TEXT_CHARS | TEXT_BYTES if r.ty == CLIENT_TEXTBOX => {
                if let Some(t) = text_of(d, k, out)? {
                    into.push(Some((ty, t)));
                }
            }
            SHAPE_PROPERTIES => {
                // A blip property (pib): the shape is a picture. The count is the record's word; the bytes say how many
                // six-byte properties there can be.
                let n = (k.inst as usize).min((k.end - k.body) / 6);
                out.step(n as u64)?;
                let picture = (0..n)
                    .any(|i| u16_at(d, k.body + 6 * i).is_some_and(|op| op & 0x3FFF == 0x0104));
                if picture {
                    into.push(None);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// A text's paragraphs, each its inlines: paragraphs end at a carriage return, lines at a vertical tab. Each one is
/// charged to the paragraph cap, and none is made past it.
fn paragraphs(s: &str, out: &mut Out) -> Vec<Vec<Inline>> {
    let mut paras = Vec::new();
    for p in s.split('\r') {
        let mut stop = false;
        let kids = {
            let mut line = Line::default();
            let plain = Fmt::default();
            for c in p.chars() {
                match c {
                    // A break is charged as a paragraph is: one text of bare breaks would otherwise be millions.
                    '\u{0B}' => {
                        if !out.node() {
                            stop = true;
                            break;
                        }
                        line.inline(Inline::Br);
                    }
                    '\t' => line.push(0x09, &plain),
                    c if (c as u32) < 0x20 => {}
                    c => {
                        let mut buf = [0u16; 2];
                        for u in c.encode_utf16(&mut buf) {
                            line.push(*u, &plain);
                        }
                    }
                }
            }
            line.take()
        };
        if stop {
            if !kids.is_empty() {
                paras.push(kids);
            }
            break;
        }
        if kids.is_empty() {
            continue;
        }
        if !out.node() {
            break;
        }
        paras.push(kids);
    }
    paras
}

pub struct Deck {
    pub blocks: Vec<Block>,
    pub slides: u32,
    pub hidden: u32,
    pub notes: u32,
}

pub fn read(store: &mut Store, out: &mut Out) -> Result<Deck, Fault> {
    if store.has("EncryptedSummary") {
        return Err(encrypted());
    }
    let cu = store.stream("Current User", 64 * 1024)?;
    let d = store
        .stream("PowerPoint Document", u64::MAX)?
        .ok_or(Fault::Damaged)?;
    if store.has("Pictures") {
        out.leave("pictures");
    }
    let (mut map, doc_ref) = persist(cu.as_deref(), &d, out)?;
    let mut doc = doc_ref
        .and_then(|r| map.get(&r))
        .and_then(|&o| rec(&d, o as usize, d.len()))
        .filter(|r| r.ty == DOCUMENT);
    if doc.is_none() {
        let found = scan(&d, out)?;
        map = found.map;
        doc = found
            .doc_ref
            .and_then(|r| map.get(&r))
            .and_then(|&o| rec(&d, o as usize, d.len()))
            .filter(|r| r.ty == DOCUMENT)
            .or_else(|| found.last_doc.and_then(|at| rec(&d, at, d.len())));
    }
    let doc = doc.ok_or(Fault::Damaged)?;
    let mut slides = Vec::new();
    let mut notes = Vec::new();
    for k in kids(&d, doc) {
        out.step(1)?;
        match (k.ty, k.inst) {
            (SLIDE_LIST, 0) => slides = slide_list(&d, k, out)?,
            (SLIDE_LIST, 2) => notes = slide_list(&d, k, out)?,
            (EX_OBJ_LIST, _) => out.leave("embedded objects"),
            (VBA_INFO, _) => out.leave("macros"),
            _ => {}
        }
    }
    let notes: HashMap<u32, Entry> = notes.into_iter().map(|e| (e.id, e)).collect();
    let mut deck = Deck {
        blocks: Vec::new(),
        slides: 0,
        hidden: 0,
        notes: 0,
    };
    for (i, s) in slides.into_iter().enumerate() {
        let p = page(&d, map.get(&s.persist), SLIDE, out)?;
        let mut texts = s.texts;
        // A placeholder's text can be in the slide list and in the drawing too: shown once.
        let mut have: HashSet<String> = texts.iter().map(|(_, t)| t.clone()).collect();
        let mut pictures = Vec::new();
        for drawn in p.drawn {
            match drawn {
                Some(t) => {
                    if have.insert(t.1.clone()) {
                        texts.push(t);
                    }
                }
                None => pictures.extend(out.image("held picture", String::new())),
            }
        }
        let title = texts
            .iter()
            .position(|(ty, _)| matches!(*ty, TITLE | CENTER_TITLE));
        let mut kids = Vec::new();
        if let Some(t) = title.map(|t| texts.remove(t).1) {
            for (n, para) in paragraphs(&t, out).into_iter().enumerate() {
                if n > 0 {
                    kids.push(Inline::Run {
                        text: " ".into(),
                        b: false,
                        i: false,
                        s: false,
                    });
                }
                kids.extend(para);
            }
        }
        deck.slides += 1;
        deck.hidden += u32::from(p.hidden);
        deck.blocks.push(Block::Heading {
            level: 2,
            kids: trim(kids),
            slide: Some(SlideMark {
                n: i as u32 + 1,
                hidden: p.hidden,
            }),
        });
        let mut items = Vec::new();
        for (ty, t) in texts {
            let body = matches!(ty, BODY | CENTER_BODY | HALF_BODY | QUARTER_BODY);
            for para in paragraphs(&t, out) {
                if body {
                    items.push(vec![Block::Para { kids: para }]);
                } else {
                    if !items.is_empty() {
                        deck.blocks.push(list(std::mem::take(&mut items)));
                    }
                    deck.blocks.push(Block::Para { kids: para });
                }
            }
            if !body && !items.is_empty() {
                deck.blocks.push(list(std::mem::take(&mut items)));
            }
        }
        if !items.is_empty() {
            deck.blocks.push(list(items));
        }
        for picture in pictures {
            deck.blocks.push(Block::Para {
                kids: vec![picture],
            });
        }
        if let Some(n) = (p.notes_ref != 0)
            .then(|| notes.get(&p.notes_ref))
            .flatten()
        {
            let np = page(&d, map.get(&n.persist), NOTES, out)?;
            let mut said: Vec<String> = Vec::new();
            let mut have = HashSet::new();
            let listed = n.texts.iter().map(|(ty, t)| (*ty, t.clone()));
            for (ty, t) in listed.chain(np.drawn.into_iter().flatten()) {
                if ty == NOTES_TEXT && have.insert(t.clone()) {
                    said.push(t);
                }
            }
            let mut blocks = Vec::new();
            for t in &said {
                blocks.extend(
                    paragraphs(t, out)
                        .into_iter()
                        .map(|kids| Block::Para { kids }),
                );
            }
            if !blocks.is_empty() {
                deck.notes += 1;
                deck.blocks.push(Block::Aside {
                    who: "Speaker notes".into(),
                    when: None,
                    blocks,
                });
            }
        }
    }
    Ok(deck)
}

fn list(items: Vec<Vec<Block>>) -> Block {
    Block::List {
        ordered: false,
        start: 1,
        items,
    }
}
