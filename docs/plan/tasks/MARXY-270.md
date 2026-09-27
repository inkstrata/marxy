---
key: MARXY-270
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-270]
---
# MARXY-270 — Build and lint the Rust shell with --locked everywhere, and check it stays so

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-27-tauri-research](../deltas/2026-09-27-tauri-research.md) · **Depends on:** nothing. MARXY-247 (PR #220, held open by the author) also edits `.github/workflows/ci.yml`, adding a `cargo test` step beside `cargo build`. Whichever lands second resolves a one-line conflict, and if this lands first, `check-workflows` requires #220's new step to carry `--locked`.

**Outcome.** CI builds exactly the Rust dependency graph that is committed. A `Cargo.toml` change that forgets `Cargo.lock` fails loudly instead of being resolved on the runner.

## What is wrong today
`pnpm install --frozen-lockfile` already holds Node to its lockfile. The Rust side does not:
- `ci.yml`: `cargo build --profile ci --features tauri/custom-protocol` has no `--locked`.
- `package.json` `lint:rust`: `cargo clippy --quiet -- -D warnings` has no `--locked`.
- `apps/desktop/package.json` `build` / `bundle`: `tauri build` passes nothing through to cargo.
- `release.yml`: `tauri-apps/tauri-action` `args` do not carry it.

## Files and signatures
- `.github/workflows/ci.yml`, `release.yml`, `nightly.yml`: add `--locked`. For `tauri build`, pass it through to cargo after `--`; for tauri-action, put it in `args`.
- `package.json`, `apps/desktop/package.json`: the same.
- `scripts/check-workflows.mjs`: a second pass over workflows and the two `package.json` scripts. Any `cargo (build|check|clippy|test)` or `tauri build` that does not carry `--locked` is a problem, reported with `file:line` and a `fix()` hint. Add `--selftest` cases: one line without the flag must fail, and one with it must pass.
- `docs/ci-contract.md`: the new failure and `pnpm check:workflows`.
- `CHANGELOG.md`: one Unreleased line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-workflows.mjs --selftest` | the bare-cargo fixture fails, the locked one passes |
| `pnpm check:workflows` on the branch | green |
| `Cargo.toml` edited, lock untouched, `cargo build --locked` | error: the lock file needs to be updated |

## Acceptance → check
Row acceptance 1–5: 1 and 2 are checked by `check-workflows` and its selftest, 3 by the manual run above noted in the PR, 4 and 5 by reading.

## Do not
- Add `sccache`, a per-crate matrix or a bundle-size gate. There is one crate, `Swatinem/rust-cache` is already on, and ADR-0032 keeps size ungated.
- Touch `cargo fmt` (it reads no lockfile).
