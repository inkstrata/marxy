# Verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### PRS-01 verdict
- Verdict: CONFIRMED
- Proof: probes/PRS/changelog.verify.mjs (output changelog.verify.out), 2 MB changelog on chromium: the first typed letter in the palette holds the page 4316 ms, the next letter 193 ms (same buffer, WeakMap hit). Control, same bytes named NOTES.md (not a changelog kind): first letter 203 ms. Code: kind-tools.ts:38-45 `releaseOf` calls `parseMarkdown(buffer.bytes)` keyed by Buffer, reached from `hasRelease` (when/unavailable, :131-132). Not a duplicate of any finding or todo row; no doc makes it intended (docs/big-files.md rule 1 says reuse the store's parse). The "once per edit" part follows from the Buffer-keyed WeakMap and was not driven. Ctrl+K itself costs about 3.6 s on both files (even non-changelog), a separate cost.
- Severity: S1 (agrees; a multi-second freeze on a 2 MB file, one release heading per ~60 bytes is an extreme changelog, so real-world size is smaller)
- Fix hint: have `releaseOf` read `store.snapshot().ast` (or `when` scan only the head bytes for a version heading); test: open a big CHANGELOG.md, open the palette, type a letter, assert the next evaluate answers under a second.
- Checked by: verifier A, 2026-11-28

### SCH-01 verdict
- Verdict: DUPLICATE of TWO-01
- Proof: TWO-01 (earlier in findings.md) names the same cause, a newer open queued on `view.serially` behind a parse that only `closed` can cancel (open.ts:660, :1048-1053); same wait, same repro. Not a todo row.
- Severity: S2 (agrees)
- Fix hint: one fix, an open generation checked by the parse, node-map and render slices; see TWO-01.
- Checked by: verifier D, 2026-11-28

### SCH-02 verdict
- Verdict: NOT-REPRODUCED
- Proof: the only user of the `viewport` lane is `JobQueue` (render/highlight-queue.ts:16), which is constructed only inside render/highlight.worker.ts:57, so it runs in the highlight worker with its own copy of the scheduler module, where no input-lane job exists. highlight.ts:237 has no main-thread fallback. probes/SCH/hl-contend.verify.mjs (output hl-contend.verify.out): colouring the 17 in-view fences takes 94-97 ms alone and 95-97 ms with a 2 ms-slice input-lane job running on the main thread, 2 runs each; the catcher's 100 ms per job would be 1.7 s. The catcher's lane-starve probe is true of the scheduler module but the contention does not cross the thread.
- Severity: none for this report. The lane model has no main-thread user of `viewport` or `background`, so those lanes are dead code there (a smaller, separate observation).
- Fix hint: none needed for highlighting. If viewport work ever moves to the main thread, background jobs should not use `input`.
- Checked by: verifier D, 2026-11-28

### SCH-03 verdict
- Verdict: CONFIRMED
- Proof: probes/SCH/first-colour.verify.mjs (output first-colour.verify.out), 2 of 2 runs, headless Chromium, memory shell, 2.5 MB file with 40 fences at the top: the page stops growing at 8.5 and 8.6 s and the first fence is coloured at 9.2 and 9.4 s. The code says so on purpose (rendered-view.ts:2706-2712, colour runs after `current.complete`), but no doc in docs/ promises or excuses it, so not BY-DESIGN. Time to first colour follows the file size, not the screen.
- Severity: S3 (agrees)
- Fix hint: start the highlight pass for blocks in the first screens before `complete`, leaving images, KaTeX and the far blocks until after; test: open a big file with fences at the top and assert colour before the mount is complete.
- Checked by: verifier D, 2026-11-28

### TWO-03 verdict
- Verdict: CONFIRMED
- Proof: probes/TWO/open-several.verify.mjs calls the real `holdSystemOpens` (app.ts:138 wires it to `panes.openIn('focused', file)`): one payload of three paths opens only "/a.md"; held before launch, payloads of 2 and 1 paths open "/a.md" and "/c.md" ("/b.md" lost) (output open-several.verify.out). Rust (`deliver_open_files`) puts every path in scope and emits all, so the loss is in `take`. The OS-level launch with several arguments was not driven in the real window
- Severity: S2 (agrees)
- Fix hint: `take` should open every non-flag path in order (or in tabs); unit test on `holdSystemOpens` with a three-path payload, before and after `release()`
- Checked by: verifier C, 2026-11-28

### PRS-03 verdict
- Verdict: CONFIRMED
- Proof: probes/PRS/lines-naming.verify.mjs times the real `linesNaming` on 2 MB: 1000 paths 614 ms, 2000 1098 ms, 4000 2200 ms, 8000 4139 ms; 2000 paths over 1/2/4 MB: 582/1130/2311 ms, so cost is paths x size and it runs synchronously from `saidOf` (doc-links.ts:68-90). Matches the catcher's 1.4 s at 2,271 paths (probes/PRS/paths2k.out)
- Severity: S2 (agrees)
- Fix hint: take mention lines from the one pass `pathMentions` already makes, or a single scan with a path-start index/regex alternation; a growth case in packages/core scale tests or a panel test with thousands of paths
- Checked by: verifier C, 2026-11-28

### PRS-02 verdict
- Verdict: CONFIRMED
- Proof: probes/PRS/both.verify.mjs (output both.verify.out), chromium: Alt+ArrowDown on an outline row holds the page 6701 ms (first move) and 6554 ms (second move) on a 2 MB file of `## Section n`, against 459 and 424 ms on a 100 KB file, so every move pays and the cost grows with the file. Code: outline.ts:~272 encodes a full candidate and calls `parseMarkdown(candidate)` plus `blockKeys` before `store.apply`; the catcher's profile (move.out) puts 3.5 s of the stall in that parse, the rest being `store.apply`/repaint (a separate cost). I did not strip the parse out to measure it alone. Not a duplicate; no doc makes it intended. The drag loop (`moveTo` n times) was read, not driven.
- Severity: S1 (agrees; a multi-second hold per keypress on a 2 MB file)
- Fix hint: check the shape from the existing parse's blocks and the splice's bounded range (reparse only the affected span), or run the check sliced; test: move a section in a 2 MB file and require the page to answer under 1 s.
- Checked by: verifier A, 2026-11-28

### PRS-04 verdict
- Verdict: CONFIRMED
- Proof: probes/PRS/both.verify.mjs (output both.verify.out), chromium, 2 MB Markdown of sections and task lists: after Alt+6 the worst gap between page answers over 30 s is 7736 ms with a leading U+FEFF and 1299 ms without. Code: transforms-model.ts:182-183 sends a BOM text to `parseMarkdown(encoder.encode(text))` on the main thread, and transforms.ts `crParse`/`textParse` lend nothing for a BOM, so the store's parse (`snapshot().ast`) goes unused. Not a duplicate; no doc makes it intended. The replaced-byte variant was not driven.
- Severity: S1 (agrees)
- Fix hint: for a BOM, parse once through the store (shift offsets by 3 bytes) or hand `byNodes` the store's ast with the bytes' own text; test: open a BOM-prefixed 2 MB file, press Alt+6, require answers under 2 s.
- Checked by: verifier A, 2026-11-28

### TWO-04 verdict
- Verdict: CONFIRMED
- Proof: probes/TWO/edit-gap.verify.mjs (own probe, 3 MB file, version 2 planted 300 ms after the open starts): h1 stays VERSION1 for 41 s although the watch call count rises to 4 by 11 s; an event for another file does not change it (output edit-gap.verify.out). Code agrees: `watches.watch(current)` runs only after typeset and `whenIdle` (open.ts:975-985) and `watchFolderOf` (live-reload.ts:495-520) never compares store bytes with disk. Not shown: whether an event for the file itself reloads (15 s after one the page was still VERSION1, inconclusive for a 3 MB reload); a real watcher not driven
- Severity: S2 (agrees)
- Fix hint: when the watch comes up, compare disk (size/mtime or hash) with the store and reload if different; test: plant v2 during a slow open, assert the h1 changes once the watch is up
- Checked by: verifier C, 2026-11-28

### TWO-01 verdict
- Verdict: CONFIRMED
- Proof: probes/TWO/open-queue.verify.mjs (output open-queue.verify.out, headless Chromium, 3 MB list-heavy file): B opened and, in the same tick, a small file; the small file's open settled and its h1 showed at 24.1 s, with B's own open settling at 23.8 s; a lone open of the same size settles in 22.5 s and the small file alone in 0.5 s. Code agrees: open.ts:1048 queues on `view.serially` and the parse's abort test is `() => closed` (open.ts:660). Same symptom as hunt-03 NAV-04 (a second open behind a mounting one); that row is no longer in work/todo.md and the wait is still there. SCH-01 is the later duplicate of this one.
- Severity: S2 (agrees)
- Fix hint: give each `open` a generation; `parseLarge`, `buildNodeMapInSlices` and the sliced render test "a newer open exists" as well as `closed`, and let a queued open skip the work of one it supersedes. Test: open a big file and at once a small one, assert the small one shows well before the big one's parse would end.
- Checked by: verifier B, 2026-11-28

### TWO-02 verdict
- Verdict: NOT-REPRODUCED
- Proof: the catcher's baseline is wrong and the double parse does not happen. probes/TWO/first-text-alone.verify.mjs (.out): a lone 3 MB open shows first text at 18.9 s, not 0.5 s (the catcher's "0.5 s" was the other pane showing an earlier file); the same file in both panes at once shows text at 20.7 s and 24.1 s. probes/TWO/two-panes.verify.mjs (.out): long-task time 22.9 s alone against 34.2 s for both; probes/TWO/two-panes-first-text.verify.mjs (.out): a second pane opening the settled file costs 5.5 s of long tasks (first text 2.1 s). 23 + 5.5 = 28.6 s, which is what both-at-once measured (28.6 s), so there is one parse plus two page mounts. A second parse would add about 11 s more. The slowness of a lone big open is the existing large-open cost, not this finding.
- Severity: n/a (was S2)
- Fix hint: none for the double parse. If wanted, the real defect is only that `holding` is read before the other pane acquires (open.ts:650), which no probe showed costing anything.
- Checked by: verifier B, 2026-11-28

### TWO-05 verdict
- Verdict: CONFIRMED
- Proof: probes/TWO/open-queue.verify.mjs (open-queue.verify.out): C opened (22.4 s, 1 readFile), settled and clean; `open('/demo/C.md')` again with no `at` took 24.2 s and made a second readFile (1 to 2). The catcher's twice.out shows the in-flight case (two requests in one tick, two reads, 44.8 s). No doc in docs/ says a repeat open is meant to reload; the only guard is the unsaved-changes one (open.ts:1048).
- Severity: S2 (agrees; grows with the file, a click on the document's own link or crumb pays it)
- Fix hint: in `open`, return early for `file === currentPath()` with no `at` when the store is clean (or compare disk to the store's bytes); join an in-flight open of the same path. Test: open a big file, open it again, assert no second readFile and the page node is the same.
- Checked by: verifier B, 2026-11-28
