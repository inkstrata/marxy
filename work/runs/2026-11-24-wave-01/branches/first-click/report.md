# first-click: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Sonnet builder, 24 November 2026.

Commit: `e856fa9c` fix(read): margin notes stay put and the verb bar stops restyling the page (6 files, +135/-23)

## Profile (195 KB reference, 30 footnotes, Edge, Performance.getMetrics)

- The notes code runs only with the notes proposal on (default on) and a page that has footnote refs. A page without refs does nothing.
- Verb bar: the cost is style recalculation, not layout. Setting `data-marxy-verb-room` on the root cost about 130-150 ms of restyle of the whole tree. The cause is a `var()` in the root's style (`scroll-padding-bottom: var(--marxy-verb-room)`). Any `var()` on the root does it, even a registered non-inherited property. A literal length (px or em) costs 2 ms. The pane's own attribute costs 2 ms.
- Margin notes: every resize of the article or pane removed and rebuilt all notes. The verb bar's foot band also resizes the pane, so the first click rebuilt them too.

## Changes

- `notes-in-place.ts`: boxes are kept while they still copy the same notes (id, number, text). Only width and top are written, and only when they changed. All reads come before writes. Boxes are taken out only when there is no room or the note list changed.
- `verb-bar.ts`, `base.css`, `registry.json`: the root's scroll padding is now an inline length. It is set once when the bar comes up over the lone pane and removed with it. The root attribute, its CSS rule and its registry entry are gone. Nothing visible changes for the reader.

## Before and after (first click, 195 KB page)

| | Before | After |
| --- | --- | --- |
| Style recalc | 177 ms | 27 ms |
| Click handler | 137 ms | 79 ms |
| Margin notes removed and re-added on the click | 30 / 30 | 0 / 0 |
| Margin boxes added / removed across an open | 362 / 332 | 31 / 1 |
| Open task time | about 6.1 s | unchanged (typesetter-bound, noisy) |

## Tests

margin-notes and page-furniture browser files, 19/19 pass.

Verify (changed tier, `C:\Dev\reader\work\wave1\first-click-verify.log`):

- Pass: typecheck, lint, check (10/10), golden, fidelity, licences, unit-theme (305), unit-desktop (1319 pass, 1 skip), browser (235).
- unit-scripts: 242 pass, 1 fail. The failure is `scripts/lib/perf-record.test.mjs`, an existing file the builder did not touch, with EPERM on a temp-file rename under load. It passes alone, 3 runs out of 3. The full verify was not rerun after that.

## Revert-and-fail proof

With the three source files reverted these two new tests fail, and with the fix restored they pass:

- "the first click on a long page with notes shows the bar and leaves the margin notes where they are"
- "the verb bar coming up changes no attribute of the root and the root's scroll padding is a plain length"

"margin notes follow their lines when the page above them changes height" is a regression guard; it passes on both old and new code.

## Calls the orchestrator should know about

- The suite runs WebKit, which has no `Performance.getMetrics`. The whole-tree restyle is Chromium-specific, so the verb-bar test is structural (no root attribute change, no root rule with a `var()` scroll padding), not a count of restyles.
- The root padding is measured when the bar comes up (bar font size x 64/12). A change of chrome size while the bar is showing takes effect the next time the bar appears.

The dev server on 1492 is stopped. Scratch scripts, profiles and the revert-run log are in `C:\Dev\reader\work\wave1\first-click\`.

## Orchestrator's notes for the reviewer

- The click handler is still 79 ms against a target of under 30 ms. The remainder may be the reading-page lookup that `key-lookup` removes; measure the two together on the integration branch before deciding whether more is needed.
- "Any `var()` on the root restyles the whole tree" is a finding worth checking for other root-level custom properties written at run time (the look engine writes tokens on the root on look, pane and resize changes).
- The scroll padding no longer follows a change of chrome size while the bar is showing: confirm that no test or behaviour depends on it.
