//! File commands: natural image size and asset-protocol scoping (docs/design/06-shell.md). MARXY-138.

use std::path::{Path, PathBuf};

use imagesize::size;
use serde::Serialize;
use tauri::Manager;

use crate::error::ShellError;

fn scope_directory(dir: &str) -> Result<PathBuf, ShellError> {
    let p = Path::new(dir);
    if !p.is_dir() {
        return Err(ShellError::invalid(dir, "not a directory"));
    }
    Ok(p.to_path_buf())
}

#[derive(Debug, Serialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// Natural pixel size from the file header only (`imagesize`, MIT). `null` when the bytes are not an image.
#[tauri::command]
pub fn image_size(path: String) -> Result<Option<ImageDimensions>, ShellError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(ShellError::not_found(
            &path,
            format!("{path}: no such file"),
        ));
    }
    match size(&path) {
        Ok(dim) => Ok(Some(ImageDimensions {
            width: dim.width as u32,
            height: dim.height as u32,
        })),
        Err(_) => Ok(None),
    }
}

/// Adds a recursive asset-protocol scope for this session (ADR-0027 §5).
#[tauri::command]
pub fn allow_asset_scope(app: tauri::AppHandle, dir: String) -> Result<(), ShellError> {
    scope_directory(&dir)?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| ShellError::io(&dir, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn corpus_png() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/image.png")
    }

    fn corpus_ts() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/corpus/04-source.ts")
    }

    #[test]
    fn image_size_on_corpus_png_is_1200_by_400() {
        let path = corpus_png();
        assert!(path.is_file(), "fixture missing: {}", path.display());
        let got = image_size(path.to_string_lossy().into_owned())
            .unwrap()
            .unwrap();
        assert_eq!(got.width, 1200);
        assert_eq!(got.height, 400);
    }

    #[test]
    fn image_size_on_text_source_is_none() {
        let path = corpus_ts();
        assert!(path.is_file());
        assert!(image_size(path.to_string_lossy().into_owned())
            .unwrap()
            .is_none());
    }

    #[test]
    fn image_size_on_missing_path_is_not_found() {
        let err = image_size("/no/such/marxy-image.png".into()).unwrap_err();
        assert_eq!(err.code, "not-found");
    }

    #[test]
    fn allow_asset_scope_on_a_file_is_invalid() {
        let path = corpus_png();
        let err = scope_directory(&path.to_string_lossy()).unwrap_err();
        assert_eq!(err.code, "invalid");
    }
}
