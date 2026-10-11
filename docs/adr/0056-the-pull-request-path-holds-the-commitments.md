# ADR-0056 — The pull-request path holds the commitments, and nothing else

- **Status:** accepted (author, 2026-10-08: every default in `docs/plan/roadmap-2026-10/09-ci-and-precheck.md` §4)
- **Date:** 2026-10-08
- **Amends:** ADR-0046 decision 1 ("Linux builds in CI" becomes "Linux builds nightly, not on pull
  requests"). Extends ADR-0047 (the mechanical half of the aesthetics gate and the specimen gate are
  nightly too, not only the screenshot and rag comparison). Applies ADR-0032 and the rule in
  `docs/hygiene.md` ("a check earns its place on the pull-request path by being able to fail for
  something in the diff").
- **Evidence:** `docs/plan/roadmap-2026-10/09-ci-and-precheck.md` §1 (what was measured: a pull
  request waited about 10.5 minutes, a push to `main` about 9) and §2 (the table below).

## Context

A pull request waited about ten and a half minutes for `ci`. Almost all of it was four things: one
property test (fixed in G-01), a `typography` job of six to seven minutes, a Linux build and
release-profile binary on every Rust change, and 130 seconds of 1 MB browser tests. None of them
guards a commitment (`AGENTS.md`: free, private, faithful to the bytes, nothing hidden silently,
first text never waits). Each minute is paid by every pull request, and the author works alone.

## Decision

The pull-request path holds the five commitments and nothing else. Every commitment keeps a gate on
it; everything else runs in `.github/workflows/nightly.yml`, which is monitoring.

| Commitment | Held on the pull-request path by |
| --- | --- |
| 1. Free | `gate:licences` and `check-deps` (`fast`); `gate-licences --require-registry` over `Cargo.lock` after `cargo fetch --locked` (`rust`) |
| 2. Private | `gate:no-network`, and the lite files `release-csp`, `images`, `user-theme` (`browser-lite`); the theme sanitiser's unit tests (`fast`) |
| 3. Faithful | `gate:fidelity`, `gate:golden`, the splice property (`fast`); lite `save`, `explicit-save`, `data-loss`, `save-trust-r4`, `save-close-r5`, `close-guard`, `operations-edit`, `live-reload` |
| 4. Nothing hidden silently | core's unit tests for bidi, zero-width, link targets and folds (`fast`) |
| 5. First text never waits | the 1 MB first-text test in `progressive.test.mjs` (`browser-lite`) |

What stays: `changes`, `conventions`, `fast`, `browser-lite` in two shards, `rust` (macOS, only when
Rust or a dependency changed: format, clippy, `cargo test`, and the licence gate after a fetch), and
the aggregate `ci`.

What moves to nightly, and what a red there means. In every case a red nightly is **a note for the
next session, not a blocked merge**:

1. **The `typography` job.** `gate-aesthetics --mechanical` is already inside the full gate that
   `aesthetics-determinism` runs; the specimen gate is added to that job. Red: a typographic or
   specimen check moved after a change reached `main`. Find the commit, fix forward or revert. This
   extends ADR-0047: aesthetics is a value, not a commitment, and the author asked for no pixel or
   aesthetic enforcement at this stage.
2. **The Linux build.** The webview libraries, the thin-LTO binary, the CLI smoke and the post-build
   bundle gate stay in `rust-linux`, `startup-macos` and `built-app-smoke`. Red: a Linux-only
   fault. Linux is a pre-release platform (ADR-0046); if the cause is Linux-only, delete the job
   rather than fix it until Linux is a release goal again. The pull-request `rust` job moves to macOS,
   the product target.
3. **The fleet's tests.** The fleet is paused (ADR-0051). Red: a live document names an
   orchestration file that does not exist.
4. **The slower WebKit files** (G-04): `selection`, `links`, `index-service`, `palette-index`,
   `persist-reading`, `open-path`, `app-harness`, `single-instance`, and the 1 MB reading-position
   tests in `progressive-large.test.mjs`, in `browser-full`. Red: behaviour worth watching broke; no
   commitment floor did.

Path filters follow. Two outputs are gone (`typography`, `fleet`); four remain (`docs_only`, `web`,
`rust`, `lockfile`). `docs_only` widens to `changelog.d/`, `.claude/` and the fleet's prose
(`orchestration/README.md`, `orchestration/prompts/`, `docs/plan/tasks/`). It does **not** widen to
`AGENTS.md`, `docs/{sdlc,hygiene,plan,ci-contract}.md` or `docs/plan/jira-issues.csv`, although the
plan said it would: tests that stay in `fast` read those files (`lib/no-ceiling`, `check-story`,
`smoke-verdict`, `smoke-built-app`, `check-one-parse`, `lib/plan`), so a docs-only change to one of
them could turn `fast` red and, after the merge, `main`. `web` narrows from "anything under
`scripts/`" to the scripts the browser job runs or imports, and gains `tauri.conf.json`, whose CSP
the release-CSP test reads. `rust` narrows to the crate and the toolchain pin: the job no longer
builds a binary, so the Vite config and the CLI smoke cannot fail it.

## Consequences

- A code pull request waits about three minutes, a push to `main` about two and a half. G-05 measures.
- A Linux-only regression, a visual regression that passes `fast`, and a break in the CLI smoke
  reach `main` and show up on the next nightly. That is the price; the author opens the app daily.
- `check-workflows` accepts a `cargo fetch --locked` as filling the cargo cache for the
  `--require-registry` licence gate; its Linux-cargo rule still binds the nightly Linux jobs.
- Nothing is deleted. A month of nightly results decides which moved job is a deletion candidate.

## Rejected

- **Drop `browser-lite` from pull requests.** Faster, but the edit-after-reload data loss
  (MARXY-246) reached `main` through exactly that gap. Commitments 3 and 5 keep an app-level test.
- **Keep Linux on pull requests for compile breaks.** The Linux compile is nightly; the clippy and
  tests that matter run on macOS.
- **Delete the moved gates.** They cost nobody's time nightly.

## How we would know this was wrong

1. Two nightlies in a row show a regression the author only sees days later and wishes had been
   caught on its pull request: put that one check back, as a pure check.
2. A nightly job never goes red in a month, or goes red only for platform reasons: delete it.
3. A docs-only pull request turns `main` red through a file a test reads: add the file to the
   not-docs set in `scripts/ci-changes.mjs`.
