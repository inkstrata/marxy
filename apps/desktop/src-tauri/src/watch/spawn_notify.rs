//! `notify` watcher threads: the flat folder watch for `watch::RootWatch`, and the recursive tree
//! watch for `watch_tree::TreeWatch`. Kept out of `mod.rs` so the core gate can
//! `rustc --test` the scan/diff implementation without linking this crate.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::watch::{canonical, RootWatch, RunningWatch, WatchEvent};
use crate::watch_tree::TreeWatch;

fn notify_worth_handling(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_) | EventKind::Other | EventKind::Any
    )
}

/// How often the flat watch scans its folder when `notify` says nothing. A signal scans at once; this is the net under
/// it, for what the OS does not report: a link retargeted into a folder not watched, an event the OS dropped. Each scan
/// lists the whole folder, so five a second cost a big folder or a share steady IO for as long as a document is open.
const FLAT_SAFETY_POLL: Duration = Duration::from_secs(2);

/// Runs `poll` (a scan and its diff) after every signal, folding the ones queued behind it into the same scan, and
/// once every `safety` without one, until `stop` or the senders are gone.
fn flat_loop(
    signal_rx: &mpsc::Receiver<()>,
    stop: &AtomicBool,
    safety: Duration,
    mut poll: impl FnMut(),
) {
    while !stop.load(Ordering::SeqCst) {
        match signal_rx.recv_timeout(safety) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                while signal_rx.try_recv().is_ok() {}
                poll();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
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
        flat_loop(&signal_rx, &stop_clone, FLAT_SAFETY_POLL, || {
            match watch.poll() {
                Ok(events) if !events.is_empty() => emit(events),
                Ok(_) => {}
                // A dead watch (e.g. the root was removed) otherwise retries silently
                // forever with no diagnostic ever reaching the app or its logs.
                Err(e) => eprintln!("marxy: file watch poll failed: {e}"),
            }
        });
        let _ = watchers;
    });
    match startup_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        _ => {
            // A thread still starting must not outlive the refusal.
            stop.store(true, Ordering::SeqCst);
            return Err("watch thread failed to start".into());
        }
    }
    Ok(RunningWatch::new(stop, join))
}

/// What the tree watcher's callback hands its loop: the paths one event named, and whether the OS
/// said it dropped or coalesced events so only a rescan of the whole root is safe.
type TreeSignal = (Vec<PathBuf>, bool);

/// The signal for one `notify` event, or none when it is of no interest. An event the OS flags as
/// lost or coalesced (`need_rescan`, `Other`) names the paths it covers (FSEvents' must-scan-subdirs
/// names the directory), and only those are rescanned; the whole root is rescanned only when the
/// event names no path at all.
fn tree_signal(event: Event) -> Option<TreeSignal> {
    let rescan = event.need_rescan() || matches!(event.kind, EventKind::Other);
    if !rescan && matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    let whole = rescan && event.paths.is_empty();
    Some((event.paths, whole))
}

/// How long the tree loop keeps gathering after the first event before it examines the paths: a
/// write-temp-then-rename reports two paths a moment apart and is one change.
const TREE_GATHER: Duration = Duration::from_millis(50);

/// The OS can drop events without saying so: ReadDirectoryChangesW's 16 KB buffer overflows in a burst, and `notify`
/// answers that by unwatching the root with only a log line. So the tree loop reconciles: when it is quiet after a
/// batch of `RECONCILE_BURST` paths or more, and every `RECONCILE_EVERY` it is quiet otherwise, it registers the watch
/// again (Windows) and rescans the whole tree. What the rescan finds goes out as any batch does, to the index; it
/// corrects the index and says nothing else.
const RECONCILE_EVERY: Duration = Duration::from_secs(60);
const RECONCILE_BURST: usize = 200;
/// A rescan that takes long is spaced out: never more than 1/50 of the time goes to reconciling.
const RECONCILE_SHARE: u32 = 50;

/// When the tree loop next reconciles.
#[derive(Debug)]
pub(crate) struct Reconcile {
    every: Duration,
    burst: usize,
    last: Instant,
    cost: Duration,
    owed: bool,
}

impl Reconcile {
    pub(crate) fn new(every: Duration, burst: usize, now: Instant, cost: Duration) -> Self {
        Self {
            every,
            burst,
            last: now,
            cost,
            owed: false,
        }
    }

    /// A batch was applied: `paths` reported, and `whole` when it rescanned the whole tree already.
    pub(crate) fn applied(&mut self, paths: usize, whole: bool, now: Instant) {
        if whole {
            self.last = now;
            self.owed = false;
        } else if paths >= self.burst {
            self.owed = true;
        }
    }

    /// Whether a quiet moment at `now` should reconcile.
    pub(crate) fn due(&self, now: Instant) -> bool {
        let every = self.every.max(self.cost * RECONCILE_SHARE);
        self.owed || now.duration_since(self.last) >= every
    }

    pub(crate) fn done(&mut self, now: Instant, cost: Duration) {
        self.last = now;
        self.cost = cost;
        self.owed = false;
    }
}

/// The hook a tuned tree watch runs on its thread right after the first scan, with the watcher and the root.
pub(crate) type AfterScan = Box<dyn FnOnce(&mut RecommendedWatcher, &Path) + Send>;

/// What a tree watch is started with; `spawn_tree_thread` uses the defaults.
pub(crate) struct TreeTuning {
    pub max_files: usize,
    pub reconcile_every: Duration,
    pub reconcile_burst: usize,
    /// A test changes the tree here, or lets go of the OS watch as `notify` does on an overflow.
    pub after_scan: AfterScan,
    /// Folders inside the root to leave out from the first scan on.
    pub ignore: Vec<PathBuf>,
}

/// Watches `root` as a tree with one recursive `notify` watcher until `stop`, and forwards non-empty
/// batches to `emit`. A tree that grows past `MAX_FILES` listed files after it opened ends the
/// watch: `refuse` is called once with the reason and nothing more is emitted. Only the paths the OS reports are re-examined. The watcher is registered
/// before the first scan and its signals queue meanwhile, so a change made while the tree is being
/// scanned is replayed through `apply` afterwards (the diff makes a replay of something the scan
/// already saw harmless). A tree the scan refuses, or a watch the OS refuses (inotify's limit on
/// Linux), is an `Err`, so the app can fall back.
#[cfg(test)]
pub fn spawn_tree_thread<F, R>(root: PathBuf, emit: F, refuse: R) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
    R: FnOnce(String) + Send + 'static,
{
    spawn_tree_thread_ignoring(root, Vec::new(), emit, refuse)
}

/// `spawn_tree_thread` leaving out `ignore`, folders inside `root` (others are dropped). The running watch takes a
/// new list through `RunningWatch::set_ignore`.
pub fn spawn_tree_thread_ignoring<F, R>(
    root: PathBuf,
    ignore: Vec<PathBuf>,
    emit: F,
    refuse: R,
) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
    R: FnOnce(String) + Send + 'static,
{
    spawn_tree_thread_tuned(
        root,
        emit,
        refuse,
        TreeTuning {
            max_files: crate::watch_tree::MAX_FILES,
            reconcile_every: RECONCILE_EVERY,
            reconcile_burst: RECONCILE_BURST,
            after_scan: Box::new(|_, _| {}),
            ignore,
        },
    )
}

/// `spawn_tree_thread` with the file limit as an argument, and a hook run on the watch thread right after the first scan, so a test can
/// change the tree between the watcher's registration and the end of the scan.
#[cfg(test)]
pub(crate) fn spawn_tree_thread_with<F, R, H>(
    root: PathBuf,
    emit: F,
    refuse: R,
    max_files: usize,
    after_scan: H,
) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
    R: FnOnce(String) + Send + 'static,
    H: FnOnce() + Send + 'static,
{
    spawn_tree_thread_tuned(
        root,
        emit,
        refuse,
        TreeTuning {
            max_files,
            reconcile_every: RECONCILE_EVERY,
            reconcile_burst: RECONCILE_BURST,
            after_scan: Box::new(move |_, _| after_scan()),
            ignore: Vec::new(),
        },
    )
}

pub(crate) fn spawn_tree_thread_tuned<F, R>(
    root: PathBuf,
    mut emit: F,
    refuse: R,
    tuning: TreeTuning,
) -> Result<RunningWatch, String>
where
    F: FnMut(Vec<WatchEvent>) + Send + 'static,
    R: FnOnce(String) + Send + 'static,
{
    let TreeTuning {
        max_files,
        reconcile_every,
        reconcile_burst,
        after_scan,
        ignore,
    } = tuning;
    let watch_root = canonical(&root).map_err(|e| format!("{}: {e}", root.display()))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let (signal_tx, signal_rx) = mpsc::channel::<TreeSignal>();
    // A new list waits here and a no-op signal wakes the loop to take it.
    let new_ignore: Arc<Mutex<Option<Vec<PathBuf>>>> = Arc::new(Mutex::new(None));
    let control = {
        let (tx, slot) = (signal_tx.clone(), new_ignore.clone());
        move |list: Vec<PathBuf>| {
            if let Ok(mut slot) = slot.lock() {
                *slot = Some(list);
            }
            let _ = tx.send((Vec::new(), false));
        }
    };

    // Two messages: the watcher is registered (bounded wait), then the scan's result (a scan always
    // ends, so that wait is not bounded; a 200,000-file scan can outlast any fixed timeout).
    let (startup_tx, startup_rx) = mpsc::sync_channel::<Result<(), String>>(2);
    let join = thread::spawn(move || {
        let watcher: Result<RecommendedWatcher, String> = (|| {
            let mut watcher = RecommendedWatcher::new(
                move |res: notify::Result<Event>| {
                    let signal = match res {
                        Ok(event) => match tree_signal(event) {
                            Some(signal) => signal,
                            None => return,
                        },
                        // An error from the backend may mean events were lost, and says where not.
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
        let mut watcher = match watcher {
            Ok(w) => w,
            Err(e) => {
                let _ = startup_tx.send(Err(e));
                return;
            }
        };
        if startup_tx.send(Ok(())).is_err() || stop_clone.load(Ordering::SeqCst) {
            return;
        }
        let scanned = Instant::now();
        let mut tree = match TreeWatch::open_limited(&watch_root, max_files, &ignore) {
            Ok(tree) => tree,
            Err(e) => {
                let _ = startup_tx.send(Err(e));
                return;
            }
        };
        let mut reconcile = Reconcile::new(
            reconcile_every,
            reconcile_burst,
            Instant::now(),
            scanned.elapsed(),
        );
        after_scan(&mut watcher, &watch_root);
        let _ = startup_tx.send(Ok(()));

        while !stop_clone.load(Ordering::SeqCst) {
            let first = match signal_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(signal) => signal,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !reconcile.due(Instant::now()) {
                        continue;
                    }
                    // A watch `notify` let go of is registered again before the rescan, so nothing after the rescan
                    // goes missing. Only Windows' backend drops a watch silently.
                    #[cfg(windows)]
                    {
                        let _ = watcher.unwatch(&watch_root);
                        let _ = watcher.watch(&watch_root, RecursiveMode::Recursive);
                    }
                    let started = Instant::now();
                    let result = tree.apply(&[], true);
                    reconcile.done(Instant::now(), started.elapsed());
                    match result {
                        Ok(events) if !events.is_empty() => emit(events),
                        Ok(_) => {}
                        Err(reason) => {
                            drop(watcher);
                            drop(tree);
                            refuse(reason);
                            return;
                        }
                    }
                    continue;
                }
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
            let told = new_ignore.lock().ok().and_then(|mut slot| slot.take());
            if let Some(list) = told {
                match tree.set_ignored(&list) {
                    Ok(events) if !events.is_empty() => emit(events),
                    Ok(_) => {}
                    Err(reason) => {
                        drop(watcher);
                        drop(tree);
                        refuse(reason);
                        return;
                    }
                }
            }
            reconcile.applied(tree.countable(&paths), rescan, Instant::now());
            match tree.apply(&paths, rescan) {
                Ok(events) if !events.is_empty() => emit(events),
                Ok(_) => {}
                Err(reason) => {
                    // Past the limit: let go of the OS watch and the snapshot, and say so once.
                    drop(watcher);
                    drop(tree);
                    refuse(reason);
                    return;
                }
            }
        }
        drop(watcher);
    });
    let started = match startup_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => startup_rx
            .recv()
            .unwrap_or_else(|_| Err("watch thread failed to start".into())),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("watch thread failed to start".into()),
    };
    if let Err(e) = started {
        // A watcher still registering, or a thread past its startup, must not outlive the refusal.
        stop.store(true, Ordering::SeqCst);
        return Err(e);
    }
    Ok(RunningWatch::new(stop, join).with_ignore(control))
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
        let dir = canonical(&dir).expect("canonicalize scratch");
        let open = dir.join("open.md");
        fs::write(&open, b"# open\n\nbody\n").expect("seed");
        (dir, open)
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// an idle folder is not rescanned five times a second; a signal still scans at once.
    #[test]
    fn the_flat_loop_scans_on_a_signal_and_rarely_when_idle() {
        use std::sync::atomic::AtomicUsize;
        let scans = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel();
        let (counted, halt) = (scans.clone(), stop.clone());
        let join = thread::spawn(move || {
            flat_loop(&rx, &halt, FLAT_SAFETY_POLL, || {
                counted.fetch_add(1, Ordering::SeqCst);
            })
        });
        thread::sleep(Duration::from_millis(1000));
        assert!(
            scans.load(Ordering::SeqCst) <= 1,
            "{} scans in an idle second",
            scans.load(Ordering::SeqCst)
        );
        let before = scans.load(Ordering::SeqCst);
        tx.send(()).expect("signal");
        let t0 = Instant::now();
        while scans.load(Ordering::SeqCst) == before && t0.elapsed() < Duration::from_secs(1) {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            scans.load(Ordering::SeqCst),
            before + 1,
            "a signal scans at once"
        );
        stop.store(true, Ordering::SeqCst);
        drop(tx);
        join.join().expect("loop");
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
    /// A running tree watch told to leave a folder out reports nothing from it; told to stop leaving it out, it reads the
    /// folder and reports its files created.
    #[test]
    fn a_tree_thread_leaves_a_folder_out_and_takes_it_back_when_told() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, _open) = scratch("tree-ignore");
        let out = dir.join("gen-out");
        fs::create_dir_all(&out).expect("folder");
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_tree_thread_ignoring(
            dir.clone(),
            vec![out.clone()],
            move |events| {
                let _ = tx.send(events);
            },
            |_| {},
        )
        .expect("spawn");
        let wait_for = |path: &Path| -> Vec<WatchEvent> {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut seen = Vec::new();
            while !seen
                .iter()
                .any(|e: &WatchEvent| e.kind == WatchKind::Created && e.path == path)
            {
                let left = deadline.saturating_duration_since(Instant::now());
                match rx.recv_timeout(left) {
                    Ok(events) => seen.extend(events),
                    Err(_) => panic!("no Created for {} in 5 s: {seen:?}", path.display()),
                }
            }
            seen
        };
        // The write inside the folder comes first; the sentinel after it proves the batch holding it was handled.
        fs::write(out.join("a.js"), b"a").expect("write");
        let sentinel = dir.join("sentinel.md");
        fs::write(&sentinel, b"s").expect("write");
        let seen = wait_for(&sentinel);
        assert!(
            seen.iter().all(|e| !e.path.starts_with(&out)),
            "nothing from the folder: {seen:?}"
        );
        assert!(running.set_ignore(Vec::new()));
        let seen = wait_for(&out.join("a.js"));
        assert!(seen.iter().all(|e| e.kind == WatchKind::Created));
        running.stop();
        cleanup(&dir);
    }

    #[test]
    fn tree_thread_reports_a_nested_file_then_stops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, _open) = scratch("tree-thread");
        fs::create_dir_all(dir.join("a/b")).expect("nested dirs");
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_tree_thread(
            dir.clone(),
            move |events| {
                let _ = tx.send(events);
            },
            |_| {},
        )
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
    fn tree_thread_reports_a_change_made_while_the_first_scan_ran() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, open) = scratch("tree-scan-gap");
        let made = dir.join("a/b/during-scan.md");
        let hook_made = made.clone();
        let hook_open = open.clone();
        let (tx, rx) = mpsc::channel();
        let mut running = spawn_tree_thread_with(
            dir.clone(),
            move |events| {
                let _ = tx.send(events);
            },
            |_| {},
            crate::watch_tree::MAX_FILES,
            move || {
                // A slow scan: the change lands after the scan read the tree, and the scan goes on
                // for a while after it, so only a watcher registered before the scan reports it.
                std::thread::sleep(Duration::from_millis(100));
                fs::create_dir_all(hook_made.parent().unwrap()).expect("dirs");
                fs::write(&hook_made, b"written during the scan").expect("write");
                fs::remove_file(&hook_open).expect("remove");
                std::thread::sleep(Duration::from_millis(500));
            },
        )
        .expect("spawn");
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut seen: Vec<WatchEvent> = Vec::new();
        let done = |seen: &[WatchEvent]| {
            seen.iter()
                .any(|e| e.kind == WatchKind::Created && e.path == made)
                && seen
                    .iter()
                    .any(|e| e.kind == WatchKind::Removed && e.path == open)
        };
        while !done(&seen) {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok(events) => seen.extend(events),
                Err(_) => panic!("changes made during the scan not reported within 2 s: {seen:?}"),
            }
        }
        running.stop();
        cleanup(&dir);
    }

    #[test]
    fn tree_thread_that_outgrows_its_limit_refuses_once_and_goes_quiet() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (dir, _open) = scratch("tree-outgrows");
        let (tx, rx) = mpsc::channel::<Vec<WatchEvent>>();
        let (refused_tx, refused_rx) = mpsc::channel::<String>();
        // `open.md` is the one file; a limit of three.
        let mut running = spawn_tree_thread_with(
            dir.clone(),
            move |events| {
                let _ = tx.send(events);
            },
            move |reason| {
                let _ = refused_tx.send(reason);
            },
            3,
            || {},
        )
        .expect("spawn");
        std::thread::sleep(Duration::from_millis(70));
        for name in ["a.md", "b.md", "c.md", "d.md"] {
            fs::write(dir.join(name), b"x").expect("write");
        }
        let reason = refused_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("refused within 5 s");
        assert_eq!(reason, crate::watch_tree::TOO_MANY);
        fs::write(dir.join("e.md"), b"x").expect("write after refusal");
        assert!(
            refused_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "refused once"
        );
        let seen: Vec<_> = rx.try_iter().flatten().collect();
        assert!(
            seen.iter().all(|e| e.path != dir.join("e.md")),
            "nothing after the refusal: {seen:?}"
        );
        running.stop();
        cleanup(&dir);
    }

    #[test]
    fn a_rescan_flag_with_paths_rescans_only_those_paths() {
        use notify::event::{Flag, ModifyKind};
        let sub = PathBuf::from("/r/sub");
        let flagged = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(sub.clone())
            .set_flag(Flag::Rescan);
        assert_eq!(tree_signal(flagged), Some((vec![sub.clone()], false)));
        let other = Event::new(EventKind::Other).add_path(sub.clone());
        assert_eq!(tree_signal(other), Some((vec![sub], false)));
    }

    #[test]
    fn a_rescan_flag_with_no_path_rescans_the_whole_root() {
        use notify::event::Flag;
        let flagged = Event::new(EventKind::Other).set_flag(Flag::Rescan);
        assert_eq!(tree_signal(flagged), Some((Vec::new(), true)));
        let access = Event::new(EventKind::Access(notify::event::AccessKind::Any))
            .add_path(PathBuf::from("/r/x"));
        assert_eq!(tree_signal(access), None);
    }

    /// `notify` unwatching the root after an overflow, as its Windows backend does with only a log line: the change
    /// made after it still reaches the index by the reconcile, and on Windows the watch is registered again, so the
    /// next change is reported at once rather than at the next reconcile.
    #[test]
    fn a_watch_the_os_let_go_of_is_reconciled_and_registered_again() {
        use std::sync::mpsc;

        let (dir, _open) = scratch("tree-reconcile");
        let (tx, rx) = mpsc::channel::<Vec<WatchEvent>>();
        let every = Duration::from_secs(2);
        let mut running = spawn_tree_thread_tuned(
            dir.clone(),
            move |events| {
                let _ = tx.send(events);
            },
            |_| {},
            TreeTuning {
                max_files: crate::watch_tree::MAX_FILES,
                reconcile_every: every,
                reconcile_burst: RECONCILE_BURST,
                after_scan: Box::new(|watcher, root| {
                    watcher.unwatch(root).expect("let go of the OS watch");
                }),
                ignore: Vec::new(),
            },
        )
        .expect("spawn");
        let lost = dir.join("lost.md");
        fs::write(&lost, b"written while nothing watched").expect("write");
        let wait_for = |path: &Path, within: Duration| -> bool {
            let deadline = Instant::now() + within;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                match rx.recv_timeout(left) {
                    Ok(events)
                        if events
                            .iter()
                            .any(|e| e.kind == WatchKind::Created && e.path == path) =>
                    {
                        return true
                    }
                    Ok(_) => {}
                    Err(_) => return false,
                }
            }
        };
        assert!(
            wait_for(&lost, every * 3),
            "the change made while the OS watch was gone never reached the index"
        );
        if cfg!(windows) {
            let next = dir.join("next.md");
            fs::write(&next, b"after the reconcile").expect("write");
            assert!(
                wait_for(&next, Duration::from_millis(1500)),
                "the watch was not registered again"
            );
        }
        running.stop();
        cleanup(&dir);
    }

    #[test]
    fn a_reconcile_is_owed_after_a_burst_and_due_on_its_timer_spaced_by_its_cost() {
        let t0 = Instant::now();
        let mut r = Reconcile::new(Duration::from_secs(60), 200, t0, Duration::from_millis(10));
        assert!(!r.due(t0 + Duration::from_secs(1)));
        r.applied(199, false, t0);
        assert!(
            !r.due(t0 + Duration::from_secs(1)),
            "a batch under the burst"
        );
        r.applied(200, false, t0);
        assert!(r.due(t0 + Duration::from_secs(1)), "owed after a burst");
        r.done(t0 + Duration::from_secs(1), Duration::from_millis(10));
        assert!(!r.due(t0 + Duration::from_secs(2)));
        assert!(r.due(t0 + Duration::from_secs(61)), "due on its timer");
        r.applied(3, true, t0 + Duration::from_secs(61));
        assert!(
            !r.due(t0 + Duration::from_secs(62)),
            "a whole rescan counts as one"
        );
        // A tree that takes 4 s to rescan is reconciled every 200 s, not every 60.
        r.done(t0, Duration::from_secs(4));
        assert!(!r.due(t0 + Duration::from_secs(100)));
        assert!(r.due(t0 + Duration::from_secs(200)));
    }

    #[test]
    fn tree_thread_refuses_a_root_that_is_not_a_directory() {
        let (dir, open) = scratch("tree-not-dir");
        assert!(spawn_tree_thread(open, |_| {}, |_| {}).is_err());
        assert!(spawn_tree_thread(dir.join("missing"), |_| {}, |_| {}).is_err());
        cleanup(&dir);
    }
    /// The resident-set cost of a 50,000-file tree watch. A measurement, not a gate:
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
        let mut running = spawn_tree_thread(dir.clone(), |_| {}, |_| {}).expect("spawn");
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
