---
key: MARXY-117
design: [10-gates-and-testing]
depends: [MARXY-106]
verify: [node --test orchestration/board-check.test.mjs, node orchestration/board-check.mjs, pnpm done MARXY-117]
---
# MARXY-117 — Name board drift every cycle and hold dispatch on a stale board

**Depends on:** MARXY-106 (cycle.mjs order and fast-forward) · **ADRs:** none · **CODEOWNERS:** `cycle.mjs`, so Ian approves.

**Outcome.** The cycle can no longer dispatch from a board that is not `origin/main`'s. When the
orchestrator checkout is behind, off `main`, or has tracked edits under `docs/plan/` or
`orchestration/`, every cycle says so and names the files, and dispatch waits. Open PRs with no
board row and in-review rows whose PR already closed are named too. The planner and orchestrator
prompts say board changes go through a PR from a worktree.

## Files and signatures
- `orchestration/board-check.mjs` — `export function boardDrift(input): Finding[]`, pure; `Finding = { kind, detail }`,
  kinds `behind`, `off-main`, `dirty-board`, `unboarded-pr`, `stale-review`. A CLI at the bottom gathers the input
  with `git` and `gh` and exits 1 on any finding.
- `orchestration/board-check.test.mjs` — one fixture per kind, plus the clean fixture.
- `orchestration/cycle.mjs` — call it in step 1 (sync); print findings; skip step 6 (dispatch) on `behind`, `off-main`, `dirty-board`.
- `orchestration/prompts/planner.md`, `.cursor/agents/planner.md`, `orchestration/prompts/orchestrator.md` — one paragraph each.

`state.json`, `needs-human.md`, `status.md` and `results/` are gitignored and are never findings.
Out-of-plan keys come from Jira issues labelled `out-of-plan` (MARXY-101); in tests, inject them.

## Do this, in order
1. `boardDrift` and its tests, no IO.
2. The CLI: `git status --porcelain -- docs/plan orchestration`, `git rev-list --count HEAD..origin/main`, `gh pr list --json number,title,headRefName`.
3. Wire into `cycle.mjs` after the fast-forward attempt.
4. Prompts. CHANGELOG line.

## Tests → expected
| Fixture | Expect |
| --- | --- |
| clean | `[]` |
| `behind: 14` | one `behind` finding naming 14 |
| `dirtyTracked: ['docs/plan/jira-issues.csv']` | `dirty-board` naming the file |
| PR titled `(MARXY-999)`, no row, not out-of-plan | `unboarded-pr` |
| PR for an out-of-plan key | no finding |
| `inReview: [{ key, prState: 'MERGED' }]` | `stale-review` |

## Acceptance → check
CSV criteria 1–5.

## Do not
Revert, stash, or pull anything in the orchestrator checkout. This story reports; it never repairs.
Read Jira from a test. Edit `ready.mjs`.
