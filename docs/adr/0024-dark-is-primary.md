# ADR-0024 — Dark is the primary variant; light is designed second

**Status:** accepted 2026-09-18 (Ian) · **Amends:** ADR-0008 (token defaults), ADR-0015 (weights), `docs/design-language.md`

## Decision

1. The **dark variant is primary**: it is the default on every platform (`variant = "dark"` in
   config; `auto` and `light` are opt-in), it is what the token contract's `:root` defaults
   describe, it is what the first paint shows (window background and empty state), it is the
   first row of every screenshot baseline and the variant every taste review is conducted on.
2. **Light is designed, not inverted**: its own background (warm paper, not white), its own
   body weight (400 against dark's 380), its own token colours chosen for contrast on a light
   code background. It lives in the default theme's `:root[data-marxy-variant="light"]` block.
3. The palettes and their measured contrast ratios are fixed in `docs/design/05-theme.md`
   §Palettes and are the values in `packages/theme/src/tokens.css` and
   `packages/theme/default/theme.css`. Body text ≥ 7:1, secondary ≥ 4.5:1, every code token
   ≥ 4.5:1 on the code background, in both variants; the aesthetics gate checks both.
4. The token contract gains, within version 1, a small additive set with defaults — find
   highlight, notice, and the twelve `--marxy-tok-*` colours — so themes that predate them
   render correctly. Additive tokens with defaults do not bump the contract version.

## Why

Ian's call, made early so nothing is designed twice: a reader used at length is used in the
evening; the serif at 17 px needs its weight and contrast chosen for a dark ground, and doing
that after light would mean re-tuning every specimen, baseline and review. Deciding it now
costs one file of values.

## Consequences

- `tokens.css` `:root` values change (dark); the *names* do not, except the additive set.
  ADR-0008's rule "themes set tokens, Marxy derives distances" is untouched.
- Window `backgroundColor` and the inline empty-state styles are dark so there is never a
  white flash before the theme applies.
- Taste review #0 is re-rendered on dark before the typeface decision (MARXY-76); MARXY-46
  becomes "light designed, not inverted".
- Screenshot baselines, the aesthetics matrix and the specimen scripts list dark first.
