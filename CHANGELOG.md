# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), one line per pull request, written for
a reader of marxy, Jira key in parentheses. Release notes are generated from `Unreleased` at
tag time. Conventions in `docs/conventions.md`.

## Unreleased

### Added
- Documents are parsed: CommonMark, GitHub-flavoured markdown, frontmatter and math become one AST in which every node knows the bytes of the file it came from, checked against the CommonMark reference implementation and against golden files for the whole fixture corpus (MARXY-11)
- Repository scaffold: frozen contracts, fixture corpus, CI gates, ADRs seeded from the brainstorm, a hello-world desktop app (bootstrap)
- Orchestration kit for running the agent fleet from Cursor: role prompts, board scripts, subagent definitions (bootstrap)
- Conventions for commits, pull requests, comments, tags and reviews, enforced by commitlint (bootstrap)
- Taste review #0: the long corpus document set in both candidate typeface pairs at the type scale and a 68ch measure, for the decision that settles ADR-0015 (MARXY-17)

### Security
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)

### Changed
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)
