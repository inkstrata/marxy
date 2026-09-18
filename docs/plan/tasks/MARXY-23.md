---
key: MARXY-23
design: [04-typeset]
depends: [MARXY-19, MARXY-20, MARXY-21, MARXY-64, MARXY-75]
verify: [pnpm precheck, pnpm done MARXY-23]
---
# MARXY-23 — Ragged-right Knuth–Plass through justif/core on paragraphs, list items and quotes

**Design:** [04-typeset](../../design/04-typeset.md) (all of it) · **Depends on:** MARXY-19 (done), MARXY-20, MARXY-21, MARXY-64, MARXY-75.

## Outcome
Rendered paragraphs are set by the typesetter: even rag, no short lines, no overfull lines, body text still inline HTML (selection, find, copy work).

## Do this, in order
1. `packages/typeset/src/runs.ts`: `collectRuns(p: HTMLElement): Run[]` (§04 step 1). Test with a paragraph containing `em`, `code`, a link.
2. `packages/typeset/src/measure.ts`: `measureWords(runs): Map<string, number>` via `Range.getClientRects()`, cache keyed `(text, fontKey)`; one forced layout per paragraph (assert with a `getBoundingClientRect` spy in the test).
3. `packages/typeset/src/items.ts`: port `scripts/rag-model.mjs`'s item construction to TypeScript against `justif/core`'s `buildItems`; glue stretch `0.6 × fontSize`, shrink 0.
4. `packages/typeset/src/apply.ts`: `applyBreaks(p, breaks)` and `revert(p)` (§04 steps 5–6): soft hyphen + `<br class="marxy-lb">`, `.marxy-set`, overflow verification, revert on overflow.
5. `packages/typeset/src/scheduler.ts`: viewport first, idle chunks ≤ 8 ms, `requestIdleCallback` polyfill, IntersectionObserver for unset paragraphs.
6. `packages/typeset/src/index.ts`: `attach()` and `TypesetController` (§04 signature); `relayout` on `fonts`, `resize` (width change only), `theme`, `reload`.
7. `apps/desktop/src/main.ts`: `typeset.attach(article, { lineBox, glueStretchEm: 0.6, hyphenate: false /* MARXY-24 */, lastLineMinWidth: 0.33, hanging: 'none' })` after `first_text`; emit `typeset_viewport` mark with `stats.viewportMs`.
8. Rag measurement on the rendered result: extend `scripts/measure-rag.mjs` with `--dom` mode that reads line rectangles from a Playwright page rendered through the headless entry (MARXY-25) or, until it lands, from a static page; record short-line rate and CV for the corpus at 0.6 em with hyphenation off, in `packages/typeset/RESEARCH.md` under "Rendered".
9. Decision note in the PR: engine kept (justif/core) or switched, per the research's five criteria.

## Tests
See the §04 test table: apply/revert identity, forced overflow fallback, find across a break, selection across a break, viewport budget, rag not worse than greedy. Plus: `01-long-technical.md` paragraph 3 items equal the harness's counts.

## Do not
Render text to canvas or absolutely positioned spans. Justify. Touch the theme's tokens. Turn on hyphenation (MARXY-24).
