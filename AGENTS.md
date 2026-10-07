# AGENTS.md — read this first, every session

> **The fleet is paused** ([`orchestration/PAUSED.md`](orchestration/PAUSED.md), ADR-0051). `MARXY`
> keys, board rows and the enforced pull-request body are no longer required; a commit subject may
> end in `(A-nn)`, in `(MARXY-n)`, or in nothing. The plan is in `docs/plan/roadmap-2026-10/`. The
> rest of this file is being rewritten in A-11 and is stale where it disagrees.

You are working on **Marxy**, a markdown *reader*. Sessions start cold; this file, `docs/adr/`
and `docs/ci-contract.md` are the project's memory. If something here contradicts a document
elsewhere in the tree, this file and the ADRs win, and you fix the other document in your PR.

**Before you push anything, read [`docs/ci-contract.md`](docs/ci-contract.md).** It is the
complete list of what can turn a pull request red and the exact local command that reproduces
each one. Nothing else is required of a pull request: a Conventional Commits subject, a changelog
fragment, green product gates and one review. All of it is checkable locally.

## The spirit (not negotiable)

Marxy opens a document instantly, gives you an index you can flip through, sets text like a
well-made book, treats code and AI artifacts as first-class content, and lets you operate on
what you read without becoming a writing tool. Content types in priority order: **READMEs,
AI/agent artifacts, source files, prose.** None of them are written in Marxy.

Four commitments, never traded away:

1. **MIT, free, no paid tier, no accounts.** Never ship a GPL dependency or grammar (ADR-0006).
2. **No telemetry, ever.** Not opt-out. None.
3. **Nothing phones home by default.** Themes cannot make network requests; remote
   images are blocked until the reader opts in per document. Some readers are at risk.
4. **Never touch a byte the user did not ask to change.** No reformatting, no
   normalising, no diff noise.

Reading is primary: every tension resolves toward the reader. **Aesthetics are the
differentiator** and the thing you cannot verify yourself — see "Verification" below.
Chrome at rest is zero: no toolbar, no tab bar, no sidebar; everything is summoned and
dismissed.

The bar: a competent, ordinary-looking markdown viewer is a failure. Clear it.

## Where the project actually is

Pre-v1, mid-build. **The fleet is paused** (ADR-0051, `orchestration/PAUSED.md`): one author directs
Claude agents, each on one story in its own worktree, reviewed by another agent and merged by the
author. The plan is in [`docs/plan/roadmap-2026-10/`](docs/plan/roadmap-2026-10/README.md); read its
`00-orchestration.md` for how a story is run and `progress.md`, the ledger the lead keeps, for what is
done. It replaces the phase list in `docs/plan.md` and the first horizon of `docs/roadmap.md`, which stay
as the project's earlier shape. Never trust a count written into a document: the ledger and
`git log` are the record.

Two things worth knowing before you touch anything:

- **Several worktrees are usually live** (`git worktree list`), and the main checkout at
  `~/Dev/marxy` may be mid-story under another session. **Work in your own worktree** on your own
  branch, and edit only your story's listed paths.
- **The merge is by hand.** The author squash-merges through GitHub; nobody else merges and
  auto-merge stays off. Branch protection requires the one check `ci`, and does not require a
  branch to be up to date with `main` (ADR-0040). GitHub's native merge queue is not available
  (this repository is User-owned, and the queue exists only on organisation-owned ones); `ci.yml`
  still listens for `merge_group` so a transfer would need no change.

The fleet's code (`orchestration/`), its board (`docs/plan/jira-issues.csv`, Jira project MARXY) and
its rules (one issue, one branch, one PR, one owner as an *enforced* rule; the story-boundary check;
the merge bar) are frozen, not deleted. Their tests run as `pnpm test:fleet`. The five conditions for
starting it again are in `orchestration/PAUSED.md`.

## Architecture in one paragraph

One source buffer is truth. One parse produces one AST in which **every node carries
`{file, start, end}` byte provenance** (`packages/core/src/contracts/ast.ts`). Two
view modes, **Rendered** (default; typeset, no caret, selection + operations) and
**Source** (CodeMirror 6, real editor, the code viewer). Editing is **transformation**:
a selection resolves through the source map to a byte range, a pure `string → string`
operation runs, the buffer is spliced. Undo is free; byte fidelity is structural.
Privileged work (files, watching, dialogs, clipboard) goes through the thin
`packages/shell-api` interface only, so the desktop shell is replaceable.

## Module map and ownership

| Path | Owns | Depends on |
| --- | --- | --- |
| `packages/core` | parse → AST + source map, sanitise, outline, operations, index model | nothing platform-specific; must run in Node and in a browser |
| `packages/typeset` | Knuth–Plass line breaking, hanging punctuation, baseline-grid enforcement, font-metric measurement | DOM only, no shell |
| `packages/theme` | the default theme, the `--marxy-*` custom-property contract, theme loading and validation | none |
| `packages/shell-api` | the privileged-operation interface (types only) | none |
| `apps/desktop` | the Tauri shell implementing `shell-api`; the app UI (palette, outline, find, modes) | all of the above |
| `fixtures/corpus` | the fixture corpus that goldens, the aesthetics gates and the nightly perf harness run on | — |
| `scripts/` | CI gates | — |

`scripts/check-boundaries.mjs` enforces this on every build: core takes no DOM and no Node
built-ins, `@tauri-apps` appears only under `apps/desktop/src/shell`, `shell-api` imports
nothing, and raw `invoke(` outside `src/shell` is a failure.

**One issue, one branch, one PR, one owner.** Do not edit files outside your issue's
listed paths. If you need a change elsewhere, open a separate issue. Two agents editing one
file concurrently corrupt both changes and cost more than the work they saved.

## Working rules

- **Branches:** `type/<id>-short-slug` off `main`, where `<id>` is the roadmap story id in lower case
  (`docs/a-11-ci-contract-rewrite`); a Jira key is allowed and neither is required. `main` is always
  releasable; no direct pushes. Squash on merge; the PR description is the durable record. One page:
  `docs/sdlc.md`, whose fleet sections are suspended.
- **No key, no board row.** Commit subjects may end in a story id `(A-07)`, a key `(MARXY-123)`, or
  nothing; no row in the CSV is needed, and `check-story --strict` is not run by CI. The Jira
  project is a historical record that nothing writes to.
- **Commits, PRs, comments, reviews, tags:** `docs/conventions.md`. The one rule under all of
  them: a plain-language summary first, technical detail after, agent detail folded away.
  Conventional Commits, enforced by commitlint (the hook on each commit, the title in CI); review
  remarks use Conventional Comments; no attribution trailers (a hook blocks them). The
  pull-request template is a suggestion that nothing enforces.
- **Definition of done** for a story: its tests and gates, each acceptance criterion checked by a
  named test or gate that fails without the change; `pnpm precheck` and `pnpm check` green;
  `changelog.d/<id>.md` holding one reader-facing line ending `(<id>)` (nobody edits
  `CHANGELOG.md`); docs and ADRs updated if a decision changed; one review. A taste-review entry in
  `docs/taste-review/queue.d/<id>.md` is optional and no gate asks for one.
- **After a human approves a PR,** the only push allowed to it is a merge of `main`; anything else
  needs a new review.
- **Contracts change by pull request.** ADR-0045: the files in `packages/*/src/contracts/`,
  `packages/shell-api/src/index.ts` and `tokens.css` change by an ordinary reviewed pull request, with
  the goldens it moves regenerated in the same PR. Their invariants are tests (the goldens,
  `pnpm gate:fidelity`, `pnpm check`). A change of meaning (a new node kind, a new selection
  granularity, a new privileged capability) still gets an ADR; adding a field does not. The token names,
  units and meanings in `--marxy-*` still need an ADR; the default theme's values are taste and need a story.
- **Names come from the registry.** A new mark, event, data attribute, class or token goes into
  `scripts/registry.json` first. Parsed markup may reach the DOM only on paths listed in
  `innerHtmlAllowedIn`; every route is matched, not just `.innerHTML =`.
- **The name is written `Marxy` in prose and `marxy` in technical contexts.** Sentences, headings,
  alt text, changelog lines and release notes say Marxy. Anything a machine reads stays lowercase:
  `@marxy/core`, `--marxy-*`, `MARXY_*`, `data-marxy-*`, `marxy-ref-in-subject`, the binary, the
  repository, and paths like `~/Dev/marxy`. When in doubt, ask whether a tool would break if the
  letter changed — if yes, it is lowercase.
- **No rotting paths.** Do not cite a dated or generated location from a document meant to last.
  Taste-review kits (`docs/taste-review/<date>/`) are regenerated per review and `results/` is
  per-run; if a lasting document needs one of their files, copy it to a stable path and reference
  that. `docs/screenshot.png` is the README's copy of one such render.
- **Toolchain:** versions come from `mise.toml`. `pnpm` for Node, `uv` for Python,
  `cargo` for Rust. Never `npm install -g`. pnpm's pre and post hooks are off
  (`enablePrePostScripts: false` in `pnpm-workspace.yaml`), so no script runs another by name.

## The commands before a pull request

```bash
pnpm precheck                        # typecheck/lint/test for what you touched + the gates your paths map to
pnpm check                           # the eight hygiene checks, in one command
gh pr create --base main --title "<subject>" --body-file FILE   # the template; never --body
```

`pnpm precheck --all` runs everything it knows rather than the subset your paths map to. `pnpm
done`, `node scripts/open-pr.mjs` and `node scripts/check-pr.mjs` are optional local helpers from
the fleet era (they expect a `MARXY-nnn` key); CI runs none of them. If the first two are green and
the subject, fragment and gates your story names are in place, the reviewer has only judgement
left. Everything these check, and every other way CI can go red, is in
[`docs/ci-contract.md`](docs/ci-contract.md).

## Verification — what you can and cannot check

You cannot see. Push everything you can into machine gates and treat the rest as a
queue for a human.

**Machine, on every pull request (`docs/ci-contract.md`):** typecheck, lint and the eight hygiene
checks; unit tests; golden AST+source-map files over the corpus; the byte-fidelity property
test; the licence audit; bundle import graph; the no-network assertion; the desktop lite suite
in WebKit; and, when what they render changed, the mechanical half of the aesthetics test
(`docs/aesthetics-acceptance.md`) and the specimen gate. **Nightly, as monitoring:** the full
WebKit suites and the mutation check, screenshot and rag comparison against the baselines
(ADR-0047), the performance records (ADR-0032), both operating systems' builds and the built-app
smoke (ADR-0046). A red nightly is a note for the next session, not a blocked merge.

**Evidence first:** where the research in `docs/research/reader-typography/` gives a default
(size, measure, leading, contrast, code colour), that is the default; taste review judges what the
research cannot, not what it already answers.

**Human (scheduled, batched):** whether it is *beautiful*. Never ask "does this look
right?" mid-task. Produce a reviewable artifact (screenshot corpus, side-by-side vs
Typora/Marked 2, before/after pairs), optionally leave it as `docs/taste-review/queue.d/<id>.md`
(`node scripts/taste-queue.mjs --fold` folds entries into `queue.md`), and carry on against the
mechanical gates. Entries are voluntary; the human review of each phase still judges the result.

**A check that cannot fail for something in your diff does not belong on the pull-request
path.** No `|| true`, no `continue-on-error`, no Playwright retries. Monitoring goes to
`.github/workflows/nightly.yml`. A flaky test is fixed or deleted, never re-run until green.

## Budgets

Interaction times are recorded nightly, not on pull requests (`pnpm perf`, and the start-up
measurement in `nightly.yml`), and printed. None of them fail CI (ADR-0032, amended 2026-10): only a
measurement that produced no sample does, never a machine that was slow. The numbers below are the
sphere of concern, not a merge-bar ceiling.

| Cold start → first readable text | measured; no ceiling | Open indexed doc | < 50 ms |
| --- | --- | --- | --- |
| Palette keystroke → results | < 16 ms | Typeset viewport | < 100 ms |
| Live-reload after external change | < 100 ms | Find, first match | < 50 ms |

## Where things are

- `docs/ci-contract.md` — **every way CI can go red, and the local command for each.**
- `docs/brief.md` — the product, distilled. `docs/design-language.md` — the six
  constraints and the type scale. `docs/theme-contract.md`, `docs/operations.md`,
  `docs/navigation.md`, `docs/risks.md`.
- `docs/research/reader-typography/` — **the typography authority.** A graded handbook of what
  the evidence says about size, measure, leading, line breaking, code, colour and access; start at
  `10-spec.md`. It supersedes earlier taste decisions (ADR-0033). A typographic change cites the
  chapter it follows, or says why it departs.
- `docs/research/reader-artifacts/` — a sibling handbook on how to present what is not prose: agent
  artifacts, code and diffs as read, logs and structured data, READMEs, and the trust questions
  they raise. **Research, applied by story:** ADR-0035 is accepted (2026-09-26), but its spec lines are
  recommendations until a story applies them. Start at `10-spec.md`; its
  `gaps.md` lists what the frozen contracts cannot express, as draft ADRs.
- `docs/adr/` — every decision that constrains implementation. Read the index.
- `docs/decisions.md` — the open questions resolved at handoff, and what has been overturned since.
- `docs/scope.md` — what v1 is and is not. `docs/plan/roadmap-2026-10/` — **the current plan**, with
  `progress.md` as the ledger; `docs/plan.md` and `docs/roadmap.md` are the earlier shape.
- `docs/hygiene.md` — every tool, the failure mode it answers, and when it runs.
- `docs/aesthetics-acceptance.md` — the test for "aesthetics paramount".
- `docs/spike/` — the stack decision rule and the spike outcome.
- `docs/sdlc.md` — the process the fleet ran, and the release runbook (still read). Its fleet
  sections are suspended. `docs/plan/jira-issues.csv` is the old story list, mirrored into the Jira
  project MARXY: a historical record now.
- `orchestration/` — the paused fleet (`orchestration/PAUSED.md`, `orchestration/README.md`): frozen
  code and the author's rulings in `needs-human.md`. Its tests run as `pnpm test:fleet`.
