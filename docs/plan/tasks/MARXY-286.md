---
key: MARXY-286
design: [08-position-and-watching]
depends: []
verify: [pnpm precheck, pnpm done MARXY-286]
---
# MARXY-286 — Fix the file watcher's canonicalize-mismatch leak and its executor-blocking start/stop

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** Unwatching a deleted or renamed directory always stops its watcher thread, and starting or stopping a watch never blocks the async IPC executor for other concurrent watch calls.

## Why
Two related bugs in the Rust file watcher (`main.rs`, `watch/spawn_notify.rs`): (1) `unwatch_root` re-canonicalizes the root to find its table entry, but falls back to the raw, non-canonical string when `canonicalize()` fails (the directory was deleted or renamed) — `watch_root` always stored the entry under the canonical key, so the lookup can miss, `entry.running.stop()` is never called, and the notify thread leaks for the rest of the process. (2) `unwatch_root` holds the global watch-table `Mutex` while calling `entry.running.stop()`, which joins the watcher thread (up to ~200ms), inside an `async` Tauri command with no `.await` — stalling any concurrent watch/unwatch call; and `watch_root`'s `spawn_poll_thread` blocks synchronously on a 10s `recv_timeout` inside that same async, never-yielding command, so a stalled watcher start-up (e.g. exhausted OS inotify watches) can block the IPC executor thread for up to 10 seconds.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs`: key the watch table so `unwatch_root` can find and stop a watcher even when canonicalize fails at unwatch time, and drop the table lock before joining the watcher thread.
- `apps/desktop/src-tauri/src/watch/spawn_notify.rs`: don't block the async executor thread while waiting for the notify thread to report ready (e.g. `spawn_blocking` or an async await on the startup signal).

## Tests → expected
| Check | Expect |
| --- | --- |
| Watch a directory, delete it, unwatch | the watcher thread actually stops |
| A second watch/unwatch call issued while a slow one is in flight | it is not stalled behind it |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
