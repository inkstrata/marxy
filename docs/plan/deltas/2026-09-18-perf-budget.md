# Plan delta — 2026-09-18 (perf budget, out of band)

Second delta of the day, written for one decision rather than a cycle. Trigger: `main` and every
open pull request are red, on `pnpm gate:perf` and nothing else. The whole fleet is stalled behind
it, so this pass changes exactly one thing and leaves the rest of the board alone.

## What broke, and what it was not

`cold_start_first_text_ms` measured 7719 ms on `ubuntu-latest` and 1901 ms on `macos-latest`
against a budget of 500 ms. No story caused it: the binary under measurement is today's
hello-world shell, which does nothing a budget could be blamed for. The Linux runner has no GPU
and software-renders WebKitGTK; neither hosted runner can reach 500 ms and neither ever will.

This is the perf machinery from the handoff (`scripts/measure-startup.mjs`, `scripts/gate-perf.mjs`,
the CI steps) running ahead of the story that owns it, MARXY-15, which is still To Do. The
machinery was right to exist early. What it got wrong is conflating one number — the product
promise on real hardware — with the only environment we can measure on every pull request.

## The decision

Two tiers, recorded in data, per **ADR-0022** (landed by the new story below):

- **Reference tier.** The ADR-0013 numbers, unchanged, enforced with no multiplier and no
  tolerance whenever `CI` is unset — a local `pnpm gate:perf` and the pre-tag step of the release
  runbook. 501 ms fails. The product's promise is still a hard gate; it is gated where it is
  measurable.
- **CI tier.** Per runner class, `min(product × multiplier, baseline_ms × 1.10)`. The multiplier
  (ubuntu ×20, macos ×5, derived as `ceil(runner_median / product_budget × 1.3)`) states an
  absolute ceiling with an audit record; the baseline (7719 ms, 1901 ms at adoption) is what
  actually catches regressions, on both platforms, on every pull request. A change that
  legitimately costs 15 % of cold start must move the baseline in its own diff.

Rejected, with reasons: **advisory in CI** — it stops measuring the central promise on the only
signal we get per pull request, and defers the discovery to release; **dropping the Linux runner** —
Linux ships, WebKitGTK is the riskier engine, and a Linux-only regression would be invisible until
an AppImage was installed; **multiplier alone** — a 3× regression hides under a 15× envelope;
**baseline alone** — nothing then states an absolute ceiling for MARXY-53 to ratchet. Lowering the
product budget was never on the table.

## Story changes

### New

- **MARXY-55 — Enforce product perf budgets on reference hardware and an envelope
  plus baseline in CI** (Phase 0, `speed`, **no dependencies, ready now**). Paths:
  `fixtures/perf-budgets.json`, `scripts/gate-perf.mjs`, `scripts/measure-startup.mjs`,
  `.github/workflows/ci.yml`, ADR-0022 and the ADR index, `docs/sdlc.md`. Its acceptance is a
  `--selftest` mode over inline fixtures covering pass, ceiling breach, baseline regression,
  reference-mode 501 ms, unknown runner class and a null baseline — so the failure paths are
  proven by exit codes rather than by a green run that proves only that today's numbers fit.

No story dropped, none split: nothing has failed twice and no implementor diff exists yet.

### Edited

- **MARXY-15** — its acceptance said `gate:perf` fails when `cold_start_first_text_ms > 500`. That
  is the assumption that broke `main`. It now names the two CI rules, keeps 500 ms as the
  reference-mode failure, and says the mechanism is not its to re-decide.
- **MARXY-53** — assumed budgets start loose and get tightened once. It now tightens both tiers
  together, ratchets baselines to 1.1× of the last measured medians, and forbids raising a
  multiplier — the one edit that could turn the ratchet backwards.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-55` with no deps, added to `phases.0` | It is the unblocker; gate logic needs neither the shell story nor MARXY-15. |
| `MARXY-15 → MARXY-55` | MARXY-15 asserts the budget in CI; it must assert the rules that exist. |
| `MARXY-53 → MARXY-55` | It tightens a file whose shape this story defines. |

`MARXY-16` shares `fixtures/perf-budgets.json` but already depends on MARXY-15, so no edge added.

## Re-sequencing

One insertion at the head of Phase 0, ahead of MARXY-13 and MARXY-15. Everything else keeps its
order. This is worth a lane before any product code for the same reason MARXY-9 was: with `main`
red, no story in any lane can reach Done, so throughput is zero until it lands.

## Risks

- **Closed:** every merge blocked by an unreachable budget — the definition of a stalled fleet, and
  the second environment-shaped blocker of the day after the workflow token.
- **Down:** a future "just make it advisory" fix under schedule pressure, which would have quietly
  ended perf measurement; the CI tier is now strict enough that nobody needs to reach for it.
- **Up, and watched:** the CI baselines are hello-world numbers. The first real feature work —
  fonts, the parser, KaTeX — will breach them legitimately and repeatedly, and each breach costs a
  reviewer a judgement call on a number in a diff. That is the intended cost; it becomes a problem
  only if re-baselining turns into a reflex. If a phase ends with more baseline edits than
  measurable causes, the next planner pass should require a reference-mode number in the PR body.
- **Unchanged:** the roadmap tripwire "cold start > 500 ms after Phase 2 on either platform" still
  has no data. It now explicitly reads against the reference measurement, so the tripwire cannot
  be tripped by a rented runner.

## Taste review

Nothing visual changed; no queue entry owed.
