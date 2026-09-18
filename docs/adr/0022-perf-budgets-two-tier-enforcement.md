# ADR-0022 — Product budgets are enforced on reference hardware; CI enforces an envelope and a baseline

**Status:** accepted, amended (Amendment 1 — the metric split, 2026-09-18) · **Amends:** ADR-0013 (its measurement clause only; the budgets themselves
and "regressions are hard failures" stand unchanged) · **Source:** the first red `gate:perf` run on
GitHub-hosted runners, 2026-09-18

## Decision
The budgets in `AGENTS.md` are **product** budgets, measured on reference hardware: the maintainer's
macOS machine, or any machine where `MARXY_PERF_ENV=reference`. In that mode a round is **k ≥ 5 cold
launches, each preceded by a recorded cold-making step**, and `scripts/gate-perf.mjs` compares the
median of those cold launches against the product number and fails at 501 ms, with no multiplier and
no tolerance. It fails if the record does not certify each launch as cold. *(Obligation, not
description: **MARXY-69** implements this round. Until it lands, reference mode fails with a message
saying the product cold-start budget is not enforceable and naming that story.)* `reference` is the
default whenever `CI` is unset, and the release runbook runs it before a tag; the gate fails if
`results/perf.json` is missing or was not produced in `reference` mode.

On GitHub-hosted runners (`MARXY_PERF_ENV=ci`, set by `.github/workflows/ci.yml`) the same script
enforces two named quantities. `warm_start_first_text_ms`, the median of the post-first launches, is
the change detector and is held to `min(product × multiplier, baseline × tolerance)` per runner
class. `cold_start_first_text_ms`, which is the first launch and only the first launch, is held to an
absolute per-class `cold_envelope_ms` with no baseline and no tolerance. A breach of either is
confirmed by re-measure before it fails. *(Obligation, not description: **MARXY-70** derives
`cold_envelope_ms`, the per-class tolerance and the confirmation rounds. Today the warm rule runs
with the numbers below and the tolerance is the flat 1.10 this ADR adopted; the cold number is
recorded and printed, and the gate fails when it or `cold_procedure` is absent.)* Both numbers live
in `fixtures/perf-budgets.json` under `ci.<runner_class>`; the multiplier carries a `derived_from`
record (commit, runner image, reference median, runner median) and is derived as
`ceil(runner_median / product_budget × 1.3)`. Adoption values: `ubuntu-latest` ×20, baseline 7719 ms;
`macos-latest` ×5, baseline 1901 ms — **superseded**: 1901 ms is a warm median and 7719 ms is a
median over one unidentified surviving launch. MARXY-70 re-derives both, and their `derived_from`
records that the previous values came from a warm median.

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

## Amendment 1 — the metric split (2026-09-18, MARXY-63)

**Status:** accepted · **Source:** the escalation in `orchestration/results/MARXY-19.json` and
`docs/plan/deltas/2026-09-18-cold-start-metric-falsified.md`

**First, a withdrawal.** An earlier Amendment 1 — gating CI on the *minimum* of a multi-launch round
— was drafted in `docs/plan/deltas/2026-09-18-perf-variance.md` and never landed. It is withdrawn,
not superseded: applied to this measurement it is inverted. Cache warmth is one-sided in the
opposite direction to contention, so the minimum of a rapid-fire round is the *warmest* launch; a
gate on it would defend a number no reader experiences and would get easier as the runner's cache
improved. Nothing in the tree implements it and nothing should.

**What was falsified.** `cold_start_first_text_ms` has never measured a cold start.
`scripts/measure-startup.mjs` launched the packaged app eight times two seconds apart, sorted the
array and took the middle, so only launch 1 was ever cold and the reported figure was warm by
construction; on `ubuntu-latest` seven of eight launches produced no mark and were dropped silently,
leaving a "median" over one launch nobody could name. Two runner classes were reporting different
quantities under one name, and neither was the quantity ADR-0013 budgets.

**The premise this ADR rested on, corrected.** *CI does not measure a scaled version of the reader's
experience. It detects change in a related quantity on a rented machine. The reader's experience is
enforced on reference hardware and nowhere else.* Everything below follows from that sentence.

1. **Two quantities, two names.** `cold_start_first_text_ms` is **launch 1 and only launch 1** — it
   never holds a statistic over more than one launch. `warm_start_first_text_ms` is the **median of
   launches 2..N**, and it is the quantity CI has actually been gating since MARXY-55. The CI rule
   keeps every number it had — the same envelope, the same baselines, the same 1.10 tolerance — and
   changes only which key it reads, under a name that is true.
2. **The sample is never sorted.** `results/perf.json` carries `runs` in launch order and a
   `launches` array with one entry per attempted launch — `index`, `ms` (null when no mark), `ok`,
   `exit_code` and `stderr_tail` — including the launches that produced nothing. Every statement
   about which launch is which depends on that order surviving, and a launch that fails is now
   diagnosable rather than invisible.
3. **Coldness is stated, not implied, and stated no more strongly than the procedure earns.**
   `cold_procedure` records what was actually done to make launch 1 cold. On CI that is
   `"process-cold only"`: first launch by the measuring script, no marxy process running when it
   starts, and the runner's page, dyld and font caches left alone. Evicting them was considered and
   rejected — it costs minutes per round and produces a *colder-than-reader* number, a third quantity
   to misname. What the script does **not** control is the rest of the job: the desktop build step
   runs the CLI smoke check, which launches the app several times seconds earlier, so on CI the
   webview framework is already warm when the "cold" launch begins. `cold_warm_ratio` is how that
   shows: below 1 it means launch 1 was not the slow one and the record is not holding a cold start.
   *(Obligation: a round of genuinely cold launches belongs to reference hardware and is
   **MARXY-69**'s to build. Until then the CI cold number is a floorless observation of a partly
   warmed process, recorded honestly and gated by nobody.)*
4. **A record that measured less than it claims is a failure, in both tiers.** The gate exits 1 when
   `usable_runs` is below `runs_n`, when `cold_start_first_text_ms` is absent, when `cold_procedure`
   is absent or empty, or when fewer than eight launches stand behind the warm median. A measurement
   that quietly disappears is the failure mode this whole amendment exists to end; before it, a
   script that wrote an empty sample exited 0 and the gate printed `perf gate ok`.
5. **The cold number is recorded and printed, not yet gated** — that is MARXY-70's obligation, not a
   softening: it is not compared to a ceiling because no ceiling has been derived from evidence that
   exists. Its *absence* still fails.

**Unchanged, deliberately:** both runner classes gate; the product budgets; "regressions are hard
failures" (ADR-0013); and the rule that a baseline moves only by an explicit edit to
`fixtures/perf-budgets.json` in the pull request that costs the time, with CI never writing to the
repo. MARXY-63 does not touch that file at all, so "no product budget number changed" is structural
rather than promised, and a check in its pull request asserts the file is byte-identical to `main`.

**Consequences of the amendment**
- `scripts/measure-startup.mjs` launches 9 times (1 cold, 8 warm), records launch order and per-launch
  evidence, and exits non-zero on a round that measured less than it claims.
- On Linux it launches into a 24-bit Xvfb screen with `WEBKIT_DISABLE_DMABUF_RENDERER`,
  `WEBKIT_DISABLE_COMPOSITING_MODE` and `LIBGL_ALWAYS_SOFTWARE`, **inside a D-Bus session bus**
  (`dbus-run-session`), and waits up to 60 s as a backstop. The drop-out that discarded seven
  launches in eight was the missing session bus: without one the GTK/WebKit startup path blocks for
  about 30 s before the webview runs any script, and the old 15 s kill turned that into "no mark".
  Measured on one runner and commit: 30.9 s with no bus, 0.9 s with one. Every reader's Linux desktop
  has a session bus, so a number measured without one was mostly a timeout and not this application —
  which is the same error, in a different place, as calling a warm start a cold one.
- `scripts/gate-perf.mjs` reads `warm_start_first_text_ms` for the CI rule, requires the cold record,
  and in reference mode additionally fails while the product budget is unenforceable (MARXY-69).
- The release runbook step in `docs/sdlc.md` is rewritten by MARXY-69; until then a tag is blocked,
  which is the correct thing to block while the budget cannot be proved.
