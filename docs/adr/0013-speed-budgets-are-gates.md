# ADR-0013 — Speed budgets are CI gates; single-instance always; resident mode opt-in

**Status:** accepted · **Source:** brainstorm A17, Q13, docs/14, docs/19

## Decision
The budgets in `AGENTS.md` (cold start < 500 ms to first readable text; open indexed
document < 50 ms; palette keystroke < 16 ms; typeset viewport < 100 ms; live-reload < 100 ms;
find < 50 ms) are hard CI failures from Phase 0, measured on the packaged application over the
corpus, on macOS and Linux runners, with a stored baseline and a 10 % regression tolerance.
The application is single-instance: a second `marxy file.md` routes to the running process.
"Stay resident after the last window closes" is a preference, **off by default**; it is the
documented way to get sub-100 ms opens if the cold-start budget proves unreachable on a
platform.

## Why
"Very fast" is a promise the user tests within ten seconds. The framework is not the binding
constraint; fonts, grammars, KaTeX and the index in front of first paint are. Fonts load
eagerly; everything else is deferred behind first paint and measured.

## Consequences
- `scripts/gate-perf.mjs` reads `perf/budgets.json` and the run's results; regressions fail.
- Bundle size has its own budget (`gate-bundle`): 25 MB installed on Linux, 30 MB on macOS.
