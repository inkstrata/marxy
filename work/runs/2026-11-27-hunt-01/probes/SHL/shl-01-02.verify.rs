use std::process::Command;
use std::path::{Path, PathBuf, Component};
fn spelling(raw:&Path)->PathBuf{ let mut o=PathBuf::new(); for c in raw.components(){ match c{Component::RootDir=>o.push("/"),Component::Normal(n)=>o.push(n),_=>{}} } o } // non-windows: no case fold, as file_scheme.rs:38
fn under(s:&Path,f:&Path)->bool{ s.starts_with(f) }
fn main(){
  // SHL-01: launchd PATH
  for prog in ["rg","git","node","brew"] {
    let r = Command::new(prog).arg("--version").env("PATH","/usr/bin:/bin:/usr/sbin:/sbin").output();
    println!("SHL-01 PATH=launchd default: {prog}: {}", match r {Ok(o)=>format!("ran, status {}",o.status), Err(e)=>format!("{:?} {}",e.kind(),e)});
  }
  // SHL-02
  let base = std::fs::canonicalize("/tmp").unwrap().join("shl02probe");
  let _=std::fs::remove_dir_all(&base);
  std::fs::create_dir_all(base.join("notes/images")).unwrap();
  std::fs::write(base.join("notes/images/a.png"),b"x").unwrap();
  let root=base.join("notes");
  for p in [root.join("Images/a.png"), base.join("NOTES/images/a.png"), base.join("NOTES/Images/a.png")] {
    println!("SHL-02 {}: disk opens: {}; may_hold(spelling, root opened as notes): {}", p.display(), std::fs::File::open(&p).is_ok(), under(&spelling(&p), &spelling(&root)));
  }
  let _=std::fs::remove_dir_all(&base);
}
