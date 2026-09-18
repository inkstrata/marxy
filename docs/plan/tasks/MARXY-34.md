# MARXY-34 — Watch the root and live-reload the open document keeping the reading position

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md), [06-shell](../../design/06-shell.md) §Watching · **Depends on:** MARXY-14, MARXY-75.

## Do this, in order
1. Rust `commands/watch.rs` with `notify` + `notify-debouncer-full` (both MIT/CC0 — check the licence gate), `watch_start(root) → id`, `watch_stop(id)`, events emitted as `marxy:watch` batches with the §06 mapping and the deny-list filter.
2. `src/shell/tauri.ts`: `watch()` returning `{ close }`, `onWatch(cb)` via `listen`.
3. `apps/desktop/src/position/position.ts`: `current()`, `restore(pos)` over `blocks` (§08 formulas), the reading line constant, scroll sampling.
4. `apps/desktop/src/reload.ts`: the §08 reload pipeline with hash checks, dirty conflict notice, `removed` notice, retry on a transient read failure, `live_reload` marks.
5. Handle `renamed`/`created` on the open path as `modified`.

## Tests
Rust: event mapping table with `notify`'s test helpers; deny-list filtering. Unit: `current`/`restore` inverse over the corpus block lists at three viewport heights. Playwright (real binary, smoke-style script in `apps/desktop/scripts/`): write-temp-then-rename `03-ai-plan.md` → same first visible block; delete → notice, text stays; dirty buffer → conflict notice, bytes unchanged. Perf: `live_reload_ms` < 100 reference tier.
