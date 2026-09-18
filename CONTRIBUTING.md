# Contributing

marxy is MIT. **Inbound = outbound:** by opening a pull request you license your
contribution under MIT. There is no CLA and there will not be one; a CLA exists to
enable a later proprietary relicence, which this project has refused (ADR-0006).

## How work flows

1. Every change starts as a Jira issue (project key in `docs/plan/jira-issues.csv`).
2. One issue, one branch (`type/MARXY-123-slug`), one PR, squash-merged into `main`.
3. `main` is protected: CI green, plus one human approval on anything touching
   `packages/typeset`, `packages/theme`, the sanitiser, the CSP, or `shell-api`.
4. Commit messages, PR structure, comments and review remarks follow `docs/conventions.md`;
   commitlint checks commits and the PR title in CI. No AI attribution trailers.
5. Add a line to `CHANGELOG.md` under `Unreleased` in the PR.

## What CI checks

Build, typecheck, lint, format, unit tests, golden render files, screenshot diffs per
engine, performance budgets, bundle size, licence audit, byte-fidelity property test,
no-network assertion, mechanical aesthetics checks. `pnpm gate:*` runs each locally.

## Things we will say no to

A plugin API. An operations scripting or shell-pipe surface. Telemetry of any kind.
Save-time reformatting. A tab bar. Reading-time estimates. GPL dependencies. See
`docs/adr/` for why each of these is a boundary rather than a backlog item.

## Fonts and licences

Bundled typefaces stay OFL 1.1 in `fonts/<family>/` with their `LICENSE` verbatim.
Never modify a font file (the Reserved Font Name clause). Attribute iA and the
Literata authors in the about surface and the README.
