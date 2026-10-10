# 07 Themes

Layout, left to right: the app sidebar, the **theme list**, the **detail panel** for the selected theme, and the **canvas**, always the **Page preview** (the full-size document in the selected theme), which is the largest and rightmost. The panel that configures a theme sits beside the list it selects from, never across the window. Open [07-themes.html](07-themes.html): click a theme to select it (preview and detail panel), double-click or Enter to use it.

Related: [01-workspace.html](01-workspace.html), [03-content-modes.html](03-content-modes.html) (per-type typography), [08-settings.html](08-settings.html) (shares these keys), [TYPOGRAPHY.md](TYPOGRAPHY.md), handbook chapters [09 Colour and accessibility](../docs/src/09-color-access.md) and [06 Code and syntax highlighting](../docs/src/06-code.md).

## Purpose

One palette serves reports, articles, code, logs, data and transcripts, in light and dark, for readers with good and poor vision. Every colour is text or an interface boundary, so WCAG holds it to a minimum.

- **See first.** The Page shows a real document of the selected kind in the selected theme; Space previews the theme across the whole window. Nothing speaks about contrast unless a pair fails.
- **Never ship a failing colour.** Adjustments, palettes, imports, custom themes and language tints are re-audited with the rules of `tools/audit_contrast.py`, and refused or fixed when they fail.
- **Respect the platform.** Follows macOS appearance, Increase contrast, Reduce transparency and Reduce motion; behaves under forced colours.

## How themes inform each view

A view's look is the product of independent layers. The theme list and the Type tab set the first two; the rest stack on top.

1. **Theme** (`[data-theme]` in `shared/tokens.css`): a palette of tokens. Grounds (`--win`, `--side`, `--doc`, `--raised`, `--inset`), text roles, accent, status colours, every code token, edges, selection and highlight, plus three weights (`--text-wght` is lighter in dark themes). Chrome, reading surface and code all draw from the same tokens, so one choice restyles everything.
2. **Type set** (`[data-typeset]`): which face fills each reading role (`--face-book`, `--face-article`, `--face-sans`, `--face-readme`, `--face-code`). One choice restyles every view; the chrome keeps the platform face.
3. **Per-kind reading profile** (`.doc[data-kind]`): size, leading, measure in characters, paragraph style, hyphenation and heading scale for that kind of text. The measure is converted to a width from the active face's measured average character, so a type-set change keeps the character count.
4. **Reader settings** (08 Reading): size, measure, leading, spacing within the ranges in TYPOGRAPHY.md.
5. **Coupling rules** (TYPOGRAPHY.md): for example, dark themes imply generous size and lighter weight.

**Precedence for colour**, highest first:

| Order | Source | Effect |
|---|---|---|
| 1 | Forced colours (system) | Every token becomes a system colour (`Canvas`, `CanvasText`, `LinkText`, `Highlight`, `Mark`, `GrayText`, `ButtonBorder`). |
| 2 | Increase contrast (macOS), if followed and themes follow macOS | The chosen theme is replaced by High contrast light or dark, keeping its mode. A theme fixed by hand is kept, as in `G.resolvedTheme`. |
| 3 | Per-type rule | That content type uses its own theme (and optionally type set). |
| 4 | App theme | The one fixed theme, or the light or dark theme chosen by macOS appearance, sunset and sunrise, or set times. |
| 5 | Theme adjustments | Accent, text weight, ground warmth and selection colour for that theme. |
| 6 | Code palette and highlighting | Token colours and intensity; code only. High contrast themes keep their own tokens. |
| 7 | Language tint and overrides | `data-lang` blocks only: brand-tinted definitions and keywords, then the reader's per-language token colours; high contrast themes carry no tint. |

**Precedence for type:** per-type type set, else the app type set; then the per-kind reading profile; then reader settings; then coupling rules. Text size multiplies through all of them; in dark themes the optional size boost multiplies again.

## Anatomy

| Region | Contents |
|---|---|
| Toolbar | Title; theme menu; Settings; **Details** (shows or hides the detail panel) |
| Theme list (left) | Header: **Appearance** button. Sections **Dark** then **Light**, each a heading (11px chrome label), a quiet line saying when it applies ("Used when macOS is dark"; sunset or set-time lines for a schedule) and a "now" marker on the one matching the current appearance. With Appearance set to one theme there is a single section, **Always**. Rows are 32px, no dividers: a mini swatch (a tiny page in the theme's ground, "Aa" in its text colour, a 2px accent bar), 10px gap, the name, and at the right a check (the theme in use for that section; exactly one per section) or, on hover, a **Use** text button. High contrast themes last in each section |
| Appearance (popover from the list header) | Switch: With macOS, Never (one theme), At sunset and sunrise, At set times; the dark and light theme slots; place or times |
| Canvas (right) | Kind switcher (Report, Article, Code, Log, Data, Transcript, Terminal, Book, README, Docs, Notes, Changelog, App chrome), the preview bar (what is shown, per-kind rule, Fit / Actual, Open in Workspace, Typography link) and the colophon line (face, size, leading, measured characters per line, weight), above the full-size document |
| Detail panel (beside the list) | Header: swatch, name, mode and a primary **Use for Dark** / **Use for Light** (**Use everywhere** in one-theme mode; disabled and reading **In use** when it already is), then the theme actions together: **Duplicate and edit**, **Import**, and **More** (Export, Edit and Delete for custom themes, Reset adjustments). Tabs: **Type**, **Colours**, **Syntax**, **Per kind**, **Access** |
| Theme editor, Import sheet | Replace the layout and overlay it, as before (below) |
| Status bar | Switching mode, applied theme and type set, a failing-pair count only when one fails, Increase contrast and forced-colours indicators, highlighting mode, text size |

Each control lives in exactly one place. List rows carry only select and use; the detail panel header carries all other theme actions.

### Detail panel tabs

| Tab | Holds |
|---|---|
| Type | Type set (five rows with a specimen line); Text size; Text weight (Auto or Custom, theme default plus or minus 50) |
| Colours | **Adjust**: accent (presets and custom, refused with the failing pairs and the nearest passing colour), selection colour, ground warmth. **Tokens**: every token with its value and a ratio, filter All / Text / Code / Failing, full audit |
| Syntax | Two levels with a breadcrumb ("Night › All languages", "Night › Rust"): highlighting and the language list, then one language's colours. Below |
| Per kind | A theme and a type set per content type; the preset; Clear all; the order of precedence |
| Access | Contrast audit (only when a pair fails); Increase contrast with Simulate; Reduce transparency; Reduce motion; Forced colours preview; Generous size in dark themes |

### Syntax

While the tab is open the Page shows a real specimen file in the selected language (about 40 lines: doc comments, a type, strings with escapes, every role) with a language switcher above it; leaving the tab restores the kind that was showing.

**Level 1, All languages** (this theme's defaults). *Highlighting*: Full · Minimal · Off, each segment drawn with a 3-line thumbnail in that mode; per theme (`syntaxCfg[theme].hl`, outranking the global `codeHighlight` that 08 sets). *Comments*: an Italic switch (`codeComments`) and a Tone slider from Quiet (the 4.5:1 floor) to Prominent (toward 9:1), ticks at the floor and at the theme's default (`codeCommentContrast`, empty = theme default). *Definitions*: a Bold switch (`codeDefsBold`). *Brand colours*: a switch, "Tint each language toward its brand colour", and a Strength slider 0 to 100% (default 60; per theme, `syntaxCfg[theme].brand` and `.strength`). Then a search field and the language rows (30px): the language glyph in its brand colour, the name, a 6-dot strip (keyword · definition · string · type · constant · comment as shown) and a quiet source label (Theme, Brand or Custom); "In your files" first (languages found in the library's paths), then all 18. A click opens level 2; ↑ ↓ move the selection and the Page follows; Enter opens level 2.

**Level 2, one language.** Header: the glyph, the name and a source control **Theme · Brand · Custom**. Six role rows (keyword, definition, string, type, constant, comment), each with a sample token in the code face in its colour and a swatch; a click opens a compact inline picker with OKLCH Lightness, Chroma and Hue sliders and a hex field. The lightness track shows the colour range and hatches the part that fails 4.5:1 on this theme's code ground, the page and under a selection; dragging stops at the floor ("Stopped at the 4.5:1 floor. Hold ⌥ to go past it."), and past it one quiet line gives the ratio. Changing chroma, hue or the hex keeps lightness passing unless ⌥ is held. **Reset to Brand/Theme** restores that role. Editing any role switches the language to Custom (keeping what it showed as the base); choosing Theme or Brand discards the edits, with Undo. **Reset language** clears the language on this theme, with Undo. Roles a language does not use in its specimen are dimmed.

**Canvas linkage.** Hovering (or focusing) a role row outlines every token of that role in the Page and dims the others; the open role stays marked. Clicking a token in the Page selects its role and opens its picker (the pointer shows it). The language switcher above the Page and the list selection stay in sync. Esc returns from level 2 to level 1.

`shared/lang-colors.css` gives every rendered code block, source editor and code file row that carries `data-lang="<id>"` a brand colour `--lang` and brand-tinted `--tk-def` and `--tk-keyword`. Brand colours are GitHub Linguist's (MIT-licensed data) for rust, typescript, javascript, python, go, shell, json, yaml, toml, markdown, css, html, sql, swift, c, cpp, java and ruby.

The tint is audited, not eyeballed. The theme's hue and the brand's are mixed as unit vectors in OKLab by the strength (so past half-way the brand hue wins even when the two are opposite), chroma moves toward the brand's by the strength, and lightness is walked in OKLCH until the token reaches 4.5:1 on the code ground, the page and under a selection. Definitions use the full weight, keywords half. JSON and C are achromatic and keep the theme's tokens. The file ships the default strength (60%) for the six non-high-contrast themes and is generated from the page's own function (the page checks it matches); the page re-runs it for custom themes, other strengths, Custom roles and per-theme highlighting, and saves the compiled rules as `langCss`, which every page loads. The blocks use `@scope` with a donut limit, so the nearest `[data-theme]` ancestor decides. Per-theme highlighting is emitted as `pre .tk-x` rules that outrank the page-wide classes.

Storage (localStorage, per theme and per language): `syntaxCfg` (`{themeId: {hl, brand, strength}}`), `langSource` (`{themeId: {langId: {src, base}}}`), `langOverrides` (`{themeId: {langId: {'tk-keyword': hex, ...}}}`, the Custom values), `langCss` (compiled).


### Icon tiles

Any icon tile is the accent: the icon in `--accent` on `--accent-wash`, or a plain `--accent` icon. This page has no icon tiles of its own; the swatch tiles in the panel header are drawn from the theme's own tokens.

## Controls

| Control | Where | Effect | Shortcut |
|---|---|---|---|
| Details | Toolbar | Shows or hides the detail panel | ⌥⌘I |
| Theme menu, Settings | Toolbar | Shared engine menu; opens 08 | ⌘, |
| Kind switcher | Canvas | Kind shown in the Page | ⌘1 to ⌘9, arrows |
| Theme row | Theme list | Click or arrows select (preview and detail panel); Enter, double-click, the hover Use button or the header button makes it the theme in use for its section; Space previews across the window (Space or Esc stops) | ↑ ↓ Home End, Enter, Space |
| Appearance | Theme list header (popover) | Switch mode, place, times: `theme`, `themeSchedule`, `themeScheduleCity`, `themeScheduleDark`, `themeScheduleLight`. The dark and light themes are chosen in the list: `themeDark`, `themeLight` | |
| Use for Dark / Light | Detail panel header | Sets `themeDark` or `themeLight` (`theme` in one-theme mode); built-in or custom. Deleting a theme that is in use asks first ("This theme is in use for Dark. Marxy will switch Dark to Night.") and then falls back to the mode's built-in default (Night, Paper) | |
| Duplicate and edit, Import, More (Export, Edit, Reset adjustments, Delete) | Detail panel header | Editor; VS Code, Base16 or Marxy JSON import; copy or download JSON, copy CSS variables; Edit, Reset adjustments, Delete | ⌘D, ⌘O, ⌥⌘E |
| Type set, Text size, Text weight | Type tab | `typeset`, `scale` (75 to 250%), `themeTweaks[id].weight` | ⌘+ ⌘− ⌘0 |
| Adjust, Tokens | Colours tab | Accent (`themeTweaks[id].accent`), selection (`.sel`), warmth (`.warmth`); token inspector | |
| Highlighting, comments, definitions, brand colours, languages | Syntax tab | Highlighting (per theme), Italic (`codeComments`), Tone (`codeCommentContrast`), Bold (`codeDefsBold`), Brand switch and Strength (per theme), language list, per-language source, roles and picker | ⌥⌘H cycles highlighting |
| Kind rules | Per kind tab | `kindThemes`, `kindTypesets`; preset; Clear all | |
| Increase contrast, Simulate, Reduce transparency, Reduce motion, Forced colours, Generous size | Access tab | `followSystemContrast`, `reduceTransparency`, `reduceMotion`, `darkSizeBoost`; simulations are not persisted | |
| Fit / Actual, Open in Workspace, Typography for this kind, Show app theme | Page preview bar | Preview only | |
| Editor | Replaces the layout | Name, mode, token colour and hex inputs, Undo, Export, Cancel, Save theme (blocked with a visible reason while a pair fails), Fix all | ⌘S, ⌘Z, Esc |

## The eight themes

| Theme | Mode | Intent | Text weight |
|---|---|---|---|
| Paper | Light | Warm off-white; the default light theme | 400 |
| Ink | Dark | Off-black and off-white | 380 |
| Sepia | Light | Warm paper tone. Offered as a preference, not as a remedy | 400 |
| Dusk | Dark | Warm dark with amber accents | 380 |
| Fjord | Dark | Cool blue-grey in the Nord manner; its comments reach 8.1:1 where the Nord VS Code port's reach 2.43:1 | 380 |
| Night | Dark | True black for OLED; text kept off-white; the default dark theme | 370 |
| High contrast light | Light | Black on white, heavy edges; used for Increase contrast in light mode | 450 |
| High contrast dark | Dark | White on black, yellow accent; used for Increase contrast in dark mode | 430 |

Contrast, from `python tools/audit_contrast.py --md` (ratio to 1; all eight themes pass every rule; the app shows this only in the token inspector and never as a status line):

| Role | paper | ink | sepia | dusk | night | fjord | hc-light | hc-dark |
|---|---|---|---|---|---|---|---|---|
| Body text | 15.5 | 13.0 | 12.4 | 13.0 | 13.4 | 11.3 | 21.0 | 21.0 |
| Secondary text | 7.3 | 8.2 | 7.2 | 7.8 | 8.0 | 7.7 | 15.1 | 16.4 |
| Faint labels | 4.9 | 5.8 | 4.8 | 5.6 | 5.7 | 5.7 | 9.5 | 11.9 |
| Accent / links | 6.8 | 9.1 | 6.5 | 8.7 | 10.1 | 7.6 | 10.6 | 14.9 |
| Lowest code token | 6.1 | 8.3 | 5.9 | 7.7 | 7.4 | 8.1 | 8.6 | 12.2 |
| Control edge | 4.2 | 3.9 | 3.8 | 3.8 | 4.3 | 4.2 | 10.9 | 13.6 |

The page computes the same numbers in the browser from the custom properties each `[data-theme]` element actually resolves, so its inspector and failure badges agree with the script to two decimals (Paper 15.47, Ink 13.01, Sepia 12.44, Dusk 13.02, Night 13.36, Fjord 11.30).

## Token reference

Every token defined per theme in `shared/tokens.css`:

| Token | Role | Checked against |
|---|---|---|
| `--win` | Window ground: toolbar, tab strip, status bar | body text 4.5:1 |
| `--side` | Sidebar and inspector ground | body text 4.5:1 |
| `--doc` | Reading page ground | body text 7:1 |
| `--raised` | Menus, popovers, sheets, cards | body text 4.5:1 |
| `--inset` | Code blocks, inline code, table heads, admonitions | body text 4.5:1 |
| `--hover`, `--press` | Translucent row and button states | derived from text colour |
| `--line` | Decorative divider | none (not a control boundary) |
| `--line-strong` | Stronger divider, keycap and switch track | none |
| `--edge` | Control boundary: fields, buttons, switches | 3:1 on page, raised, sidebar, window |
| `--fg` | Body text | 7:1 on page; 4.5:1 on other grounds, under selection, find highlight and the active row |
| `--fg-strong` | Headings and bold | 7:1 on page |
| `--fg-muted` | Secondary text | 4.5:1 on every ground |
| `--fg-faint` | Section labels, counts, line numbers | 4.5:1 on page, raised, sidebar, window |
| `--accent` | Links, focus ring, active tab, primary button | 4.5:1 on page, raised, sidebar |
| `--accent-strong` | Pressed and emphasised accent | (inspector shows it; 4.5:1 on page) |
| `--accent-fg` | Text on an accent fill | 4.5:1 on accent |
| `--accent-wash`, `--accent-wash-strong` | Tinted fills: chips, the active row | body text 4.5:1 on the strong wash over the sidebar |
| `--sel` | Text selection (translucent) | body text 4.5:1 over page; every code token 4.5:1 over code ground |
| `--mark`, `--mark-edge` | Find matches and highlights; underline | body text 4.5:1 over page; edge 3:1 |
| `--ok`, `--warn`, `--err`, `--info` | Status text and marks, always with an icon and label | 4.5:1 on page and raised |
| `--ok-wash`, `--warn-wash`, `--err-wash` | Status fills | derived |
| `--tk-comment` | Comments (italic by default) | 4.5:1 on code ground, page, selection over code |
| `--tk-keyword` | Keywords | same |
| `--tk-string` | Strings | same |
| `--tk-constant` | Numbers and constants | same |
| `--tk-def` | Definitions (bold by default) | same |
| `--tk-type` | Types | same |
| `--tk-punct` | Punctuation | 4.5:1 on code ground and page (page audit only) |
| `--tk-marker` | Markdown syntax markers in source | 4.5:1 on page and code ground |
| `--tk-heading` | Markdown headings in source | 4.5:1 (page audit only) |
| `--tk-link` | Links in source | 4.5:1 (page audit only) |
| `--add-wash`, `--del-wash` | Diff line fills; the + and − markers carry the meaning | derived |
| `--shadow` | Elevation | none |
| `--glass` | Translucent sidebar (vibrancy) | replaced by `--side` when transparency is reduced |
| `--text-wght`, `--strong-wght`, `--head-wght` | Body, bold and heading weights; lighter on dark grounds | |
| `--swatch` | Ground used by theme swatches | |

Type-set tokens (`[data-typeset]`): `--face-book`, `--face-article`, `--face-sans`, `--face-readme`, `--face-code`, `--code-liga`. Chrome: `--face-chrome`, `--chrome-size`. Per-kind (`.doc[data-kind]`): `--k-face`, `--k-size`, `--k-leading`, `--k-measure`, `--k-para-space`, `--k-indent`, `--k-align`, `--k-hyphens`, `--k-head-face`, `--k-h1` to `--k-h3`, `--k-code-size`, `--avg-char`.

## Contrast rules and how the editor enforces them

The rules are WCAG 2.2: 1.4.3 (text 4.5:1), 1.4.6 (7:1, applied here to body text, so Marxy is AAA for reading), 1.4.11 (component boundaries 3:1), and 1.4.1 (colour never the only carrier). Contrast uses the WCAG relative-luminance formula and is compared **unrounded**: 4.499 fails. Translucent tokens are composited over their ground before measuring.

The page runs the 54 rules of `tools/audit_contrast.py` plus six more (punctuation, Markdown headings and links in source, on code ground and page): 60 rules per theme.

Enforcement, everywhere a colour can change:

- **Accent override**: the candidate is applied to a copy of the theme and the whole audit runs. Any failure refuses it, lists the failing pairs, and offers the nearest colour with the same hue that passes everywhere.
- **Warmth and selection**: same audit; a failing step is refused with the pair that would fail.
- **Code palettes and comment tone**: each token is moved until it passes on code ground, page and selection over code.
- **Editor**: every input re-runs the audit. Each token row shows its worst ratio; surfaces show body text on them. The audit panel groups failures by the token to change and computes a fix: for a colour, walk its OKLCH lightness away from the surfaces (hue kept, chroma reduced only to stay in gamut) until every pair it takes part in passes, for example *"Darken comments to #625d50 to reach 4.58:1 on the selection on code (needs 4.5:1)"*; for a translucent overlay, lower its opacity; for text on accent, pick the best of the page colour, white and black. **Fix all** repeats until nothing fails. **Save** is disabled, with the reason beside it, while any pair fails or the name is empty or taken.

## Code highlighting modes

| Mode | What is coloured | Notes |
|---|---|---|
| Full | Every token class | Default |
| Minimal | Strings, constants, comments, definitions; keywords, types and punctuation take the text colour | The minimalist school. Colour becomes a few landmarks for navigation |
| Off | Nothing | Comments keep italic as their cue |

Comments are italic by default and never dimmed below 4.5:1. Tone **Quiet** sets them exactly at the floor (mixed from the code ground toward body text until every surface passes); **Prominent** raises them toward 9:1, for readers who treat comments as the author speaking. Definitions are bold by default, a second cue besides colour. Diffs keep + and − markers. A code palette (follow the theme, or a published palette for the mode, adjusted to pass on this theme's grounds) swaps only the six token colours; the code ground stays the theme's.

Why restrained: the handbook (chapter 6) finds highlighting liked but not shown to aid comprehension (the largest study, 390 undergraduates, found no evidence it helps novices), and of 18 published themes measured, 12 have a token class under 4.5:1, in 11 of them the comments. The minimal mode is an argued opinion (grade D) that fits that evidence.

## Import and audit of third-party themes

**VS Code theme (.json, JSONC tolerated).** Read `colors["editor.background"]`, `colors["editor.foreground"]` and the first `tokenColors` rule for `comment`, `string`, `keyword` (then `keyword.control`, `storage.type`), `entity.name.function` (then `support.function`), `constant.numeric` (then `constant`), `entity.name.type` (then `entity.name.class`, `support.type`). Light or dark from `type`.

**Base16 scheme (.yaml).** Slots by the Base16 styling guidelines:

| Slot | Base16 role | Marxy |
|---|---|---|
| base00 | Default background | `--doc`, `--inset` (shifted) |
| base01 | Lighter background | derived surfaces |
| base02 | Selection background | `--line-strong` |
| base03 | Comments, invisibles, line highlight | `--tk-comment` |
| base04 | Dark foreground | `--fg-faint`, `--tk-marker` |
| base05 | Default foreground | `--fg` |
| base06 | Light foreground | `--fg-strong`, `--tk-heading` |
| base07 | Light background | unused |
| base08 | Variables, tags, deletions | `--err` |
| base09 | Integers, constants | `--tk-constant` |
| base0A | Classes, search highlight | `--tk-type`, `--warn`, `--mark-edge` |
| base0B | Strings, insertions | `--tk-string`, `--ok` |
| base0C | Support, regex, escapes | `--info` |
| base0D | Functions, headings | `--tk-def`, `--accent`, `--tk-link` |
| base0E | Keywords, storage | `--tk-keyword` |
| base0F | Deprecated, embedded tags | unused |

Marxy's selection stays a translucent accent (not base02) so token colours survive under it. Base16 puts comments in the line-highlight slot, so imported comments usually fail and are brightened.

**Derived tokens.** Grounds are shifted in OKLCH lightness from the background; dividers and edges are mixes of background and foreground; secondary and faint text are mixes toward the background; status colours come from the scheme where it has them, else from fixed hues at the foreground's lightness; washes, glass and shadow follow.

**Audit report.** Seven source roles against the theme's own ground: body text at 7:1, the six token classes at 4.5:1, with the fix for each failure. The prototype's samples are the 18 published themes in `docs/data/themes.json`, with their official colours; the computed ratios match the dataset (Solarized Dark comments 2.79:1, functions 4.08:1, body 4.75:1; One Dark comments 2.32:1, body 6.57:1). Body text that passes the dataset's 4.5:1 can fail Marxy's 7:1, as Solarized Dark's and One Dark's do. Base16 samples are assembled from the same eight roles; the other eight slots are interpolated and drawn dashed.

**Import with fixes** maps, runs the full 60-rule audit, fixes until nothing fails, and opens the editor with a note listing every changed colour (Solarized Dark: body text #839496 to #a6b8ba, comments #586e75 to #91a9b0, and so on). **Open unfixed** shows every failure and leaves Save blocked until they are fixed. **Marxy JSON** (`"marxyTheme": 1`, `tokens`, `weights`, `audit`) validates colours and fills missing tokens from Paper or Ink.

## Per-type overrides and schedule

**Per type.** Each of the ten content types can follow the app or keep its own theme and type set, for example books in Sepia and code in Night. The rule applies wherever that type renders; Increase contrast and forced colours still win. Size, measure and leading always come from the type's reading profile.

**Schedule** (shared with 08 Settings, `themeSchedule`):

| Mode | `theme` | `themeSchedule` | What shows |
|---|---|---|---|
| With macOS | `system` | `off` | `themeLight` or `themeDark` by macOS appearance |
| One theme | a theme id | `off` | That theme |
| Sunset and sunrise | `system` | `sun` | `themeDark` between sunset and sunrise at the place |
| Set times | `system` | `custom` | `themeDark` from `themeScheduleDark` to `themeScheduleLight` |

A schedule only acts while following macOS, as in 08. Custom themes can be used in either slot or in one-theme mode.

## Accessibility

- **Increase contrast** (followed by default): while themes follow macOS (including on a schedule), every view switches to High contrast light or dark, matching the mode. A theme fixed by hand is kept, matching `G.resolvedTheme`. A session-only Simulate button shows the effect in any mode.
- **Reduce transparency**: the sidebar and menus become solid `--side` instead of `--glass` vibrancy. Follow macOS, always or never.
- **Reduce motion**: no cross-fade on theme change, no page-turn or toast animation. Follow macOS, always or never.
- **Forced colours**: the palette yields to system colours. Every meaning survives because admonitions have labels and icons, links are underlined, paths have marks, diffs have + and −, the failure badge says Fail in words, and the per-type rule shows its theme by name. A Preview button renders the page with system colours.
- **Dark themes**: lighter text weight by default, and an optional size boost (+5% or +10%).
- **Keyboard and screen readers**: listboxes with arrow keys and roving focus; tablists with arrow keys; every input labelled; theme changes announced by name ("Ink applied"), with the body contrast spoken only when it fails; scrolling previews are focusable; colour is never the only cue.

What the evidence says (handbook chapter 9; grades as the handbook gives them):

| Grade | Finding | Consequence here |
|---|---|---|
| A | Dark text on a light ground reads slightly better for most people, in dark and office lighting, for younger and older adults; the advantage grows as text shrinks | Paper is the default light theme; dark themes pair with generous size |
| B | In a glance-reading study the penalty for light-on-dark was largest in dark surroundings | A dark room is a comfort reason, not a legibility reason, for dark mode |
| B | Some readers with low vision, especially with light scatter, read 10 to 50 per cent faster with light text on dark | Increase contrast offers both polarities |
| D | Dark themes lighten weight (irradiation) and need generous size | 380 weight, optional size boost |
| D | No evidence that sepia or blue tints improve reading, or that dark mode reduces eye strain | Sepia is described as a preference, not a remedy |

## Settings keys it binds to

Existing engine keys: `theme`, `themeLight`, `themeDark`, `typeset`, `scale`, `followSystemContrast`.

Shared with 08 Settings (same values): `themeSchedule` (`off` / `sun` / `custom`), `codeHighlight` (`full` / `minimal` / `off`), `reduceTransparency` and `reduceMotion` (`system` / `on` / `off`).

New, defined by this page (recommended for `G.prefDefaults`):

| Key | Default | Meaning |
|---|---|---|
| `themeScheduleCity` | `sf` | Place for sunset and sunrise (the app uses Location Services) |
| `themeScheduleDark`, `themeScheduleLight` | `21:00`, `07:00` | Set times |
| `themeTweaks` | `{}` | Per theme: `accent` (hex), `weight` (number), `warmth` (−3 to 3), `sel` (`neutral`, `marker`, `system`) |
| `codeComments` | `italic` | Or `upright` |
| `codeCommentContrast` | `null` | Comment contrast, 4.5 to 9; empty = the theme's own |
| `codeDefsBold` | `true` | Bold definitions |
| `codePalette` | `{light: 'theme', dark: 'theme'}` | Palette name per mode |
| `kindThemes`, `kindTypesets` | `{}` | Per content type |
| `darkSizeBoost` | `0` | 0, 5 or 10 (per cent) |
| `customThemeActive` | `null` | Legacy: no longer written. `theme`, `themeLight` and `themeDark` hold a custom theme's id directly; the engine resolves it from `customThemes`, applies its `themeCss`, and falls back silently to Ink or Paper when the id is gone. `G.resolvedTheme()` still returns the built-in base, `G.appliedTheme()` the custom id |

Store key `customThemes`: an array of `{id, name, mode, base, desc, tokens, saved}`.

Related 08 keys: `accent` (`theme` / `system` / `graphite`) applies when a theme has no custom accent in `themeTweaks`; `darkLighter` and `weightAdjust` adjust weight globally (proposed: a per-theme `weight` overrides them); `sidebarStyle` is forced to solid while transparency is reduced.

Syntax tab keys: see Syntax above.

Deep links: `07-themes.html#kind=code`, `#tab=type|colours|syntax|kinds|access` (`tokens` and `adjust` open Colours, `code` and `languages` open Syntax), `#lang=rust`, `#edit=<theme id>`, `#import=vscode|base16|json`.

## Open questions

1. **Custom themes in the light and dark slots.** Resolved: a custom theme can be the Dark theme, the Light theme or the one theme (`themeDark`, `themeLight`, `theme` hold its id). 08 no longer duplicates the choice: its Theme row is a read-only line with a link to the list.
2. **App-wide behaviour, now in the shared engine.** The schedule (set times, or sunset from the city saved here), tweaks, code highlighting modes, comment style, bold definitions, reduced transparency and the dark size boost apply on every page through `G.applyTheme`; per-type themes and type sets apply in the Workspace and Content modes through `G.renderDoc(..., { kindTheme: true })`. Reduce motion follows the operating system everywhere and this page's simulation only here.
3. **One accent or one per theme?** 08 has a global `accent` (`theme`, `system`, `graphite`); this page validates custom accents per theme, because no single colour passes on both light and dark grounds. Proposed: keep both, with the per-theme custom accent winning.
4. **Measured line length.** Resolved in the engine: `G.colophon` now counts characters per line per character, excluding last lines and paragraphs with inline code, as this page does.
5. **Should Quiet comments be allowed at all?** It sits exactly on 4.5:1, which passes, but readers who rely on comments may want the floor higher. A per-reader floor (4.5, 5.5, 7) is an option.
6. **APCA.** The page builds to WCAG 2's formula, as the handbook advises; if WCAG 3 settles on a different contrast method, the audit's thresholds change, not its structure.
7. **Location for sunset.** The app needs Location Services permission; without it, fall back to the time zone's city and say so.
8. **Imported themes and fonts.** VS Code themes can carry `fontStyle` per scope (italic, bold, underline). The prototype ignores them; the app could map italic comments and bold definitions to the corresponding Marxy switches.
