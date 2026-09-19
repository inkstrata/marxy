# 05 — Theme: base stylesheet, tokens, loader, variants, weight offset

`packages/theme`. The contract (`src/tokens.css`) is frozen (ADR-0008). This document specifies
the **base stylesheet** that turns tokens into a page that satisfies the design language by
construction, the **loader** for user themes, **variants**, and the **Linux weight offset**.

## Files

```
packages/theme/src/tokens.css      the contract (frozen)
packages/theme/src/base.css        system-owned layout and rhythm; derives every distance from tokens
packages/theme/src/loader.ts       loadTheme(), applyVariant(), watch hook
packages/theme/default/theme.toml  + theme.css (light values = token defaults; dark overrides)
```

The app inlines `tokens.css` + `base.css` + the default `theme.css` into `index.html` at build
time (startup path, §00). A user theme is injected after them as `<style id="marxy-theme">`.

## base.css — the rules, with the formulas

The file is `packages/theme/src/base.css` (MARXY-20); read it rather than a copy here. All
lengths derive from tokens; no margin or padding is a bare `px` value (the lint checks). `mod()`,
`round()` and `pow()` are CSS functions (WebKit 15.4+, WebKitGTK 2.36+). `--lb` is the line box,
`--marxy-half` half of it, and the grid unit is `--marxy-half` (ADR-0030).

| Rule | Formula | At 17 / 28 |
| --- | --- | --- |
| Article | `max-width: clamp(45ch, measure, 90ch)`, padding `3lb 3rem 5lb` | 68 ch ≈ 670 px |
| Role sizes | `--marxy-size-hN = round(body × ratio^k, 1px)`, k = 3, 2, 1 | 33, 27, 21 |
| Heading line box | `min(max(token, round(up, 1.2 × size, 2px)), 2lb)` | 40, 34 |
| h1, h2 margin | `2lb` above; below `half + mod(−(lh + 2lb), half)` | h2 56 / 34 / 22 |
| h3 … h6 | one line box, `lb` above, `half` below | 28 / 14 |
| p, lists, quotes, tables | `margin: 0 0 half` | 14 between |
| Lists | top-level markers hang in the margin; nested lists indent `1.25em`; markers secondary colour | |
| Task items | the checkbox hangs where the bullet would be; no bullet | |
| Code block | `lb` above and below, `half` padding, code line box token, padded to the unit by `snapToGrid` | 28 / 14 / 22 |
| Code wrap | `white-space: pre-wrap; text-indent: 2ch hanging each-line` | |
| Inline code, kbd | mono at `0.875em`, **no box**, `line-height: 1` so its line never grows | |
| Table | block, rows one line box, rules as inset shadows (no height), text `0.88 × body`, tabular figures | 15 / 28 |
| hr | one line box of space with a centred `* * *` in the secondary colour, `half` around it; not set directly before an h1 or h2 | |
| Footnotes | body size, secondary colour, after a short quarter-width rule; `sup`/`sub` `line-height: 0` | |
| Weight | `--marxy-wght = token + offset` drives `font-weight` **and** `font-variation-settings: 'wght'` on every descendant | 380 / 600 / 700 |

Departures from the first version of this section, each forced by a measurement:

- **Paragraph spacing vs the grid.** Half a line between paragraphs put every second paragraph
  off a whole-line grid. ADR-0030 makes the unit half a line.
- **`text-indent: -2ch` on `pre`** indents only the first line of the whole block, not each source
  line, and pushes every other line 2 ch in. `text-indent: 2ch hanging each-line` is the property
  that means "hang every wrapped continuation" (WebKit; tested in `grid.test.mjs`).
- **`font-variation-settings` on the article alone** is inherited and overrides `font-weight` on
  `strong` and headings, which would set them at body weight. The axis value is carried in `--marxy-wght`,
  which each weighted element resets.
- **Inline code at the body's line height** grows its line by about a pixel (a mono face's ascent),
  which a long document turns into drift; hence `line-height: 1`.
- **Table rules as borders** add a pixel a row; inset shadows do not.
- **Heading line boxes as fixed px tokens** fall below the heading's size when a reader enlarges
  the type (at 24 px an h2 is 38 px on a 34 px box, 2 px above its paragraph); the formula above
  grows them.

Role tokens the base needs beyond the contract's list are **derived** in `base.css`, not added
to the contract. Constraint 4 by construction: `h1..h6 { color: inherit; border: 0; }` in base,
and the theme lint forbids any heading rule setting a colour or a border.

## Loader (`loader.ts`)

```ts
export interface ThemeManifest { name: string; author?: string; contract: 1; variants: ('light' | 'dark')[] }
export async function loadTheme(read: (rel: string) => Promise<Uint8Array>, assetUrl: (rel: string) => string): Promise<{ manifest: ThemeManifest; css: string; warnings: string[] }>
export function applyTheme(css: string): void;             // replaces #marxy-theme
export function applyVariant(v: 'light' | 'dark'): void;    // sets html[data-marxy-variant]
```

1. `theme.toml` parsed with `smol-toml`; missing or wrong `contract` → warning "theme targets
   contract N; marxy speaks 1" and the theme still loads (nothing worse than mis-styling can
   happen: the CSP blocks everything else).
2. `theme.css` is text; every `url(...)` is rewritten: relative → `assetUrl(themeDir/rel)`,
   absolute `http(s)://`/`//` → removed and a warning recorded ("theme referenced
   `https://…`; not loaded"). `@import` is removed the same way.
3. Values are clamped where the contract says: `--marxy-measure` to `45ch–90ch`,
   `--marxy-line-box` to `20px–48px`, `--marxy-size-body` to `13px–24px`. Clamping is done by
   reading the injected computed values once and, if out of range, injecting a following rule
   with the clamped value and a warning.
4. Variants: `config.variant = auto` follows `prefers-color-scheme`; `light`/`dark` fixed.
   A theme that declares only `light` is used for both (dark falls back to the default theme's
   dark values, not to an inversion).
5. Hot reload: the app watches the theme directory (§08 mechanism); on change, `loadTheme` again
   and `typeset.relayout('theme')`. A theme opened *as a document* opens in Source mode (§09).

### App side (MARXY-47, `apps/desktop/src/theme/`)

```ts
// apps/desktop/src/theme/user-theme.ts
export async function startUserTheme(ctx: AppContext, dir: string | null): Promise<{ stop(): void }>
```

1. `dir` comes from config `theme` (§11), `~` expanded against the home directory the shell
   reports in `configPaths()`'s parent; relative paths resolve against the config directory.
   `null` → default theme only, nothing watched.
2. `await shell.allowAssetScope(dir)` so `@font-face` and image `url()`s rewritten to
   `assetUrl(dir/rel)` load. The scope is the theme directory only; a `url(../x)` that escapes
   it is removed with a warning, exactly like a network URL.
3. `loadTheme(rel => shell.readFile(join(dir, rel)), rel => shell.assetUrl(join(dir, rel)))`,
   then `applyTheme(css)` and one notice listing `warnings` (at most three shown, "and N more").
   A missing `theme.toml` or `theme.css` → notice "Theme at ~/themes/quiet could not be read:
   theme.css not found." and the default theme stays.
4. Never on the startup path: the default theme is inlined (§00); the user theme is applied
   after `first_text`, during idle, followed by `typeset.relayout('theme')` with position kept
   (§08). The one-frame restyle is accepted; a user who sets a theme sees their theme settle
   in once per launch. (Inlining a user theme at build time is impossible; reading it before
   first text would put two IPC reads on the critical path.)
5. `shell.watch(dir)` → on any event under `dir`, reload (steps 3–4), debounced 100 ms.
6. **Opening a theme as a document.** When the opened path is `theme.css` or `theme.toml` in
   a directory containing both, it opens in Source mode (per-file-type default already sends
   `.css`/`.toml` there) with a notice: "This is a marxy theme." [Use this theme] [Dismiss].
   *Use this theme* writes `theme = "<dir>"` to `config.toml` by the same one-line edit that
   writes `size` (§11) and calls `startUserTheme` with it. Saving the open `theme.css` then
   hot-reloads it through step 5 — editing a theme in marxy's own Source mode is a live preview.

Contract version: `contract` absent or ≠ 1 → warning "Theme 'quiet' targets contract 2;
marxy speaks 1. It may not look as intended." The theme still applies.

## Weight offset (D-A9)

`--marxy-weight-offset` is set on `:root` by the app at startup, never by a theme:

| platform | WebKitGTK | offset |
| --- | --- | --- |
| macOS, Windows | — | 0 |
| Linux | ≥ 2.52 | 75 |
| Linux | 2.50–2.51 | 125 |
| Linux | other | 100 |

from `shell.webkitVersion()` (§06), overridden by config `[linux] weight_offset` (§11). Until
`webkitVersion` exists (it is part of the shell-api amendment, MARXY-94, which waits on Ian), the
app passes no version and Linux takes the **other** row, 100 (MARXY-21, `apps/desktop/src/theme/offset.ts`).
MARXY-22 measures these on real desktops and replaces the table's values. Every `font-weight`
in `base.css` is `calc(<token> + var(--marxy-weight-offset))`, and the variable axis is driven
through `font-variation-settings 'wght'` as well, because WebKitGTK maps `font-weight` to the
axis but rounds; the explicit axis value is exact.

## Palettes (ADR-0024: dark is primary, light is designed second)

Values are the token defaults (`tokens.css`, dark) and the light block in the default theme.
Ratios are WCAG contrast, computed and checked by the aesthetics gate (§10 check 3). Nothing
below is an inversion of anything else; each value was chosen on its own ground.

| Token | Dark (primary) | ratio on bg | Light | ratio on bg |
| --- | --- | --- | --- | --- |
| `--marxy-color-bg` | `#151412` warm near-black | — | `#faf8f4` warm paper | — |
| `--marxy-color-text` | `#e8e4dc` | **14.5** | `#1c1b19` | **16.2** |
| `--marxy-color-text-secondary` | `#a39e94` | 6.9 | `#5e5a53` | 6.5 |
| `--marxy-color-accent` / `-link` | `#8fb4dd` | 8.5 | `#2c5f8a` | 6.4 |
| `--marxy-color-rule` | `#2a2825` | — | `#e4e0d8` | — |
| `--marxy-color-code-bg` | `#1d1c19` | — | `#f1eee8` | — |
| `--marxy-color-code-text` | `#e3dfd6` | 12.8 (on code bg) | `#1c1b19` | 14.9 (on code bg) |
| `--marxy-color-quote-rule` | `#3a3833` | — | `#d6d1c8` | — |
| `--marxy-color-selection` | `#2a4a6e` | text on it 7.2 | `#cfe3ff` | text on it 13.2 |
| `--marxy-color-find` | `#4a3d12` | text on it 8.4 | `#fbe9a6` | 14.2 |
| `--marxy-color-find-current` | `#7a6218` | text on it 4.6 | `#f3c94d` | 10.9 |
| `--marxy-color-notice` | `#1f1e1b` | — | `#f1eee8` | — |
| `--marxy-weight-body` | 380 | | 400 | |

Code tokens (ratio on the variant's code background; all ≥ 4.6):

| Token | Dark | Light |
| --- | --- | --- |
| keyword | `#c9a0dc` 7.8 | `#6f42a8` 6.0 |
| string | `#a8c48a` 8.9 | `#3f6e2a` 5.2 |
| comment | `#8a857b` 4.6 | `#6a655d` 5.0 |
| number, constant | `#d9a066` 7.4 | `#8f5410` 5.3 |
| function | `#8fb4dd` 7.9 | `#2c5f8a` 5.8 |
| type, attribute | `#e0c07a` 9.7 | `#7a5c10` 5.4 |
| variable | `#e3dfd6` 12.8 | `#1c1b19` 14.9 |
| operator | `#b5b0a6` 7.9 | `#4a4640` 8.1 |
| punctuation | `#8f8a80` 5.0 | `#6a655d` 5.0 |
| tag | `#e28c7a` 6.7 | `#a1412f` 5.5 |

Rules that follow: `html[data-marxy-variant]` is set by the app before first paint from config
(`dark` default, `auto` follows `prefers-color-scheme`, `light` fixed); the window background and
the empty state are `#151412` so a white frame never appears; `color-scheme: dark light` is
declared on `:root` so form controls and scrollbars follow the variant. Themes that declare
only one variant are used for both with the default theme's other block filling the gaps.

## Tests

- `packages/theme/scripts/lint-default-theme.mjs`: headings set no colour or border (in the theme
  and in base); every `margin`/`padding` in `base.css` is an expression of tokens, never a bare `px`.
- `packages/theme/test/grid.test.mjs` (Playwright WebKit): the text-only fixtures sit on the grid
  **without** `snapToGrid` (the CSS construction alone holds); every corpus file sits on it after
  the grid pass at 720/960/1280 and at 14/17/21/24 px; measure, contrast in both variants, the h2
  numbers, heading space below at every size, and the code block's hanging indent.
- Loader: a theme with `url(https://x)` yields the warning and a CSS string without it; a
  manifest with `contract = 2` loads with a warning; clamping works on an out-of-range measure.
