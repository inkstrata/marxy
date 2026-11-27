# near-typeset: review (Opus)

Saved by the orchestrator, 2026-11-26.

Verdict: not ready. One must-fix (the builder's): two panes. Reviewer's own commit `0ca6b65f` (docs(typeset), comments only: three comments in `packages/typeset/src/index.ts` still described a quiet window that no longer exists).

**Must-fix: two panes.** All three IntersectionObservers (the 200% one, the new 500% `reach` and `onScreen`) are created with no `root`, so they measure against the window. With two panes the scroller is the pane's `section`, and the browser clips each observer's box to that pane: the margins come to nothing, the queue never refills around the reader, and a paragraph is set only after it has painted unset.
- Repro (scratch WebKit test, deleted): 195 KB, same document in two panes, 4 s quiet, then scroll the right pane 60 px per frame for 300 frames counting what each frame paints. Branch: an unset paragraph on screen in 107 of 300 frames; one pane 0; the base typesetter 0 in both layouts (its idle queue set the whole page).
- A far jump in a pane, then 1.5 s idle: 0 of 18 paragraphs set in the 3 screens above and 0 of 20 below; one pane 23/23 and 22/22.
- Fix: give the observers `root` set to the scroller when it is not the page, and rebuild them when it changes (`rebindScroller` does not relayout the typesetter). Add a two-pane count test.

**Checked fine**
- Selection and copy: a selection from a set paragraph into paragraph 300 (unset; 43 of 301 set) copies 49,586 characters, identical to the same selection after `setAll`.
- Find: count 1 of 3 with two far matches; next and previous cross the boundary and land on the reading line to the pixel; the paragraph is set and ranges stay connected.
- End on 1 MB: lands 0 px from the end and stays for 180 frames with no unset paragraph on screen; `setAll` then resolves.
- `typeset-idle` 12/12 with `gate-entry`: 195 KB and 1 MB hold 50 set once quiet, 50 after a new width.

**Mutations.** Putting back `keepPlace`'s input gate fails all four held-still tests (5, 13, 24, 20 jumps); the test counts frames, not time. Ignoring the `all` option fails the `all` test and two others (it cannot fail on master by definition; the branch mutation is its proof).

**Runs.** typecheck, lint, check 10/10 pass. Verify turn on `0ca6b65f` 10/12: the fast held-still test jumped 30 px once under load (3/3 alone, 2/2 in full near-file runs: load-sensitive); the `outline-rows` 20,000-headings test fails alone 3/3 on an idle machine (the builder said 8/8) and fails the same with every source file put back to `85606aba`, so it predates this branch (but not shown to predate geometry-table or master: see log).

**To file:** after a print or the gate calls `setAll`, the page stays "set everything", so every later width or theme change sets the whole page; `keep-place.test.mjs` comments still speak of a quiet window; `measure-typeset-idle`'s `doneMs` now means "near is set". Skipped step 6 is fine: nothing reads the estimate field and the ResizeObserver keeps heights true.
