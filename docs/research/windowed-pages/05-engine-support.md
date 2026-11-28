---
corpus: windowed-pages
id: 05
slug: engine-support
prefix: ENG
title: Engine support for content-visibility, intrinsic sizes, scroll anchoring and find
kind: chapter
vector: Q-05
created: 2026-11-27
---

# 05 · Engine support: which WebKit and Chromium releases can carry tier 1

## Abstract

Which Safari/WebKit and Chromium releases ship `content-visibility`, `contain-intrinsic-size` (including `auto`),
the `contentvisibilityautostatechange` event, `overflow-anchor`, find in skipped content and `hidden="until-found"`,
and which WebKit the WKWebView of macOS 13, 14, 15 and 26 gets. Research date 2026-11-27. Newest sources: the Safari 27.0
post (September 2026) and Safari 26.6.1 security notes. Sources are in `sources/`; numbers `[n]` below are the saved
file ids listed at the end.

## TL;DR

- On WebKit, `content-visibility` is **Safari 18 (September 2024)**; `auto` was **not findable** until Safari 26
  (bug 283846, fixed), and **`overflow-anchor` / scroll anchoring is Safari 27 (2026-09-14)** [1][2][3][4][5].
- WKWebView on macOS 13 is Safari 16-era WebKit **unless** the reader installs Safari 18.x; macOS 14 starts at Safari 17;
  neither ever gets Safari 27. The app minimum is 13.0, so **tier 1 cannot be assumed on the app's floor**; it can only
  be a progressive enhancement behind feature detection [6][7][8].
- Whether a standalone Safari update changes the WKWebView of other apps is **not stated by Apple in any page found**
  (`[absence]`); Apple's security notes list WebKit fixes for Ventura and Sonoma in Safari updates, which suggests it does
  [8][9].
- WebView2 is no constraint: every feature is Chromium 85 to 117 and the Evergreen runtime is Chromium 150+ [10][11].

## Recommendation

1. Treat tier 1 as an optimisation that is **detected** (`CSS.supports('content-visibility','auto')` plus a
   find-in-skipped probe if the app relies on native find), never a requirement. Tier 2 (mounting by distance, own
   geometry table) must carry correctness on macOS 13/14 and on any WebKit below 26.
2. Never rely on `overflow-anchor` in WebKit below 27. The app's own position keeping (the existing grid pass sets
   `overflow-anchor: none`) stays the owner. After Safari 27 the property is live in WKWebView, so setting `none` on the
   article remains right (otherwise the engine and the app both correct the same shift).
3. Do not use `content-visibility: hidden` on the Read page for "behind Source" as a WebKit optimisation below 26: the
   geometry-in-hidden-subtree fix is Safari 26 [4][12].
4. Use the app's own find over the geometry table; do not depend on `hidden="until-found"` or text-fragment reach into
   skipped content on any WebKit below 26.2.

## Table: feature by engine

"Floor" is the WebKit a clean install of that macOS shipped with (from the Tauri version table and Apple's own Safari
release lists); "max via Safari update" is the newest Safari Apple publishes for that macOS. Whether the second
column reaches WKWebView is ENG-04.

| Feature | First Safari/WebKit | macOS 13 (floor Safari 16.x; max Safari 18.6, `[likely]`: inferred from which OS versions each Safari notes page lists) | macOS 14 (floor 17.0; max 26.x, `[likely]`: inferred) | macOS 15 (floor 18.0, from general knowledge, not a saved source; max 27) | macOS 26 (floor 26.0, from general knowledge, not a saved source; max 27) | WebView2 (Chromium) |
|---|---|---|---|---|---|---|
| `content-visibility` property, `hidden`, `visible` | Safari 18 [1][3] | no on floor; yes only if Safari 18+ reaches WKWebView | no on floor; yes via Safari 18+ | yes | yes | Chromium 85 [1] |
| `content-visibility: auto` with find-in-page reaching skipped text | Safari 26 (BCD: 18 to 26 partial "Skipped content is not findable via find-in-page") [1][4][13] | no | no on floor; yes with Safari 26.x | no on 18.x; yes with Safari 26.x/27 | yes | yes (stays in DOM and a11y tree) [14][15] |
| `contain-intrinsic-size`, `auto`, `none` | Safari 17 [16] | no on floor | yes | yes | yes | 83 / `none` 98 / `auto` 117 [16] |
| `contentvisibilityautostatechange` event | Safari 18 [17][3] | no on floor | via Safari 18+ | yes | yes | 108 [17] |
| `overflow-anchor` (scroll anchoring) | **Safari 27** [2][18] | no | no | only with Safari 27 | only with Safari 27 | 56 [18] |
| `hidden="until-found"` and `beforematch` | `beforematch` Safari 26.2; BCD flags the attribute partial (DOM-05) [19][20] | no | no on floor; yes with Safari 26.2+ | with Safari 26.2+ | 26.2+ | 102 [19][20] |
| Text fragments reaching skipped content | not established (text-fragment display flickers: see ENG-08) | no | no | no | uncertain | n/a to this app (no navigation) |

## Findings

### ENG-01 · content-visibility shipped in Safari 18; `auto` was only findable from Safari 26  `[confirmed]`
MDN browser-compat-data gives `content-visibility` Safari 18 and `auto` Safari 26 with a Safari 18 to 26 partial entry
noting "Skipped content is not findable via find-in-page." and the implementation link webkit.org/b/283846 [1]. Apple's
Safari 18 release notes say "Added support for `content-visibility`." [3] and the WebKit blog "WebKit for Safari 18.0 adds
support for content-visibility." [21]. WebKit bug 283846 ("content skipped with `content-visibility: auto` should still be
findable") is RESOLVED FIXED [13]; the Safari 26 notes list "Fixed content skipped with `content-visibility: auto` to be
findable." [4]. Chromium has had the property since 85 [1]. Confirms DOM-02 unchanged.

### ENG-02 · contain-intrinsic-size is older than content-visibility in WebKit: Safari 17  `[confirmed]`
BCD gives `contain-intrinsic-size` Safari 17, Chrome 83, Firefox 107, and the `auto none` value Safari 17, Chrome 117 [16].
Consequence: an engine that has `contain-intrinsic-size: auto` but no `content-visibility` (Safari 17 on macOS 14 floor)
gains nothing, since the remembered size applies only to skipped boxes. MDN's example says "After a section is rendered, it will retain its rendered intrinsic size,
even when it is scrolled out of the viewport." [15]. The remembered size is a pixel height, the typesetter's grid heights are whole
line-box units: a remembered size from a measure at one width goes stale on a width change (DOM-06 stands; no WebKit-specific
evidence either way found).

### ENG-03 · The event is Safari 18 and Chromium 108  `[confirmed]`
`ContentVisibilityAutoStateChangeEvent` and `skipped`: Chrome 108, Firefox 125, Safari 18 (BCD) [17]. MDN: the event "fires on any element with
content-visibility: auto set on it when its rendering work starts or stops being skipped" [15]. It is the only signal
the page gets when WebKit starts or stops rendering a block, so tier 1 can use it to lazily typeset by relevance without an
IntersectionObserver: but only where the property exists.

### ENG-04 · Which WebKit a WKWebView gets: floor is certain, Safari-update reach is not  `[likely]` `[absence]`
Tauri's reference says the macOS webview "is considered a core component and is therefore updated with the regular OS
updates", with the worked mapping Ventura 13.0 = Safari 16.1 (WebKit 614.2.9), 13.4.1 = Safari 16.5.1, Sonoma 14.0 beta =
Safari 17.0 (616.x) [7]. That page is secondary and says nothing about standalone Safari updates. Apple-side facts that are
confirmed: Safari 18.6 "is available on ... macOS Sequoia 15.6, macOS Sonoma, macOS Ventura", and "If you are running macOS Sonoma or macOS
Ventura, you can update Safari by itself, without updating macOS." [8]; Safari 18.6 security notes list WebKit fixes "Available for: macOS Ventura and macOS Sonoma" [9];
Safari 26.6.1 notes list "Available for: macOS Sonoma and macOS Sequoia" (so Ventura tops out at Safari 18.6) [22]; Safari 27.0 "comes
automatically with macOS 27 ... Plus, you can update to Safari 27.0 on macOS 26 Tahoe and macOS 15 Sequoia, separate from macOS." [2] (so
macOS 14 tops out at Safari 26.x). Not found anywhere: an Apple sentence saying that a standalone Safari update also updates the WebKit that
other apps' WKWebView loads. A WebKit bug cited in a search says app authors cannot read the Safari version of a WKWebView, so
detect features, not versions. The inference "a Safari update patches system WebKit" rests on security fixes shipping through it. Treat it as
likely, test on a real macOS 13/14 machine (read `navigator.userAgent` WebKit build in the app, and probe `CSS.supports`).
`[absence]` for the Apple statement. **Searched:** webkit.org blog (Safari 18.3, 18.6, 26.x posts), support.apple.com Safari security
pages, developer.apple.com Safari release notes, web search for "Safari update WKWebView other apps".

### ENG-05 · Scroll anchoring is Safari 27, so it is a WebKit-27 feature on a 26 or 15 machine only after a Safari update  `[confirmed]`
BCD gives `overflow-anchor` Safari 27, Chrome 56, Firefox 66 [18]. The Safari 27.0 post: "Now with support for Scroll Anchoring, Safari 27.0 instead
adjusts the scroll position and keeps the content exactly where it was before the content insertion." and "Scroll anchoring is controlled by the
overflow-anchor CSS property, which defaults to auto." [2]. Its release notes list several scroll-anchoring fixes, for instance "Fixed an issue where
scroll anchoring could cause pages to scroll to negative offsets." and "Fixed an issue where pages could become blank and jump to the top after
dynamically loading new content when scroll anchoring was enabled." [2]. Confirms DOM-04; **refines** it: Safari 27 can be installed on
macOS 15 and 26 separately from macOS [2], so "macOS 26 means Safari 26 engine" holds only for the floor. Implication for windowing: with tier 2 (inserting
blocks above the viewport) WebKit below 27 gives no help and Chromium gives engine anchoring that can double-correct; keep `overflow-anchor: none` on the article and do the
correction in code. First-release scroll-anchoring bugs in 27 (blank page, negative offsets) are a reason not to enable it for the article.

### ENG-06 · Known WebKit bugs that bear on tier 1  `[confirmed]` (existence and status), `[unverified]` (fix versions)
- Find: bug 283846, reported on Safari 18.1.1, macOS 15.1.1; the reporter also notes skipped content "is still accessible in VoiceOver (e.g. if the skipped
  content includes a link, it'll surface in the Web Rotor)" [13]. Fixed in Safari 26 [4].
- Geometry: bug 290577 "Incorrect geometry values inside c-v hidden subtree" RESOLVED FIXED [23]; Safari 26 notes: "Fixed geometry values inside
  `content-visibility: hidden` subtrees." and "Fixed not marking `content-visibility: hidden` content for layout when targeting `content-visibility: auto`." [4]. Bug 288312 "Support
  ContentVisibilityForceLayout in updateLayoutIfDimensionsOutOfDate" RESOLVED FIXED [24]. So before 26, `getBoundingClientRect` inside a skipped
  subtree can return wrong values in WebKit. The app's batched per-block rect read after mount (and the existing review warning that "zero rects" are
  read as "not shown") are exposed on WebKit < 26.
- Repaint: Safari 26 "Fixed changing `content-visibility` from `visible` to `hidden` to repaint correctly." [4].
- Accessibility: bug 292380 "AX: content-visibility change from hidden to visible ignored by VoiceOver" (macOS 15.4.1) RESOLVED FIXED [25].
- Regression: bug 277573 "details/summary with `content-visibility:auto` doesn't expand" (Safari 18 betas), closed as duplicate [26]; Safari 18.1 added
  "Fixed content-visibility to not apply to elements with display: contents or display: none." [27].
- Selection-specific and size-containment-specific WebKit bugs: none confirmed in the pages read (see Open questions). Fix versions for 290577,
  288312, 292380 are not on their pages; `[unverified]` beyond "by Safari 26".

### ENG-07 · Chromium and WebView2: all of it is old, and the runtime is evergreen  `[confirmed]`
Chromium: `content-visibility` 85, `contain-intrinsic-size` 83, `auto` 117, event 108, `overflow-anchor` 56, `beforematch` 102 [1][16][17][18][19]. WebView2: Evergreen mode
updates itself and is the default; from version 152 (2026-08-24) the runtime moves to a 2-week cadence, with 150 and 151 as the last four-week releases [10]. An admin
policy can roll an app back N-1 or N-2 and Fixed Version mode pins a runtime, so features are still detected, but nothing here falls below Chromium 117
unless a fixed runtime is bundled (the app does not bundle one: `[unverified]`, from the brief only). Accessibility: web.dev says "the off-screen content remains available in the document object model and
therefore, the accessibility tree (unlike with visibility: hidden)" [14]; MDN repeats it [15]. Chrome's newer guide is more cautious (some assistive technology setups may skip off-screen nodes
until focus moves in; it is in Japanese on the saved page, so `[likely]`) [28]. Chromium's side of the spec debate: a Chromium engineer writes that Chromium forces a style update on
auto elements for find and a11y, an implementation choice [29]. Net: auto-skipped content is findable and exposed in Chromium; hidden is neither [15].

### ENG-08 · hidden="until-found" and text fragments: partial in Safari 26.2, and fragile  `[confirmed]` (versions), `[likely]` (reliability)
BCD: `beforematch` Chrome 102, Firefox 139, Safari 26.2 [19]. web-features says baseline false overall (Firefox 148 for the attribute, Safari absent from the aggregate) while
listing "safari: 26.2" under `beforematch` [20]; MDN's own text: the event fires "before" reveal [30]. The Safari 27.0 notes include "Fixed VoiceOver on Safari unable to navigate to
content revealed by disclosure widgets using hidden="until-found"." [2]. WebKit also exposes `document.fragmentDirective` for feature detection from Safari 18.0 [21]. DOM-05 and SRC-09 are
**consistent with this** (Safari 26.2 first, partial). Since a desktop reader has no URL navigation, text fragments are not used; native find into until-found blocks would help only with WebKit 26.2+, so the app's own find stays the primary mechanism.

### ENG-09 · Effect on the large-files findings  `[confirmed]`
DOM-02: unchanged (Safari 18; auto findable only from 26). DOM-04: unchanged on versions, refined on the engine mapping (Safari 27 installable on macOS 15 and 26; macOS 13 and 14 never get it).
DOM-05: unchanged; adds that Safari 26.2 `beforematch` is confirmed in BCD and web-features and that the Safari 27 fix is about VoiceOver and disclosure widgets. SRC-09: unchanged;
its warning that the engine "follows the macOS version" should be softened to "follows the OS floor plus any standalone Safari update, which Apple does not document for other apps".

## Options compared

| Option | Works on | Risk |
|---|---|---|
| Tier 1 as the only mechanism | macOS 15 with Safari 26+, 26, WebView2 | wrong rects and unfindable text below Safari 26; none at all on 13 floor |
| Tier 1 as detected enhancement over tier 2 | all | two behaviours; keep one path with the property as a hint |
| Tier 2 only, no CSS skipping | all | gives up engine skipping of already-mounted blocks; loses nothing on correctness |
| Rely on `overflow-anchor` | Chromium, Safari 27 | absent on 13/14 and most of 15/26 installs; double correction when present |

The shape that follows from the evidence: one tier 2 path (own geometry table, own find, own anchoring) with
`content-visibility: auto` plus `contain-intrinsic-size: auto <estimate>` added as a hint only where `CSS.supports` is true, and the typesetter never reads geometry of a block
that is currently skipped.

## Open questions

- Does a standalone Safari 18.x or 26.x update change `WKWebView` for other apps on macOS 13/14? Needs a test on real hardware (read the WebKit build from `navigator.userAgent` before and after).
- Fix versions of bugs 290577, 288312, 292380 (Safari 26.0 to 26.x?), and whether any selection-across-skipped-boundary or size-containment bug is open: nothing found in WebKit Bugzilla searches
  ("content-visibility selection", "contain-intrinsic-size"); `[absence]`. **Searched:** web search of bugs.webkit.org for those terms; Safari 18.x and 26.x release notes.
- Text-fragment behaviour into skipped content in WebKit: a search snippet says the match scrolls into view and "displays briefly before disappearing" (bug 283846 thread); not confirmed on the saved page.
- The Safari-to-macOS base mapping for macOS 15 (Safari 18.0) and 26 (Safari 26.0) is from general knowledge and the Safari notes, not a table in these sources: `[likely]`.

## Cross-links

Vector 02 (tier 1 measurement) needs a WebKit version note per run; vector 07 (accessibility): ENG-06 VoiceOver bugs and ENG-07 Chromium a11y; vector 08 (find): ENG-01, ENG-08; vector 06 (anchoring): ENG-05;
vector 01 (code map): zero-rect reads under `content-visibility: hidden`.

## Sources (saved in `sources/`, accessed 2026-11-27)

1. 9a98287102b3 BCD css/properties/content-visibility.json
2. 483b39262ed8 WebKit Features for Safari 27.0 (webkit.org/blog/18325/)
3. 92eca96dd1aa Apple, Safari 18 release notes (`Added support for content-visibility`)
4. 8e9a7aea2801 Apple, Safari 26 release notes; ffb092195ecb WebKit Features in Safari 26.0
5. 6ca92109cc22 (see 7)
6. Tauri reference (see 7)
7. 6ca92109cc22 Tauri, Webview Versions
8. dd0a58fa20f7 WebKit Features in Safari 18.6
9. 062f25159a64 Apple, security content of Safari 18.6
10. 78932871ff85 WebView2 release cadence announcement (v152)
11. 1325fa218862 Microsoft, WebView2 distribution (Evergreen)
12. 8e9a7aea2801 (Safari 26 notes, geometry)
13. eeb93f14810d WebKit bug 283846
14. 282be7075431 web.dev, content-visibility
15. 479f2673ceab MDN, content-visibility
16. b881dd50efce BCD contain-intrinsic-size.json
17. 1ef7ea9fbfbd BCD ContentVisibilityAutoStateChangeEvent.json
18. ce6744d7449f BCD overflow-anchor.json
19. 3c8bb00760d0 BCD api/Element.json (`beforematch_event`)
20. f1ac59166aa5, 1fefb542006c web-features hidden-until-found and content-visibility
21. 7329de309624 WebKit Features in Safari 18.0
22. 7c9846b29f69 Apple, security content of Safari 26.6.1
23. 4b7d89c8cfec WebKit bug 290577
24. 7f772e17118a WebKit bug 288312
25. 8f6d5babf3b4 WebKit bug 292380
26. fac33b386481 WebKit bug 277573
27. e33b436a42a4 WebKit Features in Safari 18.1
28. 312fc5fa7644 Chrome Developers, defer rendering heavy content
29. 2a662b693fde W3C CSSWG archive, 2021-03 thread
30. 84ff7cf86634 MDN, beforematch event

Note: the numbers in the findings above are the item numbers in this list.
