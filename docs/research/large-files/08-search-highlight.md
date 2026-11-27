---
corpus: large-files
id: 08
slug: search-highlight
prefix: SRC
title: Search, find, regex and syntax colouring on big input
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [find in page, regex, ReDoS, RE2, re2js, ripgrep, Shiki, tokenizeMaxLineLength, CSS Custom Highlight API, hidden until-found, content-visibility, maxTokenizationLineLength]
---

# 08 · Search, find, regex and syntax colouring on big input

> Question (Q-09): how to bound find, regex search and colouring on 1–50 MB inputs. Answer in brief: search the document model (the bytes or line index), never the DOM; run user-typed patterns off the main thread in a worker that can be terminated on a deadline (the JS engine cannot be interrupted, and no linear-time JS engine is shipped); cap matches and line lengths; cancel stale searches by generation number; paint matches with the CSS Custom Highlight API instead of wrapping text; and give Shiki an explicit `tokenizeMaxLineLength` (its default is no limit) on top of its 500 ms per-line time limit.

## TL;DR
- Every mature editor searches its model, not the DOM, and caps results: VS Code's find widget stops at 19,999 matches, its model search defaults to 999, its workspace search to 20,000 [3].
- V8's linear-time regex engine is still behind flags and, by its authors' account, much slower on ordinary patterns; do not plan on it. A worker with a deadline is the practical ReDoS defence; `re2js` (pure JS, linear time) or the Rust `regex` crate in the shell are the linear-time options [5][6][7].
- Shiki has two limits already: `tokenizeTimeLimit` (default 500 ms per line) and `tokenizeMaxLineLength` (default 0, meaning none). Setting the second is a one-line change [11].
- VS Code skips tokenising lines over 20,000 characters (`editor.maxTokenizationLineLength`) [13]; a good default for this app too.
- The CSS Custom Highlight API (WebKit 17.2+, Baseline 2025) paints thousands of ranges without touching the DOM; browser find over lazily rendered content works in Safari 26.2+ only for `hidden="until-found"`, and `content-visibility: auto` skipped content is not findable in Safari 18 to 25 (BCD marks it partial, webkit.org/b/283846) and is findable from Safari 26 [16][17][18][15]. On older WKWebView, intercepting Cmd-F and using the app's own search is the primary route.

## Recommendation for this setup

1. **Search over the model, in the shell or a worker.** For files at or above 1 MB, the find and search panels should not run `RegExp` on the main thread. Order of preference: (a) the Rust shell with the `regex` crate over the bytes (worst case O(m·n), no backreferences or lookaround; byte offsets match the app's provenance model); (b) a dedicated search worker running a JS `RegExp` over a chunk, terminated if no answer comes in a deadline (suggest 1–2 s for the first match, restart on the next keystroke); (c) `re2js` in the worker for patterns the user types, falling back to the native `RegExp` only for patterns that the linear engine rejects and only under the deadline. Literal (non-regex) searches never need the regex path: use `indexOf` or `memchr`-style scanning.
2. **Bound the input as well as the time.** Search in chunks of a few hundred KB to a few MB (the worker posts a batch, then yields), keep a match cap (use 20,000 like VS Code, show "20,000+"), and cap the preview text per match (VS Code keeps 10,000 characters per line of preview and 100 match lines by default [SRC-05]). Count matches lazily: compute the current and next match, not all.
3. **Stale-search cancellation.** Every query bumps a generation counter; the worker checks it between chunks and the front end drops replies from old generations. Debounce typed queries (150–250 ms; this figure is my inference, not a sourced default). Terminating the worker is the only way to stop a catastrophic pattern, so budget for re-creating it.
4. **Paint matches with `CSS.highlights`.** Build `Range` objects only for matches that intersect the mounted DOM (the visible slice plus margin), register them in a `Highlight`, and style with `::highlight(name)`. Do not wrap matches in `<mark>` over a long page: it changes the DOM that the provenance attributes describe. In source view CodeMirror 6 already draws matches as decorations over its viewport only, so keep using its search state for that view.
5. **In-page browser find** (Cmd/Ctrl-F in the webview) only sees what is in the DOM. With the progressive mount and any virtualised "lines" reading, text off screen is not findable. Either route find to the app's own search (intercept the shortcut), or keep unmounted blocks findable with `content-visibility: auto` on blocks (cheap, and findable only from Safari 26; on Safari 18 to 25 skipped content is not findable, so there the Cmd-F interception is the primary route) rather than removing them. Use `hidden="until-found"` only for collapsed sections, and expect it only from Safari 26.2 [14][15].
6. **Colouring.** Keep Shiki in the worker. Pass `tokenizeMaxLineLength: 20000` (match VS Code) and keep `tokenizeTimeLimit` at or below its 500 ms default; for blocks above a size cap (suggest 200–500 lines or ~100 KB per fenced block) show plain text; time-slice by block, nearest the viewport first; cache by text (already done). Choose the Oniguruma-wasm engine for fidelity, the JS-regex engine if bundle size matters; neither is a defence against pathological lines, only the two limits are [10][11].
7. Do NOT: rely on V8's `l` flag; wrap matches in DOM nodes; run a user-typed pattern on the main thread; retain per-match DOM or `Range` objects for matches that are not mounted.

**Rules for new features**
- No `new RegExp(userInput)` or `.match/.exec/.replace` with a user-supplied pattern on the main thread; it goes through the search worker (with deadline and terminate) or the shell.
- Every search or filter has a match cap (default 20,000) and reports "capped" in its result type.
- Every long-running scan takes a generation or `AbortSignal` and checks it at least once per chunk (chunk at most a few MB or ~16 ms of work).
- No search reads the DOM text (`textContent`, `innerText`) of the page; it reads the bytes or the line index.
- Matches are painted with `CSS.highlights`; a feature may not wrap text in `<mark>` or `<span>` over more than the mounted slice.
- Every call to Shiki passes `tokenizeMaxLineLength` (default 20,000), and blocks over the size cap are rendered plain.
- A regex that runs over file content gets a test with a pathological pattern and input (e.g. `(a+)+$` on 50 KB of `a` plus `!`) that must return or cancel within the deadline.

## Findings

### SRC-01 · Editors search the model, and cap results  `[confirmed]`
VS Code's find model defines `export const MATCHES_LIMIT = 19999;` and calls `this._findMatches(findScopes, false, MATCHES_LIMIT)` [1]. The text model's `findMatches` takes `limitResultCount: number = LIMIT_FIND_COUNT` with `const LIMIT_FIND_COUNT = 999;` [2]. The workspace search service has `export const DEFAULT_MAX_SEARCH_RESULTS = 20000;` [3]. None of these read the DOM. CodeMirror 6's view describes its viewport as the DOM-backed region and documents positions "not covered by the visible viewport's DOM structure" [4], which is why its search works over the state document and only decorates what is drawn (the search-over-state point is my inference from the API shape; I did not read the `@codemirror/search` source).

### SRC-02 · V8's linear engine: flag-only, slow on common patterns  `[confirmed]`
The V8 blog says V8 "ships with a new experimental non-backtracking RegExp engine" (v8.8) that "guarantees execution in linear time with respect to the size of the subject string", available "behind the feature flags"; the `l` flag is non-standard and RegExps built with the flag "are always eagerly executed with the new engine"; it stays experimental "because Irregexp is orders of magnitude faster than the new engine on most common patterns" [5]. The post is from 2021; I did not find a later page saying it shipped to stable Chrome or to JavaScriptCore (see SRC-12). WebKit's YARR is a backtracking engine; I did not find a linear mode in it.

### SRC-03 · Linear-time options available to JS and Rust  `[confirmed]`
The Rust `regex` crate states that "all searches take worst case O(m * n) time" (m pattern, n haystack) [6]. `re2js` is "the JavaScript port of RE2, a regular expression engine that provides linear time matching" and guarantees O(n) [7]. The trade is features: the 2024 paper on linear matching of JS regexes [8] notes that backtracking engines "suffer from algorithmic blowups". So a find field that offers a "regex" toggle can document "no backreferences or lookaround" if it uses RE2-style engines, and many users will not notice. Speed of `re2js` versus V8's native Irregexp on ordinary patterns: not measured here [absence of a benchmark: Searched: re2js README, V8 blog].

### SRC-04 · ripgrep: buffer the search, stream the file  `[confirmed]`
ripgrep's author explains that "all search tools find a way to search a big buffer of bytes all at once" rather than line by line, and that ripgrep, GNU grep and git grep "can use its incremental approach on any file or stream" with a constant-sized buffer, while tools that memory-map the whole file cannot [9]. The same post has a section on literal optimisations (prefilters on required literals, `memchr`-style scanning) and benchmarks where a memory map is not faster than reading [9]. For this app: the shell should read in chunks (or from the bytes it already holds) and run the `regex` crate with its literal prefilters; the front end never holds the pattern's cost. VS Code's workspace search passes include patterns "into ripgrep" [3], i.e. the editor delegates multi-file search to a native process, not to JS.

### SRC-05 · VS Code result and preview limits  `[confirmed]`
Beyond the 20,000 results of SRC-01 [3], the search types set `DEFAULT_TEXT_SEARCH_PREVIEW_OPTIONS = { matchLines: 100, charsPerLine: 10000 }` [3], and results carry a `limitHit` flag, so the UI can say a cap was hit [3]. Debounce and cancellation specifics in the find widget were not read here (see Open questions).

### SRC-06 · Shiki engines  `[confirmed]`
Shiki's docs say TextMate grammars "assume that Oniguruma ... will be used", and "we compile Oniguruma to WebAssembly"; its JavaScript engine "uses JavaScript's native RegExp" via Oniguruma-To-ES and "is also faster for some languages" [10]. The JS engine is strict by default and throws on a pattern it cannot convert unless `forgiving` is set [10]. With the JS engine, a TextMate pattern becomes a backtracking `RegExp`, so a long minified line can blow up in V8; with Oniguruma-wasm it can blow up in Oniguruma. Either way the work sits in the worker, which is where this app puts it.

### SRC-07 · Shiki has a line-length cap and a time limit  `[confirmed]`
The `@shikijs/types` typings declare `tokenizeMaxLineLength?: number;` with the comment "Lines above this length will not be tokenized for performance reasons." and "@default 0 (no limit)", and `tokenizeTimeLimit?: number;` described as "Time limit in milliseconds for tokenizing a single line." with "@default 500 (0.5s)" [11]. Both are passed through `CodeToHastOptionsCommon` [11]. So the default allows each line up to 0.5 s; a 10,000-line minified file of long lines could cost up to 5,000 s in the worst case. Shiki's performance guide covers loading languages lazily and reusing a highlighter [12] (the guide's content was fetched, not quoted).

### SRC-08 · VS Code's tokenisation cap  `[confirmed]`
VS Code's editor configuration schema defines `'editor.maxTokenizationLineLength'` with `default: 20_000` and the description "Lines above this length will not be tokenized for performance reasons" [13]. Theia lowered the default to 400 per an issue thread (secondary, from a search snippet; not saved). VS Code tokenises incrementally on the main thread with a time budget, and has moved parts to a worker; I did not verify the current implementation.

### SRC-09 · Browser find vs lazy content  `[confirmed]` (until-found) / `[confirmed]` (content-visibility: auto from Safari 26 only)
MDN says that in the hidden until found state, the element is hidden but its content "will be accessible to the browser's "Find in page" feature or to fragment navigation", and that if "the element in the hidden until found state has a display value of none, contents, or inline, then the element will not be revealed" [14]. WebKit's blog says "Safari 26.2 adds support for the hidden=until-found attribute" and fires `beforematch` before reveal [15]. MDN's compatibility data (via BCD) lists `content-visibility` from Chrome 85 and Safari 18 [16]. Verification correction: `content-visibility: auto` was claimed searchable from Safari 18, which is wrong. BCD [16] marks Safari 18 to 25 `auto` as partial because skipped content is not findable via find-in-page (webkit.org/b/283846), with full support from Safari 26, which matches Apple's Safari 26 fix described in the DOM-rendering vector (04, DOM-02). Chromium finds skipped content by design.

### SRC-10 · CSS Custom Highlight API  `[confirmed]`
MDN: the API "provides a mechanism for styling arbitrary text ranges on a document by using JavaScript to create the ranges, and CSS to style them", and you "can programmatically create text ranges and highlight them without affecting the DOM structure in the page" [17]. It is marked "Baseline 2025", working "Since June 2025" [17]. BCD gives Safari `17.2` for the `Highlight` interface [18]. Chrome's first version for the Highlight API is 105 (BCD, confirmed by the verifier [18]). Performance of tens of thousands of ranges is not documented in a primary source I found; keep registered ranges to the mounted slice. A highlight range lives over live DOM nodes: if a block is replaced, its ranges go stale and must be rebuilt.

### SRC-11 · Safari status of until-found is recent and bugged  `[likely]`
A search of WebKit Bugzilla and release notes found a VoiceOver bug (310623) for content revealed via `hidden="until-found"` in accordions, and a text-fragment bug (296085) with no outcome read. Safari 26.2 notes are the first support [15]. Treat as unreliable on older macOS webviews: the WebKit version in the system WKWebView follows the macOS version, which this app does not control.

### SRC-12 · No current status for V8's `l` flag or a YARR linear mode  `[absence]`
Looked for a statement that the non-backtracking engine reached stable or that JavaScriptCore has an equivalent. Found only the 2021 post.
**Searched:** v8.dev blog "non-backtracking-regexp" (read in full); web search "V8 experimental regexp engine l flag status" folded into the general search on the regex crate and RE2 (no newer V8 page returned).

### SRC-13 · No sourced default for debounce  `[absence]`
No primary source read gives VS Code's find-widget debounce or a cancellation design.
**Searched:** `findModel.ts` and `textModelSearch.ts` on GitHub (read for limits only, not searched for debounce text); web search on Shiki and VS Code limits.

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Native `RegExp` on main thread | Current state | None | A pattern like `(a+)+$` freezes the window | Reject above a small input size |
| Worker + terminate on deadline | High; no new dependency | Message passing; chunk copy or transfer | Worker restart on each kill | Do first |
| `re2js` in worker | Good for a "safe regex" mode | New dependency (allow-list, licence check); slower than Irregexp (unmeasured) | No lookaround or backreference | Option for user-typed patterns |
| Rust `regex` in the shell | Best for 5–50 MB and multi-file; byte offsets | New Tauri command and IPC for results | Syntax differs from JS | Do for large files |
| V8 `l` flag | Not available in a stable webview | n/a | Flag-only, slow | Reject |
| `<mark>` wrapping | Breaks provenance, grows DOM | O(matches) DOM | Slow, stale | Reject |
| `CSS.highlights` | High; Safari 17.2+ | Ranges for the mounted slice | Ranges stale after DOM replacement | Do |
| Shiki with line cap and time limit | Already in place | One option | None | Do |
| Tree-sitter / Lezer incremental colouring | Strong for the source view (CodeMirror 6 already uses Lezer) | Heavier for fenced blocks in the page | Grammar coverage | Keep Lezer in Source; do not add for the page |

## Open questions
- Does VS Code's current find widget debounce and cancel stale searches, and what are the values? Settle by reading `findController.ts` and `findModel.ts`.
- Chrome and WebView2 first version for the Highlight API (read the saved BCD file `api/Highlight.json`), and large-range performance.
- Does `content-visibility: auto` content stay findable in WebKit as in Chromium, and does Safari reveal it on a hit? Settle with a test in the real WKWebView (vector 04).
- Speed of `re2js` on this app's usual patterns versus Irregexp; settle with a benchmark on a 5 MB log.
- The chunk size and deadline numbers above are inferences; measure.

## Cross-links
- 04 (dom-rendering): SRC-09 and SRC-10 on find over lazy content and highlight ranges.
- 06 (main-thread): worker termination, generation counters, chunked yielding (SRC-03 rules).
- 07 (data-viewers): ripgrep-style chunked scanning for logs (SRC-04).
- 01 (code-editors): VS Code limits and the CodeMirror viewport (SRC-01, SRC-08).
- 03 (parsing): Lezer incremental parsing as a colouring route.
- 10 (guardrails): the pathological-pattern test in the rules, and lint on `new RegExp(` with non-literal arguments.
- 11 (IPC): returning match lists from a Rust search over the raw channel.

## Sources
1. VS Code `findModel.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/contrib/find/browser/findModel.ts (accessed 2026-11-27) — `MATCHES_LIMIT = 19999`.
2. VS Code `textModel.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/model/textModel.ts (accessed 2026-11-27) — `LIMIT_FIND_COUNT = 999`.
3. VS Code workspace `search.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/search/common/search.ts (accessed 2026-11-27) — `DEFAULT_MAX_SEARCH_RESULTS = 20000`, preview options, `limitHit`, ripgrep.
4. CodeMirror reference manual — https://codemirror.net/docs/ref/ (accessed 2026-11-27) — viewport text.
5. V8 blog, "An additional non-backtracking RegExp engine" — https://v8.dev/blog/non-backtracking-regexp (accessed 2026-11-27).
6. rust-lang/regex README — https://github.com/rust-lang/regex (accessed 2026-11-27).
7. re2js README — https://github.com/le0pard/re2js (accessed 2026-11-27).
8. "Linear Matching of JavaScript Regular Expressions" (arXiv 2311.17620v2) — https://arxiv.org/html/2311.17620v2 (accessed 2026-11-27).
9. Andrew Gallant, "ripgrep is faster than {grep, ag, git grep, ucg, pt, sift}" — https://burntsushi.net/ripgrep/ (accessed 2026-11-27); secondary to the tool, primary for its author's design notes.
10. Shiki, regex engines guide — https://shiki.style/guide/regex-engines (accessed 2026-11-27).
11. `@shikijs/types` typings — https://cdn.jsdelivr.net/npm/@shikijs/types/dist/index.d.mts (accessed 2026-11-27) — current published version, not pinned.
12. Shiki, best performance guide — https://shiki.style/guide/best-performance (accessed 2026-11-27).
13. VS Code `editorConfigurationSchema.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorConfigurationSchema.ts (accessed 2026-11-27).
14. MDN, `hidden` global attribute — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden (accessed 2026-11-27).
15. WebKit, "WebKit Features for Safari 26.2" — https://webkit.org/?p=17640 (accessed 2026-11-27).
16. MDN browser-compat-data, `content-visibility` — https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/content-visibility.json (accessed 2026-11-27).
17. MDN, CSS Custom Highlight API — https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API (accessed 2026-11-27).
18. MDN browser-compat-data, `Highlight` — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Highlight.json (accessed 2026-11-27).
