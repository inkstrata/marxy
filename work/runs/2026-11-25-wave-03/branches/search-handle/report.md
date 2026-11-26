# search-handle: builder report (Sonnet)

Commit `c51a25f6` `perf(search): threaded content search that judges the opened handle`. Touches `commands/search.rs` and the "Content search" section of `docs/desktop-shell.md`. No `check:tauri`.

Reader: content search answers sooner; results identical (hits, order, counts, `truncated`, `stopped`).

## Change

- Handle check: on Windows, `expected_paths` judges by spelling (roots, deny list, no `.`/`..`) without touching the disk; then open, and `scope::handle_is` must place the handle on the expected path under a root, as `read_head` does. Replaces the canonicalise and both `symlink_metadata` calls; the swap check is as strong as `handle_is`. Unix keeps its canonical check, regular-file check before open, dev/inode check.
- Sniff and case: the first chunk (never under 8 KB) is the NUL sniff; no separate head read or seek. Smart case folds ASCII while scanning (`find_folded`), no lowered copy.
- Threads: up to 8 workers via `std::thread::scope`, atomic index. `Merge` takes results in input order and applies every limit on that ordered prefix.

## Budgets with several workers

- Bytes: the 1 GB budget is spent in input order by the files `Merge` takes; a file read past the point it ran out is dropped.
- Time: one 15 s deadline for the whole search; a file in progress stops at its next chunk, keeping its hits so far.
- Time and cancel are the only timing-dependent outcomes.

## Measured (release, other cargo jobs running; information only), ms

| Query | Serial | 1 | 2 | 4 | 8 workers |
| --- | --- | --- | --- | --- | --- |
| 1,500-file synthetic, rare, lowercase | 309 | 160 | 67 | 44 | 32 |
| same, rare, exact case | 267 | 153 | 100 | 42 | 25 |
| this repo (1,943 files), rare | 386 | 212 | 105 | 64 | 44 |
| this repo, "Shell" (200 hits) | 70 | 44 | 28 | 14 | 14 |
| this repo, "the" (200 hits) | 9.5 | 5.7 | 3.6 | 3.8 | 3.6 |

## Tests

- `cargo test` 628 pass, 0 fail, 6 ignored. Shared cases and the TypeScript twin unchanged. `pnpm lint:rust` clean.
- Differential `the_threaded_search_equals_the_serial_one_for_every_worker_count`: old serial search kept in the test module; 2,520 runs over roots, queries, limits, per-file caps, chunk sizes (9, 4096, 4 MB) at 1, 2, 3, 4, 8 workers; tree with binary, empty, missing, outside, deny-listed, repeated paths.
- Not covered: the 1 GB and 100,000-file budgets.
- `a_path_outside_every_root_is_never_opened` (test-only open record). Junction swap test ran. Symlink swap test ran only its control half (EPERM).
- Revert-and-fail: handle check always passing fails the junction test; any path through the root check fails the outside-path test.

## Verify turn

Steps through lint-rust passed. `cargo` hung at `watch_tree::tests::a_case_only_rename_leaves_no_ghost_of_the_file_or_the_folder` (not this code) under load; killed after about 18 min; the same binary alone passed 628 in 30 s. Log shows cargo FAIL; not rerun with `--from cargo`.

## Calls

- A gone path is still not counted as skipped (`Refused::Gone`), as before.
- Worker cap 8.
- Two ignored bench tests added (`search_bench`, `search_bench_repository`).

## Orchestrator notes

- Checked: one commit, tree clean; verify log ends 8/9, cargo failed (hang). The reviewer reruns the verify turn with `--from cargo`.
- The hung watch test is master's code, but a hang (not a fail) is worth filing if it recurs; `one-listing` also changes the watch scans, so note it at integration.
- Eight threads each holding a 4 MB chunk is 32 MB peak; the reviewer should check memory and that cancel stops all workers promptly.
