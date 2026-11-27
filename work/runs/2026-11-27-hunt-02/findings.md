# Hunt 02: findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### NAV-01 · Moving through the left and right menus freezes the window, often (not only) with a big file open
- Severity: S1 freeze
- Domain: navigation and panes
- Where: apps/desktop/src/left/frame.ts, apps/desktop/src/left/panels/ (unconfirmed)
- Repro: owner's report, 2026-11-27: navigating through the left menus (rail panels, drawer) and the "right menus" (unclear which: the right-click verb or tab menu, Look/Settings at the rail's foot, or the Spine), more often with a big file open. No steps or file given.
- Expected: switching panels and opening menus keeps the window answering, at any file size
- Actual: the window freezes
- Evidence: owner's report only. Hunt-01 rows B1 (Export as web page), B2 (Search regex) and B3 (long unbroken run) are known freezes and have builders; this report is about something else
- Confidence: low
- Found by: owner, 2026-11-27

### CMD-01 · Opening the Transforms panel on a Markdown file of 0.5 MB or more freezes the window for 10 s and more
- Severity: S1 freeze
- Domain: drawer panels (Transforms), supersedes part of NAV-01
- Where: apps/desktop/src/left/panels/transforms.ts:123-134 (`workOut`, 12 ms budget checked only between items), :99-110 (`effectOf`), :383-405 (every row's count); apps/desktop/src/left/transforms-model.ts:132-161 (`byNodes`: `encoder.encode` + `parseMarkdown` of the whole file for each of renumber-list, table-align, tick-all, untick-all), :283 (`unwrap`)
- Repro: plant a 1 MB Markdown file with 3,000 headings, each with a few paragraphs, a list and a small table (probes/CMD/panels.mjs); open it, wait for the page; press Alt+6 (Transforms). Markdown only: the Markdown group is offered for Markdown files.
- Expected: the panel draws at once and the counts fill in without a step over ~300 ms (the code's own comment says "a few at a time", 12 ms)
- Actual: after Alt+6 the page does not answer for 13 s (the probe's evaluate hit its 10 s timer; every later step stalled too, the run had to be killed). The 12 ms budget cannot help: it is tested only between transforms, and each one is a single synchronous call
- Evidence: probe probes/CMD/panels.mjs (output probes/CMD/panels.out): "Transforms Alt+6 wall 13233 ms" on 1 MB, then no step answered. Cost per transform measured in node, probes/CMD/tx-time.mjs, on the same text (0.5 MB / 1 MB / 2 MB): table-align 10.5 s / 17.8 s / more; unwrap 3 s / 6.4 s / 10.6 s; renumber-list 3 s / 3.5 s / 10.5 s; tick-all 2.6 s / 2.7 s; untick-all 3.3 s / 3.8 s. Each of the four `byNodes` rows parses the file again although the store already holds the parse (`store.parsed()`). Every file edit (new `version`) throws the counts away and runs them all again. Also, resting the cursor on a row runs `markLines` (:146-159), which loops every changed range (up to 400) over every `[data-marxy-s]` element of the page, on the main thread
- Confidence: high
- Found by: catcher menus, 2026-11-27

### NAV-02 · Opening the rail on a big Markdown file freezes the window for seconds (the Links work parses the whole file again, on the main thread)
- Severity: S1 freeze
- Domain: navigation and panes (rail, Links)
- Where: apps/desktop/src/left/doc-links.ts:46 (`linksOfPane` calls `pathMentions(text)`), packages/core/src/transforms/extract.ts:45 (`proseLines` -> `gapsOf` -> `protectedSpans` -> `parseText` -> `parseMarkdown`, a second full mdast parse), apps/desktop/src/left/frame.ts (`badges()` at the end of every `draw()` reads the Links badge, so any panel can trigger it)
- Repro: browser build; plant a Markdown file of 5 MB (3,000 headings, a link and a written path `notes/plan-N.md` every few lines, lists and tables); open it, wait for the page to settle; press Alt+1, Alt+3, Alt+4 (Links), then Alt+5 (or any other panel key). Probe: probes/NAV/prof.mjs with SIZE=5 PANEL=1,3,4,5
- Expected: switching panels answers within ~300 ms at any file size, the file's links worked out off the main thread or from the parse the store already holds
- Actual: one task of 7-9 s while the rail looks idle (Alt+5 step: wall 9.4 s, longest long task 8,984 ms in probes/NAV/mine-5.out). 1 MB: about 1.6 s of `fromMarkdown` inside `pathMentions`; 5 MB: 7.2 s; 20 MB: see NAV-03 (linear, so about 30 s). `pathMentions` is called synchronously every time the links signature changes (`snap.version`, byte length, or the count of files here), so it repeats after every edit once the Links panel or badge has been read, and when another file opens
- Evidence: probe CPU profile (probes/NAV/prof-seq5.out): 7,169 ms in `fromMarkdown` under `pathMentions@extract.ts:45 < proseLines < gapsOf < protectedSpans < parseText < parseMarkdown`; probes/NAV/prof-links-curve.out for 1 MB. `withParse` (prose.ts:55) exists to hand a parse to this code and is not used by `linksOfPane`, which already has `store.parsed()`/`snap.ast`
- Confidence: high
- Found by: catcher panels, 2026-11-27

### CMD-02 · Metadata panel: showing it on a 1 MB Markdown file stalls 2.5 s, and with a 5 MB one open, opening another file stalls the window about 10 s
- Severity: S1 freeze
- Domain: drawer panels (Metadata), supersedes part of NAV-01
- Where: apps/desktop/src/left/panels/metadata.ts:299-346 (`textAccount`: `readingOf` over the whole file, `namedParts`/`partsNow`, `scanHidden`, `storedFacts`, `countWords` all on the main thread in `render`), :724-748 (`render`); cause of the second case not pinned down
- Repro: plant Markdown of 1 MB (3,000 headings, links, lists, tables) and open it; press Alt+2. Second case: plant 5 MB, open it, press Alt+2, then open a small file (a click on a Places row, or the Line).
- Expected: the panel draws without a step over ~300 ms; opening another file is as fast with the panel shown as with the drawer closed
- Actual: 1 MB: Alt+2 is one 2,524 ms task (probes/CMD/panels2.out line 5). 5 MB, Metadata shown: opening the small file ran a single 11,182 ms task once (probes/CMD/tabs.out), and in probes/CMD/panels2.out three small-file/big-file opens in a row with Metadata shown each hit the 10 s race (9.5 s wall). With the drawer closed, or Versions or Export shown, the same open of the small file takes 1.4 s and 140-160 ms of task
- Evidence: probes probes/CMD/panels.mjs and probes/CMD/tabs.mjs (outputs panels2.out, tabs.out), macOS, headless Chromium, memory shell. Size curve for Alt+2 on this text: 1 MB 2.5 s; 5 MB 0.29 s (past 5 MB Markdown is not parsed, metadata.ts:330, so the cost drops). The 11 s case did not reproduce in every sequence (the later "big file again" opens were 4 s), so the trigger may be the panel drawing for the document just closed; confidence is medium
- Confidence: medium
- Found by: catcher menus, 2026-11-27

### CMD-03 · A 1 to 5 MB Markdown file keeps the page busy for over 15 s after it opens, so every later panel key lands in a slow page
- Severity: S2 wrong result
- Domain: drawer panels, seen while probing; probably belongs to the relayout catcher
- Where: unknown (not in the panels); noted for RDR
- Repro: plant 1 MB Markdown with 3,000 headings, paragraphs with two trailing spaces, links, lists and small tables; open it; poll for tasks over 50 ms every 1.5 s
- Expected: the page goes quiet after the first paint
- Actual: open is one 2.8 s task, and tasks over 50 ms keep arriving for more than 15 s (the first probe waited 120 s and never saw 3 s of quiet); a 5 MB file takes 9.7 s to open (the probe's 10 s race tripped)
- Evidence: probes/CMD/panels.out ("background settled after 120692 ms", 1 MB), panels2.out (16009 ms cap, 15643 ms cap). Not chased: outside the panels. With a plainer text (no trailing spaces) the same 5 MB file settled in 9 s (probes/CMD/menus2.out)
- Confidence: medium
- Found by: catcher menus, 2026-11-27

### CMD-04 · Supersedes NAV-01 for the Line, Studio, Settings, verb menu, right-click and tab menus, and the Spine: no freeze found, but dragging the Spine is slow on a big file
- Severity: S3 slow
- Domain: menus (the first lead list, before the aim changed)
- Where: apps/desktop/src/frame/spine.ts (drag path, not read)
- Repro: plant 5 MB Markdown with 3,000 headings, open it, wait for it to settle; drag the Spine from y=200 to y=800 in 40 px steps
- Expected: each move answers in a frame or two
- Actual: each of 15 moves took 106-391 ms (one 771 ms), 3.7 s for the drag; on 1 MB 4.2 s. The longest single task was 182-231 ms, so not a freeze
- Evidence: probes/CMD/menus.mjs, outputs menus.out and menus2.out. Line (Mod+P) open and close, typing, ArrowDown, Studio (Mod+Alt+T) steps, Settings, Enter and right-click menus and Shift+F10 on a tab all stayed under 135 ms in their longest task, and 10 open/close cycles of the Line and of the Studio showed no growth. The 20 MB run read 0 ms everywhere because that file seems not to have rendered, so it proves nothing. Part of the per-move time may be the probe's own mouse round trip
- Confidence: low
- Found by: catcher menus, 2026-11-27

### RDR-01 · Supersedes NAV-01 (drawer part): opening, folding or hiding the left section freezes a big page for 0.3 to 0.5 s each press, and the cycle has three presses
- Severity: S2 long stall
- Domain: reading and rendering, relayout
- Where: apps/desktop/src/view/rendered-view.ts:1394 (relayoutKeepingReader) and :1448 (`shown.blocks = blocksOf(doc)`), apps/desktop/src/render/post.ts:133-150 (buildBlocks, one getBoundingClientRect per block), packages/typeset/src/index.ts:1093 (relayout un-sets the whole page)
- Repro: plant a 1 MB / 5 MB Markdown with 300 / 3,000 headings, lists, links, 50 / 300 wide tables, open it in Read; press Mod+B (open, rail alone, hidden, open ...). Platform: browser build, Chromium on macOS; real window not tried
- Expected: a change of the drawer moves the page's edge without a visible stall at any file size, or only the screen's part is set again
- Actual: every press is a single main-thread task of 340-520 ms (longtask), followed by 3-15 more of 50-110 ms for a second or two. A 50 KB file shows none (0 long tasks). Drawer presses, longest task: 1 MB 186-475 ms, 2 MB 256-342 ms, 3 MB/3,000 headings 348-522 ms, 5 MB 236-417 ms. The stall barely grows with size (the first slice is bounded) but the tail does: sum of long tasks per press 430-620 ms at 1 MB, 920-1080 ms at 5 MB. At 20 MB the file opens in Source, so nothing to measure there
- Evidence: probes/RDR/relayout.mjs (outputs relayout-5mb.out, relayout-variants.out); CDP profile probes/RDR/profile.out per press: getBoundingClientRect 620-730 ms self, buildBlocks in post.ts, querySelectorAll 190-250 ms, tab-row.ts:527 240-290 ms (tab strip re-measured on a drawer toggle), left/frame.ts:294 `draw` 236 ms in one cycle. probes/RDR/whole.mjs (whole.out): each width change builds the whole block list once (`blockListStats.whole` +1, patched +0) instead of the patch path. probes/RDR/count.mjs (count.out): getBoundingClientRect called 7,000 times per press at 1 MB and 88,000-105,000 times at 5 MB (about 13x for 5x the file: faster than the file). Tables are not the cause: 5 MB with 1 table gives the same 286 ms. Splits, F11 and the rail hide (Mod+\) are cheaper: 70-190 ms at 1 MB, 74-313 ms at 5 MB
- Confidence: high that the stall exists in the browser build; medium that it is the owner's freeze (the real WebView2/WKWebView may be slower, and the owner's file was not given)
- Found by: catcher relayout, 2026-11-27

### RDR-02 · Dragging the window or the divider to a new page width stalls a big page for up to 0.9 s, three to five times in a row
- Severity: S2 long stall
- Domain: reading and rendering, relayout
- Where: apps/desktop/src/view/rendered-view.ts:1850-1861 (afterBurst then relayoutKeepingReader('resize')), packages/typeset/src/index.ts:1093, apps/desktop/src/render/post.ts:133
- Repro: as RDR-01, then shrink the viewport from 1400 to 900 px and back (a probe's setViewportSize; a window drag does the same after the 100 ms burst timer). Width must change the article's measure; a change that leaves the measure alone costs 60-200 ms
- Expected: one short relayout of the screen, the rest in idle slices
- Actual: long tasks after one width change: 1 MB [109, 334, 278, 306, 55] ms; back to 1300 px [81, 99, 265, 114, 53] ms; 5 MB (still mounting) [120, 857, 763, 171, 72, 53, 57, 193, 99, 71, 92, 94] ms. So 5 MB: 1.7 s of back-to-back freezes. Block list rebuilt whole 1 to 3 times per change (whole +3 at 5 MB)
- Evidence: probes/RDR/whole.mjs, output probes/RDR/whole.out. Adds to RDR-01; the cause is shared (typeset relayout, then whole block-list rebuild, then spine/tab-row reads). Not found: a leak, listeners stay at 299 over 12 drawer presses and 6 resizes (probes/RDR/leak2.out), nor from panel switching on a small file (leak.out)
- Confidence: high (browser build); size curve has two points taken while the 5 MB page was still mounting, so its numbers may include mount work
- Found by: catcher relayout, 2026-11-27

### NAV-03 · Folding or opening the drawer and moving through panels costs 300-550 ms a press on a 1-5 MB Markdown file; the rail itself leaves nothing behind
- Severity: S3 slow
- Domain: navigation and panes (rail, drawer)
- Where: apps/desktop/src/left/frame.ts:374 (`draw` rebuilds the panel from scratch on every switch); page re-layout on drawer fold/open is RDR's subject and was not measured here
- Repro: browser build; plant 1 MB and 5 MB Markdown (300 / 3,000 headings, links, lists, tables); open, let it settle; press Alt+3 twenty times (fold/open), then `b` and Mod+B twenty times; probe probes/NAV/burst.mjs
- Expected: a rail key answers within ~300 ms and does not get slower
- Actual: 1 MB: each press about 460 ms wall, longest long task 480-590 ms; 5 MB: fold or reopen 336-393 ms, `b` and Mod+B 260-340 ms. The queue drains and the window keeps answering; no press gets slower over four rounds of Alt+1/3/4/5 (0.4-1.2 s first, 60-120 ms after)
- Evidence: probes/NAV/burst-1.out, cycle-5.out, mine-5.out. Supersedes NAV-01 for the part that could be reproduced: the owner's freeze matches NAV-02 (one task of 7-9 s at 5 MB, 1.6 s at 1 MB, landing a moment after Links is first read, so on whatever panel key comes next), plus Export and Versions (CMD's panels: Alt+7 and Alt+8 first press stalled 2-10 s on 1 MB; rail clicks 6 and 7 timed out at 10 s on 5 MB; cycle-1.out, mine-5.out), plus opening the 5 MB file itself taking over 10 s (cycle-5.out step `open`, RDR's). Not found: listener or observer pile-up (row-window.ts:88 stops the old window on each draw); Search re-running a kept query on switch (key unchanged, no rerun; search-5.out); Places and Outline over 400 ms. A 20 MB Markdown file is not parsed by the store, so Links takes the cheap `pathMentionsIn` path there (62 ms). NAV-02 mentions a NAV-03 for the 20 MB curve: that is this finding
- Confidence: medium
- Found by: catcher panels, 2026-11-27
