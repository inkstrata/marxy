---
key: MARXY-311
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-311]
---
# MARXY-311 — Fix check-cards.mjs's Files-and-signatures regex so it works when that section is last

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-4](../deltas/2026-09-28-bugcatch-4.md) · **Depends on:** nothing.

**Outcome.** `check-cards.mjs`'s path-boundary check actually inspects a task card's `## Files and signatures` bullets even when that section is the card's last one — the common case — instead of silently seeing none.

## Why
`filePathsFromCard`'s regex `/^## Files and signatures\r?\n([\s\S]*?)(?=^## |\Z)/m` uses `\Z`, which in a non-`u` JS regex is a literal `IdentityEscape` for the character `Z`, not an end-of-string anchor. The lookahead only succeeds at a following `## ` heading or a literal `Z`, so when the section is last (no trailing heading), the whole match fails and the function returns `[]`. Since `cardsAndRows` loops `card.files` to flag a file outside the story's CSV `Paths`, every such card's path-boundary check is currently a silent no-op.

## Files and signatures
- `scripts/check-cards.mjs`: fix `filePathsFromCard`'s regex (or switch to a plain string scan) to correctly capture the section whether or not another `## ` heading follows it.

## Tests → expected
| Check | Expect |
| --- | --- |
| A card body ending in `## Files and signatures` with no trailing heading | files are extracted (not `[]`) |
| A fixture card (last section, path outside its row's `Paths`) | `check-cards` now flags it (did not before the fix) |
| `pnpm precheck` (including `check-cards.mjs` against the real `docs/plan/tasks/` tree) | green — the fix may surface pre-existing drift in real cards; note it separately if so, don't silently paper over it |

## Acceptance → check
Row acceptance 1–5, checked as listed in the CSV row's acceptance text.

## Do not
- Rewrite the whole card-parsing approach — a targeted regex/scan fix is enough.
