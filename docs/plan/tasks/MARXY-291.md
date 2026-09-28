---
key: MARXY-291
design: [10-gates-and-testing]
depends: []
verify: [node --test scripts/lib/own-row.test.mjs, pnpm done MARXY-291]
---
# MARXY-291 — Judge a new plan row by the paths it brings

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **ADRs:** ADR-0034 (the fleet reads the plan from `origin/main`).

**Outcome.** A planner pull request that adds its own row and other stories can be boundary-checked. The cycle reads the Paths on the row that pull request adds.

## What is wrong today
`reviewBoundary` uses the base row whenever the branch edits any key but its own. A planner branch adds those other keys, and its own key is not on main yet, so the base row is missing. `cycle.mjs` then treats every file as outside the story and parks the pull request, because a `no-dispatch` row cannot be returned. MARXY-275 (#242), MARXY-278 (#250) and MARXY-279 (#251) are in that state. `check-story` already falls back to the working-tree row, which is why their CI is green.

## Files and signatures
- `scripts/lib/own-row.mjs` — `reviewBoundary`: when `edits.added` and not `ownOnly`, `story` is `edits.after`. An existing key that edits someone else still uses the base row.
- `scripts/lib/own-row.test.mjs` — the new case, plus the existing "base row governs" case left as it is.
- `docs/ci-contract.md` — one sentence under the story-boundary row so the next planner knows which row the cycle reads.
- `CHANGELOG.md` — one Unreleased line.

## Do this, in order
1. Change `story` as above. Do not treat `added` as `ownOnly`: board files edited alongside other stories stay annotated when they are not in Paths.
2. Add the test. Run `node --test scripts/lib/own-row.test.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| new key adds itself and MARXY-10 | `ownOnly` false, `story.Paths` is the new key's Paths |
| existing key edits MARXY-2 | `story.Paths` stays the base Paths (`a`), not the widened ones |

## Acceptance → check
The test file is the check for both assertions. The changelog line is the third.

## Do not
Widen an existing story's paths in this pull request. Edit `jira-issues.csv` except for this row. Copy the plan edits out of MARXY-275, MARXY-278 or MARXY-279.
