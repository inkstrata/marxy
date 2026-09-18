# AGENTS.md — read this first, every session

You are working on **marxy**, a markdown *reader*. Sessions start cold; this file plus
`docs/adr/` is the project's memory. If something here contradicts a document elsewhere
in the tree, this file and the ADRs win, and you fix the other document in your PR.

## The spirit (not negotiable)

marxy exists because reading markdown in every existing tool feels *wrong*, not
feature-poor. It is a very fast document opener with an index you can flip through
instantly, that sets text like a well-made book, treats code and AI artifacts as
first-class content, and lets you operate on what you read without becoming a writing
tool. Content types in priority order: **READMEs, AI/agent artifacts, source files,
prose.** None of them are written in marxy.

The name is an instruction — Marx and Banksy. Four hard consequences:

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

What failure looks like: a competent, ordinary-looking markdown viewer. That is worse
than nothing because the world already has it.

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

**One issue, one branch, one PR, one owner.** Do not edit files outside your issue's
listed paths. If you need a change elsewhere, open a separate issue. Two agents
editing one file concurrently damaged the brainstorm that preceded this repo.

## Working rules

- **Branches:** `type/MARXY-123-short-slug` off `main`, where the key is the real Jira key in
  project MARXY. `main` is always releasable; no direct pushes. Squash on merge; the PR
  description is the durable record. The process on one page: `docs/sdlc.md`.
- **Commits, PRs, comments, reviews, tags:** `docs/conventions.md`. The one rule under all of
  them: a plain-language summary first, technical detail after, agent detail folded away.
  Conventional Commits with the Jira key in the subject; the PR template's order is enforced;
  review remarks use Conventional Comments; no attribution trailers (a hook blocks them).
- **Definition of done** for a story: every acceptance criterion in the issue is
  machine-checked by a test or gate that is in the PR; `pnpm build typecheck lint test`
  green; the relevant gates green; `CHANGELOG.md` has a line; docs/ADRs updated if a
  decision changed; visual artifacts queued in `docs/taste-review/queue.md` if anything
  the reader sees changed; the Jira issue Done and carrying the PR link. The full list, with
  the definition of ready that precedes it, is in `docs/sdlc.md`.
- **Contracts are frozen.** Changing anything in `packages/*/src/contracts/` or
  `packages/theme/src/tokens.css` needs an ADR and a PR touching only that.
- **Toolchain:** versions come from `mise.toml`. `pnpm` for Node, `uv` for Python,
  `cargo` for Rust. Never `npm install -g`.

## Verification — what you can and cannot check

You cannot see. Push everything you can into machine gates and treat the rest as a
queue for a human.

**Machine (CI, `scripts/gate-*.mjs`):** build/typecheck/lint/format; unit tests;
golden AST+source-map files over the corpus; screenshot diff over the corpus per
engine; performance budgets as hard failures; bundle size; licence audit;
byte-fidelity property test; no-network assertion; the mechanical half of the
aesthetics test (`docs/aesthetics-acceptance.md`).

**Human (scheduled, batched):** whether it is *beautiful*. Never ask "does this look
right?" mid-task. Produce a reviewable artifact (screenshot corpus, side-by-side vs
Typora/Marked 2, before/after pairs), append it to `docs/taste-review/queue.md`, and
carry on against the mechanical gates. The queue is reviewed at the end of each phase.

## Budgets (CI fails on regression)

| Cold start → first readable text | < 500 ms | Open indexed doc | < 50 ms |
| --- | --- | --- | --- |
| Palette keystroke → results | < 16 ms | Typeset viewport | < 100 ms |
| Live-reload after external change | < 100 ms | Find, first match | < 50 ms |

## Where things are

- `docs/brief.md` — the product, distilled. `docs/design-language.md` — the six
  constraints and the type scale. `docs/theme-contract.md`, `docs/operations.md`,
  `docs/navigation.md`, `docs/risks.md`.
- `docs/adr/` — every decision that constrains implementation. Read the index.
- `docs/decisions.md` — the open-question pass and what was overturned from the brainstorm.
- `docs/scope.md` — what v1 is and is not. `docs/plan.md` — the phases.
- `docs/aesthetics-acceptance.md` — the test for "aesthetics paramount".
- `docs/spike/` — the stack decision rule and the spike outcome.
- `docs/plan/jira-issues.csv` — the story list with acceptance criteria, mirrored into the Jira
  project MARXY, which is the board of record. `docs/sdlc.md` — the states, the definitions of
  ready and done, traceability and the release runbook.
- The brainstorm that preceded this repo lives at `~/Dev/marxy-brainstorm`; it is
  history, not specification. Do not import from it wholesale.
