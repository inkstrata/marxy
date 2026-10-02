# 02 — The orchestrator: what it is, what it cost, and what to do with it

**Date:** 2026-10-01 · **Scope:** `orchestration/`, the process documents it enforces
(`docs/sdlc.md`, `docs/ci-contract.md`, `docs/conventions.md`, `docs/hygiene.md`,
`.github/CODEOWNERS`, `.githooks/`), and the gate scripts that exist only to serve the process ·
**Inputs:** git history at `4526b811`, ADR-0017/0025/0028/0034/0040/0042/0043, the six role
prompts, the 50 plan deltas, `orchestration/needs-human.md`, and the fleet store at
`.git/marxy-fleet/` (read only). Throughput numbers belong to `03-fleet-metrics.md`; where this
document needs one it says so, or it counts something qualitative and shows the command.

**Abstract.** The orchestrator is a level-triggered reconciler that dispatches cheap coding
agents onto stories, reviews their pull requests with another agent, and merges what clears a
nine-clause bar. Its core design, settled in ADR-0034, is sound and is the part worth keeping.
Around that core, twelve days of operation grew a process that is larger than the product it
was built to protect in some measures and close to it in others: 148 of 286 commits carry a
process scope, 155 of 278 stories sit in the `ops` lane, the planner wrote 76,860 words of plan
deltas, and a person who wants to land one change has to produce or satisfy sixteen artefacts
and checks, of which four protect the product directly and one more lightly. The fleet stalled for new
reasons again and again (ADR-0034 counts about eighty fixes), and each stall added a mechanism. The dominant cost in its last
four days was not implementation but contention: 139 conflict-resolution runs against 86
implementation runs, because stories kept editing the same few files: three shared process
files and a handful of product hubs. The
author's intuition is right in its conclusion and slightly off in its reason. The fleet suits
stable *seams*, a stable *plan* and a pruned *process* more than a stable codebase as such.
The recommendation is option (b): pause the fleet, keep its code in the repository, freeze it,
strip the process from the pull-request path down to what protects readers, develop by hand
with ad-hoc agents, and resume only when five measurable criteria hold.

---

## Findings first

1. **The reconciler core is good.** A level-triggered loop over an append-only, fenced event log,
   with bounded workers and a pure `reviewStep` tested against a fake world, is standard
   control-loop practice applied well.
2. **Most of the rest is accidental, added one stall at a time.** Five waves added 15,404 net
   lines to `orchestration/`; one wave rewrote the core, and the fleet stalled again two days
   later for a reason the rewrite did not name.
3. **Path-based parallelism met shared files.** At the end, conflict resolution (139 runs)
   outran implementation (86 runs), and 19 stories were parked after three failed resolutions.
   The process's own files (`CHANGELOG.md`, the plan CSV, `deps.json`) caused more of it than
   the product's hub files did.
4. **What ran is not what the docs describe.** The fleet ran in Cursor-only `minimal` mode:
   Composer did 76 of 80 reviews and Grok 12 of 13 planner passes.
5. **The process protects itself more than the product.** Of sixteen artefacts and checks every
   pull request needs, four protect the product directly and one lightly.
6. **The process defends its own shape**: checks that check checks, tests that assert history,
   prompts that contradict each other.
7. **The engine is extractable; the process around it is not.**

---

## 1. What the orchestrator is

A stranger needs six ideas. Everything else in `orchestration/` serves them.

**The plan.** Stories live as rows in `docs/plan/jira-issues.csv`: key, summary, labels,
`Paths` (the files a story may touch), description and acceptance criteria. Dependencies and
phase membership live in `orchestration/deps.json`. The fleet reads both from `origin/main` as
git objects, never from a working tree (ADR-0034 §4). ADR-0042 (accepted 2026-09-29) moves each
row into its own file; step 1 (a shared reader, MARXY-328) has landed, the move itself has not
(`docs/plan/stories/` holds only a README).

**The board.** The status of every story (todo, in_progress, in_review, blocked, escalate,
done) is `fold(events)` over an append-only log, `events.jsonl`, in
`<git common dir>/marxy-fleet/`. Every worktree of the clone shares that store and nothing in it
is tracked (ADR-0034 §3, §9). Each event names the status it expects; the fold refuses one
that no longer applies. Jira is a mirror the fleet pushes to and never reads.

**The reconciler.** `orchestration/loop.sh` runs `cycle.mjs` every 120 seconds from a runner
worktree reset to `origin/main`. Each cycle observes everything (git, the plan, the board, one
GitHub snapshot, runs, worktrees), finishes runs that ended, adopts or settles pull requests,
takes one step per pull request in review, starts the planner when due, dispatches
implementors onto ready stories, mirrors to Jira, and writes `status.md`. It is
level-triggered: a missed cycle loses nothing.

**The roles.** Four kinds of headless run, all started by `worker.mjs` through one command
(`cursor-agent -p --force --trust --output-format stream-json --model …`,
`orchestration/worker.mjs:31`):

| Role | Prompt | Does | Ends by |
| --- | --- | --- | --- |
| Implementor | `prompts/implementor.md` | one story, one worktree, inside its `Paths` | `pnpm done KEY --open`, or `fleet.mjs report KEY blocked` |
| Reviewer | `prompts/reviewer.md` | reads a packet (`review.mjs KEY`) and decides | `fleet.mjs verdict KEY merge\|return\|escalate` |
| Resolver | `prompts/conflict.md` | merges `main` into a conflicted branch | a push, or `git merge --abort` |
| Planner | `prompts/planner.md` | splits, re-sequences, files stories, writes a plan delta | one pull request of board edits |

A fifth prompt, `orchestrator.md`, is for an in-app agent that sits beside the loop and works
the **Needs you** list. A sixth, `hardening.md`, is a handoff for whoever maintains the fleet.

**The merge bar.** `merge-bar.mjs` returns hold reasons; `cycle.mjs` merges only when there are
none. The clauses: the PR is open, not conflicting, has checks and none are red or pending, no
changes requested, CODEOWNERS satisfied, no attribution trailer, no file outside the story's
`Paths`, an implementor result file that says `done`, a changelog entry, and a reviewer's
approval signed against the exact head it read (`orchestration/merge-bar.mjs:43-68`). The
merge is pinned to that head. ADR-0040 dropped "up to date with `main`" and replaced it with a
main guard: if the latest completed `ci` run on `main` is red, nothing merges. ADR-0043 adds
revert-first: the cycle opens a revert of the first red commit and lets it land unreviewed if
its tree is exactly what `git revert` makes.

**Compute modes.** `models.json` assigns a model per role in four modes. `default` puts Claude
Sonnet on review and Opus on planning and escalation, with Composer 2.5 implementing.
`minimal` is Cursor-only (Composer and Grok everywhere). Section 3.6 shows that `minimal` is
what actually ran.

Around this core sit the human interfaces (`fleet.mjs` with 14 commands, `doctor.mjs`,
`readiness.mjs`), the review order (ADR-0025: phase, then "disturbance" descending, then age),
the Jira mirror (`jira.mjs`, 474 lines), out-of-plan work (`out-of-plan.mjs`), and Cursor
canvases (`canvases.mjs`, 555 lines).

**Size.** The brief says "about 28,000 lines including tests". That matches `orchestration/`
plus all of `scripts/` less the licence allow-list (15,406 + 14,797 − 2,670 = 27,533). The process-only part is smaller:

| Part | Lines |
| --- | --- |
| `orchestration/` code (`.mjs`, not tests) | 6,674 |
| `orchestration/` tests | 6,394 |
| `orchestration/` prompts and docs (`.md`) | 866 |
| `orchestration/` data (`.json`) | 1,329 |
| **`orchestration/` total** | **15,406** |
| Process-only scripts (check-story, check-pr, check-cards, open-pr, done, precheck, changelog, own-row, plan, repo, taste-queue, check-workflows, gate-protection, ci-changes, check-deferrals, new) | 3,713 |
| `.github/` and `.githooks/` | 543 |
| **Process machinery** | **19,662** |
| Product source (`packages/`, `apps/`, non-test) | 25,756 |
| Product tests | 19,428 |
| Process documents (`AGENTS.md`, `sdlc`, `ci-contract`, `conventions`, `hygiene`) | 13,035 words |
| Plan deltas (50 files, 2026-09-18 to 2026-09-29) | 76,860 words |

```sh
git ls-files orchestration | xargs wc -l | tail -1                                  # 15406
git ls-files orchestration | grep -E '\.mjs$' | grep -v test | xargs wc -l | tail -1 # 6674
git ls-files orchestration | grep -E 'test.*\.mjs$|\.test\.mjs$' | xargs wc -l | tail -1  # 6394
git ls-files scripts | grep -E '^scripts/(check-story|check-pr|check-cards|open-pr|done|precheck|out-of-plan|changelog|lib/changelog|lib/own-row|lib/plan|lib/repo|taste-queue|lib/taste-queue|check-workflows|gate-protection|ci-changes|check-deferrals|new)' | xargs wc -l | tail -1   # 3713
git ls-files packages apps | grep -E '\.(ts|tsx|rs|css|mjs)$' | grep -vE '\.test\.|/test/|__tests__|golden|\.spec\.' | xargs wc -l | tail -1  # 25756
wc -w docs/sdlc.md docs/ci-contract.md docs/conventions.md docs/hygiene.md AGENTS.md   # 13035
wc -w docs/plan/deltas/*.md | tail -1                                                  # 76860
```

---

## 2. History: a sequence of stalls and fixes

### 2.1 Where the commits went

The repository has 286 commits over fourteen calendar days (2026-09-17 to 2026-10-01). Counting
by Conventional Commits scope, with the five `[human]`-prefixed squash subjects included:

| Scope group | Scopes | Commits | Share |
| --- | --- | --- | --- |
| Process | orchestration 81, gates 34, plan 13, ci 8, repo 6, ops 2, taste 2, taste-review 1, scripts 1 | 148 | 52% |
| Product | desktop 46, core 28, theme 12, typeset 8, shell-api 3, fonts 2, corpus 2, bootstrap 2, workspace 1, shell 1, position 1 | 106 | 37% |
| Docs, ADRs, research, unscoped | docs 21, adr 2, spike 1, none 8 | 32 | 11% |

Reading the subjects rather than the scopes moves 42 commits into a fourth group,
**re-planning**: commits whose whole content is landing a plan delta, widening a story's paths,
splitting a story or filing stories from a review. Bucketed that way: product 104, orchestrator
64, gates/CI/process 53, re-planning 42, docs and research 19, other 4. The fleet spent more
commits on re-planning itself (42) than on the entire `core` package (28).

The `ops` lane tells the same story from the plan's side. Of 278 stories, 155 are in `ops`
(process, gates, CI, and since 2026-09-27 also defects found in passing) and 123 in phases 0 to
4. 103 rows carry `out-of-plan` and 73 carry `no-dispatch`, which marks a landing key whose only
job was to carry a planner pass or a hand fix through the merge bar.

```sh
# scope counts (python, prints the three groups; regex handles the [human] prefix)
git log --format='%s' | python3 -c "import re,sys,collections;c=collections.Counter()
for s in sys.stdin:
  m=re.match(r'^(?:\[human\] )?([a-z]+)(?:\(([^)]*)\))?!?:',s); c[(m.group(2) or '') if m else 'none']+=1
print(c)"
# stories by lane
python3 -c "import json;d=json.load(open('orchestration/deps.json'));print({k:len(v) for k,v in d['phases'].items()})"
python3 -c "import csv,collections;c=collections.Counter();[c.update((r['Labels'] or '').replace(',',' ').split()) for r in csv.DictReader(open('docs/plan/jira-issues.csv'))];print(c['ops'],c['out-of-plan'],c['no-dispatch'])"
```

The subject bucketing script is in the appendix.

### 2.2 The waves

ADR-0034's own context section says it plainly: "About eighty commits to `orchestration/` each
fixed a new way the fleet stopped moving." Grouping the history by what stopped the fleet gives
five waves. Line counts are additions and deletions under `orchestration/` only.

| Wave | Dates | What stopped the fleet | What was added | `orchestration/` |
| --- | --- | --- | --- | --- |
| W0 | 09-18 | Review livelock: 9 PRs in review, 6 BEHIND, 3 conflicting; every merge rewrote every branch and voided every signed approval (ADR-0025). `main` was red from 11:33 and nobody had recorded it (`2026-09-18-review-throughput.md`). | The fleet kit; Jira as board of record (+1,984 lines in one commit); a computed review order; a review WIP cap; one branch update per cycle; "sign last". | +4,819 −423 |
| W1 | 09-19 to 09-20 | Process stories in Phase 0 held every product story behind them; out-of-plan work needed up to three PRs and a hand merge; an unapproved commit could merge; path overlap was not glob-aware; the planner fired on the wrong signals; `cursor-agent` auth failures; stale worktrees; a 600-line branch budget that forced stacked PRs. | The `ops` lane (MARXY-107); out-of-plan path (MARXY-101); merge only the approved commit (MARXY-106); glob-aware overlap (MARXY-119); planner triggers (MARXY-120); board-drift hold (MARXY-117); worktree pruning (MARXY-118, -171); CODEOWNERS hold in the bar (MARXY-172). | +4,543 −1,039 |
| W2 | 09-21 to 09-25 | Merge queue turned out to be unavailable on a User-owned repo (MARXY-122, reversed by MARXY-182); orchestration tests had not been running in CI at all until MARXY-191; the planner's cadence blocked dispatch; workers died with their launcher; two writers raced on the board file; a conflicting PR was re-adopted right after being returned. | Merge-queue support kept behind a flag; one GitHub read per cycle; detached workers that reap the dead (+2,027 in one commit, MARXY-208); a board lock (MARXY-210); dirty live worktrees reserve paths (MARXY-202). | +5,117 −1,061 |
| W3 | 09-26 | Seventeen stories todo, none ready, none running: four idle worktrees with uncommitted edits held their paths forever, because of W2's MARXY-202. The fixes were stuck behind the CODEOWNERS gate on the loop's own code. | The reconciler rewrite (ADR-0034), shipped as MARXY-227 under the subject "push to Jira only on change and compact the event log" (+4,466 −4,853). Its PR summary: "The fleet that works this repository no longer gets stuck." | +5,456 −4,991 |
| W4 | 09-27 to 10-01 | 09-28: four planner PRs never landed because they conflicted on the board files; three resolution runs per story "exited without taking the changelog hunk"; the ops tripwire fired at 7 of 10 merges (`2026-09-28-stuck.md`). 09-29: a cancelled CI run on `main` read as red stopped every merge (MARXY-333); reviewers finished without recording verdicts, leaving MARXY-268 for 18 hours (MARXY-316). | Changelog fragments (MARXY-315); one plan file per story (ADR-0042, reader only); land without up-to-date plus the main guard (ADR-0040); revert-first (ADR-0043, +992); drain mode; verdict recovery; human approval across main-only merges; one implementor attempt before escalation. | +3,417 −434 |

Net, the five waves sum to 15,404 lines, which is the directory's size today. Scripts,
`.github/` and `.githooks/` gained another 17,093 lines and lost 1,751 over the same waves,
though not all of that is process (see the appendix for the split).

```sh
git log --reverse --numstat --format='@@%ad|%h|%s' --date=short > numstat.txt   # then waves.py in the appendix
```

### 2.3 What the timeline shows

**Each fix was local and each was reasonable.** Reading the deltas, every mechanism answers a
real failure with evidence. The problem is the accumulation. MARXY-202 (dirty worktrees reserve
paths) was the fix for agents colliding with live work; it caused W3's total stall. ADR-0025's "sign last"
fixed the W0 livelock; ADR-0034 §7 had to amend it; ADR-0040 then removed the update step it
depended on. Strict branch protection was turned off (ADR-0040, 09-28) to unblock the queue; on 09-29 a
cancelled run read as red blocked it again, and CI was changed to run on every commit to `main`
(MARXY-334). The fleet's mechanisms are tightly coupled, so each new one moved the bottleneck.

**The rewrite fixed the class of stall it named and not the others.** ADR-0034 named four
causes (states with no exit, inferred state, tracked files used as locks, edge-triggered
repairs) and removed them structurally. Two days later the fleet stuck on shared files and
weak resolvers, a cause the ADR does not name. The log of the last cycle, 2026-09-29 07:35 UTC,
reads "draining", with `main` red and 30 items under **Needs you**:

```sh
sed -n '/## Needs you/,/^## In flight/p' /Users/ian/Dev/marxy/.git/marxy-fleet/status.md | grep -c '^- '   # 30
```

Of those 30, eight were escalations, five were stories parked after three failed conflict
resolutions, ten were worktrees with work that nothing owned, four were older parks, one was
a CODEOWNERS gate on a fix to `cycle.mjs`, one was a failed result, and one was `main` itself,
red. The reconciler did what ADR-0034 promised: nothing waited silently. But
"not silent" moved the stall onto the person. The **Needs you** list grew from 6 to 11 items on
09-26 to 18 to 35 on 09-28:

```sh
grep -o '^── cycle [0-9T:-]*Z: [0-9]* in flight, [0-9]* need you' /Users/ian/Dev/marxy/.git/marxy-fleet/loop.log \
 | awk '{d=substr($3,1,10);n=$7;if(!(d in a)||n<a[d])a[d]=n;if(n>b[d])b[d]=n}END{for(d in a)print d,a[d],b[d]}' | sort
# 2026-09-26 6 11 · 2026-09-27 7 19 · 2026-09-28 18 35 · 2026-09-29 21 34
```

**The fleet's last merges were mostly about the fleet.** The planner trigger counts ops
merges. Its log lines on 09-27 and 09-29 read "7 of the last 10 merges were ops", "8 of the
last 10", "9 of the last 10" and once "10 of the last 10". The roadmap's tripwire for this
(`docs/roadmap.md:75`) tells the planner to defer ops stories. The 2026-09-29 delta (committed
04:19 UTC) marked it "Not fired" on the grounds that `fleet.mjs status` "reported only the two
unread escalations and the four fleet parks", which is not a count of merges; at 06:42 UTC the
loop reported 9 of 10. The guard existed and was read loosely.

```sh
grep -o 'planner: due — [^;]*; [0-9]* of the last 10 merges were ops' /Users/ian/Dev/marxy/.git/marxy-fleet/loop.log | sort | uniq -c
```

**A human wave cleaned up after the fleet.** On 2026-09-29 the author landed MARXY-337, "a
stability wave over the last day's merges": six rounds of bug hunting over everything that had
merged on 09-28 and 09-29, one PR, 171 files, +6,341 −745. Its summary lists lost edits, an
undo that could delete text, a confirmed close that looped forever, and CI gates that missed
import shapes. Every one of those had passed the merge bar. This does not prove the fleet's
code was worse than a person's would be; it does show that the bar measured conformance to the
process more reliably than correctness.

```sh
git show --stat $(git log --format=%h --grep='MARXY-337' | head -1) | tail -1   # 171 files changed, 6341 insertions(+), 745 deletions(-)
```

---

## 3. Design assessment

### 3.1 The reconciler (ADR-0034) is sound

The decisions in ADR-0034 are the ones a careful engineer would take after reading Kubernetes
controllers and Temporal, and the ADR says it did:

- **Level-triggered, pure decisions.** `reconcile(io)` takes the world as an argument, so the
  whole cycle runs against a fake world in `cycle.test.mjs` (41 uses of its `world(...)` helper). That
  is the right test seam for a control loop.
- **Event log with fencing.** Each event names the status it expects and the run that must
  still own the story. Human and agent commands append the same events. This removed the race
  that MARXY-210 had patched with a lock.
- **Plan from `origin/main`, code from a runner worktree.** A dirty checkout cannot stop the
  loop; a merged fix to the loop takes effect next cycle.
- **Every subprocess bounded, every agent in its own process group.** `proc.mjs` and
  `worker.mjs` make "the agent hung" an outcome, not an outage.
- **`reviewStep` is a pure function** that maps a PR and a merge-bar decision to one next step
  (`orchestration/cycle.mjs:121-158`). It is short, readable, and easy to test.

Two caveats. First, "every status has an owner and a way out" is checked by a test that
asserts each entry in `STATES` has a non-empty `owner` string and `exit` string
(`orchestration/machine.test.mjs:14-21`). The real guarantee comes from the cycle scenarios, not
from that test; the ADR's claim that "a state with no exit fails a test" is stronger than the
test. Second, two of the six statuses (blocked, escalate) have a person as their exit. The
design makes stalls visible, which is valuable, but it does not make them cheaper. With weak
models and contended files, the human exit is where the work went.

### 3.2 Essential and accidental complexity

| Area | Lines (code + test) | Essential? | Why |
| --- | --- | --- | --- |
| `machine.mjs`, `store.mjs`, `lease.mjs` | 291 + 178 + 149 + tests | Essential | The board, the log, one cycle at a time. Any fleet needs this. |
| `cycle.mjs` reconcile and `reviewStep` | 731 + 577 | Mostly essential | The loop itself. Some branches serve accidental features (BEHIND updates now dead under ADR-0040, merge queue). |
| `worker.mjs`, `proc.mjs`, `runs.mjs`, `outcomes.mjs` | 626 + tests | Essential | Running and judging agent runs is the job. |
| `merge-bar.mjs`, `approve.mjs`, `codeowners.mjs` | 153 + 196 + tests | Essential core, accidental clauses | Signed approval pinned to a head is essential. Result files, changelog and attribution clauses are process. |
| `ready.mjs`, path overlap, worktree holds | 255 + `worktrees.mjs` 321 + tests | Essential for path parallelism | Only needed because parallelism is by declared paths (3.4). |
| `review-order.mjs` (ADR-0025) | 177 + 191 + 18 fixtures | Accidental now | It existed to beat a livelock that ADR-0040 removed by dropping the update requirement. |
| `revert.mjs` (ADR-0043) | 306 + 261 | Accidental at this scale | A careful mechanism for a red `main` that a person would revert in one command. |
| `jira.mjs`, `jira-map.json`, mirror | 474 + 188 | Accidental | One person reads the board; the plan is in git. |
| `canvases.mjs` | 555 + tests | Accidental | Renders fleet state into Cursor canvases. |
| `out-of-plan.mjs` | 181 + tests | Accidental | Exists because every change must have a board row (section 4). |
| `planner-trigger.mjs`, the planner role | 80 + 161 | Accidental for one author | Re-planning was mostly about the fleet's own stuck stories (2.1). |
| `doctor.mjs`, `readiness.mjs`, `report.mjs`, `fleet.mjs` | 1,042 + tests | Half and half | Needed to operate a fleet; size reflects the number of ways it can be stuck. |

A rough split from that table: about 2,700 lines of `.mjs` code are the engine (`store`,
`machine`, `lease`, `cycle`, `observe`, `worker`, `proc`, `runs`, `outcomes`, `merge-bar`, `approve`,
`ready`; `wc -l` of those twelve files gives 2,672). The rest serves Marxy's particular
process or patches over a failure mode of the process.

### 3.3 Specific smells

**Checks that check checks.** Several gates spend effort proving they are themselves wired up.
Some of this is good practice: a gate that cannot fail is worthless, and
`gate-aesthetics.mjs --selftest` renders crafted bad pages and asserts each check fails on
them. That is mutation testing and should stay. Other cases go one level further:

- `scripts/gate-perf.mjs` is 798 lines for a gate that, by ADR-0032, never fails on a timing
  ("print the comparison, do not exit 1 on the milliseconds", lines 5-7). Its `--selftest`
  asserts that `ci.yml` has a step that runs `--selftest` (lines 364-366), that named cases from
  three earlier stories are still in the suite (lines 576-605), and that there are at least 40
  named cases (line 776).
- `scripts/ci-changes.mjs --selftest` fails if it has fewer than 25 named cases, and greps its
  own source to assert the selftest body contains no network call (lines 286-291).
- `lint:biome-contract` in `package.json:16` is a 2,279-character inline Node program that
  writes probe files to check that Biome's configuration rejects unused imports, that the
  formatter is check-only, that `ci.yml` contains the string `pnpm lint`, and that CI runs on
  both `macos-latest` and `ubuntu-latest`. It checks configuration, not code.
- `orchestration/docs.test.mjs` fails when a live doc names an `orchestration/` file or a
  `fleet.mjs` command that does not exist. It is a reasonable guard, but it only covers names.
  It did not catch `orchestration/README.md:9,12` still saying "Sonnet 5" after MARXY-336 moved
  the roles to Sonnet 5.5, nor the prompt contradictions in 3.5.
- `orchestration/lib.test.mjs` pins every model id in `models.json` (30 matches). The config's
  own note says "a change that does not update that test is not a change." The test restates the
  config; it cannot catch a wrong model, only an unsynchronised one.

**Tests of history and of prose.**

- `orchestration/prompt-handshake.test.mjs:43` asserts that `CHANGELOG.md` has a MARXY-79 line
  under `Unreleased`. It will fail when a release folds `Unreleased` into a version.
- `orchestration/taste-decisions.test.mjs:7` asserts that taste review #0 recorded pair A and
  accepted ADR-0015, a fact about 2026-09-19.
- `orchestration/phases.test.mjs:94` asserts that `docs/scope.md` cuts the light variant first
  and `docs/plan.md` names dark as primary.
- `orchestration/needs-human.test.mjs` asserts that the author's own rulings file names no PR
  that has already merged.
- `orchestration/jira.mjs:418-466` holds eight tests inside the Jira module, including one that
  `AGENTS.md` has a "Work outside the plan" rule and two that exercise the commit-msg hook. They
  run only because `done.test.mjs` imports `jira.mjs` under `node --test`.

Each of these was written to stop a specific regression an agent once made. Their effect is
that changing a document or a decision means changing a test, which makes the process harder
to slim than it was to grow.

**Every PR pays for the orchestrator's tests.** `pnpm test` runs
`node --test orchestration/*.test.mjs orchestration/test/*.test.mjs` (`package.json:13`), and
CI's `fast` job runs `pnpm test` for every change that is not docs-only. A typography fix runs
440 orchestrator tests, about 33 seconds locally:

```sh
time node --test orchestration/*.test.mjs orchestration/test/*.test.mjs   # tests 440, pass 439, skipped 1; 33.4 s wall
```

**Stringly-typed decisions.** The merge bar returns English sentences, and `cycle.mjs`
classifies them with regular expressions (`HOLD_CLASSES`, `orchestration/cycle.mjs:100-107`).
`merge-bar.mjs:63` carries the comment "The hold text stays exactly this string: cycle.mjs
matches on it." A reworded message silently changes who owns a hold. A tagged union (`{ kind,
text }`) would remove the coupling for a few dozen lines of change.

**Prompts embedded in code, code embedded in prompts.** The first smell is mild here: prompts
live in `prompts/*.md`, and `runs.mjs:25-39` only appends a line naming the key and PR. The
second is pronounced. The prompts carry the mechanics the code could not enforce: the
reviewer's two-file verdict handshake, the implementor's `pnpm done --open` sequence, an
incident report about a bad `git reset --soft`. Section 3.5 counts it.

**Two-way coupling with `scripts/`.** `orchestration/` imports seven modules from `scripts/`
(`check-pr`, `done`, `open-pr`, `lib/changelog`, `lib/own-row`, `lib/plan`, `lib/taste-queue`), and
eight files in `scripts/` read orchestration data or code. The CSV parser exists twice
(`scripts/lib/plan.mjs:18`, `scripts/check-cards.mjs:8`).

```sh
grep -h -o "from '\.\./scripts/[^']*'" orchestration/*.mjs | sort | uniq -c
grep -rn -E "function parseCsv" orchestration scripts | grep -v 'test\.mjs'
```

### 3.4 Path-based parallelism and its conflict rate

Parallelism is by declared `Paths`. A story may touch only its listed files; two stories whose
paths overlap are never in flight together; a worktree with recent activity holds its paths.
`lanes` is `null`, so path overlap is the only limit (`models.json`).

This works when work is spread over many files with clear owners. Two kinds of file broke
that here:

| File | Commits touching it (of 286) | Kind |
| --- | --- | --- |
| `CHANGELOG.md` | 239 | Process, append-only |
| `docs/plan/jira-issues.csv` | 116 | Process, append-only |
| `orchestration/deps.json` | 98 | Process, append-only |
| `apps/desktop/src-tauri/src/main.rs` | 21 | Product hub (1,053 lines) |
| `apps/desktop/src/app.ts` | 20 | Product hub (1,399 lines) |
| `packages/core/src/render/render-html.ts` | 9 | Product hub |

```sh
for f in CHANGELOG.md docs/plan/jira-issues.csv orchestration/deps.json apps/desktop/src-tauri/src/main.rs apps/desktop/src/app.ts packages/core/src/render/render-html.ts; do echo "$(git log --format=%h -- $f | wc -l) $f"; done
```

The process files were the larger source of conflict, and they are self-inflicted: the fleet
has since replaced the changelog with fragments and accepted ADR-0042 to replace the CSV and
`deps.json`. The product hubs are the product's youth: 9 of the last 20 product-scope commits
(33 of 98 overall) touch at least one of the three. The evidence that contention dominated:

- **Conflict resolution outran implementation.** In the run directories (2026-09-26 to
  2026-09-29), 139 runs were conflict resolutions and 86 were implementations.
- **Resolutions failed.** 19 times a story was parked with "still conflicts with main after 3
  resolution runs". The stuck delta records the plainest case: three PRs whose only conflict was
  a `CHANGELOG.md` line, parked after resolution runs of about two minutes each "exited without
  taking the changelog hunk."
- **Paths were often wrong.** "widen" or "Paths gain" appears 90 times
  in 31 of the 50 plan deltas. Twelve commit subjects are a path widening or a split and nothing
  else of substance. The
  2026-09-28 stuck delta widens Paths for six stories at once; the 2026-09-18 review-throughput
  delta found that MARXY-61's two blockers were "errors in its own row, not in the work."
- **ADR-0042's own count:** in its window, the CSV had been touched by 91 of 248 commits, and 8
  of 19 open PRs were editing it.

```sh
python3 - <<'EOF'
import json,glob,collections
c=collections.Counter(json.load(open(f))['role'] for f in glob.glob('/Users/ian/Dev/marxy/.git/marxy-fleet/runs/*/run.json'))
print(c)   # resolve 139, implement 86, review 80, plan 13
EOF
grep -c 'still conflicts with main after 3 resolution runs' <(python3 -c "import json;[print(json.loads(l).get('why','')) for l in open('/Users/ian/Dev/marxy/.git/marxy-fleet/events.jsonl') if json.loads(l).get('to')=='blocked']")   # 19
grep -o -i -E "widen(s|ed|ing)?|Paths gain" docs/plan/deltas/*.md | wc -l    # 90
grep -l -i -E "widen|Paths gain" docs/plan/deltas/*.md | wc -l                 # 31
```

The fleet's answer to contention was to remove shared files one at a time (changelog
fragments, then a plan file per story), and to stop requiring branches to be up to date. Those
are right moves, and they remove the larger cause. They do not fix the product hubs, which only
a more modular app will.
Path-based parallelism is a good fit for a codebase that already has stable seams. It is
the wrong tool for discovering where the seams should be, and that is what an early prototype
is doing.

### 3.5 The prompts

All six are well written in the house style: imperative, numbered, specific, with reasons.
They are also where the process leaks into the agents' attention.

**`implementor.md` (103 lines).** The story itself is one placeholder (line 8); about 40 of the
103 lines are process mechanics: commit format, push verification, `pnpm done` then fill TODOs then
`pnpm done --open`, and a long list of never-do's. Lines 36-44 are an incident report:

> "Both of those happened on MARXY-63: together they put a commit on the remote that reverted a
> merged story while the worktree was clean…"

That is a fine note for a person and a poor use of a cheap model's context. The product's
spirit gets one line among the never-do's ("Add telemetry, network calls, chrome, or a plugin
surface"). Lines 18-22 still tell the implementor to "append a row to
`docs/taste-review/queue.md` with before/after screenshots you generated", which MARXY-324
made optional and moved to `queue.d/`. The planner prompt (line 36) says the entry is "optional
and never required."

**`reviewer.md` (77 lines).** The ordered checks (boundaries, acceptance, gates, spirit,
size) are good, and "look for tautological tests" is the right instinct. But "stop at the first
failure" means a PR with a boundary slip and a missing test makes two round trips. Lines 37-77,
41 of 77 lines (53%), are the verdict-recording handshake: write a notes file with `verdict:`
and `head:` lines first, then a second throwaway notes file, then run `fleet.mjs verdict`,
because "three review runs finishing review but never reaching this last step is exactly what
left MARXY-268 sitting for 18 hours." The boundary exceptions on line 9 name `CHANGELOG.md`
and `docs/taste-review/queue.md`, not the `changelog.d/` and `queue.d/` that `docs/sdlc.md` now
allows.

**`planner.md` (70 lines).** It asks for a lot in one pass: a delta, story changes mirrored to
Jira, task cards, ADR proposals, taste requests, scope pressure. Lines 42-66 are about how to
land the pass through the merge bar (placeholders, `jira.mjs sync --new`, out-of-plan keys).
"Keep the mechanism-over-catalogue bias" is good advice. What the prompt lacks is a budget:
nothing limits how much of a pass may be about the fleet's own stuck stories, and sections 2.1
and 5.1 show the passes were mostly that.

**`conflict.md` (17 lines).** The best of the six: short, clear, with a safe exit
(`git merge --abort`). Its 19 parks came from volume and from a cheap model, not from the
prompt.

**`orchestrator.md` (87 lines).** A good statement of the job ("Your job is what the loop hands
to judgement or to a person"). It duplicates the model table from `models.json` (lines 21-26),
which is why `README.md` and this file now disagree on the Sonnet version.

**`hardening.md` (208 lines).** Not a role prompt but a handoff and backlog. Its nine
invariants (lines 41-55) are the clearest summary of the design anywhere in the repository and
are worth keeping in any future version. The rest is a dated work list that belongs in the
plan.

Read together, the prompts have a pattern: each incident adds a paragraph. A prompt is the
cheapest place to put a rule and the most expensive place to keep it, because every run pays
for it and nothing tests that a model obeyed it.

### 3.6 Review and model routing

The review pipeline's core idea is right: an approval is signed against the commit it read,
and survives only merges of `main` (`approve.mjs` `onlyMainArrived`). That is the guarantee that
makes autonomous merge defensible. The machinery around it (review order by disturbance,
`reviewLanes`, review tries, verdict recovery from a notes file) grew from the livelocks in W0
and the lost verdicts in W4.

The routing on paper puts strong models on judgement and cheap ones on typing:

| Role | `default` mode | `minimal` mode |
| --- | --- | --- |
| Implementor | Composer 2.5 | Composer 2.5 |
| Escalation | Opus 5.5 | Grok 4.6 |
| Reviewer | Sonnet 5.5, high | Composer 2.5 |
| Planner | Opus 5.5 | Grok 4.7, high |

The run records show what actually ran from 2026-09-26 to 2026-09-29:

| Role | Model | Runs |
| --- | --- | --- |
| resolve | composer-2.5 / grok-4.6 | 101 / 38 |
| review | composer-2.5 / claude-sonnet-5 | 76 / 4 |
| implement | composer-2.5 / grok-4.6 | 71 / 15 |
| plan | grok-4.7-high / claude-opus-5-5-medium | 12 / 1 |

```sh
python3 - <<'EOF'
import json,glob,collections
c=collections.Counter((r['role'],r['model']) for r in (json.load(open(f)) for f in glob.glob('/Users/ian/Dev/marxy/.git/marxy-fleet/runs/*/run.json')))
print(c)
EOF
```

So the fleet ran almost entirely in `minimal`. Grok 4.7 as planner and Composer as reviewer
exist only in that mode, while `models.json` sets `"compute": "default"`, so `minimal` was
chosen at launch by flag or environment. Running on Cursor-included spend is a sound cost
decision. But it changes what the design is: a fleet in which the cheapest available model is
both the implementer and the only judge of whether a diff meets its acceptance criteria. `docs/hygiene.md:1-3` names the premise directly: "Hygiene and
tooling — for an engine of weak agents. Everything here exists because a fast model will do
the wrong thing unless the wrong thing is impossible." Much of the process is a cage for weak
models. With weak models also reviewing, the cage is the only check that is not weak, so it
kept growing. Implementation outcomes in the same window: 57 exited, 26 timed out, 2 stalled,
1 setup failure; 11 stories escalated. Rates and their trend belong to `03-fleet-metrics.md`.

```sh
python3 - <<'EOF'
import json,glob,collections,os
c=collections.Counter()
for f in glob.glob('/Users/ian/Dev/marxy/.git/marxy-fleet/runs/*/run.json'):
    r=json.load(open(f)); x=f.replace('run.json','exit.json')
    c[(r['role'], json.load(open(x)).get('outcome') if os.path.exists(x) else 'none')]+=1
print(c)
EOF
python3 -c "import json;print(len({json.loads(l)['key'] for l in open('/Users/ian/Dev/marxy/.git/marxy-fleet/events.jsonl') if json.loads(l).get('to')=='escalate'}))"   # 11
```

---

## 4. The process cost on a person

### 4.1 What one pull request needs

This is what a person must produce or satisfy to land one change through the fleet's path,
whether a fleet story or the author's own fix. "Protects" says whom the artefact serves.

| # | Artefact or check | Enforced by | Protects |
| --- | --- | --- | --- |
| 1 | A Jira issue and its key | `out-of-plan.mjs start` / planner `jira.mjs sync --new` | Process (Jira mirror) |
| 2 | A CSV row: summary, labels, `Paths`, description, acceptance | `check-story --strict` in CI; merge bar "no board row" | Process (boundary needs paths) |
| 3 | A `deps.json` phase and dependency entry | `check-cards`; `out-of-plan.mjs` | Process |
| 4 | A task card, for planner-filed stories | planner prompt; `check-cards` keeps it in sync | Process (instructions for weak agents) |
| 5 | Branch named `type/MARXY-n-slug` | `check-story --strict` (no key, no pass) | Process |
| 6 | Conventional commit subject ending `(MARXY-n)`, ≤100 chars, body required for feat/fix/perf/refactor | `.githooks/commit-msg` + commitlint in CI | Process (traceability) |
| 7 | PR title linted as a squash subject | CI `conventions` | Process |
| 8 | PR body: six sections in fixed order, Summary of 2-4 sentences, a bullet under Changes, a fenced block under Verification, the key mentioned | `check-pr.mjs` via `open-pr.mjs` and CI | Process (with some reader value) |
| 9 | An acceptance-to-check table with every row filled | `check-pr.mjs`; `pnpm done --open` copies it to the result | Product (every criterion has a test) |
| 10 | A test or gate per acceptance criterion | reviewer | **Product** |
| 11 | `changelog.d/KEY.md`, one reader-facing line ending `(KEY)` | `check-pr`; merge bar | Product, lightly (release notes) |
| 12 | Only files inside `Paths` | `check-story` pre-commit, CI, merge bar | Process (parallelism) |
| 13 | No attribution trailer, in commits or body | hook, `check-pr`, merge bar | Author's policy |
| 14 | An implementor result file in the fleet store (`pnpm done`) | merge bar "no implementor result file" | Process |
| 15 | A reviewer agent's approval signed against the head | merge bar; `mergeUnreviewed: false` is hard-coded (`cycle.mjs:464`) | **Product**, if the reviewer is good |
| 16 | CODEOWNERS approval for security and merge-gate paths | GitHub + merge bar | **Product** (security) and process (gate code) |
| 17 | CI green: product gates (typecheck, lint, tests, goldens, fidelity, licences, no-network, aesthetics, boundaries) | CI | **Product** |
| 18 | The Jira issue moved to Done with the PR link | `pnpm done --open`, mirror | Process |
| — | A taste-review entry | optional since MARXY-324, but the implementor prompt still asks for it | Product (taste), now voluntary |

Sixteen of the eighteen numbered rows apply to every pull request; the task card (4) and
CODEOWNERS (16) apply to some. Of the sixteen, four protect the product directly (9, 10, 15,
17), one lightly (11), one serves the author's policy (13), and ten serve the process (1, 2, 3,
5, 6, 7, 8, 12, 14, 18). The process ones are not useless: rows 2, 5, 12 and 14 are what
let several agents work at once without trampling each other. They are the price of
parallelism. When one person works serially, that price buys nothing.

Three concrete observations:

- **This audit needed a Jira issue, a CSV row and a `deps.json` entry before a word was
  written.** The worktree carries uncommitted edits to `docs/plan/jira-issues.csv` and
  `orchestration/deps.json` that add MARXY-346 with `ops,out-of-plan,no-dispatch`, because
  `check-story --strict` fails any branch without a key and a row (`git status` in this worktree).
- **The author's own pull requests broke the author's own convention.** Five squash commits on
  `main` start with `[human]`, the display mark `pr-mark.mjs` says the squash subject omits.
  They were merged by hand through GitHub, which used the PR title. Those subjects would fail
  the repository's own commitlint rules. A person working around the fleet's path leaves traces the
  path would have refused.
- **`docs/ci-contract.md:84` titles its biggest section "Conventions — the job that fails
  most, and never for a code reason."** That sentence is the strongest argument in this
  document, and it is the project's own.

```sh
git log --format='%s' | grep -c '^\[human\]'   # 5
```

### 4.2 Reading load

The process documents a newcomer is pointed to (`AGENTS.md`, `sdlc`, `ci-contract`,
`conventions`, `hygiene`) total 13,035 words; the orchestrator's README adds 3,331
(`wc -w orchestration/README.md`). Seven of the 43 ADRs (0017, 0025, 0028, 0034, 0040, 0042,
0043) govern the fleet and the merge path.

---

## 5. Is the author's intuition right?

The author's position: the orchestrator would be a good implementation for a more stable
codebase, and is premature for an early prototype.

### 5.1 The case that the author is right

- **The fleet's main workload at the end was contention, and part of it comes from young
  code.** 139 resolutions against 86 implementations; 19 parks after three failed resolutions;
  Paths widened in 31 of 50 deltas; 9 of the last 20 product commits touch one of three hub
  files. A stable codebase has more files with clear owners and fewer hubs, which is the
  precondition for path-based parallelism.
- **Re-planning dominated planning.** 42 commits were landings, widenings and splits. About
  half (49%) of the delta text sits under headings about escalation, re-sequencing, blocks, splits
  and landings; about 5% sits under design, scope or product headings. (Crude: classified by
  section heading; 40% of the text is under headings neither regex matched. Script in the
  appendix.) A prototype changes its mind; every change of mind is a re-plan, and each re-plan
  is a pull request against shared board files.
- **Ops crowded out product.** 52% of commits carry a process scope; at the end, 7 to 10 of
  every 10 merges were ops. The roadmap's own tripwire fired and was then recorded loosely.
- **Each fix moved the bottleneck.** Five waves, one rewrite, and a new stall within two days
  of the rewrite. That is what happens when a control system is tuned against a moving plant.
- **The product's direction is moving.** The author has restated the spirit ("reader before
  writer, but adept at both"), wants collections, split view and text tools, and thinks some
  commitments over-constrain design (`10-overfit-decisions.md`). Those are cross-cutting
  changes to `app.ts`, the shell and the theme: exactly the hub-file work the fleet handles
  worst. Several will need ADR changes, and the fleet routes contract changes to people anyway.
- **The quality bar measured conformance more than correctness.** The 09-29 stability wave
  found lost edits and an infinite close loop in merges that had cleared every clause.

### 5.2 The case that the author is wrong

- **The fleet delivered.** Phases 0 to 2 are closed (`2026-09-29.md`: "phase 2 closed"); 250
  stories were done at the last status; 106 product commits landed in twelve days, plus
  bugcatch passes that filed and fixed real defects. That volume of gated code is hard to match
  by hand. (`03-fleet-metrics.md` owns the throughput numbers.)
- **Early is when gates matter most.** The product-protecting gates (byte fidelity, the
  sanitiser, no-network, licences, boundaries, goldens) caught classes of error that are
  cheapest to stop before a codebase hardens around them.
- **"Stable codebase" may be the wrong variable.** Most stalls were the orchestrator's own
  immaturity: W0's livelock, W2's worker deaths and board race, W3's path holds, W4's
  cancelled-run misreading. None of those depended on the product being young. A mature
  orchestrator on the same young product might have run smoothly.
- **Much of the contention was self-inflicted, and is being removed.** `CHANGELOG.md`, the CSV
  and `deps.json` were touched by 239, 116 and 98 commits. Fragments and ADR-0042 take them off
  the shared path regardless of how mature the product is.
- **Much of the cost is already sunk.** The reconciler exists, is tested, and runs. Stopping
  now spends the learning without collecting the return.

### 5.3 Position

The author is right to stop. The history supports the decision more firmly than it supports
the stated reason. The fleet's costs came from three sources, and only part of one is "an
early prototype":

1. **Contention**: mostly on shared process files, which is the process's fault and is being
   fixed, and partly on product hubs, which is the product's youth. The second half favours
   the author.
2. **The orchestrator's own immaturity**, which is about the fleet's youth. Most of the stalls
   in W0 to W3 were this. The rewrite fixed much of it; the counter-argument that a mature
   fleet would run better is partly right.
3. **A process designed for weak models, with weak models also judging.** This is neither
   about the codebase nor about the fleet's maturity. It is about the cost decision to run
   `minimal`, which made the process the only reliable check and made the process grow.

Pausing addresses all three: the product can find its seams by hand, the orchestrator stops
accumulating fixes against a moving target, and the process can be cut down to what protects
readers. The intuition should be sharpened: the orchestrator is a good implementation for a
codebase with **stable seams**, a **stable plan**, and a **process pruned to the product's
needs**, run with a **reviewer stronger than the implementor**. "Stable codebase" is a proxy
for the first two.

---

## 6. Could `orchestration/` be its own tool?

Yes, and the engine is worth extracting eventually. Not now.

### 6.1 What is generic

| Keep in a generic version | Why it generalises |
| --- | --- |
| Event-log store with fencing, fold, compaction (`store.mjs`, `machine.mjs`) | Any agent fleet needs durable, race-free state outside the checkout |
| Level-triggered reconcile with an injectable `io` (`cycle.mjs` core) | The right shape for any loop over GitHub plus agent runs |
| Worker with deadline, stall watchdog, process groups, outcome table (`worker.mjs`, `proc.mjs`, `outcomes.mjs`, `runs.mjs`) | Agent CLIs hang and die the same way everywhere |
| Signed approval pinned to a head, surviving only main merges (`approve.mjs`) | The core guarantee of autonomous merge |
| Merge bar as a list of pluggable clauses (`merge-bar.mjs`) | Projects differ only in the clauses |
| Path reservation and worktree management (`ready.mjs`, `worktrees.mjs`, `observe.mjs`) | Useful where parallelism by paths fits |
| The main guard, and revert-first as an option (`revert.mjs`) | Generic red-trunk policy |
| `fleet.mjs` commands, `doctor`, `status.md` with **Needs you** | The human interface |
| The nine invariants (`prompts/hardening.md:41-55`) | The design in one page |

### 6.2 What is Marxy-specific

- **Key format.** `MARXY-\d+` is hard-coded in 18 regular expressions across `orchestration/`
  and `scripts/` (`adopt.mjs:20-23`, `fleet.mjs:89`, `lib.mjs:82`, `ready.mjs:32`,
  `revert.mjs:32-51`, `machine.mjs:167`, and others).
- **Plan schema.** The CSV columns, `deps.json` with a non-numeric `ops` phase, task cards, the
  `no-dispatch`/`human-gated`/`dropped` labels, and `PHASE_EPIC` mapping phases to Marxy's Jira
  epics (`out-of-plan.mjs:20`).
- **Jira.** `jira.mjs`, `jira-map.json`, the `MARXY` project default, the epics.
- **Process files the bar reads.** `changelog.d/`, `docs/taste-review/queue.d/`, the house PR
  template in `check-pr.mjs`, `BOARD_FILES` in `scripts/lib/own-row.mjs`. The orchestrator
  imports seven `scripts/` modules for these.
- **Paths and names.** `../marxy-wt/KEY` worktrees, the `marxy-fleet` store, `MARXY_*`
  environment variables, `pnpm done` and `pnpm precheck` in prompts, `.cursor/agents/`.
- **Agent backend.** One CLI, `cursor-agent`, in `worker.mjs:31`, `fleet.mjs:302`,
  `doctor.mjs:108`; Cursor model ids in `models.json`; Cursor canvases. The backend is
  isolated to `agentArgs`, which makes it the easiest coupling to break.
- **Prompts.** All six assume Marxy's spirit, files and commands.
- **CODEOWNERS** lists `orchestration/approve.mjs`, `merge-bar.mjs` and `cycle.mjs`.

### 6.3 What extraction would take

1. A project config: key regex, worktree root, store name, agent command template, models.
2. A plan adapter (`stories()`, `deps()`, `phases()`), with ADR-0042's per-story files as the
   reference format and the CSV dropped.
3. Merge-bar clauses as plugins; changelog, result-file and PR-template checks become optional.
4. An agent adapter; `cursor-agent` and `claude -p --output-format stream-json` both stream
   JSON, so the watchdog carries over.
5. Jira and canvases as optional mirrors, off by default.
6. Prompts as templates; house rules live in the project's `AGENTS.md`.
7. Fake-world tests only; drop the tests that read Marxy's documents.

The size is roughly the engine (about 2,700 lines) plus its tests, re-cut behind interfaces.
Doing it now is more process work on a paused tool, which is what the author wants less of.

---

## 7. Options

### (a) Keep running the fleet as is

- **Keep:** everything.
- **Stop:** nothing.
- **Change:** nothing beyond the hardening backlog.
- **Assessment:** this is the path the evidence argues against. The last four days were mostly
  conflict resolution, re-planning and ops merges; the **Needs you** list held 30 items; the
  author had to land a 6,341-line stability wave by hand. The restated product direction is
  hub-file work, the fleet's weakest kind. Expect more of the same.

### (b) Pause the fleet, develop by hand with ad-hoc agents, resume at a stability milestone

- **Keep, on the pull-request path:** the product gates (typecheck, lint, unit tests, goldens,
  byte fidelity, licences, no-network, sanitiser vectors, boundaries, contracts, aesthetics with
  its mutation selftest); CODEOWNERS on security paths; trunk-based development with squash
  merges; Conventional Commits; one changelog line per change (`changelog.d/`).
- **Keep, in the repository but off the PR path:** all of `orchestration/` and its tests,
  frozen. Move `node --test orchestration/...` out of `pnpm test` into a `test:fleet` script
  that runs only when `orchestration/` changes, and in nightly.
- **Stop:** the loop; the planner; plan deltas; the Jira mirror (keep Jira only if the author
  reads it); `check-story --strict`'s requirement that every branch has a key and a board row;
  the result file and signed agent approval as merge requirements for the author's own PRs;
  task cards as a requirement; the enforced PR section order and sentence count (keep the
  template as a suggestion); `out-of-plan.mjs` as the only way to start work; tests that assert
  documents or history (3.3).
- **Change:** finish ADR-0042 (one plan file per story) or simply freeze the CSV, since the
  plan will be the author's list for a while; make the merge bar's hold reasons a tagged union
  before anything resumes; refactor the hub files (`app.ts`, `main.rs`) into modules with clear
  owners as the new features land, because that is what makes path parallelism work later; use
  a strong model for any agent review the author wants.
- **Assessment:** recommended. It keeps what protects readers, keeps the asset, and removes
  the process that only parallelism needed.

### (c) Extract the orchestrator to its own repository and run Marxy with a minimal process

- **Keep in Marxy:** what (b) keeps on the PR path.
- **Move:** the engine (6.1) to a new repository, behind the interfaces in 6.3.
- **Stop in Marxy:** everything (b) stops, and delete `orchestration/` from the tree.
- **Change:** the new tool takes a project config; Marxy becomes its first user later.
- **Assessment:** right as a second step, wrong as the first. It turns a pause into a
  project, and the tool has not yet run smoothly for three days on any codebase. Extract once
  the fleet has proved itself on Marxy after resumption, or if the author wants it for another
  project sooner.

### (d) Delete it

- **Keep:** the product gates and the lessons in ADR-0034 and the hardening invariants.
- **Stop:** everything else.
- **Assessment:** throws away a sound, tested engine. Git history keeps it, but resuming would
  mean rebuilding its integration. Only right if the author will never run a fleet on Marxy.

### Recommendation: (b), with five criteria for resuming

Resume automation when all five hold, each checkable by a command:

1. **Seams.** Over the last 20 product PRs, fewer than a quarter touch any of the five most-
   edited product files. Today's hubs are `apps/desktop/src/app.ts` and
   `apps/desktop/src-tauri/src/main.rs`. Check with `git log -20 --name-only` over product
   merges against a hub list.
2. **No shared append-only files on the PR path.** Plan rows are one file per story (ADR-0042
   complete, CSV and `deps.json` no longer committed); changelog fragments only. Check:
   `git log --since=7.days --name-only | grep -c -E 'jira-issues.csv|deps.json|^CHANGELOG.md'`
   is 0.
3. **A ready backlog of at least 15 stories** with disjoint `Paths`, machine-checkable
   acceptance, and no dependency on a proposed ADR, written by the author or a strong planner and
   read by the author.
4. **`main` green for seven consecutive days** under hand development, with no revert. Check:
   `gh run list --branch main --workflow ci --limit 50 --json conclusion,createdAt`.
5. **A pruned PR path.** The `conventions` job is no longer the most frequent cause of red CI,
   and orchestration tests run only when `orchestration/` changes.

Then resume as a **pilot**, not a switch: `reviewLanes` 2, at most five stories in flight, a
reviewer at least as strong as `default` mode's Sonnet, and the planner off (the author plans).
Stop again if, over three days, resolution runs exceed implementation runs, any story is parked
after three resolutions, or **Needs you** stays above ten for a day. Those are the failure
signatures of the last four days; if they recur, the conditions were not met.

---

## Appendix: commands behind the numbers

All run from the worktree at `4526b811`, with the fleet store read at
`/Users/ian/Dev/marxy/.git/marxy-fleet/`. The event log there starts at 2026-09-26 19:01 UTC
(an `imported` snapshot of the older `state.json`), so run and event counts cover
2026-09-26 to 2026-09-29 only.

**Per-commit numstat, used by the next two scripts.**

```sh
git log --reverse --numstat --format='@@%ad|%h|%s' --date=short > numstat.txt
```

**Waves (section 2.2).** Sums additions and deletions under `orchestration/`, and separately
under `scripts/`, `.github/` and `.githooks/`, per date range.

```python
import collections
cs=[];c=None
for l in open('numstat.txt'):
    l=l.rstrip('\n')
    if l.startswith('@@'): d,h,s=l[2:].split('|',2); c={'d':d,'s':s,'f':[]}; cs.append(c)
    elif l.strip():
        a,r,p=l.split('\t',2); c['f'].append((int(a) if a!='-' else 0,int(r) if r!='-' else 0,p))
W=[('W0','2026-09-17','2026-09-18'),('W1','2026-09-19','2026-09-20'),('W2','2026-09-21','2026-09-25'),
   ('W3','2026-09-26','2026-09-26'),('W4','2026-09-27','2026-10-01')]
for n,a,b in W:
    o=[0,0];s=[0,0]
    for c in cs:
        if a<=c['d']<=b:
            for x,y,p in c['f']:
                t=o if p.startswith('orchestration/') else s if p.startswith(('scripts/','.github/','.githooks/')) else None
                if t: t[0]+=x; t[1]+=y
    print(n,'orchestration +%d -%d'%tuple(o),'scripts/.github/.githooks +%d -%d'%tuple(s))
# W0 +4819 -423 | +4710 -327 · W1 +4543 -1039 | +5263 -541 · W2 +5117 -1061 | +3485 -560
# W3 +5456 -4991 | +327 -27 · W4 +3417 -434 | +3308 -296
```

The `scripts/` figures include product gates (`gate-aesthetics`, `gate-fidelity`,
`gate-licences`, `gate-no-network`, `measure-*`) as well as process scripts; they are an upper
bound on process growth outside `orchestration/`.

**Subject buckets (section 2.1).** First matching rule wins.

```python
import re,collections
PLAN=re.compile(r'plan delta|land the .*(plan|delta)|land .*(widen|path|split|plan|board|rulings|delta)|'
  r'^chore\(plan\)|file .*stor|split MARXY|after-\d+|board rows|unblock stories stuck|rebase hidden|'
  r'let copy, links|correct a stale board|stale human-queue|recommendations on the board|'
  r'land needs-human|merge precautions',re.I)
SC=re.compile(r'^(?:\[human\] )?([a-z]+)(?:\(([^)]*)\))?!?:')
def bucket(s):
    m=SC.match(s); sc=(m.group(2) if m else '') or ''
    if PLAN.search(s): return 'replanning'
    if sc=='orchestration': return 'orchestrator'
    if sc in ('gates','ci','repo','ops','scripts','taste-review','taste'): return 'gates/ci/process'
    if sc in ('desktop','core','theme','typeset','shell-api','fonts','corpus','shell','position','workspace'): return 'product'
    if sc in ('docs','adr','spike') or (m and sc==''): return 'docs/research'
    return 'other'
print(collections.Counter(bucket(l.split('|',2)[2].strip()) for l in open('numstat.txt') if l.startswith('@@')))
# product 104, orchestrator 64, gates/ci/process 53, replanning 42, docs/research 19, other 4
```

Two commits in the re-planning bucket are process features rather than re-planning (MARXY-315
changelog fragments, MARXY-327 accepting ADR-0042); both stay inside the process total.

**Plan-delta text by section heading (section 5.1).** Crude by construction: it classifies a
section by its heading only.

```python
import re,glob,collections
proc=re.compile(r'escalat|stuck|park|path|widen|conflict|re-?sequenc|landing|land|what changed|tripwire|'
  r'block|split|retry|merge|review|board|ops|fleet|not filed|who holds|unblock|attempt|orchestrat|queue|'
  r'plan pull|discharg|rulings|what this pass|sequence|deps|dispatch',re.I)
prod=re.compile(r'design|scope|taste|feature|typograph|perf|research|cold.start|budget|reader|artifact|'
  r'theme|shell|font|spirit|product',re.I)
t=collections.Counter()
for f in glob.glob('docs/plan/deltas/*.md'):
    cur=None
    for l in open(f):
        if l.startswith(('## ','### ')): cur=l.strip('# \n')
        w=len(l.split())
        t['preamble' if cur is None else 'product' if prod.search(cur) and not proc.search(cur)
          else 'process' if proc.search(cur) else 'other']+=w
print(t)   # process 37859, other 30823, preamble 4289, product 3889 (of 76860)
```

**Needs-you breakdown (section 2.3).** Read from the last `status.md` (2026-09-29 07:35 UTC):

```sh
sed -n '/## Needs you/,/^## In flight/p' /Users/ian/Dev/marxy/.git/marxy-fleet/status.md \
  | grep '^- ' | sed -E 's/^- (\*\*gate\*\* )?\*\*[^*]+\*\* — //' | cut -c1-40 | sort | uniq -c | sort -rn
```

---

## For the synthesis

1. Recommend option (b): pause the fleet, keep `orchestration/` in the repository frozen and off the pull-request path, develop by hand with ad-hoc agents, and resume as a small pilot only when the five measurable criteria in section 7 hold.
2. The reconciler core (ADR-0034: event log with fencing, level-triggered pure reconcile, bounded workers, head-pinned signed approval) is sound and worth keeping; most of the other ~13,000 lines are accidental complexity added one stall at a time across five waves.
3. In the fleet's last four days, contention, not implementation, was the main workload (139 conflict-resolution runs against 86 implementation runs, 19 stories parked after three failed resolutions), caused mostly by shared process files (`CHANGELOG.md` touched by 239 of 286 commits, the plan CSV by 116) and partly by product hub files.
4. Process dominated output: 148 of 286 commits carry a process scope, 42 commits only re-planned the fleet's own stories, 155 of 278 stories sit in the `ops` lane, and the planner wrote 76,860 words of deltas in twelve days.
5. The author is right to stop, but the reason is sharper than "early prototype": the fleet needs stable seams, a stable plan, a pruned process, and a reviewer stronger than the implementor, and the fleet actually ran in `minimal` mode with Composer reviewing 76 of 80 pull requests.
6. Of the sixteen artefacts and checks every pull request needs, four protect the product directly and one lightly; ten exist so that parallel weak agents, the merge bar and the Jira mirror have something to read, and the project's own CI contract says the conventions job "fails most, and never for a code reason."
7. Strip from the pull-request path: board rows and keys on every branch, enforced PR section order, result files and agent signatures for the author's PRs, task cards, the Jira mirror, plan deltas, tests that assert documents or history, and the 440 orchestrator tests on every product PR.
8. Extraction to a standalone tool is feasible (the engine is about 2,700 lines behind a handful of interfaces) but should follow a successful resumption, not precede it; key regexes, the CSV schema, Jira, the house PR template and `cursor-agent` are the couplings to cut.
