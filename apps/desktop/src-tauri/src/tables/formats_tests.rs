use super::*;
use crate::tables::sheets::{open, Book, Cell};
use crate::tables::{Limits, Value};
use std::path::Path;

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/sheets")
        .join(name)
}

fn demo(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/sheets")
        .join(name)
}

fn cell(b: &Book, r: u32, c: u32) -> Cell {
    let page = b.rows(0, r, 1, &Limits::DEFAULT).unwrap();
    page.cells
        .into_iter()
        .find(|(_, col, _)| *col == c)
        .map(|(_, _, cell)| cell)
        .unwrap_or_else(|| panic!("no cell at {r},{c}"))
}

fn code(b: &Book, r: u32, c: u32) -> Option<String> {
    cell(b, r, c)
        .x
        .map(|x| b.summary.formats[x as usize].clone())
}

#[test]
fn an_xls_names_each_number_cells_format_from_its_xf() {
    let b = open(&fixture("number-formats.xls"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(b.summary.formats_read);
    assert_eq!(
        code(&b, 1, 1).as_deref(),
        Some("0.00%"),
        "a builtin percentage"
    );
    assert_eq!(
        code(&b, 2, 1).as_deref(),
        Some("\"£\"#,##0.00"),
        "a FORMAT record of the file's"
    );
    assert_eq!(code(&b, 3, 1).as_deref(), Some("0.00"));
    assert_eq!(code(&b, 4, 1).as_deref(), Some("d mmm yyyy"));
    assert_eq!(code(&b, 5, 1).as_deref(), Some("#,##0"), "an RK cell");
    assert_eq!(code(&b, 6, 1), None, "General is no format");
    assert_eq!(code(&b, 7, 1).as_deref(), Some("0%"), "a MULRK's first");
    assert_eq!(code(&b, 7, 2).as_deref(), Some("0.00"), "a MULRK's second");
    assert_eq!(
        code(&b, 8, 1).as_deref(),
        Some("0.00%"),
        "a formula's cached value"
    );
    assert_eq!(code(&b, 9, 1).as_deref(), Some("hh:mm"));
    // The date is still a date, as calamine read it, with its format beside it.
    let Some(Value::Date { iso, .. }) = cell(&b, 4, 1).v else {
        panic!("{:?}", cell(&b, 4, 1))
    };
    assert_eq!(iso, "2026-10-31T00:00:00");
    // Text has no format.
    assert_eq!(code(&b, 0, 0), None);
}

#[test]
fn the_demo_xls_shows_its_builtin_formats() {
    let b = open(&demo("harbour-dues-1999.xls"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(b.summary.formats_read);
    assert_eq!(code(&b, 3, 1).as_deref(), Some("0.00"));
    assert_eq!(code(&b, 3, 2).as_deref(), Some("0"));
    assert_eq!(code(&b, 3, 3).as_deref(), Some("#,##0.00"));
    assert_eq!(
        code(&b, 11, 3).as_deref(),
        Some("#,##0.00"),
        "the total, a formula"
    );
}

#[test]
fn an_ods_writes_its_data_styles_as_format_codes() {
    let b = open(&fixture("number-formats.ods"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(b.summary.formats_read);
    assert_eq!(code(&b, 1, 1).as_deref(), Some("0.00%"));
    assert_eq!(code(&b, 2, 1).as_deref(), Some("\"£\"#,##0.00"));
    assert_eq!(code(&b, 3, 1).as_deref(), Some("0.00"));
    assert_eq!(code(&b, 4, 1).as_deref(), Some("d\" \"mmm\" \"yyyy"));
    assert_eq!(code(&b, 5, 1).as_deref(), Some("#,##0"));
    assert_eq!(code(&b, 6, 1), None, "no style: General");
    assert_eq!(code(&b, 7, 1).as_deref(), Some("hh\":\"mm"));
    assert_eq!(
        code(&b, 8, 1).as_deref(),
        Some("\"€\"#,##0.00;\"-\"\"€\"#,##0.00"),
        "the style its map applies to a value at or above 0 comes first"
    );
    assert_eq!(
        code(&b, 9, 1).as_deref(),
        Some("0%"),
        "from the common style it inherits"
    );
    assert_eq!(
        code(&b, 10, 2).as_deref(),
        Some("0.00"),
        "its column's default"
    );
    // An ods writes a date and a time as text; with a format they are serials, so the format applies.
    assert_eq!(
        cell(&b, 4, 1).v,
        Some(Value::Date {
            v: 46_326.0,
            iso: "2026-10-31T00:00:00".into()
        })
    );
    let Some(Value::Real { v: Some(t), .. }) = cell(&b, 7, 1).v else {
        panic!("{:?}", cell(&b, 7, 1))
    };
    assert!((t - 6.5 / 24.0).abs() < 1e-12);
}

#[test]
fn the_demo_ods_shows_its_percentages_decimals_and_dates() {
    let b = open(&demo("tide-log-2026.ods"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(code(&b, 4, 2).as_deref(), Some("0.00"));
    assert_eq!(code(&b, 4, 5).as_deref(), Some("0.0%"));
    assert_eq!(
        code(&b, 12, 1).as_deref(),
        Some("yyyy\"-\"mm\"-\"dd\" \"hh\":\"mm")
    );
}

#[test]
fn a_biff_stream_that_is_not_one_or_is_encrypted_has_no_formats() {
    assert!(xls_stream(b"not biff", 10).is_none());
    let mut b = Vec::new();
    b.extend_from_slice(&[0x09, 0x08, 4, 0, 0x00, 0x06, 0x05, 0x00]);
    b.extend_from_slice(&[0x2F, 0x00, 0, 0]);
    assert!(xls_stream(&b, 10).is_none());
}

#[test]
fn a_biff_streams_cells_stop_at_the_cap() {
    let bytes = std::fs::read(fixture("number-formats.xls")).unwrap();
    let mut c = cfb::CompoundFile::open(std::io::Cursor::new(bytes)).unwrap();
    let mut s = Vec::new();
    c.open_stream("/Workbook")
        .unwrap()
        .read_to_end(&mut s)
        .unwrap();
    let all = xls_stream(&s, usize::MAX).unwrap();
    assert_eq!(
        all.sheets["Formats"].len(),
        9,
        "every number but the General one"
    );
    assert_eq!(xls_stream(&s, 3).unwrap().sheets["Formats"].len(), 3);
}

#[test]
fn ods_dates_and_times_read_as_serials() {
    assert_eq!(
        iso_date("1900-03-01"),
        Some((61.0, "1900-03-01T00:00:00".into()))
    );
    let (v, iso) = iso_date("2026-10-31T23:43:00").unwrap();
    assert!((v - (46_326.0 + (23.0 * 60.0 + 43.0) / 1440.0)).abs() < 1e-9);
    assert_eq!(iso, "2026-10-31T23:43:00");
    assert_eq!(iso_date("2026-13-01"), None);
    assert_eq!(iso_time("PT12H00M00S"), Some(0.5));
    assert_eq!(
        iso_time("PT30H00M00S"),
        None,
        "a day or more is elapsed time"
    );
    assert_eq!(builtin(10), Some("0.00%"));
    assert_eq!(builtin(0), None);
}
