---
key: MARXY-120
design: [10-gates-and-testing]
depends: []
verify: [node --test orchestration/planner-trigger.test.mjs orchestration/phases.test.mjs]
---
# MARXY-120 — Fire the planner when process work outnumbers product work

**Depends on:** nothing · **ADRs:** none.

**Outcome.** When the fleet spends most of its merges on the ops lane, the planner is called and
told so, with counts. The roadmap names what that signal reopens.

## Files and signatures
- `orchestration/planner-trigger.mjs` — `plannerReasons` gains `d = deps()`; take the 10 stories with
  the latest `finished`; count those whose `phaseOf` is not a finite number; fire when the count > 5.
- `orchestration/planner-trigger.test.mjs` — new file; inject `s`, `m`, `all`, `d`.
- `docs/roadmap.md` — one row in the tripwire table.

## Tests → expected
| Last 10 finished | Expect |
| --- | --- |
| 6 ops, 4 phase | reason "6 of the last 10 merges were ops" |
| 5 ops, 5 phase | no such reason |
| 9 finished in total | no such reason |

## Do not
Change the other triggers or their thresholds. Read git history; `finished` in state is the source.
