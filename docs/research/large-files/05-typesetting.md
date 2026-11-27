---
corpus: large-files
id: 05
slug: typesetting
prefix: TYP
title: Typesetting, line breaking and text measurement on long documents
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [Knuth-Plass, line breaking, hyphenation, measureText, pretext, text-wrap pretty, text-wrap balance, kerning, complex text path, long unbroken run, content-visibility, viewport typesetting, foliate-js]
---

# 05 · Typesetting, line breaking and text measurement on long documents

> The question: how do line breaking, hyphenation and measurement stay fast on long documents and long unbroken runs? The answer in brief: Knuth–Plass is per paragraph and near-linear when a tolerance prunes the active list, so it is never the problem by itself. The cost sits in (a) measuring text (DOM reads, forced reflow), (b) browser shaping of very long runs, where every engine has had super-linear or hang-prone behaviour, and (c) doing it for the whole document instead of the part near the reader. Bound the typesetter by distance from the viewport, cap paragraph length, split long runs, and reserve heights.

## TL;DR
- Typeset only what is near the reader (viewport plus a margin, nearest first, cancellable). The 2026-10 audit already measured the viewport pass at 0–27 ms and the whole-document pass at about 300 ms of idle main-thread work for 53 KB of prose [8]; that scales at least linearly to seconds at 1–5 MB (the audit itself saw super-linear growth above 256 KB).
- Knuth–Plass is worst-case O(n²) per paragraph but "usually runs much faster, in close to linear time" [9]; the cost is per paragraph, so the lever is a per-paragraph size cap and a feasibility threshold, not a faster algorithm.
- A 100 KB single run is outside any engine's comfort zone: Firefox logged O(N²) reflow on long strings [4] and a 33 s load from one 20 MB text run [5]; Blink only stopped splitting text at 64 KB in Chrome 151 (2026) and WebKit still splits [6]. Do not typeset above a cap; split at break opportunities and leave the rest to the browser.
- Kerning and ligatures put text on the complex (HarfBuzz/CoreText) path; WebKit developers found the gap "doesn't come from the code paths" [10] and Blink wants all text on the complex path [11]. So `font-kerning: none` is a mitigation to test, not a documented fix.
- Native `text-wrap: pretty` is not a substitute for a Knuth–Plass: Blink considers the last four lines [3][12], WebKit the whole paragraph but warns of cost on "many hundreds or thousands of lines" [1].
- Measure with canvas `measureText` and a per-(font, segment) width cache, as chenglou's pretext does [2]; do not read the DOM per paragraph.

## Recommendation for this setup

1. **Bound the queue by distance, not by every paragraph.** Keep one geometry table (the work in flight) and let the typesetter take paragraphs in order of distance from the scroll position, within a window of about 2–3 screens either side, re-prioritised on scroll and aborted on document change. Everything outside is left as plain browser wrapping (ragged right, `hyphens: manual`). That is the same shape as foliate-js, which loads one section and `unload`s the previous one (`this.sections[oldIndex]?.unload?.()`) [7], and as `content-visibility: auto` with an `auto` intrinsic size [13]. Expect the queue to cost O(window), not O(file).
2. **Reserve height before and after.** A paragraph's height must not change when it is set. With ragged-right and a baseline grid, set line height from the grid (already fixed), and for unset paragraphs use the last measured height from the geometry table, or an estimate chars × avg-char-width ÷ measure × line height, marked "estimated". When a set changes the line count, correct `scrollTop` by the delta for blocks above the reader (or rely on scroll anchoring where WebKit supports it; verify in WKWebView, see Open questions). Never set a block that is within the viewport during a user scroll without a delta correction.
3. **Cap paragraph size.** Do not run Knuth–Plass above a limit such as 20 000 characters or 400 words per paragraph (a starting value; measure it). Above the cap, split into chunks at existing break opportunities (sentence ends, then spaces) so each chunk is typeset on its own, or skip typesetting and let the browser wrap. For a 100 KB unbroken run (no spaces), also skip: there is no break opportunity for Knuth–Plass to use, and the browser must shape it as one run. Inference: this is what a "large paragraph" degrade rule should do, and it is the most likely cause of the 13 s [see TYP-04].
4. **Measure with canvas, cache by segment.** Use one `OffscreenCanvas` context per font; cache widths in a `Map` keyed `font + "\u0000" + word` (bounded, cleared on font load), as pretext's `prepare()` / `layout()` split does [2]. Do not call `getBoundingClientRect` / `offsetWidth` inside the per-paragraph loop. Accuracy caveat: canvas widths do not apply kerning across element boundaries, and differ from DOM in `text-rendering`, `font-kerning` and `word-spacing` settings [2].
5. **Prune Knuth–Plass.** Use a tolerance (adjustment ratio) with the usual fall-back (second pass with a looser threshold, or emergency stretch), drop active nodes whose line already overflows, and flush at forced breaks [9][14]. For ragged right, badness can be a simple squared slack plus hyphen and last-line penalties, which keeps nodes few.
6. **Hyphenate lazily and cache per word.** Liang patterns are a trie lookup per word; Hyphenopoly's engine is a ~1 KB wasm trie with per-language pattern modules (en-us about 21 KB) [15]. Cache `word -> break offsets` in a bounded Map; hyphenate only words in paragraphs about to be set. I found no measured words-per-second figure (see TYP-06).
7. **Do not rely on native `text-wrap: pretty` or `balance` instead.** Use them, if at all, as the fallback for paragraphs outside the window (only supported on WebKit that ships them; check versions, TYP-07).

**Rules for new features**
- Typesetting work is bounded by distance from the viewport; a function that sets every paragraph of a page fails review.
- Any loop over blocks that calls the typesetter checks a deadline per paragraph (≤ 8 ms slice) and can be aborted by a token.
- Do not typeset a paragraph over the character cap (starting value 20 000); split at break opportunities or leave to the browser. A test feeds a 100 KB unbroken run and a 1 MB paragraph and asserts no task over 50 ms.
- No DOM geometry read (`offsetHeight`, `getBoundingClientRect`, `getComputedStyle` layout values) inside a per-paragraph loop; read once per batch, write once.
- Text widths come from the cached canvas measurer; a new measuring site that bypasses it is a finding.
- Setting a block that is above the reader either preserves its height or adjusts `scrollTop` by the delta; a browser test scrolls to the middle, sets blocks above, and asserts the first visible line did not move.
- Every per-paragraph cache (widths, hyphenation) is size-bounded and cleared on font load or font change.

## Findings

### TYP-01 · Knuth–Plass is O(n²) worst case, near-linear in practice, per paragraph  `[likely]`
Wikipedia states the classic dynamic programme "is a worst-case O(n2) algorithm but usually runs much faster, in close to linear time" [9]. A tutorial walk-through says that with tight tolerance, "the number of active nodes at any point is quite limited" and that no break-point is available when a line would exceed the tolerance [14]. A Rust implementation prunes active nodes whose span already exceeds the infeasibility threshold (secondary, from search summary, not saved). The original 1981 paper was not retrieved. Implication: n is the words in one paragraph, so cost is O(words) with a bounded active list; a 100 KB paragraph of ordinary prose (≈ 17 000 words) is the case where the active list can grow if tolerance is loose, so cap it.
**Searched:** Wikipedia page (saved); defoe.sourceforge.net walk-through (saved); web search for "Knuth-Plass complexity active nodes pruning", which returned no measured timing.

### TYP-02 · JS Knuth–Plass libraries publish no per-paragraph timings  `[absence]`
tex-linebreak (TypeScript, "no dependencies on a particular JS environment") has no benchmark in its README; the one cost note is about DOM justification: it "can be in slow in large documents. Test it on your content ... Also limit the number of elements which you apply justification to" [16]. Bram Stein's typeset is described as a quality comparison, not a speed one (search summary). So a per-paragraph figure must come from this app's own harness; the audit's 27 ms for the 53 KB viewport pass [8] is the only number I have, for this typesetter.
**Searched:** npm/jsdelivr README of tex-linebreak (saved); web search "tex-linebreak Knuth-Plass JavaScript performance benchmark"; github.com/bramstein/typeset in search results (not opened).

### TYP-03 · Local audit: viewport pass cheap, whole-page pass linear and repeated  `[measured]`
The older audit (setup: WebKit, 53 KB continuous prose, load average 4.5–9) found the viewport pass at "0–27 ms", and setting every paragraph ended 438 ms after start against 143 ms with the typesetter off: "about 300 ms of main-thread work in idle chunks of eight paragraphs". Each background chunk "also schedules a grid pass over the whole article" [8]. At 1 MB that is roughly 19 × larger by simple scaling (inference), and the per-chunk whole-article grid pass makes it quadratic in chunks. Fix both: bound the queue, and make the grid pass touch only the chunk.

### TYP-04 · Long unbroken runs are a hang class in every engine  `[confirmed]` (history) / `[likely]` (cause of the 13 s)
Firefox bug 235022 (old): "reflow of a long string of text means measuring it, which is O(N) in string length, we end up with O(N^2) layout time overall" [4]. Bug 934770 logged one 20,274,371-character text run and 33.5 s of reflow, and concluded "We need to slice up text runs when they get too large" [5]. Blink split text nodes at 64 KB since 2007 and removes that in Chrome 151, noting "WebKit still splits text at 64k, while Gecko does not" [6]; so the engines differ in how a 100 KB node is built, and the WebKit in WKWebView splits it. A WebKit report found by search (bug 249909, not fetched, 502) said a flex container with `overflow-wrap: anywhere` and one long string takes tens of seconds in Safari but is instant in Chrome; treat as `[unverified]` until read. None of these sources measures a 100 KB run with kerning. My inference: the 13 s is shaping/line-breaking a single run with kerning on plus this typesetter's own per-run work; verify with a profile that separates the typesetter's time from browser layout.

### TYP-05 · Kerning and ligatures mean the complex path; the path is not the whole cost  `[confirmed]`
Chromium's layout team wanted to eliminate its simple path so "all text use the current complex text path ... support kerning and ligatures" [11]. A 2025 WebKit patch found "The performace difference between the complex and simple text code paths doesn't come from the code paths" but from WebCore around them [10]. A WebKit report on `text-rendering` found that `geometricPrecision` pushes text to the complex path, with janky zoom [17]. So `font-kerning: none` / `text-rendering: optimizeSpeed` on an oversized run is a cheap experiment, but no source gives a measured gain for WebKit. A Firefox thread notes that cost differences can come from "discard and re-create text frames" rather than shaping [18].

### TYP-06 · Hyphenation cost: no measured throughput found  `[absence]`
Hyphenopoly describes itself as a small wasm engine (about 1 KB) plus pattern modules, using Liang's algorithm [15]; the README gives sizes, not words per second, and I found no cache documentation. Per-word results are deterministic, so a bounded per-word Map is safe. Native `hyphens: auto` was not investigated beyond noting Pretext says it "can wrap differently" from its predictions [2].
**Searched:** github.com/mnater/Hyphenopoly README (saved); web search "Hyphenopoly performance words per second"; Hypher not searched separately.

### TYP-07 · Native `text-wrap`: Blink looks at four lines; WebKit at the whole paragraph; `balance` is line-capped  `[confirmed]`
The Blink intent says the algorithm adjusts "the last 4 lines of paragraphs" to balance typography and performance [3]. WebKit's post: "we are the first browser to use it to evaluate and adjust the entire paragraph", and "your text element would need to be many hundreds or thousands of lines long to see a performance hit"; for longer text it suggests chunks, "even 1,000-line paragraphs won't affect performance" [1]. MDN on `balance`: "this value is only supported for blocks of text spanning a limited number of lines (six or less for Chromium and ten or less for Firefox)" [12]; Safari's cap was not stated there. Ship dates: STP 216 (April 2025) per search results; the Safari 26 note was not confirmed in the release notes excerpt. Check the WebKit in each Tauri target before depending on it.

### TYP-08 · Pretext: DOM-free measurement with a prepare/layout split  `[confirmed]` (design) / `[likely]` (numbers)
chenglou's pretext (released late March 2026, early-stage): "prepare() does the one-time work: normalize whitespace, segment the text at its break opportunities, measure the segments with canvas ... layout() is the cheap hot path after that: pure arithmetic over cached widths" [2]. A secondary summary reports about 0.09 ms for layout over 500 texts against about 19 ms for prepare (benchmark page returned HTTP 410, not saved; `[likely]`). Accuracy caveats are in its README: it assumes default kerning and word spacing and "predicts the browser's default wrapping"; `text-wrap: balance`/`pretty`, `hyphens: auto` and `optimizeLegibility` "can wrap differently"; `system-ui` is "unsafe for layout() accuracy on macOS"; Safari keeps fallback-font widths until `clearCache()` after a font loads [2]. It breaks lines greedily like the browser, not Knuth–Plass, so it is a measurement idea to borrow, not a replacement.

### TYP-09 · Paginating readers lay out one resource at a time  `[confirmed]` (foliate) / `[unverified]` (Readium figures)
foliate-js's paginator uses CSS columns, a `ResizeObserver` that re-renders, and calls `this.sections[index].load()` for the section on screen and `unload` for the old one [7]. A claim that Readium's Kotlin toolkit issue reports a book with very large chapters (30k+ lines) taking about 20 s to load and 0.5 s per page turn `[unverified]`: it came from a search summary, the saved page text of [19] does not contain the figures, and the verifier found issue 313 is about something else (see vector 02, MDA-09). Verification correction: tag changed from `[likely]` to `[unverified]`. Lesson: the unit of laziness is the resource; a big single chapter defeats it. This app's one-page-per-file reading must create its own sub-units (blocks) with known geometry.

### TYP-10 · Height reservation: `content-visibility: auto` plus an `auto` intrinsic size  `[confirmed]`
web.dev: `contain-intrinsic-size` "acts as a placeholder size in lieu of rendered content" [13]; without it the skipped box collapses. The `auto` keyword remembers the last rendered size (search summary; detail in vector 04). It does not set anything by itself: a typesetter must still choose when to set a block.

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Typeset the whole page in idle slices (today) | Poor above ~1 MB | Linear in file, plus per-chunk grid pass | Seconds of main-thread work; layout thrash | Replace |
| Viewport-bounded queue by distance, cancellable | Good | O(window) | Height shifts; needs geometry table | Adopt |
| Per-paragraph cap + chunk split | Good | Small | Visible seam where chunks join | Adopt, cap measured |
| Canvas width cache (pretext-style) | Good | One-time measure per word | Kerning and font-load accuracy | Adopt; invalidate on font load |
| Replace with native `text-wrap: pretty` | Weak: engine versions vary, Blink 4 lines | Zero code | Different look per engine | Fallback for outside window |
| Hand typesetting to a worker | Possible with OffscreenCanvas widths | Moderate | DOM writes still on main | Later; see vector 06 |
| `font-kerning: none` on huge runs | Unproven | Zero code | Visual change | Experiment on the 100 KB run |

## Open questions
- What exactly takes 13 s on the 100 KB run (typesetter, browser shaping, or flex/overflow-wrap interaction)? A WebKit Web Inspector or `performance.measure` profile with kerning on and off would settle it.
- Does WKWebView (macOS 26) support scroll anchoring for these inserts? Needs a browser test; not found in a source.
- Safari's line cap for `balance` and `pretty` versions per Tauri target: read WebKit source or bug 279789 (HTTP 502 today).
- Per-paragraph Knuth–Plass timing for this typesetter at 1 000, 5 000 and 20 000 words, to set the cap.
- Hyphenation throughput: not found.

## Cross-links
- Vector 04 (dom-rendering): TYP-10 and recommendation 2 (heights, `content-visibility`, scroll anchoring); TYP-04 (64 KB text node, WebKit splitting).
- Vector 06 (main-thread): deadline slicing and abort for the typesetting queue; OffscreenCanvas in workers.
- Vector 10 (guardrails): rules above are checkable as work-counting tests (paragraphs set per scroll, width-cache hits).
- Vector 02 (markdown-apps): TYP-09 for Readium and foliate-js behaviour on huge chapters.

## Sources
1. Better typography with text-wrap pretty, WebKit blog — https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/ (accessed 2026-11-27) — whole-paragraph, cost on thousands of lines
2. pretext README, Cheng Lou — https://github.com/chenglou/pretext (accessed 2026-11-27) — prepare/layout, caveats
3. Intent to Ship: CSS text-wrap: pretty, blink-dev — https://groups.google.com/a/chromium.org/g/blink-dev/c/rwBWqqOB_ag/m/bfEq3MqwAgAJ (accessed 2026-11-27) — last 4 lines
4. Mozilla bug 235022 — https://bugzilla.mozilla.org/show_bug.cgi?id=235022 (accessed 2026-11-27) — O(N^2) on long strings
5. Mozilla bug 934770 — https://bugzilla.mozilla.org/show_bug.cgi?id=934770 (accessed 2026-11-27) — 20 MB text run, 33.5 s
6. Web-Facing PSA: Remove 64k Text Node Splitting, blink-dev — https://groups.google.com/a/chromium.org/g/blink-dev/c/6KcNuIEHyZ0 (accessed 2026-11-27) — Chrome 151, WebKit still splits
7. foliate-js paginator.js — https://raw.githubusercontent.com/johnfactotum/foliate-js/main/paginator.js (accessed 2026-11-27) — section load/unload
8. Local performance audit 2026-10, section 6 (local file, read 2026-11-27) — typeset numbers
9. Knuth–Plass line-breaking algorithm, Wikipedia (secondary) — https://en.wikipedia.org/wiki/Knuth%E2%80%93Plass_line-breaking_algorithm (accessed 2026-11-27) — complexity
10. WebKit bug 297088 — https://www2.webkit.org/show_bug.cgi?id=297088 (accessed 2026-11-27) — code paths vs WebCore
11. Eliminating Simple Text, Chromium layout team — https://www.chromium.org/teams/layout-team/eliminating-simple-text/ (accessed 2026-11-27)
12. MDN text-wrap-style — https://developer.mozilla.org/docs/Web/CSS/Reference/Properties/text-wrap-style (accessed 2026-11-27) — balance line limits
13. content-visibility, web.dev — https://web.dev/articles/content-visibility (accessed 2026-11-27)
14. Knuth & Plass line-breaking Revisited (secondary) — https://defoe.sourceforge.net/folio/knuth-plass.html (accessed 2026-11-27)
15. Hyphenopoly README — https://github.com/mnater/Hyphenopoly (accessed 2026-11-27)
16. tex-linebreak README — https://cdn.jsdelivr.net/npm/tex-linebreak@0.9.0/README.md (accessed 2026-11-27)
17. WebKit bug 99524 — https://www2.webkit.org/show_bug.cgi?id=99524 (accessed 2026-11-27) — geometricPrecision and the complex path
18. Mozilla bug 2005283 — https://bugzilla.mozilla.org/show_bug.cgi?id=2005283 (accessed 2026-11-27) — WebKit vs Firefox shaping
19. Readium kotlin-toolkit issue 313 — https://www.github.com/readium/kotlin-toolkit/issues/313 (accessed 2026-11-27) — large chapters
