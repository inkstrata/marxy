---
key: MARXY-298
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-298]
---
# MARXY-298 — Re-check the --marxy-typeset: none kill switch during background typesetting

**Design:** [04-typeset](../../design/04-typeset.md) · **Delta:** [2026-09-28-bugcatch-2](../deltas/2026-09-28-bugcatch-2.md) · **Depends on:** nothing.

**Outcome.** Flipping --marxy-typeset: none mid-document stops in-flight background typesetting promptly, not only at the next attach()/relayout() call.

## Why
`killed()` (reading `--marxy-typeset: none`) is checked once per `attach()`/`relayout()` call, inside `go()`. It is never re-checked while background chunks continue via `scheduler.schedule(step)` or the `IntersectionObserver` callback as the reader scrolls. If something sets the CSS var directly (a theme swap that doesn't also call `relayout()`/`destroy()`), background work keeps mutating the DOM until the queue drains or `destroy()` is explicitly called.

## Files and signatures
- `packages/typeset/src/index.ts`: check `killed()` (or an equivalent live signal) inside `step()` and the `IntersectionObserver` callback before doing further DOM work, not only at `attach()`/`relayout()` time.

## Tests → expected
| Check | Expect |
| --- | --- |
| --marxy-typeset: none set mid-pass, after attach() but before all chunks have processed | no further typeset mutation happens |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
