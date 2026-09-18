# ADR-0022 — Product budgets are enforced on reference hardware; CI enforces an envelope and a baseline

**Status:** accepted · **Amends:** ADR-0013 (its measurement clause only; the budgets themselves
and "regressions are hard failures" stand unchanged) · **Source:** the first red `gate:perf` run on
GitHub-hosted runners, 2026-09-18

## Decision
The budgets in `AGENTS.md` are **product** budgets, measured on reference hardware: the maintainer's
macOS machine, or any machine where `MARXY_PERF_ENV=reference`. In that mode `scripts/gate-perf.mjs`
compares the median against the product number and fails at 501 ms, with no multiplier and no
tolerance. `reference` is the default whenever `CI` is unset, and the release runbook runs it before
a tag; the gate fails if `results/perf.json` is missing or was not produced in `reference` mode.

On GitHub-hosted runners (`MARXY_PERF_ENV=ci`, set by `.github/workflows/ci.yml`) the same script
enforces, per runner class, `min(product × multiplier, baseline × 1.10)` and fails when the median
exceeds it. Both numbers live in `fixtures/perf-budgets.json` under `ci.<runner_class>`; the
multiplier carries a `derived_from` record (commit, runner image, reference median, runner median)
and is derived as `ceil(runner_median / product_budget × 1.3)`. Adoption values:
`ubuntu-latest` ×20, baseline 7719 ms; `macos-latest` ×5, baseline 1901 ms.

Both runner classes gate. A baseline is moved only by an explicit edit to
`fixtures/perf-budgets.json` in the pull request that costs the time; CI never writes to the repo.

## Why
The Linux runner has no GPU and software-renders WebKitGTK; the hello-world shell measures 7719 ms
there and 1901 ms on `macos-latest`. A 500 ms product budget is therefore unreachable on rented
hardware, and enforcing it there stops every merge while telling us nothing about the product. The
answer is not a looser number but a second observable: *change on the same runner*. The envelope
keeps an absolute statement that MARXY-53 can ratchet; the baseline is what actually catches a
regression, on both platforms, on every pull request.

## Consequences
- `scripts/gate-perf.mjs` gains `MARXY_PERF_ENV` (`reference` | `ci`), the two-rule CI check, and a
  `--selftest` mode whose fixtures cover pass, ceiling breach and baseline regression.
- `scripts/measure-startup.mjs` records `env_class` and `runner_class` in `results/perf.json`.
- `fixtures/perf-budgets.json` grows a `product` and a `ci` section; MARXY-53 tightens both tiers.
- `docs/sdlc.md`'s release runbook gains the reference-mode perf run before the tag.
- The tripwire "cold start > 500 ms after Phase 2" in `docs/roadmap.md` now reads against the
  reference measurement, not CI.
