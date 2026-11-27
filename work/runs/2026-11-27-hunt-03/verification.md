# Hunt 03 verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### SHL-01 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/enc.verify.rs (output enc.verify.out), the unmodified encoding module, Shift_JIS pure CJK, chosen "shift_jis". The table is 4 bytes per file byte (1 MB 4.0 MB, 2 MB 8.0 MB, 4 MB 16.0 MB) and the text 1.5x, so a 4.9 MB file sends a frame of about 27 MB. Decode CPU time: 1 MB 0.071 s, 2 MB 0.13-0.14 s, 4 MB 0.26-0.27 s (x1.85-2.0 per doubling, linear). The catcher's 3.4 s was wall time on a loaded Mac; the cost in CPU is about a tenth of that. The cause (byte-at-a-time `decode_mapped`, a pair per CJK character) is in the code at mod.rs:449-476.
- Severity: S3 (was S2): CPU about 0.3 s per 4 MB and linear; the memory (4x the file as table, 27 MB frame, plus the JS loop) is the real cost, and only for multi-byte encodings in multi-MB files. Not driven in the real window, and not measured on the JS side.
- Fix hint: record a pair only when the offset changes by more than the per-character norm (run-length of constant two-byte characters), or build the table lazily per visible range; test: decode 4 MB Shift_JIS and assert the table length is far below file length.
- Checked by: verifier SHL, 2026-11-27

### SHL-02 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/enc.verify.rs (output enc.verify.out): `sniff` returns utf-8 / How::Utf8 and `looks_like_utf8` is true for all three natural Japanese samples at 66 B, 3.3 KB and 198 KB, for two GBK samples at 34-3600 B, and also for a control with no の ("漢字仮名交じり文を読む。" x50). So it happens at any size and to ordinary text, and chardetng is never consulted. Latin-1 and cp1251 text are guessed correctly (same file), so it is specific to two-byte encodings whose byte pairs read as UTF-8 sequences. No doc says this is intended (docs/file-kinds.md:99 promises a guess); tests.rs:215-230 only covers Latin-1 vs UTF-8.
- Severity: S2 (agrees); the reader can still choose the encoding by hand.
- Fix hint: in `looks_like_utf8` require well-formed UTF-8 to be a clear majority of the non-ASCII bytes (or that no invalid byte is followed by a non-ASCII prefix pattern), or run chardetng and trust it when it names a CJK encoding and the UTF-8 share is low; a test: encode Japanese and GBK sentences with encoding_rs and assert `decode(bytes, None).found.label`.
- Checked by: verifier SHL, 2026-11-27

### SHL-03 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/save.verify.rs (output save.verify.out), the real atomic_write.rs, 3 runs per size, with and without the expectation, CPU time. With expectation vs without: 10 MB 0.07 s vs 0.006-0.009 s, 20 MB 0.14-0.15 s vs 0.01 s, 40 MB 0.29-0.30 s vs 0.03 s: linear (x2.0 per doubling), about 7.5 ms CPU per MB and no aarch64 SHA path (atomic_write.rs:359-368, 436, 488). Wall times were 0.5-3.5 s at 40 MB, but those are load and disk waits; the catcher's 4 s and 10 s are mostly that, so the real CPU cost at 40 MB is about 0.3 s, and 80 MB about 0.6 s.
- Severity: S3 (was S2): about 0.3 s of CPU on a thread off the UI at 40 MB; only extreme sizes (256 MB about 2 s) get noticeable.
- Fix hint: add the aarch64 SHA2 instructions behind `is_aarch64_feature_detected!("sha2")` beside the x86 path, keeping the std-only constraint; the existing test sha256_on_the_cpus_instructions_matches_the_portable_rounds already shape the check.
- Checked by: verifier SHL, 2026-11-27

### SHL-04 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/enc.verify.rs (output enc.verify.out). `readings` on Shift_JIS: CPU 1 MB 0.058 s, 2 MB 0.123 s, 4 MB 0.23 s (x2 per doubling; wall 0.7-2.2 s under load); Latin-1 0.106/0.147/0.185 s; cp1251 0.13/0.19/0.31 s. The chardetng guess in `sniff` costs about 0.08-0.09 s CPU, flat from 1 to 4 MB (not 0.8 s; that was wall). The catcher's "Shift_JIS pays 0.8 s on every open" does not happen: Shift_JIS never reaches chardetng (see SHL-02), only files like Latin-1 or Cyrillic do. Cause (13 candidates in `readings`, 1 MB fed to chardetng) is in the code.
- Severity: S3 (was S2): 0.1-0.3 s CPU per panel open at 4 MB, bounded by COUNT_BYTES (8 MB) and 1 MB guess; the only super-linear item is none, growth is linear.
- Fix hint: cap `readings` at a sample of the first few hundred KB, or compute the rows lazily; low priority.
- Checked by: verifier SHL, 2026-11-27

### SHL-05 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/scan.verify.rs (output scan.verify.out): the same per-entry work as watch::scan on unix (read_dir, `entry.metadata` which is fstatat, BTreeMap, diff), 3 runs per size, CPU time: 1,000 files 0.006 s, 10,000 files 0.072-0.079 s, 50,000 files 0.45-0.47 s (x12-13 per x10; linear). The catcher's 0.3 s and 3 s were wall under load, about 4-7 times the CPU. The loop in spawn_notify.rs:31-48 has no minimum gap, so a writer that never pauses keeps the thread scanning back to back (a core at 100% on a 10,000-file folder). Not driven through the real watcher or a real writer. Related, not the same as todo S10 (symlink and SMB poll).
- Severity: S3 (agrees): steady CPU only while a writer is active in a very large folder.
- Fix hint: in `flat_loop`, after a poll sleep until a minimum gap (for example 10 times the poll's own duration, at least 100 ms) before the next, folding signals meanwhile; a test counts polls under a 1 s burst of signals.
- Checked by: verifier SHL, 2026-11-27

### EDT-07 verdict
- Verdict: CONFIRMED
- Proof: cause is in the code (copyAsFromText parses eagerly for the title; sourceInput passes no parse for a selection). Driven through the real menu (Mod+A, Mod+Shift+C, Enter) in probes/EDT/copy-as-menu.verify.mjs: main-thread task 359 ms at 250 KB, 546 ms at 500 KB, 1322 ms at 1 MB (about 2x per doubling, linear). Node CPU time (probes/EDT/copy-as-cpu.verify.mjs): parse 0.53 s / 0.93 s / 1.63 s at 0.5 / 1 / 2 MB; Slack build 0.51 / 0.76 / 1.72 s. The catcher's 10 s was load (wall 5 s vs CPU 0.9 s). Slack adds a second parse-sized cost.
- Severity: S3 slow (was S1 freeze; 1-3 s block at 1-2 MB, linear, no hang)
- Fix hint: pass the store's parse when the selection is the whole file, and make the title lazy or take it from the first heading line; a Slack target should reuse `parsed()`.
- Checked by: verifier EDT-a, 2026-11-27

### EDT-01 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/splice-stray.verify.mjs, thread CPU time per one-byte splice, valid vs one 0xE9 byte: 1 MB 6 vs 49 ms, 2 MB 12 vs 102 ms, 4 MB 25 vs 198 ms (linear, about 8x dearer with the stray byte). The catcher's 0.9-4.8 s were wall time on a load of 40-70; CPU is about 20x lower.
- Severity: S3 slow (was S2; 0.2 s per edit at 4 MB)
- Fix hint: in `splice`, patch the offset table around the range instead of calling `makeBuffer`; or cache the decode.
- Checked by: verifier EDT-a, 2026-11-27

### EDT-03 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/paste-html.verify.mjs in Chromium: 130,000 `<p>` in a div (1.0 MB) and 130,000 table rows (3.8 MB) throw RangeError (32,000 and 64,000 work); nested divs 2,000/4,000/8,000/16,000 take 27/97/377/1555 ms (about 4x per doubling, n squared). Callers (paste/read-clipboard.ts:18) do not catch it, so the paste fails. Output in paste-html.verify.out.
- Severity: S3 wrong output (was S2; needs 130,000 sibling blocks, a rare paste; the nested case needs thousands of levels)
- Fix hint: replace `out.push(...x)` with a loop and `Math.max(...)` with a reduce; make `containsBlock` use a cached or early-exit check; test: htmlToMarkdown on 130,000 `<p>` in a div.
- Checked by: verifier EDT-a, 2026-11-27

### EDT-02 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/splice-cpu.verify.mjs and splice-na.verify.mjs (outputs .verify.out, load 25-27): the O(n) path in `makeBuffer` is real, one-byte splice thread CPU median ASCII 5.9 / 12.0 / 29.7 ms at 1 / 2 / 4.9 MB (md-prose; txt the same), with one non-ASCII character 12 / 24 / 59 ms. Exactly 2x per doubling, so linear, not super-linear. The catcher's 270-980 ms at 4.9 MB is load-inflated wall time; CPU is 10x smaller.
- Severity: S4 (was S3): 30-60 ms CPU per edit at 4.9 MB, 6-12 ms at 1-2 MB
- Fix hint: `makeBuffer` could keep `text`/offsets lazy or patch them from the previous buffer; a unit test comparing splice cost at 1 and 8 MB would show the growth.
- Checked by: verifier EDT-b, 2026-11-27

### EDT-04 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/copy-all.verify.mjs (output copy-all.verify.out, load 38): select-all copy in the page, md-prose, three runs each, wall ms for `cloneRangeInert` alone / text / html: 0.5 MB 243-272 / 260 / 265-299; 1 MB 916-956 / 951-973 / 1017-1047; 2 MB 2018-2227 / 2054-2293 / 2133-2203 (nodes 9.9k, 14k, 15.7k; chars 0.48M, 0.96M, 1.41M). Growth per doubling of file 3.7x then 2.2x (chars 2x then 1.5x), so super-linear in text. The clone step is the whole cost (text and html are each about equal to it). Drawn part only: copy holds 1.41 M chars of a 2 MB file, as the catcher says. Wall time under load is an upper bound; the 4 MB file did not open within the 10 s race.
- Severity: S2 (agrees on wall figures; rests on wall time only, so could be lower)
- Fix hint: `cloneRangeInert` in copy-text.ts: skip `intersectsNode` for children wholly between start and end children; a test in copy-all comparing 1 MB vs 2 MB.
- Checked by: verifier EDT-b, 2026-11-27

### EDT-05 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/leave.verify.mjs (output leave.verify.out, load 38), md-prose, 4 leave cycles per size after typing one `y`, wall from Mod+E to mode change: 1 MB 598-664 ms, 2 MB 649-788 ms, 4.9 MB 632-918 ms. The slowness is real (0.6-0.9 s every leave) but it is nearly flat from 1 to 4.9 MB, so it does not grow with file size, and node thread CPU for the splice named as cause is only 30-60 ms at 4.9 MB (see EDT-02 verdict). The cost the catcher blames (foldText plus splice) is therefore a minor part; most is elsewhere after the change (page reset or re-render). TaskDuration deltas were unusable (exceeded wall, background mount tasks counted).
- Severity: S3 (agrees; at most 0.9 s wall under load)
- Fix hint: profile `leaveSourceMode` end to end (CDP profiler) before fixing the splice; the test is a browser test timing the leave at 1 MB.
- Checked by: verifier EDT-b, 2026-11-27

### EDT-06 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/splice-cpu.verify.mjs (output splice-cpu.verify.out): `wrapSelection(..., 'code')` on `'a `b` '.repeat(n)` is fine to 40,000 runs (22 ms CPU) and throws RangeError "Maximum call stack size exceeded" at 80,000 and above (node; 130,000 too), so the spread in format-ops.ts:261 fails earlier than the catcher's 130,000. The 20,000-run 0.4 s claim is load-inflated: 13 ms CPU. Cost is linear.
- Severity: S4 (was S3): needs a single paragraph of 80,000+ code spans selected whole; real files hardly have one
- Fix hint: replace the `Math.max(0, ...map)` with a loop over `body.matchAll(/`+/g)`; test with 100,000 runs.
- Checked by: verifier EDT-b, 2026-11-27

### RDR-02 verdict
- Verdict: BY-DESIGN
- Proof: docs/architecture.md:53 says "A file that may hold a definition is not parsed in slices." Behaviour reproduced anyway: probes/RDR/a.verify.mjs (a.verify.out, load avg 25-36), md-references 1 MB: first block 1.4 s with one 1.4 s long task; 2 MB: one 2.3 s long task (in-page parse 1.1 s / 2.4 s with a Uint8Array, linear). Cause is as named (chunked.ts:63).
- Severity: S2 (was S1; linear, 2 MB 2.3 s, 4.9 MB not re-run; design limit stated in docs but cost not in file-kinds limits)
- Fix hint: cheap definition-index pre-pass so slices can use it; test: open md-references 2 MB, assert no task over 0.3 s.
- Checked by: verifier RDR, 2026-11-27

### RDR-01 verdict
- Verdict: BY-DESIGN
- Proof: docs/architecture.md:51-53 says an edit that adds, removes or changes a definition parses the whole file. Partly narrower than claimed: a.verify.out shows a definition edit that did not break a referenced label took kind region (parsed 150 KB of 1 MB, 263 ms; 2 MB 582 ms); body edits 9-10 ms. The catcher's whole parse came from renaming the first definition's label (referenced by body text), 1.3 s at 1 MB (in-page, Uint8Array, probes/RDR/inpage.out).
- Severity: S3 (was S1; only label renames or adds/removes take the whole path, linear)
- Fix hint: reparse only blocks naming the label; test in packages/core reparse tests with a 2 MB references file.
- Checked by: verifier RDR, 2026-11-27

### RDR-04 verdict
- Verdict: CONFIRMED
- Proof: probes/RDR/a.verify.mjs, a.verify.out and b.verify.out (load 25-36; CDP TaskDuration, main-thread CPU): md-dense 0.5 MB first block 4.4 s, CPU 8.9 s; 1 MB first block 12.1 s and 14.1 s (two runs), one long task 11.9-13.9 s, CPU 16.3-18.5 s; 2 MB resolved 67 s, CPU 70 s, 77 long tasks, max 24.5 s. Per doubling CPU x2.1 then x3.8; node count 266k, 481k, 920k (page not windowed for dense, ~1 node per 2 bytes). 2 MB first-block time not compared.
- Severity: S1 (agrees; a single 12-14 s task before first text, CPU-backed not just wall)
- Fix hint: slice the first mount for dense pages by node budget, not bytes; test: open md-dense 1 MB, assert first text under 1 s and no task over 0.5 s.
- Checked by: verifier RDR, 2026-11-27

### RDR-03 verdict
- Verdict: CONFIRMED
- Proof: probes/RDR/a.verify.mjs, a.verify.out and b.verify.out (load 25-36): md-technical 1 MB resolved 2.8 s, CPU 6.0 s; 1.3 MB 3.1 s, CPU 6.1 s; 2 MB 22.7 s and 17.4 s (two runs), CPU 25.6 and 20.5 s, so about x3.4-4.3 CPU for x2 size. Growth is in style recalc (2.1 s to 9-10.8 s) with nodes 88k to 167k, script 0.6 to 2.4-3.0 s. Main-thread long tasks small (max 74 ms). The catcher's 1.3 MB 9.5 s was not reproduced (3.1 s); the cliff is nearer 1.3-2 MB.
- Severity: S2 (agrees)
- Fix hint: style recalc over the growing article after each batch; check what a batch invalidates; test: open md-technical 2 MB and bound CPU TaskDuration to under 2.5x the 1 MB figure.
- Checked by: verifier RDR, 2026-11-27

### VWR-01 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/v.verify.mjs, output v.verify.out (Chromium, load average about 40, so wall times are upper bounds; the figures are main-thread CPU, ThreadTime, 2 runs each). Nested divs: 55 KB 0.63 s, 110 KB 1.78 s, 220 KB 6.2 s, so 2.9x then 3.5x per doubling (over 2.5x is super-linear); open() resolved in 0.5 s, 1.1 s, 3.5 s. Runs agree within 5%. Script time is 0.03 s and the app's own layout and style under 0.5 s, so the cost is outside the app's script. The catcher's flat control (240 KB, 0.41 s) stands in htmldeep.out. Not a duplicate: no todo row covers it (EDT-03 is the paste path), and no doc says deep nesting is meant.
- Severity: S2 (agrees; window answers between tasks, 6 s of CPU for a 220 KB file; hostile or generated pages only)
- Fix hint: start in sandbox.ts (srcdoc, `fit` layout reads) and the sanitiser's depth handling; try a nesting depth cap or flattening past a limit. Test: open a 20,000-deep page and assert the thread time stays under a budget. Cause not isolated: a bare iframe with the same markup would tell whether Chromium's own deep-tree cost is the whole of it.
- Checked by: verifier VWR, 2026-11-27

### VWR-02 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/v.verify.mjs, output v.verify.out (ThreadTime CPU, 2 runs each, load average about 40). JSON pretty: 20 KB 0.33 s (5.3k nodes), 100 KB 2.3-2.5 s, 1 MB 2.3-2.6 s (19,511 nodes both). YAML: 20 KB 0.5 s, 100 KB 1.85 s, 1 MB 2.05 s (18,854 nodes). CSV control: 0.17, 0.63, 0.25-0.31 s. The plateau holds from 100 KB to 1 MB (the cap works), but the capped tree is about 19,500 nodes and RecalcStyleDuration is 1.1-1.5 s of it; script is 0.2 s and layout 0.1-0.3 s. So the cause is style recalculation of the tree, not the parse. 3.7x the nodes costs 7x the time from 20 KB to 100 KB. Not a duplicate (MEA-07 is the Source exit, a different path).
- Severity: S3 (agrees; fixed 2 s of CPU per open, window stays answering)
- Fix hint: start at apps/desktop/src/view/tree-from.ts; draw fewer nodes up front (the 5,000-value cap yields about 3.9 nodes per value), or lighten the selectors that style tree rows. Test: open a 1 MB JSON and assert style recalculation stays under a budget.
- Checked by: verifier VWR, 2026-11-27

### NAV-02 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/line-at.verify.mjs (output line-at.verify.out, Chromium, load average about 37, uptime recorded). `outlineRows` (scopes-rows.ts:84-104) has no cap and the DOM holds one option per heading: 12,272 / 24,409 / 48,682 options at 1 / 2 / 4 MB. Task time for `@` 1.4 / 2.3 / 4.2 s, for the next key `e` 2.0 / 3.8 / 8.5 s (script only 0.3 / 0.7 / 1.8 s, the rest layout and style over 0.27 / 0.54 / 1.08 M nodes). Growth per doubling about 1.9x to 2.2x: linear in headings, not super-linear
- Severity: S1 (agrees; wall/task time under load is an upper bound, but the 1 M-node DOM at 4 MB is load-independent; needs a heading-dense file, 12k+ headings per MB)
- Fix hint: cap `outlineRows` (for example 200 to 400 rows, as `/` and the parts branch do) and say how many more match; test: open a 24k-heading file, type `@`, count rows and time a key
- Checked by: verifier NAV-a, 2026-11-27

### NAV-06 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/line-at.verify.mjs (output line-at.verify.out): md-prose 5.4 MB (1,289 headings) `@` is 6.4 s task, 6.3 s script; 10.8 MB 12.9 s task, 12.6 s script, so 2.0x per doubling (linear, but the cost is the full parse the Lines reading exists to avoid). The following key `e` is 0.33 s and 0.45 s (tree kept). Cause is at scopes-rows.ts:81, `store.snapshot().ast` forces the whole-file parse; docs/file-kinds.md:225 says the page is the parse of the whole file and Outline uses a scan (`scanHeadings`). Not a duplicate in todo.md
- Severity: S1 (agrees; script time, so not just load)
- Fix hint: in `outlineRows`, when the reading is Lines use the scanned headings (as the Outline panel does) and never touch `ast`; test: open a 5.3 MB Markdown file, press Ctrl+K and `@`, assert the task stays under about 0.5 s
- Checked by: verifier NAV-a, 2026-11-27

### NAV-01 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/mount.verify.mjs (output mount.verify.out): 2 MB file (true 32,442 matches) read "1 of 21072" with no "still counting" about 6 s after open, article 4132 of 6204 blocks; 3 MB (true 48,662): "1 of 21692" at 6 s, 4253 of about 6,400 blocks. Cause in code: walk.ts collectText walks mounted nodes only; find/view.ts paints "still counting" only for `counting` in viewer passes, and a re-run happens once at contentComplete() (view.ts:~708), so the count is wrong and unlabelled until then. docs/using-marxy.md:352 promises "still counting" for passes. Not a duplicate in work/todo.md (R13 is open cost only). Wall times were under load average 35-40; the counts, not times, carry the verdict
- Severity: S2 (agrees)
- Fix hint: while pane.view has not reported contentComplete, paint "still counting" (or "N so far") for the article path, and re-run find on each mounted chunk; a browser test that plants a 2 MB file, opens find on a word only in the tail and checks the label
- Checked by: verifier NAV-b, 2026-11-27

### NAV-03 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/mount.verify.mjs, mount.verify.out: 2 MB, End at +3 s lands at byte 1,338,922 of 2,007,597 (about the last mounted block, 1,357,830); repeated End every 10 s steps 1,500,902, 1,628,404, 1,741,497, 1,965,028 and finally 2,007,108 only after the mount finished (about 60 s). 3 MB: first End 1,376,794, then 1.65 M, 1.76 M, 1.87 M, 1.97 M, 2.07 M of 3.01 M, still short after 60 s. Each End costs about 1.6 s of main-thread task time (CDP TaskDuration, 1.58 and 1.62 s). No doc promises End goes to the mounted part only. Not in todo.md
- Severity: S2 (agrees)
- Fix hint: End/Mod+End should mount to the end (or jump the mount to the tail) or wait for contentComplete; test: open a 2 MB file, press End, assert the last block is in view
- Checked by: verifier NAV-b, 2026-11-27

### NAV-05 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/keys.verify.mjs (keys.verify.out, 2 runs per size, CDP TaskDuration per key, fully mounted md-prose, load average about 38 so numbers are upper bounds): 0.5 MB type 120-157 ms, Enter 17-30 ms; 0.75 MB type 495-593 ms, Enter 441-507 ms; 1 MB type 430-696 ms, Enter 424-533 ms; 1.5 MB type 441-767 ms, Enter 436-530 ms. So the step is real and sits between 0.5 and 0.75 MB (about 4x for 1.5x size), then flat; Next costs as much as a typed letter on the larger pages (worse than the catcher's 150-270 ms, likely load). Cause not isolated: the Spine's checkFind (spine.ts:289) is skipped on Enter since its key is unchanged, so the Enter cost is find's own work over the page, not the spine. Under load, only the step shape is firm, not the absolute ms
- Severity: S3 (agrees)
- Fix hint: profile find/view.ts rematch and window-of-Ranges rebuild at 0.75 MB to find what has a size threshold; a browser budget test on Enter at 1 MB
- Checked by: verifier NAV-b, 2026-11-27

### NAV-04 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/tabs.verify.mjs (output tabs.verify.out, Chromium, load average about 44, uptime recorded). Open of file 2 / 3 task time: 1 MB 3.6 / 3.7 s; 2 MB 34.5 / 44.7 s (gap 6 s) and 40.6 / 51.6 s (gap 20 s). The 10x jump from 1 to 2 MB holds, and a 20 s settle gap does not remove it, so it is not the first file's mount still running (the catcher's open question). 2 MB opens show 1,116 to 1,454 layouts against about 150 at 1 MB, with script only 6 to 8 s, so most of the time is layout and style, not script. Switch back: 1 MB 0.52-0.59 s, 2 MB 0.97-2.0 s. Split of the same file: 1 MB 4.5 s, 2 MB 6.4-13.6 s. Cause not isolated: registry.ts matches the catcher's account (warm store keeps bytes and tree, no view), but the layout storm on file 2/3 was not traced to a function
- Severity: S1 (agrees; 35-50 s task time on a 2 MB file is a freeze even allowing for load, and the layout counts are not load-dependent)
- Fix hint: start by profiling a second 2 MB open for why layouts jump from about 150 to over 1,000 (look at the page mount and typeset passes while another big page's DOM is still alive, about 0.07-0.3 M nodes); test: open two 2 MB Markdown files in turn and assert the second open's task time is within about 2x the first's
- Checked by: verifier NAV-a, 2026-11-27

### MEA-05 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/mea-c.verify.mjs, output probes/MEA/mdc.verify.out (load average about 30, so wall times are upper bounds; task ms from CDP Performance.getMetrics). md-prose 0.5 MB / 1 MB: to Source 2,223 / 4,218 ms; back to Read 697 / 1,392; one-paragraph edit commit 2,908 / 5,900; undo 2,126 / 3,888; reload after one appended line 2,067 / 3,724; find "the" 2,000 / 3,437. Growth per doubling 1.8-2.0x (linear), so the work follows the whole page, not the changed paragraph. 2 MB did not finish opening within the 90 s cap under load (open is the known MEA-01), so no 2 MB row. Absolute times are higher than the catcher's (load); the ratio matches.
- Severity: S2 slow (stays: seconds per small edit or undo at 1 MB; the commit and undo are the surprise)
- Fix hint: block commit and undo should splice the one block's DOM (the spliceStalePage path exists at view/rendered-view.ts:2100) instead of re-rendering the page; overlaps EDT-02 (whole-text rebuild per splice) and EDT-05 (leave Source) as causes, not duplicates.
- Checked by: verifier MEA-c, 2026-11-27

### MEA-04 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/mea-c.verify.mjs, output probes/MEA/mdc.verify.out. md-prose, task ms of a j key (median of 5) / scroll to the middle: 0.5 MB 106 / 89 ms (44k nodes), 1 MB 344 / 190 ms (83k nodes, longest key task 224 ms). Key cost grows 3.2x for 2x the size (super-linear), scroll 2.1x. 2 MB not reached (open exceeded the 90 s cap under load). My 1 MB key figure is higher than the catcher's 185 ms (load, so an upper bound); my 0.5 MB figure is lower than theirs. The handler responsible was not isolated; only the growth is shown.
- Severity: S3 slow (0.1-0.35 s per key at 0.5-1 MB is noticeable, not a freeze; rests on task time under load, not raised)
- Fix hint: profile the j and scroll handlers (a position read across all blocks); the geometry table row E22 in work/todo.md is the planned fix.
- Checked by: verifier MEA-c, 2026-11-27

### MEA-02 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/txt-profile.verify.mjs (output txt-profile.verify.out, txt-profile2.verify.out; load average 30-120). Thread task time by CDP metrics for open: 1 MB 11.5 s, 2 MB 42.7 s, 5.1 MB (full page, 386k nodes) 253 s, still not finished at the probe's 200 s wall cap; reload after a line appended on disk at 1 MB 16.7 s (open was 12.5 s, nodes doubled 76k to 153k). The 4.9 MB size itself was not rerun (5.1 MB is the same full-page path and slower). Not a duplicate: R13 and MEA-01 are Markdown; this is the text page. Cause (profiled at 1 MB and 2 MB, CDP Profiler, probes/MEA/txt-profile2.verify.out): the pieces are 200-line code blocks (packages/core/src/parse/code.ts:19 CODE_CHUNK_LINES, parseCode:62-86); the time that grows faster than the file is the idle mount loop in apps/desktop/src/render/progressive.ts, step() at :183 (`into.lastElementChild?.getBoundingClientRect()` forces a layout of the whole article after every chunk, so each chunk costs more as the article grows and total cost is quadratic): that call 1.5 s at 1 MB, 4.5 s at 2 MB; native style/layout (program) 6.1 s then 24.8 s (4.1x per doubling); onChunk passes via view/rendered-view.ts:295 blocksOf -> render/post.ts:77 buildBlocksByRange (closest/getComputedStyle) 0.47 s then 1.4 s.
- Severity: S1 (agrees)
- Fix hint: in progressive.ts step(), read layout once per several chunks or not at all (the chunk budget is measured by the read it forces), and stop the whole-article relayout per chunk; or send plain text past a low size (about 1 MB) to the Lines reading. Test: open a planted 2 MB text file and assert the thread task time stays under a fixed budget, and that task time at 1 MB and 2 MB differs by under 2.5x.
- Checked by: verifier MEA-b, 2026-11-27

### MEA-09 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/txt-profile.verify.out and txt-profile2.verify.out, open, thread task time: 0.25 MB 2.3 s, 0.5 MB 2.9 s, 1 MB 11.5-12.5 s, 2 MB 42.7 s, 5.1 MB 253 s. Growth: 1 to 2 MB 3.7x, 0.5 to 1 MB 4.3x (quadratic), 2 to 5.1 MB 5.9x for 2.55x the bytes (exponent about 2). Reload 0.5 MB 4.8 s, 1 MB 16.7 s (3.5x). The catcher's 5x per doubling is slightly high (I see 3.7-4.3x), and my 1 MB open (11.5 s) is slower than their 4.4 s, so load and profiler overhead affect absolute numbers; the super-linear shape is the same. Cause (profiled at 1 MB and 2 MB, CDP Profiler, probes/MEA/txt-profile2.verify.out): the pieces are 200-line code blocks (packages/core/src/parse/code.ts:19 CODE_CHUNK_LINES, parseCode:62-86); the time that grows faster than the file is the idle mount loop in apps/desktop/src/render/progressive.ts, step() at :183 (`into.lastElementChild?.getBoundingClientRect()` forces a layout of the whole article after every chunk, so each chunk costs more as the article grows and total cost is quadratic): that call 1.5 s at 1 MB, 4.5 s at 2 MB; native style/layout (program) 6.1 s then 24.8 s (4.1x per doubling); onChunk passes via view/rendered-view.ts:295 blocksOf -> render/post.ts:77 buildBlocksByRange (closest/getComputedStyle) 0.47 s then 1.4 s.
- Severity: S2 (agrees)
- Fix hint: same as MEA-02; the test is the doubling check (task time at 2 MB under 2.5x that at 1 MB).
- Checked by: verifier MEA-b, 2026-11-27

### MEA-11 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/txt-profile2.verify.out (unprofiled opens, CDP task time): txt 5,100,024 bytes (under LINES_FROM 5,242,880, so a full page) 253 s task, 386k nodes, 1,224 layouts; txt 5,300,042 bytes (Lines reading) 0.26 s task, 3.2k nodes, 17 layouts. The cliff is real; code line is 5 MiB (lines.ts:16) while docs/file-kinds.md:209 and :194 say "5 MB" with no unit, so the doc is ambiguous rather than wrong, and no doc says a slow full page just below it is meant. Cause (profiled at 1 MB and 2 MB, CDP Profiler, probes/MEA/txt-profile2.verify.out): the pieces are 200-line code blocks (packages/core/src/parse/code.ts:19 CODE_CHUNK_LINES, parseCode:62-86); the time that grows faster than the file is the idle mount loop in apps/desktop/src/render/progressive.ts, step() at :183 (`into.lastElementChild?.getBoundingClientRect()` forces a layout of the whole article after every chunk, so each chunk costs more as the article grows and total cost is quadratic): that call 1.5 s at 1 MB, 4.5 s at 2 MB; native style/layout (program) 6.1 s then 24.8 s (4.1x per doubling); onChunk passes via view/rendered-view.ts:295 blocksOf -> render/post.ts:77 buildBlocksByRange (closest/getComputedStyle) 0.47 s then 1.4 s.
- Severity: S1 (agrees)
- Fix hint: lower the full-page line for text and code (about 1 MB, where task time is already 11 s) or fix the per-chunk layout read in progressive.ts:183; state the unit in docs/file-kinds.md.
- Checked by: verifier MEA-b, 2026-11-27

### MEA-03 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/mea-c.verify.mjs --kinds json-pretty --sizes 1m, output probes/MEA/other.verify.out (load average about 30). Open 3.0 s task (52k nodes), to Source 0.54 s, back 2.6 s, then reload after one appended line: task 200.7 s in the 200 s cap and never quiet, longest task 1.08 s, and the DOM grew from 53k to 491k nodes (script 39.6 s, 12,398 style recalcs). The find after it: 214 s, nodes 625k, longest task 7.0 s, still not quiet. The find cost is mostly the reload's work still running (the step before it never went quiet), as the catcher warned; I did not isolate a find on a settled page. The growing node count is new: the reload seems to mount far more nodes than the open does (10x), not just redo the same tree. The 2 MB run was stopped to save time.
- Severity: S1 freeze (a one-line change on disk to a 1 MB pretty JSON file leaves the window busy for over 3 minutes; wall time under load only, but task ms and node count agree)
- Fix hint: compare the reload path's mount of the JSON tree with the open path (open: 52k nodes in 3 s; reload: 490k+ nodes); likely the reload mounts every row (or the tree twice) instead of the collapsed tree.
- Checked by: verifier MEA-c, 2026-11-27

### MEA-07 verdict
- Verdict: PLAUSIBLE
- Proof: JSON part reproduced: probes/MEA/other.verify.out, json-pretty 1 MB back from Source 2,625 ms task, longest task 2,456 ms, 505 layouts and 507 style recalcs (to Source 544 ms; open 3.0 s with the same 52k nodes). Code: leaveSourceForRendered (view/rendered-view.ts:1203) with nothing changed skips the re-render (pageStale false) and goes through showRendered, mountThrough and snap (1046-1077), so the cost is un-hiding and re-laying-out the page, not re-drawing from bytes. Plain-text 4.9 MB: see the next note; if it has no verdict lines in other.verify.out the probe did not reach it.
- Severity: S2 slow (S3 if a wall-time-only claim; JSON 2.6 s one-off per switch)
- Fix hint: keep the Read page laid out (or content-visibility) while Source shows, so returning without an edit costs a class toggle.
- Checked by: verifier MEA-c, 2026-11-27

### MEA-06 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/mea-c.verify.mjs on diff and html at 1 / 2 / 4.9 MB, output probes/MEA/other.verify.out (load about 30; task ms). Diff open task 455 ms / 3,386 / 16,979 (nodes stay 3.9k-5.8k): 7.4x for 2x the bytes, 5x for 2.45x, so super-linear and not drawn work; busy until idle 3.2 / 5.3 / 18.2 s. (A machine sleep hit the diff 4.9 MB run after open, so its Source steps were not taken; the 1 and 2 MB rows are clean.) HTML reload task 1,475 / 3,544 / 10,478 ms (longest 4.5 s at 4.9 MB), back from Source 626 / 1,433 / 4,680 (layout 2.2 s), to Source 944 / 1,232 / 421. Reload and back-from-Source roughly double the node count at 4.9 MB (230k to 459k and 656k): the HTML page is drawn again beside the old one or its nodes are not released. HTML reload grows 2.4x then 3x per step, a little above linear at the top.
- Severity: S2 slow (a 4.9 MB diff is 17 s of main thread to open, HTML reload 10 s; wall-time under load but task time agrees)
- Fix hint: for the diff reading, find the pass that is quadratic in file size (the node count stays flat, so it is parse or line-classify work, not DOM); for HTML check why reload and back-from-Source double the nodes.
- Checked by: verifier MEA-c, 2026-11-27

### MEA-01 verdict
- Verdict: DUPLICATE of R13 (work/todo.md:35: same cost, Windows 78 s at 1 MB; MEA-01 is its first macOS measurement)
- Proof: probes/MEA/open-profile.verify.mjs, open-prose.verify.out and open-prose2.verify.out (uptime recorded). md-prose CPU task time: 125k 2.4 s, 250k 10-14 s, 500k 28.6-38.4 s (two runs); per doubling 5.9x then 2.7-2.9x (noisy, load 30-120), layouts 256/734/1627. Super-linear but below the catcher's 4.2x at this range; 1 MB not re-run. Longest single tasks are under about 1 s, so keys answer between them.
- Severity: S2 slow but responsive (was S1; wall time under load, and no single task over 1.1 s)
- Fix hint: Cause (profile, probes/MEA/open-profile.verify.mjs, outputs open-prose2/open-technical .verify.out): the time is the typesetter, not the mount. Inclusive CPU: typeset step (packages/typeset/src/index.ts:587) -> keepPlace :249 -> setBatch :326 -> place :357 -> applyHang (hang.ts:60) -> measureAdvance (hang.ts:53, Range.getClientRects) and applyBreaks overflow check (apply.ts:96, getClientRects). Each batch reads layout after writing breaks/hang spans, so every batch forces a layout whose cost grows with the article already mounted, and batches grow with the file: quadratic (index.ts:1038-1044 comment says the same). getClientRects 2.2s->10s (250k->500k prose), 10s->45s (technical). Next: progressive.ts:85 step getBoundingClientRect (forced layout per idle chunk, 7s->33s technical), then rendered-view.ts snap -> blocksOf (post.ts:97 buildBlocks, whole-article querySelectorAll+getComputedStyle per snap) and quiet-dates.ts:61 paint querySelectorAll. The baseline-grid pass (snap from the added chunk) is small (5s of 155s technical), not the main cause. Fix: contain the article (content-visibility/contain on blocks) so layout is not whole-article, or batch layout reads per window not per batch.
- Checked by: verifier MEA-a, 2026-11-27

### MEA-08 verdict
- Verdict: CONFIRMED
- Proof: probes/MEA/open-technical.verify.out: md-technical CPU task 265k 39.7 s, 509k 155 s (x3.9 per doubling; script x3.9, layout x4.6, style recalc x4.2), 54k nodes; under load 55-120, so wall numbers are upper bounds (catcher: 76 s task at 0.5 MB). Technical costs several times prose (28-38 s at 0.5 MB) because it has more inline spans per paragraph and recalc is 40% of the task. Adds to R13.
- Severity: S1 freeze (agrees; the CPU, not only wall, is 76-155 s)
- Fix hint: Cause (profile, probes/MEA/open-profile.verify.mjs, outputs open-prose2/open-technical .verify.out): the time is the typesetter, not the mount. Inclusive CPU: typeset step (packages/typeset/src/index.ts:587) -> keepPlace :249 -> setBatch :326 -> place :357 -> applyHang (hang.ts:60) -> measureAdvance (hang.ts:53, Range.getClientRects) and applyBreaks overflow check (apply.ts:96, getClientRects). Each batch reads layout after writing breaks/hang spans, so every batch forces a layout whose cost grows with the article already mounted, and batches grow with the file: quadratic (index.ts:1038-1044 comment says the same). getClientRects 2.2s->10s (250k->500k prose), 10s->45s (technical). Next: progressive.ts:85 step getBoundingClientRect (forced layout per idle chunk, 7s->33s technical), then rendered-view.ts snap -> blocksOf (post.ts:97 buildBlocks, whole-article querySelectorAll+getComputedStyle per snap) and quiet-dates.ts:61 paint querySelectorAll. The baseline-grid pass (snap from the added chunk) is small (5s of 155s technical), not the main cause. Fix: contain the article (content-visibility/contain on blocks) so layout is not whole-article, or batch layout reads per window not per batch.
- Checked by: verifier MEA-a, 2026-11-27

### MEA-10 verdict
- Verdict: CONFIRMED (references at 1 MB; smaller than claimed at 0.5 MB); dense not tried
- Proof: probes/MEA/open-headings-refs.verify.out, open-headings-refs500.verify.out, open-references1m.verify.out. md-references CPU task: 125k 0.46 s, 250k 0.81 s, 500k 2.6 s (catcher 16.7 s), 1 MB 20.1 s (catcher 121 s): per doubling 1.8x, 3.2x, 7.9x, so super-linear and worst at the top, matching 6.8x. Same hot path as MEA-01: measureAdvance 4.3 s and overflow 2.7 s of getClientRects at 1 MB, 95k nodes, 1257 layouts. The catcher's absolute times were about 6x mine; the load differed.
- Severity: S2 slow (was S1; 20 s of CPU at 1 MB in chunks, 2.6 s at 0.5 MB)
- Fix hint: Cause (profile, probes/MEA/open-profile.verify.mjs, outputs open-prose2/open-technical .verify.out): the time is the typesetter, not the mount. Inclusive CPU: typeset step (packages/typeset/src/index.ts:587) -> keepPlace :249 -> setBatch :326 -> place :357 -> applyHang (hang.ts:60) -> measureAdvance (hang.ts:53, Range.getClientRects) and applyBreaks overflow check (apply.ts:96, getClientRects). Each batch reads layout after writing breaks/hang spans, so every batch forces a layout whose cost grows with the article already mounted, and batches grow with the file: quadratic (index.ts:1038-1044 comment says the same). getClientRects 2.2s->10s (250k->500k prose), 10s->45s (technical). Next: progressive.ts:85 step getBoundingClientRect (forced layout per idle chunk, 7s->33s technical), then rendered-view.ts snap -> blocksOf (post.ts:97 buildBlocks, whole-article querySelectorAll+getComputedStyle per snap) and quiet-dates.ts:61 paint querySelectorAll. The baseline-grid pass (snap from the added chunk) is small (5s of 155s technical), not the main cause. Fix: contain the article (content-visibility/contain on blocks) so layout is not whole-article, or batch layout reads per window not per batch.
- Checked by: verifier MEA-a, 2026-11-27

### MEA-12 verdict
- Verdict: NOT-REPRODUCED (headings); tables CONFIRMED but linear and mild
- Proof: probes/MEA/open-headings-refs.verify.out, open-headings-refs500.verify.out: md-headings 125k/250k/375k/500k opens complete in 0.26/0.41/0.60/0.83 s, task 0.35/0.48/0.68/0.92 s (x1.4 per doubling, linear). The catcher's own matrix.mjs rerun (probes/MEA/headings-catcher-rerun.verify.out) at 0.5 MB: open complete 0.97 s, idle in 2.2 s, scrollEnd, toSource 2.3 s, edit 2.4 s, find 1.6 s; no stall. The catcher's two stalls (500k and 1 MB) were not repeatable; likely a load artefact. Tables (open-tables.verify.out): 0.5 MB busy 3.0 s, 172k nodes; 1 MB busy 6.5 s, task 5.3 s, 339k nodes (x2.85 task), matching the catcher's 340k nodes; not a freeze.
- Severity: S3 for tables (node count 340k at 1 MB; was S1)
- Fix hint: tables: fewer nodes per cell; headings: nothing to fix found.
- Checked by: verifier MEA-a, 2026-11-27

### EDT-08 verdict
- Verdict: CONFIRMED
- Proof: probes/late/copy-as-cpu.verify.mjs, output copy-as-cpu.verify.out (node, thread CPU, load 30-35, caffeinate). md-prose 1/2/4.9 MB: parse 0.60/1.26/2.66 s, Slack 0.64/1.09/2.91 s, rich 0.14/0.19/0.69 s (linear, 2.1x per doubling). md-technical 1/2/4.9 MB: parse 1.06/2.12/7.0 s, Slack 1.07/2.99/6.16 s, rich 0.23/0.57/1.38 s (about 2x to 3x per doubling, mildly super-linear for Slack 1 to 2 MB). The catcher's 19-78 s and 14-45 s were wall time on a loaded Mac (same runs: wall 8-30 s for CPU 2.7-7 s). Cause as stated in copy-as.ts (copyAsFromText parses the whole selection; Slack builds a second parse-sized pass); same cause as EDT-07, whose fix (reuse the store's parse, lazy title) covers it. Hold: the row about a selection that is not the whole file still needs its own parse.
- Severity: S3 slow (was S1 freeze; 3-7 s of CPU at 4.9 MB for a deliberate Select all + Copy as, no hang, not worse than about 3x per doubling)
- Fix hint: as EDT-07; also make the Slack target reuse `parsed()` instead of reparsing; test: copyAsFromText of a 2 MB technical file whole-file selection with `ref.parsed` set, thread CPU under 0.3 s.
- Checked by: verifier late, 2026-11-27

### RDR-05 verdict
- Verdict: CONFIRMED
- Proof: probes/late/open-cliff.verify.mjs, output open-cliff.verify.out (Chromium via shots, CDP TaskDuration = main-thread CPU, load 30-55; 1 MB vs 2 MB). md-headings: CPU 5.7 s to 23.9 s and 27.4 s (second run), x4.2-4.8 per doubling, open resolved 2.5 s to 20.8-24.3 s, nodes 91k to 185k-326k. md-transcript: CPU 5.4 s to 28.5 s (x5.3), resolved 2.2 s to 25.4 s, 87k to 235k nodes. Both cliffs hold on CPU, not only wall. md-tables does NOT: CPU 6.4 s to 10.6 s (x1.7), resolved 3.3 s to 7.5 s, 339k to 674k nodes; the catcher's 4.4 s to 25.1 s for tables is not reproduced (load). Growth in the cliff cases is spread over script, layout and style (each x4-5), no single long task (max 113-287 ms at 2 MB), consistent with the per-chunk layout read at render/progressive.ts:183 meeting a growing article, as for RDR-03. Not isolated further.
- Severity: S2 (agrees for headings and transcript: 24-28 s CPU to finish at 2 MB, window answers between tasks); tables should be dropped from the finding.
- Fix hint: same repair as RDR-03; test: open md-headings 2 MB and bound CPU TaskDuration to under 2.5x the 1 MB figure.
- Checked by: verifier late, 2026-11-27
