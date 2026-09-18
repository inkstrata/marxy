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

### Changed
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
