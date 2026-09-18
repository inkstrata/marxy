# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), one line per pull request, written for
a reader of marxy, Jira key in parentheses. Release notes are generated from `Unreleased` at
tag time. Conventions in `docs/conventions.md`.

## Unreleased

### Added
- Agents land a pull request once the quality bar is met: a signed review of that exact commit, green gates, and the story's path boundary — CODEOWNERS paths still wait for a person (MARXY-79)
- The orchestrator fleet can run cheaper: `--low` is Sonnet 5 medium plus Grok 4.6 High Fast, `--minimal` is Grok 4.6 High Fast only
- Documents are parsed: CommonMark, GitHub-flavoured markdown, frontmatter and math become one AST in which every node knows the bytes of the file it came from, checked against the CommonMark reference implementation and against golden files for the whole fixture corpus (MARXY-11)
- Repository scaffold: frozen contracts, fixture corpus, CI gates, ADRs seeded from the brainstorm, a hello-world desktop app (bootstrap)
- Orchestration kit for running the agent fleet from Cursor: role prompts, board scripts, subagent definitions (bootstrap)
- Conventions for commits, pull requests, comments, tags and reviews, enforced by commitlint (bootstrap)
- The development process on one page in `docs/sdlc.md`: four board states, a WIP limit, definitions of ready and done, traceability and the release runbook (MARXY-10)
- A Jira bridge (`orchestration/jira.mjs`) that mirrors the backlog and the board into the tracker and links pull requests to issues (MARXY-10)
- Review approvals are signed against the commit they were read at (`orchestration/approve.mjs`), so a push after a review holds the merge instead of inheriting it (MARXY-10)
- Taste review #0: the long corpus document set in both candidate typeface pairs at the type scale and a 68ch measure, for the decision that settles ADR-0015 (MARXY-17)
- Measured decision note on ragged-right line breaking: justif/core and tex-linebreak2 set the corpus equally well, both beat the browser's own wrapping only at a tight rag tolerance, and the harness that proves it re-runs on demand (MARXY-19)

### Fixed
- Commit messages may name other stories in their body again; the key-in-subject rule is now checked directly instead of through the parser's issue references, which mistook any mention for a footer (MARXY-10)
- The anti-attribution hook the conventions promised now exists in `.githooks/commit-msg`, so trailers injected by agent tooling are stripped rather than merely forbidden (MARXY-10)

### Security
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)

### Changed
- Dispatch is uncapped: path overlap is the only parallelism limit, so returned PRs no longer sit idle waiting for a free lane
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- Jira is now the board of record: all 51 epics and stories exist as issues, and story keys throughout the repo are the real Jira keys (MARXY-10)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)
