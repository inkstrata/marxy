---
key: MARXY-195
design: [08-position-and-watching, 11-config-and-storage]
depends: [MARXY-193, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-195]
---
# MARXY-195 — Remember the reading position across launches through configPaths

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) (`positions.json`) ·
[11-config-and-storage](../../design/11-config-and-storage.md) (locations) ·
**Delta:** [2026-09-27-parked](../deltas/2026-09-27-parked.md) · **ADRs:** ADR-0018, ADR-0026
(`configPaths`) · **Depends on:** MARXY-193, MARXY-94. **Finishes:** MARXY-38 (the persistence
class, never constructed) and the theme-key half of MARXY-177 (it reads `config.toml` only when
the shell has `configPaths`).

**Outcome.** Quit and reopen a document, and it opens where you left it. A `theme` key in
`config.toml` takes effect in the shipped app. Pins and the recent-document list are MARXY-262,
not this story.

## Where the returned branch is
PR #227 (`origin/feat/MARXY-195-remember-reading-across-launches` at `b82dc8e`) already restores
the scroll through a real `quit(0)`. Keep that. Delete the palette-history files from the branch
before `pnpm done`. Review note 1 in `results/MARXY-195.notes.md` is about the pin test, which
moved to MARXY-262. Do not satisfy it here.

## Files and signatures
- `apps/desktop/src-tauri/src/main.rs` (or `commands/`): `config_paths() -> { config, data }` per
  design §11 (platform directories; create them if missing). Registered.
- `apps/desktop/src/shell/tauri.ts`: `configPaths` under the ADR-0026 name and signature.
- `apps/desktop/src/shell/memory.ts`: `configPaths` returning fixed paths inside the store.
- `apps/desktop/src/app.ts`: after first text, construct one `PositionPersistence` (from
  `@marxy/core` position) over `configPaths().data`. On scroll (debounced by the class), on
  `openDocument` of another file, and on quit, record `currentPosition(...)`. In `openDocument`,
  restore the saved position for that path when no explicit `at` is given.
- `apps/desktop/test/persist-reading.test.mjs`: Playwright over the real boot, two launches sharing one
  memory store. The scroll test calls `quit(0)` on launch 1.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Tests → expected
| Check | Expect |
| --- | --- |
| persist: launch 1 on corpus `01-long-technical.md`, scroll a block to the reading line, `quit(0)`; launch 2 on the same file | first visible block's byte offset equals launch 1's, within one line |
| `positions.json` in the store | design §08 shape, `version: 1` |
| `rg -n "history.json" apps/desktop/test/persist-reading.test.mjs` | no match |
| persist: `config.toml` in the store with `theme = "t"` and a theme dir | the user theme's stylesheet is applied |
| memory-shell call record | no persistence read or write before `first_text` |
| `rg -n "configPaths" apps/desktop/src/shell/tauri.ts` | a match |

## Acceptance → check
The CSV row's criteria are the table rows.

## Do not
Store `scrollTop` (ADR-0018: a byte offset and fraction). Read or write before `first_text`.
Add pins, MRU or `history.json` (MARXY-262). Touch `packages/shell-api` or
`packages/core/src/position` beyond calling it.
