---
key: MARXY-64
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-64]
---
# MARXY-64 — A 5,000-word prose fixture

**Design:** [04-typeset](../../design/04-typeset.md) (what the rag numbers are re-evaluated on) · **Blocks:** MARXY-23.

## Outcome
`fixtures/corpus/15-long-prose.md`: ≥ 5,000 words of continuous English prose in paragraphs of 40–160 words, with headings every 600–900 words, a few emphasised phrases, quotations with curly and straight quotes, dashes, numerals, one blockquote, one list, no code, no tables. Public domain text (Project Gutenberg, e.g. a chapter sequence from a 19th-century essayist), with the source named in a leading HTML comment.

## Do this
1. Fetch the text once; normalise to LF; wrap nothing (paragraphs are single lines); no trailing spaces.
2. Add `packages/core/goldens/15-long-prose.ast.txt` via `pnpm --filter @marxy/core test:golden -- --update` (and the HTML golden if MARXY-75 landed).
3. Re-run `node packages/typeset/scripts/measure-rag.mjs --write` and commit `RESEARCH.md`'s regenerated tables; add a paragraph under "What the numbers say" reporting whether the three recommendations hold on the new corpus (short lines, CV, overfull counts), with numbers.

## Acceptance → check
Word count ≥ 5,000 (`wc -w` in the golden script's assertion list); goldens present; `measure-rag --verify` passes; RESEARCH.md updated with the three numbers.

## Do not
Edit any existing fixture byte. Include non-public-domain text.
