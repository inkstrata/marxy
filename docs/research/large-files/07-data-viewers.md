---
corpus: large-files
id: 07
slug: data-viewers
prefix: DAT
title: JSON, CSV, log and hex viewers on big input
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [json viewer, csv viewer, log viewer, hex viewer, line index, structural index, simdjson, lnav, klogg, Hex Fiend, windowing, canvas grid, quoted newline, large file mode]
---

# 07 · JSON, CSV, log and hex viewers on big input

> How do data, log and hex viewers stay fast on big files? They keep the bytes, build a compact typed index of offsets (lines, records, JSON nodes) in a background pass, draw only the window near the screen, decode a cell or row only when it is drawn, and say when they stop. Viewers that skip the index (Firefox's JSON viewer, a full `JSON.parse` into a rendered tree) are the ones with open "slow for large JSON" bugs. For this app the gap is the JSON tree (whole-parse up to 1.5 MB, streamed past it) and Markdown 1–5 MB (whole page). The fix is to give JSON a node index with lazy expansion, and to apply the same line-index-plus-window rule to Markdown at a lower threshold.

## TL;DR
- Every fast viewer found has the same three parts: a byte-offset index built in the background (lnav, klogg, simdjson, a JSON "flat index"), a window of rows drawn, and lazy decoding of what is drawn (DAT-01, DAT-05).
- Index memory is the real cost: klogg stores line ends in a compressed, constant-time-lookup array; lnav caps indexing at about 134 million lines and says so; this app's 5 MB threshold is far below either (DAT-03, DAT-04; the comparison to the app's threshold is the author's inference, no source states it).
- Firefox's JSON viewer: no size fallback found, and an open bug; VS Code caps outline symbols and folding regions at `json.maxItemsComputed` = 5000. Both prove that a whole-tree view needs a cap that is announced (DAT-06, DAT-07).
- Canvas grids exist because DOM row virtualisation still costs hundreds of node changes per frame; this app's windowed tables can stay in the DOM because it draws few rows (DAT-09).
- CSV record indexes must be quote-aware: a naive newline index misreads quoted newlines (RFC 4180), and a parallel/chunked index cannot start mid-file without knowing the quote state (DAT-10).

## Recommendation for this setup

1. **JSON: replace "render the whole tree" with a node index plus lazy expansion, from a low threshold.** One scan over the bytes (in a worker, or in the Rust shell for large files) emits a typed array of structural offsets: for each container its start, end and child count; for each value start and kind. This is what simdjson stage 1 does (a 64-byte block at a time, positions into an integer array) and what the "flat index of every node" viewers do. The tree then draws only expanded rows; children of a container are found by walking the index; a leaf is decoded with `JSON.parse(bytes.slice(a,b))` only when drawn. The current tree (1.5 MB, 5,000 values, depth 256) can stay as the small-file path; raise the "stream" path to an index path and keep the stated cap but have the panel say what was left out.
2. **Keep the row index for CSV/JSON Lines, but make it quote-aware and say so.** Record starts must be found by a state machine that tracks quotes, not by `\n`. Index in chunks with a time budget, publishing a partial row count with a "indexing n%" label; a window can draw as soon as the rows it needs are indexed.
3. **Logs: keep the line index; store it as `Uint32Array`/`Float64Array` chunks (offsets of line starts), not an array of objects.** Add a hard line cap with a visible warning like lnav. Tail-follow should append to the index from the last indexed offset, never rebuild.
4. **Markdown 1–5 MB (outside this vector's scope but implied):** treat it like a log: line index plus window, with Read page rendering available per block/section on demand. The data viewers show that the threshold is set by index and DOM cost, not file size alone; 5 MB is generous for a whole-document DOM.
5. **Hex (the 256 MB card):** already the right shape. Hex Fiend's rule is the target: bytes stay on disk and only the visible rows are read. In this app, read the visible 64 KB window through a ranged shell read, not the whole file, once the file is above the in-memory threshold.
6. **Do not** adopt a canvas grid for tables (the DOM windowing already draws ≤ a screenful; canvas loses find-in-page, selection and accessibility, which matter in a reader), and do not build the JSON tree with `JSON.parse` of the whole file past a few MB.

**Rules for new features**
- A viewer for any file kind builds its own offset index (typed array) in a background pass and draws rows from it; it never builds a node/DOM per record or per JSON value for the whole file.
- Every index build has a time slice or worker boundary, a progress value, and cancellation; a test opens a 50 MB fixture and asserts the first window draws before the index finishes.
- Every cap (lines, rows, nodes, depth, cell length) is a named constant and the UI states the cap and what is not shown ("showing the first 20,000").
- A record or line index never splits on `\n` alone for CSV/TSV/JSON Lines; it uses the quote-aware scanner (tested with a quoted newline fixture).
- Memory per indexed line/node is documented, and the index uses typed arrays (`Uint32Array`/`Float64Array`), not arrays of objects.
- Decoding (UTF-8 decode, `JSON.parse`, cell parsing) happens on the visible window only, with a test that scrolling does not decode off-screen rows.
- Follow/tail appends to the index from the last offset; a test asserts append cost does not grow with file size.

## Findings

### DAT-01 · simdjson On Demand: index first, materialise lazily  `[confirmed]`
simdjson's first stage "reads blocks of 64 bytes one after the other" and generates a 64-bit bitset per block marking structural characters and value starts [1]. "The parser stores these locations as integer indexes in a separate array" [1]. The On-Demand API on top of it is described as "a pointer iterating through the content, only materializing the results (objects, arrays, strings, numbers) lazily" [1]. The paper's headline numbers (3.3–3.6 GiB/s vs 1.9–2.1 GiB/s for the DOM mode) come from the search summary of the paper, not read directly (the page I saved shows the design, not those numbers). Inference: an index of offsets, not a value tree, is the right first product for a viewer [1].

### DAT-02 · Index-then-render JSON viewers exist; Dadroit's mechanism is not documented  `[likely]`
A third-party viewer's page says it "builds a flat index of every node, and renders only the rows" visible [2]; its ~23 bytes per node claim is from a search summary and is `[unverified]`. Dadroit advertises "1GB file:1GB memory" on its own site (read through a search snippet only), with no mechanism published `[unverified]`. Memory roughly equal to file size is therefore the vendor-claimed ceiling for an index viewer.

### DAT-03 · klogg: index to disk-resident file, compressed line array, 64-bit-safe counts  `[confirmed]`
klogg "reads the file directly from disk, without loading it into memory" and "Supports files with more than 2147483647 lines" [3]. Its line array is a `CompressedLinePositionStorage`; its header says the class will "apply some" compression in memory, "while still providing fast, constant-time look-up", because line ends are increasing addresses [4]. Simple `vector<OffsetInFile>` storage is kept as an alternative [5]. Takeaway: line offsets are monotone, so delta/block-compress them and still random-access.

### DAT-04 · lnav: line-count cap with warning; memory reported per file  `[confirmed]`
lnav's release notes say a file with more lines than it can index "(about 134 million) would crash" and that indexing now stops at the limit with a warning, tunable by `/tuning/logfile/max-lines` [6]. The same notes report indexing memory and I/O cache memory per file in its FILES panel, and add a `file split` command to cut a huge file into pieces lnav can fully index [6]. The stop-early-and-say-so pattern is the model for caps here.

### DAT-05 · less: no up-front read  `[confirmed]`
The `less` manual says "Less does not have to read the entire input file before" starting, so large files open faster than in editors [7]. It reads lazily and only seeks line numbers on demand; line numbers need a scan. Takeaway: show byte offset/percent immediately; compute line numbers only when asked.

### DAT-06 · Firefox's JSON viewer: no size fallback, open "slow" bug  `[confirmed]`
Mozilla's bug "JSON Viewer is slow for large JSON" is still open [8]. A developer in the 8 MB bug suggests "bail out from the json viewer and use the raw view if the size exceeds a certain limit" while still investigating the performance issue [9]. I found no shipped fallback (an absence inside this finding, `[absence]`). **Searched:** the two Bugzilla bugs [8][9] and a search for a Firefox JSON viewer size limit. The only hard-coded limit that surfaced was a 100 KB constant that gates the Expand All button (from a search summary of a support thread, `[likely]`). Takeaway: a React-style full tree for an 8 MB file is the failure to avoid.

### DAT-07 · VS Code: JSON language features cap symbols and folding at 5000  `[confirmed]`
`json.maxItemsComputed` has default 5000 [10] and its description reads "The maximum number of outline symbols and folding regions computed (limited for performance reasons)." [11]. The cap is on derived structure (outline, folding), not on opening. What the editor does about a file over the general large-file threshold is covered by vector 01. JSON validation limits were not found in these sources.

### DAT-08 · Excel and VisiData set the ceilings users expect  `[confirmed]`
Excel's worksheet limit is "1,048,576 rows by 16,384 columns" [12]. VisiData describes itself as able to "handle millions of rows with ease" [13]. Modern CSV claims it "can load a file 28 times faster than Excel" and handles files beyond the million-row limit, a vendor claim [14]. Tad is "powered by an in-memory instance of DuckDb" and scrolls millions of rows [15], so it trades memory for query power; that fits a query tool, not a reader.

### DAT-09 · Canvas vs DOM grids  `[confirmed]`
Glide Data Grid's authors say they moved from `react-virtualized` DOM rendering to canvas because "Once you need to load/unload hundreds of DOM elements per frame nothing can save you", and "Cells are rendered lazily on demand for memory efficiency" [16]. For this app: a windowed table of a few dozen rows with fixed row height is cheap in the DOM; canvas would cost find-in-page, selection and accessibility.

### DAT-10 · Quoted newlines break naive line/record indexes  `[likely]`
A write-up on CSV parsing notes a mistake of "Didn't work for quoted new lines" in the first, line-based version [17]. A search summary of the VLDB 2026 "csveee" paper says the difficulty of parallel parsing is "determining the parser state at the beginning of each chunk"; I could not read the PDF text. Practical rule: a chunked index scan must carry quote state across chunk borders; sequential in one pass is safe, parallel needs speculation or a second pass.

### DAT-11 · Papa Parse: step, chunk and worker modes  `[confirmed]`
Papa Parse's `chunk` callback is "executed after every chunk of the file is loaded and parsed rather than every row" [18]; `worker: true` and `step` exist, and `Papa.LocalChunkSize` defaults to 10 MB [18]. The app has its own record scanner, so what matters is the shape: stream chunks, emit rows, never hold the whole parse result.

### DAT-12 · Hex Fiend: bytes stay on disk  `[confirmed]`
Hex Fiend "can work with arbitrarily large files without reading the entire file into memory", including edits and saves "without requiring any additional temporary disk space" [19]; its site says it "does not keep your files in memory" [20]. The B-tree byte array behind this (file names `HFBTree*`) is from a search result listing, not read `[likely]`.

### DAT-13 · V8/JSC `JSON.parse` memory, throughput and deep nesting  `[absence]`
No primary source with a MB/s figure, a heap-multiplier measurement or a depth limit for `JSON.parse` in V8 or JavaScriptCore was found. Blogs claim 3–8x heap expansion over file size without measurement; treat as `[unverified]`. V8's blog only says `JSON.parse('…')` is "much faster to parse, compile, and execute compared to an equivalent JavaScript literal" [21]. This app's own 256-depth limit is a safe choice. Measure on both WKWebView and WebView2 before trusting any figure (vector 06 can own this).
**Searched:** web search "JSON.parse large file memory overhead V8 stack overflow deeply nested"; v8.dev blog (json-superset page 404); no MDN/engine bug page with a number surfaced.

### DAT-14 · JSON Crack, jless, fx limits  `[absence]`
JSON Crack documents a node limit set by `NEXT_PUBLIC_NODE_LIMIT` [22]; the default is `NEXT_PUBLIC_NODE_LIMIT=1200` in `apps/www/.env` of its repository (read 2026-11-27 by the verifier from raw.githubusercontent.com; not a saved source). jless's page describes expand/collapse but states no large-file design [23]. I found no fx design doc.
**Searched:** GitHub READMEs for jless and JSON Crack; search for fx large-file design (nothing found).

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Whole `JSON.parse` then render tree (today under 1.5 MB) | Fine for small files | Heap several times file size | Freezes past a few MB (Firefox bug) | Keep below cap only |
| Node index (typed array) plus lazy expand | Matches row/line indexing already used | One scan; ~tens of bytes per node | Index memory on huge files; needs cap | Adopt |
| simdjson wasm | Fast stage 1 | Dependency, wasm size, allow-list | Complexity; JS scan may be enough up to 50 MB | Defer; consider if JS scan too slow |
| Canvas grid | Fast scroll | Lose find, selection, a11y | Reader must support copy and find | Reject |
| Cap and fall back to raw text view | Cheap | Loses structure | Users must be told | Always include as last tier |
| Per-record objects in an array | Simple | Large heap | GC pressure | Avoid |

## Open questions
- Index cost per JSON node and per CSV row in this app's own scan on WebKit: needs a benchmark on a 50 MB fixture.
- Whether parallel/chunked CSV indexing is worth speculation at 50 MB; a sequential scan probably suffices.
- klogg's compression scheme (block size, bits per line) was not read; `compressedlinestorage.cpp` would settle it.
- Real numbers for `JSON.parse` on WKWebView (DAT-13).

## Cross-links
- Vector 01 (code editors): VS Code and CodeMirror large-file thresholds; compare with DAT-07.
- Vector 04 (dom-rendering): windowing and find-in-page for a lines view of Markdown.
- Vector 06 (main-thread): worker indexing, ranged reads from the Rust shell for hex, structured-clone cost of transferring index arrays (use transferables).
- Vector 09 (buffers-memory): typed-array line index memory, offset maps.
- Vector 10 (guardrails): the "Rules for new features" above are lintable by counting index builds and DOM nodes.

## Sources
1. On-Demand JSON: A Better Way to Parse Documents?, Keiser and Lemire (arXiv 2312.17149, html v3) — https://arxiv.org/html/2312.17149v3 (accessed 2026-11-27) — stage 1 structural index, lazy materialisation.
2. bigJson viewer page — https://hi-malay.github.io/bigjson/ (accessed 2026-11-27) — flat node index, render visible rows (maker's claims).
3. klogg README — https://github.com/variar/klogg (accessed 2026-11-27) — reads from disk, >2^31 lines.
4. klogg `compressedlinestorage.h` — https://raw.githubusercontent.com/variar/klogg/master/src/logdata/include/compressedlinestorage.h (accessed 2026-11-27) — compressed monotone line array.
5. klogg `linepositionarray.h` — https://raw.githubusercontent.com/variar/klogg/master/src/logdata/include/linepositionarray.h (accessed 2026-11-27) — simple and compressed storage.
6. lnav NEWS — https://raw.githubusercontent.com/tstack/lnav/master/NEWS.md (accessed 2026-11-27) — line-limit, per-file memory, `file split`.
7. less(1) manual — https://man7.org/linux/man-pages/man1/less.1.html (accessed 2026-11-27) — no up-front read.
8. Mozilla Bugzilla 1363222 — https://bugzilla.mozilla.org/show_bug.cgi?id=1363222 (accessed 2026-11-27) — JSON viewer slow for large JSON.
9. Mozilla Bugzilla 1804655 — https://bugzilla.mozilla.org/show_bug.cgi?id=1804655 (accessed 2026-11-27) — 8 MB file, raw-view fallback suggested.
10. VS Code json-language-features package.json — https://raw.githubusercontent.com/microsoft/vscode/main/extensions/json-language-features/package.json (accessed 2026-11-27) — `json.maxItemsComputed` default 5000.
11. VS Code json-language-features package.nls.json — https://raw.githubusercontent.com/microsoft/vscode/main/extensions/json-language-features/package.nls.json (accessed 2026-11-27) — setting description.
12. Excel specifications and limits — https://support.microsoft.com/en-us/office/1672b34d-7043-467e-8e27-269d656771c3 (accessed 2026-11-27) — row and column limit.
13. VisiData — https://www.visidata.org/ (accessed 2026-11-27) — millions of rows.
14. Modern CSV — https://www.moderncsv.com/ (accessed 2026-11-27) — vendor claim.
15. Tad — https://github.com/antonycourtney/tad (accessed 2026-11-27) — in-memory DuckDB.
16. Glide Data Grid — https://github.com/glideapps/glide-data-grid (accessed 2026-11-27) — canvas rationale.
17. Efficient CSV parsing notes (secondary) — https://tinfoil-knight.github.io/notes/efficient-csv-parsing---on-the-complexity-of-simple-things-2024 (accessed 2026-11-27) — quoted newline failure.
18. Papa Parse docs — https://www.papaparse.com/docs (accessed 2026-11-27) — chunk, step, worker, chunk size.
19. Hex Fiend framework docs — https://hexfiend.github.io/HexFiend/docs (accessed 2026-11-27) — arbitrary-size files.
20. Hex Fiend site — https://hexfiend.github.io/HexFiend/ (accessed 2026-11-27) — "does not keep your files in memory".
21. V8, The cost of JavaScript in 2019 — https://v8.dev/blog/cost-of-javascript-2019 (accessed 2026-11-27) — JSON.parse vs literal.
22. JSON Crack — https://github.com/AykutSarac/jsoncrack.com (accessed 2026-11-27) — node limit env var.
23. jless — https://github.com/PaulJuliusMartinez/jless (accessed 2026-11-27) — features.
