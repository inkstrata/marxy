//! `PR_RTF_COMPRESSED`: an RTF body packed with LZFu (or stored as it is, MELA), as MS-OXRTFCP lays it out. The output
//! is bounded by the size the stream declares and by a cap, and an LZFu stream's CRC is checked before anything is used.

/// Why a compressed RTF body is not read.
#[derive(Debug, PartialEq, Eq)]
pub enum Unpacked {
    /// Shorter than its header, an unknown kind, or references that run past the input.
    Damaged,
    /// Its CRC does not match its bytes.
    Check,
    /// It declares more than the cap.
    TooBig(u32),
}

const LZFU: u32 = 0x7546_5A4C;
const MELA: u32 = 0x414C_454D;

/// The dictionary every LZFu stream starts from (MS-OXRTFCP 2.1.2.1).
const PREBUF: &[u8] = b"{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/// The CRC MS-OXRTFCP names: the CRC-32 polynomial started at 0 and never inverted. crc32fast's is the inverted one, so
/// this starts it where an inverted start of all ones is 0, and inverts what it gives back.
fn crc(bytes: &[u8]) -> u32 {
    let mut h = crc32fast::Hasher::new_with_initial(0xFFFF_FFFF);
    h.update(bytes);
    !h.finalize()
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// The RTF in `stream`, at most `cap` bytes.
pub fn unpack(stream: &[u8], cap: usize) -> Result<Vec<u8>, Unpacked> {
    let comp_size = u32_at(stream, 0).ok_or(Unpacked::Damaged)? as usize;
    let raw_size = u32_at(stream, 4).ok_or(Unpacked::Damaged)?;
    let kind = u32_at(stream, 8).ok_or(Unpacked::Damaged)?;
    let check = u32_at(stream, 12).ok_or(Unpacked::Damaged)?;
    if raw_size as usize > cap {
        return Err(Unpacked::TooBig(raw_size));
    }
    // The declared size counts the twelve header bytes after itself; a writer that padded the stream is read to that size.
    let end = comp_size.checked_add(4).ok_or(Unpacked::Damaged)?;
    let data = stream.get(16..end.max(16)).ok_or(Unpacked::Damaged)?;
    match kind {
        MELA => Ok(data[..data.len().min(raw_size as usize)].to_vec()),
        LZFU => {
            if crc(data) != check {
                return Err(Unpacked::Check);
            }
            inflate(data, raw_size as usize)
        }
        _ => Err(Unpacked::Damaged),
    }
}

fn inflate(data: &[u8], raw_size: usize) -> Result<Vec<u8>, Unpacked> {
    let mut dict = [0u8; 4096];
    dict[..PREBUF.len()].copy_from_slice(PREBUF);
    let mut write = PREBUF.len();
    let mut out = Vec::with_capacity(raw_size);
    let mut at = 0;
    while at < data.len() {
        let flags = data[at];
        at += 1;
        for bit in 0..8 {
            if out.len() >= raw_size {
                return Ok(out);
            }
            if flags & (1 << bit) == 0 {
                let Some(&b) = data.get(at) else {
                    return Ok(out);
                };
                at += 1;
                dict[write] = b;
                write = (write + 1) % 4096;
                out.push(b);
                continue;
            }
            let (Some(&hi), Some(&lo)) = (data.get(at), data.get(at + 1)) else {
                return Err(Unpacked::Damaged);
            };
            at += 2;
            let word = u16::from_be_bytes([hi, lo]) as usize;
            let offset = word >> 4;
            let length = (word & 0xF) + 2;
            // A reference to where the next byte would go is the end of the stream.
            if offset == write {
                return Ok(out);
            }
            for k in 0..length {
                if out.len() >= raw_size {
                    return Ok(out);
                }
                let b = dict[(offset + k) % 4096];
                dict[write] = b;
                write = (write + 1) % 4096;
                out.push(b);
            }
        }
    }
    Ok(out)
}

/// `rtf` stored as an LZFu stream of literals only, with its CRC: how the tests make one without a compressor.
#[cfg(test)]
pub fn pack_literal(rtf: &[u8]) -> Vec<u8> {
    let mut data = Vec::new();
    for chunk in rtf.chunks(8) {
        data.push(0);
        data.extend_from_slice(chunk);
    }
    // The end: a reference to the write position, with its flag bit set.
    let write = (PREBUF.len() + rtf.len()) % 4096;
    let flag_bit = rtf.len() % 8;
    if flag_bit == 0 {
        data.push(1);
    } else {
        // The last control byte has room: its next bit marks the reference.
        let last = data.len() - 1 - (rtf.len() % 8);
        data[last] |= 1 << flag_bit;
    }
    data.extend_from_slice(&((write as u16) << 4).to_be_bytes());
    let mut out = Vec::new();
    out.extend_from_slice(&((data.len() + 12) as u32).to_le_bytes());
    out.extend_from_slice(&(rtf.len() as u32).to_le_bytes());
    out.extend_from_slice(&LZFU.to_le_bytes());
    out.extend_from_slice(&crc(&data).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// MS-OXRTFCP 3.1.1's example: `{\rtf1\ansi\ansicpg1252\pard hello world}` and its compressed bytes.
    const SPEC: &[u8] = &[
        0x2d, 0x00, 0x00, 0x00, 0x2b, 0x00, 0x00, 0x00, 0x4c, 0x5a, 0x46, 0x75, 0xf1, 0xc5, 0xc7,
        0xa7, 0x03, 0x00, 0x0a, 0x00, 0x72, 0x63, 0x70, 0x67, 0x31, 0x32, 0x35, 0x42, 0x32, 0x0a,
        0xf3, 0x20, 0x68, 0x65, 0x6c, 0x09, 0x00, 0x20, 0x62, 0x77, 0x05, 0xb0, 0x6c, 0x64, 0x7d,
        0x0a, 0x80, 0x0f, 0xa0,
    ];

    #[test]
    fn the_specs_example_unpacks() {
        assert_eq!(
            unpack(SPEC, 1 << 20).unwrap(),
            b"{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n".to_vec()
        );
    }

    #[test]
    fn a_wrong_crc_is_refused() {
        let mut bad = SPEC.to_vec();
        bad[20] ^= 1;
        assert_eq!(unpack(&bad, 1 << 20), Err(Unpacked::Check));
    }

    #[test]
    fn the_declared_size_bounds_the_output_and_the_cap_bounds_the_declared_size() {
        let mut short = SPEC.to_vec();
        short[4] = 5;
        assert_eq!(unpack(&short, 1 << 20).unwrap(), b"{\\rtf".to_vec());
        assert_eq!(unpack(SPEC, 10), Err(Unpacked::TooBig(0x2b)));
    }

    #[test]
    fn a_stored_body_and_a_literal_packing_read_back() {
        let rtf = b"{\\rtf1 plain}";
        let mut mela = Vec::new();
        mela.extend_from_slice(&((rtf.len() + 12) as u32).to_le_bytes());
        mela.extend_from_slice(&(rtf.len() as u32).to_le_bytes());
        mela.extend_from_slice(&MELA.to_le_bytes());
        mela.extend_from_slice(&0u32.to_le_bytes());
        mela.extend_from_slice(rtf);
        assert_eq!(unpack(&mela, 1 << 20).unwrap(), rtf.to_vec());
        for n in 0..20 {
            let text: Vec<u8> = (0..n).map(|i| b'a' + (i % 26) as u8).collect();
            assert_eq!(unpack(&pack_literal(&text), 1 << 20).unwrap(), text);
        }
    }

    #[test]
    fn truncated_or_unknown_streams_are_damaged_never_a_panic() {
        assert_eq!(unpack(&[], 100), Err(Unpacked::Damaged));
        assert_eq!(unpack(&SPEC[..10], 100), Err(Unpacked::Damaged));
        let mut other = SPEC.to_vec();
        other[8] = 0;
        assert_eq!(unpack(&other, 1 << 20), Err(Unpacked::Damaged));
        let mut huge = SPEC.to_vec();
        huge[0..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(unpack(&huge, 1 << 20), Err(Unpacked::Damaged));
        // Every prefix of a good stream, its CRC made to match, ends without a panic.
        for n in 16..SPEC.len() {
            let mut cut = SPEC[..n].to_vec();
            cut[0..4].copy_from_slice(&((n - 4) as u32).to_le_bytes());
            let c = crc(&cut[16..]);
            cut[12..16].copy_from_slice(&c.to_le_bytes());
            let _ = unpack(&cut, 1 << 20);
        }
    }
}
