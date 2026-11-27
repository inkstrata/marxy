# perf-record: review

Saved by the orchestrator from the reviewer's final message. Opus reviewer (the builder was Sonnet), 24 November 2026.

## Verdict: ready after the reviewer's fix

Committed as `b6f8176a` on top of `40d36308` and `9bed3e34`. The worktree is clean.

**The baseline must be retaken.** The record is now version 2: `replacedTop` became `removedTop` plus `addedTop`, and the record gained a `meta.code` field. The old `interactions-master-17cfe661.json` still loads, but its node counts do not appear in a comparison and every compare against it warns.

## Does each number mean what its label says?

Every duration runs from the action until "quiet", meaning three polls 300 ms apart each showing under 10 ms of `TaskDuration`. That is about one idle second, capped at 120 s. Every step waits for quiet before it starts, so the browser's counts and times cover only that action. Before the fix, an undo or reload that hit the cap still recorded a number cut off there; it now records no sample.

- **open:** correct. First content is when the article holds the document's text; task time runs to quiet.
- **cursor key:** a fixed 150 ms window after each press, not until quiet. Typesetting that happens to run inside that window is counted. The handler time is the delay of one message posted after keydown.
- **first click:** correct. Handlers under 16 ms are not reported by the browser.
- **undo and reload:** the task time includes the typesetting after the change, which is why undo reads 8.7 s against the evaluation's 4 to 5 s. The node counts are honest now.
- **tab switch:** `shownMs` is wall-clock time in Node and includes Playwright's own click overhead (about 200 ms even on the short page). It is an upper bound.
- **Source to Read:** correct.

## Fixed in `b6f8176a`

- **Node counts:** taken out and put in are both counted and shown. Run end to end, the plain document's appended-line reload reads 0 taken out and 2 put in; undo reads 2513 and 2513.
- **Table:** every step leads with its counts. Undo, reload and open already recorded layout and recalc counts that were never printed or compared; now they are. A legend under each table says what each duration covers.
- **Record:** it now stores the git trees of `apps`, `packages` and `fixtures` and whether they were dirty. A baseline taken on the tool's commit therefore still names master's app code.
- **`--compare`:** it now warns when the two records differ in documents, steps, runs, keys, machine or record version, or when either tree was dirty. It also says when the app code is the same in both. Checked with `--against` on the old baseline, a short run, and both edited.
- **Browser fails to start:** the server is closed and the message suggests `--browser`. Before, the server was left running, though the process exited anyway.
- **Docs:** `docs/testing.md` and `scripts/README.md` now cover compare counts first, the definition of quiet, about ten minutes, and the new fields.

## Robustness

- The server takes a free port (port 0) and the browser is closed in a `finally`. Ctrl+C relies on Playwright closing the browser and the process ending.
- It exits non-zero only when a requested number is missing, or on a crash.
- Nothing is written to the repository unless a path is given. Vite's cache under `node_modules/.vite` is the only exception, as with `shots`.

## Mutation results

All eight were caught: the documents-or-steps warning, the runs/keys warning, the dirty warning, "same code" ignoring a dirty tree, swapped change sign, counts printed after durations, and two to the definition escaping (indent limit, the `]:` lookahead). The dirty case survived at first; a test was added and it is now caught.

## Tests on `b6f8176a`

- `node --test scripts/measure-interactions.test.mjs scripts/readme-index.test.mjs`: 20 pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check` (10/10): green.
- The tool ran end to end twice with `--runs 1`: short document only in 27 s, and plain plus short, which exited 0.
- No verify turn: only scripts and docs changed.

## To file for later

- An undo or reload is accepted once any mutation lands inside the article, including typesetting alone. It should wait for a change to the article's own children.
- The cursor-key window is fixed at 150 ms.
- Tab `shownMs` should be timed inside the page.
- Only Edge has been tried.

Scratch files are under `C:\Dev\reader\work\wave1\perf-record\`.

## Orchestrator's notes

- Ready for integration at `b6f8176a`. The reviewer's fix was scripts and docs only, so the builder's verify on the first commit stands; the integration branch's full verify covers the tip.
- The baseline was retaken at version 2 after this review (see the wave's log for the file). The version-1 file is kept beside it with `-v1` in its name.
- The four "file for later" items are small and all bear on how far the numbers can be trusted; the first (an undo accepted on typesetting alone) could make an undo look instant when it has not happened yet. Worth a small branch before the tool is used to judge `splice-all`.
