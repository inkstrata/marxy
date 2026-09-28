---
key: MARXY-299
design: [08-position-and-watching]
depends: []
verify: [pnpm precheck, pnpm done MARXY-299]
---
# MARXY-299 — Don't fail watch_root outright when an unrelated symlink's target vanishes mid-open

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) · **Delta:** [2026-09-28-bugcatch-2](../deltas/2026-09-28-bugcatch-2.md) · **Depends on:** nothing.

**Outcome.** A broken or vanishing symlink elsewhere in the watched root doesn't stop live-reload from working for the actual document.

## Why
`symlink_target_dirs` (`watch/mod.rs`) canonicalizes the target of every symlink directly in the watched root with a bare `?`, so if a symlink's target disappears between the metadata check and the canonicalize call — or was already broken — the whole function returns `Err`, which propagates through `watch_roots` and fails `RootWatch::open` (and so the `watch_root` Tauri command) entirely.

## Files and signatures
- `apps/desktop/src-tauri/src/watch/mod.rs`: skip a symlink whose target can't be canonicalized rather than failing the whole call.

## Tests → expected
| Check | Expect |
| --- | --- |
| A watched root containing one broken symlink alongside the actual document | watch_root still succeeds and watches the real content |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
