---
corpus: windowed-pages
title: Windowed Markdown pages
kind: brief
created: 2026-11-27
---

# Research fleet: shared brief

Corpus: **windowed-pages**, a delta on [`../large-files/`](../large-files/SYNTHESIS.md). You are one of ten Sonnet
agents working in parallel. The lead (Opus) verifies your chapter, writes the synthesis and turns it into the build
order of the windowing work, so write for a careful engineer who will act on what you say. Research date:
**2026-11-27**. Prefer sources from 2024–2026, and say when the newest source you found is older.

## The question

How should the reader make windowing the architecture of a Markdown page instead of something added afterwards?
And is **tier 1** (CSS `content-visibility: auto` with intrinsic sizes on every top-level block) viable with this
app's typesetter on WebKit, or should it go straight to **tier 2** (mount only the blocks near the viewport)?

It serves one decision: the order and design of five pieces of work: (a) the **geometry table**, (b) the **scale
record at open**, (c) **typesetting by distance**, (d) **windowed pages** (tier 1 and tier 2), (e) the **node
budget**; and which fixes that assume a whole page are parked.

## The direction the owner approved (to test, not to assume)

- **One model for every page.** A geometry table over the file's bytes (block → byte range, estimated or measured
  height in whole line-box units of the baseline grid) is always present. Position, find, select all, copy and scroll
  anchoring go through it. Only the mounting policy depends on size: below a node budget the full typeset page as
  today; above it, the blocks within about two screens, typeset by distance.
- **No second code path.** One path for small files and another for big ones is the main risk.
- Costs to quantify: screen readers reading past the mount; jump-to-heading and print needing their target typeset on
  demand; editing in Read (a block splice, undo by bytes) agreeing with the table; correcting estimates without the
  page jumping (grid heights are whole units).

A finding that the direction is wrong is as welcome as one that supports it.

## Sub-questions

- **Q-01** · Which code reads DOM geometry (getBoundingClientRect, offset*, client*, scroll*, IntersectionObserver, ResizeObserver, Range rects) or assumes every block is mounted, in `apps/desktop/src` and `packages/typeset`, and what must the geometry table replace or gate? (01)
- **Q-02** · Is tier 1 viable: with `content-visibility: auto` and `contain-intrinsic-size` from estimates on every block, plus the typesetter's grid pass, does WebKit really skip work; what are open task time, scroll cost and the app's own find, against Chromium? (02)
- **Q-03** · What does main-thread work cost against the number of mounted nodes on each engine, where is the knee, and what node budget follows? (03)
- **Q-04** · How do CodeMirror 6, Monaco/VS Code, ProseMirror, pdf.js, Google Docs, Obsidian and paginating readers (Readium, Vivliostyle, Paged.js) structure their height maps and viewports, and which data structure and API fit the geometry table? (04)
- **Q-05** · Which WebKit releases (as shipped in the WKWebView of each macOS 13–26) and which WebView2/Chromium releases support `content-visibility`, `contain-intrinsic-size: auto`, `overflow-anchor` and find in skipped content, with what known bugs? (05)
- **Q-06** · How should heights be estimated and corrected in whole grid units without moving the text under the reader; how do anchoring by block plus byte offset, CodeMirror's height map and the virtualisers (TanStack Virtual, virtua, react-window) avoid jumps? (06)
- **Q-07** · What do VoiceOver, Narrator and NVDA do with a windowed document, how do Google Docs, CodeMirror and others handle it (aria-setsize/posinset, mounting that follows focus or the reading cursor), and what does it cost the reader? (07)
- **Q-08** · How should find, select all and copy work over a byte model when most blocks are not mounted, building on the app's own find walk and its pending-blocks support; what are native selection's limits and how do editors intercept copy? (08)
- **Q-09** · What does typesetting cost per block, how should the queue order by distance, and how do jump-to-heading, anchors and print get their target typeset on demand? (09)
- **Q-10** · How should editing in Read (block splice, undo by bytes, the Source ↔ Read switch) keep the geometry table true, and how do CodeMirror and ProseMirror keep a document model apart from the DOM? (10)
- **Q-11** · What data structure and API should the geometry table have (what find, copy, scroll, place and print call)? (04, 01, 06)
- **Q-12** · In what order should the five pieces be built, with sizes, and what can run in parallel? (01)
- **Q-13** · Which whole-page fixes should be parked because windowing removes their cause, and which still matter below the budget? (01, 03)
- **Q-14** · How do systems that window avoid a separate code path for small documents, and what breaks when they do not? (04, 06)

## Context map (read this instead of re-reading files)

**The app.** A Tauri 2 desktop reader for local files. System webview: WKWebView on macOS 13–26 (minimum 13.0,
`apps/desktop/src-tauri/tauri.conf.json`), WebView2 (Chromium) on Windows. TypeScript front end. No network.

**Markdown, from bytes to page** (details in `docs/architecture.md`):
1. The bytes are the document; every edit is a byte splice; every rendered top-level element carries its byte range
   as `data-marxy-s` / `data-marxy-e`.
2. micromark parses (in slices for big files) into a tree with byte ranges; rendered to HTML, sanitised.
3. **Progressive mount** (`apps/desktop/src/render/progressive.ts`): the first screens at once, then idle chunks cut by
   element count (3,000 nodes) and 8 ms, each inserted as one fragment, one chunk per frame, **no layout read**. Blocks
   not yet mounted wait in an inert container; a pending change adds `pendingBlocks(article)` so find and copy can see
   them, and `mountThrough` mounts up to a target.
4. **The typesetter** (`packages/typeset/src/`: `index.ts` attach and the idle queue, `ragged.ts` line breaking,
   `hyphenate.ts`, `hang.ts`, `measure.ts`, `grid.ts` the baseline grid, `scheduler.ts`): sets every paragraph in an
   idle queue over the whole page, then a **grid pass** pads blocks so each starts on the baseline grid. The grid
   pass sets `overflow-anchor: none`; the app keeps the reading position itself. A pending change batches the grid
   pass into one pass for all changed blocks; at 1 MB of dense blocks each forced layout of the article still costs
   about 100 ms (Chromium), so only mounting fewer nodes goes lower.
5. After the mount, `buildBlocksByRange` / `buildBlocks` (`render/post.ts`) read one rect per block in a batch.
6. A rebuilt **geometry table** is on the remote branch `origin/agent/geometry-table` (not merged): see
   `git show origin/agent/geometry-table:apps/desktop/src/view/block-geometry.ts` and
   `...:packages/core/src/position/geometry.ts`. An earlier version (lost) cut open layouts only 472 → 420 and broke
   an outline of 20,000 headings.
7. A pending change hides the Read page behind Source with `content-visibility: hidden` instead of `display: none`:
   Chromium gained clearly (1 MB JSON back to Read 1 s → 0.27 s), WebKit showed no clear gain; its review warned that
   code reading positions treats zero rects as "not shown".
8. The app's own find: `apps/desktop/src/find/walk.ts`, `view.ts`, `text-index.ts`. Copy: `selection/copy-text.ts`.
   Position keeping: `position/`, and `view/rendered-view.ts` (3,100 lines; its hold mechanisms).
9. From 5 MiB, Markdown switches to a virtualised "lines" reading, so 1–5 MB gets the whole typeset page.

**Measured so far** (headless, a heavily loaded Mac, CPU or CDP task time): a 1 MB Markdown page shows text in
1–4.4 s but keeps the main thread busy 22 s in Chromium and 42 s in WebKit until every paragraph is set; each cursor
key or scroll cost 0.1–0.3 s at 0.5–1 MB, growing about 3x per doubling; Source and back, a one-block edit and undo
2–6 s at 1 MB; a width change 0.15–0.45 s at 1–3 MB with about 7,000 `getBoundingClientRect` calls at 1 MB. In
WebKit, one `appendChild` into the article cost 0.11 ms at 6,000 blocks and 0.35 ms at 18,000 because of the theme's
`:has()` rules. The large-files corpus decided (D-01) on tier 1 then tier 2 and (D-04) typesetting by distance, but
left the node budget (DOM-08) and screen readers (DOM-11) unmeasured.

**Tools.** `scripts/measure-scale.mjs` (Chromium CDP counts per step), `scripts/lib/big-files.mjs` (shapes
`md-prose`, `md-dense`, `md-technical` and more at any size), `scripts/measure-typeset-idle.mjs`. WebKit has no CDP:
measure it with in-page counters and `performance.now()` over many repetitions, and say so.

**Prior corpus.** `docs/research/large-files/` (chapters 01–10, `SYNTHESIS.md`). Cite its findings by ID (for example
DOM-03, EDS-04, TYP-01) instead of re-researching them; if your evidence overturns one, say so plainly in a finding.

## Web evidence

Every web page you quote is kept with
`node /Users/ian/Dev/research-corpora/tools/save-source.mjs /Users/ian/Dev/marxy-wt/windowing-research/docs/research/windowed-pages <url>`
(a page that needs a browser or a PDF: `--from-file`). Copy each quotation from that saved text, word for word, with
its citation in the same sentence. Before you finish,
`node /Users/ian/Dev/research-corpora/tools/check-corpora.mjs --web /Users/ian/Dev/marxy-wt/windowing-research/docs/research/windowed-pages`
must show no FAIL for your chapter (ignore other chapters' lines).

## Rules for every agent

1. Primary sources first: source code, design docs, specs, browser bug trackers, maintainers' own words. A number
   from source code or a measurement beats a number from a blog. Label secondary sources.
2. Cite every finding (URL and access date, or a repository path with line, or a probe script and its output file).
3. Tag every finding: `[measured]` (you ran it, or a cited benchmark with its setup), `[confirmed]` (read in a
   primary source), `[likely]`, `[unverified]`. A claim that something does not exist or was not found is
   `[absence]`, never `[confirmed]`, and lists at least two places under `**Searched:**`.
4. Version-date everything fast-moving (browser and engine versions, library versions).
5. **Privacy:** never put the owner's name, email, device names, repository names or the app's name in a web search
   or fetch. Search generic terms only.
6. **No tracker ids in the chapter.** This folder is under `docs/`, where row ids, pull request numbers and hunt
   finding ids are not written. Name the work ("the geometry table", "the progressive mount", "the batched grid
   pass"). Finding ids of corpora (DOM-03, your own PRE-01) are fine.
7. Budget: 25–40 tool calls. Write only your own chapter (and, through the save command, `sources/`; measurement
   vectors also their probe files under `probes/`).
8. Chapter template: `../large-files/` chapters show the shape (front matter, abstract, TL;DR, Recommendation,
   Findings `### PRE-NN · title  [tag]`, Options compared, Open questions, Cross-links, Sources).
9. Reply to the lead in at most 10 lines: recommendation, headline finding IDs, cross-leads.

## Vectors

| NN | Slug | Prefix | Kind | Sub-questions |
|---|---|---|---|---|
| 01 | code-map | CMP | code | Q-01, Q-11, Q-12, Q-13 |
| 02 | tier1-measure | TIR | measurement | Q-02 |
| 03 | node-budget | NOD | measurement | Q-03, Q-13 |
| 04 | height-maps | HMP | web | Q-04, Q-11, Q-14 |
| 05 | engine-support | ENG | web | Q-05 |
| 06 | estimates-anchoring | ANC | web + code | Q-06, Q-11, Q-14 |
| 07 | accessibility | ACC | web | Q-07 |
| 08 | find-select-copy | FSC | web + code | Q-08 |
| 09 | typeset-distance | TBD | code + web | Q-09 |
| 10 | editing | EDW | web + code | Q-10 |
