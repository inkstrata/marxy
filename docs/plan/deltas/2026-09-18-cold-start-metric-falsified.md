# Plan delta — 2026-09-18 (the cold-start metric never measured a cold start)

> Fourth delta of the day, third on the perf gate, and the first that overturns one of my own.
> **Amendment 1 to ADR-0022 — the floor statistic — is withdrawn before it lands.** It was
> designed against a metric that does not measure what its name says, and applied to that metric
> it is not merely imprecise, it is inverted. The replacement amendment is drafted at the end of
> this note and lands with MARXY-63.

Trigger: the `escalation` object in `orchestration/results/MARXY-19.json`, and the last two
sections of `docs/plan/deltas/2026-09-18-perf-variance.md`. I accept the finding in full.

## What was falsified

`scripts/measure-startup.mjs` launches the packaged app eight times, two seconds apart, sorts the
array, and takes the middle. Three consequences, all structural rather than probabilistic:

1. **Only launch 1 is ever cold.** The median of eight rapid launches is drawn from the warm
   cluster by construction. `cold_start_first_text_ms` has reported a *warm* start on
   `macos-latest` in every job we have.
2. **The one cold launch is the one the median throws away.** Every macOS job carries a single
   value far above an otherwise tight cluster — 2393, 3557, 2624 ms. Against the 500 ms product
   budget the honest figure is 2400–3500 ms, five to seven times over, not the 463 ms that looked
   like we were nearly there.
3. **The two runner classes report different quantities under one name.** On `ubuntu-latest`
   seven of eight launches never print the mark and are silently dropped; the median is over
   n = 1, and the lone survivor is plausibly the cold one. So the macOS baseline of 1901 ms and
   the Ubuntu baseline of 7719 ms are not comparable with each other, and neither is comparable
   with the 500 ms product budget.

The premise ADR-0022 rests on — that the CI number is a scaled version of the reader's
experience — is therefore false as implemented. It is not a scaled version. It is a different
quantity wearing the same name.

## Decision 1 — what the CI tier gates on

**Split the metric in two, name each after the quantity it holds, and give each the tier and the
statistic it can actually support.**

- `cold_start_first_text_ms` = **launch 1 and only launch 1**. It is the quantity ADR-0013
  budgets. It is reproducible at most once per job, so in CI it gets an **absolute per-class
  ceiling** (`cold_envelope_ms`) with no baseline and no tolerance, confirmed by re-measure
  before it fails. n = 1 is honest about itself; what makes it safe to gate is that a breach
  must reproduce across rounds, and that the ceiling is absolute rather than a tight band around
  a noisy estimate.
- `warm_start_first_text_ms` = **median of launches 2..N**. This is the change detector. It is
  the quantity we have actually been gating since MARXY-55, and it keeps the baseline-plus-
  tolerance rule and its existing numbers under a name that is true. It is *not* compared to the
  product budget as though it were a scaled cold start.

The minimum is abandoned outright. The one-sided-noise argument in the previous delta was right
about contention and wrong about cache warmth, which is also one-sided and pushes the other way.
A minimum over a mixed cold/warm batch selects the warmest launch, so the gate would defend a
number no reader experiences and would get *easier* as the runner's cache improved. That is the
inversion the escalation identified and I have no defence of it.

**Rejected alternatives**

- *Gate the first launch alone and drop the warm metric.* Honest but blind. A cold n = 1 on a
  shared runner is the noisiest observation we can take; as the only signal it detects almost
  nothing and every red would be arguable. The warm metric is low-variance *within* a job and is
  where a render-path regression shows up first. Keeping both costs one number in a JSON file.
- *Gate a warm metric only, and leave cold to the reference tier per ADR-0022.* This was close to
  being the answer and it is what the user's own framing leans toward. I rejected it for one
  reason: we do get exactly one genuinely cold observation per job for free, and the current
  envelope (500 × 5 = 2500 ms on macOS) would have failed two of the three cold launches we have
  on record. Throwing that away means the only cold number in the project is taken by hand before
  a tag, and the last time a cold-start number was only checked by hand it was not checked at all
  (see decision 2). An absolute ceiling on a confirmed n = 1 is weak evidence, but it is evidence
  that arrives on every pull request and cannot silently drift.
- *A minimum over the warm launches only.* Defensible once the samples are homogeneous — but it
  buys nothing, because the dominant variance is between jobs, not within them (decision 4). The
  median is the statistic already in place and already understood, and changing it would be
  motion.
- *Make every launch cold.* Costed and rejected as the primary mechanism. On `ubuntu-latest`
  `sync && sudo sysctl vm.drop_caches=3` is available, on `macos-latest` `sudo purge` is; both
  cost tens of seconds per launch and evict the whole runner's cache, so a 12-launch round becomes
  minutes and everything after it in the job gets slower too. Worse, it does not reproduce the
  reader's cold start either: the reader's OS has its dyld shared cache and font caches warm, so
  drop-caches produces a *colder-than-reader* number, a third quantity to misname. The cheap part
  of coldness — no marxy process running, no warm webview, first launch after the build — is
  exactly what launch 1 has, and that is what we will name. What we *will not* do is imply
  coldness we did not create: the record carries a `cold_procedure` string stating what was
  actually done, and `"process-cold only"` is a legitimate and honest value.

## Decision 2 — is ADR-0013's 500 ms budget enforced anywhere?

**No. It is not enforced anywhere, and has not been since before MARXY-55.** Say it plainly,
because it is the most damaging finding in the escalation and the easiest one to soften.

The reference tier reads the same `results.cold_start_first_text_ms` written by the same
eight-launch median in the same script. `MARXY_PERF_ENV=reference` changes which ceiling the
number is compared against; it does not change what the number is. So `docs/sdlc.md`'s release
runbook step 2 — "this is the step where the product budgets in ADR-0013 are actually enforced" —
compares a warm median against a cold budget. And it fails in the lenient direction: the warm
number is the smaller one, so the gate passes when the product budget is being missed by 5×. A
tag cut today would carry a green pre-release perf run and an unmeasured product.

**What the release runbook must do instead.** Step 2 becomes: run `MARXY_PERF_ENV=reference` on
reference hardware, where a round is **k ≥ 5 genuinely cold launches**, each preceded by a
documented cold-making step recorded in the artifact, and the gate compares the **median of those
cold launches** against 500 ms with no multiplier and no tolerance. It fails if `cold_launches_n`
is under 5, if `cold_procedure` is absent, or if any warm launch entered the statistic. The
runbook says in words which quantity it enforces and that a tag cut without it has not measured
what the reader feels. That is MARXY-NEW-cold-start-reference-enforcement.

In the interval before that story lands, reference mode does not get quieter, it gets louder:
MARXY-63 makes reference mode fail with the message that the product cold-start budget is not
currently enforceable, naming the story that restores it. Reference mode runs before a tag, not
on pull requests, so this costs no throughput; it blocks a tag, which is the correct thing to
block when we cannot prove the budget.

## Decision 3 — the Ubuntu drop-out is a precondition, not something to gate around

**Diagnose and fix it first, in the same PR as the check.** MARXY-63's criterion 1 already asks
for a `usable_runs` check, and a check alone is the wrong shape here for two reasons.

The measurement reason: we do not know *which* launch survives. The script sorts before writing,
so launch order is destroyed, and the entire cold/warm split in decision 1 depends on knowing that
element 0 of the array is launch 1. Until the drop-out is understood, "the survivor is plausibly
the cold one" is an inference about a mechanism we have not identified, and every statistic built
on top of it inherits that uncertainty.

The process reason: adding `usable_runs < runs_n → exit 1` before fixing the cause turns
`ubuntu-latest` red on every pull request with no legitimate path to green. The only available
moves would then be to soften the check or to skip the class — the precise pressure this entire
thread exists to resist. A check must arrive with a configuration that can pass it.

So the sequence inside MARXY-63 is: identify the mechanism (captured stderr, exit codes and
per-launch timing, not speculation), fix it, then land the `usable_runs` assertion in the same
diff, with a green `ubuntu-latest` job on the branch as the evidence. The PR body states the root
cause in one paragraph. No statistic is chosen for Ubuntu until that job exists.

## Decision 4 — the spread guard must be cross-run, and macOS takes the waiver

**The guard is computed across jobs, never within a round, and a within-round dispersion may be
recorded but is never an input to the tolerance.** The evidence is unambiguous: the macOS warm
cluster sits at ~380–560 ms in one job, ~1470–1760 in another and ~1800–2060 in a third — the whole
distribution moving about 4× — while inside any one job it spans only 1.15–1.5×. A guard computed
over one round sees a tight, well-behaved distribution and concludes the class deserves a
baseline. That is a correct measurement supporting a false conclusion, which is the most expensive
kind.

Concretely: `spread = max(observed_warm_ms) / min(observed_warm_ms)` over **at least five
observations from five distinct CI jobs at distinct commits**, and the invariant
`spread × tolerance ≤ 1.20` is asserted against that. A selftest case must prove that a
configuration with a tight within-round dispersion and a 4× cross-run spread is rejected, because
that is the exact configuration macOS presents.

**macOS takes `baseline_waived`.** At 4× cross-run spread no tolerance can both accommodate the
runner and catch a 20 % regression, so the class records `baseline_ms: null` with a
`baseline_waived` block naming the reason, the observed warm values, the cross-run spread, the
escalation and the date, and keeps the envelope and the cold ceiling. I am stating this as the
expected outcome rather than a foregone one: the escape hatch is measurement, not argument. If the
corrected script — which fixes a real bug and may be removing part of the between-job movement
along with it — produces five cross-run observations satisfying the invariant at a tolerance of at
least 1.05, the class keeps its baseline and the PR shows the numbers. Reaching for a wider
tolerance to avoid the waiver is not available.

`ubuntu-latest`'s 7719 ms baseline does not survive either, for a different reason: it is a median
over one unidentified launch from a broken sample. It is re-derived from corrected measurements,
not carried forward.

## Decision 5 — MARXY-63 splits three ways

The honest sequence is diagnose → rename → gate, and those are three different kinds of work with
three different kinds of evidence. The story is also already large and its central mechanism has
just been withdrawn, so this is not a schedule optimisation.

| Story | Question it answers | Evidence it produces |
| --- | --- | --- |
| **MARXY-63** (kept, re-scoped) | Does the script measure what it names? | A green `ubuntu-latest` round with `usable_runs == runs_n`; launch order recorded; two named metrics |
| **MARXY-NEW-cold-start-reference-enforcement** | Is the 500 ms product budget enforced? | A reference-mode run over k ≥ 5 cold launches; a rewritten runbook step |
| **MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance** | What may CI's numbers be? | ≥ 5 cross-job observations per class; the tolerance, the waiver, the cold ceiling |

**The in-flight implementor keeps MARXY-63**, re-scoped. Their current branch implements the floor
statistic, which is withdrawn, so that work is discarded rather than adapted — an inverted
statistic cannot be refactored into a correct one. The verbatim instruction is at the end of this
note.

Boundaries: MARXY-63 does **not** touch `fixtures/perf-budgets.json` at all, which makes "no
product budget number changed" structural rather than promised; the other two stories each assert
byte-identity of the `product` object against `main`. Nothing in any of the three becomes
advisory, `continue-on-error` or `|| true`, and each carries the check that asserts it.

**The gating surface only grows.** Today one rule gates: a warm median against
`min(envelope, baseline × 1.10)`. After MARXY-63 the same rule gates the same numbers under a true
name, plus new failures for a short sample, a missing cold measurement and an unstated cold
procedure. After the other two, the cold metric gates in both tiers. At no point does a check that
runs today stop running.

## Proposed amendment to ADR-0022

ADR-0022 is a day old and I would rather amend it than let three stories drift away from it. Two
sentences in it are **wrong**, not incomplete, and one is right and load-bearing.

**Wrong, sentence 1** (Decision, ¶1): *"In that mode `scripts/gate-perf.mjs` compares the median
against the product number and fails at 501 ms, with no multiplier and no tolerance."*
The median of a rapid-fire round is a warm start; comparing it against a cold-start budget
compares the wrong quantity and does so leniently. **Replace with:** "In that mode a round is
k ≥ 5 cold launches, each preceded by a recorded cold-making step, and `scripts/gate-perf.mjs`
compares the median of those cold launches against the product number and fails at 501 ms, with no
multiplier and no tolerance. It fails if the record does not certify each launch as cold."

**Wrong, sentence 2** (Decision, ¶2): *"the same script enforces, per runner class,
`min(product × multiplier, baseline × 1.10)` and fails when the median exceeds it."*
It names one quantity where there are two, and it implies that the CI number relates to the
product budget by a multiplier. **Replace with:** "On GitHub-hosted runners the same script
enforces two named quantities. `warm_start_first_text_ms`, the median of the post-first launches,
is the change detector and is held to `min(product × multiplier, baseline × tolerance)` per runner
class. `cold_start_first_text_ms`, which is the first launch and only the first launch, is held to
an absolute per-class `cold_envelope_ms` with no baseline and no tolerance. A breach of either is
confirmed by re-measure before it fails."

**Also superseded:** the adoption values *"`ubuntu-latest` ×20, baseline 7719 ms; `macos-latest`
×5, baseline 1901 ms"* — 1901 is a warm median and 7719 is a median over one unidentified launch.
They are re-derived by MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance, and their
`derived_from` records that the previous values were derived from a warm median.

**Wrong in its premise, "Why", ¶1:** the ADR's reasoning assumes the CI observable is the same
quantity as the product one, scaled. The amendment must say the opposite in words: *CI does not
measure a scaled version of the reader's experience. It detects change in a related quantity on a
rented machine. The reader's experience is enforced on reference hardware and nowhere else.* That
sentence is the whole content of this escalation and it belongs in the ADR.

**Right, and untouched:** *"A baseline is moved only by an explicit edit to
`fixtures/perf-budgets.json` in the pull request that costs the time; CI never writes to the
repo."* Every option above was judged against this first, and none of them weakens it. Also
untouched: both runner classes gate; the product budgets themselves; "regressions are hard
failures" from ADR-0013.

The amendment lands with MARXY-63 rather than with the last story, because its load-bearing
content is the metric definitions, which MARXY-63 creates. Clauses whose numbers MARXY-63 does not
measure are written as obligations naming the story that discharges them, not as descriptions of
behaviour the tree has — which keeps faith with the rule in the previous delta.

## Story changes

### Edited

- **MARXY-63** — re-scoped from "Gate CI cold start on a measured floor" to "Make the startup
  measurement measure what it names". `fixtures/perf-budgets.json` leaves its paths. New
  acceptance in the CSV.
- **MARXY-15** — its acceptance names `floor_ms` and the withdrawn Amendment 1. Rewritten against
  the two named metrics.
- **MARXY-53** — its ratchet re-records `baseline_ms` from "observed floors". Rewritten against
  `observed_warm_ms`, the cross-run invariant and the cold envelope, still forbidden from raising
  a multiplier, a tolerance or a ceiling.

### New

- **MARXY-NEW-cold-start-reference-enforcement** — Phase 0, `speed`. Restores enforcement of the
  ADR-0013 cold-start budget on reference hardware and rewrites the release runbook step.
- **MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance** — Phase 0, `speed`. Derives the CI
  numbers from cross-job evidence, adopts or waives each class's baseline, adds the cold ceiling
  and the confirmation rounds.

No story dropped.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-NEW-cold-start-reference-enforcement → MARXY-63` | It needs the cold launch to exist as a separate recorded quantity. |
| `MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance → MARXY-63` | Its observations are of the corrected metrics. |
| `MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance → MARXY-NEW-cold-start-reference-enforcement` | Both edit `scripts/gate-perf.mjs`; sequence rather than conflict. |
| `MARXY-53 → MARXY-NEW-perf-ci-cold-envelope-and-cross-run-tolerance` | The ratchet tightens fields that story defines. |

Lane constraints, not edges: **MARXY-62** also edits `.github/workflows/ci.yml` and **MARXY-61**
claims `scripts`, so neither may share a lane with MARXY-63.

## Re-sequencing

MARXY-63 keeps its place at the head of Phase 0; the two new stories follow it in order, ahead of
MARXY-13, MARXY-15, MARXY-61 and MARXY-62. Nothing else moves. Until MARXY-63 lands, a red
`gate:perf` on a diff that cannot have caused it should be re-run once and the PR body should say
so, exactly as the previous delta directed for PR #6 — the difference is that we now know why.

## How we would know I was wrong

1. **The Ubuntu root cause turns out to be that launch 1 is the one that dies**, not the one that
   survives. Then the surviving sample is warm, the "different quantities under one name" finding
   changes shape, and decision 1's cold metric is unmeasurable on that class until the cause is
   fixed anyway. MARXY-63 produces this answer before anything is built on it, which is the point
   of making it a precondition.
2. **`cold_warm_ratio` comes out below 1 on a runner class.** Then the first launch is not the
   slowest and "launch 1 is the cold one" is wrong — probably because the build step left the
   webview warm. The response is to find what warms it, not to pick a different launch.
3. **macOS's corrected cross-run spread comes in under 1.14.** Then the 4× movement was partly the
   measurement bug, the waiver is unnecessary, and I over-read three jobs.
4. **A confirmed-noise pass on the cold metric in more than one pull request in five.** n = 1 with
   confirmation is then still too noisy to gate, and the cold metric retreats to the reference
   tier alone, which is the alternative I rejected above.

## Taste review

Nothing visual changed; no queue entry owed.

## Instruction for the in-flight MARXY-63 implementor (forward verbatim)

> **Stop work on the floor statistic. It is withdrawn.** ADR-0022's Amendment 1, which your story
> was written to implement, has been falsified before it landed: `cold_start_first_text_ms` has
> never measured a cold start. `scripts/measure-startup.mjs` launches the app eight times two
> seconds apart, sorts, and takes the median, so only launch 1 is ever cold and the reported number
> is warm by construction. Gating on the *minimum* of a round is therefore exactly backwards — the
> minimum is the warmest launch, so the gate would defend a number no reader experiences and would
> get easier as the runner's cache improved. Discard the floor work rather than adapting it; an
> inverted statistic does not refactor into a correct one. Re-branch from `main` as
> `fix/MARXY-63-measure-what-it-names`.
>
> **Your story is now the measurement, not the gate.** Re-read the MARXY-63 row of
> `docs/plan/jira-issues.csv` — summary, description, paths and all ten acceptance criteria have
> been rewritten — and read `docs/plan/deltas/2026-09-18-cold-start-metric-falsified.md` for the
> reasoning. In one paragraph, you now do three things: find and fix the reason seven of eight
> launches on `ubuntu-latest` never print `MARK first_text`; record launches in launch order and
> stop sorting the raw array; and split the metric into `cold_start_first_text_ms` (launch 1, and
> only launch 1) and `warm_start_first_text_ms` (the median of launches 2..N), then point the
> existing CI rule at the warm metric under its true name.
>
> **Four things that will look like shortcuts and are not.** (1) The Ubuntu drop-out must be
> *diagnosed*, not gated around — the PR body states the mechanism with evidence from a CI job on
> your branch, and the `usable_runs` check lands in the same diff as the fix, never before it, so
> the check arrives with a configuration that can pass. (2) `fixtures/perf-budgets.json` is no
> longer in your paths. Do not edit it, and do not change a single number in it: the CI rule keeps
> the exact envelope, baseline and 1.10 tolerance it has today and changes only which key it reads.
> (3) The cold metric is recorded and printed but not yet held to a budget — that is not it being
> advisory, it is the ceiling being derived by a later story from evidence that does not exist yet;
> the gate must still exit 1 when the cold metric or `cold_procedure` is *absent*. (4) Reference
> mode gets stricter, not weaker: it now also fails with a message that the product cold-start
> budget is not currently enforceable, naming the story that restores it. Reference mode runs
> before a tag, not on pull requests, so a red there blocks a tag rather than a merge, and that is
> the correct thing to block while we cannot prove the budget.
>
> **The two standing constraints are unchanged and are why this thread exists.** No number in the
> `product` object of `fixtures/perf-budgets.json` may change, and nothing may become advisory,
> `continue-on-error` or `|| true` — your acceptance carries a check that asserts both. If you
> reach a point where the only way to make CI green is to move a number or soften a check, that is
> an escalation, not a decision you may take.

## Addendum: the strongest macOS evidence yet, from an unrelated PR

A whitespace-only commit on PR #7 measured `cold_start_first_text_ms` at 2097 ms, failing the ceiling by
5.9 ms, and 871 ms on a re-run seven minutes later — a 2.4x swing on identical code, both under today's
eight-launch median. This is the cleanest demonstration available that the between-run movement on
`macos-latest` exceeds the gate's entire tolerance: a band wide enough to absorb it could no longer see a
20% regression, which is the whole point of having the gate. It is direct support for the
`baseline_waived` path over any widened tolerance, and it is also the case to keep in mind when the
corrected script produces its five cross-run observations — if the fix removes part of this movement, the
class may earn its baseline back, and that must be settled by the new measurement rather than by this
evidence, which was taken with the broken one.

## Addendum: two OS mechanisms that can suspend a measurement

Found by MARXY-13 while bounding its paint wait, and relevant to any story that times a launch.

**WebKit aligns timers in a window that cannot paint to roughly 15 s.** A `setTimeout(resolve, 2000)`
inside the webview fired at 15013 ms on a Mac in dark wake. So no deadline, watchdog or timeout that
lives in page script can be trusted in exactly the conditions it exists to handle; MARXY-13's now runs on
an unthrottled shell thread.

**macOS App Nap suspends a process whose window cannot be seen, and a suspended process runs no
deadline** — native or otherwise. One launch took 28.5 s to report, which is why MARXY-13 keeps a second
watchdog in the harness rather than trusting the one inside the app.

Both matter for the perf work. A launch that appears to take 15 or 28 s may be an OS decision rather than
a slow application, so a timeout tuned without knowing this will either kill launches that would have
succeeded or wait long enough to hide a real hang. Whatever cold-launch procedure MARXY-63 settles on
should record enough context to tell "the OS suspended us" apart from "startup was slow", and the same
question is worth asking about `ubuntu-latest`, where seven of eight launches emit no mark at all.

## Addendum: four runs of byte-identical code on macos-latest

From MARXY-13, which re-ran rather than touching anything: 836, 944, 1559 and 2206 ms on trees whose
`git diff-tree` is empty, with the baseline at 1901 ms sitting inside that spread. The 2206 ms run failed
the 2091 ms ceiling; the 944 ms run that preceded it passed by a wide margin. This is a 2.6x spread with
the baseline in the middle of it, which is the cleanest possible statement that the current rule cannot
distinguish a regression from a runner. Together with PR #7's 2097-then-871 pair, there are now two
independent same-code demonstrations, from two stories that had no interest in the perf gate.

## The drop-out was a missing D-Bus session bus, and the first honest cold numbers

MARXY-63's diagnosis, from consecutive launches on one runner at one commit (run 35344995257): with a
24-bit Xvfb screen and the WebKit switches, `main_start` to `script_start` is 30.9 s; the same launch
inside `dbus-run-session` is 0.9 s. Without a session bus the GTK/WebKit startup path blocks for about
thirty seconds before the webview runs a line of script, and the old 15 s kill turned that stall into a
dropped launch — the occasional survivor was the stall resolving early. Ruled out with measurements
rather than argument: the Xvfb screen depth (30.8 s at 24-bit), the `WEBKIT_DISABLE_*` switches (about
3.5 s of EGL/DRI3 probing, not the stall), the accessibility bridge, the portals and the WebKit sandbox.

This is the same error as the one that got the story rewritten, in a different place. A reader's Linux
desktop always has a session bus, so a number measured without one was mostly a timeout rather than this
application — and the implementor notes that its own cache-isolation code made *every* launch pay the
stall, which it briefly read as evidence the protocol was working. The procedure's name was doing the
thinking instead of the measurement, twice, in two different hands.

Three things for whoever picks up MARXY-69 and MARXY-70.

**The honest cold numbers are far over budget.** `cold_warm_ratio` is 1.93x on Linux and 6.31x on macOS,
and the macOS cold start is 2844 ms against ADR-0013's 500 ms. The old Linux "baseline" of 7719 ms was a
median over the one launch in eight that escaped the stall, so it describes nothing; MARXY-70 now has
honest observations to re-derive from.

**The macOS round is still warming up inside itself**: 1648, 1135, 593, 357, 355, 383, 519, 346 ms. The
warm median is therefore taken over a decaying series rather than a stationary one, which is a real caveat
on any claim that within-job variance is low.

**macOS still moves 4.6x between jobs on identical code** on the corrected metric — warm median 2086 ms
in one run against its 2091.1 ms ceiling, then 451 ms in the next. Decision 4's cross-run spread is now
measured on a metric that means what it says, and it is worse than the figure that motivated the waiver.
