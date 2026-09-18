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

All lengths in `px` derive from tokens; nothing is hard-coded. `mod()` is the CSS function
(WebKit 15.4+, Chromium 125+, WebKitGTK 2.36+); `--lb` is shorthand for `var(--marxy-line-box)`.

```css
.marxy-article {
  max-width: var(--marxy-measure);           /* ch, so it holds at any size (constraint 1) */
  margin-inline: auto;
  padding: calc(var(--lb) * 2) 24px;
  font: var(--marxy-weight-body) var(--marxy-size-body) / var(--lb) var(--marxy-font-text);
  font-optical-sizing: auto;
  font-variation-settings: 'wght' calc(var(--marxy-weight-body) + var(--marxy-weight-offset));
  color: var(--marxy-color-text); background: var(--marxy-color-bg);
  hanging-punctuation: none;                 /* the typesetter hangs; the engine must not double it */
  text-wrap: auto;                           /* never pretty/balance on body: the typesetter owns breaks */
}
/* type scale: sizes from the ratio; line boxes per role are tokens the theme sets */
h1 { font-size: var(--marxy-size-h1); line-height: var(--marxy-lh-h1); margin: 0 0 mod(calc(-1 * var(--marxy-lh-h1)), var(--lb)); }
h2 { font-size: var(--marxy-size-h2); line-height: var(--marxy-lh-h2);
     margin: calc(var(--lb) * 2) 0 mod(calc(-1 * (var(--marxy-lh-h2) + var(--lb) * 2)), var(--lb)); }
h3 { font-size: var(--marxy-size-h3); line-height: var(--lb); margin: var(--lb) 0 0; }
h4, h5, h6 { font-size: var(--marxy-size-body); line-height: var(--lb); margin: var(--lb) 0 0; font-weight: calc(var(--marxy-weight-heading) + var(--marxy-weight-offset)); }
p, ul, ol, blockquote, table, .marxy-math { margin: 0 0 calc(var(--lb) / 2); }   /* 14px at 28 */
p + p { margin-top: 0; }                                                            /* rhythm: half a line between paragraphs, pairs sum to whole lines */
li { line-height: var(--lb); }
pre { margin: var(--lb) 0; padding: calc(var(--lb) / 2) var(--marxy-code-padding); line-height: var(--marxy-line-box-code);
      font: var(--marxy-size-code) / var(--marxy-line-box-code) var(--marxy-font-mono); background: var(--marxy-color-code-bg);
      white-space: pre-wrap; text-indent: -2ch; padding-left: calc(var(--marxy-code-padding) + 2ch); }
code { font-family: var(--marxy-font-mono); font-size: 0.875em; }                 /* inline; x-height matched by family choice, not by shrinking */
blockquote { padding-inline-start: calc(var(--lb) / 2); border-inline-start: var(--marxy-quote-rule-width) solid var(--marxy-color-quote-rule); }
img { display: block; max-width: 100%; height: auto; margin-inline: auto; }
table { border-collapse: collapse; font-size: var(--marxy-size-caption); line-height: calc(var(--lb) * 6 / 7); } /* 24 at 28 */
td, th { border-bottom: 1px solid var(--marxy-color-rule); padding: 1px 10px 1px 0; }      /* 24 + 2 = 26; snapToGrid pads the table */
strong { font-weight: calc(var(--marxy-weight-strong) + var(--marxy-weight-offset)); }
a { color: var(--marxy-color-link); text-decoration-thickness: 1px; text-underline-offset: 0.12em; }
.marxy-selected { box-shadow: -3px 0 0 var(--marxy-color-accent); }
.marxy-set { white-space: nowrap; }        /* set by the typesetter */
.marxy-hang { display: inline-block; }     /* margin applied inline by the typesetter */
```

Why `p + p` gets half a line: two half-line gaps between three paragraphs sum to a whole line,
and a paragraph's own height is always whole lines, so the article never drifts. Headings use
`mod()` to close the remainder: for h2 with `lh 34` and two lines above, `mod(-90, 28) = 22`
below — the design-language numbers (`56 / 22`) fall out of the formula rather than being typed.

Role tokens the base needs beyond the contract's list are **derived** in `base.css`, not added
to the contract: `--marxy-size-h1: round(calc(var(--marxy-size-body) * pow(var(--marxy-scale-ratio), 3)), 1px)`
and so on for h2 (²), h3 (¹); `--marxy-lh-h1: 40px`, `--marxy-lh-h2: 34px` are set in the default
theme's `:root` block (a theme may set them; they must be ≥ the size and ≤ 2 line boxes; the
loader clamps).

Constraint 4 by construction: `h1..h6 { color: inherit; border: 0; }` in base, and the theme lint
already forbids the default theme from overriding it.

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

## Weight offset (D-A9)

`--marxy-weight-offset` is set on `:root` by the app at startup, never by a theme:

| platform | WebKitGTK | offset |
| --- | --- | --- |
| macOS, Windows | — | 0 |
| Linux | ≥ 2.52 | 75 |
| Linux | 2.50–2.51 | 125 |
| Linux | other | 100 |

from `shell.webkitVersion()` (§06), overridden by config `[linux] weight_offset` (§11).
MARXY-22 measures these on real desktops and replaces the table's values. Every `font-weight`
in `base.css` is `calc(<token> + var(--marxy-weight-offset))`, and the variable axis is driven
through `font-variation-settings 'wght'` as well, because WebKitGTK maps `font-weight` to the
axis but rounds; the explicit axis value is exact.

## Dark variant (MARXY-46, designed not inverted)

Rules in the default theme's `:root[data-marxy-variant="dark"]` block: background `#141414`,
text `#e6e3dc`, body weight token 380 (a serif at 400 reads heavier on dark), code background
one step lighter than the page, rules at 12 % contrast, links desaturated. Contrast gate ≥ 7:1.

## Tests

- `packages/theme/scripts/lint-default-theme.mjs` (exists) plus: every `margin`/`padding` in
  `base.css` is a `calc`/`mod`/token expression, never a bare `px` (regex).
- Playwright: a page with the default theme at 14/17/21/24 px body renders every block's top on
  the grid (the §10 grid check) **without** `snapToGrid` for a text-only fixture — proves the
  CSS construction alone holds.
- Loader: a theme with `url(https://x)` yields the warning and a CSS string without it; a
  manifest with `contract = 2` loads with a warning; clamping works on an out-of-range measure.
