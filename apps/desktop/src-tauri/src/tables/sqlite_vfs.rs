//! The VFS a database read in place is opened through: SQLite's own, but for its rollback journal. SQLite looks for a hot
//! journal by name before every read, and a `-journal` absent when the files beside the database were judged could be
//! made a link to another file before it looks. So the journal is opened here, by name, judged by its handle as the
//! other files beside it are (`judge_beside`), and SQLite reads that handle and no other. One that is refused is not
//! opened, which SQLite takes for a hot journal; a read-only connection does not roll one back, it stops.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

use rusqlite::ffi;

use super::{judge_beside, Beside};

const NAME: &CStr = c"marxy-held";

/// SQLite's own VFS, which everything but the journal goes to.
static BASE: AtomicPtr<ffi::sqlite3_vfs> = AtomicPtr::new(std::ptr::null_mut());

/// The registered VFS's name, or None when it could not be registered.
pub(super) fn name() -> Option<&'static CStr> {
    struct Registered(bool);
    static DONE: OnceLock<Registered> = OnceLock::new();
    DONE.get_or_init(|| Registered(unsafe { register() }))
        .0
        .then_some(NAME)
}

unsafe fn register() -> bool {
    let base = ffi::sqlite3_vfs_find(std::ptr::null());
    if base.is_null() {
        return false;
    }
    BASE.store(base, Ordering::Release);
    // A copy of the base whose other calls take this VFS for theirs: the fields they read of it are the base's own.
    let mut vfs = *base;
    vfs.pNext = std::ptr::null_mut();
    vfs.zName = NAME.as_ptr();
    vfs.szOsFile = vfs.szOsFile.max(std::mem::size_of::<Held>() as c_int);
    vfs.xOpen = Some(x_open);
    let vfs = Box::leak(Box::new(vfs));
    ffi::sqlite3_vfs_register(vfs, 0) == ffi::SQLITE_OK
}

/// A journal open on the handle it was judged by.
#[repr(C)]
struct Held {
    base: ffi::sqlite3_file,
    file: *mut File,
}

unsafe extern "C" fn x_open(
    _vfs: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    file: *mut ffi::sqlite3_file,
    flags: c_int,
    out_flags: *mut c_int,
) -> c_int {
    let base = BASE.load(Ordering::Acquire);
    if flags & ffi::SQLITE_OPEN_MAIN_JOURNAL == 0 {
        return match (*base).xOpen {
            Some(open) => open(base, name, file, flags, out_flags),
            None => ffi::SQLITE_CANTOPEN,
        };
    }
    (*file).pMethods = std::ptr::null();
    if name.is_null() {
        return ffi::SQLITE_CANTOPEN;
    }
    let Ok(path) = CStr::from_ptr(name).to_str().map(PathBuf::from) else {
        return ffi::SQLITE_CANTOPEN;
    };
    let Beside::Judged(judged) = judge_beside(&path) else {
        return ffi::SQLITE_CANTOPEN;
    };
    let held = file as *mut Held;
    (*held).file = Box::into_raw(Box::new(judged));
    (*held).base.pMethods = &METHODS;
    if !out_flags.is_null() {
        *out_flags = ffi::SQLITE_OPEN_READONLY;
    }
    ffi::SQLITE_OK
}

static METHODS: ffi::sqlite3_io_methods = ffi::sqlite3_io_methods {
    iVersion: 1,
    xClose: Some(x_close),
    xRead: Some(x_read),
    xWrite: Some(x_write),
    xTruncate: Some(x_truncate),
    xSync: Some(x_sync),
    xFileSize: Some(x_file_size),
    xLock: Some(x_lock),
    xUnlock: Some(x_lock),
    xCheckReservedLock: Some(x_check_reserved_lock),
    xFileControl: Some(x_file_control),
    xSectorSize: Some(x_sector_size),
    xDeviceCharacteristics: Some(x_device_characteristics),
    xShmMap: None,
    xShmLock: None,
    xShmBarrier: None,
    xShmUnmap: None,
    xFetch: None,
    xUnfetch: None,
};

unsafe fn held<'a>(file: *mut ffi::sqlite3_file) -> Option<&'a File> {
    (*(file as *mut Held)).file.as_ref()
}

unsafe extern "C" fn x_close(file: *mut ffi::sqlite3_file) -> c_int {
    let held = file as *mut Held;
    if !(*held).file.is_null() {
        drop(Box::from_raw((*held).file));
        (*held).file = std::ptr::null_mut();
    }
    ffi::SQLITE_OK
}

fn read_at(file: &File, buf: &mut [u8], at: u64) -> std::io::Result<usize> {
    #[cfg(windows)]
    {
        std::os::windows::fs::FileExt::seek_read(file, buf, at)
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::FileExt::read_at(file, buf, at)
    }
    #[cfg(not(any(windows, unix)))]
    {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = file;
        f.seek(SeekFrom::Start(at))?;
        f.read(buf)
    }
}

unsafe extern "C" fn x_read(
    file: *mut ffi::sqlite3_file,
    buf: *mut c_void,
    amount: c_int,
    offset: ffi::sqlite3_int64,
) -> c_int {
    let Some(f) = held(file) else {
        return ffi::SQLITE_IOERR_READ;
    };
    let buf = std::slice::from_raw_parts_mut(buf as *mut u8, amount.max(0) as usize);
    let mut got = 0;
    while got < buf.len() {
        match read_at(f, &mut buf[got..], offset as u64 + got as u64) {
            Ok(0) => break,
            Ok(n) => got += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return ffi::SQLITE_IOERR_READ,
        }
    }
    if got < buf.len() {
        // SQLite's contract for a short read: the rest of the buffer zeroed.
        buf[got..].fill(0);
        return ffi::SQLITE_IOERR_SHORT_READ;
    }
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_write(
    _: *mut ffi::sqlite3_file,
    _: *const c_void,
    _: c_int,
    _: ffi::sqlite3_int64,
) -> c_int {
    ffi::SQLITE_IOERR_WRITE
}

unsafe extern "C" fn x_truncate(_: *mut ffi::sqlite3_file, _: ffi::sqlite3_int64) -> c_int {
    ffi::SQLITE_IOERR_TRUNCATE
}

unsafe extern "C" fn x_sync(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_IOERR_FSYNC
}

unsafe extern "C" fn x_file_size(
    file: *mut ffi::sqlite3_file,
    size: *mut ffi::sqlite3_int64,
) -> c_int {
    match held(file).map(|f| f.metadata()) {
        Some(Ok(m)) => {
            *size = m.len() as ffi::sqlite3_int64;
            ffi::SQLITE_OK
        }
        _ => ffi::SQLITE_IOERR_FSTAT,
    }
}

unsafe extern "C" fn x_lock(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_check_reserved_lock(_: *mut ffi::sqlite3_file, out: *mut c_int) -> c_int {
    *out = 0;
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_file_control(_: *mut ffi::sqlite3_file, _: c_int, _: *mut c_void) -> c_int {
    ffi::SQLITE_NOTFOUND
}

unsafe extern "C" fn x_sector_size(_: *mut ffi::sqlite3_file) -> c_int {
    4096
}

unsafe extern "C" fn x_device_characteristics(_: *mut ffi::sqlite3_file) -> c_int {
    0
}
