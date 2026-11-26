# Briefs: verifying faster and more quietly; the clean-up left from the evaluation

Rules for builders and reviewers: `C:\Dev\reader\work\wave1\wave1-cut.md`. Line numbers are from master `17cfe661`; find code by name.

| Branch | What | Depends on | Owns | Builder | Reviewer | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `residue` | The unread class list, process ids in comments, prose about CI that is gone | wave 1 merged on `agent/wave1` (cut from there) | many files, comments only; `scripts/registry.json` | Sonnet | Opus | S |
| `verify-lock` | `verify` takes a machine-wide turn for its heavy steps | `verify-defaults` in master | `scripts/verify.mjs`, `scripts/lib/machine-lock.mjs` | Sonnet | Opus | S |
| `harness-bundle` | Browser tests boot from one bundle | X4 says go | `apps/desktop/test/support/`, `src/harness/` | Sonnet | Opus | M |
| `quiet-waits` | Sleeps replaced by a quiet-page wait | X5 says go | `apps/desktop/test/support/`, test files in batches | Sonnet | Opus | M, in batches |
| `timings-out` | Time bounds leave correctness tests | `perf-record` in master | about 20 browser tests; `scripts/measure-interactions.mjs` | Sonnet | Opus | M |
| `one-source` | Lists generated from one source | none | `scripts/verify-map.json` and its readers; command and file-type lists | Sonnet | Opus | M |
| `core-sweeps` | Core's corpus sweeps sampled in the changed tier | none | a few tests in `packages/core` | Sonnet | Opus | S |
| `helpers-one` | One escape, one size formatter, one plural, one state-file helper | after shifts 1 and 3 have landed (it touches many files) | `packages/core/src/util/`, about 80 call sites | Sonnet | Opus | M |
| `shell-one` | One `Shell` interface | `dead-code` in master | `packages/shell-api`, `apps/desktop/src/app-types.ts` | Sonnet | Opus | S-M |
| `rust-trims` | Dependency and feature trims | X7 for the decoders | `src-tauri/Cargo.toml`, small Rust edits | Sonnet | Opus | S |
| `startup-split` | The startup chunk loads only what first paint needs | X6 says the gain is 50 ms or more | `apps/desktop/src/main.ts`, `boot.ts`, `app.ts`, the modules made lazy | Sonnet | Opus | M |

`residue` is the last piece of wave 1 and is covered by Ian's word for that wave. The rest come back to him.

Order where files are shared: `quiet-waits` before `timings-out` (both edit browser test files); `read-tree` and `scope-keys` (in `04`) before `one-source`'s third part (the Tauri command lists); `helpers-one` after the render-path and warm-store branches have landed.

## residue

Cut from `agent/wave1` after the six wave-1 branches are merged there, because it touches their files.

**Do.**

1. `scripts/registry.json` has a `classes` list of 545 entries that nothing reads: `scripts/check-registry.mjs` (about 146) checks only that class literals in source start `marxy-`. Delete the list and whatever docs say a new class goes in it (`AGENTS.md` says names are registered: make it say exactly which names). Keep the other sections; they are read.
2. Comments that carry process identifiers, against the repository's own rule. About 100 in TypeScript: brief names (`STUDIO-BRIEF`, "the theme pass", `lab P-`), dates at the top of files (`studio/galley.ts:1`, `look/theme-look.ts:1`), letter-number codes (`app-types.ts:93` E7, `:115` B3, `document/entries.ts:14-150` A3-A7, `commands/editor.ts:59` D-A31). Rewrite each to say why in plain words, or delete it if it says nothing else. Do not touch the aesthetics gate's exception labels, the renderer's numbered post-passes, or references to RFC and TeX sections, which are kept on purpose.
3. Test names and messages with ids: `apps/desktop/test/round3-desktop.test.mjs`, `split-screen-criterion.test.mjs`, and "criterion N", "D1", "(B4)" in about 36 places in nine files; `MARXY_86_MUTATION` in `apps/desktop/scripts/mutations.mjs` and `scripts/gate-bundle.test.mjs`; a commit hash in a comment in `packages/core/src/reading/notebook.test.ts` (about 313). A renamed test file changes `scripts/verify-map.json`.
4. Prose about CI and nightly jobs that no longer exist: `fixtures/perf-budgets.json` (an ADR number, nightly jobs, a results file), `apps/desktop/src-tauri/Cargo.toml` (about 111-113, a key that is not there), `apps/desktop/scripts/smoke-verdict.mjs`, `smoke-cli-open.mjs`, `scripts/measure-startup.mjs`, `scripts/perf-harness.mjs`, `scripts/gate-aesthetics.mjs`, `scripts/probe-layout.mjs`. Say what each tool does today and who runs it (a person, by hand), nothing about what once ran it. The stale comment on `toml` in `Cargo.toml` (about 21, "already in Cargo.lock") goes too.

**Careful.** A comment edit can break a test that scans source text (it has happened: a store test scans `store.ts` for `document.`). After the sweep run the desktop unit suite and `pnpm check`, not only typecheck. Identifiers hide in strings (assert messages, measurement lines, CSS inside template literals), which a comment-only search misses: search for the patterns everywhere and judge each.

**Proof.** A search for the id patterns over source, tests, scripts and docs returns only the kept exceptions (list the pattern and the survivors in the report); typecheck, lint, `pnpm check`, the desktop and scripts unit suites, the verify turn (`--tier changed --base agent/wave1`, since the branch is cut from there).

**Numbers.** Lines removed from `scripts/registry.json`; comments rewritten and deleted, by pattern; test names changed. Nothing the measuring tool sees.

## verify-lock

**Why.** Several builders on one machine starve each other's browser tests: 112 Playwright timeouts across 12 logged runs, 42 in one. `check:tauri` already takes a machine lock (`scripts/lib/machine-lock.mjs`); the browser step and the unit suites do not. Wave 1 used a two-slot script outside the repository (`C:\Dev\reader\work\wave1\verify-turn.sh`) to get by.

**Do.** `pnpm verify` takes one of N slots for the whole run of its heavy steps (browser, the unit suites, cargo), N from an environment variable with a default of two; waiting prints what it waits for; a slot whose owner process is gone is reclaimed; `--no-lock` skips it. Reuse the lock module's way of naming and reclaiming rather than writing a second one. Document it in `docs/testing.md` and the side-by-side rules in `docs/working.md`. Then the wave-1 script is no longer needed: say so in the report (it is outside the repository; the orchestrator removes it).

**Proof.** A test of the slot logic with fake owners (taken, released, reclaimed after the owner dies, the N+1th waits); two `verify --tier quick` runs started together with N=1 run one after the other.

## harness-bundle

Only if X4 (`01-experiments.md`) shows the gain; its report says how much and names the registry it tried.

**Do.** Browser tests that boot through `bootTwoPanes` (`apps/desktop/test/support/two-pane.mjs`) load one built harness bundle, built once per run and cached as `shared-vite.mjs` already caches builds, in place of about 250 modules from the dev server for every test. The 99 files that import app modules by address inside the page (`import('/src/...')`) get them from a registry the harness bundle exposes on one global; eight modules cover nearly all of it (`selection/bind.ts`, `shell/memory.ts`, `source/editor.ts`, `app.ts`, `commands/index.ts`, `main.ts`, `notices/index.ts`, `look/store.ts`). The handful that rely on dev-server addresses for their own purpose (`lazy-chunks.test.mjs` routes a module's address; `phase-e-flow.test.mjs` replaces one; two read a module address from the resource timeline) get a hook that serves the same purpose or stay on the dev server, named. Nothing of the registry reaches the shipped build (`shipIndexOnly` in `vite.config.ts` already keeps the harness entry out of `dist/`; `scripts/gate-bundle.mjs` fails a `dist/` with a second entry). Convert by area, a batch per commit, running each batch before and after.

**Proof.** Every converted file passes; per-test boot time and requests per boot before and after from the instrumentation X4 added; a full browser step timed before and after on a quiet machine.

## quiet-waits

Only if X5 shows a quiet-page wait passes at least as often and runs no slower.

**Do.** Put X5's `quiet(page)` helper in `apps/desktop/test/support/`, with the list of the app's repeating polls it must ignore kept beside it and a test that fails when a new repeating timer appears that is not on the list. Replace fixed sleeps file by file, a batch per commit, worst files first (`line.test.mjs` 22, `mode-swap` 17, `pane-close-guard` 16, `palette-preview` 16, `split-narrow` 13, `place-across-modes` 13). A sleep that is the test's own variable stays (one in the sample: `pane-scroll.test.mjs:603`). Each converted file is run twenty times alone before it is committed.

**Proof.** Pass counts and durations per file before and after; the count of `waitForTimeout` in the suite before and after.

## timings-out

**Why.** About 35 assertions in 20 browser tests fail on a time bound, and they are the tests that go red under load: `has-restyle.test.mjs:17,85` (15 ms), `sheet-scale.test.mjs:93` (50 ms), `user-theme.test.mjs:148` (200 ms), `paint-signal.test.mjs:229`, `archive-page:310`, `archive-sheet:296`, `compare:240` (400 ms), `source-open-stall.test.mjs:67,78` and `plain-text-large.test.mjs:92` (500 ms), `progressive-large.test.mjs:319` (3 s), `long-line.test.mjs` (seven bounds of 10 to 60 s), `find-pane.test.mjs` (four), `jump-to-end:183`, `paragraph-restyle:62`, `left-search-big:41`, `folder-page:203`, `deep-nesting:115`, `diff-file:314`, `data-tree-budget:108-117`, `notices-pill.test.mjs:164` (a window of 3.5 to 5.5 s on the app's own timer).

**Do.** For each: if the thing protected can be counted (reads, passes, rows drawn, nodes replaced, style recalculations through a counter the test installs), assert the count and drop the clock. If it is a stall or a first-paint time that only a clock can see, move the scenario into `scripts/measure-interactions.mjs` as a recorded number, never a verdict, and leave the correctness part of the test (the page shows the right thing) where it is. `notices-pill` needs the page's clock faked for that test, not a wider window. The 26 unit-test files that bound CPU time with `cpuNow()` are out of scope except the 10 MB notebook bound, which still fails under load: give it a counted form or move it.

**Proof.** The list above with what became of each; the suite's count of time-bound assertions before and after; the measuring tool's table showing the moved scenarios.

## one-source

**Why.** Lists that must agree are copied by hand and held together by tests: `scripts/verify-map.json` (edited in 30 commits, two of the three merge conflicts recorded in round integrations); the file-type table mirrored into `tauri.conf.json`, `tauri.windows.conf.json` and the installer hooks, compared by `packages/core/src/kind/registry.test.ts:96-113` (it turned a full verify red with a 478-item diff); a Tauri command declared in `shell/tauri.ts`, `build.rs`, `generate_handler!` and `capabilities/main.json`, compared by `apps/desktop/test/shell-boundary.test.mjs:137-186`.

**Do**, one commit each, in this order, stopping after any that turns out harder than it looks:

1. Coverage by header: each browser test file says what it covers in a first-line comment (`// covers: frame, source`), `verify.mjs` reads the headers, and `verify-map.json` goes, with the part of `verify.test.mjs` that polices it replaced by a check that every browser test file has a header naming known areas.
2. The file-type associations in the two Tauri config files and the installer hooks written by a script from the kind registry (`openWithExtensions()` is the source), with a test that fails when they are stale, as the theme sheets are handled.
3. The command list: one list in Rust from which the capability file and the build script's list are generated, or a check that derives all four from one.

**Proof.** Each generated file equals what is committed today; `pnpm verify --tier changed --list` gives the same files for the last twenty commits' changes as the map did (a script that replays them).

**Numbers.** Hand-kept lists before and after (files and lines); nothing the measuring tool sees.

## core-sweeps

`packages/core`'s unit suite takes 188 to 218 s on every core change, bounded by single tests that sweep the whole corpus (106, 69, 46, 37 s, four more of about 30 s). In the quick and changed tiers run those over a sampled subset chosen by a seed that the run prints; in the full tier run them whole. Use the seed and size settings the suite already has where they exist.

**Proof.** The sampled tests still fail when the property they test is broken (break it, run with three seeds, see a failure each time, restore); the full tier runs every file of the corpus as before.

**Numbers.** The core unit step's duration in the changed tier before and after, from the verify log; the full tier's unchanged.

## helpers-one

After the render and warm-store work has landed, since it touches about 80 files.

**Do**, a commit per family, each with the call sites moved and the local copies deleted:

- HTML escape: ten local `esc` functions escape different sets (`viewers/mail.ts` only `&` and `<`; `viewers/sandbox.ts` `&`, `"` and `<`; others add `>` or `"`). One in core with the full set. For each call site say whether the output changed and whether that matters where it is used (text content, an attribute value); a site that must keep a narrower set says why.
- Byte sizes: fourteen formatters print different forms for the same size. One in `packages/core/src/viewer/bytes.ts` with the long form and one short form; this changes what the reader sees in a few places, so list them with before and after.
- `plural`: 37 local copies with different number grouping. One in `packages/core/src/util/text.ts`.
- Versioned JSON state files: eight implementations, about 1,900 lines (`trust/trust.ts`, `position/storage.ts`, `palette/history.ts`, `kind/show-as.ts`, `layout/storage.ts`, `layout/frame-storage.ts`, `reading/part-choices.ts`; `workspace-storage.ts` is deleted by wave 1). One generic helper; the files on disk keep their exact format (`docs/data-on-disk.md` describes them), proved by reading and writing the existing fixtures byte for byte.
- `el`, `clamp`, base name and extension: the shared ones that already exist replace the local copies.

**Proof.** The suites; for the state files, round trips of real files equal byte for byte; for escape and sizes, the lists of changed outputs.

## shell-one

`@marxy/shell-api` declares 46 members; the app uses a pick of 26 plus 24 optional extras (`apps/desktop/src/app-types.ts`), which is why app code has 84 optional-call guards. One interface holding what is called, required where both shells implement it; the runtime stub in the types package (`stubShellImpl`, `packages/shell-api/src/index.ts:548-616`) replaced by the compiler checking the two shells against the interface. The privacy list (`settings/privacy.ts`) still has to name every member.

**Proof.** Typecheck (the compiler now proves both shells implement the interface); `pnpm check` (the boundary checks); the desktop unit suite and the verify turn, since every shell call site is touched.

**Numbers.** Optional-call guards on shell members in `apps/desktop/src`, before (84) and after; members declared, before (46) and after.

## rust-trims

- `toml` from 0.9 to the 1.x Tauri's stack already uses (one fewer crate version; check the API change in the one place it is used).
- `tauri` with `default-features = false` and the features actually used; confirm the build and `check:tauri` at integration.
- `tauri-plugin-clipboard-manager` only where the native pasteboard does not exist, with the one Studio button that calls it directly (`apps/desktop/src/studio/tab-file.ts:25`) going through the pasteboard first.
- The decoders, by X7's numbers and Ian's choice.
- Not the hand-written SHA-256 or the hand-declared Win32 calls: they exist because `atomic_write.rs` and `watch/mod.rs` must compile alone for a gate, and changing that gate is a decision for Ian.

Every dependency change goes through `scripts/allowlists/dependencies.json` and `pnpm gate:licences`.

**Proof.** `cargo test` and `pnpm lint:rust`; `cargo tree -d` before and after; `check:tauri` at integration, since features and plugins changed.

**Numbers.** Crates in `Cargo.lock`, duplicated crate versions, and the size of the release exe, each before and after (the exe is built by the integrator; it was 30.2 MB at the evaluation).

## startup-split

Only if X6 (`01-experiments.md`) shows 50 ms or more off the median time to first text; its throwaway branch shows which groups were worth deferring.

**Today.** The shipped page loads one entry chunk of 1.38 MB and 559 modules before first paint (`node scripts/bundle-report.mjs` lists what is in it): every reading's parser (`packages/core/src/reading`, the largest group), all commands, operations, transforms, versions, the look engine and settings schema, the index model. `apps/desktop/src/app.ts` `mountFrame` (about 272) also installs things first paint does not need before the launch file is opened. A test already pins which modules may be reached statically from the entry (`apps/desktop/src/startup/static-import-graph.test.mjs`); `scripts/gate-bundle.mjs` and `gate-highlight-bundle.mjs` check the build.

**Do.** Load on demand the groups X6 found worth it, with no change in behaviour: a command family is imported when one of its commands is first run or shown, a non-Markdown reading when a file of that kind is opened, and so on. Nothing the reader does may wait visibly on a chunk: prefetch the deferred chunks when the app is idle after first paint. Update the static-import test to hold the new, smaller set. Keep the code that decides what a file is (kind detection) eager.

**Proof.** The static-import test, tightened, fails if a deferred group becomes eager again; browser tests that the first use of a deferred thing works with no visible delay (a command run straight after boot; a JSON file opened first); `check:tauri` at integration.

**Numbers.** The entry chunk's size and module count from `bundle-report.mjs`, before and after; the median time to first text over ten cold launches, twice, from `scripts/measure-startup.mjs` (run by the orchestrator; it needs the built exe and nothing else driving a window).
