# Changelog

Format: [Keep a Changelog](https://keepachangelog.com), one line per pull request, written for
a reader of marxy, Jira key in parentheses. Release notes are generated from `Unreleased` at
tag time. Conventions in `docs/conventions.md`.

## Unreleased

### Added
- The planner is now due when more than half of the last 10 merges were ops, naming the counts, and a blocked or escalated story it has already ruled on (its `blockedAt` predates the last plan) no longer keeps it due forever; a `dropped` story is refused by `ready.mjs` with its own rule, the same way `planner-trigger.mjs` already treated the label as settled (MARXY-120)

### Changed
- A taste decision on the default theme now costs a story and a review-queue row, not an ADR: theme authors can still rely on the token names, units and meanings (MARXY-133)
- The orchestrator fleet has four compute levels instead of three: `high` (new, Opus tier) for judgement quality, `default` and `low` moved to Sonnet-led with Composer 2.5 as an implementor experiment, and `minimal` redefined as a Cursor-only floor (Composer + Grok, never Claude/GPT/Gemini) whose escalation ceiling is Grok by construction; Grok's `-fast` variant is dropped everywhere for the plain model, based on a two-round reviewer-judgement pilot across six models (MARXY-136)

### Added
- The no-network gate now prints which request classes it can and cannot observe (WebSocket, dns-prefetch, service worker registration), proves the allow-list refuses each one's required element, and fails on its own silence if the set of checks it runs ever drifts from the list it declares; a mutation-coverage suite fails a named test for each of those checks if it is ever deleted (MARXY-83)
- The fixture corpus now has a real API reference, changelog, agent transcript and source file, so typesetting and aesthetics judgements are no longer made only on prose and a README (MARXY-130)
- Opening quotes hang into the margin and long English words can hyphenate from allow-listed en-us/en-gb patterns, so the left edge reads flush and a long word no longer leaves a hole (MARXY-24)
- A document can now be typeset in a headless page — the same column, faces and line-breaker the app uses, without opening a window — and CI fails if the grid, measure, contrast, rag or headings drift on the corpus (MARXY-25)
- The app can now be started in a browser against an in-memory shell, so later stories can drive the real UI without Tauri; the startup pins now read `app.ts`, where the code actually lives, and the sanitised render write is back in the registry's innerHTML allow-list (MARXY-95)
- `pnpm done KEY --open` is now one command from a filled acceptance table to In Review: it copies the table into the result file, opens the PR through `open-pr.mjs`, and moves the Jira issue, stopping before `gh` runs if a row is still `TODO` or the body fails `check-pr` (MARXY-121)
- Two stories now overlap only when a listed path (glob or not) could actually match the same file, so a shared prefix like `parse`/`parser` no longer serialises unrelated work and every story's shared files (CHANGELOG.md and friends, read from the registry) no longer count as a collision (MARXY-119)
- The MARXY-95 escalation plan is on main: its second attempt may now touch the startup test and the render allow-list, plus six new stories and ADR-0031 (proposed) for the taste-review backlog (MARXY-131)
- CI now measures how long the long technical document takes to parse on both gates runners before the perf gate, so that budget can become a required check without loosening anything (MARXY-91)
- A document is now a byte buffer with splice and undo, so an operation can change a range without rewriting the rest of the file (MARXY-93)
- The after-65 plan is on main: MARXY-93–98 are restored, MARXY-115 is dropped, and MARXY-93 and MARXY-95 can cut from main (MARXY-125)
- Design documents and a task card for every Phase 3–4 story: per-document trust for HTML and remote images (fetched only by the shell, only on consent — the page itself never touches the network), the release and v1 checklist, and ADR-0026/0027; five new stories (MARXY-93–97) close gaps found on the way (MARXY-98)
- The agent loop now merges only the commit that was approved, refreshes one out-of-date pull request at a time, and will not dispatch onto a plan that is due to change (MARXY-106)
- Process work now has its own lane beside the numbered phases, so leftover fleet and CI stories no longer hold the page (MARXY-107)
- Paragraphs are line-broken as a whole, the way a book is set: the right edge is evener, holes at line ends are a third as common, and the text still selects, copies and searches exactly as before (MARXY-23)
- Text is set in Literata and code in JetBrains Mono, bundled with the app and loaded before the first text appears, so a page never flashes a fallback face; on Linux every weight is lifted to match macOS (MARXY-21)
- Documents are set in the default theme: a 68-character column on a warm dark page, a type scale in which headings are bound to what follows them, code in its own voice with long lines hanging under themselves, and every block on one grid so a long document never drifts (MARXY-20)
- Every element on the page now knows which bytes of the file it came from, and a document cannot claim bytes it did not write; inline HTML such as `<kbd>Ctrl</kbd>` keeps its shape (MARXY-75)
- Branch protection and the merge methods on main now have a standing check, so a setting that drifts (or was never set) fails instead of waiting for someone to remember to look (MARXY-82)
- The reviewer prompt now writes and signs the approval file on a merge verdict, and the implementor prompt forbids writing it, so the merge handshake is the same rule in the prompts and on the process page (MARXY-79)
- The after-8 plan is on main: MARXY-79 is the prompt-and-docs slice, and MARXY-109 and MARXY-110 sit in the sequence so those branches can cut from main (MARXY-111)
- Headings can now be read off a document as an outline, each entry keeping the heading's place in the file, so a summoned outline has something to jump to when it lands (MARXY-109)
- Lint now runs through biome: an unused import fails the build, the formatter only checks, and it never rewrites the fixture corpus or the fonts (MARXY-8)
- Out-of-plan work has a supported path: `jira.mjs task` creates a labelled Task and prints the key, and a missing commitlint fails the commit instead of skipping (MARXY-101)
- An approval run now ends with one table of every open pull request in merge order — CI, mergeability, approval, who it waits on, and what happens next (MARXY-92)
- Review is capped at four in-flight pull requests, only the next branch in the computed order is updated each cycle, and an approval cannot be signed until that pull request is first, current and clean (MARXY-81)
- The review queue is now a computed order — phase, then how many other open pull requests a merge would disturb, then age — so the branch that invalidates the most approvals lands first (MARXY-80)
- A pull request cannot be opened unless its body is the house template: `open-pr.mjs` runs the checker first, and the checker now also refuses a Why / Test plan body, a leftover TODO in the acceptance table, and an attribution line (MARXY-104)
- Every pull request re-checks the taste-review #0 specimen against the type scale and the review queue, so a missing image or a drifted size fails the build rather than waiting for someone to remember (MARXY-62)
- Only the security posture and the merge gate itself now wait for a person. Typesetting, theme, contracts, `shell-api` and ADR changes land on a signed review, and taste is checked in the review queue (MARXY-99)
- CI now fetches the CommonMark specification examples — never committed — and fails the build if a parse diverges from them (MARXY-68)
- Straight quotes, double hyphens and three dots become the marks a book would use when you read a document, and a short last word stays on the line with the one before it; the file itself is not touched (MARXY-29)
- Agents land a pull request once the quality bar is met: a signed review of that exact commit, green gates, and the story's path boundary — CODEOWNERS paths still wait for a person (MARXY-79)
- The orchestrator fleet can run cheaper: `--low` is Sonnet 5 medium plus Grok 4.6 High Fast, `--minimal` is Grok 4.6 High Fast only
- An open document reloads when its file changes on disk and the reading position stays put; a save will not silently overwrite a file someone else has changed (MARXY-34)
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
- The corpus now includes a long prose document, so line-breaking work can measure real paragraph volume instead of a handful of samples (MARXY-64)
- Measured decision note on ragged-right line breaking: justif/core and tex-linebreak2 set the corpus equally well, both beat the browser's own wrapping only at a tight rag tolerance, and the harness that proves it re-runs on demand (MARXY-19)
- The document and theme contracts stay frozen at the last ADR-sanctioned revision: a workspace check fails if they change without an ADR (MARXY-5)

### Changed
- The default faces are confirmed: Literata for text and JetBrains Mono for code, after reading both candidates at the type scale; the column stays 68 characters (MARXY-127)

### Fixed
- `overlap()`'s `parse`/`parser` regression test now checks both argument orders; the one-directional version passed even against the pre-MARXY-119 buggy implementation, so it never actually guarded the asymmetric `startsWith` collision the story fixed (MARXY-134)
- MARXY-83's board row named a gate file and an ADR file that don't exist, which blocked four attempts on a path mismatch rather than the sanitiser gate itself; `Paths` now names the real `scripts/gate-no-network.mjs` and the real, accepted `docs/adr/0009-security-posture.md` (MARXY-135)
- On a detached CI checkout the merge-bar CHANGELOG check takes the story key from the pull-request branch GitHub already knows, and skips when none of those names have a key instead of failing the build (MARXY-124)
- The merge-bar CHANGELOG check no longer requires a finished story's line on every later pull request; an empty hunk against main skips, and a hunk that adds a story line must name the current branch's key and delete none (MARXY-123)
- Fast CI no longer fails the phases 600-line three-dot check on a shallow checkout that has no `origin/main`; the test skips when neither that ref nor `main` is resolvable (MARXY-114)
- Outline tests no longer fail a later core story that edits package.json, scripts or the desktop app; that leftover three-dot lock was MARXY-109's own boundary (MARXY-113)
- Readiness tests no longer fail a branch that edits the board files MARXY-107 owns; that leftover three-dot check is gone (MARXY-112)
- A save on Linux keeps the file's extended attributes and POSIX ACLs instead of dropping them, and the check that proves a save puts every byte back now lives with the other gates (MARXY-77)
- Fast CI no longer fails the readiness three-dot check on a shallow checkout that has no `origin/main`; the test skips when neither that ref nor `main` is resolvable (MARXY-108)
- Merging `main` into a story branch no longer fails the commit hook with every file the merge carried; a merge commit answers for what its author resolved (MARXY-85)
- A story whose pull request is still in review now holds its listed paths, so the board will not start a second story on the same files (MARXY-102)
- The board scripts now sequence by phase and say why a story is waiting — a dependency, a path overlap, or a full lane — instead of counting every wait as a dependency, and a review without a branch no longer passes as clean (MARXY-9)
- CI can build again on Linux: the webview dependencies are installed rather than restored from a cache that dropped their metadata, and a check keeps third-party actions out of our builds (MARXY-90)
- CI installs the Linux webview libraries with apt again; the cached install dropped a file the Rust checks need, which turned every build red (MARXY-74)
- Commit messages may name other stories in their body again; the key-in-subject rule is now checked directly instead of through the parser's issue references, which mistook any mention for a footer (MARXY-10)
- The anti-attribution hook the conventions promised now exists in `.githooks/commit-msg`, so trailers injected by agent tooling are stripped rather than merely forbidden (MARXY-10)

### Security
- The hostile fixture now carries every attack family the sanitiser already knew about, including the two a reviewer found, so the corpus sweep is what watches them rather than a probe string inside a test (MARXY-73)
- A document now reaches the screen through a default-deny allow-list: nothing in a file a stranger wrote can execute, and nothing in it can fetch, so a remote image or a badge shows its alt text rather than telling whoever hosts it that you opened the file — checked over the whole fixture corpus in both browser engines, with a control that proves the check can see a request when one is made. A document also cannot make the rest of itself a link to somewhere else, and a checkbox written into a file stays as the file has it, because marxy is a reader. Text a browser keeps as text stays text: marxy will not turn something a document hid inside a `<plaintext>` or a comment into an image it then fetches for you, and a large or hostile file is cleaned in milliseconds rather than seconds (MARXY-12)
- The licence gate now resolves a licence for every package in the lockfile and for every allow-listed grammar and hyphenation pattern, and fails on copyleft or on any licence it cannot determine (MARXY-7)
- The licence gate now audits the 430 Rust crates that link into the shipped binary too, so a copyleft crate can no longer reach a release unnoticed (MARXY-57)
- The licence gate now runs a second time after the desktop build, against the real cargo cache, so a stale crate-licence record cannot hide behind a file the same pull request wrote (MARXY-65)

### Fixed
- `pnpm build` no longer fails on a machine whose display is asleep; the smoke check skips with the environment named, and CI still requires a real paint (MARXY-72)
- Documents saved with Classic Mac (CR-only) line endings keep code-block ranges on the code itself, not an empty span past the fence (MARXY-67)

### Changed
- The board carries the whole-project review's remaining recommendations as six stories: board-drift detection, worktree pruning, glob-aware path overlap, a tripwire for process work outpacing product work, one-command handoff to review, and the merge queue (MARXY-116)
- Launch time is still measured; 500 ms is not a product promise, and a release is not failed for missing that figure (MARXY-110)
- A release now measures a genuine cold start on reference hardware — at least five launches, each made cold first — and the tag carries that measurement with no duration claim; 500 ms is not a product ceiling (MARXY-69)
- Commit messages are linted when they are written in every worktree, not first in CI, and the limits fit the story key: headers up to 100 characters, long footer lines a warning, `repo` and `workspace` scopes, squash-merge subjects accepted (MARXY-100)
- Opening a document now goes through the one parse in `@marxy/core`; markdown-it and DOMPurify are gone from the desktop and the gate harnesses (MARXY-61)
- Importing the parser no longer pulls in a maths renderer; documents with equations still parse the same (MARXY-60)
- Dispatch is uncapped: path overlap is the only parallelism limit, so returned PRs no longer sit idle waiting for a free lane
- CI is faster and steadier: parallel jobs with cached Rust, pnpm, apt and browsers, docs-only changes skip the build, a thin-LTO CI build profile, timeouts on every job, one required status check, and perf breaches re-measured once before they fail (MARXY-83)
- Dark is the primary variant: the reader opens dark by default on a warm near-black with off-white text, and light is a separately designed alternative rather than an inversion (MARXY-74, ADR-0024)
- First readable text is marked only after the engine reports a paint, so a hidden document can no longer produce a cold-start number (MARXY-71)
- The licence policy now records the audit that already ships — lockfile, store, recorded-licence allow-list, fail-closed — and applies the same rule to specifications and test vectors as to code (MARXY-58)
- Stack decided: Tauri, by a rule committed before the spike ran (bootstrap)
- Jira is now the board of record: all 51 epics and stories exist as issues, and story keys throughout the repo are the real Jira keys (MARXY-10)
- The startup measurement now reports two honestly named numbers — a cold start, which is the first launch and only the first launch, and a warm start, which is the median of the rest — after it turned out that the single number called "cold start" had always been a warm one, and that seven of eight Linux launches were being thrown away unmeasured (MARXY-63)
- Speed budgets are now measured in two tiers: the unchanged product budgets on reference hardware, and an envelope plus a per-runner baseline in CI, so a rented runner's slowness can no longer block a merge while a real regression still fails (MARXY-55)

### Fixed
- READMEs and licence files under fonts/ show a normal diff again; only font binaries stay binary, so a reviewer can read a text change; nothing under fonts/, licences included, can have its line endings rewritten, and `pnpm lint` fails if that ever changes (MARXY-66)
