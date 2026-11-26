# @marxy/typeset

The typesetter: ragged-right line breaking, hyphenation, hanging punctuation and the baseline grid,
applied to a rendered article in the DOM. `attach(article, options)` in `src/index.ts` is the way in;
it sets the page in slices so the reader can scroll while it works. What it does to a page is in
[docs/themes-and-type.md](../../docs/themes-and-type.md).

| Path | What it is |
| --- | --- |
| `src/ragged.ts`, `src/items.ts`, `src/runs.ts`, `src/measure.ts` | the line breaker and what it measures |
| `src/hyphenate.ts`, `src/hang.ts`, `src/slash-break.ts` | hyphenation, hanging punctuation, breaks after slashes |
| `src/grid.ts`, `src/apply.ts`, `src/scheduler.ts` | the baseline grid, writing the result to the page, and slicing the work |
| `test/` | tests that set real pages in WebKit |

## Commands

| Command | Does |
| --- | --- |
| `pnpm --filter @marxy/typeset test` | the unit tests and the WebKit tests |
| `node scripts/measure-typeset-idle.mjs` (from the root) | what a set page writes and holds at rest and on a scroll |

## Tools in `scripts/`

| Script | Is |
| --- | --- |
| `rag-model.mjs` | paragraphs from the corpus, a greedy baseline and the rag metrics; the tests and the aesthetics gate score with it |
| `font-metrics.mjs` | advance widths read from a font file, with no DOM; a desktop test checks the canvas measure against it |
