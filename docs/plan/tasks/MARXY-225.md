---
key: MARXY-225
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-225]
---
# MARXY-225 — A retry is not blocked by its own files

**Authority:** [`orchestration/README.md`](../../../orchestration/README.md) "The loop" §1 (what
`ready.mjs` refuses and why). No `docs/design/` section covers the fleet; the README is the design,
and this story edits it. · **Delta:** [2026-09-26-after-223](../deltas/2026-09-26-after-223.md) · **Lane:** ops.
**Dispatch beside a product story, not ahead of one.** Do not start while
`../marxy-wt/MARXY-218` is dirty: its uncommitted row lists `orchestration/ready.mjs` in Paths, so
`ready.mjs` reports a hold on this story. MARXY-223 has merged. MARXY-220 depends on this story
and must not start first. The Jira issue already exists; do not create another.

**Outcome.** The cycle can offer a `todo` story again after a failed attempt left a dirty worktree.
A different story still cannot take those paths. An in-review pull request whose row is not on
main still holds the paths listed on its worktree.

## What is wrong today
`selectReady` in `orchestration/ready.mjs` adds every worktree claim to `busyPaths` unless the
claim's status is `in_progress` or `in_review`. On 2026-09-26 MARXY-195's worker was SIGTERM'd at
the 45-minute cap (`orchestration/results/MARXY-195.dispatch.log`: `exit 143, result failed, now
todo`). The worktree `../marxy-wt/MARXY-195` is dirty, ahead 0, and two commits behind
`origin/main`. Status is `todo`, attempts is 1. `ready.mjs` then excludes MARXY-195 with
`worktree holds` by MARXY-195, and the cycle only dispatches keys in `ready`. The same filter
drops a claim whose status is `in_review` even when that key has no row in the CSV the cycle
reads. MARXY-223 was that case until #207 merged. The next out-of-plan pull request whose row
is only on its branch has the same hole.

## Files and signatures
- `orchestration/ready.mjs` — replace the single `activeClaimPaths` list with `claimsAgainst(key)`:
  - drop a claim that has no `paths`
  - drop a claim whose `key` equals the story being classified
  - drop a claim when `occupies(statusOf(claim.key))` is true and `all` contains that key
  - keep every other claim, including an occupying status whose key is absent from `all`
  Use `claimsAgainst(st.Key)` for the overlap test and for `worktreeBlocker`. Leave
  `busyPathsFromState` as it is: an `in_progress` or `in_review` row on this board still blocks.
- `orchestration/ready.test.mjs` — the two cases below. Both inject `all`, `s` and `claims`; neither
  reads a worktree. The test `a claim whose key is already in_progress does not change ready` stays
  green and is not rewritten.
- `orchestration/README.md` — in The loop item 1, immediately after the sentence that contains
  `worktree holds`, add two sentences: "A story is not blocked by its own worktree. An in-review
  or in-progress key with no row on this board still holds the paths on its worktree claim."
- `CHANGELOG.md` — one line ending with this story's real key.

## Do this, in order
1. The two tests, red.
2. `claimsAgainst` in `selectReady`.
3. The README sentences and the CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `all` is MARXY-195 (`apps/desktop/src/app.ts`, `todo`) and MARXY-196 (same path, `todo`); `claims` is one dirty claim for MARXY-195 on that path | `ready` includes MARXY-195; MARXY-196 is in `blockedByPaths` and `excluded` is `{ key: 'MARXY-196', rule: 'worktree holds', by: 'MARXY-195' }` |
| `all` is only MARXY-220 (`orchestration/cycle.mjs`, `todo`); `s.stories['MARXY-900']` is `{ status: 'in_review' }` and MARXY-900 is not in `all`; `claims` is one claim for MARXY-900 on `orchestration/cycle.mjs` | MARXY-220 is not in `ready`; `excluded` names `worktree holds` by MARXY-900 |
| existing test `a claim whose key is already in_progress does not change ready` | still passes, unmodified |

## Acceptance → check
CSV criteria 1–5: 1 → the first test row. 2 → the second test row plus the existing in_progress test. 3 → `rg -n "own worktree" orchestration/README.md`. 4 → `rg -n "MARXY-" CHANGELOG.md` (the new line). 5 → `node --test orchestration/ready.test.mjs`.

## Do not
- Change `liveClaims` in `worktrees.mjs`. Skipping `blocked` and `escalate` is MARXY-220, and it depends on this story. Keep MARXY-222's prunable skip and `prState`.
- Delete, clean, or recreate `../marxy-wt/MARXY-195`. The uncommitted files are the attempt.
- Treat a missing `state.json` record as free. MARXY-218 and MARXY-211 have no record and must keep holding.
- Touch `dispatch.mjs`, `cycle.mjs`, `reap.mjs`, or `packages/*/src/contracts/**`.
- Edit ADR-0025, or add ADR-0034. Another session owns that proposal.
- Create a second Jira issue. This key already exists.
