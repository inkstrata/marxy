# Marxy evaluation: bloat, overengineering, chronic performance, and what verifying costs

24 November 2026, `master` at `17cfe661`. Nothing in the repository was changed.

## The short version

Marxy is fast and well built for documents up to about 50 KB, and its foundations are sound: the Rust boundary moves raw bytes on background threads, the file-type registry is real data, the test shell does not ship, and the app does nothing at all while idle. The problems are concentrated in four places.

1. **Costs that grow with the size of the document when they should grow with the size of the change.** On a 195 KB Markdown reference, a cursor key takes 40 to 110 ms, the first click 166 to 250 ms, an undo or a ticked checkbox 3 to 5 s, a one-line reload 5 s, and a tab switch half a second plus two more of typesetting. The same actions on a 25 KB document take a few milliseconds. Most of these have small, local fixes.
2. **Weight that nobody uses.** Every syntax grammar ships twice (7.7 MB of the 21.5 MB of JavaScript). About 5,000 lines of source and tests guard features with no way to reach them. Common helpers exist in 8 to 37 copies each, some with different behaviour.
3. **Rules kept by hand in several places at once.** Lists that must agree are checked by tests instead of generated, and the same rule is enforced by a script, a test and a text search. This is where merge conflicts and wasted full runs come from.
4. **Verification that is slow, serial and flaky, and that does not measure the things above.** Ninety verify runs in four days took about 30 machine-hours. One full run in seven went green first time. None of them would have noticed a 100 ms cursor key.

### What I would do first

| # | Change | What it buys | Size |
| --- | --- | --- | --- |
| 1 | Cache one lookup (`readingRoot`) per rendered page | Cursor key on a long page from 40-110 ms to about 10 ms; palette key from 15 ms to 1-2 ms | Small |
| 2 | Send undo, redo and Read operations down the splice path that block edits already use | 3-5 s becomes about 1 s on a long page | Medium |
| 3 | Let a footnote or link definition stop forcing a whole re-parse and re-render | One-line reload from 5.1 s to 0.8 s (measured on the same file) | Medium |
| 4 | Stop the margin-notes layout pass re-running on every resize while type is being set | About 1 s off opening a long page, and most of the 166 ms first click | Small |
| 5 | Ship the grammars once | 7.7 MB off the build, about 2 MB off the 30 MB exe | Small |
| 6 | Delete the unreachable clusters | About 5,000 lines of source and tests, one worker chunk | Small |
| 7 | Three defaults in `verify` (parallel browser files, parallel unit files, move one 104 s test) | Roughly 5 to 8 minutes off each changed-tier run | Small |
| 8 | Keep a background tab's parsed document | Tab switch from 0.2-0.5 s plus re-typesetting to near instant | Medium |

Sections 1 to 4 give the evidence; section 5 puts everything in an order; section 6 lists the calls that are yours.

## How this was done

Six audits ran in parallel and two more passes then tried to refute their leading claims. Four audits read code (front end, Rust shell, TypeScript bloat, tests and tools); two drove the running app with a CPU profiler. I took the size, bundle and parser measurements and made the ranking.

What the numbers are, so you can weigh them:

- **Interaction timings** come from the unminified dev build in headless Edge with an in-memory shell, sampled by the Chrome profiler. Layout and DOM costs are browser work and will be the same in the installed app; script costs may be 10 to 30% lower minified. Two runs of the same measurement varied by up to 40%. Nothing was timed in the real WebView2 window.
- **Startup** is the 23 November record of ten cold launches of the installed build.
- **Rust file-system costs** are Python scripts making the same Win32 calls over this repository (2,498 files), not Rust timings.
- **Verify costs** come from the 88 retained run summaries and the round logs.
- Where a claim rests on reading alone, or a saving is an estimate, the text says so.

## 1. Chronic performance

### Where it stands

Read mode, by document size:

| | 8 KB | 25 KB | 53 KB | 195 KB |
| --- | --- | --- | --- | --- |
| First content after open | 41 ms | 86 ms | 77 ms | 248 ms |
| Blocked main thread at open | none | one 91 ms task | one 80 ms task | 11 tasks, 878 ms, worst 250-490 ms |
| Page stops changing | 0.5 s | 0.5 s | 0.4 s | 3 to 6.5 s (about 8 s of main-thread work) |
| Cursor key (`j`, `k`) | 3 ms | 8 ms | 5 ms | 40-110 ms |
| Click on a paragraph | 17 ms | 40 ms | 29 ms | 166-250 ms |
| Scroll, page settled | smooth | smooth | smooth | smooth |
| Scroll while type is being set | smooth | smooth | smooth | 7 frames over 50 ms, worst 196 ms |

Editing and moving between documents (195 KB unless stated):

| Action | Measured |
| --- | --- |
| Tick a task checkbox | 5.0 s of main-thread work, whole page rebuilt |
| Undo | 4.9 s, whole page rebuilt |
| Commit a block edit | 6.1 s; 1.0-1.9 s on the same file with its footnote definitions removed |
| Reload after one line is appended on disk | 5.1 s; 0.8 s with the definitions removed |
| Switch to a tab | 0.5 s to show, then about 2 s of typesetting; 0.2 s for a 25 KB document |
| Source back to Read, nothing edited | 290-330 ms; 35 ms at 25 KB |
| Pause while typing in Source | one 280-390 ms stall 0.7 s after the last key |
| Typing in Source | fine: under 20 ms a key at every size |
| Idle | zero script, zero timers, zero layout over 30 s |

Launch: 774 ms median to first text. The window appears at 392 ms (WebView2 start, outside the app's control); the script starts at 516 ms; the file is read by 590, parsed by 624, rendered by 670, painted at 774.

### Findings, in order of what the reader would feel

**P1. One query scans the whole page 40 times per cursor key.** `readingRoot` in `apps/desktop/src/parts/reading-parts.ts:21` runs `querySelectorAll` over the article for a reading page. A Markdown page has none, so the answer is always "no", and it is never cached because the cache is keyed by the element that does not exist (`parts/cursor.ts:67-81`). It is called from three places on each key, from the palette on each key (15 ms a key on a long page), and from the verb bar on each key in Source. Fix: remember the answer per rendered article. Found three ways: my call counts, and both profilers independently. Expected: about 35-40 ms off each cursor key on a long page.

**P2. Most edits rebuild and re-typeset the whole page.** `repaint` tries the in-place splice only for a reload (`apps/desktop/src/view/rendered-view.ts:2004`); undo, redo, a ticked checkbox and every Read operation take the whole path, and the store parses the whole file on each commit (`document/store.ts:512`, `:546`, `:558`). Block-edit commits already splice, and they measured 1.0-1.9 s where undo measured 4.0-5.2 s on the same file. A second gate, `INCREMENTAL_MIN_BYTES` of 64 KB (`rendered-view.ts:310`), sends every small document down the whole path too; that is cheap in milliseconds but restarts typesetting and loses code colour for a moment. Fix: one path for every edit.

**P3. One footnote or link definition turns off incremental work for the whole file.** `packages/core/src/parse/reparse.ts:65` falls back to a whole parse whenever the previous parse held a definition, and `apps/desktop/src/render/incremental.ts:359` refuses to splice. This is the measured difference between 5.1 s and 0.8 s for a one-line reload. Long reference documents are exactly the ones that have footnotes. Fix: keep the region path when the edit neither adds nor removes a definition. The feasibility of seeding the parser with the existing labels has not been tried.

**P4. A tab switch opens the document from scratch.** `document/open.ts:471` reads the file again, makes a new store, parses, renders and typesets; the old page is discarded on the way out (`open.ts:377-386`). Confirmed by measurement: a node marked in each article was gone after every switch. Fix: keep the store of recently shown tabs (skips the read and the parse), and ideally the last one or two rendered articles.

**P5. Layout is forced over the whole page, repeatedly, while it loads.** Of about 8 s of main-thread work to finish a 195 KB page, 3.6 s is forced layout inside `getBoundingClientRect` and `getClientRects`. Two sources:

- The margin-notes pass (`apps/desktop/src/proposals/notes-in-place.ts:136-187`) is re-queued by a ResizeObserver on every growth of the article, removes and re-clones every note, then reads layout: 1.1 s in total. It also accounts for most of the first click and of a text-selection release. Fix: skip it when nothing it depends on changed, and run it once when typesetting finishes.
- Each typesetter slice ends by forcing a layout of the whole article (`packages/typeset/src/index.ts:898`). The slices are budgeted at 24 ms and cost 90-190 ms on a 10,000-node page: 2.3 s in total. The fix here is a design change (containing layout per paragraph), not a patch, and is untested.

Related, from reading: tearing down the typesetter reverts every set paragraph of a page that is about to be thrown away (`typeset/src/index.ts:983-995`), and paragraphs set during a scroll trigger a whole-article grid pass even when no line moved (`:843-858`).

**P6. The first selection changes the page's layout.** Showing the verb bar sets attributes that change the pane's foot, so the next layout read pays for a full relayout (`apps/desktop/src/selection/verb-bar.ts:77-104`): 159 ms of a 215 ms click. Fix: reserve the bar's space from the start.

**P7. Returning from Source re-measures the whole page even when nothing was edited.** `showRendered` calls a whole-article grid pass (`rendered-view.ts:1050`): 290-330 ms on a long page. Whether skipping it is safe has not been tested.

**P8. Each typing pause in Source parses the document again and re-checks every path.** `apps/desktop/src/source/frame.ts:496` schedules a notes scan 0.7 s after each edit; it runs its own full parse (`source/notes.ts:85`) and then one `stat` per backticked path with no cache: 38 calls for one pause on a 25 KB document. In the installed app each of those is a round trip to Rust, which was not measured.

**P9. Find re-walks the page on every keystroke.** `apps/desktop/src/find/view.ts:572` collects the article's text again for each query change: 20-28 ms a key on a long page. Fix: keep the collected text until the article changes.

**P10. Nothing is cached between renders in Read.** Every code block is re-tokenised in the worker on every render, and every formula re-set by KaTeX (`apps/desktop/src/render/highlight.ts:267-277`). Source already has the cache Read lacks, a 256-entry store keyed by language and text (`source/colour.ts:216-277`). This matters because P2 and P4 make whole renders common; code flashes uncoloured each time. From reading.

**P11. The folder scan opens every file.** `apps/desktop/src-tauri/src/watch/tree.rs:203-231` lists each folder twice and then calls `lstat` on every entry, which on Windows opens a handle each. By proxy measurement the listing of 2,498 files took 15-29 ms and the per-file opens 113-173 ms. It runs on the first scan of a folder, on rescans and on a quiet-time reconcile at least every 60 s. The folder watch for the open document's folder does the same double listing every 2 s (`watch/mod.rs:412-417`). One Windows call (`FILE_ID_BOTH_DIR_INFO`) returns everything both listings and the opens provide. The tree watch also ignores `.gitignore`, which the index walk honours, so build folders outside the twelve built-in names are scanned and watched for nothing.

**P12. Content search does about 3.7 times the file-system work it needs, on one thread.** Per file: a canonicalise, two `symlink_metadata` calls, an open, a head read that is then read again, and for smart case a lowered copy of every chunk (`src-tauri/src/commands/search.rs:131-382`); the loop over files is serial (`:516-557`). By proxy: 614-675 ms per query over 2,498 files against 165-185 ms for a plain open and read. The page also re-sends the whole path list (up to 20,000) on every query.

**P13. The index walk makes one round trip per folder.** `apps/desktop/src/index/walk.ts:244-252` awaits one `readDir` at a time, and Rust walks the same tree again for the watch. From reading; the round-trip latency was not measured.

**P14. The startup script is one 1.38 MB chunk of 559 modules.** Every reading parser, all commands, operations, transforms, versions, the look engine and the settings schema load before first paint. The time this costs is not known: it needs a run of `scripts/measure-startup.mjs` with and without a split, and I do not know whether WebView2 keeps compiled code for the app's scheme. Roughly 260 ms of the 774 ms lies between the window showing and the file being read, which is the most a split could touch.

**P15. The Markdown parser runs at about 1 MB a second on the main thread.** 223-240 ms for 195 KB, of which the third-party parser is well over half. It is the first blocking task of every open. Not a quick fix: the options are a worker or a different parser, and both cut across the one-parser rule and the goldens.

### Measured or read and found fine

Do not spend time here: documents up to 53 KB on every path measured; typing, Enter and paste in Source; scrolling a settled page; the idle app; saving (3.5 ms for a 20 KB file, and an own save is re-read once but not re-parsed or re-rendered); bytes crossing the Rust boundary (raw, never JSON arrays); every file command off the main thread; archive and table caches; the highlight worker's session handling; find's highlight drawing; the outline and index during typing (nothing runs).

One open item: the heap grew about 40-50 KB per open-and-close cycle over 90 cycles with DOM nodes and listeners flat. The cause was not traced.

## 2. Bloat

**B1. Every grammar ships twice.** The page keeps a fallback that colours code without the worker (`apps/desktop/src/render/highlight.ts:236-246`), which pulls all 251 grammar chunks into the page's build beside the worker's own copies: 7.7 MB of duplicate files, about 2.2 MB of the exe after compression. WebView2 always runs module workers. Fix: drop the fallback in the shipped build and split the language table from the loaders so the page cannot reach them. KaTeX's `.ttf` and `.woff` fonts (0.8 MB) ship beside the `.woff2` the app actually loads (`render/math.ts:22`).

**B2. Code with no way to reach it.** Each item below was re-checked by a second pass.

| Cluster | Where | Size | State |
| --- | --- | --- | --- |
| Library checks (near-copies, broken paths, query language) | `apps/desktop/src/library/checks*.ts`, `measure.ts`; `packages/core/src/index-model/{near-dup,broken-paths,query-eval,query}.ts` | about 2,000 lines of source, 1,200 of tests, a 133 KB worker chunk | Nothing has started them since 22 October; the palette's near-copies chip can never show |
| Front-matter value writing | `frame/model/metadata.ts:364-381`, `core/src/operations/front-matter-value.ts:757` | about 130 lines guarded by about 780 lines of tests and a gate hook | `runFrontMatterEdit` has no caller at all |
| `History` class | `packages/core/src/buffer/history.ts` | 56 lines, 112 of tests | The store uses plain arrays |
| Old workspace storage | `packages/core/src/layout/workspace-storage.ts` | 178 lines, 189 of tests | Imported only by its test |
| Operation packs | `core/src/operations/pack-{copy,extract,table}.ts` | 18 lines, 772 of tests | Referenced only by tests |
| Five `Shell` members and a runtime stub | `packages/shell-api/src/index.ts:458-616` | about 100 lines | Implemented by neither shell, called by nothing |

Across the TypeScript, 202 exports have no production use (about 3,100 lines of declarations) and 21 files are reachable only from tests. The bundler already drops most of this from the build; the gain is less to read, test and keep green. A test hook, `window.__marxyPalette`, is set in the shipped build (`apps/desktop/src/boot.ts:54`).

**B3. The same helper, many times.**

| Helper | Copies | Note |
| --- | --- | --- |
| `plural` | 37 | Number grouping differs between copies |
| Byte-size words | 14 | They print different formats for the same size |
| HTML escape (`esc`) | 10 | They escape different character sets; `viewers/mail.ts` covers only `&` and `<` |
| Versioned JSON state file | 8 files, about 1,900 lines | `trust/trust.ts` and `position/storage.ts` differ by a field name |
| `el` DOM builder | 8, beside the shared one that 48 files import | |
| `clamp` | 7 | |
| basename, dirname, extension | about 15, plus 30 inline | |

In Rust: 30 little- and big-endian readers across 15 files, 8 `read_at` functions, 15 inline `extern` blocks beside the `windows` crate, and a 205-line hand-written SHA-256 (`atomic_write.rs:333-537`) beside the `sha2` crate that is already linked. The differing escapes and size formats are the ones worth fixing for their own sake: the reader sees the inconsistency.

**B4. Dependencies that can go.** `toml` 0.9 is used only by Marxy while Tauri's stack uses 1.1 (the comment in `Cargo.toml` saying otherwise is stale). `tauri` is built with default features although one static capability is used. `tauri-plugin-dialog` is called only from Rust and brings `tauri-plugin-fs` with it. The clipboard plugin is a fallback on Windows except for one Studio button that calls it directly (`studio/tab-file.ts:25`). What the image decoders (OpenEXR, JPEG XL and five more) weigh in the 16 MB of machine code is not known: the binary is stripped and `cargo bloat` is not installed. One run of it would settle that.

**B5. Where the weight really is: format breadth.** The repository is about 110,000 lines of app TypeScript, 76,000 of core and 54,000 of Rust after five weeks. The registry itself is lean. The mass is one subsystem per format family. Source and test lines for the ones a reader app could plausibly do without, or stop extending:

| Feature | Source | Tests | My reading |
| --- | --- | --- | --- |
| Look engine, 13 themes, 25 looks, config | 8,150 | 4,350 | Freeze; `config.ts` is needed, the look engine loads at startup |
| Studio theme editor | 2,980 | 1,030 | Candidate to cut: it overlaps `config.toml` and the look pop-over |
| Transforms (50 of them) | 2,840 | 2,500 | Trim to the ones used |
| Transcripts | 2,470 | 1,390 | Yours to judge by use |
| Mail, EPUB, fonts viewer, media | 1,570 / 1,480 / 1,050 / 850 | 615 / 550 / 375 / 1,010 | Freeze |
| Certificate, shortcut and program cards | 1,420 | 990 | Candidate to cut: the file card and hex view cover them |
| Notes and the reply tray | 1,420 | 380 | Suspected low use |
| Archives in Rust (zip, 7z, tar, rar, cab, iso, ar) | 5,450 | 4,390 | RAR lists but cannot read (471 lines); the hand-written zip reader (784 lines) sits beside the `zip` crate that is linked anyway |
| Legacy Office and Outlook in Rust | about 4,000 with tests | | Three compound-file readers serve them |

These are judgements about a product that is yours; the numbers are there so the call is informed.

**B6. Leftovers of the process the repository says it does not keep.** About 100 comments still carry brief names, dates and letter-number codes (for example `app-types.ts:93`, `document/entries.ts:14-150`); nine test files carry criterion and round ids in their names; about ten scripts describe CI and nightly jobs that no longer exist; `fixtures/perf-budgets.json` cites an ADR and holds budgets for Linux and macOS only.

## 3. Overengineering

**O1. Lists that must agree are copied by hand and policed by tests.** 

- `scripts/registry.json` holds a list of 545 class names that nothing reads; the check only tests the `marxy-` prefix. Twenty-four commits since 10 November added 423 lines to it.
- `scripts/verify-map.json` was edited in 30 commits and caused two of the three merge conflicts recorded in round integrations.
- The file-type table is mirrored into two Tauri config files and the installer hooks, and a test asserts the copies match; it changed with 18 source commits and turned one full verify red with a 478-item diff.
- A Tauri command is declared in four places, again checked by a test.

The simpler shape in each case is one source and generation, or a line at the top of each test file saying what it covers. `registry.json` is touched by 1 source commit in 13.

**O2. The same rule enforced at two or three layers, by text search.** `apps/desktop/test/palette.test.mjs:104-121` fails if the text `function walk(` appears anywhere in app source; a legitimate helper of that name cost round 14 a 40-minute rerun. `test/shell-boundary.test.mjs:42-59` restates what `scripts/check-boundaries.mjs` enforces. `scripts/check.test.mjs:70` re-runs the whole of `pnpm check` inside the unit suite that follows `pnpm check`. `check-one-parse` is almost entirely covered by the dependency allow-list. Twenty-three browser test files and 31 unit test files read source text. Each rule belongs in one place, and most of them fit a lint rule or a compiler setting better than a regular expression.

**O3. Two render paths, split by size and by cause.** The splice path and the whole path differ in behaviour, are chosen by a 64 KB threshold and by whether the change was a reload, and each has its own exceptions (definitions, footnotes). That is the root of P2 and P3. One path that always splices and falls back only when it must would be both simpler and faster.

**O4. The `Shell` interface is two layers.** `@marxy/shell-api` declares 46 members; the app uses a pick of 26 plus 24 optional extras, which is why there are 84 optional-call guards in app code, five members nobody implements, and a runtime stub in a types package. One interface holding what is called would remove all three.

**O5. A gate that forces duplication.** `atomic_write.rs` must compile on its own for the fidelity gate, which is why it carries its own SHA-256 and its own Win32 declarations. The gate could build the module inside the crate.

**O6. Checks that have outlived their job.** `check-listeners` is a count ratchet whose baseline is now zero. `gate-bundle` can only measure `.dmg`, `.AppImage` and `.deb`, so on Windows, the only platform built, it checks no size. `gate-aesthetics` (2,175 lines) compares against 27 MB of Linux and macOS screenshots and has no Windows baselines.

Well proportioned, so leave alone: the kind registry; `operations` as one small file each; `proposals` behind one installer; the memory shell (887 lines buys about 260 browser test files without Tauri); `pnpm check` (ten checks in 17 s); the goldens; `check:tauri` and its machine lock; `verify.mjs` itself.

## 4. The extra domain: what verifying costs

I chose this because it is the cost paid on every change, by every builder, and because it explains why section 1 went unnoticed.

| Tier | Runs kept | Green | Median time | Where it goes |
| --- | --- | --- | --- | --- |
| Full | 7 | 2, one of them first time | 57 min | Browser 36 min, desktop unit 5, build 5.4, core unit 3.2 |
| Changed | 79 | 51 (65%) | 13.7 min (1 to 68) | Browser 9.5 min, desktop unit 3.8, core unit 3.5 |
| Quick | 2 | | about 55 s | |

Ninety runs in four days took about 30 machine-hours; 19.7 of them were the browser step.

**V1. The changed tier runs browser files one at a time.** `scripts/verify.mjs:61` gives the full tier three jobs and everything else one, so a changed run pays about 20 s a file where a full run pays 8. A changed run of 142 files took longer than a full run of 262. The repository's own testing doc says to run three at a time.

**V2. The desktop unit suite runs serially.** 141 files run with a concurrency of one, though four of them use a browser. One of those, the "9 MB Source scroll" test, takes 104 s of every full run and asserts only that a number was produced (`apps/desktop/src/source/source-browser.test.mjs:62-82`).

**V3. Every browser test boots the app from 250 unbundled modules.** The per-file start-up is already shared; what remains is a fresh page and a full module load per test, about 2,000 times. A prebuilt harness bundle exists (`build:harness`) and only the perf harness uses it. This is also where the 112 timeout errors in the logs come from when several builders run at once. The saving is an estimate: 7 to 13 minutes per full run.

**V4. Flakes come from five causes, and each has one fix.**

| Cause | Size | Fix |
| --- | --- | --- |
| Fixed sleeps | 458 `waitForTimeout` calls in 123 files, 176 more sleep promises | One "settled" signal from the app |
| Wall-clock bounds in correctness tests | about 35 assertions in 20 files, some as tight as 15 ms | Record times, never fail on them; count work instead |
| Key sequences typed across slow frames | two recorded | Send the sequence in one step |
| Module addresses read from a browser timeline that holds 250 entries | 9 files | A bundled harness or a hook |
| Builders starving each other | no machine-wide limit on browser batches | The lock `check:tauri` already has |

**V5. A change to the test harness itself runs five files.** `test/support/two-pane.mjs` and `frame.mjs` are used by 168 test files and map to nothing, so the changed tier runs only its fallback set.

**V6. Core's unit suite sweeps the whole corpus on every core change.** Single tests of 106, 69, 46 and 37 s bound its 3-minute run. A sampled subset in the changed tier would do.

**V7. Nothing measures what the reader feels.** The measuring tools exist (`perf-harness`, `measure-startup`, `measure-reload`, 2,000 lines between them) and nothing runs them: `results/` holds two numbers from 19 November. The timing that does run is wall-clock assertions inside correctness tests, which produce flakes and catch no regressions. The work-budget programme guards hostile and huge inputs. Between them sits the ordinary long document, where every finding in section 1 lives. A recorded run of six numbers on real paths (open, cursor key, click, undo, tab switch and launch, on a 200 KB document) would have caught all of them, and would let each fix above be shown to work.

Also: four package scripts are written `VAR=value command` and cannot run under pnpm on Windows (`test:lite`, `verify:cli`, `test:reparse-stress`, `test:invariant-stress`); `scripts/measure-colour.mjs` and `measure-typeset-idle.mjs` are referenced by nothing.

## 5. An order of work

**First, small and safe (each a day or less).** P1 the cached lookup. P5's margin-notes skip. P6 reserved verb-bar space. B1 grammars once, and the KaTeX fonts. B2 the dead clusters. V1 and V2 the verify defaults and the 104 s test. O1's unread class list. B6 the stale prose. Then V7's six-number record, so the rest can be measured.

**Second, the render path (medium each, and they compound).** P2 and O3 together: one splice path for every edit. P3 definitions. P4 warm tabs. P10 caches for colour and maths. P5's typesetter items: no revert on discard, a grid pass only when lines moved. P7, P8 and P9.

**Third, the shell's file-system work.** P11 one listing call for both watches, and the ignore rules. P13 one batched walk. P12 search judged by handle, on several threads.

**Fourth, verification.** V3 the bundled harness. V4 the settled signal and timings out of verdicts. O1 and O2: generated lists, one home per rule. V5 and V6.

## 6. Calls that are yours

1. **Which features to freeze or cut** (B5). The Studio and the three file cards are my candidates; the look engine and transforms could be frozen.
2. **Whether long documents matter enough to do the second wave.** Everything under about 50 KB is already fast. If long references, books and transcripts are central, the render-path work is the most valuable thing here. Transcripts take their own rendering path and were not measured.
3. **Startup.** A split of the 1.38 MB chunk and a parser moved off the main thread are both real work with unmeasured gains. I would measure first.
4. **Decoders and archive readers in Rust.** One `cargo bloat` run tells you what OpenEXR and JPEG XL cost; whether RAR listing and the hand-written zip reader earn their place is a product call.
5. **The stand-alone compile gate** (O5), which trades a guarantee for duplicated code.

## Not determined

- Timings in the real WebView2 window, and IPC round-trip latency, which would raise P8 and P13.
- How the 16 MB of machine code splits by crate.
- The cause of the slow heap growth.
- Why the changed tier and the desktop unit suite were set to run serially; it may have been a response to load, and V1 trades against V4's flakes.
- Whether seeding definition labels into a region parse (P3) works.
- In my own first pass, in a hidden browser pane, the 195 KB page took 22 s to settle and a cursor key 105-115 ms; the profilers, in a visible headless browser, measured 3 to 6.5 s and 40-51 ms. The amount of work agreed; how it was scheduled did not. Both figures are in the ranges above.
