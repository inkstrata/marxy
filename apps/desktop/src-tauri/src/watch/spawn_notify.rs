//! `notify` watcher thread for `watch::RootWatch`; kept out of `mod.rs` so the core gate can
//! `rustc --test` the scan/diff implementation without linking this crate.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::watch::{RootWatch, RunningWatch, WatchEvent};

fn notify_worth_handling(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_) | EventKind::Other | EventKind::Any
    )
}

/// Opens `root`, listens with `notify` until `stop`, and forwards non-empty batches to `emit`.
pub fn spawn_poll_thread<F>(root: PathBuf, mut emit: F) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
{
    let watch = RootWatch::open(&root)?;
    let roots = watch.roots.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let (signal_tx, signal_rx) = mpsc::channel();

    let (startup_tx, startup_rx) = mpsc::sync_channel(1);
    let join = thread::spawn(move || {
        let watchers: Result<Vec<RecommendedWatcher>, String> = (|| {
            let mut out = Vec::new();
            for watch_root in &roots {
                let signal_tx = signal_tx.clone();
                let root = watch_root.clone();
                let mut watcher = RecommendedWatcher::new(
                    move |res: notify::Result<Event>| {
                        if let Ok(event) = res {
                            if event.paths.iter().any(|p| p.starts_with(&root))
                                && notify_worth_handling(&event.kind)
                            {
                                let _ = signal_tx.send(());
                            }
                        }
                    },
                    notify::Config::default(),
                )
                .map_err(|e| format!("{}: {e}", watch_root.display()))?;
                watcher
                    .watch(watch_root, RecursiveMode::NonRecursive)
                    .map_err(|e| format!("{}: {e}", watch_root.display()))?;
                out.push(watcher);
            }
            Ok(out)
        })();
        let watchers = match watchers {
            Ok(w) => w,
            Err(e) => {
                let _ = startup_tx.send(Err(e));
                return;
            }
        };
        let _ = startup_tx.send(Ok(()));

        let mut watch = watch;
        while !stop_clone.load(Ordering::SeqCst) {
            match signal_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => {
                    if stop_clone.load(Ordering::SeqCst) {
                        break;
                    }
                    while signal_rx.try_recv().is_ok() {}
                    match watch.poll() {
                        Ok(events) if !events.is_empty() => emit(events),
                        Ok(_) => {}
                        // A dead watch (e.g. the root was removed) otherwise retries silently
                        // forever with no diagnostic ever reaching the app or its logs.
                        Err(e) => eprintln!("marxy: file watch poll failed: {e}"),
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let _ = watchers;
    });
    match startup_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        _ => return Err("watch thread failed to start".into()),
    }
    Ok(RunningWatch::new(stop, join))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::WatchKind;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn scratch(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("marxy-34-watch-{name}-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        let dir = fs::canonicalize(&dir).expect("canonicalize scratch");
        let open = dir.join("open.md");
        fs::write(&open, b"# open\n\nbody\n").expect("seed");
        (dir, open)
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn poll_thread_emits_modified_then_stops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, open) = scratch("thread");
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_poll_thread(dir.clone(), move |events| {
            let _ = tx.send(events);
        })
        .expect("spawn");
        std::thread::sleep(Duration::from_millis(70));
        fs::write(&open, b"# open\n\nrewritten on disk\n").expect("write");
        let events = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("modified within 2 s");
        assert!(
            events
                .iter()
                .any(|e| e.kind == WatchKind::Modified && e.path == open),
            "{events:?}"
        );
        running.stop();
        fs::write(&open, b"# open\n\nagain\n").expect("write again");
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "no events after stop"
        );
        cleanup(&dir);
    }

    #[test]
    fn poll_thread_survives_and_still_stops_after_its_root_is_removed() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, _open) = scratch("removed-root");
        let (tx, rx) = mpsc::channel::<Vec<crate::watch::WatchEvent>>();
        let mut running = spawn_poll_thread(dir.clone(), move |events| {
            let _ = tx.send(events);
        })
        .expect("spawn");
        // The root vanishing makes every poll() fail from here on (fs::read_dir on a missing
        // path); the thread must keep its poll loop running rather than panic or hang, so it can
        // still be stopped and so a later re-watch of a re-created root is possible.
        fs::remove_dir_all(&dir).expect("remove root");
        // remove_dir_all deletes the children before the directory, so a poll may legitimately
        // land in between and report the children as removed (inotify on Linux does this
        // reliably). Let that settle and drain it; only events after the root is gone are spurious.
        std::thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            rx.try_recv().is_err(),
            "no spurious events from a missing root"
        );
        running.stop();
    }
}
