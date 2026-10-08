# 09 — Lane G: a fast pull-request path and a fast `precheck`

**Date:** 2026-10-08 · **Status:** proposed, for the author · **Runs:** beside lanes B and C, inside the
four-agent cap (`00-orchestration.md` §5). **Brief:** `docs/plan/ci-and-precheck-slimming-handoff.md`.

Story cards follow the house shape (`02-phase-b.md`). Ids are `G-nn`.

**Abstract.** A pull request waits about ten and a half minutes for `ci`, a push to `main` about nine,
and `pnpm precheck` on a desktop change ran 17 minutes and died without a summary. Measured, almost all
of it is four things:

1. one core property test that takes **290 s**;
2. precheck running the **full WebKit suites** on the Mac, which CI only runs nightly;
3. a typography job of **6 to 7 minutes**;
4. four 1 MB browser tests that take **130 s** of the lite suite.

None of them is the product getting slower. Five stories bring a code pull request to about **3 minutes**,
a push to `main` to about **2.5**, and precheck to **under 90 seconds** for a one-package change. Every
commitment keeps a gate on the pull-request path. What leaves the path (Linux, the release-profile build,
the mechanical aesthetics gate, the specimen gate, the slower WebKit files) runs nightly. Nothing is
deleted.

## 1. What was measured

### CI: the last 24 green `ci` runs (2026-10-08, `gh run view --json jobs`)

Wall time per run: pull requests 9.0–11.6 min (median ≈ 10.5); pushes to `main` 6.6–9.8 min (median ≈ 9.2,
and they run only `fast`); docs-only 0.3–0.5 min.

| Job | Ran in | Median | Max | Where the time goes (median per step) |
| --- | ---: | ---: | ---: | --- |
| `fast` | 22/24 | **520 s** | 575 s | `pnpm test` **472 s**; install 22 s; typecheck 10 s; everything else ≈ 15 s |
| `browser-lite` | 14/24 | **603 s** | 674 s | lite suite **468 s**; `gate:no-network` 49 s (a Vite build; its tests take 1.5 s); container start 27 s; mise 21 s; apt C linker 17 s |
| `typography` | 9/24 | **410 s** | 436 s | `gate-aesthetics --mechanical` **342 s**; container 30 s; mise 19 s; specimen 2 s |
| `rust` | 4/24 | **384 s** | 415 s | thin-LTO build 169 s; fmt + clippy 87 s; Linux apt 43 s; `cargo test` 16 s |
| `changes`, `conventions`, `ci` | all | 8 / 23 / 7 s | | |

The critical path of a pull request is `fast` or `browser-lite`, both about 9–10 minutes.

**Inside `pnpm test` (run 37738702710):**
- `packages/core` takes **334 s**. Of that, `splice is identity and X-local over every node of
  32-long-reference.md` alone takes **290 s**, and the same test over `15-prose-volume.md` takes 19 s
  (`packages/core/src/buffer/splice.property.test.ts:50`).
  - The cause: for every node, the test spreads the whole 195 KB buffer into two JS arrays and
    `deepEqual`s them, twice per node. That is O(nodes × bytes) with a very large constant.
  - The test was cheap until `32-long-reference.md` joined the corpus (A-02's note in `progress.md`).
- `apps/desktop` (node only; 346 WebKit tests skip) takes 56 s, then the scripts tests take 7 s.
- `pnpm -r` sorts topologically, so desktop's tests wait for core's to finish. The wall time is the sum
  (≈ 400 s), not the maximum.

**Inside the lite suite.** The figures are attributed by test name, so they are approximate:
- `progressive.test.mjs` takes **147 s**, nearly all of it in four tests at 1 MB:
  - 39 s: opened at 80 %, the reading line holds;
  - 37 s: live reload at 1 MB keeps the reading byte;
  - 33 s: `commitEdit` at 1 MB keeps the position;
  - 23 s: at 1 MB, first text holds the first screens.
- `selection` and `links` take 23 s each, and the corpus provenance property takes 19 s.
- Every other file takes 2–17 s.
- One of the 1 MB tests has already timed out once under load (F-02's note).

### `pnpm precheck`, locally (M-series Mac, warm tree, each step of `precheck --all` timed alone)

| Step | Wall | Note |
| --- | ---: | --- |
| `apps/desktop test` | **654 s** | the **full** desktop suite in WebKit (718 tests, 1 skipped), `--test-concurrency=1` |
| `packages/core test` | 124 s | the splice test again |
| `gate:aesthetics` | 80 s | full gate with baselines |
| `gate:no-network` | 43 s | a Vite build and two browsers |
| `packages/theme test` | 25 s | its WebKit tests run here; CI's `fast` skips them |
| `packages/typeset test` | 21 s | likewise |
| `gate:fidelity` | 4 s | |
| every other step: typecheck and lint for each package, `check`, `check:story`, `check-cards`, `gate:golden`, `gate:bundle`, `lint:theme`, `lint:rust` (warm), `gate:licences` | 0–2 s each | |
| **Sum, serial** | **965 s** | **16 min**, which matches the 17 minutes reported |

Two-thirds of precheck is one step that CI never runs on a pull request. Each step's output is at most
81 KB, so `spawnSync`'s 1 MB buffer limit was not the cause of the death.

**Splice experiment.** Comparing with `Buffer.equals` instead of spreading arrays took the 32-long file
from 290 s (CI) to **9 s** (local) on the same assertions. What remains is splice's own copy of the
buffer for each node.

**Why precheck is slow.** Playwright's WebKit is installed on the Mac, so every browser test whose skip
reads `!existsSync(webkit.executablePath())` runs. 71 test files carry that skip. So a precheck that
touches `apps/desktop` runs the full desktop WebKit suite: the suite CI keeps for nightly
`browser-full`, which has a 45-minute timeout. Precheck runs it serially, then the gates, one
`spawnSync` at a time.

**Why it died without a summary.** This is inferred, not reproduced:
- The run reported `check` and `check:story` as passed. The next steps in its order were
  `gate:no-network`, `gate:bundle` and `lint:rust`, so it stopped during `gate:no-network`. That step
  builds the app and launches two browsers.
- Run alone here, the same step passed in 43 s. The run had reached about 16 minutes by then. So the
  likeliest story is not a hang: the caller gave up and killed it. That caller was an agent's shell tool
  with a time limit, or a person pressing Ctrl-C.
- `spawnSync` blocks the event loop and has no timeout. A killed parent cannot print anything, and pnpm
  then reports `ELIFECYCLE`, which is exactly what was seen.
- G-02 makes that state impossible to reach silently: steps run asynchronously, each with a timeout,
  and the summary prints on every exit path.

## 2. The minimal pull-request gate, commitment by commitment

The handoff's rule: say which gate protects which commitment before moving it.

| Commitment | Holds it on the PR path today | After lane G |
| --- | --- | --- |
| 1. Free | `gate:licences` (fast); `check-deps` (in `pnpm check`); `gate-licences --require-registry` after the Linux build (rust) | **unchanged** for npm. The Rust half runs on `cargo fetch --locked` when `Cargo.lock` changes, with no build (G-03) |
| 2. Private | `gate:no-network`; the lite files `release-csp`, `images`, `user-theme`; theme sanitiser unit tests | **unchanged** (`gate:no-network` stays on every web change; the three files stay in lite) |
| 3. Faithful | `gate:fidelity`, `gate:golden`, the splice property, the core fidelity units (fast); lite `save`, `explicit-save`, `data-loss`, `save-trust-r4`, `save-close-r5`, `close-guard`, `operations-edit`, `live-reload` | **unchanged**. The splice property is made fast (G-01), not moved |
| 4. Nothing hidden silently | core unit tests (bidi, zero-width, link targets, folds) | **unchanged** |
| 5. First text never waits | lite `progressive.test.mjs` (its 1 MB first-text test) | **kept**: the 1 MB first-text test stays in lite (23 s). The three reading-position tests at 1 MB go nightly (G-04) |

**What stays on the pull-request path:** `changes`, `conventions`, `fast` (trimmed), `browser-lite`
(trimmed and sharded), `rust` (only when Rust changed: fmt, clippy and `cargo test` on macOS), and the
aggregate `ci`.

**What leaves it** goes to the nightly workflow, which is monitoring. A red nightly is a note for the next
session, not a blocked merge (ADR-0032, ADR-0047).

| Leaves the PR path | Why it can go | Nightly home |
| --- | --- | --- |
| `typography` job: `gate-aesthetics --mechanical`, `gate:specimen` | aesthetic, not a commitment; the author: no pixel or aesthetic enforcement at this stage | `aesthetics-determinism` already runs the full gate; add `gate:specimen` to it |
| Linux webview build: apt, thin-LTO `--profile ci` build, CLI smoke, post-build `gate:bundle` | platform, not behaviour; macOS is the product target | `rust-linux` (already the same job), `startup-macos` (macOS build and CLI smoke), `built-app-smoke` |
| `pnpm test:fleet` | the fleet is paused (ADR-0051) | `fleet` (already there) |
| Lite files that hold no commitment: `selection`, `links`, `index-service`, `palette-index`, `persist-reading`, `open-path`, `app-harness`, `single-instance`; the three 1 MB reading-position tests; the corpus provenance property (its node twin is `gate:fidelity`) | behaviour worth watching, not a commitment floor | `browser-full` runs the whole desktop suite already |
| The Rust half of `images.test.mjs`, which compiles a crate | needs a C linker in the Playwright container | it becomes a `#[test]` in `src-tauri`, run by `cargo test` (G-04) |

**Path filters, harder (G-03):**
- `docs_only` widens to `changelog.d/`, `.claude/`, `AGENTS.md`, the process docs and orchestration prose.
  They are asserted only by `test:fleet`, which leaves the path.
- `web` narrows from "anything under `scripts/`" to the scripts the browser job runs
  (`gate-no-network.mjs`, `playwright-webkit.mjs`).
- The `typography` and `fleet` outputs go away.

### Projected wall time

| | Today (median) | After lane G (estimate) |
| --- | ---: | ---: |
| Code PR touching the app | ≈ 10.5 min | **≈ 3 min**: `fast` ≈ 2.5, `browser-lite` shards ≈ 2.5–3 |
| PR touching Rust | ≈ 10.5 min | ≈ 3–4 min: `rust` on macOS, clippy and test with a warm cache, off the critical path otherwise |
| Push to `main` | ≈ 9.2 min | **≈ 2.5 min** (`fast` only) |
| Docs-only PR | ≈ 0.5 min | ≈ 0.5 min, and more PRs qualify |
| `pnpm precheck`, one package | 17 min, then died | **< 90 s** warm |

## 3. Stories

Order:
- **G-01, G-02 and G-04 in parallel.** Their paths do not overlap.
- **G-03 after G-04**, because it removes the apt step that G-04 makes unnecessary.
- **G-05 last.**
- G-01 alone takes about five minutes off every pull request and every push. Ship it first.
- G-03 touches `.github/`, so the author merges it.

### G-01 — The splice property in linear time, and `pnpm test` in parallel

**Model:** sonnet · **Size:** XS · **Depends on:** — · **Parallel with:** G-02, G-04

**Outcome.** `fast`'s `pnpm test` falls from about 470 s to under 90 s.

**Paths.**
- `packages/core/src/buffer/splice.property.test.ts`
- root `package.json` (the `test` script only)
- `changelog.d/G-01.md`

**Build order.**
1. Compare bytes without building JS arrays. Use `Buffer.compare` or `equals` on `subarray`s.
   Build the `deepEqual` message only when the comparison fails, so a failure still names the file and
   range. The lead's experiment: 290 s becomes 9 s on the 32-long file.
2. Keep every node of every corpus file: the property is commitment 3. Do not sample.
3. Root `test`: run the package suites without the topological wait (`pnpm -r --no-sort test`; check that
   no package's tests need another's build output first), then the scripts tests.

**Acceptance.**
- The existing neutralised-splice test still fails the X property.
- A splice that touches one byte outside the range fails the identity check, mutation-checked once by hand
  and noted in the PR.
- Core's `test` is under 60 s in CI. `fast` is under 3 minutes on the PR's own run.

### G-02 — `precheck`: under 90 seconds, parallel, and it always reports

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** G-01, G-04

**Outcome.** `pnpm precheck` is CI's `fast` job for what you touched, and nothing else. It runs in under
90 s warm for a one-package change. It prints a timed summary on every exit, including a kill.

**Paths.**
- `scripts/precheck.mjs`
- `scripts/gates-by-path.json`
- new `scripts/precheck.test.mjs`
- the "Before you push" section of `docs/ci-contract.md`
- the precheck lines in `AGENTS.md`
- `changelog.d/G-02.md`

**Build order.**
1. **Steps:**
   - `pnpm check`;
   - typecheck, lint and test for each touched package;
   - the node-only gates mapped by path: `gate:golden` and `gate:fidelity` for core or the corpus,
     `gate:bundle` for desktop, `gate:licences` for manifests or lockfiles;
   - `cargo fmt --check` when `src-tauri` changed.
2. **Drop** `check-cards` and `check:story` (fleet; nightly `fleet` runs them), `gate:no-network`,
   `gate:aesthetics`, `lint:theme` (already inside theme's `lint`) and clippy. They remain runnable by name.
3. **No browser by default.** Run package tests with `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty
   directory, so the existing skip triggers exactly as it does in CI's `fast`. That is one line in
   precheck instead of 71 edited files.
   - `--browser` opts back in for the touched packages.
   - Say in the summary that WebKit tests were skipped, and how to run them.
4. **`scripts/` changes** run `node --test scripts/lib/*.test.mjs scripts/*.test.mjs`, not all five
   packages. Root manifests, `pnpm-workspace.yaml` and tsconfigs still mean every package.
5. **Parallel and timed:**
   - async `spawn`, concurrency from `os.availableParallelism()`;
   - each step's output goes to `results/precheck/<step>.log`;
   - each row prints its wall time;
   - each step has a timeout: default 5 min, `--timeout` to change it.
6. **Always report.** Print the summary from one function, called:
   - on normal completion;
   - on `SIGINT` and `SIGTERM`, after killing child process groups, with rows marked `killed`;
   - on an uncaught error.

   The exit code is non-zero whenever any row is not `✓`.
7. `--all` stays the explicit slow path: every package, WebKit on, every gate including no-network,
   aesthetics and clippy, still parallel and timed.

**Acceptance (in `precheck.test.mjs`, against a stubbed step runner):**
- the path map selects the right steps for a desktop-only, a core-only, a scripts-only and a docs-only
  change;
- `SIGTERM` mid-run prints the summary with `killed` rows and exits non-zero;
- a step past its timeout is `✗ timed out`.

Measured by hand and recorded in the PR: a desktop-only change, warm, under 90 s.

### G-04 — The lite suite holds the commitments, in two shards

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** G-01, G-02

**Outcome.** `test:lite` keeps only the files that hold a commitment (§2 table) and runs in under 3 minutes
of test time. Every file it drops still runs nightly in `browser-full`.

**Paths.**
- `apps/desktop/package.json` (`test:lite`)
- `apps/desktop/test/progressive.test.mjs`, and a new `apps/desktop/test/progressive-large.test.mjs`
- `apps/desktop/test/images.test.mjs`
- a `#[test]` in `apps/desktop/src-tauri/src/` for `image_size` and `allow_asset_scope`
- the `browser-lite` row of `docs/ci-contract.md`
- `changelog.d/G-04.md`

**Build order.**
1. Move the three 1 MB reading-position tests (opened at 80 %, live reload, `commitEdit`) into
   `progressive-large.test.mjs`, outside `test:lite`. Keep the 1 MB first-text test in
   `progressive.test.mjs`: it is commitment 5's PR guard.
2. The corpus provenance property (19 s) lives in `selection.test.mjs`, which leaves lite whole (step 5).
3. Replace the cargo-compiling subtest in `images.test.mjs` with Rust unit tests of the same functions, so
   lite needs no C linker.
4. `test:lite` keeps:
   - `save`, `explicit-save`, `data-loss`, `save-trust-r4`, `save-close-r5`, `close-guard`, `trust`;
   - `live-reload`, `operations-edit`, `progressive`;
   - `release-csp`, `images`, `user-theme`.
5. `test:lite` drops `selection`, `links`, `index-service`, `palette-index`, `persist-reading`,
   `open-path`, `app-harness` and `single-instance`. They stay in `test`, so nightly runs them.
6. Check that `node --test --test-concurrency=1 --test-shard=i/2` splits the list evenly. G-03 wires the
   shards.

**Acceptance.**
- Every file named in `test` still runs in `browser-full` (assert it in an existing script test, or by
  listing in the PR).
- The new Rust tests fail with the asset scope widened, mutation-checked once.
- Local `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite` finishes in under 3 minutes.

### G-03 — The pull-request path holds the commitments only

**Model:** opus · **Size:** M · **Depends on:** G-04 · **Merged by:** the author (touches `.github/`)

**Outcome.** The jobs and filters in §2. A code PR finishes in about 3 minutes, and `ci` still means
"everything that ran succeeded".

**Paths.**
- `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`
- `scripts/ci-changes.mjs` and its test, `scripts/ci-verdict.mjs` and its test
- `scripts/check-workflows.mjs` and its selftest cases
- `docs/ci-contract.md`, `docs/hygiene.md`
- new `docs/adr/0056-the-pull-request-path-holds-the-commitments.md`, which amends ADR-0046 decision 1
  and extends ADR-0047
- `changelog.d/G-03.md`

**Build order.**
1. **`typography`:** delete the job and the output. Add `pnpm gate:specimen` to nightly
   `aesthetics-determinism`.
2. **`rust`:**
   - `runs-on: macos-latest`. The repository is public, so macOS minutes cost nothing, and macOS is the
     product target.
   - Steps: `Swatinem/rust-cache`, `cargo fmt --check`, `cargo clippy --locked -- -D warnings`,
     `cargo test --locked`. Build the frontend first only if `cargo test` needs `dist/`.
   - When `lockfile`: `cargo fetch --locked`, then `node scripts/gate-licences.mjs --require-registry`.
   - Teach `check-workflows` that a licence gate after `cargo fetch` is as good as after a build. Its
     Linux cargo rule still binds the nightly Linux jobs.
   - Delete the Linux apt, the `--profile ci` build, the CLI smoke and the duplicate `gate:bundle` from
     the PR job.
3. **`browser-lite`:**
   - a two-way matrix on `--test-shard`;
   - `gate:no-network` in shard 1 only;
   - delete the apt C-linker step;
   - narrow `web` as in §2.
4. **`fast`:** delete the `test:fleet` step and the `fleet` output. Keep the CommonMark spec (4 s),
   `test:mutations` (2 s) and the push-to-`main` run, now about 2.5 min.
5. **`docs_only`:** widen as in §2. Update `ci-changes.test.mjs` with the cases, and `ci-verdict` for the
   four remaining outputs.
6. **Write it down:**
   - the contract table, and what each moved gate's red nightly means;
   - `hygiene.md` rows;
   - the ADR, with §2's commitment table as its evidence.

**Acceptance.**
- `ci-changes.test.mjs` covers each new docs-only path, the narrowed `web` and the removed outputs.
- `ci-verdict.test.mjs` still fails on a failed job and on a missing output.
- `check-workflows --selftest` is green.
- A nightly `workflow_dispatch` from the branch runs `aesthetics-determinism` (with specimen),
  `browser-full` and `rust-linux` green, or names any red that predates the branch.
- The PR's own `ci` run shows the new wall time.

### G-05 — Prove the numbers

**Model:** sonnet · **Size:** XS · **Depends on:** G-01 to G-04

**Outcome.** The table in §1 again, after a day of merges, written into `progress.md` by the lead:
per-job medians from the next 20 green runs, and precheck for one change per package. Anything over target
gets a follow-up card, not a new gate.

## 4. Questions for the author (each has a default)

1. **Linux.** _Default:_ off the PR path entirely. Nightly keeps `rust-linux` and `built-app-smoke`. If one
   goes red for a Linux-only reason, delete it rather than fix it until Linux is a release goal again.
   ADR-0046's "Linux builds in CI" becomes "Linux builds nightly".
2. **Targets.** _Default:_ about 3 minutes for a code PR and under 90 seconds for precheck. Going lower
   means dropping `browser-lite` from PRs entirely and leaving commitments 3 and 5's app-level tests to
   nightly. Not recommended: the edit-after-reload data loss (MARXY-246) reached `main` through exactly
   that gap.
3. **Deletions.** _Default:_ none. Everything that leaves the PR path is snoozed to nightly, where it
   costs no one's time. Revisit after a month of nightly results: a job that never went red, or went red
   only for platform reasons, is a deletion candidate.
4. **B-02.** It makes the mechanical aesthetics gate measure the app, and its wall time grows from about
   143 s to 293–461 s. With `typography` off the PR path, that cost lands on nightly only. _Default:_ B-02
   proceeds unchanged; G-03 rebases on it, or the reverse, whichever merges second.
