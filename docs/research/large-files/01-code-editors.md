---
corpus: large-files
id: 01
slug: code-editors
prefix: EDS
title: How code editors handle big files
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [VS Code, Monaco, largeFileOptimizations, piece tree, CodeMirror 6, height map, Lezer, Zed, rope, SumTree, JetBrains, bigfile.nvim, Sublime, large file mode, thresholds]
---

# 01 · How code editors handle big files

> Question: how do VS Code, CodeMirror 6, Zed, JetBrains, Sublime and Neovim keep big files usable, at what thresholds do they degrade, and what do they switch off? Answer in brief: every editor stores text in a tree (piece tree, B-tree of lines, rope) so edits and line lookups are O(log n), draws only a viewport, and treats a size or line-count threshold as a one-way switch that turns off per-document analysis (tokenising, folding, wrapping, symbols) rather than slowing everything. Thresholds are in the 1.5 to 20 MB range for "turn features off" and the tens of KB for "this one line is too long". The pattern that fits a CM6 source view plus a typeset HTML page is a decision made once at open, from size, line count and longest line, that selects a cheaper mode.

## TL;DR
- VS Code decides once, at model creation: over 20 MB or over 300,000 lines turns off tokenising, wrapping, folding, codelens, word highlighting and sticky scroll (EDS-01, EDS-02). The decision is never revisited for that model.
- Line length is a separate cap in every editor that has one: VS Code does not tokenise lines over 20,000 characters and stops rendering a line after 10,000 (EDS-03). bigfile.nvim and snacks.nvim also test average line length (EDS-08).
- CodeMirror 6 has no large-file mode. It relies on a B-tree document, a height map of estimated heights, a viewport of about 1000 px margin, and time-budgeted Lezer parsing (EDS-04 to EDS-06). Its author says a bigger viewport makes it less responsive and cannot be configured (EDS-05).
- JetBrains has the clearest two-tier table: 2,500 KB for coding assistance, 20,000 KB to open at all (EDS-07).
- Thresholds are cheap one-time checks (bytes, newline count, max line length). The expensive per-feature work is what they gate.

## Recommendation for this setup

1. **Add one open-time "scale class" decision**, computed from byte length, newline count and longest line (a single linear scan over bytes already in hand), and store it on the document. Every feature reads the class instead of re-deriving its own limit. This is VS Code's "make a decision in the ctor and permanently respect this decision" pattern (EDS-01).
2. **Start the thresholds from VS Code and JetBrains, then tune on this app's own timings.** Suggested classes: normal below 1 MB; "heavy" from 1 MB (JetBrains 2.5 MB assistance cut, snacks.nvim 1.5 MB); "huge" from 5 MB, which is already where the lines reading begins. Add a long-line trigger (longest line over about 10,000 characters or mean line length over 1,000) because every surveyed editor treats line length as its own axis (EDS-03, EDS-08). These numbers are proposals; the sources give the editor defaults, not this app's budget.
3. **In the heavy class, turn off whole-document derived work first**, in the order the editors do: syntax colouring beyond the visible range, wrapping/typesetting of off-screen paragraphs, folding and outline, word highlighting, side-panel scans. Keep editing and find (EDS-02).
4. **Keep CM6 for the source view and do not fork its document.** Its tree and height map already scale (EDS-04). Restrict its work: only highlight `view.visibleRanges`, keep the Lezer parse time-budgeted as it is, and never set a large `viewportMargin` (EDS-05, EDS-06). For the source view, the long-line cap is the one thing to add: CM6 has no equivalent of `maxTokenizationLineLength`, so a minified 1 MB line is the case to test.
5. **For the typeset read view, copy the CM6 idea of an estimated-then-measured height table.** CM6's height map is exactly the "geometry table" already in flight: estimates for everything, measurement only for what has been drawn, a scaler when total height passes 7,000,000 px (EDS-04, EDS-09).
6. **Do not copy VS Code's piece tree or Zed's rope.** The app holds bytes and splices them; the tree structures matter for in-place edit cost at 100 MB, and the source view's CM6 already has one. See vector 09 for buffer design (EDS-10).

**Rules for new features**
- Read the document's scale class before doing per-document work; a feature that walks the whole text must be skipped or sliced when the class is heavy or huge.
- Any scan over the whole text runs once at open (size, newline count, longest line) and its result is cached; no feature recomputes it.
- Highlighting, decorations and measurement in the source view iterate `view.visibleRanges`, never `state.doc` as a whole.
- A line longer than the long-line cap is never tokenised, typeset or measured as one unit; it is truncated, wrapped by the browser, or shown raw.
- Syntax colouring and parsing are time-budgeted with an explicit millisecond budget and a pause rule (CM6 Lezer: 20 ms apply, 25 ms idle slice, 3,000 ms per 30 s chunk).
- Degraded mode is announced to the reader once (VS Code's notice names what was turned off and offers an override) and the override applies only on reopen.
- No UI feature adds a listener or a pass that is O(document) per keystroke or per scroll event.

## Findings

### EDS-01 · VS Code's large-file switch is made once, at model creation, from size and line count  `[confirmed]`
In `textModel.ts` the constants are `LARGE_FILE_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20 MB;`, `LARGE_FILE_LINE_COUNT_THRESHOLD = 300 * 1000; // 300K lines` and `LARGE_FILE_HEAP_OPERATION_THRESHOLD = 256 * 1024 * 1024; // 256M characters, usually ~> 512MB memory usage` [1]. When `largeFileOptimizations` is on, `_isTooLargeForTokenization` is set if the text is over 20 MB or over 300,000 lines, and `_isTooLargeForHeapOperation` if over 256M characters (the model refuses heap-heavy operations); the source comment reads "If a model is too large at construction time, it will never get tokenized, under no circumstances." [1] A separate `_MODEL_SYNC_LIMIT = 50 * 1024 * 1024; // 50 MB` governs whether the model is synced to extension-host workers (the comment says "used in tests") [1]. Source read from the `main` branch on 2026-11-27; I did not date the constants to a release. 

### EDS-02 · What the large-file mode turns off in VS Code  `[confirmed]`
The notice shown when a file is optimised reads "tokenization, wrapping, folding, codelens, word highlighting and sticky scroll have been turned off for this large file in order to reduce memory usage and avoid freezing or crashing." [2] It offers "Forcefully Enable Features", which sets `editor.largeFileOptimizations` to false and asks the user to reopen the file [2]. The setting's schema description is "Special handling for large files to disable certain memory intensive features." [3] The warner is keyed on `isTooLargeForTokenization()`, so the 20 MB or 300K-line rule is the trigger [1][2]. I did not find, in the files read, where the bracket-pair and word-based-suggestion paths test the flag; those are `[unverified]` here.

### EDS-03 · VS Code has two independent per-line caps: tokenisation and rendering  `[confirmed]`
`editor.maxTokenizationLineLength` defaults to `20_000`, described as "Lines above this length will not be tokenized for performance reasons" [3]. `stopRenderingLineAfter` is registered with default `10000`, minimum `-1` [4]. So line length is a separate axis from file size: a 1 MB minified file is "small" by EDS-01 but still defeats colouring and rendering at the line level. Defaults read from `main`, 2026-11-27; no change between 2024 and 2026 was found (`[absence]`, see EDS-11).

### EDS-04 · CodeMirror 6: a B-tree of lines, viewport-only DOM, and a height map for the rest  `[confirmed]`
The guide says the editor treats the document as a flat string held in a tree-shaped structure, split by line, so that updates are cheap anywhere and lines can be indexed by number [5]. Marijn Haverbeke's design post explains the choice: a B-tree whose leaves hold arrays of line objects, indexable "both by line number and by vertical" position [6]. The view "will, when updating, detect which part of the content is currently visible (not scrolled out of view), and only render that plus a margin around it" and keeps height information for the whole document, initially estimated and measured once content is drawn, even outside the viewport [5]. In `heightmap.ts` the `HeightOracle` holds defaults `lineHeight = 14` and `charWidth = 7` and estimates wrapped lines from character count [7]. In `viewstate.ts`, `VP.Margin = 1000` px, and `MaxDOMHeight = 7e6` with the comment "Beyond this size, DOM layout starts to break down in browsers because they use fixed-precision numbers to store dimensions."; above it a scaler maps heights [8]. Positions outside the viewport cannot be queried for coordinates [5]. Measured data point from the author: for a 47 ms state creation (document tree) plus 9 ms view creation on a JSON test file the lag reported by a user was not reproducible, and replacing the whole document took about 200 ms [9] (the file size was not stated in the thread; `[likely]` for order of magnitude).

### EDS-05 · CM6's author: the viewport cannot be widened, and long lines are not special-cased  `[confirmed]`
Asked in November 2024 how to render more lines to avoid blank frames in fast scrolling, Marijn answered "No, there's no way to change this. The system's performance is designed about the viewport being of limited size, and making it bigger would make the editor less responsive." [10] The guide adds that "Long lines (when not wrapped) or chunks of folded code can still make the viewport rather huge" and offers `visibleRanges` to skip invisible content in highlighters [5]. So the source view's worst cases are a very long unwrapped line and heavy wrapping (estimation then measurement). The v5 huge-document demo, which loads "a few million lines", notes highlighting stops because "the parser contains logic that limits the amount of work it does to avoid wasting too much battery and memory" [11]. The 2022 thread about very long lines was a v5 question; Marijn's answer was only that v6 does viewport-based work [12].

### EDS-06 · Lezer in CM6 is incremental and time-budgeted by constants  `[confirmed]`
`language.ts` defines `Apply = 20` ms of work performed immediately for a doc change, `MinSlice = 25` ms idle slices, `Slice = 100` ms without idle callbacks, `MinPause = 100`, `MaxPause = 500`, `ChunkBudget = 3000` ms per `ChunkTime = 30000` ms, `ChangeBonus = 50`, `MaxParseAhead = 1e5` characters beyond the viewport end, and `InitViewport = 3000` [13]. After the chunk budget is spent no more background parsing is scheduled until the editor is active again [13]. This is the best-documented example of scheduling by budget: a work-counted, not size-gated, design.

### EDS-07 · JetBrains: two published size limits  `[confirmed]`
The IDE's tuning page lists `idea.max.content.load.filesize`, "Maximum size of files (in kilobytes) that IntelliJ IDEA is able to open", default 20000, and `idea.max.intellisense.filesize`, "Maximum size of files (in kilobytes) for which IntelliJ IDEA provides coding assistance", default 2500 [14]. That is about 2.4 MB (assistance) and 19.5 MB (open). Page read 2026-11-27; the search result listing includes 2026.x versions of this page, but I read the unversioned URL.

### EDS-08 · Neovim big-file plugins gate on size and on mean line length  `[confirmed]`
snacks.nvim's `bigfile` defaults are `size = 1.5 * 1024 * 1024, -- 1.5MB` and `line_length = 1000, -- average line length (useful for minified files)`; the detection is `(size - lines) / lines > opts.line_length`. Its setup turns off matchparen, folding (`foldmethod = "manual"`), status column, conceal, completion and animations, and keeps syntax by filetype [15]. bigfile.nvim defaults `filesize = 2` MiB and can detach `lsp`, `treesitter`, `illuminate`, `indent_blankline`, `syntax`, `filetype`, set `undolevels = -1`, and switch off matchparen [16]. Both come from plugin source and READMEs, not from Neovim core. Neovim's own `synmaxcol` option exists for column limits but I could not read the options page (JS-only, the save failed), so its default is `[unverified]`.

### EDS-09 · Zed: rope of small chunks in a SumTree  `[confirmed]`
Zed's `Rope` holds `chunks: SumTree<Chunk>` [17]. A chunk is an `ArrayString<MAX_BASE, u8>` with `MAX_BASE = Bitmap::BITS` where `Bitmap = u128`, so chunks are at most 128 bytes and `MIN_BASE = MAX_BASE / 2` is 64 [18]. The `SumTree` has `TREE_BASE = 6` in release builds (2 in tests) and "The maximum number of items per node is `TREE_BASE * 2`" [19]. The 128-byte chunk width is chosen so a per-chunk bitmap can index characters, line breaks and so on. For limits, a Zed pull request refuses files at or above 6 GB: "Files that are 6GB or larger will now not open. This is a temporary workaround for inefficient handling of large files resulting in extremely high memory usage, often resulting in system freezing" [20]. The number is still current: Zed `main` keeps `FILE_SIZE_MAX = 6 * 1024 * 1024 * 1024` in `crates/worktree/src/worktree.rs` and bails with "File is too large to load" (checked by the verifier, 2026-11-27). Verification correction: the earlier "likely stale" wording is dropped.

### EDS-10 · VS Code's piece tree: why not a line array, and what it costs  `[confirmed]`
The 2018 post says the old line array used about 40 to 60 bytes per line object, so a 35 MB file with 13.7 million lines "used around 600MB memory to store the document. That's roughly 20 times the initial file size!" [21] A piece table keeps memory "close to the size of the document" but line lookup is slow, so the team cached line starts per node and then used a balanced tree (red-black) storing subtree length and line-break counts [21]. In the current source, `AverageBufferSize = 65535` chars per chunk [22]. Rewriting the buffer in C++ gave memory savings but "converting strings between a custom native representation and V8's strings is costly" [21], a data point for the Rust-to-webview boundary (vector 06). Dated 2018, still the model in `main` [22].

### EDS-11 · Nothing found on 2024–2026 changes to VS Code's thresholds  `[absence]`
No change to `largeFileOptimizations` constants was seen, but this is a weak absence and a lead, not a fact: I read the current `main` source only and the file's history was not diffed (verifier: the file was last touched 2026-11-20, history not inspected). The setting and the 20 MB / 300K / 256M constants are present now [1][3]. I did not search the release notes.
**Searched:** raw `textModel.ts` and `editorConfigurationSchema.ts` on `main` (microsoft/vscode); web query "VS Code largeFileOptimizations" was not run separately.

### EDS-12 · Sublime Text: no published threshold; long lines drive the slowdown  `[absence]`
Sublime's settings documentation read for this chapter does not list a large-file threshold (`[absence]`; searched the settings page and the forum). Forum users report that with Plain Text syntax they could scroll 45M lines "effortlessly" with about 10 GB of memory, while files with long lines degrade regardless; a user proposes a "safe mode" with no colouring or wrap, which implies none existed then [23]. A forum search also suggests Sublime turns off colouring on very long lines, without an official number. These are user reports from several versions; the thread date was not read. Helix was not researched (cut for budget).
**Searched:** sublimetext.com/docs/settings.html; forum.sublimetext.com thread 9832 and a web search for "Sublime Text large file long lines syntax limit".

## Table: editor, threshold, what degrades, source

| Editor | Threshold | What degrades there | Source |
|---|---|---|---|
| VS Code | text over 20 MB, or over 300,000 lines | tokenisation, wrapping, folding, codelens, word highlighting, sticky scroll off; permanent for that model | [1][2] |
| VS Code | over 256M characters | heap-heavy operations refused (about 512 MB memory) | [1] |
| VS Code | line over 20,000 chars | not tokenised (`maxTokenizationLineLength`) | [3] |
| VS Code | line over 10,000 chars | rendering stops (`stopRenderingLineAfter`) | [4] |
| CodeMirror 6 | no size threshold; viewport margin 1,000 px; total height over 7,000,000 px | height scaler; off-screen lines absent from DOM; parse budget 3 s per 30 s | [8][13] |
| JetBrains IDEs | over 2,500 KB / over 20,000 KB | coding assistance off / file will not open | [14] |
| snacks.nvim | over 1.5 MB, or mean line over 1,000 | matchparen, folds, completion, status column, conceal off | [15] |
| bigfile.nvim | over 2 MiB (default) | LSP, treesitter, syntax, undo history, matchparen off | [16] |
| Zed | 6 GB (temporary refusal) | file does not open | [20] |
| Sublime Text | none published | long lines slow rendering; colouring reportedly dropped on very long lines | [23] |

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| One open-time scale class (size, lines, longest line) read by all features | Direct fit; matches VS Code | One linear scan; a small module | Thresholds guessed wrongly; mitigate by tuning on timings | Adopt |
| Per-feature private limits (today's state) | Already causes whole-file work in new features | None | Regressions recur | Replace |
| Time-budget everything (CM6 Lezer style) | Fits parsing, typesetting, panels | Needs cancellation plumbing | Budget tuning | Adopt for parse/typeset; see 06 |
| Estimated-then-measured height table for read view | Same as CM6 height map | Moderate | Scroll jumps when estimates are wrong | Adopt (in flight) |
| Replace the byte buffer with a piece tree or rope | Not needed at 50 MB | High | Breaks byte provenance | Do not |
| Widen CM6 viewport | Author says no | n/a | Less responsive | Do not |

## Open questions
- Exact line of VS Code source where bracket pairs, folding and sticky scroll test `isTooLargeForTokenization`; read `textModel`'s consumers to confirm the list in EDS-02.
- Neovim `synmaxcol` default and Helix behaviour: read the options and Helix docs.
- (Closed) Zed's 6 GB refusal is still the rule: `FILE_SIZE_MAX` in `crates/worktree/src/worktree.rs` on `main` (EDS-09).
- CM6 behaviour on one very long unwrapped line in WKWebView: needs a measurement in this app (vector 04, 10).
- Sublime's actual colouring cutoff: no primary source found.

## Cross-links
- 04 dom-rendering: EDS-04, EDS-09 (height map, 7e6 px scaler) for the geometry table.
- 05 typesetting: EDS-03, EDS-05 (long-line caps, estimation) for the 100 KB unbroken paragraph.
- 06 main-thread: EDS-06 (Lezer time budgets), EDS-10 (native/JS string conversion cost).
- 08 search-highlight: EDS-03, EDS-06, EDS-08 (tokenisation caps, visible-range highlighting).
- 09 buffers-memory: EDS-10, EDS-09 (piece tree, rope, per-line object cost).
- 10 guardrails: the "Rules for new features" above, and the one-way decision pattern.

## Sources
1. VS Code `textModel.ts` (microsoft/vscode, main) — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/model/textModel.ts (accessed 2026-11-27) — thresholds and the one-time decision.
2. VS Code `largeFileOptimizations.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/codeEditor/browser/largeFileOptimizations.ts (accessed 2026-11-27) — the notice and what it lists.
3. VS Code `editorConfigurationSchema.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorConfigurationSchema.ts (accessed 2026-11-27) — `largeFileOptimizations` and `maxTokenizationLineLength` defaults.
4. VS Code `editorOptions.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorOptions.ts (accessed 2026-11-27) — `stopRenderingLineAfter` default 10000.
5. CodeMirror system guide — https://codemirror.net/docs/guide/ (accessed 2026-11-27) — data model, viewport, height info, visible ranges.
6. Marijn Haverbeke, CodeMirror line tree post — https://marijnhaverbeke.nl/blog/codemirror-line-tree.html (accessed 2026-11-27) — B-tree design.
7. CodeMirror view `heightmap.ts` — https://raw.githubusercontent.com/codemirror/view/main/src/heightmap.ts (accessed 2026-11-27) — HeightOracle defaults.
8. CodeMirror view `viewstate.ts` — https://raw.githubusercontent.com/codemirror/view/main/src/viewstate.ts (accessed 2026-11-27) — margin and MaxDOMHeight.
9. discuss.CodeMirror, "Noticable lag when dealing with large files" — https://discuss.codemirror.net/t/noticable-lag-when-dealing-with-large-files/5928 (accessed 2026-11-27) — author's timings (March 2023).
10. discuss.CodeMirror, "Improve Scroll / Performance tradeoff" — https://discuss.codemirror.net/t/improve-scroll-performance-tradeoff/8825 (accessed 2026-11-27) — author on the fixed viewport (Nov 2024).
11. CodeMirror huge-document example (v5) — https://codemirror.net/examples/million/ (accessed 2026-11-27) — parser work limits.
12. discuss.CodeMirror, "Possible performance enhancement for very long rows" — https://discuss.codemirror.net/t/possible-performance-enhancement-for-very-long-rows/4897 (accessed 2026-11-27) — v5/v6 reply (Aug 2022).
13. CodeMirror language `language.ts` — https://raw.githubusercontent.com/codemirror/language/main/src/language.ts (accessed 2026-11-27) — parse work constants.
14. JetBrains, Tuning the IDE — https://www.jetbrains.com/help/idea/tuning-the-ide.html (accessed 2026-11-27) — the two size properties.
15. folke/snacks.nvim `bigfile.lua` — https://raw.githubusercontent.com/folke/snacks.nvim/main/lua/snacks/bigfile.lua (accessed 2026-11-27) — defaults and disabled features.
16. LunarVim/bigfile.nvim README — https://raw.githubusercontent.com/LunarVim/bigfile.nvim/main/README.md (accessed 2026-11-27) — default size and feature list.
17. Zed `rope.rs` — https://raw.githubusercontent.com/zed-industries/zed/main/crates/rope/src/rope.rs (accessed 2026-11-27) — Rope over SumTree.
18. Zed `chunk.rs` — https://raw.githubusercontent.com/zed-industries/zed/main/crates/rope/src/chunk.rs (accessed 2026-11-27) — chunk sizes.
19. Zed `sum_tree.rs` — https://raw.githubusercontent.com/zed-industries/zed/main/crates/sum_tree/src/sum_tree.rs (accessed 2026-11-27) — TREE_BASE.
20. Zed pull request 27458 — https://github.com/zed-industries/zed/pull/27458 (accessed 2026-11-27) — 6 GB refusal.
21. Peng Lyu, VS Code "Text Buffer Reimplementation" (2018-03-23) — https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation (accessed 2026-11-27) — memory numbers, piece tree rationale.
22. VS Code `pieceTreeBase.ts` — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts (accessed 2026-11-27) — `AverageBufferSize = 65535`.
23. Sublime Forum, "Sublime Text performance with very large files" (secondary, user reports) — https://forum.sublimetext.com/t/sublime-text-performance-with-very-large-files/9832/27 (accessed 2026-11-27).
