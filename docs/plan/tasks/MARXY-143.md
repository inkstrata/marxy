---
key: MARXY-143
design: []
depends: [MARXY-25]
verify: [pnpm precheck, pnpm done MARXY-143]
---
# MARXY-143 — make the aesthetics font and image window deterministic on webkit-linux

**Depends on:** MARXY-25 (the gate and the headless entry) · **Reference:**
`orchestration/results/MARXY-26.notes.md` note 1, `docs/plan/deltas/2026-09-19-marxy-137-headless.md` ·
**ADRs:** ADR-0014 (the zero-CLS promise).

**Outcome.** `pnpm gate:aesthetics` on `webkit-linux` reports the same thing twice for the same
commit. It does that by measuring a window that has actually settled, not by measuring less.

## The defect
`finishShift` in `apps/desktop/src/render/headless.ts` scores `snaps[0] → snaps[1]` as the font and
image window. Both snapshots are taken after `await document.fonts.ready`. On FreeType that promise
can resolve before a content face the article uses has swapped in, and an image whose box was not
reserved can decode into the gap. So the window scores movement that belongs to no diff:

| Run of `1594c86` | Job | Failure |
| --- | --- | --- |
| first | 105996495895 | `19-source-file.md 960×24 dark: layout shift 0.78 (font/image 0.78)` |
| re-run | 105997368997 | `02-readme-real-world.md 720×17 dark: layout shift 0.0173 (font/image 0.0173)` |

Green on `webkit-macos` in the primary checkout. `engineName()` splits the two engines because they
do not agree on text metrics; this is the first thing that has actually depended on that.

## Files
- `apps/desktop/src/render/headless.ts` — the wait before the first scored snapshot.
- `scripts/gate-aesthetics.mjs` — the `--repeat N` flag. Nothing else in the gate changes.
- `apps/desktop/test/layout-shift-window.test.mjs` — new; the three cases below.

## Do this, in order
1. Before `takeSnapshot` puts `snaps[0]` in the array, await the faces the article actually uses:
   walk the article's own elements, collect the `{family, weight, style, size}` tuples
   `getComputedStyle` reports, and `await document.fonts.load()` for each. `document.fonts.ready`
   alone is what is failing; keep it if you like, but it is not the wait that matters.
2. Await the decode of every `<img>` whose box you reserved — `decode()`, or `load`/`error` when
   `decode` is unavailable. An image with no reserved box must still be allowed to move the window;
   that is the bug the gate exists to catch.
3. Add `--repeat N` to the gate: run the corpus through the CLS check N times in one process,
   collect the set of documents reporting a non-zero window per pass, and fail if the sets differ
   between passes or if any pass is non-empty. Print each pass.
4. Write the three cases. Check case 1 fails against `main` and case 3 fails against a tree with the
   `> 0` comparison relaxed.
5. `pnpm gate:aesthetics --selftest`, `pnpm gate:aesthetics`, `pnpm precheck`, `pnpm done MARXY-143`.
   The evidence that closes this story is the ubuntu `--repeat 3` run in CI, so say in the PR body
   which job produced it.

## Tests → expected
| Check | Expect |
| --- | --- |
| case 1, the wait | the entry awaits `document.fonts.load` per used face and a decode per reserved image; fails against a tree awaiting only `fonts.ready` |
| `pnpm gate:aesthetics --repeat 3` on `ubuntu-latest` | green, three identical passes, no document named in any of them |
| `pnpm gate:aesthetics --selftest` | green — the crafted late-image case still scores a font/image miss |
| case 3, late unreserved image | `finishShift` reports `fontWindow > 0`; the gate exits non-zero |
| case 4, thresholds | `reported.cls > 0`, the `snapshots < 2` floor, `RAG_OPTS`, `WIDTHS`, `VARIANTS`, `SIZES`, `LINE_BOX` byte-identical to `main` |
| `git diff --name-only origin/main...HEAD` | nothing under `fixtures/`; no baseline byte moves |

## Acceptance → check
The row's seven criteria in order: 1 is case 1, 2 is the `--repeat` run in CI, 3 is `--selftest`
plus case 3, 4 is case 4, 5 is the boundary check, 6 is the `browser` job on both engines, 7 is the
`CHANGELOG.md` line.

## Do not
Widen the CLS threshold, add a per-document allowance, or skip the check on `webkit-linux` — the
fix is the race, and an acceptance criterion exists for each of those escapes. Touch
`fixtures/baselines` (MARXY-137 owns the next baseline move and needs it to be the only one).
Change any other check in the gate — grid, measure, contrast, rag, headings all stay as they are.
Touch `apps/desktop/src/app.ts` or flip `hyphenate`/`hanging` in `headless.ts`; that is MARXY-137,
which is dispatched after you. Edit `orchestration/state.json` or any board file. Reopen, close or
rebase PR #95 — MARXY-26 waits for your merge and then rebases itself.
