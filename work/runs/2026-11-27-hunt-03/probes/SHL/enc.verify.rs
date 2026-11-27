mod enc;
use enc::*;
use std::time::Instant;
#[repr(C)] #[derive(Default,Clone,Copy)] struct Tv{s:i64,u:i32}
#[repr(C)] #[derive(Default)] struct Ru{ut:Tv,st:Tv,rest:[i64;14]}
extern "C"{fn getrusage(w:i32,r:*mut Ru)->i32;}
fn cpu()->f64{let mut r=Ru::default();unsafe{getrusage(0,&mut r)};(r.ut.s+r.st.s) as f64+(r.ut.u+r.st.u) as f64/1e6}
fn jp(n:usize)->String{let mut s=String::new();while s.len()<n{s.push_str("日本語のテキストを読む漢字仮名交じり文。");}s}
fn main(){
  let mut last=[0.0f64;3];
  for (k,&n) in [1_000_000usize,2_000_000,4_000_000].iter().enumerate(){
    let sj=encoding_rs::SHIFT_JIS.encode(&jp(n*3/2)).0.into_owned(); let sj=&sj[..n-1]; // avoid cut char
    for run in 0..2{
      let c=cpu(); let t=Instant::now();
      let d=decode(sj,Some("shift_jis")).unwrap();
      let (dc,dw)=(cpu()-c,t.elapsed());
      let tbl=match &d.map{ByteMap::Table(p)=>p.len()*4,_=>0};
      let c=cpu(); let t=Instant::now(); let r=readings(sj); let (rc,rw)=(cpu()-c,t.elapsed());
      let c=cpu(); let t=Instant::now(); let g=sniff(sj); let (sc,sw)=(cpu()-c,t.elapsed());
      println!("sjis {n} run{run}: decode cpu {dc:.3}s wall {dw:?} table {tbl} B text {} B | readings cpu {rc:.3}s wall {rw:?} rows {} | sniff(open guess) cpu {sc:.3}s wall {sw:?} -> {} {:?}",d.text.len(),r.rows.len(),g.0,g.1);
      if run==1{ if k>0{println!("   growth decode cpu x{:.2} vs previous size",dc/last[0]);} last[0]=dc;}
    }
  }
  // SHL-02: natural text, small and large
  let texts=["吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。","私の名前は田中です。東京に住んでいます。毎日電車で会社に行きます。","これはテストです。日本語のファイルを開いてください。"];
  for t in texts{ for rep in [1usize,50,3000]{ let b=encoding_rs::SHIFT_JIS.encode(&t.repeat(rep)).0.into_owned(); let g=sniff(&b); println!("natural sjis rep{rep} ({} B): sniff -> {} {:?}; looks_like_utf8={}",b.len(),g.0,g.1,looks_like_utf8(&b)); }}
  for t in ["我的名字是张三。我住在北京。每天坐地铁去公司上班，周末喜欢看书和听音乐。","今天天气很好，我们一起去公园玩吧。"]{ for rep in [1usize,50]{ let b=encoding_rs::GBK.encode(&t.repeat(rep)).0.into_owned(); let g=sniff(&b); println!("natural gbk rep{rep} ({} B): sniff -> {} {:?}",b.len(),g.0,g.1);}}
  // control: single-line pure-kana/kanji with no の + lead
  let b=encoding_rs::SHIFT_JIS.encode(&"漢字仮名交じり文を読む。".repeat(50)).0.into_owned(); println!("control no-no sjis: {:?}",sniff(&b).0);

  // SHL-04: chardetng guess cost on files that reach it (Latin-1 prose, a Cyrillic file)
  let lat=encoding_rs::WINDOWS_1252.encode(&"Le café était très bon, déjà vu à l'été. Naïve façade.\n".repeat(100000)).0.into_owned();
  let cyr=encoding_rs::WINDOWS_1251.encode(&"Привет, мир! Это обычный русский текст для проверки.\n".repeat(100000)).0.into_owned();
  for (nm,b) in [("latin1",&lat),("cp1251",&cyr)]{ for &n in &[1_000_000usize,2_000_000,4_000_000]{ let b=&b[..n]; for run in 0..2{
    let c=cpu();let t=Instant::now(); let g=sniff(b); let (sc,sw)=(cpu()-c,t.elapsed());
    let c=cpu();let t=Instant::now(); let r=readings(b); let (rc,rw)=(cpu()-c,t.elapsed());
    let c=cpu();let t=Instant::now(); let d=decode(b,None).unwrap(); let (dc,dw)=(cpu()-c,t.elapsed());
    println!("{nm} {n} run{run}: sniff cpu {sc:.3}s wall {sw:?} -> {} {:?} | readings cpu {rc:.3}s wall {rw:?} | decode cpu {dc:.3}s wall {dw:?} ({})",g.0,g.1,d.found.label);}}}
}
