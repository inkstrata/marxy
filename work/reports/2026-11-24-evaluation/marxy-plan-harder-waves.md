# Marxy: the plan after the first wave

24 November 2026. This follows the [evaluation](marxy-evaluation-bloat-performance.html). The first wave (six small branches) is being built now; this is the plan for what is harder. It rests on four code scouts and one research pass, all read-only, and nothing here is built yet.

## Corrections since this was written

**25 November: X1 (skipped layout) says no-go for 2d as built, and 2c first.** Measured on throwaway branch `agent/x-skipped-layout` (report `C:\Dev\reader\work\experiments\X1-skipped-layout\report.md`). With everything in place (V4), the 195 KB page's work from open to quiet falls to 12% of today's (576 ms against 4,977 ms), but three of the four go conditions fail: a typesetting slice still costs 3.5 times as much on 1 MB as on 25 KB (limit 2x); 22 source lines read into skipped blocks (limit 15, twelve of them the typesetter setting paragraphs inside skipped blocks); and the page changes in ways a clip margin does not fix (block quotes half a line taller, tables a line shorter, margin notes moved; hung list markers and quotes are clipped but `overflow-clip-margin` restores them in Chromium). Scrolling a 1 MB page gets much worse. Bounding the typesetting queue alone (V1) gives 83% of the gain, so the order changes: `near-typeset` (2c) is built as soon as `typeset-view` and `geometry-table` allow, and `skipped-layout` (2d) moves to after everything else, to be re-tried once the geometry table (2b) has removed the reads and the typesetter skips skipped blocks. Skipping alone (V2) gave nothing, which confirms 2b before 2d. A new finding the plan does not cover: on a 1 MB page, 47% of open is the progressive mount forcing layout once per chunk (`render/progressive.ts`), which no step here touches; it is a candidate branch of its own.

**24 November, evening.** Step 1e (definitions) said the same index would also let the sliced parse used when opening large files, and the notes scan in Source, keep working on files with definitions. The builder of the parse half found that it does not: a parse done in slices has no earlier parse to take an index from, so it would need a first pass over the file to collect definitions. That is a separate piece of work, not a free consequence. The reload gain itself is as planned and larger than expected in the parser: a one-line reload of the 195 KB reference re-parses 157 bytes in 1.3 ms where it parsed the whole file in 144 ms. The reader sees none of it until the page update stops refusing on footnotes (the render half, `footnote-splice`).

## Where the detail is

This page is the argument. The working detail, written so an orchestrator on Opus can carry it out without this conversation, is in `C:\Dev\reader\work\plan\`:

| File | Holds |
| --- | --- |
| `00-handoff.md` | the state of every branch, who builds and reviews what, your standing instructions, the cycle for a branch, how wave 1 is landed, the queue after it |
| `01-experiments.md` | ten experiments, each with its question, method, what to record, and the rule that turns the result into a decision |
| `02-briefs-render-path.md` | five branches: one in-place update path for every edit, and footnotes |
| `03-briefs-viewport.md` | four branches: the typesetter's callers, the table of block positions, type set near the reader, skipped layout |
| `04-briefs-warm-and-shell.md` | six branches: warm documents, and the shell's file-system work |
| `05-briefs-verification-and-cleanup.md` | ten branches: the verify lock, the test bundle, quiet waits, timings out of verdicts, generated lists, and the clean-up |

## The short version

The evaluation found that Marxy's costs grow with the document where they should grow with the change. Fixing that properly is three changes of shape, not a list of patches:

1. **The page follows the change.** One path updates the page in place for every kind of edit, and a footnote somewhere in the file no longer switches it off.
2. **The page costs what is on screen.** Type is set near the reader, not for the whole document, and the browser is allowed to skip laying out what is far away.
3. **Returning is not opening.** A tab you come back to still has its parsed document.

Around those sit two supporting pieces of work: the shell's file-system calls, and a faster, quieter way to verify, which should come early because every later wave pays for it.

What I expect on a 195 KB Markdown reference, against what was measured:

| Action | Today | After wave 1 | After the three shifts |
| --- | --- | --- | --- |
| Cursor key | 40-110 ms | about 10 ms | about 10 ms |
| First click | 166-250 ms | under 30 ms | under 30 ms |
| Undo, tick a checkbox | 3-5 s | 3-5 s | under 0.3 s |
| Reload after one line changes | 5.1 s | 5.1 s | under 0.3 s |
| Open, until the page is still | 3-6.5 s, about 8 s of work | about 7 s of work | under 1.5 s of work |
| Tab switch | 0.5 s then 2 s of typesetting | the same | under 0.25 s |

The last column is a target, not a measurement. Each step below names the number that would show it worked; the first wave's `measure-interactions` tool is how each will be checked.

Five decisions are yours, listed in the last section. Two of them shape the work: whether paragraphs far from the reader may wait to be typeset until approached, and what undo should do after you leave a tab and come back.

## What other software does, and what applies here

Checked against primary sources where marked; the rest is common knowledge I could not source.

- **Draw near the viewport only.** CodeMirror renders the viewport plus a margin and keeps a height for every line, estimated until measured (confirmed). The browser offers the same economics natively: `content-visibility: auto` skips style, layout and paint of off-screen blocks while keeping them in the document for find, anchors and accessibility (confirmed, CSS Containment spec). Marxy already uses it for big code and log files (`packages/theme/src/base.css:603`) and already has a restore loop that tolerates estimated heights (`apps/desktop/src/commands/log.ts:274`). It does not use it for prose.
- **A model, not the DOM, answers questions about position.** The condition that makes the browser's skipping pay is spelled out in the spec: any script that reads the geometry of something inside a skipped block forces that block to be laid out. Editors never ask; they keep a table. Marxy asks constantly (the block list is rebuilt by reading every block's rectangle).
- **Work proportional to the edit.** VS Code re-tokenises from the edited line until a line's end state matches the old one (confirmed). Marxy's splice already does the equivalent for blocks; it is simply not offered most edits.
- **Cross-references are an input, not a reason to give up.** micromark's own documentation says definitions must be known for the whole document before inline text is parsed, which is why Marxy's region parse refuses when one exists. The standard answer is a first pass that collects the labels, then region parses that are told them. Lezer's Markdown parser goes further and does not check that a reference's target exists, trading correctness for speed; Marxy should not.
- **What does not apply.** A faster parser (the native ones run about a hundred times faster than micromark) would hide the problem and break the one-parser rule and the goldens. Full virtualisation, where far blocks are removed from the document, breaks find, selection across blocks and anchors. Measuring text on a canvas instead of in the page loses the optical size, weight and kerning that `packages/typeset/src/measure.ts` says it measures in the page to get. Chromium has no native equivalent of the Knuth-Plass pass, the baseline grid or hanging punctuation, so the JavaScript typesetter stays.

## Shift 1: the page follows the change

### What is true today

- The splice (`apps/desktop/src/render/incremental.ts`) takes the old and the new parsed document, finds the blocks that differ, and replaces only their elements. It needs no edit range and works for any change.
- The view offers it only to reloads and to the block editor's own commits, and only above 64 KB (`rendered-view.ts:2004`, `:310`). Undo, redo, Read operations and a commit from Source always rebuild the page.
- Every edit-shaped commit parses the whole file (`document/store.ts:546`, `:558`). Only reloads use the region parse.
- A link-reference or footnote definition anywhere makes the region parse fall back to the whole file (`packages/core/src/parse/reparse.ts:65`), and a footnote definition makes the splice refuse (`incremental.ts:359`), because footnote numbers and the list at the end of the page depend on every definition.
- The proof that the splice is right is strong and reusable: a test that applies random edits and requires the spliced page to equal a whole render byte for byte (`apps/desktop/test/live-reload.test.mjs:500-667`), and one that requires a region parse to equal a whole parse (`packages/core/src/parse/reparse.test.ts`). Neither covers edits other than reloads, and both leave out documents with definitions.

### Steps

**1a. Offer the splice to every change.** In the view, one rule replaces the `reload` flag: any change that sets the page tries the splice and falls back when it refuses. The legitimate refusals stay (raw HTML left open across blocks, a heading id that moved, a change that is most of the document). Size: medium. Risk: state that a whole render rebuilds and a splice does not; the scout lists the per-page passes to check (typeset adoption of new nodes, block list, selection, find, depths, notices). Proof: the byte-for-byte page test extended to chains of apply, undo, redo and Source commits. Expected: undo on the long page from 4-5 s to about 1 s (block-edit commits, which already splice, measured 1.0-1.9 s).

**1b. Parse the region for every edit.** The store calls the region parse for apply, undo, redo and Source commits; the edit's byte range is already known. Size: small. Proof: the parse-equality test over undo and redo chains. Expected: about 0.3 s less on the long page.

**1c. A commit from Source splices when Read is shown again.** Today a hidden page is marked stale and rebuilt whole on return. The record of the old page is still held, so the splice can run at that moment. Size: small, after 1a.

**1d. Drop the 64 KB floor.** Once 1a is proven at small sizes by the same test. The gain on small documents is not milliseconds; it is that type is not reset and code does not lose its colour for a moment on every edit. Size: small.

**1e. Definitions stop disabling the path.** This is the hard one, at two levels.

- *Parsing.* Keep an index of the file's definitions (label, kind, where it is, what it points to). A region parse is allowed when the edit neither touches nor creates a definition, and it is given the file's labels so references inside the region resolve as they would in a whole parse. Giving micromark the labels means seeding two internal lists (`parser.defined` for links, the footnote extension's own list, which the scout found are normalised differently) through a small extension, and passing the definitions to the step that resolves link targets (`from-mdast.ts:49-61`). An edit that adds, removes or changes a definition still parses the whole file; that is rare next to editing prose in a document that happens to have footnotes.
- *Rendering.* Footnote numbers follow the order of definitions, so if the definitions did not change, no number outside the edited blocks changes. The list at the end of the page becomes one more unit the splice can replace, re-rendered when the references in the edited blocks changed.

Size: large, and the place most likely to produce a subtle wrong page. Proof: both equality tests run over documents with definitions and footnotes (the corpus pools that exclude them today), with edits that touch and do not touch definitions. Expected: the one-line reload from 5.1 s to about 0.8 s, which is what the same file measured with its definitions removed. The same index also unblocks the sliced parse used when opening large files, and the notes scan in Source, both of which give up on definitions today.

**1f. Remember expensive block output.** Colour tokens, KaTeX output and diagrams keyed by their source text, shared with the cache Source already has (`source/colour.ts:216-277`). After 1a most blocks are never re-rendered, so this matters mainly for reopening and tab switches. Size: small to medium.

## Shift 2: the page costs what is on screen

### What is true today

- The typesetter sets every paragraph in the document. After the viewport, the rest go into an idle queue sorted by distance, and "done" means the queue is empty (`packages/typeset/src/index.ts:807-811`, `:861`).
- Each batch reads layout after writing at three to five points, and each read lays out the whole article because nothing limits how far a change spreads. Slices budgeted at 24 ms cost 90-190 ms on a 10,000-node page.
- At open it reads the rectangle of every paragraph in the document to sort the queue (`index.ts:791`).
- The baseline grid is global: a block is padded so the next block's top lands on the grid, which depends on everything above. A local form exists and is used for changed blocks: pad the block itself to a whole number of grid units, so nothing below moves (`grid.ts:237-244`).
- The list of blocks with their tops and heights is rebuilt by reading every block after every grid pass (`apps/desktop/src/render/post.ts:133-148`). Position, the spine, the crumbs and the outline mark read it.
- Scroll anchoring by the browser is switched off (`grid.ts:72`); the app compensates by hand, and not while the reader is scrolling.
- Tearing down the typesetter reverts every paragraph even when the page is about to be discarded.

### Steps

**2a. Remove the waste first.** No change of behaviour: no revert when the page is discarded; a grid pass only when lines moved, and only for the blocks that changed; the block list updated from the changed block down instead of rebuilt; no read of every paragraph at open. Size: medium. Expected: a noticeable part of the 8 s, and smooth scrolling while type is being set. This is worth doing whatever is decided about the rest.

**2b. A table of block geometry.** One record per top-level block (its byte range, top, height, whether it has been laid out), kept current from resize notifications, which the browser delivers once per frame without forcing layout. Position, spine, crumbs and outline read the table. Precision inside a block is computed when asked, for the one block under the reading line. Size: medium to large. This is the piece everything after it depends on, and it also removes the whole-page measure on returning from Source (evaluation P7) and the rebuild on every highlight batch.

**2c. Set type near the reader only.** The idle queue is bounded to a few screens around the viewport and extends as the reader moves; a jump (outline, find, restored position) sets the landing place at once, as now. "Done" comes to mean that nothing near the reader is unset. A set-everything mode remains for export, print, the rag gate and the tests that count set paragraphs. Size: medium. The cost is that a far paragraph has its native height until approached, so heights above the reader can change while scrolling up; the app's own compensation does not run during a scroll. In the shipped engine the browser's scroll anchoring can do it (it is Chromium), which the test engine, WebKit, does not have. That needs an experiment, and it is the first of your decisions. Expected: open on the long page from about 8 s of work to under 1.5 s; a width or theme change the same.

**2d. Let the browser skip what is far.** `content-visibility: auto` with a remembered size on each top-level block, as the log view does today. With 2b and 2c in place nothing reads inside far blocks, so they stay skipped, and a typesetting slice costs the layout of what is near. The grid has to become local for this (every block a whole number of units, estimates included), which is the largest single piece of work in the plan. Size: large. Risks: any forgotten whole-page read silently undoes the gain; estimated heights make the scroll bar drift until blocks are seen; the two proposals that read every table and every footnote reference (`table-aids`, `notes-in-place`) need another way to find what is near.

**Before 2c and 2d: a spike.** A throwaway branch that turns on `content-visibility` for prose blocks, bounds the queue, and stubs the whole-page reads, measured with `measure-interactions` on the 195 KB document and a 1 MB one, with a list of what broke. Two days of a builder. It tells us whether the gain is the factor of five I expect before the grid is redesigned for it.

## Shift 3: returning is not opening

### What is true today

- A background tab is only a path. There is no store, no page, nothing kept; clicking it runs the whole open.
- Stores are closed the moment the last view lets go. But a warm route already exists: when the other pane shows the same file, the open skips the read and the parse (`document/open.ts:486-497`).
- A store that no pane shows has its watch events dropped (`document/live-reload.ts:307-309`), so nothing would notice a change on disk.
- The validator exists: `store.reload(bytes)` compares, and re-parses only what changed. It is private to the watch code.
- A document with unsaved edits is never backgrounded; leaving it asks first.
- A test requires a store to be collectable after four other documents have been opened in its pane.

### Steps

**3a. Keep the last few stores.** Three per window, with the sanitised page text beside each. The watch stays on while a store is warm, and an event for an unshown store marks it for checking on return instead of being dropped. On return: if nothing was marked, no read and no parse; if marked, read and `store.reload`. The leave-document prompt stays exactly as it is, so a warm store is never dirty. The side effects of opening (recents, the index's front root, kind and encoding choices) still run. Size: medium. Expected: about 120 ms off an ordinary switch and 0.3 s off the long one; with shift 2 the typesetting tail goes too.

One visible change comes with it: a kept store keeps its undo history, so Mod+Z after returning to a tab could undo an edit made before leaving. Editors generally work that way. The alternative is to clear history when a store goes warm. That is your second decision.

**3b. Not planned: keeping the rendered page.** Every module that touches the page (selection, spine, notes, depths, find, the parts cursor) is wired to the one article element per pane, and the typesetter reverts its work when detached. After shifts 1 and 2 a re-render of a long document should cost a few tens of milliseconds plus the viewport's type, so the collision is not worth it. I would revisit only if the numbers say otherwise.

## Supporting work

### The shell's file-system calls

- **One listing per folder.** The tree scan lists each folder twice and then opens every file. The second listing already asks Windows for a record that carries attributes, size and times, and throws away everything but the file id (`src-tauri/src/watch/mod.rs:146-168`). Using what is already fetched removes the first listing and every per-file open: five to eight times cheaper per scan by proxy measurement, for the tree watch and for the two-second folder poll alike. Risk: the time values must convert exactly as the standard library's do, or the first scan after the change reports every file as modified. Size: medium.
- **The tree watch skips what the index skips.** The ignore rules live in TypeScript; rather than port a matcher, the walk passes the folders it skipped to the watch. Size: small.
- **One call for the index walk.** A `read_tree` built on the same lister returns every folder's entries and ignore files in pages; heads of Markdown files are still read separately, but only for files that changed. Size: medium.
- **Search judged by the opened handle, on several threads.** The scout found that search's check against a link swapped in after the path was resolved is weaker on Windows than the one `read_file` uses, so judging by handle is a safety improvement as well as about 3.7 times less file-system work per file. Threads come from the standard library, with no new dependency; results must stay in input order because a shared test compares them with the TypeScript twin. Size: medium.

### Verifying faster and more quietly

This should run in parallel with the first shift, because every later branch waits on `verify`.

- **A machine-wide limit on browser batches.** For this wave I had to write a two-slot lock script outside the repository so six builders would not starve each other. `verify` should hold such a lock itself, as `check:tauri` does. Size: small.
- **One bundle for the browser tests.** About 70 test files already boot from a build; 177 use the dev server, which serves about 250 modules to every test. The obstacle is that 99 files import app modules by address inside the page; eight modules account for nearly all of it, so a small registry exposed by the harness bundle replaces those imports. Pilot on ten files and measure before converting the rest. Size: medium.
- **A quiet signal instead of sleeps.** I overstated this in the evaluation. Of a sample of 42 fixed waits, 15 wait to show that nothing happens and 8 wait out one of the app's own timers; a "page is finished" signal replaces neither. What would replace most of them is a detector in the harness that knows when the page has no pending timers, frames, idle work or shell calls: if the page is quiet and the thing has not happened, it will not. That needs no change to the app. Size: medium, and worth a pilot.
- **Timings out of verdicts.** The stall bounds in about 20 browser tests move to the measuring tool; assertions on counts stay where a count exists.
- **Lists generated, not copied.** The command list, the file-type associations and the test coverage map each from one source.

A related question, your fifth decision: the browser tests run in WebKit and the shipped app is Chromium. No reason is recorded. Shift 2 leans on behaviour the two engines do not share (scroll anchoring, some scheduling calls), so at least the measuring tool and a smoke set should run in the shipped engine.

### Simplifications left from the evaluation

One escape function with one character set, one size formatter, one `plural`, one state-file helper (after wave 1 lands, since it touches many files). One `Shell` interface. In Rust: `toml` to the version Tauri already uses, Tauri without default features, and one run of `cargo bloat` to decide whether the OpenEXR and JPEG XL decoders earn their place.

## Order

| Wave | What | Can run side by side | Depends on |
| --- | --- | --- | --- |
| 1 (building now) | Lookup cache, first click, grammars once, dead code, verify defaults, the measuring tool; then the residue sweep | all six | |
| 2 | 1a and 1b (one branch: the view and the store); 2a split in two (the typeset package; the view's callers); the verify lock and the bundle pilot | the typeset package and the verify work run beside 1a; the view half of 2a follows 1a, because both edit `rendered-view.ts` | wave 1's measuring tool |
| 3 | 1c, 1d; 1e (the definitions index, in core); the spike for 2c and 2d; 3a | 1e, the spike and 3a touch different files | 1a |
| 4 | 2b, then 2c, then 2d | one after another | the spike's result, and your decision on lazy typesetting |
| 5 | The shell: one listing, search; then the walk and the ignore rules | listing and search side by side | |
| 6 | The quiet signal, timings out of verdicts, generated lists; helper consolidation; the Rust trims | mostly | |

`rendered-view.ts` (3,023 lines, one function) is the file nearly everything in shifts 1 and 2 passes through, which is why those steps queue. Splitting it is already on the tracker; I would not do it first, but I would have each of these branches move the code it touches into its own module as it goes, so the file shrinks as a side effect.

## Who builds what

Builders on Sonnet with a different model reviewing, as in this wave, for everything marked small or medium. For 1e (definitions) and 2d (the local grid with skipped layout) I would use the strongest builder available and a second reviewer, because each can produce a page that is wrong in a way no test yet looks for, and each needs its proof extended before the change is written. That is your fourth decision.

## Decisions

Decided on 24 November, on "use your recommended defaults":

1. Far paragraphs may wait to be typeset until approached; export, print and the rag gate set everything.
2. A kept store keeps its undo history across a tab switch.
3. The spike for skipped layout runs now, beside wave 2.
4. The two hard steps (definitions, the local grid) go to the strongest builder with a second reviewer; the rest to Sonnet with a reviewer on a different model.
5. The measuring tool and a smoke set run in the shipped engine as well as WebKit.

As they were put:

1. **May far paragraphs wait?** Step 2c sets type near the reader and leaves the rest in native wrapping until approached. Done well it is invisible; it is still a change to what "typeset" means for a page. Export and print would always set everything.
2. **Undo after leaving a tab.** Keep history across a tab switch (step 3a, what editors do), or clear it so behaviour stays as today.
3. **Run the spike for skipped layout now**, beside wave 2, or wait until shift 1 has landed.
4. **Strongest builder for the two hard steps**, or Sonnet throughout with more review.
5. **The test engine.** Keep WebKit only, or run the measuring tool and a smoke set in the shipped engine too.

## What I do not know

- Whether the browser's scroll anchoring holds the page still while paragraphs above are set during a scroll (step 2c). Needs the experiment.
- Whether seeding micromark's two label lists gives results identical to a whole parse in every case, in particular the order in which a first definition wins. The equality test will say.
- How much of a typesetting slice's cost is the final forced layout and how much the reads before it. The spike will say.
- What Playwright's WebKit does with `content-visibility` on prose, and whether it carries the fix for find inside skipped content.
- The real cost of a round trip to Rust, which decides how much the batched walk is worth.
