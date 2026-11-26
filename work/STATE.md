# Marxy: where `main` stands

As of 2026-11-26, after the reader architecture was imported onto `main`. Rewritten by each landing run;
history is in `ledger.md` and the run folders. Paths are relative to `work/` unless they start with a
top-level folder of the repository.

## Bottom line

`main` holds the reader architecture at the state of the Windows checkout's `master` `663a7f7f`, wave 4. The
earlier architecture is archived at the tag `archive/pre-reader-2026-11-26`. On Windows that code passed a full
verify of 18 of 18 steps, the real-window check included. On 2026-11-26 it was built and verified on macOS for
the first time. That took fixes to checks and tests that had only ever run on Windows; the app code was not
changed. On macOS, 14 browser test files still fail (`todo.md`, M4).
Linux has never been built. Two runs never landed: round 16 and wave 5. Their branches exist only on the Windows
machine (`todo.md`, row M1).

## What the app does

A desktop reader for local files (`README.md` at the root and `docs/using-marxy.md` describe it fully):

- **Reading and editing.** Opens Markdown, text, code, data, logs, diffs, notebooks, mail, HTML, archives,
  PDFs, images, audio and video, fonts, spreadsheets, Word documents and decks, certificates, programs and
  SQLite. Each is shown as a typeset page, a tree, a table, a listing, a card of facts, a viewer or the bytes.
  Read and Source switch with the place kept. Every edit is a byte splice, and a save is an atomic replace.
- **Speed on long pages** (waves 1 to 4). The cursor key, first click, undo, redo, Source commit and reload
  replace only the changed blocks, footnoted and small pages included. The last three clean tabs stay warm.
  Content search uses up to 8 threads.
- **Hostile input.** Work budgets cover mail, RTF, JSON Lines, TOML, the Outline, punycode, gzip, ICC
  profiles and the sanitiser (rounds 14 and 15). Budgets for lines of text and for containers are round 16's
  work, which has not landed.
- **Lifecycle.** No unowned listeners (enforced by `pnpm check`). Shell subscriptions are disposed on
  teardown.

## Platforms

| Platform | Built | Verified | Run by a person |
| --- | --- | --- | --- |
| Windows (WebView2) | every run, rounds 9 to wave 5; an installer of round 9 (`ee56607d`) | full verify 18/18 at `663a7f7f`, with `check:tauri` driving the real window (117 cases) | rounds up to 6; nothing installed after round 9 has been tried (`todo.md`, W5 to W9) |
| macOS (WKWebView) | 2026-11-26, the release binary, on an Apple-silicon laptop | every verify step but the browser suite, 2026-11-26 (see Verification); no real-window check exists for macOS | not yet (`todo.md`, M2) |
| Linux (WebKitGTK) | never | `atomic_write.rs` alone was type-checked for x86_64 Linux in round 13 | never (`todo.md`, M3) |

Symlink cases skip on Windows without Developer Mode. On macOS they run.

## Verification

**Windows, `663a7f7f`** (`runs/2026-11-26-wave-04/logs/wave4-full-verify-2.log`), 18/18 steps: core 4241,
theme 305, typeset 90, scripts 289, desktop 1268, desktop-browser 44, browser 2536 with no failures (4
skipped), cargo 643 (6 skipped), build, `check:tauri` 117. A full run takes about 50 minutes.

**macOS, this import** (2026-11-26, Apple silicon, macOS 26). CI's macOS step set, run locally
(`runs/2026-11-26-import/logs/verify-ci-steps-macos.out`), passed 16 of 16 steps: core 4242, theme 305,
typeset 90, scripts 271 (289 with the slow probe at `--tier full`), desktop 1269, desktop-browser 45,
`check` 10/10, the gates, `lint-rust`, cargo 650 (6 skipped), and the release build with its smoke launch.
The browser suite is the exception: 14 of its files fail on macOS WebKit, each alone too (`todo.md`, M4).

Getting there took fixes to checks and tests that had only ever run on Windows. None of them changes what
the app does; `runs/2026-11-26-import/README.md` has the table.

- **The startup import gate never ran on Windows.** It walks `main.ts`'s static imports to keep grammars,
  KaTeX and CodeMirror out of the entry chunk. It found each module's folder by splitting on `/`. On Windows,
  with `\` paths, the walk stopped at `main.ts`. On macOS it walked the whole graph, and it counted erased
  `import type` lines as imports. It now uses `dirname`, path-safe containment and skips type-only imports. It
  walks 435 modules and finds no forbidden import
  (`apps/desktop/src/startup/static-import-graph.test.mjs`).
- **The smoke check's paint signals.** WKWebView may report `largest-contentful-paint` as the engine paint.
  The app already accepts that signal; the smoke check's own list did not. It now uses the app's list
  (`apps/desktop/scripts/smoke-cli-open.mjs`).
- **Rust lint off Windows.** Five items are used only by Windows modules or on x86_64; each now carries
  `cfg_attr(not(...), allow(dead_code))` with a note. The `cfg(unix)` search branch had one clippy lint.
- **SQLite reader tests.** They passed temp paths straight to `open`, which expects the canonical path the
  scope judged. macOS's temp folder is a link (`/var` to `/private/var`), so all 16 refused. The test
  helper canonicalises; the app's own path already did.
- **Shortcut keys in four browser files.** They pressed `Control+F` and `Control+A`; on a Mac find is Cmd+F.
  They press `ControlOrMeta` now.
- **`check:tauri` is Windows only.** It drives WebView2 over its debugging port, so `pnpm verify --tier full`
  now runs that step only on Windows.

CI (`.github/workflows/ci.yml`) has two jobs. **macOS** runs the 16 steps above at `--tier full`, with no
browser suite until M4 is done. **Windows** runs `pnpm verify --tier changed` against the base on a pull
request, browser suite included; it runs `quick` on a push to `main`, and any tier by hand. Neither job runs
`check:tauri`, so a person still runs it on a Windows desktop.

**Flaky under load** (passes when run alone): `split-narrow` (waves 2 to 4, round 9, round 16),
`source-looks`, `large-open-panel`, `progressive-large`, `no-displacement`, core's 10 MB notebook timing,
`startup/measure.test.ts`, `transform-sheet`, `tail-follow`. The rule the runs used: a red that passes alone
three times is load and is recorded; one that fails alone is real.

## Performance

On the 195 KB Markdown reference page with 30 footnotes, Windows, wave 3 `b0d9cb52` against wave 4
`663a7f7f` (`reports/2026-11-24-evaluation/marxy-wave4-landed.md`):

- **Reload:** 3.0 s to 0.48 s; blocks replaced fell from 2,465 to 31.
- **Tab back:** 598 ms to 349 ms.
- **Undo of 25 KB:** 229 ms to 87 ms.
- **Layouts on open:** 353, unchanged.

Durations were taken with other work running; the counts are firmer. Cold start was a median of 774 ms to
first text over 10 launches of `ee56607d` (`runs/2026-11-23-round-09/logs/measure-startup.log`). The
installed-size budgets are in `fixtures/perf-budgets.json` (25 MB Linux, 30 MB macOS, gated by
`gate:bundle`). Interaction times are measured but never gated.

## Open work

All of it is in `todo.md`.

- **Carry over:**
  - M1: push the Windows checkout's unlanded branches.
  - M2: use the app on macOS.
  - M3: build it on Linux.
  - M4: the 14 browser test files that fail on macOS.
- **Next:**
  - S17: web shell over the File System Access API. The spike and its report exist (`reports/2026-11-23-reach-beyond-desktop/`), but the branch is not here.
  - P11, P12: lines-of-text and container budgets. Built in round 16, which is not landed.
  - E22, E23: geometry table and near-reader typesetting. Built in wave 5; its integration is red.
  - F24: the rest of teardown.
- **To try in a real window:** W5 to W9 (Windows).
- **Later:** F5, F6, S9, S10, P4 to P7.

Not landed, with where they stand:

- **Round 16:** integration `1f141eb1`, verified 16/17, the three browser reds pass alone
  (`runs/2026-11-24-round-16/README.md`).
- **Wave 5:** integration `0a9eeb68`, full verify 17/18. Five browser tests fail alone: `live-reload`,
  three in `mode-swap` and one in `splice-all`. Treat them as real. Both of wave 5's reviewers missed an
  earlier `outline-rows` regression that the orchestrator caught (`runs/2026-11-26-wave-05/README.md`).
- **The waves plan:** the queue after wave 5 is in `reports/2026-11-24-waves-handoff/00-handoff.md`, with
  briefs 02 to 05 and the experiments X1 to X10. No experiment reports beyond those cited there exist.

## Risks and loose ends

- **Only Windows has had a person at the window.** On macOS the checks pass, but nobody has used the app
  there. On Linux nothing has run, so `cfg(unix)` paths, such as the save sweep's move-aside and unlink by
  name, have run only in unit tests on macOS.
- **The browser suite is load-sensitive.** A real regression can hide among the usual load reds; run
  suspects alone.
- **Warm store.** It is lost after a same-tab link and Back, and after a cross-file replace.
  `typeset-view`'s block-list patch applies in about half the cases and may be droppable
  (`reports/2026-11-24-evaluation/marxy-wave4-landed.md`).
- **Windows-only tooling.** `pnpm work installer`, `check:tauri` and `shots --exe` need Windows. macOS has
  the release build and its smoke check, and nothing that drives the real window.
- **Ids.** The tracker's ids (S, P, E, F, W, H, M) and the run names stay in `work/`. The earlier
  architecture's JIRA is defunct. Its `MARXY-<n>` keys survive only as text in a few parser fixtures
  (`fixtures/corpus/README.md`, `15-prose-volume.md`, `28-artifact-fences.md`) and their goldens, where
  changing them would change expected output for nothing. "Copy as Jira wiki" is a text format the app
  writes, not a link to that tracker.
