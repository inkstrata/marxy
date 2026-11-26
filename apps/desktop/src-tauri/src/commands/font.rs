//! `font_facts` and `font_glyph`: what a font file is and what one of its glyphs is, for the font page (`src/font`).
//! Like `image_facts` they read only what the page opened, judged as `marxy-file://` judges a request, and write nothing.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

use super::held::{self, ArchiveEntryRef};
use crate::archive;
use crate::error::ShellError;
use crate::file_scheme::{self, OpenedSet, Refusal};
use crate::font::{self, FontFacts, GlyphFacts};

/// The file at `raw`, open, when `set` holds it and it is a regular file.
pub(crate) fn open_held(set: &RwLock<OpenedSet>, raw: &str) -> Result<(File, PathBuf), ShellError> {
    let path = match file_scheme::resolve(set, Path::new(raw)) {
        Ok(p) => p,
        Err(Refusal::Outside) => {
            return Err(ShellError::permission(raw, "not a file Marxy has opened"))
        }
        Err(Refusal::NotFound) => return Err(ShellError::not_found(raw, "no such file")),
        Err(Refusal::Io(e)) => return Err(ShellError::io(raw, e)),
    };
    let file =
        file_scheme::open_unblocked(&path).map_err(|e| ShellError::io(raw, e.to_string()))?;
    if !file_scheme::handle_held(set, &file, &path) {
        return Err(ShellError::permission(raw, "not a file Marxy has opened"));
    }
    if !file.metadata().is_ok_and(|m| m.is_file()) {
        return Err(ShellError::invalid(raw, "not a file"));
    }
    Ok((file, path))
}

pub fn facts_in(set: &RwLock<OpenedSet>, raw: &str) -> Result<Option<FontFacts>, ShellError> {
    let (file, _) = open_held(set, raw)?;
    let bytes = font::read_bytes(file).map_err(|e| ShellError::invalid(raw, e.to_string()))?;
    Ok(font::facts(&bytes))
}

type Held = (PathBuf, u64, Option<SystemTime>, Arc<Vec<u8>>);

/// The last font a glyph was asked of, unwrapped: a reader picks glyph after glyph of one font, and a WOFF2 is decoded
/// once for them. Keyed by path, size and time, so a font changed on disk is read again.
static LAST: Mutex<Option<Held>> = Mutex::new(None);

pub fn glyph_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    face: u32,
    code: u32,
) -> Result<Option<GlyphFacts>, ShellError> {
    let (file, path) = open_held(set, raw)?;
    let meta = file
        .metadata()
        .map_err(|e| ShellError::io(raw, e.to_string()))?;
    let (len, mtime) = (meta.len(), meta.modified().ok());
    let held = LAST.lock().ok().and_then(|g| {
        g.as_ref()
            .filter(|(p, l, m, _)| *p == path && *l == len && *m == mtime)
            .map(|(_, _, _, b)| b.clone())
    });
    let sfnt = match held {
        Some(b) => b,
        None => {
            let bytes =
                font::read_bytes(file).map_err(|e| ShellError::invalid(raw, e.to_string()))?;
            let sfnt = Arc::new(
                font::unwrap(&bytes)
                    .map_err(|e| ShellError::invalid(raw, e.to_string()))?
                    .into_owned(),
            );
            if let Ok(mut g) = LAST.lock() {
                *g = Some((path, len, mtime, sfnt.clone()));
            }
            sfnt
        }
    };
    font::glyph(&sfnt, face, code).map_err(|e| ShellError::invalid(raw, e))
}

/// A font that is an archive's entry, held in memory: its bytes for its facts, and its sfnt unwrapped once for its
/// glyphs (None when the bytes are the sfnt; the sentence when they could not be unwrapped).
struct HeldFont {
    bytes: Vec<u8>,
    sfnt: Result<Option<Vec<u8>>, String>,
}

impl HeldFont {
    fn of(bytes: Vec<u8>) -> HeldFont {
        let sfnt = match font::unwrap(&bytes) {
            Ok(std::borrow::Cow::Borrowed(_)) => Ok(None),
            Ok(std::borrow::Cow::Owned(s)) => Ok(Some(s)),
            Err(e) => Err(e.to_string()),
        };
        HeldFont { bytes, sfnt }
    }
}

fn held_font(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: &ArchiveEntryRef,
) -> Result<Arc<HeldFont>, ShellError> {
    held::entry(set, raw, at, "font", &archive::Limits::DEFAULT, |b| {
        Ok(HeldFont::of(b))
    })
}

pub fn facts_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    at: Option<&ArchiveEntryRef>,
) -> Result<Option<FontFacts>, ShellError> {
    match at {
        None => facts_in(set, raw),
        Some(at) => Ok(font::facts(&held_font(set, raw, at)?.bytes)),
    }
}

pub fn glyph_at(
    set: &RwLock<OpenedSet>,
    raw: &str,
    face: u32,
    code: u32,
    at: Option<&ArchiveEntryRef>,
) -> Result<Option<GlyphFacts>, ShellError> {
    let Some(at) = at else {
        return glyph_in(set, raw, face, code);
    };
    let held = held_font(set, raw, at)?;
    let sfnt = match &held.sfnt {
        Ok(Some(s)) => s.as_slice(),
        Ok(None) => held.bytes.as_slice(),
        Err(e) => return Err(ShellError::invalid(raw, e.clone())),
    };
    font::glyph(sfnt, face, code).map_err(|e| ShellError::invalid(raw, e))
}

#[tauri::command]
pub async fn font_facts(
    path: String,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<Option<FontFacts>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        facts_at(file_scheme::opened(), &path, in_archive.as_ref())
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[tauri::command]
pub async fn font_glyph(
    path: String,
    face: u32,
    code: u32,
    in_archive: Option<ArchiveEntryRef>,
) -> Result<Option<GlyphFacts>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        glyph_at(
            file_scheme::opened(),
            &path,
            face,
            code,
            in_archive.as_ref(),
        )
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn facts_and_glyphs_are_read_only_for_what_the_page_opened() {
        let dir = std::env::temp_dir().join(format!("marxy-font-facts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let dir = dunce::canonicalize(&dir).unwrap();
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        let src = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/demo/fonts/TidemarkSans-Regular.ttf");
        fs::copy(&src, inside.join("a.ttf")).unwrap();
        fs::copy(&src, outside.join("b.ttf")).unwrap();
        let mut set = OpenedSet::default();
        set.add_folder(&inside, inside.clone());
        let set = RwLock::new(set);
        let a = inside.join("a.ttf").to_string_lossy().into_owned();
        let facts = facts_in(&set, &a).unwrap().unwrap();
        assert_eq!(
            facts.faces[0].names.family.as_deref(),
            Some("Tidemark Sans")
        );
        let g = glyph_in(&set, &a, 0, 'A' as u32).unwrap().unwrap();
        assert_eq!(
            glyph_in(&set, &a, 0, 'A' as u32).unwrap().unwrap(),
            g,
            "the held font answers the same"
        );
        let b = outside.join("b.ttf").to_string_lossy().into_owned();
        assert_eq!(facts_in(&set, &b).unwrap_err().code, "permission");
        assert_eq!(glyph_in(&set, &b, 0, 65).unwrap_err().code, "permission");
        fs::write(inside.join("notes.txt"), b"text").unwrap();
        assert_eq!(
            facts_in(&set, &inside.join("notes.txt").to_string_lossy()).unwrap(),
            None
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
