//! An SVGZ unpacked to its SVG, within a cap, and handed to the page as `image/svg+xml`: drawn through `<img>` as any
//! SVG is, so nothing in it runs or loads. A file that would unpack past the cap (a gzip bomb) is refused, unread past it.

use std::io::{BufRead, BufReader, Read};

use flate2::bufread::GzDecoder;

/// The most an SVGZ is unpacked to.
pub const MAX_UNPACKED: u64 = 16 * 1024 * 1024;

pub fn too_large_why() -> String {
    format!(
        "This SVGZ unpacks to more than {} MB, past the most Marxy unpacks, so it is not drawn.",
        MAX_UNPACKED / (1024 * 1024)
    )
}

pub const DAMAGED_WHY: &str = "This SVGZ does not unpack: its gzip stream is damaged.";

pub fn is_gzip(head: &[u8]) -> bool {
    head.starts_with(&[0x1F, 0x8B])
}

#[derive(Debug, PartialEq, Eq)]
pub enum Unpacked {
    Svg(Vec<u8>),
    TooLarge,
    Damaged,
}

/// The unpacked bytes, at most `MAX_UNPACKED`; one byte more is read only to learn there is more. Members are read in
/// turn; once one has unpacked whole, what follows that is no member (padding some tools add) ends the stream, not the file.
pub fn unpack(r: impl Read) -> Unpacked {
    let mut r = BufReader::new(r);
    let mut out = Vec::new();
    let mut whole = 0;
    loop {
        if whole > 0 && r.fill_buf().map_or(true, |b| b.is_empty()) {
            return Unpacked::Svg(out);
        }
        let before = out.len();
        let room = MAX_UNPACKED + 1 - before as u64;
        match GzDecoder::new(&mut r).take(room).read_to_end(&mut out) {
            Ok(_) if out.len() as u64 > MAX_UNPACKED => return Unpacked::TooLarge,
            Ok(_) => whole += 1,
            Err(_) if whole > 0 => {
                out.truncate(before);
                return Unpacked::Svg(out);
            }
            Err(_) => return Unpacked::Damaged,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::psd::tests::fixture;

    #[test]
    fn an_svgz_unpacks_and_a_bomb_is_refused_at_the_cap() {
        let Unpacked::Svg(svg) = unpack(&fixture("tiny.svgz")[..]) else {
            panic!("unpacks");
        };
        assert!(svg.starts_with(b"<svg"));
        let started = std::time::Instant::now();
        assert_eq!(unpack(&fixture("bomb.svgz")[..]), Unpacked::TooLarge);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        let mut cut = fixture("tiny.svgz");
        cut.truncate(cut.len() / 2);
        assert_eq!(unpack(&cut[..]), Unpacked::Damaged);
        // Zero padding or junk after a whole member is not damage; two members are one stream.
        for tail in [&[0u8; 512][..], b"not gzip", &fixture("tiny.svgz")[..10]] {
            let mut padded = fixture("tiny.svgz");
            padded.extend_from_slice(tail);
            assert_eq!(unpack(&padded[..]), Unpacked::Svg(svg.clone()));
        }
        let twice = [fixture("tiny.svgz"), fixture("tiny.svgz")].concat();
        assert_eq!(
            unpack(&twice[..]),
            Unpacked::Svg([svg.clone(), svg].concat())
        );
    }
}
