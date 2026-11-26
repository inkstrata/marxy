use super::*;
use crate::archive::testkit::{self, Z};
use crate::commands::{archive as archive_cmd, font, media, tables};
use std::fs;
use std::path::{Path, PathBuf};

/// The kept entries are the app's one set: tests that count reads or kept entries take turns.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn demo(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo")
        .join(rel)
}

/// A folder holding held-kinds.zip and the four files it was made from, opened as the page opens a folder.
fn folder(name: &str) -> (PathBuf, RwLock<OpenedSet>) {
    let dir = std::env::temp_dir().join(format!("marxy-held-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dir = dunce::canonicalize(&dir).unwrap();
    for (from, to) in [
        ("archives/held-kinds.zip", "held-kinds.zip"),
        ("data/gauges.sqlite", "gauges.sqlite"),
        ("sheets/tide-log-2026.xlsx", "tide-log-2026.xlsx"),
        ("fonts/TidemarkSans-Regular.ttf", "TidemarkSans-Regular.ttf"),
        ("media/bell-buoy.wav", "bell-buoy.wav"),
    ] {
        fs::copy(demo(from), dir.join(to)).unwrap();
    }
    let mut set = OpenedSet::default();
    set.add_folder(&dir, dir.clone());
    (dir, RwLock::new(set))
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn at(index: u32, name: &str) -> ArchiveEntryRef {
    ArchiveEntryRef {
        index,
        name: name.into(),
    }
}

fn listing(dir: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                e.metadata().unwrap().len(),
            )
        })
        .collect();
    out.sort();
    out
}

const DB: u32 = 0;
const BOOK: u32 = 1;
const FONT: u32 = 2;
const WAV: u32 = 3;

#[test]
fn each_kind_read_from_the_archive_is_the_file_read_from_disk() {
    let _turn = serial();
    let (dir, set) = folder("same");
    let zip = text(&dir.join("held-kinds.zip"));
    let lim = &crate::tables::Limits::DEFAULT;

    let db = at(DB, "data/gauges.sqlite");
    let disk = tables::open_at(&set, &text(&dir.join("gauges.sqlite")), false, None, lim)
        .unwrap()
        .unwrap();
    let held = tables::open_at(&set, &zip, false, Some(&db), lim)
        .unwrap()
        .unwrap();
    let (d, h) = (disk.db.unwrap(), held.db.unwrap());
    assert_eq!(
        (h.state.as_str(), h.copy_why.as_deref()),
        ("copy", Some("entry"))
    );
    assert!(
        h.wal.is_none() && h.shm.is_none(),
        "an entry has nothing beside it"
    );
    assert_eq!(json(&h.parts), json(&d.parts));
    assert_eq!(json(&h.schema), json(&d.schema));
    assert_eq!(json(&h.header), json(&d.header));
    assert_eq!(h.size, d.size);
    for part in d.parts.iter().map(|p| p.name.as_str()) {
        let a = tables::rows_at(
            &set,
            &text(&dir.join("gauges.sqlite")),
            part,
            0,
            50,
            false,
            None,
            lim,
        );
        let b = tables::rows_at(&set, &zip, part, 0, 50, false, Some(&db), lim);
        assert_eq!(a.unwrap(), b.unwrap(), "{part}");
    }

    let book = at(BOOK, "sheets/tide-log-2026.xlsx");
    let disk = tables::open_at(
        &set,
        &text(&dir.join("tide-log-2026.xlsx")),
        false,
        None,
        lim,
    )
    .unwrap()
    .unwrap();
    let held = tables::open_at(&set, &zip, false, Some(&book), lim)
        .unwrap()
        .unwrap();
    assert_eq!(held.kind, "sheet");
    let (d, h) = (disk.book.unwrap(), held.book.unwrap());
    assert_eq!(json(&h), json(&d));
    for s in &d.sheets {
        let a = tables::rows_at(
            &set,
            &text(&dir.join("tide-log-2026.xlsx")),
            &s.name,
            0,
            40,
            false,
            None,
            lim,
        );
        let b = tables::rows_at(&set, &zip, &s.name, 0, 40, false, Some(&book), lim);
        assert_eq!(a.unwrap(), b.unwrap(), "{}", s.name);
    }

    let ttf = at(FONT, "fonts/TidemarkSans-Regular.ttf");
    let disk_font = text(&dir.join("TidemarkSans-Regular.ttf"));
    assert_eq!(
        font::facts_at(&set, &zip, Some(&ttf)).unwrap(),
        font::facts_at(&set, &disk_font, None).unwrap()
    );
    for code in ['A', 'g', '?'] {
        let held = font::glyph_at(&set, &zip, 0, code as u32, Some(&ttf)).unwrap();
        assert!(held.is_some(), "{code}");
        assert_eq!(
            held,
            font::glyph_at(&set, &disk_font, 0, code as u32, None).unwrap()
        );
    }

    let wav = at(WAV, "media/bell-buoy.wav");
    let disk_wav = text(&dir.join("bell-buoy.wav"));
    let facts = media::facts_at(&set, &zip, Some(&wav)).unwrap().unwrap();
    assert_eq!(facts.container, "wav");
    assert_eq!(Some(facts), media::facts_at(&set, &disk_wav, None).unwrap());
    assert_eq!(
        media::envelope_at(&set, &zip, 64, Some(&wav)).unwrap(),
        media::envelope_at(&set, &disk_wav, 64, None).unwrap()
    );
    let _ = fs::remove_dir_all(&dir);
}

fn json<T: serde::Serialize>(v: &T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
}

#[test]
fn a_name_that_does_not_match_an_encrypted_entry_and_one_too_big_are_refused() {
    let _turn = serial();
    let (dir, set) = folder("refused");
    let zip = text(&dir.join("held-kinds.zip"));
    let lim = &crate::tables::Limits::DEFAULT;
    let wrong = at(DB, "fonts/TidemarkSans-Regular.ttf");
    let e = tables::open_at(&set, &zip, false, Some(&wrong), lim)
        .map(|_| ())
        .unwrap_err();
    assert_eq!(e.message, "The archive changed since it was listed.");
    let e = font::facts_at(&set, &zip, Some(&wrong)).unwrap_err();
    assert_eq!(e.message, "The archive changed since it was listed.");

    let big = vec![0u8; 16 * 1024 * 1024 + 1];
    let odd = testkit::zip(
        &[
            Z::stored("locked.sqlite", b"SQLite format 3\0").flagged(1),
            Z::deflated("big.sqlite", &big),
        ],
        b"",
    );
    fs::write(dir.join("odd.zip"), odd).unwrap();
    let raw = text(&dir.join("odd.zip"));
    for (i, name) in [(0, "locked.sqlite"), (1, "big.sqlite")] {
        let read = archive_cmd::read_in(&set, &raw, i, name, &Limits::DEFAULT).unwrap_err();
        let reader = [
            tables::open_at(&set, &raw, false, Some(&at(i, name)), lim).map(|_| ()),
            font::facts_at(&set, &raw, Some(&at(i, name))).map(|_| ()),
            media::facts_at(&set, &raw, Some(&at(i, name))).map(|_| ()),
        ];
        for got in reader {
            let e = got.unwrap_err();
            assert_eq!(
                (e.code.as_str(), e.message.as_str()),
                (read.code.as_str(), read.message.as_str()),
                "{name}"
            );
        }
    }
    assert!(
        archive_cmd::read_in(&set, &raw, 0, "locked.sqlite", &Limits::DEFAULT)
            .unwrap_err()
            .message
            .contains("encrypted")
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn an_entry_is_read_once_and_the_kept_ones_are_bounded() {
    let _turn = serial();
    let (dir, set) = folder("kept");
    let zip = text(&dir.join("held-kinds.zip"));
    let lim = &crate::tables::Limits::DEFAULT;
    let db = at(DB, "data/gauges.sqlite");
    let reads = || READS.with(|r| r.get());
    let before = reads();
    tables::open_at(&set, &zip, false, Some(&db), lim).unwrap();
    assert_eq!(reads() - before, 1);
    tables::rows_at(&set, &zip, "readings", 0, 20, false, Some(&db), lim).unwrap();
    tables::rows_at(&set, &zip, "readings", 20, 20, false, Some(&db), lim).unwrap();
    tables::open_at(&set, &zip, false, Some(&db), lim).unwrap();
    assert_eq!(reads() - before, 1, "the database is held, not read again");
    let ttf = at(FONT, "fonts/TidemarkSans-Regular.ttf");
    font::facts_at(&set, &zip, Some(&ttf)).unwrap();
    for code in 'A'..='Z' {
        font::glyph_at(&set, &zip, 0, code as u32, Some(&ttf)).unwrap();
    }
    assert_eq!(reads() - before, 2, "facts and every glyph from one read");

    // Six entries asked of, four kept: the oldest go first.
    let wav = at(WAV, "media/bell-buoy.wav");
    let book = at(BOOK, "sheets/tide-log-2026.xlsx");
    media::facts_at(&set, &zip, Some(&wav)).unwrap();
    media::envelope_at(&set, &zip, 32, Some(&wav)).unwrap();
    tables::open_at(&set, &zip, false, Some(&book), lim).unwrap();
    assert_eq!(reads() - before, 4);
    let fonts = testkit::zip(
        &[
            Z::stored(
                "a.ttf",
                &fs::read(demo("fonts/TidemarkSans-Regular.ttf")).unwrap(),
            ),
            Z::stored(
                "b.ttf",
                &fs::read(demo("fonts/TidemarkSans-Regular.ttf")).unwrap(),
            ),
        ],
        b"",
    );
    fs::write(dir.join("fonts.zip"), fonts).unwrap();
    let other = text(&dir.join("fonts.zip"));
    font::facts_at(&set, &other, Some(&at(0, "a.ttf"))).unwrap();
    font::facts_at(&set, &other, Some(&at(1, "b.ttf"))).unwrap();
    let (n, bytes) = kept();
    assert!(n <= KEPT && bytes <= BUDGET, "{n} kept, {bytes} bytes");
    tables::open_at(&set, &zip, false, Some(&db), lim).unwrap();
    assert_eq!(reads() - before, 7, "the database was the oldest, and went");

    // Over the budget: only what fits is kept, and the newest always is.
    keep(Kept {
        key: crate::archive::Key::of(
            &dir.join("fonts.zip"),
            &fs::File::open(dir.join("fonts.zip")).unwrap(),
        )
        .unwrap(),
        at: at(9, "huge"),
        what: "test",
        weight: BUDGET - 1,
        made: Arc::new(()),
    });
    let (n, bytes) = kept();
    assert_eq!((n, bytes), (1, BUDGET - 1));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reading_entries_creates_nothing_on_disk_and_runs_nothing() {
    let _turn = serial();
    let (dir, set) = folder("nothing");
    let zip = text(&dir.join("held-kinds.zip"));
    let lim = &crate::tables::Limits::DEFAULT;
    let before = listing(&dir);
    let archive_bytes = fs::read(dir.join("held-kinds.zip")).unwrap();
    let temp = std::env::temp_dir();
    let stray = |d: &Path| {
        fs::read_dir(d)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            // The table tests' own fixture folders (`marxy-tables-<pid>-...`) are made in parallel threads beside this one.
            .filter(|n| !n.starts_with("marxy-tables-"))
            .filter(|n| n.contains("gauges") || n.contains("held-kinds") || n.starts_with("etilqs"))
            .collect::<Vec<_>>()
    };
    let temp_before = stray(&temp);

    let db = at(DB, "data/gauges.sqlite");
    let summary = tables::open_at(&set, &zip, false, Some(&db), lim)
        .unwrap()
        .unwrap()
        .db
        .unwrap();
    assert!(
        summary.schema.iter().any(|e| e.kind == "trigger"),
        "gauges has a trigger"
    );
    for part in summary.parts.iter().map(|p| p.name.as_str()) {
        tables::rows_at(&set, &zip, part, 0, 200, false, Some(&db), lim).unwrap();
    }
    tables::open_at(
        &set,
        &zip,
        false,
        Some(&at(BOOK, "sheets/tide-log-2026.xlsx")),
        lim,
    )
    .unwrap();
    font::glyph_at(
        &set,
        &zip,
        0,
        'A' as u32,
        Some(&at(FONT, "fonts/TidemarkSans-Regular.ttf")),
    )
    .unwrap();
    media::envelope_at(&set, &zip, 64, Some(&at(WAV, "media/bell-buoy.wav"))).unwrap();

    assert_eq!(
        listing(&dir),
        before,
        "the archive's folder holds the same files"
    );
    assert_eq!(fs::read(dir.join("held-kinds.zip")).unwrap(), archive_bytes);
    assert_eq!(
        stray(&temp),
        temp_before,
        "nothing of it in the temp folder"
    );
    let _ = fs::remove_dir_all(&dir);
}
