# SDLC — how one developer and a fleet of agents ship Marxy

One person owns this project and cannot be the bottleneck for everything, so the process is
built around two ideas: **Jira holds the truth about state, git holds the truth about code**,
and **anything a machine can check is never checked by a person**. Everything below is the
smallest process that still gives traceability, and nothing in it exists to produce a report.

## The board

Jira project **MARXY** at <https://marxy.atlassian.net>. Every epic and story in
`docs/plan/jira-issues.csv` exists there as an issue; the CSV stays the machine-readable
spec (acceptance criteria and allowed paths, which scripts parse) and Jira owns status,
history and the human view. `orchestration/jira.mjs sync` makes Jira's summary, description
and labels match the CSV; `orchestration/jira.mjs push` makes Jira's statuses match the local
board. Neither invents work.

| State | Means | Who moves it |
| --- | --- | --- |
| **To Do** | ready, or waiting on a dependency; a `blocked` or `escalated` label says which | the orchestrator, via `state.mjs` |
| **In Progress** | an implementor is in a worktree on it, or the author is | `state.mjs start KEY` |
| **In Review** | a PR exists and the gates have run | `jira.mjs pr KEY <number>` |
| **Done** | squash-merged into `main` | `state.mjs done KEY` |

**No WIP cap** — `orchestration/models.json` `lanes` is `null`. Dispatch starts every ready
story whose paths do not overlap work already in flight; path ownership is the only
parallelism limit. A positive `lanes` value would restore a cap.

Keys are Jira keys (`MARXY-23`), everywhere: branch, commit subject, PR title, result file.
`orchestration/jira-map.json` records what each issue was called before the tracker existed,
so old ADRs, deltas and commits stay readable.

## Definition of ready

A story is not dispatched until all of this is true. `ready.mjs` enforces the mechanical half.

1. Acceptance criteria are **machine-checkable** — each one names an observable a test or gate
   can assert. "Feels fast" is not a criterion; "median cold start < 500 ms in `results/perf.json`" is.
2. `Paths` lists every path the story may touch, and they do not overlap a story in progress.
3. Dependencies in `orchestration/deps.json` are `done`.
4. The ADRs the story relies on are named in it, and none of them are `proposed` unless the
   story's job is to accept one.
5. It is one vertical slice — something a reader or a developer can observe when it lands.
6. Stories labelled `human-gated` are never dispatched to an agent at all.

## Definition of done

1. Every acceptance criterion is checked by a test or gate **in the same PR**.
2. `pnpm build typecheck lint test` green, plus every `pnpm gate:*` that touches the story's paths.
3. No file outside the story's `Paths` (plus `CHANGELOG.md`, the taste queue and its own result
   file). `review.mjs` lists violations and a violation is an automatic return.
4. `CHANGELOG.md` has a line under `Unreleased`.
5. Anything a reader sees has a before/after entry in `docs/taste-review/queue.md`.
6. Docs and ADRs updated in the same PR if a decision changed.
7. CI green, CODEOWNERS approved where required, squash-merged, branch deleted.
8. The Jira issue is **Done** and carries the PR link.

## Which of the four definition-of-done commands may skip

`pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` are the four commands in item 2.
The next agent does not get to infer a skip. The rule is:

- **`pnpm build`** may skip only the desktop CLI smoke, and only when the machine delivered no
  animation frames (a display asleep, dark wake, or a locked screen over ssh). The skip must
  name that environment and print that the frame assertion is not what is wrong. A build that
  can paint and does not paint never skips. CI (`verify:cli` with `MARXY_SMOKE_REQUIRED=1` on
  both runner classes) and a hand-set `MARXY_SMOKE_REQUIRED=1` never skip.
- **`pnpm typecheck` may never skip.**
- **`pnpm lint` may never skip.**
- **`pnpm test`** does not launch the desktop app; browser tests use headless WebKit via
  `scripts/playwright-webkit.mjs`. Unit tests never skip. Real binary smoke is not part of
  `test` — run `pnpm --filter @marxy/desktop verify:cli` by hand before merge when shell,
  paint, or CLI paths changed (CI gates job runs the same with `MARXY_SMOKE_REQUIRED=1`).

Do not delete the frames assertion to make a sleeping laptop green. Wake the display, or
accept the named skip on **`pnpm build`**. `pnpm --filter @marxy/desktop verify:cli` is the
hand-reachable required mode for the CLI smoke check.

## Traceability, both directions

A question like "why is this line here?" must be answerable in two hops, and "what shipped in
v0.2?" in one.

- Branch `type/MARXY-23-slug` → commit subject `feat(typeset): … (MARXY-23)` → PR title the
  same → `Refs: MARXY-23` trailer → the issue, which carries the PR link as a comment.
- The issue's description holds the acceptance criteria the PR had to satisfy; the PR body
  holds criterion → the test that checks it.
- A phase is a Jira version; a version is a git tag; `CHANGELOG.md` is the prose version of
  the same thing.

## The loop, per story

```sh
node orchestration/ready.mjs                 # what may start, respecting deps and paths
node orchestration/state.mjs start MARXY-23  # → In Progress, mirrored to Jira
node orchestration/dispatch.mjs MARXY-23     # implementor in its own worktree
node orchestration/review.mjs MARXY-23       # the review packet: acceptance, boundaries, gates
node orchestration/approve.mjs MARXY-23      # the reviewer signs results/MARXY-23.approved
node orchestration/cycle.mjs                 # adopts the open PR (→ In Review), lands it once the bar holds, → Done
node orchestration/planner-trigger.mjs       # is it time to re-plan?
```

Nobody runs `gh pr merge` by hand, and nobody has to move a story to In Review: the cycle
**adopts** every open, non-draft pull request whose title or branch names a key the board does
not already have in review, links it in Jira, and from then on the merge bar decides
(`orchestration/adopt.mjs`). A done, blocked or escalated story's PR is not adopted — that is a
person's call — and neither is a second PR for a key that already has one in review. A row
labelled `no-dispatch` (work that arrives with its own PR) is never dispatched to an implementor,
and the cycle records it Done as soon as its PR has merged, however it merged.

Everything in that list except the two judgements — is this story ready, does this diff satisfy
it — is one command, `node orchestration/cycle.mjs`, and `./orchestration/loop.sh` runs it until
interrupted. `--low` (Sonnet 5 medium + Grok 4.6 High Fast) and `--minimal` (Grok 4.6 High Fast
only) spend less; the loop is the same. A cycle mirrors the board into Jira, merges the pull requests that are provably
finished, returns in-progress stories whose worker is gone, names (or starts) what should start
next, asks whether the planner is due, and rewrites `orchestration/status.md`. It is safe to stop
and restart at any point, and to sleep through: `./orchestration/loop.sh start` runs the loop
detached from any terminal, implementors run as detached workers holding a lease on their row,
and only one cycle runs at a time. `node orchestration/doctor.mjs` is the first thing to run when
the fleet looks stuck; it names each problem with the command that fixes it (MARXY-208).

The one thing it refuses to infer is approval. Green gates say the code works; they cannot say it
does what the story asked. So the reviewer writes `orchestration/results/KEY.approved` with the
review note and signs it with `node orchestration/approve.mjs KEY`, which records the commit the
review was of; the key lives in `~/.config/marxy/`, outside the tree. An approval for an earlier
commit is held rather than honoured, because a push after a review is an unreviewed tree wearing a
reviewed one's name. A reviewer writes and signs `KEY.approved`; the implementor never writes
it. `cycle.mjs` then lands the PR without a person, or enables GitHub auto-merge when the only
remaining wait is CI.

Which merge path is live is `orchestration/models.json` `mergeQueue`. When it is true, the
cycle enqueues with `gh pr merge --auto --match-head-commit` and never runs
`gh pr update-branch`: GitHub's merge queue tests each PR on top of those ahead of it. When
it is false, one BEHIND pull request is refreshed per cycle (MARXY-106). Flip the flag to
switch. GitHub's merge queue is only available on **organization-owned** repositories; a
User-owned repo keeps `mergeQueue` false even though `ci.yml` listens for `merge_group`.
The ruleset that enables the queue is a repository setting on the org repo, not this flag.

A PR is mergeable when every clause of this bar holds. `orchestration/merge-bar.mjs` is the
list; a missing clause is the printed hold reason.

1. The PR is open, mergeable, and not in conflict.
2. The branch diff against `main` could be computed (an empty list is ignorance, not innocence).
3. No attribution trailer in any commit on the branch.
4. Every CI check has a conclusion; none are red. Pending checks alone enable auto-merge
   rather than a hold, once the rest of the bar is green.
5. GitHub has not requested changes, and CODEOWNERS has not set `REVIEW_REQUIRED`.
6. No file outside the story's `Paths` (plus `CHANGELOG.md`, the taste queue, the lockfile
   and the result file). The row is the one the branch leaves when it edits only its own story's
   board entries, so an out-of-plan PR's row and a story's widened `Paths` count; a branch that
   edits another story's row is held and names whose, and a PR with no row on `main` or on its
   branch is held with the command that adds one (`scripts/lib/own-row.mjs`, which CI's
   `check-story` also uses).
7. The implementor result file exists and says `done` — in this checkout's
   `orchestration/results/`, or in the worktree that has the branch checked out.
8. `CHANGELOG.md` is in the diff.
9. A signed `results/KEY.approved` verifies against this PR head.

Every approval run ends with `node orchestration/readiness.mjs`: one row per open pull request, in the review/merge order, with CI, mergeability, approval, who it waits on, and what happens next.

## Work outside the plan — one pull request

Anything that is not a planned story — a fix found in passing, a tooling change, a planner's
landing PR — is still **one issue, one branch, one PR**, and it lands through the same cycle and
the same bar as a story. It used to take up to three PRs and a hand merge: a bare Jira Task had
no board row, so the cycle could not see its PR, `state.mjs` refused the key, the merge bar had
no paths to judge it by, and a placeholder key or a path widening each needed a PR of its own.
Now the change carries its own row.

```sh
node orchestration/out-of-plan.mjs start "Fix the thing" --type fix \
  --paths "orchestration/thing.mjs, orchestration/thing.test.mjs" \
  --acceptance "1. thing.test.mjs covers the case; 2. …"   # Jira Task + ../marxy-wt/KEY + its own row
# …work in ../marxy-wt/KEY; a CHANGELOG line ending (KEY); commit subjects end in (KEY)
pnpm done KEY                    # boundary (strict), precheck, drafts results/KEY.pr.md
pnpm done KEY --open             # pushes, opens the PR, links it in Jira
```

- **The row travels in the PR.** `out-of-plan.mjs` writes the key's CSV row
  (`ops,out-of-plan,no-dispatch`, or `phase-N,…` with `--phase`) and its `deps.json` entry in the
  branch; `no-dispatch` keeps an implementor off work that is already being done. A branch that
  already exists gets its row with `out-of-plan.mjs row KEY --paths … --acceptance …`.
- **The cycle adopts and lands it** (merge bar clause 6): no hand merge, no `state.mjs` call.
- **A story may widen its own `Paths` in its own PR**, where the review packet and the cycle say
  so out loud; implementors still report `blocked` instead.
- **Placeholders never reach `main`.** A planner drafts new rows as `MARXY-NEW-<slug>` and runs
  `node orchestration/jira.mjs sync --new` in its own worktree before opening the PR: it creates
  the issues, rewrites every placeholder to its real key and renames the task cards.
  `check-cards` fails any placeholder left on a branch. If the PR is abandoned, close the issues
  it created.

## Review order and the review WIP limit

Review, not implementation, is the constraint. The printable order is computed by
`orchestration/review-order.mjs` (ADR-0025), so a stalled queue can always be explained. Three
keys, in this order:

1. **Phase**, from `orchestration/deps.json`, lowest number first. The plan is sequenced to
   de-risk in phase order; reading a later-phase pull request first would invert it. The `ops`
   lane is not a phase and ranks after every numbered one — product is reviewed first
   (MARXY-107). An adopted PR whose row is still only on its branch takes the lane its branch's
   `deps.json` names.
2. **Disturbance**, descending — the number of other open pull requests whose changed files
   intersect this one's (always-shared files excluded). The branch that will invalidate the
   most approvals must land before those approvals are signed, not after. Merge effort is not
   the cost; the signatures a merge destroys are.
3. **Age**, oldest first, so nothing starves.

A conflicted pull request is returned rather than queued. `cycle.mjs` cannot resolve a conflict
and a reviewer reading a conflicted tree is reading nothing. The story goes back to In Progress
and `attempts` does not move: a conflict is a consequence of queue depth, not a failed attempt.

A returned story does not count against the review WIP. Returning it moves it out of In Review,
so the lane is freed by construction, and a return is the same unit of work rather than a new
one. Charging it twice would make returning a story more expensive than abandoning it.

A returned story re-enters the order at its own phase, disturbance and original age, not at the
head, so it cannot starve by being returned.

## Cadence

| When | What |
| --- | --- |
| every cycle | `needs-human.md` read, board pushed, status report written |
| every 5 merges, any second failure, weekly, or a phase boundary | the planner runs (`planner-trigger.mjs` decides). Only "never planned" or an unread escalation holds dispatch meanwhile; the others just name it due (MARXY-200). When `cursor-agent` is on PATH, the cycle starts the planner headlessly like implementors; otherwise it only names it due. A merge whose diff adds under `docs/plan/deltas/` self-records (`lastPlan` / `mergesAtLastPlan` via `state.mjs plan-landed`) — nobody runs `state.mjs planned` by hand after a plan PR lands |
| end of each phase | taste review from `docs/taste-review/queue.md`, then the release |
| never | a status meeting, an estimate, a burndown chart |

## Release runbook

A phase ends in a release. There is no release branch; `main` is always releasable.

1. Phase's stories all Done, taste review closed, budgets green.
2. On reference hardware, before the tag: `MARXY_PERF_ENV=reference` so
   `scripts/measure-startup.mjs` writes `results/perf.json`, then `pnpm gate:perf`. Attach that
   artifact to the tag. The record must carry `cold_launches_n` of at least 5 and a non-empty
   `cold_procedure`. **A tag states no cold-start duration.** CI only ever proves a runner did
   not get slower; this is the measurement a release carries, not a ceiling it claims
   (ADR-0022 Amendment 2).

   The cold-making step — which the script runs before each of the k launches, and which a
   person can follow by hand — is: kill any running Marxy process; purge the OS file cache
   only where a password-less mechanism exists on that platform (`sudo -n sysctl -w
   vm.drop_caches=3` on Linux, `sudo -n purge` on macOS); leave enough idle for the step to
   take effect; then launch. If the cache cannot be purged without a password, the procedure
   is `process-cold only` and must be recorded as such rather than as a cache-cold start.
3. `CHANGELOG.md`: move `Unreleased` into a version heading with the date (Keep a Changelog).
4. `git tag v0.2.0 && git push --tags` — the release workflow builds the DMG, AppImage and .deb.
5. Install each artifact and open `fixtures/corpus/02-readme-real-world.md`. This is manual on
   purpose: it is the one thing CI cannot tell you.
6. `node orchestration/jira.mjs release 2 v0.2.0` — creates the Jira version, releases it, and
   stamps the phase's issues with it.

## Local setup, once

```sh
git config core.hooksPath .githooks   # strips the attribution trailers agent tooling injects
```

Everything else comes from `mise.toml`. There is no other machine-specific setup.

## Credentials

`orchestration/jira.mjs` reads `~/.config/marxy/jira.env` (`JIRA_BASE_URL`, `JIRA_EMAIL`,
`JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`), never anything in the repo, and `*.env` is gitignored.
Without credentials it exits 3 and says what to do, so the loop degrades to a printed
instruction rather than a silent no-op. No CI job needs the token: nothing in a gate talks
to Jira.
