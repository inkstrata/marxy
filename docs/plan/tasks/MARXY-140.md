---
key: MARXY-140
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-140]
---
# MARXY-140 — land the MARXY-26 split on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-19-marxy-26-split.md`, and MARXY-131 and MARXY-135 for the same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-26's narrowed paths and the three new rows. Nothing else can start until
this lands.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the boundary
check's input is indistinguishable from one that found its paths inconvenient, and two doing it in
parallel leave the occupancy rule meaning nothing (that is exactly why PR #87 was returned). The planner
writes the edits into the working tree; a landing story commits them.

## Files
- `docs/plan/jira-issues.csv` — MARXY-26 rewritten; `MARXY-137`, `MARXY-138`, `MARXY-139`, `MARXY-140`
  and `MARXY-141` added.
- `orchestration/deps.json` — the five new keys placed in a phase, and the dependency edits in the delta's
  table (MARXY-26, MARXY-31, MARXY-44, MARXY-47, MARXY-128, MARXY-129).
- `docs/plan/deltas/2026-09-19-marxy-26-split.md`.
- `docs/plan/tasks/` — the four new cards and the rewritten `MARXY-26.md`.

`node orchestration/jira.mjs sync` has already run, so the placeholders are already real keys —
MARXY-137 through MARXY-141 — in the CSV, in `deps.json`, in the delta and in the card filenames. Carry whatever is in the working tree; do not re-slug or renumber anything.

## Do this, in order
1. Branch `chore/MARXY-140-land-the-marxy-26-split`.
2. Stage exactly the files above plus `CHANGELOG.md`. Nothing else — check `git status` before you commit.
3. `node orchestration/phases.test.mjs`, `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`.
4. `pnpm precheck`, then `pnpm done MARXY-140`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node orchestration/phases.test.mjs` | green: every CSV story in exactly one phase; no story depends on a later numbered phase |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green; no file outside the listed paths |
| the diff | no file under `packages/`, `apps/`, `scripts/` or `.github/`; no change to `orchestration/state.json` |
| MARXY-26's `Paths` cell | `packages/core/src/render` and nothing else |

## Acceptance → check
The row's five criteria in order: 1 and 2 are the board files with `phases.test.mjs` and `check-deps.mjs`,
3 is the cards with `check-story.mjs --strict`, 4 is the boundary check, 5 is the `CHANGELOG.md` line.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is wrong, say so
in the PR and stop; the planner corrects it, not you. Add a row. Touch `orchestration/state.json` (it is
untracked by design). Edit any file under `packages/` or `apps/`. Start MARXY-26's rework in this branch.
