//! Privileged walk, deny list, ignore files, ceiling and mtime cache (ADR-0012).
//! Std only, like `atomic_write`. Demand-driven: nothing here runs before first paint (ADR-0013).

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Same cap as `INDEX_LIMITS.entriesPerRoot`. Beyond it, keep newest mtimes.
pub const ENTRIES_PER_ROOT: usize = 50_000;

/// Directory names the walker never descends into. A gitignore `!` cannot undo these.
pub const DENY_DIRECTORY_NAMES: &[&str] = &[
    "node_modules",
    "target",
    ".venv",
    "venv",
    "dist",
    "build",
    "out",
    ".git",
    "__pycache__",
    ".next",
    ".turbo",
    "coverage",
];

const MARKDOWN: &[&str] = &["md", "mdx", "markdown", "mdown", "mkd"];
const TEXT: &[&str] = &["txt", "text"];
const SOURCE: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "rs", "py", "go", "java", "kt", "kts", "c",
    "h", "cc", "cpp", "cxx", "hpp", "hh", "rb", "php", "swift", "sh", "bash", "zsh", "json", "toml",
    "yaml", "yml", "html", "htm", "xml", "sql", "graphql", "lua", "r", "ex", "exs", "hs", "vue",
    "svelte", "css", "scss",
];

/// One walked file: path plus the stamps the cache is invalidated by.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRecord {
    pub path: PathBuf,
    pub mtime_ms: u64,
    pub size: u64,
}

/// Result of walking one root, already capped.
#[derive(Clone, Debug)]
pub struct WalkResult {
    pub root: PathBuf,
    pub files: Vec<FileRecord>,
    pub ceiling: bool,
    pub omitted: usize,
}

/// On-disk cache for one root. The host chooses where to put the file.
#[derive(Clone, Debug)]
pub struct IndexCache {
    pub root: PathBuf,
    pub generated_at_ms: u64,
    pub files: Vec<FileRecord>,
    pub ceiling: bool,
    pub omitted: usize,
}

/// Nearest ancestor of `path` that contains `.git`, if any.
pub fn repository_root(path: &Path) -> Option<PathBuf> {
    let mut dir = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent().unwrap_or(path).to_path_buf()
    };
    loop {
        if dir.join(".git").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

/// ADR-0012 root: enclosing repository, otherwise the opened file's directory.
pub fn index_root(opened: &Path) -> PathBuf {
    if let Some(repo) = repository_root(opened) {
        return repo;
    }
    if opened.is_dir() {
        opened.to_path_buf()
    } else {
        opened.parent().unwrap_or(opened).to_path_buf()
    }
}

/// Walk `root`, skipping deny-listed directories and honouring `.gitignore` / `.ignore`.
/// Never follows a symlink, so a link cannot walk the walker out of the root.
pub fn walk_root(root: &Path) -> WalkResult {
    let mut files: Vec<FileRecord> = Vec::new();
    let mut rules: Vec<IgnoreRule> = Vec::new();
    load_ignore(root, "", &mut rules);
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let listing = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in listing.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if is_denied_name(&name) {
                continue;
            }
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let rel = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if meta.is_dir() {
                load_ignore(&path, &rel, &mut rules);
                if is_ignored(&rel, true, &rules) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !allow_listed(&path) {
                continue;
            }
            if is_ignored(&rel, false, &rules) {
                continue;
            }
            files.push(FileRecord {
                path,
                mtime_ms: mtime_ms(&meta),
                size: meta.len(),
            });
        }
    }
    apply_ceiling(root.to_path_buf(), files)
}

/// True when every cached stamp still matches disk. Any mismatch means rebuild.
pub fn cache_is_current(cached: &[FileRecord], disk: &[FileRecord]) -> bool {
    if cached.len() != disk.len() {
        return false;
    }
    let mut disk_by_path = std::collections::HashMap::with_capacity(disk.len());
    for file in disk {
        disk_by_path.insert(&file.path, (file.mtime_ms, file.size));
    }
    cached.iter().all(|file| match disk_by_path.get(&file.path) {
        Some(&(mtime, size)) => mtime == file.mtime_ms && size == file.size,
        None => false,
    })
}

/// Write a line-oriented cache. Paths with a tab or newline are refused rather than escaped.
pub fn write_cache(path: &Path, cache: &IndexCache) -> Result<(), String> {
    let mut out = String::from("marxy-index-1\n");
    push_field(&mut out, "root", &cache.root.to_string_lossy())?;
    out.push_str(&format!("generatedAtMs\t{}\n", cache.generated_at_ms));
    out.push_str(&format!("ceiling\t{}\n", if cache.ceiling { 1 } else { 0 }));
    out.push_str(&format!("omitted\t{}\n", cache.omitted));
    for file in &cache.files {
        let p = file.path.to_string_lossy();
        refuse_field(&p)?;
        out.push_str(&format!("{p}\t{}\t{}\n", file.mtime_ms, file.size));
    }
    let mut f = File::create(path).map_err(|e| e.to_string())?;
    f.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read a cache written by `write_cache`.
pub fn read_cache(path: &Path) -> Result<IndexCache, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut lines = BufReader::new(file).lines();
    let magic = lines.next().ok_or("empty cache")?.map_err(|e| e.to_string())?;
    if magic != "marxy-index-1" {
        return Err("unknown cache version".into());
    }
    let root = field(&mut lines, "root")?;
    let generated_at_ms = field(&mut lines, "generatedAtMs")?.parse().map_err(|e| format!("{e}"))?;
    let ceiling = field(&mut lines, "ceiling")? == "1";
    let omitted = field(&mut lines, "omitted")?.parse().map_err(|e| format!("{e}"))?;
    let mut files = Vec::new();
    for line in lines {
        let line = line.map_err(|e| e.to_string())?;
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let p = parts.next().ok_or("missing path")?;
        let mtime_ms = parts.next().ok_or("missing mtime")?.parse().map_err(|e| format!("{e}"))?;
        let size = parts.next().ok_or("missing size")?.parse().map_err(|e| format!("{e}"))?;
        files.push(FileRecord { path: PathBuf::from(p), mtime_ms, size });
    }
    Ok(IndexCache { root: PathBuf::from(root), generated_at_ms, files, ceiling, omitted })
}

/// Snapshot the current walk into a cache record.
pub fn cache_from_walk(walk: WalkResult, generated_at_ms: u64) -> IndexCache {
    IndexCache {
        root: walk.root,
        generated_at_ms,
        files: walk.files,
        ceiling: walk.ceiling,
        omitted: walk.omitted,
    }
}

fn apply_ceiling(root: PathBuf, mut files: Vec<FileRecord>) -> WalkResult {
    if files.len() <= ENTRIES_PER_ROOT {
        return WalkResult { root, files, ceiling: false, omitted: 0 };
    }
    files.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    let omitted = files.len() - ENTRIES_PER_ROOT;
    files.truncate(ENTRIES_PER_ROOT);
    WalkResult { root, files, ceiling: true, omitted }
}

fn is_denied_name(name: &str) -> bool {
    DENY_DIRECTORY_NAMES.contains(&name)
}

fn allow_listed(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name == "theme.css" || name == "theme.toml" || name == "Dockerfile" || name == "Makefile" {
        return true;
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    MARKDOWN.contains(&ext.as_str()) || TEXT.contains(&ext.as_str()) || SOURCE.contains(&ext.as_str())
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn load_ignore(dir: &Path, rel: &str, rules: &mut Vec<IgnoreRule>) {
    for name in [".gitignore", ".ignore"] {
        if let Ok(text) = fs::read_to_string(dir.join(name)) {
            parse_ignore(&text, rel, rules);
        }
    }
}

#[derive(Clone, Debug)]
struct IgnoreRule {
    negated: bool,
    directory_only: bool,
    anchored: bool,
    pattern: String,
    base_dir: String,
}

fn parse_ignore(text: &str, base_dir: &str, rules: &mut Vec<IgnoreRule>) {
    for raw in text.lines() {
        let mut line = raw.to_string();
        if !line.ends_with("\\ ") {
            let trimmed = line.trim_end_matches(' ');
            line = trimmed.to_string();
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut negated = false;
        if let Some(rest) = line.strip_prefix('!') {
            negated = true;
            line = rest.to_string();
        }
        if let Some(rest) = line.strip_prefix("\\#") {
            line = format!("#{rest}");
        }
        let mut directory_only = false;
        if line.ends_with('/') && !line.ends_with("\\/") {
            directory_only = true;
            line.pop();
        }
        let mut anchored = line.starts_with('/');
        if anchored {
            line = line[1..].to_string();
        }
        if line.contains('/') {
            anchored = true;
        }
        if line.is_empty() {
            continue;
        }
        rules.push(IgnoreRule {
            negated,
            directory_only,
            anchored,
            pattern: line,
            base_dir: base_dir.to_string(),
        });
    }
}

fn is_ignored(rel: &str, is_dir: bool, rules: &[IgnoreRule]) -> bool {
    let rel = rel.replace('\\', "/");
    let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    for i in 0..parts.len() {
        let prefix = parts[..=i].join("/");
        let prefix_is_dir = is_dir || i + 1 < parts.len();
        if is_denied_name(parts[i]) {
            return true;
        }
        let status = last_match(&prefix, prefix_is_dir, rules);
        if prefix_is_dir && status == Some(true) {
            return true;
        }
        if !prefix_is_dir {
            return status == Some(true);
        }
    }
    false
}

fn last_match(rel: &str, is_dir: bool, rules: &[IgnoreRule]) -> Option<bool> {
    let mut status = None;
    for rule in rules {
        if rule.directory_only && !is_dir {
            continue;
        }
        if !under_base(rel, &rule.base_dir) {
            continue;
        }
        let rest = strip_base(rel, &rule.base_dir);
        if glob_match(&rule.pattern, rest, rule.anchored) {
            status = Some(!rule.negated);
        }
    }
    status
}

fn under_base(rel: &str, base: &str) -> bool {
    if base.is_empty() {
        return true;
    }
    rel == base || rel.starts_with(&format!("{base}/"))
}

fn strip_base<'a>(rel: &'a str, base: &str) -> &'a str {
    if base.is_empty() {
        return rel;
    }
    if rel == base {
        return "";
    }
    rel.strip_prefix(base).and_then(|s| s.strip_prefix('/')).unwrap_or(rel)
}

fn glob_match(pattern: &str, path: &str, anchored: bool) -> bool {
    if anchored {
        return glob_eq(pattern, path);
    }
    if glob_eq(pattern, path) {
        return true;
    }
    path.match_indices('/')
        .any(|(i, _)| glob_eq(pattern, &path[i + 1..]))
}

fn glob_eq(pattern: &str, path: &str) -> bool {
    glob_rec(pattern.as_bytes(), path.as_bytes())
}

fn glob_rec(pat: &[u8], path: &[u8]) -> bool {
    let mut pi = 0;
    let mut si = 0;
    while pi < pat.len() {
        if pat[pi] == b'*' && pi + 1 < pat.len() && pat[pi + 1] == b'*' {
            let rest = if pi + 2 < pat.len() && pat[pi + 2] == b'/' {
                &pat[pi + 3..]
            } else {
                &pat[pi + 2..]
            };
            if rest.is_empty() {
                return true;
            }
            for k in si..=path.len() {
                if (k == si || k == path.len() || path[k - 1] == b'/') && glob_rec(rest, &path[k..]) {
                    return true;
                }
            }
            return false;
        }
        if pat[pi] == b'*' {
            let rest = &pat[pi + 1..];
            for k in si..=path.len() {
                if path[si..k].contains(&b'/') {
                    break;
                }
                if glob_rec(rest, &path[k..]) {
                    return true;
                }
            }
            return false;
        }
        if pat[pi] == b'?' {
            if si >= path.len() || path[si] == b'/' {
                return false;
            }
            pi += 1;
            si += 1;
            continue;
        }
        if si >= path.len() || pat[pi] != path[si] {
            return false;
        }
        pi += 1;
        si += 1;
    }
    si == path.len()
}

fn push_field(out: &mut String, key: &str, value: &str) -> Result<(), String> {
    refuse_field(value)?;
    out.push_str(key);
    out.push('\t');
    out.push_str(value);
    out.push('\n');
    Ok(())
}

fn refuse_field(value: &str) -> Result<(), String> {
    if value.contains('\t') || value.contains('\n') {
        return Err("cache field contains a tab or newline".into());
    }
    Ok(())
}

fn field(lines: &mut impl Iterator<Item = std::io::Result<String>>, key: &str) -> Result<String, String> {
    let line = lines.next().ok_or_else(|| format!("missing {key}"))?.map_err(|e| e.to_string())?;
    let (got, value) = line.split_once('\t').ok_or_else(|| format!("bad {key} line"))?;
    if got != key {
        return Err(format!("expected {key}, got {got}"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    fn scratch(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("marxy-index-{label}-{nanos}"));
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn a_git_repository_is_the_index_root() {
        let repo = scratch("repo");
        fs::create_dir(repo.join(".git")).unwrap();
        let nested = repo.join("src").join("nested");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("readme.md");
        fs::write(&file, "# hi\n").unwrap();
        assert_eq!(index_root(&file), repo);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn without_a_repository_the_file_directory_is_the_root() {
        let dir = scratch("norepo");
        let file = dir.join("notes.md");
        fs::write(&file, "notes\n").unwrap();
        assert_eq!(index_root(&file), dir);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_git_file_counts_as_a_repository() {
        let repo = scratch("gitfile");
        fs::write(repo.join(".git"), "gitdir: /tmp/somewhere\n").unwrap();
        let file = repo.join("doc.md");
        fs::write(&file, "x\n").unwrap();
        assert_eq!(index_root(&file), repo);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn node_modules_is_never_walked() {
        let root = scratch("deny");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules").join("pkg")).unwrap();
        fs::write(root.join("src").join("readme.md"), "# src\n").unwrap();
        fs::write(root.join("node_modules").join("pkg").join("index.md"), "# no\n").unwrap();
        let walked = walk_root(&root);
        assert_eq!(walked.files.len(), 1);
        assert!(walked.files[0].path.ends_with("src/readme.md"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn gitignore_and_ignore_files_are_honoured() {
        let root = scratch("ignore");
        fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();
        fs::write(root.join(".ignore"), "secret.md\n").unwrap();
        fs::write(root.join("keep.md"), "# keep\n").unwrap();
        fs::write(root.join("drop.tmp"), "x").unwrap();
        fs::write(root.join("secret.md"), "# secret\n").unwrap();
        let walked = walk_root(&root);
        assert_eq!(walked.files.len(), 1);
        assert!(walked.files[0].path.ends_with("keep.md"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_symlink_out_of_the_root_is_not_followed() {
        let root = scratch("link");
        let outside = scratch("outside");
        fs::write(root.join("inside.md"), "# in\n").unwrap();
        fs::write(outside.join("escape.md"), "# out\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        let walked = walk_root(&root);
        assert_eq!(walked.files.len(), 1);
        assert!(walked.files[0].path.ends_with("inside.md"));
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn ceiling_keeps_newest_and_reports_omitted() {
        let files: Vec<FileRecord> = (0..=ENTRIES_PER_ROOT)
            .map(|i| FileRecord {
                path: PathBuf::from(format!("/r/{i}.md")),
                mtime_ms: i as u64,
                size: 1,
            })
            .collect();
        let walked = apply_ceiling(PathBuf::from("/r"), files);
        assert!(walked.ceiling);
        assert_eq!(walked.omitted, 1);
        assert_eq!(walked.files.len(), ENTRIES_PER_ROOT);
        assert!(!walked.files.iter().any(|f| f.mtime_ms == 0));
    }

    #[test]
    fn cache_round_trips_and_mtime_invalidates_it() {
        let dir = scratch("cache");
        let file = dir.join("a.md");
        fs::write(&file, "hi\n").unwrap();
        let walked = walk_root(&dir);
        let cache = cache_from_walk(walked.clone(), 1);
        let dest = dir.join("index.cache");
        write_cache(&dest, &cache).expect("write");
        let loaded = read_cache(&dest).expect("read");
        assert!(cache_is_current(&loaded.files, &walked.files));
        let now = SystemTime::now() + Duration::from_secs(2);
        filetime_set(&file, now).expect("set mtime");
        let again = walk_root(&dir);
        assert!(!cache_is_current(&loaded.files, &again.files));
        fs::remove_dir_all(&dir).ok();
    }

    fn filetime_set(path: &Path, when: SystemTime) -> std::io::Result<()> {
        std::fs::File::options().write(true).open(path)?.set_modified(when)
    }
}
