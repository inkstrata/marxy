---
key: MARXY-253
design: [01-buffer]
depends: [MARXY-231]
verify: [pnpm precheck, pnpm done MARXY-253]
---
# MARXY-253 — Containers in the corpus, and every operation on every eligible node

**Design:** [01-buffer](../../design/01-buffer.md) · **Depends on:** MARXY-231 (task markers and the fidelity property) · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md)

**Outcome.** The corpus contains the shapes that broke table alignment, so a regression in any operation fails before it ships.

## Context
MARXY-246 fixed `alignTablePipes` for containers. The seams pass tried eight harder shapes against `ee33feb` and all kept their bytes and table shape. This story makes that permanent coverage and widens it to every operation. `displayWidth` is already linear (the handoff's quadratic note predates MARXY-246).

## Do this, in order
1. `24-containers.md` (LF) and `25-containers-crlf-bom.md`: tables in a quote, a nested quote, a list, a quote inside a list, an indented table, tasks in nested quotes, wide/emoji/combining cells.
2. Regenerate goldens and baselines for the two new files only; one taste-review queue row for their renders.
3. The operation × node property in `operations.test.ts`.
4. `toggle-task`'s list-item branch: delete it or make it reachable, with a test.

## Tests → expected
| Check | Expect |
| --- | --- |
| every operation × every node its `canApply` accepts × every corpus file | bytes outside the range unchanged; kind and table shape survive a reparse |
