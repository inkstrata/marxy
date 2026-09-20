---
key: MARXY-NEW-katex-fonts-land
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-NEW-katex-fonts-land]
---
# Land the KaTeX font-bundle follow-up story on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-20-katex-fonts.md`, same shape as
MARXY-158 and MARXY-154.

**Outcome.** The planner's board edits for **`MARXY-NEW-katex-fonts`** are on `main` in one commit
that touches no source file, so the implementor can cherry-pick **`a07bb6f`** without editing its
own CSV row.

## Files
- `docs/plan/jira-issues.csv` — new row `MARXY-NEW-katex-fonts` and this landing row.
- `orchestration/deps.json` — `MARXY-NEW-katex-fonts` in phase `1` with `[]` deps; landing key in `ops` with `[]`.
- `orchestration/jira-map.json` — placeholder→key entries (placeholders remain until `jira.mjs sync`).
- `docs/plan/deltas/2026-09-20-katex-fonts.md`
- `docs/plan/tasks/MARXY-NEW-katex-fonts.md` and this card.

## Do this, in order
1. Branch already `chore/MARXY-NEW-katex-fonts-land` from planner worktree.
2. Stage the files above, both CSV rows, `CHANGELOG.md`, `jira-map.json`.
3. `node scripts/check-deps.mjs`, `node --test orchestration/phases.test.mjs`.
4. `pnpm precheck`, then `pnpm done MARXY-NEW-katex-fonts-land` (or real key if sync ran).

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-deps.mjs` | green |
| `node --test orchestration/phases.test.mjs` | green |
| diff scope | no files under `packages/`, `apps/`, `scripts/`, `.github/`, `fixtures/` |

## Acceptance → check
The landing row's criteria in the CSV, in order.

## Do not
Cherry-pick **`a07bb6f`** or change product source in this PR. Edit MARXY-28's row. Touch `orchestration/state.json`.
