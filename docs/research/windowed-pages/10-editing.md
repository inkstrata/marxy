---
corpus: windowed-pages
id: 10
slug: editing
prefix: EDW
title: Editing in Read against a geometry table
kind: chapter
vector: web + code
sub-questions: [Q-10]
created: 2026-11-27
---

# 10 · Editing in Read against a geometry table

## Abstract

Editing in Read is already shaped like the windowed design on the byte side: every change is one byte splice, the
store hands the view a new parse, and the view replaces only the top-level blocks that differ and shifts the
provenance of the rest. What is not windowed is the DOM side of that: the shift walks every element after the edit,
the block list is rebuilt with one rect read per block afterwards, and any case it cannot prove falls back to setting
the page whole. CodeMirror 6's height map and ProseMirror's step maps show the shape the geometry table needs: store
lengths and heights, never absolute offsets, so a splice shifts everything after it for free; and keep the model
independent of what is mounted.

## TL;DR

- A splice changes the table in three places only: the entries covering the old range (replaced), the heights of the
  new entries (estimated until measured), and nothing else, if entries store lengths and byte starts are prefix sums.
  The current code instead rewrites two attributes on every element after the edit (EDW-02).
- Commit, undo, redo and reload can already take the "replace changed blocks" path; the table makes that path
  O(changed blocks + log n) only if the shift and the block-list rebuild stop touching the DOM (EDW-02, EDW-03).
- The splice itself is O(file): it allocates and copies the whole byte array and decodes it again (EDW-01). That is
  outside the table, but it bounds any claim of "O(log n) edit".
- Whole-page fallbacks are deliberate (headings ids, footnote numbering, raw HTML stack, definitions). With a table,
  a fallback becomes "reparse whole, rebuild the table, keep heights of byte-identical blocks", not "remount all"
  (EDW-04, EDW-06).
- Source to Read and back already goes through a byte anchor; it needs the target mounted on demand, which the
  table provides (EDW-05).
- The candidate geometry table's source is readable (EDW-10, which supersedes EDW-07): it stores absolute tops, so a splice shifts every later record in a loop, and the Recommendation's stored-lengths design is a change from it.

## Recommendation

1. **Table entries hold lengths and heights, not byte starts.** Use a balanced tree or Fenwick-style prefix sums over
   block lengths (CodeMirror's `HeightMap` shape, EDW-08). Then "all offsets after the edit shift by delta" is free,
   and `mapPos`-like mapping of a stored place (anchor, held position, selection) is one function over the splice's
   `{start, end, replacementLength}`, the way the app already maps an anchor (EDW-05).
2. **Make the edit path one function over the table**: take the diff the parse already computes (the shared prefix
   and suffix of blocks in `spliceRendered`), replace table entries `[from, oldTo)` with `[from, newTo)` marked
   `estimated`, keep every other entry's measured height, and mount only those that fall in the mounted window.
   Elements outside the window are never touched, so no `shiftTree` over unmounted blocks (there are none to shift).
3. **Mount before measuring, never measure unmounted**: a replaced block that is unmounted keeps an estimate until
   it scrolls in. A replaced block that is mounted is measured in the same batched pass the app already runs.
4. **Keep the whole-render fallback, but as "rebuild the table from the new parse, carry heights by matching
   byte-identical (or `sameMoved`) blocks"**, so a definition change costs a reparse and a table rebuild, and the
   reader keeps their place by byte anchor.
5. **Do not let the table become a second source of positions**: the bytes stay the document; the table is derived,
   rebuilt from a parse, and carries `store version` so a stale table is detectable.

## Findings

### EDW-01 · A splice is one pure O(file) copy; the text and offset table are rebuilt  [confirmed]

`splice` validates the range, allocates `new Uint8Array(range.start + encoded.length + (bytes.length - range.end))`,
copies the prefix, the replacement and the suffix, and calls `makeBuffer`, which decodes the whole text and builds
the offset table again (`packages/core/src/buffer/buffer.ts:56-69`, `:192-200`). `fromText` (Source commit) and
`foldText` do the same but find the changed middle by a common-prefix and common-suffix scan over the strings
(`buffer.ts:75-125`, the scans at `:101-109`), so a Source commit is one splice of only the bytes that differ. An
`Edit` keeps `before` and `after` bytes so undo is a splice back (`buffer.ts:13-19`).

Consequence for the table: the table update can be O(changed blocks + log n), but the buffer behind it is O(file) per
edit (1 MB: a copy plus a UTF-8 decode, measured elsewhere as part of "a one-block edit 2-6 s at 1 MB", which is
dominated by page work, not this). A piece table or rope (CodeMirror's `Text`) would make the buffer cheap too, but
that is not needed to build the table; flag it as later work. [confirmed]

### EDW-02 · The current splice replaces changed blocks but walks the DOM after them to shift offsets  [confirmed]

`spliceRendered` compares the old and new parse node by node from the front (`p`) and the back (`s`) with `sameMoved`,
extends the cut outward to cut points, renders only the new blocks through the one sanitising pipeline, removes the
old nodes and inserts the new (`apps/desktop/src/render/incremental.ts:390-552`). Then `shiftFrom` walks every
top-level element from the first block after the cut to the end (live, then the pending container) and `shiftTree`
rewrites `data-marxy-s` and `data-marxy-e` on every ranged element inside each (`incremental.ts:245-276`,
call at `:553`). That is O(elements after the edit); the result type even reports `shifted`. In a windowed page those
elements are mostly not mounted, and the shift is unnecessary: the table stores lengths.

The header comment states the invariant that must carry over: a block counts as kept "only when it is the old block
with every range moved by the same number of bytes" (`incremental.ts:32-34`), i.e. `sameMoved(a, b, delta)`
(`:125-147`). That test itself is O(nodes of the compared blocks) per pair, from both ends, so a one-block edit in a
10,000-block document compares about 10,000 pairs shallowly only when each pair is `===` (identical object from the
incremental parse); otherwise it descends. [likely, for the cost of the descent; the identity shortcut is
`incremental.ts:127`]

### EDW-03 · After the splice the block list is rebuilt by a per-block rect read  [confirmed]

`splicePageNow` runs the splice, adopts new elements into the typesetter (`typeset?.adopt(added)`), then sets
`shown.blocks = builtList(doc, buildBlocks(doc, nodeMap))` (`apps/desktop/src/view/rendered-view.ts:2144`): a whole
rebuild of the block list (one rect per block in a batch, per the context map), not a patch. Then it picks a grid
pass: if at most `SYNC_SNAP_BLOCKS` blocks sit below the change it snaps now from the first added block, otherwise it
schedules the snap "at idle" and says that in the middle of a long page "it is every block below" that is off
(`rendered-view.ts:2145-2152`). So a one-block edit that changes the height by a non-whole number of grid units moves
every block below it, and the page re-sets them.

A patching path already exists for the other trigger (heights changed by themselves): `updatedBlocks` re-reads only
changed blocks and moves the rest "by what they moved", and falls back to a whole build when a reading, a derived
view or a pending change is present (`rendered-view.ts:1510-1523`). The geometry table makes this the only path: a
height change is `setHeight(i, h)` and tops below shift by prefix sum. [confirmed]

### EDW-04 · Cases that force a whole render are about cross-block dependencies, and the table must name the same ones  [confirmed]

`spliceRendered` answers `{spliced: false, reason}` for: another document, the footnote numbers differing, raw HTML
leaving an element open across blocks, truncation, a cut that would leave nothing to keep, title drawn before front
matter, a change that is over `maxShare` (default 0.5) of the blocks, a heading id above or below the change moving, a
heading id inside depending on neighbours, removals that cannot be told apart, and "the page is not the render of the
document it was said to be" (`incremental.ts:390-541`). `splicePageNow` adds: the page was not set from a whole render,
a reading, the page not showing, and a trust-grant change (`rendered-view.ts:2120-2127`). Link reference and footnote
definitions that change make the parser itself reparse the whole file (`docs/architecture.md`, Parse item: "an edit
that adds, removes or changes a definition parses the whole file").

For the table this means: block boundaries come from the parse, so after a definition change every block's byte
range can in principle change meaning even when its bytes do not; the table must be rebuilt from the new parse and
reconciled to the old one by `sameMoved` (the same test the splice uses), and its entries must stay 1:1 with
top-level blocks. Heading ids and footnote numbers are properties of the whole document that never enter the table
(they affect HTML, not geometry), but they do decide whether a *mounted* block's HTML is still right, which is why
the check stays on the mounted side. [confirmed]

### EDW-05 · Anchors already map through a splice; Source and Read already hand over by byte  [confirmed]

When a transition lands, the view reads the reading position before the change and maps it:
`const position = { ...read, byteOffset: mapThroughTransition(change, read.byteOffset) }` and
`mapThroughTransition(change, anchor)` for the held anchor, with `removedBy(change, anchor)` so an anchor the edit
deleted lands on the edit's start and the block from there on is held (`rendered-view.ts:2362-2369`). That is the
`mapPos` idea with an association choice. The page is then repainted at the mapped place. `landOn` calls
`mountThrough(byte)` before holding the anchor (`rendered-view.ts:1671-1684`), and `holdPosition` likewise
(`:1647-1649`): the app already mounts up to the target before restoring.

Read to Source: `enterSourceFromRendered` reads `currentPosition` from the block list, prefers an exact byte if Source
left one that the page has not moved off, else a landed byte, else a code-line byte, else the block's start, and
passes `lastReadingByteOffset` to `showSource` (`rendered-view.ts:1079-1093`). Source to Read: `leaveSourceForRendered`
folds the editor into the store as one history entry, reads the reading line's byte, then `showRendered(byteOffset,
fraction)` (`:1203-1251`). `showRendered` tries `spliceStalePage()` (one change from the page's held record to the
store's document) and, when that returns false, `rerenderFromBuffer(byteOffset)`, then `mountThrough(byteOffset)`,
`snap(doc)` and `restoreTo(blocks, {byteOffset, fraction})` (`:1046-1077`, the staleness branch at `:1057-1065`).
`spliceStalePage` refuses when there is no store, plain text or a reading (`:2108-2109`).

With a table, Source to Read needs no new idea: the byte is the key; the table gives the block's top from the
current (possibly estimated) heights; mount that block and its neighbours; restore with the app's existing
block-plus-fraction restore. The risk is estimated heights above the target changing as they are measured, which is
the vector on anchoring (06); the editing path only has to keep the anchor expressed as block plus byte offset, not
as `scrollTop`. [confirmed for the mechanism; the interaction with estimates is a design inference]

### EDW-06 · A reload (external change) is a different shape: not a splice, mapped by the watcher  [confirmed]

For `reload`, the view uses `reloadAt` ("the watcher's, already mapped through the new bytes") instead of the
anchor's old offset, because "A reload is not a splice" (`rendered-view.ts:2358-2367`). `setsPage` says a reload sets
the page only when the buffer changed (`:2277-2288`). `commitSource`, `apply`, `undo`, `redo` and `rename` all go
through the same repaint, with `rename` and a changed trust grant falling back to whole (`:2291-2376`). There is a
`recordRepaint` measure named `marxy:repaint` that records `how: 'replaced'` or `how: 'whole'` with a reason
(`rendered-view.ts:2081-2091`), which is the right counter to keep when the table lands: it says how often the
fallback is hit.

For a far-region reload with the table: diff old and new block lists (the same `sameMoved` prefix and suffix scan),
swap the table's changed middle, carry heights of kept blocks, and, if the changed block is not mounted, change only
the table (mark `estimated`, drop its element from any cache). Nothing needs mounting until the reader goes there or
find, copy or print asks for it. [likely; design inference from `spliceRendered`'s diff and from EDW-08]

### EDW-07 · The candidate geometry table was not read here  [superseded]

*Superseded by EDW-10 (2026-11-27): the file is readable; it stores absolute tops.*

I could not read `packages/core/src/position/geometry.ts` on the remote branch of the geometry table: this agent's
tools were limited to reading files and two scripts, and the file is not in the research worktree or the main
checkout. So whether the table shifts byte ranges after a splice is **not settled**. What to check: that entries are
`{length, height, measured}` (or equivalent, with starts derived), that there is a `replace(from, to, entries)` that
reuses entries outside the range, and that a hole for unmounted blocks is a first-class entry (CodeMirror's `Gap`,
EDW-08). The earlier version (lost) is said in the brief to have broken an outline of 20,000 headings: an index that
keeps one record per heading by absolute byte is exactly the thing a splice invalidates.

**Searched:** `Read` of `/Users/ian/Dev/marxy-wt/windowing-research/packages/core/src/position/geometry.ts` (absent in
that worktree); `Read` of `/Users/ian/Dev/marxy-wt/geometry-table/packages/core/src/position/geometry.ts` (absent). I
did not run `git show` (the brief limits Bash to the two tools).

### EDW-08 · CodeMirror 6 keeps lengths and heights in a tree and marks changed ranges outdated, not remeasured  [confirmed]

`HeightMap` nodes carry `length` (the number of characters covered) and `height`, with a flags field whose default is
`Flag.Outdated`; a branch sums its children (`constructor(public left, brk, public right)` computes
`left.length + brk + right.length` and `left.height + right.height`) and queries descend with
`offset + this.left.length + this.break` and `top + this.left.height`
(`@codemirror/view` `src/heightmap.ts`, saved source [1]). Absolute offsets and tops are therefore never stored, only
computed on the way down, so a replacement inside one subtree changes lengths along one path and everything after it
moves by construction. `HeightMapGap` is a run of lines with no measured height, whose height comes from an oracle
estimate (`heightForGap`, from `lineHeight`, `lineLength` and the character count); `HeightMapText`/`HeightMapBlock`
are measured lines. `applyChanges(decorations, oldDoc, oracle, changes)` walks the change list from the end, finds the
line-aligned range each change touches in the *old* map (`lineAt(fromA, ByPosNoHeight, ...)`), widens it so
neighbouring changes merge, builds nodes for the new text over the new range, and calls
`me.replace(fromA, toA, nodes)`, then `updateHeight(oracle, 0)` (`heightmap.ts`, `applyChanges`). In `HeightMapText.replace`,
a one-line replacement of near-equal length (`Math.abs(this.length - node.length) < 10`) keeps the old node's height
and its outdated flag (`node.height = this.height; if (!this.outdated) node.outdated = false`), i.e. an edited line is
assumed to keep its height until measured. A `heightChangeFlag` records whether any height really changed. [1]

`ChangeSet`/`ChangeDesc.mapPos(pos, assoc)` is the position side: the reference says it will "Map a given position
through these changes, to produce a position pointing into the new document", and `assoc` picks the side at an
insertion; `touchesRange(from, to)` answers whether the changes touch a range, returning `"cover"` when one covers it
[2]. Lengths and positions are in the document's units, not DOM units, so the view's DOM can be anything; CM6 mounts
only the viewport plus margins and uses the map to decide what that is. The `Text` rope itself was not quoted here
(see Open questions). Maps to this app: entry `length` is bytes, `height` is whole line-box units; "outdated" is
`estimated`; the gap is the unmounted, unmeasured run of blocks.

### EDW-09 · ProseMirror separates the document value from the DOM and gives the position map as a first-class type  [confirmed]

The guide says nodes "are simply values" [3]: "every time you update a document, you get a new document value. That
document value will share all sub-nodes that didn't change with the original document value", so the editor can run
"a very efficient DOM update algorithm by comparing the last document it drew to the screen to the current document"
[3]. For positions, the guide says steps "can give you a map that can convert between positions" before and after
(`StepMap`), and a `Transform` accumulates them in a `Mapping` so one position maps through a whole chain, with `bias`
(-1) to choose which side of an insertion a position stays on [3]. The reference documents `StepMap` as holding ranges
`[start, oldSize, newSize]`-style triples and `Mapping` as a list of step maps with inversion support [4].

For this app this is the closest match to undo by bytes: an `Edit` (`before`, `after`, `range`) is the app's
`Step`, its `StepMap` is `{start, oldLength, newLength}`, and a `Mapping` over `apply`/`undo`/`redo` entries already
exists in effect as `mapThroughTransition` (EDW-05). ProseMirror also confirms the cost model: the diff of the
last-drawn document against the new one is what bounds DOM work, which is what `spliceRendered` does by comparing
parses with `sameMoved`. [3, 4]

### EDW-10 · The candidate table stores absolute tops, so a splice shifts every later record  [confirmed]

Read with `git show origin/agent/geometry-table:packages/core/src/position/geometry.ts` at commit f4fda854 (2026-11-27; the verifier's pass, which also read `apps/desktop/src/view/block-geometry.ts` on that branch). The file exists. Its header says one record per top-level block with its top and height relative to the article. `GeometryRecord` is `{top, height, measured}`, so it stores absolute tops, not lengths. `settleRecords` shifts later records with `for (i = from; i <= to; i++) records[i].top += dy`, which is O(run). `recordIndexAtByte` takes a `startAt(i)` callback, so byte starts live outside the file. In the first 150 lines read there is no `replace(from, to, entries)` (the rest of the file was not read). The `measured` flag matches the `estimated` idea above. So a splice shifts every later record, and Recommendation 1's design (store lengths, derive starts) is a change from the branch, not what it does. Source: `origin/agent/geometry-table:packages/core/src/position/geometry.ts` at f4fda854.

## Options compared

| Option | Edit cost | Unmounted blocks | Risk |
|---|---|---|---|
| A. Today: replace changed blocks, shift attributes after, rebuild block list | O(elements after edit) + O(blocks) rect reads | Impossible to be unmounted (the shift needs them) | Whole-page fallback is the only other path |
| B. Table of lengths and heights, splice replaces entries, mounted elements patched | O(changed blocks + log n) on the table; DOM only for mounted changed blocks | Natural: table-only change | Table and parse must stay 1:1; a stale table must be detectable |
| C. B plus a rope or piece table for bytes | Also O(log n) on the buffer | Same | Large change to the byte layer; not needed for the table |
| D. Rebuild the table from the parse every edit | O(blocks) on the table, no DOM | Natural | Cheap enough (a loop over parse blocks) but loses measured heights unless carried by matching |

B with D as the fallback is the recommendation.

## Open questions

- The geometry table's own data structure is now read (EDW-10, superseding EDW-07): it keeps absolute tops, so whether to move to stored lengths with derived starts is the open design choice; the rest of `geometry.ts` past the first 150 lines was not read (no `replace(from, to, entries)` in those lines).
- The shift-free design assumes the table sums lengths in O(log n): for small documents a flat array with a running
  sum is as good, and keeping one structure for both is the "no second path" rule, so a tree must not cost more
  than the array below the budget. Measure.
- A block replaced by several (or several by one): table entries for the new blocks are estimated; how good an
  estimate before typesetting is the anchoring vector's question (06).
- Undo of an edit in an unmounted region (reload undone from the menu with the block far away): mapping works
  (EDW-05); whether to scroll to the change or only restore the table is a product choice.
- CodeMirror's `Text` rope and Monaco's piece tree were not read in this chapter; neither is necessary for the
  table.

## Cross-links

- Vector 01 (code map) for every DOM read the edit path still does (`buildBlocks`, `currentPosition`).
- Vector 04 (height maps): the CM6 `HeightMap` and the API shape of EDW-08.
- Vector 06 (estimates and anchoring): estimated heights of replaced blocks, anchor by block plus byte.
- Vector 08 (find, select, copy): pending-blocks support; an edit inside a mounted selection.
- Vector 09 (typeset by distance): `typeset?.adopt(added)` after a splice is the on-demand queue's entry.

## Sources

1. https://raw.githubusercontent.com/codemirror/view/main/src/heightmap.ts (accessed 2026-11-27) [confirmed]
2. https://codemirror.net/docs/ref/ (accessed 2026-11-27) [confirmed]
3. https://prosemirror.net/docs/guide/ (accessed 2026-11-27) [confirmed]
4. https://prosemirror.net/docs/ref/ (accessed 2026-11-27) [likely: saved but not read for the StepMap wording]
5. Local code at the research worktree, read 2026-11-27: `packages/core/src/buffer/buffer.ts`,
   `apps/desktop/src/render/incremental.ts`, `apps/desktop/src/render/block-cache.ts` (strings and token data, no DOM,
   so a cache keyed by text survives any edit that leaves a block's text equal),
   `apps/desktop/src/view/rendered-view.ts`, `docs/architecture.md`.
