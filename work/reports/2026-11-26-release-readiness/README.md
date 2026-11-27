# Release readiness, 2026-11-26: the road to a first tag of the reader architecture

A read-only investigation of `main` at `b16c76b3` (the reader architecture, PR #773), by six investigators, each
owning one area, with this file as the plan that came out of it. The investigators' reports are beside it:

| Report | Area |
| --- | --- |
| [01-release-mechanics.md](01-release-mechanics.md) | versions, `release.yml`, CI health, release content |
| [02-macos-integration.md](02-macos-integration.md) | the installed bundle, opening files, menus and keys, window, saving on APFS; review of PR #774 |
| [03-macos-test-failures.md](03-macos-test-failures.md) | the browser test files that fail on macOS WebKit (M4), and `frame.test.mjs` (partial) |
| [04-feature-completeness.md](04-feature-completeness.md) | the docs' claims against the code; the everyday path; against v0.1.0 |
| [05-outstanding-work.md](05-outstanding-work.md) | every open item in `work/`, GitHub and the code, deduplicated; the unlanded Windows branches |
| [06-hands-on.md](06-hands-on.md) | 18 demo files and the everyday path in the browser build, headless WebKit |
| [07-macos-one-mb.md](07-macos-one-mb.md) | A 1 MB Markdown open on macOS, WebKit and Chrome (2026-11-27, after the report) |

## Bottom line

The app is close to tag quality. The investigators found no missing feature and no open correctness bug on `main`.
The documented features are built and tested, 18 kinds of file render in WebKit, and the Mac shell is more
finished than "nobody has used it" suggests: native menu with Edit, Cmd-aware keys, Apple Event opens, single
instance, an APFS-aware atomic save, a 23 MB arm64 bundle under its 30 MB budget. What stands between `main` and a tag
is **evidence and release mechanics**, plus one real Mac bug:

1. **CI on `main` was red on macOS**, every time. The cause was in the browser test harness, not the app, and the fix
   landed with #774 the same day; see "CI" below.
2. **Work exists on one disk.** Round 16 (hostile-input budgets, reviewed, 16/17) and wave 5, `web-shell` and
   `open-with` are only on the Windows machine (M1).
3. **Nobody has used the Mac build** (M2), and the release workflow has never run on this tree.
4. **The version says 0.1.0**, which the earlier architecture already shipped as a pre-release.
5. **A Dock Quit, logout or Apple-event quit skips the unsaved-changes prompt** on macOS (MAC-02): the one defect
   found that a reader could lose work to.
6. The release text tells Mac users to "right-click, Open", which no longer works on macOS 15 and later. There are no
   release notes, and the README has no install section.

Recommended: tag **v0.2.0** as a **pre-release**, macOS Apple silicon only, after round 16 lands. Leave wave 5,
`web-shell`, Linux and a Windows download for later.

## Verdict by area

| Area | State | Before the tag |
| --- | --- | --- |
| Release mechanics | `release.yml` should still work on this tree (every path it calls exists); it builds one ad-hoc signed aarch64 DMG and publishes a pre-release. Never run since v0.1.0; no `ci` gate; it publishes before its own checks | version bump, dry run by dispatch, release notes, a tag-matches-version check |
| CI | `ci` was red on `main` on 3 of 3 macOS runs (`frame.test.mjs`, first test); fixed by #774, whose macOS job passed. A zombie `nightly` workflow (deleted in #773) still fails daily | disable `nightly` |
| macOS integration | sound in the code; ad-hoc signed, not notarised; quits outside the menu skip the dirty prompt; claims Default for ~60 text and source extensions | MAC-02, file-association ranks, honest first-run text |
| Bugs | no open correctness bug recorded; two macOS test failures could hide a real defect (`leave-split` place loss, re-render mismatch after fold or paste) | settle those two |
| Features | complete against the docs; README lacks Install and Status; file associations miss PDFs, images and the other kinds the reader opens | README, decide the association set |
| Outstanding | 11 items missing from the tracker, now rows below; round 16 should land; wave 5 should not | M1, then round 16 |

## CI: why `main` was red on macOS

`apps/desktop/src/source/frame.test.mjs`, "the top bar says what the bytes are", timed out on every hosted macOS
run (at 30 s, then at 90 s after the wait was raised). It boots eight fresh WebKit pages in a loop against one Vite
dev server, which the test file starts cold on CI. Found while fixing it on PR #774's branch:

- **A cold Vite cache re-bundles mid-run.** Vite's dependency scan does not follow `new Worker(...)`, so the Shiki
  grammars the highlight worker imports are found only when a page first colours code. Vite then re-bundles and
  asks pages to reload, which the tests never do (HMR off). A page booting at that moment keeps importing stale
  bundle URLs and never mounts Source. Fixed by listing the worker in `optimizeDeps.entries`
  (`apps/desktop/vite.config.ts`). Measured with the cache cleared: eight boots log "new dependencies optimized …
  reloading" before the fix and nothing after. CI starts cold every time, and its slower runner lands the
  re-bundle mid-boot, so this is the CI failure.
- **Local "hangs" were the laptop asleep.** Runs on the Mac that overran their timeouts by minutes (here, and in
  03: 320 s in `frame-media`, `frame-viewers`, `frame-pdf`; 780 s in `frame.test.mjs`) line up with Maintenance
  Sleep and DarkWake in `pmset -g log`. Every process freezes, timers fire together on wake, and node:test reports
  durations longer than the wall time around them. MT-01's "Playwright calls hang past their timeout" should be
  read in that light. Run long local suites with the machine held awake (`caffeinate -i`) before calling a hang
  real.

## The plan

Each step lists its tracker rows (`todo.md`). The gates are the points where a step must be green before the next
starts.

### 1. Sync (now)

- **M1** on the Windows machine: push `budgets-4`, `budgets-5`, `teardown-2`, the round 16 integration, `geometry-table`,
  `near-typeset`, `web-shell` and `open-with` as `agent/<name>`. Push them all, even the ones that wait: they exist
  on one disk.
- **#774** (the macOS installer) landed on 2026-11-26 with the three fixes its review asked for (a failed swap restores
  the old bundle, a stop when `/Applications` holds a copy this user cannot replace, no kill of a running Marxy) and
  the CI fix.
- **R2**, owner: disable the zombie `nightly` workflow.

**Gate A:** `ci` green on `main`, twice in a row.

### 2. Land round 16

- Rebase round 16 (`budgets-4`, `budgets-5`, `teardown-2`; P11, P12, F24) onto `main`. The import has unrelated
  history, so this is a replay, not a clean rebase. Re-run the macOS step set and the browser files for the changed
  folders. Reviewed and differential-tested on Windows. It closes the hangs a hostile file or paste can cause, and
  the reader opens files from anywhere.

### 3. Mac fixes

- **R3**: a quit that is not the menu's (Dock, logout, `osascript`) goes through the unsaved-changes prompt.
- **R4**: file associations: "Source and text" at Alternate rank, a UTI for Markdown, and a decision on PDFs, images,
  archives and documents (with `open-with`'s extension list in view).
- **R10**, **R11**: decide whether `leave-split` (place 2021 to 0) and the fold or paste re-render mismatch are real
  on macOS. Each needs a settle wait and a run alone. A real one becomes a fix before the tag.

### 4. Release packaging

- **R5**: version 0.2.0 in `tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `apps/desktop/package.json`.
- **R6**: release notes and a README "Install a release" section. Cover: macOS 13 or later, Apple silicon only, not
  notarised (System Settings, Privacy and Security, Open Anyway, or `xattr -dr com.apple.quarantine`), what is new
  since v0.1.0, known limits (Linux never built, no Windows download), and that the close box quits.
- **R7**: `release.yml` checks the tag against the version, requires `ci` green on the tagged commit, and runs
  `codesign --verify` and `gate:bundle` before it publishes.
- **R8**: `LICENSE` and the third-party notices travel with the bundle.
- **R9**: a dry run by `workflow_dispatch` on the bump branch. Check the artifact for size, seal and notices, then
  install it from a download on a clean account.

**Gate B:** the dry-run DMG installs and launches from a download, following the release notes as written.

### 5. A person at the Mac (M2)

One session on the dry-run DMG, not a dev build, about 30 minutes:

1. Double-click a `.md` in Finder with Marxy closed; then `open -a Marxy other.md` and a drop on the Dock icon while
   it runs: same window, no blank flash.
2. Open With on a `.md` and a `.json`: Marxy listed; what Get Info names as the default.
3. The demo tour: Read and Source with the place kept, edit, undo, save, save as, find, the Outline, the Line, the
   Studio, a PDF, an archive, a spreadsheet, a SQLite file, an email.
4. Cmd+C, V, X, A, Z in a text field and in Source; Cmd+F; Cmd+W and the red button with a dirty document.
5. With an unsaved edit: Dock icon, Quit; Apple menu, Log Out (R3).
6. Light and dark appearance at launch: no black flash; the page follows System Settings (HO-01 saw dark under a
   light scheme in the browser build).
7. Full screen, quit, relaunch; a second display.
8. Save a file with a Finder tag (the tag survives); one in an iCloud-synced folder (no stall).
9. `cargo test -- --ignored pasteboard_live` in `apps/desktop/src-tauri` (**R12**): copy as HTML, RTF and text reach
   other apps.
10. Open a 1 MB Markdown file and time it (**R13**; about 78 s on Windows before wave 5).

Anything found becomes a row. A reader-visible defect blocks the tag.

### 6. Tag (the owner)

`git tag v0.2.0 <main sha> && git push origin v0.2.0`. `release.yml` builds and publishes the pre-release in about
7 minutes. Download it on a clean account and check it once more.

### After the tag

Wave 5 (E22, E23: performance; its integration is red with a possible place regression), `web-shell` (S17,
research), `open-with`'s Windows hooks, Linux (M3), the browser suite in macOS and Windows CI (M4, M5), Developer ID
signing and notarisation, the rows under "Later". Housekeeping on Eris: about 570 worktrees from the earlier
architecture (93 with uncommitted edits; every branch is tagged `archive/branch/<name>`), and 345 untracked files under
`orchestration/` in the main checkout. Archive a patch per dirty worktree before removing any, and never
`git clean` the main checkout.

## Decisions for the owner

| Decision | Recommendation | Why |
| --- | --- | --- |
| Version | v0.2.0 | v0.1.0 exists (earlier architecture); a whole new codebase, still pre-1.0 |
| Pre-release or release | pre-release | ad-hoc signed, no notarisation, one platform, first Mac use is this cycle |
| Round 16 before the tag | yes | reviewed, differential-tested, and closes hangs on hostile input |
| Wave 5 before the tag | no | red integration, a possible place regression, performance only |
| File associations | Markdown Default; text and source Alternate; add PDFs and images at Alternate | Marxy should be offered, not take over `.json` or `.html` |
| Signing | ad-hoc now; Developer ID later | notarisation needs an Apple developer account; until then the notes give the steps |

## Startup on macOS CI (2026-11-27)

The CI smoke launch (`apps/desktop/scripts/smoke-cli-open.mjs`) now launches the README fixture five times and prints
the median time from spawning the binary to the `first_text` stamp. On a hosted `macos-latest` runner (not a laptop):
**3285 ms median over 5 launches** (5996 for the first, then 3530, 3218, 3285, 3275). The same check on a hosted
`ubuntu-latest` runner under Xvfb: 484 ms median (1373, 456, 484, 473, 501). The Windows 774 ms median is from
`measure-startup.mjs` on a workstation and is not like for like; the runner's slow first launch and shared CPU make this
an upper bound for a laptop. No laptop number exists yet. Later runs print it in the build log (`smoke-cli-open startup:`),
on `main` pushes.
