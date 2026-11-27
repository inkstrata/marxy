use std::fs::{self, OpenOptions};
use std::io::Write;
use std::process::Command;
fn ls(d:&str){ let o=Command::new("ls").args(["-laO",d]).output().unwrap(); print!("{}",String::from_utf8_lossy(&o.stdout)); }
fn main(){
  let d=std::env::args().nth(1).unwrap();
  let target=format!("{d}/doc.md"); let tmp=format!("{d}/.doc.md.marxy-tmp-1-0-0");
  fs::write(&target,"old\n").unwrap();
  Command::new("chflags").args(["uchg",&target]).status().unwrap();
  println!("readonly(): {}", fs::metadata(&target).unwrap().permissions().readonly());
  // stage: create_new temp, copy destination onto it (fcopyfile COPYFILE_ALL)
  OpenOptions::new().write(true).create_new(true).open(&tmp).unwrap();
  println!("copy: {:?}", fs::copy(&target,&tmp));
  // write the new bytes into the staged file
  match OpenOptions::new().write(true).truncate(true).open(&tmp) {
    Ok(mut f)=>{ f.write_all(b"new\n").unwrap(); println!("write ok"); }
    Err(e)=>println!("READER SEES: {tmp}: {e}  (kind {:?})", e.kind()),
  }
  // failure cleanup as at atomic_write.rs:148 (result ignored there)
  println!("cleanup remove_file(tmp): {:?}", fs::remove_file(&tmp));
  println!("temp still present: {}", fs::symlink_metadata(&tmp).is_ok());
  println!("rename tmp over target: {:?}", fs::rename(&tmp,&target));
  println!("target contents: {:?}", fs::read_to_string(&target));
  ls(&d);
}
