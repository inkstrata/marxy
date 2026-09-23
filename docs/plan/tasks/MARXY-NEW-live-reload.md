---
key: MARXY-NEW-live-reload
design: [08-position-and-watching, 06-shell]
depends: [MARXY-NEW-one-open-path]
verify: [pnpm precheck, pnpm done MARXY-NEW-live-reload]
---
# MARXY-NEW-live-reload — Register the watcher and reload the open document in the app

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) ·
[06-shell](../../design/06-shell.md) §Commands · **Delta:** [2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md) ·
**ADRs:** ADR-0018 (position is a source-map coordinate) · **Finishes:** MARXY-34, which built every
piece and left `main.rs` and the app outside its paths.

**Outcome.** When a file the reader has open changes on disk (an agent rewriting a plan, `git pull`,
an editor saving), the page shows the new text within a moment and the reader stays on the same block.
If the reader has changed the buffer in Source mode, the file on disk never replaces their change.
Configured-theme hot-reload (MARXY-177) starts working too, because it rides on the same command.

## What exists
- `apps/desktop/src-tauri/src/watch/mod.rs`: `Watcher::open`, `poll`, `scan`, `diff`,
  `effect_for_open_document`, all unit-tested. Not declared as a `mod` in `main.rs`.
- `main.rs` `watch_root` / `unwatch_root`: `Ok(())` no-ops with `_root` ignored, commented
  "Phase 0 placeholder until MARXY-34".
- `apps/desktop/src/shell/tauri.ts` `watch`: invokes `watch_root`, listens on `fs-watch`, debounces.
- `packages/core/src/position/reload.ts`: reparse keeping the first visible block's byte offset.
- `app.ts`: never calls `shell.watch`.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs`: `mod watch;`. `watch_root(app, root)` starts one polling thread
  per root (reuse an existing one for the same root), emitting `fs-watch` with `Vec<WatchEvent>`.
  `unwatch_root` stops it. Delete the placeholder comment.
- `apps/desktop/src-tauri/src/watch/mod.rs`: only what the thread needs (a `run`/`spawn` entry).
  Keep the existing functions and tests.
- `apps/desktop/src-tauri/capabilities/default.json`: the event permission, if `listen` on
  `fs-watch` needs one.
- `apps/desktop/src/app.ts`: in `openDocument`, after first text (never before), `shell.watch(dir)`
  for the open document's directory. Close the previous handle on the next open. On an event whose
  effect is *changed* for the open path: if the buffer has no local changes, reread, reparse and
  re-render through the same internals `openDocument` uses, restoring `currentPosition(...)`'s
  byte offset. If there are local changes, show a notice and keep the buffer. *Deleted*: keep the
  page and show a notice. *Moved*: follow the new path.
- `apps/desktop/src/notices/`: one notice string for "changed on disk; your edits kept" and one for
  "file removed".
- `apps/desktop/test/live-reload.test.mjs`: Playwright over `startApp` + memory shell (`emit`).

## Tests → expected
| Check | Expect |
| --- | --- |
| `cargo test` in `src-tauri`: a test starts the watch thread on a tempdir, rewrites a file, collects one event | a `modified` event for that path within 2 s. `unwatch_root` stops further events |
| `rg -n "Phase 0 placeholder\|_root: String" apps/desktop/src-tauri/src/main.rs` | no match |
| live-reload: boot `/r/A.md`, scroll so block k is at the reading line, write new A (block k unchanged, a paragraph appended at the end), `emit` modified | `#doc` contains the appended text; `sourceHarness().byteOffset` equals the value before the event |
| live-reload: memory-shell call record | exactly one `watch` call per open; the previous handle is closed on the next open |
| live-reload: enter Source, type a character, `emit` modified with different bytes | buffer hash still equals the edited buffer; the "edits kept" notice is present; no `writeFileAtomic` call |
| live-reload: `emit` deleted | page unchanged; the "file removed" notice is present |
| `reload` mark | printed with `ms=`; recorded, not gated (ADR-0032) |

## Acceptance → check
The CSV row's criteria are the table rows, in order.

## Do not
Watch before `first_text`. Add a recursive watch of a whole repository: the root is the open document's
directory. The index story may widen it; this one does not. Replace a buffer that differs from the
last read. Add chrome: notices use the existing notices region. Touch `packages/shell-api` (`watch` is
already a frozen member).
