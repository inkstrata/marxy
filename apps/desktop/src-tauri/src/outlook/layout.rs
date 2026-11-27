//! The compound file's own tables, read from its bytes once before cfb is given the file: the sector chains (FAT and
//! mini FAT), and the directory as a map of (parent, upper-cased name) to entry. cfb walks a stream's whole chain on every
//! open and refill, and a lookup by path walks every sibling of an unbalanced tree, so the cost of a read is known from
//! these tables and charged before the read; and a name is looked up here, never through a path string, so depth costs
//! nothing and a name holding a separator cannot stand for another.

use std::collections::HashMap;

use super::{Fault, Limits};

/// Chain ids from here up are markers (end of chain, free, FAT sector, DIFAT sector), not sectors.
const MARKER: u32 = 0xFFFF_FFFC;
const NONE: u32 = 0xFFFF_FFFF;

/// A stream shorter than this lives in the mini stream.
const MINI_CUTOFF: u64 = 4096;

/// What cfb fills a stream's buffer with at most; a read of more refills it, and each refill walks the chain again.
const BUFFER: u64 = 1 << 20;

/// Declared stream bytes past this many times the file are claimed by streams sharing sectors: a real file's streams
/// add up to about its own length.
const DECLARED_RATIO: u64 = 64;

const SIZE_UNKNOWN: u32 = 0;
const SIZE_WALKING: u32 = u32::MAX;

/// Next-pointers of a chain table, with the length of the chain from each sector, found once for all.
struct Chains {
    next: Vec<u32>,
    len: Vec<u32>,
    walk: Vec<u32>,
}

impl Chains {
    fn new(next: Vec<u32>) -> Chains {
        Chains {
            len: vec![SIZE_UNKNOWN; next.len()],
            next,
            walk: Vec::new(),
        }
    }

    /// Sectors in the chain that starts at `start`; a cycle, or a pointer past the table, is damage.
    fn length(&mut self, start: u32) -> Result<u32, Fault> {
        self.walk.clear();
        let mut at = start;
        let mut below = 0;
        while at < MARKER {
            let i = at as usize;
            match self.len.get(i).copied().ok_or(Fault::Damaged)? {
                SIZE_WALKING => return Err(Fault::Damaged),
                SIZE_UNKNOWN => {}
                known => {
                    below = known;
                    break;
                }
            }
            self.len[i] = SIZE_WALKING;
            self.walk.push(at);
            at = self.next[i];
        }
        for &s in self.walk.iter().rev() {
            below += 1;
            self.len[s as usize] = below;
        }
        Ok(below)
    }
}

pub struct Node {
    pub name: String,
    pub stream: bool,
    pub len: u64,
    start: u32,
    kids: Vec<u32>,
    /// The height of the sibling tree of its children: what a lookup of one of them costs cfb at most, whatever order
    /// the entries are in.
    height: u32,
}

pub struct Layout {
    nodes: Vec<Node>,
    by_name: HashMap<(u32, String), u32>,
    fat: Chains,
    mini: Chains,
    root_start: u32,
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

struct Raw {
    name: String,
    kind: u8,
    left: u32,
    right: u32,
    child: u32,
    start: u32,
    len: u64,
}

impl Layout {
    pub fn parse(b: &[u8], limits: &Limits) -> Result<Layout, Fault> {
        let bad = || Fault::Damaged;
        let shift = u16_at(b, 0x1E).ok_or_else(bad)?;
        if (shift != 9 && shift != 12) || u16_at(b, 0x20) != Some(6) {
            return Err(bad());
        }
        let ssize = 1usize << shift;
        let sectors = b.len().div_ceil(ssize).saturating_sub(1);
        let sector = |id: u32| -> Option<&[u8]> {
            let at = (id as usize + 1) * ssize;
            b.get(at..at + ssize)
        };

        // The FAT: its sectors come from the header and the DIFAT chain.
        let want = u32_at(b, 0x2C).ok_or_else(bad)? as usize;
        if want > sectors {
            return Err(bad());
        }
        let mut ids: Vec<u32> = Vec::new();
        for i in 0..109 {
            let v = u32_at(b, 0x4C + 4 * i).ok_or_else(bad)?;
            if v != NONE && ids.len() < want {
                ids.push(v);
            }
        }
        let mut more = u32_at(b, 0x44).ok_or_else(bad)?;
        let difat = u32_at(b, 0x48).ok_or_else(bad)? as usize;
        if difat > sectors {
            return Err(bad());
        }
        for _ in 0..difat {
            if ids.len() >= want || more >= MARKER {
                break;
            }
            let s = sector(more).ok_or_else(bad)?;
            for c in s[..ssize - 4].as_chunks::<4>().0 {
                let v = u32::from_le_bytes(*c);
                if v != NONE && ids.len() < want {
                    ids.push(v);
                }
            }
            more = u32_at(s, ssize - 4).ok_or_else(bad)?;
        }
        let mut fat = Vec::with_capacity(ids.len() * ssize / 4);
        for &id in &ids {
            let s = sector(id).ok_or_else(bad)?;
            fat.extend(s.as_chunks::<4>().0.iter().map(|c| u32::from_le_bytes(*c)));
        }

        // The sectors of a chain read once, never past `most` of them: a chain longer than that has a cycle in it.
        let follow = |start: u32, most: usize| -> Result<Vec<u32>, Fault> {
            let mut out = Vec::new();
            let mut at = start;
            while at < MARKER {
                if out.len() >= most {
                    return Err(bad());
                }
                out.push(at);
                at = *fat.get(at as usize).ok_or_else(bad)?;
            }
            Ok(out)
        };

        let mini_count = u32_at(b, 0x40).ok_or_else(bad)? as usize;
        let mut mini = Vec::new();
        for id in follow(u32_at(b, 0x3C).ok_or_else(bad)?, sectors)?
            .into_iter()
            .take(mini_count)
        {
            let s = sector(id).ok_or_else(bad)?;
            mini.extend(s.as_chunks::<4>().0.iter().map(|c| u32::from_le_bytes(*c)));
        }

        // The directory.
        let dir = follow(u32_at(b, 0x30).ok_or_else(bad)?, sectors)?;
        let count = dir.len() * (ssize / 128);
        if count > limits.entries {
            return Err(Fault::TooBig(format!(
                "The message's compound file holds more than {} directory entries, past what a message is read with.",
                limits.entries
            )));
        }
        let mask = if shift == 9 { 0xFFFF_FFFF } else { u64::MAX };
        let mut raw = Vec::with_capacity(count);
        for id in dir {
            for e in sector(id).ok_or_else(bad)?.as_chunks::<128>().0 {
                let kind = e[66];
                let mut name = String::new();
                if matches!(kind, 1 | 2 | 5) {
                    let n = u16_at(e, 64).ok_or_else(bad)? as usize;
                    if n > 64 || n % 2 == 1 {
                        return Err(bad());
                    }
                    let units: Vec<u16> = e[..n.saturating_sub(2)]
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|c| u16::from_le_bytes(*c))
                        .collect();
                    name = String::from_utf16(&units).map_err(|_| bad())?;
                } else if kind != 0 {
                    return Err(bad());
                }
                let stream = kind == 2;
                raw.push(Raw {
                    name,
                    kind,
                    left: u32_at(e, 68).ok_or_else(bad)?,
                    right: u32_at(e, 72).ok_or_else(bad)?,
                    child: u32_at(e, 76).ok_or_else(bad)?,
                    start: if stream || kind == 5 {
                        u32_at(e, 116).ok_or_else(bad)?
                    } else {
                        0
                    },
                    len: if stream {
                        u64::from_le_bytes(e[120..128].try_into().map_err(|_| bad())?) & mask
                    } else {
                        0
                    },
                });
            }
        }
        if raw.first().map(|r| r.kind) != Some(5) {
            return Err(bad());
        }

        // Every entry the tree reaches, once: a second visit is a cycle or a shared entry.
        let mut nodes: Vec<Node> = raw
            .iter()
            .map(|_| Node {
                name: String::new(),
                stream: false,
                len: 0,
                start: 0,
                kids: Vec::new(),
                height: 0,
            })
            .collect();
        let mut seen = vec![false; raw.len()];
        seen[0] = true;
        let root_start = raw[0].start;
        let mut by_name = HashMap::new();
        let mut declared = 0u64;
        let mut todo: Vec<(u32, u32, u32)> = Vec::new();
        let push = |todo: &mut Vec<(u32, u32, u32)>, id: u32, parent: u32, depth: u32| {
            if id == NONE {
                return Ok(());
            }
            if id as usize >= raw.len() {
                return Err(bad());
            }
            todo.push((id, parent, depth));
            Ok(())
        };
        push(&mut todo, raw[0].child, 0, 1)?;
        while let Some((id, parent, depth)) = todo.pop() {
            let i = id as usize;
            if std::mem::replace(&mut seen[i], true) {
                return Err(bad());
            }
            let r = &raw[i];
            let stream = match r.kind {
                1 => false,
                2 => true,
                _ => return Err(bad()),
            };
            if by_name
                .insert((parent, r.name.to_uppercase()), id)
                .is_some()
            {
                return Err(bad());
            }
            nodes[parent as usize].kids.push(id);
            if stream {
                if r.child != NONE {
                    return Err(bad());
                }
                declared = declared.saturating_add(r.len);
                if declared > (b.len() as u64).saturating_mul(DECLARED_RATIO) {
                    return Err(Fault::TooBig(
                        "The message's streams declare far more bytes than the file holds: they share sectors, and it is not read."
                            .into(),
                    ));
                }
            } else {
                push(&mut todo, r.child, id, 1)?;
            }
            push(&mut todo, r.left, parent, depth + 1)?;
            push(&mut todo, r.right, parent, depth + 1)?;
            let n = &mut nodes[i];
            n.name = r.name.clone();
            n.stream = stream;
            n.len = r.len;
            n.start = r.start;
            let h = &mut nodes[parent as usize].height;
            *h = (*h).max(depth);
        }

        Ok(Layout {
            nodes,
            by_name,
            fat: Chains::new(fat),
            mini: Chains::new(mini),
            root_start,
        })
    }

    #[cfg(test)]
    pub fn entries(&self) -> usize {
        self.nodes.len()
    }

    pub fn node(&self, id: u32) -> &Node {
        &self.nodes[id as usize]
    }

    /// The entries directly under a storage.
    pub fn kids(&self, id: u32) -> impl Iterator<Item = &Node> {
        self.nodes[id as usize]
            .kids
            .iter()
            .map(|&k| &self.nodes[k as usize])
    }

    /// The entry at `path` (the root is "") and the steps cfb takes to find it by that path at most: the height of each
    /// sibling tree it searches.
    pub fn resolve(&self, path: &str) -> Option<(u32, u64)> {
        let mut at = 0u32;
        let mut hops = 0u64;
        for part in path.split('/').filter(|p| !p.is_empty()) {
            hops += u64::from(self.nodes[at as usize].height);
            at = *self.by_name.get(&(at, part.to_uppercase()))?;
        }
        Some((at, hops))
    }

    /// The steps cfb takes to read `take` bytes of the stream `id`: it walks the whole chain once for each refill of its
    /// buffer. A mini stream is read a 64-byte mini sector at a time, and each of those reads walks the root chain it
    /// lives in again, so it costs its mini chain once and the root chain (and one more) per mini sector; the whole of
    /// it is read at once, being under 4096 bytes.
    pub fn cost(&mut self, id: u32, take: u64) -> Result<u64, Fault> {
        if take == 0 {
            return Ok(0);
        }
        let n = &self.nodes[id as usize];
        let (len, start) = (n.len, n.start);
        let per = if len < MINI_CUTOFF {
            let root = u64::from(self.fat.length(self.root_start)?);
            u64::from(self.mini.length(start)?) + (root + 1) * len.div_ceil(64)
        } else {
            u64::from(self.fat.length(start)?)
        };
        if len < MINI_CUTOFF {
            return Ok(per);
        }
        Ok(per * (1 + take.div_ceil(BUFFER)))
    }
}
