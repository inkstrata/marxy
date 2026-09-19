---
key: MARXY-86
design: [07-index-and-palette, 09-app-shell]
depends: [MARXY-35]
verify: [pnpm precheck, pnpm done MARXY-86]
---
# MARXY-86 — Palette model: MRU, fuzzy search, pinning, back/forward

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) §Query and ranking, §History; [09-app-shell](../../design/09-app-shell.md) §Keyboard · **Depends on:** MARXY-35 · **ADRs:** ADR-0011, ADR-0013.

**Outcome.** The palette's session, search and keys are pure functions with tests that CI runs. Nothing is mounted. A reader cannot see this slice.

## Files and signatures
- `apps/desktop/src/palette/session.ts` — `opens` cap 500, MRU, pins, in-memory back/forward of `{ path, position }`; a new open after back drops the forward branch.
- `apps/desktop/src/palette/search.ts` — `prepareIndex`, `searchPrepared`; empty query = pins then MRU newest first.
- `apps/desktop/src/palette/keys.ts` — the §09 table entries for palette and history (`Mod+P`, `Mod+[`, `Mod+]`).
- Matching `*.test.ts` files next to them. `node-shims.d.ts` only if `node:test` typings are missing.
- `apps/desktop/package.json` — the test script must invoke `node --test` over `src/palette/*.test.ts` (or `src/**/*.test.ts`) with `--experimental-strip-types` as needed.

Reuse `feat/MARXY-36-palette-mru-fuzzy-over-path-title-headin` / PR #30 for session, search and keys. Do not re-implement them.

## Do this, in order
1. Copy session/search/keys and their four tests from PR #30. Leave `view.ts` behind.
2. Widen the desktop `test` script so `pnpm --filter @marxy/desktop test` (and therefore CI's `fast` job / `pnpm test`) prints the session, search, search-perf and keys names.
3. Scale the 16 ms `searchPrepared` assertion by a measured machine factor. Time only the query, not `prepareIndex`.
4. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| CI `fast` log | `session`, `search`, `search-perf`, `keys` names present |
| Delete `searchPrepared` body | that job red |
| `session.test.ts` | pins then MRU; forward branch truncated on a new open |
| `search-perf.test.ts` | p95 < 16 ms × machine factor on a prepared 20k index |
| grep over the model files | no `MiniNode`, no `view.ts` |

## Acceptance → check
CSV criteria 1–6. Criterion 1 is the one that made MARXY-36 unmergeable; if `pnpm test` still ignores these files, the slice has failed.

## Do not
Mount a dialog. Edit `view.ts` or `main.ts`. Ship a DOM or CSS-selector engine. Edit `fixtures/perf-budgets.json`. Claim the 16 ms product budget is met — that budget is keystroke → rows painted and belongs to MARXY-87.
