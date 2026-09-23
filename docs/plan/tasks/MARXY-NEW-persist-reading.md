---
key: MARXY-NEW-persist-reading
design: [08-position-and-watching, 07-index-and-palette, 11-config-and-storage]
depends: [MARXY-NEW-one-open-path, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-NEW-persist-reading]
---
# MARXY-NEW-persist-reading — Remember where the reader was, and what they opened, across launches

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) (`positions.json`) ·
[07-index-and-palette](../../design/07-index-and-palette.md) §History, MRU, pins (`history.json`) ·
[11-config-and-storage](../../design/11-config-and-storage.md) (locations, caps) ·
**Delta:** [2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md) · **ADRs:** ADR-0018, ADR-0026
(`configPaths`) · **Finishes:** MARXY-38 (persistence class, never constructed) and MARXY-177 (reads
`config.toml` only when the shell has `configPaths`, which the Tauri shell does not).

**Outcome.** Quit and reopen a document, and it opens where you left it. Summon the palette on a fresh
launch, and the documents you opened last time are listed, pinned ones first. A `theme` key in
`config.toml` takes effect in the shipped app.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs` (or `commands/`): `config_paths() -> { config, data }` per
  design §11 (platform directories; create them if missing). Registered.
- `apps/desktop/src/shell/tauri.ts`: `configPaths` under the ADR-0026 name and signature.
- `apps/desktop/src/shell/memory.ts`: `configPaths` returning fixed paths inside the store.
- `apps/desktop/src/app.ts`: after first text, construct one `PositionPersistence` (from
  `@marxy/core` position) over `configPaths().data`. On scroll (debounced by the class), on
  `openDocument` of another file, and on quit, record `currentPosition(...)`. In `openDocument`,
  restore the saved position for that path when no explicit `at` is given.
- `apps/desktop/src/palette/session.ts` and `history.ts`: load and save `history.json` in the §07
  shape (`version`, `opens`, `pins`, `recentRoots`) with the §11 caps. Writes go through
  `writeFileAtomic`.
- `apps/desktop/test/persist-reading.test.mjs`: Playwright over the real boot, two launches sharing one
  memory store.

## Tests → expected
| Check | Expect |
| --- | --- |
| persist: launch 1 on `/r/long.md` (corpus `01-long-technical.md`), scroll block k to the reading line, quit; launch 2 on the same file | first visible block's byte offset equals launch 1's, within one line (MARXY-38's own criterion, now through `startApp`) |
| persist: launch 1 opens A then B, pins A, quits; launch 2 summons the palette with an empty query | rows are A (pinned), then B |
| persist: `positions.json` and `history.json` in the store | both match the design shapes and parse with `version: 1` |
| persist: `config.toml` in the store with `theme = "t"` and a theme dir | the user theme's stylesheet is applied (MARXY-177's check, through the real shell members) |
| memory-shell call record | no persistence read or write before `first_text` |
| `rg -n "configPaths" apps/desktop/src/shell/tauri.ts` | a match |

## Acceptance → check
The CSV row's criteria are the table rows.

## Do not
Store `scrollTop` (ADR-0018: a byte offset and fraction). Read or write before `first_text`. Add a
"recent files" UI: the palette's empty query is that UI. Touch `packages/shell-api` or
`packages/core/src/position` beyond calling it.
