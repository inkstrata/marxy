---
key: MARXY-165
design: []
depends: []
verify: [node scripts/check-deps.mjs, node scripts/check-cards.mjs, node --test orchestration/phases.test.mjs]
---
# MARXY-165 — land the 2026-09-20-after-161 plan delta on main

**Design:** none — a board-only landing story · **Depends on:** nothing.

**Outcome.** Carries this planner pass's working-tree edits onto `main` in a commit that touches no
source file, the same shape as MARXY-131/135/140/144/146/148/152/154/157/158.

## What this pass found and fixed
- `orchestration/ready.mjs` refuses to *offer* a `human-gated` story, but `earlierPhaseOpen()` still
  counts one sitting `todo` in a numbered phase as holding that phase open for everything in the next
  phase. MARXY-22 (Linux weight harness, needs hardware nobody has confirmed exists,
  `needs-human.md` since 2026-09-18) and MARXY-94 (ADR-0026 shell-api amendment, needs the author's ruling,
  unanswered since 2026-09-19) were both phase-1 and `todo`, so **every phase-2 and phase-3 story**
  (MARXY-33 through MARXY-97) was `blockedByDeps` for a reason that was actually two indefinite human
  waits, not a real dependency.
- Neither story is a reader-facing phase-1-end promise (`docs/plan.md`'s Phase 1 "ends with" list does
  not name either), and `orchestration/deps.json`'s `deps` map lists **no dependent at all** for
  MARXY-22 and only phase-3 dependents (MARXY-49, MARXY-97) for MARXY-94 — both already correctly
  gated by the dependency edge itself once the phase gate stops also holding them. Moving both to the
  `ops` lane (keeping their `phase-1` CSV label, the same convention MARXY-15/59/65/70/78 already use)
  removes the phase-gate side effect without weakening either story's own dependency chain.
- That move surfaced the *real* remaining phase-1 gate: MARXY-27 (code highlighting, PR #124) shipped
  only the core tokeniser — its own PR body says the desktop wiring and theme colours are follow-on
  work — so no reader has ever seen a highlighted code block, and `docs/scope.md` lists highlighting
  under v1's shipped Rendering requirements. MARXY-164 is that follow-on. MARXY-163 is an unrelated,
  already-fixed defect in MARXY-28 (KaTeX) that PR #135 tried to land under a placeholder key and
  cannot merge (`CONFLICTING`, fights the CSV dedupe MARXY-161 landed).

## Files and signatures
- `docs/plan/jira-issues.csv` — two new rows, MARXY-163 and MARXY-164, plus this landing row.
- `orchestration/deps.json` — `phases["1"]` loses MARXY-22 and MARXY-94, gains MARXY-163 and
  MARXY-164; `phases.ops` gains MARXY-22, MARXY-94 and this landing key; `deps` gains
  `"MARXY-163": []` and `"MARXY-164": ["MARXY-27"]`.
- `docs/plan/tasks/MARXY-163.md`, `docs/plan/tasks/MARXY-164.md` — new cards.
- `docs/plan/deltas/2026-09-20-after-161.md` — this pass's delta (always allowed, `docs/plan/deltas/`
  prefix).

## Do this, in order
1. Apply the planner's working-tree edits verbatim — do not re-derive them.
2. `node scripts/check-deps.mjs`, `node scripts/check-cards.mjs`, `node --test
   orchestration/phases.test.mjs` (expect 21/21).
3. `node orchestration/ready.mjs` with a `state.json` in which MARXY-1 through MARXY-97 are `done`
   except MARXY-22 (`todo`), MARXY-33 through MARXY-97 (`todo`) and MARXY-118 (`todo`) — confirm
   MARXY-33/36/86/38 no longer appear in `blockedByDeps` for lack of a real dependency, only
   MARXY-39/41-49/51-54/96/97 remain (their own real dependency chains, including MARXY-94, are
   unaffected). Paste the output.
4. `pnpm precheck`, `pnpm done MARXY-165` (or the resolved key).

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-deps.mjs` | `deps ok` |
| `node scripts/check-cards.mjs` | `check-cards ok` |
| `node --test orchestration/phases.test.mjs` | 21/21 |
| `git diff origin/main --name-only` | only the files listed above plus `CHANGELOG.md` |

## Acceptance → check
The eight criteria on the CSV row map onto the steps and table above, in order.

## Do not
Start MARXY-163's or MARXY-164's own product work in this branch. Touch
`orchestration/state.json`. Change any row's Acceptance, Paths or Description other than the two new
rows. Close or reopen PR #124 or #115 from this branch — closing PR #135 (the placeholder-key PR
this pass's rows replace) is a separate repo action, not a file in this diff.
