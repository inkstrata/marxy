//! Number formats for an xls and an ods, which calamine reads only as far as telling a date from a number. An xls's are
//! its FORMAT and XF records and the XF each number cell names, read from the BIFF stream here; an ods's are its data
//! styles (number, percentage, currency, date, time), written here as the format codes an xlsx carries, so the page
//! applies one formatter to all three kinds. A cell with no format, or General, has none here.

use std::collections::HashMap;
use std::io::Read;

use quick_xml::events::{BytesStart, Event};

/// The format codes a workbook uses, and per sheet (by name) the code each cell names, by its index in `codes`.
#[derive(Debug, Default)]
pub struct CellCodes {
    pub codes: Vec<String>,
    pub sheets: HashMap<String, HashMap<(u32, u32), u32>>,
}

/// Excel's builtin number formats by id, as ECMA-376 18.8.30 writes them; 5 to 8 are the currency ones BIFF names.
pub fn builtin(id: u16) -> Option<&'static str> {
    Some(match id {
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        5 => "\"$\"#,##0_);\\(\"$\"#,##0\\)",
        6 => "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)",
        7 => "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
        8 => "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        12 => "# ?/?",
        13 => "# ??/??",
        14 => "mm-dd-yy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "m/d/yy h:mm",
        37 => "#,##0 ;(#,##0)",
        38 => "#,##0 ;[Red](#,##0)",
        39 => "#,##0.00;(#,##0.00)",
        40 => "#,##0.00;[Red](#,##0.00)",
        41 => "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"_);_(@_)",
        42 => "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"_);_(@_)",
        43 => "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)",
        44 => "_(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_)",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        48 => "##0.0E+0",
        49 => "@",
        _ => return None,
    })
}

fn general(code: &str) -> bool {
    code.is_empty() || code.eq_ignore_ascii_case("general")
}

#[derive(Default)]
struct Table {
    codes: Vec<String>,
    index: HashMap<String, u32>,
}

impl Table {
    fn of(&mut self, code: &str) -> u32 {
        if let Some(&i) = self.index.get(code) {
            return i;
        }
        let i = self.codes.len() as u32;
        self.codes.push(code.to_string());
        self.index.insert(code.to_string(), i);
        i
    }
}

// ---- xls ---------------------------------------------------------------------------------------------------------------

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// BIFF records from `at`: (type, body). Stops at a record cut short.
struct Records<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Iterator for Records<'a> {
    type Item = (u16, &'a [u8]);
    fn next(&mut self) -> Option<Self::Item> {
        let typ = u16_at(self.b, self.at)?;
        let len = u16_at(self.b, self.at + 2)? as usize;
        let body = self.b.get(self.at + 4..self.at + 4 + len)?;
        self.at += 4 + len;
        Some((typ, body))
    }
}

/// BIFF8's string: `cch` characters after a flags byte, two bytes each when its low bit is set, else one (Latin-1).
fn biff8_text(b: &[u8], cch: usize) -> Option<String> {
    let flags = *b.first()?;
    let mut at = 1;
    if flags & 0x08 != 0 {
        at += 2;
    }
    if flags & 0x04 != 0 {
        at += 4;
    }
    if flags & 0x01 != 0 {
        let raw = b.get(at..at + cch * 2)?;
        let units: Vec<u16> = raw
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        Some(String::from_utf16_lossy(&units))
    } else {
        Some(b.get(at..at + cch)?.iter().map(|&c| c as char).collect())
    }
}

fn latin(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

const BOF: u16 = 0x0809;
const EOF: u16 = 0x000A;
const FILEPASS: u16 = 0x002F;
const FORMAT: u16 = 0x041E;
const XF: u16 = 0x00E0;
const BOUNDSHEET: u16 = 0x0085;
const NUMBER: u16 = 0x0203;
const RK: u16 = 0x027E;
const MULRK: u16 = 0x00BD;
const FORMULA: u16 = 0x0006;

/// The number formats of the xls at `src`; None when its workbook stream cannot be read or is encrypted.
pub fn xls(src: super::Source, cap: usize) -> Option<CellCodes> {
    let mut c = cfb::CompoundFile::open(src.reader().ok()?).ok()?;
    let name = if c.exists("/Workbook") {
        "/Workbook"
    } else {
        "/Book"
    };
    let mut b = Vec::new();
    c.open_stream(name).ok()?.read_to_end(&mut b).ok()?;
    xls_stream(&b, cap)
}

/// The number formats of a BIFF5 or BIFF8 workbook stream: at most `cap` cells' in all.
pub fn xls_stream(b: &[u8], cap: usize) -> Option<CellCodes> {
    let mut recs = Records { b, at: 0 };
    let (typ, bof) = recs.next()?;
    if typ != BOF {
        return None;
    }
    let biff8 = u16_at(bof, 0)? >= 0x0600;
    let mut written: HashMap<u16, String> = HashMap::new();
    let mut xfs: Vec<u16> = Vec::new();
    let mut sheets: Vec<(String, usize)> = Vec::new();
    for (typ, d) in recs.by_ref() {
        match typ {
            EOF => break,
            FILEPASS => return None,
            FORMAT => {
                let code = if biff8 {
                    u16_at(d, 2).and_then(|n| biff8_text(d.get(4..)?, n as usize))
                } else {
                    d.get(2).and_then(|&n| d.get(3..3 + n as usize)).map(latin)
                };
                if let (Some(id), Some(code)) = (u16_at(d, 0), code) {
                    written.insert(id, code);
                }
            }
            XF => xfs.push(u16_at(d, 2).unwrap_or(0)),
            BOUNDSHEET => {
                let name = d.get(6).and_then(|&n| {
                    if biff8 {
                        biff8_text(d.get(7..)?, n as usize)
                    } else {
                        d.get(7..7 + n as usize).map(latin)
                    }
                });
                if let (Some(at), Some(name)) = (u32_at(d, 0), name) {
                    sheets.push((name, at as usize));
                }
            }
            _ => {}
        }
    }
    let mut table = Table::default();
    // Per XF, its code's index in the table; None for General or a format the file never wrote.
    let by_xf: Vec<Option<u32>> = xfs
        .iter()
        .map(|id| {
            let code = written.get(id).map(String::as_str).or(builtin(*id))?;
            (!general(code)).then(|| table.of(code))
        })
        .collect();
    let mut out = CellCodes::default();
    let mut left = cap;
    for (name, at) in sheets {
        let mut cells: HashMap<(u32, u32), u32> = HashMap::new();
        let put = |cells: &mut HashMap<(u32, u32), u32>, row: u16, col: u16, xf: u16| {
            if let Some(Some(i)) = by_xf.get(xf as usize) {
                cells.insert((row as u32, col as u32), *i);
            }
        };
        let mut depth = 0i32;
        for (typ, d) in (Records { b, at }) {
            match typ {
                BOF => depth += 1,
                EOF => {
                    depth -= 1;
                    if depth <= 0 {
                        break;
                    }
                }
                // A chart's own BOF to EOF inside the sheet holds no cells of the sheet's.
                NUMBER | RK | FORMULA if depth == 1 => {
                    if let (Some(r), Some(c), Some(xf)) = (u16_at(d, 0), u16_at(d, 2), u16_at(d, 4))
                    {
                        put(&mut cells, r, c, xf);
                    }
                }
                MULRK if depth == 1 => {
                    if let (Some(r), Some(first)) = (u16_at(d, 0), u16_at(d, 2)) {
                        let n = d.len().saturating_sub(6) / 6;
                        for k in 0..n {
                            if let Some(xf) = u16_at(d, 4 + k * 6) {
                                put(&mut cells, r, first.saturating_add(k as u16), xf);
                            }
                        }
                    }
                }
                _ => {}
            }
            if depth == 0 && typ != BOF {
                break;
            }
            if cells.len() >= left {
                break;
            }
        }
        left -= cells.len().min(left);
        out.sheets.insert(name, cells);
    }
    out.codes = table.codes;
    Some(out)
}

// ---- ods ---------------------------------------------------------------------------------------------------------------

/// An ods's data styles as format codes, and its cell styles' data styles, from styles.xml and content.xml's automatic
/// styles.
#[derive(Debug, Default)]
pub struct OdsStyles {
    data: HashMap<String, Data>,
    /// A cell style: its data style, and the style it inherits from.
    cells: HashMap<String, (Option<String>, Option<String>)>,
}

#[derive(Debug, Default, Clone)]
struct Data {
    code: String,
    /// `style:map`s: (condition, the data style it applies).
    maps: Vec<(String, String)>,
}

fn attr(e: &BytesStart<'_>, name: &str) -> Option<String> {
    e.try_get_attribute(name)
        .ok()
        .flatten()
        .map(|a| super::sheets::attr_text(&a.value))
}

/// Text as a format code's literal: quoted, since a quoted run is shown as it is.
fn quoted(s: &str) -> String {
    if s.is_empty() {
        String::new()
    } else {
        format!("\"{}\"", s.replace('"', ""))
    }
}

/// The digits of a `number:number` or `number:scientific-number`: `#,##0.00`.
fn digits(e: &BytesStart<'_>) -> String {
    let num = |n: &str| attr(e, n).and_then(|v| v.parse::<usize>().ok());
    let places = num("number:decimal-places").unwrap_or(0).min(30);
    let min_places = num("number:min-decimal-places")
        .unwrap_or(places)
        .min(places);
    let min_int = num("number:min-integer-digits").unwrap_or(1).min(30);
    let grouped = attr(e, "number:grouping").as_deref() == Some("true");
    let mut int = "0".repeat(min_int);
    if int.is_empty() {
        int.push('#');
    }
    if grouped {
        int = if int.len() >= 4 {
            let z = int.len();
            let mut g = String::new();
            for (i, ch) in int.chars().enumerate() {
                if i > 0 && (z - i) % 3 == 0 {
                    g.push(',');
                }
                g.push(ch);
            }
            g
        } else {
            format!("{}{}", &"#,###"[..5 - int.len()], int)
        };
    }
    if places > 0 {
        int.push('.');
        int.push_str(&"0".repeat(min_places));
        int.push_str(&"#".repeat(places - min_places));
    }
    int
}

impl OdsStyles {
    /// Reads the data and cell styles in `xml`, up to its body.
    pub fn read(&mut self, xml: &[u8]) {
        let mut reader = quick_xml::Reader::from_reader(xml);
        let mut buf = Vec::new();
        // The data style being read: its name, its kind, its code so far.
        let mut cur: Option<(String, String, Data)> = None;
        // The text of a `number:text` or `number:currency-symbol` being read.
        let mut text: Option<String> = None;
        let mut elapsed = false;
        loop {
            let ev = match reader.read_event_into(&mut buf) {
                Ok(Event::Eof) | Err(_) => break,
                Ok(ev) => ev.into_owned(),
            };
            match ev {
                Event::Start(e) => {
                    if e.name().as_ref() == "office:body" {
                        break;
                    }
                    self.open(&e, false, &mut cur, &mut text, &mut elapsed);
                }
                Event::Empty(e) => self.open(&e, true, &mut cur, &mut text, &mut elapsed),
                Event::Text(t) => {
                    if let Some(s) = text.as_mut() {
                        s.push_str(&super::sheets::attr_text(t.as_ref()));
                    }
                }
                Event::GeneralRef(r) => {
                    if let Some(s) = text.as_mut() {
                        s.push_str(&super::sheets::attr_text(&format!("&{};", r.as_ref())));
                    }
                }
                Event::End(e) => {
                    let name = e.name().as_ref().to_string();
                    if matches!(name.as_str(), "number:text" | "number:currency-symbol") {
                        if let (Some(t), Some((_, kind, d))) = (text.take(), cur.as_mut()) {
                            if name == "number:text" && kind == "number:percentage-style" {
                                let parts: Vec<&str> = t.split('%').collect();
                                let last = parts.len() - 1;
                                for (i, p) in parts.into_iter().enumerate() {
                                    d.code.push_str(&quoted(p));
                                    if i < last {
                                        d.code.push('%');
                                    }
                                }
                            } else {
                                d.code.push_str(&quoted(&t));
                            }
                        }
                    } else if name.starts_with("number:") && name.ends_with("-style") {
                        if let Some((n, _, d)) = cur.take() {
                            self.data.insert(n, d);
                        }
                        elapsed = false;
                    }
                }
                _ => {}
            }
            buf.clear();
        }
    }

    fn open(
        &mut self,
        e: &BytesStart<'_>,
        empty: bool,
        cur: &mut Option<(String, String, Data)>,
        text: &mut Option<String>,
        elapsed: &mut bool,
    ) {
        let name = e.name().as_ref().to_string();
        let long = attr(e, "number:style").as_deref() == Some("long");
        if name.starts_with("number:") && name.ends_with("-style") {
            if let Some(n) = attr(e, "style:name") {
                if empty {
                    self.data.insert(n, Data::default());
                } else {
                    *elapsed = attr(e, "number:truncate-on-overflow").as_deref() == Some("false");
                    *cur = Some((n, name, Data::default()));
                }
            }
            return;
        }
        if name == "style:style" {
            if attr(e, "style:family").as_deref() == Some("table-cell") {
                if let Some(n) = attr(e, "style:name") {
                    self.cells.insert(
                        n,
                        (
                            attr(e, "style:data-style-name"),
                            attr(e, "style:parent-style-name"),
                        ),
                    );
                }
            }
            return;
        }
        let Some((_, _, d)) = cur.as_mut() else {
            return;
        };
        let part = match name.as_str() {
            "number:number" => digits(e),
            "number:scientific-number" => {
                let exp = attr(e, "number:min-exponent-digits")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(2)
                    .clamp(1, 5);
                format!("{}E+{}", digits(e), "0".repeat(exp))
            }
            "number:fraction" => "# ?/?".into(),
            "number:text" | "number:currency-symbol" => {
                if !empty {
                    *text = Some(String::new());
                }
                String::new()
            }
            "number:text-content" => "@".into(),
            "number:day" => if long { "dd" } else { "d" }.into(),
            "number:month" => {
                let textual = attr(e, "number:textual").as_deref() == Some("true");
                match (textual, long) {
                    (true, true) => "mmmm",
                    (true, false) => "mmm",
                    (false, true) => "mm",
                    (false, false) => "m",
                }
                .into()
            }
            "number:year" => if long { "yyyy" } else { "yy" }.into(),
            "number:day-of-week" => if long { "dddd" } else { "ddd" }.into(),
            "number:hours" => {
                let h = if long { "hh" } else { "h" };
                if *elapsed {
                    format!("[{h}]")
                } else {
                    h.into()
                }
            }
            "number:minutes" => if long { "mm" } else { "m" }.into(),
            "number:seconds" => {
                let s = if long { "ss" } else { "s" };
                let places = attr(e, "number:decimal-places")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0)
                    .min(9);
                if places > 0 {
                    format!("{s}.{}", "0".repeat(places))
                } else {
                    s.into()
                }
            }
            "number:am-pm" => "AM/PM".into(),
            "style:map" => {
                if let (Some(c), Some(a)) = (
                    attr(e, "style:condition"),
                    attr(e, "style:apply-style-name"),
                ) {
                    d.maps.push((c, a));
                }
                String::new()
            }
            _ => String::new(),
        };
        d.code.push_str(&part);
    }

    /// A data style's code, with the style a `value()>=0` map applies put first, as an xlsx's positive section.
    fn data_code(&self, name: &str) -> Option<String> {
        let d = self.data.get(name)?;
        let positive = d.maps.iter().find_map(|(c, a)| {
            let c: String = c.chars().filter(|ch| !ch.is_whitespace()).collect();
            matches!(c.as_str(), "value()>=0" | "value()>0")
                .then(|| self.data.get(a))
                .flatten()
        });
        let code = match positive {
            Some(p) if !p.code.is_empty() => format!("{};{}", p.code, d.code),
            _ => d.code.clone(),
        };
        (!general(&code)).then_some(code)
    }

    /// The code a cell style names, through the styles it inherits from.
    pub fn code_of(&self, style: &str) -> Option<String> {
        let mut at = style;
        for _ in 0..8 {
            let (data, parent) = self.cells.get(at)?;
            if let Some(d) = data {
                return self.data_code(d);
            }
            at = parent.as_deref()?;
        }
        None
    }
}

/// An ods's cells' codes, gathered while its content is walked.
#[derive(Default)]
pub struct OdsCodes {
    table: Table,
    /// Per cell style, its code's index in the table, once worked out.
    seen: HashMap<String, Option<u32>>,
    pub sheets: HashMap<String, HashMap<(u32, u32), u32>>,
    left: usize,
}

impl OdsCodes {
    pub fn new(cap: usize) -> Self {
        OdsCodes {
            left: cap,
            ..Self::default()
        }
    }

    /// Cells `rows` by `cols` of `sheet`, all in cell style `style`, hold values of the kind a format applies to.
    pub fn put(
        &mut self,
        styles: &OdsStyles,
        sheet: &str,
        style: &str,
        rows: std::ops::Range<u32>,
        cols: std::ops::Range<u32>,
    ) {
        if self.left == 0 {
            return;
        }
        let i = match self.seen.get(style) {
            Some(i) => *i,
            None => {
                let i = styles.code_of(style).map(|c| self.table.of(&c));
                self.seen.insert(style.to_string(), i);
                i
            }
        };
        let Some(i) = i else {
            return;
        };
        let cells = self.sheets.entry(sheet.to_string()).or_default();
        for r in rows {
            for c in cols.clone() {
                if self.left == 0 {
                    return;
                }
                cells.insert((r, c), i);
                self.left -= 1;
            }
        }
    }

    pub fn finish(self) -> CellCodes {
        CellCodes {
            codes: self.table.codes,
            sheets: self.sheets,
        }
    }
}

// ---- an ods's dates and times as serials -------------------------------------------------------------------------------

/// Days from 1970-01-01 to a civil date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// An ods date (`2026-10-31` or `2026-10-31T23:43:00.5`) as the 1900 system's serial and its clock reading.
pub fn iso_date(s: &str) -> Option<(f64, String)> {
    let (date, time) = s.split_once('T').unwrap_or((s, ""));
    let mut ymd = date.splitn(3, '-');
    let y: i64 = ymd.next()?.parse().ok()?;
    let m: i64 = ymd.next()?.parse().ok()?;
    let d: i64 = ymd.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let (mut h, mut mi, mut sec) = (0i64, 0i64, 0f64);
    if !time.is_empty() {
        let mut t = time.splitn(3, ':');
        h = t.next()?.parse().ok()?;
        mi = t.next()?.parse().ok()?;
        sec = t.next().unwrap_or("0").parse().ok()?;
    }
    // 25,569 is 1970-01-01 in the 1900 system.
    let serial = (days_from_civil(y, m, d) + 25_569) as f64
        + (h as f64 * 3600.0 + mi as f64 * 60.0 + sec) / 86_400.0;
    let iso = format!(
        "{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{:02}",
        sec.floor() as i64
    );
    Some((serial, iso))
}

/// An ods time (`PT06H30M00S`) under a day as the fraction of a day it is.
pub fn iso_time(s: &str) -> Option<f64> {
    let rest = s.strip_prefix("PT")?;
    let (mut total, mut num) = (0f64, String::new());
    for ch in rest.chars() {
        match ch {
            '0'..='9' | '.' => num.push(ch),
            'H' | 'M' | 'S' => {
                let n: f64 = num.parse().ok()?;
                total += n * match ch {
                    'H' => 3600.0,
                    'M' => 60.0,
                    _ => 1.0,
                };
                num.clear();
            }
            _ => return None,
        }
    }
    (num.is_empty() && total < 86_400.0).then_some(total / 86_400.0)
}

#[cfg(test)]
#[path = "formats_tests.rs"]
mod tests;
