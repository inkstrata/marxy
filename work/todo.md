# Marxy todo

Open work. A row leaves this file in the pull request that lands its branch on `main`, or when the work is dropped;
`pnpm work todo --check` names the rows whose branch has landed. Ids are for `work/` only: they never go in code,
comments, tests, commit subjects or `docs/`. The layout and rules for this folder are in `README.md`.

Carried over on 2026-11-23 from `..\marxy-todo.md` when round 9 landed (master `ee56607d`). Ids are kept, so the gaps are
the rows that landed: F1 to F4, F7, W1 to W4, P1, P2 and S1 to S7; round 10 (master `47513544`) landed F8 to F11 and S8; round 13 (master `64589ba8`) landed S16 and F18 to F20; round 14 (master `7779ec46`) landed F21, F22 and P8; round 15 (master `17cfe661`) landed P9, P10 and F23.

Moved into the repository on 2026-11-26 with the reader architecture. Until then this tracker lived beside a Windows
checkout with no remote; the branch names in it (`budgets-4`, `geometry-table` and the rest) are branches of that
checkout, and none is on GitHub; on 2026-11-27 the owner chose not to recover them. They are lost (M1): P11, P12, F24,
E22 and E23 are being rebuilt on `main` from their run accounts, under new branch names.

Rows B1 to B16 came from the first bug hunt (2026-11-27). Their ids such as `EXP-02` are findings in
`runs/2026-11-27-hunt-01/findings.md` and `verification.md`, and their probe paths are under that folder.

## Carry over

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| M1 | The Windows checkout's unlanded branches are lost: never pushed, and the import (#773) carried master over without history, so no machine has them. Round 16 (`budgets-4`, `budgets-5`, `teardown-2`, integration `1f141eb1`: P11, P12, F24), wave 5 (`geometry-table`, `near-typeset`, integration `0a9eeb68`: E22, E23), `web-shell` (`33e6bc09`: S17) and `open-with` (F26). Their briefs, reviews and measurements survive in `runs/2026-11-24-round-16/` and `runs/2026-11-26-wave-05/`; S17's report in `reports/2026-11-23-reach-beyond-desktop/`. Rebuilt on `main` under new names; S17 and F26 kept as notes under Later | Reviewed, finished work has to be built a second time; this row leaves with the last rebuilt branch | L | `budgets-text`, `budgets-containers`, `teardown-rest`, `geometry-table` |
| M3 | Run Marxy on a Linux desktop | The build, unit tests and `cargo test` pass on CI Linux, and the smoke launch paints under Xvfb; nobody has used the window, file dialogs, tray or a real save on Linux | M | |
| M4 | 14 browser test files fail on macOS WebKit, alone as well as in the suite (2026-11-26): capability (`frame-fonts`, `frame-media`, `frame-viewers`: macOS WebKit draws or plays what Windows WebKit could not), layout and metrics (`page-states`, `splice-all`, `source-structure`, `leave-split`, `demo-tour`), timing (`large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`), and `operations-copy` (two lazy highlight chunks, javascript and css, load when none are expected; fails alone on main too), and `reading-lines` (find, the level filter and a jump to a byte: a 30 s wait times out; fails alone on main too, 2026-11-27). Logs in `runs/2026-11-26-import/` | The suite has only ever been green on Windows; CI runs it there until these pass, then adds `browser` to the macOS job | M | |
| M5 | 14 browser test files fail on a hosted Windows runner (GitHub's `windows-latest`, 2026-11-26), all green on the Windows desktop: timing budgets (`archive-page`, `data-tree-budget` ×2, `left-search-big`, `paragraph-restyle`, `large-open-panel`, `progressive-large`, `frame-pdf`, `tail-follow`), layout or environment (`demo-tour`, `frame-viewers`, `source-place`, `reading-rows`: a ResizeObserver warning, `operations-copy`: a drag fetched two grammar chunks, `pane-close-guard`). Five overlap M4 (`demo-tour`, `frame-viewers`, `frame-pdf`, `large-open-panel`, `tail-follow`). The suite took 103 minutes there. Logs in `runs/2026-11-26-import/logs/verify-ci-windows-*` | CI runs no browser suite until these pass on a hosted runner (or the budgets scale with the machine); a person runs it on a Windows desktop | M | |

## Release

The first tag of the reader architecture: v0.2.0, a macOS pre-release. The plan, its order and gates, and the
investigation behind these rows are in `reports/2026-11-26-release-readiness/`. The hand run on the Mac was done on
2026-11-27 and round 16 (P11, P12, F24) is not waited for; R10 and R11 turned out real; each is fixed on a branch of its own. R1 (macOS CI) landed with #774.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| R13 | A 1 MB Markdown file shows its text in 1 to 4.4 s on macOS, but the main thread stays busy long after: 22 s in Chrome, 42 s until WebKit has set every paragraph, with 50 to 100 ms frames meanwhile (Windows Edge: 78 s, the progressive mount laying out per chunk). Switching back to its tab costs 27.8 s more in Chrome. Measured 2026-11-27, `reports/2026-11-26-release-readiness/07-macos-one-mb.md`; the real app window not measured. On macOS (hunt-02 CMD-03) a 1 MB file with hard breaks, links, lists and tables keeps tasks over 50 ms coming for 20 s after it opens (36 tasks, 2.4 s), a plain 1 MB file none, and a 3 MB rich file takes over 10 s: content, not size; probe `runs/2026-11-27-hunt-02/probes/CMD/busy.verify.mjs` | Long files are a stated use | M | |

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| B20 | A Word document of about 150,000 paragraphs does not finish opening in 120 s in WebKit (700,000 the same) | S2 freeze, not a spread error: it times out the same with and without the no-spread-calls fix. Probe: in `test/frame-office.test.mjs` add a docx built with `docWith('<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(150_000), '')` opened with `window.__marxyHandle.open`, and wait for 150,000 `.marxy-article > p`; not measured past the timeout, so where the time goes is a guess: the reader's `writeMarkdown`, the Markdown render and sanitise of 150,000 blocks, and `guardLongRuns` and `pictures`/`slideNumbers` walks over the whole holder are the first places to time (`viewers/office.ts` ~340, `core/src/office/markdown.ts`); the node reader alone takes 8 s for 300,000 paragraphs | M | |
| P11 | Budgets, slice 4 (lines of text): (paste classify and JSON Lines records are done) `carriesMarkdown` O(L^2) per line, lines uncounted below 5 MB (`reading/index.ts`); `diff/words.ts` tokenises every line before `MAX_TOKENS` | A hostile file or paste can hang a reading | S | |
| E22 | Geometry table: one record per top-level block (element, byte range, top, height, measured or estimated), kept current by size notifications; position, spine, holdPlace and Source return stop reading the whole page | The DOM stops being asked block by block; near-typeset builds on it | L | `geometry-table` |
| E23 | Near-typeset: bound the idle typesetting queue to what is near the reader; `done` means nothing near is unset; `setAll()` for export, print and the rag gate; the page held still by keepPlace during scroll (cut from `geometry-table`) | A long page is at rest about as fast as a short one | M | |
| L30 | A block-dense Markdown page that is whole spends one task of 12 s (250 KB) to 220 s (1 MB) in the grid pass over islands that changed height (Chromium) | S1 freeze after the page is complete; `snapChanged` → `snapBlocks` / `isBlock` (`packages/typeset/src/grid.ts`), each style read after a write restyling the page; 16 s of a 29 s open at 250 KB | M | |

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
| Q8 | Shared pieces: the scaffolding every viewer repeats; 12 hand-made caches; `plural` 25 times, 17 of them printing the bare number and the rest grouping it, so one panel says 1234 files and another 1,234; in core four `utf8Length`, four `extensionOf`, 11 line splitters; in Rust a second `ShellError` (`commands/os.rs`), 89 platform `cfg` lines inline in `atomic_write.rs`, and `main.rs` at about 1,700 lines of non-test code with two `#[path]` includes | Copies drift | M, gradual | `shared-pieces` |

## Big files

Files of 1 to 5 MB fail or crawl (the owner, 2026-11-27). The account, the measurements and the order are in
`reports/2026-11-27-big-files.md`; the research is `docs/research/large-files/` and the rules for new work
`docs/big-files.md` (both with the `agent/scale-guard` pull request). Rows L1 to L19 are hunt 03's verified findings
(`runs/2026-11-27-hunt-03/`); L20 to L28 are the structural work the research recommends, which removes whole classes of
them. Numbers are headless Chromium on a loaded Mac unless said; growth is per doubling of the file (2 is linear).
Eight were fixed before this section landed, so their ids are gaps: L1 by #804 (layout reads between a batch's writes)
and #807 (the Chromium restyle), its remainder being the grid pass (L30) and R13; L2 and L3 by #808, which added L30 and
L31; L4 and L6 by #806; L12 by #797; L13 by #805; L14 by #798.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| L5 | Opening a second or third 2 MB Markdown file takes 35-52 s (1 MB: 3.6 s), with 1,100-1,450 layouts against about 150; not the first file's mount still running | S1 freeze; cause not isolated (profile the second open); hunt-03 NAV-04, probe `probes/NAV/*.verify.mjs` | M | |
| L7 | Find on a page still mounting counts only what is mounted and says nothing (2 MB: "1 of 21,072" of 32,442), and from 0.75 MB every key in the field costs about 0.5 s | S2 wrong result; find walks the DOM (`find/`); hunt-03 NAV-01, NAV-05. The fix is L23's find over the model | M | |
| L8 | End on a page still mounting stops short (2 MB: at 1.34 MB of 2.0); reaching the end takes about seven presses over 60 s | S2; the jump goes to the last mounted block; hunt-03 NAV-03. Jump by byte through the geometry table (E22) | S | |
| L9 | Select all and copy grows faster than the page (0.25, 0.95, 2.1 s at 0.5, 1, 2 MB) and copies only the drawn part of a page still mounting | S2; `cloneRangeInert` tests `intersectsNode` for every child (`selection/copy-text.ts:17`); hunt-03 EDT-04. Copy by byte range (D-01 in the synthesis) makes both go | S | |
| L10 | Source and back, a one-block edit, undo and a reload each cost 2-6 s of main-thread work on a 1 MB Markdown page, about 2x per doubling; every cursor key and scroll costs 0.1-0.3 s at 0.5-1 MB, about 3x per doubling | S2; a block commit and undo set the page again rather than splicing the block (`spliceStalePage` exists, `view/rendered-view.ts:2100`); keys and scrolls read positions across every block (E22); hunt-03 MEA-05, MEA-04 | M | |
| L11 | A 4.9 MB diff opens with 17 s of main-thread work (1 MB: 0.5 s, 2 MB: 3.4 s) while its node count stays flat; a 4.9 MB HTML file reloads in 10.5 s and comes back from Source with about twice its nodes | S2; a parse or line-classification pass of the diff reading grows faster than the file; hunt-03 MEA-06 | S | |
| L15 | JSON or YAML over 100 KB costs about 2.3 s to open, flat to 4.9 MB: the capped tree draws about 19,500 nodes (3.9 per value) and style recalculation is half of it | S3; hunt-03 VWR-02 | S | |
| L16 | Every edit re-decodes the whole file and rebuilds its offsets: 30-60 ms of CPU at 4.9 MB, 0.2 s at 4 MB when the file holds one byte that is not UTF-8 | S3; `buffer/buffer.ts` `splice` calls `makeBuffer`; hunt-03 EDT-01, EDT-02. L26 | M | |
| L17 | Copy as of a whole Source selection parses the text again: 1.3 s at 1 MB, 2.7-7.0 s of CPU at 4.9 MB (the Slack form 2.9-6.2 s) | S3; reuse the store's parse when the selection is the file; hunt-03 EDT-07, EDT-08 | S | |
| L18 | Leaving Source costs 0.6-0.9 s on Markdown at any size from 1 to 4.9 MB (the splice is 30-60 ms of it), 2.6 s on a 1 MB JSON file and 2-2.8 s on 1-2 MB of text | S3 (one input, MEA-07, is a plausible S2); the hidden Read page is laid out again when it is shown; keep it laid out or skipped (`content-visibility`) while Source shows; hunt-03 EDT-05, MEA-07 (plausible) | S | |
| L19 | The shell's costs on big inputs: a non-UTF-8 decode keeps 4 bytes of map per byte (19.6 MB and a 27 MB frame for 4.9 MB of Shift_JIS); Read with encoding counts rows over 8 MB; the save check hashes with portable SHA-256 on Apple silicon (0.3 s of CPU at 40 MB); a writer in a folder of 50,000 files makes the watch rescan it at every write (0.46 s a scan) | S3; `src-tauri` decode, `readings`, `atomic_write` hash, `flat_loop`; hunt-03 SHL-01, SHL-04, SHL-03, SHL-05 | M | |
| L20 | One scheduler for sliced work: `yieldToMain` and `runSliced(task, {budgetMs, signal})` over `MessageChannel` (WebKit has no `scheduler.yield`, `postTask` or stable `requestIdleCallback`), a 5-8 ms deadline, cancellation by signal or generation, three lanes; the six copies of a `MessageChannel` yield move onto it | Research D-05 (THR-02 to THR-05); `startup/yield.ts`, `render/highlight-queue.ts`, `view/reading-rows.ts`, `view/reading-lines.ts`, `kinds/table-lens.ts`, `kinds/transcript-view.ts`; one owner per concern (`docs/principles.md`) | M | |
| L21 | A scale record at open, read by every feature: bytes, lines, longest line, then blocks, list items and rows; classes normal, heavy (about 1 MB or 5,000 blocks), huge (5 MiB); a long-line trigger; the page says once what is turned down | Research D-02 (EDS-01, EDS-03, MDA-02); today each feature keeps its own limit (`docs/file-kinds.md`, "Size limits") | M | |
| L22 | Typesetting by distance from the viewport, with a paragraph cap (start at 20,000 characters; above it, split at break opportunities or leave to the browser) and widths from a cached canvas measurer | Research D-04 (TYP-01 to TYP-04, TYP-08). Adds to E23; the cap also answers B3's long runs | M | `near-typeset` |
| L23 | Windowed Markdown pages: tier 1, `content-visibility: auto` with remembered intrinsic sizes on every top-level block; tier 2 above a node budget, only the blocks within about two screens mounted from the geometry table, with the app's own find, select-all and copy by byte range, anchors and scroll anchoring | Research D-01 (MDA-06, DOM-01, DOM-03, DOM-07, SRC-09); builds on E22. Removes L1's busy page, L7, L8 and L9 at the root. macOS 13 WebKit has no find in skipped content, so own find is part of it | L | |
| L24 | The Markdown parse in a worker: slices at safe block boundaries, the definitions index kept, a definition change reparsed there while the old page stays, caps on nesting and brackets before micromark, a block table and per-block HTML sent back, panels fed derived tables | Research D-03 (PRS-01, PRS-05, PRS-06, PRS-08, PRS-13). A file with a definition is parsed whole in one task today (2.3 s at 2 MB; hunt-03 RDR-02, RDR-01, by design in `docs/architecture.md`). Panels fed derived tables also remove B17 and B18 at the root | L | |
| L25 | JSON as a typed-array node index with lazy expansion and leaf decoding past a low threshold; record scanning for CSV, TSV and JSON Lines that tracks quotes | Research D-08 (DAT-01, DAT-10). Covers L6 and L15 | M | |
| L26 | Derived copies lazy and bounded: the text and the UTF-16-to-byte map made per range with checkpoints about every 1 KB, line starts in a `Uint32Array`, undo under a byte cap, diff on line hashes under time and size caps, the whole-page HTML and sanitised-page cache kept only below a size | Research D-07 (BUF-03, BUF-04, BUF-08, BUF-12). Covers L16 and the decode half of L19 | M | |
| L27 | Measure on both platforms with `scripts/measure-scale.mjs` (and in WebKit), then set the node budget and the scale classes | Research open questions (DOM-08, PRS-10, THR-13); every number in this section is Chromium on a loaded Mac | S | |
| L28 | Lower `check-scale`'s recorded counts (363 unbounded shapes in 165 files on 2026-11-27, after #798 removed most spreads): layout reads and DOM queries in loops first (157), then spreads (80) and whole-text line splits (68) | Research D-09; `scripts/allowlists/scale.json` | M, gradual | |

## To try in a real window

| # | What | Branch |
| --- | --- | --- |
| W5 | Round 6 by eye: line icons, the room changes, top-edge wake and left-edge peek with a real pointer, Notepad writing during a 20 MB save, an SMB share | Ian |
| W6 | Real files: an iPhone HEIC, real PSD and DDS files, WMA/AC3/AMR, a signed installer opened through the UI, and real `.doc`, `.ppt`, `.deb`, `.cab`, `.iso`, `.rar` | Ian |
| W7 | Install round 9's build here: `builds\20261123-0631-ee56607d` | Ian's word |
| W8 | A frames-only launch: no start-time run hit it, so the 2 s stall fix has not been seen in the real app | |
| W9 | A file on a mapped network drive, a `subst` drive and a OneDrive placeholder still opens: the head read now compares the opened handle's final path | |
| B11 | Go on the search page does nothing (the owner's report). Not reproduced in the browser build or in Playwright WebKit with Mac keys (alone and in a split, docked): `o` on a hit, the foot's `o go` button, a click, a double-click, Cmd-click (opens beside), a click on a file row, Enter on a hit (verb menu, then Go) and the Line's `#` all go; Enter with Replace filled replaces, as meant. Two presses do nothing by design: Enter in the Find field only moves the cursor into the list, and Cmd+Enter there is ignored (the panel's keys skip Cmd chords). Not tried: floating drawer, the real Mac window. Which key or click did the owner press? hunt-01 NAV-01, NAV-06 | Ian |

## Waiting on Ian

| # | What | Where |
| --- | --- | --- |
| R2 | Disable the `nightly` workflow: deleted from `main` by the import, it is still scheduled from an old commit and fails every day (`gh workflow disable nightly -R inkstrata/marxy`) | GitHub, Actions |
| R14 | Decide the release: v0.2.0, a pre-release, round 16 before the tag, wave 5 after it, the file-association set, ad-hoc signing for now | `reports/2026-11-26-release-readiness/README.md`, "Decisions for the owner" |
| B13 | Pasting HTML into Source of a file that is not Markdown converts it to Markdown, as `docs/using-marxy.md` promises: fences in a `.py` file, escaped and invalid JSON, a pipe table in a `.csv`, `**bold**` in a `.txt`. Should such a paste go in as plain text? (hunt-01 EDT-03, judged by design) | `docs/using-marxy.md:263-266` |

## Later

| # | What | Why | Size |
| --- | --- | --- | --- |
| S17 | Spike: a shell over the File System Access API, booted by a web build, reading and saving a real folder in Chrome. The spike branch was lost (M1); its report, with what a browser host keeps and loses, is in `reports/2026-11-23-reach-beyond-desktop/`. Nothing of it was in the desktop build. Re-spike only if a web host is wanted | Measures what a browser host keeps and loses before any reader moves to wasm; research, after the tag | M |
| F26 | More files recognised by name: the lost `open-with` branch (M1) added `.apng`, `.cbz`, `.msix`, `.gpkg`, `.plist` and others to the kind registry and aliases, with the installer's file-association hooks and `docs/file-kinds.md` following; only its "Open with" installer test reached `main` (2026-11-23). Port the extensions wanted, from the list in `reports/2026-11-26-release-readiness/05-outstanding-work.md` | Decide with the file-association set (R14) | S |
| F5 | Place restore failed once under full-check load (94 of 95), not reproduced in 4 runs | Watch; give it a wait or find the race if it returns | S |
| B22 | A broken (unparseable) data file of 256 KB or more that is not UTF-8 still draws every line | `written()` path: `unreadable` (`reading/index.ts`) windows UTF-8 files only, so a Latin-1 or UTF-16 file keeps the all-lines page and its 30 elements a line | S |
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
| B19 | Opening, folding or hiding the drawer, or changing the window's width, stalls a 1–3 MB page for 0.15–0.45 s each time | S3 slow; a width change relays the page and rebuilds the whole block list, with `getBoundingClientRect` called about 7,000 times at 1 MB and 90,000 at 5 MB; hunt-02 RDR-01 (with NAV-03) and RDR-02, probe `probes/RDR/layout.verify.mjs`. Looked at in `panel-parse-once` and left: a width change really moves every block, and `buildBlocksByRange`/`buildBlocks` (`render/post.ts`) already read in one batch (no write between reads, so one layout); the cost is the layout of the whole page plus one rect per block, which only goes with estimated geometry for blocks off screen, so this waits for E22 | M |

## Housekeeping

About the machines' workspaces, not this repository: H4 and H5 the Windows machine, H6 the Mac.

| # | What | State |
| --- | --- | --- |
| H4 | `worktrees\furniture` and `worktrees\shortcuts` could not be deleted (a file in each held open) | Retry after a restart |
| H5 | `worktrees\exe` holds another session's uncommitted `hex.ts` and `frame.css` edits on `a6032b26`, so the installer script refuses it | That session's to clear |
| H6 | About 570 worktrees beside the Mac checkout are from the earlier architecture, 93 with uncommitted edits, and its main checkout holds 345 untracked files under `orchestration/` | After the tag: a patch per dirty worktree, then remove; every branch is tagged `archive/branch/<name>`; never `git clean` the checkout |
