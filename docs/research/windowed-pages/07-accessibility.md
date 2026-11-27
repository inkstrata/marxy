---
corpus: windowed-pages
id: 07
slug: accessibility
prefix: ACC
title: Screen readers and a windowed page
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
---

# 07 · Screen readers and a windowed page (Q-07)

## Abstract

What VoiceOver (WKWebView), Narrator and NVDA (WebView2) do with a page where only blocks near the viewport are in the DOM, and with `content-visibility: auto` skipped content; how editors and long-list patterns cope; what the reader pays. No screen reader was run for this chapter: everything about real VoiceOver, Narrator or NVDA behaviour is from documents and bug reports, and the tests that would settle it are written out as falsifiers.

## TL;DR

- Tier 1 (`content-visibility: auto`) keeps the content in the accessibility tree in Chromium (MDN says so) and, by one 2024 bug report, in Safari's VoiceOver. It is the accessible tier. Tier 2 (unmounted blocks) removes the content from every screen reader at once: no one has found a trick that lets a page tell a screen reader about text that is not in the DOM.
- A page cannot read the VoiceOver cursor. The only signals are DOM focus (the cursor and focus are synchronised by default, but the user can turn it off), `selectionchange` and scroll. The ARIA feed pattern is the published contract: the page loads and removes articles by which one holds DOM focus.
- Every windowed editor surveyed truncates what the screen reader sees (CodeMirror, Monaco's 500 lines, Obsidian) or builds a second structure (Google Docs). None reads a whole large document in the ordinary way.
- Recommendation: tier 2 must ship with an accessibility mode that mounts the whole page, switched on by an explicit setting (and offered when a screen reader is likely), because the node budget cannot be kept for a user who cannot see the window. Short of that, keep headings mounted as a skeleton and give blocks `aria-posinset` and `aria-setsize`.

## Recommendation

1. Treat tier 1 as the accessible default for pages over the budget: skipped blocks stay in the tree, so VoiceOver "read all", the rotor and NVDA's browse mode keep working over the whole page (ACC-01, ACC-02). Test it with VoiceOver before relying on it (ACC-12).
2. For tier 2, do not rely on the page detecting the reading cursor (ACC-05). Ship three things together: (a) an "accessible full page" setting that mounts every block (the node budget is lifted, typesetting stays by distance), on by default if the system reports a screen reader and always available in settings; (b) a permanent heading skeleton, each heading a real `h1`..`h6` element with its text, mounted even when its section is not, so the rotor and "next heading" cover the document; (c) blocks given `aria-posinset` and `aria-setsize` in the one geometry table, so a screen reader that exposes them announces a true position (ACC-08, ACC-09).
3. Follow the feed pattern's rule for the windowed mount: mount around the block that holds DOM focus, and set `aria-busy` while a chunk is inserted (ACC-07).
4. A hidden text mirror is the last resort: it doubles the text in the DOM and defeats the node budget. Do not build it; the full-page setting does the same job without a second structure (ACC-10).

## Findings

### ACC-01 · Per MDN, Chromium keeps `content-visibility: auto` content in the accessibility tree  `[confirmed]`
MDN's accessibility note: "Off-screen content within a content-visibility: auto property remains in the document object model and the accessibility tree" [1]. The same page warns that hidden-by-style elements "will still appear in the accessibility tree" [1]. The CSS Containment 2 draft requires the opposite of hiding for `auto`: skipped content "must not expose the fact that a user is interacting with the page via the accessibility tree", and it may be omitted only "if this is not possible" without doing layout [2]. Chromium's side is consistent with the CSSWG thread, where the Chrome engineer's reasoning is that the style for `auto` elements is updated because accessibility needs it [3]. Chromium 85 to 89 hid headings and landmarks inside `auto` subtrees; a WebKit developer thread says it was fixed in 90 (search-result summary only; the list page returned HTTP 403 and was not saved) `[likely]`. Implication for the app: WebView2 on any current Evergreen runtime is past that bug. No engine test was run for this finding: the `[confirmed]` rests on MDN's statement, and the Chromium 90 fix is a search summary only.

### ACC-02 · WebKit: content stays reachable by VoiceOver, one report, 2024  `[likely]`
WebKit bug 283846, filed against Safari 18.1.1 on macOS 15.1.1, reports: "I did confirm that content is still accessible in VoiceOver (e.g. if the skipped content includes a link, it'll surface in the Web Rotor)" [4]. The bug is about find, not accessibility, and is marked RESOLVED FIXED. It is one reporter's check on one build, not WebKit documentation; nothing was found that states WebKit's accessibility-tree rule for skipped content in the engine source. For headings in the rotor and for "read all" across skipped blocks, the evidence is silent. `[unverified]` falsifier in ACC-12.
**Searched:** bugs.webkit.org (`content-visibility` + VoiceOver/rotor/heading, results listed 283846 and unrelated heading bugs); WebKit-dev list (403, not readable); MDN and the CSS draft (engine-neutral).

### ACC-03 · Windowed (unmounted) content does not exist for any screen reader  `[likely]`
A page that removes blocks from the DOM removes them from the accessibility tree; there is no API through which the page can announce text that is not in the DOM. Obsidian users meet this directly: a blind NVDA user reports that "After a while of scrolling down with the down arrow, the coherence of the document's reading is lost, and the reader reads some lines from above or reads the same line twice", and a reply attributes it to the "long note optimization that obsidian uses. Only what is on screen is actually rendered" [5]. The workaround that worked was a plugin that keeps the cursor line centred, i.e. forcing the mount to follow the cursor [5]. This is a user forum thread, not an engineering analysis.

### ACC-04 · CodeMirror 6 cannot turn the viewport off  `[confirmed]`
Asked how to render the whole document, CodeMirror's maintainer answered: "You can't, since it would destroy performance." The editor "listens to the beforeprint event to avoid this problem when printing" [6]. So the editor itself has a print-time full mount but no accessibility-time one; the screen-reader limit follows from the viewport. (I did not find CodeMirror documentation of a screen-reader mode; CodeMirror 6 edits in a contenteditable, so the screen reader sees only rendered lines.) The print hook is the pattern the app's print path needs anyway.
**Searched:** discuss.codemirror.net (the thread above plus search for "screen reader" viewport); the search engine for codemirror.net accessibility documentation, nothing specific.

### ACC-05 · A page cannot read the VoiceOver cursor; focus is the proxy  `[likely]`
Apple documents that "By default, the VoiceOver cursor and keyboard focus are synchronized—set to follow (or track) each other", and that the user can deselect "Synchronize keyboard focus and VoiceOver cursor" in VoiceOver Utility [7]. A page sees DOM focus, `focusin`, `selectionchange` and scroll, not the cursor; I found no API for the cursor and no page-side technique. The proxies, in order of reliability: (1) `focusin` on a block made focusable (`tabindex="-1"`), which works while the user keeps the default; (2) `selectionchange` and `document.activeElement`, which move when the cursor sits in text only in some cases (Apple Developer Forums reports VoiceOver's cursor staying on a descendant while focus moved to a parent; the page text was not retrievable, so this is `[unverified]`); (3) scroll, which VoiceOver triggers when it moves the cursor off screen, so the mount can follow scroll. None covers a user who has turned synchronisation off.
**Searched:** Apple VoiceOver guide (cursor tracking); Apple developer forums and WebKit bugs on cursor/focus mismatch.

### ACC-06 · The ARIA feed pattern is the published contract for windowing  `[confirmed]`
The APG says the web page is responsible for "Appropriate visual scrolling of the content based on which article contains DOM focus" and "Loading or removing feed articles based on which article contains DOM focus"; the assistive technology is responsible for "Indicating which article contains the reading cursor by ensuring the article element or one of its descendants has DOM focus" [8]. MDN adds: set `aria-busy="true"` while articles are added and reset it "or the user may not see the updates"; give each article `aria-posinset`, and `aria-setsize` as the total or `-1` when it is unknown [9]. This asks the screen reader to move focus in reading mode, and VoiceOver on macOS does so with cursor tracking on (ACC-05). Whether NVDA and Narrator apply the contract to WebView2 pages is not stated in the APG text I read. `[unverified]`: falsifier in ACC-12.

### ACC-07 · Mounting should follow focus and set aria-busy during a chunk insert  `[likely]`
From ACC-06 the design follows: the block that holds focus, or contains the selection, anchors the mount; mount from there outward in both directions; mark the container `aria-busy="true"` for the frame in which the fragment is inserted. The app's progressive mount inserts one fragment per frame with no layout read, so the busy window is small. Risk: an inserted block above the cursor in the same flow can make some screen readers lose their place. WebKit bug 236865 reports VoiceOver table navigation breaking when a virtualised data grid scrolls; its status is still NEW (open, unfixed) [10]; a practitioner guide advises updating `aria-posinset` and `aria-setsize` "synchronously... inside the virtualizer's scroll handler — never inside a requestAnimationFrame callback" [11] (secondary source, one author). The safe rule is insert-only, never recycle nodes, never replace a focused block.

### ACC-08 · `aria-setsize` and `aria-posinset` have mixed support  `[confirmed]` on the bug, `[likely]` on the rest
WebKit bug 246426: VoiceOver still announced the list size "List with three items" despite `aria-setsize=-1`; marked RESOLVED FIXED [12]. The same guide that advises the attributes says: "Common misuse: setting aria-setsize to the number of currently rendered nodes... instead of the full dataset length" [11]. The attributes are defined for list items and similar roles, not for arbitrary paragraphs; a Markdown page is mostly `p`, `pre`, `blockquote` and headings, so the only roles they would apply to are `article` (feed) or `listitem`. Using them across top-level blocks means giving each block `role="article"` inside a `role="feed"`, which changes how every screen reader announces a document, and VoiceOver and NVDA then announce "article" at each block. That is a real cost; it argues for the setting in ACC-09 over making the default page a feed.

### ACC-09 · An accessible full-page mode is how editors cope  `[confirmed]`
Monaco: `accessibilityPageSize` is a register of 500: "Controls the number of lines in the editor that can be read out by a screen reader at once. When we detect a screen reader we automatically set the default to be 500. Warning: this has a performance implication for numbers larger than the default" [13]. The integrators' guide tells hosts that have a user setting or can detect a screen reader to set accessibilitySupport to on, and says that when a screen reader is connected "we disable wrapping" [14]. The cost is visible to NVDA users: "it only provides 500 or so lines of your source code file through accessibility API at a time... it would only see 500 lines, no more" and "SayAll doesn't work" [15]. The accessibility guide calls it "a strategy based on paging the text" [16]. So Monaco's mode is page-sized windowing with a setting, not a full mount, and screen-reader users complain. The app can do better than Monaco because its blocks are static text: a mode that mounts everything has no editing cost.

### ACC-10 · Google Docs built a hidden second structure; Docs supports a screen-reader setting  `[likely]`
Google said that after the move to canvas rendering "Compatibility for supported assistive technologies such as screen readers, braille devices, and screen magnification features, will not be impacted by the canvas-based rendering change" [17]. WebAIM, testing the canvas sample in 2021, found "only rudimentary assistive technology support" [18]. I found no current Google engineering description of the accessibility layer, so the account of a hidden DOM with ARIA live regions is from press commentary, not read in a primary source `[unverified]`. A relevant detail from the NVDA discussion: NVDA "can only see some" headings in Docs while JAWS "can find headings in the entire document" through its own scripts [15]. That is the rotor-headings cost: on a document that exposes only a window, heading navigation lists the window's headings. A hidden text mirror (Docs' approach) costs a second copy of the text in the DOM and per-edit synchronisation; with this app's node budget that is the same cost as mounting the full page, so the mirror gains nothing.
**Searched:** Google Workspace Updates blog; WebAIM; the Docs help page (HTTP 404). No Office online or Kindle Cloud Reader engineering source was found (ACC-11).

### ACC-11 · Office online and Kindle Cloud Reader: nothing primary found  `[absence]`
**Searched:** web search "Word for the web screen reader accessibility document rendering"; web search "Kindle Cloud Reader screen reader accessibility mode". Results: Amazon says Kindle for PC supports NVDA and JAWS, not the web reader; an AppleVis thread says the web reader became inaccessible after a 2021 change (page returned HTTP 403, not saved, so unquoted). No engineering description of how either handles a windowed document. A second pass also searched DuckDuckGo for "Kindle Cloud Reader screen reader accessibility" and "Word for the web screen reader large document rendering accessibility virtualized": only Amazon and Microsoft user-facing accessibility guides, none on windowed rendering.

### ACC-12 · What a windowed mount costs the reader, and the tests that would measure it  `[unverified]`
The costs I expect, each with the exact manual test that would falsify it. Setup for all: a fixture of 5,000 blocks, 600 headings, window of about 2 screens, VoiceOver with Safari-equivalent WKWebView (the app on macOS), NVDA and Narrator on the Windows app.
1. **Read all stops at the mount end.** Test: put the cursor at the top, run VO-A; does it speak past the last mounted block? Pass condition for the design: either it continues (mount follows) or the end is announced. Falsified if it silently stops.
2. **Rotor headings lists only mounted headings.** Test: VO-U, Headings; count entries against 600. Same with NVDA's elements list (NVDA+F7) and Narrator's headings navigation (H). With a heading skeleton the count should be 600.
3. **`content-visibility: auto` keeps all in the tree.** Same tests on the tier 1 page: expected 600 headings and read-all to the end in WKWebView and WebView2. This is the test ACC-02 needs.
4. **Cursor follows mount.** Test: with synchronisation on, VO-Right across the mount edge; does the next block appear and does the cursor land on it; repeat with it off in VoiceOver Utility to see the failure.
5. **Find** (the app's own) is a separate vector (08); screen-reader find is the browser's own and sees only the DOM.
Falsifier for the whole recommendation: if tier 1 with `auto` loses headings from the rotor in WKWebView, the heading-skeleton and full-page setting become the only route and tier 1 cannot be the accessible default.

### ACC-13 · Print and Cmd+A: the large-files finding stands  `[unverified]`
DOM-11 in the large-files chapter left selection, copy and screen readers over `auto` and a windowed DOM untested; this chapter did not move it for selection and copy, and for screen readers it adds ACC-01 to ACC-10 [19]. DOM-11 stays open: no source states how Cmd+A across `auto` skips behaves in WKWebView.

## Options compared

| Option | Reading coverage | Cost | Risk | Verdict |
|---|---|---|---|---|
| Tier 1 `content-visibility: auto` only | Whole page in tree (Chromium confirmed; WebKit one report) | Style and nodes still linear | WebKit rotor unverified | Default for pages over the budget until tier 2 |
| Tier 2 window, nothing else | Only the mount; read-all stops; rotor partial | Lowest nodes | Blind users cannot read past the mount | No |
| Tier 2 + heading skeleton | Headings whole; body only in mount | One element per heading | Cost grows with 20,000-heading outlines | Yes, with a cap |
| Tier 2 + `aria-posinset` and `aria-setsize` on blocks | Position announced where supported | Needs `role="article"` blocks in a feed | Changes document semantics; mixed VoiceOver support | Only inside the accessible mode |
| "Accessible full page" setting mounting all | Whole page, normal reading | Node budget lifted for that user | Slow open at 1 to 5 MB | Yes, the fallback that always works |
| Hidden text mirror | Whole text | A second copy in the DOM | Same nodes as full mount, plus sync | No |
| Detect the VO cursor | n/a | n/a | Not possible | Not available |

## Open questions

- Does VoiceOver in WKWebView list headings inside `auto`-skipped blocks in the rotor, and read all across them? (ACC-12, tests 2 and 3.)
- Do NVDA and Narrator move DOM focus in reading mode in WebView2, so a focus-following mount would work as the feed pattern assumes? (ACC-12, test 4.)
- Can the app tell a screen reader is running (Tauri has no API; the system accessibility settings can be read per platform)? Not researched here.
- Cmd+A and copy across `auto` skipped blocks (DOM-11).

## Cross-links

- 02 (tier 1): the `auto` tier is accessible only if ACC-02 holds; its measurements need the VoiceOver check added.
- 03 (node budget): the accessible mode lifts the budget for one reader, so the budget needs a number for "the full page, once".
- 08 (find, select, copy): screen readers and the browser's find see the DOM only; the app's own find does not help them.
- 09 (typeset by distance): the full mount must still typeset by distance, so mounting all does not mean typesetting all.
- Large-files corpus: DOM-11 [19], DOM-06.

## Sources

Accessed 2026-11-27. Saved under `sources/`.

1. MDN, `content-visibility`: https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
2. CSS Containment Module Level 2 draft, section 4.6: https://drafts.csswg.org/css-contain-2/
3. CSSWG issue thread, Chrome engineer comment, March 2021: https://lists.w3.org/Archives/Public/public-css-archive/2021Mar/0561.html
4. WebKit bug 283846, filed 2024-11-29: https://bugs.webkit.org/show_bug.cgi?id=283846
5. Obsidian forum, "Screen reader fails reading long text", April 2023: https://forum.obsidian.md/t/screen-reader-fails-reading-long-text/58020
6. CodeMirror forum, "how can make sure the whole document is always rendered", November 2022: https://discuss.codemirror.net/t/how-can-make-sure-the-whole-document-is-always-rendered-in-codemirror6/5241
7. Apple, VoiceOver cursor tracking: https://support.apple.com/en-ae/guide/voiceover/vo15534/10/mac/26
8. W3C APG, Feed Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/feed
9. MDN, ARIA feed role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/feed_role
10. WebKit bug 236865, filed 2022-02-18: https://bugs.webkit.org/show_bug.cgi?id=236865
11. "Accessible Virtualized List Patterns" (secondary, undated): https://accessible-data-interfaces.pages.dev/virtualization-charts-dynamic-data-displays/accessible-virtualized-list-patterns/
12. WebKit bug 246426, filed 2022-10-12: https://bugs.webkit.org/show_bug.cgi?id=246426
13. VS Code `editorOptions.ts`, `accessibilityPageSize`: https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorOptions.ts
14. Monaco, Accessibility Guide for Integrators: https://github.com/Microsoft/monaco-editor/wiki/Accessibility-Guide-for-Integrators
15. NVDA discussion 15995 (proposal for web-app accessibility API), thread: https://github.com/nvaccess/nvda/discussions/15995
16. Monaco Editor Accessibility Guide (edited Aug 2026): https://github.com/Microsoft/monaco-editor/wiki/Monaco-Editor-Accessibility-Guide
17. Google Workspace Updates, May 2021: https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html
18. WebAIM, "Seismic change to Docs", 2021: https://webaim.org/blog/seismic-change-to-docs/
19. Large-files corpus, chapter 04, DOM-11: `/Users/ian/Dev/marxy-wt/windowing-research/docs/research/large-files/04-dom-rendering.md`
