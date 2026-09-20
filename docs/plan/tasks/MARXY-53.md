---
key: MARXY-53
design: [14-release, 10-gates-and-testing]
depends: [MARXY-33, MARXY-55, MARXY-63, MARXY-70]
verify: [pnpm precheck, pnpm done MARXY-53]
---
# MARXY-53 — Tighten perf and bundle budgets to measured values minus headroom

**Design:** [14-release](../../design/14-release.md) §Budgets before v1 · **ADRs:** ADR-0013, ADR-0022 (and Amendment 3 as cited in the CSV row) · **Depends on:** MARXY-33, MARXY-55, MARXY-63, MARXY-70 · **Human step:** the reference-tier runs on Ian's machine (step 1 below); request it in `needs-human.md` the day this story starts, not the day it needs the numbers.

**Outcome.** The budgets in `fixtures/perf-budgets.json` stop being guesses: each is the measured value plus a stated margin, so a real regression goes red and noise does not.

## Files and signatures
- `scripts/tighten-budgets.mjs` + `scripts/tighten-budgets.test.mjs` — `--from <run id…> --reference <reference.json> [--write]`: downloads (via `gh run download`) the `results/perf.json` artifact of each run, validates five distinct `main` commits per runner class, computes the §13 values, prints a before/after table, and with `--write` edits `fixtures/perf-budgets.json` in place preserving key order and formatting.
- `fixtures/perf-budgets.json` — the new numbers.
- `docs/plan/deltas/` — a short delta (for example `docs/plan/deltas/2026-09-20-budgets.md`): the table, the runs, the reference file's commit.

## Do this, in order
1. `tighten-budgets.mjs` against a fixture set of five fake `perf.json` files; the test asserts the arithmetic (1.2× median; max of five; envelope from observed cold with the unchanged multiplier), that four runs or two from the same commit are refused, and that a run class breaking `(max/min) × tolerance ≤ 1.20` keeps its old baseline with a printed reason.
2. Ask for the reference run (`needs-human.md`: "run `node scripts/measure-startup.mjs --reference --runs 5` on the reference Mac and commit `results/reference-<date>.json` to this branch").
3. Pick the five most recent green `ci` runs on `main` at distinct commits per runner class; run the script; `--write`.
4. `node scripts/gate-perf.mjs --selftest` and `pnpm gate:perf` on both runners.

## Tests → expected
| Check | Expect |
| --- | --- |
| `tighten-budgets.test.mjs` | arithmetic, refusals and the invariant fallback |
| gate schema check | invariant holds for every runner class |
| `pnpm gate:perf` | green on both runners with the new numbers |
| diff | no multiplier, tolerance or cold envelope multiplier raised; no `baseline_waived` removed without the spread quoted |

## Acceptance → check
The CSV row verbatim; each clause maps to a row above or to `derived_from` fields present in the diff.

## Do not
Raise any number to make the gate pass. Use fewer than five runs. Hand-edit numbers the script computes.
