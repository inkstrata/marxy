# footnote-splice: builder report (Opus)

Built and passing its tests; one shortfall against the brief's numbers. On `long-reference`, undo replaces 33 top-level nodes (was 2,463) and an appended-line reload 31 out / 33 in (was 2,465 / 2,467); the brief asked for under ten. The 30 extra look like the margin-note copies (inference, not checked node by node).

## Commits (on `agent/footnote-splice` from `b0d9cb52`; tree clean)

- `ecf9fdc7` feat(render): replace changed blocks in place on a page with footnotes
- `78208cb3` feat(render): render a document with footnotes in slices

## When the splice is taken

Only when the old and new label-to-number maps are identical (`footnoteNumbers`: first top-level definition of each folded label). Otherwise a whole render, reason `'the footnotes are numbered differently'`. Replaced blocks are rendered with the document's numbers and draw no list of their own (new `footnotes` run option). The body cut ends at the list's provenance-less `<hr>`; the shift of byte attributes stops there.

## A list item per reference

Nothing per reference: each item is the label's first definition plus one back-link to `#marxy-fnref-N`, so it depends on its definition and number only. If the new definition is the old one shifted by its own offset (`sameMoved`), the item is kept and shifted; otherwise redrawn from the new list and swapped. Removals are the tail of the whole render's, swapped the same way.

## Ids

The splice produces exactly what a whole render does. But a whole render already gives every reference to a label the same id `marxy-fnref-N`, so a label referenced twice has duplicate ids today; left alone (changing it changes what the reader sees).

## Differential

0 mismatches in 1,500 wide cases (1,050 spliced, 201 list items redrawn) and in the committed 160-case run. Three mutations each fail it: cut rendered without the document's numbers; never redrawing an item; shifting items by the change's offset instead of their own.

## Slices

`renderDocumentSafeHtmlInSlices` now slices footnoted documents: body in runs, list once at the end. Slice tests now expect footnoted documents to be sliced; the oracle's mutant is a slicer that numbers each run's notes on its own.

## Proof

- Footnote differential with the long reference and four generated documents (definitions top, middle, bottom, spread; duplicates; a quoted definition; references before and after). On master all 160 cases declined, so it failed.
- Browser test on `long-reference`: an appended line, a rewritten paragraph and a changed note each replace fewer than 10 nodes; a note number opens its own note (opens under the line), the back-link lands on the reference. Fails on master.
- Core render and sanitiser unit tests 557 pass.

## Verify

11/12: browser 300 pass, 3 fail (`large-open-panel`, `paragraph-restyle`, `reading-lines`), timeouts or a time bound, with the measurement running at the same time; each passes alone: load.

## Numbers (`plan\records\footnote-splice-after.json` against the wave 3 baseline)

| `long-reference` | removedTop / addedTop | layouts |
| --- | --- | --- |
| undo | 2,463 / 2,463 to 33 / 33 | 456 to 80 |
| reload | 2,465 / 2,467 to 31 / 33 | 475 to 85 |

Plain page unchanged: undo 3, reload 0 / 2. The remainder is exactly 30, the note count: the measure runs at 1440 px where notes sit in the margin, and the idle margin pass (`placeMarginNotes`) always takes all its copies out and puts them back.

## Assumed, not checked

- The sanitiser carries no state between blocks beyond its open-element stack; its 100,000-removal cap ignored.
- A margin note copied into the page is laid out again correctly after a splice (not tested).

## For the orchestrator

- One comment line changed in `rendered-view.ts` (said slices decline footnotes): small conflict expected.
- Docs: `docs/architecture.md`, `docs/testing.md`, a comment in `scripts/measure-interactions.mjs`.

## Orchestrator notes

- File: the margin-note pass rebuilds all 30 copies after any change (a candidate small branch: place only the notes whose blocks changed); duplicate `marxy-fnref-N` ids for a label referenced twice (pre-existing).
- Slicing footnoted documents is a change in open behaviour for large footnoted files: the reviewers must check it as hard as the splice.
- Reviews: Sonnet first, then a fresh Opus told to break it.
