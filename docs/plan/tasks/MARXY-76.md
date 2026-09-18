# MARXY-76 — Re-render taste review #0 in the dark variant

**Design:** [05-theme](../../design/05-theme.md) §Palettes, ADR-0024 · **Depends on:** nothing (the specimen script exists from MARXY-17).

## Outcome
`docs/taste-review/review-0/` holds both typeface pairs in dark and light, dark listed first; the decision is taken on dark.

## Do this
1. `scripts/specimen/specimen.mjs`: read colours from `packages/theme/src/tokens.css` and the light block of `packages/theme/default/theme.css` (parse the custom properties; no hard-coded hex anywhere in the script — a test greps for `#[0-9a-f]{6}` in `scripts/specimen/*.mjs` and expects none outside the tokens parser).
2. Render each page for each pair in `dark` and `light`; file names `<page>-<variant>-<dpr>.png`; `manifest.json` lists variants `["dark", "light"]`.
3. Update the review-0 README's decision line: "decide on dark; confirm light does not change the choice".
4. Queue entry updated.

## Acceptance → check
File set complete (a test lists expected names); manifest order; grep test; the network control still observed.
