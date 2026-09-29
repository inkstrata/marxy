---
key: MARXY-308
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-308]
---
# MARXY-308 — Make the Cargo dependency scanner recognize the [dependencies.crate-name] table form

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** A forbidden crate declared via Cargo's `[dependencies.crate-name]` table syntax is caught by the license/dependency gate, not invisible to it.

## This attempt
PR #281 is the fix (`scripts/check-deps.mjs` and its test, including the comrak comment). It conflicts with main. The red `browser` job is the same `image_size_on_unreadable_file_is_io_not_none` failure as MARXY-236: this branch does not touch `fs.rs`, and main's test already returns early when root can still read a mode-`000` file (MARXY-287, `2ec8c346`). Rebase onto `origin/main`. Do not edit `apps/desktop/src-tauri/src/commands/fs.rs`.

## Why
The parser only extracts crate names from the inline `crate = "1.0"` form; with the table form the crate name lives in the section header, and the parser instead treats field names like `version`/`features` as fake crate names, never checking the real one.

## Files and signatures
- `scripts/check-deps.mjs`: recognize `[dependencies.crate-name]` (and `[dev-dependencies.crate-name]`, etc.) headers and extract the crate name from them.

## Tests → expected
| Check | Expect |
| --- | --- |
| A fixture Cargo.toml declaring a forbidden crate via the table form | the gate flags it (and did not before the fix) |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
