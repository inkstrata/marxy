---
key: MARXY-131
design: []
depends: [MARXY-125]
verify: [node --test orchestration/phases.test.mjs, node --test orchestration/test, node orchestration/ready.mjs]
---
# MARXY-131 — Land the MARXY-95 escalation plan on main

**Depends on:** MARXY-125 (done) · **ADRs:** carries ADR-0031 as *proposed*; accepts none · **Delta:** [2026-09-19-escalation-95](../deltas/2026-09-19-escalation-95.md).

**Outcome.** MARXY-95's widened row is on `main`, so its second attempt may touch the two files the
escalation named. `scripts/check-story.mjs` reads the CSV as it exists on `main`, which is exactly why
attempt 1 could not fix either problem — the same mechanism as MARXY-111 and MARXY-125.

## Files — commit exactly these, unchanged
- `docs/plan/deltas/2026-09-19-escalation-95.md` — the delta.
- `docs/plan/jira-issues.csv` — MARXY-95 widened (`Paths` gains the test and the registry; criteria 8
  and 9 added; Description records why); new rows MARXY-131, MARXY-132, MARXY-133, MARXY-128,
  MARXY-129, MARXY-130; MARXY-22 labelled `human-gated` with its `Paths` narrowed and its empty
  Description filled.
- `orchestration/deps.json` — MARXY-128, 129, 130 and 133 join phase 1; 131 and 132 join `ops`; deps for
  all six, and MARXY-126 gains a dependency on this story.
- `orchestration/jira-map.json` — the two keys `jira.mjs sync` assigned (MARXY-132, MARXY-133).
- `docs/plan/tasks/` — `MARXY-95.md` rewritten; new cards for 128, 129, 130, 131, 132, 133.
- `docs/adr/0031-token-values-are-taste.md` and its `docs/adr/README.md` row — **proposed**.
- `CHANGELOG.md` — one line.

## Do this, in order
1. Branch `chore/MARXY-131-land-the-escalation-95-plan` off `main`. The files are in the orchestrator's
   working tree; do not rewrite their content and do not re-run `jira.mjs sync` (it ran in the pass).
2. `node --test orchestration/phases.test.mjs`, `node --test orchestration/test`.
3. Prove criterion 4 and paste it: `node -e "import('./scripts/lib/repo.mjs').then(m=>{const s=m.story('MARXY-95');for(const f of ['apps/desktop/test/paint-signal.test.mjs','scripts/registry.json'])console.log(f, m.allowedByPaths(f, m.pathsOf(s)))})"`
   — if those helpers are named otherwise on `main`, use the ones `check-story.mjs` calls and say which.
4. `node orchestration/ready.mjs`, paste the output. `pnpm done MARXY-131`, fill the table, open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `orchestration/phases.test.mjs` | passes; every CSV story in exactly one phase; no later-phase dependency |
| `orchestration/test` | passes unchanged |
| the boundary check for MARXY-95 | `true` for both files |
| `pnpm test:contracts-frozen` | green — no contract file is in this diff |

## Acceptance → check
The eight criteria on the CSV row.

## Do not
Add prose: the branch is ~597 insertions against `phases.test.mjs`'s 600-line guard, so anything you add
you must cut. Edit any plan text, acceptance string or card body. Accept ADR-0031 (MARXY-133) or edit any
accepted ADR. Touch `packages/`, `apps/`, `scripts/` or `.github/`. Re-run `jira.mjs sync`. Rebase or
push MARXY-95's branch — that is its own attempt.
