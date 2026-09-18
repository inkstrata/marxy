# ADR-0022 — Product budgets are enforced on reference hardware; CI enforces an envelope and a baseline

**Status:** accepted, amended (Amendment 1, 2026-09-18) · **Amends:** ADR-0013 (its measurement clause only; the budgets themselves
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

*Amended below.* Amendment 1 replaces the CI statistic and its tolerance: CI compares the **floor** of
a 12-launch round against `baseline_ms × tolerance`, where the tolerance is measured per runner class
rather than a flat 10 %, and a breach is re-measured before it fails. Everything else here stands.

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

## Amendment 1 (2026-09-18, MARXY-63) — the CI statistic is a cold floor, and its tolerance is measured

**Status:** accepted · **Source:** `docs/plan/deltas/2026-09-18-perf-variance.md`; three CI runs on
2026-09-18 that failed and then passed on unchanged code

The CI tier above compared a single-sample median against `baseline × 1.10`. On `macos-latest` the
estimator's own spread is wider than that tolerance — four medians of eight launches spanned
1466–2244 ms, and PR #7 measured 2448 ms and then 463 ms on one commit — so the gate reported runner
noise as a regression and implementors learned to re-run CI instead of measuring. The budgets are not
the problem and are untouched; the statistic is. Four changes, all inside the two-tier shape.

1. **CI gates the floor, not the median.** A round is `runs_n` launches of the packaged app; the
   first is discarded as warm-up, and the gated number is the **minimum** of the rest (`floor_ms`).
   Runner noise is one-sided — contention and a cold cache make a launch slower, nothing makes it
   faster than the code allows — so the minimum estimates the cost the code imposes and a real
   regression raises it by what it costs. The reference tier keeps the **median** against the product
   budget with no multiplier and no tolerance: the two tiers answer different questions. Because a
   minimum of N is biased low as N grows, `runs_n` is part of the baseline record and the gate fails
   when a round was measured at another N.
2. **Tolerance is measured per runner class and bounded by the regression it must catch.** Each class
   records `tolerance`, `runs_n` and at least five `observed_floors_ms` taken on `main`;
   `baseline_ms` is the **highest** of those floors, and the gate fails the configuration unless
   `(max(observed_floors_ms) / min(observed_floors_ms)) × tolerance ≤ 1.20`.
3. **A breach is confirmed before it is a failure.** In CI only, a breaching round re-measures, up to
   three rounds in the same job, and the gate fails only when every round breaches. The pass path is
   loud: a confirmed-noise pass prints the breaching round and its margin and writes every round into
   `results/perf.json`, so the frequency stays countable. Nothing is advisory; the gate still exits
   non-zero when the breach reproduces.
4. **A class that cannot satisfy the bound loses the baseline explicitly.** `baseline_ms: null` is
   valid only with a `baseline_waived` record carrying `reason`, `observed_floors_ms`,
   `escalated_to` and `date`; the class then keeps the envelope alone. Widening the tolerance to make
   the rule fit is not available — it would restore the gate this amendment removes.

### What makes a launch cold, and why the floor is honest

A minimum of N is only a floor over launches that all paid the same costs. A launch that skipped the
page cache or reused a webview cache is not cold, and a minimum over a mixed round drifts toward the
warmest launch — a gate defending a number no reader experiences, which is the same failure as a
flaky gate in better clothes. So *cold* is defined and enforced, not assumed:

- no marxy process from a previous launch is alive, and the launch is a fresh process, never a
  window handed to a running instance;
- the file-system cache holding the binary and its libraries is evicted between launches (`purge` on
  macOS, `drop_caches` on Linux), and what actually happened is recorded in `cold_protocol.page_cache`
  rather than assumed;
- the app gets per-user cache, config and data directories it has never seen, so no webview, icon or
  font cache survives the previous launch;
- the launch is given the environment it needs to be measurable at all: on Linux, Xvfb at
  `1280x1024x24` with `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE` and
  `LIBGL_ALWAYS_SOFTWARE`, and a 45 s timeout above the observed 31.6 s WebKitGTK warm-up;
- a round whose floor sits more than **3×** below its own median is **rejected**, not adopted. Such a
  round is uninterpretable: from the run list alone a deflated floor (one warm launch) and an inflated
  median (a contended runner) are indistinguishable, and adopting the minimum would silently pick the
  first reading. Failing the round is the honest answer to both.

### Measured adoption values

Measured on `main`'s binary by MARXY-63, `runs_n` 12 per round, five rounds per class:

| Runner class | `runs_n` | `observed_floors_ms` | spread | `tolerance` | `baseline_ms` | detection power |
| --- | --- | --- | --- | --- | --- | --- |
| `ubuntu-latest` | 12 | MEASURED | — | — | — | — |
| `macos-latest` | 12 | MEASURED | — | — | — | — |

### Consequences of the amendment

- `scripts/measure-startup.mjs` runs 12 launches per round, discards the warm-up, enforces the cold
  protocol, and records `runs`, `warmup_ms`, `floor_ms`, `median_ms`, `runs_n`, `usable_runs`,
  `cold_ratio`, `cold_plausible`, `cold_protocol` and `rounds`. It exits non-zero on a round it
  cannot interpret. `MARXY_PERF_ROUNDS` re-derives `observed_floors_ms`.
- `scripts/gate-perf.mjs` validates the configuration before it compares anything, re-measures a
  breach through an injected measurement function, and keeps every MARXY-55 selftest case.
- `fixtures/perf-budgets.json` gains `tolerance`, `runs_n`, `observed_floors_ms` and, where a class
  is waived, `baseline_waived`. The `product` object is unchanged, asserted in CI against the base
  revision byte for byte.
- MARXY-15 asserts this rule, and MARXY-53's ratchet re-records the floors downward while keeping the
  1.20 bound true.
