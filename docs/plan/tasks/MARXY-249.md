---
key: MARXY-249
design: [01-buffer, 09-app-shell, 08-position-and-watching]
depends: []
verify: [pnpm precheck, pnpm done MARXY-249]
---
# MARXY-249 — One document store (ADR-0037)

**Design:** [01-buffer](../../design/01-buffer.md) · [09-app-shell](../../design/09-app-shell.md) · [08-position-and-watching](../../design/08-position-and-watching.md) · **ADR:** [ADR-0037](../../adr/0037-one-document-store.md) (proposed; this story is `human-gated` until it is accepted) · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md) · **Owner:** claimed by the MARXY-248 session.

**Outcome.** Undo always walks back exactly what the reader did, in either mode, and never writes bytes the reader did not change, even when a save fails.

## What is wrong today
Reproduced on `origin/main` at `ee33feb` with [h5-h6-undo.test.mjs.txt](../deltas/evidence/2026-09-27-seams/h5-h6-undo.test.mjs.txt):
- **H5 (data loss):** with `writeFileAtomic` rejecting, align the first table of `03-ai-plan.md`, restore, undo: the file goes from 1907 to 1711 bytes. The undo spliced `after.length` bytes over a table that was never aligned.
- **H6:** toggle a task, type in Source, return, Cmd+Z twice: nothing changes, and the Source text is in the buffer but not on disk.

## Files and signatures
- `apps/desktop/src/document/store.ts` — new: `createDocumentStore(shell)` → `{ snapshot(), subscribe(fn), dispatch(transition) }`; transitions `open`, `reload`, `apply`, `commitSource`, `switchMode`, `save`, `close`, each through `serially`.
- `apps/desktop/src/app.ts` — the module-level document variables move into the store; `dispatch()` stops being a stub; `commitEdit` and `reloadOpenFromDisk` become `apply`+`save` and `reload`.
- `apps/desktop/src/selection/view.ts`, `apps/desktop/src/commands/edits.ts`, `apps/desktop/src/render/tasks.ts` — read snapshots; no module-level document state.
- `apps/desktop/src/source/buffer-commit.ts` — its `edit` becomes one `commitSource` history entry.
- `scripts/check-boundaries.mjs` — the module-state rule.

## Do this, in order
1. Land the evidence tests as `document-store.test.mjs`; show them failing.
2. The store and its transitions, with unit tests on the memory shell.
3. Move `app.ts` state; then `view.ts`; then `edits.ts` (push history only after the effect succeeds).
4. Source sessions as one entry; anchor mapping.
5. Keep the write after `apply` as a named temporary step (`saveAfterApply`); MARXY-49 deletes it.

## Tests → expected
| Check | Expect |
| --- | --- |
| failed save, then undo | disk byte-identical to the corpus file |
| Rendered edit, Source edit, two undos | buffer equals the corpus file |
| edit before the anchor | anchor moves by the length delta |
| a `let history` planted in `selection/` | check-boundaries fails |

## Acceptance → check
See the CSV row; every clause names its test.
