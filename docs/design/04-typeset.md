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
  readonly raggedStretchEm?: number;        // per-line right-skip for the ragged breaker; default 2
  readonly glueStretchEm: number;           // per-space stretch, only for engine 'justif' (MARXY-19's 0.6)
  readonly engine?: 'ragged' | 'justif';    // default 'ragged' (ADR-0007 Amendment 1)
  readonly hyphenate: boolean;              // MARXY-24
  readonly lastLineMinWidth: number;        // accepted; the ragged breaker's last line is free
  readonly hanging: 'none' | 'left';        // MARXY-24
  readonly scheduler?: Scheduler;           // injectable for tests; default: idle-chunked
  readonly onPass?: () => void;             // after each pass: the app re-runs the grid pass
}
export interface TypesetController {
  readonly ready: Promise<void>;            // first pass over the viewport done
  readonly done: Promise<void>;             // every paragraph considered
  relayout(reason: 'fonts' | 'resize' | 'theme' | 'reload'): void;
  destroy(): void;                          // restores native wrapping everywhere
  readonly stats: { paragraphs; typeset; fallbacks; short; viewportMs; reasons: Record<string, number> };
}
export function attach(article: HTMLElement, opts: TypesetOptions): TypesetController;
export function snapToGrid(article: HTMLElement, lineBox: number): number;   // §Grid
```

## Which elements

`p`, `li` (its own inline run when the item is tight), `blockquote > p`, `dd`, `figcaption`,
selected by `[data-marxy-s]` on those tags. Skipped (left to the engine, counted in `fallbacks`
with a reason): paragraphs containing `img`, `.marxy-math-inline`, or elements with
`white-space: pre`; paragraphs whose text is > 20 % CJK code points (kinsoku is v1.x); paragraphs
shorter than the measure (one line; nothing to break).

## Pipeline per paragraph (as built, MARXY-23)

A batch of paragraphs is read, broken, written and verified in that order, so a batch costs two
layouts however many paragraphs it holds.

1. **Tokens** (`src/runs.ts`). The paragraph's text nodes in order become pieces (text between break
   opportunities), spaces (a collapsible whitespace run, kept as the (node, offset) of its first
   character) and dash breaks (just after `-`, `–`, `—` inside a word). Text inside `code`, `kbd` and
   inline math has no break opportunity: a code span is never broken, not even at its hyphens, because a
   hyphen that may belong to a filename must never end a line. A non-breaking space (the render's
   widont) is not a space.
2. **Measure** (`src/measure.ts`), in the paragraph's native layout, as **positions**: a token's width
   is the distance from its first character's left edge to the next token's, on the same native line.
   WebKit snaps a Range's rectangles to whole pixels, so summing per-word widths overstated a line by
   ~35 px (5% more lines); left-edge differences telescope and are right to a pixel. A piece whose next
   token is on the next native line ends at its last character's right edge. A piece the engine broke
   inside (a code span at its hyphen) is the sum of its per-text-node fragments; a range over an element
   also returns the element's box, so fragments are read one text node at a time. A space at a native
   line end takes its font's width from a space measured elsewhere.
3. **Break** (`src/ragged.ts`): total-fit, ragged-right with a per-line right-skip of 2 em
   (`\RaggedRight`). Line cost `(10 + badness)²`, badness `100·(shortfall / 2em)³`, penalty 50 after a
   dash, 3000 extra for two dash-ended lines in a row, last line free. justif/core over MARXY-19's
   per-space stream is the `engine: 'justif'` option, kept for comparison and for justified setting:
   it made technical text worse than the engine (ADR-0007 Amendment 1, RESEARCH.md "Rendered").
4. **Apply** (`src/apply.ts`): for each break, split the text node just after the space (or dash) and
   insert an empty `<span class="marxy-lb">`, whose `::before` is a generated newline
   (`content: '\A'; white-space: pre`, base.css); the paragraph gets `.marxy-set` (`nowrap`). Generated
   content is not text, so selection, copy, `window.find` and `textContent` see exactly the characters
   they saw before. A `<br>`, as first designed, would put a newline into every copied line.
5. **Verify.** Any glyph more than 0.5 px past the content edge: the paragraph is reverted and set once
   more on a measure short by the overrun (positions are good to a pixel, so a line filled to the edge
   can overrun by one); if that fails too, it is left to the engine and counted. Overfull lines are
   never shown.
6. **Revert** removes the spans and the class and calls `normalize()`; attach-then-destroy leaves
   `innerHTML` byte-identical (tested).
7. **Hang** (D-A6) is MARXY-24.

Left to the engine and counted: paragraphs containing `img`, a hard `br`, math or a non-checkbox
`input`; `white-space: pre*`; right-to-left direction; more than 20 % CJK. A task item's checkbox is
settable: it hangs in the margin with no net advance.

## Hyphenation

`justif/hyphenate/en-us` and `en-gb` only (allow-list `scripts/allowlists/hyphenation-patterns.json`);
chosen by the nearest `lang`; no pattern → no hyphenation. Minimum word length 6, at least 3
letters on each side (justif defaults). Never hyphenate inside `code`, URLs, or words containing
digits. The research measured with hyphenation off; MARXY-23's rag numbers are recorded twice,
off and on, and the on setting ships if it does not increase short lines.

## Scheduling (§00 targets)

- First pass: paragraphs within two screens of the top, synchronously, after `first_text`; the app
  marks `typeset_viewport`. Measured on the corpus: 24 ms at most (15-prose-volume), budget 100 ms.
- Remainder: nearest to the viewport first, batches of up to 8 paragraphs while the chunk has budget
  (8 ms), via `requestIdleCallback` or a `setTimeout(0)` fallback (`scheduler.ts`; WebKitGTK has none).
- An IntersectionObserver with a 200 % margin sets an unset paragraph immediately when scrolled near.
- `relayout(reason)` reverts everything and runs again; the app calls it on a width change (debounced
  100 ms). Fonts are ready before `attach`, so no `fonts` relayout is needed at startup.
- After every pass the app re-runs `snapToGrid` and rebuilds the reading-position blocks (`onPass`).

## Grid (D-A7)

Text blocks satisfy the grid by CSS construction (§05). The unit is half the line box (ADR-0030).
`snapToGrid(article, lineBox)` (`src/grid.ts`) handles the rest in two measured steps, three
layouts in all: (1) each `pre`, block `img`, `table` and `.marxy-math` anywhere has its height
padded (`padding-bottom`) to a whole number of units, because its margins already are; (2) the
article's block children are read in order, and any whose top is off the grid pushes the block
before it down by the difference (the article's own `padding-top` when there is none). Summing
`marginTop + height + marginBottom` per child, as first designed, is wrong wherever margins
collapse and pads headings whose margins already close their remainder. The elements a run padded
are remembered per article (a `WeakMap`) and undone before the next run. Runs after render, after `document.fonts.ready`,
on a width change (debounced 100 ms), and after each typeset pass and image or KaTeX load.

## Kill switch and diagnostics

`--marxy-typeset: none` (a token) or config `typeset = false` disables everything except the
grid pass. `MARXY_DEBUG=1` adds outline colours per state (set, fallback, native) via a
`data-marxy-typeset` attribute the theme may style.

## Tests (`packages/typeset/src/*.test.ts`, Playwright for the DOM parts)

| Case | Expect |
| --- | --- |
| items from `01-long-technical.md` paragraph 3 | box/glue/penalty counts match the research harness for the same text |
| breaks applied then reverted | `article.innerHTML` identical to before `attach` (`test/typeset.test.mjs`) |
| relayout | the same breaks again; no state accumulates |
| forced overflow (measure = 10 ch) | paragraph counted as fallback, no `<br>` left inside it |
| find-in-page across a hyphenated break | `window.find` / Custom Highlight matches the word |
| selection across a break | `Selection.toString()` contains no newline, no U+00AD, a single space; `textContent` unchanged |
| hanging quote | first grapheme's rect `left` < paragraph content `left` by ≥ 40 % of its advance |
| grid | every block's `top mod lineBox` ≤ 0.5 px over the corpus at three widths |
| budget | viewport pass on `01-long-technical.md` < 100 ms in Playwright WebKit on the reference machine; CI uses the envelope tier |
| rag | CV and short lines below the engine's own wrapping over 01, 14 and 15, same line count (±2) |
| breaker | never worse than first-fit on its own objective over 200 random paragraphs, better on > 50 (`src/ragged.test.ts`) |
