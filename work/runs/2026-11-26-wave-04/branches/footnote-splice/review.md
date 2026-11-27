# footnote-splice: first review (Sonnet)

**Verdict: ready after my fix** (test coverage only), `f104f3b6`; tree clean. Mechanism checked against the renderer; no output mismatch found.

## Mechanism

Splice only when old and new label-to-number maps are identical. Replaced blocks and list items use the document's numbers. Each list item holds one back-link per label (depends only on its definition and number). Removals merge in whole-render order.

## Independent differential

Generator `packages/core/src/parse/testing/footnote-chains.ts`: definitions top, middle, bottom, inside quotes, lists, tables, headings; duplicate labels and case-only differences (`a`/`A`, `[^a b]`, `[^A  B]`); references before definitions, unreferenced definitions, undefined labels; interrupted, multi-paragraph and lazy definitions; sanitiser removals inside notes; repeated headings inside notes; 12 edit kinds.

- Splice, browser (`apps/desktop/test/footnote-splice-random.test.mjs`, in `verify-map.json`): 4,000 edits from a fresh whole-render page plus the same 4,000 down a chain of splices, pages sometimes half-set (tail in the pending holder). 1,964 spliced per mode, 264 note items redrawn, 0 mismatches in bytes or removals. Declines: 857 numbered differently, 758 open raw HTML, 267 most of the document. An earlier run with fewer raw-HTML cases spliced 2,403, 0 mismatches.
- Slice, Node: 10,500 documents at three slice budgets, 31,500 cases, 23,943 sliced, 7,557 declined (open raw HTML), 0 mismatches. Shorter version added to `sliced.test.ts`.
- Builder's verify reds alone: `large-open-panel`, `paragraph-restyle`, `reading-lines` (8) all pass.
- `live-reload` and `splice-all` 43 pass; typecheck, lint, check, core `sliced.test.ts` (7) pass.

## Mutations that fail a test

Dropping the size check in `sameNumbers`; old heading ids for the redrawn list; not stopping the shift at the list rule; losing the rule as the splice end; always keeping items as moved; dropping the new list removals (survived the first generator, killed after sanitiser removals in notes were added); slice runs without the document's footnote numbers; slice list without heading ids (killed after repeated headings in notes); a definition not counted as a heading holder in slices. One survives, equivalent: rendering the list from all definitions (the list render dedups already).

## Not done

- `sliced-oracle.test.ts` stopped after more than 10 minutes.
- Full verify not rerun.
- Margin-note copy after a splice unchecked.

Comment: the open-time slice of footnoted files looks sound, but until the last slice lands the page shows references with no list.

## Orchestrator notes

- `sliced-oracle.test.ts` running over 10 minutes needs settling: is it new slowness from this branch (now that footnoted documents slice) or was it always that long? A verify step that slow is a problem.
- Second review: fresh Opus, told to break it, plus the margin-note copies and the open-time look (references before their list).

# footnote-splice: second review (Opus, told to break it)

**Verdict: ready after my fixes.** Tip `f7a074a1`, tree clean; verify turn 12/12 on that tip (browser 330/0). Log `work\wave4\footnote-splice-verify.log`.

## Bugs found and fixed (both earlier passes missed them)

1. Wrong heading id in a note (`95e97446`): a heading inside a footnote, with a body heading of the same name added or removed above it; the kept list item inside the cut kept `foo-1` where a whole render gives `foo`, so an outline link pointed nowhere. The heading-id check covered only headings outside the cut. Fix in `render/incremental.ts`: an item inside the cut whose heading ids moved is redrawn. New test in `footnote-splice-random.test.mjs` fails without it.
2. Open note shows old text (`f7a074a1`): on a narrow pane, a note opened under its line kept its old text after a change rewrote the note in place (master's whole render dropped the box). Fix in `proposals/notes-in-place.ts`: the idle margin pass refreshes open boxes from their notes. New test in `live-reload.test.mjs` fails without it.

## Checked, no problem

- Margin-note copies at wide widths: re-copied when a note's markup changes; numbers cannot change in a splice; copies carry no ranges.
- Two panes on one file: each pane splices its own page; notes looked up per article.
- `long-reference` edited at every fifth block boundary (insert, delete, append, add heading): 996 edits, 716 spliced, 0 byte or removal mismatches.
- Slicer at open: all slices are rendered before anything is mounted, so references never show without the list; the list arrives with the progressive mount as on master. The first review's comment was wrong.
- `sliced-oracle.test.ts`: 133 s on master, 140 s on the branch, quiet machine; the fuzz test 73 vs 74 s. Not slower; the 10-minute stall was load.

## Process

The first verify run survived TaskStop and was still running while source was edited: killed, its leftover lock folder `a` removed, rerun on the final tip.

## To file

- The sanitiser's 100,000-removal limit applies per pass, so the slicer and the splice can disagree with a whole render past it (predates the branch).
- A note's number keeps its "open" mark when a splice removes the open box (minor).
- `docs/architecture.md` "only the items whose definitions changed are drawn again" now also covers the heading-id case; not updated.
