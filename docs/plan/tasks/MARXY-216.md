---
key: MARXY-216
design: []
depends: [MARXY-202]
verify: [pnpm precheck, pnpm done MARXY-216]
---
# MARXY-216 — A conflicted pull request is rebased or parked

**Dropped** (late pass, 2026-09-25). MARXY-217 merged as #203 and starts one conflict resolver.
Do not implement this card. The label on the CSV row is `dropped`.

**Authority:** [`orchestration/README.md`](../../../orchestration/README.md) "The loop" (review order,
DIRTY return) and `docs/sdlc.md` (a DIRTY pull request returns to In Progress). No `docs/design/`
section covers the fleet; the README is the design, and this story edits it. · **Delta:**
[2026-09-25](../deltas/2026-09-25.md) · **Lane:** ops. It unblocks Phase 3, so it proceeds once
MARXY-202 has merged. It shares `cycle.mjs` with MARXY-202 (PR #196, in review); cut it from
`origin/main` after that merges. Do not start it while MARXY-43 or MARXY-197 are still DIRTY.

**Outcome.** A pull request GitHub calls DIRTY is rebased once by the cycle. If the rebase is clean,
the story stays in review. If it still conflicts, the story is parked `blocked` with the files named,
and the cycle does not write `orchestration/needs-human.md`.

## What is wrong today
`processReviewQueue` in `orchestration/cycle.mjs` sees `mergeStateStatus === 'DIRTY'`, calls
`returnDirty`, and moves the story to `in_progress`. `ready.mjs` never offers an `in_progress` story.
`reap.mjs` classifies a row with an open pull request as live. On 2026-09-25 that happened to
MARXY-43 (#199), MARXY-197 (#198) and MARXY-212 (#195) in one cycle, and `ready.mjs` printed an empty
ready list. The BEHIND path already updates one pull request per cycle. DIRTY has no matching owner.

## Files and signatures
- `orchestration/cycle.mjs`
  - `rebaseDirty(key, rec, files, rebase) → 'clean' | 'conflict'`. `rebase` is injected
    `() => { ok: boolean, files: string[] }`. On `ok`, leave the story `in_review` and record one
    rebase attempt on the row (`dirtyRebaseAt`). On failure, `state.mjs`-equivalent park: status
    `blocked`, `parkedReason` naming the files. Never call it twice for the same `dirtyRebaseAt`.
  - `processReviewQueue` calls `rebaseDirty` instead of `returnDirty` when the pull request is DIRTY
    and `rec.dirtyRebaseAt` is unset. A second DIRTY after a recorded rebase parks without rebasing.
- `orchestration/reap.mjs` — an `in_progress` story with an open pull request and no lease whose
  result note contains `DIRTY` is verdict `dirty`, not `live`.
- `orchestration/README.md` — one sentence in The loop: a DIRTY pull request is rebased once and
  parked `blocked` if the rebase still conflicts.
- `CHANGELOG.md` — one line.

## Do this, in order
1. The pure `rebaseDirty` result and its fixture in `cycle-boundary.test.mjs`, with rebase injected.
2. Wire it into `processReviewQueue` in place of the bare `returnDirty` for DIRTY.
3. The reap verdict, with a fixture that a PR-carrying DIRTY row is not `live`.
4. README sentence and CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| DIRTY, `rebase` returns `{ ok: true }`, no `dirtyRebaseAt` | story stays `in_review`; `dirtyRebaseAt` set; rebase called once |
| same story, second cycle, still DIRTY | rebase not called; status `blocked`; files named in the note |
| DIRTY, `rebase` returns `{ ok: false, files: ['CHANGELOG.md'] }` | status `blocked`; note names `CHANGELOG.md`; `needs-human.md` mtime unchanged |
| `reap` on `in_progress`, open PR, note contains `DIRTY`, no lease | verdict `dirty`, not `live` |
| `reap` on `in_progress`, open PR, note has no DIRTY | still `live` (today's rule) |

## Acceptance → check
CSV criteria 1–5: 1 → the first test row. 2 → the second and third rows. 3 → the two reap rows.
4 → `rg -n "rebased once" orchestration/README.md`. 5 → `rg -n "MARXY-" CHANGELOG.md` (the new line).

## Do not
- Write `orchestration/needs-human.md`. A tracked edit there is `dirty-board` and stops dispatch.
- Resolve conflict hunks. A rebase that is not clean parks the story.
- Rebase more than once per story. A second conflict is a person.
- Touch `ready.mjs`, `merge-bar.mjs`, `approve.mjs`, or `packages/*/src/contracts/**`.
- Recut a story worktree. The rebase runs in the worktree the story already has.
