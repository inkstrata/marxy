# @marxy/theme

Tokens and base CSS, the bundled themes, the look engine, and the parsing of `config.toml` with its
settings schema. It imports no Tauri and no Node built-ins. Themes, looks, tokens and the Studio are
described in [docs/themes-and-type.md](../../docs/themes-and-type.md).

| Path | What it is |
| --- | --- |
| `src/tokens.css`, `tokens.contract.json` | every theme token, and the contract `check-tokens` holds it to |
| `src/base.css`, `src/frame.css`, `src/left.css` | the page, the window frame (and every scrollbar) and the left panels |
| `src/looks/<id>.ts`, `src/look.ts`, `src/looks.ts` | each bundled look and the engine that resolves one to colours |
| `<theme>/theme.css`, `<theme>/theme.toml` | a bundled theme's sheet, written from its look; `default/` is the hand-written base every theme is laid over |
| `src/config.ts`, `src/settings-schema.ts`, `src/loader.ts` | `config.toml`, the settings it may hold, and loading a theme |
| `test/` | tests that read the sheets or draw them in WebKit |

## Commands

| Command | Does |
| --- | --- |
| `pnpm --filter @marxy/theme test` | the lint below, then the unit and sheet tests |
| `pnpm lint:theme` | Biome and the default theme's lint |
| `node packages/theme/scripts/write-theme-sheets.mjs` | rewrites every bundled theme's sheet after a look changes; a test fails on drift |

## Tools in `scripts/`

| Script | Is |
| --- | --- |
| `write-theme-sheets.mjs` | the sheet writer |
| `lint-default-theme.mjs` | holds the default theme and base sheet to hierarchy by size and weight and distances derived from the line box |
| `inline.mjs` | the default theme as one stylesheet, in cascade order; the app's build and every browser test take it from here |

The contrast gate and the token contract check read this package from the root
([scripts/](../../scripts/README.md)).
