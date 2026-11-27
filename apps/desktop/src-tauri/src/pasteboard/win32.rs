//! The Windows clipboard through Win32. Only this file is Windows-only.
//!
//! A command opens the clipboard once and keeps it open until it is done; while it is open no other
//! app can change it, so the open clipboard is the snapshot: the format list, the concealed check
//! and every read of one command see the same copy. The format list is not a data read;
//! `GetClipboardData` is, and it runs only for the types `pasteboard_read` was asked for. Nothing
//! here watches the clipboard (no listener, no sequence-number polling).
//!
//! `with_general` runs the commands on a thread of their own that owns no window: `OpenClipboard`
//! with no owner, as the clipboard plugin does, and no sent message (another app's delayed
//! rendering) can re-enter the main thread's windows while a read waits. The main thread waits for
//! it three seconds at most, since that app may never answer. A format's size is checked before it
//! is copied, so an oversized one costs nothing, and at most `MAX_FORMATS` formats are listed.

use std::rc::Rc;
use std::time::Duration;

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardFormatNameW, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows_core::PCWSTR;

use super::win_types::{decode, format_for, list, plan_write, raw_cap, Format};
use super::{Pasteboard, PasteboardError, Snapshot, Taken, CAP};

/// Another app holding the clipboard holds it for milliseconds; these tries wait about a third of a
/// second in all before giving up.
const OPEN_TRIES: u32 = 10;

/// The clipboard, open on this thread; closed when the last holder drops it.
struct Open;

impl Open {
    fn new() -> Result<Self, PasteboardError> {
        let mut wait = Duration::from_millis(2);
        for _ in 0..OPEN_TRIES {
            // SAFETY: no owner window; the clipboard is closed by `Drop` on this same thread.
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Open);
            }
            std::thread::sleep(wait);
            wait = (wait * 2).min(Duration::from_millis(80));
        }
        Err(PasteboardError::Native(
            "another app is holding the clipboard; try again".into(),
        ))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: this thread opened the clipboard in `Open::new`.
        let _ = unsafe { CloseClipboard() };
    }
}

pub struct General {
    open: Rc<Open>,
}

impl General {
    /// Opens the clipboard for the length of one command, retrying while another app holds it.
    pub fn open() -> Result<Self, PasteboardError> {
        Ok(Self {
            open: Rc::new(Open::new()?),
        })
    }
}

/// The formats on the clipboard as this command found it, with the pasteboard type each lists as.
struct Held {
    _open: Rc<Open>,
    formats: Vec<(u32, String)>,
}

impl Snapshot for Held {
    fn item_types(&self) -> Vec<Vec<String>> {
        if self.formats.is_empty() {
            return Vec::new();
        }
        vec![self.formats.iter().map(|(_, ty)| ty.clone()).collect()]
    }

    fn read(&self, ty: &str) -> Option<Vec<u8>> {
        match self.read_capped(ty, CAP)? {
            Taken::Bytes(bytes) => Some(bytes),
            Taken::Over(_) => None,
        }
    }

    fn read_capped(&self, ty: &str, cap: usize) -> Option<Taken> {
        let (_, body) = format_for(ty)?;
        let id = self.formats.iter().find(|(_, t)| t == ty)?.0;
        match read_global(id, raw_cap(body, cap))? {
            Taken::Bytes(raw) => decode(body, &raw).map(Taken::Bytes),
            over => Some(over),
        }
    }
}

/// The formats on the open clipboard, in the order the source app put them there (`list`).
fn formats() -> Vec<(u32, String)> {
    let mut id = 0;
    let ids = std::iter::from_fn(|| {
        // SAFETY: the clipboard is open on this thread.
        id = unsafe { EnumClipboardFormats(id) };
        (id != 0).then_some(id)
    });
    list(ids.map(|id| (id, (id >= 0xC000).then(|| format_name(id)).flatten())))
}

fn format_name(id: u32) -> Option<String> {
    let mut buf = [0u16; 256];
    // SAFETY: the buffer outlives the call, which writes at most its length.
    let n = unsafe { GetClipboardFormatNameW(id, &mut buf) };
    (n > 0).then(|| String::from_utf16_lossy(&buf[..n as usize]))
}

/// The bytes of one format's global memory, or `Over(size)` when it holds more than `max`, sized
/// before anything is copied. The one data read.
fn read_global(id: u32, max: usize) -> Option<Taken> {
    // SAFETY: the clipboard is open on this thread, and the handle stays valid until it is closed;
    // the lock is released before returning.
    unsafe {
        let mem = HGLOBAL(GetClipboardData(id).ok()?.0);
        let size = GlobalSize(mem);
        if size > max {
            return Some(Taken::Over(size));
        }
        let ptr = GlobalLock(mem);
        if ptr.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(ptr.cast::<u8>(), size).to_vec();
        let _ = GlobalUnlock(mem);
        Some(Taken::Bytes(bytes))
    }
}

/// Global memory this side still owns; freed on drop unless the clipboard took it.
struct Global(Option<HGLOBAL>);

impl Global {
    fn with(bytes: &[u8]) -> Result<Self, PasteboardError> {
        let fail = |e: windows_core::Error| PasteboardError::Native(format!("out of memory: {e}"));
        // SAFETY: a fresh allocation of `bytes.len()` (at least 1), locked only to fill it.
        unsafe {
            let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).map_err(fail)?;
            let global = Global(Some(mem));
            let ptr = GlobalLock(mem);
            if ptr.is_null() {
                return Err(PasteboardError::Native("could not lock memory".into()));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.cast::<u8>(), bytes.len());
            let _ = GlobalUnlock(mem);
            Ok(global)
        }
    }
}

impl Drop for Global {
    fn drop(&mut self) {
        if let Some(mem) = self.0.take() {
            // SAFETY: ours, never handed to the clipboard.
            let _ = unsafe { GlobalFree(Some(mem)) };
        }
    }
}

fn format_id(format: Format) -> Result<u32, PasteboardError> {
    match format {
        Format::Standard(id) => Ok(id),
        Format::Registered(name) => {
            let wide: Vec<u16> = name.encode_utf16().chain([0]).collect();
            // SAFETY: a NUL-terminated name that outlives the call.
            match unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) } {
                0 => Err(PasteboardError::Native(format!(
                    "could not register {name}"
                ))),
                id => Ok(id),
            }
        }
    }
}

impl Pasteboard for General {
    fn snapshot(&self) -> Box<dyn Snapshot> {
        Box::new(Held {
            _open: Rc::clone(&self.open),
            formats: formats(),
        })
    }

    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError> {
        // Every format is built first, so a failure here leaves the reader's clipboard as it was.
        let mut parts = Vec::new();
        for (format, bytes) in plan_write(reps)? {
            parts.push((format_id(format)?, Global::with(&bytes)?));
        }
        // SAFETY: the clipboard is open on this thread.
        unsafe { EmptyClipboard() }
            .map_err(|e| PasteboardError::Native(format!("could not clear the clipboard: {e}")))?;
        for (i, (id, mut global)) in parts.into_iter().enumerate() {
            let mem = global.0.expect("unset only once handed over");
            // SAFETY: the clipboard is open and was emptied by this thread; on success the system
            // owns the memory, so it is released from `global` and not freed here.
            match unsafe { SetClipboardData(id, Some(HANDLE(mem.0))) } {
                Ok(_) => global.0 = None,
                Err(e) => {
                    return Err(PasteboardError::Native(if i == 0 {
                        format!("the clipboard refused the copy; it is now empty: {e}")
                    } else {
                        format!("the clipboard took only part of the copy: {e}")
                    }))
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pasteboard::{read_reps, read_types, write_reps, CONCEALED, HTML, RTF, TEXT};

    /// Writes the real clipboard: text, HTML and RTF as one copy, then reads each back exactly, and
    /// a transient write lists as concealed (its exclusion marker is the one a read refuses). The
    /// clipboard's text, HTML and RTF are saved first and put back after; a concealed clipboard is
    /// neither read nor replaced. Ignored because it replaces the reader's clipboard and needs an
    /// interactive desktop (a service session has no clipboard). Run it from a desktop session:
    /// `cargo test -- --ignored clipboard_live`.
    #[test]
    #[ignore = "writes the real clipboard; run on a Windows desktop: cargo test -- --ignored clipboard_live"]
    fn clipboard_live() {
        let all = [TEXT.to_string(), HTML.to_string(), RTF.to_string()];
        let saved = {
            let pb = General::open().expect("open");
            let before = read_types(&pb);
            println!("types before: {before:?}");
            if before.iter().any(|t| t == CONCEALED) {
                println!(
                    "skipped: the clipboard holds a concealed item; it was not read or replaced"
                );
                return;
            }
            read_reps(&pb, &all).expect("save").reps
        };

        let plain = "Marxy live check: plain é 🙂";
        let html = "<p>Marxy live check: <b>html</b> é</p>";
        let rtf = "{\\rtf1\\ansi Marxy live check: {\\b rtf}}";
        let result = (|| {
            {
                let mut pb = General::open()?;
                write_reps(
                    &mut pb,
                    &[
                        (TEXT.to_string(), plain.as_bytes().to_vec()),
                        (HTML.to_string(), html.as_bytes().to_vec()),
                        (RTF.to_string(), rtf.as_bytes().to_vec()),
                    ],
                    false,
                )?;
            }
            let pb = General::open()?;
            let types = read_types(&pb);
            let got = read_reps(&pb, &all)?.reps;
            drop(pb);
            {
                let mut pb = General::open()?;
                write_reps(&mut pb, &[(TEXT.to_string(), b"transient".to_vec())], true)?;
            }
            let pb = General::open()?;
            let transient_types = read_types(&pb);
            let transient_read = read_reps(&pb, &all);
            Ok::<_, PasteboardError>((types, got, transient_types, transient_read))
        })();

        // Put the reader's clipboard back before asserting anything.
        {
            let mut pb = General::open().expect("open to restore");
            if saved.is_empty() {
                // SAFETY: open on this thread.
                let _ = unsafe { EmptyClipboard() };
            } else if let Err(e) = pb.write_item(&saved) {
                println!("could not restore the clipboard: {e:?}");
            }
        }

        let (types, got, transient_types, transient_read) = result.expect("live write and read");
        println!("types after write: {types:?}");
        assert!(types.starts_with(&[TEXT.to_string(), HTML.to_string(), RTF.to_string()]));
        let html_back = String::from_utf8(got[1].1.clone()).unwrap();
        assert_eq!(got[0], (TEXT.to_string(), plain.as_bytes().to_vec()));
        assert!(html_back.contains(&format!("<!--StartFragment-->{html}<!--EndFragment-->")));
        assert_eq!(got[2], (RTF.to_string(), rtf.as_bytes().to_vec()));
        println!("transient types: {transient_types:?}");
        assert!(transient_types.contains(&CONCEALED.to_string()));
        assert_eq!(transient_read, Err(PasteboardError::Concealed));
    }
}
