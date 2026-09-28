---
key: MARXY-288
design: [08-position-and-watching]
depends: []
verify: [pnpm precheck, pnpm done MARXY-288]
---
# MARXY-288 — Surface it when live-reload's watch fails to (re)start

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** When the shell can't (re)establish a live-reload watch for the open document, the reader learns about it instead of live-reload silently going dark.

## Why
`registerDocumentWatch` closes the previous watch unconditionally before the new `shell.watch()` promise resolves. If `shell.watch()` throws, the catch leaves `documentWatch = null` with only a `console.warn`, silently disabling live-reload for that document with no retry and nothing surfaced to the reader beyond devtools.

## Files and signatures
- `apps/desktop/src/app.ts`: retry the failed watch (with backoff) or surface a notice (matching the existing `notices/` pattern) instead of only logging to the console.

## Tests → expected
| Check | Expect |
| --- | --- |
| shell.watch() rejecting | the new behaviour (retry attempted, or a notice shown) fires |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
