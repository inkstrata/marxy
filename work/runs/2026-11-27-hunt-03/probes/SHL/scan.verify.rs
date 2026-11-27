use std::collections::BTreeMap; use std::time::Instant; use std::path::PathBuf;
#[repr(C)] #[derive(Default,Clone,Copy)] struct Tv{s:i64,u:i32}
#[repr(C)] #[derive(Default)] struct Ru{ut:Tv,st:Tv,rest:[i64;14]}
extern "C"{fn getrusage(w:i32,r:*mut Ru)->i32;}
fn cpu()->f64{let mut r=Ru::default();unsafe{getrusage(0,&mut r)};(r.ut.s+r.st.s) as f64+(r.ut.u+r.st.u) as f64/1e6}
fn poll(d:&std::path::Path)->BTreeMap<PathBuf,(u64,u64)>{use std::os::unix::fs::MetadataExt;let mut m=BTreeMap::new();for e in std::fs::read_dir(d).unwrap(){let e=e.unwrap();let md=e.metadata().unwrap();if md.is_file(){m.insert(e.path(),(md.ino(),md.mtime() as u64));}}m}
fn main(){ let mut prev=0.0;
 for n in [1000usize,10000,50000]{ let d=PathBuf::from(format!("/private/tmp/shl-v3/d{n}")); std::fs::create_dir_all(&d).unwrap();
  for i in 0..n{ let p=d.join(format!("file-{i:06}.log")); if !p.exists(){std::fs::write(p,b"x").unwrap();}}
  let a=poll(&d);
  for run in 0..3{ let c=cpu();let t=Instant::now(); let b=poll(&d); let diff=a.iter().filter(|(k,v)|b.get(*k)!=Some(v)).count(); println!("{n} files run{run}: cpu {:.3}s wall {:?} (diff {diff})",cpu()-c,t.elapsed());}
 }}
