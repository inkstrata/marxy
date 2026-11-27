//! An archive's entry read by a reader that needs it whole: a database, a workbook, a font or a
//! recording held in memory, never spilled to disk. The archive is the file the page opened, judged as `list_archive`
//! judges it; the entry is read through its index (`archive::read`, up to 16 MB, with its refusals) and what the reader
//! made of it is kept for the next call, so a page asking row after row or glyph after glyph reads the archive once.

use std::any::Any;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, RwLock};

use serde::Deserialize;

use super::archive::{cache_of, file_name, shell_error};
use crate::archive::{self, Key, Limits};
use crate::error::ShellError;
use crate::scope::served::open_judged;
use crate::scope::OpenedSet;

/// Which entry of the archive at `path` a reader reads: its ordinal, and the name the page listed there.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntryRef {
    pub index: u32,
    pub name: String,
}

/// Entries kept, and the bytes they may hold in all; the oldest goes first.
const KEPT: usize = 4;
const BUDGET: u64 = 64 * 1024 * 1024;

struct Kept {
    key: Key,
    at: ArchiveEntryRef,
    /// Which reader made it: one entry may be asked of by two (a font's facts and its glyphs share one).
    what: &'static str,
    weight: u64,
    made: Arc<dyn Any + Send + Sync>,
}

/// The lock is held only to look up or to insert: a reader decodes outside it.
static HELD: Mutex<VecDeque<Kept>> = Mutex::new(VecDeque::new());

#[cfg(test)]
thread_local! {
    /// Entries read from an archive by this thread, so a test can see a second call read nothing.
    pub static READS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

fn lookup(key: &Key, at: &ArchiveEntryRef, what: &str) -> Option<Arc<dyn Any + Send + Sync>> {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    // An archive that changed drops what was made from it.
    held.retain(|k| k.key.path() != key.path() || k.key == *key);
    let i = held
        .iter()
        .position(|k| k.key == *key && k.at == *at && k.what == what)?;
    let found = held.remove(i)?;
    let made = found.made.clone();
    held.push_front(found);
    Some(made)
}

fn keep(kept: Kept) {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    held.retain(|k| !(k.key == kept.key && k.at == kept.at && k.what == kept.what));
    held.push_front(kept);
    let mut total: u64 = 0;
    let mut n = 0;
    for k in held.iter() {
        if n == KEPT || (n > 0 && total + k.weight > BUDGET) {
            break;
        }
        total += k.weight;
        n += 1;
    }
    held.truncate(n);
}

/// What `make` made of entry `at` of the archive at `raw`, kept or made now. `make` is given the entry's bytes.
pub fn entry<T: Send + Sync + 'static>(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: &ArchiveEntryRef,
    what: &'static str,
    limits: &Limits,
    make: impl FnOnce(Vec<u8>) -> Result<T, ShellError>,
) -> Result<Arc<T>, ShellError> {
    let (file, path) = open_judged(set, raw)?;
    let cache = cache_of(raw, &file, &path)?;
    if let Some(made) = lookup(&cache.key, at, what).and_then(|m| m.downcast::<T>().ok()) {
        return Ok(made);
    }
    let bytes = archive::read(
        &file,
        &file_name(&path),
        at.index,
        &at.name,
        limits,
        Some(&cache),
    )
    .map_err(|f| shell_error(raw, f))?;
    #[cfg(test)]
    READS.with(|r| r.set(r.get() + 1));
    let weight = bytes.len() as u64;
    let made = Arc::new(make(bytes)?);
    keep(Kept {
        key: cache.key.clone(),
        at: at.clone(),
        what,
        weight,
        made: made.clone(),
    });
    Ok(made)
}

/// Entries kept now, and their bytes in all.
#[cfg(test)]
pub fn kept() -> (usize, u64) {
    let held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    (held.len(), held.iter().map(|k| k.weight).sum())
}

#[cfg(test)]
#[path = "held_tests.rs"]
mod tests;
