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
- Open a document from the command line: `marxy README.md` reads the file and shows it, unstyled for now, and reports the moment the first text was painted (MARXY-13)
- Taste review #0: the long corpus document set in both candidate typeface pairs at the type scale and a 68ch measure, for the decision that settles ADR-0015 (MARXY-17)
- Saving a document puts back exactly the bytes it had: a byte-order mark, Windows line endings and a missing final newline all survive, the file is replaced by a rename rather than written in place so a crash cannot truncate it, its permissions are kept, and marxy refuses rather than silently changing a read-only, hard-linked or someone else's file (MARXY-14)
- Measured decision note on ragged-right line breaking: justif/core and tex-linebreak2 set the corpus equally well, both beat the browser's own wrapping only at a tight rag tolerance, and the harness that proves it re-runs on demand (MARXY-19)

### Security
- A document now reaches the screen through a default-deny allow-list: nothing in a file a stranger wrote can execute, and nothing in it can fetch, so a remote image or a badge shows its alt text rather than telling whoever hosts it that you opened the file — checked over the whole fixture corpus in both browser engines, with a control that proves the check can see a request when one is made. A document also cannot make the rest of itself a link to somewhere else, and a checkbox written into a file stays as the file has it, because marxy is a reader. Text a browser keeps as text stays text: marxy will not turn something a document hid inside a `<plaintext>` or a comment into an image it then fetches for you, and a large or hostile file is cleaned in milliseconds rather than seconds (MARXY-12)
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)

### Changed
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)
