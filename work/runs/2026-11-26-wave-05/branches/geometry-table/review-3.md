# geometry-table: delta review after the outline fix (Opus)

Saved by the orchestrator, 2026-11-26. Read only `4eae7045` and `f7882571` (tip). Verdict: ready at `f7882571`; no changes, tree clean.

- Six files pass, run two at a time: outline-rows and persist-reading 23/23; block-geometry and scroll-persistence 11/11; place-across-modes and keep-place 16/16.
- The new table test fails without the fix (`opts.onMoved` disabled: "readers were last told [133064], the page reads 132126"); the other 4 pass.
- No loop or double-fire: re-notifying runs no `onScrollerScroll`, so it cannot set `scrolledSinceMoved`; one queued frame at most (`movedFrame`); crumbs listen twice but `queueChain` merges them into one draw a frame.
- Callbacks, WebKit, 120 scripted scroll frames: 195 KB while being set 140 for 120, never more than 2 in a frame; settled 120 for 120; 20,000-heading document while mounting 240 for 120 (one extra round a frame, cheap table reads, no layout; not measured settled: still mounting after 90 s, waiting timed out at 600 s).
- Saved place: reading-persistence samples next frame; the re-notification can make it note a stale place then the corrected one, and the last note is the page's true place. Master only saved what the scroll read.
- near-typeset has this merged (`801500c8`); its keepPlace listens to scroll events itself and reads the page, so a re-notification (no scroll event) cannot count as scrolling.

To file: the queued frame is not cancelled on destroy (harmless: checks `shown`, listener set cleared); while a long page keeps growing under a scroll the place's readers run twice a frame.
