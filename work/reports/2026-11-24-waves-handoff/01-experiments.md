# Experiments

Ten experiments that decide how the harder steps of the plan are built, or whether they are built at all. Each says the question, why the answer matters, the method, what to record, and the rule that turns the result into a decision. The plan is `C:\Dev\reader\work\evaluation-2026-11-24\marxy-plan-harder-waves.md`; the briefs they feed are in `02` to `05` beside this file.

## Rules for every experiment

- An experiment runs on a throwaway branch `agent/x-<name>` in its own worktree (`pnpm work start x-<name> --from <base>`). It is never merged. Quick and ugly code is right; it is deleted afterwards.
- Its output is `C:\Dev\reader\work\experiments\<id>-<name>\report.md`, with the raw records beside it. The report opens with the answer to the question in one sentence, then the decision the rule gives, then the table of numbers, then what broke, then what could not be measured.
- Measure with `node scripts/measure-interactions.mjs` (wave 1's `perf-record` branch; in master once wave 1 lands) wherever it covers the scenario, so numbers are comparable across experiments: `--record <path>` to save, `--compare <record>` against the baseline. Run `--help` first: `00-handoff.md`, "The measuring tool", says which options and documents it had when this was written and which were still being added. Where it lacks a scenario or a document an experiment needs, the experiment's builder extends it on the throwaway branch and says so; an extension worth keeping becomes a small branch of its own. Prefer the browser's attributed durations and counts (`TaskDuration`, `LayoutDuration`, `LayoutCount`, `RecalcStyleCount`, nodes replaced) to wall-clock time. Three repetitions, report the median, and say what else was running on the machine.
- Documents: an 8 KB one (`fixtures/demo/reading/on-the-measure.md`), the 25 KB demo document (`fixtures/demo/tidemark/docs/specs/incremental-indexing.md`, the tool's `short`), `fixtures/corpus/15-prose-volume.md` (53 KB), `fixtures/corpus/32-long-reference.md` (195 KB, 30 footnotes, 47 tables, the tool's `long`), the same with its definition lines neutralised (`long-reference-plain`: requested of the tool, see the handoff), and for scaling a 1 MB document (`node scripts/perf-harness.mjs --write <dir> --large 1m` writes `big-1m.md`).
- Pictures are taken with `pnpm --filter @marxy/desktop shots <scenario.mjs>`, which needs a scenario file: the experiment writes one in its own work folder (`apps/desktop/scripts/shots/window.mjs` is the one to copy; `docs/working.md` lists the tools a scenario is given).
- An experiment that needs the built app first builds it in its worktree with `pnpm --filter @marxy/desktop build` (minutes). `check:tauri` and `shots --exe` take the machine lock themselves; `scripts/measure-startup.mjs` does not, so the orchestrator runs it only when nothing else is driving a window.
- X4 and X5 time tests under a controlled load and need the machine otherwise quiet. The orchestrator runs each alone, when no builder is in a verify turn. For their loaded runs only, they may run more browser test files at once than the two the builder rules allow.
- Engine: the shipped app is WebView2 (Chromium); the tool runs headless Edge, which is the same engine. Where an experiment's result could differ in the test engine (Playwright WebKit), say so and check (X9).
- The builder rules in `C:\Dev\reader\work\wave1\wave1-cut.md` apply (commands, machine load, no ids in code), except that an experiment needs no tests, docs or verify turn.
- A result that surprises is worth more than one that confirms: report it plainly, including when it says the plan is wrong.

| # | Experiment | Decides | Needs | Builder | Time box |
| --- | --- | --- | --- | --- | --- |
| X1 | Skipped layout for prose | steps 2c and 2d: order, scope, go or no-go | wave 1 landed | Opus | 2 days |
| X2 | Holding the page still while type above is set | how 2c compensates | X1's bounded-queue variant | Sonnet | 1 day |
| X3 | Seeded region parse equals whole parse | 1e parse level | (inside `definitions-index`) | Opus | in the branch |
| X4 | One bundle for browser tests | the harness conversion | `verify-defaults` landed; a quiet machine | Sonnet | 1 day |
| X5 | A quiet-page detector instead of sleeps | the sleep conversion | a quiet machine | Sonnet | 1 day |
| X6 | What the startup chunk costs | whether to split it (`startup-split`) | an exe build; nothing else driving a window | Sonnet | 1 day |
| X7 | What each crate weighs in the exe | decoder trims | Ian's OK to install `cargo-bloat` | Haiku | 1 hour |
| X8 | What a round trip to Rust costs | the batched index walk | an exe build, the machine lock | Sonnet | half a day |
| X9 | What the test engine supports | how shift 2's tests are written | none | Haiku | 1 hour |
| X10 | The splice on small documents | dropping the 64 KB floor (1d) | `splice-all` landed | Sonnet | 2 hours |

X9 first (an hour, no dependencies), then X1 as soon as wave 1 is in master. X4 and X5 wait for a quiet machine.

## X1. Skipped layout for prose

**Question.** With `content-visibility: auto` on the article's top-level blocks and typesetting bounded to the neighbourhood of the reader, does the main-thread work to open and settle a long page fall to a third or less, does a typesetting slice stop costing more on a longer document, and does anything the reader sees change?

**Why.** It is the largest step in the plan (the baseline grid has to be rebuilt to work block by block), and three things could sink it that reading the code cannot settle: geometry reads elsewhere in the app silently undoing the skip; paint containment clipping things drawn outside a block's box; and layout containment changing spacing.

**What is known.** The app already does this for big code and log files: `pre.marxy-run { content-visibility: auto; contain-intrinsic-size: auto calc(...) }` at `packages/theme/src/base.css:603-604`, with the reason in the comment above it, and a restore loop that tolerates heights that firm up (`apps/desktop/src/commands/log.ts:274-283`). From the CSS Containment spec: a script that reads layout inside a skipped block forces that block's layout; reading the block's own box does not (it reports the remembered or estimated size); `auto` implies layout, style and paint containment at all times and size containment while skipped; Chromium fires `contentvisibilityautostatechange` on a block when it starts or stops being skipped. The typesetter measures with Range rectangles in the live page (`packages/typeset/src/measure.ts:90-108`), so a paragraph must be laid out to be set.

**Variants**, switched by one attribute on the root read at boot (throwaway):

- V0: master with wave 1.
- V1: bounded queue only. The idle queue holds paragraphs within three screens beyond the observer's margin and extends as the reader scrolls; nothing else changes.
- V2: skipping only. `.marxy-article > *` gets `content-visibility: auto; contain-intrinsic-size: auto <estimate>`, the estimate a whole number of grid units (try six line boxes); the queue is unbounded as today.
- V3: both.
- V4: V3 with the whole-page reads stubbed: the block list (`apps/desktop/src/render/post.ts` `buildBlocks`) measures only blocks near the viewport and keeps the last or estimated values for the rest; the whole-article grid pass (`packages/typeset/src/grid.ts` `snapToGrid`) is replaced by the per-block form (`snapBlocks`, pad the block itself to whole units); the typesetter's read of every paragraph at open is removed if `typeset-waste` has not already done it; the two proposals that read every table and footnote reference (`proposals/table-aids.ts`, `proposals/notes-in-place.ts`) are off.

**Measure**, per variant and document (25 KB, 195 KB, 195 KB plain, 1 MB):

1. Open: time to first content; `TaskDuration`, `LayoutDuration`, `RecalcStyleDuration` and `LayoutCount` from open until the page is quiet; the longest task; DOM nodes.
2. Per typesetting slice: paragraphs set and the slice's own duration, logged by the spike code; report the median and the worst, and plot (or tabulate) against document size. This is the number that should stop growing.
3. Cursor key and first click, as the tool measures them.
4. Wheel scroll through the document while type is being set and after: frame time p50, p95, worst; frames over 50 ms.
5. A jump to the last heading from the Outline, and a jump to the end: `TaskDuration` to quiet, and whether the landing is right (the target heading's top within one line of the reading line once quiet).
6. A change of pane width that re-breaks: `TaskDuration` to quiet.
7. Scroll height at open, after scrolling through the whole document once, and after scrolling through it again: how far the estimate was off, and whether it is stable once seen.

**Count the reads that undo the skip.** Track which top-level blocks are skipped (the state-change event). Wrap `getBoundingClientRect`, `getClientRects`, `offsetHeight`, `offsetTop`, `scrollHeight`, `getComputedStyle` and Range rectangle reads in the page; when a read lands inside a block that is skipped at that moment, record the app source location that made it (first app frame of the stack). The list of locations, with counts per scenario, is the main output: it is exactly the code that must move to the geometry table (step 2b). Do it for open, scroll, cursor keys, click, find, an Outline jump, and Source and back.

**Look for what changes on the page.** After everything is set (use a set-all switch), take pictures of the first five screens and five screens from the middle in V0 and in V2 at the same width, and compare them pixel for pixel (`pnpm --filter @marxy/desktop shots` takes pictures; write a small comparison). Any difference is a finding. Check by eye and report with a picture each: hanging punctuation at the left edge of a paragraph (it is drawn outside the content box: `packages/typeset/src/hang.ts:109` writes a negative `margin-inline-start`); list markers; the cursor's and selection's outline around a block; margin notes; a wide table or code block that runs past the measure; the focus ring; block quote rules. Paint containment clips at the block's padding edge, so anything drawn beyond it disappears; if something is clipped, try `overflow-clip-margin` on the block and say whether Chromium honours it under containment, and try giving blocks inline padding with a matching negative margin.

**Check the grid.** In V4, once quiet, for the blocks on screen: what share have a top that is not a whole number of grid units from the article's top. Then scroll a screen at a time through the document and repeat. The per-block form should keep every block on the grid; if it does not, say which block kinds break it (margins collapsing between siblings, islands).

**Run the tests that pin the old behaviour** in V4 and list each failure with its cause in a line: `apps/desktop/test/typeset-idle.test.mjs`, `progressive.test.mjs`, `progressive-large.test.mjs`, `scroll-persistence.test.mjs`, `place-across-modes.test.mjs`, `find-pane.test.mjs`, the spine and outline tests, `packages/typeset/test/typeset.test.mjs` and `keep-place.test.mjs`. Group them: assumes every paragraph is set; assumes block positions are exact; real breakage. They run in WebKit: note where the engine, not the change, is the cause.

**Decision rule.**

- Go for 2d if, in V4 on the 195 KB document, `TaskDuration` from open to quiet is a third or less of V0, the median slice on the 1 MB document is within twice that on the 25 KB document, the picture comparison shows no difference that cannot be fixed with a clip margin or padding, and the list of code that reads into skipped blocks is fifteen locations or fewer.
- If V1 alone gives 70% or more of V4's gain, build 2c first and put 2d after everything else.
- If V2 gives little because reads keep un-skipping blocks, that confirms 2b (the geometry table) must come before 2d, which is the plan's order.
- If the pictures differ in ways containment cannot avoid (clipped hanging punctuation with no workaround, changed spacing), report the alternatives you see (containment on wrappers around runs of blocks, `contain: layout` without paint containment, bounded typesetting alone) with a measurement for the best of them.

## X2. Holding the page still while type above is set

**Question.** When the reader scrolls up into paragraphs that are not yet set, and they are set as they approach, does the text under the reader stay where it is?

**Why.** Step 2c makes this the ordinary case. Today's compensation (`keepPlace`, `packages/typeset/src/index.ts:502`) is skipped while the reader is scrolling (`readerIsScrolling`, within 200 ms of input), and the browser's own scroll anchoring is switched off by the grid pass (`packages/typeset/src/grid.ts:72` sets `overflow-anchor: none`). Find out first why it was switched off (the comment there, `git log -S"overflow-anchor"`): if native anchoring and the app's corrections fought each other, the experiment must not reintroduce that.

**Method.** On X1's V1 (bounded queue), open the 195 KB document and jump to the end, so everything above is unset. Scroll up four ways: slow (100 px every 50 ms), medium (400 px), fast (2,000 px), and by setting `scrollTop` in steps as a scrollbar drag does. On every frame, take an element that is on screen in this frame and the last, and compare how far it moved on screen with how far the scroll moved: the difference is a jump. Also count, per frame, paragraphs on screen that are not set (class `marxy-set` absent on a candidate paragraph).

Arrangements to compare:

- A: as today (no anchoring, `keepPlace` idle during scroll).
- B: native anchoring on (`overflow-anchor: auto` on the scroller and article, the app's own correction off during scroll).
- C: B with the set-ahead margin doubled (so paragraphs are set further from the screen).
- D: `keepPlace` allowed to run during scroll, native anchoring off.

**Record.** Per arrangement and speed: the largest jump in pixels, the number of frames with a jump over two pixels, and unset-paragraph frames. A screen recording or a strip of pictures of the worst case in A and in the best arrangement.

**Decision rule.** Take the arrangement with no jump over one line and the fewest unset-paragraph frames. If only native anchoring achieves it, note that WebKit has none (X9 confirms), so the tests for this behaviour must run in the shipped engine and `keepPlace` stays as the path for WebKit. If nothing achieves it at the fast speed, say what the reader would see and whether a larger margin at high scroll speed fixes it.

## X3. Seeded region parse equals whole parse

Inside the `definitions-index` branch; its brief has the method (the equality test extended to documents with definitions before the change is written, then the stress forms). Record in the branch's report: cases run, the share that took the region path, every difference found and what was done about it. The decision rule is absolute: any class of edit where equality cannot be guaranteed falls back to the whole parse.

## X4. One bundle for browser tests

**Question.** How much does each test's boot cost when the app is served as about 250 separate modules by the dev server, against one built bundle, and does the bundle end the timeouts seen when several builders run at once?

**What is known.** 177 browser test files boot through the dev server (`apps/desktop/test/support/two-pane.mjs:94-172`: a new page, `goto app.html`, the module graph fetched again); 73 already build `app.html` and serve it statically (`test/support/shared-vite.mjs`). 99 files import app modules by address inside the page (`import('/src/...')`), which a bundle cannot serve; eight modules account for nearly all of it (`selection/bind.ts`, `shell/memory.ts`, `source/editor.ts`, `app.ts`, `commands/index.ts`, `main.ts`, `notices/index.ts`, `look/store.ts`). Logs show 112 timeout errors across 12 runs, 42 in one.

**Method.** Step one: pick ten dev-server test files from different areas that do not import `/src/` in the page. Add a switch (`MARXY_HARNESS_BUNDLE=1`) so `harnessBase()` builds `app.html` once and serves the build. Instrument `bootTwoPanes` to record, per boot, the time from the new page to `handle.ready` and the number of requests. Run each file three times each way on a quiet machine, and three times each way with three other browser files running beside it. Step two, only if step one pays: expose the eight modules from the harness bundle on one global (a registry), convert three of the 99 files to use it, and measure the same.

**Record.** Per file and mode: wall time, sum of test durations, median boot time, requests per boot, timeouts. Total for the ten.

**Decision rule.** Convert the suite if the median boot is 0.4 s or more faster, or if timeouts under load go to zero where the dev server had any. If neither, drop it and say so: the saving was a guess.

## X5. A quiet-page detector instead of sleeps

**Question.** Can the test harness tell when the page has nothing left to do, so a test waits exactly that long, including the tests that wait to show that nothing happens?

**What is known.** 458 `waitForTimeout` calls in 123 files, 177 more sleeps inside the page. In a sample of 42: 15 wait to show nothing happens, 8 wait out one of the app's own timers, 9 wait for a render or scroll to settle, 3 for an animation, 3 for a watch event, 3 for the typesetter or highlighter, 1 uses the delay as its variable. A "content is complete" signal replaces at most a third; a detector of quiet could replace most.

**Method.** In `test/support`, a helper `quiet(page, { longest: 1500 })` installed by an init script that wraps `setTimeout`, `clearTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback` and the memory shell's calls, and resolves when: no timer due within `longest` is pending, no frame or idle callback is pending, no shell call is in flight, and the DOM has not changed for two frames. Known repeating polls must be named and ignored or it never resolves: the typesetter's hidden-page hold (250 ms), highlight's `settled` poll (50 ms), the look engine's five-minute interval. Timers longer than `longest` are ignored and listed. Convert three files: one with mostly negative waits (`pane-close-guard.test.mjs`, 16 sleeps), one with mostly debounce waits (`line.test.mjs`, 22), one mixed (`mode-swap.test.mjs`, 17). Run original and converted twenty times each alone, and ten times each with three other browser files running.

**Record.** Per file and version: passes out of runs, median and worst duration, and each sleep that could not be converted with the reason.

**Decision rule.** Adopt if every converted file passes at least as often as its original and runs no slower. Report the classes it cannot serve.

## X6. What the startup chunk costs

**Question.** How much of the 774 ms cold start is the 1.38 MB entry chunk (559 modules), and what does deferring the modules not needed for first paint return?

**What is known.** Marks, median of ten launches of the installed build: window shown at 392 ms, script start 516, arguments read 574, file read 590, parsed 624, rendered 670, painted 774. So 124 ms pass between the window and the script starting (the page, the fonts, fetching and compiling the chunk), and 58 ms evaluating it: about 180 ms is the ceiling for any split. Whether WebView2 keeps compiled code for the app's scheme is not known.

**Method.** Needs a release build (`pnpm --filter @marxy/desktop build` in the worktree) and `scripts/measure-startup.mjs`, which launches the real app ten times and does not take the machine lock: the orchestrator runs it only when no `check:tauri`, `shots --exe` or full verify is running, and starts none while it runs. Baseline: ten launches, twice. Variant: load on demand the groups that first paint of a Markdown file cannot need (the non-Markdown readings behind `readingOf`, transforms, versions, the look engine and settings schema, command families not bound at boot), with no change in behaviour; ten launches, twice. Use `node scripts/bundle-report.mjs` to confirm what left the entry chunk.

**Decision rule.** Build the split properly only if the median first text improves by 50 ms or more in both runs. Otherwise drop it: startup is dominated by the 392 ms before the window, which the app does not control.

## X7. What each crate weighs in the exe

**Question.** Which crates make up the 16.1 MB of machine code?

**Method.** Needs Ian's OK first: it installs a developer tool (`cargo install cargo-bloat`). Then, in a worktree, `cargo bloat --release --crates -n 40` with the release profile's `strip` turned off for that run (`CARGO_PROFILE_RELEASE_STRIP=false`). About ten minutes of build.

**Decision rule.** Any decoder family over 500 KB whose formats nobody has yet opened in a real window (tracker row W6: OpenEXR, JPEG XL, DDS, PSD, the rarer audio facts) goes to Ian as a candidate to cut, with its size.

## X8. What a round trip to Rust costs

**Question.** How long does one small command take from the page and back in the real window, and how long does the index walk take on a real folder?

**Why.** The index walk makes one `readDir` call per folder, in series (`apps/desktop/src/index/walk.ts:244-252`). Whether batching it is worth a new command depends entirely on this number, which nobody has.

**Method.** In the built app (`pnpm --filter @marxy/desktop build` first), driven by a `shots --exe` scenario written for the experiment, which takes the machine lock and can run script in the real window's page: from the page, time 1,000 `stat` calls in series and 1,000 in batches of sixteen, and `readDir` on 200 folders in series. Then time the index's first walk on this repository's checkout (about 2,500 files, 216 folders) and on the largest ordinary folder available on the machine, from the walk's start to the `index_loaded` mark.

**Decision rule.** If a call in series costs 0.3 ms or more, a tree of 5,000 folders spends 1.5 s or more on round trips alone: build `read_tree`. If 0.1 ms or less, drop it and keep only the single listing.

## X9. What the test engine supports

**Question.** In the Playwright WebKit this repository pins (Playwright 1.63.0): does `content-visibility: auto` apply to block elements and fire `contentvisibilityautostatechange`; is there scroll anchoring (`CSS.supports('overflow-anchor: auto')`, and does it act); are `scheduler.yield` and `scheduler.postTask` present; what WebKit version is it? And can a smoke set of the browser tests run in Edge?

**Method.** A page with a few hundred blocks and a script that reports each answer. Then run ten browser test files from different areas with the browser switched to Chromium by whatever `scripts/playwright-webkit.mjs` allows (or a local edit on the throwaway branch), and list failures by cause.

**Decision.** Not a go or no-go: it says which of shift 2's behaviours can be tested in the suite's engine and which need a small set run in the shipped engine, and how hard that set is to run.

## X10. The splice on small documents

**Question.** Below 64 KB, is updating the page in place at least as cheap as rebuilding it, and does it keep the page's type set?

**Method.** After `splice-all` lands, with the floor (`INCREMENTAL_MIN_BYTES`, `apps/desktop/src/view/rendered-view.ts:310`) lifted on a throwaway branch: on the 8 KB and 25 KB documents, one small edit then undo, measured both ways: `TaskDuration`, top-level nodes replaced, and how many set paragraphs lost their setting (count `marxy-set` before and after).

**Decision rule.** Drop the floor if the in-place path costs no more `TaskDuration` on both documents. Expected: it also keeps every unchanged paragraph set, which is the visible gain.
