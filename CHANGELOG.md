# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), one line per pull request, written for
a reader of marxy, Jira key in parentheses. Release notes are generated from `Unreleased` at
tag time. Conventions in `docs/conventions.md`.

## Unreleased

### Added
- Agents land a pull request once the quality bar is met: a signed review of that exact commit, green gates, and the story's path boundary — CODEOWNERS paths still wait for a person (MARXY-79)
- The orchestrator fleet can run cheaper: `--low` is Sonnet 5 medium plus Grok 4.6 High Fast, `--minimal` is Grok 4.6 High Fast only
- Opening a document can now index the repository around it — honouring ignore rules, skipping `node_modules` and the rest of the deny list, stopping at fifty thousand files — after the first page paints, and the index is kept on disk and rebuilt when a file's mtime changes (MARXY-35)
- Hygiene tooling for the agent fleet: pre-commit story-boundary and name checks, module import rules, a dependency allow-list, a PR checker, path-aware precheck, a one-command definition of done that drafts the PR body, and generators for modules, operations and shell commands (MARXY-74)
- Design documents for every subsystem and a task card per Phase 1–2 story, so implementors build from decisions already made; ADR-0023 fixes how rendered elements carry their byte provenance (MARXY-74)
- Documents are parsed: CommonMark, GitHub-flavoured markdown, frontmatter and math become one AST in which every node knows the bytes of the file it came from, checked against the CommonMark reference implementation and against golden files for the whole fixture corpus (MARXY-11)
- Repository scaffold: frozen contracts, fixture corpus, CI gates, ADRs seeded from the brainstorm, a hello-world desktop app (bootstrap)
- Orchestration kit for running the agent fleet from Cursor: role prompts, board scripts, subagent definitions (bootstrap)
- Conventions for commits, pull requests, comments, tags and reviews, enforced by commitlint (bootstrap)
- The development process on one page in `docs/sdlc.md`: four board states, a WIP limit, definitions of ready and done, traceability and the release runbook (MARXY-10)
- A Jira bridge (`orchestration/jira.mjs`) that mirrors the backlog and the board into the tracker and links pull requests to issues (MARXY-10)
- Review approvals are signed against the commit they were read at (`orchestration/approve.mjs`), so a push after a review holds the merge instead of inheriting it (MARXY-10)
- Open a document from the command line: `marxy README.md` reads the file and shows it, unstyled for now, and reports the moment the first text was painted (MARXY-13)
- Taste review #0: the long corpus document set in both candidate typeface pairs at the type scale and a 68ch measure, for the decision that settles ADR-0015 (MARXY-17)
- Saving a document puts back exactly the bytes it had: a byte-order mark, Windows line endings and a missing final newline all survive, the file is replaced by a rename rather than written in place so a crash cannot truncate it, its permissions are kept, and marxy refuses rather than silently changing a read-only, hard-linked or someone else's file (MARXY-14)
- Measured decision note on ragged-right line breaking: justif/core and tex-linebreak2 set the corpus equally well, both beat the browser's own wrapping only at a tight rag tolerance, and the harness that proves it re-runs on demand (MARXY-19)
- The document and theme contracts stay frozen at the last ADR-sanctioned revision: a workspace check fails if they change without an ADR (MARXY-5)

### Fixed
- Commit messages may name other stories in their body again; the key-in-subject rule is now checked directly instead of through the parser's issue references, which mistook any mention for a footer (MARXY-10)
- The anti-attribution hook the conventions promised now exists in `.githooks/commit-msg`, so trailers injected by agent tooling are stripped rather than merely forbidden (MARXY-10)

### Security
- A document now reaches the screen through a default-deny allow-list: nothing in a file a stranger wrote can execute, and nothing in it can fetch, so a remote image or a badge shows its alt text rather than telling whoever hosts it that you opened the file — checked over the whole fixture corpus in both browser engines, with a control that proves the check can see a request when one is made. A document also cannot make the rest of itself a link to somewhere else, and a checkbox written into a file stays as the file has it, because marxy is a reader. Text a browser keeps as text stays text: marxy will not turn something a document hid inside a `<plaintext>` or a comment into an image it then fetches for you, and a large or hostile file is cleaned in milliseconds rather than seconds (MARXY-12)
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)

### Changed
- Dispatch is uncapped: path overlap is the only parallelism limit, so returned PRs no longer sit idle waiting for a free lane
- CI is faster and steadier: parallel jobs with cached Rust, pnpm, apt and browsers, docs-only changes skip the build, a thin-LTO CI build profile, timeouts on every job, one required status check, and perf breaches re-measured once before they fail (MARXY-83)
- Dark is the primary variant: the reader opens dark by default on a warm near-black with off-white text, and light is a separately designed alternative rather than an inversion (MARXY-74, ADR-0024)
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- Jira is now the board of record: all 51 epics and stories exist as issues, and story keys throughout the repo are the real Jira keys (MARXY-10)
- The startup measurement now reports two honestly named numbers — a cold start, which is the first launch and only the first launch, and a warm start, which is the median of the rest — after it turned out that the single number called "cold start" had always been a warm one, and that seven of eight Linux launches were being thrown away unmeasured (MARXY-63)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)
