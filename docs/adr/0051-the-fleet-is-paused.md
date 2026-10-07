# ADR-0051 — The fleet is paused, and the process it needs is paused with it

- **Status:** accepted (author, 2026-10-02)
- **Date:** 2026-10-02
- **Suspends, does not repeal:** the mechanisms of ADR-0017 (one issue, one branch, one PR, one owner,
  as an enforced rule), ADR-0025 (review order and review WIP), ADR-0034 (the reconciler), ADR-0040
  (land without up to date, the main guard) and ADR-0043 (revert first). ADR-0028 (CODEOWNERS is a floor)
  and ADR-0042 (plan rows per story) are untouched.
- **Evidence:** `docs/research/audit-2026-10/13-recommendation-orchestrator.md` §3 and §4, with
  `02-orchestrator-audit.md` and `03-fleet-metrics.md`.

## Context

The fleet landed 278 pull requests in fourteen days, 170 of them about the fleet, its gates or its
documents. In its last 59 hours of recorded runs it ran 139 conflict-resolution runs against 86
implementation runs, parked 19 stories as unresolvable, and grew its human queue from 9 items to 30.
The loop has been stopped since 2026-09-29 and later pull requests were landed by hand. None of
that is a reason to delete the orchestrator. It is a reason not to run it on this codebase, at this
model tier, now, and not to keep paying for the process that feeds it.

Those ADRs bind a person exactly as hard as an agent: a branch with no `MARXY-nnn` key and no board
row fails `scripts/check-story.mjs --strict`, a PR body is checked by `scripts/check-pr.mjs`, and
`pnpm done` drafts a result file. Work is now done by one author directing Claude subagents, each in
its own worktree, one story per agent, reviewed by an Opus agent and merged by the author.

## Decision

1. **The fleet is paused.** `orchestration/` is frozen, untouched, with a `PAUSED.md` at its root
   (`orchestration/PAUSED.md`) naming this ADR and the resume conditions. The loop
   (`orchestration/loop.sh`) and the planner (`orchestration/planner-trigger.mjs`) are not run. The
   Jira mirror (`orchestration/jira.mjs push` and `sync`) is not run; Jira stays a historical record.
2. **The five ADRs' mechanisms are suspended.** Their text stays, readable against living code, and
   ADRs are append-only: this ADR, not an edit to theirs, is the current word.
3. **These stop being required**, on the pull-request path and in practice:
   - a board row and a `MARXY-nnn` key in a branch name (`scripts/check-story.mjs --strict` leaves
     the `conventions` job in `.github/workflows/ci.yml`, or warns; the script stays);
   - the enforced PR body (`scripts/check-pr.mjs` section order and sentence counts; the template
     stays as a suggestion, and `check-pr` leaves CI);
   - result files and signed agent approvals (`pnpm done`'s `results/`, `orchestration/merge-bar.mjs`
     is not consulted by GitHub);
   - task cards (`docs/plan/tasks/`) and plan deltas as the only way into work;
   - `orchestration/out-of-plan.mjs start` as the only entry point.
4. **These stay.** Trunk-based development on a feature branch; squash merges; Conventional Commits
   (the hook is cheap); one changelog fragment per change (`changelog.d/`); CODEOWNERS on the
   security paths (ADR-0028); the product gates. A Jira key in a subject is welcome when a story has one.
5. **The orchestrator's 440 tests leave `pnpm test`.** `node --test orchestration/*.test.mjs
   orchestration/test/*.test.mjs` becomes `pnpm test:fleet`, run by CI only when `orchestration/`
   changes and in the nightly workflow. Tests that defend documents' shape, not the product
   (`orchestration/docs.test.mjs`), go when their documents' PR-path presence does.
6. **Resume only when all five hold**, each checkable by a command:
   1. Seams: fewer than a quarter of the last 20 product PRs touch any of the five most-edited
      product files (`git log -20 --format=%h --name-only -- packages apps`).
   2. No shared append-only file on the PR path: `git log --since=7.days --name-only` shows no
      `docs/plan/jira-issues.csv`, `orchestration/deps.json` or root `CHANGELOG.md`.
   3. A ready backlog of at least 15 stories with disjoint paths and machine-checkable acceptance,
      none depending on a proposed ADR (`node orchestration/ready.mjs` once unfrozen).
   4. `main` green for seven consecutive days under hand development, with no revert.
   5. A pruned PR path: the `conventions` job is no longer the most frequent red, and orchestration
      tests run only when `orchestration/` changes.
7. **Resume as a pilot, not a switch.** `reviewLanes` 2; at most five stories in flight; the planner
   off (the author plans); the reviewer at least Sonnet and ideally Opus; implementors on whatever is
   cheap. Stop again if, over three days, resolution runs exceed implementation runs, any story is
   parked after three resolutions, or **Needs you** stays above ten for a day.
8. **Deleted now:** `orchestration/canvases.mjs` if the author no longer uses Cursor canvases, and
   `orchestration/state.json` or `orchestration/results/` if still tracked. Nothing else yet.

## Consequences

- A branch without a key and a PR body in the author's own words can merge. The audit's own work
  needed a Jira issue, a CSV row and a `deps.json` entry before a word was written; that stops.
- `AGENTS.md` and `docs/ci-contract.md` lose rows, and `AGENTS.md` says the fleet is paused and the
  "three commands" are optional.
- Frozen code costs a directory and no maintenance. Deleting it is cheaper later, with evidence.
- `docs/adr/0034-the-fleet-is-a-reconciler.md` is read by `orchestration/docs.test.mjs`; changing
  its status line is a coordinated edit with that test.

## Rejected

- **Delete `orchestration/`.** Git keeps it, but a frozen directory keeps the ADRs readable and
  makes resumption a decision rather than a rebuild.
- **Keep the process, drop the loop.** It binds a person as hard as an agent, for an agent that
  is not running.
- **Switch the loop to a stronger model and resume.** Models were not the failure; contention was.

## How we would know this was wrong

1. Hand development produces the same contention the fleet did: two subagents editing one hub
   file in one week. That is the seams condition failing, not the pause.
2. The five conditions hold for a month and nobody resumes: delete the code.
