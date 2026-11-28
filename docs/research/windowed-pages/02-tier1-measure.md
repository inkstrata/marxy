---
corpus: windowed-pages
id: 02
slug: tier1-measure
prefix: TIR
title: Tier 1 measured - content-visibility on every block, with the typesetter and the grid pass
researched: 2026-11-27
confidence: medium
volatility: high
status: active
keywords: [content-visibility, contain-intrinsic-size, WebKit 26.6, Chromium 153, typesetter, grid pass, Range rects, forced relayout, find]
---

# Tier 1 measured: `content-visibility: auto` on every top-level block

## Abstract

Tier 1 is tested as a stylesheet injected over the unchanged app: every top-level block of the page gets
`content-visibility: auto` and `contain-intrinsic-size: auto <estimate>px`, the estimate taken from the block's byte
range in whole grid units (15 px), over the real progressive mount, typesetter, grid pass and find. It was run on
Playwright WebKit 26.6 (stand-in for WKWebView) and Chromium 153.0.8010.12 headless shell (stand-in for WebView2)
on 0.25, 1, 2 and 4.9 MB of generated Markdown. WebKit does skip the work (it fires the state-change events, a
page whose blocks have no intrinsic size collapses to a fifth of its height, and a forced relayout of the whole
article falls 8x at 4.9 MB). But the app's typesetter silently stops typesetting the skipped paragraphs in WebKit:
it measures text through Range rects, which WebKit returns empty for skipped text, and it still reports the page done.
In Chromium the typesetter works, but typesetting every paragraph through skipped blocks costs more, not less: main
thread time to done rose 1.96x at 1 MB and 1.27x at 2 MB. Scroll cost and cursor-key cost did not change.

## TL;DR

- **WebKit: no-go for tier 1 as the only measure.** The skipping is real, but the page ends up with unset
  paragraphs (14 of 5,726 at 2 MB, 858 of 2,864 at 1 MB) and never recovers (the unchanged count is measured), because `typeset_done` still fires
  and scrolling a block into view does not queue it (TIR-02, TIR-03; this reading is from `index.ts`, where the queue empties and the observer is dropped whether or not a paragraph was set, not traced in a run, `[likely]`). Tier 1 with the typesetter unchanged breaks the
  look of the page.
- **Chromium: works, but gains nothing the app needs and costs open time.** All paragraphs get set and the grid
  stays whole (0 off-grid block tops), yet task time to done is 4.5 s to 8.8 s at 1 MB and 17.0 s to 21.5 s at 2 MB
  (TIR-04). Scroll, key and find are unchanged (TIR-05, TIR-07).
- **The one clear WebKit win is whole-article relayout:** 53 ms to 8 ms at 1 MB, 197 ms to 24 ms at 4.9 MB (TIR-06).
  Chromium's relayout is 1.2 to 6 ms with or without it.
- **Estimates:** from byte length, paragraphs come out within 0.88 to 1.33 of the real height (median 1.00);
  headings, tables and lists need their own rule (TIR-08). A missing intrinsic size is a hazard: the page collapses
  (TIR-09).
- The recommendation is to go to tier 2 (mount near the viewport, typeset by distance) for the page, and to keep
  `content-visibility` only as a cheap addition on mounted far blocks if the typesetter is first taught to treat
  "skipped" as "not yet measurable" (Options).

## Recommendation

| Engine | Verdict | Why (finding) |
|---|---|---|
| WebKit (WKWebView) | **No-go for tier 1 as it stands.** Go only after the typesetter and the find's start position stop reading Range rects of skipped text. | Unset paragraphs and a false `typeset_done` (TIR-02, TIR-03); relayout win is real (TIR-06) but not what the page needs |
| Chromium (WebView2) | **Viable but not worth it alone.** Works unchanged, costs open time. | All set, grid intact (TIR-03); open work up 1.3 to 2x for prose and 4.3x for `md-technical` at 1 MB (TIR-04); no scroll or find gain (TIR-05, TIR-07) |

The direction the owner approved (one model, mounting policy depends on size) is supported: tier 1 does not remove
the need to mount fewer nodes, because the typesetter's reads force the skipped blocks anyway in Chromium, and
because in WebKit they return nothing. Mounting by distance avoids both.

## Setup

Probe: `probes/tier1/tier1-probe.mjs` (a copy of the script run from `scripts/` of an app worktree at origin/main of
2026-11-27), matrix runner `probes/tier1/run-matrix.sh`, table builder `probes/tier1/summarize.mjs`, all numbers in
`probes/tier1/*.json` and `probes/tier1/summary.txt`. The app is booted over the memory shell exactly as the
typesetter idle probe does; the stylesheet is added with `page.addStyleTag` before the app starts, so the app source
is untouched. The probe is Playwright, so `--browser msedge` runs the same steps on Windows against the installed
Edge (the Chromium path of WebView2); it has not been run on a real WebView2 or WKWebView.

Modes: `off` (no rule), `bytes` (rule plus a per-block estimate set from `data-marxy-e - data-marxy-s` in a
MutationObserver, cost under 1 ms to 6 ms in the open), `tag` (fixed 150 px, headings 90 px), `nosize` (no intrinsic
size). Estimate: lines = bytes / 85 for paragraphs (40 for code, 30 tables, 50 lists, 70 quotes, headings 2),
2 grid units per line plus 2 for the gap, rounded up to 15 px.

Measuring. WebKit has no CDP, so for WebKit the numbers are in-page: `performance.now()` around steps, a forced
layout plus two frames per scroll (wall), and "script ms", the time spent in rAF/idle/timer/message callbacks
(which misses layout done outside callbacks, so it under-counts). Chromium additionally reports CDP
`Performance.getMetrics` (`TaskDuration`, `LayoutDuration`), which is the number used for Chromium task time.
Engine versions: WebKit 26.6 (Playwright 1.63.0, webkit-2359), Chromium 153.0.8010.12 headless shell. Machine: 10 CPUs,
macOS, one browser at a time; load average at run start and end between 1.7 and 12.2 across files (the other vectors
ran at the same time). So wall times are inflated and noisy; task and script ms are steadier. Runs: 3 each at 0.25 MB,
2 at 1 MB, 1 at the rest; numbers are medians. The 4.9 MB rows, the 6,972 ms find time, the 4.9 MB scroll comparisons and the 2 MB slowdowns are each one run, so weak evidence. A step cap (120 s per page call, 180 s wait for the typesetter) turns a
stall into a result. Shapes from `scripts/lib/big-files.mjs`: `md-prose` (3,103 blocks at 1 MB), `md-technical`, `md-dense`.

## Findings

### TIR-01 · WebKit really skips off-screen blocks, and Chromium does too  [measured]

With a rule on every block, WebKit fires `contentvisibilityautostatechange` about once per block at open
(0.25 MB: 836 skipped and 70 shown events for 776 blocks; 1 MB: 3,147 and 54 for 3,103; 4.9 MB: 15,241 and 54 for
15,197) and Chromium does the same (1 MB: 3,251 and 169). With `nosize` the skipped blocks lose their content height:
the article's scroll height falls from 137,100 px to 31,500 (Chromium) and 20,670 (WebKit) at 0.25 MB, which is the
height of the margins and padding alone. A skipped block's own rect stays the intrinsic size (120 px for a paragraph
in the probe), with 0 zero-height rects among the blocks in every `bytes` and `tag` run.
Relayout of the whole article (a 1 px padding change read back with `offsetHeight`) is the cleanest sign of work not
done (TIR-06). `Element.checkVisibility({contentVisibilityAuto: true})` returned true for blocks the events said were
skipped, in both engines, so it cannot be used to ask whether a block is skipped. Probe: `tier1-probe.mjs`, files
`webkit-md-prose-*mb-bytes.json`, `*-nosize.json`.

### TIR-02 · In WebKit the typesetter silently leaves skipped paragraphs unset, and reports done  [measured]

At 0.25 MB with the byte estimates only 14 of 716 paragraphs carry `marxy-set` when `typeset_done` is marked at
about 0.5 s (off: 716 of 716 at 1.8 s). The count does not move after scrolling to the middle and the end: still 14.
Other sizes: 1 MB 858 of 2,864; 2 MB 14 of 5,726; 4.9 MB 9,202 of 14,028; `md-technical` 1 MB shows 2,679 set elements against 2,700 without the rule (the counter is every `.marxy-set` in `#doc`, not paragraphs, so it cannot show that all 2,300 `p` were set; at most 21 elements are missing and which ones is not known). A
paragraph scrolled to the centre of the screen was still unset afterwards (`skippedProbe`, 0.25, 1 and 2 MB).
The Range read is visible in a direct measurement (the link from it to the unset paragraphs is `[likely]`, inferred from the code): on a skipped paragraph, `Range.getClientRects()` over its first characters
returned 0 rects and a 0 px width on the first read, then 1 rect and 35 px on the next read in the same task (the read
itself ends the skip), while `getBoundingClientRect().height` was the intrinsic 120 px both times. The typesetter
reads token positions from Range rects (`packages/typeset/src/measure.ts`, the "measured as positions" comment), so a
first read of nothing is a failed measure; the pass moves on and the queue ends. I did not step through the
typesetter to prove which line drops the paragraph; the measured effect is that no re-queue happens, and the set count is
not stable across sizes (14, 858, 14, 9,202), which is what an order-dependent read would give. This is the case the
brief's review warned of ("code reading positions treats zero rects as not shown"), in the typesetter rather than in
position keeping. Probe files: `webkit-md-prose-*mb-bytes.json` (`settle.set`, `setTrace`, `skippedProbe`).

### TIR-03 · In Chromium all paragraphs are set and the grid pass stays whole  [measured]

Chromium sets every paragraph under the rule (716 of 716, 2,864, 5,726 at 0.25, 1, 2 MB; 7,036 to 7,501 of 14,028 at
4.9 MB when the 180 s cap stopped it, against 12,948 of 14,028 for the same cap without the rule). Its Range reads of
skipped text return real rects (1 rect, 35 px on the first read), so the typesetter's measures are valid. On both
engines the block tops stay on the 15 px grid in `md-prose` (0 off-grid tops among 776 to 15,197 blocks, read after
the whole run, back at the top). The `md-technical` page has 400 off-grid tops of 4,550 blocks with and without the rule,
so that is not a tier 1 effect. The grid pass reads `getBoundingClientRect().height` of every island and the top of
every child in rounds (`packages/typeset/src/grid.ts`); with the rule these are the intrinsic sizes for skipped
blocks. Because estimates in the probe were multiples of the unit, the grid pass found real and estimated tops equal
for blocks whose estimate was right; where the estimate is wrong the pass pads a skipped block against the estimate,
and the block's real height appears when it is shown (TIR-08), so the page is on the grid only if estimates are
corrected by whole units. The probe did not scroll through every block after the pass to count how many tops moved off
the grid, so that remains open (Open questions).

### TIR-04 · Open task time to quiet: worse in Chromium, only apparently better in WebKit  [measured]

Main-thread task time (Chromium CDP `TaskDuration`, from before the app starts to `typeset_done`) and, in brackets,
layout time:

| md-prose | off | rule with byte estimates |
|---|---|---|
| 0.25 MB | 631 ms (59) | 709 ms (184) |
| 1 MB | 4,505 ms (543) | 8,821 ms (3,543) |
| 2 MB | 16,968 ms (2,118) | 21,495 ms (9,814) |
| 4.9 MB | 180,377 ms, not done, 12,948 of 14,028 set | 180,044 ms, not done, 7,036 of 14,028 set |

The typesetter reads the text of each paragraph, which ends the skip, then the paragraph is skipped again once it is
out of view and the next read lays it out again; layout time grows about 6x at 1 MB. Time to first text and to content
complete are the same with and without the rule in both engines (Chromium 1 MB: 542 vs 517 ms first text, 692 vs
706 ms complete; WebKit 1 MB: 1,168 vs 1,046 and 1,759 vs 1,518 ms, within the noise).
For WebKit, wall time to `typeset_done` falls (1 MB 11.5 s to 6.2 s; 2 MB 17.7 s to 3.5 s; 4.9 MB 104.8 s to 79.1 s) and
script time falls with it (13,513 to 5,733 ms at 1 MB; 20,403 to 1,798 ms at 2 MB), but that is the work not done in
TIR-02: 14 to 858 paragraphs set at 1 to 2 MB. It must not be read as a speed-up. The page is quiet because the queue
gave up. `md-dense` at 1 MB (61,288 blocks) stalled before it could be compared: without the rule it was still
not done at the 180 s cap in both engines; with the rule, WebKit stalled in the open for over 120 s and the Chromium run
had to be killed after about 35 minutes by file times in a single page step (before the step cap existed), so it is a stall, not a number. Left out above: Chromium `md-technical` at 1 MB went from 5,276 to 22,875 ms of task time (4.3x, layout 636 to 8,342 ms), the largest slowdown in the data, so the 1.3 to 2x range is for `md-prose` only.

### TIR-05 · Scroll and cursor-key cost do not improve  [measured]

After the typesetter has finished or given up, a scroll from the top to the middle or the end, forced to layout plus two
frames, costs no less with the rule than without in both engines (several rule cells are higher), and at 4.9 MB it is not lower either:

| Wall ms, median of the runs (2 at 1 MB, 1 at 2 MB and 4.9 MB) (script ms) | off | rule |
|---|---|---|
| Chromium 1 MB, mid / end | 9 / 12 | 17 / 11 |
| Chromium 2 MB, mid / end | 33 / 11 | 33 / 23 |
| WebKit 1 MB, mid / end | 30 / 29 | 28 / 42 |
| WebKit 2 MB, mid / end | 56 / 56 | 52 / 67 |
| WebKit 4.9 MB, mid / end | 73 / 78 | 108 / 124 |

A cursor key (`j`, median of 5): Chromium 1 MB 11 vs 9 ms, 2 MB 20 vs 20 ms; WebKit 1 MB 40 vs 41 ms, 2 MB 40 vs 27 ms,
4.9 MB 38 vs 35 ms. These are wall clock on a loaded machine; Chromium CDP task time per scroll is 10 and 34 ms at 1 MB
(off and rule) and 38 and 69 ms at 2 MB, both small. The measure-scale figures of 0.1 to 0.3 s per key at 1 MB (see
DOM-03 in the large-files corpus) are during the typesetting; once it ends, scrolling is cheap with or without the rule, so
tier 1's scroll benefit lies only in the minutes while typesetting runs, and there the rule changes what the typesetter
does (TIR-02, TIR-04). At 4.9 MB Chromium never got quiet in either mode within the cap, so its scroll and key numbers
there (400 to 870 ms, CDP) are during typesetting and say nothing about the rule.

### TIR-06 · A forced relayout of the whole article is 5 to 8x cheaper in WebKit and unchanged in Chromium  [measured]

One 1 px padding change on the article and a read of its height (median of 5, ms):

| | 0.25 MB | 1 MB | 2 MB | 4.9 MB |
|---|---|---|---|---|
| WebKit off | 11 | 53 | 80 | 197 |
| WebKit rule | 2 | 8 | 11 | 24 |
| Chromium off | 0.4 | 1.2 | 2.7 | 6.2 |
| Chromium rule | 0.4 | 1.3 | 2.6 | 5.2 |

This is the evidence that WebKit does not lay out skipped blocks, and it is the number that matters for the grid pass
(each forced layout of the article was about 100 ms at 1 MB of dense blocks, per the brief). It does not change what the
grid pass has to read. Chromium's relayout was already cheap here because the change did not invalidate every block's
layout, so this probe does not show a Chromium gain; the width-change costs of the brief (0.15 to 0.45 s at 1 to 3 MB)
were not repeated.

### TIR-07 · The app's own find: counts are right everywhere, the starting match and cost vary in WebKit  [measured]

Searching `the` returns the same total with and without the rule (5,249 at 0.25 MB; 21,001 at 1 MB; 41,984 at 2 MB;
102,872 at 4.9 MB, Chromium and WebKit, both modes). Find walks text, not geometry, so skipped blocks do not hide matches.
The current match differs: WebKit 0.25 MB with `bytes` or `tag` starts at "27 of 5,249" against "2,591 of 5,249" without
(a reading position that follows geometry fell back to the top; with `nosize`, "1,349"), where 1 MB, 2 MB and 4.9 MB
started near the middle. Chromium started within a few matches of off (identical at 0.25 MB; 1 MB 20,949 vs 20,961, 2 MB 41,947 vs 41,932, 4.9 MB 102,815 vs 102,813, near the end rather than the middle). Time from keystroke to a settled count (wall ms,
loaded machine): WebKit 0.25 MB 663 off, 585 rule; 1 MB 771 off, 888 rule; 2 MB 858 off, 1,536 rule;
4.9 MB 1,276 off, 6,972 rule (single run). Chromium 1 MB 757 off, 751 rule; 4.9 MB (still typesetting) 1,514 vs 1,287.
A step (`Enter`) costs 0 to 5 ms of script in WebKit in `md-prose` up to 2 MB (15 to 41 ms in `md-technical`) and 0.4 to 6.2 ms in Chromium in `md-prose` (9 to 13 ms in `md-technical`), with or without the rule.
The WebKit slowdown from 2 MB up is from one run each; I did not isolate its cause (`[likely]`; the timings are `[measured]`, single runs), but the find draws highlight rects
by Range rect, which is empty for skipped text.

### TIR-08 · Byte-length estimates are good for paragraphs and wrong in a fixed way for the rest  [measured]

Ratio of estimate to real height (off-run, every block real): paragraphs p10 0.88, median 1.00, p90 1.33 (2,864
paragraphs at 1 MB; sum 472,560 est vs 486,900 real, 3 % under). Headings: 3.0 for h2 and h3 (estimated as two
line boxes, real one grid unit of 30 px, so 90 px against 30), 2.0 for h1. `md-technical`: tables 1.7 (p10 1.36, p90
2.03, which WebKit gives as 1.97; 2.03 is presumably Chromium), ordered lists 1.25, unordered 1.18, rules (hr) 0 real height against 60 estimated, paragraph p90 2.0
(442,500 est vs 259,500 real for the tables). Whole-page scroll height with the rule at done: 547,905 px (Chromium
1 MB, equal to off), 547,845 (WebKit), against 547,905 real; so for prose the sums come out within about 0.011 % even though
single blocks are off by a third; this is because the probe's estimate is applied and then replaced by the real height as
each block is shown and remembered (`auto`). The estimates need a rule per element type, not one rule. Estimates in
whole units keep the grid pass's input on the grid; the correction when a block is shown is what moves the page
(corrections of up to ±15 px per block with a median near 0); the reading-position keeping that prevents the jump is
the subject of vector 06.

### TIR-09 · Without an intrinsic size the page collapses and the grid pass reads zeros  [measured]

`content-visibility: auto` alone (`nosize`): scroll height 31,500 px (Chromium) and 20,670 px (WebKit) at 0.25 MB against
137,100 px; at the instant of the probe a skipped paragraph had a rect of height 0 (`h: 0`, `offsetH: 0`). The grid
pass would read 0 for every skipped block's height, and any code that treats a zero rect as "hidden" would take the
blocks out (the brief's warning about `content-visibility: hidden`). The estimate is not an optimisation but the
condition for geometry to exist. Reading skipped blocks' own rects is safe (non-zero, intrinsic) in both engines, so
the geometry table can still be fed from them, but text rects inside them cannot, in WebKit, on a first read (TIR-02).

## Options compared

| Option | WebKit | Chromium | Verdict |
|---|---|---|---|
| A. Rule on every block, typesetter unchanged | unset paragraphs, false done | works, open work 1.3 to 2x for prose (4.3x for `md-technical` at 1 MB) | reject |
| B. Rule, and the typesetter stops reading Range rects of skipped text (queue by distance, force by scrolling the block in, or read text before the skip) | relayout win, no unset paragraphs if fixed | the extra layouts of TIR-04 remain unless text is read only near the viewport | possible; the fix is tier 2's typeset-by-distance in any case |
| C. Tier 2: mount blocks near the viewport only, typeset by distance; the rule on mounted far blocks optional | avoids both failures; gain is node count, not skipping | same | recommended |
| D. Rule only for relayout (grid pass over a mostly-skipped page), page set by hand | 5 to 8x relayout win | no gain | only after B |

The measured case for C is the typesetter's own reads: it touches all paragraphs, which in Chromium ends the skip and
in WebKit returns nothing. Neither engine lets the CSS rule stand in for not mounting.

## Open questions

- Does the grid pass, after the real height of a block replaces its estimate, move later blocks off the 15 px grid until
  the next pass? The probe read tops only after the whole run; a scroll-by-scroll count of off-grid tops was not made.
- Why the typesetter drops WebKit paragraphs without a retry: confirm in `measure.ts` and the queue with a stepped trace;
  would an `await` for a frame before reading help (the second read in the same task did return a rect)?
- WebKit find slowdown at 2 and 4.9 MB (one run each): repeat with 3 runs and isolate highlights versus walk.
- Real WKWebView and real WebView2 were not run: Playwright WebKit 26.6 stands in for macOS 26 only; WKWebView on macOS 13
  to 15 has older `content-visibility` support (vector 05). `--browser msedge` in the probe runs the Windows check.
- `md-dense` (61,000 blocks at 1 MB) could not be opened inside the caps in either mode; the node budget (vector 03)
  needs it as its own case.
- Measuring with CDP `Overlay`/trace categories in Chromium for the number of laid-out objects, to count skipped work
  directly rather than by relayout time.

## Cross-links

Vector 01 (code that reads geometry: the grid pass and typesetter reads are named above); vector 03 (node budget; the
dense page); vector 05 (engine support, `checkVisibility` behaviour, `content-visibility` bugs by WebKit release); vector
06 (estimates and anchoring, TIR-08); vector 09 (typeset by distance: the typesetter must treat a skipped paragraph
as "not yet measurable"); large-files corpus DOM-03, TYP-01, D-01.

## Sources

No web pages were fetched for this chapter; every finding is a measurement by the probes in `probes/tier1/`.

- `probes/tier1/tier1-probe.mjs`, `run-matrix.sh`, `summarize.mjs`; outputs `summary.txt` and `{webkit,chromium}-md-<kind>-<size>mb-<mode>.json` (and their `.log`), run 2026-11-27.
- App source read: `packages/typeset/src/grid.ts` (grid pass reads and `overflow-anchor: none`), `packages/typeset/src/measure.ts` (measure by Range positions), `apps/desktop/src/find/view.ts`, `packages/theme/src/base.css` (existing `content-visibility: auto` in log pieces).
- Engines: Playwright 1.63.0, WebKit 26.6 (webkit-2359), Chromium 153.0.8010.12 headless shell.
