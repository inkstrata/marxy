# Hygiene and tooling — for an engine of weak agents

Everything here exists because a fast model will do the wrong thing unless the wrong thing is
impossible. Each tool answers one failure mode, prints a `fix:` line when it fails, and runs in
three places: the pre-commit hook (staged files, under two seconds), `pnpm precheck` (the
branch, before a PR), and CI (the merge).

## The workflow, as commands

```
pnpm new module core buffer            # start a unit in the house shape (also: operation, command)
…implement…
pnpm precheck                          # typecheck/lint/test for what you touched + the gates your paths need
pnpm done MARXY-nn                     # boundary over the whole branch, precheck, a drafted PR body, the result file
…fill the TODOs in results/MARXY-nn.pr.md…
node scripts/open-pr.mjs MARXY-nn      # check-pr on that file, then gh pr create --body-file; never --body
```

If `pnpm done` is green and `open-pr` is green, the reviewer only has judgement left to do. `gh pr create --body` is how the house template gets replaced by Summary / Why / Test plan; the wrapper will not do that.

## Local precheck vs the real app

`pnpm precheck` and `pnpm test` launch Playwright through `scripts/playwright-webkit.mjs`, which is
headless unless `MARXY_BROWSER_HEADED=1` — browser tests, `gate:aesthetics` and the two engines of
`gate:no-network` all go through it. They do not open the marxy desktop window. A local
`pnpm --filter @marxy/desktop build` still runs `smoke-cli-open.mjs` after the binary is built.
Before merge when you changed shell, paint, or CLI paths, run
`pnpm --filter @marxy/desktop verify:cli` — the same required smoke CI runs on the gates job.

## What is enforced, and by which tool

| Failure mode | Tool | When |
| --- | --- | --- |
| Editing outside the story's paths | `scripts/check-story.mjs` (reads the key from the branch name and the paths from the CSV) | pre-commit (staged), `done`, CI |
| Changing a frozen contract without an ADR | `check-story` | pre-commit, CI |
| Committing a secret, a credential file, a build artefact, an attribution line | `check-story` | pre-commit, CI |
| Importing across a module boundary (Node in the browser, DOM in core, Tauri outside `src/shell`, forbidden packages) | `scripts/check-boundaries.mjs` | precheck, CI |
| Inventing a mark, event, data attribute, class or token name | `scripts/check-registry.mjs` against `scripts/registry.json` | pre-commit, precheck, CI |
| Adding a dependency that is not pinned or is forbidden | `scripts/check-deps.mjs` against `scripts/allowlists/dependencies.json` | precheck, CI |
| A dependency with the wrong licence | `scripts/gate-licences.mjs` | precheck (when manifests change), CI |
| A PR whose body is out of order, uses Why / Test plan instead of the house sections, has an empty or TODO acceptance table, carries an attribution line, lacks a changelog line, or changes baselines without a queue row | `scripts/check-pr.mjs` | `done`, `open-pr`, CI |
| Opening a PR with a body that would fail `check-pr` (or with `gh pr create --body`) | `scripts/open-pr.mjs` | after `done`, before the PR exists |
| A commit message off convention or carrying a trailer | `.githooks/commit-msg` (commitlint + strip) | commit |
| Skipping the gates that a change needs | `scripts/precheck.mjs` with `scripts/gates-by-path.json` | before the PR, CI runs all |
| A task card and its CSV row disagree (missing row, Paths miss a card file, a `deps.json` key has no row, or `depends:` ≠ `deps.json`) | `scripts/check-cards.mjs` | precheck |
| A result file that omits which test checks which criterion | `orchestration/schema/result.schema.json`, validated in `review.mjs` | review |
| Rust formatting and warnings | `pnpm lint:rust` (`cargo fmt --check`, `clippy -D warnings`) | precheck (when `src-tauri` changes), CI |
| Starting a module, operation or command in a random shape | `pnpm new …` generators | at the start |

The 600-line branch-diff budget in `orchestration/phases.test.mjs` counts insertions in source, scripts, orchestration code and workflows — the lines a reviewer has to hold — and excludes `docs/plan/`, `orchestration/deps.json`, `orchestration/jira-map.json`, `orchestration/results/` and `CHANGELOG.md`, because `docs/conventions.md`'s over-600-lines rule is about that work, not about how verbose the board is.

## Rules the tools encode (so nobody re-derives them)

- A story's task card (`docs/plan/tasks/KEY.md`) and its CSV row are one spec: write them
  together or not at all. `scripts/check-cards.mjs` enforces that every card has a row, every
  `## Files and signatures` path (first backtick per bullet, skipping tokens with no `/` or `.`)
  is covered by the row's Paths under the same rule as `check-story`, every key in
  `orchestration/deps.json` has a row, and each card's `depends:` front matter matches
  `deps.json`.
- The story key comes from the branch: `type/MARXY-nn-slug`. No key, no path check (and a
  note); `--strict` makes that a failure in CI once every branch is a story branch.
- Allowed outside a story's paths: `CHANGELOG.md`, `docs/taste-review/queue.md`, lockfiles,
  the story's own task card and result file, and plan deltas.
- Frozen: byte-pinned contracts under `packages/*/src/contracts/` and `packages/shell-api/src/`, name-and-unit contract for `packages/theme/src/tokens.css`.
- Large-file limit 2 MB, except under `fonts/`, `fixtures/`, `docs/spike/results/`,
  `docs/taste-review/`, the app icons.
- Parsed markup may enter the DOM only on paths in `innerHtmlAllowedIn`
  (`scripts/registry.json`): `check-registry.mjs` matches every route (`.innerHTML =`,
  bracket assignment, `Reflect.set(…, 'innerHTML', …)`, `.outerHTML =`, `.insertAdjacentHTML`,
  `.setHTMLUnsafe`, `document.write`, `.createContextualFragment`), not a single regex an
  implementor can walk around. A gate is satisfied, never routed around; a check pinned to a
  source path moves with that code in the same PR.
- Names: `scripts/registry.json` is the source; `docs/design/README.md` mirrors it for reading.

## Writing a gate or check

Print one `✗ <what> ` line per problem followed by `    fix: <the exact thing to do>`, and one
`… ok (<count>)` line on success. Exit 1 on any problem. Never print a stack trace for an
expected failure. A check must be able to fail: the PR that adds it shows one failing run.

## Skipping

`MARXY_SKIP_HOOKS=1 git commit …` bypasses the local hooks for a person in a hurry. CI does not
have a bypass.

## CI — shape, time budget, and what is required

Measured before this shape landed: 6–10 minutes per pull request, dominated by a from-scratch
Tauri release build (180–270 s), a Linux startup measurement that waited out timeouts
(up to 135 s), and browser and apt installs (40–80 s); two `main` pushes went red on
runner-noise perf breaches and a timing assertion inside a unit test.

| Job | Runs when | What | Measured (run 35369360214, warm caches) |
| --- | --- | --- | --- |
| `changes` | always | classifies the diff: docs-only / web / rust | 5 s |
| `conventions` | pull requests | commitlint on commits and title, `check-pr`, story boundary | 24 s |
| `fast` | not docs-only | hygiene checks, typecheck, lint, unit tests, goldens, fidelity, licences | 51 s |
| `browser` | web changed | no-network and aesthetics gates in the Playwright image (browsers preinstalled) | 445 s → **165 s** (MARXY-153) |
| `gates` (macOS) | not docs-only | frontend, `cargo build --profile ci` with `rust-cache` (67 s), CLI smoke (13 s), nine-launch startup measurement (36 s), perf gate, bundle gate | 167 s |
| `gates` (Ubuntu) | not docs-only | the same plus Rust fmt/clippy (52 s); build 111 s, smoke 17 s, measurement 31 s | 261 s |
| `ci` | always | the single required check; fails if any job that ran failed | 3 s |

**Wall time 277 s** for a code change with warm caches (was 6–10 minutes); the critical path is
the Ubuntu build-and-measure job. A docs-only change runs `changes`, `conventions` and `ci`.

### What the numbers drifted to, and what MARXY-153 cut

By run 35499870306 the table above was stale in one place that mattered: `browser` had grown to
445 s and was the critical path, three times the Ubuntu build it was written to sit behind. All of
the growth was one step — `gate:aesthetics` at 356 s — and it broke down as two separate problems.

- **Three quarters of it was a flake detector.** The gate's CLS repeat pass re-rendered the whole
  corpus three more times (19 files × 12 combos × 3 = 684 extra renders, ~266 s) to check that the
  font/image window it *already measures once per combo in the main pass* came out the same each
  time. Re-running work to see whether the answer changes cannot fail for anything the diff under
  review introduced, so it is not a gate on a pull request; it is monitoring. It now runs in
  `.github/workflows/nightly.yml` as `gate-aesthetics.mjs --repeat 3`, against `main`, once a day.
  Nothing implies `--repeat` any longer — an omitted flag means zero passes on CI as locally.
- **The rest was serial.** The 228 remaining renders each opened a page, rendered and closed, one
  at a time, at 16% CPU. Nothing in the checks is wall-clock — CLS snapshots are taken after
  `document.fonts.ready` and rAF pairs, rag and grid read geometry, screenshots rasterise
  deterministically — so contention can delay a pass but cannot change its verdict, and the matrix
  now runs `min(4, cpus)` pages at a time (`--workers N`, or `MARXY_AESTHETICS_WORKERS`). Measured
  locally on the same corpus and matrix, same verdict: **60.5 s → 17.3 s**.

Measured on CI, run 35501272193 against run 35499870306: **`gate:aesthetics` 356 s → 81 s**
(4.4×), and the `browser` job 445 s → 165 s, of which 60 s is now fixed setup (container, mise,
install) rather than work. Locally, same corpus and verdict, 60.5 s → 17.3 s. The CI figure is
below 4× rather than at it because a standard runner shares four vCPUs with the container.

The matrix itself is untouched: same 19 files, same 12 combos, same ten page checks, same
thresholds. The gate asserts exactly what it asserted before, and MARXY-143's repeat signal is
kept rather than dropped — `apps/desktop/test/layout-shift-window.test.mjs` pins both halves, so
deleting the nightly run fails the suite.

Also fixed here: the `conventions` job ran `check-story.mjs --strict || echo "::warning::"`, which
made it a step that could not fail. Its comment blamed CSV rows — "advisory until every story has a
CSV row" — but that was not the reason, and removing the guard on its own turned the step red on
this very pull request. The real cause is that a pull-request checkout is **detached**:
`git rev-parse --abbrev-ref HEAD` answers `HEAD`, `storyKey()` could read no key from it, and
`--strict` failed with "no story key in the branch name" on every pull request ever run. The step
could not pass, so it was wrapped rather than fixed. `branchName()` now falls back to
`GITHUB_HEAD_REF` (pull request) and `GITHUB_REF_NAME` (push) when the checkout is detached, a real
local branch still wins over both, and the step runs unguarded.

The general lesson is worth more than the fix: **a check wrapped in `|| true` or `|| echo` is a
check whose failure nobody has read.** This one had been green-by-construction long enough that its
comment described a cause that was never the cause.

### The rule, and everything it removed

**A check earns its place on the pull-request path by being able to fail for something in the
diff.** A check that fails for the machine it ran on is not a gate, it is a coin flip with a
changelog. Monitoring goes nightly; a step that cannot fail gets deleted or made real.

Applied across the repository, that rule removed six things (MARXY-153). None of them cost any
correctness coverage — every one was a wall-clock or network number standing in for a property
that is either asserted elsewhere or not asserted at all.

| Was | Why it could not stay | Now |
| --- | --- | --- |
| `gate-aesthetics` CLS repeat, 3 whole-corpus passes | re-runs identical work and compares; can only fail for the environment | nightly `--repeat 3` |
| `gate-perf` `cold_warm_ratio < 1` hard fail | the gates job runs the CLI smoke check on the same binary seconds earlier, so launch 1 is never cold; cold and warm differ by noise and the gate failed on which side of 1.0 the noise landed | recorded; fails only below 0.8, which is a broken record rather than noise |
| `sanitize/budget.test.ts` `ms < 150` | an absolute ceiling cannot tell a regression from a busy runner | printed; the linearity ratio beside it is the real assertion and keeps the 122× quadratic caught |
| `index-model/build-perf.test.ts` `elapsed < 2000` | same, on a test that also creates 20,000 files | printed; the correctness assertions (every file, no `node_modules`, no notice) stay |
| `ci-changes --selftest` asserting the diff never touches `scripts/gate-perf.mjs` | MARXY-105's own acceptance criterion 5, left in a shared script where it forbade *every* later pull request from touching that file; it cannot fail for a defect, and story boundaries belong to `check-story.mjs` and a story's declared paths | removed |
| `curl` of the CommonMark spec on every pull request | a red build because `spec.commonmark.org` was slow has nothing to do with the diff | fetched once and cached on the script's hash; the suite itself is unchanged |

Two of these — the perf breach and the timing assertion inside a unit test — are the same two
failures named at the top of this section as having turned `main` red before. They were treated as
bad luck at the time. They were a category.

What deliberately stayed: the sanitiser's **ratio** test (two timings on one machine, so machine
speed cancels and algorithmic shape is what is left), `gate:bundle` (a byte count, not a duration),
and every measurement that is recorded and printed. ADR-0032 already held that no speed number
fails the build; this finishes applying it.

Rules baked in:

- **One required check.** Branch protection requires `ci` only, so job names can change without
  touching repository settings. The working command is PATCH, not PUT (this endpoint answers
  `PUT` with a 404); `-F` sends `strict` as a boolean rather than a string:
  `gh api -X PATCH repos/inkstrata/marxy/branches/main/protection/required_status_checks -F strict=true -f 'contexts[]=ci'`.
- **Every job has `timeout-minutes`.** A hang costs minutes, never hours.
- **Docs-only changes** (`docs/`, `orchestration/`, `.cursor/`, markdown outside `fixtures/`)
  run `changes`, `conventions` and `ci` only: under two minutes.
- **Caches:** mise tools, the pnpm store keyed on the lockfile, cargo via `Swatinem/rust-cache`
  keyed on `Cargo.lock` and the `ci` profile, apt packages via `cache-apt-pkgs-action`. Browser
  binaries come with the `mcr.microsoft.com/playwright` image whose tag must equal the pinned
  `playwright` version in `package.json` (exact, no caret).
- **The CI Cargo profile** (`[profile.ci]`, thin LTO, 16 codegen units) is what CI measures;
  tags and `pnpm bundle` use `release`. CI calls cargo directly and must pass
  `--features tauri/custom-protocol`, the production switch `tauri build` sets implicitly;
  without it the app loads the dev server URL and never paints. `MARXY_BIN` tells the measurer
  and the smoke check which binary to launch.
- **Perf on shared runners is noisy by nature.** Timing numbers are recorded and printed;
  they are not CI failures (ADR-0032). The gate still fails if the measurement is missing or
  dishonest. `scripts/gate-perf.mjs --selftest` asserts the workflow keeps the measurement
  unconditional on both runner classes with no `continue-on-error` — keep that shape when
  editing the `gates` job.
- **Nothing retries silently.** No `retries` in Playwright, no `|| true`; a flaky test is fixed
  or deleted, never re-run until green.
