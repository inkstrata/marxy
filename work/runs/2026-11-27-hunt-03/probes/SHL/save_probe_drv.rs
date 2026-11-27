#![allow(dead_code)]
mod atomic_write;
use std::time::Instant;
use std::path::Path;
fn main() {
    let dir = Path::new("/private/tmp/shl-save/d"); std::fs::create_dir_all(dir).unwrap();
    for mb in [5usize, 10, 20, 40, 80] {
        let n = mb * 1_000_000;
        let bytes: Vec<u8> = (0..n).map(|i| (i % 251) as u8).collect();
        let p = dir.join(format!("f{mb}.txt"));
        std::fs::write(&p, &bytes).unwrap();
        let t = Instant::now();
        let out = std::process::Command::new("shasum").args(["-a","256",p.to_str().unwrap()]).output().unwrap();
        let sha = String::from_utf8(out.stdout).unwrap().split_whitespace().next().unwrap().to_string();
        let hex = format!("{:016x}{}", n, sha);
        let e = atomic_write::Expected::from_hex(&hex).unwrap();
        let th = t.elapsed();
        for k in 0..4 {
            let mut b2 = bytes.clone(); b2[0] = k as u8 + 1;
            let t = Instant::now();
            let r = atomic_write::write_atomic_unless_changed(&p, &b2, if k % 2 == 0 && k < 2 { Some(&e) } else { None });
            println!("SAVE {n} B run {k}: {:?} ok={} (hash of {n} B: {:?})", t.elapsed(), r.is_ok(), th);
        }
    }
}
