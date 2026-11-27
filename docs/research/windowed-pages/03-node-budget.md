---
corpus: windowed-pages
id: 03
slug: node-budget
prefix: NOD
title: What a mounted node costs, and the node budget
researched: 2026-11-27
confidence: medium
volatility: high
status: active
keywords: [node budget, mounted nodes, forced layout, WebKit, Chromium, ResizeObserver, :has, per-interaction cost]
---

# 03 · What a mounted node costs, and the node budget

## Abstract

The page was opened at eight to ten sizes in the app's own source (in-memory shell, headless Playwright WebKit 26.6 on macOS 26.6, Chromium 153.0.8010.12 as comparison), left to finish its progressive mount and typesetting, and then used: cursor key, scroll step, a forced layout of the article after dirtying one block or the article's width, one `appendChild`, a viewport width change. Cost is in-page `performance.now()`, median and minimum of 9 repetitions in the runs whose count is recorded (the WebKit prose run records none; WebKit has no CDP), on a Mac whose load average was not recorded in the outputs (earlier notes said 11–22), so the figures are upper bounds and the relative shape is what to trust. In WebKit the forced layout of the whole article grows linearly with mounted nodes, about 1.3–2.1 µs per node on prose and 0.55–0.7 µs on dense Markdown, and crosses 16 ms at about 8,000 nodes of prose; a cursor key crosses 50 ms (to the end of the next frame) at about 40,000 nodes. Chromium is about 20–30x cheaper per node and has not crossed 16 ms at 140,000 nodes of prose. Costs that are tied to one block or one append (a forced layout of one block, an append, a ResizeObserver over every block) stay small below 40,000 nodes in both engines.

## TL;DR

- **Ship a budget of 10,000 mounted nodes** (all nodes under the article, text nodes included): below it the page is mounted whole and typeset as today; above it only blocks near the viewport are mounted. That is the node count where WebKit's forced article layout is interpolated at about 16–18 ms on prose (not measured at exactly 10k; the 7.7k and 12.3k rows bracket it) and about 6–7 ms on dense (extrapolated from the smallest dense row, 28k nodes), and a key is about 25–40 ms. The 16 ms threshold is a judgement: layout is linear with no knee in WebKit. Chromium would allow 40,000 or more; one number for both engines is simpler (NOD-01, NOD-02, NOD-07). No Windows or Edge per-interaction run exists, so the earlier "4x headroom for Windows" is not measured.
- WebKit, prose, forced layout of the article by a width-like change: 4 ms at 1.3k nodes, 16 ms at 7.7k, 39 ms at 21k, 68 ms at 40k, 96 ms at 73k, 180 ms at 258k. A cursor key to the end of the next frame: 26–38 ms up to 12k nodes, 64 ms at 40k, 91 ms at 73k, 121 ms at 258k (NOD-01).
- Nodes are an imperfect proxy: dense Markdown (tables, lists, inline marks) costs about a third per node of what prose costs in forced layout, yet its typesetter queue takes minutes (11.7 s to settle at 117k nodes, 35 s at 234k, over 166 s at 468k) (NOD-03). The budget should be in nodes with a second guard on typeset work.
- Costs that stay below the budget and need no windowing: one-block forced layout (1–5 ms at 40k nodes), appending a block (0–3 ms), ResizeObserver over every block (about 6–8 ms extra at 40,000 blocks, two notifications per one-block change), the `:has()` rules (worth about 25–40% of article layout per node, not the cause of the knee) (NOD-04, NOD-05, NOD-06).
- Scroll steps are at the frame-cadence floor up to 73k nodes in both engines; they are not the constraint (NOD-01).

## Recommendation

**Number.** Node budget: **10,000 nodes under the article** for the engine that is slowest (WebKit), shipped as the one number for all engines. Measured by this vector as: WebKit forced layout of the article about 16–18 ms on prose at that count (interpolated; 10k was never run directly); key total ≤ 40 ms; a whole open (mount plus typesetting settled) under 1 s on prose. Per engine, if the build wants engine-specific values: WebKit prose 8,000–10,000 (16 ms layout) or 40,000 (50 ms key); WebKit dense about 25,000; Chromium 40,000+ (not yet crossed at 140,000 for prose, but dense Markdown at 465,000 nodes took 57.8 s to open and never settled in 160 s). Do not ship an engine switch unless a Windows run on Edge/WebView2 asks for it: the brief's "no second code path" argues for one number.

**How measured.** `probes/node-budget/node-budget.mjs` over the large-file corpus shapes (`md-prose`, `md-dense`) cut to byte sizes, counting every node under the visible `.marxy-article` with a `TreeWalker`. Interaction cost is median/min of N repetitions (9 in `run-rest.sh`, default 15; the WebKit prose run records none) after a quiet wait of at least 0.6 s (no long task for six 100 ms ticks; 0.6 s is the probe's floor, not a typesetter cost), so typesetting idle work does not pollute it, except where the log says NOTQUIET.

**What follows for the windowed design.** Two screens of typeset blocks are a few hundred nodes, far below the budget, so the budget is a ceiling for the small-file whole mount, not a target for the windowed mount. Mount the page whole when its node estimate is under 10,000; otherwise window. Measured nodes per KB are about 40–65 for prose (64 at 20 KB, 49 at 250 KB, 40 at 1 MB, 37 at 2 MB) and about 470 for dense (28k nodes in 60 KB, 117k in 250 KB, 234k in 500 KB); an earlier estimate of 5–10 and 25–50 per KB was 6–10x too low. So 10,000 nodes is about 150–250 KB of prose and about 20 KB of dense. A literal "under 10,000" applied to the old per-KB figures would have admitted 1–2 MB of prose (40–73k nodes) and 200–400 KB of dense. Count a page's nodes at mount from the micromark tree rather than from the DOM.

## Findings

### NOD-01 · WebKit prose: the curve of every interaction against mounted nodes  [measured]

**Setup.** `md-prose` cut to 20 KB, 60 KB, 120 KB, 250 KB, 500 KB, 1 MB, 2 MB, 4 MB; Playwright WebKit 26.6 headless, macOS 26.6 (Darwin 25.6), viewport 1440x900, in-memory shell served by the app's Vite dev server; repetition count and load average not recorded in the outputs (earlier notes said 11 repetitions and load average 11–22). **Probe:** `probes/node-budget/node-budget.mjs`, output `webkit-md-prose.json`, log `webkit-md-prose.log`, table via `table.mjs`. ms, median / minimum.

| nodes (elements) | key to end of next frame | key sync (handler) | scroll step | forced layout, one block dirty | forced layout, article width | append one block | settle |
|---|---|---|---|---|---|---|---|
| 1.3k (0.5k) | 26 / 8 | 5 / 2 | 40 / 23 | 1 / 0 | 4 / 2 | 0 | 0.6 s |
| 3.9k (1.6k) | 25 / 17 | 3 / 1 | 26 / 24 | 1 / 0 | 7 / 3 | 1 | 0.6 s |
| 7.7k (3.3k) | 27 / 25 | 6 / 1 | 26 / 22 | 1 / 1 | 16 / 6 | 2 | 0.6 s |
| 12.3k (4.9k) | 38 / 26 | 6 / 3 | 39 / 24 | 1 / 0 | 19 / 13 | 1 | 0.7 s |
| 20.9k (7.9k) | 29 / 19 | 7 / 4 | 40 / 26 | 3 / 1 | 39 / 20 | 2 | 0.7 s |
| 40.4k (15.1k) | 64 / 51 | 12 / 5 | 42 / 41 | 4 / 2 | 68 / 63 | 3 | 1.2 s |
| 73.5k (26.5k) | 91 / 74 | 23 / 10 | 43 / 28 | 5 / 3 | 96 / 84 | 8 | 1.1 s |
| 258k (109k)* | 121 / 93 | 56 / 34 | 75 / 60 | 10 / 7 | 180 / 169 | 10 | 69 s |

*4 MB: the node count is larger than 2x because the typesetter's line spans are in by then and the file's block count doubles; this row's settle time is 69 s. "Key to end of next frame" is the time from a stamp taken in a `page.evaluate` just before `page.keyboard.press` to a `setTimeout(0)` after the next `requestAnimationFrame`, so it contains the Playwright press round trip as well as the engine's frame cadence: the minimum in the small rows (8–25 ms) is cadence plus that round trip, not work and not proven to be cadence alone (the capture and bubble listeners give only the "key sync" column). "Forced layout" dirties one block's `padding-top` (one block) or the article's `padding-right` by 2 px (article width) and reads `offsetHeight`.

**Reading.**
- The forced layout of the article is linear: 4, 7, 16, 19, 39, 68, 96, 180 ms for 1.3k–258k nodes, 1.3–2.1 µs per node at 8k–73k and 0.7 µs at 258k. It crosses 16 ms at about 8,000 nodes and 50 ms at about 25,000–30,000.
- A key (median, to the next frame) is flat at the cadence floor to 12k nodes, then 64 ms at 40k and 91 ms at 73k: 50 ms is crossed at about 30,000–40,000 nodes. Its synchronous handler stays 12 ms at 40k and 23 ms at 73k.
- A scroll step is at the same cadence floor up to 73k nodes. It is not what limits the budget.
- One-block forced layout and an append stay under 16 ms at every size, 10 ms at 258k.
- This corrects a reading of the prior corpus that every large-file interaction cost grows with the whole page: here the per-key cost grows with nodes, but gently, because the dirty region is one block. The 0.1–0.3 s per key at 0.5–1 MB that the brief quotes used a different load and a denser shape (see NOD-03).

### NOD-02 · Chromium prose: about 20–30x cheaper per node than WebKit, no knee through 140k nodes  [measured]

**Setup.** Same probe, Playwright Chromium 153.0.8010.12 headless, `md-prose` at 20 KB, 120 KB, 500 KB, 1 MB, 2 MB, 4 MB; 9 repetitions. No CDP task time (the probe is browser-neutral); `chromium-md-prose.json`. ms, median / minimum.

| nodes | key to end of next frame | key sync | scroll step | forced layout, one block | forced layout, article width | append | width change (upper bound) |
|---|---|---|---|---|---|---|---|
| 1.3k | 8.8 / 1.5 | 1.2 / 0.3 | 9 / 8 | 0.2 | 0.2 | 0.5 | 15 / 7 |
| 7.7k | 9.4 / 7.8 | 1.3 / 1.2 | 8.7 / 7.7 | 0.4 | 0.5 | 0.7 | 14.5 / 9 |
| 20.6k | 20 / 2.2 | 2.3 / 0.8 | 4.4 / 1.9 | 1.0 | 1.6 | 1.6 | 28 / 20 |
| 37.8k | 40 / 16 | 4.3 / 3.2 | 8.9 / 6.8 | 1.9 | 3.3 | 2.8 | 40 / 36 |
| 69.8k | 50 / 29 | 5.1 / 4.2 | 33 / 11.5 | 3.6 | 3.2 | 5.2 | 73 / 56 |
| 139.9k | 88 / 34 | 9.3 / 7.3 | 42 / 15 | 7.4 | 8.3 | 12.9 | 182 / 131 |

Forced layout of the article stays under 16 ms through 140k nodes; the key's synchronous part is 1–9 ms. The total (to the next frame) reaches 50 ms at about 70k nodes but its minimum stays 29–34 ms, so frame cadence and idle work, not layout, set it. Compared with WebKit at the same node count (about 40k: 3.3 ms vs 68 ms for the article forced layout) Chromium is about 20x cheaper; at 73k, 30x. The Windows Chromium numbers (1.5 s at 24.5k nodes, 5.3 s at 45k, 30 s at 81k) are reported by another machine's run (a pending report of the same probe shape), not measured here and not in `probes/`; they are open-until-quiet task time, a whole-page open cost this vector did not repeat; per-interaction cost on that engine is therefore small while open cost is what grows.

### NOD-03 · Dense Markdown: cheaper per node, but typesetting settle time explodes first  [measured]

**Setup.** `md-dense` (tables, lists, inline marks) cut to 60 KB, 250 KB, 500 KB, 1 MB; WebKit (`webkit-md-dense.json`) and Chromium at 250 KB and 1 MB (`chromium-md-dense.json`). ms median / minimum.

| engine | nodes (elements) | key total | key sync | scroll | forced layout, block | forced layout, width | append | open | settle |
|---|---|---|---|---|---|---|---|---|---|
| WebKit | 28k (12k) | 57 / 42 | 17 / 6 | 52 | 5 | 19 | 3 | 0.5 s | 1.1 s |
| WebKit | 117k (50k) | 124 / 94 | 29 / 19 | 104 | 24 | 69 | 16 | 2.1 s | 11.7 s |
| WebKit | 234k (100k) | 237 / 189 | 74 / 48 | 152 | 21 | 126 | 17 | 5.4 s | 35 s |
| WebKit | 468k (200k) | 1,296 / 935 | 157 / 125 | 640 | 60 | 265 | 35 | 16 s | over 166 s, not quiet |
| Chromium | 117k (50k) | 62 / 13 | 7.3 / 5.7 | 37 | 10 | 8.5 | 37 | 3.1 s | 17 s |
| Chromium | 465k (198k) | 1,973 / 1,058 | 72 / 64 | 1,465 | 42 | 56 | 236 | 58 s | over 160 s, not quiet |

Per node, WebKit forced layout of the article is 0.7 µs at 28k, 0.6 µs at 117k, 0.54 µs at 234k and 0.57 µs at 468k, against 1.3–2.1 µs on prose: layout cost follows the text and lines, not the node count, so the same node budget is conservative for dense pages. What breaks first on dense pages is the typesetter queue: it is still busy after 160 s at 465k nodes in both engines, and the 468k key/scroll figures include that idle work competing (NOTQUIET). Per element (not per node), WebKit's forced layout is 1.6 µs at 12k elements and about 1.3 µs at 100k elements (126 ms over 99,994 elements; 1.4 µs at 50k); 0.7 µs is the per-node figure.
At 468k the numbers say what the brief's 22 s (Chromium) and 42 s (WebKit) for 1 MB meant: the long tail is the typesetter, not layout, and a node budget alone does not bound it; typesetting by distance does.

### NOD-04 · The theme's `:has()` rules cost about 25–40% of an article layout in WebKit, and do not set the knee  [measured]

**Setup.** `--has drop` deletes every stylesheet rule whose text contains `:has(` before measuring (`webkit-md-prose-nohas.json`), `md-prose` 500 KB, 1 MB, 2 MB, WebKit, 9 repetitions; compared with the kept run (NOD-01, 11 repetitions, a separate session). Node counts differ by up to 30% between the two sessions at 2 MB (the typesetter had reached a different state), so per-node cost is used.

| size | forced layout of article, rules kept | rules dropped | per node kept | per node dropped |
|---|---|---|---|---|
| 500 KB | 39 ms (20.9k nodes) | 22 ms (20.1k) | 1.9 µs | 1.1 µs |
| 1 MB | 68 ms (40.4k) | 44 ms (38.7k) | 1.7 µs | 1.1 µs |
| 2 MB | 96 ms (73.5k) | 93 ms (96k) | 1.3 µs | 0.97 µs |

Appending one block was 2, 3 and 8 ms with the rules (1–3 ms up to 1 MB) and 1, 2 and 3 ms without it; key and scroll did not improve (82 vs 64 ms key at 1 MB, worse, within the noise of a loaded Mac). So the rules cost about 25–40% of article layout per node (41%, 32% and 26% per node at 500 KB, 1 MB and 2 MB; the raw ms savings are 44%, 35% and 3%, and the 2 MB row has a 30% node-count confound), with the measured spread; they are not the cause of the knee, and below a 10,000-node budget the difference is a few milliseconds. (An earlier note of 0.11 → 0.35 ms for an append at 6,000 → 18,000 blocks is not in the probe outputs and is not used here.)

### NOD-05 · One-block work and appends stay small; the cost of the whole page is the width and the grid pass  [measured]

**Setup.** The one-block forced layout and `appendChild` columns of NOD-01 to NOD-03. An append of a clone of the last block into the article, then `getBoundingClientRect` on it: WebKit 0 ms at 1.3k nodes, 1–3 ms to 40k, 8 ms at 73k, 10 ms at 258k; Chromium 0.5 ms at 1.3k, 2.8 ms at 38k, 12.9 ms at 140k. On dense pages 16 ms (WebKit) and 37 ms (Chromium) at 117k nodes, 235 ms (Chromium) at 465k. Left out earlier: WebKit dense at 468k nodes took 25,576 ms for a width change (10,849 ms minimum), which supports typeset-by-distance; the first two WebKit width-change rows come from a NOTQUIET or heavy state.
The viewport width change is the one interaction that is a function of the whole page: total 47 ms at 1.3k nodes, 57 at 7.7k, 106 at 21k, 168 at 40k, 254 at 73k, 442 at 258k (WebKit prose, upper bound, includes a Playwright round trip and one frame; the repetition minimum is 30, 35, 81, 132, 226, 393); on dense WebKit 143 at 28k, 657 at 117k, 1,860 at 234k. Chromium prose 15 at 1.3k to 182 at 140k. A windowed page re-sets only the mounted blocks on a width change; the whole page below the budget stays at or below about 60 ms at 8k nodes in WebKit, which is acceptable for a resize.

### NOD-06 · ResizeObserver over every block: delivery is per change, the cost is small  [measured]

**Setup.** Synthetic article of N plain `<p>` blocks (the shape of `ro-cost.mjs` on the candidate geometry table branch); `probes/node-budget/node-budget.mjs --mode ro`; one block's `padding-top` toggled, a forced layout, and time to the end of the next frame; with and without a `ResizeObserver` (border-box) on every block; 9 repetitions; `webkit-ro.json`, `chromium-ro.json`.

| blocks | WebKit layout / to frame end, no RO | WebKit with RO | Chromium layout / to frame end, no RO | Chromium with RO |
|---|---|---|---|---|
| 2,000 | 1 / 1 | 1 / 1 | 0.6 / 1.9 | 0.7 / 2.0 |
| 10,000 | 4 / 4 | 4 / 5 | 3.6 / 11.2 | 3.0 / 9.7 |
| 20,000 | 9 / 9 | 7 / 10 | 6.3 / 23 | 6.7 / 23 |
| 40,000 | 17 / 17 | 17 / 23 | 9.5 / 32 | 10 / 40 |

The observer delivers two notifications for a one-block change (the block and the article), independent of N; the added cost is at most 6 ms (WebKit) and 8 ms (Chromium) to the end of the frame at 40,000 blocks, nothing measurable at 10,000. The initial delivery of N entries is the cost to watch: the geometry table branch measured a first callback of 4 ms (WebKit) and 2.8 ms (Edge) at 10,000 blocks (`ro-cost.txt`, 2026-11-26; reported from another branch, not in `probes/` and not checked here) — a one-time mount cost. Timer resolution in WebKit is 1 ms, so the callback time itself reads 0 here (Chromium also reads 0, so the cost is below resolution in both engines); do not use these runs for callback micro-costs.

### NOD-07 · The node budget and what remains below it (Q-13, measurement side)  [measured]

**Setup.** Reading NOD-01 to NOD-06 against the thresholds 16 ms (forced layout), 50 ms (key), 1 s (whole open).

At 10,000 nodes in WebKit prose (interpolated between the 7.7k and 12.3k rows; 10k was never run directly): forced article layout about 17–19 ms, key 27–38 ms (cadence-limited), one-block layout 1 ms, append 2 ms, ResizeObserver extra under 2 ms, whole open under 1 s, width change about 57 ms. At 10,000 nodes in WebKit dense: layout about 6–7 ms (extrapolated at 0.65 µs per node from the smallest dense row, 28k nodes at 19 ms; the "12k element rows" are the same row), open under 1 s. At 10,000 nodes in Chromium: everything under 3 ms except the cadence-limited total.

Costs that still matter below the budget: the progressive mount (open wall time 0.1–0.7 s), the typesetter's idle pass (the 0.6 s "settle" is the quiet detector's floor, six 100 ms ticks, not a typesetter cost; whole open under 1 s at 10k still holds), the grid pass on a width change (up to 60 ms), and ResizeObserver initial delivery (a few ms). These are small enough that the batched grid pass and the `content-visibility: hidden` Source trick still help only above the budget. Fixes that exist because the whole page is mounted at 1 MB and more (the batched grid pass at 100 ms per forced layout, the hidden-Read trick for Source, typeset-idle throttling) are removed by windowing above the budget and are low value to keep below it.

## Options compared

| Option | Value | Effect (measured here) | Fit |
|---|---|---|---|
| One number, 10,000 nodes | WebKit's 16 ms layout | whole mount under 1 s, width change under 60 ms; windowed above | recommended |
| Engine-specific: WebKit 10k, Chromium 40k | per-engine knee | Chromium keeps a whole mount to about 800 KB more (10k to 40k nodes is about 190 KB to 1 MB of prose) | adds a second constant; only on a Windows request |
| Node budget at the 50 ms key (about 40k WebKit prose) | key-driven | forced layout 68 ms, width change 168 ms | too high; resize and Source would feel slow |
| Bytes budget (for example 250 KB) | simple | 12k nodes prose, 117k nodes dense, 11.7 s dense settle | rejected: dense pages blow it |
| Node budget plus a typeset-work guard | covers NOD-03 | bounds the idle queue | recommended as the second guard, in typesetting by distance |

## Open questions

- A Windows WebView2 run of this probe (`--browser msedge`) is the missing half: the Windows Chromium numbers reported to the lead are open-until-quiet task times, not per-interaction costs, and the Edge/WebKit-on-Windows reports are pending.
- The probe measures to the end of the next frame, which carries frame cadence under load; a quiet machine with a real compositor would lower the key and scroll floors. CDP task time on Chromium and Instruments on WebKit would give pure main-thread work.
- Dense and prose are two shapes; a code-heavy or table-heavy page may sit between them. The budget guard in nodes should be revisited with `md-technical`.
- Scroll cost here is a programmatic `scrollTop` step; a held cursor key with real compositor scrolling and typeset-by-distance running is not measured.
- Is the typesetter's line-break span count (the 2x node difference at 4 MB) part of the budget? It is counted here.

## Cross-links

- 02 (tier 1): content-visibility changes the node count that layout visits, so its gain is predicted by NOD-01's per-node slope.
- 09 (typeset by distance): NOD-03's settle times are the case for it.
- 01 (code map) and 06: the geometry table's ResizeObserver, NOD-06.
- Prior corpus: DOM-08 (node budget, left open) is answered here at 10,000; the brief's 100 ms forced layout at 1 MB dense is the 265 ms (WebKit) and 56 ms (Chromium) forced article layout at 468k nodes, NOD-03.

## Sources

- Probe: `docs/research/windowed-pages/probes/node-budget/node-budget.mjs`; runs `run-rest.sh`; results `webkit-md-prose.json`, `webkit-md-dense.json`, `webkit-md-prose-nohas.json`, `chromium-md-prose.json`, `chromium-md-dense.json`, `webkit-ro.json`, `chromium-ro.json`; table printer `table.mjs`. Application source at origin/main a6d7fab5, corpus generator `scripts/lib/big-files.mjs`.
- ResizeObserver reference measurement: `work/runs/2026-11-26-wave-05/branches/geometry-table/ro-cost.mjs` and `ro-cost.txt` on `origin/agent/geometry-table`.
- Windows Chromium run of the same probe shape, 2026-11-27, reported to the lead (not independently reproduced here).
- No web sources.
