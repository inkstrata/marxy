# Taste review — 2026-09-19

Recorded with the author. Review #0 (typeface) is in `../2026-09-review-0/decisions.md`.

## MARXY-20 — first styled page

- **Dark 01-long-technical:** reads as **markdown**, not a book.
- **Dark 09-gfm-everything:** heading vertical spacing seems strange. Italics and strike are weak.
- **Dark 15-prose-volume:** looks nice on the surface; a bit of a clumsy read. Dense, maybe.
- **Dark 02-readme-real-world:** looks nice; still **markdown**. Code-block left spacing maybe small; negative space in the box feels untuned. Quote block maybe too subtle. Heading vertical spacing ticks out again.
- **Dark 03-ai-plan:** **book, maybe in a bad way.** Checklist checks aligned bottom, sub-bullet circles aligned top; checkbox feel wrong overall, but checked states liked. Maybe too small; subtlety also liked. Table line-wrap spacing bigger than the dense cell padding — wrong; table looks scuffed.
- **Light 03-ai-plan:** same issues.

**Verdict:** not a book yet. Nice on the surface; clumsy/dense to read. Heading space, weak italic/strike, code-block padding, subtle quotes, checkbox alignment, scuffed tables. Same in light. Theme follow-ups: MARXY-128. Pair-A tunes: MARXY-129.

## MARXY-23 — Knuth–Plass rag

- **Prose:** prefer after (typeset). Difference is subtle.
- **Plan:** wash.
- **Code spans:** lean **no break** (path stays one token). Defer to how incumbents wrap; breaking at `/` may cause technical issues. Decision stays open.

## MARXY-29 — smart typography

- **Book, all good.** Quotes, dashes, ellipsis, widont. Nothing that should have been left alone.

## MARXY-64 — prose-volume fixture

- **Fine** as the volume later typesetting stories should measure.
- Follow-up: a **sample generation pass for different formats**, not only continuous prose
  (MARXY-130).

## MARXY-73 — hostile corpus

- **Fine.** New labelled sections stay inventory. No family to pull from the reader-facing corpus.

## MARXY-75 — silent source-map attributes

- **None.** `data-marxy-s` / `-e` are invisible. Pass.

## Deferred — need a Linux desktop

- Spike: WebKitGTK vs macOS weight ( +50 / +75 ).
- MARXY-21: does +100 on Linux read like macOS or heavier?
