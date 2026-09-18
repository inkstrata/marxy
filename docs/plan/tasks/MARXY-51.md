---
key: MARXY-51
design: [14-release]
depends: [MARXY-31, MARXY-39]
verify: [pnpm precheck, pnpm done MARXY-51]
---
# MARXY-51 — Work the taste-review backlog in priority order

**Design:** none of its own; each item names the design it changes. [14-release](../../design/14-release.md) §The v1 gate is what this story must leave true · **Depends on:** MARXY-31, MARXY-39 (reviews #1 and #2 decided) · **ADRs:** ADR-0014, ADR-0016.

**Outcome.** Every "change it" decision from taste reviews #0–#3 is done, each as a before/after pair a human signed off, so v1 ships with no open reader-visible objection.

**This story is a container, not a unit of work.** An implementor does not take MARXY-51. When it becomes ready, the planner runs this procedure and dispatches the children.

## Procedure (planner)
1. Read `docs/taste-review/queue.md` and every `docs/taste-review/review-*/decisions.md`. Collect rows whose Decision is a change request (not "accept", not "pending").
2. For each, write a child story `MARXY-NEW-taste-<review>-<n>` with: the queue row quoted; the design section it changes (edit the design first if the decision contradicts it — the reviewer's decision wins over a design); paths; acceptance = "the before/after pair at the same corpus passage, dark first, attached to the PR and a new queue row asking the reviewer to confirm". Label `taste`, phase 4.
3. Order the children by the reviewer's stated priority; where none is stated, by content-type priority (READMEs, AI artifacts, source, prose — `AGENTS.md`) and then by how many corpus documents the change affects.
4. Children whose paths overlap are chained in `deps.json`; the rest run in parallel.
5. MARXY-51 is done when every child is done **and** each child's confirmation row has a decision of "accept".

## Tests → expected
| Check | Expect |
| --- | --- |
| queue | no row older than review #3 without a decision |
| children | each closed with a before/after pair and a reviewer decision recorded (the CSV criterion) |

## Do not
Start a child without a recorded decision. Batch unrelated fixes into one child. Treat "pending" as "accept".
