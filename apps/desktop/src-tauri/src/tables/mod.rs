//! Tables: a SQLite database and a spreadsheet, read for the table page (`src/commands/tables.rs`). Nothing
//! here writes to the file or beside it: a database is opened read-only (or read from a copy in memory), a workbook's
//! values are the ones it saved, and nothing is run but a view's own query, read-only and stopped at a time cap.
//! Every read is bounded by `Limits`: rows a page, characters a cell, bytes a copy, cells a workbook, time a query.

use std::fs::File;
use std::io::{self, BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;

mod formats;
pub mod sheets;
pub mod sqlite;
mod wal;

/// The bounds on every read. Fields are public so a test can shrink them.
#[derive(Clone)]
pub struct Limits {
    /// Rows one page of a database may ask for.
    pub db_rows: u32,
    /// Rows one page of a sheet may ask for.
    pub sheet_rows: u32,
    /// Columns a page carries; past it the page says how many there are.
    pub columns: usize,
    /// Characters of one text value; past it the value is cut and says how many more.
    pub text_chars: usize,
    /// The most a BLOB opens with.
    pub blob: u64,
    /// The most a database may hold to be copied into memory (with its log).
    pub copy: u64,
    /// A view's query, or a page of one, before it is stopped.
    pub view_ms: u64,
    /// Counting every table's rows as the database opens, all together.
    pub count_ms: u64,
    /// Entries of sqlite_master read.
    pub schema: usize,
    /// Cells a workbook is read to, all its sheets together; past it a sheet is cut and says so.
    pub cells: usize,
    /// A workbook's own size, and any one part of it unpacked.
    pub workbook: u64,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        db_rows: 200,
        sheet_rows: 2_000,
        columns: 100,
        text_chars: 2_000,
        blob: 16 * 1024 * 1024,
        copy: 512 * 1024 * 1024,
        view_ms: 2_000,
        count_ms: 2_000,
        schema: 10_000,
        cells: 2_000_000,
        workbook: 256 * 1024 * 1024,
    };
}

/// Where a workbook's bytes are: a file on disk, or an archive's entry held in memory, which has no
/// place on disk and nothing beside it.
#[derive(Clone, Copy)]
pub enum Source<'a> {
    File(&'a Path),
    Bytes { bytes: &'a [u8], name: &'a str },
}

/// A reader over a `Source`, for calamine, the zip reader and cfb alike.
pub enum Reading<'a> {
    File(BufReader<File>),
    Bytes(Cursor<&'a [u8]>),
}

impl Read for Reading<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Reading::File(f) => f.read(buf),
            Reading::Bytes(c) => c.read(buf),
        }
    }
}

impl Seek for Reading<'_> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        match self {
            Reading::File(f) => f.seek(to),
            Reading::Bytes(c) => c.seek(to),
        }
    }
}

impl<'a> Source<'a> {
    pub fn reader(&self) -> io::Result<Reading<'a>> {
        Ok(match *self {
            Source::File(p) => Reading::File(BufReader::new(File::open(p)?)),
            Source::Bytes { bytes, .. } => Reading::Bytes(Cursor::new(bytes)),
        })
    }

    pub fn size(&self) -> io::Result<u64> {
        match *self {
            Source::File(p) => Ok(std::fs::metadata(p)?.len()),
            Source::Bytes { bytes, .. } => Ok(bytes.len() as u64),
        }
    }

    /// Whether its name ends in `.ext`, any case.
    pub fn named(&self, ext: &str) -> bool {
        let name = match *self {
            Source::File(p) => p.file_name().map(|n| n.to_string_lossy().into_owned()),
            Source::Bytes { name, .. } => Some(name.to_string()),
        };
        name.and_then(|n| {
            Path::new(&n)
                .extension()
                .map(|e| e.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
    }
}

/// Why a read stopped; the command maps each to its `ShellError` code.
#[derive(Debug)]
pub enum Fault {
    Invalid(String),
    Refused(String),
    Io(String),
}

impl From<std::io::Error> for Fault {
    fn from(e: std::io::Error) -> Self {
        Fault::Io(e.to_string())
    }
}

/// One value as the page draws it. A database's NULL and a sheet's empty cell are `None` (JSON null).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Value {
    /// An integer, as text so 64 bits arrive whole.
    Int {
        v: String,
    },
    /// A real: `v` when it is finite, else `s` ("Inf", "-Inf", "NaN").
    Real {
        #[serde(skip_serializing_if = "Option::is_none")]
        v: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        s: Option<String>,
    },
    /// Text, cut at the cap: `more` is how many characters were left out.
    Text {
        v: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        more: Option<u64>,
    },
    /// A BLOB, as its size in bytes.
    Blob {
        n: u64,
    },
    Bool {
        v: bool,
    },
    /// A sheet's error as saved (`#DIV/0!`).
    Err {
        v: String,
    },
    /// A sheet's date or time: the serial as saved and its clock reading (`2026-10-31T23:43:00`), no zone.
    Date {
        v: f64,
        iso: String,
    },
    /// A date or a duration an ods wrote as ISO 8601 text.
    Iso {
        v: String,
    },
    /// A formula's cell with no saved value: the app that saved it never worked it out.
    None,
}

impl Value {
    pub fn real(v: f64) -> Value {
        if v.is_finite() {
            Value::Real {
                v: Some(v),
                s: None,
            }
        } else {
            let s = if v.is_nan() {
                "NaN"
            } else if v > 0.0 {
                "Inf"
            } else {
                "-Inf"
            };
            Value::Real {
                v: None,
                s: Some(s.into()),
            }
        }
    }

    /// `text` cut at `cap` characters.
    pub fn text(text: &str, cap: usize) -> Value {
        match text.char_indices().nth(cap) {
            None => Value::Text {
                v: text.to_string(),
                more: None,
            },
            Some((at, _)) => Value::Text {
                v: text[..at].to_string(),
                more: Some(text[at..].chars().count() as u64),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_cut_at_the_cap_and_says_how_much_more() {
        assert_eq!(
            Value::text("abc", 5),
            Value::Text {
                v: "abc".into(),
                more: None
            }
        );
        assert_eq!(
            Value::text("abcdé", 3),
            Value::Text {
                v: "abc".into(),
                more: Some(2)
            }
        );
        let j = serde_json::to_string(&Value::real(f64::INFINITY)).unwrap();
        assert_eq!(j, r#"{"k":"real","s":"Inf"}"#);
        assert_eq!(
            serde_json::to_string(&Value::None).unwrap(),
            r#"{"k":"none"}"#
        );
    }
}
