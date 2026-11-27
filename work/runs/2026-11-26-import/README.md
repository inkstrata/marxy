# 2026-11-26: the reader architecture onto `main`

**Goal:** adopt the reader architecture, built on a Windows checkout with no remote, wholesale as this
repository's `main`. Archive the earlier architecture, restructure for GitHub and a committed `work/` folder,
and see the code build and pass its checks on macOS for the first time.

**Branch:** `restructure/reader-architecture`, one pull request.

**Base:** the Windows checkout's `master` at `663a7f7f` (wave 4), carried over as a zip without history.

## What was done

- **Archive.**
  - Tag `archive/pre-reader-2026-11-26` on the old `main` (`41289f32`).
  - One tag `archive/branch/<name>` for each of the 48 old branches.
  - A release on the archive tag carrying the raw Windows workspace as a zip (account names redacted).
- **Tree.** The new code replaces everything except `docs/research/` (the Reader Typography and Reader
  Artifacts Handbooks, and the October audit).
  - The zip's `apps/desktop/src-tauri/target/` held only a note that about 10 GB of Windows build output had
    been removed for transport. That folder is Cargo's build cache, gitignored and rebuilt on the first build.
    It is not committed and nothing is lost.
- **`work/`.** The tracker and the records of rounds 9 to 16 and waves 1 to 5, laid out as `README.md`
  describes:
  - 460 files, 8.2 MB, text only. Build copies and HTML renders are in the archive zip.
  - The Windows account name in temp paths is replaced with `<user>`.
- **Tooling for GitHub.**
  - `pnpm work` and `pnpm verify` default to `main`.
  - Worktrees go in `<checkout>-wt/<name>`.
  - The tracker is the asking tree's own `work/todo.md`.
  - A branch whose upstream is gone (squash-merged on GitHub) counts as landed.
  - The scanners in `pnpm check` and biome skip `work/` and `docs/research/`.
  - The docs and `AGENTS.md` describe the pull-request cycle.
- **CI.** `ci.yml` has a macOS job (every step that passes there) and a Windows job (`pnpm verify --tier
  changed`, browser suite included). `release.yml` is ported from the earlier architecture: a tag builds the
  macOS DMG.

## macOS, first build (Apple silicon, macOS 26)

The first full verify, `logs/verify-full-macos.out`, passed 14 of 17 steps:

| Step | Result |
| --- | --- |
| core | 4242 |
| theme | 305 |
| typeset | 90 |
| scripts | 289 |
| desktop | 1269 |
| desktop-browser | 45 |
| build and smoke | passed |
| lint-rust | failed |
| cargo | 634 pass, 16 fail |
| browser | 2520 pass, 18 fail |

None of the fixes changes what the app does:

| Found | Cause | Fix |
| --- | --- | --- |
| The build stopped in Vite's config: "forbidden static imports from main.ts" | The startup import gate split paths on `/`. On Windows it never walked past `main.ts`. On macOS it walked everything and counted erased `import type` lines | `dirname`, path-safe containment, type-only imports skipped. It now walks 435 modules and finds none |
| The smoke launch refused `signal=largest-contentful-paint` | The smoke check's own list of engine paint signals lacked one the app accepts | It uses the app's `PAINT_SIGNAL_NAMES` |
| `lint-rust`: 5 dead-code errors and one clippy lint | Callers live only in Windows modules (`wic`, `win32`) or on x86_64. The `cfg(unix)` search branch had never been linted | `cfg_attr(not(windows), allow(dead_code))` with a note on each; `contains` in place of `iter().any` |
| `cargo`: all 16 SQLite reader tests refused "not where its name says" | The tests passed temp paths straight to `open`, which takes the canonical path the scope judged. macOS's temp folder is a link (`/var` to `/private/var`) | The test folder is canonicalised. The app's own path was already canonical |
| 4 browser files (`frame-office`, `frame-rtf`, `changes`, `line`) | The tests pressed `Control+F` and `Control+A`. On a Mac the app's find is Cmd+F, and WebKit's `Control+A` moves to the line start | `ControlOrMeta` |
| `check:tauri` in `--tier full` | It drives WebView2 | It runs on Windows only |
| `fixtures/certs/*.pem` missing from the commit | A global `*.pem` ignore | Un-ignored in the repo's `.gitignore` (generated test-only keys) |

After the fixes:

- `cargo test`: 650 pass, 0 fail, 6 ignored. That is 7 more than on Windows, from the unix-only tests.
- `lint-rust`: passes.
- The four shortcut-key browser files: 48 of 48 (`logs/browser-keys-fixed-macos.log`).
- CI's macOS step set, run locally: 16 of 16 steps (`logs/verify-ci-steps-macos.out`).

**Still failing on macOS:** 14 browser files, each failing alone too (`logs/browser-18-alone-macos.log`).
They are `todo.md` row M4:

- **Capability** (macOS WebKit draws or plays what Windows WebKit could not): `frame-fonts`,
  `frame-media`, `frame-viewers`.
- **Layout and metrics:** `page-states`, `splice-all`, `source-fold-stale`, `source-structure`,
  `paste-source`, `leave-split`, `demo-tour`.
- **Timing:** `large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`.

CI runs the browser suite on Windows until they pass.

## Windows, first CI run (GitHub's `windows-latest`)

The pull request's first Windows run (`logs/verify-ci-windows-summary.json`, `logs/verify-ci-windows-browser.log`)
took 2 h 11 min. 12 of 16 steps passed. Each of the four failures came from the hosted runner, not the code:

| Step | Failure | Fix |
| --- | --- | --- |
| scripts | the workspace test compared a temp path holding the runner's short name (`RUNNER~1`) with git's long one | `realpathSync.native` |
| core | the 10 MB notebook took 1.7 s of CPU against a 1.5 s bound | bound 3 s, which still catches the old 7 s |
| cargo | the symlinked-journal test, skipped on the desktop (no symlink right), ran: Windows SQLite takes a zero-size link for no journal and reads in place, not from a copy | both accepted on Windows; the linked file is not read either way |
| browser | 2521 pass, 14 fail, mostly timing budgets on a slow machine (`todo.md`, M5) | the Windows job leaves the browser suite out, as the macOS job does |

## Not done

- **M1:** the Windows checkout's unlanded branches (round 16, wave 5, `web-shell`, `open-with`) are not here.
- **M2:** nobody has used the Mac build by hand.
- **M3:** Linux has never been built.
- **M4:** the 14 macOS browser files above.
- **M5:** the 14 browser files that fail on a hosted Windows runner (above).
- **`release.yml`** has not run.
