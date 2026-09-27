---
key: MARXY-276
design: [10-gates-and-testing, 05-theme]
depends: []
verify: [pnpm precheck, pnpm done MARXY-276]
---
# MARXY-276 — Do not contrast-check diff tints until the light theme declares them

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · [05-theme](../../design/05-theme.md) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) clause 6 (the four tokens; the contract pull request touches `tokens.css` only) · **Delta:** [2026-09-27-unblock](../deltas/2026-09-27-unblock.md) · **Depends on:** nothing. **Unblocks:** MARXY-232. MARXY-235 is what turns the light walk back on, by declaring the tokens.

**Outcome.** Adding the four diff colour tokens to the contract no longer fails the aesthetics gate on the light page, which still has no light values for them. The dark page is still checked.

## What is wrong today
`scripts/gate-aesthetics.mjs` `declaredTintBackgrounds` adds every `--marxy-color-diff-*` name it finds in `tokens.css`, `theme.css` or `base.css` to the text-on-tint walk, against every foreground, at 4.5:1, in both variants (MARXY-241). ADR-0036 puts the dark hexes in `tokens.css` and the light hexes in `packages/theme/default/theme.css`, and those files belong to two stories. MARXY-232 owns only the contract file. Landing the dark hexes makes the light variant compute the dark colours, and the walk fails hundreds of pairs. MARXY-235, which owns the light values, already depends on MARXY-232, so it cannot land first.

## Files and signatures
- `scripts/diff-tint-pairs.mjs` — pure. `diffPairVariants(name, themeCss)` returns `['dark', 'light']` when `name` is declared inside the `:root[data-marxy-variant="light"]` block of `themeCss`, and `['dark']` otherwise. A declaration outside that block does not count.
- `scripts/gate-aesthetics.mjs` — a `--marxy-color-diff-*` tint rule is included for a variant only when `diffPairVariants` says so. Every other tint background stays on both variants. The caller already knows the variant (`dark` or `light`); pass it into the pair walk.
- `scripts/diff-tint-pairs.test.mjs` — node:test, no browser.

## Do this, in order
1. The pure function and its test.
2. Call it from the gate. Do not change the floor (4.5:1, or 7:1 for body and code) and do not drop a non-diff tint.

## Tests → expected
| Check | Expect |
| --- | --- |
| `diffPairVariants('--marxy-color-diff-add', themeCss)` when the light block does not declare it | `['dark']` |
| the same name declared inside the light block | `['dark', 'light']` |
| the same name declared only outside the light block | `['dark']` |
| a non-diff tint the gate already walks, such as `--marxy-color-bg` | still paired in both variants |
| `pnpm gate:aesthetics` on this branch | exits 0 (main has no diff tokens yet, so the walk is unchanged) |

## Acceptance → check
The CSV row's criteria are the table rows, plus `node --test scripts/diff-tint-pairs.test.mjs` green.

## Do not
- Add the four tokens, or any hex, to `tokens.css` or `theme.css`. MARXY-232 and MARXY-235 do that.
- Skip the dark walk. A dark hex under 4.5:1 has to fail MARXY-232, which can edit `tokens.css`.
- Exempt a token forever. Once the light block declares it, both variants are walked again.
