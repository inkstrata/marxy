# Themes, looks and type

How Marxy colours and sets a page: theme sheets, the look engine that resolves them per pane, the
`--marxy-*` token contract, a reader's own themes and looks, colour per language, the typesetter and
the bundled fonts. Code lives in `packages/theme`, `packages/typeset`, `fonts/`,
`apps/desktop/src/look/`, `apps/desktop/src/theme/` and `apps/desktop/src/studio/`.

## Two layers

| Layer | What it is | Where |
| --- | --- | --- |
| Theme sheet | A CSS file that sets `--marxy-*` custom properties for the dark and light variants. The app's own CSS (`base.css`, `frame.css`, `left.css`) reads only those properties. | `packages/theme/<id>/theme.css` and `theme.toml` |
| Look | About twenty numbers plus type settings (tone, ink contrast, accent hue, code colour, face, size, leading, measure, weights, alignment) and, for a pinned look, hand-drawn colours. The look engine resolves a look into token values for one pane, given its kind, path, width and the time of day. | `packages/theme/src/look.ts`, `packages/theme/src/looks/*.ts` |

Every bundled theme is a look with `pins` (its colours) and a `theme` name; its sheet is written from
the look. When looks are on, `apps/desktop/src/look/paint.ts` writes resolved tokens as inline custom
properties on the window and on each pane, so a pane holding a log can wear a different face and
measure from one holding an essay. When looks are off, `clearEl` removes everything painted and the
theme sheet named in `config.toml` paints the page.

Looks are on once `look.toml` exists in the settings folder and does not say `on = false`.

## Bundled themes and looks

The shelf is `LOOKS` in `packages/theme/src/looks/index.ts`; the default is `DEFAULT_LOOK = 'ink'`.

| Appearance | Looks, in shelf order |
| --- | --- |
| Dark | Ink, Night (`night-paper`), Midnight, Black, Ember, Fjord, Polar, Indigo, Dusk (`warm`), Moss, Console, Solarized, Gruvbox, Rosé Pine, Catppuccin, High contrast |
| Light | Paper, Book, Newsprint, Vellum, Mint, Dim, Hyperlegible (`plain`), Slate, Draft, Large print |

- A pinned look carries its colours as `pins`, one set per scheme; most also name a `partner` page for
  the other scheme (Ink's is Paper). Fjord is drawn for night only (`only: 'night'`).
- Most pinned looks take the classic type set (`CLASSIC` in `looks/define.ts`). Polar and Newsprint set
  headings in Inter over a serif; Indigo does the reverse, Source Serif 4 headings over Inter for all
  prose, sized to Literata's x-height.
- Moss, Console and the ten light looks are dials only: their colours are solved from tone, ink and
  accent.
- Solarized, Gruvbox, Rosé Pine and Catppuccin carry a `credit` naming the palette's authors and
  licence.
- Theme folders exist for the pinned looks: `ink`, `midnight`, `black`, `ember`, `fjord`, `polar`,
  `indigo`, `warm`, `solarized`, `gruvbox`, `rose-pine`, `catppuccin`, `high-contrast`, plus `default` (the
  hand-written Night and Paper sheet that every page inlines as its base).

### Faces and tones

`packages/theme/src/looks.ts`:

- `FACES`: `literata`, `source` (Source Serif 4), `hyper` (Atkinson Hyperlegible Next), `inter`,
  `mono` (JetBrains Mono) are bundled; `sitka`, `palatino`, `georgia`, `segoe` are system faces. Each
  has a CSS stack and tabulated metrics (average advance and x-height in em), used for the measure
  and for matching sizes across faces.
- `TONES`: ten named page tones from White to Black.

### Rules

Rules change a look by context. Built in (`BUILT_IN_RULES`):

| Rule | Default | Effect |
| --- | --- | --- |
| `dark` | on | The page turns to its night tone after dark. |
| `kinds` | on | Code, logs, terminal sessions and diffs use the mono face at 0.82 of the size; data uses Atkinson at 0.84. |
| `working` | on | Reports, docs, notes and changelogs get a measure 10 % wider. |
| `narrow` | on | Below 620 px the size drops by 1.5 px, never under 15. |
| `wide` | off | Above 1500 px the size grows by 10 %. |
| `lean` | on | Lean-back mode sets the size to 1.3 times and the measure to at most 52. |

A reader's own rules (`[[rule]]` in `look.toml`) match on `path`, `kinds`, `scheme`, `minWidth` and
`maxWidth` and set a look or tweaks. `SAMPLE_RULES` holds two starters (files under `reading/` use
Book; logs and terminal sessions use Console, off).

### Resolving

`resolve(state, ctx, over)` in `look.ts` returns the token values, the reasons for each choice, the
scheme (`system`, `clock` with night from 19:00 to 07:00, `day`, `night`), the subject (prose, mono,
data, by kind) and the colours. Pinned colours are used as drawn while they hold their contrast
floor; otherwise their lightness is walked until they do, and the move is reported. The line box is
always an even whole pixel. Justification is on only for prose with a measure of at least 45
characters in a pane that is not tight, and is done by the browser (`base.css`,
`[data-marxy-look-align="justify"]`), not by the typesetter.

`apps/desktop/src/look/paint.ts` repaints on a look change, a pane opening, closing or resizing, the
system turning dark, and More contrast. It sets `data-marxy-look`, `data-marxy-scheme`,
`data-marxy-look-para` and `data-marxy-look-align` beside the tokens.

## Contrast floors

The engine (`look.ts`) and the gate (`scripts/gate-contrast.mjs`) hold the same floors, computed
without rounding:

| Role | Floor |
| --- | --- |
| Text on the page | 7:1 (the ink dial never goes lower) |
| Text and strong text on raised grounds (surface, code, selection, find, washes) | 4.5:1 |
| Secondary and faint text | 4.5:1 |
| Accent, link, accent foreground on accent | 4.5:1 |
| Status colours on their washes | 4.5:1 |
| Code tokens and code text on code, page, selection, active line and diff grounds | 4.5:1 (4.9:1 for solved language hues) |
| Edges, find edge, divider focus | 3:1 |

The `high-contrast` theme raises 4.5 to 7 and 3 to 4.5. More contrast (`data-marxy-contrast="more"`
on the root, set from the system or the reader's choice) makes secondary and faint text 7:1 and rules
3:1. `gate-contrast.mjs` resolves every bundled sheet, variant and kind scope and every look through
`look.ts`; `packages/theme/src/look.test.ts` also tries 240 random dial settings.

## Writing theme sheets from looks

Bundled sheets are generated. Edit the look, never the sheet:

```bash
node packages/theme/scripts/write-theme-sheets.mjs          # rewrite every generated sheet
node packages/theme/scripts/write-theme-sheets.mjs --check  # exit 1 if any sheet differs
```

- `sheetFor(look)` writes `:root { … }` for night and `:root[data-marxy-variant="light"] { … }` for
  day (one block for a look drawn for one scheme). A colour is written as drawn, as its resolved hex
  if the floor moved it, or as `var(--marxy-…)` where a role refers to another.
- A look with `perLanguage: false` also gets a `[data-marxy-lang]` block, so its one code palette
  outranks the per-language ones.
- `manifestFor(look)` writes `theme.toml` (`name`, `author`, `contract = 2`, `variants`).
- `packages/theme/test/theme-sheets.test.mjs` fails when a sheet or manifest differs from its look,
  and checks that the `night-paper` look matches the hand-written `default/theme.css`.

To add a bundled theme: add `packages/theme/src/looks/<id>.ts` (copy a pinned look such as
`polar.ts`), list it in `LOOKS` in `looks/index.ts`, run the writer, then
`node scripts/gate-contrast.mjs` and `pnpm --filter @marxy/theme test`.

## The token contract

`packages/theme/src/tokens.css` declares every `--marxy-*` token with a default (the dark variant's)
and a comment. `packages/theme/tokens.contract.json` snapshots each token's name, unit kind and
comment (105 tokens).

| Group | Tokens control |
| --- | --- |
| Rhythm and measure | the line box (the grid unit is half of it), measure in average characters, role sizes for body, code, Source and captions, heading line heights |
| Families and weights | text, heading and mono families, weights, heading tracking, optical sizing |
| Colour roles | page, text ladder, accent family, rules and edges, dividers, surfaces, code ground and text, selection and find, status colours and washes, diff colours |
| Code tokens | the 21 syntax roles (`tok-keyword`, `tok-string`, `tok-comment` and so on) |
| Face roles | faces by kind (`face-book`, `face-article`, `face-sans`, `face-readme`, `face-mono`) and the chrome face and size |
| Root copies | system-owned copies of the root sizes that kind scopes scale from |
| Presentation | code radius and padding, quote rule width, progress rule, justification, the typesetting switch, heading style and case, figures, paragraph indent, surface shadow, divider hit area |

`node scripts/check-tokens.mjs` fails when a token is added, removed, changes unit kind or loses its
comment; `--write` regenerates the snapshot. `scripts/check-registry.mjs` fails when source uses a
`--marxy-*` property that is neither a token nor listed in `scripts/registry.json`.

What a loaded sheet may set is limited by `packages/theme/src/loader.ts`:

- Some tokens are global only (surfaces, shadows, chrome face and size, dividers, the typesetting
  switch) and are dropped from kind scopes; `weight-offset`, `lang` and the root copies are never
  taken from a theme.
- In a kind scope (`[data-marxy-kind="…"]`) sizes must be ratios of the reader's size and are
  clamped; `measure` is dropped and `measure-chars` is clamped to 45 to 80.
- On `:root`, `line-box` is clamped to 20 to 48 px, `size-body` to 13 to 28 px and `size-chrome` to
  11 to 26 px; `calc()` and `var()` values there are dropped.
- A language scope (`[data-marxy-lang]`) may set only `--marxy-tok-*`.
- A contract-2 theme that leaves one of the required colour roles unset gets a warning and the
  fallback.

## A reader's own themes

`config.toml`'s `theme` key names a bundled theme or a folder (`~` expanded, relative paths taken from
the `config.toml` folder). A folder beside `config.toml` named like a bundled theme takes its place.

- The folder holds `theme.css` (required) and `theme.toml` (optional).
- `apps/desktop/src/theme/user-theme.ts` loads it through `loadTheme`, applies it as the `#marxy-theme`
  sheet, watches the folder and reloads 100 ms after a change; a failed reload keeps the last good
  theme. Up to three warnings show in a notice.
- `packages/theme/src/css-urls.ts` removes remote URLs, `@import`, SVG and unsafe `data:` URLs and
  paths that leave the theme folder; a CSS escape outside a string refuses the whole sheet.
- Opening a `theme.css` or `theme.toml` that has its pair beside it offers to use the folder
  (`apps/desktop/src/theme/theme-document.ts`).

## A reader's own looks

Kept beside `config.toml` (`apps/desktop/src/look/store.ts`):

| File | Holds |
| --- | --- |
| `look.toml` | `on`, the look in use, the scheme mode, lean-back, rule switches, per-look tweaks (`[tweaks.<id>]`) and the reader's rules (`[[rule]]`) |
| `looks/<id>.look.toml` | one look of the reader's own: name, blurb, appearance, `[tone]`, `[type]`, `[faces]`, `[code.<lang>]` hues, `[palette.night]` and `[palette.day]` pinned colours, `[adapts]` rule switches |

Reading (`loadLooks`) clamps every number to its dial's range (size 12 to 40, leading 1.1 to 2.2,
measure 30 to 110, weight 200 to 800, ink 7 to 21 and so on), accepts colours only as `#rgb`,
`#rrggbb`, `rgba(…)` or `@role`, and accepts only safe values for shadows and extra tokens. A file that
does not parse makes the state fall back to defaults with a notice, and `look.toml` is not written
over for the rest of the session. Writes are atomic, debounced 400 ms and flushed on quit. Removing an
own look writes `removed = true` into its file.

## The Studio

`apps/desktop/src/studio/studio.ts` is the full-window editor for looks, opened from Look at the
foot of the rail.

| Part | File | Does |
| --- | --- | --- |
| Shelf | `shelf.ts` | every look as a row drawn in itself, dark then light, the reader's own first; hover or arrows preview, click or Enter chooses |
| Tone | `tab-tone.ts` | tone pad (warmth by lightness), ink contrast dial, accent hue strip; the pad refuses tones where no ink reaches 7:1 |
| Colours | `tab-colours.ts` | each pinned role as swatch, hex field and measured contrast; setting a colour pins it |
| Type | `tab-type.ts` | face, size, leading, weights, heading scale, face, style and capitals |
| Page | `tab-page.ts` | measure (45 to 80 characters), paragraphs (space or indent), alignment, figures |
| Code | `tab-code.ts` | how much colour in code, one palette or one per language, per-role contrast |
| Adapts | `tab-adapts.ts` | rule switches, a builder for the reader's own rules, how night is decided |
| File | `tab-file.ts` | the look as its `.look.toml`, live, with Copy |
| Canvas | `galley.ts`, `specimens.ts` | specimens of prose, code, data, a table, a log, a patch and a conversation in the look |
| Compare | `compare.ts` | a draggable seam between the look as it was when the Studio opened and now |
| Fit | `fit.ts` | two settings side by side; the reader picks the easier one until a look of their own results |

"Save as a new theme" (`saveAs` in `packages/theme/src/look-state.ts`) stores the look in use with the
reader's changes as `mine-<slug>`, with any moved pinned colours baked in.

## Colour per language

`packages/theme/src/lang-palettes.ts` gives eight languages their own hues for five roles (keyword,
type, string, number, decorator): Rust, Python, Go, TypeScript, JavaScript, SQL, shell and CSS (TSX,
JSX and SCSS alias to their parents). Related roles follow (`self` follows keyword, `builtin` type,
`escape` string, `constant` number); every other role stays shared.

- The hue is the language's; the lightness is solved per theme in OKLCH to clear 4.5:1 (7:1 under
  high contrast or More contrast) on every ground a code token can sit on.
- Rules are emitted as `:where([data-marxy-lang="<lang>"])`, so a theme's own language scope wins.
  A reader's `[syntax.<lang>]` colours in `config.toml` win over both.
- `[syntax] by_language = false` turns per-language colour off; `accent = false` turns off the
  language-name accent (`--marxy-lang`, from each language's Linguist colour, walked to 3:1).
- `apps/desktop/src/theme/lang-colour.ts` solves the sheet against the live page's grounds and
  re-runs when the variant, contrast or theme changes. With looks on, each pane gets
  `--marxy-pl-<lang>-<role>` solved on its own grounds and scaled by the look's code dial.

## Typesetting

`packages/typeset` sets prose paragraphs line by line in the DOM. `apps/desktop/src/view/rendered-view.ts`
attaches it (`startTypeset`) to the rendered article.

- **Line breaking** (`src/ragged.ts`, `breakRagged`): ragged-right total-fit breaking in the
  Knuth and Plass formulation, each line given the same stretch at its end, minimising the sum of
  (line penalty + badness)². A first pass without hyphens is kept when every line is within
  tolerance; otherwise a second pass allows hyphens. Defaults are `DEFAULT_RAGGED`.
- **Applying breaks** (`src/apply.ts`): a break is an empty `<span class="marxy-lb">` whose `::before`
  is a newline, a hyphenated break adds `marxy-hyphen`; generated content is not text, so selection,
  copy and find see the original characters. The text nodes a break falls in are replaced by new
  nodes holding the pieces (WebKit lays out a text node whose text changed at a cost that grows with the
  page below it); a paragraph holding the selection or a highlight, and every paragraph while a find
  is open, is split in place instead, so those ranges stay on their characters. A paragraph that overflows after setting is reverted;
  one with a piece wider than the measure may break after `/` inside inline code
  (`src/slash-break.ts`).
- **What is set**: `p`, `li` (without block children), `dd` and `figcaption` with byte provenance.
  Verse, paragraphs with inline objects, preformatted white space, right-to-left text, paragraphs
  over 16,384 characters and mostly-CJK text are left to the browser.
- **Hyphenation** (`src/hyphenate.ts`): English only (`en-us`, `en-gb` patterns from `justif`), chosen
  from the nearest `lang`. Words under six letters, words with digits, URLs and anything in code,
  `kbd` or maths are never hyphenated.
- **Hanging punctuation** (`src/hang.ts`): opening quotes hang their whole advance into the margin;
  some letters hang by a fraction.
- **Baseline grid** (`src/grid.ts`): the unit is half the body line box. Text blocks sit on it by
  CSS; `snapToGrid` pads tables, code blocks, images and display maths to whole units.
- **Wide content** (`packages/theme/src/base.css`, `render/wide-tables.ts` in the app): prose keeps its
  measure, while tables, monospace blocks and diagrams start at the text's left edge and may run to the
  pane's edge (less the gutter). A monospace line wraps there. A table wider than that runs through a
  column of words when at least 64 px of it shows, else ends at the last whole column; a column of figures (set to the end, or
  numbers, dates and sizes) is never cut through, and the side with more fades. A diagram keeps its drawn width and scrolls in its own box,
  its caption staying in view.
- **Scheduling** (`src/scheduler.ts`): paragraphs in view first. Then, as the page scrolls, what comes
  on screen is set before it paints, and as much of the margin around it (two screens) as 16 ms holds at
  what a paragraph has cost so far; the rest of the margin goes to the front of the idle queue, and
  one of those that reaches the screen first is set in that task. The rest
  are set in idle slices of about 8 ms, each taking as many paragraphs as that cost fits, one at least.
  While the reader is idle (for 400 ms no wheel, key, touch, press or scroll of theirs, and no pointer
  move that moved the pointer, which WebKit also reports when the page lays out under a still pointer;
  and the page shown) a slice may run to 24 ms, or what is left of the engine's idle period where it
  says, with up to 32 paragraphs: how many is learnt from what the last such slices took, with the
  layout after them. The first input after it gets small slices again.
  The screen is found by bisection over the article's own blocks, which stack down the page (a folded one stands where
  the next shown one does), a dozen layout reads however long the page; only the paragraphs inside the blocks it meets
  are each read, since paragraphs do not stack (the cells of one row), and so are those in a block out of the flow (a
  note in the margin), which can stand anywhere. The idle queue runs outward from the screen, one
  paragraph below, one above, by place in the document. The first pass tells the caller (`onPass`, with the paragraphs
  it set) whenever it set any; a later pass only when a set paragraph changed height; a caller
  that is throwing the page away calls `destroy({ discard: true })`, which reverts nothing (the view does, when a
  document is replaced or closed). The view answers a later pass that set paragraphs with the grid pass over the
  blocks holding them, and patches its block list from the first of them: those entries are read again and the
  ones below are moved by what they moved, so the cost follows what changed, not the length of the page.
  Blocks that changed height apart from one another (a highlight batch over hundreds of code blocks) are one grid
  pass, not one per block: every padding is undone, then every height and top read, then every padding written, so it
  lays the page out a handful of times however many blocks changed (31 ms for 400 such blocks at 250 KB, where a pass
  per block took 5.5 s). What is left at 1 MB (about 0.3 s for 1,600) is the engine laying out the whole article for
  each of those reads.
  A paragraph is set once; only font loads, resizes, theme changes, reloads and a change written into it
  set it again, never a scroll or the page at rest. The
  reader's place is held by the character under the reading line, not while the wheel, a key or a
  pressed pointer is moving the page.
- **Off switch**: `typeset = false` in `config.toml` (`--marxy-typeset: none`). Justified looks also
  turn it off for prose.

## Fonts

Font files are in `fonts/<family>/`, each folder with its upstream `LICENSE` (SIL OFL 1.1). Files are
never modified; `scripts/gate-font-attrs.mjs` checks their git attributes.

| Family | Files | Bundled |
| --- | --- | --- |
| Literata | variable roman and italic (TTF) | yes |
| Source Serif 4 | variable roman (TTF) | yes |
| Atkinson Hyperlegible Next | variable roman and italic (WOFF2) | yes |
| Inter | variable (WOFF2) | yes |
| JetBrains Mono | variable (TTF) | yes |
| IBM Plex Mono | regular (TTF) | no, kept in the tree only |

`apps/desktop/src/fonts/files.mjs` (`FONT_FILES`) is the manifest; `fonts.css` holds the
`@font-face` rules; the Vite plugin `bundleFonts` in `apps/desktop/vite.config.ts` copies the files
and their licences into the build, preloads the roman, sans and mono faces and inlines the
`@font-face` rules into `index.html`. The chrome uses the system UI face.

## Tests and scripts

| Command | Checks |
| --- | --- |
| `pnpm --filter @marxy/theme test` | the default-theme lint, the look engine (floors by day and night, random dials, rules, schemes, own looks), shipped themes resolving to their pins, config parsing and byte-preserving edits, the loader's clamps and URL sanitising, sheet drift, language palettes on every ground, and WebKit layout checks (grid, measure, list marks, tables) |
| `pnpm --filter @marxy/typeset test` | the breaker (fit, badness, hyphen costs), hyphenation, hanging, and WebKit checks that setting keeps text selectable and findable, holds the reader's place and keeps blocks on the grid |
| `node scripts/gate-contrast.mjs [--md]` | every bundled sheet, variant, kind scope and look against the floors |
| `node scripts/check-tokens.mjs [--write]` | the token contract |
| `node packages/theme/scripts/write-theme-sheets.mjs --check` | generated sheets match their looks |

Desktop tests for this area are in `apps/desktop/test/` (`look`, `island-look`, `studio-*`,
`lang-palettes`, `lang-scope`, `user-theme`, `bundled-themes`, `contrast`, `fonts`, `frame-fonts`).
The study tools in `packages/typeset/scripts/` (`measure-rag.mjs`, `measure-rendered.mjs`,
`rag-model.mjs`, `font-metrics.mjs`) measure rag and font metrics over the corpus and print tables.
