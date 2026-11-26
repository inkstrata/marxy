# one-listing: builder report (Sonnet)

Commit: faa8cc49 `perf(watch): list each folder once and read file metadata from the listing` (on 84a815dd; tree clean).

What changed for the reader: nothing visible.

## Change

- `watch/mod.rs`: `ids::list(dir)` replaces `DirIds`. On Windows one `GetFileInformationByHandleEx` enumeration per folder; each record gives the kind (from attributes), size, write time and file id. If the directory cannot be opened for it, falls back to `read_dir` plus `entry.metadata()`, id 0 as before. Elsewhere `entry.metadata()` (an fstatat). The file still compiles alone (`watch-rust.test.ts` passes).
- FILETIME to ms is `(ft - 116444736000000000) / 10000`, 0 before 1970, matching std's `modified()` truncation.
- `scan` (flat) no longer lists twice. `scan_tree` in `tree.rs` no longer calls `lstat` per file.
- An entry with the reparse attribute (Unix: any non-file, non-dir) gets today's per-file call, with the listed id kept.
- `docs/desktop-shell.md`: one line added.

## Measured (information only)

- Tree scan of the worktree, 2,484 files, debug build: before 85-111 ms, after 18-22 ms. Other builders may have been running.
- Reparse entries: this repo 0 of 2,704; `C:\Dev\Output` 1 of 31,478; flex `agent-ui` 0 of 454; Documents 3 of 469.
- `link` is not a hard-link count. Only the flat scan's `scan_entries` sets it, for a symlink to a file; `diff` uses it so a link never pairs as a rename. Nothing fetched or changed for it.

## Tests

- `cargo test` 628 pass, 0 fail, 5 skip. Verify turn 9/9 (`work\wave3\one-listing-verify.log`); `pnpm lint:rust` clean.
- New: a differential test in each of `mod.rs` and `tree.rs` against the old per-file scan as in-test oracle, field for field, ids included. Fixture: plain files, empty folder, deep path, junction, hard link, case-variant names, long name, unicode name, denied folder.
- New: call-count test (one listing per folder, one stat per junction) and a FILETIME conversion test.
- Symlink case did not run (os error 1314); skipped with the reason printed. Junction cases ran.
- Revert-and-fail: +1 in the time conversion fails the conversion test and 4 scan tests including both differentials; forcing every entry through the per-file call fails the call-count test.

## Calls to know about

- The Windows listing can report a file's size and write time late while a writer holds it open; the old tree scan (per-file stat) did not, the old flat scan already used listing data. Single-file updates still stat, so a rescan may show such a file Modified once more.
- `rss_of_a_fifty_thousand_file_tree_watch` (ignored) prints a tokio "runtime within a runtime" panic; untouched.

## Orchestrator notes

- Checked: one commit `faa8cc49`, tree clean, verify 9/9 exit 0 (14:59).
- For the reviewer: the stale-metadata-while-open call is the one that could change what the reader sees (a spurious or missed Modified, a reload loop with a log being written). Ask the reviewer to settle it.
