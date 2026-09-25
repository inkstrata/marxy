---
key: MARXY-213
design: []
depends: [MARXY-202]
verify: [pnpm precheck, pnpm done MARXY-213]
---
# MARXY-213 — A merged story is never offered again

**Authority:** [`orchestration/README.md`](../../../orchestration/README.md) "The loop" §1 (what
`ready.mjs` refuses and why) and "Rules the scripts enforce". No `docs/design/` section covers the
fleet; the README is the design for orchestration behaviour, and this story edits it. · **Delta:**
[2026-09-25](../deltas/2026-09-25.md) · **Lane:** ops. Dispatch it **alongside** a product story, never
instead of one (roadmap ops-majority tripwire). It shares `ready.mjs`, `cycle.mjs` and the README with
MARXY-202, which reached review first (PR #196), so this story depends on it: cut it from
`origin/main` after MARXY-202 merges, and build `selectReady`'s `merged` input on top of MARXY-202's
worktree reservations rather than beside them.

**Outcome.** The board cannot send an implementor to redo work that is already on `main`. The cycle
reads `main`'s squash subjects once per cycle, settles as done any merged key that the board has no
record for or still calls `todo`, names any merged key the board thinks is still live, and
`ready.mjs` refuses a merged key by name.

## What is wrong today
`selectReady` reads a missing `state.json` record as `todo` (`statusOf = k => s.stories[k]?.status ??
'todo'`). A PR that merges before the cycle adopts it never gets a record. That happens to out-of-plan
work opened and merged by hand, and to rows written before MARXY-190 added `no-dispatch`. On
2026-09-25 three keys were in that state:

| Key | Merged | Labels | Effect |
| --- | --- | --- | --- |
| MARXY-183 | #180 (`063ee42`) | `phase-2,desktop,out-of-plan` | offered as **ready**; its paths (`app.ts`, `main.rs`, `shell/tauri.ts`) held MARXY-193, 44 and 48 |
| MARXY-186 | #171 (`a9f3a3b`) | `ops,out-of-plan` | excluded only because it yields to MARXY-183; would be offered the cycle after |
| MARXY-210 | #193 (`d373abc`) | `ops,out-of-plan,no-dispatch` | harmless (`no-dispatch`, and `adopt.mjs` settles a merged `no-dispatch` row), but `todo` until a cycle runs |

`adopt.mjs` already settles merged `no-dispatch` rows (MARXY-190). This story covers every other row:
the label cannot be the only thing that stops the fleet redoing merged work.

The squash subject is already the record: every PR the cycle or a person lands ends
`… (KEY) (#n)` (`docs/conventions.md`; `merge-bar.mjs` squashes).

## Files and signatures
- `orchestration/ready.mjs`
  - `export function mergedOnMain(subjects: string[]): Map<string, number>`: for each subject that
    matches `/\((MARXY-\d+)\) \(#(\d+)\)$/`, key → PR number. The first match wins when a key merged
    twice, because `git log` lists newest first. No other place in the subject counts.
  - `RULE.MERGED_ON_MAIN = 'merged on main'`.
  - `selectReady({ ..., merged = new Map() })`. Before any other classification, a story whose key
    is in `merged` and is not `done` goes to `excluded` as `{ key, rule: RULE.MERGED_ON_MAIN, pr }`
    and nowhere else. It is not counted in `reserved`, and its paths are not busy.
  - The CLI (`isMain`) block passes `merged: mergedOnMain(git log origin/main --format=%s)`. The
    default stays empty so fixture tests never touch git.
- `orchestration/cycle.mjs`
  - `export function settleFromMain(merged, s) → { settle: {key, pr}[], flag: {key, pr, status}[] }`,
    a pure function. A missing record or `todo` goes to `settle`. `in_progress`, `in_review`, `blocked`
    or `escalate` goes to `flag`. `done` goes to neither.
  - In `runLockedCycle`, after the review queue and before `selectReady`, read the subjects once with
    the existing `git` helper and run `node state.mjs done KEY` for each `settle` entry (skip it under
    `--dry-run`, but still print). Print `settled from main: MARXY-183 (#180)` for each. For each
    `flag` entry, print `merged on main but in_review: KEY (#n)` and write nothing. Both lines go into
    `status.md` under "This cycle". Pass the same `merged` map to `selectReady`.
- `orchestration/README.md`, "The loop" §1: one sentence. *A key whose squash commit `(KEY) (#n)` is
  on `main` is settled from `main` and never dispatched; if the board thinks it is still live, the
  cycle names it and writes nothing.*
- `orchestration/ready.test.mjs`, `orchestration/cycle-boundary.test.mjs`: the cases below.
- `CHANGELOG.md`: one line ending `(MARXY-213)`, with the real key after sync.

## Do this, in order
1. `mergedOnMain` and its tests.
2. `RULE.MERGED_ON_MAIN` and the `merged` input to `selectReady`; tests; the CLI default.
3. `settleFromMain` and its tests; the `runLockedCycle` wiring; the source-order assertion.
4. README sentence and CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `mergedOnMain(['feat(desktop): route second launches to the running window (MARXY-183) (#180)'])` | `Map { 'MARXY-183' => 180 }` |
| `mergedOnMain(['chore(orchestration): record MARXY-198 needs-human gate (MARXY-201)'])` | empty (no `(#n)`) |
| `mergedOnMain(['chore(plan): align MARXY-46/47 board rows (MARXY-176) (#166)'])` | only `MARXY-176` |
| `mergedOnMain` with the same key at #200 (newer) then #150 | `200` |
| `selectReady`: todo story in `merged`, no record in `s` | not in `ready`/`blockedBy*`; `excluded` has `{ key, rule: 'merged on main', pr }` |
| `selectReady`: same board, `merged` empty | the story is in `ready` |
| `selectReady`: merged story on `app.ts`, second todo story on `app.ts` | the second story is in `ready` (the merged one reserves nothing) |
| `selectReady`: story in `merged` and `done` in `s` | same as today, not in `excluded` |
| `settleFromMain`: missing record, `todo`, `in_review`, `blocked`, `done` | `settle` has the first two, `flag` the next two, the `done` key is in neither |
| `cycle-boundary.test.mjs` source order | `settleFromMain(` appears before `selectReady(` in `runLockedCycle`, both inside the locked body |
| `node --test orchestration` | green, with no git access from any fixture-board test |

## Acceptance → check
CSV criteria 1–6: 1 → the four `mergedOnMain` rows. 2 → the four `selectReady` rows, plus the
hermetic default (`node --test orchestration` green). 3 → the `settleFromMain` row. 4 → the
source-order row, plus a `--dry-run` cycle in this checkout printing the lines (paste the output in
the PR). 5 → `rg -n "settled from" orchestration/README.md`. 6 → `rg -n "MARXY-" CHANGELOG.md`
(the new line).

## Do not
- Write anything for a `flag` key. A merged key that the board thinks is in review or in progress
  needs a person to look; the cycle names it and moves on.
- Reopen, split or relabel any row. Parse commit bodies or trailers.
- Call GitHub. The squash subject on `origin/main` is the evidence, and the cycle already reads
  GitHub once per cycle (MARXY-191).
- Touch `dispatch.mjs`, `reap.mjs`, `adopt.mjs`, `merge-bar.mjs` or `state.mjs`. Settling uses
  `state.mjs done` as it is, so a settled merge also counts toward `merges` (it was a real merge).
- Make `git` a dependency of any fixture-board test.
