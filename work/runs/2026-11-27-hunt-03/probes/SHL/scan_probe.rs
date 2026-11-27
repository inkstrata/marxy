use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::Instant;
fn scan(root: &Path) -> BTreeMap<std::path::PathBuf, (u128, u64, u64)> {
    let mut out = BTreeMap::new();
    for e in std::fs::read_dir(root).unwrap().flatten() {
        let Ok(m) = e.metadata() else { continue };
        if m.is_file() {
            out.insert(root.join(e.file_name()), (m.mtime_nsec() as u128, m.len(), m.ino()));
        }
    }
    out
}
fn main() {
    let d = Path::new("/private/tmp/shl-scan/d");
    let mut made = 0usize;
    for n in [1_000usize, 10_000, 50_000] {
        while made < n { std::fs::write(d.join(format!("log-{made:06}.txt")), b"x").unwrap(); made += 1; }
        let _ = scan(d);
        let t = Instant::now();
        for _ in 0..3 { let s = scan(d); assert!(s.len() >= n); }
        println!("SCAN {n} files: {:?} per poll", t.elapsed() / 3);
    }
}
