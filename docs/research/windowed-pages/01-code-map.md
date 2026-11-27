---
corpus: windowed-pages
id: 01
slug: code-map
prefix: CMP
title: What the code reads, and what a geometry table must offer
researched: 2026-11-27
confidence: high
volatility: medium
status: active
keywords: [geometry table, getBoundingClientRect, ResizeObserver, IntersectionObserver, zero rect, content-visibility, rendered-view, progressive mount, typesetter grid pass, build order, node budget]
---

# 01 · What the code reads, and what a geometry table must offer

> Question (Q-01, Q-11, Q-12, Q-13): which code reads DOM geometry or assumes every block is mounted, what API the geometry table must therefore offer, in what order the five pieces should be built, and which whole-page fixes windowing makes moot. Code read: `origin/main` at the worktree head `a6d7fab5` (2026-11-27), the held table branch at tag `archive/branch/geometry-table-rebuild-phase1` (`cf4986cb`; the branch tip adds only a handoff note, no call sites in `rendered-view.ts`), and wave 5's builder and reviewer reports for the lost first build. Answer in brief: the code splits cleanly into three kinds of reader. Most of the weight sits in one place, `view/rendered-view.ts`, which rebuilds a whole-page block list by DOM measurement after almost every event; a second place, the typesetter's grid pass and queue, reads a rect of every top-level block; and a long tail of per-feature scans (find, copy, notes, spine, outline follow-dot, print) each assume the whole article is in the DOM. The held table fits the first group, which is why it cut so little, and it cannot serve the other two because it is built from the mounted DOM and has no entry for a block that is not there.

## TL;DR

- Nearly all geometry reads that scale with the page come from three sources: the whole-page block list (`buildBlocks`, `buildBlocksByRange`, rebuilt at about a dozen sites in `rendered-view.ts`), the typesetter's grid pass and queue (a rect for every top-level block each round), and per-feature `querySelectorAll` scans over the article. CMP-01, CMP-02, CMP-04, CMP-05.
- Reads that are about the scroller and the viewport (scrollTop, clientHeight, scrollHeight in the hold and pin mechanisms) are small, constant per event and stay. Reads on one block (a code block's caret line, a margin note, a wide table) are bounded by what is on screen and only need gating. CMP-03, CMP-10.
- Four readers treat a zero rect as "not shown": the block list, the typesetter's viewport bisection, the outline's follow-dot and the part-notes layer. Under `content-visibility: hidden` they would drop the page; under `auto` they see the intrinsic-size box and misread an estimate as a measurement. Find's landing skips silently on a rect with no box. CMP-06.
- Everything that is "the whole page is mounted" is expressed as a handful of seams that already exist: `mountThrough` (about 25 call sites, three of them mount-everything), the progressive mount's `isComplete`/`complete`/`pending`, and `afterComplete`. Windowing changes their meaning from "all in" to "near is in"; no new seam is needed, but every gate has to be re-read. CMP-07, CMP-08.
- The held table is derived from `article.children` and a ResizeObserver per block. Its estimate for a new block is "directly under the one before, height 0, until reported". It has no byte-only entries, no total height, no way to say "mount these", no text offsets and no splice or shift for bytes, so it covers the position, restore, spine and hold readers and none of find, copy, print, jump or the budget. CMP-11, CMP-12.
- Build order: scale record and geometry table (rewritten as a byte model with entries for unmounted blocks) first and in parallel; typesetting by distance next; tier 1 and tier 2 on top, tier 2 last. The whole-page fixes that are moot above the node budget are the End key, select-all and copy cost, find on a still-mounting page, the busy 1 MB open, position cost per key, and width-change relayout; the grid-pass cost, Source-and-back, edit and undo costs still matter below the budget. CMP-13, CMP-14, CMP-15.

## Recommendation

Treat the table as the model of the page, not as a cache of the DOM. Concretely:

1. **Rewrite the table's core as a byte-keyed array of block records** (byte range, height in grid units, a flag for estimated or measured, a mounted element or none), built from the parse's top-level blocks before any HTML is made. The held branch's pure half (`packages/core/src/position/geometry.ts`: binary search by y and by byte, run settling) and its tests can be kept; its DOM half (`view/block-geometry.ts`: observers, `rebuild` from `article.children`) becomes one *mounted-set* adapter that reports measurements into the table.
2. **Move the readers in this order of payoff**: position and restore (the per-key and per-scroll cost), the spine (needs total height), the typesetter's queue and grid pass (the open cost), then find, copy and select-all, then jump targets (outline, links, search results), then print and the lens features. Each reader gets either a table call (CMP-11) or a gate ("only mounted blocks"), as the inventory in CMP-01 lists.
3. **Keep the scroller-level hold mechanisms** (end pin, resize hold, landing hold) but make them read heights from the table, so they stop asking the browser for `scrollHeight` of a page whose height is partly an estimate.
4. **Do not land the held branch as it is.** Land its tests and its pure half; replace its DOM half. The four bugs wave 5's reviewers found (margin notes as entries, margin-only changes, stale inner positions, late re-notification of the outline) are all consequences of deriving the table from the DOM, and each guard stays needed for the mounted-set adapter.
5. **Gate by one scale record** (size, blocks, nodes) read in one place: below the node budget the mounted set is the whole page and nothing else changes; above it, the mounted set is the blocks near the reader. The same table, the same readers, one path.

Confidence: high on the inventory and the branch's coverage (read from source); medium on the build sizes (they are judgements from file coupling and the tracker's own sizes, not measurements).

## Findings

### CMP-01 · The whole inventory in one table: which reads, which feature, how often, what to do  `[confirmed]`

Source: `rg` over `apps/desktop/src` and `packages/typeset/src` for `getBoundingClientRect`, `getClientRects`, `offset*`, `client*`, `scrollTop`, `scrollHeight`, `IntersectionObserver`, `ResizeObserver`, `caretRangeFromPoint`, `elementFromPoint`, `getComputedStyle`, `querySelectorAll`, `lastElementChild`, `.children`; the viewers (hex, pdf, image, archive, sheet, book, media, table lens, the left-panel row window, the transcript and reading views) are skipped, because each draws its own windowed or small page and does not read the Markdown article. The files with the most hits are `view/rendered-view.ts` (64), `packages/typeset/src/index.ts` (49), then the viewers and `find/view.ts` (17), `frame/spine.ts` (15), `selection/view.ts` and `selection/bind.ts`.

Frequency: *open* is once per document, *chunk* once per progressive-mount chunk, *scroll* per scroll event or frame, *key* per cursor key, *edit* per splice or block commit, *width* per width change, *find* per find query or step, *once* when a feature is invoked.

| Where | What it reads | Feature | How often | Verdict |
|---|---|---|---|---|
| `render/post.ts:111-131` `buildBlocksByRange`, `:133-150` `buildBlocks` | `querySelectorAll` over the article, `getComputedStyle(el).display` and `getBoundingClientRect()` for every candidate, plus the article's own top | the whole-page block list that position, restore, spine and holds search | open, chunk, edit, width, theme, Source return, `holdPlace` (twice) | replace with table calls; kept only as a test oracle |
| `view/rendered-view.ts:778-779` `blocksOf`, and its callers `:801, 834, 1448, 1483, 1549, 2307, 2687, 2691, 3028, 3031` | rebuilds the list above | position keeping | each chunk, grid pass, splice, Source return, hold | replace |
| `view/rendered-view.ts:438-439, 906` | scroller top, article offset, reading line in px | position, spine | scroll | keep (constant, small) |
| `view/rendered-view.ts:467, 476-491, 1884, 2970-2977` `distanceToEnd`, `notePinned`, `endObserver` | `scrollHeight - clientHeight - scrollTop`; a ResizeObserver on the article; `scrollTop = scrollHeight` | End key, the end pin | scroll, article resize | keep, but read the end from the table's total height (CMP-08) |
| `view/rendered-view.ts:1125-1160` `codeLineAt` | one code block's rect, `caretRangeFromPoint` at the reading line, `range.getClientRects()` | source line of the reading line | place read | gate (only the block under the line, always mounted) |
| `view/rendered-view.ts:1199` `exactBlock` | `blockContaining(...).el.getBoundingClientRect().height` | Source-return exactness | once per return | replace (table height) |
| `view/rendered-view.ts:1601-1611` `blockContaining`, `:1648-1674` `landOn`, `restoreTo` | linear scan of `shown.blocks`, `mountThrough(byte)` first | jumps, restore, place across modes | per jump | replace with `indexAtByte` |
| `view/rendered-view.ts:1482, 1493, 1542` | `getComputedStyle(article).lineHeight` then the grid pass | grid padding | open, chunk, edit, width | keep (once per pass); the pass itself is CMP-04 |
| `view/rendered-view.ts:1790-1830` width observer | `article.clientWidth`; before a relayout reads the place from the block list | width change | width | keep the observer, replace the place read |
| `view/rendered-view.ts:1755-1768` `islandObserver` | a ResizeObserver per `pre, table, img, math` (grows with their count) | grid pad when an island changes height | open, chunk | gate (mounted only) |
| `view/rendered-view.ts:3024-3040` `holdPlace`, `followGrowth` | rebuilds the whole list before and after a change; one block's bottom | block edit, margin notes | edit | replace `holdPlace` (read the block under the line before and after); keep `followGrowth` |
| `view/rendered-view.ts:316-322` `mountedBytes` | `lastElementChild` walk for `data-marxy-e` | "how much is in" | per chunk and spine draw | replace (table knows the end) |
| `packages/typeset/src/grid.ts:119-124, 289` | `[...article.children].filter(isBlock)`, a rect for every child each round, up to the round cap | baseline-grid padding | open, chunk (windowed), edit, width | gate to blocks near the reader, then replace tops with the table's (CMP-04) |
| `packages/typeset/src/grid.ts:87-93, 202` | every island's `getBoundingClientRect().height` | pad after an image or table loads | per island change | gate |
| `packages/typeset/src/index.ts:819-884` `layout` | `querySelectorAll(CANDIDATES)` over the article; `getComputedStyle` per child; a bisection of rects over top-level blocks; a rect per paragraph the screen meets | first screens set synchronously | open, width | replace the bisection with `indexAtY`; the candidate list becomes the near set |
| `packages/typeset/src/index.ts:904-945` IntersectionObservers (200% margin, no `root`) | which queued paragraphs are near | the idle queue | scroll | replace by distance from the table (CMP-05) |
| `packages/typeset/src/index.ts:360-460, 528` keep-place | `caretRangeFromPoint`, `elementFromPoint`, rects of the block under the line before and after a pass | holding the page still while paragraphs are set | each pass | keep (bounded to the line) |
| `packages/typeset/src/measure.ts`, `apply.ts`, `hang.ts` | probe and range rects inside one paragraph; `getComputedStyle` of one element | line breaking | per paragraph set | keep (per-paragraph, cost is CMP-09's concern, vector 09) |
| `find/walk.ts:60-90` `collectText` | a `TreeWalker` over every text node of the article | find index | per query run | gate now (mounted only); replace in tier 2 with a text model (CMP-09) |
| `find/view.ts:107-115, 386-425, 445-450` | `getClientRects()` on the current match, a window of held Ranges two screens up and three down, `layer.getBoundingClientRect()` | highlights, count, landing | find step, scroll | keep the window (it already caps ranges); gate the landing (CMP-06) |
| `find/view.ts:511-567` `land` | `getClientRects` top of the match, scrollable inner containers, `el.scrollTop += delta` | landing a match on the reading line | per step | keep, after the block is mounted |
| `find/view.ts:693-715` | re-runs when `contentComplete()` resolves | find on a long page | open | change meaning (CMP-07) |
| `selection/view.ts:662, 975-980` `blockCarrierAt`, `startPart` | `querySelectorAll('[data-marxy-s]')` linear scan; a rect per element until one is below the reading line | keyboard cursor entry and moves | key (entry), cursor move | replace with `indexAtByte`/`indexAtY` |
| `selection/copy-text.ts:111, 138` `fenceCode`, run pieces | `querySelectorAll` of fences and run pieces, `range.intersectsNode` for each | copy as source | copy | gate to the range's blocks, by byte |
| `selection/drag.ts:25`, `selection/bind.ts:136-165` | rects of the selection's end blocks | verb bar placement | selection change | keep |
| `frame/spine.ts:76-93` `geometry()` | article and scroller rects, `pane.view.blocks()`, a `lastElementChild` walk, `scrollHeight` | the spine and minimap thumb and click | scroll, resize, draw | replace with the table's total height and bytes; the byte-based extrapolation in `frame/spine-map.ts:27-30` is a ready precedent |
| `left/panels/outline.ts:94` and the `starts` path (`:797-805`) | the headings from the AST; the follow-dot from the reading position's byte | outline for Markdown | scroll | keep (no DOM) |
| `left/panels/outline.ts:808-815` | `getClientRects().length > 0 && getBoundingClientRect().top <= line` for each unit element | the outline's follow-dot for kinds with units | scroll | gate; not the Markdown path |
| `notes/margin.ts:50-66, 201-226` | `querySelectorAll('[data-marxy-s]')` per note to find its carrier, rects of every note box, a ResizeObserver | notes in the margin | notes change, width | gate (notes on unmounted blocks wait) |
| `notes/part-notes.ts:60-96, 147` | `getClientRects().length === 0 → skip`, rects per note | notes on tables and parts | notes change, scroll | gate; zero rect as hidden (CMP-06) |
| `render/wide-tables.ts:156-205` | a ResizeObserver on every wide table and drawable `pre`; cell rects of the first rows | wide tables | open, chunk | gate |
| `render/highlight.ts:460-500, 707` | an IntersectionObserver over code pieces, a rect per piece | code colour | scroll | keep (already lazy: the model for the rest) |
| `commands/block-edit.ts:84-100, 414-422` | linear `querySelectorAll` for the block's elements; the editor host's height and a ResizeObserver | editing a block in Read | edit | gate (the block is mounted by definition) |
| `render/incremental.ts:256-286` | shifts `data-marxy-s`/`-e` on every element after a splice, live then pending | splice and reload | edit | replace (the table shifts bytes; only mounted elements get attributes) |
| `export/page.ts:140-167` | writes a print style that hides blocks outside the range, then `window.print()` | print and PDF | once | gate: needs every block mounted and set (CMP-10) |
| `depths/lens.ts:109, 147`, `commands/depths.ts` | `mountThrough(Number.MAX_SAFE_INTEGER)`, then DOM filters over the whole article | lenses, folds, x-ray | once per use | change: needs the AST path or a budget exception |

The three categories that matter: *replace* (a table call does it better and cheaper), *gate* (it is correct on the mounted set, so it needs a rule about what happens to blocks that are not mounted), *keep* (constant per event or bounded to the line).

### CMP-02 · One function rebuilds the whole block list after nearly every event  `[confirmed]`

`blocksOf` (`apps/desktop/src/view/rendered-view.ts:778-779`) calls `buildBlocks` or `buildBlocksByRange` (`apps/desktop/src/render/post.ts:111-150`), which `querySelectorAll`s the article, reads `getComputedStyle(el).display` for every carrier and one `getBoundingClientRect()` for every kept one, and stores the result in `shown.blocks`. It is called from the rows and lines `onDrawn` handlers (`:801`, `:834`), `restoreTo` after a relayout (`:1448`), after each grid pass (`:1483`, `:1549`), after the splice or block-edit path (`:2307`), after every `mountThrough` that adds blocks (`:2687`, `:2691`), and twice inside `holdPlace` (`:3028`, `:3031`). `blocksOf` also has a `derived` (transcript) branch, `derived.blocks()`, which this chapter does not follow. `currentPosition` and `restoreTo` then search that list linearly or by binary search (`blockContaining`, `:1601-1611`, is linear). This is the mechanism behind the tracker's "keys and scrolls read positions across every block" and "width change calls `getBoundingClientRect` about 7,000 times at 1 MB". The held table replaces exactly this reader (CMP-11, CMP-12), and wave 5 measured the removal: Source-to-Read layouts 60 → 54 and open layouts 472 → 420 on a 195 KB page (a wave 5 report, not re-run; the 472 was taken against a master run under load, and the report calls the durations "not comparable"; `[measured]`), i.e. the list rebuild was a minority of the layouts (CMP-12). The reads it replaces are real, but the open cost has other owners (CMP-04, CMP-07).

### CMP-03 · The scroller-level readers are small and should stay  `[confirmed]`

`scrollTop`, `clientHeight` and `scrollHeight` appear in the seen-scroll record (`rendered-view.ts:427-445`), the landing record (`:512-521`), the end pin (`:467-491`) and the end observer (`:1882-1886`). Each is one read per scroll event. They are the *write* side of position keeping: `scroller.scrollTop = ...` at `:491`, `:806`, `:839`, `:1533`, `:2974`, `:3038`. Their number is the problem the hold mechanisms exist for, not a scaling cost. There are at least seven distinct holds in the one function: the end pin (`endPinned`), the landing record (`landedAt`), the restored record (`restored`), the held anchor (`anchor`, `heldPosition`, `holdAnchor` at `:1613`), the resize hold (`resizeHold`, `holdThroughResize` at `:1814-1830`), `holdPlace` (`:3024`) and `followGrowth` (`:3037`); plus the typesetter's own keep-place (`packages/typeset/src/index.ts:360-531`). The table does not remove them; it changes what they hold *against*: a height that may be an estimate. That is why correcting estimates without a jump (vector 06) is a precondition for tier 2 and not a polish step.

### CMP-04 · The typesetter's grid pass reads a rect of every top-level block each round  `[confirmed]`

`packages/typeset/src/grid.ts:119` builds `[...article.children].filter(isBlock)` for a whole-page pass; `:123-124` reads `article.getBoundingClientRect().top` and a rect per child each of up to a bounded number of rounds; `:289` does the same walk for `snapInSlices`. A windowed pass (`opts.through`, `tail`) exists already and reads only a tail plus one block after it. The grid pass is what makes heights whole line-box units, so it is also what makes the table's "height in grid units" true: it pads a block so the next starts on the grid. Two consequences for the plan. First, under tier 1 a skipped block's rect is its `contain-intrinsic-size`, so a grid pass over skipped blocks would pad against an estimate and then be wrong when the block is laid out; the pass must be limited to blocks that have been laid out. Second, under any windowing the pass is naturally a mounted-set operation, with the table supplying tops instead of a rect read per child. The tracker records the pass over islands that changed height costing 12 s at 250 KB to 220 s at 1 MB on a block-dense page (Chromium); that cost sits *below* a 5 MB cut and is independent of the table (CMP-14).

### CMP-05 · The typesetter queue is ordered by an unrooted IntersectionObserver and a whole-article candidate list  `[confirmed]`

`packages/typeset/src/index.ts:819` collects every paragraph candidate in the article; `:845-884` bisects top-level block rects to find what the first screen meets; `:904-945` observes the queue with `rootMargin: '200% 0px'` and, in the main tree, no `root`. Wave 5's near-typeset reviewers found the consequence in two panes: with the scroller being the pane and no `root`, the observer's box is clipped to the pane, the margins come to nothing, and a paragraph was set only after it had painted unset (107 of 300 frames in WebKit, 0 with a `root`). Typesetting by distance wants distance from the reading line, which the table gives directly (`indexAtY`, then walk outward by blocks), without an observer per paragraph and without the pane-clipping failure. The branch kept the observers and added `root`; with the table the bound can be a block index range.

### CMP-06 · Four readers treat a zero rect as "not shown"; content-visibility changes what a rect means  `[confirmed]` for the code, `[likely]` for the engine behaviour

The readers: (1) `render/post.ts:115, :117` drop any carrier whose `getBoundingClientRect().height` is 0 from the block list; (2) `packages/typeset/src/index.ts:855` takes `r.width > 0 || r.height > 0` as "has a box" and otherwise lets a block stand where the next shown block does ("a hidden block (a folded section) has no box"); (3) `left/panels/outline.ts:815` requires `getClientRects().length > 0` for a unit to count; (4) `notes/part-notes.ts:60` skips an element with `getClientRects().length === 0`. Also `find/view.ts:107-115` filters empty boxes and `land()` returns with no scroll when `topOf(match)` is null (about `:563-565`).

Two cases under content-visibility. Under `content-visibility: hidden` on the whole page (hiding Read behind Source), descendants have no boxes, so (1) and (2) read an empty page: this is the warning in wave 5's review, and it is why a hidden Read page must not be measured. Under `content-visibility: auto`, a skipped block *does* have a box, of `contain-intrinsic-size`, so (1) and (2) read an estimate as if it were a layout, and the grid pass (CMP-04) pads against it. A Range inside a skipped block has no layout; what `getClientRects()` returns there is engine behaviour that vector 02 and 05 measure (I did not run it), but find's landing already tolerates a null top by doing nothing, which would be a silent failure when the match is in a skipped block. The table helps by making "not mounted or not laid out" a first-class state (`measured: false`) instead of an inference from a zero rect. The pages in this repository already use `content-visibility: auto` with `contain-intrinsic-size: auto <200 lines>` for log pieces (`packages/theme/src/base.css:603-604`), so one in-tree precedent exists for a block whose room is "a full piece until it has been laid out, and then what it was".

### CMP-07 · "The page is complete" is a gate in six places  `[confirmed]`

`ProgressiveMount` (`render/progressive.ts:~26-34`) offers `complete`, `isComplete()`, `ensureThrough(byte)`, `cancel()` and `pending()`. Their consumers: the end pin only starts when the mount is complete (`rendered-view.ts:477`); the quiet check includes an incomplete mount (`:1503`); `typeset_done` waits for it (`:2434-2436`); images, KaTeX and highlighting start after it (`afterComplete`, `:2695-2701`, `:2662`); `atEnd` needs it (`:2970`); and find re-runs its search when `contentComplete()` resolves (`find/view.ts:700-715`), which is why it counts only what is mounted until then. Under tier 2 above the budget the mount is *never* complete. Each of these gates needs a replacement meaning: "the near window is in and set", for the typesetter and the pin; "text model ready", for find (it must stop depending on the DOM); "blocks in the window", for images, KaTeX and highlighting (highlight already uses an IntersectionObserver, `render/highlight.ts:484-496`). The progressive mount's `pending()` is already the "blocks not in the page" store: it is an inert container of rendered blocks, edited by `incremental.ts` as the page is (`:62-66`, `:195-286`). Windowing generalises it from "not yet" to "not now" (with the cost, for tier 2, that the inert container still holds the nodes: memory and parse cost stay, only layout and style go, which is the unresolved question of vector 03).

### CMP-08 · `mountThrough` is the seam: about 25 call sites, three that mount everything  `[confirmed]`

`mountThrough(byte)` (`rendered-view.ts:2674-2693`) is declared in the app handle (`app-types.ts:253`) and called by: the position landing and restore paths (`rendered-view.ts:1067, 1648, 1674, 2499, 2583, 2986`), selection (`selection/view.ts:415, 948, 1087, 1107`), the search panel (`left/panels/search.ts:356`), links (`left/panels/links.ts:107`), the log jump (`commands/log.ts:256`), the depths and fold commands (`commands/depths.ts:48`, `left/doc-shared.ts:24`), x-ray (`parts/cursor.ts:105`), pane focus (`pane/focus.ts:94`), the harness and `app.ts` (`:150, 222`). Two call it with `Number.MAX_SAFE_INTEGER` (`depths/lens.ts:109, 147`), which means "mount everything", exactly what tier 2 cannot do. A third, `depths/dress.ts:183` (`mountThrough(bytes.length)`), mounts the whole page whenever a reveal, fold, focus or lens is active; `depths/dress.ts:373`, `line/go.ts:96` and `harness/app-harness.ts:77` are also callers. These three sites are the ones that contradict windowing; the rest ask for a byte and are already shaped like "ensure the window contains this byte". The same function must also serve the End key: today End goes to the last *mounted* block (`:2970-2977`, `distanceToEnd`), the source of the End-stops-short bug; with the table, End is "scroll to the table's total height, mount near the end, correct the estimate" and the pin keeps the end as measurement replaces estimate.

### CMP-09 · Find, copy and select-all are DOM-first; the selection layer is already AST-first  `[confirmed]`

Find builds its index from a `TreeWalker` over the article's text nodes (`find/walk.ts:60-90`, `collectText`; `find/text-index.ts`), resolves matches to Ranges from a fresh walk each time because the typesetter splits text nodes (`find/walk.ts:15-16`), and keeps highlights as a window of held Ranges two screens up and three down (`find/view.ts:386-425`, the `WHOLE_LIMIT` rule at `:354, 597`). The window is the right shape and already bounded. What fails is the index: it is the mounted text. Copy as source works from the buffer for code fences (`selection/copy-text.ts:111-175`, `fenceCode`) and from the live selection's cloned range otherwise (`selection/copy-html.ts:59-66`), and native select-all selects the DOM, so it copies only what is mounted. By contrast the keyboard cursor and the structural verbs work on the AST (`selection/selection.ts:67-145`, `selection/cursor.ts`) and need the DOM only to resolve a block to an element (`blockCarrierAt`, `selection/view.ts:662`) and to scroll to it (`:390-391`). So the seam for tier 2 is: find and copy become functions of *bytes and the text model*, and a match or a selection end is turned into "scroll here and mount this block" through the table (CMP-11, vector 08).

### CMP-10 · Print and export: HTML, zip and brief come from bytes; print needs the DOM  `[confirmed]`

`export/page.ts:140-167` makes print by writing a style sheet that hides the blocks outside the chosen range and calling `window.print()`: it prints whatever is mounted and laid out, so it assumes the whole article is in the DOM and, as wave 5's near-typeset builder found, every paragraph set (a new `setAll()` was added for it). The other exports build from the file: `render/export-file.ts:11-13` renders the sanitised page from the bytes in a separate document, and `ExportAs` (`export/model.ts:8`) lists html, raw, text, jsonl, html1, md1, zip, trmd and brief. So only print and PDF need an exception to the node budget: either mount and set everything for the duration (above the budget, a large transient cost the app declines to pay silently), or print an off-screen render made from the bytes, as the HTML export already is. This is a decision, not a finding about code; the code only says the second option has a precedent.

### CMP-11 · The API the table must offer, from the callers' needs  `[confirmed]` for the calls' existence, `[likely]` for the list's completeness

Derived from the inventory (CMP-01) and the seams (CMP-07 to CMP-10). Names are descriptive, not final.

| Need | Callers | Call |
|---|---|---|
| Place from scroll | `currentPosition`, spine thumb, saved place | `blockAtY(y)`, then `positionAt(y)` → `{byte, fraction}` |
| Scroll from place | `restoreTo`, `landOn`, Source return, find landing, outline and link jumps, selection reveal | `yOfByte(byte, fraction)` (an estimate while the block is unmounted) |
| Which block holds a byte | `blockContaining`, `blockCarrierAt`, `elementsFor`, notes, edit | `indexAtByte(byte)`; `entry(i)` with `start`, `end`, `height`, `measured`, `el | null` |
| Total height | spine, End key, end pin, scrollbar | `totalHeight()`, `estimatedFraction()` |
| What to mount | the mounting policy, typesetter queue, grid pass | `window(y, screensAbove, screensBelow)` → block indices; `mountedRange()` |
| Ensure a byte is there | `mountThrough` and its ~25 callers, jumps, find, selection | `ensureMounted(byte)` (async when typesetting is needed), then `whenSettled()` |
| Text and byte view | find, select-all, copy | `textOf(range)`, `blockText(i)`; the text index keyed by block, not by DOM node |
| A measurement came in | the mounted-set adapter (ResizeObserver) | `measure(i, heightInGridUnits, top?)`; returns whether anything above the reader moved |
| A splice | block edit, undo, reload (`incremental.ts`) | `splice(byteFrom, byteTo, newBlocks)` shifting bytes after it; entries replaced or kept |
| Estimate | open, width change, never-mounted blocks | `estimate(i)` from bytes and kind (code lines, list items, rows) in whole grid units; `setWidth(w)` invalidating the estimated ones |
| Whole-page stats | the scale record, node budget | `counts()`: blocks, nodes mounted, bytes estimated vs measured |
| Out-of-flow children | margin notes, floats | not entries; kept outside as the held branch does |
| Told when it moved | readers that ran in a frame | `onMoved(fn)` (the held branch's fix for the late outline crumbs) |
| Print/lens exceptions | print, depths lenses | `mountAll()` with a stated cost, or an off-screen path (CMP-10) |

Each row is a caller that exists today. Not on the list because no caller needs it: a `y` for every inner block (list item, table row) of unmounted blocks; an observer on every block (only mounted blocks need one).

### CMP-12 · The held table covers the mounted-DOM readers and nothing that needs an unmounted block  `[confirmed]`

What it is (`view/block-geometry.ts` and `packages/core/src/position/geometry.ts` at `cf4986cb`): one entry per child of the article (element, `top`, `height`, `measured`, `start`, `end` read from the element's attributes), built by `rebuild()` from `article.children` after a MutationObserver callback (`block-geometry.ts:185-205`), kept current by a ResizeObserver that reports changed blocks once per frame, with the blocks between settled by one shift read at each run's two ends (`settleRecords`). A new block is an "estimate under the one before it", that is directly under it with height zero, until its first size report (`newEntry`, `:176-180`, and the header comment). Finer positions (list items, rows) are measured only for the entries around the reading line (`near(y)`, `nearByte(byte)`, `INNER_KEPT = 64`). Its API: `entries()`, `indexAtY`, `indexAtByte`, `near`, `nearByte`, `forgetInner`, `onMoved`, `destroy`, `version`, `stats`; and in the app `positionNear`, `scrollTopNear` (`position/position.ts`).

| Needs in CMP-11 | Branch |
|---|---|
| Place from scroll, scroll from place | covered (`positionNear`, `scrollTopNear`) over mounted blocks |
| Which block holds a byte | covered for mounted blocks (`indexAtByte`) |
| Told when it moved | covered (`onMoved`) |
| Out-of-flow children | covered (margin notes excluded, a fix from review) |
| Measurement without reading the page | covered in observer callbacks |
| Total height | missing (no sum of estimates, no unmounted entries) |
| Entries for blocks not mounted | missing: the table is *derived from* `article.children` |
| Estimates from bytes in grid units | missing: an estimate is a zero-height placeholder |
| What to mount, ensure mounted | missing |
| Text and byte view | missing |
| Splice and byte shift | missing: ranges are read from element attributes each time, so a splice that shifts attributes on every later element (`incremental.ts:256-286`) is how the table learns |
| Width invalidation of estimates | missing |
| Whole-page stats | partial (`stats` counts reads, not blocks) |
| Observer cost | acceptable for the mounted set: wave 5's measurements are +1.2 ms per frame at 10,000 blocks when one changes in Edge, +5.5 ms in WebKit, 2-6 ms to deliver 10,000 notifications, on synthetic pages, not the 1 MB document |

Wave 5's own account of what it bought is modest (from a wave 5 report, not re-run; the 472 → 420 comparison was taken against a master run under load and the report calls durations "not comparable"; `[measured]`): open layouts 472 → 420, tab switch back 622 → 534, Source to Read 60 → 54 on a 195 KB reference page, and the builder named the Source-to-Read target "a fraction" as not met. The table's value is as the base, not as the optimisation. The pure half is worth keeping as is: it has no DOM and its tests compare the table with a whole-page measurement after each kind of change.

### CMP-13 · Why the held design is the wrong shape for the owner's direction: its four review bugs all come from deriving the table from the DOM  `[confirmed]`

Wave 5's two reviews and the delta review found, each shown in WebKit through the app: (1) margin notes, absolutely positioned children of the article, became entries at the end, out of byte order, so the last ~20% of a long reference read a footnote's byte as the place; (2) a margin-only change moved blocks without changing any size, which a size-notification table never sees; (3) a list item grew in the same frame as the grid pass padded its block back to the old height, so cached inner positions went stale (fractions off by ~0.06); (4) a 20,000-heading page's late crumbs were never re-told after the table moved. The reviews also record that near-typeset's keepPlace and the table interact (the table's re-notification is not a scroll event) and that all three of its IntersectionObservers lacked a `root` (CMP-05). A byte-keyed table whose heights come from measurement *reports* instead of being re-read from the page does not have bugs (1) and (4) by construction (an entry exists per parsed block; readers query an index), and has (2) and (3) only for the mounted set. The old lesson stands: an outline of 20,000 headings broke the first build, so the table must be tested against the largest block counts before it is trusted, with the 20,000-heading test run alone, as the handoff says.

### CMP-14 · Build order, sizes and conflicts  `[likely]`

Sizes are the tracker's own where it has a row, otherwise judged from the files touched. "Conflicts" are files two pieces both have to edit.

| Piece | Size | Depends on | Files it owns | Conflicts with |
|---|---|---|---|---|
| (b) Scale record at open: bytes, lines, longest line, then blocks, items, rows; classes; one place all features read | M | none | `document/open.ts`, a new `scale/` module, the per-feature limits in `docs/file-kinds.md` | little: each feature's limit constant moves later |
| (a) Geometry table as a byte model: `packages/core` pure part (extend `geometry.ts`: estimates, total, splice, window), `view/block-geometry.ts` as the mounted-set adapter, `position/position.ts`; then the call-site phase in `view/rendered-view.ts`, `render/post.ts`, `frame/spine.ts`, `frame/spine-map.ts`, `render/incremental.ts` | L: core and adapter M, call sites M-L | none for core; the scale record for the node budget | above | `rendered-view.ts` (about 3,100 lines, 7 holds) is the bottleneck; the planned split of `createRenderedView` and the typesetter `attach()` collides with it |
| (c) Typesetting by distance: bound the queue to the near blocks, `setAll()` for print and the gate, `done` means near is set, root-aware observers or table distance, paragraph cap | M | the table for "block under the line" and distance (can start with the reading line from the DOM, the way the lost build did) | `packages/typeset/src/index.ts`, `grid.ts`, `scheduler.ts`; `rendered-view.ts` only at its `done`/`typeset_done` gate | typeset `attach()` split; the table's call-site phase on `rendered-view.ts` |
| (d1) Windowed pages tier 1: `content-visibility: auto` plus `contain-intrinsic-size` from the table's estimates, on every top-level block | S for the CSS and the estimate hook; M with the grid-pass and zero-rect gating (CMP-04, CMP-06) | (a) estimates; (c) so the grid does not pad skipped blocks | `packages/theme/src/base.css`, `packages/typeset/src/grid.ts`, `render/post.ts` | (c) on `grid.ts` |
| (d2) Tier 2: mounting policy, unmount, `ensureMounted`, text model for find and copy, anchors, print path, a11y hooks | L | (a), (b), (c) | `render/progressive.ts`, `view/rendered-view.ts`, `find/*`, `selection/*`, `export/page.ts`, `depths/*`, `left/panels/*` | everything above; this is the last piece and the widest |
| (e) Node budget: measure the knee on both engines, set the constant, gate the policy on the scale record | S to measure (vector 03), S to wire | (b); the table to count | the scale record only | none |

Parallel: (b), (a)-core (the pure part and its tests), (e)'s measurement and (c)'s queue bound can all start together; (a)'s call-site phase and (c) both want `rendered-view.ts` and `packages/typeset/src/index.ts`, so they go in series or with one owner of each file. Tier 1 can be tried on top of (a) estimates without (d2) to settle vector 02's question cheaply. Tier 2 is last; its find and copy work can be developed against the table without the unmount switch turned on.

### CMP-15 · Which whole-page fixes are moot above the budget, and which still matter below it  `[confirmed]` for causes in code, `[likely]` for the sizes

Taken from the tracker's big-files, structure, next and later sections by what the problem is.

*Moot above the budget (the cause is "everything is mounted"; parked, or rewritten as a table call):*
- The End key stopping short on a page still mounting: the jump goes to the last mounted block (CMP-08). With total height and a byte jump it is solved by construction.
- Select-all and copy growing faster than the page and copying only the drawn part: `cloneRangeInert` tests every child; copy by byte range makes both go.
- Find counting only what is mounted and costing about half a second per key on a large page: the fix is a find over the model, which windowing needs anyway (CMP-09).
- The 1 MB open keeping the main thread busy: its cause is the forced layout per progressive-mount chunk and the whole-page typesetting queue; mounting only the window removes the page those costs scale with.
- Cost per cursor key and scroll from position reads over every block (CMP-02): solved by the table, below the budget too.
- Width-change relayout with about 7,000 rect reads at 1 MB: a width change moves every mounted block; with the table and a bounded mount it is the near window only.
- Leaving Source taking seconds because the hidden Read page is laid out again: under windowing the page that is hidden is the window.

*Still matter below the budget (the page is whole, up to the budget in nodes):*
- The grid pass over blocks that changed height: tracker figure 12 s at 250 KB (dense blocks, Chromium). A whole page below the budget has this cost; fix it in the typesetter, and let (c) bound it.
- Source-and-back, a one-block edit and undo costing 2-6 s at 1 MB: the block commit and undo set the page again instead of splicing one block, and the splice machinery (`spliceStalePage`, `rendered-view.ts:2108`; `incremental.ts`) exists. This is independent of windowing and is only *partly* moot: above the budget, the work is bounded by the window; below it, it is the splice that matters. It needs the table's `splice`.
- Opening a second large file being far slower than the first (cause not isolated): unknown, do not park.
- The progressive mount's forced layout per chunk: below the budget the page is still mounted in chunks; this stays until the mount stops forcing layout.
- Anything that has nothing to do with the Markdown page: other viewers' limits, the Markdown parse in a worker, the derived copies of the buffer, the diff and JSON costs: untouched by windowing.

The deciding rule: a fix is moot only if its cost is a function of the mounted node count *and* the mounted node count is bounded by the budget in the case that mattered. The budget's value therefore sets how many of these are parked; vector 03 gives it.

## Options compared

| Option | What it is | Fits the code | Cost | Verdict |
|---|---|---|---|---|
| A. Land the held table as is, then build windowing on it | DOM-derived, mounted-only | covers the position, restore, spine and hold readers | low | rejected as the foundation: no unmounted entries, no estimates, no splice; keep its tests and pure half |
| B. Byte-keyed table, mounted-set adapter for measurement | the table is the model; observers only report | covers every row of CMP-11 | L, one rewrite of the DOM half | recommended |
| C. Tier 1 only (CSS), no table of unmounted blocks | `content-visibility: auto` on every block; DOM stays whole | cheapest; precedent in the log pieces | S-M | not enough alone: grid pass and zero-rect readers break (CMP-04, CMP-06) and node count is untouched; may be a stepping stone |
| D. A separate windowed code path for big files | two paths | easy to start | M, then a permanent second path | rejected by the brief's own rule; every reader in CMP-01 would need two versions |

## Open questions

- What does `Range.getClientRects()` return for text inside a `content-visibility: auto` skipped block in WebKit (macOS 13 to 26) and Chromium? This decides how find's landing and the typesetter bisection behave under tier 1; vectors 02 and 05 own it. (CMP-06)
- What is the node budget? It decides which fixes are parked. Vector 03. (CMP-15)
- Is print an off-screen render from bytes or a transient mount of everything? A design choice with a precedent (CMP-10).
- Does the table's estimate for a block (grid units from bytes and kind) come close enough to the measured height for tier 2 not to jump? The existing byte extrapolation in `frame/spine-map.ts:27-30` is whole-page only. Vector 06.
- How many top-level blocks can a 5 MB Markdown page have, and what is the table's own memory and update cost at that count? Wave 5 measured the observer at 10,000 blocks; the 1-5 MB range is 6,000 to over 20,000 (the outline failure was at 20,000). Not measured for a byte-only table.
- The pending inert container still holds nodes for blocks not mounted: is that cheap enough, or must tier 2 render a block's HTML on demand from the AST? Vector 03 and 09.

## Cross-links

- `../large-files/04-dom-rendering.md` DOM-01, DOM-03, DOM-04, DOM-07, DOM-08, DOM-10, DOM-11: tier 1's gains, the node count's cost, scroll anchoring and what virtualisation breaks. This chapter's CMP-06 and CMP-04 are the in-app consequences.
- `../large-files/02-markdown-apps.md` MDA-06 and its "a feature that renders per block iterates only blocks in the mounted window" rule, which is CMP-01's gate/replace/keep rule.
- `../large-files/05-typesetting.md`: typesetting by distance (CMP-05, CMP-14).
- `../large-files/08-search-highlight.md`: find over a model (CMP-09).
- Vector 02 (tier 1 on WebKit), 03 (node budget), 06 (estimates and anchoring), 07 (accessibility), 08 (find, select, copy), 09 (typesetting by distance), 10 (editing and the table).

## Sources

All are repository paths, read 2026-11-27; no web sources.

- `apps/desktop/src/view/rendered-view.ts` (worktree head `a6d7fab5`): lines cited above.
- `apps/desktop/src/render/post.ts`, `render/progressive.ts`, `render/incremental.ts`, `render/export-file.ts`, `render/wide-tables.ts`, `render/highlight.ts`.
- `apps/desktop/src/find/walk.ts`, `find/view.ts`; `selection/copy-text.ts`, `copy-html.ts`, `view.ts`, `drag.ts`, `bind.ts`, `selection.ts`, `cursor.ts`; `frame/spine.ts`, `frame/spine-map.ts`; `left/panels/outline.ts`, `search.ts`, `links.ts`; `notes/margin.ts`, `part-notes.ts`; `export/page.ts`, `export/model.ts`; `depths/lens.ts`; `commands/block-edit.ts`, `depths.ts`, `log.ts`.
- `packages/typeset/src/index.ts`, `grid.ts`, `measure.ts`, `apply.ts`, `hang.ts`; `packages/theme/src/base.css:596-606`.
- The held table: `git show origin/agent/geometry-table:apps/desktop/src/view/block-geometry.ts`, `...:packages/core/src/position/geometry.ts`, `...:apps/desktop/src/position/position.ts`, `...:HANDOFF.md`, `...:apps/desktop/test/block-geometry.test.mjs`; tag `archive/branch/geometry-table-rebuild-phase1` (`cf4986cb`).
- Wave 5: `work/runs/2026-11-26-wave-05/branches/geometry-table/{report,review,review-2,review-3}.md` and `.../near-typeset/{report,review,review-2}.md`.
- `work/todo.md`, sections "Next", "Structure", "Big files", "Later" (the tracker, read for sizes and causes; rows are not cited by id in this chapter).
