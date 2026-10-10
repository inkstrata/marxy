# The CI contract — everything that can turn a pull request red

In short: a pull request goes red for one of four reasons, one per job in
`.github/workflows/ci.yml` (`conventions`, `fast`, `browser-lite`, `rust`), and each has a command that
reproduces it on your machine. The path holds the five commitments of `AGENTS.md` and nothing else
(ADR-0056); everything else runs nightly. Nothing
else is required of a pull request. There is no board row, no Jira key, no enforced pull-request
body and no result file (ADR-0051: the fleet is paused, `orchestration/PAUSED.md`). Read this
before you push, not after. If CI fails on something that is not on this page, the page is wrong
and fixing it is part of your PR.

The governing rule is the one in `docs/hygiene.md`: **a check earns its place on the
pull-request path by being able to fail for something in the diff.** A check that fails for the
machine it ran on is a coin flip. Timing numbers are recorded nightly and never failed on
(ADR-0032).

## The one required check

Branch protection requires exactly one status: **`ci`**. It is a summary job
(`scripts/ci-verdict.mjs`) that fails if `changes` did not answer all four of its questions, or if
any other job it waits for ended in anything but `success` or `skipped`. A skipped job is fine,
so a job can be renamed without touching repository settings. Run the same verdict locally
against a hand-written `needs`:

```bash
NEEDS='{"changes":{"result":"success","outputs":{"docs_only":"false","web":"true","rust":"false","lockfile":"false"}},"fast":{"result":"failure"}}' node scripts/ci-verdict.mjs
```

The protection settings are a repository setting, not a file: `strict=false` (a pull request need
not be up to date with `main`, ADR-0040) and `ci` the only required context. The working command
is a PATCH, because `PUT` answers 404, and `-F` sends `strict` as a boolean:

```bash
gh api -X PATCH repos/inkstrata/marxy/branches/main/protection/required_status_checks -F strict=false -f 'contexts[]=ci'
```

## Before you push

Two commands and two habits. If these are green, CI has only your judgement left to find.

```bash
pnpm precheck      # CI's `fast` job for what you touched: parallel, timed, under 90 s for a one-package change
pnpm check         # the eight hygiene checks in one command (the first thing `fast` runs)
```

- A **Conventional Commits subject** (`docs/conventions.md`). It may end in a story id such as
  `(A-07)` or `(A-14.1)`, in a Jira key such as `(MARXY-123)`, or in neither. The hook
  `.githooks/commit-msg` lints every commit as you make it. The pull-request **title** is linted
  again in CI, because a squash merge uses it as the subject.
- A **changelog fragment**, `changelog.d/<id>.md`: one reader-facing line ending in `(<id>)`
  (`changelog.d/README.md`). No CI job fails without one today; the reviewer asks for it.
- The pull-request template (`.github/pull_request_template.md`) is a suggestion, not a gate:
  plain-language Summary first, then Changes, Verification, For the reviewer. Open the pull
  request with `gh pr create --body-file FILE`, never `--body`, so the template is not replaced.

`pnpm precheck` is the `fast` job for the paths you changed, and nothing else: `pnpm check`;
typecheck, lint and tests for each touched package (a change to `scripts/` runs the scripts tests
instead; root manifests, `pnpm-workspace.yaml`, tsconfigs and `biome.json` still mean every package);
and the node-only gates `scripts/gates-by-path.json` maps to your paths (`gate:golden` and
`gate:fidelity` for core or the corpus, `gate:bundle` for desktop, `gate:licences` for manifests and
lockfiles, `cargo fmt --check` for `src-tauri`). A change to `packages/core` also runs the CommonMark
spec selftest and typechecks `apps/desktop` (which consumes core), without running desktop's tests. The
steps run in parallel, each with a timeout (5 minutes, `--timeout <seconds>`), each step's output goes to
`results/precheck/<step>.log`, and a timed summary prints on every exit, including `Ctrl-C` and a kill
(those steps read `killed`).

Flags: `--all` (the slow path below), `--browser` (below), `--timeout <seconds>` (per step; 5 minutes, or
30 with `--browser`/`--all`), `--jobs <n>` (how many steps run at once; default
`os.availableParallelism()`, so `--jobs 2` on a busy or small machine), and `--files a,b,...` (plan
from this comma-separated list of repo-relative paths instead of the git diff against `origin/main`
and your uncommitted and untracked files, for example to ask what a change would run).

What it does **not** mirror from `fast`, so a green `precheck` is not a green `fast`:

- Desktop's typecheck, lint and tests after a change that touches only another package (only core's
  change typechecks desktop; a `shell-api`, `theme` or `typeset` change does not).
- `gate:licences`, `gate:bundle`, the golden and fidelity gates, and the `scripts/` tests run only on the
  paths `scripts/gates-by-path.json` maps to them (`scripts/` changes run the scripts tests, not the
  packages), whereas `fast` runs them on every pull request that is not docs-only.
- `test:fleet` runs only for `orchestration/` changes in `precheck`, and in no pull-request job: it left
  the pull-request path in G-03 (the fleet is paused, ADR-0051) and runs nightly. Run `pnpm test:fleet`
  by hand after touching `orchestration/`.
- The CommonMark spec suite itself (the download-and-compare step); only the selftest runs.

`pnpm precheck --all` closes most of that gap (it does not run the fleet tests or the CommonMark spec suite).
It does not mirror `rust` either: that job runs on macOS, runs `cargo test` and the licence gate over the
whole of `Cargo.lock`, and `precheck` runs only `cargo fmt --check` (and clippy under `--all`).

It runs **no browser**: package tests run with `PLAYWRIGHT_BROWSERS_PATH` pointing at an empty
directory, so the WebKit tests skip exactly as they do in `fast`, and the summary says so. CI runs those
in `browser-lite` (and nightly in `browser-full`). `pnpm precheck --browser` runs them for the touched
packages; `pnpm precheck --all` is the slow path (every package, WebKit on, every gate including
`gate:no-network`, `gate:aesthetics` and clippy). Not run by default:
`gate:no-network`, `gate:aesthetics`, `lint:rust` and the paused fleet's `check:story` are pnpm
scripts, run by name; `check-cards` is not one, run it as `node scripts/check-cards.mjs`.
pnpm's pre and post hooks are switched off (`enablePrePostScripts: false` in `pnpm-workspace.yaml`):
`pnpm check` does not run `precheck` first, and `pnpm precheck` runs `pnpm check` itself as one of its
steps. Nothing else in the repository relies on a `pre…` or `post…` script.

`pnpm done`, `node scripts/open-pr.mjs` and `node scripts/check-pr.mjs` (draft a result file,
validate a template-shaped body, expecting a `MARXY-nnn` key) are **optional local helpers from
the fleet era**. CI runs none of them.

## What runs, and what it is locally

| Job | Runs when | What it does | Local command |
| --- | --- | --- | --- |
| `changes` | always | classifies the diff into `docs_only`, `web`, `rust` and `lockfile`, and writes the four answers the other jobs read | `node scripts/ci-changes.mjs origin/main` |
| `conventions` | pull requests only | lints the pull-request **title** as a squash subject (a `[human]` or `(signed)` prefix from the paused fleet is stripped first) | `PR_TITLE='docs(ci): your title (A-11)' node orchestration/pr-mark.mjs --bare \| pnpm exec commitlint --verbose` |
| `fast` | not docs-only | `pnpm check`, typecheck, lint, unit tests, the desktop palette mutation check, the import-graph half of the bundle gate, the CommonMark spec, goldens, fidelity, licences | `pnpm check && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @marxy/desktop test:mutations && pnpm gate:bundle && pnpm gate:golden && pnpm gate:fidelity && pnpm gate:licences` |
| `browser-lite` | `web` changed, not a push to `main` | **two shards** (`browser-lite (1)`, `browser-lite (2)`; `ci` waits for the pair as one job). Shard 1 runs the no-network gate first. Each shard runs half of the desktop **lite** suite (`--test-shard=i/2` over the files named in `test:lite` in `apps/desktop/package.json`: the files that hold a commitment, which are save, explicit save, data loss, close guard, trust, live reload, operations edit, progressive rendering (its 1 MB first-text test), and the three that hold "nothing phones home": release CSP, remote images blocked, themes make no request) in WebKit, which is required, in the pinned Playwright container. The suite needs no C linker, because the Rust half of the images test is `#[test]`s run by `cargo test` (the `rust` job). Every other desktop browser file, and `progressive-large.test.mjs` (the 1 MB reading-position tests), is in `test` and runs nightly in `browser-full` | `pnpm gate:no-network && MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite`; one shard: `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite --test-shard=1/2` |
| `rust` | `rust` or `lockfile` changed, not a push to `main` | **macOS**: Rust format and clippy, the crate's unit tests (`cargo test --locked`, which needs no frontend build and no binary), then `cargo fetch --locked` and the licence gate over every crate in `Cargo.lock`. A lockfile-only change (an npm bump) runs only the last two | the block below |
| `ci` | always | the required check, above | `scripts/ci-verdict.mjs`, above |

A push to `main` runs `changes` and `fast` only: the pull request that produced it already ran the
rest. `fast` and `browser-lite` run `pnpm install --frozen-lockfile`; `rust` installs nothing from npm.
**A `pnpm-lock.yaml` that does not match `package.json` fails `fast` and `browser-lite` before a test
runs.**

The `rust` job, step by step. It needs a working Rust toolchain; on macOS that is all:

```bash
pnpm lint:rust
(cd apps/desktop/src-tauri && cargo test --locked --quiet)
(cd apps/desktop/src-tauri && cargo fetch --locked)
node scripts/gate-licences.mjs --require-registry
```

`cargo test` here runs without `--features tauri/custom-protocol`, so it embeds no frontend and needs no
`apps/desktop/dist`. The binary is built nightly (`startup-macos`, `rust-linux`), and a plain cargo build
of the app must pass that flag or the window never loads a page.

### What the pull-request path holds

Every commitment keeps a gate on the path (ADR-0056 has the table with its evidence):

| Commitment | Held on the pull-request path by |
| --- | --- |
| 1. Free | `gate:licences` and `check-deps` (`fast`); `gate-licences --require-registry` over `Cargo.lock` (`rust`) |
| 2. Private | `gate:no-network`, and the lite files `release-csp`, `images`, `user-theme` (`browser-lite`); the theme sanitiser's unit tests (`fast`) |
| 3. Faithful | `gate:fidelity`, `gate:golden`, the splice property (`fast`); the lite files `save`, `explicit-save`, `data-loss`, `save-trust-r4`, `save-close-r5`, `close-guard`, `operations-edit`, `live-reload` |
| 4. Nothing hidden silently | core's unit tests for bidi, zero-width, link targets and folds (`fast`) |
| 5. First text never waits | the 1 MB first-text test in `progressive.test.mjs` (`browser-lite`) |

What left the path went to `.github/workflows/nightly.yml`. A red nightly is a note for the next session,
not a blocked merge (ADR-0032, ADR-0047). The table in "Nightly" says what each one means.

## What decides which jobs run

`scripts/ci-changes.mjs` classifies the diff against its merge base; `scripts/ci-changes.test.mjs`
holds the cases. You cannot skip a job by hand.

- **`docs_only`**: prose under `docs/`, `orchestration/`, `.cursor/`, `.claude/` and `changelog.d/`, markdown
  outside `fixtures/`, and nothing else. Runs `changes`, `conventions` and `ci`; no product job. Some
  files are read by a test or check that `fast` runs, or are code, so they are not docs-only and run
  `fast`: `AGENTS.md`, `docs/{sdlc,hygiene,plan,ci-contract}.md`, `docs/plan/jira-issues.csv`,
  `.githooks/` and the fleet's code (`orchestration/*.mjs`, `*.js`, `*.json`, `*.sh`). The fleet's prose
  (`orchestration/README.md`, `orchestration/prompts/`, `docs/plan/tasks/`) is docs-only now that
  `test:fleet` no longer runs on a pull request. A markdown file under `.github/` is a workflow change.
- **`web`**: `packages/`, `apps/desktop/{src/,test/,index.html,app.html,gate.html,vite.config,package.json,scripts}`,
  `apps/desktop/src-tauri/tauri.conf.json` (the release CSP the privacy test reads), `fixtures/`, the root
  manifests, `mise.toml`, and under `scripts/` only the files the job runs or imports:
  `gate-no-network.mjs`, `playwright-webkit.mjs`, `perf-harness.mjs`, `check-csp.mjs` and
  `lib/{repo,plan}.mjs`. A change to any other script starts `fast` and nothing else.
  `ci-changes.test.mjs` walks the imports of the lite files and fails when one reaches a script this list misses.
- **`rust`**: `apps/desktop/src-tauri/` and `mise.toml`. Starts `rust`.
- **`lockfile`**: any `package.json`, `pnpm-lock.yaml` or `Cargo.lock`. Also starts `rust`, which then
  runs only the licence gate unless `rust` is set too.
- A change under **`.github/`** sets every category except `docs_only`, so a workflow change runs
  every job.

There is no `typography` or `fleet` category any more (G-03): the aesthetics and specimen gates and
`test:fleet` are nightly.

## Red CI, by cause

Each row names the check, what it means and the command that reproduces it. `pnpm check` runs the
eight hygiene checks together; each also runs alone as `node scripts/<name>.mjs`, or as
`pnpm check --only=<name>`.

### `conventions`

| Symptom | Cause | Fix and local command |
| --- | --- | --- |
| `marxy-ref-in-subject` | a trailing `(...)` that looks like a ref but is not `(MARXY-n)` or a story id like `(A-07)`; the ref itself is optional | rewrite the subject; a squash-appended ` (#nn)` after the ref is allowed |
| `type-enum` | a type outside the list | `feat fix perf refactor docs test build ci chore style revert` |
| `header-max-length` | title over 100 characters, ref included | shorten; aim for about 72 |
| `subject-full-stop` | the subject ends in a full stop | remove it |
| `footer-leading-blank` | no blank line before the footer (`Refs:`, `ADR:`) | add one |
| `body-leading-blank` | no blank line after the subject (a commit, not the title) | add one; a body is expected for `feat`, `fix`, `perf`, `refactor` |

A scope outside the list only **warns** (`scope-enum` is level 1): `core typeset theme shell desktop corpus gates ci docs orchestration release fonts repo workspace bootstrap spike`. So do body and footer lines over 100 characters.

Reproduce the title with the `conventions` row above; `pnpm lint:commits` lints every commit on
your branch against `origin/main` (CI does not run it, the commit hook does, and the rules are
the same). The rules are `commitlint.config.mjs`; `node commitlint.config.mjs --selftest` proves
them.

### `fast`

| Symptom | Cause | Fix and local command |
| --- | --- | --- |
| `check-boundaries` | a module crossed its boundary: core takes no DOM and no Node built-ins; `@tauri-apps` only under `apps/desktop/src/shell`; `shell-api` imports nothing; raw `invoke(` outside `src/shell` | `node scripts/check-boundaries.mjs` |
| `check-registry` | a new mark, event, data attribute, class or token name, or parsed markup reaching the DOM off the `innerHtmlAllowedIn` paths | add the name to `scripts/registry.json` first; `node scripts/check-registry.mjs` |
| `check-deps` | a dependency missing from the allowlist, unpinned, or forbidden | `scripts/allowlists/dependencies.json` with a pin, or do not add it; `node scripts/check-deps.mjs` |
| `check-deferrals` | a deferral marker in `apps/` or `packages/` names no `MARXY-nnn` key or roadmap story id (`A-07`, `B-13`, `A-14.1`), names one already merged, or is a stale allow-list row | name the story that removes it, or delete it; `node scripts/check-deferrals.mjs` |
| `check-one-parse` | a second markdown parser or sanitiser has returned, or a render path bypasses `@marxy/core` (ADR-0001, ADR-0021) | `node scripts/check-one-parse.mjs` |
| `check-tokens` | a `--marxy-*` token whose name or unit kind moved (values are taste, ADR-0031) | `node scripts/check-tokens.mjs` |
| `gate-font-attrs` | `.gitattributes` lost `binary` or gained `eol` on a font | font binaries are `binary -eol`; `node scripts/gate-font-attrs.mjs` |
| `check-workflows` | an Action not on the accepted list or not pinned to an accepted major; a cargo or `tauri build` call without `--locked`; `continue-on-error` or `\|\| true` in a step; a job with no `timeout-minutes`; a Linux cargo job that does not probe `glib-2.0` and install `dbus`; the licence gate running before a build or a `cargo fetch` | `node scripts/check-workflows.mjs`; its own cases: add `--selftest` |
| typecheck, lint | a type error, or a biome finding (`pnpm lint` is check-only and never writes a file) | `pnpm typecheck`, `pnpm lint` |
| unit tests | any `*.test.*`; or a file under `packages/*/src/contracts/` changed | `pnpm test` runs every package's tests and `scripts/*.test.mjs`. WebKit tests skip in `fast`, which has no browser. A contract changes by an ordinary pull request (ADR-0045); regenerate the goldens it moves |
| `test:mutations` | a palette test that no longer fails with `searchPrepared` switched off | `pnpm --filter @marxy/desktop test:mutations` |
| `gate:bundle` | the production JS reaches the memory shell or the harness (the import-graph half; the size half runs only in the release workflow) | `pnpm gate:bundle` |
| CommonMark step | the spec suite failed, or left the tree dirty | `node --experimental-strip-types packages/core/scripts/commonmark-spec.ts --selftest`; the full suite needs the cached spec file, see `ci.yml` |
| `gate:golden` | AST or source-map output moved | regenerate the goldens deliberately; `pnpm gate:golden` |
| `gate:fidelity` | a byte that was not asked to change, changed | fix the operation, never the test; `pnpm gate:fidelity` |
| `gate:licences` | a copyleft or undeterminable licence (ADR-0006) | `pnpm gate:licences` |

### `browser-lite`, `rust`

| Symptom | Cause | Fix and local command |
| --- | --- | --- |
| `gate:no-network` | something reached off the machine, or unsanitised markup reached the DOM (ADR-0009) | `pnpm gate:no-network` (both engines, against live controls) |
| desktop lite suite | a WebKit test failed, or WebKit was missing (`MARXY_BROWSER_TESTS_REQUIRED=1` turns a skip into a failure) | `pnpm exec playwright install webkit`, then `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite` (add `--test-shard=1/2` for the shard that failed) |
| `lint:rust` | `cargo fmt --check` or `clippy -D warnings`, on macOS | `pnpm lint:rust` |
| `cargo test` | a compile error, or a failing `#[test]` in `apps/desktop/src-tauri` (the images test's asset-scope cases are there); `Cargo.toml` changed without `Cargo.lock` (`cannot update the lock file`) | `cd apps/desktop/src-tauri && cargo test --locked`; `cargo check` there, then commit `Cargo.lock` |
| `gate:licences` over `Cargo.lock` | a crate with a copyleft or undeterminable licence (ADR-0006) | `cd apps/desktop/src-tauri && cargo fetch --locked`, then `node scripts/gate-licences.mjs --require-registry` |

### Nightly `aesthetics-determinism` and `startup-macos`, by cause

These no longer turn a pull request red (ADR-0056); a red one is a note for the next session. The causes and
local commands are the same as when they ran on pull requests.

| Symptom | Cause | Fix and local command |
| --- | --- | --- |
| `gate:aesthetics --mechanical` | a mechanical aesthetics check moved (`docs/aesthetics-acceptance.md`) | `node scripts/gate-aesthetics.mjs --mechanical`; never loosen a threshold; `--workers N` tunes speed |
| `gate:aesthetics` centred | the column's axis is off the visible area's axis | `node scripts/gate-aesthetics.mjs --mechanical --files <doc>.md`; the case names the cell |
| `gate:aesthetics` blockEdges | a top-level block's text does not start on the column's left edge | as above |
| `gate:aesthetics` room | a block box passes the column plus the room, or overhangs one side more than the other | as above |
| `gate:aesthetics` marks | a list marker or checkbox sits left of the gutter floor | as above |
| `gate:aesthetics` noClip | ink cut off by the window, a set line past its box after the relayout, or sideways scroll | as above |
| `gate:aesthetics` noticeColumn | a notice is off the column, out of view when scrolled, not a whole number of grid units high, or over Source text | as above |
| `gate:aesthetics` textSpacing, text200 | something clipped, overlapping or scrolling sideways with 1.4.12 text spacing or at 40 px text | as above |
| `gate:aesthetics` an expected failure | a case in `EXPECTED_FAILURES` now passes (delete its row), or a failing case has no row (fix the page, never add a row without the story that clears it) | `node scripts/gate-aesthetics.mjs --mechanical --emit-expected` |
| `gate:specimen` | a specimen render moved or made a network request | `pnpm gate:specimen` |
| CLI smoke | shell, paint or CLI path regressed | `pnpm --filter @marxy/desktop verify:cli` (sets `MARXY_SMOKE_REQUIRED=1`; needs the built binary, so set `MARXY_BIN`) |
| CLI smoke: `the launch never asked to quit; its last mark was …` | the webview reported its outcome, then stopped before it called `quit` (an IPC that never answered) | the named mark is where it stopped; the next awaited call after it in `app.ts` is the suspect. Each launch is its own process group and is killed whole, so one stall cannot poison the launches after it |
| CLI smoke: `… the process teardown stalled` | the app printed `MARK quit code=n` and did not exit | harness launches leave through `_exit(2)` after Tauri's teardown (`harness_exit` in `main.rs`); a stall here is in that teardown |

## Editing CI itself

The rules about how a workflow may be written live in one place: **`scripts/check-workflows.mjs`**,
run by `pnpm check` and therefore by `fast`. Change `ci.yml` or `nightly.yml` and you meet it. Two
tests guard the rest of CI's shape:

- `scripts/ci-changes.test.mjs` asserts which paths set which of the four outputs, and that every
  script the browser job runs or imports is covered by `web`.
- `scripts/ci-verdict.test.mjs` asserts what turns the `ci` job red.

Standing rules: every job carries `timeout-minutes`; the Playwright container tag equals the
`playwright` version pinned in `package.json` exactly, no caret; Linux jobs install the webview
libraries with plain `apt-get`, not a caching action (the action once dropped `glib-2.0.pc` and
turned `main` red); no `continue-on-error`, no `|| true`, no Playwright `retries`. A flaky test is
fixed or deleted, never re-run until green.

## Nightly: monitoring, never a pull-request check

`.github/workflows/nightly.yml` runs at 04:00 UTC and on `workflow_dispatch`. It is **monitoring**:
it cannot turn a pull request red, and **a red nightly is a note for the next session, not a blocked
merge** (ADR-0032, ADR-0046, ADR-0047, ADR-0056). Local commands are given where they exist. Everything
that left the pull-request path in G-03 is here; the last column says what a red one means.

| Job | What it watches | Local command | A red means |
| --- | --- | --- | --- |
| `aesthetics-determinism` | the aesthetics gate, mechanical checks and the screenshot and rag comparison against the baselines, with three CLS repeat passes against `main`; then the **specimen gate** (`pnpm gate:specimen`), which runs even when the aesthetics gate is red. Dispatched with `update_baselines` (`gh workflow run nightly.yml --ref <branch> -f update_baselines=true`), it first regenerates the Linux screenshot and rag baselines in the Playwright container, runs the gate against them, uploads them as the `linux-baselines` artifact, and skips every other job | `node scripts/gate-aesthetics.mjs --repeat 3 && pnpm gate:specimen`; on a Mac, `--update` writes only `webkit-macos` | a typographic check moved (grid, measure, contrast, layout shift, overflow) or a specimen render moved or made a request: a change reached `main` that the pull request no longer checks. Open the `nightly-results` artifact, find the commit, fix forward or revert |
| `browser-full` | the full desktop suite (including `progressive-large.test.mjs`, the 1 MB reading-position tests), and the theme, typeset and core suites, all with WebKit required | `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`, then each package's `test` | a WebKit test outside `test:lite` failed: selection, links, the index, persistence, open path, the 1 MB reading position. Behaviour worth fixing, not a commitment floor |
| `perf-harness` | the performance harness over the corpus and a 256 KB and a 1 MB document, recorded to `results/perf-nightly.json`; **numbers are recorded, not gated** (ADR-0032) | `pnpm --filter @marxy/desktop build:harness && pnpm perf --files corpus --large 256k,1m --reload --open-second --palette --record results/perf-nightly.json` | a requested measurement produced no sample; a slow one is a trend, not a red |
| `startup-macos` | the macOS build with the `ci` profile, its licence gate, the CLI smoke on the built binary, the Rust unit tests with the custom protocol, the nine-launch start-up measurement; then the pull-request `rust` job's own commands, whose purpose is to leave their compiled dependencies in the cache pull requests restore | `node scripts/measure-startup.mjs --selftest`, then `node scripts/measure-startup.mjs` with `MARXY_BIN` set | the shell, paint or CLI path regressed, or no launch printed a mark. This is where the CLI smoke lives now |
| `rust-linux` | the Linux build that left the pull-request path: webview libraries, the thin-LTO `ci`-profile binary, the licence gate over the populated cache, the CLI smoke, the Rust tests, the bundle gate | the block above with the Linux webview libraries (see the apt line in `nightly.yml`) | a Linux-only compile, clippy or runtime fault. Linux is a pre-release platform (ADR-0046): if the cause is Linux-only, delete the job rather than fix it until Linux is a release goal again |
| `built-app-smoke` | the release-built app through real IPC: `scripts/smoke-built-app.mjs` with `tauri-driver` and WebKitWebDriver on Ubuntu | below | the release binary does not start or answer IPC on Linux |
| `fleet` | `pnpm test:fleet` over the frozen orchestration code and the documents that name it | `pnpm test:fleet` | a live document names an orchestration file or `fleet.mjs` command that does not exist, or the frozen code moved; fix the document (`LIVE_DOCS` in `orchestration/docs.test.mjs`) |

Local repro for the built-app smoke, when the Linux stack is installed:

```bash
pnpm --filter @marxy/desktop build:web
cd apps/desktop/src-tauri && cargo build --release --features tauri/custom-protocol --locked
xvfb-run -a dbus-run-session -- env MARXY_SMOKE_BUILT_REQUIRED=1 node scripts/smoke-built-app.mjs
```

## What is deliberately not gated

Timing numbers are recorded and printed, never failed on, because a check that fails for the
machine it ran on cannot be told from a regression. A missing or dishonest measurement is a
failure; a slow one is not. Comparison against the screenshot and rag baselines is nightly, not
on the pull-request path (ADR-0047).

**Nothing retries silently.** A step wrapped in `|| echo` is a step whose failure nobody has read;
that mistake once hid a broken check through every pull request the repository had run.

## Local escape hatch

`MARXY_SKIP_HOOKS=1 git commit …` bypasses the pre-commit and commit-msg hooks for a person in a
hurry. **CI has no bypass**, and what the hooks check runs again there.
