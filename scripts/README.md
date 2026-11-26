# Tools

Every tool in the repository is a script run with Node (one is PowerShell); there is no build of the
tools themselves. This file lists the ones here and says where the rest live.

## Where a tool goes

| Folder | Holds | Listed in |
| --- | --- | --- |
| `scripts/` | what judges, measures or works on the repository as a whole, and is run from its root: checks, gates, runners, measurements, the work cycle | this file |
| `scripts/lib/` | modules those scripts share; nothing here is run by itself | below |
| `scripts/allowlists/` | data the checks read: allow-lists and licence records. No scripts | below |
| `apps/desktop/scripts/` | what the desktop package's own scripts and tests call: building, signing, launching and driving the app, and makers of its fixtures | [apps/desktop/README.md](../apps/desktop/README.md) |
| `packages/<name>/scripts/` | what that package's scripts and tests call, and its generators | the package's `README.md` |
| `fixtures/<set>/make-*` | the maker of a fixture set, beside the files it writes | [docs/testing.md](../docs/testing.md#fixtures) |

A new tool goes in the deepest folder whose package calls it. One that is run by hand from the root, or
reads more than one package, goes here. A tool with logic worth testing exports it and keeps
`<name>.test.mjs` beside it; `scripts/readme-index.test.mjs` fails when a script is in none of these
lists or a list names a file that is gone.

## Runners

| Script | Command | Does |
| --- | --- | --- |
| `verify.mjs` | `pnpm verify` | checks a tree in tiers with timings and a log per step ([docs/testing.md](../docs/testing.md#one-command-for-a-tree-pnpm-verify)); `verify-map.json` says which browser tests cover which folders |
| `check.mjs` | `pnpm check` | runs the repository checks below, one line each |
| `browser-tests.mjs` | `node scripts/browser-tests.mjs [--jobs n] test/<file>.test.mjs ...` | runs desktop browser test files over one shared dev server, build and WebKit |
| `work.mjs` | `pnpm work` | the workspace, the tracker, starting and clearing worktrees ([docs/working.md](../docs/working.md)) |
| `installer-windows.ps1` | `pnpm work installer` | builds, signs, keeps and installs a Windows installer of a ref |
| `ask.mjs` | `pnpm work ask` | questions for the owner as a page in the default theme, and their answers ([docs/working.md](../docs/working.md#questions-for-the-owner)) |

## Repository checks (run by `pnpm check`)

What each guards is in [docs/testing.md](../docs/testing.md#repository-checks-pnpm-check).

| Script | Reads |
| --- | --- |
| `check-boundaries.mjs` | every import in the packages and the app |
| `check-registry.mjs` | names in source against `registry.json` |
| `check-deps.mjs` | every manifest against `allowlists/dependencies.json` |
| `check-one-parse.mjs` | manifests, the lockfile and sources, for a second Markdown parser or sanitiser |
| `check-tokens.mjs` | `packages/theme/src/tokens.css` against `tokens.contract.json` |
| `check-csp.mjs` | the release CSP and every runtime stylesheet |
| `check-commonplace.mjs` | the bundled reading pieces under `apps/desktop/src/commonplace/` |
| `check-listeners.mjs` | window and document listeners in the app added with no signal and no remove, per folder, against `allowlists/listeners.json`; fails only when a count grows |
| `gate-font-attrs.mjs` | git attributes under `fonts/` |
| `gate-contrast.mjs` | every bundled theme's colours against their contrast floors |

## Gates run by name

| Script | Command | Does |
| --- | --- | --- |
| `gate-licences.mjs` | `pnpm gate:licences` | the licence of every package, crate, grammar and hyphenation pattern |
| `gate-fidelity.mjs` | `pnpm gate:fidelity` | saves are byte-exact over the corpus |
| `gate-no-network.mjs` | `pnpm gate:no-network` | rendering the corpus and the hostile vectors reaches nothing off the machine |
| `gate-bundle.mjs` | `pnpm gate:bundle` | what the shipped bundle may and may not hold, and its size |
| `gate-aesthetics.mjs` | `pnpm gate:aesthetics` | the rendered page over the corpus: grid, measure, contrast, rag |
| `gate-highlight-bundle.mjs` | run by core's highlight tests | no grammar off `allowlists/shiki-languages.json` is imported or bundled; in the build, each grammar is defined by one chunk and no page's import graph reaches one (the highlight worker alone loads them) |
| `gate-code-block-layout.mjs` | run by core's highlight tests | code blocks wrap with a hanging indent and never scroll sideways |

The golden and CommonMark gates are core's own ([packages/core/README.md](../packages/core/README.md)).

## Generators

| Script | Writes |
| --- | --- |
| `generate-highlight-languages.mjs` | `packages/core/src/highlight/languages.generated.ts` (the language table) and a second generated file of the lazy grammar imports, from `allowlists/shiki-languages.json` |

## Measurements

None fails on a number; each prints what it measured. Options are in each script's opening comment and
in [docs/testing.md](../docs/testing.md#measurement-tools).

| Script | Measures |
| --- | --- |
| `perf-harness.mjs` (`pnpm perf`) | open, render, typeset, reload and palette timings over the corpus or generated large files |
| `measure-interactions.mjs` (`pnpm perf:interactions`) | a cursor key, the first click, undo, reload from disk, a tab switch and Source to Read on a 195 KB and a 25 KB page in headless Edge: the main thread's task, script, layout and style time and counts, and the top-level nodes taken out and put in; records and compares runs (about ten minutes) |
| `measure-startup.mjs` | cold and warm start of the built binary, from its startup marks |
| `measure-reload.mjs` | live reload of a large transcript, stage by stage |
| `measure-typeset-idle.mjs` | what a 1 MB page writes and how long it holds the main thread, at rest and on a scroll |
| `measure-colour.mjs` | time to the first coloured token and the longest hold when a large code file opens |
| `measure-source-scroll.mjs` | the longest frame and the slow frames while a 9 MB file is scrolled in Source |
| `probe-layout.mjs` | column, gutter and block geometry of every corpus document over widths, sizes and variants |
| `bundle-report.mjs` | what each chunk of the desktop build holds |

## Shared

| File | Is |
| --- | --- |
| `playwright-webkit.mjs` | the WebKit launch every gate and browser test uses (`MARXY_BROWSER_HEADED=1` shows the window) |
| `registry.json` | registered names: startup marks, `marxy:` events, `data-marxy-*` attributes, private properties, files allowed to set markup from strings |
| `verify-map.json` | which browser test files cover which source folders |
| `lib/repo.mjs` | the repository root, a file walk, staged and changed files, the checks' failure format |
| `lib/imports.mjs` | import specifiers and `invoke(` calls read from the TypeScript syntax tree |
| `lib/machine-lock.mjs` | lock files in the OS temp folder for what one machine can run once (`check:tauri`'s port) or a few at a time (`verify`'s turn) |
| `lib/perf-record.mjs` | the read-merge-write of `results/perf.json` shared by two test suites |
| `lib/interactions-record.mjs` | the record of `measure-interactions.mjs`: its shape, medians, the comparison of two records and their tables |
| `lib/workspace.mjs` | the workspace around the checkout, worktrees and branch states |
| `lib/todo.mjs` | the tracker's reader |
| `lib/ask.mjs` | a question set's format, its check, the page it is drawn as, and the cleaning of answers sent back |
| `lib/ask-answers.mjs` | answers as Markdown; the page inlines it, so the page's Copy and `pnpm work ask read` write the same text |
| `lib/ask-page.css`, `lib/ask-page.js` | the question page's own rules over the default theme, and its behaviour |
| `allowlists/dependencies.json` | the npm packages and crates that may be depended on, and those that may never be |
| `allowlists/dependency-licences.json`, `allowlists/crate-licences.json` | licence records for packages and crates whose own metadata does not settle it |
| `allowlists/shiki-languages.json` | the highlighting grammars that may ship, each with its licence |
| `allowlists/hyphenation-patterns.json` | the hyphenation pattern sets that may ship, each with its licence |
| `allowlists/listeners.json` | the per-folder count of unowned window and document listeners that `check-listeners.mjs` holds the app to |
