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

| Rule | Formula | At 20 / 30 |
| --- | --- | --- |
| Article | `--marxy-column = clamp(45, chars, 80) × avg-char em` (a registered `<length>`, so it is px everywhere below); `max-width: column`, padding `half gutter 5lb`, where `gutter` is a floor — 16px under a 480px window, 24px at or above it — not a fixed width, so the column still sets the margin above that floor (Reader Typography ch.4 "Margins", MARXY-263) | 66 characters ≈ 611 px |
| Role sizes | `--marxy-size-hN = round(body × ratio^k, 1px)`, k = 3, 2, 1 | 39, 31, 25 |
| Heading line box | `min(max(token, round(up, 1.2 × size, 2px)), 2lb)` | 48, 38 |
| h1, h2 margin | `2lb` above, `half` below; `padding-bottom: mod(−(lh + 2lb + half), half)` closes a one-line heading's box; a heading that wraps is padded by `snapToGrid` (ADR-0033) | h2 60 / 38 / 15 (+ 7 pad) |
| h3 … h6 | one line box, `lb` above, `half` below | 30 / 15 |
| p, lists, quotes, tables | `margin: 0 0 half` | 15 between |
| Lists | top-level markers hang in the margin, the gap inside the hanging box so the first line aligns with the rest; nested lists indent `1.25em`; markers secondary colour | |
| Task items | the checkbox hangs where the bullet would be, `vertical-align: top` so the box sits on the line | |
| Code block | `lb` above and below, `half` padding on all four sides, code line box token, padded to the unit by `snapToGrid`; `width: max-content`, at least the column, at most `min(100% + room, 100ch + padding)` where room runs from the gutter to the window's edge | 30 / 15 / 30 |
| Code wrap | `white-space: pre-wrap`; each source line is a `.marxy-line` inline-block whose rows hang `min(indent + 2ch, 50%)`, with a 1 px rule beside continuation rows only; no ligatures (`calt`, `liga` off) | |
| Inline code, kbd | mono at `size-code / size-body` (0.9 em), **no box**, `line-height: 1` so its line never grows | |
| Table | A table is an island the grid pass pads — `snapToGrid` measures it rather than the stylesheet constructing it. Rows use the code line box and one grid unit of vertical padding; rules as inset shadows (no height), text `0.88 × body`, tabular figures | 15 / 22 / 14 |
| hr | one line box of space with a centred `* * *` in the secondary colour, `half` around it; not set directly before an h1 or h2 | |
| Footnotes | body size, secondary colour, after a short quarter-width rule; `sup`/`sub` `line-height: 0` | |
| Weight | `--marxy-wght = token + offset` drives `font-weight` **and** `font-variation-settings: 'wght'` on every descendant | 380 / 560 / 700 dark, 400 / 580 / 700 light |

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
- **A table is an island the grid pass pads — `snapToGrid` measures it rather than the stylesheet constructing it.**
  Decision 3 of ADR-0030 claimed one line box per row; that clause is superseded (ADR-0030
  Amendment 1, MARXY-141).
- **Heading line boxes as fixed px tokens** fall below the heading's size when a reader enlarges
  the type (at 24 px an h2 is 38 px on a 34 px box, 2 px above its paragraph); the formula above
  grows them.
- **Heading remainder in the margin** made the space below a heading (22 px at 17) neither a half
  line nor a line, which review #1 read as a tick. The named gaps are now `2lb` / `half`; the
  remainder is `padding-bottom` so both margins are grid units (MARXY-128).
- **Table rows at the body line box** made a wrapped cell looser than the dense (zero) cell
  padding. Rows now use the code line box and one grid unit of vertical padding, and `snapToGrid`
  treats the table as an island (MARXY-128).
- **Quote rule at the token colour** was 1.6:1 on the page. Base mixes it toward secondary so the
  rule is ≥ 3:1 without rewriting the frozen token (MARXY-128).

Role tokens the base needs beyond the contract's list are **derived** in `base.css`, not added
to the contract. Constraint 4 by construction: `h1..h6 { color: inherit; border: 0; }` in base,
and the theme lint forbids any heading rule setting a colour or a border.

## One chrome (W-04)

Every summoned surface (palette, verb menu, find, outline, a peek) and every menu reads one spec, in one block of
`base.css`; the palette and outline runtime sheets and the verb menu's markup take its classes and keep layout only.
Face and size are `--marxy-face-chrome` and `--marxy-size-chrome`; a raised surface has `--marxy-color-surface`,
`--marxy-shadow-surface` and a `--marxy-color-rule` outline. Every length is a ratio of the chrome size (the numbers are
at 13 px), so the reader's `chrome_size` scales them. The text being read is not part of this. Notices are (U-02): a pill floated at its pane's foot, off the column, on the surface roles with a 10 px radius at 13 and the status role's colour for its glyph and word (`docs/design/09-app-shell.md` §Notices). A new surface takes
`.marxy-surface` (and `-md` or `-lg`), a new menu row `.marxy-menu-row` and `.marxy-menu-key`; no literal shadow colour,
radius or font face goes in those rules (`packages/theme/src/chrome-spec.test.ts`; computed in
`apps/desktop/test/chrome-surfaces.test.mjs`).

| Part | Rule | At 13 / 16 / 26 px |
| --- | --- | --- |
| Face, size | `font-family: var(--marxy-face-chrome)`, `font-size: var(--marxy-size-chrome)` | |
| Ground, edge, elevation | `--marxy-color-surface`, `1px solid --marxy-color-rule`, `box-shadow: var(--marxy-shadow-surface)` | |
| Radius | `.marxy-surface` (menu, find, peek) `size × 6 / 13`; `-md` (palette) `× 9 / 13`; `-lg` (outline sheet) `× 13 / 13` | 6 / 9 / 13 px at 13 |
| Menu row | `min-height: round(size × 28 / 13)`, padding `size × 5 / 13` by `size × 10 / 13`, gap after an icon `size × 8 / 13` | 28 / 34 / 56 px high |
| Shortcut | `.marxy-menu-key`: pushed to the end, so its right edge is one x on every row; `size × 16 / 13` of space before it | |
| Forced colours | a `CanvasText` border, `Canvas` ground, no shadow | |
| Toolbar states | hover: the selection ground; checked and pressed: `--marxy-color-accent-wash` and a 2 px accent line under the label; disabled: `--marxy-color-text-secondary`; focus: a 2 px accent outline. Every pair is one the contrast gate holds (text, text-secondary, accent on surface or accent-wash) | |
| Toolbar width | the title keeps `5em`; a row that still cannot fit scrolls, with the edge that hides controls faded into the ground | |

## Kind profiles (K-05b)

The default theme gives three kinds a profile in `default/theme.css`, as `[data-marxy-kind="…"]` scopes (ADR-0059
item 7). A scope covers Night and Paper alike: it sets a face role, sizes, a measure and the face's average advance,
never a colour or a weight. The sizes are `calc(<ratio> * var(--marxy-root-…))` over the system-owned root copies,
because the default theme is inlined as written and not compiled by the loader; line boxes are `round(…, 2px)`, so
they are whole even pixels at the default size (ADR-0030) and at every reader size. The reader's text size still wins.

| Kind | Face (role) | Body / line box | Code / code line | Measure (characters) | `--marxy-avg-char` | Follows |
| --- | --- | --- | --- | --- | --- | --- |
| `article` | Source Serif 4 (`--marxy-face-article`) | 20 / 30 (as the root) | as the root | 66 | 0.434 | ch.10 "Measure from average character width" |
| `readme` | Inter (`--marxy-face-readme`) | 16 / 26 (0.8, 0.8667) | 14 / 26 (0.78, 0.8667) | **80** | 0.454 | the forge's own conventions (03 §Profiles) |
| `report` | Atkinson Hyperlegible Next (`--marxy-face-sans`) | 17 / 26 (0.85, 0.8667) | 15 / 26 (0.83, 0.8667) | 74 | 0.425 | ch.7 and ch.10 "Documentation": ragged, space between paragraphs |

- *`readme` is 80, not 84.* 03 §Profiles gave the README 84 characters, past the 45 to 80 the loader and `base.css`
  clamp a reflowing kind to. The profile takes the clamp's edge (ADR-0060, last Consequence) rather than write an
  exception into the clamp.
- *The average advances are measured*, by `measureAverageAdvance` (H-06) at the size and weight the face is set at
  (`docs/taste-review/2026-10-k05b/capture.mjs <tag> --measure`), so each column holds its character count whatever the
  face. A face is narrower than Literata, so an article column is 621 px with its gutters where it was 659 px.
- *`base.css` derives again in the kind scope* what a kind may move: `--marxy-measure` (K-05a's H-03 repeat; its `1em`
  is the body size where the column is used, and the test sets a measure inside the clamp at two reader sizes to prove
  it) and `--marxy-size-h1`, `-h2`, `-h3`, which were derived on `:root` from the reader's body size and would have left
  a README's headings 39 px beside 16 px text.
- *Source is not a profile.* `.marxy-source-mount` takes the root sizes back, so a README in Source is the editor it is
  in any other pane.
- *Not yet done:* report's "no hyphenation". Hyphenation is the typesetter's (JS), not a CSS property, so there is no
  token to set here; it is a follow-up outside `theme/`.
- Tests: `apps/desktop/test/kind-profiles.test.mjs` (WebKit) and the last test in `packages/theme/src/loader.test.ts`.

## Loader (`loader.ts`)

```ts
export interface ThemeManifest { name: string; author?: string; contract: 1; variants: ('light' | 'dark')[] }
export async function loadTheme(read: (rel: string) => Promise<Uint8Array>, assetUrl: (rel: string) => string): Promise<{ manifest: ThemeManifest; css: string; warnings: string[] }>
export function applyTheme(css: string): void;             // replaces #marxy-theme
export function applyVariant(v: 'light' | 'dark'): void;    // sets html[data-marxy-variant]
```

1. `theme.toml` parsed with `smol-toml`; missing or wrong `contract` → warning "theme targets
   contract N; Marxy speaks 1" and the theme still loads (nothing worse than mis-styling can
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
   `.css`/`.toml` there) with a notice: "This is a Marxy theme." [Use this theme] [Dismiss].
   *Use this theme* writes `theme = "<dir>"` to `config.toml` by the same one-line edit that
   writes `size` (§11) and calls `startUserTheme` with it. Saving the open `theme.css` then
   hot-reloads it through step 5 — editing a theme in Marxy's own Source mode is a live preview.

Contract version: `contract` absent or ≠ 1 → warning "Theme 'quiet' targets contract 2;
Marxy speaks 1. It may not look as intended." The theme still applies.

## Weight offset (D-A9)

`--marxy-weight-offset` is set on `:root` by the app at startup, never by a theme:

Off Linux the offset is `0`. On Linux it is one constant, `LINUX_WEIGHT_OFFSET = 100`
(`apps/desktop/src/theme/offset.ts`), overridden by config `[linux] weight_offset` (§11) when the
caller passes it. The constant is unmeasured: it was chosen here and is to be measured when a
Linux desktop exists (ADR-0046). The per-WebKitGTK-version table this section once carried, and
the `shell.webkitVersion()` query it needed, were removed with ADR-0046; the table was never
consulted, because the app never had a version to look up. No value changed on any platform.
The research handbook does not cover a platform weight offset; `docs/research/reader-typography/03-fonts.md`
is the source only for the variable `wght` axes the fonts ship. Every `font-weight`
in `base.css` is `calc(<token> + var(--marxy-weight-offset))`, and the variable axis is driven
through `font-variation-settings 'wght'` as well, because WebKitGTK maps `font-weight` to the
axis but rounds; the explicit axis value is exact.

## Palettes (ADR-0024: dark is primary, light is designed second)

H-04: the default theme is **Night** (dark, a true-black ground) and **Paper** (light); today's warm
near-black and warm paper moved to the `ink` theme (`packages/theme/ink`). Night and Paper take their
values from Galley's audited themes (`docs/plan/direction-2026-10/galley/tokens.css`); Ink keeps the
values the app shipped before, whose ground `#151412` matches none of Galley's eight themes and is kept
as Ink's own. Every pair of every theme is held by `scripts/gate-contrast.mjs` (ADR-0059 item 10), computed
unrounded with translucent colours composited first; nothing below is an inversion of anything else.
The tables give the values the palette tests read (`packages/theme/test/palettes.json`); the gate's
`--md` output (`node scripts/gate-contrast.mjs --md`) lists every ratio.

| Token | Night | Paper | Ink dark | Ink light |
| --- | --- | --- | --- | --- |
| `--marxy-color-bg` | `#000000` | `#fbfaf8` | `#151412` | `#faf8f4` |
| `--marxy-color-text` | `#c9cfd4` | `#1f2124` | `#e8e4dc` | `#1c1b19` |
| `--marxy-color-text-secondary` | `#9aa1a8` | `#4f545a` | `#a39e94` | `#5e5a53` |
| `--marxy-color-accent` | `#8fb4ff` | `#2357a0` | `#8fb4dd` | `#2c5f8a` |
| `--marxy-color-rule` | `#232528` | `#dcd9d3` | `#2a2825` | `#e4e0d8` |
| `--marxy-color-code-bg` | `#0d0e0f` | `#f2f1ed` | `#1d1c19` | `#f1eee8` |
| `--marxy-color-surface` | `#17181a` | `#ffffff` | `#1f1e1b` | `#f1eee8` |
| `--marxy-color-selection` | `#222b3d` | `#d8e0ea` | `#1f3651` | `#dbe9ff` |
| `--marxy-color-find` | `#272213` | `#f1dfae` | `#3a3010` | `#fcefc0` |
| `--marxy-color-find-edge` | `#8a6a18` | `#9a6a00` | `#94701a` | `#8a6200` |
| `--marxy-weight-body` | 370 | 400 | 380 | 400 |
| `--marxy-weight-heading` | 560 | 570 | 560 | 580 |

Night's and Paper's selection, find and diff fills are opaque, the mock's translucent ones composited over the ground. Night's find fills are darker and its find edge deeper than the mock's, so that the edge keeps 3:1 on
the ground and on the code text, and the faint text role keeps 4.5:1 on every fill (the gate's floors).
Night's and Paper's translucent diff and find fills are written as opaque colours over the ground they sit on.

The selection and find colours were chosen so that **every code token** also clears 4.5:1 on them,
not only body text (research `10-spec.md` "Verification"). The current find match is darker (dark) or
deeper (light) than the others but not by enough to rely on: it also carries an outline, so colour
is never the only signal (ADR-0033).

Code tokens are restrained (ADR-0033, research `06-code.md`): colour marks strings, literals,
comments and the names being defined or called. Keywords, types, variables, operators, punctuation
and attributes are `var(--marxy-color-code-text)`. Ratios on the variant's code background, then the
lowest on selection, find and current find:

| Token | Dark | Light |
| --- | --- | --- |
| string | `#a8c48a` 8.9 · 6.3 | `#356024` 6.4 · 5.6 |
| comment (read, not dimmed) | `#d4ad73` 8.1 · 5.8 | `#85521a` 5.6 · 5.0 |
| number, constant | `#c9a0dc` 7.7 · 5.5 | `#6f42a8` 6.0 · 5.3 |
| function, tag | `#8fb4dd` 7.9 · 5.6 | `#2c5f8a` 5.8 · 5.1 |
| keyword, type, variable, operator, punctuation, attribute | code text 12.8 · 9.1 | code text 14.9 · 13.1 |

Rules that follow: `html[data-marxy-variant]` is set by the app before first paint from config
(`dark` default, `auto` follows `prefers-color-scheme`, `light` fixed); the window background and
the empty state are the ground so a white frame never appears (the Tauri window's own
`backgroundColor` is Night's `#000000`, set by H-04.1, so no warm frame shows before first paint); `color-scheme: dark light` is
declared on `:root` so form controls and scrollbars follow the variant. Themes that declare
only one variant are used for both with the default theme's other block filling the gaps.

## Tests

- `packages/theme/scripts/lint-default-theme.mjs`: headings set no colour or border (in the theme
  and in base); every `margin`/`padding` in `base.css` is an expression of tokens, never a bare `px`.
- `packages/theme/test/grid.test.mjs` (Playwright WebKit): a text-only case whose headings set on one
  line sits on the grid **without** `snapToGrid` at 16/20/24/28 px (the CSS construction alone holds
  for a document with no table and no wrapped heading, ADR-0033); every corpus file sits on it after
  the grid pass at 720/960/1280 and at 16/24/28 px; the measure is 66 average characters ± 10 % in
  Literata; contrast in both variants; the h2 numbers; heading space below at every size; the code
  block's hanging indent; and a wrapped code line continuing past its own indentation. The CSS-alone guarantee no longer covers a document containing a
  table (ADR-0030 Amendment 1).
- `packages/theme/test/taste.test.mjs`: one named case per review #1 fault — heading 2:1 on the
  grid unit, real Literata italic, code-block padding, quote contrast, checkbox alignment, table wrap.
- Loader: a theme with `url(https://x)` yields the warning and a CSS string without it; a
  manifest with `contract = 2` loads with a warning; clamping works on an out-of-range measure.
