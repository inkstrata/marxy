---
key: MARXY-296
design: [02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-296]
---
# MARXY-296 — Extend widow prevention (widont) to paragraphs ending in code, image or math

**Design:** [02-render](../../design/02-render.md) · **Delta:** [2026-09-28-bugcatch-2](../deltas/2026-09-28-bugcatch-2.md) · **Depends on:** nothing.

**Outcome.** A paragraph of 8+ words ending in inline code, an image, or inline math gets widow prevention applied correctly, or the story documents why it's out of scope.

## Why
`lastTextNode` (`render-html.ts`) only recurses into `text`, `emphasis`, `strong`, `strikethrough` and `link` nodes, but `wordsIn` (gating `wordsInParagraph >= 8`) also counts `code` and `mathInline` node values as words. A paragraph ending in inline code or math can pass the word-count gate while `lastTextNode` returns the wrong (earlier) text node or none at all, so the NBSP join either lands in the wrong place or never happens — defeating widow prevention exactly where a widow (a short trailing code span or symbol) is likely.

## Files and signatures
- `packages/core/src/render/render-html.ts`: extend `lastTextNode`'s walk (or `applyWidont`'s call site) to handle a paragraph whose true last element is `code`/`image`/`mathInline`/a break, joining across that element's HTML boundary where feasible.

## Tests → expected
| Check | Expect |
| --- | --- |
| An 8+ word paragraph ending in inline code (or image/math) | widow prevention is applied at the correct point |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
