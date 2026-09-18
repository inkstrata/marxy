# MARXY-20 — Default theme as a theme: tokens, grid-derived spacing, type scale, light

**Design:** [05-theme](../../design/05-theme.md) (base.css, formulas), [04-typeset](../../design/04-typeset.md) §Grid · **Depends on:** MARXY-61, MARXY-75.

## Outcome
A rendered README sits on a 28 px grid at a 68 ch measure with the type scale, using system fonts for now (fonts are MARXY-21). Every vertical distance derives from tokens.

## Do this, in order
1. `packages/theme/src/base.css`: the rules in §05 verbatim, including the `mod()` heading margins and the derived role tokens block. No bare `px` margins or paddings (the lint checks).
2. `packages/theme/default/theme.css`: keep the token defaults; add the `:root` block setting `--marxy-lh-h1: 40px; --marxy-lh-h2: 34px`.
3. `packages/theme/src/loader.ts`: `applyTheme(css)`, `applyVariant(v)` only (the TOML loader is MARXY-47). `packages/theme/src/index.ts` exports them.
4. `apps/desktop/index.html`: inline `tokens.css` + `base.css` + default `theme.css` at build time (a Vite plugin in `vite.config.ts` that reads the three files and injects a `<style>`; keep the Phase-0 inline styles only for the empty state).
5. `packages/typeset/src/grid.ts`: `snapToGrid(article, lineBox)` as in §04; `packages/typeset/src/index.ts` exports it. The app calls it after render (no typesetter yet).
6. Playwright test `packages/theme/test/grid.test.mjs` using a static page (no shell): the headless entry is MARXY-25, so for now render the corpus with `renderDocumentSafeHtml` in Node, write HTML files to a temp dir with the three stylesheets inlined, and run the §10 grid and measure checks at 720/960/1280 and 14/17/21/24 px.

## Tests
| Test | Expect |
| --- | --- |
| theme lint (exists + new bare-px rule) | pass |
| grid check, text-only fixtures (`01`, `14`) without `snapToGrid` | every block top on grid ± 0.5 px |
| grid check, all fixtures with `snapToGrid` | same |
| measure check | 60–75 ch at all four sizes |
| `h2` margin-bottom computed | 22 px at lh 34 / lb 28 |

## Do not
Bundle fonts (MARXY-21). Add colour to headings. Introduce any margin as a number.
