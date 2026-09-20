---
key: MARXY-144
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-144]
---
# MARXY-144 — land the MARXY-137 path widening and the CLS-window story on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-19-marxy-137-headless.md`, and
MARXY-131, MARXY-135 and MARXY-140 for the same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-137's widened paths and the new MARXY-143 row. Neither story can
start until this lands, and PR #104 must not be returned to its implementor before it does.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the boundary
check's input is indistinguishable from one that found its paths inconvenient (that is why PR #87
was returned). The planner writes the edits into the working tree; a landing story commits them.

## Files
- `docs/plan/jira-issues.csv` — MARXY-137's `Paths` gain `apps/desktop/src/render/headless.ts`, its
  criterion 4 is rewritten and a criterion 8 added; `MARXY-143` and `MARXY-144` are new rows.
- `orchestration/deps.json` — `MARXY-143` and `MARXY-144` placed in the `ops` lane; `MARXY-137`
  gains a dependency on `MARXY-143`; `MARXY-143` depends on `MARXY-25`.
- `orchestration/jira-map.json` — the two placeholder→key entries, already written by
  `jira.mjs sync` (`MARXY-NEW-cls-window → MARXY-143`, `MARXY-NEW-land-137-cls-plan → MARXY-144`).
- `docs/plan/deltas/2026-09-19-marxy-137-headless.md` — the delta behind both changes.
- `docs/plan/tasks/` — `MARXY-143.md`, `MARXY-144.md` and the rewritten `MARXY-137.md`.

`node orchestration/jira.mjs sync` has already run, so the placeholders are already real keys in
the CSV, in `deps.json` and in `jira-map.json`. Carry what is in the working tree; do not re-slug or
renumber anything.

## Do this, in order
1. Branch `chore/MARXY-144-land-the-137-and-cls-plan` off `main`.
2. Stage exactly the files above plus `CHANGELOG.md`. Check `git status` first: the tree carries
   unrelated edits under `orchestration/` belonging to other stories — leave every one alone.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`,
   `node orchestration/phases.test.mjs` whole-file.
4. Paste the boundary one-liner from criterion 5 and its output into the PR body.
5. `pnpm precheck`, then `pnpm done MARXY-144`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures |
| `node orchestration/phases.test.mjs` (whole file) | green — MARXY-142 landed, so plan text is not budgeted |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green |
| the boundary one-liner | `allowedByPaths` true for `apps/desktop/src/render/headless.ts` under MARXY-137 |
| the diff | nothing under `packages/`, `apps/`, `scripts/`, `.github/` or `fixtures/`; no change to `orchestration/state.json` or `orchestration/phases.test.mjs` |

## Acceptance → check
The row's nine criteria in order: 1 and 2 are the board files with the committed-board test and
`check-deps.mjs`, 3 is the cards with `check-story.mjs --strict`, 4 is `jira-map.json`, 5 is the
boundary one-liner, 6 and 7 are the diff, 8 is the whole-file phases run, 9 is `CHANGELOG.md`.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is
wrong, say so in the PR and stop; the planner corrects it, not you. Add a row. Touch
`orchestration/state.json` (untracked by design) or `orchestration/phases.test.mjs`. Edit any file
under `packages/`, `apps/`, `scripts/` or `fixtures/`. Start MARXY-137's or MARXY-143's work in this
branch. Close, reopen or push to PR #104 or PR #95.
