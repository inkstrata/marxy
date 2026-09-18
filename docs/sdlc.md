# SDLC — how one developer and a fleet of agents ship marxy

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
| **In Progress** | an implementor is in a worktree on it, or Ian is | `state.mjs start KEY` |
| **In Review** | a PR exists and the gates have run | `jira.mjs pr KEY <number>` |
| **Done** | squash-merged into `main` | `state.mjs done KEY` |

**WIP limit 3** — the dispatch lane count in `orchestration/models.json`. It is a limit on
lanes, not ambition: three stories in flight is what one reviewer can hold in their head, and
`ready.mjs` will not hand out a fourth.

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
node orchestration/ready.mjs                 # what may start, respecting deps, paths, lanes
node orchestration/state.mjs start MARXY-23  # → In Progress, mirrored to Jira
node orchestration/dispatch.mjs MARXY-23     # implementor in its own worktree
node orchestration/review.mjs MARXY-23       # the review packet: acceptance, boundaries, gates
node orchestration/jira.mjs pr MARXY-23 41   # link the PR, → In Review
gh pr merge 41 --squash --delete-branch
node orchestration/state.mjs done MARXY-23   # → Done, mirrored to Jira
node orchestration/planner-trigger.mjs       # is it time to re-plan?
```

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
2. `CHANGELOG.md`: move `Unreleased` into a version heading with the date (Keep a Changelog).
3. `git tag v0.2.0 && git push --tags` — the release workflow builds the DMG, AppImage and .deb.
4. Install each artifact and open `fixtures/corpus/02-readme-real-world.md`. This is manual on
   purpose: it is the one thing CI cannot tell you.
5. `node orchestration/jira.mjs release 2 v0.2.0` — creates the Jira version, releases it, and
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
