# Fleet metrics: what the agent fleet did, 2026-09-17 to 2026-10-01

Date: 2026-10-01 (data read at 2026-10-02T05:15Z, which is the evening of 2026-10-01 in the author's time zone).
Task: `fleet-metrics`, part of MARXY-346. Everything below is measured; every table names the script that made it, and the scripts are in the appendix.

**Abstract.** In 14 days the repository took 314 pull requests (278 merged, 35 closed unmerged, 1 open) and 287 commits on `main`, and ran 1,300 CI runs. The fleet's own event log covers only the last 5.4 days of that (it starts at 2026-09-26T19:01Z with a snapshot of the older state file), so per-run data is for 2026-09-26 to 2026-09-29 only: 318 worker runs, 56 run-hours, 86 of them implementation attempts. The fleet loop stopped on 2026-09-29T07:35Z (drain mode); everything merged after that was done by hand-started sessions, and the folded board is stale for 26 stories as a result. By pull-request scope, 170 merges were ops and 103 were product. This document records the numbers and does not interpret them beyond the short section near the end.

**Conventions.** All times are UTC. A "day" is a UTC day. Git author dates were converted from -07:00. Weeks start on Monday. Product scopes are `core, typeset, theme, desktop, shell, shell-api` plus `position, fonts, corpus` (small scopes that name product code or fixtures). Ops scopes are `orchestration, gates, ci, docs, plan, repo` plus `ops, scripts, adr, taste, taste-review, workspace`. PR titles with no scope (`fix: ...`, `docs: ...`) are "unscoped" (5 merged PRs). The prefix `[human]` is stripped before parsing a title.

## 0. What the data covers (read this first)

| Source | Range | Notes |
|---|---|---|
| `events.jsonl` | 2026-09-26T19:01Z to 2026-10-02T05:10Z, 2,480 lines | line 1 is an `imported` snapshot of the old `state.json` (177 stories, 162 done, 167 merges). Nothing before it is event-level. |
| `runs/*` | 318 runs, first start 2026-09-26T20:35Z, last start 2026-09-29T06:55Z | no worker run is recorded after the loop stopped |
| `loop.log` | 867 cycles, 2026-09-26T20:35Z to 2026-09-29T07:35Z | one cycle about every 2 to 3 minutes while running |
| `gh pr list` | 314 PRs, #1 to #314, from 2026-09-18 | complete |
| `gh run list --workflow ci` | 1,300 runs, 2026-09-18 to 2026-10-02 | complete (limit raised to 5,000; 1,300 returned) |
| `git log origin/main` | 287 commits, 2026-09-17T23:53-07:00 to 2026-10-01T22:13-07:00 | squash merges, one commit per PR plus a handful of direct ones |
| `docs/plan/jira-issues.csv` | 283 rows in the worktree (278 Story, 5 Epic); 282 on `origin/main` | the brief said 265; the extra row in the worktree is this audit's own MARXY-346, which is also the one extra key in `deps.json` (ops lane 155 in the worktree, 154 on `main`) |

```bash
wc -l /Users/ian/Dev/marxy/.git/marxy-fleet/events.jsonl; ls /Users/ian/Dev/marxy/.git/marxy-fleet/runs | wc -l
gh pr list --state all --limit 1000 --json number,title,state,createdAt,mergedAt,closedAt,headRefName,additions,deletions,changedFiles,labels,author
gh run list --workflow ci --limit 5000 --json conclusion,createdAt,updatedAt,startedAt,event,headBranch,databaseId,status
git log origin/main --format='%H%x09%aI%x09%cI%x09%an%x09%s'     # 287 lines
```

Two data-quality facts matter for every table. First, all 314 PRs and all 287 commits are authored under one identity (`inkstrata`, shown as Ink on 249 commits), so GitHub cannot say who or what wrote a change; the fleet store can, for the last 5.4 days only. Second, the fleet's folded board is behind GitHub: 27 PRs merged after the last cycle, and 26 stories are still `todo`, `in_progress`, `in_review` or `escalate` on the board although a merged PR carries their key.

## 1. Stories by phase or lane and by status

Source: `fold.mjs` (the fleet's own `machine.mjs` `fold()` over `events.jsonl`), `t1.mjs`, `t1b.mjs`. Phase and lane come from `orchestration/deps.json` (`ops` is a lane beside numbered phases). "Unlisted" means the key is on the board but in no `deps.json` phase (out-of-plan stories whose row lived on their own branch).

The ops lane includes MARXY-346 (this audit) as an in-progress story, and the 41 unlisted keys include MARXY-344, whose PR (#314) is the one open PR.

**1a. As the board folds today** (301 stories on the board, plus 18 in `deps.json` that never got a board record):

| Phase / lane | todo | in_progress | in_review | blocked | escalate | done | no board record | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| phase 0 | 0 | 0 | 0 | 0 | 0 | 25 | 0 | 25 |
| phase 1 | 0 | 0 | 0 | 0 | 0 | 34 | 0 | 34 |
| phase 2 | 0 | 0 | 0 | 0 | 0 | 16 | 1 | 17 |
| phase 3 | 7 | 0 | 0 | 1 | 2 | 25 | 7 | 42 |
| phase 4 | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 5 |
| ops (lane) | 12 | 7 | 2 | 3 | 2 | 120 | 9 | 155 |
| unlisted (not in deps.json) | 6 | 2 | 0 | 3 | 0 | 30 | 0 | 41 |
| **total** | 29 | 9 | 2 | 7 | 4 | 250 | 18 | 319 |

**1b. Reconciled with GitHub** (a story whose key has a merged PR counts as done; 26 stories change):

| Phase / lane | todo | in_progress | in_review | blocked | escalate | done | todo, no board record | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| phase 0 | 0 | 0 | 0 | 0 | 0 | 25 | 0 | 25 |
| phase 1 | 0 | 0 | 0 | 0 | 0 | 34 | 0 | 34 |
| phase 2 | 0 | 0 | 0 | 0 | 0 | 16 | 1 | 17 |
| phase 3 | 2 | 0 | 0 | 1 | 1 | 31 | 7 | 42 |
| phase 4 | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 5 |
| ops (lane) | 2 | 1 | 0 | 3 | 0 | 141 | 8 | 155 |
| unlisted | 6 | 2 | 0 | 3 | 0 | 30 | 0 | 41 |
| **total** | 14 | 3 | 0 | 7 | 1 | 277 | 17 | 319 |

How the 250 board-done stories got there (`t3.mjs`):

| Route | done stories |
|---|---:|
| done already in the 09-26 snapshot (before the event log) | 162 |
| out-of-plan (human/in-app session) | 37 |
| fleet implement run (09-26 on) | 28 |
| recorded done by hand | 19 |
| other | 2 |
| claimed by ian | 2 |

Reading the route table: 162 were already done in the snapshot, so the event log can say nothing about how they were built. Of the 88 that finished after it, 28 went through a fleet implement run, 37 through `out-of-plan.mjs start` (a story worktree and claim made by a person or an in-app session), 19 were bulk-recorded "done by hand" by the cycle (19 of the 20 such events were written in one cycle at 2026-09-27T13:37Z), 2 were claimed by a person with `fleet.mjs claim`, and 2 are unclassified.

## 2. Worker runs by role, outcome and model

Source: `runs.mjs` (reads every `run.json` and `exit.json`; the two runs without `exit.json` take their outcome from the board), `t2.mjs`. `deadline` is `run.json` deadline minus start: 45 minutes for every run. `actual` is `exit.json.endedAt` minus start.

**2a. Role by outcome** (`exited` means the process ended by itself, not that it succeeded):

| Role | exited | timeout | stalled | setup | total |
|---|---:|---:|---:|---:|---:|
| implement | 57 | 26 | 2 | 1 | 86 |
| review | 77 | 2 | 1 | 0 | 80 |
| resolve | 136 | 0 | 0 | 3 | 139 |
| plan | 11 | 2 | 0 | 0 | 13 |

**2b. Model by role, and model by outcome:**

| Model | implement | review | resolve | plan | total |
|---|---:|---:|---:|---:|---:|
| composer-2.5 | 71 | 76 | 101 | 0 | 248 |
| grok-4.6 | 15 | 0 | 38 | 0 | 53 |
| claude-sonnet-5 | 0 | 4 | 0 | 0 | 4 |
| claude-opus-5-5-medium | 0 | 0 | 0 | 1 | 1 |
| grok-4.7-high | 0 | 0 | 0 | 12 | 12 |

| Model | exited | timeout | stalled | setup | total | non-exited % |
|---|---:|---:|---:|---:|---:|---:|
| composer-2.5 | 222 | 23 | 2 | 1 | 248 | 10.5 |
| grok-4.6 | 45 | 4 | 1 | 3 | 53 | 15.1 |
| claude-sonnet-5 | 3 | 1 | 0 | 0 | 4 | 25.0 |
| claude-opus-5-5-medium | 1 | 0 | 0 | 0 | 1 | 0.0 |
| grok-4.7-high | 10 | 2 | 0 | 0 | 12 | 16.7 |

Escalation attempts use `grok-4.6`; first attempts, reviews and resolves use `composer-2.5`; the planner used `claude-opus-5-5-medium` once and then `grok-4.7-high`. In the pre-log snapshot, the last model recorded per story was `grok-4.6-fast` 60, `composer-2.5` 36, `composer-2.5-fast` 9, `claude-sonnet-5` 5 plus 4 `thinking-medium`, `claude-opus-5` 3, none 60. No per-run data exists for that period.

**2c. Run minutes by role, by model and by role and outcome:**

|  | runs | actual min (sum) | deadline min (sum) | median min | p90 min | max min |
|---|---:|---:|---:|---:|---:|---:|
| implement | 86 | 2483 | 3870 | 27.6 | 45.2 | 66.2 |
| review | 80 | 452 | 3600 | 4.5 | 10.0 | 30.9 |
| resolve | 139 | 161 | 6255 | 0.8 | 2.0 | 15.7 |
| plan | 13 | 267 | 585 | 15.6 | 46.2 | 52.2 |
| **all** | 318 | 3363 | 14310 | 2.9 | 41.1 | 66.2 |

|  | runs | actual min (sum) | deadline min (sum) | median min | p90 min | max min |
|---|---:|---:|---:|---:|---:|---:|
| composer-2.5 | 248 | 2601 | 11160 | 3.0 | 41.8 | 66.2 |
| grok-4.6 | 53 | 470 | 2385 | 1.0 | 34.6 | 60.8 |
| claude-sonnet-5 | 4 | 25 | 180 | 6.3 | 7.1 | 7.1 |
| claude-opus-5-5-medium | 1 | 7 | 45 | 7.4 | 7.4 | 7.4 |
| grok-4.7-high | 12 | 260 | 540 | 17.3 | 46.2 | 52.2 |

|  | runs | actual min (sum) | deadline min (sum) | median min | p90 min | max min |
|---|---:|---:|---:|---:|---:|---:|
| implement / exited | 57 | 1143 | 2565 | 19.0 | 35.0 | 44.8 |
| implement / timeout | 26 | 1258 | 1170 | 45.2 | 59.4 | 66.2 |
| implement / stalled | 2 | 82 | 90 | 41.1 | 44.5 | 44.5 |
| implement / setup | 1 | 0 | 45 | 0.1 | 0.1 | 0.1 |
| review / exited | 77 | 397 | 3465 | 4.1 | 9.9 | 15.3 |
| review / timeout | 2 | 25 | 90 | 12.3 | 17.8 | 17.8 |
| review / stalled | 1 | 31 | 45 | 30.9 | 30.9 | 30.9 |
| resolve / exited | 136 | 161 | 6120 | 0.8 | 2.0 | 15.7 |
| resolve / setup | 3 | 0 | 135 | 0.1 | 0.1 | 0.1 |
| plan / exited | 11 | 169 | 495 | 15.4 | 20.0 | 24.5 |
| plan / timeout | 2 | 98 | 90 | 49.2 | 52.2 | 52.2 |

**2d. Implement runs by model role, and what happened to the story next** (`t3.mjs`, matching `ifRun` on story events):

| modelRole/model | runs | exited | timeout | stalled | setup | median min |
|---|---:|---:|---:|---:|---:|---:|
| implementor / composer-2.5 | 71 | 47 | 22 | 1 | 1 | 27.3 |
| implementorEscalation / grok-4.6 | 15 | 10 | 4 | 1 | 0 | 28.5 |

| run outcome -> next status | n |
|---|---:|
| exited -> in_review | 49 |
| timeout -> todo | 20 |
| exited -> blocked | 6 |
| timeout -> escalate | 4 |
| timeout -> in_review | 2 |
| setup -> in_review | 1 |
| exited -> todo | 1 |
| stalled -> escalate | 1 |
| stalled -> todo | 1 |
| exited -> escalate | 1 |

Other facts from `t2.mjs`: runs started per day were 15 (09-26), 92 (09-27), 140 (09-28) and 71 (09-29); peak concurrency was 13 runs; wall span 58.4 hours against 56.0 run-hours; 9 runs outlived the 45-minute deadline (longest +21 minutes); worker logs total 203 MB. Four runs failed in `setup`, all on MARXY-195 (a branch already checked out in another worktree, or a ref-lock race).

## 3. Per-story attempts, escalations, reviews and conflict runs

Source: `t3.mjs`, `t3b.mjs`. "Board attempts" is the net counter (refunds subtract) and includes the pre-log era; the other rows count run records from 09-26 on. "Returns" counts story transitions to `todo` whose reason starts `returned:` (a reviewer's verdict, a red CI check, or files outside the story's paths).

| per-story count | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9+ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| board `attempts` (net, incl. pre-09-26) | 129 | 96 | 55 | 19 | 1 | 1 | 0 | 0 | 0 | 0 |
| implement runs (09-26 on) | 258 | 14 | 16 | 12 | 1 | 0 | 0 | 0 | 0 | 0 |
| escalation-model implement runs | 287 | 13 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| review runs | 248 | 37 | 10 | 4 | 0 | 1 | 1 | 0 | 0 | 0 |
| conflict-resolve runs | 242 | 25 | 10 | 15 | 3 | 1 | 3 | 2 | 0 | 0 |
| returns to todo (reviewer/CI/path) | 263 | 26 | 7 | 2 | 1 | 1 | 1 | 0 | 0 | 0 |

Totals across the 305 implement, review and resolve runs: 86 implement runs (15 on the escalation model), 80 review runs, 139 conflict-resolve runs; 67 return events (41 by the reviewer agent, 17 for red CI, 9 for files outside the story's paths), of which 61 went to `todo` (the table's last row) and 6 to `escalate`; 25 `blocked` transitions; 12 `escalate` transitions. Only 84 stories had any run at all. Of the 28 done stories that had an implement run, 3 finished with one implement run, no return and no resolve run.

**The ten worst stories by total runs plus returns:**

| Story | phase | status | board attempts | impl runs (esc) | timeouts/stalls | review | resolve | returns | blocked evts | human unpark/retry/claim | run-min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MARXY-290 | unlisted | todo | 0 | 0 (0) | 0 | 6 | 4 | 6 | 0 | 0/2 | 38 |
| MARXY-254 | ops | done | 2 | 2 (0) | 0 | 0 | 7 | 3 | 1 | 1/0 | 62 |
| MARXY-184 | 3 | done | 0 | 0 (0) | 0 | 5 | 1 | 5 | 0 | 0/1 | 13 |
| MARXY-195 | 2 | done | 3 | 2 (1) | 0 | 1 | 5 | 2 | 1 | 1/1 | 22 |
| MARXY-268 | 3 | done | 3 | 3 (1) | 0 | 3 | 2 | 2 | 0 | 0/0 | 61 |
| MARXY-49 | 3 | todo | 1 | 1 (0) | 0 | 0 | 4 | 4 | 1 | 1/2 | 26 |
| MARXY-230 | 3 | done | 3 | 3 (1) | 0 | 1 | 3 | 2 | 1 | 1/1 | 38 |
| MARXY-255 | ops | done | 2 | 2 (0) | 0 | 0 | 6 | 1 | 2 | 2/0 | 18 |
| MARXY-252 | 3 | done | 2 | 2 (0) | 1 | 0 | 6 | 1 | 2 | 2/0 | 97 |
| MARXY-284 | ops | done | 2 | 2 (0) | 0 | 2 | 4 | 1 | 1 | 1/0 | 56 |

Concentration: the top 10 stories hold 27% of all 305 runs and the top 20 hold 47%. Conflict resolution: 59 stories needed it; 43 of those are done, 11 are back at todo, 3 blocked, 1 escalated, 1 in review. Of 139 resolve runs, 90 lasted under one minute and 2 lasted over five; total resolve time is 161 minutes against 6,255 minutes allotted. Nineteen stories were parked as "still conflicts with main after 3 resolution runs".

## 4. Lead time: dispatch to PR open to merge

Source: `t4.mjs`. Dispatch is the earliest known `in_progress` time for the story key (the snapshot's `started` field before 09-26, the first `in_progress` event after); PR open and merge come from `gh`. Hours. `n` is how many PRs have that interval (a PR with no recorded dispatch before its open time is left out of the dispatch columns; `open->merge` uses all 278 merged PRs).

**4a. Overall and by merge week:**

|  | merged PRs | n | disp->open med h | p90 | n | open->merge med h | p90 | n | disp->merge med h | p90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **all** | 278 | 165 | 0.2 | 2.9 | 278 | 0.8 | 14.0 | 210 | 1.2 | 15.2 |
| week of 2026-09-14 | 127 | 63 | 0.1 | 0.5 | 127 | 0.4 | 8.4 | 99 | 0.4 | 7.5 |
| week of 2026-09-21 | 83 | 35 | 0.3 | 2.9 | 83 | 0.5 | 11.1 | 44 | 2.4 | 12.2 |
| week of 2026-09-28 | 68 | 67 | 0.3 | 6.3 | 68 | 6.0 | 35.0 | 67 | 7.5 | 37.9 |

**4b. By scope bucket, and by scope (3 or more merged PRs):**

|  | merged PRs | n | disp->open med h | p90 | n | open->merge med h | p90 | n | disp->merge med h | p90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| product | 103 | 63 | 0.3 | 5.9 | 103 | 3.2 | 15.7 | 91 | 2.2 | 22.9 |
| ops | 170 | 100 | 0.1 | 1.3 | 170 | 0.4 | 11.7 | 117 | 0.7 | 14.6 |
| unscoped | 5 | 2 | 0.6 | 0.9 | 5 | 1.4 | 22.7 | 2 | 1.5 | 2.0 |

|  | merged PRs | n | disp->open med h | p90 | n | open->merge med h | p90 | n | disp->merge med h | p90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| orchestration (ops) | 81 | 46 | 0.1 | 0.6 | 81 | 0.2 | 9.0 | 51 | 0.4 | 12.2 |
| desktop (product) | 45 | 28 | 0.9 | 30.2 | 45 | 1.9 | 22.4 | 41 | 2.2 | 37.9 |
| gates (ops) | 34 | 23 | 0.3 | 2.4 | 34 | 0.7 | 9.4 | 30 | 0.8 | 10.6 |
| core (product) | 29 | 17 | 0.3 | 6.7 | 29 | 4.8 | 14.8 | 26 | 3.5 | 17.3 |
| docs (ops) | 21 | 10 | 0.1 | 0.2 | 21 | 0.7 | 16.4 | 11 | 0.8 | 22.9 |
| plan (ops) | 12 | 6 | 0.0 | 0.8 | 12 | 0.1 | 0.2 | 7 | 0.1 | 1.0 |
| theme (product) | 12 | 7 | 0.2 | 0.6 | 12 | 2.8 | 15.7 | 10 | 1.2 | 6.0 |
| typeset (product) | 8 | 6 | 0.2 | 1.4 | 8 | 1.4 | 15.0 | 7 | 1.1 | 16.4 |
| ci (ops) | 7 | 4 | 0.3 | 6.3 | 7 | 7.2 | 35.0 | 5 | 12.8 | 35.4 |
| repo (ops) | 6 | 5 | 0.2 | 1.1 | 6 | 0.9 | 12.0 | 5 | 1.2 | 12.3 |
| (none) (unscoped) | 5 | 2 | 0.6 | 0.9 | 5 | 1.4 | 22.7 | 2 | 1.5 | 2.0 |
| shell-api (product) | 3 | 2 | 0.2 | 0.3 | 3 | 4.9 | 23.0 | 3 | 4.7 | 23.1 |

**4c. Open to merge, product against ops, by week; and before against after the event log began:**

| week | product n | product med | product p90 | ops n | ops med | ops p90 |
|---|---:|---:|---:|---:|---:|---:|
| week of 2026-09-14 | 44 | 2.3 | 8.9 | 81 | 0.3 | 5.8 |
| week of 2026-09-21 | 30 | 1.3 | 12.5 | 50 | 0.4 | 9.9 |
| week of 2026-09-28 | 29 | 8.0 | 37.5 | 39 | 4.0 | 35.0 |

|  | merged PRs | n | disp->open med h | p90 | n | open->merge med h | p90 | n | disp->merge med h | p90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| merged before cut | 183 | 72 | 0.1 | 0.6 | 183 | 0.4 | 8.5 | 117 | 0.5 | 7.8 |
| merged after cut | 95 | 93 | 0.3 | 4.8 | 95 | 2.9 | 25.9 | 93 | 4.6 | 36.9 |

Size of merged PRs (additions plus deletions):

| bucket | n | median lines | p90 lines | median files |
|---|---:|---:|---:|---:|
| product | 103 | 382 | 1397 | 9 |
| ops | 170 | 260 | 633 | 7 |
| unscoped | 5 | 1380 | 3647 | 38 |

## 5. Merges per day, scope mix, ratio, and closed PRs

Source: `t4.mjs`, `t5b.mjs`.

**5a. Merged PRs per day (UTC) by bucket, with the running ops:product ratio:**

| day (UTC) | merged | product | ops | unscoped | ops share % | cum product | cum ops | cum ops:product |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-18 | 29 | 15 | 13 | 1 | 45 | 15 | 13 | 0.87 |
| 2026-09-19 | 47 | 11 | 35 | 1 | 74 | 26 | 48 | 1.85 |
| 2026-09-20 | 51 | 18 | 33 | 0 | 65 | 44 | 81 | 1.84 |
| 2026-09-21 | 15 | 7 | 8 | 0 | 53 | 51 | 89 | 1.75 |
| 2026-09-22 | 14 | 5 | 9 | 0 | 64 | 56 | 98 | 1.75 |
| 2026-09-23 | 9 | 3 | 5 | 1 | 56 | 59 | 103 | 1.75 |
| 2026-09-24 | 0 | 0 | 0 | 0 | - | 59 | 103 | 1.75 |
| 2026-09-25 | 12 | 3 | 9 | 0 | 75 | 62 | 112 | 1.81 |
| 2026-09-26 | 11 | 0 | 11 | 0 | 100 | 62 | 123 | 1.98 |
| 2026-09-27 | 22 | 12 | 8 | 2 | 36 | 74 | 131 | 1.77 |
| 2026-09-28 | 20 | 12 | 8 | 0 | 40 | 86 | 139 | 1.62 |
| 2026-09-29 | 44 | 15 | 29 | 0 | 66 | 101 | 168 | 1.66 |
| 2026-09-30 | 0 | 0 | 0 | 0 | - | 101 | 168 | 1.66 |
| 2026-10-01 | 2 | 1 | 1 | 0 | 50 | 102 | 169 | 1.66 |
| 2026-10-02 | 2 | 1 | 1 | 0 | 50 | 103 | 170 | 1.65 |

**5b. Weekly ratio, and scope by week:**

| week | merged | product | ops | unscoped | ops:product |
|---|---:|---:|---:|---:|---:|
| week of 2026-09-14 | 127 | 44 | 81 | 2 | 1.84 |
| week of 2026-09-21 | 83 | 30 | 50 | 3 | 1.67 |
| week of 2026-09-28 | 68 | 29 | 39 | 0 | 1.34 |

| merge week (Mon, UTC) | orchestration | gates | docs | plan | ci | repo | desktop | core | theme | typeset | shell-api | other/unscoped | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week of 2026-09-14 | 33 | 26 | 5 | 6 | 3 | 2 | 16 | 14 | 5 | 3 | 0 | 14 | 127 |
| week of 2026-09-21 | 29 | 2 | 12 | 4 | 1 | 1 | 18 | 5 | 6 | 0 | 1 | 4 | 83 |
| week of 2026-09-28 | 19 | 6 | 4 | 2 | 3 | 3 | 11 | 10 | 1 | 5 | 2 | 2 | 68 |

By PR scope the cumulative ops:product merge ratio was 0.87 after day 1, about 1.75 for most of the period, and 1.65 at the end (170:103). By lines touched in `git log --numstat` (section 7) it is 1.28:1 overall, and by commit (a commit counts as ops or product if that side has at least twice the touched lines of the other) 178 ops, 94 product, 12 mixed, 3 neither. No merges landed on 09-24 or 09-30.

**5c. Closed and not merged: 35 PRs.** GitHub records no close reason, so this is by title, branch and timing (`t4.mjs`, `gh pr list`). By bucket: 30 ops, 3 unscoped, 2 product. Seventeen of the 35 were closed in four same-minute batches:

| Closed at | PRs | What they were |
|---|---:|---|
| 2026-09-19 07:03 | 9 (#15 #21 #28 #41 #43 #45 #47 #51 #52) | gates, orchestration and docs PRs from 09-18 and 09-19 |
| 2026-09-28 07:44 | 4 (#228 #242 #250 #253) | planner plan-delta and unblock PRs, closed together |
| 2026-09-26 19:15 | 2 (#208 #209) | planner plan-delta PRs |
| 2026-09-22 06:23 | 2 (#173 #174) | docs and rename chores |

Of the 35, 12 are plan-delta or board-row landing PRs by title, 1 is a PR left with the template title `type(scope): subject` (#212), and 23 have a key that later merged in another PR (the work was redone, not dropped). Median lifetime before closing was 5.5 hours. Six PRs carry labels (`phase-0`, `phase-1`, `phase-2`, `speed`, `security`, `documentation`); the rest carry none.

## 6. CI

Source: `fetchjobs.sh` (one read-only `gh api .../actions/runs/ID/jobs` call per run), `t6.mjs`. Wall time is `updatedAt - startedAt` per run. Runner minutes are the sum of job durations from `started_at` to `completed_at`, skipped jobs excluded. The repository is public, so GitHub bills none of it; the numbers are load, not cost.

`.github/workflows/ci.yml` (309 lines) runs on `pull_request`, `merge_group` and `push` to `main`. Jobs: `changes`, `conventions` (PRs only), `fast`, `browser`, `gates` as a matrix of `macos-latest` and `ubuntu-latest` (or a `gates-skip` stub when gate paths did not change), `gates-record`, and the aggregate `ci`. A run starts up to 8 jobs (median 7 non-skipped), two of them the macOS and Ubuntu pair, so one wall-clock minute is about 1.95 runner minutes (measured: 12,182 runner minutes over 6,250 wall minutes of runs).

**6a. Runs per day and outcome:**

| day (UTC) | runs | success | failure | cancelled | skipped/other | success % | failure % | cancelled % | runs on PRs | runs on main push |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-18 | 281 | 151 | 91 | 39 | 0 | 54 | 32 | 14 | 248 | 33 |
| 2026-09-19 | 210 | 148 | 38 | 24 | 0 | 70 | 18 | 11 | 163 | 47 |
| 2026-09-20 | 159 | 104 | 32 | 23 | 0 | 65 | 20 | 14 | 108 | 51 |
| 2026-09-21 | 43 | 37 | 4 | 2 | 0 | 86 | 9 | 5 | 28 | 15 |
| 2026-09-22 | 38 | 33 | 4 | 1 | 0 | 87 | 11 | 3 | 24 | 14 |
| 2026-09-23 | 29 | 21 | 7 | 1 | 0 | 72 | 24 | 3 | 20 | 9 |
| 2026-09-25 | 46 | 38 | 5 | 3 | 0 | 83 | 11 | 7 | 34 | 12 |
| 2026-09-26 | 39 | 29 | 8 | 2 | 0 | 74 | 21 | 5 | 28 | 11 |
| 2026-09-27 | 125 | 103 | 15 | 7 | 0 | 82 | 12 | 6 | 103 | 22 |
| 2026-09-28 | 114 | 89 | 23 | 2 | 0 | 78 | 20 | 2 | 94 | 20 |
| 2026-09-29 | 204 | 115 | 47 | 42 | 0 | 56 | 23 | 21 | 160 | 44 |
| 2026-09-30 | 3 | 2 | 1 | 0 | 0 | 67 | 33 | 0 | 3 | 0 |
| 2026-10-01 | 5 | 4 | 1 | 0 | 0 | 80 | 20 | 0 | 3 | 2 |
| 2026-10-02 | 4 | 2 | 0 | 0 | 2 | 50 | 0 | 0 | 2 | 2 |

**6b. By event, and by conclusion:**

| event | runs | success | failure | cancelled | median wall min | p90 wall min | sum wall min (completed, non-cancelled) |
|---|---:|---:|---:|---:|---:|---:|---:|
| push | 282 | 227 | 20 | 34 | 3.6 | 9.0 | 1009 |
| pull_request | 1018 | 649 | 256 | 112 | 4.8 | 9.3 | 4627 |

| conclusion | runs | median wall min | sum wall min |
|---|---:|---:|---:|
|  | 2 | 2.5 | 5 |
| success | 876 | 4.3 | 4059 |
| failure | 276 | 5.1 | 1572 |
| cancelled | 146 | 3.8 | 614 |

**6c. Runner minutes by job, and per day:**

| job | runs | median min | p90 min | sum min |
|---|---:|---:|---:|---:|
| gates | 1463 | 2.9 | 5.0 | 3673 |
| browser | 782 | 3.0 | 8.9 | 3483 |
| gates [macos] | 891 | 2.8 | 4.6 | 2742 |
| fast | 985 | 1.8 | 2.5 | 1670 |
| conventions | 1014 | 0.3 | 0.4 | 364 |
| changes | 1172 | 0.1 | 0.2 | 150 |
| ci | 1171 | 0.1 | 0.1 | 70 |
| gates-record | 424 | 0.1 | 0.1 | 30 |

| day | runner min ubuntu | runner min macos | runs |
|---|---:|---:|---:|
| 2026-09-18 | 1735 | 898 | 281 |
| 2026-09-19 | 994 | 312 | 210 |
| 2026-09-20 | 1067 | 247 | 159 |
| 2026-09-21 | 170 | 51 | 43 |
| 2026-09-22 | 152 | 40 | 38 |
| 2026-09-23 | 204 | 65 | 29 |
| 2026-09-25 | 219 | 52 | 46 |
| 2026-09-26 | 129 | 15 | 39 |
| 2026-09-27 | 1027 | 290 | 125 |
| 2026-09-28 | 1315 | 308 | 114 |
| 2026-09-29 | 2225 | 419 | 204 |
| 2026-09-30 | 46 | 11 | 3 |
| 2026-10-01 | 91 | 20 | 5 |
| 2026-10-02 | 66 | 16 | 4 |

Totals: 12,182 runner minutes (9,440 ubuntu, 2,742 macOS), 7,902 jobs run and 2,013 skipped. Failures: 276 of 1,300 runs (21.2%), 256 of them on pull requests (25.1% of PR runs) and 20 on pushes to `main` (7.1%); cancelled 146 (11.2%). The jobs that failed inside failed runs, excluding the aggregate `ci` job: `gates` (ubuntu) 94, `fast` 79, `conventions` 57, `gates [macos]` 54, `browser` 52, `changes` 3. PR branches with CI: 309; runs per branch median 2, p90 7, max 31. On `main` pushes: 227 success, 18 failure, 34 cancelled, 1 in progress.

## 7. Lines of code over time

Source: `t7.mjs` (`git log origin/main --numstat`, text files only, binaries and the baseline PNGs skipped), `t7c.mjs` (`git ls-files` at `origin/main`, text files only). 159,205 lines added and 15,565 deleted over 287 commits.

**7a. Additions/deletions per day by top-level area:**

| day | packages +/- | apps +/- | orchestration +/- | scripts +/- | docs +/- | fixtures +/- | .github +/- | other +/- | total + | total - |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-18 | 14094/264 | 7185/128 | 3463/273 | 3513/196 | 6997/211 | 2396/15 | 384/62 | 3384/151 | 41416 | 1300 |
| 2026-09-19 | 6980/429 | 1486/291 | 3709/986 | 3155/166 | 3968/300 | 83/0 | 12/1 | 447/29 | 19840 | 2202 |
| 2026-09-20 | 4499/158 | 3656/156 | 1482/121 | 2753/431 | 5339/223 | 797/28 | 111/5 | 295/15 | 18932 | 1137 |
| 2026-09-21 | 647/88 | 2911/194 | 722/89 | 19/17 | 847/8 | - | - | 325/12 | 5471 | 408 |
| 2026-09-22 | 871/13 | 1453/69 | 250/312 | 2474/434 | 1033/239 | 18/0 | 2/1 | 184/46 | 6285 | 1114 |
| 2026-09-23 | 1192/174 | 1548/131 | 1224/413 | 672/85 | 7743/152 | 32/32 | - | 31/8 | 12442 | 995 |
| 2026-09-25 | 420/6 | 1355/107 | 3495/301 | 317/22 | 41/6 | - | 1/1 | 23/7 | 5652 | 450 |
| 2026-09-26 | - | - | 5407/4932 | 6/4 | 13498/133 | - | - | 36/12 | 18947 | 5081 |
| 2026-09-27 | 929/158 | 4198/242 | 962/193 | 765/63 | 959/52 | 2/1 | 27/4 | 501/3 | 8343 | 716 |
| 2026-09-28 | 948/136 | 43/2 | 111/16 | 111/7 | 1558/252 | 71/2 | - | 20/1 | 2862 | 416 |
| 2026-09-29 | 3419/473 | 8138/519 | 2515/305 | 2598/215 | 1251/106 | 64/4 | 48/6 | 104/13 | 18137 | 1641 |
| 2026-10-01 | 11/6 | 194/40 | 12/7 | 34/22 | 19/3 | - | - | 2/0 | 272 | 78 |
| 2026-10-02 | 424/8 | 61/16 | - | 68/3 | 1/0 | 50/0 | - | 2/0 | 606 | 27 |

**7b. Totals by area, and what exists today:**

| area | additions | deletions | net | of which test additions | churn (del/add) |
|---|---:|---:|---:|---:|---:|
| packages | 34434 | 1913 | 32521 | 10401 | 0.06 |
| apps | 32228 | 1895 | 30333 | 9950 | 0.06 |
| orchestration | 23352 | 7948 | 15404 | 8809 | 0.34 |
| scripts | 16485 | 1665 | 14820 | 2438 | 0.10 |
| docs | 43254 | 1685 | 41569 | 156 | 0.04 |
| fixtures | 3513 | 82 | 3431 | 0 | 0.02 |
| .github | 585 | 80 | 505 | 0 | 0.14 |
| other | 5354 | 297 | 5057 | 0 | 0.06 |

| area | text files | lines (excl. lockfiles) | of which ts/tsx/mjs/js/rs/css/html | of which .md | of which in test files | lockfile lines (not counted) |
|---|---:|---:|---:|---:|---:|---:|
| packages | 247 | 32105 | 22195 | 392 | 9823 | 0 |
| apps | 209 | 24906 | 23211 | 1537 | 9727 | 5576 |
| orchestration | 106 | 15406 | 13071 | 866 | 6577 | 0 |
| scripts | 89 | 14799 | 11450 | 0 | 2397 | 0 |
| docs | 406 | 41572 | 2453 | 30039 | 156 | 0 |
| fixtures | 79 | 3384 | 330 | 2416 | 0 | 0 |
| .github | 5 | 505 | 0 | 53 | 0 | 0 |
| other (root) | 76 | 2066 | 188 | 1249 | 0 | 2990 |
| **total** | 1217 | 134743 | 72898 | 36552 | 28680 | 8566 |

Today's tracked tree is 1,576 files, 357 of them binary (taste-review and screenshot PNGs, fonts, icons). `other` in 7a is root files, `changelog.d/`, lockfiles and per-run results. Largest sub-areas by lines: `docs` 41,572; `apps/desktop` 24,906; `packages/core` 24,852; `orchestration` 15,406; `scripts` 14,799; `packages/typeset` 3,596; `packages/theme` 3,505; `fixtures` 3,384. Product code (`packages` plus `apps`) is 57,011 lines; the orchestrator and its gate scripts (`orchestration` plus `scripts`) are 30,205, which is 0.53 lines per product line. `orchestration` has the highest churn (7,948 deleted of 23,352 added, 34%); `packages` and `apps` are at 6%.

**7c. Weekly lines touched, product against ops:**

| week | commits | product-dominant commits | ops-dominant commits | lines touched product (packages+apps+fixtures) | lines touched ops (orchestration+scripts+docs+.github) | ops:product lines |
|---|---:|---:|---:|---:|---:|---:|
| week of 2026-09-14 | 137 | 42 | 87 | 42645 | 37861 | 0.89 |
| week of 2026-09-21 | 82 | 25 | 53 | 16791 | 47925 | 2.85 |
| week of 2026-09-28 | 68 | 27 | 38 | 14629 | 9268 | 0.63 |

## 8. Human interventions

Source: `t8.mjs`, `t8b.mjs`, `git log`. The event log has no user field, only the process that appended an event. A person's commands are `fleet.mjs` events whose reason ends "by ian via fleet.mjs"; sessions run through `out-of-plan.mjs` are started by a person or by an in-app agent; reviewer verdicts also go through `fleet.mjs verdict`, so I separate them by whether a review run for that story was open at the time.

| actor-initiated event | 2026-09-26 | 2026-09-27 | 2026-09-28 | 2026-09-29 | 2026-09-30 | 2026-10-01 | 2026-10-02 | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| out-of-plan start (person or in-app session) | 5 | 19 | 13 | 22 | 1 | - | 2 | 62 |
| doctor.mjs repair | 1 | 8 | - | - | - | - | - | 9 |
| review verdict (agent via fleet.mjs verdict) | 1 | 15 | 15 | 10 | - | - | - | 41 |
| unpark | - | 3 | 10 | 6 | - | - | - | 19 |
| claim (fleet.mjs claim) | - | 2 | 5 | 18 | - | 3 | - | 28 |
| claim renewed | - | 4 | - | 2 | - | - | - | 6 |
| retry | - | - | 1 | 5 | - | - | - | 6 |
| release claim | - | - | - | 14 | - | 1 | - | 15 |

- Person-issued `fleet.mjs` commands: 68 whose reason names the person (28 claims, 19 unparks, 15 claim releases, 6 retries) plus 6 claim renewals. The 68 touched 30 distinct stories (claims, unparks, retries and releases) in 11 sessions (gaps over 30 minutes); 25 of them fell in one session starting 09-29T07:52Z and 13 in another at 09:49Z.
- `out-of-plan.mjs start`: 62 stories (37 of them now done by the route table in section 1).
- `doctor.mjs` (repair tool): 9 story events and 13 run events, 8 of the story events on 09-27.
- `[human]` commit subjects on `main`: 5 of 287 (#278 MARXY-49, #301 MARXY-331, #303 MARXY-334, #306 MARXY-335, #308 MARXY-337), all merged on 2026-09-29 or later.
- CODEOWNERS "human review required" appeared in `loop.log` for 13 distinct PRs; the paths named most often were `orchestration/cycle.mjs`, `.github/workflows/ci.yml`, `apps/desktop/src-tauri/capabilities/default.json` and `orchestration/merge-bar.mjs`.

**Size of "Needs you" over time** (the count in each `loop.log` cycle header; `status.md` is the last cycle, 2026-09-29T07:35Z):

| day (UTC) | cycles | need-you min | median | p90 | max | in flight median | in flight max | cycles with ready>0 % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-26 | 55 | 6 | 9 | 11 | 11 | 3 | 4 | 4 |
| 2026-09-27 | 327 | 7 | 12 | 19 | 19 | 5 | 11 | 4 |
| 2026-09-28 | 322 | 18 | 25 | 30 | 35 | 4 | 17 | 57 |
| 2026-09-29 | 163 | 21 | 30 | 32 | 34 | 6 | 16 | 58 |

Overall median 22, p90 30, maximum 35 (at 2026-09-28T21:40Z), first cycle 9, last cycle 30. Draining began at 2026-09-29T06:32Z (29 cycles in drain). The loop had 14 gaps longer than 30 minutes totalling 23.9 hours inside its 59-hour span (longest 513 minutes). The 30 items in the last `status.md` were: 10 idle worktrees "nothing owns", 8 escalated stories (attempts spent), 5 blocked on "still conflicts after 3 resolution runs", 4 other blocked, 2 PR gates (one CODEOWNERS review, one "result says failed"), 1 "main is red".

## 9. The planner

Source: `t9.mjs`, `t9b.mjs`, `t9c.mjs`, `docs/plan/deltas/`.

**9a. The 13 planner runs** (all in the fleet log; the last column is a PR whose title says delta, unblock, refile or stuck, opened within 2 hours of the run's start, with the hours it then stayed open before merging):

| planner run | model | outcome | min | merges at start | plan PR opened within 2h of start (state, hours open to merge) |
|---|---:|---:|---:|---:|---:|
| 20260926T205650Z | claude-opus-5-5-medium | exited | 7 | 170 | #217 merged +1h |
| 20260927T070214Z | grok-4.7-high | exited | 11 | 176 | #225 closed |
| 20260927T110410Z | grok-4.7-high | exited | 15 | 178 | no PR |
| 20260927T150623Z | grok-4.7-high | exited | 13 | 201 | #238 merged +31h |
| 20260927T190651Z | grok-4.7-high | exited | 20 | 206 | #242 closed |
| 20260927T230814Z | grok-4.7-high | exited | 15 | 212 | #250 closed |
| 20260928T030908Z | grok-4.7-high | exited | 25 | 214 | #253 closed |
| 20260928T072604Z | grok-4.7-high | exited | 19 | 218 | #262 merged +23h |
| 20260928T113559Z | grok-4.7-high | timeout | 52 | 227 | no PR |
| 20260928T160025Z | grok-4.7-high | timeout | 46 | 227 | no PR |
| 20260928T200229Z | grok-4.7-high | exited | 19 | 227 | #272 merged +0h |
| 20260929T000233Z | grok-4.7-high | exited | 16 | 234 | no PR |
| 20260929T040430Z | grok-4.7-high | exited | 10 | 238 | no PR |

Total planner time 267 minutes; 11 exited, 2 timed out (52 and 46 minutes against a 45-minute deadline). Five of the 13 runs opened no plan PR. Reasons named when the planner started, from `loop.log` (a start can name several): an escalated or blocked story waiting to be read 9, a story parked by the fleet after conflicts 7, merge cadence 3, the ops-majority tripwire 1.

Planner pull requests since the first fleet planner run (09-26T20:56Z): 8, of which 4 merged (#217, #238, #262, #272) and 4 were closed unmerged (#225, #242, #250, #253). #238 took 31 hours from open to merge and #262 took 23 hours. The final messages of at least three planner runs (09-27T11:04, 09-27T15:06, 09-28T03:09) say that recent plan PRs were stuck on the path check, or that the cycle cannot land a plan PR that edits other stories.

**9b. Delta files and the stories they carry.** `docs/plan/deltas/` holds 50 `.md` files plus an `evidence/` folder; 51 files were added over 46 commits, by day: 09-18 6, 09-19 8, 09-20 13, 09-21 3, 09-22 3, 09-23 2, 09-26 5, 09-27 2, 09-28 6, 09-29 3. Only 12 of the 51 were added after the first fleet planner run; several of the earlier ones say in their header that they ran in a worktree made by `out-of-plan.mjs start`, that is, in a session outside the fleet's planner slot.

Header keyword counts over the 50 files (`delta-triggers.txt` in the scratch folder; overlapping, first 14 lines of each): trigger is the ops-majority tripwire (the "7 of the last 10 merges were ops" rule) in 6; merge cadence in 18; escalation, parked, stuck or return in 24.

**9c. Stories filed, by lane, and how many touch orchestration** (`t9.mjs`; "orchestration-path" means a Paths cell starting `orchestration`, `scripts`, `.github` or a process doc under `docs/`):

| lane of story (deps.json) | stories ever filed | of which paths touch orchestration/scripts/.github/plan docs |
|---|---:|---:|
| 0 | 25 | 16 |
| 1 | 34 | 11 |
| 2 | 17 | 1 |
| 3 | 42 | 17 |
| 4 | 5 | 1 |
| ops | 154 | 123 |
| unlisted | 5 | 0 |

| week of (row first on main) | new rows | ops lane | product phases | unlisted | orchestration-path rows |
|---|---:|---:|---:|---:|---:|
| week of 2026-09-14 | 140 | 52 | 83 | 5 | 78 |
| week of 2026-09-21 | 80 | 41 | 39 | 0 | 55 |
| week of 2026-09-28 | 62 | 61 | 1 | 0 | 36 |

Rows that reached `main` on a PR whose subject says plan, delta or land: 57 (34 ops lane, 23 product phases; 38 have orchestration-type paths). Rows that reached `main` inside an ops PR that carried its own row: 156. Of the 62 rows first filed in the week of 09-28, 61 are in the ops lane.

## What the numbers say

1. 278 PRs merged in 14 days (19.9 a day), with zero-merge days only on 09-24 and 09-30; weekly merges fell from 127 to 83 to 68 (the last week is five days).
2. Ops scopes are 170 of 278 merges (61%) and product scopes 103 (37%); by lines touched it is 95,054 ops against 74,065 product.
3. Of 88 stories finished after the event log began, 28 came from a fleet implement run; 37 came through `out-of-plan.mjs` and 19 were bulk-recorded as done by hand.
4. Of 86 implement runs, 26 timed out and 2 stalled; the timeouts used 1,258 of 2,483 implement minutes (51%). Of 139 conflict-resolve runs, 90 lasted under a minute, and 19 stories were still parked as unresolvable after three.
5. The reviewer returned 41 of 80 review runs; red CI or out-of-path files returned 26 more times. Only 3 of the 28 done stories that had an implement run needed no return and no resolve run.
6. Median open-to-merge is 0.8 hours, p90 14.0; in the week of 09-28 it is 6.0 median and 35.0 p90, and product PRs took 8.0 hours median that week against 2.3 in the first week.
7. CI ran 1,300 times for 314 PRs; 21% failed and 11% were cancelled, with 12,182 runner minutes (203 hours) spent, 25% of PR runs failing.
8. "Needs you" rose from 9 to 30 over the 59 hours, and by 09-28 the loop had stories ready to start in 57% of cycles, against 4% on the 26th and 27th.
9. The 13 planner runs opened 8 PRs; 4 were closed unmerged, 2 of the merged ones sat open 23 and 31 hours, 5 runs opened no PR, and 9 of 13 starts were triggered by an escalated or blocked story.
10. The orchestrator and its gate scripts are 30,205 of 134,743 tracked text lines (22%), against 57,011 for packages and apps (42%); orchestration has 34% churn and 61 of the 62 story rows filed in the week of 09-28 are in the ops lane.

## For the synthesis

- The fleet loop has been stopped since 2026-09-29T07:35Z; the 27 PRs merged since were landed outside the loop, and 26 board rows are stale. A fleet-store board cannot be trusted without reconciling to GitHub (section 1b: 277 of 319 stories done, not 250).
- Ops work outweighs product work on every measure: 170:103 merged PRs, 178:94 ops-versus-product commits, 154 of 282 filed stories in the ops lane, and 61 of 62 stories filed in the latest week.
- The implementer is the weak step: 30% of implement runs time out and consume half the implementation minutes; the fleet produced 28 of 88 stories finished since 09-26, while `out-of-plan.mjs` sessions produced 37.
- Conflict resolution and review are cheap in minutes but not in outcome: 139 resolve runs (median 0.8 minutes) left 19 stories parked, and reviewers returned about half of what they reviewed.
- Human attention is the bottleneck and it is growing: "Needs you" went from 9 to 30, 68 person-issued commands touched 30 stories, and 10 of the 30 final items are idle worktrees that nothing owns.
- The planner is mostly spent on the fleet's own stuck stories: 9 of 13 starts were for an escalation, 5 of 13 runs opened no PR, and 4 of its 8 PRs were closed unmerged.
- Lead time rose over the period: open-to-merge p90 went 8.4 to 11.1 to 35.0 hours by week, and the post-log era has median 2.9 hours against 0.4 before.
- CI is large relative to the change rate: 1,300 runs, about 4 per PR, 25% of PR runs failing, 12,182 runner minutes, and main was reported red in 2 cycles.
- Caveats for anyone reusing these numbers: per-run data exists for 59 hours only; there is one GitHub identity for everything; and "ops" versus "product" is by PR scope, with `docs` counted as ops.

## Appendix: scripts and commands

Everything ran from `/private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/fleet-metrics/` against the read-only fleet store and the worktree `/Users/ian/Dev/marxy-wt/MARXY-346`. Order: `node fold.mjs board.json` then `node runs.mjs .` then `t1`, `t1b`, `t2`, `t3`, `t3b`, `t4`, `t5b`, `t6` (after `fetchjobs.sh`), `t7`, `t7c`, `t8`, `t8b`, `t9`, `t9b`, `t9c`.

### fold.mjs

```js
// Fold the fleet event log with the fleet's own machine.mjs and dump the board.
import { readFileSync, writeFileSync } from 'node:fs';
import { fold } from '/Users/ian/Dev/marxy-wt/MARXY-346/orchestration/machine.mjs';
const S='/Users/ian/Dev/marxy/.git/marxy-fleet';
const events = readFileSync(`${S}/events.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const renames = JSON.parse(readFileSync('/Users/ian/Dev/marxy-wt/MARXY-346/orchestration/jira-map.json','utf8')).keys ?? {};
const b = fold(events,{renames});
writeFileSync(process.argv[2], JSON.stringify(b,null,1));
console.log(Object.keys(b), Object.keys(b.stories).length, Object.keys(b.runs).length, b.merges, b.planner);
const c={}; for(const s of Object.values(b.stories)) c[s.status]=(c[s.status]??0)+1; console.log(c);
console.log(JSON.stringify(Object.values(b.stories)[200]));
console.log(JSON.stringify(Object.values(b.runs)[10]));
```

### runs.mjs

```js
// Load every run's run.json + exit.json into runs.json (one row per run) plus board-run fields.
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
const S='/Users/ian/Dev/marxy/.git/marxy-fleet/runs';
const SC=process.argv[2];
const board=JSON.parse(readFileSync(`${SC}/board.json`,'utf8'));
const rows=[];
for (const id of readdirSync(S)) {
  const rj=JSON.parse(readFileSync(`${S}/${id}/run.json`,'utf8'));
  const ex=existsSync(`${S}/${id}/exit.json`)?JSON.parse(readFileSync(`${S}/${id}/exit.json`,'utf8')):null;
  const br=board.runs[id]??{};
  delete rj.prompt;
  rows.push({id,key:rj.key,role:rj.role,modelRole:rj.modelRole,model:rj.model,effort:rj.effort,started:rj.started,deadline:rj.deadline,
    exitOutcome:ex?.outcome??null,exitEnded:ex?.endedAt??null,logBytes:ex?.logBytes??null,exitWhy:ex?.why??null,exitCode:ex?.code??null,
    boardOutcome:br.outcome??null,boardEnded:br.ended??null,boardModel:br.model});
}
writeFileSync(`${SC}/runs.json`,JSON.stringify(rows,null,1));
const c=(f)=>{const o={};rows.forEach(r=>{const k=f(r);o[k]=(o[k]??0)+1});return o};
console.log(rows.length,c(r=>r.role),c(r=>r.exitOutcome),c(r=>r.boardOutcome),c(r=>r.model));
console.log('noexit',rows.filter(r=>!r.exitOutcome).length,'mismatch',rows.filter(r=>r.exitOutcome&&r.boardOutcome&&r.exitOutcome!==r.boardOutcome).map(r=>[r.id,r.exitOutcome,r.boardOutcome]));
console.log(rows.sort((a,b)=>a.started<b.started?-1:1)[0].started, rows.at(-1).started);
```

### lib.mjs

```js
import { readFileSync } from 'node:fs';
export const SC='/private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/fleet-metrics';
export const WT='/Users/ian/Dev/marxy-wt/MARXY-346';
export const S='/Users/ian/Dev/marxy/.git/marxy-fleet';
export const J=p=>JSON.parse(readFileSync(p,'utf8'));
export const events=()=>readFileSync(`${S}/events.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l));
export const board=()=>J(`${SC}/board.json`);
export const deps=()=>J(`${WT}/orchestration/deps.json`);
export const md=(head,rows)=>['| '+head.join(' | ')+' |','|'+head.map((h,i)=>i?'---:':'---').join('|')+'|',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n');
export const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
export const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)]};
export const day=iso=>iso.slice(0,10);
export const fmt=(x,d=1)=>x==null?'n/a':Number(x).toFixed(d);
export const count=(arr,f)=>{const o={};arr.forEach(x=>{const k=f(x);o[k]=(o[k]??0)+1});return o};
export const phaseOf=()=>{const d=deps();const m={};for(const [p,ks] of Object.entries(d.phases))ks.forEach(k=>m[k]=p);return k=>m[k]??'unlisted'};
```

### scope.mjs

```js
export const PRODUCT=new Set('core typeset theme desktop shell shell-api position fonts corpus'.split(' '));
export const OPS=new Set('orchestration gates ci docs plan repo ops scripts adr taste taste-review workspace'.split(' '));
export function parseTitle(t){const m=/^(?:\[human\]\s*)?(\w+)(?:\(([^)]+)\))?!?:/.exec(t);return {type:m?.[1]??null,scope:m?(m[2]??null):null,human:/^\[human\]/.test(t)}}
export const bucket=s=>s==null?'unscoped':PRODUCT.has(s)?'product':OPS.has(s)?'ops':'unscoped';
export function keyOf(t,branch){const m=[...t.matchAll(/MARXY-(\d+)/g)].pop();if(m)return 'MARXY-'+m[1];const b=/MARXY-(\d+)/.exec(branch);return b?'MARXY-'+b[1]:null}
```

### t1.mjs

```js
import {board,phaseOf,md,count,SC,deps} from './lib.mjs';
const b=board(),ph=phaseOf();
const ST=['todo','in_progress','in_review','blocked','escalate','done'];const d=deps();
const phases=['0','1','2','3','4','ops','unlisted'];
const rows=phases.map(p=>{const s=Object.entries(b.stories).filter(([k])=>ph(k)===p);const c=count(s,([,r])=>r.status);const norec=(d.phases[p]??[]).filter(k=>!b.stories[k]).length;return [p==='ops'?'ops (lane)':p==='unlisted'?'unlisted (not in deps.json)':'phase '+p,...ST.map(x=>c[x]??0),norec,s.length+norec]});
const tot=ST.map(x=>Object.values(b.stories).filter(r=>r.status===x).length);
const nr=Object.values(d.phases).flat().filter(k=>!b.stories[k]).length;rows.push(['**total**',...tot.map(String),String(nr),String(Object.keys(b.stories).length+nr)]);
console.log(md(['Phase / lane',...ST,'no board record','total'],rows.map(r=>r.map(String))));
// unlisted detail
const un=Object.entries(b.stories).filter(([k])=>ph(k)==='unlisted').map(([k,r])=>k+':'+r.status+(r.pr?'/#'+r.pr:''));console.log(un.join(' '));
// board-level numbers
console.log('merges',b.merges,'planner',JSON.stringify(b.planner));
// attempts distribution of 'done' in pre-import era
```

### t1b.mjs

```js
// Table 1b: board statuses reconciled with GitHub (a story whose key has a merged PR counts as done).
import {board,phaseOf,md,count,SC,deps,J} from './lib.mjs';
const b=board(),ph=phaseOf(),d=deps(),M=J(SC+'/merged.json');
const merged=new Set(M.map(m=>m.key).filter(Boolean));
const ST=['todo','in_progress','in_review','blocked','escalate','done'];
const eff=k=>{const s=b.stories[k]?.status??'todo (no board record)';return s!=='done'&&merged.has(k)?'done':s};
const phases=['0','1','2','3','4','ops','unlisted'];
const keys=[...new Set([...Object.keys(b.stories),...Object.values(d.phases).flat()])];
const rows=phases.map(p=>{const ks=keys.filter(k=>ph(k)===p);const c=count(ks,eff);return [p==='ops'?'ops (lane)':p==='unlisted'?'unlisted':'phase '+p,...ST.map(x=>c[x]??0),c['todo (no board record)']??0,ks.length].map(String)});
const c=count(keys,eff);rows.push(['**total**',...ST.map(x=>c[x]??0),c['todo (no board record)']??0,keys.length].map(String));
console.log(md(['Phase / lane',...ST,'todo, no board record','total'],rows));
console.log('stale: non-done on board but PR merged',keys.filter(k=>b.stories[k]&&b.stories[k].status!=='done'&&merged.has(k)).length);
```

### t2.mjs

```js
import {J,SC,md,count,median,pct,fmt} from './lib.mjs';
const R=J(`${SC}/runs.json`);
for(const r of R){r.outcome=r.exitOutcome??r.boardOutcome;r.ended=r.exitEnded??r.boardEnded;r.min=(Date.parse(r.ended)-Date.parse(r.started))/60000;r.allot=(Date.parse(r.deadline)-Date.parse(r.started))/60000;}
const roles=['implement','review','resolve','plan'];const outs=['exited','timeout','stalled','setup'];
console.log('### by role x outcome');
console.log(md(['Role',...outs,'total'],roles.map(ro=>{const s=R.filter(r=>r.role===ro);const c=count(s,r=>r.outcome);return [ro,...outs.map(o=>c[o]??0),s.length].map(String)})));
console.log('\n### by model x role');
const models=[...new Set(R.map(r=>r.model))];
console.log(md(['Model',...roles,'total'],models.map(m=>{const s=R.filter(r=>r.model===m);const c=count(s,r=>r.role);return [m,...roles.map(o=>c[o]??0),s.length].map(String)})));
console.log('\n### model x outcome');
console.log(md(['Model',...outs,'total','non-exited %'],models.map(m=>{const s=R.filter(r=>r.model===m);const c=count(s,r=>r.outcome);return [m,...outs.map(o=>c[o]??0),s.length,fmt(100*(s.length-(c.exited??0))/s.length)].map(String)})));
console.log('\n### minutes by role');
const row=(label,s)=>[label,s.length,fmt(s.reduce((a,r)=>a+r.min,0),0),fmt(s.reduce((a,r)=>a+r.allot,0),0),fmt(median(s.map(r=>r.min))),fmt(pct(s.map(r=>r.min),90)),fmt(Math.max(...s.map(r=>r.min)))].map(String);
const H=['','runs','actual min (sum)','deadline min (sum)','median min','p90 min','max min'];
console.log(md(H,[...roles.map(ro=>row(ro,R.filter(r=>r.role===ro))),row('**all**',R)]));
console.log('\n### minutes by model');
console.log(md(H,models.map(m=>row(m,R.filter(r=>r.model===m)))));
console.log('\n### minutes by role x outcome');
const ro2=[];for(const ro of roles)for(const o of outs){const s=R.filter(r=>r.role===ro&&r.outcome===o);if(s.length)ro2.push(row(ro+' / '+o,s))}
console.log(md(H,ro2));
// Role x model x outcome for implement
console.log('\n### implement by modelRole');
const ir=R.filter(r=>r.role==='implement');
console.log(md(['modelRole/model','runs','exited','timeout','stalled','setup','median min'],[...new Set(ir.map(r=>r.modelRole+' / '+r.model))].map(k=>{const s=ir.filter(r=>r.modelRole+' / '+r.model===k);const c=count(s,r=>r.outcome);return [k,s.length,c.exited??0,c.timeout??0,c.stalled??0,c.setup??0,fmt(median(s.map(r=>r.min)))].map(String)})));
// wall-clock span, concurrency
const days=count(R,r=>r.started.slice(0,10));console.log('\nruns/day',JSON.stringify(days));
const span=(Date.parse(R.map(r=>r.ended).sort().at(-1))-Date.parse(R.map(r=>r.started).sort()[0]))/3600000;
console.log('span h',span,'first',R.map(r=>r.started).sort()[0],'last end',R.map(r=>r.ended).sort().at(-1));
// peak concurrency
const ev=[];R.forEach(r=>{ev.push([Date.parse(r.started),1],[Date.parse(r.ended),-1])});ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let c=0,mx=0;ev.forEach(e=>{c+=e[1];mx=Math.max(mx,c)});console.log('peak concurrent runs',mx);
// log bytes
console.log('logBytes total MB',R.reduce((a,r)=>a+(r.logBytes??0),0)/1e6);
// exits with exitWhy
console.log(R.filter(r=>r.exitWhy).map(r=>[r.id,r.outcome,r.exitWhy.slice(0,100)]));
console.log('over-allot', R.filter(r=>r.min>r.allot+1).length, 'max over', Math.max(...R.map(r=>r.min-r.allot)));
console.log('allot values',count(R,r=>r.allot));
```

### t3.mjs

```js
import {J,SC,md,count,events,board,phaseOf,fmt,median,pct} from './lib.mjs';
const R=J(`${SC}/runs.json`),b=board(),ph=phaseOf(),ev=events();
for(const r of R){r.outcome=r.exitOutcome??r.boardOutcome;}
const per={};const g=k=>per[k]??={key:k,impl:0,esc:0,rev:0,res:0,ret:0,blk:0,esc2:0,unpark:0,claims:0,timeouts:0};
for(const r of R){if(!r.key)continue;const s=g(r.key);if(r.role==='implement'){s.impl++;if(r.modelRole==='implementorEscalation')s.esc++;if(r.outcome==='timeout'||r.outcome==='stalled')s.timeouts++}else if(r.role==='review')s.rev++;else if(r.role==='resolve')s.res++}
for(const e of ev){if(e.type!=='story')continue;const s=g(e.key);const w=e.why??'';
 if(e.to==='todo'&&/^returned:/.test(w))s.ret++;
 if(e.to==='blocked')s.blk++;if(e.to==='escalate')s.esc2++;
 if(/unparked by|retry by/.test(w))s.unpark++;if(/claimed by ian/.test(w))s.claims++}
const keys=Object.keys(b.stories);
const rows=keys.map(k=>({...g(k),attempts:b.stories[k].attempts??0,status:b.stories[k].status,phase:ph(k),reviewTries:b.stories[k].reviewTries??0,resolveTries:b.stories[k].resolveTries??0}));
const hist=(f,label)=>{const c=count(rows,f);const mx=Math.max(...Object.keys(c).map(Number));return [label,...Array.from({length:9},(_,i)=>c[i]??0).map(String),String(Object.entries(c).filter(([k])=>+k>8).reduce((a,[,v])=>a+v,0))]};
console.log(md(['per-story count','0','1','2','3','4','5','6','7','8','9+'],[
 hist(r=>r.attempts,'board `attempts` (net, incl. pre-09-26)'),
 hist(r=>r.impl,'implement runs (09-26 on)'),
 hist(r=>r.esc,'escalation-model implement runs'),
 hist(r=>r.rev,'review runs'),
 hist(r=>r.res,'conflict-resolve runs'),
 hist(r=>r.ret,'returns to todo (reviewer/CI/path)'),
 ]));
const tot=f=>rows.reduce((a,r)=>a+f(r),0);
console.log('\ntotals: impl',tot(r=>r.impl),'esc',tot(r=>r.esc),'rev',tot(r=>r.rev),'res',tot(r=>r.res),'returns',tot(r=>r.ret),'blocked-events',tot(r=>r.blk),'escalate-events',tot(r=>r.esc2),'attempts sum',tot(r=>r.attempts));
console.log('stories with any run',rows.filter(r=>r.impl+r.rev+r.res>0).length);
console.log('stories attempts==0 done',rows.filter(r=>r.attempts===0&&r.status==='done').length);
const worst=[...rows].sort((a,b2)=>(b2.impl+b2.rev+b2.res+b2.ret)-(a.impl+a.rev+a.res+a.ret)).slice(0,10);
console.log('\n### worst ten by total runs');
console.log(md(['Story','phase','status','board attempts','impl runs (esc)','timeouts/stalls','review','resolve','returns','blocked evts','human unpark/retry/claim','run-min'],worst.map(r=>{const mins=R.filter(x=>x.key===r.key).reduce((a,x)=>a+(Date.parse(x.exitEnded??x.boardEnded)-Date.parse(x.started))/60000,0);return [r.key,r.phase,r.status,r.attempts,`${r.impl} (${r.esc})`,r.timeouts,r.rev,r.res,r.ret,r.blk,r.unpark+'/'+r.claims,fmt(mins,0)].map(String)})));
// share of runs in the worst 10 / worst 20
const sorted=[...rows].sort((a,b2)=>(b2.impl+b2.rev+b2.res)-(a.impl+a.rev+a.res));const T=tot(r=>r.impl+r.rev+r.res);
console.log('top10 share',sorted.slice(0,10).reduce((a,r)=>a+r.impl+r.rev+r.res,0)/T,'top20',sorted.slice(0,20).reduce((a,r)=>a+r.impl+r.rev+r.res,0)/T,'of',T);
// stories merged first-time: done with 1 impl run & 0 returns & 0 resolve
const done=rows.filter(r=>r.status==='done'&&r.impl>0);
console.log('done stories with runs',done.length,'clean (1 impl,0 return,0 resolve)',done.filter(r=>r.impl===1&&r.ret===0&&r.res===0).length);
// resolve outcomes: for each resolve run, was the story merged afterwards?
// terminal story events with ifRun
const byRun={};for(const e of ev){if(e.type==='story'&&e.ifRun){(byRun[e.ifRun]??=[]).push(e)}}
const c={};for(const r of R.filter(x=>x.role==='implement')){const es=byRun[r.id]??[];const t=es.map(e=>e.to??'-').join(',')||'none';const k=r.outcome+' -> '+t;c[k]=(c[k]??0)+1}
console.log('\n### implement run outcome -> story transition');console.log(md(['run outcome -> next status','n'],Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,String(v)])));
// route of each done story
const imp=ev.find(e=>e.type==='imported');const legacy=imp.board.stories;
const route={};const rt={};
for(const [k,s] of Object.entries(b.stories)){ if(s.status!=='done')continue;
  let r;
  if(legacy[k]&&legacy[k].status==='done')r='done already in the 09-26 snapshot (before the event log)';
  else{const es=ev.filter(e=>e.type==='story'&&e.key===k);
   const hasRun=R.some(x=>x.key===k&&x.role==='implement');
   const oop=es.some(e=>(e.by??'').startsWith('out-of-plan'));
   const claimed=es.some(e=>/claimed by ian/.test(e.why??''));
   const adopted=es.some(e=>/adopted PR/.test(e.why??''));
   const hand=es.some(e=>/recorded done by hand/.test(e.why??''));
   r=hasRun?'fleet implement run (09-26 on)':oop?'out-of-plan (human/in-app session)':claimed?'claimed by ian':adopted?'adopted PR (opened outside a run)':hand?'recorded done by hand':'other';}
  rt[k]=r;route[r]=(route[r]??0)+1}
console.log('\n### route of the 250 done stories');console.log(md(['Route','done stories'],Object.entries(route).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,String(v)])));
console.log('legacy snapshot stories',Object.keys(legacy).length,JSON.stringify(count(Object.values(legacy),s=>s.status)));
console.log('legacy attempts hist',JSON.stringify(count(Object.values(legacy),s=>s.attempts??0)),'models',JSON.stringify(count(Object.values(legacy),s=>s.model??'none')));
import('node:fs').then(fs=>fs.writeFileSync(SC+'/routes.json',JSON.stringify(rt)));
```

### t3b.mjs

```js
import {J,SC,md,count,events,board,fmt} from './lib.mjs';
const R=J(`${SC}/runs.json`),b=board(),ev=events();
const res=R.filter(r=>r.role==='resolve');const by=count(res,r=>r.key);
const fin=count(Object.keys(by),k=>b.stories[k]?.status);console.log('stories with resolve runs',Object.keys(by).length,JSON.stringify(fin));
const runsByFinal={};for(const r of res){const s=b.stories[r.key]?.status;runsByFinal[s]=(runsByFinal[s]??0)+1}console.log('resolve runs by final story status',JSON.stringify(runsByFinal));
const mins=R.filter(r=>r.role==='resolve').map(r=>(Date.parse(r.exitEnded??r.boardEnded)-Date.parse(r.started))/60000);
console.log('resolve <1 min',mins.filter(x=>x<1).length,'of',mins.length,'>5 min',mins.filter(x=>x>5).length);
// reviewer: returns vs merges
const ret=ev.filter(e=>e.type==='story'&&e.by.startsWith('fleet.mjs')&&/^returned: reviewer/.test(e.why??'')).length;
const cyc=ev.filter(e=>e.type==='story'&&e.by.startsWith('cycle.mjs')&&/^returned:/.test(e.why??'')).length;
console.log('review runs',R.filter(r=>r.role==='review').length,'reviewer returns',ret,'cycle returns (red CI / paths)',cyc);
// returns by cause (cycle)
console.log(JSON.stringify(count(ev.filter(e=>e.type==='story'&&e.by.startsWith('cycle.mjs')&&/^returned:/.test(e.why??'')),e=>/files outside/.test(e.why)?'files outside story paths':/red:/.test(e.why)?'red CI':'other')));
// time from first story event to done for fleet-run stories? skip. Setup failures
// per-day runs by role
const days=[...new Set(R.map(r=>r.started.slice(0,10)))].sort();console.log(md(['day','implement','review','resolve','plan','run-min'],days.map(d=>{const s=R.filter(r=>r.started.startsWith(d));const c=count(s,r=>r.role);return [d,c.implement??0,c.review??0,c.resolve??0,c.plan??0,fmt(s.reduce((a,r)=>a+(Date.parse(r.exitEnded??r.boardEnded)-Date.parse(r.started))/60000,0),0)].map(String)})));
// merges by route per day
const done=ev.filter(e=>e.type==='story'&&e.to==='done');console.log('done events',done.length,JSON.stringify(count(done,e=>/merged PR/.test(e.why)?'cycle merged':/recorded done/.test(e.why)?'recorded by hand/backfill':e.why.slice(0,25))));
console.log('merge by agent route: cycle merges after 09-26',done.filter(e=>e.by.startsWith('cycle')&&/merged PR/.test(e.why)).length);
```

### t4.mjs

```js
import {J,SC,md,count,median,pct,fmt,events} from './lib.mjs';
import {parseTitle,bucket,keyOf} from './scope.mjs';
const P=J(`${SC}/prs.json`),ev=events();
const disp={};
const imp=ev.find(e=>e.type==='imported');
for(const [k,s] of Object.entries(imp.board.stories)) if(s.started) disp[k]=s.started;
for(const e of ev){if(e.type==='story'&&e.to==='in_progress'&&(!disp[e.key]||e.at<disp[e.key]))disp[e.key]=e.at}
const wk=iso=>{const d=new Date(iso);const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const dn=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-dn);return t.toISOString().slice(0,10)};
const M=P.filter(p=>p.state==='MERGED').map(p=>{const t=parseTitle(p.title);const k=keyOf(p.title,p.headRefName);
 const open=Date.parse(p.createdAt),merge=Date.parse(p.mergedAt);const d=k?disp[k]:null;
 return {n:p.number,key:k,scope:t.scope,type:t.type,human:t.human,bucket:bucket(t.scope),open,merge,openToMerge:(merge-open)/3600000,
 dispToOpen:d&&Date.parse(d)<open?(open-Date.parse(d))/3600000:null,dispToMerge:d&&Date.parse(d)<merge?(merge-Date.parse(d))/3600000:null,week:wk(p.mergedAt),day:p.mergedAt.slice(0,10),add:p.additions,del:p.deletions,files:p.changedFiles}});
const stat=(s,f)=>{const a=s.map(f).filter(x=>x!=null);return [a.length,fmt(median(a)),fmt(pct(a,90))]};
const row=(label,s)=>[label,s.length,...stat(s,x=>x.dispToOpen),...stat(s,x=>x.openToMerge),...stat(s,x=>x.dispToMerge)].map(String);
const H=['','merged PRs','n','disp->open med h','p90','n','open->merge med h','p90','n','disp->merge med h','p90'];
console.log('### overall + by week (merge week starting Monday, UTC)');
const weeks=[...new Set(M.map(x=>x.week))].sort();
console.log(md(H,[row('**all**',M),...weeks.map(w=>row('week of '+w,M.filter(x=>x.week===w)))]));
console.log('\n### by bucket');
console.log(md(H,['product','ops','unscoped'].map(b=>row(b,M.filter(x=>x.bucket===b)))));
console.log('\n### by scope');
const sc=count(M,x=>x.scope??'(none)');
console.log(md(H,Object.entries(sc).sort((a,b)=>b[1]-a[1]).filter(([,n])=>n>=3).map(([s])=>row(s+' ('+bucket(s==='(none)'?null:s)+')',M.filter(x=>(x.scope??'(none)')===s)))));
console.log('\n### bucket x week open->merge median h');
console.log(md(['week','product n','product med','product p90','ops n','ops med','ops p90'],weeks.map(w=>{const a=M.filter(x=>x.week===w&&x.bucket==='product'),o=M.filter(x=>x.week===w&&x.bucket==='ops');return ['week of '+w,a.length,fmt(median(a.map(x=>x.openToMerge))),fmt(pct(a.map(x=>x.openToMerge),90)),o.length,fmt(median(o.map(x=>x.openToMerge))),fmt(pct(o.map(x=>x.openToMerge),90))].map(String)})));
// pre vs post fleet-store era: PR merged before 2026-09-26T19:01
const cut=Date.parse('2026-09-26T19:01:31Z');
console.log('\n### era split by merge time (cut = event log start 2026-09-26T19:01Z)');
console.log(md(H,[row('merged before cut',M.filter(x=>x.merge<cut)),row('merged after cut',M.filter(x=>x.merge>=cut))]));
console.log('\nmedian PR size merged (additions+deletions, files) by bucket');
console.log(md(['bucket','n','median lines','p90 lines','median files'],['product','ops','unscoped'].map(b=>{const s=M.filter(x=>x.bucket===b);return [b,s.length,fmt(median(s.map(x=>x.add+x.del)),0),fmt(pct(s.map(x=>x.add+x.del),90),0),fmt(median(s.map(x=>x.files)),0)].map(String)})));
// per-day merges
const days=[...new Set(M.map(x=>x.day))].sort();const allDays=[];for(let t=Date.parse(days[0]);t<=Date.parse(days.at(-1));t+=864e5)allDays.push(new Date(t).toISOString().slice(0,10));
console.log('\n### merges per day by bucket');
const rows=allDays.map(d=>{const s=M.filter(x=>x.day===d);const p=s.filter(x=>x.bucket==='product').length,o=s.filter(x=>x.bucket==='ops').length,u=s.filter(x=>x.bucket==='unscoped').length;return {d,n:s.length,p,o,u}});
let cp=0,co=0;
console.log(md(['day (UTC)','merged','product','ops','unscoped','ops share %','cum product','cum ops','cum ops:product'],rows.map(r=>{cp+=r.p;co+=r.o;return [r.d,r.n,r.p,r.o,r.u,r.n?fmt(100*r.o/r.n,0):'-',cp,co,cp?fmt(co/cp,2):'-'].map(String)})));
console.log('totals',M.length,'product',cp,'ops',co,'unscoped',rows.reduce((a,r)=>a+r.u,0));
// weekly ratio
console.log('\n### weekly ops:product');
console.log(md(['week','merged','product','ops','unscoped','ops:product'],weeks.map(w=>{const s=M.filter(x=>x.week===w);const p=s.filter(x=>x.bucket==='product').length,o=s.filter(x=>x.bucket==='ops').length;return ['week of '+w,s.length,p,o,s.filter(x=>x.bucket==='unscoped').length,p?fmt(o/p,2):'inf'].map(String)})));
// human-titled
console.log('human titled merged',M.filter(x=>x.human).map(x=>'#'+x.n+' '+x.key));
// closed unmerged
const C=P.filter(p=>p.state==='CLOSED');
console.log('\n### closed unmerged',C.length);
const why=p=>{const t=p.title,b=p.headRefName;if(/^chore\((docs|plan)\).*(plan delta|delta|refile|unblock|path widen|file )/i.test(t)||/plan delta|delta/.test(t)||/plan|land-/.test(b))return 'plan delta / board-row landing';if(/^type\(scope\)/.test(t))return 'template placeholder title';return 'other'};
console.log(md(['#','created','closed','title','branch','labels','bucket'],C.map(p=>['#'+p.number,p.createdAt.slice(0,10),p.closedAt.slice(0,16).replace('T',' '),p.title.slice(0,70).replace(/\|/g,'/'),p.headRefName.slice(0,45),p.labels.map(l=>l.name).join(',')||'-',bucket(parseTitle(p.title).scope)])));
console.log('closed by bucket',JSON.stringify(count(C,p=>bucket(parseTitle(p.title).scope))),'closed by title class',JSON.stringify(count(C,why)));
// closed-time vs open time
console.log('closed lifetime h median',fmt(median(C.map(p=>(Date.parse(p.closedAt)-Date.parse(p.createdAt))/3600000))));
// for each closed, did a later merged PR carry same key?
const mk=new Set(M.map(x=>x.key));console.log('closed whose key later merged in another PR',C.filter(p=>mk.has(keyOf(p.title,p.headRefName))).length);
import('node:fs').then(fs=>fs.writeFileSync(SC+'/merged.json',JSON.stringify(M)));
```

### t5b.mjs

```js
import {J,SC,md,count} from './lib.mjs';
const M=J(`${SC}/merged.json`);
const top=['orchestration','gates','docs','plan','ci','repo','desktop','core','theme','typeset','shell-api'];
const weeks=[...new Set(M.map(x=>x.week))].sort();
const sc=x=>top.includes(x.scope)?x.scope:'other/unscoped';
const cols=[...top,'other/unscoped'];
console.log(md(['merge week (Mon, UTC)',...cols,'total'],weeks.map(w=>{const s=M.filter(x=>x.week===w);const c=count(s,sc);return ['week of '+w,...cols.map(k=>c[k]??0),s.length].map(String)})));
// closed-unmerged by key whose work later merged
```

### fetchjobs.sh

```bash
#!/bin/bash
# read-only: per-run job list (name, runner labels, started_at, completed_at, conclusion)
f=jobs/$1.json
[ -s $f ] || gh api "repos/inkstrata/marxy/actions/runs/$1/jobs?per_page=100" --jq '[.jobs[]|{name,conclusion,started_at,completed_at,labels}]' > $f 2>/dev/null
```

### t6.mjs

```js
import {J,SC,md,count,median,pct,fmt} from './lib.mjs';import {readFileSync,existsSync} from 'node:fs';
const R=J(`${SC}/runs-ci.json`);
for(const r of R){r.dur=r.startedAt&&r.updatedAt?(Date.parse(r.updatedAt)-Date.parse(r.startedAt))/60000:null;r.day=r.createdAt.slice(0,10);r.jobs=existsSync(`${SC}/jobs/${r.databaseId}.json`)?J(`${SC}/jobs/${r.databaseId}.json`):[]}
console.log('runs',R.length,'first',R.at(-1).createdAt,'last',R[0].createdAt);
console.log('conclusion',JSON.stringify(count(R,r=>r.conclusion||r.status)),'event',JSON.stringify(count(R,r=>r.event)));
const days=[...new Set(R.map(r=>r.day))].sort();
console.log(md(['day (UTC)','runs','success','failure','cancelled','skipped/other','success %','failure %','cancelled %','runs on PRs','runs on main push'],days.map(d=>{const s=R.filter(r=>r.day===d);const c=count(s,r=>r.conclusion);const o=s.length-(c.success??0)-(c.failure??0)-(c.cancelled??0);return [d,s.length,c.success??0,c.failure??0,c.cancelled??0,o,fmt(100*(c.success??0)/s.length,0),fmt(100*(c.failure??0)/s.length,0),fmt(100*(c.cancelled??0)/s.length,0),s.filter(r=>r.event==='pull_request').length,s.filter(r=>r.event==='push').length].map(String)})));
const ev=[...new Set(R.map(r=>r.event))];
console.log('\n### by event');
console.log(md(['event','runs','success','failure','cancelled','median wall min','p90 wall min','sum wall min (completed, non-cancelled)'],ev.map(e=>{const s=R.filter(r=>r.event===e);const c=count(s,r=>r.conclusion);const d=s.filter(r=>r.conclusion!=='cancelled').map(r=>r.dur).filter(x=>x!=null);return [e,s.length,c.success??0,c.failure??0,c.cancelled??0,fmt(median(d)),fmt(pct(d,90)),fmt(d.reduce((a,b)=>a+b,0),0)].map(String)})));
// wall minutes by conclusion
console.log('\n### by conclusion');
console.log(md(['conclusion','runs','median wall min','sum wall min'],Object.keys(count(R,r=>r.conclusion)).map(k=>{const s=R.filter(r=>r.conclusion===k);const d=s.map(r=>r.dur).filter(x=>x!=null);return [k,s.length,fmt(median(d)),fmt(d.reduce((a,b)=>a+b,0),0)].map(String)})));
// job-level runner minutes
const isMac=j=>(j.labels??[]).some(l=>/macos/i.test(l));
let jm={ubuntu:0,macos:0},njobs=0,skipped=0;const jobStat={};
for(const r of R)for(const j of r.jobs){if(!j.started_at||!j.completed_at||j.conclusion==='skipped'){skipped++;continue}const m=(Date.parse(j.completed_at)-Date.parse(j.started_at))/60000;njobs++;(isMac(j)?jm.macos+=m:jm.ubuntu+=m);const n=j.name.replace(/\s*\(.*\)/,'')+(isMac(j)?' [macos]':'');(jobStat[n]??={n:0,min:[]}).n++;jobStat[n].min.push(m)}
console.log('\njob-level runner minutes (sum job durations, skipped jobs excluded):',JSON.stringify(jm),'jobs run',njobs,'skipped',skipped);
console.log(md(['job','runs','median min','p90 min','sum min'],Object.entries(jobStat).sort((a,b)=>b[1].min.reduce((x,y)=>x+y,0)-a[1].min.reduce((x,y)=>x+y,0)).map(([k,v])=>[k,v.n,fmt(median(v.min)),fmt(pct(v.min,90)),fmt(v.min.reduce((a,b)=>a+b,0),0)].map(String))));
// multiplier = job runner minutes / wall minutes
const wallAll=R.map(r=>r.dur).filter(x=>x!=null).reduce((a,b)=>a+b,0);console.log('sum wall min all runs',wallAll,'runner min total',jm.ubuntu+jm.macos,'multiplier',(jm.ubuntu+jm.macos)/wallAll);
// jobs per run
console.log('jobs/run median',median(R.map(r=>r.jobs.filter(j=>j.conclusion!=='skipped').length)));
// per day runner minutes
console.log(md(['day','runner min ubuntu','runner min macos','runs'],days.map(d=>{let u=0,m=0;for(const r of R.filter(r=>r.day===d))for(const j of r.jobs){if(!j.started_at||!j.completed_at||j.conclusion==='skipped')continue;const x=(Date.parse(j.completed_at)-Date.parse(j.started_at))/60000;isMac(j)?m+=x:u+=x}return [d,fmt(u,0),fmt(m,0),R.filter(r=>r.day===d).length].map(String)})));
// failures: which job failed most
const fj=count(R.filter(r=>r.conclusion==='failure').flatMap(r=>r.jobs.filter(j=>j.conclusion==='failure').map(j=>j.name.replace(/\s*\(.*\)/,'')+(isMac(j)?' [macos]':''))),x=>x);console.log('failing jobs (in failed runs)',JSON.stringify(fj));
// main branch: red runs
const mainRuns=R.filter(r=>r.headBranch==='main'&&r.event==='push');console.log('main push runs',mainRuns.length,JSON.stringify(count(mainRuns,r=>r.conclusion)));
// attempts: per branch runs
const pb=count(R.filter(r=>r.event==='pull_request'),r=>r.headBranch);const v=Object.values(pb);console.log('PR branches with CI',v.length,'runs per branch median',median(v),'p90',pct(v,90),'max',Math.max(...v));
// scheduled/other
// distribution of wall duration
console.log('wall dur success pr median',fmt(median(R.filter(r=>r.conclusion==='success'&&r.event==='pull_request').map(r=>r.dur))));
```

### t7.mjs

```js
import {readFileSync,writeFileSync} from 'node:fs';import {SC,md,fmt} from './lib.mjs';
const lines=readFileSync(SC+'/numstat.txt','utf8').split('\n');
const area=p=>{const t=p.split('/')[0];return ['packages','apps','orchestration','scripts','docs','fixtures','.github'].includes(t)?t:'other (root files, changelog.d, lockfiles, results)'};
const isTest=p=>/(\.test\.|\/test\/|\/tests\/|\.spec\.)/.test(p);
const isBin=p=>/\.(png|jpg|jpeg|gif|ico|icns|woff2?|ttf|otf)$/i.test(p);
const byDay={},totals={},tests={};let cur=null,commits=0;
const ar=new Set();
const per={};//commit-> {area:{a,d}}
for(const l of lines){ if(l.startsWith('@@')){const [h,d]=l.slice(2).split('|');cur={h,day:new Date(d).toISOString().slice(0,10)};commits++;continue}
 if(!l.trim())continue;const [a,d,...rest]=l.split('\t');let p=rest.join('\t');if(a==='-'||isBin(p))continue;
 // rename syntax {x => y}
 p=p.replace(/\{[^}]* => ([^}]*)\}/,'$1').replace('//','/');
 const A=area(p);ar.add(A);const n=+a,m=+d;
 (byDay[cur.day]??={})[A]??={a:0,d:0};byDay[cur.day][A].a+=n;byDay[cur.day][A].d+=m;
 (totals[A]??={a:0,d:0,ta:0,td:0});totals[A].a+=n;totals[A].d+=m;if(isTest(p)){totals[A].ta+=n;totals[A].td+=m}
 const c=(per[cur.h]??={day:cur.day,a:{}});(c.a[A]??={a:0,d:0});c.a[A].a+=n;c.a[A].d+=m;
}
const A=['packages','apps','orchestration','scripts','docs','fixtures','.github','other (root files, changelog.d, lockfiles, results)'];
const days=Object.keys(byDay).sort();
const short=A.map(x=>x.startsWith('other')?'other':x);
console.log('### additions / deletions per day (UTC author date), by top-level area (text files; binaries excluded)');
console.log(md(['day',...short.map(x=>x+' +/-'),'total +','total -'],days.map(d=>{const r=A.map(a=>{const v=byDay[d][a];return v?`${v.a}/${v.d}`:'-'});const ta=A.reduce((s,a)=>s+(byDay[d][a]?.a??0),0),td=A.reduce((s,a)=>s+(byDay[d][a]?.d??0),0);return [d,...r,ta,td].map(String)})));
console.log('\n### totals');
const T=x=>x.a;
console.log(md(['area','additions','deletions','net','of which test additions','churn (del/add)'],A.map(a=>{const v=totals[a]??{a:0,d:0,ta:0,td:0};return [short[A.indexOf(a)],v.a,v.d,v.a-v.d,v.ta,fmt(v.d/v.a,2)].map(String)})));
const sum=k=>A.reduce((s,a)=>s+(totals[a]?.[k]??0),0);console.log('all',sum('a'),sum('d'),sum('a')-sum('d'),'commits',commits);
writeFileSync(SC+'/per-commit-area.json',JSON.stringify(per));
// share of commits by dominant area (by lines)
const prod=new Set(['packages','apps','fixtures']),ops=new Set(['orchestration','scripts','docs','.github']);
const cls={product:0,ops:0,mixed:0,other:0};const lines2={product:0,ops:0};
for(const c of Object.values(per)){let p=0,o=0,x=0;for(const [a,v] of Object.entries(c.a)){const n=v.a+v.d;if(prod.has(a))p+=n;else if(ops.has(a))o+=n;else x+=n}
 lines2.product+=p;lines2.ops+=o;
 if(p+o===0)cls.other++;else if(p>=2*o)cls.product++;else if(o>=2*p)cls.ops++;else cls.mixed++}
console.log('commit class by touched-lines (dominant area >=2x):',JSON.stringify(cls),'lines touched',JSON.stringify(lines2));
// per-week
const wk=iso=>{const d=new Date(iso+'T00:00:00Z');const dn=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-dn);return d.toISOString().slice(0,10)};
const W={};for(const [h,c] of Object.entries(per)){const w=wk(c.day);W[w]??={product:0,ops:0,n:0,pc:0,oc:0};let p=0,o=0;for(const [a,v] of Object.entries(c.a)){const n=v.a+v.d;if(prod.has(a))p+=n;else if(ops.has(a))o+=n}W[w].product+=p;W[w].ops+=o;W[w].n++;if(p>=2*o&&p>0)W[w].pc++;else if(o>=2*p&&o>0)W[w].oc++}
console.log(md(['week','commits','product-dominant commits','ops-dominant commits','lines touched product (packages+apps+fixtures)','lines touched ops (orchestration+scripts+docs+.github)','ops:product lines'],Object.entries(W).sort().map(([w,v])=>['week of '+w,v.n,v.pc,v.oc,v.product,v.ops,fmt(v.ops/v.product,2)].map(String))));
```

### t7c.mjs

```js
// final tracked line counts (git ls-files at origin/main worktree), text files only
import {readFileSync} from 'node:fs';import {execSync} from 'node:child_process';import {md,fmt} from './lib.mjs';
const WT='/Users/ian/Dev/marxy-wt/MARXY-346';
const files=execSync('git ls-files',{cwd:WT,maxBuffer:1e8}).toString().trim().split('\n');
const bin=/\.(png|jpg|jpeg|gif|ico|icns|woff2?|ttf|otf|pdf|wasm)$/i, lock=/(pnpm-lock\.yaml|Cargo\.lock)$/;
const area=p=>{const t=p.split('/')[0];return ['packages','apps','orchestration','scripts','docs','fixtures','.github'].includes(t)?t:'other (root)'};
const isTest=p=>/(\.test\.|\/test\/|\.spec\.)/.test(p);
const A={};let skipped=0;
for(const p of files){ if(bin.test(p)){skipped++;continue}
 let t;try{t=readFileSync(WT+'/'+p,'utf8')}catch{continue}
 const n=t.split('\n').length-(t.endsWith('\n')?1:0);
 const a=area(p);const o=(A[a]??={files:0,lines:0,test:0,tfiles:0,lock:0,md:0,code:0});
 if(lock.test(p)){o.lock+=n;continue}
 o.files++;o.lines+=n;if(isTest(p)){o.test+=n;o.tfiles++}
 if(/\.md$/.test(p))o.md+=n;else if(/\.(ts|tsx|mjs|js|rs|css|html)$/.test(p))o.code+=n}
const order=['packages','apps','orchestration','scripts','docs','fixtures','.github','other (root)'];
let T={files:0,lines:0,test:0,lock:0,md:0,code:0};
const rows=order.map(a=>{const o=A[a];for(const k in T)T[k]+=o[k]??0;return [a,o.files,o.lines,o.code,o.md,o.test,o.lock].map(String)});
rows.push(['**total**',T.files,T.lines,T.code,T.md,T.test,T.lock].map(String));
console.log(md(['area','text files','lines (excl. lockfiles)','of which ts/tsx/mjs/js/rs/css/html','of which .md','of which in test files','lockfile lines (not counted)'],rows));
console.log('binary files skipped',skipped,'tracked files',files.length);
// sub-areas
const sub={};for(const p of files){if(bin.test(p)||lock.test(p))continue;const parts=p.split('/');const k=['packages','apps'].includes(parts[0])?parts.slice(0,2).join('/'):parts[0];let t;try{t=readFileSync(WT+'/'+p,'utf8')}catch{continue}sub[k]=(sub[k]??0)+t.split('\n').length-(t.endsWith('\n')?1:0)}
console.log(Object.entries(sub).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>k+': '+v).join('\n'));
```

### t8.mjs

```js
import {J,SC,md,count,events,fmt} from './lib.mjs';
const ev=events(),R=J(`${SC}/runs.json`);
for(const r of R){r.ended=r.exitEnded??r.boardEnded}
const rev=R.filter(r=>r.role==='review');
const kind=e=>{const w=e.why??'',a=(e.by??'').split(':')[0];
 if(a==='fleet.mjs'){ if(/claimed by ian/.test(w))return 'claim (fleet.mjs claim)'; if(/unparked by ian/.test(w))return 'unpark'; if(/retry by ian/.test(w))return 'retry'; if(/released by ian/.test(w))return 'release claim'; if(/claim renewed/.test(w))return 'claim renewed';
  if(/^returned: /.test(w)||e.to==='done'){ // reviewer verdict? inside a review window for that key?
   const t=Date.parse(e.at);const inRev=rev.some(r=>r.key===e.key&&Date.parse(r.started)<=t&&t<=Date.parse(r.ended)+120000);return inRev?'review verdict (agent via fleet.mjs verdict)':'verdict by hand (no review run open)'}
  return 'fleet.mjs other: '+w.slice(0,40)}
 if(a==='out-of-plan.mjs')return 'out-of-plan start (person or in-app session)';
 if(a==='doctor.mjs')return 'doctor.mjs repair';
 return null};
const rows=[];for(const e of ev){if(e.type!=='story')continue;const k=kind(e);if(k)rows.push({k,day:e.at.slice(0,10),key:e.key,at:e.at})}
const kinds=[...new Set(rows.map(r=>r.k))];const days=[...new Set(rows.map(r=>r.day))].sort();
console.log(md(['actor-initiated event',...days,'total'],kinds.map(k=>[k,...days.map(d=>rows.filter(r=>r.k===k&&r.day===d).length||'-'),rows.filter(r=>r.k===k).length].map(String))));
// doctor also writes run events
console.log('doctor run events',ev.filter(e=>e.type==='run'&&e.by?.startsWith('doctor')).length,'doctor board',ev.filter(e=>e.type==='board'&&e.by?.startsWith('doctor')).length);
console.log('cycle bulk backfill: recorded done by hand', ev.filter(e=>e.why==='recorded done by hand').length, 'at', [...new Set(ev.filter(e=>e.why==='recorded done by hand').map(e=>e.at.slice(0,13)))]);
// distinct stories touched by human commands
const hs=new Set(rows.filter(r=>/claim \(|unpark|retry|release/.test(r.k)).map(r=>r.key));console.log('stories touched by claim/unpark/retry/release',hs.size);
// bursts: fleet.mjs events within 5 min
const fl=ev.filter(e=>e.type==='story'&&e.by?.startsWith('fleet.mjs')&&/by ian/.test(e.why??''));
let sessions=[];let last=0;for(const e of fl){const t=Date.parse(e.at);if(t-last>30*60000)sessions.push({start:e.at,n:0,k:[]});sessions.at(-1).n++;last=t}
console.log('human command sessions (gaps>30 min):',sessions.length,sessions.map(s=>s.start.slice(5,16)+'x'+s.n).join(' '));
// all people-attributable timestamps by local hour (PDT = UTC-7)
const hrs=count(fl,e=>String((new Date(e.at).getUTCHours()+17)%24).padStart(2,'0'));console.log('human command by local hour',JSON.stringify(hrs));
```

### t8b.mjs

```js
import {readFileSync} from 'node:fs';import {md,median,pct,fmt,count} from './lib.mjs';
const L=readFileSync('/Users/ian/Dev/marxy/.git/marxy-fleet/loop.log','utf8').split('\n');
const cy=[];let cur=null;
for(const l of L){const m=/^── cycle (\S+): (\d+) in flight, (\d+) need you, (\d+) ready(, draining)?/.exec(l);if(m){cur={t:m[1],flight:+m[2],need:+m[3],ready:+m[4],drain:!!m[5],lines:[]};cy.push(cur)}else if(cur&&l.startsWith('  '))cur.lines.push(l.trim())}
console.log('cycles',cy.length,cy[0].t,cy.at(-1).t);
const days=[...new Set(cy.map(c=>c.t.slice(0,10)))];
console.log(md(['day (UTC)','cycles','need-you min','median','p90','max','in flight median','in flight max','cycles with ready>0 %'],days.map(d=>{const s=cy.filter(c=>c.t.startsWith(d));return [d,s.length,Math.min(...s.map(c=>c.need)),median(s.map(c=>c.need)),pct(s.map(c=>c.need),90),Math.max(...s.map(c=>c.need)),median(s.map(c=>c.flight)),Math.max(...s.map(c=>c.flight)),fmt(100*s.filter(c=>c.ready>0).length/s.length,0)].map(String)})));
const all=cy.map(c=>c.need);console.log('overall need median',median(all),'p90',pct(all,90),'max',Math.max(...all),'first',all[0],'last',all.at(-1));
// gaps between cycles
const ts=cy.map(c=>Date.parse(c.t.replace('Z',':00Z')));const gaps=ts.slice(1).map((t,i)=>(t-ts[i])/60000);console.log('cycle gap min median',median(gaps),'p90',pct(gaps,90),'max',Math.max(...gaps),'gaps>30min',gaps.filter(g=>g>30).length, 'wall span h',(ts.at(-1)-ts[0])/3600000,'sum of gaps>30',gaps.filter(g=>g>30).reduce((a,b)=>a+b,0)/60);
console.log('draining from',cy.find(c=>c.drain)?.t,'cycles draining',cy.filter(c=>c.drain).length);
// need-you item categories (unique per cycle lines starting "needs you:")
const cat=s=>/human review required/.test(s)?'PR waits for human review (CODEOWNERS)':/main is red/.test(s)?'main is red':/still conflicts/.test(s)?'blocked: conflicts after 3 resolution runs':/escalat|attempt \d+/.test(s)?'escalated (attempts spent)':/nothing owns it|worktree/.test(s)?'idle worktree nothing owns':/blocked/.test(s)?'blocked (other)':/returned: red|red:/.test(s)?'returned: red CI':/result says failed/.test(s)?'result says failed':'other';
const seen=new Map();for(const c of cy)for(const l of c.lines){if(!l.startsWith('needs you:'))continue;const key=l.replace(/\d+ (min|h|d)\b/g,'').slice(0,90);if(!seen.has(key))seen.set(key,{cat:cat(l),first:c.t,n:0});seen.get(key).n++}
const cc=count([...seen.values()],v=>v.cat);console.log('distinct need-you items (unique text) by category',JSON.stringify(cc),'total distinct',seen.size);
// cycles with merges
const merges=cy.reduce((a,c)=>a+c.lines.filter(l=>/^merged MARXY/.test(l)).length,0);console.log('merged lines in loop.log',merges);
console.log('cycles in which main was red',cy.filter(c=>c.lines.some(l=>/main is red/.test(l))).length);
console.log('planner due lines',cy.filter(c=>c.lines.some(l=>/^planner: due/.test(l))).length,'planner started',cy.filter(c=>c.lines.some(l=>/planner.*started|plan started/i.test(l))).length);
console.log('lines sample planner', [...new Set(L.filter(l=>/planner/i.test(l)).map(l=>l.trim().replace(/\d+/g,'N').slice(0,90)))].slice(0,12));
// first cycle where need-you jumped: top 5 peaks
console.log('peaks',[...cy].sort((a,b)=>b.need-a.need).slice(0,5).map(c=>c.t+':'+c.need).join(' '));
```

### t9.mjs

```js
import {execSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {J,SC,WT,md,count,median,fmt,deps,phaseOf} from './lib.mjs';
function parse(s){const rows=[];let r=[],f="",q=false;for(let i=0;i<s.length;i++){const c=s[i];if(q){if(c=='"'){if(s[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"'){q=true}else if(c==","){r.push(f);f=""}else if(c=="\n"){r.push(f);rows.push(r);r=[];f=""}else if(c!="\r")f+=c}if(f||r.length){r.push(f);rows.push(r)}return rows}
const sh=(c)=>execSync(c,{cwd:WT,maxBuffer:1e9}).toString();
const commits=sh(`git log origin/main --reverse --format='%H|%aI|%s' -- docs/plan/jira-issues.csv`).trim().split('\n').map(l=>{const [h,d,...s]=l.split('|');return {h,d:new Date(d).toISOString(),s:s.join('|')}});
let prev=new Set();const first={};const rowsOf={};
for(const c of commits){let t;try{t=sh(`git show ${c.h}:docs/plan/jira-issues.csv`)}catch{continue}const rows=parse(t).filter(r=>/^MARXY-\d+$/.test(r[0]));const cur=new Set(rows.map(r=>r[0]));
 for(const r of rows){if(!(r[0] in first)){first[r[0]]={commit:c.h,at:c.d,subject:c.s,type:r[1],summary:r[2],labels:r[5],paths:r[6]};}rowsOf[r[0]]=r}
 prev=cur}
writeFileSync(SC+'/csv-first.json',JSON.stringify(first));
console.log('csv commits',commits.length,'keys ever seen',Object.keys(first).length);
// commit-level creation counts
const byCommit={};for(const [k,v] of Object.entries(first))(byCommit[v.commit]??=[]).push(k);
const planCommit=s=>/plan delta|delta|land the|refile|plan\b.*MARXY|chore\((plan|docs)\)/i.test(s);
const cls=s=>/plan delta|\bdelta\b|land the|refile/i.test(s)?'planner delta landing':/\bplan\b/.test(s)?'plan edit':/orchestration|ops|gates|ci\)/i.test(s)?'ops PR carrying its own row':'other PR carrying its row';
const lane=phaseOf();
const headKeys=new Set(Object.keys(rowsOf).filter(k=>!/^MARXY-0\d\d$/.test(k)));
const rows=Object.entries(first).filter(([k])=>headKeys.has(k)).map(([k,v])=>({k,...v,lane:lane(k),cls:cls(v.subject),orch:/(^|[ ;,])(orchestration|scripts|\.github|docs\/plan|docs\/sdlc|docs\/ci-contract|docs\/hygiene)/.test(v.paths??'')}));
console.log(md(['how the row first reached main','stories'],Object.entries(count(rows,r=>r.cls)).map(([k,v])=>[k,String(v)])));
console.log('');console.log(md(['lane of story (deps.json)','stories ever filed','of which paths touch orchestration/scripts/.github/plan docs'],['0','1','2','3','4','ops','unlisted'].map(l=>{const s=rows.filter(r=>r.lane===l);return [l,s.length,s.filter(r=>r.orch).length].map(String)})));
console.log('');console.log('orch-path stories total',rows.filter(r=>r.orch).length,'of',rows.length);
// by day created
const wk=iso=>{const d=new Date(iso.slice(0,10)+'T00:00:00Z');const dn=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-dn);return d.toISOString().slice(0,10)};
const W=[...new Set(rows.map(r=>wk(r.at)))].sort();
console.log('');console.log(md(['week of (row first on main)','new rows','ops lane','product phases','unlisted','orchestration-path rows'],W.map(w=>{const s=rows.filter(r=>wk(r.at)===w);return ['week of '+w,s.length,s.filter(r=>r.lane==='ops').length,s.filter(r=>/^[0-4]$/.test(r.lane)).length,s.filter(r=>r.lane==='unlisted').length,s.filter(r=>r.orch).length].map(String)})));
// planner: delta files + timing
const deltas=sh(`git log origin/main --diff-filter=A --name-only --format='@@%aI|%s' -- docs/plan/deltas`).split('@@').filter(Boolean).map(b=>{const [h,...f]=b.split('\n');return {at:new Date(h.split('|')[0]).toISOString(),s:h.split('|').slice(1).join('|'),files:f.filter(x=>/deltas\/[^/]+\.md$/.test(x))}});
const nd=deltas.reduce((a,d)=>a+d.files.length,0);console.log('delta files added',nd,'commits',deltas.length);
console.log('');console.log(md(['date','delta files added'],Object.entries(count(deltas.flatMap(d=>d.files.map(()=>d.at.slice(0,10))),x=>x)).sort().map(([k,v])=>[k,String(v)])));
writeFileSync(SC+'/deltas.json',JSON.stringify(deltas));
```

### t9b.mjs

```js
import {J,SC,md,fmt,events} from './lib.mjs';import {readFileSync} from 'node:fs';
const R=J(`${SC}/runs.json`).filter(r=>r.role==='plan').sort((a,b)=>a.started<b.started?-1:1);
const first=J(`${SC}/csv-first.json`);const deltas=J(`${SC}/deltas.json`);
const byCommit={};for(const [k,v] of Object.entries(first))(byCommit[v.commit]??=[]).push(k);
// planner-landing commits: subject mentions delta/land; get their time and rows
const land=Object.entries(byCommit).map(([h,ks])=>({h,ks,at:first[ks[0]].at,s:first[ks[0]].subject})).filter(x=>/plan delta|\bdelta\b|land the|refile/i.test(x.s)).sort((a,b)=>a.at<b.at?-1:1);
const ev=events();
// planner board events: planner.run start & lastEnded
const mergesAt=R.map(r=>JSON.parse(readFileSync('/Users/ian/Dev/marxy/.git/marxy-fleet/runs/'+r.id+'/run.json','utf8')).mergesAtStart);
const PR=J(`${SC}/prs.json`);
const rows=R.map((r,i)=>{const end=r.exitEnded??r.boardEnded;const nextLand=land.find(l=>l.at>r.started&&Date.parse(l.at)-Date.parse(r.started)<4*3600e3);
 const pr=PR.filter(p=>/plan delta|delta|unblock|refile|stuck/i.test(p.title)&&Date.parse(p.createdAt)>Date.parse(r.started)&&Date.parse(p.createdAt)-Date.parse(r.started)<2*3600e3)[0];const pt=pr?`#${pr.number} ${pr.state.toLowerCase()}${pr.mergedAt?' +'+fmt((Date.parse(pr.mergedAt)-Date.parse(pr.createdAt))/3600000,0)+'h':''}`:'no PR';return [r.id.replace('fleet.plan.',''),r.model,r.exitOutcome??r.boardOutcome,fmt((Date.parse(end)-Date.parse(r.started))/60000,0),mergesAt[i]??'-',pt].map(String)});
console.log(md(['planner run','model','outcome','min','merges at start','plan PR opened within 2h of start (state, hours open to merge)'],rows));
console.log('rows from plan-landing commits since first planner run',land.filter(l=>l.at>R[0].started).reduce((a,l)=>a+l.ks.length,0),'before',land.filter(l=>l.at<=R[0].started).reduce((a,l)=>a+l.ks.length,0));
console.log(land.map(l=>l.at.slice(0,16)+' '+l.ks.length+' '+l.s.slice(0,80)).join('\n'));
console.log('deltas added since first planner run',deltas.filter(d=>d.at>R[0].started).flatMap(d=>d.files).length);
// stories where planner delta rows were later dropped / lane
const lane=J(`${SC}/../fleet-metrics/board.json`);
```

### t9c.mjs

```js
import {readFileSync} from 'node:fs';import {md,count} from './lib.mjs';
const L=readFileSync('/Users/ian/Dev/marxy/.git/marxy-fleet/loop.log','utf8').split('\n');
// one "reason set" per planner start: take the last 'planner: due' line before each 'planner: plan started'
let due=null;const reasons=[];
for(const l of L){if(/planner: due/.test(l))due=l;if(/planner: plan started/.test(l)){reasons.push(due);due=null}}
const flags=l=>{const f=[];if(!l){return ['(no due line)']}if(/escalated\/blocked/.test(l))f.push('escalated/blocked story waiting on a read');if(/parked by the fleet/.test(l))f.push('story parked by the fleet (conflicts)');if(/merges were ops/.test(l))f.push('ops-majority tripwire');if(/merges since last plan/.test(l))f.push('merge cadence');return f.length?f:['other']};
const c=count(reasons.flatMap(flags),x=>x);
console.log('planner starts in loop.log',reasons.length);console.log(md(['reason named on the planner start (a start can have several)','starts'],Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,String(v)])));
```

### Planner delta triggers (shell)

```bash
cd docs/plan/deltas && for f in *.md; do h=$(sed -n 1,14p $f | tr '\n' ' '); a=0;b=0;c=0; echo "$h" | grep -qiE 'of the last 10 merges were ops|ops-majority|ops-heavy'&&a=1; echo "$h" | grep -qiE 'merges since last plan|cadence|periodic pass'&&b=1; echo "$h" | grep -qiE 'escalat|escalated|parked|stuck|blocked|conflict resolution|attempt [0-9] return|return'&&c=1; echo "$f $a $b $c"; done
# loop.log reasons: grep -E 'planner: due' loop.log (see t9c.mjs)
```

### Final line counts (shell cross-check)

```bash
git ls-files -z | grep -zvE '\.(png|jpg|jpeg|gif|ico|icns|woff2?|ttf|otf|pdf|wasm)
 | xargs -0 wc -l | tail -1   # 143,287 lines incl. lockfiles; t7c.mjs gives 134,743 + 8,566 lockfile lines = 143,309 (it counts a final line with no newline)
```

