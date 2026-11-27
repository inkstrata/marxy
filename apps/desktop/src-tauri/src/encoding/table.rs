//! The byte map of a multi-byte legacy encoding (`ByteMap::Table`), kept small.
//!
//! The map is the list of (UTF-8 offset, file offset) pairs at each place their difference changes (the first, (0, bom),
//! is implied). For Shift_JIS or GBK text that is a pair for every character, which as two `u32`s was four bytes of map
//! for each byte of file. Here the pairs are stored as steps from the one before, and equal steps (a run of two-byte
//! characters each becoming three) as one `(du, df, n)` record of three varints: a page of Japanese is a few records,
//! and the worst case (steps that never repeat) is about the size of the file. A seek still lands on the same pair:
//! every `GROUP` records the state before the record is kept in `index` as (UTF-8 offset, file offset, byte offset into
//! `runs`), so a lookup is a binary search of the index and then at most `GROUP` records, the last cut by division.
//!
//! `packages/core/src/encoding/byte-map.ts` reads the same two arrays (`index` as little-endian `u32`s, `runs` as
//! bytes): the layout is the frame `commands::frame` writes.

/// Records between two index entries.
pub const GROUP: u32 = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    /// (UTF-8 offset, file offset, byte offset in `runs`) before every `GROUP`th record, the first at (0, bom, 0).
    pub index: Vec<u32>,
    /// Records of three LEB128 varints: the step in UTF-8 offset, the step in file offset, how many such steps.
    pub runs: Vec<u8>,
    records: u32,
    /// The last pair pushed, and the record being run (its step and count) with the pair it started from.
    end: (u32, u32),
    pending: Option<(u32, u32, u32)>,
    start: (u32, u32),
}

fn put(out: &mut Vec<u8>, mut v: u32) {
    while v >= 0x80 {
        out.push((v & 0x7f) as u8 | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

#[cfg(test)]
fn get(runs: &[u8], at: &mut usize) -> u32 {
    let (mut v, mut shift) = (0u32, 0);
    while let Some(&b) = runs.get(*at) {
        *at += 1;
        v |= u32::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    v
}

impl Table {
    /// An empty table whose implied first pair is (0, `bom`).
    pub fn new(bom: u32) -> Table {
        Table {
            index: Vec::new(),
            runs: Vec::new(),
            records: 0,
            end: (0, bom),
            pending: None,
            start: (0, bom),
        }
    }

    fn flush(&mut self) {
        let Some((du, df, n)) = self.pending.take() else {
            return;
        };
        if self.records.is_multiple_of(GROUP) {
            self.index
                .extend_from_slice(&[self.start.0, self.start.1, self.runs.len() as u32]);
        }
        put(&mut self.runs, du);
        put(&mut self.runs, df);
        put(&mut self.runs, n);
        self.records += 1;
    }

    /// The next pair: both offsets above the last one's.
    pub fn push(&mut self, u: u32, f: u32) {
        let step = (u - self.end.0, f - self.end.1);
        match &mut self.pending {
            Some((du, df, n)) if (*du, *df) == step => *n += 1,
            _ => {
                self.flush();
                self.start = self.end;
                self.pending = Some((step.0, step.1, 1));
            }
        }
        self.end = (u, f);
    }

    /// Done pushing: the table, with its last record written.
    pub fn finish(mut self) -> Table {
        self.flush();
        if self.index.is_empty() {
            self.index.extend_from_slice(&[0, self.end.1, 0]);
        }
        self
    }

    /// Bytes the map holds. (The lookups are for tests: the page does them, in `byte-map.ts`.)
    #[cfg(test)]
    pub fn byte_len(&self) -> usize {
        self.index.len() * 4 + self.runs.len()
    }

    #[cfg(test)]
    /// The last pair whose UTF-8 offset (`by_file` false) or file offset (true) is at most `value`; (0, bom) if none.
    pub fn seek(&self, by_file: bool, value: u64) -> (u64, u64) {
        let key = |u: u64, f: u64| if by_file { f } else { u };
        let entries = self.index.len() / 3;
        let (mut lo, mut hi) = (0usize, entries);
        while lo < hi {
            let mid = (lo + hi) / 2;
            let e = &self.index[mid * 3..mid * 3 + 3];
            if key(u64::from(e[0]), u64::from(e[1])) <= value {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        // The first entry is the implied pair, so an offset before it has no pair: the implied one.
        let e = &self.index[lo.saturating_sub(1) * 3..lo.saturating_sub(1) * 3 + 3];
        let (mut u, mut f, mut at) = (u64::from(e[0]), u64::from(e[1]), e[2] as usize);
        while at < self.runs.len() {
            let du = u64::from(get(&self.runs, &mut at));
            let df = u64::from(get(&self.runs, &mut at));
            let n = u64::from(get(&self.runs, &mut at));
            let (step, now) = if by_file { (df, f) } else { (du, u) };
            if value < now {
                break;
            }
            let k = ((value - now) / step.max(1)).min(n);
            u += k * du;
            f += k * df;
            if k < n {
                break;
            }
        }
        (u, f)
    }
}
