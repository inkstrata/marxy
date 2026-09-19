---
key: MARXY-120
design: [10-gates-and-testing]
depends: []
verify: [node --test orchestration/planner-trigger.test.mjs orchestration/phases.test.mjs, node --test orchestration/test]
---
# MARXY-120 — Fire the planner on the signals that mean something, and stop firing on the ones it has answered

**Depends on:** nothing · **ADRs:** none. Scope widened by the 2026-09-19 after-65 delta; the original
card was the first section only.

**Outcome.** `plannerReasons` says yes when the fleet is spending itself on its own machinery, and stops
saying yes because of a story the planner has already ruled on. A settled story is settled everywhere:
`ready.mjs` refuses it by name instead of by accident.

## Why the second half exists

`planner-trigger.mjs` counts every story whose state is `blocked` or `escalate`, unless the CSV row is
labelled `dropped` or `human-gated`. Nothing stamps *when* a story was blocked and nothing records that the
planner has read it, so MARXY-36 and MARXY-115 made the trigger due on three consecutive passes after both
had been ruled on — and each pass had to spend its opening paragraph saying so again. The `dropped` label
has the mirror-image hole: the trigger honours it, `ready.mjs` does not, so a dropped row with paths and
acceptance is still dispatchable, and one without them is refused for the wrong reason
(`empty Acceptance`) which reads as a badly written story rather than a settled one.

## Files and signatures
- `orchestration/planner-trigger.mjs` — `plannerReasons` gains `d = deps()`; the ops-majority reason; the
  `blockedAt` comparison against `s.lastPlan`.
- `orchestration/planner-trigger.test.mjs` — new file; inject `s`, `m`, `all`, `d`, `now`.
- `orchestration/state.mjs` — `block` and `escalate` (and `return` when it lands on `escalate`) set
  `st.blockedAt = new Date().toISOString()`.
- `orchestration/ready.mjs` — `RULE.DROPPED = 'dropped'`, checked before the acceptance and paths rules.
- `orchestration/test` — a fixture board case for the dropped rule.
- `docs/roadmap.md` — one row in the tripwire table.

## Do this, in order
1. Ops majority: take the 10 stories with the latest `finished`, count those whose `phaseOf` is not a
   finite number, fire when the count is more than 5, and name the counts in the reason.
2. `blockedAt` in `state.mjs`. Do not backfill: a story blocked before this lands has no stamp.
3. In `plannerReasons`, count a `blocked`/`escalate` story when `blockedAt` is absent **or** later than
   `lastPlan`. Absent counts, so nothing is silently dropped while the stamps fill in.
4. `RULE.DROPPED` in `ready.mjs`, ahead of `EMPTY_ACCEPTANCE` and `EMPTY_PATHS`.
5. The roadmap row.

## Tests → expected
| Check | Expect |
| --- | --- |
| last 10 finished: 6 ops / 4 phase | reason `6 of the last 10 merges were ops` |
| 5 ops / 5 phase; 9 finished in total | no such reason |
| blocked, `blockedAt` before `lastPlan` | no `escalated/blocked` reason |
| blocked, `blockedAt` after `lastPlan` | reason names the key |
| blocked, no `blockedAt` | reason names the key |
| `state.mjs block KEY` / `escalate KEY` | `blockedAt` is an ISO string in `state.json` |
| a `dropped` row with paths and acceptance | absent from `ready`, `blockedByDeps` and `blockedByPaths`; `excluded` carries `RULE.DROPPED` |
| never-planned, merge count, weekly age | unchanged, asserted by a case each |
| `orchestration/phases.test.mjs` | passes unchanged |

## Acceptance → check
The seven criteria on the CSV row, each named to a case in `planner-trigger.test.mjs` or the
`orchestration/test` fixture board.

## Do not
Change the merge-count, never-planned or weekly triggers or their thresholds. Read git history —
`finished` in `state.json` is the source. Backfill `blockedAt` for stories already blocked. Touch
`orchestration/cycle.mjs` (MARXY-117 and MARXY-118 own it).
