---
key: MARXY-254
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-254]
---
# MARXY-254 — Nightly smoke of the built app through the real IPC

**Design:** [06-shell](../../design/06-shell.md) · **Order:** after MARXY-247 (browser tests and `cargo test` in PR CI), whose row is not on `main` yet · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md)

**Outcome.** A release build that cannot open, edit or save a file, or that loses its runtime styles, is reported the next morning.

## Files and signatures
- `scripts/smoke-built-app.mjs`: builds nothing itself; drives an already-built binary with `tauri-driver` + `WebKitWebDriver` (Linux).
- `.github/workflows/nightly.yml`: a job after the existing one; monitoring, never on the pull-request path.

## Tests → expected
| Check | Expect |
| --- | --- |
| open a copy of `12-crlf-and-bom.md`, toggle, save | `cmp` equal to the expected bytes |
| open the palette | its runtime style applied |
