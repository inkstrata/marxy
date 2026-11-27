mod enc;
use enc::*;
use std::time::Instant;

fn jp(n: usize, mixed: bool) -> String {
    let mut s = String::new();
    while s.len() < n {
        s.push_str(if mixed { "Line 日本語のテキスト abc 漢字かな\n" } else { "日本語のテキストを読む漢字仮名交じり文。" });
    }
    s
}

fn report(name: &str, bytes: &[u8]) {
    let t = Instant::now();
    let d = decode(bytes, None).unwrap();
    let dt = t.elapsed();
    let tbl = match &d.map { ByteMap::Table(p) => p.len() * 4, _ => 0 };
    println!("PROBE {name}: file {} B, decode {:?}, text {} B, table {} B, frame {} B, found={} how={:?}", bytes.len(), dt, d.text.len(), tbl, 68 + tbl + d.text.len(), d.found.label, d.found.how);
}

fn rep2(name: &str, bytes: &[u8], chosen: Option<&str>) {
    let t = Instant::now();
    let d = decode(bytes, chosen).unwrap();
    let dt = t.elapsed();
    let tbl = match &d.map { ByteMap::Table(p) => p.len() * 4, _ => 0 };
    println!("PROBE {name}: file {} B, decode {:?}, text {} B, table {} B, frame {} B, found={} how={:?}", bytes.len(), dt, d.text.len(), tbl, 68 + tbl + d.text.len(), d.found.label, d.found.how);
}
fn main() {
    let texts = ["吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。", "私の名前は田中です。東京に住んでいます。毎日電車で会社に行きます。", "これはテストです。日本語のファイルを開いてください。"];
    for (i, t) in texts.iter().enumerate() {
        let b = encoding_rs::SHIFT_JIS.encode(&t.repeat(50)).0.into_owned();
        let d = decode(&b, None).unwrap();
        println!("PROBE natural sjis {i}: detected {} how={:?}", d.found.label, d.found.how);
        let g = encoding_rs::GBK.encode("我的名字是张三。我住在北京。每天坐地铁去公司上班，周末喜欢看书和听音乐。").0.into_owned();
        let d = decode(&g.repeat(30), None).unwrap();
        println!("PROBE natural gbk: detected {} how={:?}", d.found.label, d.found.how);
    }
}
