# ADR-0013 — Speed budgets are CI gates; single-instance always; resident mode opt-in

**Status:** accepted

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

## Amended 2026-10-11

The author ruled (2026-10-11) on F-31: the paint signal may fall back. The earlier rule that the wait for a
paint has no deadline becomes **no deadline that pretends to be a paint**. After two animation frames and about
2 s (`PAINT_FALLBACK_MS`) with no engine paint entry, `waitForEnginePaint` resolves with `signal=frames-only` and
the boot goes on. `MARK painted` carries that signal, and **no `first_text` is printed**: a frames-only boot is not
a paint, so it is never a cold-start sample and the metric stays honest. The CLI smoke reads the marker, reports the
boot as frames-only (a failure where the smoke is required, a skip where it is not), and never as a paint. A hidden
`#doc` and a window that delivers no frames still get no result from the page; the shell's harness deadline bounds
those. Cause: 1 of 391 boots in the 2-CPU CI image on Linux WebKit never received a paint entry.
