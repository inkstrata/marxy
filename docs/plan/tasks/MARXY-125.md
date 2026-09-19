---
key: MARXY-125
design: []
depends: []
verify: [node --test orchestration/phases.test.mjs, node --test orchestration/test, node orchestration/ready.mjs]
---
# MARXY-125 — Land the after-65 plan on main

**Depends on:** nothing · **ADRs:** none · **Delta:** [2026-09-19-after-65](../deltas/2026-09-19-after-65.md).

**Outcome.** The board spec the 2026-09-19 after-65 pass wrote is on `main`, so implementors cutting a
worktree from `main` can start MARXY-93 and MARXY-95. `scripts/check-story.mjs` reads the CSV as it
exists on `main`, which is why those two cannot start before this merges — the same reason MARXY-111
existed for the after-8 pass.

## Files — commit exactly these, unchanged
- `docs/plan/deltas/2026-09-19-after-65.md` — the delta.
- `docs/plan/jira-issues.csv` — rows restored for MARXY-93, 94, 95, 96, 97, 98; the dropped row for
  MARXY-115; new rows MARXY-125 and MARXY-126; MARXY-120 and MARXY-119 edited; `CHANGELOG.md` removed
  from `Paths` on MARXY-70, 78, 83, 84, 117, 118, 119, 121, 122.
- `orchestration/deps.json` — MARXY-95 loses its MARXY-94 edge; MARXY-115, 125 and 126 join the `ops`
  phase; deps for 125 and 126.
- `orchestration/jira-map.json` — the two keys `jira.mjs sync` assigned (MARXY-125, MARXY-126).
- `docs/plan/tasks/MARXY-93.md`, `MARXY-95.md`, `MARXY-120.md`, `MARXY-125.md`, `MARXY-126.md`.
- `CHANGELOG.md` — one line.

## Do this, in order
1. Branch `chore/MARXY-125-land-the-after-65-plan` off `main`. The files are already in the
   orchestrator's working tree; do not rewrite their content, and do not re-run `jira.mjs sync` (it ran
   in the planning pass and resolved the two placeholder keys).
2. `node --test orchestration/phases.test.mjs` and `node --test orchestration/test`.
3. `node orchestration/ready.mjs` and paste the output in the PR.
4. `pnpm done MARXY-125`, fill the acceptance table, open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `orchestration/phases.test.mjs` | 11 pass; every CSV story in exactly one phase; no dependency on a later numbered phase |
| `orchestration/test` | passes unchanged |
| `ready.mjs` | offers MARXY-93 and MARXY-95; excludes MARXY-94 with `human-gated`; MARXY-115 appears nowhere |
| story boundary | no file outside the list above |

## Acceptance → check
The six criteria on the CSV row.

## Do not
Edit any plan text, any acceptance string or any card body. Touch `packages/`, `apps/`, `scripts/` or
`.github/`. Re-run `jira.mjs sync`. Mark MARXY-98 done — that is the orchestrator's transition, not a
file in this diff.
