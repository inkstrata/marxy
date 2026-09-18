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
node scripts/check-pr.mjs --body results/MARXY-nn.pr.md --key MARXY-nn --range
gh pr create --title "<subject>" --body-file results/MARXY-nn.pr.md
```

If `pnpm done` is green and `check-pr` is green, the reviewer only has judgement left to do.

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
| A PR whose body is out of order, has an empty acceptance table, lacks a changelog line, or changes baselines without a queue row | `scripts/check-pr.mjs` | `done`, CI |
| A commit message off convention or carrying a trailer | `.githooks/commit-msg` (commitlint + strip) | commit |
| Skipping the gates that a change needs | `scripts/precheck.mjs` with `scripts/gates-by-path.json` | before the PR, CI runs all |
| A result file that omits which test checks which criterion | `orchestration/schema/result.schema.json`, validated in `review.mjs` | review |
| Rust formatting and warnings | `pnpm lint:rust` (`cargo fmt --check`, `clippy -D warnings`) | precheck (when `src-tauri` changes), CI |
| Starting a module, operation or command in a random shape | `pnpm new …` generators | at the start |

## Rules the tools encode (so nobody re-derives them)

- The story key comes from the branch: `type/MARXY-nn-slug`. No key, no path check (and a
  note); `--strict` makes that a failure in CI once every branch is a story branch.
- Allowed outside a story's paths: `CHANGELOG.md`, `docs/taste-review/queue.md`, lockfiles,
  the story's own task card and result file, and plan deltas.
- Frozen: `packages/*/src/contracts/`, `packages/shell-api/src/`, `packages/theme/src/tokens.css`.
- Large-file limit 2 MB, except under `fonts/`, `fixtures/`, `docs/spike/results/`,
  `docs/taste-review/`, the app icons.
- `innerHTML` may be assigned only where `scripts/registry.json` says (the render sites).
- Names: `scripts/registry.json` is the source; `docs/design/README.md` mirrors it for reading.

## Writing a gate or check

Print one `✗ <what> ` line per problem followed by `    fix: <the exact thing to do>`, and one
`… ok (<count>)` line on success. Exit 1 on any problem. Never print a stack trace for an
expected failure. A check must be able to fail: the PR that adds it shows one failing run.

## Skipping

`MARXY_SKIP_HOOKS=1 git commit …` bypasses the local hooks for a person in a hurry. CI does not
have a bypass.
