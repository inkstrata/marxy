---
key: MARXY-270
design: [10-gates-and-testing]
depends: [MARXY-247, MARXY-254]
verify: [pnpm precheck, pnpm done MARXY-270]
---
# MARXY-270 — Build and lint the Rust shell with --locked everywhere, and check it stays so

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-27-unblock](../deltas/2026-09-27-unblock.md) · **Depends on:** MARXY-247 (its pull request holds `.github/workflows/ci.yml`; the row is not on `main`) and MARXY-254 (holds `nightly.yml` and `scripts/check-workflows.mjs`).

**Outcome.** CI builds exactly the Rust dependency graph that is committed. A `Cargo.toml` change that forgets `Cargo.lock` fails loudly instead of being resolved on the runner.

## What is wrong today
`pnpm install --frozen-lockfile` already holds Node to its lockfile. The Rust side does not:
- `ci.yml`: `cargo build` has no `--locked`.
- `package.json` `lint:rust`: `cargo clippy` has no `--locked`.
- `apps/desktop/package.json` `build` / `bundle`: `tauri build` passes nothing through to cargo.
- `release.yml`: `tauri-apps/tauri-action` `args` do not carry it.

## Files and signatures
- `.github/workflows/ci.yml`: add `--locked` to every `cargo build`, `check`, `clippy` and `test`.
- `.github/workflows/release.yml`: the same, including tauri-action `args`.
- `.github/workflows/nightly.yml`: the same.
- `package.json`: `lint:rust` passes `--locked`.
- `apps/desktop/package.json`: `tauri build` passes `--locked` through to cargo.
- `scripts/check-workflows.mjs`: any `cargo (build|check|clippy|test)` or `tauri build` without `--locked` fails, with `file:line`. `--selftest` shows a fixture line without the flag failing and one with it passing.
- `docs/ci-contract.md`: the new failure and `pnpm check:workflows`.
- `CHANGELOG.md`: one Unreleased line ending `(MARXY-270)`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-workflows.mjs --selftest` | the bare-cargo fixture fails, the locked one passes |
| `pnpm check:workflows` | green |
| `cargo build --locked` after a `Cargo.toml` edit that does not touch `Cargo.lock` | the command errors because the lockfile needs an update (run it, do not commit the edit) |

## Acceptance → check
Row acceptance 1–5. The selftest checks 1 and 2. The manual `cargo build --locked` is noted in the PR body. Reading checks 4 and 5.

## Do not
- Add `sccache`, a per-crate matrix, or a bundle-size gate. ADR-0032 keeps size recorded, not gated. `Swatinem/rust-cache` is already on, and there is one crate.
- Touch `cargo fmt`. It does not read the lockfile.
