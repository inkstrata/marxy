# first-click: review

Saved by the orchestrator from the reviewer's final message. Opus reviewer (the builder was Sonnet), 24 November 2026.

## Verdict: ready after the reviewer's fix

Final tip is `3c80b1a0`. The verify turn (changed tier) passed all 11 steps on that tip: unit-scripts 243/0, unit-desktop 1319/0 with 1 skip, browser 236/0. The worktree is clean.

## What was checked, and how

- **Diff against the report:** `17cfe661...HEAD` read in full. `typecheck`, `lint` and `check` (10/10) pass on both tips.
- **Margin notes:**
  - A changed number, an added or removed note, and a note removed by a splice all rebuild the boxes, because the kept-box test compares id, label, parent and count.
  - A re-render or another document in the same pane is caught by the existing "first ref still in the article" check. `placeMarginNotes` always takes the boxes out first.
  - No room removes the boxes, and they come back when the room does. A width change rewrites only the width. Two panes are covered by state kept per article.
  - In the steady state, the only layout read before any write is `roomOf`. Inserting boxes and writing widths has to come before their heights are measured, so the claim that every read comes first is true only once the boxes are in. That is fine.
- **Verb bar:**
  - `data-marxy-verb-room` appears nowhere else: source, tests, CSS, docs and the registry are all clear. `--marxy-verb-room` is still used and still registered.
  - The bar's font is chrome × 12/13, so `64/12` em gives chrome × 64/13, the same as the old rule. The existing tests for the foot, the nearest-edge scroll and split panes pass.
  - A chrome-size change while the bar shows is reachable: the reader can edit `config.toml` or switch theme. The window padding then stays wrong until the bar hides and reappears. It is a few pixels and no test or doc describes the old behaviour.
- **Docs:** none mention the removed attribute or the old behaviour.
- **perf-record test:** run alone it passed 4 out of 4. The EPERM is a Windows rename race in its concurrent-writers case, so it is load, not this branch.

## Mutation results

- Margin boxes always rebuilt (`kept = false`): the first-click test fails, with 6 boxes added and 6 removed.
- Top not rewritten when a box is kept: "follow their lines" and the existing wide-block test fail.
- The two verb-bar source files reverted to master: the verb-bar test fails.
- The root padding set inline as `var(--marxy-verb-room)`: the builder's test **passed**, so it would not catch a `var()` coming back on the root. The reviewer's fix makes it fail.
- The reviewer's new margin-note test fails when the comparison is put back to note text.

## Fix committed (`3c80b1a0`)

- `notes-in-place.ts` now keeps a box only while the note's markup is unchanged, not just its text. Code in a note is coloured after the notes are placed, which changes no text, so the old check left an uncoloured copy in the margin. It is now caught on the next relayout. A new test in `margin-notes.test.mjs` covers this.
- The verb-bar test in `page-furniture.test.mjs` now also checks that the root's own inline value is a plain length, and that the bar adds no custom property to the root's inline style.

## To file for later

- Recompute the root padding on every draw, or when the theme is applied, so a chrome-size change takes effect while the bar shows.
- The concurrent-writers case in `scripts/lib/perf-record.test.mjs` fails under load on Windows.
- The look engine writes tokens on the root at run time; check those for the same whole-page restyle.
- The click handler is still about 79 ms. Measure it together with `key-lookup` on the integration branch.

## Orchestrator's notes

- Ready for integration at `3c80b1a0`. The review earned its keep twice: an uncoloured copy of a note's code would have been left in the margin, and the builder's verb-bar test would not have caught the regression it was written for.
- The look engine's root tokens deserve a look with the measuring tool: "any `var()` on the root restyles the whole tree" may be costing other actions the same 130 to 150 ms on a long page (a look, pane or resize change). Worth a tracker row.
- The chrome-size case (padding stale until the bar reappears) is a small visible wrong; file it.
