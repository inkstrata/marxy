#![allow(dead_code)]
mod atomic_write;
use std::time::Instant;
use std::path::Path;
#[repr(C)] #[derive(Default,Clone,Copy)] struct Tv{s:i64,u:i32}
#[repr(C)] #[derive(Default)] struct Ru{ut:Tv,st:Tv,rest:[i64;14]}
extern "C"{fn getrusage(w:i32,r:*mut Ru)->i32;}
fn cpu()->f64{let mut r=Ru::default();unsafe{getrusage(0,&mut r)};(r.ut.s+r.st.s) as f64+(r.ut.u+r.st.u) as f64/1e6}
fn main(){
  let dir=Path::new("/private/tmp/shl-v/d"); std::fs::create_dir_all(dir).unwrap();
  let mut prev=0.0;
  for mb in [10usize,20,40]{
    let n=mb*1_000_000;
    let bytes:Vec<u8>=(0..n).map(|i|(i*7%251) as u8).collect();
    let p=dir.join(format!("v{mb}.txt")); std::fs::write(&p,&bytes).unwrap();
    for run in 0..3{
      let sha=String::from_utf8(std::process::Command::new("shasum").args(["-a","256",p.to_str().unwrap()]).output().unwrap().stdout).unwrap().split_whitespace().next().unwrap().to_string(); let e=atomic_write::Expected::from_hex(&format!("{:016x}{}",n,sha)).unwrap();
      let mut b2=bytes.clone(); b2[0]=run as u8+1;
      let (c0,t0)=(cpu(),Instant::now());
      let r=atomic_write::write_atomic_unless_changed(&p,&b2,Some(&e));
      let (cw,tw)=(cpu()-c0,t0.elapsed());
      std::fs::write(&p,&bytes).unwrap();
      let (c0,t0)=(cpu(),Instant::now());
      let r2=atomic_write::write_atomic_unless_changed(&p,&b2,None);
      let (cn,tn)=(cpu()-c0,t0.elapsed());
      std::fs::write(&p,&bytes).unwrap();
      println!("{mb} MB run {run}: with expectation cpu {cw:.3}s wall {tw:?} ok={}; without cpu {cn:.3}s wall {tn:?} ok={}",r.is_ok(),r2.is_ok());
    }
  }
}
