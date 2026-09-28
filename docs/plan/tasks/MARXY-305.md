---
key: MARXY-305
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-305]
---
# MARXY-305 — Narrow the main window's Tauri capability from core:default to what it actually uses

**Design:** [06-shell](../../design/06-shell.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** The main window's webview no longer has implicit menu-manipulation (or other unused) permissions it doesn't need, closing a gap in the Rust-side native-menu allowlist's guarantee.

## Why
`capabilities/default.json` grants `core:default`, which pulls in `core:menu:default` (create/append/set-as-app-menu/popup/set-accelerator, etc.) with nothing restricting it further. `main.rs` enforces a strict 4-item native menu per ADR-0011, Rust-side only — `core:menu:default` being granted means any JS in that webview could call the menu API over IPC and bypass that guarantee entirely, with no extra capability grant needed. Not exploited today (the frontend only imports `@tauri-apps/api/core` and `event`), but the capability file's own description undersells what it actually grants.

## Files and signatures
- `apps/desktop/src-tauri/capabilities/default.json`: replace `core:default` with an explicit, narrow permission list covering only what the app actually uses.

## Tests → expected
| Check | Expect |
| --- | --- |
| The full apps/desktop test suite (native menu, dialogs, window behaviour) | stays green after narrowing — the check that nothing actually needed was removed |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
