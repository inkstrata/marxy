//! `tables_open`, `tables_rows` and `tables_blob`: a database or a workbook for the table page (`src/tables`).
//! Like `list_archive` they read only a file the page opened, judged as `marxy-file://` judges a request, and write
//! nothing. What was opened is kept for the next page while the file stays as it was: a changed size or date (the
//! file's, or its log's) opens it again, so a page always shows the file as it is now.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

use serde::Serialize;

use super::held::{self, ArchiveEntryRef};
use crate::archive;
use crate::error::ShellError;
use crate::scope::served::open_judged;
use crate::scope::{self, OpenedSet};
use crate::tables::sheets::{self, Book, BookSummary};
use crate::tables::sqlite::{self, Db, DbSummary};
use crate::tables::{Fault, Limits, Source};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablesSummary {
    /// `sqlite` or `sheet`.
    pub kind: String,
    pub db: Option<DbSummary>,
    pub book: Option<BookSummary>,
}

enum Opened {
    Db(Db),
    Book(Book),
}

type Key = (
    PathBuf,
    bool,
    Option<(u64, SystemTime)>,
    Option<(u64, SystemTime)>,
    // A Book is built with its text cut at this; Export's whole text needs its own.
    usize,
);
type Kept = Mutex<Vec<(Key, Arc<Mutex<Opened>>)>>;

const KEPT: usize = 4;

fn kept() -> &'static Kept {
    static KEPT_OPEN: std::sync::OnceLock<Kept> = std::sync::OnceLock::new();
    KEPT_OPEN.get_or_init(|| Mutex::new(Vec::new()))
}

// The link itself, not what it leads to: a -wal that is a link is never read (src/tables/sqlite.rs).
fn stamp(p: &Path) -> Option<(u64, SystemTime)> {
    std::fs::symlink_metadata(p)
        .ok()
        .map(|m| (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
}

fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// The file at `raw`, resolved, when `set` holds it and it is a regular file.
fn held(set: &RwLock<OpenedSet>, raw: &str) -> Result<PathBuf, ShellError> {
    let (_, path) = open_judged(set, raw)?;
    Ok(path)
}

fn shell_error(raw: &str, fault: Fault) -> ShellError {
    match fault {
        Fault::Invalid(m) => ShellError::invalid(raw, m),
        Fault::Refused(m) => ShellError::refused(raw, m),
        Fault::Io(m) => ShellError::io(raw, m),
    }
}

/// What `path` opens as, from what was kept when the file is as it was, or read now.
fn opened(path: &Path, alone: bool, limits: &Limits) -> Result<Option<Arc<Mutex<Opened>>>, Fault> {
    let key: Key = (
        path.to_path_buf(),
        alone,
        stamp(path),
        stamp(&beside(path, "-wal")),
        limits.text_chars,
    );
    if let Ok(list) = kept().lock() {
        if let Some((_, o)) = list.iter().find(|(k, _)| *k == key) {
            return Ok(Some(o.clone()));
        }
    }
    let made = match sqlite::open(path, alone, limits)? {
        Some(db) => Opened::Db(db),
        None => match sheets::open(path, limits)? {
            Some(book) => Opened::Book(book),
            None => return Ok(None),
        },
    };
    let made = Arc::new(Mutex::new(made));
    if let Ok(mut list) = kept().lock() {
        list.retain(|(k, _)| !(k.0 == key.0 && k.1 == key.1));
        list.push((key, made.clone()));
        if list.len() > KEPT {
            list.remove(0);
        }
    }
    Ok(Some(made))
}

/// What entry `at` of the archive at `raw` opens as, read from memory: an entry has no place on disk and no log beside it.
fn opened_entry(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: &ArchiveEntryRef,
    limits: &Limits,
) -> Result<Option<Arc<Mutex<Opened>>>, ShellError> {
    let what = if limits.text_chars == Limits::DEFAULT.text_chars {
        "tables"
    } else {
        "tables-whole"
    };
    let made = held::entry(set, raw, at, what, &archive::Limits::DEFAULT, |bytes| {
        let made = match sqlite::open_bytes(&bytes, limits).map_err(|f| shell_error(raw, f))? {
            Some(db) => Some(Opened::Db(db)),
            None => {
                let src = Source::Bytes {
                    bytes: &bytes,
                    name: &at.name,
                };
                sheets::open_from(src, limits)
                    .map_err(|f| shell_error(raw, f))?
                    .map(Opened::Book)
            }
        };
        Ok(made.map(|o| Arc::new(Mutex::new(o))))
    })?;
    Ok((*made).clone())
}

/// What `raw` opens as: the file itself, or entry `at` of it when it is an archive.
fn reader_of(
    set: &RwLock<OpenedSet>,
    raw: &str,
    alone: bool,
    at: Option<&ArchiveEntryRef>,
    limits: &Limits,
) -> Result<Option<Arc<Mutex<Opened>>>, ShellError> {
    match at {
        Some(at) => opened_entry(set, raw, at, limits),
        None => {
            let path = held(set, raw)?;
            opened(&path, alone, limits).map_err(|f| shell_error(raw, f))
        }
    }
}

#[cfg(test)]
pub fn open_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    alone: bool,
    limits: &Limits,
) -> Result<Option<TablesSummary>, ShellError> {
    open_at(set, raw, alone, None, limits)
}

pub fn open_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    alone: bool,
    at: Option<&ArchiveEntryRef>,
    limits: &Limits,
) -> Result<Option<TablesSummary>, ShellError> {
    let Some(o) = reader_of(set, raw, alone, at, limits)? else {
        return Ok(None);
    };
    let o = o
        .lock()
        .map_err(|_| ShellError::io(raw, "the reader was poisoned"))?;
    Ok(Some(match &*o {
        Opened::Db(db) => TablesSummary {
            kind: "sqlite".into(),
            db: Some(db.summary.clone()),
            book: None,
        },
        Opened::Book(b) => TablesSummary {
            kind: "sheet".into(),
            db: None,
            book: Some(b.summary.clone()),
        },
    }))
}

#[cfg(test)]
pub fn rows_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    part: &str,
    from: u64,
    count: u32,
    alone: bool,
    limits: &Limits,
) -> Result<serde_json::Value, ShellError> {
    rows_at(set, raw, part, from, count, alone, None, limits)
}

#[allow(clippy::too_many_arguments)]
pub fn rows_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    part: &str,
    from: u64,
    count: u32,
    alone: bool,
    at: Option<&ArchiveEntryRef>,
    limits: &Limits,
) -> Result<serde_json::Value, ShellError> {
    let o = reader_of(set, raw, alone, at, limits)?
        .ok_or_else(|| ShellError::invalid(raw, "not a database or a workbook the app reads"))?;
    let o = o
        .lock()
        .map_err(|_| ShellError::io(raw, "the reader was poisoned"))?;
    let page = match &*o {
        Opened::Db(db) => serde_json::to_value(
            db.rows(part, from, count, limits)
                .map_err(|f| shell_error(raw, f))?,
        ),
        Opened::Book(b) => {
            let at = b
                .summary
                .sheets
                .iter()
                .position(|s| s.name == part)
                .ok_or_else(|| {
                    ShellError::invalid(raw, format!("the workbook has no sheet {part}"))
                })?;
            serde_json::to_value(
                b.rows(at, from.min(u32::MAX as u64) as u32, count, limits)
                    .map_err(|f| shell_error(raw, f))?,
            )
        }
    };
    page.map_err(|e| ShellError::io(raw, e.to_string()))
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn blob_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    part: &str,
    rowid: Option<i64>,
    row: u64,
    column: &str,
    max: u64,
    alone: bool,
    limits: &Limits,
) -> Result<Vec<u8>, ShellError> {
    let cell = Cell {
        part,
        rowid,
        row,
        column,
        max,
    };
    blob_at(set, raw, &cell, alone, None, limits)
}

/// The BLOB a page asks for: its table, its row, its column and how much of it.
pub struct Cell<'a> {
    pub part: &'a str,
    pub rowid: Option<i64>,
    pub row: u64,
    pub column: &'a str,
    pub max: u64,
}

pub fn blob_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    cell: &Cell,
    alone: bool,
    at: Option<&ArchiveEntryRef>,
    limits: &Limits,
) -> Result<Vec<u8>, ShellError> {
    let o = reader_of(set, raw, alone, at, limits)?
        .ok_or_else(|| ShellError::invalid(raw, "not a database the app reads"))?;
    let o = o
        .lock()
        .map_err(|_| ShellError::io(raw, "the reader was poisoned"))?;
    match &*o {
        Opened::Db(db) => db
            .blob(
                cell.part,
                cell.rowid,
                cell.row,
                cell.column,
                cell.max.min(limits.blob),
            )
            .map_err(|f| shell_error(raw, f)),
        Opened::Book(_) => Err(ShellError::invalid(raw, "a workbook holds no BLOBs")),
    }
}

/// The page's caps, or Export's: more rows a call, and text whole up to a million characters.
fn read_limits(full: bool) -> Limits {
    if full {
        Limits {
            db_rows: 5_000,
            sheet_rows: 100_000,
            text_chars: 1_000_000,
            ..Limits::DEFAULT
        }
    } else {
        Limits::DEFAULT
    }
}

#[tauri::command]
pub async fn tables_open(
    path: String,
    alone: Option<bool>,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<Option<TablesSummary>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        open_at(
            scope::opened(),
            &path,
            alone.unwrap_or(false),
            in_archive.as_ref(),
            &Limits::DEFAULT,
        )
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[tauri::command]
pub async fn tables_rows(
    path: String,
    part: String,
    from: u64,
    count: u32,
    alone: Option<bool>,
    full: Option<bool>,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<serde_json::Value, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        rows_at(
            scope::opened(),
            &path,
            &part,
            from,
            count,
            alone.unwrap_or(false),
            in_archive.as_ref(),
            &read_limits(full.unwrap_or(false)),
        )
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn tables_blob(
    path: String,
    part: String,
    rowid: Option<i64>,
    row: u64,
    column: String,
    max: u64,
    alone: Option<bool>,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<tauri::ipc::Response, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        let cell = Cell {
            part: &part,
            rowid,
            row,
            column: &column,
            max,
        };
        blob_at(
            scope::opened(),
            &path,
            &cell,
            alone.unwrap_or(false),
            in_archive.as_ref(),
            &Limits::DEFAULT,
        )
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
    .map(tauri::ipc::Response::new)
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tests;
