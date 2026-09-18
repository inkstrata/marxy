# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), one line per pull request, written for
a reader of marxy, Jira key in parentheses. Release notes are generated from `Unreleased` at
tag time. Conventions in `docs/conventions.md`.

## Unreleased

### Added
- Opening a document can now index the repository around it — honouring ignore rules, skipping `node_modules` and the rest of the deny list, stopping at fifty thousand files — after the first page paints, and the index is kept on disk and rebuilt when a file's mtime changes (MARXY-35)
||||||| parent of 64e1ca9 (docs: design runway and task cards for Phases 1–2 (MARXY-74))
||||||| parent of 110c4f8 (chore: hygiene tooling so weak agents cannot go wrong (MARXY-74))
- Hygiene tooling for the agent fleet: pre-commit story-boundary and name checks, module import rules, a dependency allow-list, a PR checker, path-aware precheck, a one-command definition of done that drafts the PR body, and generators for modules, operations and shell commands (MARXY-74)
- Design documents for every subsystem and a task card per Phase 1–2 story, so implementors build from decisions already made; ADR-0023 fixes how rendered elements carry their byte provenance (MARXY-74)
- Documents are parsed: CommonMark, GitHub-flavoured markdown, frontmatter and math become one AST in which every node knows the bytes of the file it came from, checked against the CommonMark reference implementation and against golden files for the whole fixture corpus (MARXY-11)
- Repository scaffold: frozen contracts, fixture corpus, CI gates, ADRs seeded from the brainstorm, a hello-world desktop app (bootstrap)
- Orchestration kit for running the agent fleet from Cursor: role prompts, board scripts, subagent definitions (bootstrap)
- Conventions for commits, pull requests, comments, tags and reviews, enforced by commitlint (bootstrap)
- Open a document from the command line: `marxy README.md` reads the file and shows it, unstyled for now, and reports the moment the first text was painted (MARXY-13)
- Taste review #0: the long corpus document set in both candidate typeface pairs at the type scale and a 68ch measure, for the decision that settles ADR-0015 (MARXY-17)
- Saving a document puts back exactly the bytes it had: a byte-order mark, Windows line endings and a missing final newline all survive, the file is replaced by a rename rather than written in place so a crash cannot truncate it, its permissions are kept, and marxy refuses rather than silently changing a read-only, hard-linked or someone else's file (MARXY-14)
- Measured decision note on ragged-right line breaking: justif/core and tex-linebreak2 set the corpus equally well, both beat the browser's own wrapping only at a tight rag tolerance, and the harness that proves it re-runs on demand (MARXY-19)

### Security
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)

### Changed
- Dark is the primary variant: the reader opens dark by default on a warm near-black with off-white text, and light is a separately designed alternative rather than an inversion (MARXY-74, ADR-0024)
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- The startup measurement now reports two honestly named numbers — a cold start, which is the first launch and only the first launch, and a warm start, which is the median of the rest — after it turned out that the single number called "cold start" had always been a warm one, and that seven of eight Linux launches were being thrown away unmeasured (MARXY-63)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)
