---
key: MARXY-255
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-255]
---
# MARXY-255 — One outcome table, and a simulation over the event log

**ADR:** ADR-0034 (every state has an owner and a way out) · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md) · **Priority:** low; the planner defers it behind phase work while the ops-majority tripwire is near.

**Outcome.** A machine fault can never look like a story problem, because one table decides what each run outcome does, and a simulation checks it.

## What is wrong today
Outcome strings are produced in `worker.mjs` (`auth`, `exited`, `timeout`, `stalled`, `setup`) and `cycle.mjs` (`not-started`, `setup`), and classified in `runs.mjs` `finishRun`, `doctor.mjs` and `fleet.mjs`. The ghost threshold is `GHOST_BYTES` in one file and a literal in another.

## Tests → expected
| Check | Expect |
| --- | --- |
| 10,000 seeded random outcome sequences through `machine.mjs` | no stranded story; no dispatch freeze on a machine fault; no double-counted try |
| outcome literals outside `outcomes.mjs` | test fails |
