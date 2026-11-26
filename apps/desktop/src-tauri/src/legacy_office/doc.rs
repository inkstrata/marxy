//! A Word 97-2003 document (MS-DOC): the WordDocument stream's FIB says which table stream holds the piece table (the
//! CLX), and the pieces say where each run of the main text lies, 8-bit in Windows-1252 or UTF-16. Paragraph marks end
//! paragraphs; a paragraph's properties (its style, outline level, list and table flags) come from the PAPX pages and a
//! run's bold, italic, struck and hidden from the CHPX pages, both looked up by the byte the text sits at. A field shows
//! its result, never its code, and is never evaluated; a link field's result is a link.

use std::collections::HashSet;
use std::sync::OnceLock;

use super::{u16_at, u32_at, Block, Fault, Fmt, Inline, Line, Out, Store};

const W_IDENT: u16 = 0xA5EC;
/// Word 6 and 95 wrote this mark, and a FIB of another shape.
const W_IDENT_95: u16 = 0xA5DC;
/// The first FIB version Word 97 wrote; Word 6 and 95 wrote 101 to 105.
const NFIB_97: u16 = 0x00C0;

const F_ENCRYPTED: u16 = 0x0100;
const F_WHICH_TABLE: u16 = 0x0200;
const F_OBFUSCATED: u16 = 0x8000;

/// Pairs of the FIB's offset and size table this reads.
const STSHF: usize = 1;
const PLCF_BTE_CHPX: usize = 12;
const PLCF_BTE_PAPX: usize = 13;
const CLX: usize = 33;

/// Fields nested deeper than this are read as text of the field they sit in.
const FIELD_DEPTH: usize = 256;
/// What of a field's code is kept to tell a link field from another.
const FIELD_CODE: usize = 2048;

struct Fib {
    flags: u16,
    /// fibRgLw: ccpText is the fourth, then ccpFtn, ccpHdd, a reserved one, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx.
    lw: Vec<u32>,
    fclcb: Vec<(u32, u32)>,
}

impl Fib {
    fn lw(&self, i: usize) -> u32 {
        self.lw.get(i).copied().unwrap_or(0)
    }

    /// The bytes of table entry `i` in the table stream `t`, when it has any.
    fn part<'t>(&self, t: &'t [u8], i: usize) -> Option<&'t [u8]> {
        let (fc, lcb) = *self.fclcb.get(i)?;
        if lcb == 0 {
            return None;
        }
        t.get(fc as usize..(fc as usize).checked_add(lcb as usize)?)
    }
}

fn fib(w: &[u8]) -> Result<Fib, Fault> {
    let bad = || Fault::Damaged;
    let ident = u16_at(w, 0).ok_or_else(bad)?;
    let n_fib = u16_at(w, 2).ok_or_else(bad)?;
    if ident == W_IDENT_95 || (ident == W_IDENT && n_fib < NFIB_97) {
        return Err(Fault::Not(
            "It is a Word document from Word 95 or earlier, a format Marxy does not read: only Word 97 and later are."
                .into(),
        ));
    }
    if ident != W_IDENT {
        return Err(bad());
    }
    let flags = u16_at(w, 0x0A).ok_or_else(bad)?;
    if flags & (F_ENCRYPTED | F_OBFUSCATED) != 0 {
        return Err(Fault::Encrypted(
            "The document is encrypted with a password: its text cannot be read, and Marxy does not unlock files."
                .into(),
        ));
    }
    let csw = u16_at(w, 32).ok_or_else(bad)? as usize;
    let at = 34 + csw * 2;
    let cslw = u16_at(w, at).ok_or_else(bad)? as usize;
    let lw: Vec<u32> = (0..cslw)
        .map(|i| u32_at(w, at + 2 + 4 * i))
        .collect::<Option<_>>()
        .ok_or_else(bad)?;
    let at = at + 2 + 4 * cslw;
    let cb = u16_at(w, at).ok_or_else(bad)? as usize;
    let fclcb: Vec<(u32, u32)> = (0..cb)
        .map(|i| Some((u32_at(w, at + 2 + 8 * i)?, u32_at(w, at + 6 + 8 * i)?)))
        .collect::<Option<_>>()
        .ok_or_else(bad)?;
    if lw.len() < 4 || fclcb.len() <= CLX {
        return Err(bad());
    }
    Ok(Fib { flags, lw, fclcb })
}

struct Piece {
    cp: u32,
    end: u32,
    fc: u32,
    compressed: bool,
}

/// The piece table: from the CLX, past any property runs (Prc) before it.
fn pieces(clx: &[u8], out: &mut Out) -> Result<Vec<Piece>, Fault> {
    let bad = || Fault::Damaged;
    let mut at = 0usize;
    let plc = loop {
        out.step(1)?;
        match clx.get(at) {
            Some(1) => {
                let cb = u16_at(clx, at + 1).ok_or_else(bad)? as i16;
                if cb < 0 {
                    return Err(bad());
                }
                at += 3 + cb as usize;
            }
            Some(2) => {
                let lcb = u32_at(clx, at + 1).ok_or_else(bad)? as usize;
                break clx.get(at + 5..at + 5 + lcb).ok_or_else(bad)?;
            }
            _ => return Err(bad()),
        }
    };
    if plc.len() < 16 || (plc.len() - 4) % 12 != 0 {
        return Err(bad());
    }
    let n = (plc.len() - 4) / 12;
    let mut list = Vec::with_capacity(n);
    for i in 0..n {
        out.step(1)?;
        let cp = u32_at(plc, 4 * i).ok_or_else(bad)?;
        let end = u32_at(plc, 4 * i + 4).ok_or_else(bad)?;
        if end < cp {
            return Err(bad());
        }
        let raw = u32_at(plc, 4 * (n + 1) + 8 * i + 2).ok_or_else(bad)?;
        let compressed = raw & 0x4000_0000 != 0;
        let fc = raw & 0x3FFF_FFFF;
        list.push(Piece {
            cp,
            end,
            fc: if compressed { fc / 2 } else { fc },
            compressed,
        });
    }
    Ok(list)
}

/// Windows-1252 for an 8-bit piece's bytes: every one of them is a character of the Basic Multilingual Plane.
fn cp1252() -> &'static [u16; 256] {
    static T: OnceLock<[u16; 256]> = OnceLock::new();
    T.get_or_init(|| {
        let all: Vec<u8> = (0..=255u8).collect();
        let (s, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(&all);
        let mut t = [0u16; 256];
        for (i, c) in s.chars().take(256).enumerate() {
            t[i] = c as u16;
        }
        t
    })
}

/// Each `grpprl` property (sprm) with its operand. A property of a size this cannot tell ends the list.
fn sprms(g: &[u8], mut each: impl FnMut(u16, &[u8])) {
    let mut at = 0usize;
    while let Some(op) = u16_at(g, at) {
        at += 2;
        let size = match op >> 13 {
            0 | 1 => 1,
            2 | 4 | 5 => 2,
            3 => 4,
            7 => 3,
            _ => match op {
                // sprmTDefTable and sprmTDefTable10 carry a two-byte size, one more than what follows.
                0xD608 | 0xD606 => {
                    let Some(cb) = u16_at(g, at) else { return };
                    at += 2;
                    (cb as usize).saturating_sub(1)
                }
                // sprmPChgTabs says 255 when its size is in its own fields; nothing after it is needed here.
                0xC615 if g.get(at) == Some(&255) => return,
                _ => {
                    let Some(&cb) = g.get(at) else { return };
                    at += 1;
                    cb as usize
                }
            },
        };
        let Some(arg) = g.get(at..at + size) else {
            return;
        };
        each(op, arg);
        at += size;
    }
}

#[derive(Clone, Default)]
struct Chp {
    fmt: Fmt,
    vanish: bool,
    /// The character is a special one (fSpec): a 1 or an 8 is then a picture or a drawing, not text.
    spec: bool,
}

#[derive(Clone, Default)]
struct Pap {
    istd: u16,
    in_table: bool,
    ttp: bool,
    inner_cell: bool,
    inner_ttp: bool,
    itap: i32,
    outline: Option<u8>,
    ilfo: u16,
}

/// A toggle property: 1 sets it, 0x81 sets the opposite of the style's (which this does not read, so on).
fn toggle(arg: &[u8]) -> bool {
    matches!(arg.first(), Some(1 | 0x81))
}

fn chp(g: &[u8]) -> Chp {
    let mut c = Chp::default();
    sprms(g, |op, arg| match op {
        0x0835 => c.fmt.b = toggle(arg),
        0x0836 => c.fmt.i = toggle(arg),
        0x0837 => c.fmt.s = toggle(arg),
        0x083C => c.vanish = toggle(arg),
        0x0855 => c.spec = arg.first().is_some_and(|&v| v != 0),
        _ => {}
    });
    c
}

fn pap(istd: u16, g: &[u8]) -> Pap {
    let mut p = Pap {
        istd,
        ..Pap::default()
    };
    let on = |arg: &[u8]| arg.first().is_some_and(|&v| v != 0);
    sprms(g, |op, arg| match op {
        0x2416 => p.in_table = on(arg),
        0x2417 => p.ttp = on(arg),
        0x244B => p.inner_cell = on(arg),
        0x244C => p.inner_ttp = on(arg),
        0x6649 => p.itap = u32_at(arg, 0).unwrap_or(0) as i32,
        0x2640 => p.outline = arg.first().copied(),
        0x460B => p.ilfo = u16_at(arg, 0).unwrap_or(0),
        _ => {}
    });
    p
}

/// Properties by the byte range of the WordDocument stream they cover, found by the byte.
struct Runs<T> {
    starts: Vec<u32>,
    list: Vec<(u32, u32, T)>,
}

impl<T> Runs<T> {
    fn new(mut list: Vec<(u32, u32, T)>) -> Self {
        list.sort_by_key(|r| r.0);
        Runs {
            starts: list.iter().map(|r| r.0).collect(),
            list,
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.list.len()
    }

    fn at(&self, fc: u32) -> Option<&T> {
        let i = self.starts.partition_point(|&s| s <= fc).checked_sub(1)?;
        let (_, end, v) = &self.list[i];
        (fc < *end).then_some(v)
    }
}

/// The formatted-disk pages a bin table (PlcfBteChpx or PlcfBtePapx) points at, each run read with `each`, which says
/// how many bytes of properties it read. A page the table names again is read once.
fn pages<T>(
    w: &[u8],
    plc: Option<&[u8]>,
    out: &mut Out,
    each: impl Fn(&[u8], usize, usize) -> Option<(T, usize)>,
) -> Result<Runs<T>, Fault> {
    let mut list = Vec::new();
    let Some(plc) = plc else {
        return Ok(Runs::new(list));
    };
    let n = plc.len().saturating_sub(4) / 8;
    let mut seen = HashSet::new();
    for i in 0..n {
        out.step(1)?;
        let Some(pn) = u32_at(plc, 4 * (n + 1) + 4 * i) else {
            break;
        };
        let pn = pn & 0x003F_FFFF;
        if !seen.insert(pn) {
            continue;
        }
        let at = pn as usize * 512;
        let Some(page) = w.get(at..at + 512) else {
            continue;
        };
        let crun = page[511] as usize;
        for j in 0..crun {
            out.step(1)?;
            let (Some(start), Some(end)) = (u32_at(page, 4 * j), u32_at(page, 4 * j + 4)) else {
                break;
            };
            if let Some((v, bytes)) = each(page, crun, j) {
                // Each property is at least three bytes.
                out.step(bytes as u64 / 3)?;
                list.push((start, end, v));
            }
        }
    }
    Ok(Runs::new(list))
}

fn chpx_at(page: &[u8], crun: usize, j: usize) -> Option<(Chp, usize)> {
    let off = *page.get(4 * (crun + 1) + j)? as usize * 2;
    if off == 0 {
        return Some((Chp::default(), 0));
    }
    let cb = *page.get(off)? as usize;
    Some((chp(page.get(off + 1..off + 1 + cb)?), cb))
}

fn papx_at(page: &[u8], crun: usize, j: usize) -> Option<(Pap, usize)> {
    let off = *page.get(4 * (crun + 1) + 13 * j)? as usize * 2;
    if off == 0 {
        return Some((Pap::default(), 0));
    }
    let cb = *page.get(off)? as usize;
    let data = if cb != 0 {
        page.get(off + 1..off + 2 * cb)?
    } else {
        let cb = *page.get(off + 1)? as usize;
        page.get(off + 2..off + 2 + 2 * cb)?
    };
    Some((pap(u16_at(data, 0)?, data.get(2..)?), data.len()))
}

/// The heading level each style is, by its index: Heading 1 to 9 by their built-in identifiers, a Title as 0.
fn styles(stsh: Option<&[u8]>) -> Vec<Option<u8>> {
    let mut out = Vec::new();
    let Some(s) = stsh else { return out };
    let (Some(cb), Some(cstd)) = (u16_at(s, 0), u16_at(s, 2)) else {
        return out;
    };
    let mut at = 2 + cb as usize;
    for _ in 0..cstd.min(4095) {
        let Some(n) = u16_at(s, at) else { break };
        at += 2;
        out.push(match u16_at(s, at).map(|v| v & 0x0FFF) {
            _ if n == 0 => None,
            Some(sti @ 1..=9) => Some(sti as u8),
            Some(62) => Some(0),
            _ => None,
        });
        at += n as usize;
    }
    out
}

struct Field {
    result: bool,
    code: String,
    /// A link field's address, and the inline its result starts at in the line, while that line is the one being built.
    link: Option<(String, usize)>,
    para: u64,
}

/// The address a HYPERLINK field's code names: its target, or `#` and the bookmark `\l` names.
fn link_of(code: &str) -> Option<String> {
    let mut words = Vec::new();
    let mut rest = code.trim_start();
    while !rest.is_empty() {
        let (word, more) = if let Some(r) = rest.strip_prefix('"') {
            match r.find('"') {
                Some(e) => (&r[..e], &r[e + 1..]),
                None => (r, ""),
            }
        } else {
            let e = rest.find(char::is_whitespace).unwrap_or(rest.len());
            (&rest[..e], &rest[e..])
        };
        words.push(word);
        rest = more.trim_start();
    }
    if !words.first()?.eq_ignore_ascii_case("HYPERLINK") {
        return None;
    }
    let mut target = None;
    let mut it = words.iter().skip(1);
    while let Some(w) = it.next() {
        if w.eq_ignore_ascii_case("\\l") {
            if let Some(b) = it.next() {
                return Some(format!("#{b}"));
            }
        } else if w.starts_with('\\') {
            // A switch with an argument: \o "tip", \t "frame", \m.
            if matches!(w.to_ascii_lowercase().as_str(), "\\o" | "\\t") {
                it.next();
            }
        } else if target.is_none() {
            target = Some(w.to_string());
        }
    }
    target.filter(|t| !t.is_empty())
}

struct Build<'o, 'l> {
    out: &'o mut Out<'l>,
    styles: Vec<Option<u8>>,
    blocks: Vec<Block>,
    line: Line,
    para: u64,
    fields: Vec<Field>,
    /// Fields opened past the depth cap, still to be closed.
    deep: usize,
    rows: Vec<Vec<Vec<Inline>>>,
    row: Vec<Vec<Inline>>,
    cell: Vec<Inline>,
    items: Vec<Vec<Block>>,
    /// The last mark ended a cell: with no paragraph properties to say so, a cell mark straight after one ends the row.
    after_cell: bool,
}

impl Build<'_, '_> {
    fn shown(&self) -> bool {
        self.fields.iter().all(|f| f.result)
    }

    fn close_list(&mut self) {
        if !self.items.is_empty() {
            let items = std::mem::take(&mut self.items);
            self.blocks.push(Block::List {
                ordered: false,
                start: 1,
                items,
            });
        }
    }

    fn close_table(&mut self) {
        if !self.cell.is_empty() {
            let cell = std::mem::take(&mut self.cell);
            self.row.push(cell);
        }
        if !self.row.is_empty() {
            let row = std::mem::take(&mut self.row);
            self.rows.push(row);
        }
        if !self.rows.is_empty() {
            self.close_list();
            let rows = std::mem::take(&mut self.rows);
            self.blocks.push(Block::Table { rows });
        }
    }

    /// False once the paragraph cap is reached: every mark is charged, as a file of empty paragraphs costs as much to walk.
    fn end_para(&mut self, mark: u16, p: Option<&Pap>) -> bool {
        if !self.out.node() {
            return false;
        }
        let kids = self.line.take();
        self.para += 1;
        let in_table = match p {
            Some(p) => p.in_table || p.itap > 0,
            None => mark == 0x07,
        };
        if in_table {
            let p = p.cloned().unwrap_or_default();
            let row_end = if mark == 0x07 && p.ttp {
                true
            } else {
                mark == 0x07 && !p.in_table && self.after_cell && kids.is_empty()
            };
            if row_end {
                let row = std::mem::take(&mut self.row);
                self.rows.push(row);
                self.after_cell = false;
                return true;
            }
            if p.inner_ttp {
                return true;
            }
            if !kids.is_empty() {
                if !self.cell.is_empty() {
                    self.cell.push(Inline::Br);
                }
                self.cell.extend(kids);
            }
            if mark == 0x07 {
                let cell = std::mem::take(&mut self.cell);
                self.row.push(cell);
                self.after_cell = true;
            } else {
                self.after_cell = false;
            }
            return true;
        }
        self.after_cell = false;
        self.close_table();
        if kids.is_empty() {
            return true;
        }
        let p = p.cloned().unwrap_or_default();
        let level = match p.outline {
            Some(l @ 0..=8) => Some(l + 1),
            _ => self.styles.get(p.istd as usize).copied().flatten(),
        };
        if let Some(level) = level {
            self.close_list();
            self.blocks.push(Block::Heading {
                level,
                kids,
                slide: None,
            });
        } else if p.ilfo > 0 {
            self.items.push(vec![Block::Para { kids }]);
        } else {
            self.close_list();
            self.blocks.push(Block::Para { kids });
        }
        true
    }

    fn field_start(&mut self) {
        if self.fields.len() >= FIELD_DEPTH {
            self.deep += 1;
            return;
        }
        self.fields.push(Field {
            result: false,
            code: String::new(),
            link: None,
            para: self.para,
        });
    }

    fn field_separator(&mut self) {
        if self.deep > 0 {
            return;
        }
        let shown_above = self.fields.len() <= 1
            || self.fields[..self.fields.len() - 1]
                .iter()
                .all(|f| f.result);
        let start = shown_above.then(|| self.line.mark());
        let para = self.para;
        if let Some(f) = self.fields.last_mut() {
            if f.result {
                return;
            }
            f.result = true;
            if let (Some(start), Some(href)) = (start, link_of(&f.code)) {
                f.link = Some((href, start));
                f.para = para;
            }
        }
    }

    fn field_end(&mut self) {
        if self.deep > 0 {
            self.deep -= 1;
            return;
        }
        let Some(f) = self.fields.pop() else { return };
        if let Some((href, start)) = f.link {
            if f.para == self.para {
                self.line.wrap(start, href);
            }
        }
    }

    fn image(&mut self) {
        let object = self.fields.last().is_some_and(|f| {
            f.code
                .trim_start()
                .get(..5)
                .is_some_and(|w| w.eq_ignore_ascii_case("EMBED"))
        });
        if let Some(i) = self.out.image(
            if object { "object" } else { "held picture" },
            String::new(),
        ) {
            self.line.inline(i);
        }
    }

    /// One UTF-16 unit of the main text, at byte `fc` of the WordDocument stream. False once the text cap is reached.
    fn unit(&mut self, u: u16, fc: u32, chp: &Runs<Chp>, pap: &Runs<Pap>) -> bool {
        match u {
            0x13 => {
                self.field_start();
                return true;
            }
            0x14 => {
                self.field_separator();
                return true;
            }
            0x15 => {
                self.field_end();
                return true;
            }
            _ => {}
        }
        if !self.shown() {
            if let Some(f) = self.fields.last_mut() {
                if !f.result && f.code.len() < FIELD_CODE {
                    f.code.push(char::from_u32(u as u32).unwrap_or(' '));
                }
            }
            return true;
        }
        let c = chp.at(fc).cloned().unwrap_or_default();
        match u {
            0x0D | 0x07 | 0x0C => return self.end_para(u, pap.at(fc)),
            0x0B if !c.vanish => {
                if !self.out.room(1) || !self.out.node() {
                    return false;
                }
                self.line.inline(Inline::Br);
            }
            0x01 | 0x08 if c.spec && !c.vanish => self.image(),
            0x09 => return self.text(u, &c),
            0x1E => return self.text(0x2011, &c),
            0x1F => return self.text(0x00AD, &c),
            0x00..=0x1F => {}
            _ => return self.text(u, &c),
        }
        true
    }

    fn text(&mut self, u: u16, c: &Chp) -> bool {
        if c.vanish {
            return true;
        }
        if !self.out.room(1) {
            return false;
        }
        self.line.push(u, &c.fmt);
        true
    }
}

pub fn read(store: &mut Store, out: &mut Out) -> Result<Vec<Block>, Fault> {
    let w = store
        .stream("WordDocument", u64::MAX)?
        .ok_or(Fault::Damaged)?;
    let fib = fib(&w)?;
    let table = if fib.flags & F_WHICH_TABLE != 0 {
        "1Table"
    } else {
        "0Table"
    };
    let t = store.stream(table, u64::MAX)?.ok_or(Fault::Damaged)?;
    let pieces = pieces(fib.part(&t, CLX).ok_or(Fault::Damaged)?, out)?;
    let chpx = pages(&w, fib.part(&t, PLCF_BTE_CHPX), out, chpx_at)?;
    let papx = pages(&w, fib.part(&t, PLCF_BTE_PAPX), out, papx_at)?;
    for (i, what) in [
        (4, "footnotes"),
        (5, "headers and footers"),
        (7, "comments"),
        (8, "endnotes"),
        (9, "text boxes"),
        (10, "text boxes"),
    ] {
        if fib.lw(i) > 0 {
            out.leave(what);
        }
    }
    let main = fib.lw(3);
    let mut b = Build {
        styles: styles(fib.part(&t, STSHF)),
        out,
        blocks: Vec::new(),
        line: Line::default(),
        para: 0,
        fields: Vec::new(),
        deep: 0,
        rows: Vec::new(),
        row: Vec::new(),
        cell: Vec::new(),
        items: Vec::new(),
        after_cell: false,
    };
    let table = cp1252();
    'pieces: for p in &pieces {
        let end = p.end.min(main);
        if p.cp >= end {
            continue;
        }
        let n = (end - p.cp) as usize;
        b.out.step(n as u64)?;
        for k in 0..n {
            let (u, fc) = if p.compressed {
                let fc = p.fc as usize + k;
                (w.get(fc).map(|&x| table[x as usize]), fc)
            } else {
                let fc = p.fc as usize + 2 * k;
                (u16_at(&w, fc), fc)
            };
            let Some(u) = u else {
                b.out
                    .cut("Part of the text lies past the end of the file: it is left out.".into());
                continue 'pieces;
            };
            if !b.unit(u, fc as u32, &chpx, &papx) {
                break 'pieces;
            }
        }
    }
    let last = b.line.take();
    if !last.is_empty() && b.out.node() {
        b.close_table();
        b.close_list();
        b.blocks.push(Block::Para { kids: last });
    }
    b.close_table();
    b.close_list();
    let mut blocks = b.blocks;
    level_headings(&mut blocks);
    Ok(blocks)
}

/// A Title is the top heading, and Heading 1 sits under it when there is one; Markdown has six levels.
fn level_headings(blocks: &mut [Block]) {
    let titled = blocks
        .iter()
        .any(|b| matches!(b, Block::Heading { level: 0, .. }));
    for b in blocks {
        if let Block::Heading { level, .. } = b {
            *level = if *level == 0 {
                1
            } else {
                (*level + u8::from(titled)).min(6)
            };
        }
    }
}

/// How many paragraph runs the pages a bin table names come to.
#[cfg(test)]
pub(super) fn paragraph_runs(w: &[u8], plc: &[u8], out: &mut Out) -> Result<usize, Fault> {
    Ok(pages(w, Some(plc), out, papx_at)?.len())
}
