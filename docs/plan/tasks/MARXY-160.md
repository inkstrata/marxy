---
key: MARXY-160
design: []
depends: []
verify: [node --test orchestration/phases.test.mjs, node --test orchestration/test, node orchestration/ready.mjs]
---
# MARXY-160 — Land the MARXY-126 path widening for the deps.json phase entry

**Depends on:** nothing · **ADRs:** none · **Delta:**
[2026-09-20-marxy-27-paths](../deltas/2026-09-20-marxy-27-paths.md).

**Outcome.** MARXY-126's row on `main` covers `orchestration/deps.json`, so its next attempt can
restore MARXY-76's row and give it a phase without touching a file outside its own boundary.
`orchestration/results/MARXY-126.json` records the prior attempt stopping, correctly, instead of
self-widening to reach that file. This story is the landing that grants the permission — it is not
MARXY-126 itself, and it does not restore MARXY-76's row or edit any other key in `deps.json`.

## Files — commit exactly these, unchanged
- `docs/plan/deltas/2026-09-20-marxy-27-paths.md` — the delta.
- `docs/plan/jira-issues.csv` — MARXY-126's `Paths` cell gains `orchestration/deps.json`; its
  Description cell gains one paragraph recording why; new row for this story.
- `orchestration/deps.json` — this key joins the `ops` phase with no dependencies. No other key's
  phase or dependency list changes; MARXY-76 gets no phase entry here.
- `orchestration/jira-map.json` — the key `jira.mjs sync` assigns this row.
- `docs/plan/tasks/MARXY-159.md`, `docs/plan/tasks/MARXY-160.md` — both new cards
  land together in this one pull request; `Paths` names the whole `docs/plan/tasks` directory so this
  row can carry its sibling's card the same way MARXY-125 carried MARXY-126's.

## Do this, in order
1. Branch `chore/<this-key>-land-marxy-126-paths` off `main`. The files are already in the working
   tree; do not rewrite their content, and do not re-run `jira.mjs sync` once the placeholder key is
   resolved.
2. `node --test orchestration/phases.test.mjs` and `node --test orchestration/test`.
3. `node orchestration/ready.mjs` and paste the output in the PR.
4. `pnpm done <this-key>`, fill the acceptance table, open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| `orchestration/phases.test.mjs` | every CSV story in exactly one phase; no dependency on a later numbered phase |
| `orchestration/test` | passes unchanged |
| story boundary | no file outside the list above |

## Acceptance → check
The eight criteria on the CSV row.

## Do not
Edit MARXY-126's Acceptance, Summary or dependency edge. Restore MARXY-76's row. Add or edit any other
key in `orchestration/deps.json`. Touch `packages/`, `apps/`, `scripts/` or `.github/`. Start MARXY-126's
own work. Re-run `jira.mjs sync` after the key resolves.
