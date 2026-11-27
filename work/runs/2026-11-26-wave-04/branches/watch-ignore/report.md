# watch-ignore: builder report (Sonnet)

Commit (branch `agent/watch-ignore`, base `b0d9cb52`): `5fb53e76 feat(watch): the tree watch leaves out the folders the index walk left out`.

Verify turn not finished when reported (queued "holding place 1 of 2"); passed install, typecheck, lint, check (10), golden, fidelity, licences; unit, browser, Rust steps pending. Log `work\wave4\watch-ignore-verify.log`.

Reader: nothing visible. Build output hidden from the index by `.gitignore`, `.ignore` or a deny glob is no longer snapshotted, rescanned, counted toward the 200,000-file cap, or reported as events.

## How

- `collectFiles` has a new `ignoredDirs` output; `walkRoot` returns it. No matcher ported to Rust.
- Index service: `ignoredFolders(tree)` and `onIgnoredChange`. A folder is left out only if every held root under the tree left it out; a root that is unwalked, or sits inside the folder, vetoes it.
- `watch_root` takes `ignore`. New command `watch_ignore(root, id, ignore)` updates a running watch (in `build.rs`, `generate_handler!`, `capabilities/main.json`). Shell interface and both implementations have `ignore` and `setIgnore`.
- `TreeWatch::set_ignored` drops newly ignored files silently, no rescan. A folder that stops being ignored triggers a rescan; its files come back as created.
- The list is cleaned in Rust: any entry not strictly inside the watched root is dropped, `..` and `.` forms included.
- A file opened directly inside an ignored folder is still watched by the flat watch (untouched).
- `docs/desktop-shell.md` updated.

## Measured

Fixture with notes, a readme and a 50-file `gen-out` folder: tree watch snapshot 54 files before, 4 after; the ignored folder's writes counted 0 toward rescan debt and produced 0 events.

## Tests

Rust `watch_tree` 22 pass plus thread-level `a_tree_thread_leaves_a_folder_out_and_takes_it_back_when_told`; TS `collection/watch.test.ts` 16; core `walk.test.ts` 4; typecheck, lint, lint:rust green. Revert-and-fail: with the scan skip and the `ignoredDirs` push removed, the two Rust fixture tests, the core walk test and the TS "left out, then taken back" test fail. The thread test passes under that revert (writes filtered by the event path): a regression guard, not a proof.

## Calls

- The first scan of a tree is still whole: the watch opens before the walk finds the ignored folders, then is narrowed. A huge ignored folder can still trip the 200,000-file cap on first open; persisting the list in the index snapshot would fix it (not done).
- A shared watch (same tree twice) keeps the first caller's list; only `collection/watch.ts` watches trees today.
- A `check:tauri` case would fit: an ignored folder in a watched root, no events or index entries from it, removing the rule restores them.

## Orchestrator notes

Review waits for the verify turn to finish. File for later: the first scan is still whole (cap can trip on a huge ignored folder).

## Update from the builder

- Verify turn 12/13: browser failed 1 of 254, `shell-boundary.test.mjs` pins the command count at 56 (now 57 with `watch_ignore`). Fixed in `a2878e12` (`test(shell): the app manifest holds one more command`); that file 18/0. The browser step has not been rerun whole: rerun `--from browser` on the final commit.
- Verify counts: unit-core 4239, unit-desktop 1260, unit-desktop-browser 44, lint-rust pass.
