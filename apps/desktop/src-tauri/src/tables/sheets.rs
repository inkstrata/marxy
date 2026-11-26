//! A spreadsheet as saved: xlsx and xlsm, xls (BIFF in a compound file) and ods, through calamine. Values are the
//! cached ones the saving app worked out, in the file's own number formats (`formats` reads an xls's and an ods's,
//! which calamine does not); formulas are text, as written; nothing recalculates, no macro runs, and no
//! link to another file is followed. An xlsx is read a cell at a time and kept sparse, so a sheet whose cells sit far
//! apart costs only its cells; every workbook stops at `Limits::cells` and says where.

use std::collections::HashMap;
use std::io::Read;

use calamine::{
    CellErrorType, Data, DataRef, Dimensions, Ods, Reader, SheetType, SheetVisible, Xls, Xlsx,
};
use quick_xml::events::Event;
use serde::Serialize;

use super::formats::{self, CellCodes, OdsCodes, OdsStyles};
use super::{Fault, Limits, Reading, Source, Value};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    /// `xlsx`, `xlsm`, `xls` or `ods`.
    pub format: String,
    pub sheets: Vec<SheetPart>,
    /// Number formats as the file writes them; a cell names one by its index.
    pub formats: Vec<String>,
    /// Whether the file's number formats were read: an xlsx's styles, an xls's FORMAT and XF records, an ods's data
    /// styles. False for an xls whose workbook stream could not be read for them.
    pub formats_read: bool,
    pub properties: Properties,
    pub macros: bool,
    /// Other files the workbook links to, by the name it gives them: never opened.
    pub links: Vec<String>,
    /// Parts in the zip (xlsx, ods).
    pub parts: Option<u32>,
    /// An xls's compound file: its sector size and its streams.
    pub compound: Option<Compound>,
    pub size: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    pub application: Option<String>,
    pub app_version: Option<String>,
    pub creator: Option<String>,
    pub last_modified_by: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compound {
    pub sector: u32,
    pub streams: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPart {
    pub name: String,
    /// `visible`, `hidden`, or `very` (very hidden: only a macro could show it).
    pub state: String,
    /// `worksheet`, `chart`, `dialog`, `macro` or `vba`: only a worksheet has cells here.
    pub kind: String,
    /// The last row and column with something in them, counted from A1 (so 17 rows means rows 1 to 17).
    pub rows: u32,
    pub cols: u32,
    pub cells: u32,
    pub formulas: u32,
    pub merged: u32,
    /// Said when the sheet was read only so far, at the workbook's cell cap or a fault.
    pub cut: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Cell {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPage {
    pub from: u32,
    pub to: u32,
    /// `[row, column, cell]`, 0-based from A1, in row order.
    pub cells: Vec<(u32, u32, Cell)>,
    /// Merged ranges that touch these rows: `[first row, first column, last row, last column]`.
    pub merges: Vec<[u32; 4]>,
}

struct SheetData {
    cells: Vec<(u32, u32, Cell)>,
    merges: Vec<[u32; 4]>,
}

pub struct Book {
    pub summary: BookSummary,
    sheets: Vec<SheetData>,
}

#[derive(Default)]
struct Formats {
    codes: Vec<String>,
    index: HashMap<String, u32>,
}

impl Formats {
    fn of(&mut self, code: &str) -> Option<u32> {
        if code.is_empty() || code.eq_ignore_ascii_case("general") {
            return None;
        }
        if let Some(&i) = self.index.get(code) {
            return Some(i);
        }
        let i = self.codes.len() as u32;
        self.codes.push(code.to_string());
        self.index.insert(code.to_string(), i);
        Some(i)
    }
}

fn error_text(e: &CellErrorType) -> String {
    e.to_string()
}

fn date_value(dt: &calamine::ExcelDateTime) -> Value {
    let (y, mo, d, h, mi, s, _) = dt.to_ymd_hms_milli();
    Value::Date {
        v: dt.as_f64(),
        iso: format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}"),
    }
}

fn value_ref(d: &DataRef<'_>, limits: &Limits) -> Option<Value> {
    Some(match d {
        DataRef::Int(i) => Value::real(*i as f64),
        DataRef::Float(f) => Value::real(*f),
        DataRef::String(s) => Value::text(s, limits.text_chars),
        DataRef::SharedString(s) => Value::text(s, limits.text_chars),
        DataRef::Bool(b) => Value::Bool { v: *b },
        DataRef::DateTime(dt) => date_value(dt),
        DataRef::DateTimeIso(s) | DataRef::DurationIso(s) => Value::Iso { v: s.clone() },
        DataRef::Error(e) => Value::Err { v: error_text(e) },
        DataRef::Empty => return None,
    })
}

fn value_data(d: &Data, limits: &Limits) -> Option<Value> {
    Some(match d {
        Data::Int(i) => Value::real(*i as f64),
        Data::Float(f) => Value::real(*f),
        Data::String(s) => Value::text(s, limits.text_chars),
        Data::Bool(b) => Value::Bool { v: *b },
        Data::DateTime(dt) => date_value(dt),
        Data::DateTimeIso(s) | Data::DurationIso(s) => Value::Iso { v: s.clone() },
        Data::Error(e) => Value::Err { v: error_text(e) },
        Data::Empty => return None,
    })
}

fn state_of(v: SheetVisible) -> String {
    match v {
        SheetVisible::Visible => "visible",
        SheetVisible::Hidden => "hidden",
        SheetVisible::VeryHidden => "very",
    }
    .into()
}

fn kind_of(t: SheetType) -> String {
    match t {
        SheetType::WorkSheet => "worksheet",
        SheetType::ChartSheet => "chart",
        SheetType::DialogSheet => "dialog",
        SheetType::MacroSheet => "macro",
        SheetType::Vba => "vba",
    }
    .into()
}

fn merges_of(dims: Vec<Dimensions>) -> Vec<[u32; 4]> {
    dims.into_iter()
        .filter(|d| d.end.0 > d.start.0 || d.end.1 > d.start.1)
        .map(|d| [d.start.0, d.start.1, d.end.0, d.end.1])
        .collect()
}

fn fault<E: std::fmt::Display>(e: E) -> Fault {
    Fault::Invalid(format!("The workbook could not be read: {e}"))
}

/// What the zip says of itself, checked before calamine reads it: every part's declared size within the cap (the zip
/// reader stops a part at what it declares), its part names, and its two or three small parts read here.
struct ZipLook {
    names: Vec<String>,
}

fn zip_look(src: Source, limits: &Limits) -> Result<ZipLook, Fault> {
    let mut zip = zip::ZipArchive::new(src.reader()?).map_err(fault)?;
    let mut names = Vec::new();
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(fault)?;
        let name = f.name().map(|n| n.into_owned()).unwrap_or_default();
        if f.size() > limits.workbook {
            return Err(Fault::Refused(format!(
                "{} unpacks to {} bytes, past the {} a part may",
                name,
                f.size(),
                limits.workbook
            )));
        }
        total = total.saturating_add(f.size());
        names.push(name);
    }
    if total > limits.workbook.saturating_mul(4) {
        return Err(Fault::Refused(format!(
            "its parts unpack to {total} bytes, past what the app reads"
        )));
    }
    Ok(ZipLook { names })
}

fn zip_part(src: Source, name: &str, cap: u64) -> Option<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(src.reader().ok()?).ok()?;
    let f = zip.by_name(name).ok()?;
    let mut out = Vec::new();
    f.take(cap).read_to_end(&mut out).ok()?;
    Some(out)
}

/// The targets an xlsx's external-link parts name: the other workbooks it reads from, never opened.
fn xlsx_links(src: Source, look: &ZipLook) -> Vec<String> {
    let mut out = Vec::new();
    for name in look
        .names
        .iter()
        .filter(|n| n.starts_with("xl/externalLinks/_rels/") && n.ends_with(".rels"))
        .take(64)
    {
        let Some(bytes) = zip_part(src, name, 1024 * 1024) else {
            continue;
        };
        let mut reader = quick_xml::Reader::from_reader(&bytes[..]);
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Empty(e)) | Ok(Event::Start(e))
                    if e.local_name().as_ref() == "Relationship" =>
                {
                    if let Ok(Some(t)) = e.try_get_attribute("Target") {
                        out.push(attr_text(&t.value));
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
            buf.clear();
        }
    }
    out
}

type Spans = HashMap<String, Vec<[u32; 4]>>;

/// An ods's merged ranges per table, from its cells' spans; the other files it links to (`table:table-source`); and
/// the format code of each cell holding a number, a date or a time, from its cell style, its row's or its column's.
fn ods_spans(bytes: &[u8], styles: &OdsStyles, codes: &mut OdsCodes) -> (Spans, Vec<String>) {
    let mut merges: Spans = HashMap::new();
    let mut links = Vec::new();
    // The table's columns' default cell styles: (first column, column after the last, style).
    let mut columns: Vec<(u32, u32, String)> = Vec::new();
    let (mut col_at, mut row_style) = (0u32, None::<String>);
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let mut buf = Vec::new();
    // `row` is the row whose cells are being read; `next` the first row after it and its repeats.
    let (mut table, mut row, mut next, mut col) = (String::new(), 0u32, 0u32, 0u32);
    let attr = |e: &quick_xml::events::BytesStart<'_>, name: &str| -> Option<String> {
        e.try_get_attribute(name)
            .ok()
            .flatten()
            .map(|a| attr_text(&a.value))
    };
    let num = |s: Option<String>| s.and_then(|v| v.parse::<u32>().ok()).unwrap_or(1).max(1);
    loop {
        let e = match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => e.into_owned(),
            Ok(Event::Eof) | Err(_) => break,
            _ => {
                buf.clear();
                continue;
            }
        };
        match e.name().as_ref() {
            "table:table" => {
                table = attr(&e, "table:name").unwrap_or_default();
                (row, next, col_at) = (0, 0, 0);
                columns.clear();
            }
            "table:table-column" => {
                let n = num(attr(&e, "table:number-columns-repeated"));
                if let Some(st) = attr(&e, "table:default-cell-style-name") {
                    if columns.len() < 16_384 {
                        columns.push((col_at, col_at.saturating_add(n), st));
                    }
                }
                col_at = col_at.saturating_add(n);
            }
            "table:table-row" => {
                row = next;
                next = next.saturating_add(num(attr(&e, "table:number-rows-repeated")));
                col = 0;
                row_style = attr(&e, "table:default-cell-style-name");
            }
            "table:table-cell" | "table:covered-table-cell" => {
                let cols = num(attr(&e, "table:number-columns-spanned"));
                let rows = num(attr(&e, "table:number-rows-spanned"));
                if e.name().as_ref() == "table:table-cell" && (cols > 1 || rows > 1) {
                    let list = merges.entry(table.clone()).or_default();
                    if list.len() < 100_000 {
                        list.push([row, col, row + rows - 1, col + cols - 1]);
                    }
                }
                let repeat = num(attr(&e, "table:number-columns-repeated"));
                let valued = matches!(
                    attr(&e, "office:value-type").as_deref(),
                    Some("float" | "percentage" | "currency" | "date" | "time")
                );
                if valued {
                    let style = attr(&e, "table:style-name")
                        .or_else(|| row_style.clone())
                        .or_else(|| {
                            columns
                                .iter()
                                .find(|(a, b, _)| (*a..*b).contains(&col))
                                .map(|(_, _, st)| st.clone())
                        });
                    if let Some(style) = style {
                        let cols = col..col.saturating_add(repeat);
                        codes.put(styles, &table, &style, row..next, cols);
                    }
                }
                col = col.saturating_add(repeat);
            }
            "table:table-source" => {
                if let Some(h) = attr(&e, "xlink:href") {
                    if links.len() < 64 {
                        links.push(h);
                    }
                }
            }
            _ => {}
        }
        buf.clear();
    }
    (merges, links)
}

/// What calamine would build from an ods's content.xml, counted before it builds it: it expands every repeated filled
/// cell into one `Data` each, so a few hundred bytes of `number-rows-repeated` by `number-columns-repeated` become gigabytes.
/// Refused past twice the cell budget, a bounding box past eight times it, or `limits.workbook` bytes of repeated text.
fn ods_extent(content: &[u8], limits: &Limits) -> Result<(), Fault> {
    let (cell_cap, box_cap) = (limits.cells as u64 * 2, limits.cells as u64 * 8);
    let refused = |what: String| Fault::Refused(format!("its content would expand to {what}"));
    let num = |e: &quick_xml::events::BytesStart<'_>, name: &str| -> u64 {
        e.try_get_attribute(name)
            .ok()
            .flatten()
            .and_then(|a| attr_text(&a.value).parse::<u64>().ok())
            .unwrap_or(1)
            .max(1)
    };
    let (mut cells, mut text) = (0u64, 0u64);
    let (mut row_cells, mut row_text, mut row_end) = (0u64, 0u64, 0u64);
    let (mut col, mut max_col, mut row_at, mut max_row) = (0u64, 0u64, 0u64, 0u64);
    // The repeat of the cell being read, whose text is charged once per copy.
    let mut open: Option<u64> = None;
    let mut reader = quick_xml::Reader::from_reader(content);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(ev @ (Event::Start(_) | Event::Empty(_))) => {
                let closed = matches!(ev, Event::Empty(_));
                let (Event::Start(e) | Event::Empty(e)) = ev else {
                    unreachable!()
                };
                match e.name().as_ref() {
                    "table:table" => (row_at, max_row, max_col) = (0, 0, 0),
                    "table:table-row" => {
                        let n = num(&e, "table:number-rows-repeated");
                        (row_cells, row_text, col) = (0, 0, 0);
                        row_end = n;
                        row_at = row_at.saturating_add(n);
                    }
                    "table:table-cell" => {
                        let repeat = num(&e, "table:number-columns-repeated");
                        let valued = e
                            .try_get_attribute("office:value-type")
                            .ok()
                            .flatten()
                            .is_some();
                        if valued {
                            row_cells = row_cells.saturating_add(repeat);
                            max_row = max_row.max(row_at);
                            max_col = max_col.max(col.saturating_add(repeat));
                            if let Some(a) =
                                e.try_get_attribute("office:string-value").ok().flatten()
                            {
                                row_text = row_text
                                    .saturating_add((a.value.len() as u64).saturating_mul(repeat));
                            }
                        }
                        col = col.saturating_add(repeat);
                        open = (!closed).then_some(repeat);
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(repeat) = open {
                    row_text = row_text.saturating_add((t.len() as u64).saturating_mul(repeat));
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                "table:table-cell" => open = None,
                "table:table-row" => {
                    cells = cells.saturating_add(row_cells.saturating_mul(row_end));
                    text = text.saturating_add(row_text.saturating_mul(row_end));
                    row_cells = 0;
                    row_text = 0;
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        if cells.saturating_add(row_cells.saturating_mul(row_end)) > cell_cap {
            return Err(refused(format!("more than {cell_cap} cells")));
        }
        if (max_row + 1).saturating_mul(max_col) > box_cap {
            return Err(refused(format!("a range of more than {box_cap} cells")));
        }
        if text.saturating_add(row_text.saturating_mul(row_end)) > limits.workbook {
            return Err(refused(format!(
                "more than {} bytes of text",
                limits.workbook
            )));
        }
        buf.clear();
    }
    Ok(())
}

/// An attribute's text with XML's five entities read back.
pub(super) fn attr_text(raw: &str) -> String {
    quick_xml::escape::unescape(raw)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| raw.to_string())
}

fn props(p: calamine::WorkbookProperties) -> Properties {
    Properties {
        application: p.application,
        app_version: p.app_version,
        creator: p.creator,
        last_modified_by: p.last_modified_by,
        created: p.created,
        modified: p.modified,
        title: p.title,
    }
}

fn is_zip(head: &[u8]) -> bool {
    head.starts_with(b"PK\x03\x04")
}

fn is_cfb(head: &[u8]) -> bool {
    head.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
}

/// Reads the workbook at `path`, or None when its bytes are not a workbook calamine reads.
pub fn open(path: &std::path::Path, limits: &Limits) -> Result<Option<Book>, Fault> {
    open_from(Source::File(path), limits)
}

/// Reads the workbook in `src`, or None when its bytes are not a workbook calamine reads.
pub fn open_from(src: Source, limits: &Limits) -> Result<Option<Book>, Fault> {
    let size = src.size()?;
    if size > limits.workbook {
        return Err(Fault::Refused(format!(
            "it is {size} bytes, past the {} a workbook may be",
            limits.workbook
        )));
    }
    let mut head = [0u8; 8];
    let got = src.reader()?.read(&mut head)?;
    let head = &head[..got];
    if is_zip(head) {
        let look = zip_look(src, limits)?;
        if look.names.iter().any(|n| n == "xl/workbook.xml") {
            return open_xlsx(src, look, size, limits).map(Some);
        }
        if look.names.iter().any(|n| n == "content.xml")
            && zip_part(src, "mimetype", 256).is_some_and(|m| m.ends_with(b"spreadsheet"))
        {
            return open_ods(src, look, size, limits).map(Some);
        }
        return Ok(None);
    }
    if is_cfb(head) {
        return open_xls(src, size, limits).map(Some);
    }
    Ok(None)
}

fn open_xlsx(src: Source, look: ZipLook, size: u64, limits: &Limits) -> Result<Book, Fault> {
    let mut wb: Xlsx<Reading> = Xlsx::new(src.reader()?).map_err(fault)?;
    let macros = look
        .names
        .iter()
        .any(|n| n.eq_ignore_ascii_case("xl/vbaProject.bin"));
    let format = if macros || src.named("xlsm") {
        "xlsm"
    } else {
        "xlsx"
    };
    let properties = wb.workbook_properties().map(props).unwrap_or_default();
    let meta = wb.sheets_metadata().to_vec();
    let mut formats = Formats::default();
    let mut budget = limits.cells;
    // Stored text is cut per cell at `text_chars`, but 2M cells of it is still gigabytes.
    let mut text_left = limits.workbook;
    let mut parts = Vec::new();
    let mut sheets = Vec::new();
    for s in meta {
        let mut part = SheetPart {
            name: s.name.clone(),
            state: state_of(s.visible),
            kind: kind_of(s.typ),
            rows: 0,
            cols: 0,
            cells: 0,
            formulas: 0,
            merged: 0,
            cut: None,
        };
        let mut data = SheetData {
            cells: Vec::new(),
            merges: Vec::new(),
        };
        if s.typ == SheetType::WorkSheet {
            let mut styled: HashMap<(u32, u32), u32> = HashMap::new();
            if let Ok(mut reader) = wb.worksheet_cells_reader(&s.name) {
                let styles = reader.styles().to_vec();
                let mut seen = 0usize;
                while let Ok(Some((cell, id))) = reader.next_cell_with_style_id() {
                    seen += 1;
                    if seen > budget {
                        break;
                    }
                    if !matches!(
                        cell.get_value(),
                        DataRef::Float(_) | DataRef::Int(_) | DataRef::DateTime(_)
                    ) {
                        continue;
                    }
                    let code = styles
                        .get(id)
                        .and_then(|st| st.number_format.as_ref())
                        .map(|n| n.format_code.as_str());
                    if let Some(x) = code.and_then(|c| formats.of(c)) {
                        styled.insert(cell.get_position(), x);
                    }
                }
            }
            match wb.worksheet_cells_reader(&s.name) {
                Ok(mut reader) => loop {
                    match reader.next_cell_with_formula() {
                        Ok(Some(c)) => {
                            let v = value_ref(&c.value, limits);
                            let f = c.formula.filter(|f| !f.is_empty());
                            if v.is_none() && f.is_none() {
                                continue;
                            }
                            if budget == 0 {
                                part.cut = Some(format!(
                                    "read to row {}, where the workbook's {} cells stop",
                                    c.pos.0 + 1,
                                    limits.cells
                                ));
                                break;
                            }
                            let held = match &v {
                                Some(Value::Text { v, .. }) => v.len() as u64,
                                _ => 0,
                            };
                            if held > text_left {
                                part.cut = Some(format!(
                                    "read to row {}, where the workbook's {} bytes of text stop",
                                    c.pos.0 + 1,
                                    limits.workbook
                                ));
                                budget = 0;
                                break;
                            }
                            text_left -= held;
                            budget -= 1;
                            let v = if v.is_none() { Some(Value::None) } else { v };
                            let x = styled.get(&c.pos).copied();
                            data.cells.push((c.pos.0, c.pos.1, Cell { v, f, x }));
                        }
                        Ok(None) => break,
                        Err(e) => {
                            part.cut = Some(format!("read until a fault: {e}"));
                            break;
                        }
                    }
                },
                Err(e) => part.cut = Some(format!("not read: {e}")),
            }
            if let Ok(dims) = wb.merge_cells_by_sheet_name(&s.name) {
                data.merges = merges_of(dims);
            }
        }
        finish(&mut part, &mut data);
        parts.push(part);
        sheets.push(data);
    }
    let links = xlsx_links(src, &look);
    Ok(Book {
        summary: BookSummary {
            format: format.into(),
            sheets: parts,
            formats: formats.codes,
            formats_read: true,
            properties,
            macros,
            links,
            parts: Some(look.names.len() as u32),
            compound: None,
            size,
        },
        sheets,
    })
}

/// Cells from a dense range (xls, ods): calamine reads these whole, within its own caps (BIFF8's 65,536 rows by 256
/// columns; an ods's 100,000,000 cells), and only cells with something in them are kept.
/// A sheet's cells' format codes, by their index in the workbook's codes, and where each lands in `Formats`.
struct SheetCodes<'a> {
    codes: &'a CellCodes,
    cells: Option<&'a HashMap<(u32, u32), u32>>,
    to: Vec<Option<Option<u32>>>,
}

impl<'a> SheetCodes<'a> {
    fn new(codes: &'a CellCodes, sheet: &str) -> Self {
        SheetCodes {
            codes,
            cells: codes.sheets.get(sheet),
            to: vec![None; codes.codes.len()],
        }
    }

    /// The cell's format, as an index in `formats`, and its code.
    fn at(&mut self, pos: (u32, u32), formats: &mut Formats) -> Option<(u32, &'a str)> {
        let i = *self.cells?.get(&pos)? as usize;
        let code = self.codes.codes.get(i)?.as_str();
        let x = *self.to.get_mut(i)?.get_or_insert_with(|| formats.of(code));
        x.map(|x| (x, code))
    }
}

/// A value with a format: an ods's date or time written as ISO text becomes a serial, so its format applies.
fn formatted(d: &Data, v: Value, code: &str) -> Option<Value> {
    match d {
        Data::Int(_) | Data::Float(_) | Data::DateTime(_) => Some(v),
        Data::DateTimeIso(s) => formats::iso_date(s).map(|(v, iso)| Value::Date { v, iso }),
        Data::DurationIso(s) if !code.contains('[') => formats::iso_time(s).map(Value::real),
        _ => None,
    }
}

fn dense_cells(
    values: Option<calamine::Range<Data>>,
    formulas: Option<calamine::Range<String>>,
    mut codes: Option<SheetCodes<'_>>,
    formats: &mut Formats,
    budget: &mut usize,
    part: &mut SheetPart,
    limits: &Limits,
) -> Vec<(u32, u32, Cell)> {
    let mut at: HashMap<(u32, u32), Cell> = HashMap::new();
    if let Some(r) = values {
        let (r0, c0) = r.start().unwrap_or((0, 0));
        for (row, col, d) in r.used_cells() {
            let pos = (r0 + row as u32, c0 + col as u32);
            if let Some(mut v) = value_data(d, limits) {
                let mut x = None;
                if let Some((i, code)) = codes.as_mut().and_then(|c| c.at(pos, formats)) {
                    if let Some(shown) = formatted(d, v.clone(), code) {
                        (v, x) = (shown, Some(i));
                    }
                }
                at.insert(
                    pos,
                    Cell {
                        v: Some(v),
                        f: None,
                        x,
                    },
                );
            }
        }
    }
    if let Some(r) = formulas {
        let (r0, c0) = r.start().unwrap_or((0, 0));
        for (row, col, f) in r.used_cells() {
            if f.is_empty() {
                continue;
            }
            let cell = at
                .entry((r0 + row as u32, c0 + col as u32))
                .or_insert(Cell {
                    v: Some(Value::None),
                    f: None,
                    x: None,
                });
            cell.f = Some(f.clone());
        }
    }
    let mut cells: Vec<(u32, u32, Cell)> =
        at.into_iter().map(|((r, c), cell)| (r, c, cell)).collect();
    cells.sort_by_key(|(r, c, _)| (*r, *c));
    if cells.len() > *budget {
        let last = cells[*budget].0;
        cells.truncate(*budget);
        part.cut = Some(format!(
            "read to row {last}, where the workbook's {} cells stop",
            limits.cells
        ));
    }
    *budget -= cells.len();
    cells
}

fn finish(part: &mut SheetPart, data: &mut SheetData) {
    data.cells.sort_by_key(|(r, c, _)| (*r, *c));
    part.cells = data.cells.len() as u32;
    part.formulas = data.cells.iter().filter(|(_, _, c)| c.f.is_some()).count() as u32;
    part.rows = data.cells.last().map(|(r, _, _)| r + 1).unwrap_or(0);
    part.cols = data.cells.iter().map(|(_, c, _)| c + 1).max().unwrap_or(0);
    for m in &data.merges {
        part.rows = part.rows.max(m[2] + 1);
        part.cols = part.cols.max(m[3] + 1);
    }
    part.merged = data.merges.len() as u32;
}

fn open_xls(src: Source, size: u64, limits: &Limits) -> Result<Book, Fault> {
    let compound = src
        .reader()
        .ok()
        .and_then(|r| cfb::CompoundFile::open(r).ok())
        .map(|c| {
            let sector = match c.version() {
                cfb::Version::V3 => 512,
                cfb::Version::V4 => 4096,
            };
            let streams = c
                .walk()
                .filter(|e| e.is_stream())
                .take(256)
                .map(|e| {
                    (
                        e.path()
                            .to_string_lossy()
                            .trim_start_matches(['/', '\\'])
                            .replace('\\', "/"),
                        e.len(),
                    )
                })
                .collect();
            Compound { sector, streams }
        });
    let mut wb: Xls<Reading> = Xls::new(src.reader()?).map_err(fault)?;
    let codes = formats::xls(src, limits.cells);
    let mut formats = Formats::default();
    let macros = compound.as_ref().is_some_and(|c| {
        c.streams
            .iter()
            .any(|(n, _)| n.starts_with("_VBA_PROJECT_CUR") || n.starts_with("Macros"))
    });
    let properties = wb.workbook_properties().map(props).unwrap_or_default();
    let meta = wb.sheets_metadata().to_vec();
    let mut budget = limits.cells;
    let (mut parts, mut sheets) = (Vec::new(), Vec::new());
    for s in meta {
        let mut part = SheetPart {
            name: s.name.clone(),
            state: state_of(s.visible),
            kind: kind_of(s.typ),
            rows: 0,
            cols: 0,
            cells: 0,
            formulas: 0,
            merged: 0,
            cut: None,
        };
        let mut data = SheetData {
            cells: Vec::new(),
            merges: Vec::new(),
        };
        if s.typ == SheetType::WorkSheet {
            let values = wb.worksheet_range(&s.name).ok();
            let formulas = wb.worksheet_formula(&s.name).ok();
            let codes = codes.as_ref().map(|c| SheetCodes::new(c, &s.name));
            data.cells = dense_cells(
                values,
                formulas,
                codes,
                &mut formats,
                &mut budget,
                &mut part,
                limits,
            );
            data.merges = merges_of(wb.merge_cells_by_sheet_name(&s.name).unwrap_or_default());
        }
        finish(&mut part, &mut data);
        parts.push(part);
        sheets.push(data);
    }
    Ok(Book {
        summary: BookSummary {
            format: "xls".into(),
            sheets: parts,
            formats: formats.codes,
            formats_read: codes.is_some(),
            properties,
            macros,
            links: Vec::new(),
            parts: None,
            compound,
            size,
        },
        sheets,
    })
}

fn open_ods(src: Source, look: ZipLook, size: u64, limits: &Limits) -> Result<Book, Fault> {
    let content = zip_part(src, "content.xml", limits.workbook).unwrap_or_default();
    ods_extent(&content, limits)?;
    let mut wb: Ods<Reading> = Ods::new(src.reader()?).map_err(fault)?;
    let macros = look
        .names
        .iter()
        .any(|n| n.starts_with("Basic/") || n.starts_with("Scripts/"));
    let properties = wb.workbook_properties().map(props).unwrap_or_default();
    let mut styles = OdsStyles::default();
    if let Some(b) = zip_part(src, "styles.xml", limits.workbook) {
        styles.read(&b);
    }
    styles.read(&content);
    let mut gathered = OdsCodes::new(limits.cells);
    let (mut spans, links) = ods_spans(&content, &styles, &mut gathered);
    drop(content);
    let codes = gathered.finish();
    let mut formats = Formats::default();
    let meta = wb.sheets_metadata().to_vec();
    let mut budget = limits.cells;
    let (mut parts, mut sheets) = (Vec::new(), Vec::new());
    for s in meta {
        let mut part = SheetPart {
            name: s.name.clone(),
            state: state_of(s.visible),
            kind: kind_of(s.typ),
            rows: 0,
            cols: 0,
            cells: 0,
            formulas: 0,
            merged: 0,
            cut: None,
        };
        let values = wb.worksheet_range(&s.name).ok();
        let formulas = wb.worksheet_formula(&s.name).ok();
        let mut data = SheetData {
            cells: dense_cells(
                values,
                formulas,
                Some(SheetCodes::new(&codes, &s.name)),
                &mut formats,
                &mut budget,
                &mut part,
                limits,
            ),
            merges: spans.remove(&s.name).unwrap_or_default(),
        };
        finish(&mut part, &mut data);
        parts.push(part);
        sheets.push(data);
    }
    Ok(Book {
        summary: BookSummary {
            format: "ods".into(),
            sheets: parts,
            formats: formats.codes,
            formats_read: true,
            properties,
            macros,
            links,
            parts: Some(look.names.len() as u32),
            compound: None,
            size,
        },
        sheets,
    })
}

impl Book {
    /// Rows `from` up to `from + count` of sheet `sheet`, with the merges that touch them.
    pub fn rows(
        &self,
        sheet: usize,
        from: u32,
        count: u32,
        limits: &Limits,
    ) -> Result<SheetPage, Fault> {
        let data = self
            .sheets
            .get(sheet)
            .ok_or_else(|| Fault::Invalid(format!("the workbook has no sheet {sheet}")))?;
        let to = from.saturating_add(count.min(limits.sheet_rows));
        let a = data.cells.partition_point(|(r, _, _)| *r < from);
        let b = data.cells.partition_point(|(r, _, _)| *r < to);
        Ok(SheetPage {
            from,
            to,
            cells: data.cells[a..b].to_vec(),
            merges: data
                .merges
                .iter()
                .filter(|m| m[2] >= from && m[0] < to)
                .copied()
                .collect(),
        })
    }
}

#[cfg(test)]
#[path = "sheets_tests.rs"]
mod tests;
