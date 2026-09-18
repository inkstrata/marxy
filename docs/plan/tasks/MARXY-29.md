# MARXY-29 — Smart typography as a render pass

**Design:** [02-render](../../design/02-render.md) §Smart typography, D-A13 · **Depends on:** MARXY-12.

## Do this
1. `packages/core/src/render/typography.ts`: `smarten(text: string, ctx: { atParagraphEnd: boolean; wordsInParagraph: number }): string` implementing the rule table; `render-html.ts` calls it for `text` nodes outside `code`, `mathInline`, link URLs and islands, and computes `atParagraphEnd` for the last text node of a `paragraph`.
2. Goldens (AST unchanged; HTML goldens change) — update with a queue entry.

## Tests
Rule table cases; idempotence on the corpus; `09-gfm-everything.md` shows `“ ” ‘ ’ – — …` in HTML while `gate:fidelity` proves the file unchanged; no U+00A0 inserted into paragraphs under 8 words; code spans untouched.
