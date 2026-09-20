---
key: MARXY-126
design: [10-gates-and-testing]
depends: [MARXY-125]
verify: [node scripts/check-cards.mjs, node --test scripts/check-cards.test.mjs, node --test orchestration/phases.test.mjs]
---
# MARXY-126 — Make the board one spec: every card has a row, every row's paths cover its card

**Depends on:** MARXY-125 (it edits the same CSV) · **ADRs:** none · **Deltas:**
[2026-09-19-after-65](../deltas/2026-09-19-after-65.md), [2026-09-19-phase-1-paths](../deltas/2026-09-19-phase-1-paths.md),
[2026-09-18-design-runway-phase-3](../deltas/2026-09-18-design-runway-phase-3.md),
[2026-09-20-marxy-27-126-paths](../deltas/2026-09-20-marxy-27-126-paths.md) (widened this row's own `Paths`
to add `orchestration/deps.json`).

**Outcome.** A card and its row cannot disagree without a red check. Three passes have now been spent
reconciling them by hand: MARXY-20, 21 and 23 had rows narrower than their cards and the hook refused
the implementor; MARXY-93 … MARXY-98 had cards and Jira issues with no row at all.

## Files and signatures
- `scripts/check-cards.mjs` — `cardsAndRows({ cards, rows, deps })` returning a list of problems, and a
  CLI that prints them through `fail`/`fix` the way the other `scripts/check-*.mjs` do. Reuse
  `pathsOf`, `allowedByPaths` and `story` from `scripts/lib/repo.mjs`; do not write a second path
  matcher, because a check that disagrees with the hook is worse than no check.
- `scripts/check-cards.test.mjs` — one fixture per failure class, each shown failing.
- `scripts/precheck.mjs` — run it. No `package.json` script, no workflow edit.
- `docs/plan/jira-issues.csv` — the row corrections that make the check green.
- `docs/plan/tasks/*.md` — only where a card names a file that no longer exists.
- `docs/hygiene.md` — what the check enforces.
- `orchestration/deps.json` — a `phases` entry (and, if warranted, a `deps` edge) for any key the
  check surfaces under problem class 1 whose restored row then has nowhere to sit; the row's `Paths`
  did not cover this file until [2026-09-20-marxy-27-126-paths](../deltas/2026-09-20-marxy-27-126-paths.md).

## The four problem classes
1. `docs/plan/tasks/KEY.md` exists and the CSV has no row for `KEY`.
2. A path in the card's `## Files and signatures` section — the first backticked token of each bullet,
   ignoring a bullet whose token has no `/` and no `.` — is not covered by the row's `Paths` under
   `allowedByPaths`.
3. A key in `orchestration/deps.json` `phases` or `deps` has no CSV row. (The reverse is already
   covered by `orchestration/phases.test.mjs`.)
4. A card's `depends:` front-matter disagrees with `deps.json`'s list for that key.

An out-of-plan Task with no card and no `deps.json` entry is not a problem: nothing claims it exists.

## Do this, in order
1. Write the check and its fixtures first, and run it over the tree to get the real list.
2. Apply the row edits the design-runway delta listed and never landed: MARXY-26, 41, 42, 43, 44, 45,
   47, 48, 49, 52, 53 (`docs/plan/deltas/2026-09-18-design-runway-phase-3.md`, "Edits to existing
   rows"). That delta is the authority for those Paths; the cards are the authority for everything
   else. Leave every `Acceptance` string alone.
3. Where a card names a moved file, correct the card and say so in the PR — known case:
   `packages/core/scripts/fidelity.ts` became `scripts/gate-fidelity.mjs` in MARXY-77, and MARXY-43's
   card and the MARXY-43 and MARXY-49 rows still name the old path.
3a. Another known problem-class-1 case, not on the design-runway list: `docs/plan/tasks/MARXY-76.md`
   (re-render taste review #0 in the dark variant) exists with no CSV row and no `deps.json` phase.
   Restore its row and give it a phase (its only dependency is MARXY-17, done in phase 0, so it can sit
   in phase 1 beside MARXY-128–130), or, if it is judged stale now that the typeface decision was
   already taken on the light-mode PNGs (`orchestration/needs-human.md`, 2026-09-19 discharge) without
   waiting for it, correct or retire the card and say so in the PR — do not silently drop it either
   way, per "Do not... Delete a card" below.
4. Wire it into `precheck.mjs`; document it in `docs/hygiene.md`.

## Tests → expected
| Check | Expect |
| --- | --- |
| fixture: card with no row | fails, names the key |
| fixture: row whose Paths miss a card file | fails, names the key and the file |
| fixture: `deps.json` key with no row | fails, names the key |
| fixture: card `depends` ≠ `deps.json` | fails, names both lists |
| the committed tree | green, after step 2 |
| `orchestration/phases.test.mjs`, `pnpm test` | pass |

## Acceptance → check
The six criteria on the CSV row.

## Do not
Change what any card asks for. Touch any row's `Acceptance`. Add a `package.json` script or a workflow
step. Widen a row to a path its card does not name. Delete a card.
