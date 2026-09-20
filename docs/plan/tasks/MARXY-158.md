---
key: MARXY-158
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-158]
---
# land the MARXY-27 and MARXY-126 path widenings on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-20-marxy-27-126-paths.md`, and
MARXY-131, MARXY-135, MARXY-140, MARXY-144, MARXY-146, MARXY-148, MARXY-152 and MARXY-154 for the
same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` sees MARXY-27's widened `Paths` cell (including
`packages/core/package.json`) and MARXY-126's widened `Paths` cell (including
`orchestration/deps.json`). PR #124 can drop its self-widening CSV hunk and stay open; MARXY-126's
implementor can edit `orchestration/deps.json` when restoring MARXY-76's row.

## Why a story at all
No story may edit its own board row. PR #124 widened MARXY-27's row inside the product commit; the
review returned it for that boundary miss, not for the Shiki dependency. MARXY-126's card already
required `orchestration/deps.json` for problem class 1 (MARXY-76) but the row did not list that
file until the planner pass. This landing story commits both widenings plus its own row.

## Files
- `docs/plan/jira-issues.csv` — MARXY-27's `Paths` cell gains `packages/core/package.json`;
  MARXY-126's `Paths` cell gains `orchestration/deps.json`; both `Description` cells record why
  and point at the delta. Neither widened row's `Paths` cell contains `docs/plan/jira-issues.csv`.
- `orchestration/deps.json` — this landing key in the `ops` lane with no deps. MARXY-27's and
  MARXY-126's own dependency lists are untouched.
- `orchestration/jira-map.json` — the placeholder→key entry for this landing key.
- `docs/plan/deltas/2026-09-20-marxy-27-126-paths.md` — the delta behind the change.
- `docs/plan/tasks/MARXY-126.md` — revised card naming `orchestration/deps.json` and the MARXY-76
  case (already in the planner commit on this branch).

## Do this, in order
1. Branch `plan/2026-09-20-marxy-27-126-paths` (already checked out in `../marxy-planner-27-paths`).
2. Stage the files above plus this card, the MARXY-158 CSV row, `CHANGELOG.md`, and `jira-map.json`.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`,
   `node orchestration/phases.test.mjs` whole-file.
4. Paste the boundary one-liners from criterion 5 and their outputs into the PR body.
5. `pnpm precheck`, then `pnpm done MARXY-158`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures |
| `node orchestration/phases.test.mjs` (whole file) | green |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green |
| boundary one-liners | `allowedByPaths` true for `packages/core/package.json` under MARXY-27 and for `orchestration/deps.json` under MARXY-126 |
| the diff | nothing under `packages/`, `apps/`, `scripts/`, `.github/` or `fixtures/`; no change to `orchestration/state.json` or `orchestration/phases.test.mjs` |

## Acceptance → check
The row's nine criteria in order: 1 is the two widened CSV cells, 2 is `deps.json` and phase tests,
3 is the delta, MARXY-126 card and `check-story.mjs --strict`, 4 is `jira-map.json`, 5 is the
boundary one-liners, 6 and 7 are the diff scope, 8 is the whole-file phases run, 9 is
`CHANGELOG.md`.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote on MARXY-27 or
MARXY-126 — if one is wrong, say so in the PR and stop. Start MARXY-27 attempt 2, MARXY-126's
check-cards work, or close PR #124. Touch `orchestration/state.json`.
