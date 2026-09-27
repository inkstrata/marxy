---
key: MARXY-195
design: [08-position-and-watching, 11-config-and-storage]
depends: [MARXY-193, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-195]
---
# MARXY-195 — Remember where the reader was, across launches

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) (`positions.json`) ·
[11-config-and-storage](../../design/11-config-and-storage.md) (locations) ·
**Delta:** [2026-09-27-marxy-195](../deltas/2026-09-27-marxy-195.md) · **ADRs:** ADR-0018, ADR-0026
(`configPaths`) · **Depends on:** MARXY-193, MARXY-94 · **Finishes:** MARXY-38 (persistence class,
never constructed) and the `configPaths` half of MARXY-177 (the theme key never loads until the
shell has `configPaths`).

**Outcome.** Quit and reopen a document, and it opens where you left it. A `theme` key in
`config.toml` takes effect in the shipped app.

**Where this came from.** Split on 2026-09-27 after PR #227 was returned. The palette pin test
wrote `history.json` by hand and never called `quit`. That half is MARXY-262.
Resume in `../marxy-wt/MARXY-195` on `origin/feat/MARXY-195-remember-reading-across-launches` at
`b82dc8e`. Keep position, `configPaths` and the theme key. Delete the history parts from the
branch tip in a new commit. Do not force-push `b82dc8e` away: the follow-up reads it.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs` (or `commands/`): `config_paths() -> { config, data }` per
  design §11 (platform directories; create them if missing). Registered. Already on `b82dc8e`.
- `apps/desktop/src/shell/tauri.ts`: `configPaths` under the ADR-0026 name and signature.
- `apps/desktop/src/shell/memory.ts`: `configPaths` returning fixed paths inside the store.
- `apps/desktop/src/app.ts`: after `first_text`, construct one `PositionPersistence` (from
  `@marxy/core` position) over `configPaths().data`. On scroll (debounced by the class), on
  `openDocument` of another file, and on quit, record `currentPosition(...)`. In `openDocument`,
  restore the saved position for that path when no explicit `at` is given. `quit` flushes reading
  position only.
- `apps/desktop/test/persist-reading.test.mjs`: Playwright over the real boot, two launches sharing
  one memory store. No palette history.

## Do this, in order
1. From `b82dc8e`, drop `apps/desktop/src/palette/history.ts` and the `session.ts` hunk (restore
   both to `origin/main`).
2. In `app.ts`, delete `loadPaletteHistory`, `flushPaletteHistory`, `trackDocumentOpen`,
   `resetPaletteHistoryMirror` and every import from `palette/history.ts`. Leave
   `ensurePersistenceLoaded` opening `PositionPersistence` only, still after the `first_text` mark.
   `quit` calls `flushReadingPersistence` only.
3. In `persist-reading.test.mjs`, delete the palette pin test, the `history.json` envelope test
   and the `serializeHistoryFile` node test. Keep the scroll restore, the theme key, the
   `configPaths` source check and the `first_text` order.

## Tests → expected
| Check | Expect |
| --- | --- |
| persist: launch 1 on corpus `01-long-technical.md`, scroll a block to the reading line, `quit(0)`; launch 2 on the same file, same store | first visible block's byte offset equals launch 1's, within one line |
| persist: `positions.json` after that quit | design §08 shape, `version: 1` |
| persist: `config.toml` with `theme = "/t/quiet"` and that theme dir | the user theme's stylesheet is applied, and `configPaths` is recorded after `first_text` |
| memory-shell call record | no persistence read or write before `first_text` |
| `rg -n "history.json" apps/desktop/test/persist-reading.test.mjs` | no match |
| `rg -n "palette/history" apps/desktop/src/app.ts` | no match |
| `rg -n "configPaths" apps/desktop/src/shell/tauri.ts` | a match |

## Acceptance → check
The CSV row's criteria are the table rows.

## Do not
Store `scrollTop` (ADR-0018: a byte offset and fraction). Read or write before `first_text`. Edit
`apps/desktop/src/palette/history.ts` or `session.ts` (MARXY-262). Import either
from `app.ts`. Touch `packages/shell-api` or `packages/core/src/position` beyond calling it.
Force-push away `b82dc8e`.
