# Progress ledger

The only record of where the roadmap stands. One row per story; the lead updates it when a story is
dispatched, opened, returned, merged, split or parked. States: `ready`, `running`, `in review`,
`returned`, `merged`, `split`, `parked`. No machine writes this file.

| Id | Title | Model | State | PR | Worktree | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A-07 | Pause the fleet and unlock the conventions job | sonnet | in review | [#317](https://github.com/inkstrata/marxy/pull/317) | ../marxy-wt/A-07 (chore/a-07-pause-the-fleet) | Wave 0, lands alone. Dispatched 2026-10-02. Review (Sonnet): merge, 2 nitpicks (`(F-01)` passes as plain parenthetical; `docs/conventions.md:35` still names the old rule, for A-11). Awaiting author merge |
| A-01 | Grid pass in one read and one write per round; the large-document harness | opus | in review | [#319](https://github.com/inkstrata/marxy/pull/319) | ../marxy-wt/A-01 (perf/a-01-grid-pass-one-write) | Wave 1. Dispatched 2026-10-02 early, stacked on A-07's head (6b87684e) while #317 awaits merge; rebase --onto main after. 1 MB grid-stage bound not met: the cost is one forced whole-article restyle after fonts load (`app.ts:1110`), not the grid pass; bound moved to A-02 (plan amended). Review (Sonnet): merge; grid 1,935→1,915–2,024 ms (noise), `snapToGrid` alone 40→46 ms |
| A-04 | Give the index an owner: one index per root, published to the palette | opus | in review (merge) | [#318](https://github.com/inkstrata/marxy/pull/318) | ../marxy-wt/A-04 (feat/a-04-index-owner) | Wave 1; owns `app.ts`. Stacked on A-07 as above. Return 1: failed first walk cached forever (blocking); self-save echo re-walks; history chain can be poisoned. Fixed in 7b973174; re-review: merge. Nitpick for A-05: the open document's index entry stays stale after an edit that adds a heading |
| A-08 | One `pnpm check`; delete the checks of CI's own shape | sonnet | parked | — | ../marxy-wt/A-08 (chore/a-08-one-pnpm-check), clean | Wave 1; stacked on A-07. Blocked: the auto-mode classifier refuses the story's deletions of workflow-shape assertions ("Security Test Removal"); needs the author's permission or the author's hands. Implementor's plan is in its report; it also found tests outside Paths that the deletions break (`check-deferrals.test.mjs:123-127`, `gate-bundle.test.mjs:126`) |
| A-12 | The palette lists every command whose `when` holds | sonnet | in review | [#320](https://github.com/inkstrata/marxy/pull/320) | ../marxy-wt/A-12 (feat/a-12-palette-lists-every-command) | Wave 1. Stacked on A-07 as above. Lead widened Paths: `commands/source-view.ts` (story Risks asks for it), `test/operations-copy.test.mjs` (group order moved the first row). Review (Sonnet): merge, nothing blocking; follow-up 5be6da67 moved palette CSS into the sheet (done). Flaky `persist-reading` first-launch test (pre-existing race) offered as a separate task |
| A-02 | First text from the first screens; the rest appended in idle chunks | opus | in review (merge) | [#322](https://github.com/inkstrata/marxy/pull/322) | ../marxy-wt/A-02 (perf/a-02-first-screens-then-idle-chunks) | Wave 2, stacked on `integration/wave-1` (b7dcca10: A-07 + A-01 + A-04 + A-12, precheck 27/27, desktop 326/326); PR base is that branch until Wave 1 merges. 1 MB first_text 4,224→868 ms (774 quieter); 256k 475→272. `32-long-reference.md` (195 KB, added after the plan) now crosses the threshold. Review (Sonnet): merge; 1m 896/696 ms, 256k 289/220 under load; 0 remote requests. Follow-up 3b8afca9 (tests) + 2dc4170b (Linux fix: a table grows 3.4 px after its pass; ResizeObserver on chunked islands, earliest `from`, re-snap on late fonts); CI green; re-review: merge (1m first_text 707 ms) |
| A-03 | Measure nightly, not on pull requests; delete the product tier | opus | ready | — | — | Wave 2; waits on A-08 (parked) |
| A-05 | Walk a root in fewer shell calls, from a snapshot | sonnet | in review (merge) | [#323](https://github.com/inkstrata/marxy/pull/323) | ../marxy-wt/A-05 (perf/a-05-walk-from-a-snapshot) | Wave 2, stacked on `integration/wave-1`. Lead widened Paths to four harness tests (snapshot I/O in exact call lists). Snapshot path flat (`/data/index-<sha1>.json`): Rust write creates no parent dirs. Warm walk 975→158 calls on this repo; reviewer via real startApp: cold 704, warm 158. Review: merge; follow-up 07b956fa (entry validation, narrower harness filter, two more tests, mutation-checked) done; CI green |
| A-06 | Make the palette's ranking fields honest | sonnet | in review (merge) | [#321](https://github.com/inkstrata/marxy/pull/321) | ../marxy-wt/A-06 (fix/a-06-honest-ranking-fields) | Wave 2, stacked on `integration/wave-1`. For A-13: back/forward stamps `readAt` but does not re-prepare the index (handler outside A-06's lines). Return 1: quit-flush and activateHit tests could not fail; in-flight write not awaited; prepare before dismiss. Open gap for A-13/A-14: `trackDocumentOpen` (app.ts) never updates `view.session`, so Cmd-O opens don't move ranking until restart. Fixes pushed, each mutation-checked; lead accepted `test/palette.test.mjs` for the activateHit test; re-review: merge, all mutations reproduced. CI: Linux CLI smoke (native window, `no_paint reason=not-visible`) failed once, passed on re-run (flake; separate task offered) |
| A-15 | The outline, summoned | sonnet | in review (merge) | [#325](https://github.com/inkstrata/marxy/pull/325) | ../marxy-wt/A-15 (feat/a-15-summon-the-outline) | Wave 3 (depends on A-12 only), stacked on `integration/wave-1`. Six mutations caught. Found: WebKit fires viewport scroll at `document`, not `documentElement`; `app.ts`'s scroll-persistence listener may never fire (confirmed by the reviewer; added to A-13 as step 6). Return 1: Source-mode landing and palette-row bullets had no test; focus left on a hidden element after Esc in Source. Fixed in 6f07c15d (mutation-checked); re-review: merge |
| A-16 | Open in external editor; drag a file to open it | opus | in review (merge) | [#324](https://github.com/inkstrata/marxy/pull/324) | ../marxy-wt/A-16 (feat/a-16-external-editor-and-drag-open) | Wave 3 (depends on A-12 only), stacked on `integration/wave-1`; Rust. 12 mutations caught. Manual checks on a built app (Finder drop, TextEdit) left for the author; macOS `DragDrop` event unconfirmed (reviewer read tauri-runtime-wry 2.11.4: should fire). Review: merge, security checklist clean. Lead fix 2026-10-02: the "writes nothing" test now counts only writes to the document (the A-05 snapshot write broke it in integration; mutation-checked). Later hardening: pin the editor call to the document Rust last opened (today any existing absolute file) |
| A-13 | `Mod+E`, back and forward through the registry | sonnet | running | — | ../marxy-wt/A-13 (refactor/a-13-keys-through-the-registry) | Wave 3, stacked on `integration/wave-2` (5422561f: Wave 1 + A-02, A-05, A-06, A-15, A-16; precheck 28/28, desktop 364/364 after a one-line A-16 test fix for the A-05 snapshot write). Includes the scroll-persistence fix (step 6) |

## Handoff — 2026-10-02, lead session paused

**Read first, next session:** `00-orchestration.md`, this file, `01-phase-a.md` (this branch's copy
carries the lead's amendments). Nothing is on `main` yet; everything below waits on the author.

### The one blocker: nothing is merged

The auto-mode classifier refuses `gh pr merge` from the lead ("Merge Without Review") and also
refused posting the review verdict as a PR comment. The author merges, in this order:

1. **#317 (A-07)** — squash. Every other branch is stacked on its commit `6b87684e`.
2. Then, for each PR below, the lead rebases it onto `main` dropping the stacked commits
   (`git rebase --onto origin/main <old base> <branch>`, force-with-lease), retargets the PR base to
   `main` (`gh pr edit N --base main`), waits for CI, and the author merges. Order (dependencies):
   **#319 A-01, #318 A-04, #320 A-12** (stacked on A-07 only) → **#322 A-02, #323 A-05, #321 A-06,
   #325 A-15, #324 A-16** (base `integration/wave-1`) → **A-13** (base `integration/wave-2`).
   Squash-merged content equals the cherry-picks, so `--onto` rebases should be clean; if one is
   not, rebase onto `main` plainly and resolve.
3. Then push `docs/roadmap-lead-ledger` (this branch, also stacked on A-07; rebase it the same way)
   and open it as a plan PR: the ledger plus the plan amendments below.
4. Delete `integration/wave-1` and `integration/wave-2` (remote and local) once their contents are
   on `main`. They are scaffolding, never merged.

### Second blocker: A-08 is parked

The classifier refused A-08's deletions of workflow-shape assertions ("Security Test Removal").
A-03, A-09, A-10, A-11 and A-17 all wait on A-08. Needs the author: a Bash allow rule for those
edits, an explicit approval, or the author doing the deletions. The implementor's full plan (files,
functions, the two out-of-Paths tests the deletions break: `check-deferrals.test.mjs:123-127`,
`gate-bundle.test.mjs:126`) is summarised in A-08's row; add those two files to A-08's Paths before
re-dispatching. Worktree `../marxy-wt/A-08` is clean at `6b87684e`.

### Plan amendments made by the lead (in `01-phase-a.md` on this branch)

- A-01: the 1 MB grid-stage bound moved to A-02 (the cost was one forced whole-article restyle after
  fonts load, not the grid pass).
- A-02: build order targets that restyle; Paths gain `docs/design/04-typeset.md` §Grid.
- A-05: Paths gain four harness tests (snapshot I/O in exact call lists).
- A-12: Paths gain `commands/source-view.ts`, `test/operations-copy.test.mjs`.
- A-13: step 6, the scroll-persistence fix (WebKit fires viewport `scroll` at `Document`, so
  `app.ts`'s listener on `documentElement` never runs; positions are lost on a crash).
- Not written into the plan yet, accepted by the lead: A-06 Paths + `test/palette.test.mjs`; A-02 Paths
  + `packages/typeset/test/typeset.test.mjs`; A-16 test fix (only document writes count).

### Remaining Phase A

- **A-13** — in flight at pause (see its row). Then **A-14** (Wave 4; depends on A-13) on top of it.
- **A-08 → A-03 → A-09 → A-10 → A-11, A-17** — blocked on the A-08 decision.
- The author's manual checks for A-16 (Finder drop, folder drop, TextEdit via `external_editor`).
- Phase A's "Questions only the author can answer" (`01-phase-a.md`, end) are still open.

### Follow-ups recorded, not scheduled

- Two separate tasks the author started: the racy `persist-reading` first-launch test, and the flaky
  Linux CLI smoke check (`no_paint reason=not-visible`).
- A-04/A-05: the open document's index entry stays stale after an edit that adds a heading.
- A-06: `trackDocumentOpen` never updates `view.session`, so Cmd-O opens don't move palette ranking
  until restart (A-13/A-14 or Phase B); `notePaletteOpen` has no caller.
- A-16: pin the external-editor call to the document Rust last opened.
- A-02: `debugCounts()` doesn't count the island observer or the `loadingdone` listener; the 150–180 ms
  post-first-text stall is probably the completion-time whole-article snap.
- `docs/conventions.md:35` still names `marxy-key-in-subject` (A-11).

### Lessons for the next lead

- Never wait with `until ! pgrep -f "<cmd>"`: the loop's own command line matches and it never exits.
  Several agents did this; the lead killed the loops by PID.
- The reviewer lane on Sonnet caught real defects every time (failed walk cached forever; two tests
  that could not fail; missing acceptance tests; a Linux grid bug; an integration-only test clash).
  Keep the mutation-check instruction in every brief.
- Stacking on unmerged work through `integration/wave-N` branches kept the agents busy while merges
  were blocked; verify each integration branch (precheck + full desktop suite) before stacking.
