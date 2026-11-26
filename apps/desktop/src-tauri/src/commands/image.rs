//! `image_facts`: what an image file is, for the image page and its card (`src/facts`). It reads
//! only what the page opened or scoped, judged as `marxy-file://` judges a request.

use std::path::Path;
use std::sync::RwLock;

use crate::error::ShellError;
use crate::facts::{self, ImageFacts};
use crate::file_scheme::{self, OpenedSet, Refusal};

/// The facts of `raw` when `set` holds it; `Ok(None)` when it is not an image the facts know.
pub fn facts_in(set: &RwLock<OpenedSet>, raw: &str) -> Result<Option<ImageFacts>, ShellError> {
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
    facts::read(&path, file).map_err(|e| ShellError::io(raw, e.to_string()))
}

#[tauri::command]
pub async fn image_facts(path: String) -> Result<Option<ImageFacts>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || facts_in(file_scheme::opened(), &path))
        .await
        .map_err(|e| ShellError::io(&shown, e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/images")
            .join(name)
    }

    #[test]
    fn facts_are_read_only_for_what_the_page_opened() {
        let dir = std::env::temp_dir().join(format!("marxy-image-facts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let dir = dunce::canonicalize(&dir).unwrap();
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::copy(fixture("rotated.jpg"), inside.join("a.jpg")).unwrap();
        fs::copy(fixture("rotated.jpg"), outside.join("b.jpg")).unwrap();
        fs::copy(fixture("rotated.jpg"), inside.join(".hidden.jpg")).unwrap();
        let mut set = OpenedSet::default();
        set.add_folder(&inside, inside.clone());
        let set = RwLock::new(set);

        let ok = facts_in(&set, &inside.join("a.jpg").to_string_lossy())
            .unwrap()
            .unwrap();
        assert_eq!((ok.format, ok.orientation), ("jpeg", 6));
        for refused in [
            outside.join("b.jpg").to_string_lossy().into_owned(),
            format!("{}/../outside/b.jpg", inside.display()),
            inside.join(".hidden.jpg").to_string_lossy().into_owned(),
            "b.jpg".to_owned(),
        ] {
            let err = facts_in(&set, &refused).unwrap_err();
            assert_eq!(err.code, "permission", "{refused}");
        }
        fs::write(inside.join("notes.txt"), b"text").unwrap();
        assert_eq!(
            facts_in(&set, &inside.join("notes.txt").to_string_lossy()).unwrap(),
            None
        );
        assert_eq!(
            facts_in(&set, &inside.join("gone.png").to_string_lossy())
                .unwrap_err()
                .code,
            "not-found"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
