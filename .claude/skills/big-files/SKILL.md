---
name: big-files
description: Use when writing or changing any Marxy feature that reads, renders, searches, transforms, exports or stores a document's content — a panel, a command, a reading or viewer, a pass over the page, the parse, find, Source, save — or when a file of 1 MB or more is slow, freezes or fails. A checklist and the tools that prove a change stays fast on big files.
---

# Big files

Files of 1 to 5 MB are ordinary for Marxy, and most of its freezes have come from features that were instant on a
30 KB fixture and walked the whole document on a big one. The rules, the size thresholds and the checks are in
`docs/big-files.md`; read it once. This skill is the checklist to run while building.

## Before writing code

1. **Name the input and its bound.** For each new loop, pass or listener: what does it walk (the file, the tree, the
   page, the visible blocks, the change)? If the answer is "the file" or "the page", it must not run per key, per
   scroll, per hover or per panel open.
2. **Reuse what the store holds.** The store already has the bytes, the buffer (text and offsets), the parse and the
   reading; a big text has a line index (`packages/core/src/reading/lines.ts`). Never parse, decode or split the whole
   file again for a feature.
3. **Decide where whole-file work runs.** Once per version of the bytes, in slices that yield to input or in a worker,
   cancelled when the bytes change. Say in the pull request which it is.
4. **Decide the cap and what the reader is told** when it is reached (rule 5 in the doc).

## While writing

- No DOM query or layout read inside a loop; no `shift`/`unshift`/`concat`/sort inside a loop; no array spread into
  call arguments; no whole-text `split('\n')`; no `new RegExp` from what the reader typed run unbounded on the main
  thread. `node scripts/check-scale.mjs <file>` checks a file; the Claude Code hook runs it after each edit.
- If a flagged shape is truly bounded, say why on its line: `// scale: <what keeps it small>`. Don't add the comment
  to silence the check; if you can't name the bound, change the code.
- Geometry comes from one read per frame (or a `ResizeObserver` entry), not from a read per block.

## Proving it

1. **A growth case** for any function that takes a whole document: add it to `packages/core/src/scale.test.ts` (shapes
   are there; the helper is `packages/core/src/testing/growth.ts`). The exponent must stay under the bound.
2. **A doubling probe** for anything in the browser: generate the shapes with `scripts/lib/big-files.mjs`
   (`bigFile(kind, bytes)`) at 1 MB and 4 MB and time the action; more than about 2.5× per doubling is a defect even if
   each time looks small. `node scripts/measure-scale.mjs --kinds <kinds> --sizes 1m,4m` does the standard actions.
3. **Say the numbers** in the pull request: sizes, times, and what still grows with the file.

## Known hot spots

The shapes and places that have frozen Marxy before, so a change near them gets extra care: export walking every
block against the whole article; a backtracking pattern in Search; one long unbroken run laid out with kerning; a
huge Word document's children spread into one `append`; panels re-parsing the whole file on the main thread; the
typesetting queue covering the whole page. The current list is the "Big files" section of `work/todo.md`.
