# 13 — Recommendation: the orchestrator

**Date:** 2026-10-01 · **Author:** the audit lead · **Inputs:** `02-orchestrator-audit.md`,
`03-fleet-metrics.md`, `04-tests-and-gates.md`, the fleet store at `.git/marxy-fleet/`, and the
author's own statement that the orchestrator's rhythm is right but its timing was early.

**Abstract.** Pause the fleet now, keep its engine in the repository frozen and off the
pull-request path, and strip the process down to what protects readers. The author's intuition is
right, and the record makes it sharper: the fleet did not fail because the codebase was young; it
spent most of its effort on contention over its own process files, it was run with the cheapest
models in every seat including the two seats (reviewer, planner) its design assumes are strong,
and it generated more re-planning of itself than product. The engine underneath (an event-logged,
level-triggered reconciler with signed, head-pinned approvals) is sound and worth keeping for a
second run. This document says what to stop, what to keep, what to delete, the five conditions
under which to resume, and what a resumed pilot looks like. The separate question, whether the
orchestrator should become its own repository, is answered "yes, later, after it has run well
once".

## 1. The verdict in one paragraph

The fleet landed 278 pull requests in fourteen days, which is remarkable, and 170 of them were
about the fleet, its gates or its documents rather than the reader's screen. In its last 59 hours
of recorded runs it ran 139 conflict-resolution runs against 86 implementation runs, parked 19
stories as unresolvable, and grew its human queue from 9 items to 30. Composer, the cheapest
model, reviewed 76 of its 80 reviews and Grok ran 12 of its 13 planning passes; the design in
`orchestration/README.md` names Sonnet and Opus for those seats. The loop has been stopped since
2026-09-29 and the 27 PRs merged since were landed by hand. None of that is a reason to delete
the orchestrator. All of it is a reason not to run it on this codebase, with this process, at
this model tier, now.

## 2. Why the author's reason is right, and what the sharper reason is

The author says the orchestrator "would be a good implementation when we were farther along in
development and working from a more stable codebase". The evidence agrees with the conclusion and
refines the cause. The fleet's costs came from three places (`02-orchestrator-audit.md` §5.3):

| Cause | Share of the pain | About the codebase? |
| --- | --- | --- |
| **Contention on shared files.** `CHANGELOG.md` was touched by 239 of 286 commits and the plan CSV by 116. The product's own hub files (`app.ts`, `main.rs`) caused the rest. | Most of the resolve runs and all 19 parks | Half. The process files were the process's fault and are partly fixed (ADR-0042 moves rows per story, `changelog.d/` fragments); the hub files are the product's youth. |
| **The orchestrator's own immaturity.** Five waves of fixes added 15,404 net lines; one rewrote the core (ADR-0034) and the fleet stalled again two days later. | Most of the early stalls | No. This is the fleet's youth, and it would recur on any codebase for a while. |
| **Weak models in the judging seats.** `minimal` mode put Composer in review and Grok in planning. The process grew because it was the only reliable check. | The return rate (41 of 80 reviews returned) and the planner's output (4 of 8 PRs closed unmerged, 9 of 13 starts about its own stuck stories) | No. This was a cost decision. |

So the sharper statement is: **the orchestrator is a good implementation for a codebase with
stable seams, a stable plan written by a person, a process pruned to the product's needs, and a
reviewer stronger than the implementor.** "Stable codebase" is a proxy for the first two.
Pausing addresses all four at once: the product finds its seams by hand (the three feature
directions all cut through `app.ts`, which is exactly where seams are needed), the plan becomes
the author's list, the process can be cut to what protects readers, and the model question is
decided fresh when a resumption is affordable.

## 3. What to do now

### 3.1 Stop

| Stop | How | Why |
| --- | --- | --- |
| The loop and the planner | They are already stopped. Record it: `orchestration/models.json` `compute` set to `"paused"` is not a mode; instead add a one-line `PAUSED.md` in `orchestration/` naming this document and the resume criteria. | A reader of the repo must not start it by habit. |
| The Jira mirror | Do not run `jira.mjs push` or `sync`. Leave the Jira project as a historical record. | One person reads the board; the plan is in git. |
| `check-story --strict` as a CI requirement | Keep the script; remove the step from the `conventions` job, or make it warn. | A branch with no `MARXY-nnn` key and no board row must be able to merge. This audit needed a Jira issue, a CSV row and a `deps.json` entry before a word was written. |
| The enforced PR body (`check-pr.mjs` section order, sentence counts, acceptance table) | Keep the template as a suggestion; remove `check-pr` from CI. | Of the sixteen artefacts a PR needs, ten serve the process; this is the loudest of them. The CI contract itself says the conventions job "fails most, and never for a code reason". |
| Result files and signed agent approvals as merge requirements | Not applicable while the loop is off; `merge-bar.mjs` is not consulted by GitHub. Nothing to change in code. | — |
| Task cards, plan deltas, `out-of-plan.mjs start` as the only entry to work | Leave the files; stop requiring them. | They exist so that weak parallel agents have something to read. |
| The 440 orchestrator tests on every product PR | Move `node --test orchestration/*.test.mjs orchestration/test/*.test.mjs` out of `pnpm test` into `pnpm test:fleet`, run by CI only when `orchestration/` changed (the `changes` classifier already knows) and in nightly. | `04-tests-and-gates.md` has the minutes. |
| Tests that assert documents or history (`docs.test.mjs`, the "named cases still present" selftests in `gate-perf.mjs` and `ci-changes.mjs`) | Delete them with the orchestrator's PR-path presence. | They defend the process's shape, not the product. |

### 3.2 Keep, on the pull-request path

Trunk-based development, squash merges, Conventional Commits (the hook is cheap and the history
is readable), one changelog fragment per change, CODEOWNERS on the security paths only
(`packages/core/src/sanitize`, the CSP in `tauri.conf.json`, `.github/workflows`), and the
product gates `04-tests-and-gates.md` recommends. The Jira key in commit subjects becomes
optional; a key is still welcome when a story exists.

### 3.3 Keep, in the repository, frozen

All of `orchestration/` and its tests, untouched, with `PAUSED.md` at its root. Freezing is
cheaper than deleting and far cheaper than rebuilding the integration later. Git history would
keep it anyway, but a frozen directory keeps the ADRs (0017, 0025, 0034, 0040, 0042, 0043)
readable against living code.

### 3.4 Delete

Nothing in `orchestration/` yet. Delete `orchestration/state.json` and `orchestration/results/`
if they are still tracked (ADR-0034 §3 says they moved to the store); delete
`orchestration/canvases.mjs` (555 lines rendering fleet state into Cursor canvases) if the author
no longer uses Cursor canvases. Everything else waits for the resumption decision.

### 3.5 Change, so that resumption is possible

Three things make the next run cheaper, and all three are things the author will want anyway:

1. **Seams in the product.** Refactor `apps/desktop/src/app.ts` (1,232 lines, 33 module-level
   variables) into owned modules as the three features land; ADR-0037's document store is the
   first cut. `12-recommendation-codebase.md` sequences this. Path-based parallelism only works
   when paths have owners.
2. **No shared append-only files on the PR path.** Finish ADR-0042 (plan rows per story) or
   simply stop committing the CSV and `deps.json`; `changelog.d/` fragments already replace the
   shared changelog.
3. **The merge bar's hold reasons as a tagged union**, so that `reviewStep`'s branches are
   enumerable and testable (`02-orchestrator-audit.md` §3.3 names this as the one engine-level
   debt).

## 4. When to resume: five conditions

Each is checkable by a command, and all five must hold.

| # | Condition | Check |
| --- | --- | --- |
| 1 | **Seams.** Fewer than a quarter of the last 20 product PRs touch any of the five most-edited product files. | `git log -20 --format=%h --name-only -- packages apps` against the hub list |
| 2 | **No shared append-only files on the PR path.** | `git log --since=7.days --name-only \| grep -c -E 'jira-issues.csv\|deps.json\|^CHANGELOG.md'` is 0 |
| 3 | **A ready backlog** of at least 15 stories with disjoint paths, machine-checkable acceptance, no dependency on a proposed ADR, written or read by the author. | `node orchestration/ready.mjs` once the loop code is unfrozen |
| 4 | **`main` green for seven consecutive days** under hand development, no revert. | `gh run list --branch main --workflow ci --limit 50 --json conclusion,createdAt` |
| 5 | **A pruned PR path.** The conventions job is no longer the most frequent red; orchestration tests run only when `orchestration/` changes. | `gh run list --workflow ci --json conclusion,jobs` over 50 runs |

Then resume as a **pilot, not a switch**: `reviewLanes` 2; at most five stories in flight; the
planner off (the author plans); the reviewer at least `default` mode's Sonnet and ideally Opus,
because the reviewer is the seat the whole design leans on; implementors on whatever is cheap.
Stop again if, over three days, resolution runs exceed implementation runs, any story is parked
after three resolutions, or **Needs you** stays above ten for a day. Those are the failure
signatures of the last four days.

## 5. On the models

The fleet's design (`orchestration/README.md`, `models.json`) assigns the strongest models to
review and planning and the cheapest to implementation, which is the right shape: implementation
is checked by gates and a reviewer, review is checked by nobody. The record shows the fleet ran
in `minimal` mode almost throughout (`.git/marxy-fleet/runs/*/run.json`: 76 of 80 reviews on
Composer, 12 of 13 plans on Grok). The author's note on compute ("fix failures mechanically, keep
compute minimal") was a reasonable cost decision, but it removed the one check the design counts
on, and the process grew to compensate. For the pilot: pay for the reviewer, not the implementor.

```sh
cd .git/marxy-fleet/runs && node -e 'const fs=require("fs");const c={};for(const d of fs.readdirSync(".")){try{const r=JSON.parse(fs.readFileSync(d+"/run.json","utf8"));const k=r.role+" | "+r.model;c[k]=(c[k]||0)+1}catch{}}console.log(c)'
# { 'resolve | composer-2.5': 101, 'review | composer-2.5': 76, 'implement | composer-2.5': 71,
#   'implement | grok-4.6': 15, 'resolve | grok-4.6': 38, 'review | claude-sonnet-5': 4,
#   'plan | claude-opus-5-5-medium': 1, 'plan | grok-4.7-high': 12 }
```

## 6. Separate repository or not

**Later, and only after a successful pilot.** The engine is about 2,700 lines behind a handful
of interfaces (`02-orchestrator-audit.md` §6.1) and would generalise well: an event-logged
reconciler, bounded workers with a stall watchdog, head-pinned signed approvals, a pluggable
merge bar, path reservation. The couplings to cut are known: the `MARXY-\d+` regex in eighteen
places, the CSV schema, Jira, the house PR template, `cursor-agent` as the only backend, and
prompts that assume Marxy. Extracting now turns a pause into a project on a tool that has not yet
run smoothly for three days on any codebase. Extract when it has, or when the author wants it for a
second project; `14-roadmap-proposal.md` places it after the Marxy pilot.

If the author wants the rhythm without the machinery in the meantime, the cheapest substitute is
one person plus ad-hoc agents in worktrees, reviewing each other's PRs with a strong model, and no
board at all. That is how the last 27 PRs landed.

## 7. What this costs and buys

| | Before (fleet on) | After (paused) |
| --- | --- | --- |
| Artefacts per PR a person must produce | 16 (`02-orchestrator-audit.md` §4.1) | 4: commit subject, changelog fragment, green CI, a review |
| CI minutes per PR | see `04-tests-and-gates.md` | the pruned path there |
| Who plans | the planner, mostly about itself | the author, in a list |
| Who reviews | Composer (76 of 80) | the author, or a strong model on request |
| Merges per day | 19.9 (61 % ops) | fewer, and product |
| Human queue | 30 items, 10 of them idle worktrees | zero by construction |

## For the synthesis

1. Pause the fleet; keep `orchestration/` frozen in the repo with a `PAUSED.md`; do not delete and do not extract yet.
2. The author's reason is right and the record sharpens it: contention on process files, a fleet still fixing itself, and the cheapest models in the two seats the design assumes are strong.
3. Strip the PR path to four things: a conventional subject, a changelog fragment, green product gates, a review.
4. Move the orchestrator's 440 tests and the document-asserting selftests off every product PR.
5. Resume only when five checkable conditions hold (seams, no shared append-only files, a ready backlog, seven green days, a pruned path), and then as a five-story pilot with a strong reviewer and the planner off.
6. Extract the engine to its own repository after a successful pilot, not before.
7. In the meantime the rhythm the author likes survives as one person plus ad-hoc agents in worktrees, which is how the last 27 PRs landed.
