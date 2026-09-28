---
key: MARXY-292
design: [10-gates-and-testing]
depends: []
verify: [node scripts/check-cards.mjs, node --test orchestration/phases.test.mjs]
---
# MARXY-292 — Land the 2026-09-28 plan delta

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28](../deltas/2026-09-28.md) · **Depends on:** nothing in `deps.json`. The cycle cannot boundary-check this pull request until MARXY-291 is on `main`, because this branch edits MARXY-44's row and the landing key is new.

**Outcome.** MARXY-44's next attempt moves the truncation sample out of the screenshot corpus. MARXY-250 is left as the commit it already has. The delta records both rulings.

## Files and signatures
- `docs/plan/deltas/2026-09-28.md` — the delta, including the Escalation risk section.
- `docs/plan/jira-issues.csv` — MARXY-44's Paths and acceptance, plus this row.
- `docs/plan/tasks/MARXY-44.md` — the resume note and the fixture path.
- `orchestration/deps.json` — this key in the ops lane only.
- `CHANGELOG.md` — one Unreleased line.

## Do this, in order
1. The edits above are the story. Do not add a product row.
2. `node scripts/check-cards.mjs` and `node --test orchestration/phases.test.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `rg -n "Escalation risk" docs/plan/deltas/2026-09-28.md` | a hit |
| MARXY-44 Paths | contain `apps/desktop/test/fixtures` |
| `docs/plan/tasks/MARXY-44.md` | contains `the truncation fixture is not under fixtures/corpus` |
| `node scripts/check-cards.mjs` | exit 0 |
| `node --test orchestration/phases.test.mjs` | exit 0 |

## Acceptance → check
Each row of the table is one acceptance sentence on this story's CSV row.

## Do not
Split MARXY-44 or MARXY-250 in this pull request. Copy rows out of pull requests 242, 250 or 251. Edit `packages/*/src/contracts/`.
