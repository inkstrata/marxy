# ADR-0022 — Product budgets are enforced on reference hardware; CI enforces an envelope and a baseline

**Status:** accepted, amended 2026-09-18 (see Amendment 1) · **Amends:** ADR-0013 (its measurement
clause only; the budgets themselves and "regressions are hard failures" stand unchanged) ·
**Source:** the first red `gate:perf` run on GitHub-hosted runners, 2026-09-18

## Decision
The budgets in `AGENTS.md` are **product** budgets, measured on reference hardware: the maintainer's
macOS machine, or any machine where `MARXY_PERF_ENV=reference`. In that mode `scripts/gate-perf.mjs`
compares the median against the product number and fails at 501 ms, with no multiplier and no
tolerance. `reference` is the default whenever `CI` is unset, and the release runbook runs it before
a tag; the gate fails if `results/perf.json` is missing or was not produced in `reference` mode.

On GitHub-hosted runners (`MARXY_PERF_ENV=ci`, set by `.github/workflows/ci.yml`) the same script
enforces, per runner class, `min(product × multiplier, baseline × 1.10)` and fails when the median
exceeds it. *(Amendment 1 replaces the statistic, the flat tolerance and the single-shot failure:
the CI tier gates the measured floor against a recorded per-runner tolerance and confirms a breach
before failing. The two tiers, the envelope and the explicit-edit rule below are unchanged.)* Both numbers live in `fixtures/perf-budgets.json` under `ci.<runner_class>`; the
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

## Amendment 1 — the CI statistic, 2026-09-18

**Trigger:** PR #6 changed only `docs/`, `scripts/specimen/`, `fonts/` and `CHANGELOG.md` and went
red on `macos-latest` at 2244 ms against the 2091.1 ms baseline ceiling. Four medians of 8 launches
on that runner class span 1466–2244 ms (1.53×) while `ubuntu-latest` spans 7320–7719 ms (1.05×). A
10 % tolerance around one observed median is inside the macOS runner's own variance, so the rule as
written reports noise as a regression. Reasoning and rejected alternatives:
`docs/plan/deltas/2026-09-18-perf-variance.md`.

**What changes.** Only the CI tier's statistic, tolerance and failure procedure.

1. **The gated statistic is the floor, not the median.** Each round launches the app 12 times; the
   first launch is discarded as warm-up; `floor_ms` is the minimum of the remaining runs and is
   what the CI tier compares. Runner noise is one-sided — contention makes a launch slower, never
   faster — so the fastest launch of a round estimates the cost the code imposes, and a real
   regression raises it. The **reference tier keeps the median**: it states what a reader feels on
   a quiet machine, and it is not relaxed by this amendment. `results/perf.json` records both, plus
   every run in order and the launch count `runs_n`.
   A minimum-of-N is biased low as N grows, so `runs_n` is part of each baseline's record and the
   gate fails when the measured `runs_n` differs from the recorded one.
2. **The tolerance is measured per runner class, not a flat 10 %.** Each `ci.<runner_class>` carries
   `tolerance` and at least five `observed_floors_ms` measured on `main`; `baseline_ms` is the
   highest of those floors; the CI limit is
   `min(product × multiplier, baseline_ms × tolerance)`. The gate fails the configuration itself
   unless `1.05 ≤ tolerance` and

       (max(observed_floors_ms) / min(observed_floors_ms)) × tolerance ≤ 1.20

   because a regression of `r` is caught exactly when `1 + r > spread × tolerance`. The invariant is
   the promise "a 20 % cold-start regression cannot pass" expressed as an assertion, and it makes a
   tolerance that merely buys quiet impossible to write down.
3. **A breach is confirmed before it fails.** In `ci` mode a breach re-measures, up to two further
   rounds in the same job; the gate fails when every round breaches and passes when one does not.
   A pass after a breach is not silent: it prints the breaching round and its margin and records
   every round in `results/perf.json`. `reference` mode does not re-measure — one breach fails.
4. **A runner class that cannot satisfy the invariant loses its baseline rule explicitly.** It
   records `baseline_ms: null` and a `baseline_waived` object naming the observed floors, the
   reason and the maintainer escalation; the envelope still gates it. The gate fails if a waiver
   lacks that record. No implicit path exists from "noisy runner" to "no gate".

**What does not change.** Both tiers and their environment resolution; both runner classes gate; the
envelope and its `derived_from` audit record; every product budget; and the rule the whole ADR
exists for — **a baseline moves only by an explicit edit to `fixtures/perf-budgets.json` in the pull
request that costs the time, and CI never writes to the repo.** Nothing becomes advisory and no
`continue-on-error` is introduced.

**Accepted risk.** Detection is `spread × tolerance`, so a sustained 20 % regression fails while a
5 % one does not, and an accumulation of small ones can cross 20 % with no single pull request
tripping the gate. The counterweights are the pre-tag reference run, which is absolute and has no
tolerance, and MARXY-53's ratchet, which re-records the floors downward and reclaims the slack.
Twelve launches cost 30–40 s more per runner in the passing case.
