# near-typeset: builder report (Sonnet)

Saved by the orchestrator, 2026-11-26. Checked: three commits on `agent/near-typeset` (cut from `agent/geometry-table` `85606aba`), worktree clean, verify log ends 11/12 (browser failed: one test, see below).

**Commits**
- `c61ea07e` feat(typeset): type is set where the reader is and elsewhere when approached; `setAll` and the `all` option set the page whole
- `f428f4f3` feat(view): print and the aesthetics gate set every paragraph; the block under the reading line comes from the table of block positions
- `3ccb7dcb` test(view): a long page, once quiet, has only what is near the reader set, at 195 KB and 1 MB, and after a new width

**For the reader.** Nothing visible. A long page is set only within 5 screens of the reader (the observer's 200% margin plus 3 more, X1's bounded queue; the brief's figure came out as this). Farther paragraphs wait in a `far` set watched by a second IntersectionObserver (500%) and join the idle queue as the reader nears. `done` and `typeset_done` mean "nothing near is unset"; `done` is a new promise when the reader moves and brings more near. `setAll()` and `all: true` set everything; the view and app handle gained `setAll`. Print (Export's PDF), the rag gate harness (`gate-entry.ts`) and `measure-typeset-idle --done` ask for it; HTML export needs nothing. A width or theme relayout reverts only what is set. `keepPlace` follows the reading line during scroll (input quiet-window gate removed; `overflow-anchor` stays none). Cost cut: a pass whose paragraphs all start below the reading line notes no place, and the block under the line comes from the table (`blockAtOffset`, passed as `blockAt`) checked against the page, instead of a hit test.

**Counts** (Edge, `measure-interactions`, 195 KB long reference vs wave-4 record `663a7f7f`; records in `work\wave5\near-typeset\`; the machine was loaded, compare counts)
- Open taskMs 1882 to 770; layouts 353 to 141; nodes 10080 to 8341. Tab back 2619 to 918 ms; Source to Read 370 to 315.
- Set paragraphs once quiet (WebKit app test): 195 KB 50 of 1259 (master 1372, all); 1 MB 50 of 6596 (master 7189); after a pane-width change 50 and 50. Count does not grow over 2.5 s idle.
- Cost moved to scrolling: cursor key layouts 4 to 5, recalcs 5 to 8 (taskMs 23 to 32).
- 1 MB open: taskMs 78,620, layouts 2,667. Target NOT met: it is the progressive mount's forced layout per chunk (X1 found 47%), untouched here; needs its own branch.

**Tests.** Verify turn 11/12: typeset unit 100, desktop unit 1270, desktop-browser 44, scripts 271; browser 329 pass, 1 fail (`outline-rows` 20,000-headings test timed out under load; passes alone 8/8). New `packages/typeset/test/near.test.mjs`, 10 tests (bounded open; scrolling sets on-screen paragraphs and reopens done; `setAll` equals a whole pass; `all` option; far adoption waits; width change; held-still at slow/medium/fast/drag, counting frames where the block under the line moves over 2 px); new typeset-idle tests at 195 KB and 1 MB. Revert proof (typeset `index.ts` from `85606aba`): 9 of 10 near tests fail (jumps 5/13/24/21 at the four speeds, worst 30-60 px; set 324 of 492; `setAll` missing); desktop idle tests fail (1372 of 1259 set). The `all` option test passes on master (it ignores the option): no proof. Existing tests updated to say "all" (typeset, grid-sizes, unused-work, typeset-idle, typeset-view) or the new rule (keep-place wheel, key and pane tests now assert no movement during input).

**Not done or not verified.** Step 6 (table notes which blocks hold unset paragraphs). Not tested: a selection spanning set into unset paragraphs, find while partly set, the end pin, two panes beyond the mapped suites. The first pass that finds the page left the top before its scroll event still does not compensate (existing, documented in the test). WebView2/Chromium not run for the held-still test (WebKit only). The keep-place "markers written above" test fails alone, also on master; passes in the full file.

**Calls.** Dropping the input gate means a pass compensates during a wheel or drag (X2's D, as instructed). D's read cost on drag not measured in frames; cut structurally, tested for jumps only.
