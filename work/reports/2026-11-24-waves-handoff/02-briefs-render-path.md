# Briefs, shift 1: the page follows the change

Five branches. The rules for builders and reviewers are in `C:\Dev\reader\work\wave1\wave1-cut.md`; they apply unchanged. Line numbers are from master `17cfe661` and drift: find code by name. Every brief ends with numbers that `node scripts/measure-interactions.mjs` should show; save a record before and after to `C:\Dev\reader\work\plan\records\<branch>-{before,after}.json` and put the comparison in the report.

`definitions-index` (the parse half of the definitions work) is already cut and briefed in `C:\Dev\reader\work\wave2\wave2-cut.md`.

| Branch | Step | Depends on | Owns | Builder | Reviewers | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `splice-all` | 1a, 1b | wave 1 in master | `view/rendered-view.ts` (repaint, followTransition), `document/store.ts` | Sonnet | Opus | M |
| `source-return` | 1c | `splice-all` | `view/rendered-view.ts` (showRendered, pageStale) | Sonnet | Opus | S |
| `drop-floor` | 1d | `splice-all`, X10 | `view/rendered-view.ts` (one constant and its tests) | Sonnet | Opus | S |
| `footnote-splice` | 1e, render half | `splice-all`; independent of `definitions-index` | `render/incremental.ts`, `packages/core/src/render/` footnotes | Opus | Sonnet, then a second Opus | L |
| `block-cache` | 1f | wave 1's `grammars-once` in master | `render/highlight.ts`, `render/math.ts`, `render/diagram.ts`, `source/colour.ts` | Sonnet | Opus | S-M |

`rendered-view.ts` is one 3,000-line function that three of these edit, and two branches of the next file (`typeset-view`, `geometry-table` in `03-briefs-viewport.md`) edit it after them: five branches, strictly one at a time, in the order `splice-all`, `source-return`, `drop-floor`, `typeset-view`, `geometry-table` (`drop-floor` may slip to the end if its experiment is not done). The three here run one after another in the order of the table; `footnote-splice` and `block-cache` touch other files and can run beside them. Each branch that edits `rendered-view.ts` moves the code it changes into a module of its own under `apps/desktop/src/view/` where that is a clean cut (the tracker has wanted the function split for weeks), and says what it moved.

## splice-all

**What the reader gets.** Undo, redo, a ticked checkbox, every Read operation and a commit from Source update the blocks that changed and leave the rest of the page as it is: no flash of unset type, no seconds of work on a long page.

**How it works today.**

- `apps/desktop/src/render/incremental.ts` `spliceRendered(before, next, target, opts)` takes the record of the page as rendered and the new parsed document, finds the common prefix and suffix of top-level blocks by structural equality (`sameMoved`), locates their elements by `data-marxy-s` and `data-marxy-e`, renders only the blocks between through the same sanitising pipeline, swaps them, and shifts the byte attributes of everything after. It needs no edit range and does not care what caused the change. It refuses, changing nothing, for reasons it names (a footnote definition, raw HTML left open across blocks, a heading id that moved, a change that is most of the document, and others).
- The view decides whether to offer it. In `apps/desktop/src/view/rendered-view.ts`, `followTransition` (about 2218) sends `apply`, `undo`, `redo`, `rename` and a changed `reload` to `repaint(snapshot, position, landing, spanned, reload)` with `reload = change.kind === 'reload' || ownCommit`, where `ownCommit` is true only for the block editor's own commit. `repaint` (about 1964) then does `fell = unmade ? null : reload ? splicePage(snapshot) : 'not a reload'` (about 2004): anything that is not a reload or a block-edit commit is rebuilt whole by `rerenderFromBuffer` and re-typeset. `commitSource` while Read is showing falls to `repaint` too; in other states it marks the page stale or calls `rerenderFromBuffer` directly (about 2251-2270).
- `splicePageNow` (about 2046-2082) adds its own refusals: `'the page was not set from a whole render'`, `'a reading is set whole'`, `'the page is not showing'`, `'a small document'` (under 64 KB), `'the trust grant changed'`, `'the replacement failed: …'`.
- After a splice (about 2062-2081): a new `shown` record, `watchIslands(doc, added)`, `typeset?.adopt(added)` (only the new nodes join the typesetter; the rest keep their setting), `afterRender()`, notices, the block list rebuilt, a grid pass from the first changed block, and `deferAfterComplete` for images, maths and colour.
- The store (`apps/desktop/src/document/store.ts`): `apply` (about 537), `commitSource` (551), `undo` and `redo` (565, 575) each call `parse(...)`, a whole parse (`astOf`). Only `adopt` (about 767), used by reload, calls `reparsedAst` (340-342), the region parse. Every edit-shaped commit knows its byte range (`Edit.range` with `before` and `after`).

**Do.**

1. In the view, one rule: a change that sets the page tries the splice, whatever its kind, and falls back to the whole render when the splice refuses. Remove `'not a reload'`. Keep every other refusal, including the 64 KB floor (another branch removes it). Keep the cautions that are about state, not cause: a hidden Source page is marked stale as now; an open block editor is released as now.
2. In the store, `apply`, `commitSource`, `undo` and `redo` use the region parse (`reparsedAst`) with the bytes before and after, as `adopt` does, when the store's parse has been made.
3. Go through everything a whole render rebuilds and a splice leaves, and show each is right after an undo, a redo and an operation: the selection and cursor (they resolve again in `afterRender`), an open find (`find/view.ts` re-matches after a repaint), depths, notices, the outline and crumbs (they read the snapshot), the spine, images already measured, maths already set (`render/math.ts` skips `[data-marxy-done="math"]`), code already coloured (find out whether highlight and images skip nodes they have done; if not, say so and leave it for `block-cache`).
4. `recordRepaint` keeps writing `marxy:repaint` with how and why; tests that pin "whole, because not a reload" change to pin the new behaviour.

**Do not** change `incremental.ts`'s refusals, `reparse.ts`, the 64 KB constant, or what happens when Source is showing.

**Proof.**

- The page test that already exists for reloads, `differential()` in `apps/desktop/test/live-reload.test.mjs` (about 500-667), applies random edits and requires the spliced page's HTML to equal a whole render of the same document byte for byte. Extend it, or write its twin, so the edits arrive as chains of `apply`, `undo`, `redo` and Source commits through the store, on documents over 64 KB without footnotes. Require the splice to be taken for most of them, as the original does.
- A store test: random chains of apply, undo and redo, and after each the store's parsed document equals `parseMarkdown` of its bytes by JSON equality (the property `packages/core/src/parse/reparse.test.ts` uses).
- Browser tests that press the keys: on a long document, Mod+Z after a Read operation replaces a handful of top-level nodes, not all of them (`marxy:repaint` says `replaced`; a MutationObserver counts), and paragraphs outside the change keep their `marxy-set` class throughout.
- Each new test fails on master.

**Numbers.** On `long-reference-plain` (195 KB, no definitions): undo replaces under ten top-level nodes where it replaced about 2,700, and its `TaskDuration` falls from 3-5 s to about 1 s or less. On `long-reference` (with footnotes) nothing changes yet: the splice refuses, by design, until `footnote-splice`.

## source-return

**What the reader gets.** Typing in Source and switching back to Read updates the blocks that were edited; the rest of the page is not rebuilt.

**Today.** A commit from Source while the Read page is hidden sets `pageStale` (about `rendered-view.ts:2261`), and `showRendered` (about 1028) then calls `rerenderFromBuffer`, a whole render, before `mountThrough`, `snap(doc)` and `restoreTo`. The record of the page as it was (`shown`: its parsed document, its render record, its node map) is still held while Source shows.

**Do.** When Read is shown again and the page is stale because the document changed (not because the theme or the trust grant changed while hidden: those still need the whole render), run the splice against the held record and the store's current parsed document, and fall back to the whole render if it refuses. Several commits may have happened while hidden; the splice compares the old record with the newest document, so one splice covers them. Leave the `snap(doc)` that follows as it is (the geometry-table branch owns that).

**Proof.** A browser test: on a long document, switch to Source, type a word in one paragraph, switch back; a handful of top-level nodes are replaced, the rest keep their identity (mark one with a property before, find it after) and their set type. The byte-for-byte equality test covers the sequence "hide, several commits, show". Fails on master.

**Numbers.** Source to Read after one small edit on `long-reference-plain`: nodes replaced under ten; `TaskDuration` well under the whole render's.

## drop-floor

Only after X10 (`01-experiments.md`) says the in-place path is no dearer on small documents.

**Do.** Remove `INCREMENTAL_MIN_BYTES` (`rendered-view.ts` about 310) and the `'a small document'` refusal, and its mention in `docs/architecture.md`. Run the byte-for-byte equality test at small sizes too (documents of 1 to 60 KB from the corpus).

**Proof.** The equality test at small sizes; a browser test on a 25 KB document that an undo leaves every unchanged paragraph set. No test names the floor or the string `'a small document'`, so find the tests that rely on a small document being rebuilt whole by running the browser files that cover the view and reading each failure: the pins for a whole repaint are in `apps/desktop/test/live-reload.test.mjs` (about 458-473). `apps/desktop/test/block-edit.test.mjs` (about 671) asserts its text is over 64 KB as a precondition for a different constant, `BLOCK_EDIT_CAP`: leave that alone. Each changed test says the new rule in its name.

**Numbers.** On the 25 KB document: undo replaces a few nodes; no paragraph outside the change loses `marxy-set`.

## footnote-splice

The hard one of this shift. A wrong result is a page whose footnote numbers or links are wrong, so the proof comes first and two reviewers read it.

**What the reader gets.** In a document with footnotes, an edit to ordinary text updates the page in place. Today one footnote definition anywhere makes every change rebuild the whole page: on the 195 KB reference (30 footnotes) a one-line reload costs 5.1 s against 0.8 s for the same file without them, and a block edit 6.1 s against 1.0-1.9 s.

**How footnotes are rendered today** (`packages/core/src/render/render-html.ts`): `collectFootnotes` numbers labels by the order of the first top-level definition of each (key: the label with whitespace folded, upper-cased). Definitions are skipped in the body. `footnoteList` appends an `<hr>` and `<ol class="marxy-footnotes">` whose items have `id="marxy-fn-N"` and back-links to `#marxy-fnref-N`. Heading ids reserve the `marxy-fn-N` names (`heading-ids.ts`). `apps/desktop/src/render/incremental.ts` refuses with `'a footnote definition applies across the document'` when the new document (about 359) or the old (about 362) holds a top-level footnote definition; `footnoteDefinition` is not a cut point (`isCutPoint`, about 98). `packages/core/src/render/pipeline.ts` (about 132) `renderDocumentSafeHtmlInSlices` also returns null for any footnote definition, which is why a large file with footnotes is not rendered in slices.

**What has to be true for a splice to be right.**

- The number of every reference outside the replaced blocks is unchanged. Numbers come from the order of definitions, so compare the label-to-number map of the old document with the new: identical means no reference outside the cut changes. Different means fall back to the whole render (re-rendering every block that holds a reference is a later refinement, not this branch).
- References inside the replaced blocks are rendered with the document's numbering, not a numbering of the cut alone. The splice renders the cut's blocks on their own today; they must be given the map.
- The list at the end is its own unit. It changes when a definition's content changes, when the set or order of definitions changes (already a fallback by the rule above), and when the references to a label change in number or order, because each item links back to its references. After the body splice, render the list from the new document and replace the old one if it differs. Find out exactly what a list item contains per reference (one back-link per reference, or one per label) before deciding when it can be left alone.
- Definition blocks are in the source between body blocks but draw nothing there. The cut logic must treat an edit inside a definition as "body unchanged, list changed", and the byte attributes of everything after must still shift.
- The ids: `marxy-fnref-N` for the first reference to a label and whatever form later references take; a splice must not produce a duplicate or leave a dangling one.

**Do.** Replace the two refusals with the rule above. If the same reasoning lets `renderDocumentSafeHtmlInSlices` slice a document with footnotes (the body in slices, the list at the end from the whole document), do it in a second commit; if not, say why.

**Order of work.** First extend the byte-for-byte page test to documents with footnotes: `fixtures/corpus/32-long-reference.md` (excluded from the pool today), and generated documents with definitions at the top, bottom and middle, labels referenced zero, one and several times, a reference before its definition, duplicate definitions of a label, a definition inside a block quote (not top level: check how it is numbered and rendered today), edits that touch only prose, edits that add or remove a reference, edits inside a definition, edits that add, remove or reorder definitions. See them counted as refusals on the old code, then build.

**Proof.** That test, with the splice taken for most edits that do not change the definitions' order, and equality byte for byte in every case. A browser test: on the long reference, a one-line change on disk replaces a handful of nodes; the footnote links still go to the right places (click one, land on the right item; click the back-link, land on the reference). Fails on master.

**Numbers.** On `long-reference` (with footnotes): reload of one appended line replaces under ten nodes and costs about what `long-reference-plain` does (0.8 s on master, less after `splice-all`); undo likewise once `splice-all` is in.

## block-cache

**What the reader gets.** A code block, a formula or a diagram that has been drawn once is drawn the same way at once the next time the same text is rendered: no moment of uncoloured code after a re-render, a tab switch or a reopen.

**Today.** In Read, `tokenize` (`apps/desktop/src/render/highlight.ts` about 267-277) posts every code block's text to the worker on every render; `applyHighlightToCode` (about 396-411) first writes plain lines and replaces them when the colour arrives (two writes, two height changes). Source has the cache Read lacks: `fenceColour` in `apps/desktop/src/source/colour.ts` (about 216-277), 256 entries keyed by language and text. `applyMath` (`render/math.ts`) calls `katex.render` for every formula not already marked done; `render/diagram.ts` (about 47) draws every diagram again.

**Do.** One store of token runs keyed by language and text, used by Read and Source alike (move Source's into a shared module rather than adding a second), bounded by entries and by total characters. On a hit in Read, paint the colour in the first write. The same for KaTeX output keyed by display mode and source, and diagram output keyed by source, each bounded. The stores hold strings and runs, never DOM nodes. A theme change must not serve stale colour: find out whether token runs depend on the theme (they are scopes or colours?) and key or clear accordingly.

**Proof, by counts.** Render a document with twenty code blocks, then render it again: the second render posts nothing to the worker (count `postMessage` on the worker) and writes each block once (a MutationObserver), and the resulting HTML equals an uncached render's. The same for formulas with `katex.render` counted. A theme switch still recolours. Each fails on master.

**Numbers.** Tab switch away and back on `long-reference`: no worker posts for code on return. This branch matters less once `splice-all` lands (unchanged blocks are not re-rendered at all); its remaining value is reopening and tab switches, so measure those.
