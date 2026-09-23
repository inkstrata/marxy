---
key: MARXY-NEW-palette-index
design: [07-index-and-palette, 06-shell, 00-architecture]
depends: [MARXY-NEW-one-open-path, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-NEW-palette-index]
---
# MARXY-NEW-palette-index — Give the palette the index it searches

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) ·
[06-shell](../../design/06-shell.md) · [00-architecture](../../design/00-architecture.md) (index loads at idle,
never on the critical path) · **Delta:** [2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md) ·
**ADRs:** ADR-0012 (what is indexed, root detection), ADR-0026 (`readDir`, `listRoot`/`fuzzy` deprecated),
ADR-0011 · **Finishes:** MARXY-35 (index model) and MARXY-87 (ADR-0026 names it as `readDir`'s first
caller; it merged without it).

**Outcome.** Summoning the palette and typing a heading from another file in the repository finds it,
and Enter opens that file at that heading. Today the palette's index is always empty, so it can only
show recently opened files.

## What exists
- `packages/core/src/index-model/`: `root` (ADR-0012 root detection), `walk` behind a `DirectoryReader`
  port, `ignore`, `deny`, `kinds`, `ceiling`, `entry`, `build` (`buildIndex`).
- `apps/desktop/src/palette/view.ts`: `setIndexEntries(entries)` on the controller. No caller.
- `apps/desktop/src/startup/idle-work.ts`: `loadIndexMruPins()` is `await Promise.resolve()`.
- `Shell.readDir(dir): Promise<readonly FileStat[]>` lands with MARXY-94 (a type only). Nothing implements it.
- `apps/desktop/src-tauri/src/index/mod.rs`: a second, Rust walker. **Leave it alone.** Proposed
  ADR-0033 (not on `main`) decides its fate. Do not wire it, do not delete it.

## Files and signatures
- `apps/desktop/src-tauri/src/commands/fs.rs` (or a new `commands/dir.rs`): `read_dir(dir) ->
  Result<Vec<FileStat>, ShellError>`. One level, no recursion, the deny list from design §07 applied
  before returning, and `mtime` and `size` in each stat. Registered in `main.rs`.
- `apps/desktop/src/shell/tauri.ts`: `readDir` under exactly the ADR-0026 name and signature.
- `apps/desktop/src/shell/memory.ts`: `readDir` over the in-memory store (derive directories from keys).
- `apps/desktop/src/startup/idle-work.ts`: replace `loadIndexMruPins` with `loadIndex(shell, file):
  Promise<IndexEntry[]>`. Root from `index-model/root`, walk through a `DirectoryReader` adapter over
  `shell.readDir`, `buildIndex`, `index_loaded` mark with `entries=N`. The ceiling notice goes through
  the notices region.
- `apps/desktop/src/main.ts` (or `app.ts`, whichever holds the palette controller after
  `MARXY-NEW-one-open-path`): pass the entries to `palette.setIndexEntries`.
- `apps/desktop/test/palette-index.test.mjs`: Playwright over the real boot + memory shell.

## Tests → expected
| Check | Expect |
| --- | --- |
| `cargo test`: `read_dir` over a tempdir with `a.md`, `sub/`, `node_modules/` | returns `a.md` and `sub` with `mtime`, and no `node_modules` |
| palette-index: store `/repo/.git/HEAD`, `/repo/README.md`, `/repo/docs/guide.md` (`## Installing`), `/repo/node_modules/x/README.md`; boot on `/repo/README.md`; summon; type `Installing` | a heading hit whose path is `/repo/docs/guide.md`; no hit under `node_modules` |
| same test, press Enter | `document.title` names `guide.md`; `sourceHarness().byteOffset` is the byte offset of `## Installing` (through `handle.open(path, { at })`) |
| same test, mark order | `first_text` precedes `index_loaded`; `index_loaded` carries `entries=2` |
| `rg -n "loadIndexMruPins\|Promise.resolve\(\)" apps/desktop/src/startup/idle-work.ts` | no match |
| a named mutation that makes `loadIndex` return `[]` | the Installing test goes red |

## Acceptance → check
The CSV row's criteria are the table rows.

## Do not
Persist the index snapshot: it is rebuilt each launch after first text, and persistence is a later
story once this one is measured. Rank in Rust or add `nucleo-matcher` (ranking is `palette/search.ts`,
MARXY-86). Touch `src-tauri/src/index/mod.rs`. Touch `packages/shell-api` (MARXY-94 owns it). Walk
before `first_text`.
