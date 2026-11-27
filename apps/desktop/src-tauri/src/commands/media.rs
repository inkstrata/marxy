//! `media_facts` and `media_envelope`: what an audio or video file is, from its container's header, and a PCM WAV's
//! waveform, for the media page (`src/facts/media.rs`). Like `image_facts` they read only what the page opened.

use std::io::Cursor;
use std::sync::{Arc, RwLock};

use super::font::open_held;
use super::held::{self, ArchiveEntryRef};
use crate::archive;
use crate::error::ShellError;
use crate::facts::media::{self, Envelope, MediaFacts};
use crate::file_scheme::{self, OpenedSet};

pub fn facts_in(set: &RwLock<OpenedSet>, raw: &str) -> Result<Option<MediaFacts>, ShellError> {
    let (mut file, _) = open_held(set, raw)?;
    media::read(&mut file).map_err(|e| ShellError::io(raw, e.to_string()))
}

/// The envelope of `raw` in `buckets` steps; None when it is not a PCM WAV.
pub fn envelope_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    buckets: u32,
) -> Result<Option<Envelope>, ShellError> {
    let (mut file, _) = open_held(set, raw)?;
    let facts = media::read(&mut file).map_err(|e| ShellError::io(raw, e.to_string()))?;
    let Some(pcm) = facts.and_then(|f| f.pcm) else {
        return Ok(None);
    };
    media::envelope(&mut file, &pcm, buckets as usize)
        .map(Some)
        .map_err(|e| ShellError::io(raw, e.to_string()))
}

/// A recording that is an archive's entry: its bytes, held, read as the file would be.
fn held_media(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: &ArchiveEntryRef,
) -> Result<Arc<Vec<u8>>, ShellError> {
    held::entry(set, raw, at, "media", &archive::Limits::DEFAULT, Ok)
}

pub fn facts_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: Option<&ArchiveEntryRef>,
) -> Result<Option<MediaFacts>, ShellError> {
    let Some(at) = at else {
        return facts_in(set, raw);
    };
    let bytes = held_media(set, raw, at)?;
    media::read(&mut Cursor::new(bytes.as_slice())).map_err(|e| ShellError::io(raw, e.to_string()))
}

pub fn envelope_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    buckets: u32,
    at: Option<&ArchiveEntryRef>,
) -> Result<Option<Envelope>, ShellError> {
    let Some(at) = at else {
        return envelope_in(set, raw, buckets);
    };
    let bytes = held_media(set, raw, at)?;
    let mut r = Cursor::new(bytes.as_slice());
    let facts = media::read(&mut r).map_err(|e| ShellError::io(raw, e.to_string()))?;
    let Some(pcm) = facts.and_then(|f| f.pcm) else {
        return Ok(None);
    };
    media::envelope(&mut r, &pcm, buckets as usize)
        .map(Some)
        .map_err(|e| ShellError::io(raw, e.to_string()))
}

#[tauri::command]
pub async fn media_facts(
    path: String,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<Option<MediaFacts>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        facts_at(file_scheme::opened(), &path, in_archive.as_ref())
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[tauri::command]
pub async fn media_envelope(
    path: String,
    buckets: u32,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<Option<Envelope>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        envelope_at(file_scheme::opened(), &path, buckets, in_archive.as_ref())
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn facts_and_envelopes_are_read_only_for_what_the_page_opened() {
        let dir = std::env::temp_dir().join(format!("marxy-media-facts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let dir = dunce::canonicalize(&dir).unwrap();
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        let src = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/demo/media/bell-buoy.wav");
        fs::copy(&src, inside.join("a.wav")).unwrap();
        fs::copy(&src, outside.join("b.wav")).unwrap();
        let mut set = OpenedSet::default();
        set.add_folder(&inside, inside.clone());
        let set = RwLock::new(set);
        let a = inside.join("a.wav").to_string_lossy().into_owned();
        assert_eq!(facts_in(&set, &a).unwrap().unwrap().container, "wav");
        assert_eq!(envelope_in(&set, &a, 64).unwrap().unwrap().peaks.len(), 64);
        let b = outside.join("b.wav").to_string_lossy().into_owned();
        assert_eq!(facts_in(&set, &b).unwrap_err().code, "permission");
        assert_eq!(envelope_in(&set, &b, 64).unwrap_err().code, "permission");
        fs::write(inside.join("notes.txt"), b"text").unwrap();
        let notes = inside.join("notes.txt").to_string_lossy().into_owned();
        assert_eq!(facts_in(&set, &notes).unwrap(), None);
        assert_eq!(envelope_in(&set, &notes, 64).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
