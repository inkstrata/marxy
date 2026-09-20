---
key: MARXY-128
design: [05-theme]
depends: [MARXY-20, MARXY-23, MARXY-141]
verify: [node --test packages/theme/test/grid.test.mjs, node packages/theme/scripts/lint-default-theme.mjs, pnpm test]
---
# MARXY-128 — Tune the default theme against taste review #1

**Design:** [05-theme](../../design/05-theme.md) · **ADRs:** ADR-0024 (dark first), ADR-0030 (the grid unit), ADR-0014 · **Review:** [2026-09-review-1](../../taste-review/2026-09-review-1/decisions.md) · **Depends on:** MARXY-20, MARXY-23.

**Outcome.** The first styled page stops reading as markdown. Review #1's verdict was *not a book yet —
nice on the surface, clumsy and dense to read*, with six named faults; each is a rule in the system-owned
`packages/theme/src/base.css` (or a light value in `packages/theme/default/theme.css`), so no token and no
frozen file moves. Aesthetics are the differentiator and "a competent, ordinary-looking markdown viewer"
is the failure `AGENTS.md` names, which makes this the most important story on the board.

## The six faults, in the reviewer's words
1. *Heading vertical spacing seems strange / ticks out* — space belongs above (design constraint 3), so
   make the asymmetry structural.
2. *Italics and strike are weak* — Literata's real italic must resolve, never a synthetic slant.
3. *Code-block left spacing maybe small; negative space in the box feels untuned.*
4. *Quote block maybe too subtle.*
5. *Checklist checks aligned bottom, sub-bullet circles aligned top* (checked states liked).
6. *Table line-wrap spacing bigger than the dense cell padding — scuffed.* Keep the density, fix the wrap.

## Files and signatures
- `packages/theme/src/base.css` — heading margins, `em`/`i`/`del`/`s`, `pre`/`code` padding,
  `blockquote`, `input[type="checkbox"]`, `table`/`th`/`td`. Every vertical distance stays a multiple of
  `--marxy-half`; no bare px margin or padding (`lint-default-theme.mjs`).
- `packages/theme/default/theme.css` — only if a light value needs to move with a dark change; light is
  designed, never inverted (ADR-0024).
- `packages/theme/test/` — one named case per fault, each written to fail before the change.
- `packages/theme/scripts/lint-default-theme.mjs` — extend only if it cannot already see a new rule.
- `docs/taste-review/2026-09-marxy-128/` — before/after pairs, five pages × dark and light, 960 px, 2×.

## Do this, in order
1. Write the seven checks (criteria 1–7) against the theme as it is; three or four will already pass,
   the rest are red. Paste that run: it is the before evidence.
2. Fix the faults in the order above, keeping the grid test green after each.
3. Re-render the same five corpus pages MARXY-20 used, same widths and scale, into the artifact
   directory; name each file `before-`/`after-`.
4. Add one queue row in `docs/taste-review/queue.md` naming all six faults and what changed for each,
   and the question: does it read as a book now?
5. `pnpm test`, `pnpm precheck`, `pnpm done MARXY-128`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `packages/theme/test/grid.test.mjs` | green after every change |
| `lint-default-theme.mjs` | green; no bare px |
| the seven named cases | each red before its fix, green after |
| `pnpm test:contracts-frozen` | green — `tokens.css` is not in the diff |

## Acceptance → check
The nine criteria on the CSV row.

## Do not
Touch `packages/theme/src/tokens.css`, add or rename a token, change `--marxy-measure` or the type
scale, or swap a face — the size and weight tunes are MARXY-129 and they wait on ADR-0031. Typeset
anything (that is `packages/typeset`). Invert dark to make light. Regenerate a screenshot baseline
under `fixtures/baselines/` without a queue row.
