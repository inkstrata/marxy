# Marxy todo

Open work. A row leaves this file in the pull request that lands its branch on `main`, or when the work is dropped;
`pnpm work todo --check` names the rows whose branch has landed. Ids are for `work/` only: they never go in code,
comments, tests, commit subjects or `docs/`. The layout and rules for this folder are in `README.md`.

Carried over on 2026-11-23 from `..\marxy-todo.md` when round 9 landed (master `ee56607d`). Ids are kept, so the gaps are
the rows that landed: F1 to F4, F7, W1 to W4, P1, P2 and S1 to S7; round 10 (master `47513544`) landed F8 to F11 and S8; round 13 (master `64589ba8`) landed S16 and F18 to F20; round 14 (master `7779ec46`) landed F21, F22 and P8; round 15 (master `17cfe661`) landed P9, P10 and F23.

Moved into the repository on 2026-11-26 with the reader architecture. Until then this tracker lived beside a Windows
checkout with no remote; the branch names in it (`budgets-4`, `geometry-table` and the rest) are branches of that
checkout, and none is on GitHub; on 2026-11-27 the owner chose not to recover them. They are lost (M1): P11, P12, F24,
E22 and E23 are being rebuilt on `main` from their run accounts, under new branch names (E23 was folded into L22 on 2026-11-27).

Rows B1 to B16 came from the first bug hunt (2026-11-27). Their ids such as `EXP-02` are findings in
`runs/2026-11-27-hunt-01/findings.md` and `verification.md`, and their probe paths are under that folder.

## Carry over

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| M1 | The Windows checkout's unlanded branches are lost: never pushed, and the import (#773) carried master over without history, so no machine has them. Round 16 (`budgets-4`, `budgets-5`, `teardown-2`, integration `1f141eb1`: P11, P12, F24), wave 5 (`geometry-table`, `near-typeset`, integration `0a9eeb68`: E22, E23), `web-shell` (`33e6bc09`: S17) and `open-with` (F26). Their briefs, reviews and measurements survive in `runs/2026-11-24-round-16/` and `runs/2026-11-26-wave-05/`; S17's report in `reports/2026-11-23-reach-beyond-desktop/`. Rebuilt on `main` under new names; S17 and F26 kept as notes under Later | Reviewed, finished work has to be built a second time; this row leaves with the last rebuilt branch | L | `budgets-text`, `budgets-containers`, `teardown-rest`, `geometry-table` |
| M3 | Run Marxy on a Linux desktop | The build, unit tests and `cargo test` pass on CI Linux, and the smoke launch paints under Xvfb; nobody has used the window, file dialogs, tray or a real save on Linux | M | |
| M4 | 14 browser test files fail on macOS WebKit, alone as well as in the suite (2026-11-26): capability (`frame-fonts`, `frame-media`, `frame-viewers`: macOS WebKit draws or plays what Windows WebKit could not), layout and metrics (`page-states`, `splice-all`, `source-structure`, `leave-split`, `demo-tour`), timing (`large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`), and `operations-copy` (two lazy highlight chunks, javascript and css, load when none are expected; fails alone on main too), and `reading-lines` (find, the level filter and a jump to a byte: a 30 s wait times out; fails alone on main too, 2026-11-27). Logs in `runs/2026-11-26-import/` | The suite has only ever been green on Windows; CI runs it there until these pass, then adds `browser` to the macOS job | M | |
| M5 | Hosted `windows-latest` browser files: the 14 listed here were made to pass on a hosted runner (one full green run, 123 tests; a later run failed one archive-page line, since loosened). The `browser-windows` workflow is on `main` and runs weekly (Wednesday). Still to do: repeat green runs, and a full `pnpm verify --tier changed` on a hosted Windows runner | One green run is not a stable suite; the browser files join the pull-request checks only after repeat green runs | S | |

## Release

The first tag of the reader architecture: v0.2.0, a macOS pre-release. The plan, its order and gates, and the
investigation behind these rows are in `reports/2026-11-26-release-readiness/`. The hand run on the Mac was done on
2026-11-27 and round 16 (P11, P12, F24) is not waited for; R10 and R11 turned out real; each is fixed on a branch of its own. R1 (macOS CI) landed with #774.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| P11 | Budgets, slice 4 (lines of text): (paste classify and JSON Lines records are done) `carriesMarkdown` O(L^2) per line, lines uncounted below 5 MB (`reading/index.ts`) (the word diff's token cap is done) | A hostile file or paste can hang a reading | S | |
| E22 | Geometry table as a byte model for every page: one record per top-level block, built from the parse before any HTML (byte length, height in whole grid units estimated per block kind or measured, flags for measured, mounted and typeset), prefix sums rebuilt lazily, `splice` over blocks, an anchor of block, byte and grid units; a mounted-set adapter (ResizeObserver over mounted blocks) feeds measurements and is the only way to mount (`ensureMounted`, `mountThrough`); position, restore, the spine, the hold mechanisms and Source return read it. Keep `geometry-table`'s pure half, its tests and its four guards; replace its records derived from `article.children` (no record for an unmounted block, a new block at height 0, every later top shifted in a loop) | Research `docs/research/windowed-pages/` D-03 and D-04 (CMP-11, CMP-12, HMP-12, ANC-11, EDW-10). First in the windowing order: the core starts now beside L21 and L27; the adapter and the readers touch `view/rendered-view.ts`, `position/` and `render/post.ts`, so L22 lands after them or rebases | L | `geometry-table` |
| L32 | Plain text of a few MB with no blank line, or Markdown with a reference definition, now opens without a hold but pays its whole parse (about 0.4 s per MB, 2 s at 5 MB) at the first Source, outline or transform | S2; `parseBehind` (`document/open.ts`) skips the background parse when `slicesWithin` is false, so the store parses on first ask; send uncuttable text past a size to the lines reading (which skips the parse), or run the core parse in a worker (L24) | M | |

## Structure

From the code-quality review of 2026-11-27 (`main` `b30bf002`): `reports/2026-11-27-code-quality.md`. Q1, Q5 and Q9
touch none of the files M1's branches change and were started that day. Q3, Q4, Q6 and Q7 cut through
`rendered-view.ts`, typeset, the core readers or most import lines, so they wait for M1.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| Q2 | One key router that knows what owns the keyboard (page, editor, modal, menu, palette, viewer): 53 keydown listeners and about 10 document or window dispatchers ordered by capture phase and `stopPropagation`; whether a modal is open is decided at 16 sites with four or more selectors; `inEditable` twice. Takes P5's "route keys once" | Key bugs such as a menu that stops taking arrows come from that ordering. After the menu-freeze fix lands | L | |
| Q3 | Front-end layering: 38 of the 42 folders are in one value-import cycle; `appHandle()` is called 202 times in 78 files, viewers and document code included. Narrow interfaces passed in instead of the global; a dependency-direction rule in `check-boundaries` with a baseline that only shrinks; `frame/` as a named UI kit, the one-to-three-file folders merged | Nothing can be moved or tested alone. After M1, so the new rule fails no in-flight branch | L, gradual | |
| Q4 | Core's public surface: 489 imports of `@marxy/core/src/...` in 223 files (132 through the package), no `exports` map. Add the map and rewrite the imports; then split core into the Markdown engine, the format readers (about 13k lines: office, book, mail, archive, certificates) and the workspace (index model, paths, layout, position) | The import rewrite is what makes any later move cheap; it touches 223 files, so after M1 | M | |
| Q5 | Browser tests a hosted runner can pass: 466 fixed sleeps in 125 files, 441 launches for about 2,050 tests, timing budgets asserted as pass or fail, one preamble pasted 150 to 237 times. A shared test kit, waits on conditions, one boot per file, budgets recorded rather than failed; first slice: 20 to 30 files on a pull-request smoke job | CI runs no browser test (M4, M5) | L | `browser-test-kit` |
| Q6 | Split the long functions: `createRenderedView` (S9) with one scroll keeper for its five or more hold mechanisms and one place type for the eight or more the app has; typeset `attach()` (about 900 lines) after `split-place` and `fold-typeset`; `createArchiveViewer` 1,372, the table lens 1,091, `createOpenPath` 1,003, `readRtf` about 736 lines | 43 front-end functions are over 200 lines. After M1, with E22 | L, gradual | |
| Q7 | One windowed-row engine for the six or more lists that build their own (side-panel rows, reading rows, reading lines, table lens, hex, archive) | Each has its own scrolling bugs. With E22 | M | |
| Q8 | Shared pieces, what is left after the platform check, the UTF-8 byte count and the grouped count got one owner each: the scaffolding every viewer repeats; 12 hand-made caches; in core four `extensionOf` and 11 line splitters; in Rust a second `ShellError` (`commands/os.rs`), 89 platform `cfg` lines inline in `atomic_write.rs`, and `main.rs` at about 1,700 lines of non-test code with two `#[path]` includes | Copies drift; owners are named in `docs/principles.md` | M, gradual | |

## Big files

Files of 1 to 5 MB fail or crawl (the owner, 2026-11-27). The account, the measurements and the order are in
`reports/2026-11-27-big-files.md`; the research is `docs/research/large-files/` and the rules for new work
`docs/big-files.md` (both with the `agent/scale-guard` pull request). Rows L1 to L19 are hunt 03's verified findings
(`runs/2026-11-27-hunt-03/`); L20 to L28 are the structural work the research recommends, which removes whole classes of
them. Numbers are headless Chromium on a loaded Mac unless said; growth is per doubling of the file (2 is linear).
Eight were fixed before this section landed, so their ids are gaps: L1 by #804 (layout reads between a batch's writes)
and #807 (the Chromium restyle), its remainder being the grid pass (L30) and R13; L2 and L3 by #808, which added L30 and
L31; L4 and L6 by #806; L12 by #797; L13 by #805; L14 by #798. Since `docs/research/windowed-pages/` (2026-11-27) the windowing rows are in build order: E22's core with L21 and L27, then E22's readers, L33 and L22, then L23; tier 1 is dropped and the whole-page fixes it removes are under Parked.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| L21 | A scale record at open, read by every feature: bytes, lines, longest line, then blocks, list items and rows; classes normal, heavy (about 1 MB or 5,000 blocks), huge (5 MiB); a long-line trigger; the page says once what is turned down; and a node count predicted from the parse, which L23's mounting policy compares with the node budget (L27) | Research D-02 (EDS-01, EDS-03, MDA-02); today each feature keeps its own limit (`docs/file-kinds.md`, "Size limits"). Windowed-pages D-02: classes by predicted nodes, bytes as a backstop (#831 puts heavy at about 25k nodes on Windows). The core half is drafted in #828. In parallel with E22's core | M | scale-record |
| L27 | Node budget set at 10,000 nodes under the article (elements and text nodes), one constant for both engines: WebKit's whole-article layout reaches 16-18 ms there and grows linearly, 20-30x Chromium's per node (windowed-pages D-02, NOD-01, NOD-02; Windows Chromium in #831 put it at about 20,000). Left: the constant and the parse prediction wired into L21, the two probes (`docs/research/windowed-pages/probes/`) re-run in the real WKWebView and WebView2 windows, and a guard on typesetting work for dense pages, whose queue breaks before the node count does (NOD-03) | The number is measured in Playwright's WebKit and Chromium on a loaded Mac, not in the real windows; raising it later is one constant, not a code path | S |  |
| L33 | Find, select all and copy over the model: find matches a per-block rendered-text cache (the walk's `collectText` over each block's fragment), not the DOM; select all is the selection model's `document` kind; Copy builds text from the cache and HTML from the parse without mounting; only mounted matches become highlight Ranges, the others mount through first; a test that the cache equals the DOM walk over the fixtures | Research windowed-pages FSC-01 to FSC-16. #819's find and copy over pending blocks needs the blocks as inert DOM, which L23 drops. Beside E22's readers (`find/`, `selection/`) | M |  |
| L22 | Typesetting by distance: blocks are set as they mount, ranked by grid-unit distance from the reading line with a forward bias in the scroll direction, with no whole-page idle queue; `typesetThrough(target)` for jump-to-heading, links and search results; the grid pass's origin read (`grid.ts`, step 2) made local so a far block snaps without the blocks above it set; a block the engine has not laid out is not yet measurable, never set and done; the paragraph cap (start at 20,000 characters) stays | Research windowed-pages D-04 and D-07 (TBD-01 to TBD-04, TIR-02); takes E23. Line breaking costs 0.01-0.8 ms a paragraph; the cost is Range-rect reads and the article layout after each batch. Meets E22 in typeset's `attach()` and the view's `snapChanged` | M |  |
| L23 | Windowed Markdown pages, tier 2 only (tier 1 dropped): one policy, `mountedSet(scale, viewport, setting)`, is the only reader of the node budget; below it every block is mounted (today's page), above it the blocks within about two screens, spacers from E22, far blocks unmounted, place kept by the anchor loop (`scrollTop` corrected in the same frame); a heading skeleton always mounted; a whole-page setting for screen readers (budget off, typesetting still by distance) and mounting that follows DOM focus; print mounts the printed range with native wrapping; the browser suite also runs once with the budget forced to 0 | Research windowed-pages D-01, D-06 and D-07: `content-visibility: auto` leaves paragraphs unset in WebKit (14 of 5,726 at 2 MB) and doubles Chromium's open with no gain (TIR-02, TIR-04); unmounted text leaves the accessibility tree (ACC-01, ACC-12). After E22, L22 and L33. Removes L8, B19, R13 and the key and scroll half of L10 above the budget | L |  |
| L10 | A one-block edit, undo and a reload each cost 2-6 s of main-thread work on a 1 MB Markdown page, about 2x per doubling: the splice rewrites `data-marxy-s`/`-e` on every later element (`render/incremental.ts`, `shiftFrom`/`shiftTree`) and then rebuilds the block list with a rect per block (`view/rendered-view.ts`) | S2; hunt-03 MEA-05. Still matters below the node budget (windowed-pages D-05, EDW-02, EDW-03); E22 storing lengths removes the shift. The key and scroll half (0.1-0.3 s a key at 0.5-1 MB, MEA-04) is parked with L23 | M |  |
| L34 | Print of a typeset page probably keeps the screen's line breaks: set paragraphs are `nowrap` with breaks at the screen's width, and `printPane` calls `window.print()` without undoing them (no print run yet) | Research windowed-pages TBD-09 (`[likely]`, from the code). Print one at A4 to confirm; the fix, native wrapping for print, goes with L23's print | S |  |
| L16 | Every edit re-decodes the whole file and rebuilds its offsets: 30-60 ms of CPU at 4.9 MB, 0.2 s at 4 MB when the file holds one byte that is not UTF-8 | S3; `buffer/buffer.ts` `splice` calls `makeBuffer`; hunt-03 EDT-01, EDT-02. L26 | M | |
| L19 | The save check hashes with portable SHA-256 on Apple silicon (0.3 s of CPU at 40 MB); the rest of the shell's costs (non-UTF-8 decode map, Read with encoding's counts, the watch rescan of a big folder) landed with `shell-costs`; this part waits for `keep-created`, which owns `atomic_write.rs` | S3; `src-tauri` `atomic_write` hash; hunt-03 SHL-03 | S | |
| L20 | The rest of the loops move onto `yieldToMain` in `apps/desktop/src/scheduler/`: `kinds/table-lens.ts` and `kinds/transcript-view.ts` (held back while other branches had them open), the `setTimeout(0)` yield loops (compare, log, recorder, notes, `left/doc-model.ts`, archive sheet, PDF, `source/frame`, transforms, `render/highlight.ts`, `source/find-scan.ts`), and `packages/typeset/src/scheduler.ts`, a second scheduler (waits for the `grid-sliced` branch); the scheduler and four sites are landed | `docs/architecture.md` (`scheduler/`); one owner per concern (`docs/principles.md`) | M | |
| L24 | The Markdown parse in a worker: slices at safe block boundaries, the definitions index kept, a definition change reparsed there while the old page stays, caps on nesting and brackets before micromark, a block table and per-block HTML sent back, panels fed derived tables | Research D-03 (PRS-01, PRS-05, PRS-06, PRS-08, PRS-13). A file with a definition is parsed whole in one task today (2.3 s at 2 MB; hunt-03 RDR-02, RDR-01, by design in `docs/architecture.md`). Panels fed derived tables also remove B17 and B18 at the root | L | parse-worker |
| L25 | JSON as a typed-array node index with lazy expansion and leaf decoding past a low threshold; record scanning for CSV, TSV and JSON Lines that tracks quotes | Research D-08 (DAT-01, DAT-10). Covers L6 and L15 | M | |
| L26 | Derived copies lazy and bounded: the text and the UTF-16-to-byte map made per range with checkpoints about every 1 KB, line starts in a `Uint32Array`, undo under a byte cap, diff on line hashes under time and size caps, the whole-page HTML and sanitised-page cache kept only below a size | Research D-07 (BUF-03, BUF-04, BUF-08, BUF-12). Covers L16 and the decode half of L19 | M | |
| L28 | Lower `check-scale`'s recorded counts (363 unbounded shapes in 165 files on 2026-11-27, after #798 removed most spreads): layout reads and DOM queries in loops first (157), then spreads (80) and whole-text line splits (68) | Research D-09; `scripts/allowlists/scale.json` | M, gradual | |

## To try in a real window

| # | What | Branch |
| --- | --- | --- |
| W5 | Round 6 by eye: line icons, the room changes, top-edge wake and left-edge peek with a real pointer, Notepad writing during a 20 MB save, an SMB share | Ian |
| W6 | Real files: an iPhone HEIC, real PSD and DDS files, WMA/AC3/AMR, a signed installer opened through the UI, and real `.doc`, `.ppt`, `.deb`, `.cab`, `.iso`, `.rar` | Ian |
| W7 | Install round 9's build here: `builds\20261123-0631-ee56607d` | Ian's word |
| W8 | A frames-only launch: `check:tauri` judges the first launch's painted mark (text within 1500 ms of the render, a frames-only launch tagged `source=frame`), but no run has hit a frames-only launch yet; on an engine-paint launch (the only kind seen, 175 ms) it passes with or without the 2 s stall fix | |
| W9 | A file in a OneDrive placeholder (cloud-only) still opens: the head read compares the opened handle's final path; a subst drive and a network path are in check:tauri | Ian |
| W10 | VoiceOver on macOS and Narrator on Windows over a windowed 2 MB page once L23 lands: read-all past the window, the rotor's headings list, find, and the whole-page setting (windowed-pages ACC-12) | Ian |
| B11 | Go on the search page does nothing (the owner's report). Not reproduced in the browser build or in Playwright WebKit with Mac keys (alone and in a split, docked): `o` on a hit, the foot's `o go` button, a click, a double-click, Cmd-click (opens beside), a click on a file row, Enter on a hit (verb menu, then Go) and the Line's `#` all go; Enter with Replace filled replaces, as meant. Two presses do nothing by design: Enter in the Find field only moves the cursor into the list, and Cmd+Enter there is ignored (the panel's keys skip Cmd chords). Not tried: floating drawer, the real Mac window. Which key or click did the owner press? hunt-01 NAV-01, NAV-06 | Ian |

## Waiting on Ian

| # | What | Where |
| --- | --- | --- |
| R14 | Decide the release: v0.2.0, a pre-release, round 16 before the tag, wave 5 after it, the file-association set, ad-hoc signing for now | `reports/2026-11-26-release-readiness/README.md`, "Decisions for the owner" |
| B13 | Pasting HTML into Source of a file that is not Markdown converts it to Markdown, as `docs/using-marxy.md` promises: fences in a `.py` file, escaped and invalid JSON, a pipe table in a `.csv`, `**bold**` in a `.txt`. Should such a paste go in as plain text? (hunt-01 EDT-03, judged by design) | `docs/using-marxy.md:263-266` |

## Parked

Whole-page fixes the windowed-pages research parks (D-05): above the node budget L23 removes their cause, and below it they cost little. Reopen one only if L23 slips past the release that needs it.

| # | What | Why | Size |
| --- | --- | --- | --- |
| R13 | A 1 MB Markdown file shows its text in 1 to 4.4 s on macOS, but the main thread stays busy long after: 22 s in Chrome, 42 s until WebKit has set every paragraph, with 50 to 100 ms frames meanwhile (Windows Edge: 78 s, the progressive mount laying out per chunk). Switching back to its tab costs 27.8 s more in Chrome. Measured 2026-11-27, `reports/2026-11-26-release-readiness/07-macos-one-mb.md`; the real app window not measured. On macOS (hunt-02 CMD-03) a 1 MB file with hard breaks, links, lists and tables keeps tasks over 50 ms coming for 20 s after it opens (36 tasks, 2.4 s), a plain 1 MB file none, and a 3 MB rich file takes over 10 s: content, not size; probe `runs/2026-11-27-hunt-02/probes/CMD/busy.verify.mjs` | Long files are a stated use. Parked by windowed-pages D-05: L23 removes the cause above the node budget | M |
| L8 | End on a page still mounting stops short (2 MB: at 1.34 MB of 2.0); reaching the end takes about seven presses over 60 s | S2; the jump goes to the last mounted block; hunt-03 NAV-03. Jump by byte through the geometry table (E22). Parked by windowed-pages D-05: L23 removes the cause above the node budget | S |
| B19 | Opening, folding or hiding the drawer, or changing the window's width, stalls a 1–3 MB page for 0.15–0.45 s each time | S3 slow; a width change relays the page and rebuilds the whole block list, with `getBoundingClientRect` called about 7,000 times at 1 MB and 90,000 at 5 MB; hunt-02 RDR-01 (with NAV-03) and RDR-02, probe `probes/RDR/layout.verify.mjs`. Looked at in `panel-parse-once` and left: a width change really moves every block, and `buildBlocksByRange`/`buildBlocks` (`render/post.ts`) already read in one batch (no write between reads, so one layout); the cost is the layout of the whole page plus one rect per block, which only goes with estimated geometry for blocks off screen, so this waits for E22. Parked by windowed-pages D-05: L23 removes the cause above the node budget | M |

## Later

| # | What | Why | Size |
| --- | --- | --- | --- |
| S17 | Spike: a shell over the File System Access API, booted by a web build, reading and saving a real folder in Chrome. The spike branch was lost (M1); its report, with what a browser host keeps and loses, is in `reports/2026-11-23-reach-beyond-desktop/`. Nothing of it was in the desktop build. Re-spike only if a web host is wanted | Measures what a browser host keeps and loses before any reader moves to wasm; research, after the tag | M |
| F26 | More files recognised by name: the lost `open-with` branch (M1) added `.apng`, `.cbz`, `.msix`, `.gpkg`, `.plist` and others to the kind registry and aliases, with the installer's file-association hooks and `docs/file-kinds.md` following; only its "Open with" installer test reached `main` (2026-11-23). Port the extensions wanted, from the list in `reports/2026-11-26-release-readiness/05-outstanding-work.md` | Decide with the file-association set (R14) | S |
| F5 | Place restore failed once under full-check load (94 of 95), not reproduced in 4 runs | Watch; give it a wait or find the race if it returns | S |
| F6 | Facts readers for wma, ac3, amr | Only if such files turn up | S |
| F25 | `undo-endings.test.mjs`, "a save that makes a mixed-ending file uniform, then Mod+Z": passed 4 of 7 runs on `main`; when it fails it times out at the wait after Mod+Z (`!canUndo`), a key the test allows to do nothing | Waits on a condition that may never come; convert with the kit (`apps/desktop/test/support/kit.mjs`) | S |
| S10 | Watch: the 2 s flat poll stats symlink targets, SMB included; needs a rule for which links are followed (`src-tauri` watch) | Polling a share costs | M |
| S9 | `createRenderedView` is about 2,600 lines; listeners added far outnumber those removed (`view/rendered-view.ts`) | Goes with P3 and P5 | L |
| P4 | `budgets`: untrusted input gets work budgets everywhere, not branch by branch | Each format found its own gap in review | L, gradual |
| P5 | `one-view`: split the view's main function (Q6); routing keys once is Q2 | See S9 | L, gradual |
| P6 | `invites`: `.ics` and `.vcf` as cards; the usable parser is MPL or large | Held | S |
| P7 | `read-aloud`: the page read by a local Windows voice | Held | M |
| R15 | iCloud Drive placeholder ("dataless") files are not recognised: a read, the index walk or a save may stall while the file downloads | Unverified; try it by hand on the Mac | S |
| R17 | Browser files on macOS overran their waits by minutes (`frame-media`, `frame-viewers`, `frame-pdf`); the runs coincided with the laptop sleeping, so re-run them held awake (`caffeinate -i`) before calling any of it a hang | Settles whether the browser suite can join the macOS CI job (M4) | S |
| R18 | Round 16's review residue: the held-open queue is unbounded while no boot listens; a cap would drop opens silently, so it needs a rule for what to do past one (`runs/2026-11-24-round-16/README.md`) | After round 16 lands | S |
| R19 | Waves 1 to 4 residue: the warm store is lost after a same-tab link and Back and after a cross-file replace; `typeset-view`'s block-list patch applies in about half the cases (`STATE.md`, "Risks") | Speed, not correctness | S |
| L35 | Transforms that rescan from every `[^` (`transforms/clean.ts`) or `](` (`transforms/case.ts`) on one long line may be quadratic | Found reviewing the link-scan fix (2026-11-27). Measure on a long line before fixing | S |
| B22 | In an archive or embed preview, a broken (unparseable) data file of 256 KB or more that is not UTF-8 is drawn as every line (the pane is fine) | `render/embed-page.ts` reads the reading's lines as UTF-8 only, and `unreadable` (`reading/index.ts`) windows UTF-8 files only: decode the entry for the reading as the pane does (`textForStore`), then window it | S |

## Housekeeping

About the machines' workspaces, not this repository.

| # | What | State |
| --- | --- | --- |
| H6 | About 570 worktrees beside the Mac checkout are from the earlier architecture, 93 with uncommitted edits, and its main checkout holds 345 untracked files under `orchestration/` | The weekly clean archives and removes them (a patch and tar per dirty worktree, an `archive/branch/<name>` tag for a tip not safe elsewhere); the 345 untracked files in the main checkout stay by hand, and never `git clean` it. The Windows machine's old-pipeline leftovers were archived and removed on 2026-11-27; only the Mac's remain |
