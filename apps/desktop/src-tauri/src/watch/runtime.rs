//! Polling thread that diffs a watched root and delivers batches to a callback.

use super::{RootWatch, WatchEvent, WatchKind};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

const POLL_MS: u64 = 50;

pub fn watch_kind_name(kind: WatchKind) -> &'static str {
    match kind {
        WatchKind::Modified => "modified",
        WatchKind::Created => "created",
        WatchKind::Removed => "removed",
        WatchKind::Renamed => "renamed",
    }
}

/// Stops the polling loop when dropped or when `stop` is called.
pub struct RunningWatch {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl RunningWatch {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Opens `root`, polls until `stop`, and forwards non-empty batches to `emit`.
pub fn spawn_poll_thread<F>(root: PathBuf, mut emit: F) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
{
    let mut watch = RootWatch::open(&root)?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let join = thread::spawn(move || {
        while !stop_clone.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(POLL_MS));
            if stop_clone.load(Ordering::SeqCst) {
                break;
            }
            match watch.poll() {
                Ok(events) if !events.is_empty() => emit(events),
                Ok(_) => {}
                Err(_) => {}
            }
        }
    });
    Ok(RunningWatch {
        stop,
        join: Some(join),
    })
}
