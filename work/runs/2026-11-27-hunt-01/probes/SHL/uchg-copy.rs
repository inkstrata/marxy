use std::fs::{self, OpenOptions};
use std::io::Write;
fn main() {
    let d = std::env::args().nth(1).unwrap();
    let target = format!("{d}/doc.md");
    let tmp = format!("{d}/.doc.md.tmp");
    fs::write(&target, "old").unwrap();
    std::process::Command::new("chflags").args(["uchg", &target]).status().unwrap();
    println!("readonly(): {}", fs::metadata(&target).unwrap().permissions().readonly());
    OpenOptions::new().write(true).create_new(true).open(&tmp).unwrap();
    println!("copy: {:?}", fs::copy(&target, &tmp));
    let r = OpenOptions::new().write(true).truncate(true).open(&tmp);
    println!("open tmp for write: {:?}", r.as_ref().err());
    if let Ok(mut f) = r { f.write_all(b"new").unwrap(); }
    let _ = std::process::Command::new("chflags").args(["nouchg", &tmp]).status();
    let _ = std::process::Command::new("chflags").args(["nouchg", &target]).status();
}
