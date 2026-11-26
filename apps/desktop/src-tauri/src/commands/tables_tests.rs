use super::*;
use std::fs;

fn demo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/demo")
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("marxy-tables-cmd-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dunce::canonicalize(&dir).unwrap()
}

fn set_of(folder: &Path) -> RwLock<OpenedSet> {
    let mut set = OpenedSet::default();
    set.add_folder(folder, folder.to_path_buf());
    RwLock::new(set)
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn tables_are_read_only_for_what_the_page_opened() {
    let dir = temp_dir("scope");
    let (inside, outside) = (dir.join("inside"), dir.join("outside"));
    fs::create_dir_all(&inside).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::copy(demo().join("data/gauges.sqlite"), inside.join("g.sqlite")).unwrap();
    fs::copy(demo().join("data/gauges.sqlite"), outside.join("g.sqlite")).unwrap();
    fs::copy(
        demo().join("sheets/tide-log-2026.xlsx"),
        inside.join("t.xlsx"),
    )
    .unwrap();
    let set = set_of(&inside);
    let limits = Limits::DEFAULT;
    let db = open_in(&set, &text(&inside.join("g.sqlite")), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(db.kind, "sqlite");
    let page = rows_in(
        &set,
        &text(&inside.join("g.sqlite")),
        "stations",
        0,
        200,
        false,
        &limits,
    )
    .unwrap();
    assert_eq!(page["rows"].as_array().unwrap().len(), 6);
    let blob = blob_in(
        &set,
        &text(&inside.join("g.sqlite")),
        "stations",
        Some(1),
        0,
        "photo",
        8,
        false,
        &limits,
    )
    .unwrap();
    assert_eq!(blob, b"\x89PNG\r\n\x1a\n");
    let book = open_in(&set, &text(&inside.join("t.xlsx")), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(book.kind, "sheet");
    let sheet = rows_in(
        &set,
        &text(&inside.join("t.xlsx")),
        "Lookup",
        0,
        2_000,
        false,
        &limits,
    )
    .unwrap();
    assert_eq!(sheet["cells"].as_array().unwrap().len(), 8);
    let refused = open_in(&set, &text(&outside.join("g.sqlite")), false, &limits)
        .err()
        .unwrap();
    assert_eq!(refused.code, "permission");
}

fn b64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// What the browser build's memory shell answers for the demo's databases and workbooks (`src/harness/tables-demo.json`):
/// each file's summary and every row of each part, as these readers give them. Run by hand when a reader changes:
/// `cargo test write_the_demo_tables -- --ignored`.
#[test]
#[ignore]
fn write_the_demo_tables() {
    let all = Limits {
        db_rows: u32::MAX,
        sheet_rows: u32::MAX,
        ..Limits::DEFAULT
    };
    let dir = temp_dir("dump");
    let mut out = serde_json::Map::new();
    let files = [
        "data/gauges.sqlite",
        "data/journal.sqlite",
        "data/tidemark-cache.db",
        "sheets/tide-log-2026.xlsx",
        "sheets/tide-log-2026.ods",
        "sheets/harbour-dues-1999.xls",
    ];
    for rel in files {
        let name = Path::new(rel).file_name().unwrap();
        let path = dir.join(name);
        fs::copy(demo().join(rel), &path).unwrap();
        for side in ["-wal", "-shm"] {
            let mut s = demo().join(rel).into_os_string();
            s.push(side);
            if Path::new(&s).is_file() {
                let mut to = path.clone().into_os_string();
                to.push(side);
                fs::copy(&s, &to).unwrap();
            }
        }
        // The demo's cache is held by tidemark as it runs: a lock taken here stands for it.
        let holder = (rel == "data/tidemark-cache.db").then(|| {
            let c = rusqlite::Connection::open(&path).unwrap();
            c.execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
                .unwrap();
            c
        });
        let mut entry = serde_json::Map::new();
        for alone in [false, true] {
            if alone && rel != "data/journal.sqlite" {
                continue;
            }
            let o = opened(&path, alone, &all).unwrap().unwrap();
            let o = o.lock().unwrap();
            let mut pages = serde_json::Map::new();
            let mut blobs = serde_json::Map::new();
            let summary = match &*o {
                Opened::Db(db) => {
                    for p in &db.summary.parts {
                        let page = db.rows(&p.name, 0, u32::MAX, &all).unwrap();
                        for (i, row) in page.rows.iter().enumerate() {
                            for (j, v) in row.iter().enumerate() {
                                if let Some(crate::tables::Value::Blob { n }) = v {
                                    if *n <= 64 * 1024 {
                                        let rowid = page.rowids.as_ref().map(|r| r[i]);
                                        let col = &p.columns[j].name;
                                        let bytes =
                                            db.blob(&p.name, rowid, i as u64, col, *n).unwrap();
                                        blobs.insert(
                                            format!("{}\u{0}{}\u{0}{}", p.name, i, col),
                                            b64(&bytes).into(),
                                        );
                                    }
                                }
                            }
                        }
                        pages.insert(p.name.clone(), serde_json::to_value(page).unwrap());
                    }
                    serde_json::to_value(TablesSummary {
                        kind: "sqlite".into(),
                        db: Some(db.summary.clone()),
                        book: None,
                    })
                }
                Opened::Book(b) => {
                    for (i, s) in b.summary.sheets.iter().enumerate() {
                        pages.insert(
                            s.name.clone(),
                            serde_json::to_value(b.rows(i, 0, u32::MAX, &all).unwrap()).unwrap(),
                        );
                    }
                    serde_json::to_value(TablesSummary {
                        kind: "sheet".into(),
                        db: None,
                        book: Some(b.summary.clone()),
                    })
                }
            };
            let mut one = serde_json::Map::new();
            one.insert("summary".into(), summary.unwrap());
            one.insert("pages".into(), pages.into());
            one.insert("blobs".into(), blobs.into());
            entry.insert(if alone { "alone" } else { "read" }.into(), one.into());
        }
        drop(holder);
        out.insert(rel.into(), entry.into());
    }
    let to = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/harness/tables-demo.json");
    fs::write(to, serde_json::to_string(&out).unwrap()).unwrap();
}

fn ods_of(cell: &str) -> Vec<u8> {
    use std::io::Write;
    let mut out = std::io::Cursor::new(Vec::new());
    let mut z = zip::ZipWriter::new(&mut out);
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("mimetype", opts).unwrap();
    z.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
        .unwrap();
    z.start_file("META-INF/manifest.xml", opts).unwrap();
    z.write_all(br#"<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>"#)
        .unwrap();
    z.start_file("content.xml", opts).unwrap();
    let doc = format!(
        r#"<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="S"><table:table-row><table:table-cell office:value-type="string"><text:p>{cell}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#
    );
    z.write_all(doc.as_bytes()).unwrap();
    z.finish().unwrap();
    out.into_inner()
}

#[test]
fn export_reads_a_cell_whole_after_the_page_read_it_cut() {
    let dir = temp_dir("whole-text");
    fs::write(dir.join("w.ods"), ods_of(&"a".repeat(5_000))).unwrap();
    let set = set_of(&dir);
    let raw = text(&dir.join("w.ods"));
    open_in(&set, &raw, false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    let whole = rows_in(&set, &raw, "S", 0, 10, false, &read_limits(true)).unwrap();
    let cell = whole["cells"][0][2]["v"]["v"].as_str().unwrap().len();
    assert_eq!(cell, 5_000, "{whole}");
}
