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
pnpm check                             # the eight hygiene checks, in one command
gh pr create --body-file FILE          # the template in .github/pull_request_template.md; never --body
```

Since ADR-0051 (the fleet is paused) that is the whole path: a Conventional Commits subject, a
changelog fragment `changelog.d/<id>.md`, green product gates and one review. `pnpm done KEY`,
`node scripts/open-pr.mjs KEY`, `node scripts/check-pr.mjs`, `node scripts/check-story.mjs --strict`
and `node orchestration/out-of-plan.mjs` belong to the fleet's board-and-key process; they still
work, they expect a `MARXY-nnn` key and a board row, and **nothing requires them**. CI runs none of
them. pnpm's pre and post hooks are off (`enablePrePostScripts: false` in `pnpm-workspace.yaml`),
so `pnpm check` runs exactly the eight checks and `pnpm precheck` runs `pnpm check` as one of its
gates; neither triggers the other.

## Local precheck vs the real app

`pnpm precheck` and `pnpm test` launch Playwright through `scripts/playwright-webkit.mjs`, which is
headless unless `MARXY_BROWSER_HEADED=1` — browser tests, `gate:aesthetics` and the two engines of
`gate:no-network` all go through it. They do not open the Marxy desktop window. A local
`pnpm --filter @marxy/desktop build` still runs `smoke-cli-open.mjs` after the binary is built.
Before merge when you changed shell, paint, or CLI paths, run
`pnpm --filter @marxy/desktop verify:cli` — the same required smoke CI runs in the `rust` job.

## What is enforced, and by which tool

`pnpm check` (`scripts/check.mjs`) is the one command for the hygiene scripts; a check is added to
its `CHECKS` list and nowhere else. The commit hooks run the staged-file subset.

| Failure mode | Tool | When |
| --- | --- | --- |
| Importing across a module boundary (Node in the browser, DOM in core, Tauri outside `src/shell`, forbidden packages) | `check-boundaries` | `pnpm check`, CI `fast` |
| Inventing a mark, event, data attribute, class or token name; parsed markup reaching the DOM off-path | `check-registry` against `scripts/registry.json` | pre-commit (staged), `pnpm check`, CI `fast` |
| Adding a dependency that is not pinned or is forbidden | `check-deps` against `scripts/allowlists/dependencies.json` | `pnpm check`, CI `fast` |
| A deferral comment in product source that names no `MARXY-nnn` key or roadmap story id (`A-07`, `B-13`, `A-14.1`), or names one already merged | `check-deferrals` with `scripts/allowlists/deferrals.json` | `pnpm check`, CI `fast` |
| A second markdown parser or sanitiser returning (ADR-0001, ADR-0021) | `check-one-parse` | `pnpm check`, CI `fast` |
| A theme token whose name or unit kind moved | `check-tokens` | `pnpm check`, CI `fast` |
| A font binary losing `binary` or gaining `eol` | `gate-font-attrs` | `pnpm check`, CI `fast` |
| A workflow that is advisory, unpinned, unlocked, untimed or missing its Linux prerequisites | `check-workflows` (the one place workflow rules live) | `pnpm check`, CI `fast` |
| A frozen contract changed without a pull request of its own (ADR-0045) | `pnpm test:contracts-frozen`, inside `pnpm test` | `pnpm test`, CI `fast` |
| A dependency with the wrong licence | `scripts/gate-licences.mjs` | precheck (when manifests change), CI `fast` and `rust` |
| A byte the user did not ask to change, changed | `pnpm gate:fidelity`; `pnpm gate:golden` for AST and source map | precheck (core), CI `fast` |
| Production JS reaching the memory shell or the harness | `pnpm gate:bundle` (the import graph; sizes only in the release workflow) | precheck (desktop), CI `fast` and `rust` |
| Something reaching the network | `pnpm gate:no-network` | precheck, CI `browser-lite` |
| A broken save, trust, close, reload, open, selection, persistence or index path in a real WebKit | the desktop lite suite, `pnpm --filter @marxy/desktop test:lite` | CI `browser-lite`; the full suite and `test:mutations` nightly |
| A mechanical aesthetics regression (the page checks, not the baselines) | `node scripts/gate-aesthetics.mjs --mechanical`, with `pnpm gate:specimen` | precheck (theme, typeset), CI `typography`; baseline comparison nightly (ADR-0047) |
| Rust formatting and warnings | `pnpm lint:rust` | precheck (`src-tauri`), CI `rust` |
| A commit message off convention or carrying an attribution trailer | `.githooks/commit-msg` (commitlint plus a trailer strip) | commit |
| A pull-request title that would not be a valid squash subject | `commitlint` over the title, through `orchestration/pr-mark.mjs --bare` | CI `conventions` |
| A live document naming an orchestration file or `fleet.mjs` command that is not there | `orchestration/docs.test.mjs`, in `pnpm test:fleet` | CI `fast` when `fleet` changed, nightly `fleet` |
| Skipping the gates a change needs | `scripts/precheck.mjs` with `scripts/gates-by-path.json` | before the pull request |
| Starting a module, operation or command in a random shape | `pnpm new …` generators | at the start |

Fleet-era tools, optional now: `scripts/check-story.mjs` (a story's paths from the board; the commit
hook runs it on staged files and, with no `MARXY-nnn` in the branch name, only prints a note),
`scripts/check-pr.mjs`, `scripts/open-pr.mjs`, `scripts/done.mjs`, `scripts/check-cards.mjs` (task
cards against the board; precheck runs it) and everything under `orchestration/`, whose own tests
run as `pnpm test:fleet`.

## Rules the tools encode (so nobody re-derives them)

- Branches are `type/<id>-slug` (`docs/conventions.md`); the story id or Jira key in the branch and
  the subject is optional. A branch with a key but no board row is a note, not a failure.
- Frozen: byte-pinned contracts under `packages/*/src/contracts/` and `packages/shell-api/src/`, name-and-unit contract for `packages/theme/src/tokens.css`.
- Large-file limit 2 MB, except under `fonts/`, `fixtures/`, `docs/spike/results/`,
  `docs/taste-review/`, the app icons.
- Parsed markup may enter the DOM only on paths in `innerHtmlAllowedIn`
  (`scripts/registry.json`): `check-registry` matches every route (`.innerHTML =`,
  bracket assignment, `Reflect.set(…, 'innerHTML', …)`, `.outerHTML =`, `.insertAdjacentHTML`,
  `.setHTMLUnsafe`, `document.write`, `.createContextualFragment`), not a single regex an
  implementor can walk around. A gate is satisfied, never routed around; a check pinned to a
  source path moves with that code in the same PR.
- Names: `scripts/registry.json` is the source; `docs/design/README.md` mirrors it for reading.
- Allowed outside a story's paths when `check-story` is in use: `changelog.d/`,
  `docs/taste-review/queue.d/`, lockfiles, and the story's own row and result file.

## Writing a gate or check

Print one `✗ <what> ` line per problem followed by `    fix: <the exact thing to do>`, and one
`… ok (<count>)` line on success. Exit 1 on any problem. Never print a stack trace for an
expected failure. A check must be able to fail: the PR that adds it shows one failing run.

## Skipping

`MARXY_SKIP_HOOKS=1 git commit …` bypasses the local hooks for a person in a hurry. CI does not
have a bypass.

## CI — shape, and what is required

The jobs, when each runs and the command that reproduces it are in
[`docs/ci-contract.md`](ci-contract.md); this section is why the shape is what it is. Wall time
is not tabulated here: the figures written here before went stale within a week, and the real
ones are one command away (`gh run list --workflow ci --json databaseId,conclusion,createdAt,updatedAt`).

What the audit measured before the pull-request path was pruned (`docs/research/audit-2026-10/04-tests-and-gates.md`
§1.7), and where each of the six disagreements it found between the old documents and the code is
now settled:

| # | The old document said | The code and the measurement said | Now |
| --- | --- | --- | --- |
| 1 | `browser` takes 165 s, a pull request 277 s | `browser` median 708 s, a pull-request run median 743 s (n=14); the desktop suite alone was 407 to 478 s | no figure is promised; `browser-lite` runs the files listed in `test:lite` (`apps/desktop/package.json`), the ones that guard data loss, trust and the open path, and everything else is nightly (A-10) |
| 2 | apt packages are cached with `cache-apt-pkgs-action` | `ci.yml` uses plain `apt-get` on purpose: the action dropped `glib-2.0.pc`, so clippy and the build could not find glib on a cache hit and `main` went red | plain apt, and `check-workflows` fails a Linux cargo job that does not probe `glib-2.0` and install `dbus` |
| 3 | `conventions` is "the job that fails most" | of 36 red runs `conventions` failed in 2, `fast` in 19 and `browser` in 15 | `conventions` now lints the title only; `fast` is where a red is most likely, and its causes are the first rows of `docs/ci-contract.md` |
| 4 | one document said `-F strict=true`, the other `strict=false` | protection is `strict=false` (ADR-0040) | `strict=false` everywhere; the command is in `docs/ci-contract.md` |
| 5 | timing checks were removed in MARXY-153 and "nothing here is a timing number" | six unit tests still assert a wall-clock bound: `highlight.test.ts` (30 ms and 5 s), `marxy-337.test.ts` (1.5 s), `user-theme.test.mjs` (200 ms), `search-perf.test.ts` and `reload.test.ts` (calibrated against a reference machine), `typeset.test.mjs` (the viewport budget) | the rule stands as a rule and these are **known exceptions**, not an exemption: a failure in one of them means the bound should be a ratio or be printed (ADR-0032), and the right fix is to change the test |
| 6 | `gate-protection` is a standing check that branch protection has not drifted | no script, no workflow ran it, and `--live` failed against the intended settings | deleted (A-08); protection is a repository setting recorded in `docs/ci-contract.md`, not a script |

### The rule, and what it removed

**A check earns its place on the pull-request path by being able to fail for something in the
diff.** A check that fails for the machine it ran on is not a gate, it is a coin flip with a
changelog. Monitoring goes nightly; a step that cannot fail gets deleted or made real. Applied
across the repository this removed, in order: the aesthetics CLS repeat passes (nightly,
`--repeat 3`), the `cold_warm_ratio` and parse-timing hard fails, two absolute millisecond
assertions in unit tests, a self-referential clause in `ci-changes --selftest`, the per-pull-request
download of the CommonMark spec (cached on the script's hash), and then the dual-OS `gates` job
with its `gates-skip` and `gates-record` companions and the perf gate, product tier and
start-up measurement (A-03, A-09: measured nightly, `docs/ci-contract.md`). What stayed: the
sanitiser's ratio test (two timings on one machine, so machine speed cancels), `gate:bundle` (a byte
count) and every measurement that is recorded and printed. A check wrapped in `|| true` or
`|| echo` is a check whose failure nobody has read; that mistake hid a broken `check-story --strict`
step through every pull request the repository ever ran.

Rules baked in:

- **One required check.** Branch protection requires `ci` only, so job names can change without
  touching repository settings; `strict` is false (ADR-0040).
- **Every job has `timeout-minutes`**, enforced by `check-workflows`. A hang costs minutes, never hours.
- **Docs-only changes** run `changes`, `conventions` and `ci` only. Prose that a test reads
  (`AGENTS.md`, `docs/{sdlc,hygiene,plan,ci-contract}.md`) is not docs-only.
- **Path-filtered jobs** (`browser-lite`, `typography`, `rust`) run when the diff can affect them,
  and a push to `main` runs `fast` only (`scripts/ci-changes.mjs`).
- **Caches:** mise tools, the pnpm store keyed on the lockfile, cargo via `Swatinem/rust-cache`
  keyed on `Cargo.lock` and the `ci` profile. Browser binaries come with the
  `mcr.microsoft.com/playwright` image, whose tag must equal the pinned `playwright` version in
  `package.json` (exact, no caret).
- **The CI Cargo profile** (`[profile.ci]`, thin LTO, 16 codegen units) is what CI builds; tags and
  `pnpm bundle` use `release`. CI calls cargo directly and must pass `--features tauri/custom-protocol`,
  the switch `tauri build` sets implicitly; without it the app loads the dev-server URL and never
  paints. `MARXY_BIN` tells the smoke check which binary to launch.
- **Timing is recorded, never failed on** (ADR-0032, amended 2026-10): `pnpm perf` and the start-up
  measurement run nightly and write records. A measurement that produced no sample is a failure; a
  slow one is not.
- **Nothing retries silently.** No `retries` in Playwright, no `|| true`; a flaky test is fixed or
  deleted, never re-run until green.
