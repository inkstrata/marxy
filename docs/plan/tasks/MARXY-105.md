---
key: MARXY-105
design: [10-gates-and-testing]
depends: [MARXY-91]
verify: [node scripts/ci-changes.mjs --selftest, node scripts/gate-perf.mjs --selftest, pnpm done MARXY-105]
---
# MARXY-105 — Skip the macOS and Linux gates jobs when they cannot change result

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Depends on:** MARXY-91 · **ADRs:** ADR-0022 (do not loosen the gate when it runs).

**Outcome.** A PR that does not touch gates-relevant files, or that only adds more non-relevant files after a real `gates` success, does not rebuild the desktop binary on macos or ubuntu. Branch protection still sees `gates (macos-latest)` and `gates (ubuntu-latest)` as a conclusion. A rust change still runs the full matrix, unconditionally, on both runners.

## Files and signatures
- `scripts/ci-changes.mjs` — keep the existing `docs_only` / `web` / `rust` / `workflow` outputs. Add `gates` (`true`/`false`) and `gates_reason` (`not-required` | `reuse` | `in-progress` | `run`). One function decides whether a path is gates-relevant. `--selftest` covers every named case below and makes no network call. `--success-sha` and an injected run list are how reuse / in-progress are tested; `gh` is only used when `GITHUB_TOKEN` is set and `--selftest` is not.
- `.github/workflows/ci.yml` — the `changes` job writes the new outputs and runs `--selftest`. The real `gates` job's `if:` is `needs.changes.outputs.gates == 'true'` (replace today's `docs_only != 'true'`). Measurement, `--selftest`, and `pnpm gate:perf` steps stay unconditional. A sibling job with `name: gates (${{ matrix.os }})` and the complementary `if` runs on `ubuntu-latest` for both matrix OS names. Workflow-level `cancel-in-progress: true` on a group that is only `ci-${{ github.ref }}` must go: cheap jobs may still cancel themselves; a docs/CHANGELOG push must not cancel a running matrix build. `permissions` gains `actions: read` so the changes job can see prior runs.
- `docs/design/10-gates-and-testing.md` — one short section: when the macos/linux job runs, when it is skipped, and that a skip still posts the two required check names.

Do not touch `scripts/gate-perf.mjs`, `fixtures/perf-budgets.json`, `scripts/gate-protection.mjs`, `package.json`, or branch-protection settings.

## Gates-relevant (the function, not a second list in the workflow)

A path is relevant when it can change what the `gates` job builds or measures:

- `apps/desktop/**`
- `packages/**` except `**/*.test.ts`, `**/*.test.mjs`, `**/goldens/**`
- `fonts/**` except `**/LICENSE*`, `**/README*`
- `fixtures/perf-budgets.json`, `fixtures/corpus/**`
- `scripts/measure-startup.mjs`, `scripts/measure-parse.mjs`, `scripts/gate-perf.mjs`, `scripts/gate-bundle.mjs`, `scripts/ci-summary.mjs`, `scripts/ci-changes.mjs`
- `.github/**`
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `mise.toml`
- `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock`

Everything else — `docs/`, `orchestration/`, `CHANGELOG.md`, `scripts/check-pr.mjs`, biome, goldens, unit tests — is not.

## Do this, in order
1. Add `isGatesRelevant` and the `gates` / `gates_reason` outputs, with `--selftest` for the table below. Reuse only a *real* matrix success: job name `gates (macos-latest)` on a macos runner (not ubuntu), and the ubuntu cell on ubuntu, at a SHA whose relevant tree matches HEAD. A stand-in success does not count. In-progress of a real run for the same tree is `in-progress`, not `reuse`.
2. Wire `ci.yml`: job-level skip, sibling stand-in, cancel rules, `actions: read`, `--selftest` on the changes job. The stand-in exits 0 for `not-required` and `reuse`. For `in-progress` it waits for the existing run (timeout ≤ the gates job timeout) and exits with that conclusion — it does not invent a green.
3. Write the design paragraph. CHANGELOG line under Unreleased.
4. Confirm `node scripts/gate-perf.mjs --selftest` is still green without editing that file.

## Tests → expected
| Check | Expect |
| --- | --- |
| `--selftest` file list = `docs/plan.md`, `orchestration/ready.mjs`, `CHANGELOG.md`, `scripts/check-pr.mjs` | `gates=false`, `gates_reason=not-required` |
| `--selftest` file list includes `apps/desktop/src-tauri/src/lib.rs` or `packages/core/src/parse/index.ts` or `scripts/measure-startup.mjs` | `gates=true`, `gates_reason=run` |
| vs-base needs gates; `--success-sha` is a real dual-OS success; vs-success file list empty | `gates=false`, `gates_reason=reuse` |
| same, but the injected success is the stand-in (ubuntu runner, name `gates (macos-latest)`) | `gates=true` (no reuse) |
| injected in-progress real matrix run, same relevant tree | `gates=false`, `gates_reason=in-progress` |
| `node scripts/gate-perf.mjs --selftest` | exit 0 |
| Delete the sibling job, or drop `macos-latest` from the real matrix, or put `if:` on `pnpm gate:perf` | `--selftest` red |
| Workflow-level `cancel-in-progress: true` on group `ci-${{ github.ref }}` only | `--selftest` red |

## Acceptance → check
CSV criteria 1–6. Criterion 2 is the one that keeps MARXY-82's required names green without softening `checkWorkflow`.

## Do not
Edit `scripts/gate-perf.mjs` (55 / 63 / 70), `fixtures/perf-budgets.json` (70), or `scripts/gate-protection.mjs` (82). Change the required check names. Add `if:` / `continue-on-error` / `|| true` to the measurement steps. Count a stand-in success as reuse. Post a green stand-in while a real run for that tree is still in progress. Start while MARXY-62, MARXY-65, MARXY-90, or MARXY-91 still own `.github/workflows/ci.yml`. Flip `required:true` or widen a perf band. Touch `package.json` (62 / 85 / 90).
