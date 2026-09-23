# Reader Typography Handbook: the research Marxy's typography follows

This is a twelve-chapter handbook on setting text for long reading on screens. It covers open-source
reading fonts, spacing and measure, Knuth–Plass line breaking and hyphenation, code and syntax
highlighting, conventions by content type, multilingual layout, and colour and accessibility. Every
empirical claim carries an evidence grade: **[A]** replicated or meta-analysed, **[B]** one good
study, **[C]** small or mixed studies, **[D]** expert convention, **[X]** contested. It was
researched and measured for Marxy's author on 2026-09-23.

**It is the typography authority.** It supersedes every earlier taste decision, fonts included
(ADR-0033). When a design document disagrees with it, the research wins and the document is fixed.
A typographic change cites the chapter it follows, or says why it departs.

## Read it

If you want the answers, start with [10 · Spec](10-spec.md): every default, the range a reader may
change it within, the rules that couple settings together, and how to verify an implementation.

| Chapter | What it settles |
| --- | --- |
| [00 · Orientation](00-orientation.md) | What the handbook covers, how claims are graded, what was measured |
| [01 · Pipeline](01-pipeline.md) | How text becomes pixels; choosing a stack; engine behaviours the measurements exposed |
| [02 · Evidence](02-evidence.md) | The reading research, graded: size, line length, spacing, polarity, justification |
| [03 · Fonts](03-fonts.md) | Open reading fonts, licences and Reserved Font Names, measured metrics for 48 families |
| [04 · Spacing and layout](04-spacing-layout.md) | Size, measure, leading and paragraphs as one system; margins; scroll versus pages |
| [05 · Line breaking](05-line-breaking.md) | Knuth–Plass against first-fit and Chromium, measured; hyphenation; protrusion |
| [06 · Code](06-code.md) | Highlighting engines, contrast of 18 published themes, code typography, wrap versus scroll |
| [07 · Content types](07-content-types.md) | What each genre must preserve and what a reader may adapt |
| [08 · Multilingual](08-multilingual.md) | CJK, Arabic, Hebrew, Indic and Southeast Asian scripts |
| [09 · Colour and access](09-color-access.md) | WCAG requirements, polarity, dark themes, low vision, dyslexia |
| [10 · Spec](10-spec.md) | **The answers** |
| [11 · Sources](11-sources.md) | The source ledger, with notes on what each source does and does not show |

## How Marxy applies the spec

The status of each line of [10 · Spec](10-spec.md) ("Defaults and ranges" and "Coupling rules") in
Marxy. An **Applied** line is enforced by the named test or gate. An **Open** line is listed in
ADR-0033 under "What the research asks that this does not yet do". Keep this table current: a PR
that applies an open line updates its row here.

| Spec line | Marxy | Status | Where |
| --- | --- | --- | --- |
| Text face: Literata | Literata, bundled unmodified with every feature | Applied | ADR-0015, ADR-0033 §10 |
| Sans offered: Atkinson Hyperlegible Next | — | Open | ADR-0033 |
| Size 20px desktop, 75–250 % range | 20 px; config 15–50 px | Applied | `tokens.css`, `config.ts` |
| Match x-heights across faces | Code 18 px matches Literata 20 within 3 %; no second text face yet | Applied for code | aesthetics gate "code voice" |
| Measure 66 average characters, 45–80 | 66 × measured 0.463 em; clamped 45–80 | Applied | `grid.test.mjs`, aesthetics gate check 2 |
| Measure unit: average character, never `ch` | `--marxy-measure-chars × --marxy-avg-char` | Applied | ADR-0033 §1 |
| Line height 1.5, unitless | 30 / 20 px on a grid of 15 | Applied | ADR-0030, ADR-0033 §2 |
| Paragraphs: space for documentation | Half a line between paragraphs | Applied | ADR-0030 |
| Letter and word spacing: font default | Default; code never spaced | Applied | `base.css` |
| Reader spacing controls with coupling | — | Open | ADR-0033 |
| Ragged right, hyphenated | Knuth–Plass ragged, TeX hyphenation costs, patterns shipped | Applied | ADR-0007, ADR-0033 §9, `ragged.test.ts` |
| Justification only at ≥ 45 characters, emergency stretch | Justification not wired | Open | ADR-0033 |
| Theme: dark and light, designed separately | Dark primary, light designed | Applied | ADR-0024 |
| Dark-theme weight lighter | 380 / 560 dark, 400 / 580 light | Applied | `tokens.css`, `theme.css` |
| Body contrast ≥ 7:1; every token ≥ 4.5:1, including on highlights | 14.5 / 16.2 body; tokens ≥ 5.0 on every surface | Applied | `grid.test.mjs`, `05-theme.md` §Palettes |
| Code: mono, no ligatures, highlighted, authored width | JetBrains Mono, `calt` off, Shiki in a worker, breakout to 100 columns, marked wrap | Applied | ADR-0033 §4–8 |
| Restrained highlighting, comments not dimmed | Strings, literals, comments, names only | Applied | ADR-0033 §4 |
| Never guess a language | Fence id or plain | Applied | `highlight.ts` |
| Script rules (no tracking in cursive and Indic scripts; leading floors) | No heading tracking in those scripts; floors open | Partial | `base.css`, ADR-0033 |
| Notes as pop-ups or margin notes | Endnotes | Open | ADR-0033 |
| Verification: contrast, measure, line breaking | Aesthetics gate | Applied | `scripts/gate-aesthetics.mjs` |
| Verification: 1.4.12 text spacing, 320 px reflow, forced colours, font features | — | Open | ADR-0033 |

## Files

| Path | What it is |
| --- | --- |
| `NN-*.md` | The chapters as GitHub Markdown, with every measured table filled in. **Generated; do not edit.** |
| `source/NN-*.md` | The chapters as written, in the handbook's template markup (front matter, `{{A}}` grades, `(@slug)` links, `<!--DATA:…-->` tables, `!!!` callouts) |
| `source/to-gfm.mjs` | Builds the chapters from `source/`: `node docs/research/reader-typography/source/to-gfm.mjs` |
| `source/build.py` | The original build of the published HTML edition, kept for provenance (its paths are the author's Windows machine) |
| `lab/data/metrics.json` | Per face: average character width, `ch` width, x-height, cap height, `line-height: normal`, advances across optical sizes |
| `lab/data/linebreak.json` | First-fit, Knuth–Plass and Chromium line breaks over 160 configurations |
| `data/themes.json` | Token contrast for 18 published code themes |
| `lab/*.html`, `lab/kp.js` | The measurement pages and the Knuth–Plass implementation behind the numbers |

The lab measured Google Fonts copies in Chromium 152. Marxy re-measures what it depends on in WebKit
with its own bundled files. For Literata that gives an average character of 0.463 em against the
lab's 0.460, and an x-height of 0.508 against 0.507. The HTML edition was published as a set of
private Claude artifacts; this folder is the durable copy, and nothing here depends on those links.
