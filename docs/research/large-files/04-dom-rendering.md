---
corpus: large-files
id: 04
slug: dom-rendering
prefix: DOM
title: Putting a long variable-height document on screen
researched: 2026-11-27
confidence: medium
volatility: fast
status: active
keywords: [content-visibility, contain-intrinsic-size, virtualisation, windowing, scroll anchoring, overflow-anchor, hidden=until-found, find-in-page, DOM size, layout thrash, ResizeObserver, innerHTML, WKWebView, WebView2]
---

# 04 · Putting a long variable-height document on screen

> The question: how to show a 1 to 5 MB Markdown page (thousands of top-level blocks) so the DOM does not grow with the file, without losing find, selection, copy, anchors and accessibility. Answer in brief: `content-visibility: auto` is cheap, keeps everything the browser does for free, and works in both engines today, but it only skips layout and paint; every node still exists and still costs style work and memory, so it does not make the DOM independent of file size. Use it as the first tier (and as a safety net inside the mounted window), and drive a block-level window from the planned geometry table as the second tier once a file passes a measured node budget. The app must own find, select-all and copy for the unmounted part, and must do its own scroll anchoring, because the macOS WebView engine got `overflow-anchor` only in Safari 27.

## TL;DR
- `content-visibility: auto` plus `contain-intrinsic-size: auto <estimate>` per top-level block is the cheapest big win: web.dev measured rendering time going from 232 ms to 30 ms on a demo. It keeps find-in-page, the accessibility tree and anchors working. In WebKit it is only usable for find from Safari 26 (DOM-01, DOM-02).
- It is not virtualisation. A real-world 20k-element case still took about 1.3 s after the fix, and the author concluded 20k nodes "is just never going to be as fast as a virtualized list" (DOM-03). Plan for a windowed tier for the biggest files.
- WKWebView on macOS 26 (Safari 26 engine) has no scroll anchoring (`overflow-anchor` shipped in Safari 27, 2026-09-14) and only a partial `hidden="until-found"` (Safari 26.2 per MDN browser-compat-data, with the scroll to the match wrong; DOM-05). Chromium has both. So own the anchoring and own the find over unmounted blocks (DOM-04, DOM-05).
- Any geometry read (`getBoundingClientRect`, `offsetHeight`, `scrollIntoView`, `Range.getClientRects`) after a write forces synchronous layout; on a skipped subtree it also defeats `content-visibility`. Read sizes from `ResizeObserver` entries, in one batch per frame (DOM-07).
- Large HTML insertion: no published multi-MB benchmark was found (DOM-09). Chunk by block count and time, never spread children into `append(...)`, and measure in both engines.

## Recommendation for this setup

Tiering by measured cost, not by file size alone. Thresholds below are starting points to be replaced by a local benchmark in WKWebView and WebView2 (nothing found gives per-node cost for either engine, DOM-08).

**Tier 1, whole page mounted with skipping (small files, up to the node budget).**
1. Every top-level block (the geometry table's unit) gets `content-visibility: auto; contain-intrinsic-size: auto <h>px`, where `<h>` is the table's estimate (measured height when known, otherwise lines estimated from byte length and column width). `auto` makes the browser remember the real size once rendered, and Chromium and Firefox now imply it for `content-visibility: auto` [16]. Do not give blocks one fixed guess: an under-estimate moves the scrollbar and breaks long jumps (DOM-06).
2. Keep each block's text in its own box. Do not put `content-visibility` on tiny inline-level things or on blocks of a few lines: the per-element overhead can exceed the gain. Wrap runs of small blocks (list items, table rows) in the unit rather than skipping each one [inference].
3. Never call geometry APIs on a skipped block from the typesetter or from panels. Typeset only blocks that are on screen plus a margin (the planned bounded queue); everything else keeps its estimate. The platform even says so: "The browser is only able to skip rendering work if you are also careful not to call any DOM API that forces some of rendering to occur on one of the skipped subtrees." [1]
4. Use `contentvisibilityautostatechange` (or one `IntersectionObserver` with a `rootMargin` of about 100% of the viewport) as the trigger that queues a block for typesetting and cancels it when the block leaves. Safari 18 and later fire the event per caniuse via search; WebKit was said to differ across engines by Nolan Lawson in 2024, so keep the observer as the fallback [9].

**Tier 2, windowed mount (above the node budget).** The geometry table becomes the virtualiser.
1. Choose a budget in DOM nodes mounted, not bytes (suggest starting at about 10,000 to 20,000 nodes mounted, from Lighthouse's 800/1,400 as an order-of-magnitude floor and the 20k-element datapoint as a ceiling [9][10]; measure on Windows and macOS). Count nodes per block when rendering the HTML string (the renderer knows the tag count), so the budget is a sum over the table, not a DOM walk.
2. Mount blocks whose table range intersects the viewport plus about two screens each way (CV:auto's spec margin is 50% of the viewport [7]; use more because mount costs more than paint). Replace the unmounted prefix and suffix with one spacer element each, `height = sum of table heights`. One spacer per side keeps the DOM small; per-block placeholders would put the node count back.
3. Own the anchoring. Capture an anchor (the first block whose top is at or below the viewport top, plus the pixel offset within it) before any change; after mount, unmount, measure or width change, restore `scrollTop` so that block's offset is unchanged. Do it in a single frame callback after reading `ResizeObserver` entries. Set `overflow-anchor: none` on the scroller so the engine's own anchoring (Chromium, Firefox, Safari 27+) does not stack on yours. TanStack Virtual shows the trap: writing `scrollTop` on every above-viewport resize "pushes the user past where they're trying to go" on backward scroll, so adjust only when the anchor block really moved, and not during momentum or user scroll in the backward direction without testing [18].
4. When a block's height is measured, update the table once per frame (batched); never re-sum the table on each update (keep a Fenwick tree or chunked prefix sums so spacer heights and block-at-offset are O(log n)) [inference].
5. A width change invalidates every height. Re-measure only mounted blocks; scale the other estimates by the ratio of old to new column width and mark them `estimated`. Remembered sizes from `contain-intrinsic-size: auto` are also stale after a width change in the mounted tier: restate `contain-intrinsic-size` from the table after resize [inference; no source found, DOM-06].

**What the app must supply itself in Tier 2** (the browser cannot):
- Find: search the bytes/text in the core, show matches as byte ranges, mount the block containing the current match, then select it by range. Browser find in WKWebView is not a given either: Apple's API is `WKWebView.find(_:configuration:completionHandler:)`, macOS 11 and later, and the app must supply the UI [19]. Detail belongs to vector 08.
- Select all and copy: intercept `selectAll` and `copy`; map the selection endpoints to byte ranges through `data-marxy-s` / `data-marxy-e` and produce the text or Markdown from the bytes, so copy is correct across unmounted blocks. Keep the selection anchor and focus as byte offsets, not nodes. Whatever the selection touches stays mounted (the spec treats "selected" content as relevant and not skipped [7]).
- Anchors and jump-to-heading: jump by table offset, mount the target, then correct once it is measured (an under-estimate moves the target while a smooth scroll is in flight [15]; use instant scrolling to a table offset and re-anchor).
- Accessibility: expose the position in the set (`aria-setsize`, `aria-posinset`, or `role="feed"` with `aria-busy`) on mounted blocks, as one experienced author did in a long feed [9]; keep headings reachable through a separate outline panel built from the table, not from the DOM. Test with VoiceOver in WKWebView and Narrator or NVDA in WebView2 [unverified, no source on how either handles a windowed document].

**What I would not do.** Do not use `display: none` or `visibility: hidden` for off-screen blocks to "hide" them: they drop out of find and, for `display: none`, the accessibility tree. Do not rely on `hidden="until-found"` for off-screen blocks: it is only partial in Safari 26.2 and later (DOM-05) and it needs the content to be in the DOM anyway. Do not build one DOM spacer per block. Do not use the engine's scroll anchoring as the only mechanism (DOM-04). Do not insert the whole page with one `innerHTML` (DOM-09).

**Rules for new features**
- Anything that needs the height or position of a block reads it from the geometry table or a `ResizeObserver` entry, never from `getBoundingClientRect`, `offsetHeight`, `offsetTop`, `scrollIntoView` or `Range.getClientRects` on an element that is not on screen (lint: those calls outside the geometry module and the typesetter).
- Do all DOM writes for a frame, then all reads; no read after a write in the same task (a test counts forced layouts with `PerformanceObserver` or a counter around the wrapper).
- A function that walks the whole document DOM (`querySelectorAll("*")`, `document.body.children`, `TreeWalker` over the root) is allowed only on the mounted window; whole-file work goes through the byte index or the table.
- Insertion is in chunks of at most a fixed number of blocks or an 8 ms budget, and children are appended with a loop or a fragment, never `append(...array)` (it overflowed the stack at about 62,000 children).
- A new feature that needs "all matches", "all headings" or "all links" derives them from the parsed tree or bytes, not from the rendered DOM, and shows the unmounted ones from the table.
- Every block that is not mounted has an entry in the geometry table with `measured: false` and an estimate; a width or font change marks all entries estimated (unit test).
- Selection, copy and find over a file above the node budget are tested in a browser test that opens a fixture above the budget and copies text from a block that is not mounted.
- Any CSS rule that sets `content-visibility: auto` also sets `contain-intrinsic-size: auto <length>` (stylelint-style check).

## Findings

### DOM-01 · `content-visibility: auto` gains and what it keeps  `[confirmed]`
web.dev reports that "applying content-visibility: auto to chunked content areas gives a 7x rendering performance boost on initial load" in its demo [1], and in the demo "rendering times going from 232ms to 30ms on initial page load" [1]. The same article says off-screen content stays in the DOM and accessibility tree, so "content can be searched for on the page, and navigated to, without waiting for it to load or sacrificing rendering performance" [1]. Its one warning for finders of boundaries: landmark elements hidden with `display: none` still appear in the accessibility tree while skipped, so add `aria-hidden="true"` [1]. The spec's description of `auto` agrees: skipped contents "must still be available as normal to user-agent features such as find-in-page, tab order navigation, etc." [8]. Newest vendor-source date: 2020 article, revised (page shows current text). The gains are on layout and paint; see DOM-03 for the part that remains.

### DOM-02 · Engine support and the WebKit find bug  `[confirmed]`
MDN browser-compat-data gives Chrome 85, Firefox 125 and Safari 18 for the `content-visibility` property, and for its `auto` value Safari 18 to 26 as a partial implementation linked to webkit.org/b/283846 with full support from Safari 26 [22] (the lead read the record on 2026-11-27); the Chrome 108 and Firefox 130 (2024-09-03) dates and the Safari 26 (2025-09-15) "newly available" Baseline date are web-features dates for the feature as a whole [3]. The saved MDN page instead says Baseline 2024 (since September 2024), so the two sources disagree on the Baseline date, and the difference is the find fix below. Apple's Safari 18 release notes list added support for `content-visibility` (read by the verifier, not saved), so Safari 18.0 is the first stable release (verified against the notes; Nolan Lawson wrote in September 2024 that "Safari only has content-visibility in Technology Preview" [9], before it shipped). BCD marks `auto` in Safari 18 to 25 as partial (skipped content is not findable, webkit.org/b/283846) and complete from 26. The reason Baseline is dated to Safari 26: Apple's Safari 26 notes list a fix for content skipped by `content-visibility: auto`, in the words "to be findable" [2], so before Safari 26 (Nov 2024 bug filed against Safari 18.1) browser find missed skipped content. An app on macOS 26 or later has the fix; macOS 15 and earlier does not. `contain-intrinsic-size` is in Safari 17 and Chrome 83 [20]. The `contentvisibilityautostatechange` event "fires on any element with content-visibility: auto set on it when its rendering work starts or stops being skipped" [8]; its Safari status could not be confirmed (search snippets disagreed), so do not depend on it without a runtime test.

### DOM-03 · It still scales with node count  `[measured]`
Nolan Lawson's emoji picker had 20k buttons and 40k elements. First attempt with `content-visibility: auto` and exact sizes: "roughly 15% improvement in Chrome and 5% in Firefox" on initial load; after removing images, "the benchmark clocked a ~45% improvement in both Chrome and Firefox, and the original repro went from ~3 seconds to ~1.3 seconds" [9]. Layout costs "were nearly gone" but the nodes still had to be created and styled. His conclusion: "rendering 20k DOM nodes is just never going to be as fast as a virtualized list" [9]. Setup: Tachometer, Chrome and Firefox, 2024; not Safari. Applies to this app: 1 to 5 MB of Markdown has far more than 20k nodes, so skipping alone leaves a floor of seconds of creation and style work.

### DOM-04 · Scroll anchoring is missing from the macOS engine until Safari 27  `[confirmed]`
web-features lists `overflow-anchor` as Safari 27, "Released on 2026-09-14", and Chrome 56, Firefox 66 [5]. Apple's Technology Preview 238 notes: "Enabled scroll anchoring, which prevents visible jumps in scroll position when content is inserted or removed above the viewport." [6] An app built on WKWebView follows the OS's WebKit, so a machine on macOS 26 is on Safari 26's engine `[likely]` (the app's macOS and engine mapping is not in these sources). Consequence: any approach that depends on the browser keeping the reader's place when heights change above the viewport (which `content-visibility: auto` with an under-estimate relies on) jumps in WKWebView but not in WebView2.

### DOM-05 · `hidden="until-found"` is only partial in Safari 26.2 and later  `[confirmed]`
The saved web-features page says Safari "Not supported" [4]. That is stale against MDN browser-compat-data (8.1.11, and its current record [23], read by the lead on 2026-11-27), which gives Safari 26.2 with `partial_implementation` (WebKit bug 304174: scroll to the match is wrong) and Chrome 102 and `beforematch` also 26.2, and Apple's Safari 27 notes mention a fix for `hidden="until-found"` revealed by disclosure widgets. So it is probably usable in WKWebView on macOS 26.2 and later but not reliably; test it. Verification correction: the chapter said Safari had no support, which is wrong for 26.2+. Per web-features: Chrome 102, Firefox 148 (2026-02-24), "Baseline availability blocked since February 2026 by Safari" [4]. Chrome's page says the attribute makes hidden text findable and revealed by find-in-page, with a `beforematch` event for syncing state, and it advises feature detection through `'onbeforematch' in HTMLElement.prototype` [21]. For this app it is useful for collapsed sections (for example folded code blocks), not for the long page.

### DOM-06 · Scrollbar jumps come from wrong estimates; remembered sizes go stale on width change  `[likely]`
The Chromium intent to make `content-visibility: auto` imply `contain-intrinsic-size: auto` says "There are less size jumps and scrollbar jitters" [16]. A CSS WG issue (Jan 2024) shows scroll-into-view going wrong when a size that "is an under-estimate for the real size": the destination is computed from placeholders, and "the scroll does not scroll far enough" [15]. The proposed fix there is to subject the target to scroll anchoring [15]; not shipped as far as found. That a remembered size is stale after a container width change (text reflows) follows from how "last remembered size" works but no source found tests it, so treat as inference and test in both engines.

### DOM-07 · Forced layout: what to avoid and what to use  `[confirmed]`
Paul Irish's maintained list says the listed properties and methods "will trigger the browser to synchronously calculate the style and layout" when requested after changes [13]. It includes `offsetLeft/Top/Width/Height/Parent`, `getClientRects()`, `getBoundingClientRect()`, `scrollIntoView()`, `scrollIntoViewIfNeeded()`, `visualViewport` sizes, and `range.getClientRects()` / `range.getBoundingClientRect()` [13]. web.dev adds that big DOMs make layout after an update expensive: "Expensive layout work can affect a page's Interaction to Next Paint (INP)" [12], and recommends `content-visibility` and CSS containment to scope the work [12]. Chromium prints console messages (verbose level) when such APIs touch a `content-visibility: hidden` subtree [1]. `ResizeObserver` entries and `IntersectionObserver` callbacks deliver sizes and visibility as part of the rendering step without a forced layout [inference from the API design; the sources above do not state it for these two]. Applying `contain: layout paint style` (or `content-visibility: auto`, which gains layout, style and paint containment per web.dev [1]) to each block limits a relayout to the block that changed.

### DOM-08 · DOM size thresholds; no WebKit vs Chromium per-node numbers  `[confirmed]`
Lighthouse: "Warns when the body element has more than ~800 nodes." and "Errors when the body element has more than ~1,400 nodes." [10]. Chrome's newer insight fails only on cost: "a large layout or style recalculation exceeding a duration of 40ms", where a large layout is "over 100 layout objects" and a large style recalculation "affects more than 300 elements" [11]. "A large DOM can increase the duration of style calculations and layouts, impacting page responsiveness. A large DOM also increases memory usage." [11] These are page-scale thresholds from a Chromium tool; a document reader with 100k nodes is far outside them, so they say "keep the mounted set in the low thousands", not what the right number is. **Absence**: no source found that gives bytes per DOM node, or style/layout milliseconds per 10k nodes, for WebKit or Chromium `[absence]`.
**Searched:** web search "DOM node memory size bytes per element Chrome WebKit blink" (only a JS-heap gist with 36 to 41 bytes per object, which excludes native memory); web.dev and Chrome developers' DOM-size pages (no per-node figure).

### DOM-09 · Inserting big HTML  `[absence]`
No benchmark of multi-MB `innerHTML`, `setHTMLUnsafe`, `DocumentFragment` or `<template>` was found. What exists: web.dev states that parsing server-streamed HTML "yields to the main thread periodically after processing each chunk", while client-side script gets none of that: "JavaScript tasks on the client are not automatically chunked up, which may result in long tasks that block the main thread" [17]. Chrome's LLM-streaming guide (via search, not saved) says re-assigning `innerHTML` re-parses everything each time. Micro-benchmark sites show template and fragment within a few percent of each other on small inputs, and one 2015 mailing-list reply warns such tests mislead. Streaming parse APIs (`streamHTMLUnsafe`) were reported shipping in Chromium 150 only and are not usable on WKWebView `[unverified]`. Practical reading: the string-to-DOM cost is dominated by node count, which a window bounds; chunk it.
**Searched:** web search on innerHTML vs DocumentFragment vs template vs setHTMLUnsafe benchmarks for large strings (microbenchmarks only); web.dev "client-side rendering of HTML" (principle, no numbers).

### DOM-10 · What virtualisation breaks, and the fixes in the wild  `[confirmed]`
Native find, select-all, copy and screen readers all work on what is in the DOM. CircleCI built its build output with react-virtualized "meaning that only the visible rows were rendered", and "in practice it broke the ability to use native browser search tools like CMD+F" [14]; they removed it. Nolan Lawson's earlier feed app "is basically one big virtual list. I used the ARIA feed role, did all the calculations myself, and added an option to disable 'infinite scroll'", and he avoided virtualisation in a library for its "implications for accessibility" [9]. The platform has no virtual-list primitive: "There were some efforts at this a few years ago, but they seem to have stalled." [9] Where find must work, the usual workaround is an in-app find that searches the model and reveals matches; canvas-rendered and fully virtual apps do the same (details and numbers: vectors 01 and 08). TanStack Virtual (2026 release notes) documents the anchoring trap: "we were writing scrollTop on every above-viewport resize to keep the visible window stable", which on backward scroll "actively pushes the user past where they're trying to go", and now gates the adjustment on scroll direction [18]. Estimate-then-measure is the standard model; keep an overestimate where the true size is unknown and an index attribute on every measured node [18].

### DOM-11 · Selection and copy with skipped content  `[unverified]`
The spec says content that is selected is "relevant to the user" and so not skipped [7], and that `content-visibility: hidden` contents "must not be accessible to user-agent features, such as find-in-page ... nor be selectable or focusable" [8]. How Cmd+A and copy behave across `auto`-skipped blocks in WKWebView versus WebView2 was not found in any source; the two engines may differ. Test: select-all, copy, compare to the bytes, in both, on a fixture above the node budget.

## Options compared

| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Whole DOM, no skipping (today) | Fails at 1 to 5 MB | Linear in nodes, layout of everything | Seconds to tens of seconds | Replace |
| `content-visibility: auto` per top-level block, `contain-intrinsic-size: auto` from the table | Keeps find, a11y, anchors, selection; works in WebKit 26 and Chromium | Style and node creation still linear (DOM-03) | Scrollbar and anchor jumps on estimates; WebKit before 26 cannot find (DOM-02) | Tier 1, ship first |
| Block-level window from the geometry table, spacers, own find/copy/anchor | Bounds the DOM; the table already exists | Own anchoring, find, copy, a11y code | Selection and screen reader behaviour untested | Tier 2 above the node budget |
| Per-block placeholders (one div per unmounted block) | Keeps node count linear | Low | Defeats the point | No |
| Third-party virtual list (TanStack Virtual) | Variable height, measured | Dependency; allow-list and licence checks | Built for lists of items, not for continuous text with selection | Read its anchoring logic, do not adopt |
| `hidden="until-found"` for off-screen blocks | Partial in Safari 26.2+ (wrong scroll to match), full in Chromium | Needs content in DOM | Safari behaviour needs a test | Only for folded sections, after testing in WKWebView |
| Canvas rendering | Loses find, selection, a11y | Very high | | No |

## Open questions
- Per-node cost and style/layout time per 10k nodes in WKWebView vs WebView2 on a 5 MB fixture: settle with a benchmark page in both engines (nothing found, DOM-08). This sets the node budget.
- Select-all, copy, VoiceOver and Narrator behaviour with `content-visibility: auto` and with a windowed DOM (DOM-11).
- Whether `contain-intrinsic-size: auto` goes stale after a width change in either engine (DOM-06).
- Which WebKit version the user's WKWebView runs on each macOS, to decide whether Safari 26's find fix and Safari 27's scroll anchoring can be assumed.
- `contentvisibilityautostatechange` in WebKit: caniuse snippets disagreed; verify at runtime.

## Cross-links
- 05 (typesetting): bounded typesetting queue; typeset only blocks on screen plus margin; no geometry reads on skipped blocks (DOM-07); width change cost (DOM-06).
- 06 (main-thread): chunked insertion yields, `scheduler.yield` support in WebKit (DOM-09).
- 08 (search-highlight): in-app find over unmounted blocks, WKWebView `find` API (DOM-10, section on find).
- 01 (code-editors) and 02 (markdown-apps): how CodeMirror 6 estimates heights and anchors, how others solve find with a virtualised document (DOM-10).
- 09 (buffers-memory): byte-range selection mapping for copy.
- 10 (guardrails): the lints and counters in "Rules for new features" (forced-layout counter, DOM-walk lint, `content-visibility` and `contain-intrinsic-size` pairing).

## Sources
All accessed 2026-11-27. Saved under `sources/`.
1. web.dev, "content-visibility: the new CSS property that boosts your rendering performance" — https://web.dev/articles/content-visibility?hl=en — 7x demo, 232 ms to 30 ms, accessibility note, forced-layout caution.
2. Apple, Safari 26 release notes — https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md — find fix for skipped content.
3. web-platform-dx web-features explorer, content-visibility — https://web-platform-dx.github.io/web-features-explorer/features/content-visibility — support dates.
4. web-features explorer, hidden="until-found" — https://web-platform-dx.github.io/web-features-explorer/features/hidden-until-found — Safari not supported.
5. web-features explorer, overflow-anchor — https://web-platform-dx.github.io/web-features-explorer/features/overflow-anchor — Safari 27 on 2026-09-14.
6. Apple, Safari Technology Preview 238 notes — https://developer.apple.com/documentation/safari-technology-preview-release-notes/stp-release-238.md — scroll anchoring enabled.
7. W3C, CSS Containment Module Level 2 — https://www.w3.org/TR/css-contain-2/ — relevance rules, 50% margin, selected content relevant.
8. MDN, content-visibility — https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility — values, find-in-page, `contentvisibilityautostatechange`.
9. Nolan Lawson, "Improving rendering performance with CSS content-visibility" (2024-09-18) — https://nolanlawson.com/2024/09/18/improving-rendering-performance-with-css-content-visibility/ — 20k-element measurements; secondary, practitioner.
10. Chrome for Developers, Lighthouse "Avoid an excessive DOM size" — https://developer.chrome.com/docs/lighthouse/performance/dom-size?hl=en — 800 and 1,400 thresholds.
11. Chrome for Developers, DOM size insight — https://developer.chrome.com/docs/performance/insights/dom-size?hl=en — 40 ms, 100 layout objects, 300 elements.
12. web.dev, "How large DOM sizes affect interactivity" — https://web.dev/articles/dom-size-and-interactivity?hl=en — layout cost and INP, containment advice.
13. Paul Irish, "What forces layout/reflow" — https://gist.github.com/paulirish/5d52fb081b3570c81e3a — list of forcing APIs.
14. CircleCI changelog, "Find (CMD+F) Now Working in the New UI" — https://circleci.com/changelog/find-cmd-f-now-working-in-the-new-ui/ — virtualisation broke find.
15. CSS WG issue 9833 (mail archive) — https://lists.w3.org/Archives/Public/public-css-archive/2024Jan/0592.html — scroll into view with under-estimated sizes.
16. Chromium blink-dev, intent: content-visibility auto implies contain-intrinsic-size auto — https://groups.google.com/a/chromium.org/g/blink-dev/c/aYpmS8hP2UQ — fewer size jumps.
17. web.dev, "Client-side rendering of HTML and interactivity" — https://web.dev/articles/client-side-rendering-of-html-and-interactivity?hl=en — client-side HTML is not chunked.
18. TanStack, "TanStack Virtual just got a lot faster, and finally handles iOS" — https://tanstack.com/blog/tanstack-virtual-perf-and-ios — scrollTop adjustment trap. Also https://tanstack.com/virtual/latest/docs/api/virtualizer.md (measurement attribute, `estimateSize`).
19. Apple, `WKWebView.find(_:configuration:completionHandler:)` — https://developer.apple.com/documentation/webkit/wkwebview/find(_:configuration:completionhandler:).md — macOS 11+, API only.
20. web-features explorer, contain-intrinsic-size — https://web-platform-dx.github.io/web-features-explorer/features/contain-intrinsic-size — Safari 17, Chrome 83.
21. Chrome for Developers, hidden=until-found — https://developer.chrome.com/docs/css-ui/hidden-until-found?hl=en — find and `beforematch`, feature detection.
22. MDN browser-compat-data, content-visibility — https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/content-visibility.json (accessed 2026-11-27) — Chrome 85, Firefox 125, Safari 18; `auto` partial in Safari 18 to 26 (webkit.org/b/283846), full from 26.
23. MDN browser-compat-data, global attributes — https://raw.githubusercontent.com/mdn/browser-compat-data/main/html/global_attributes.json (accessed 2026-11-27) — `hidden` `until-found`: Safari 26.2 partial (webkit.org/b/304174), Chrome 102.
