---
key: MARXY-178
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-178]
---
# MARXY-178 — Land the MARXY-47 split on main

**Depends on:** nothing · **Delta:** [2026-09-21-marxy-47-split](../deltas/2026-09-21-marxy-47-split.md) ·
**Reference:** MARXY-176, MARXY-168 (37-split landing shape).

**Outcome.** Main carries a narrowed MARXY-47 row, MARXY-177 (shell follow-on), updated
`orchestration/deps.json` edges (MARXY-45 → MARXY-177), and task cards that match. PR #164 can split
into two product PRs without editing its own board row.

## Files — commit exactly these
- `docs/plan/deltas/2026-09-21-marxy-47-split.md`
- `docs/plan/jira-issues.csv` — MARXY-47 narrowed; MARXY-177 added; this landing row
- `orchestration/deps.json` — phase-3 MARXY-177, MARXY-47 deps trimmed, MARXY-45 edge moved
- `orchestration/jira-map.json` — placeholder→key entries for MARXY-177
- `docs/plan/tasks/MARXY-47.md` — package-only card
- `docs/plan/tasks/MARXY-177.md` — shell card
- `docs/plan/tasks/MARXY-45.md` — depends frontmatter → MARXY-177
- `docs/plan/tasks/MARXY-178.md` — this card
- `CHANGELOG.md` — one line

## Do this, in order
1. Branch off `origin/main` in a dedicated worktree (not the orchestrator checkout).
2. `node orchestration/jira.mjs sync` after CSV + map edits (creates MARXY-177 in Jira, rewrites keys).
3. `node scripts/check-deps.mjs`, `node scripts/check-cards.mjs`,
   `node --test orchestration/phases.test.mjs`, `node scripts/check-story.mjs --strict --key MARXY-178`.
4. `pnpm done MARXY-178`, fill acceptance, open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `orchestration/phases.test.mjs` | green; MARXY-178 in ops only |
| `scripts/check-deps.mjs` | green |
| `scripts/check-cards.mjs` | green |
| `scripts/check-story.mjs --strict --key MARXY-178` | green |
| MARXY-47 / MARXY-177 `Paths` | no `docs/plan/jira-issues.csv` |

## Acceptance → check
The eight criteria on the CSV row.

## Do not
Touch `orchestration/state.json`. Edit anything under `packages/` or `apps/`. Merge or push to PR #164 from
this branch.
