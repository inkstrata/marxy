# Hunt 02: verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### NAV-02 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/links-repeat.verify.mjs (3 MB Markdown, own sequence) gives one 6,626 ms task in run 1 and 6,036 ms in run 2, on the first panel key after Links was read (Alt+1 after Alt+4); output in probes/NAV/links-repeat.verify.out. Code matches the finding: doc-links.ts:46 calls `pathMentions(text)` (extract.ts:45, a second full parse) synchronously, and `withParse`/`snap.ast` are not used there.
- Repeat question: once per file version, not per switch. `linksOfPane` keeps its result in `kept` keyed by `snap.version:bytes:files-here` (doc-links.ts:36-40, 61), so later switches between all panels took 54-190 ms (and the catcher's mine-5.out rounds 2-4 agree). It repeats only when that signature changes (edit, another file opening, or the count of files here changing) or when the 40-entry cache evicts the path. My probe's "type x" step did not show a repeat, but I could not confirm the keystroke landed in the editor, so the after-edit repeat is read from the code, not seen.
- Severity: S1 freeze (agrees on size; it is a one-off per version, so a frequent edit-then-switch cycle is what makes it hurt)
- Fix hint: derive the mentions from the parse the store already holds (`store.parsed()`/`snap.ast`, as `withParse` does) or move them off the main thread; the test is a browser test that opens a 3 MB Markdown file, reads Links, then asserts the next panel key's longest task is under about 300 ms.
- Checked by: verifier links, 2026-11-27

### RDR-01 verdict
- Verdict: CONFIRMED
- Proof: code matches (rendered-view.ts:1394 relayoutKeepingReader runs typeset.relayout then, in relayoutForTheme at :1448, `blocksOf(doc)`; post.ts:133-150 buildBlocks does one getBoundingClientRect per block). probes/RDR/layout.verify.mjs, on a prose-only file with no tables or lists, a different shape from the catcher's: Ctrl+B presses cost one long task of 208/242/146 ms at 1 MB and 209/178/193 ms at 3 MB; 0 long tasks on 0.05 MB (output probes/RDR/layout.verify.out)
- Severity: S3 (was S2): on plain prose one press is a single 150-250 ms task, not the 340-520 ms the catcher saw on table-heavy files; real but not a freeze
- Fix hint: relayout only the screen's part on a drawer change, or reuse the block list patch path; a browser test would assert the longest task of a Mod+B press on a planted 1 MB page stays under a budget
- Checked by: verifier layout, 2026-11-27

### NAV-03 verdict
- Verdict: DUPLICATE of RDR-01
- Proof: the drawer fold/open cost is the page relayout RDR-01 measures (NAV-03's own Where says so); my probes/RDR/layout.verify.out shows the same 150-250 ms per Ctrl+B. The panel-switch part (left/frame.ts:374 draw rebuilding) is a smaller cost and was not separately isolated; the panel stalls the catcher lists are NAV-02/CMD's
- Severity: S3 (agrees)
- Fix hint: see RDR-01
- Checked by: verifier layout, 2026-11-27

### RDR-02 verdict
- Verdict: CONFIRMED
- Proof: probes/RDR/layout.verify.mjs: viewport 1400 to 900 px on prose gives long tasks of 2 tasks / 368 ms at 1 MB (440 ms sum) and 2 tasks / 301 ms at 3 MB; back to 1400 px 70 ms and 76 ms; 0.05 MB none (probes/RDR/layout.verify.out). The 0.9 s and 12-task figures at 5 MB were not re-run
- Severity: S3 (was S2): 0.3-0.4 s, two tasks, on prose
- Fix hint: same as RDR-01; the whole block-list rebuild after a width relayout is the place to start
- Checked by: verifier layout, 2026-11-27

### CMD-03 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/busy.verify.mjs (output busy.verify.out): a plain 1 MB/3,000-heading file opens in 2.8 s and has 0 long tasks afterwards; the same size with trailing-space line breaks, links, lists and tables opens in 5.8 s and then shows 36 tasks over 50 ms (2.4 s total) between 5 and 20 s after open, still arriving at +20 s; the same at 3 MB: the open itself passed 10 s (STALL). So it depends on the content, not the size. Cause not located (not in the panels)
- Severity: S3 (was S2): the tasks after open are mostly under 100 ms; the 3 MB open is the worse part
- Fix hint: profile the background pass after open on the rich file (hard breaks, links, tables); probably the typesetter or the Links/places indexing
- Checked by: verifier layout, 2026-11-27

### CMD-04 verdict
- Verdict: NOT-REPRODUCED
- Proof: probes/RDR/layout.verify.mjs spine drag, 15 moves of 40 px: 0 long tasks at 0.05, 1 and 3 MB; per-move round trip 14-168 ms on the 0.05 MB control (median about 35 ms) and 33-131 ms at 1 MB, 46-131 ms at 3 MB, so the time is the probe's mouse round trip, not a cost that grows with the file (output probes/RDR/layout.verify.out). The 5 MB case was not run
- Severity: S3 (agrees, as cosmetic at most)
- Fix hint: none
- Checked by: verifier layout, 2026-11-27

### CMD-01 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/tx.verify.page.mjs (output tx.verify.out), on my own plainer text (no trailing spaces), Alt+6 pressed with nothing else. Alt+6 itself returns in 70-120 ms (the panel draws with "…" rows), then a ping task is delayed: 0.23 MB (1,500 sections) ping stalled 1.96 s then 0.6 s; 0.47 MB (3,000 sections) ping stalled over 10 s (STALL>10s). So it is the Alt+6 draw followed by `workOut`, no Tab or arrow needed; it does not need a row to be hovered. Node, probes/CMD/tx.verify.mjs (tx.verify.node.out): at 0.47 MB renumber-list 33 s, table-align 27 s, unwrap 13 s, tick-all 7 s, untick-all 4.8 s; at 0.23 MB table-align 12.6 s, tick-all 4.5 s, renumber-list 4 s. Cost is superlinear. Code matches: workOut's 12 ms check is between items (transforms.ts:123-134) and each byNodes does encode + parseMarkdown (transforms-model.ts:132-136). Not in todo.md; no doc states it as intended.
- Severity: S1 freeze (agrees)
- Fix hint: byNodes should take the store's existing parse (store.parsed()) instead of parsing again, and the counts for the heavy rows should be skipped or computed lazily (on row focus) or in a worker above a size; table-align's own cost needs a look too. Test: plant 0.5 MB Markdown, press Alt+6, assert a ping answers within ~300 ms. The markLines loop (:146-159) not separately measured.
- Checked by: verifier tx, 2026-11-27

### CMD-02 verdict
- Verdict: CONFIRMED (narrower than filed; cause is not the one filed)
- Proof: probes/CMD/metadata2.verify.mjs (output metadata2.verify.out): on Markdown of 4.5 MB and 4.9 MB, 3,000 headings, settled 15 s, the first Alt+2 leaves the page unanswering for over 10 s (the poll's evaluate times out, both sizes); the second Alt+2 on the same file takes 0.3 s. At 1 and 3 MB the first Alt+2 was 0.1 to 0.5 s (the filed 2.5 s at 1 MB did not recur; probes/CMD/metadata.verify.out; probably the page still settling per CMD-03). A CDP profile (probes/CMD/metadata3.verify.mjs, .out) puts the time in a whole-file Markdown parse (subtokenize, fromMarkdown, GC) called from metadata.ts:218 textAccount -> doc-links.ts:46 linkCount -> linksOfPane (doc-links.ts:16) -> pathMentions -> gapsOf -> protectedSpans -> parseText -> parseMarkdown. So linksOfPane parses the file a second time, synchronously, for written paths. Its cache `kept` is keyed version:bytes:here.size (doc-links.ts:36), where here.size is index entries plus open paths, so a change in either drops the cache and the next draw of Metadata for the big file repeats the parse; that fits the intermittent 11 s in tabs.out (the exact trigger in the open-small case was not driven). The filed steps (readingOf, scanHidden, countWords) are not the cost. Past 5 MB the cost is gone (metadata.verify.out, 5.5 MB).
- Severity: S1 freeze (10 s or more on the main thread for Markdown of about 1 to 5 MB, once per file version and per change of the set of open or indexed files; Metadata only)
- Fix hint: make linksOfPane's written-path scan not re-parse (use the store's AST, or run pathMentionsIn on the plain lines); key `kept` by version and size only and apply the here-set cheaply after; or compute it async like linksSoon. Related to CMD-03 (parse cost) but a distinct call site.
- Checked by: verifier meta, 2026-11-27
