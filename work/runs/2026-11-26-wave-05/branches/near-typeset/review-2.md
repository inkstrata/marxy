# near-typeset: delta review (Opus)

Saved by the orchestrator, 2026-11-26. Delta read: builder fix `7f622b6f` and the merge `801500c8` of the geometry-table fixes. Reviewer's own commits `ae247164` and `0a9eeb68` (tests). Tree clean at `0a9eeb68`.

Verdict: ready after the reviewer's fix; one flaky test to file.

**Two-pane repro, rerun** (195 KB, same document in both panes, right pane scrolled 60 px per frame for 300 frames, then a far jump and 1.5 s idle). At `801500c8`: 0 of 300 painted frames show an unset paragraph; after the jump 20/20 set in the three screens above and 19/19 below. At `801500c8` with `root` removed: 107/300, and 0/19 above and 0/19 below: the earlier failure exactly, so the fix works.

**Why the builder's tests passed without the fix.** The pane does clip the observers in WebKit; the tests looked at the wrong moment: they read the page one frame after each scroll, but the observers report after the paint, so the paragraph was already set and the frame that showed it unset was missed (the reviewer made the same mistake in a first probe). The near test's jump landed about three screens down, inside what the first pass had queued.

**Test fixes.** The pane tests and the app-level two-pane test now read after the scroll and before the paint; the jump lands past ten screens; the pane tests run the idle queue as the app does (with it never running, one frame slipped under load). Mutation: `root` removed fails all three near pane tests (32 and 21 bad frames; 0/3 and 0/6 set either side) and the app test (49 painted unset); `scrollerChanged` a no-op fails its test (21 bad frames). Added: after `setAll`, a new width sets only what is near (12 of 492 set); taking the once-only behaviour out fails it (320 set).

**Runs.** `outline-rows` alone 8/8. Verify turn against master 12/13: browser 753/753, desktop-browser 44/44; the one red was the `scrollerChanged` test (1 bad frame), fixed in `0a9eeb68`. After that, the typeset suite 101/103 once, 103/103 next; the near file alone 13/13. The whole verify turn was not rerun after `0a9eeb68`.

**To file.** The held-still test (medium and fast) fails sometimes when the typeset suite runs whole: 2 of 103 once, plus 1 in the first verify turn; 3/3 alone. It counts frames, not time, but is still load-sensitive.
