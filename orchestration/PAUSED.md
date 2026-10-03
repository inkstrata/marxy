# The fleet is paused

The fleet has been paused since 2026-09-29, under ADR-0051 (proposed). Do not start it by habit.

## Why

In fourteen days the fleet landed 278 pull requests, 170 of them about the fleet, its gates or its
documents rather than the reader's screen. In its last 59 hours of recorded runs it ran 139
conflict-resolution runs against 86 implementation runs, parked 19 stories as unresolvable, and
grew its human queue from 9 items to 30
(`docs/research/audit-2026-10/13-recommendation-orchestrator.md` section 1).

## What not to run

- `orchestration/loop.sh` (any subcommand) and `orchestration/cycle.mjs`
- the planner
- `orchestration/jira.mjs push` and `orchestration/jira.mjs sync`

The Jira project MARXY is a historical record. Nothing mirrors to it and nothing writes to it.

## Where the work is planned now

`docs/plan/roadmap-2026-10/`. Work needs no Jira key, no board row and no enforced pull-request
body; a commit subject may end in `(A-nn)`, in `(MARXY-n)`, or in nothing. The files in this
directory are frozen, not deleted. The tests that cover them run as `pnpm test:fleet`.

## The five conditions for resuming

All five must hold (`13-recommendation-orchestrator.md` section 4).

1. **Seams.** Fewer than a quarter of the last 20 product PRs touch any of the five most-edited
   product files. Check: `git log -20 --format=%h --name-only -- packages apps` against the hub list.
2. **No shared append-only files on the PR path.** Check:
   `git log --since=7.days --name-only | grep -c -E 'jira-issues.csv|deps.json|^CHANGELOG.md'` is 0.
3. **A ready backlog** of at least 15 stories with disjoint paths, machine-checkable acceptance and
   no dependency on a proposed ADR, written or read by the author. Check:
   `node orchestration/ready.mjs` once the loop code is unfrozen.
4. **`main` green for seven consecutive days** under hand development, with no revert. Check:
   `gh run list --branch main --workflow ci --limit 50 --json conclusion,createdAt`.
5. **A pruned PR path.** The conventions job is no longer the most frequent red, and orchestration
   tests run only when `orchestration/` changes. Check:
   `gh run list --workflow ci --json conclusion,jobs` over 50 runs.

## The pilot shape and stop rules

Resume as a pilot, not a switch: `reviewLanes` 2; at most five stories in flight; the planner off
(the author plans); the reviewer at least `default` mode's Sonnet and ideally Opus; implementors on
whatever is cheap.

Stop again if, over three days, resolution runs exceed implementation runs, any story is parked
after three resolutions, or **Needs you** stays above ten for a day.
