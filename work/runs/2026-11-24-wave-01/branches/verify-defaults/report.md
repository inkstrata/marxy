# verify-defaults: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Sonnet builder, 24 November 2026. Branch `agent/verify-defaults`, base `17cfe661`.

The final `verify --tier changed` turn is green on the tip, `d70aa2c6`: 14 of 14 steps passed in 1219.5 s. Log: `C:\Dev\reader\work\wave1\verify-defaults-verify.log`. Logs and timings are in `C:\Dev\reader\work\wave1\verify-defaults\` (`unit-before.log`, `after-plain-1..3.txt`, `after-browser.txt`, `list-support.txt`, `list-scripts.txt`).

## Commits

- `c10697e9` feat(scripts): verify runs Node-only desktop unit files side by side and gives support changes a smoke set
- `b5270057` refactor(scripts): the 9 MB Source scroll is a measurement script, not a test
- `60a7d978` test(scripts): drop the tree-wide re-runs of checks that pnpm check already ran
- `d70aa2c6` fix(desktop): package scripts that set a variable run under pnpm on Windows; drop test:lite

## What changed (tools only, nothing the reader sees)

1. The changed tier now defaults to `--jobs 2` (full stays 3, quick 1); `--jobs` still overrides.
2. The desktop unit step is split in two.
   - History search: `git log -S"--test-concurrency=1"` shows only the baseline import's package.json `test` script (one serial command over unit and browser files), the browser triage doc and verify's first commit. No reason is recorded for the unit step. It inherited the serial default of that all-in-one script.
   - `unit-desktop` runs the Node-only files side by side. `--unit-jobs` sets how many (new option; default cores minus one, at most 4).
   - `unit-desktop-browser` runs the files that start WebKit one at a time: `source/frame`, `source/source-browser`, `theme/measure-face` and `notices/config-warnings-wired`. That last one is the "one more": the old globs never ran it.
   - `render/images-paths` was also outside the old globs and now runs in the Node-only set. Both new files pass.
   - Node has no glob exclusion, so `verify.mjs` builds the file list by walking `src`. A test fails if a Node-only file imports playwright, vite or the browser helpers.
3. The 9 MB scroll test is out of the suite. `scripts/measure-source-scroll.mjs` does it and is listed in `scripts/README.md` and `docs/testing.md`. Run once: 9 MB, 52,141 lines, longest frame 22.0 ms, 0 frames over 100 ms, 179 s on a loaded machine. The skip pattern in `verify.mjs` is gone.
4. The three tree-wide "green over the committed tree" cases are removed from check, check-registry and check-boundaries. The fixture cases stay.
5. A change under `test/support/` now runs `SUPPORT_SMOKE`, 30 files (all in the map, including the 5 fallback files). A change under `apps/desktop/scripts/` runs no browser file. Proof, from the committed tree with a probe file: `verify --tier changed --list --base HEAD` shows "browser files: 30" for `test/support/` and "browser files: 0" with no browser step for `apps/desktop/scripts/`.
6. `shellEmulator: true` in `pnpm-workspace.yaml` fixes all four scripts (the builder reports pnpm as 12.6.0).
   - Before, `pnpm --filter @marxy/desktop run verify:cli` printed "'MARXY_SMOKE_REQUIRED' is not recognized".
   - After, it starts and takes the required-mode branch ("no release binary; build apps/desktop first", exit 1, not the skip), so the variable is set.
   - core's `test:invariant-stress` also started; it was stopped.
   - `test:lite` is deleted, since nothing ran it. Three test header comments and the desktop README mentioned it; those are fixed.
   - `AGENTS.md` and `docs/development.md` are corrected.
7. `docs/testing.md` and `scripts/verify.test.mjs` are updated to match.

## Measured (noisy)

Machine load while measuring: other builders, another session's full verify, about 47 chrome and 20 or more node processes on 16 cores.

- `unit-desktop` before: one serial run, 1320 tests, 1319 pass, 1 skip (the 9 MB test, skipped by pattern), 360.5 s.
- After, Node-only step, three runs at `--unit-jobs 4`: 95.0, 87.6 and 89.2 s, each 1279 pass, 0 fail. No file depends on another's state.
- After, browser step: 195 s, 44 pass, 1 skip (the optical-size test, skipped as before). About 285 s in total against 360 s. The browser files now dominate.
- In the verify turn the two steps took 56 s and 102 s.

| Step in the verify turn | Pass count |
| --- | --- |
| unit-core | 4316 (3 skip) |
| unit-theme | 305 |
| unit-typeset | 80 |
| unit-scripts | 245 |
| unit-desktop | 1279 |
| unit-desktop-browser | 44 (1 skip) |
| browser | 486 (3 skip) |

The browser step ran 41 files at `--jobs 2` in 664 s. Targeted scripts tests: 78 pass across verify, readme-index, check, check-registry and check-boundaries.

## Revert-and-fail proof

Each mutation was made in `verify.mjs`, `verify.test.mjs` run, then restored with `git checkout -- scripts/verify.mjs`.

- Jobs default changed to 1: the jobs-default test fails.
- Support branch disabled: the smoke-set test fails.
- `frame.test.mjs` removed from the browser declaration: the "desktop unit files" test fails.
- `NO_BROWSER_PREFIXES` emptied: the "no browser file" test fails.
- After restoring, 0 fail.

## Not done, and calls the orchestrator should know about

- `apps/desktop/package.json`'s `test` script still runs everything at `--test-concurrency=1`. It was not in the brief.
- The tests in `apps/desktop/scripts/` (smoke-verdict, shots, real-window-fixtures) are in no verify step. A change there now runs no browser file and no desktop unit suite.
- `SUPPORT_SMOKE` is in `verify.mjs`, not in the map, so the map's format is untouched.
- The unit file set was widened to take in `notices/config-warnings-wired` and `render/images-paths`.
- `--unit-jobs` was added.

## Orchestrator's notes for the reviewer

- `shellEmulator: true` changes how every package script in the workspace runs, not only the four that were broken. The verify turn exercised typecheck, lint, check and the unit suites. It did not exercise the scripts that chain commands, change directory, quote arguments or pass globs: `lint:rust` (`cd ... && cargo fmt --check && cargo clippy ...`), `build` and `bundle` (`vite build && tauri build --no-bundle -- --locked && node ...`), the root `test` (unquoted globs `scripts/lib/*.test.mjs scripts/*.test.mjs`, which an emulated shell may expand differently from cmd), the theme's `echo 'css only'`, `pnpm work installer -- args`. Run each far enough to see it parses and starts as before.
- The builder reports pnpm as 12.6.0. The repository pins 11.18.0 and a pnpm started inside the tree resolves to that. Confirm which version actually ran, and that the setting's name and place are right for the pinned one.
- Tests under `apps/desktop/scripts/` run in no verify step, and a change there now also runs no browser file. That gap existed before for the unit side; decide whether this branch made it worse and whether those tests should join the scripts unit step.
- The default of up to four unit files at once, beside two browser files, on a machine several builders share: check it against the side-by-side rules in `docs/working.md` and say whether the default should be lower.
