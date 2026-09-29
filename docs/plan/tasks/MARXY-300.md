---
key: MARXY-300
design: [10-gates-and-testing]
depends: []
verify: [node scripts/check-cards.mjs, node --test orchestration/phases.test.mjs]
---
# MARXY-300 — Land the 2026-09-28 stuck plan delta

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-stuck](../deltas/2026-09-28-stuck.md) · **Depends on:** nothing in `deps.json`.

**Outcome.** The fleet reads one plan: palette history is its own story, and the stories that stopped on a missing path can touch the file the work already needs.

## Files and signatures
- `docs/plan/deltas/2026-09-28-stuck.md` — the delta, including the Escalation risk section.
- `docs/plan/jira-issues.csv` — the row edits and MARXY-262.
- `docs/plan/tasks/MARXY-195.md` — the narrowed card.
- `docs/plan/tasks/MARXY-262.md` — the pin half.
- `orchestration/deps.json` — MARXY-262 in phase 2, depending on MARXY-195.
- `orchestration/jira-map.json` — the rename PR #242 already created.
- `docs/taste-review/queue.md` — the MARXY-258 and MARXY-241 rows.
- `CHANGELOG.md` — one Unreleased line.

## Do this, in order
1. The edits above are the story.
2. `node scripts/check-cards.mjs` and `node --test orchestration/phases.test.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `rg -n "Escalation risk" docs/plan/deltas/2026-09-28-stuck.md` | a hit |
| MARXY-195 Paths | do not contain `palette/history.ts` |
| MARXY-262 | depends on MARXY-195; Paths contain `history.ts` and `palette-history.test.mjs` |
| `node scripts/check-cards.mjs` | exit 0 |
| `node --test orchestration/phases.test.mjs` | exit 0 |

## Acceptance → check
Each numbered sentence on this story's CSV row is one row of that table, or a path assertion the delta names.

## Do not
Merge pull requests 228, 242, 250 or 253. Mint a second Jira issue for MARXY-262. Split MARXY-44, MARXY-250 or MARXY-252 in this pull request. Edit `packages/*/src/contracts/`.
