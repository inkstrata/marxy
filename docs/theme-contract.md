# Theme contract

A theme is a directory (ADR-0008):

```
my-theme/
  theme.toml      # name, author, contract = 1, variants = ["dark", "light"]   (dark first: it is primary, ADR-0024)
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

The full list is `packages/theme/src/tokens.css` (version 1). ADR-0033 added
`--marxy-measure-chars` and `--marxy-avg-char`, with defaults. The token names, units and
meanings are frozen and need an ADR; the default theme's values are taste and need a story
with a taste-review queue row. That is the guarantee a theme author gets (ADR-0031): the
names, the units and the meanings, not 30px. Its `:root` values are the **dark** variant
(ADR-0024); the default theme's light block overrides them under
`[data-marxy-variant="light"]`. Tokens may be *added* within version 1 when they carry a
default (ADR-0024 added the find, notice and code-token colours); a theme that does not set
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
