# splice-all: review (Opus)

**Verdict: ready after my fixes.** Branch at `9b097001`, tree clean. Verify turn 11/11 on `9eac9e19` (browser 344 pass); the later commit is a comment only. typecheck, lint, check pass.

## Claims checked

- Store region parse: `reparse` hands `reparsedAst` the bytes before and after; `reparseMarkdown` derives the changed range itself, so an undo's inverse range comes out right without being passed.
- Store-chain test compares `JSON.stringify` of the store's parse with `parseMarkdown` of its bytes (a real whole-parse check). Link and footnote definitions added to its random pieces; still passes.
- Exceptions: rename sets whole (every node's file changes); unchanged bytes: `commitEdit` calls `view.repaint()` only when `byteChange` is null, so it cannot hide a real change.
- Nothing depends on the old "not a reload" string; only footnote tests assert a reason.

## Item 3: new browser tests in `apps/desktop/test/splice-all.test.mjs`

On a long page, cursor below the change and find open on "needle", a tick, undo, redo and a Source commit above the reader. After each: the page was patched, not set whole; no kept paragraph set twice and the new ones get set; cursor, find count and current match unchanged; top block within 2 px; a cursor on the changed block moves to its replacement. Proved by mutation: without `typeset?.adopt(added)` it fails; without the spliced `afterRender()` it fails. Images, maths, diagrams and highlighting skip done work (by reading). Outline, crumbs and spine re-read after any document change (by reading).

## Bug fixed (`1a1ee517`)

After a splice, `splicePageNow` showed notices for the focused pane's file in the focused pane: a reload in the other pane put its "image over plain http" notice in the wrong pane. Predates the branch on reloads; the branch made it reachable from every change. Now passes the right file, buffer and pane; the new test failed before the fix.

## Other commits

- `9eac9e19`: a code file's whole reparse reuses the buffer's decoded text instead of decoding again (the branch had added a second decode per edit, undo and redo of code or log files).
- `9b097001`: `incremental.ts` header comment now names every change the splice takes.

## To file

- Measuring tool ignores `--docs`.
- Numbers not re-measured after the fixes.

## Orchestrator notes

The integration measurement will re-take the numbers on the wave 3 tip.
