# Testing and checks

How Marxy is tested, how to run each layer, and what each repository check guards. Setup is in
[development.md](development.md); where these checks sit in the course of a change, and how to take
pictures of one, is in [working.md](working.md).

## Layers

| Layer | Where | Run |
| --- | --- | --- |
| Core unit tests | `packages/core/src/**/*.test.ts` | `pnpm --filter @marxy/core test` |
| Theme and typeset tests | `packages/theme/{src,test}`, `packages/typeset/{src,test}` (some drive WebKit) | `pnpm --filter @marxy/theme test`, `pnpm --filter @marxy/typeset test` |
| Desktop tests | `apps/desktop/src/**/*.test.*` (Node) and `apps/desktop/test/*.test.mjs` (most boot the app in WebKit) | one file at a time, below |
| Script tests | `scripts/*.test.mjs`, `scripts/lib/*.test.mjs` | `node --test scripts/lib/*.test.mjs scripts/*.test.mjs` |
| Rust tests | `apps/desktop/src-tauri/src/**` | `cargo test` in `apps/desktop/src-tauri` |
| Repository checks | `scripts/check.mjs` | `pnpm check` |
| All of the above for a tree, in tiers | `scripts/verify.mjs` | `pnpm verify` |
| Goldens | `packages/core/goldens/` | `pnpm gate:golden` |
| CommonMark spec | `packages/core/scripts/commonmark-spec.ts` | `pnpm --filter @marxy/core test:spec` |
| Byte fidelity | `scripts/gate-fidelity.mjs` | `pnpm gate:fidelity` |
| Smoke of a built binary | `apps/desktop/scripts/smoke-cli-open.mjs` | runs at the end of `pnpm --filter @marxy/desktop build` |
| The real window | `apps/desktop/scripts/tauri-check.mjs` | `pnpm --filter @marxy/desktop check:tauri` |

`pnpm test` runs every package's tests and then the script tests; the desktop package's `test` runs its
whole suite one file at a time, which takes more than an hour. For day-to-day work run the files that
cover what changed.

## One command for a tree: `pnpm verify`

`scripts/verify.mjs` runs the checks of a tree in tiers, each step with a timeout and its own log, and prints one line
per step (name, pass or fail, wall seconds, test counts parsed from the output) and a table at the end. It exits
non-zero if any step failed. It uses absolute paths, never changes directory, and works in any worktree (`--root <dir>`
checks another one).

| Tier | Runs |
| --- | --- |
| `quick` (default) | `pnpm install --offline`, typecheck, lint, `pnpm check`, `gate:golden`, `gate:fidelity`, `gate:licences`, and the unit suites of the packages that changed |
| `changed` | `quick`, plus the browser test files that cover the changed folders, `lint:rust` and `cargo test` when `apps/desktop/src-tauri` changed |
| `full` | every unit suite, `lint:rust`, `cargo test`, every browser test file, `gate:aesthetics --mechanical`, `test:mutations`, `pnpm --filter @marxy/desktop build`, and on Windows `check:tauri` |

CI (`.github/workflows/ci.yml`) runs this tool and nothing of its own, in three jobs (macOS, Windows, Linux), and a fourth, `ci` (the check branch
protection requires), which passes when all three do (`linux` joined after two green runs in a row). A pull request runs `--tier changed`, so it pays only for the suites its diff
touches; a push to `main` runs `--tier full`. Both leave out `browser` and `tauri` with `--skip` (the browser suite takes
two hours on a hosted runner and 14 of its files fail there; `work/todo.md`, M4/M5). macOS also skips
`unit-desktop-browser`, whose first WebKit boot misses its budget on a hosted macOS runner (Windows runs it), and runs
the release build on `main` only; Windows skips the build. Linux (`ubuntu-latest`, Tauri's WebKitGTK packages
installed first) skips the same two plus `unit-desktop-browser` and `aesthetics`, runs the release build on `main`, and
its smoke launch runs under `xvfb`; it is the only place the `cfg(unix)` Rust paths other than macOS's run. The smoke check also launches the document
five times and prints the median time to first text (`smoke-cli-open startup:` in the build log), on a CI runner, so an upper bound on a laptop. A manual run takes any tier on Windows, browser suite
included. Each job uploads its step logs as an artifact.

"Changed" means changed since the merge base with `--base` (default `main`): commits, staged and unstaged edits, and
untracked files. A changed path decides the suites: `packages/core`, `packages/theme`, `packages/typeset`, `scripts/`
and `apps/desktop/src` each run their own (`apps/desktop/scripts` runs the desktop one, its tests among them); a change to `package.json` or the lockfile runs all. The desktop unit
suite is two steps: `unit-desktop` runs every Node-only file side by side (`--unit-jobs` at a time, by default up to
four), and `unit-desktop-browser` runs the files that start WebKit one at a time (`DESKTOP_UNIT_BROWSER` in
`scripts/verify.mjs`; `scripts/verify.test.mjs` fails when a Node-only file itself names Playwright, Vite or a browser helper of
`test/support/`; it does not follow the file's imports).
`scripts/probe-layout.test.mjs` is left out of the script tests in `quick` and `changed`; `full` runs it.

```bash
pnpm verify                                  # quick, against main
pnpm verify --tier changed --base agent/integration
pnpm verify --tier full --logs C:/tmp/run1
pnpm verify --from golden                    # resume at a step, with the rest of the tier
pnpm verify --only lint,check --list         # show the plan without running it
```

| Option | Effect |
| --- | --- |
| `--tier quick\|changed\|full` | the tier |
| `--base <ref>` | the ref changes are measured against |
| `--logs <dir>` | where each step's log (`NN-step.log`) and `summary.json` go; default `marxy-verify/<worktree>-<time>` under the OS temp folder |
| `--from <step>`, `--only a,b` | resume at a step; run only the named steps (any step, whatever the tier or the change) |
| `--skip a,b` | the tier's steps, change gating kept, less the named ones (CI's form) |
| `--list` | print the changes and the steps, run nothing |
| `--jobs <n>` | browser test files at a time (default 2 in the `changed` tier and 3 in `full`; see below) |
| `--unit-jobs <n>` | Node-only desktop unit files at a time (default the cores less one, at most 4) |
| `--lock-wait <sec>` | how long `check:tauri` waits for another run (default 900) |
| `--no-lock` | skip the verify place described below |
| `--timeout-scale <x>` | multiplies every step's timeout (slow machine) |
| `--check-map` | lists stale names, test files in no map entry and source folders with no key in the map |

Steps are named `install`, `typecheck`, `lint`, `check`, `golden`, `fidelity`, `licences`, `unit-core`, `unit-theme`,
`unit-typeset`, `unit-scripts`, `unit-desktop`, `unit-desktop-browser`, `lint-rust`, `browser`, `cargo`, `aesthetics`, `mutations`, `build` and `tauri`.

The browser step's timeout is 3600 s or a minute per file divided by `--jobs`, whichever is longer, so a `full` run of every file stays inside it.

### The change-to-test map

`scripts/verify-map.json` says which `apps/desktop/test/*.test.mjs` files cover which folders. Its `map` has one key per
source folder (the longest key that prefixes a changed path wins; the key `apps/desktop/src` stands for the files
directly in `src`, and `packages/*` have keys too). An empty list means the folder is covered by unit tests, cargo or
docs rather than by a browser test. A changed path with no key, and a change to the Playwright helper, Vite's config or
the desktop `package.json`, runs the `fallback` set. A change under `apps/desktop/test/support/`, which every browser
test uses, runs `SUPPORT_SMOKE` in `scripts/verify.mjs`: about thirty files, one or two for each area of the app, and the desktop unit suite, some of whose files import those helpers. A
change under `apps/desktop/scripts/` runs no browser file, only the desktop unit suite. The `full` tier ignores the map and runs every browser test
file. A changed test file always runs itself.

The map is plain JSON and `scripts/verify.test.mjs` fails when it names a file that is gone, omits a browser test file from every entry, or
lacks a key for a folder of `apps/desktop/src`. Add a new test file under the folder or folders it covers, and a new
source folder as a key.

### A turn for the heavy steps

Several runs on one machine starve each other's browser tests, so `pnpm verify` holds one of a few places, as lock
files `marxy-verify-1.lock` and on in the OS temp folder, from its first heavy step to its last: the unit suites of the
packages, `lint-rust`, `browser`, `cargo` and `build`. The cheap steps before (install, typecheck, lint, check, the
gates) and `tauri` after (it has its own lock) run outside it. The number of places is `MARXY_VERIFY_SLOTS`
(default 2). A run that finds every place taken prints who holds them and waits, up to `MARXY_VERIFY_SLOT_WAIT_SEC`
(default 10800). A place whose owner process is gone, or that is over six hours old, is taken over. `--no-lock` skips
the turn (a run that is the only one working, or one already inside another queue). `MARXY_LOCK_DIR` moves every
lock file to another folder, for a proof run that must not meet the machine's real holders. A `--list` run takes no place.

### One `check:tauri` at a time

`check:tauri` takes the lock file `marxy-check-tauri.lock` in the OS temp folder before it launches the app, so two runs
on the machine, from any checkout and with or without `pnpm verify`, never fight over port 9333. A second run fails with
the holder's pid and start time, or waits when `MARXY_LOCK_WAIT_SEC` (set from `--lock-wait` by `pnpm verify`) is above
0. A lock whose process is gone is taken over.

## Running tests

Node's own runner, with TypeScript stripped:

```bash
node --test --experimental-strip-types packages/core/src/parse/parse.test.ts
node --test --experimental-strip-types --test-name-pattern="front matter" packages/core/src/parse/parse.test.ts
```

Desktop tests run from `apps/desktop` (their paths are relative to it):

```bash
node --test --test-concurrency=1 --experimental-strip-types test/save.test.mjs
```

- A browser test run alone starts its own Vite dev server (or builds the app) on a free port, boots
  `src/app.ts` over the memory shell with the files the test names, and drives it in headless WebKit
  (`scripts/playwright-webkit.mjs`). `MARXY_BROWSER_HEADED=1` shows the window.
- `node scripts/browser-tests.mjs [--jobs n] test/a.test.mjs ...` (from the repo root, paths relative to
  `apps/desktop`) runs a batch with one dev server, one WebKit and one production build per set of
  build options, started once and shared through `MARXY_HARNESS_URL`, `MARXY_BROWSER_WS` and
  `MARXY_BUILD_CACHE`. Each file still gets its own process, connection, browser contexts and pages, but
  the dev server and its module cache are shared; the browser is closed and the build cache deleted when
  the batch ends, including on Ctrl+C. Test files take
  `build` and `createServer` from `test/support/shared-vite.mjs`, which are Vite's own when those
  variables are unset. `pnpm verify`'s `browser` step uses this runner.
- Without Playwright's WebKit installed, browser tests skip; `MARXY_BROWSER_TESTS_REQUIRED=1` makes that
  a failure.
- For a wider run, three files at a time (`--test-concurrency=3`) in batches that finish within about
  ten minutes; many files at once starve each other and time out. Do not edit app source while browser
  tests run: the dev server serves the source live and the builds are made from it.
- `test/support/` holds the helpers: `two-pane.mjs` (start the harness, boot panes), `frame.mjs` (tab,
  panel and card readers), `store-walk.mjs` (a seeded random walk over the document store), stubs that
  run `src/shell/tauri.ts` under Node.

Size and seed knobs for the heavier tests:

| Variable | Effect |
| --- | --- |
| `MARXY_LOG_MB`, `MARXY_SESSION_MB`, `MARXY_CSV_MB`, `MARXY_DIFF_MB`, `MARXY_JUMP_DIFF_MB`, `MARXY_JUMP_PY_MB` | sizes of generated large inputs |
| `MARXY_COST_RUNS` | runs of the split-cost test |
| `MARXY_WALK_SEED`, `MARXY_WALK_SEEDS` | replay one seed, or set the seed count, of the store walk |
| `MARXY_WALK_PANES_SEEDS`, `MARXY_WALK_PANES_STEPS` | the two-pane walk |
| `MARXY_CASE_SEED` | seed of the generated parse cases |
| `REPARSE_SEEDS`, `INVARIANT_INPUTS` | core's stress runs (`test:reparse-stress`, `test:invariant-stress`) |

### Time budgets

A unit test that holds synchronous work to a budget reads `cpuNow()` (`packages/core/src/testing/cpu-clock.ts`, and a copy
in `apps/desktop/src/testing/` because a relative import never leaves its package): the thread's CPU time, so a machine
busy with other processes does not fail it while a slower implementation still does. Windows charges CPU time in ticks of
about 16 ms, so use it for budgets of 100 ms or more and give a ratio between two timings a floor. Tests that time async
work, a timer, or the page keep the wall clock, since CPU time would miss that work. A reader that counts its work on a budget (`util/budget.ts`) is better proved by the count than by a clock: feed it hostile input and check its `refused`, what it kept, and the line that says it stopped.

### Mutation check

`pnpm --filter @marxy/desktop test:mutations` loads a module with one change patched in at import
time (`scripts/mutation-hooks.mjs`) and requires the named tests to fail and every other test to
pass, proving those tests can catch that change. Product code has no mutation switch. It takes under a minute and
runs in the `full` tier (the `mutations` step), so on a push to `main`.

## The real window

```bash
pnpm --filter @marxy/desktop build
pnpm --filter @marxy/desktop check:tauri
```

Windows only. It launches `src-tauri/target/release/marxy.exe` on a file from `fixtures/demo` with a
fresh temporary `MARXY_DATA_DIR` (its own config, data, webview profile and single-instance lock, so it
never touches the reader's own Marxy) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` opening debugging port
9333, attaches Playwright over CDP and prints one `PASS` or `FAIL` line per check. It covers the frame,
panels, the Line, a second launch handing over a file, readings, Settings, refusals of unlisted
commands and navigation, saves by rename, versions, staged changes, `marxy-file://` ranges and
refusals, image decoding, a 2 GB sparse video, Source edits, archives and their previews, databases in
archives, fonts, media, PDF with Find, the index sweep, relaunch restoring panel, place and tab order,
tab dragging and Explorer file drops, then cases on a real disk: a save refused after another program changed the file (both conflict choices, nothing added to Versions), UTF-16LE and CRLF UTF-8 files with a BOM saved byte for byte, a save after the file was deleted or renamed from outside, the shell's scope (an unopened neighbour refused, the folder crumb, an index root read-only), F11 and Esc read from the window, a 20 MB log as Lines with the window's memory growth bounded at 600 MB, and program cards for a generated minimal program and a copy of a system one. A run takes several minutes; `MARXY_CHECK_SHOTS=<dir>` keeps
screenshots. Only one run can use port 9333 at a time: it takes a lock file (see `pnpm verify` above).

This is the check that sees Windows-only behaviour the browser tests cannot (paths, drops, the shell's
file access); run it after changes to the shell, file handling or the frame.

## Repository checks (`pnpm check`)

`scripts/check.mjs` runs each check as its own process and prints one line per check; a failure prints
the last lines of the check's output, ending in a `fix:` line. `--only=name[,name]` picks checks;
`--staged` limits the registry check to staged files.

| Check | Guards |
| --- | --- |
| `check-boundaries` | import rules: `packages/core` imports no DOM globals, no Node built-ins, no Tauri, no other `@marxy` package but `shell-api` types, and no second Markdown stack; `typeset` and `theme` import no Tauri or Node; `shell-api` imports nothing; in `apps/desktop/src`, `@tauri-apps` and raw `invoke(` appear only under `src/shell/`; no relative import leaves its package |
| `check-registry` | every startup mark, `marxy:` event and `data-marxy-*` attribute is listed in `scripts/registry.json`; class names start `marxy-`; custom properties in CSS are `--marxy-*`; every `--marxy-*` used is a theme token or listed; no registered name is assembled in code; markup from strings only on `innerHtmlAllowedIn` paths |
| `check-deps` | every npm package and Rust crate is in `scripts/allowlists/dependencies.json` and none is on its forbidden list |
| `check-one-parse` | no second Markdown parser or sanitiser in any manifest, the lockfile or the desktop and script sources |
| `check-tokens` | `packages/theme/src/tokens.css` matches `tokens.contract.json` (names, unit kinds, a comment per token); `--write` updates the contract |
| `gate-font-attrs` | git attributes under `fonts/`: font binaries are `binary` with no line-ending conversion |
| `gate-contrast` | every bundled theme, variant, kind scope and look meets its contrast floors |
| `check-csp` | the release CSP keeps `style-src` free of `'unsafe-inline'`; no runtime `<style>` elements; every CodeMirror view gets the CSP nonce |
| `check-commonplace` | every bundled reading piece is sourced, public domain by its dates, and correctly formed |
| `check-listeners` | listeners on the window and the document added with no `signal` and no `removeEventListener`, per folder of `apps/desktop/src`, do not grow past `scripts/allowlists/listeners.json`; `--write` records the counts after a folder's count falls |

## Gates outside `pnpm check`

| Command | Guards | Notes |
| --- | --- | --- |
| `pnpm gate:licences` | every npm package, crate, Shiki grammar and hyphenation pattern has a permissive licence | reads `node_modules/.pnpm` and the cargo registry; records in `scripts/allowlists/` |
| `pnpm gate:no-network` | rendering every corpus file and every hostile vector makes no request off the machine and leaves the DOM inside the sanitiser's allow-list | WebKit and Chromium; writes `results/no-network.json` |
| `pnpm gate:bundle` | core loads no KaTeX; the shipped entry reaches no harness or memory shell; `dist/` has no test-only code and one HTML file | run after `build:web` for the `dist/` half |
| `pnpm gate:golden` | the parse tree and rendered HTML of every corpus file match `packages/core/goldens/` | `pnpm --filter @marxy/core test:golden -- --update` rewrites them |
| `pnpm gate:fidelity` | saves are byte-exact: compiles `atomic_write.rs` with `rustc` and round-trips every corpus file, checks edits change only their range, and plants broken save paths to prove it fails | needs `rustc` and symlink permission |
| `pnpm gate:aesthetics` | rendered pages over the corpus: baseline grid, measure, contrast, layout shift, rag, hanging punctuation, hierarchy, screenshots | runs in the `full` tier as `--mechanical` (no screenshot or rag baseline comparison, since the baselines are per machine), about ten minutes; the screenshot comparison is run by hand on the machine the baselines came from. Failures the page has today are listed, not hidden: geometry cases by class with an exact count in `GEOMETRY_CLASSES`, and the rest in `KNOWN_FAILING`, both in `scripts/gate-aesthetics.mjs`. A class not listed, a count that rises, and (on macOS) a count that falls without the list being lowered each fail the gate, so the lists only shrink |
| `pnpm --filter @marxy/core test:spec` | every CommonMark 0.31.2 example renders equivalently and keeps the tree's invariants | the spec file is not in the repo: download it from the URL `--print-url` prints to the path `--print-dest` prints |
| `pnpm lint`, `pnpm typecheck`, `pnpm lint:rust` | Biome (unused imports), TypeScript, `cargo fmt` and `clippy` | |

## Fixtures

| Folder | Holds | Used by |
| --- | --- | --- |
| `fixtures/corpus/` | about 47 numbered documents of every shape (long technical, README, plans, source files, pathological tables and nesting, maths, CJK, right-to-left, hostile HTML, empty, CRLF with BOM, no final newline, logs, diffs, CSV, transcripts), stored byte-exact | goldens, fidelity, no-network, aesthetics, perf tools, smoke, many tests |
| `fixtures/demo/` | a sample workspace in 24 folders: plans, handoffs, notes, reading, source, logs, sessions, patches, data (JSON, YAML, JSONL, CSV, SQLite), sheets, documents (a Word document and a deck), Windows shortcuts, images, archives, encodings, fonts, media, mail, notebooks, a site and a sample project | the browser dev loop, the demo build, `check:tauri`, the demo tour, many tests |
| `fixtures/certs/` | test-only certificates and keys built by `make-certs.mjs` (hand-written DER signed with Node's crypto; its helpers also build the unit tests' variants): PEM, DER, a bundle, a private key as PEM and DER, a certificate with a key | the certificate card's core and browser tests |
| `fixtures/programs/` | tiny PE samples built by `make-programs.mjs`: 32-bit, 64-bit and ARM64, with and without a version resource, signed, a reproducible build, a cyclic and an oversized resource tree, a truncated file | the program card's core and browser tests |
| `fixtures/pictures/` | tiny pictures built by `make-pictures.mjs`: pbm, pgm, ppm, pam, farbfeld, DDS (BC1, BC7 and one cut short), SVGZ and a gzip bomb, PSDs with a flattened image (PackBits and raw), with only a thumbnail, with neither, and with a resource longer than the file | the Rust decoders and facts (with fuzzing), core's picture facts, `pictures.test.mjs`, and tauri-check's PSD |
| `fixtures/detect/` | files of assorted types with `expected.json` | detection in Rust and core |
| `fixtures/content-search/cases.json` | content search cases | the Rust search and its TypeScript twin |
| `fixtures/media/`, `fixtures/sheets/` | audio and spreadsheet samples (and their generators) | Rust tests, media tests |
| `fixtures/themes/` | two theme folders | theme loading tests, the aesthetics gate |
| `fixtures/baselines/` | screenshot and rag baselines per engine | the aesthetics gate |
| `fixtures/perf-budgets.json` | installer size budgets | `gate:bundle` |

## Measurement tools

None of these fail on a number; they print measurements. All are run from the repository root and
listed in [scripts/README.md](../scripts/README.md#measurements).

| Command | Measures |
| --- | --- |
| `pnpm perf` (`scripts/perf-harness.mjs`) | open, render, typeset, reload, second-document and palette timings in WebKit over the corpus or generated large files (`--large 256k`, `--transcript`, `--reload`, `--palette`, `--parse`, `--json`, `--record`) |
| `node scripts/measure-typeset-idle.mjs` | on a generated 1 MB Markdown page in WebKit: the article's DOM mutations at rest and through a wheel scroll, and the longest frames, while it is being set and (`--done`) once every paragraph is set (`--mb`, `--settle`, `--json`) |
| `pnpm perf:interactions` (`scripts/measure-interactions.mjs`) | what the reader feels on a 195 KB and a 25 KB page, from this tree's source in headless Edge: open, a cursor key, the first click, undo after a small edit, a reload from disk, a tab switch and Source to Read, each as the browser's own task, script, layout and style time and layout and recalc counts, with the number of the article's top-level nodes an undo or reload took out and put in (`--runs`, `--keys`, `--docs`, `--doc <path>`, `--record`, `--compare`) |
| `node scripts/measure-startup.mjs` | cold (and warm) start to first text of the built binary, from its startup marks |
| `node scripts/measure-reload.mjs` | live reload of a large transcript: each stage from the watch event to the reader's place |
| `node scripts/measure-colour.mjs` | time to first coloured token and the longest main-thread hold when a large code file opens |
| `node scripts/measure-source-scroll.mjs` | the longest frame and the frames over 100 ms while a generated 9 MB file is scrolled in Source, in WebKit (`--mb`, `--steps`) |
| `node scripts/bundle-report.mjs` | what each chunk of the desktop build holds, by package or folder |
| `node scripts/probe-layout.mjs` | column, gutter and block geometry of every corpus document over widths, sizes and variants (writes to `results/probe-layout/`) |

### Interactions, before and after a change

Run `pnpm perf:interactions` when a change touches what a long page does on a key, a click, an edit, a
reload, a tab or a mode switch: the reading lookup, the margin notes, the verb bar, the typesetter's
hand-over, the reload path. About ten minutes on a quiet machine; stop other browser runs first.

```bash
pnpm perf:interactions --record work/shots/interactions-before.json     # on the tree before the change
pnpm perf:interactions --compare work/shots/interactions-before.json    # on the tree after: each number beside its old one
pnpm perf:interactions --compare a.json --against b.json             # two saved records, nothing run
```

It serves this tree's source over the memory shell and drives headless Edge, because Chromium reports what
the main thread did (`Performance.getMetrics`: task, script, layout and style-recalc time and their counts)
instead of a wall clock; Edge must be installed (`--browser chrome|chromium` for the others). Every number
is the median of `--runs` repetitions (three), after a warm-up pass that fills the dev server's cache.
Three documents are measured: `long-reference` (195 KB, 30 footnote definitions), `long-reference-plain` (the same
page with every definition line escaped, measured on open, undo and reload only) and `short-document` (25 KB). An
in-place update that numbers the notes differently rebuilds the page whole; otherwise both take the in-place path,
and the two side by side show what the notes cost it. `--doc <path>` measures any other file of the caller's, under its own name.

Compare counts before durations: `removedTop` and `addedTop` (top-level nodes of the article an undo or a
reload took out and put in: a page rebuilt whole shows both near the page's size, an in-place update of one
appended line shows none taken out and a couple put in), nodes, layouts and recalcs do not depend on the machine; durations do, and
moved by half again between a quiet and a busy machine with the same counts. The table leads each step
with its counts and ends with a legend of what each duration covers. `taskMs`, `scriptMs`, `layoutMs`,
`styleMs` run from the action until the main thread has been idle for about a second, so they include the
typesetting that follows and are larger than a time to show or a time to the last long task; a cursor key
is the 150 ms after each press; `shownMs` runs until the tab or mode is current and two frames have
painted. `longestTaskMs` sees only tasks of 50 ms or more, and `handlerMs` of a click only handlers of
16 ms or more (the browser reports no less). The record keeps the commit, whether the tree was dirty, and
the git trees of `apps`, `packages` and `fixtures`, so a baseline taken on another branch's commit still
names the app code it ran; the comparison warns when the documents, steps, runs, machine or record version
differ, or a tree was dirty. Launch time is not here: `measure-startup.mjs`
times the built binary. It is a measurement, never a gate: it exits non-zero only when a number it was asked
for could not be taken.
