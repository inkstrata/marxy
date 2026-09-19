# ADR-0013 — Speed budgets are CI gates; single-instance always; resident mode opt-in

**Status:** accepted, amended 2026-09-18 (cold start is an observation, not a budget) · **Source:** brainstorm A17, Q13, docs/14, docs/19

## Decision
The budgets in `AGENTS.md` (open indexed document < 50 ms; palette keystroke < 16 ms;
typeset viewport < 100 ms; live-reload < 100 ms; find < 50 ms) are hard CI failures from
Phase 0, measured on the packaged application over the corpus, on macOS and Linux runners,
with a stored baseline and a regression tolerance (ADR-0022).
The application is single-instance: a second `marxy file.md` routes to the running process.
"Stay resident after the last window closes" is a preference, **off by default**.

**Cold start to first readable text is not a product budget.** It is a standing observation
of the sphere of concern: every measurement records `cold_start_first_text_ms` and
`cold_procedure`, a record without them fails, the number is printed, and a slower launch
is a cost a story must own. There is no ceiling and no tag fails for exceeding 500 ms.
Amendment: Ian, 2026-09-18. Detail in ADR-0022 Amendment 2.

## Why
"Very fast" is a promise the user tests within ten seconds. The framework is not the binding
constraint; fonts, grammars, KaTeX and the index in front of first paint are. Fonts load
eagerly; everything else is deferred behind first paint and measured. Packaged cold start
is a Tauri fact (honest numbers, 2026-09-18: 2844 ms macOS, 1735 ms Linux). Watching it
and refusing silent inflation is the honest promise; 500 ms was not.

## Consequences
- `scripts/gate-perf.mjs` reads `perf/budgets.json` and the run's results; regressions fail.
- Bundle size has its own budget (`gate-bundle`): 25 MB installed on Linux, 30 MB on macOS.
