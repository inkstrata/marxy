# 04 Tests and gates: what runs, what it protects, what it costs

Date: 2026-10-01. Worktree `MARXY-346` at `4526b811` (origin/main). Every number below comes from a command in this document or from the scratch logs of the run; commands are in fenced blocks next to the numbers or in the appendix.

**Abstract.** Marxy has 198 test files (27,505 lines), 80 other check, gate, hook and workflow files (12,908 lines), 60 Rust `#[test]` functions, and a three-workflow CI. I ran every named check locally: 14 of 15 JavaScript-side commands passed, and the one red (`pnpm --filter @marxy/desktop test`) is a unit test that launches the real app binary if one has been built, so it fails on a machine that has built the app. Cargo tests passed. The checks are mostly genuine and well built: the byte-fidelity, no-network and licence gates run real code and prove they can fail. The cost is elsewhere. A code pull request costs about 22.7 runner-minutes and 12.4 minutes of wall time, and the pull-request path does the same work again on the squash commit. One job (`browser`, a serial WebKit suite plus the aesthetics gate) is 52 percent of the job-seconds and the whole critical path. About 60 tests of the typeset, theme and core packages never run in CI at all because they need a browser that no job gives them. The project's own CI documents are wrong about the numbers (they say 165 s and 277 s; measured 708 s and 743 s), a standing gate (`gate-protection`) fails against the live repository and is wired to nothing, and about 8 percent of all lines are checks whose subject is another check. The recommendation in section 6 cuts a typical product PR from 1,362 to about 480 job-seconds and from 743 to about 280 seconds of wall time without deleting any property the project says it protects.

## Findings in brief

| # | Finding | Evidence |
|---|---|---|
| 1 | All local checks pass except one environment-dependent desktop unit test | section 2 |
| 2 | Median successful code PR: 579 s per run; docs-only and orchestration-only: 171 s; 37 percent of all CI wall-clock in the window went to failed or cancelled runs | section 4 |
| 3 | The `browser` job (708 s median) is the critical path: the desktop WebKit suite is 407 to 478 s, run serially (`--test-concurrency=1`) | section 4 |
| 4 | 21 typeset, 38 theme and 5 core tests (WebKit) are skipped in `fast` and run in no other job | section 3 |
| 5 | Three-dot-diff tests silently skip in CI (shallow checkout) and run only on a developer machine | section 3 |
| 6 | Every merge runs the full pipeline a second time on the push to main (median 737 s for the six latest full runs) | section 4 |
| 7 | `docs/hygiene.md` and `docs/ci-contract.md` disagree with the code and with each other in six places | section 1.7 |
| 8 | `gate-protection --live` fails today (strict=false, allow_force_pushes=true) and nothing runs it | section 1.7 |
| 9 | Timing assertions still exist in six tests despite ADR-0032; three production files carry `process.env.MARXY_*_MUTATION` test hooks | section 3 |
| 10 | Meta-checks cost seconds, not minutes; their cost is lines and the number of files that must be edited together when CI changes | section 5 |
| 11 | `release.yml` has run three times, all failures, none on a tag; `gate:bundle`'s installer half has never executed | section 4 |
| 12 | 61 of the last 150 merged commits touch only orchestration code; 64 touch product code | section 4 |

## 1. Inventory

Legend for the category column: **RB** reader-facing behaviour, **BF** byte fidelity, **SP** security posture, **TY** typography, **BI** build integrity, **PC** process and conventions, **OR** the orchestrator, **SC** the checks themselves (selftests). One category per file, chosen by what a failure would tell you. Lines are `wc -l`.

```bash
find packages apps orchestration scripts -name '*.test.*' -not -path '*/node_modules/*' -not -path '*/target/*' | wc -l   # 198
find packages apps orchestration scripts -name '*.test.*' -not -path '*/node_modules/*' -not -path '*/target/*' | xargs wc -l | tail -1   # 27505
```

### 1.1 Totals

| Category | Test files | Test lines | Script/gate/CI files | Script lines | Total lines |
|---|---:|---:|---:|---:|---:|
| reader-facing behaviour (RB) | 66 | 7,813 | 10 | 2,739 | 10,552 |
| byte fidelity (BF) | 19 | 4,111 | 1 | 688 | 4,799 |
| security posture (SP) | 20 | 3,238 | 7 | 973 | 4,211 |
| typography (TY) | 20 | 2,591 | 16 | 3,055 | 5,646 |
| build integrity (BI) | 2 | 95 | 13 | 1,838 | 1,933 |
| process and conventions (PC) | 10 | 1,089 | 26 | 2,762 | 3,851 |
| the orchestrator (OR) | 38 | 6,104 | 1 | 129 | 6,233 |
| checks themselves (SC) | 23 | 2,464 | 6 | 724 | 3,188 |
| **Total** | **198** | **27,505** | **80** | **12,908** | **40,413** |

Not counted above: 6,674 lines of orchestrator implementation (`ls orchestration/*.mjs | grep -v '\.test\.mjs' | xargs wc -l`), the 60 Rust `#[test]` functions inside product source files (section 1.6), and data files (`scripts/allowlists/*.json` is 3,000 lines, 2,670 of them `crate-licences.json`). The orchestrator category (6,233 lines) is tests plus `loop.sh` only.

By JavaScript test runner count: 655 root tests (orchestration plus scripts), 763 core, 81 theme, 44 typeset, 304 desktop plus 19 in the mutation re-run, 1,866 in all, from the `ℹ tests` lines of `pnpm test`. Rust adds 51 that run on macOS.

### 1.2 `package.json` scripts

Root (30 scripts) and per package. "CI" says where CI calls it, directly or through another script.

| Script | What it does | CI |
|---|---|---|
| `build` | `pnpm -r build` (tsc per package, `tauri build` for desktop) | never (CI calls `build:web` and `cargo build` directly) |
| `test` | contracts-frozen, per-package tests, `node --test` over orchestration and scripts, gate-protection selftest, check-tokens | fast |
| `test:contracts-frozen` | inline 1.6 KB node script: byte-compares five contract files to a pinned git tree | fast (via `test`) |
| `lint` | font-attrs, `biome check .`, per-package biome plus theme lint, then `lint:biome-contract` | fast |
| `lint:biome-contract` | inline 2.1 KB node script: probes biome with temp files, greps `ci.yml` and package scripts | fast (via `lint`) |
| `gate:font-attrs` | `.gitattributes` keeps fonts binary | fast (via `lint`) |
| `typecheck` | `pnpm -r typecheck` | fast |
| `gate:licences` | licence audit of npm, crates, grammars | fast; gates twice per OS |
| `gate:fidelity` | byte-fidelity gate (core's `test:fidelity`) | fast |
| `gate:golden` | golden AST/HTML (core's `test:golden`) | fast |
| `gate:no-network` | no-network and sanitiser sweep, two engines | browser |
| `gate:aesthetics` | mechanical aesthetics matrix in WebKit | browser; nightly with `--repeat 3` |
| `gate:perf` | records perf numbers, fails on missing record | gates |
| `gate:bundle` | JS must not reach memory shell; installer size on release | gates; release |
| `gate:specimen` | specimen verifier | gates |
| `lint:commits` | commitlint over the branch | never (CI runs `pnpm exec commitlint` itself) |
| `prepare` | sets `core.hooksPath` | install |
| `check:boundaries`, `check:registry`, `check:deps`, `check:workflows`, `check:deferrals` | hygiene checks | fast (one step) |
| `check:one-parse` | one parser, one sanitiser | not by name; `check-one-parse.test.mjs:73` spawns it in `pnpm test` |
| `check:story`, `check:pr` | story boundary, PR body | conventions (called as `node`, not by script name) |
| `lint:theme`, `lint:rust` | theme CSS lint; `cargo fmt --check` and clippy | theme via `lint`; rust on Ubuntu `gates` |
| `precheck`, `done`, `new` | local workflow commands | never |
| core: `typecheck`, `lint`, `test` (`src/**/*.test.ts`), `test:golden`, `test:fidelity`, `test:spec` | CommonMark spec suite | fast; `test:spec` fast |
| shell-api: `test` is `echo 'types only'` | placeholder | fast |
| theme: `test` (lint-default-theme plus `src/**` and `test/**` tests) | | fast; WebKit tests skip |
| typeset: `test` (`src/**/*.test.ts`, `test/**/*.test.mjs`) | | fast; WebKit tests skip |
| desktop: `test`, `verify:cli`, `build`, `bundle`, `build:web`, `dev`, `tauri` | `test` is serial `node --test` plus the mutation re-run (section 3); `verify:cli` is the CLI smoke | `test` in fast and browser; `verify:cli` and `build:web` in gates; `build`, `bundle`, `dev` never |

### 1.3 CI workflows and hooks

`ci.yml` (309 lines) on pull_request, merge_group and push to main; seconds are from the most recent successful PR run (36967075472, branch `feat/MARXY-235-...`), job medians from 14 recent successful PR runs (section 4).

| Job | Runs when | Steps and seconds | Job median |
|---|---|---|---:|
| `changes` | always | checkout (full history), classify diff, cache restore, resolve, `ci-changes --selftest` (all under 1 s) | 9 s |
| `conventions` | PR only | mise 4, install 5, commitlint over commits 1, PR title 2, `check-pr` 1, `check-story --strict` 1 | 23 s |
| `fast` | not docs-only | install 5; five hygiene checks 7; typecheck 8; lint 7; **test 111**; CommonMark selftest and suite 3; golden 2; fidelity 3; licences 1 | 159 s |
| `browser` | `web` changed | container init 34; mise 17; install 6; no-network 34; **aesthetics 157**; linker 9; **desktop suite 407** | 708 s |
| `gates` (Ubuntu) | gates hash changed | apt 33; rust-cache 29; install 7; specimen 2; licences 1; fmt and clippy 44; web build 6; **cargo build 73**; CLI smoke 19; startup measure 31; perf selftests, parse, perf gate 3; Rust tests 16; bundle 1 | 212 s |
| `gates` (macOS) | gates hash changed | rust-cache 17; install 8; specimen 4; web build 9; **cargo build 102**; smoke 18; startup measure 50; perf 4; Rust tests 19; bundle 2 | 243 s |
| `gates-skip` | gates hash unchanged | echo, two matrix entries | 2 s |
| `gates-record` | after real gates success | writes a cache key | 4 s |
| `ci` | always | summary of needs | 4 s |

`nightly.yml` (77 lines, daily 04:00 UTC and manual): `aesthetics-determinism` (`gate-aesthetics --repeat 3`) and `built-app-smoke` (release build, `cargo install tauri-driver`, `smoke-built-app.mjs` under xvfb). `release.yml` (52 lines, tags `v*`): `tauri-action` on macOS and Ubuntu, then `gate:bundle` with `MARXY_BUNDLE_REQUIRED=1`.

Hooks: `.githooks/pre-commit` (6 lines) runs `check-story --staged` and `check-registry --staged`; `.githooks/commit-msg` (32 lines) strips attribution trailers then runs commitlint. Measured: `check-story --staged` 0.07 s, commitlint on one message 0.71 s. `MARXY_SKIP_HOOKS=1` bypasses both.

### 1.4 Check, gate, hook and workflow files

| Path | Lines | Cat | What it checks | Where it runs |
|---|---:|:-:|---|---|
| `scripts/check-boundaries.mjs` | 67 | BI | Import rules: core has no DOM or Node, @tauri-apps only under src/shell, shell-api imports nothing, no raw invoke( | fast; precheck always |
| `scripts/check-cards.mjs` | 171 | PC | Task cards, board CSV rows and deps.json agree | precheck only (not in CI) |
| `scripts/check-commonplace.mjs` | 149 | PC | Every bundled Commonplace passage is sourced, rights-cleared by its dates, with a colophon | via its test in pnpm test; CLI unwired |
| `scripts/check-csp.mjs` | 124 | SP | Parses the shipped CSP; refuses runtime <style> creation | CLI unwired; two desktop tests import it |
| `scripts/check-deferrals.mjs` | 141 | PC | A deferral marker in product source must name an unlanded story | fast; precheck |
| `scripts/check-deps.mjs` | 42 | BI | Every npm/cargo dependency is allow-listed and pinned; none forbidden | fast; precheck always |
| `scripts/check-one-parse.mjs` | 112 | BI | No markdown-it or DOMPurify; renders go through @marxy/core | precheck always; run by its own test |
| `scripts/check-pr.mjs` | 150 | PC | PR body order, sections, changelog fragment, attribution line | conventions; done; open-pr |
| `scripts/check-registry.mjs` | 108 | SP | Names come from registry.json; every route from string to parsed markup is allow-listed | fast; pre-commit; precheck |
| `scripts/check-story.mjs` | 51 | PC | Files inside the story paths; frozen files; secrets; build artefacts; attribution | conventions (--strict); pre-commit; done |
| `scripts/check-tokens.mjs` | 135 | TY | Theme token names, unit kinds and comments match tokens.contract.json (values free) | root pnpm test |
| `scripts/check-workflows.mjs` | 155 | SC | Third-party Actions allow-listed and pinned; every cargo/tauri build --locked; nightly smoke wired | fast |
| `scripts/gate-aesthetics.mjs` | 1124 | TY | Mechanical aesthetics checks over 18 corpus files x 12 width/size/variant combos in WebKit | browser; nightly (--repeat 3) |
| `scripts/gate-bundle.mjs` | 193 | BI | Production JS must not reach the memory shell; installer size and katex (release only) | gates; release |
| `scripts/gate-fidelity.mjs` | 688 | BF | Compiles atomic_write.rs with rustc, saves the corpus, compares bytes; seeded broken savers must fail | fast |
| `scripts/gate-font-attrs.mjs` | 38 | BI | .gitattributes keeps font binaries binary, no eol rewriting | pnpm lint |
| `scripts/gate-licences.mjs` | 832 | BI | Licence of every npm package, crate, grammar and hyphenation pattern; copyleft fails | fast; gates x2 per OS |
| `scripts/gate-no-network.mjs` | 396 | SP | Corpus and 33 vectors through parse, render, sanitise in two engines; nothing leaves the machine | browser |
| `scripts/gate-perf.mjs` | 798 | RB | Records startup/parse numbers; fails only if the record is missing or dishonest (ADR-0032) | gates |
| `scripts/gate-protection.mjs` | 347 | PC | Branch-protection and merge settings on main (live mode reads GitHub) | selftest in pnpm test; live never run |
| `scripts/ci-changes.mjs` | 303 | SC | Classifies the diff into docs_only/web/rust/gates; decides whether gates can be skipped | changes |
| `scripts/ci-summary.mjs` | 7 | PC | Writes startup numbers to the job summary | gates |
| `scripts/changelog.mjs` | 115 | PC | Folds changelog.d fragments into CHANGELOG.md at release | manual |
| `scripts/done.mjs` | 234 | PC | Definition-of-done wrapper: precheck, boundary, drafts PR body and result file | manual |
| `scripts/open-pr.mjs` | 112 | PC | Opens a PR only if the body passes check-pr | manual |
| `scripts/new.mjs` | 27 | PC | Generators for modules, operations and commands | manual |
| `scripts/plan-export.mjs` | 18 | PC | Prints the plan as CSV | manual |
| `scripts/taste-queue.mjs` | 43 | PC | Folds taste-queue fragments into queue.md | manual |
| `scripts/precheck.mjs` | 31 | PC | Runs typecheck/lint/test for touched packages plus the gates mapped by path | manual |
| `scripts/measure-parse.mjs` | 255 | RB | Times the parse of the 01-long-technical fixture | gates |
| `scripts/measure-startup.mjs` | 511 | RB | Nine launches of the built app, cold then warm | gates (both OS) |
| `scripts/smoke-built-app.mjs` | 321 | RB | Drives a release binary through tauri-driver: open CRLF file, toggle a task, compare disk bytes | nightly |
| `scripts/playwright-webkit.mjs` | 14 | BI | Shared headless WebKit launcher | imported by tests and gates |
| `scripts/gates-by-path.json` | 17 | PC | Path prefix to gate map for precheck | data |
| `scripts/registry.json` | 89 | SP | The name registry and innerHtmlAllowedIn list | data |
| `scripts/lib/changelog.mjs` | 85 | PC | Changelog fragment reader | helper |
| `scripts/lib/imports.mjs` | 96 | SC | AST import reader shared by boundary, bundle and registry gates | helper |
| `scripts/lib/own-row.mjs` | 118 | PC | A branch may edit only its own board row | helper |
| `scripts/lib/plan.mjs` | 170 | PC | Plan CSV reader/writer | helper |
| `scripts/lib/repo.mjs` | 114 | PC | Shared git/story helpers | helper |
| `scripts/lib/taste-queue.mjs` | 65 | PC | Taste-queue fragment format | helper |
| `scripts/specimen/parse-theme.mjs` | 63 | TY | Reads theme colours for the specimen | helper |
| `scripts/specimen/render.mjs` | 131 | TY | Renders the specimen pages | helper |
| `scripts/specimen/specimen.mjs` | 136 | TY | Specimen definition | helper |
| `scripts/specimen/verify.mjs` | 169 | TY | Gate: 40 PNGs at the type scale, 68ch, same anchors both pairs, no network | gates (both OS) |
| `packages/core/scripts/commonmark-spec.ts` | 242 | RB | CommonMark spec suite runner; --selftest checks its own CI wiring | fast |
| `packages/core/scripts/golden.ts` | 110 | RB | Golden AST+HTML files over 23 corpus fixtures | fast; precheck |
| `packages/core/scripts/gate-assertions.ts` | 24 | SC | Names every assertion inside the no-network gate | imported by gate-no-network |
| `packages/core/scripts/gate-checks.ts` | 119 | SP | Allow-list and containment checks the no-network gate runs | imported by gate-no-network |
| `packages/core/scripts/gate-observability.ts` | 53 | SC | Report of request classes the no-network gate cannot see | imported by gate-no-network |
| `packages/core/scripts/gate-tree-depth.mjs` | 93 | SC | Runner: sanitiser tree-depth mutants must fail | run by gate-assertions test |
| `packages/core/scripts/gate-tree-depth.ts` | 85 | SP | Tree-depth case checks | helper |
| `packages/core/scripts/tree-depth-cases.ts` | 52 | SP | Pinned tree-depth case list | data |
| `packages/theme/scripts/lint-default-theme.mjs` | 23 | TY | Default theme: headings set no colour/border; paddings are bare px | theme lint and test |
| `packages/theme/scripts/inline.mjs` | 15 | TY | Inlines default theme CSS | helper |
| `packages/typeset/scripts/font-metrics.mjs` | 127 | TY | Font metrics for typesetting | tool |
| `packages/typeset/scripts/hang-shots.mjs` | 29 | TY | Screenshots of hanging punctuation | tool (unreferenced) |
| `packages/typeset/scripts/measure-rag.mjs` | 428 | TY | Rag measurement experiments | tool |
| `packages/typeset/scripts/measure-rendered.mjs` | 116 | TY | Rendered rag measurement | imported by gate-aesthetics |
| `packages/typeset/scripts/rag-model.mjs` | 272 | TY | Rag metrics model | imported by gate-aesthetics |
| `apps/desktop/scripts/smoke-cli-open.mjs` | 287 | RB | Launches the built binary: paints, first_text, hidden/empty/unreadable cases | gates (verify:cli); desktop build |
| `apps/desktop/scripts/smoke-verdict.mjs` | 127 | RB | Decides pass/skip/fail for the smoke given frameless machines | imported by smoke |
| `apps/desktop/src/shell/marxy33-gate.mjs` | 33 | BI | Vite-start-time font manifest gate | vite |
| `commitlint.config.mjs` | 188 | PC | Commit/PR-title rules: type, scope, key in subject, body rules | conventions; commit-msg hook |
| `fixtures/corpus/check-prose-volume.mjs` | 63 | RB | Volume and shape of the prose corpus | unwired |
| `docs/research/reader-artifacts/tools/check.mjs` | 204 | PC | Coverage-ledger consistency for the artifacts handbook | unwired |
| `docs/research/reader-artifacts/tools/coverage.mjs` | 69 | PC | Coverage report | unwired |
| `docs/research/reader-artifacts/tools/build-ledger.mjs` | 98 | PC | Builds the ledger | unwired |
| `docs/taste-review/2026-09-marxy-130/check-format-samples.mjs` | 143 | TY | Taste-review kit check | unwired, dated path |
| `docs/taste-review/review-1/check-review-1.mjs` | 68 | TY | Taste-review kit check | unwired |
| `docs/taste-review/review-2/check-review-2.mjs` | 76 | TY | Taste-review kit check | unwired |
| `scripts/allowlists/gate-code-block-layout.mjs` | 25 | RB | Code block layout probe used by highlight test | imported by test |
| `scripts/allowlists/gate-highlight-bundle.mjs` | 35 | BI | Highlight bundle size probe used by highlight test | imported by test |
| `scripts/allowlists/generate-highlight-languages.mjs` | 34 | BI | Generates the grammar allow-list | manual |
| `.githooks/commit-msg` | 32 | PC | Strips attribution trailers, then commitlint on the one message | local |
| `.githooks/pre-commit` | 6 | PC | check-story --staged, check-registry --staged | local |
| `.github/workflows/ci.yml` | 309 | BI | Pull-request and main pipeline (see 1.3) | CI |
| `.github/workflows/nightly.yml` | 77 | BI | Aesthetics --repeat 3; built-app smoke through tauri-driver | daily 04:00 UTC |
| `.github/workflows/release.yml` | 52 | BI | tauri-action bundles on tag v*, then gate:bundle with installers | tag only; never run on a tag |
| `orchestration/loop.sh` | 129 | OR | The fleet loop (tested by loop.test.mjs) | manual |

### 1.5 Test files

**`apps/desktop/scripts/`** (1 files, 176 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| smoke-verdict.test.mjs | 176 | SC | Smoke verdict: frameless skip, CI requiredness; launches the real binary if one exists (flaky locally) |

**`apps/desktop/src/menu/`** (1 files, 58 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| menu-commands.test.ts | 58 | RB | Menu items replay the chord the palette and view toggle already… |

**`apps/desktop/src/palette/`** (6 files, 543 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| keys.test.ts | 71 | RB | Back and forward keys walk the session history |
| palette.test.ts | 65 | RB | Palette phases, Tab sections, and the operations stub |
| search-perf.test.ts | 102 | RB | Keystroke to results p95 stays under 16 ms on a 20k index |
| search.test.ts | 165 | RB | Fuzzy covers path, title and headings; a heading hit jumps to its… |
| session.test.ts | 82 | RB | Empty query is MRU newest first with pinned on top; history walks… |
| view.test.ts | 58 | RB | palette is a summoned dialog. No tab bar exists in the DOM |

**`apps/desktop/src/source/`** (5 files, 251 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| buffer-commit.test.mjs | 58 | RB | Source leave / fromText / CRLF preservation |
| default-mode.test.mjs | 22 | RB | Per-file-type default mode |
| mode-switch.test.mjs | 33 | RB | Byte ↔ UTF-16 position mapping |
| source-browser.test.mjs | 121 | RB | CodeMirror Source mode in WebKit: scroll budget, round-trip, undo |
| startup-deferral.test.mjs | 17 | BI | CM6 must not appear on the production startup import graph |

**`apps/desktop/src/startup/`** (1 files, 78 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| static-import-graph.test.mjs | 78 | BI | static import walk from main.ts — the entry chunk must not pull… |

**`apps/desktop/src/trust/`** (1 files, 117 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| trust.test.ts | 117 | SP | trust.json store: LRU, host normalisation, corrupt quarantine |

**`apps/desktop/test/`** (43 files, 8,246 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| app-harness.test.mjs | 97 | RB | startApp against the in-memory shell in WebKit |
| close-guard.test.mjs | 207 | BF | Close guard with unsaved edits, end to end in WebKit |
| data-loss.test.mjs | 239 | BF | Rendered/Source round-trip and operations never lose bytes |
| explicit-save.test.mjs | 202 | BF | Explicit save uses the app's own baseline, not the harness shortcut |
| fonts.test.mjs | 88 | TY | bundled faces in the built page: both families load from the app… |
| frontispiece-boot.test.mjs | 393 | RB | Launch with no document shows a Commonplace piece (real app, WebKit) |
| frontispiece.test.mjs | 115 | RB | Which Commonplace piece a no-document launch shows |
| highlight.test.mjs | 135 | TY | Code highlighting post-pass and theme mapping |
| images.test.mjs | 301 | SP | Local images, asset scope, notices and layout shift |
| invisibles.test.mjs | 223 | SP | Invisible-character markers in WebKit: bidi isolation and contrast |
| jump-to-source.test.mjs | 87 | RB | Palette jump-to-source lands on the selected element byte |
| layout-shift-window.test.mjs | 173 | SC | the headless font/image window waits, the gate repeat flag, and… |
| link-host.test.mjs | 98 | SP | Link host labels: destination on focus only, chrome at rest |
| links.test.mjs | 131 | RB | In-document, relative and external links in Rendered mode |
| live-reload.test.mjs | 274 | RB | Live reload through startApp and the memory shell |
| math-limits.test.mjs | 71 | SP | KaTeX in WebKit: a hostile formula stays contained |
| offset.test.mjs | 20 | TY | weight-offset table: applied on Linux only, by WebKitGTK version |
| open-path.test.mjs | 206 | RB | One way a document reaches the page: startApp + the memory shell… |
| operations-copy.test.mjs | 211 | RB | Copy operations: Mod+C, palette, and clipboard shape |
| operations-edit.test.mjs | 346 | BF | Rendered-mode edits: task toggle, table align, undo, dirty state |
| paint-signal.test.mjs | 132 | SC | Named checks for: first_text rests on an engine paint signal, not… |
| palette-index.test.mjs | 151 | RB | Palette index from idle loadIndex + memory readDir: heading… |
| palette-input-guards.test.mjs | 172 | RB | History keys leave editors alone; palette open flag |
| palette.test.mjs | 356 | RB | Palette view: real document mount, ADR-0011 tab-bar assertion,… |
| persist-reading.test.mjs | 369 | RB | Reading position, palette history, and config theme survive… |
| post-passes.test.mjs | 95 | RB | Node map and block list post-passes in a real page |
| release-csp.test.mjs | 171 | SP | Built renderer under the release CSP: palette, KaTeX, hyphenation, theme |
| round3-desktop.test.mjs | 324 | RB | Round-three desktop defects, each reproduced in WebKit |
| save-close-r5.test.mjs | 240 | BF | Save/close defects round five: unsaved edits vs same-path open, rename |
| save-trust-r4.test.mjs | 358 | BF | Save and trust defects after explicit save and trust grants |
| save.test.mjs | 183 | BF | Explicit save: byte-faithful writes, title dirty dot, watch echo |
| selection.test.mjs | 302 | RB | Rendered selection: corpus resolve property, clicks, keys,… |
| shell-boundary.test.mjs | 152 | SP | Proves the shell-api boundary: Tauri invoke() and @tauri-apps… |
| single-instance.test.mjs | 264 | RB | Single-instance routing: second launch, Finder open, and Dock… |
| source-gutter.test.mjs | 124 | RB | Source gutter: line numbers, copy fidelity, folding, special… |
| source-mode-shell.test.mjs | 223 | RB | Source mode mounted from the real app shell: defaults, Mod+E,… |
| tab-width.test.mjs | 102 | RB | Source tab width from `.editorconfig` under the indexed root |
| tauri-stale-write.test.mjs | 42 | BF | stale-write guard must survive the app's own live-reload look at… |
| theme-config-paths.test.mjs | 39 | RB | Theme directory paths in config.toml: `~` expansion per config… |
| trust.test.mjs | 306 | SP | Per-document trust grants, blocked-content notices and truncation |
| typeset-defaults.test.mjs | 199 | TY | Typeset defaults in the app readers open: hyphenation and… |
| user-theme.test.mjs | 208 | RB | User theme in the real app harness |
| variant-render.test.mjs | 117 | RB | config.variant light and auto resolve through the headless render… |

**`orchestration/`** (38 files, 5,875 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| adopt.test.mjs | 108 | OR | cycle adopts open pull requests the board does not know are in… |
| approve.test.mjs | 108 | OR | Whether an approval survives a merge of main, checked in a real… |
| canvases.test.mjs | 44 | OR | Canvas rendering of fleet state |
| codeowners.test.mjs | 97 | OR | CODEOWNERS parsing and the approval rule the merge bar relies on |
| cycle-boundary.test.mjs | 38 | OR | settleFromMain and dispatch ordering: merged-on-main keys before… |
| cycle.test.mjs | 577 | OR | The reconcile cycle against a fake world, one test per old stall |
| docs.test.mjs | 91 | SC | Fleet docs, prompts and README cannot drift from the code |
| doctor.test.mjs | 101 | OR | 2026-09-27 bug reports: every one of these was filed as a failure |
| done.test.mjs | 312 | OR | handshake is one table: `pnpm done KEY` copies it into the result… |
| fleet.test.mjs | 357 | OR | fleet's command line against a temporary store and a fake `gh`… |
| github.test.mjs | 39 | OR | One read of GitHub per cycle |
| hardening.test.mjs | 79 | OR | Batch of small orchestration defect regressions (torn log line, etc.) |
| lease.test.mjs | 121 | OR | Leases, detached spawns and the cycle lock |
| lib.test.mjs | 185 | OR | Every role in every mode (model config table) |
| loop.test.mjs | 152 | OR | loop.sh stopped between cycles leaves nothing running behind it |
| machine.test.mjs | 199 | SC | Every non-final story status has an owner and a way out |
| merge-bar.test.mjs | 514 | OR | The nine-clause merge bar; some cases read the live git diff |
| mirror.test.mjs | 28 | OR | When the Jira mirror pushes: on change, on failure, and at least… |
| needs-human.test.mjs | 36 | OR | committed human queue must not re-open work that already landed |
| observe.test.mjs | 107 | OR | observeWorktrees against a real repository: what git says is what… |
| out-of-plan.test.mjs | 78 | OR | Out-of-plan work carries its own row |
| outcomes.test.mjs | 66 | OR | Run outcomes are defined once in outcomes.mjs |
| overlap.test.mjs | 48 | OR | overlap() must understand globs and stop treating a shared string… |
| phases.test.mjs | 107 | OR | ops lane and the phase rules the committed board must keep |
| planner-trigger.test.mjs | 161 | OR | Fixture-driven checks for plannerReasons: which signals fire, and… |
| pr-body.test.mjs | 153 | OR | check-pr and open-pr can fail: bad template, attribution line |
| pr-mark.test.mjs | 39 | OR | PR title mark parsing |
| proc.test.mjs | 71 | OR | Every subprocess is bounded, and long ones die as a whole group |
| prompt-handshake.test.mjs | 51 | OR | reviewer and implementor prompts must name the same approval… |
| readiness.test.mjs | 251 | OR | Readiness table over a fixture board |
| ready.test.mjs | 264 | OR | in_review occupies listed paths; blocked, escalate and done do not |
| report.test.mjs | 75 | OR | report says who owns every story in flight, lists what a person… |
| revert.test.mjs | 261 | OR | Revert first: finding the first red commit, opening its revert,… |
| runs.test.mjs | 277 | OR | What a finished run means for its story Every outcome lands… |
| simulate.test.mjs | 136 | OR | Seeded random outcome sequences through finishRun must never… |
| taste-decisions.test.mjs | 20 | OR | 2026-09-19 taste pass is on disk: pair A, 68 ch, ADR-0015 accepted |
| worker.test.mjs | 152 | OR | worker run always ends, and always says how |
| worktrees.test.mjs | 372 | OR | prunePlan, removeArgs, and worktree removal argv |

**`orchestration/test/`** (2 files, 519 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| ready-review.test.mjs | 328 | OR | ready.mjs, review.mjs and pathsOf over fixture boards |
| review-order.test.mjs | 191 | OR | Review-order computer over fixture boards |

**`packages/core/scripts/`** (3 files, 358 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| gate-assertions.test.ts | 159 | SC | Deleting any assertion in the no-network gate fails a named test |
| gate-tree-depth.test.ts | 123 | SC | Sanitiser tree-depth: case list pinned, mutant must fail |
| unobservable-classes.test.ts | 76 | SC | No-network gate names every request class it cannot see |

**`packages/core/src/buffer/`** (3 files, 495 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| buffer.test.ts | 309 | BF | Buffer splice/undo; includes a branch-diff guard on gate-fidelity.mjs |
| history.test.ts | 112 | BF | History depth, redo-branch drop, and byte-identical undo |
| splice.property.test.ts | 74 | BF | Splice changes exactly its range: identity on a node's own bytes,… |

**`packages/core/src/contracts/`** (1 files, 8 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| contracts.test.ts | 8 | RB | Contract file hash pin |

**`packages/core/src/highlight/`** (1 files, 153 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| highlight.test.ts | 153 | RB | Acceptance checks for parse-time Shiki highlighting over the… |

**`packages/core/src/index-model/`** (13 files, 711 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| build-perf.test.ts | 44 | RB | 20k-file tree indexes correctly: every file found, node_modules… |
| ceiling.test.ts | 48 | RB | Index ceiling notice |
| deny.test.ts | 38 | RB | node_modules (and the rest of the deny list) are never indexed,… |
| entry.test.ts | 177 | RB | Title is the first h1, otherwise the filename. Headings carry… |
| ignore.test.ts | 69 | RB | Ignore rules: gitignore syntax, plus a deny list that a `!`… |
| location.test.ts | 32 | RB | model lives at index-model, never src/index, so a path-boundary… |
| node-reader.test.ts | 53 | RB | Node `DirectoryReader` for tests. Lives in a `.test.ts` so… |
| paths.test.ts | 45 | RB | Regression tests for slash-normalised path helpers (index model,… |
| persist.test.ts | 59 | RB | Persisted snapshots are reused only when every entry's mtime and… |
| root.test.ts | 50 | RB | Root detection matches ADR-0012: enclosing repository, else the… |
| schedule.test.ts | 28 | RB | Indexing must not precede first paint, and the ceiling notice is… |
| walk.test.ts | 39 | RB | Walk honours root `.gitignore` / `.ignore` and never follows a… |
| walker.test.ts | 29 | RB | Compiles the Tauri walker with bare rustc and runs it |

**`packages/core/src/operations/`** (2 files, 627 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| align-table-pipes.test.ts | 49 | BF | align-table-pipes: byte fidelity outside the aligned cells… |
| operations.test.ts | 578 | BF | Every operation: table cases, undo, byte-identical outside the range |

**`packages/core/src/outline/`** (1 files, 341 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| outline.test.ts | 341 | RB | Outline = heading list with byte offsets; branch-diff guard for outline stories |

**`packages/core/src/parse/`** (4 files, 796 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| bom.test.ts | 28 | BF | a document that starts with more than one byte-order mark keeps… |
| conformance.test.ts | 137 | BF | Conformance: our AST, rendered to HTML, must equal the reference… |
| dependencies.test.ts | 94 | BF | Keeps the package's runtime surface honest: production code must… |
| parse.test.ts | 537 | BF | Byte provenance invariants over the corpus; UTF-16 to byte conversion |

**`packages/core/src/position/`** (8 files, 626 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| blocks.test.ts | 63 | RB | Reading-line block math: compute and restore are inverses at… |
| persist.test.ts | 103 | RB | positions.json persistence: reopen, debounce, corrupt quarantine |
| position.test.ts | 112 | RB | Position is a source-map coordinate across reload; stale bytes… |
| reload.test.ts | 92 | RB | Live-reload of 01-long-technical.md must stay under the 100 ms… |
| shell-check.test.ts | 17 | RB | desktop shell must use the same stale-save check:… |
| storage.test.ts | 84 | RB | positions.json: LRU cap, newer version is read-only, corrupt… |
| watch-rust.test.ts | 41 | RB | Compiles the Rust watcher with bare rustc and runs its cases |
| watch.test.ts | 114 | RB | four write shapes watching must see while a document is open |

**`packages/core/src/render/`** (14 files, 1,556 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| alerts.test.ts | 50 | RB | GitHub alert blockquotes: run-in label, no marker text, no… |
| boundary.test.ts | 99 | SP | Keeps the boundary where it is: the unsanitised render has… |
| contract.test.ts | 110 | RB | DOM contract of docs/design/02-render.md, as far as provenance… |
| copy-invisibles.test.ts | 33 | RB | Copy operations keep invisible bytes and omit display markers |
| frontmatter.test.ts | 103 | RB | Front matter renders as a quiet key/value head with provenance… |
| heading-ids.test.ts | 36 | RB | Heading ids match github-slugger with duplicate suffixes;… |
| images.test.ts | 272 | SP | resolve a local image against the image root and report blocked… |
| invisibles.test.ts | 79 | SP | Rule table for invisible-character markers |
| link-host.test.ts | 77 | SP | Host mismatch labels on links |
| math.acceptance.test.ts | 264 | RB | acceptance: KaTeX deferred until math, bundled fonts, display… |
| pipeline.test.ts | 42 | RB | island removals carry byte provenance; renderer-pass removals do… |
| render-html.test.ts | 33 | RB | Paragraph widont when inline code, math, images, or footnote refs… |
| render.test.ts | 108 | RB | Structure the renderer sets for every corpus document |
| typography.test.ts | 250 | TY | D-A13 rule table, idempotence, and the acceptance criterion:… |

**`packages/core/src/sanitize/`** (7 files, 1,152 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| budget.test.ts | 56 | SP | What the sanitiser costs, measured because reading is primary and… |
| hostile-fixture.test.ts | 280 | SP | hostile fixture is the corpus the gates sweep Families that lived… |
| invariants.test.ts | 132 | SP | invariants, over generated input rather than over examples… |
| marxy-337.test.ts | 71 | SP | defects found in the sanitiser's URL, writer, comment and… |
| policy.test.ts | 52 | SP | the wide allow-list matches §12 and shares the default policy's… |
| sanitize.test.ts | 400 | SP | sanitiser's own behaviour: the allow-list decides, decoding… |
| vectors.test.ts | 161 | SP | acceptance criterion and its falsifiability Two halves that only… |

**`packages/core/src/sourcemap/`** (1 files, 262 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| section.test.ts | 262 | BF | sectionRange table cases and a corpus property over every heading |

**`packages/theme/src/`** (3 files, 376 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| config.test.ts | 114 | BF | setTopLevelKey byte preservation |
| css-urls.test.ts | 120 | SP | rewriteUrls security and rewriting cases |
| loader.test.ts | 142 | TY | loadTheme warnings and clamping |

**`packages/theme/test/`** (9 files, 968 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| aesthetics-acceptance-doc.test.mjs | 27 | SC | docs/aesthetics-acceptance.md stays aligned with… |
| grid.test.mjs | 280 | TY | default theme, measured in Playwright WebKit over the rendered… |
| layout.test.mjs | 98 | TY | the article opens near the top of the window instead of reading… |
| media-queries.test.mjs | 13 | TY | system-owned accessibility media queries live in base.css |
| pair-a-tune.test.mjs | 177 | TY | Pair A code size, heading weight in WebKit (skips in fast) |
| palettes.test.mjs | 91 | TY | the light palette is designed on its own ground — fixture match,… |
| taste-artifacts.test.mjs | 40 | TY | Taste-review screenshot pairs exist on disk |
| taste.test.mjs | 217 | TY | Six taste-review faults, each written to fail pre-fix (WebKit) |
| taste129-artifacts.test.mjs | 25 | TY | Taste-review pair screenshots exist on disk |

**`packages/typeset/src/`** (3 files, 230 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| hang.test.ts | 21 | TY | Hanging-punctuation fractions |
| hyphenate.test.ts | 69 | TY | skip rules and the allow-list, in Node: a hyphenator that ran on… |
| ragged.test.ts | 140 | TY | ragged-right breaker, pure: the cases a reader would notice |

**`packages/typeset/test/`** (3 files, 586 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| slash-break.test.mjs | 112 | TY | Slash-break suite the typeset `test/**/*.test.mjs` glob actually… |
| slash-break.test.ts | 65 | TY | Duplicate of slash-break.test.mjs; matched by no test glob (never runs) |
| typeset.test.mjs | 409 | TY | Typesetter over the rendered corpus in WebKit (skips in fast) |

**`scripts/`** (16 files, 1,686 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| changelog.test.mjs | 163 | PC | scripts/changelog.mjs --release folds changelog.d/ fragments into… |
| check-boundaries.test.mjs | 88 | SC | Module-boundary gate: template-literal dynamic import specs and… |
| check-cards.test.mjs | 138 | SC | One fixture per cardsAndRows failure class; each shown failing… |
| check-commonplace.test.mjs | 103 | SC | Commonplace gate must refuse an unsourced, uncleared or… |
| check-csp.test.mjs | 52 | SC | check-csp rejects a bad policy and runtime <style> creation |
| check-deferrals.test.mjs | 133 | SC | deferral gate must fail on landed or keyless markers and ignore… |
| check-deps.test.mjs | 43 | SC | Cargo.toml dependency extraction must cover inline and… |
| check-one-parse.test.mjs | 76 | SC | one-parse check must be able to fail: leftover deps, leftover… |
| check-pr.test.mjs | 94 | PC | check-pr.mjs's range check accepts a changelog.d/ fragment, or… |
| check-registry.test.mjs | 171 | SC | Every route from a string to parsed markup must respect… |
| check-story.test.mjs | 122 | PC | Story boundary: values-only token tune allowed; shell-api/contracts need an ADR |
| check-tokens.test.mjs | 119 | SC | token check must go red for a name added, removed, re-kinded or… |
| done.test.mjs | 89 | PC | a failed `pnpm done` re-run must not leave a stale done / all-ok… |
| gate-bundle.test.mjs | 131 | SC | Production bundle gate: memory-shell import graph and pre-build… |
| playwright-webkit.test.mjs | 66 | SC | Headless-by-default WebKit launch options |
| smoke-built-app.test.mjs | 98 | SC | Gates for: byte expectations, nightly wiring, and ci-contract… |

**`scripts/lib/`** (7 files, 675 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| changelog.test.mjs | 121 | PC | One changelog fragment per story instead of one shared… |
| imports.test.mjs | 54 | SC | AST reader the boundary, bundle and registry gates share: each… |
| no-ceiling.test.mjs | 79 | PC | Fails if a new session again reads 500 ms as a product cold-start… |
| own-row.test.mjs | 107 | PC | branch may edit the board for its own story and no other |
| plan.test.mjs | 123 | PC | One plan, in both forms. The CSV quotes what needs it, including… |
| repo.test.mjs | 87 | PC | What a commit is answerable for, in a throwaway repo |
| taste-queue.test.mjs | 104 | PC | optional taste-review entry is one file per story |

**`scripts/specimen/`** (1 files, 36 lines)

| File | Lines | Cat | Checks |
|---|---:|:-:|---|
| specimen.test.mjs | 36 | SC | Unit checks for the specimen scripts: no hard-coded hex outside… |

Six files are matched by no `test` glob in any package. `apps/desktop/src/trust/trust.test.ts` is imported by `test/trust.test.mjs:2`; `scripts/specimen/specimen.test.mjs` is spawned by `scripts/specimen/verify.mjs:13`; the three `packages/core/scripts/*.test.ts` are spawned by `gate-no-network.mjs` and `gate-tree-depth.mjs`. The sixth, `packages/typeset/test/slash-break.test.ts` (65 lines), is imported by nothing and matched by no glob, so it never runs. Its twin `slash-break.test.mjs` says in its header that it is the one the glob "actually runs".

```bash
node orph.mjs   # globSync over each package's test script patterns vs find '*.test.*'
# NOT IN ANY TEST GLOB: apps/desktop/src/trust/trust.test.ts, packages/core/scripts/{gate-assertions,gate-tree-depth,unobservable-classes}.test.ts, packages/typeset/test/slash-break.test.ts, scripts/specimen/specimen.test.mjs
```

### 1.6 Rust tests

```bash
grep -c '#\[test\]' apps/desktop/src-tauri/src/*.rs apps/desktop/src-tauri/src/*/*.rs
```

| File | Lines | `#[test]` | Protects |
|---|---:|---:|---|
| `atomic_write.rs` | 836 | 19 | BF: atomic, byte-faithful save, hostile payloads |
| `watch/mod.rs` | 616 | 11 | RB: live-reload watcher shapes, symlinks, rename |
| `main.rs` | 1,053 | 9 | RB/SP: argument paths, navigation guard |
| `commands/fs.rs` | 323 | 8 | SP: image size, asset scope, file errors |
| `index/mod.rs` | 573 | 8 | RB: indexer walk |
| `commands/os.rs` | 77 | 3 | RB |
| `watch/spawn_notify.rs` | 185 | 2 | RB: poll thread lifecycle |
| **Total** | 3,663 | 60 | 51 pass on macOS in `cargo test --locked` |

The same Rust is also compiled four other ways: `gate-fidelity.mjs` compiles `atomic_write.rs` with bare `rustc`; `index-model/walker.test.ts` and `position/watch-rust.test.ts` compile the walker and watcher with bare `rustc`; `apps/desktop/test/images.test.mjs` runs `cargo test fs` and fails in the `browser` job if no C linker is installed (CI installs `build-essential` for it, `ci.yml:149`).

### 1.7 Where the project's account and the code disagree

| # | Document says | Code or measurement says |
|---|---|---|
| 1 | `docs/hygiene.md`: `browser` 165 s after MARXY-153; PR wall time 277 s | `browser` median 708 s (n=14); PR run wall median 743 s (n=14); successful PR runs 171 s docs-only, 579 s otherwise (n=90). The desktop suite added in MARXY-247 is 407 to 478 s alone |
| 2 | `docs/hygiene.md`: caches include "apt packages via `cache-apt-pkgs-action`" | `ci.yml:204` says plain apt on purpose; the action dropped `glib-2.0.pc` |
| 3 | `docs/ci-contract.md`: `conventions` is "the job that fails most, and never for a code reason" | Of 36 red runs, `conventions` failed in 2; `fast` in 19, `browser` in 15 |
| 4 | `docs/hygiene.md` line 198 prescribes `-F strict=true`; `ci-contract.md` line 18 prescribes `strict=false` (ADR-0040) | `gate-protection.mjs:34,137,275` demands `strict === true` and its selftest asserts hygiene.md says so |
| 5 | `docs/ci-contract.md:8`: "Nothing here is a timing number"; `docs/hygiene.md`: six timing checks removed in MARXY-153 | `highlight.test.ts:102` (30 ms), `highlight.test.ts:133` (5 s), `marxy-337.test.ts:37` (1.5 s), `user-theme.test.mjs:146` (200 ms), `search-perf.test.ts` and `reload.test.ts` (calibrated against a reference machine), `typeset.test.mjs:104` (viewport budget) still assert wall-clock |
| 6 | `docs/hygiene.md`: `gate-protection` is a "standing check" that branch protection has not drifted | `package.json` has no script for it (its own selftest asserts that), no workflow runs it, and `--live` fails today (below) |

```bash
node scripts/gate-protection.mjs --live    # read-only gh api GET
# ✗ strict+ci: required status checks must be strict and contain ci (strict=false, contexts=["ci"])
# ✗ allow_force_pushes: expected false, got true      (exit 1)
```

`strict=false` is the intended state (ADR-0040, AGENTS.md). `allow_force_pushes=true` on main may be intended too (the machine config allows force-push), but nothing records the decision. The gate is stale either way.

## 2. Local run

Machine: Apple Silicon, 10 cores (`sysctl -n hw.ncpu`). Other agents were working on the same machine: the load average was 37.7 when `pnpm test` started and 4 to 9 for the later runs, and another agent built the app into this worktree's `target/` at 22:18 (a 2.3 GB tree and a 9.0 MB `target/release/marxy`). Timings are therefore upper bounds and the order of magnitude, not benchmarks. Commands ran in `/Users/ian/Dev/marxy-wt/MARXY-346`, one at a time, through a wrapper that records exit status and wall seconds. Logs are in the scratchpad (`results.txt` and one `.log` per command). Output tails are in the appendix.

| Command | Exit | Wall (s) | Result |
|---|:-:|---:|---|
| `pnpm typecheck` | 0 | 3 | 5 packages, `tsc --noEmit`, no errors |
| `pnpm lint` | 0 | 3, later 28 | biome clean over 155 desktop files; `biome-contract: ok`. The 28 s measurement is in section 5 |
| `pnpm test` | 0 | 428 (load 37) | 655 root + 763 core (762 pass, 1 skip) + 81 theme + 44 typeset + 304 desktop + 19 mutation re-run (8 fail by design) |
| `pnpm gate:golden` | 0 | 1 | 23 corpus fixtures match their goldens |
| `pnpm gate:fidelity` | 0 | 5 | ok; three seeded broken savers (CRLF to LF, trailing newline added, BOM stripped) are caught |
| `pnpm gate:licences` | 0 | under 1 | 321 npm packages, 528 crates, 25 grammars, 2 patterns; self-check 81 cases; two crates accepted by electing the permissive branch of an OR that offers LGPL (`r-efi`) |
| `pnpm check:boundaries` | 0 | 1 | 331 source files |
| `pnpm check:registry` | 0 | 1 | 513 files |
| `pnpm check:deps` | 0 | under 1 | 6 manifests plus Cargo.toml |
| `pnpm check:workflows` | 0 | 1 | 30 action uses, all pinned and allow-listed |
| `pnpm check:deferrals` | 0 | under 1 | 2 markers, 2 allow-listed |
| `pnpm gate:specimen` | 0 | 1 | 40 PNGs, 0 network requests against 6/6 controls |
| `pnpm gate:no-network` | 0 | 29 | 23 files and 33 vectors, two engines, 0 remote requests |
| `pnpm gate:aesthetics` | 0 | 44 | webkit-macos, 4 workers; CI takes 157 to 182 s for the same gate |
| `pnpm --filter @marxy/desktop test` | **1** | 251 | 303 pass, 1 fail: `afterPaint neutralised on a machine that delivers frames still fails the smoke` (`apps/desktop/scripts/smoke-verdict.test.mjs`) |
| `cargo test --locked` (in `src-tauri`) | 0 | 30 | 51 passed; warm target directory, so not a cold-build time |

Also run, for section 5 and for timing the pieces of `pnpm test` (quiet machine, load 3 to 9): orchestration tests 32 s wall (the files run in parallel; `loop.test.mjs` takes 31.5 s alone and `cycle.test.mjs` 10.8 s), `scripts/*.test.mjs` plus `scripts/lib` 2 s (215 tests), core unit tests 24 s, `gate-protection --live` red.

**The one red is a finding about the test, not the code.** `smoke-verdict.test.mjs:108` spawns `apps/desktop/scripts/smoke-cli-open.mjs`. If no release binary exists the script says "no release binary" and the test takes a selftest branch, which is what happened in the first full `pnpm test` (exit 0) and what happens in CI's `fast` and `browser` jobs. Once another agent had built `target/release/marxy`, the same test launched the real app, the machine produced no frames, the smoke exited 0 as a documented "frameless skip", and the assertion at line 128 (`notEqual(run.status, 0)`) failed. I reproduced it in isolation (4 s, same failure). A unit test whose verdict depends on whether `pnpm build` has been run, and on whether the display can paint, is the opposite of the project's own rule that a check fails only for something in the diff. The practical effect: after a local `pnpm build`, `pnpm test` is red on this machine.

```bash
cd apps/desktop && node --test --experimental-strip-types scripts/smoke-verdict.test.mjs   # ✖ afterPaint neutralised ... (4029 ms); pass 4, fail 1
ls -la src-tauri/target/release/marxy                                                       # 9.0M, created 22:18 by another agent's build
```

## 3. Skips, requiredness and flakiness

```bash
git grep -n -E "skip|retries|continue-on-error|\|\| true|test \$\? -eq 1" -- . ':!docs' ':!CHANGELOG.md' ':!pnpm-lock.yaml'
git grep -n -E "MARXY_[A-Z_]*REQUIRED"
```

**What skips, and where it is required.**

| Mechanism | Scope | Locally | In CI |
|---|---|---|---|
| WebKit missing: `!existsSync(webkit.executablePath()) && MARXY_BROWSER_TESTS_REQUIRED !== '1'` | 45 test files (38 desktop, 4 theme, 2 typeset, 1 core) | skips silently if `playwright install webkit` was not run | required only in the `browser` job, and only for `pnpm --filter @marxy/desktop test`. In `fast` it skips 176 desktop, 38 theme, 21 typeset and 5 core tests |
| Three-dot-diff tests that skip when `origin/main` is not a ref or the diff is not their story | `buffer.test.ts:253`, `outline.test.ts:204,212`, `merge-bar.test.mjs:335-348`, `no-ceiling.test.mjs:70` | run, on a branch off main | skip in `fast` (default shallow checkout); `conventions` has full history but runs no tests |
| `MARXY_PERF_REQUIRED` in `measure-startup.mjs:484` | startup measurement | skips if no binary | required in `gates` |
| `MARXY_SMOKE_REQUIRED` (`verify:cli`) | CLI smoke on built binary | frameless machines skip with a named reason | required in `gates` |
| `MARXY_SMOKE_BUILT_REQUIRED` (`smoke-built-app.mjs:15`) | tauri-driver smoke | skips if stack missing | required in nightly only |
| `MARXY_BUNDLE_REQUIRED` (`gate-bundle.mjs:151`) | installer size and katex | skipped ("no bundle built") | required in `release.yml` only, which has never run on a tag |
| `MARXY_AESTHETICS_REQUIRED` or `GITHUB_ACTIONS` (`gate-aesthetics.mjs:55`) | aesthetics gate | fails if WebKit missing only when the variable is set | required in CI |

**Seven WebKit test files run nowhere in CI.** `packages/theme/test/{grid,layout,pair-a-tune,taste}.test.mjs`, `packages/typeset/test/{typeset,slash-break}.test.mjs` and `packages/core/src/render/math.acceptance.test.ts` (1,557 lines, about 64 tests) skip in `fast`, and the `browser` job runs only `gate:no-network`, `gate:aesthetics` and the desktop suite. This includes the typesetter's real behaviour tests and the KaTeX screenshot baseline. They run on a developer machine that has WebKit installed. The aesthetics gate covers some of the same ground (measure, grid, rag) but is a different assertion.

```bash
gh run view 36967075472 --log | grep -E "^fast.*ℹ (tests|skipped)"
# packages/typeset: tests 44 pass 23 skipped 21;  packages/theme: tests 85 pass 47 skipped 38;
# packages/core: tests 772 pass 765 skipped 7;    apps/desktop: tests 304 pass 128 skipped 176
```

**Retries, `continue-on-error`, `|| true`.** None in `ci.yml`, `nightly.yml` or `release.yml`, no Playwright `retries`, and nine files assert the absence (section 5). The only `|| true` in the tree is `package.json` `prepare` (`git config core.hooksPath .githooks || true`), which is harmless. `docs/hygiene.md`'s rule holds.

**The mutation-test trick in `apps/desktop/package.json`.** After the normal desktop tests the script runs `( MARXY_86_MUTATION=search-prepared-body node --test … 4 palette test files ; test $? -eq 1 )`. In that mode `searchPrepared` returns `[]` (`apps/desktop/src/palette/search.ts:75`), so the palette tests must fail, and the step passes only if the child exits with status exactly 1. It is a hand-rolled mutation test: it proves the palette tests can go red. Four consequences:

1. Every `pnpm test` log, green or red, contains 8 expected `✖` lines and `fail 8` (see `pnpm test` in section 2, and CI run 36967075472). Anyone reading a red log has to know which failures are the designed ones; when I tried to find the real cause of five red `fast` runs by grepping `✖`, every hit was the mutation output.
2. Exit status 1 is also what a syntax error, a missing import or a crash in one of those four files produces, so the check cannot tell "tests detect the mutation" from "tests are broken". It passes in both cases.
3. `search.test.ts:28-31` asserts the text of the package script (`script.includes('test $? -eq 1')`): a test of a script that tests a test.
4. The hook is in shipped code. `search.ts:75` reads `process.env.MARXY_86_MUTATION` unguarded; `palette/view.ts:139` reads `MARXY_87_MUTATION`; `startup/idle-work.ts:151` reads `MARXY_196_MUTATION`. `grep -l MARXY_86_MUTATION -r apps/desktop/dist` finds the string in `dist/assets/index-D6vBgDPV.js`, so the hook is in the built bundle. I did not check how `process.env` resolves there; the app runs, so it must be shimmed.

**Timing assertions that remain.** ADR-0032 says no speed number fails the build; `ci-contract.md` repeats it. These tests still assert wall-clock: `highlight.test.ts:102` (`ms < 30`), `highlight.test.ts:133` (`ms < 5000`), `sanitize/marxy-337.test.ts:37` (`ms < 1500`), `desktop/test/user-theme.test.mjs:146` (`elapsed < 200`), `typeset.test.mjs:104` (`viewportMs < budget`), and two that scale a 16 ms and a 100 ms budget by a measured "machine factor" (`search-perf.test.ts:99`, `position/reload.test.ts:63`). The calibrated pair is a reasoned design; the absolute 30 ms one is exactly the kind `hygiene.md` removed from `budget.test.ts`. It is in the roughly 41 s of core tests that run in `fast`.

**Flakiness in CI.** I found no retry anywhere and no rerun data, so I cannot separate flakes from real regressions. What the failed runs show: of 36 red runs, `browser` failed in 15 (10 in the desktop suite, 4 aesthetics, 1 no-network), `fast` in 19 (7 `pnpm test`, 5 `pnpm lint`, 5 golden, 2 typecheck), `gates` in 5 (2 clippy, 2 Rust tests, 1 perf gate), `conventions` in 2, `changes` in 2. Three consecutive runs of one branch failed the same desktop test (`jump-to-source opens Source at data-marxy-s...`, about 35 s each, runs 36622126014, 36624971016, 36631013121), which reads as a real bug, not a flake. Three of the five lint failures show biome `noUnusedImports` (I could not read the other two). The golden failure I read (run 36548440953) was a stale `23-task-openers` golden after heading ids were added; commit `5725e0ae` refreshed it.

## 4. CI cost

```bash
gh run list --workflow ci --limit 200 --json databaseId,conclusion,createdAt,updatedAt,startedAt,event,headBranch,status
gh run view <id> --json jobs,startedAt,updatedAt,event,headBranch    # 14 successful PR runs, 6 successful push runs, 36 failed runs
```

The 200 most recent runs span 2026-09-29 02:48 UTC to 2026-10-02 05:13 UTC (3.1 days). Duration is `updatedAt - startedAt`. Queue time is excluded.

### 4.1 Run duration by event and conclusion

| Event / conclusion | Runs | Median (s) | p90 (s) | Min / max (s) |
|---|---:|---:|---:|---|
| pull_request / success | 90 | 546 | 745 | 160 / 869 |
| push (main) / success | 30 | 277 | 768 | 162 / 827 |
| pull_request / failure | 35 | 541 | 764 | 37 / 848 |
| pull_request / cancelled | 27 | 371 | 810 | 14 / 829 |
| push / cancelled | 15 | 254 | 456 | 16 / 581 |
| push / failure | 1 | 752 | 752 | 752 |
| **All pull_request** | 152 | 543 | 764 | |
| **All push** | 46 | 266 | 742 | |

The distribution is bimodal. Successful PR runs under 300 s (docs-only and orchestration-only changes, which skip `browser` and `gates`): 27 runs, median 171 s. Successful PR runs over 300 s: 63 runs, median 579 s; 28 of them over 600 s with median 732 s. Successful push runs over 300 s: 14, median 663 s. The 14 most recent successful PR runs, which are all product changes, have median wall 743 s.

Spent wall-clock in the window: 55,368 s successful (63 percent), 17,624 s failed (20 percent), 15,054 s cancelled (17 percent), 24.5 hours in all. 153 PR runs covered 49 distinct branches (3.1 runs per branch); 47 PRs merged in the window. A failed run is sometimes a real catch (the golden, clippy and desktop-suite failures above). A cancelled run is a superseded push (`cancel-in-progress` for non-main refs).

### 4.2 Job durations, 14 recent successful PR runs

| Job | Median (s) | Min / max | Share of job-seconds |
|---|---:|---|---:|
| `browser` | 708 | 562 / 770 | 52% |
| `gates (macos-latest)` | 243 | 2 / 293 | 18% |
| `gates (ubuntu-latest)` | 212 | 2 / 576 | 16% |
| `fast` | 159 | 130 / 173 | 12% |
| `conventions` | 23 | 19 / 43 | 2% |
| `changes` | 9 | 6 / 42 | 1% |
| `gates-record`, `ci` | 4 + 4 | | 1% |
| **Sum of medians** | **1,362** | | 22.7 runner-minutes |

Median run wall is 743 s because `browser` alone is the critical path. The 576 s Ubuntu outlier was a 356 s `apt-get` (run 36930928247). Three recent runs in detail:

| Run | conventions | fast | browser | gates Ubuntu | gates macOS | Wall |
|---|---:|---:|---:|---:|---:|---:|
| 36967075472 (`feat/MARXY-235`) | 21 | 157 | 673 | 282 | 265 | 728 |
| 36930928247 (`fix/MARXY-311`) | 25 | 143 | 770 | 576 | 278 | 789 |
| 36930036475 (`feat/MARXY-342`) | 19 | 159 | 740 | 208 | 190 | 766 |

The six latest successful **push** runs (the same pipeline on the squash commit, minus `conventions`): median wall 737.5 s; job medians fast 157, browser 713, gates 219 and 226. That is about 1,333 job-seconds per merge, a second full price for a tree the PR run already proved.

### 4.3 What dominates

| Step (run 36967075472, Ubuntu unless noted) | Seconds | Share of 1,362 job-s | Can it fail for something in the diff? |
|---|---:|---:|---|
| Desktop suite with WebKit required, serial | 407 (478 in another run) | 30% | yes; the only CI check on the app's save, close and reload paths |
| `gate:aesthetics` | 157 (182) | 12% | yes, for theme, typeset, render, fixtures; irrelevant to most PRs |
| `pnpm test` in `fast` | 111 (87) | 8% | yes |
| `cargo build --profile ci` (Ubuntu / macOS) | 73 / 102 | 13% together | only for Rust or tauri.conf changes |
| Startup and parse measurement, perf selftests, perf gate (both OS) | 34 / 54 | 6% | no: ADR-0032 records numbers and fails only if the record is missing |
| Linux apt deps | 33 (356 once) | 2% | no |
| `gate:no-network` | 34 | 2.5% | yes |
| Container init, mise, install in `browser` | 57 | 4% | no |
| `cargo clippy` and fmt (Ubuntu) | 44 | 3% | yes, Rust only |
| CLI smoke on the built binary (Ubuntu / macOS) | 19 / 18 | 3% | yes, shell paths only |
| Rust unit tests (Ubuntu / macOS) | 16 / 19 | 3% | yes, Rust only |

Per-file local timings for the desktop suite (`node --test --experimental-strip-types <file>` one at a time, 57 files): 345 s summed, of which `src/source/source-browser.test.mjs` is 76.5 s (22 percent: a 9 MB CodeMirror document scroll with a frame-time envelope), and the ten slowest files are 199 s (58 percent). The 15 files that guard save, trust, data loss, close, reload, open, selection and persistence (`app-harness, close-guard, data-loss, explicit-save, links, live-reload, open-path, operations-edit, persist-reading, save, save-close-r5, save-trust-r4, selection, single-instance, trust`) are 135.7 s (39 percent) and 115 tests.

### 4.4 What the PR mix needs

```bash
git log --format='@@%h %cs' --name-only -n 150 origin/main     # classified in a node one-liner
```

Of the last 150 commits on main (2026-09-20 to 2026-10-01): 64 touch non-markdown files under `packages/` or `apps/`, 29 touch theme, typeset, core render/sanitize/parse or fixtures, 18 touch `src-tauri`, 61 touch only orchestration code, 8 only `scripts/`. About 41 percent of merged changes are the orchestrator's own, and they already run only `fast`.

### 4.5 Nightly and release

`nightly.yml`: three scheduled runs, all green, 419 to 511 s (`gh run list --workflow nightly`); five manual dispatches on 2026-09-29 were five failures and two successes while the smoke was being built. `release.yml` has three runs in its history, all failures, all `push` events to branches, none on a tag, and `git tag` is empty: the release path has never completed, including the installer half of `gate:bundle`.

### 4.6 Which jobs could be nightly

| Job or step | Today | Verdict |
|---|---|---|
| Startup measurement, parse measurement, perf gate and selftests, both OS | 88 job-s per PR | nightly or main-only; it records numbers and cannot fail on a diff |
| macOS `gates` build, CLI smoke | 243 s | only when `src-tauri/`, `tauri.conf.json`, `vite.config.ts` or `apps/desktop/scripts/smoke*` change; else nightly |
| Desktop suite beyond the 15-file set (42 files, about 260 s) | in `browser` | nightly, with WebKit required |
| `gate:aesthetics` | 157 s on every `web` change | PR only when typography or render paths change; else nightly |
| Typeset, theme and core WebKit tests | run nowhere | nightly with `MARXY_BROWSER_TESTS_REQUIRED=1` |
| `gates` on push to main | 1,333 job-s | main runs `fast` only; the nightly covers the rest |
| `gate:licences` (5 runs per PR: fast once, each `gates` twice) | under 1 s each | lockfile or manifest change, plus nightly |

## 5. Selftests and meta-checks

A meta-check is one whose subject is another check, a workflow, or a document about the checks. Lines are the check plus its test; runtime is measured on the quiet machine unless stated.

```bash
node scripts/gate-protection.mjs --selftest     # 0.1 s, 36 named cases, 11 fixtures
node scripts/check-workflows.mjs --selftest     # 0.1 s, 13 cases
node scripts/ci-changes.mjs --selftest          # 0.1 s, 48 cases
node scripts/gate-perf.mjs --selftest           # 0.1 s, 82 cases (+15 measure-startup, +8 measure-parse)
node --test orchestration/docs.test.mjs orchestration/machine.test.mjs   # 0.05 s each
pnpm test:contracts-frozen                      # 0.4 s
pnpm lint:biome-contract                        # 22 to 27 s locally (see below)
```

| Meta-check | Subject | Lines | Runtime | What it has caught (git log and CI) |
|---|---|---:|---:|---|
| `test:contracts-frozen` plus `contracts.test.ts` | five frozen contract files | 1 inline line (1.6 KB), 8 | 0.4 s | Nothing traceable in the window. History is exemptions: names frozen not values (MARXY-133), `tokens.css` unpinned (MARXY-139), a skip without `origin/main` (MARXY-108) |
| `lint:biome-contract` | `biome.json`, `ci.yml` strings, package scripts | 1 inline line (2.1 KB) | 0.6 s in CI, 20 to 27 s locally | Nothing found. Its `grep -R` walks `target/` and `node_modules`: 20.4 s through `spawnSync('grep', …)` with a 2.3 GB `target/` present, 0.015 s with `--exclude-dir=target` (my interactive shell's `grep` is a function that honours `.gitignore`, which hid this until I called `/usr/bin/grep`). On a clean CI checkout it costs nothing, so the cost is local-only and appears after the first build |
| `check-workflows` plus `--selftest` | third-party Actions, `--locked` | 155 | 0.1 s | Written after a caching action broke every Rust build (script header, lines 4 to 9). No red run in the window |
| `ci-changes --selftest` | the classifier and `ci.yml` shape | 303 (whole file) | 0.1 s | Red twice (runs 36538232487 and 36621461631), both on the branch that edited the workflow (MARXY-334) |
| `gate-protection --selftest` | the protection gate and hygiene.md wording | 347 + 233 fixture lines | 0.1 s | Nothing. Its selftest pins `strict=true` in hygiene.md while ADR-0040 chose `false`; live mode is red (section 1.7) |
| `orchestration/docs.test.mjs` | fleet docs vs code | 91 | 0.05 s | Added 2026-09-26 (MARXY-227), one commit; no red run traced |
| `orchestration/machine.test.mjs` | story-state table is total | 199 | 0.05 s | Same commit. `hygiene.md` cites about eighty orchestrator stalls as the motive; not verifiable from CI |
| `gate-assertions.test.ts`, `unobservable-classes.test.ts`, `gate-tree-depth.*`, `gate-assertions.ts`, `gate-observability.ts`, `tree-depth-cases.ts` | the no-network and sanitiser gates | 159 + 76 + 123 + 93 + 85 + 24 + 53 + 52 = 665 | about 1 s (inside the 29 s gate) | Added by MARXY-83 and MARXY-84 after the gate was found blind to request classes; no later catch |
| Gate-internal selftests: `gate-licences` selfCheck (81 cases), `gate-fidelity` seeded broken savers, `gate-perf` (97 with measure-startup), `measure-parse` (8), `commonmark-spec --selftest`, `gate-aesthetics --selftest` (2.7 s), `specimen/verify` | each gate against fixtures | mixed into files of 832, 688, 798 + 511, 255, 242, 1,124 and 169 lines | each under 3 s; fidelity's three seeded failures are part of its 5 s | `gate-licences` is 3 `fix` commits of 6 (lockfile packages without a licence, unaudited crates, a stale record). The fidelity mutants are the most valuable of these: they prove the gate sees CRLF, trailing-newline and BOM rewrites |
| Nine files that read `ci.yml` for `continue-on-error` or `\|\| true` | `ci.yml` | about 140 lines across `gate-fidelity` (620-633), `gate-licences` (439-443, 707-712), `gate-perf` (369-373, 678-683), `commonmark-spec` (60-90, 143-146), `measure-parse` (63-100, 175-179), `specimen/verify` (34-36), `smoke-verdict` (103-121), `ci-changes` (179) | milliseconds | None found; the rule was born of one `\|\| echo` hiding a broken `check-story --strict` (MARXY-153) |
| Nine `scripts/check-*.test.mjs` | the nine check scripts | 923 | 2 s together with the other 206 scripts tests | The history is hardening: `check-boundaries` MARXY-307 (template-literal imports) and 309 (import-walk gaps); `check-registry` MARXY-132 and 306 (every route to the DOM, compound `innerHTML +=`); `check-deps` MARXY-308. Each was a bypass found by review, not a product regression |
| `smoke-verdict.test`, `smoke-built-app.test`, `layout-shift-window.test`, `paint-signal.test`, `aesthetics-acceptance-doc.test`, `no-ceiling.test` | wiring and docs of other checks | 176 + 98 + 173 + 132 + 27 + 79 = 685 | the first is the red test of section 2 | Not determinable |

What this adds up to: the checks-about-checks category is 3,188 lines (7.9 percent of all test and check code), and that is a floor, because the selftest code embedded in the large gates is counted under their own categories. They are cheap to run (seconds in all). Their cost is in the number of places that have to be edited together: changing `ci.yml` means satisfying `gate-perf`, `gate-licences`, `gate-fidelity`, `commonmark-spec`, `measure-parse`, `specimen/verify`, `smoke-verdict.test`, `ci-changes`, `check-workflows` and `lint:biome-contract`, each of which has its own idea of what the file must say (`docs/ci-contract.md` "Editing CI itself" lists four; there are at least ten). The hardening history is consistent with a design aimed at agents that route around gates: the checks harden against their own authors. For one owner plus ad-hoc agents that adversary is smaller.

## 6. Recommendation: a pruned pull-request path

Principle, from the project's own `docs/hygiene.md`: a check earns its place on the pull-request path by being able to fail for something in the diff. Apply it also to what runs after a merge (the push run proves the same tree a second time) and to what runs for whom (a Rust build is not evidence about a typography change).

### 6.1 The decisions

| Decision | Items |
|---|---|
| **Stay on every PR** | `typecheck`; biome (plain `biome check`); unit tests of core, typeset (Node half), theme (Node half), desktop non-browser; `gate:golden`; `gate:fidelity` (5 s, the byte-fidelity commitment); `gate:no-network` (34 s, the no-phone-home commitment); `check:boundaries`, `check:registry`, `check:deps`, `check:deferrals` while they pay for themselves; `check:workflows` (supply chain, 0.1 s); `contracts-frozen`; CommonMark spec; PR title lint; a `browser-lite` job: no-network plus the 15 desktop files that guard save, trust, data loss, close, reload, open, selection and persistence (about 170 s) |
| **Path-filtered** | `gate:aesthetics` only for `packages/theme`, `packages/typeset`, `packages/core/src/{render,sanitize,parse}`, `fixtures/`, desktop CSS; orchestration and `scripts/` tests only when `orchestration/` or `scripts/` change (32 s of `fast`); a single Ubuntu Rust job (clippy, `cargo test`, `cargo build`, `verify:cli`) only when `src-tauri/`, `tauri.conf.json` or `vite.config.ts` change (about 200 s); `gate:licences` only on lockfile or manifest change |
| **Move to nightly, required there** | startup and parse measurement, perf selftests and perf gate on both OS (88 job-s per PR; ADR-0032 says they cannot fail); macOS build and smoke; the other 42 desktop WebKit files (about 260 s, including the 76 s `source-browser` file); the typeset, theme and core WebKit tests that run nowhere today (with `MARXY_BROWSER_TESTS_REQUIRED=1`). `aesthetics --repeat 3` and the built-app smoke stay where they are |
| **Main-branch push** | `changes` and `fast` only (about 170 job-s instead of 1,333); the nightly is the full check |
| **Delete** | `gate-protection.mjs`, its 11 fixtures and its line in `pnpm test` (stale against ADR-0040, wired nowhere; if wanted, a five-line `gh api` assertion in the nightly); `packages/typeset/test/slash-break.test.ts` (dead twin); `lint:biome-contract` (a 2.1 KB inline script whose strings are already enforced by biome and `check-workflows`); the three-dot-diff tests in `buffer.test.ts`, `outline.test.ts`, `no-ceiling.test.mjs` and the diff-reading cases of `merge-bar.test.mjs` (story boundaries are `check-story`'s job, and these skip in CI); eight of the nine copies of the `continue-on-error` assertion (keep `ci-changes.mjs:179` or move it into `check-workflows`); the `gates-skip`, `gates-record` and cache-key machinery (MARXY-105) and most of `ci-changes.mjs`, replaced by plain path conditions; the `MARXY_*_MUTATION` hooks in `search.ts`, `view.ts`, `idle-work.ts`; the unreferenced `hang-shots.mjs`, `check-prose-volume.mjs` and the three taste-review `check-*.mjs` scripts; PR commit-range commitlint (squash merges keep only the title) |
| **Merge** | the eight hygiene scripts (`boundaries`, `registry`, `deps`, `deferrals`, `one-parse`, `tokens`, `font-attrs`, `workflows`) into one `pnpm check` with one process and one failure format; `gate:licences` runs 5 times per PR, run it once; the desktop `test` script's normal and mutation invocations into a plain run plus a separate `pnpm test:mutations` that fails on a named test, not on exit status 1. `check-story`, `check-pr`, `check-cards`, the changelog-fragment and taste-queue checks stay only while the fleet runs: they enforce the fleet's board, cost about 5 s of CI and a good deal of authoring friction |
| **Fix, not remove** | `smoke-verdict.test.mjs` (stop spawning the real binary from a unit test); the timing assertions in `highlight.test.ts`, `marxy-337.test.ts`, `user-theme.test.mjs`, `typeset.test.mjs` per ADR-0032; the documents in section 1.7; `release.yml`, which has never completed |

### 6.2 What it saves

Medians are from section 4.2; the pruned numbers are derived as shown, not measured.

| | Today (product PR) | Pruned |
|---|---:|---:|
| `changes` | 9 | 9 |
| `conventions` | 23 | 20 (title and body; no commit-range lint) |
| `fast` | 159 | 127 (159 minus the 32 s root orchestration and scripts tests when they are not touched) |
| `browser` | 708 | 270 (container, mise, install 57; no-network 34; linker 9; desktop 15-file set 170, which is 39 percent of the 407 to 478 s suite) |
| `gates` Ubuntu and macOS | 212 + 243 | 0 |
| `gates-record`, `ci` | 8 | 4 |
| **Job-seconds** | **1,362 (22.7 min)** | **430 (7.2 min)** |
| Expected path-filtered work | | + 0.19 x 157 s (aesthetics, for the 29 of 150 commits touching typography paths) + 0.12 x 202 s (Rust job, for the 18 of 150 touching `src-tauri`) = + 54 |
| **Weighted per product PR run** | 1,362 | **about 484 (8.1 min)** |
| Saved per product PR run | | **about 878 job-s (14.6 min, 64 percent)** |
| Wall time, typical product PR | 743 s | about 280 s (9 s of `changes` plus the 270 s `browser-lite`); about 440 s when aesthetics runs |
| Push to main | 1,333 job-s | about 170 |

Per merged product PR at 3.1 PR runs and one push run, treating every PR run as a full run (an upper bound, since failed and cancelled runs stop early): before 3.1 x 1,362 + 1,333 = 5,555 job-s (92.6 min); after 3.1 x 484 + 170 = 1,670 (27.8 min); saved about 3,885 job-s (64.8 min, 70 percent). Orchestration-only PRs (41 percent of merges) already run only `changes`, `conventions`, `fast` and `ci` (about 195 s) and are unaffected.

The repository is public, so GitHub-hosted standard runners cost nothing in money. The saving is iteration time: the cycle and the author wait on `ci` before every merge, and the median product run is 12 minutes.

What the pruning does not touch: byte fidelity (`gate:fidelity`, the save, data-loss and close tests), the no-network and sanitiser gates, the licence gate, the golden AST files, and the typography gate wherever typography changes. What it takes out is work that could not fail for the diff in front of it (perf numbers, a second proof of the same tree, a Rust build for a CSS change) and tests that did not run anyway.

One property needs a decision from the author rather than a default: 64 WebKit tests of typesetter, theme and KaTeX behaviour run nowhere in CI today. Either run them nightly as recommended above, or accept `gate:aesthetics` as the typography check and delete them.

## Appendix A: output tails and commands

Exit status and wall seconds are in section 2. Last lines of each log (trimmed):

```text
$ pnpm typecheck                    rc=0   apps/desktop typecheck: Done
$ pnpm lint                         rc=0   apps/desktop lint: Checked 155 files in 17ms. No fixes applied. / biome-contract: ok
$ pnpm test                         rc=0   protection gate selftest ok: 11 fixtures, 36 named cases / tokens-contract ok (55 tokens)
                                           (root runner) ℹ tests 655  ℹ pass 654  ℹ fail 0  ℹ skipped 1
$ pnpm gate:golden                  rc=0   golden: 23 corpus fixtures match their golden AST and HTML files, invariants hold
$ pnpm gate:fidelity                rc=0   fidelity: a save path with a byte-order mark stripped is caught (1 files differ, including 12-crlf-and-bom.md) / fidelity: ok
$ pnpm gate:licences                rc=0   licence gate ok (321 lockfile packages, 528 Cargo.lock crates, 25 grammars, 2 hyphenation patterns)
$ pnpm check:boundaries             rc=0   boundaries ok (331 source files)
$ pnpm check:registry               rc=0   registry ok (513 files)
$ pnpm check:deps                   rc=0   deps ok (6 manifests + Cargo.toml)
$ pnpm check:workflows              rc=0   workflows ok (30 action use(s), all allow-listed and pinned; glib-2.0 probed; ... every cargo and tauri build locked)
$ pnpm check:deferrals              rc=0   deferrals ok (2 marker(s), 2 allow-listed)
$ pnpm gate:specimen                rc=0   specimen gate ok: 2 pairs x 2 variants x 5 pages x 2 densities = 40 PNGs ... 0 network requests against 6/6 control references intercepted
$ pnpm gate:no-network              rc=0   no-network gate ok: 23 corpus files and 33 vectors x 2 engines through parse-render-sanitise, 0 remote requests ...
$ pnpm gate:aesthetics              rc=0   aesthetics gate ok: measure 66 characters, line box 30px, contrast 14.52:1; webkit-macos; ...
$ pnpm --filter @marxy/desktop test rc=1   ℹ tests 304  ℹ pass 303  ℹ fail 1  ✖ afterPaint neutralised on a machine that delivers frames still fails the smoke (3954.9 ms)
                                           [ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @marxy/desktop@0.0.1 test: ... Exit status 1
$ cargo test --locked               rc=0   test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.99s
```

The package summaries inside the `pnpm test` log: core `ℹ tests 763 / pass 762 / skipped 1`, theme `81/81`, typeset `44/44`, desktop `304/304` plus the mutation re-run `19 tests / pass 10 / fail 8 / skipped 1`, whose exit status 1 is the designed result.

Other commands behind numbers in this document:

```bash
node --test orchestration/*.test.mjs orchestration/test/*.test.mjs    # 32 s; per-file timings from running each file alone
node --test scripts/*.test.mjs scripts/lib/*.test.mjs                 # 215 tests, 2 s
for f in <desktop test files>; do node --test --test-concurrency=1 --experimental-strip-types $f; done   # 57 files, 345 s summed
gh run view 36967075472 --log                                          # CI step timings and the skip counts in section 3
gh run list --workflow nightly --limit 10; gh run list --workflow release --limit 30; git tag
```

## For the synthesis

1. A typical product PR costs 1,362 job-seconds (22.7 runner-minutes) and 743 s of wall time, and every merge repeats about 1,333 job-seconds on the push to main; the `browser` job (708 s, one serial WebKit suite plus the aesthetics gate) is 52 percent of the work and the whole critical path.
2. The recommended pruned path (path filters, a 15-file desktop subset, no perf measurement or dual-OS builds on PRs, `fast` only on main pushes, the rest nightly) cuts a product PR to about 484 job-seconds and about 280 s of wall time, a 64 percent saving per PR run and about 70 percent per merged PR, while keeping the byte-fidelity, no-network, golden, licence and boundary checks on every PR.
3. The checks that guard the project's stated commitments are real and cheap: `gate:fidelity` (5 s, seeded broken savers prove it can fail), `gate:no-network` (29 s, controls prove it can see) and `gate:licences` (under 1 s); keep them as they are.
4. About 64 WebKit tests of typesetter, theme and KaTeX behaviour (1,557 lines in 7 files) skip in `fast` and run in no CI job, and the three-dot-diff tests also skip in CI, so "all green" overstates what is checked; run them nightly with WebKit required or delete them.
5. The project's own CI documents are stale: `docs/hygiene.md` says `browser` is 165 s and the pipeline 277 s (measured 708 s and 743 s), `gate-protection --live` fails against the live repository (strict=false per ADR-0040, allow_force_pushes=true) and is wired to nothing, and `ci-contract.md` and `hygiene.md` give opposite `strict` values.
6. Every local check passed except `pnpm --filter @marxy/desktop test`, which fails on any machine that has run `pnpm build` because `smoke-verdict.test.mjs:108` launches the real binary from a unit test; `pnpm lint` also takes 25 s locally once a `target/` exists because `lint:biome-contract` runs `grep -R` through it.
7. Checks whose subject is another check are 3,188 lines (7.9 percent of test and check code) and run in seconds, so pruning them saves little time; the cost is that ten files each assert their own idea of `ci.yml`, and the hardening history (MARXY-306 to 309) is about closing bypasses by agents, a smaller threat for one owner.
8. Test and gate code is 40,413 lines, and 61 of the last 150 merged commits touched only the orchestrator, whose tests are 6,104 lines and 32 s of every code PR's `fast` job (one file that scans the process table takes 31 s); a path filter removes that from PRs that do not touch it.
9. Dead and unwired checks exist: `packages/typeset/test/slash-break.test.ts` never runs, the CLI forms of `check-csp` and `check-commonplace` and `gate-protection --live` are wired to nothing, `release.yml` has never completed a run (no tags, three failures), and test hooks (`process.env.MARXY_86_MUTATION` and two siblings) ship in the production bundle; delete or wire each.
10. Timing assertions (`highlight.test.ts:102` at 30 ms, `marxy-337.test.ts:37`, `user-theme.test.mjs:146`, `typeset.test.mjs:104`) remain on the pull-request path despite ADR-0032, and 37 percent of CI wall-clock in the last three days went to failed or cancelled runs, so a flake or a slow assertion costs real iteration time.
