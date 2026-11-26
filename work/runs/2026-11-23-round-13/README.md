# Round 13: round 12's leftovers and the slow big page

Base master `04eafecc`. Builders follow `builder-rules.md`; reviewers follow `reviewer-rules.md`, a different model from the builder. At most two Opus builders at once. S17 (`web-shell`) is another session's; not this round's.

| Branch | Rows | Builder | Reviewer | Dev port |
| --- | --- | --- | --- | --- |
| `sweep-unix` | S16 | Opus | Sonnet | 1451 |
| `find-step` | F18 | Sonnet | Opus | 1452 |
| `shell-listen` | F19 | Sonnet | Opus | 1453 |
| `big-page-keys` | F20 | Opus | Sonnet | 1454 |

## Log

- 2026-11-24: worktrees cut from `04eafecc`, builders started.
- `sweep-unix` built: `c3434bff`, Unix move-aside goes to `.marxy-swept-<pid>-<attempt>-<nanos>`, which the sweep never parses, so a failed restore leaves the swapped-in file alone. Tests: swept name never a staging name; once-per-folder (fails with the guard removed); Windows file symlink (skips here, asserts never run). `atomic_write.rs` alone type-checks for x86_64 Linux (full crate needs a Linux C toolchain); not run. cargo 624/0/5, verify changed 9/9. Sonnet review running.
- `sweep-unix` Sonnet review: ready. Mutations: guard removal and a staging-shaped swept name each fail their test; dropping the Windows reparse flag passes (symlink test skips here). Unix lib and test builds of `atomic_write.rs` clean; Unix not run (no WSL distro, Docker off). Residual: `remove_file(&aside)` unlinks by name after the re-check (no unlink-by-fd on Unix). Doc row widened by me, `b726dad7`.
- `shell-listen` built: `ad2a48ff`, `hear` keeps one `listen` per event for the shell's life and swaps the current callback; pending opens go to the current one. Two new subscription tests fail on master; `viewer-keys-order.test.mjs` reads `bind.ts` source for the order. 15/15, check 10/10, verify changed 9/9. Opus review running.
- `find-step` built: `7c1465e8`, while "N so far": Previous lands on the last counted match, Next stays put (wrapping would claim the end). Test extended; fails on master. reading-lines 8/8, verify changed 9/9. Left: Next from the last counted match while counting still wraps to 1. Opus review running, asked to settle that.
- `shell-listen` Opus review: ready after `32143866` (new `viewer-keys-order.test.mjs` was missing from `verify-map.json`; `verify.test.mjs` would have gone red). Close still prevented in Rust before emit; a failed `listen` is retried, not cached; ordering holds on a second boot. Mutations: base `tauri.ts` fails both new tests, plain `cb` fails the drain test, viewer keys moved up fails the order test. verify changed 10/10. Filed F21.
- `find-step` Opus review: ready after `4cbbcdba` (Next at "2 of 2 · still counting" stayed a wrap to 1; now stays put while counting). Settled find wraps as on master (tested). Mutations: master view.ts and the builder's both fail. reading-lines + frame-pdf 17/17, verify changed 9/9. Left as is: Previous from match 1 while counting wraps to the last counted (a real match).
- `big-page-keys` built: `87498ab6`. Causes: every cursor move rebuilt the whole parsed Outline (6,504 rows, 45k elements); the verb bar toggled a root `:has()` that restyled the window; fact sibling rules made Outline rows quadratic. Fixes: a cursor move only moves the Outline mark (`light`, `describeLit`); bar room by root attribute `data-marxy-verb-room`; fact rules skip `.marxy-l-row`. Edge key 1410 to 44 ms; WebKit key 2.6-10.7 s to 0.9-1.3 s; full Outline redraw Edge 2.1 to 0.9 s. New `left-doc` test counts no row remade on a cursor move (fails reverted). verify changed 11/11. Left: WebKit whole-window restyle ~0.8 s per bar show, scales with the Outline (needs virtualising). Sonnet review running.
- `big-page-keys` Sonnet review: ready, no change. Reverting the cursor `light` path fails the new test; a throwaway probe could not make a stale Outline (rename, insert/undo, Source and back, another file); ", current" moves with the mark; `data-marxy-verb-room` cleared on every hide and on destroy; fact rules: no fact card has a `.marxy-l-row` sibling (code reading). verify changed 11/11. Note: `describeLit` refreshes only `.marxy-l-prow` rows (Outline is the only user).
- Integration `agent/round13` (worktree `worktrees\round13`): sweep-unix, shell-listen, find-step, big-page-keys merged clean, `64589ba8`. Full verify running (`verify-full.log`). Filed F21, F22.
- Full verify on `64589ba8`: 17/17 green (browser 2482/0, cargo 624/0, tauri 117/0). Waiting on Ian's word to fast-forward master.
- Master fast-forwarded to `64589ba8` on Ian's word; branches and worktrees removed; S16, F18 to F20 left the tracker.
