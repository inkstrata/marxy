# Briefs, shift 3 and the shell: returning is not opening; file-system work

Rules for builders and reviewers: `C:\Dev\reader\work\wave1\wave1-cut.md`. Line numbers are from master `17cfe661`; find code by name. Rust branches run `cargo test` in `apps/desktop/src-tauri` and `pnpm lint:rust`; they never run `check:tauri` (the integrator does, once, under the machine lock).

| Branch | Step | Depends on | Owns | Builder | Reviewer | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `warm-store` | 3a | wave 1 in master; best after `splice-all` | `document/registry.ts`, `document/open.ts`, `document/live-reload.ts`, `frame/tab-row.ts` | Sonnet | Opus | M |
| `one-listing` | shell | none | `src-tauri/src/watch/mod.rs`, `watch/tree.rs` | Sonnet | Opus | M |
| `search-handle` | shell | none | `src-tauri/src/commands/search.rs` | Sonnet | Opus | M |
| `watch-ignore` | shell | `one-listing` | `watch/tree.rs`, `main.rs` `watch_root`, `collection/watch.ts`, `index/` | Sonnet | Opus | S |
| `read-tree` | shell | `one-listing`; X8 says go | a new command; `index/walk.ts` | Sonnet | Opus | M |
| `scope-keys` | shell | none | `src-tauri/src/scope.rs`, `file_scheme.rs` | Sonnet | Opus | S |

`one-listing`, `search-handle` and `scope-keys` touch different files and can run side by side, and beside any front-end branch.

## warm-store

Decided by Ian (24 November): a kept store keeps its undo history across a tab switch.

**What the reader gets.** Coming back to a tab, or going Back, does not read the file again or parse it again.

**Today.**

- A tab is only a path (`apps/desktop/src/frame/window-tabs.ts:22`), with a remembered byte offset (`frame/tab-row.ts:142`). Click, Back, Forward and closing a tab all end in `openAt` (`tab-row.ts:155`), which runs the whole open (`document/open.ts` `openReplacing` at 903, `readAndShow` at 471): flush the reading position, `markOpened`, `detectFiles` and `readFile` (with a SHA-256 fingerprint in `shell/tauri.ts`), decode, tear down the current document (`teardownDocument`, defined about 377 and called about 603: `view.clear`, then `release(current)`), decide the kind, `stores.acquire(file, make)` (641: a new store, a whole parse, a node map), `view.show` (render, mount, fonts, grid, land), then `finishDocumentOpen` (typeset, deferred passes, `index.ensureFor`, the watch, the title).
- The registry (`document/registry.ts`) holds no cache: `release` (64) closes the store when the last holder lets go, and the open path releases before it acquires. Closing commits a `close` transition, clears subscribers, forgets the file's encoding (`encoding.ts:311`) and the shell's read record (`pane/index.ts:75`), and ends the folder watch.
- A warm route exists already for one case: when the other pane shows the same file, `readAndShow` takes the bytes from that store and skips `detectFiles`, `readFile` and decoding (486-497), and `acquire` returns the shared store without parsing.
- A store no pane shows has its watch events dropped: `handleDocumentWatch` returns when no view shows the document (`document/live-reload.ts:307-309`).
- The validator exists: `store.reload(bytes)` (`store.ts:585`) compares by `sameBytes`, answers `'unchanged'`, `'kept'` or `'reloaded'`, and re-parses only what changed. The logic for a file that is gone, unreadable, or changed under unsaved Source text is in `handleDocumentWatch` (307-400), private to its closure.
- A document with unsaved edits is never backgrounded: leaving it asks (`document/open.ts` about 971; `apps/desktop/src/close.ts` about 273). Unsaved Source text lives only in the editor, which `view.clear` destroys.
- `shell.stat` returns size and modified time, no file id and no hash.

**Do.**

1. The registry keeps the last three stores that were released clean (no unsaved edits, no pending disk conflict, an ordinary path, not a scratch or archive entry). A fourth evicts the oldest, which closes as stores close today. Closing a tab evicts that path. The leave-document prompt is untouched, so a warm store is never dirty.
2. A warm store keeps its folder watch. An event for a store no view shows marks it "check on return" instead of being dropped.
3. Opening a path whose store is warm takes the route that already exists for the two-pane case: no `detectFiles`, no `readFile`, no decode, no parse. If it is marked for checking, read the file and hand the bytes to the same logic the watch uses (make it callable from the open path): unchanged means carry on; changed means the store reloads, re-parsing only what changed; gone or unreadable means the open fails as it does today.
4. Everything else an open does still happens: the kind and encoding are decided again (a rule or `kinds.json` may have changed), recents and the palette's recency are updated, `index.ensureFor` runs, the position is restored, the title refreshed.
5. Keep the rendered page's text with the store when the view has one (`shown.html`, the sanitised page as text), valid for the store's version and the trust grant: a warm return then mounts it without rendering again. No DOM is kept.
6. Undo history is kept across the round trip. Say so in `docs/using-marxy.md`.

**Not in this branch:** keeping the rendered article (decided against: every module is wired to one article per pane).

**Tests that will need a decision, with the expected outcome.** `apps/desktop/test/lifetimes.test.mjs` (about 280-306) opens four other paths in a pane and expects the first store to be collectable: with three kept, the fourth evicts it, so it should still pass; if it does not, the cache is holding something it should not. `debugCounts` (`typesetters: 1, resizeObservers: 1`) is unaffected, since no view is kept. `store-walk-panes.test.mjs:262` asserts watches equal stores, which stays true if warm stores keep their watches and are counted as stores. `pane-set.test.mjs:226` counts watches as `[2,1]` and may now see more: change it only with the reason written in the test.

**Proof.** Browser tests through the memory shell, which records its calls: switch to another tab and back and the shell saw no `readFile` for the returning document and core's `parseCount()` did not move; change the file on disk while its tab is in the background, return, and the new text is shown, with only the changed blocks parsed; delete it while in the background and the return fails visibly as today; a document with unsaved edits is still asked about on leaving; after opening four other documents the first is evicted (a return reads it again); Mod+Z after a round trip undoes the edit made before leaving. Each fails on master where it should.

**Numbers.** Tab switch on `long-reference`: `TaskDuration` to shown down by the read and the parse (about 0.3 s of the 0.5 s); on the 25 KB document about 0.12 s of 0.2 s. With `near-typeset` in, the typesetting tail goes too.

## one-listing

**What the reader gets.** Nothing visible. Opening a folder, the two-second poll of the open document's folder, and the quiet-time rescan do a fraction of the file-system work.

**Today.** `scan_tree` (`apps/desktop/src-tauri/src/watch/tree.rs:203-232`) lists each folder with `fs::read_dir`, lists it again with `DirIds::read` (`watch/mod.rs:34`, Windows only), then calls `lstat` on every entry, which on Windows opens a handle per file. The flat scan (`watch/mod.rs:412-458`) also lists twice but uses `entry.metadata()`. `DirIds::read` calls `GetFileInformationByHandleEx` with class `FILE_ID_BOTH_DIRECTORY_INFO` through a 64 KiB buffer and keeps only the name and file id; the record it is given (declared at `mod.rs:77-93`) also carries the attributes, the end-of-file size, and the creation, access, write and change times. By proxy measurement over 2,498 files: listing 15-29 ms, the per-file opens 113-173 ms. `FileId` is `{mtime_ms, size, ino, link}` (`mod.rs:250-258`); `diff` (486-557) pairs a removed and an added path by `ino` as a rename, reports `Modified` when the time or size changes, and never pairs when `ino` is 0 or `link` is set. Tests count `lstat` and `read_dir` calls through `stat_count` (`tree.rs:264`). `watch/mod.rs` must compile on its own under `rustc` (its header comment, 14-18, and `packages/core/src/position/watch-rust.test.ts`), which is why its Windows calls are declared by hand.

**Do.**

1. On Windows, one enumeration per folder: the records already fetched supply the name, the id, whether it is a directory, the size and the write time. `fs::read_dir` and the per-file `lstat` go from `scan_tree`, and the second listing goes from the flat `scan`. Elsewhere, `entry.metadata()` in place of `lstat` where the standard library makes it free, and what is there today where it does not.
2. The time must come out exactly as the standard library's does for the same file, in the same unit, or the first scan after this change reports every file as modified. Write the conversion and prove it against `symlink_metadata` for every entry of a fixture tree.
3. An entry with the reparse-point attribute is the hard case: the record says it is a reparse point, not which kind (a symlink, a junction, a cloud placeholder, something else). For those entries only, fall back to the per-file call that is there today, so their treatment does not change. Say in the report how common they are in the trees you tried.
4. `link` (the hard-link count) is not in a directory record. Find out what sets it today and what relies on it; if only rename pairing does, fetch it when a pairing candidate turns up rather than for every file, and prove the pairing results are unchanged.
5. Keep the file compiling alone: no crate, declarations by hand as now.

**Proof.** A differential test kept in the suite: for a fixture tree with ordinary files, an empty folder, a deep path, a junction, a symlink where the machine allows one, a hard link, names differing only in case, and a file with a long name, the new scan's snapshot equals the old one's, field for field. The call-count hooks now show one enumeration per folder and opens only for reparse entries. The existing watch tests pass. Time the scan of this repository before and after (information only; say what else was running).

**Numbers.** Scan of 2,498 files: from about 130-200 ms to about 20-30 ms by the proxy's reckoning.

## search-handle

**What the reader gets.** Content search answers several times sooner on a large folder, and one check on Windows becomes as strong as the one reading a file already has.

**Today** (`apps/desktop/src-tauri/src/commands/search.rs`). `search_content` (569-599) takes paths, a query, roots, limits and a cancel token, runs as one blocking task, and returns one result at the end. Per file, `resolve` (105-136): lexically clean, under a root, no denied segment, and `dunce::canonicalize(p)` equal to the root's canonical path joined with the relative path (so a symlink or junction in the path fails). `open_candidate` (140-180): `symlink_metadata` must say regular file before opening (a FIFO would block), open, `is_file` and the size cap, then "the path as passed must still be this very file, not a link swapped in since `resolve`": on Unix by device and inode, on Windows only by checking that the path is not a symlink (168-174), which is weaker than `scope::handle_is` (`scope.rs:281-303`) that `read_file` and `read_head` use. Then an 8 KB read to sniff for NUL, a seek back, and the first chunk read again (375). With smart case each chunk is copied lower-cased (379-382). The loop over files is serial (516-557). Limits: 1 GB, 15 s, 100,000 files, 10,000 hits, 256 MB a file, 4 MB chunks (22-34). By proxy over 2,498 files: 614-675 ms a query against 165-185 ms for a plain open and read. `cases.json` and a TypeScript twin compare results, so the order of hits is part of the contract.

**Which checks are safety and stay** (`scope.rs:10-13`, `:253`): a path is judged by its spelling before it touches the disk, so a share's name is never looked up for a path outside; then canonically, so a `..`, a symlink or a junction leading out is refused; a regular file is confirmed before opening where opening something else could block; and a link swapped in between the check and the open must be caught. The NUL sniff and the size cap are function, not safety.

**Do.**

1. Judge the file by its opened handle, as `read_head` does (`fs.rs` about 657-679 shows the pattern): keep the lexical checks and the root and deny-list checks; open; ask the handle where it really is and require that to be the expected path under the root. That replaces the canonicalise and both `symlink_metadata` calls on Windows and makes the swap check as strong as `handle_is`. On Unix keep the regular-file check before the open.
2. The first chunk serves as the sniff: no separate head read.
3. Case-insensitive search without the copy (compare with ASCII folding as it goes; results must be identical, including for non-ASCII text, where today's `to_ascii_lowercase` leaves bytes above 127 alone).
4. Several threads with `std::thread::scope` (no new crate): workers take paths by an atomic index; the limits become shared atomics; cancel is already one. Hits are gathered per path and merged in input order, with the hit limit applied in that order, so the result is the same as the serial loop's whatever the timing. Decide and state what the byte and time budgets mean with several workers (a file started before the budget ran out finishes its chunk).

**Proof.** The existing cases and the TypeScript twin pass unchanged. A differential test: the old serial function, kept for the test, and the new one give identical results over a fixture tree and a set of queries, run many times with different worker counts. Tests for the swap check on Windows (a junction swapped in for a folder after resolve; a symlink for a file where the machine allows one) and for a path outside the roots never being opened (the open counter). Time one query over this repository before and after.

**Numbers.** A query over 2,498 files: from about 0.6 s toward 0.17 s on one thread by the proxy, less with more.

## watch-ignore

**Today.** The tree watch skips only the twelve built-in names (`commands/fs.rs:19-32`); the index walk also honours `.gitignore` and `.ignore` in every folder and the user's deny globs, with a matcher in TypeScript (`packages/core/src/index-model/walk.ts:37-77`). So build output outside the twelve names is snapshotted, rescanned at least every 60 s, counted toward the 200,000-file cap (`tree.rs:20-23`), and produces events the index throws away.

**Do.** The walk already knows which folders it skipped. Pass that set to the tree watch (`watch_root` in `main.rs:699-727` gains a list of folders to leave out) and update it when a walk finds the rules changed, with a rescan. No matcher is ported to Rust. A folder that stops being ignored must be picked up; a file inside an ignored folder that the reader opens directly is watched by the flat watch as today.

**Proof.** A Rust test that a skipped folder's files do not appear in the snapshot, the count or the events; a browser test through the memory shell is not possible for the Rust side, so a `check:tauri` case if one fits: say so for the integrator.

**Numbers.** For a fixture tree with an ignored build folder: files in the tree watch's snapshot before and after (the ignored folder's files gone). Nothing the measuring tool sees.

## read-tree

Only if X8 says a round trip costs enough. **Today** the walk awaits one `readDir` per folder (`apps/desktop/src/index/walk.ts:244-252`), reads each ignore file, then reads the heads of Markdown files sixteen at a time (up to 256 KB each), skipping files whose size and time match the previous snapshot (121-124); `read_dir` returns an absolute path per entry as JSON (`commands/fs.rs:349-388`).

**Do.** A command built on `one-listing`'s lister that walks a root in Rust and returns, in pages, each folder's entries (names relative to the folder, kind, size, time) and the text of each ignore file, applying the deny list, the home-sized skip list and the folder budget as the walk does. The walk applies its rules in TypeScript as now and asks for heads only for files that are new or changed, in batches through one call. Markdown stays parsed in TypeScript only. Both shells implement it (`shell/tauri.ts`, `shell/memory.ts`), and it is registered in `build.rs`, `generate_handler!`, `capabilities/main.json` and `settings/privacy.ts`.

**Proof.** The walk's result for a fixture tree equals today's, entry for entry; the shell call count for a walk of N folders is a small constant plus pages, not N.

**Numbers.** Shell calls for a first walk of a tree of 200 folders, before and after (the memory shell records its calls); in the built app, the walk's time on the trees X8 used.

## scope-keys

**Today.** `scope::check` (`scope.rs:216-246`) builds fresh key lists from the opened set on every call (`spelled_keys`, `canonical_keys`) and `judge` (86-113) scans them linearly. The opened set gains an entry for every file opened and every image measured (`file_scheme.rs:172`, `:263-273`) and nothing removes them. Every path command pays this, including each of up to 2,000 paths in `detect_files`.

**Do.** Keep the keys in the set, updated when it changes, as hash sets. Leave the checks themselves exactly as they are: this is a cache of their inputs, not a change to what is allowed. Do not add removal unless you can show which entries are safe to drop.

**Proof.** The scope tests (`scope_tests.rs`, 720 lines) pass unchanged; a test that a thousand calls after a thousand opens allocate no per-call key list (count through a hook) or run in time linear in calls, by counted work, not a clock.

**Numbers.** None the reader or the measuring tool sees; the count in the proof is the result.
