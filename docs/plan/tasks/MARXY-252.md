---
key: MARXY-252
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-252]
---
# MARXY-252 — Keep a Finder open that arrives before the page listens

**Design:** [06-shell](../../design/06-shell.md) · **Follows:** MARXY-183 · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md)

**Outcome.** Double-clicking a markdown file on a Mac that is not running Marxy opens that file, every time, including the first launch after install.

## What is wrong today
`RunEvent::Opened` → `emit_open_files` → `app.emit("marxy:open-files")` with no queue; `shell/tauri.ts` registers `listen` un-awaited in `startApp`. On the first launch of a fresh release build, `open -a Marxy.app 03-ai-plan.md` showed the empty state ([screenshot](../deltas/evidence/2026-09-27-seams/h2-cold-open-dropped.png)); nine later cold runs and a warm control opened the file. A race, so the fix is structural rather than timed.

## Files and signatures
- Rust: a `PENDING_OPENS` queue filled by `Opened` and the single-instance callback; a `take_pending_opens` command that drains it.
- `apps/desktop/src/shell/tauri.ts`: `await listen(...)`, then `invoke('take_pending_opens')`, then route both through the same handler.
