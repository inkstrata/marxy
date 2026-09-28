# ADR-0037 — One document store: the open document has one owner, and changes are transitions

- **Status:** proposed
- **Date:** 2026-09-27
- **Follows:** ADR-0004 (editing is transformation), ADR-0005 (two modes). Restates
  `docs/operations.md` rule 4 and design 01-buffer §Save ("saving stays explicit"), which the running
  app does not follow today.
- **Evidence:** the seams pass (MARXY-248). Its delta is `docs/plan/deltas/2026-09-27-seams.md`, and
  each finding below was reproduced against `origin/main` at `ee33feb`.

## Context

Three modules each hold part of "the open document":

- **`app.ts`** holds the buffer, the AST and node map, the bytes on disk, the view mode and the
  reading anchor, as module-level variables.
- **`selection/view.ts`** keeps a copy of the buffer, the AST and the node map (`ctx`). MARXY-246
  made the copy follow `onDocumentChange`, but it is still a copy.
- **`commands/edits.ts`** keeps the Rendered undo history, plus `savedVersion`, `savedFingerprint`,
  `openSynced` and `historyBase`, as module globals. It detects a change elsewhere after the fact,
  by comparing a content hash.

Each module's tests pass. The failures sit between the modules, and the seams pass reproduced
three of them:

1. **A failed write poisons undo** (data loss). `applyDocumentMutation` pushes the edit, then asks
   `app.ts` to write. When the write fails, the buffer is unchanged, so the hash still matches
   `historyBase` and the entry stays. The next undo splices `after.length` bytes, which is longer
   than the table that was never aligned, and writes the result. On `03-ai-plan.md` this deleted
   196 bytes after the table, including a heading.
2. **Undo is dead after Source mode.** Toggle a task, type in Source, return, then Cmd+Z twice:
   nothing changes. The Source edit reached the buffer but not the history, and the hash compare
   then cleared the Rendered history. `leaveSourceMode` returns an `edit` for exactly this purpose,
   and `app.ts` drops it.
3. **Operations write to disk; Source edits do not.** MARXY-43 made every Rendered operation call
   `writeFileAtomic`, against `operations.md` rule 4 and MARXY-49's "Do not: Autosave". A Source
   edit stays in the buffer until the next Rendered operation writes it as a side effect. The dirty
   flag describes neither.

`AppHandle.dispatch()` and `commands()` have been stubs since MARXY-95. The shape they point to
was never built, and each fix since then has added one more holder of the document.

## Decision

1. **One store.** `apps/desktop/src/document/store.ts` owns the open document:

   | Field | Meaning |
   |---|---|
   | `path` | Canonical path |
   | `disk` | The bytes last read or written |
   | `buffer` | The current bytes |
   | `ast`, `nodeMap` | The parse of the buffer |
   | `mode` | Rendered or Source |
   | `history` | One undo history for both modes |
   | `anchor` | The byte the reader is held at |
   | `version` | A counter |

   No other module keeps a field of this record at module scope. Readers call `snapshot()` or
   `subscribe()`. A snapshot is immutable, and its `version` says whether it is stale.
2. **Every change is a transition.** The store has seven:
   - `open`
   - `reload` (new bytes from disk)
   - `apply` (an operation's edit)
   - `commitSource` (leaving Source with changed text)
   - `switchMode`
   - `save`
   - `close`

   `AppHandle.dispatch()` is how commands reach them. Every transition runs through the existing
   `serially` queue, so no two interleave. `commitEdit` and `reloadOpenFromDisk` stop existing as
   separate paths.
3. **History follows the buffer, not a hash.** `apply` and `commitSource` push exactly one entry
   each; a Source session is one entry, labelled "edit in Source". `open` clears the history, and
   so does a `reload` that conflicts with unsaved edits. A `reload` into a clean buffer maps the
   history's ranges through the change where it can and clears it where it cannot. The hash
   compare in `historyFor` is deleted. CodeMirror keeps its own history only for the length of one
   Source session.
4. **Commit, then record.** A transition changes the store only after every effect it depends on
   has succeeded. A failed effect leaves the store exactly as it was, with a notice.
5. **Saving is explicit, as the design already says.** `apply` does not write. `save` writes
   `buffer` atomically and sets `disk`. `dirty` is `buffer ≠ disk`, derived rather than stored.
   Until MARXY-49 ships `Mod+S`, the store calls `save` right after `apply`, as a named,
   temporary step, so behaviour does not regress. MARXY-49 deletes that step.
6. **The reading anchor is mapped, not released.** An edit at `[start, end)` with a replacement
   of length `n` moves an anchor after `end` by `n − (end − start)`. An anchor inside the range
   moves to `start`. A `reload` maps the anchor through the `ReadingPosition` that
   `applyWatchToOpenDocument` already computes. This replaces MARXY-246's release, which gave up
   the held line on every tick.

## Consequences

- **`selection/view.ts`, `commands/edits.ts` and `render/tasks.ts`** lose their document state.
  A gate rejects a module-level `let` holding a buffer, AST, node map or history outside
  `document/store.ts`.
- **MARXY-49 (explicit save) depends on the store story** and removes the temporary save-after-apply.
- **Relative links opened in Marxy (MARXY-240)** become `open` transitions. "Back" is a stack of
  previous `open`s, kept by the store.
- **Reversal cost:** low. The store is internal to `apps/desktop`. No contract under
  `packages/*/src/contracts/` changes, and neither does `shell-api`.
- **Not decided here:** more than one open document, and conflict UI (MARXY-49 and design
  08-position-and-watching own it).
