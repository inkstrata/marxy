---
key: MARXY-202
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-202]
---
# MARXY-202 — A live worktree holds its paths before its PR opens

**Authority:** [`orchestration/README.md`](../../../orchestration/README.md) "The loop" §1 (what
`ready.mjs` refuses and why) and "Rules the scripts enforce" (one story, one worktree, one branch;
a diff may touch only its `Paths`). No `docs/design/` section covers the fleet; the README is the
design for orchestration behaviour, and this story edits it. · **Delta:**
[2026-09-23](../deltas/2026-09-23.md) · **Lane:** ops. **Deferred** behind product dispatch by that
delta (roadmap ops-majority tripwire): dispatch it in a cycle where no product story is startable, or
alongside one, never instead of one.

**Outcome.** A story is never dispatched onto files that a sibling worktree is already rewriting. The
cycle already knows every worktree (`git worktree list --porcelain`, `parseWorktreeList`) and keeps
the ones with uncommitted work or commits and no finished PR; from this story those worktrees also
*hold* the paths of the key their branch names, exactly as an In Progress story does, and `ready.mjs`
says so by name.

## What is wrong today
`selectReady` computes `busyPaths` from `state.json` alone (`in_progress` / `in_review`). A branch that
has commits but no PR — the author's out-of-plan work, a planner pass mid-write, an implementor whose
`state.mjs` call failed — is invisible. On 2026-09-23 `../marxy-wt/MARXY-198` (2 commits ahead, 38
files, rewriting `app.ts`, `main.rs`, `palette/`, `packages/core/src/parse`) had no PR, and once
MARXY-42 settled `ready.mjs` would have offered MARXY-193 on `app.ts`. The delta wired a dependency by
hand; this story makes the hold automatic.

## Files and signatures
- `orchestration/worktrees.mjs`
  - `keyOfBranch(branch: string | null): string | null` — the first `MARXY-\d+` in the branch name.
  - `liveClaims(entries, { orchestratorPath = ROOT, rowsOf, isDone }) → { key, paths: string[], path, ahead: number, dirty: boolean }[]`.
    `entries` is `parseWorktreeList` output extended with `ahead` (commits over `origin/main`, from
    `git rev-list --count origin/main..HEAD` in that worktree; `0` when the ref is missing) and `dirty`.
    A worktree claims when: it is not the orchestrator checkout, its branch names a key, `isDone(key)`
    is false, and (`dirty || ahead > 0`). `rowsOf(key, worktreePath)` returns the key's parsed CSV row:
    main's row when it exists, else the row parsed from `<worktreePath>/docs/plan/jira-issues.csv`
    (an out-of-plan branch carries its own row), else `null` → no claim, and the claim list carries
    `{ key, path, reason: 'no row' }` so the cycle can print it.
  - `readLiveEntries()` — the I/O wrapper the defaults call; never called by tests.
- `orchestration/ready.mjs`
  - `RULE.WORKTREE_HOLDS = 'worktree holds'`.
  - `selectReady({ ..., claims = liveClaims(readLiveEntries(), …) })`. Claims for a key already
    `in_progress`/`in_review` add nothing (their paths are already busy). Other claims' paths join
    `busyPaths`; a story held only by a claim goes to `blockedByPaths` and `excluded` gets
    `{ key, rule: RULE.WORKTREE_HOLDS, by: claim.key }`.
  - The CLI JSON gains `claims: [{ key, path, ahead, dirty }]`.
- `orchestration/cycle.mjs`: after the worktree keep/remove lines, one line per claim:
  `worktree holds paths: MARXY-198 (../marxy-wt/MARXY-198, 2 commits ahead, clean, no PR)`; the
  same line in `status.md` under "This cycle".
- `orchestration/README.md`: "The loop" §1 gains one sentence: *a worktree whose branch names a key,
  with commits or uncommitted work and no finished PR, holds that key's paths as if it were In
  Progress, and `ready.mjs` names it (`worktree holds`).*
- `orchestration/worktrees.test.mjs`, `orchestration/ready.test.mjs`: the cases below.

## Do this, in order
1. `keyOfBranch` and `liveClaims` as pure functions over fixture entries; tests.
2. `selectReady` `claims` input with the hermetic default guarded so fixture tests never touch git
   (`claims` defaults to `[]` when `all`/`s`/`d` were injected — or simpler: the default only runs when
   called from the CLI `isMain` block; pick one and say so in the PR).
3. `cycle.mjs` line and `status.md`.
4. README sentence.

## Tests → expected
| Check | Expect |
| --- | --- |
| `liveClaims`: `feat/MARXY-198-x`, ahead 2, clean, key todo, row on main | one claim with that row's paths |
| `liveClaims`: same but key `done` | no claim |
| `liveClaims`: ahead 0, clean | no claim |
| `liveClaims`: ahead 0, dirty | claim |
| `liveClaims`: orchestrator checkout on `main` with dirty tree | no claim (no key in `main`; and it is the orchestrator path) |
| `liveClaims`: key with no row on main, row in the worktree's CSV | claim with the worktree row's paths |
| `liveClaims`: key with no row anywhere | `{ key, path, reason: 'no row' }`, no paths held |
| `selectReady`: story on `apps/desktop/src/app.ts`, claim on `apps/desktop/src/app.ts` | story in `blockedByPaths`; `excluded` has `{ rule: 'worktree holds', by }` |
| `selectReady`: same board, `claims: []` | story in `ready` |
| `selectReady`: claim for an `in_progress` key | result identical to no claim |
| `node orchestration/ready.mjs` in a checkout with an unpushed sibling worktree | prints the rule and the claim |
| `node --test orchestration` | green |

## Acceptance → check
CSV criteria 1–5 map to the table rows in order: 1 → the seven `liveClaims` rows; 2 → the three
`selectReady` rows; 3 → the hermetic default (`node --test orchestration` green with no git access);
4 → the `cycle.mjs` line, asserted in `cycle-boundary.test.mjs` or a new case in
`worktrees.test.mjs` against a fake writer; 5 → the README sentence (`rg -n "worktree holds"
orchestration/README.md`).

## Do not
Read `state.json` to decide a claim beyond `isDone` (the hold exists precisely for work `state.json`
does not know). Remove or reset any worktree. Touch `dispatch.mjs`, `adopt.mjs` or `merge-bar.mjs`.
Make `git` a dependency of any fixture-board test.
