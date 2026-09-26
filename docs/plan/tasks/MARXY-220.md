---
key: MARXY-220
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-220]
---
# MARXY-220 — A blocked story's worktree does not reserve paths

**Authority:** [`orchestration/README.md`](../../../orchestration/README.md) "The loop" §1 (what
`ready.mjs` refuses and why). No `docs/design/` section covers the fleet; the README is the design,
and this story edits it. · **Delta:** [2026-09-25-after-194](../deltas/2026-09-25-after-194.md) · **Lane:** ops.
**Dispatch beside MARXY-195, not ahead of it.** It shares `orchestration/ready.mjs` and
`orchestration/README.md` with the uncommitted MARXY-218 worktree (`../marxy-wt/MARXY-218`,
review occupancy, proposed ADR-0034). Do not start this story while that worktree is dirty.
Do not start it while the orchestrator checkout has uncommitted edits to these files.
Cut it from `origin/main`. MARXY-202 has merged. MARXY-194 has merged.

**Outcome.** A story parked `blocked` or `escalate` keeps its worktree and does not hold the paths
of the next story. A worktree whose key has no `state.json` record still holds its paths.

## What is wrong today
`liveClaims` in `orchestration/worktrees.mjs` skips a key only when `isDone` is true. MARXY-78 has
been `blocked` since 2026-09-20. Its worktree `../marxy-wt/MARXY-78` is behind
`origin/main` (94 commits on 2026-09-25), ahead 0, and dirty (`scripts/gate-fidelity.mjs`, `fixtures/corpus/20-nfd-decomposed.md`,
`fixtures/corpus/21-lone-cr.md`, and their goldens). `ready.mjs` therefore excludes MARXY-44,
MARXY-48 and MARXY-16 with the rule `worktree holds` by MARXY-78. MARXY-194 has merged.
MARXY-195 and MARXY-196 do not overlap MARXY-78 (`atomic_write.rs` is a sibling of their Rust
files, not a directory prefix). MARXY-44 overlaps MARXY-78 on `fixtures/corpus` and
`packages/core/goldens`; MARXY-48 overlaps it because its Paths list `apps/desktop/src-tauri/src`
as a directory. Releasing this hold is what lets those two start once MARXY-195 and MARXY-196
leave `app.ts` and `src-tauri`. Un-parking MARXY-78 instead would put that ops story back on the
corpus and the shell, which is why it was parked.

## Files and signatures
- `orchestration/worktrees.mjs`
  - `liveClaims(entries, { ..., isDone, statusOf })`. Keep `isDone`. Add `statusOf = () => undefined`.
    Skip the claim when `isDone(key)` is true or `statusOf(key)` is `done`, `blocked`, or `escalate`.
    `undefined` and every other status still claim when the worktree is dirty or ahead. A missing
    `state.json` record must still claim: that is the out-of-plan worktree MARXY-202 exists for
    (MARXY-218 and MARXY-211 have no record).
- `orchestration/worktrees.test.mjs` — the cases below. Existing `isDone` cases stay green.
- `orchestration/ready.mjs` — `resolveClaims` passes `statusOf: k => s.stories[k]?.status` into
  `liveClaims` (no `?? 'todo'`). A missing record stays `undefined`.
- `orchestration/cycle.mjs` — the `sayWorktreeClaims(liveClaims(...))` call passes the same
  `statusOf` from the board it already loaded.
- `orchestration/README.md` — in The loop item 1, after the sentence that a worktree holds paths,
  add: *A blocked or escalated story's worktree does not reserve paths; the files stay for the next
  attempt. A worktree whose key has no record still reserves.*
- `CHANGELOG.md` — one line ending with this story's real key.

## Do this, in order
1. `statusOf` on `liveClaims` and the tests, with the existing `isDone` tests untouched.
2. Pass `statusOf` from `ready.mjs` and from `cycle.mjs`.
3. README sentence and CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| dirty, ahead, `statusOf` returns `blocked` | no claim |
| dirty, ahead, `statusOf` returns `escalate` | no claim |
| dirty, ahead, `statusOf` returns `todo` | one claim, same paths as today |
| dirty, ahead, `statusOf` returns `in_progress` | one claim |
| dirty, ahead, `statusOf` returns `undefined` | one claim |
| dirty, ahead, `isDone` true and `statusOf` omitted | no claim (today's test still passes) |
| `rg -n "statusOf" orchestration/ready.mjs orchestration/cycle.mjs` | both files pass `statusOf` into `liveClaims` |

## Acceptance → check
CSV criteria 1–4: 1 → the six `liveClaims` rows. 2 → the `rg` row. 3 → `rg -n "blocked or escalated" orchestration/README.md`. 4 → `rg -n "MARXY-" CHANGELOG.md` (the new line).

## Do not
- Skip a key that has no `state.json` record. MARXY-218 and MARXY-211 are that case, and they must keep holding.
- Delete or clean `../marxy-wt/MARXY-78`. The next attempt needs those files. This story only stops the hold.
- Un-park MARXY-78, or edit its row.
- Touch `reap.mjs`, `dispatch.mjs`, `merge-bar.mjs`, or `packages/*/src/contracts/**`.
- Treat `in_review` as parked. An in-review story's worktree still reserves.
