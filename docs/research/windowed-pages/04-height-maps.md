---
corpus: windowed-pages
id: 04
slug: height-maps
prefix: HMP
title: Height maps and viewports in other systems; the geometry table's structure and API
created: 2026-11-27
---

# 04 · Height maps and viewports

**Abstract.** Every system that windows a long document keeps a model of heights that does not depend on the DOM:
CodeMirror 6 a balanced tree of estimated-then-measured heights, Monaco a uniform line height plus a sorted array of
"whitespaces" with lazy prefix sums, pdf.js a DOM placeholder of known size per page with a small rendered buffer.
ProseMirror is the counter-example: no height model, so no windowing. Research date 2026-11-27; sources are current
`main` of each project, read on that date.

## TL;DR

- CM6 always virtualises: one code path at every size, and its author refuses a "render everything" mode (HMP-05, HMP-11).
- The two systems with a size-gated mode (VS Code's large-file mode, pdf.js's lazy page init) switch off features
  at the threshold and document what breaks (HMP-11).
- The geometry table should be a **flat array**: `Uint32Array` byte starts, `Int32Array` heights in grid units, a
  prefix array rebuilt lazily from the lowest changed index (Monaco's way), with a flag per block for measured. A
  Fenwick tree only pays beyond roughly 10^5 blocks (a `[likely]` judgement in HMP-10; HMP-07 is Monaco's array and HMP-08 is pdf.js).
- The branch's candidate is the right idea (one record per block, binary search, run settling) but it is DOM-bound: an
  unmounted block has no record, and an estimate is height 0 (HMP-12).

## Recommendation

1. Build the table as a pure core module over numbers (as the candidate's `geometry.ts` already is), not over elements.
   Estimate every block at open from its byte length and kind, in whole grid units.
2. Use arrays plus a lazy prefix sum. Keep the API in HMP-09.
3. Keep one path: the table and its lookups exist for every file; only the mount policy reads the node budget.
4. Correct estimates the way CM6 does, anchoring on a block and an offset (see vector 06), not on a pixel.
5. Do not adopt the branch's per-element `ResizeObserver` as the only source of heights: it cannot measure what is
   not mounted. Keep it as one feeder of `setMeasured` for the mounted blocks.

## Findings

### HMP-01 · CM6's HeightMap is a binary tree of gaps, blocks and text lines, with an oracle for estimates  `[confirmed]`
`heightmap.ts` defines `HeightMapBlock`, `HeightMapText`, `HeightMapGap` and `HeightMapBranch` under an abstract
`HeightMap` with `blockAt(height, ...)`, `lineAt(value, type, ...)` and `updateHeight(oracle, offset, force, measured)` [1].
A gap is a run of lines never measured; the oracle supplies its height. `HeightOracle` holds `lineHeight`,
`charWidth` and `lineLength` and answers `heightForLine(length)`: with wrapping, `1 + Math.max(0, Math.ceil((length - this.lineLength) / Math.max(1, this.lineLength - 5)))` lines [1].
So an estimate is a function of byte length and measured font metrics, nothing else. Source read 2026-11-27.

### HMP-02 · One query, three coordinates: by position, by height, by position without height  `[confirmed]`
`export enum QueryType { ByPos, ByHeight, ByPosNoHeight }` [1]. `HeightMapBranch.lineAt` descends with
`let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break` and compares `value`
against either, so byte and y lookups share one tree and each node stores its length and its height [1]. Edits go
through `applyChanges`, which finds the affected lines by `lineAt(..., ByPosNoHeight)` on the old doc, rebuilds those
nodes with `NodeBuilder`, and `balanced()` rebuilds a subtree when `left.size > 2 * right.size` [1]. Updates cost
O(log n) to the root.

### HMP-03 · Measured versus estimated is a flag, not a different structure  `[confirmed]`
`const enum Flag { Break = 1, Outdated = 2, SingleLine = 4 }`; new nodes start `Flag.Outdated`; a branch is outdated if
either child is [1]. `updateHeight` re-estimates outdated nodes with the oracle and takes a measured height where
the view supplies one (`MeasuredHeights`). Total height is always available, and is wrong by exactly the unmeasured
part.

### HMP-04 · The viewport is derived from the height map, with a margin, and the DOM mounts only it  `[confirmed]`
`viewstate.ts` has `const enum VP { Margin = 1000, MinCoverMargin = 10, MaxCoverMargin = VP.Margin / 4, MaxDOMHeight = 7e6 ... }` [2].
`ViewState` holds `heightMap`, `viewport`, `visibleRanges` and `scrollAnchorPos` / `scrollAnchorHeight`; on update it
takes `scrollAnchorAt(this.scrollOffset)`, maps `scrollAnchorPos` through the changes and restores that height
after applying them [2]. Beyond 7e6 px it swaps in a `BigScaler` because "DOM layout starts to break down in browsers
because they use fixed-precision numbers to store dimensions" [2]. A margin of 1000 px is about two screens: the same
figure as the owner's "about two screens".

### HMP-05 · Estimate errors are a known source of scroll glitches, fixed more than once  `[confirmed]`
The CM6 changelog lists "Fix a bug where differences between widgets' estimated and actual heights could cause the
editor to inappropriately move the scroll position" and later "Make sure differences between estimated and actual
block heights don't cause visible scroll glitches" [3]. The maintainer on total height: "Eagerly rendering the entire
document is not something the editor supports", and a host wanting a stable scrollbar must "listen to updates with the heightChanged flag" [4]. The total height drifts as blocks are measured. Block widgets are the nearest
analogue of Markdown blocks (tables, code fences of arbitrary height); CM6 asks for a declared `estimatedHeight`.

### HMP-06 · Monaco keeps no per-line height: uniform lines plus a sorted whitespace array with lazy prefix sums  `[confirmed]`
`LinesLayout` has `_arr: EditorWhitespace[]` (each with `afterLineNumber`, `height`, `prefixSum`),
`_prefixSumValidIndex` and a `LineHeightsManager(defaultLineHeight, customLineHeightData)` [5]. Prefix sums are
filled on demand: `getWhitespacesAccumulatedHeight(index)` starts at `Math.max(0, this._prefixSumValidIndex + 1)` and
extends only as far as asked, and a change resets the valid index [5]. `getLineNumberAtOrAfterVerticalOffset` and
`getLinesViewportData(verticalOffset1, verticalOffset2)` binary-search over these [5]. Wrapped-line heights come from
the view model, computed up front, so Monaco never has an estimate-versus-measured problem for text (it pays by
laying out wraps ahead). For Markdown blocks, whose height depends on font, width and hyphenation, that is
the part that does not transfer.

### HMP-07 · Monaco's array is cheap because whitespaces are few; the lines are implicit  `[likely]`
The array holds whitespace widgets, not lines. A table with one record per block (about 20,000 at 1 MB) is
comparable to Monaco's counts of view zones plus custom line heights only when they are many. A lazy prefix array
rebuilt from the lowest changed index is O(n) worst case, which at 20,000 `Int32` entries is a small loop (my
estimate; not measured here, easy to measure in a unit benchmark).

### HMP-08 · pdf.js: every page exists as a sized placeholder; only a bounded buffer is rendered, ordered by distance  `[confirmed]`
`PDFViewer` creates a `PDFPageView` for every page (sized from the page's default viewport), keeps a
`PDFPageViewBuffer` with `DEFAULT_CACHE_SIZE = 10`, and on each update `Math.max(DEFAULT_CACHE_SIZE, 2 * numVisiblePages + 1)` pages stay
rendered, everything else being asked to `updateVisibleArea(null)` [6]. `getVisibleElements` uses
`binarySearchFirstItem` over the views ([7] ui_utils) and its result is `sortByVisibility`. The rendering queue's own
comment gives the order: "1. visible pages ... 3. if last scrolled down, the page after the visible pages, or if last
scrolled up, the page before the visible pages" [8]. Rendering by distance and direction, with all geometry known from
the document's metadata and no measuring of unmounted pages, is the model for typesetting by distance. Differences:
page size is exact from the file, so there is nothing to correct.

### HMP-09 · API sketch for the geometry table (answers Q-11)  `[likely]`
Design, my synthesis from HMP-01 to HMP-08. Units are whole line-box units of the baseline grid; bytes are file offsets.

```ts
interface GeometryTable {
  readonly count: number;
  readonly version: number;                    // bumps on any change that moves a top
  readonly totalHeight: number;                // units, always defined
  // lookups: all O(log n) or O(1), none touch the DOM
  indexAtByte(byte: number): number;           // last block with start <= byte
  indexAtY(y: number): number;                 // first block whose bottom > y
  start(i): number; end(i): number;            // byte range
  top(i): number; height(i): number;           // grid units
  isMeasured(i): boolean;
  range(i0, i1): { start; end };               // for copy: bytes [start(i0), end(i1))
  // updates: batched; one prefix invalidation per batch
  splice(i0, i1, blocks: {start; end; kind}[]): void; // block splice after an edit; shifts byte starts by delta
  setMeasured(updates: Iterable<[index, heightUnits]>): { movedTop: number }; // returns lowest changed index
  reestimate(width, metrics): void;            // oracle changed: re-estimate every unmeasured block
  // anchoring helper (vector 06): { index, byteOffsetInBlock, yOffsetInBlock }
  anchorAt(y: number): Anchor; yOfAnchor(a: Anchor): number;
  onChange(fn): () => void;
}
```
Callers: find (a match in bytes calls `indexAtByte`, then asks the mount policy to typeset that block; hit counts come from text, not
the table); copy and select all (`range`, no height); scroll anchoring (`anchorAt`, `yOfAnchor`, `setMeasured` returning
the lowest moved index so the caller knows if the anchor moved); outline and jump-to-heading (`indexAtByte(headingStart)`
then `top(i)`, a scroll before the block is typeset, which is exactly what estimates exist for); print (iterates all
blocks in order, asks for all to be mounted; heights are ignored); mount policy (`indexAtY(scrollTop ± margin)`).

### HMP-10 · Array with prefix sums versus tree versus Fenwick: choose by update pattern  `[likely]`
- **Array + lazy prefix** (Monaco, HMP-06): lookup by block index O(1), by y O(log n) binary search, by byte O(log n) on a
  separate `Uint32Array`. A measured batch costs O(n - lowest) once per frame. Block splice is an array splice of
  three typed arrays (O(n) memmove), which is fine at editing rates.
- **Fenwick tree**: O(log n) point update and prefix query, y lookup by descent. Does not support insertion, so every
  block splice rebuilds it in O(n), which is the same cost as the array's. The gain is only many scattered
  measurements per frame at huge n.
- **Balanced tree with aggregates** (CM6, HMP-02): O(log n) for everything including insertion, plus the byte and
  height coordinates in one structure. Best at millions of lines and with a decoration layer; the code is large (the file is 29,107 characters
  [1]) and the app's blocks number tens of thousands, not millions.
Choice: array first, with the API above hiding the structure, so a Fenwick or tree can replace it behind the same interface
if blocks exceed about 10^5. Typical top-level block counts at 1 MB are the vector-03 and 01 figures (about 20,000 in the brief).

### HMP-11 · One path versus two: CM6 and pdf.js, VS Code, Obsidian (answers Q-14)  `[confirmed]`
- **CM6** has no small-document mode; viewport, height map and scaler apply at every size [2]. The cost is that the model's
  complexity is paid by tiny documents, the benefit that nothing changes at a threshold.
- **ProseMirror** never windows. The author: "it doesn't, and this is intentionally out of scope, because it was already hugely
  complicated to get right in a plain text editor like CodeMirror" [9], and "The main difficulty ... requires knowing the height
  of everything, even the parts that you never rendered" [10]. A whole book as one document, he says, you will "notice a slowdown and a lot of memory used" [10].
  So never windowing is a legitimate single path, with a ceiling.
- **VS Code** has two: `LARGE_FILE_SIZE_THRESHOLD = 20 * 1024 * 1024` (20 MB) and `LARGE_FILE_LINE_COUNT_THRESHOLD = 300 * 1000` decide, once
  at model creation, `_isTooLargeForTokenization` [11]; EDS-01 to EDS-03 record what the mode turns off (tokenisation, folding and so on).
  The layout itself (`LinesLayout`) is the same in both modes [5]; only features are gated, which is the cheaper way
  to have two modes.
- **pdf.js** has size-gated init modes: `PagesCountLimit = { FORCE_SCROLL_MODE_PAGE: 10000, FORCE_LAZY_PAGE_INIT: 5000, ... }`, and
  its own comment in the lazy branch reads "XXX: Printing is semi-broken with auto fetch disabled" [6]. The comment sits under the combined `disableAutoFetch || pagesCount > FORCE_LAZY_PAGE_INIT` branch, so it concerns lazy init generally, and the size gate is only half the condition. That is the failure
  the brief fears: print needs every block, and the mode that avoids loading everything breaks it.
- **Obsidian** virtualises Reading view by default; a community plugin sets `renderExtraMinPx = Infinity` to keep
  the whole note rendered, because virtualisation causes layout problems (the plugin's own text sets `renderExtraMinPx = Infinity` on the active renderer) [12], and lists are an exception that cannot be split [13]; see also MDA-06.

What breaks in two-path designs (observed): print and anything else that wants the whole document (pdf.js print); features
silently off above the threshold (VS Code); a rarely used branch that is behind in testing (inference, `[likely]`).
Implication: if the table and lookups are always there and only "how many blocks are mounted" varies, the small path is the
large path with a budget bigger than the document.

### HMP-12 · Candidate geometry table versus CM6's height map  `[confirmed]` (code read)
Read from `origin/agent/geometry-table` at commit f4fda854, `packages/core/src/position/geometry.ts` and `apps/desktop/src/view/block-geometry.ts`, 2026-11-27.

Matches CM6: one record per top-level block in document order; binary search by y (`recordIndexAtY`) and by byte
(`recordIndexAtByte`); a `measured` flag distinguishing estimate from measurement (`GeometryRecord.measured`); a pure
core half with no DOM, testable with numbers (as the file comment says: "No DOM, so every rule can be tested with numbers");
a `version` and `onMoved` notification.

Departs from CM6:
1. **Records are DOM entries.** `GeometryEntry` carries `el: HTMLElement`; entries are built from `article.children` by a
   `MutationObserver` and sized by a `ResizeObserver`. A block that is not mounted has no record, so the table cannot
   answer "where is byte N" for an unmounted block, which is the point of the windowing table (CM6's gaps exist for
   exactly that).
2. **The estimate is height 0 under the previous block.** `newEntry` places a new entry at `prev.top + prev.height` with `height = 0` until the
   observer reports. There is no oracle (CM6's `HeightOracle`), so total height is wrong by the whole unmounted part and a
   scrollbar cannot be right.
3. **Absolute tops, O(n) shifts.** Records store `top`; `settleRecords` shifts every record in a run by one delta read at the run's
   ends. CM6 stores heights and derives tops (O(log n) update). The run trick (read two ends instead of every block) is
   clever and cheap for the mounted case, and its halving search repairs a margin that moved without a size change; but
   it relies on layout, which unmounted blocks lack.
4. **Heights in CSS pixels with a half-pixel tolerance** (`same`: `Math.abs(a - b) <= 0.5`), not whole grid units; a unit
   table would not need the tolerance and would make "unchanged" exact.
5. **Inner blocks** (list items, quote paragraphs) are measured on demand for the entries around a place
   (`near`, `nearByte`, `INNER_KEPT = 64`): a position finer than the top-level block. A byte-table needs a rule for the
   same finer position inside a block (CM6 never needed it: one line, one block; in this app, a position within a 10,000-line code block or a long list
   is the case to design).
6. **Out-of-flow children** (margin notes) are excluded by a `getComputedStyle` check: a DOM concern the byte table
   avoids by being keyed on source blocks.
7. `recordWindow` limits the search to 64 records each way; fine.
Verdict: keep `geometry.ts`'s lookups and the run settling as the *measured feeder* for the mounted window; replace the
store with the HMP-09 table keyed by block index, with estimates from a byte-length oracle.

### HMP-13 · Google Docs: canvas, and an accessibility layer promised  `[confirmed]` (thin)
Google moved from "HTML-based rendering" to "a canvas-based approach to improve performance and improve consistency" and
states that "Compatibility for supported assistive technologies such as screen readers, braille devices, and screen magnification features, will not be impacted" [14]. The post gives no data structure. Anything more (a hidden DOM
accessibility layer) is not in this source; cross-lead vector 07.

### HMP-14 · Paged.js, Vivliostyle, Readium: no windowing found  `[absence]`
Paged.js describes itself as a library "to display paginated content in the browser and to generate print books" [15]; its
README documents no windowing, and `flow.total` pages is reported after the whole flow is laid out. I did not read the chunker's code,
so the claim that it lays out every page up front is `[likely]`, not confirmed. A second pass re-read the Paged.js 0.4.3 README with the same result (this chapter cites 0.4.1); the Readium searches read no page. Vivliostyle's README mentions no lazy page
layout either, and I did not read Readium's source. Paginated readers sequence pages by layout and so cannot have a
pre-layout height map: page n's start depends on pages 0..n-1.
**Searched:** Paged.js README (unpkg) and a web search "Paged.js chunker large documents"; Vivliostyle README (GitHub raw) and the same search;
Readium: only the search, no page read.

## Options compared

| Option | Lookups | Update | Fits |
|---|---|---|---|
| Array + lazy prefix (Monaco) | y O(log n), byte O(log n), index O(1) | O(n - low) per batch; splice O(n) | up to ~10^5 blocks; simplest |
| Fenwick | y by descent O(log n) | point O(log n); insert = rebuild O(n) | many scattered measurements at big n |
| Aggregate tree (CM6) | all O(log n) | O(log n) incl. insert | millions; large code |
| Candidate (DOM entries + run settle) | O(log n) | O(runs) reads, O(n) shift | mounted blocks only |

## Open questions

- Per-block estimate quality for Markdown (tables, fences, images) in grid units: vector 06 and 09.
- Position inside a huge block (code fence, list): block-level table plus a line index inside the block, or sub-blocks?
- Measure the lazy prefix rebuild at 20,000 and 100,000 blocks (unit benchmark; none found).

## Cross-links

Vector 01 (what reads DOM geometry), 03 (node budget), 06 (anchoring, estimates), 07 (a11y for Google Docs, CM6
`aria`), 08 (find and copy over bytes), 10 (editing: the splice API here). Large-files: EDS-01 to EDS-06, DOM-03, DOM-06, MDA-06.

## Sources

Accessed 2026-11-27 unless noted.
1. https://raw.githubusercontent.com/codemirror/view/main/src/heightmap.ts
2. https://raw.githubusercontent.com/codemirror/view/main/src/viewstate.ts
3. https://raw.githubusercontent.com/codemirror/view/main/CHANGELOG.md
4. https://discuss.codemirror.net/t/content-height-changes-on-scroll-with-line-wrapping/8008
5. https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/viewLayout/linesLayout.ts
6. https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_viewer.js
7. https://raw.githubusercontent.com/mozilla/pdf.js/master/web/ui_utils.js
8. https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_rendering_queue.js
9. https://discuss.prosemirror.net/t/efficient-viewport-rendering-like-codemirror/577
10. https://discuss.prosemirror.net/t/lazy-rendering-for-prosemirror/1486
11. https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/model/textModel.ts
12. https://community.obsidian.md/plugins/reading-view-full-range
13. https://forum.obsidian.md/t/reading-mode-and-canvas-implement-some-form-of-progressive-rendering-for-long-lists-and-callouts/90646
14. https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html
15. https://unpkg.com/pagedjs@0.4.1/README.md
16. Repository paths read (commit f4fda854): `origin/agent/geometry-table:packages/core/src/position/geometry.ts` and `:apps/desktop/src/view/block-geometry.ts`.
