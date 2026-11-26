# dead-code: Opus review

Reviewer of record, started 16:55. The builder stopped before reporting, so this was reviewed from the brief and the diff; there is no `report.md`. Saved by the orchestrator from the reviewer's text report.

**Verdict: ready after its fix.** The fix is `83ce3672` on `agent/dead-code`: it drops the stale `apps/desktop/src/library` key from `scripts/verify-map.json` and corrects two comments in `facts.ts` that still named the removed `words:` filter and "the library".

**The unit-scripts failure was real, not load.** The test was `scripts/verify.test.mjs`, "the shipped map keys are folders that exist". The branch deleted `apps/desktop/src/library` but left its key in the map, and the file failed alone too. With the fix it passes 17/17, and `verify.mjs --check-map` finds no stale names, no unlisted tests and no unmapped folders.

**Verify turns:**

- **On `373a5830`:** 10/12. The browser red was `frame-fonts.test.mjs`, which passes 5/5 alone, so that was load.
- **On `83ce3672`:** 11/12. The one browser red was `source-looks.test.mjs`, "Source tokens carry the --marxy-tok-* colours" ("no token span with text inline"). It failed once more alone while the machine was loaded, then passed 12/12 twice in a row. The diff doesn't touch Source highlighting, and the test's Markdown path never waits for tokens, so the reviewer judges it a timing flake.
- `pnpm typecheck`, `pnpm lint` and `pnpm check` (10/10) pass on `83ce3672`.

**How removals were checked:**

- The whole repo was searched by string for every removed symbol, module path and class name: `registry.json`, `verify-map.json`, docs, the HTML entries, the Rust side and the shell implementations.
- Nothing live still reaches anything removed. No Tauri command backs the five removed Shell members.
- Name clashes are separate symbols: `themeLabel` (settings-schema), `caretOf` (block-edit), `PROSE_KINDS` (guess-now), and `apps/desktop/src/{position,paste}/index.ts`.
- `immediateScheduler` was kept, which is justified: the typeset test harness uses it.

**Changes the brief did not spell out, all justified:**

- The `Edit` type moved to `buffer.ts`.
- `measureText(...).words` became `countWords`, which is identical.
- The pack tests now point at the operations directly.
- The `.marxy-set-*` styles that only `setsSection` drew were removed.

**Coverage and docs:**

- The front-matter tests were rewritten as 12 tests of reading only; the user-facing refusal strings are unchanged.
- Dropping `reload.ts` also dropped the indirect tests of `blockAt`.
- `docs/` and `scripts/README.md` are still true.

**Size:** 66 files, 25 of them deleted. Lines: -3002/+60 in source and -2576/+125 in tests.

**Bundle:** the `checks-digest` and `checks.worker` chunks are gone from `build:web`. `dist` went from 29,105,873 to 28,969,827 bytes (-136 KB), and from 943 to 941 assets. The entry chunk is 1,382,623 bytes; whether it shrank is unknown, since the only master build on disk predates master's tip (it read 1,374,982).

**To file:** `source-looks.test.mjs` should wait for Markdown token spans before asserting; it is flaky under load.

## Orchestrator's notes

- `source-looks` has now failed under load in three branches' turns (`grammars-once`, `verify-defaults`, `dead-code`), none of which touches Markdown token colouring, and passes alone on master 3/3. A wait patch is at `work\wave1\grammars-once\review\source-looks-wait.patch`. If it reds in the full verify on `agent/wave1`, rerun it alone per the landing rule; fixing it belongs to a later branch, not wave 1.
- Bundle sizes for landing come from fresh builds of master and of the `agent/wave1` tip, not from any one branch's figures.
