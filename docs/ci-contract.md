# The CI contract — everything that can turn a pull request red

Read this before you push, not after. Every rule below is enforced by a script you can run
locally; none of it is discovered by waiting for GitHub. If CI fails on something that is not
in this page, the page is wrong and fixing it is part of your PR.

The governing rule is `docs/hygiene.md`'s: **a check earns its place on the pull-request path by
being able to fail for something in the diff.** Nothing here is a timing number, a network
fetch, or a re-run of identical work. If a check fails, the diff caused it.

## The one required check

Branch protection requires exactly one status: **`ci`**. It is a summary job that fails if any
job that actually ran failed or was cancelled. Skipped jobs are fine. Job names can therefore
change without touching repository settings.

```bash
gh api -X PATCH repos/inkstrata/marxy/branches/main/protection/required_status_checks -F strict=true -f 'contexts[]=ci'
```

That endpoint answers `PUT` with a 404 — `PATCH` is the working verb, and `-F` sends `strict`
as a boolean rather than a string.

## Before you push

Three commands, in this order. If all three are green, the reviewer has only judgement left.

```bash
pnpm precheck                  # typecheck/lint/test for what you touched + the gates your paths map to
pnpm done MARXY-nnn            # story boundary over the whole branch, precheck, drafts results/MARXY-nnn.pr.md
node scripts/open-pr.mjs MARXY-nnn   # check-pr on that body, then gh pr create --body-file
```

Fill the TODOs in `results/MARXY-nnn.pr.md` between step two and step three. Never open a PR
with `gh pr create --body` — that replaces the house template and `check-pr` will reject the
result. `open-pr.mjs` exists so the rejection happens before the PR does.

`pnpm precheck` maps your changed paths to gates through `scripts/gates-by-path.json`, so it
runs a subset. `pnpm precheck --all` runs everything. CI always runs everything.

## What runs, and what it is locally

| Job | Runs when | What it does | Local equivalent |
| --- | --- | --- | --- |
| `changes` | always | classifies the diff into `docs_only` / `web` / `rust` / `gates`; self-tests the classifier | `node scripts/ci-changes.mjs --selftest` |
| `conventions` | pull requests only | commitlint over every commit **and** the PR title; `check-pr` on the body; `check-story --strict` over the branch | `pnpm lint:commits`, `node scripts/check-pr.mjs --body results/KEY.pr.md --range`, `node scripts/check-story.mjs --strict` |
| `fast` | not docs-only (orchestration `.mjs`/`.json` and the board CSV are code, not docs) | hygiene checks, typecheck, lint, unit tests, CommonMark spec, goldens, fidelity, licences | `pnpm check:boundaries && pnpm check:registry && pnpm check:deps && pnpm check:workflows && pnpm typecheck && pnpm lint && pnpm test && pnpm gate:golden && pnpm gate:fidelity && pnpm gate:licences` |
| `browser` | `web` changed | no-network and aesthetics gates in the pinned Playwright container | `pnpm gate:no-network && pnpm gate:aesthetics` |
| `gates` (macOS + Ubuntu) | gates-relevant change | specimen, licences twice, Rust fmt/clippy, frontend + `cargo build --profile ci`, CLI smoke, startup and parse measurement, perf gate, bundle gate | `pnpm gate:specimen`, `pnpm lint:rust`, `pnpm --filter @marxy/desktop verify:cli`, `pnpm gate:bundle` |
| `gates-skip` | no gates-relevant change | posts the same two check names so anything watching by name still resolves | — |
| `gates-record` | after a real dual-OS `gates` success | caches proof that this content built clean on both runners | — |
| `ci` | always | the required check | — |

`fast`, `browser` and `gates` all run `pnpm install --frozen-lockfile`. **A `pnpm-lock.yaml`
that does not match `package.json` fails every one of them before a single test runs.**

## What decides which jobs run

`scripts/ci-changes.mjs` classifies the diff. You cannot skip a job by hand.

- **`docs_only`** — `docs/`, `orchestration/`, `.cursor/`, markdown outside `fixtures/`, and
  nothing else. Runs `changes`, `conventions`, `ci` only; under two minutes. A markdown file
  under `.github/` is *not* docs-only: it counts as a workflow change.
- **`web`** — anything under `packages/`, `apps/desktop/{src,index.html,vite.config,package.json,scripts}`,
  `fixtures/`, `scripts/`, the root manifests, or `mise.toml`. Starts the `browser` job.
- **`rust`** — anything under `apps/desktop/src-tauri/`.
- **`gates`** — hashed over `apps/desktop`, `packages`, `fixtures`, `scripts`,
  `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `mise.toml`. If that hash already passed on both runner classes, the build is skipped and
  `gates-skip` posts the names instead. A Rust, `measure-startup` or `ci.yml` change always
  forces the real build.

## Red CI, by cause

### Conventions — the job that fails most, and never for a code reason

| Symptom | Cause | Fix |
| --- | --- | --- |
| `marxy-key-in-subject` | a commit subject does not end in `(MARXY-nnn)` | rewrite the subject; a squash-appended ` (#nn)` after the key is allowed |
| `type-enum` / `scope-enum` | type or scope outside the enum | types: `feat fix perf refactor docs test build ci chore style revert`; scopes: `core typeset theme shell desktop corpus gates ci docs orchestration release fonts repo workspace` |
| `header-max-length` | subject over 100 characters, key included | shorten; aim for ~72 |
| `body-leading-blank` | no blank line after the subject | add one; body is mandatory for `feat`, `fix`, `perf`, `refactor` |
| PR title step fails | the **title** is linted as a squash subject too | the title must satisfy every commit rule above |
| `missing section "## …"` | the body is not the house template | use `.github/pull_request_template.md`, in order: Summary, Changes, Verification, For the reviewer, `<details>`, Checklist |
| `foreign heading "## Test plan"` | a generic or Cursor template was pasted | the house sections are not Why / Acceptance / Test plan |
| `Summary has 1 sentence(s)` | Summary too short | two to four sentences, plain language, what a reader notices or a developer can now do |
| `Verification has no fenced block` | no commands in Verification | paste the gate commands and their result lines |
| `the acceptance → checks table is empty` / `Checked by is unfilled` | the `<details>` table still has TODOs | one row per criterion naming the test or gate; `TODO` is not a check |
| `CHANGELOG.md has no line with MARXY-nnn` | no changelog entry | one line under `Unreleased` in the right Keep a Changelog heading, key in parentheses |
| `golden/baseline files changed but docs/taste-review/queue.md did not` | baselines moved with no human queue row | add the before/after row; a baseline change is a human-visible event |
| `the body carries an AI attribution line` | attribution in the PR body | remove it — the commit-msg hook cannot see the PR body |
| story boundary failure | a file outside the story's `Paths` | split it out, or widen your own row's `Paths` in `docs/plan/jira-issues.csv` **and** the task card together, in this branch — the reviewer is told and decides (implementors report `blocked` instead) |
| `MARXY-n has no row in docs/plan/jira-issues.csv on main or in this branch` | work that is not a planned story, without its board row | `node orchestration/out-of-plan.mjs row MARXY-n --paths "…" --acceptance "…"` in the branch; next time start with `out-of-plan.mjs start` (`docs/sdlc.md` "Work outside the plan") |
| `… changes other stories' board entries (MARXY-…)` | a branch edited a row or `deps.json` entry that is not its own | move those edits to a planner PR whose `Paths` list the board files |

Allowed outside a story's paths without widening anything: `CHANGELOG.md`,
`docs/taste-review/queue.md`, lockfiles, the story's own task card and result file, plan deltas,
and the story's **own** row in `docs/plan/jira-issues.csv` and entry in `orchestration/deps.json`
(`scripts/lib/own-row.mjs`; the branch is then judged by its row as it leaves it).

`check-story --strict` reads the key from the branch name. On a detached CI checkout it falls
back to `GITHUB_HEAD_REF` then `GITHUB_REF_NAME`. **A branch with no `MARXY-nnn` in its name
cannot pass `--strict`.**

### Fast — hygiene, types, lint, tests

| Symptom | Cause | Fix |
| --- | --- | --- |
| `contracts-frozen: diff vs <hash>` | a file under `packages/*/src/contracts/` changed | contracts are byte-frozen; revert, or land an ADR in a PR touching only that |
| `boundaries: … imports …` | a module crossed its boundary | core takes no DOM, no Node built-ins, no shell; `@tauri-apps` only under `apps/desktop/src/shell`; `shell-api` imports nothing |
| `… touches the DOM inside packages/core` | `document.` / `window.` / `new DOMParser` in core | move it to `apps/desktop` or `packages/typeset` (ADR-0020) |
| `calls the Tauri IPC function directly` | raw `invoke(` outside `src/shell` | add a method to `src/shell/tauri.ts` and call that |
| registry failure | a new mark, event, data attribute, class or token name | add it to `scripts/registry.json` first; names are the registry's, not yours |
| innerHTML route failure | parsed markup entering the DOM off-path | only paths in `innerHtmlAllowedIn` may; every route is matched, not just `.innerHTML =` |
| `MARXY-NEW-… is a placeholder key` | a planner branch still carries a draft key | `node orchestration/jira.mjs sync --new` in the branch: creates the issues, rewrites the keys, renames the cards |
| `check:deps` failure | a dependency missing from the allowlist, unpinned, or forbidden | add it to `scripts/allowlists/dependencies.json` with a pin, or do not add it |
| `check:workflows` failure | a GitHub Action not on the accepted list | a third-party action runs with our token on the machine that builds what we ship; justify and add it deliberately |
| `noUnusedImports` | an unused import | remove it; do not add a biome override |
| biome wrote a file | `format --write` was used somewhere | `pnpm lint` is check-only and must stay so |
| CommonMark step fails on `git status --porcelain` | the spec suite left the tree dirty | the suite must not write into the repo |
| `gate:golden` | AST or source-map output moved | regenerate the goldens deliberately and add a taste-review row if anything visible moved |
| `gate:fidelity` | a byte that was not asked to change, changed | the property test found a normalisation; fix the operation, never the test |
| `gate:licences` | a copyleft or undeterminable licence | ADR-0006 forbids copyleft anywhere, node_modules and linked crates alike |
| `gate:font-attrs` | `.gitattributes` lost `binary` or gained `eol` on a font | font binaries are `binary -eol`; text under `fonts/` stays readable text |

### Browser and gates

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gate:no-network` | something reached off the machine, or unsanitised markup reached the DOM | ADR-0009; the gate measures in both engines against live controls |
| `gate:aesthetics` | a mechanical aesthetics check moved | `docs/aesthetics-acceptance.md`; tune with `--workers N` locally, never by loosening a threshold |
| `gate:bundle` | the bundle grew past budget, or the parser resolved katex | a byte count, not a duration — it is a real regression |
| `lint:rust` | `cargo fmt --check` or `clippy -D warnings` | runs on the Linux runner only, but fix it anywhere |
| the window never paints | `cargo build` without `--features tauri/custom-protocol` | CI calls cargo directly and must pass the flag `tauri build` sets implicitly |
| CLI smoke fails | shell, paint or CLI path regressed | `pnpm --filter @marxy/desktop verify:cli` reproduces it with `MARXY_SMOKE_REQUIRED=1` |
| `gate:perf` fails | the record is **missing or dishonest**, not slow | timings never fail the build (ADR-0032); a perf failure means the measurement did not happen or does not add up |
| `--assert-budgets-unchanged` | `fixtures/perf-budgets.json` moved | changing a budget is its own decision; it needs an ADR, not a drive-by edit |

## Editing CI itself

Four checks guard the workflow. Change `ci.yml` and you will meet them.

- **`gate-perf.mjs --selftest`** asserts the `gates` job keeps `fail-fast: false`, both runner
  classes, and the measurement / selftest / perf-gate steps **unconditional** — no `if:`, no
  `continue-on-error`, no `|| true`. It also asserts `continue-on-error` appears nowhere in the
  file. Its matrix must stay the single-line `os: [macos-latest, ubuntu-latest]`; `gates-skip`
  deliberately writes its matrix one value per line so it does not collide with that grep.
- **`lint:biome-contract`** asserts `ci.yml` still contains `pnpm lint`, `macos-latest` and
  `ubuntu-latest`, that root `lint` runs `biome check` without `--write`, and that
  `fixtures/corpus` and `fonts` stay ignored by biome.
- **`ci-changes.mjs --selftest`** asserts the classifier still sends rust, `measure-startup` and
  `ci.yml` changes to a real build.
- **`check:workflows`** pins every third-party action to an accepted major version.

Two standing rules: **every job carries `timeout-minutes`**, and the Playwright container tag
must equal the `playwright` version pinned in `package.json` exactly, no caret.

## What is deliberately not gated

Timing numbers are recorded and printed, never failed on (ADR-0032). A check that fails for the
machine it ran on is a coin flip with a changelog. Monitoring lives in
`.github/workflows/nightly.yml` — today that is the aesthetics CLS repeat pass against `main`.

**Nothing retries silently.** No Playwright `retries`, no `|| true`, no `continue-on-error`. A
flaky test is fixed or deleted, never re-run until green. A check wrapped in `|| echo` is a check
whose failure nobody has read — that mistake hid a broken `check-story --strict` step through
every pull request the repository had ever run.

## Local escape hatch

`MARXY_SKIP_HOOKS=1 git commit …` bypasses the pre-commit and commit-msg hooks for a person in a
hurry. **CI has no bypass**, and everything the hooks check runs again there.
