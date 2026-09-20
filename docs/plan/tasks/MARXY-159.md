---
key: MARXY-159
design: []
depends: []
verify: [node --test orchestration/phases.test.mjs, node --test orchestration/test, node orchestration/ready.mjs]
---
# MARXY-159 — Land the MARXY-27 path widening for the Shiki dependency

**Depends on:** nothing · **ADRs:** none · **Delta:**
[2026-09-20-marxy-27-paths](../deltas/2026-09-20-marxy-27-paths.md).

**Outcome.** MARXY-27's row on `main` covers `packages/core/package.json`, so PR #124's attempt 2 can
keep its highlighter code and its `package.json` dependency hunk while dropping the `docs/plan/jira-issues.csv`
hunk it wrote on itself. `scripts/check-story.mjs` reads the CSV as it exists on `main`, which is why
attempt 2 cannot proceed before this merges.

## Files — commit exactly these, unchanged
- `docs/plan/deltas/2026-09-20-marxy-27-paths.md` — the delta.
- `docs/plan/jira-issues.csv` — MARXY-27's `Paths` cell gains `packages/core/package.json`; its
  Description cell (previously empty) records why; new row for this story.
- `orchestration/deps.json` — this key joins the `ops` phase with no dependencies.
- `orchestration/jira-map.json` — the key `jira.mjs sync` assigns this row.
- `docs/plan/tasks/MARXY-159.md`, `docs/plan/tasks/MARXY-160.md` — both new cards
  land together in this one pull request; `Paths` names the whole `docs/plan/tasks` directory so this
  row can carry its sibling's card the same way MARXY-125 carried MARXY-126's.

## Do this, in order
1. Branch `chore/<this-key>-land-marxy-27-paths` off `main`. The files are already in the working
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
Edit MARXY-27's Acceptance, Summary or dependency edge. Restore or edit MARXY-126's row (its sibling
landing story carries that). Touch `packages/`, `apps/`, `scripts/` or `.github/`. Start MARXY-27's own
work. Re-run `jira.mjs sync` after the key resolves.
