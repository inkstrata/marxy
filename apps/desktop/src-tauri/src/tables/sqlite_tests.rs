use super::*;
use std::fs;

fn demo(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/data")
        .join(name)
}

/// A folder of its own holding copies of `names` from the demo, so nothing reads the fixtures in place.
///
/// `open` takes the canonical path the scope judged. The temp folder is not canonical everywhere (on macOS it is
/// `/var/folders/...`, a link to `/private/var/folders/...`), so each test folder is canonicalised once it exists.
fn copied(tag: &str, names: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("marxy-tables-{}-{tag}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dir = dunce::canonicalize(&dir).unwrap();
    for n in names {
        fs::copy(demo(n), dir.join(n)).unwrap();
    }
    dir
}

/// Each file beside the database by name, with its size and a hash of its bytes.
fn listing(dir: &Path) -> Vec<(String, usize, u64)> {
    use std::hash::{Hash, Hasher};
    let mut out: Vec<(String, usize, u64)> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| {
            let bytes = fs::read(e.path()).unwrap();
            let mut h = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut h);
            (
                e.file_name().to_string_lossy().into_owned(),
                bytes.len(),
                h.finish(),
            )
        })
        .collect();
    out.sort();
    out
}

fn part<'a>(db: &'a Db, name: &str) -> &'a DbPart {
    db.summary.parts.iter().find(|p| p.name == name).unwrap()
}

fn text(v: &str) -> Option<Value> {
    Some(Value::Text {
        v: v.into(),
        more: None,
    })
}

#[test]
fn a_row_past_i64_is_refused_not_wrapped_to_the_first_page() {
    let dir = copied("rows-wrap", &["gauges.sqlite"]);
    let limits = Limits::DEFAULT;
    let db = open(&dir.join("gauges.sqlite"), false, &limits)
        .unwrap()
        .unwrap();
    assert!(matches!(
        db.rows("stations", u64::MAX, 10, &limits),
        Err(Fault::Invalid(_))
    ));
    assert!(db.rows("stations", 0, 10, &limits).is_ok());
}

#[test]
fn a_database_is_read_in_place_and_nothing_beside_it_changes() {
    let dir = copied("gauges", &["gauges.sqlite"]);
    let before = listing(&dir);
    let limits = Limits::DEFAULT;
    let db = open(&dir.join("gauges.sqlite"), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(db.summary.state, "place");
    assert_eq!(db.summary.header.journal, "rollback");
    assert_eq!(db.summary.header.page_size, 4096);
    let names: Vec<(&str, &str, Option<u64>)> = db
        .summary
        .parts
        .iter()
        .map(|p| (p.name.as_str(), p.kind.as_str(), p.rows))
        .collect();
    assert!(
        names.contains(&("readings", "table", Some(1240))),
        "{names:?}"
    );
    assert!(names.contains(&("stations", "table", Some(6))));
    assert!(names.contains(&("daily_high", "view", None)));
    assert!(names
        .iter()
        .any(|(n, k, _)| *n == "sqlite_sequence" && *k == "internal"));
    assert!(part(&db, "tide_constants").key_order);
    let readings = part(&db, "readings");
    assert!(!readings.rowid && readings.columns[0].rowid && readings.columns[0].key);
    assert_eq!(readings.columns[3].decl, "REAL");
    assert!(db.summary.schema.iter().any(|e| e.kind == "trigger"));

    let page = db.rows("readings", 200, 200, &limits).unwrap();
    assert_eq!(page.rows.len(), 200);
    assert_eq!(page.rowids.as_ref().unwrap()[0], 201);
    assert_eq!(page.total, Some(1240));
    let last = db.rows("readings", 1200, 200, &limits).unwrap();
    assert_eq!(last.rows.len(), 40);

    let stations = db.rows("stations", 0, 200, &limits).unwrap();
    let photo = part(&db, "stations")
        .columns
        .iter()
        .position(|c| c.name == "photo")
        .unwrap();
    let Some(Value::Blob { n }) = stations.rows[1][photo] else {
        panic!("{:?}", stations.rows[1][photo])
    };
    assert_eq!(n, 17_395);
    let head = db.blob("stations", Some(2), 1, "photo", 64).unwrap();
    assert_eq!(&head[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(head.len(), 64);
    let whole = db
        .blob("stations", Some(2), 1, "photo", limits.blob)
        .unwrap();
    assert_eq!(whole.len(), 17_395);

    let view = db.rows("daily_high", 0, 200, &limits).unwrap();
    assert_eq!(
        view.columns.as_deref().unwrap(),
        ["station", "day", "high_m"]
    );
    assert!(view.total.is_some_and(|n| n > 0) && view.stopped.is_none());
    drop(db);
    assert_eq!(
        listing(&dir),
        before,
        "nothing was written beside the database"
    );
}

#[test]
fn text_past_the_cap_is_cut_and_a_without_rowid_table_reads_in_key_order() {
    let dir = copied("cut", &[]);
    let path = dir.join("cut.sqlite");
    {
        let c = Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);
             CREATE TABLE k(a TEXT, b INT, PRIMARY KEY(a, b)) WITHOUT ROWID;
             CREATE TABLE plain(name TEXT PRIMARY KEY, n);
             CREATE INDEX plain_n ON plain(n, name);
             INSERT INTO k VALUES ('b', 2), ('a', 9), ('a', 1);
             INSERT INTO plain VALUES ('z', 2), ('y', 1);",
        )
        .unwrap();
        c.execute("INSERT INTO notes(body) VALUES (?1)", ["é".repeat(2_500)])
            .unwrap();
    }
    let limits = Limits::DEFAULT;
    let db = open(&path, false, &limits).unwrap().unwrap();
    let page = db.rows("notes", 0, 10, &limits).unwrap();
    let Some(Value::Text { v, more }) = &page.rows[0][1] else {
        panic!()
    };
    assert_eq!((v.chars().count(), *more), (2_000, Some(500)));
    let k = db.rows("k", 0, 10, &limits).unwrap();
    let firsts: Vec<_> = k.rows.iter().map(|r| r[0].clone()).collect();
    assert_eq!(firsts, vec![text("a"), text("a"), text("b")]);
    assert!(k.rowids.is_none() && part(&db, "k").key_order);
    assert!(
        part(&db, "plain").rowid,
        "a rowid table with a TEXT key shows its rowid"
    );
    let plain = db.rows("plain", 0, 10, &limits).unwrap();
    assert_eq!(
        plain.rows[0][0],
        text("z"),
        "stored order, not the covering index's"
    );
}

#[test]
fn a_wal_database_reads_with_its_log_and_alone_without_it_writing_nothing() {
    let dir = copied(
        "wal",
        &["journal.sqlite", "journal.sqlite-wal", "journal.sqlite-shm"],
    );
    let before = listing(&dir);
    let limits = Limits::DEFAULT;
    let db = open(&dir.join("journal.sqlite"), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(db.summary.state, "wal");
    let wal = db.summary.wal.as_ref().unwrap();
    assert_eq!((wal.frames, wal.commits, wal.read), (7, 3, true));
    assert_eq!(part(&db, "entries").rows, Some(52));
    drop(db);
    let alone = open(&dir.join("journal.sqlite"), true, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(alone.summary.state, "alone");
    assert_eq!(part(&alone, "entries").rows, Some(40));
    assert!(!alone.summary.wal.as_ref().unwrap().read);
    drop(alone);
    assert_eq!(
        listing(&dir),
        before,
        "nothing was written, checkpointed or rolled back"
    );
}

#[test]
fn a_wal_database_with_no_index_beside_it_is_read_without_making_one() {
    let dir = copied("noshm", &["journal.sqlite", "journal.sqlite-wal"]);
    let before = listing(&dir);
    let db = open(&dir.join("journal.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(
        part(&db, "entries").rows,
        Some(52),
        "{:?}",
        db.summary.state
    );
    drop(db);
    assert_eq!(listing(&dir), before);
}

#[test]
fn the_log_laid_over_a_copy_matches_what_sqlite_reads() {
    let wal_bytes = fs::read(demo("journal.sqlite-wal")).unwrap();
    let log = wal::read(&wal_bytes).unwrap();
    assert_eq!((log.frames, log.committed, log.commits), (7, 7, 3));
    let mut db = fs::read(demo("journal.sqlite")).unwrap();
    wal::apply(&mut db, &log, &wal_bytes, u64::MAX).unwrap();
    assert_eq!(db.len() as u32, log.db_pages * log.page_size);
}

#[test]
fn a_database_another_program_holds_is_read_from_a_copy_in_memory() {
    let dir = copied("locked", &[]);
    let path = dir.join("held.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch(
            "CREATE TABLE files(path TEXT PRIMARY KEY, size INTEGER);
             INSERT INTO files VALUES ('a', 1), ('b', 2);
             PRAGMA locking_mode=EXCLUSIVE;
             BEGIN EXCLUSIVE;",
        )
        .unwrap();
    let db = open(&path, false, &Limits::DEFAULT).unwrap().unwrap();
    assert_eq!(db.summary.state, "copy");
    assert_eq!(db.summary.copy_why.as_deref(), Some("locked"));
    assert_eq!(part(&db, "files").rows, Some(2));
    drop(writer);
}

#[test]
fn bytes_without_sqlites_header_are_not_a_database() {
    let dir = copied("vault", &["vault.db"]);
    assert!(open(&dir.join("vault.db"), false, &Limits::DEFAULT)
        .unwrap()
        .is_none());
}

#[test]
fn a_view_that_runs_too_long_is_stopped_and_says_so() {
    let dir = copied("slow", &[]);
    let path = dir.join("slow.sqlite");
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE VIEW forever AS WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) AS c FROM n;",
        )
        .unwrap();
    let limits = Limits {
        view_ms: 200,
        ..Limits::DEFAULT
    };
    let db = open(&path, false, &limits).unwrap().unwrap();
    let started = Instant::now();
    let page = db.rows("forever", 0, 200, &limits).unwrap();
    assert!(page.stopped.is_some());
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn nothing_can_be_written_through_the_reader() {
    let dir = copied("write", &["gauges.sqlite"]);
    let before = listing(&dir);
    let db = open(&dir.join("gauges.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(db.conn.execute("DELETE FROM readings", []).is_err());
    assert!(db
        .conn
        .execute_batch("PRAGMA query_only=0; DELETE FROM readings;")
        .is_err());
    drop(db);
    assert_eq!(listing(&dir), before);
}

#[test]
fn an_entry_held_in_memory_is_read_and_nothing_is_written_to_it() {
    // gauges.sqlite has a trigger; reading every table must fire nothing and change no byte SQLite holds.
    let bytes = fs::read(demo("gauges.sqlite")).unwrap();
    let kept = bytes.clone();
    let mut db = open_bytes(&bytes, &Limits::DEFAULT).unwrap().unwrap();
    assert_eq!(db.summary.state, "copy");
    assert_eq!(db.summary.copy_why.as_deref(), Some("entry"));
    assert!(db.summary.schema.iter().any(|e| e.kind == "trigger"));
    for p in &db.summary.parts {
        db.rows(&p.name, 0, 200, &Limits::DEFAULT).unwrap();
    }
    assert!(db.conn.execute("DELETE FROM readings", []).is_err());
    assert!(db
        .conn
        .execute_batch("PRAGMA query_only=0; INSERT INTO readings DEFAULT VALUES;")
        .is_err());
    let image = db.conn.serialize(MAIN_DB).unwrap();
    assert_eq!(
        &image[..],
        &kept[..],
        "SQLite's image of it is the bytes it was given"
    );
    assert_eq!(bytes, kept);
    assert!(open_bytes(b"not a database at all", &Limits::DEFAULT)
        .unwrap()
        .is_none());
}

#[test]
fn a_log_that_claims_more_than_a_copy_may_hold_is_refused() {
    let dir = copied("forged-log", &[]);
    let db = dir.join("x.db");
    let mut head = vec![0u8; 512];
    head[..16].copy_from_slice(b"SQLite format 3\0");
    head[16..18].copy_from_slice(&512u16.to_be_bytes());
    head[18] = 2;
    head[19] = 2;
    fs::write(&db, &head).unwrap();
    fs::write(dir.join("x.db-wal"), wal::tests::forged(200_000)).unwrap();
    let limits = Limits {
        copy: 1 << 20,
        ..Limits::DEFAULT
    };
    assert!(matches!(open(&db, false, &limits), Err(Fault::Refused(_))));
}

#[test]
fn an_shm_is_read_for_its_header_only() {
    let dir = copied("shm-head", &[]);
    let shm = dir.join("x.db-shm");
    fs::write(&shm, vec![7u8; 4 << 20]).unwrap();
    assert_eq!(
        read_head(&fs::File::open(&shm).unwrap(), wal::SHM_HEADER)
            .unwrap()
            .len(),
        wal::SHM_HEADER
    );
}

/// An -shm header whose two copies agree and that says its log holds `frames` frames, none copied back.
fn shm_saying(frames: u32) -> Vec<u8> {
    let mut b = vec![0u8; wal::SHM_HEADER];
    b[12] = 1;
    b[16..20].copy_from_slice(&frames.to_ne_bytes());
    let (first, second) = b.split_at_mut(48);
    second[..48].copy_from_slice(first);
    b
}

const SECRET: u32 = 0x5EC0_0001;

#[test]
fn an_shm_that_is_another_files_second_name_is_not_read() {
    let dir = copied("shm-hardlink", &["journal.sqlite", "journal.sqlite-wal"]);
    let away = copied("shm-hardlink-away", &[]);
    fs::write(away.join("secret"), shm_saying(SECRET)).unwrap();
    fs::hard_link(away.join("secret"), dir.join("journal.sqlite-shm")).unwrap();
    let db = open(&dir.join("journal.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    let wal = db.summary.wal.as_ref().unwrap();
    assert_ne!(
        wal.pending,
        Some(SECRET),
        "the linked file's numbers were read"
    );
    assert_eq!(wal.pending, None);
    assert_eq!(db.summary.shm, None);
    assert_eq!(db.summary.state, "copy");
    assert_eq!(part(&db, "entries").rows, Some(52), "the log is still read");
}

#[test]
fn a_log_that_is_another_files_second_name_is_not_read() {
    let dir = copied("wal-hardlink", &["journal.sqlite", "journal.sqlite-shm"]);
    let away = copied("wal-hardlink-away", &["journal.sqlite-wal"]);
    fs::hard_link(
        away.join("journal.sqlite-wal"),
        dir.join("journal.sqlite-wal"),
    )
    .unwrap();
    let db = open(&dir.join("journal.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(
        part(&db, "entries").rows,
        Some(40),
        "the linked log's pages were laid over the file"
    );
    assert!(db.summary.wal.is_none());
    assert_eq!(db.summary.state, "copy");
}

/// A file symlink at `link`, or false where this machine refuses one (Windows without Developer Mode).
fn link_file(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }
}

#[test]
fn an_shm_or_log_that_is_a_link_out_is_not_read() {
    let away = copied("beside-link-away", &["journal.sqlite-wal"]);
    fs::write(away.join("secret"), shm_saying(SECRET)).unwrap();
    let dir = copied("shm-link", &["journal.sqlite", "journal.sqlite-wal"]);
    if !link_file(&away.join("secret"), &dir.join("journal.sqlite-shm")) {
        eprintln!("skipped: this machine does not allow a file symlink (Developer Mode)");
        return;
    }
    let db = open(&dir.join("journal.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert_eq!(db.summary.wal.as_ref().unwrap().pending, None);
    assert_eq!(db.summary.shm, None);
    assert_eq!(part(&db, "entries").rows, Some(52));
    drop(db);

    let dir = copied("wal-link", &["journal.sqlite", "journal.sqlite-shm"]);
    assert!(link_file(
        &away.join("journal.sqlite-wal"),
        &dir.join("journal.sqlite-wal")
    ));
    let db = open(&dir.join("journal.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(db.summary.wal.is_none());
    assert_eq!(part(&db, "entries").rows, Some(40));
}

thread_local! {
    static BETWEEN: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

/// Runs what a test planted for the moment after the files beside the database were judged and before SQLite opens it.
pub(super) fn between_check_and_open() {
    if let Some(f) = BETWEEN.with(|b| b.borrow_mut().take()) {
        f();
    }
}

fn before_open(f: impl FnOnce() + 'static) {
    BETWEEN.with(|b| *b.borrow_mut() = Some(Box::new(f)));
}

/// A file away from the database shaped as a journal that is not hot (its first byte zero), so whether SQLite read it
/// shows as the database read in place rather than refused.
fn away_journal(tag: &str) -> PathBuf {
    let away = copied(tag, &[]);
    fs::write(away.join("secret"), [0u8; 512]).unwrap();
    away.join("secret")
}

#[test]
fn a_journal_linked_in_between_the_check_and_the_open_is_not_read() {
    let secret = away_journal("journal-race-away");
    let dir = copied("journal-race", &["gauges.sqlite"]);
    let journal = dir.join("gauges.sqlite-journal");
    let plant = journal.clone();
    before_open(move || fs::hard_link(&secret, &plant).unwrap());
    let db = open(&dir.join("gauges.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    assert!(journal.exists(), "the link was planted");
    assert_eq!(
        db.summary.state, "copy",
        "SQLite read the linked journal, found it not hot and read in place"
    );
    assert_eq!(part(&db, "stations").rows, Some(6));
}

#[test]
fn a_journal_symlinked_in_between_the_check_and_the_open_is_not_read() {
    let secret = away_journal("journal-symlink-away");
    let dir = copied("journal-symlink", &["gauges.sqlite"]);
    if !link_file(&secret, &dir.join("probe")) {
        eprintln!("skipped: this machine does not allow a file symlink (Developer Mode)");
        return;
    }
    let plant = dir.join("gauges.sqlite-journal");
    before_open(move || assert!(link_file(&secret, &plant)));
    let db = open(&dir.join("gauges.sqlite"), false, &Limits::DEFAULT)
        .unwrap()
        .unwrap();
    // Elsewhere SQLite looks for the journal, the VFS refuses the link, and the database is read from a copy. On Windows
    // SQLite asks for the journal's size without following the link, finds the link's own (zero), takes the journal for
    // absent and never opens it, so it reads in place. Either way the file the link leads to is not read.
    if cfg!(windows) {
        assert!(
            matches!(db.summary.state.as_str(), "copy" | "place"),
            "{}",
            db.summary.state
        );
    } else {
        assert_eq!(db.summary.state, "copy");
    }
}

#[test]
fn a_journal_linked_in_after_the_open_is_not_read() {
    let secret = away_journal("journal-late-away");
    let dir = copied("journal-late", &["gauges.sqlite"]);
    let limits = Limits::DEFAULT;
    let db = open(&dir.join("gauges.sqlite"), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(db.summary.state, "place");
    fs::hard_link(&secret, dir.join("gauges.sqlite-journal")).unwrap();
    // SQLite looks for a hot journal before every read; one it may not read is taken as hot, and a read-only reader
    // stops there rather than read past it.
    assert!(db.rows("stations", 0, 10, &limits).is_err());
    fs::remove_file(dir.join("gauges.sqlite-journal")).unwrap();
    assert_eq!(db.rows("stations", 0, 10, &limits).unwrap().rows.len(), 6);
}

#[test]
fn a_journal_of_its_own_beside_the_database_is_read() {
    let limits = Limits::DEFAULT;
    // Left by journal_mode=TRUNCATE, and by PERSIST (a zeroed header): not hot, so the database reads in place.
    for (tag, bytes) in [
        ("journal-empty", vec![]),
        ("journal-zeroed", vec![0u8; 512]),
    ] {
        let dir = copied(tag, &["gauges.sqlite"]);
        fs::write(dir.join("gauges.sqlite-journal"), &bytes).unwrap();
        let before = listing(&dir);
        let db = open(&dir.join("gauges.sqlite"), false, &limits)
            .unwrap()
            .unwrap();
        assert_eq!(db.summary.state, "place", "{tag}");
        assert_eq!(db.rows("stations", 0, 10, &limits).unwrap().rows.len(), 6);
        drop(db);
        assert_eq!(
            listing(&dir),
            before,
            "{tag}: nothing was written or rolled back"
        );
    }
    // A hot journal (a writer stopped mid-change) is never rolled back: the file is read from a copy as it stands.
    let dir = copied("journal-hot", &["gauges.sqlite"]);
    let mut hot = vec![0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];
    hot.resize(512, 0);
    fs::write(dir.join("gauges.sqlite-journal"), &hot).unwrap();
    let before = listing(&dir);
    let db = open(&dir.join("gauges.sqlite"), false, &limits)
        .unwrap()
        .unwrap();
    assert_eq!(db.summary.state, "copy");
    assert_eq!(part(&db, "stations").rows, Some(6));
    drop(db);
    assert_eq!(listing(&dir), before, "the hot journal was not played back");
}
