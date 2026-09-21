---
key: MARXY-176
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-176]
---
# MARXY-176 — Align MARXY-46/47 board rows with task cards (paths only)

**Depends on:** nothing · **Delta:** [2026-09-21-marxy-46-47-paths](../deltas/2026-09-21-marxy-46-47-paths.md) ·
**Reference:** MARXY-152, MARXY-158 (board landing shape).

**Outcome.** `origin/main`'s MARXY-46 and MARXY-47 rows match their task cards and cover the diffs on
PR #163 and #164, without either product story listing `docs/plan/jira-issues.csv` in `Paths`. After
this merges, restack #163 and #164 and drop their CSV hunks so `orchestration/review.mjs` can clear
the merge-bar.

## Files — commit exactly these
- `docs/plan/deltas/2026-09-21-marxy-46-47-paths.md`
- `docs/plan/jira-issues.csv` — MARXY-46 and MARXY-47 `Summary`, `Paths` and `Acceptance` as the
  planner wrote them; new MARXY-176 row.
- `orchestration/deps.json` — MARXY-176 in the ops lane, empty deps.
- `orchestration/jira-map.json` — placeholder→key entry for MARXY-176.
- `docs/plan/tasks/MARXY-176.md` — this card.
- `CHANGELOG.md` — one line.

## Do this, in order
1. Branch `chore/MARXY-176-align-46-47-board-rows` off `origin/main` (worktree).
2. `node scripts/check-deps.mjs`, `node --test orchestration/phases.test.mjs`,
   `node scripts/check-story.mjs --strict --key MARXY-176`.
3. Run the boundary one-liner from criterion 5; paste output in the PR.
4. `pnpm done MARXY-176`, fill acceptance, open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `orchestration/phases.test.mjs` | green; MARXY-176 in ops only |
| `scripts/check-deps.mjs` | green |
| `scripts/check-story.mjs --strict --key MARXY-176` | green |
| MARXY-46 / MARXY-47 `Paths` | no `docs/plan/jira-issues.csv` |
| boundary one-liner | `allowedByPaths` true for representative #163/#164 files |

## Acceptance → check
The nine criteria on the CSV row.

## Do not
Touch `orchestration/state.json`. Edit anything under `packages/` or `apps/`. Change MARXY-46 or
MARXY-47 dependency edges. Merge or push to PR #163 or #164 from this branch.
