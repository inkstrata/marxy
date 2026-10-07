# Lead handoff — Phase B mid-way, lane L started, paused

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md`, then `progress.md`
(one row per story), then `02-phase-b.md` and `07-layout-and-reading.md`. This page says what to do next.

## Where things stand (2026-10-07)

- **Released:** v0.1.0 (pre-release, ad-hoc signed DMG) on `ad0b020c`.
- **Merged this session:** A-10.3 (two never-run WebKit tests deleted, by ruling), B-10 (the trust
  controller), B-09.1 (one wording for the blocked-images notice).
- **Paused by the author:** the round in flight finishes and gets one review each; nothing new is
  dispatched. A return found in that round is recorded, not re-dispatched.
- **Model use:** Sonnet for implementors and every reviewer; Opus only for B-11 (L-size seam). The
  author prefers this split (Opus for planning and L-size seams). Five Sonnet reviews this session caught
  two real gaps (B-02.5's untested paths and +15 % cost; A-10.3's collateral grid assertion).

## In flight at this writing

| Story | State | What the next lead does |
| --- | --- | --- |
| B-11 (opus) | implementing, rebasing onto main after B-10 | when its PR opens: Sonnet review; on merge, B-12 |
| B-02.5 (sonnet) | fixing return 1 (two wraps untested, 1 MB content_complete +15 %, drop `scroller`) | re-review; a second return goes to Opus with both notes (§1) |
| L-00 (sonnet) | building the layout probe | review; then L-01 on Opus |
| A-10.4 (sonnet) | restoring the code-line-box grid check (author said yes) | review, then merge |
| B-02 (opus) | **parked**: pushed (`d2885b69` code, `b2b68f0b` macOS baselines), no PR | see below |

## B-02: why it is parked and how to resume

The aesthetics gate now measures the real app and every mechanical rule passes, but the screenshot
comparison does not repeat on the same code: `06-math`'s inline-matrix paragraph moves (0.6–0.8 %), and
`18-agent-transcript`'s last screen shifts 12 px when its code blocks finish highlighting (10.5 %, once).
No threshold was loosened. Order to resume:
1. Merge B-02.5 (reader's place kept on reflow; likely cures the 12 px shift).
2. Rebase B-02 onto main, re-probe 8–10 renders per flaky cell.
3. If `06-math` still moves, dispatch B-02.6 (card in `02-phase-b.md`).
4. Regenerate macOS baselines after the rebase; Linux baselines in CI or the nightly (amd64 emulation on
   an arm64 Mac is too slow and itself unstable). Re-run precheck and `--selftest`.
Also: the gate's wall time went 157 s → 5–10.5 min on the app. Worth a look before it is a PR-path cost.
Then A-11.2 (gates design document) follows B-02.

## Waiting on the author

1. **The v0.1.0 manual checks**: a nine-question walkthrough was posted in the session; results not yet
   in. The likeliest failures are Finder drag-and-drop (the macOS drop event was never seen on a real
   build). Each failure becomes a fix story.

## Next, in order (once unpaused)

- **B lane (one story at a time on `app.ts`):** B-11 → B-12 → B-13 → B-14 → B-15; then B-16/B-17 in
  parallel. B-20 carries B-09.1's follow-ups (delete `displayBlockedHost`, no uncapped host list).
- **Lane L:** L-01 (Opus) after L-00, working from the probe alone with the eight decisions at their
  defaults (`rulings.md`, 2026-10-07). L-06 (Source looks, Sonnet) and L-10 (code on the grid at every size, Sonnet, from A-10.4) can start any time a slot is free.
  L-02 to L-04 each alone after B-02 merges (baselines).
- **Cap:** four implementors, at most two on Opus, counted across both lanes.

## Lessons from this session

- **Interrupted agents leave work behind.** B-09.1 (uncommitted) and B-10 (unpushed) were found four days
  later and finished by a short Sonnet "audit and open the PR" pass with no code change. Check
  `git status` and `git log origin/main..HEAD` in every `running` worktree at the start of a session.
- **Stacking still works.** B-11 started on B-10's branch before it merged; tell the agent explicitly
  when the base lands, because it will not notice.
- **Ask the reviewer for a cost number.** B-02.5's +15 % would not have been seen without one.
- **A gate that photographs the real app needs settled pages.** Layout that moves after "done" shows up
  first as screenshot flakes, not as rule failures.
