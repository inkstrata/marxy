//! Byte-faithful saving: stage the new bytes beside the destination, then rename over it. The only
//! place marxy writes a reader's document.
//!
//! The module depends on `std` and, on Linux, xattr syscalls declared inline so that
//! `pnpm gate:fidelity` can compile it with a bare `rustc` and drive this exact code over the
//! corpus, instead of checking a second implementation of it.

use std::fmt;
use std::fs::File;
use std::fs::{self, Metadata, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Refusal vs I/O failure for the shell boundary; message is shown to the reader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteErrorKind {
    Permission,
    Io,
    /// A create-only write found something at the name; nothing was written.
    Exists,
    /// The file is no longer what the caller read; nothing was written.
    Changed,
}

#[derive(Debug, Clone)]
pub struct WriteError {
    pub kind: WriteErrorKind,
    pub message: String,
}

impl WriteError {
    fn permission(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Permission,
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Io,
            message: message.into(),
        }
    }

    fn exists(message: impl Into<String>) -> Self {
        Self {
            kind: WriteErrorKind::Exists,
            message: message.into(),
        }
    }

    fn changed(path: &Path) -> Self {
        Self {
            kind: WriteErrorKind::Changed,
            message: format!(
                "{}: changed on disk since it was opened; refusing to overwrite",
                path.display()
            ),
        }
    }
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

#[cfg(unix)]
use std::os::unix::fs::{chown, MetadataExt};

/// Saves attempted in this process; part of the temporary file's name so two saves never collide.
static ATTEMPTS: AtomicU64 = AtomicU64::new(0);

/// Writes exactly `bytes` to `path`, atomically, changing nothing else about the file.
///
/// Every byte is written to a temporary file in the destination's own directory and flushed to disk
/// before a rename puts it in place, so an interrupted save leaves either the old bytes or the new
/// ones and never a truncated file. The destination's mode is carried across the rename. Anything
/// that would quietly change something the reader did not ask to change — a read-only file, a file
/// owned by someone else, a name with more than one hard link — is refused with a message rather
/// than done silently.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    write_atomic_unless_changed(path, bytes, None)
}

/// `write_atomic`, refused with `WriteErrorKind::Changed` when the file there is no longer `expected` (what the
/// caller last read). The file is checked on one open handle, held until the rename: on Windows it lets nothing
/// else open the file for writing meanwhile, and everywhere the handle, the name and which file the name leads to
/// are compared again just before the rename, so a write or a rename into place while the save stages is caught.
/// A file that is gone has nothing to overwrite, so the save makes it again, but only while the name is still free.
pub fn write_atomic_unless_changed(
    path: &Path,
    bytes: &[u8],
    expected: Option<&Expected>,
) -> Result<(), WriteError> {
    let target = keep_disk_case(resolve_symlink(path)?);
    let dir = parent_directory(&target)?;
    let destination = refuse_surprising_destination(&target)?;
    let checked = match (expected, destination.is_some()) {
        (Some(expected), true) => check_unchanged(path, &target, expected)?,
        _ => None,
    };
    let tmp = temp_path_for(&target);
    let saved = stage(&tmp, &target, destination.as_ref(), bytes).and_then(|()| match &checked {
        Some(checked) => checked
            .still_there(path, &target)
            .and_then(|()| commit(&tmp, &target, &dir)),
        // Checked against a file that was not there: one that appeared while the save staged is not replaced.
        None if expected.is_some() => commit_if_still_free(path, &tmp, &target, &dir),
        None => commit(&tmp, &target, &dir),
    });
    // Only now: holding it through the rename is what keeps other writers out until the save is in place.
    drop(checked);
    match saved {
        Ok(()) => sweep_once(&dir),
        Err(_) => {
            remove_staged(&tmp);
        }
    }
    saved
}

/// Removes a staged file after a failed save. On macOS a staged copy that picked up the destination's immutable flag
/// (`uchg`, a file locked in Finder) cannot be removed until the flag is cleared, so it is cleared first.
fn remove_staged(tmp: &Path) {
    if fs::remove_file(tmp).is_ok() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        macos_flags::clear(tmp);
        let _ = fs::remove_file(tmp);
    }
}

/// Whether the file carries the user or system immutable flag, which Finder shows as Locked: writing, removing and
/// renaming over it all fail with "Operation not permitted".
#[cfg(target_os = "macos")]
fn locked_in_finder(meta: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    meta.st_flags() & (macos_flags::UF_IMMUTABLE | macos_flags::SF_IMMUTABLE) != 0
}

#[cfg(target_os = "macos")]
mod macos_flags {
    use std::ffi::{c_char, c_int, c_uint};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    pub const UF_IMMUTABLE: u32 = 0x0000_0002;
    pub const SF_IMMUTABLE: u32 = 0x0002_0000;

    extern "C" {
        fn chflags(path: *const c_char, flags: c_uint) -> c_int;
    }

    /// Clears every file flag on `path`; best effort.
    pub fn clear(path: &Path) {
        let mut bytes = path.as_os_str().as_bytes().to_vec();
        bytes.push(0);
        // SAFETY: `bytes` is NUL-terminated and outlives the call.
        unsafe {
            chflags(bytes.as_ptr().cast(), 0);
        }
    }
}

/// Publishes the staged file at a name that was free when the save began, refusing with `Changed` if something
/// is there now. The exclusive rename decides that in one step; where the volume has no exclusive way, the name is
/// looked at once more just before an ordinary rename.
fn commit_if_still_free(
    shown: &Path,
    tmp: &Path,
    target: &Path,
    dir: &Path,
) -> Result<(), WriteError> {
    // Named rather than passed inline: the fidelity gate breaks write_new by patching the inline form there.
    let exclusive_rename = exclusive::rename;
    match commit_new(tmp, target, dir, &exclusive_rename, &|from, to| {
        fs::hard_link(from, to)
    }) {
        Ok(()) => Ok(()),
        Err(e) if e.kind == WriteErrorKind::Exists => Err(WriteError::changed(shown)),
        Err(_) => {
            if fs::symlink_metadata(target).is_ok() {
                return Err(WriteError::changed(shown));
            }
            commit(tmp, target, dir)
        }
    }
}

/// What a caller read at a path: its length and SHA-256, as the webview's `fingerprint` spells it (the length as
/// 8 big-endian bytes, then the digest) in 80 hex digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected {
    pub len: u64,
    pub sha256: [u8; 32],
}

impl Expected {
    #[cfg(test)]
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            len: bytes.len() as u64,
            sha256: sha256::digest(bytes),
        }
    }

    pub fn from_hex(hex: &str) -> Option<Self> {
        let raw = hex.as_bytes();
        if raw.len() != 80 {
            return None;
        }
        let digit = |c: u8| (c as char).to_digit(16);
        let mut out = [0u8; 40];
        for (i, pair) in raw.chunks(2).enumerate() {
            out[i] = (digit(pair[0])? * 16 + digit(pair[1])?) as u8;
        }
        let mut len = [0u8; 8];
        len.copy_from_slice(&out[..8]);
        let mut sha256 = [0u8; 32];
        sha256.copy_from_slice(&out[8..]);
        Some(Self {
            len: u64::from_be_bytes(len),
            sha256,
        })
    }
}

/// The destination as it was when its bytes were found to be the expected ones.
struct Checked {
    file: File,
    len: u64,
    modified: Option<SystemTime>,
    identity: FileIdentity,
}

impl Checked {
    /// The handle still shows the file as checked, and the name still leads to it rather than to a file another
    /// program renamed into place meanwhile.
    fn still_there(&self, shown: &Path, target: &Path) -> Result<(), WriteError> {
        let inspect = |e: std::io::Error| {
            WriteError::io(format!("{}: cannot be inspected: {e}", shown.display()))
        };
        let held = self.file.metadata().map_err(inspect)?;
        let gone_or = |e: std::io::Error| {
            if e.kind() == std::io::ErrorKind::NotFound {
                WriteError::changed(shown)
            } else {
                inspect(e)
            }
        };
        let named = fs::metadata(target).map_err(gone_or)?;
        let named_identity = identity_at(target).map_err(gone_or)?;
        let as_checked =
            |meta: &Metadata| meta.len() == self.len && meta.modified().ok() == self.modified;
        if !as_checked(&held) || !as_checked(&named) || differ(named_identity, self.identity) {
            return Err(WriteError::changed(shown));
        }
        Ok(())
    }
}

/// Which file a handle or a name leads to, whatever its name: device and inode on Unix, volume serial and file
/// index on Windows. A file renamed into place has its own, even with the same length and write time.
type FileIdentity = (u64, u64);

/// Two files for certain. A zero on either side is no identity at all (SMB, WebDAV and FUSE volumes can report one,
/// or an index that is not stable), so the length and write time decide alone rather than every save being refused.
fn differ(a: FileIdentity, b: FileIdentity) -> bool {
    let known = |(volume, index): FileIdentity| volume != 0 && index != 0;
    known(a) && known(b) && a != b
}

#[cfg(unix)]
fn identity_of(file: &File) -> std::io::Result<FileIdentity> {
    let meta = file.metadata()?;
    Ok((meta.dev(), meta.ino()))
}

#[cfg(unix)]
fn identity_at(path: &Path) -> std::io::Result<FileIdentity> {
    let meta = fs::metadata(path)?;
    Ok((meta.dev(), meta.ino()))
}

#[cfg(windows)]
fn identity_of(file: &File) -> std::io::Result<FileIdentity> {
    windows_files::identity(file)
}

#[cfg(windows)]
fn identity_at(path: &Path) -> std::io::Result<FileIdentity> {
    windows_files::identity_at(path)
}

#[cfg(not(any(unix, windows)))]
fn identity_of(_file: &File) -> std::io::Result<FileIdentity> {
    Ok((0, 0))
}

#[cfg(not(any(unix, windows)))]
fn identity_at(_path: &Path) -> std::io::Result<FileIdentity> {
    Ok((0, 0))
}

/// Opens the file to check it. On Windows other programs may read it and rename over it while the save holds it,
/// but not open it for writing: a write while the save stages fails in that program instead of being lost here.
/// The rename over it, the save's own included, still works, and is caught by `still_there` when it is another's.
fn open_to_check(target: &Path) -> std::io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x1;
        const FILE_SHARE_DELETE: u32 = 0x4;
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
            .open(target)
    }
    #[cfg(not(windows))]
    File::open(target)
}

/// `Ok(None)` when the file went away before it could be opened (nothing to overwrite); `Changed` when its length
/// or its SHA-256, read through the open handle, is not what was expected.
fn check_unchanged(
    shown: &Path,
    target: &Path,
    expected: &Expected,
) -> Result<Option<Checked>, WriteError> {
    use std::io::Read;
    let cannot = |e: std::io::Error| {
        WriteError::io(format!(
            "{}: cannot be read to check that it has not changed: {e}",
            shown.display()
        ))
    };
    let mut file = match retry_locked(|| open_to_check(target)) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(cannot(e)),
    };
    let meta = file.metadata().map_err(cannot)?;
    if meta.len() != expected.len {
        return Err(WriteError::changed(shown));
    }
    let mut hasher = sha256::Hasher::new();
    let mut chunk = vec![0u8; 1 << 20];
    let mut read = 0u64;
    loop {
        let n = file.read(&mut chunk).map_err(cannot)?;
        if n == 0 {
            break;
        }
        read += n as u64;
        hasher.update(&chunk[..n]);
    }
    if read != expected.len || hasher.finish() != expected.sha256 {
        return Err(WriteError::changed(shown));
    }
    let identity = identity_of(&file).map_err(cannot)?;
    Ok(Some(Checked {
        file,
        len: meta.len(),
        modified: meta.modified().ok(),
        identity,
    }))
}

/// SHA-256 (FIPS 180-4) in plain `std`, so this module still compiles alone for `pnpm gate:fidelity`.
mod sha256 {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    const START: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    pub struct Hasher {
        state: [u32; 8],
        block: [u8; 64],
        filled: usize,
        total: u64,
        /// The CPU's SHA instructions are there: about five times the portable rounds, which is what a save of a large
        /// file waits on. Read only on x86_64; elsewhere it is always false.
        #[cfg_attr(not(target_arch = "x86_64"), allow(dead_code))]
        fast: bool,
    }

    fn fast_available() -> bool {
        #[cfg(target_arch = "x86_64")]
        return std::arch::is_x86_feature_detected!("sha")
            && std::arch::is_x86_feature_detected!("sse4.1")
            && std::arch::is_x86_feature_detected!("ssse3");
        #[cfg(not(target_arch = "x86_64"))]
        false
    }

    impl Hasher {
        pub fn new() -> Self {
            Self {
                state: START,
                block: [0; 64],
                filled: 0,
                total: 0,
                fast: fast_available(),
            }
        }

        /// The portable rounds whatever the CPU, for the tests to hold the fast path to.
        #[cfg(test)]
        pub fn portable_only() -> Self {
            Self {
                fast: false,
                ..Self::new()
            }
        }

        #[cfg(test)]
        pub fn is_fast(&self) -> bool {
            self.fast
        }

        pub fn update(&mut self, mut bytes: &[u8]) {
            self.total = self.total.wrapping_add(bytes.len() as u64);
            if self.filled > 0 {
                let take = (64 - self.filled).min(bytes.len());
                self.block[self.filled..self.filled + take].copy_from_slice(&bytes[..take]);
                self.filled += take;
                bytes = &bytes[take..];
                if self.filled < 64 {
                    return;
                }
                let block = self.block;
                self.blocks(&[block]);
                self.filled = 0;
            }
            let (blocks, rest) = bytes.as_chunks::<64>();
            self.blocks(blocks);
            self.block[..rest.len()].copy_from_slice(rest);
            self.filled = rest.len();
        }

        pub fn finish(mut self) -> [u8; 32] {
            let bits = self.total.wrapping_mul(8);
            let pad = if self.filled < 56 {
                56 - self.filled
            } else {
                120 - self.filled
            };
            let mut tail = [0u8; 128];
            tail[0] = 0x80;
            tail[pad..pad + 8].copy_from_slice(&bits.to_be_bytes());
            self.update(&tail[..pad + 8]);
            let mut out = [0u8; 32];
            for (i, word) in self.state.iter().enumerate() {
                out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
            }
            out
        }

        fn blocks(&mut self, blocks: &[[u8; 64]]) {
            #[cfg(target_arch = "x86_64")]
            if self.fast {
                // SAFETY: `fast` is set only when the features `blocks_x86` is compiled for were detected on this CPU.
                unsafe { blocks_x86(&mut self.state, blocks) };
                return;
            }
            for block in blocks {
                self.compress(block);
            }
        }

        fn compress(&mut self, block: &[u8; 64]) {
            let mut w = [0u32; 64];
            for (i, word) in block.as_chunks::<4>().0.iter().enumerate() {
                w[i] = u32::from_be_bytes(*word);
            }
            for i in 16..64 {
                let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
                let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16]
                    .wrapping_add(s0)
                    .wrapping_add(w[i - 7])
                    .wrapping_add(s1);
            }
            let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
            for i in 0..64 {
                let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
                let ch = (e & f) ^ (!e & g);
                let t1 = h
                    .wrapping_add(s1)
                    .wrapping_add(ch)
                    .wrapping_add(K[i])
                    .wrapping_add(w[i]);
                let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
                let maj = (a & b) ^ (a & c) ^ (b & c);
                let t2 = s0.wrapping_add(maj);
                h = g;
                g = f;
                f = e;
                e = d.wrapping_add(t1);
                d = c;
                c = b;
                b = a;
                a = t1.wrapping_add(t2);
            }
            for (s, v) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
                *s = s.wrapping_add(v);
            }
        }
    }

    /// The rounds of every block on `state`, with the x86 SHA extensions.
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "sha,sse2,ssse3,sse4.1")]
    unsafe fn blocks_x86(state: &mut [u32; 8], blocks: &[[u8; 64]]) {
        use std::arch::x86_64::*;
        // Big-endian words: each 4-byte group of a 16-byte lane reversed.
        let order = _mm_set_epi64x(0x0c0d0e0f08090a0b, 0x0405060700010203);
        // The instructions keep the state as ABEF and CDGH.
        let abcd = _mm_loadu_si128(state.as_ptr().cast());
        let efgh = _mm_loadu_si128(state.as_ptr().add(4).cast());
        let cdab = _mm_shuffle_epi32(abcd, 0xB1);
        let hgfe = _mm_shuffle_epi32(efgh, 0x1B);
        let mut abef = _mm_alignr_epi8(cdab, hgfe, 8);
        let mut cdgh = _mm_blend_epi16(hgfe, cdab, 0xF0);
        for block in blocks {
            let (abef_in, cdgh_in) = (abef, cdgh);
            let lanes = block.as_ptr().cast::<__m128i>();
            let mut w = [_mm_setzero_si128(); 16];
            for (g, lane) in w.iter_mut().take(4).enumerate() {
                *lane = _mm_shuffle_epi8(_mm_loadu_si128(lanes.add(g)), order);
            }
            for g in 4..16 {
                let t = _mm_add_epi32(
                    _mm_sha256msg1_epu32(w[g - 4], w[g - 3]),
                    _mm_alignr_epi8(w[g - 1], w[g - 2], 4),
                );
                w[g] = _mm_sha256msg2_epu32(t, w[g - 1]);
            }
            for (g, lane) in w.iter().enumerate() {
                let msg = _mm_add_epi32(*lane, _mm_loadu_si128(K.as_ptr().add(g * 4).cast()));
                cdgh = _mm_sha256rnds2_epu32(cdgh, abef, msg);
                abef = _mm_sha256rnds2_epu32(abef, cdgh, _mm_shuffle_epi32(msg, 0x0E));
            }
            abef = _mm_add_epi32(abef, abef_in);
            cdgh = _mm_add_epi32(cdgh, cdgh_in);
        }
        let feba = _mm_shuffle_epi32(abef, 0x1B);
        let dchg = _mm_shuffle_epi32(cdgh, 0xB1);
        _mm_storeu_si128(state.as_mut_ptr().cast(), _mm_blend_epi16(feba, dchg, 0xF0));
        _mm_storeu_si128(
            state.as_mut_ptr().add(4).cast(),
            _mm_alignr_epi8(dchg, feba, 8),
        );
    }

    #[cfg(test)]
    pub fn digest(bytes: &[u8]) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(bytes);
        hasher.finish()
    }
}

/// Writes exactly `bytes` at `path` only if nothing is there, and otherwise writes nothing.
///
/// "Nothing" is exact: a file, a folder, a symlink, a symlink that leads nowhere, and on a case-insensitive
/// volume a name that differs only in case all count as something, and the answer is `WriteErrorKind::Exists`.
/// A link at `path` is never followed (`write_atomic` writes through one on purpose; this never does).
///
/// The bytes are staged and flushed in a hidden temporary file in the destination's own directory, exactly as
/// `write_atomic` does, and the name is then made to appear by an *exclusive* rename: the kernel decides
/// "nothing is at this name" and "this name is now the file" in one step, so a creator racing this write
/// cannot be replaced (there is no look-then-write window). When the volume or kernel does not support the
/// exclusive rename, `link` then `unlink` is used, which is also exclusive; when that is refused too the write
/// fails and writes nothing. A failed write removes its temporary file.
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let dir = parent_directory(path)?;
    // A cheap, early and readable refusal. It is not what makes the write safe: the exclusive commit below is.
    refuse_taken_name(path)?;
    let tmp = temp_path_for(path);
    let created = stage_new(&tmp, bytes).and_then(|()| {
        commit_new(&tmp, path, &dir, &exclusive::rename, &|from, to| {
            fs::hard_link(from, to)
        })
    });
    match created {
        Ok(()) => sweep_once(&dir),
        Err(_) => {
            remove_staged(&tmp);
        }
    }
    created
}

/// `Err(Exists)` when anything at all is at `path`, a link that leads nowhere and a folder included.
fn refuse_taken_name(path: &Path) -> Result<(), WriteError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            let what = if meta.file_type().is_symlink() {
                "symbolic link"
            } else if meta.is_dir() {
                "folder"
            } else {
                "file"
            };
            Err(taken(path, what))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(WriteError::io(format!(
            "{}: cannot be inspected: {e}",
            path.display()
        ))),
    }
}

fn taken(path: &Path, what: &str) -> WriteError {
    WriteError::exists(format!(
        "{}: there is already a {what} with this name; marxy will not replace it",
        path.display()
    ))
}

/// Puts the new bytes in the temporary file, which nothing else can already hold (`create_new`).
fn stage_new(tmp: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| {
            WriteError::io(format!(
                "{}: cannot stage a new file beside the destination: {e}",
                tmp.display()
            ))
        })?;
    file.write_all(bytes)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    file.sync_all()
        .map_err(|e| WriteError::io(format!("{}: cannot be flushed to disk: {e}", tmp.display())))
}

/// The errnos that mean "this kernel or volume does not do that": ENOTSUP / EOPNOTSUPP, ENOSYS and EINVAL (a filesystem that
/// lacks the exclusive-rename flag). Rust maps only some of them to `ErrorKind::Unsupported` (macOS ENOTSUP, 45, is
/// `Uncategorized`), so the raw number decides, as well as the kind.
#[cfg(target_os = "macos")]
const NOT_SUPPORTED_ERRNOS: [i32; 3] = [45, 78, 22];
#[cfg(not(target_os = "macos"))]
const NOT_SUPPORTED_ERRNOS: [i32; 3] = [95, 38, 22];

fn is_not_supported(e: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    matches!(e.kind(), ErrorKind::Unsupported | ErrorKind::InvalidInput)
        || e.raw_os_error()
            .is_some_and(|n| NOT_SUPPORTED_ERRNOS.contains(&n))
}

/// The refusal when neither exclusive way of publishing a file is available.
const VOLUME_CANNOT: &str = "this volume cannot create a file without risk of replacing one";

/// Publishes the staged file at `target` only if nothing is there. `exclusive` is the kernel's exclusive
/// rename and `link` is the fallback; both are parameters so a test can make either one refuse.
fn commit_new(
    tmp: &Path,
    target: &Path,
    dir: &Path,
    exclusive: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
    link: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), WriteError> {
    use std::io::ErrorKind;
    match exclusive(tmp, target) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            return Err(taken(target, "file or folder"))
        }
        // Not supported here (ENOTSUP / EOPNOTSUPP, ENOSYS, or EINVAL for a flag the filesystem lacks): the exclusive
        // rename is not available, so the other exclusive way is used.
        Err(e) if is_not_supported(&e) => {
            match link(tmp, target) {
                Ok(()) => {
                    // The file now has two names; the staging one is dropped so it has one. If that drop fails
                    // the file is still complete and in place, so it is not an error of the write.
                    remove_staged(tmp);
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    return Err(taken(target, "file or folder"))
                }
                Err(e) if is_not_supported(&e) || e.kind() == ErrorKind::PermissionDenied => {
                    return Err(WriteError::io(format!(
                        "{}: {VOLUME_CANNOT} ({e})",
                        target.display()
                    )))
                }
                Err(e) => {
                    return Err(WriteError::io(format!(
                        "{}: cannot be created: {e}",
                        target.display()
                    )))
                }
            }
        }
        Err(e) => {
            return Err(WriteError::io(format!(
                "{}: cannot be created: {e}",
                target.display()
            )))
        }
    }
    sync_directory(dir);
    Ok(())
}

/// The kernel's exclusive rename: `rename`, but failing `AlreadyExists` instead of replacing whatever is at
/// the destination (a file, a folder or a link, which it does not follow). Declared inline so the fidelity
/// gate can compile this module with a bare `rustc`.
#[cfg(unix)]
mod exclusive {
    use std::io;
    use std::path::Path;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use std::ffi::{c_char, c_int, c_uint, CString};
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use std::os::unix::ffi::OsStrExt;

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
    }
    /// `RENAME_EXCL` in `<stdio.h>`.
    #[cfg(target_os = "macos")]
    const RENAME_EXCL: c_uint = 0x0000_0004;

    #[cfg(target_os = "linux")]
    unsafe extern "C" {
        fn renameat2(
            olddirfd: c_int,
            oldpath: *const c_char,
            newdirfd: c_int,
            newpath: *const c_char,
            flags: c_uint,
        ) -> c_int;
    }
    #[cfg(target_os = "linux")]
    const AT_FDCWD: c_int = -100;
    /// `RENAME_NOREPLACE` in `<linux/fs.h>`.
    #[cfg(target_os = "linux")]
    const RENAME_NOREPLACE: c_uint = 1;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
        let from = CString::new(from.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        let to = CString::new(to.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        // SAFETY: both are valid, NUL-terminated C strings that outlive the call.
        #[cfg(target_os = "macos")]
        let rc = unsafe { renamex_np(from.as_ptr(), to.as_ptr(), RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let rc = unsafe {
            renameat2(
                AT_FDCWD,
                from.as_ptr(),
                AT_FDCWD,
                to.as_ptr(),
                RENAME_NOREPLACE,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// Other Unixes have no exclusive rename declared here: `Unsupported` sends the caller to `link`.
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    pub fn rename(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`, which fails `ERROR_ALREADY_EXISTS` at any occupant. It needs no
/// hard links, so FAT, exFAT and SMB volumes take it, and the file never has two names.
#[cfg(windows)]
mod exclusive {
    use std::io;
    use std::path::Path;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
        let from = super::windows_files::wide_path(from)?;
        let to = super::windows_files::wide_path(to)?;
        // SAFETY: both are NUL-terminated UTF-16 strings that outlive the call; no flag, so nothing is replaced or copied.
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

/// Without an exclusive rename, `link` (which never replaces) is the only way.
#[cfg(not(any(unix, windows)))]
mod exclusive {
    use std::io;
    use std::path::Path;

    pub fn rename(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

/// Where the new bytes are staged: the destination's own directory, so the rename stays inside one
/// filesystem and is therefore atomic. A temporary file under `/tmp` would degrade to a copy across
/// devices, which is exactly the truncated-file window this avoids. Hidden, and unique per attempt
/// so that two saves of one document cannot meet in the same temporary file.
pub fn temp_path_for(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    let attempt = ATTEMPTS.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let suffix = format!(".marxy-tmp-{}-{attempt}-{nanos}", std::process::id());
    // A file name is at most 255 bytes on the filesystems we save to. A long document name would
    // push the staging name over that and fail the save, so the name portion is cut to fit.
    let room = 255usize.saturating_sub(1 + suffix.len());
    let name = truncate_on_char_boundary(name, room);
    dir.join(format!(".{name}{suffix}"))
}

fn truncate_on_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Folders already swept this run. Leftovers come from an earlier run, so one look per folder finds them all.
static SWEPT: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// After the first successful save into `dir` this run, removes the staging files an earlier Marxy left there when
/// it was stopped between staging and rename. Only a name `temp_path_for` writes counts, only when its process is
/// gone, and only a plain file judged by its own handle is removed. Every failure leaves the entry as it is.
fn sweep_once(dir: &Path) {
    {
        let Ok(mut swept) = SWEPT.lock() else {
            return;
        };
        if swept.iter().any(|d| d == dir) {
            return;
        }
        swept.push(dir.to_path_buf());
    }
    sweep(dir);
}

fn sweep(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let me = std::process::id();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(staging_pid) else {
            continue;
        };
        // This process's own names are saves in flight. A pid another process now has is kept too: reuse cannot
        // be told from a Marxy still saving, so the leftover stays.
        if pid == me || process_running(pid) {
            continue;
        }
        let _ = leftover::remove(dir, &name);
    }
}

/// Where the Unix sweep moves a leftover before removing it. It carries no staging mark: were a file another program
/// swapped in left here, a staging name with this run's pid would have a later run delete it as a dead leftover.
#[cfg_attr(not(unix), allow(dead_code))]
fn swept_path_in(dir: &Path) -> PathBuf {
    let attempt = ATTEMPTS.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    dir.join(format!(
        ".marxy-swept-{}-{attempt}-{nanos}",
        std::process::id()
    ))
}

/// The pid in a name `temp_path_for` writes, `.<name>.marxy-tmp-<pid>-<attempt>-<nanos>`, each field decimal as
/// `format!` spells it. Anything else, however close, is not Marxy's.
fn staging_pid(name: &str) -> Option<u32> {
    const MARK: &str = ".marxy-tmp-";
    let rest = name.strip_prefix('.')?;
    // The last mark: a document's own name may hold one.
    let at = rest.rfind(MARK)?;
    if at == 0 {
        return None;
    }
    let mut fields = rest[at + MARK.len()..].split('-');
    let (pid, attempt, nanos) = (fields.next()?, fields.next()?, fields.next()?);
    if fields.next().is_some() {
        return None;
    }
    let decimal = |s: &str| {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'))
    };
    if !(decimal(pid) && decimal(attempt) && decimal(nanos)) {
        return None;
    }
    attempt.parse::<u64>().ok()?;
    if nanos.parse::<u32>().ok()? >= 1_000_000_000 {
        return None;
    }
    // No process has pid 0, and Windows would answer for it as a process that is gone.
    pid.parse::<u32>().ok().filter(|&pid| pid != 0)
}

/// Whether a process with `pid` is running. Anything but a clear "no such process" is taken as running.
#[cfg(windows)]
fn process_running(pid: u32) -> bool {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn GetExitCodeProcess(process: *mut c_void, code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const ERROR_INVALID_PARAMETER: i32 = 87;
    const STILL_ACTIVE: u32 = 259;
    // SAFETY: plain calls on a pid; the handle, when there is one, is closed below.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        // Access denied and the like mean a process is there.
        return std::io::Error::last_os_error().raw_os_error() != Some(ERROR_INVALID_PARAMETER);
    }
    let mut code = 0u32;
    // SAFETY: `process` is a live handle and `code` a u32 the call fills.
    let asked = unsafe { GetExitCodeProcess(process, &mut code) };
    unsafe { CloseHandle(process) };
    // A process that exited but is still held open by someone reports its exit code.
    asked == 0 || code == STILL_ACTIVE
}

#[cfg(unix)]
fn process_running(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    const ESRCH: i32 = 3;
    let Ok(pid) = i32::try_from(pid) else {
        return true;
    };
    // SAFETY: signal 0 delivers nothing; it only asks whether the pid exists.
    if unsafe { kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(ESRCH)
}

#[cfg(not(any(unix, windows)))]
fn process_running(_pid: u32) -> bool {
    true
}

/// Removing one leftover, judged by an open handle rather than by its name.
mod leftover {
    use std::ffi::OsStr;
    use std::io;
    use std::path::Path;

    /// Opened as itself (a link or junction is not followed, a folder opens as a folder) and with no sharing, the
    /// entry is judged by the handle and removed through it, so a swap at the name meanwhile removes nothing else.
    #[cfg(windows)]
    pub fn remove(dir: &Path, name: &OsStr) -> io::Result<()> {
        use super::windows_files::{delete_on_close, is_plain_file};
        use std::os::windows::fs::OpenOptionsExt;
        const DELETE: u32 = 0x0001_0000;
        const FILE_READ_ATTRIBUTES: u32 = 0x80;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let file = std::fs::OpenOptions::new()
            .access_mode(DELETE | FILE_READ_ATTRIBUTES)
            .share_mode(0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(dir.join(name))?;
        if !is_plain_file(&file)? {
            return Ok(());
        }
        delete_on_close(&file)
    }

    #[cfg(target_os = "linux")]
    const O_NONBLOCK: i32 = 0o4000;
    #[cfg(target_os = "macos")]
    const O_NONBLOCK: i32 = 0x4;

    /// Unix removes by name only. The entry must be a plain file with one name by its name and, the same file, by an
    /// open handle; it is then moved by an exclusive rename to a fresh name a sweep never takes for a leftover and
    /// removed only if that name still leads to the file judged.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub fn remove(dir: &Path, name: &OsStr) -> io::Result<()> {
        use std::fs;
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
        let at = dir.join(name);
        let named = fs::symlink_metadata(&at)?;
        if !named.file_type().is_file() || named.nlink() != 1 {
            return Ok(());
        }
        // Non-blocking, so a pipe swapped in before the open cannot hold the save.
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(O_NONBLOCK)
            .open(&at)?;
        let held = file.metadata()?;
        let same = |m: &fs::Metadata| m.dev() == held.dev() && m.ino() == held.ino();
        if !held.is_file() || !same(&named) {
            return Ok(());
        }
        let aside = super::swept_path_in(dir);
        super::exclusive::rename(&at, &aside)?;
        let moved = fs::symlink_metadata(&aside)?;
        if moved.file_type().is_file() && same(&moved) {
            return fs::remove_file(&aside);
        }
        // Something else was swapped in: it goes back where it was. Should that fail, it keeps a name no sweep
        // matches, so no later run deletes it.
        super::exclusive::rename(&aside, &at)
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    pub fn remove(_dir: &Path, _name: &OsStr) -> io::Result<()> {
        Ok(())
    }
}

/// A symlinked document is saved *through* the link: the bytes of the file it points at are replaced,
/// so the link survives instead of being quietly turned into a regular file.
fn resolve_symlink(path: &Path) -> Result<PathBuf, WriteError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path).map_err(|e| {
            WriteError::io(format!(
                "{}: is a symlink that does not resolve: {e}",
                path.display()
            ))
        }),
        _ => Ok(path.to_path_buf()),
    }
}

/// A save by another spelling of an existing file's name (`readme.md` for `README.md`, or its 8.3 alias `AVERYL~1.MD`)
/// keeps the name the disk has: the rename would otherwise give the file the spelling it was asked with.
fn keep_disk_case(target: PathBuf) -> PathBuf {
    #[cfg(windows)]
    if let Some(name) = windows_files::on_disk_name(&target) {
        return target.with_file_name(name);
    }
    target
}

fn parent_directory(target: &Path) -> Result<PathBuf, WriteError> {
    match target.parent().filter(|d| !d.as_os_str().is_empty()) {
        Some(dir) => Ok(dir.to_path_buf()),
        None => Err(WriteError::io(format!(
            "{}: has no directory to stage a save in",
            target.display()
        ))),
    }
}

/// `Ok(None)` when the destination does not exist yet; `Err` when saving would change more than the
/// bytes. Refusals are deliberate: a documented "no" is better than a surprise in someone's history.
fn refuse_surprising_destination(target: &Path) -> Result<Option<Metadata>, WriteError> {
    let meta = match fs::metadata(target) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(WriteError::io(format!(
                "{}: cannot be inspected: {e}",
                target.display()
            )))
        }
    };
    if !meta.is_file() {
        return Err(WriteError::permission(format!(
            "{}: is not a regular file; marxy saves documents only",
            target.display()
        )));
    }
    if meta.permissions().readonly() {
        return Err(WriteError::permission(format!(
            "{}: is read-only; marxy will not overwrite it, because clearing that would change more \
             than the bytes",
            target.display()
        )));
    }
    #[cfg(target_os = "macos")]
    if locked_in_finder(&meta) {
        return Err(WriteError::permission(format!(
            "{}: is locked in Finder; unlock it (Get Info, untick Locked) to save",
            target.display()
        )));
    }
    #[cfg(unix)]
    let links = meta.nlink();
    #[cfg(windows)]
    let links = u64::from(windows_files::link_count(target).unwrap_or(1));
    #[cfg(any(unix, windows))]
    if links > 1 {
        return Err(WriteError::permission(format!(
            "{}: has {links} hard links, and a rename would leave the other names on the old bytes",
            target.display()
        )));
    }
    Ok(Some(meta))
}

/// Windows file facts `std` keeps unstable or does not expose, declared inline like the Linux xattr calls so the
/// module still compiles alone.
#[cfg(windows)]
pub(crate) mod windows_files {
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;

    /// BY_HANDLE_FILE_INFORMATION (fileapi.h), its three FILETIMEs as pairs of words.
    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: [u32; 2],
        last_access_time: [u32; 2],
        last_write_time: [u32; 2],
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(file: *mut c_void, info: *mut ByHandleFileInformation)
            -> i32;
    }

    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;

    /// How many names the file has. Opened for its attributes only, which a lock on the data does not refuse.
    pub fn link_count(path: &Path) -> io::Result<u32> {
        let file = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .open(path)?;
        links_of(&file)
    }

    /// How many names the file `file` is open on has.
    pub fn links_of(file: &std::fs::File) -> io::Result<u32> {
        // SAFETY: a plain struct of integers, filled by the call.
        let mut info: ByHandleFileInformation = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(info.number_of_links)
    }

    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    /// Whether `file`, opened without following a reparse point, is a plain file with one name: not a folder, a link
    /// or a junction, and not a hard link whose other name would keep its bytes.
    pub fn is_plain_file(file: &std::fs::File) -> io::Result<bool> {
        // SAFETY: a plain struct of integers, filled by the call.
        let mut info: ByHandleFileInformation = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let not_plain = FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT;
        Ok(info.file_attributes & not_plain == 0 && info.number_of_links == 1)
    }

    /// Marks the file `file` is open on (opened with `DELETE` access) to be removed when the handle closes: the file
    /// judged by the handle is the one removed, whatever its name leads to by then.
    pub fn delete_on_close(file: &std::fs::File) -> io::Result<()> {
        const FILE_DISPOSITION_INFO_CLASS: i32 = 4;
        let delete: u8 = 1;
        // SAFETY: FILE_DISPOSITION_INFO is one BOOLEAN, passed with its size.
        let ok = unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle(),
                FILE_DISPOSITION_INFO_CLASS,
                (&delete as *const u8).cast(),
                1,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// The volume serial and file index of the file `file` is open on.
    pub fn identity(file: &std::fs::File) -> io::Result<(u64, u64)> {
        // SAFETY: a plain struct of integers, filled by the call.
        let mut info: ByHandleFileInformation = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let index = (u64::from(info.file_index_high) << 32) | u64::from(info.file_index_low);
        Ok((u64::from(info.volume_serial_number), index))
    }

    /// `identity` of the file `path` names, opened for its attributes only, which no share mode or lock refuses.
    pub fn identity_at(path: &Path) -> io::Result<(u64, u64)> {
        identity(
            &OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .open(path)?,
        )
    }

    /// The file's name as the disk spells it, when `path` names it otherwise (another case, or its short name).
    pub fn on_disk_name(path: &Path) -> Option<std::ffi::OsString> {
        let given = path.file_name()?;
        let real = std::fs::canonicalize(path).ok()?;
        let real = real.file_name()?;
        (real != given).then(|| real.to_os_string())
    }

    /// `path` as a NUL-terminated wide string a `...W` call takes: absolute, and verbatim (`\\?\`) so a long path is not
    /// cut at 260 characters. `absolute` has already folded `/`, `.` and `..`, which a verbatim path would not.
    pub fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
        use std::os::windows::ffi::OsStrExt;
        let full = std::path::absolute(path)?;
        let text = full.as_os_str().encode_wide().collect::<Vec<u16>>();
        let s = String::from_utf16_lossy(&text);
        let mut out: Vec<u16> = if s.starts_with(r"\\?\") || s.starts_with(r"\\.\") {
            text
        } else if s.starts_with(r"\\") {
            r"\\?\UNC\"
                .encode_utf16()
                .chain(text[2..].iter().copied())
                .collect()
        } else {
            r"\\?\".encode_utf16().chain(text).collect()
        };
        if out.contains(&0) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "NUL in path"));
        }
        out.push(0);
        Ok(out)
    }

    /// FILE_BASIC_INFO (winbase.h): a zero time is left as it is.
    #[repr(C)]
    #[derive(Default)]
    struct BasicInfo {
        creation_time: i64,
        last_access_time: i64,
        last_write_time: i64,
        change_time: i64,
        file_attributes: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandleEx(
            file: *mut c_void,
            class: i32,
            info: *mut c_void,
            size: u32,
        ) -> i32;
        fn SetFileInformationByHandle(
            file: *mut c_void,
            class: i32,
            info: *const c_void,
            size: u32,
        ) -> i32;
        fn GetVolumeInformationByHandleW(
            file: *mut c_void,
            name: *mut u16,
            name_len: u32,
            serial: *mut u32,
            max_component: *mut u32,
            flags: *mut u32,
            fs_name: *mut u16,
            fs_name_len: u32,
        ) -> i32;
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn GetSecurityInfo(
            handle: *mut c_void,
            object: u32,
            info: u32,
            owner: *mut *mut c_void,
            group: *mut *mut c_void,
            dacl: *mut *mut c_void,
            sacl: *mut *mut c_void,
            descriptor: *mut *mut c_void,
        ) -> u32;
        fn SetSecurityInfo(
            handle: *mut c_void,
            object: u32,
            info: u32,
            owner: *mut c_void,
            group: *mut c_void,
            dacl: *mut c_void,
            sacl: *mut c_void,
        ) -> u32;
        fn GetSecurityDescriptorControl(
            descriptor: *mut c_void,
            control: *mut u16,
            revision: *mut u32,
        ) -> i32;
    }

    const FILE_BASIC_INFO_CLASS: i32 = 0;
    const READ_CONTROL: u32 = 0x0002_0000;
    pub const WRITE_DAC: u32 = 0x0004_0000;
    pub const GENERIC_WRITE: u32 = 0x4000_0000;
    const SE_FILE_OBJECT: u32 = 1;
    const DACL_SECURITY_INFORMATION: u32 = 0x4;
    const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x8000_0000;
    const UNPROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x2000_0000;
    const SE_DACL_PROTECTED: u16 = 0x1000;
    const FILE_PERSISTENT_ACLS: u32 = 0x8;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    /// What a save carries from the old file: hidden, system, not content indexed. Archive is the new file's own, set
    /// as a write in place would set it; read-only never gets this far.
    const CARRIED: u32 = 0x2 | 0x4 | 0x2000;

    fn basic_info(file: &std::fs::File) -> io::Result<BasicInfo> {
        let mut info = BasicInfo::default();
        // SAFETY: `info` is a FILE_BASIC_INFO of the size passed, filled by the call.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FILE_BASIC_INFO_CLASS,
                (&mut info as *mut BasicInfo).cast(),
                std::mem::size_of::<BasicInfo>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(info)
    }

    fn keeps_acls(file: &std::fs::File) -> bool {
        let mut flags = 0u32;
        // SAFETY: only the flags are asked for; every buffer is null with a zero length.
        let ok = unsafe {
            GetVolumeInformationByHandleW(
                file.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut flags,
                std::ptr::null_mut(),
                0,
            )
        };
        ok != 0 && flags & FILE_PERSISTENT_ACLS != 0
    }

    /// Puts `target`'s access list, creation time and hidden, system and indexing attributes on `staged`, the open
    /// staging file (opened with `WRITE_DAC`). The rename that follows would otherwise give the document the folder's
    /// inherited access and a new creation time. The owner stays the saver's, as a new file's does.
    pub fn carry_over(target: &Path, staged: &std::fs::File) -> io::Result<()> {
        let old = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES | READ_CONTROL)
            .open(target)?;
        let was = basic_info(&old)?;
        let now = basic_info(staged)?;
        let mut attributes = (now.file_attributes & !CARRIED) | (was.file_attributes & CARRIED);
        if attributes == 0 {
            attributes = FILE_ATTRIBUTE_NORMAL;
        }
        let info = BasicInfo {
            creation_time: was.creation_time,
            file_attributes: attributes,
            ..BasicInfo::default()
        };
        // SAFETY: a FILE_BASIC_INFO of the size passed; the zero times are left unchanged.
        let ok = unsafe {
            SetFileInformationByHandle(
                staged.as_raw_handle(),
                FILE_BASIC_INFO_CLASS,
                (&info as *const BasicInfo).cast(),
                std::mem::size_of::<BasicInfo>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if keeps_acls(&old) {
            copy_dacl(&old, staged)?;
        }
        Ok(())
    }

    fn copy_dacl(from: &std::fs::File, to: &std::fs::File) -> io::Result<()> {
        let mut dacl: *mut c_void = std::ptr::null_mut();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: the out pointers are valid; `descriptor` owns what `dacl` points into and is freed below.
        let code = unsafe {
            GetSecurityInfo(
                from.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if code != 0 {
            return Err(io::Error::from_raw_os_error(code as i32));
        }
        let mut control = 0u16;
        let mut revision = 0u32;
        // SAFETY: `descriptor` is the one GetSecurityInfo returned, alive until LocalFree.
        let read = unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) };
        let code = if read == 0 {
            io::Error::last_os_error().raw_os_error().unwrap_or(1) as u32
        } else {
            // Unprotected, the inherited entries are taken from the folder again, as they were for the old file.
            let protection = if control & SE_DACL_PROTECTED != 0 {
                PROTECTED_DACL_SECURITY_INFORMATION
            } else {
                UNPROTECTED_DACL_SECURITY_INFORMATION
            };
            // SAFETY: `dacl` points into `descriptor` (or is null for a null DACL, which SetSecurityInfo takes as such).
            unsafe {
                SetSecurityInfo(
                    to.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | protection,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    dacl,
                    std::ptr::null_mut(),
                )
            }
        };
        // SAFETY: allocated by GetSecurityInfo for the caller to free.
        unsafe { LocalFree(descriptor) };
        if code != 0 {
            return Err(io::Error::from_raw_os_error(code as i32));
        }
        Ok(())
    }

    /// Another program holds the file for a moment (antivirus, the indexer, a sync client).
    pub fn is_lock(e: &io::Error) -> bool {
        matches!(
            e.raw_os_error(),
            Some(ERROR_ACCESS_DENIED | ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)
        )
    }
}

/// How long a save waits for a short lock on Windows before failing.
#[cfg(windows)]
const LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(1000);

/// Runs `op`, trying again for about a second while another program holds the file (Windows); once, elsewhere.
fn retry_locked<T>(mut op: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    #[cfg(windows)]
    {
        let deadline = std::time::Instant::now() + LOCK_RETRY;
        loop {
            match op() {
                Err(e) if windows_files::is_lock(&e) && std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                other => return other,
            }
        }
    }
    #[cfg(not(windows))]
    op()
}

/// Puts the new bytes in the temporary file, with the destination's metadata already on it.
fn stage(
    tmp: &Path,
    target: &Path,
    destination: Option<&Metadata>,
    bytes: &[u8],
) -> Result<(), WriteError> {
    // `create_new` so a temporary path planted by someone else is an error rather than a file we
    // follow, and so two concurrent saves cannot share a staging file.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| {
            WriteError::io(format!(
                "{}: cannot stage a save beside the destination: {e}",
                tmp.display()
            ))
        })?;
    if destination.is_some() {
        // Cloning the destination onto the staging file carries its mode everywhere and, on macOS,
        // its ACL and extended attributes too (`fs::copy` is `fcopyfile` with `COPYFILE_ALL` there).
        // On Linux `fs::copy` is a data+mode copy, so extended attributes and POSIX ACLs are
        // written afterwards from the same syscalls the kernel uses. Copying the old contents first
        // is wasted I/O for a document-sized file and the only way to get that metadata from `std`
        // on macOS without a crate.
        retry_locked(|| fs::copy(target, tmp)).map_err(|e| {
            WriteError::io(format!(
                "{}: cannot carry the file's metadata onto the save: {e}",
                target.display()
            ))
        })?;
        #[cfg(target_os = "linux")]
        linux_xattr::copy_from(target, tmp).map_err(WriteError::io)?;
        refuse_ownership_change(target, tmp)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.access_mode(windows_files::GENERIC_WRITE | windows_files::WRITE_DAC);
    }
    let mut file = options
        .open(tmp)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    file.write_all(bytes)
        .map_err(|e| WriteError::io(format!("{}: cannot be written: {e}", tmp.display())))?;
    // After the bytes, on the handle already open for writing: an access list that does not grant the saver write
    // access still lands, as it would have on the old file.
    #[cfg(windows)]
    if destination.is_some() {
        windows_files::carry_over(target, &file).map_err(|e| {
            WriteError::io(format!(
                "{}: cannot carry the file's access list and dates onto the save: {e}",
                target.display()
            ))
        })?;
    }
    // Durability before visibility: the bytes reach the disk before any name points at them, so the
    // rename can only publish a complete file.
    file.sync_all()
        .map_err(|e| WriteError::io(format!("{}: cannot be flushed to disk: {e}", tmp.display())))
}

/// Publishes the staged file. After this the destination is the new bytes; before it, the old ones.
fn commit(tmp: &Path, target: &Path, dir: &Path) -> Result<(), WriteError> {
    retry_locked(|| fs::rename(tmp, target)).map_err(|e| {
        WriteError::io(format!(
            "{}: cannot be replaced with the saved file: {e}",
            target.display()
        ))
    })?;
    sync_directory(dir);
    Ok(())
}

/// Flushes the directory entry so the rename itself survives a power loss. Best effort: a filesystem
/// that refuses to open a directory has already published the rename by other means.
fn sync_directory(dir: &Path) {
    #[cfg(unix)]
    let _ = File::open(dir).and_then(|handle| handle.sync_all());
    #[cfg(not(unix))]
    let _ = dir;
}

/// True when the staged file would belong to a different user than the destination. A group
/// mismatch is not a refusal: `refuse_ownership_change` restores the group so a save into a
/// directory whose group is not the user's own still succeeds. Only the Unix save asks; its test runs everywhere.
#[cfg_attr(not(unix), allow(dead_code))]
fn ownership_refuses(destination_uid: u32, staged_uid: u32) -> bool {
    destination_uid != staged_uid
}

/// Refuses a save that would hand the file to a different user. A group mismatch is restored
/// when the process can set that group (a user may chown a file they own to a group they belong
/// to); only if that restore fails, or the owning user would change, does the save refuse.
#[cfg(unix)]
fn refuse_ownership_change(target: &Path, tmp: &Path) -> Result<(), WriteError> {
    let destination =
        fs::metadata(target).map_err(|e| WriteError::io(format!("{}: {e}", target.display())))?;
    let staged =
        fs::metadata(tmp).map_err(|e| WriteError::io(format!("{}: {e}", tmp.display())))?;
    if ownership_refuses(destination.uid(), staged.uid()) {
        return Err(WriteError::permission(format!(
            "{}: is owned by {} and marxy would save it as {}; refusing rather than changing \
             the owner",
            target.display(),
            destination.uid(),
            staged.uid()
        )));
    }
    if destination.gid() != staged.gid() {
        chown(tmp, None, Some(destination.gid())).map_err(|_| {
            WriteError::permission(format!(
                "{}: is owned by {}:{} and marxy would save it as {}:{}; refusing rather than \
                 changing the owner",
                target.display(),
                destination.uid(),
                destination.gid(),
                staged.uid(),
                staged.gid()
            ))
        })?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn refuse_ownership_change(_target: &Path, _tmp: &Path) -> Result<(), WriteError> {
    Ok(())
}

/// Linux `listxattr(2)` / `getxattr(2)` / `setxattr(2)`, declared inline so the fidelity gate can
/// still compile this module with a bare `rustc`. POSIX ACLs are the `system.posix_acl_*`
/// attributes; copying every user and ACL name is what stops a save from silently dropping them.
#[cfg(target_os = "linux")]
mod linux_xattr {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    unsafe extern "C" {
        fn listxattr(path: *const c_char, list: *mut c_char, size: usize) -> isize;
        fn getxattr(
            path: *const c_char,
            name: *const c_char,
            value: *mut c_void,
            size: usize,
        ) -> isize;
        fn setxattr(
            path: *const c_char,
            name: *const c_char,
            value: *const c_void,
            size: usize,
            flags: c_int,
        ) -> c_int;
    }

    /// `ENOTSUP` / `EOPNOTSUPP` on Linux; the errno a filesystem returns when it has no xattrs.
    const ENOTSUP: i32 = 95;
    /// `ENOSYS`: the kernel has no xattr syscalls at all.
    const ENOSYS: i32 = 38;

    fn c_path(path: &Path) -> io::Result<CString> {
        CString::new(path.as_os_str().as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
    }

    fn c_name(name: &str) -> io::Result<CString> {
        CString::new(name).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
    }

    /// True only when the filesystem (or kernel) genuinely cannot store extended attributes.
    pub fn filesystem_lacks_support(err: &io::Error) -> bool {
        matches!(err.raw_os_error(), Some(ENOTSUP) | Some(ENOSYS))
    }

    fn must_preserve(name: &str) -> bool {
        name.starts_with("user.")
            || name == "system.posix_acl_access"
            || name == "system.posix_acl_default"
    }

    pub fn list_names(path: &Path) -> io::Result<Vec<String>> {
        let c = c_path(path)?;
        // SAFETY: `c` is a valid C string; a null buffer with size 0 is the documented size query.
        let mut size = unsafe { listxattr(c.as_ptr(), std::ptr::null_mut(), 0) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        if size == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is `size` writable bytes, which is what the previous query returned.
        size = unsafe { listxattr(c.as_ptr(), buf.as_mut_ptr() as *mut c_char, buf.len()) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        buf.truncate(size as usize);
        Ok(buf
            .split(|&b| b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect())
    }

    pub fn get(path: &Path, name: &str) -> io::Result<Vec<u8>> {
        let c = c_path(path)?;
        let n = c_name(name)?;
        // SAFETY: both pointers are valid C strings; a null buffer with size 0 queries the length.
        let mut size = unsafe { getxattr(c.as_ptr(), n.as_ptr(), std::ptr::null_mut(), 0) };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is `size` writable bytes, matching the query.
        size = unsafe {
            getxattr(
                c.as_ptr(),
                n.as_ptr(),
                buf.as_mut_ptr() as *mut c_void,
                buf.len(),
            )
        };
        if size < 0 {
            return Err(io::Error::last_os_error());
        }
        buf.truncate(size as usize);
        Ok(buf)
    }

    pub fn set(path: &Path, name: &str, value: &[u8]) -> io::Result<()> {
        let c = c_path(path)?;
        let n = c_name(name)?;
        // SAFETY: path and name are valid C strings; `value` is `value.len()` readable bytes.
        let rc = unsafe {
            setxattr(
                c.as_ptr(),
                n.as_ptr(),
                value.as_ptr() as *const c_void,
                value.len(),
                0,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// A POSIX ACL xattr with a named user (`nobody`) so a mode-only copy cannot fake preservation.
    #[cfg(test)]
    pub fn named_user_acl(uid: u32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&2u32.to_le_bytes());
        const UNDEF: u32 = 0xffff_ffff;
        let mut entry = |tag: u16, perm: u16, id: u32| {
            out.extend_from_slice(&tag.to_le_bytes());
            out.extend_from_slice(&perm.to_le_bytes());
            out.extend_from_slice(&id.to_le_bytes());
        };
        entry(0x01, 6, UNDEF); // ACL_USER_OBJ rw
        entry(0x02, 4, uid); // ACL_USER r
        entry(0x04, 4, UNDEF); // ACL_GROUP_OBJ r
        entry(0x10, 4, UNDEF); // ACL_MASK r
        entry(0x20, 4, UNDEF); // ACL_OTHER r
        out
    }

    pub fn copy_from(from: &Path, to: &Path) -> Result<(), String> {
        let names = match list_names(from) {
            Ok(names) => names,
            Err(err) if filesystem_lacks_support(&err) => return Ok(()),
            Err(err) => {
                return Err(format!(
                    "{}: cannot read extended attributes: {err}",
                    from.display()
                ))
            }
        };
        for name in names {
            let value = get(from, &name).map_err(|e| {
                format!(
                    "{}: cannot read extended attribute {name}: {e}",
                    from.display()
                )
            })?;
            if let Err(err) = set(to, &name, &value) {
                if must_preserve(&name) {
                    return Err(format!(
                        "{}: cannot keep extended attribute {name}: {err}",
                        from.display()
                    ));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-atomic-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    fn staged_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("marxy-tmp"))
            .collect()
    }

    /// The shapes that every plausible save path gets wrong: Windows line endings, a byte-order mark,
    /// a missing final newline, a lone carriage return, and bytes that are not text at all.
    #[test]
    fn hostile_payloads_survive_a_round_trip() {
        let dir = scratch("payloads");
        let payloads: [(&str, &[u8]); 6] = [
            ("crlf-and-bom", b"\xef\xbb\xbf# t\r\n\r\nbody\r\n"),
            ("no-trailing-newline", b"one\ntwo"),
            ("lone-cr", b"a\rb\r\nc\n"),
            ("trailing-blank-lines", b"text\n\n\n"),
            ("not-utf8", b"\x00\xff\xfe binary \x80"),
            ("empty", b""),
        ];
        for (name, bytes) in payloads {
            let target = dir.join(name);
            write_atomic(&target, bytes).expect("save");
            assert_eq!(
                fs::read(&target).expect("read back"),
                bytes,
                "{name} changed on save"
            );
        }
    }

    #[test]
    fn a_long_document_name_still_gets_a_staging_name_that_fits() {
        // 250 ASCII bytes, and 3-byte characters so the cut has a boundary to respect.
        for stem in ["a".repeat(247), "é".repeat(122), "日".repeat(82)] {
            let name = format!("{stem}.md");
            assert!(name.len() <= 255, "the document name itself is legal");
            let staged = temp_path_for(Path::new("/some/dir").join(&name).as_path());
            let staged_name = staged.file_name().unwrap().to_string_lossy().into_owned();
            assert!(staged_name.len() <= 255, "{} bytes", staged_name.len());
            assert!(staged_name.starts_with('.') && staged_name.contains(".marxy-tmp-"));
        }
        let dir = scratch("long-name");
        let target = dir.join(format!("{}.md", "a".repeat(247)));
        write_atomic(&target, b"long").expect("save under a near-limit name");
        assert_eq!(fs::read(&target).expect("read back"), b"long");
    }

    #[test]
    fn a_new_file_is_created() {
        let dir = scratch("new");
        let target = dir.join("fresh.md");
        write_atomic(&target, b"hello").expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"hello");
    }

    #[test]
    fn the_staging_file_is_in_the_destinations_own_directory() {
        let target = Path::new("/some/deep/place/notes.md");
        let first = temp_path_for(target);
        let second = temp_path_for(target);
        assert_eq!(
            first.parent(),
            target.parent(),
            "a rename across directories is not atomic"
        );
        assert_ne!(first, second, "two saves must not share a staging file");
        let name = first.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with('.'),
            "the staging file should not appear in a listing: {name}"
        );
    }

    #[test]
    fn a_successful_save_leaves_no_staging_file() {
        let dir = scratch("clean");
        let target = dir.join("doc.md");
        write_atomic(&target, b"one").expect("first save");
        write_atomic(&target, b"two").expect("second save");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    #[cfg(unix)]
    fn a_failed_save_leaves_no_staging_file_and_the_old_bytes_intact() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("failed");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        // Write-only: the destination is writable, so the save begins, and unreadable, so carrying its
        // metadata onto the staging file fails partway through.
        fs::set_permissions(&target, fs::Permissions::from_mode(0o200)).expect("chmod");
        let readable_anyway = File::open(&target).is_ok();
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("chmod back");
        if readable_anyway {
            return; // Running as root, where no file is unreadable; nothing to assert.
        }
        assert!(
            refused.is_err(),
            "an unreadable destination should not be saved over"
        );
        assert_eq!(fs::read(&target).expect("read back"), b"old");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// The property that makes a crash safe: the destination is never opened for writing, so a reader
    /// holding it open keeps a whole file. An in-place write would fail this with truncated bytes.
    #[test]
    fn a_reader_holding_the_file_open_still_sees_the_old_bytes() {
        let dir = scratch("reader");
        let target = dir.join("doc.md");
        fs::write(&target, b"the old bytes").expect("seed");
        let mut reader = File::open(&target).expect("open");
        write_atomic(&target, b"the new bytes, longer").expect("save");
        let mut seen = Vec::new();
        reader.read_to_end(&mut seen).expect("read");
        assert_eq!(
            seen, b"the old bytes",
            "the save was visible to an open reader"
        );
        assert_eq!(
            fs::read(&target).expect("read back"),
            b"the new bytes, longer"
        );
    }

    #[test]
    #[cfg(unix)]
    fn the_destinations_mode_survives_the_save() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("chmod");
        write_atomic(&target, b"new").expect("save");
        let mode = fs::metadata(&target).expect("stat").permissions().mode() & 0o777;
        assert_eq!(mode, 0o640, "the save changed the file's mode");
    }

    #[test]
    #[cfg(unix)]
    fn a_read_only_destination_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("readonly");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o444)).expect("chmod");
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("chmod back");
        let err = refused.expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("read-only"));
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    #[cfg(unix)]
    fn an_unwritable_directory_is_refused_and_the_old_bytes_survive() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("unwritable");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).expect("chmod");
        let writable_anyway = File::create(dir.join(".probe")).is_ok();
        let refused = write_atomic(&target, b"new");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).expect("chmod back");
        if writable_anyway {
            return; // Running as root, where no directory is unwritable; nothing to assert.
        }
        assert!(
            refused.is_err(),
            "a save into an unwritable directory should fail"
        );
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    #[cfg(unix)]
    fn a_symlinked_document_is_saved_through_the_link() {
        let dir = scratch("symlink");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, b"old").expect("seed");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        write_atomic(&link, b"new").expect("save");
        assert!(fs::symlink_metadata(&link)
            .expect("stat")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&real).expect("read back"), b"new");
    }

    #[test]
    #[cfg(unix)]
    fn a_dangling_symlink_is_refused() {
        let dir = scratch("dangling");
        let link = dir.join("link.md");
        std::os::unix::fs::symlink(dir.join("missing.md"), &link).expect("symlink");
        let err = write_atomic(&link, b"new").expect_err("expected a refusal");
        assert!(err.message.contains("symlink"));
    }

    #[test]
    #[cfg(unix)]
    fn a_hard_linked_document_is_refused() {
        let dir = scratch("hardlink");
        let target = dir.join("doc.md");
        let other = dir.join("other.md");
        fs::write(&target, b"old").expect("seed");
        fs::hard_link(&target, &other).expect("hard link");
        let err = write_atomic(&target, b"new").expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("hard links"));
        assert_eq!(fs::read(&target).expect("read back"), b"old");
    }

    #[test]
    #[cfg(windows)]
    fn a_hard_linked_document_is_refused_on_windows_and_both_names_keep_their_bytes() {
        let dir = scratch("hardlink-win");
        let target = dir.join("a.md");
        let other = dir.join("b.md");
        fs::write(&target, b"old").expect("seed");
        fs::hard_link(&target, &other).expect("hard link");
        let err = write_atomic(&target, b"new").expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("hard links"), "{}", err.message);
        assert_eq!(fs::read(&target).expect("a"), b"old");
        assert_eq!(fs::read(&other).expect("b"), b"old");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    #[cfg(windows)]
    fn saving_by_another_spelling_keeps_the_names_case_on_windows() {
        let dir = scratch("case-win");
        fs::write(dir.join("README.md"), b"old").expect("seed");
        write_atomic(&dir.join("readme.md"), b"new").expect("save");
        let names: Vec<String> = fs::read_dir(&dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["README.md".to_string()]);
        assert_eq!(fs::read(dir.join("README.md")).expect("read back"), b"new");
    }

    /// `icacls`'s listing of `path`'s access entries, without the path it begins with.
    #[cfg(windows)]
    fn access_entries(path: &Path) -> String {
        let out = std::process::Command::new("icacls")
            .arg(path)
            .output()
            .expect("icacls");
        assert!(out.status.success(), "icacls {}", path.display());
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        text.replacen(&path.display().to_string(), "", 1)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.contains("Successfully processed"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[cfg(windows)]
    fn attributes(path: &Path) -> u32 {
        use std::os::windows::fs::MetadataExt;
        fs::metadata(path).expect("stat").file_attributes()
    }

    /// The reviewer's case: an entry granted to one file, a creation date, and the hidden and not-indexed marks, all
    /// survive a save, which renames a fresh file over the old one.
    #[test]
    #[cfg(windows)]
    fn the_access_list_creation_time_and_attributes_survive_the_save_on_windows() {
        use std::os::windows::fs::FileTimesExt;
        use std::process::Command;
        let dir = scratch("acl-win");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        // Users, by SID, so the account's language does not matter.
        let granted = Command::new("icacls")
            .arg(&target)
            .args(["/grant", "*S-1-5-32-545:(R)"])
            .output()
            .expect("icacls /grant");
        assert!(granted.status.success(), "{granted:?}");
        let created = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
        File::options()
            .write(true)
            .open(&target)
            .expect("open")
            .set_times(fs::FileTimes::new().set_created(created))
            .expect("set created");
        let marked = Command::new("attrib")
            .args(["+h", "+i"])
            .arg(&target)
            .status()
            .expect("attrib");
        assert!(marked.success());
        let entries = access_entries(&target);
        assert!(
            entries.contains("S-1-5-32-545") || entries.contains("Users"),
            "{entries}"
        );
        let marks = attributes(&target) & (0x2 | 0x2000);
        assert_eq!(marks, 0x2 | 0x2000);

        write_atomic(&target, b"new").expect("save");

        assert_eq!(fs::read(&target).expect("read back"), b"new");
        assert_eq!(
            access_entries(&target),
            entries,
            "the save changed the access list"
        );
        assert_eq!(
            fs::metadata(&target)
                .expect("stat")
                .created()
                .expect("created"),
            created,
            "the save changed the creation time"
        );
        assert_eq!(
            attributes(&target) & (0x2 | 0x2000),
            marks,
            "the save dropped an attribute"
        );
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// A file whose access list is protected (inherits nothing) keeps it so through a save.
    #[test]
    #[cfg(windows)]
    fn a_protected_access_list_stays_protected_on_windows() {
        use std::process::Command;
        let dir = scratch("acl-protected");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        let cut = Command::new("icacls")
            .arg(&target)
            .args(["/inheritance:d"])
            .output()
            .expect("icacls /inheritance:d");
        assert!(cut.status.success(), "{cut:?}");
        let entries = access_entries(&target);
        assert!(!entries.contains("(I)"), "{entries}");
        write_atomic(&target, b"new").expect("save");
        assert_eq!(access_entries(&target), entries);
        assert_eq!(fs::read(&target).expect("read back"), b"new");
    }

    /// Saving through a file's 8.3 alias keeps its long name. Skipped, loudly, where the volume makes no short names.
    #[test]
    #[cfg(windows)]
    fn saving_through_a_short_name_keeps_the_long_name_on_windows() {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        #[link(name = "kernel32")]
        extern "system" {
            fn GetShortPathNameW(long: *const u16, short: *mut u16, len: u32) -> u32;
        }
        let dir = scratch("short-name");
        let long = dir.join("a very long document name.md");
        fs::write(&long, b"old").expect("seed");
        let wide: Vec<u16> = long.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut buf = vec![0u16; 1024];
        let n = unsafe { GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
        assert!(n > 0, "GetShortPathNameW failed");
        let short = PathBuf::from(std::ffi::OsString::from_wide(&buf[..n as usize]));
        if short.file_name() == long.file_name() {
            println!("short-name: skipped: this volume makes no 8.3 names");
            return;
        }
        write_atomic(&short, b"new").expect("save");
        let names: Vec<String> = fs::read_dir(&dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a very long document name.md".to_string()]);
        assert_eq!(fs::read(&long).expect("read back"), b"new");
    }

    /// Opens `path` the way a scanner or indexer might: readable and writable by others, but not deletable or
    /// renamable, so a rename over it is refused until the handle is closed.
    #[cfg(windows)]
    fn hold_without_delete_sharing(path: &Path) -> File {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2) // FILE_SHARE_READ | FILE_SHARE_WRITE
            .open(path)
            .expect("hold")
    }

    #[test]
    #[cfg(windows)]
    fn a_short_lock_is_waited_out_on_windows() {
        let dir = scratch("lock-short");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        let held = hold_without_delete_sharing(&target);
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            drop(held);
        });
        let started = std::time::Instant::now();
        write_atomic(&target, b"new").expect("a lock released after 200 ms must not fail the save");
        assert!(started.elapsed() >= std::time::Duration::from_millis(150));
        release.join().expect("release");
        assert_eq!(fs::read(&target).expect("read back"), b"new");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    #[cfg(windows)]
    fn a_lock_that_outlasts_the_wait_fails_the_save_with_the_old_bytes_and_no_staging_file() {
        let dir = scratch("lock-long");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        let held = hold_without_delete_sharing(&target);
        let started = std::time::Instant::now();
        let err = write_atomic(&target, b"new").expect_err("a held file cannot be replaced");
        let waited = started.elapsed();
        drop(held);
        assert!(
            waited >= std::time::Duration::from_millis(900),
            "{waited:?}"
        );
        assert!(waited < std::time::Duration::from_secs(5), "{waited:?}");
        assert_eq!(err.kind, WriteErrorKind::Io);
        assert_eq!(fs::read(&target).expect("read back"), b"old");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_directory_is_not_a_document() {
        let dir = scratch("directory");
        let target = dir.join("sub");
        fs::create_dir(&target).expect("mkdir");
        let err = write_atomic(&target, b"new").expect_err("expected a refusal");
        assert_eq!(err.kind, WriteErrorKind::Permission);
        assert!(err.message.contains("regular file"));
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// macOS is the only platform where `std` carries extended attributes across a copy, so this is
    /// the only platform that can assert it. It skips when the `xattr` tool is missing.
    #[test]
    #[cfg(target_os = "macos")]
    fn extended_attributes_survive_the_save_on_macos() {
        let dir = scratch("xattr");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        let path = target.to_string_lossy().into_owned();
        let set = std::process::Command::new("xattr")
            .args(["-w", "com.marxy.test", "kept", &path])
            .status();
        match set {
            Ok(status) if status.success() => {}
            _ => return, // No `xattr` on this machine; nothing to assert.
        }
        write_atomic(&target, b"new").expect("save");
        let read = std::process::Command::new("xattr")
            .args(["-p", "com.marxy.test", &path])
            .output()
            .expect("xattr -p");
        assert_eq!(String::from_utf8_lossy(&read.stdout).trim(), "kept");
    }

    /// The case `refuse_ownership_change` still refuses: a different owning user. A different
    /// group is restored, so a save into a directory whose group is not the user's own succeeds.
    #[test]
    fn refuse_ownership_change_refuses_a_uid_mismatch() {
        assert!(
            ownership_refuses(501, 0),
            "a file owned by someone else is the case the save refuses"
        );
        assert!(
            !ownership_refuses(501, 501),
            "a file we own is not refused for the uid"
        );
    }

    /// A supplementary group the process belongs to, so the tests can chown without root.
    #[cfg(unix)]
    fn supplementary_gid() -> Option<u32> {
        let output = std::process::Command::new("id").arg("-G").output().ok()?;
        let gids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();
        let primary = gids.first().copied()?;
        gids.into_iter().find(|&g| g != primary)
    }

    #[test]
    #[cfg(unix)]
    fn a_file_whose_group_differs_from_the_process_keeps_its_group_on_save() {
        let Some(gid) = supplementary_gid() else {
            panic!(
                "process has no supplementary group, so the narrowed ownership check cannot be proved"
            );
        };
        let dir = scratch("group-restore");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        chown(&target, None, Some(gid)).expect("chgrp the destination to a supplementary group");
        write_atomic(&target, b"new").expect("a group mismatch must be restored, not refused");
        assert_eq!(fs::read(&target).expect("read back"), b"new");
        assert_eq!(
            fs::metadata(&target).expect("stat").gid(),
            gid,
            "the save changed the file's group"
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_save_into_a_directory_whose_group_differs_from_the_users_own_succeeds() {
        let Some(gid) = supplementary_gid() else {
            panic!(
                "process has no supplementary group, so a different-group directory cannot be set up"
            );
        };
        let dir = scratch("dir-group");
        chown(&dir, None, Some(gid)).expect("chgrp the directory");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");
        write_atomic(&target, b"new")
            .expect("saving into a different-group directory must succeed");
        assert_eq!(fs::read(&target).expect("read back"), b"new");
    }

    fn chflags(flag: &str, path: &Path) {
        let status = std::process::Command::new("chflags")
            .args([flag, &path.to_string_lossy()])
            .status()
            .expect("run chflags");
        assert!(status.success());
    }

    /// A file locked in Finder (`uchg`) is refused up front, in words about Finder, with the file unchanged and no
    /// staged file left beside it.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_file_locked_in_finder_is_refused_and_nothing_is_left_behind() {
        let dir = scratch("uchg");
        let target = dir.join("doc.md");
        fs::write(&target, b"old\n").expect("seed");
        chflags("uchg", &target);
        let refused = write_atomic(&target, b"new\n");
        chflags("nouchg", &target);
        let refused = refused.expect_err("a locked file is not saved over");
        assert_eq!(refused.kind, WriteErrorKind::Permission);
        assert!(refused.message.contains("locked in Finder"), "{}", refused.message);
        assert_eq!(fs::read(&target).expect("read"), b"old\n");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    /// Cleanup of a staged file that carries the immutable flag clears the flag first, so it does not stay for good.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_staged_file_with_the_immutable_flag_is_still_removed() {
        let dir = scratch("uchg-staged");
        let tmp = dir.join(".doc.md.marxy-tmp-1-0-0");
        fs::write(&tmp, b"x").expect("seed");
        chflags("uchg", &tmp);
        assert!(fs::remove_file(&tmp).is_err(), "the flag blocks a plain remove");
        remove_staged(&tmp);
        assert!(fs::symlink_metadata(&tmp).is_err(), "staged file left behind");
    }

    /// Sets `user.marxy.test`, saves through the real path, and reads the attribute back. POSIX
    /// ACLs are asserted the same way when the filesystem accepts them. The only skip is
    /// `filesystem_lacks_support`; a catch-all skip fails the fidelity gate.
    #[test]
    #[cfg(target_os = "linux")]
    fn extended_attributes_and_posix_acls_survive_the_save_on_linux() {
        let dir = scratch("linux-xattr");
        let target = dir.join("doc.md");
        fs::write(&target, b"old").expect("seed");

        match linux_xattr::set(&target, "user.marxy.test", b"kept") {
            Ok(()) => {}
            Err(err) if linux_xattr::filesystem_lacks_support(&err) => {
                println!(
                    "linux-xattr: skipped: filesystem does not support extended attributes ({err})"
                );
                return;
            }
            Err(err) => panic!("setting user.marxy.test failed: {err}"),
        }

        let acl = linux_xattr::named_user_acl(65534);
        let acl_set = match linux_xattr::set(&target, "system.posix_acl_access", &acl) {
            Ok(()) => true,
            Err(err) if linux_xattr::filesystem_lacks_support(&err) => {
                println!("linux-acl: skipped: filesystem does not support POSIX ACLs ({err})");
                false
            }
            Err(err) => panic!("setting POSIX ACL failed: {err}"),
        };

        write_atomic(&target, b"new").expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"new");

        let value = linux_xattr::get(&target, "user.marxy.test").expect("read xattr back");
        assert_eq!(&value, b"kept", "the save dropped user.marxy.test");
        println!("linux-xattr: preserved");

        if acl_set {
            let got = linux_xattr::get(&target, "system.posix_acl_access").expect("read ACL back");
            assert_eq!(got, acl, "the save dropped the POSIX ACL");
            println!("linux-acl: preserved");
        }
    }
}

/// `write_new`: create-only. Every refusal here must leave the name exactly as it was and
/// no staging file beside it.
#[cfg(test)]
mod write_new_tests {
    use super::*;
    use std::io::ErrorKind;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-new-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    /// Every name in `dir`, hidden staging files included, sorted.
    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        out.sort();
        out
    }

    fn assert_refused_exists(result: Result<(), WriteError>) -> WriteError {
        let err = result.expect_err("a create-only write onto a taken name must fail");
        assert_eq!(
            err.kind,
            WriteErrorKind::Exists,
            "wrong refusal: {}",
            err.message
        );
        assert!(!err.message.is_empty());
        err
    }

    #[test]
    fn write_new_onto_a_free_name_writes_the_bytes() {
        let dir = scratch("free");
        let target = dir.join("fresh (fork).md");
        let bytes: &[u8] = b"\xef\xbb\xbf# t\r\n\r\nbody\r\n\x00\xff";
        write_new(&target, bytes).expect("create");
        assert_eq!(fs::read(&target).expect("read back"), bytes);
        assert_eq!(
            names(&dir),
            vec!["fresh (fork).md".to_string()],
            "no staging file remains"
        );
    }

    #[test]
    fn write_new_onto_an_existing_file_fails_exists_and_the_file_is_unchanged() {
        let dir = scratch("file");
        let target = dir.join("doc.md");
        fs::write(&target, b"mine").expect("seed");
        assert_refused_exists(write_new(&target, b"theirs"));
        assert_eq!(fs::read(&target).expect("read back"), b"mine");
        assert_eq!(
            names(&dir),
            vec!["doc.md".to_string()],
            "no staging file remains"
        );
    }

    #[test]
    fn write_new_onto_a_folder_fails_exists_and_the_folder_is_unchanged() {
        let dir = scratch("folder");
        let target = dir.join("folder.md");
        fs::create_dir(&target).expect("seed");
        fs::write(target.join("inside.txt"), b"in").expect("seed inside");
        assert_refused_exists(write_new(&target, b"x"));
        assert!(target.is_dir());
        assert_eq!(fs::read(target.join("inside.txt")).expect("inside"), b"in");
        assert_eq!(names(&dir), vec!["folder.md".to_string()]);
    }

    #[test]
    #[cfg(unix)]
    fn write_new_onto_a_symlink_fails_exists_and_neither_the_link_nor_its_file_changes() {
        let dir = scratch("symlink");
        let real = dir.join("real.md");
        let link = dir.join("x (mine).md");
        fs::write(&real, b"the other file").expect("seed");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        assert_refused_exists(write_new(&link, b"copy"));
        assert_eq!(
            fs::read(&real).expect("real"),
            b"the other file",
            "the file the link points at was written through"
        );
        assert_eq!(fs::read_link(&link).expect("still a link"), real);
        assert_eq!(
            names(&dir),
            vec!["real.md".to_string(), "x (mine).md".to_string()]
        );
    }

    #[test]
    #[cfg(unix)]
    fn write_new_onto_a_dangling_symlink_fails_exists_and_creates_nothing_at_its_destination() {
        let dir = scratch("dangling-new");
        let missing = dir.join("missing.md");
        let link = dir.join("link.md");
        std::os::unix::fs::symlink(&missing, &link).expect("symlink");
        assert_refused_exists(write_new(&link, b"copy"));
        assert!(
            !missing.exists(),
            "the write created the file the dangling link led to"
        );
        assert_eq!(fs::read_link(&link).expect("still a link"), missing);
        assert_eq!(names(&dir), vec!["link.md".to_string()]);
    }

    /// On a case-insensitive volume (the APFS default) `Notes (Fork).md` is the same name as `notes (fork).md`.
    /// Skipped, loudly, where the volume is case-sensitive: there the two really are different names.
    #[test]
    fn write_new_onto_a_case_variant_of_an_existing_name_fails_on_a_case_insensitive_volume() {
        let dir = scratch("case");
        let existing = dir.join("Notes (fork).md");
        fs::write(&existing, b"mine").expect("seed");
        let variant = dir.join("notes (FORK).md");
        if fs::symlink_metadata(&variant).is_err() {
            println!("case-insensitive: skipped: this volume is case-sensitive, so a case variant is a different name");
            write_new(&variant, b"x").expect("a different name is free");
            return;
        }
        assert_refused_exists(write_new(&variant, b"theirs"));
        assert_eq!(fs::read(&existing).expect("read back"), b"mine");
        assert_eq!(
            names(&dir),
            vec!["Notes (fork).md".to_string()],
            "no second name, no staging file"
        );
    }

    /// The race itself: a creator appears after the early look and before the commit. The exclusive commit
    /// must refuse and leave the creator's bytes, and the staged file must be gone.
    #[test]
    fn a_creator_that_appears_before_the_commit_is_not_replaced() {
        let dir = scratch("race-commit");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        fs::write(&target, b"the racing creator").expect("the creator wins the name");
        let err = assert_refused_exists(commit_new(
            &tmp,
            &target,
            &dir,
            &exclusive::rename,
            &|a, b| fs::hard_link(a, b),
        ));
        assert_eq!(fs::read(&target).expect("read back"), b"the racing creator");
        // `write_new` removes the staging file on any failure; `commit_new` alone leaves that to it.
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), vec!["doc (fork).md".to_string()]);
        assert!(err.message.contains("will not replace"));
    }

    /// The same race through the link fallback, with the exclusive rename made to refuse.
    #[test]
    fn a_creator_that_appears_before_the_link_fallback_is_not_replaced() {
        let dir = scratch("race-link");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        fs::write(&target, b"the racing creator").expect("creator");
        let unsupported = |_: &Path, _: &Path| Err(ErrorKind::Unsupported.into());
        assert_refused_exists(commit_new(&tmp, &target, &dir, &unsupported, &|a, b| {
            fs::hard_link(a, b)
        }));
        assert_eq!(fs::read(&target).expect("read back"), b"the racing creator");
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), vec!["doc (fork).md".to_string()]);
    }

    #[test]
    fn when_the_exclusive_rename_is_unsupported_link_and_unlink_create_the_file() {
        let dir = scratch("fallback");
        for kind in [ErrorKind::Unsupported, ErrorKind::InvalidInput] {
            let refuse = move |_: &Path, _: &Path| Err(kind.into());
            let target = dir.join(format!("{kind:?}.md"));
            let tmp = temp_path_for(&target);
            stage_new(&tmp, b"mine").expect("stage");
            commit_new(&tmp, &target, &dir, &refuse, &|a, b| fs::hard_link(a, b))
                .expect("link fallback");
            assert_eq!(fs::read(&target).expect("read back"), b"mine");
            assert!(!tmp.exists(), "the staging name was not unlinked");
        }
        assert_eq!(
            names(&dir),
            vec!["InvalidInput.md".to_string(), "Unsupported.md".to_string()]
        );
    }

    /// The errnos the kernel really returns, not `ErrorKind::Unsupported` made up: macOS ENOTSUP (45) is `Uncategorized` in Rust.
    #[test]
    fn the_real_not_supported_errnos_take_the_fallback_and_the_volume_refusal() {
        let dir = scratch("real-errno");
        let errnos = NOT_SUPPORTED_ERRNOS;
        for errno in errnos {
            let refuse = move |_: &Path, _: &Path| Err(std::io::Error::from_raw_os_error(errno));
            // Exclusive rename refuses with the errno, link works: the file is created.
            let target = dir.join(format!("served-{errno}.md"));
            let tmp = temp_path_for(&target);
            stage_new(&tmp, b"mine").expect("stage");
            commit_new(&tmp, &target, &dir, &refuse, &|a, b| fs::hard_link(a, b))
                .expect("link fallback");
            assert_eq!(
                fs::read(&target).expect("read back"),
                b"mine",
                "errno {errno}"
            );
            assert!(!tmp.exists());
            // Both refuse with the errno: the volume message, nothing written.
            let target = dir.join(format!("refused-{errno}.md"));
            let tmp = temp_path_for(&target);
            stage_new(&tmp, b"mine").expect("stage");
            let err = commit_new(&tmp, &target, &dir, &refuse, &refuse).expect_err("must fail");
            assert!(
                err.message
                    .contains("this volume cannot create a file without risk of replacing one"),
                "errno {errno}: {}",
                err.message
            );
            assert!(!target.exists());
            let _ = fs::remove_file(&tmp);
            // The fallback stays no-replace: with a creator at the name, link says exists.
            let target = dir.join(format!("taken-{errno}.md"));
            fs::write(&target, b"theirs").expect("creator");
            let tmp = temp_path_for(&target);
            stage_new(&tmp, b"mine").expect("stage");
            let err = commit_new(&tmp, &target, &dir, &refuse, &|a, b| fs::hard_link(a, b))
                .expect_err("must fail");
            assert_eq!(err.kind, WriteErrorKind::Exists, "errno {errno}");
            assert_eq!(fs::read(&target).expect("read back"), b"theirs");
            let _ = fs::remove_file(&tmp);
        }
    }

    /// A volume that really lacks the exclusive rename and hard links (exFAT): a disk image, attached headless and detached after.
    /// Skipped, loudly, off macOS or where `hdiutil` cannot make one.
    #[test]
    #[cfg(target_os = "macos")]
    fn an_exfat_volume_refuses_with_the_volume_message_and_writes_nothing() {
        use std::process::Command;
        let dir = scratch("exfat");
        let image = dir.join("v.dmg");
        let made = Command::new("hdiutil")
            .args([
                "create", "-size", "4m", "-fs", "ExFAT", "-volname", "MARXYNEW", "-ov",
            ])
            .arg(&image)
            .output();
        if !matches!(&made, Ok(o) if o.status.success()) {
            println!("exfat: skipped: hdiutil could not create an ExFAT image");
            return;
        }
        let attach = Command::new("hdiutil")
            .args([
                "attach",
                "-nobrowse",
                "-noverify",
                "-noautoopen",
                "-mountrandom",
            ])
            .arg(dir.join("mnt-parent"))
            .arg(&image)
            .output();
        // `-mountrandom` needs an existing parent; fall back to a plain attach if the first form is refused.
        let _ = fs::create_dir_all(dir.join("mnt-parent"));
        let attach = match attach {
            Ok(o) if o.status.success() => o,
            _ => match Command::new("hdiutil")
                .args(["attach", "-nobrowse", "-noverify", "-noautoopen"])
                .arg(&image)
                .output()
            {
                Ok(o) if o.status.success() => o,
                _ => {
                    println!("exfat: skipped: hdiutil could not attach the image");
                    return;
                }
            },
        };
        let out = String::from_utf8_lossy(&attach.stdout).into_owned();
        let mount = out
            .lines()
            .filter_map(|l| l.split('\t').next_back())
            .map(str::trim)
            .find(|p| p.starts_with("/Volumes/") || p.contains("mnt-parent"))
            .map(PathBuf::from);
        let Some(mount) = mount else {
            println!("exfat: skipped: could not find the mount point in {out:?}");
            return;
        };
        let result = std::panic::catch_unwind(|| {
            let target = mount.join("a.md");
            let err =
                write_new(&target, b"new").expect_err("exFAT has no exclusive rename or hard link");
            assert_eq!(err.kind, WriteErrorKind::Io);
            assert!(
                err.message
                    .contains("this volume cannot create a file without risk of replacing one"),
                "{}",
                err.message
            );
            assert!(!target.exists(), "the name was created");
            let left: Vec<String> = fs::read_dir(&mount)
                .expect("listing")
                .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
                .filter(|n| n.contains("marxy-tmp"))
                .collect();
            assert!(left.is_empty(), "staging files remain: {left:?}");
        });
        let _ = Command::new("hdiutil")
            .args(["detach", "-force"])
            .arg(&mount)
            .output();
        let _ = fs::remove_file(&image);
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
        println!("exfat: the volume refused");
    }

    #[test]
    fn when_neither_exclusive_way_is_available_it_fails_saying_so_and_writes_nothing() {
        let dir = scratch("no-way");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        let unsupported = |_: &Path, _: &Path| Err(ErrorKind::Unsupported.into());
        let refused = |_: &Path, _: &Path| Err(ErrorKind::PermissionDenied.into());
        let err = commit_new(&tmp, &target, &dir, &unsupported, &refused).expect_err("must fail");
        assert_eq!(err.kind, WriteErrorKind::Io);
        assert!(
            err.message
                .contains("this volume cannot create a file without risk of replacing one"),
            "{}",
            err.message
        );
        assert!(!target.exists(), "the name was created");
        let _ = fs::remove_file(&tmp);
        assert_eq!(names(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_failed_write_new_leaves_no_staging_file() {
        // A directory that is not there: staging fails, and nothing is left anywhere.
        let dir = scratch("no-dir");
        let target = dir.join("missing-folder").join("doc.md");
        let err = write_new(&target, b"x").expect_err("must fail");
        assert_eq!(err.kind, WriteErrorKind::Io);
        assert_eq!(names(&dir), Vec::<String>::new());
    }

    /// Many creators at one name: exactly one wins and its bytes are whole; every other fails `Exists`;
    /// nothing is left behind. Check-then-write would let more than one succeed.
    #[test]
    fn concurrent_creators_at_one_name_have_exactly_one_winner() {
        use std::sync::{Arc, Barrier};
        for round in 0..20 {
            let dir = scratch(&format!("concurrent-{round}"));
            let target = Arc::new(dir.join("doc (fork).md"));
            let creators = 8usize;
            let start = Arc::new(Barrier::new(creators));
            let handles: Vec<_> = (0..creators)
                .map(|i| {
                    let target = Arc::clone(&target);
                    let start = Arc::clone(&start);
                    std::thread::spawn(move || {
                        let bytes =
                            format!("creator {i} {}", "x".repeat(4096 * (i + 1))).into_bytes();
                        start.wait();
                        (i, bytes.clone(), write_new(&target, &bytes))
                    })
                })
                .collect();
            let results: Vec<_> = handles
                .into_iter()
                .map(|h| h.join().expect("thread"))
                .collect();
            let winners: Vec<_> = results.iter().filter(|(_, _, r)| r.is_ok()).collect();
            assert_eq!(
                winners.len(),
                1,
                "round {round}: {} creators succeeded",
                winners.len()
            );
            for (i, _, result) in &results {
                if let Err(err) = result {
                    assert_eq!(
                        err.kind,
                        WriteErrorKind::Exists,
                        "creator {i}: {}",
                        err.message
                    );
                }
            }
            assert_eq!(
                fs::read(&*target).expect("read back"),
                winners[0].1,
                "the file is not the winner's whole bytes"
            );
            assert_eq!(
                names(&dir),
                vec!["doc (fork).md".to_string()],
                "round {round}: a staging file remains"
            );
        }
    }

    /// The kernel's own exclusive rename, called directly: it must refuse every kind of occupant rather than
    /// replace it, and it must not be the `Unsupported` that would silently route everything to `link`.
    #[test]
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn the_exclusive_rename_refuses_a_file_a_folder_a_link_and_a_dangling_link() {
        let dir = scratch("excl");
        let occupants = ["file", "folder", "link", "dangling"];
        for name in occupants {
            let tmp = dir.join(format!(".stage-{name}"));
            fs::write(&tmp, b"mine").expect("stage");
            let target = dir.join(name);
            match name {
                "file" => fs::write(&target, b"theirs").expect("seed"),
                "folder" => fs::create_dir(&target).expect("seed"),
                "link" => {
                    fs::write(dir.join("real"), b"theirs").expect("real");
                    std::os::unix::fs::symlink(dir.join("real"), &target).expect("link")
                }
                _ => std::os::unix::fs::symlink(dir.join("nowhere"), &target).expect("dangling"),
            }
            let err = exclusive::rename(&tmp, &target).expect_err("must not replace");
            assert_eq!(err.kind(), ErrorKind::AlreadyExists, "{name}: {err}");
            assert_eq!(fs::read(&tmp).expect("stage kept"), b"mine");
        }
        assert_eq!(fs::read(dir.join("file")).expect("file"), b"theirs");
        assert_eq!(fs::read(dir.join("real")).expect("real"), b"theirs");
        assert!(!dir.join("nowhere").exists());
        let free = dir.join("free");
        exclusive::rename(&dir.join(".stage-file"), &free).expect("a free name is taken");
        assert_eq!(fs::read(&free).expect("free"), b"mine");
    }

    /// Windows' exclusive rename refuses a file and a folder, takes a free name, and never needs a hard link, which FAT,
    /// exFAT and SMB volumes refuse.
    #[test]
    #[cfg(windows)]
    fn on_windows_the_exclusive_rename_refuses_a_file_and_a_folder_and_needs_no_hard_link() {
        let dir = scratch("excl-win");
        for name in ["file", "folder"] {
            let tmp = dir.join(format!(".stage-{name}"));
            fs::write(&tmp, b"mine").expect("stage");
            let target = dir.join(name);
            if name == "file" {
                fs::write(&target, b"theirs").expect("seed");
            } else {
                fs::create_dir(&target).expect("seed");
            }
            let err = exclusive::rename(&tmp, &target).expect_err("must not replace");
            assert_eq!(err.kind(), ErrorKind::AlreadyExists, "{name}: {err}");
            assert_eq!(fs::read(&tmp).expect("stage kept"), b"mine");
            let _ = fs::remove_file(&tmp);
        }
        assert_eq!(fs::read(dir.join("file")).expect("file"), b"theirs");
        let target = dir.join("doc (fork).md");
        let tmp = temp_path_for(&target);
        stage_new(&tmp, b"mine").expect("stage");
        let no_link = |_: &Path, _: &Path| -> std::io::Result<()> {
            panic!("the hard-link fallback was used")
        };
        commit_new(&tmp, &target, &dir, &exclusive::rename, &no_link).expect("create");
        assert_eq!(fs::read(&target).expect("read back"), b"mine");
        assert!(!tmp.exists());
        // A long path: the call is made verbatim, so 260 characters do not stop it.
        let deep = dir.join("d".repeat(120)).join("e".repeat(120));
        fs::create_dir_all(&deep).expect("deep");
        let target = deep.join(format!("{}.md", "f".repeat(60)));
        assert!(target.as_os_str().len() > 260);
        write_new(&target, b"far").expect("create under a long path");
        assert_eq!(fs::read(&target).expect("read back"), b"far");
        assert_eq!(
            names(&dir),
            vec![
                "d".repeat(120),
                "doc (fork).md".to_string(),
                "file".to_string(),
                "folder".to_string()
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn the_new_file_is_an_ordinary_one_with_one_name() {
        use std::os::unix::fs::MetadataExt;
        let dir = scratch("one-name");
        let target = dir.join("doc.md");
        write_new(&target, b"x").expect("create");
        let meta = fs::metadata(&target).expect("meta");
        assert!(meta.is_file());
        assert_eq!(
            meta.nlink(),
            1,
            "the staging name must not remain as a second link"
        );
    }
}

#[cfg(test)]
mod unless_changed_tests {
    use super::*;
    use std::time::Duration;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-guard-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    fn staged_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .expect("listing")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("marxy-tmp"))
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// An old write time, so a file put in its place now has a different one whatever the clock's resolution.
    fn age(path: &Path) {
        let file = OpenOptions::new()
            .write(true)
            .open(path)
            .expect("open to age");
        file.set_modified(UNIX_EPOCH + Duration::from_secs(946_684_800))
            .expect("set the write time");
    }

    fn utf16le_with_bom(text: &str) -> Vec<u8> {
        let mut out = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out
    }

    #[test]
    fn sha256_matches_the_published_test_vectors() {
        let cases: [(&[u8], &str); 3] = [
            (
                b"",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            ),
        ];
        for (input, want) in cases {
            assert_eq!(hex(&sha256::digest(input)), want, "{input:?}");
        }
        let million = vec![b'a'; 1_000_000];
        assert_eq!(
            hex(&sha256::digest(&million)),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn sha256_on_the_cpus_instructions_matches_the_portable_rounds() {
        println!(
            "sha256: the CPU's instructions are {}used",
            if sha256::Hasher::new().is_fast() {
                ""
            } else {
                "not "
            }
        );
        let mut seed = 0x9e3779b97f4a7c15u64;
        for len in [0usize, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 4096, 100_003] {
            let bytes: Vec<u8> = (0..len)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    seed as u8
                })
                .collect();
            let mut portable = sha256::Hasher::portable_only();
            portable.update(&bytes);
            assert_eq!(sha256::digest(&bytes), portable.finish(), "{len} bytes");
        }
    }

    #[test]
    fn sha256_is_the_same_however_the_bytes_arrive() {
        let bytes: Vec<u8> = (0..1000u32).map(|i| (i * 7 % 251) as u8).collect();
        let whole = sha256::digest(&bytes);
        for step in [1, 3, 63, 64, 65, 127, 500] {
            let mut hasher = sha256::Hasher::new();
            for piece in bytes.chunks(step) {
                hasher.update(piece);
            }
            assert_eq!(hasher.finish(), whole, "pieces of {step}");
        }
    }

    #[test]
    fn the_expectation_reads_from_the_webviews_hex_and_refuses_anything_else() {
        let want = Expected::of(b"hello");
        let spelled = format!("{}{}", hex(&want.len.to_be_bytes()), hex(&want.sha256));
        assert_eq!(Expected::from_hex(&spelled), Some(want));
        assert_eq!(Expected::from_hex(&spelled.to_uppercase()), Some(want));
        assert_eq!(Expected::from_hex(&spelled[2..]), None);
        assert_eq!(Expected::from_hex(&format!("zz{}", &spelled[2..])), None);
    }

    #[test]
    fn an_unchanged_file_is_saved() {
        let dir = scratch("unchanged");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\r\n").expect("plant");
        write_atomic_unless_changed(&target, b"two\r\n", Some(&Expected::of(b"one\r\n")))
            .expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"two\r\n");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_file_changed_underneath_is_refused_and_keeps_the_other_programs_bytes() {
        let dir = scratch("changed");
        let target = dir.join("doc.md");
        fs::write(&target, b"two\n").expect("plant");
        // The same length as what was read: only the content says it changed.
        let err = write_atomic_unless_changed(&target, b"mine\n", Some(&Expected::of(b"one\n")))
            .expect_err("refused");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert!(
            err.message
                .contains("changed on disk since it was opened; refusing to overwrite"),
            "{}",
            err.message
        );
        assert_eq!(fs::read(&target).expect("read back"), b"two\n");
        // Another length is refused before any of it is read.
        fs::write(&target, b"longer now\n").expect("plant");
        let err = write_atomic_unless_changed(&target, b"mine\n", Some(&Expected::of(b"one\n")))
            .expect_err("refused");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert_eq!(fs::read(&target).expect("read back"), b"longer now\n");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_removed_file_is_made_again() {
        let dir = scratch("removed");
        let target = dir.join("doc.md");
        write_atomic_unless_changed(&target, b"back\n", Some(&Expected::of(b"was here\n")))
            .expect("nothing to overwrite, so nothing to refuse");
        assert_eq!(fs::read(&target).expect("read back"), b"back\n");
    }

    #[test]
    fn a_utf16_file_changed_underneath_is_left_byte_for_byte_by_the_refused_save() {
        let dir = scratch("utf16");
        let target = dir.join("notes.txt");
        let read = utf16le_with_bom("Harbour notes\r\n");
        let theirs = utf16le_with_bom("Harbour notes, edited\r\n");
        fs::write(&target, &theirs).expect("plant");
        let err = write_atomic_unless_changed(
            &target,
            &utf16le_with_bom("Shore notes\r\n"),
            Some(&Expected::of(&read)),
        )
        .expect_err("refused");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert_eq!(fs::read(&target).expect("read back"), theirs);
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_write_after_the_check_is_caught_before_the_rename() {
        let dir = scratch("late-write");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\n").expect("plant");
        age(&target);
        let checked = check_unchanged(&target, &target, &Expected::of(b"one\n"))
            .expect("checked")
            .expect("there");
        checked
            .still_there(&target, &target)
            .expect("nothing happened yet");
        // Another program writes in place while the save stages. On Windows the save's handle keeps it from opening
        // the file for writing at all, so its write fails there rather than being lost.
        #[cfg(windows)]
        {
            assert!(
                OpenOptions::new().write(true).open(&target).is_err(),
                "another program opened the file for writing while the save held it"
            );
            drop(checked);
            assert_eq!(fs::read(&target).expect("read back"), b"one\n");
            fs::write(&target, b"two\n").expect("the file is writable again once the save lets go");
        }
        #[cfg(not(windows))]
        {
            fs::write(&target, b"two\n").expect("their write");
            let err = checked.still_there(&target, &target).expect_err("caught");
            assert_eq!(err.kind, WriteErrorKind::Changed);
        }
    }

    #[test]
    fn a_rename_into_place_with_the_same_length_and_write_time_is_caught_by_which_file_it_is() {
        let dir = scratch("same-stamp-rename");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\n").expect("plant");
        age(&target);
        let checked = check_unchanged(&target, &target, &Expected::of(b"one\n"))
            .expect("checked")
            .expect("there");
        // An editor that keeps the write time: only the file's identity tells the two apart.
        let theirs = dir.join("theirs.tmp");
        fs::write(&theirs, b"two\n").expect("their staging");
        age(&theirs);
        fs::rename(&theirs, &target).expect("their rename, past the save's handle");
        let err = checked.still_there(&target, &target).expect_err("caught");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert_eq!(fs::read(&target).expect("read back"), b"two\n");
    }

    #[test]
    fn a_zero_identity_is_unknown_and_never_tells_two_files_apart() {
        assert!(differ((7, 1), (7, 2)), "two known files");
        assert!(!differ((7, 1), (7, 1)), "the same file");
        for zero in [(0, 1), (7, 0), (0, 0)] {
            assert!(!differ(zero, (7, 2)), "{zero:?} on the name's side");
            assert!(!differ((7, 2), zero), "{zero:?} on the handle's side");
        }
    }

    #[test]
    fn the_save_replaces_the_file_while_it_still_holds_the_check_handle() {
        let dir = scratch("held-through-rename");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\n").expect("plant");
        let checked = check_unchanged(&target, &target, &Expected::of(b"one\n"))
            .expect("checked")
            .expect("there");
        let tmp = temp_path_for(&target);
        fs::write(&tmp, b"two\n").expect("staged");
        checked.still_there(&target, &target).expect("unchanged");
        commit(&tmp, &target, &dir).expect("the rename over a file the save holds open");
        drop(checked);
        assert_eq!(fs::read(&target).expect("read back"), b"two\n");
        assert_eq!(staged_files(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_file_made_at_a_free_name_while_the_save_staged_is_not_replaced() {
        let dir = scratch("appeared");
        let target = dir.join("doc.md");
        let tmp = temp_path_for(&target);
        fs::write(&tmp, b"mine\n").expect("staged");
        fs::write(&target, b"theirs\n").expect("made by another program meanwhile");
        let err = commit_if_still_free(&target, &tmp, &target, &dir).expect_err("refused");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert_eq!(fs::read(&target).expect("read back"), b"theirs\n");
        // Still free: made.
        let other = dir.join("free.md");
        let tmp = temp_path_for(&other);
        fs::write(&tmp, b"mine\n").expect("staged");
        commit_if_still_free(&other, &tmp, &other, &dir).expect("made");
        assert_eq!(fs::read(&other).expect("read back"), b"mine\n");
    }

    #[test]
    fn a_file_renamed_into_place_after_the_check_is_caught_before_the_rename() {
        let dir = scratch("late-rename");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\n").expect("plant");
        age(&target);
        let checked = check_unchanged(&target, &target, &Expected::of(b"one\n"))
            .expect("checked")
            .expect("there");
        // An editor's own atomic save: the same length, a new file renamed over the name.
        let theirs = dir.join("theirs.tmp");
        fs::write(&theirs, b"two\n").expect("their staging");
        fs::rename(&theirs, &target).expect("their rename");
        let err = checked.still_there(&target, &target).expect_err("caught");
        assert_eq!(err.kind, WriteErrorKind::Changed);
        assert_eq!(fs::read(&target).expect("read back"), b"two\n");
    }

    #[test]
    fn a_file_removed_after_the_check_is_caught_before_the_rename() {
        let dir = scratch("late-remove");
        let target = dir.join("doc.md");
        fs::write(&target, b"one\n").expect("plant");
        let checked = check_unchanged(&target, &target, &Expected::of(b"one\n"))
            .expect("checked")
            .expect("there");
        fs::remove_file(&target).expect("removed by another program");
        let err = checked.still_there(&target, &target).expect_err("caught");
        assert_eq!(err.kind, WriteErrorKind::Changed);
    }

    #[test]
    fn a_save_with_no_expectation_writes_as_before() {
        let dir = scratch("no-expectation");
        let target = dir.join("doc.md");
        fs::write(&target, b"anything\n").expect("plant");
        write_atomic_unless_changed(&target, b"mine\n", None).expect("save");
        assert_eq!(fs::read(&target).expect("read back"), b"mine\n");
    }
}

#[cfg(test)]
mod sweep_tests {
    use super::*;
    use std::process::{Child, Command, Stdio};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("marxy-sweep-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    /// A pid whose process has exited. The child is returned so that, on Windows, its handle keeps the pid from
    /// being given to another process while the test runs.
    fn dead_pid() -> (Child, u32) {
        #[cfg(windows)]
        let mut child = Command::new("cmd").args(["/C", "exit 0"]).spawn().unwrap();
        #[cfg(unix)]
        let mut child = Command::new("true").spawn().unwrap();
        child.wait().unwrap();
        let pid = child.id();
        assert!(!process_running(pid), "an exited process reads as running");
        (child, pid)
    }

    /// A process that runs until it is killed: a shell or `cat` waiting on a pipe that never sends.
    fn live_process() -> Child {
        #[cfg(windows)]
        let program = "cmd";
        #[cfg(unix)]
        let program = "cat";
        Command::new(program)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .unwrap()
    }

    fn leftover_name(pid: u32) -> String {
        format!(".doc.md.marxy-tmp-{pid}-3-123456789")
    }

    fn save_in(dir: &Path) {
        write_atomic(&dir.join("doc.md"), b"saved").expect("save");
    }

    #[test]
    fn the_staging_names_marxy_writes_parse_back_to_this_process() {
        for doc in [
            "notes.md",
            "a.marxy-tmp-1-2-3",
            "日本.txt",
            &"a".repeat(250),
        ] {
            let staged = temp_path_for(&Path::new("/d").join(doc));
            let name = staged.file_name().unwrap().to_str().unwrap();
            assert_eq!(staging_pid(name), Some(std::process::id()), "{name}");
        }
    }

    #[test]
    fn a_leftover_whose_process_is_gone_is_removed_after_a_save_in_its_folder() {
        let dir = scratch("dead");
        let (_child, pid) = dead_pid();
        let leftover = dir.join(leftover_name(pid));
        fs::write(&leftover, b"half a save").unwrap();
        save_in(&dir);
        assert!(
            !leftover.exists(),
            "the dead process's staging file is still there"
        );
        assert_eq!(fs::read(dir.join("doc.md")).unwrap(), b"saved");
    }

    #[test]
    fn the_name_a_leftover_is_moved_to_is_never_taken_for_one() {
        for _ in 0..3 {
            let aside = swept_path_in(Path::new("/d"));
            let name = aside.file_name().unwrap().to_str().unwrap();
            assert_eq!(staging_pid(name), None, "{name}");
        }
    }

    #[test]
    fn a_folder_is_swept_only_at_its_first_save_in_a_run() {
        let dir = scratch("once");
        save_in(&dir);
        let (_child, pid) = dead_pid();
        let later = dir.join(leftover_name(pid));
        fs::write(&later, b"appeared after the sweep").unwrap();
        save_in(&dir);
        write_new(&dir.join("fresh.md"), b"new").expect("create");
        assert_eq!(fs::read(&later).unwrap(), b"appeared after the sweep");
    }

    #[test]
    fn a_leftover_is_removed_after_a_new_file_is_made_in_its_folder() {
        let dir = scratch("dead-new");
        let (_child, pid) = dead_pid();
        let leftover = dir.join(leftover_name(pid));
        fs::write(&leftover, b"half a save").unwrap();
        write_new(&dir.join("fresh.md"), b"new").expect("create");
        assert!(!leftover.exists());
    }

    #[test]
    fn a_staging_file_of_a_running_process_or_of_this_one_stays() {
        let dir = scratch("live");
        let mut live = live_process();
        let theirs = dir.join(leftover_name(live.id()));
        let ours = dir.join(leftover_name(std::process::id()));
        fs::write(&theirs, b"another marxy saving").unwrap();
        fs::write(&ours, b"a save in flight").unwrap();
        save_in(&dir);
        let _ = live.kill();
        let _ = live.wait();
        assert_eq!(fs::read(&theirs).unwrap(), b"another marxy saving");
        assert_eq!(fs::read(&ours).unwrap(), b"a save in flight");
    }

    /// A junction on Windows needs no privilege, where a symbolic link does.
    fn link_dir(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        assert!(Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn a_folder_a_link_or_a_hard_link_with_a_leftovers_name_stays() {
        let root = scratch("shapes");
        let dir = root.join("saved-in");
        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("keep.md"), b"theirs").unwrap();
        let (_child, pid) = dead_pid();
        let folder = dir.join(format!(".a.marxy-tmp-{pid}-0-1"));
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("inside.md"), b"inside").unwrap();
        let link = dir.join(format!(".b.marxy-tmp-{pid}-0-1"));
        link_dir(&elsewhere, &link);
        let hard = dir.join(format!(".c.marxy-tmp-{pid}-0-1"));
        fs::hard_link(elsewhere.join("keep.md"), &hard).unwrap();
        #[cfg(unix)]
        let file_link = {
            let at = dir.join(format!(".d.marxy-tmp-{pid}-0-1"));
            std::os::unix::fs::symlink(elsewhere.join("keep.md"), &at).unwrap();
            at
        };
        save_in(&dir);
        assert_eq!(fs::read(folder.join("inside.md")).unwrap(), b"inside");
        assert!(fs::symlink_metadata(&link).is_ok(), "the link was removed");
        assert_eq!(fs::read(link.join("keep.md")).unwrap(), b"theirs");
        assert_eq!(fs::read(&hard).unwrap(), b"theirs");
        #[cfg(unix)]
        assert!(fs::symlink_metadata(&file_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(elsewhere.join("keep.md")).unwrap(), b"theirs");
    }

    /// File symbolic links need Developer Mode or an elevated process; without either the test skips.
    #[test]
    #[cfg(windows)]
    fn a_file_symlink_with_a_leftovers_name_stays_on_windows() {
        const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;
        let root = scratch("file-link");
        let dir = root.join("saved-in");
        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("keep.md"), b"theirs").unwrap();
        let (_child, pid) = dead_pid();
        let link = dir.join(leftover_name(pid));
        match std::os::windows::fs::symlink_file(elsewhere.join("keep.md"), &link) {
            Ok(()) => {}
            Err(e) if e.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD) => {
                println!(
                    "file-symlink: skipped: file symbolic links need Developer Mode or elevation"
                );
                return;
            }
            Err(e) => panic!("symlink_file: {e}"),
        }
        save_in(&dir);
        assert!(fs::symlink_metadata(&link)
            .expect("the link was removed")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&link).unwrap(), b"theirs");
        assert_eq!(fs::read(elsewhere.join("keep.md")).unwrap(), b"theirs");
    }

    #[test]
    fn a_name_close_to_a_staging_name_but_not_one_stays() {
        let dir = scratch("close");
        let (_child, pid) = dead_pid();
        let names = [
            format!("doc.md.marxy-tmp-{pid}-0-1"),
            format!(".marxy-tmp-{pid}-0-1"),
            format!(".doc.md.marxy-tmp-{pid}-0"),
            format!(".doc.md.marxy-tmp-{pid}-0-1-2"),
            format!(".doc.md.marxy-tmp-{pid}-0-1.bak"),
            format!(".doc.md.marxy-tmp-{pid}-00-1"),
            format!(".doc.md.marxy-tmp-0{pid}-0-1"),
            format!(".doc.md.marxy-tmp-+{pid}-0-1"),
            format!(".doc.md.marxy-tmp-{pid}-0-1000000000"),
            format!(".doc.md.marxy-tmp-{pid}--1"),
            format!(".doc.md.marxy-temp-{pid}-0-1"),
            format!(".doc.md.MARXY-TMP-{pid}-0-1"),
            format!(".doc.md.marxy-tmp-{pid}-x-1"),
            ".doc.md.marxy-tmp-0-0-1".to_string(),
        ];
        for name in &names {
            fs::write(dir.join(name), b"not marxy's").unwrap();
        }
        save_in(&dir);
        for name in &names {
            assert!(dir.join(name).exists(), "{name} was removed");
        }
    }

    #[test]
    fn a_folder_this_run_never_saved_to_is_untouched() {
        let root = scratch("untouched");
        let saved = root.join("saved");
        let other = root.join("other");
        fs::create_dir_all(&saved).unwrap();
        fs::create_dir_all(&other).unwrap();
        let (_child, pid) = dead_pid();
        let leftover = other.join(leftover_name(pid));
        fs::write(&leftover, b"half a save").unwrap();
        save_in(&saved);
        assert!(leftover.exists(), "a folder nothing was saved to was swept");
    }
}
