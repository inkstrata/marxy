# The CI contract — everything that can turn a pull request red

In short: a pull request goes red for one of seven reasons, one per job in
`.github/workflows/ci.yml`, and each has a command that reproduces it on your machine. Nothing
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
(`scripts/ci-verdict.mjs`) that fails if `changes` did not answer all six of its questions, or if
any other job it waits for ended in anything but `success` or `skipped`. A skipped job is fine,
so a job can be renamed without touching repository settings. Run the same verdict locally
against a hand-written `needs`:

```bash
NEEDS='{"changes":{"result":"success","outputs":{"docs_only":"false","web":"true","typography":"false","rust":"false","fleet":"false","lockfile":"false"}},"fast":{"result":"failure"}}' node scripts/ci-verdict.mjs
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
pnpm check         # the nine hygiene checks in one command (the first thing `fast` runs)
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
  packages), whereas `fast` runs them on every pull request.
- `test:fleet` runs only for `orchestration/` changes; `fast` runs it when the fleet changed, and it
  leaves the pull-request path in G-03.
- The CommonMark spec suite itself (the download-and-compare step); only the selftest runs.

`pnpm precheck --all` closes most of that gap (it does not run the fleet tests or the CommonMark spec suite).

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
| `changes` | always | classifies the diff into `docs_only`, `web`, `typography`, `rust`, `fleet` and `lockfile`, and writes the six answers the other jobs read | `node scripts/ci-changes.mjs origin/main` |
| `conventions` | pull requests only | lints the pull-request **title** as a squash subject (a `[human]` or `(signed)` prefix from the paused fleet is stripped first) | `PR_TITLE='docs(ci): your title (A-11)' node orchestration/pr-mark.mjs --bare \| pnpm exec commitlint --verbose` |
| `fast` | not docs-only | `pnpm check`, typecheck, lint, unit tests, the desktop palette mutation check, the import-graph half of the bundle gate, `pnpm test:fleet` when `fleet`, the CommonMark spec, goldens, fidelity, licences | `pnpm check && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @marxy/desktop test:mutations && pnpm gate:bundle && pnpm test:fleet && pnpm gate:golden && pnpm gate:fidelity && pnpm gate:licences` |
| `browser-lite` | `web` changed, not a push to `main` | the no-network gate, then the desktop **lite** suite (the files named in `test:lite` in `apps/desktop/package.json`: the files that hold a commitment, which are save, explicit save, data loss, close guard, trust, live reload, operations edit, progressive rendering (its 1 MB first-text test), and the three that hold "nothing phones home": release CSP, remote images blocked, themes make no request) in WebKit, which is required, in the pinned Playwright container; the suite needs no C linker, because the Rust half of the images test is `#[test]`s run by `cargo test` (the `rust` job); about three minutes of test time. Every other desktop browser file, and `progressive-large.test.mjs` (the 1 MB reading-position tests), is in `test` and runs nightly in `browser-full` | `pnpm gate:no-network && MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite` |
| `typography` | `typography` or `lockfile` changed, not a push to `main` | the **mechanical** half of the aesthetics gate, and the specimen gate, in the Playwright container | `node scripts/gate-aesthetics.mjs --mechanical && pnpm gate:specimen` |
| `rust` | `rust` or `lockfile` changed, not a push to `main` | Ubuntu only: Rust format and clippy, the frontend, `cargo build --profile ci`, the licence gate over the populated cargo cache, the CLI smoke on the built binary, Rust unit tests, the bundle gate | the block below |
| `ci` | always | the required check, above | `scripts/ci-verdict.mjs`, above |

A push to `main` runs `changes` and `fast` only: the pull request that produced it already ran the
rest. `fast`, `browser-lite`, `typography` and `rust` all run `pnpm install --frozen-lockfile`. **A
`pnpm-lock.yaml` that does not match `package.json` fails every one of them before a test runs.**

The `rust` job, step by step. It needs the Linux webview libraries (see the apt line in `ci.yml`),
or a working Tauri toolchain on macOS:

```bash
pnpm lint:rust
pnpm --filter @marxy/desktop build:web
(cd apps/desktop/src-tauri && cargo build --locked --profile ci --features tauri/custom-protocol)
node scripts/gate-licences.mjs --require-registry
MARXY_BIN="$PWD/apps/desktop/src-tauri/target/ci/marxy" pnpm --filter @marxy/desktop verify:cli
(cd apps/desktop/src-tauri && cargo test --locked --profile ci --features tauri/custom-protocol --quiet)
pnpm gate:bundle
```

Without `--features tauri/custom-protocol` the binary loads the dev-server URL and the window
never paints: CI calls cargo directly and must pass the flag that `tauri build` sets for you.

## What decides which jobs run

`scripts/ci-changes.mjs` classifies the diff against its merge base; `scripts/ci-changes.test.mjs`
holds the cases. You cannot skip a job by hand.

- **`docs_only`**: prose under `docs/`, `orchestration/`, `.cursor/`, markdown outside `fixtures/`,
  and nothing else. Runs `changes`, `conventions` and `ci`; no product job. Some prose is read by a
  test, so it is not docs-only: `AGENTS.md`, `docs/{sdlc,hygiene,plan,ci-contract}.md`,
  `orchestration/README.md`, `orchestration/prompts/`, `.githooks/` and `docs/plan/tasks/` run
  `fast` and `test:fleet`, which is how `orchestration/docs.test.mjs` can fail a documents-only
  change. A markdown file under `.github/` is a workflow change.
- **`web`**: `packages/`, `apps/desktop/{src/,test/,index.html,app.html,vite.config,package.json,scripts}`,
  `fixtures/`, `scripts/`, the root manifests, `mise.toml`. Starts `browser-lite`.
- **`typography`**: what the aesthetics and specimen gates render: the theme, the typesetter, the
  parse, render and sanitise path in core, the render, font, theme and selection modules of the
  app, `fixtures/`, `fonts/`, the gates' own scripts. Starts `typography`.
- **`rust`**: `apps/desktop/src-tauri/`, the Vite config, the CLI smoke, `mise.toml`. Starts `rust`.
- **`fleet`**: `orchestration/`, `scripts/`, `commitlint.config.mjs`, and the prose above. Adds
  `pnpm test:fleet` to `fast`.
- **`lockfile`**: any `package.json`, `pnpm-lock.yaml` or `Cargo.lock`. Also starts `typography`
  and `rust`.
- A change under **`.github/`** sets every category except `docs_only`, so a workflow change runs
  every job.

## Red CI, by cause

Each row names the check, what it means and the command that reproduces it. `pnpm check` runs the
nine hygiene checks together; each also runs alone as `node scripts/<name>.mjs`, or as
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
| `gate-contrast` | a bundled theme's colour pair is below its ADR-0059 item 10 floor (7:1 body text, 4.5:1 other text, 3:1 edges), measured unrounded after compositing; or a colour will not parse | change the colour in a taste story, never the floor; `node scripts/gate-contrast.mjs`, `--md` for every ratio |
| `check-workflows` | an Action not on the accepted list or not pinned to an accepted major; a cargo or `tauri build` call without `--locked`; `continue-on-error` or `\|\| true` in a step; a job with no `timeout-minutes`; a Linux cargo job that does not probe `glib-2.0` and install `dbus`; the licence gate running before a build | `node scripts/check-workflows.mjs`; its own cases: add `--selftest` |
| typecheck, lint | a type error, or a biome finding (`pnpm lint` is check-only and never writes a file) | `pnpm typecheck`, `pnpm lint` |
| unit tests | any `*.test.*`; or a file under `packages/*/src/contracts/` changed | `pnpm test` runs every package's tests and `scripts/*.test.mjs`. WebKit tests skip in `fast`, which has no browser. A contract changes by an ordinary pull request (ADR-0045); regenerate the goldens it moves |
| `test:mutations` | a palette test that no longer fails with `searchPrepared` switched off | `pnpm --filter @marxy/desktop test:mutations` |
| `gate:bundle` | the production JS reaches the memory shell or the harness (the import-graph half; the size half runs only in the release workflow) | `pnpm gate:bundle` |
| `test:fleet` | the frozen orchestration code or a live document naming an orchestration file or `fleet.mjs` command that does not exist | `pnpm test:fleet`; fix the document in the same pull request; the live list is `LIVE_DOCS` in `orchestration/docs.test.mjs` |
| CommonMark step | the spec suite failed, or left the tree dirty | `node --experimental-strip-types packages/core/scripts/commonmark-spec.ts --selftest`; the full suite needs the cached spec file, see `ci.yml` |
| `gate:golden` | AST or source-map output moved | regenerate the goldens deliberately; `pnpm gate:golden` |
| `gate:fidelity` | a byte that was not asked to change, changed | fix the operation, never the test; `pnpm gate:fidelity` |
| `gate:licences` | a copyleft or undeterminable licence (ADR-0006) | `pnpm gate:licences` |

### `browser-lite`, `typography`, `rust`

| Symptom | Cause | Fix and local command |
| --- | --- | --- |
| `gate:no-network` | something reached off the machine, or unsanitised markup reached the DOM (ADR-0009) | `pnpm gate:no-network` (both engines, against live controls) |
| desktop lite suite | a WebKit test failed, or WebKit was missing (`MARXY_BROWSER_TESTS_REQUIRED=1` turns a skip into a failure) | `pnpm exec playwright install webkit`, then `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite` |
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
| `lint:rust` | `cargo fmt --check` or `clippy -D warnings` | `pnpm lint:rust` |
| Rust build or `cargo test` | a compile error, or a failing `#[test]` in `apps/desktop/src-tauri`; `Cargo.toml` changed without `Cargo.lock` (`cannot update the lock file`) | the `rust` block above; `cargo check` in `src-tauri`, then commit `Cargo.lock` |
| CLI smoke | shell, paint or CLI path regressed | `pnpm --filter @marxy/desktop verify:cli` (sets `MARXY_SMOKE_REQUIRED=1`; needs the built binary, so set `MARXY_BIN`) |
| CLI smoke: `the launch never asked to quit; its last mark was …` | the webview reported its outcome, then stopped before it called `quit` (an IPC that never answered) | the named mark is where it stopped; the next awaited call after it in `app.ts` is the suspect. Each launch is its own process group and is killed whole, so one stall cannot poison the launches after it |
| CLI smoke: `… the process teardown stalled` | the app printed `MARK quit code=n` and did not exit | harness launches leave through `_exit(2)` after Tauri's teardown (`harness_exit` in `main.rs`); a stall here is in that teardown |

## Editing CI itself

The rules about how a workflow may be written live in one place: **`scripts/check-workflows.mjs`**,
run by `pnpm check` and therefore by `fast`. Change `ci.yml` or `nightly.yml` and you meet it. Two
tests guard the rest of CI's shape:

- `scripts/ci-changes.test.mjs` asserts which paths set which of the six outputs, and that every
  module the aesthetics render loads is covered by `typography`.
- `scripts/ci-verdict.test.mjs` asserts what turns the `ci` job red.

Standing rules: every job carries `timeout-minutes`; the Playwright container tag equals the
`playwright` version pinned in `package.json` exactly, no caret; Linux jobs install the webview
libraries with plain `apt-get`, not a caching action (the action once dropped `glib-2.0.pc` and
turned `main` red); no `continue-on-error`, no `|| true`, no Playwright `retries`. A flaky test is
fixed or deleted, never re-run until green.

## Nightly: monitoring, never a pull-request check

`.github/workflows/nightly.yml` runs at 04:00 UTC and on `workflow_dispatch`. It is **monitoring**:
it cannot turn a pull request red, and a red nightly is a note for the next person to read
(ADR-0032, ADR-0046, ADR-0047). Local commands are given where they exist.

| Job | What it watches | Local command |
| --- | --- | --- |
| `aesthetics-determinism` | the aesthetics gate with three CLS repeat passes against `main`. Dispatched with `update_baselines` (`gh workflow run nightly.yml --ref <branch> -f update_baselines=true`), it first regenerates the Linux screenshot and rag baselines in the Playwright container, runs the gate against them, uploads them as the `linux-baselines` artifact, and skips every other job | `node scripts/gate-aesthetics.mjs --repeat 3`; on a Mac, `--update` writes only `webkit-macos` |
| `browser-full` | the full desktop suite, and the theme, typeset and core suites, all with WebKit required | `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`, then each package's `test` |
| `perf-harness` | the performance harness over the corpus and a 256 KB and a 1 MB document, recorded to `results/perf-nightly.json`; **numbers are recorded, not gated** (ADR-0032) | `pnpm --filter @marxy/desktop build:harness && pnpm perf --files corpus --large 256k,1m --reload --open-second --palette --record results/perf-nightly.json` |
| `startup-macos` | the macOS build, CLI smoke, Rust unit tests and the nine-launch start-up measurement | `node scripts/measure-startup.mjs --selftest`, then `node scripts/measure-startup.mjs` with `MARXY_BIN` set |
| `rust-linux` | the Linux Rust job again, with nightly caches | the `rust` block above |
| `built-app-smoke` | the release-built app through real IPC: `scripts/smoke-built-app.mjs` with `tauri-driver` and WebKitWebDriver on Ubuntu | below |
| `fleet` | `pnpm test:fleet` over the frozen orchestration code | `pnpm test:fleet` |

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
