---
key: MARXY-43
design: [03-selection-and-operations, 01-buffer, 02-render]
depends: [MARXY-42]
verify: [pnpm precheck, pnpm done MARXY-43]
---
# MARXY-43 — Operations: toggle task item and align table pipes

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) §`toggle-task`, §`align-table-pipes`, §Applying an operation · [01-buffer](../../design/01-buffer.md) §Undo, §Line endings · [02-render](../../design/02-render.md) post-pass 7 · **Depends on:** MARXY-42 (registry and `apply`) · **ADRs:** ADR-0004.

**Outcome.** Clicking a task checkbox rewrites only its three marker bytes and the document re-renders in place; "Align table" in the palette lines up a table's pipes and says what it did. `Mod+Z` undoes either in one step. The buffer is now dirty (`state.dirty`); the title indicator and saving are MARXY-49.

## Files and signatures
- `packages/core/src/operations/toggle-task.ts`, `align-table-pipes.ts`, `display-width.ts` (the §03 step-4 width function, exported for tests), added to `OPERATIONS`.
- `packages/core/src/operations/operations.test.ts` — extend with both tables.
- `packages/core/scripts/fidelity.ts` — the operations property: every operation at every applicable node of every corpus file changes nothing outside `range`.
- `apps/desktop/src/render/tasks.ts` — post-pass 7: checkbox `click` → `preventDefault()`, resolve marker via the node map, `apply(toggleTask, …)`.
- `apps/desktop/src/commands/document.ts` — `undo` (`Mod+Z`) and `redo` (`Mod+Shift+Z`) in Rendered mode over `History`; one line in `commands/index.ts`.
- `apps/desktop/test/operations-edit.test.mjs` (app harness).

## Do this, in order
1. `toggle-task` per §03, including `listItem` → first marker child. `X` is treated as checked.
2. `display-width.ts` then `align-table-pipes` per the seven steps; each rewritten line keeps its own ending (never `eolString` for an untouched line).
3. Fidelity property extended; run it.
4. `tasks.ts` post-pass; undo/redo commands; the summary notice for align.

## Tests → expected
| Check | Expect |
| --- | --- |
| §03 tables (both) | pass verbatim, including the 40-row table in < 5 ms (`performance.now()` around `run`, measured ×10, median) |
| fidelity property | green; neutralise the line-ending preservation → the CRLF case fails |
| Playwright: click the first checkbox in `03-ai-plan.md` | the only differing byte in `state.document.buffer.bytes` vs the original lies inside the marker's 3-byte range; `[ ]` ↔ `[x]`; re-rendered checkbox reflects it; reading position unchanged (same first visible block) |
| `Mod+Z` | bytes identical to the original; `Mod+Shift+Z` re-applies |
| align on the `07-cjk.md` table | lines outside the table byte-identical; notice "Aligned 3 columns across 5 rows" (use the fixture's real counts) |
| dirty | `state.dirty` true after an edit; false after undo back to the saved version |

## Acceptance → check
CSV: TaskMarker bytes only → Playwright marker-range diff; table range only → align case; fidelity over the corpus → `pnpm gate:fidelity`; single undo step → `Mod+Z` case; visible summary → notice assertion.

## Do not
Preserve `X` vs `x` (§03 says case is not preserved). Reflow table cell content. Touch line endings of untouched lines. Write to disk.
