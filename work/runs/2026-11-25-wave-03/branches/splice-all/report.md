# splice-all: builder report (Sonnet)

Branch `agent/splice-all`, base `84a815dd`. Commit `65e10904` "feat(view): any change to the bytes replaces only the blocks it touched" (only commit; tree clean).

Reader-visible change: undo, redo, an operation (a tick) and a Source commit on a long page replace only the blocks that changed; the rest keeps its elements and typeset paragraphs.

## Code

- `store.ts`: new `reparse` helper. `apply`, `commitSource`, `undo`, `redo` use `reparsedAst` (region parse) when the store's parse has been made; a lazy, unmade parse stays lazy.
- `rendered-view.ts`: `repaint` always tries `splicePage`, falls back to the whole render on refusal. "not a reload" and `ownCommit` gone. Other refusals and the 64 KB floor untouched.
- Two exceptions added, both set the page whole with the reason recorded in `marxy:repaint`: a rename ("the file was renamed", every node's file changes); the public `repaint()` that `commitEdit` calls for unchanged bytes ("the bytes are unchanged", it exists to reset the DOM).
- Docs: `docs/architecture.md` updated; comment on the 64 KB constant reworded; new test file in `scripts/verify-map.json`.

## Item 3 (what a splice leaves that a whole render rebuilds)

- Highlight skips nodes marked `data-marxy-done=highlight`; math skips done nodes.
- Selection, find, depths, notices, outline: no existing test covers an undo or operation through the splice for these. Live-reload and block-edit suites pass.
- Images not examined.

## Numbers, `long-reference-plain`, undo (before: wave 2 baseline `84a815dd`; after: `plan\records\splice-all-after.json`)

| | before | after |
| --- | --- | --- |
| top-level nodes replaced | 2,513 | 3 |
| TaskDuration | 2,843 ms | 635 ms (machine loaded) |
| layouts | 422 | 72 |

`long-reference` (footnotes): still 2,463 replaced, by design; task time 3,037 to 5,072 ms, taken to be load (node counts identical). `--docs long-reference-plain,long-reference` still printed `short-document` in the table.

## Tests (each file alone)

- New unit `src/document/store-chain.test.ts`: 2 pass. Revert proof: with the store change reverted, "keeps the nodes before it" fails. The random-chain equality test passes on master too (a correctness guard).
- New browser `test/splice-all.test.mjs`: 2 pass. The store-driven differential (apply/undo/redo/commitSource chains over 160 KB, markup byte-equal to a whole render) also passes on master (guard). Revert proof: with the view change reverted, the Mod+Z test fails (`how` whole). Mod+Z test: undo after a tick replaces under 10 top-level nodes, `marxy:repaint` says `replaced`, typeset paragraphs keep `marxy-set`.
- block-edit and live-reload together: 64 pass.
- Verify turn 11/11 (`work\wave3\splice-all-verify.log`): unit-desktop 1258, unit-desktop-browser 44, browser 342 pass, 1 skip.

Not done: real window not driven.

## Orchestrator notes

- Checked: one commit, tree clean, verify 11/11 exit 0 (15:15).
- Gap: item 3 of the brief was only half done (selection, cursor, find, depths, notices, outline/crumbs, spine and images after a spliced undo or operation were not shown right). The reviewer is asked to test them, since a wrong cursor or a stale find after undo is the likeliest visible regression.
- The `--docs` filter not honoured is a measuring-tool bug; file it.
