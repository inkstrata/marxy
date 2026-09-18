---
key: MARXY-24
design: [04-typeset]
depends: [MARXY-23]
verify: [pnpm precheck, pnpm done MARXY-24]
---
# MARXY-24 — Hanging punctuation, optical alignment and allow-listed hyphenation

**Design:** [04-typeset](../../design/04-typeset.md) §Hang, §Hyphenation · **Depends on:** MARXY-23.

## Do this, in order
1. `packages/typeset/src/hang.ts`: after `applyBreaks`, for each line start, wrap the first grapheme (`Intl.Segmenter`) in `<span class="marxy-hang">` when it is in the hanging set or has a non-zero `latinProtrusion` value; measure its advance with a `Range`; set `style.marginInlineStart = -(fraction × advance) px` (fraction 1 for the quote set).
2. `packages/typeset/src/hyphenate.ts`: import `justif/hyphenate/en-us` and `en-gb` lazily by `lang`; feed hyphenation points into `items.ts` as penalty-50 flagged items with the hyphen advance; skip `code`, URLs, words with digits, words < 6 letters.
3. `attach()` options `hanging: 'left'`, `hyphenate: true` become the app's defaults; `relayout` reverts hang spans too.
4. Add `en-gb` to `scripts/allowlists/hyphenation-patterns.json` if absent; `pnpm gate:licences` must pass (justif's pattern files carry their own licences; the gate already reads them).
5. Rag numbers: repeat MARXY-23's measurement with hyphenation on; ship it on only if the short-line rate does not rise; record both in `RESEARCH.md`.

## Tests
`.marxy-hang` rect left < content left by ≥ 40 % of its advance (§10 check 6); a hyphenated break renders a visible hyphen at the line end and `Selection.toString()` across it contains no U+00AD; find matches the whole word; `code` spans never hyphenate; licence gate green.

## Do not
Hang on the right edge. Add patterns beyond the allow-list.
