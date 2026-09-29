---
key: MARXY-287
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-287]
---
# MARXY-287 — Distinguish a real I/O error from 'not an image' in image_size

**Design:** [06-shell](../../design/06-shell.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A permission error or other real I/O failure reading an image file is reported as an error, not conflated with 'this file just isn't an image'.

## Why
`image_size` collapses every `size()` error (permission denied, a symlink loop, a genuine I/O error) to the same `Ok(None)` result as a file that legitimately isn't an image, so the caller cannot tell a real failure from a non-image file.

## Files and signatures
- `apps/desktop/src-tauri/src/commands/fs.rs`: return `Err(ShellError::io(...))` for `io::Error` kinds that indicate a genuine failure, keeping `Ok(None)` only for 'not a recognized image format'.

## Tests → expected
| Check | Expect |
| --- | --- |
| A permission-denied or otherwise-unreadable path | an `Err` is returned rather than `Ok(None)` |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
