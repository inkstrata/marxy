//! Archives built in memory for the tests: a small zip writer (so a size, a CRC or a method can be made to lie) and
//! tar bytes with raw header names (`set_path` refuses `..`, which is exactly what a hostile archive carries).

use std::io::Write;

/// 2024-03-05 14:30:10 as a DOS (time, date).
const DOS: (u16, u16) = (
    (14 << 11) | (30 << 5) | 5,
    ((2024 - 1980) << 9) | (3 << 5) | 5,
);

pub struct Z {
    name: Vec<u8>,
    method: u16,
    flags: u16,
    comp: Vec<u8>,
    crc: u32,
    size: u64,
    ext_attr: u32,
    cd_extra: Vec<u8>,
    comment: Vec<u8>,
    z64: bool,
}

fn extra(id: u16, data: &[u8]) -> Vec<u8> {
    let mut v = id.to_le_bytes().to_vec();
    v.extend((data.len() as u16).to_le_bytes());
    v.extend(data);
    v
}

impl Z {
    fn new(name: &[u8], method: u16, comp: Vec<u8>, data: &[u8]) -> Z {
        Z {
            name: name.to_vec(),
            method,
            flags: 0,
            comp,
            crc: crc32fast::hash(data),
            size: data.len() as u64,
            ext_attr: 0,
            cd_extra: Vec::new(),
            comment: Vec::new(),
            z64: false,
        }
    }

    pub fn stored_raw(name: &[u8], data: &[u8]) -> Z {
        Z::new(name, 0, data.to_vec(), data)
    }

    pub fn stored(name: &str, data: &[u8]) -> Z {
        let mut z = Z::stored_raw(name.as_bytes(), data);
        if !name.is_ascii() {
            z.flags |= 0x800;
        }
        z
    }

    pub fn deflated(name: &str, data: &[u8]) -> Z {
        let mut enc =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        Z::new(name.as_bytes(), 8, enc.finish().unwrap(), data)
    }

    /// `comp` as the entry's data under `method`, checked against `data`.
    pub fn packed(name: &str, method: u16, comp: Vec<u8>, data: &[u8]) -> Z {
        Z::new(name.as_bytes(), method, comp, data)
    }

    pub fn dir(name: &str) -> Z {
        let mut z = Z::stored(name, b"");
        z.ext_attr = 0x10;
        z
    }

    /// The size the directory claims, whatever the data is.
    pub fn declaring(mut self, size: u64) -> Z {
        self.size = size;
        self
    }

    pub fn with_crc(mut self, crc: u32) -> Z {
        self.crc = crc;
        self
    }

    pub fn flagged(mut self, flags: u16) -> Z {
        self.flags |= flags;
        self
    }

    pub fn method(mut self, method: u16) -> Z {
        self.method = method;
        self
    }

    /// Saturated 32-bit fields in the directory and a 0x0001 extra holding the real values.
    pub fn zip64(mut self) -> Z {
        self.z64 = true;
        self
    }

    pub fn utc(mut self, secs: u32) -> Z {
        let mut d = vec![1u8];
        d.extend(secs.to_le_bytes());
        self.cd_extra.extend(extra(0x5455, &d));
        self
    }

    pub fn commented(mut self, comment: &[u8]) -> Z {
        self.comment = comment.to_vec();
        self
    }

    pub fn unicode_path(self, name: &str) -> Z {
        let crc = crc32fast::hash(&self.name);
        self.unicode_with(name, crc)
    }

    pub fn unicode_path_wrong_crc(self, name: &str) -> Z {
        let crc = crc32fast::hash(&self.name) ^ 1;
        self.unicode_with(name, crc)
    }

    fn unicode_with(mut self, name: &str, crc: u32) -> Z {
        let mut d = vec![1u8];
        d.extend(crc.to_le_bytes());
        d.extend(name.as_bytes());
        self.cd_extra.extend(extra(0x7075, &d));
        self
    }
}

fn local(z: &Z, out: &mut Vec<u8>) -> u32 {
    let at = out.len() as u32;
    out.extend(b"PK\x03\x04");
    out.extend(20u16.to_le_bytes());
    out.extend(z.flags.to_le_bytes());
    out.extend(z.method.to_le_bytes());
    out.extend(DOS.0.to_le_bytes());
    out.extend(DOS.1.to_le_bytes());
    out.extend(z.crc.to_le_bytes());
    out.extend((z.comp.len() as u32).to_le_bytes());
    out.extend((z.size as u32).to_le_bytes());
    out.extend((z.name.len() as u16).to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out.extend(&z.name);
    out.extend(&z.comp);
    at
}

fn central(z: &Z, lho: u32, out: &mut Vec<u8>) {
    let mut ex = z.cd_extra.clone();
    let (csize, size, off) = if z.z64 {
        let mut d = Vec::new();
        d.extend(z.size.to_le_bytes());
        d.extend((z.comp.len() as u64).to_le_bytes());
        d.extend(u64::from(lho).to_le_bytes());
        ex.extend(extra(0x0001, &d));
        (0xffff_ffffu32, 0xffff_ffffu32, 0xffff_ffffu32)
    } else {
        (z.comp.len() as u32, z.size as u32, lho)
    };
    out.extend(b"PK\x01\x02");
    out.extend(20u16.to_le_bytes());
    out.extend(20u16.to_le_bytes());
    out.extend(z.flags.to_le_bytes());
    out.extend(z.method.to_le_bytes());
    out.extend(DOS.0.to_le_bytes());
    out.extend(DOS.1.to_le_bytes());
    out.extend(z.crc.to_le_bytes());
    out.extend(csize.to_le_bytes());
    out.extend(size.to_le_bytes());
    out.extend((z.name.len() as u16).to_le_bytes());
    out.extend((ex.len() as u16).to_le_bytes());
    out.extend((z.comment.len() as u16).to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out.extend(z.ext_attr.to_le_bytes());
    out.extend(off.to_le_bytes());
    out.extend(&z.name);
    out.extend(ex);
    out.extend(&z.comment);
}

fn body(entries: &[Z]) -> (Vec<u8>, u32, u32) {
    let mut out = Vec::new();
    let offsets: Vec<u32> = entries.iter().map(|z| local(z, &mut out)).collect();
    let cd_off = out.len() as u32;
    for (z, lho) in entries.iter().zip(offsets) {
        central(z, lho, &mut out);
    }
    let cd_size = out.len() as u32 - cd_off;
    (out, cd_off, cd_size)
}

/// A zip with `comment` in its end record.
pub fn zip(entries: &[Z], comment: &[u8]) -> Vec<u8> {
    let (mut out, cd_off, cd_size) = body(entries);
    out.extend(b"PK\x05\x06");
    out.extend([0u8; 4]);
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend(cd_size.to_le_bytes());
    out.extend(cd_off.to_le_bytes());
    out.extend((comment.len() as u16).to_le_bytes());
    out.extend(comment);
    out
}

/// A zip whose end record is saturated and points at a zip64 end record through its locator.
pub fn zip64_end(entries: &[Z]) -> Vec<u8> {
    let (mut out, cd_off, cd_size) = body(entries);
    let z64_at = out.len() as u64;
    out.extend(b"PK\x06\x06");
    out.extend(44u64.to_le_bytes());
    out.extend(45u16.to_le_bytes());
    out.extend(45u16.to_le_bytes());
    out.extend([0u8; 8]);
    out.extend((entries.len() as u64).to_le_bytes());
    out.extend((entries.len() as u64).to_le_bytes());
    out.extend(u64::from(cd_size).to_le_bytes());
    out.extend(u64::from(cd_off).to_le_bytes());
    out.extend(b"PK\x06\x07");
    out.extend(0u32.to_le_bytes());
    out.extend(z64_at.to_le_bytes());
    out.extend(1u32.to_le_bytes());
    out.extend(b"PK\x05\x06");
    out.extend([0u8; 4]);
    out.extend(0xffffu16.to_le_bytes());
    out.extend(0xffffu16.to_le_bytes());
    out.extend(0xffff_ffffu32.to_le_bytes());
    out.extend(0xffff_ffffu32.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

/// Offset of the `nth` (0-based) occurrence of `sig`.
pub fn find(bytes: &[u8], sig: &[u8], nth: usize) -> usize {
    bytes
        .windows(sig.len())
        .enumerate()
        .filter(|(_, w)| *w == sig)
        .nth(nth)
        .map(|(i, _)| i)
        .unwrap()
}

/// What a tar entry is.
pub enum T {
    File,
    Dir,
    Symlink(&'static str),
    Global,
    Sparse,
}

/// A tar of `(raw header name, type, data)` entries, mtime 1,700,000,000.
pub fn tar(entries: &[(&[u8], T, &[u8])]) -> Vec<u8> {
    let mut b = ::tar::Builder::new(Vec::new());
    for (name, kind, data) in entries {
        let mut h = ::tar::Header::new_gnu();
        h.as_old_mut().name[..name.len()].copy_from_slice(name);
        h.set_mode(0o644);
        h.set_mtime(1_700_000_000);
        h.set_size(data.len() as u64);
        match kind {
            T::File => h.set_entry_type(::tar::EntryType::Regular),
            T::Dir => h.set_entry_type(::tar::EntryType::Directory),
            T::Symlink(target) => {
                h.set_entry_type(::tar::EntryType::Symlink);
                h.set_link_name(target).unwrap();
            }
            T::Global => h.set_entry_type(::tar::EntryType::XGlobalHeader),
            T::Sparse => {
                h.set_entry_type(::tar::EntryType::GNUSparse);
                // The GNU header's real-size field, which the reader insists on.
                h.as_mut_bytes()[483..495].copy_from_slice(b"00000000000\0");
            }
        }
        h.set_cksum();
        b.append(&h, *data).unwrap();
    }
    b.into_inner().unwrap()
}

pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    e.write_all(bytes).unwrap();
    e.finish().unwrap()
}
