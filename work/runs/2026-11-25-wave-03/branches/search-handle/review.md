# search-handle: review (Opus)

**Verdict: ready after my fix.** Fix `d1edf35b` on top of `c51a25f6`; tree clean.

## Verify rerun

`--tier changed --from cargo`: cargo 628 pass, 0 fail, 6 skip, 20.4 s; no hang (`work\wave3\search-handle-verify.log`). After the fix `cargo test` 629 pass; `pnpm lint:rust` clean.

## Fix

Once the merge had settled the outcome (e.g. the hit limit reached), the other workers read their files to the end before the search returned. With a 3-hit limit on a small file followed by a 200 MB file: 1 worker 0.5 ms, 2 workers 2-2.8 s (debug). A `settled` flag on `Plan`, checked by `scan_file` at each chunk, plus a test; 2 workers now 0.5-0.7 ms. Results unchanged (the flag is set only after every slot that counts is taken).

## Safety checks on Windows

- Spelling before disk: `expected_paths` refuses `\\.\pipe\x`, `\\.\CON`, `\\?\…` by spelling; the opened-paths test confirms nothing outside is opened.
- Handle check: making it always pass fails the junction-swap test; it judges after the open, so a swap after the judgement is caught.
- Device names and pipes: CON, AUX, PRN, COM1, LPT1, CONIN$, CONOUT$ and `con.md` under a root are ordinary missing files on Windows 11. NUL opens the device; the handle check refuses it and it counts as one skipped file (the old search counted nothing). Opening a pipe does not block on Windows.
- A symlink inside a root to a pipe or a `\\host` share is followed by the open; the old canonicalise followed it too. No worse than before.

## `find_folded`

About 1.48 million comparisons against lowering first, every byte value, bytes over 127, every start position: identical.

## Merge and differential

Merge applies hit limit, file limit, byte budget, `truncated`, `stopped` as the serial loop. Seven mutations all caught: ignoring the room left, not ending when full, out-of-order merge, a skip counted as scanned, no upper-case folding, no dedupe, losing `truncated`. Gap: never exercises the 1 GB and 100,000-file budgets.

## Cancel, deadline, memory

Cancel and deadline checked at every chunk and file: all workers stop promptly. About 32 MB for 8 workers with 4 MB chunks. Open-ended: if one early file is slow, workers buffer hits of files read ahead of it, each at most `min(per_file, limit)`, and `per_file` has no upper bound. Follow-up, not blocking.

## Orchestrator notes

- Behaviour change to note for Ian: `NUL` under a root now counts as one skipped file.
- Follow-ups to file: bound the read-ahead buffer (cap `per_file`, or limit how far workers run ahead of the merge); a test of the byte and file budgets at reduced constants.
