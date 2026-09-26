# Orchestration — how the fleet runs

One reconciler, four kinds of worker run, and a store every worktree shares (ADR-0034). Any session
can pick it up cold: `node orchestration/fleet.mjs status` says what is happening and what needs a
person.

| Role | Default model (edit `models.json`) | Runs as | Owns |
| --- | --- | --- | --- |
| **Orchestrator** | Claude Sonnet 5, medium | the in-app agent, beside the loop | what the loop hands to judgement or a person (`prompts/orchestrator.md`) |
| **Planner** | Claude Opus 5.5, medium | a worker run when due | re-sequencing, splitting, new stories, ADR proposals, plan deltas |
| **Implementor** | Composer 2.5 (escalation: Opus 5.5) | a worker run per ready story, in its own worktree | exactly one story, on its own branch, inside its listed paths |
| **Reviewer** | Claude Sonnet 5, high | a worker run per PR that needs a verdict | merge / return / escalate, signed |

The orchestrator never implements. The planner never implements. Implementors never plan or review.
Humans (the author) review taste, approve CODEOWNERS paths, and work down **Needs you**.

**Jira is where people read the board**; the fleet pushes to it every cycle and never reads it back,
so a Jira outage costs a stale board there and nothing else. The plan — stories, paths, acceptance,
deps, phases — is `docs/plan/jira-issues.csv` and `deps.json` **on `origin/main`**, read from git
objects, never from a working tree. The process around it is `docs/sdlc.md`.

## Running it

```sh
./orchestration/loop.sh start      # the reconciler, every 120 s, detached from this terminal
./orchestration/loop.sh status     # running or not, and the last lines of its log
./orchestration/loop.sh stop       # after the cycle in flight
node orchestration/fleet.mjs doctor  # one line per problem, with its fix
node orchestration/fleet.mjs status  # status.md: Needs you, In flight, Ready, Waiting, This cycle
```

The loop runs each cycle from a runner worktree the fleet owns (`<git common dir>/marxy-fleet/runner`,
reset to `origin/main` before every cycle), so it always runs merged code and never reads or writes
a checkout anyone is working in. `MARXY_RUNNER=0` runs your checkout's code instead, for developing
the orchestrator. A one-off `node orchestration/cycle.mjs` beside a running loop exits at once if
the loop's cycle holds the lock. `--dry-run` changes nothing anywhere and prints the status it would
write; `--no-merge` decides everything and merges nothing; `--low`, `--minimal`, `--high` pick the
compute profile. Never `pkill` the loop or a worker; stopping the loop does not stop workers, and
the next loop finishes whatever ended while it was away.

## One cycle

`cycle.mjs` is level-triggered: it reads the whole world, compares it with the board, and takes the
next step for every story that has one. It never depends on having seen an earlier event, so a
missed or killed cycle loses nothing.

1. **Observe.** `git fetch`; the plan on `origin/main`; the board (a fold of the event log); one
   GitHub snapshot (two `gh pr list` calls); every unfinished run; every story worktree.
2. **Finish runs.** A run whose worker wrote `exit.json`, whose worker is gone, or that is past its
   deadline plus `runGraceMinutes` is finished (its process groups stopped), and `runs.mjs` decides
   what its ending means for its story.
3. **PRs.** Merged PRs settle Done (a plan delta records the planner's pass). Open PRs naming a key
   are adopted into review. Claims past their expiry lapse. Worktrees whose PR merged or closed are
   removed — never one with uncommitted work.
4. **Review.** Each In Review PR takes exactly one step: resolve a conflict, return it to its
   implementor, start a reviewer, update the branch (one per cycle, head of the order), enable
   auto-merge, merge, or wait. A wait past its limit is named under **Needs you**.
5. **Plan.** The planner starts when `planner-trigger.mjs` says it is due, none is running, and the
   last started more than `plannerCooldownMinutes` ago.
6. **Dispatch.** An implementor starts for every ready story (`ready.mjs`), unless the planner has
   never run or has an escalation it has not read.
7. **Mirror.** Jira follows the board. Bounded and best effort.
8. **Report.** `status.md` (fleet store, and the main checkout's gitignored copy); the loop log gets a
   heartbeat line and only what changed.

## What keeps it honest

- **No step can stop the cycle.** Every stage, and every story's step within it, runs guarded: a
  failure (a `gh` timeout, a malformed PR, a bug) is logged, named under **Needs you** with the
  story, and retried next cycle while everything else carries on. A cycle that cannot finish at all
  still writes a `status.md` that says so.
- **Hand-offs are checked where they are read.** A result that breaks `schema/result.schema.json`
  holds its merge with the fix named; a malformed event is refused on append; `fleet.mjs` refuses a
  key that is neither on the board nor on `origin/main`; `doctor` names `models.json` settings
  nothing reads and a report that has stopped updating.
- **The docs cannot drift.** `docs.test.mjs` fails when a live doc or prompt names a file, a
  `fleet.mjs` command, a status or a timing the code does not have.
- **Tests never touch the real store.** Under `node --test` the store is a temporary directory.

## Every status has an owner and a way out

| Status | Owner | How it is left, even if the owner does nothing |
| --- | --- | --- |
| **todo** | the reconciler | recomputed every cycle; the one reason it waits is printed under **Waiting** |
| **in_progress** | its run, or its claim | a run ends at `attemptMinutes`, or after `stallMinutes` without output; a claim lapses at its expiry |
| **in_review** | the review pipeline | every step has a run deadline, a try limit (`reviewTries`, `resolveTries`), or a hold age that raises **Needs you** |
| **blocked** | a person | listed under **Needs you** with its reason; `fleet.mjs unpark KEY` |
| **escalate** | the planner, then a person | listed under **Needs you**; the planner splits it, or `fleet.mjs retry KEY` |
| **done** | — | final |

`machine.test.mjs` fails if a status is added without an owner and a way out.

### What a run's ending means (`runs.mjs`)

| Ending | Story goes to |
| --- | --- |
| a PR is open (the result names it, or GitHub has one for the branch) | in_review |
| the implementor reported `blocked` (`fleet.mjs report KEY blocked "…"`) | blocked, with its reason |
| `auth` — the CLI could not authenticate | todo, attempt refunded; **Needs you**: `cursor-agent login` |
| `setup` — worktree or install failed | todo, refunded; the second time blocked |
| nothing produced (no commits, clean worktree, under 2 KB of output) | todo, refunded; the second time blocked, with the output that explains it |
| failed, timed out or stalled with work done | todo; after `maxAttempts` the next attempt uses the escalation model; the same failure twice skips straight to it; when `maxAttempts + escalationAttempts` are spent, escalate |

### What each hold on a PR means (`cycle.mjs` `reviewStep`)

| Hold | Owner | Step |
| --- | --- | --- |
| conflicts with main | a resolution run | resolve, without charging an attempt; after `resolveTries`, blocked |
| files outside the paths, an attribution trailer, no CHANGELOG line | the implementor | returned at once, with notes |
| red CI | the implementor | returned after `redGraceMinutes` |
| no signed approval | a reviewer run | started, up to `reviewLanes` at once; after `reviewTries` without a verdict, **Needs you** |
| CODEOWNERS, changes requested, no board row | a person | **Needs you** at once (gate files first) |
| CI pending | CI | auto-merge enabled once approved; **Needs you** if it waits four times `holdAttentionMinutes` |
| behind main, otherwise ready | the cycle | one branch updated per cycle, head of the review order |
| anything else | a person | **Needs you** after `holdAttentionMinutes` |

A PR that cannot go back to an implementor (a `no-dispatch` row, or no row) goes under **Needs you**
instead of being returned.

## The store

`<git common dir>/marxy-fleet/` — one directory for every worktree of the clone, never tracked, so
nothing the fleet writes can make a checkout dirty.

| Path | What | Written by |
| --- | --- | --- |
| `events.jsonl` | every decision and fact, append-only; the board is `fold(events)` | the cycle, `fleet.mjs`, `out-of-plan.mjs` |
| `runs/<run>/run.json` | what a run was asked: role, model, prompt, worktree, deadline | the cycle |
| `runs/<run>/out.log`, `exit.json`, `agent.json` | the agent's streamed output (its heartbeat), how the run ended, the agent's process group | the worker |
| `results/KEY.json` | the implementor's result (`fleet.mjs path result KEY`) | `pnpm done`, `fleet.mjs report` |
| `results/KEY.approved` | the reviewer's notes, signed against the head it read | `fleet.mjs verdict KEY merge` |
| `results/KEY.notes.md` | why a story was returned; the next attempt reads it first | the cycle, `fleet.mjs verdict/return` |
| `wip/`, `refs/fleet/wip/*` | uncommitted work kept before a worktree is reused | the worker, `loop.sh` |
| `status.md`, `report.json`, `loop.log` | the report, what the log last printed, the log | the cycle, `loop.sh` |
| `cycle.lock`, `loop.lease`, `runner/` | one cycle and one loop at a time; the loop's code | the cycle, `loop.sh` |

The first read in a clone with no event log imports the old `orchestration/state.json` and the
hand-off files from `orchestration/results/`, once. `MARXY_FLEET_DIR` points the store elsewhere
(tests do).

## Commands for people and agents

```sh
node orchestration/fleet.mjs why KEY                 # the record, its runs, its last events, refusals
node orchestration/fleet.mjs claim KEY [--hours 4]   # reserve a story you work on outside the fleet
node orchestration/fleet.mjs release KEY
node orchestration/fleet.mjs verdict KEY merge|return|escalate --notes FILE   # the reviewer
node orchestration/fleet.mjs return KEY --why "…"    # a person sends it back
node orchestration/fleet.mjs park KEY "reason" | unpark KEY | retry KEY [--fresh]
node orchestration/fleet.mjs report KEY blocked "…"  # an implementor that cannot finish
node orchestration/out-of-plan.mjs start "summary" --paths "…" --acceptance "…"
```

Each command appends one event that names the status it expects; if the story has moved, the fold
refuses it, the command says so, and the refusal shows under **Needs you** for an hour.
`state.mjs` still accepts its old verbs and appends the same events.

Out-of-plan work is one PR: `out-of-plan.mjs start` gives it a key, a worktree, its own row on its
branch and a claim on its paths; the cycle adopts the PR when it opens and the merge bar judges it
by that row (`docs/sdlc.md`, "Work outside the plan").

## Merging

What the cycle will never do is decide that a diff satisfies its story. A PR merges only once a
reviewer (never the implementor) has recorded a signed `merge` verdict against the commit it read,
and every clause of the merge bar holds (`merge-bar.mjs`; the clauses are in `docs/sdlc.md`). The
merge is pinned to the evaluated head (`--match-head-commit`). An approval survives the branch being
brought up to date with main (`approve.mjs` `onlyMainArrived`) and nothing else. CODEOWNERS paths
(`.github/CODEOWNERS`) still need the author. `cycle.mjs`, `merge-bar.mjs` and `approve.mjs` are the
code that decides a merge, and CODEOWNERS covers them; because the loop runs from `origin/main`, a
fix to them waits for the author without stopping the fleet that runs the old version.

`models.json` `mergeQueue` stays false on this User-owned repo: the cycle updates one BEHIND branch
per cycle instead. After an org transfer, enable GitHub's merge queue and flip it; the cycle then
enqueues with `--auto` and never updates a branch.

`node orchestration/readiness.mjs` prints every open PR as one table in review order: CI,
mergeability, approval, who it waits on, and the next action.

## Compute modes

Four levels, weakest to strongest. `default` is where most time is spent; `low` is the Sonnet-led
cheaper profile; `high` is the Opus 5.5 tier for when judgement matters more than cost; `minimal` is
the Cursor-only floor.

| Mode | How | Orchestrator | Planner | Implementor | Escalation | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| **high** | `--high` or `MARXY_COMPUTE=high` | Sonnet 5, medium | Opus 5.5, medium | Grok 4.6 | Opus 5.5, medium | Opus 5.5, medium |
| **default** | `"compute": "default"` | Sonnet 5, medium | Opus 5.5, medium | Composer 2.5 | Opus 5.5, medium | Sonnet 5, high |
| **low** | `--low` or `MARXY_COMPUTE=low` | Sonnet 5, medium | Sonnet 5, medium | Composer 2.5 | Grok 4.6 | Sonnet 5, medium |
| **minimal** | `--minimal` or `MARXY_COMPUTE=minimal` | Composer 2.5 | Grok 4.7, high | Composer 2.5 | Grok 4.6 | Composer 2.5 |

**`minimal` is Cursor-only by construction**: no role names a Claude, GPT or Gemini model, so the
fleet runs on Cursor-included spend alone, and its escalation ceiling is Grok. Precedence: flag,
then `MARXY_COMPUTE`, then `models.json` `compute`. The cycle pins `MARXY_COMPUTE` for the workers it
starts. In-app, pass each role's `inApp` slug when you spawn a subagent. `node orchestration/lib.mjs`
prints the resolved roles; `lib.test.mjs` pins every one.

Timings and limits (`machine.mjs` `TIMING`; any can be set in `models.json` by the same name):
`attemptMinutes` 45, `stallMinutes` 25, `runGraceMinutes` 5, `claimHours` 4,
`activeWorktreeMinutes` 30, `holdAttentionMinutes` 30, `redGraceMinutes` 20, `maxAttempts` 2,
`escalationAttempts` 1, `reviewTries` 3, `resolveTries` 3, `ghostLimit` 2,
`plannerCooldownMinutes` 240, `reviewLanes` 4.

## Files

| File | What |
| --- | --- |
| `cycle.mjs` | one reconcile cycle; every merge decision (with `merge-bar.mjs`, `approve.mjs`) |
| `machine.mjs` | the statuses, their owners and exits, the timings, the fold, the event builders |
| `store.mjs` | the fleet store: paths, append, read |
| `plan.mjs` | the plan on `origin/main`, from git objects |
| `observe.mjs` | worktrees, runs, path holds — read only |
| `ready.mjs` | which todo stories may start, and why each other one waits |
| `runs.mjs` | run specs, prompts, and what a finished run means |
| `worker.mjs` | one detached run of any role, under a deadline and a stall watchdog |
| `proc.mjs` | every subprocess bounded; process groups |
| `report.mjs` | `status.md`, **Needs you**, the quiet log |
| `fleet.mjs` | the command line for people and agents; `doctor` |
| `state.mjs`, `doctor.mjs` | the old names, kept as thin shims |
| `merge-bar.mjs`, `approve.mjs`, `codeowners.mjs` | the quality bar and the signed approval |
| `adopt.mjs`, `github.mjs`, `review-order.mjs`, `review.mjs`, `readiness.mjs` | adoption, the one GitHub read, the order, the review packet, the merge-readiness table |
| `planner-trigger.mjs` | whether the planner is due, and whether that holds dispatch |
| `worktrees.mjs` | worktree listing and the prune (never `--force`) |
| `jira.mjs`, `jira-map.json` | the Jira mirror; old ids to Jira keys |
| `out-of-plan.mjs` | one PR for work outside the plan |
| `canvases.mjs` | the Cursor canvases, refreshed when that folder exists |
| `lease.mjs` | the cycle lock and the loop lease |
| `loop.sh` | the loop: `start`, `stop`, `status`, or in the foreground |
| `models.json` | model and effort per role per compute mode; lanes, `reviewLanes`, timings |
| `deps.json` | story dependencies and phase membership |
| `needs-human.md` | the author's rulings; no machine writes it |
| `prompts/*.md` | role prompts, the source of truth for behaviour |
| `prompts/hardening.md` | the handoff for hardening the fleet: orientation, invariants, and the prioritised follow-up plan |
