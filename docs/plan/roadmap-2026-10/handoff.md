# Lead handoff — lane F landed, Phase C wave 0–1 under way, the lead merges

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md` (§6 changed today: the lead
merges), then `progress.md`, then `08-fixes-from-the-bug-sweep.md`, `02-phase-b.md`, `03-phase-c.md` and
`07-layout-and-reading.md`. This page says what to do next.

## Where things stand (2026-10-07, evening)

- **The lead merges.** The author ruled that a PR is merged by the lead as soon as its review says merge and every
  check is green: `node scripts/lead-merge.mjs <pr> --verdict notes.md --sha <reviewed head>` posts the verdict with a
  `lead-verdict: merge <sha>` marker and squash-merges when ready (owner-only markers, `ci` must succeed, no
  conflicts, base `main`; stacked PRs fall back to GitHub's `merge-async`). Code-owned paths (`.github/`, the
  sanitiser, Tauri config and capabilities) still wait for the author.
- **Merged today (40 commits):** lane F F-01–F-11 and F-13 (the bug sweep, re-verified: 21 of 23 findings real); B-02.6,
  B-02.8, B-02.9, B-11.1, B-21, B-22; L-00.1, L-01, L-06, L-06.1, L-08.3, L-10; C-01, C-02, C-03, C-03.1, C-04, C-05,
  C-07, C-08, C-09; the merge tool, the browser-lite trim, the precheck that names failing tests.
- **Model use:** Sonnet for most implementors and reviewers; Opus for seams (F-03, F-04, F-11, B-02, B-22, C-05, C-10)
  and for every review of data safety, security or a measurement. Reviews returned about half of all PRs, almost
  always for a real defect (a regression, a data-loss path, a test that could not fail).

## In flight at this writing

| Story | State | Next |
| --- | --- | --- |
| B-02 (opus) | running: rebase, full gate, macOS baselines, Linux baselines via a nightly `workflow_dispatch` | its PR touches `.github/`: the author merges. Then L-02 (gate the geometry), A-11.2 |
| F-12 (sonnet) | returned: fold Source before palette Undo/Redo, refuse `commitEdit` while Source is dirty, move focus out of the hidden editor | re-review (Opus), merge. **Main loses typed text on a palette Undo in Source until this lands** |
| C-10 (opus) | running | review (Opus), merge; then C-11, C-12, C-14 |
| L-11 (sonnet) | running (a find-match edge token; may carry a short ADR for the token) | review, merge |
| #394 (ci) | waiting for the author (code-owned): apt retries for the C linker step, browser-lite 20 min | author merges |
| #407 (test) | waiting for the author (code-owned sanitiser test): record the stray-close time, not assert it | author merges |

## Next, in order

- **B lane:** F-12 → B-12 (Opus; reads the store; the review's `baseVersion` point) → B-13 → B-14 → B-15; then B-16/B-17.
  B-20 carries B-09.1's follow-ups.
- **C lane:** C-10 → C-11 (Opus; with the C-05 review's notes on its card) and C-12, C-14, C-16 (Opus, after C-05) →
  C-15, C-17. C-06 and C-13 need B-12 (selection reads the store).
- **L lane:** after B-02: L-02 → L-03 → L-04 (each alone, baselines). L-05 and L-07 between B-15 and D-10/D-11.
  L-08.1 waits for the author's decision 9 (CJK leading).
- **Cap:** four implementors, at most two on Opus.

## Waiting on the author

1. Merge #394 and #407 (code-owned), and B-02's PR when it opens.
2. Rulings from L-01 (`07-layout-and-reading.md`): decision 4 (the scrollbar gutter: no effect in macOS WebKit with a
   forced scrollbar; L-03 re-measures on Linux), decision 6 (Source column), decision 7 (size ramp), and the new
   decision 9 (CJK leading, recommended 35 px).
3. ADR-0053 and ADR-0054 (collections, the verb menu) are `proposed`; accepting them is yours.

## Lessons from this session

- **Verify a sweep before fixing it.** Weak sweepers' findings: 21 of 23 real, two not bugs, several mechanisms
  wrong. One verifier per area, each running a repro at today's main, paid for itself.
- **Review returns are the product.** Returns caught a data-loss regression in a fix (F-12), a broken real-shell
  error shape (F-09), lost recent-root order (F-08), a formula-injection path (C-08) and a truncated shell command
  (C-09). Ask reviewers to hunt adversarially and for numbers.
- **Never post a verdict before CI is green**, and re-post it for a new head after any push or rebase.
- **Stacks:** do not rebase a stack's base before it merges; GitHub retargets and rebases the children only while
  the base's commits are unchanged.
- **`git stash` is one stack for every worktree.** Tell implementors not to use it.
- **CI noise is mostly infrastructure:** the Ubuntu mirror (#394 retries) and runner variance. Merge-wait loops should
  re-run only `Failed to fetch` and `cancelled`, never a test failure.
- **Wall-clock assertions do not belong in unit tests** (ADR-0032); several were removed today after flaking under
  load. Precheck now names the failing test.
