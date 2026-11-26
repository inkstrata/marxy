use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// One file the index knows about.
pub struct Entry {
    pub path: PathBuf,
    pub modified: SystemTime,
    pub headings: Vec<String>,
}

/// Walks `root` and returns every Markdown file, newest first.
pub fn index(root: &Path) -> Vec<Entry> {
    let mut out: Vec<Entry> = walk(root)
        .filter(|p| p.extension() == Some("md".as_ref()))
        .filter_map(|p| entry(&p).ok())
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

fn entry(path: &Path) -> std::io::Result<Entry> {
    let meta = std::fs::metadata(path)?;
    let text = std::fs::read_to_string(path)?;
    Ok(Entry {
        path: path.to_path_buf(),
        modified: meta.modified()?,
        headings: text
            .lines()
            .filter(|l| l.starts_with('#'))
            .map(|l| l.trim_start_matches('#').trim().to_string())
            .collect(),
    })
}

fn walk(root: &Path) -> impl Iterator<Item = PathBuf> {
    // TODO: honour .gitignore; today this walks node_modules too.
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .map(|e| e.into_path())
}
