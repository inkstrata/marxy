---
key: MARXY-304
design: [09-app-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-304]
---
# MARXY-304 — Don't let a failed shell.quit() overwrite an already-rendered page with an error

**Design:** [09-app-shell](../../design/09-app-shell.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** A quit failure is reported without destroying an already-successfully-rendered page.

## Why
`finish()` calls `shell.quit(code)`; a rejection after a successful render propagates into `startApp`'s catch block, which overwrites `#doc` with error text and calls `finish(1)` a second time — stomping a working page purely because quitting failed.

## Files and signatures
- `apps/desktop/src/app.ts`: don't let a rejected `shell.quit()` reach the render-overwriting catch path; report the failure some other way (console warning, a mark) instead.

## Tests → expected
| Check | Expect |
| --- | --- |
| shell.quit() rejects after a successful render | #doc's content is unchanged |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
