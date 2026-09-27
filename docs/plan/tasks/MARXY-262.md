---
key: MARXY-262
design: [07-index-and-palette, 11-config-and-storage]
depends: [MARXY-195]
verify: [pnpm precheck, pnpm done MARXY-262]
---
# MARXY-262 — Pins and recent documents survive a real quit

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) §History, MRU, pins
(`history.json`; pin is `⌘.` on a document hit) ·
[11-config-and-storage](../../design/11-config-and-storage.md) (the file lives under
`configPaths().data`, cap 500 opens) ·
**Delta:** [2026-09-27-marxy-195](../deltas/2026-09-27-marxy-195.md) · **ADRs:** ADR-0011, ADR-0026 ·
**Depends on:** MARXY-195 (it provides `configPaths`, and both edit `app.ts`)

**Outcome.** Quit and summon the palette with nothing typed, and the documents opened last time
are listed, pinned ones first.

**Where this came from.** The other half of MARXY-195. Review of PR #227
(`results/MARXY-195.notes.md`, note 1) returned the story because the pin test built
`history.json` with `serializeHistoryFile` and never called `quit`. Start from commit `b82dc8e`
on `origin/feat/MARXY-195-remember-reading-across-launches` (`git show b82dc8e:apps/desktop/src/palette/history.ts`
and the `session.ts` hunk). Re-apply the flush onto the `app.ts` MARXY-195 left behind, which
already flushes reading position and does not import `palette/history.ts`. The old test is not
a starting point. Copy none of it.

## Files and signatures
- `apps/desktop/src/palette/history.ts`: `parseHistoryFile` / `serializeHistoryFile` for the §07
  envelope (`version`, `opens`, `pins`, `recentRoots`), `loadPaletteHistory`, `trackDocumentOpen`,
  `flushPaletteHistoryFromApp`. Writes go through `writeFileAtomic`. A newer `version` is left
  untouched. Unparseable bytes are renamed to `history.json.bad-<timestamp>` and a fresh file is
  written (§11).
- `apps/desktop/src/palette/history.test.ts`: the envelope round-trip. This is the only file that
  may call `serializeHistoryFile` from a test.
- `apps/desktop/src/palette/session.ts`: `setPaletteHydration`. The next `emptySession` call
  returns that session once, so a history loaded during `startApp` is what the palette mounts with.
- `apps/desktop/src/app.ts`: inside the `ensurePersistenceLoaded` MARXY-195 added, after
  `PositionPersistence.open` and still after the `first_text` mark, call `loadPaletteHistory`.
  `openReplacing` calls `trackDocumentOpen` after a successful open. The existing `quit` wrapper
  also calls `flushPaletteHistoryFromApp` with `window.__marxyPalette.session` (set by
  `bootApplication` in `main.ts`). Do not add a second wrapper.
- `apps/desktop/test/palette-history.test.mjs`: Playwright, two launches, `palette-boot.html`
  (`bootApplication`, so `handle.palette` exists).

## Do this, in order
1. `history.ts`, `session.ts` `setPaletteHydration`, and `history.test.ts`.
2. The three `app.ts` call sites above, on top of MARXY-195's `app.ts`.
3. `palette-history.test.mjs`, last, through the real quit.

## Tests → expected
| Check | Expect |
| --- | --- |
| `history.test.ts` | `serializeHistoryFile` / `parseHistoryFile` round-trip a §07 envelope at `version: 1`; a newer version is not overwritten; unparseable bytes are quarantined |
| launch 1: `handle.open(A)`, `handle.open(B)`, `setIndexEntries` for both, `Mod+P`, select A's row if it is not selected, `Mod+.` (`event.key` is `"."`) while the dialog is open | `handle.palette.session.pinned` includes A **before** quit |
| launch 1 then `handle.shell.quit(0)` | the memory store's `/data/history.json` is the bytes quit wrote |
| launch 2 boots that same store, empty query | `emptyQueryPaths(handle.palette.session)` is `[A, B]` |
| `rg -n "serializeHistoryFile\|emptySession\|writeFileAtomic" apps/desktop/test/palette-history.test.mjs` | no match |
| a mutation that makes `flushPaletteHistoryFromApp` return without writing | the launch-2 assertion turns red |
| memory-shell call record on launch 2 | no `history.json` read before `first_text` |

## Acceptance → check
CSV 1 → the launch-1 / launch-2 rows. CSV 2 → `history.test.ts` plus the file quit wrote. CSV 3 → the `rg` row. CSV 4 → `CHANGELOG.md`.

## Do not
Write `history.json` from the test, or pin by calling `togglePin` on a session the test constructed.
`handle.palette.session` is a getter over a closed-over variable; assigning to it does not change
what quit flushes. The pin is the chord in `palette/view.ts`. Edit `persist-reading.test.mjs`,
`shell/tauri.ts`, or `src-tauri` (MARXY-195). Touch `packages/*/src/contracts/**`. Add a recent-files
surface: the empty query is that surface (design §07).
