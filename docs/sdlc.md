# SDLC — how one developer and a fleet of agents ship marxy

One person owns this project and cannot be the bottleneck for everything, so the process is
built around two ideas: **Jira holds the truth about state, git holds the truth about code**,
and **anything a machine can check is never checked by a person**. Everything below is the
smallest process that still gives traceability, and nothing in it exists to produce a report.

## The board

Jira project **MARXY** at <https://marxy.atlassian.net>. Every epic and story in
`docs/plan/jira-issues.csv` exists there as an issue; the CSV stays the machine-readable
spec (acceptance criteria and allowed paths, which scripts parse) and Jira owns status,
history and the human view.

| State | Means | Who moves it |
| --- | --- | --- |
| **To Do** | ready, or waiting on a dependency; a `blocked` or `escalated` label says which | the orchestrator, via `state.mjs` |
| **In Progress** | an implementor is in a worktree on it, or Ian is | `state.mjs start KEY` |
| **In Review** | a PR exists and the gates have run | the orchestrator, after the PR is open |
| **Done** | squash-merged into `main` | `state.mjs done KEY` |

Lanes are capped at 3 (`orchestration/models.json`). Dispatch starts ready stories whose
paths do not overlap work already in flight.

Keys are Jira keys (`MARXY-23`), everywhere: branch, commit subject, PR title, result file.

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
  can paint and does not paint never skips. CI (`GITHUB_ACTIONS` running the desktop `build`
  lifecycle) and `MARXY_SMOKE_REQUIRED=1` never skip.
- **`pnpm typecheck` may never skip.**
- **`pnpm lint` may never skip.**
- **`pnpm test`** may skip only the same desktop CLI smoke, and only on the same frameless
  grounds or when no release binary has been built yet. Unit tests never skip.

Do not delete the frames assertion to make a sleeping laptop green. Wake the display, or
accept the named skip. `pnpm --filter @marxy/desktop verify:cli` is the hand-reachable
required mode.

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
node orchestration/state.mjs start MARXY-23  # → In Progress
node orchestration/dispatch.mjs MARXY-23     # implementor in its own worktree
node orchestration/review.mjs MARXY-23       # the review packet: acceptance, boundaries, gates
gh pr merge 41 --squash --delete-branch
node orchestration/state.mjs done MARXY-23   # → Done
node orchestration/planner-trigger.mjs       # is it time to re-plan?
```

Everything in that list except the two judgements — is this story ready, does this diff satisfy
it — is one command, `node orchestration/cycle.mjs`, and `./orchestration/loop.sh` runs it until
interrupted.

## Cadence

| When | What |
| --- | --- |
| every cycle | `needs-human.md` read, board pushed, status report written |
| every 5 merges, any second failure, weekly, or a phase boundary | the planner runs (`planner-trigger.mjs` decides) |
| end of each phase | taste review from `docs/taste-review/queue.md`, then the release |
| never | a status meeting, an estimate, a burndown chart |

## Release runbook

A phase ends in a release. There is no release branch; `main` is always releasable.

1. Phase's stories all Done, taste review closed, budgets green.
2. `MARXY_PERF_ENV=reference pnpm gate:perf` green **on reference hardware**, before the tag. CI
   only ever proves a runner did not get slower; this is the step where the product budgets in
   ADR-0013 are actually enforced (ADR-0022).
3. `CHANGELOG.md`: move `Unreleased` into a version heading with the date (Keep a Changelog).
4. `git tag v0.2.0 && git push --tags` — the release workflow builds the DMG, AppImage and .deb.
5. Install each artifact and open `fixtures/corpus/02-readme-real-world.md`. This is manual on
   purpose: it is the one thing CI cannot tell you.

## Local setup, once

```sh
git config core.hooksPath .githooks   # strips the attribution trailers agent tooling injects
```

Everything else comes from `mise.toml`. There is no other machine-specific setup.
