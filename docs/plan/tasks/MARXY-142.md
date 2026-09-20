---
key: MARXY-142
design: []
depends: [MARXY-140]
verify: [pnpm precheck, pnpm done MARXY-142]
---
# MARXY-142 — make the branch-diff budget count only the lines it can judge

**Depends on:** MARXY-140 (this story's own CSV row reaches `main` in that commit) · **Reference:**
`docs/plan/deltas/2026-09-19-branch-budget-guard.md`, MARXY-107 criterion 7, `docs/conventions.md`.

**Outcome.** The 600-line guard in `orchestration/phases.test.mjs` measures the lines a reviewer has
to hold in their head — source, scripts, orchestration code, workflows — and stops counting board
rows, plan deltas and task cards. A plan landing is no longer held by a budget written about somebody
else's branch; a branch that hides code among plan text is held exactly as it is today.

## The bug
MARXY-107's criterion 7 (`git diff --stat origin/main...HEAD is under 600 lines`) was a budget for one
branch, after PR #52 was discarded at +1370. It was committed as a standing test, so it now runs
against whatever is checked out. It failed MARXY-140 (PR #101) at `+710` where every added line is
plan text that story is forbidden to trim, and it is invisible in CI on exactly that class of branch:
`pnpm test` runs `orchestration/*.test.mjs` in the `fast` job, and `fast` is skipped when
`scripts/ci-changes.mjs` reports `docs_only`.

The second half of the same test — that no `docs/plan/deltas/2026-09-18-*.md` file returns — is a real
repository invariant and does not change. It stays unconditional, including for a plan-surface-only
branch.

## Files
- `orchestration/branch-diff.mjs` — **new**, pure, no `git`, no I/O:
  ```js
  export const LIMIT = 600;
  export function isPlanSurface(file);                 // string -> boolean
  export function budgetedInsertions(rows);            // [{ added, file }] -> number
  export function forbiddenNames(names);               // [string] -> [string]
  ```
  `isPlanSurface` is true for `docs/plan/` (any depth), `orchestration/deps.json`,
  `orchestration/jira-map.json`, `orchestration/results/` (any depth) and `CHANGELOG.md`, and false
  for everything else. `budgetedInsertions` sums `added` over rows whose file is **not** plan surface,
  treating a binary row (`-` in numstat) as 0. `forbiddenNames` returns the members of `names` matching
  `^docs/plan/deltas/2026-09-18-.*\.md$`.
- `orchestration/phases.test.mjs` — the branch test now parses `git diff --numstat <base>...HEAD`
  instead of `--stat`, asserts `budgetedInsertions(rows) < LIMIT` with a message naming the counted
  total, and asserts `forbiddenNames(names)` is empty. `resolveThreeDotBase`, the skip behaviour and
  the three unit cases around them (MARXY-114) are untouched. Add the new unit cases in the same file,
  beside the existing ones.
- `docs/hygiene.md` — one sentence in the checks section.

## Do this, in order
1. Branch `chore/MARXY-142-branch-diff-budget`.
2. Write `orchestration/branch-diff.mjs`.
3. Write the five unit cases **before** rewriting the branch test, and watch case 3 fail against the
   current `--stat` implementation. A test written after the change cannot tell you the change was
   needed.
4. Rewrite the branch test to use the module. Keep the numstat parse in the test file; the module
   stays pure.
5. `node orchestration/phases.test.mjs`, then `pnpm test`, then `pnpm precheck`, then
   `pnpm done MARXY-142`.

## Tests → expected
| Check | Expect |
| --- | --- |
| 900 insertions over `docs/plan/jira-issues.csv`, `docs/plan/deltas/x.md`, `docs/plan/tasks/K.md`, `orchestration/deps.json`, `orchestration/jira-map.json`, `CHANGELOG.md` | `budgetedInsertions` is `0`; guard passes |
| those rows plus `packages/core/src/render/images.ts` at `601` | fails, message contains `601` |
| those rows plus `packages/core/src/render/images.ts` at `599` | passes |
| `apps/desktop/src/app.ts` at `601`, alone | fails |
| `orchestration/cycle.mjs` at `601`, alone | fails |
| `forbiddenNames(['docs/plan/deltas/2026-09-18-perf-budget.md', 'docs/plan/deltas/2026-09-19-after-8.md'])` | `['docs/plan/deltas/2026-09-18-perf-budget.md']` |
| a plan-surface-only name list containing a `2026-09-18` delta | guard fails, despite `budgetedInsertions` being `0` |
| `resolveThreeDotBase` with neither ref, `origin/main` first, `main` fallback | unchanged from MARXY-114 |
| `node orchestration/phases.test.mjs` | green; test count is not lower than before the change |

## Acceptance → check
The row's eight criteria in order: 1 is the module's exports, 2 is the preserved MARXY-114 behaviour,
3–5 are the unit cases in the table above, 6 is the whole-file run and the test count, 7 is
`docs/hygiene.md`, 8 is the boundary and the `CHANGELOG.md` line.

## Do not
Raise `LIMIT`, or make it configurable, or read it from an environment variable — the number does not
move, only what is counted. Delete the `2026-09-18` assertion or make it conditional on the branch
class. Add `packages/`, `apps/`, `scripts/`, `.github/`, `fixtures/`, `fonts/` or any `orchestration/*.mjs`
file to the plan surface. Touch `docs/plan/jira-issues.csv`, `orchestration/deps.json` or
`orchestration/state.json` — this story does not edit the board. Change `.github/workflows/ci.yml` to
run the orchestration tests on docs-only pull requests; that is a separate question about CI
coverage and it needs its own key.
