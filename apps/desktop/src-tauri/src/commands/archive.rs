//! `list_archive`, `read_archive_entry` and `read_archive_heads`: the entries of an archive file, the bytes of one, and
//! the first bytes of many, for the archive page (`src/archive`). Like `image_facts` they read only what the page opened or scoped, judged as
//! `marxy-file://` judges a request, and they write nothing: an entry is read into memory and sent back.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::Serialize;

use crate::archive::{self, ArchiveListing, Cache, Fault, Head, Key, Limits, Want, INDEXES};
use crate::error::ShellError;
use crate::file_scheme::{self, OpenedSet, Refusal};

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

pub(crate) fn shell_error(raw: &str, fault: Fault) -> ShellError {
    match fault {
        Fault::Invalid(m) => ShellError::invalid(raw, m),
        Fault::Refused(m) => ShellError::refused(raw, m),
        Fault::Unsupported(m) => ShellError::unsupported(raw, m),
        Fault::Io(m) => ShellError::io(raw, m),
    }
}

pub(crate) fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The app's index cache for `file`, keyed by the canonical path it was opened by.
pub(crate) fn cache_of(raw: &str, file: &File, path: &Path) -> Result<Cache<'static>, ShellError> {
    let key = Key::of(path, file).map_err(|e| ShellError::io(raw, e.to_string()))?;
    Ok(Cache {
        indexes: &INDEXES,
        key,
    })
}

/// The listing of `raw` when `set` holds it; `Ok(None)` when it is not an archive the app reads.
pub fn list_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    limits: &Limits,
) -> Result<Option<ArchiveListing>, ShellError> {
    let (file, path) = open_held(set, raw)?;
    let cache = cache_of(raw, &file, &path)?;
    archive::list(&file, &file_name(&path), limits, Some(&cache)).map_err(|f| shell_error(raw, f))
}

/// The bytes of entry `index` of `raw`, which must be the `name` the page listed there.
pub fn read_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, ShellError> {
    let (file, path) = open_held(set, raw)?;
    let cache = cache_of(raw, &file, &path)?;
    archive::read(&file, &file_name(&path), index, name, limits, Some(&cache))
        .map_err(|f| shell_error(raw, f))
}

/// The first bytes of each wanted entry of `raw` (`archive::heads`).
pub fn heads_in(
    set: &RwLock<OpenedSet>,
    raw: &str,
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, ShellError> {
    let (file, path) = open_held(set, raw)?;
    let cache = cache_of(raw, &file, &path)?;
    archive::heads(
        &file,
        &file_name(&path),
        wants,
        max_each,
        limits,
        Some(&cache),
    )
    .map_err(|f| shell_error(raw, f))
}

#[derive(Serialize)]
struct HeadLine<'a> {
    index: u32,
    length: usize,
    whole: bool,
    refused: Option<&'a str>,
}

/// The response's body: the JSON array's length (u32, little-endian), `[{index, length, whole, refused}]`, then each
/// head's bytes in the same order.
fn frame_heads(heads: &[Head]) -> Vec<u8> {
    let lines: Vec<HeadLine> = heads
        .iter()
        .map(|h| HeadLine {
            index: h.index,
            length: h.bytes.len(),
            whole: h.whole,
            refused: h.refused.as_deref(),
        })
        .collect();
    let json = serde_json::to_vec(&lines).expect("the lines serialise");
    let bytes: usize = heads.iter().map(|h| h.bytes.len()).sum();
    let mut body = Vec::with_capacity(4 + json.len() + bytes);
    body.extend_from_slice(&(json.len() as u32).to_le_bytes());
    body.extend_from_slice(&json);
    for h in heads {
        body.extend_from_slice(&h.bytes);
    }
    body
}

#[tauri::command]
pub async fn list_archive(path: String) -> Result<Option<ArchiveListing>, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || list_in(file_scheme::opened(), &path, &Limits::DEFAULT))
        .await
        .map_err(|e| ShellError::io(&shown, e))?
}

#[tauri::command]
pub async fn read_archive_entry(
    path: String,
    index: u32,
    name: String,
) -> Result<tauri::ipc::Response, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        read_in(file_scheme::opened(), &path, index, &name, &Limits::DEFAULT)
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn read_archive_heads(
    path: String,
    wants: Vec<Want>,
    max_each: u64,
) -> Result<tauri::ipc::Response, ShellError> {
    let shown = path.clone();
    crate::commands::fs::off_main(move || {
        heads_in(
            file_scheme::opened(),
            &path,
            &wants,
            max_each,
            &Limits::DEFAULT,
        )
    })
    .await
    .map_err(|e| ShellError::io(&shown, e))?
    .map(|heads| tauri::ipc::Response::new(frame_heads(&heads)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::testkit::{self, Z};
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-archive-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dunce::canonicalize(&dir).unwrap()
    }

    fn set_of(folder: &Path) -> RwLock<OpenedSet> {
        let mut set = OpenedSet::default();
        set.add_folder(folder, folder.to_path_buf());
        RwLock::new(set)
    }

    fn text(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn archives_are_read_only_for_what_the_page_opened() {
        let dir = temp_dir("scope");
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let zip = testkit::zip(&[Z::stored("a.txt", b"hello")], b"");
        for p in [
            inside.join("a.zip"),
            outside.join("b.zip"),
            inside.join(".hidden.zip"),
        ] {
            fs::write(p, &zip).unwrap();
        }
        let set = set_of(&inside);
        let ok = list_in(&set, &text(&inside.join("a.zip")), &Limits::DEFAULT)
            .unwrap()
            .unwrap();
        assert_eq!(ok.entries[0].path, "a.txt");
        assert_eq!(
            read_in(
                &set,
                &text(&inside.join("a.zip")),
                0,
                "a.txt",
                &Limits::DEFAULT
            )
            .unwrap(),
            b"hello"
        );
        for refused in [
            text(&outside.join("b.zip")),
            format!("{}/../outside/b.zip", inside.display()),
            text(&inside.join(".hidden.zip")),
            "b.zip".to_owned(),
        ] {
            let e = list_in(&set, &refused, &Limits::DEFAULT).unwrap_err();
            assert_eq!(e.code, "permission", "{refused}");
            let e = read_in(&set, &refused, 0, "a.txt", &Limits::DEFAULT).unwrap_err();
            assert_eq!(e.code, "permission", "{refused}");
        }
        fs::write(inside.join("notes.txt"), b"plain text, not an archive").unwrap();
        assert!(
            list_in(&set, &text(&inside.join("notes.txt")), &Limits::DEFAULT)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            list_in(&set, &text(&inside.join("gone.zip")), &Limits::DEFAULT)
                .unwrap_err()
                .code,
            "not-found"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hostile_names_create_nothing_on_disk() {
        let dir = temp_dir("hostile");
        let folder = dir.join("folder");
        fs::create_dir_all(&folder).unwrap();
        let names: [&[u8]; 4] = [
            b"../../evil.txt",
            b"/etc/passwd",
            b"C:\\Windows\\win.ini",
            b"a/../../b.txt",
        ];
        let want = ["evil.txt", "etc/passwd", "Windows/win.ini", "a/b.txt"];
        let zip = testkit::zip(
            &names
                .iter()
                .map(|n| Z::stored(std::str::from_utf8(n).unwrap(), n))
                .collect::<Vec<_>>(),
            b"",
        );
        let tar = testkit::tar(
            &names
                .iter()
                .map(|n| (*n, testkit::T::File, *n))
                .collect::<Vec<_>>(),
        );
        fs::write(folder.join("h.zip"), &zip).unwrap();
        fs::write(folder.join("h.tar"), &tar).unwrap();
        fs::write(folder.join("h.tar.gz"), testkit::gzip(&tar)).unwrap();
        let set = set_of(&folder);
        for file in ["h.zip", "h.tar", "h.tar.gz"] {
            let raw = text(&folder.join(file));
            let l = list_in(&set, &raw, &Limits::DEFAULT).unwrap().unwrap();
            assert_eq!(l.entries.len(), 4, "{file}");
            for (i, e) in l.entries.iter().enumerate() {
                assert_eq!(e.path, want[i], "{file}");
                assert_eq!(
                    e.raw_name.as_deref().map(str::as_bytes),
                    Some(names[i]),
                    "{file}"
                );
                let bytes = read_in(&set, &raw, e.index, &e.path, &Limits::DEFAULT).unwrap();
                assert_eq!(bytes, names[i], "{file}");
            }
            let wants: Vec<Want> = l
                .entries
                .iter()
                .map(|e| Want {
                    index: e.index,
                    name: e.path.clone(),
                })
                .collect();
            let heads = heads_in(&set, &raw, &wants, 64, &Limits::DEFAULT).unwrap();
            let got: Vec<&[u8]> = heads.iter().map(|h| h.bytes.as_slice()).collect();
            assert_eq!(got, names, "{file}");
        }
        for stray in [
            "evil.txt",
            "../evil.txt",
            "../../evil.txt",
            "etc",
            "Windows",
            "a",
            "b.txt",
            "../b.txt",
        ] {
            assert!(
                !folder.join(stray).exists(),
                "{stray} was created next to or above the archive"
            );
        }
        let mut names_in_folder: Vec<_> = fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names_in_folder.sort();
        assert_eq!(names_in_folder, ["h.tar", "h.tar.gz", "h.zip"]);
        assert_eq!(
            fs::read_dir(&dir).unwrap().count(),
            1,
            "nothing beside the folder"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// What the archive page's preview asks: an entry's first 256 KB, or all of it, from a zip, a compressed tar and a
    /// lone gzip. Everything is read into memory: the folder, its parent and the system's temporary folder gain nothing.
    #[test]
    fn previews_read_heads_and_whole_entries_and_create_nothing_on_disk() {
        let dir = temp_dir("preview");
        let folder = dir.join("folder");
        fs::create_dir_all(&folder).unwrap();
        let long: Vec<u8> = b"tick ok\n"
            .iter()
            .copied()
            .cycle()
            .take(300 * 1024)
            .collect();
        let short = b"# Notes\n\nA short entry, all of it within one head.\n";
        let picture: Vec<u8> = b"\x89PNG\r\n\x1a\n"
            .iter()
            .copied()
            .chain((0..5000u32).map(|i| (i * 31) as u8))
            .collect();
        let zip = testkit::zip(
            &[
                Z::deflated("x/long.log", &long),
                Z::stored("x/notes.md", short),
                Z::stored("x/pic.png", &picture),
            ],
            b"",
        );
        let tar = testkit::tar(&[
            (b"x/long.log", testkit::T::File, &long),
            (b"x/notes.md", testkit::T::File, short),
        ]);
        fs::write(folder.join("p.zip"), &zip).unwrap();
        fs::write(folder.join("p.tar.gz"), testkit::gzip(&tar)).unwrap();
        fs::write(folder.join("long.log.gz"), testkit::gzip(&long)).unwrap();
        let temp_before: std::collections::BTreeSet<_> = fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .collect();
        let set = set_of(&folder);
        const PREVIEW_HEAD: u64 = 256 * 1024;
        for file in ["p.zip", "p.tar.gz", "long.log.gz"] {
            let raw = text(&folder.join(file));
            let l = list_in(&set, &raw, &Limits::DEFAULT).unwrap().unwrap();
            let wants: Vec<Want> = l
                .entries
                .iter()
                .map(|e| Want {
                    index: e.index,
                    name: e.path.clone(),
                })
                .collect();
            for (w, e) in wants.iter().zip(&l.entries) {
                let heads = heads_in(
                    &set,
                    &raw,
                    std::slice::from_ref(w),
                    PREVIEW_HEAD,
                    &Limits::DEFAULT,
                )
                .unwrap();
                let whole = read_in(&set, &raw, e.index, &e.path, &Limits::DEFAULT).unwrap();
                let h = &heads[0];
                assert_eq!(
                    h.whole,
                    whole.len() as u64 <= PREVIEW_HEAD,
                    "{file} {}",
                    e.path
                );
                assert_eq!(
                    h.bytes,
                    whole[..whole.len().min(PREVIEW_HEAD as usize)],
                    "{file} {}",
                    e.path
                );
            }
        }
        let mut names: Vec<_> = fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["long.log.gz", "p.tar.gz", "p.zip"]);
        assert_eq!(
            fs::read_dir(&dir).unwrap().count(),
            1,
            "nothing beside the folder"
        );
        // Other tests make folders of their own here as this runs: only a file or folder named for an entry would be ours.
        let grown: Vec<_> = fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .filter(|n| !temp_before.contains(n))
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| ["long.log", "notes.md", "pic.png", "x"].contains(&n.as_str()))
            .collect();
        assert!(grown.is_empty(), "the temporary folder gained {grown:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_lone_gz_a_cut_7z_and_random_bytes() {
        let dir = temp_dir("lone");
        let set = set_of(&dir);
        let mut enc = flate2::GzBuilder::new()
            .filename("inner.txt")
            .mtime(1_700_000_000)
            .write(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut enc, b"lone file body").unwrap();
        fs::write(dir.join("notes.txt.gz"), enc.finish().unwrap()).unwrap();
        let plain = testkit::gzip(b"no name in this one");
        fs::write(dir.join("x.gz"), plain).unwrap();
        fs::write(dir.join("seven.7z"), b"7z\xbc\xaf\x27\x1c\x00\x04rest").unwrap();
        fs::write(
            dir.join("random.bin"),
            (0..4096u32)
                .map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8)
                .collect::<Vec<_>>(),
        )
        .unwrap();

        let l = list_in(&set, &text(&dir.join("notes.txt.gz")), &Limits::DEFAULT)
            .unwrap()
            .unwrap();
        assert_eq!((l.format.as_str(), l.entries.len()), ("gz", 1));
        let e = &l.entries[0];
        assert_eq!(
            (e.path.as_str(), e.kind.as_str(), e.index),
            ("inner.txt", "file", 0)
        );
        assert_eq!(e.size, Some(14));
        assert_eq!(e.mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(
            read_in(
                &set,
                &text(&dir.join("notes.txt.gz")),
                0,
                "inner.txt",
                &Limits::DEFAULT
            )
            .unwrap(),
            b"lone file body"
        );
        let l = list_in(&set, &text(&dir.join("x.gz")), &Limits::DEFAULT)
            .unwrap()
            .unwrap();
        assert_eq!(l.entries[0].path, "x");
        assert_eq!(l.entries[0].mtime, None);
        assert_eq!(
            read_in(&set, &text(&dir.join("x.gz")), 0, "x", &Limits::DEFAULT).unwrap(),
            b"no name in this one"
        );
        let tight = Limits {
            entry: 5,
            ..Limits::DEFAULT
        };
        let e = read_in(&set, &text(&dir.join("x.gz")), 0, "x", &tight).unwrap_err();
        assert_eq!(e.code, "refused");
        assert_eq!(
            read_in(&set, &text(&dir.join("x.gz")), 0, "y", &Limits::DEFAULT)
                .unwrap_err()
                .message,
            "The archive changed since it was listed."
        );
        let e = list_in(&set, &text(&dir.join("seven.7z")), &Limits::DEFAULT).unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            (
                "invalid",
                "The listing could not be read: the archive is damaged."
            )
        );
        assert!(
            list_in(&set, &text(&dir.join("random.bin")), &Limits::DEFAULT)
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_committed_bz2_and_xz_single_files_list_and_read() {
        let dir = temp_dir("single");
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/archives");
        let set = set_of(&dir);
        for (file, format) in [("note.txt.bz2", "bz2"), ("note.txt.xz", "xz")] {
            fs::copy(fixtures.join(file), dir.join(file)).unwrap();
            let raw = text(&dir.join(file));
            let l = list_in(&set, &raw, &Limits::DEFAULT).unwrap().unwrap();
            assert_eq!(
                (l.format.as_str(), l.entries[0].path.as_str()),
                (format, "note.txt")
            );
            assert_eq!(l.entries[0].size, None);
            assert_eq!(
                read_in(&set, &raw, 0, "note.txt", &Limits::DEFAULT).unwrap(),
                b"one line of text\n"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_heads_frame_is_the_json_lines_then_each_heads_bytes() {
        let heads = [
            Head {
                index: 3,
                bytes: b"abc".to_vec(),
                whole: true,
                refused: None,
            },
            Head {
                index: 0,
                bytes: Vec::new(),
                whole: false,
                refused: Some("A folder has nothing to open.".into()),
            },
            Head {
                index: 7,
                bytes: b"\x00\xffde".to_vec(),
                whole: false,
                refused: None,
            },
        ];
        let body = frame_heads(&heads);
        let n = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
        assert_eq!(
            std::str::from_utf8(&body[4..4 + n]).unwrap(),
            r#"[{"index":3,"length":3,"whole":true,"refused":null},{"index":0,"length":0,"whole":false,"refused":"A folder has nothing to open."},{"index":7,"length":4,"whole":false,"refused":null}]"#
        );
        assert_eq!(&body[4 + n..], b"abc\x00\xffde");
        let empty = frame_heads(&[]);
        assert_eq!(empty, b"\x02\x00\x00\x00[]");
    }

    #[test]
    fn heads_are_read_only_for_what_the_page_opened() {
        let dir = temp_dir("heads-scope");
        let (inside, outside) = (dir.join("inside"), dir.join("outside"));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let zip = testkit::zip(&[Z::stored("a.txt", b"hello")], b"");
        fs::write(inside.join("a.zip"), &zip).unwrap();
        fs::write(outside.join("b.zip"), &zip).unwrap();
        let set = set_of(&inside);
        let want = [Want {
            index: 0,
            name: "a.txt".into(),
        }];
        let got = heads_in(
            &set,
            &text(&inside.join("a.zip")),
            &want,
            4,
            &Limits::DEFAULT,
        )
        .unwrap();
        assert_eq!(
            (got[0].bytes.as_slice(), got[0].whole),
            (&b"hell"[..], false)
        );
        let e = heads_in(
            &set,
            &text(&outside.join("b.zip")),
            &want,
            4,
            &Limits::DEFAULT,
        )
        .unwrap_err();
        assert_eq!(e.code, "permission");
        fs::write(inside.join("notes.txt"), b"plain text, not an archive").unwrap();
        let e = heads_in(
            &set,
            &text(&inside.join("notes.txt")),
            &want,
            4,
            &Limits::DEFAULT,
        )
        .unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("invalid", "This file is not an archive.")
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
