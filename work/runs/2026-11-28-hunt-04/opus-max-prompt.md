# Prompt for Opus (max effort): how should Marxy's standing automation move forward?

You are advising the owner on Marxy's standing automation. Read the material first, then decide. Everything under "Ideas" is an idea the owner and an earlier session explored. Nothing in it is decided. Keep, drop, merge, reorder or replace any of it, and say why. Your output is a recommendation, not edits: do not change files, schedules or settings.

## Read first (D:\Dev\marxy, main checkout; do not edit)

- `scripts/auto/README.md` (schedule, models, budget, merge gate) and `scripts/auto/schedule.json`
- `.claude/skills/night/SKILL.md`, `.claude/skills/plan-week/SKILL.md`, `.claude/skills/bug-catch/SKILL.md` (and `format.md`, `planner-brief.md`, `catcher-brief.md`), `bug-verify`, `bug-triage`
- `work/STATE.md`, `work/todo.md`, `work/ledger.md`, `work/weeks/2026-11-27.md`
- The hunt in progress: `D:\Dev\marxy-wt\hunt-04\work\runs\2026-11-28-hunt-04\` (`axes.md`, `findings.md`, `briefs/`, `probes/`)
- Scheduled tasks live in `C:\Users\i\.claude\scheduled-tasks\marxy-night|marxy-day|marxy-plan\SKILL.md`

## Where things stand (2026-11-27 evening Pacific, the first week of the schedule)

- Three desktop scheduled tasks exist and are enabled: `marxy-night` (00:20 daily), `marxy-day` (08:45 daily), `marxy-plan` (08:15 Friday). Their model (Sonnet, Sonnet, Opus) and Auto permission mode still have to be set by hand in the app; the tools cannot set them. Keep-awake is on.
- The week plan `work/weeks/2026-11-27.md` was written by hand: seven queue pieces (E22, L21, L27, P11, L33, M4 first slice, L20), a Tuesday hunt on hostile input past the new budgets, nothing asked of Fable.
- A runs-out risk was found: night and day runs build only from the plan's `## Queue`. With an empty queue on a non-sweep night they do carry-over and triage and stop. Only Thursday and Friday have the sweep (further rows from `work/todo.md`). The plan itself is written once a week.
- The owner started hunt 04 by hand to devise queue material. Round 1 of six Sonnet catchers (WRK, ENC, DIF, AUTO, FND, CAP) was sent; ENC, WRK, AUTO and FND have reported, DIF and CAP were still running. Nothing is verified yet. Reported so far, unverified:
  - ENC-01 S2 (byte-map lookup wrong past 4096 bytes in single-byte and UTF-16 files), ENC-02 S3 (Shift_JIS/GBK lone lead byte shifts an offset).
  - WRK-01 S2 (the parse worker never starts in the browser build: `document is not defined` from a micromark dependency, so the fallback always runs).
  - AUTO-01 S2 data loss (weekly clean force-removes untracked files under `dist`, `target`, `node_modules`, `.venv` without archiving), AUTO-02 S2 (an owner comment quoting a marker is ignored, so the plan can merge over a veto), AUTO-03 S2 (a review marker with no run/model, or from any commenter, counts as independent), AUTO-04 S3, AUTO-05 S3.
  - FND-01 to FND-04, all S2 (Copy as Markdown on a mounting page copies only drawn blocks; find counts disagree with the drawn page for math and long code lines; find misses phrases across soft line breaks).

## Ideas (not decisions)

1. **Run what is next, always.** Each scheduled slot takes the next useful thing: carry-over and triage, then queue pieces; when the queue is empty or short, a planning session, a catching session, or both. Idea: this extends the Thursday/Friday sweep to every day.
2. **Order and trigger.** Carry-over first, then queue. If ready rows in `work/todo.md` are scarce, run a hunt to make more; if the queue is short but rows exist, run a small plan refresh that pulls the next rows into the Queue. Idea: choose by a script's check, not by the run's own opinion.
3. **At most one planning and one catching session per night.** A hard cap per night, on top of one hunt per week.
4. **A "minimized" mode.** When a script says the full session looks unnecessary (queue already holds N unstarted pieces and nothing merged since the last plan; last hunt's yield was under two single-axis bugs, or no new code), run a cheap version: a short plan refresh, or one cheap hunt round with two to four hand-written axes, no Opus planner, no second round. Idea: run both, downgraded, rather than skipping.
5. **Decide on more after the first pass from the usage gate.** Allow a second pass only if the first found something, the weekly reserve holds, and the gate (`allowed`, `noNewAgents`, `allowancePct`) says so, capped in usage.
6. **Fresh context per cycle, not one long session.** Each cycle ends in files (findings, verdicts, triage, plan change) that the next cycle reads; compacting mid-run risks losing which agents are writing where. Open question: is a handoff file enough, or is compacting sometimes better?
7. **At most three cycles per night.** A cycle is plan, catch, triage. A third cycle that still finds bugs is recorded as a structural problem for the owner, not a reason for a fourth. Matches the hunt's existing three-round ceiling.
8. **Point the last cycle at the work just done.** A `diff` axis: catchers and reviewers aimed at the night's own merged and open changes, on a different model from the builder (an Opus catcher on the riskiest piece). Findings on an open pull request become `CHANGES`; findings on merged code become tracker rows or next night's carry-over. Evidence: wave 5's reviewers missed an `outline-rows` regression. Caveat: the gate merges at any hour, so some findings land after merge.
9. **A one-line verdict per cycle** in the morning summary ("queue now N pieces, hunt yield M, stopped because X") so the owner can tell whether the cap or the budget ended the night.
10. **Implementation shape.** Small edits to `night/SKILL.md` and `plan-week/SKILL.md` (a "queue exhausted" section pointing at a refill mode of plan-week, plus the hunt trigger); no change to the scheduled tasks' crons or prompts. Idea: land as one reviewable pull request.
11. **Fold this hunt in.** Hunt 04's verified findings could become tracker rows and queue pieces; the AUTO findings could be carry-over before anything else because the gate and the clean protect everything else.

## What I want from you

1. For each idea: keep, change, drop or defer, with the reason in a line or two. Say where ideas conflict (for example 1 and 3, 4 and 7) and which wins.
2. A proposed run order for one night and for one day, with the stop rules, using only mechanisms that exist or small additions to the two skills.
3. The risks you see that none of the ideas names: the gate's own bugs (AUTO-02 and AUTO-03) while the automation grows more autonomous, budget burn from planners and hunts, the owner's window and presence rules, the plan pull request's review flow, anything about models (Sonnet orchestrators, Opus reviewers, Fable only on a ticked box).
4. What to do with hunt 04 itself: finish round 1 verification, stop, or run another round; and whether its AUTO findings should be fixed before more autonomy is added.
5. The smallest first step that is worth doing this week, and what to measure afterward to know the idea worked.

Be concrete about files and skill sections. Where you are unsure, name what you would check and in which file.
