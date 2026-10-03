# Lead handoff — Phase A done, Phase B under way

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md`, then
`progress.md` (one row per story, the record of what happened), then the phase documents. This page
says what to do next; `progress.md` says where each story stands and why.

## Where things stand (2026-10-03)

- **Phase A is merged.** A-01 to A-17, plus A-14.1 and A-11.1, are on `main`. A-17 merged as
  `351c18af`, which is the commit to tag. A 1 MB transcript shows its first screen in about 0.7–0.9 s,
  down from 4.2 s.
- **Phase B:** B-01, B-03, B-04, B-05, B-05.1 and B-07 are merged. B-02 is parked behind three fixes
  (B-02.1, B-02.2, B-02.3) for typography defects the real app showed once the gate measured it.
- **How work landed.** Each story was implemented by one agent in its own worktree and reviewed by an
  independent Sonnet agent, and the lead merged on a `merge` verdict with green CI. That is what the
  author authorised on 2026-10-02. Every review verdict is posted as a comment on its PR.

## Waiting on the author

1. **Tag v0.1.0** on `351c18af`: `git tag v0.1.0 351c18af && git push origin v0.1.0`. The release
   workflow builds the unsigned DMG and creates the pre-release. The last dry run (37104610003) was
   green with a 9.4 MB `marxy-dmg` artifact.
2. **The manual checks on the built app** (`01-phase-a.md`, "Verification at the end of the phase"):
   - launch from the Dock;
   - search across two repositories;
   - light variant and text size;
   - the outline;
   - a 1 MB transcript;
   - the external editor;
   - Finder drag-and-drop, including dropping a folder (A-16);
   - `external_editor` opening TextEdit.
3. **Phase A question 4:** the first nightly run of the full WebKit suites on Linux fails two tests
   that had never run in CI. Fix or delete each?
   - `packages/theme/test/pair-a-tune.test.mjs`, "code voice: mono and text x-heights match": the
     x-height ratio is 90.9 % at 18 px, outside the test's 5 %.
   - `packages/core/src/render/math.acceptance.test.ts`, "MARXY-28 inline math matches screenshot
     baseline": 10.8 % of pixels differ.

   The nightly stays red on these until the author decides.
4. Phase A's other open questions, at the end of `01-phase-a.md`.

## In flight at this writing

`progress.md` has each one's state:

- **Phase B:** B-06 (#345) and B-08 (#346) are in review.
- **B-02's fixes:** B-02.2 (#348) is in review. B-02.1 and B-02.3 are being implemented.
- **Process:** A-10.1, which fixes the flaky no-network control-page check, is being implemented.

## Next

- **After B-02.1–B-02.3 merge:** resume B-02 from its kept worktree `../marxy-wt/B-02`. The lead
  already accepted its three out-of-path files. It then regenerates both engines' baselines with a
  taste-review entry. A-11.2, the gates design document, follows B-02.
- **Then the Phase B chain on `app.ts`:** B-09 to B-15, one story at a time on `app.ts`, as
  `02-phase-b.md` lays out.
- **Follow-ups found in review and written into the plan:** B-13 now carries the store `version`
  caveat in its Risks. Smaller follow-ups are in `progress.md` notes:
  - pin the external-editor call to the open document (A-16);
  - the island observer missing from `debugCounts` (A-02);
  - the stale Commands table in `docs/design/06-shell.md`;
  - the dead `markIndexLoaded` helper;
  - the pull-request template's contract checklist line and the old Cursor rule (B-06).

## Lessons for the next lead

- **Integration branches.** Stacking on unmerged work through `integration/wave-N` branches, or on a
  story's own branch, kept agents busy while merges were blocked. Rebase with
  `git rebase --onto origin/main <old base>`, and verify an integration branch before stacking on it.
- **Keep the mutation instruction.** "Each test must fail without the change" caught several tests
  that could not fail.
- **The reviewer lane is worth its cost.** Each of these was found by a review:
  - a failed walk cached for the session;
  - a release gate that could never pass;
  - a symlink guard with no live test;
  - three typography defects that the headless gate hid;
  - a Linux-only grid race;
  - privacy tests about to leave the pull-request path.
- **Never wait with `until … pgrep -f "<cmd>"`.** The loop matches its own command line and never
  ends.
- **A flaky check is fixed, not re-run** (A-10.1). Record each re-run in `progress.md` so the pattern
  is visible.
