//! A SQLite write-ahead log read as SQLite recovers one (https://sqlite.org/fileformat2.html#walformat): the header's
//! salts and checksum, then each frame whose salts match and whose running checksum holds, up to the last frame that
//! commits. Used to count what the log holds, and to lay its committed pages over a copy of the database in memory when
//! the file cannot be opened in place. Nothing here touches the log on disk.

pub struct WalLog {
    pub page_size: u32,
    /// Frames in the file, valid or not.
    pub frames: u32,
    /// Valid frames up to and including the last commit.
    pub committed: u32,
    pub commits: u32,
    /// Pages in the database after the last commit; 0 when the log commits nothing.
    pub db_pages: u32,
    /// Each committed frame's page number and the byte at which its page starts in the log.
    pub pages: Vec<(u32, usize)>,
}

/// The -shm bytes `shm_frames` reads: two 48-byte header copies and the checkpoint block.
pub const SHM_HEADER: usize = 104;
const HEADER: usize = 32;
const FRAME_HEADER: usize = 24;

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn checksum(big: bool, data: &[u8], s: (u32, u32)) -> (u32, u32) {
    let (mut s0, mut s1) = s;
    for chunk in data.as_chunks::<8>().0 {
        let (x0, x1) = if big {
            (be32(chunk, 0), be32(chunk, 4))
        } else {
            (
                u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]),
                u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]),
            )
        };
        s0 = s0.wrapping_add(x0).wrapping_add(s1);
        s1 = s1.wrapping_add(x1).wrapping_add(s0);
    }
    (s0, s1)
}

/// The log in `bytes`, or None when it has no valid header (an empty or reset log).
pub fn read(bytes: &[u8]) -> Option<WalLog> {
    if bytes.len() < HEADER {
        return None;
    }
    let magic = be32(bytes, 0);
    let big = match magic {
        0x377f_0682 => false,
        0x377f_0683 => true,
        _ => return None,
    };
    let page_size = match be32(bytes, 8) {
        1 => 65_536,
        n if (512..=65_536).contains(&n) && n.is_power_of_two() => n,
        _ => return None,
    };
    let salts = (be32(bytes, 16), be32(bytes, 20));
    let mut sum = checksum(big, &bytes[..24], (0, 0));
    if sum != (be32(bytes, 24), be32(bytes, 28)) {
        return None;
    }
    let frame = FRAME_HEADER + page_size as usize;
    let frames = ((bytes.len() - HEADER) / frame) as u32;
    let mut log = WalLog {
        page_size,
        frames,
        committed: 0,
        commits: 0,
        db_pages: 0,
        pages: Vec::new(),
    };
    let mut pending: Vec<(u32, usize)> = Vec::new();
    for i in 0..frames as usize {
        let at = HEADER + i * frame;
        let head = &bytes[at..at + FRAME_HEADER];
        let page = be32(head, 0);
        if (be32(head, 8), be32(head, 12)) != salts || page == 0 {
            break;
        }
        sum = checksum(big, &head[..8], sum);
        sum = checksum(big, &bytes[at + FRAME_HEADER..at + frame], sum);
        if sum != (be32(head, 16), be32(head, 20)) {
            break;
        }
        pending.push((page, at + FRAME_HEADER));
        let commit = be32(head, 4);
        if commit > 0 {
            log.commits += 1;
            log.committed = (i + 1) as u32;
            log.db_pages = commit;
            log.pages.append(&mut pending);
        }
    }
    Some(log)
}

/// `db` with the log's committed pages laid over it, sized as the last commit says. Refused when that size is past `cap`:
/// the commit count is the frame's own u32, so a forged log claims terabytes.
pub fn apply(db: &mut Vec<u8>, log: &WalLog, wal: &[u8], cap: u64) -> Result<(), String> {
    if log.commits == 0 {
        return Ok(());
    }
    let size = log.page_size as usize;
    let want = log.db_pages as u64 * log.page_size as u64;
    if want > cap {
        return Err(format!(
            "its log says the database grows to {want} bytes, past the {cap} a copy in memory may hold"
        ));
    }
    db.resize(want as usize, 0);
    for &(page, at) in &log.pages {
        let to = (page as usize - 1) * size;
        if to + size <= db.len() {
            db[to..to + size].copy_from_slice(&wal[at..at + size]);
        }
    }
    Ok(())
}

/// What the -shm says of the log, when its two header copies agree: frames in the log, and frames already copied back
/// into the database (the checkpoint's `nBackfill`). Read in the byte order of the machine that wrote it, which is ours.
pub fn shm_frames(shm: &[u8]) -> Option<(u32, u32)> {
    if shm.len() < SHM_HEADER || shm[..48] != shm[48..96] || shm[12] == 0 {
        return None;
    }
    let ne = |at: usize| u32::from_ne_bytes([shm[at], shm[at + 1], shm[at + 2], shm[at + 3]]);
    Some((ne(16), ne(96)))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn put(b: &mut [u8], at: usize, v: u32) {
        b[at..at + 4].copy_from_slice(&v.to_be_bytes());
    }

    /// A valid log (magic, checksums, salts) with one committing frame that says the database has `pages` pages.
    pub fn forged(pages: u32) -> Vec<u8> {
        let page_size = 512u32;
        let mut b = vec![0u8; HEADER + FRAME_HEADER + page_size as usize];
        put(&mut b, 0, 0x377f_0683);
        put(&mut b, 4, 3_007_000);
        put(&mut b, 8, page_size);
        put(&mut b, 16, 0x1111_1111);
        put(&mut b, 20, 0x2222_2222);
        let s = checksum(true, &b[..24], (0, 0));
        put(&mut b, 24, s.0);
        put(&mut b, 28, s.1);
        let at = HEADER;
        put(&mut b, at, 1);
        put(&mut b, at + 4, pages);
        put(&mut b, at + 8, 0x1111_1111);
        put(&mut b, at + 12, 0x2222_2222);
        let s = checksum(true, &b[at..at + 8], s);
        let s = checksum(true, &b[at + FRAME_HEADER..], s);
        put(&mut b, at + 16, s.0);
        put(&mut b, at + 20, s.1);
        b
    }

    #[test]
    fn a_forged_log_claiming_terabytes_is_refused_before_it_allocates() {
        let wal = forged(u32::MAX);
        let log = read(&wal).expect("the forged log parses");
        let mut db = Vec::new();
        assert!(apply(&mut db, &log, &wal, 1 << 20).is_err());
        assert!(db.is_empty());
    }

    #[test]
    fn a_log_within_the_cap_is_applied() {
        let wal = forged(4);
        let log = read(&wal).unwrap();
        let mut db = Vec::new();
        apply(&mut db, &log, &wal, 1 << 20).unwrap();
        assert_eq!(db.len(), 4 * 512);
    }
}
