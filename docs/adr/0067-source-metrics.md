# ADR-0067 — Source has its own metrics: a tighter type on a 1.5 line, an exact gutter, code that scrolls

- **Status:** proposed (V-12)
- **Date:** 2026-10-11
- **Amends:** ADR-0030 (the grid unit is half a line box: Source is the one surface that leaves it, by reason) and
  ADR-0031 (the contract gains the two names below; names and kinds, never values). Builds on ADR-0024 (an added
  token carries a default), ADR-0033 §5 (Rendered's code blocks keep their wrap with a hang and a rule), ADR-0011
  (nothing at rest) and ADR-0048 (the block editor is an island inside Rendered).
- **Evidence:** [`docs/plan/direction-2026-10/13-code-view.md`](../plan/direction-2026-10/13-code-view.md) §3 and
  V-12; the author's rulings of 2026-10-11, K-R1 (a) and K-R3 (a);
  [`06-code.md`](../research/reader-typography/06-code.md), "Size and the monospace quirk", "Line length, tabs and line
  height" and "Wrap or scroll?"; [`04-code-typography.md`](../research/reader-artifacts/04-code-typography.md),
  "Leading".

## Context

Source wore Rendered's code metrics: 18 px type on a 30 px line (1.667), 60 px of padding each side, and
CodeMirror's own 3 px and 5 px gutter padding, which outranked Marxy's. Measured in the installed app's engine, only
about 25 lines fit in an 800 px window, the numbers sat 60 px from the text, and a line over the width wrapped to
column 0 with one number, so wrapped Python read as dedented Python.

The research does not ask for those metrics in an editor. Code leading is **1.5 to 1.6** (`06-code.md`). The
artifacts chapter keeps 30 px only so a code block stays on the prose grid, graded **[D]**; a code file in Source has
no prose to share a grid with, so that argument does not reach it. Neither handbook sets an editor size; the cited
incumbent, GitHub, sets code at 13 px on 1.5. And `06-code.md` says code scrolls by default and is never silently
wrapped where indentation means something.

## Decision

1. **Two tokens, derived from the reader's text size.** `--marxy-size-source` (a length) and
   `--marxy-line-box-source` (a length). At the default text size they are **14 px and 21 px** (the ruled ratio, 0.7
   of the body and 1.5 of that); at any other size the app sets them with the other size properties, to the half pixel
   and to the whole pixel (`sourceSizeFor`, `sourceLineBoxFor`: 11 on 17 at 16, 18 on 27 at 26). Both carry a default
   in `tokens.css`, so a theme that sets neither is unharmed (ADR-0024). The values are taste and a theme may set them;
   the names and kinds are the contract.
2. **Source leaves the prose grid, and says why.** A line box of 21 px is not a multiple of the grid unit (15 px).
   Source holds no prose, so there is no baseline to keep with a neighbour. Rendered's code blocks, which sit in prose,
   keep `--marxy-size-code` on `--marxy-line-box-code` (18 on 30) and ADR-0033 §5. The in-place block editor
   (ADR-0048) is an island in Rendered's page and keeps Rendered's metrics too.
3. **An exact gutter.** The numbers are right-aligned, tabular, in the secondary colour (already held at 4.5:1 on the
   page ground by the contrast gate), and hung left of the text with a padding of half a Source line box each side. One
   rule outranks CodeMirror's base gutter theme. The gutter reserves a fixed width (a fold column of one line box, five
   digits, half a line box each side), so turning numbers on or off, or a file of 10 000 lines, never moves the text.
4. **Wrapping follows the kind of file.** A code file does not wrap: it scrolls sideways inside the editor, and its
   gutter stays at the left edge. Markdown and the text family wrap, and a continuation row hangs two columns past its
   line's own indent (the rule `base.css` keeps for `pre`). A file past the large-file threshold never wraps.
5. **One line box a row.** Every row is exactly one Source line box, including rows drawn in a fallback face; the
   runs inside a line carry the same line height.
6. **The column and the ground.** Markdown is as wide as Rendered's measure (`--marxy-measure-chars`, clamped to 45
   to 80, times the average advance, times the body size); a code file's column is 100 characters of the mono face at
   Source's size. Both are centred on the window and sit on the page ground (`--marxy-color-bg`), not the code ground.
7. **Weight.** Source takes the article's weight (`--marxy-weight-body` plus the platform offset), so the dark ground's
   lighter body weight reaches it.
8. **Nothing at rest.** The active line is tinted only while the editor holds the caret. A fold chevron shows while the
   pointer is over the gutter; a folded line's marker always shows, because it marks hidden text.

## Alternatives

- **15 px on 23 px (K-R1 b).** Within the handbook's range and a little more generous. Not chosen: the author ruled
  14 on 21. Either way the ratio scales with the reader's text size, so the choice is a constant, not a structure.
- **Keep 18 on 30 and fix only the wrap and the gutter (K-R1 c).** Not chosen: it keeps the 1.667 leading, above the
  handbook's range in both em and x-heights, and the 25-line window.
- **Everything wraps, with a hang and a rule (K-R3 b).** Not chosen: it is the handbook's explicit "never wrap
  indentation-sensitive languages silently".
- **Derive the two tokens in CSS (`calc(var(--marxy-size-body) * 0.7)`).** It would follow a size with no code, but
  gives fractional line boxes (16.8 px at 16), and rows of unequal pixel pitch. The app already sets the other size
  properties from one function, so these two go beside them.

## Consequences

- `tokens.css` and `tokens.contract.json` gain the two names; `check-tokens` holds them.
- The size command sets two more properties, and the default size sets none of them, as before.
- About 37 lines fit in an 800 px window where 25 did; at 1280 px a code file's text begins about 220 px from the edge.
- A scratch document that is later saved as code keeps its Markdown look until it is reopened.
- V-13 (ADR-0068) edits `tokens.css` after this and rests on the page ground the gutter and the text now share.
