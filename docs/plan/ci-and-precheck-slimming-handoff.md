# Handoff: drastically slim CI and `pnpm precheck`

For a planner. Written 2026-10-08. The ask: cut the runtime of both the pull-request CI and the local
`pnpm precheck` hard. Anything that does not protect a reader-facing commitment on a pull request
should move to nightly, run on demand, or go.

## Why

- `pnpm precheck` on a branch that touched `apps/desktop` took **17 minutes wall** (7.5 min CPU,
  51% CPU utilisation, so about half of it waiting) and then **died without a summary**. pnpm printed
  `ELIFECYCLE`, there was no `✗` line and no `precheck: n/m passed`. `check-cards`, desktop
  typecheck/lint/test, `check` and `check:story` passed; `gate:no-network`, `gate:bundle` and
  `lint:rust` never reported. Cause not found.
- It is meant to run once before a PR, but at this cost nobody can, and it duplicates CI.
- The project's own rules point the same way: a check that cannot fail for something in your diff does
  not belong on the PR path (`AGENTS.md`, Verification); process that slows product is a bias to
  avoid; the budgets are already nightly-only (ADR-0032).

## What is known (from reading, not measured)

**`scripts/precheck.mjs`**
- Every step is a `spawnSync`, run serially. No per-step timing is printed.
- Steps = `check-cards` + typecheck/lint/test for each touched package + every gate the path map
  (`scripts/gates-by-path.json`) selects + `always` (`check`, `check:story`).
- A change under `scripts/`, `package.json`, `pnpm-workspace.yaml` or a tsconfig adds all five packages.
- `apps/desktop/src-tauri/*` (even `tauri.conf.json`) pulls in `lint:rust`: `cargo fmt --check` plus
  `cargo clippy --locked -- -D warnings` on the whole crate.
- Desktop `test` runs `src`, `test` and `scripts` suites with `--test-concurrency=1`.
- `--all` runs everything it knows.

**`.github/workflows/ci.yml`** jobs: `changes`, `conventions`, `fast` (includes the CommonMark spec
suite), `browser-lite` (desktop lite suite in WebKit, with a C linker install), `typography`
(aesthetics, 20 min timeout), `rust` (30 min timeout: Linux webview/X deps, fmt + clippy, frontend
build, thin-LTO desktop binary build, post-build licence gate, CLI smoke, Rust unit tests), and the
aggregate `ci`. Per-job wall times from recent runs were **not** collected; that is step one.

## What the author has said is not important

- **Linux fidelity**: the Linux build/render path (`webkit-linux` baselines, the Linux webview deps and
  the Linux-hosted Rust build and browser jobs in CI). macOS is the product target for now.
- "Some of the other things": the planner should propose the list; candidates below are suggestions,
  not decisions.

## Asks of the planner

1. **Measure first.** Pull per-job and per-step durations for the last ~20 `ci` runs
   (`gh run list` / `gh run view --json jobs`) and time each `precheck` step locally. Find the 17
   minutes and the silent death. Report a table before cutting anything.
2. **Define a minimal PR gate.** Propose what must stay on the pull-request path: the one required
   check `ci` (branch protection needs it) and the smallest set behind it that still protects the five
   commitments (free, private, faithful to the bytes, nothing hidden silently, first text never waits).
   Candidates to keep: conventions/commitlint, typecheck + lint + unit tests for touched packages,
   `gate:no-network`, `gate:fidelity`/golden when `packages/core` or the corpus changed, licence audit
   when dependencies changed.
3. **Move the rest to nightly or on-demand.** Candidates: Linux jobs and baselines; thin-LTO release
   build and CLI smoke; `typography`/aesthetics unless render code changed; the full CommonMark spec
   suite unless the parser changed; Rust clippy unless Rust changed; the desktop lite WebKit suite
   unless UI code changed. `nightly.yml` already exists and is documented as monitoring only.
4. **Path-filter harder.** `changes` already exists; make every job conditional on it, and make
   unrelated edits (docs, `changelog.d`, `.claude`) run only `conventions`.
5. **Shrink `precheck`.** Target well under two minutes on a warm tree: `check`, `check:story`,
   `check-cards`, and typecheck/lint/unit tests for the touched package only, in parallel, with
   per-step timing and a summary that always prints (including on crash or kill). Gates stay runnable by
   name (`pnpm gate:*`); `precheck` stops running them. Keep `--all` as the explicit slow path.
6. **Speed what stays.** Caching (pnpm store, Cargo, Playwright browsers), splitting the serial desktop
   test run, dropping redundant installs, and cancelling superseded runs (`concurrency`).
7. **Keep the contract honest.** Update `docs/ci-contract.md` (the list of what can turn a PR red and
   the local command for each), `AGENTS.md`, `docs/hygiene.md` and any ADR whose gate moves (ADR-0032,
   ADR-0040, ADR-0046, ADR-0047 are the likely ones). Each gate moved to nightly should say what a red
   nightly means ("a note for the next session, not a blocked merge").

## Constraints

- Branch protection requires exactly one check, `ci`. Keep that name and keep it meaning "everything
  that ran succeeded"; skipped-by-filter jobs must not fail it.
- No `|| true`, `continue-on-error` or Playwright retries to make things pass (`AGENTS.md`).
- Do not weaken the commitments: moving a gate to nightly is fine, deleting the only check that
  protects a commitment is not. Say which gate protects which commitment before moving it.
- Contracts under `packages/*/src/contracts/`, `shell-api` and `tokens.css` are not in scope.
- A story needs a `changelog.d/<id>.md` fragment, `pnpm check` green, and one review.

## Open questions for the author

- Is macOS-only acceptable for every PR-path check, with Linux fully nightly or dropped?
- Is a ~2 minute `precheck` and a ~5 minute PR `ci` the right target, or lower?
- Which of the nightly-only candidates above should instead be deleted?
