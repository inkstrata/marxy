---
corpus: large-files
id: 02
slug: markdown-apps
prefix: MDA
title: How Markdown apps and e-book readers cope with long documents
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [obsidian, typora, vs code markdown preview, morphdom, github 512 KB, gitlab 1 MB truncate, foliate-js, epub.js, readium, calibre, whole-page render, progressive render, section windowing]
---

# 02 · How Markdown apps and e-book readers cope with long documents

> Question: how do Markdown editors, previewers and e-book readers handle long documents, what limits do they set and what do users complain about. Answer in brief: nobody renders a multi-MB Markdown file as one fully typeset page. They do one of four things: refuse or truncate (GitHub, GitLab, Typora), render only what is near the viewport and unmount the rest (Obsidian reading view), render the visible slice first and the rest later (a VS Code preview fork), or load one chapter at a time (every e-book reader). The user-visible costs are consistent: the size in bytes is a poor predictor, while the count of structural nodes (list items, table rows, headings, raw HTML) predicts the failure.

## TL;DR
- No app found renders a 1–5 MB Markdown file as one whole typeset page. The comparable behaviours are a hard cap (Typora about 2 MB, GitHub README about 512 KB, GitLab 1 MB truncation), viewport-bounded DOM (Obsidian), or one section at a time (e-book readers). MDA-01, MDA-04, MDA-05, MDA-06, MDA-08.
- Obsidian's pain comes from node count, not bytes: a 3.6 MB log with about 16,000 list items, rows and headings was the crash culprit, while 17 MB of email threads with about 3,400 such items was harmless. Count structure, not bytes. MDA-02.
- The VS Code preview patches the DOM with morphdom, but its scroll-sync map is rebuilt over every line element per document version; a fork that renders only viewport tokens first cut time-to-first-paint from about 4.6 s to under 1 s (the fork author's own benchmark, not independent). MDA-03.
- Even the "unmounting" design has holes: Obsidian keeps a very long unbroken list in the DOM in one piece, and users hit exactly that. Windowing must be by block with a bounded block size. MDA-06.
- E-book readers solve length by splitting at chapter boundaries and pay with no whole-book find, slow CSS-column pagination, and no help when one resource is huge. A 5 MB Markdown file has no such split to exploit. MDA-08, MDA-09.

## Recommendation for this setup

For a reader that today renders a 1–5 MB Markdown file as one typeset page, the best-fitting approach is **block-windowed rendering over the existing byte-range provenance**: keep the sliced parse and the per-top-level-block geometry table, mount only blocks near the viewport (a window of a few screens), replace the rest with spacer elements of estimated or measured height, and typeset only mounted blocks. This is the Obsidian reading-view model, plus the VS Code fork's "split at top-level token boundaries" idea, plus the e-book readers' lesson that the anchor must be a position in the content (byte offset), not a pixel scroll position. It matches the work already in flight (geometry table, bounded typesetting queue).

Order of work:
1. **Cap the unit of mounting at the top-level block, and cap block size.** One huge block (a 100 KB paragraph, a 10,000-item list, a 5,000-row table, a giant code fence) defeats windowing, as Obsidian's long-list complaint shows. For blocks above a size limit (suggest 20–50 KB of source or about 500 child nodes; tune by measurement) fall back to a chunked sub-window or the "lines" reading for that block.
2. **Mount by viewport, not by idle queue.** Replace "typeset everything in idle slices" with "typeset blocks within N screens of the viewport; the rest are estimated-height spacers". Open cost becomes O(viewport), not O(file).
3. **Edit patching stays per block** (VS Code's `areNodesEqual` short-circuit inside morphdom is the proven shape), but patch only mounted blocks; unmounted ones just have their source range and estimated height updated.
4. **Search and find become model-level features**: DOM find cannot see unmounted blocks. Search bytes or text with an index and scroll the match's block into the window. Accept the Obsidian trade: layouts that depend on off-screen elements break.
5. **A threshold ladder, not a cliff.** Below about 1 MB or about 5,000 top-level blocks (suggested): current whole-page behaviour is acceptable. Above that: windowed. Above 5 MB: the existing "lines" reading. Gate by structure counts (blocks, list items, table rows, raw HTML nodes) as well as bytes, since Obsidian's evidence shows bytes mislead.
6. **Say what is deferred**: a visible "large document" notice, like Markdown Monster's "Navigation Only" mode, so degraded behaviour is not a surprise.

What I would not do: refuse or truncate (GitHub, GitLab, Typora style), since a local reader must show the whole file; split into chapters as an e-book reader does, since Markdown has no natural resource boundary and whole-file find, anchors and byte-range provenance would break; adopt CSS-column pagination (foliate-js, epub.js), which foliate-js's own README calls slow.

**Rules for new features**
- A feature that renders or measures per block must iterate only blocks in the mounted window (or use `take(n)` or a budget), never the whole block list; a reviewer can grep for loops over the full block array.
- A feature must not assume all blocks are in the DOM; a page-wide `querySelectorAll` for block-level work is rejected unless bounded to the window.
- Any new block renderer declares a maximum child count or source size above which it degrades (chunks or placeholder); a test feeds it 10,000 items and asserts a bounded number of mounted nodes.
- "Large document" gates use structure counts (blocks, list items, rows) as well as bytes; a test must include a small-bytes, many-nodes file.
- Scroll position and anchors are stored as a byte offset plus an intra-block offset, not pixels or element references.
- Find, outline and link panels read the model (parse tree or text index), not the DOM, and never reparse the whole file on the main thread.

## Findings

### MDA-01 · Typora caps files at about 2 MB and a blog warns of super-linear rendering  `[likely]`
A third-party post says "Typora imposes a default file size limit of approximately 2 MB when opening Markdown files" and shows the constant as `2e6`, about 2,000,000 bytes [7]. It also says the "rendering algorithm may exhibit non-linear performance characteristics (potentially closer to O(n²) in complexity)" [7]. This is a July 2025 blog, not Typora's docs, and the O(n²) is the author's inference; I found no official Typora statement. The 2 MB threshold sits in the same band as this app's problem files.

### MDA-02 · Obsidian: failure tracks structural node count, not bytes  `[confirmed]`
A forum user diagnosing crashes on a vault of about 11,000 notes reports "Size in bytes was not the signal": 17 MB of email threads carried only "about 3,400 list items, headings, links and table rows" and caused no trouble, while "One 3.6 MB log carried about 16,000 and was the main culprit" [1]. The user says they do not know whether the numbers carry over to other machines, and the failure was in vault indexing, not only in rendering [1]. Other reports: a 5.7 MB generated Markdown file with many raw HTML tables freezes the app, while the same files renamed to `.txt` open normally [5]; the large-file request says "there is no enforced hard cap on the maximum size of a single markdown file" and "Beyond a certain point, large files can cause OOM problems" [1]; one crash report names files above 5 MB (largest 37.82 MB) as the trigger [4]; a 2021 report on a 40k-line file in preview says "over 20 sec to respond to close the linked preview" [6]. Implication: gate degradation on node counts, and give side-panel and index parses their own budget separate from the render.

### MDA-03 · VS Code Markdown preview: debounced, patched with morphdom, scroll map over all line elements  `[confirmed]`
In the built-in extension the first refresh is immediate and later ones wait `#delay = 300` ms [10]. In the preview webview the new HTML is reconciled with `morphdom(root, newRoot, {` and an `onBeforeElUpdated` hook that skips elements when `areNodesEqual(fromEl, toEl)` [9]. So the DOM write is incremental, but the preview still builds a whole new body tree per update (inferred from the code; I did not trace the host render path). Scroll sync uses a map built from every element with class `code-line`, rebuilt whenever the document version changes: `document.getElementsByClassName(codeLineClass)` [11]. That is O(elements) per edit on a large page. I found no explicit size limit in these files. A fork says its "Token-boundary slicing: the document is parsed once, then split at top-level markdown-it token boundaries: only the viewport's tokens are rendered synchronously", and that "TTFP on a large plan file drops from roughly 4.6s to under 1s in the bench harness" [12]. That is the fork author's own benchmark on code-heavy documents, not independent. Splitting at tokens "(not source lines)" so a slice never bisects a fence, list, table or blockquote is the unit this app already has.

### MDA-04 · GitHub: README truncated near 512 KB; rich diffs only to 512 KB  `[likely]`
A user of the repo home page found "The readme on the main page only renders the first 512 KB of the README.md file", and a GitHub support reply quoted in the thread says "We currently limit blob displaying to around 500 KB of data, anything more we truncate in the UI. You can view the raw by clicking through" [13]. Correction: the 512 KB figure in the Enterprise Server docs concerns rich diffs, not READMEs; the README cap rests on the support quote above and stays `[likely]`. The Enterprise Server 3.21 docs, on rich diffs, say "Our rendering only works for files up to 512KB. Anything bigger than that slows down the browser" [14]. A 400 KB cap on GitHub's Markdown API appeared in a search summary only; I did not open that page: `[unverified]`. GitHub.com does not publish the README cap in its docs (a support-ticket quote is the best source). The behaviour is truncation with a raw fallback, not degradation.

### MDA-05 · GitLab truncates non-blob Markdown at 1 MB; a 2.5 MB wiki page took 30–50 s  `[confirmed]`
The commit "Truncate all non-blob markdown to 1MB by default" (May 2021) added a truncate-source filter [15]. A request to raise it says Markdown in places such as Wikis "get truncated" and proposes "Doubling this from 1MB to 2MB" [16]. A bug report: a wiki page of about 2.5 MB and 11,000 lines takes "30-50 seconds" to show and sometimes returns 500 or 502 errors [17]. This is server-side rendering, unlike a webview, but the thresholds sit in the 1–5 MB band and the product answer was to truncate. GitLab's limits page also caps math: "Maximum number of nodes rendered: 1000" [18], so node-count caps are normal there.

### MDA-06 · Obsidian reading view unmounts off-screen blocks but cannot split long lists  `[confirmed]`
In a forum thread a reply says that blocks leaving the DOM in reading view "is the correct behavior, and cannot be disabled" and "is done for performance reasons" [3]; the report saw paragraphs added and removed under `.markdown-preview-section` while scrolling a note of about 16 paragraphs [3]. A feature request states "Usually Obsidian renders only the parts of a note that are visible on screen. However, lists are rendered (and kept on the DOM) in their entirety in a single shot. Very long (unbroken) lists can therefore decrease the performance of Obsidian", and that progressive rendering of lists "is currently impossible and may prove very hard also in the future" [2]. Costs: floating or fixed elements vanish when their block unmounts [3]. In Live Preview (CodeMirror 6) a user reports that Obsidian "renders only a chunk of the note instantly, then the rest a second later", causing a flash of unstyled text [21]. I did not find the developer's own written explanation of the reading-view design; these statements come from forum staff and users.

### MDA-07 · Markdown Monster: refresh delay grows with size; "Navigation Only" mode  `[confirmed]`
Its docs say slowdown "is due to the time it takes to render the large HTML document in the preview browser", that documents "up to a megabyte or so" are "pretty fast and practically unnoticed", and that at 2000 lines the preview waits until you "pause typing for 2 full seconds" [8]. Remedies: slower refresh, no refresh, or a mode that updates only on navigation. On DOM diffing it says "other alternatives like DOM diffing have other problems (slow and buggy)" [8]. A Windows desktop app with an embedded browser control, but the lesson carries: tie preview cost to size and let the reader opt out.

### MDA-08 · E-book readers load one section; foliate-js and epub.js paginate with slow CSS columns  `[confirmed]`
foliate-js asks each book for `.sections` with a `.load()`, an optional `.unload()` ("can be used to free the section"), and `.createDocument()` ("Used for searching") [25]. For MOBI it splits the markup into sections "instead of outputting one long page for the whole book, which drastically improves rendering performance" [25]. Its paginator "uses the same pagination strategy as Epub.js: it uses CSS multi-column. As such it shares much of the same limitations (it's slow", and has "no support for continuous scrolling"; it "uses bisecting to find the current visible range" [25]. Its search is "extrenely slow, and you'd probably want to load results incrementally" [25]. Epub.js: the default manager shows one section at a time; the continuous manager shows enough sections to fill the screen and preloads the next, but "is less performant than the default method" [19]. Gives up: whole-book find (foliate searches per section), one scroll axis across the book, and any file whose single section is huge.

### MDA-09 · Readium: one resource per iframe or webview; huge resources still hurt  `[confirmed]` design note, `[unverified]` size figures
Readium's design note says the web navigator uses a single iframe whose content the outer frame replaces "when crossing resource boundaries", and that on mobile it "limits the web view to handling a single resource at a time" [22]. A claim that a Kotlin-toolkit issue reports resources of 30,000+ lines taking about 20 s to open, running out of memory, with laggy selection `[unverified]`: the verifier read issue 313 [23] and it is about a vertical-scroll request, closed as a duplicate, with none of those figures; the claim came from a wrong search summary and is not supported. The design-note half above is `[confirmed]`. That splitting at resource boundaries does not help when one resource is huge is the author's inference (this app's case).

### MDA-10 · A very large single HTML page: the cost was scripts, not parsing  `[confirmed]`
On the WHATWG single-page spec freezing browsers for about a minute, the editor answered that scripts can be disabled with `?slow-browser` and that "the slowness turns out to not be parsing, but to be a bunch of scripts that are doing various things such as adding the sidebar annotations, setting up the" cross-references, "and generating the short table of contents" [20]. A multipage edition is the alternative. This is a 2009 source and the newest I found on the topic. Lesson: per-element post-passes over a giant DOM were the cost; this app's idle passes (typesetting, Shiki, KaTeX, Mermaid, panels) over the whole page are the same shape.

### MDA-11 · Marked: JS pagination for print is minutes for 330 KB  `[confirmed]`
A Marked support answer says a 244-page, 330 KB Markdown document's print preview "usually takes ~15m", because Marked has "to use a hidden web view and extensive JavaScript to paginate the document" [24]. For a typesetter that lays out a whole document in the DOM, pagination cost grows fast; bound it to what is near the reader.

### MDA-12 · MarkText, Zettlr, iA Writer: no explicit limits found  `[absence]`
I looked for documented size limits or maintainer statements on multi-MB files. MarkText: only an old issue summary of a user finding it laggy on a large document, with split-by-heading advice (not opened). Zettlr: only forum posts blaming the Markdown highlighter on long files and long lists (not opened). iA Writer: its troubleshooting page has nothing on size. Marked's performance help page saved as site navigation only. No limit constants found.
**Searched:** WebSearch "MarkText large file freezes MB markdown issue performance"; WebSearch "Zettlr large file slow Markdown document MB CodeMirror performance issue"; WebSearch "iA Writer OR Marked 2 large document slow preview MB markdown"; markedapp.com help page (navigation only).

### MDA-13 · Calibre viewer: no authoritative limit found  `[absence]`
Search surfaced forum posts: a developer calling MOBI "one large HTML file" and advising conversion to EPUB, and a Linux bug where a book's flow loading took minutes (marked fixed). No page captured; no stated size threshold or design note from the Calibre manual.
**Searched:** WebSearch "Calibre ebook viewer large HTML file chapter slow paged mode column layout very long chapter split" (mobileread and Launchpad results, not opened); Readium's own design note instead (MDA-09).

## Options compared

| App | Approach | Threshold or limit | What is lost |
|---|---|---|---|
| Typora | Refuse above cap | about 2 MB (`2e6`) [7] | Cannot open; user edits source constant |
| GitHub | Truncate in UI, raw fallback | about 512 KB README and rich diff [13][14] | Tail not rendered |
| GitLab | Truncate source before render | 1 MB non-blob Markdown [15]; math 1000 nodes [18] | Tail not rendered |
| Obsidian reading view | Unmount off-screen blocks | none hard; long list is one block [2][3] | Floating elements, DOM find, layouts needing off-screen blocks |
| Obsidian Live Preview | CM6 viewport; chunked first paint | none hard; node count matters [1] | Flash of unstyled text |
| VS Code preview | 300 ms debounce; morphdom patch [9][10] | none found | Per-edit whole-body build; scroll map over all line elements |
| VS Code preview fork | Viewport tokens first, rest lazy [12] | n/a | More machinery; off-screen highlight deferred |
| Markdown Monster | Slow debounce; navigation-only mode [8] | 2000 lines raises delay | Live preview |
| foliate-js, epub.js | One section loaded; CSS columns [25][19] | per section | Whole-book find, continuous scroll, speed |
| Readium | One resource in an iframe or webview [22] | per resource | Infinite scroll; huge resource still slow (author's inference; the cited issue does not support it) |

**Which fits this reader** (a whole 1–5 MB Markdown file as one typeset page today): block-windowed rendering over the geometry table, sliced at top-level block boundaries. Rejected: truncation (breaks reading), chapter splitting (no natural boundary; breaks find and provenance), CSS-column pagination (slow by its own docs).

## Open questions
- Obsidian reading-view design in the developer's own words: not found; check Obsidian's developer docs or changelog.
- Whether VS Code's host renders the whole document on each update: read `markdownEngine.ts` and the preview host path; I inferred it.
- Typora's current behaviour (the 2 MB source is a July 2025 blog).
- GitHub's 400 KB Markdown API cap (search summary only).
- WebKit-specific cost of `content-visibility` as a cheaper alternative to unmounting: vector 04.

## Cross-links
- Vector 04 (dom-rendering): MDA-06 and the recommendation are the windowing design that must keep find, selection and anchors working.
- Vector 05 (typesetting): MDA-08, MDA-11, and the rule to typeset only mounted blocks.
- Vector 03 (parsing): MDA-03 (token-boundary slicing), MDA-02 (the indexing parse is a separate cost).
- Vector 10 (guardrails): MDA-02 (node-count gates), MDA-10 (whole-DOM post-passes).
- Vector 08 (search-highlight): MDA-08 (per-section search), DOM find fails on unmounted content.

## Sources
1. Obsidian Forum, "Improve support for very large notes - markdown files (greater than 1 MB)" — https://forum.obsidian.md/t/improve-support-for-very-large-notes-markdown-files-greater-than-1-mb/114238 (accessed 2026-11-27) — node-count diagnosis, no hard cap, OOM.
2. Obsidian Forum, "Reading mode (and Canvas): Implement some form of progressive rendering for long lists and callouts" — https://forum.obsidian.md/t/reading-mode-and-canvas-implement-some-form-of-progressive-rendering-for-long-lists-and-callouts/90646 (accessed 2026-11-27)
3. Obsidian Forum, "Obsidian reading view keeps modifying the DOM in long notes" — https://forum.obsidian.md/t/obsidian-reading-view-keeps-modifying-the-dom-in-long-notes/53709 (accessed 2026-11-27)
4. Obsidian Forum, "Renderer exits and window turns black while indexing large Markdown files" — https://forum.obsidian.md/t/renderer-exits-and-window-turns-black-while-indexing-large-markdown-files/115709 (accessed 2026-11-27)
5. Obsidian Forum, "Obsidian freezes while indexing Markdown generated from a PDF with many raw HTML tables" — https://forum.obsidian.md/t/obsidian-freezes-while-indexing-markdown-generated-from-a-pdf-with-many-raw-html-tables/117316 (accessed 2026-11-27)
6. Obsidian Forum, "UI performance issues with large files" (2021) — https://forum.obsidian.md/t/ui-performance-issues-with-large-files/13782 (accessed 2026-11-27)
7. DEV Community, "Fixing 'The file is too large to render in Typora'..." (2025-07-14, secondary) — https://dev.to/l1u7/fixing-the-file-is-too-large-to-render-in-typora-by-increasing-the-file-size-limit-hnc (accessed 2026-11-27)
8. Markdown Monster docs, "Editing Huge Documents" — https://markdownmonster.west-wind.com/docs/FAQ/Editing-Huge-Documents.html (accessed 2026-11-27)
9. VS Code source, markdown-language-features `preview-src/index.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/preview-src/index.ts (accessed 2026-11-27)
10. VS Code source, markdown-language-features `src/preview/preview.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/src/preview/preview.ts (accessed 2026-11-27)
11. VS Code source, markdown-language-features `preview-src/scroll-sync.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/preview-src/scroll-sync.ts (accessed 2026-11-27)
12. mash/markdown-fast README (fork of the built-in preview; author's benchmarks) — https://github.com/mash/markdown-fast (accessed 2026-11-27)
13. GitHub Community discussion 23920, "Does README.md have max characters?" — https://github.com/orgs/community/discussions/23920 (accessed 2026-11-27)
14. GitHub Docs (Enterprise Server 3.21), working with non-code files — https://docs.github.com/en/enterprise-server@3.21/repositories/working-with-files/using-files/working-with-non-code-files (accessed 2026-11-27)
15. GitLab commit de3ea3cb, "Truncate all non-blob markdown to 1MB by default" — https://gitlab.com/gitlab-org/gitlab/-/commit/de3ea3cb762bb8d08d4419e048a171b4719aaf5e (accessed 2026-11-27)
16. GitLab issue 411775, "Allow configurable markdown rendering limits" — https://gitlab.com/gitlab-org/gitlab/-/issues/411775 (accessed 2026-11-27)
17. GitLab issue 276401, "Long load times rendering large (~2.5MB) Markdown files in Wiki" — https://gitlab.com/gitlab-org/gitlab/-/issues/276401 (accessed 2026-11-27)
18. GitLab docs, "GitLab application limits" — https://docs.gitlab.com/administration/instance_limits (accessed 2026-11-27)
19. Epub.js v0.3 README — https://unpkg.com/epubjs@0.3.88/README.md (accessed 2026-11-27)
20. Ian Hickson, whatwg list message, 2009-12-02 — https://lists.w3.org/Archives/Public/public-whatwg-archive/2009Dec/0018.html (accessed 2026-11-27)
21. Obsidian Forum, "Live Preview: When Opening Note, Render Viewport In One Chunk" — https://forum.obsidian.md/t/live-preview-when-opening-note-render-viewport-in-one-chunk/108018 (accessed 2026-11-27)
22. Readium, "R2 Navigator Design Dilemmas" — https://readium.org/technical/r2-navigator-design-dilemmas/ (accessed 2026-11-27)
23. Readium kotlin-toolkit issue 313 — https://github.com/readium/kotlin-toolkit/issues/313 (accessed 2026-11-27) — saved page is site navigation only; the saved page is navigation only and the issue does not contain the claimed figures (verifier).
24. Marked support, "Print Preview Rendering Speed is Very, Very Slow" — https://support.markedapp.com/questions/D11k (accessed 2026-11-27)
25. foliate-js README — https://github.com/johnfactotum/foliate-js (accessed 2026-11-27)
