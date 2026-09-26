# ADR-0034 — The fleet is a reconciler: every state has an owner and a way out

- **Status:** proposed
- **Date:** 2026-09-26
- **Amends:** ADR-0025 §1 (review WIP no longer holds dispatch) and §5 (a signature may be taken at
  any place in the order). ADR-0025 §2–§4 and §6 stand. Replaces the mechanisms of MARXY-117
  (board-drift hold), MARXY-202 (dirty worktrees reserve paths), MARXY-208 (reap verdicts),
  MARXY-217 (conflicts leave review) and MARXY-223 (park a dirty checkout), and keeps what each was
  for.
- **Research:** a six-part review of practice in control loops (Kubernetes controllers, Temporal,
  OTP supervision), multi-agent coding fleets and their failure studies (MAST), merge queues and
  worktrees, state and hand-off storage, stall detection, and review gates, taken on 2026-09-26
  against the orchestrator's own history. Its findings are summarised under Context.

## Context

About eighty commits to `orchestration/` each fixed a new way the fleet stopped moving. On
2026-09-26 it was stopped again: seventeen stories todo, none ready, none in progress, the loop
idling every two minutes, because four worktrees nobody was working in held uncommitted edits and
MARXY-202 made a dirty worktree reserve its story's paths with no expiry. The fixes for the loop's
own faults were themselves stuck behind the CODEOWNERS gate on the loop's code.

Read together, the failures share four causes, and the research names each:

1. **States with no way out.** A dirty worktree, a story In Progress without a lease, a PR held for
   a missing row, a conflicted PR returned to In Progress, a planner reason that never cleared:
   each was a state nothing was obliged to leave. Control-loop practice is unanimous that every
   state must declare an owner, a maximum dwell and what fires when it is exceeded; a state
   without one is a bug, not a case to detect later.
2. **State inferred instead of recorded.** Claims were read off the filesystem, liveness off pids,
   results off whether a file happened to exist in one of two directories. Durable-execution
   engines record "this was scheduled" when it is scheduled, independent of the worker ever
   reporting back.
3. **Tracked files used as locks and queues.** The loop read its plan from its own working tree,
   so a machine write to the tracked `needs-human.md`, or anyone's half edit, halted dispatch.
4. **Edge-triggered repairs.** Adoption re-took a PR the cycle had just returned (MARXY-217),
   because it acted on "a PR is open" rather than on the story's whole current state.

## Decision

**1. One level-triggered reconciler.** `cycle.mjs` reads the whole world each cycle — the plan on
`origin/main`, the board, one GitHub snapshot, the runs, the worktrees — and takes the next step for
every story that has one. Decisions are pure functions of that world (`reconcile(io)` takes the
world as an argument, so the whole cycle is tested end to end against a fake one). Missing a cycle
loses nothing.

**2. Every non-final status has an owner and a way out** (`machine.mjs` `STATES`, checked by a
test). In Progress is owned by a run, which ends at its deadline or after `stallMinutes` without
output, or by a claim, which lapses at its expiry. In Review is owned by the review pipeline, in
which every sub-state has a run deadline, a try limit, or a hold age after which it is named under
**Needs you**. Blocked and escalated stories are a person's, and are always listed. Nothing waits
silently: a wait that is not normal becomes a line with the command that moves it.

**3. The board is a fold over an append-only event log**, kept in the fleet store
`<git common dir>/marxy-fleet/`, which every worktree of the clone resolves to the same place and
which can never make a checkout dirty. Every change is an event naming the status it expects, and
the run that must still own the story; the fold refuses one that no longer applies (fencing). Human
and agent commands (`fleet.mjs`) append the same events. `state.json`, `results/` in the checkout
and the per-role lease files are gone; the first read imports the old board once.

**4. The plan is read from `origin/main`**, from git objects, never from a working tree. A checkout
that is behind, on a branch, or carrying half an edit changes nothing. The loop runs its code from
a runner worktree the fleet owns, reset to `origin/main` before each cycle, so a merged fix to the
orchestrator takes effect on the next cycle and the CODEOWNERS gate delays only the fix, never the
running fleet.

**5. Paths are reserved by runs, unexpired claims and open PRs** — and by a worktree only while
someone is working in it (activity within `activeWorktreeMinutes`). An idle worktree with work in
it is named for a person and never deleted; before an attempt reuses a worktree, its uncommitted
work is kept on `refs/fleet/wip/KEY/<time>` (`git stash create`, never the shared `refs/stash`).

**6. One worker for every role** (`worker.mjs`): implement, review, resolve, plan. Each runs the
agent in its own process group with streamed output, and ends in one of a fixed set of recorded
outcomes (`exited`, `timeout`, `stalled`, `setup`, `auth`). Every subprocess has a time limit
(`proc.mjs`). What an ending means is decided by the reconciler (`runs.mjs`): a PR goes to review;
`blocked` parks with its reason; an empty run or a setup failure is refunded and the second parks;
a failed attempt counts, the escalation model takes over after `maxAttempts`, the same failure
twice skips straight to it, and when those tries are spent the story escalates.

**7. Review is part of the pipeline, not a gate on it** (amends ADR-0025). Reviewers run in parallel
up to `reviewLanes`, which caps reviewer runs and never dispatch. A signature may be taken whenever
the PR is not in conflict: `onlyMainArrived()` already lets an approval survive a head that is the
reviewed commit merged with main, which removes the livelock that made ADR-0025 §5 necessary. One
BEHIND branch is still updated per cycle, at the head of the order (§4 stands). A conflicted PR
stays In Review and gets a resolution run, so there is no return for adoption to undo.

**8. Holds have owners.** Red CI is returned to the implementor after `redGraceMinutes`; a boundary
break, an attribution trailer or a missing CHANGELOG line at once; a conflict gets `resolveTries`
resolution runs, then parks; a CODEOWNERS hold, a missing board row or requested changes go under
**Needs you** at once, the gate files first; anything else once it is older than
`holdAttentionMinutes`.

**9. Machines never write a tracked file.** The human queue is generated into `status.md` every
cycle. `needs-human.md` stays tracked, for the author's rulings only. Jira is pushed from the board
and never read back as an input; a Jira failure costs a stale board there and nothing else.

**10. The log reports changes.** One heartbeat line per cycle, then only lines that differ from the
last cycle's.

Model assignments are unchanged in every compute mode (`models.json`, pinned by `lib.test.mjs`).

## Consequences

- The four causes above are structural, not detected: a state with no exit fails a test; an
  inferred claim does not exist; the loop cannot read its own dirt; a returned PR carries the head
  it was returned at, so adoption waits for a new push.
- An in-app implementor that is not started by the fleet must claim its story
  (`fleet.mjs claim KEY`), or the fleet may start a second attempt on the same paths once its
  worktree has been idle for `activeWorktreeMinutes`.
- Approvals and result files move out of `orchestration/results/` into the fleet store. Reviewers
  use `fleet.mjs verdict`; `pnpm done` writes the result there from any worktree.
- The fleet store is per clone. A second clone on another machine is a second fleet, as a second
  `state.json` was before; the plan and Jira stay shared.
- The CODEOWNERS gate is unchanged. `cycle.mjs`, `merge-bar.mjs` and `approve.mjs` still decide
  every merge.

## How we would know this was wrong

1. A story sits in one status past its owner's limit with no line under **Needs you**. Then a state
   is missing its way out, and `STATES` or `reviewStep` needs the case.
2. Runs are stopped as `stalled` while doing real work. Then `stallMinutes` is too short for the
   longest silent step (a Rust build), and moves on evidence from `fleet.mjs why`.
3. Parallel reviewers produce approvals that `onlyMainArrived` voids more than rarely. Then signing
   early costs more review than it saves, and ADR-0025 §5 comes back.
4. The event log grows past what a fold reads in a few milliseconds. Then it is compacted into a
   snapshot event; the fold already accepts one (`imported`).
