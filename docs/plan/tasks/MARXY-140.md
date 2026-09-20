---
key: MARXY-140
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-140]
---
# MARXY-140 — land the MARXY-26 split on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-19-marxy-26-split.md`,
`docs/plan/deltas/2026-09-19-branch-budget-guard.md`, and MARXY-131 and MARXY-135 for the same shape.

> **Revised 2026-09-19, after PR #101 escalated at `9081422`.** The tree on that PR is right and stays
> open — amend it, do not cut a new branch and do not close it. Two things changed in the row: `Paths`
> gain `orchestration/jira-map.json` and two more planner deltas, and criterion 2 now names the two
> board tests it always meant. The `+600` branch-diff test inside `orchestration/phases.test.mjs`
> fails on this branch — `+710` at attempt 1, about `+1050` with the three extra files; that is
> expected, it is accepted in
> `docs/plan/deltas/2026-09-19-branch-budget-guard.md`, and MARXY-142 fixes the guard afterwards. Do
> not trim planner text to shrink the diff and do not edit `orchestration/phases.test.mjs` here.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-26's narrowed paths and the three new rows. Nothing else can start until
this lands.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the boundary
check's input is indistinguishable from one that found its paths inconvenient, and two doing it in
parallel leave the occupancy rule meaning nothing (that is exactly why PR #87 was returned). The planner
writes the edits into the working tree; a landing story commits them.

## Files
- `docs/plan/jira-issues.csv` — MARXY-26 rewritten; `MARXY-137`, `MARXY-138`, `MARXY-139`, `MARXY-140`,
  `MARXY-141` and `MARXY-142` added.
- `orchestration/deps.json` — the six new keys placed in a phase, and the dependency edits in the two
  deltas' tables (MARXY-26, MARXY-31, MARXY-44, MARXY-47, MARXY-128, MARXY-129, MARXY-142).
- `orchestration/jira-map.json` — the six placeholder→key entries. Both landings this story copies
  carried this file (`4dd7ee0`, `389baec`); without it a `bootstrap` or `sync` from a clean checkout
  has nothing telling it these issues exist.
- `docs/plan/deltas/2026-09-19-marxy-26-split.md`, `docs/plan/deltas/2026-09-19-branch-budget-guard.md`
  and `docs/plan/deltas/2026-09-19-marxy-83-paths.md` — the third has been untracked in the working
  tree since MARXY-83's correction landed; leaving a planner's reasoning on a disk is the state this
  story exists to end.
- `docs/plan/tasks/` — the five new cards and the rewritten `MARXY-26.md`.

`node orchestration/jira.mjs sync` has already run, so the placeholders are already real keys —
MARXY-137 through MARXY-142 — in the CSV, in `deps.json`, in `jira-map.json`, in the deltas and in the
card filenames. Carry whatever is in the working tree; do not re-slug or renumber anything.

## Do this, in order
1. Use the existing branch `chore/MARXY-140-land-the-marxy-26-split` and PR #101. Rebase or merge
   `main` in if it has moved; amend the commit rather than opening a second PR.
2. Stage exactly the files above plus `CHANGELOG.md`. Nothing else — check `git status` before you commit.
   Note that the working tree also carries edits to `orchestration/README.md`, `cycle.mjs`,
   `dispatch.mjs`, `lib.mjs`, `lib.test.mjs`, `loop.sh` and `needs-human.md` that belong to other
   stories: leave every one of them alone.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`.
4. `pnpm precheck`, then `pnpm done MARXY-140`. Say the `+710` overrun and the one red test in the PR
   body, as the first attempt correctly did.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures: every CSV story in exactly one phase; no story depends on a later numbered phase |
| `node orchestration/phases.test.mjs` (whole file) | **exactly one failure**, `the branch diff stays under 600 lines…`, at roughly `+1050`. Any second failure is a real problem; this one is accepted and MARXY-142 fixes it |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green; no file outside the listed paths |
| the diff | no file under `packages/`, `apps/`, `scripts/`, `.github/` or `fixtures/`; no change to `orchestration/phases.test.mjs` or `orchestration/state.json` |
| MARXY-26's `Paths` cell | `packages/core/src/render` and nothing else |
| `orchestration/jira-map.json` | six placeholder→key entries, MARXY-137 … MARXY-142 |

## Acceptance → check
The row's six criteria in order: 1 and 2 are the board files with the two committed-board tests and
`check-deps.mjs`, 3 is the cards with `check-story.mjs --strict`, 4 is `jira-map.json`, 5 is the
boundary check, 6 is the `CHANGELOG.md` line.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is wrong, say so
in the PR and stop; the planner corrects it, not you. Add a row. Touch `orchestration/state.json` (it is
untracked by design). Edit `orchestration/phases.test.mjs` to make the branch-diff test green, or trim,
reflow or summarise any planner text to shrink the diff — both are the reason attempt 1 escalated and
both are MARXY-142's job. Edit any file under `packages/` or `apps/`. Close PR #101 or open a second
one. Start MARXY-26's rework in this branch.
