# one-listing: review (Opus)

**Verdict: ready after my fix.** Fix committed as `9a996f7b`; tree clean.

## The fix

If `GetFileInformationByHandleEx` failed partway through a folder (or on its first call, on a file system without this info class), `sys::list` returned the entries read so far as if complete. A file left out shows as Removed; a folder that cannot be enumerated looks empty, so changes to the open document there would be missed. Could not happen before (names came from `read_dir`). Now any end other than ERROR_NO_MORE_FILES returns `None`, which falls back to `read_dir`. The id test still passes, so the normal path still ends cleanly.

## (1) A file held open by a writer

The listing does lag: a Python check (scandir uses the same directory data) showed size 0 while 4,010 bytes had been written to an open file; opening a handle, as `lstat` does, updated the listing.

- Open document's folder (live reload): the flat `RootWatch` (`live-reload.ts` watches non-recursively). Reads listing data only, as master did through `DirEntry::metadata`. Unchanged.
- Tree watch (index and palette only): a reported file still gets `lstat`, which also refreshes the listing, so the next rescan agrees. No spurious Modified, no reload loop.
- Left: with the writer still holding the file open, a change with no OS event is caught only after the writer closes or something opens the file (a dropped watch; a hard link's second name after a write through the first). Effect: stale index rows only. File for later.

## (2) Time conversion

Matches std (`file_id` uses `as_millis`, truncating): before 1970 and negative FILETIMEs 0 in both; sub-millisecond truncated in both; far future no overflow (i64).

## (3) Mutations

| Broken | Differential tests that failed |
| --- | --- |
| Dir reported as File | both |
| id +1 | both |
| size from allocation size | both |
| mtime +1 ms | both |
| reparse entries treated as Dir | tree test only (the flat scan skips folders, so a pass there is correct) |

Symlink case skipped here (os error 1314): nothing tests a symlinked file.

## (4) Fallbacks

A folder that cannot be opened falls back to `read_dir`, ids 0 as on master; one that opens but cannot be enumerated now does the same.

## (5)

`watch-rust.test.ts` passes: `watch/mod.rs` still compiles alone.

## Tests

`lint:rust`, typecheck, lint, check pass. `cargo test` 627 pass, 1 fail: the timing test `decode::wic::...a_worker_past_its_timeout...` (untouched file), passes alone. `a_watch_the_os_let_go_of_is_reconciled_and_registered_again` failed once under load, then 3/3 alone. No verify turn after the fix commit.

## Orchestrator notes

- The reviewer's fix has no test of its own (a partial enumeration cannot be produced on demand). Accepted: it only widens the fallback that already exists.
- File for later: the writer-held lag can leave stale index rows until the file is closed or opened.
- Verify turn on `9a996f7b` started by the orchestrator.
