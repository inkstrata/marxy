# Lead handoff — Phase A, paused 2026-10-02

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md`, then
`progress.md` (one row per story), then `01-phase-a.md` from this branch, which carries the lead's
amendments. This document says what to do next; `progress.md` says where each story stands.

## Where things stand

- **On `main`:** A-07 only (#317, `47319fd6`). The fleet is paused, and story-id subjects such as
  `(A-01)` pass commitlint and CI.
- **Reviewed `merge`, open, waiting to land (8 PRs):** A-01 #319, A-04 #318, A-12 #320 (Wave 1);
  A-02 #322, A-05 #323, A-06 #321 (Wave 2); A-15 #325, A-16 #324 (Wave 3). CI is green on each. Every
  story had an independent Sonnet review that re-ran the gates and mutation-checked the tests; three
  were returned once and fixed (A-04, A-06, A-15).
- **The headline result (A-02):** a 1 MB transcript shows first text in about 0.7–0.9 s, down from
  4.2 s. The 1.8 s "grid stage" was one forced whole-article restyle, now 4 ms.
- **In flight at the pause:** A-13, uncommitted (see "A-13" below).
- **Blocked:** A-08, and behind it A-03, A-09, A-10, A-11 and A-17 (see "A-08" below).
- **Not started:** A-14 (needs A-13).

## How the open PRs are stacked

Merges were blocked for most of the run, so later waves were built on top of unmerged work:

| Branch | Built on | PR base today |
| --- | --- | --- |
| A-01, A-04, A-12 | A-07's commit `6b87684e` | `main` (their diff still shows A-07 until rebased) |
| `integration/wave-1` | `6b87684e` + A-01 + A-04 + A-12 (cherry-picked) | not a PR; scaffolding |
| A-02, A-05, A-06, A-15, A-16 | `integration/wave-1` | `integration/wave-1` |
| `integration/wave-2` | `integration/wave-1` + A-02, A-05, A-06, A-15, A-16 + the A-16 test fix | not a PR; scaffolding |
| A-13 (local only) | `integration/wave-2` | — |
| `docs/roadmap-lead-ledger` (this branch) | `6b87684e` | not yet a PR |

Both integration branches passed `pnpm precheck` and the full desktop suite with
`MARXY_BROWSER_TESTS_REQUIRED=1` before anything was stacked on them (wave-2: 28/28 and 364/364).

## Next steps, in order

The classifier refuses `gh pr merge` from the lead ("Merge Without Review"), and it also refused
posting the review verdicts as PR comments. So the lead prepares each PR and the author merges.
The verdicts and their notes are in `progress.md`.

1. **Rebase Wave 1 onto `main` and drop A-07's commit.** For each of A-01, A-04 and A-12:
   `git rebase --onto origin/main 6b87684e <branch>`, then `git push --force-with-lease`. Wait for CI;
   then the author squash-merges. A-01, A-04 and A-12 have pairwise disjoint paths, so their order
   does not matter.
2. **Rebase Wave 2 and 3 onto `main`.** For each of A-02, A-05, A-06, A-15 and A-16:
   `git rebase --onto origin/main origin/integration/wave-1 <branch>`, force-with-lease, then
   `gh pr edit N --base main`. Wait for CI; then the author merges. A-16's branch carries its own copy of
   the one-line test fix (`a07380cb`), so `integration/wave-2` adds nothing that is missing elsewhere.
   **Merge A-05 before A-16, or re-run A-16's `external-editor.test.mjs` after A-05 lands.** That
   test clashed with A-05's snapshot write until the fix.
3. **Finish A-13.** It needs the steps under "A-13" below. Rebase it onto `main` once everything
   under it has merged.
4. **Land this branch as a plan PR.** Rebase `docs/roadmap-lead-ledger` the same way as step 1. It
   carries `progress.md`, this document, and the plan amendments. Before opening it, write the
   three accepted path widenings (listed below) into `01-phase-a.md`.
5. **Delete the scaffolding.** Remove `integration/wave-1` and `integration/wave-2`, local and
   remote, once their contents are on `main`. Deleting branches needs the author's go-ahead.
6. **Then:** A-14 (Wave 4; Sonnet; it owns `app.ts` after A-13), and the A-08 lane once it is unblocked.

## A-13: stopped mid-implementation

- **Worktree:** `../marxy-wt/A-13`, branch `refactor/a-13-keys-through-the-registry`, off
  `integration/wave-2` (`5422561f`). Nothing is committed or pushed, and there is no PR.
- **Uncommitted changes:**
  - modified `app.ts`, `commands/navigation.ts`, `palette/view.ts`, `selection/view.ts` and
    **`selection/harness-entry.ts`**;
  - new `test/navigation-keys.test.mjs`, `test/scroll-persistence.test.mjs`, `changelog.d/A-13.md`
    and `docs/taste-review/queue.d/A-13.md`.
- **Out of Paths:** `selection/harness-entry.ts` is not in the story's Paths. Decide before
  continuing: widen the Paths, or rework the change.
- **To resume:** send the A-13 agent a message (its transcript is saved), or start a fresh Sonnet
  implementor in the same worktree. Either way, first run `git diff` and the desktop suite, because
  the last test run was interrupted.
- **Scope added by the lead:** step 6, the scroll-persistence fix. `app.ts`
  `installScrollPersistence` listens on `documentElement`, but WebKit fires the viewport `scroll` at
  `Document`, so positions are saved only on switch, quit or Source. A crash loses the reader's
  place. Also asked of A-13: re-prepare the palette index on back and forward (A-06's hand-off).

## A-08: blocked on the author

The classifier refused A-08's deletions of workflow-shape assertions as "Security Test Removal".
The story asks for them, but the lead may not route around the refusal. **Needs one of these:** a
Bash permission rule for those edits, an explicit approval from the author in chat, or the author
making the deletions.

- **Worktree:** `../marxy-wt/A-08`, clean at `6b87684e`. Rebase it onto `main` before restarting.
- **Paths:** add `scripts/check-deferrals.test.mjs` and `scripts/gate-bundle.test.mjs` first. The
  deletions break them at `check-deferrals.test.mjs:123-127` and `gate-bundle.test.mjs:126`.
- **Already done:** the first implementor read the story and planned the whole change, including the
  shape of `scripts/check.mjs`. Its notes are in A-08's row in `progress.md`.
- **Unblocks:** A-03, then A-09, A-10, then A-11 and A-17.

## Plan amendments made in this run

Written into `01-phase-a.md` on this branch:

- **A-01:** the ≤ 250 ms grid-stage bound moved to A-02. A-01 records before and after numbers.
- **A-02:** the build order targets the forced restyle, not the `[...document.fonts]` spread.
  Paths gain `docs/design/04-typeset.md` §Grid.
- **A-05:** Paths gain four harness tests, which are allowed to leave the snapshot's `/data/index-*`
  out of exact call lists.
- **A-12:** Paths gain `commands/source-view.ts` and `test/operations-copy.test.mjs`.
- **A-13:** build step 6 and its acceptance bullet (scroll persistence).

Accepted by the lead but not yet written into the plan:

- A-06: Paths gain `test/palette.test.mjs`.
- A-02: Paths gain `packages/typeset/test/typeset.test.mjs`.
- A-16: the lead's one-line test fix. Only writes to the document count; it is mutation-checked.

## Decisions waiting on the author

- **Merging:** each PR in steps 1–3, and A-13 once it has a PR.
- **A-08:** the permission described above.
- **A-16 manual checks on a built app:** a Finder drop opens the file; a folder drop does nothing;
  `external_editor = "open -a TextEdit {file}"` opens TextEdit.
- **Phase A's open questions** at the end of `01-phase-a.md`: whether the variant toggle is
  remembered, the pre-paint config read, whether v0.1.0 is macOS-only, the WebKit tests that never
  ran, which phase gets Find, and whether `loop.sh` should refuse to start while `PAUSED.md` exists.

## Follow-ups found during review, not scheduled

| Found in | Issue | Likely home |
| --- | --- | --- |
| A-04, A-05 | The open document's index entry stays stale after an edit that adds a heading | Phase B or C |
| A-06 | `trackDocumentOpen` (`app.ts`) never updates `view.session`, so Cmd-O opens do not move palette ranking until restart. `notePaletteOpen` has no caller | A-14 or Phase B |
| A-16 | The external-editor call accepts any existing absolute file. Pin it to the document Rust last opened | Phase B |
| A-02 | `debugCounts()` omits the island observer and the `loadingdone` listener. A 150–180 ms stall after first text is probably the completion-time whole-article snap | Phase B |
| A-15 | Rows refresh on the next scroll tick after a document change, and the outline does not close on document close without a scroll tick | Phase D binding |
| A-07 | `docs/conventions.md:35` still names `marxy-key-in-subject` | A-11 |
| CI | Two flakes: the `persist-reading` first-launch race, and the Linux CLI smoke `no_paint reason=not-visible` | Fixes are open as #326 and #327 (author-started sessions) |

## Lessons for the next lead

- **Never wait with `until ! pgrep -f "<cmd>"`.** The loop's own command line matches the pattern,
  so it never exits. Agents did this four times, and agent completion hung on it until the lead
  killed the loops by PID. Watch CI with `gh pr checks N --watch`, which exits on its own.
- **Keep the reviewer lane and the mutation instruction.** The Sonnet reviewers found real defects
  each time: a failed walk cached forever, two tests that could not fail, missing acceptance tests,
  a Linux-only grid drift, and a test clash that appeared only once stories were combined. Every
  brief should say "each test must fail without the change; report the mutation".
- **Stacking needs verification at each level.** Stacking through `integration/wave-N` branches kept
  four agents busy while merges were blocked. Verify each integration branch (precheck plus the full
  desktop suite with WebKit required) before stacking on it. That is where the A-05 × A-16 clash
  surfaced.
- **Commit subjects:** commitlint rejects a description that starts with a capitalised story id, for
  example `docs(plan): A-02 …`. Start the description with a lowercase word.
- **WebKit fires viewport `scroll` at `Document`.** A listener on `documentElement` never runs.
  Check any other scroll listener in the app for the same mistake.
