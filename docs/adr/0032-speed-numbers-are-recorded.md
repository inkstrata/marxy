# ADR-0032 — Speed numbers are recorded; they are not CI failures

**Status:** accepted 2026-09-20 (MARXY-151) · **Amends:** ADR-0013 (the "regressions are hard
failures" clause for named interaction times), ADR-0022 (CI envelope, baseline, cold envelope
and parse two-tier rules), ADR-0029 (extends "no product cold-start ceiling" to every timing
quantity) · **Source:** Ian's ruling 2026-09-20, after a 0.05 ms ubuntu parse miss failed
main and PR #99 on a rented runner

## Decision

No named interaction time is a CI failure. Keep measuring
`cold_start_first_text_ms`, `warm_start_first_text_ms`, `parse_long_technical_ms` and the
other product keys. Print them. Do not exit 1 because a number of milliseconds sat above an
envelope, a baseline, a product budget or a cold envelope.

The gate still fails when the measurement is missing or dishonest: no `results/perf.json`,
the wrong `env_class`, a sample smaller than it claims, an absent cold mark or procedure, a
missing parse snapshot, an unknown runner class. Those are not speed commitments. Bundle
size stays a gate (`gate-bundle`).

CI never remasures to confirm a timing overage. There is nothing to confirm: the overage is
not a fail.

A slower launch is still a cost a story must own. The file
`fixtures/perf-budgets.json` remains the standing observation. CI still does not write a
higher number into the repo to make a red gate green, because the gate is no longer red on
those numbers.

## Why

The two-tier machinery (ADR-0022) was built to keep "very fast" as a promise on hardware
that cannot keep it. Shared runners then spent a week failing on noise: an 11 % macOS
spread, a 0.05 ms parse miss against a 16.00 ms ceiling, a `cold_warm_ratio` of 0.99. Ian
ruled there are no hard speed commitments. A gate that fails the merge bar on a number we
do not promise is worse than no gate.

ADR-0029 already said this for cold start. The same sentence is true of every other timing
quantity we print.

## Consequences

- `scripts/gate-perf.mjs` records every timing comparison and exits 0 on the value. It still
  exits 1 on a missing or dishonest record.
- `AGENTS.md`'s budget table and verification list stop saying CI fails on those times.
- ADR-0013 and ADR-0022 are not edited (accepted ADRs are append-only). This record is the
  amendment.
- `fixtures/perf-budgets.json` keeps its product and CI observations; moving a product
  number is still an explicit edit. Nothing in that file is a merge-bar ceiling.
