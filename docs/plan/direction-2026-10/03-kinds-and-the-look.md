# Kinds and the look

**In short.** Every file Marxy opens is of some *kind*: prose, a README, a report, a transcript, code,
data, a log, a diff, a folder. A kind has a *profile*: how it is set, which colours a theme gives
it, what Read does with it, and which depth it opens in. Kinds are detected from the file's bytes,
its path and the reader's own rules, never from who or what wrote it. The look comes from Galley:
its role-based tokens and its eight audited themes, brought into the `--marxy-*` contract, with one
structural addition, that a theme can restyle any kind by re-scoping the same tokens. Galley's theme
editor and the inspector's Look tab then turn the theme into a playground.

## Kinds

### The first kinds

AI prose is one kind, `report`, beside the others. None of the kinds is "AI": a plan a person writes
by hand is a `report`, and a transcript is a transcript whether it came from a chat tool or a
meeting.

| Kind | Typical files | Read does | Opens in |
| --- | --- | --- | --- |
| `prose` | `.md` by default | Typeset as today | Read |
| `readme` | `README*`, `CONTRIBUTING*` | Typeset in the README profile; the badge row collapses to one muted line (research) | Read |
| `report` | Plans, handoffs, specs, audits: Markdown shaped as a working document | Typeset in the report profile: sans, wider measure, tables and inline code given room | Read |
| `transcript` | Markdown with speaker headings; JSONL session logs | Speakers outdented, tool calls one line at rest; for JSONL a derived, read-only view with provenance to the line (research, `reader-artifacts/10-spec.md`) | Read for Markdown; for JSONL, Read when a reader rule says so, else Source |
| `code` | Source files by extension or shebang | A typeset listing: no caret, line numbers hung in the margin and never copied, selection by line and symbol | Source (as today) |
| `data` | `.json`, `.jsonl` (non-transcript), `.yaml`, `.toml`, `.csv`, `.tsv` | Verbatim, with a summoned depth lens for long structures and a table lens for CSV and TSV | Source |
| `log` | `.log`, `.out`, terminal captures | Level words in weight 700, timestamps in the comment colour, ANSI escapes shown as `␛` (research); follows the tail when append-only ([04](04-capture.md)) | Read |
| `terminal` | Shell sessions and console captures: `.term`, `.session`, `console` and `shellsession` fences, text with prompt lines | Prompts in the punctuation colour, commands in strong text, output plain, each command and its output grouped; ANSI escapes shown as `␛`, never interpreted. Tools: copy commands only (prompts stripped), copy output only | Read |
| `diff` | `.diff`, `.patch` | Unified, markers kept, line tints as a second channel (research) | Read |
| `html` | `.html`, `.htm` | Later: sanitised render on the trust path Marxy already has for HTML in Markdown | Source |

Later kinds, from Galley's list and the research: `book` (paged, small-caps openings, scene breaks),
`docs`, `changelog`, `notes`, verse, screenplay. Each is one profile and, at most, one Read
treatment.

### Detection

Signals add up, the strongest wins, and the reasons are kept for the kind chip's menu and the inspector's Info tab.

| Signal | Points to |
| --- | --- |
| A reader rule matching the path (first match wins) | Whatever it says, always |
| Extension, file name (`README`, `CHANGELOG`), shebang | `code`, `data`, `log`, `diff`, `readme` |
| JSONL whose lines are objects with a role or message type | `transcript` |
| Markdown with `User` / `Assistant` (or similar) speaker headings | `transcript` |
| Markdown dominated by task lists and working headings (Summary, Context, Risks, Next steps, Open questions) | `report` |
| Nothing stronger | `prose` |

**Not a signal:** `generated_by`, `model`, `session`, `author` or any other front-matter field that
says who wrote the file. Galley detects reports by them; Marxy does not, because a kind is about
how a text is read, not where it came from, and because lifting authorship out of front matter is
how tagging metadata starts.

**Reader rules** live in `config.toml`, the reader's own file:

```toml
[[kind]]
glob = "~/.claude/plans/**/*.md"
is = "report"

[[kind]]
glob = "~/.claude/projects/**/*.jsonl"
is = "transcript"
read = true          # open in Read, not Source

[[kind]]
glob = "**/*.log"
is = "log"
```

The kind chip's *always open this folder as* writes these on request ("set this kind for this folder"), appending one table
without touching another byte, the way "Add this folder" appends to `collection.toml` (C-03). A
per-file choice is observed state and lives in Marxy's own data files, like reading positions.

### Profiles

A profile is a set of token values. Galley's per-kind table is the starting point, fitted to Marxy's
baseline grid (every line box a whole even number of pixels, so the half-line grid unit is a whole
pixel, ADR-0030). Each value is checked against `reader-typography/07-content-types.md` by the story
that applies it, and a departure is written down.

| Kind | Face role | Size / line box | Measure | Paragraphs | Notes |
| --- | --- | --- | --- | --- | --- |
| `prose` | serif (Literata) | 20 / 30 | 66 | space, half a line | Today's default theme, unchanged |
| `readme` | readme sans (Inter) | 16 / 26 | 84 | space | Forge conventions beat novelty (Galley) |
| `report` | sans (Atkinson Hyperlegible Next) | 17 / 26 | 74 | space | Ragged, no hyphenation: identifiers and paths must not break |
| `transcript` | sans | 16 / 26 | 76 including the speaker column | space within a turn, a line between turns | Speaker label outdented, small capitals |
| `code` | mono (JetBrains Mono) | 16 / 26 | as authored | — | Never reflowed, ligatures off |
| `data` | mono; sans with tabular figures in the table lens | 15 / 24 | as authored | — | Numbers right-aligned in the lens |
| `log` | mono | 15 / 24 | as authored | — | Wrap with a 2ch hang (ADR-0033); a scroller stays a proposal |
| `terminal` | mono | 15 / 24 | as authored | half a line between commands | Command in weight 600 |
| `diff` | mono | 16 / 26 | as authored | — | Markers in the text, tints behind |

Galley's coupling rules come with the profiles, enforced by Marxy rather than trusted to themes: the
measure follows the face and size (the column is recomputed from the measured average advance);
no justification below 45 characters; letter spacing drags word spacing; script leading floors; in
code, data, logs, diffs and verse only size and face may change; dark grounds keep generous sizes and
lighter weights.

**Wide blocks.** Code blocks and tables keep to the column's measure, aligned with the text. A
code block never widens: its long lines scroll inside it. A table that fits sits in the column; one
whose natural width exceeds the measure breaks out, symmetrically about the column, up to the
width of the page, and scrolls inside beyond that (the symmetric overflow lane L already ruled on).

## The look

### What Marxy adopts from Galley

- **The palette.** Role-based colours: grounds, four text roles, three edge strengths, an accent
  family, selection and find marks, status colours with washes, ten code-token roles, diff washes.
  Today Marxy has 18 colour tokens and no surface or status roles; Galley's roles are what make its
  summoned surfaces and notices look finished.
- **Eight audited themes**, paired into Marxy's dark-and-light theme directories:

  | Theme directory | Dark | Light |
  | --- | --- | --- |
  | `default` | Night | Paper |
  | `ink` | Ink | — |
  | `warm` | Dusk | Sepia |
  | `fjord` | Fjord | — |
  | `high-contrast` | HC dark | HC light |

  Today's warm near-black (`#151412`) becomes the reference that `warm` is checked against. The author ruled Night
  as the default dark theme, with Paper for light; Ink keeps its own directory.
- **Type sets as roles:** a serif, a sans, a README sans and a mono, each a token a theme sets.
  Galley's *Classic* set (Literata, Source Serif 4, Atkinson Hyperlegible Next, Inter, JetBrains
  Mono) is the default. *Plex*, *Hyperlegible* and *System* are themes of a few lines each. All of
  these faces are under the SIL Open Font Licence, as Literata already is (ADR-0006).
- **Weight by ground:** lighter body text on dark (370 to 380) than on light (400), as Marxy already
  does, with the high-contrast themes heavier.
- **Chrome styling for summoned surfaces:** the platform face at 13 px for controls, raised surfaces
  with the theme's shadow, radii of 6, 9 and 13 px. It applies to the palette, the verb menu,
  notices and the whole unfolded workspace, and never to the text being read.
- **The contrast audit as a gate:** body text 7:1 on its ground, secondary text and every code token
  4.5:1 on every ground they appear on (including under a selection), control edges 3:1, computed
  unrounded with translucent colours composited first. Galley's `audit_contrast.py` (copied into
  [galley/](galley/audit_contrast.py)) becomes `scripts/gate-contrast.mjs`, run over every bundled
  theme, variant and kind scope.

What Marxy keeps of its own, where Galley is silent or weaker: the baseline grid with zero drift,
owned Knuth–Plass line breaking, hanging punctuation, "space belongs above", hierarchy from size and
weight only, and Marxy's heading weights (560/580) unless a taste review overturns them.

### Token contract v2

Galley's roles mapped onto `--marxy-*` names. *Exists* means the token is in contract v1 today;
*new* comes with contract v2 (ADR-0059). Galley's window and sidebar grounds (`--win`, `--side`)
and its layout sizes (`--side-w`, `--tb-h`, `--sb-h`) have no counterpart, because Marxy has no
window chrome to colour.

| Galley | Marxy | |
| --- | --- | --- |
| `--doc` | `--marxy-color-bg` | exists |
| `--raised` | `--marxy-color-surface` (palette, menus, workspace panels) | new |
| `--inset` | `--marxy-color-code-bg` | exists |
| `--fg`, `--fg-muted` | `--marxy-color-text`, `--marxy-color-text-secondary` | exist |
| `--fg-strong`, `--fg-faint` | `--marxy-color-text-strong`, `--marxy-color-text-faint` | new |
| `--line`, `--line-strong` | `--marxy-color-rule`, `--marxy-color-rule-strong` | exists, new |
| `--edge` | `--marxy-color-edge` (control boundaries, 3:1) | new |
| `--accent`, `--accent-strong`, `--accent-fg`, `--accent-wash` | `--marxy-color-accent` and three new siblings | exists, new |
| `--sel` | `--marxy-color-selection` | exists |
| `--mark`, `--mark-edge` | `--marxy-color-find`, `--marxy-color-find-edge` | exist |
| `--ok`, `--warn`, `--err`, `--info` and washes | `--marxy-color-status-*` (for notices; always with a word, never colour alone) | new |
| `--tk-comment`, `keyword`, `string`, `constant`, `type`, `punct` | `--marxy-tok-*` of the same meaning | exist |
| `--tk-def` | `--marxy-tok-function` | exists |
| `--tk-marker`, `--tk-heading`, `--tk-link` | `--marxy-tok-marker`, `--marxy-tok-heading`, `--marxy-tok-link` (Markdown in Source) | new |
| `--add-wash`, `--del-wash` | `--marxy-color-diff-*` | exist |
| `--shadow`, `--glass` | `--marxy-shadow-surface`, `--marxy-color-surface-glass` | new |
| `--text-wght`, `--strong-wght`, `--head-wght` | `--marxy-weight-body`, `-strong`, `-heading` | exist |
| `--face-book`, `--face-sans`, `--face-readme`, `--face-code` | `--marxy-face-book` (named `-serif` until ADR-0059), `--marxy-face-sans`, `--marxy-face-readme`, `--marxy-face-mono` (roles; `--marxy-font-text` and siblings point at one of them; ADR-0059 adds `--marxy-face-article`) | new |
| `--face-chrome`, `--chrome-size` | `--marxy-face-chrome`, `--marxy-size-chrome` | new |
| `--k-*` per-kind tokens | none: a kind re-scopes the existing tokens | — |

The last row is the structural choice. Galley invents a second family of `--k-*` tokens for per-kind
typography. Marxy does not need one: a kind is a scope, and inside it a theme sets the same
`--marxy-*` tokens to different values. The contract grows by about twenty colour and face roles,
not by a copy of itself per kind.

### Themes can restyle any kind

The pane root carries `data-marxy-kind`, a new name in `scripts/registry.json`. A theme file sets
defaults on `:root` and overrides per kind:

```css
/* ~/.config/marxy/themes/mine/theme.css */
:root {
  --marxy-color-bg: #14181b;
  --marxy-color-text: #d7dde0;
  --marxy-face-sans: "Atkinson Hyperlegible Next";
}

[data-marxy-kind="report"] {
  --marxy-font-text: var(--marxy-face-sans);
  --marxy-size-body: 17px;
  --marxy-line-box: 26px;
  --marxy-measure-chars: 74;
}

[data-marxy-kind="log"] {
  --marxy-color-bg: #0b0b0c;            /* logs on true black */
  --marxy-tok-comment: #868d94;         /* timestamps */
}

[data-marxy-kind="prose"][data-marxy-variant="light"] {
  --marxy-color-bg: #f6efe0;            /* essays on sepia, only in light */
}
```

Everything system-owned stays system-owned (`docs/theme-contract.md`): the line breaker, grid
snapping, and the measure computed from the face's measured average advance. A kind scope can set
the line box, never the multiples. The validator clamps per kind exactly as it clamps today, and the
contrast gate runs per kind scope.

### Per-language colour

Code is coloured per language as well as per theme. By default each language takes its brand
colour, from GitHub Linguist's language table (MIT): Rust's copper, TypeScript's blue, Python's
blue, Go's cyan, Shell's green, and so on.

- The brand colour sets `--marxy-lang` on any element carrying `data-marxy-lang` (a rendered code
  block, the Source editor, a file row). It tints the kind icon of a code file, and the definition
  and keyword tokens of that language.
- The hue is the brand's; the **lightness is the theme's business**. Each tinted token is walked in
  OKLCH lightness, keeping the hue, until it passes 4.5:1 on the code ground of the current theme
  and under a selection. A brand colour that cannot pass at any lightness falls back to the theme's
  token.
- A theme can override any language's tokens (`[data-marxy-lang="rust"] { --marxy-tok-function: … }`).
  On the theme page they are edited in the **Syntax** tab, which has two levels. *All languages*
  holds the theme's defaults (highlighting full, minimal or off; comment italic and tone; bold
  definitions; brand tint and its strength) and the language list, each row showing its six token
  colours. *One language* holds the source of its colours (theme, brand or custom) and a row per
  token role. Each role's colour is chosen in an OKLCH picker whose lightness track shades the range
  that would fail contrast on this theme, so the reader sees the passing range before choosing. The
  preview is linked both ways: hovering a role highlights its tokens in a real specimen file, and
  clicking any token in the preview opens its role's picker.

### Kind icons

The sidebar, tabs, palette and library mark each file with its kind. Galley's icons are file
outlines with a small symbol inside, which blur together at 14 px. Marxy's are one glyph per kind,
drawn for 14 to 16 px with a 1.5 px stroke and no page outline: a short-last-line paragraph for
prose, a heading bar for a report, an open book for a README, `</>` for code (in the language's
colour), `{ }` for data, ticked lines for a log, `>_` for terminal output, two speech marks for a
transcript, `±` for a diff, a folder, and a branch for a repository.

### Themes are a playground

Galley's theme surfaces are kept and reorganised. Left to right: the theme list, the selected theme's
controls, and a full-size **page preview** of a real document in that theme, with a kind switcher
(report, essay, code, log, data, transcript) above it. There is no gallery or compare mode. The
list is where the reader decides what each appearance uses: a **Dark** section ("used when macOS is
dark") and a **Light** section, each with a check on the theme in use. Selecting a row only previews
it; *Use for Dark* (or Enter) makes it the one in use. Hover, selected and in use are three distinct
states that are never confused. Theme rows carry a name and a swatch and no description, and
contrast results appear only when something fails. The adjustments, the editor with its blocking
audit, and import from VS Code and Base16 stay.

- **Themes are documents** (ADR-0008). Galley's editor writes a theme directory under
  `~/.config/marxy/themes/<name>/`, never a hidden store, and *Open theme file* shows it in the
  workspace like any document.
- **Split view** (Phase D) puts the theme file beside the document it styles, and **live reload**
  (F-16) repaints on every save, so a reader who prefers to type CSS has the playground for free.
- **Editing is transformation** (ADR-0004): a slider or swatch change in the editor or the Look tab is
  a one-line splice of the theme file, with one undo step.
- The bundled themes are read-only. The first edit offers to copy one into the reader's themes
  folder and set `theme =` in `config.toml`, so Marxy writes beside the original, never over it.

### The Look tab

The inspector's Look tab is Galley's typography panel (Galley `03-content-modes.md`) for the open
document's kind:

- **Type:** face role, size, line box, measure, paragraph space or indent, hyphenation,
  justification. A slider that would break a coupling rule stops and says which.
- **Colour:** the roles this kind uses, with swatches. A failing value shows the failing pair and
  offers the nearest passing colour of the same hue (Galley's OKLCH lightness walk). A passing value
  shows no badge.
- **Colophon:** face, size and line box, and the measured average characters per line.
- **Save for this kind**, which writes the values into the theme's block for this kind.
