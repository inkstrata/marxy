---
key: MARXY-118
design: [10-gates-and-testing]
depends: [MARXY-106, MARXY-117]
verify: [node --test orchestration/worktrees.test.mjs, node orchestration/worktrees.mjs --dry-run]
---
# MARXY-118 — Remove a story's worktree when its PR merges or closes

**Depends on:** MARXY-106, MARXY-117 (both edit `cycle.mjs`) · **CODEOWNERS:** `cycle.mjs`.

**Outcome.** Worktrees stop accumulating. Each cycle removes clean worktrees whose PR merged or
closed, and clean detached scratch worktrees older than a day, and says why it kept the rest.
Nothing with uncommitted work is ever removed.

## Files and signatures
- `orchestration/worktrees.mjs` — `export function prunePlan(entries): { remove: Entry[], keep: Entry[] }`, each with `reason`;
  `export function removeArgs(path): string[]` returns `['worktree', 'remove', path]`. The CLI reads
  `git worktree list --porcelain`, dirtiness with `git --no-optional-locks status --porcelain`, and PR state per branch with `gh pr list --head`.
- `orchestration/worktrees.test.mjs`
- `orchestration/cycle.mjs` — run the plan after step 2 (land).

## Tests → expected
| Entry | Expect |
| --- | --- |
| clean, PR MERGED | remove, "PR merged" |
| clean, PR CLOSED | remove, "PR closed" |
| PR OPEN | keep |
| dirty, PR MERGED | keep, "uncommitted work" |
| detached, clean, 30 h | remove |
| detached, clean, 2 h | keep |
| the orchestrator checkout | keep |
| `removeArgs` | contains no `--force` |

## Do not
Use `--force`. Delete branches, local or remote. Touch a worktree outside `git worktree list`.
