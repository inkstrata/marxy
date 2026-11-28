---
corpus: windowed-pages
updated: 2026-11-27
status: active
---

# Synthesis: Windowed Markdown pages

## Bottom line

Skip tier 1 and build tier 2 on one byte-keyed geometry table. `content-visibility: auto` on every block fails with
this typesetter in WebKit: skipped paragraphs give no Range rects, so they stay unset and the page still reports itself
done (14 of 5,726 set at 2 MB; TIR-02). In Chromium it works but makes the open twice as costly and speeds up nothing
the reader feels (TIR-04, TIR-05). It is also missing below Safari 18, and the app supports macOS 13 (ENG-01, ENG-04).
So every page gets the same model: a pure table of blocks (byte length, height in whole grid units, estimated or
measured), built from the parse before any HTML exists. Position, find, copy, jumps and print all go through it.
One mounting policy reads a node budget of **10,000 nodes** under the article: below it, every block is mounted; above
it, the blocks within about two screens, typeset as they mount. 10,000 is where WebKit's whole-article layout reaches
about 16–18 ms, and WebKit costs 20–30 times more per node than Chromium (NOD-01, NOD-02). The held geometry-table
branch keeps its pure half and its guards, but its DOM-derived records must go: an unmounted block has no record there
(CMP-12, HMP-12, EDW-10). Two things are untested and could change the plan:

- **Screen readers.** Tier 2 removes unmounted text from every screen reader, so an explicit "whole page" setting is
  part of the design, not an extra (ACC-01, ACC-12). Nobody has yet tried VoiceOver over either tier.
- **Print.** Today's print probably keeps screen-width line breaks (TBD-09). No print was run.

## Answers to the brief

- **Q-01** · answered · CMP-01, CMP-02, CMP-04, CMP-05, CMP-06, CMP-07, CMP-08 · whole-page geometry cost comes from three places: the block list rebuilt at about a dozen sites, the typesetter's grid pass and queue (a rect per block per round), and per-feature scans of the article. Four readers take a zero rect to mean "not shown". `mountThrough` has about 25 callers, three of which mount everything.
- **Q-02** · answered · TIR-01–TIR-09, ENG-01, ENG-04 · WebKit really skips (whole-article relayout 53 → 8 ms at 1 MB), but the typesetter leaves skipped paragraphs unset. Chromium sets everything, but task time to done rises 4.5 → 8.8 s at 1 MB, and scroll, key and find gain nothing. No-go on both engines (D-01).
- **Q-03** · answered · NOD-01–NOD-07 · in WebKit, whole-article layout grows linearly at about 1.3–2.1 µs per node: 16 ms at 7.7k nodes, 39 ms at 21k, 96 ms at 73k. A cursor key stays flat to about 12k nodes and is 64 ms at 40k. Chromium is 20–30 times cheaper per node. Budget: 10,000 (D-02).
- **Q-04** · answered · HMP-01–HMP-08, HMP-14 · CodeMirror 6 uses a balanced height tree with an oracle for estimates and an outdated flag. Monaco uses flat arrays with prefix sums rebuilt lazily. pdf.js uses sized placeholders and renders by distance and scroll direction. The paginating readers do not window (`[absence]` for their layout source, HMP-14).
- **Q-05** · answered · ENG-01–ENG-09 · `content-visibility` arrived in Safari 18 and was findable only from 26. `contain-intrinsic-size` arrived in Safari 17, `overflow-anchor` only in Safari 27, which macOS 13 and 14 never get. Whether a Safari update reaches other apps' WKWebView is an `[absence]` (ENG-04). WebView2 has every feature.
- **Q-06** · answered · ANC-01–ANC-12, TIR-08 · keep an anchor of block, byte offset and grid units below the block's top. After any change, write `scrollTop += Δtop` in the same frame, in a loop, as CodeMirror does. Estimate by block kind: paragraphs from bytes come within 0.88–1.33 of their real height; headings, tables and lists need their own rules.
- **Q-07** · partly · ACC-01–ACC-13 · tier 2 hides unmounted text from screen readers, and no page can read the VoiceOver cursor. Mounting can follow DOM focus, as the ARIA feed pattern does. Mitigations: a whole-page setting and a heading skeleton. Nothing was tested with a real screen reader.
- **Q-08** · answered · FSC-01–FSC-16 · find matches over a cached rendered text per block. Select all becomes the selection model's `document` kind. Copy builds text from the cache and HTML from the parse. Only mounted matches get painted Ranges; a match elsewhere is mounted through first.
- **Q-09** · answered · TBD-01–TBD-10, NOD-03 · line breaking takes 0.01–0.8 ms per paragraph, so it is not the cost; the cost is Range-rect reads and the article layout after each batch. The grid pass is local once its origin read is changed. Blocks are set as they mount, ranked by distance in grid units. `typesetThrough(target)` serves jumps. Print reverts to native wrapping (D-07).
- **Q-10** · answered · EDW-01–EDW-06, EDW-08–EDW-10 · if the table stores lengths, a splice replaces only the changed entries. The DOM-side shift of every later element's byte range, and the block-list rebuild, are what cost O(page) today. The buffer splice stays O(file) whatever the table does.
- **Q-11** · answered · HMP-09, HMP-10, CMP-11, FSC-16, ANC-08, EDW-10 · a pure core module: typed arrays of byte lengths, unit heights and flags, with prefix sums rebuilt lazily; an anchor API; and a mounted-set adapter that feeds in measurements (D-03).
- **Q-12** · answered · CMP-14, CMP-15 · the table core, the scale record and the node budget run in parallel. Then the readers move onto the table, beside find and copy over the model and the typesetter's distance queue. Windowed mounting comes last (D-04).
- **Q-13** · answered · CMP-15, NOD-07, EDW-02, EDW-03 · above the budget, windowing removes the End key stopping short, the per-key position cost, width-change relayout and the busy big open. The splice and undo path and the dense page's typesetting time still matter below it (D-05).
- **Q-14** · answered · HMP-11, ANC-12, CMP-07 · CodeMirror, ProseMirror and the virtualisers each keep one path at every size; a short document is just a window that covers everything. VS Code's large-file mode and pdf.js's lazy start show what a second path costs: their own code comments say what breaks, print among it (D-06).

## Decisions

### D-01 · Tier 1 is no-go on both engines; go straight to the windowed mount
- **Choice:** do not put `content-visibility: auto` on Markdown blocks as a tier. Build only the windowed mount (D-02 to D-04). Revisit `content-visibility` only as an optional addition for the whole-page setting (D-07), once the typesetter treats a skipped block as not yet measurable.
- **Because:**
  - WebKit 26.6: skipped text returns 0 Range rects on the first read. The typesetter then leaves the paragraph unset and still resolves `done`. Set counts with the rule were 14 of 716 at 0.25 MB, 858 of 2,864 at 1 MB and 14 of 5,726 at 2 MB, against all of them without it (TIR-02). The cause is read from the code, not traced (`[likely]`).
  - Chromium 153: all paragraphs set and the grid intact, but task time to done went 4.5 → 8.8 s at 1 MB and 5.3 → 22.9 s on `md-technical`. Scroll, key and find were unchanged (TIR-03, TIR-04, TIR-05, TIR-07).
  - Engines: Safari 18 is the floor for `content-visibility`, and `auto` is findable only from Safari 26 (ENG-01). The app's macOS 13 floor may have neither (ENG-04).
- **Verified by the lead:** re-read every cited row in `probes/tier1/summary.txt`. WebKit prose `bytes` rows: set 14/716, 858/2,864, 14/5,726 and 9,202/14,028 (4.9 MB); `off` rows: all set. Chromium prose 1 MB task time: 8,821 against 4,505 ms. Also read `packages/typeset/src/index.ts:697`, where the paragraph leaves the observer whether or not it was set.
- **Untested:** the real WKWebView and WebView2, as opposed to Playwright's WebKit and Chromium; macOS 13 and 14.
- **Falsifier:** a typesetter that waits for `contentvisibilityautostatechange` before measuring, giving a WebKit 1 MB open, fully set, in under half of today's time with key and scroll no worse. Then tier 1 would be worth having as the whole-page setting's engine.
- **Large-files D-01 is refined here:** its "tier 1 then tier 2" becomes "tier 2 only".

### D-02 · Node budget: 10,000 nodes under the article, decided before mounting
- **Choice:** one constant, 10,000 nodes (elements and text nodes under the article), for both engines.
  - The scale record predicts the count from the parse before mounting, and the mounting policy compares the prediction with the budget.
  - Measured nodes per KB: 40–65 for prose and about 470 for dense blocks. So 10,000 nodes is about 150–250 KB of prose and about 20 KB of dense Markdown (NOD-07).
  - A second guard limits typesetting work: on dense pages the typesetter's queue, not the node count, breaks first (NOD-03).
- **Because:**
  - WebKit whole-article layout (in-page, median): 4 ms at 1.3k nodes, 16 ms at 7.7k, 19 ms at 12.3k, 39 ms at 21k, 68 ms at 40k. It is linear with no knee, so 16 ms of layout per relayout (one frame) is the criterion (NOD-01).
  - A WebKit cursor key: 26–38 ms up to 12k nodes, 64 ms at 40k (NOD-01).
  - Chromium: 3.3 ms of layout at 38k nodes (NOD-02).
  - A Windows Chromium run of the same file shapes, on another machine, put its comfortable budget at about 20,000 nodes (cursor key 13, 23 and 43 ms at 25k, 45k and 81k nodes). It had no WebKit result (reported to the lead on 2026-11-27, not measured here).
- **Verified by the lead:** re-read `probes/node-budget/webkit-md-prose.json` and `chromium-md-prose.json`.
  - WebKit article-width layout (synchronous part, median): 4, 7, 16, 19, 39, 68, 96 and 180 ms at 1.3k, 3.9k, 7.7k, 12.3k, 20.9k, 40.4k, 73.5k and 257.6k nodes.
  - Chromium: 0.2 to 8.3 ms over 1.3k to 140k nodes.
- **Untested:** the real WKWebView and WebView2; how well the parse predicts the node count; whether 20,000 suits WebView2 (Chromium alone would allow 40,000 or more).
- **Falsifier:** a real-window WKWebView run on which a 20,000-node page keeps keys under 16 ms and relayout under 16 ms. Then raise the budget for that engine; it is one constant, not a code path.
- **Lead's choice:** one number for both engines, the slowest engine's. A per-engine constant is allowed later, because it changes no code path.

### D-03 · The geometry table: a pure byte model with a mounted-set adapter
- **Choice:** a core module with no DOM.
  - **Per block:**
    - byte length (`Uint32Array`);
    - height in grid units (`Int32Array`);
    - flags (`Uint8Array`: estimated or measured, mounted, typeset);
    - block kind, for the estimate oracle.
  - **Prefix sums** of bytes and of heights, rebuilt lazily from the lowest changed index, as Monaco does. Storing lengths, not starts, means a splice never shifts the entries after it (EDW-10). Behind the API a Fenwick tree can replace the arrays past about 10^5 blocks (HMP-10, `[likely]`).
  - **Built** from the parse's top-level blocks, with heights estimated per kind (TIR-08), before any HTML is made.
- **API** (callers in brackets):
  - `blockAtByte(b)` and `blockAtY(units)` (position, find, links, Source return);
  - `range(i)`: byte start and end (copy, find, editing);
  - `top(i)` and `total()` (spine, scroll, spacers);
  - `setMeasured(i, units)` (the adapter);
  - `splice(fromBlock, toBlock, newBlocks)` (edit, undo, reload, reparse);
  - `anchorAt(scrollTopUnits)`, `topOf(anchor)` and `toStored` / `fromStored` (scroll keeping, persistence; ANC-08);
  - `blocksIn(y0, y1)` (the mounting policy);
  - `blockText(i)` and `blockFragment(i)` (find and copy, through a cache keyed by block; FSC-16).
- **The DOM half is one mounted-set adapter.** A ResizeObserver over mounted blocks reports heights in grid units, and `ensureMounted(i0, i1)` / `mountThrough(byte)` is the only way in. A ResizeObserver over 40,000 blocks costs at most 6–8 ms (NOD-06).
- **Because:** CMP-11 and CMP-12 (what the readers need, and what the held branch lacks); HMP-09 and HMP-12; ANC-11 (the branch's O(n) shift and 0.5 px tolerance); EDW-10; FSC-16.
- **Verified by the lead:** the verifiers read `origin/agent/geometry-table` at f4fda854. Its records are `{top, height, measured}`, derived from `article.children`; a new block gets height 0; `settleRecords` shifts later records in a loop. Its tip differs from phase 1 (cf4986cb) only by `HANDOFF.md`.
- **Keep from the branch:** the pure search functions and their tests, and the four guards (margin notes, margin-only changes, inner positions after a grid pass, late outline notices). They become tests of the adapter.
- **Untested:** the prefix-rebuild cost at 20k and 100k blocks; placing a position inside one huge block (a long list or fence).
- **Falsifier:** a profile in which the table's prefix rebuild exceeds 1 ms per scroll frame at 5 MB. Then move to the Fenwick tree behind the same API.

### D-04 · Build order, with sizes
1. **In parallel, now:**
   - the table core (D-03), pure with unit tests (M);
   - the scale record at open, whose core half is already drafted on another branch, plus the node prediction (M);
   - the budget constant and its measurement record (S: the data is in, D-02).
2. **Then, in parallel:**
   - **(a)** the mounted-set adapter, and moving position, restore, the spine and the hold mechanisms onto the table (L; `view/rendered-view.ts`, `position/`, `render/post.ts`);
   - **(b)** find, select all and copy over the block-text cache and the parse (M; `find/`, `selection/`; it builds on the find and copy over pending blocks that landed on 2026-11-27);
   - **(c)** typesetting by distance: set on mount, ranked by grid-unit distance with a forward bias, `typesetThrough(target)`, and the grid pass's origin read made local (M; `packages/typeset`).
   - (a) and (c) meet in typeset's `attach()` and the view's `snapChanged`, so (c) lands after (a), or rebases on it.
3. **Last:** the windowed mount itself (L):
   - the policy from the budget, spacers, unmounting far blocks and the anchoring loop;
   - the heading skeleton and the whole-page setting (D-07);
   - print by mounting the printed range with native wrapping.
- **Because:** CMP-14 (sizes and the file conflicts: `rendered-view.ts` and typeset `index.ts` are the bottleneck), CMP-13, TBD-03, FSC-16.
- **Untested:** the sizes are judgements, not measurements.

### D-05 · Whole-page fixes: park what windowing removes, keep the splice path
- **Park** (their cause goes away above the budget, and they cost little below it):
  - End stopping short on a page still mounting;
  - the key and scroll half of the 1 MB Source, edit and undo cost;
  - width-change relayout of a 1–3 MB page;
  - the busy main thread after a 1 MB open (CMP-15, NOD-05, NOD-07).
- **Keep** (they still matter below the budget, or are not about mounting):
  - the splice path: shifting every later element's byte range, and rebuilding the block list after an edit (EDW-02, EDW-03);
  - the buffer splice that copies and decodes the whole file (EDW-01);
  - the dense page's typesetting time (NOD-03);
  - every viewer, shell and parse row.
- **Lead's note:** find and copy on a still-mounting page, the batched grid pass and the leave-Source layout landed on `main` on 2026-11-27, while this corpus was being written. They are not parked.

### D-06 · One path: the policy is the only thing that knows the size
- **Choice:** every page has the table and the adapter. Every reader calls the table.
  - The policy `mountedSet(scale, viewport, setting)` is the only code that reads the budget. Below the budget it returns every block, so the small page is the windowed page with a window that covers everything.
  - **Guard:** run the browser suite once with the budget forced to 0, so every fixture is windowed. A reader that still assumes a whole page then fails on small fixtures, not only at 2 MB.
- **Because:** HMP-11 (VS Code and pdf.js's lazy start document what breaks in their second path; pdf.js's comment says printing is "semi-broken"); ANC-12 (virtualisers and CodeMirror have no small mode); CMP-07 (the existing seams `mountThrough`, `isComplete` and `afterComplete` change meaning but are not doubled).
- **Untested:** whether the forced-zero suite stays fast enough for CI.
- **Falsifier:** a reader that needs a different call on small pages.

### D-07 · The costs, quantified or marked untested
- **Screen readers:** unmounted blocks are absent from the accessibility tree; no page can read the VoiceOver cursor (ACC-05, ACC-06).
  - Design: the whole-page setting, with typesetting still by distance; a permanent heading skeleton; mounting that follows DOM focus, with `aria-busy` while a chunk goes in.
  - Cost: in that mode a 5 MB page pays today's whole-page cost, with the open at about 30 s on Windows Chromium for 1 MB.
  - **Untested.** Falsifier: ACC-12's manual tests (VoiceOver read-all, the rotor headings list, Narrator) on a windowed 2 MB page.
- **Jump to heading, links and search results:** `mountThrough(byte)` then `typesetThrough(target)`, then the anchor loop. A set paragraph changes no margins, so a block far down is snapped without the blocks above it being set (TBD-03, TBD-04).
  - Cost per jump: one batch of about two screens. Not timed.
- **Print:** set paragraphs keep `nowrap` with screen-width breaks, and nothing undoes them before `window.print()` (TBD-09, `[likely]`).
  - Design: on `beforeprint`, mount the printed range and revert to native wrapping, as CodeMirror mounts all for print (ACC-04).
  - **Untested.** Falsifier: an A4 print of a set paragraph that wraps correctly today.
- **Editing in Read:** with lengths stored, the table's share of a splice is O(changed blocks + log n) (EDW-10).
  - Today's DOM shift and block-list rebuild are O(page) (EDW-02, EDW-03). The buffer splice is O(file): 30–60 ms of CPU at 4.9 MB (EDW-01).
  - A definitions change still reparses whole, then rebuilds the table and keeps the heights of byte-identical blocks (EDW-04, EDW-06).
- **Estimate corrections:** paragraphs from bytes come within 0.88–1.33 of their real height (median 1.00). Headings are about 3x off, tables 1.7x and lists 1.2x before kind rules (TIR-08).
  - Corrections go through CodeMirror's before-and-after loop in whole units (ANC-01, ANC-09). An unset paragraph differs from its set height by 0 or ±1 line (TBD-05, `[likely]`).
  - **Untested:** whether a `scrollTop` write cancels trackpad momentum in WKWebView, and estimate error per kind on real files.

## Reconciled conflicts

| Topic | What the chapters said (IDs) | Use | Why |
|---|---|---|---|
| Starts or lengths in the table | 04: `Uint32Array` byte starts with lazy prefix sums (HMP-09); 10: store lengths (EDW-10) | lengths, with prefix sums for starts | a splice then shifts nothing; lookups use the same prefix array |
| Tier 1 and accessibility | 07: tier 1 is the accessible tier (ACC-01); 02: tier 1 breaks the typesetter in WebKit (TIR-02) | no tier 1 for now; the whole-page setting carries accessibility | the measured failure outranks a benefit that rests on one bug report in WebKit (ACC-02) |
| The budget | 03: 10,000 (WebKit layout); a Windows Chromium run: about 20,000 | 10,000 | the slowest engine sets it; one constant |
| Who sets blocks | 09: set on mount, no whole-page queue (TBD-08); large-files D-04: a queue within 2–3 screens | set on mount, ranked by distance | under windowing the mounted set is the near set |

## Risks

| Risk | Likelihood | Impact | Evidence | Mitigation |
|---|---|---|---|---|
| A reader keeps a whole-page assumption and only fails on big files | high | wrong place, find or copy at 1–5 MB | CMP-07, CMP-08 (three callers mount everything) | the forced-zero-budget suite (D-06) |
| The page jumps under the reader on estimate corrections | medium | the reader loses their place | ANC-07, DOM-04 (no `overflow-anchor` before Safari 27) | anchor of block, bytes and units; one same-frame loop |
| Screen-reader users lose text past the window | certain without the setting | the page is unusable for them | ACC-01, ACC-12 | the whole-page setting and the skeleton, shipped with the windowed mount |
| The cached block text differs from the DOM walk | medium | find counts or copy differ | FSC-14 | an equality test over the fixtures |
| The held branch lands as it is | medium | a table with no unmounted blocks | CMP-12, HMP-12 | land its pure half and guards only |

## Actions

- [ ] 2026-11-28 · Table core and scale record in parallel; budget constant (D-02, D-03, D-04)
- [ ] 2026-12 · Adapter and readers; find and copy over the model; typesetting by distance (D-04)
- [ ] 2026-12 · Windowed mount with the whole-page setting, the heading skeleton and print (D-04, D-07)
- [ ] 2026-12 · Manual VoiceOver and Narrator tests on a windowed 2 MB page (ACC-12); an A4 print of a set paragraph (TBD-09)
- [ ] 2026-12 · Re-run both probes in the real WKWebView and WebView2 windows (`probes/`, with `--browser msedge` on Windows)

## Open questions

- Does a standalone Safari update change other apps' WKWebView on macOS 13 and 14 (ENG-04, `[absence]`)?
- How well does the parse predict nodes per block kind (D-02)?
- What is the WKWebView clipboard size limit, if any (FSC-12, `[absence]`)?
- Is the theme's line box a whole number of device pixels, so that grid units map to exact `scrollTop` values (ANC-10)?

## Superseded

- Large-files synthesis D-01 ("tier 1 then tier 2"): tier 1 is dropped (D-01 here, 2026-11-27).
- Large-files synthesis D-04 (an idle queue within 2–3 screens): blocks are set as they mount, ranked by distance (D-04 here). The paragraph cap stays.
- No finding of the large-files chapters is overturned. DOM-08's `[absence]` (no per-node cost published) still holds for published sources; NOD-01 and NOD-02 now give measured numbers.
