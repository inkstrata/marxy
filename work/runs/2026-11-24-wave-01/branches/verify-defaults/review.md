# verify-defaults: Opus review

Reviewer of record, started 16:55. Saved by the orchestrator from the reviewer's text report.

**Verdict: ready after its fix.** Fix `b2e902e2` is on top of `fd9d6bf0` (the latter committed by an earlier reviewer that was stopped). The worktree is clean.

**What it checked**

- **The diff against the report.** Every claim holds. `fd9d6bf0` is sound: it adds the `apps/desktop/scripts` tests to the unit step and widens the guard.
- **`shellEmulator`.** In-tree pnpm is 11.18.0 and the setting reads true. Run for real in the tree:
  - `lint:rust` (a cd chain, exit 0), theme `build` (echo), `verify:cli` (reaches the required-mode branch, so the variable is set), `work`, `verify --only lint,check --list`, typecheck, lint and check.
  - The verify turn already covered the quoted globs and `&&` chains in the core, theme and typeset `test` scripts.
  - A scratch workspace copied the exact strings of root `test` (unquoted globs), `build`/`bundle` (`&&`, `-- --locked`) and `lint:rust`, with stand-ins for vite, tauri and cargo. Every argument arrived intact, `cd` took effect, and a failure stopped the chain. `--` passthrough behaves the same as under cmd.
- **Side-by-side unit step.** Each file runs in its own process. There are no fixed ports, every file write goes through mkdtemp, and the only spawn is the smoke self-test. No order or shared-state dependency is possible beyond those, and none was found.
- **The guard hole.** Real but not a must-fix. One file hits it today: `scripts/shots.test.mjs` imports `shots.mjs`, which loads vite and playwright, but only inside functions the test never calls.
- **Smoke set.** Not sensible as it stood:
  - A support change ran no desktop unit tests, though four unit files import `test/support/` helpers (`source-roles.mjs`, `prng.mjs`).
  - No smoke file used the Tauri stubs (9 users).
  - Both gaps also existed before this branch.
- **`docs/testing.md`.** Matched verify except one line overstating the guard. Fixed.

**Mutations** (each against `verify.test.mjs`, then restored): no `scripts` walk; scripts not in the desktop suite; jobs default back to 1; smoke branch removed; frame file undeclared; browser step run side by side; the new desktop-suite line removed. Every one fails a test; 22/22 pass after restore.

**Fix `b2e902e2`:** a support change also runs the desktop unit suite. `tauri-subscriptions.test.mjs` joins the smoke set (8/8 alone). The guard wording in the doc is corrected.

**Verify turn on `b2e902e2`:** 13/14. The browser step had one failure, in `source-looks.test.mjs`. Run alone it failed once while the machine was loaded, then passed twice (12/12), so it is load. The test reads token colours straight after the lines appear.

**File for later:**

- The guard should follow a test file's imports.
- The desktop `test` script is still serial and misses `src/notices` and `src/render`.
- The race in `source-looks`.

## Orchestrator's notes

- Checked: the tip is `b2e902e2` and the worktree is clean. The verify turn ran from 17:21:51 to 17:43:13: unit-desktop 1296 in 58 s plus 44 browser-starting files in 201 s, browser 485 pass, 1 fail. It was the whole changed tier in about 21 minutes, against 30 to 38 minutes for other branches' turns.
- The `source-looks` red also hit `grammars-once`'s turn. This branch does not contain that change, so the race is on master's code. Counted as load here by the reviewer's alone-runs (1 fail, 2 pass), which is weak evidence; the full verify on `agent/wave1` will show it again if it is worse than that.
