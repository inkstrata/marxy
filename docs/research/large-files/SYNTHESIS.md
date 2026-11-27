---
corpus: large-files
updated: 2026-11-27
status: active
---

# Synthesis: Large files in a desktop reader

## Bottom line

No comparable app renders a 1–5 MB Markdown file as one whole, fully typeset page, and that is what Marxy does
below its 5 MB lines threshold (MDA-01). Every app that stays fast on big files does the same three things: it
decides once, at open, how heavy the file is and turns whole-document features down accordingly (EDS-01, EDS-03); it
keeps the expensive work proportional to what is on screen, with an estimated-then-measured height table standing in
for the rest (EDS-04, MDA-06, DOM-03); and it moves whole-file work (parse, index, search) off the main thread or into
cancellable slices, sending back compact tables rather than trees or big strings (PRS-08, THR-06, SRC-01, DAT-01).
For Marxy that means: a scale class at open; block-windowed mounting and distance-bounded typesetting for 1–5 MB
Markdown, built on the geometry table already in flight; the parse in a worker; one scheduler; search over the model;
lazy derived data; and guardrails that count work rather than time it. Two facts would change this: a per-node DOM
cost in WKWebView low enough that `content-visibility` alone holds a 5 MB page (not measured, DOM-08), or a worker
round trip for the tree too costly to beat the main-thread slices (not measured, PRS-10).

## Answers to the brief

- **Q-01** · answered · EDS-01, MDA-06, PRS-05, DOM-07, TYP-01, THR-01, DAT-05, SRC-01, BUF-03, GRD-02 · decide the scale once at open; bound interaction work by the screen or the change; run whole-file work once per version, sliced or in a worker, cancellable; cap and announce; count work in tests. The decisions below are the concrete form.
- **Q-02** · answered · EDS-01–EDS-10, MDA-01–MDA-11, DAT-01–DAT-12 · editors keep a line/rope model and render the viewport; Markdown apps cap (Typora, GitHub, GitLab) or window by block (Obsidian); e-book readers load one section at a time; data viewers index offsets and draw a window. What they give up: colouring, folding and wrapping (VS Code), whole-book find and pagination speed (e-book readers), layouts that depend on off-screen elements (Obsidian).
- **Q-03** · answered · EDS-01, EDS-03, EDS-07, EDS-08, MDA-01, MDA-04, MDA-05, DAT-04, DAT-07, SRC-01, SRC-08, BUF-08 · VS Code: 20 MB or 300,000 lines, lines over 20,000 characters not tokenised, 10,000 not rendered; JetBrains: 2,500 KB for assistance, 20,000 KB to open; Neovim plugins 1.5–2 MiB plus mean line length; Typora about 2 MB, GitLab 1 MB truncation; VS Code JSON 5,000 items; VS Code diff 50 MB and 5 s; find 19,999 matches.
- **Q-04** · answered · THR-01–THR-05, THR-15, TYP-01 · slices of 5–8 ms yielded through `MessageChannel` (WebKit has no `scheduler.yield`, `postTask` or stable `requestIdleCallback`), a deadline per slice, cancellation by generation or `AbortSignal`, priority lanes, a rate cap on background work.
- **Q-05** · partly · DOM-01–DOM-07, DOM-11 · `content-visibility: auto` with remembered intrinsic sizes for every block, then a windowed mount from the geometry table above a node budget, own scroll anchoring, own find, select-all and copy by byte range; screen-reader behaviour over a windowed page is unverified (DOM-11).
- **Q-06** · answered · PRS-01–PRS-09, PRS-13 · parse in a worker over safe block boundaries, keep the whole-file definitions index, cap nesting and bracket/delimiter counts before micromark, send a block table and per-block HTML; micromark still has open quadratic reports (PRS-13), so the cmark pathological suite becomes doubling tests.
- **Q-07** · answered · TYP-01–TYP-10 · typeset by distance from the viewport, cap paragraph size (no Knuth–Plass on a 100 KB run), measure with a cached canvas, hyphenate lazily with a per-word cache, reserve heights; native `text-wrap: pretty` is no substitute.
- **Q-08** · answered · DAT-01–DAT-14 · a background typed-array index of offsets, a drawn window, lazy decoding of what is drawn, quote-aware record scanning, announced caps; no canvas grid for a reader.
- **Q-09** · answered · SRC-01–SRC-13 · search the model, not the DOM; user patterns in the Rust `regex` crate or a terminable worker; match cap 20,000; generation cancellation; paint with `CSS.highlights`; Shiki `tokenizeMaxLineLength` 20,000.
- **Q-10** · answered · BUF-01–BUF-12 · keep one flat byte array; make the text and offset map lazy (checkpoints, not a per-unit table); undo as inverse splices under a byte cap; diff on line hashes under time and size caps; hash in Rust.
- **Q-11** · partly · THR-06–THR-14 · raw IPC bodies (`tauri::ipc::Response`), ranged or channel reads for big files, transfer `ArrayBuffer`s to workers, never post big strings; no measured IPC throughput per platform exists (THR-13, absence).
- **Q-12** · answered · GRD-01–GRD-11 · count work (CDP layout and node counts, app counters, CPU time in Node) instead of timing it; doubling tests with a ratio bound; a TypeScript-AST lint with a ratchet; at most eight checkable rules for agents, each backed by a failing check.

## Decisions

### D-01 · Bound interaction work by the window: block-windowed Markdown pages from the geometry table
- **Choice:** two tiers for whole-page Markdown. Tier 1: every top-level block gets `content-visibility: auto` with `contain-intrinsic-size: auto <estimate>`. Tier 2, above a node budget measured in both engines: mount only the blocks within about two screens of the viewport, one spacer per side, heights from the geometry table (estimated, then measured), own scroll anchoring. Cap the size of one block (a 10,000-item list or a 5,000-row table is sub-windowed).
- **Because:** MDA-06 and MDA-02 (Obsidian windows by block and fails on one huge block), DOM-01 and DOM-03 (`content-visibility` helps but is "never going to be as fast as a virtualized list"), EDS-04 (CodeMirror's height map is the same structure), DOM-07 (geometry reads defeat skipping).
- **Verified by the lead:** the measured symptom, in this app on macOS (hunt 03, Chromium, a loaded machine): opening 1 MB of Markdown prose kept the window busy for 62 s, about four times per doubling of the file, and every cursor key and scroll cost 0.19 s at 1 MB and 0.6–0.8 s at 2 MB. Whole-page work on each interaction is what windowing removes.
- **Untested:** the node budget (DOM-08: no per-node cost for WebKit or Chromium found); select-all, copy and VoiceOver over a windowed page (DOM-11).
- **Falsifier:** a 5 MB page with Tier 1 alone at rest in under 1 s with keys under 16 ms in WKWebView and WebView2.

### D-02 · Decide the scale once, at open, and let every feature read it
- **Choice:** one scale record per document version: bytes, lines, longest line, mean line length, and (after the parse) block, list-item and table-row counts. Classes: normal, heavy (from about 1 MB or about 5,000 blocks), huge (from 5 MB, the lines reading); a long-line trigger (longest over about 10,000 characters). Each feature reads the class instead of keeping its own limit, and the degraded state is announced once.
- **Because:** EDS-01 (VS Code decides in the constructor and keeps to it), EDS-03 and EDS-08 (line length is its own axis), MDA-02 (structure counts, not bytes, predict pain), EDS-02 (what to turn off first).
- **Verified by the lead:** thresholds checked against VS Code's and JetBrains' sources by the verifiers (EDS-01, EDS-07); the app's own limits differ per feature today (`docs/file-kinds.md`, "Size limits": colour 2 MB, data tree 1.5 MB, lines 5 MB).
- **Untested:** the class boundaries for this app; they are starting points to tune with the scale matrix.
- **Falsifier:** features whose cost does not track any of these counts.

### D-03 · Parse in a worker; send a block table and per-block HTML
- **Choice:** one module worker owns the bytes' parse, the definitions index and the block table; slices end only at block boundaries proved safe (not in fences, HTML blocks, indented code, lists or block quotes); a definition change reparses in the worker while the old page stays; nesting, bracket and delimiter counts are capped before micromark; panels get small derived tables from the worker, never the tree.
- **Because:** PRS-01 (micromark about 1.3 MB/s parse plus render on a fast runner), PRS-05 and PRS-06 (safe restart points, definitions reach across the file), PRS-08 and THR-06 (strings and transferred buffers cross cheaply; object trees do not), PRS-04 and PRS-13 (pre-parse caps; micromark's open quadratic reports).
- **Verified by the lead:** measured the app's own `parseMarkdown` in Node on this Mac: 256 KB of a heading-heavy document in 425 ms of CPU time (about 0.6 MB/s, parse only, under load), linear across 32–256 KB. The hunt measured a whole-file reparse on the main thread of 5.4–8.2 s at 4.9 MB when a footnote or reference definition is present or edited.
- **Untested:** the structured-clone cost of the app's tree in WKWebView (PRS-10); whether every panel can live on derived tables.
- **Falsifier:** a worker round trip for a 5 MB file slower than the current sliced main-thread parse.

### D-04 · Typeset by distance from the viewport, with a paragraph cap
- **Choice:** the typesetting queue takes blocks in order of distance from the scroll position within about 2–3 screens, re-prioritised on scroll and aborted on change; paragraphs over a cap (start at 20,000 characters) are split at break opportunities or left to the browser; widths from a cached canvas measurer; hyphenation cached per word; heights reserved so the page never moves under the reader.
- **Because:** TYP-01 and TYP-03 (the whole-page pass is linear or worse in file size), TYP-02 (Knuth–Plass is per paragraph; cap the paragraph), TYP-04 (long runs are slow in every engine), TYP-08 (canvas measurement with caches), DOM-04 (no scroll anchoring in WKWebView before Safari 27).
- **Verified by the lead:** TYP-03's numbers re-checked by its verifier against the repository's own audit; the app already falls back to an 8 ms macrotask where `requestIdleCallback` is missing (`packages/typeset/src/scheduler.ts`).
- **Untested:** the cause of the 13 s layout of a 100 KB run (TYP-04 names candidates; a profile would settle it); hyphenation throughput (TYP-06).
- **Falsifier:** a profile showing the idle typesetting queue is not a material share of a big page's busy time.

### D-05 · One scheduler for sliced work
- **Choice:** one module (`yieldToMain`, `runSliced(task, {budgetMs, signal})`): `scheduler.yield` where present, else a `MessageChannel` round trip; a 5–8 ms deadline per slice; an `AbortSignal` or generation number checked after each yield; three lanes (input, near the viewport, background) with a rate cap on the background lane.
- **Because:** THR-02, THR-03, THR-15 (WebKit has no `scheduler.yield`, `postTask`, stable `requestIdleCallback`), THR-04 (React's 5 ms `MessageChannel` slice), THR-05 (CodeMirror's 20 ms and 3,000-ms-per-30-s budgets).
- **Verified by the lead:** browser support re-checked by the verifier against MDN browser-compat-data today; in the code, at least six modules build their own `MessageChannel` yield (`startup/yield.ts`, `render/highlight-queue.ts`, `view/reading-rows.ts`, `view/reading-lines.ts`, `kinds/table-lens.ts`, `kinds/transcript-view.ts`), and `startup/idle-work.ts` skips `requestIdleCallback` under WebKit: the pattern exists, the single owner does not.
- **Untested:** whether lanes need preemption inside a slice.
- **Falsifier:** none expected; this is consolidation.

### D-06 · Search over the model, off the main thread, and own find
- **Choice:** find and search read the bytes or the line index, never the DOM; user patterns run in the Rust `regex` crate (linear time) or a worker with a deadline and terminate; a match cap of 20,000 announced as "20,000+"; generation cancellation and a short debounce; matches painted with `CSS.highlights` over the mounted part only; Shiki gets `tokenizeMaxLineLength: 20000`.
- **Because:** SRC-01 and SRC-05 (editors search the model and cap), SRC-02 and SRC-03 (no linear engine in JS engines; RE2-style options), SRC-07 and SRC-08 (Shiki and VS Code line caps), SRC-09 and DOM-05 (browser find cannot see unmounted blocks; skipped content is findable only from Safari 26), SRC-10 (Highlight API in WebKit from 17.2).
- **Verified by the lead:** Marxy's minimum macOS is 13.0 (`apps/desktop/src-tauri/tauri.conf.json`), whose WebKit can predate both `content-visibility` (Safari 18) and find in skipped content (Safari 26), so the app's own find is required whatever D-01 tier is used.
- **Untested:** `re2js` speed against Irregexp; Highlight API cost with thousands of ranges.
- **Falsifier:** none for the cap and the off-thread rule; the engine choice may move.

### D-07 · Keep the bytes; make every derived copy lazy and bounded
- **Choice:** one flat `Uint8Array` per document (no rope or piece table yet); the text and the UTF-16-to-byte map built lazily, with checkpoints about every 1 KB instead of a per-unit table; line starts in a `Uint32Array`; undo as inverse splices under a byte cap; diff on line hashes under time and size caps with a coarse fallback; the whole-file HTML string and sanitised-page cache kept only below a size threshold; the save hash computed in Rust.
- **Because:** BUF-01–BUF-03 (structure overheads; checkpoints cost under 1%), BUF-04 (string traps: sliced-string retention, flattening), BUF-08 (VS Code's diff envelope), BUF-11 (hash natively), BUF-12 (derived data, not bytes, is the memory: a 5 MB parse retained 102.7 MB with about 1.4 GB peak RSS growth in the older audit).
- **Verified by the lead:** BUF-12's numbers re-checked by its verifier against the audit file; the hunt measured a one-byte splice rebuilding the whole text, offsets and line-ending scan (10–80 ms at 1 MB, up to about 1 s at 4.9 MB).
- **Untested:** checkpoint spacing; whether splice copy cost matters once the derived rebuild is lazy.
- **Falsifier:** an edit path over a frame at 50 MB after the derived copies are lazy (then a piece list over immutable chunks, BUF-01).

### D-08 · Viewers index offsets and draw a window
- **Choice:** JSON gets a typed-array node index from one background scan and lazy expansion and leaf decoding past a low threshold; CSV, TSV and JSON Lines record scanning is quote-aware; every index build is sliced or in a worker, reports progress, and can be cancelled; tail-follow appends to the index; every cap is a named constant the page states.
- **Because:** DAT-01 (simdjson-style structural index), DAT-03 and DAT-04 (compact line indexes, announced caps), DAT-06 and DAT-07 (whole-tree JSON views need caps), DAT-10 (quoted newlines).
- **Verified by the lead:** the hunt measured a 1 MB pretty-printed JSON reload at over two minutes and its first find at 93 s of main-thread time; the app's tables already window rows (`docs/architecture.md`), which matches DAT-09's advice to stay in the DOM.
- **Untested:** per-node index memory.
- **Falsifier:** a whole-tree JSON view under 1 s at 5 MB.

### D-09 · Guardrails count work, and every rule for agents has a check behind it
- **Choice:** (1) growth tests: whole-document functions in `packages/core` timed in CPU time on n and 4n with an exponent bound; (2) a scale matrix in the browser build over the big-file generator's shapes and sizes, asserting CDP counters and doubling ratios (2.5 for whole-file actions, about 1.3 for bounded ones), wall time shown but not gating; (3) a TypeScript-AST lint with a per-file ratchet for the code shapes that grow faster than the input, with a `scale:` comment as the stated exception; (4) at most eight short rules in `AGENTS.md`, a project skill, and an edit hook that shows the rules and the lint's hits at the moment of the edit.
- **Because:** GRD-01 and GRD-02 (counts are repeatable; time is not), GRD-03 (doubling tests are home-built), GRD-07 and GRD-08 (Biome's GritQL plugins lack a semantic model; the repository's AST-script ratchet is the template), GRD-09 (agents follow instructions; short checkable rules, backed by failing checks).
- **Verified by the lead:** built and ran it. Timed by the wall clock on this Mac at a load average of 50–70, the sanitiser's growth test read exponent 2.11 (quadratic) and the heading parse 1.64; timed in CPU time the same functions read about 1.0 and 1.1 (linear). Wall-clock growth tests would have failed linear code: GRD-01's point, measured here.
- **Untested:** run-to-run variance of CDP layout counts (GRD-02); whether Chromium counts predict WebKit's cost.
- **Falsifier:** counter-based checks that miss regressions the reader feels.

## Reconciled conflicts

| Topic | What the chapters said (IDs) | Use | Why |
|---|---|---|---|
| What a 1–5 MB Markdown file should become | 07 (DAT, recommendation 4): read it as lines, like a log; 02 and 04 (MDA-06, DOM-03): window it by block and keep the typeset page | windowing (D-01) | the typeset page is the product; the lines reading drops rendering, and 07 states this outside its own scope |
| Does `content-visibility` keep find | 04 (DOM-01) first said yes; 08 (SRC-09, corrected) found skipped content unfindable in Safari 18–25 | not on older WebKit | BCD primary data; and Marxy supports macOS 13 |
| `isInputPending` | 06 says do not use it; CodeMirror uses it where present (THR-05, corrected) | deadline-only scheduler, `isInputPending` optional | it is Chromium-only; the deadline works everywhere |
| Growth bound | 10: counter ratio 2.5 per doubling; the core growth tests: CPU-time exponent under 1.45 per fourfold | both | 1.45 per fourfold is about 2.7 per doubling; same intent, different clocks for Node and the browser |
| A native or wasm parser | 03: a spike for block boundaries later; 06: not first | not first | the cost is main-thread work, not parser speed (THR-12); the one-parser rule holds |
| Windowing threshold | 02: about 1 MB or 5,000 blocks; 04: 10,000–20,000 mounted nodes | a node budget measured per engine, with block counts as the trigger | node count is what costs (MDA-02, DOM-03); both numbers are starting points |

## Risks

| Risk | Likelihood | Impact | Evidence | Mitigation |
|---|---|---|---|---|
| Windowing breaks select-all, copy, find or screen readers | high, if done without the replacements | readers lose basic functions | DOM-11 (unverified), MDA-06 | ship own find, copy by byte range and anchors in the same change; browser tests that copy from an unmounted block |
| Estimated heights make the page jump (no `overflow-anchor` in WKWebView before Safari 27) | high | the reader loses place | DOM-04, TYP-01 | own anchoring from the geometry table, applied once per frame |
| Moving the parse to a worker is a large refactor across panels | medium | long-lived branch | PRS-08, THR-06 | first make panels read derived tables from the store (a win alone), then move the producer |
| micromark has unfixed quadratic inputs | medium | a hostile file freezes the parse | PRS-13 | pre-parse caps (D-03) and the cmark pathological cases as doubling tests |
| Class thresholds are guesses | certain | wrong degradation | EDS-02, MDA-02 | tune with the scale matrix on both platforms |

## Actions

- [ ] 2026-11-27 · Land the guardrails: the lint with its ratchet, the growth tests, the generator, the agent rules, skill and hook (D-09; GRD-02, GRD-07, GRD-09)
- [ ] 2026-12 · One scheduler module and its adoption by every sliced loop (D-05; THR-02, THR-04)
- [ ] 2026-12 · Panels and find read the store's parse, line index and derived tables; no whole-file reparse on the main thread for a feature (D-03, D-06; PRS-08, SRC-01)
- [ ] 2026-12 · Scale class at open (D-02; EDS-01)
- [ ] 2026-12 · Typesetting by distance with a paragraph cap, on the geometry table (D-04; TYP-01, TYP-02)
- [ ] 2027-01 · Tier 1 then Tier 2 windowing for whole-page Markdown, with own find, copy and anchoring (D-01; DOM-01, DOM-03)
- [ ] 2027-01 · Parse worker (D-03; PRS-05, PRS-08)
- [ ] 2027-01 · JSON node index; quote-aware record scanning (D-08; DAT-01, DAT-10)
- [ ] 2027-01 · Lazy text and offset checkpoints; undo byte cap; hash in Rust (D-07; BUF-03, BUF-11)

## Open questions

- Per-node DOM cost and the node budget in WKWebView and WebView2 (DOM-08): measure with the scale matrix.
- Structured-clone cost of the app's tree, and worker start-up, in WKWebView (PRS-10, THR-14).
- Tauri raw IPC throughput per platform for 1–50 MB (THR-13).
- What takes 13 s in the layout of a 100 KB unbroken run (TYP-04).
- How VoiceOver and Narrator read a windowed document (DOM-11).
- Hyphenation throughput per word (TYP-06).

## Superseded

- **D-01**, 2026-11-27: tier 1 (`content-visibility: auto` on every block) is dropped. With this typesetter, WebKit leaves skipped paragraphs unset, and Chromium's open costs more with no gain. Windowed mounting from the geometry table, with a node budget of 10,000, replaces both tiers. See [windowed-pages](../windowed-pages/SYNTHESIS.md) D-01 and D-02.
- **D-04**, 2026-11-27: under windowing, blocks are set as they mount, ranked by distance in grid units, with `typesetThrough(target)` for jumps; the paragraph cap stays. See [windowed-pages](../windowed-pages/SYNTHESIS.md) D-04 and D-07.

The decisions above keep their text; this section says what replaced them.
