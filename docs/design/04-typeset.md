# 04 — Typesetting

`packages/typeset`: ragged-right Knuth–Plass through `justif/core`, left-edge hanging and optical
alignment, and the baseline-grid pass. Builds on MARXY-19's measured recommendation
(`packages/typeset/RESEARCH.md`): justif/core, word-glue stretch ≤ 0.6 em, assert no overfull
line, and re-check every threshold on the 5,000-word fixture (MARXY-64).

What the research also says, and this design takes seriously: Knuth–Plass improves the rag in
about a fifth of paragraphs. The visible difference to a first-time reader comes from the
**bundle** — even rag, hung punctuation, no short last lines, and a grid that never drifts. All
four are built here, and the aesthetics gate measures all four (§10).

## Public surface (`packages/typeset/src/index.ts`, replaces the placeholder)

```ts
export interface TypesetOptions {
  readonly lineBox: number;                 // px; from --marxy-line-box
  readonly glueStretchEm: number;           // 0.6 (research); themes may lower it
  readonly hyphenate: boolean;              // true for lang en-*
  readonly lastLineMinWidth: number;        // 0.33 (justif default)
  readonly hanging: 'none' | 'left';        // v1: 'left'
  readonly scheduler?: Scheduler;           // injectable for tests; default: idle-chunked
}
export interface TypesetController {
  readonly ready: Promise<void>;            // first pass over the viewport done
  relayout(reason: 'fonts' | 'resize' | 'theme' | 'reload'): void;
  destroy(): void;                          // restores native wrapping everywhere
  readonly stats: { paragraphs: number; typeset: number; fallbacks: number; viewportMs: number };
}
export function attach(article: HTMLElement, opts: TypesetOptions): TypesetController;
export function snapToGrid(article: HTMLElement, lineBox: number): void;   // §Grid
```

## Which elements

`p`, `li` (its own inline run when the item is tight), `blockquote > p`, `dd`, `figcaption`,
selected by `[data-marxy-s]` on those tags. Skipped (left to the engine, counted in `fallbacks`
with a reason): paragraphs containing `img`, `.marxy-math-inline`, or elements with
`white-space: pre`; paragraphs whose text is > 20 % CJK code points (kinsoku is v1.x); paragraphs
shorter than the measure (one line; nothing to break).

## Pipeline per paragraph

1. **Runs.** Walk the paragraph's inline content into runs of `{ text, node: Text, font }` where
   `font` changes at any element boundary whose computed `font-family`, `font-size`,
   `font-weight`, `font-style`, `font-variation-settings` or `letter-spacing` differ. Inline
   `code` is its own run with `hyphenate: false` and `unbreakable` inside.
2. **Items.** Words are boxes; spaces are glue with `width = advance(' ')` in the run's font,
   `stretch = glueStretchEm × fontSize`, `shrink = 0`; explicit hyphens and dashes are penalty-50
   break opportunities; hyphenation points (below) are penalty-50 with a hyphen width; the
   stream ends with justif's parfillskip idiom. Built with `justif/core`'s `buildItems` (the
   research harness `scripts/rag-model.mjs` already shows the call shape; port, don't reinvent).
3. **Measure** (D-A4). Word advances come from `Range.getClientRects()` on the real text nodes:
   create one `Range` per word inside its text node and read `getBoundingClientRect().width`.
   All ranges for a paragraph are created first and read together, so layout is forced once per
   paragraph. Cache by `(text, fontKey)` for the document's lifetime; a reload hits the cache
   for unchanged words. Widths are what the engine paints, including optical size and the weight
   offset — a canvas cannot express either.
4. **Break** with `breakParagraph(items, widths, { tolerance: 200, emergencyStretch: 'auto',
   lastLineMinWidth })`; `widths` is the paragraph's content width (`clientWidth` minus padding)
   for every line.
5. **Apply.** For each break: split the text node at the break's code-unit offset, insert
   `<br class="marxy-lb">`; at a hyphenation break insert U+00AD before the `<br>` (the engine
   paints the hyphen because the line ends there; find and copy skip soft hyphens). Set
   `white-space: nowrap` on the paragraph via `class="marxy-set"`. Trailing spaces before a
   `<br>` are left in the text (they collapse visually).
6. **Verify.** Measure each line (`Range` from line start to the `<br>`) — if any line's width
   exceeds the content width by more than 0.5 px, **revert this paragraph** (remove the `<br>`s,
   rejoin text nodes, drop the class) and count a fallback. Overfull lines are never shown.
7. **Hang** (D-A6). For each line start whose first grapheme is in the hanging set
   (`“ ‘ " ' ( [ ‹ «`) or whose protrusion value in `justif/core`'s `latinProtrusion` table is
   non-zero, wrap that grapheme in `<span class="marxy-hang">` with
   `margin-inline-start: -<protrusion × advance>px` (full advance for the quote set, the
   table's fraction for letters). The right edge is ragged and gets nothing.

`destroy()` and `relayout()` revert every paragraph to the original DOM (the original text nodes
are kept by reference) before re-running, so no state accumulates.

## Hyphenation

`justif/hyphenate/en-us` and `en-gb` only (allow-list `scripts/allowlists/hyphenation-patterns.json`);
chosen by the nearest `lang`; no pattern → no hyphenation. Minimum word length 6, at least 3
letters on each side (justif defaults). Never hyphenate inside `code`, URLs, or words containing
digits. The research measured with hyphenation off; MARXY-23's rag numbers are recorded twice,
off and on, and the on setting ships if it does not increase short lines.

## Scheduling (§00 targets)

- First pass: the paragraphs intersecting the viewport plus one screen below, synchronously in
  the animation frame after `first_text`. Budget 100 ms; the controller records `viewportMs`.
- Remainder: idle chunks of ≤ 8 ms in document order, nearest-to-viewport first, via
  `requestIdleCallback` or the `setTimeout(0)` polyfill (`scheduler.ts`; WebKitGTK has no
  `requestIdleCallback`).
- Scrolling into unset paragraphs triggers them immediately (IntersectionObserver with a
  200 % root margin).
- Triggers for `relayout`: `document.fonts.ready` (if the first pass ran before it), window
  resize when the article's content width changed (debounced 100 ms), theme/token change,
  reload. A reload reuses the measurement cache, so unchanged paragraphs re-set in ~1 ms each.

## Grid (D-A7)

Text blocks satisfy the grid by CSS construction (§05). `snapToGrid` handles the rest:
for each direct child of the article (and each `pre`, `img`, `table`, `.marxy-math`, island
element anywhere), compute `outer = marginTop + height + marginBottom`; if `outer mod lineBox`
is not 0 (± 0.5 px), add `padding-bottom` so that it is. Images centre vertically inside the
padded box (`display: block; margin-inline: auto`). Runs once after each typeset pass and after
each image or KaTeX load (ResizeObserver on those elements, batched to one frame).

## Kill switch and diagnostics

`--marxy-typeset: none` (a token) or config `typeset = false` disables everything except the
grid pass. `MARXY_DEBUG=1` adds outline colours per state (set, fallback, native) via a
`data-marxy-typeset` attribute the theme may style.

## Tests (`packages/typeset/src/*.test.ts`, Playwright for the DOM parts)

| Case | Expect |
| --- | --- |
| items from `01-long-technical.md` paragraph 3 | box/glue/penalty counts match the research harness for the same text |
| breaks applied then reverted | `article.innerHTML` identical to before `attach` |
| forced overflow (measure = 10 ch) | paragraph counted as fallback, no `<br>` left inside it |
| find-in-page across a hyphenated break | `window.find` / Custom Highlight matches the word |
| selection across a `<br>` | `Selection.toString()` contains no U+00AD and a single space |
| hanging quote | first grapheme's rect `left` < paragraph content `left` by ≥ 40 % of its advance |
| grid | every block's `top mod lineBox` ≤ 0.5 px over the corpus at three widths |
| budget | viewport pass on `01-long-technical.md` < 100 ms in Playwright WebKit on the reference machine; CI uses the envelope tier |
| rag | short-line rate and CV over the corpus at 0.6 em ≤ the research's greedy figures (ADR-0007's Phase 1 test) |
