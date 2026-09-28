---
key: MARXY-303
design: [09-app-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-303]
---
# MARXY-303 — Serialize deferred startup work so a stale run can't overwrite the palette index

**Design:** [09-app-shell](../../design/09-app-shell.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** Two overlapping deferred-startup runs (from rapid edits or mode toggles) can never let an older run's index overwrite a newer one's.

## Why
`rerenderFromBuffer`'s `void whenIdle(() => runDeferredStartup(...))` is fire-and-forget, unlike `finishDocumentOpen`'s awaited equivalent. Two rapid edits can start two overlapping `runDeferredStartup` calls; whichever finishes last wins on `onIndexLoaded`, regardless of which buffer is actually current.

## Files and signatures
- `apps/desktop/src/app.ts`: serialize `runDeferredStartup` calls (through the existing `serially()` chain, or by discarding a late-arriving stale run).
- `apps/desktop/src/startup/idle-work.ts`: if runs need tagging/generation-checking to discard stale results, that logic likely belongs here.

## Tests → expected
| Check | Expect |
| --- | --- |
| Two rapid edits trigger two overlapping deferred-startup runs | the palette index reflects the latest buffer, not whichever run finished last |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
