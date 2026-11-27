---
corpus: large-files
id: 06
slug: main-thread
prefix: THR
title: Main-thread scheduling and moving bytes between Rust and the webview
researched: 2026-11-27
confidence: medium
volatility: fast
status: active
keywords: [long tasks, INP, scheduler.yield, postTask, isInputPending, requestIdleCallback, MessageChannel, time slicing, cancellation, Web Worker, structured clone, transferable, SharedArrayBuffer, COOP, COEP, wasm, Tauri IPC, tauri::ipc::Response, Channel, custom protocol, WKWebView, WebView2]
---

# 06 · Main-thread scheduling and moving bytes between Rust and the webview

> The question is how to keep the main thread responsive while a 1–50 MB file is opened, parsed, typeset and searched, and how to move its bytes between the Rust shell and the webview without a cost that grows with the file. Answer in brief: on WebKit (macOS, and WebKitGTK on Linux) none of `scheduler.yield`, `scheduler.postTask`, `isInputPending` exists and `requestIdleCallback` is only a preview flag, so the portable slicer is a `MessageChannel` yield loop with a 5–8 ms deadline, a generation counter for cancellation and a priority queue of our own. Bytes should cross the IPC once, as a raw body, in bounded chunks. Text, parse and index are produced in a worker from transferred bytes, and the main thread receives only small, windowed results. Tauri's IPC speed on Windows is a real unknown (one anecdote, 10 MB in about 200 ms) and must be measured.

## TL;DR
- Budget: a task over 50 ms is a long task; INP is good at 200 ms or less, poor above 500 ms. For a desktop reader aim at slices of at most 8 ms on the main thread (half a 16 ms frame) and treat any single task over 50 ms as a bug. THR-01.
- WebKit has none of the Chromium scheduling API: `scheduler.yield`/`postTask` (Chrome 94/129, Firefox 142, Safari no), `isInputPending` (Chrome 87 only), and `requestIdleCallback` only behind a Safari preview flag. Build the yield on `MessageChannel`, as React's scheduler does (5 ms slice) and CodeMirror does for its fallback. THR-02, THR-03, THR-04.
- A string cannot be transferred, only copied; an `ArrayBuffer` transfers in constant time. So send bytes to a worker, decode and index there, and never post multi-MB strings back to the main thread. THR-06, THR-07.
- Tauri: return `tauri::ipc::Response`/raw bytes, not `Vec<u8>` through serde JSON; use a `Channel` or ranged chunks for streaming. Windows binary IPC has been reported at about 200 ms for 10 MB against about 5 ms on macOS, unmeasured by us. THR-09, THR-10, THR-11.
- Cross-origin isolation (SharedArrayBuffer) is configurable in Tauri through response headers, but gains little here and constrains every subresource; do not depend on it. THR-08.

## Recommendation for this setup

1. **Where things live.**
   - *Bytes*: owned by the Rust shell and, once, by the front end as a single `ArrayBuffer` (the document). Chunk the read (for example 1–4 MiB per call, an arbitrary starting point to be benchmarked on Windows) rather than one 50 MB body; this bounds each IPC task and allows progress and cancel. Never copy those bytes inside the front end; pass them to a worker with a transfer list (the sender loses them) or keep the master copy in the worker and send ranges.
   - *Text and offset map*: built in a worker (`TextDecoder` over the bytes, then the UTF-16↔byte map). The main thread asks for a window of text (for example the lines near the viewport) and gets a small string. Posting the whole decoded string to the main thread costs a full copy on each side (THR-06), so avoid it for files above about 100 KB.
   - *Parse*: micromark runs in the same worker over slices; the main thread receives block-level records (byte range, type, small HTML string) in batches of bounded size, not one tree for the file.
   - *Index* (line index, geometry inputs, search index): worker; the main thread holds only the geometry table for what is near the viewport.
2. **Slicing on the main thread.** One scheduler module (`yieldToMain`, `runSliced(task, {budgetMs, signal})`). Implementation order of preference: `scheduler.yield()` where present (Chromium WebView2, WebKitGTK is WebKit and lacks it), else a `MessageChannel` round trip (no 4 ms clamp). A slice checks `performance.now()` against a deadline of 5–8 ms (React uses 5 ms [THR-04]). Do not use `isInputPending` (Chrome-only, experimental; the deadline works without it).
3. **Cancellation.** Every long job takes an `AbortSignal` and a monotonically increasing document/width/generation number captured at start; after each yield it compares and drops itself if stale. A width change or a new open aborts the old queue and does not let it drain.
4. **Priority.** Our own three lanes: input-driven (visible blocks, selection, find hit), near-viewport (mount, typeset), background (panels, Shiki, KaTeX, images). A lane is drained only when the higher ones are empty, and background work is rate-limited by a budget per time window, the way CodeMirror caps background parsing (THR-05).
5. **IPC.** `#[tauri::command]` returning `tauri::ipc::Response` for reads; `InvokeBody::Raw` for writes; for files over a few MB a Rust-side chunked read (offset, length) so each call is one bounded task; a `Channel<&[u8]>`/custom protocol for streaming. Test each on Windows WebView2 before choosing chunk size (THR-10, THR-11).
6. **Wasm.** Not first. The cost is in the work done on the main thread, not in JS vs Rust speed, and a string handed to wasm is re-encoded to UTF-8 and copied (THR-12). If a Rust parse is ever wanted, run it in the Rust shell over the bytes (no copy at all, Tauri command) or in a worker over a transferred `ArrayBuffer`. This avoids a second Markdown parser, which the app's one-parser rule forbids anyway.

What I would not do: post a 5 MB string between threads; use `setTimeout(0)` as the yield in a loop (clamped); rely on `requestIdleCallback` for anything that must finish on macOS; use SharedArrayBuffer/COOP+COEP for the main document; send file bytes through `emit` events or JSON `Vec<u8>`.

**Rules for new features**
- No synchronous loop over document-sized input on the main thread may run longer than 8 ms without `await yieldToMain()` (lint: a loop over `bytes`/`text`/`blocks` must contain a yield or a `take(n)`).
- Every sliced job accepts an `AbortSignal` or a generation number and checks it after every yield; stale work returns without writing to the DOM.
- Never `postMessage` a string longer than 100 KB; send an `ArrayBuffer` with a transfer list, or request a range.
- Do not call `scheduler.*`, `isInputPending` or `requestIdleCallback` directly; use the scheduler module, which feature-detects.
- Shell commands that return file bytes return `tauri::ipc::Response` (never `Vec<u8>` or base64 in JSON) and take an offset and a length when the file may exceed 1 MB.
- A panel or transform must take byte ranges or a worker handle, never "the whole text"; parsing the whole file again for a panel is a review block.
- A new reader reports a long-task count (tasks over 50 ms) in its test on a 5 MB fixture, and it must be zero after the first slice.

## Findings

### THR-01 · Responsiveness budgets: 50 ms task, 16 ms frame, INP 200/500 ms  `[confirmed]`
web.dev's RAIL guide says "Process events in under 50ms" so a response lands inside 100 ms, and for animation "That's 16 ms per frame", leaving about 10 ms of script per frame [1]. INP: "An INP below or at 200 milliseconds means a page has good responsiveness"; above 500 ms is poor [2]. These are web-page field metrics at the 75th percentile; for a local desktop reader, a stricter target is reasonable: slices of at most 8 ms so that a 16 ms frame, an input and a paint fit. The 8 ms figure is my inference, not a source's number. The 50 ms long-task threshold is from the Long Tasks API and web.dev's long-task guidance [3].

### THR-02 · `scheduler.yield`, `postTask`: Chromium and Firefox only  `[confirmed]`
MDN's compat data (checked 2026-11-27) lists `scheduler.postTask` from Chrome 94, `scheduler.yield` from Chrome 129, both from Firefox 142, and Safari `version_added: false` for all three; WebKit-based views are therefore without them [4]. MDN's pages say "This feature is not Baseline because it does not work in some of the most widely-used browsers" [5]. Consequence: WKWebView on macOS and WebKitGTK on Linux need a fallback; only WebView2 (Chromium) has the API. A feature-detected wrapper is simplest; `yield()` also keeps the continuation ahead of queued tasks on Chromium, which a plain fallback does not [6] (the Chrome page was fetched in a translated version; the continuation-priority point is [likely] for English wording).

### THR-03 · `isInputPending` is Chrome-only and experimental  `[confirmed]`
BCD lists `Scheduling.isInputPending` as Chrome 87 and Safari `false`; MDN marks it "Experimental: This is an experimental technology" [7][8]. Do not build on it. A fixed deadline per slice gives the same worst-case latency without the API.

### THR-04 · MessageChannel is the standard yield fallback; React's slice is 5 ms  `[confirmed]`
React's scheduler comment says "We prefer MessageChannel because of the 4ms setTimeout clamping", and its feature flags set `frameYieldMs = 5` with timeouts of 250 ms, 5000 ms and 10000 ms for user-blocking, normal and low priority [9][10]. So the model to copy is: a slice deadline of 5 ms, a message-port yield, and priority classes with expiry times so low-priority work is not starved forever. `setTimeout(0)` nested more than five deep is clamped to 4 ms in browsers (React's comment confirms the clamp; the "five deep" detail is from the HTML spec, not re-read here, [likely]).

### THR-05 · CodeMirror's background-work budget and its no-`requestIdleCallback` fallback  `[confirmed]`
In `@codemirror/language` the work constants are: `Apply = 20` ("Milliseconds of work time to perform immediately for a state doc change"), `MinSlice = 25` in an idle callback, `Slice = 100` ("Amount of work time to perform in pseudo-thread when idle callbacks aren't supported"), `MinPause = 100`, `MaxPause = 500`, and `ChunkBudget = 3000` per `ChunkTime = 30000` ms, with a `ChangeBonus = 50` for active editors [11]. Two lessons: (1) foreground work after an edit is capped at 20 ms and the rest is deferred; (2) background parsing has a total budget (3 s per 30 s, 10% duty), which stops it from monopolising a long session. The Slice of 100 ms is larger than the 8 ms I recommend, because CodeMirror is parsing in a pause between inputs; for us the slice is better kept small. The marked `requestIdleCallback` use in that file also shows that the pseudo-thread path is what Safari takes. The same file also checks `isInputPending` where it exists, so CodeMirror does use it; "do not use it" (THR-03) is this chapter's advice for a WKWebView-first app, not CodeMirror's practice.

### THR-06 · A string cannot be transferred; it is copied on both sides; ArrayBuffers transfer in constant time  `[confirmed]`
MDN's transferables page lists the transferable types; strings are not among them [12]. A Bun engineering post states the browser-side mechanism: "This means copying every byte of your string into a new buffer, then deserializing it on the other side" (the post is about Bun/Node, where it measures a fix, but the structured-clone statement is general) [13]. Surma's benchmark (Chrome, Firefox, Safari desktop, objects not strings): "Transferring an ArrayBuffer is extremely fast and independent of the size of the ArrayBuffer", and the transfer time of a clone is proportional to the JSON size, relevant above 100 KiB, with the verdict "you can postMessage() objects up to 100KiB and stay within your 100ms response budget" [14]. I did not find a primary benchmark with milliseconds for a 1–50 MB string on WebKit (see THR-14). A conservative estimate: a clone costs at least one memcpy-class pass plus a UTF-16 allocation on each end, about 2 bytes per code unit, so 10 MB of text is 20 MB on each side; that is a [likely] inference, not a measurement.

### THR-07 · Decode in a worker from transferred bytes  `[likely]`
`TextEncoder.encodeInto` is documented as "potentially more performant than the encode() method" when the target is a Wasm heap view [15]; `TextDecoder` is available in workers (standard; not re-verified on a page here). The design that follows from THR-06: shell bytes arrive on the main thread as an `ArrayBuffer`, are transferred to the worker (a constant-time operation), and the worker decodes, builds the offset map and answers range queries. Cost: one decode (linear, a worker, so off the main thread) rather than a main-thread decode plus a clone. Worker start-up cost and module-worker support in WebKit were not verified (BCD's `Worker` record shows Safari 4 for plain workers [16]; module workers in Safari 15 is my recollection, `[unverified]`). A worker started once at open and kept is cheaper than one per task.

### THR-08 · SharedArrayBuffer needs COOP+COEP; Tauri can set the headers, but it constrains everything  `[confirmed]`
Tauri's `app.security.headers` documentation shows `"Cross-Origin-Opener-Policy": "same-origin"` and `"Cross-Origin-Embedder-Policy": "require-corp"` and notes they "allow for the use of SharedArrayBuffer" [17]. With `require-corp`, every subresource (images, fonts, iframes, blob and data URLs used for PDFs, mail and office viewers) must opt in with CORP or be same-origin, so it risks breaking embedded content for a gain the design does not need (a transferred buffer is already constant-time, THR-06). Whether headers also apply to custom-protocol responses on each platform was not verified (`[absence]` below, THR-13). Verdict: no SAB; the worker owns the data.

### THR-09 · Tauri: JSON by default, `ipc::Response` for raw bytes  `[confirmed]`
Tauri's docs say return values that implement `Serialize` "are serialized to JSON when the response is sent to the frontend", and "This can slow down your application if you try to return a large data such as a file or a download HTTP response. To return array buffers in an optimized way, use tauri::ipc::Response" [18]. The IPC chapter states the underlying "JSON-RPC like protocol" [19]. For requests, "Accessing Raw Request" with `tauri::ipc::Request` exposes the raw body and headers [18]. A command returning `Vec<u8>` directly goes through JSON and becomes a number array; always wrap in `Response`. Async commands are "preferred in Tauri to perform heavy work in a manner that doesn't result in UI freezes" [18].

### THR-10 · The raw path is a `fetch` to a custom protocol; Windows and macOS differ  `[confirmed]`
Tauri 2.9.2's `ipc-protocol.js` sends every invoke as `fetch(convertFileSrc(cmd, 'ipc'), {method:'POST', body: data})`, reads the response as JSON, text or `arrayBuffer()`, and on failure logs "IPC custom protocol failed, Tauri will now use the postMessage interface instead" and falls back to `window.ipc.postMessage` [20]. Android is excluded from the custom protocol path. In the channel code, comments record "8192 byte JSON payload runs roughly 2x faster through eval than through fetch on WebView2 v135" and "1024 byte payload runs roughly 30% faster through eval than through fetch on macOS", i.e. small messages bypass fetch, large ones use it [21]. The wry tracking issue says Windows "can only work receive as string" for `postMessage`-style paths, while macOS and Linux can take other JS values, which is why the fetch route exists [22]. Consequence: per-call fixed overhead is a fetch round trip; use few large calls, not many small ones, but not one huge one either.

### THR-11 · Throughput: one anecdote, 10 MB in about 200 ms on Windows vs 5 ms on macOS  `[unverified]`
A Tauri maintainer in a GitHub discussion: a Discord user's "non-scientific benchmark for the binary ipc" gave "~5ms on macOS but ~200ms on Windows", "for 10mb of data", and the maintainer notes this "100% used to be better" [23]. The discussion also says only WebView2 supports shared memory and that users reported it as "weirdly slow", and there is no cross-platform zero-copy path [23]. A second thread recommends registering a custom protocol with `register_uri_scheme_protocol` "if you really want to maximize the performance", and that protocol handlers answer once per request (one commenter infers from a page that streaming is not supported by WebView2 on Windows, "seems to indicate" being his wording; a maintainer in the same thread says Tauri v2 added "an async counterpart to the register_uri_scheme system that allows you to call a callback as many times as you want with additional data", which allows streaming, though the commenter then doubts that `respond()` can be called more than once) [24]. Streaming over a custom protocol on WebView2 is therefore disputed and `[unverified]`. I found no current, reproducible MB/s table for `invoke` raw, `Channel`, and a custom protocol on any of the three platforms. A 200 ms cost for 10 MB would be 1 s for 50 MB if linear, which is a big IPC stall only if it blocks the main thread; the response body is read via `arrayBuffer()` asynchronously so the stall is largely off-thread, but the version-dependent number must be measured with a local harness at 1, 5, 10, 50 MB on all three engines before choosing a chunk size. The conduit project and other third-party numbers are self-reported and not used.

### THR-12 · Wasm string boundary: re-encode and copy  `[confirmed]`
The wasm-bindgen reference says a JS string passed to Rust is converted with TextEncoder from UTF-16 to UTF-8 and copied into linear memory, and `JsString` avoids the copy by leaving the string in JS [25]; MDN says `encodeInto` is "potentially more performant than the encode() method" into a Wasm heap [15]. So a wasm Markdown parser costs one encode (or none, if given bytes, which the app already holds) plus a copy to linear memory, and returned strings are copied back. For this app the bytes are the document, so a wasm parser over the byte buffer would avoid the string, but it would still have to be fed via a worker and a transferred buffer to stay off the main thread, and the one-parser rule makes a second Markdown implementation unwelcome. I found no benchmark of wasm vs micromark (`[absence]`, THR-14).

### THR-13 · Nothing found: Tauri COOP/COEP on custom-protocol responses per platform  `[absence]`
No page found stating whether `app.security.headers` apply to custom-protocol and `ipc://` responses on WKWebView and WebKitGTK, or whether `crossOriginIsolated` is true there; WebKit bug 229559 appeared in search results as "resolved fixed" for SAB with COOP/COEP but was not fetched.
**Searched:** web search "Tauri COOP COEP SharedArrayBuffer cross-origin isolated WKWebView"; v2.tauri.app/security/http-headers (read, shows config only).

### THR-14 · Nothing found: ms for 1–50 MB string clone, worker spin-up and wasm-vs-JS Markdown on WebKit  `[absence]`
No primary benchmark with milliseconds for structured-cloning multi-MB strings in WebKit/WebView2, for worker start-up, or wasm vs JS Markdown parsing. A community benchmark repo claimed `postMessage(string)` beats encode-transfer-decode by 60–87%, but its page could not be fetched and it is not used. Needs a local micro-benchmark in the real WKWebView.
**Searched:** web search "structured clone vs transfer ArrayBuffer postMessage large string 10MB benchmark worker TextDecoder"; web search "wasm-bindgen passing strings copy cost benchmark vs JS parser markdown"; gitee benchmark page (fetch failed).

### THR-15 · `requestIdleCallback` is not shipped in Safari  `[confirmed]`
BCD for `Window.requestIdleCallback`: Chrome 47, Firefox 55, Safari `"version_added": "preview"` with a preference flag named `requestIdleCallback`; iOS mirrors it [26]. So on WKWebView it is absent unless the flag is on; CodeMirror's `Slice`/pseudo-thread fallback is the precedent (THR-05). The app's "idle queue" today probably depends on a fallback; the lead should check that it does not assume `requestIdleCallback` on macOS.

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| `scheduler.yield()` only | Chromium/WebView2 only | Low | Absent on macOS and Linux | Use where present, with fallback |
| `MessageChannel` yield + 5–8 ms deadline | All three engines | Low; own scheduler module | None known; no clamping | Default |
| `requestIdleCallback` | Not shipped in Safari | Low | Silent no-op or missing on WebKit | Only as progressive hint |
| `isInputPending` | Chrome only | Low | Experimental | No |
| Worker with transferred `ArrayBuffer` | Text, index and parse off-thread | Medium (message protocol) | Cancelling and stale results | Yes, for decode, parse, index |
| Post decoded string to main | Simple | Copy per MB on both sides | Main-thread stall on big files | Only under ~100 KB |
| SharedArrayBuffer + COOP/COEP | Zero-copy, needs Atomics | Headers break subresources | High | No |
| Wasm parser (new) | Duplicates parser | High | Boundary copies; second parser | Not now |
| Raw `ipc::Response`, chunked reads | Matches current raw IPC | Low | Windows speed unknown | Yes, measure |
| `Channel` streaming | Good for progress | Medium | Per-message overhead | For long streams |
| Custom protocol with ranges | Best for random access | Medium (Rust handler) | One user infers no streaming on WebView2; a maintainer says Tauri v2's async scheme API allows streaming (disputed) | Candidate for large files, after measuring |

## Open questions
- IPC throughput per platform for invoke raw, Channel and custom protocol at 1, 5, 10, 50 MB (in a Tauri 2.12 build). Would be settled by a local harness; THR-11 is only an anecdote.
- Structured-clone and transfer times in WKWebView and WebKitGTK; worker start-up cost; module worker support there (verify with a test page and BCD `Worker` options).
- Whether WebKitGTK's version in the target Linux distros (SteamOS) ships `MessageChannel` timing the same; assumed.
- Whether `security.headers` reach custom-protocol responses (THR-13).
- Whether Tauri 2.12 changed the 8192/1024-byte direct-execute thresholds quoted from 2.9.2 (THR-10).

## Cross-links
- 03 (parsing): THR-04/05 slice and budget design; the parse worker design in the recommendation.
- 04 (dom-rendering): the mount queue and idle passes should use the scheduler lanes (THR-02, THR-15).
- 05 (typesetting): budgeted per-slice typesetting and generation-number cancellation on width changes.
- 08 (search-highlight): worker plus terminate for regexes; the worker owns the text (THR-07).
- 09 (buffers-memory): bytes as the document, one ArrayBuffer, transfer lists (THR-06).
- 10 (guardrails): the lint rules in "Rules for new features" and the long-task count test (THR-01).

## Sources
1. RAIL model, web.dev — https://web.dev/articles/rail (accessed 2026-11-27) — "Process events in under 50ms"; "That's 16 ms per frame".
2. Interaction to Next Paint, web.dev — https://web.dev/articles/inp (accessed 2026-11-27) — INP 200/500 ms thresholds.
3. Optimize long tasks, web.dev — https://web.dev/articles/optimize-long-tasks (accessed 2026-11-27) — yielding guidance; the page was saved but the 50 ms long-task line is stated from the Long Tasks API, not quoted.
4. MDN browser-compat-data, api/Scheduler.json — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Scheduler.json (accessed 2026-11-27) — Chrome 94/129, Firefox 142, Safari false.
5. MDN, Scheduler.yield — https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield (accessed 2026-11-27) — "This feature is not Baseline because it does not work in some of the most widely-used browsers."
6. Chrome for Developers, Use scheduler.yield() — https://developer.chrome.com/blog/use-scheduler-yield (accessed 2026-11-27) — returned in translation; continuation priority.
7. MDN browser-compat-data, api/Scheduling.json — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Scheduling.json (accessed 2026-11-27) — isInputPending Chrome 87, Safari false.
8. MDN, Scheduling.isInputPending — https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending (accessed 2026-11-27) — "Experimental: This is an experimental technology".
9. React, scheduler source — https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/forks/Scheduler.js (accessed 2026-11-27) — "We prefer MessageChannel because of the 4ms setTimeout clamping."
10. React, scheduler feature flags — https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/SchedulerFeatureFlags.js (accessed 2026-11-27) — `frameYieldMs = 5`.
11. CodeMirror, language.ts — https://raw.githubusercontent.com/codemirror/language/main/src/language.ts (accessed 2026-11-27) — Work constants.
12. MDN, Transferable objects — https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects (accessed 2026-11-27) — list of transferables.
13. Bun, how we made postMessage string 500x faster (secondary, Bun-specific) — https://bun.com/blog/how-we-made-postMessage-string-500x-faster (accessed 2026-11-27) — "This means copying every byte of your string into a new buffer, then deserializing it on the other side."
14. Surma, Is postMessage slow? (2019, practitioner) — https://surma.dev/things/is-postmessage-slow/ (accessed 2026-11-27) — "Transferring an ArrayBuffer is extremely fast and independent of the size of the ArrayBuffer"; 100 KiB rule.
15. MDN, TextEncoder.encodeInto — https://developer.mozilla.org/docs/Web/API/TextEncoder/encodeInto (accessed 2026-11-27) — "This is potentially more performant than the encode() method".
16. MDN browser-compat-data, api/Worker.json — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Worker.json (accessed 2026-11-27) — Safari 4.
17. Tauri, HTTP headers — https://v2.tauri.app/security/http-headers/ (accessed 2026-11-27) — COOP/COEP config, "allow for the use of SharedArrayBuffer".
18. Tauri, Calling Rust from the frontend — https://v2.tauri.app/develop/calling-rust/ (accessed 2026-11-27) — "This can slow down your application if you try to return a large data such as a file or a download HTTP response."
19. Tauri, Inter-process communication — https://v2.tauri.app/concept/inter-process-communication/ (accessed 2026-11-27) — "JSON-RPC like protocol".
20. tauri 2.9.2 ipc-protocol.js — https://docs.rs/crate/tauri/2.9.2/source/scripts/ipc-protocol.js (accessed 2026-11-27) — fetch-based IPC and postMessage fallback.
21. tauri 2.9.2 channel.rs — https://docs.rs/crate/tauri/2.9.2/source/src/ipc/channel.rs (accessed 2026-11-27) — "8192 byte JSON payload runs roughly 2x faster through eval than through fetch on WebView2 v135".
22. wry issue 767, IPC techniques — https://github.com/tauri-apps/wry/issues/767 (accessed 2026-11-27) — "But windows can only work receive as string."
23. Tauri discussion 11915 — https://github.com/orgs/tauri-apps/discussions/11915 (accessed 2026-11-27) — "~5ms on macOS but ~200ms on Windows".
24. Tauri discussion 5690 — https://github.com/tauri-apps/tauri/discussions/5690 (accessed 2026-11-27) — custom protocol recommendation and single-response limit.
25. wasm-bindgen reference, str — https://wasm-bindgen.github.io/wasm-bindgen/reference/types/str.html (accessed 2026-11-27) — TextEncoder copy, JsString avoids it.
26. MDN browser-compat-data, api/Window.json — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Window.json (accessed 2026-11-27) — requestIdleCallback: Chrome 47, Firefox 55, Safari preview flag.
