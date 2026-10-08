# Lead handoff — the third sweep wave, Phase D's pure modules, B-12 and C-10 under way

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md` (§6: the lead merges), then
`progress.md`, then `08-fixes-from-the-bug-sweep.md`, `02-phase-b.md`, `03-phase-c.md` and `04-phase-d.md`. This page
says what to do next.

## Where things stand (2026-10-07, 17:45)

- **The lead merges** when a review says merge and every check is green (`node scripts/lead-merge.mjs <pr> --verdict
  notes.md --sha <reviewed head>`). Code-owned paths (`.github/`, the sanitiser, Tauri config and capabilities) wait
  for the author.
- **Merged since the morning handoff:** F-12 and L-11; the third sweep wave verified (#412) and F-15 and F-16
  fixed; D-02 and D-03 (Phase D's pure modules, started early while lanes B and C waited on Opus slots); two plan PRs.
- **The third sweep wave** (S-09 to S-12, six findings): four real, one contrived (a same-inode, same-size,
  same-mtime rewrite; not fixed), one unreachable (a `..` path no walker produces). Mechanisms were again partly
  wrong (a filter C-05 had already removed; an escape that does not work). Re-verifying first still pays.

## In flight at this writing

| Story | State | Next |
| --- | --- | --- |
| B-02 (opus) | running: gate on the app, macOS and Linux baselines (nightly from the branch green) | its PR touches `.github/`: the author merges. Then L-02 → L-03 → L-04, A-11.2 |
| B-12 (opus) | running: selection and commands read the store; `baseVersion` on every apply | review (Opus); rebases over #417 and #419. Then B-13 |
| C-10 (opus) | returned once (#417): deny globs apply to every root, read before the first walk; a declared `/` is skipped | re-review (Opus), merge; then C-11 (notes on its card), C-12, C-14 |
| F-14 (sonnet) | merged (#419) | — |
| F-17 (sonnet) | running: a document with only images finishes opening (real, reproduced on main) | review, merge; touches `app.ts` beside B-12 |
| F-15.1 (sonnet) | #420 review: merge; merging on green CI | — |
| F-16.1 (sonnet) | #422 in Opus review: escape the inserted asset URL | merge on green |
| #394, #407 | waiting for the author (code-owned) | author merges |

## Next, in order

- **B lane:** B-12 → B-13 → B-14 → B-15; then B-16/B-17. B-20 carries B-09.1's follow-ups.
- **C lane:** C-10 → C-11 (Opus) and C-12, C-14; C-16 (Opus) → C-17; C-15. C-06 and C-13 after B-12. C-10.1 (a walk
  budget for home-sized roots) any time after C-10.
- **D lane:** D-02 and D-03 are in. The rest needs Phase B's view split (D-01 needs P1–P5). D-13 has a note from the
  D-03 review on the boundary bias.
- **L lane:** after B-02: L-02 → L-03 → L-04 (each alone, baselines). L-08.1 waits for decision 9.
- **Cap:** four implementors, at most two on Opus.

## Waiting on the author

1. Merge #394 and #407 (code-owned), and B-02's PR when it opens.
2. Rulings from L-01 (`07-layout-and-reading.md`): decisions 4, 6, 7 and 9.
3. ADR-0053, ADR-0054 and ADR-0055 are `proposed`. One discrepancy for ADR-0053 §5: it says the newest files win past
   the 50k cap; C-10's card and code drop the end of the scope order instead. Say which you want.
4. Image scope reach (F-14, per ADR-0027 §5): a `.git` in the home folder makes the whole home folder the image
   scope for any document beneath it, and the scope only grows during a session. Nothing leaves the machine (the CSP
   allows no network images). Say if you want a ceiling (for example, never above a repository below home).

## Lessons from this session

- **Adversarial privacy reviews earn their cost.** F-16 went back twice: once for a pre-existing splice
  (`urlurl()(https://…)` became a live remote `url(`), once because the fail-closed second pass would have emptied
  every theme on Windows. The third review fuzzed 600k inputs in WebKit with requests aborted. Ask for a WebKit
  ground truth, not a reading.
- **Ask the reviewer to drive the real path.** F-15's unit tests called `scan` directly; the review drove the
  notify thread to prove a target in another directory is seen. Name the real entry point in the review brief.
- **A path filter test catches new imports.** D-02 broke `every file headless.ts reaches is typography` because core's
  index now reaches `layout/`: widen `scripts/ci-changes.mjs` in the same PR.
- **Counts in tests rot.** L-11's new token broke a literal "55 tokens"; derive counts from the source of truth.
