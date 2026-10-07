# Conformance: the page measured against the spec

*Where Marxy's page meets the handbook and where it does not, line by line, with a number or a
file:line for each. It judges the seven layout hypotheses of the October roadmap's lane L, fills the
conformance table that lane asked for, and records the lab probes behind both. Written by hand for
story L-01; unlike chapters 00 to 11 it is not generated from `source/`.*

**Measured against** `a7cde730` (`origin/main` on 2026-10-07). The geometry comes from the L-00 probe as
L-00.1 ran it. The slice this page cites is copied to a stable path, `lab/data/layout-probe.json`
(by `lab/layout/slice-probe.mjs`), and cited below as `probe:` and a key under `headlines`,
`rankings*` or `documents`. The full kit it was generated into, with block lists and contact
sheets, is the dated `docs/taste-review/2026-10-layout-audit/`, which a later run regenerates.
The rest comes from the lab beside this chapter (`lab/layout/run.mjs`, writing
`lab/data/layout.json`, cited as `lab:` and a key). Two stories that merged while this was written
are counted where a row says so: L-06 (Source looks,
[#383](https://github.com/inkstrata/marxy/pull/383)) and L-10 (code on the grid at every size,
[#378](https://github.com/inkstrata/marxy/pull/378)). File:line references are to `main` after L-10,
which moved `base.css` from line 256 on down by one. The engine is Playwright's WebKit on macOS;
WebKitGTK was not available to measure, and every row that depends on it says so.

**Three words.** *Applied*: the code does it and a test or gate holds it, or the measurement shows
it holding. *Open*: it does not do it yet. *Contradicted*: it does something the spec line says is
wrong, either by accident or by a recorded decision (named).

The fix stories are the lane L cards in `docs/plan/roadmap-2026-10/07-layout-and-reading.md`. This
chapter is a one-off record, not a ledger: a story that changes a row cites the row, it does not
edit it. The status column of `README.md` ("How Marxy applies the spec") is older than this page;
where they differ, this page is the measurement.

## 1. The seven hypotheses

| | Hypothesis | Verdict | The number | Cause | Card |
|---|---|---|---|---|---|
| H1 | Wide blocks grow to one side only | **Confirmed** | `probe:headlines.H1.cellsWithAsymmetricBlock` 80 of 95; `minDLeftAnyWideBlock` 0; `maxTableDRight` 950.41 px; 150.41 px right, 0 left at 960 px | `base.css:301` (`pre`), `:377` (`table`): `max-width: 100% + room` from a left-anchored box. A recorded choice, not an accident: ADR-0033 §5 "starts at the column's left edge … grows into the right margin" | L-04 |
| H2 | Blocks use different left edges | **Confirmed for code and images; the rest are declared or artefacts** | `probe:headlines.H2.leftEdgePxByKind_960_20_dark`: `pre` text 15–17.36 px in, `p>img` 278.58–288.58 px in, `table`, `h1`–`h6`, `dl.front` 0 | `pre` padding `base.css:303`; centred lone image `:444` (decision 3 keeps it) | L-04 |
| H3 | Hanging marks pass the gutter floor | **Confirmed below 720 px** | `probe:headlines.H3.maxOlMarkerHangPx` 45 (63 at 28 px); `cellsWithMarkClipped` 27; `widestWindowWithOffender` 720 | `base.css:196` (ordered markers hang 2.25 em), `:208` (checkboxes 1.25 em), against a 16/24 px floor (`:98`, `:127`, `:131`) | L-03 |
| H4 | A classic scrollbar moves the centre | **Killed as a centring error; confirmed as a transient overflow at narrow widths** | `probe:headlines.H4.maxCentreOffsetFromClientClassicPx` 0 (the visible area stays centred); `cellsWithLinesOverflowingClassic` 42, `maxLineOverflowClassicPx` 15.5, none at 960 px or wider; `cellsWithLinesOverflowingOverlay` 0 | Set lines are `nowrap` (`base.css:448`) until the resize relayout re-breaks them 100 ms after the article's width changes (`apps/desktop/src/app.ts:665-675`) | L-03 |
| H5 | Nested wide blocks pass the room | **Killed** | `lab:nested` (a synthetic list, nested list and quotation, each holding a wide table or `pre`): `pastRoomRightPx` 0 at 320, 960 and 1280 px, every depth | The indent that shrinks `100%` also moves the box right by the same amount, so `100% + room` ends at the page's room limit at any depth | — |
| H6 | Notices are off the column and out of sight | **Confirmed** | `probe:headlines.H6.noticeEdgeVsColumnLeft_960` 61.11 px, `_320` 32 px; `cellsWhereNoticeIsOutOfViewWhenScrolled` 178 of 179; `noticeLineHeightInGridUnits` 1.4; `sourceModeNoticeFixed` true; `adHocNoticeBuilderFiles` 5 | The region sizes its column in `em` at the body's 16 px, not the article's 20 (`base.css:31`); `3rem` side padding (`:37`); in flow above the article; `line-height: 1.4` (`:48`); `position: fixed` over Source (`apps/desktop/index.html:18`) | L-05 |
| H7 | Source mode lacks the basics | **Confirmed on `main`; looks answered by L-06** | `probe:headlines.H7`: `syntaxHighlightingReferences` 0, `foldGutterAlwaysOn`, `lineNumberChoiceInSessionStorage`, `searchPanelStyleRules` 0, `sourceOverlayFixedFullWindow` | `source/theme-bridge.ts:41,47`, `source/editor.ts:95`, `source/line-numbers.ts:16,24`, `index.html:16` | L-06 (#383), L-06.1, L-07, F-04 |

### H1. Confirmed

Every `pre` and `table` that is wider than the column starts on the column's left edge and runs
into the right margin only. At 960 px the right overhang is 150.41 px and the left 0
(`probe:rankingsAtReadingWidths.960x20-dark-overlay.H1`); at 2560 px a table reaches 1011.53 px
right (`probe:rankings.H1[0]`). The body text itself is centred: `maxBodyInkAsymmetryPx` 27.84 is
ragged right, not a shifted column. ADR-0033 §5 chose this ("grows into the right margin"); the
author's ruling of 2026-10-07 (decision 1) replaces it with symmetric growth, so L-04 amends
ADR-0033 §5 with the CSS. The lab's proposal (`lab:decisions.d1d2`) takes the page-box asymmetry
from 150.41 to −0.02 px at 960 px and from 310.41 to 0.2 px at 1280 px on `03-ai-plan.md`.

### H2. Confirmed for code; the other offenders are declared indents or artefacts

- **Code:** the `pre` box sits on the column and its padding (`--marxy-half`, 15 px at 20 px type)
  puts the code text 15 px inside the prose edge, 17.36 px where a highlighted line hangs its first
  character (`probe:rankingsByKind.H2.pre`, 183 blocks).
- **Images:** a lone image is centred by design (`base.css:444`), 278.58–288.58 px in at 960 px.
  Decision 3 keeps it.
- **Blockquotes** put text 19 px in (rule plus padding, `base.css:228`). That is what a quotation
  is; L-02 declares it.
- **Paragraphs (61 blocks, up to 19.31 px) are a probe artefact.** The typesetter hangs an initial
  capital optically (`<span class="marxy-hang">T</span>his …`, measured on `32-long-reference.md`
  bytes 10959–11068 at 960 px), and the probe leaves `.marxy-hang` out of a block's ink, so the ink
  edge reads as the second letter. L-02 counts a hung letter as ink that is allowed to hang.
- Tables, headings and the front-matter head are on the edge (0 px).

### H3. Confirmed below 720 px

An ordered-list marker hangs 2.25 em left of the column (45 px at 20 px type, 63 px at 28 px). The
gutter floor is 16 px up to 480 px and 24 px above, so wherever the window clamps the column the
marker crosses the floor, and at 320 px with 28 px type it starts 47 px outside the window
(`probe:rankings.H3[0]`, nine documents). Checkboxes hang 13.75 px and stay inside the window; hung
punctuation up to 14.59 px (`probe:rankingsByKind.H3.punct`) uses the gutter but is never clipped.
At 960 px and wider there is no offender (`probe:rankingsAtReadingWidths.*.H3` empty), because the
margin there is wider than any hang. The smallest fix lets a list hang only into the room there is:
`padding-inline-start: max(0px, 2.25em - var(--marxy-room))` on top-level ordered lists (and the
same for checkboxes), so the marker stays at or right of the gutter floor.

### H4. Killed as a centring error; confirmed as a transient overflow

With a 15 px classic scrollbar the column moves 7.5 px from the window's axis, which is exactly half
the scrollbar: the column is centred on the area the reader can see
(`maxCentreOffsetFromClientClassicPx` 0). That is not an error. What does happen is that when a
scrollbar *appears after first text*, the article loses 15 px at widths where the window clamps it
(≤ 720 px), and the lines already set stay at their old width: 42 cells, up to 15.5 px past the
paragraph box, and 2–6 px of sideways page scroll in 14 cells over all sizes and variants (3 of them
in the size-20, dark cells that `probe:headlines.H4.cellsWithHorizontalPageScroll` counts;
`probe:documents.*.*-classic.viewport.hScroll`). At 960 px and wider the article does not change width and nothing overflows.
The app's resize observer re-sets the page 100 ms after the article's width changes
(`app.ts:665-675`), so the overflow is transient; the headless probe cannot say for how long.

The recorded default (decision 4, `scrollbar-gutter: stable both-edges`) **showed no effect, or a
worse one, in this harness**: macOS Playwright WebKit with the scrollbar forced by
`::-webkit-scrollbar`. No gutter was reserved before the scrollbar appeared (the root's
`clientWidth` equalled `innerWidth` under `stable` and `stable both-edges`), and once it appeared
`both-edges` reserved it on both sides: the column moved 15 px instead of 7.5 and overflow doubled
to 30.25 px (`lab:decisions.d4.31-essay.md@480.stableBothEdges`; `stable` alone changed nothing).
`overflow-y: scroll` kept the column still (0 px, no overflow), at the price of an empty track at
rest on short documents. A control on a 400 px box that is not the viewport
(`lab:decisions.d4control`) reserved no gutter either, with the forced scrollbar or the engine's
own, which on macOS is an overlay of width 0. So this harness cannot tell its own model from the
engine: the result says nothing about WebKitGTK's native classic scrollbar. L-03 re-measures on
Linux WebKit before anything is chosen; the ruling itself is unchanged.

### H5. Killed

`lab:nested` renders a list item, a nested list item and a quotation, each holding a wide table, and
a quotation holding a long code line. At 320, 960 and 1280 px every box ends exactly at the page's
room limit (`pastRoomRightPx` 0) and its left edge stays inside the column. The arithmetic holds at
any depth: the indent shrinks `100%` and moves the box right by the same amount. The probe's two
corpus offenders (`probe:rankings.H5`, `30-notebook-export.md` at 320 px) are an artefact: the
"ink outside the window" is the preserved trailing spaces of a `pre-wrap` line (`KeyError` followed
by 34 spaces), which hang past the box and draw nothing. Scrolled tables land on the grid after the
grid pass at 16, 20 and 28 px with a classic scrollbar (whole grid units in every case measured);
a table that *starts* scrolling on a resize needs the relayout's grid pass, which `app.ts:665-675`
runs. The last-cell padding the hypothesis suspected is already 0 (`base.css:387`).

### H6. Confirmed, with the cause the L-00 review found

At 960 px the notice box is 61.11 px inside the column on each side. The region sizes its column in
`em` (`base.css:31`) at its own font size, which is the body's 16 px because only `.marxy-article`
sets 20 px; with the article's font size the edge is 0 off
(`probe:headlines.H6.noticeEdgeIfRegionFontMatchedArticle_960`). At 320 px the `3rem` padding
(48 px against the article's 16 px gutter) adds 32 px. The region is in flow above the article, so a
notice that arrives while the reader is scrolled down is above the viewport in 178 of 179 cells,
and when it is seen it pushes the text down 59.5 px. Its line is 1.4 grid units and its box 2.97
units, off the grid (artifacts spec, coupling rule 2). In Source it is `position: fixed` over the
text (`index.html:18`), against `docs/design/09-app-shell.md` ("it never overlaps the text"). Five
files still build `.marxy-notice` DOM themselves after B-09 and B-09.1: `save.ts`, `close.ts`,
`notices/blocked.ts`, `notices/truncation.ts`, `theme/theme-document.ts`. The lab's sticky proposal
(`lab:decisions.d5`) puts the edge on the column (0 px at 320 and 960 px) and keeps the region in
view when scrolled (top 0).

### H7. Confirmed on `main`; L-06 answers the looks

On `main` Source has no `HighlightStyle`, a fixed full-window overlay on the code ground, padding
called a grid unit that is two (`theme-bridge.ts:41`), an active line that works only for six-digit
hex (`:47`), an always-on fold gutter (`editor.ts:95`) and a line-number choice in `sessionStorage`
(`line-numbers.ts:16,24`). L-06 (#383) maps Lezer tags to `--marxy-tok-*`, puts lines on the 30 px
code line box, writes padding in grid units, mixes the active line, ties the fold gutter to the
numbers, re-themes live and styles the search panel. Left after it: persisting the number choice
(L-06.1, the lead's card), the column and the page ground (L-07), and the reading position in Source
(F-04, which owns `sourceVisibleByteOffset`; the window scrolls in Source, not `.cm-scroller`).

## 2. The conformance table

Every line of the typography spec ("Defaults and ranges", "Coupling rules", "Overrides by script",
"Verification") that touches layout, plus the rows lane L listed from both handbooks.

| Spec line | Says | Marxy | Status | Evidence | Card |
|---|---|---|---|---|---|
| Typography spec, Size; ch. 4 "Size" | 18 / 19 / 20 px stepped by `em` queries; text in `rem`, never `px` | 20 px fixed in `px` (`tokens.css:12`); the reader's size 15–50 px replaces the browser's text-size multiplier (`reader-config.ts:11-12`); no page zoom in the shell | **Contradicted** in unit, by choice; recommend keeping it (decision 7) | `lab:text200`: at 40 px (200 %) no clipping, no sideways scroll, no overlap at 960 and 1280 px | — |
| Spec, Size across faces; ch. 3 "Fallback metrics" | Match x-heights; a fallback face with `size-adjust` | Code 18 px against text 20 px: x-height ratio 0.965 (`lab:faces.emFractions`, 0.55 × 18 / 0.513 × 20; L-10 holds it at every size). Latin never falls back: `font-display: block` on bundled faces (`fonts.css:10,17,24`). Non-Latin scripts fall back unadjusted: Han ink 0.925 em, Hebrew 1.15 × the Literata x-height, Devanagari 1.25 ×, Arabic 0.77 × (macOS fallbacks) | **Applied** for code and Latin; **Open** for other scripts | `lab:faces` | — (not v1) |
| Spec, Measure; coupling rule 1 | 66 average characters, 45–80; recompute with face and size; clamp to the screen with the minimum gutters | `66 × 0.463 em`, clamped 45–80 (`base.css:94`); a theme that changes the face must set `--marxy-avg-char` (`docs/theme-contract.md:62`); the column clamps to the window less the gutters | **Applied** | aesthetics gate check 2; `lab:ragged.31-essay.md@960` mean 63.3 characters per line | — |
| Spec, Line height | 1.5, unitless | 30 / 20 px on a 15 px grid, set in `px` (ADR-0030) | **Applied** in value; the unit is a recorded departure | `grid.test.mjs` | — |
| Coupling rule 2; Alignment | Below 45 characters, ragged whatever the setting | Always ragged: the justified engine is reachable from no setting and B-17 deletes it. 29 characters a line on average at 320 px, 46 at 480 px, all `text-align: start`, word spacing 0 | **Applied** (vacuously); justification as an option is **Open** | `lab:ragged` | — |
| Coupling rule 4; Overrides by script (CJK) | Line height × 1.17 for CJK, never below 1.5 | 1.5 (30 px pitch at 20 px) for every script; the typesetter leaves CJK paragraphs to the engine (`typeset/src/index.ts:259`). 1.75 would be 35 px, which is not a whole grid unit | **Open** (the floor is met, the factor is not) | `lab:cjkInPage` pitch 30 px; `lab:faces.cjk.at30` / `at35` | L-08.1 (decision 9) |
| Overrides by script, Indic and Thai factors (1.1, 1.07) | Leading per script | Not applied; no script detection beyond the CJK fallback | **Open** | `typeset/src/index.ts:259` | — (not v1) |
| ch. 8, language tags; ch. 1 "Glyph selection" | Carry the language through so Han forms and hyphenation follow it | Every document is `lang="en"` (`index.html:2`); untagged German or French text gets en-us patterns (`packages/typeset/src/hyphenate.ts:17-22`, `typeset/src/index.ts:261-263`): `an-ti-con-sti-tu-tion-nelle-ment`, `elec-troence-falo-grafista` | **Contradicted** (by omission) | `lab:hyphenation.typesetter` | L-08.2 |
| Spec, Hyphenation; Verification "Hyphenation" | On in languages with patterns; probe `hyphens: auto` per engine; fall back to bundled patterns | Marxy hyphenates with bundled en-us / en-gb patterns, not the engine. macOS WebKit's `hyphens: auto` works in all eight languages probed (`lab:hyphenation.engine`); WebKitGTK not measured, and Marxy does not depend on it | **Applied** for English; other languages **Open** by the allow-list (ADR-0006) | `lab:hyphenation` | L-08.2 (tagging only) |
| ch. 4 "Headings" | `text-wrap: balance`; keep a heading with the next block | `balance` on every heading (`base.css:146`); keep-with-next is a paged-mode rule and Marxy scrolls | **Applied** | `base.css:146` | — |
| ch. 4 "Vertical rhythm" | `text-box-trim`; spacing in `rlh` | Neither; ADR-0030's grid and `snapToGrid` do the job by construction | **Open**, and not recommended until WebKitGTK ships `text-box-trim` | `base.css:1-6` | — |
| ch. 4 "Margins" | Centred column, margins what is left, a minimum gutter | Centred on the visible area (H4: client offset 0); 16 / 24 px floor; list markers cross the floor below 720 px (H3); wide blocks unbalance the margins (H1) | **Contradicted** below 720 px and with wide blocks | H1, H3, H4 above | L-03, L-04 |
| ch. 4 "Notes"; Spec, Notes | Margin notes above 76 em, pop-ups below; endnotes are the worst option | Endnotes (`base.css:414`); four corpus documents carry 58 footnote definitions. The right margin is 310 px at 1280 px, 470 px at 1600 px | **Contradicted**; deferred to after v1 by the author (decision 8) | `probe:documents.01-long-technical.md.1280x20-dark-overlay.column.room` | L-09 (deferred) |
| ch. 4 "Wide content" | Scrolls in its own focusable container; the page never scrolls sideways | Tables scroll and take a tab stop when they do (`startup/idle-work.ts:97-103`); code wraps (decision of ADR-0033 §5, against ch. 6 "default to scrolling"); display math scrolls (`base.css:453`) with no tab stop; the page scrolls 2–6 px sideways only in the transient H4 case | **Applied** for tables; **Contradicted** for code by ADR-0033; **Open** for math | `probe:headlines.H4.cellsWithHorizontalPageScroll` (3, the size-20 dark cells; 14 over all sizes) | L-08.3; L-03 for the H4 case |
| Verification "Text spacing" (WCAG 1.4.12) | Apply the four overrides; nothing clips or overlaps | Applied through a theme (the typesetter measures with it): 0 clipped, 0 overlaps, 0 lines past their box, no sideways scroll on four documents at 320 and 960 px. A sheet applied after setting, which the app never does, leaves set lines up to 214.83 px past their box | **Applied**, not gated | `lab:textSpacing.*.asTheme` / `.asLateSheet` | L-02 (gate it) |
| Verification "Zoom and reflow" | 320 px, 200 % and 400 % zoom; no sideways page scroll; text reaches 200 % | 320 px and "400 %" (320 px wide) are in the gate (`gate-aesthetics.mjs:1110-1112`); text reaches 250 % through the reader's size; at 40 px nothing clips or scrolls sideways | **Applied**; 200 % text **not gated** | `lab:text200`; gate reflow task | L-02 |
| Verification "Measure" | Average within 10 % of the target | Gated | **Applied** | aesthetics gate check 2 | — |
| Verification "Contrast", including line-highlight and selection | Every token on every surface | Gated for Rendered; L-06 colours Source from the same tokens and mixes the active line from the selection colour; light find matches 1.01:1 | **Applied** for Rendered; Source by L-06; find **Contradicted** | `grid.test.mjs`; the L-06 review | L-11 |
| Verification "Keyboard" | Every scrolling region reachable, with a focus ring | Tables yes (`idle-work.ts:97-103`, `base.css:392`); display math no | **Open** for math | as above | L-08.3 |
| Typography `06-code.md`; artifacts spec, Code | Highlighting with an audited theme; contrast against the line highlight and the selection | Rendered: Shiki on `--marxy-tok-*`. Source: L-06 | **Applied** (Source with #383) | `palettes.test.mjs`; `source-looks.test.mjs` in #383 | L-06 |
| Artifacts spec, line-number gutter | Hung in the left margin, secondary colour at 4.5:1 or better, never selectable | Secondary on the code ground: 6.39:1 dark, 5.92:1 light; CodeMirror's gutter is outside the content, so never selected; it sits inside the full-window overlay, not in a margin | **Applied** for colour and selection; **Open** for placement | `tokens.css:34,38`, `palettes.json` | L-07 |
| Artifacts spec, Source-mode folding | A fold gutter where line numbers show | On `main` always on (`editor.ts:95`); L-06 ties it to the numbers | **Applied** with #383 | `source-looks.test.mjs` L-06.3 | L-06 |
| Artifacts spec, Ligatures in Source | Off | L-06 sets `font-variant-ligatures: none` on `.cm-content` | **Applied** with #383 | `theme-bridge.ts` in #383 | L-06 |
| Artifacts spec, coupling rule 2 | Every unit (fold, gutter, notice, label) is whole grid units | Notices are 1.4 / 2.97 units; Source lines are whole with L-06 | **Contradicted** for notices | `probe:headlines.H6.noticeHeightInGridUnits` | L-05 |
| `09-app-shell.md` §Notices | One region, never overlapping the text | Overlaps in Source (`index.html:18`); out of view when scrolled in Rendered | **Contradicted** | H6 | L-05 |

## 3. The lab probes

`lab/layout/run.mjs` renders through the layout probe's harness (the aesthetics gate's render
entry) and three standalone pages, `lab/layout/faces.html`, `hyphenation.html` and `gutter.html`, served
from the harness's origin so they share its bundled fonts. It takes about 20 seconds; two runs give
an identical `lab/data/layout.json`. What each part measures:

- **`textSpacing`**: the four WCAG 1.4.12 overrides, once as a theme (present before the typesetter
  runs, as a reader theme would be) and once as a sheet added after setting. Counts clipped
  elements, set lines past their box, overlapping blocks and sideways scroll, on
  `09-gfm-everything`, `05-pathological-table-and-nesting`, `27-alerts` and `31-essay` at 320 and
  960 px.
- **`text200`**: the size tokens doubled (40 px text, 60 px line box). The headless entry only sets
  16–28 px, so these render untypeset and reflow by the engine; the app's typeset path at 40 px is
  covered by its relayout and is not measured here.
- **`ragged`**: characters per set line on `31-essay` at 320, 480 and 960 px (last lines left out).
- **`cjkInPage`, `faces`**: CJK line pitch in the app's page and in a standalone paragraph at 30 and
  35 px; ink heights of the bundled faces and of each script's system fallback by canvas, as
  fractions of the em.
- **`hyphenation`**: `hyphens: auto` against `manual` per language in WebKit, and the typesetter's
  pattern choice for the page's language with en-us applied to other languages' words.
- **`nested`**: H5's synthetic page at 320, 960 and 1280 px, and with a classic scrollbar at 16 and
  20 px.
- **`decisions`**: a before/after pair for decisions 1 to 5, each "after" a CSS proposal injected
  into the page, not a change made: symmetric and hung code boxes (`d1d2`), flush images (`d3`),
  four scrollbar treatments (`d4`) with a control on a non-viewport box (`d4control`, page
  `lab/layout/gutter.html`), sticky notices (`d5`).

What the lab does not do: run WebKitGTK, render Source mode (CodeMirror is not in the render
entry), render math (the app renders it after first text), or time the app's relayout.
