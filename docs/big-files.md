# Big files

A file of 1 to 5 MB is an ordinary file for Marxy: a long transcript, a book, a log, a data export, a generated
reference. This document says what happens to such a file today, the rules every feature follows so that it stays
usable, and the checks that hold features to them. The size limits themselves are listed in
[file-kinds.md](file-kinds.md#size-limits); the research behind the rules (how comparable apps handle big files, with
sources) is [research/large-files](research/large-files/SYNTHESIS.md).

## What a big file goes through

| Size | Markdown | Text, code, logs | Tables, records | JSON |
| --- | --- | --- | --- | --- |
| under 5 MiB | parsed (in slices), rendered and sanitised whole; mounted two screens first and the rest in idle slices; every paragraph typeset in an idle queue | code and text in pieces of 200 lines; colour for files up to 2 MB with no line over 10,000 characters | row-indexed from the bytes; the rows near the screen drawn | a data tree up to 1.5 MB, then streamed |
| from 5 MiB (5,242,880 bytes) | read as lines: a line index over the bytes, the lines near the screen drawn; the Outline from a heading scan; "Show rendered" parses it as a page | read as lines the same way | the same | the same |
| from 32 MB | Read does not edit; Source does | the same | | |
| from 256 MB | opens as a card with the hex view | | | |

So below 5 MiB a Markdown file costs work that grows with the whole file at every stage: the parse, the HTML string,
the sanitiser, the DOM and the typesetting. Work in the panels, find and export that walks the page or the tree does
too. That range is where big files hurt, and where the rules below matter most.

## The rules

Each rule is checkable: by `check-scale` in `pnpm check` (the code shapes of rules 3 and 4), by a growth case in a test
(rules 2 and 6), or by a reviewer reading the diff with the question it asks (the rest, and the parts of rule 3 no syntax
check sees: a scan of the whole text per match, recursion as deep as the input).

1. **Work for an interaction is bounded by what it touches.** A key, a scroll, a hover, a click, opening a panel or a
   menu costs work in proportion to what is on screen or what changed, never to the file. A panel that needs the whole
   document reads what the store already holds (the parse, the line index, the reading) instead of parsing again.
2. **Whole-file work happens once per version of the bytes, off the critical path.** A parse, an index, a search, a
   colour pass or an export runs in slices that yield to input (or in a worker), can be cancelled when the bytes change
   or the reader leaves, and its result is shared by every feature that needs it.
3. **No shapes that grow faster than the input.** No scan of the whole document or page per item: no DOM query or
   layout read inside a loop, no `shift`, `unshift`, `concat` or sort inside a loop, no `indexOf` over the whole text per
   match. No array spread into call arguments (`push(...xs)`, `append(...nodes)`, `Math.max(...xs)`): past about
   100,000 elements it throws. No split of a whole text into all its lines. No recursion as deep as the input nests.
4. **Patterns from the reader are bounded.** A regular expression typed by the reader, or built from what the reader
   typed, never runs unbounded over a whole file on the main thread; match and result lists have a cap.
5. **Every cap says so.** A reader that stops early tells the reader in its own words what it left out, as the size
   limits do, and never fails the page.
6. **A feature that takes a whole document is measured at size.** It gets a growth case (below) or a probe at 1 MB and
   4 MB with the big-file generator, and its pull request says what the numbers were.

## The checks

| Check | What it holds | Where |
| --- | --- | --- |
| `check-scale` (in `pnpm check`) | the code shapes of rule 3 and run-time patterns (rule 4), counted per file against `scripts/allowlists/scale.json`: a count may fall, never rise | `scripts/check-scale.mjs` |
| growth cases | a function that takes a whole document (parse, render, readings, line index, splice, diff, sanitiser) timed on an input and on one four times bigger; the growth exponent stays under 1.45 (linear is about 1, a pass per item about 2) | `packages/core/src/scale.test.ts`, helper `packages/core/src/testing/growth.ts` |
| the big-file generator | every shape a reader opens (Markdown prose, transcripts, tables, references and footnotes, headings, fences, one unbroken line; text, code, JSON pretty, minified and deep, CSV, JSON Lines, logs, diffs, HTML, YAML) at any size, deterministic | `scripts/lib/big-files.mjs` |
| the scale matrix | opens each shape at each size in the browser build and times the actions a reader takes (open, a key, a scroll, find, Source and back, an edit and undo, a reload), with the growth per doubling | `scripts/measure-scale.mjs` |

A hit that `check-scale` finds but that is bounded is allowed with a comment on its line or the line above that says
why, starting `scale:`:

```ts
cells.push(...row); // scale: one table row, at most 100 cells (readings cut the rest)
```

The comment is the point: whoever writes the code says, where the next reader will see it, what keeps the input small.
`node scripts/check-scale.mjs --list` prints every unbounded hit in the tree; `--write` records the counts after some
are removed, and refuses to raise one unless given `--allow-raise`, which is for a change to a rule that finds shapes
already in the tree. An empty `// scale:` bounds nothing.

## For coding agents

`AGENTS.md` carries these rules in short, and the project skill `.claude/skills/big-files` is the checklist for a
change that reads, renders, searches, transforms or stores a document's content. In Claude Code, a hook in
`.claude/settings.json` runs `check-scale --hook` after each edit of the app or the packages: the first edit of a
session gets the rules in short, and an edit that adds an unbounded shape gets told where, before `pnpm check` fails.
