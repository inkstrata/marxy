# Round 11: the opened set, the last guard, the last flakes

Base master `47513544`. Builders follow `builder-rules.md`; each branch gets a review by a different model before integration. At most two Opus builders at once.

| Branch | Rows | Builder | Reviewer | Dev port |
| --- | --- | --- | --- | --- |
| `opened-set` | S12, S13 | Opus | Sonnet | 1431 |
| `pdf-find-count` | F13 | Sonnet | Opus | 1432 |
| `place-anchor` | F14 | Sonnet | Opus | 1433 |
| `flakes-2` | F15 | Opus | Sonnet | 1434 |

Queued for when a builder finishes: a second `lifetimes` slice (P3).

## Log

- 2026-11-23: worktrees cut from `47513544`, builders started.
- `pdf-find-count` built: `3ba5626b`, count clears on query change, "counting…" then "N of M · still counting"; frame-pdf 9/9 (new test fails on master); check 10/10. verify changed incomplete: `source/frame.test.mjs` first test timed out 120 s (also alone); browser and Rust steps not run. Opus review running, told to settle both.
- `place-anchor` built: tests only, `c896f7d6` (resize burst then open at place, fails without the cancel), `e66eaed0` (view-guards holds the yield's postMessage at the first slice); 5/5 each alone, check 10/10; guard already correct. verify changed did not finish under load. Opus review running.
- `place-anchor` verify changed finished: 8/8 steps, browser 15/0.
- `opened-set` built: `5d75552c` (image_size, stat_file, read_dir judged by handle; real_path returns the checked path), `a3e0994a` (SQLite db, -wal, -shm, -journal judged by handle; refused sidecar means an in-memory copy). cargo 609/1/5 (HEIC facts and WIC timeout tests, flaky, untouched files); check 10/10. New tests not run on old code. Left: a sidecar created as a link after the check; Unix swaps. Sonnet review running.
- `opened-set` Sonnet review: ready, no must-fix. Mutating the checks fails 2/16 sqlite and 3/5 swap tests; branch 46/46. Copy capped 512 MB. HEIC/WIC tests 3/3 on branch and master alone (load). Filed S14: an absent `-journal` made a link before SQLite opens it; the symlink test skips here.
- `place-anchor` Opus review: view-guards as built passed with the guard removed (hold stopped at a yield before `show()`, released before the grant landed); fixed by the reviewer, `4e2a00e9`: hold starts at the first slice, release waits for the grant; now fails with the guard removed or compared by `.html`, 3/3 on real code. view-lifecycle: fails without the cancel (on the stuck burst), 3x 14/14; the landing itself was never seen dropped, so the test proves the cancel settles the burst, not a lost anchor. Ready.
- `pdf-find-count` Opus review: ready after `deed0395`: typing now bumps `viewerRun` (old run could repaint its count before the new run's frame); the change also covers lines view, long CSV/JSONL tables and office pages (all find through `runInViewer`), log's "· still filtering" kept, docs widened. New test fails on master's view.ts. `source/frame.test.mjs` first test: cold-boot load, same on master (17/17 both alone). verify changed 9/9 (unit 1314/0/1, browser 99/0). Filed F16 ("5 of 3" while a refresh counts, older).
- `lifetimes-2` (P3 slice, Sonnet builder, Opus reviewer, port 1435) cut from `47513544` and started: bring the unowned-listener baseline (15) down.
- `lifetimes-2` built: `c2a0175e`, baseline 15 to 7 (palette 0, selection 0; parts 3, shell 3, viewers 1 are app-lifetime with no owner). lifetimes.test 4/4 (four boots, counts equal; caught the palette's element listeners stacking); check 10/10; verify summary not seen. Opus review running.
- `flakes-2` built: `227ddca1` (measure test wrong: frames-only first_text checked against the frame it ran in), `da6279a8` (WebKit keeps 250 resource entries, app loads ~546 modules, parse.ts fell off; buffer raised in the helpers), `078e9544` real bug: palette preview and archive README preview fetched relative images (HTML set into the live page before images became alt text), now parsed in a `<template>`; new test fails on master (4 fetches). 5x green under 8-worker load; verify changed 9/9. Sonnet review running, with a sweep for other live-page HTML that can fetch.
- `flakes-2` Sonnet review: ready. Three mutations of the start measure each fail the new assertion; the app never reads resource timing. Sweep found the Studio canvas page fetching a Markdown image too: fixed by the reviewer, `d8deda9b`, with a test failing on master. Filed S15 (office-page, not reachable). typecheck, lint, check 10/10 on the tip.
- `lifetimes-2` Opus review: ready, no must-fix. destroy is called only when a new boot replaces a handle; no double install; new test fails on master (palette listeners 2 to 5). verify changed 10/10 (unit-desktop 1314/0/1, browser 295/0); copy tests 28/0. Note: `shell/tauri.ts` drop listeners have no install-once guard (a second boot on the real shell would add them twice).
- Integration `agent/round11` (worktree `worktrees\round11`): opened-set, pdf-find-count, place-anchor, flakes-2, lifetimes-2 merged clean, `3d71ec38`. Full verify running (`verify-full.log`). Filed F17 (drop listeners per boot).
- Full verify on `3d71ec38`: 15/17; unit-core (10 MB notebook, 2.2 s under load) and browser (`no-displacement` notice dismiss timeout) each failed once and passed alone (notebook 3/3 at 0.6 s, no-displacement 29/0). Load, not regressions.
- Master fast-forwarded to `3d71ec38` (master had moved to `690d455f`, `pnpm work ask`, already in the integration). Rows S12, S13, F13, F14, F15 removed; P3 kept (baseline 7). Round 11 worktrees and branches removed.
