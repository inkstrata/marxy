//! A SQLite database, read-only. Opened in place with `mode=ro` and `readonly_shm=1`, so SQLite reads the file and
//! its write-ahead log as it always does and writes nothing beside them, through a VFS that reads a rollback journal only
//! from the handle it was judged by (`sqlite_vfs.rs`); `query_only`, `trusted_schema=OFF` and defensive
//! mode on top, no extension loaded, no busy wait. When it cannot be opened in place (another program holds it, or its
//! log has no index SQLite may read), its bytes and its log's committed pages are copied into memory and read from
//! there. Nothing is ever written, checkpointed or rolled back. Rows come a page at a time in stored order; a view runs
//! its own query, read-only, stopped at a time cap.

use std::fs::File;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::config::DbConfig;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, ErrorCode, OpenFlags, MAIN_DB};
use serde::Serialize;

use super::{wal, Fault, Limits, Value};

pub const MAGIC: &[u8; 16] = b"SQLite format 3\0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSummary {
    /// `place` read in place; `wal` in place, with its log's pages over the file's; `alone` the file without its log,
    /// the reader's choice; `copy` from a copy in memory.
    pub state: String,
    /// Why it is read from a copy: `locked`, `index` (its log's index could not be read without writing), or `entry` (an
    /// archive's entry held in memory, which has no place on disk).
    pub copy_why: Option<String>,
    pub header: DbHeader,
    pub wal: Option<WalFacts>,
    /// The -shm beside it, by name, when there is one.
    pub shm: Option<String>,
    pub parts: Vec<DbPart>,
    pub schema: Vec<SchemaEntry>,
    /// Entries of sqlite_master not read past the cap.
    pub schema_more: bool,
    /// The SQLite that reads it here.
    pub library: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHeader {
    pub page_size: u32,
    pub pages: u64,
    pub freelist: u64,
    pub encoding: String,
    /// `wal` or `rollback`, from the header's read and write versions.
    pub journal: String,
    pub user_version: i64,
    pub application_id: i64,
    /// SQLITE_VERSION_NUMBER of the SQLite that last wrote it (3049001).
    pub written_by: u32,
    pub schema_format: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalFacts {
    pub name: String,
    pub bytes: u64,
    pub frames: u32,
    pub commits: u32,
    /// Frames not yet copied back into the file, as the -shm says; None when it says nothing.
    pub pending: Option<u32>,
    /// The log was read: its pages stand over the file's.
    pub read: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumn {
    pub name: String,
    pub decl: String,
    pub key: bool,
    /// This column is the rowid itself (an INTEGER PRIMARY KEY).
    pub rowid: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPart {
    pub name: String,
    /// `table`, `view`, or `internal` (SQLite's own, `sqlite_*`).
    pub kind: String,
    /// Counted from its b-tree as the database opened; None when not counted (a view, or the count stopped).
    pub rows: Option<u64>,
    pub columns: Vec<DbColumn>,
    /// Columns past the page's cap.
    pub columns_more: usize,
    /// The page shows a rowid column of its own (a rowid table with no INTEGER PRIMARY KEY).
    pub rowid: bool,
    /// WITHOUT ROWID: stored in key order.
    pub key_order: bool,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaEntry {
    pub kind: String,
    pub name: String,
    pub table: String,
    pub sql: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsPage {
    pub from: u64,
    pub rows: Vec<Vec<Option<Value>>>,
    /// Each row's rowid, for a table that has them.
    pub rowids: Option<Vec<i64>>,
    /// A view's column names, as its query names them.
    pub columns: Option<Vec<String>>,
    /// Rows in all: a table's count, or a view's when its count finished in time.
    pub total: Option<u64>,
    /// Said when the query was stopped at the time cap.
    pub stopped: Option<String>,
}

struct Plan {
    name: String,
    kind: String,
    /// The name the rowid is selected by, when the table has one the page can reach.
    rid: Option<String>,
    columns: Vec<String>,
}

pub struct Db {
    conn: Connection,
    deadline: Arc<Mutex<Option<Instant>>>,
    plans: Vec<Plan>,
    pub summary: DbSummary,
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// `file:` URI for an absolute path, `%`, `?` and `#` escaped, Windows' backslashes as slashes.
fn uri_of(path: &Path) -> String {
    let mut s = String::new();
    for ch in path.to_string_lossy().chars() {
        match ch {
            '\\' => s.push('/'),
            '%' => s.push_str("%25"),
            '?' => s.push_str("%3f"),
            '#' => s.push_str("%23"),
            c => s.push(c),
        }
    }
    let lead = if s.starts_with('/') {
        "file://"
    } else {
        "file:///"
    };
    format!("{lead}{s}?mode=ro&readonly_shm=1")
}

fn header_of(head: &[u8]) -> (u32, String, u32, u32) {
    let be16 = |at: usize| u16::from_be_bytes([head[at], head[at + 1]]) as u32;
    let be32 = |at: usize| u32::from_be_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
    let page_size = match be16(16) {
        1 => 65_536,
        n => n,
    };
    let journal = if head[18] == 2 || head[19] == 2 {
        "wal"
    } else {
        "rollback"
    };
    (page_size, journal.into(), be32(96), be32(44))
}

fn sql_fault(e: rusqlite::Error) -> Fault {
    match e.sqlite_error_code() {
        Some(ErrorCode::NotADatabase) | Some(ErrorCode::DatabaseCorrupt) => {
            Fault::Invalid(format!("SQLite could not read it: {e}"))
        }
        _ => Fault::Io(e.to_string()),
    }
}

fn harden(conn: &mut Connection, deadline: &Arc<Mutex<Option<Instant>>>) -> rusqlite::Result<()> {
    conn.busy_timeout(Duration::ZERO)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    conn.execute_batch("PRAGMA query_only=1; PRAGMA cell_size_check=ON;")?;
    let d = deadline.clone();
    conn.progress_handler(
        1_000,
        Some(move || {
            d.lock()
                .map(|g| g.is_some_and(|t| Instant::now() > t))
                .unwrap_or(false)
        }),
    )?;
    Ok(())
}

/// The bytes of `file` (named `name`) from its start, at most `cap`; the error says the size when it is more.
fn read_capped(file: &File, name: &str, cap: u64) -> Result<Vec<u8>, Fault> {
    let mut f = file;
    f.rewind()?;
    let len = f.metadata()?.len();
    if len > cap {
        return Err(Fault::Refused(format!(
            "{name} is {len} bytes, past the {cap} a copy in memory may hold"
        )));
    }
    let mut out = Vec::with_capacity(len as usize);
    f.take(cap).read_to_end(&mut out)?;
    Ok(out)
}

/// At most the first `n` bytes of `file`: an -shm is only ever read for its header, and `fs::read` would size a buffer
/// from whatever length the file claims.
fn read_head(file: &File, n: usize) -> std::io::Result<Vec<u8>> {
    let mut f = file;
    f.rewind()?;
    let mut out = Vec::new();
    f.take(n as u64).read_to_end(&mut out)?;
    Ok(out)
}

/// A file SQLite reads beside a database by its name (`-wal`, `-shm`, `-journal`).
enum Beside {
    Absent,
    /// Open on the very file its name says, and held open while SQLite opens it.
    Judged(File),
    /// A link, junction or other reparse point that leads elsewhere, a hard link, or anything not a plain file: never
    /// handed to SQLite, which would follow it.
    Refused,
}

impl Beside {
    fn file(&self) -> Option<&File> {
        match self {
            Beside::Judged(f) => Some(f),
            _ => None,
        }
    }
}

/// Opens `at` and judges it by its handle, as the path commands judge a file (`scope::handle_is`), since SQLite opens it
/// by name and follows whatever is there: a planted -shm linked to another file would show two of that file's numbers,
/// a -wal its pages. A second name is refused too, for a hard link is another file's bytes under this one.
fn judge_beside(at: &Path) -> Beside {
    match std::fs::symlink_metadata(at) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Beside::Absent,
        Ok(m) if m.file_type().is_file() => {}
        _ => return Beside::Refused,
    }
    match crate::scope::open_held(at) {
        Ok(file)
            if crate::scope::handle_is(&file, at)
                && file.metadata().is_ok_and(|m| m.is_file())
                && one_name(&file) =>
        {
            Beside::Judged(file)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Beside::Absent,
        _ => Beside::Refused,
    }
}

/// Whether the file has no name but the one it was opened by.
fn one_name(file: &File) -> bool {
    #[cfg(windows)]
    {
        crate::atomic_write::windows_files::links_of(file).is_ok_and(|n| n == 1)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        file.metadata().is_ok_and(|m| m.nlink() == 1)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        true
    }
}

fn open_place(
    path: &Path,
    deadline: &Arc<Mutex<Option<Instant>>>,
) -> Result<Connection, (Option<String>, Fault)> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let Some(vfs) = vfs::name() else {
        return Err((
            Some("index".into()),
            Fault::Io("SQLite's file layer could not be set up".into()),
        ));
    };
    let attempt = (|| {
        let mut conn = Connection::open_with_flags_and_vfs(uri_of(path), flags, vfs)?;
        harden(&mut conn, deadline)?;
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })?;
        Ok::<_, rusqlite::Error>(conn)
    })();
    match attempt {
        Ok(conn) => Ok(conn),
        Err(e) => {
            let why = match e.sqlite_error_code() {
                Some(ErrorCode::DatabaseBusy) | Some(ErrorCode::DatabaseLocked) => {
                    Some("locked".to_string())
                }
                Some(ErrorCode::CannotOpen)
                | Some(ErrorCode::ReadOnly)
                | Some(ErrorCode::SystemIoFailure) => Some("index".to_string()),
                _ => None,
            };
            Err((why, sql_fault(e)))
        }
    }
}

/// The database `main` (at `path`) copied into memory, with the committed pages of `log` (its judged -wal) laid over it
/// when there is one.
fn open_copy(
    path: &Path,
    main: &File,
    log: Option<&File>,
    limits: &Limits,
    deadline: &Arc<Mutex<Option<Instant>>>,
) -> Result<Connection, Fault> {
    let mut bytes = read_capped(main, &file_name(path), limits.copy)?;
    if let Some(log_file) = log {
        let wal_name = file_name(&beside(path, "-wal"));
        if let Ok(log_bytes) = read_capped(
            log_file,
            &wal_name,
            limits.copy.saturating_sub(bytes.len() as u64),
        ) {
            if let Some(log) = wal::read(&log_bytes) {
                wal::apply(&mut bytes, &log, &log_bytes, limits.copy)
                    .map_err(|why| Fault::Refused(format!("{wal_name}: {why}")))?;
            }
        }
    }
    // A copy is not in WAL mode: SQLite reads it as one file, the log (if asked for) already laid over it.
    if bytes.len() >= 100 && (bytes[18] == 2 || bytes[19] == 2) {
        bytes[18] = 1;
        bytes[19] = 1;
    }
    let mut conn = Connection::open_in_memory().map_err(sql_fault)?;
    let len = bytes.len();
    conn.deserialize_read_exact(MAIN_DB, &bytes[..], len, true)
        .map_err(sql_fault)?;
    harden(&mut conn, deadline).map_err(sql_fault)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(sql_fault)?;
    Ok(conn)
}

/// Opens `path` (canonical, as the scope judged it) for reading, or None when its first bytes are not SQLite's header.
/// `alone` reads the file without its log (the reader's choice).
pub fn open(path: &Path, alone: bool, limits: &Limits) -> Result<Option<Db>, Fault> {
    // The database and every file beside it SQLite would read are opened and judged first, and held until it has opened
    // them itself: on Windows none can be renamed or swapped for a link while held.
    let main = crate::scope::open_held(path)?;
    if !crate::scope::handle_is(&main, path) {
        return Err(Fault::Refused(format!(
            "{} is not where its name says",
            file_name(path)
        )));
    }
    let mut head = [0u8; 100];
    {
        let mut f = &main;
        let mut got = 0;
        while got < 100 {
            let n = f.read(&mut head[got..])?;
            if n == 0 {
                break;
            }
            got += n;
        }
        if got < 100 || &head[..16] != MAGIC {
            return Ok(None);
        }
    }
    let size = main.metadata()?.len();
    let journal = header_of(&head).1;
    let wal_path = beside(path, "-wal");
    let shm_path = beside(path, "-shm");
    let log = judge_beside(&wal_path);
    let index = judge_beside(&shm_path);
    let rollback = judge_beside(&beside(path, "-journal"));
    let refused = [&log, &index, &rollback]
        .iter()
        .any(|b| matches!(b, Beside::Refused));
    let wal_bytes = log.file().and_then(|f| f.metadata().ok()).map(|m| m.len());
    let in_wal = journal == "wal";
    let deadline = Arc::new(Mutex::new(None));

    let alone = alone && in_wal && wal_bytes.is_some();
    // SQLite reads a WAL database in place only through the -shm beside it, and makes one when there is none (even with
    // readonly_shm, on Windows): with no -shm, or no log, the copy in memory is read instead. So is a database with a
    // file beside it that was refused, with its log only when the log itself was judged.
    let needs_index = in_wal && !(wal_bytes.is_some() && index.file().is_some());
    let (conn, state, copy_why) = if alone {
        (
            open_copy(path, &main, None, limits, &deadline)?,
            "alone",
            None,
        )
    } else if needs_index || refused {
        (
            open_copy(path, &main, log.file(), limits, &deadline)?,
            "copy",
            Some("index".to_string()),
        )
    } else {
        #[cfg(test)]
        tests::between_check_and_open();
        match open_place(path, &deadline) {
            Ok(conn) => {
                let state = if in_wal && wal_bytes.is_some_and(|n| n > 32) {
                    "wal"
                } else {
                    "place"
                };
                (conn, state, None)
            }
            Err((Some(why), _)) => (
                open_copy(path, &main, log.file(), limits, &deadline)?,
                "copy",
                Some(why),
            ),
            Err((None, fault)) => return Err(fault),
        }
    };

    let wal = match (log.file(), wal_bytes) {
        (Some(file), Some(bytes)) => {
            let log_facts = read_head(file, limits.copy as usize)
                .ok()
                .and_then(|buf| wal::read(&buf));
            let shm = index
                .file()
                .and_then(|f| read_head(f, wal::SHM_HEADER).ok())
                .and_then(|s| wal::shm_frames(&s));
            log_facts.map(|log| WalFacts {
                name: file_name(&wal_path),
                bytes,
                frames: log.frames,
                commits: log.commits,
                pending: shm.map(|(mx, back)| mx.saturating_sub(back)),
                read: state != "alone" && log.commits > 0,
            })
        }
        _ => None,
    };

    let shm = index.file().is_some().then(|| file_name(&shm_path));
    let made = Made {
        conn,
        deadline,
        state,
        copy_why,
        wal,
        shm,
        size,
    };
    let db = made.finish(&head, limits).map(Some);
    drop((main, log, index, rollback));
    db
}

/// Opens an archive's entry held in memory: `bytes` copied into SQLite's own memory, read-only, as a
/// copy is. An entry has no place on disk, so there is no log or index beside it and none is looked for. None when the
/// first bytes are not SQLite's header.
pub fn open_bytes(bytes: &[u8], limits: &Limits) -> Result<Option<Db>, Fault> {
    if bytes.len() < 100 || &bytes[..16] != MAGIC {
        return Ok(None);
    }
    let mut head = [0u8; 100];
    head.copy_from_slice(&bytes[..100]);
    // Read as one file, as a copy is: a WAL database's header says rollback, so SQLite looks for no log.
    let mut first = head;
    if first[18] == 2 || first[19] == 2 {
        first[18] = 1;
        first[19] = 1;
    }
    let deadline = Arc::new(Mutex::new(None));
    let mut conn = Connection::open_in_memory().map_err(sql_fault)?;
    conn.deserialize_read_exact(
        MAIN_DB,
        (&first[..]).chain(&bytes[100..]),
        bytes.len(),
        true,
    )
    .map_err(sql_fault)?;
    harden(&mut conn, &deadline).map_err(sql_fault)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(sql_fault)?;
    let made = Made {
        conn,
        deadline,
        state: "copy",
        copy_why: Some("entry".into()),
        wal: None,
        shm: None,
        size: bytes.len() as u64,
    };
    made.finish(&head, limits).map(Some)
}

/// A connection made, and what was learnt making it; `finish` reads its header, schema and parts.
struct Made {
    conn: Connection,
    deadline: Arc<Mutex<Option<Instant>>>,
    state: &'static str,
    copy_why: Option<String>,
    wal: Option<WalFacts>,
    shm: Option<String>,
    size: u64,
}

impl Made {
    fn finish(self, head: &[u8; 100], limits: &Limits) -> Result<Db, Fault> {
        let Made {
            conn,
            deadline,
            state,
            copy_why,
            wal,
            shm,
            size,
        } = self;
        let (page_size, journal, written_by, schema_format) = header_of(head);
        let pragma = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        let encoding = conn
            .query_row("PRAGMA encoding", [], |r| r.get::<_, String>(0))
            .unwrap_or_else(|_| "UTF-8".into());
        let header = DbHeader {
            page_size,
            pages: pragma("PRAGMA page_count") as u64,
            freelist: pragma("PRAGMA freelist_count") as u64,
            encoding,
            journal,
            user_version: pragma("PRAGMA user_version"),
            application_id: pragma("PRAGMA application_id"),
            written_by,
            schema_format,
        };

        let mut schema = Vec::new();
        let mut schema_more = false;
        {
            let mut stmt = conn
                .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master")
                .map_err(sql_fault)?;
            let mut rows = stmt.query([]).map_err(sql_fault)?;
            while let Some(r) = rows.next().map_err(sql_fault)? {
                if schema.len() >= limits.schema {
                    schema_more = true;
                    break;
                }
                let text = |i: usize| match r.get_ref(i) {
                    Ok(ValueRef::Text(t)) => Some(String::from_utf8_lossy(t).into_owned()),
                    _ => None,
                };
                schema.push(SchemaEntry {
                    kind: text(0).unwrap_or_default(),
                    name: text(1).unwrap_or_default(),
                    table: text(2).unwrap_or_default(),
                    sql: text(3),
                });
            }
        }

        let mut db = Db {
            conn,
            deadline,
            plans: Vec::new(),
            summary: DbSummary {
                state: state.into(),
                copy_why,
                header,
                wal,
                shm,
                parts: Vec::new(),
                schema: Vec::new(),
                schema_more,
                library: rusqlite::version().to_string(),
                size,
            },
        };
        db.plan_parts(&schema, limits);
        db.summary.schema = schema;
        Ok(db)
    }
}

fn without_rowid(sql: &str) -> bool {
    let s = sql
        .trim_end()
        .trim_end_matches(';')
        .trim_end()
        .to_ascii_uppercase();
    let words: Vec<&str> = s
        .split(|c: char| c.is_whitespace() || c == ')' || c == ',')
        .filter(|w| !w.is_empty())
        .collect();
    words.len() >= 2 && words[words.len() - 2] == "WITHOUT" && words[words.len() - 1] == "ROWID"
}

impl Db {
    fn set_deadline(&self, ms: u64) {
        if let Ok(mut d) = self.deadline.lock() {
            *d = Some(Instant::now() + Duration::from_millis(ms));
        }
    }

    fn clear_deadline(&self) {
        if let Ok(mut d) = self.deadline.lock() {
            *d = None;
        }
    }

    fn plan_parts(&mut self, schema: &[SchemaEntry], limits: &Limits) {
        let count_until = Instant::now() + Duration::from_millis(limits.count_ms);
        for e in schema
            .iter()
            .filter(|e| e.kind == "table" || e.kind == "view")
        {
            let kind = if e.kind == "view" {
                "view"
            } else if e.name.to_ascii_lowercase().starts_with("sqlite_") {
                "internal"
            } else {
                "table"
            };
            let mut columns = Vec::new();
            if kind == "view" {
                if let Ok(stmt) = self
                    .conn
                    .prepare(&format!("SELECT * FROM {}", quote(&e.name)))
                {
                    for c in stmt.columns() {
                        columns.push(DbColumn {
                            name: c.name().to_string(),
                            decl: c.decl_type().unwrap_or("").to_string(),
                            key: false,
                            rowid: false,
                        });
                    }
                }
            } else if let Ok(mut stmt) = self
                .conn
                .prepare(&format!("PRAGMA table_xinfo({})", quote(&e.name)))
            {
                let got = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        r.get::<_, i64>(5)?,
                        r.get::<_, i64>(6)?,
                    ))
                });
                if let Ok(got) = got {
                    for (name, decl, pk, hidden) in got.flatten() {
                        if hidden == 1 {
                            continue;
                        }
                        columns.push(DbColumn {
                            name,
                            decl,
                            key: pk > 0,
                            rowid: false,
                        });
                    }
                }
            }
            let key_order = kind != "view" && e.sql.as_deref().is_some_and(without_rowid);
            let mut rid = None;
            if kind != "view" && !key_order {
                let keys: Vec<usize> = columns
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| c.key)
                    .map(|(i, _)| i)
                    .collect();
                if keys.len() == 1 && columns[keys[0]].decl.eq_ignore_ascii_case("INTEGER") {
                    columns[keys[0]].rowid = true;
                }
                rid = ["rowid", "_rowid_", "oid"]
                    .into_iter()
                    .find(|n| !columns.iter().any(|c| c.name.eq_ignore_ascii_case(n)))
                    .map(String::from);
            }
            let shows_rowid = rid.is_some() && !columns.iter().any(|c| c.rowid);
            let rows = if kind != "view" && Instant::now() < count_until {
                let left = count_until
                    .saturating_duration_since(Instant::now())
                    .as_millis() as u64;
                self.set_deadline(left);
                let n = self
                    .conn
                    .query_row(
                        &format!("SELECT count(*) FROM {}", quote(&e.name)),
                        [],
                        |r| r.get::<_, i64>(0),
                    )
                    .ok()
                    .map(|n| n as u64);
                self.clear_deadline();
                n
            } else {
                None
            };
            let columns_more = columns.len().saturating_sub(limits.columns);
            columns.truncate(limits.columns);
            self.plans.push(Plan {
                name: e.name.clone(),
                kind: kind.into(),
                rid,
                columns: columns.iter().map(|c| c.name.clone()).collect(),
            });
            self.summary.parts.push(DbPart {
                name: e.name.clone(),
                kind: kind.into(),
                rows,
                columns,
                columns_more,
                rowid: shows_rowid,
                key_order,
                sql: e.sql.clone(),
            });
        }
    }

    fn plan(&self, part: &str) -> Result<&Plan, Fault> {
        self.plans.iter().find(|p| p.name == part).ok_or_else(|| {
            Fault::Invalid(format!("{part} is not a table or a view in this database"))
        })
    }

    /// `count` rows of `part` from row `from` (0-based), in stored order, or in the order a view gives them.
    pub fn rows(
        &self,
        part: &str,
        from: u64,
        count: u32,
        limits: &Limits,
    ) -> Result<RowsPage, Fault> {
        // A row past i64 would wrap to a negative OFFSET, which SQLite reads as the first page.
        if from > i64::MAX as u64 {
            return Err(Fault::Invalid(format!(
                "row {from} is past any a table holds"
            )));
        }
        let plan = self.plan(part)?;
        let count = count.min(limits.db_rows);
        let mut page = RowsPage {
            from,
            rows: Vec::new(),
            rowids: None,
            columns: None,
            total: None,
            stopped: None,
        };
        let interrupted =
            |e: &rusqlite::Error| e.sqlite_error_code() == Some(ErrorCode::OperationInterrupted);
        if plan.kind == "view" {
            self.set_deadline(limits.view_ms);
            let run = (|| {
                let mut stmt = self.conn.prepare(&format!(
                    "SELECT * FROM {} LIMIT ?1 OFFSET ?2",
                    quote(&plan.name)
                ))?;
                let n = stmt.column_count();
                page.columns = Some(stmt.column_names().map(|s| s.to_string()).collect());
                let mut rows = stmt.query(rusqlite::params![count, from as i64])?;
                while let Some(r) = rows.next()? {
                    let mut out = Vec::with_capacity(n.min(limits.columns));
                    for i in 0..n.min(limits.columns) {
                        out.push(value_of(r.get_ref(i)?, limits));
                    }
                    page.rows.push(out);
                }
                Ok::<_, rusqlite::Error>(())
            })();
            if let Err(e) = run {
                self.clear_deadline();
                if !interrupted(&e) {
                    return Err(Fault::Invalid(format!("The view could not run: {e}")));
                }
                page.stopped = Some(format!("stopped after {} s", limits.view_ms / 1000));
                return Ok(page);
            }
            self.set_deadline(limits.view_ms);
            page.total = self
                .conn
                .query_row(
                    &format!("SELECT count(*) FROM {}", quote(&plan.name)),
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
                .map(|n| n as u64);
            self.clear_deadline();
            return Ok(page);
        }
        let mut select = Vec::new();
        if let Some(rid) = &plan.rid {
            select.push(rid.clone());
        }
        for c in &plan.columns {
            let q = quote(c);
            select.push(format!(
                "typeof({q}), CASE typeof({q}) WHEN 'text' THEN substr({q}, 1, {cap}) WHEN 'blob' THEN length({q}) ELSE {q} END, CASE typeof({q}) WHEN 'text' THEN length({q}) END",
                cap = limits.text_chars + 1
            ));
        }
        if select.is_empty() {
            select.push("1".into());
        }
        let order = plan
            .rid
            .as_ref()
            .map(|r| format!(" ORDER BY {r}"))
            .unwrap_or_default();
        let sql = format!(
            "SELECT {} FROM {} NOT INDEXED{order} LIMIT ?1 OFFSET ?2",
            select.join(", "),
            quote(&plan.name)
        );
        self.set_deadline(limits.view_ms * 3);
        let base = usize::from(plan.rid.is_some());
        let mut rowids = Vec::new();
        let run = (|| {
            let mut stmt = self.conn.prepare(&sql)?;
            let mut rows = stmt.query(rusqlite::params![count, from as i64])?;
            while let Some(r) = rows.next()? {
                if plan.rid.is_some() {
                    rowids.push(r.get::<_, i64>(0)?);
                }
                let mut out = Vec::with_capacity(plan.columns.len());
                for i in 0..plan.columns.len() {
                    out.push(typed_value(r, base + i * 3, limits)?);
                }
                page.rows.push(out);
            }
            Ok::<_, rusqlite::Error>(())
        })();
        self.clear_deadline();
        match run {
            Err(e) if interrupted(&e) => {
                page.stopped = Some(format!("stopped after {} s", limits.view_ms * 3 / 1000))
            }
            Err(e) => return Err(sql_fault(e)),
            Ok(()) => {}
        }
        if plan.rid.is_some() {
            page.rowids = Some(rowids);
        }
        page.total = self
            .summary
            .parts
            .iter()
            .find(|p| p.name == plan.name)
            .and_then(|p| p.rows);
        Ok(page)
    }

    /// The first `max` bytes of a BLOB: by its rowid where the table has one, else by its row in stored order.
    pub fn blob(
        &self,
        part: &str,
        rowid: Option<i64>,
        row: u64,
        column: &str,
        max: u64,
    ) -> Result<Vec<u8>, Fault> {
        let plan = self.plan(part)?;
        if !plan.columns.iter().any(|c| c == column) {
            return Err(Fault::Invalid(format!(
                "{column} is not a column of {part}"
            )));
        }
        if let (Some(id), Some(_), false) = (rowid, &plan.rid, plan.kind == "view") {
            if let Ok(mut b) = self
                .conn
                .blob_open(MAIN_DB, plan.name.as_str(), column, id, true)
            {
                let mut out = Vec::new();
                b.by_ref().take(max).read_to_end(&mut out)?;
                return Ok(out);
            }
        }
        let order = plan
            .rid
            .as_ref()
            .map(|r| format!(" ORDER BY {r}"))
            .unwrap_or_default();
        let from = if plan.kind == "view" {
            String::new()
        } else {
            " NOT INDEXED".into()
        };
        let sql = format!(
            "SELECT substr({c}, 1, ?1) FROM {t}{from}{order} LIMIT 1 OFFSET ?2",
            c = quote(column),
            t = quote(&plan.name)
        );
        self.set_deadline(3 * 2_000);
        let got =
            self.conn
                .query_row(&sql, rusqlite::params![max as i64, row as i64], |r| match r
                    .get_ref(0)?
                {
                    ValueRef::Blob(b) | ValueRef::Text(b) => Ok(b.to_vec()),
                    _ => Ok(Vec::new()),
                });
        self.clear_deadline();
        got.map_err(sql_fault)
    }
}

fn value_of(v: ValueRef<'_>, limits: &Limits) -> Option<Value> {
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(Value::Int { v: i.to_string() }),
        ValueRef::Real(f) => Some(Value::real(f)),
        ValueRef::Text(t) => Some(Value::text(&String::from_utf8_lossy(t), limits.text_chars)),
        ValueRef::Blob(b) => Some(Value::Blob { n: b.len() as u64 }),
    }
}

fn typed_value(
    r: &rusqlite::Row<'_>,
    at: usize,
    limits: &Limits,
) -> rusqlite::Result<Option<Value>> {
    let kind = match r.get_ref(at)? {
        ValueRef::Text(t) => t.to_vec(),
        _ => Vec::new(),
    };
    Ok(match kind.as_slice() {
        b"integer" => Some(Value::Int {
            v: r.get::<_, i64>(at + 1)?.to_string(),
        }),
        b"real" => Some(Value::real(r.get::<_, f64>(at + 1)?)),
        b"blob" => Some(Value::Blob {
            n: r.get::<_, i64>(at + 1)?.max(0) as u64,
        }),
        b"text" => {
            let text = match r.get_ref(at + 1)? {
                ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
                _ => String::new(),
            };
            let len = r.get::<_, Option<i64>>(at + 2)?.unwrap_or(0).max(0) as u64;
            match Value::text(&text, limits.text_chars) {
                Value::Text { v, more: Some(_) } => {
                    let shown = v.chars().count() as u64;
                    Some(Value::Text {
                        v,
                        more: Some(len.saturating_sub(shown)),
                    })
                }
                other => Some(other),
            }
        }
        _ => None,
    })
}

#[path = "sqlite_vfs.rs"]
mod vfs;

#[cfg(test)]
#[path = "sqlite_tests.rs"]
mod tests;
