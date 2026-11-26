# definitions-index: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Opus builder, 24 November 2026.

The region reparse now knows the file's definitions and parses the whole file only when an edit adds, removes or changes one. It is committed on `agent/definitions-index` as one commit, `064bf53f`: feat(parse): a region reparse knows the file's definitions and parses whole only when an edit changes one. The worktree is clean.

## What changed for the reader

Nothing visible. On a file with link reference or footnote definitions, a reload after a small edit now parses a region instead of the whole file. On `32-long-reference.md` (195 KB, 30 footnotes):

| | master | branch |
| --- | --- | --- |
| One-line reload | 144 ms, whole | 1.3 ms, 157-byte region |
| Whole parse | 136-152 ms | 141-149 ms (no measurable cost) |
| 90 one-line insertions across the file | all whole | all region |

## How it works

- Each parse records an index of its definitions: kind, label, url, title and byte range, in document order, with first-wins targets.
- It also keeps micromark's own label lists (`parser.defined`, `parser.gfmFootnotes`). They are read by a construct that matches nothing, placed first at `document[91]`, `contentInitial[91]`, `text[91]` and `text[93]`, so it runs before any label is pushed or looked up.
- A region parse uses the same construct to put the file's labels into those lists first. The file's targets go to `documentFromMdast`, so a reference in the region resolves to a definition outside it.
- If micromark's lists and the tree's definitions disagree, the index is marked untrusted and the file parses whole. That never happened on the corpus.
- No change to `patches/micromark@4.0.2.patch`, and no new dependency.

## The rule for "touches a definition"

The reparse uses the region only when both hold:

1. The old definitions in the replaced span equal the new parse's definitions before the new witness: same kind, label, url and title, in the same order (positions may differ).
2. Every label the region's parse added to micromark's lists comes from a definition in its own tree.

Otherwise it parses whole, with the reason "the change adds, removes or changes a definition, which applies across the file". This covers:

- An edit beside a definition or inside a footnote's text keeps the region.
- Turning a paragraph into a definition, or a definition into a paragraph, goes whole.
- Removing the blank line above a definition goes whole.
- Changing a definition's label, url or title goes whole.
- Re-indenting text into or out of a definition goes whole.
- A reference whose label changes keeps the region.

A definition between two blocks also counts as part of what comes before a fresh line, so a definition there no longer stops a block from serving as the start or end of a region.

## Tests

- New tests were written first and failed on the old code because it parsed whole: on corpus files with definitions, region 27 / whole 106; on the named cases, "whole"; on generated files with definitions, region 196 / whole 2304.
- The test that pinned "a definition forces the whole parse" now pins the new rule, and the existing test was renamed to "a definition added sends the reparse to the whole file".
- `reparse.test.ts` 14/14. Core suite 4319 pass, 0 fail, 3 skipped. `typecheck`, `lint` and `check` are clean.
- `REPARSE_SEEDS=1500`: the old structured test ran 37,500 edits, 29,511 by region; the new one with definitions ran 37,500 edits, 22,700 by region. 0 failures in both.
- A scratch histogram of 7,500 edits on files with definitions: 4,505 took the region path; 1,481 parsed whole for a definition, and all 1,481 really changed the file's definitions, so the rule never refused an edit it could have taken; 1,514 parsed whole because the region would not close, about the same share as on files without definitions.

## Revert-and-fail proof

Each of these mutations makes the new tests fail: no label seeding; no file targets; the definition comparison always agreeing; the construct placed after the others instead of first; the carried index not moved by the edit.

The last one passed the first version of the tests. A check was then added that the definitions a reparse carries forward equal the whole parse's, and the generated test now chains reparses as a live reload does.

## Verify turn

Every step green except `browser`, 119 pass and 1 fail. The failure was in `undo-endings.test.mjs` (a CRLF save byte), on a page with no definitions. That file passes 22/22 when run alone, so it is load. Log: `C:\Dev\reader\work\wave1\definitions-index-verify.log`.

## Differences between region and whole parse found in the final code

None.

## Assumed rather than proved

- micromark tokenises every definition before any text, so each lookup sees the full set. Established by reading the code and checking with probes, not from documentation.
- The added construct does not change any parse. The branch's parser equals master's on 4,034 inputs.
- The check in rule 2 is not exercised by any test: no input could be built that adds a label without a definition in the tree.

## Not done

`parseMarkdownChunked` still parses a file that may hold a definition whole. A parse in slices has no earlier index to start from, so fixing it would need a second pass; that is not natural, so it was left. `docs/architecture.md` describes the new reparse and says this.

Logs and probes are in `C:\Dev\reader\work\wave2\definitions-index\`.

## Orchestrator's notes for the reviewers

- This is the branch where a mistake is a wrong document nobody notices. Two reviewers: Sonnet first, then a fresh Opus told to break it. One at a time in the worktree.
- A construct "that matches nothing" is registered at four places in micromark's tables so it runs before any label is pushed or looked up. That depends on the order in which micromark tries constructs at a character code, and on those four being the only places a label is pushed or read. Verify both from micromark's source in `node_modules`, including the footnote extension's own constructs and what happens inside containers (block quotes, list items), which have their own tokenisers.
- "The branch's parser equals master's on 4,034 inputs": the added construct runs on every parse now, not only region parses. Check the cost on a whole parse of a large file with no definitions (the builder says none measurable) and that nothing about a whole parse changed, on the goldens (`pnpm gate:golden`) and the CommonMark spec run (`pnpm --filter @marxy/core test:spec`).
- Rule 2 has no test because no input triggers it. Either find one (labels pushed by constructs other than definitions: an abandoned definition attempt, a footnote call, a label pushed and then the definition rejected at a later line) or show from the source that none exists.
- Cases to try that the report does not name: a definition inside a block quote or list item that the edit does not touch but the region contains; the same label defined twice with the edit removing neither but changing which comes first in the region; a label that differs only by case or by internal whitespace between a reference in the region and a definition outside; a reference in the region to a label defined only later in the file, and only earlier; a footnote reference whose definition is outside the region; a region that starts or ends directly at a definition; CRLF and BOM files; an edit that makes a definition's label too long or invalid.
- The plan said this index would also let the sliced parse used when opening large files, and the notes scan in Source, keep working on files with definitions. The builder found it does not, for a sound reason (a sliced parse has no earlier index). The plan needs that corrected.
- The gain is measured in the parser only. In the app the store still calls the region parse only for reloads, and the page update still refuses on a footnote definition (`apps/desktop/src/render/incremental.ts`), so the reader sees none of it until `footnote-splice` lands.
