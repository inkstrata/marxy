---
key: MARXY-46
design: [05-theme]
depends: [MARXY-20, MARXY-30]
verify: [pnpm precheck, pnpm done MARXY-46]
---
# MARXY-46 — Light variant designed, not inverted (dark is primary)

**Design:** [05-theme](../../design/05-theme.md) §Palettes, ADR-0024 · **Depends on:** MARXY-20, MARXY-30.

## Outcome
The light variant renders from its own palette (already in `packages/theme/default/theme.css`) with baselines committed; nothing about it is derived from dark.

## Do this
1. Verify the light block in `theme.css` matches §Palettes exactly (a test reads the CSS and the table's values from a JSON fixture you add at `packages/theme/test/palettes.json`).
2. Add a test asserting no light token equals the 255-complement of its dark counterpart.
3. Run `scripts/gate-aesthetics.mjs --update --variant light` for the baselines; queue entry.
4. `config.variant = "light"` and `"auto"` paths exercised in a Playwright test on the headless entry (`prefers-color-scheme` emulation for `auto`).

## Acceptance → check
| Criterion | Checked by |
| --- | --- |
| §Palettes contrast ratios (light and dark) | `packages/theme/test/grid.test.mjs`; `gate:aesthetics` |
| Light palette fixture match | `packages/theme/test/palettes.test.mjs` |
| No 255-complement inversion | `packages/theme/test/palettes.test.mjs` |
| Screenshot baselines for light | `packages/theme/test/palettes.test.mjs`; `gate:aesthetics` |
| Headless `light` and `auto` (`prefers-color-scheme`) | `apps/desktop/test/variant-render.test.mjs` |
| Queue entry | `docs/taste-review/queue.md` |
