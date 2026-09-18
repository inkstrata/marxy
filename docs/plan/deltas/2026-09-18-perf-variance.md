# Plan delta — 2026-09-18 (perf gate variance, out of band)

> The ADR-0022 amendment recording this decision lands with MARXY-63, the story that
> implements it, not here: an accepted ADR must not describe behaviour the tree does not yet have,
> and ADR-0022 is in that story's paths. Until then this note is the record.


Third delta of the day and the second on the perf gate. Trigger: PR #6 (MARXY-17, the typeface
specimen) is red on `gates (macos-latest)` with

    cold_start_first_text_ms: 2244 ms exceeds the baseline ceiling 2091.1 ms (baseline 1901 ms + 10 %)

on a diff that touches `docs/taste-review/**`, `scripts/specimen/**`, `fonts/ibm-plex-mono/**` and
`CHANGELOG.md` — nothing in the binary and nothing in the render path. The gate is working exactly
as ADR-0022 specified it. The specification was wrong.

## What the numbers actually say

All medians of 8 launches of the same hello-world shell:

| Runner class | Observed medians (ms) | Spread (max/min) |
| --- | --- | --- |
| `macos-latest` | 1466, 1901, 2029, 2244 | 1.53× |
| `ubuntu-latest` | 7320, 7667, 7719 | 1.05× |

Two facts follow, and the whole decision follows from them.

1. **A 10 % tolerance around a single observed median cannot hold on `macos-latest`.** The estimator's
   own spread is 53 %. Any PR is a coin flip; three of the four observations sit under the current
   ceiling and one does not.
2. **Widening the tolerance to fit that spread is not available.** A tolerance that survives 1.53×
   also swallows a 50 % cold-start regression, and this project's whole claim is the cold start. So
   the tolerance is not the lever. The *estimator* is.

The third fact, the one that makes a fix possible: **runner noise is one-sided.** Contention, a
throttled core, a cold page cache and a noisy neighbour all make a launch slower. Nothing makes it
faster than the code allows. A median of 8 mixes the four slowest launches into the number we gate
on; the *fastest* launch of a batch is an estimate of the floor the code imposes, and a real
regression raises that floor by exactly the amount it costs.

## The decision

Four changes, all inside ADR-0022's existing two-tier shape. Amendment 1 to ADR-0022 records them.

1. **The CI tier gates on the floor, not the median.** 12 launches per round, the first discarded as
   warm-up, and the gated statistic is the **minimum** of the remaining 11 (`floor_ms`). The
   reference tier keeps the **median**, because the two tiers answer different questions: the
   product budget is a promise about what a reader feels on a quiet machine, and the CI number is a
   change detector on a rented one. Different questions, different statistics, and the reference
   tier gets no weaker.
   Because a minimum-of-N is biased low as N grows, N becomes part of the baseline record and the
   gate fails when the measured N differs from the N the baseline was recorded at.
2. **Tolerance is measured per runner class, recorded, and bounded by the regression it must
   catch.** No flat 10 %. Each runner class carries `tolerance` plus at least five
   `observed_floors_ms` taken on `main`, and `baseline_ms` is the **highest** of those floors. The
   gate refuses to run a configuration that cannot do its job: it fails the schema unless

       (max(observed_floors) / min(observed_floors)) × tolerance ≤ 1.20

   which is the "does not hide a 20 % regression" promise turned into an assertion. Detection power
   is that product, not the tolerance alone: a regression of `r` fails when
   `1 + r > spread × tolerance`.
3. **A breach is confirmed before it is a failure.** In CI mode only, a breach re-measures — up to
   two further rounds in the same job — and the gate fails only when **every** round breaches. A
   real regression breaches every round; an outlier does not survive three. The pass path is loud,
   not quiet: a confirmed-noise pass prints the breaching round and its margin and writes every
   round into `results/perf.json`, so the frequency is countable. The gate still exits non-zero when
   the breach reproduces; nothing becomes advisory and no `continue-on-error` appears anywhere.
4. **If a runner class cannot satisfy the invariant, it loses the baseline rule explicitly.** If
   `macos-latest`'s own floor spread turns out to exceed ~1.14 even on the floor statistic, no
   number can both tolerate it and catch 20 %. The answer then is not a number that lies: the class
   records `baseline_ms: null` with a `baseline_waived` block naming the observed floors and the
   escalation, keeps the envelope, and the maintainer signs it off. The gate fails if a waiver is
   present without that record.

Unchanged, deliberately: both runner classes gate; the envelope and its `derived_from` audit record
stay; the product budgets are untouched; **a baseline still moves only by an explicit edit to
`fixtures/perf-budgets.json` in the pull request that costs the time, and CI still never writes to
the repo.** That incentive is the thing ADR-0022 was written to create and every option below was
judged against it first.

## What I rejected, and why

- **A flat wider tolerance, or a per-runner tolerance derived from the measured spread alone.** On
  `macos-latest` that is ≥1.55, which hides a 50 % regression on the platform the product budget
  lives on. The spread is *input* to the tolerance, not the tolerance itself; without changing the
  statistic first it only buys quiet.
- **A baseline set from a high percentile of several recorded runs, with the tolerance left at 10 %.**
  This is widening under another name: the baseline becomes a noise-derived number, so it stops
  meaning "this is what the code costs" and starts meaning "this is the worst the runner did", and
  the next outlier is still above it. I kept the multiple recorded runs — they are how the tolerance
  is justified — but the statistic they aggregate is the floor, not the tail. (The baseline is the
  highest observed *floor*, which is not the same as the 95th percentile of all launches.)
- **N consecutive failing CI runs across pull requests.** It lets the first N−1 pull requests merge
  while a regression is live, and then fails the Nth for a cost somebody else introduced. Re-measure
  inside one job is the same statistical idea without the mis-attribution, and it keeps the failure
  attached to the diff that caused it.
- **Making the CI signal a trend across `main` instead of a per-PR absolute.** Two fatal problems:
  it needs CI to write state back to the repo, which is the exact mechanism ADR-0022 forbids
  because it is what lets noise move the number with no one reading it; and it moves detection to
  after the merge, where no diff owns it and nobody is on the hook. Trend data is still produced —
  every round is in the uploaded `results/` artifact — but as evidence for a planner pass, not as a
  gate.
- **Advisory in CI, or dropping the macOS baseline to escape today's red.** Rejected for the reasons
  in the previous delta. A gate that cannot fail is measurement theatre, and macOS is the reference
  platform's nearest relative.
- **Re-baselining to 2091+ ms to unblock PR #6.** This is the one that would do lasting damage: it
  writes a noise excursion into the number permanently, and it teaches the fleet that the way past a
  red perf gate is to edit the baseline. The baseline edit must stay expensive and must stay tied to
  a real cost.
- **Simply raising the launch count and keeping the median.** More launches shrink the estimator's
  variance only as `1/√n` against a heavy right tail; getting a median of 8 with a 53 % spread down
  inside 10 % would need an implausible number of launches and minutes of CI per job. Discarding the
  warm-up launch is kept — it is free and it removes a known one-sided cost — but on its own it is
  not the fix.

## The risk I am accepting

**Detection floor.** The configuration provably catches a sustained 20 % regression (that is
invariant (2), machine-checked) and provably does not catch a 5 % one. Between those, detection
depends on the measured spread: the smaller the observed floor spread, the tighter the real
threshold, so `ubuntu-latest` at 1.05× will catch far less than 20 % and `macos-latest` will sit
near the bound. I am accepting that a slow accumulation of 5 % regressions can cross 20 % without
a single pull request tripping the gate. The counterweight is the reference-tier run before every
tag, which is absolute and has no tolerance at all, plus MARXY-53's ratchet, which re-records the
baselines downward as the numbers improve so the accumulated slack is periodically reclaimed.

**Cost.** Twelve launches instead of eight adds roughly 30–40 s per runner in the passing case, and
a confirmed-noise pass costs up to two extra rounds (~3 min on `ubuntu-latest`) on the runs where it
fires. Cheaper than a coin-flip gate.

**The thing I am explicitly not accepting** is a gate nobody believes. If the fleet learns that red
on `gate:perf` means "re-run it", the gate is gone whatever its configuration says.

## How we would know I was wrong

Four countable signals, all from data the gate already writes:

1. **Confirmed-noise passes.** If more than one pull request in five records a confirmed-noise pass
   on a runner class, the floor statistic did not remove the variance and the tolerance is set too
   close to the noise. Re-derive from the recorded rounds, or waive that class's baseline under
   change (4).
2. **A red gate on a diff that cannot have caused it.** A repeat of today — three rounds all
   breaching on a docs-only PR — falsifies the one-sided-noise assumption outright and the rule
   needs rethinking, not retuning.
3. **Baseline edits without a measurable cause.** If a phase ends with more `baseline_ms` edits than
   there are stories that plausibly cost cold start, the incentive has decayed into a reflex; the
   next planner pass requires a reference-mode number in the PR body for any baseline edit.
4. **A regression found at the pre-tag reference run that CI never flagged.** That is the detection
   floor cashing in. One occurrence justifies tightening the invariant from 1.20 to 1.10 and paying
   for it with more launches.

If (1) and (2) stay at zero for a phase while (4) never fires, the rule is right.

## Story changes

### New

- **MARXY-NEW-perf-floor-statistic — Gate CI cold start on a measured floor with a measured
  tolerance** (Phase 0, `speed`, blocks nothing else in flight but wants the next free lane).
  Paths: `fixtures/perf-budgets.json`, `scripts/gate-perf.mjs`, `scripts/measure-startup.mjs`,
  `.github/workflows/ci.yml`, `docs/adr/0022-perf-budgets-two-tier-enforcement.md`,
  `docs/adr/README.md`. Its acceptance carries the failure cases — a reproduced breach, a breach
  that clears on re-measure, a mismatched N, a configuration that violates the 1.20 invariant, a
  waiver without its record — as `--selftest` exit codes, because a rule about noise cannot be
  proved by a green run.

No story dropped. Nothing has failed twice; MARXY-55 did what it was asked and the mechanism it
implemented is what needs amending.

### Edited

- **MARXY-15** — its acceptance says "runs the app 8×" and names `baseline_ms × 1.10` against the
  median. Both are now the previous mechanism. It names the floor statistic, the recorded tolerance
  and the confirmation rounds, and keeps the rule that the mechanism is not its to re-decide.
- **MARXY-53** — its ratchet set `baseline_ms` to 1.1× the last measured *median*. It now ratchets
  against the recorded floors, must keep the 1.20 invariant true after tightening, and still may not
  raise a multiplier or a tolerance.

### Dependencies for Ian to wire

| Edge | Why |
| --- | --- |
| `MARXY-NEW-perf-floor-statistic → MARXY-55` | It amends the file, the script and the ADR that MARXY-55 created. |
| `MARXY-15 → MARXY-NEW-perf-floor-statistic` | MARXY-15 asserts the CI rule; it must assert the rule that exists. |
| `MARXY-53 → MARXY-NEW-perf-floor-statistic` | The ratchet tightens fields whose shape and invariant this story defines. |

Path conflicts, not dependencies, so they are a lane constraint rather than an edge: **MARXY-62**
also edits `.github/workflows/ci.yml` and **MARXY-61** claims `scripts`, so neither may be in a lane
at the same time as this story. This one goes first — it is the one holding merges.

## Re-sequencing

One insertion at the head of Phase 0, immediately after MARXY-55 and ahead of MARXY-13, MARXY-15,
MARXY-61 and MARXY-62. Everything else keeps its order. Every open pull request is currently subject
to a 1-in-4 red on `macos-latest` regardless of its contents, so this is throughput, not polish.

## PR #6

Do not wait for the fix and do not edit the baseline. Re-run `gates (macos-latest)`: three of the
four observed macOS medians are under the current ceiling, so a re-run is the confirmation rule
applied by hand, ahead of its automation. If a re-run is green, merge on the green run and note in
the PR body that round 1 measured 2244 ms and round 2 measured under the ceiling. If two successive
re-runs both breach, hold PR #6 until this story lands rather than moving the number — a reproduced
breach on a docs-only diff is signal (2) above, and it would mean this delta is wrong.

## Taste review

Nothing visual changed; no queue entry owed. PR #6's specimen artifacts remain queued on their own
story.

## Observed samples, 2026-09-18

Three independent sightings by the end of the day, all single-sample packaged-app cold starts on
`ubuntu-latest` against the 8490.9 ms CI ceiling: 7068, 7511 and 7719 ms on `main`; 8641 ms failing
then 7060 ms passing on the same commit of PR #4; 9576 ms failing then 6990 ms passing on PR #5. Two
of the three runs that failed were re-run to green without a code change, which is the specific
failure mode the floor statistic is meant to end — a gate that a diff can pass or fail by chance
teaches implementors to re-run rather than to measure, and a real regression arriving in that noise
would be indistinguishable from it. MARXY-63 should be dispatched before more stories learn the
habit.

## macOS, and a risk this creates for the floor statistic

PR #7 then failed and passed `gates (macos-latest)` on one commit at 2448 ms and 463 ms for
`cold_start_first_text_ms` — a 5.3x spread straddling the 1901 ms baseline, against the 1.53x this
note recorded from four medians. Two consequences for MARXY-63, which already owns the per-class
numbers.

First, criterion 3 bounds `(max(observed_floors_ms) / min(observed_floors_ms)) * tolerance` at 1.20,
and macOS may simply not satisfy it. That is the criterion working: a class whose floors cannot be
bounded has no usable baseline, and criterion 7's explicit `baseline_waived` is the honest outcome —
the envelope alone, with the reason and the measured floors written down. Reaching for a wider
tolerance to make the rule fit would restore exactly the gate this story exists to remove.

Second, and more important: 463 ms is close to the 500 ms *product* budget, which a packaged cold
start on a shared macOS runner should not reach. The likely reading is that it was not cold — a warm
webview, a cached binary, or the OS still holding the pages. A minimum-of-N then drifts toward
whichever launch was warmest, and the gate ends up defending a number the reader never experiences,
which is the same failure as a flaky gate wearing better clothes. Discarding one warm-up launch does
not answer this, because the contamination runs the other way. MARXY-63 must show that its floor is a
floor over *cold* launches: state what makes each launch cold, and have the selftest reject a run list
whose minimum is implausibly far below its median rather than silently adopting it.

## The metric is not measuring a cold start at all

Read the `results/perf.json` artifacts from four CI jobs before designing anything further. The
suspicion above is confirmed structurally rather than probably: `measure-startup.mjs` launches the
packaged app 8 times two seconds apart, sorts, and takes the median, so only launch 1 is ever cold and
`cold_start_first_text_ms` reports a **warm** start whenever all eight launches survive.

```
macos, the run that passed:  [377, 395, 432, 443, 463, 520, 564, 2393] → median 463
macos, an earlier push:      [1798, 1824, 1968, 2029, 2054, 2061, 2062, 3557] → median 2054
macos, the merge run:        [486, 1468, 1531, 1559, 1571, 1709, 1764, 2624] → median 1571
ubuntu, all three runs:      [7519] / [7506] / [6898]
```

Three consequences, each of which changes MARXY-63 rather than confirming it.

**A minimum is the wrong statistic, and precisely backwards.** Every macOS job carries one value far
above an otherwise tight cluster — 2393, 3557, 2624 ms — which reads as the one genuinely cold launch,
discarded by the median. A floor would discard it harder: the minimum of a round is the *warmest*
launch, so gating on it would defend a number no reader ever experiences and would improve as the
runner's cache got better. If that inference is right, the figure to hold against the 500 ms product
budget is 2400–3500 ms, five to seven times over, and 463 ms landing near 500 is a coincidence of a
fast runner's warm cluster rather than a packaged cold start nearly meeting budget. The inference is
from the shape of the distribution, not from ordering, because the script sorts before writing and
destroys launch order. Recording runs in launch order and the first launch separately settles it in one
line, and no further design should be done before that is recorded.

**The variance is between runs, not within them.** The macOS warm cluster sits at ~380–560 ms in one
job, ~1470–1760 in another and ~1800–2060 in a third — the whole distribution moving about 4× — while
inside any one job the cluster spans only 1.15–1.5×. So a spread guard computed over one round sees a
tight, well-behaved distribution and concludes macOS deserves to keep its baseline. That is the wrong
conclusion drawn from a correct measurement, and it is an argument for the waiver over any tolerance.

**Ubuntu is quietly worse than macOS.** All three Ubuntu jobs report a median over a *single* sample:
seven of eight launches never print the `first_text` mark and are silently dropped, and neither the
measurement script nor the gate checks `runs.length`. The three readings agree within 9%, so it is a
reproducible n=1 rather than noise — and being the lone survivor it is plausibly the *cold* launch. If
so the two runner classes report different quantities under one metric name, roughly cold on Ubuntu and
warm on macOS, which makes their baselines incomparable with each other and with the product budget.
Evidence recorded by the MARXY-19 implementor in `orchestration/results/MARXY-19.json` under
`escalation`, with the raw arrays.

## The reference tier reports ok on zero samples

Found by the MARXY-13 round-2 review, on a Mac asleep in dark wake where the webview receives no
animation frames:

```
$ node scripts/measure-startup.mjs   →  cold start median null ms over 0 runs (reference mode), exit 0
$ node scripts/gate-perf.mjs         →  perf gate: reference mode / perf gate ok, exit 0
```

`gate-perf.mjs` skips a null metric (`if (v == null) continue`) and `measure-startup.mjs` exits 0 with
an empty `runs` array. In `ci` mode a null median does fail, so CI is safe — but ADR-0022 makes
`reference` the default whenever `CI` is unset, and the release runbook runs exactly that before a tag.
So the authoritative tier, the one step in the whole scheme that is supposed to measure what a reader
feels, currently prints `perf gate ok` having measured nothing. Whatever statistic is chosen, the
harness must refuse to report a number it does not have, and `results/perf.json` should record runs in
launch order with the first launch separate, so that whether a figure is cold or warm is a fact in the
file rather than an inference from the shape of a sorted array.
