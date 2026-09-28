---
key: MARXY-313
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-313]
---
# MARXY-313 — Land the 2026-09-28 plan delta

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28](../deltas/2026-09-28.md) · **Depends on:** nothing.

**Outcome.** The board on main lists the files the stuck stories already edit, Phase 2's reading-position story is finished before Phase 3 edits `app.ts`, and the escalated stories are retried rather than split.

## Files and signatures
- `docs/plan/deltas/2026-09-28.md` — the rulings.
- `docs/plan/jira-issues.csv` — path widens and MARXY-195's acceptance.
- `orchestration/deps.json` — MARXY-44, MARXY-48 and MARXY-49 depend on MARXY-195.
- `docs/design/04-typeset.md` §Grid and `docs/design/06-shell.md` §CSP — the decisions MARXY-282 and MARXY-250 implement.
- `docs/taste-review/queue.md` — rows for MARXY-258, MARXY-280 and MARXY-283.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. The delta.
2. The row edits.
3. The cards the retries will read.
4. `node scripts/check-cards.mjs` and `node --test orchestration/phases.test.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-cards.mjs` | exits 0 |
| `node --test orchestration/phases.test.mjs` | exits 0 |
| MARXY-195 acceptance | names `quit(0)` and rejects a hand-built history write |

## Acceptance → check
The CSV row's seven checks.

## Do not
Implement product code. Split a story whose branch already contains the change. Touch `packages/*/src/contracts/**`.
