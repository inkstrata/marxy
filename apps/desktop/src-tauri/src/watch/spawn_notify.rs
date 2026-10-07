//! `notify` watcher threads: the flat folder watch for `watch::RootWatch`, and the recursive tree
//! watch for `watch_tree::TreeWatch` (C-05). Kept out of `mod.rs` so the core gate can
//! `rustc --test` the scan/diff implementation without linking this crate.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::watch::{RootWatch, RunningWatch, WatchEvent};
use crate::watch_tree::TreeWatch;

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

/// What the tree watcher's callback hands its loop: the paths one event named, and whether the OS
/// said it dropped or coalesced events so only a rescan of the whole root is safe.
type TreeSignal = (Vec<PathBuf>, bool);

/// How long the tree loop keeps gathering after the first event before it examines the paths: a
/// write-temp-then-rename reports two paths a moment apart and is one change.
const TREE_GATHER: Duration = Duration::from_millis(50);

/// Opens `root` as a tree, listens recursively with one `notify` watcher until `stop`, and forwards
/// non-empty batches to `emit`. Only the paths the OS reports are re-examined. A tree the scan
/// refuses or a watch the OS refuses (inotify's limit on Linux) is an `Err`, so the app can fall
/// back.
pub fn spawn_tree_thread<F>(root: PathBuf, mut emit: F) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
{
    let tree = TreeWatch::open(&root)?;
    let watch_root = tree.root().to_path_buf();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let (signal_tx, signal_rx) = mpsc::channel::<TreeSignal>();

    let (startup_tx, startup_rx) = mpsc::sync_channel(1);
    let join = thread::spawn(move || {
        let watcher: Result<RecommendedWatcher, String> = (|| {
            let mut watcher = RecommendedWatcher::new(
                move |res: notify::Result<Event>| {
                    let signal = match res {
                        Ok(event) => {
                            let rescan =
                                event.need_rescan() || matches!(event.kind, EventKind::Other);
                            if !rescan && matches!(event.kind, EventKind::Access(_)) {
                                return;
                            }
                            (event.paths, rescan)
                        }
                        // An error from the backend may mean events were lost.
                        Err(_) => (Vec::new(), true),
                    };
                    let _ = signal_tx.send(signal);
                },
                notify::Config::default(),
            )
            .map_err(|e| format!("{}: {e}", watch_root.display()))?;
            watcher
                .watch(&watch_root, RecursiveMode::Recursive)
                .map_err(|e| format!("{}: {e}", watch_root.display()))?;
            Ok(watcher)
        })();
        let watcher = match watcher {
            Ok(w) => w,
            Err(e) => {
                let _ = startup_tx.send(Err(e));
                return;
            }
        };
        let _ = startup_tx.send(Ok(()));

        let mut tree = tree;
        while !stop_clone.load(Ordering::SeqCst) {
            let first = match signal_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(signal) => signal,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let (mut paths, mut rescan) = first;
            let deadline = Instant::now() + TREE_GATHER;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                match signal_rx.recv_timeout(left) {
                    Ok((more, flag)) => {
                        paths.extend(more);
                        rescan |= flag;
                    }
                    Err(_) => break,
                }
            }
            if stop_clone.load(Ordering::SeqCst) {
                break;
            }
            let events = tree.apply(&paths, rescan);
            if !events.is_empty() {
                emit(events);
            }
        }
        drop(watcher);
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

        let (dir, open) = scratch("removed-root");
        let (tx, rx) = mpsc::channel::<Vec<crate::watch::WatchEvent>>();
        let mut running = spawn_poll_thread(dir.clone(), move |events| {
            let _ = tx.send(events);
        })
        .expect("spawn");
        // Losing the root reports the open file Removed (once: `remove_dir_all` deletes the file
        // before its directory, so a poll may land in between, and a poll after the root is gone
        // reports it too), then goes quiet. The loop must keep running so it can still be stopped.
        fs::remove_dir_all(&dir).expect("remove root");
        std::thread::sleep(Duration::from_millis(450));
        let seen: Vec<_> = rx.try_iter().flatten().collect();
        assert!(
            seen.iter()
                .all(|e| e.kind == WatchKind::Removed && e.path == open),
            "only the open file's removal is reported: {seen:?}"
        );
        assert_eq!(seen.len(), 1, "reported exactly once: {seen:?}");
        std::thread::sleep(Duration::from_millis(250));
        assert!(
            rx.try_recv().is_err(),
            "nothing further from a missing root"
        );
        running.stop();
    }
    #[test]
    fn tree_thread_reports_a_nested_file_then_stops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, _open) = scratch("tree-thread");
        fs::create_dir_all(dir.join("a/b")).expect("nested dirs");
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_tree_thread(dir.clone(), move |events| {
            let _ = tx.send(events);
        })
        .expect("spawn");
        std::thread::sleep(Duration::from_millis(70));
        let nested = dir.join("a/b/new.md");
        fs::write(&nested, b"# written three levels down\n").expect("write nested");
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut seen = Vec::new();
        while !seen
            .iter()
            .any(|e: &WatchEvent| e.kind == WatchKind::Created && e.path == nested)
        {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok(events) => seen.extend(events),
                Err(_) => panic!("no Created for the nested file within 2 s: {seen:?}"),
            }
        }
        running.stop();
        fs::write(dir.join("a/after.md"), b"after stop").expect("write after stop");
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "no events after stop"
        );
        cleanup(&dir);
    }

    #[test]
    fn tree_thread_refuses_a_root_that_is_not_a_directory() {
        let (dir, open) = scratch("tree-not-dir");
        assert!(spawn_tree_thread(open, |_| {}).is_err());
        assert!(spawn_tree_thread(dir.join("missing"), |_| {}).is_err());
        cleanup(&dir);
    }
    /// The resident-set cost of a 50,000-file tree watch (C-05 Risks). A measurement, not a gate:
    /// `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --ignored --nocapture rss`.
    #[test]
    #[ignore]
    fn rss_of_a_fifty_thousand_file_tree_watch() {
        fn rss_kib() -> u64 {
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
                .expect("ps");
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse()
                .expect("rss")
        }
        let (dir, _open) = scratch("tree-rss");
        for d in 0..500 {
            let sub = dir.join(format!("agent-{:02}/run-{d:03}", d % 20));
            fs::create_dir_all(&sub).expect("dir");
            for f in 0..100 {
                fs::write(sub.join(format!("artifact-{f:03}.md")), b"x").expect("seed");
            }
        }
        let before = rss_kib();
        let started = std::time::Instant::now();
        let mut running = spawn_tree_thread(dir.clone(), |_| {}).expect("spawn");
        let scan = started.elapsed();
        std::thread::sleep(Duration::from_millis(200));
        let after = rss_kib();
        eprintln!(
            "50,000-file tree watch: RSS {before} KiB -> {after} KiB (+{} KiB), open+scan {scan:?}",
            after.saturating_sub(before)
        );
        running.stop();
        cleanup(&dir);
    }
}
