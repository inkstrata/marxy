# Briefs, shift 2: the page costs what is on screen

Four branches, in a fixed order, the last two gated by experiments. Rules for builders and reviewers: `C:\Dev\reader\work\wave1\wave1-cut.md`. Line numbers are from master `17cfe661`; find code by name. Records before and after with `node scripts/measure-interactions.mjs` go to `C:\Dev\reader\work\plan\records\`.

`typeset-waste` (the package half of the first step) is already cut and briefed in `C:\Dev\reader\work\wave2\wave2-cut.md`; its report ends with a "for the view" note that `typeset-view` picks up.

| Branch | Step | Depends on | Owns | Builder | Reviewers | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `typeset-view` | 2a, view half | `typeset-waste` landed; after `source-return` (and `drop-floor`, unless X10 is still pending) so that one branch at a time edits `rendered-view.ts` | the typesetter's callers in `view/rendered-view.ts`, `render/post.ts`, scroll subscribers | Sonnet | Opus | M |
| `geometry-table` | 2b | `typeset-view` | a new `view/block-geometry.ts`; `render/post.ts`; `position/`; `frame/spine*.ts` | Opus | Sonnet, then a second Opus | M-L |
| `near-typeset` | 2c | `geometry-table`; X1 and X2 | `packages/typeset` scheduling; gates and tests that wait for "all set" | Sonnet | Opus | M |
| `skipped-layout` | 2d | `near-typeset`; X1 says go | `packages/typeset/src/grid.ts`; theme CSS for article blocks; whatever X1's list names | Opus | Sonnet, then a second Opus | L |

Decisions already taken by Ian (24 November): far paragraphs may wait to be typeset until approached, with export, print and the rag gate setting everything; the measuring tool and a smoke set of tests run in the shipped engine as well as WebKit.

## What the four share

**The measured problem.** Opening a 195 KB Markdown document (about 10,000 nodes, 1,245 top-level blocks) takes about 8 s of main-thread work, 3.6 s of it forced layout inside `getBoundingClientRect` and `getClientRects`. The typesetter is 2.3 s inclusive; its idle slices are budgeted at 24 ms and cost 90-190 ms, because each layout read lays out the whole article. Seven frames over 50 ms while scrolling during that time. Returning from Source re-measures the whole page (290-330 ms) even when nothing changed.

**How it is built today**, from the scout's map:

- Typesetter (`packages/typeset/src/index.ts`): candidates are `p[data-marxy-s], li[data-marxy-s], dd, figcaption` (128). `layout()` (785-811) reads every candidate's rectangle, sets those in the viewport at once inside `keepPlace`, and queues the rest by distance. An IntersectionObserver with `rootMargin: '200% 0px'` (812-847) sets what comes near; `step` (861) drains the queue in idle slices until it is empty, and only then resolves `done`. Measuring is by Range rectangles in the live page (`measure.ts:90-108`). A batch (`setBatch`, 597-669) reads, writes line-break spans and the `marxy-set` class, reads again for hanging punctuation, writes margins, reads again for overflow, and may retry: three to five layouts.
- `keepPlace` (502) notes the block and character under the reading line before a pass writes and scrolls by what it moved afterwards. It does not run while the reader is scrolling. The browser's own scroll anchoring is off (`grid.ts:72` sets `overflow-anchor: none`).
- The baseline grid (`grid.ts`): `snapToGrid` pads islands to whole units, then, in rounds, reads every block's top and pads the block before it so the top lands on the grid: block i-1's padding depends on block i's absolute top, so it is global. `snapBlocks` (237-244) is the local form: re-pad a changed block to whole units so nothing below moves. `snapInSlices` (278) does the whole pass in windows of 128 blocks.
- The block list (`apps/desktop/src/render/post.ts:133-148` `buildBlocks`): the innermost block carriers (paragraphs and list items, not only top-level blocks), each `{el, start, top, height}` from `getComputedStyle` and `getBoundingClientRect`, rebuilt after every grid pass. Consumers: the reading position (`position/position.ts:27` and `packages/core/src/position/blocks.ts`, a binary search by top at the reading line), restoring it (`scrollTopForPosition`), saving it on scroll (`position/reading-persistence.ts:129-143`), crumbs and the outline mark (through `view.position()`), the spine (`frame/spine.ts:84`, `frame/spine-map.ts:42-69`). The spine already estimates beyond the mounted end by share of bytes (`spine-map.ts:24-30`).
- Callers in the view (`rendered-view.ts`): `snap` (1441, whole pass or from a block), `snapChanged` (1470, `snapBlocks`, then a full `buildBlocks`), `snapWhole` (1489), `holdPlace` (2947, rebuilds the list twice), `holdAnchor` (1565), `destroyTypeset` at 1864, 2320, 2400, 2456, the `onPass` mapping at about 2334, `showRendered`'s `snap(doc)` at 1050.
- The mount is progressive (`render/progressive.ts`): two screens at once, the rest appended in idle chunks, each chunk handed to `typeset.adopt`.
- Tests and gates that assume every paragraph ends up set: `packages/typeset/test/typeset.test.mjs` (many assert after `await controller.done`), `apps/desktop/test/typeset-idle.test.mjs`, `progressive-large.test.mjs:273`, `scripts/gate-aesthetics.mjs` (waits for the `typeset_done` mark and reads every set paragraph for the rag figures), `apps/desktop/src/harness/gate-entry.ts` (about 169).
- `onPass('visible')` is called in three places in `packages/typeset/src/index.ts`: about 744 (already conditional) and about 843-844 and 857-858 (the two `typeset-waste` made conditional). Check all three when relying on "a pass is announced only when it moved something".

## typeset-view

**What the reader gets.** Nothing visible; the page reaches rest sooner and scrolling while type is being set is smooth.

**Do**, using what `typeset-waste` added (read its report's "for the view" note first):

1. Pass `discard` where the page is thrown away after tear-down: the view's teardown (about 1864), `rerenderFromBuffer` (2400) and the derived-view path (2456). `startTypeset` before re-attaching to the same article (2320) keeps the revert.
2. A visible pass now reports the paragraphs it set, and only when lines moved. Answer it with `snapChanged` for the blocks holding those paragraphs, not a whole `snap`.
3. `snapChanged` re-pads the changed blocks and then rebuilds the whole block list. Instead, update the list from the first changed block: its new height from one read, and every top below shifted by the difference (the local grid form guarantees the difference is whole units). `buildBlocks` calls `getComputedStyle` for every candidate to learn its `display`, which its own comment calls most of its cost: remember it per element.
4. Several subscribers compute the reading position separately on every scroll frame, each copying the block list (crumbs `frame/crumbs.ts:173-181`, the outline mark `left/panels/outline.ts:767-819`, position saving, cards `frame/cards/index.ts:27-38`), and the spine writes three style properties every frame whether or not they changed (`frame/spine.ts:102-121`). Compute the position once per frame in the view and hand it out; search the list in place instead of copying; write the spine's styles on change.
5. `table-aids`' `edgeOf` (`proposals/table-aids.ts:11-14`) queries the pane head once per table per scroll frame; hoist it.

**Do not** change which paragraphs are set or when, the grid's rule, or `showRendered`'s `snap` (the next branch owns it).

**Proof, by counts.** Browser tests on a long page that fail on master: after a highlight batch lands, the number of `getBoundingClientRect` calls is a small constant, not one per block; a scroll frame computes the position once (count calls of the position function, or of the block list being copied); tearing down a fully set page makes no per-paragraph DOM writes before the article is cleared. The existing place, spine, crumbs and outline tests pass unchanged, and a differential test shows the incrementally updated block list equals a fresh `buildBlocks` after each kind of change (a paragraph set, a code block coloured, an image sized).

**Numbers.** Open `long-reference` to quiet: `LayoutDuration` and `TaskDuration` down (record them); scrolling while type is set: no frame over 50 ms where there were seven.

## geometry-table

Everything after this depends on it, and so does the plan's claim that the DOM can stop being asked. It gets the strongest builder and two reviewers.

**What the reader gets.** Nothing visible. Returning from Source no longer re-measures the page; position, spine, crumbs and the outline mark stay exact without the page being read block by block.

**The design.**

- One record per top-level block of the article: the element, its byte range (already on it as `data-marxy-s` and `data-marxy-e`), its top relative to the article, its height, and whether its size is measured or still an estimate. Kept in document order, searchable by byte and by top.
- Kept current by the browser's own notifications, not by reading. A ResizeObserver over the top-level blocks reports size changes once per frame, after layout, without forcing one; in its callback the layout is clean, so reading a changed block's `offsetTop` and height there is free. From the first changed block down, tops shift by the measured difference; nothing below needs to be read. Blocks added or removed (a splice, a progressive chunk) are inserted and removed by the code that adds and removes them, which already knows which they are.
- Inner precision on demand. The list today holds paragraphs and list items inside lists so that a position can be a fraction of an inner block. Keep that precision by measuring the inner blocks of the one top-level block under the reading line at the moment a position is asked for or restored, not for the whole page.
- The record says "estimate" until the block has been laid out once. Nothing in this branch produces estimates (every block is laid out today); the field exists so the next two branches can.

**Do.**

1. Build the table in a module of its own under `apps/desktop/src/view/`, with the pure parts (search by byte, search by top, shifting tops, position as block plus fraction) in `packages/core/src/position/` beside `blocks.ts`, where they can be tested without a browser.
2. Move the consumers to it: `currentPosition` and `positionAtScroll`, `scrollTopForPosition`, the saved position, `view.position()`, the spine's map, `holdPlace` and `holdAnchor`.
3. Remove the whole-list rebuilds: after grid passes, the two in `holdPlace`, the readings' and lines' `onDrawn`. `showRendered` keeps no whole-page `snap` when the page was not stale and its width did not change while hidden: un-hiding the article delivers the size notifications that bring the table up to date.
4. Keep `buildBlocks` as the oracle for tests only, or delete it if nothing else needs it.

**Find out first.** How many top-level blocks a ResizeObserver can watch before its own cost shows (measure 1,245 and 10,000 on the 1 MB document; if it is a problem, observe the article and a sample, or observe on demand near the viewport). Whether WebKit delivers the notifications on un-hiding as Chromium does. What the readings, the lines view and the transcript view do for positions (they have their own drawing and may not use the article's blocks at all).

**Proof.**

- A differential test in the browser: drive the page through opening, a progressive mount finishing, type being set, code colouring, an image loading, a splice, a pane resize, a theme change, Source and back, and after each, once quiet, the table equals a fresh measurement of every block (tops and heights to the pixel). This is the test that makes the rest safe; write it first, against today's code with the table shadowing the list, and only then switch the consumers.
- The existing position tests (`scroll-persistence`, `place-across-modes`, `keep-place`, place restore in `check:tauri`) pass unchanged.
- Counts: no read of every block after a highlight batch, a grid pass, or returning from Source.

**Numbers.** Source to Read with nothing edited on `long-reference`: `LayoutCount` and `TaskDuration` a fraction of today's 290-330 ms. Settled scroll: script per wheel event down from about 19 ms.

## near-typeset

Gated by X1 (does bounding the queue give the gain) and X2 (how the page is held still). Read both reports first; this brief assumes their results and should be corrected by them.

**What the reader gets.** A long page is at rest about as fast as a short one: type is set where the reader is, and elsewhere when the reader comes near. Nothing looks different.

**Do.**

1. Bound the idle queue. After the viewport and the observer's margin, the queue holds paragraphs within a set distance of the reader (start with three screens beyond the margin; X1 gives the figure) and is refilled as the reader moves. A jump (the outline, find, a restored position, jump to end) sets the landing place at once, as the eager pass does today.
2. Redefine done. `done` and the `typeset_done` mark come to mean "nothing near the reader is unset". Add `setAll()` that sets every paragraph and resolves when it has, and an option that makes a controller set everything from the start.
3. Everything that needs the whole page set asks for it: export and print (find how each obtains its page: if export renders separately it may need nothing; printing the live page needs `setAll` before the print), the rag gate (`scripts/gate-aesthetics.mjs`), and the tests listed under "What the four share". Change each test to say which it means: "near the reader" or "all".
4. A width or theme change re-breaks what is near and reverts the rest to be set when approached; `restoreAll` no longer costs the whole page because the whole page is no longer set.
5. Hold the page still while paragraphs above the reader are set during a scroll, by the arrangement X2 chose. If that is the browser's scroll anchoring, it exists only in the shipped engine: keep `keepPlace` as the path where there is none, and put the test for this behaviour in the smoke set that runs in the shipped engine.
6. The block table's "estimate" field now has a use: an unset paragraph's height is its native height, which is a measurement, so nothing is estimated yet; but note in the table which blocks hold unset paragraphs, since their height may change when set.

**Risks to look at.** Find while the page is partly set (`inPlace` splitting, match rectangles near the view only). A selection that runs from set paragraphs into unset ones, and copying it. The end pin (`endPinned`, `endObserver`, `notePinned`), which watches the article's height. The progressive mount still appending while the queue is bounded. Two panes on one document.

**Proof.** Counts, in the browser: opening a long page sets only the paragraphs within the bound (count `marxy-set` once quiet, and it does not grow while idle); scrolling a screen sets the next ones before they enter the screen (no frame shows an unset candidate on screen at ordinary scroll speeds); `setAll()` then sets every paragraph and the result equals what one whole pass sets today (the existing "chunks end as one pass sets them" property). The held-still test from X2, in the shipped engine. Fails on master where it should (the count).

**Numbers.** Open `long-reference` to quiet: `TaskDuration` from about 8 s to under 1.5 s; the 1 MB document about the same as the 195 KB one. A pane-width change likewise.

## skipped-layout

Only if X1 says go. X1's report is the specification: its list of code that reads inside skipped blocks, its picture comparison, and what it found about clipping and spacing. This brief gives the shape; X1 gives the contents.

**What the reader gets.** Nothing looks different. A typesetting slice, a click, a selection and a resize cost the layout of what is near, on any length of document.

**Do.**

1. The grid becomes local. Every top-level block occupies a whole number of grid units, including its margins, so every top is on the grid without anything reading tops. `snapBlocks` already does this for a changed block; make it the only form. Deal with what made the global form necessary: margins that collapse between neighbours (decide where spacing lives so it is a whole number of units by construction), islands (already padded to whole units), the article's own top padding. The whole-article pass (`snapToGrid`'s rounds, `snapInSlices`, `snapWhole`) goes.
2. Blocks far from the reader are skipped by the browser: `content-visibility: auto` on the article's top-level blocks with `contain-intrinsic-size: auto` and an estimate that is a whole number of units, derived from what is known without layout (bytes, lines, block kind); the block table records it as an estimate until the block has been laid out, after which the browser remembers the real size.
3. Whatever X1 found is clipped by paint containment (hanging punctuation, markers, outlines, margin notes, wide blocks) is fixed the way X1 found works, and the picture comparison from X1 becomes a test: set everything, compare with the pictures taken before this branch, no difference.
4. Every location on X1's list of reads into skipped blocks is moved to the block table or restricted to blocks near the reader. Add a development-time guard that counts such reads (the state-change event tells which blocks are skipped), and a test that opens a long page, scrolls, presses keys, clicks and finds, and requires the count to be zero.
5. Restoring a position into a region never laid out lands by estimate and corrects as heights firm up, as `commands/log.ts:274-283` already does for log pieces; the spine and the scroll bar may drift until a region has been seen once. Say in the report how large the drift is on the long documents.
6. The two proposals that read every table and every footnote reference (`proposals/table-aids.ts`, `proposals/notes-in-place.ts`) find what is near with an IntersectionObserver or the block table.

**Proof.** The picture comparison; the zero-reads test; the grid test (every block on screen has a top on the grid, at open and after scrolling through the document); the existing position, find, spine and outline tests; the differential test of the block table extended with skipped regions (a block's record equals its measurement once it has been laid out). The smoke set in the shipped engine includes all of these, since WebKit's support differs (X9).

**Numbers.** On the 1 MB document: a typesetting slice within twice its cost on the 25 KB document; first click and cursor key as on a short document; open to quiet under 1.5 s.
