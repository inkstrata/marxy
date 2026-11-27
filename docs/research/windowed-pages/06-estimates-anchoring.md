---
corpus: windowed-pages
id: 06
slug: estimates-anchoring
prefix: ANC
title: Estimating block heights and anchoring the reader
kind: web + code
created: 2026-11-27
---

# 06 · Estimating block heights and anchoring the reader

## Abstract

Q-06 asks how to guess a block's height before it is laid out, and how to fix the guess without the text moving
under the reader. I read the source of CodeMirror 6's height map and measure loop, TanStack Virtual's resize
handling, virtua's store, Virtuoso's size tree and the CSSWG scroll-anchoring draft, and set them against the
app's own position code, the unmerged geometry table and the grid pass. Q-11 gets the anchoring half of the table's
API. Q-14 gets what these libraries do on short lists. Not run: no height-estimate error was measured on the app's
typesetter (Bash was limited to the save and check commands); every accuracy claim below is a design argument or a
reading of someone else's code. Newest source: the libraries' default branches, read 2026-11-27. Where a code
comment is paraphrased rather than quoted, the saved text is `sources/<id>.txt` and the line is given.

## TL;DR

- The jump comes from one thing: the anchor's top moves while `scrollTop` does not. Every system that avoids the
  jump keeps an anchor (a block plus an offset into it) and, after any height change above it, writes
  `scrollTop += (anchor top after - anchor top before)` in the same frame as the layout write (ANC-01, ANC-03, ANC-04).
- Copy CodeMirror's shape, not TanStack's: compare the anchor's top before and after, in a loop that stops when
  nothing moves (ANC-01). It needs no per-item rule about what is "above", and it copes with a batch of corrections.
- The app's stored position is `{byteOffset, fraction}`, a fraction of the block's height. That is the wrong live
  anchor for an estimated block: the fraction stays put while the pixels it means change (ANC-07). Hold the live
  anchor as `{block, byteOffset, unitsBelowBlockTop}` in whole grid units, negative inside the margin above (this
  generalises today's `lead`), and convert to the stored form only to persist (ANC-08).
- Whole-unit heights help, but less than they sound: they make "did it change" an exact integer test, let the table
  keep integer prefix sums and let runs of equal height merge (ANC-09). They do not remove the need to write
  `scrollTop` in the same frame, and `scrollTop` itself rounds (ANC-10).
- The candidate table settles records with a half-pixel tolerance and shifts every later record's `top` in a loop,
  which is O(blocks) per correction. A prefix-sum tree over unit heights removes both (ANC-11).
- Virtualisers keep one path for every size: a short list simply has a range that covers everything. What breaks is
  the first frame (virtua renders nothing until the viewport is measured); CodeMirror has no small-document mode at
  all (ANC-12).

## Recommendation

1. **Estimate in units from the bytes the table already has.** Source line count is exact for code and for table
   rows; characters give paragraph line counts with a calibrated characters-per-line, as CodeMirror does. Kind
   constants (heading units, image placeholder, margins) come from the theme. Round up to whole units (ANC-05, ANC-06).
2. **Calibrate, do not trust a constant.** Recompute characters-per-line from the first measured paragraphs at the
   current width and re-estimate unmeasured blocks, the way CodeMirror refreshes its oracle (ANC-02). If the
   typesetter can report a paragraph's line count without a DOM layout, use it and the estimate becomes exact for
   paragraphs (question for vector 09).
3. **One anchor, held in units.** `Anchor = { block, byteOffset, units }`, `units` possibly negative. Reading line
   to anchor on scroll (cheap, from the table). Anchor to `scrollTop` is `top(block) + units - line`, all in units
   until the last step (ANC-08).
4. **One correction rule.** Every table change that can move the anchor (a measure, a mount, a splice above) goes
   through one function: read the anchor's top before, apply, read it after, write `scrollTop += diff` in the same
   frame as the DOM write, repeat up to a small limit (ANC-01). Never correct in a later task.
5. **Correct lazily.** A block that is not mounted keeps its estimate; nothing moves until it mounts. Mount blocks
   above the viewport in one batch, read their heights in one layout, apply one correction (ANC-03, ANC-14).
6. **Keep the unit tree and the anchor in `packages/core`** (no DOM) so the rules can be tested with numbers, as the
   candidate table already does (ANC-11).

## Findings

### ANC-01 · CodeMirror 6 anchors by document position and corrects after measuring, in a bounded loop  [confirmed]

In `measure()` the view reads an anchor block before measuring: when not scrolled to the bottom it takes
`this.viewState.scrollAnchorAt(scrollOffset)` and keeps `scrollAnchorPos = block.from` and `scrollAnchorHeight = block.top`
[1]. After the viewport, plugins and DOM are updated it recomputes `newAnchorHeight` from `this.viewState.lineBlockAt(scrollAnchorPos).top`,
takes `let diff = (newAnchorHeight - scrollAnchorHeight) / this.scaleY` and, if `diff > 1 || diff < -1` and the
scroller has focus or the user wheeled or touched within 100 ms, writes `if (scroll) scroll.scrollTop += diff` [1].
It then clears the anchor and loops (`continue`), so the next pass checks that nothing else moved. The loop gives
up with the warning "Measure loop restarted more than 5 times" [1]. The anchor is a document position, not a pixel,
so when text above changes (`applyChanges`) the view state maps it: `this.scrollAnchorPos = update.changes.mapPos(scrollAnchor.from, -1)` [2].
Measuring runs once per animation frame: `requestMeasure` does `this.win.requestAnimationFrame(() => this.measure())`
[1]. Read and write are separated: measure requests run their `read` callbacks, then the update, then their `write` callbacks [1].
The 1 px threshold is how CodeMirror absorbs sub-pixel noise; whole-unit heights would make it 0 (ANC-09).
The write is skipped when the reader is not interacting (no focus, no recent wheel), a guard the app would need to decide on.

### ANC-02 · CodeMirror's height map estimates from characters and a calibrated width, and re-calibrates when measurement disagrees  [confirmed]

`HeightOracle` holds `lineHeight`, `charWidth` and `lineLength` (defaults 14, 7, 30) [3]. An unmeasured line is
`heightForLine(length)`: `let lines = 1 + Math.max(0, Math.ceil((length - this.lineLength) / Math.max(1, this.lineLength - 5)))`,
times `lineHeight` [3]. The `- 5` is a fudge for words that do not break at the exact column. A gap of several lines is
`heightForGap`: `lines += Math.max(0, Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength))`,
that is, each line counted as half full on average [3]. `lineLength` is set from the editor: `Math.max(5, contentWidth / charWidth)` [2].
On every measure the view samples visible line heights and calls `oracle.mustRefreshForHeights`, which tracks
distinct heights rounded to 0.1 px (`Math.floor(h * 10)`), and when a new height appears it re-measures the text
size and rebuilds the whole map with `refresh` [3][2]. The height map itself is a tree of blocks, gaps and branches
that carry `length` and `height` and are replaced by `applyChanges` [3]. CodeMirror's own comment on its line-gap code
(`viewstate.ts`, above `ensureLineGaps`) says it uses crude character counting and relies on generous margins to hide the errors [2]. Lesson for Markdown:
the estimate is a count (characters over a width), one calibration (the oracle) and a rule to throw the whole estimate
away when the calibration changes. CodeMirror has no per-kind learned ratios.

### ANC-03 · TanStack Virtual compensates per resized item whose top is above the offset, and flushes in the same frame  [confirmed]

`resizeItem(index, size)` computes `delta = size - itemSize` [4]. For a first measurement the default predicate is
`itemStart < scrollOffset` (the source comment, `d76704448b1f.txt` lines 2140 to 2153 (the comment at 2141-2143, the predicate at 2144), says the estimate-to-actual delta must be corrected whatever the scroll
direction); for a re-measurement it is `itemStart + itemSize <= scrollOffset && this.scrollDirection !== 'backward'`
[4]. A consumer can replace the predicate through `shouldAdjustScrollPositionOnItemSizeChange(item, delta, instance)` [4].
On a yes it calls `applyScrollAdjustment(delta)`. The comment at lines 2194 to 2203 explains why the notify is synchronous: a later notify lets the browser
paint one frame with the new `scrollTop` and the old item positions, so the viewport jumps by the delta and snaps back; a synchronous notify puts both in one paint [4].
Resizes inside a ResizeObserver callback are batched: one notify after all entries, synchronous if any moved `scrollTop` [4].
Positions are stored as `start` and `size` pairs in a `Float64Array`, rebuilt from the lowest changed index (`pendingMin`),
so a correction at index i costs O(count - i) [4]. The estimate is the consumer's `estimateSize(i)` for any key not
yet in `itemSizeCache` [4]. Two cautions in the same file: a write is not made while an iOS touch gesture owns the
scroll or while the element is overscrolled, because "WebKit discards the write and the bounce can stall where it was"
[4]; and the re-measurement rule excludes an item that merely spans the fold (comment at lines 2145 to 2149: shifting by its growth would drag the viewport down on every growth) [4].
This code is the 2026 default branch, newer than the long-published releases; version it before relying on any one rule.

### ANC-04 · virtua anchors by item index and defers the jump while scrolling on iOS WebKit  [confirmed]

On a resize, virtua reads `anchorIndex = getAnchorIndex()` and `anchorOffset = getItemOffset(anchorIndex)`, applies
the new sizes and calls `applyJump(getItemOffset(anchorIndex) - anchorOffset)`, with the comment "Calculate jump by resize
to minimize janks in appearance" [5]. It is the same before-and-after anchor comparison as CodeMirror's, at item
granularity. The anchor index is the first item not to keep: items whose bottom is at or above the viewport start
are compensated, and in `SCROLL_BY_SHIFT` (prepending) the anchor is the list's end, "Keep distance from end during shifting" [5].
`applyJump` queues the correction in `pendingJump` instead of applying it "In iOS WebKit browsers, updating scroll position will stop scrolling so it have to be deferred during scrolling" [5]; a scroll-end flushes it.
The resize update is synchronous (`shouldSync = true`) "to minimize visible glitch" [5]. Relevance: macOS WKWebView
is not iOS, but the underlying fact (a `scrollTop` write cancels momentum) is a WebKit trait the app should test on
the trackpad (open question). `relayout` (width change) uses the same anchor delta [5].

### ANC-05 · Estimates by kind: what is exact, what is not  [likely]

From the sources above and the app's own structure (the grid pass pads `pre, table, img, .marxy-math-block, .marxy-math` [6]):
- **Code block.** Lines are exact from the byte range (count newlines), if the block scrolls horizontally rather than
  wraps; wrapped code needs the paragraph rule. Height = lines * line box + padding, rounded up to a unit. Exact apart from fonts.
- **Heading.** Level gives size and margins from the theme; one line unless the title is long: `ceil(chars / charsPerLine(level))`.
- **Paragraph.** `ceil(chars / charsPerLine)` lines, with CodeMirror's correction for words not breaking at the column
  (ANC-02). Use characters, not bytes: for text with multi-byte characters bytes over-count; a cheap discount
  (count continuation bytes) is enough. Error is typically one line, which is two units.
- **Table.** One source line per row is exact for GFM, but a cell that wraps makes the row taller. Estimate rows * (one
  line + cell padding) as a floor and expect the error to be underestimates at narrow widths; such blocks are the likeliest to correct.
- **Image.** Unknown until the image decodes, unless the file's width and height are known. An unknown image is a placeholder
  of a fixed aspect on the column width; this is the largest single error source and the one `contain-intrinsic-size` exists for.
- **List, blockquote.** Recurse over children with the same rules; a source line count bounds them.
- **HTML block, math.** Unknown; give a small constant and mark them weak so they are measured first when near the viewport.

I have not measured the error of any of these on the app's typesetter. The formulas are design, not a result.

### ANC-06 · A table record needs three states, not two: estimated, computed, measured  [likely]

CodeMirror keeps `outdated` flags and replaces a node when its height changes; the candidate table keeps `measured: boolean` per record [7][3].
Where the typesetter can compute a line count without layout there is a third state, computed, with zero error unless
fonts or images change. The state is what lets a policy mount weak (estimated, large) blocks before strong ones and what lets find and jump know a position is only approximate.

### ANC-07 · The app's current position is a fraction of the block height; for an estimated block it is the wrong live anchor  [confirmed]

`blockPositionAtScroll` returns `byteOffset: block.start` and `fraction = (scrollTop + line - block.top) / block.height`,
and `scrollTopForPosition` returns `block.top + fraction * block.height - line` [8]. Both are right when the block's height is the one that was used to compute the fraction.
Open a big file, restore to `{byteOffset, fraction}` against an estimated 600-unit block, mount it (it measures 640): the
same fraction now means 40 units further down the page and the text moves. A position held as units below the block's
top does not move when the block's own height changes (only things above it move it). `currentPosition` already carries an
extra pixel `lead` for the case where the line is in the margin above a block, because "a fraction cannot go below 0" [9]; units below the
top, allowed to be negative, are the same idea made general. Both `positionNear` and `scrollTopNear` on the candidate branch keep `fraction` and `lead` as they are [10].

### ANC-08 · The anchoring API for the geometry table (Q-11, part)  [likely]

Proposed shape, all DOM-free, in `packages/core/src/position/`:

```ts
interface Anchor { block: number; byteOffset: number; units: number }  // units below the block's top; may be < 0
anchorAt(table, scrollTopUnits, lineUnits): Anchor        // search over prefix sums
scrollTopFor(table, anchor, lineUnits): number            // top(block) + units - lineUnits
toStored(anchor, table): { byteOffset, fraction }         // fraction = units / heightUnits, only to persist
fromStored(table, {byteOffset, fraction}): Anchor         // units = round(fraction * heightUnits)
```

`block` is an index that is valid only until the table changes; `byteOffset` (the block's start) is what survives a
splice, mapped through the change like CodeMirror's `mapPos` (ANC-01). Inside a mounted block the byte offset can be
refined to a line by a Range rect, but that refinement is for display (find, selection), not for holding position: holding
position needs only the block and the units. After every settle, call `scrollTopFor` and write the difference
(ANC-01). The persisted form stays `{byteOffset, fraction}` so existing saved positions load (`fromStored`
rounds once).

### ANC-09 · What whole-unit heights buy  [likely]

The grid pass pads islands to a whole number of half-line-box units and pushes any block that starts off the grid [6]; text
blocks sit on the grid by CSS construction. Consequences for estimating and correcting:
1. **Exact equality.** Whether a block changed is `unitsMeasured !== unitsEstimated`, with no tolerance. The candidate table needs
   `same(a, b)` at 0.5 px and CodeMirror needs 1 px, because sub-pixel layout gives fractions that wander [7][1].
2. **Integer prefix sums.** A Fenwick or weight-balanced tree over integer unit heights has no float drift however many corrections are
   applied, so `top(i)` is the same whether computed after one big update or a thousand small ones.
3. **Run merging.** Virtuoso keeps a size tree of ranges and merges adjacent equal sizes: "we 'merge' them." [11]. Quantised heights make long
   runs equal (many 2-unit paragraphs), so a tree of runs is much smaller than a tree of blocks.
4. **Cheaper corrections.** The delta is a small integer (+-2 for a one-line paragraph error) and the same for every block that is off by a line.

It does not help with: a block that is off-grid in the DOM (the grid pass fixes it with its padding, which is itself a layout
cost), pixel rounding (ANC-10), and the same-frame rule (ANC-03).

### ANC-10 · `scrollTop` is not an exact integer number of units  [confirmed]

virtua's comment on its own scroll handling (it speaks of the "latest Chrome/Firefox/Safari in 2023", so it describes 2023 browsers; the 17 px by 1.6 arithmetic below is this chapter's own illustration): "setting value to scrollTop/scrollLeft can lose subpixel because its integer (sometimes float probably depending on dpr)" [5]. If a unit is `lineBox / 2` CSS px and
`lineBox` is not an even number of pixels (a line-height of 1.6 on 17 px is 27.2 px), a unit is fractional in CSS pixels and in device pixels
at 2x. Keep the table in integer units; convert to pixels at the edge once (`units * unit`), and read `scrollTop` back to units
with rounding. The app's theme may already choose a pixel-exact line box: this needs checking (open question). If the
unit times the device pixel ratio is not an integer, an anchor can drift by up to half a device pixel per round trip,
and a loop that tests `diff > 0` would never settle; test against half a unit instead.

### ANC-11 · The candidate table's settle: right idea, O(n) shifts, pixel tolerance  [confirmed]

`settleRecords` finds runs between dirty records, reads the first and last record of each run, compares the two deltas and, where they
agree, shifts the run by one amount [7]. That is about two layout reads per run. But `shift(from, to, dy)` runs
`for (let i = from; i <= to; i++) records[i]!.top += dy`, so a correction at the top of a 100,000-record table writes every record below it, and it uses
`same` with 0.5 px [7]. TanStack has the same shape (rebuild from `pendingMin`) [4]; CodeMirror and Virtuoso use trees, so a change at one place
touches O(log n) nodes [3][11]. With integer unit heights a Fenwick tree (heights only; tops are prefix sums) updates a height and
finds the block at a given offset in O(log n), and the run-of-equal-movement test is not needed because tops are not stored. Reading layout for a
corrected block is still one rect per dirty block.

### ANC-12 · Virtualisers keep one path for every size; short lists are a range that covers everything (Q-14, part)  [confirmed]

CodeMirror has no small-document mode: the viewport is computed from the visible pixel range plus `VP.Margin = 1000` px on each side (a different `Margin`, 2000, in CodeMirror's line-gap code is unrelated to the viewport margin), clamped to the document, so a
short document is a viewport that is the whole of it [2]; the same code runs, with fewer lines than the margin. `BigScaler` only
applies when `heightMap.height` passes `VP.MaxDOMHeight = 7e6`, "Beyond this size, DOM layout starts to break down in browsers" [2]; below it `IdScaler` returns its input. virtua's `getRange` returns `[0, -1]`, "to render nothing, until the scroll offset and viewport size
are determined", and a `ssrCount` path exists for a first render [5]: on a short list that is a blank first frame, in return for one code path. TanStack's `_willUpdate` and the observers likewise run for any `count` [4]. react-window's dynamic row height takes a
`defaultRowHeight` and measures rows with a ResizeObserver, expecting content to shift as rows are measured; its docs recommend a fixed size when the heights can be
known ahead of time [12] (read through a page summary, not quoted: `[likely]`). What breaks when a short document skips the table is covered by vector 04; the finding here is the
inverse: the cost of one path is a first frame, not a wrong answer, and it can be avoided by mounting the first screens synchronously from the estimate (as the progressive mount already does).

### ANC-13 · The browser's own scroll anchoring is a different mechanism with a different guarantee  [confirmed]

The CSSWG draft says the problem is "Changes in DOM elements above the visible region of a scrolling box" [13]. It selects one anchor node, "deep
in the DOM", by a viewport-position rule the page does not control, and it is suppressed in some cases (excluded subtrees). The page cannot say which byte it keeps. The app
already opts out (`overflow-anchor: none`, set by the grid pass [6]), correctly: with a byte anchor of its own it should not let a second corrector add its
own jump. Whether `overflow-anchor` can instead be used while mounting above the viewport is for vectors 02 and 05.

### ANC-14 · Estimates are cheap to be wrong about; the scroll bar is the visible cost  [likely]

With the correction rule in ANC-01 an estimation error shows as a change in total height, so the scroll thumb moves, not the text. CodeMirror lives with the same. The
cost to bound is not accuracy but how often a correction is applied while the reader moves: mount above the viewport in a batch (one layout, one correction)
rather than block by block; where the reader scrolls up fast, mount ahead on the estimate and correct once. TanStack skips re-measurement corrections during a
backward scroll, and its comment names the cascade of items jumping while scrolling up (`d76704448b1f.txt` lines 2150 to 2151) [4]: a sign that per-block corrections while scrolling up cascade; a batched
anchor comparison does not.

## Options compared

| Option | What it is | Strength | Weakness |
|---|---|---|---|
| A. Anchor delta loop (CodeMirror) | Anchor top before and after, write the difference, repeat | Handles batches and any cause; idempotent | Needs a before-read and an after-read per cycle |
| B. Per-item delta (TanStack) | Each resized item above the offset adds its delta | No anchor needed; cheap per item | Needs a rule for what is above; cascades when scrolling up; double-corrects if the anchor also moved |
| C. Index anchor with deferral (virtua) | Anchor index, jump queued during touch | Good where a write cancels momentum | Index must be stable; deferral adds a state |
| D. Browser scroll anchoring | `overflow-anchor: auto` | Free | Not byte-aware; suppressed in places; two correctors fight |
| E. Fraction of block (today) | `byteOffset` + fraction | Persists in a file | Moves when the block's own height changes |

Recommended: A with the anchor of ANC-08, a unit tree (ANC-11) and E only for the saved file.

## Open questions

- Estimate accuracy per block kind on the app's typesetter at 1 MB shapes (`md-prose`, `md-dense`, `md-technical`): not measured here.
- Is the theme's line box an integer number of CSS px (and device px at 2x)? ANC-10 depends on it.
- Does a `scrollTop` write cancel trackpad momentum in WKWebView on macOS, as virtua reports for iOS? A probe in the app's own page, many repetitions, would show it.
- Can the typesetter's ragged line breaking report a paragraph's line count off-DOM (vector 09)? If yes, paragraphs need no estimate.
- The write guard: CodeMirror corrects only while the user is interacting. The app must decide whether to correct also when idle (during a fonts-loaded re-typeset).

## Cross-links

- Vector 01 (code map): the code that reads `top` and `height` from the DOM becomes reads of the table through `Anchor`; `lead` and `fraction` disappear from live code.
- Vector 04 (height maps): tree choice; ANC-11 argues for a unit Fenwick tree with the table's block records on the side.
- Vector 09 (typeset by distance): exact line counts; weak-first mounting order from ANC-06.
- Vector 10 (editing): a splice above the anchor maps `byteOffset` and lets the same loop absorb the height change.
- Vectors 02 and 05: `content-visibility`'s remembered size and `overflow-anchor` in WebKit.
- Large-files corpus: DOM-04 (what the page costs per node) and TYP-01 (what one typeset block costs) set how many corrections per frame the page can afford; this chapter does not re-derive them.

## Sources

Accessed 2026-11-27. Saved pages are in `sources/` under the id given.

1. CodeMirror view, `src/editorview.ts` (default branch) https://raw.githubusercontent.com/codemirror/view/main/src/editorview.ts (493ddc46dcd2)
2. CodeMirror view, `src/viewstate.ts` https://raw.githubusercontent.com/codemirror/view/main/src/viewstate.ts (7d0af441be6c)
3. CodeMirror view, `src/heightmap.ts` https://raw.githubusercontent.com/codemirror/view/main/src/heightmap.ts (c1181dad1800)
4. TanStack Virtual, `packages/virtual-core/src/index.ts` (default branch) https://raw.githubusercontent.com/TanStack/virtual/main/packages/virtual-core/src/index.ts (d76704448b1f)
5. virtua, `src/core/store.ts` https://raw.githubusercontent.com/inokawa/virtua/main/src/core/store.ts (5a418cda864c)
6. `packages/typeset/src/grid.ts` in this repository, read 2026-11-27 (ISLANDS, `overflow-anchor`, unit is half the line box).
7. `packages/core/src/position/geometry.ts` on `origin/agent/geometry-table` (`GeometryRecord`, `same`, `settleRecords`, `shift`), read with `git show` 2026-11-27.
8. `packages/core/src/position/blocks.ts` in this repository (`blockPositionAtScroll`, `scrollTopForPosition`).
9. `apps/desktop/src/position/position.ts` in this repository (`HeldPosition`, `lead`).
10. `apps/desktop/src/position/position.ts` on `origin/agent/geometry-table` (`positionNear`, `scrollTopNear`).
11. react-virtuoso, `sizeSystem.ts` https://raw.githubusercontent.com/petyosi/react-virtuoso/master/packages/react-virtuoso/src/sizeSystem.ts (fcc28ad149bd)
12. react-window repository page https://github.com/bvaughn/react-window (b07e62e0695a); the dynamic-row-height claims were read through a page summary, not a saved quotation: `[likely]`.
13. CSS Scroll Anchoring Module Level 1, editor's draft https://drafts.csswg.org/css-scroll-anchoring-1/ (bea2e7cc7bdb)
