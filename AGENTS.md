# AGENTS.md — read this first, every session

You are working on **Marxy**, a markdown *reader*. Sessions start cold; this file, `docs/adr/`
and `docs/ci-contract.md` are the project's memory. If something here contradicts a document
elsewhere in the tree, this file and the ADRs win, and you fix the other document in your PR.

**Before you push anything, read [`docs/ci-contract.md`](docs/ci-contract.md).** It is the
complete list of what can turn a pull request red and the exact local command that reproduces
each one. Most red CI on this project is not a code failure — it is a commit subject, a PR body,
a missing changelog line, or a file outside the story's paths. All of it is checkable locally.

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

Pre-v1, mid-build, and the machinery is further along than the product. Phase 0 is behind us;
the current work is phases 1–3 (the page, the opener, operations and themes) with an ops lane
running beside them. `docs/plan.md` has the phases and `docs/roadmap.md` the long horizon.

For live board state, run `node orchestration/cycle.mjs` or read `orchestration/status.md` — it
is **generated and gitignored**, so it exists only in a checkout a cycle has run in, and it is
the only honest answer to "what is done". Never trust a count written into a document.

Two things worth knowing before you touch anything:

- **The repository is worked by a fleet.** Several worktrees are usually live at once
  (`git worktree list`). The main checkout at `~/Dev/marxy` may be mid-story under another
  session, and its branch can change under you. **Work in your own worktree** unless you know
  you own the checkout.
- **GitHub's native merge queue is off.** This repo is **User-owned**; GitHub only offers merge
  queue on **organization-owned** repos (public org repo, or private on Enterprise Cloud). CI already
  listens for `merge_group` (MARXY-122); keep `orchestration/models.json` **`mergeQueue` false** so
  the cycle still refreshes one BEHIND PR per cycle (MARXY-106). After an org transfer, enable the
  queue in GitHub and flip `mergeQueue` to true.

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
| `fixtures/corpus` | the fixture corpus that golden files, screenshots and perf gates run on | — |
| `scripts/` | CI gates | — |

`scripts/check-boundaries.mjs` enforces this on every build: core takes no DOM and no Node
built-ins, `@tauri-apps` appears only under `apps/desktop/src/shell`, `shell-api` imports
nothing, and raw `invoke(` outside `src/shell` is a failure.

**One issue, one branch, one PR, one owner.** Do not edit files outside your issue's
listed paths. If you need a change elsewhere, open a separate issue. Two agents editing one
file concurrently corrupt both changes and cost more than the work they saved.

## Working rules

- **Branches:** `type/MARXY-123-short-slug` off `main`, where the key is the real Jira key in
  project MARXY. `main` is always releasable; no direct pushes. Squash on merge; the PR
  description is the durable record. The process on one page: `docs/sdlc.md`.
- **Work outside the plan:** `node orchestration/out-of-plan.mjs start "summary" --paths "…"
  --acceptance "…"` creates the Jira Task, a worktree on `type/KEY-slug` off `origin/main`, and
  the change's **own board row**, which travels in the same PR. That is the supported path, and
  it is one PR: the cycle adopts the PR when it opens and lands it once a reviewer signs it — never
  merge by hand. Do not invent a key or skip the row; `check-story --strict` (CI, every PR) fails
  a branch with no `MARXY-nnn` in its name or a key with no row. A branch may edit its own row,
  never another story's. The whole protocol: `docs/sdlc.md` "Work outside the plan".
- **Commits, PRs, comments, reviews, tags:** `docs/conventions.md`. The one rule under all of
  them: a plain-language summary first, technical detail after, agent detail folded away.
  Conventional Commits with the Jira key in the subject; the PR template's order is enforced;
  review remarks use Conventional Comments; no attribution trailers (a hook blocks them).
- **Definition of done** for a story is one command: `pnpm done MARXY-nn` green (story
  boundary, precheck, drafted PR body) plus `node scripts/check-pr.mjs --body results/MARXY-nn.pr.md --range`
  green after you fill the TODOs. Every acceptance criterion names the test or gate that
  checks it; `CHANGELOG.md` has a line; docs/ADRs updated if a decision changed; a queue row
  in `docs/taste-review/queue.md` if anything the reader sees changed; the Jira issue Done
  and carrying the PR link. The full list, with the definition of ready that precedes it,
  is in `docs/sdlc.md`. `docs/hygiene.md` lists what the tools enforce; `pnpm new` starts
  modules, operations and commands in the house shape.
- **Contracts are frozen.** Changing anything in `packages/*/src/contracts/` needs an ADR
  and a PR touching only that — `pnpm test` byte-compares them against a pinned hash and fails
  on any diff. The token names, units and meanings are frozen and need an ADR; the default
  theme's values are taste and need a story with a taste-review queue row.
- **Names come from the registry.** A new mark, event, data attribute, class or token goes into
  `scripts/registry.json` first. Parsed markup may reach the DOM only on paths listed in
  `innerHtmlAllowedIn`; every route is matched, not just `.innerHTML =`.
- **The name is written `Marxy` in prose and `marxy` in technical contexts.** Sentences, headings,
  alt text, changelog lines and release notes say Marxy. Anything a machine reads stays lowercase:
  `@marxy/core`, `--marxy-*`, `MARXY_*`, `data-marxy-*`, `marxy-key-in-subject`, the binary, the
  repository, and paths like `~/Dev/marxy`. When in doubt, ask whether a tool would break if the
  letter changed — if yes, it is lowercase.
- **No rotting paths.** Do not cite a dated or generated location from a document meant to last.
  Taste-review kits (`docs/taste-review/<date>/`) are regenerated per review and `results/` is
  per-run; if a lasting document needs one of their files, copy it to a stable path and reference
  that. `docs/screenshot.png` is the README's copy of one such render.
- **Toolchain:** versions come from `mise.toml`. `pnpm` for Node, `uv` for Python,
  `cargo` for Rust. Never `npm install -g`.

## The three commands

```bash
pnpm precheck                        # typecheck/lint/test for what you touched + the gates your paths map to
pnpm done MARXY-nnn                  # boundary over the branch, precheck, drafts results/MARXY-nnn.pr.md
node scripts/open-pr.mjs MARXY-nnn   # check-pr on that body, then gh pr create --body-file; never --body
```

Fill the TODOs in the drafted body between steps two and three. `pnpm precheck --all` runs
everything rather than the subset your paths map to. If all three are green, the reviewer has
only judgement left. Everything these commands check, and every other way CI can go red, is in
[`docs/ci-contract.md`](docs/ci-contract.md).

## Verification — what you can and cannot check

You cannot see. Push everything you can into machine gates and treat the rest as a
queue for a human.

**Machine (CI, `scripts/gate-*.mjs`):** build/typecheck/lint/format; unit tests;
golden AST+source-map files over the corpus; screenshot diff over the corpus per
engine; performance numbers recorded (not gated, ADR-0032); bundle size; licence
audit; byte-fidelity property test; no-network assertion; the mechanical half of
the aesthetics test (`docs/aesthetics-acceptance.md`).

**Human (scheduled, batched):** whether it is *beautiful*. Never ask "does this look
right?" mid-task. Produce a reviewable artifact (screenshot corpus, side-by-side vs
Typora/Marked 2, before/after pairs), append it to `docs/taste-review/queue.md`, and
carry on against the mechanical gates. The queue is reviewed at the end of each phase.

**A check that cannot fail for something in your diff does not belong on the pull-request
path.** No `|| true`, no `continue-on-error`, no Playwright retries. Monitoring goes to
`.github/workflows/nightly.yml`. A flaky test is fixed or deleted, never re-run until green.

## Budgets

Interaction times are measured and printed. None of them fail CI (ADR-0032). A red perf gate
means the measurement is missing or dishonest, never that the machine was slow.
The numbers below are the sphere of concern, not a merge-bar ceiling.

| Cold start → first readable text | measured; no ceiling | Open indexed doc | < 50 ms |
| --- | --- | --- | --- |
| Palette keystroke → results | < 16 ms | Typeset viewport | < 100 ms |
| Live-reload after external change | < 100 ms | Find, first match | < 50 ms |

## Where things are

- `docs/ci-contract.md` — **every way CI can go red, and the local command for each.**
- `docs/brief.md` — the product, distilled. `docs/design-language.md` — the six
  constraints and the type scale. `docs/theme-contract.md`, `docs/operations.md`,
  `docs/navigation.md`, `docs/risks.md`.
- `docs/adr/` — every decision that constrains implementation. Read the index.
- `docs/decisions.md` — the open questions resolved at handoff, and what has been overturned since.
- `docs/scope.md` — what v1 is and is not. `docs/plan.md` — the phases.
  `docs/roadmap.md` — the horizons past v1.
- `docs/hygiene.md` — every tool, the failure mode it answers, and when it runs.
- `docs/aesthetics-acceptance.md` — the test for "aesthetics paramount".
- `docs/spike/` — the stack decision rule and the spike outcome.
- `docs/plan/jira-issues.csv` — the story list with acceptance criteria, mirrored into the Jira
  project MARXY, which is the board of record. `docs/sdlc.md` — the states, the definitions of
  ready and done, traceability and the release runbook.
- `orchestration/` — the fleet: `needs-human.md` for what is waiting on a person,
  `merge-bar.mjs` for the nine clauses a PR must satisfy to land, and `status.md` (generated,
  gitignored) for live board state.
