use super::*;
use std::path::Path;

fn demo(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/sheets")
        .join(name)
}

fn sheet<'a>(b: &'a Book, name: &str) -> &'a SheetPart {
    b.summary.sheets.iter().find(|s| s.name == name).unwrap()
}

fn cell(b: &Book, sheet: &str, r: u32, c: u32) -> Option<Cell> {
    let at = b
        .summary
        .sheets
        .iter()
        .position(|s| s.name == sheet)
        .unwrap();
    let page = b.rows(at, r, 1, &Limits::DEFAULT).unwrap();
    page.cells
        .into_iter()
        .find(|(_, col, _)| *col == c)
        .map(|(_, _, cell)| cell)
}

#[test]
fn an_xlsx_reads_its_saved_values_formulas_formats_merges_and_hidden_sheets() {
    let before = std::fs::read(demo("tide-log-2026.xlsx")).unwrap();
    let b = open(&demo("tide-log-2026.xlsx"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(b.summary.format, "xlsx");
    let names: Vec<(&str, &str)> = b
        .summary
        .sheets
        .iter()
        .map(|s| (s.name.as_str(), s.state.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            ("Summary", "visible"),
            ("Readings", "visible"),
            ("Stations", "visible"),
            ("Lookup", "hidden"),
            ("_calc", "very")
        ]
    );
    let summary = sheet(&b, "Summary");
    assert_eq!(
        (summary.rows, summary.cols, summary.formulas, summary.merged),
        (17, 7, 37, 3)
    );
    assert_eq!(sheet(&b, "Readings").rows, 2_601);
    assert_eq!(sheet(&b, "Lookup").rows, 4);

    // F5: a percentage worked out by the app that saved it.
    let f5 = cell(&b, "Summary", 4, 5).unwrap();
    let Some(Value::Real { v: Some(v), .. }) = f5.v else {
        panic!("{f5:?}")
    };
    assert!((v - 0.034_562_211_981_566_82).abs() < 1e-12);
    assert_eq!(b.summary.formats[f5.x.unwrap() as usize], "0.0%");
    assert!(f5.f.as_deref().unwrap().starts_with("COUNTIFS("));
    // G5 is an error as saved; B12 a formula never worked out.
    assert_eq!(
        cell(&b, "Summary", 4, 6).unwrap().v,
        Some(Value::Err {
            v: "#DIV/0!".into()
        })
    );
    let b12 = cell(&b, "Summary", 11, 1).unwrap();
    assert_eq!(
        (b12.v, b12.f.as_deref()),
        (Some(Value::None), Some("B11*2"))
    );
    let page = b.rows(1, 0, 5_000, &Limits::DEFAULT).unwrap();
    assert_eq!(page.to, 2_000, "a page is at most 2,000 rows");
    assert!(page.cells.iter().all(|(r, _, _)| *r < 2_000));
    assert!(b.summary.parts.is_some_and(|n| n > 5));
    assert!(!b.summary.macros && b.summary.links.is_empty());
    assert_eq!(std::fs::read(demo("tide-log-2026.xlsx")).unwrap(), before);
}

#[test]
fn an_ods_reads_the_same_page_with_merges_from_its_spans() {
    let b = open(&demo("tide-log-2026.ods"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(b.summary.format, "ods");
    assert!(
        b.summary.sheets.iter().any(|s| s.state == "hidden"),
        "{:?}",
        b.summary.sheets
    );
    let first = &b.summary.sheets[0];
    assert!(first.merged >= 1, "{first:?}");
    assert!(first.formulas >= 1, "{first:?}");
    let page = b.rows(0, 0, 2_000, &Limits::DEFAULT).unwrap();
    assert!(
        page.merges
            .iter()
            .any(|m| m[0] == 0 && m[1] == 0 && m[3] > 0),
        "{:?}",
        page.merges
    );
}

#[test]
fn an_xls_reads_its_biff_cells_and_its_compound_directory() {
    let b = open(&demo("harbour-dues-1999.xls"), &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(b.summary.format, "xls");
    let names: Vec<(&str, &str)> = b
        .summary
        .sheets
        .iter()
        .map(|s| (s.name.as_str(), s.state.as_str()))
        .collect();
    assert_eq!(names, [("Dues", "visible"), ("Notes", "hidden")]);
    let compound = b.summary.compound.as_ref().unwrap();
    assert_eq!(compound.sector, 512);
    assert!(
        compound.streams.iter().any(|(n, _)| n == "Workbook"),
        "{:?}",
        compound.streams
    );
    let d12 = cell(&b, "Dues", 11, 3).unwrap();
    let Some(Value::Real { v: Some(v), .. }) = d12.v else {
        panic!("{d12:?}")
    };
    assert!((v - 797.3).abs() < 1e-9);
    assert_eq!(d12.f.as_deref(), Some("SUM(D4:D11)"));
    assert_eq!(sheet(&b, "Dues").merged, 1);
}

#[test]
fn a_workbook_stops_at_its_cell_cap_and_says_where() {
    let limits = Limits {
        cells: 100,
        ..Limits::DEFAULT
    };
    let b = open(&demo("tide-log-2026.xlsx"), &limits).unwrap().unwrap();
    let cut: Vec<_> = b
        .summary
        .sheets
        .iter()
        .filter_map(|s| s.cut.as_deref())
        .collect();
    assert!(!cut.is_empty());
    assert!(b.summary.sheets.iter().map(|s| s.cells).sum::<u32>() <= 100);
}

#[test]
fn bytes_that_are_not_a_workbook_are_none() {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/demo/data/vault.db");
    assert!(open(&p, &Limits::DEFAULT).unwrap().is_none());
}

/// An ods holding `content` as its content.xml, stored.
fn ods_with(content: &str) -> Vec<u8> {
    use std::io::Write;
    let mut out = std::io::Cursor::new(Vec::new());
    let mut z = zip::ZipWriter::new(&mut out);
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("mimetype", opts).unwrap();
    z.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
        .unwrap();
    z.start_file("content.xml", opts).unwrap();
    z.write_all(content.as_bytes()).unwrap();
    z.finish().unwrap();
    out.into_inner()
}

fn ods_doc(rows: &str) -> String {
    format!(
        r#"<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="S">{rows}</table:table></office:spreadsheet></office:body></office:document-content>"#
    )
}

#[test]
fn an_ods_that_repeats_into_millions_of_cells_is_refused_before_it_is_expanded() {
    let doc = ods_doc(
        r#"<table:table-row table:number-rows-repeated="6000"><table:table-cell office:value-type="float" office:value="1" table:number-columns-repeated="16000"/></table:table-row>"#,
    );
    let dir = std::env::temp_dir().join(format!("marxy-ods-bomb-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("bomb.ods");
    std::fs::write(&path, ods_with(&doc)).unwrap();
    let t = std::time::Instant::now();
    let r = open(&path, &Limits::DEFAULT);
    assert!(matches!(r, Err(Fault::Refused(_))));
    assert!(t.elapsed().as_secs() < 2);
}

#[test]
fn an_ods_with_repeated_text_is_counted_by_its_bytes() {
    let text = "a".repeat(10_000);
    let doc = ods_doc(&format!(
        r#"<table:table-row><table:table-cell office:value-type="string" table:number-columns-repeated="90"><text:p>{text}</text:p></table:table-cell></table:table-row>"#
    ));
    let limits = Limits {
        workbook: 100_000,
        ..Limits::DEFAULT
    };
    assert!(ods_extent(doc.as_bytes(), &limits).is_err());
    assert!(ods_extent(doc.as_bytes(), &Limits::DEFAULT).is_ok());
}

#[test]
fn a_small_ods_passes_the_extent_check() {
    let doc = ods_doc(
        r#"<table:table-row table:number-rows-repeated="3"><table:table-cell office:value-type="float" office:value="1" table:number-columns-repeated="4"/></table:table-row>"#,
    );
    assert!(ods_extent(doc.as_bytes(), &Limits::DEFAULT).is_ok());
}
