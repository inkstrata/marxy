---
corpus: windowed-pages
id: 09
slug: typeset-distance
prefix: TBD
title: Typesetting by distance, and getting a target typeset on demand
researched: 2026-11-27
confidence: medium
volatility: low
status: active
keywords: [typesetter queue, Knuth-Plass cost, grid pass, jump to heading, print, beforeprint, pdf.js rendering queue, content-visibility relevant to the user]
---

# 09 · Typesetting by distance, and getting a target typeset on demand

**Abstract.** What one paragraph costs to set, what the baseline-grid pass needs from the blocks above, how the
typesetter's queue is ordered today and how it should be ordered once only blocks near the reader are mounted, and how
jump-to-heading, in-page anchors and print get their target set. Code read: `packages/typeset/src/` and the app's call
site. One Node micro-benchmark of the line breaker. Existing records cited, none rerun; no browser used.

## TL;DR

- Line breaking is not the cost: 0.01 ms for a 40-word paragraph, 0.8 ms for 1,000 words (TBD-01). The cost is
  reading the paragraph's native layout token by token through Range rectangles, and the layout that follows every batch
  (TBD-02).
- The grid pass is local once the origin read is changed (step 2 reads each top relative to the article's origin, `grid.ts:123`). Every block's padding is decided from its own height and the block before it; a block
  far down can be snapped without the blocks above being set, provided the blocks above have heights that are whole grid
  units, which an unset text block does by construction (TBD-03, TBD-04).
- An unset block is the right size for the table, give or take a line: setting rarely changes a paragraph's line count,
  and when it does, the change is whole units (TBD-05).
- Today's queue is outward by element index, alternating below and above, plus an IntersectionObserver with a 200%
  margin. It has no direction and no on-demand call. The earlier near-typeset build showed what bounding it buys and
  what it breaks (TBD-06, TBD-07).
- Print needs no typesetting of anything far away: by code reading (no print was run, `[likely]`), set paragraphs are `nowrap` with explicit breaks at the screen's
  width, which is wrong at paper width whether or not the paragraph was set early (TBD-09).

## Recommendation

1. **Fold typesetting into mounting.** In the windowed design a block is mounted and set together, or mounted unset;
   there is no separate whole-page queue. The queue is the mount queue with a typeset step.
2. **Priority function** (replaces the alternating index walk): rank by distance in grid units from the reading line to
   the nearest edge of the block, with `0` for blocks on screen; blocks in the direction of the last scroll count
   half their distance (about 2:1 forward bias, after pdf.js's rule that the page after the visible ones, in the scrolling
   direction, comes next); blocks that a pending jump, find match or selection names get distance 0. In-view blocks are set
   in the task, before paint; the margin goes in idle slices as today (TBD-06, TBD-08).
3. **On-demand API: one function, `typesetThrough(target)`.** It takes a block (or a block and a byte offset), mounts it
   and its neighbours (the geometry table supplies the range), sets the paragraphs in that window in one batch, runs the
   bounded grid pass over the window (`from`/`through` already exist), and resolves. Jump-to-heading, in-page anchors,
   find's "next match" and outline clicks call it, then scroll by block plus byte offset (TBD-08). `setAll()` is not
   needed by any caller below the node budget and must not be built for print (TBD-09).
4. **Print:** do not typeset for print. Revert every set paragraph to native wrapping for the duration of the print
   and mount every block in the printed range; let the engine wrap at paper width. Typesetting at paper width is a later
   option (TBD-09).
5. **Estimates:** estimate an unset text block as native line count times the line box, in whole units, from the table;
   do not model the breaker (TBD-05).

## Findings

### TBD-01 · The line breaker costs 0.01 to 0.8 ms a paragraph; it is not the bottleneck  `[measured]`

`breakRagged` is a Knuth–Plass total-fit breaker with a prefix-sum width table and a look-back that stops at the first
line that overflows (`packages/typeset/src/ragged.ts`, `pass`); hyphenation points are tried only if a first pass
without them leaves a line worse than the tolerance. I ran it on synthetic token lists (random word widths, 640 px
measure, 16 px font; Node 24.22.3, `--experimental-strip-types`, Apple Silicon M5 laptop, after a 20-paragraph
warm-up, 200 paragraphs by 10 repetitions for the small cases and 20 by 10 and 3 by 3 for the large ones; script in the
session scratchpad, not kept, so this table cannot be reproduced):

| Words | Tokens | ms per paragraph | Lines |
|---|---|---|---|
| 40, no hyphens | 79 | 0.010 | 2.7 |
| 40, hyphens | 113 | 0.022 | 2.7 |
| 120, hyphens | 349 | 0.085 | 8.7 |
| 300, hyphens | 827 | 0.237 | 22.4 |
| 1,000, hyphens | 2,863 | 0.786 | 76.7 |

Growth is close to linear, as the large-files corpus expected of it (TYP-01). The typesetter's own cap, `MAX_SET_CHARS`,
keeps the worst paragraph out of reach. Synthetic widths are cleaner than real ones, so read the table as a floor; the
order of magnitude holds. A bound on the breaker would not be worth a design decision.

### TBD-02 · The cost is the native-layout read and the layout after it  `[confirmed]` (where) / `[likely]` (how much)

`measureTokens` (`measure.ts`) does not use canvas: it reads every token's first character with `Range.getBoundingClientRect()`
from the paragraph's real text nodes "in their native layout" (the file's own words), so that kerning, optical size
and variation settings are in the number. That is two Range rectangles for most tokens, in a layout the engine must
have computed, one scratch `Range` shared per document so WebKit's mutation walk stays cheap. A batch is built to need
two layouts however many paragraphs it holds: read all, write all breaks, read the overflow check, revert failures
(`setBatch` in `index.ts`). The queue's own comment records the second cost: "Each slice is followed by a layout of the
whole article before the next can run, a cost that grows with the page and not with the slice" (`IDLE_SLICE_MS`). That
is why slices of one or two paragraphs took 105 to 145 s for a 1 MB page and slices of 24 ms took about 85 s.

Per-paragraph figures that exist: the code seeds its estimate at 4 ms a paragraph and floors it at 0.25 (`perParagraph`,
`index.ts`), and learns it with an exponential average; an older audit saw 0 to 27 ms for the viewport pass on 53 KB
(TYP-03); the brief's records put a whole 1 MB page (6,600 to 7,200 paragraphs) at 22 s of main-thread time in
Chromium and 42 s in WebKit, which includes the progressive mount, so the set cost is at most 3 to 6 ms a paragraph
and falls with page size only if the layout after each batch is made smaller. Setting the few paragraphs on screen
costs tens of milliseconds, an order the reader does not notice; setting a whole page costs seconds to tens of seconds.
This is the case for typesetting by distance and is already a decision of the earlier corpus (D-04).

### TBD-03 · The grid pass depends on the block above through whole-unit tops, but step 2 is origin-relative, so it is local only once that read changes  `[confirmed]`

`snapToGrid(article, lineBox, { from, through })` (`grid.ts`) does two things. Step 1 pads each *island* (`pre, table, img,
math`) to a whole number of half-line-box units, from that island's own height: nothing above it enters. Step 2 reads
the top of each block child relative to the article's origin and pushes the *previous* block down by the difference to
the next grid line, because "text blocks sit on the grid by CSS construction" (`base.css`: `line-height: var(--lb)`,
margins in whole units). A bounded pass undoes, pads and reads only the block before `from`, the blocks `from`..`through`
and the one block after; `snapBlocks`, `snapInSlices` and `snapChanged` already run it over runs of changed blocks. So
the answer to the crucial question is yes, with one condition: a block far down can be snapped without the blocks above
being set, **if every block above ends on a grid line**. What step 2 measures is a top minus the article origin; if
the blocks above are unmounted and stand in as placeholders whose heights are not whole units, every top below them is
off the grid and a naive pass pads the wrong block by the remainder.

Implication for the table: placeholders have whole-unit heights (the brief's direction already says so), and a bounded
pass should compute remainders against the block's own predecessor in the window, not the article origin. Part
of this pass is already written as a window; the origin-relative read is the piece to change.

### TBD-04 · A set paragraph keeps the unset paragraph's top and its margins; nothing above it moves  `[confirmed]`

Setting writes empty `<span class="marxy-lb">` elements and `white-space: nowrap` on the paragraph (`apply.ts`,
`base.css` `.marxy-set`); no margin, padding or font property changes. The paragraph's height changes only if the line
count changes. `setBatch` reads each candidate's height before and after and reports `moved` only if it changed by
0.5 px or more, and asks for a grid pass only for a batch that moved (`opts.onPass('background', ...)` in the step).
The code's own comment states the expectation: "a set paragraph almost always keeps its native line count". So
setting a block far down changes nothing above it, and nothing below it unless the line count moved.

### TBD-05 · Unset and set heights agree in grid units except where the breaker changes the line count  `[likely]`

The engine wraps greedily; the typesetter minimises raggedness over the whole paragraph and may hyphenate, so a
paragraph whose last line is nearly full can gain or lose a line. The aesthetics harness records this: "The breaker may
change a line count (14-marxy-plan at 960/1280)" (`apps/desktop/src/harness/layout-shift.ts`), and the earlier corpus
saw that 618 native lines became 648 when widths were summed instead of read as positions (the comment in `measure.ts`,
fixed). I did not measure how often the line count differs in real prose; the harness evidence is that it does, rarely.
Consequence for estimates: a paragraph's height is `lines × line box` in whole units, with `lines` from the native
wrap, so an estimate from character counts and width is off by the wrap model's error (the estimates chapter's
subject), and setting adds a second, smaller error of 0 or ±1 line on a few paragraphs. A correction applied below the
reading line needs no scroll move (the grid pass already handles below-line changes); one above the line must be
held by the block-plus-offset anchor. Do not try to predict the breaker's line count; it needs the measurement it is
meant to replace.

### TBD-06 · The queue today is outward by element index, with no scroll direction and no on-demand call  `[confirmed]`

After the viewport pass, `attach` builds the queue as the blocks between the first and last on screen, then alternates
one below, one above, outward by index (`index.ts`, the `for (let below = end, above = start - 1; ...)` loop). An
`IntersectionObserver` with a 200% root margin pulls queued paragraphs that scroll near to the front, nearest first,
within a 16 ms budget (`OBSERVER_BUDGET_MS`); a second observer at the screen's own edge catches a fast scroll. Slices
are 8 paragraphs while the reader is busy, up to 32 and 24 ms once input has been quiet 400 ms. Distance is by element
count, not by height; a page of long code blocks and short paragraphs makes "the next ten" a very different distance
in pixels. The controller exposes `ready`, `done`, `adopt`, `relayout` and `destroy`: no way to say "set this block now".
`mountThrough` (progressive mount) is the only on-demand call and it mounts, not sets.

### TBD-07 · The earlier near-typeset build: bounded queue worked, and its open issues are mostly gone with the windowing  `[measured]`

An earlier build bounded the queue to five screens (the observer's 200% margin plus three more, with a farther set
watched by a second observer at 500%) and added `setAll()` for print and the aesthetics gate. On a 195 KB page it set 50
of 1,259 paragraphs once quiet (the whole-page queue set 1,372, every one), and open task time went from 1,882 ms to
770 ms with layouts 353 to 141; a tab return went 2,619 to 918 ms; at 1 MB, still 50 of 6,596 set and flat over 2.5
seconds, but the 1 MB open stayed at 78 s of task time because the progressive mount's forced layout per chunk is
untouched (that build report; same-machine records, a loaded Mac, compare counts). Scroll cost rose a little: cursor
key layouts 4 to 5, recalcs 5 to 8, task 23 to 32 ms. Review found: the observers had no `root`, so in a two-pane
layout the browser clipped them to the pane and the queue never refilled; and after a print or the gate called
`setAll`, the page stayed in "set everything" for every later width change. Both were fixed or filed. Checked fine:
a selection from a set paragraph into an unset one copied 49,586 characters identical to the same selection after
`setAll`; find crossed the set boundary; end on 1 MB landed and held. Not tested by that build: a selection that spans
unset blocks in the interface, find while partly set, the grid pass in a pane that scrolls. In the windowed design the
three open items change character: selection and find over unmounted blocks belong to the byte model (the find vector),
and "partly set" stops being a state of one mounted page.
Lesson to keep: roots on every observer, and a record of "what is set" that is not a mode.

### TBD-08 · pdf.js orders by visibility, then direction, then holes; one call renders the target  `[confirmed]`

pdf.js's rendering queue gives the priority as "1. visible pages 2. zoomed-in partial views of visible pages ... 3. if
last scrolled down, the page after the visible pages, or if last scrolled up, the page before the visible pages"
(`web/pdf_rendering_queue.js`, `getHighestPriority`, master, accessed 2026-11-27). Before step 3 it fills any "holes"
in the visible range, in the scroll direction, and `preRenderExtra` adds one more page beyond. It renders exactly one
view per call and re-evaluates after each, so priority is recomputed on state change rather than held as a sorted list.
That fits here: the queue is a function of (reading line, last direction, pending targets), so a recomputed pick
needs no list to repair when the reader jumps. pdf.js's pre-render reach is one or two pages, not a screen count; the
equivalent here is "two screens" from the brief, set by the mount window and not by the typesetter.
Chromium's and the CSS spec's own notion of relevance is a margin: an element is relevant if its box intersects "the
viewport, or a user-agent defined margin around the viewport", with "a margin of 50% ... suggested" (CSS Containment 2,
`content-visibility: auto`, accessed 2026-11-27); focused and selected content is relevant too, and a focused skipped
element "becomes relevant to the user ... before it is scrolled into view due to the focusing". That is the model for
a target that must be set before a jump: relevance first, scroll second.

### TBD-09 · Print: the typesetter's output is wrong at paper width; the page does not need setting early  `[likely]`

`printPane` (`apps/desktop/src/export/page.ts`) adds a print sheet, hides blocks outside a chosen range with
`display: none`, and calls `window.print()` synchronously, keeping the sheet until `afterprint`. It does not ask the
typesetter for anything. A set paragraph is `white-space: nowrap` with explicit break spans measured at the screen's
article width, so at the paper width (A4 with 18 mm margins is about 658 CSS px of text) the lines either fall short or
run past the right edge, whether or not the paragraph was set early. I found no print rule that undoes setting
(`@media print` in `base.css` has two small rules, neither concerns `.marxy-set`; nothing in the app listens for
`beforeprint`). I did not run a print. **Searched:** `base.css` `@media print`, `export/page.ts`, `rg beforeprint` and
`matchMedia.*print` over `apps` and `packages`. So this is `[likely]` from code, and a first thing to confirm by
printing a set page at A4.
What the web says about print and lazy content: `beforeprint` "is fired when the associated document is about to be
printed or previewed for printing" and is for changing "content before printing starts" (MDN, accessed 2026-11-27),
and a handler's work runs before the sheet is laid out only if it is synchronous. WebKit's long-open report that
`loading=lazy` images do not print unless scrolled to first (WebKit bug 224547, accessed 2026-11-27) is an example of the
failure windowing must avoid, and its reporter's workaround is a `beforeprint` handler that makes content eager. The
only fully worked comparison I found is pdf.js, which does not print the viewer at all: its print service renders every
page into its own container as images, one page per turn, and sets a `data-pdfjsprinting` flag on the body
(`web/pdf_print_service.js`, accessed 2026-11-27). The shape is the useful part: print has its own full-document path,
separate from the viewport.
`[unverified]`: whether WKWebView's print path fires `beforeprint` at all, and whether `content-visibility: auto`
subtrees are laid out in print in WebKit (the spec's relevance list names no print case). The caution in the code's
own comment is about `afterprint`, where WKWebView "can return before the sheet has drawn the page".
Recommendation follows from this: print is a mount-everything-in-range operation; typesetting it is not needed, and
is wrong if left on.

### TBD-10 · Jump-to-heading and anchors: set the target window in one batch, then scroll by block and offset  `[likely]`

A jump lands on a block whose unmounted neighbours have estimated heights. The cost of making it right is one
batch: mount the target and about one screen each way, set those paragraphs (`setBatch` is two layouts however many),
run the bounded grid pass over the window (TBD-03), then scroll. In-view setting is the case the code already handles
in the task before paint (the first-pass `keepPlace` path); I estimate a screen's worth, 20 to 40 paragraphs, at tens of
milliseconds to about 100 ms from the 4 ms seed and TYP-03's 0 to 27 ms. This is not measured with a jump. The
position after the batch is exact only if the scroll goes through the block and the byte offset, not the number
the table held before the set: any height correction above the target in the batch moves the page by whole units, and
the engine's scroll anchoring is off (`overflow-anchor: none` on the article, `grid.ts`). With `content-visibility: auto` in
tier 1 the engine does the "make relevant before scroll" part for focus and fragment navigation (CSS Containment 2,
TBD-08), but the typesetter still has to hear about it: an unset paragraph that the engine has just laid out natively
reaches the viewport before the typesetter sets it, so the visible-pass path (an observer, rooted on the scroller) stays
as the backstop.

## Options compared

| Option | Cost | Verdict |
|---|---|---|
| Keep the whole-page queue, add `typesetThrough` | Seconds of main-thread time at 1 MB; two code paths by size | Reject: the problem windowing exists to remove |
| Bounded queue as the earlier build did (set near, `far` set watched, `setAll` for print) | Open task 1,882 to 770 ms on 195 KB; needs `setAll`, a mode | Right idea, wrong place: it bounds the typesetter while the page is whole |
| Typeset on mount, distance-ranked margin, `typesetThrough` for targets, print reverts to native (recommended) | Set cost proportional to the window; no mode | Choose |
| Model the breaker to predict heights | Needs the measurement it replaces | Reject (TBD-05) |
| Typeset at paper width for print | Extra pass over the whole range | Later option, after print is correct at all |

## Open questions

- How often does setting change a paragraph's line count on real prose, and by how many lines; is it under 1% of
  paragraphs (TBD-05)? A script over the aesthetic fixtures at three widths, native lines against set lines, answers it
  without a browser pass of the whole app.
- Does a printed A4 page of a set paragraph run past the right margin or fall short (TBD-09)? One print on WebKit.
- Does WKWebView fire `beforeprint`, and does it lay out `content-visibility: auto` content in print?
- What does `typesetThrough` cost for a 40-paragraph window in WebKit with a mounted 1 MB neighbourhood (TBD-10)?
  The progressive mount's forced layout per chunk dominated the earlier build's 1 MB open; a window of mounted
  blocks removes it, but the number is unmeasured.
- Does the bounded grid pass read the origin or the predecessor (TBD-03)? Read the remainder of `snapToGrid`'s step 2
  before changing it.

## Cross-links

- Estimates and anchoring (vector 06): TBD-05's 0 or ±1 line after setting, and the block-plus-offset scroll TBD-10 needs.
- Code map (vector 01): the grid pass's origin read (TBD-03), `mountThrough` as the only on-demand call, `printPane`.
- Find, select and copy (vector 08): the earlier build's selection and find checks (TBD-07) depend on the byte model.
- Node budget (vector 03) and tier 1 (vector 02): whether `content-visibility: auto` leaves the typesetter's native
  reads cheap on skipped blocks (TBD-02 reads layout; a skipped block has none) is theirs to measure.
- Prior corpus: TYP-01 (breaker complexity), TYP-03 (viewport pass cost), TYP-10 (height reservation); D-04.

## Sources

- Repository code, read 2026-11-27: `packages/typeset/src/index.ts`, `ragged.ts`, `measure.ts`, `grid.ts`, `apply.ts`,
  `scheduler.ts`; `packages/theme/src/base.css`; `apps/desktop/src/export/page.ts`; `apps/desktop/src/view/rendered-view.ts`
  (`startTypeset`); `apps/desktop/src/harness/layout-shift.ts`.
- The earlier near-typeset build: its report and two reviews (work records of the 2026-11-26 wave), cited as "the earlier near-typeset build".
- Prior corpus: `../large-files/05-typesetting.md` (TYP-01, TYP-03, TYP-10), `../large-files/SYNTHESIS.md` (D-04).
- pdf.js rendering queue: https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_rendering_queue.js (saved, accessed 2026-11-27).
- pdf.js print service: https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_print_service.js (saved, accessed 2026-11-27).
- CSS Containment Module Level 2, `content-visibility`: https://www.w3.org/TR/css-contain-2/ (saved, accessed 2026-11-27).
- MDN, `beforeprint` event: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event (saved, accessed 2026-11-27).
- WebKit bug 224547, lazy images do not print: https://bugs.webkit.org/show_bug.cgi?id=224547 (saved, accessed 2026-11-27).
- web.dev, content-visibility: https://web.dev/articles/content-visibility (saved, accessed 2026-11-27; background only).
- Micro-benchmark of `breakRagged`: Node 24.22.3, run in the session scratchpad, not kept.
