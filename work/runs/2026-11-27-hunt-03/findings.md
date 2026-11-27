# Hunt 03 findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### SHL-01 · Opening or switching a 4.9 MB Shift_JIS/GBK file to its encoding: 3.4 s decode, a 19.6 MB byte map, a 27 MB IPC frame (1 MB: 1.1 s, 2 MB: 1.6 s)
- Severity: S2 stall
- Domain: shell-ipc
- Where: apps/desktop/src-tauri/src/encoding/mod.rs:449-476 (`decode_mapped`), apps/desktop/src-tauri/src/encoding/commands.rs:34-50 (`frame`), packages/core/src/encoding/byte-map.ts:87-93 (`parseDecodedFrame`)
- Repro: a 4.9 MB Shift_JIS (or GBK, Big5, EUC-KR) text file of mostly CJK characters; open it and choose the encoding (Read with encoding), or open one whose bytes are guessed so; any save of it
- Expected: decode time and memory close to the file's size, like the single-byte and UTF-16 paths (UTF-16 4.9 MB: 0.49 s, no table)
- Actual: `decode_mapped` feeds the decoder one byte at a time and records a (UTF-8 offset, file offset) pair wherever the difference changes, which for pure CJK is every character: the table holds 4 bytes per file byte. Shift_JIS pure: 1 MB 1.11 s / 4.0 MB table; 2 MB 1.62 s / 8.0 MB; 4.9 MB 3.41 s / 19.6 MB table, frame 27 MB (text 7.35 MB). Mixed ASCII/CJK 4.9 MB: 2.5 s, 13.4 MB table. `parseDecodedFrame` then loops `getUint32` 4.9 million times on the main thread and copies the table into a Uint32Array. `decode` also runs `encode_body` again for the `writable` check (extra full pass), and after a save of a table-mapped file `encoding.ts:262` calls `decodeText` on the written bytes again (another full decode of this size). Each decode also copies the request body (`to_vec`, commands.rs:46) and holds raw bytes + text + table in the page.
- Evidence: probe probes/SHL/enc_probe_main.rs, output probes/SHL/enc.out (Rust release build of the unmodified encoding module; times on a shared Mac, so read the ratios: 1 to 2 MB 1.46x, 2 to 4.9 MB 2.1x, roughly linear, but the constant is high and the table is 4x the file). Not driven in the real window.
- Confidence: high
- Found by: catcher SHL, 2026-11-27

### MEA-01 · Opening a 1 MB Markdown prose file keeps the window busy for 62 s on macOS; each doubling costs about 4x (0.5 MB: 15 s, 1 MB: 62 s)
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (progressive mount, per-chunk layout; the call that `contentComplete` waits on), packages/typeset (relayout per mounted chunk)
- Repro: plant `big-md-prose-<size>.md` from probes/gen.mjs (`md-prose`) in the memory shell, `handle.open(path)`, wait until the main thread is quiet; headless Chromium 1440x900, Apple silicon, macOS 26
- Expected: first text in well under a second and the thread idle within a few seconds, growing in step with the file
- Actual: first text comes fast (0.5 MB: 0.58 s; 1 MB: 1.1 s) but the thread stays busy: 0.5 MB 14.8 s (task 13.0 s, 1,228 layouts, 47k nodes); 1 MB 62.3 s (task 59.7 s, 2,842 layouts, 87k nodes, longest task 1.1 s). Ratio per doubling 4.2x of wall and 4.6x of task time: quadratic. Keys and scrolls answer meanwhile only between long tasks (key 185 ms of task, scroll 190 ms at 1 MB).
- Evidence: probe probes/MEA/matrix.mjs, output probes/MEA/md-prose.json (other catchers share the machine; counts agree with the times). Adds to todo row R13: this is its first macOS measurement, and it matches the Windows 78 s for 1 MB.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### SHL-02 · Ordinary Shift_JIS and GBK text files are judged to be damaged UTF-8 and shown as mojibake, at any size
- Severity: S2 wrong output
- Domain: shell-ipc
- Where: apps/desktop/src-tauri/src/encoding/mod.rs:180-196 (`looks_like_utf8`), :205-209 (`sniff`)
- Repro: save a few Japanese sentences (for example 吾輩は猫である。名前はまだ無い。) as Shift_JIS, repeat to 100 KB or 4.9 MB, open it in Marxy; the same with GBK Chinese
- Expected: guessed as Shift_JIS or GBK (chardetng names them correctly, probe: Shift_JIS from 1 MB of it), or at least offered
- Actual: `sniff` returns `utf-8, How::Utf8` for all three natural Japanese samples and the GBK sample: `looks_like_utf8` returns true as soon as any well-formed two-byte UTF-8 sequence follows an invalid byte, and in Shift_JIS the very common pair の (82 CC) followed by a lead byte 81-9F is exactly such a sequence (CC 8x). The bytes are then read "as written" (identity map), so the page shows replacement/garbage characters and the "guessed" row of Read with encoding is never reached. Same at 1, 2 and 4.9 MB (a big file only makes the wrong text bigger).
- Evidence: probe probes/SHL/enc_detect_probe.rs, output probes/SHL/enc.out (last line): `natural sjis ... detected utf-8 how=Utf8`, `natural gbk: detected utf-8`; Rust release build of the unmodified encoding module. Not driven in the real window; the reader can still pick the encoding by hand.
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### EDT-01 · Every edit to a file with one stray (non-UTF-8) byte re-decodes the whole file: one-byte splice 0.9 s at 1 MB, 1.9 s at 2 MB, 4.3 s at 4 MB, 4.8 s at 4.9 MB
- Severity: S2 stall (4.8 s per edit at 4.9 MB; the same cost on every undo, redo, format op, replace and leave-Source)
- Domain: editing, buffer
- Where: packages/core/src/buffer/buffer.ts:60-70 (`splice` -> `makeBuffer` at :190), packages/core/src/parse/byte-offsets.ts:60-110 (`decodeWithOffsets` invalid-UTF-8 branch: a `Uint16Array` and a `Uint32Array` the size of the file and a per-byte loop)
- Repro: a Latin-1 or mixed-encoding text or Markdown file of 1-5 MB with a single byte 0xE9 in it (a legacy export is enough); edit one character in Source and leave Source (Mod+E), or press Mod+Z after a Read-mode edit
- Expected: a one-byte edit costs about the size of the edit, or at worst one copy of the bytes (milliseconds)
- Actual: `splice` copies the bytes and then `makeBuffer` decodes them again strictly, fails, and rebuilds the text and the offset table byte by byte; node, one-byte splice at offset 5000, median of 9: 1 MB 892 ms, 2 MB 1933 ms, 4 MB 4305 ms, 4.9 MB 4787 ms (heap 76 MB). A valid UTF-8 file does the same decode and EOL scan without the table (ASCII 4.9 MB 270-715 ms, non-ASCII 4.9 MB 670-980 ms, machine loaded, noisy), so the cost is in every splice, and ten times larger for a file with a stray byte
- Evidence: probe probes/EDT/splice-nonascii.mjs (output probes/EDT/splice-nonascii.out, the stray rows ran twice with the same shape); code reading: `makeBuffer` always runs `decodeWithOffsets(bytes)` and `detectEol(bytes)` over all bytes
- Confidence: high
- Found by: catcher EDT, 2026-11-27

### EDT-02 · Every splice of a valid UTF-8 file rebuilds the whole text, offset table and line-ending scan: a one-byte edit costs 10-80 ms at 1 MB and 270-980 ms at 4.9 MB, on every operation
- Severity: S3 slow (200 ms-1 s per action at 4.9 MB; 20 edits in a row 8.5 s)
- Domain: buffer, editing
- Where: packages/core/src/buffer/buffer.ts:60-70 (`splice`), :187-200 (`makeBuffer`: `decodeWithOffsets`, `detectEol`), packages/core/src/parse/byte-offsets.ts:30-46 (`isAscii` scan; a `Uint32Array` of 4 bytes per code unit for any non-ASCII file)
- Repro: open a 4.9 MB Markdown or text file; toggle a task box, apply a format op, replace one match, leave Source after one keystroke, or undo/redo, twenty times
- Expected: the cost of an edit does not grow with the file (the store reparses only touched blocks)
- Actual: each splice allocates a new array of the file size, decodes it into a new string, scans it for ASCII and for line endings (and, if the file holds one non-ASCII character, fills a 4-bytes-per-unit table); node, 20 one-byte splices in a row: md-prose 1 MB 1.2 s, 2 MB 2.9 s, 4.9 MB 8.5 s; one-byte splice median 4.9 MB ASCII 270-715 ms, non-ASCII 670-980 ms (machine shared by six catchers: wide spread, same order each run). History holds splices not snapshots (store.ts HISTORY_DEPTH 100), so memory is fine; the time is the problem
- Evidence: probe probes/EDT/core-bench.mjs (core-bench.out), splice-bench.mjs (splice-bench.out), splice-nonascii.mjs (splice-nonascii.out); code reading of `makeBuffer`
- Confidence: medium (ratios noisy under load; the O(n) path is certain)
- Found by: catcher EDT, 2026-11-27

### NAV-01 · Find on a 2 or 4.9 MB page reports a final-looking count for only the part mounted so far: 22,364 of 32,442 matches at 2 MB for about 60 s, 21,902 of 79,492 at 4.9 MB for over 75 s
- Severity: S2 wrong result
- Domain: find, progressive mount
- Where: apps/desktop/src/find/view.ts (count and refresh over `walkText(article)`), apps/desktop/src/find/walk.ts:79 (`collectText` walks only mounted nodes)
- Repro: plant a 2 MB (or 4.9 MB) `md-prose` file (probes/gen.mjs), open it, wait 3 s, Mod+F, type `the `; read `.marxy-find-count` every 5 s
- Expected: the count says it is still counting while the page is still mounting (docs/using-marxy.md "Find and replace" promises "still counting" for passes), or covers the whole file; Enter reaches every match
- Actual: 2 MB: "1 of 22364" for 57 s while the article grew from 1.34 M to 1.84 M characters, then "1 of 32442" at 62 s (the true count); 4.9 MB: "1 of 21902" for the whole 75 s watched (article 1.33 M to 1.86 M of about 4.9 M characters, 4438 to 6238 of 15,197 blocks), true count 79,492. No "still counting" text. The mount runs at about 25-30 blocks per second. A word found only in the unmounted rest answers as no match
- Evidence: probes/NAV/findcount.mjs, output probes/NAV/findcount.out (Chromium); also probes/NAV/find.out (a 1 MB file, mounted at once, counts 16,226 = true count; 2 MB and 4.9 MB at 8 s read 22,010 and 22,310). Adds to the todo row about the page busy after a big open (hunt-02) only as to find: the wrong answer is find's
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### NAV-02 · The Line's `@` (this document's headings) draws a row for every heading and redraws all of them on every key: 59,605 headings (4.9 MB) take 5 s to open and 12 to 15+ s per letter typed
- Severity: S1 freeze
- Domain: line (`@` scope), palette list
- Where: apps/desktop/src/line/scopes-rows.ts:84-104 (`outlineRows` pushes one `LineRow` per matching heading, no cap, with a `preview` closure and `keep` object each), apps/desktop/src/palette/view.ts:1382-1388 (`dressModel` runs the whole scope on every keystroke and builds `blocksOfRows`/`asItems` over all rows)
- Repro: plant `md-headings` at 1, 2 and 4.9 MB (12,272 / 24,409 / 59,605 headings), open, wait 6 s, Ctrl+K, type `@`, then `H`, `e`, ` 9`
- Expected: a bounded list (every other Line scope caps: `/` takes 200 of 500 hits, tabs 8, `@` parts 400), a key answered in well under a second
- Actual: task time per key. 1 MB: `@` 1.7 s, `H` 2.0 s, `e` 2.9 s, ` 9` 4.8 s; 2 MB: 2.3, 3.5, 3.8, 4.8 s, and three Backspaces 10.6 s; 4.9 MB: `@` 6.0 s, `H` 12.5 s, `e` 17.2 s, ` 9` and later keys stall past a 15 s race; DOM nodes grow from 0.38 M to 2.3 M (about 20x the 1 MB figure at 5x the file). Fuzzy `H` and `e` match nearly every heading, so narrowing the query does not shrink the list until it is long
- Evidence: probes/NAV/line.mjs, output probes/NAV/line.out (Chromium, `Performance.getMetrics` deltas per key). Cause read in code: no `slice` anywhere on the outline rows (`outlineRows` returns every heading; the palette draws them all)
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### EDT-03 · Pasting HTML with about 130,000 sibling blocks (1 MB of `<div><p>a</p>...`, or a 3.7 MB table) throws "Maximum call stack size exceeded"; deeply nested wrappers grow as n squared (8,000 deep 0.3 s, 32,000 deep 5 s)
- Severity: S2 wrong output (the paste fails; 32,000 nested blocks 5 s, 130,000 never ends in 10 s)
- Domain: paste
- Where: apps/desktop/src/paste/html-to-markdown.ts:245 and :262 (`out.push(...blocksOf(n.childNodes))`), :219 (`Math.max(...grid.map(...))` for table rows), :24 (`containsBlock` spreads `querySelectorAll('*')` for each nested paragraph/wrapper level)
- Repro: copy HTML of 130,000 `<p>a</p>` inside one `<div>` (1.04 MB), or a `<table>` of 130,000 rows (3.8 MB), and paste into Source (Mod+Shift+V / paste as Markdown)
- Expected: the text is converted, in time linear in its size
- Actual: probe in the page, `htmlToMarkdown(html)`: div of `<p>`: 32,000 -> 133 ms, 130,000 -> RangeError after 540 ms; the same 130,000 `<p>` at body level (no wrapper) -> 451 ms, fine; table 32,000 rows 290 ms, 130,000 rows -> RangeError; nested `<div>` x n: 2,000 22 ms, 4,000 81 ms, 8,000 313 ms, 32,000 5,039 ms, 130,000 > 10 s (n squared); nested `<blockquote>` 8,000 445 ms, 32,000 5,376 ms. Chromium only (the engine's argument limit differs in WebKit)
- Evidence: probe probes/EDT/paste-html.mjs (output paste-html.out; the "STALL" rows after the first one are the page still busy from the row before, not new results)
- Confidence: high
- Found by: catcher EDT, 2026-11-27

### SHL-03 · Saving a 40 MB file takes 4 s and an 80 MB file 10 s on Apple silicon: the stale-write check hashes the whole file with the slow portable SHA-256
- Severity: S2 stall
- Domain: shell-ipc
- Where: apps/desktop/src-tauri/src/atomic_write.rs:288-330 (`check_unchanged` reads the whole destination and hashes it), :375-420 (`sha256::Hasher`, `fast` is read only on x86_64), :1508 (`stage` also `fs::copy`s the old file first)
- Repro: open a 40 MB or 80 MB text file in Source (past 32 MB Read does not edit, Source does; the open limit is 256 MB), type one character, save
- Expected: a save costs about a write of the file (tens of ms for 40 MB: the unguarded write below)
- Actual: with the expectation every page save sends, the shell re-reads the destination and hashes it in `std` code with no CPU SHA path on aarch64 (the `fast` flag exists for x86_64 only): 5 MB 0.16 s, 10 MB 0.70 s, 20 MB 1.6 s, 40 MB 4.0 s, 80 MB 9.9 s (about 8 MB/s per second of delay on this Mac), against 35, 37, 71, 177 and 206 ms for the same save with no expectation. The 256 MB open ceiling would take about 30 s. The page hashes the same bytes with WebCrypto in a fraction of that (`fingerprint`, tauri.ts:140). The save runs off the main thread, so the window answers, but the save (and anything queued behind it for the same path, `writing`) does not finish. On a 4.9 MB file the cost is only about 70 ms.
- Evidence: probe probes/SHL/save_probe_drv.rs, output probes/SHL/save.out (the real atomic_write.rs, release-optimised, times include the old-file `fs::copy` in both columns, so the difference is the check). Not driven in the real window.
- Confidence: high
- Found by: catcher SHL, 2026-11-27

### SHL-04 · Read with encoding... on a 4.9 MB Shift_JIS file waits 2.6-3.2 s for its table (1 MB: 0.5-0.9 s, 2 MB: 1.4-1.6 s), and a guess on any 1 MB or more costs 0.8 s before the file is decoded at all
- Severity: S2 stall
- Domain: shell-ipc
- Where: apps/desktop/src-tauri/src/encoding/mod.rs:657-690 (`readings`: 13 candidate labels, each `count_unreadable` over up to 8 MB), :205-215 (`sniff` feeds chardetng 1 MB)
- Repro: open a 4.9 MB Shift_JIS or Latin-1 log; open Read with encoding...; or just open it
- Expected: the panel's rows within a screen refresh; the guess bounded by a few hundred KB
- Actual: `readings` decodes the same bytes up to 13 times, each through a 64 KB buffer and `decode_to_utf8_without_replacement` that stops at every malformed byte: 4.9 MB Shift_JIS 2.6-3.2 s, 4.9 MB Latin-1 log 1.4 s (the same file decodes in 0.74 s). The 4.9 MB ASCII log with a few stray bytes is quick (0.17 s), so the cost grows with how many bytes are not valid in the guess. `sniff` always feeds chardetng 1 MB (0.8-0.9 s for Shift_JIS, the same at 1, 2 and 4.9 MB), so every non-UTF-8 file from 1 MB up pays that much on every open and every live reload (`lookForStore` decodes the whole file again each time the file changes).
- Evidence: probe probes/SHL/enc_detect_probe.rs (the final main() differs; the probe's output is in probes/SHL/enc.out): Rust release build of the unmodified encoding module, quiet and shared machine both measured. Adds to SHL-01 for the same files.
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### EDT-04 · Copy of a whole big page (select all) takes 0.2 s at 0.5 MB, 0.85 s at 1 MB, 1.2 s at 2 MB: 4x for double the text; the copy is also only the drawn part
- Severity: S2 stall (1.2 s of main-thread work per copy at 2 MB, the same again for the HTML flavour; grows faster than the text)
- Domain: copy
- Where: apps/desktop/src/selection/copy-text.ts:23-52 (`cloneRangeInert`: `range.intersectsNode` for every node, recursion per node), :84-103 (`textFromFragment`), apps/desktop/src/selection/copy-html.ts:49-57 (`clean` over the fragment, then `innerHTML`, then `sanitizeHtml` of the whole string)
- Repro: open a 1-2 MB Markdown file (md-prose from probes/gen.mjs), select all in the page and Copy (rich) or Copy as plain text
- Expected: copy time that follows the selected text, a few hundred ms at most for 1 MB
- Actual: in the page, `textFromRange` / `htmlFromRange` over `article` contents, two runs: md-prose 0.5 MB (8.1-8.4k nodes) text 208/223 ms, html 252/280 ms; 1 MB (13k nodes) text 876/846 ms, html 979/984 ms; 2 MB (12-13k nodes) text 1256/1199 ms, html 1330/1153 ms; md-tables 0.5 MB (57k nodes) text 759/908 ms, html 1133/1208 ms; 1 MB text 906/1031 ms, html 1194/1101 ms. Node count is flat from 1 to 2 MB (the page draws a window) yet the time is not, so the cost is in the text size rather than the node count. A select-all copy also holds only the 1.1 MB the page drew of a 2 MB file (text 1,101,638 chars), which `docs/using-marxy.md` should say or Copy as markdown should be offered (it copies the bytes)
- Evidence: probe probes/EDT/copy-all.mjs (output copy-all.out; Chromium, machine shared, the two runs agree to about 10 percent)
- Confidence: medium (timed the two functions the commands call, not the click path or the clipboard write)
- Found by: catcher EDT, 2026-11-27

### RDR-01 · Editing one footnote or reference definition re-parses the whole file on the main thread (1 MB: 1.3 s, 2 MB: 3.0 s, 4.9 MB: 8.2 s)
- Severity: S1 freeze (4.9 MB: 8.2 s; S2 at 1-2 MB)
- Domain: read path, parse
- Where: packages/core/src/parse/reparse.ts:100-140 (`'definition'` result falls back to a whole parse), packages/core/src/parse/reparse.ts:67
- Repro: plant a 1-4.9 MB Markdown file with many `[ref-n]: url` and `[^n]: note` lines at the end (gen.mjs kind md-references); change one byte inside a definition (a body edit at 50% costs 10 ms at 1 MB, 9 ms at 2 MB, 124 ms at 4.9 MB, kind "region"); the same call for a definition change reports kind "whole"
- Expected: a change to one definition re-parses its own region and the blocks that name that label, not the file
- Actual: `reparseMarkdown` in the page: definition edit 1 MB 1325 ms, 2 MB 3018 ms, 4.9 MB 8231 ms (`kind: whole, parsed: <file size>`); linear, but every definition edit in a references-heavy file costs a full parse plus the full render diff that follows
- Evidence: probe probes/RDR/inpage.mjs, outputs probes/RDR/inpage.out (AT=0.97, definition) and probes/RDR/inpage-body.out (AT=0.5, body), run in Chromium in the page via dynamic import of core. Reason string in the output: "the change adds, removes or changes a definition, which applies across the file". Not driven through the Source typing path, so the per-keystroke count is not measured
- Confidence: medium
- Found by: catcher RDR, 2026-11-27

### EDT-05 · Leaving Source after one typed character takes about 1 s on a 2 or 4.9 MB Markdown file (0.6-1.1 s on a 4.9 MB text file), and Undo after it 0.5-0.7 s
- Severity: S3 slow (0.8-1.7 s per leave, every time, whatever was typed; the keystrokes themselves are fine)
- Domain: editing, Source
- Where: apps/desktop/src/source/buffer-commit.ts:`leaveSourceMode` (`foldText` then `splice`), packages/core/src/buffer/buffer.ts:60-70 and :187-200 (`splice`/`makeBuffer`), then the page set after the change
- Repro: open a 2 MB or 4.9 MB Markdown file, Mod+E, type one letter, Mod+E; then Mod+Z
- Expected: leaving after a one-character edit costs about as much as the edit (the store reparses only the touched block)
- Actual: Chromium, shots scenario, `body[data-marxy-mode]` to `rendered` after the key: md-prose 2 MB first leave 1,106 ms, then six more leave cycles 829-2,152 ms (median about 950); 4.9 MB first leave 1,163 ms, cycles 884-1,705 ms (median about 1,100); txt 4.9 MB 960 ms, cycles 589-1,128 ms; Undo (Mod+Z) 0.54-0.73 s on all three. Node: `foldText` on 4.9 MB 475-550 ms and the splice 270-500 ms of that (EDT-02). Typing in Source is flat and cheap: script time per key 6-8 ms at 1, 2 and 4.9 MB (the whole of a key's cost is CodeMirror's); heap (performance.memory, 1 MB steps) did not move over 7 leave/undo cycles. Machine shared, so read as an order of magnitude. Adds to EDT-02
- Evidence: probe probes/EDT/typing.mjs and typing2.mjs (outputs typing.out, typing2-txt.out, typing2-md.out); core-bench.out for the node parts
- Confidence: medium
- Found by: catcher EDT, 2026-11-27

### RDR-02 · Opening a Markdown file that holds a footnote or reference definition freezes the window while it is parsed whole (1 MB: 1.4 s, 2 MB: 2.4 s, 4.9 MB: 5.4 s)
- Severity: S1 freeze (4.9 MB: 5.4 s; S2 at 1-2 MB)
- Domain: read path, parse
- Where: packages/core/src/parse/chunked.ts:63-66 (`holdsDefinitionMark` returns `whole(...)` before any slice), packages/core/src/parse/reparse.ts:306
- Repro: plant gen.mjs kind md-references at 1, 2 and 4.9 MB, open it, watch long tasks (PerformanceObserver "longtask" installed before the open)
- Expected: the first page appears in slices like any other Markdown file (md-technical and md-prose open with no task over 0.3 s), or a definition index is built in a cheap first pass and the slices use it
- Actual: one long task at the start of the open: 1 MB 1377 ms, 2 MB 2426 ms, 4.9 MB 5432 ms; nothing else in the first 25 s is over 535 ms. Tab, keys and scroll are dead for that time. Any ordinary file with one `[x]: url` line takes this path
- Evidence: probe probes/RDR/stall.mjs, output probes/RDR/stall.out / stall.raw (Chromium, shots scenario). Parse alone in the page is 1.2 / 2.6 / 6.9 s at 1 / 2 / 4.9 MB (probes/RDR/inpage.out), so the parse is the task. Linear, not super-linear. Adds to the "a file that may hold a definition is parsed whole" threshold; docs/file-kinds.md size limits do not say it
- Confidence: high
- Found by: catcher RDR, 2026-11-27

### SHL-05 · A log growing in a folder of 10,000 files makes the watch rescan the whole folder at every write (19 ms at 1,000 files, 0.3 s at 10,000, 3 s at 50,000)
- Severity: S3 steady load
- Domain: shell-ipc
- Where: apps/desktop/src-tauri/src/watch/spawn_notify.rs:31-48 (`flat_loop`: one `poll` per signal, only queued signals are folded), apps/desktop/src-tauri/src/watch/mod.rs:497-546 (`scan`, `scan_entries`: stat of every entry), :575 (`diff` over two whole maps)
- Repro: open a log that a program appends to many times a second, in a folder with 10,000 or more files (a logs or exports folder); watch the process
- Expected: the cost of a write is about the file's, not the folder's; or a minimum gap between scans
- Actual: each notify signal runs `poll()`: list the folder, `entry.metadata()` for each entry, build a BTreeMap, diff with the last. The thread loops back to back while writes keep coming. Folder scan time grows linearly with entries: 1,000 files 19 ms, 10,000 files 0.30-0.36 s, 50,000 files 3.0-3.4 s per poll (std-only copy of the scan on this Mac). A busy writer holds one core in that thread, and the page then reads the open file whole on each event batch unless it is a UTF-8 log followed by append (`followsTail`; a log in another encoding, or any non-log text, is read and decoded whole every time: 4.9 MB Latin-1 log decode 0.7 s on a quiet machine).
- Evidence: probe probes/SHL/scan_probe.rs, output probes/SHL/scan.out (a copy of the scan's work, not driven through the real watcher or a real writer); code reading for the loop. Folder size, not file size, so this may belong to a watching row.
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### MEA-02 · Opening a 4.9 MB plain text file keeps the window busy for 108 s; a line added to it on disk then freezes it for over 2 minutes (one 13.9 s task)
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (progressive mount of a full page), the live-reload path for a changed file (plain text, full page below the 5 MB lines line); packages/typeset
- Repro: plant `big-txt-4900k.txt` (`txt`, 4.9 MB, 13-word lines), open it; then plant it again with a line appended and emit a `modified` watch event (what another program saving the file does); headless Chromium on macOS
- Expected: reload in well under a second for an appended line, in step with the open
- Actual: open: first text 0.42 s, thread busy 107.7 s (task 106 s, longest task 7.9 s, 371k nodes). Reload after one appended line: task 134 s, 1,136 layouts, script 33 s, longest task 13.9 s, never quiet inside the 120 s cap. Find of "the": 10.8 s task, longest 3.7 s. Back from Source: 6.7 s task, longest 5.6 s. Cursor key 1.0 s of task, scroll to the middle 0.8 s.
- Evidence: probe probes/MEA/matrix.mjs, output probes/MEA/other.json (rows big-txt-4900k). The 1 MB text row did not run (page load timed out under shared load); not yet measured. Adds to todo row R13 for the open; the reload and find are new places.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### MEA-03 · Reloading a 1 MB pretty-printed JSON file after a change on disk takes over two minutes, and the first find in it takes 93 s of main-thread time
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (reload path), the JSON structure reading's find
- Repro: plant `big-json-pretty-1000k.json` (`json-pretty`), open it, plant it again with a line appended after the closing bracket and emit a `modified` event; later press `/`, type `the`, Enter; headless Chromium, macOS
- Expected: opening is about 3 s (it was: busy 3.1 s, task 1.9 s, 52k nodes); a reload and a find should cost about the same
- Actual: 1 MB: reload task 121 s (longest 1.0 s, never quiet in the 120 s cap); find task 93 s (longest 3.7 s). At 4.9 MB (a smaller tree, 52k nodes, the same open cost of 2.0 s) the reload takes 60 s and the find 1.0 s, so it is not the size of the text alone. The minified 1 MB file reloads in 0.6 s and finds in 0.2 s, so the pretty shape (many lines) is what costs.
- Evidence: probe probes/MEA/matrix.mjs, output probes/MEA/other.json (rows big-json-pretty-*). Re-run once to confirm the 93 s find, which may include reload work still running when the key was pressed (the step before it never went quiet).
- Confidence: medium
- Found by: catcher MEA, 2026-11-27

### MEA-04 · On a 1 MB Markdown prose file every cursor key and every scroll costs 0.19 s of main thread, and 0.6–0.8 s at 2 MB
- Severity: S3 slow
- Domain: measurement
- Where: apps/desktop/src/document/ (cursor move and scroll handlers on a page with many nodes)
- Repro: open `big-md-prose-<size>.md`; wait for the thread to go quiet; press `j`, or set the scroller's scrollTop
- Expected: a key or a scroll costs a few ms whatever the size (0.2 MB: 61 ms, 0.5 MB: 35 ms for a scroll)
- Actual: key task 0.5 MB 181 ms, 1 MB 185 ms (longest 111 ms), 2 MB 768 ms (longest 484 ms); scroll to the middle 0.5 MB 35 ms, 1 MB 190 ms, 2 MB 633 ms. Nodes: 47k, 88k, 176k. The 2 MB numbers were taken while the open's typesetting had not gone quiet (cap hit), so they may include it; 1 MB was quiet.
- Evidence: probes/MEA/md-prose.json
- Confidence: medium
- Found by: catcher MEA, 2026-11-27

### MEA-05 · Source and back, a small edit, undo and a reload each take 2–9 s of main thread on a Markdown prose file of 1–2 MB, doubling with the file
- Severity: S2 slow
- Domain: measurement
- Where: apps/desktop/src/document/ (mode switch, block commit, undo, reload; whole-page work per small change)
- Repro: open `big-md-prose-<size>.md`, quiet; toggle mode twice; edit a paragraph at 60% with a block editor and add " ZZ"; undo; plant the file with a line appended and emit `modified`; headless Chromium, macOS
- Expected: work in step with the change (a paragraph), not the page
- Actual: task ms at 0.5 MB / 1 MB / 2 MB: to Source 1,295 / 2,487 / 4,869; back to Read 366 / 801 / 1,509 (longest task 1.26 s at 2 MB); edit commit 1,650 / 3,055 / 5,872; undo 1,001 / 2,104 / 4,159; reload after one appended line 1,056 / 1,990 / 4,244; find "the" 835 / 1,713 / 3,332. Each is linear (2x per doubling) but costs seconds for a change of a few bytes: the work is proportional to the whole page, not the part changed.
- Evidence: probes/MEA/md-prose.json. Source toggling and reload are whole-page by design; the edit commit and undo (a one-paragraph change) are the surprise.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### EDT-06 · Format as code (Mod+E in Source) on a 0.8 MB single-paragraph selection with 130,000 backtick runs throws "Maximum call stack size exceeded"; 20,000 runs already take 0.4 s
- Severity: S3 wrong output (the command does nothing; the reader gets no refusal notice, only a console error)
- Domain: Source format ops
- Where: apps/desktop/src/source/format-ops.ts:261 (`Math.max(0, ...(body.match(/`+/g) ?? []).map(...))`)
- Repro: Source, a file with one paragraph (no blank line) of 130,000 inline code spans (about 0.8 MB, e.g. a generated reference list), select it all, apply Code
- Expected: the code wrap is made, or a refusal is said, in time linear in the selection
- Actual: node, `wrapSelection(text, {from: 0, to: text.length}, 'code')` on `'a `b` '.repeat(n)`: 20,000 runs 401 ms, 60,000 runs 866 ms, 130,000 runs RangeError after 557 ms, 300,000 runs RangeError after 1.4 s. Chromium argument limit (about 125,000); WebKit's may differ
- Evidence: probe probes/EDT/format-bench.mjs (output format-bench.out); code reading of line 261. Same pattern as EDT-03
- Confidence: high
- Found by: catcher EDT, 2026-11-27

### VWR-01 · A 220 KB HTML page of deeply nested elements keeps the window busy for about 6 s, growing faster than the file
- Severity: S2 super-linear
- Domain: viewers (HTML page in the sandbox)
- Where: apps/desktop/src/viewers/sandbox.ts:77-189 (srcdoc frame, `fit` run from a ResizeObserver on documentElement and body), apps/desktop/src/viewers/html-page.ts; the sanitiser itself is capped and linear (packages/core/src/sanitize/sanitize-html.ts:47, 276)
- Repro: plant an `.html` whose body is `<div>` repeated N times, `x`, then `</div>` N times; open it in Read. Probe probes/VWR/htmldeep.mjs, N = 2,500 / 5,000 / 10,000 / 20,000
- Expected: work grows with the file: a 220 KB page is drawn in well under a second, as the same page written flat is
- Actual: main-thread TaskDuration after open, nested: 0.30 s, 0.55 s, 1.42 s, 5.83 s for 27 KB, 55 KB, 110 KB, 220 KB (x2 size gives x1.8, x2.6, x4.1); at 20,000 the window answers a ping in 0.36-0.55 s nine times in a row. The same count written flat (`<div>x</div>` x N, 240 KB) costs 0.41 s. A 330 KB nested page (probes/VWR/deep.mjs) took 8.6 s to open and settle. `<ul>` nested 270 KB: 8.0 s
- Evidence: probe probes/VWR/htmldeep.mjs, output probes/VWR/htmldeep.out and deep.out (Chromium only, not tried on WebKit). The cost sits in layout and style of the nested document, not in the sanitiser (script time is small); which of the sandbox's `fit` reads, the iframe layout or the sanitised string is the cause was not isolated
- Confidence: medium
- Found by: catcher VWR, 2026-11-27

### RDR-03 · A technical Markdown page takes 6-14x longer to finish mounting at 2 MB than at 1 MB (1 MB: 2.6 s, 1.3 MB: 9.5 s, 1.6 MB: 11.4 s, 2 MB: 15.6 s or 38.6 s, 4.9 MB: not done in 60 s)
- Severity: S2 grows faster than the file
- Domain: read path, progressive mount / typesetting
- Where: apps/desktop/src/render/progressive.ts (slice and mount loop), packages/typeset/src/index.ts:1039-1060 (background batches wait on adoption quiet; layout cost grows with the article), apps/desktop/src/view/rendered-view.ts
- Repro: plant gen.mjs kind md-technical at 1.0, 1.3, 1.6, 2.0, 4.9 MB; `open(page, path)` and time until it resolves; same file, Chromium
- Expected: time to mount grows about linearly with size (1 MB 2.6 s, so 2 MB near 5 s, as md-prose does: 2.4 s and 5.1 s)
- Actual: 2.6 s, 9.5 s, 11.4 s, 15.6 s for 1 / 1.3 / 1.6 / 2 MB (probes/RDR/cliff.out); an earlier run of the same 2 MB file took 38.5 s and 38.6 s twice (probes/RDR/stall.out, stall2.raw) under load from other catchers; 4.9 MB had not resolved at the 60 s cap. Main-thread long tasks in those runs are small (max 0.2-0.4 s, 49-260 tasks), so the window answers in between but the page is busy for tens of seconds; the cliff sits between 1.0 and 1.3 MB
- Evidence: probes cited above, ratio 1 to 2 MB at least 6x. Cause not isolated (the first 1 MB run may take the whole-page route, larger sizes the progressive one). Overlaps hunt-02's "page busy after a big open" for the symptom; the new part is the size cliff on md-technical (md-prose, md-code-fences and md-references do not show it)
- Confidence: medium
- Found by: catcher RDR, 2026-11-27

### VWR-02 · Opening any JSON or YAML file past about 100 KB costs 1.5-2.5 s of main-thread time, however large (100 KB to 4.9 MB: the same)
- Severity: S3 slow open
- Domain: viewers (data tree for JSON and YAML)
- Where: the tree drawn for JSON/YAML (budget 5,000 values: packages/core/src/reading/tree.ts, tree-stream.ts; apps/desktop/src/view/tree-from.ts); not narrowed further
- Repro: open big-json-pretty or big-yaml from probes/gen.mjs at 20 KB, 100 KB, 500 KB, 1 MB, 4.9 MB; count TaskDuration for the 3 s after open
- Expected: a tree capped at 5,000 values draws in a few hundred ms and the cost does not depend on file size once the cap is hit (as CSV: 0.25-0.4 s at 0.5-4.9 MB)
- Actual: TaskDuration after open, JSON pretty: 20 KB 0.30 s; 100 KB 2.04 s; 300 KB 1.81 s; 500 KB 2.26 s; 1 MB 1.9-2.7 s; 4.9 MB 2.2 s. YAML: 20 KB 0.5 s; 100 KB 1.47 s; 500 KB 1.41 s; 1.4 MB 1.82 s; then 3-4.9 MB 3.5 s (plain colouring in pieces). ScriptDuration is only 0.2 s of it, so the time is not in the app's own script; the page holds 18,800-19,500 nodes. Worst single ping while it ran: 422 ms (1 MB JSON). The window stays answering, so this is a long busy open, not a freeze
- Evidence: probes/VWR/matrix.mjs, outputs probes/VWR/matrix.out, matrix2.out, matrix3.out (Chromium, 3 s after open; concurrent catchers shared the Mac, the 100 KB to 4.9 MB plateau repeated in three runs). Cause not isolated (style/layout of 19,000 nodes, or a wasm pass, are candidates)
- Confidence: medium
- Found by: catcher VWR, 2026-11-27

### RDR-04 · A dense Markdown page (many blocks per screen) takes 13 s to open at 1 MB and 62 s at 2 MB, with the first text after 12 s at 1 MB
- Severity: S1 freeze-like (first text 12 s at 1 MB; 4.7x time for 2x size)
- Domain: read path, progressive mount
- Where: apps/desktop/src/render/progressive.ts, packages/typeset/src/index.ts:1039-1060, apps/desktop/src/view/rendered-view.ts (not isolated)
- Repro: plant gen.mjs kind md-dense at 1 MB and 2 MB; open it; poll `#doc [data-marxy-s]` count and the time `open()` resolves
- Expected: first text in well under a second, finished mount near linear (md-prose: 2.4 s at 1 MB, 5.1 s at 2 MB)
- Actual: 1 MB: first block at 12.0 s, open resolved 13.2 s; 2 MB: open resolved 62.1 s. Ran while other catchers loaded the Mac, so absolute numbers are high; the 4.7x ratio and the late first text are the point
- Evidence: probes/RDR/cliff.mjs, output probes/RDR/cliff2.out (md-dense lines). Single run, not repeated; md-tables, md-headings and md-transcript not reached. Related to RDR-03 and hunt-02's page-busy-after-open; cause not isolated
- Confidence: low
- Found by: catcher RDR, 2026-11-27

### EDT-07 · Copy as (Markdown, Slack, HTML...) of a selected 1 MB in Source parses the whole selection on the main thread in one go: about 10 s at 1 MB, and the Slack target takes another 11 s
- Severity: S1 freeze (node, machine busy with another probe: parse 0.5 MB 3.5 s, 1 MB 9.9 s, 2 MB 14.4 s; rerun on a quiet machine to confirm the 5 s line)
- Domain: copy
- Where: packages/core/src/operations/copy-as.ts:139-160 (`copyAsFromText`: `parsed()` runs `parseMarkdown(bytes)` over the whole text, and `titleFor` calls it for the title at once); apps/desktop/src/commands/copy-as.ts:60-73 (`sourceInput` passes the store's parse only when nothing is selected: `parsed = from === to ? ... : undefined`); packages/core/src/operations/copy-as.ts:81 (Slack target)
- Repro: Source on a 1-2 MB Markdown file, Mod+A (or a 1 MB selection), then Copy as (the verb menu) in any target
- Expected: the copy is built from the selection's text without a freeze; a selection of the whole file reuses the store's parse as the no-selection case does
- Actual: node, `copyAsFromText(text, {path})` then each target's `build` on md-prose 1 MB: input (title, which parses) 11.8 s; markdown 0 ms, plain 47 ms, rich 1.7 s, html 1.9 s, slack 11.3 s, jira 164 ms, quote 43 ms. The page parses the same file in slices at open and never blocks; this path parses it synchronously with no yield. Only the 1 MB row finished before the probe was cut off; larger sizes were not measured
- Evidence: probes/EDT/copy-as.mjs and parse-1mb.mjs (parse-1mb.out); the 1 MB row is from the run's output, not saved in copy-as.out; code reading of `sourceInput`. Not driven through the real menu in the page
- Confidence: medium
- Found by: catcher EDT, 2026-11-27

### NAV-03 · End on a 2 MB page that is still mounting stops at 71% of the file, and again at 86%; the reading place it leaves is not the end
- Severity: S2 wrong result
- Domain: position, progressive mount
- Where: apps/desktop/src/position/ and the page's progressive mount (`apps/desktop/src/view/`); the End key goes to the end of the part of the article that is mounted, not of the document
- Repro: plant `md-prose` 2 MB (2,007,597 bytes), open it, wait 3 s, press End; read the block under the centre of the view (`data-marxy-s`); wait 6 s; press End again
- Expected: End goes to the last byte of the document (or says the page is still being drawn)
- Actual: first End: middle block at byte 1,434,313 (71%); 6 s later still 1,434,313; second End: 1,727,420 (86%); each press costs about 1.7 s of main thread. The article held 4,878 then 5,420 of 6,204 blocks. Switching to another tab and back keeps the place (1,727,420), so what is saved is the short place. The mount takes about 60 s at 2 MB, so for that time End needs pressing again and again
- Evidence: probes/NAV/place.mjs, output probes/NAV/place.out (Chromium). Related to the progressive mount of NAV-01; the wrong landing is navigation's
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### NAV-04 · Opening a second 2 MB Markdown file while another is mounting takes 30 to 38 s (1 MB: 3.2 s; 4.9 MB: over 60 s); switching back to a big tab costs 0.5, 1.0-1.3 and 1.3-3.5 s for 1, 2 and 4.9 MB
- Severity: S1 freeze
- Domain: tabs, warm store
- Where: apps/desktop/src/document/registry.ts (a warm store keeps bytes and tree, no view), the open path for a tab and the page mount that runs again on each switch
- Repro: plant `md-prose`, `md-technical` and `md-transcript` at the same size; open them in that order with 6 s between; then switch among the tabs with `window.marxy.handle.open(path)`; then open the last one beside itself (split)
- Expected: a tab kept warm comes back at once; a second open costs about the first
- Actual: open of file 2/3 at 1 MB: 3.2 s / 3.3 s; at 2 MB: 30.6 s / 37.6 s (task time, 5.4 s script, 1016-1232 layouts); at 4.9 MB: both stalled past 60 s. Switch to an already opened file: 1 MB 0.51-0.56 s; 2 MB 0.91-1.34 s; 4.9 MB 1.34-3.49 s (the warm store saves the parse, not the page: the page is made again). Split of the same file beside itself: 1 MB 4.6 s, 2 MB 5.7 s, 4.9 MB 14.9 s task time. 1 to 2 MB is a 10x jump for opens of file 2 and 3 (technical, transcript shapes), so it is not linear
- Evidence: probes/NAV/tabs.mjs; outputs probes/NAV/tabs-1mb.out, tabs.out (2 MB), tabs-4.9mb.out (Chromium). Part of the open cost may be the first file's mount still running (hunt-02 "page busy after a big open"); not separated here
- Confidence: medium
- Found by: catcher NAV, 2026-11-27

### MEA-06 · A 4.9 MB diff takes 9.9 s to settle after opening (1 MB: 1.5 s), and a 4.9 MB HTML file takes 5.3 s to reload and 2.9 s to come back from Source
- Severity: S2 slow
- Domain: measurement
- Where: the diff and HTML readings (open and reload); apps/desktop/src/viewers/ and packages/core/src/reading/ for the diff and HTML kinds
- Repro: plant `big-diff-<size>.diff` or `big-html-<size>.html` (probes/gen.mjs `diff`, `html`), open, then follow the matrix steps (reload = a line appended on disk, `modified` event); headless Chromium, macOS
- Expected: cost in step with the file, a few seconds at most for 5 MB
- Actual: diff open (busy until idle / task): 1 MB 1.45 s / 0.2 s, 4.9 MB 9.85 s / 8.5 s (6.8x of wall and 41x of task for 4.9x the bytes; nodes stay 5.8k, so the work is not drawn). Diff scroll to the end 4.9 MB: 519 ms. HTML 1 MB / 4.9 MB: open busy 2.7 s / 4.4 s (95k / 230k nodes); reload task 0.63 s / 5.3 s (longest task 2.7 s); back from Source 0.22 s / 2.9 s (longest 0.8 s); to Source 0.49 s / 0.57 s.
- Evidence: probes/MEA/other.json (rows big-diff-*, big-html-*). Diff open ratio per 4.9x is far above 4.9x in task time; a middle size (2 MB) was not run to show the shape of the curve.
- Confidence: medium
- Found by: catcher MEA, 2026-11-27

### MEA-07 · Leaving Source for a 1 MB pretty-printed JSON file takes 1.9 s with one 1.8 s task, and a 4.9 MB plain text file 6.7 s
- Severity: S2 slow
- Domain: measurement
- Where: the return from Source to Read (`toggleMode`) for the JSON structure reading and the plain-text page
- Repro: open `big-json-pretty-1000k.json` or `big-txt-4900k.txt`, quiet; `handle.toggleMode()` to Source and again back
- Expected: back in Read as soon as the page is the same bytes (nothing was edited)
- Actual: JSON pretty 1 MB: back 1,894 ms of task, longest task 1,789 ms, layout 4.9 MB: 1,518 ms (longest 1,448 ms); minified JSON 1 MB: 902 ms (longest 830 ms). Plain text 4.9 MB: back 6,719 ms, longest task 5,576 ms, layout 3.0 s; to Source 2.6 s. The JSON file is 52k nodes whatever the size, so the cost is the tree being drawn again, not the bytes. Markdown prose 2 MB: 1.5 s (longest 1.26 s).
- Evidence: probes/MEA/other.json, md-prose.json
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### NAV-05 · Find on a fully mounted page: every keystroke in the field costs 0.5 s at 1 to 1.5 MB (0.12 s at 0.5 MB) and Next/Previous 0.15-0.27 s (0.02 s at 0.5 MB); the cost has a step between 0.5 and 1 MB, not a slope
- Severity: S3 slow key
- Domain: find, Spine
- Where: apps/desktop/src/find/view.ts (rematch on the typed query; window of Ranges rebuilt as the current match moves), apps/desktop/src/frame/spine.ts:289-310 (`checkFind` walks the whole article again, `walkText` + `findAll`, 150 ms after any `input` or `keyup` in the document)
- Repro: plant `md-prose` at 0.5, 1 and 1.5 MB; wait until the article stops growing (about 12-15 s); Mod+F; type `the ` (8,112 / 16,226 / 24,336 matches); Enter three times; Shift+Enter; Backspace
- Expected: a letter typed into find answers in under 200 ms at any page size the app mounts in full; Next in about 20 ms
- Actual: main-thread task per key (Performance.getMetrics): 0.5 MB 99-130 ms; 1 MB 409-587 ms (script 104-169 ms, 13-26 layouts); 1.5 MB 395-497 ms. Enter: 16-22 ms at 0.5 MB, 159-273 ms at 1 MB, 130-186 ms at 1.5 MB. So 0.5 to 1 MB (2x) costs 4.3x, then flat. While the page is still mounting at 2 and 4.9 MB, a key costs 0.5-0.7 s (find.out); Esc 0.17-0.32 s
- Evidence: probes/NAV/find.mjs, output probes/NAV/find-mounted.out (Chromium); the Spine's second walk is from code reading, not separated from find's own cost in the numbers. Not isolated to a cause
- Confidence: medium
- Found by: catcher NAV, 2026-11-27

### MEA-08 · Opening a 0.5 MB technical Markdown file keeps the window busy for 83 s; a 1 MB transcript has not finished opening after 120 s
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (progressive mount) and packages/typeset; shapes with many inline spans, code and lists cost several times the prose shape
- Repro: plant `big-md-technical-500k.md` (`md-technical`), `big-md-transcript-<size>.md` (`md-transcript`) from probes/gen.mjs, `handle.open(path)`, wait for the thread to go quiet; headless Chromium, macOS
- Expected: prose and the other shapes cost about the same per byte; a half-megabyte file settles in seconds
- Actual: 0.5 MB, busy until idle: prose 14.8 s, transcript 34.8 s (task 27.9 s), technical 82.9 s (task 76.2 s, 53.9k nodes, longest task 0.86 s). 1 MB transcript: `handle.open` returned but `contentComplete()` did not resolve in 120 s (prose 1 MB: 62 s). Meanwhile at 0.5 MB technical: scroll to the middle 0.42 s (one 0.41 s task), scroll to the end 0.75 s (0.74 s task), to Source 2.6 s, back 2.1 s, edit commit 3.2 s.
- Evidence: probes/MEA/md-shapes.json, probe probes/MEA/matrix.mjs. Adds to todo row R13 (the same cost, now by shape: R13 names a 1 MB Markdown file; technical text costs about 5.6x prose per byte).
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### MEA-09 · Plain text grows about 5x faster than its size: 1 MB opens in 4.4 s and reloads in 5.8 s, 4.9 MB takes 108 s and 134 s
- Severity: S2 slow
- Domain: measurement
- Where: apps/desktop/src/document/open.ts and the plain-text page's typesetting and reload path (the same code as MEA-02)
- Repro: plant `txt` at 1,000,000 and 4,900,000 bytes (13-word lines), open, append a line on disk, emit `modified`
- Expected: roughly 5x the time for 4.9x the bytes
- Actual: open busy 4.4 s (task 3.2 s, 77k nodes) vs 107.7 s (task 106 s, 371k nodes): 24x for 4.9x the bytes. Reload task 5.8 s vs 134 s: 23x. Find of "the" 1.4 s vs 10.8 s (7.7x). Back from Source 0.7 s vs 6.7 s (9.4x). Cursor key 120 ms vs 1,011 ms (8.4x). Only the scroll steps stay small. Text of 5.1 MB (5,100,000 bytes) is still a full page: open 84 s, 386k nodes, reload 121 s (see MEA-10).
- Evidence: probes/MEA/txt1.json and other.json (rows big-txt-*); doubling steps in probes/MEA/matrix.md. Supersedes MEA-02 only in showing the growth; MEA-02 stays as the 4.9 MB freeze.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### RDR-05 · Tables, headings and transcript pages take 6-8x longer to finish mounting at 2 MB than at 1 MB
- Severity: S2 grows faster than the file
- Domain: read path, progressive mount
- Where: apps/desktop/src/render/progressive.ts, packages/typeset/src/index.ts:1039-1060 (not isolated)
- Repro: plant gen.mjs kinds md-tables, md-headings, md-transcript at 1 MB and 2 MB; open; time until `open()` resolves
- Expected: about twice the 1 MB time
- Actual: md-tables 4.4 s to 25.1 s, md-headings 2.9 s to 22.0 s, md-transcript 2.6 s to 24.1 s (1 MB to 2 MB). Same cliff as RDR-03 and RDR-04 on three more kinds
- Evidence: probes/RDR/cliff.mjs, probes/RDR/cliff2.out, one run each, while other catchers loaded the Mac; the ratio is the point. Adds to RDR-03 and to hunt-02's page-busy-after-open
- Confidence: medium
- Found by: catcher RDR, 2026-11-27

### EDT-08 · Copy as of a selected 2-4.9 MB in Source: the parse runs 19-78 s and the Slack target 14-45 s (Supersedes EDT-07's missing rows)
- Severity: S1 freeze (node, machine shared: md-prose input 1 MB 11.8 s, 2 MB 18.9 s, 4.9 MB 78 s)
- Domain: copy
- Where: packages/core/src/operations/copy-as.ts:139-160, :81; apps/desktop/src/commands/copy-as.ts:60-73 (as EDT-07)
- Repro: as EDT-07, on a 2 MB and a 4.9 MB Markdown file
- Expected: no freeze; a whole-file selection reuses the store's parse
- Actual: md-prose: rich 1.7 s / 2.5 s / 9.2 s and html 1.9 s / 2.8 s / 8.0 s at 1 / 2 / 4.9 MB; slack 11.3 s / 35.8 s / 44.3 s; md-technical: input 14.7 s / 12.8 s / 25.6 s, slack 12.5 s / 18.2 s / 14.3 s, rich 3.2 s / 4.2 s / 3.8 s. Plain, jira, quote and markdown are under 1 s
- Evidence: probes/EDT/copy-as.mjs, output copy-as.out. Adds to EDT-07
- Confidence: medium
- Found by: catcher EDT, 2026-11-27

### NAV-06 · The Line's `@` on a Markdown file read as Lines (5.4 MB) parses the whole file on the main thread: 5.5 s at 5.4 MB, 12.6 s at 10.8 MB, with the window dead meanwhile
- Severity: S1 freeze
- Domain: line (`@` scope), Lines reading
- Where: apps/desktop/src/line/scopes-rows.ts:81 (`store.snapshot().ast` in `outlineRows`: reading the tree makes the store parse the file whole), against docs/file-kinds.md:225 (Markdown from 5 MB opens as Lines "not as its page: the page is the parse of the whole file") and the Lines row's "Markdown's headings listed from a scan"
- Repro: plant `md-prose` 5.4 MB (anything over 5,242,880 bytes; a 5.1 MB decimal file is still a page), open it (opens in 0.2 s task time), Ctrl+K, type `@`
- Expected: `@` lists the scanned headings (the Outline panel does, and opens in 0.4 s), or says it needs a moment, in slices
- Actual: `@`: 5,506 ms task (5,390 ms script) at 5.4 MB, 12,559 ms (12,337 ms script) at 10.8 MB; a CPU profile of `@` (probes/NAV/prof.out) is `mdast-util-from-markdown` (`go`, `consume`, `main`, `subtokenize`) plus 0.56 s of garbage collection, none of it the Line's own code. The next keys cost 0.03 to 0.1 s (the tree is kept). The Outline panel on the same files: 0.39-0.46 s. Needs a Markdown file over 5 MiB: a log or code file takes the other branch
- Evidence: probes/NAV/linesat.mjs, output probes/NAV/linesat.out; profile probes/NAV/prof.mjs / prof.out (Chromium). Same probe on `md-headings` 5.4 and 10.8 MB (65,674 and 130,837 headings): `@` 17 s and over 30 s, the next key 16.9 s and over 30 s (the unbounded rows of NAV-02, on top of the parse; the scan's 20,000 cap does not apply to the Line)
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### MEA-10 · A Markdown file with footnotes and reference links takes 18 s to settle at 0.5 MB and over 123 s at 1 MB (6.8x per doubling); dense Markdown at 0.5 MB does not finish opening in 120 s
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (progressive mount for a file that holds definitions, parsed whole), packages/core Markdown parse and the typeset passes after it
- Repro: plant `md-references` and `md-dense` from probes/gen.mjs at 0.5 and 1 MB, `handle.open`, wait until quiet; headless Chromium, macOS
- Expected: no worse than prose (0.5 MB 14.8 s, 1 MB 62 s, which is already R13)
- Actual: references 0.5 MB: first text 0.83 s, busy 18.2 s (task 16.7 s, 50k nodes); 1 MB: first text 1.7 s, busy 123 s and not quiet at the 120 s cap (task 121 s, 82k nodes): at least 6.8x per doubling, against 4.2x for prose. Afterwards at 1 MB: to Source 3.2 s (longest 1.6 s), edit commit 6.6 s, undo 4.9 s, reload 5.8 s (longest 1.8 s), find 3.0 s, cursor key 480 ms. Dense 0.5 MB and 1 MB: `contentComplete()` did not resolve within 120 s.
- Evidence: probes/MEA/md-shapes.json (rows big-md-references-*, big-md-dense-*); probe probes/MEA/matrix.mjs. Adds to todo row R13.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### MEA-11 · A plain text file just under the lines line takes 84-108 s to open, and one 200 KB larger opens in 1 s; the code's line is 5 MiB while the docs and the hunt say 5 MB
- Severity: S1 freeze
- Domain: measurement
- Where: packages/core/src/reading/lines.ts:16 (`LINES_FROM = 5 * 1024 * 1024`), docs/file-kinds.md "Size limits" (Lines row: "from 5 MB")
- Repro: plant `txt` at 4,900,000, 5,100,000 and 5,300,000 bytes (and `log` likewise); open each, then append a line on disk and reload; headless Chromium, macOS
- Expected: a full page only where it is usable, and the doc and the code naming the same line
- Actual: txt 4.9 MB: busy 108 s, 371k nodes. txt 5.1 MB (5,100,000 bytes, still below 5,242,880, so still a full page): busy 84 s, longest task 5.3 s, 386k nodes, reload 121 s, find 10 s. txt 5.3 MB (lines reading): first text 0.09 s, busy 1.0 s, 3.2k nodes, cursor key 4 ms, reload 0.21 s, find 0.19 s. The log kind is fast at both (5.1 MB log: busy 2.4 s, 8k nodes; 5.3 MB 1.0 s), so only the text and Markdown full pages suffer. The line also reads as 5 MB in the docs: a 5.1 MB file lands on the slow side.
- Evidence: probes/MEA/lines.json, lines53.json, other.json; lines.ts:16. The lines reading is 100x cheaper at this size, so a lower line for the full page (about 1 MB for text where 1 MB already costs 4.4 s) is the lever.
- Confidence: high
- Found by: catcher MEA, 2026-11-27

### MEA-12 · Opening Markdown with a heading every few lines does not finish in 120 s at 0.5 MB, and a 1 MB table-heavy file leaves 340k nodes and a 2.9 s find
- Severity: S1 freeze
- Domain: measurement
- Where: apps/desktop/src/document/open.ts (progressive mount), the heading and outline work after a mount; the table page's per-cell nodes
- Repro: plant `md-headings` (a heading of level 1 to 4 and a short paragraph per 150 bytes) at 0.5 and 1 MB, `handle.open`, wait for `contentComplete()`; `md-tables` (20-row tables) for the table numbers
- Expected: a few seconds, as for 25 KB of the same shape
- Actual: headings 0.5 MB and 1 MB: `contentComplete()` did not resolve in 120 s (prose reaches it in 1-2 s and is quiet in 15-62 s). Tables: 0.5 MB busy 4.7 s with 172k nodes; 1 MB busy 11.2 s (task 10.1 s, longest 2.3 s), 339k nodes; scroll to the middle 0.35 s (one 0.35 s task), find 2.9 s (longest 1.4 s), to Source 2.1 s, back 1.9 s; edit by paragraph not possible (all blocks are tables). Code fences stay linear and cheap (1 MB: busy 2.1 s, 9.7k nodes, reload 0.5 s).
- Evidence: probes/MEA/md-shapes.json
- Confidence: high
- Found by: catcher MEA, 2026-11-27
