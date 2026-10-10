# Theme contract

A theme is a directory (ADR-0008):

```
my-theme/
  theme.toml      # name, author, contract = 2, variants = ["dark", "light"]   (dark first: it is primary, ADR-0024)
  theme.css       # declarative CSS; layout only through --marxy-* tokens
  fonts/          # optional, bundled, licences preserved
  LICENSE
```

No JavaScript, no network, no conditional logic, no AST access. Boundary, not backlog.

## Theme-owned (set freely)

Colour (text, background, accent, links, code tokens); families for body, headings, code;
base size; the measure within 45–80 average characters (`--marxy-measure-chars`, with
`--marxy-avg-char` set for the theme's text face, ADR-0033); the grid unit (`--marxy-line-box`); scale ratio;
rules and dividers; code-block and blockquote presentation; light and dark variants; an
optional 1 px progress rule.

## System-owned (themes cannot override)

The line-breaking algorithm; baseline-grid snapping (themes set the unit, Marxy computes
every vertical space as a multiple of it); reserved image dimensions; hanging punctuation and
hyphenation behaviour; Rendered-mode immutability; that the progress rule never steals a
line of the measure or becomes a seeker.

## Tokens

The full list is `packages/theme/src/tokens.css` (version 2; the v1 names are unchanged). ADR-0033 added
`--marxy-measure-chars` and `--marxy-avg-char`, with defaults. The token names, units and
meanings are frozen and need an ADR; the default theme's values are taste and need a story
with a taste-review queue row. That is the guarantee a theme author gets (ADR-0031): the
names, the units and the meanings, not 30px. Its `:root` values are the **dark** variant
(ADR-0024); the default theme's light block overrides them under
`[data-marxy-variant="light"]`. Tokens may be *added* within version 1 when they carry a
default (ADR-0024 added the find, notice and code-token colours; ADR-0055 added `--marxy-color-find-edge`); a theme that does not set
them renders with the defaults.
The shape:

```css
:root {
  --marxy-line-box: 30px;        /* the body line; the grid unit is half of it */
  --marxy-measure-chars: 66;     /* average characters per line, 45–80 */
  --marxy-avg-char: 0.463;       /* the text face's average advance, em: measure it for your face */
  --marxy-measure: calc(var(--marxy-measure-chars) * var(--marxy-avg-char) * 1em);
  --marxy-size-body: 20px;
  --marxy-scale-ratio: 1.25;
  --marxy-font-text: "Literata";
  --marxy-font-heading: var(--marxy-font-text);
  --marxy-font-mono: "JetBrains Mono";
  --marxy-weight-body: 400;
  --marxy-weight-heading: 600;
  --marxy-color-text: #1a1a1a;   /* … and the rest of the colour set */
}
```

**Give theme authors the variables, not the declarations.** A theme that wants roomier text
sets a larger line box and everything follows. A theme that changes the text face measures its
average character (the mean advance of English prose, in em) and sets `--marxy-avg-char`, or its
column will not hold the character count. Never set a measure in `ch`: a `ch` is the digit zero,
which in most faces is 13–58 % wider than an average character.

## Measuring a face (H-06)

`--marxy-avg-char` is a measurement, not a taste. `apps/desktop/src/theme/measure-face.ts` makes it: it
waits for the loaded face, sets a fixed sample of English prose (`MEASURE_SAMPLE` in
`packages/core/src/layout/average-advance.ts`, the opening of *Pride and Prejudice*) on a canvas, and answers
the width of one character in em. It runs after first paint, never on the first-text path, and remembers
each face, weight and size it has measured.

- **Measure at the size the face is set at.** A face with an optical-size axis (Literata, Source Serif 4)
  is drawn narrower as it grows, so its number depends on the size; a face without one gives the same
  number at any size. Pass the body size (the default is 20 px).
- **Kerning is in the number.** The canvas and the typesetter both kern, so the measured value is a
  little under the sum of the `hmtx` advances (`packages/typeset/scripts/font-metrics.mjs`, no kerning):
  Literata by about 1.4 %, the others by under 1 %. Use the measured number, not the table's.
- **The loader tells, and does not rewrite.** `avgCharWarnings` (`@marxy/theme`) compares a theme's
  declared `--marxy-avg-char` with the measured value for its text face and warns when they are more than
  3 % apart, naming the theme, the face and both numbers. A face that cannot be measured (not loaded) is silent.

## Contract v2 (ADR-0059): shipped

`tokens.css` declares the names below and the loader speaks `contract = 2` (H-03). H-04 sets Night's and
Paper's values. No v1 name, kind or meaning changed. Each new name is declared in `tokens.css` as `var()` of
the v1 token in brackets, so a contract-1 theme keeps rendering as it does today and loads with a warning that
its contract-2 roles use their fallbacks. A contract-2 theme that leaves a colour role unset in a variant also
loads, with a warning naming each unset role. A contract above 2 keeps the old "may not look as intended" warning.

- **Colour** (`colour`): `--marxy-color-surface` (`-notice`), `-surface-glass` (`-surface`),
  `-text-strong` (`-text`), `-text-faint` (`-text-secondary`), `-rule-strong` (`-rule`), `-edge`
  (`-text-secondary`), `-accent-strong` (`-accent`), `-accent-fg` (`-bg`), `-accent-wash`
  (`-selection`), `-status-ok`, `-status-warn`, `-status-err` (`-text`), `-status-info` (`-accent`),
  `-status-ok-wash`, `-status-warn-wash`, `-status-err-wash` (`-notice`); `--marxy-tok-marker`
  (`-tok-punctuation`), `--marxy-tok-heading` (`-color-code-text`), `--marxy-tok-link` (`-color-link`).
- **Shadow** (`keyword`): `--marxy-shadow-surface` (`none`).
- **Face roles** (`family`): `--marxy-face-book`, `-article`, `-sans`, `-readme` (`--marxy-font-text`),
  `--marxy-face-mono` (`--marxy-font-mono`). The v1 families become the slots a kind points at a role.
- **Chrome**: `--marxy-face-chrome` (`family`, `system-ui, sans-serif`), `--marxy-size-chrome`
  (`length`, `13px`). The theme sets only the default; the reader's `chrome_size` (11–26 px) wins.
- **The kind scope**: inside `[data-marxy-kind="<kind>"]` on the pane root a theme sets the same
  `--marxy-*` names; there is no `--k-*` family. Surfaces, the shadow, chrome, dividers, the progress
  rule and `--marxy-typeset` are global only. A kind sets sizes and line boxes only as multiples of
  the reader's values (a unitless ratio or `em`, never px), so the reader's size wins; the line box is
  rounded to an even whole pixel, the grid stays half of it, and the multiples stay Marxy's.
- **What the loader does in a kind scope**: clamps `--marxy-measure-chars` to 45–80 as on `:root`; drops
  a global-only name, `--marxy-measure` and the system-owned names with a warning naming the name and the
  kind; compiles a ratio for a size to `calc(<ratio> * var(--marxy-root-size-body))` (the root copies
  `--marxy-root-size-*`, `--marxy-root-line-box*` and `--marxy-root-lh-*` are Marxy's, declared on `:root`;
  a theme that sets one has it dropped), within the range the `:root` value is held to; rejects an absolute
  length for a size, naming token and kind. A pane's own measure takes effect because the computation is
  repeated on `[data-marxy-kind]` in `base.css`.
- **Slots and roles**: `--marxy-font-text: var(--marxy-face-sans)` on `:root` without `--marxy-face-sans`
  set there refers back to itself, so the loader refuses the theme and names the slot; inside a kind scope
  it is valid.
- **Per language**: inside `[data-marxy-lang="<id>"]` a theme sets only `--marxy-tok-*`; Marxy owns
  `--marxy-lang`.

The meanings and the contrast floor each colour role must meet are in ADR-0059.

## Diff colours (ADR-0036)

Four tokens tint added and deleted lines in diff fences. The `+`, `-` and space marker stays
plain text and is the primary cue; the tint is a second channel only.

| Token | Role |
| --- | --- |
| `--marxy-color-diff-add` | background for a fully added line |
| `--marxy-color-diff-del` | background for a fully deleted line |
| `--marxy-color-diff-add-word` | background for an added span within a line |
| `--marxy-color-diff-del-word` | background for a deleted span within a line |

`:root` in `tokens.css` holds the dark defaults; the default theme's light block overrides them
under `[data-marxy-variant="light"]`. Every pair must meet the typography handbook's
contrast floor on its tint (ADR-0035); `gate:aesthetics` walks every declared tint background
against every foreground token in both variants (MARXY-241), which is why the light overrides
land alongside the tokens rather than waiting on MARXY-235, which applies them to rendered diffs.

## Re-layout triggers

Font load, resize, theme switch or theme file change, reader adjustment of size or measure.
All four re-run typesetting; forgetting one looks like a bug in the line breaker.

## Supported CSS baseline

WebKitGTK 2.50+, WKWebView on macOS 26+, WebView2 (later). Write against WebKit; do not rely
on Chromium-only properties; `@supports` anything newer than Safari 17. Theme issues on
engines below the baseline are not Marxy bugs. A theme linter that flags out-of-baseline
properties is v1.1.

## Security

Enforced by CSP, not documentation: no `url()` fetches beyond the theme's own bundled
assets; no `@import` from the network. See ADR-0009.
